//! Transcription with Whisper (the sherpa-onnx export: an encoder, a decoder with
//! key/value caches, and a token table), after cutting the audio at pauses with the
//! Silero voice activity detector.  English-only models read English; multilingual
//! models take a language (or detect it from the first speech) and can translate
//! into English instead of transcribing.

use std::fs::File;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::Engine as _;
use ort::session::Session;
use ort::value::{DynValue, Tensor};
use rustfft::num_complex::Complex32;
use rustfft::{Fft, FftPlanner};
use serde_json::{json, Value};

use super::protocol::Frame;
use super::worker::{Engine, Reply};

pub const SAMPLE_RATE: u32 = 16_000;
const N_FFT: usize = 400;
const HOP: usize = 160;
/// Longest piece sent to Whisper at once, in seconds (the model pads to 30 s and needs room to end).
const MAX_SEGMENT_S: f32 = 14.0;
/// Longest recording accepted, in seconds (four hours).
const MAX_AUDIO_S: f32 = 4.0 * 3600.0;

pub struct SpeechModels {
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    pub tokens: PathBuf,
    pub vad: Option<PathBuf>,
}

pub enum Source<'a> {
    Path(PathBuf),
    Bytes(&'a [u8], String),
}

// ------------------------------------------------------------------ decoding

/// Decodes any audio or video file symphonia understands to mono samples at its own rate.
fn decode_symphonia(
    reader: Box<dyn symphonia::core::io::MediaSource>,
    extension: Option<&str>,
) -> Result<(Vec<f32>, u32), String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
    use symphonia::core::errors::Error;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let stream = MediaSourceStream::new(reader, Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = extension {
        hint.with_extension(extension);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("unrecognised audio ({error})"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|track| {
            track.codec_params.codec != CODEC_TYPE_NULL && track.codec_params.sample_rate.is_some()
        })
        .ok_or("no audio track")?;
    let track_id = track.id;
    let rate = track.codec_params.sample_rate.unwrap_or(SAMPLE_RATE);
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("unsupported audio codec ({error})"))?;
    let mut mono = Vec::new();
    let mut buffer: Option<SampleBuffer<f32>> = None;
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(Error::IoError(error)) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                break
            }
            Err(Error::ResetRequired) => break,
            Err(error) => return Err(format!("could not read the audio ({error})")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(Error::DecodeError(_)) => continue,
            Err(error) => return Err(format!("could not decode the audio ({error})")),
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count().max(1);
        let samples =
            buffer.get_or_insert_with(|| SampleBuffer::new(decoded.capacity() as u64, spec));
        if samples.capacity() < decoded.capacity() * channels {
            *samples = SampleBuffer::new(decoded.capacity() as u64, spec);
        }
        samples.copy_interleaved_ref(decoded);
        for frame in samples.samples().chunks(channels) {
            mono.push(frame.iter().sum::<f32>() / channels as f32);
        }
        if mono.len() as f32 / rate as f32 > MAX_AUDIO_S {
            return Err("The recording is longer than four hours; split it first.".into());
        }
    }
    if mono.is_empty() {
        return Err("no audio samples".into());
    }
    Ok((mono, rate))
}

/// Falls back to an installed ffmpeg for formats symphonia does not read (Opus, WebM, AMR...).
fn decode_ffmpeg(path: &Path) -> Result<Vec<f32>, String> {
    let ffmpeg = which::which("ffmpeg").map_err(|_| "ffmpeg is not installed".to_string())?;
    let output = std::process::Command::new(ffmpeg)
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(path)
        .args(["-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"])
        .output()
        .map_err(|error| format!("ffmpeg could not start: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffmpeg could not read the file: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output
        .stdout
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

/// Mono 16 kHz samples from a file or bytes.
pub fn load_audio(source: &Source) -> Result<Vec<f32>, String> {
    let (path, extension) = match source {
        Source::Path(path) => (
            Some(path.clone()),
            path.extension()
                .and_then(|e| e.to_str())
                .map(str::to_ascii_lowercase),
        ),
        Source::Bytes(_, name) => (
            None,
            Path::new(name)
                .extension()
                .and_then(|e| e.to_str())
                .map(str::to_ascii_lowercase),
        ),
    };
    let reader: Box<dyn symphonia::core::io::MediaSource> = match source {
        Source::Path(path) => Box::new(
            File::open(path).map_err(|error| format!("Cannot open {}: {error}", path.display()))?,
        ),
        Source::Bytes(bytes, _) => Box::new(Cursor::new(bytes.to_vec())),
    };
    match decode_symphonia(reader, extension.as_deref()) {
        Ok((samples, rate)) => resample(&samples, rate, SAMPLE_RATE),
        Err(first) => {
            // Write bytes to a temporary file so ffmpeg can try.
            let temporary;
            let file = match (&path, source) {
                (Some(path), _) => path.clone(),
                (None, Source::Bytes(bytes, name)) => {
                    let safe: String = Path::new(name)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("audio")
                        .chars()
                        .filter(|c| c.is_ascii_alphanumeric() || *c == '.')
                        .collect();
                    temporary = std::env::temp_dir()
                        .join(format!("benchtop-audio-{}-{safe}", std::process::id()));
                    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
                    temporary.clone()
                }
                _ => unreachable!(),
            };
            let result = decode_ffmpeg(&file)
                .map_err(|second| format!("This file could not be read: {first}; {second}."));
            if path.is_none() {
                let _ = std::fs::remove_file(&file);
            }
            result
        }
    }
}

/// Band-limited resampling (FFT-based) to `to` Hz.
pub fn resample(samples: &[f32], from: u32, to: u32) -> Result<Vec<f32>, String> {
    use rubato::{FftFixedIn, Resampler};
    if from == to {
        return Ok(samples.to_vec());
    }
    let chunk = 1024;
    let mut resampler = FftFixedIn::<f32>::new(from as usize, to as usize, chunk, 2, 1)
        .map_err(|error| error.to_string())?;
    let delay = resampler.output_delay();
    let mut out = Vec::with_capacity(samples.len() * to as usize / from as usize + chunk);
    let mut position = 0;
    while position + chunk <= samples.len() {
        let produced = resampler
            .process(&[&samples[position..position + chunk]], None)
            .map_err(|error| error.to_string())?;
        out.extend_from_slice(&produced[0]);
        position += chunk;
    }
    let tail = resampler
        .process_partial(Some(&[&samples[position..]]), None)
        .map_err(|error| error.to_string())?;
    out.extend_from_slice(&tail[0]);
    let flush = resampler
        .process_partial::<&[f32]>(None, None)
        .map_err(|error| error.to_string())?;
    out.extend_from_slice(&flush[0]);
    let expected = (samples.len() as u64 * to as u64 / from as u64) as usize;
    let start = delay.min(out.len());
    let mut result = out[start..].to_vec();
    result.truncate(expected);
    Ok(result)
}

// ------------------------------------------------------------------ voice activity

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Segment {
    pub start: usize,
    pub end: usize,
}

/// Turns per-window speech probabilities (512 samples each) into speech segments.
pub fn segments_from_probabilities(probabilities: &[f32], total: usize) -> Vec<Segment> {
    const WINDOW: usize = 512;
    let threshold = 0.5;
    let negative = threshold - 0.15;
    let min_silence = (0.3 * SAMPLE_RATE as f32) as usize;
    let min_speech = (0.25 * SAMPLE_RATE as f32) as usize;
    let pad = (0.12 * SAMPLE_RATE as f32) as usize;
    let max_len = (MAX_SEGMENT_S * SAMPLE_RATE as f32) as usize;
    let mut raw = Vec::new();
    let mut triggered = false;
    let mut start = 0;
    let mut silence_from = 0;
    for (index, &probability) in probabilities.iter().enumerate() {
        let position = index * WINDOW;
        if probability >= threshold {
            silence_from = 0;
            if !triggered {
                triggered = true;
                start = position;
            }
        }
        if triggered && position - start >= max_len {
            // Cut a long stretch at the quietest window of its last few seconds.
            let from = (start + max_len / 2) / WINDOW;
            let quietest = (from..=index)
                .min_by(|a, b| probabilities[*a].total_cmp(&probabilities[*b]))
                .unwrap_or(index);
            let cut = quietest * WINDOW;
            raw.push(Segment { start, end: cut });
            start = cut;
            silence_from = 0;
        }
        if triggered && probability < negative {
            if silence_from == 0 {
                silence_from = position;
            }
            if position - silence_from >= min_silence {
                raw.push(Segment {
                    start,
                    end: silence_from,
                });
                triggered = false;
                silence_from = 0;
            }
        }
    }
    if triggered {
        raw.push(Segment { start, end: total });
    }
    let mut padded: Vec<Segment> = Vec::new();
    for segment in raw
        .into_iter()
        .filter(|segment| segment.end.saturating_sub(segment.start) >= min_speech)
    {
        let start = segment
            .start
            .saturating_sub(pad)
            .max(padded.last().map_or(0, |last| last.end));
        let end = (segment.end + pad).min(total);
        // Join pieces separated by a breath when they still fit in one window.
        if let Some(last) = padded.last_mut() {
            if start.saturating_sub(last.end) < (0.2 * SAMPLE_RATE as f32) as usize
                && end - last.start <= max_len
            {
                last.end = end;
                continue;
            }
        }
        if end > start {
            padded.push(Segment { start, end });
        }
    }
    padded
}

fn vad_segments(
    engine: &mut Engine,
    model: &Path,
    samples: &[f32],
    reply: &mut Reply,
) -> Result<Vec<Segment>, String> {
    let session = engine.session(model)?;
    let names: Vec<String> = session
        .inputs()
        .iter()
        .map(|input| input.name().to_string())
        .collect();
    if names.len() < 3 {
        return Err("The voice activity model has an unexpected shape.".into());
    }
    let mut h = vec![0f32; 2 * 64];
    let mut c = vec![0f32; 2 * 64];
    let windows = samples.len() / 512;
    let mut probabilities = Vec::with_capacity(windows);
    for index in 0..windows {
        let window = samples[index * 512..(index + 1) * 512].to_vec();
        let x = Tensor::from_array(([1usize, 512], window)).map_err(|error| error.to_string())?;
        let ht = Tensor::from_array(([2usize, 1, 64], std::mem::take(&mut h)))
            .map_err(|error| error.to_string())?;
        let ct = Tensor::from_array(([2usize, 1, 64], std::mem::take(&mut c)))
            .map_err(|error| error.to_string())?;
        let outputs = session
            .run(ort::inputs![names[0].as_str() => x, names[1].as_str() => ht, names[2].as_str() => ct])
            .map_err(|error| format!("Voice detection failed: {error}"))?;
        probabilities.push(
            outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|error| error.to_string())?
                .1[0],
        );
        h = outputs[1]
            .try_extract_tensor::<f32>()
            .map_err(|error| error.to_string())?
            .1
            .to_vec();
        c = outputs[2]
            .try_extract_tensor::<f32>()
            .map_err(|error| error.to_string())?
            .1
            .to_vec();
        if index % 2000 == 0 {
            reply.progress(
                0.05 + 0.1 * index as f64 / windows.max(1) as f64,
                "Finding speech",
            );
        }
    }
    Ok(segments_from_probabilities(&probabilities, samples.len()))
}

/// Without a voice activity model: fixed pieces at the quietest point near each limit.
fn fixed_segments(samples: &[f32]) -> Vec<Segment> {
    let max_len = (MAX_SEGMENT_S * SAMPLE_RATE as f32) as usize;
    let mut segments = Vec::new();
    let mut start = 0;
    while start < samples.len() {
        let mut end = (start + max_len).min(samples.len());
        if end < samples.len() {
            // Look back up to 4 s for the quietest 50 ms.
            let window = 800;
            let search_from = end
                .saturating_sub(4 * SAMPLE_RATE as usize)
                .max(start + window);
            let mut best = end;
            let mut best_energy = f32::MAX;
            let mut position = search_from;
            while position + window <= end {
                let energy: f32 = samples[position..position + window]
                    .iter()
                    .map(|s| s * s)
                    .sum();
                if energy < best_energy {
                    best_energy = energy;
                    best = position + window / 2;
                }
                position += window / 2;
            }
            end = best;
        }
        segments.push(Segment { start, end });
        start = end;
    }
    segments
}

// ------------------------------------------------------------------ features

/// Whisper's mel filterbank (librosa's Slaney scale and normalisation).
pub fn mel_filters(n_mels: usize) -> Vec<Vec<f32>> {
    let sr = SAMPLE_RATE as f64;
    let bins = N_FFT / 2 + 1;
    let hz_to_mel = |hz: f64| {
        let f_sp = 200.0 / 3.0;
        if hz < 1000.0 {
            hz / f_sp
        } else {
            1000.0 / f_sp + (hz / 1000.0).ln() / (6.4f64.ln() / 27.0)
        }
    };
    let mel_to_hz = |mel: f64| {
        let f_sp = 200.0 / 3.0;
        let min_log_mel = 1000.0 / f_sp;
        if mel < min_log_mel {
            mel * f_sp
        } else {
            1000.0 * ((6.4f64.ln() / 27.0) * (mel - min_log_mel)).exp()
        }
    };
    let top = hz_to_mel(sr / 2.0);
    let points: Vec<f64> = (0..n_mels + 2)
        .map(|i| mel_to_hz(top * i as f64 / (n_mels + 1) as f64))
        .collect();
    let freqs: Vec<f64> = (0..bins).map(|k| k as f64 * sr / N_FFT as f64).collect();
    (0..n_mels)
        .map(|m| {
            let (lower, centre, upper) = (points[m], points[m + 1], points[m + 2]);
            let norm = 2.0 / (upper - lower);
            freqs
                .iter()
                .map(|&f| {
                    let rising = (f - lower) / (centre - lower);
                    let falling = (upper - f) / (upper - centre);
                    (rising.min(falling).max(0.0) * norm) as f32
                })
                .collect()
        })
        .collect()
}

/// Log-mel features `[n_mels][frames]` normalised like Whisper.
pub fn log_mel(samples: &[f32], filters: &[Vec<f32>], fft: &Arc<dyn Fft<f32>>) -> Vec<Vec<f32>> {
    let window: Vec<f32> = (0..N_FFT)
        .map(|n| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * n as f32 / N_FFT as f32).cos())
        .collect();
    // Centre the frames with reflect padding, as torch.stft(center=True) does.
    let pad = N_FFT / 2;
    let len = samples.len();
    let reflect = |i: isize| -> f32 {
        if len < 2 {
            return samples.first().copied().unwrap_or(0.0);
        }
        let mut i = i;
        let last = len as isize - 1;
        while i < 0 || i > last {
            if i < 0 {
                i = -i;
            }
            if i > last {
                i = 2 * last - i;
            }
        }
        samples[i as usize]
    };
    let frames = len / HOP;
    let bins = N_FFT / 2 + 1;
    let mut spec = vec![vec![0f32; frames]; filters.len()];
    let mut buffer = vec![Complex32::new(0.0, 0.0); N_FFT];
    let mut power = vec![0f32; bins];
    #[allow(clippy::needless_range_loop)] // `frame` indexes the second axis of `spec`.
    for frame in 0..frames {
        let origin = (frame * HOP) as isize - pad as isize;
        for (n, slot) in buffer.iter_mut().enumerate() {
            *slot = Complex32::new(reflect(origin + n as isize) * window[n], 0.0);
        }
        fft.process(&mut buffer);
        for (k, value) in power.iter_mut().enumerate() {
            *value = buffer[k].norm_sqr();
        }
        for (m, filter) in filters.iter().enumerate() {
            spec[m][frame] = filter
                .iter()
                .zip(&power)
                .map(|(w, p)| w * p)
                .sum::<f32>()
                .max(1e-10)
                .log10();
        }
    }
    let max = spec.iter().flatten().copied().fold(f32::MIN, f32::max);
    for row in &mut spec {
        for value in row.iter_mut() {
            *value = (value.max(max - 8.0) + 4.0) / 4.0;
        }
    }
    spec
}

// ------------------------------------------------------------------ Whisper

struct Whisper {
    n_mels: usize,
    n_text_layer: usize,
    n_text_ctx: usize,
    n_text_state: usize,
    sot: i64,
    eot: i64,
    no_timestamps: i64,
    blank: i64,
    /// Language codes and their tokens; empty for English-only models.
    languages: Vec<(String, i64)>,
    transcribe: i64,
    translate: i64,
    tokens: Vec<Vec<u8>>,
}

impl Whisper {
    fn multilingual(&self) -> bool {
        !self.languages.is_empty()
    }

    fn language_token(&self, code: &str) -> Option<i64> {
        self.languages
            .iter()
            .find(|(known, _)| known == code)
            .map(|(_, token)| *token)
    }

    fn language_code(&self, token: i64) -> &str {
        self.languages
            .iter()
            .find(|(_, known)| *known == token)
            .map_or("en", |(code, _)| code.as_str())
    }

    /// The tokens the decoder starts from: start of transcript, then for multilingual
    /// models the language and the task, then "no timestamps".
    fn prompt(&self, language: Option<i64>, translate: bool) -> Vec<i64> {
        let mut prompt = vec![self.sot];
        if let Some(language) = language.filter(|_| self.multilingual()) {
            prompt.push(language);
            prompt.push(if translate {
                self.translate
            } else {
                self.transcribe
            });
        }
        prompt.push(self.no_timestamps);
        prompt
    }
}

fn metadata(engine: &mut Engine, model: &Path) -> Result<Whisper, String> {
    let session = engine.session(model)?;
    let meta = session.metadata().map_err(|error| error.to_string())?;
    let get = |key: &str| {
        meta.custom(key)
            .ok_or_else(|| format!("The speech model has no \"{key}\" entry."))
    };
    let number = |key: &str| -> Result<i64, String> {
        get(key)?
            .trim()
            .parse::<i64>()
            .map_err(|_| format!("Bad \"{key}\" in the speech model."))
    };
    let sot_sequence: Vec<i64> = get("sot_sequence")?
        .split(',')
        .filter_map(|v| v.trim().parse().ok())
        .collect();
    let sot = number("sot")
        .ok()
        .or_else(|| sot_sequence.first().copied())
        .ok_or("The speech model has no start token.")?;
    let languages = if number("is_multilingual").unwrap_or(0) == 1 {
        let codes = get("all_language_codes")?;
        let tokens = get("all_language_tokens")?;
        codes
            .split(',')
            .map(|code| code.trim().to_string())
            .zip(
                tokens
                    .split(',')
                    .filter_map(|v| v.trim().parse::<i64>().ok()),
            )
            .collect()
    } else {
        Vec::new()
    };
    Ok(Whisper {
        n_mels: number("n_mels")? as usize,
        n_text_layer: number("n_text_layer")? as usize,
        n_text_ctx: number("n_text_ctx")? as usize,
        n_text_state: number("n_text_state")? as usize,
        sot,
        eot: number("eot")?,
        no_timestamps: number("no_timestamps")?,
        blank: number("blank_id").unwrap_or(220),
        transcribe: number("transcribe").unwrap_or(-1),
        translate: number("translate").unwrap_or(-1),
        languages,
        tokens: Vec::new(),
    })
}

fn load_tokens(path: &Path) -> Result<Vec<Vec<u8>>, String> {
    let mut text = String::new();
    File::open(path)
        .and_then(|mut file| file.read_to_string(&mut text))
        .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    let mut table: Vec<Vec<u8>> = Vec::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let (Some(token), Some(id)) = (parts.next(), parts.next()) else {
            continue;
        };
        let Ok(id) = id.parse::<usize>() else {
            continue;
        };
        if table.len() <= id {
            table.resize(id + 1, Vec::new());
        }
        table[id] = base64::engine::general_purpose::STANDARD
            .decode(token)
            .unwrap_or_default();
    }
    Ok(table)
}

fn extract(value: &DynValue) -> Result<(Vec<i64>, Vec<f32>), String> {
    let (shape, data) = value
        .try_extract_tensor::<f32>()
        .map_err(|error| error.to_string())?;
    Ok((shape.to_vec(), data.to_vec()))
}

/// The encoder's cross-attention keys and values for one piece of audio.
struct Encoded {
    cross_k: DynValue,
    cross_v: DynValue,
}

/// Runs the encoder on one piece of audio (`mel` is `[n_mels][frames]`).
fn encode(
    engine: &mut Engine,
    models: &SpeechModels,
    whisper: &Whisper,
    mel: Vec<Vec<f32>>,
) -> Result<Encoded, String> {
    // Pad 1500 frames (15 s) of silence so the model has room to end, as sherpa-onnx does.
    let frames = (mel[0].len() + 1500).min(3000);
    let mut flat = vec![0f32; whisper.n_mels * frames];
    for (m, row) in mel.iter().enumerate() {
        let copy = row.len().min(frames - 50);
        flat[m * frames..m * frames + copy].copy_from_slice(&row[..copy]);
    }
    let encoder = engine.session(&models.encoder)?;
    let input_name = encoder.inputs()[0].name().to_string();
    let mel_tensor = Tensor::from_array(([1usize, whisper.n_mels, frames], flat))
        .map_err(|error| error.to_string())?;
    let mut encoded = encoder
        .run(ort::inputs![input_name => mel_tensor])
        .map_err(|error| format!("The speech encoder failed: {error}"))?;
    let mut take = |name: &str| {
        encoded
            .remove(name)
            .or_else(|| {
                let first = encoded.keys().next().map(str::to_string)?;
                encoded.remove(first.as_str())
            })
            .ok_or("The speech encoder gave no output.")
    };
    let cross_k = take("n_layer_cross_k")?;
    let cross_v = take("n_layer_cross_v")?;
    Ok(Encoded { cross_k, cross_v })
}

/// The decoder session, its input names and empty key/value caches.
struct Decoder<'a> {
    session: &'a mut Session,
    names: Vec<String>,
    self_k: DynValue,
    self_v: DynValue,
    offset: i64,
}

impl<'a> Decoder<'a> {
    fn new(
        engine: &'a mut Engine,
        models: &SpeechModels,
        whisper: &Whisper,
    ) -> Result<Self, String> {
        let session = engine.session(&models.decoder)?;
        let names: Vec<String> = session
            .inputs()
            .iter()
            .map(|input| input.name().to_string())
            .collect();
        if names.len() < 6 {
            return Err("The speech decoder has an unexpected shape.".into());
        }
        let shape = [
            whisper.n_text_layer,
            1,
            whisper.n_text_ctx,
            whisper.n_text_state,
        ];
        let len = shape.iter().product::<usize>();
        let zeros = || -> Result<DynValue, String> {
            Ok(Tensor::from_array((shape, vec![0f32; len]))
                .map_err(|error| error.to_string())?
                .into_dyn())
        };
        Ok(Decoder {
            session,
            names,
            self_k: zeros()?,
            self_v: zeros()?,
            offset: 0,
        })
    }

    /// Feeds `tokens` and returns the scores for whatever follows the last one.
    fn step(&mut self, tokens: &[i64], audio: &Encoded) -> Result<Vec<f32>, String> {
        let token_tensor = Tensor::from_array(([1usize, tokens.len()], tokens.to_vec()))
            .map_err(|error| error.to_string())?;
        let offset_tensor =
            Tensor::from_array(([1usize], vec![self.offset])).map_err(|error| error.to_string())?;
        let names = &self.names;
        let mut outputs = self
            .session
            .run(ort::inputs![
                names[0].as_str() => token_tensor,
                names[1].as_str() => &self.self_k,
                names[2].as_str() => &self.self_v,
                names[3].as_str() => &audio.cross_k,
                names[4].as_str() => &audio.cross_v,
                names[5].as_str() => offset_tensor,
            ])
            .map_err(|error| format!("The speech decoder failed: {error}"))?;
        let output_names: Vec<String> = outputs.keys().map(str::to_string).collect();
        let (shape, logits) = extract(&outputs[0])?;
        let vocab = *shape.last().unwrap_or(&0) as usize;
        let last = logits[logits.len() - vocab..].to_vec();
        let self_k = outputs
            .remove(output_names[1].as_str())
            .ok_or("missing key cache")?;
        let self_v = outputs
            .remove(output_names[2].as_str())
            .ok_or("missing value cache")?;
        drop(outputs);
        self.self_k = self_k;
        self.self_v = self_v;
        self.offset += tokens.len() as i64;
        Ok(last)
    }
}

/// The most likely spoken language, as a language token (multilingual models only).
fn detect_language(
    engine: &mut Engine,
    models: &SpeechModels,
    whisper: &Whisper,
    audio: &Encoded,
) -> Result<i64, String> {
    let mut decoder = Decoder::new(engine, models, whisper)?;
    let scores = decoder.step(&[whisper.sot], audio)?;
    whisper
        .languages
        .iter()
        .filter(|(_, token)| (*token as usize) < scores.len())
        .max_by(|a, b| scores[a.1 as usize].total_cmp(&scores[b.1 as usize]))
        .map(|(_, token)| *token)
        .ok_or_else(|| "The speech model lists no languages.".into())
}

/// Greedy decoding of one piece of audio from `prompt`.
fn decode(
    engine: &mut Engine,
    models: &SpeechModels,
    whisper: &Whisper,
    audio: &Encoded,
    prompt: &[i64],
    tokens_per_second: f32,
    seconds: f32,
) -> Result<String, String> {
    let mut decoder = Decoder::new(engine, models, whisper)?;
    let mut tokens: Vec<i64> = prompt.to_vec();
    let mut result: Vec<i64> = Vec::new();
    let limit = ((10.0 + seconds * tokens_per_second) as usize)
        .min(whisper.n_text_ctx.saturating_sub(prompt.len() + 1));
    loop {
        let scores = decoder.step(&tokens, audio)?;
        let first = result.is_empty();
        let mut best = (-1i64, f32::MIN);
        for (id, &score) in scores.iter().enumerate() {
            let id = id as i64;
            // Every special token (start, languages, tasks, timestamps) comes after end-of-text.
            if id > whisper.eot || (first && (id == whisper.eot || id == whisper.blank)) {
                continue;
            }
            if score > best.1 {
                best = (id, score);
            }
        }
        let next = best.0;
        if next == whisper.eot || next < 0 {
            break;
        }
        result.push(next);
        if result.len() >= limit || repeating(&result) {
            break;
        }
        tokens = vec![next];
    }
    let mut bytes = Vec::new();
    for id in result {
        if let Some(token) = whisper.tokens.get(id as usize) {
            bytes.extend_from_slice(token);
        }
    }
    Ok(String::from_utf8_lossy(&bytes).trim().to_string())
}

/// Stops the decoder looping on a phrase (a known Whisper failure on music and noise).
fn repeating(tokens: &[i64]) -> bool {
    for size in 1..=8 {
        let repeats = if size == 1 { 12 } else { 4 };
        if tokens.len() < size * repeats {
            continue;
        }
        let tail = &tokens[tokens.len() - size..];
        if (1..repeats)
            .all(|k| &tokens[tokens.len() - size * (k + 1)..tokens.len() - size * k] == tail)
        {
            return true;
        }
    }
    false
}

pub fn transcribe(
    engine: &mut Engine,
    models: &SpeechModels,
    source: Source,
    options: &Value,
    reply: &mut Reply,
) -> Result<Frame, String> {
    let mut whisper = metadata(engine, &models.encoder)?;
    let wanted = options
        .get("language")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .unwrap_or("auto")
        .to_ascii_lowercase();
    let translate = options.get("task").and_then(Value::as_str) == Some("translate");
    // `None` until the language is detected from the first speech.
    let mut language: Option<i64> = None;
    if whisper.multilingual() {
        if wanted != "auto" {
            language = Some(whisper.language_token(&wanted).ok_or_else(|| {
                format!("This speech model does not know the language \"{wanted}\".")
            })?);
        }
    } else if wanted != "auto" && wanted != "en" {
        return Err("This speech model understands English only. Choose a multilingual Whisper model (Settings → AI models) for other languages.".into());
    } else if translate {
        return Err(
            "Translation needs a multilingual Whisper model; this one understands English only."
                .into(),
        );
    }

    reply.progress(0.01, "Reading the audio");
    let samples = load_audio(&source)?;
    let duration = samples.len() as f32 / SAMPLE_RATE as f32;
    if duration < 0.2 {
        return Err("The recording is too short to transcribe.".into());
    }
    let segments = match &models.vad {
        Some(vad) if vad.is_file() => vad_segments(engine, vad, &samples, reply)?,
        _ => fixed_segments(&samples),
    };
    whisper.tokens = load_tokens(&models.tokens)?;
    let filters = mel_filters(whisper.n_mels);
    let fft = FftPlanner::<f32>::new().plan_fft_forward(N_FFT);
    let mut lines = Vec::new();
    let total: usize = segments
        .iter()
        .map(|s| s.end - s.start)
        .sum::<usize>()
        .max(1);
    let mut done = 0usize;
    for segment in &segments {
        let piece = &samples[segment.start..segment.end];
        let seconds = piece.len() as f32 / SAMPLE_RATE as f32;
        let mel = log_mel(piece, &filters, &fft);
        if mel.is_empty() || mel[0].is_empty() {
            continue;
        }
        let audio = encode(engine, models, &whisper, mel)?;
        if whisper.multilingual() && language.is_none() {
            language = Some(detect_language(engine, models, &whisper, &audio)?);
        }
        let english = translate
            || !whisper.multilingual()
            || language.map(|token| whisper.language_code(token)) == Some("en");
        // English needs about 3 tokens a second; other scripts use far more bytes per word.
        let rate = if english { 8.0 } else { 25.0 };
        let prompt = whisper.prompt(language, translate);
        let text = decode(engine, models, &whisper, &audio, &prompt, rate, seconds)?;
        done += piece.len();
        reply.progress(0.15 + 0.84 * done as f64 / total as f64, "Transcribing");
        if !text.is_empty() {
            lines.push(json!({
                "start": segment.start as f64 / SAMPLE_RATE as f64,
                "end": segment.end as f64 / SAMPLE_RATE as f64,
                "text": text,
            }));
        }
    }
    let code = match language {
        Some(token) if whisper.multilingual() => whisper.language_code(token).to_string(),
        _ if whisper.multilingual() && wanted != "auto" => wanted,
        _ => "en".to_string(),
    };
    Ok(Frame::new(json!({
        "duration": duration,
        "segments": lines,
        "language": if translate { "en".to_string() } else { code.clone() },
        "spoken": code,
        "translated": translate,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mel_filters_match_librosa_shape() {
        let filters = mel_filters(80);
        assert_eq!(filters.len(), 80);
        assert_eq!(filters[0].len(), 201);
        // Each Slaney filter is a triangle normalised to unit area in mel-spaced Hz.
        assert!(filters.iter().all(|row| row.iter().any(|v| *v > 0.0)));
        // The first filter peaks at bin 1 (40 Hz is the first bin past zero).
        let peak = filters[0]
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        assert!(peak <= 2, "first filter peak at bin {peak}");
    }

    #[test]
    fn log_mel_has_whisper_frame_count() {
        let samples: Vec<f32> = (0..SAMPLE_RATE as usize * 2)
            .map(|i| (i as f32 * 440.0 * 2.0 * std::f32::consts::PI / SAMPLE_RATE as f32).sin())
            .collect();
        let filters = mel_filters(80);
        let fft = FftPlanner::<f32>::new().plan_fft_forward(N_FFT);
        let mel = log_mel(&samples, &filters, &fft);
        assert_eq!(mel.len(), 80);
        assert_eq!(mel[0].len(), 200);
        let max = mel.iter().flatten().copied().fold(f32::MIN, f32::max);
        let min = mel.iter().flatten().copied().fold(f32::MAX, f32::min);
        assert!(max <= 1.6 && min >= max - 2.0 - 1e-4);
    }

    #[test]
    fn resamples_to_the_expected_length() {
        let samples = vec![0.5f32; 44_100];
        let out = resample(&samples, 44_100, 16_000).unwrap();
        assert_eq!(out.len(), 16_000);
        assert!((out[8000] - 0.5).abs() < 0.01);
    }

    #[test]
    fn segments_speech_and_skips_silence() {
        // 1 s silence, 2 s speech, 1 s silence, 0.1 s blip, silence.
        let mut probabilities = vec![0.05f32; 31];
        probabilities.extend(vec![0.9; 63]);
        probabilities.extend(vec![0.05; 31]);
        probabilities.extend(vec![0.9; 3]);
        probabilities.extend(vec![0.05; 31]);
        let total = probabilities.len() * 512;
        let segments = segments_from_probabilities(&probabilities, total);
        assert_eq!(segments.len(), 1);
        let start_s = segments[0].start as f32 / SAMPLE_RATE as f32;
        let end_s = segments[0].end as f32 / SAMPLE_RATE as f32;
        assert!((0.8..1.0).contains(&start_s), "{start_s}");
        assert!((2.9..3.2).contains(&end_s), "{end_s}");
    }

    #[test]
    fn splits_long_speech() {
        let probabilities = vec![0.9f32; 31 * 40];
        let segments = segments_from_probabilities(&probabilities, probabilities.len() * 512);
        assert!(segments.len() >= 3);
        assert!(segments
            .iter()
            .all(|s| (s.end - s.start) as f32 / SAMPLE_RATE as f32 <= MAX_SEGMENT_S + 0.5));
    }

    #[test]
    fn detects_repetition() {
        assert!(repeating(&[1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]));
        assert!(!repeating(&[1, 2, 3, 4, 5, 6, 7, 8]));
    }
}
