//! IndicTrans2 on this computer, set up with one click for the Video Dubbing tool.
//!
//! Setup downloads uv (pinned by SHA-256, see `catalog::uv_item`), which fetches a
//! private Python and installs PyTorch, Transformers and the text-processing packages
//! into `<app data>/indictrans2`; then the two IndicTrans2 models come from Hugging
//! Face into the same folder.  Nothing is installed system-wide, and removing the
//! folder removes everything.
//!
//! Serving runs the bundled server script there, on 127.0.0.1, with Hugging Face
//! switched to offline mode.  The server stops when Benchtop does: it watches its
//! standard input, which closes when this process goes away, even after a crash.

use crate::ai::{catalog, download_client, store::Store};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

pub const SERVER_SCRIPT: &str = include_str!("../../scripts/indictrans2-server.py");
pub const PYTHON_VERSION: &str = "3.12";
/// Bumped when the packages change, so an older setup is offered an update.
pub const SETUP_VERSION: u32 = 1;
const PREFERRED_PORT: u16 = 8800;
const LIBRARIES: &[&str] = &[
    "transformers==4.51.3",
    "sentencepiece==0.2.0",
    "sacremoses==0.1.1",
    "indic-nlp-library-itt==0.1.1",
];
pub const DIRECTIONS: &[&str] = &["en-indic", "indic-en"];

/// Where everything lives.
#[derive(Clone, Debug)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: PathBuf) -> Self {
        Paths { root }
    }
    pub fn tools(&self) -> PathBuf {
        self.root.join("tools")
    }
    pub fn cache(&self) -> PathBuf {
        self.root.join("cache")
    }
    pub fn pythons(&self) -> PathBuf {
        self.root.join("python")
    }
    pub fn venv(&self) -> PathBuf {
        self.root.join("venv")
    }
    pub fn hf(&self) -> PathBuf {
        self.root.join("hf")
    }
    pub fn script(&self) -> PathBuf {
        self.root.join("server.py")
    }
    pub fn state(&self) -> PathBuf {
        self.root.join("setup.json")
    }
    pub fn setup_log(&self) -> PathBuf {
        self.root.join("setup.log")
    }
    pub fn server_log(&self) -> PathBuf {
        self.root.join("server.log")
    }
    pub fn python(&self) -> PathBuf {
        if cfg!(windows) {
            self.venv().join("Scripts").join("python.exe")
        } else {
            self.venv().join("bin").join("python")
        }
    }
}

/// What a finished setup installed (setup.json).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub version: u32,
    pub python: String,
    pub torch: String,
    pub gpu: bool,
    /// The translation directions whose models are downloaded.
    pub models: Vec<String>,
}

pub fn read_installed(paths: &Paths) -> Option<Installed> {
    let text = std::fs::read_to_string(paths.state()).ok()?;
    let installed: Installed = serde_json::from_str(&text).ok()?;
    (paths.python().is_file() && paths.script().is_file()).then_some(installed)
}

/// The PyTorch build for this computer: requirement, package index and extra pins.
pub fn torch_choice(gpu: bool) -> (&'static str, Option<&'static str>, &'static [&'static str]) {
    if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        // PyTorch's last build for Intel Macs, which predates NumPy 2.
        ("torch==2.2.2", None, &["numpy<2"])
    } else if cfg!(target_os = "macos") {
        ("torch==2.6.0", None, &[])
    } else if gpu && cfg!(target_os = "windows") {
        (
            "torch==2.6.0",
            Some("https://download.pytorch.org/whl/cu124"),
            &[],
        )
    } else if gpu {
        // PyPI's Linux build carries CUDA 12.
        ("torch==2.6.0", None, &[])
    } else {
        (
            "torch==2.6.0",
            Some("https://download.pytorch.org/whl/cpu"),
            &[],
        )
    }
}

/// Whether this platform offers the NVIDIA graphics card choice.
pub fn gpu_choice() -> bool {
    cfg!(any(
        all(target_os = "linux", target_arch = "x86_64"),
        target_os = "windows"
    ))
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupEvent {
    /// step, log, progress, done, error or cancelled.
    pub kind: &'static str,
    pub step: Option<String>,
    pub message: Option<String>,
    pub done: u64,
    pub total: u64,
}

impl SetupEvent {
    fn new(kind: &'static str, step: Option<&str>, message: Option<String>) -> Self {
        SetupEvent {
            kind,
            step: step.map(str::to_string),
            message,
            done: 0,
            total: 0,
        }
    }
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SetupOptions {
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub gpu: bool,
    /// Only fetch the models again (for example after adding a token), keeping the packages.
    #[serde(default)]
    pub models_only: bool,
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

/// Bytes in a folder and everything below it.
pub fn folder_size(path: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }
    total
}

/// Runs one step's program, passing its output on as log lines, watching a folder grow
/// for progress, and stopping it when the setup is cancelled.
struct Runner<'a> {
    cancel: &'a AtomicBool,
    child: &'a Mutex<Option<Child>>,
    emit: &'a (dyn Fn(SetupEvent) + Sync),
    log: Mutex<Option<std::fs::File>>,
}

impl Runner<'_> {
    fn note(&self, line: &str) {
        if let Ok(mut log) = self.log.lock() {
            if let Some(file) = log.as_mut() {
                let _ = writeln!(file, "{line}");
            }
        }
    }

    fn step(&self, id: &str, label: &str) {
        self.note(&format!("== {label}"));
        (self.emit)(SetupEvent::new("step", Some(id), Some(label.to_string())));
    }

    /// Runs `cmd`; `on_line` sees every output line.  `watch` is a folder whose growth is the
    /// progress, out of a total that may become known while the step runs (0: unknown).
    /// Exit code 3 means "partly done" (a model that needs a token) where `partial` allows it.
    fn run(
        &self,
        step: &str,
        mut cmd: Command,
        watch: Option<(&Path, &AtomicU64)>,
        partial: bool,
        on_line: &mut dyn FnMut(&str),
    ) -> Result<i32, String> {
        if self.cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Its own process group, so stopping it also stops whatever it started (builds, downloads).
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let mut child = cmd
            .spawn()
            .map_err(|error| format!("Could not start {}: {error}", step))?;
        let (tx, rx) = mpsc::channel::<String>();
        for stream in [
            child
                .stdout
                .take()
                .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            child
                .stderr
                .take()
                .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        ]
        .into_iter()
        .flatten()
        {
            let tx = tx.clone();
            std::thread::spawn(move || {
                // uv and tqdm redraw progress with carriage returns; each redraw is a line here.
                let mut reader = BufReader::new(stream);
                let mut buffer = Vec::new();
                loop {
                    buffer.clear();
                    match reader.read_until(b'\n', &mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            for part in String::from_utf8_lossy(&buffer).split('\r') {
                                let line = part.trim_end();
                                if !line.is_empty() && tx.send(line.to_string()).is_err() {
                                    return;
                                }
                            }
                        }
                    }
                }
            });
        }
        drop(tx);
        *self.child.lock().map_err(|_| "busy")? = Some(child);
        let start_size = watch.map(|(folder, _)| folder_size(folder)).unwrap_or(0);
        let mut last_watch = Instant::now();
        let mut tail: VecDeque<String> = VecDeque::new();
        let mut exited_at: Option<Instant> = None;
        loop {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(line) => {
                    self.note(&line);
                    on_line(&line);
                    if !line.starts_with("@@") {
                        tail.push_back(line.clone());
                        if tail.len() > 12 {
                            tail.pop_front();
                        }
                        (self.emit)(SetupEvent::new("log", Some(step), Some(line)));
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // Something the program started may hold its output open after it ends.
                    let ended = matches!(
                        self.child
                            .lock()
                            .map_err(|_| "busy")?
                            .as_mut()
                            .map(|c| c.try_wait()),
                        Some(Ok(Some(_)))
                    );
                    if ended
                        && exited_at.get_or_insert_with(Instant::now).elapsed()
                            > Duration::from_secs(2)
                    {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            if self.cancel.load(Ordering::SeqCst) {
                if let Some(child) = self.child.lock().map_err(|_| "busy")?.as_mut() {
                    stop_tree(child);
                }
                break;
            }
            if let Some((folder, total)) = watch {
                if last_watch.elapsed() >= Duration::from_millis(1500) {
                    last_watch = Instant::now();
                    let done = folder_size(folder).saturating_sub(start_size);
                    (self.emit)(SetupEvent {
                        kind: "progress",
                        step: Some(step.to_string()),
                        message: None,
                        done,
                        total: total.load(Ordering::SeqCst),
                    });
                }
            }
        }
        let status = self
            .child
            .lock()
            .map_err(|_| "busy")?
            .take()
            .map(|mut child| child.wait());
        if self.cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let code = match status {
            Some(Ok(status)) => status.code().unwrap_or(-1),
            Some(Err(error)) => return Err(format!("{step} failed: {error}")),
            None => -1,
        };
        if code != 0 && !(partial && code == 3) {
            let detail = tail
                .iter()
                .rev()
                .find(|line| line.to_lowercase().contains("error"))
                .or_else(|| tail.back())
                .cloned()
                .unwrap_or_default();
            return Err(format!(
                "{step} stopped with code {code}{}",
                if detail.is_empty() {
                    String::new()
                } else {
                    format!(": {detail}")
                }
            ));
        }
        Ok(code)
    }
}

/// Stops a program and, on Unix, everything in its process group.
fn stop_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        if let Ok(pid) = i32::try_from(child.id()) {
            // SAFETY: kill(2) with a negative pid signals the group the child leads.
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
        }
    }
    let _ = child.kill();
}

/// uv with its environment pointing into Benchtop's folder (and nowhere else).
fn uv(paths: &Paths, uv_path: &Path) -> Command {
    let mut cmd = command(uv_path);
    cmd.env("UV_CACHE_DIR", paths.cache())
        .env("UV_PYTHON_INSTALL_DIR", paths.pythons())
        .env("UV_PYTHON_PREFERENCE", "only-managed")
        .env("UV_NO_CONFIG", "1")
        .env("UV_NO_PROGRESS", "1")
        .env_remove("VIRTUAL_ENV")
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH");
    cmd
}

/// The Python of the private environment, set up to keep its files in Benchtop's folder.
fn python(paths: &Paths) -> Command {
    let mut cmd = command(&paths.python());
    cmd.env("HF_HOME", paths.hf())
        .env("HF_HUB_DISABLE_TELEMETRY", "1")
        .env("HF_HUB_DISABLE_PROGRESS_BARS", "1")
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONUTF8", "1")
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .env_remove("HF_TOKEN");
    cmd
}

/// Everything after getting uv: Python, the packages, the server script and the models.
pub fn run_setup(
    paths: &Paths,
    uv_path: &Path,
    options: &SetupOptions,
    cancel: &AtomicBool,
    child: &Mutex<Option<Child>>,
    emit: &(dyn Fn(SetupEvent) + Sync),
) -> Result<Installed, String> {
    std::fs::create_dir_all(&paths.root)
        .map_err(|error| format!("Cannot create {}: {error}", paths.root.display()))?;
    let log = std::fs::File::create(paths.setup_log()).ok();
    let runner = Runner {
        cancel,
        child,
        emit,
        log: Mutex::new(log),
    };
    let previous = read_installed(paths);
    if options.models_only && previous.is_none() {
        return Err("Set up IndicTrans2 first.".into());
    }
    let gpu = if options.models_only {
        previous.as_ref().is_some_and(|p| p.gpu)
    } else {
        options.gpu && gpu_choice()
    };
    let (torch, index, extra) = torch_choice(gpu);
    let mut ignore = |_: &str| {};
    let unknown = AtomicU64::new(0);

    if !options.models_only {
        runner.step("python", &format!("Getting Python {PYTHON_VERSION}"));
        // A half-made environment from an earlier attempt is started again.
        let _ = std::fs::remove_dir_all(paths.venv());
        let mut cmd = uv(paths, uv_path);
        cmd.arg("venv")
            .arg("--python")
            .arg(PYTHON_VERSION)
            .arg(paths.venv());
        runner.run(
            "python",
            cmd,
            Some((&paths.root, &unknown)),
            false,
            &mut ignore,
        )?;

        runner.step(
            "torch",
            if gpu {
                "Installing PyTorch for the graphics card (about 2.5 GB)"
            } else {
                "Installing PyTorch (about 200 MB)"
            },
        );
        let mut cmd = uv(paths, uv_path);
        cmd.args(["pip", "install", "--python"]).arg(paths.python());
        if let Some(index) = index {
            cmd.arg("--index-url").arg(index);
        }
        cmd.arg(torch).args(extra);
        runner.run(
            "torch",
            cmd,
            Some((&paths.root, &unknown)),
            false,
            &mut ignore,
        )?;

        runner.step("libraries", "Installing Transformers and the text tools");
        let mut cmd = uv(paths, uv_path);
        cmd.args(["pip", "install", "--python"])
            .arg(paths.python())
            .args(LIBRARIES)
            .args(extra);
        runner.run(
            "libraries",
            cmd,
            Some((&paths.root, &unknown)),
            false,
            &mut ignore,
        )?;
    }

    std::fs::write(paths.script(), SERVER_SCRIPT)
        .map_err(|error| format!("Cannot write the server script: {error}"))?;

    runner.step(
        "models",
        "Downloading the IndicTrans2 models (about 1 GB each)",
    );
    let mut cmd = python(paths);
    cmd.arg(paths.script())
        .arg("--download")
        .arg(DIRECTIONS.join(","));
    if let Some(token) = options
        .token
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        // Only for this download; it is not stored anywhere.
        cmd.env("HF_TOKEN", token);
    }
    let total = AtomicU64::new(0);
    let mut ok = Vec::new();
    let mut gated = Vec::new();
    let mut on_line = |line: &str| {
        if let Some(rest) = line.strip_prefix("@@total ") {
            total.store(rest.trim().parse().unwrap_or(0), Ordering::SeqCst);
        } else if let Some(rest) = line.strip_prefix("@@ok ") {
            ok.push(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("@@gated ") {
            gated.push(rest.trim().to_string());
        }
    };
    let hf = paths.hf();
    std::fs::create_dir_all(&hf).map_err(|error| error.to_string())?;
    runner.run("models", cmd, Some((&hf, &total)), true, &mut on_line)?;
    // Models fetched before (by an earlier setup) still count.
    for model in previous
        .iter()
        .filter(|_| options.models_only)
        .flat_map(|p| p.models.clone())
    {
        if !ok.contains(&model) {
            ok.push(model);
        }
    }
    ok.sort();
    if ok.is_empty() {
        return Err(if gated.is_empty() {
            "No model could be downloaded.".into()
        } else {
            gated.join(" ")
        });
    }
    for message in &gated {
        emit(SetupEvent::new(
            "log",
            Some("models"),
            Some(message.clone()),
        ));
    }

    runner.step("finish", "Tidying up");
    if !options.models_only {
        let mut cmd = uv(paths, uv_path);
        cmd.args(["cache", "clean"]);
        let _ = runner.run("finish", cmd, None, false, &mut ignore);
    }
    let installed = match previous.filter(|_| options.models_only) {
        Some(previous) => Installed {
            models: ok,
            ..previous
        },
        None => Installed {
            version: SETUP_VERSION,
            python: PYTHON_VERSION.into(),
            torch: torch.trim_start_matches("torch==").into(),
            gpu,
            models: ok,
        },
    };
    std::fs::write(
        paths.state(),
        serde_json::to_string_pretty(&installed).unwrap_or_default(),
    )
    .map_err(|error| format!("Cannot write {}: {error}", paths.state().display()))?;
    Ok(installed)
}

/* ------------------------------------------------------------- server -- */

struct Server {
    child: Child,
    /// Closing it tells the server to stop.
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
struct Shared {
    port: Option<u16>,
    ready: bool,
    missing: Vec<String>,
    message: Option<String>,
}

#[derive(Default)]
pub struct IndicState {
    server: Mutex<Option<Server>>,
    shared: Arc<Mutex<Shared>>,
    setup_busy: AtomicBool,
    cancel: Arc<AtomicBool>,
    setup_child: Arc<Mutex<Option<Child>>>,
}

pub fn root(app: &AppHandle) -> Paths {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("benchtop"));
    Paths::new(base.join("indictrans2"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndicStatus {
    pub supported: bool,
    pub gpu_choice: bool,
    pub installed: Option<Installed>,
    pub outdated: bool,
    pub busy: bool,
    pub running: bool,
    pub ready: bool,
    pub port: Option<u16>,
    pub missing: Vec<String>,
    pub message: Option<String>,
    pub folder: String,
}

fn running(state: &IndicState) -> bool {
    let mut slot = state.server.lock().expect("server");
    match slot.as_mut().map(|server| server.child.try_wait()) {
        Some(Ok(None)) => true,
        Some(_) => {
            *slot = None;
            false
        }
        None => false,
    }
}

#[tauri::command]
pub fn indic_status(app: AppHandle, state: State<'_, IndicState>) -> IndicStatus {
    let paths = root(&app);
    let installed = read_installed(&paths);
    let running = running(&state);
    let shared = state.shared.lock().expect("shared");
    IndicStatus {
        supported: catalog::uv_item().is_some() || std::env::var_os("BENCHTOP_INDIC_UV").is_some(),
        gpu_choice: gpu_choice(),
        outdated: installed
            .as_ref()
            .is_some_and(|i| i.version < SETUP_VERSION),
        installed,
        busy: state.setup_busy.load(Ordering::SeqCst),
        running,
        ready: running && shared.ready,
        port: if running { shared.port } else { None },
        missing: shared.missing.clone(),
        message: shared.message.clone(),
        folder: paths.root.display().to_string(),
    }
}

#[tauri::command]
pub fn indic_size(app: AppHandle) -> u64 {
    folder_size(&root(&app).root)
}

/// Gets uv (a pinned, checked download) unless a test points BENCHTOP_INDIC_UV at one.
fn ensure_uv(paths: &Paths, emit: &(dyn Fn(SetupEvent) + Sync)) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("BENCHTOP_INDIC_UV") {
        return Ok(PathBuf::from(path));
    }
    let item = catalog::uv_item()
        .ok_or("IndicTrans2 cannot be set up automatically on this kind of computer.")?;
    let store = Store::new(paths.tools());
    let binary = store
        .folder(&item)
        .join(if cfg!(windows) { "uv.exe" } else { "uv" });
    if !store.is_installed(&item) {
        emit(SetupEvent::new(
            "step",
            Some("uv"),
            Some("Downloading uv, which sets up Python".into()),
        ));
        let client = download_client()?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())?;
        let report = |progress: crate::ai::store::Progress| {
            emit(SetupEvent {
                kind: "progress",
                step: Some("uv".into()),
                message: None,
                done: progress.received,
                total: progress.total,
            });
        };
        runtime.block_on(store.install(&item, &client, &report))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755));
    }
    Ok(binary)
}

#[tauri::command]
pub fn indic_setup(
    app: AppHandle,
    state: State<'_, IndicState>,
    options: SetupOptions,
) -> Result<(), String> {
    if state.setup_busy.swap(true, Ordering::SeqCst) {
        return Err("IndicTrans2 is already being set up.".into());
    }
    if running(&state) {
        stop(&state);
    }
    state.cancel.store(false, Ordering::SeqCst);
    let cancel = state.cancel.clone();
    let child = state.setup_child.clone();
    std::thread::spawn(move || {
        let paths = root(&app);
        let emit = |event: SetupEvent| {
            let _ = app.emit("benchtop://indic-setup", event);
        };
        let uv = if options.models_only {
            Ok(PathBuf::new())
        } else {
            ensure_uv(&paths, &emit)
        };
        let result = uv.and_then(|uv| run_setup(&paths, &uv, &options, &cancel, &child, &emit));
        let event = match result {
            Ok(installed) => SetupEvent::new(
                "done",
                None,
                Some(if installed.models.len() == DIRECTIONS.len() {
                    "IndicTrans2 is ready.".into()
                } else {
                    "IndicTrans2 is ready for English to Indian languages. Translating from Indian languages needs a Hugging Face token (see below).".into()
                }),
            ),
            Err(error) if error == "cancelled" => SetupEvent::new(
                "cancelled",
                None,
                Some("Setup stopped. Starting it again picks up where it left off.".into()),
            ),
            Err(error) => SetupEvent::new("error", None, Some(error)),
        };
        if let Some(state) = app.try_state::<IndicState>() {
            state.setup_busy.store(false, Ordering::SeqCst);
        }
        emit(event);
    });
    Ok(())
}

#[tauri::command]
pub fn indic_cancel(state: State<'_, IndicState>) {
    state.cancel.store(true, Ordering::SeqCst);
    if let Ok(mut child) = state.setup_child.lock() {
        if let Some(child) = child.as_mut() {
            stop_tree(child);
        }
    }
}

fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

#[tauri::command]
pub fn indic_start(app: AppHandle, state: State<'_, IndicState>) -> Result<(), String> {
    let paths = root(&app);
    let installed = read_installed(&paths).ok_or("Set up IndicTrans2 first.")?;
    if running(&state) {
        return Ok(());
    }
    // Keep the server script in step with this version of Benchtop.
    if std::fs::read_to_string(paths.script()).ok().as_deref() != Some(SERVER_SCRIPT) {
        std::fs::write(paths.script(), SERVER_SCRIPT).map_err(|error| error.to_string())?;
    }
    let port = if port_free(PREFERRED_PORT) {
        PREFERRED_PORT
    } else {
        0
    };
    let mut cmd = python(&paths);
    cmd.arg(paths.script())
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--preload",
            "--exit-with-stdin",
        ])
        .env("HF_HUB_OFFLINE", "1")
        .env("TRANSFORMERS_OFFLINE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if !installed.gpu {
        cmd.arg("--cpu");
    }
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("Could not start the IndicTrans2 server: {error}"))?;
    let stdin = child.stdin.take();
    let stderr = child.stderr.take().ok_or("no output")?;
    {
        let mut shared = state.shared.lock().expect("shared");
        *shared = Shared::default();
    }
    let shared = state.shared.clone();
    let log_path = paths.server_log();
    let events = app.clone();
    std::thread::spawn(move || {
        let mut log = std::fs::File::create(log_path).ok();
        let mut tail: VecDeque<String> = VecDeque::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(file) = log.as_mut() {
                let _ = writeln!(file, "{line}");
            }
            let mut s = shared.lock().expect("shared");
            if let Some(rest) = line.strip_prefix("@@listening ") {
                s.port = rest.trim().parse().ok();
            } else if let Some(rest) = line.strip_prefix("@@missing ") {
                s.missing.push(rest.trim().to_string());
            } else if line == "@@ready" {
                s.ready = true;
                let _ = events.emit(
                    "benchtop://indic-server",
                    serde_json::json!({ "ready": true, "port": s.port, "missing": s.missing }),
                );
            } else {
                tail.push_back(line.clone());
                if tail.len() > 8 {
                    tail.pop_front();
                }
            }
        }
        // The output ends when the server does.
        let mut s = shared.lock().expect("shared");
        let detail = tail
            .iter()
            .rev()
            .find(|l| l.contains("Error") || l.contains("error"))
            .or_else(|| tail.back())
            .cloned();
        s.message = Some(match (s.ready, detail) {
            (true, _) => "The IndicTrans2 server stopped.".to_string(),
            (false, Some(detail)) => format!("The IndicTrans2 server could not start: {detail}"),
            (false, None) => "The IndicTrans2 server could not start.".to_string(),
        });
        s.ready = false;
        let _ = events.emit(
            "benchtop://indic-server",
            serde_json::json!({ "ready": false, "message": s.message }),
        );
    });
    *state.server.lock().expect("server") = Some(Server { child, stdin });
    Ok(())
}

fn stop(state: &IndicState) {
    if let Some(mut server) = state.server.lock().expect("server").take() {
        drop(server.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = server.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = server.child.kill();
        let _ = server.child.wait();
    }
}

#[tauri::command]
pub fn indic_stop(state: State<'_, IndicState>) {
    stop(&state);
}

#[tauri::command]
pub fn indic_remove(app: AppHandle, state: State<'_, IndicState>) -> Result<(), String> {
    if state.setup_busy.load(Ordering::SeqCst) {
        return Err("Wait for the setup to finish or stop it first.".into());
    }
    stop(&state);
    let paths = root(&app);
    if paths.root.exists() {
        std::fs::remove_dir_all(&paths.root)
            .map_err(|error| format!("Could not remove {}: {error}", paths.root.display()))?;
    }
    Ok(())
}

/// Called as Benchtop exits: no server or setup outlives it.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<IndicState>() {
        stop(&state);
        state.cancel.store(true, Ordering::SeqCst);
        if let Ok(mut child) = state.setup_child.lock() {
            if let Some(child) = child.as_mut() {
                stop_tree(child);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_script_is_the_one_in_scripts() {
        assert!(SERVER_SCRIPT.contains("@@listening"));
        assert!(SERVER_SCRIPT.contains("class PurePythonProcessor"));
    }

    #[test]
    fn torch_comes_from_the_cpu_index_unless_the_gpu_is_wanted() {
        let (torch, index, _) = torch_choice(false);
        assert!(torch.starts_with("torch=="));
        if cfg!(any(target_os = "linux", target_os = "windows")) {
            assert_eq!(index, Some("https://download.pytorch.org/whl/cpu"));
            assert_ne!(
                torch_choice(true).1,
                Some("https://download.pytorch.org/whl/cpu")
            );
        }
    }

    #[test]
    fn paths_stay_inside_the_folder() {
        let paths = Paths::new(PathBuf::from("/data/indictrans2"));
        for path in [
            paths.venv(),
            paths.hf(),
            paths.cache(),
            paths.pythons(),
            paths.script(),
            paths.python(),
            paths.tools(),
        ] {
            assert!(path.starts_with("/data/indictrans2"), "{}", path.display());
        }
    }

    /// The whole setup with stand-ins for uv and Python that only record what they were asked.
    #[cfg(unix)]
    #[test]
    fn setup_runs_every_step_into_its_own_folder() {
        use std::os::unix::fs::PermissionsExt;
        let work = std::env::temp_dir().join(format!("benchtop-indic-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work).unwrap();
        let calls = work.join("calls.txt");
        // A fake uv: "venv" makes an environment whose python is a fake that answers --download.
        let fake_python = format!(
            "#!/bin/sh\necho \"python $*\" >> '{calls}'\necho \"HF_HOME=$HF_HOME TOKEN=$HF_TOKEN\" >> '{calls}'\nmkdir -p \"$HF_HOME/hub\" && head -c 4096 /dev/zero > \"$HF_HOME/hub/weights\"\necho '@@total 4096' >&2\necho '@@model en-indic x' >&2\necho '@@ok en-indic' >&2\necho '@@model indic-en y' >&2\necho '@@gated indic-en needs a token' >&2\nexit 3\n",
            calls = calls.display()
        );
        let uv = work.join("uv");
        std::fs::write(
            &uv,
            format!(
                "#!/bin/sh\necho \"uv $* | cache=$UV_CACHE_DIR | pythons=$UV_PYTHON_INSTALL_DIR | pref=$UV_PYTHON_PREFERENCE\" >> '{calls}'\nif [ \"$1\" = venv ]; then\n  mkdir -p \"$4/bin\"\n  cat > \"$4/bin/python\" <<'EOF'\n{fake_python}EOF\n  chmod +x \"$4/bin/python\"\nfi\necho 'Resolved 3 packages'\nexit 0\n",
                calls = calls.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&uv, std::fs::Permissions::from_mode(0o755)).unwrap();

        let paths = Paths::new(work.join("indictrans2"));
        let events = Mutex::new(Vec::new());
        let emit = |event: SetupEvent| events.lock().unwrap().push(event);
        let cancel = AtomicBool::new(false);
        let child = Mutex::new(None);
        let installed = run_setup(
            &paths,
            &uv,
            &SetupOptions {
                token: Some(" hf_secret ".into()),
                gpu: false,
                models_only: false,
            },
            &cancel,
            &child,
            &emit,
        )
        .expect("setup");

        assert_eq!(installed.models, vec!["en-indic".to_string()]);
        assert_eq!(read_installed(&paths), Some(installed));
        assert_eq!(
            std::fs::read_to_string(paths.script()).unwrap(),
            SERVER_SCRIPT
        );
        let log = std::fs::read_to_string(&calls).unwrap();
        let root = paths.root.display().to_string();
        assert!(log.contains(&format!("uv venv --python 3.12 {root}/venv | cache={root}/cache | pythons={root}/python | pref=only-managed")), "{log}");
        if cfg!(target_os = "linux") {
            assert!(
                log.contains("--index-url https://download.pytorch.org/whl/cpu torch==2.6.0"),
                "{log}"
            );
        }
        assert!(log.contains("transformers==4.51.3 sentencepiece==0.2.0 sacremoses==0.1.1 indic-nlp-library-itt==0.1.1"), "{log}");
        assert!(
            log.contains(&format!("server.py --download en-indic,indic-en")),
            "{log}"
        );
        assert!(
            log.contains(&format!("HF_HOME={root}/hf TOKEN=hf_secret")),
            "the token is trimmed and passed only to the download: {log}"
        );
        assert!(log.contains("uv cache clean"), "{log}");
        let steps: Vec<_> = events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.kind == "step")
            .filter_map(|e| e.step.clone())
            .collect();
        assert_eq!(steps, ["python", "torch", "libraries", "models", "finish"]);
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .any(|e| e.kind == "log" && e.message.as_deref() == Some("indic-en needs a token")));
        assert!(
            !std::fs::read_to_string(paths.setup_log())
                .unwrap()
                .contains("hf_secret"),
            "the token never reaches the log"
        );

        // Fetching the models again keeps the packages and what was downloaded before.
        std::fs::write(&calls, "").unwrap();
        let again = run_setup(
            &paths,
            Path::new("/nonexistent/uv"),
            &SetupOptions {
                models_only: true,
                ..SetupOptions::default()
            },
            &cancel,
            &child,
            &emit,
        )
        .expect("models again");
        assert_eq!(again.models, vec!["en-indic".to_string()]);
        let log = std::fs::read_to_string(&calls).unwrap();
        assert!(
            !log.contains("uv "),
            "no packages are installed again: {log}"
        );
        assert!(log.contains("--download en-indic,indic-en"), "{log}");
        let _ = std::fs::remove_dir_all(&work);
    }

    #[cfg(unix)]
    #[test]
    fn a_failing_step_reports_its_error_and_a_cancelled_setup_stops() {
        use std::os::unix::fs::PermissionsExt;
        let work = std::env::temp_dir().join(format!("benchtop-indic-fail-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work).unwrap();
        let uv = work.join("uv");
        std::fs::write(
            &uv,
            "#!/bin/sh\necho 'error: No interpreter found for Python 3.12' >&2\nexit 2\n",
        )
        .unwrap();
        std::fs::set_permissions(&uv, std::fs::Permissions::from_mode(0o755)).unwrap();
        let paths = Paths::new(work.join("indictrans2"));
        let emit = |_: SetupEvent| {};
        let child = Mutex::new(None);
        let error = run_setup(
            &paths,
            &uv,
            &SetupOptions::default(),
            &AtomicBool::new(false),
            &child,
            &emit,
        )
        .unwrap_err();
        assert!(
            error.contains("code 2") && error.contains("No interpreter found"),
            "{error}"
        );
        assert_eq!(read_installed(&paths), None);

        std::fs::write(&uv, "#!/bin/sh\nsleep 30\n").unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            flag.store(true, Ordering::SeqCst);
        });
        let started = Instant::now();
        let error = run_setup(
            &paths,
            &uv,
            &SetupOptions::default(),
            &cancel,
            &child,
            &emit,
        )
        .unwrap_err();
        canceller.join().unwrap();
        assert_eq!(error, "cancelled");
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "the running step was stopped"
        );
        let _ = std::fs::remove_dir_all(&work);
    }
}
