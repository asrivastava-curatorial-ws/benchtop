//! AI tools on the desktop: the model store, downloads, and the worker process
//! that runs ONNX models (see `worker.rs`).  Everything runs on this computer;
//! the network is used only to download a model when you ask for it.

pub mod catalog;
pub mod image_ops;
pub mod protocol;
pub mod speech;
pub mod store;
pub mod worker;

#[cfg(test)]
mod tests;

use std::io::BufReader;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::files::PickedFiles;
use catalog::Kind;
use protocol::{read_frame, write_frame, Frame};
use store::Store;

struct Worker {
    child: Arc<Mutex<Child>>,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    runtime: PathBuf,
    gpu: bool,
}

pub struct AiState {
    pub store: Store,
    worker: Mutex<Option<Worker>>,
    running: Mutex<Option<Arc<Mutex<Child>>>>,
    job: tokio::sync::Mutex<()>,
    last_used: Mutex<Instant>,
}

impl AiState {
    pub fn new(root: PathBuf) -> Self {
        AiState {
            store: Store::new(root),
            worker: Mutex::new(None),
            running: Mutex::new(None),
            job: tokio::sync::Mutex::new(()),
            last_used: Mutex::new(Instant::now()),
        }
    }

    fn kill_worker(&self) {
        if let Some(worker) = self.worker.lock().expect("worker").take() {
            if let Ok(mut child) = worker.child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn spawn_worker(runtime: PathBuf, gpu: bool) -> Result<Worker, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("Cannot find the app executable: {error}"))?;
    let mut command = Command::new(exe);
    command
        .arg("--ai-worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if let Some(folder) = runtime.parent() {
        // The CUDA provider libraries sit next to the runtime and load by name.
        #[cfg(target_os = "linux")]
        command.env(
            "LD_LIBRARY_PATH",
            match std::env::var_os("LD_LIBRARY_PATH") {
                Some(existing) => {
                    let mut value = folder.as_os_str().to_owned();
                    value.push(":");
                    value.push(existing);
                    value
                }
                None => folder.as_os_str().to_owned(),
            },
        );
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
            let _ = folder;
        }
        #[cfg(target_os = "macos")]
        let _ = folder;
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("The AI worker could not start: {error}"))?;
    let stdin = child.stdin.take().ok_or("no worker stdin")?;
    let stdout = BufReader::new(child.stdout.take().ok_or("no worker stdout")?);
    Ok(Worker {
        child: Arc::new(Mutex::new(child)),
        stdin,
        stdout,
        runtime,
        gpu,
    })
}

fn model_path(store: &Store, id: &str, expected: &[Kind]) -> Result<PathBuf, String> {
    let item = catalog::find(id).ok_or_else(|| format!("Unknown model \"{id}\"."))?;
    if !expected.contains(&item.kind) {
        return Err(format!(
            "{} is not the right kind of model for this tool.",
            item.name
        ));
    }
    if !store.is_installed(&item) {
        return Err(format!(
            "{} is not downloaded yet. Open Settings → AI models to get it.",
            item.name
        ));
    }
    Ok(store.folder(&item).join(catalog::stored_files(&item)[0]))
}

fn runtime_path(store: &Store, gpu: bool) -> Result<(PathBuf, bool), String> {
    if gpu {
        // CUDA on Linux, DirectML on Windows: a separate runtime build with the GPU provider.
        for item in catalog::items()
            .into_iter()
            .filter(|item| item.kind == Kind::GpuRuntime)
        {
            if store.is_installed(&item) {
                return Ok((store.folder(&item).join(catalog::RUNTIME_LIBRARY), true));
            }
        }
    }
    let item = catalog::find("runtime").expect("runtime item");
    if !store.is_installed(&item) {
        return Err("The AI engine (ONNX Runtime) is not downloaded yet. Open Settings → AI models to get it.".into());
    }
    // Core ML ships in the standard macOS runtime; elsewhere the GPU needs the runtime above.
    Ok((
        store.folder(&item).join(catalog::RUNTIME_LIBRARY),
        gpu && cfg!(target_os = "macos"),
    ))
}

/// Builds the worker request: resolves model ids to files and picked-file tokens to paths.
pub(crate) fn build_request(
    state: &AiState,
    picked: &PickedFiles,
    request: &Value,
) -> Result<(Value, PathBuf, bool), String> {
    let op = request
        .get("op")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let model = request
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let want_gpu = request.get("gpu").and_then(Value::as_bool).unwrap_or(true);
    let (runtime, gpu) = runtime_path(&state.store, want_gpu)?;
    let mut header = json!({
        "op": op,
        "runtime": runtime,
        "gpu": gpu,
        "options": request.get("options").cloned().unwrap_or(Value::Null),
        "name": request.get("name").cloned().unwrap_or(Value::Null),
    });
    let object = header.as_object_mut().expect("object");
    match op {
        "background" => {
            object.insert(
                "model".into(),
                json!(model_path(&state.store, model, &[Kind::Background])?),
            );
        }
        "upscale" => {
            object.insert(
                "model".into(),
                json!(model_path(&state.store, model, &[Kind::Upscale])?),
            );
        }
        "faces" => {
            if request.pointer("/options/boxes").is_none() {
                object.insert(
                    "model".into(),
                    json!(model_path(
                        &state.store,
                        if model.is_empty() { "yunet" } else { model },
                        &[Kind::Faces]
                    )?),
                );
            }
        }
        "erase" => {
            object.insert(
                "model".into(),
                json!(model_path(
                    &state.store,
                    if model.is_empty() { "migan" } else { model },
                    &[Kind::Eraser]
                )?),
            );
        }
        "transcribe" => {
            let item = catalog::find(model)
                .filter(|item| item.kind == Kind::Speech)
                .ok_or("Choose a speech model.")?;
            if !state.store.is_installed(&item) {
                return Err(format!(
                    "{} is not downloaded yet. Open Settings → AI models to get it.",
                    item.name
                ));
            }
            let folder = state.store.folder(&item);
            object.insert("encoder".into(), json!(folder.join("encoder.onnx")));
            object.insert("decoder".into(), json!(folder.join("decoder.onnx")));
            object.insert("tokens".into(), json!(folder.join("tokens.txt")));
            if let Some(vad) = state.store.file("silero-vad", "silero_vad.onnx") {
                object.insert("vad".into(), json!(vad));
            }
            if let Some(token) = request.get("file").and_then(Value::as_str) {
                let path = picked
                    .path(token)
                    .ok_or("Choose the file again; this one is no longer available.")?;
                object.insert("path".into(), json!(path));
            }
        }
        "probe" => {}
        other => return Err(format!("Unknown AI operation \"{other}\".")),
    }
    Ok((header, runtime, gpu))
}

/// Runs one AI job.  The raw body carries the input file (and the mask for the
/// eraser, after a u64 length); the `x-ai` header carries the JSON request.
/// The answer is a u32 header length, the JSON header, then the output bytes.
#[tauri::command]
pub async fn ai_run(
    app: AppHandle,
    request: Request<'_>,
    state: State<'_, AiState>,
    picked: State<'_, PickedFiles>,
) -> Result<Response, String> {
    let header_text = request
        .headers()
        .get("x-ai")
        .and_then(|value| value.to_str().ok())
        .map(|value| percent_decode_str(value).decode_utf8_lossy().into_owned())
        .ok_or("Missing request.")?;
    let json_request: Value =
        serde_json::from_str(&header_text).map_err(|error| format!("Bad request: {error}"))?;
    let body: Vec<u8> = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => Vec::new(),
    };
    let (header, runtime, gpu) = build_request(&state, &picked, &json_request)?;
    // Split the body: [u64 first length][first][rest].
    let mut frame = Frame::new(header);
    if body.len() >= 8 {
        let first = u64::from_le_bytes(body[..8].try_into().expect("8 bytes")) as usize;
        let first = first.min(body.len() - 8);
        frame.attachments.push(body[8..8 + first].to_vec());
        if body.len() > 8 + first {
            frame.attachments.push(body[8 + first..].to_vec());
        }
    }
    let _job = state.job.lock().await;
    *state.last_used.lock().expect("clock") = Instant::now();
    let app_for_job = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Frame, String> {
        let state = app_for_job.state::<AiState>();
        let mut slot = state.worker.lock().expect("worker").take();
        if slot.as_ref().is_some_and(|worker| worker.runtime != runtime || worker.gpu != gpu) {
            if let Some(worker) = slot.take() {
                if let Ok(mut child) = worker.child.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
        let mut worker = match slot {
            Some(worker) => worker,
            None => spawn_worker(runtime.clone(), gpu)?,
        };
        *state.running.lock().expect("running") = Some(worker.child.clone());
        let outcome = (|| -> Result<Frame, String> {
            write_frame(&mut worker.stdin, &frame).map_err(|error| format!("The AI worker stopped: {error}"))?;
            loop {
                let reply = read_frame(&mut worker.stdout)
                    .map_err(|error| format!("The AI worker stopped: {error}"))?
                    .ok_or("The AI job was cancelled or the worker stopped (it may have run out of memory).")?;
                match reply.header.get("type").and_then(Value::as_str) {
                    Some("progress") => {
                        let _ = app_for_job.emit("ai-progress", reply.header.clone());
                    }
                    Some("error") => return Err(reply.header.get("message").and_then(Value::as_str).unwrap_or("The AI job failed.").to_string()),
                    _ => return Ok(reply),
                }
            }
        })();
        *state.running.lock().expect("running") = None;
        match &outcome {
            // A protocol failure leaves the worker in an unknown state: discard it.
            Err(message) if message.starts_with("The AI worker stopped") || message.starts_with("The AI job was cancelled") => {
                if let Ok(mut child) = worker.child.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            _ => *state.worker.lock().expect("worker") = Some(worker),
        }
        outcome
    })
    .await
    .map_err(|error| format!("The AI job failed: {error}"))??;
    schedule_idle_shutdown(app.clone());
    let header = serde_json::to_vec(&result.header).map_err(|error| error.to_string())?;
    let mut out =
        Vec::with_capacity(4 + header.len() + result.attachments.first().map_or(0, Vec::len));
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    if let Some(payload) = result.attachments.into_iter().next() {
        out.extend_from_slice(&payload);
    }
    Ok(Response::new(out))
}

/// Ends an idle worker after three minutes so its memory goes back to the system.
fn schedule_idle_shutdown(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(180)).await;
        let state = app.state::<AiState>();
        let idle = state
            .last_used
            .lock()
            .map(|t| t.elapsed() >= Duration::from_secs(175))
            .unwrap_or(false);
        if idle {
            if let Ok(_guard) = state.job.try_lock() {
                state.kill_worker();
            }
        }
    });
}

/// Stops the running job by ending the worker process.
#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>) {
    if let Some(child) = state.running.lock().expect("running").as_ref() {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
}

#[tauri::command]
pub fn ai_status(state: State<'_, AiState>) -> Value {
    let items: Vec<Value> = catalog::items()
        .into_iter()
        .map(|item| {
            let mut value = serde_json::to_value(item).unwrap_or(Value::Null);
            if let Some(object) = value.as_object_mut() {
                object.insert("installed".into(), json!(state.store.is_installed(&item)));
            }
            value
        })
        .collect();
    json!({
        "folder": state.store.root,
        "mirror": catalog::MIRROR,
        "threads": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "items": items,
    })
}

pub(crate) fn download_client() -> Result<reqwest::Client, String> {
    crate::net::ensure_crypto_provider();
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .user_agent(concat!(
            "Benchtop/",
            env!("CARGO_PKG_VERSION"),
            " (model download)"
        ))
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn ai_install(
    app: AppHandle,
    id: String,
    state: State<'_, AiState>,
) -> Result<(), String> {
    let item = catalog::find(&id).ok_or_else(|| format!("Unknown item \"{id}\"."))?;
    let client = download_client()?;
    let report = |progress: store::Progress| {
        let _ = app.emit("ai-download", progress);
    };
    let result = state.store.install(&item, &client, &report).await;
    if let Err(message) = &result {
        report(store::Progress {
            id: id.clone(),
            stage: "error",
            received: 0,
            total: item.download.size,
            message: Some(message.clone()),
        });
    }
    result
}

#[tauri::command]
pub fn ai_cancel_install(id: String, state: State<'_, AiState>) {
    state.store.cancel(&id);
}

#[tauri::command]
pub fn ai_remove(id: String, state: State<'_, AiState>) -> Result<(), String> {
    let item = catalog::find(&id).ok_or_else(|| format!("Unknown item \"{id}\"."))?;
    if item.kind == Kind::Runtime || item.kind == Kind::GpuRuntime {
        state.kill_worker();
    }
    state
        .store
        .remove(&item)
        .map_err(|error| format!("Could not delete {}: {error}", item.name))
}

/// Installs model files from a folder (a USB stick, the NAS) without downloading.
#[tauri::command]
pub async fn ai_import(app: AppHandle) -> Result<Value, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(json!({"imported": [], "rejected": [], "cancelled": true}));
    };
    let folder = folder.into_path().map_err(|error| error.to_string())?;
    let handle = app.clone();
    let (imported, rejected) = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AiState>();
        let report = |progress: store::Progress| {
            let _ = handle.emit("ai-download", progress);
        };
        state.store.import_folder(&folder, &report)
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(json!({"imported": imported, "rejected": rejected}))
}

/// The folder holding downloaded models, created if needed.
pub fn models_root(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("benchtop"));
    let root = base.join("ai");
    let _ = std::fs::create_dir_all(&root);
    root
}
