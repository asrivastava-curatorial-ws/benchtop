//! Git Workbench: reads a repository with the git installed on this computer.
//!
//! The page names a repository by the token of a folder picked in the system dialog and
//! never passes a path of its own.  Git is started directly (no shell) with a fixed set of
//! arguments; revisions and paths from the page are checked and kept apart from options.
//! Everything here only reads history, except `git_resolve`, which writes one file inside
//! the repository and stages it.

use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::files::PickedFiles;

/// The most git may print for one request.
const MAX_OUTPUT: u64 = 8 * 1024 * 1024;
/// The largest file offered for merging.
const MAX_FILE: u64 = 4 * 1024 * 1024;

fn program() -> Result<PathBuf, String> {
    which::which("git").map_err(|_| {
        "Git is not installed, or not on the PATH. Install it (git-scm.com) and try again."
            .to_string()
    })
}

fn command(root: &Path) -> Result<Command, String> {
    let mut command = Command::new(program()?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
        .arg("-C")
        .arg(root)
        .args([
            "--no-pager",
            "--no-optional-locks",
            // A repository's own settings must not start programs while it is only read.
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.quotepath=false",
            "-c",
            "color.ui=never",
            "-c",
            "log.showSignature=false",
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_EXTERNAL_DIFF")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command)
}

/// Runs git and returns what it printed; an error carries git's own first words.
fn run(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut child = command(root)?
        .args(args)
        .spawn()
        .map_err(|e| format!("Git could not be started: {e}"))?;
    let mut out = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        stdout
            .take(MAX_OUTPUT + 1)
            .read_to_end(&mut out)
            .map_err(|e| format!("Git's answer could not be read: {e}"))?;
    }
    if out.len() as u64 > MAX_OUTPUT {
        let _ = child.kill();
        let _ = child.wait();
        return Err(
            "That is more than 8 MB of output. Narrow it down to one file or fewer commits."
                .to_string(),
        );
    }
    let mut errors = String::new();
    if let Some(mut stderr) = child.stderr.take() {
        let _ = (&mut stderr).take(64 * 1024).read_to_string(&mut errors);
    }
    let status = child
        .wait()
        .map_err(|e| format!("Git stopped unexpectedly: {e}"))?;
    if !status.success() {
        let first = errors
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("git failed");
        return Err(first
            .trim_start_matches("fatal: ")
            .trim_start_matches("error: ")
            .to_string());
    }
    Ok(out)
}

fn text(root: &Path, args: &[&str]) -> Result<String, String> {
    Ok(String::from_utf8_lossy(&run(root, args)?).into_owned())
}

/// The folder behind a token, checked to be the top of a repository.
fn repository(picked: &PickedFiles, token: &str) -> Result<PathBuf, String> {
    let path = picked
        .path(token)
        .ok_or("Choose the repository folder again.")?;
    if !path.is_dir() {
        return Err(format!("{} is not a folder.", path.display()));
    }
    if !path.join(".git").exists() {
        return Err(format!(
            "{} is not the top folder of a Git repository (it has no .git).",
            path.display()
        ));
    }
    Ok(path)
}

/// A branch, tag or commit name, safe to hand to git after `--end-of-options`.
fn revision(name: &str) -> Result<&str, String> {
    let bad = name.is_empty()
        || name.len() > 250
        || name.starts_with('-')
        || name.contains("..")
        || name.chars().any(|c| {
            c.is_whitespace() || c.is_control() || matches!(c, ':' | '?' | '*' | '[' | '\\')
        });
    if bad {
        return Err(format!("“{name}” is not a branch, tag or commit name."));
    }
    Ok(name)
}

/// A path inside the repository, as git writes it (forward slashes, no leading slash).
fn inside(path: &str) -> Result<&str, String> {
    let relative = Path::new(path);
    if path.is_empty()
        || path.contains('\0')
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("“{path}” is not a path inside the repository."));
    }
    Ok(path)
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    hash: String,
    parents: Vec<String>,
    author: String,
    email: String,
    /// Seconds since 1970.
    time: i64,
    refs: Vec<String>,
    subject: String,
}

const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e";

fn parse_log(out: &str) -> Vec<Commit> {
    out.split('\x1e')
        .filter_map(|record| {
            let fields: Vec<&str> = record
                .trim_start_matches(['\n', '\r'])
                .split('\x1f')
                .collect();
            if fields.len() < 7 || fields[0].is_empty() {
                return None;
            }
            Some(Commit {
                hash: fields[0].to_string(),
                parents: fields[1].split_whitespace().map(str::to_string).collect(),
                author: fields[2].to_string(),
                email: fields[3].to_string(),
                time: fields[4].parse().unwrap_or(0),
                refs: fields[5]
                    .split(", ")
                    .filter(|r| !r.is_empty())
                    .map(str::to_string)
                    .collect(),
                subject: fields[6].to_string(),
            })
        })
        .collect()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    path: String,
    /// The branch checked out; empty when HEAD is detached or there are no commits yet.
    branch: String,
    head: String,
    version: String,
    merging: bool,
    conflicts: usize,
}

pub fn open(root: &Path) -> Result<RepoInfo, String> {
    let version = text(root, &["--version"])?
        .trim()
        .replace("git version ", "");
    let branch = text(root, &["symbolic-ref", "--short", "-q", "HEAD"]).unwrap_or_default();
    let head = text(root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default();
    let git_dir = PathBuf::from(text(root, &["rev-parse", "--absolute-git-dir"])?.trim());
    Ok(RepoInfo {
        path: root.display().to_string(),
        branch: branch.trim().to_string(),
        head: head.trim().to_string(),
        version,
        merging: [
            "MERGE_HEAD",
            "REBASE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
        ]
        .iter()
        .any(|name| git_dir.join(name).exists()),
        conflicts: conflicts(root)?.len(),
    })
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    /// `branch`, `tag` or `remote`.
    kind: &'static str,
    name: String,
    hash: String,
    current: bool,
    upstream: String,
    time: i64,
    subject: String,
}

pub fn references(root: &Path) -> Result<Vec<Reference>, String> {
    let out = text(
        root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname)%1f%(objectname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(committerdate:unix)%1f%(subject)",
            "refs/heads",
            "refs/tags",
            "refs/remotes",
        ],
    )?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\x1f').collect();
            if fields.len() < 6 {
                return None;
            }
            let (kind, name) = if let Some(name) = fields[0].strip_prefix("refs/heads/") {
                ("branch", name)
            } else if let Some(name) = fields[0].strip_prefix("refs/tags/") {
                ("tag", name)
            } else {
                ("remote", fields[0].strip_prefix("refs/remotes/")?)
            };
            if kind == "remote" && name.ends_with("/HEAD") {
                return None;
            }
            Some(Reference {
                kind,
                name: name.to_string(),
                hash: fields[1].to_string(),
                current: fields[2] == "*",
                upstream: fields[3].to_string(),
                time: fields[4].parse().unwrap_or(0),
                subject: fields[5].to_string(),
            })
        })
        .collect())
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LogOptions {
    /// A branch, tag or commit to start from; every branch when empty.
    #[serde(default)]
    rev: String,
    #[serde(default)]
    limit: u32,
    #[serde(default)]
    skip: u32,
    /// Only commits that touch this path.
    #[serde(default)]
    path: String,
    /// Only commits whose message has these words.
    #[serde(default)]
    search: String,
}

pub fn log(root: &Path, options: &LogOptions) -> Result<Vec<Commit>, String> {
    let limit = format!("-n{}", options.limit.clamp(1, 2000));
    let skip = format!("--skip={}", options.skip);
    let grep = format!("--grep={}", options.search);
    let mut args = vec!["log", LOG_FORMAT, "--date-order", &limit, &skip];
    if !options.search.trim().is_empty() {
        args.extend(["--fixed-strings", "-i", &grep]);
    }
    if options.rev.is_empty() {
        args.push("--all");
        args.push("--end-of-options");
    } else {
        args.push("--end-of-options");
        args.push(revision(&options.rev)?);
    }
    args.push("--");
    if !options.path.is_empty() {
        args.push(inside(&options.path)?);
    }
    match text(root, &args) {
        Ok(out) => Ok(parse_log(&out)),
        // A repository without commits has nothing to list.
        Err(message) if message.contains("does not have any commits") => Ok(Vec::new()),
        Err(message) => Err(message),
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Changed {
    /// A added, M modified, D deleted, R renamed, C copied, T type changed.
    status: String,
    path: String,
    /// The earlier path of a renamed or copied file.
    from: String,
    /// Lines added and removed; -1 for a binary file.
    added: i64,
    removed: i64,
}

/// Joins `--name-status -z` and `--numstat -z` output into one list.
fn parse_changed(status: &str, numbers: &str) -> Vec<Changed> {
    let mut files: Vec<Changed> = Vec::new();
    let mut parts = status.split('\0');
    while let Some(code) = parts.next() {
        if code.is_empty() {
            continue;
        }
        let letter = code[..1].to_string();
        let first = parts.next().unwrap_or("").to_string();
        let (from, path) = if letter == "R" || letter == "C" {
            (first, parts.next().unwrap_or("").to_string())
        } else {
            (String::new(), first)
        };
        files.push(Changed {
            status: letter,
            path,
            from,
            added: 0,
            removed: 0,
        });
    }
    let mut parts = numbers.split('\0');
    while let Some(entry) = parts.next() {
        let fields: Vec<&str> = entry.splitn(3, '\t').collect();
        if fields.len() < 3 {
            continue;
        }
        // A rename has an empty path here, followed by the old and the new path.
        let path = if fields[2].is_empty() {
            parts.next();
            parts.next().unwrap_or("")
        } else {
            fields[2]
        };
        if let Some(file) = files.iter_mut().find(|file| file.path == path) {
            file.added = fields[0].parse().unwrap_or(-1);
            file.removed = fields[1].parse().unwrap_or(-1);
        }
    }
    files
}

fn changed_between(root: &Path, from: &str, to: &str) -> Result<Vec<Changed>, String> {
    let status = text(
        root,
        &[
            "diff",
            "--name-status",
            "-M",
            "-z",
            "--end-of-options",
            from,
            to,
            "--",
        ],
    )?;
    let numbers = text(
        root,
        &[
            "diff",
            "--numstat",
            "-M",
            "-z",
            "--end-of-options",
            from,
            to,
            "--",
        ],
    )?;
    Ok(parse_changed(&status, &numbers))
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    commit: Commit,
    committer: String,
    commit_time: i64,
    message: String,
    files: Vec<Changed>,
}

pub fn commit(root: &Path, hash: &str) -> Result<CommitDetail, String> {
    let hash = revision(hash)?;
    let out = text(
        root,
        &[
            "show",
            "-s",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%cn%x1f%ct%x1f%B",
            "--end-of-options",
            hash,
            "--",
        ],
    )?;
    let fields: Vec<&str> = out.splitn(10, '\x1f').collect();
    if fields.len() < 10 {
        return Err("That commit could not be read.".to_string());
    }
    let commit = parse_log(&format!("{}\x1e", fields[..7].join("\x1f")))
        .into_iter()
        .next()
        .ok_or("That commit could not be read.")?;
    let files = match commit.parents.first() {
        // A merge is shown against its first parent: what the merge brought in.
        Some(parent) => changed_between(root, parent, &commit.hash)?,
        None => {
            let status = text(
                root,
                &[
                    "diff-tree",
                    "--root",
                    "-r",
                    "--no-commit-id",
                    "--name-status",
                    "-z",
                    "--end-of-options",
                    &commit.hash,
                ],
            )?;
            let numbers = text(
                root,
                &[
                    "diff-tree",
                    "--root",
                    "-r",
                    "--no-commit-id",
                    "--numstat",
                    "-z",
                    "--end-of-options",
                    &commit.hash,
                ],
            )?;
            parse_changed(&status, &numbers)
        }
    };
    Ok(CommitDetail {
        commit,
        committer: fields[7].to_string(),
        commit_time: fields[8].parse().unwrap_or(0),
        message: fields[9].trim_end().to_string(),
        files,
    })
}

/// A unified diff: of one commit against its first parent, or between two revisions.
pub fn diff(root: &Path, from: &str, to: &str, path: &str, context: u32) -> Result<String, String> {
    let to = revision(to)?;
    let unified = format!("-U{}", context.min(100_000));
    let mut args: Vec<&str> = Vec::new();
    if from.is_empty() {
        args.extend(["show", "--format=", "-m", "--first-parent"]);
    } else {
        args.push("diff");
    }
    args.extend([
        "--no-ext-diff",
        "--no-textconv",
        "-M",
        &unified,
        "--end-of-options",
    ]);
    if !from.is_empty() {
        args.push(revision(from)?);
    }
    args.push(to);
    args.push("--");
    if !path.is_empty() {
        args.push(inside(path)?);
    }
    text(root, &args)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    /// Commits only in the first and only in the second revision.
    only_first: i64,
    only_second: i64,
    /// The newest commit both have; empty when their histories are unrelated.
    merge_base: String,
    files: Vec<Changed>,
}

pub fn compare(root: &Path, first: &str, second: &str) -> Result<Comparison, String> {
    let first = revision(first)?;
    let second = revision(second)?;
    let range = format!("{first}...{second}");
    let counts = text(
        root,
        &[
            "rev-list",
            "--left-right",
            "--count",
            "--end-of-options",
            &range,
            "--",
        ],
    )?;
    let mut numbers = counts
        .split_whitespace()
        .map(|n| n.parse::<i64>().unwrap_or(0));
    let merge_base =
        text(root, &["merge-base", "--end-of-options", first, second]).unwrap_or_default();
    Ok(Comparison {
        only_first: numbers.next().unwrap_or(0),
        only_second: numbers.next().unwrap_or(0),
        merge_base: merge_base.trim().to_string(),
        files: changed_between(root, first, second)?,
    })
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Conflicted {
    path: String,
    /// Whether the common ancestor, our side and their side have the file.
    base: bool,
    ours: bool,
    theirs: bool,
}

/// Files with unresolved merge conflicts, read from the index (the work tree is not touched).
pub fn conflicts(root: &Path) -> Result<Vec<Conflicted>, String> {
    let out = text(root, &["ls-files", "-u", "-z"])?;
    let mut files: Vec<Conflicted> = Vec::new();
    for entry in out.split('\0').filter(|entry| !entry.is_empty()) {
        let Some((meta, path)) = entry.split_once('\t') else {
            continue;
        };
        let stage = meta.split_whitespace().nth(2).unwrap_or("");
        if files.last().map_or(true, |file| file.path != path) {
            files.push(Conflicted {
                path: path.to_string(),
                base: false,
                ours: false,
                theirs: false,
            });
        }
        let file = files.last_mut().expect("just added");
        match stage {
            "1" => file.base = true,
            "2" => file.ours = true,
            "3" => file.theirs = true,
            _ => {}
        }
    }
    Ok(files)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSides {
    /// Text of each side; None when that side does not have the file.
    base: Option<String>,
    ours: Option<String>,
    theirs: Option<String>,
    /// The file as it is in the folder now (with git's conflict markers).
    current: Option<String>,
}

fn utf8(bytes: Vec<u8>, what: &str) -> Result<String, String> {
    if bytes.contains(&0) {
        return Err(format!(
            "{what} is a binary file; it cannot be merged as text."
        ));
    }
    String::from_utf8(bytes).map_err(|_| {
        format!("{what} is not UTF-8 text; merge it in an editor that knows its encoding.")
    })
}

/// Where a path of the repository is on disk, refusing anything that leads outside it.
fn on_disk(root: &Path, path: &str) -> Result<PathBuf, String> {
    let target = root.join(inside(path)?);
    let real_root = root
        .canonicalize()
        .map_err(|e| format!("{}: {e}", root.display()))?;
    let parent = target.parent().ok_or("That path has no folder.")?;
    let real_parent = parent
        .canonicalize()
        .map_err(|_| format!("The folder of {path} does not exist."))?;
    if !real_parent.starts_with(&real_root) {
        return Err(format!("{path} leads outside the repository."));
    }
    if target
        .symlink_metadata()
        .is_ok_and(|meta| meta.file_type().is_symlink())
    {
        return Err(format!("{path} is a link; it is not read or written here."));
    }
    Ok(target)
}

pub fn conflict_sides(root: &Path, path: &str) -> Result<ConflictSides, String> {
    let path = inside(path)?;
    let stage = |number: u8| -> Result<Option<String>, String> {
        match run(
            root,
            &["show", "--end-of-options", &format!(":{number}:{path}")],
        ) {
            Ok(bytes) => utf8(bytes, path).map(Some),
            Err(_) => Ok(None),
        }
    };
    let file = on_disk(root, path)?;
    let current = match std::fs::metadata(&file) {
        Ok(meta) if meta.len() > MAX_FILE => return Err(format!("{path} is larger than 4 MB.")),
        Ok(_) => Some(utf8(
            std::fs::read(&file).map_err(|e| format!("{path}: {e}"))?,
            path,
        )?),
        Err(_) => None,
    };
    Ok(ConflictSides {
        base: stage(1)?,
        ours: stage(2)?,
        theirs: stage(3)?,
        current,
    })
}

/// Writes the merged text of a conflicted file and stages it, which tells git it is resolved.
pub fn resolve(root: &Path, path: &str, content: &str) -> Result<(), String> {
    let path = inside(path)?;
    if !conflicts(root)?.iter().any(|file| file.path == path) {
        return Err(format!("{path} has no unresolved conflict."));
    }
    let file = on_disk(root, path)?;
    std::fs::write(&file, content).map_err(|e| format!("{path} could not be written: {e}"))?;
    run(root, &["add", "--", path]).map(|_| ())
}

/* --------------------------------------------------------------- commands -- */

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("Git stopped unexpectedly: {e}"))?
}

#[tauri::command]
pub async fn git_open(token: String, picked: State<'_, PickedFiles>) -> Result<RepoInfo, String> {
    let root = repository(&picked, &token)?;
    blocking(move || open(&root)).await
}

#[tauri::command]
pub async fn git_refs(
    token: String,
    picked: State<'_, PickedFiles>,
) -> Result<Vec<Reference>, String> {
    let root = repository(&picked, &token)?;
    blocking(move || references(&root)).await
}

#[tauri::command]
pub async fn git_log(
    token: String,
    options: LogOptions,
    picked: State<'_, PickedFiles>,
) -> Result<Vec<Commit>, String> {
    let root = repository(&picked, &token)?;
    blocking(move || log(&root, &options)).await
}

#[tauri::command]
pub async fn git_commit(
    token: String,
    hash: String,
    picked: State<'_, PickedFiles>,
) -> Result<CommitDetail, String> {
    let root = repository(&picked, &token)?;
    blocking(move || commit(&root, &hash)).await
}

#[tauri::command]
pub async fn git_diff(
    token: String,
    from: String,
    to: String,
    path: String,
    context: u32,
    picked: State<'_, PickedFiles>,
) -> Result<String, String> {
    let root = repository(&picked, &token)?;
    blocking(move || diff(&root, &from, &to, &path, context)).await
}

#[tauri::command]
pub async fn git_compare(
    token: String,
    first: String,
    second: String,
    picked: State<'_, PickedFiles>,
) -> Result<Comparison, String> {
    let root = repository(&picked, &token)?;
    blocking(move || compare(&root, &first, &second)).await
}

#[tauri::command]
pub async fn git_conflicts(
    token: String,
    picked: State<'_, PickedFiles>,
) -> Result<Vec<Conflicted>, String> {
    let root = repository(&picked, &token)?;
    blocking(move || conflicts(&root)).await
}

#[tauri::command]
pub async fn git_conflict_sides(
    token: String,
    path: String,
    picked: State<'_, PickedFiles>,
) -> Result<ConflictSides, String> {
    let root = repository(&picked, &token)?;
    blocking(move || conflict_sides(&root, &path)).await
}

#[tauri::command]
pub async fn git_resolve(
    token: String,
    path: String,
    content: String,
    picked: State<'_, PickedFiles>,
) -> Result<(), String> {
    let root = repository(&picked, &token)?;
    blocking(move || resolve(&root, &path, &content)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch repository with two branches that change the same line, merged into a conflict.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Option<Self> {
            program().ok()?;
            let dir =
                std::env::temp_dir().join(format!("benchtop-git-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("scratch folder");
            let scratch = Scratch(dir);
            scratch.git(&["init", "-q", "-b", "main"]);
            for (key, value) in [
                ("user.name", "Test Curator"),
                ("user.email", "curator@museum.example"),
                ("commit.gpgsign", "false"),
            ] {
                scratch.git(&["config", key, value]);
            }
            Some(scratch)
        }
        fn git(&self, args: &[&str]) -> String {
            let out = Command::new("git")
                .arg("-C")
                .arg(&self.0)
                .args(args)
                .env("GIT_AUTHOR_DATE", "2026-11-01T10:00:00Z")
                .env("GIT_COMMITTER_DATE", "2026-11-01T10:00:00Z")
                .output()
                .expect("git runs");
            String::from_utf8_lossy(&out.stdout).into_owned()
        }
        fn write(&self, name: &str, text: &str) {
            let path = self.0.join(name);
            std::fs::create_dir_all(path.parent().expect("parent")).expect("folders");
            std::fs::write(path, text).expect("file");
        }
        fn commit(&self, message: &str) {
            self.git(&["add", "-A"]);
            self.git(&["commit", "-q", "-m", message]);
        }
        /// main: labels.txt changed; feature: the same line changed differently, plus a renamed file.
        fn with_branches(&self) {
            self.write("labels.txt", "Engine Hall\nopen daily\nfree entry\n");
            self.write(
                "notes/old name.txt",
                "kept as it is\nline two\nline three\n",
            );
            self.commit("First labels");
            self.git(&["checkout", "-q", "-b", "feature"]);
            self.write("labels.txt", "Engine Hall\nopen on weekdays\nfree entry\n");
            self.git(&["mv", "notes/old name.txt", "notes/new name.txt"]);
            self.commit("Weekday hours and a better name");
            self.git(&["checkout", "-q", "main"]);
            self.write("labels.txt", "Engine Hall\nopen every day\nfree entry\n");
            self.write("données.txt", "accents in names\n");
            self.commit("Daily hours\n\nWith a longer explanation.");
            self.git(&["tag", "v1"]);
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn checks_names_before_they_reach_git() {
        for good in [
            "main",
            "HEAD~2",
            "v1.0^{}",
            "origin/feature/x",
            "a1b2c3d",
            "héllo",
        ] {
            assert!(revision(good).is_ok(), "{good}");
        }
        for bad in [
            "",
            "-rf",
            "--output=x",
            "a..b",
            "a b",
            "a:b",
            "x\ny",
            "ref*",
            "a\\b",
        ] {
            assert!(revision(bad).is_err(), "{bad}");
        }
        for good in ["a.txt", "dir/a b.txt", "données.txt"] {
            assert!(inside(good).is_ok(), "{good}");
        }
        for bad in ["", "../x", "/etc/passwd", "a/../../b", "a\0b"] {
            assert!(inside(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn joins_status_and_line_counts() {
        let files = parse_changed(
            "M\0a.txt\0R090\0old name.txt\0new name.txt\0A\0pic.png\0",
            "3\t1\ta.txt\x000\t0\t\0old name.txt\0new name.txt\0-\t-\tpic.png\0",
        );
        assert_eq!(files.len(), 3);
        assert_eq!(
            (files[0].status.as_str(), files[0].added, files[0].removed),
            ("M", 3, 1)
        );
        assert_eq!(
            (
                files[1].status.as_str(),
                files[1].from.as_str(),
                files[1].path.as_str()
            ),
            ("R", "old name.txt", "new name.txt")
        );
        assert_eq!((files[2].added, files[2].removed), (-1, -1));
    }

    #[test]
    fn reads_history_references_and_diffs() {
        let Some(scratch) = Scratch::new("history") else {
            return;
        };
        assert!(log(&scratch.0, &LogOptions::default())
            .expect("empty log")
            .is_empty());
        scratch.with_branches();
        let info = open(&scratch.0).expect("open");
        assert_eq!(
            (info.branch.as_str(), info.merging, info.conflicts),
            ("main", false, 0)
        );
        assert!(!info.head.is_empty() && !info.version.is_empty());

        let refs = references(&scratch.0).expect("refs");
        let names: Vec<(&str, &str, bool)> = refs
            .iter()
            .map(|r| (r.kind, r.name.as_str(), r.current))
            .collect();
        assert!(
            names.contains(&("branch", "main", true))
                && names.contains(&("branch", "feature", false))
                && names.contains(&("tag", "v1", false)),
            "{names:?}"
        );

        let all = log(
            &scratch.0,
            &LogOptions {
                limit: 50,
                ..LogOptions::default()
            },
        )
        .expect("log");
        assert_eq!(all.len(), 3);
        let main = log(
            &scratch.0,
            &LogOptions {
                rev: "main".into(),
                limit: 50,
                ..LogOptions::default()
            },
        )
        .expect("log");
        assert_eq!(
            main.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(),
            ["Daily hours", "First labels"]
        );
        assert_eq!(
            (
                main[0].author.as_str(),
                main[0].email.as_str(),
                main[0].time
            ),
            ("Test Curator", "curator@museum.example", 1_793_527_200)
        );
        assert_eq!(main[0].parents, [main[1].hash.clone()]);
        assert!(
            main[0].refs.iter().any(|r| r == "HEAD -> main")
                && main[0].refs.iter().any(|r| r == "tag: v1"),
            "{:?}",
            main[0].refs
        );
        let found = log(
            &scratch.0,
            &LogOptions {
                search: "WEEKDAY".into(),
                limit: 50,
                ..LogOptions::default()
            },
        )
        .expect("log");
        assert_eq!(found.len(), 1);
        let touching = log(
            &scratch.0,
            &LogOptions {
                rev: "main".into(),
                path: "données.txt".into(),
                limit: 50,
                ..LogOptions::default()
            },
        )
        .expect("log");
        assert_eq!(touching.len(), 1);
        assert!(log(
            &scratch.0,
            &LogOptions {
                rev: "--all".into(),
                limit: 5,
                ..LogOptions::default()
            }
        )
        .is_err());

        let detail = commit(&scratch.0, "main").expect("commit");
        assert_eq!(detail.message, "Daily hours\n\nWith a longer explanation.");
        assert_eq!(detail.committer, "Test Curator");
        let files: Vec<(&str, &str, i64, i64)> = detail
            .files
            .iter()
            .map(|f| (f.status.as_str(), f.path.as_str(), f.added, f.removed))
            .collect();
        assert_eq!(
            files,
            [("A", "données.txt", 1, 0), ("M", "labels.txt", 1, 1)]
        );
        let root = commit(&scratch.0, &main[1].hash).expect("root commit");
        assert_eq!(root.files.len(), 2);
        assert!(root.files.iter().all(|f| f.status == "A"));

        let one = diff(&scratch.0, "", "main", "labels.txt", 3).expect("diff");
        assert!(
            one.contains("-open daily\n+open every day\n") && !one.contains("données"),
            "{one}"
        );
        let first = diff(&scratch.0, "", &main[1].hash, "", 3).expect("root diff");
        assert!(first.contains("+Engine Hall"));
        let between = diff(&scratch.0, "main", "feature", "", 0).expect("diff");
        assert!(
            between.contains("rename from notes/old name.txt")
                && between.contains("+open on weekdays"),
            "{between}"
        );
        assert!(diff(&scratch.0, "main", "feature", "../outside", 3).is_err());

        let compared = compare(&scratch.0, "main", "feature").expect("compare");
        assert_eq!((compared.only_first, compared.only_second), (1, 1));
        assert_eq!(compared.merge_base, main[1].hash);
        let renamed = compared
            .files
            .iter()
            .find(|f| f.status == "R")
            .expect("rename");
        assert_eq!(
            (renamed.from.as_str(), renamed.path.as_str()),
            ("notes/old name.txt", "notes/new name.txt")
        );
        assert!(compare(&scratch.0, "main", "no-such-branch").is_err());
    }

    #[test]
    fn lists_conflicts_and_resolves_one() {
        let Some(scratch) = Scratch::new("conflict") else {
            return;
        };
        scratch.with_branches();
        scratch.git(&["merge", "feature"]);
        let info = open(&scratch.0).expect("open");
        assert_eq!((info.merging, info.conflicts), (true, 1));
        assert_eq!(
            conflicts(&scratch.0).expect("conflicts"),
            [Conflicted {
                path: "labels.txt".into(),
                base: true,
                ours: true,
                theirs: true
            }]
        );
        let sides = conflict_sides(&scratch.0, "labels.txt").expect("sides");
        assert_eq!(
            sides.base.as_deref(),
            Some("Engine Hall\nopen daily\nfree entry\n")
        );
        assert_eq!(
            sides.ours.as_deref(),
            Some("Engine Hall\nopen every day\nfree entry\n")
        );
        assert_eq!(
            sides.theirs.as_deref(),
            Some("Engine Hall\nopen on weekdays\nfree entry\n")
        );
        assert!(sides.current.expect("current").contains("<<<<<<< HEAD"));

        assert!(resolve(&scratch.0, "données.txt", "x")
            .unwrap_err()
            .contains("no unresolved conflict"));
        assert!(resolve(&scratch.0, "../escape.txt", "x").is_err());
        resolve(
            &scratch.0,
            "labels.txt",
            "Engine Hall\nopen every day, weekdays from 10\nfree entry\n",
        )
        .expect("resolve");
        assert!(conflicts(&scratch.0).expect("conflicts").is_empty());
        assert_eq!(
            std::fs::read_to_string(scratch.0.join("labels.txt")).expect("file"),
            "Engine Hall\nopen every day, weekdays from 10\nfree entry\n"
        );
        assert!(scratch
            .git(&["status", "--porcelain"])
            .contains("M  labels.txt"));
        assert!(!scratch.0.join("../escape.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn does_not_write_through_links() {
        let Some(scratch) = Scratch::new("links") else {
            return;
        };
        scratch.write("real.txt", "text\n");
        let outside = scratch.0.with_extension("outside");
        std::fs::create_dir_all(&outside).expect("outside");
        std::os::unix::fs::symlink(&outside, scratch.0.join("out")).expect("folder link");
        std::os::unix::fs::symlink(scratch.0.join("real.txt"), scratch.0.join("link.txt"))
            .expect("file link");
        assert!(on_disk(&scratch.0, "out/file.txt")
            .unwrap_err()
            .contains("outside the repository"));
        assert!(on_disk(&scratch.0, "link.txt")
            .unwrap_err()
            .contains("is a link"));
        assert!(on_disk(&scratch.0, "real.txt").is_ok());
        let _ = std::fs::remove_dir_all(outside);
    }
}
