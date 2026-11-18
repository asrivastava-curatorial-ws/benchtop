//! The file converter and the video, audio and PDF recipes.  They run programs
//! already installed on this computer (FFmpeg, LibreOffice, Pandoc,
//! ImageMagick, Inkscape, Calibre, qpdf, Ghostscript) with argument lists built
//! here from a fixed set of recipes: the page chooses a recipe and options, and
//! every option is checked and converted before it reaches a command line.  No
//! shell is involved, and input files are only ever named by picked-file tokens.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::files::PickedFiles;

/// Running jobs by id, so each tool can stop its own.
#[derive(Default)]
pub struct ConvertState {
    running: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    cancelled: Mutex<HashSet<String>>,
}

/// A command that does not open a console window on Windows.
fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

/// (program id, executable names in order of preference)
pub(crate) const PROGRAMS: &[(&str, &[&str])] = &[
    ("ffmpeg", &["ffmpeg"]),
    ("ffprobe", &["ffprobe"]),
    ("libreoffice", &["soffice", "libreoffice"]),
    ("pandoc", &["pandoc"]),
    ("imagemagick", &["magick", "convert"]),
    ("inkscape", &["inkscape"]),
    ("calibre", &["ebook-convert"]),
    ("qpdf", &["qpdf"]),
    ("ghostscript", &["gs", "gswin64c", "gswin32c"]),
];

fn known_locations(id: &str) -> Vec<PathBuf> {
    let mut list = Vec::new();
    if cfg!(target_os = "macos") {
        match id {
            "libreoffice" => {
                list.push("/Applications/LibreOffice.app/Contents/MacOS/soffice".into())
            }
            "inkscape" => list.push("/Applications/Inkscape.app/Contents/MacOS/inkscape".into()),
            "calibre" => list.push("/Applications/calibre.app/Contents/MacOS/ebook-convert".into()),
            _ => {}
        }
        for prefix in ["/opt/homebrew/bin", "/usr/local/bin"] {
            for (pid, names) in PROGRAMS {
                if *pid == id {
                    list.extend(names.iter().map(|name| Path::new(prefix).join(name)));
                }
            }
        }
    }
    if cfg!(target_os = "windows") {
        for base in [
            std::env::var_os("ProgramFiles"),
            std::env::var_os("ProgramFiles(x86)"),
        ]
        .into_iter()
        .flatten()
        {
            let base = PathBuf::from(base);
            match id {
                "libreoffice" => {
                    list.push(base.join("LibreOffice").join("program").join("soffice.exe"))
                }
                "inkscape" => list.push(base.join("Inkscape").join("bin").join("inkscape.exe")),
                "calibre" => list.push(base.join("Calibre2").join("ebook-convert.exe")),
                "pandoc" => list.push(base.join("Pandoc").join("pandoc.exe")),
                "ghostscript" => {
                    if let Ok(entries) = std::fs::read_dir(base.join("gs")) {
                        for entry in entries.flatten() {
                            list.push(entry.path().join("bin").join("gswin64c.exe"));
                        }
                    }
                }
                _ => {}
            }
        }
    }
    list
}

/// Finds a program: an override in BENCHTOP_<ID>, then PATH, then the usual install folders.
pub fn find_program(id: &str) -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(format!("BENCHTOP_{}", id.to_uppercase())) {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    let names = PROGRAMS.iter().find(|(pid, _)| *pid == id)?.1;
    for name in names {
        // Windows ships an unrelated convert.exe (it converts file systems).
        if cfg!(target_os = "windows") && *name == "convert" {
            continue;
        }
        if let Ok(path) = which::which(name) {
            return Some(path);
        }
    }
    known_locations(id).into_iter().find(|path| path.is_file())
}

#[tauri::command]
pub fn convert_programs() -> Value {
    let programs: HashMap<&str, Option<String>> = PROGRAMS
        .iter()
        .map(|(id, _)| {
            (
                *id,
                find_program(id).map(|p| p.to_string_lossy().into_owned()),
            )
        })
        .collect();
    json!({ "programs": programs, "os": std::env::consts::OS })
}

/* -------------------------------------------------------------- options -- */

fn text<'a>(options: &'a Value, key: &str, default: &'a str) -> &'a str {
    options.get(key).and_then(Value::as_str).unwrap_or(default)
}

fn number(options: &Value, key: &str, default: f64, min: f64, max: f64) -> f64 {
    let value = options
        .get(key)
        .and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
        })
        .unwrap_or(default);
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        default
    }
}

fn flag(options: &Value, key: &str) -> bool {
    options.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// One of a fixed set of words; anything else becomes the first.
fn choice<'a>(options: &Value, key: &str, allowed: &[&'a str]) -> &'a str {
    let value = text(options, key, "");
    allowed
        .iter()
        .find(|a| **a == value)
        .copied()
        .unwrap_or(allowed[0])
}

/// "90", "1:30", "01:02:03.5" → seconds.
fn time(options: &Value, key: &str) -> Result<Option<f64>, String> {
    let raw = match options.get(key) {
        Some(Value::Number(n)) => return Ok(n.as_f64().filter(|v| v.is_finite() && *v >= 0.0)),
        Some(Value::String(s)) if !s.trim().is_empty() => s.trim().to_string(),
        _ => return Ok(None),
    };
    let mut seconds = 0.0;
    for part in raw.split(':') {
        let value: f64 = part
            .trim()
            .parse()
            .map_err(|_| format!("\"{raw}\" is not a time. Use seconds or h:mm:ss."))?;
        if !(0.0..1e7).contains(&value) {
            return Err(format!("\"{raw}\" is not a time."));
        }
        seconds = seconds * 60.0 + value;
    }
    Ok(Some(seconds))
}

fn colour(options: &Value, key: &str, default: &str) -> String {
    let value = text(options, key, default);
    if value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        value[1..].to_string()
    } else {
        default.trim_start_matches('#').to_string()
    }
}

fn secs(value: f64) -> String {
    format!("{value:.3}")
}

/* ----------------------------------------------------------------- plans -- */

enum Runner {
    /// FFmpeg with -progress on stdout.
    Ffmpeg,
    /// A program that writes the output file we name.
    Direct,
    /// A program that writes into a folder (LibreOffice); the file to keep is found afterwards.
    Folder { produced: String },
}

pub(crate) struct Plan {
    program: PathBuf,
    args: Vec<OsString>,
    pub(crate) ext: String,
    pub(crate) suffix: String,
    runner: Runner,
    /// Expected output duration in seconds, for progress.
    duration: Option<f64>,
    cwd: Option<PathBuf>,
    /// Scratch folder removed afterwards.
    pub(crate) scratch: Option<PathBuf>,
}

/// The output path placeholder in argument lists, replaced when the destination is known.
const OUT: &str = "\u{0}OUT\u{0}";

struct Probe {
    duration: Option<f64>,
    width: Option<u64>,
    height: Option<u64>,
    audio: bool,
    video: bool,
}

fn probe(path: &Path) -> Probe {
    let mut result = Probe {
        duration: None,
        width: None,
        height: None,
        audio: false,
        video: false,
    };
    let Some(ffprobe) = find_program("ffprobe") else {
        return result;
    };
    let output = command(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .output();
    let Ok(output) = output else { return result };
    let Ok(info) = serde_json::from_slice::<Value>(&output.stdout) else {
        return result;
    };
    result.duration = info
        .pointer("/format/duration")
        .and_then(Value::as_str)
        .and_then(|s| s.parse().ok());
    for stream in info
        .get("streams")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        match stream.get("codec_type").and_then(Value::as_str) {
            Some("audio") => result.audio = true,
            Some("video") => {
                if !result.video {
                    result.width = stream.get("width").and_then(Value::as_u64);
                    result.height = stream.get("height").and_then(Value::as_u64);
                }
                result.video = true;
            }
            _ => {}
        }
    }
    result
}

fn need(id: &str, name: &str) -> Result<PathBuf, String> {
    find_program(id).ok_or_else(|| format!("{name} is not installed. Install it (see the list of programs in this tool) and try again."))
}

fn os(items: &[&str]) -> Vec<OsString> {
    items.iter().map(OsString::from).collect()
}

/// Audio encoder arguments for a container or audio format.
fn audio_codec(ext: &str, bitrate: u32) -> Vec<OsString> {
    let rate = format!("{bitrate}k");
    match ext {
        "mp3" => os(&["-c:a", "libmp3lame", "-b:a", &rate]),
        "wav" => os(&["-c:a", "pcm_s16le"]),
        "flac" => os(&["-c:a", "flac"]),
        "ogg" => os(&["-c:a", "libvorbis", "-b:a", &rate]),
        "opus" | "webm" => os(&["-c:a", "libopus", "-b:a", &rate]),
        "avi" => os(&["-c:a", "libmp3lame", "-b:a", &rate]),
        _ => os(&["-c:a", "aac", "-b:a", &rate]),
    }
}

fn video_codec(ext: &str, crf: f64, preset: &str) -> Vec<OsString> {
    let crf = format!("{}", crf.round() as i64);
    match ext {
        "webm" => os(&[
            "-c:v",
            "libvpx-vp9",
            "-crf",
            &crf,
            "-b:v",
            "0",
            "-row-mt",
            "1",
        ]),
        "avi" => os(&["-c:v", "mpeg4", "-q:v", "4"]),
        _ => os(&[
            "-c:v", "libx264", "-preset", preset, "-crf", &crf, "-pix_fmt", "yuv420p",
        ]),
    }
}

const AUDIO_OUT: &[&str] = &["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"];

/// atempo accepts 0.5–2 per stage, so larger changes are chained.
fn atempo(mut factor: f64) -> String {
    let mut parts = Vec::new();
    while factor > 2.0 {
        parts.push("atempo=2.0".to_string());
        factor /= 2.0;
    }
    while factor < 0.5 {
        parts.push("atempo=0.5".to_string());
        factor /= 0.5;
    }
    parts.push(format!("atempo={factor:.4}"));
    parts.join(",")
}

fn ffmpeg_base(inputs: &[PathBuf]) -> Result<(PathBuf, Vec<OsString>), String> {
    let program = need("ffmpeg", "FFmpeg")?;
    let mut args = os(&[
        "-hide_banner",
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-nostats",
    ]);
    for input in inputs {
        args.push("-i".into());
        args.push(input.into());
    }
    Ok((program, args))
}

fn finish(mut args: Vec<OsString>) -> Vec<OsString> {
    args.push(OUT.into());
    args
}

pub(crate) fn plan(recipe: &str, inputs: &[PathBuf], o: &Value) -> Result<Plan, String> {
    let first = inputs.first().ok_or("Choose a file first.")?;
    let ffmpeg = |args: Vec<OsString>,
                  ext: &str,
                  suffix: &str,
                  duration: Option<f64>|
     -> Result<Plan, String> {
        let (program, mut base) = ffmpeg_base(inputs)?;
        base.extend(args);
        Ok(Plan {
            program,
            args: finish(base),
            ext: ext.into(),
            suffix: suffix.into(),
            runner: Runner::Ffmpeg,
            duration,
            cwd: None,
            scratch: None,
        })
    };
    let info = || probe(first);
    match recipe {
        /* ---------------------------------------------------- media -- */
        "media-convert" => {
            let to = choice(
                o,
                "to",
                &[
                    "mp4", "mkv", "webm", "mov", "avi", "gif", "mp3", "m4a", "aac", "wav", "flac",
                    "ogg", "opus",
                ],
            );
            let crf = number(o, "crf", 23.0, 0.0, 51.0);
            let bitrate = number(o, "bitrate", 192.0, 32.0, 512.0) as u32;
            let p = info();
            let mut args = Vec::new();
            if to == "gif" {
                args.extend(os(&["-filter_complex", "fps=12,scale=480:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0"]));
            } else if AUDIO_OUT.contains(&to) {
                args.push("-vn".into());
                args.extend(audio_codec(to, bitrate));
            } else {
                args.extend(video_codec(to, crf, "veryfast"));
                args.extend(audio_codec(to, bitrate));
                if to == "mp4" || to == "mov" {
                    args.extend(os(&["-movflags", "+faststart"]));
                }
            }
            ffmpeg(args, to, "", p.duration)
        }
        "video-compress" => {
            let p = info();
            let crf = number(o, "crf", 28.0, 18.0, 40.0);
            let preset = choice(o, "preset", &["medium", "veryfast", "slow"]);
            let height = number(o, "height", 0.0, 0.0, 4320.0) as u64;
            let mut args = video_codec("mp4", crf, preset);
            if height > 0 && p.height.is_some_and(|h| h > height) {
                args.extend(os(&["-vf", &format!("scale=-2:{height}")]));
            }
            args.extend(audio_codec(
                "mp4",
                number(o, "bitrate", 128.0, 32.0, 320.0) as u32,
            ));
            args.extend(os(&["-movflags", "+faststart"]));
            ffmpeg(args, "mp4", " (compressed)", p.duration)
        }
        "video-trim" | "audio-trim" => {
            let p = info();
            let start = time(o, "start")?.unwrap_or(0.0);
            let end = time(o, "end")?;
            if let Some(end) = end {
                if end <= start {
                    return Err("The end must be after the start.".into());
                }
            }
            let length = end
                .map(|e| e - start)
                .or(p.duration.map(|d| (d - start).max(0.0)));
            let exact = flag(o, "exact");
            let mut ext = Path::new(first)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("mp4")
                .to_lowercase();
            if exact && recipe == "audio-trim" {
                ext = audio_ext(first);
            } else if exact {
                ext = video_ext(first, false);
            }
            let (program, mut args) = (
                need("ffmpeg", "FFmpeg")?,
                os(&[
                    "-hide_banner",
                    "-nostdin",
                    "-y",
                    "-loglevel",
                    "error",
                    "-progress",
                    "pipe:1",
                    "-nostats",
                ]),
            );
            args.extend(os(&["-ss", &secs(start)]));
            args.push("-i".into());
            args.push(first.into());
            if let Some(length) = end.map(|e| e - start) {
                args.extend(os(&["-t", &secs(length)]));
            }
            if exact {
                if recipe == "video-trim" {
                    args.extend(video_codec(&ext, 20.0, "veryfast"));
                }
                args.extend(audio_codec(&ext, 192));
            } else {
                args.extend(os(&["-c", "copy", "-avoid_negative_ts", "make_zero"]));
            }
            Ok(Plan {
                program,
                args: finish(args),
                ext,
                suffix: " (trimmed)".into(),
                runner: Runner::Ffmpeg,
                duration: length,
                cwd: None,
                scratch: None,
            })
        }
        "video-resize" => {
            let width = number(o, "width", 1280.0, 0.0, 7680.0) as i64;
            let height = number(o, "height", 0.0, 0.0, 4320.0) as i64;
            if width == 0 && height == 0 {
                return Err("Enter a width, a height or both.".into());
            }
            let w = if width > 0 {
                (width / 2 * 2).to_string()
            } else {
                "-2".into()
            };
            let h = if height > 0 {
                (height / 2 * 2).to_string()
            } else {
                "-2".into()
            };
            let mut args = os(&["-vf", &format!("scale={w}:{h}:flags=lanczos")]);
            args.extend(video_codec("mp4", 20.0, "veryfast"));
            args.extend(os(&["-c:a", "copy", "-movflags", "+faststart"]));
            ffmpeg(args, "mp4", " (resized)", info().duration)
        }
        "video-crop" => {
            let x = number(o, "x", 0.0, 0.0, 16000.0) as i64;
            let y = number(o, "y", 0.0, 0.0, 16000.0) as i64;
            let w = number(o, "w", 640.0, 2.0, 16000.0) as i64 / 2 * 2;
            let h = number(o, "h", 360.0, 2.0, 16000.0) as i64 / 2 * 2;
            let mut args = os(&["-vf", &format!("crop={w}:{h}:{x}:{y}")]);
            args.extend(video_codec("mp4", 20.0, "veryfast"));
            args.extend(os(&["-c:a", "copy", "-movflags", "+faststart"]));
            ffmpeg(args, "mp4", " (cropped)", info().duration)
        }
        "video-rotate" => {
            let filter = match choice(o, "turn", &["90", "180", "270", "hflip", "vflip"]) {
                "90" => "transpose=1",
                "180" => "transpose=1,transpose=1",
                "270" => "transpose=2",
                "hflip" => "hflip",
                _ => "vflip",
            };
            let mut args = os(&["-vf", filter]);
            args.extend(video_codec("mp4", 20.0, "veryfast"));
            args.extend(os(&["-c:a", "copy", "-movflags", "+faststart"]));
            ffmpeg(args, "mp4", " (rotated)", info().duration)
        }
        "video-speed" | "audio-speed" => {
            let factor = number(o, "factor", 1.5, 0.25, 4.0);
            let p = info();
            let ext = if recipe == "audio-speed" {
                audio_ext(first)
            } else {
                "mp4".into()
            };
            let mut args = Vec::new();
            if recipe == "video-speed" {
                args.extend(os(&["-vf", &format!("setpts=PTS/{factor:.4}")]));
                args.extend(video_codec("mp4", 20.0, "veryfast"));
            }
            // Harmless when there is no sound track.
            args.extend(os(&["-af", &atempo(factor)]));
            args.extend(audio_codec(&ext, 192));
            ffmpeg(
                args,
                &ext,
                &format!(" ({factor}x)"),
                p.duration.map(|d| d / factor),
            )
        }
        "video-fps" => {
            let fps = number(o, "fps", 30.0, 1.0, 240.0);
            let mut args = os(&["-vf", &format!("fps={fps}")]);
            args.extend(video_codec("mp4", 20.0, "veryfast"));
            args.extend(os(&["-c:a", "copy"]));
            ffmpeg(args, "mp4", &format!(" ({fps} fps)"), info().duration)
        }
        "video-extract-audio" => {
            let to = choice(o, "to", &["mp3", "m4a", "wav", "flac", "ogg", "opus"]);
            let mut args = os(&["-vn"]);
            args.extend(audio_codec(
                to,
                number(o, "bitrate", 192.0, 32.0, 512.0) as u32,
            ));
            ffmpeg(args, to, "", info().duration)
        }
        "video-mute" => ffmpeg(
            os(&["-an", "-c:v", "copy"]),
            &video_ext(first, true),
            " (no sound)",
            info().duration,
        ),
        "video-gif" => {
            let fps = number(o, "fps", 12.0, 2.0, 30.0);
            let width = number(o, "width", 480.0, 64.0, 1920.0) as i64;
            let filter = format!("fps={fps},scale={width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4");
            ffmpeg(
                os(&["-filter_complex", &filter, "-loop", "0"]),
                "gif",
                "",
                info().duration,
            )
        }
        "video-frame" => {
            let at = time(o, "at")?.unwrap_or(0.0);
            let (program, mut args) = (
                need("ffmpeg", "FFmpeg")?,
                os(&["-hide_banner", "-nostdin", "-y", "-loglevel", "error"]),
            );
            args.extend(os(&["-ss", &secs(at)]));
            args.push("-i".into());
            args.push(first.into());
            args.extend(os(&["-frames:v", "1", "-update", "1"]));
            Ok(Plan {
                program,
                args: finish(args),
                ext: "png".into(),
                suffix: format!(" (frame at {at}s)"),
                runner: Runner::Direct,
                duration: None,
                cwd: None,
                scratch: None,
            })
        }
        "video-merge" => {
            if inputs.len() < 2 {
                return Err("Choose at least two videos to join.".into());
            }
            let probes: Vec<Probe> = inputs.iter().map(|p| probe(p)).collect();
            let (w, h) = (
                probes[0].width.unwrap_or(1280) / 2 * 2,
                probes[0].height.unwrap_or(720) / 2 * 2,
            );
            let with_audio = probes.iter().all(|p| p.audio);
            let mut filter = String::new();
            let mut joins = String::new();
            for i in 0..inputs.len() {
                filter.push_str(&format!("[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}];"));
                joins.push_str(&format!("[v{i}]"));
                if with_audio {
                    filter.push_str(&format!("[{i}:a]aresample=48000[a{i}];"));
                    joins.push_str(&format!("[a{i}]"));
                }
            }
            filter.push_str(&format!(
                "{joins}concat=n={}:v=1:a={}[v]{}",
                inputs.len(),
                u8::from(with_audio),
                if with_audio { "[a]" } else { "" }
            ));
            let mut args = os(&["-filter_complex", &filter, "-map", "[v]"]);
            if with_audio {
                args.extend(os(&["-map", "[a]"]));
                args.extend(audio_codec("mp4", 192));
            }
            args.extend(video_codec("mp4", 20.0, "veryfast"));
            args.extend(os(&["-movflags", "+faststart"]));
            ffmpeg(
                args,
                "mp4",
                " (joined)",
                Some(probes.iter().filter_map(|p| p.duration).sum()),
            )
        }
        "video-burn-subtitles" | "video-add-subtitles" => {
            let subs = inputs
                .get(1)
                .ok_or("Choose the subtitle file (.srt, .vtt or .ass) too.")?;
            let sub_ext = subs
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("srt")
                .to_lowercase();
            if !["srt", "vtt", "ass", "ssa"].contains(&sub_ext.as_str()) {
                return Err("Subtitles must be .srt, .vtt or .ass.".into());
            }
            let p = info();
            if recipe == "video-add-subtitles" {
                let to = choice(o, "to", &["mp4", "mkv"]);
                let codec = if to == "mp4" { "mov_text" } else { "srt" };
                let (program, mut args) = ffmpeg_base(inputs)?;
                args.extend(os(&[
                    "-map",
                    "0",
                    "-map",
                    "1",
                    "-c",
                    "copy",
                    "-c:s",
                    codec,
                    "-metadata:s:s:0",
                    "language=eng",
                ]));
                return Ok(Plan {
                    program,
                    args: finish(args),
                    ext: to.into(),
                    suffix: " (subtitled)".into(),
                    runner: Runner::Ffmpeg,
                    duration: p.duration,
                    cwd: None,
                    scratch: None,
                });
            }
            // The subtitles filter takes a path inside a filter graph, where ':' and '\' need escaping.
            // Copying the file to a scratch folder and running there keeps the name plain on every OS.
            let scratch = scratch_dir()?;
            let local = format!("subs.{sub_ext}");
            std::fs::copy(subs, scratch.join(&local))
                .map_err(|e| format!("Could not read the subtitles: {e}"))?;
            let size = number(o, "size", 24.0, 8.0, 96.0) as i64;
            let (program, mut args) = (
                need("ffmpeg", "FFmpeg")?,
                os(&[
                    "-hide_banner",
                    "-nostdin",
                    "-y",
                    "-loglevel",
                    "error",
                    "-progress",
                    "pipe:1",
                    "-nostats",
                ]),
            );
            args.push("-i".into());
            args.push(first.into());
            let style = if sub_ext == "ass" || sub_ext == "ssa" {
                String::new()
            } else {
                format!(":force_style='FontSize={size},Outline=2'")
            };
            args.extend(os(&["-vf", &format!("subtitles={local}{style}")]));
            args.extend(video_codec("mp4", 20.0, "veryfast"));
            args.extend(os(&["-c:a", "copy", "-movflags", "+faststart"]));
            Ok(Plan {
                program,
                args: finish(args),
                ext: "mp4".into(),
                suffix: " (subtitles)".into(),
                runner: Runner::Ffmpeg,
                duration: p.duration,
                cwd: Some(scratch.clone()),
                scratch: Some(scratch),
            })
        }
        "video-watermark" => {
            if inputs.len() < 2 {
                return Err("Choose the logo or watermark picture too.".into());
            }
            let corner = choice(
                o,
                "position",
                &[
                    "bottom-right",
                    "bottom-left",
                    "top-right",
                    "top-left",
                    "centre",
                ],
            );
            let margin = number(o, "margin", 24.0, 0.0, 500.0) as i64;
            let share = number(o, "size", 15.0, 2.0, 80.0) / 100.0;
            let opacity = number(o, "opacity", 80.0, 5.0, 100.0) / 100.0;
            let at = match corner {
                "bottom-left" => format!("{margin}:H-h-{margin}"),
                "top-right" => format!("W-w-{margin}:{margin}"),
                "top-left" => format!("{margin}:{margin}"),
                "centre" => "(W-w)/2:(H-h)/2".to_string(),
                _ => format!("W-w-{margin}:H-h-{margin}"),
            };
            let p = info();
            let logo_height = ((p.height.unwrap_or(720) as f64 * share).round() as i64).max(2);
            let filter = format!("[1:v]scale=-2:{logo_height},format=rgba,colorchannelmixer=aa={opacity:.2}[logo];[0:v][logo]overlay={at}:format=auto,format=yuv420p");
            let mut args = os(&["-filter_complex", &filter]);
            args.extend(video_codec("mp4", 20.0, "veryfast"));
            args.extend(os(&["-c:a", "copy", "-movflags", "+faststart"]));
            ffmpeg(args, "mp4", " (watermarked)", p.duration)
        }
        "video-volume" | "audio-volume" => {
            let db = number(o, "db", 6.0, -60.0, 30.0);
            let ext = if recipe == "audio-volume" {
                audio_ext(first)
            } else {
                video_ext(first, true)
            };
            let mut args = os(&["-af", &format!("volume={db}dB")]);
            if recipe == "video-volume" {
                args.extend(os(&["-c:v", "copy"]));
            }
            args.extend(audio_codec(&ext, 192));
            ffmpeg(args, &ext, &format!(" ({db:+}dB)"), info().duration)
        }
        /* ---------------------------------------------------- audio -- */
        "audio-convert" => {
            let to = choice(o, "to", AUDIO_OUT);
            let mut args = os(&["-vn"]);
            args.extend(audio_codec(
                to,
                number(o, "bitrate", 192.0, 32.0, 512.0) as u32,
            ));
            let rate = number(o, "rate", 0.0, 0.0, 192000.0) as u32;
            if rate > 0 {
                args.extend(os(&["-ar", &rate.to_string()]));
            }
            match choice(o, "channels", &["keep", "mono", "stereo"]) {
                "mono" => args.extend(os(&["-ac", "1"])),
                "stereo" => args.extend(os(&["-ac", "2"])),
                _ => {}
            }
            ffmpeg(args, to, "", info().duration)
        }
        "audio-normalize" => {
            let target = number(o, "lufs", -16.0, -36.0, -5.0);
            let ext = audio_ext(first);
            let mut args = os(&["-vn", "-af", &format!("loudnorm=I={target}:TP=-1.5:LRA=11")]);
            args.extend(audio_codec(&ext, 192));
            ffmpeg(args, &ext, " (normalised)", info().duration)
        }
        "audio-fade" => {
            let p = info();
            let fade_in = number(o, "in", 2.0, 0.0, 600.0);
            let fade_out = number(o, "out", 3.0, 0.0, 600.0);
            let mut filters = Vec::new();
            if fade_in > 0.0 {
                filters.push(format!("afade=t=in:st=0:d={fade_in}"));
            }
            if fade_out > 0.0 {
                let duration = p.duration.ok_or(
                    "The length of this file could not be read, so the fade-out cannot be placed.",
                )?;
                filters.push(format!(
                    "afade=t=out:st={}:d={fade_out}",
                    secs((duration - fade_out).max(0.0))
                ));
            }
            let ext = audio_ext(first);
            let mut args = os(&["-vn", "-af", &filters.join(",")]);
            args.extend(audio_codec(&ext, 192));
            ffmpeg(args, &ext, " (faded)", p.duration)
        }
        "audio-silence" => {
            let threshold = number(o, "threshold", -45.0, -90.0, -10.0);
            let gap = number(o, "gap", 0.5, 0.05, 10.0);
            let ext = audio_ext(first);
            let filter = format!("silenceremove=start_periods=1:start_threshold={threshold}dB:stop_periods=-1:stop_duration={gap}:stop_threshold={threshold}dB");
            let mut args = os(&["-vn", "-af", &filter]);
            args.extend(audio_codec(&ext, 192));
            ffmpeg(args, &ext, " (silence removed)", info().duration)
        }
        "audio-denoise" => {
            let strength = number(o, "strength", 12.0, 1.0, 40.0);
            let ext = audio_ext(first);
            let mut args = os(&[
                "-vn",
                "-af",
                &format!("highpass=f=60,afftdn=nr={strength}:nf=-30:tn=1"),
            ]);
            args.extend(audio_codec(&ext, 192));
            ffmpeg(args, &ext, " (cleaned)", info().duration)
        }
        "audio-merge" => {
            if inputs.len() < 2 {
                return Err("Choose at least two audio files to join.".into());
            }
            let to = choice(o, "to", AUDIO_OUT);
            let mut filter = String::new();
            for i in 0..inputs.len() {
                filter.push_str(&format!(
                    "[{i}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}];"
                ));
            }
            for i in 0..inputs.len() {
                filter.push_str(&format!("[a{i}]"));
            }
            filter.push_str(&format!("concat=n={}:v=0:a=1[a]", inputs.len()));
            let mut args = os(&["-filter_complex", &filter, "-map", "[a]"]);
            args.extend(audio_codec(to, 192));
            let total = inputs.iter().filter_map(|p| probe(p).duration).sum();
            ffmpeg(args, to, " (joined)", Some(total))
        }
        "audio-waveform" | "audio-spectrogram" => {
            let colour = colour(o, "colour", "#53c9a0");
            let filter = if recipe == "audio-waveform" {
                format!("showwavespic=s=1800x420:split_channels=0:colors=0x{colour}")
            } else {
                "showspectrumpic=s=1600x800:legend=1:color=intensity".to_string()
            };
            let (program, mut args) = (
                need("ffmpeg", "FFmpeg")?,
                os(&["-hide_banner", "-nostdin", "-y", "-loglevel", "error"]),
            );
            args.push("-i".into());
            args.push(first.into());
            args.extend(os(&["-filter_complex", &filter, "-frames:v", "1"]));
            Ok(Plan {
                program,
                args: finish(args),
                ext: "png".into(),
                suffix: if recipe == "audio-waveform" {
                    " (waveform)".into()
                } else {
                    " (spectrogram)".into()
                },
                runner: Runner::Direct,
                duration: None,
                cwd: None,
                scratch: None,
            })
        }
        /* ------------------------------------------------- documents -- */
        "document" => {
            let program = need("libreoffice", "LibreOffice")?;
            let to = choice(
                o,
                "to",
                &[
                    "pdf", "docx", "odt", "rtf", "txt", "html", "xlsx", "ods", "csv", "pptx",
                    "odp", "png",
                ],
            );
            let filter = match to {
                "txt" => "txt:Text (encoded):UTF8".to_string(),
                "csv" => "csv:Text - txt - csv (StarCalc):44,34,76,1".to_string(),
                "html" => "html:XHTML Writer File:UTF8".to_string(),
                other => other.to_string(),
            };
            let scratch = scratch_dir()?;
            let profile = scratch.join("profile");
            let profile_url = url::Url::from_directory_path(&profile)
                .map(|u| u.to_string())
                .map_err(|_| "Could not prepare LibreOffice.".to_string())?;
            let mut args: Vec<OsString> =
                vec![format!("-env:UserInstallation={profile_url}").into()];
            args.extend(os(&[
                "--headless",
                "--norestore",
                "--nolockcheck",
                "--convert-to",
                &filter,
                "--outdir",
            ]));
            args.push(scratch.join("out").into());
            args.push(first.into());
            let stem = first
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("document")
                .to_string();
            Ok(Plan {
                program,
                args,
                ext: to.into(),
                suffix: String::new(),
                runner: Runner::Folder {
                    produced: format!("out/{stem}.{to}"),
                },
                duration: None,
                cwd: None,
                scratch: Some(scratch),
            })
        }
        "markup" => {
            let program = need("pandoc", "Pandoc")?;
            let to = choice(
                o,
                "to",
                &[
                    "html",
                    "md",
                    "docx",
                    "odt",
                    "rtf",
                    "epub",
                    "rst",
                    "tex",
                    "txt",
                    "org",
                    "mediawiki",
                    "textile",
                    "asciidoc",
                    "pptx",
                ],
            );
            let mut args: Vec<OsString> = Vec::new();
            let from_ext = first
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if from_ext == "txt" || from_ext == "markdown" {
                args.extend(os(&["-f", "markdown"]));
            }
            let writer = match to {
                "md" => "gfm",
                "txt" => "plain",
                "tex" => "latex",
                other => other,
            };
            args.extend(os(&["-t", writer, "--standalone"]));
            args.push(first.into());
            args.push("-o".into());
            args.push(OUT.into());
            Ok(Plan {
                program,
                args,
                ext: to.into(),
                suffix: String::new(),
                runner: Runner::Direct,
                duration: None,
                cwd: None,
                scratch: None,
            })
        }
        "image" => {
            let program = need("imagemagick", "ImageMagick")?;
            let to = choice(
                o,
                "to",
                &[
                    "png", "jpg", "webp", "gif", "bmp", "tiff", "ico", "avif", "heic", "pdf",
                ],
            );
            let mut args: Vec<OsString> = Vec::new();
            let multi = matches!(
                first
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(str::to_lowercase)
                    .as_deref(),
                Some("pdf" | "psd" | "tif" | "tiff" | "ico")
            );
            let mut input: OsString = first.into();
            if multi && to != "pdf" && to != "gif" && to != "tiff" {
                input.push("[0]");
            }
            args.push(input);
            let size = number(o, "size", 0.0, 0.0, 20000.0) as u32;
            if size > 0 {
                args.extend(os(&["-resize", &format!("{size}x{size}>")]));
            }
            if to == "ico" {
                args.extend(os(&["-define", "icon:auto-resize=256,128,64,48,32,16"]));
            }
            if flag(o, "strip") {
                args.push("-strip".into());
            }
            args.extend(os(&[
                "-quality",
                &format!("{}", number(o, "quality", 85.0, 1.0, 100.0) as u32),
            ]));
            Ok(Plan {
                program,
                args: finish(args),
                ext: to.into(),
                suffix: String::new(),
                runner: Runner::Direct,
                duration: None,
                cwd: None,
                scratch: None,
            })
        }
        "vector" => {
            let program = need("inkscape", "Inkscape")?;
            let to = choice(o, "to", &["png", "pdf", "svg", "eps", "emf", "ps"]);
            let mut args: Vec<OsString> = vec![first.into(), format!("--export-type={to}").into()];
            if to == "png" {
                args.push(
                    format!(
                        "--export-dpi={}",
                        number(o, "dpi", 192.0, 24.0, 1200.0) as u32
                    )
                    .into(),
                );
            }
            if to == "svg" {
                args.push("--export-plain-svg".into());
            }
            let mut out: OsString = "--export-filename=".into();
            out.push(OUT);
            args.push(out);
            Ok(Plan {
                program,
                args,
                ext: to.into(),
                suffix: String::new(),
                runner: Runner::Direct,
                duration: None,
                cwd: None,
                scratch: None,
            })
        }
        "ebook" => {
            let program = need("calibre", "Calibre (ebook-convert)")?;
            let to = choice(
                o,
                "to",
                &["epub", "mobi", "azw3", "pdf", "docx", "txt", "fb2", "htmlz"],
            );
            Ok(Plan {
                program,
                args: vec![first.into(), OUT.into()],
                ext: to.into(),
                suffix: String::new(),
                runner: Runner::Direct,
                duration: None,
                cwd: None,
                scratch: None,
            })
        }
        /* -------------------------------------------------------- PDF -- */
        "pdf-protect" | "pdf-unlock" | "pdf-optimise" => {
            let program = need("qpdf", "qpdf")?;
            // Passwords go in an argument file, so they never appear in the process list.
            let scratch = scratch_dir()?;
            let mut lines: Vec<String> = Vec::new();
            match recipe {
                "pdf-protect" => {
                    let user = text(o, "password", "");
                    if user.is_empty() {
                        return Err("Enter a password.".into());
                    }
                    let owner = text(o, "ownerPassword", "");
                    // The positional form works with qpdf 10 and 11.
                    lines.push("--encrypt".into());
                    lines.push(user.to_string());
                    lines.push(if owner.is_empty() {
                        user.to_string()
                    } else {
                        owner.to_string()
                    });
                    lines.push("256".into());
                    if flag(o, "noPrint") {
                        lines.push("--print=none".into());
                    }
                    if flag(o, "noCopy") {
                        lines.push("--extract=n".into());
                    }
                    if flag(o, "noEdit") {
                        lines.push("--modify=none".into());
                    }
                    lines.push("--".into());
                }
                "pdf-unlock" => {
                    lines.push(format!("--password={}", text(o, "password", "")));
                    lines.push("--decrypt".into());
                }
                _ => {
                    lines.extend(
                        [
                            "--object-streams=generate",
                            "--compress-streams=y",
                            "--recompress-flate",
                            "--compression-level=9",
                        ]
                        .map(String::from),
                    );
                    if flag(o, "linearize") {
                        lines.push("--linearize".into());
                    }
                }
            }
            if lines.iter().any(|l| l.contains('\n')) {
                return Err("Passwords cannot contain line breaks.".into());
            }
            let argfile = scratch.join("args");
            write_private(&argfile, &lines.join("\n"))?;
            let mut at: OsString = "@".into();
            at.push(&argfile);
            let suffix = match recipe {
                "pdf-protect" => " (protected)",
                "pdf-unlock" => " (unlocked)",
                _ => " (optimised)",
            };
            Ok(Plan {
                program,
                args: vec![at, first.into(), OUT.into()],
                ext: "pdf".into(),
                suffix: suffix.into(),
                runner: Runner::Direct,
                duration: None,
                cwd: None,
                scratch: Some(scratch),
            })
        }
        "pdf-compress" => {
            let program = need("ghostscript", "Ghostscript")?;
            let quality = choice(o, "quality", &["ebook", "screen", "printer", "prepress"]);
            let mut args = os(&[
                "-sDEVICE=pdfwrite",
                "-dCompatibilityLevel=1.6",
                &format!("-dPDFSETTINGS=/{quality}"),
                "-dNOPAUSE",
                "-dQUIET",
                "-dBATCH",
                "-dSAFER",
                "-dDetectDuplicateImages=true",
            ]);
            let mut out: OsString = "-sOutputFile=".into();
            out.push(OUT);
            args.push(out);
            args.push(first.into());
            Ok(Plan {
                program,
                args,
                ext: "pdf".into(),
                suffix: " (smaller)".into(),
                runner: Runner::Direct,
                duration: None,
                cwd: None,
                scratch: None,
            })
        }
        other => Err(format!("Unknown recipe \"{other}\".")),
    }
}

/// The container for a video result: the original's when it is a common one, otherwise
/// Matroska (which holds any codec) when the video is copied, or MP4 when it is re-encoded.
fn video_ext(path: &Path, copy: bool) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "mp4" | "mkv" | "webm" | "mov" | "avi" => ext,
        "m4v" => "mp4".into(),
        _ if copy => "mkv".into(),
        _ => "mp4".into(),
    }
}

fn audio_ext(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp3")
        .to_lowercase();
    if AUDIO_OUT.contains(&ext.as_str()) {
        ext
    } else {
        "m4a".into()
    }
}

fn write_private(path: &Path, content: &str) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("Could not prepare the job: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Could not prepare the job: {e}"))
}

fn scratch_dir() -> Result<PathBuf, String> {
    let base = std::env::temp_dir();
    for attempt in 0..100u32 {
        let dir = base.join(format!(
            "benchtop-convert-{}-{}-{attempt}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        if std::fs::create_dir(&dir).is_ok() {
            return Ok(dir);
        }
    }
    Err("Could not create a temporary folder.".into())
}

/* ------------------------------------------------------------ running -- */

#[derive(Debug, Deserialize)]
pub struct Job {
    /// Client id echoed in progress events.
    pub id: String,
    pub recipe: String,
    pub inputs: Vec<String>,
    #[serde(default)]
    pub options: Value,
    /// "ask" (a Save dialog), "beside" (next to the first input) or "folder" (ask for a folder once, for batches).
    #[serde(default)]
    pub destination: String,
    /// Folder token from an earlier convert_pick_folder, for batches.
    #[serde(default)]
    pub folder: Option<String>,
}

pub(crate) fn unique(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output")
        .to_string();
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    (2..10000)
        .map(|n| parent.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(path)
}

fn tail(text: &str) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(6)..].join("\n")
}

pub(crate) fn run_plan(
    state: &ConvertState,
    job_id: &str,
    plan: &Plan,
    output: &Path,
    progress: &dyn Fn(f64),
) -> Result<(), String> {
    let temp = output.with_file_name(format!(
        ".{}.benchtop-part.{}",
        output
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("output"),
        plan.ext
    ));
    let target = match plan.runner {
        Runner::Folder { .. } => PathBuf::new(),
        _ => temp.clone(),
    };
    let args: Vec<OsString> = plan
        .args
        .iter()
        .map(|arg| {
            let text = arg.to_string_lossy();
            if text.contains(OUT) {
                OsString::from(text.replace(OUT, &target.to_string_lossy()))
            } else {
                arg.clone()
            }
        })
        .collect();
    let mut process = command(&plan.program);
    process
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = &plan.cwd {
        process.current_dir(cwd);
    }
    if state.cancelled.lock().expect("cancelled").remove(job_id) {
        return Err("Stopped.".into());
    }
    let mut child = process
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", plan.program.display()))?;
    let stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    state
        .running
        .lock()
        .expect("running")
        .insert(job_id.to_string(), child.clone());
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(stderr) = stderr.as_mut() {
            let _ = stderr.read_to_string(&mut text);
        }
        text
    });
    if let Some(stdout) = stdout {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let (Runner::Ffmpeg, Some(total)) = (&plan.runner, plan.duration) {
                if let Some(value) = line
                    .strip_prefix("out_time_us=")
                    .or_else(|| line.strip_prefix("out_time_ms="))
                {
                    if let Ok(us) = value.trim().parse::<f64>() {
                        progress((us / 1e6 / total.max(0.001)).clamp(0.0, 1.0));
                    }
                }
            }
        }
    }
    // Poll rather than wait, so convert_cancel can take the lock and kill the process.
    let status = loop {
        let polled = child.lock().expect("child").try_wait();
        match polled {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(40)),
            Err(error) => {
                state.running.lock().expect("running").remove(job_id);
                return Err(error.to_string());
            }
        }
    };
    state.running.lock().expect("running").remove(job_id);
    let stderr = errors.join().unwrap_or_default();
    if state.cancelled.lock().expect("cancelled").remove(job_id) {
        let _ = std::fs::remove_file(&temp);
        return Err("Stopped.".into());
    }
    let produced = match &plan.runner {
        Runner::Folder { produced } => plan
            .scratch
            .as_ref()
            .map(|s| s.join(produced))
            .unwrap_or_default(),
        _ => temp.clone(),
    };
    if !status.success() || !produced.is_file() {
        let _ = std::fs::remove_file(&temp);
        let detail = tail(&stderr);
        return Err(if detail.is_empty() {
            format!(
                "{} could not convert this file (exit status {}).",
                program_name(&plan.program),
                status.code().unwrap_or(-1)
            )
        } else {
            format!("{} reported:\n{detail}", program_name(&plan.program))
        });
    }
    if std::fs::rename(&produced, output).is_err() {
        std::fs::copy(&produced, output)
            .map_err(|e| format!("Could not save {}: {e}", output.display()))?;
        let _ = std::fs::remove_file(&produced);
    }
    Ok(())
}

fn program_name(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("The converter")
        .to_string()
}

#[tauri::command]
pub async fn convert_run(
    app: AppHandle,
    job: Job,
    picked: State<'_, PickedFiles>,
) -> Result<Value, String> {
    let inputs: Vec<PathBuf> = job
        .inputs
        .iter()
        .map(|token| {
            picked.path(token).ok_or_else(|| {
                "Choose the file again; this one is no longer available.".to_string()
            })
        })
        .collect::<Result<_, _>>()?;
    let plan = {
        let inputs = inputs.clone();
        let recipe = job.recipe.clone();
        let options = job.options.clone();
        tauri::async_runtime::spawn_blocking(move || plan(&recipe, &inputs, &options))
            .await
            .map_err(|e| e.to_string())??
    };
    let first = inputs.first().ok_or("Choose a file first.")?;
    let stem = first
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let name = format!("{stem}{}.{}", plan.suffix, plan.ext);
    // Files dropped on the window are staged copies: their results go to Downloads.
    let folder = if crate::files::is_staged(first) {
        dirs::download_dir().unwrap_or_else(std::env::temp_dir)
    } else {
        first
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(std::env::temp_dir)
    };
    let output = match job.destination.as_str() {
        "beside" => unique(folder.join(&name)),
        "folder" => {
            let token = job
                .folder
                .as_deref()
                .ok_or("Choose a folder for the results.")?;
            let dir = picked.path(token).ok_or("Choose the folder again.")?;
            unique(dir.join(&name))
        }
        _ => {
            let chosen = app
                .dialog()
                .file()
                .set_directory(&folder)
                .set_file_name(&name)
                .add_filter(plan.ext.to_uppercase(), &[plan.ext.as_str()])
                .blocking_save_file();
            match chosen {
                Some(path) => path.into_path().map_err(|e| e.to_string())?,
                None => {
                    if let Some(scratch) = &plan.scratch {
                        let _ = std::fs::remove_dir_all(scratch);
                    }
                    return Ok(json!({"cancelled": true}));
                }
            }
        }
    };
    let state_app = app.clone();
    let job_id = job.id.clone();
    let out = output.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = state_app.state::<ConvertState>();
        let report = |fraction: f64| {
            let _ = state_app.emit(
                "convert-progress",
                json!({"id": job_id, "fraction": fraction}),
            );
        };
        let result = run_plan(&state, &job_id, &plan, &out, &report);
        if let Some(scratch) = &plan.scratch {
            let _ = std::fs::remove_dir_all(scratch);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?;
    result?;
    let size = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
    let token = picked.register(output.clone());
    Ok(json!({
        "path": output.to_string_lossy(),
        "name": output.file_name().and_then(|n| n.to_str()).unwrap_or_default(),
        "size": size,
        "token": token,
    }))
}

/// Stops a running job (by the id the page gave it).
#[tauri::command]
pub fn convert_cancel(id: String, state: State<'_, ConvertState>) {
    state
        .cancelled
        .lock()
        .expect("cancelled")
        .insert(id.clone());
    if let Some(child) = state.running.lock().expect("running").get(&id) {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
}

/// A folder for batch results, chosen once; the page gets a token for it.
#[tauri::command]
pub async fn convert_pick_folder(
    app: AppHandle,
    picked: State<'_, PickedFiles>,
) -> Result<Option<Value>, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = folder.into_path().map_err(|e| e.to_string())?;
    let name = path.to_string_lossy().into_owned();
    Ok(Some(json!({"token": picked.register(path), "path": name})))
}

/// Media details (length, size, streams) for a picked file, from ffprobe.
#[tauri::command]
pub async fn convert_probe(token: String, picked: State<'_, PickedFiles>) -> Result<Value, String> {
    let path = picked.path(&token).ok_or("Choose the file again.")?;
    let p = tauri::async_runtime::spawn_blocking(move || probe(&path))
        .await
        .map_err(|e| e.to_string())?;
    Ok(
        json!({"duration": p.duration, "width": p.width, "height": p.height, "audio": p.audio, "video": p.video}),
    )
}

/// Shows a file produced by the converter in the system file manager.
/// One frame of a video as PNG bytes, at most `width` pixels wide.
pub(crate) fn grab_frame(
    ffmpeg: &Path,
    path: &Path,
    at: f64,
    width: u32,
) -> Result<Vec<u8>, String> {
    let at = if at.is_finite() { at.max(0.0) } else { 0.0 };
    let width = width.clamp(64, 1920);
    let output = command(ffmpeg)
        .args(["-v", "error", "-ss", &format!("{at:.3}"), "-i"])
        .arg(path)
        .args([
            "-frames:v",
            "1",
            "-vf",
            &format!("scale='min({width},iw)':-2"),
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("FFmpeg could not be started: {error}"))?;
    if !output.status.success() || output.stdout.is_empty() {
        return Err("There is no picture at that time.".into());
    }
    Ok(output.stdout)
}

/// One frame of a chosen video as a PNG (Base64): the trim and crop previews.
#[tauri::command]
pub async fn convert_frame(
    token: String,
    seconds: f64,
    width: u32,
    picked: State<'_, PickedFiles>,
) -> Result<String, String> {
    use base64::Engine as _;
    let path = picked.path(&token).ok_or("Choose the file again.")?;
    let ffmpeg = need("ffmpeg", "FFmpeg")?;
    let png =
        tauri::async_runtime::spawn_blocking(move || grab_frame(&ffmpeg, &path, seconds, width))
            .await
            .map_err(|error| error.to_string())??;
    Ok(base64::engine::general_purpose::STANDARD.encode(png))
}

#[tauri::command]
pub fn convert_reveal(token: String, picked: State<'_, PickedFiles>) -> Result<(), String> {
    let path = picked.path(&token).ok_or("That file is no longer known.")?;
    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg("-R").arg(&path).spawn()
    } else if cfg!(target_os = "windows") {
        let mut select: OsString = "/select,".into();
        select.push(&path);
        Command::new("explorer").arg(select).spawn()
    } else {
        Command::new("xdg-open")
            .arg(path.parent().unwrap_or(Path::new("/")))
            .spawn()
    };
    result
        .map(|_| ())
        .map_err(|e| format!("Could not open the folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_times_and_clamps_numbers() {
        assert_eq!(time(&json!({"t": "1:30"}), "t").unwrap(), Some(90.0));
        assert_eq!(
            time(&json!({"t": "01:02:03.5"}), "t").unwrap(),
            Some(3723.5)
        );
        assert_eq!(time(&json!({"t": 12}), "t").unwrap(), Some(12.0));
        assert!(time(&json!({"t": "abc"}), "t").is_err());
        assert_eq!(time(&json!({}), "t").unwrap(), None);
        assert_eq!(number(&json!({"n": 999}), "n", 1.0, 0.0, 10.0), 10.0);
        assert_eq!(number(&json!({"n": "5"}), "n", 1.0, 0.0, 10.0), 5.0);
        assert_eq!(choice(&json!({"c": "rm -rf"}), "c", &["mp4", "mkv"]), "mp4");
        assert_eq!(colour(&json!({"c": "#ABCDEF"}), "c", "#000000"), "ABCDEF");
        assert_eq!(colour(&json!({"c": "red;x"}), "c", "#000000"), "000000");
        assert_eq!(atempo(4.0), "atempo=2.0,atempo=2.0000");
        assert_eq!(atempo(0.25), "atempo=0.5,atempo=0.5000");
    }

    #[test]
    fn unknown_recipes_and_missing_inputs_are_refused() {
        assert!(plan("rm", &[PathBuf::from("/tmp/x.mp4")], &json!({})).is_err());
        assert!(plan("media-convert", &[], &json!({})).is_err());
    }

    /// Runs real conversions when FFmpeg, qpdf and Pandoc are installed (BENCHTOP_CONVERT_TEST=1).
    #[test]
    fn converts_with_installed_programs() {
        if std::env::var_os("BENCHTOP_CONVERT_TEST").is_none() {
            return;
        }
        let dir = scratch_dir().expect("scratch");
        let ffmpeg = find_program("ffmpeg").expect("ffmpeg");
        let wav = dir.join("tone.wav");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=3",
                "-y",
            ])
            .arg(&wav)
            .status()
            .expect("ffmpeg");
        assert!(status.success());
        let video = dir.join("clip.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x240:rate=25:duration=2",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=2",
                "-shortest",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-y",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg");
        assert!(status.success());
        // The trim and crop previews: one frame, scaled down, as PNG.
        let png = grab_frame(&ffmpeg, &video, 1.0, 160).expect("frame");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 160);
        assert!(grab_frame(&ffmpeg, &video, 30.0, 160).is_err());
        let check = |recipe: &str, inputs: Vec<PathBuf>, options: Value, ext: &str| {
            let plan = plan(recipe, &inputs, &options).unwrap_or_else(|e| panic!("{recipe}: {e}"));
            assert_eq!(plan.ext, ext, "{recipe}");
            let out = dir.join(format!("{recipe}.{ext}"));
            let args: Vec<OsString> = plan
                .args
                .iter()
                .map(|a| OsString::from(a.to_string_lossy().replace(OUT, &out.to_string_lossy())))
                .collect();
            let mut command = Command::new(&plan.program);
            command.args(&args).stdout(Stdio::null());
            if let Some(cwd) = &plan.cwd {
                command.current_dir(cwd);
            }
            let output = command.output().expect("run");
            let produced = match &plan.runner {
                Runner::Folder { produced } => {
                    let from = plan.scratch.as_ref().unwrap().join(produced);
                    if from.is_file() {
                        std::fs::rename(&from, &out).unwrap();
                    }
                    out.clone()
                }
                _ => out.clone(),
            };
            assert!(
                output.status.success() && produced.is_file(),
                "{recipe}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(
                std::fs::metadata(&produced).unwrap().len() > 0,
                "{recipe}: empty output"
            );
            produced
        };
        let length = |path: &Path| probe(path).duration.unwrap_or_default();

        // Audio
        check(
            "audio-convert",
            vec![wav.clone()],
            json!({"to": "mp3", "channels": "mono", "rate": 22050}),
            "mp3",
        );
        check("audio-normalize", vec![wav.clone()], json!({}), "wav");
        check(
            "audio-fade",
            vec![wav.clone()],
            json!({"in": 0.5, "out": 0.5}),
            "wav",
        );
        check("audio-silence", vec![wav.clone()], json!({}), "wav");
        check("audio-denoise", vec![wav.clone()], json!({}), "wav");
        check("audio-volume", vec![wav.clone()], json!({"db": -3}), "wav");
        let trimmed = check(
            "audio-trim",
            vec![wav.clone()],
            json!({"start": "1", "end": "2.5", "exact": true}),
            "wav",
        );
        assert!(
            (length(&trimmed) - 1.5).abs() < 0.1,
            "audio-trim length {}",
            length(&trimmed)
        );
        let faster = check(
            "audio-speed",
            vec![wav.clone()],
            json!({"factor": 1.5}),
            "wav",
        );
        assert!(
            (length(&faster) - 2.0).abs() < 0.1,
            "audio-speed length {}",
            length(&faster)
        );
        check(
            "audio-waveform",
            vec![wav.clone()],
            json!({"colour": "#ff0000"}),
            "png",
        );
        check("audio-spectrogram", vec![wav.clone()], json!({}), "png");
        let joined = check(
            "audio-merge",
            vec![wav.clone(), wav.clone()],
            json!({"to": "ogg"}),
            "ogg",
        );
        assert!(
            (length(&joined) - 6.0).abs() < 0.2,
            "audio-merge length {}",
            length(&joined)
        );

        // Video
        check(
            "media-convert",
            vec![video.clone()],
            json!({"to": "webm", "crf": 40}),
            "webm",
        );
        check(
            "media-convert",
            vec![video.clone()],
            json!({"to": "mp3"}),
            "mp3",
        );
        check(
            "video-compress",
            vec![video.clone()],
            json!({"height": 120}),
            "mp4",
        );
        let resized = check(
            "video-resize",
            vec![video.clone()],
            json!({"width": 161}),
            "mp4",
        );
        assert_eq!(probe(&resized).width, Some(160));
        let cropped = check(
            "video-crop",
            vec![video.clone()],
            json!({"x": 10, "y": 10, "w": 100, "h": 80}),
            "mp4",
        );
        assert_eq!(
            (probe(&cropped).width, probe(&cropped).height),
            (Some(100), Some(80))
        );
        let turned = check(
            "video-rotate",
            vec![video.clone()],
            json!({"turn": "90"}),
            "mp4",
        );
        assert_eq!(probe(&turned).width, Some(240));
        check("video-fps", vec![video.clone()], json!({"fps": 10}), "mp4");
        assert!(!probe(&check("video-mute", vec![video.clone()], json!({}), "mp4")).audio);
        check("video-volume", vec![video.clone()], json!({"db": 3}), "mp4");
        let cut = check(
            "video-trim",
            vec![video.clone()],
            json!({"start": "0.5", "end": "1.5", "exact": true}),
            "mp4",
        );
        assert!(
            (length(&cut) - 1.0).abs() < 0.15,
            "video-trim length {}",
            length(&cut)
        );
        check(
            "video-gif",
            vec![video.clone()],
            json!({"width": 160}),
            "gif",
        );
        check("video-frame", vec![video.clone()], json!({"at": 1}), "png");
        check(
            "video-extract-audio",
            vec![video.clone()],
            json!({"to": "m4a"}),
            "m4a",
        );
        let fast = check(
            "video-speed",
            vec![video.clone()],
            json!({"factor": 2}),
            "mp4",
        );
        assert!(
            (length(&fast) - 1.0).abs() < 0.15,
            "video-speed length {}",
            length(&fast)
        );
        let both = check(
            "video-merge",
            vec![video.clone(), video.clone()],
            json!({}),
            "mp4",
        );
        assert!(
            (length(&both) - 4.0).abs() < 0.2,
            "video-merge length {}",
            length(&both)
        );
        let logo = dir.join("logo.png");
        assert!(Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=red:s=64x32",
                "-frames:v",
                "1",
                "-y"
            ])
            .arg(&logo)
            .status()
            .unwrap()
            .success());
        check(
            "video-watermark",
            vec![video.clone(), logo.clone()],
            json!({"position": "top-left"}),
            "mp4",
        );
        let srt = dir.join("subs.srt");
        std::fs::write(&srt, "1\n00:00:00,000 --> 00:00:01,500\nHello\n").unwrap();
        check(
            "video-burn-subtitles",
            vec![video.clone(), srt.clone()],
            json!({}),
            "mp4",
        );
        check(
            "video-add-subtitles",
            vec![video.clone(), srt],
            json!({"to": "mkv"}),
            "mkv",
        );

        // Documents, images and PDFs, when those programs are installed.
        if find_program("pandoc").is_some() {
            let md = dir.join("doc.md");
            std::fs::write(&md, "# Title\n\nSome *text*.\n").unwrap();
            let html = check("markup", vec![md.clone()], json!({"to": "html"}), "html");
            assert!(std::fs::read_to_string(html)
                .unwrap()
                .contains("<em>text</em>"));
            check("markup", vec![md], json!({"to": "docx"}), "docx");
        }
        if find_program("imagemagick").is_some() {
            check(
                "image",
                vec![logo.clone()],
                json!({"to": "jpg", "size": 16, "strip": true}),
                "jpg",
            );
            check("image", vec![logo.clone()], json!({"to": "ico"}), "ico");
        }
        if find_program("libreoffice").is_some() && find_program("qpdf").is_some() {
            let txt = dir.join("letter.txt");
            std::fs::write(&txt, "Benchtop converts documents.\n").unwrap();
            let pdf = check("document", vec![txt], json!({"to": "pdf"}), "pdf");
            let locked = check(
                "pdf-protect",
                vec![pdf.clone()],
                json!({"password": "s3cret -x", "noPrint": true}),
                "pdf",
            );
            let info = Command::new(find_program("qpdf").unwrap())
                .arg("--show-encryption")
                .arg(&locked)
                .output()
                .unwrap();
            assert!(
                !info.status.success()
                    || String::from_utf8_lossy(&info.stdout).contains("password"),
                "pdf-protect: not encrypted"
            );
            let open = check(
                "pdf-unlock",
                vec![locked],
                json!({"password": "s3cret -x"}),
                "pdf",
            );
            let info = Command::new(find_program("qpdf").unwrap())
                .arg("--show-encryption")
                .arg(&open)
                .output()
                .unwrap();
            assert!(
                String::from_utf8_lossy(&info.stdout).contains("not encrypted"),
                "pdf-unlock: still encrypted"
            );
            check("pdf-optimise", vec![pdf], json!({"linearize": true}), "pdf");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
