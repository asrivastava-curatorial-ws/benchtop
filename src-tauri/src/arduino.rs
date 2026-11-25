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

/// The arduino-cli board and boards package for each simulated board, and
/// whether the build is Intel HEX (AVR boards) or an ESP32 flash image.
/// What a build for a simulated board gives back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Output {
    /// Intel HEX, for the AVR boards emulated in the page.
    Hex,
    /// A UF2 file, for the Raspberry Pi Pico emulated in the page.
    Uf2,
    /// A flash image for the ESP32 emulator helper.
    Esp32,
}

fn compile_target(board: &str) -> Option<(&'static str, &'static str, Output)> {
    match board {
        "uno" => Some(("arduino:avr:uno", "arduino:avr", Output::Hex)),
        "nano" => Some(("arduino:avr:nano", "arduino:avr", Output::Hex)),
        "mega" => Some((
            "arduino:avr:mega:cpu=atmega2560",
            "arduino:avr",
            Output::Hex,
        )),
        "attiny85" => Some((
            "ATTinyCore:avr:attinyx5:chip=85,clock=8internal",
            "ATTinyCore:avr",
            Output::Hex,
        )),
        "pico" => Some(("rp2040:rp2040:rpipico", "rp2040:rp2040", Output::Uf2)),
        "esp32" => Some(("esp32:esp32:esp32", "esp32:esp32", Output::Esp32)),
        _ => None,
    }
}

/// Compiles `sketch` for a simulated board ("uno", "nano", "mega", "attiny85",
/// "pico" or "esp32").  Returns {ok, log, hex?, uf2?, token?, size?} (uf2 in Base64);
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
        let (fqbn, core, output) = compile_target(&board).ok_or(format!("Unknown board {board}."))?;
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
                if core == "rp2040:rp2040" {
                    "\nInstall Earle Philhower's Raspberry Pi Pico boards: add https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json to the board manager URLs, then: arduino-cli core install rp2040:rp2040".to_string()
                } else {
                    format!("\nInstall the {core} boards in Arduino IDE (Tools → Board → Boards Manager) or with: arduino-cli core install {core}")
                }
            } else {
                String::new()
            };
            return finish(Ok(json!({ "ok": false, "log": format!("{log}{advice}") })));
        }
        if output == Output::Hex {
            let hex = std::fs::read_to_string(out.join("sketch.ino.hex"))
                .map_err(|_| "The build did not produce sketch.ino.hex.".to_string());
            return finish(hex.map(|hex| json!({ "ok": true, "log": log, "hex": hex })));
        }
        if output == Output::Uf2 {
            use base64::Engine as _;
            let uf2 = std::fs::read(out.join("sketch.ino.uf2"))
                .map_err(|_| "The build did not produce sketch.ino.uf2.".to_string());
            return finish(uf2.map(|bytes| {
                json!({ "ok": true, "log": log, "uf2": base64::engine::general_purpose::STANDARD.encode(&bytes), "size": bytes.len() })
            }));
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

/// Serial ports and the boards recognised on them, from `arduino-cli board list --json`
/// (the 1.x layout with "detected_ports", and the older bare list).
fn parse_boards(json: &Value) -> Vec<Value> {
    let list = json
        .get("detected_ports")
        .and_then(Value::as_array)
        .or_else(|| json.as_array())
        .cloned()
        .unwrap_or_default();
    list.iter()
        .filter_map(|entry| {
            let port = entry.get("port").unwrap_or(entry);
            let address = port.get("address")?.as_str()?;
            // Network ports and the like cannot take an upload over serial.
            let protocol = port
                .get("protocol")
                .and_then(Value::as_str)
                .unwrap_or("serial");
            if protocol != "serial" {
                return None;
            }
            let board = entry
                .get("matching_boards")
                .or_else(|| entry.get("boards"))
                .and_then(Value::as_array)
                .and_then(|boards| boards.first());
            let text = |value: Option<&Value>| {
                value
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            Some(json!({
                "port": address,
                "label": text(port.get("label").or_else(|| port.get("protocol_label"))),
                "name": text(board.and_then(|b| b.get("name"))),
                "fqbn": text(board.and_then(|b| b.get("fqbn").or_else(|| b.get("FQBN")))),
            }))
        })
        .collect()
}

/// The serial ports arduino-cli sees, with the boards it recognises on them.
#[tauri::command]
pub async fn arduino_boards() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let cli = find_cli().ok_or(
            "arduino-cli was not found. Install Arduino IDE 2 or arduino-cli, or set BENCHTOP_ARDUINO_CLI to its path.",
        )?;
        let mut list = command(&cli);
        list.args(["board", "list", "--json"]);
        let (ok, text) = run(list, Duration::from_secs(40))?;
        if !ok {
            return Err(format!("arduino-cli could not list the ports: {}", text.trim()));
        }
        let json: Value = serde_json::from_str(&text)
            .map_err(|_| "arduino-cli gave a list of ports that could not be read.".to_string())?;
        Ok(Value::Array(parse_boards(&json)))
    })
    .await
    .map_err(|e| format!("Looking for boards stopped: {e}"))?
}

/// A board identifier such as arduino:avr:uno or esp32:esp32:esp32:UploadSpeed=115200.
fn valid_fqbn(fqbn: &str) -> bool {
    let parts = fqbn.split(':').count();
    (3..=4).contains(&parts)
        && fqbn.len() <= 200
        && !fqbn.starts_with('-')
        && fqbn
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '-' | '.' | '=' | ','))
}

/// A port's address: COM3, /dev/ttyACM0, /dev/cu.usbmodem14101.  It goes to arduino-cli as an
/// argument, so it must not look like an option.
fn valid_port(port: &str) -> bool {
    !port.is_empty()
        && port.len() <= 200
        && !port.starts_with('-')
        && port
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | ':' | '\\'))
}

#[derive(serde::Deserialize)]
pub struct UploadRequest {
    fqbn: String,
    port: String,
    #[serde(default)]
    sketch: Option<String>,
    #[serde(default)]
    hex: Option<String>,
}

/// The arguments for arduino-cli: compile and upload a sketch folder, or upload a ready program.
fn upload_args(
    fqbn: &str,
    port: &str,
    sketch_dir: Option<&Path>,
    program: Option<&Path>,
) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = Vec::new();
    match (sketch_dir, program) {
        (Some(dir), _) => {
            for arg in [
                "compile",
                "--upload",
                "--fqbn",
                fqbn,
                "--port",
                port,
                "--no-color",
            ] {
                args.push(arg.into());
            }
            args.push(dir.into());
        }
        (None, Some(file)) => {
            for arg in [
                "upload",
                "--fqbn",
                fqbn,
                "--port",
                port,
                "--no-color",
                "--input-file",
            ] {
                args.push(arg.into());
            }
            args.push(file.into());
        }
        (None, None) => {}
    }
    args
}

/// Puts a program on a real board: a sketch is compiled for the board and uploaded, a compiled
/// program (Intel HEX) is uploaded as it is.  Returns {ok, log}; a failed upload is ok: false
/// with arduino-cli's messages.
#[tauri::command]
pub async fn arduino_upload(request: UploadRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !valid_fqbn(&request.fqbn) {
            return Err("This is not a board that arduino-cli knows by that name.".to_string());
        }
        if !valid_port(&request.port) {
            return Err("Choose the port the board is on.".to_string());
        }
        let cli = find_cli().ok_or(
            "arduino-cli was not found. Install Arduino IDE 2 or arduino-cli, or set BENCHTOP_ARDUINO_CLI to its path.",
        )?;
        let dir = dirs::cache_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("app.benchtop.desktop")
            .join("arduino")
            .join(format!(
                "upload-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or_default()
            ));
        let sketch_dir = dir.join("sketch");
        crate::files::create_private_dir(&sketch_dir)
            .map_err(|e| format!("Could not prepare the upload: {e}"))?;
        let finish = |value: Result<Value, String>| {
            let _ = std::fs::remove_dir_all(&dir);
            value
        };
        let args = if let Some(hex) = request.hex.as_deref() {
            if hex.len() > 4_000_000 || !hex.trim_start().starts_with(':') {
                return finish(Err("The compiled program is not an Intel HEX file.".to_string()));
            }
            let file = dir.join("program.hex");
            if let Err(e) = std::fs::write(&file, hex.as_bytes()) {
                return finish(Err(format!("Could not prepare the upload: {e}")));
            }
            upload_args(&request.fqbn, &request.port, None, Some(&file))
        } else if let Some(sketch) = request.sketch.as_deref() {
            if let Err(e) = std::fs::write(sketch_dir.join("sketch.ino"), sketch.as_bytes()) {
                return finish(Err(format!("Could not prepare the sketch: {e}")));
            }
            upload_args(&request.fqbn, &request.port, Some(&sketch_dir), None)
        } else {
            return finish(Err("There is nothing to upload.".to_string()));
        };
        let mut upload = command(&cli);
        upload.args(args);
        let result = run(upload, Duration::from_secs(15 * 60));
        finish(result.map(|(ok, log)| {
            let advice = if !ok && (log.contains("platform not installed") || log.contains("Platform '")) {
                "\nInstall the board's package in Arduino IDE (Tools → Board → Boards Manager) or with: arduino-cli core install <package>"
            } else if !ok && (log.contains("ermission denied") || log.contains("Access is denied")) {
                "\nThe port is in use or not allowed: close other programs using it (a serial monitor, Benchtop's own connection). On Linux, your user needs to be in the dialout group."
            } else {
                ""
            };
            json!({ "ok": ok, "log": format!("{log}{advice}") })
        }))
    })
    .await
    .map_err(|e| format!("The upload stopped: {e}"))?
}

#[cfg(test)]
mod tests {

    #[test]
    fn knows_the_simulated_boards() {
        assert_eq!(
            compile_target("uno"),
            Some(("arduino:avr:uno", "arduino:avr", Output::Hex))
        );
        assert_eq!(
            compile_target("mega").map(|t| t.0),
            Some("arduino:avr:mega:cpu=atmega2560")
        );
        assert_eq!(compile_target("nano").map(|t| t.2), Some(Output::Hex));
        assert_eq!(compile_target("esp32").map(|t| t.2), Some(Output::Esp32));
        assert_eq!(
            compile_target("pico"),
            Some(("rp2040:rp2040:rpipico", "rp2040:rp2040", Output::Uf2))
        );
        assert_eq!(
            compile_target("attiny85").map(|t| t.1),
            Some("ATTinyCore:avr")
        );
        assert_eq!(compile_target("uno; rm -rf /"), None);
        // Every board the simulator compiles for passes the identifier check used for uploads.
        for board in ["uno", "nano", "mega", "attiny85", "pico", "esp32"] {
            assert!(valid_fqbn(compile_target(board).unwrap().0), "{board}");
        }
    }

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
    fn reads_both_board_list_layouts() {
        let new = json!({ "detected_ports": [
            { "matching_boards": [{ "name": "Arduino Uno", "fqbn": "arduino:avr:uno" }],
              "port": { "address": "/dev/ttyACM0", "label": "/dev/ttyACM0", "protocol": "serial", "protocol_label": "Serial Port (USB)" } },
            { "port": { "address": "/dev/ttyUSB0", "protocol": "serial", "protocol_label": "Serial Port (USB)" } },
            { "port": { "address": "192.168.1.20", "protocol": "network" } }
        ] });
        assert_eq!(
            parse_boards(&new),
            vec![
                json!({ "port": "/dev/ttyACM0", "label": "/dev/ttyACM0", "name": "Arduino Uno", "fqbn": "arduino:avr:uno" }),
                json!({ "port": "/dev/ttyUSB0", "label": "Serial Port (USB)", "name": "", "fqbn": "" }),
            ]
        );
        let old = json!([{ "address": "COM3", "protocol": "serial", "boards": [{ "name": "Arduino Nano", "FQBN": "arduino:avr:nano" }] }]);
        assert_eq!(
            parse_boards(&old),
            vec![
                json!({ "port": "COM3", "label": "", "name": "Arduino Nano", "fqbn": "arduino:avr:nano" })
            ]
        );
        assert!(parse_boards(&json!({})).is_empty());
    }

    #[test]
    fn takes_only_board_names_and_ports_that_cannot_be_options() {
        for good in [
            "arduino:avr:uno",
            "esp32:esp32:esp32",
            "arduino:avr:nano:cpu=atmega328old",
            "esp32:esp32:esp32:UploadSpeed=115200,FlashFreq=40",
        ] {
            assert!(valid_fqbn(good), "{good}");
        }
        for bad in [
            "",
            "uno",
            "arduino:avr",
            "--config-file:a:b",
            "a:b:c:d:e",
            "arduino:avr:uno; rm -rf /",
            "arduino:avr:uno --port x",
        ] {
            assert!(!valid_fqbn(bad), "{bad}");
        }
        for good in [
            "COM3",
            "/dev/ttyACM0",
            "/dev/cu.usbmodem14101",
            "/dev/serial/by-id/usb-Arduino_Uno-if00",
            "\\\\.\\COM12",
        ] {
            assert!(valid_port(good), "{good}");
        }
        for bad in [
            "",
            "-p",
            "--input-file=/etc/passwd",
            "COM3 --verbose",
            "/dev/tty ACM0",
            "a\nb",
        ] {
            assert!(!valid_port(bad), "{bad}");
        }
    }

    #[test]
    fn builds_the_arguments_for_an_upload() {
        let text = |args: Vec<std::ffi::OsString>| {
            args.iter()
                .map(|a| a.to_string_lossy().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            text(upload_args(
                "arduino:avr:uno",
                "/dev/ttyACM0",
                Some(Path::new("/tmp/s")),
                None
            )),
            [
                "compile",
                "--upload",
                "--fqbn",
                "arduino:avr:uno",
                "--port",
                "/dev/ttyACM0",
                "--no-color",
                "/tmp/s"
            ]
        );
        assert_eq!(
            text(upload_args(
                "arduino:avr:uno",
                "COM3",
                None,
                Some(Path::new("/tmp/p.hex"))
            )),
            [
                "upload",
                "--fqbn",
                "arduino:avr:uno",
                "--port",
                "COM3",
                "--no-color",
                "--input-file",
                "/tmp/p.hex"
            ]
        );
        assert!(upload_args("a:b:c", "COM3", None, None).is_empty());
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
