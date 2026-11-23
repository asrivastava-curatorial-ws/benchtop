//! Compiling Arduino sketches for the Circuit Simulator's boards with arduino-cli,
//! installed on its own or bundled with Arduino IDE 2 (which shares its boards
//! and libraries).  An Uno sketch comes back as Intel HEX; an ESP32 sketch is
//! prepared as a flash image for the ESP32 emulator and comes back as a token.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::esp32::{register_image, Esp32State};

const CLI: &str = if cfg!(windows) {
    "arduino-cli.exe"
} else {
    "arduino-cli"
};

/// Where Arduino IDE 2 keeps its copy of arduino-cli.
fn ide_locations() -> Vec<PathBuf> {
    let inside = Path::new("resources")
        .join("app")
        .join("lib")
        .join("backend")
        .join("resources")
        .join(CLI);
    let mut roots: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(dir) = std::env::var_os(var) {
                roots.push(PathBuf::from(dir).join("Arduino IDE"));
            }
        }
        if let Some(dir) = dirs::data_local_dir() {
            roots.push(dir.join("Programs").join("Arduino IDE"));
        }
    } else if cfg!(target_os = "macos") {
        roots.push(PathBuf::from("/Applications/Arduino IDE.app/Contents"));
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("Applications/Arduino IDE.app/Contents"));
        }
    } else {
        roots.push(PathBuf::from("/opt/arduino-ide"));
        roots.push(PathBuf::from("/usr/share/arduino-ide"));
        roots.push(PathBuf::from("/usr/lib/arduino-ide"));
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("arduino-ide"));
            roots.push(home.join(".local/share/arduino-ide"));
            roots.push(home.join("Applications/arduino-ide"));
        }
    }
    roots.into_iter().map(|root| root.join(&inside)).collect()
}

/// arduino-cli: BENCHTOP_ARDUINO_CLI, then PATH, then Arduino IDE 2's copy.
pub fn find_cli() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("BENCHTOP_ARDUINO_CLI") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Ok(path) = which::which(CLI) {
        return Some(path);
    }
    ide_locations().into_iter().find(|path| path.is_file())
}

fn command(cli: &Path) -> Command {
    let mut command = Command::new(cli);
    command.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

/// Runs a command, returning (success, stdout + stderr), ending it after `limit`.
fn run(mut command: Command, limit: Duration) -> Result<(bool, String), String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not run arduino-cli: {e}"))?;
    let mut out = child.stdout.take();
    let mut err = child.stderr.take();
    let out_thread = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(out) = out.as_mut() {
            let _ = out.read_to_string(&mut text);
        }
        text
    });
    let err_thread = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(err) = err.as_mut() {
            let _ = err.read_to_string(&mut text);
        }
        text
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() > limit => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(format!("arduino-cli failed: {e}")),
        }
    };
    let mut text = out_thread.join().unwrap_or_default();
    let errors = err_thread.join().unwrap_or_default();
    if !errors.is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&errors);
    }
    match status {
        Some(status) => Ok((status.success(), text)),
        None => Ok((
            false,
            format!("{text}\nStopped after {} minutes.", limit.as_secs() / 60),
        )),
    }
}

/// Installed board packages from `arduino-cli core list --json` (1.x and 0.x layouts).
fn parse_cores(json: &Value) -> Vec<Value> {
    let list = json
        .get("platforms")
        .and_then(Value::as_array)
        .or_else(|| json.as_array())
        .cloned()
        .unwrap_or_default();
    list.iter()
        .filter_map(|core| {
            let id = core.get("id")?.as_str()?;
            let version = core
                .get("installed_version")
                .or_else(|| core.get("installed"))
                .and_then(Value::as_str)
                .unwrap_or("");
            Some(json!({ "id": id, "version": version }))
        })
        .collect()
}

/// arduino-cli's location, version and installed board packages.
#[tauri::command]
pub async fn arduino_info() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(cli) = find_cli() else {
            return json!({ "path": null, "version": "", "cores": [] });
        };
        let version = run(
            {
                let mut c = command(&cli);
                c.args(["version", "--json"]);
                c
            },
            Duration::from_secs(20),
        )
        .ok()
        .and_then(|(_, text)| serde_json::from_str::<Value>(&text).ok())
        .and_then(|v| {
            v.get("VersionString")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
        let cores = run(
            {
                let mut c = command(&cli);
                c.args(["core", "list", "--json"]);
                c
            },
            Duration::from_secs(30),
        )
        .ok()
        .and_then(|(_, text)| serde_json::from_str::<Value>(&text).ok())
        .map(|v| parse_cores(&v))
        .unwrap_or_default();
        json!({ "path": cli.display().to_string(), "version": version, "cores": cores })
    })
    .await
    .unwrap_or_else(|_| json!({ "path": null, "version": "", "cores": [] }))
}

/// A merged ESP32 flash image from arduino-cli's build folder: the
/// sketch.ino.merged.bin that arduino-esp32 3.x writes, or one assembled from
/// the bootloader (0x1000), partition table (0x8000) and app (0x10000).
fn esp32_image(out: &Path) -> Result<Vec<u8>, String> {
    if let Ok(merged) = std::fs::read(out.join("sketch.ino.merged.bin")) {
        return Ok(merged);
    }
    let read = |name: &str| {
        std::fs::read(out.join(name)).map_err(|_| format!("The build did not produce {name}."))
    };
    let bootloader = read("sketch.ino.bootloader.bin")?;
    let partitions = read("sketch.ino.partitions.bin")?;
    let app = read("sketch.ino.bin")?;
    let mut image = vec![0xFFu8; 0x10000 + app.len()];
    if bootloader.len() > 0x7000 || partitions.len() > 0x1000 {
        return Err("The bootloader or partition table is larger than expected.".into());
    }
    image[0x1000..0x1000 + bootloader.len()].copy_from_slice(&bootloader);
    image[0x8000..0x8000 + partitions.len()].copy_from_slice(&partitions);
    image[0x10000..].copy_from_slice(&app);
    Ok(image)
}

/// Compiles `sketch` for "uno" or "esp32".  Returns {ok, log, hex?, token?, size?};
/// a sketch that does not compile is ok: false with the compiler's messages.
#[tauri::command]
pub async fn arduino_compile(
    app: AppHandle,
    board: String,
    sketch: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cli = find_cli().ok_or(
            "arduino-cli was not found. Install Arduino IDE 2 or arduino-cli, or set BENCHTOP_ARDUINO_CLI to its path.",
        )?;
        let (fqbn, core) = match board.as_str() {
            "uno" => ("arduino:avr:uno", "arduino:avr"),
            "esp32" => ("esp32:esp32:esp32", "esp32:esp32"),
            _ => return Err(format!("Unknown board {board}.")),
        };
        let dir = dirs::cache_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("app.benchtop.desktop")
            .join("arduino")
            .join(format!(
                "{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or_default()
            ));
        let sketch_dir = dir.join("sketch");
        let out = dir.join("build");
        crate::files::create_private_dir(&sketch_dir)
            .map_err(|e| format!("Could not prepare the sketch: {e}"))?;
        std::fs::write(sketch_dir.join("sketch.ino"), sketch.as_bytes())
            .map_err(|e| format!("Could not prepare the sketch: {e}"))?;
        let mut compile = command(&cli);
        compile
            .args(["compile", "--fqbn", fqbn, "--no-color", "--warnings", "default", "--output-dir"])
            .arg(&out)
            .arg(&sketch_dir);
        let result = run(compile, Duration::from_secs(15 * 60));
        let finish = |value: Result<Value, String>| {
            let _ = std::fs::remove_dir_all(&dir);
            value
        };
        let (ok, log) = match result {
            Ok(r) => r,
            Err(e) => return finish(Err(e)),
        };
        if !ok {
            let advice = if log.contains("platform not installed") || log.contains("Platform '") || (log.contains("not found") && log.contains(core)) {
                format!("\nInstall the {core} boards in Arduino IDE (Tools → Board → Boards Manager) or with: arduino-cli core install {core}")
            } else {
                String::new()
            };
            return finish(Ok(json!({ "ok": false, "log": format!("{log}{advice}") })));
        }
        if board == "uno" {
            let hex = std::fs::read_to_string(out.join("sketch.ino.hex"))
                .map_err(|_| "The build did not produce sketch.ino.hex.".to_string());
            return finish(hex.map(|hex| json!({ "ok": true, "log": log, "hex": hex })));
        }
        let image = match esp32_image(&out) {
            Ok(image) => image,
            Err(e) => return finish(Err(e)),
        };
        let size = image.len();
        let state = app.state::<Esp32State>();
        let token = register_image(&state, &image, 0);
        finish(token.map(|token| json!({ "ok": true, "log": log, "token": token, "size": size })))
    })
    .await
    .map_err(|e| format!("The compiler stopped: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_both_core_list_layouts() {
        let new = json!({ "platforms": [{ "id": "arduino:avr", "installed_version": "1.8.6" }] });
        let old = json!([{ "id": "esp32:esp32", "installed": "2.0.17" }]);
        assert_eq!(
            parse_cores(&new),
            vec![json!({ "id": "arduino:avr", "version": "1.8.6" })]
        );
        assert_eq!(
            parse_cores(&old),
            vec![json!({ "id": "esp32:esp32", "version": "2.0.17" })]
        );
        assert!(parse_cores(&json!({})).is_empty());
    }

    #[test]
    fn assembles_an_esp32_image_from_its_parts() {
        let dir = std::env::temp_dir().join(format!("benchtop-esp32-image-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("sketch.ino.bootloader.bin"), [0xE9, 1]).unwrap();
        std::fs::write(dir.join("sketch.ino.partitions.bin"), [0xAA, 0x50]).unwrap();
        std::fs::write(dir.join("sketch.ino.bin"), [0xE9, 2, 3]).unwrap();
        let image = esp32_image(&dir).unwrap();
        assert_eq!(image.len(), 0x10003);
        assert_eq!(&image[0x1000..0x1002], &[0xE9, 1]);
        assert_eq!(&image[0x8000..0x8002], &[0xAA, 0x50]);
        assert_eq!(&image[0x10000..], &[0xE9, 2, 3]);
        assert_eq!(image[0], 0xFF);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
