//! Files chosen in the native "Open" dialog for tools that work on paths
//! (transcription of long recordings, the file converter).  The web view only
//! ever sees an opaque token, so a script in the page cannot point the shell
//! at an arbitrary file.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct PickedFiles(Mutex<HashMap<String, PathBuf>>);

static COUNTER: AtomicU64 = AtomicU64::new(0);

impl PickedFiles {
    pub fn register(&self, path: PathBuf) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let mut hasher = Sha256::new();
        hasher.update(nanos.to_le_bytes());
        hasher.update(COUNTER.fetch_add(1, Ordering::SeqCst).to_le_bytes());
        hasher.update(std::process::id().to_le_bytes());
        hasher.update(path.to_string_lossy().as_bytes());
        let token: String = hasher
            .finalize()
            .iter()
            .take(16)
            .map(|b| format!("{b:02x}"))
            .collect();
        self.0
            .lock()
            .expect("picked files")
            .insert(token.clone(), path);
        token
    }

    pub fn path(&self, token: &str) -> Option<PathBuf> {
        self.0.lock().expect("picked files").get(token).cloned()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub token: String,
    pub name: String,
    pub size: u64,
    pub folder: String,
}

#[derive(Debug, Deserialize)]
pub struct Filter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// Opens the system "Open" dialog; returns the chosen files as tokens.
#[tauri::command]
pub async fn pick_paths(
    app: AppHandle,
    multiple: bool,
    filters: Vec<Filter>,
    picked: State<'_, PickedFiles>,
) -> Result<Vec<PickedFile>, String> {
    let mut dialog = app.dialog().file();
    for filter in &filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }
    let paths: Vec<PathBuf> = if multiple {
        dialog
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .collect()
    } else {
        dialog
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
            .into_iter()
            .collect()
    };
    let _ = app.state::<PickedFiles>();
    Ok(paths
        .into_iter()
        .filter(|path| path.is_file())
        .map(|path| PickedFile {
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            size: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
            folder: path
                .parent()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
            token: picked.register(path),
        })
        .collect())
}

/// Where files dropped on the window are copied so path-based tools can read them:
/// inside the user's own cache folder rather than a shared temporary folder, so
/// other accounts on the computer cannot read the copies.
pub fn staging_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("app.benchtop.desktop")
        .join("dropped")
}

/// Creates `folder` (and its parents) readable by this user only, where the system has such permissions.
fn create_private_dir(folder: &std::path::Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(folder)
}

/// Whether `path` is a staged copy (results then go to the Downloads folder, not beside it).
pub fn is_staged(path: &std::path::Path) -> bool {
    path.starts_with(staging_dir())
}

/// A file name safe to create: no folders, no reserved characters, never empty.
fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "dropped-file".into()
    } else {
        trimmed.chars().take(180).collect()
    }
}

/// Removes staged copies older than a day.
fn prune_staging() {
    let Ok(entries) = std::fs::read_dir(staging_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age.as_secs() > 86_400);
        if old {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Copies a file dropped on the window (its bytes are the request body; its name is
/// the x-file-name header, URI-encoded) to the staging folder and returns it as a token.
#[tauri::command]
pub fn stage_file(
    request: tauri::ipc::Request<'_>,
    picked: State<'_, PickedFiles>,
) -> Result<PickedFile, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The file did not arrive.".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    prune_staging();
    let folder = staging_dir().join(format!(
        "{:x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default()
            ^ u128::from(COUNTER.fetch_add(1, Ordering::SeqCst))
    ));
    create_private_dir(&folder).map_err(|e| format!("Could not prepare the file: {e}"))?;
    let path = folder.join(safe_name(&name));
    std::fs::write(&path, bytes).map_err(|e| format!("Could not prepare the file: {e}"))?;
    Ok(PickedFile {
        name: safe_name(&name),
        size: bytes.len() as u64,
        folder: dirs::download_dir()
            .map(|d| d.display().to_string())
            .unwrap_or_default(),
        token: picked.register(path),
    })
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(b) = u8::from_str_radix(hex, 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_names_are_safe() {
        assert_eq!(safe_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_name("C:\\Users\\a\\clip.mp4"), "clip.mp4");
        assert_eq!(safe_name("a<b>:c?.srt"), "a_b__c_.srt");
        assert_eq!(safe_name(".."), "dropped-file");
        assert_eq!(percent_decode("caf%C3%A9%20clip.mp4"), "café clip.mp4");
        assert!(is_staged(&staging_dir().join("x").join("y.mp4")));
        assert!(!is_staged(std::path::Path::new("/home/me/y.mp4")));
    }

    #[cfg(unix)]
    #[test]
    fn staging_folders_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("benchtop-private-{}", std::process::id()));
        let folder = root.join("a").join("b");
        create_private_dir(&folder).unwrap();
        for dir in [&root, &root.join("a"), &folder] {
            assert_eq!(
                std::fs::metadata(dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn tokens_are_unique_and_resolve() {
        let picked = PickedFiles::default();
        let a = picked.register(PathBuf::from("/tmp/a.mp4"));
        let b = picked.register(PathBuf::from("/tmp/a.mp4"));
        assert_ne!(a, b);
        assert_eq!(a.len(), 32);
        assert_eq!(picked.path(&a), Some(PathBuf::from("/tmp/a.mp4")));
        assert_eq!(picked.path("nope"), None);
    }
}
