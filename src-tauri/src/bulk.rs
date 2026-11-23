//! Files and folders: listing for bulk renames, renaming, finding duplicate
//! files, measuring what fills a folder and comparing two folders.  Every
//! command works only inside folders the person chose in the native folder
//! dialog (passed as tokens), and nothing is deleted outright: unwanted files
//! go to the system's trash.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

use crate::files::PickedFiles;

#[derive(Default)]
pub struct BulkState {
    cancelled: Mutex<HashSet<String>>,
}

impl BulkState {
    fn is_cancelled(&self, id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|c| c.contains(id))
            .unwrap_or(false)
    }
    fn clear(&self, id: &str) {
        if let Ok(mut c) = self.cancelled.lock() {
            c.remove(id);
        }
    }
}

fn root(picked: &PickedFiles, token: &str) -> Result<PathBuf, String> {
    let path = picked.path(token).ok_or("Choose the folder again.")?;
    if !path.is_dir() {
        return Err(format!("{} is not a folder.", path.display()));
    }
    Ok(path)
}

/// A relative path that stays inside its folder (no "..", no absolute parts).
fn inside(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) || relative.is_empty() {
        return Err(format!("“{relative}” is not a path inside the folder."));
    }
    Ok(root.join(rel))
}

fn rel_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

fn hidden(entry: &walkdir::DirEntry) -> bool {
    entry.depth() > 0 && entry.file_name().to_string_lossy().starts_with('.')
}

/* ------------------------------------------------------------- listing -- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Path inside the chosen folder, with "/" separators.
    pub path: String,
    pub size: u64,
    pub modified: u64,
}

/// Files in a folder (and its subfolders when `recursive`), for renaming.
#[tauri::command]
pub async fn bulk_list(
    token: String,
    recursive: bool,
    include_hidden: bool,
    picked: State<'_, PickedFiles>,
) -> Result<Vec<Entry>, String> {
    let base = root(&picked, &token)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        let walker = WalkDir::new(&base)
            .min_depth(1)
            .max_depth(if recursive { 64 } else { 1 })
            .sort_by_file_name();
        for entry in walker
            .into_iter()
            .filter_entry(|e| include_hidden || !hidden(e))
            .flatten()
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            out.push(Entry {
                path: rel_string(&base, entry.path()),
                size: meta.len(),
                modified: modified_ms(&meta),
            });
            if out.len() >= 50_000 {
                break;
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
pub struct Rename {
    pub from: String,
    pub to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub done: Vec<(String, String)>,
    pub failed: Vec<(String, String)>,
}

/// Checks a set of renames before anything is touched: names must be valid,
/// unique, and not land on files that are not themselves being renamed.
pub fn check_renames(base: &Path, renames: &[Rename]) -> Result<(), String> {
    let mut targets = HashSet::new();
    let sources: HashSet<String> = renames.iter().map(|r| r.from.to_lowercase()).collect();
    for r in renames {
        let name = r.to.rsplit('/').next().unwrap_or_default();
        if name.is_empty()
            || name == "."
            || name == ".."
            || name
                .chars()
                .any(|c| c.is_control() || r#"\:*?"<>|"#.contains(c))
            || name.ends_with(' ')
            || name.ends_with('.')
        {
            return Err(format!("“{}” is not a valid file name.", r.to));
        }
        inside(base, &r.from)?;
        let target = inside(base, &r.to)?;
        // Names that differ only in case clash on Windows and macOS.
        if !targets.insert(r.to.to_lowercase()) {
            return Err(format!("Two files would both be called “{}”.", r.to));
        }
        if target.exists() && !sources.contains(&r.to.to_lowercase()) {
            return Err(format!("“{}” already exists.", r.to));
        }
    }
    Ok(())
}

/// Renames files, by way of temporary names so swaps and chains work.
#[tauri::command]
pub async fn bulk_rename(
    token: String,
    renames: Vec<Rename>,
    picked: State<'_, PickedFiles>,
) -> Result<RenameResult, String> {
    let base = root(&picked, &token)?;
    tauri::async_runtime::spawn_blocking(move || {
        let renames: Vec<Rename> = renames.into_iter().filter(|r| r.from != r.to).collect();
        check_renames(&base, &renames)?;
        let stamp = format!(
            "{:x}",
            std::process::id() as u128 ^ Instant::now().elapsed().as_nanos()
        );
        let mut staged: Vec<(&Rename, PathBuf)> = Vec::new();
        let mut result = RenameResult {
            done: Vec::new(),
            failed: Vec::new(),
        };
        for (i, r) in renames.iter().enumerate() {
            let from = inside(&base, &r.from)?;
            let temp = from.with_file_name(format!(".benchtop-rename-{stamp}-{i}"));
            match std::fs::rename(&from, &temp) {
                Ok(()) => staged.push((r, temp)),
                Err(e) => result.failed.push((r.from.clone(), e.to_string())),
            }
        }
        for (r, temp) in staged {
            let to = inside(&base, &r.to)?;
            if let Some(parent) = to.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::rename(&temp, &to) {
                Ok(()) => result.done.push((r.from.clone(), r.to.clone())),
                Err(e) => {
                    // Put it back under its old name.
                    let _ = std::fs::rename(&temp, inside(&base, &r.from)?);
                    result.failed.push((r.from.clone(), e.to_string()));
                }
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ---------------------------------------------------------- duplicates -- */

fn hash_file(path: &Path, limit: Option<u64>) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; 1 << 20];
    let mut left = limit.unwrap_or(u64::MAX);
    while left > 0 {
        let want = buffer
            .len()
            .min(usize::try_from(left).unwrap_or(usize::MAX));
        let n = file.read(&mut buffer[..want])?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        left -= n as u64;
    }
    Ok(hasher.finalize().to_hex().to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DupFile {
    /// Which chosen folder (index) and the path inside it.
    pub folder: usize,
    pub path: String,
    pub modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupGroup {
    pub size: u64,
    pub hash: String,
    pub files: Vec<DupFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupReport {
    pub scanned: usize,
    pub groups: Vec<DupGroup>,
    /// Space that removing all but one copy in each group would free.
    pub wasted: u64,
    pub cancelled: bool,
}

/// Groups files with identical contents: same size, then the same checksum of
/// the first 64 KB, then the same checksum of the whole file (BLAKE3).
pub fn find_duplicates(
    roots: &[PathBuf],
    min_size: u64,
    include_hidden: bool,
    progress: &dyn Fn(&str, usize, usize),
    cancelled: &dyn Fn() -> bool,
) -> DupReport {
    let mut by_size: HashMap<u64, Vec<(usize, PathBuf, u64)>> = HashMap::new();
    let mut scanned = 0usize;
    let mut seen_paths = HashSet::new();
    for (index, base) in roots.iter().enumerate() {
        for entry in WalkDir::new(base)
            .into_iter()
            .filter_entry(|e| include_hidden || !hidden(e))
            .flatten()
        {
            if cancelled() {
                return DupReport {
                    scanned,
                    groups: Vec::new(),
                    wasted: 0,
                    cancelled: true,
                };
            }
            if !entry.file_type().is_file() {
                continue;
            }
            // The same file reached from two chosen folders counts once.
            let canonical = entry
                .path()
                .canonicalize()
                .unwrap_or_else(|_| entry.path().to_path_buf());
            if !seen_paths.insert(canonical) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            scanned += 1;
            if scanned % 500 == 0 {
                progress("Listing files", scanned, 0);
            }
            if meta.len() >= min_size.max(1) {
                by_size.entry(meta.len()).or_default().push((
                    index,
                    entry.path().to_path_buf(),
                    modified_ms(&meta),
                ));
            }
        }
    }
    let candidates: Vec<(u64, Vec<(usize, PathBuf, u64)>)> =
        by_size.into_iter().filter(|(_, v)| v.len() > 1).collect();
    let total: usize = candidates.iter().map(|(_, v)| v.len()).sum();
    let mut done = 0usize;
    let mut groups = Vec::new();
    for (size, files) in candidates {
        let mut by_head: HashMap<String, Vec<(usize, PathBuf, u64)>> = HashMap::new();
        for f in files {
            if cancelled() {
                return DupReport {
                    scanned,
                    groups,
                    wasted: 0,
                    cancelled: true,
                };
            }
            done += 1;
            progress("Comparing contents", done, total);
            if let Ok(head) = hash_file(&f.1, Some(64 * 1024)) {
                by_head.entry(head).or_default().push(f);
            }
        }
        for (_, same_head) in by_head.into_iter().filter(|(_, v)| v.len() > 1) {
            let mut by_full: HashMap<String, Vec<(usize, PathBuf, u64)>> = HashMap::new();
            for f in same_head {
                if cancelled() {
                    return DupReport {
                        scanned,
                        groups,
                        wasted: 0,
                        cancelled: true,
                    };
                }
                let full = if size <= 64 * 1024 {
                    hash_file(&f.1, Some(64 * 1024))
                } else {
                    hash_file(&f.1, None)
                };
                if let Ok(full) = full {
                    by_full.entry(full).or_default().push(f);
                }
            }
            for (hash, same) in by_full.into_iter().filter(|(_, v)| v.len() > 1) {
                let mut files: Vec<DupFile> = same
                    .into_iter()
                    .map(|(folder, path, modified)| DupFile {
                        folder,
                        path: rel_string(&roots[folder], &path),
                        modified,
                    })
                    .collect();
                files.sort_by(|a, b| a.folder.cmp(&b.folder).then(a.path.cmp(&b.path)));
                groups.push(DupGroup { size, hash, files });
            }
        }
    }
    groups.sort_by(|a, b| {
        (b.size * (b.files.len() as u64 - 1)).cmp(&(a.size * (a.files.len() as u64 - 1)))
    });
    let wasted = groups
        .iter()
        .map(|g| g.size * (g.files.len() as u64 - 1))
        .sum();
    DupReport {
        scanned,
        groups,
        wasted,
        cancelled: false,
    }
}

#[tauri::command]
pub async fn bulk_duplicates(
    app: AppHandle,
    id: String,
    tokens: Vec<String>,
    min_size: u64,
    include_hidden: bool,
    picked: State<'_, PickedFiles>,
    state: State<'_, BulkState>,
) -> Result<DupReport, String> {
    let roots: Vec<PathBuf> = tokens
        .iter()
        .map(|t| root(&picked, t))
        .collect::<Result<_, _>>()?;
    state.clear(&id);
    let report = {
        let last = Mutex::new(Instant::now() - Duration::from_secs(1));
        let progress = |stage: &str, done: usize, total: usize| {
            let mut last = last.lock().expect("progress");
            if last.elapsed() > Duration::from_millis(150) {
                *last = Instant::now();
                let _ = app.emit(
                    "bulk-progress",
                    json!({ "id": id, "stage": stage, "done": done, "total": total }),
                );
            }
        };
        let cancelled = || state.is_cancelled(&id);
        tokio::task::block_in_place(|| {
            find_duplicates(&roots, min_size, include_hidden, &progress, &cancelled)
        })
    };
    state.clear(&id);
    Ok(report)
}

/// Moves files to the system's trash (they can be restored from there).
#[tauri::command]
pub async fn bulk_trash(
    items: Vec<(String, String)>,
    picked: State<'_, PickedFiles>,
) -> Result<Vec<(String, String)>, String> {
    let mut paths = Vec::new();
    for (token, relative) in &items {
        let base = root(&picked, token)?;
        let path = inside(&base, relative)?;
        if !path.is_file() {
            return Err(format!("{relative} is no longer there."));
        }
        paths.push((relative.clone(), path));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut failed = Vec::new();
        for (relative, path) in paths {
            if let Err(e) = trash::delete(&path) {
                failed.push((relative, e.to_string()));
            }
        }
        Ok(failed)
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ---------------------------------------------------------- disk usage -- */

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageNode {
    pub name: String,
    pub size: u64,
    pub files: u64,
    pub children: Vec<UsageNode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub tree: UsageNode,
    pub largest: Vec<Entry>,
    /// Size and count by extension, largest first.
    pub types: Vec<(String, u64, u64)>,
    pub cancelled: bool,
}

/// Sizes of every folder (folders below 0.1 % of the total are folded into "other files").
pub fn measure(base: &Path, progress: &dyn Fn(usize), cancelled: &dyn Fn() -> bool) -> UsageReport {
    let mut dirs: BTreeMap<PathBuf, (u64, u64)> = BTreeMap::new();
    let mut largest: Vec<Entry> = Vec::new();
    let mut types: HashMap<String, (u64, u64)> = HashMap::new();
    let mut count = 0usize;
    let mut was_cancelled = false;
    for entry in WalkDir::new(base).follow_links(false).into_iter().flatten() {
        if count % 1000 == 0 {
            if cancelled() {
                was_cancelled = true;
                break;
            }
            progress(count);
        }
        if !entry.file_type().is_file() {
            continue;
        }
        count += 1;
        let Ok(meta) = entry.metadata() else { continue };
        let size = meta.len();
        let mut dir = entry.path().parent();
        while let Some(d) = dir {
            let slot = dirs.entry(d.to_path_buf()).or_default();
            slot.0 += size;
            slot.1 += 1;
            if d == base {
                break;
            }
            dir = d.parent();
        }
        let ext = entry
            .path()
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_else(|| "(none)".into());
        let slot = types.entry(ext).or_default();
        slot.0 += size;
        slot.1 += 1;
        if largest.len() < 100 || size > largest.last().map_or(0, |l| l.size) {
            largest.push(Entry {
                path: rel_string(base, entry.path()),
                size,
                modified: modified_ms(&meta),
            });
            largest.sort_by(|a, b| b.size.cmp(&a.size));
            largest.truncate(100);
        }
    }
    let total = dirs.get(base).map_or(0, |d| d.0);
    let threshold = (total / 1000).max(1);
    fn build(
        path: &Path,
        name: String,
        dirs: &BTreeMap<PathBuf, (u64, u64)>,
        threshold: u64,
        depth: usize,
    ) -> UsageNode {
        let (size, files) = dirs.get(path).copied().unwrap_or_default();
        let mut node = UsageNode {
            name,
            size,
            files,
            children: Vec::new(),
        };
        if depth >= 12 {
            return node;
        }
        for (child, (child_size, _)) in dirs.range(path.to_path_buf()..) {
            if !child.starts_with(path) {
                break;
            }
            if child.parent() == Some(path) && *child_size >= threshold {
                node.children.push(build(
                    child,
                    child
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    dirs,
                    threshold,
                    depth + 1,
                ));
            }
        }
        // Files directly in this folder, and folders too small to show, as one piece.
        let rest = size.saturating_sub(node.children.iter().map(|c| c.size).sum::<u64>());
        if !node.children.is_empty() && rest > 0 {
            node.children.push(UsageNode {
                name: "(other files)".into(),
                size: rest,
                files: 0,
                children: Vec::new(),
            });
        }
        node.children.sort_by(|a, b| b.size.cmp(&a.size));
        node
    }
    let name = base
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| base.display().to_string());
    let tree = build(base, name, &dirs, threshold, 0);
    let mut types: Vec<(String, u64, u64)> =
        types.into_iter().map(|(k, (s, c))| (k, s, c)).collect();
    types.sort_by(|a, b| b.1.cmp(&a.1));
    types.truncate(40);
    UsageReport {
        tree,
        largest,
        types,
        cancelled: was_cancelled,
    }
}

#[tauri::command]
pub async fn bulk_usage(
    app: AppHandle,
    id: String,
    token: String,
    picked: State<'_, PickedFiles>,
    state: State<'_, BulkState>,
) -> Result<UsageReport, String> {
    let base = root(&picked, &token)?;
    state.clear(&id);
    let progress = |n: usize| {
        let _ = app.emit(
            "bulk-progress",
            json!({ "id": id, "stage": "Measuring", "done": n, "total": 0 }),
        );
    };
    let cancelled = || state.is_cancelled(&id);
    let report = tokio::task::block_in_place(|| measure(&base, &progress, &cancelled));
    state.clear(&id);
    Ok(report)
}

/* ------------------------------------------------------------- compare -- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRow {
    pub path: String,
    /// "same", "different", "left" (only on the left), "right".
    pub state: &'static str,
    pub left_size: Option<u64>,
    pub right_size: Option<u64>,
    pub left_modified: Option<u64>,
    pub right_modified: Option<u64>,
}

fn file_map(base: &Path, include_hidden: bool) -> BTreeMap<String, (u64, u64)> {
    WalkDir::new(base)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| include_hidden || !hidden(e))
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            e.metadata()
                .ok()
                .map(|m| (rel_string(base, e.path()), (m.len(), modified_ms(&m))))
        })
        .collect()
}

/// Compares two folders file by file: by path, then size, then (when `checksums`) contents.
pub fn compare_folders(
    left: &Path,
    right: &Path,
    checksums: bool,
    include_hidden: bool,
    progress: &dyn Fn(usize, usize),
    cancelled: &dyn Fn() -> bool,
) -> Result<Vec<CompareRow>, String> {
    let a = file_map(left, include_hidden);
    let b = file_map(right, include_hidden);
    let mut paths: Vec<&String> = a.keys().chain(b.keys()).collect();
    paths.sort();
    paths.dedup();
    let total = paths.len();
    let mut rows = Vec::with_capacity(total);
    for (i, path) in paths.into_iter().enumerate() {
        if i % 50 == 0 {
            if cancelled() {
                return Err("Stopped.".into());
            }
            progress(i, total);
        }
        let l = a.get(path);
        let r = b.get(path);
        let state = match (l, r) {
            (Some(_), None) => "left",
            (None, Some(_)) => "right",
            (Some(x), Some(y)) if x.0 != y.0 => "different",
            (Some(_), Some(_)) if checksums => {
                let same = hash_file(&left.join(path), None)
                    .ok()
                    .zip(hash_file(&right.join(path), None).ok())
                    .is_some_and(|(p, q)| p == q);
                if same {
                    "same"
                } else {
                    "different"
                }
            }
            _ => "same",
        };
        rows.push(CompareRow {
            path: path.clone(),
            state,
            left_size: l.map(|x| x.0),
            right_size: r.map(|y| y.0),
            left_modified: l.map(|x| x.1),
            right_modified: r.map(|y| y.1),
        });
    }
    Ok(rows)
}

#[tauri::command]
pub async fn bulk_compare(
    app: AppHandle,
    id: String,
    left: String,
    right: String,
    checksums: bool,
    include_hidden: bool,
    picked: State<'_, PickedFiles>,
    state: State<'_, BulkState>,
) -> Result<Vec<CompareRow>, String> {
    let (l, r) = (root(&picked, &left)?, root(&picked, &right)?);
    state.clear(&id);
    let progress = |done: usize, total: usize| {
        let _ = app.emit(
            "bulk-progress",
            json!({ "id": id, "stage": "Comparing", "done": done, "total": total }),
        );
    };
    let cancelled = || state.is_cancelled(&id);
    let rows = tokio::task::block_in_place(|| {
        compare_folders(&l, &r, checksums, include_hidden, &progress, &cancelled)
    });
    state.clear(&id);
    rows
}

/// Copies files from one chosen folder to the other (making folders as needed), overwriting.
#[tauri::command]
pub async fn bulk_copy(
    from: String,
    to: String,
    paths: Vec<String>,
    picked: State<'_, PickedFiles>,
) -> Result<Vec<(String, String)>, String> {
    let (source, target) = (root(&picked, &from)?, root(&picked, &to)?);
    tauri::async_runtime::spawn_blocking(move || {
        let mut failed = Vec::new();
        for p in paths {
            let result = (|| -> Result<(), String> {
                let src = inside(&source, &p)?;
                let dst = inside(&target, &p)?;
                if let Some(parent) = dst.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
                Ok(())
            })();
            if let Err(e) = result {
                failed.push((p, e));
            }
        }
        Ok(failed)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn bulk_cancel(id: String, state: State<'_, BulkState>) {
    if let Ok(mut c) = state.cancelled.lock() {
        c.insert(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("benchtop-bulk-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn refuses_paths_that_leave_the_folder() {
        let base = Path::new("/tmp/x");
        assert!(inside(base, "a/b.txt").is_ok());
        assert!(inside(base, "../etc/passwd").is_err());
        assert!(inside(base, "/etc/passwd").is_err());
        assert!(inside(base, "").is_err());
    }

    #[test]
    fn checks_renames_before_touching_anything() {
        let dir = temp("rename-check");
        std::fs::write(dir.join("a.txt"), "a").unwrap();
        std::fs::write(dir.join("b.txt"), "b").unwrap();
        std::fs::write(dir.join("c.txt"), "c").unwrap();
        let r = |from: &str, to: &str| Rename {
            from: from.into(),
            to: to.into(),
        };
        // A swap is fine; landing on a file that stays is not.
        assert!(check_renames(&dir, &[r("a.txt", "b.txt"), r("b.txt", "a.txt")]).is_ok());
        assert!(check_renames(&dir, &[r("a.txt", "c.txt")])
            .unwrap_err()
            .contains("already exists"));
        assert!(
            check_renames(&dir, &[r("a.txt", "x.txt"), r("b.txt", "X.TXT")])
                .unwrap_err()
                .contains("both be called")
        );
        assert!(check_renames(&dir, &[r("a.txt", "bad:name.txt")]).is_err());
        assert!(check_renames(&dir, &[r("a.txt", "../out.txt")]).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn finds_duplicates_by_content() {
        let dir = temp("dups");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let big = vec![7u8; 200_000];
        let mut other = big.clone();
        other[150_000] = 8; // same size and same first 64 KB, different contents
        std::fs::write(dir.join("one.bin"), &big).unwrap();
        std::fs::write(dir.join("sub/two.bin"), &big).unwrap();
        std::fs::write(dir.join("near.bin"), &other).unwrap();
        std::fs::write(dir.join("small1.txt"), "same words").unwrap();
        std::fs::write(dir.join("small2.txt"), "same words").unwrap();
        std::fs::write(dir.join(".hidden.txt"), "same words").unwrap();
        let report = find_duplicates(std::slice::from_ref(&dir), 1, false, &|_, _, _| {}, &|| {
            false
        });
        assert_eq!(report.groups.len(), 2);
        assert_eq!(
            report.groups[0]
                .files
                .iter()
                .map(|f| f.path.as_str())
                .collect::<Vec<_>>(),
            vec!["one.bin", "sub/two.bin"]
        );
        assert_eq!(report.groups[1].files.len(), 2);
        assert_eq!(report.wasted, 200_000 + 10);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn measures_and_compares_folders() {
        let left = temp("left");
        let right = temp("right");
        std::fs::create_dir_all(left.join("photos")).unwrap();
        std::fs::write(left.join("photos/a.jpg"), vec![1u8; 5000]).unwrap();
        std::fs::write(left.join("notes.txt"), "hello").unwrap();
        std::fs::write(left.join("only-left.txt"), "x").unwrap();
        std::fs::create_dir_all(right.join("photos")).unwrap();
        std::fs::write(right.join("photos/a.jpg"), vec![1u8; 5000]).unwrap();
        std::fs::write(right.join("notes.txt"), "hellO").unwrap();
        std::fs::write(right.join("only-right.txt"), "y").unwrap();
        let usage = measure(&left, &|_| {}, &|| false);
        assert_eq!(usage.tree.size, 5006);
        assert_eq!(usage.tree.files, 3);
        assert_eq!(usage.tree.children[0].name, "photos");
        assert_eq!(usage.largest[0].path, "photos/a.jpg");
        assert_eq!(usage.types[0].0, "jpg");
        let rows = compare_folders(&left, &right, true, false, &|_, _| {}, &|| false).unwrap();
        let states: Vec<(&str, &str)> = rows.iter().map(|r| (r.path.as_str(), r.state)).collect();
        assert_eq!(
            states,
            vec![
                ("notes.txt", "different"),
                ("only-left.txt", "left"),
                ("only-right.txt", "right"),
                ("photos/a.jpg", "same")
            ]
        );
        let sizes_only =
            compare_folders(&left, &right, false, false, &|_, _| {}, &|| false).unwrap();
        assert_eq!(
            sizes_only[0].state, "same",
            "same size counts as the same without checksums"
        );
        let _ = std::fs::remove_dir_all(&left);
        let _ = std::fs::remove_dir_all(&right);
    }
}
