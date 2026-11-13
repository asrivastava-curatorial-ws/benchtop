//! Benchtop's desktop shell.
//!
//! Every tool runs inside the web view; this side only provides a native
//! window, the clipboard, a "Save as" dialog, and a guard that keeps the
//! window on the app's own pages.  Nothing here touches the network.

use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// Pages the main window may show.  Anything else (a link, a stray redirect)
/// is refused, so the app can never turn into a general web browser.
fn is_allowed(url: &Url) -> bool {
    match url.scheme() {
        // The bundled app on Linux and macOS, and blank or inline documents used by previews.
        "tauri" => url.host_str() == Some("localhost"),
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        // The bundled app on Windows is served from http://tauri.localhost.
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        // The Vite dev server, only in debug builds.
        "http" if cfg!(debug_assertions) => {
            matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"))
        }
        _ => false,
    }
}

/// Keeps only the final component of a suggested file name.
fn safe_file_name(raw: &str) -> String {
    // Split on both separators so a Windows path is handled on every platform.
    let last = raw.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = last
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.chars().take(200).collect()
    }
}

/// Shows a native "Save as" dialog and writes the bytes sent by the web view.
/// The body is the raw file content; the suggested name travels in a header.
/// Returns the chosen path, or `None` when the dialog was cancelled.
#[tauri::command]
async fn save_file(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("The file contents were not sent as raw bytes.".into());
    };
    let suggested = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .map(|value| percent_decode_str(value).decode_utf8_lossy().into_owned())
        .unwrap_or_default();
    let name = safe_file_name(&suggested);
    let bytes = bytes.clone();

    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some(extension) = Path::new(&name).extension().and_then(|ext| ext.to_str()) {
        dialog = dialog.add_filter(extension.to_uppercase(), &[extension]);
    }
    if let Ok(downloads) = app.path().download_dir() {
        dialog = dialog.set_directory(downloads);
    }
    // The blocking variant is fine here: async commands run off the main thread.
    let Some(choice) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path: PathBuf = choice
        .into_path()
        .map_err(|error| format!("That location cannot be used: {error}"))?;
    std::fs::write(&path, &bytes)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Benchtop")
                .inner_size(1360.0, 860.0)
                .min_inner_size(900.0, 600.0)
                .center()
                // Files dropped on the window go to the page (drop zones, editors), not to the shell.
                .disable_drag_drop_handler()
                .zoom_hotkeys_enabled(true)
                .on_navigation(is_allowed)
                .on_page_load(|window, payload| {
                    if payload.event() == PageLoadEvent::Finished && !is_allowed(payload.url()) {
                        let _ = window.eval("location.replace('index.html')");
                    }
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Benchtop could not start");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).expect("valid test URL")
    }

    #[test]
    fn allows_only_the_app_itself() {
        assert!(is_allowed(&url(
            "tauri://localhost/index.html#/tool/json-formatter"
        )));
        assert!(is_allowed(&url("http://tauri.localhost/index.html")));
        assert!(is_allowed(&url("about:srcdoc")));
        assert!(is_allowed(&url("about:blank")));
        assert!(!is_allowed(&url("https://example.org/")));
        assert!(!is_allowed(&url("tauri://evil.example/")));
        assert!(!is_allowed(&url("file:///etc/passwd")));
        assert!(!is_allowed(&url("data:text/html,hi")));
        assert!(!is_allowed(&url("javascript:alert(1)")));
    }

    #[test]
    fn suggested_names_cannot_escape_the_chosen_folder() {
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("C:\\Windows\\evil.dll"), "evil.dll");
        assert_eq!(safe_file_name("photo.png"), "photo.png");
        assert_eq!(safe_file_name(""), "download");
        assert_eq!(safe_file_name("..."), "download");
        assert_eq!(safe_file_name("a\u{0}b.txt"), "ab.txt");
    }
}
