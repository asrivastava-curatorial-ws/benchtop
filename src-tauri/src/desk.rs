//! Desktop extras, all off until the user turns them on: an icon in the
//! system tray (closing the window then keeps Benchtop running), a global
//! shortcut that brings up the quick launcher, and a clipboard history kept in
//! memory while the app runs.

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Entries kept, newest first.
pub const HISTORY_LIMIT: usize = 200;
/// Longer clipboard text is not kept (big pastes are rarely wanted again).
pub const ENTRY_LIMIT: usize = 100 * 1024;
const POLL: Duration = Duration::from_millis(700);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ClipEntry {
    pub text: String,
    /// When it was copied, in milliseconds since 1970.
    pub at: u64,
}

#[derive(Default)]
pub struct History {
    entries: VecDeque<ClipEntry>,
    last: Option<String>,
}

impl History {
    /// Records new clipboard text.  The same text again moves to the top
    /// instead of appearing twice; empty and oversized text is skipped.
    /// Returns whether anything changed.
    pub fn record(&mut self, text: &str, at: u64) -> bool {
        if self.last.as_deref() == Some(text) {
            return false;
        }
        self.last = Some(text.to_string());
        if text.trim().is_empty() || text.len() > ENTRY_LIMIT {
            return false;
        }
        self.entries.retain(|entry| entry.text != text);
        self.entries.push_front(ClipEntry {
            text: text.to_string(),
            at,
        });
        self.entries.truncate(HISTORY_LIMIT);
        true
    }

    pub fn list(&self) -> Vec<ClipEntry> {
        self.entries.iter().cloned().collect()
    }

    pub fn remove(&mut self, at: u64, text: &str) {
        self.entries
            .retain(|entry| !(entry.at == at && entry.text == text));
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

#[derive(Default)]
pub struct DeskState {
    tray: Mutex<Option<TrayIcon>>,
    shortcut: Mutex<Option<String>>,
    watching: Arc<AtomicBool>,
    watcher_started: AtomicBool,
    history: Arc<Mutex<History>>,
}

impl DeskState {
    /// While the tray icon is shown, closing the window only hides it.
    pub fn keeps_running(&self) -> bool {
        self.tray.lock().map(|tray| tray.is_some()).unwrap_or(false)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Brings the main window back, shown and focused.
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The quick launcher is the app's command palette, opened on the main window.
pub fn quick_launch<R: Runtime>(app: &AppHandle<R>) {
    show_main(app);
    let _ = app.emit_to("main", "benchtop://quick-launch", ());
}

/// Whether a tray icon can be shown.  On Linux the tray needs the
/// (Ayatana) AppIndicator library, which is loaded at run time; without it
/// tray-icon would abort, so it is looked for first.
pub fn tray_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        [
            "libayatana-appindicator3.so.1",
            "libayatana-appindicator3.so",
            "libappindicator3.so.1",
            "libappindicator3.so",
        ]
        .iter()
        .any(|name| unsafe { libloading::Library::new(name) }.is_ok())
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    let show = MenuItem::with_id(app, "show", "Show Benchtop", true, None::<&str>)?;
    let launcher = MenuItem::with_id(app, "launcher", "Quick launcher…", true, None::<&str>)?;
    let clipboard = MenuItem::with_id(app, "clipboard", "Clipboard history", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Benchtop", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &launcher, &clipboard, &separator, &quit])?;
    let mut builder = TrayIconBuilder::with_id("benchtop")
        .tooltip("Benchtop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "launcher" => quick_launch(app),
            "clipboard" => {
                show_main(app);
                let _ = app.emit_to("main", "benchtop://open-tool", "clipboard-history");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)
}

#[derive(Serialize)]
pub struct DeskInfo {
    pub tray_supported: bool,
    pub tray: bool,
    pub shortcut: Option<String>,
    pub watching: bool,
}

#[tauri::command]
pub fn desk_info(state: State<'_, DeskState>) -> DeskInfo {
    DeskInfo {
        tray_supported: tray_supported(),
        tray: state.keeps_running(),
        shortcut: state.shortcut.lock().ok().and_then(|s| s.clone()),
        watching: state.watching.load(Ordering::SeqCst),
    }
}

#[tauri::command]
pub fn desk_tray(app: AppHandle, state: State<'_, DeskState>, enabled: bool) -> Result<(), String> {
    let mut slot = state
        .tray
        .lock()
        .map_err(|_| "The tray is busy.".to_string())?;
    if !enabled {
        if let Some(tray) = slot.take() {
            let _ = tray.set_visible(false);
        }
        return Ok(());
    }
    if slot.is_some() {
        return Ok(());
    }
    if !tray_supported() {
        return Err("The tray icon needs the AppIndicator library: install libayatana-appindicator3-1 (Debian, Ubuntu) or libayatana-appindicator-gtk3 (Fedora).".into());
    }
    let tray =
        build_tray(&app).map_err(|error| format!("The tray icon could not be shown: {error}"))?;
    *slot = Some(tray);
    Ok(())
}

/// Registers the quick-launch shortcut (for example "Ctrl+Alt+Space"), or
/// removes it when `accelerator` is empty.
#[tauri::command]
pub fn desk_shortcut(
    app: AppHandle,
    state: State<'_, DeskState>,
    accelerator: String,
) -> Result<(), String> {
    let mut current = state
        .shortcut
        .lock()
        .map_err(|_| "The shortcut is busy.".to_string())?;
    let shortcuts = app.global_shortcut();
    if let Some(old) = current.take() {
        let _ = shortcuts.unregister(old.as_str());
    }
    let wanted = accelerator.trim();
    if wanted.is_empty() {
        return Ok(());
    }
    shortcuts
        .register(wanted)
        .map_err(|error| format!("{wanted} could not be used: {error}. Another program may own it, or the desktop (such as a Wayland session) may not allow global shortcuts."))?;
    *current = Some(wanted.to_string());
    Ok(())
}

/// Starts or pauses the clipboard history.  The watcher thread starts once and
/// then only reads the clipboard while the history is on.
#[tauri::command]
pub fn clip_watch(app: AppHandle, state: State<'_, DeskState>, enabled: bool) {
    state.watching.store(enabled, Ordering::SeqCst);
    if !enabled || state.watcher_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let watching = state.watching.clone();
    let history = state.history.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL);
        if !watching.load(Ordering::SeqCst) {
            continue;
        }
        let Ok(text) = app.clipboard().read_text() else {
            continue;
        };
        let changed = history
            .lock()
            .map(|mut h| h.record(&text, now_ms()))
            .unwrap_or(false);
        if changed {
            let _ = app.emit_to("main", "benchtop://clipboard", ());
        }
    });
}

#[tauri::command]
pub fn clip_list(state: State<'_, DeskState>) -> Vec<ClipEntry> {
    state.history.lock().map(|h| h.list()).unwrap_or_default()
}

#[tauri::command]
pub fn clip_remove(state: State<'_, DeskState>, at: u64, text: String) {
    if let Ok(mut history) = state.history.lock() {
        history.remove(at, &text);
    }
}

#[tauri::command]
pub fn clip_clear(state: State<'_, DeskState>) {
    if let Ok(mut history) = state.history.lock() {
        history.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_keeps_newest_first_without_repeats() {
        let mut h = History::default();
        assert!(h.record("one", 1));
        assert!(
            !h.record("one", 2),
            "the same clipboard read twice is not new"
        );
        assert!(h.record("two", 3));
        assert!(
            h.record("one", 4),
            "copying older text again moves it to the top"
        );
        let texts: Vec<_> = h.list().into_iter().map(|e| e.text).collect();
        assert_eq!(texts, ["one", "two"]);
        assert!(!h.record("   ", 5));
        assert!(!h.record(&"x".repeat(ENTRY_LIMIT + 1), 6));
        h.remove(3, "two");
        assert_eq!(h.list().len(), 1);
        h.clear();
        assert!(h.list().is_empty());
    }

    #[test]
    fn history_is_bounded() {
        let mut h = History::default();
        for i in 0..(HISTORY_LIMIT + 50) {
            h.record(&format!("entry {i}"), i as u64);
        }
        let list = h.list();
        assert_eq!(list.len(), HISTORY_LIMIT);
        assert_eq!(list[0].text, format!("entry {}", HISTORY_LIMIT + 49));
    }
}
