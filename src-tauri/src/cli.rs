//! The command line: `benchtop <command> …` runs the converters, the AI jobs, model
//! downloads, the online checks and file hashing from a terminal or a script,
//! without opening a window.  `benchtop` alone (or with a file) opens the app;
//! `benchtop open <tool>` opens it on one tool.

use std::collections::BTreeMap;
use std::io::{IsTerminal, Read, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256, Sha512};

use crate::ai::protocol::Frame;
use crate::ai::worker::{Engine, Reply};
use crate::ai::{self, catalog, store};
use crate::convert;
use crate::files::PickedFiles;
use crate::links;
use crate::net;

/// The app's identifier from tauri.conf.json; the desktop app keeps its data in a folder of this name.
const IDENTIFIER: &str = "app.benchtop.desktop";

const USAGE: &str = "Benchtop command line

USAGE
  benchtop                          Open the app
  benchtop open <tool|link>         Open the app on one tool, e.g. benchtop open json-formatter,
                                    or on a link copied from the app ('#/tool/calc-finance?calc=…')
  benchtop version [--check]        Print the version; --check asks GitHub for a newer release
  benchtop <command> [arguments]

FILES
  convert <recipe> <file>... [-o <file|folder>] [-s key=value]...
                                    Convert with an installed program (FFmpeg, LibreOffice, Pandoc,
                                    ImageMagick, Inkscape, Calibre, qpdf, Ghostscript); one job per file
                                    except for recipes that join files. benchtop convert --list
  programs                          Which converter programs are installed
  hash <file>... [--sha512]         SHA-256 (or SHA-512) of files

AI (models run on this computer; download them first)
  models                            List the models, their sizes and whether they are installed
  models get <id>...                Download models (checked against SHA-256)
  models remove <id>...             Delete downloaded models
  remove-bg <image>... [--model <id>] [--mask] [--crop]
  upscale <image>... [--scale 2|4] [--model <id>]
  blur-faces <image>... [--pixelate] [--fill]
  transcribe <audio or video>... [--language <code>|auto] [--translate] [--format srt|vtt|txt|json] [--model <id>]
                                    Languages: en, hi, bn, mr, ta, te, kn, ml, gu, pa, ur and 88 more
                                    (non-English needs whisper-base, whisper-small or whisper-turbo)

ONLINE CHECKS
  dns <name> [type] [--server <ip|https://doh-url>] [--dnssec]
  tls <host[:port]>                 Certificate chain, protocol and cipher
  http <url> [--method <verb>] [--insecure]
                                    Status, headers and timing
  whois <domain>                    Registration record (follows the IANA referral)
  ports <host> <port>...            Which TCP ports accept connections

COMMON OPTIONS
  -o, --out <file|folder>           Where results go (default: beside the input; '-' prints text to stdout)
  --cpu                             Run AI models on the processor even when a GPU runtime is installed
  -q, --quiet                       No progress output
  -h, --help                        This help;  -V, --version  the version

Results are printed as paths (files) or JSON (checks), so they can be piped to other programs.
On Windows the app is a windowed program: in Command Prompt run it as  benchtop ... | more  so the
prompt waits for the output.";

/// Converter recipes and what they do, for `convert --list`.
const RECIPES: &[(&str, &str)] = &[
    ("media-convert", "Audio or video to another format (-s to=mp4|mkv|webm|mov|mp3|m4a|wav|flac|ogg|gif …)"),
    ("video-compress", "Smaller video (-s crf=28 preset=medium height=720 start=0:10 end=1:00)"),
    ("video-trim", "Cut a part (-s start=0:10 end=0:42 exact=true)"),
    ("audio-trim", "Cut a part of a recording (-s start=… end=…)"),
    ("video-resize", "Scale (-s width=1280 height=0)"),
    ("video-crop", "Crop (-s x=0 y=0 w=640 h=360)"),
    ("video-rotate", "Rotate or flip (-s turn=90|180|270|hflip|vflip)"),
    ("video-speed", "Speed up or slow down (-s factor=1.5)"),
    ("audio-speed", "Change the tempo of a recording (-s factor=1.25)"),
    ("video-fps", "Change the frame rate (-s fps=30)"),
    ("video-extract-audio", "Save the soundtrack (-s to=mp3 bitrate=192)"),
    ("video-mute", "Remove the soundtrack"),
    ("video-gif", "Animated GIF (-s fps=12 width=480)"),
    ("video-frame", "One frame as a picture (-s at=0:05)"),
    ("video-merge", "Join videos end to end (all files in one job)"),
    ("video-burn-subtitles", "Draw subtitles into the picture (video then .srt/.vtt/.ass)"),
    ("video-add-subtitles", "Add a subtitle track (video then .srt/.vtt)"),
    ("video-watermark", "Overlay a logo (video then picture; -s position=bottom-right size=15 opacity=80)"),
    ("video-volume", "Louder or quieter (-s db=6)"),
    ("audio-volume", "Louder or quieter (-s db=6)"),
    ("audio-convert", "Recording to another format (-s to=mp3|m4a|aac|wav|flac|ogg|opus bitrate=192)"),
    ("audio-normalize", "Even loudness (-s lufs=-16)"),
    ("audio-fade", "Fade in and out (-s in=2 out=3)"),
    ("audio-silence", "Remove silences (-s threshold=-45 gap=0.5)"),
    ("audio-denoise", "Reduce steady background noise (-s strength=12)"),
    ("audio-merge", "Join recordings end to end (all files in one job)"),
    ("audio-waveform", "Waveform picture (-s colour=#53c9a0)"),
    ("audio-spectrogram", "Spectrogram picture"),
    ("document", "Office documents, Visio, Publisher and PDF (to Word) with LibreOffice (-s to=pdf|docx|odt|rtf|txt|html|xlsx|ods|csv|pptx|odp|png|svg|odg)"),
    ("postscript", "PostScript and EPS with Ghostscript (-s to=pdf|png dpi=150)"),
    ("xps", "XPS and OpenXPS to PDF with MuPDF (mutool)"),
    ("archive", "RAR, 7z, TAR, CAB, ISO and other archives to ZIP, 7z or .tar.gz with bsdtar (-s to=zip|7z|tgz)"),
    ("markup", "Markup with Pandoc (-s to=html|md|docx|odt|rtf|epub|rst|tex|txt)"),
    ("image", "Pictures with ImageMagick (-s to=png|jpg|webp|avif|heic|tiff|ico size=1600 quality=85 strip=true)"),
    ("vector", "SVG, PDF, EPS with Inkscape (-s to=png|pdf|svg|eps|emf dpi=192)"),
    ("ebook", "E-books with Calibre (-s to=epub|mobi|azw3|pdf|docx|txt)"),
    ("pdf-protect", "Password-protect a PDF with qpdf (-s password=… ownerPassword=… noPrint=true noCopy=true)"),
    ("pdf-unlock", "Remove a PDF's password with qpdf (-s password=…)"),
    ("pdf-optimise", "Linearise for fast web viewing with qpdf"),
    ("pdf-compress", "Smaller PDF with Ghostscript (-s quality=ebook|screen|printer|prepress)"),
    ("pdf-repair", "Repair a damaged PDF with qpdf"),
    ("pdf-remove-images", "Remove every picture from a PDF with Ghostscript"),
    ("pdf-grayscale", "Convert a PDF to shades of grey with Ghostscript, keeping text as text"),
];

/// Recipes that take all the files as one job (the rest run once per file).
const JOINING: &[&str] = &[
    "video-merge",
    "audio-merge",
    "video-burn-subtitles",
    "video-add-subtitles",
    "video-watermark",
];

const COMMANDS: &[&str] = &[
    "help",
    "--help",
    "-h",
    "version",
    "--version",
    "-V",
    "open",
    "convert",
    "programs",
    "hash",
    "models",
    "remove-bg",
    "upscale",
    "blur-faces",
    "transcribe",
    "dns",
    "tls",
    "http",
    "whois",
    "ports",
];

/// Whether these process arguments ask for the command line rather than the window.
pub fn wanted(args: &[String]) -> bool {
    args.get(1).is_some_and(|first| {
        COMMANDS.contains(&first.as_str())
            // A bare word that is not a file is a mistyped command, not a file to open.
            || (!first.is_empty()
                && !first.starts_with('-')
                && !first.contains(['/', '\\', '.', ':'])
                && !Path::new(first).exists())
    })
}

/// Runs a command and returns the process exit code.
pub fn main(args: Vec<String>) -> i32 {
    attach_console();
    // Like other command-line tools, stop quietly when the reader goes away (… | head).
    #[cfg(unix)]
    // SAFETY: restoring the default SIGPIPE action before any output is written.
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_DFL);
    }
    let command = args.get(1).cloned().unwrap_or_default();
    let rest = args.get(2..).unwrap_or_default().to_vec();
    let result = match command.as_str() {
        "help" | "--help" | "-h" => {
            println!("{USAGE}");
            Ok(())
        }
        "version" | "--version" | "-V" => version(&rest),
        "open" => open(&rest),
        "convert" => convert_files(&rest),
        "programs" => programs(),
        "hash" => hash(&rest),
        "models" => models(&rest),
        "remove-bg" | "upscale" | "blur-faces" => image_job(&command, &rest),
        "transcribe" => transcribe(&rest),
        "dns" | "tls" | "http" | "whois" | "ports" => check(&command, &rest),
        _ => Err(format!(
            "unknown command \"{command}\"; try benchtop --help"
        )),
    };
    match result {
        Ok(()) => 0,
        Err(message) => {
            eprintln!("benchtop: {message}");
            1
        }
    }
}

/// A windowed Windows program has no console; borrow the one it was started from.
#[cfg(windows)]
fn attach_console() {
    #[link(name = "kernel32")]
    extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
    }
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    // SAFETY: AttachConsole has no preconditions; failure (no parent console) is harmless.
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg(not(windows))]
fn attach_console() {}

// ------------------------------------------------------------------ arguments

/// `name=value` where the name is a setting's (letters, digits, `_` and `-`, starting with a letter).
fn setting_pair(arg: &str) -> Option<(&str, &str)> {
    let (key, value) = arg.split_once('=')?;
    let mut chars = key.chars();
    let starts = chars.next().is_some_and(|c| c.is_ascii_alphabetic());
    (starts && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
        .then_some((key, value))
}

#[derive(Default, Debug)]
struct Args {
    positional: Vec<String>,
    values: BTreeMap<String, String>,
    switches: Vec<String>,
    settings: Map<String, Value>,
}

impl Args {
    /// Splits arguments into files, `--name value` options (for the names in `takes_value`),
    /// switches and `-s key=value` settings.  One `-s` may be followed by several settings
    /// (`-s crf=28 height=720`): arguments that start with a name and `=` are taken as settings
    /// until the next option or file (`--` or `./` before a file whose name looks like one).
    fn parse(raw: &[String], takes_value: &[&str]) -> Result<Args, String> {
        let mut args = Args::default();
        let mut iter = raw.iter().peekable();
        while let Some(arg) = iter.next() {
            let name = match arg.as_str() {
                "-o" => "--out",
                "-s" => "--set",
                "-q" => "--quiet",
                other => other,
            };
            if name == "--" {
                args.positional.extend(iter.by_ref().cloned());
                break;
            }
            if let Some(long) = name.strip_prefix("--") {
                let (key, inline) = match long.split_once('=') {
                    Some((key, value)) => (key, Some(value.to_string())),
                    None => (long, None),
                };
                if key == "set" {
                    let pair = match inline {
                        Some(value) => value,
                        None => iter.next().cloned().ok_or("--set needs key=value")?,
                    };
                    let (k, v) = pair
                        .split_once('=')
                        .ok_or_else(|| format!("--set needs key=value, not \"{pair}\""))?;
                    args.settings.insert(k.trim().to_string(), typed(v.trim()));
                    while let Some((k, v)) = iter.peek().and_then(|next| setting_pair(next)) {
                        args.settings.insert(k.to_string(), typed(v.trim()));
                        iter.next();
                    }
                } else if key == "out" || takes_value.contains(&key) {
                    let value = match inline {
                        Some(value) => value,
                        None => iter
                            .next()
                            .cloned()
                            .ok_or_else(|| format!("--{key} needs a value"))?,
                    };
                    args.values.insert(key.to_string(), value);
                } else if inline.is_some() {
                    return Err(format!("--{key} does not take a value"));
                } else {
                    args.switches.push(key.to_string());
                }
            } else if name.starts_with('-') && name.len() > 1 && name != "-" {
                return Err(format!("unknown option {name}; try benchtop --help"));
            } else {
                args.positional.push(arg.clone());
            }
        }
        Ok(args)
    }

    fn has(&self, switch: &str) -> bool {
        self.switches.iter().any(|s| s == switch)
    }

    fn value(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(String::as_str)
    }

    fn quiet(&self) -> bool {
        self.has("quiet") || !std::io::stderr().is_terminal()
    }

    /// Existing input files from the positional arguments starting at `from`.
    fn files(&self, from: usize) -> Result<Vec<PathBuf>, String> {
        let files: Vec<PathBuf> = self
            .positional
            .iter()
            .skip(from)
            .map(PathBuf::from)
            .collect();
        if files.is_empty() {
            return Err("name at least one file".into());
        }
        for file in &files {
            if !file.is_file() {
                return Err(format!("{} is not a file", file.display()));
            }
        }
        Ok(files)
    }
}

/// `-s` values: numbers and true/false become JSON numbers and booleans.
fn typed(value: &str) -> Value {
    match value {
        "true" | "yes" | "on" => Value::Bool(true),
        "false" | "no" | "off" => Value::Bool(false),
        _ => value
            .parse::<f64>()
            .ok()
            .filter(|n| n.is_finite())
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or_else(|| Value::String(value.to_string())),
    }
}

/// Where the result for `input` goes: beside it, into the `--out` folder, or to the `--out` file.
fn destination(input: &Path, out: Option<&str>, many: bool, name: &str) -> Result<PathBuf, String> {
    let beside = || {
        input
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
    };
    let path = match out {
        None => convert::unique(beside().join(name)),
        Some(out) => {
            let out_path = PathBuf::from(out);
            if many || out_path.is_dir() || out.ends_with('/') || out.ends_with('\\') {
                std::fs::create_dir_all(&out_path)
                    .map_err(|error| format!("cannot create {out}: {error}"))?;
                convert::unique(out_path.join(name))
            } else {
                out_path
            }
        }
    };
    Ok(path)
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output")
        .to_string()
}

/// Progress on one line of the terminal (nothing when output is redirected or --quiet).
struct Progress {
    quiet: bool,
    label: String,
    shown: bool,
}

impl Progress {
    fn new(quiet: bool, label: impl Into<String>) -> Self {
        Progress {
            quiet,
            label: label.into(),
            shown: false,
        }
    }

    fn update(&mut self, fraction: f64, stage: &str) {
        if self.quiet {
            return;
        }
        self.shown = true;
        let mut err = std::io::stderr();
        let _ = write!(
            err,
            "\r\x1b[2K{}: {:>3.0}% {stage}",
            self.label,
            (fraction * 100.0).clamp(0.0, 100.0)
        );
        let _ = err.flush();
    }

    fn done(&mut self) {
        if self.shown {
            eprint!("\r\x1b[2K");
            self.shown = false;
        }
    }
}

// ------------------------------------------------------------------ commands

fn open(rest: &[String]) -> Result<(), String> {
    let target = rest
        .first()
        .ok_or("name a tool, e.g. benchtop open json-formatter")?;
    // A tool id, or a link copied from the app such as "#/tool/calc-finance?calc=…".
    let route = if target.starts_with("#/") {
        target.clone()
    } else if !target.is_empty()
        && target
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        format!("#/tool/{target}")
    } else {
        return Err(format!(
            "\"{target}\" is not a tool id (lowercase letters, digits and dashes) or a link starting with #/"
        ));
    };
    if !crate::safe_route(&route) {
        return Err(format!("\"{route}\" is not a link this app can open"));
    }
    crate::run_with(Some(route));
    Ok(())
}

fn programs() -> Result<(), String> {
    for (id, _) in convert::PROGRAMS {
        match convert::find_program(id) {
            Some(path) => println!("{id:<12} {}", path.display()),
            None => println!("{id:<12} not found"),
        }
    }
    Ok(())
}

fn convert_files(rest: &[String]) -> Result<(), String> {
    let args = Args::parse(rest, &[])?;
    if args.has("list") || args.positional.is_empty() {
        println!("Recipes (options are set with -s key=value):");
        for (id, what) in RECIPES {
            println!("  {id:<22} {what}");
        }
        return Ok(());
    }
    let recipe = args.positional[0].as_str();
    if !RECIPES.iter().any(|(id, _)| *id == recipe) {
        return Err(format!(
            "unknown recipe \"{recipe}\"; see benchtop convert --list"
        ));
    }
    let files = args.files(1)?;
    let options = Value::Object(args.settings.clone());
    let jobs: Vec<Vec<PathBuf>> = if JOINING.contains(&recipe) {
        vec![files]
    } else {
        files.into_iter().map(|file| vec![file]).collect()
    };
    let many = jobs.len() > 1;
    let state = convert::ConvertState::default();
    for inputs in jobs {
        let plan = convert::plan(recipe, &inputs, &options)?;
        let first = &inputs[0];
        let name = format!("{}{}.{}", stem(first), plan.suffix, plan.ext);
        let output = destination(first, args.value("out"), many, &name)?;
        let quiet = args.quiet();
        let label = stem(first);
        let report = |fraction: f64| {
            if !quiet {
                let mut err = std::io::stderr();
                let _ = write!(err, "\r\x1b[2K{label}: {:>3.0}%", fraction * 100.0);
                let _ = err.flush();
            }
        };
        let result = convert::run_plan(&state, "cli", &plan, &output, &report);
        if let Some(scratch) = &plan.scratch {
            let _ = std::fs::remove_dir_all(scratch);
        }
        if !quiet {
            eprint!("\r\x1b[2K");
        }
        result?;
        println!("{}", output.display());
    }
    Ok(())
}

fn hash(rest: &[String]) -> Result<(), String> {
    let args = Args::parse(rest, &[])?;
    for file in args.files(0)? {
        let mut reader = std::fs::File::open(&file)
            .map_err(|error| format!("cannot read {}: {error}", file.display()))?;
        let mut buffer = vec![0u8; 1 << 20];
        let digest = if args.has("sha512") {
            let mut hasher = Sha512::new();
            loop {
                let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            hex(&hasher.finalize())
        } else {
            let mut hasher = Sha256::new();
            loop {
                let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            hex(&hasher.finalize())
        };
        // The same layout as sha256sum, so `sha256sum -c` can check it.
        println!("{digest}  {}", file.display());
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The desktop app's model folder (Tauri's app data folder for this identifier).
fn models_root() -> PathBuf {
    let root = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(IDENTIFIER)
        .join("ai");
    let _ = std::fs::create_dir_all(&root);
    root
}

fn size(bytes: u64) -> String {
    let mb = bytes as f64 / 1_048_576.0;
    if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0)
    } else {
        format!("{mb:.0} MB")
    }
}

fn models(rest: &[String]) -> Result<(), String> {
    let args = Args::parse(rest, &[])?;
    let store = store::Store::new(models_root());
    match args.positional.first().map(String::as_str) {
        None | Some("list") => {
            println!("Models in {}", models_root().display());
            for item in catalog::items() {
                let installed = if store.is_installed(&item) {
                    "installed"
                } else {
                    "-"
                };
                println!(
                    "  {:<22} {:>8}  {:<9}  {}",
                    item.id,
                    size(item.download.size),
                    installed,
                    item.name
                );
            }
            Ok(())
        }
        Some("get") | Some("download") => {
            let ids = &args.positional[1..];
            if ids.is_empty() {
                return Err("name the models to download (see benchtop models)".into());
            }
            let client = ai::download_client()?;
            for id in ids {
                let item = catalog::find(id).ok_or_else(|| format!("unknown model \"{id}\""))?;
                if store.is_installed(&item) {
                    println!("{id}: already installed");
                    continue;
                }
                let quiet = args.quiet();
                let report = |progress: store::Progress| {
                    if !quiet && progress.total > 0 {
                        let mut err = std::io::stderr();
                        let _ = write!(
                            err,
                            "\r\x1b[2K{id}: {:>3.0}% of {}",
                            progress.received as f64 * 100.0 / progress.total as f64,
                            size(progress.total)
                        );
                        let _ = err.flush();
                    }
                };
                let result = tauri::async_runtime::block_on(store.install(&item, &client, &report));
                if !quiet {
                    eprint!("\r\x1b[2K");
                }
                result.map_err(|error| format!("{id}: {error}"))?;
                println!("{id}: installed");
            }
            Ok(())
        }
        Some("remove") | Some("delete") => {
            for id in &args.positional[1..] {
                let item = catalog::find(id).ok_or_else(|| format!("unknown model \"{id}\""))?;
                store
                    .remove(&item)
                    .map_err(|error| format!("{id}: {error}"))?;
                println!("{id}: removed");
            }
            Ok(())
        }
        Some("folder") => {
            println!("{}", models_root().display());
            Ok(())
        }
        Some(other) => Err(format!(
            "unknown models command \"{other}\" (list, get, remove, folder)"
        )),
    }
}

/// Runs one AI request in this process, as the worker would.
fn ai_request(
    state: &ai::AiState,
    engine: &mut Option<Engine>,
    request: Value,
    picked: &PickedFiles,
    input: Vec<u8>,
    progress: &mut Progress,
) -> Result<Frame, String> {
    let (header, _, _) = ai::build_request(state, picked, &request)?;
    let frame = Frame {
        header,
        attachments: vec![input],
    };
    let mut report = |value: f64, stage: &str| progress.update(value, stage);
    let mut reply = Reply::Callback(&mut report);
    let result = crate::ai::worker::handle(engine, frame, &mut reply);
    progress.done();
    result
}

fn image_job(command: &str, rest: &[String]) -> Result<(), String> {
    let args = Args::parse(rest, &["model", "scale"])?;
    let files = args.files(0)?;
    let many = files.len() > 1;
    let state = ai::AiState::new(models_root());
    let picked = PickedFiles::default();
    let mut engine = None;
    for file in files {
        let bytes = std::fs::read(&file)
            .map_err(|error| format!("cannot read {}: {error}", file.display()))?;
        let mut options = args.settings.clone();
        let (op, suffix) = match command {
            "remove-bg" => {
                if args.has("mask") {
                    options.insert("mode".into(), json!("mask"));
                }
                if args.has("crop") {
                    options.insert("crop".into(), json!(true));
                }
                ("background", "-nobg")
            }
            "upscale" => {
                if let Some(scale) = args.value("scale") {
                    let scale: f64 = scale.parse().map_err(|_| "--scale takes 2 or 4")?;
                    options.insert("scale".into(), json!(scale));
                }
                ("upscale", "-upscaled")
            }
            _ => {
                if args.has("pixelate") {
                    options.insert("effect".into(), json!("pixelate"));
                } else if args.has("fill") {
                    options.insert("effect".into(), json!("fill"));
                }
                ("faces", "-faces")
            }
        };
        let request = json!({
            "op": op,
            "model": args.value("model").unwrap_or_default(),
            "gpu": !args.has("cpu"),
            "options": Value::Object(options),
            "name": file.file_name().and_then(|n| n.to_str()).unwrap_or_default(),
        });
        let mut progress = Progress::new(args.quiet(), stem(&file));
        let result = ai_request(&state, &mut engine, request, &picked, bytes, &mut progress)?;
        let image = result
            .attachments
            .first()
            .ok_or("the model returned no picture")?;
        let ext = if image.starts_with(&[0xff, 0xd8]) {
            "jpg"
        } else {
            "png"
        };
        let output = destination(
            &file,
            args.value("out"),
            many,
            &format!("{}{suffix}.{ext}", stem(&file)),
        )?;
        std::fs::write(&output, image)
            .map_err(|error| format!("cannot write {}: {error}", output.display()))?;
        println!("{}", output.display());
    }
    Ok(())
}

/// Subtitles or text from transcript segments (the same layouts as the app).
pub fn render_transcript(segments: &[Value], format: &str) -> String {
    let stamp = |seconds: f64, separator: char| {
        let ms = (seconds.max(0.0) * 1000.0).round() as u64;
        format!(
            "{:02}:{:02}:{:02}{separator}{:03}",
            ms / 3_600_000,
            ms % 3_600_000 / 60_000,
            ms % 60_000 / 1000,
            ms % 1000
        )
    };
    let field =
        |segment: &Value, key: &str| segment.get(key).and_then(Value::as_f64).unwrap_or(0.0);
    let text = |segment: &Value| {
        segment
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string()
    };
    match format {
        "srt" => segments
            .iter()
            .enumerate()
            .map(|(i, s)| {
                format!(
                    "{}\n{} --> {}\n{}\n",
                    i + 1,
                    stamp(field(s, "start"), ','),
                    stamp(field(s, "end"), ','),
                    text(s)
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
        "vtt" => format!(
            "WEBVTT\n\n{}",
            segments
                .iter()
                .map(|s| format!(
                    "{} --> {}\n{}\n",
                    stamp(field(s, "start"), '.'),
                    stamp(field(s, "end"), '.'),
                    text(s)
                ))
                .collect::<Vec<_>>()
                .join("\n")
        ),
        "json" => serde_json::to_string_pretty(segments).unwrap_or_default(),
        _ => segments.iter().map(text).collect::<Vec<_>>().join(" "),
    }
}

fn transcribe(rest: &[String]) -> Result<(), String> {
    let args = Args::parse(rest, &["model", "language", "format"])?;
    let files = args.files(0)?;
    let format = args.value("format").unwrap_or("srt");
    if !["srt", "vtt", "txt", "json"].contains(&format) {
        return Err("--format is srt, vtt, txt or json".into());
    }
    let language = args.value("language").unwrap_or("en").to_ascii_lowercase();
    let translate = args.has("translate");
    let state = ai::AiState::new(models_root());
    // English-only models for English; otherwise the best installed multilingual model.
    let model = match args.value("model") {
        Some(model) => model.to_string(),
        None => {
            let multi = language != "en" || translate;
            let installed =
                |id: &str| catalog::find(id).is_some_and(|item| state.store.is_installed(&item));
            let order: &[&str] = if !multi {
                &[
                    "whisper-base-en",
                    "whisper-small-en",
                    "whisper-tiny-en",
                    "whisper-turbo",
                    "whisper-small",
                    "whisper-base",
                ]
            } else if translate {
                &["whisper-small", "whisper-base"]
            } else {
                &["whisper-turbo", "whisper-small", "whisper-base"]
            };
            order
                .iter()
                .find(|id| installed(id))
                .map(|id| id.to_string())
                .ok_or_else(|| {
                    format!(
                        "no suitable speech model is installed; run  benchtop models get {}",
                        order[0]
                    )
                })?
        }
    };
    let picked = PickedFiles::default();
    let many = files.len() > 1;
    let mut engine = None;
    for file in files {
        let token = picked.register(file.clone());
        let request = json!({
            "op": "transcribe",
            "model": model,
            "file": token,
            "gpu": !args.has("cpu"),
            "options": {"language": language, "task": if translate { "translate" } else { "transcribe" }},
            "name": file.file_name().and_then(|n| n.to_str()).unwrap_or_default(),
        });
        let mut progress = Progress::new(args.quiet(), stem(&file));
        let result = ai_request(
            &state,
            &mut engine,
            request,
            &picked,
            Vec::new(),
            &mut progress,
        )?;
        let segments = result.header["segments"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let text = render_transcript(&segments, format);
        if args.value("out") == Some("-") {
            println!("{text}");
            continue;
        }
        let output = destination(
            &file,
            args.value("out"),
            many,
            &format!("{}.{format}", stem(&file)),
        )?;
        std::fs::write(&output, text.as_bytes())
            .map_err(|error| format!("cannot write {}: {error}", output.display()))?;
        println!("{}", output.display());
    }
    Ok(())
}

// ------------------------------------------------------------------ online checks

/// Prints the version; with --check, asks GitHub whether a newer release exists.
fn version(rest: &[String]) -> Result<(), String> {
    let current = env!("CARGO_PKG_VERSION");
    println!("benchtop {current}");
    if !rest.iter().any(|arg| arg == "--check") {
        return Ok(());
    }
    let request = parse(json!({
        "url": links::RELEASES_API,
        "headers": [["accept", "application/vnd.github+json"], ["x-github-api-version", "2022-11-28"]],
        "maxBody": 4_000_000,
        "timeoutMs": 20_000,
    }))?;
    let response = tauri::async_runtime::block_on(net::net_http(request)).map_err(net_error)?;
    if response.status == 403 || response.status == 429 {
        return Err(format!(
            "GitHub refused the request ({} {}); it answers 60 such requests an hour from one network, so try again later",
            response.status, response.reason
        ));
    }
    if response.status != 200 {
        return Err(format!(
            "GitHub answered {} {}",
            response.status, response.reason
        ));
    }
    use base64::Engine as _;
    let body = base64::engine::general_purpose::STANDARD
        .decode(response.body.as_bytes())
        .map_err(|error| error.to_string())?;
    let list: Value = serde_json::from_slice(&body)
        .map_err(|_| "GitHub sent an answer that is not JSON".to_string())?;
    match links::newest_release(&list) {
        Some((latest, page)) if links::parse_version(&latest) > links::parse_version(current) => {
            println!("Benchtop {latest} is available: {page}");
        }
        Some(_) => println!("This is the newest version."),
        None => println!("No releases are published yet: {}", links::RELEASES),
    }
    Ok(())
}

fn print_json(value: &impl serde::Serialize) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string_pretty(value).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn net_error(error: net::NetError) -> String {
    error.message
}

/// A check's request from JSON written here (the same shape the app sends).
fn parse<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| error.to_string())
}

fn check(command: &str, rest: &[String]) -> Result<(), String> {
    let args = Args::parse(rest, &["server", "method", "timeout"])?;
    let timeout = args
        .value("timeout")
        .and_then(|t| t.parse::<u64>().ok())
        .map(|seconds| seconds * 1000);
    let first = args
        .positional
        .first()
        .cloned()
        .ok_or_else(|| format!("{command} needs a host, name or URL"))?;
    tauri::async_runtime::block_on(async {
        match command {
            "dns" => {
                let record = args
                    .positional
                    .get(1)
                    .map_or("A", String::as_str)
                    .to_uppercase();
                let request = parse(json!({
                    "name": first,
                    "recordType": record,
                    "server": args.value("server").unwrap_or("system"),
                    "dnssec": args.has("dnssec"),
                    "timeoutMs": timeout,
                }))?;
                print_json(&net::net_dns(request).await.map_err(net_error)?)
            }
            "tls" => {
                let (host, port) = match first.rsplit_once(':') {
                    Some((host, port)) if port.parse::<u16>().is_ok() && !host.contains(':') => {
                        (host.to_string(), port.parse::<u16>().ok())
                    }
                    _ => (first.clone(), None),
                };
                let request = parse(json!({"host": host, "port": port, "timeoutMs": timeout}))?;
                print_json(&net::net_tls(request).await.map_err(net_error)?)
            }
            "http" => {
                let url = if first.contains("://") {
                    first.clone()
                } else {
                    format!("https://{first}")
                };
                let request = parse(json!({
                    "url": url,
                    "method": args.value("method").unwrap_or("GET").to_uppercase(),
                    "insecure": args.has("insecure"),
                    "maxBody": 65536,
                    "timeoutMs": timeout,
                }))?;
                print_json(&net::net_http(request).await.map_err(net_error)?)
            }
            "whois" => {
                let mut server = args.value("server").unwrap_or("whois.iana.org").to_string();
                let mut answers = Vec::new();
                for _ in 0..2 {
                    let request =
                        parse(json!({"server": server, "query": first, "timeoutMs": timeout}))?;
                    let response = net::net_whois(request).await.map_err(net_error)?;
                    let refer = response.text.lines().find_map(|line| {
                        let line = line.trim();
                        line.strip_prefix("refer:")
                            .or_else(|| line.strip_prefix("whois:"))
                            .map(|s| s.trim().to_string())
                    });
                    answers.push(response);
                    match refer {
                        Some(next)
                            if !next.is_empty()
                                && next != server
                                && args.value("server").is_none() =>
                        {
                            server = next
                        }
                        _ => break,
                    }
                }
                for answer in &answers {
                    println!("% {}\n{}", answer.server, answer.text.trim_end());
                }
                Ok(())
            }
            _ => {
                let ports: Vec<u16> = args.positional[1..]
                    .iter()
                    .map(|p| {
                        p.parse::<u16>()
                            .map_err(|_| format!("\"{p}\" is not a port"))
                    })
                    .collect::<Result<_, _>>()?;
                if ports.is_empty() {
                    return Err(
                        "name the ports to try, e.g. benchtop ports example.org 22 80 443".into(),
                    );
                }
                let request = parse(json!({"host": first, "ports": ports, "timeoutMs": timeout}))?;
                print_json(&net::net_tcp_probe(request).await.map_err(net_error)?)
            }
        }
    })
}

#[cfg(test)]
mod tests {

    #[test]
    fn links_with_a_query_open_and_scripts_do_not() {
        assert!(crate::safe_route(
            "#/tool/calc-finance?calc=loan-emi&s=eyJ0eXBlZCI6e319"
        ));
        assert!(crate::safe_route("#/tool/json-formatter"));
        assert!(!crate::safe_route("#/tool/x';alert(1)//"));
        assert!(!crate::safe_route("#/tool/x\\"));
        assert!(!crate::safe_route("javascript:alert(1)"));
        assert!(!crate::safe_route("#/tool/a b"));
    }

    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn recognises_commands_but_not_files() {
        assert!(wanted(&strings(&["benchtop", "convert"])));
        assert!(wanted(&strings(&["benchtop", "--help"])));
        assert!(!wanted(&strings(&["benchtop"])));
        assert!(!wanted(&strings(&["benchtop", "/home/me/photo.png"])));
        assert!(!wanted(&strings(&["benchtop", "--ai-worker"])));
        assert!(!wanted(&strings(&["benchtop", "notes.md"])));
        assert!(!wanted(&strings(&["benchtop", "C:\\Users\\me\\a.pdf"])));
        // A mistyped command gets an error instead of opening the window.
        assert!(wanted(&strings(&["benchtop", "transcibe"])));
    }

    #[test]
    fn parses_options_switches_and_settings() {
        let args = Args::parse(
            &strings(&[
                "a.mp4",
                "-o",
                "out",
                "--model=x",
                "-s",
                "crf=30",
                "--set",
                "preset=slow",
                "--cpu",
                "-s",
                "exact=true",
                "b.mp4",
            ]),
            &["model"],
        )
        .expect("parses");
        assert_eq!(args.positional, ["a.mp4", "b.mp4"]);
        assert_eq!(args.value("out"), Some("out"));
        assert_eq!(args.value("model"), Some("x"));
        assert!(args.has("cpu"));
        assert_eq!(args.settings["crf"], json!(30.0));
        assert_eq!(args.settings["preset"], json!("slow"));
        assert_eq!(args.settings["exact"], json!(true));
        // Several settings after one -s, as the help and the documentation write them.
        let args = Args::parse(
            &strings(&[
                "clip.mp4",
                "-s",
                "crf=28",
                "height=720",
                "start=0:10",
                "-o",
                "small",
                "next.mp4",
                "-s",
                "to=png",
                "./dpi=2.mp4",
            ]),
            &[],
        )
        .expect("parses");
        assert_eq!(args.positional, ["clip.mp4", "next.mp4", "./dpi=2.mp4"]);
        assert_eq!(args.settings["crf"], json!(28.0));
        assert_eq!(args.settings["height"], json!(720.0));
        assert_eq!(args.settings["start"], json!("0:10"));
        assert_eq!(args.settings["to"], json!("png"));
        assert_eq!(args.value("out"), Some("small"));
        assert!(Args::parse(&strings(&["--bogus=1"]), &[]).is_err());
        assert!(Args::parse(&strings(&["-x"]), &[]).is_err());
        assert!(Args::parse(&strings(&["--set", "novalue"]), &[]).is_err());
    }

    #[test]
    fn every_listed_recipe_is_known_to_the_converter() {
        for (id, _) in RECIPES {
            let error = convert::plan(id, &[], &json!({})).err().unwrap_or_default();
            assert!(!error.contains("Unknown recipe"), "{id}: {error}");
        }
        for id in JOINING {
            assert!(RECIPES.iter().any(|(known, _)| known == id), "{id}");
        }
    }

    #[test]
    fn identifier_matches_the_app_configuration() {
        let config: Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("config");
        assert_eq!(config["identifier"], IDENTIFIER);
    }

    #[test]
    fn renders_subtitles_like_the_app() {
        let segments = vec![
            json!({"start": 0.0, "end": 2.5, "text": " नमस्ते "}),
            json!({"start": 3661.042, "end": 3662.0, "text": "Hello."}),
        ];
        assert_eq!(
            render_transcript(&segments, "srt"),
            "1\n00:00:00,000 --> 00:00:02,500\nनमस्ते\n\n2\n01:01:01,042 --> 01:01:02,000\nHello.\n"
        );
        assert!(render_transcript(&segments, "vtt")
            .starts_with("WEBVTT\n\n00:00:00.000 --> 00:00:02.500\n"));
        assert_eq!(render_transcript(&segments, "txt"), "नमस्ते Hello.");
    }

    #[test]
    fn destinations_avoid_overwriting() {
        let dir = std::env::temp_dir().join(format!("benchtop-cli-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let input = dir.join("clip.mp4");
        std::fs::write(&input, b"x").expect("input");
        let beside = destination(&input, None, false, "clip.mp4").expect("beside");
        assert_ne!(beside, input, "never the input itself");
        let folder = destination(
            &input,
            Some(dir.join("out").to_str().unwrap()),
            true,
            "a.png",
        )
        .expect("folder");
        assert_eq!(folder, dir.join("out").join("a.png"));
        let file = destination(
            &input,
            Some(dir.join("named.png").to_str().unwrap()),
            false,
            "a.png",
        )
        .expect("file");
        assert_eq!(file, dir.join("named.png"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
