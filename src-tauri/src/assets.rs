//! Asset Finder's desktop side: the library folder downloads go to, the
//! libraries' API keys, and the downloads themselves, streamed to disk,
//! resumed after an interruption, checked against the library's checksum and
//! unpacked when they are ZIP files.
//!
//! The page decides what to fetch (the connectors run there, in sandboxed
//! workers); this side writes only inside the library folder the user chose,
//! under names it cleans itself, and only fetches https addresses (plain http
//! only from this computer, for tests).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::io::AsyncWriteExt;

/// Downloads in progress, by the id the page gave them, so they can be stopped.
#[derive(Default)]
pub struct AssetState {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

const SETTINGS_FILE: &str = "asset-finder.json";
const KEYS_FILE: &str = "asset-keys.json";
/// Largest download (100 GB) and largest unpacked ZIP (50 GB, 200,000 entries).
const MAX_DOWNLOAD: u64 = 100 << 30;
const MAX_UNPACKED: u64 = 50 << 30;
const MAX_ENTRIES: usize = 200_000;

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No settings folder: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    Ok(dir)
}

fn read_json(path: &Path) -> Map<String, Value> {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

/// Writes a file whole (through a temporary file), readable only by this account on Unix.
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&tmp)
            .map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
        file.write_all(bytes)
            .map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

fn library_root(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = read_json(&config_dir(app)?.join(SETTINGS_FILE));
    let path = settings
        .get("library")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .ok_or("Choose a library folder first (Asset Finder › Library folder).")?;
    Ok(path)
}

/// One folder or file name, made safe on every system: no separators, no
/// reserved characters or names, no leading or trailing dots or spaces, at most 120 characters.
pub(crate) fn safe_segment(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let mut name = cleaned
        .trim_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();
    if name.chars().count() > 120 {
        name = name
            .chars()
            .take(120)
            .collect::<String>()
            .trim_end()
            .to_string();
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        name.push('_');
    }
    if name.is_empty() {
        "_".into()
    } else {
        name
    }
}

/// The folder for an asset inside the library, from the page's (cleaned) folder names.
fn asset_dir(root: &Path, dir: &[String]) -> Result<PathBuf, String> {
    if dir.is_empty() || dir.len() > 6 {
        return Err("An asset needs a folder of one to six levels.".into());
    }
    let mut path = root.to_path_buf();
    for part in dir {
        path.push(safe_segment(part));
    }
    Ok(path)
}

#[tauri::command]
pub fn asset_library(app: AppHandle) -> Option<String> {
    library_root(&app)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Asks for the library folder and remembers it.
#[tauri::command]
pub async fn asset_pick_library(app: AppHandle) -> Result<Option<String>, String> {
    // The desktop tests cannot answer the folder dialog; they name the folder in the environment.
    let picked = if let Some(path) = std::env::var_os("BENCHTOP_TEST_FOLDER")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
    {
        path
    } else {
        let Some(folder) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        folder.into_path().map_err(|e| e.to_string())?
    };
    let file = config_dir(&app)?.join(SETTINGS_FILE);
    let mut settings = read_json(&file);
    settings.insert(
        "library".into(),
        Value::String(picked.to_string_lossy().into_owned()),
    );
    write_private(
        &file,
        &serde_json::to_vec_pretty(&Value::Object(settings)).unwrap_or_default(),
    )?;
    Ok(Some(picked.to_string_lossy().into_owned()))
}

/// The libraries' keys: { library id: { key name: value } }.
#[tauri::command]
pub fn asset_keys(app: AppHandle) -> Result<Value, String> {
    Ok(Value::Object(read_json(&config_dir(&app)?.join(KEYS_FILE))))
}

/// Saves one key (an empty value removes it).  The file is readable only by this account.
#[tauri::command]
pub fn asset_set_key(
    app: AppHandle,
    source: String,
    name: String,
    value: String,
) -> Result<(), String> {
    if source.is_empty() || name.is_empty() || source.len() > 80 || name.len() > 80 {
        return Err("A key needs a library and a name.".into());
    }
    let file = config_dir(&app)?.join(KEYS_FILE);
    let mut keys = read_json(&file);
    let entry = keys
        .entry(source.clone())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Value::Object(map) = entry {
        if value.trim().is_empty() {
            map.remove(&name);
        } else {
            map.insert(name, Value::String(value.trim().to_string()));
        }
        if map.is_empty() {
            keys.remove(&source);
        }
    }
    write_private(
        &file,
        &serde_json::to_vec_pretty(&Value::Object(keys)).unwrap_or_default(),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub id: String,
    pub url: String,
    /// Folders inside the library, outermost first (cleaned here).
    pub dir: Vec<String>,
    pub name: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub md5: Option<String>,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    /// Unpack a ZIP into a folder beside it.
    #[serde(default)]
    pub unzip: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub received: u64,
    pub total: Option<u64>,
    /// "downloading", "checking" or "unpacking".
    pub phase: &'static str,
}

fn allowed_url(raw: &str) -> Result<reqwest::Url, String> {
    let url =
        reqwest::Url::parse(raw.trim()).map_err(|_| "That is not a web address.".to_string())?;
    let loopback = matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
    );
    match url.scheme() {
        "https" => Ok(url),
        "http" if loopback => Ok(url),
        _ => Err("Only https addresses are downloaded.".into()),
    }
}

fn client() -> Result<reqwest::Client, String> {
    crate::net::ensure_crypto_provider();
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(90))
        .user_agent(concat!(
            "Benchtop/",
            env!("CARGO_PKG_VERSION"),
            " (Asset Finder; +https://github.com/asrivastava-curatorial-ws/benchtop)"
        ))
        .build()
        .map_err(|e| crate::net::chain_message(&e))
}

/// Hex digest of a file with the hash `D`.
fn file_digest<D: Digest>(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = D::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// Checks the file against the strongest checksum the library gave; returns which one matched.
fn verify(path: &Path, request: &DownloadRequest) -> Result<Option<&'static str>, String> {
    let want = |v: &Option<String>| {
        v.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_ascii_lowercase)
    };
    let (name, expected, actual) = if let Some(expected) = want(&request.sha256) {
        ("SHA-256", expected, file_digest::<Sha256>(path)?)
    } else if let Some(expected) = want(&request.sha1) {
        ("SHA-1", expected, file_digest::<Sha1>(path)?)
    } else if let Some(expected) = want(&request.md5) {
        ("MD5", expected, file_digest::<md5::Md5>(path)?)
    } else {
        return Ok(None);
    };
    if actual != expected {
        return Err(format!(
            "The file does not match the library's {name} checksum (expected {expected}, got {actual}); it was deleted. Try again."
        ));
    }
    Ok(Some(name))
}

/// Unpacks a ZIP into `into`, keeping only names that stay inside it.
fn unzip(path: &Path, into: &Path, cancel: &AtomicBool) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Not a ZIP file: {e}"))?;
    if archive.len() > MAX_ENTRIES {
        return Err(format!(
            "The ZIP has {} entries; at most {MAX_ENTRIES} are unpacked.",
            archive.len()
        ));
    }
    let mut total = 0u64;
    let mut written = Vec::new();
    for i in 0..archive.len() {
        if cancel.load(Ordering::Relaxed) {
            return Err("Stopped.".into());
        }
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        let target = relative
            .components()
            .filter_map(|c| match c {
                std::path::Component::Normal(part) => Some(safe_segment(&part.to_string_lossy())),
                _ => None,
            })
            .fold(into.to_path_buf(), |acc, part| acc.join(part));
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        total = total.saturating_add(entry.size());
        if total > MAX_UNPACKED {
            return Err("The ZIP unpacks to more than 50 GB; it was left packed.".into());
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = std::fs::File::create(&target).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry.by_ref().take(MAX_UNPACKED), &mut out)
            .map_err(|e| e.to_string())?;
        written.push(
            target
                .strip_prefix(into)
                .unwrap_or(&target)
                .to_string_lossy()
                .replace('\\', "/"),
        );
    }
    Ok(written)
}

/// Downloads into `root`/`dir`/`name`, resuming a `.part` file left by an earlier attempt.
pub async fn download_to(
    root: &Path,
    request: &DownloadRequest,
    cancel: &AtomicBool,
    progress: &(dyn Fn(Progress) + Send + Sync),
) -> Result<Value, String> {
    let url = allowed_url(&request.url)?;
    let dir = asset_dir(root, &request.dir)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    let name = safe_segment(&request.name);
    let part = dir.join(format!("{name}.part"));
    let client = client()?;
    let mut have = tokio::fs::metadata(&part)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    let mut attempt = 0;
    let (mut response, resumed) = loop {
        attempt += 1;
        let mut builder = client.get(url.clone());
        for (header, value) in &request.headers {
            builder = builder.header(header.as_str(), value.as_str());
        }
        if have > 0 {
            builder = builder.header("Range", format!("bytes={have}-"));
        }
        let response = builder
            .send()
            .await
            .map_err(|e| crate::net::chain_message(&e))?;
        let status = response.status().as_u16();
        if status == 416 && attempt == 1 {
            // The part file is no use (the file changed, or it is already whole): start again.
            let _ = tokio::fs::remove_file(&part).await;
            have = 0;
            continue;
        }
        if !(200..300).contains(&status) {
            return Err(format!(
                "The library answered {status} for {}.",
                url.host_str().unwrap_or("the file")
            ));
        }
        let resumed = status == 206 && have > 0;
        if !resumed {
            have = 0;
        }
        break (response, resumed);
    };
    let total = response.content_length().map(|n| n + have).or(request.size);
    if total.is_some_and(|t| t > MAX_DOWNLOAD) {
        return Err("The file is larger than 100 GB.".into());
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(&part)
        .await
        .map_err(|e| format!("Could not write {}: {e}", part.display()))?;
    let mut received = have;
    let mut last = Instant::now();
    progress(Progress {
        received,
        total,
        phase: "downloading",
    });
    loop {
        if cancel.load(Ordering::Relaxed) {
            file.flush().await.ok();
            return Err("Stopped. Download it again to carry on from where it stopped.".into());
        }
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(e) => {
                file.flush().await.ok();
                return Err(format!(
                    "The download broke off ({}). Download it again to carry on.",
                    crate::net::chain_message(&e)
                ));
            }
        };
        received += chunk.len() as u64;
        if received > MAX_DOWNLOAD {
            return Err("The file is larger than 100 GB.".into());
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Could not write {}: {e}", part.display()))?;
        if last.elapsed() > Duration::from_millis(150) {
            last = Instant::now();
            progress(Progress {
                received,
                total,
                phase: "downloading",
            });
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    if let Some(expected) = total.filter(|_| response.content_length().is_some()) {
        if received != expected {
            return Err(format!("The download ended early ({received} of {expected} bytes). Download it again to carry on."));
        }
    }
    progress(Progress {
        received,
        total: Some(received),
        phase: "checking",
    });
    let checked = match verify(&part, request) {
        Ok(checked) => checked,
        Err(message) => {
            let _ = std::fs::remove_file(&part);
            return Err(message);
        }
    };
    let target = crate::convert::unique(dir.join(&name));
    std::fs::rename(&part, &target)
        .map_err(|e| format!("Could not name {}: {e}", target.display()))?;
    let mut unpacked = Vec::new();
    let is_zip = std::fs::File::open(&target)
        .ok()
        .and_then(|mut f| {
            let mut magic = [0u8; 4];
            f.read_exact(&mut magic)
                .ok()
                .map(|_| magic == *b"PK\x03\x04")
        })
        .unwrap_or(false);
    if request.unzip && is_zip {
        progress(Progress {
            received,
            total: Some(received),
            phase: "unpacking",
        });
        let stem = target
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unpacked")
            .to_string();
        let into = crate::convert::unique(dir.join(safe_segment(&stem)));
        unpacked = unzip(&target, &into, cancel)?;
    }
    Ok(json!({
        "path": target.to_string_lossy(),
        "name": target.file_name().map(|n| n.to_string_lossy().into_owned()),
        "size": received,
        "resumed": resumed,
        "verified": checked,
        "unpacked": unpacked,
    }))
}

#[tauri::command]
pub async fn asset_download(
    app: AppHandle,
    state: State<'_, AssetState>,
    request: DownloadRequest,
    on_progress: Channel<Progress>,
) -> Result<Value, String> {
    let root = library_root(&app)?;
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request.id.clone(), cancel.clone());
    let report = move |p: Progress| {
        let _ = on_progress.send(p);
    };
    let result = download_to(&root, &request, &cancel, &report).await;
    state
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&request.id);
    result
}

#[tauri::command]
pub fn asset_cancel(state: State<'_, AssetState>, id: String) {
    if let Ok(running) = state.running.lock() {
        if let Some(flag) = running.get(&id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// Writes a small file (the asset's record, its licence text, a thumbnail) into an asset's folder.
#[tauri::command]
pub fn asset_write(
    app: AppHandle,
    dir: Vec<String>,
    name: String,
    text: Option<String>,
    base64: Option<String>,
) -> Result<String, String> {
    let folder = asset_dir(&library_root(&app)?, &dir)?;
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("Could not make {}: {e}", folder.display()))?;
    let bytes = match (text, base64) {
        (Some(text), _) => text.into_bytes(),
        (None, Some(encoded)) => B64
            .decode(encoded.trim())
            .map_err(|_| "The file is not valid Base64.".to_string())?,
        _ => return Err("Nothing to write.".into()),
    };
    if bytes.len() > 32 << 20 {
        return Err("Records and pictures written this way are at most 32 MB.".into());
    }
    let path = folder.join(safe_segment(&name));
    std::fs::write(&path, bytes).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Reads a small file written into an asset's folder before (its record), if it is there.
#[tauri::command]
pub fn asset_read(
    app: AppHandle,
    dir: Vec<String>,
    name: String,
) -> Result<Option<String>, String> {
    let path = asset_dir(&library_root(&app)?, &dir)?.join(safe_segment(&name));
    match std::fs::metadata(&path) {
        Ok(meta) if meta.len() > 2 << 20 => Err("That record is larger than 2 MB.".into()),
        Ok(_) => std::fs::read_to_string(&path)
            .map(Some)
            .map_err(|e| format!("Could not read {}: {e}", path.display())),
        Err(_) => Ok(None),
    }
}

/// Opens an asset's folder (or the library) in the file manager.
#[tauri::command]
pub fn asset_reveal(app: AppHandle, dir: Vec<String>) -> Result<(), String> {
    let root = library_root(&app)?;
    let folder = if dir.is_empty() {
        root
    } else {
        asset_dir(&root, &dir)?
    };
    if !folder.exists() {
        return Err("That folder is not there any more.".into());
    }
    // reveal_path opens the parent on Linux, so point at a file inside.
    let inside = std::fs::read_dir(&folder)
        .ok()
        .and_then(|mut entries| entries.next())
        .and_then(Result::ok)
        .map(|e| e.path())
        .unwrap_or(folder);
    crate::convert::reveal_path(&inside)
}

/// Every asset record (asset.json) in the library, newest first, with its folder.
#[tauri::command]
pub fn asset_records(app: AppHandle) -> Result<Vec<Value>, String> {
    let root = library_root(&app)?;
    Ok(records_under(&root))
}

pub(crate) fn records_under(root: &Path) -> Vec<Value> {
    let mut found = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if depth < 6 {
                    stack.push((path, depth + 1));
                }
            } else if path.file_name().is_some_and(|n| n == "asset.json") && found.len() < 5000 {
                let Ok(bytes) = std::fs::read(&path) else {
                    continue;
                };
                let Ok(mut record) = serde_json::from_slice::<Value>(&bytes) else {
                    continue;
                };
                let folder: Vec<String> = path
                    .parent()
                    .and_then(|p| p.strip_prefix(root).ok())
                    .map(|p| {
                        p.components()
                            .map(|c| c.as_os_str().to_string_lossy().into_owned())
                            .collect()
                    })
                    .unwrap_or_default();
                let modified = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                if let Value::Object(map) = &mut record {
                    map.insert("_folder".into(), json!(folder));
                    map.insert("_saved".into(), json!(modified));
                    found.push(record);
                }
            }
        }
    }
    found.sort_by_key(|r| std::cmp::Reverse(r.get("_saved").and_then(Value::as_u64).unwrap_or(0)));
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpListener;

    fn request(url: String, sha256: Option<String>) -> DownloadRequest {
        DownloadRequest {
            id: "t".into(),
            url,
            dir: vec![
                "image".into(),
                "Test library".into(),
                "A: title/with \\ odd <chars>".into(),
            ],
            name: "file?.bin".into(),
            headers: vec![("Authorization".into(), "Token abc".into())],
            size: None,
            md5: None,
            sha1: None,
            sha256,
            unzip: false,
        }
    }

    /// Serves `body` once per connection, honouring a Range header; returns the requests seen.
    async fn serve(
        body: Vec<u8>,
        connections: usize,
    ) -> (u16, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let task = tokio::spawn(async move {
            let mut seen = Vec::new();
            for _ in 0..connections {
                let (mut socket, _) = listener.accept().await.expect("accept");
                let mut buf = vec![0u8; 4096];
                let n = socket.read(&mut buf).await.expect("read");
                let head = String::from_utf8_lossy(&buf[..n]).to_string();
                let start = head.lines().find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("range: bytes=")
                        .map(|r| r.trim_end_matches('-').parse::<usize>().unwrap_or(0))
                });
                let reply = match start {
                    Some(from) => {
                        let rest = &body[from..];
                        let mut r = format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {from}-{}/{}\r\n\r\n", rest.len(), body.len() - 1, body.len()).into_bytes();
                        r.extend_from_slice(rest);
                        r
                    }
                    None => {
                        let mut r =
                            format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", body.len())
                                .into_bytes();
                        r.extend_from_slice(&body);
                        r
                    }
                };
                socket.write_all(&reply).await.expect("write");
                seen.push(head);
            }
            seen
        });
        (port, task)
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    #[test]
    fn names_are_cleaned_for_every_system() {
        assert_eq!(
            safe_segment("A: title/with \\ odd <chars>"),
            "A_ title_with _ odd _chars_"
        );
        assert_eq!(safe_segment(" ..hidden.. "), "hidden");
        assert_eq!(safe_segment(".."), "_");
        assert_eq!(safe_segment("con.txt"), "con.txt_");
        assert_eq!(safe_segment("COM1"), "COM1_");
        assert_eq!(safe_segment(&"x".repeat(300)).len(), 120);
        assert!(asset_dir(Path::new("/lib"), &[]).is_err());
        assert_eq!(
            asset_dir(Path::new("/lib"), &["a".into(), "..".into()]).unwrap(),
            Path::new("/lib/a/_")
        );
    }

    #[test]
    fn only_https_is_fetched_except_from_this_computer() {
        assert!(allowed_url("https://example.org/a.jpg").is_ok());
        assert!(allowed_url("http://example.org/a.jpg").is_err());
        assert!(allowed_url("http://127.0.0.1:8080/a.jpg").is_ok());
        assert!(allowed_url("file:///etc/passwd").is_err());
    }

    #[tokio::test]
    async fn downloads_resumes_and_checks_the_checksum() {
        let body: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let root = std::env::temp_dir().join(format!("benchtop-assets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        // A first attempt that stopped half-way left a part file.
        let dir = asset_dir(&root, &request(String::new(), None).dir).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("file_.bin.part"), &body[..80_000]).unwrap();
        let (port, server) = serve(body.clone(), 1).await;
        let req = request(
            format!("http://127.0.0.1:{port}/f"),
            Some(sha256_hex(&body)),
        );
        let cancel = AtomicBool::new(false);
        let steps = Mutex::new(Vec::new());
        let report = |p: Progress| steps.lock().unwrap().push(p.phase);
        let result = download_to(&root, &req, &cancel, &report)
            .await
            .expect("download");
        let seen = server.await.unwrap();
        assert!(
            seen[0].to_ascii_lowercase().contains("range: bytes=80000-"),
            "{}",
            seen[0]
        );
        assert!(
            seen[0]
                .to_ascii_lowercase()
                .contains("authorization: token abc"),
            "{}",
            seen[0]
        );
        assert_eq!(result["resumed"], true);
        assert_eq!(result["verified"], "SHA-256");
        assert_eq!(std::fs::read(dir.join("file_.bin")).unwrap(), body);
        assert!(!dir.join("file_.bin.part").exists());
        assert!(steps.lock().unwrap().contains(&"checking"));

        // A checksum that does not match deletes the file.
        let (port, server) = serve(body.clone(), 1).await;
        let bad = request(format!("http://127.0.0.1:{port}/f"), Some("00".repeat(32)));
        let error = download_to(&root, &bad, &cancel, &report)
            .await
            .unwrap_err();
        server.await.unwrap();
        assert!(error.contains("SHA-256"), "{error}");
        assert!(!dir.join("file_.bin.part").exists());
        assert!(!dir.join("file_ (2).bin").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn unpacks_zips_and_lists_records() {
        let mut zipped = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut zipped));
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file("model/scene.gltf", options).unwrap();
            writer.write_all(b"{}").unwrap();
            writer.start_file("../escape.txt", options).unwrap();
            writer.write_all(b"no").unwrap();
            writer.finish().unwrap();
        }
        let root = std::env::temp_dir().join(format!("benchtop-assets-zip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let (port, server) = serve(zipped.clone(), 1).await;
        let mut req = request(format!("http://127.0.0.1:{port}/m.zip"), None);
        req.name = "model.zip".into();
        req.unzip = true;
        let result = download_to(&root, &req, &AtomicBool::new(false), &|_| {})
            .await
            .expect("download");
        server.await.unwrap();
        assert_eq!(result["unpacked"], json!(["model/scene.gltf"]));
        let dir = asset_dir(&root, &req.dir).unwrap();
        assert!(dir.join("model").join("model").join("scene.gltf").exists());
        assert!(!root.join("escape.txt").exists());
        std::fs::write(dir.join("asset.json"), br#"{"title":"Lamp"}"#).unwrap();
        let records = records_under(&root);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0]["title"], "Lamp");
        assert_eq!(
            records[0]["_folder"],
            json!(["image", "Test library", "A_ title_with _ odd _chars_"])
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
