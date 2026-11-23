//! Text to speech with Piper voices (VITS models trained by the Piper project).
//! eSpeak NG, run as a separate program, turns text into IPA phonemes the way
//! Piper's own phonemizer does (clause by clause, with the clause's punctuation
//! kept); the voice's phoneme map turns those into ids for the model.

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use ort::value::Tensor;
use serde_json::{json, Value};

use super::protocol::Frame;
use super::worker::{Engine, Reply};

/// A voice's settings from its `voice.onnx.json`.
pub(crate) struct Voice {
    pub ids: HashMap<char, Vec<i64>>,
    pub sample_rate: u32,
    pub espeak_voice: String,
    pub noise_scale: f32,
    pub length_scale: f32,
    pub noise_w: f32,
    pub speakers: usize,
}

impl Voice {
    pub fn from_config(config: &Value) -> Result<Voice, String> {
        let map = config
            .get("phoneme_id_map")
            .and_then(Value::as_object)
            .ok_or("The voice has no phoneme map.")?;
        let mut ids = HashMap::new();
        for (key, value) in map {
            let mut chars = key.chars();
            let (Some(c), None) = (chars.next(), chars.next()) else {
                continue;
            };
            let list: Vec<i64> = value
                .as_array()
                .map(|a| a.iter().filter_map(Value::as_i64).collect())
                .unwrap_or_default();
            if !list.is_empty() {
                ids.insert(c, list);
            }
        }
        for required in ['^', '$', '_'] {
            if !ids.contains_key(&required) {
                return Err(format!("The voice's phoneme map has no '{required}'."));
            }
        }
        let inference = config.get("inference");
        let number = |key: &str, default: f64| {
            inference
                .and_then(|i| i.get(key))
                .and_then(Value::as_f64)
                .unwrap_or(default) as f32
        };
        Ok(Voice {
            ids,
            sample_rate: config
                .pointer("/audio/sample_rate")
                .and_then(Value::as_u64)
                .unwrap_or(22_050) as u32,
            espeak_voice: config
                .pointer("/espeak/voice")
                .and_then(Value::as_str)
                .unwrap_or("en-us")
                .to_string(),
            noise_scale: number("noise_scale", 0.667),
            length_scale: number("length_scale", 1.0),
            noise_w: number("noise_w", 0.8),
            speakers: config
                .get("num_speakers")
                .and_then(Value::as_u64)
                .unwrap_or(1) as usize,
        })
    }
}

/// A clause and the punctuation that ended it.
pub(crate) type Clause = (String, Option<char>);

const CLAUSE_ENDS: &[char] = &[',', ';', ':', '،', '؛'];
const SENTENCE_ENDS: &[char] = &['.', '?', '!', '।', '॥', '؟', '۔'];

/// Splits text into sentences made of clauses, as eSpeak NG does: commas,
/// semicolons and colons end clauses; full stops, question and exclamation
/// marks, the danda and line breaks end sentences.  A full stop between
/// digits (3.5) does not.
pub(crate) fn sentences(text: &str) -> Vec<Vec<Clause>> {
    let chars: Vec<char> = text.chars().collect();
    let mut out: Vec<Vec<Clause>> = Vec::new();
    let mut sentence: Vec<Clause> = Vec::new();
    let mut clause = String::new();
    let flush_clause = |clause: &mut String, sentence: &mut Vec<Clause>, end: Option<char>| {
        let text = clause.split_whitespace().collect::<Vec<_>>().join(" ");
        if !text.is_empty() {
            sentence.push((text, end));
        } else if let (Some(end), Some(last)) = (end, sentence.last_mut()) {
            // "Hello?!": keep the first mark only.
            if last.1.is_none() {
                last.1 = Some(end);
            }
        }
        clause.clear();
    };
    for (i, &c) in chars.iter().enumerate() {
        let between_digits = c == '.'
            && i > 0
            && chars[i - 1].is_ascii_digit()
            && chars.get(i + 1).is_some_and(char::is_ascii_digit);
        if c == '\n' || (SENTENCE_ENDS.contains(&c) && !between_digits) {
            flush_clause(
                &mut clause,
                &mut sentence,
                if c == '\n' { None } else { Some(c) },
            );
            if !sentence.is_empty() {
                out.push(std::mem::take(&mut sentence));
            }
        } else if CLAUSE_ENDS.contains(&c) && !(c == ',' && between_digits_comma(&chars, i)) {
            flush_clause(&mut clause, &mut sentence, Some(c));
        } else {
            clause.push(c);
        }
    }
    flush_clause(&mut clause, &mut sentence, None);
    if !sentence.is_empty() {
        out.push(sentence);
    }
    out
}

fn between_digits_comma(chars: &[char], i: usize) -> bool {
    i > 0 && chars[i - 1].is_ascii_digit() && chars.get(i + 1).is_some_and(char::is_ascii_digit)
}

/// The punctuation Piper's phonemizer writes after a clause.
fn piper_punctuation(end: Option<char>) -> &'static str {
    match end {
        Some('.' | '।' | '॥' | '۔') => ".",
        Some('?' | '؟') => "?",
        Some('!') => "!",
        Some(',' | '،') => ", ",
        Some(':') => ": ",
        Some(';' | '؛') => "; ",
        _ => "",
    }
}

fn espeak_command(espeak: &Path, voice: &str) -> Command {
    let mut command = Command::new(espeak);
    command
        .args(["-q", "-b", "1", "--ipa", "-v", voice])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

/// IPA for each line of `lines` (one eSpeak NG run).
fn espeak_lines(espeak: &Path, voice: &str, lines: &[&str]) -> Result<Vec<String>, String> {
    let mut child = espeak_command(espeak, voice)
        .spawn()
        .map_err(|e| format!("Could not run eSpeak NG ({}): {e}", espeak.display()))?;
    let mut input = lines.join("\n");
    input.push('\n');
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| format!("eSpeak NG stopped: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("eSpeak NG stopped: {e}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "eSpeak NG could not read the text with voice \"{voice}\": {}",
            message.trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// The phonemes of one sentence, clause punctuation included.
pub(crate) fn phonemize(espeak: &Path, voice: &str, sentence: &[Clause]) -> Result<String, String> {
    let texts: Vec<&str> = sentence.iter().map(|(t, _)| t.as_str()).collect();
    let mut ipa = espeak_lines(espeak, voice, &texts)?;
    if ipa.len() != texts.len() {
        // eSpeak NG split or dropped a clause differently: ask clause by clause.
        ipa = texts
            .iter()
            .map(|t| espeak_lines(espeak, voice, &[t]).map(|lines| lines.join(" ")))
            .collect::<Result<_, _>>()?;
    }
    let mut out = String::new();
    for ((_, end), phonemes) in sentence.iter().zip(ipa) {
        out.push_str(&phonemes);
        out.push_str(piper_punctuation(*end));
    }
    Ok(out.trim_end().to_string())
}

/// Phoneme ids as Piper expects them: start, pad, then each phoneme followed by pad, then end.
pub(crate) fn phoneme_ids(phonemes: &str, ids: &HashMap<char, Vec<i64>>) -> Vec<i64> {
    let pad = &ids[&'_'];
    let mut out: Vec<i64> = ids[&'^'].clone();
    out.extend(pad);
    for c in phonemes.chars() {
        if let Some(id) = ids.get(&c) {
            out.extend(id);
            out.extend(pad);
        }
    }
    out.extend(&ids[&'$']);
    out
}

pub(crate) fn wav(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let data = samples.len() as u32 * 2;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

/// Speaks `options.text` with the voice in `voice_dir`; returns a mono 16-bit WAV.
/// Options: `rate` (speed, 1 = the voice's own), `speaker`, `pause` (seconds between sentences).
pub fn speak(
    engine: &mut Engine,
    voice_dir: &Path,
    espeak: &Path,
    options: &Value,
    reply: &mut Reply,
) -> Result<Frame, String> {
    let config: Value = serde_json::from_slice(
        &std::fs::read(voice_dir.join("voice.onnx.json"))
            .map_err(|e| format!("The voice is incomplete: {e}"))?,
    )
    .map_err(|e| format!("The voice's settings are damaged: {e}"))?;
    let voice = Voice::from_config(&config)?;
    let text = options
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let rate = options
        .get("rate")
        .and_then(Value::as_f64)
        .unwrap_or(1.0)
        .clamp(0.4, 3.0) as f32;
    let pause = options
        .get("pause")
        .and_then(Value::as_f64)
        .unwrap_or(0.25)
        .clamp(0.0, 3.0);
    let speaker = options
        .get("speaker")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .min(voice.speakers.saturating_sub(1) as u64) as i64;
    let list = sentences(text);
    if list.is_empty() {
        return Err("There is no text to speak.".into());
    }
    let session = engine.session(&voice_dir.join("voice.onnx"))?;
    let wants_speaker = session.inputs().iter().any(|i| i.name() == "sid");
    let silence = vec![0f32; (pause * voice.sample_rate as f64) as usize];
    let mut audio: Vec<f32> = Vec::new();
    let mut phonemes_out: Vec<String> = Vec::new();
    for (index, sentence) in list.iter().enumerate() {
        reply.progress(index as f64 / list.len() as f64, "speaking");
        let phonemes = phonemize(espeak, &voice.espeak_voice, sentence)?;
        let ids = phoneme_ids(&phonemes, &voice.ids);
        phonemes_out.push(phonemes);
        if ids.len() <= 3 {
            continue;
        }
        let count = ids.len();
        let input = Tensor::from_array(([1usize, count], ids)).map_err(|e| e.to_string())?;
        let lengths =
            Tensor::from_array(([1usize], vec![count as i64])).map_err(|e| e.to_string())?;
        let scales = Tensor::from_array((
            [3usize],
            vec![voice.noise_scale, voice.length_scale / rate, voice.noise_w],
        ))
        .map_err(|e| e.to_string())?;
        let outputs = if wants_speaker {
            let sid = Tensor::from_array(([1usize], vec![speaker])).map_err(|e| e.to_string())?;
            session.run(ort::inputs!["input" => input, "input_lengths" => lengths, "scales" => scales, "sid" => sid])
        } else {
            session.run(ort::inputs!["input" => input, "input_lengths" => lengths, "scales" => scales])
        }
        .map_err(|e| format!("The voice failed: {e}"))?;
        let (_, samples) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| e.to_string())?;
        // Each sentence at the same loudness: peak at 0.9, without boosting near-silence more than 4 times.
        let peak = samples.iter().fold(0f32, |m, s| m.max(s.abs()));
        let gain = if peak > 0.0 {
            (0.9 / peak).min(4.0)
        } else {
            1.0
        };
        if !audio.is_empty() {
            audio.extend_from_slice(&silence);
        }
        audio.extend(samples.iter().map(|s| s * gain));
    }
    reply.progress(1.0, "speaking");
    let pcm: Vec<i16> = audio
        .iter()
        .map(|s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect();
    Ok(Frame::new(json!({
        "sampleRate": voice.sample_rate,
        "seconds": pcm.len() as f64 / voice.sample_rate as f64,
        "phonemes": phonemes_out.join(" "),
    }))
    .with(wav(&pcm, voice.sample_rate)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_clauses_and_sentences_like_espeak() {
        let s = sentences("नमस्ते, संग्रहालय में आपका स्वागत है। It costs 3.5 rupees!\nNew line");
        assert_eq!(s.len(), 3);
        assert_eq!(
            s[0],
            vec![
                ("नमस्ते".to_string(), Some(',')),
                ("संग्रहालय में आपका स्वागत है".to_string(), Some('।'))
            ]
        );
        assert_eq!(s[1], vec![("It costs 3.5 rupees".to_string(), Some('!'))]);
        assert_eq!(s[2], vec![("New line".to_string(), None)]);
        assert_eq!(
            sentences("Really?!"),
            vec![vec![("Really".to_string(), Some('?'))]]
        );
        assert!(sentences("  ... ").is_empty());
        assert_eq!(sentences("1,000 people")[0][0].0, "1,000 people");
    }

    #[test]
    fn ids_follow_pipers_layout() {
        let config = json!({"phoneme_id_map": {"^": [1], "$": [2], "_": [0], "a": [14], " ": [3], ".": [10]}});
        let voice = Voice::from_config(&config).unwrap();
        assert_eq!(
            phoneme_ids("a a.", &voice.ids),
            vec![1, 0, 14, 0, 3, 0, 14, 0, 10, 0, 2]
        );
        assert_eq!(voice.sample_rate, 22_050);
        assert!(Voice::from_config(&json!({"phoneme_id_map": {"a": [1]}})).is_err());
    }

    #[test]
    fn writes_a_wav_header() {
        let bytes = wav(&[0, 1000, -1000], 16_000);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(bytes.len(), 44 + 6);
        assert_eq!(
            u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
            16_000
        );
    }

    /// Runs where eSpeak NG is installed (skipped otherwise).
    #[test]
    fn phonemizes_with_espeak_when_installed() {
        let Ok(espeak) = which::which("espeak-ng") else {
            return;
        };
        let p = phonemize(&espeak, "hi", &sentences("नमस्ते, स्वागत है।")[0]).unwrap();
        assert!(p.contains(", "), "{p}");
        assert!(p.ends_with('.'), "{p}");
        assert!(p.contains('ə') || p.contains('a'), "{p}");
    }
}
