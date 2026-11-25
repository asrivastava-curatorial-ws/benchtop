//! The Code Runner's desktop side: running code with the compilers and
//! interpreters installed on this computer.  Each run gets a fresh folder in
//! the temporary directory, is compiled if the language needs it, then runs
//! with the given input, a time limit and a cap on what it may print.  No
//! shell is involved: programs and arguments are passed as they are, and the
//! folder is removed afterwards.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// How one language is built and run.  In the argument lists `{prog}` is the
/// program found, `{src}` the source file, `{out}` the compiled program,
/// `{dir}` the run's folder and `{class}` a Java class name.
struct Toolchain {
    id: &'static str,
    programs: &'static [&'static str],
    /// A second program the run step needs (java after javac or kotlinc).
    runner: Option<&'static [&'static str]>,
    file: &'static str,
    compile: Option<&'static [&'static str]>,
    run: &'static [&'static str],
    version: &'static [&'static str],
    /// Compiling and running are one step (dotnet run): the run gets the build's time as well.
    one_step_build: bool,
}

const TOOLCHAINS: &[Toolchain] = &[
    Toolchain {
        id: "python",
        programs: &["python3", "python", "py"],
        runner: None,
        file: "main.py",
        compile: None,
        run: &["{prog}", "-u", "{src}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "javascript",
        programs: &["node"],
        runner: None,
        file: "main.js",
        compile: None,
        run: &["{prog}", "{src}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "typescript",
        programs: &["deno", "bun", "node"],
        runner: None,
        file: "main.ts",
        compile: None,
        run: &["{prog}", "{src}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "c",
        programs: &["gcc", "clang", "cc"],
        runner: None,
        file: "main.c",
        compile: Some(&[
            "{prog}", "-O2", "-std=c17", "-Wall", "{src}", "-o", "{out}", "-lm",
        ]),
        run: &["{out}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "cpp",
        programs: &["g++", "clang++", "c++"],
        runner: None,
        file: "main.cpp",
        compile: Some(&[
            "{prog}",
            "-O2",
            "-std=c++20",
            "-Wall",
            "{src}",
            "-o",
            "{out}",
        ]),
        run: &["{out}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "java",
        programs: &["javac"],
        runner: Some(&["java"]),
        file: "{class}.java",
        compile: Some(&["{prog}", "-encoding", "UTF-8", "-d", "{dir}", "{src}"]),
        run: &[
            "{runner}",
            "-Dfile.encoding=UTF-8",
            "-cp",
            "{dir}",
            "{class}",
        ],
        version: &["-version"],
        one_step_build: false,
    },
    Toolchain {
        id: "csharp",
        programs: &["dotnet"],
        runner: None,
        file: "main.cs",
        compile: None,
        run: &["{prog}", "run", "{src}"],
        version: &["--version"],
        one_step_build: true,
    },
    Toolchain {
        id: "go",
        programs: &["go"],
        runner: None,
        file: "main.go",
        compile: Some(&["{prog}", "build", "-o", "{out}", "{src}"]),
        run: &["{out}"],
        version: &["version"],
        one_step_build: false,
    },
    Toolchain {
        id: "rust",
        programs: &["rustc"],
        runner: None,
        file: "main.rs",
        compile: Some(&["{prog}", "--edition", "2021", "-O", "-o", "{out}", "{src}"]),
        run: &["{out}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "kotlin",
        programs: &["kotlinc"],
        runner: Some(&["java"]),
        file: "main.kt",
        compile: Some(&[
            "{prog}",
            "{src}",
            "-include-runtime",
            "-d",
            "{dir}/main.jar",
        ]),
        run: &["{runner}", "-jar", "{dir}/main.jar"],
        version: &["-version"],
        one_step_build: false,
    },
    Toolchain {
        id: "php",
        programs: &["php"],
        runner: None,
        file: "main.php",
        compile: None,
        run: &["{prog}", "{src}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "ruby",
        programs: &["ruby"],
        runner: None,
        file: "main.rb",
        compile: None,
        run: &["{prog}", "{src}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "bash",
        programs: &["bash"],
        runner: None,
        file: "main.sh",
        compile: None,
        run: &["{prog}", "{src}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "r",
        programs: &["Rscript"],
        runner: None,
        file: "main.R",
        compile: None,
        run: &["{prog}", "--vanilla", "{src}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "lua",
        programs: &["lua", "lua5.4", "lua54", "luajit", "lua5.3"],
        runner: None,
        file: "main.lua",
        compile: None,
        run: &["{prog}", "{src}"],
        version: &["-v"],
        one_step_build: false,
    },
    Toolchain {
        id: "perl",
        programs: &["perl"],
        runner: None,
        file: "main.pl",
        compile: None,
        run: &["{prog}", "{src}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "swift",
        programs: &["swiftc"],
        runner: None,
        file: "main.swift",
        compile: Some(&["{prog}", "-O", "{src}", "-o", "{out}"]),
        run: &["{out}"],
        version: &["--version"],
        one_step_build: false,
    },
    Toolchain {
        id: "dart",
        programs: &["dart"],
        runner: None,
        file: "main.dart",
        compile: None,
        run: &["{prog}", "run", "{src}"],
        version: &["--version"],
        one_step_build: false,
    },
];

const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);
/// What a run may print on each stream before it is cut off.
const OUTPUT_CAP: usize = 1 << 20;

/// A program on the PATH: BENCHTOP_CODE_<ID> overrides it (for tests and unusual installs).
fn find(id: &str, names: &[&str]) -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(format!("BENCHTOP_CODE_{}", id.to_uppercase())) {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    names.iter().find_map(|name| which::which(name).ok())
}

fn toolchain(id: &str) -> Option<&'static Toolchain> {
    TOOLCHAINS.iter().find(|t| t.id == id)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainInfo {
    id: &'static str,
    program: Option<String>,
    /// The second program a language needs, when one is missing (java for javac).
    missing_runner: Option<&'static str>,
}

/// Which languages can run here: a lookup on the PATH, no programs started.
#[tauri::command]
pub fn code_toolchains() -> Vec<ToolchainInfo> {
    TOOLCHAINS
        .iter()
        .map(|t| {
            let program = find(t.id, t.programs);
            let missing_runner = t.runner.and_then(|names| {
                if find(&format!("{}_runner", t.id), names).is_some() {
                    None
                } else {
                    names.first().copied()
                }
            });
            ToolchainInfo {
                id: t.id,
                program: program.map(|p| p.to_string_lossy().into_owned()),
                missing_runner,
            }
        })
        .collect()
}

/// The version line of a language's program (`gcc --version`), run with a short time limit.
#[tauri::command]
pub async fn code_version(language: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let t = toolchain(&language).ok_or("Unknown language.")?;
        let program = find(t.id, t.programs).ok_or("Not installed.")?;
        let mut command = quiet(&program);
        command.args(t.version);
        let out = run_limited(command, b"", Duration::from_secs(15), 64 * 1024)?;
        let text = if out.stdout.trim().is_empty() {
            out.stderr
        } else {
            out.stdout
        };
        Ok(text
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim()
            .to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    language: String,
    source: String,
    #[serde(default)]
    stdin: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default = "default_timeout")]
    timeout_ms: u64,
}

fn default_timeout() -> u64 {
    10_000
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    program: String,
    compile_output: String,
    compiled: bool,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
    truncated: bool,
    compile_ms: u64,
    run_ms: u64,
}

/// Compiles (if needed) and runs one program.
#[tauri::command]
pub async fn code_run(request: RunRequest) -> Result<RunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run(request))
        .await
        .map_err(|e| e.to_string())?
}

/// The public class a Java file declares (the file must be named after it), else Main.
pub fn java_class(source: &str) -> String {
    let words: Vec<&str> = source
        .split(|c: char| c.is_whitespace() || c == '{')
        .filter(|w| !w.is_empty())
        .collect();
    let mut first: Option<String> = None;
    for (i, w) in words.iter().enumerate() {
        if *w == "class" {
            if let Some(name) = words.get(i + 1) {
                let name: String = name
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if name.is_empty() {
                    continue;
                }
                let public = words[..i]
                    .iter()
                    .rev()
                    .take_while(|m| {
                        matches!(
                            **m,
                            "final" | "abstract" | "static" | "public" | "strictfp" | "sealed"
                        )
                    })
                    .any(|m| *m == "public");
                if public {
                    return name;
                }
                first.get_or_insert(name);
            }
        }
    }
    first.unwrap_or_else(|| "Main".to_string())
}

fn fill(
    template: &str,
    prog: &Path,
    runner: Option<&Path>,
    src: &Path,
    out: &Path,
    dir: &Path,
    class: &str,
) -> String {
    template
        .replace("{prog}", &prog.to_string_lossy())
        .replace(
            "{runner}",
            &runner
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
        )
        .replace("{src}", &src.to_string_lossy())
        .replace("{out}", &out.to_string_lossy())
        .replace("{dir}", &dir.to_string_lossy())
        .replace("{class}", class)
}

/// A command that opens no console window on Windows, with colour turned off.
fn quiet(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
        .env("DOTNET_NOLOGO", "1");
    command
}

fn command_from(parts: &[String], dir: &Path) -> Result<Command, String> {
    let (first, rest) = parts.split_first().ok_or("Nothing to run.")?;
    let mut command = quiet(Path::new(first));
    command.args(rest).current_dir(dir);
    Ok(command)
}

static RUNS: AtomicU64 = AtomicU64::new(0);

fn run(request: RunRequest) -> Result<RunResult, String> {
    let t = toolchain(&request.language)
        .ok_or("This language cannot run with an installed toolchain.")?;
    let program = find(t.id, t.programs)
        .ok_or_else(|| format!("No {} toolchain was found on this computer.", t.id))?;
    let runner = match t.runner {
        Some(names) => Some(find(&format!("{}_runner", t.id), names).ok_or_else(|| {
            format!(
                "{} is needed to run the program, and it was not found.",
                names[0]
            )
        })?),
        None => None,
    };
    if request.source.len() > 4 * 1024 * 1024 {
        return Err("The program is too large.".into());
    }
    let timeout = Duration::from_millis(request.timeout_ms.clamp(500, 120_000));
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "benchtop-run-{}-{}-{}",
        std::process::id(),
        RUNS.fetch_add(1, Ordering::Relaxed),
        stamp
    ));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not make a folder to run in: {e}"))?;
    let result = run_in(t, &program, runner.as_deref(), &request, &dir, timeout);
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn run_in(
    t: &Toolchain,
    program: &Path,
    runner: Option<&Path>,
    request: &RunRequest,
    dir: &Path,
    timeout: Duration,
) -> Result<RunResult, String> {
    let class = if t.id == "java" {
        java_class(&request.source)
    } else {
        "Main".to_string()
    };
    let src = dir.join(t.file.replace("{class}", &class));
    let out = dir.join(if cfg!(windows) { "main.exe" } else { "main" });
    std::fs::write(&src, &request.source)
        .map_err(|e| format!("Could not write the source file: {e}"))?;
    let mut result = RunResult {
        program: program.to_string_lossy().into_owned(),
        compiled: true,
        ..Default::default()
    };
    // TypeScript on Node needs type stripping turned on (it is on by default from Node 23.6).
    let typescript_on_node = t.id == "typescript"
        && program
            .file_stem()
            .map(|s| s.to_string_lossy().starts_with("node"))
            .unwrap_or(false);
    let deno = t.id == "typescript"
        && program
            .file_stem()
            .map(|s| s.to_string_lossy().starts_with("deno"))
            .unwrap_or(false);
    // The Windows py launcher picks Python 3 with -3.
    let py_launcher = t.id == "python"
        && program
            .file_stem()
            .map(|s| s.to_string_lossy() == "py")
            .unwrap_or(false);
    if let Some(steps) = t.compile {
        let parts: Vec<String> = steps
            .iter()
            .map(|s| fill(s, program, runner, &src, &out, dir, &class))
            .collect();
        let started = Instant::now();
        let outcome = run_limited(command_from(&parts, dir)?, b"", COMPILE_TIMEOUT, OUTPUT_CAP)?;
        result.compile_ms = started.elapsed().as_millis() as u64;
        result.compile_output = format!("{}{}", outcome.stdout, outcome.stderr);
        if outcome.timed_out {
            result.compiled = false;
            result
                .compile_output
                .push_str("\nCompiling took too long and was stopped.");
            return Ok(result);
        }
        if !outcome.status.map(|s| s.success()).unwrap_or(false) {
            result.compiled = false;
            result.exit_code = outcome.status.and_then(|s| s.code());
            return Ok(result);
        }
    }
    let mut parts: Vec<String> = t
        .run
        .iter()
        .map(|s| fill(s, program, runner, &src, &out, dir, &class))
        .collect();
    if typescript_on_node {
        parts.insert(1, "--experimental-strip-types".into());
        parts.insert(2, "--no-warnings".into());
    }
    if deno {
        // deno run grants no file, network or environment access unless asked.
        parts.splice(
            1..1,
            [
                "run".to_string(),
                "--quiet".to_string(),
                "--no-prompt".to_string(),
            ],
        );
    }
    if py_launcher {
        parts.insert(1, "-3".into());
    }
    parts.extend(request.args.iter().cloned());
    let limit = if t.one_step_build {
        timeout + COMPILE_TIMEOUT
    } else {
        timeout
    };
    let started = Instant::now();
    let outcome = run_limited(
        command_from(&parts, dir)?,
        request.stdin.as_bytes(),
        limit,
        OUTPUT_CAP,
    )?;
    result.run_ms = started.elapsed().as_millis() as u64;
    result.stdout = outcome.stdout;
    result.stderr = outcome.stderr;
    result.exit_code = outcome.status.and_then(|s| s.code());
    result.timed_out = outcome.timed_out;
    result.truncated = outcome.truncated;
    Ok(result)
}

struct Outcome {
    status: Option<ExitStatus>,
    stdout: String,
    stderr: String,
    timed_out: bool,
    truncated: bool,
}

/// Reads a stream, keeping at most `cap` bytes; flags a flood (far past the cap) so the run can be stopped.
fn drain(
    mut pipe: impl Read + Send + 'static,
    cap: usize,
    flood: Arc<AtomicBool>,
) -> std::thread::JoinHandle<(Vec<u8>, bool)> {
    std::thread::spawn(move || {
        let mut kept = Vec::new();
        let mut total = 0usize;
        let mut buf = [0u8; 16 * 1024];
        loop {
            match pipe.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    total += n;
                    if kept.len() < cap {
                        let room = cap - kept.len();
                        kept.extend_from_slice(&buf[..n.min(room)]);
                    }
                    if total > cap * 4 {
                        flood.store(true, Ordering::Relaxed);
                    }
                }
            }
        }
        (kept, total > cap)
    })
}

/// Stops a program and anything it started.
fn stop(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let mut kill = Command::new("taskkill");
        {
            use std::os::windows::process::CommandExt;
            kill.creation_flags(0x0800_0000);
        }
        let _ = kill
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

/// Runs a command with input, a time limit and capped output.
fn run_limited(
    mut command: Command,
    input: &[u8],
    timeout: Duration,
    cap: usize,
) -> Result<Outcome, String> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group, so a time-out stops its children too.
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start {:?}: {e}", command.get_program()))?;
    let flood = Arc::new(AtomicBool::new(false));
    let out = drain(
        child.stdout.take().ok_or("No output pipe.")?,
        cap,
        flood.clone(),
    );
    let err = drain(
        child.stderr.take().ok_or("No error pipe.")?,
        cap,
        flood.clone(),
    );
    if let Some(mut stdin) = child.stdin.take() {
        let data = input.to_vec();
        std::thread::spawn(move || {
            let _ = stdin.write_all(&data);
        });
    }
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if started.elapsed() > timeout || flood.load(Ordering::Relaxed) {
                    timed_out = started.elapsed() > timeout;
                    stop(&mut child);
                    break child.wait().ok();
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    let (stdout, cut_out) = out.join().unwrap_or_default();
    let (stderr, cut_err) = err.join().unwrap_or_default();
    Ok(Outcome {
        status,
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        timed_out,
        truncated: cut_out || cut_err || flood.load(Ordering::Relaxed),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn go(language: &str, source: &str, stdin: &str, timeout_ms: u64) -> Option<RunResult> {
        let t = toolchain(language)?;
        find(t.id, t.programs)?;
        Some(
            run(RunRequest {
                language: language.into(),
                source: source.into(),
                stdin: stdin.into(),
                args: vec![],
                timeout_ms,
            })
            .expect("run"),
        )
    }

    #[test]
    fn finds_java_class_names() {
        assert_eq!(java_class("import java.util.*;\npublic class Hello {\n public static void main(String[] a) {} }"), "Hello");
        assert_eq!(java_class("class A {}\npublic final class B {}"), "B");
        assert_eq!(java_class("class Only { }"), "Only");
        assert_eq!(java_class("// nothing"), "Main");
    }

    #[test]
    fn runs_python_with_input() {
        if let Some(r) = go(
            "python",
            "name = input()\nprint('Hello', name)\nprint(sum(map(int, input().split())))",
            "Ada\n1 2 3\n",
            10_000,
        ) {
            assert_eq!(r.stdout, "Hello Ada\n6\n");
            assert_eq!(r.exit_code, Some(0));
        }
    }

    #[test]
    fn compiles_and_runs_c_and_reports_errors() {
        if let Some(r) = go("c", "#include <stdio.h>\nint main(void){int a,b;scanf(\"%d %d\",&a,&b);printf(\"%d\\n\",a*b);return 3;}", "6 7", 10_000) {
            assert!(r.compiled, "{}", r.compile_output);
            assert_eq!(r.stdout, "42\n");
            assert_eq!(r.exit_code, Some(3));
        }
        if let Some(r) = go("c", "int main(void){ return x; }", "", 10_000) {
            assert!(!r.compiled);
            assert!(
                r.compile_output.contains("undeclared"),
                "{}",
                r.compile_output
            );
        }
    }

    #[test]
    fn stops_programs_that_run_too_long_or_print_too_much() {
        if let Some(r) = go("python", "while True:\n    pass", "", 800) {
            assert!(r.timed_out);
        }
        if let Some(r) = go("python", "while True:\n    print('x' * 1000)", "", 20_000) {
            assert!(r.truncated);
            assert!(!r.timed_out);
            assert!(r.stdout.len() <= OUTPUT_CAP);
        }
    }

    #[test]
    fn runs_the_compiled_languages_found_here() {
        let cases: &[(&str, &str, &str)] = &[
            ("cpp", "#include <iostream>\nint main(){std::string s; std::cin>>s; std::cout<<s<<\"!\"<<std::endl;}", "hi\nhi!\n"),
            ("java", "import java.util.*;\npublic class Greeter { public static void main(String[] a){ Scanner s = new Scanner(System.in); System.out.println(s.next() + \"!\"); } }", "hi\nhi!\n"),
            ("go", "package main\nimport \"fmt\"\nfunc main(){ var s string; fmt.Scan(&s); fmt.Println(s + \"!\") }", "hi\nhi!\n"),
            ("rust", "use std::io::Read;\nfn main(){ let mut s = String::new(); std::io::stdin().read_to_string(&mut s).unwrap(); println!(\"{}!\", s.trim()); }", "hi\nhi!\n"),
            ("javascript", "process.stdin.on('data', d => console.log(String(d).trim() + '!'));", "hi\nhi!\n"),
            ("ruby", "puts gets.strip + '!'", "hi\nhi!\n"),
            ("php", "<?php echo trim(fgets(STDIN)) . \"!\\n\";", "hi\nhi!\n"),
            ("perl", "my $s = <STDIN>; chomp $s; print \"$s!\\n\";", "hi\nhi!\n"),
            ("bash", "read s; echo \"$s!\"", "hi\nhi!\n"),
        ];
        for (language, source, io) in cases {
            let (input, expected) = io.split_once('\n').unwrap();
            if let Some(r) = go(language, source, &format!("{input}\n"), 60_000) {
                assert!(r.compiled, "{language}: {}", r.compile_output);
                assert_eq!(r.stdout, *expected, "{language}: {}", r.stderr);
            }
        }
    }

    #[test]
    fn lists_toolchains_without_running_anything() {
        let list = code_toolchains();
        assert_eq!(list.len(), TOOLCHAINS.len());
        assert!(list.iter().any(|t| t.id == "python"));
    }
}
