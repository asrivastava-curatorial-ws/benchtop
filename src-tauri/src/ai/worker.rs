//! The AI worker: the same executable started with `--ai-worker`.  It loads ONNX
//! Runtime from the downloaded library, keeps model sessions warm between
//! jobs, and answers one framed request at a time on stdin/stdout.  Running the
//! models in their own process means a crash or an out-of-memory kill never
//! takes the window down, and cancelling a job is simply ending the process.

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use serde_json::{json, Value};

use super::protocol::{read_frame, write_frame, Frame};
use super::{image_ops, speech, tts};

static ENVIRONMENT: OnceLock<Result<(PathBuf, ort::environment::Environment), String>> =
    OnceLock::new();

/// Sends progress back to the app over the pipe, or to a callback (the command line).
pub enum Reply<'a> {
    Pipe(&'a mut dyn Write),
    Callback(&'a mut dyn FnMut(f64, &str)),
}

impl<'a> Reply<'a> {
    pub fn new(out: &'a mut dyn Write) -> Self {
        Reply::Pipe(out)
    }

    pub fn progress(&mut self, value: f64, stage: &str) {
        let value = value.clamp(0.0, 1.0);
        match self {
            Reply::Pipe(out) => {
                let _ = write_frame(
                    *out,
                    &Frame::new(json!({"type": "progress", "value": value, "stage": stage})),
                );
            }
            Reply::Callback(report) => report(value, stage),
        }
    }
}

pub struct Engine {
    gpu: bool,
    sessions: HashMap<PathBuf, Session>,
    /// Which execution provider served the last session that was created.
    pub device: String,
}

impl Engine {
    pub fn init(runtime: &Path, gpu: bool) -> Result<Self, String> {
        let result = ENVIRONMENT.get_or_init(|| {
            // The DirectML runtime needs its own DirectML.dll: Windows keeps an older copy in
            // System32 that would be found first.  Loading ours by full path makes the loader
            // reuse it when onnxruntime.dll asks for DirectML.dll by name.
            if let Some(directml) = runtime
                .parent()
                .map(|folder| folder.join("DirectML.dll"))
                .filter(|path| cfg!(target_os = "windows") && path.is_file())
            {
                ort::util::preload_dylib(&directml).map_err(|error| {
                    format!(
                        "Could not load DirectML from {}: {error}",
                        directml.display()
                    )
                })?;
            }
            let builder = ort::init_from(runtime).map_err(|error| {
                format!(
                    "Could not load ONNX Runtime from {}: {error}",
                    runtime.display()
                )
            })?;
            let environment = builder
                .with_name("benchtop")
                .build()
                .map_err(|error| format!("ONNX Runtime did not start: {error}"))?;
            Ok((runtime.to_path_buf(), environment))
        });
        match result {
            Ok((loaded, _)) if loaded == runtime => Ok(Engine {
                gpu,
                sessions: HashMap::new(),
                device: "Processor".into(),
            }),
            Ok((loaded, _)) => Err(format!(
                "This worker already loaded {}; restart it to switch runtimes.",
                loaded.display()
            )),
            Err(error) => Err(error.clone()),
        }
    }

    fn providers(&self) -> Vec<ort::ep::ExecutionProviderDispatch> {
        let mut list = Vec::new();
        if self.gpu {
            #[cfg(target_os = "linux")]
            list.push(ort::ep::CUDA::default().build());
            #[cfg(target_os = "windows")]
            list.push(ort::ep::DirectML::default().build());
            #[cfg(target_os = "macos")]
            list.push(ort::ep::CoreML::default().build());
        }
        list
    }

    /// A cached session for `model`, created on first use.
    pub fn session(&mut self, model: &Path) -> Result<&mut Session, String> {
        if !self.sessions.contains_key(model) {
            if !model.is_file() {
                return Err(format!("The model {} is not installed.", model.display()));
            }
            let threads = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4);
            let providers = self.providers();
            let use_gpu = !providers.is_empty();
            let environment = match ENVIRONMENT.get() {
                Some(Ok((_, environment))) => environment,
                _ => return Err("ONNX Runtime is not loaded.".into()),
            };
            let prepare =
                |error: &dyn std::fmt::Display| format!("Could not prepare the model: {error}");
            let mut builder = Session::builder(environment).map_err(|error| prepare(&error))?;
            builder = builder
                .with_optimization_level(GraphOptimizationLevel::All)
                .map_err(|error| prepare(&error))?;
            builder = builder
                .with_intra_threads(threads)
                .map_err(|error| prepare(&error))?;
            if use_gpu && cfg!(target_os = "windows") {
                // DirectML cannot run with memory patterns or parallel execution.
                builder = builder
                    .with_memory_pattern(false)
                    .map_err(|error| prepare(&error))?
                    .with_parallel_execution(false)
                    .map_err(|error| prepare(&error))?;
            }
            if use_gpu {
                // GPU providers are registered explicitly.  The crate targets the 1.21 API so it never
                // asks ONNX Runtime 1.22 to pick devices itself, which aborts when none are listed.
                builder = builder
                    .with_execution_providers(providers)
                    .map_err(|error| prepare(&error))?;
            }
            let session = builder
                .commit_from_file(model)
                .map_err(|error| format!("Could not load {}: {error}", model.display()))?;
            self.device = if use_gpu {
                "GPU (falls back to the processor when unavailable)".into()
            } else {
                format!("Processor ({threads} threads)")
            };
            self.sessions.insert(model.to_path_buf(), session);
        }
        Ok(self.sessions.get_mut(model).expect("session just inserted"))
    }
}

fn path_option(header: &Value, key: &str) -> Option<PathBuf> {
    header
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(PathBuf::from)
}

/// Runs one request.  The worker process and the command line both come through here.
pub(crate) fn handle(
    engine: &mut Option<Engine>,
    frame: Frame,
    reply: &mut Reply,
) -> Result<Frame, String> {
    let header = &frame.header;
    let op = header
        .get("op")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if engine.is_none() {
        let runtime =
            path_option(header, "runtime").ok_or("The ONNX Runtime library is not installed.")?;
        let gpu = header.get("gpu").and_then(Value::as_bool).unwrap_or(false);
        *engine = Some(Engine::init(&runtime, gpu)?);
    }
    let engine = engine.as_mut().expect("engine initialised");
    let options = header.get("options").cloned().unwrap_or(Value::Null);
    let model = path_option(header, "model");
    let input = frame
        .attachments
        .first()
        .map(Vec::as_slice)
        .unwrap_or_default();
    match op.as_str() {
        "probe" => Ok(Frame::new(
            json!({"type": "result", "ok": true, "version": super::catalog::ORT_VERSION}),
        )),
        "background" => image_ops::background(
            engine,
            &model.ok_or("Choose a background model.")?,
            input,
            &options,
            reply,
        ),
        "upscale" => image_ops::upscale(
            engine,
            &model.ok_or("Choose an upscaling model.")?,
            input,
            &options,
            reply,
        ),
        "faces" => image_ops::faces(engine, model.as_deref(), input, &options, reply),
        "erase" => {
            let mask = frame
                .attachments
                .get(1)
                .ok_or("Paint over what to remove first.")?;
            image_ops::erase(
                engine,
                &model.ok_or("The eraser model is not installed.")?,
                input,
                mask,
                reply,
            )
        }
        "transcribe" => {
            let models = speech::SpeechModels {
                encoder: path_option(header, "encoder").ok_or("Choose a speech model.")?,
                decoder: path_option(header, "decoder").ok_or("Choose a speech model.")?,
                tokens: path_option(header, "tokens").ok_or("Choose a speech model.")?,
                vad: path_option(header, "vad"),
            };
            let source = match path_option(header, "path") {
                Some(path) => speech::Source::Path(path),
                None => speech::Source::Bytes(
                    input,
                    header
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                ),
            };
            speech::transcribe(engine, &models, source, &options, reply)
        }
        "speak" => tts::speak(
            engine,
            &model.ok_or("Choose a voice.")?,
            &path_option(header, "espeak").ok_or("eSpeak NG is not installed.")?,
            &options,
            reply,
        ),
        other => Err(format!("Unknown AI operation \"{other}\".")),
    }
    .map(|mut result| {
        if let Some(object) = result.header.as_object_mut() {
            object.insert("type".into(), json!("result"));
            object.insert("device".into(), json!(engine.device));
        }
        result
    })
}

/// Entry point for `benchtop --ai-worker`: serve requests until stdin closes.
pub fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    serve(&mut stdin.lock(), &mut stdout.lock());
}

/// Answers framed requests from `input` until it ends or the reader goes away.
pub(crate) fn serve(input: &mut dyn Read, out: &mut dyn Write) {
    let mut engine: Option<Engine> = None;
    loop {
        let frame = match read_frame(input) {
            Ok(Some(frame)) => frame,
            Ok(None) => return,
            Err(error) => {
                let _ = writeln!(io::stderr(), "benchtop ai worker: {error}");
                return;
            }
        };
        let response = match handle(&mut engine, frame, &mut Reply::new(out)) {
            Ok(result) => result,
            Err(message) => Frame::new(json!({"type": "error", "message": message})),
        };
        if write_frame(out, &response).is_err() {
            return;
        }
    }
}
