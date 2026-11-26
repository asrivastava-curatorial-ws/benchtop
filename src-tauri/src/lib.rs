//! Benchtop's desktop shell.
//!
//! Every tool runs inside the web view; this side only provides a native
//! window, the clipboard, a "Save as" dialog, a guard that keeps the window on
//! the app's own pages, and the network commands used by the "Online checks"
//! tools (see `net.rs`), the AI worker and model store (`ai/`), files chosen
//! in the native "Open" dialog (`files.rs`), and the converters that run
//! programs installed on the computer (`convert.rs`).  The web view itself
//! cannot reach the network.

mod ai;
mod arduino;
mod assets;
mod bulk;
mod cli;
mod coderun;
mod convert;
mod desk;
mod esp32;
mod files;
mod frames;
mod git;
mod grpc;
mod indic;
mod lan;
mod links;
mod mirror;
mod net;
mod quiz;
mod search;
mod serial;
mod serve;
mod webpdf;
mod wsclient;

/// Entry point for `benchtop --ai-worker` (see `ai/worker.rs`).
pub fn ai_worker_main() {
    ai::worker::main()
}

/// Whether the process arguments name a command-line command (see `cli.rs`).
pub fn wants_cli(args: &[String]) -> bool {
    cli::wanted(args)
}

/// Runs a command-line command and returns the exit code.
pub fn cli_main(args: Vec<String>) -> i32 {
    cli::main(args)
}

use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// Whether `route` (a "#/…" address inside the app) is safe to open the window on:
/// a page and an optional query of URL-safe characters.  It is written into a
/// script, so quotes, backslashes and anything else are refused.
pub(crate) fn safe_route(route: &str) -> bool {
    route.starts_with("#/")
        && route.len() <= 4096
        && route[2..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-/_?=&.~%+".contains(c))
}

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
    run_with(None)
}

/// Opens the window, on `route` (a `#/tool/<id>` hash) when one is given.
pub fn run_with(route: Option<String>) {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        desk::quick_launch(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            save_file,
            assets::asset_library,
            assets::asset_pick_library,
            assets::asset_keys,
            assets::asset_set_key,
            assets::asset_download,
            assets::asset_cancel,
            assets::asset_write,
            assets::asset_read,
            assets::asset_reveal,
            assets::asset_records,
            coderun::code_toolchains,
            coderun::code_version,
            coderun::code_run,
            net::net_http,
            net::net_tls,
            net::net_dns,
            net::net_whois,
            net::net_tcp_probe,
            files::pick_paths,
            files::stage_file,
            ai::ai_status,
            ai::ai_install,
            ai::ai_cancel_install,
            ai::ai_remove,
            ai::ai_import,
            ai::ai_run,
            ai::ai_cancel,
            convert::convert_programs,
            convert::convert_probe,
            convert::convert_media_info,
            convert::convert_frame,
            convert::convert_run,
            convert::convert_cancel,
            convert::convert_read,
            convert::convert_save,
            convert::convert_pick_folder,
            convert::convert_reveal,
            serial::serial_ports,
            serial::serial_open,
            serial::serial_write,
            serial::serial_signals,
            serial::serial_close,
            links::open_release_page,
            links::open_link,
            files::read_local_file,
            webpdf::pdf_engine,
            webpdf::html_to_pdf,
            webpdf::url_to_pdf,
            mirror::mirror_run,
            mirror::mirror_cancel,
            bulk::bulk_list,
            bulk::bulk_rename,
            bulk::bulk_duplicates,
            bulk::bulk_trash,
            bulk::bulk_usage,
            bulk::bulk_compare,
            bulk::bulk_copy,
            bulk::bulk_cancel,
            serve::serve_start,
            serve::serve_stop,
            wsclient::ws_connect,
            wsclient::ws_send,
            wsclient::ws_close,
            wsclient::sse_connect,
            wsclient::sse_close,
            grpc::grpc_compile,
            grpc::grpc_reflect,
            grpc::grpc_call,
            esp32::esp32_info,
            esp32::esp32_firmware,
            esp32::esp32_start,
            esp32::esp32_send,
            esp32::esp32_stop,
            esp32::esp32_forget,
            arduino::arduino_info,
            arduino::arduino_compile,
            arduino::arduino_boards,
            arduino::arduino_upload,
            lan::lan_info,
            lan::lan_scan,
            lan::lan_cancel,
            lan::lan_ports,
            lan::lan_wake,
            lan::lan_speed,
            desk::desk_info,
            desk::desk_tray,
            desk::desk_shortcut,
            desk::clip_watch,
            desk::clip_list,
            desk::clip_remove,
            desk::clip_clear,
            indic::indic_status,
            indic::indic_size,
            indic::indic_setup,
            indic::indic_cancel,
            indic::indic_start,
            indic::indic_stop,
            indic::indic_remove,
            search::search_status,
            search::search_add_root,
            search::search_update_root,
            search::search_remove_root,
            search::search_scan,
            search::search_cancel,
            search::search_pending,
            search::search_read,
            search::search_store,
            search::search_query,
            search::search_preview,
            search::search_reveal,
            search::search_clear,
            git::git_open,
            git::git_refs,
            git::git_log,
            git::git_commit,
            git::git_diff,
            git::git_compare,
            git::git_conflicts,
            git::git_conflict_sides,
            git::git_resolve,
            frames::frames_begin,
            frames::frames_add,
            frames::frames_audio,
            frames::frames_encode,
            frames::frames_cancel,
            frames::frames_end,
            quiz::quiz_start,
            quiz::quiz_publish,
            quiz::quiz_file,
            quiz::quiz_drop,
            quiz::quiz_stop
        ])
        .manage(files::PickedFiles::default())
        .manage(assets::AssetState::default())
        .manage(convert::ConvertState::default())
        .manage(serial::SerialState::default())
        .manage(mirror::MirrorState::default())
        .manage(bulk::BulkState::default())
        .manage(serve::ServeState::default())
        .manage(wsclient::WsState::default())
        .manage(grpc::GrpcState::default())
        .manage(lan::LanState::default())
        .manage(esp32::Esp32State::default())
        .manage(desk::DeskState::default())
        .manage(indic::IndicState::default())
        .manage(search::SearchState::default())
        .manage(frames::FrameState::default())
        .manage(quiz::QuizState::default())
        .on_window_event(|window, event| {
            // With the tray icon on, closing the window hides it; Quit is in the tray menu.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && window.state::<desk::DeskState>().keeps_running() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(move |app| {
            app.manage(ai::AiState::new(ai::models_root(app.handle())));
            let mut window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()));
            if let Some(route) = route.as_deref().filter(|route| safe_route(route)) {
                // `benchtop open <tool>`: start on that tool (the router reads the hash on load).
                window = window.initialization_script(format!(
                    "if (!location.hash || location.hash === '#/') location.hash = '{route}';"
                ));
            }
            window
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
        .build(tauri::generate_context!())
        .expect("Benchtop could not start")
        .run(|app, event| {
            // No translation server or setup outlives the app.
            if let tauri::RunEvent::Exit = event {
                indic::shutdown(app);
            }
        });
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
