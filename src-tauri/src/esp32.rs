//! ESP32 boards in the Circuit Simulator: runs firmware in benchtop-esp32 (lcgamboa's
//! QEMU with Benchtop's line protocol, built from esp32-helper/) and relays its
//! messages to the page as `esp32-lines` events.  The helper is a separate GPL
//! program; Benchtop only starts it and talks to it over its standard input and output.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};

/// Flash size of the emulated module.
const FLASH_SIZE: usize = 4 << 20;
const HELPER: &str = if cfg!(windows) {
    "benchtop-esp32.exe"
} else {
    "benchtop-esp32"
};
const ROMS: [&str; 2] = ["esp32-v3-rom.bin", "esp32-v3-rom-app.bin"];

struct Session {
    child: Arc<Mutex<Child>>,
    stdin: ChildStdin,
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"Q\n");
        let _ = self.stdin.flush();
        let child = self.child.clone();
        std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(1);
            loop {
                let Ok(mut child) = child.lock() else { return };
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                if Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
                drop(child);
                std::thread::sleep(Duration::from_millis(50));
            }
        });
    }
}

#[derive(Default)]
pub struct Esp32State {
    /// Flash images ready to run: token → file.
    firmware: Mutex<HashMap<String, PathBuf>>,
    sessions: Mutex<HashMap<String, Session>>,
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn work_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("app.benchtop.desktop")
        .join("esp32")
}

/// Where the helper is: BENCHTOP_ESP32_HELPER, the app's resources, beside the
/// executable, the source tree (development builds) or PATH.  The ROM images
/// sit in the same folder.
fn find_helper(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("BENCHTOP_ESP32_HELPER") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("resources").join("esp32").join(HELPER));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(HELPER));
            candidates.push(dir.join("esp32").join(HELPER));
        }
    }
    if cfg!(debug_assertions) {
        candidates.push(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("esp32")
                .join(HELPER),
        );
    }
    if let Ok(path) = which::which(HELPER) {
        candidates.push(path);
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn missing_roms(helper: &Path) -> Vec<&'static str> {
    let dir = helper.parent().unwrap_or(Path::new("."));
    ROMS.iter()
        .copied()
        .filter(|rom| !dir.join(rom).is_file())
        .collect()
}

/// Whether ESP32 boards can run here, and if not, why.
#[tauri::command]
pub fn esp32_info(app: AppHandle) -> Value {
    match find_helper(&app) {
        Some(helper) => {
            let missing = missing_roms(&helper);
            if missing.is_empty() {
                json!({ "available": true, "helper": helper.display().to_string(), "detail": "" })
            } else {
                json!({
                    "available": false,
                    "helper": helper.display().to_string(),
                    "detail": format!("The ESP32 emulator is missing {} beside {}.", missing.join(" and "), helper.display()),
                })
            }
        }
        None => json!({
            "available": false,
            "helper": null,
            "detail": "This copy of Benchtop does not include the ESP32 emulator (benchtop-esp32). The Linux installers include it; on other systems build it with esp32-helper/build.sh and set BENCHTOP_ESP32_HELPER to its path.",
        }),
    }
}

/// Writes a flash image the size of the module's flash with `image` at `offset`
/// (0 for a merged image, 0x1000 for a bootloader-style image) and returns its token.
pub fn register_image(state: &Esp32State, image: &[u8], offset: usize) -> Result<String, String> {
    if image.is_empty() {
        return Err("The firmware file is empty.".into());
    }
    if offset + image.len() > FLASH_SIZE {
        return Err(format!(
            "The firmware is {} bytes, more than the board's 4 MB of flash.",
            image.len()
        ));
    }
    let dir = work_dir();
    crate::files::create_private_dir(&dir)
        .map_err(|e| format!("Could not prepare the firmware: {e}"))?;
    let mut flash = vec![0xFFu8; FLASH_SIZE];
    flash[offset..offset + image.len()].copy_from_slice(image);
    let token = format!(
        "{:x}{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    );
    let path = dir.join(format!("firmware-{token}.bin"));
    std::fs::write(&path, &flash).map_err(|e| format!("Could not prepare the firmware: {e}"))?;
    if let Ok(mut firmware) = state.firmware.lock() {
        firmware.insert(token.clone(), path);
    }
    Ok(token)
}

/// Prepares firmware sent as the request body; the x-offset header says where it goes in flash.
#[tauri::command]
pub fn esp32_firmware(
    request: Request<'_>,
    state: State<'_, Esp32State>,
) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("The firmware did not arrive.".into());
    };
    let offset = request
        .headers()
        .get("x-offset")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    register_image(&state, bytes, offset)
}

fn helper_command(helper: &Path, flash: &Path) -> Command {
    let mut command = Command::new(helper);
    command
        .arg("-M")
        .arg("esp32-picsimlab")
        .arg("-m")
        .arg("4M")
        .arg("-L")
        .arg(helper.parent().unwrap_or(Path::new(".")))
        .arg("-drive")
        .arg(format!("file={},if=mtd,format=raw", flash.display()))
        .args(["-display", "none", "-serial", "null", "-monitor", "none"])
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

/// Starts firmware `token` as session `id`.  Messages arrive as `esp32-lines`
/// events ({id, lines}); the last is "X <reason>" when the helper stops.
#[tauri::command]
pub fn esp32_start(
    app: AppHandle,
    state: State<'_, Esp32State>,
    id: String,
    token: String,
) -> Result<(), String> {
    let helper = find_helper(&app).ok_or_else(|| {
        esp32_info(app.clone())["detail"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    })?;
    let missing = missing_roms(&helper);
    if !missing.is_empty() {
        return Err(format!(
            "The ESP32 emulator is missing {}.",
            missing.join(" and ")
        ));
    }
    let image = state
        .firmware
        .lock()
        .map_err(|_| "The firmware list is unavailable.")?
        .get(&token)
        .cloned()
        .ok_or("Load the firmware again: it is no longer prepared.")?;
    // Each run starts from the image as loaded; the firmware may write to its flash.
    let flash = work_dir().join(format!("run-{}.bin", safe_id(&id)));
    std::fs::copy(&image, &flash).map_err(|e| format!("Could not prepare the flash: {e}"))?;

    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.remove(&id);
    }
    let mut child = helper_command(&helper, &flash)
        .spawn()
        .map_err(|e| format!("Could not start the ESP32 emulator: {e}"))?;
    let stdin = child.stdin.take().ok_or("The emulator has no input.")?;
    let stdout = child.stdout.take().ok_or("The emulator has no output.")?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or("The emulator has no error output.")?;
    let child = Arc::new(Mutex::new(child));

    // Errors the helper prints, kept for the message when it stops.
    let errors = Arc::new(Mutex::new(String::new()));
    {
        let errors = errors.clone();
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            if let Ok(mut e) = errors.lock() {
                *e = text;
            }
        });
    }

    // Lines are forwarded in batches every 15 ms (or 500 lines).
    let (sender, receiver) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if sender.send(line.trim_end().to_string()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    {
        let app = app.clone();
        let id = id.clone();
        let child = child.clone();
        std::thread::spawn(move || {
            let mut batch: Vec<String> = Vec::new();
            let mut last = Instant::now();
            loop {
                let next = receiver.recv_timeout(Duration::from_millis(15));
                let finished = matches!(next, Err(mpsc::RecvTimeoutError::Disconnected));
                if let Ok(line) = next {
                    batch.push(line);
                }
                if !batch.is_empty()
                    && (finished
                        || batch.len() >= 500
                        || last.elapsed() >= Duration::from_millis(15))
                {
                    let _ = app.emit("esp32-lines", json!({ "id": id, "lines": batch }));
                    batch = Vec::new();
                    last = Instant::now();
                }
                if finished {
                    break;
                }
            }
            // The helper has closed its output: report why it stopped.  The lock is
            // released between checks so a stop request can still end the process.
            let started = Instant::now();
            let status = loop {
                let done = child
                    .lock()
                    .ok()
                    .and_then(|mut c| c.try_wait().ok().flatten());
                if done.is_some() || started.elapsed() > Duration::from_secs(5) {
                    break done;
                }
                std::thread::sleep(Duration::from_millis(20));
            };
            std::thread::sleep(Duration::from_millis(50));
            let errors = errors.lock().map(|e| e.clone()).unwrap_or_default();
            let reason = match status {
                Some(s) if s.success() => "stopped".to_string(),
                _ => {
                    let detail = errors
                        .lines()
                        .filter(|l| !l.trim().is_empty() && !l.contains("Adding SPI flash"))
                        .last()
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if detail.contains("libfdt") || detail.contains("libgcrypt") {
                        format!("The ESP32 emulator could not start: {detail}. Install the libfdt1 and libgcrypt20 packages.")
                    } else if detail.is_empty() {
                        "The ESP32 emulator stopped unexpectedly.".to_string()
                    } else {
                        format!("The ESP32 emulator stopped: {detail}")
                    }
                }
            };
            let _ = app.emit(
                "esp32-lines",
                json!({ "id": id, "lines": [format!("X {reason}")] }),
            );
        });
    }
    state
        .sessions
        .lock()
        .map_err(|_| "The session list is unavailable.")?
        .insert(id, Session { child, stdin });
    Ok(())
}

fn safe_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(40)
        .collect()
}

/// Sends input lines (I, A, S) to a running session.
#[tauri::command]
pub fn esp32_send(
    state: State<'_, Esp32State>,
    id: String,
    lines: Vec<String>,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "The session list is unavailable.")?;
    let Some(session) = sessions.get_mut(&id) else {
        return Ok(());
    };
    let mut text = String::new();
    for line in lines {
        // One message per line; only the protocol's input messages pass.
        let line = line.replace(['\r', '\n'], "");
        if matches!(line.chars().next(), Some('I' | 'A' | 'S')) {
            text.push_str(&line);
            text.push('\n');
        }
    }
    session
        .stdin
        .write_all(text.as_bytes())
        .and_then(|()| session.stdin.flush())
        .map_err(|e| format!("The ESP32 emulator is not running: {e}"))
}

/// Stops a session (asks the helper to quit, then ends it after a second).
#[tauri::command]
pub fn esp32_stop(state: State<'_, Esp32State>, id: String) {
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.remove(&id);
    }
}

/// Forgets prepared firmware files.
#[tauri::command]
pub fn esp32_forget(state: State<'_, Esp32State>, token: String) {
    let path = state
        .firmware
        .lock()
        .ok()
        .and_then(|mut f| f.remove(&token));
    if let Some(path) = path {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_are_padded_to_the_flash_size() {
        let state = Esp32State::default();
        let token = register_image(&state, &[0xE9, 1, 2, 3], 0x1000).unwrap();
        let path = state.firmware.lock().unwrap().get(&token).cloned().unwrap();
        let flash = std::fs::read(&path).unwrap();
        assert_eq!(flash.len(), FLASH_SIZE);
        assert_eq!(&flash[0x1000..0x1004], &[0xE9, 1, 2, 3]);
        assert_eq!(flash[0], 0xFF);
        assert_eq!(flash[FLASH_SIZE - 1], 0xFF);
        let _ = std::fs::remove_file(path);
        assert!(register_image(&state, &[], 0).is_err());
        assert!(register_image(&state, &vec![0u8; FLASH_SIZE], 0x1000).is_err());
    }

    #[test]
    fn ids_are_reduced_to_safe_characters() {
        assert_eq!(safe_id("../a b/c-1"), "abc-1");
    }
}
