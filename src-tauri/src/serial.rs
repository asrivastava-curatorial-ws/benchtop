//! Serial ports for the Serial Monitor tool: list them, open one, stream what it
//! sends to the page as `serial-data` events, write to it and close it.

use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortType, StopBits};
use tauri::{AppHandle, Emitter, State};

struct OpenPort {
    port: Box<dyn SerialPort>,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct SerialState {
    ports: Mutex<HashMap<String, OpenPort>>,
}

/// The ports on this computer, with USB maker and product where known.
#[tauri::command]
pub fn serial_ports() -> Result<Value, String> {
    let ports = serialport::available_ports()
        .map_err(|error| format!("Could not list serial ports: {error}"))?;
    Ok(json!(ports
        .into_iter()
        .map(|port| {
            let (kind, detail) = match port.port_type {
                SerialPortType::UsbPort(info) => (
                    "usb",
                    format!(
                        "{} {} ({:04x}:{:04x})",
                        info.manufacturer.unwrap_or_default(),
                        info.product.unwrap_or_default(),
                        info.vid,
                        info.pid
                    )
                    .trim()
                    .to_string(),
                ),
                SerialPortType::BluetoothPort => ("bluetooth", String::new()),
                SerialPortType::PciPort => ("pci", String::new()),
                SerialPortType::Unknown => ("other", String::new()),
            };
            json!({"name": port.port_name, "kind": kind, "detail": detail})
        })
        .collect::<Vec<_>>()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    port: String,
    baud: u32,
    #[serde(default = "eight")]
    data_bits: u8,
    #[serde(default)]
    parity: String,
    #[serde(default = "one")]
    stop_bits: u8,
    #[serde(default)]
    flow: String,
}

fn eight() -> u8 {
    8
}

fn one() -> u8 {
    1
}

/// Opens a port and starts a thread that forwards everything it receives.
#[tauri::command]
pub fn serial_open(
    app: AppHandle,
    request: OpenRequest,
    state: State<'_, SerialState>,
) -> Result<(), String> {
    if state
        .ports
        .lock()
        .expect("ports")
        .contains_key(&request.port)
    {
        return Err(format!("{} is already open.", request.port));
    }
    let data_bits = match request.data_bits {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    };
    let parity = match request.parity.as_str() {
        "even" => Parity::Even,
        "odd" => Parity::Odd,
        _ => Parity::None,
    };
    let stop_bits = if request.stop_bits == 2 {
        StopBits::Two
    } else {
        StopBits::One
    };
    let flow = match request.flow.as_str() {
        "hardware" => FlowControl::Hardware,
        "software" => FlowControl::Software,
        _ => FlowControl::None,
    };
    let port = serialport::new(&request.port, request.baud)
        .data_bits(data_bits)
        .parity(parity)
        .stop_bits(stop_bits)
        .flow_control(flow)
        .timeout(Duration::from_millis(40))
        .open()
        .map_err(|error| format!("Could not open {}: {error}", request.port))?;
    let mut reader = port
        .try_clone()
        .map_err(|error| format!("Could not read from {}: {error}", request.port))?;
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let name = request.port.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        while !flag.load(Ordering::Relaxed) {
            match reader.read(&mut buffer) {
                Ok(0) => {}
                Ok(read) => {
                    let _ = app.emit(
                        "serial-data",
                        json!({"port": name, "bytes": buffer[..read].to_vec()}),
                    );
                }
                Err(error)
                    if error.kind() == ErrorKind::TimedOut
                        || error.kind() == ErrorKind::Interrupted => {}
                Err(error) => {
                    let _ = app.emit(
                        "serial-closed",
                        json!({"port": name, "error": error.to_string()}),
                    );
                    break;
                }
            }
        }
    });
    state
        .ports
        .lock()
        .expect("ports")
        .insert(request.port, OpenPort { port, stop });
    Ok(())
}

#[tauri::command]
pub fn serial_write(
    port: String,
    bytes: Vec<u8>,
    state: State<'_, SerialState>,
) -> Result<(), String> {
    let mut ports = state.ports.lock().expect("ports");
    let open = ports.get_mut(&port).ok_or("The port is not open.")?;
    open.port
        .write_all(&bytes)
        .and_then(|()| open.port.flush())
        .map_err(|error| format!("Could not send: {error}"))
}

/// Sets the DTR and RTS lines (many boards reset when DTR drops).
#[tauri::command]
pub fn serial_signals(
    port: String,
    dtr: Option<bool>,
    rts: Option<bool>,
    state: State<'_, SerialState>,
) -> Result<(), String> {
    let mut ports = state.ports.lock().expect("ports");
    let open = ports.get_mut(&port).ok_or("The port is not open.")?;
    if let Some(level) = dtr {
        open.port
            .write_data_terminal_ready(level)
            .map_err(|error| error.to_string())?;
    }
    if let Some(level) = rts {
        open.port
            .write_request_to_send(level)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn serial_close(port: String, state: State<'_, SerialState>) {
    if let Some(open) = state.ports.lock().expect("ports").remove(&port) {
        open.stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn listing_ports_never_fails_on_a_machine_without_any() {
        assert!(super::serial_ports().is_ok());
    }
}
