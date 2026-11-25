//! The Live Quiz relay: a small HTTP server that phones on the local network
//! open to take part in a quiz the app is presenting.  It serves the
//! participant page (the app's own built files), takes what participants send
//! and passes it to the presenter's page, and hands each participant the view
//! the presenter's page last published for them.  It decides nothing itself:
//! the presenter's page keeps the quiz, its answers and its scores.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Incoming;
use hyper::header;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;

type Body = Full<Bytes>;

const MAX_GUESTS: usize = 400;
const MAX_MESSAGE: usize = 8 * 1024;
const MAX_FILES: usize = 400;
const MAX_FILE_BYTES: usize = 3 << 20;
/// How long a device's request for news is held open when there is none.
const POLL: Duration = Duration::from_secs(25);

struct Guest {
    secret: String,
    /// Messages this device may still send right now (refilled with time).
    tokens: f64,
    refilled: Instant,
}

#[derive(Default)]
struct Inner {
    guests: HashMap<String, Guest>,
    /// The view of each joined device, as the JSON the presenter's page made, with the
    /// version at which it last changed: a device is sent a view only when its own is new.
    views: HashMap<String, (u64, Arc<str>)>,
    /// The view for devices that have not joined.
    anyone: (u64, Arc<str>),
    files: HashMap<String, (String, Bytes)>,
    /// Joins per address in the current minute.
    joins: HashMap<IpAddr, (Instant, u32)>,
}

struct Relay {
    app: AppHandle,
    inner: Mutex<Inner>,
    version: watch::Sender<u64>,
}

struct Running {
    stop: watch::Sender<bool>,
    relay: Arc<Relay>,
}

#[derive(Default)]
pub struct QuizState {
    running: Mutex<Option<Running>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizStarted {
    port: u16,
    /// Addresses to open: this computer, then the local network.
    urls: Vec<String>,
}

fn random_hex(bytes: usize) -> String {
    let mut raw = vec![0u8; bytes];
    // The system's random source; should it fail, the time and a hash keep ids distinct at least.
    if getrandom::fill(&mut raw).is_err() {
        let seed = format!("{:?}{:?}", Instant::now(), std::thread::current().id());
        raw.copy_from_slice(&blake3::hash(seed.as_bytes()).as_bytes()[..bytes.min(32)]);
    }
    raw.iter().map(|b| format!("{b:02x}")).collect()
}

fn reply(status: StatusCode, kind: &'static str, body: impl Into<Bytes>) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, kind)
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header(header::REFERRER_POLICY, "no-referrer")
        .body(Full::new(body.into()))
        .unwrap_or_default()
}

fn json_reply(status: StatusCode, value: &Value) -> Response<Body> {
    reply(status, "application/json", value.to_string())
}

fn refuse(status: StatusCode, message: &str) -> Response<Body> {
    json_reply(status, &json!({ "error": message }))
}

/// The files of the participant page: the page itself, and what it loads from the app's own build.
fn asset_path(url_path: &str) -> Option<String> {
    let path = url_path.trim_start_matches('/');
    // The page is at the top of the relay only: by its own name it is the web version's page,
    // which looks for a presenter in another tab of the same browser.
    if path.is_empty() || path == "index.html" {
        return Some("join.html".into());
    }
    let allowed =
        path == "favicon.svg" || path.starts_with("assets/") || path.starts_with("fonts/");
    let plain = path
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "-_./".contains(c));
    (allowed && plain && !path.contains("..") && !path.contains("//")).then(|| path.to_string())
}

/// The devices's id and secret, when they name a device that joined.
fn known(req: &Request<Incoming>, relay: &Relay) -> Option<String> {
    let text = |name: &str| req.headers().get(name).and_then(|v| v.to_str().ok());
    let (id, secret) = (text("x-quiz-id")?, text("x-quiz-secret")?);
    let inner = relay.inner.lock().ok()?;
    let guest = inner.guests.get(id)?;
    // Compared in full whatever the first difference, so the time taken tells nothing.
    let same = guest.secret.len() == secret.len()
        && guest
            .secret
            .bytes()
            .zip(secret.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0;
    same.then(|| id.to_string())
}

async fn body_json(req: Request<Incoming>, max: usize) -> Result<Value, Response<Body>> {
    let bytes = Limited::new(req.into_body(), max)
        .collect()
        .await
        .map_err(|_| {
            refuse(
                StatusCode::PAYLOAD_TOO_LARGE,
                "That is too much to send at once.",
            )
        })?
        .to_bytes();
    serde_json::from_slice(&bytes).map_err(|_| refuse(StatusCode::BAD_REQUEST, "That is not JSON."))
}

/// The version at which the view a device is shown last changed.
fn view_version(relay: &Relay, id: Option<&str>) -> u64 {
    let inner = relay.inner.lock().expect("quiz");
    id.and_then(|id| inner.views.get(id))
        .map_or(inner.anyone.0, |view| view.0)
}

fn view_reply(relay: &Relay, id: Option<&str>, gone: bool) -> Response<Body> {
    let inner = relay.inner.lock().expect("quiz");
    let view = id
        .and_then(|id| inner.views.get(id))
        .map_or(&inner.anyone.1, |view| &view.1)
        .clone();
    let version = *relay.version.borrow();
    // The presenter's clock: the times a view names are moments on it.
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis())
        .unwrap_or_default();
    let view = if view.is_empty() { "null" } else { &view };
    // The view is JSON already (the presenter's page wrote it); it is passed on as it is.
    reply(
        StatusCode::OK,
        "application/json",
        format!("{{\"v\":{version},\"now\":{now},\"gone\":{gone},\"view\":{view}}}"),
    )
}

/// Whether a request names the relay the way its own addresses do: by number, or by a name
/// that only this computer or this network gives.  A page on the internet that points a name
/// of its own at this computer (to talk to the relay through a visitor's browser) is refused.
fn plain_host(host: &str) -> bool {
    let name = match host.rsplit_once(':') {
        Some((name, port)) if !name.is_empty() && port.chars().all(|c| c.is_ascii_digit()) => name,
        _ => host,
    };
    let name = name.trim_start_matches('[').trim_end_matches(']');
    name.parse::<IpAddr>().is_ok()
        || name.eq_ignore_ascii_case("localhost")
        || name.to_ascii_lowercase().ends_with(".local")
}

/// Whether something a device posts comes from the participant page this relay served:
/// it is JSON said to be JSON (which another site's page cannot send without asking first,
/// and the relay never agrees), and where the browser names the page's origin, it is this relay.
fn own_post(host: &str, origin: Option<&str>, content_type: Option<&str>) -> bool {
    let json = content_type
        .map(|kind| {
            kind.split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .eq_ignore_ascii_case("application/json")
        })
        .unwrap_or(false);
    json && match origin {
        None => true,
        Some(origin) => origin
            .strip_prefix("http://")
            .is_some_and(|rest| rest.eq_ignore_ascii_case(host)),
    }
}

async fn handle(
    req: Request<Incoming>,
    relay: Arc<Relay>,
    from: SocketAddr,
) -> Result<Response<Body>, std::convert::Infallible> {
    let path = req.uri().path().to_string();
    let text = |name: header::HeaderName| req.headers().get(name).and_then(|v| v.to_str().ok());
    let host = text(header::HOST).unwrap_or_default().to_string();
    if !plain_host(&host) {
        return Ok(refuse(
            StatusCode::MISDIRECTED_REQUEST,
            "Open the quiz by the address the presenter shows.",
        ));
    }
    if req.method() == Method::POST
        && !own_post(&host, text(header::ORIGIN), text(header::CONTENT_TYPE))
    {
        return Ok(refuse(
            StatusCode::FORBIDDEN,
            "Only the quiz page itself may send this.",
        ));
    }
    let response = match (req.method().clone(), path.as_str()) {
        (Method::POST, "/q/join") => join(req, &relay, from).await,
        (Method::POST, "/q/send") => send(req, &relay).await,
        (Method::POST, "/q/poll") => poll(req, &relay).await,
        (Method::GET, file) if file.starts_with("/q/file/") => {
            let inner = relay.inner.lock().expect("quiz");
            match inner.files.get(&file["/q/file/".len()..]) {
                Some((kind, bytes)) => Response::builder()
                    .header(header::CONTENT_TYPE, kind.as_str())
                    .header(header::CACHE_CONTROL, "private, max-age=3600")
                    .header("X-Content-Type-Options", "nosniff")
                    // A picture opened on its own must stay a picture.
                    .header(
                        header::CONTENT_SECURITY_POLICY,
                        "default-src 'none'; sandbox",
                    )
                    .body(Full::new(bytes.clone()))
                    .unwrap_or_default(),
                None => refuse(StatusCode::NOT_FOUND, "No such picture."),
            }
        }
        (Method::GET, other) => match asset_path(other).and_then(|name| {
            relay
                .app
                .asset_resolver()
                .get(name)
                .map(|asset| (asset.mime_type, asset.bytes))
        }) {
            Some((kind, bytes)) => Response::builder()
                .header(header::CONTENT_TYPE, kind)
                .header(
                    header::CACHE_CONTROL,
                    if other.starts_with("/assets/") {
                        "private, max-age=3600"
                    } else {
                        "no-store"
                    },
                )
                .header("X-Content-Type-Options", "nosniff")
                .header(header::REFERRER_POLICY, "no-referrer")
                .body(Full::new(Bytes::from(bytes)))
                .unwrap_or_default(),
            None => refuse(StatusCode::NOT_FOUND, "Nothing here."),
        },
        _ => refuse(StatusCode::METHOD_NOT_ALLOWED, "Not allowed."),
    };
    Ok(response)
}

async fn join(req: Request<Incoming>, relay: &Arc<Relay>, from: SocketAddr) -> Response<Body> {
    {
        let mut inner = relay.inner.lock().expect("quiz");
        let entry = inner.joins.entry(from.ip()).or_insert((Instant::now(), 0));
        if entry.0.elapsed() > Duration::from_secs(60) {
            *entry = (Instant::now(), 0);
        }
        entry.1 += 1;
        if entry.1 > 40 {
            return refuse(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many joins from this device; wait a minute.",
            );
        }
        if inner.guests.len() >= MAX_GUESTS {
            return refuse(StatusCode::SERVICE_UNAVAILABLE, "This quiz is full.");
        }
    }
    let message = match body_json(req, MAX_MESSAGE).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (id, secret) = (random_hex(8), random_hex(16));
    relay.inner.lock().expect("quiz").guests.insert(
        id.clone(),
        Guest {
            secret: secret.clone(),
            tokens: 20.0,
            refilled: Instant::now(),
        },
    );
    let _ = relay.app.emit(
        "quiz-message",
        json!({ "from": id, "message": {
            "kind": "join",
            "name": message.get("name").cloned().unwrap_or(Value::Null),
            "avatar": message.get("avatar").cloned().unwrap_or(Value::Null),
            "team": message.get("team").cloned().unwrap_or(Value::Null),
        } }),
    );
    json_reply(StatusCode::OK, &json!({ "id": id, "secret": secret }))
}

async fn send(req: Request<Incoming>, relay: &Arc<Relay>) -> Response<Body> {
    let Some(id) = known(&req, relay) else {
        return refuse(StatusCode::UNAUTHORIZED, "Join the quiz first.");
    };
    {
        // Twenty messages at once, five a second after that: plenty for answers, too few to flood the presenter.
        let mut inner = relay.inner.lock().expect("quiz");
        let Some(guest) = inner.guests.get_mut(&id) else {
            return refuse(StatusCode::UNAUTHORIZED, "Join the quiz first.");
        };
        guest.tokens = (guest.tokens + guest.refilled.elapsed().as_secs_f64() * 5.0).min(20.0);
        guest.refilled = Instant::now();
        if guest.tokens < 1.0 {
            return refuse(StatusCode::TOO_MANY_REQUESTS, "Slow down a little.");
        }
        guest.tokens -= 1.0;
    }
    let message = match body_json(req, MAX_MESSAGE).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    // Joining is done through /q/join only: a device cannot join as someone else.
    if message.get("kind").and_then(Value::as_str) == Some("join") || !message.is_object() {
        return refuse(StatusCode::BAD_REQUEST, "That message is not understood.");
    }
    let _ = relay
        .app
        .emit("quiz-message", json!({ "from": id, "message": message }));
    reply(StatusCode::NO_CONTENT, "application/json", "")
}

async fn poll(req: Request<Incoming>, relay: &Arc<Relay>) -> Response<Body> {
    let id = known(&req, relay);
    // A device that names itself but is not known was removed, or the session is a new one: it must join again.
    let gone = req.headers().contains_key("x-quiz-id") && id.is_none();
    let since = match body_json(req, 256).await {
        Ok(value) => value.get("v").and_then(Value::as_u64).unwrap_or(0),
        Err(response) => return response,
    };
    let mut news = relay.version.subscribe();
    let until = tokio::time::Instant::now() + POLL;
    // Held until this device's own view is newer than the one it has, or the time is up.
    while !gone && view_version(relay, id.as_deref()) <= since {
        match tokio::time::timeout_at(until, news.changed()).await {
            Ok(Ok(())) => {}
            _ => break,
        }
    }
    view_reply(relay, id.as_deref(), gone)
}

/// Starts the relay (stopping one that is running).  `lan` opens it to the local network; otherwise only this computer reaches it.
#[tauri::command]
pub async fn quiz_start(
    app: AppHandle,
    lan: bool,
    state: State<'_, QuizState>,
) -> Result<QuizStarted, String> {
    if let Some(old) = state.running.lock().map_err(|e| e.to_string())?.take() {
        let _ = old.stop.send(true);
    }
    let host: IpAddr = if lan {
        [0, 0, 0, 0].into()
    } else {
        [127, 0, 0, 1].into()
    };
    let listener = tokio::net::TcpListener::bind(SocketAddr::new(host, 0))
        .await
        .map_err(|e| format!("The quiz could not be opened to the network: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let mut urls = vec![format!("http://127.0.0.1:{port}/")];
    if lan {
        if let Some(ip) = crate::serve::lan_address() {
            urls.push(format!("http://{ip}:{port}/"));
        }
    }
    let (stop, mut stopped) = watch::channel(false);
    let (version, _) = watch::channel(1u64);
    let relay = Arc::new(Relay {
        app,
        inner: Mutex::new(Inner::default()),
        version,
    });
    let serving = relay.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                accepted = listener.accept() => {
                    let Ok((stream, from)) = accepted else { continue };
                    let relay = serving.clone();
                    let mut stop_conn = stopped.clone();
                    tokio::spawn(async move {
                        let service = service_fn(move |req| handle(req, relay.clone(), from));
                        let conn = http1::Builder::new().serve_connection(TokioIo::new(stream), service);
                        tokio::pin!(conn);
                        tokio::select! {
                            _ = conn.as_mut() => {}
                            _ = stop_conn.changed() => conn.as_mut().graceful_shutdown(),
                        }
                    });
                }
                _ = stopped.changed() => break,
            }
        }
    });
    *state.running.lock().map_err(|e| e.to_string())? = Some(Running { stop, relay });
    Ok(QuizStarted { port, urls })
}

fn relay_of(state: &State<'_, QuizState>) -> Result<Arc<Relay>, String> {
    state
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|running| running.relay.clone())
        .ok_or_else(|| "The quiz is not open to devices.".to_string())
}

/// What every device should show now: a view for each joined device (as JSON text), and one for the rest.
/// Devices whose view is the same as before are left alone.
#[tauri::command]
pub fn quiz_publish(
    views: HashMap<String, String>,
    anyone: String,
    state: State<'_, QuizState>,
) -> Result<(), String> {
    let relay = relay_of(&state)?;
    let mut inner = relay.inner.lock().map_err(|e| e.to_string())?;
    let next = *relay.version.borrow() + 1;
    let (kept, changed) = merge_views(&mut inner, views, anyone, next);
    inner.views = kept;
    if changed {
        relay.version.send_modify(|v| *v = next);
    }
    Ok(())
}

/// The views to keep from now on, and whether any device is to be told: a view that is the same
/// as before keeps its version; a new or changed one gets `next`.  A device whose view is gone
/// is shown the view for anyone, so that view counts as new as well.
fn merge_views(
    inner: &mut Inner,
    views: HashMap<String, String>,
    anyone: String,
    next: u64,
) -> (HashMap<String, (u64, Arc<str>)>, bool) {
    let mut kept = HashMap::with_capacity(views.len());
    let mut changed = false;
    for (id, view) in views {
        if !inner.guests.contains_key(&id) {
            continue;
        }
        match inner.views.remove(&id) {
            Some((version, old)) if *old == *view => {
                kept.insert(id, (version, old));
            }
            _ => {
                kept.insert(id, (next, Arc::from(view)));
                changed = true;
            }
        }
    }
    let lost = !inner.views.is_empty();
    if lost || *inner.anyone.1 != *anyone {
        inner.anyone = (next, Arc::from(anyone));
        changed = true;
    }
    (kept, changed)
}

/// A picture a slide shows (a data URL from the deck), kept under a name the views refer to.
#[tauri::command]
pub fn quiz_file(key: String, data: String, state: State<'_, QuizState>) -> Result<(), String> {
    let relay = relay_of(&state)?;
    if key.is_empty() || key.len() > 40 || !key.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("That is not a name for a picture.".into());
    }
    let (head, body) = data
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(";base64,"))
        .ok_or("That is not a picture.")?;
    if !matches!(
        head,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif"
    ) {
        return Err("Only PNG, JPEG, GIF, WebP and AVIF pictures are shown on devices.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(body)
        .map_err(|_| "That picture is damaged.")?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err("That picture is too large to send to devices.".into());
    }
    let mut inner = relay.inner.lock().map_err(|e| e.to_string())?;
    if inner.files.len() >= MAX_FILES && !inner.files.contains_key(&key) {
        return Err("This quiz has too many pictures.".into());
    }
    inner
        .files
        .insert(key, (head.to_string(), Bytes::from(bytes)));
    Ok(())
}

/// Removes a device: what it sends from now on is refused, and it is told to join again.
#[tauri::command]
pub fn quiz_drop(id: String, state: State<'_, QuizState>) -> Result<(), String> {
    let relay = relay_of(&state)?;
    let mut inner = relay.inner.lock().map_err(|e| e.to_string())?;
    inner.guests.remove(&id);
    if inner.views.remove(&id).is_some() {
        // Its request for news is answered with the view for anyone; the next one tells it to join again.
        let next = *relay.version.borrow() + 1;
        inner.anyone.0 = next;
        relay.version.send_modify(|v| *v = next);
    }
    Ok(())
}

#[tauri::command]
pub fn quiz_stop(state: State<'_, QuizState>) -> Result<(), String> {
    if let Some(old) = state.running.lock().map_err(|e| e.to_string())?.take() {
        let _ = old.stop.send(true);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_only_the_participant_page_and_its_files() {
        assert_eq!(asset_path("/").as_deref(), Some("join.html"));
        assert_eq!(asset_path("/index.html").as_deref(), Some("join.html"));
        assert_eq!(
            asset_path("/assets/join-AbC_12.js").as_deref(),
            Some("assets/join-AbC_12.js")
        );
        assert_eq!(asset_path("/favicon.svg").as_deref(), Some("favicon.svg"));
        for refused in [
            "/deck.html",
            "/join.html",
            "/tesseract/worker.min.js",
            "/assets/../index.html",
            "/assets//x.js",
            "/assets/x.js?y",
            "/assets/%2e%2e/secret",
            "/svgjs/frame.html",
            "/../etc/passwd",
        ] {
            assert_eq!(asset_path(refused), None, "{refused}");
        }
    }

    #[test]
    fn answers_only_to_its_own_addresses() {
        for own in [
            "127.0.0.1:4321",
            "192.168.1.20:4321",
            "localhost:4321",
            "[::1]:4321",
            "[fe80::1]",
            "bench.local:4321",
            "10.0.0.7",
        ] {
            assert!(plain_host(own), "{own}");
        }
        for other in [
            "",
            "evil.example:4321",
            "quiz.example.com",
            "127.0.0.1.evil.example:80",
            "local",
        ] {
            assert!(!plain_host(other), "{other}");
        }
    }

    #[test]
    fn takes_posts_only_from_its_own_page() {
        let host = "192.168.1.20:4321";
        assert!(own_post(host, None, Some("application/json")));
        assert!(own_post(
            host,
            Some("http://192.168.1.20:4321"),
            Some("application/json; charset=utf-8")
        ));
        // A form or a script on another site: the wrong kind of body, or the wrong origin.
        assert!(!own_post(host, None, Some("text/plain")));
        assert!(!own_post(host, None, None));
        assert!(!own_post(
            host,
            Some("https://evil.example"),
            Some("application/json")
        ));
        assert!(!own_post(
            host,
            Some("http://192.168.1.20:9999"),
            Some("application/json")
        ));
        assert!(!own_post(host, Some("null"), Some("application/json")));
    }

    #[test]
    fn tells_a_device_only_when_its_own_view_changes() {
        let guest = || Guest {
            secret: String::new(),
            tokens: 0.0,
            refilled: Instant::now(),
        };
        let mut inner = Inner::default();
        for id in ["a", "b"] {
            inner.guests.insert(id.into(), guest());
        }
        let views = |pairs: &[(&str, &str)]| -> HashMap<String, String> {
            pairs
                .iter()
                .map(|(id, view)| (id.to_string(), view.to_string()))
                .collect()
        };
        // The first views are new to everyone; a device that never joined gets none.
        let (kept, changed) = merge_views(
            &mut inner,
            views(&[("a", "{\"n\":1}"), ("b", "{\"n\":1}"), ("stranger", "{}")]),
            "{\"phase\":\"join\"}".into(),
            2,
        );
        inner.views = kept;
        assert!(changed);
        assert_eq!(inner.views.len(), 2);
        assert_eq!(
            (inner.views["a"].0, inner.views["b"].0, inner.anyone.0),
            (2, 2, 2)
        );
        // Only the view that changed is new.
        let (kept, changed) = merge_views(
            &mut inner,
            views(&[("a", "{\"n\":2}"), ("b", "{\"n\":1}")]),
            "{\"phase\":\"join\"}".into(),
            3,
        );
        inner.views = kept;
        assert!(changed);
        assert_eq!(
            (inner.views["a"].0, inner.views["b"].0, inner.anyone.0),
            (3, 2, 2)
        );
        assert_eq!(&*inner.views["a"].1, "{\"n\":2}");
        // Nothing changed: nobody is told.
        let (kept, changed) = merge_views(
            &mut inner,
            views(&[("a", "{\"n\":2}"), ("b", "{\"n\":1}")]),
            "{\"phase\":\"join\"}".into(),
            4,
        );
        inner.views = kept;
        assert!(!changed);
        assert_eq!(
            (inner.views["a"].0, inner.views["b"].0, inner.anyone.0),
            (3, 2, 2)
        );
        // A device that loses its view is shown the view for anyone, which counts as new for it.
        let (kept, changed) = merge_views(
            &mut inner,
            views(&[("a", "{\"n\":2}")]),
            "{\"phase\":\"join\"}".into(),
            5,
        );
        inner.views = kept;
        assert!(changed);
        assert!(!inner.views.contains_key("b"));
        assert_eq!((inner.views["a"].0, inner.anyone.0), (3, 5));
    }

    #[test]
    fn makes_ids_that_differ() {
        let (a, b) = (random_hex(16), random_hex(16));
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
