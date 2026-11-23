//! Small HTTP servers started from the app: a mock API (routes with canned or
//! templated responses, for front-end work and demos), a file server (a
//! folder shared on this computer or the local network, with optional uploads
//! and a password), a webhook catcher and a network speed test (a page that a
//! phone or another computer opens to measure the link to this one).  Each
//! runs until stopped; every request is reported to the app so it can be shown
//! in a log.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use bytes::Bytes;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{self, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::files::PickedFiles;

type Body = BoxBody<Bytes, std::io::Error>;

fn full(bytes: impl Into<Bytes>) -> Body {
    Full::new(bytes.into())
        .map_err(|never| match never {})
        .boxed()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    /// GET, POST… or ANY.
    pub method: String,
    /// "/api/shows/:id", with "*" matching the rest of the path.
    pub path: String,
    pub status: u16,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub delay_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServeConfig {
    /// "mock", "files", "webhook" or "speed".
    pub kind: String,
    /// Reachable from other devices on the network (0.0.0.0) rather than only this computer.
    #[serde(default)]
    pub lan: bool,
    /// 0 picks a free port.
    #[serde(default)]
    pub port: u16,
    #[serde(default = "yes")]
    pub cors: bool,
    #[serde(default)]
    pub routes: Vec<Route>,
    /// Folder token from the folder dialog (file server).
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub uploads: bool,
    /// Asked for by browsers (HTTP basic authentication, user name ignored) when not empty.
    #[serde(default)]
    pub password: String,
}

fn yes() -> bool {
    true
}

struct Running {
    stop: tokio::sync::watch::Sender<bool>,
}

#[derive(Default)]
pub struct ServeState {
    running: Mutex<HashMap<String, Running>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub port: u16,
    /// Addresses to open: this computer, then the local network.
    pub urls: Vec<String>,
}

/* ------------------------------------------------------------ routes -- */

/// Matches "/api/shows/:id" against a path; returns the named parts.
pub fn match_route(pattern: &str, path: &str) -> Option<HashMap<String, String>> {
    let mut params = HashMap::new();
    let p: Vec<&str> = pattern
        .trim_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    let a: Vec<&str> = path
        .trim_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    for (i, part) in p.iter().enumerate() {
        if *part == "*" {
            params.insert(
                "rest".into(),
                a.get(i..).map(|r| r.join("/")).unwrap_or_default(),
            );
            return Some(params);
        }
        let actual = a.get(i)?;
        if let Some(name) = part.strip_prefix(':') {
            params.insert(
                name.to_string(),
                percent_encoding::percent_decode_str(actual)
                    .decode_utf8_lossy()
                    .into_owned(),
            );
        } else if !part.eq_ignore_ascii_case(actual) {
            return None;
        }
    }
    (p.len() == a.len()).then_some(params)
}

fn lookup<'a>(value: &'a Value, dotted: &str) -> Option<&'a Value> {
    dotted.split('.').try_fold(value, |v, key| match v {
        Value::Object(map) => map.get(key),
        Value::Array(items) => key.parse::<usize>().ok().and_then(|i| items.get(i)),
        _ => None,
    })
}

/// Fills {{params.id}}, {{query.page}}, {{body.name}}, {{headers.user-agent}},
/// {{method}}, {{path}}, {{now}}, {{timestamp}}, {{uuid}} and {{random:1:100}}.
pub fn fill(template: &str, context: &Value) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].find("}}") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let key = rest[start + 2..start + end].trim();
        let value = match key {
            "now" => humantime_now(),
            "timestamp" => SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis().to_string())
                .unwrap_or_default(),
            "uuid" => uuid4(),
            k if k.starts_with("random") => {
                let parts: Vec<i64> = k
                    .split(':')
                    .skip(1)
                    .filter_map(|n| n.trim().parse().ok())
                    .collect();
                let (low, high) = (
                    parts.first().copied().unwrap_or(0),
                    parts.get(1).copied().unwrap_or(100),
                );
                (low + (random_u64() % (high.saturating_sub(low).max(0) as u64 + 1)) as i64)
                    .to_string()
            }
            k => match lookup(context, k) {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Null) | None => String::new(),
                Some(other) => other.to_string(),
            },
        };
        out.push_str(&value);
        rest = &rest[start + end + 2..];
    }
    out.push_str(rest);
    out
}

fn random_u64() -> u64 {
    let mut bytes = [0u8; 8];
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let mixed = blake3::hash(&nanos.to_le_bytes());
    bytes.copy_from_slice(&mixed.as_bytes()[..8]);
    u64::from_le_bytes(bytes)
}

fn uuid4() -> String {
    let a = random_u64();
    let b = random_u64() ^ a.rotate_left(17);
    let mut bytes = [0u8; 16];
    bytes[..8].copy_from_slice(&a.to_le_bytes());
    bytes[8..].copy_from_slice(&b.to_le_bytes());
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

fn humantime_now() -> String {
    // ISO 8601 in UTC without a date library.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default() as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Civil from days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/* ------------------------------------------------------------- files -- */

fn safe_join(root: &Path, url_path: &str) -> Option<PathBuf> {
    let decoded = percent_encoding::percent_decode_str(url_path)
        .decode_utf8_lossy()
        .into_owned();
    let mut path = root.to_path_buf();
    for part in Path::new(decoded.trim_start_matches('/')).components() {
        match part {
            Component::Normal(p) => {
                if p.to_string_lossy().starts_with('.') {
                    return None;
                }
                path.push(p);
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(path)
}

fn mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json") => "application/json",
        Some("txt" | "md" | "csv" | "log") => "text/plain; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("zip") => "application/zip",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn listing(dir: &Path, url_path: &str, uploads: bool) -> String {
    let mut entries: Vec<(String, bool, u64)> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                .map(|e| {
                    let meta = e.metadata().ok();
                    (
                        e.file_name().to_string_lossy().into_owned(),
                        meta.as_ref().is_some_and(std::fs::Metadata::is_dir),
                        meta.map_or(0, |m| m.len()),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    entries.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then(a.0.to_lowercase().cmp(&b.0.to_lowercase()))
    });
    let base = if url_path.ends_with('/') {
        url_path.to_string()
    } else {
        format!("{url_path}/")
    };
    let rows: String = entries
        .iter()
        .map(|(name, is_dir, size)| {
            let href = format!(
                "{base}{}{}",
                percent_encoding::utf8_percent_encode(name, percent_encoding::NON_ALPHANUMERIC),
                if *is_dir { "/" } else { "" }
            );
            let size = if *is_dir { String::new() } else { human(*size) };
            format!(
                "<tr><td><a href=\"{href}\">{}{}</a></td><td>{size}</td></tr>",
                escape(name),
                if *is_dir { "/" } else { "" }
            )
        })
        .collect();
    let up = if base != "/" {
        "<p><a href=\"..\">⬑ Up one folder</a></p>"
    } else {
        ""
    };
    let upload = if uploads {
        r#"<form id="up"><label>Send files to this folder: <input type="file" id="files" multiple></label> <button>Send</button> <span id="state"></span></form>
<script>
document.getElementById('up').onsubmit = async (e) => {
  e.preventDefault();
  const files = document.getElementById('files').files, state = document.getElementById('state');
  for (const [i, f] of [...files].entries()) {
    state.textContent = 'Sending ' + (i + 1) + ' of ' + files.length + '…';
    const r = await fetch(location.pathname.replace(/\/?$/, '/') + encodeURIComponent(f.name), { method: 'PUT', body: f });
    if (!r.ok) { state.textContent = f.name + ': ' + (await r.text()); return; }
  }
  location.reload();
};
</script>"#
    } else {
        ""
    };
    format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>{title}</title><style>body{{font:16px/1.5 system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#1f2328}}a{{color:#0969da;text-decoration:none}}td{{padding:6px 10px;border-bottom:1px solid #d1d9e0}}td:last-child{{color:#59636e;text-align:right;white-space:nowrap}}table{{border-collapse:collapse;width:100%}}form{{margin:1.5rem 0;padding:1rem;border:1px dashed #b4bec6;border-radius:8px}}</style></head><body><h1>{title}</h1>{up}{upload}<table>{rows}</table><p style=\"color:#59636e;font-size:13px\">Shared from Benchtop.</p></body></html>",
        title = escape(&percent_encoding::percent_decode_str(url_path).decode_utf8_lossy())
    )
}

fn human(bytes: u64) -> String {
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < units.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", units[unit])
    }
}

/// A file as a stream, whole or a byte range (for video seeking).
async fn send_file(path: &Path, range: Option<&str>) -> Result<Response<Body>, String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| e.to_string())?;
    let size = file.metadata().await.map_err(|e| e.to_string())?.len();
    let (start, end, partial) = match range
        .and_then(|r| r.strip_prefix("bytes="))
        .and_then(|r| r.split(',').next())
    {
        Some(spec) => {
            let (a, b) = spec.split_once('-').unwrap_or((spec, ""));
            let (start, end) = if a.is_empty() {
                let suffix: u64 = b.parse().unwrap_or(0);
                (size.saturating_sub(suffix), size.saturating_sub(1))
            } else {
                (
                    a.parse().unwrap_or(0),
                    b.parse()
                        .unwrap_or(size.saturating_sub(1))
                        .min(size.saturating_sub(1)),
                )
            };
            if start > end || start >= size {
                return Ok(Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                    .body(full(""))
                    .unwrap_or_default());
            }
            (start, end, true)
        }
        None => (0, size.saturating_sub(1), false),
    };
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|e| e.to_string())?;
    let length = if size == 0 { 0 } else { end - start + 1 };
    let stream = futures_util::stream::unfold((file, length), |(mut file, left)| async move {
        if left == 0 {
            return None;
        }
        let mut buf = vec![0u8; (64 * 1024).min(left as usize)];
        match file.read(&mut buf).await {
            Ok(0) => None,
            Ok(n) => {
                buf.truncate(n);
                Some((Ok(Frame::data(Bytes::from(buf))), (file, left - n as u64)))
            }
            Err(e) => Some((Err(e), (file, 0))),
        }
    });
    let mut builder = Response::builder()
        .status(if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header(header::CONTENT_TYPE, mime(path))
        .header(header::CONTENT_LENGTH, length)
        .header(header::ACCEPT_RANGES, "bytes");
    if partial {
        builder = builder.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    builder
        .body(BodyExt::boxed(StreamBody::new(stream)))
        .map_err(|e| e.to_string())
}

/* ----------------------------------------------------------- serving -- */

struct Context {
    config: ServeConfig,
    root: Option<PathBuf>,
    report: Box<dyn Fn(Value) + Send + Sync>,
}

fn authorised(req: &Request<Incoming>, password: &str) -> bool {
    if password.is_empty() {
        return true;
    }
    req.headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Basic "))
        .and_then(|v| {
            base64::engine::general_purpose::STANDARD
                .decode(v.trim())
                .ok()
        })
        .and_then(|v| String::from_utf8(v).ok())
        .and_then(|v| v.split_once(':').map(|(_, p)| p.to_string()))
        .is_some_and(|given| given == password)
}

async fn handle(
    req: Request<Incoming>,
    ctx: Arc<Context>,
    from: SocketAddr,
) -> Result<Response<Body>, std::convert::Infallible> {
    let started = Instant::now();
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let query = req.uri().query().unwrap_or_default().to_string();
    let mut response = if !authorised(&req, &ctx.config.password) {
        Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .header(
                header::WWW_AUTHENTICATE,
                "Basic realm=\"Benchtop\", charset=\"UTF-8\"",
            )
            .body(full("A password is needed."))
            .unwrap_or_default()
    } else if method == Method::OPTIONS && ctx.config.cors {
        Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(full(""))
            .unwrap_or_default()
    } else if ctx.config.kind == "files" {
        serve_files(req, &ctx).await
    } else if ctx.config.kind == "webhook" {
        return Ok(catch_webhook(req, &ctx, from, started).await);
    } else if ctx.config.kind == "speed" {
        let (response, bytes) = serve_speed(req).await;
        if path != "/speed/ping" {
            (ctx.report)(json!({
                "method": method.as_str(),
                "path": path,
                "status": response.status().as_u16(),
                "ms": started.elapsed().as_millis() as u64,
                "from": from.ip().to_string(),
                "size": bytes,
            }));
        }
        return Ok(response);
    } else {
        serve_mock(req, &ctx).await
    };
    if ctx.config.cors {
        let h = response.headers_mut();
        h.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"),
        );
        h.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, OPTIONS"),
        );
        h.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("*"),
        );
    }
    (ctx.report)(json!({
        "method": method.as_str(),
        "path": if query.is_empty() { path } else { format!("{path}?{query}") },
        "status": response.status().as_u16(),
        "ms": started.elapsed().as_millis() as u64,
        "from": from.ip().to_string(),
    }));
    Ok(response)
}

/// Records a whole request (headers and body) and answers with the first route's reply, or 200.
async fn catch_webhook(
    req: Request<Incoming>,
    ctx: &Context,
    from: SocketAddr,
    started: Instant,
) -> Response<Body> {
    let method = req.method().as_str().to_string();
    let path = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_default();
    let headers: Vec<(String, String)> = req
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_string(),
                v.to_str().unwrap_or("(binary)").to_string(),
            )
        })
        .collect();
    let raw = req
        .into_body()
        .collect()
        .await
        .map(|b| b.to_bytes())
        .unwrap_or_default();
    let body = String::from_utf8_lossy(&raw[..raw.len().min(256 * 1024)]).into_owned();
    let reply = ctx.config.routes.first();
    let status = reply.map_or(200, |r| r.status);
    let mut builder =
        Response::builder().status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK));
    if ctx.config.cors {
        builder = builder
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "*");
    }
    let text = reply.map_or_else(|| r#"{"received": true}"#.to_string(), |r| r.body.clone());
    builder = builder.header(
        header::CONTENT_TYPE,
        if text.trim_start().starts_with('{') {
            "application/json"
        } else {
            "text/plain; charset=utf-8"
        },
    );
    (ctx.report)(json!({
        "method": method,
        "path": path,
        "status": status,
        "ms": started.elapsed().as_millis() as u64,
        "from": from.ip().to_string(),
        "headers": headers,
        "body": body,
        "size": raw.len(),
    }));
    builder.body(full(text)).unwrap_or_default()
}

async fn serve_mock(req: Request<Incoming>, ctx: &Context) -> Response<Body> {
    let method = req.method().as_str().to_ascii_uppercase();
    let path = req.uri().path().to_string();
    let query: serde_json::Map<String, Value> =
        url::form_urlencoded::parse(req.uri().query().unwrap_or_default().as_bytes())
            .map(|(k, v)| (k.into_owned(), Value::String(v.into_owned())))
            .collect();
    let headers: serde_json::Map<String, Value> = req
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_string(),
                Value::String(v.to_str().unwrap_or_default().to_string()),
            )
        })
        .collect();
    let Some((route, params)) = ctx.config.routes.iter().find_map(|r| {
        let m = r.method.trim().to_ascii_uppercase();
        if m != "ANY" && m != method {
            return None;
        }
        match_route(&r.path, &path).map(|p| (r, p))
    }) else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "application/json")
            .body(full(
                json!({ "error": "No mock route matches", "method": method, "path": path })
                    .to_string(),
            ))
            .unwrap_or_default();
    };
    let raw = req
        .into_body()
        .collect()
        .await
        .map(|b| b.to_bytes())
        .unwrap_or_default();
    let text = String::from_utf8_lossy(&raw[..raw.len().min(1 << 20)]).into_owned();
    let body_value = serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text.clone()));
    let context = json!({
        "params": params,
        "query": query,
        "headers": headers,
        "body": body_value,
        "method": method,
        "path": path,
    });
    if route.delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(route.delay_ms.min(60_000))).await;
    }
    let body = fill(&route.body, &context);
    let looks_json = matches!(body.trim_start().chars().next(), Some('{' | '['));
    let mut builder =
        Response::builder().status(StatusCode::from_u16(route.status).unwrap_or(StatusCode::OK));
    let mut has_type = false;
    for (name, value) in &route.headers {
        if name.eq_ignore_ascii_case("content-type") {
            has_type = true;
        }
        builder = builder.header(name.as_str(), fill(value, &context));
    }
    if !has_type {
        builder = builder.header(
            header::CONTENT_TYPE,
            if looks_json {
                "application/json"
            } else {
                "text/plain; charset=utf-8"
            },
        );
    }
    builder.body(full(body)).unwrap_or_else(|e| {
        Response::builder()
            .status(500)
            .body(full(e.to_string()))
            .unwrap_or_default()
    })
}

async fn serve_files(req: Request<Incoming>, ctx: &Context) -> Response<Body> {
    let Some(root) = &ctx.root else {
        return Response::builder()
            .status(500)
            .body(full("No folder"))
            .unwrap_or_default();
    };
    let path = req.uri().path().to_string();
    let Some(target) = safe_join(root, &path) else {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(full("Not allowed"))
            .unwrap_or_default();
    };
    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(full("Not found"))
            .unwrap_or_default()
    };
    match *req.method() {
        Method::PUT if ctx.config.uploads => {
            if target.exists() && target.is_dir() {
                return Response::builder()
                    .status(StatusCode::CONFLICT)
                    .body(full("A folder has that name"))
                    .unwrap_or_default();
            }
            // Never overwrite: a second file with the same name gets a number.
            let mut destination = target.clone();
            let mut n = 2;
            while destination.exists() {
                let stem = target
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let ext = target
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy()))
                    .unwrap_or_default();
                destination = target.with_file_name(format!("{stem} ({n}){ext}"));
                n += 1;
            }
            let result: Result<u64, String> = async {
                let mut file = tokio::fs::File::create(&destination)
                    .await
                    .map_err(|e| e.to_string())?;
                let mut body = req.into_body();
                let mut written = 0u64;
                while let Some(frame) = body.frame().await {
                    let frame = frame.map_err(|e| e.to_string())?;
                    if let Ok(data) = frame.into_data() {
                        written += data.len() as u64;
                        file.write_all(&data).await.map_err(|e| e.to_string())?;
                    }
                }
                file.flush().await.map_err(|e| e.to_string())?;
                Ok(written)
            }
            .await;
            match result {
                Ok(_) => Response::builder()
                    .status(StatusCode::CREATED)
                    .body(full("Saved"))
                    .unwrap_or_default(),
                Err(e) => {
                    let _ = tokio::fs::remove_file(&destination).await;
                    Response::builder()
                        .status(500)
                        .body(full(e))
                        .unwrap_or_default()
                }
            }
        }
        Method::GET | Method::HEAD => {
            if target.is_dir() {
                if !path.ends_with('/') {
                    return Response::builder()
                        .status(StatusCode::MOVED_PERMANENTLY)
                        .header(header::LOCATION, format!("{path}/"))
                        .body(full(""))
                        .unwrap_or_default();
                }
                let index = target.join("index.html");
                if index.is_file() {
                    return send_file(&index, None)
                        .await
                        .unwrap_or_else(|_| not_found());
                }
                return Response::builder()
                    .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(full(listing(&target, &path, ctx.config.uploads)))
                    .unwrap_or_default();
            }
            if !target.is_file() {
                return not_found();
            }
            let range = req
                .headers()
                .get(header::RANGE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            send_file(&target, range.as_deref())
                .await
                .unwrap_or_else(|_| not_found())
        }
        _ => Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .body(full("Not allowed"))
            .unwrap_or_default(),
    }
}

/* -------------------------------------------------------- speed test -- */

const SPEED_PAGE: &str = r##"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Network speed test · Benchtop</title>
<style>
body{margin:0;background:#0d1117;color:#e6edf3;font:16px/1.5 "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;display:grid;place-items:center;min-height:100vh}
main{width:min(30rem,92vw)}h1{font-size:1.25rem;margin:0 0 .25rem}p{color:#8d96a0;margin:.25rem 0 1.25rem}
dl{display:grid;grid-template-columns:auto 1fr;gap:.5rem 1rem;margin:1.5rem 0}dt{color:#8d96a0}dd{margin:0;font-size:1.5rem;font-variant-numeric:tabular-nums}
button{font:inherit;background:#238636;color:#fff;border:1px solid #2ea043;border-radius:6px;padding:.5rem 1.25rem;cursor:pointer}button:disabled{opacity:.6;cursor:default}
#state{color:#8d96a0;margin-left:.75rem}
</style></head><body><main>
<h1>Network speed test</h1>
<p>Measures the link between this device and the computer running Benchtop. Nothing leaves your network.</p>
<button id="go">Start test</button><span id="state"></span>
<dl><dt>Latency</dt><dd id="ping">–</dd><dt>Download</dt><dd id="down">–</dd><dt>Upload</dt><dd id="up">–</dd></dl>
</main><script>
const $=(id)=>document.getElementById(id);
const mbps=(bytes,start)=>bytes*8/((performance.now()-start)/1000)/1e6;
const show=(id,v)=>{$(id).textContent=v.toFixed(v<10?1:0)+' Mbit/s'};
async function run(){
 $('go').disabled=true;
 try{
  $('state').textContent='Latency…';let best=1e9;
  for(let i=0;i<5;i++){const t=performance.now();await fetch('/speed/ping?'+Math.random(),{cache:'no-store'});best=Math.min(best,performance.now()-t)}
  $('ping').textContent=best.toFixed(1)+' ms';
  $('state').textContent='Download…';let bytes=0,size=1<<20,start=performance.now();
  while(performance.now()-start<8000){const r=await fetch('/speed/down?bytes='+size+'&r='+Math.random(),{cache:'no-store'});const reader=r.body.getReader();for(;;){const c=await reader.read();if(c.done)break;bytes+=c.value.length;show('down',mbps(bytes,start))}size=Math.min(size*2,256<<20)}
  $('state').textContent='Upload…';const block=new Uint8Array(4<<20);for(let i=0;i<block.length;i++)block[i]=(i*2654435761)>>>24;
  let sent=0;start=performance.now();
  while(performance.now()-start<8000){await fetch('/speed/up',{method:'POST',body:block});sent+=block.length;show('up',mbps(sent,start))}
  $('state').textContent='Done';
 }catch(e){$('state').textContent='The test stopped: '+e.message}
 $('go').disabled=false;
}
$('go').addEventListener('click',run);
</script></body></html>"##;

/// Download size limit for one request.
const SPEED_MAX: u64 = 256 << 20;

fn speed_block() -> Bytes {
    // Varied bytes, so nothing on the way can shrink them.
    let mut state = 0x9E37_79B9_7F4A_7C15u64;
    let block: Vec<u8> = (0..256 * 1024)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 24) as u8
        })
        .collect();
    Bytes::from(block)
}

/// The speed test: a page, /speed/ping, /speed/down?bytes=N and /speed/up. Returns the bytes moved.
async fn serve_speed(req: Request<Incoming>) -> (Response<Body>, u64) {
    let path = req.uri().path().to_string();
    let no_store = |b: hyper::http::response::Builder| b.header(header::CACHE_CONTROL, "no-store");
    match (req.method().clone(), path.as_str()) {
        (Method::GET, "/" | "/index.html") => (
            no_store(Response::builder())
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .body(full(SPEED_PAGE))
                .unwrap_or_default(),
            0,
        ),
        (_, "/speed/ping") => (
            no_store(Response::builder())
                .header(header::CONTENT_TYPE, "text/plain")
                .body(full("pong"))
                .unwrap_or_default(),
            0,
        ),
        (Method::GET, "/speed/down") => {
            let wanted =
                url::form_urlencoded::parse(req.uri().query().unwrap_or_default().as_bytes())
                    .find(|(k, _)| k == "bytes")
                    .and_then(|(_, v)| v.parse::<u64>().ok())
                    .unwrap_or(1 << 20)
                    .clamp(1, SPEED_MAX);
            let block = speed_block();
            let stream = futures_util::stream::unfold(wanted, move |left| {
                let block = block.clone();
                async move {
                    if left == 0 {
                        return None;
                    }
                    let n = (block.len() as u64).min(left) as usize;
                    Some((
                        Ok::<_, std::io::Error>(Frame::data(block.slice(..n))),
                        left - n as u64,
                    ))
                }
            });
            let response = no_store(Response::builder())
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .header(header::CONTENT_LENGTH, wanted)
                .body(BodyExt::boxed(StreamBody::new(stream)))
                .unwrap_or_default();
            (response, wanted)
        }
        (Method::POST | Method::PUT, "/speed/up") => {
            let mut body = req.into_body();
            let mut received = 0u64;
            while let Some(Ok(frame)) = body.frame().await {
                if let Ok(data) = frame.into_data() {
                    received += data.len() as u64;
                }
            }
            (
                no_store(Response::builder())
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(full(json!({ "bytes": received }).to_string()))
                    .unwrap_or_default(),
                received,
            )
        }
        _ => (
            Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(full("Not found"))
                .unwrap_or_default(),
            0,
        ),
    }
}

/// This computer's address on the local network (no packet is sent).
pub fn lan_address() -> Option<IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    socket
        .local_addr()
        .ok()
        .map(|a| a.ip())
        .filter(|ip| !ip.is_loopback() && !ip.is_unspecified())
}

pub async fn start(
    config: ServeConfig,
    root: Option<PathBuf>,
    report: Box<dyn Fn(Value) + Send + Sync>,
) -> Result<(Started, tokio::sync::watch::Sender<bool>), String> {
    let host: IpAddr = if config.lan {
        [0, 0, 0, 0].into()
    } else {
        [127, 0, 0, 1].into()
    };
    let listener = tokio::net::TcpListener::bind(SocketAddr::new(host, config.port))
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AddrInUse {
                format!(
                    "Port {} is already in use; choose another or leave it at 0.",
                    config.port
                )
            } else {
                e.to_string()
            }
        })?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let mut urls = vec![format!("http://127.0.0.1:{port}/")];
    if config.lan {
        if let Some(ip) = lan_address() {
            urls.push(format!("http://{ip}:{port}/"));
        }
    }
    let (stop, mut stopped) = tokio::sync::watch::channel(false);
    let ctx = Arc::new(Context {
        config,
        root,
        report,
    });
    tokio::spawn(async move {
        loop {
            tokio::select! {
                accepted = listener.accept() => {
                    let Ok((stream, from)) = accepted else { continue };
                    let ctx = ctx.clone();
                    let mut stop_conn = stopped.clone();
                    tokio::spawn(async move {
                        let service = service_fn(move |req| handle(req, ctx.clone(), from));
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
    Ok((Started { port, urls }, stop))
}

#[tauri::command]
pub async fn serve_start(
    app: AppHandle,
    id: String,
    config: ServeConfig,
    picked: State<'_, PickedFiles>,
    state: State<'_, ServeState>,
) -> Result<Started, String> {
    let root = if config.kind == "files" {
        Some(
            picked
                .path(&config.folder)
                .filter(|p| p.is_dir())
                .ok_or("Choose the folder to share again.")?,
        )
    } else {
        None
    };
    if let Some(old) = state.running.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = old.stop.send(true);
    }
    let reporter_id = id.clone();
    let report = Box::new(move |mut entry: Value| {
        entry["id"] = json!(reporter_id);
        let _ = app.emit("serve-request", entry);
    });
    let (started, stop) = start(config, root, report).await?;
    state
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, Running { stop });
    Ok(started)
}

#[tauri::command]
pub fn serve_stop(id: String, state: State<'_, ServeState>) -> Result<(), String> {
    if let Some(old) = state.running.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = old.stop.send(true);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_routes_with_parameters() {
        assert_eq!(
            match_route("/api/shows/:id", "/api/shows/42")
                .unwrap()
                .get("id")
                .map(String::as_str),
            Some("42")
        );
        assert!(match_route("/api/shows/:id", "/api/shows").is_none());
        assert!(match_route("/api/shows", "/API/Shows/").is_some());
        assert_eq!(
            match_route("/static/*", "/static/css/site.css")
                .unwrap()
                .get("rest")
                .map(String::as_str),
            Some("css/site.css")
        );
        assert!(match_route("/", "/").is_some());
    }

    #[test]
    fn fills_templates_from_the_request() {
        let ctx = json!({ "params": { "id": "7" }, "query": { "q": "planetarium" }, "body": { "seats": [2, 3] }, "method": "POST" });
        assert_eq!(
            fill(
                r#"{"id": {{params.id}}, "q": "{{query.q}}", "s": {{body.seats.1}}, "m": "{{method}}", "x": "{{missing}}"}"#,
                &ctx
            ),
            r#"{"id": 7, "q": "planetarium", "s": 3, "m": "POST", "x": ""}"#
        );
        let n: i64 = fill("{{random:5:6}}", &ctx).parse().unwrap();
        assert!((5..=6).contains(&n));
        assert_eq!(fill("{{uuid}}", &ctx).len(), 36);
        assert!(fill("{{now}}", &ctx).ends_with('Z'));
    }

    #[test]
    fn keeps_file_requests_inside_the_folder() {
        let root = Path::new("/srv/share");
        assert_eq!(
            safe_join(root, "/photos/a%20b.jpg"),
            Some(PathBuf::from("/srv/share/photos/a b.jpg"))
        );
        assert_eq!(safe_join(root, "/../etc/passwd"), None);
        assert_eq!(safe_join(root, "/%2e%2e/etc/passwd"), None);
        assert_eq!(safe_join(root, "/.git/config"), None);
    }

    async fn get(url: &str, extra: &[(&str, &str)]) -> (u16, HashMap<String, String>, Vec<u8>) {
        let uri: hyper::Uri = url.parse().unwrap();
        let stream = tokio::net::TcpStream::connect((uri.host().unwrap(), uri.port_u16().unwrap()))
            .await
            .unwrap();
        let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
            .await
            .unwrap();
        tokio::spawn(conn);
        let mut req = Request::builder()
            .uri(uri.path_and_query().unwrap().as_str())
            .header(header::HOST, "localhost");
        for (k, v) in extra {
            req = req.header(*k, *v);
        }
        let res = sender
            .send_request(req.body(full("")).unwrap())
            .await
            .unwrap();
        let status = res.status().as_u16();
        let headers = res
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
            .collect();
        let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
        (status, headers, body)
    }

    #[test]
    fn serves_mock_routes_and_files() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let log = Arc::new(Mutex::new(Vec::new()));
            let sink = log.clone();
            let config = ServeConfig {
                kind: "mock".into(),
                lan: false,
                port: 0,
                cors: true,
                routes: vec![Route {
                    method: "GET".into(),
                    path: "/shows/:id".into(),
                    status: 200,
                    headers: vec![],
                    body: r#"{"show": "{{params.id}}"}"#.into(),
                    delay_ms: 0,
                }],
                folder: String::new(),
                uploads: false,
                password: String::new(),
            };
            let (started, stop) = start(
                config,
                None,
                Box::new(move |v| sink.lock().unwrap().push(v)),
            )
            .await
            .unwrap();
            let (status, headers, body) =
                get(&format!("http://127.0.0.1:{}/shows/42", started.port), &[]).await;
            assert_eq!(status, 200);
            assert_eq!(
                headers.get("content-type").map(String::as_str),
                Some("application/json")
            );
            assert_eq!(
                headers
                    .get("access-control-allow-origin")
                    .map(String::as_str),
                Some("*")
            );
            assert_eq!(String::from_utf8(body).unwrap(), r#"{"show": "42"}"#);
            assert_eq!(
                get(&format!("http://127.0.0.1:{}/nothing", started.port), &[])
                    .await
                    .0,
                404
            );
            assert_eq!(log.lock().unwrap().len(), 2);
            let _ = stop.send(true);

            let folder =
                std::env::temp_dir().join(format!("benchtop-serve-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&folder);
            std::fs::create_dir_all(folder.join("sub")).unwrap();
            std::fs::write(folder.join("sub/clip.mp4"), b"0123456789").unwrap();
            let config = ServeConfig {
                kind: "files".into(),
                lan: false,
                port: 0,
                cors: false,
                routes: vec![],
                folder: String::new(),
                uploads: true,
                password: "pw".into(),
            };
            let (started, stop) = start(config, Some(folder.clone()), Box::new(|_| {}))
                .await
                .unwrap();
            let base = format!("http://127.0.0.1:{}", started.port);
            assert_eq!(get(&format!("{base}/sub/"), &[]).await.0, 401);
            let auth = format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode("any:pw")
            );
            let (status, _, body) = get(&format!("{base}/sub/"), &[("authorization", &auth)]).await;
            assert_eq!(status, 200);
            assert!(String::from_utf8(body).unwrap().contains("clip.mp4"));
            let (status, headers, body) = get(
                &format!("{base}/sub/clip.mp4"),
                &[("authorization", &auth), ("range", "bytes=2-5")],
            )
            .await;
            assert_eq!(status, 206);
            assert_eq!(
                headers.get("content-range").map(String::as_str),
                Some("bytes 2-5/10")
            );
            assert_eq!(body, b"2345");
            let _ = stop.send(true);
            let _ = std::fs::remove_dir_all(&folder);
        });
    }
}
