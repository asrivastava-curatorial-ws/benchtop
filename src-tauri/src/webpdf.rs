//! Web pages and HTML documents to PDF with the browser engine already on the
//! computer.
//!
//! The first choice is a Chromium-family browser (Chrome, Edge, Chromium or
//! Brave; Edge comes with every copy of Windows), driven headless through its
//! DevTools protocol on a local WebSocket, which gives paper sizes, margins,
//! background printing and a document outline.  Without one, Linux prints with
//! the system web view (WebKitGTK) in a hidden window.  The browser runs with a
//! fresh, temporary profile, so no cookies or history are used or kept.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Response;
use tokio_tungstenite::tungstenite::Message;

/// Paper and print settings chosen in the app.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOptions {
    #[serde(default = "default_paper")]
    pub paper: String,
    #[serde(default)]
    pub landscape: bool,
    #[serde(default = "default_true")]
    pub background: bool,
    /// Extra time to wait after the page has loaded, for pages that keep drawing.
    #[serde(default)]
    pub wait_ms: u64,
}

fn default_paper() -> String {
    "A4".into()
}
fn default_true() -> bool {
    true
}

/// Width and height in inches.
pub fn paper_inches(name: &str) -> (f64, f64) {
    match name.to_ascii_lowercase().as_str() {
        "a3" => (11.693, 16.535),
        "a5" => (5.827, 8.268),
        "letter" => (8.5, 11.0),
        "legal" => (8.5, 14.0),
        "tabloid" => (11.0, 17.0),
        _ => (8.268, 11.693),
    }
}

/// The browser engine that will be used.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    /// "chromium", "webview" or "none".
    pub kind: &'static str,
    /// What to tell the person, such as "Microsoft Edge".
    pub name: String,
    pub path: Option<String>,
}

const NAMES: &[(&str, &str)] = &[
    ("msedge", "Microsoft Edge"),
    ("microsoft-edge", "Microsoft Edge"),
    ("Microsoft Edge", "Microsoft Edge"),
    ("chrome", "Google Chrome"),
    ("google-chrome", "Google Chrome"),
    ("Google Chrome", "Google Chrome"),
    ("chromium", "Chromium"),
    ("Chromium", "Chromium"),
    ("brave", "Brave"),
    ("Brave Browser", "Brave"),
];

fn browser_name(path: &Path) -> String {
    let file = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    NAMES
        .iter()
        .find(|(stem, _)| file.starts_with(stem))
        .map(|(_, name)| (*name).to_string())
        .unwrap_or_else(|| file.to_string())
}

/// Places where Chromium-family browsers are installed, most preferred first.
fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(path) = std::env::var_os("BENCHTOP_CHROME") {
        out.push(PathBuf::from(path));
    }
    #[cfg(target_os = "windows")]
    {
        let roots: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]
            .iter()
            .filter_map(|v| std::env::var_os(v).map(PathBuf::from))
            .collect();
        for rel in [
            r"Google\Chrome\Application\chrome.exe",
            r"Microsoft\Edge\Application\msedge.exe",
            r"BraveSoftware\Brave-Browser\Application\brave.exe",
            r"Chromium\Application\chrome.exe",
        ] {
            for root in &roots {
                out.push(root.join(rel));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().unwrap_or_default();
        for app in [
            "Google Chrome.app/Contents/MacOS/Google Chrome",
            "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "Chromium.app/Contents/MacOS/Chromium",
            "Brave Browser.app/Contents/MacOS/Brave Browser",
        ] {
            out.push(Path::new("/Applications").join(app));
            out.push(home.join("Applications").join(app));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for name in [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "microsoft-edge",
            "microsoft-edge-stable",
            "brave-browser",
        ] {
            if let Ok(path) = which::which(name) {
                out.push(path);
            }
        }
        out.push(PathBuf::from("/snap/bin/chromium"));
    }
    out
}

pub fn find_chromium() -> Option<PathBuf> {
    candidates().into_iter().find(|p| p.is_file())
}

pub fn engine_info() -> EngineInfo {
    let forced_webview = std::env::var("BENCHTOP_PDF_ENGINE").is_ok_and(|v| v == "webview");
    if !forced_webview {
        if let Some(path) = find_chromium() {
            return EngineInfo {
                kind: "chromium",
                name: browser_name(&path),
                path: Some(path.display().to_string()),
            };
        }
    }
    if cfg!(target_os = "linux") {
        EngineInfo {
            kind: "webview",
            name: "the system web view (WebKitGTK)".into(),
            path: None,
        }
    } else {
        EngineInfo {
            kind: "none",
            name: String::new(),
            path: None,
        }
    }
}

/* ------------------------------------------------------------ helpers -- */

fn unique() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{}-{nanos:x}", std::process::id())
}

/// A folder that is deleted when the value is dropped.
struct TempDir(PathBuf);

impl TempDir {
    fn new(prefix: &str) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", unique()));
        std::fs::create_dir_all(&path)
            .map_err(|e| format!("Could not make a temporary folder: {e}"))?;
        Ok(Self(path))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        // The browser may still be letting go of its profile; try a few times.
        for _ in 0..10 {
            if std::fs::remove_dir_all(&self.0).is_ok() || !self.0.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }
}

/// The address of the DevTools endpoint written by a browser started with
/// `--remote-debugging-port=0`: "port\n/devtools/browser/<id>".
pub fn parse_active_port(text: &str) -> Option<String> {
    let mut lines = text.lines();
    let port: u16 = lines.next()?.trim().parse().ok()?;
    let path = lines.next()?.trim();
    if port == 0 || !path.starts_with("/devtools/browser/") {
        return None;
    }
    Some(format!("ws://127.0.0.1:{port}{path}"))
}

/// Accepts only http and https addresses for pages to fetch.
pub fn check_url(raw: &str) -> Result<url::Url, String> {
    let trimmed = raw.trim();
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url =
        url::Url::parse(&with_scheme).map_err(|_| format!("“{trimmed}” is not a web address."))?;
    match url.scheme() {
        "http" | "https" if url.host_str().is_some_and(|h| !h.is_empty()) => Ok(url),
        _ => Err("Only http and https web addresses can be saved as PDF.".into()),
    }
}

/* ----------------------------------------------------- Chromium (CDP) -- */

struct Browser {
    child: Child,
}

impl Drop for Browser {
    fn drop(&mut self) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = self.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

struct Cdp {
    socket: Socket,
    next: u64,
    events: Vec<Value>,
}

impl Cdp {
    async fn send(
        &mut self,
        session: Option<&str>,
        method: &str,
        params: Value,
        limit: Duration,
    ) -> Result<Value, String> {
        self.next += 1;
        let id = self.next;
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            message["sessionId"] = json!(session);
        }
        self.socket
            .send(Message::Text(message.to_string().into()))
            .await
            .map_err(|e| format!("The browser stopped answering ({e})."))?;
        let deadline = Instant::now() + limit;
        loop {
            let value = self.read(deadline, method).await?;
            if value.get("id").and_then(Value::as_u64) == Some(id) {
                if let Some(error) = value.get("error") {
                    let text = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown error");
                    return Err(format!("The browser could not {method}: {text}"));
                }
                return Ok(value.get("result").cloned().unwrap_or(Value::Null));
            }
            if value.get("method").is_some() {
                self.events.push(value);
            }
        }
    }

    async fn read(&mut self, deadline: Instant, waiting_for: &str) -> Result<Value, String> {
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(format!("The page took too long ({waiting_for})."));
            }
            let frame = tokio::time::timeout(left, self.socket.next())
                .await
                .map_err(|_| format!("The page took too long ({waiting_for})."))?;
            match frame {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(value) = serde_json::from_str::<Value>(&text) {
                        return Ok(value);
                    }
                }
                Some(Ok(Message::Close(_))) | None => {
                    return Err("The browser closed unexpectedly.".into())
                }
                Some(Ok(_)) => {}
                Some(Err(e)) => return Err(format!("The browser connection failed: {e}")),
            }
        }
    }

    /// Waits for an event (already received or still to come) that `wanted` accepts.
    async fn event(
        &mut self,
        wanted: impl Fn(&Value) -> bool,
        limit: Duration,
        what: &str,
    ) -> Result<Value, String> {
        if let Some(i) = self.events.iter().position(&wanted) {
            return Ok(self.events.remove(i));
        }
        let deadline = Instant::now() + limit;
        loop {
            let value = self.read(deadline, what).await?;
            if wanted(&value) {
                return Ok(value);
            }
            if value.get("method").is_some() {
                self.events.push(value);
            }
        }
    }
}

const SCROLL_SCRIPT: &str = r#"(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = Math.max(400, Math.floor(innerHeight * 0.8));
  const end = Date.now() + 8000;
  for (let y = 0; y < document.documentElement.scrollHeight && Date.now() < end; y += step) {
    scrollTo(0, y);
    await pause(120);
  }
  scrollTo(0, 0);
  await pause(300);
  return document.title;
})()"#;

pub struct Rendered {
    pub pdf: Vec<u8>,
    pub title: String,
}

/// Loads `address` in a headless Chromium and prints it.  Local documents
/// (`offline`) run no scripts and may not reach the network.
async fn chromium_pdf(
    browser: &Path,
    address: &str,
    offline: bool,
    options: &PdfOptions,
) -> Result<Rendered, String> {
    let profile = TempDir::new("benchtop-pdf")?;
    let mut command = Command::new(browser);
    command
        .args([
            "--headless=new",
            "--remote-debugging-port=0",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-sync",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-gpu",
            "--hide-scrollbars",
            "--mute-audio",
            "--password-store=basic",
            "--use-mock-keychain",
        ])
        .arg(format!("--user-data-dir={}", profile.0.display()))
        .arg("about:blank")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child = command
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", browser_name(browser)))?;
    let mut process = Browser { child };

    // The browser writes its DevTools address into the profile once it is listening.
    let port_file = profile.0.join("DevToolsActivePort");
    let started = Instant::now();
    let endpoint = loop {
        if let Some(address) = std::fs::read_to_string(&port_file)
            .ok()
            .as_deref()
            .and_then(parse_active_port)
        {
            break address;
        }
        if let Ok(Some(status)) = process.child.try_wait() {
            return Err(format!(
                "{} stopped at once ({status}).",
                browser_name(browser)
            ));
        }
        if started.elapsed() > Duration::from_secs(25) {
            return Err(format!("{} did not start in time.", browser_name(browser)));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    let (socket, _) = tokio_tungstenite::connect_async(endpoint.as_str())
        .await
        .map_err(|e| format!("Could not talk to {}: {e}", browser_name(browser)))?;
    let mut cdp = Cdp {
        socket,
        next: 0,
        events: Vec::new(),
    };
    let quick = Duration::from_secs(15);

    let target = cdp
        .send(
            None,
            "Target.createTarget",
            json!({ "url": "about:blank" }),
            quick,
        )
        .await?;
    let target_id = target["targetId"]
        .as_str()
        .ok_or("The browser opened no page.")?
        .to_string();
    let attached = cdp
        .send(
            None,
            "Target.attachToTarget",
            json!({ "targetId": target_id, "flatten": true }),
            quick,
        )
        .await?;
    let session = attached["sessionId"]
        .as_str()
        .ok_or("The browser gave no session.")?
        .to_string();
    let s = Some(session.as_str());

    cdp.send(s, "Page.enable", json!({}), quick).await?;
    cdp.send(
        s,
        "Page.setLifecycleEventsEnabled",
        json!({ "enabled": true }),
        quick,
    )
    .await?;
    if offline {
        cdp.send(
            s,
            "Emulation.setScriptExecutionDisabled",
            json!({ "value": true }),
            quick,
        )
        .await?;
        cdp.send(s, "Network.enable", json!({}), quick).await?;
        cdp.send(
            s,
            "Network.setBlockedURLs",
            json!({ "urls": ["http://*", "https://*", "ws://*", "wss://*", "ftp://*"] }),
            quick,
        )
        .await?;
    }
    let navigation = cdp
        .send(
            s,
            "Page.navigate",
            json!({ "url": address }),
            Duration::from_secs(60),
        )
        .await?;
    if let Some(error) = navigation
        .get("errorText")
        .and_then(Value::as_str)
        .filter(|e| !e.is_empty())
    {
        return Err(match error {
            "net::ERR_NAME_NOT_RESOLVED" => {
                "That web address was not found (check the spelling and the internet connection)."
                    .into()
            }
            "net::ERR_INTERNET_DISCONNECTED" => {
                "This computer is not connected to the internet.".into()
            }
            "net::ERR_CONNECTION_REFUSED" | "net::ERR_CONNECTION_TIMED_OUT" => {
                "The website did not answer.".into()
            }
            other => format!("The page could not be opened ({other})."),
        });
    }
    let same_session =
        |v: &Value| v.get("sessionId").and_then(Value::as_str) == Some(session.as_str());
    cdp.event(
        |v| same_session(v) && v["method"] == "Page.loadEventFired",
        Duration::from_secs(if offline { 30 } else { 90 }),
        "loading the page",
    )
    .await?;

    let mut title = String::new();
    if !offline {
        // Scroll through the page so pictures that load on demand are fetched.
        if let Ok(result) = cdp
            .send(
                s,
                "Runtime.evaluate",
                json!({ "expression": SCROLL_SCRIPT, "awaitPromise": true, "returnByValue": true }),
                Duration::from_secs(20),
            )
            .await
        {
            title = result["result"]["value"]
                .as_str()
                .unwrap_or_default()
                .to_string();
        }
        let _ = cdp
            .event(
                |v| {
                    same_session(v)
                        && v["method"] == "Page.lifecycleEvent"
                        && v["params"]["name"] == "networkIdle"
                },
                Duration::from_secs(10),
                "waiting for the page to settle",
            )
            .await;
    } else {
        // Pictures in local documents are embedded; give them a moment to decode.
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    if options.wait_ms > 0 {
        tokio::time::sleep(Duration::from_millis(options.wait_ms.min(60_000))).await;
    }
    if title.is_empty() {
        if let Ok(result) = cdp
            .send(
                s,
                "Runtime.evaluate",
                json!({ "expression": "document.title", "returnByValue": true }),
                quick,
            )
            .await
        {
            title = result["result"]["value"]
                .as_str()
                .unwrap_or_default()
                .to_string();
        }
    }

    let (width, height) = paper_inches(&options.paper);
    let printed = cdp
        .send(
            s,
            "Page.printToPDF",
            json!({
                "paperWidth": width,
                "paperHeight": height,
                "landscape": options.landscape,
                "printBackground": options.background,
                "marginTop": 0.4,
                "marginBottom": 0.4,
                "marginLeft": 0.4,
                "marginRight": 0.4,
                "preferCSSPageSize": true,
                "generateDocumentOutline": true,
                "generateTaggedPDF": true,
            }),
            Duration::from_secs(120),
        )
        .await?;
    let data = printed["data"]
        .as_str()
        .ok_or("The browser returned no PDF.")?;
    let pdf = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("The PDF from the browser was damaged: {e}"))?;
    let _ = cdp
        .send(None, "Browser.close", json!({}), Duration::from_secs(5))
        .await;
    drop(process);
    Ok(Rendered { pdf, title })
}

/* ------------------------------------------------- WebKitGTK (Linux) -- */

#[cfg(target_os = "linux")]
async fn webview_pdf(
    app: &tauri::AppHandle,
    address: url::Url,
    offline: bool,
    options: &PdfOptions,
) -> Result<Rendered, String> {
    use std::sync::{Arc, Mutex};
    use tauri::webview::PageLoadEvent;
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let folder = TempDir::new("benchtop-print")?;
    let output = folder.0.join("page.pdf");
    let label = format!("pdf{}", unique().replace('-', ""));
    let (loaded_tx, loaded_rx) = tokio::sync::oneshot::channel::<String>();
    let loaded_tx = Arc::new(Mutex::new(Some(loaded_tx)));
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(address))
        .visible(false)
        .inner_size(1100.0, 1500.0)
        .on_page_load(move |window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let title = window.title().unwrap_or_default();
                if let Some(tx) = loaded_tx.lock().ok().and_then(|mut slot| slot.take()) {
                    let _ = tx.send(title);
                }
            }
        })
        .build()
        .map_err(|e| format!("Could not open the page: {e}"))?;
    let close = || {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.destroy();
        }
    };
    let title = match tokio::time::timeout(
        Duration::from_secs(if offline { 30 } else { 90 }),
        loaded_rx,
    )
    .await
    {
        Ok(Ok(title)) => title,
        _ => {
            close();
            return Err("The page took too long to load.".into());
        }
    };
    tokio::time::sleep(Duration::from_millis(
        if offline { 500 } else { 2500 } + options.wait_ms.min(60_000),
    ))
    .await;

    let (done_tx, done_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let done_tx = Arc::new(Mutex::new(Some(done_tx)));
    let uri = url::Url::from_file_path(&output)
        .map_err(|_| "Bad output path.")?
        .to_string();
    let (paper, landscape) = (options.paper.to_ascii_lowercase(), options.landscape);
    window
        .with_webview(move |platform| {
            use webkit2gtk::PrintOperationExt;
            let view = platform.inner();
            let operation = webkit2gtk::PrintOperation::new(&view);
            let settings = gtk::PrintSettings::new();
            settings.set_printer("Print to File");
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(&uri));
            let setup = gtk::PageSetup::new();
            let name = match paper.as_str() {
                "a3" => "iso_a3",
                "a5" => "iso_a5",
                "letter" => "na_letter",
                "legal" => "na_legal",
                "tabloid" => "na_ledger",
                _ => "iso_a4",
            };
            setup.set_paper_size(&gtk::PaperSize::new(Some(name)));
            setup.set_orientation(if landscape {
                gtk::PageOrientation::Landscape
            } else {
                gtk::PageOrientation::Portrait
            });
            operation.set_print_settings(&settings);
            operation.set_page_setup(&setup);
            let finished = done_tx.clone();
            operation.connect_finished(move |_| {
                if let Some(tx) = finished.lock().ok().and_then(|mut s| s.take()) {
                    let _ = tx.send(Ok(()));
                }
            });
            let failed = done_tx.clone();
            operation.connect_failed(move |_, error| {
                if let Some(tx) = failed.lock().ok().and_then(|mut s| s.take()) {
                    let _ = tx.send(Err(format!("Printing failed: {error}")));
                }
            });
            operation.print();
        })
        .map_err(|e| format!("Could not print the page: {e}"))?;
    let result = tokio::time::timeout(Duration::from_secs(120), done_rx).await;
    close();
    match result {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(message))) => return Err(message),
        _ => return Err("Printing took too long.".into()),
    }
    // The file is written as printing finishes; wait until it is complete.
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let bytes = std::fs::read(&output).unwrap_or_default();
        if bytes.len() > 8
            && bytes.starts_with(b"%PDF")
            && bytes.windows(5).rev().take(1024).any(|w| w == b"%%EOF")
        {
            return Ok(Rendered { pdf: bytes, title });
        }
        if Instant::now() > deadline {
            return Err("The printed PDF was not written.".into());
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

/* ------------------------------------------------------------ commands -- */

async fn render(
    app: &tauri::AppHandle,
    address: url::Url,
    offline: bool,
    options: &PdfOptions,
) -> Result<Rendered, String> {
    let engine = engine_info();
    match engine.kind {
        "chromium" => {
            let path = PathBuf::from(engine.path.unwrap_or_default());
            chromium_pdf(&path, address.as_str(), offline, options).await
        }
        #[cfg(target_os = "linux")]
        "webview" => webview_pdf(app, address, offline, options).await,
        _ => {
            let _ = app;
            Err("Saving web pages as PDF needs Google Chrome, Microsoft Edge, Chromium or Brave. Install one of them and try again.".into())
        }
    }
}

#[tauri::command]
pub fn pdf_engine() -> EngineInfo {
    engine_info()
}

/// A complete HTML document (scripts are not run, nothing is fetched) as PDF bytes.
#[tauri::command]
pub async fn html_to_pdf(
    app: tauri::AppHandle,
    html: String,
    paper: String,
    landscape: bool,
    background: bool,
) -> Result<Response, String> {
    let folder = TempDir::new("benchtop-html")?;
    let file = folder.0.join("document.html");
    std::fs::write(&file, html.as_bytes())
        .map_err(|e| format!("Could not write the document: {e}"))?;
    let address = url::Url::from_file_path(&file).map_err(|_| "Bad document path.")?;
    let options = PdfOptions {
        paper,
        landscape,
        background,
        wait_ms: 0,
    };
    let rendered = render(&app, address, true, &options).await?;
    Ok(Response::new(rendered.pdf))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebPdf {
    pub title: String,
    pub url: String,
    /// The PDF, Base64-encoded.
    pub pdf: String,
}

/// Fetches a web page with the installed browser and prints it to PDF.
#[tauri::command]
pub async fn url_to_pdf(
    app: tauri::AppHandle,
    url: String,
    options: PdfOptions,
) -> Result<WebPdf, String> {
    let address = check_url(&url)?;
    let rendered = render(&app, address.clone(), false, &options).await?;
    Ok(WebPdf {
        title: rendered.title,
        url: address.to_string(),
        pdf: base64::engine::general_purpose::STANDARD.encode(&rendered.pdf),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_devtools_address() {
        assert_eq!(
            parse_active_port("38421\n/devtools/browser/4f1c-aa\n").as_deref(),
            Some("ws://127.0.0.1:38421/devtools/browser/4f1c-aa")
        );
        assert_eq!(parse_active_port("0\n/devtools/browser/x"), None);
        assert_eq!(parse_active_port("38421\n/other"), None);
        assert_eq!(parse_active_port(""), None);
    }

    #[test]
    fn accepts_only_web_addresses() {
        assert_eq!(
            check_url("example.org/a b").unwrap().as_str(),
            "https://example.org/a%20b"
        );
        assert_eq!(
            check_url(" http://example.org ").unwrap().as_str(),
            "http://example.org/"
        );
        assert!(check_url("file:///etc/passwd").is_err());
        assert!(check_url("javascript:alert(1)").is_err());
        assert!(check_url("https://").is_err());
    }

    #[test]
    fn knows_paper_sizes() {
        assert_eq!(paper_inches("Letter"), (8.5, 11.0));
        assert_eq!(paper_inches("anything"), paper_inches("A4"));
        assert_eq!(
            browser_name(Path::new("/usr/bin/google-chrome-stable")),
            "Google Chrome"
        );
        assert_eq!(browser_name(Path::new(r"msedge.exe")), "Microsoft Edge");
    }

    /// Prints a small document with the installed browser (skipped when there is none).
    #[test]
    fn prints_html_with_an_installed_browser() {
        let Some(browser) = find_chromium() else {
            eprintln!("no Chromium browser installed; skipping");
            return;
        };
        let folder = TempDir::new("benchtop-test").unwrap();
        let file = folder.0.join("t.html");
        std::fs::write(&file, "<!DOCTYPE html><title>Test page</title><h1>Hello PDF</h1><script>document.title='scripted'</script><img src='https://example.org/x.png'>").unwrap();
        let address = url::Url::from_file_path(&file).unwrap();
        let options = PdfOptions {
            paper: "A4".into(),
            landscape: false,
            background: true,
            wait_ms: 0,
        };
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let rendered = runtime
            .block_on(chromium_pdf(&browser, address.as_str(), true, &options))
            .unwrap();
        assert!(rendered.pdf.starts_with(b"%PDF"));
        // Scripts are off for local documents.
        assert_eq!(rendered.title, "Test page");
    }
}
