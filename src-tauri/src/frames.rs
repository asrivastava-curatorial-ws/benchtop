//! Animation frames to a video file.
//!
//! The Animation Studio draws every frame itself and sends the frames here as PNG
//! pictures.  This module keeps them in a private folder, has FFmpeg (already
//! installed on this computer) join them into a video with the soundtrack, and
//! saves the result where the user chooses.  The argument list is built here
//! from a fixed set of choices; no shell is involved.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::files::PickedFiles;

/// Ten minutes at 60 frames a second.
const MAX_FRAMES: u32 = 36_000;
const MAX_FRAME_BYTES: usize = 64 << 20;
const MAX_AUDIO_BYTES: usize = 64 << 20;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct Job {
    folder: PathBuf,
    frames: u32,
    audio: Option<String>,
}

#[derive(Default)]
pub struct FrameState {
    jobs: Mutex<HashMap<String, Job>>,
    running: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    cancelled: Mutex<HashSet<String>>,
}

/// Where frames wait for FFmpeg: inside the user's own cache folder.
fn frames_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("app.benchtop.desktop")
        .join("frames")
}

/// Removes frame folders left behind by an export that never finished (older than a day).
fn prune(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age.as_secs() > 86_400);
        if old {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

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

fn header<'a>(request: &'a tauri::ipc::Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

/// Starts an export: a new, empty, private folder for its frames.  Returns the export's id.
#[tauri::command]
pub fn frames_begin(state: State<'_, FrameState>) -> Result<String, String> {
    let root = frames_dir();
    prune(&root);
    let mut jobs = state.jobs.lock().expect("jobs");
    // Exports the page gave up on (a reload, say) are cleared away before a new one starts.
    let running = state.running.lock().expect("running");
    let stale: Vec<String> = jobs
        .keys()
        .filter(|id| !running.contains_key(*id))
        .cloned()
        .collect();
    drop(running);
    for id in stale {
        if let Some(job) = jobs.remove(&id) {
            let _ = std::fs::remove_dir_all(job.folder);
        }
    }
    let id = format!(
        "{:x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default()
            ^ u128::from(COUNTER.fetch_add(1, Ordering::SeqCst)) << 64
    );
    let folder = root.join(&id);
    crate::files::create_private_dir(&folder)
        .map_err(|e| format!("Could not make a folder for the frames: {e}"))?;
    jobs.insert(
        id.clone(),
        Job {
            folder,
            frames: 0,
            audio: None,
        },
    );
    Ok(id)
}

/// One frame, as a PNG picture in the request body.  Frames arrive in order
/// (x-frame-index counts from 0); x-frames-id names the export.
#[tauri::command]
pub fn frames_add(
    request: tauri::ipc::Request<'_>,
    state: State<'_, FrameState>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The frame did not arrive.".into());
    };
    let id = header(&request, "x-frames-id").ok_or("The frame names no export.")?;
    let index: u32 = header(&request, "x-frame-index")
        .and_then(|v| v.parse().ok())
        .ok_or("The frame has no number.")?;
    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err("The frame is not a PNG picture.".into());
    }
    if bytes.len() > MAX_FRAME_BYTES {
        return Err("The frame is too large.".into());
    }
    let mut jobs = state.jobs.lock().expect("jobs");
    let job = jobs
        .get_mut(id)
        .ok_or("This export is no longer open; start it again.")?;
    if index != job.frames {
        return Err(format!(
            "Frame {index} arrived out of order (expected {}).",
            job.frames
        ));
    }
    if job.frames >= MAX_FRAMES {
        return Err(format!(
            "A video can have at most {MAX_FRAMES} frames; use fewer frames per second or a shorter animation."
        ));
    }
    std::fs::write(job.folder.join(format!("{index:06}.png")), bytes)
        .map_err(|e| format!("Could not keep the frame: {e}"))?;
    job.frames += 1;
    Ok(())
}

/// The extension FFmpeg is given for a soundtrack of this type (it reads the content itself).
fn audio_extension(mime: &str) -> &'static str {
    match mime
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/x-wav" | "audio/wave" | "audio/vnd.wave" => "wav",
        "audio/ogg" | "audio/vorbis" => "ogg",
        "audio/opus" => "opus",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/mp4" | "audio/x-m4a" | "audio/m4a" => "m4a",
        "audio/aac" | "audio/aacp" => "aac",
        "audio/webm" => "webm",
        _ => "audio",
    }
}

/// The soundtrack, as the bytes of the audio file (x-audio-type is its media type).
#[tauri::command]
pub fn frames_audio(
    request: tauri::ipc::Request<'_>,
    state: State<'_, FrameState>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The sound did not arrive.".into());
    };
    let id = header(&request, "x-frames-id").ok_or("The sound names no export.")?;
    if bytes.is_empty() || bytes.len() > MAX_AUDIO_BYTES {
        return Err("The sound is empty or too large.".into());
    }
    let name = format!(
        "sound.{}",
        audio_extension(header(&request, "x-audio-type").unwrap_or_default())
    );
    let mut jobs = state.jobs.lock().expect("jobs");
    let job = jobs
        .get_mut(id)
        .ok_or("This export is no longer open; start it again.")?;
    std::fs::write(job.folder.join(&name), bytes)
        .map_err(|e| format!("Could not keep the sound: {e}"))?;
    job.audio = Some(name);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeOptions {
    fps: f64,
    /// "mp4" or "webm".
    format: String,
    /// File name without the extension.
    name: String,
}

/// The encoders this FFmpeg has, from `ffmpeg -encoders`.
fn encoders_in(listing: &str) -> HashSet<String> {
    listing
        .lines()
        .filter_map(|line| {
            let mut words = line.split_whitespace();
            let flags = words.next()?;
            let name = words.next()?;
            // Lines look like " V....D libx264  H.264 …": six flag characters, then the name.
            (flags.len() == 6 && flags.starts_with(['V', 'A', 'S']) && name != "=")
                .then(|| name.to_string())
        })
        .collect()
}

fn encoders(ffmpeg: &Path) -> HashSet<String> {
    command(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map(|out| encoders_in(&String::from_utf8_lossy(&out.stdout)))
        .unwrap_or_default()
}

/// The video and audio encoders to use for a format, from those this FFmpeg has.
fn choose(format: &str, have: &HashSet<String>) -> Result<(&'static str, &'static str), String> {
    let first = |wanted: &[&'static str]| wanted.iter().copied().find(|name| have.contains(*name));
    match format {
        "mp4" => {
            let video = first(&["libx264", "libopenh264", "h264_videotoolbox", "h264_mf", "mpeg4"])
                .ok_or("This FFmpeg has no H.264 or MPEG-4 encoder; choose WebM, or install a full FFmpeg build.")?;
            Ok((video, first(&["aac", "libmp3lame"]).unwrap_or("aac")))
        }
        "webm" => {
            let video = first(&["libvpx-vp9", "libvpx"])
                .ok_or("This FFmpeg has no VP9 or VP8 encoder; choose MP4, or install a full FFmpeg build.")?;
            Ok((video, first(&["libopus", "libvorbis"]).unwrap_or("libopus")))
        }
        _ => Err("Choose MP4 or WebM.".into()),
    }
}

/// FFmpeg's arguments.  It runs inside the frames folder, so the frame pattern and the
/// sound are plain names (a folder name with a % in it would otherwise be read as a pattern).
fn arguments(
    format: &str,
    video: &str,
    audio_codec: &str,
    fps: f64,
    frames: u32,
    audio: Option<&str>,
    output: &Path,
) -> Vec<OsString> {
    let rate = format!("{fps}");
    let mut args: Vec<OsString> = [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-framerate",
        &rate,
        "-start_number",
        "0",
        "-i",
        "%06d.png",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    let mut push = |items: &[&str]| args.extend(items.iter().map(OsString::from));
    if let Some(name) = audio {
        push(&["-i", name, "-map", "0:v:0", "-map", "1:a:0"]);
    }
    // Encoders want even sizes and the pixel format every player reads.
    push(&[
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-pix_fmt",
        "yuv420p",
        "-r",
        &rate,
        "-c:v",
        video,
    ]);
    match video {
        "libx264" => push(&["-preset", "medium", "-crf", "18"]),
        "libvpx-vp9" => push(&[
            "-crf",
            "30",
            "-b:v",
            "0",
            "-row-mt",
            "1",
            "-deadline",
            "good",
            "-cpu-used",
            "4",
        ]),
        "libvpx" => push(&["-crf", "10", "-b:v", "4M"]),
        "mpeg4" => push(&["-q:v", "3"]),
        _ => push(&["-b:v", "8M"]),
    }
    if audio.is_some() {
        push(&["-c:a", audio_codec, "-b:a", "192k"]);
    }
    // The video is as long as its frames; a longer soundtrack is cut there.
    let seconds = format!("{:.6}", f64::from(frames) / fps);
    push(&["-t", &seconds]);
    if format == "mp4" {
        push(&["-movflags", "+faststart"]);
    }
    push(&["-progress", "pipe:1", "-nostats"]);
    args.push(output.into());
    args
}

/// A file name without folders or reserved characters.
fn clean_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        "animation".into()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn tail(text: &str) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(6)..].join("\n")
}

fn encode(
    app: &AppHandle,
    id: &str,
    ffmpeg: &Path,
    folder: &Path,
    args: &[OsString],
    frames: u32,
) -> Result<(), String> {
    let state = app.state::<FrameState>();
    if state.cancelled.lock().expect("cancelled").remove(id) {
        return Err("Stopped.".into());
    }
    let mut child = command(ffmpeg)
        .args(args)
        .current_dir(folder)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start FFmpeg: {e}"))?;
    let stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    state
        .running
        .lock()
        .expect("running")
        .insert(id.to_string(), child.clone());
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(stderr) = stderr.as_mut() {
            let _ = stderr.read_to_string(&mut text);
        }
        text
    });
    if let Some(stdout) = stdout {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(done) = line
                .strip_prefix("frame=")
                .and_then(|v| v.trim().parse::<f64>().ok())
            {
                let fraction = (done / f64::from(frames.max(1))).clamp(0.0, 1.0);
                let _ = app.emit("frames-progress", json!({"id": id, "fraction": fraction}));
            }
        }
    }
    // Poll rather than wait, so frames_cancel can take the lock and stop FFmpeg.
    let status = loop {
        let polled = child.lock().expect("child").try_wait();
        match polled {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(40)),
            Err(error) => {
                state.running.lock().expect("running").remove(id);
                return Err(error.to_string());
            }
        }
    };
    state.running.lock().expect("running").remove(id);
    let stderr = errors.join().unwrap_or_default();
    if state.cancelled.lock().expect("cancelled").remove(id) {
        return Err("Stopped.".into());
    }
    if !status.success() {
        let detail = tail(&stderr);
        return Err(if detail.is_empty() {
            format!(
                "FFmpeg could not make the video (exit status {}).",
                status.code().unwrap_or(-1)
            )
        } else {
            format!("FFmpeg reported:\n{detail}")
        });
    }
    Ok(())
}

/// Joins the frames (and the soundtrack) into a video and saves it where the user chooses.
#[tauri::command]
pub async fn frames_encode(
    app: AppHandle,
    id: String,
    options: EncodeOptions,
    picked: State<'_, PickedFiles>,
) -> Result<Value, String> {
    if !(options.fps.is_finite() && (1.0..=120.0).contains(&options.fps)) {
        return Err("Frames per second must be between 1 and 120.".into());
    }
    let format = match options.format.as_str() {
        "mp4" => "mp4",
        "webm" => "webm",
        _ => return Err("Choose MP4 or WebM.".into()),
    };
    let (folder, frames, audio) = {
        let state = app.state::<FrameState>();
        let jobs = state.jobs.lock().expect("jobs");
        let job = jobs
            .get(&id)
            .ok_or("This export is no longer open; start it again.")?;
        (job.folder.clone(), job.frames, job.audio.clone())
    };
    if frames == 0 {
        return Err("There are no frames to join.".into());
    }
    let ffmpeg = crate::convert::find_program("ffmpeg")
        .ok_or("FFmpeg is not installed on this computer; it joins the frames into a video.")?;
    let name = format!("{}.{format}", clean_name(&options.name));
    // The desktop tests cannot answer a Save dialog; they name a folder instead.
    let output = match std::env::var_os("BENCHTOP_TEST_FOLDER")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
    {
        Some(dir) => crate::convert::unique(dir.join(&name)),
        None => {
            let mut dialog = app
                .dialog()
                .file()
                .set_file_name(&name)
                .add_filter(format.to_uppercase(), &[format]);
            if let Some(downloads) = dirs::download_dir() {
                dialog = dialog.set_directory(downloads);
            }
            match dialog.blocking_save_file() {
                Some(path) => path.into_path().map_err(|e| e.to_string())?,
                None => return Ok(json!({"cancelled": true})),
            }
        }
    };
    let part = output.with_file_name(format!(
        ".{}.benchtop-part.{format}",
        output
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("animation")
    ));
    let worker = app.clone();
    let job_id = id.clone();
    let target = part.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (video, audio_codec) = choose(format, &encoders(&ffmpeg))?;
        let args = arguments(
            format,
            video,
            audio_codec,
            options.fps,
            frames,
            audio.as_deref(),
            &target,
        );
        encode(&worker, &job_id, &ffmpeg, &folder, &args, frames)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Err(error) = result {
        let _ = std::fs::remove_file(&part);
        return Err(error);
    }
    if std::fs::rename(&part, &output).is_err() {
        std::fs::copy(&part, &output)
            .map_err(|e| format!("Could not save {}: {e}", output.display()))?;
        let _ = std::fs::remove_file(&part);
    }
    let size = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
    Ok(json!({
        "path": output.to_string_lossy(),
        "name": output.file_name().and_then(|n| n.to_str()).unwrap_or_default(),
        "size": size,
        "token": picked.register(output.clone()),
    }))
}

/// Stops FFmpeg for this export, if it is running.
#[tauri::command]
pub fn frames_cancel(id: String, state: State<'_, FrameState>) {
    if let Some(child) = state.running.lock().expect("running").get(&id) {
        state
            .cancelled
            .lock()
            .expect("cancelled")
            .insert(id.clone());
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
}

/// Ends an export: its frames are deleted.
#[tauri::command]
pub fn frames_end(id: String, state: State<'_, FrameState>) {
    if state.running.lock().expect("running").contains_key(&id) {
        return;
    }
    state.cancelled.lock().expect("cancelled").remove(&id);
    if let Some(job) = state.jobs.lock().expect("jobs").remove(&id) {
        let _ = std::fs::remove_dir_all(job.folder);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTING: &str = "Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D mpeg4                MPEG-4 part 2
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D aac                  AAC (Advanced Audio Coding)
 A....D libopus              libopus Opus (codec opus)
";

    fn text(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn reads_the_encoder_list() {
        let have = encoders_in(LISTING);
        assert!(have.contains("libx264") && have.contains("aac") && have.contains("libvpx-vp9"));
        assert!(!have.contains("=") && !have.contains("Video") && have.len() == 5);
    }

    #[test]
    fn chooses_encoders_this_ffmpeg_has() {
        let have = encoders_in(LISTING);
        assert_eq!(choose("mp4", &have), Ok(("libx264", "aac")));
        assert_eq!(choose("webm", &have), Ok(("libvpx-vp9", "libopus")));
        let plain: HashSet<String> = ["mpeg4", "libvorbis", "libvpx"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(choose("mp4", &plain), Ok(("mpeg4", "aac")));
        assert_eq!(choose("webm", &plain), Ok(("libvpx", "libvorbis")));
        assert!(choose("mp4", &HashSet::new()).is_err());
        assert!(choose("webm", &HashSet::new()).is_err());
        assert!(choose("avi", &have).is_err());
    }

    #[test]
    fn builds_the_arguments_from_fixed_choices() {
        let out = Path::new("/videos/film.mp4");
        let silent = text(&arguments("mp4", "libx264", "aac", 30.0, 90, None, out));
        assert_eq!(
            silent,
            [
                "-hide_banner",
                "-nostdin",
                "-y",
                "-framerate",
                "30",
                "-start_number",
                "0",
                "-i",
                "%06d.png",
                "-vf",
                "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-pix_fmt",
                "yuv420p",
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-t",
                "3.000000",
                "-movflags",
                "+faststart",
                "-progress",
                "pipe:1",
                "-nostats",
                "/videos/film.mp4"
            ]
        );
        let sound = text(&arguments(
            "webm",
            "libvpx-vp9",
            "libopus",
            12.5,
            25,
            Some("sound.mp3"),
            Path::new("out.webm"),
        ));
        let joined = sound.join(" ");
        assert!(joined.contains("-framerate 12.5 "));
        assert!(joined.contains("-i sound.mp3 -map 0:v:0 -map 1:a:0"));
        assert!(joined.contains("-c:a libopus -b:a 192k -t 2.000000 -progress"));
        assert!(!joined.contains("faststart"));
        assert_eq!(sound.last().map(String::as_str), Some("out.webm"));
    }

    #[test]
    fn names_files_safely() {
        assert_eq!(clean_name("My film"), "My film");
        assert_eq!(clean_name("../../etc/passwd"), "etc passwd");
        assert_eq!(clean_name("a:b*c?"), "a b c");
        assert_eq!(clean_name(" .. "), "animation");
        assert_eq!(clean_name(&"x".repeat(200)).len(), 80);
    }

    #[test]
    fn knows_soundtrack_types() {
        assert_eq!(audio_extension("audio/mpeg"), "mp3");
        assert_eq!(audio_extension("audio/ogg; codecs=opus"), "ogg");
        assert_eq!(audio_extension("AUDIO/WAV"), "wav");
        assert_eq!(audio_extension("text/html"), "audio");
    }
}
