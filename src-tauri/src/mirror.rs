//! Website copier (like HTTrack): downloads a website's pages and the
//! pictures, styles and scripts they use into a folder, and rewrites the links
//! so the copy can be browsed offline.  It stays inside the scope it is given,
//! follows robots.txt unless told not to, waits between requests and stops at
//! the page, file and size limits.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lol_html::html_content::ContentType;
use lol_html::{element, text, HtmlRewriter, Settings};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use url::Url;

use crate::files::PickedFiles;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    /// The start address's host only.
    Host,
    /// The host and its subdomains (www.example.org, shop.example.org…).
    Domain,
    /// The start page's folder and below.
    Folder,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorOptions {
    pub url: String,
    pub folder: String,
    #[serde(default = "default_depth")]
    pub depth: u32,
    #[serde(default = "default_scope")]
    pub scope: Scope,
    #[serde(default = "default_pages")]
    pub max_pages: usize,
    #[serde(default = "default_megabytes")]
    pub max_megabytes: u64,
    /// Pictures, styles and scripts from other sites (CDNs) that the pages need.
    #[serde(default = "default_true")]
    pub outside_assets: bool,
    #[serde(default = "default_true")]
    pub robots: bool,
    /// Pause between requests, in milliseconds.
    #[serde(default = "default_delay")]
    pub delay_ms: u64,
    /// Address fragments to leave out (one per line, plain text).
    #[serde(default)]
    pub exclude: Vec<String>,
}

fn default_depth() -> u32 {
    3
}
fn default_scope() -> Scope {
    Scope::Host
}
fn default_pages() -> usize {
    300
}
fn default_megabytes() -> u64 {
    500
}
fn default_true() -> bool {
    true
}
fn default_delay() -> u64 {
    250
}

const MAX_FILE: u64 = 100 * 1024 * 1024;
const MAX_FILES: usize = 20_000;
const WORKERS: usize = 4;

#[derive(Default)]
pub struct MirrorState {
    cancelled: Mutex<HashSet<String>>,
}

/* ------------------------------------------------------------ paths -- */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Page,
    Style,
    Script,
    Asset,
}

fn clean_segment(segment: &str) -> String {
    let decoded = percent_encoding::percent_decode_str(segment).decode_utf8_lossy();
    let mut out: String = decoded
        .chars()
        .map(|c| {
            if c.is_control() || r#"\/:*?"<>|"#.contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    out = out.trim().trim_end_matches('.').to_string();
    if out.is_empty() || out == "." || out == ".." {
        out = "_".into();
    }
    // Windows reserves some names whatever the extension.
    let stem = out
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "LPT1", "LPT2",
    ]
    .contains(&stem.as_str())
    {
        out.insert(0, '_');
    }
    out.chars().take(100).collect()
}

fn short_hash(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().take(4).map(|b| format!("{b:02x}")).collect()
}

/// Where a copied address is kept, relative to the copy's folder, with `/` separators.
pub fn local_path(url: &Url, kind: Kind) -> String {
    let mut host = url.host_str().unwrap_or("site").to_ascii_lowercase();
    if let Some(port) = url.port() {
        host = format!("{host}_{port}");
    }
    let mut segments: Vec<String> = url
        .path_segments()
        .map(|s| s.map(clean_segment).collect())
        .unwrap_or_default();
    let trailing = url.path().ends_with('/') || segments.is_empty();
    if trailing {
        if let Some(last) = segments.last() {
            if last == "_" {
                segments.pop();
            }
        }
        segments.push(if kind == Kind::Page {
            "index.html".into()
        } else {
            "index".into()
        });
    }
    let last = segments.pop().unwrap_or_else(|| "index.html".into());
    let (mut stem, mut ext) = match last.rfind('.') {
        Some(i) if i > 0 && last.len() - i <= 8 => {
            (last[..i].to_string(), last[i + 1..].to_ascii_lowercase())
        }
        _ => (last.clone(), String::new()),
    };
    if let Some(query) = url.query().filter(|q| !q.is_empty()) {
        stem = format!("{stem}_{}", short_hash(query));
    }
    match kind {
        Kind::Page if !matches!(ext.as_str(), "html" | "htm" | "xhtml") => {
            if !ext.is_empty() {
                stem = format!("{stem}.{ext}");
            }
            ext = "html".into();
        }
        Kind::Style if ext.is_empty() => ext = "css".into(),
        Kind::Script if ext.is_empty() => ext = "js".into(),
        _ => {}
    }
    let file = if ext.is_empty() {
        stem
    } else {
        format!("{stem}.{ext}")
    };
    let mut parts = vec![clean_segment(&host)];
    parts.extend(segments);
    parts.push(file);
    parts.join("/")
}

/// A relative address from one copied file to another, ready to put in HTML or CSS.
pub fn relative(from_file: &str, to_file: &str) -> String {
    let from: Vec<&str> = from_file.split('/').collect();
    let to: Vec<&str> = to_file.split('/').collect();
    let from_dirs = &from[..from.len().saturating_sub(1)];
    let common = from_dirs
        .iter()
        .zip(to.iter())
        .take_while(|(a, b)| a == b)
        .count();
    let mut parts: Vec<String> = vec!["..".into(); from_dirs.len() - common];
    parts.extend(to[common..].iter().map(|s| (*s).to_string()));
    let joined = parts.join("/");
    // Characters that would change the meaning of the address are escaped.
    percent_encoding::utf8_percent_encode(&joined, PATH_SET).to_string()
}

const PATH_SET: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'?')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'`')
    .add(b'{')
    .add(b'}')
    .add(b'\'')
    .add(b'(')
    .add(b')');

/// The address without its fragment, which never changes what is fetched.
fn key(url: &Url) -> String {
    let mut u = url.clone();
    u.set_fragment(None);
    u.to_string()
}

/* ------------------------------------------------------------ scope -- */

pub struct Rules {
    start: Url,
    scope: Scope,
    exclude: Vec<String>,
    disallow: Vec<(String, bool)>,
}

impl Rules {
    fn base_domain(host: &str) -> String {
        let host = host.trim_start_matches("www.");
        host.to_string()
    }

    pub fn in_scope(&self, url: &Url) -> bool {
        if !matches!(url.scheme(), "http" | "https") {
            return false;
        }
        let (Some(host), Some(start)) = (url.host_str(), self.start.host_str()) else {
            return false;
        };
        let text = url.as_str();
        if self
            .exclude
            .iter()
            .any(|e| !e.is_empty() && text.contains(e.as_str()))
        {
            return false;
        }
        match self.scope {
            Scope::Host => {
                host.eq_ignore_ascii_case(start)
                    || (Self::base_domain(host).eq_ignore_ascii_case(&Self::base_domain(start))
                        && (host.starts_with("www.") || start.starts_with("www.")))
            }
            Scope::Domain => {
                let base = Self::base_domain(start).to_ascii_lowercase();
                let h = host.to_ascii_lowercase();
                h == base || h.ends_with(&format!(".{base}"))
            }
            Scope::Folder => {
                let folder = match self.start.path().rfind('/') {
                    Some(i) => &self.start.path()[..=i],
                    None => "/",
                };
                host.eq_ignore_ascii_case(start) && url.path().starts_with(folder)
            }
        }
    }

    /// robots.txt rules for the start host: the longest matching rule wins.
    pub fn allowed(&self, url: &Url) -> bool {
        if url.host_str() != self.start.host_str() {
            return true;
        }
        let path = match url.query() {
            Some(q) => format!("{}?{q}", url.path()),
            None => url.path().to_string(),
        };
        self.disallow
            .iter()
            .filter(|(prefix, _)| path.starts_with(prefix.as_str()))
            .max_by_key(|(prefix, allow)| (prefix.len(), *allow))
            .map_or(true, |(_, allow)| *allow)
    }
}

/// The rules for "User-agent: *" (or a group naming Benchtop) in a robots.txt file.
pub fn parse_robots(text: &str) -> Vec<(String, bool)> {
    let mut rules = Vec::new();
    let mut applies = false;
    let mut in_agents = false;
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or_default().trim();
        let Some((field, value)) = line.split_once(':') else {
            continue;
        };
        let field = field.trim().to_ascii_lowercase();
        let value = value.trim();
        match field.as_str() {
            "user-agent" => {
                if !in_agents {
                    applies = false;
                }
                in_agents = true;
                let agent = value.to_ascii_lowercase();
                if agent == "*" || agent.contains("benchtop") {
                    applies = true;
                }
            }
            "disallow" | "allow" => {
                in_agents = false;
                if applies && !value.is_empty() {
                    rules.push((
                        value
                            .trim_end_matches('*')
                            .trim_end_matches('$')
                            .to_string(),
                        field == "allow",
                    ));
                }
            }
            _ => in_agents = false,
        }
    }
    rules
}

/* ------------------------------------------------------------ rewriting -- */

#[derive(Debug, Clone)]
pub struct Found {
    pub url: Url,
    pub kind: Kind,
}

/// Rewrites url(...) and @import in CSS; returns the new text and the files it needs.
pub fn rewrite_css(
    css: &str,
    base: &Url,
    own_path: &str,
    map: &dyn Fn(&Url, Kind) -> Option<String>,
) -> (String, Vec<Found>) {
    let mut found = Vec::new();
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    loop {
        let next_url = rest.find("url(");
        let next_import = rest.find("@import");
        let Some(at) = [next_url, next_import].into_iter().flatten().min() else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let (reference, consumed, wrap): (String, usize, fn(&str) -> String) =
            if tail.starts_with("url(") {
                let close = tail.find(')').unwrap_or(tail.len().saturating_sub(1));
                let inner = tail[4..close.max(4)].trim();
                let value = inner.trim_matches(|c| c == '"' || c == '\'').to_string();
                (value, close + 1, |s| format!("url('{s}')"))
            } else {
                let after = &tail[7..];
                let trimmed = after.trim_start();
                let skipped = after.len() - trimmed.len();
                if let Some(quote) = trimmed.chars().next().filter(|c| *c == '"' || *c == '\'') {
                    let body = &trimmed[1..];
                    let end = body.find(quote).unwrap_or(body.len());
                    (body[..end].to_string(), 7 + skipped + 1 + end + 1, |s| {
                        format!("@import '{s}'")
                    })
                } else {
                    out.push_str("@import");
                    rest = after;
                    continue;
                }
            };
        let replaced = match base.join(&reference) {
            Ok(target)
                if !reference.starts_with("data:")
                    && !reference.starts_with('#')
                    && !reference.is_empty() =>
            {
                let kind = if tail.starts_with("@import")
                    || reference
                        .split('?')
                        .next()
                        .unwrap_or_default()
                        .ends_with(".css")
                {
                    Kind::Style
                } else {
                    Kind::Asset
                };
                match map(&target, kind) {
                    Some(local) => {
                        found.push(Found { url: target, kind });
                        wrap(&relative(own_path, &local))
                    }
                    None => wrap(target.as_str()),
                }
            }
            _ => tail[..consumed.min(tail.len())].to_string(),
        };
        out.push_str(&replaced);
        rest = &tail[consumed.min(tail.len())..];
    }
    (out, found)
}

/// Rewrites a page's links to local copies; returns the new HTML and what it links to.
pub fn rewrite_html(
    html: &[u8],
    charset: Option<&str>,
    base: &Url,
    own_path: &str,
    map: &dyn Fn(&Url, Kind) -> Option<String>,
) -> Result<(Vec<u8>, Vec<Found>), String> {
    use std::cell::RefCell;
    let found = RefCell::new(Vec::<Found>::new());
    let base = RefCell::new(base.clone());
    let style_buffer = RefCell::new(String::new());
    let link = |raw: &str, kind: Kind| -> Option<String> {
        let raw = raw.trim();
        if raw.is_empty()
            || raw.starts_with('#')
            || raw.starts_with("data:")
            || raw.starts_with("javascript:")
            || raw.starts_with("mailto:")
            || raw.starts_with("tel:")
        {
            return None;
        }
        let target = base.borrow().join(raw).ok()?;
        let fragment = target
            .fragment()
            .map(|f| format!("#{f}"))
            .unwrap_or_default();
        match map(&target, kind) {
            Some(local) => {
                found.borrow_mut().push(Found {
                    url: target.clone(),
                    kind,
                });
                Some(format!("{}{fragment}", relative(own_path, &local)))
            }
            None => Some(target.to_string()),
        }
    };
    let css = |text: &str| -> String {
        let (out, more) = rewrite_css(text, &base.borrow(), own_path, map);
        found.borrow_mut().extend(more);
        out
    };
    let mut output = Vec::with_capacity(html.len() + 1024);
    let encoding = charset
        .and_then(|c| encoding_rs::Encoding::for_label(c.trim().as_bytes()))
        .and_then(lol_html::AsciiCompatibleEncoding::new)
        .unwrap_or_else(lol_html::AsciiCompatibleEncoding::utf_8);
    let mut rewriter = HtmlRewriter::new(
        Settings {
            element_content_handlers: vec![
                element!("base[href]", |el| {
                    if let Some(href) = el.get_attribute("href") {
                        let joined = base.borrow().join(&href).ok();
                        if let Some(joined) = joined {
                            *base.borrow_mut() = joined;
                        }
                    }
                    el.remove();
                    Ok(())
                }),
                element!("a[href], area[href]", |el| {
                    if let Some(new) = el.get_attribute("href").and_then(|v| link(&v, Kind::Page)) {
                        el.set_attribute("href", &new)?;
                    }
                    Ok(())
                }),
                element!("iframe[src], frame[src]", |el| {
                    if let Some(new) = el.get_attribute("src").and_then(|v| link(&v, Kind::Page)) {
                        el.set_attribute("src", &new)?;
                    }
                    Ok(())
                }),
                element!("link[href]", |el| {
                    let rel = el
                        .get_attribute("rel")
                        .unwrap_or_default()
                        .to_ascii_lowercase();
                    let kind = if rel.contains("stylesheet") {
                        Some(Kind::Style)
                    } else if rel.contains("icon")
                        || rel.contains("apple-touch")
                        || rel.contains("manifest")
                        || (rel.contains("preload")
                            && el
                                .get_attribute("as")
                                .is_some_and(|a| a == "image" || a == "font"))
                    {
                        Some(Kind::Asset)
                    } else {
                        None
                    };
                    if let Some(kind) = kind {
                        if let Some(new) = el.get_attribute("href").and_then(|v| link(&v, kind)) {
                            el.set_attribute("href", &new)?;
                        }
                        el.remove_attribute("integrity");
                        el.remove_attribute("crossorigin");
                    }
                    Ok(())
                }),
                element!("script[src]", |el| {
                    if let Some(new) = el.get_attribute("src").and_then(|v| link(&v, Kind::Script))
                    {
                        el.set_attribute("src", &new)?;
                    }
                    el.remove_attribute("integrity");
                    el.remove_attribute("crossorigin");
                    Ok(())
                }),
                element!(
                    "img, source, video, audio, track, embed, input[type=image]",
                    |el| {
                        for attr in ["src", "data-src", "poster"] {
                            if let Some(new) =
                                el.get_attribute(attr).and_then(|v| link(&v, Kind::Asset))
                            {
                                el.set_attribute(attr, &new)?;
                            }
                        }
                        for attr in ["srcset", "data-srcset"] {
                            if let Some(set) = el.get_attribute(attr) {
                                let rewritten: Vec<String> = set
                                    .split(',')
                                    .map(|candidate| {
                                        let candidate = candidate.trim();
                                        let (address, descriptor) = candidate
                                            .split_once(char::is_whitespace)
                                            .unwrap_or((candidate, ""));
                                        let address = link(address, Kind::Asset)
                                            .unwrap_or_else(|| address.to_string());
                                        if descriptor.is_empty() {
                                            address
                                        } else {
                                            format!("{address} {}", descriptor.trim())
                                        }
                                    })
                                    .collect();
                                el.set_attribute(attr, &rewritten.join(", "))?;
                            }
                        }
                        el.remove_attribute("loading");
                        Ok(())
                    }
                ),
                element!("object[data]", |el| {
                    if let Some(new) = el.get_attribute("data").and_then(|v| link(&v, Kind::Asset))
                    {
                        el.set_attribute("data", &new)?;
                    }
                    Ok(())
                }),
                element!("[style]", |el| {
                    if let Some(style) = el.get_attribute("style") {
                        if style.contains("url(") {
                            el.set_attribute("style", &css(&style))?;
                        }
                    }
                    Ok(())
                }),
                // A copied page must not forbid loading its own copied files.
                element!("meta[http-equiv]", |el| {
                    if el
                        .get_attribute("http-equiv")
                        .is_some_and(|v| v.eq_ignore_ascii_case("content-security-policy"))
                    {
                        el.remove();
                    }
                    Ok(())
                }),
                text!("style", |chunk| {
                    style_buffer.borrow_mut().push_str(chunk.as_str());
                    if chunk.last_in_text_node() {
                        let all = std::mem::take(&mut *style_buffer.borrow_mut());
                        chunk.replace(&css(&all), ContentType::Html);
                    } else {
                        chunk.remove();
                    }
                    Ok(())
                }),
            ],
            encoding,
            adjust_charset_on_meta_tag: true,
            ..Settings::new()
        },
        |bytes: &[u8]| output.extend_from_slice(bytes),
    );
    rewriter
        .write(html)
        .map_err(|e| format!("The page could not be read: {e}"))?;
    rewriter
        .end()
        .map_err(|e| format!("The page could not be read: {e}"))?;
    Ok((output, found.into_inner()))
}

/* ------------------------------------------------------------ copying -- */

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub pages: usize,
    pub files: usize,
    pub bytes: u64,
    pub skipped: usize,
    pub failed: Vec<(String, String)>,
    pub start: String,
    pub token: String,
    pub stopped: Option<String>,
}

struct Item {
    url: Url,
    kind: Kind,
    depth: u32,
    path: String,
}

struct Fetched {
    item: Item,
    result: Result<(Vec<u8>, Option<String>, Url), String>,
}

async fn fetch(
    client: &reqwest::Client,
    url: &Url,
) -> Result<(Vec<u8>, Option<String>, Url), String> {
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|e| crate::net::chain_message(&e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    if response.content_length().is_some_and(|n| n > MAX_FILE) {
        return Err("larger than 100 MB, left out".into());
    }
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = response
        .bytes()
        .await
        .map_err(|e| crate::net::chain_message(&e))?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("larger than 100 MB, left out".into());
    }
    Ok((bytes.to_vec(), content_type, final_url))
}

fn charset_of(content_type: Option<&str>) -> Option<String> {
    content_type?.split(';').find_map(|p| {
        p.trim()
            .strip_prefix("charset=")
            .map(|c| c.trim_matches('"').to_string())
    })
}

fn write_file(root: &Path, relative_path: &str, bytes: &[u8]) -> Result<(), String> {
    let path = relative_path
        .split('/')
        .fold(root.to_path_buf(), |p, s| p.join(s));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not make the folder {}: {e}", parent.display()))?;
    }
    std::fs::write(&path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))
}

#[allow(clippy::too_many_lines)]
async fn copy_site(
    report: &(dyn Fn(serde_json::Value) + Sync),
    cancelled: &(dyn Fn() -> bool + Sync),
    options: MirrorOptions,
    root: PathBuf,
) -> Result<Summary, String> {
    let start = crate::webpdf::check_url(&options.url)?;
    crate::net::ensure_crypto_provider();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(45))
        .connect_timeout(Duration::from_secs(15))
        .user_agent(concat!(
            "Benchtop/",
            env!("CARGO_PKG_VERSION"),
            " (website copier; +https://github.com/asrivastava-curatorial-ws/benchtop)"
        ))
        .build()
        .map_err(|e| e.to_string())?;
    let mut rules = Rules {
        start: start.clone(),
        scope: options.scope,
        exclude: options
            .exclude
            .iter()
            .map(|e| e.trim().to_string())
            .filter(|e| !e.is_empty())
            .collect(),
        disallow: Vec::new(),
    };
    if options.robots {
        if let Ok(robots) = start.join("/robots.txt") {
            if let Ok((bytes, _, _)) = fetch(&client, &robots).await {
                rules.disallow = parse_robots(&String::from_utf8_lossy(&bytes));
            }
        }
    }
    let rules = Arc::new(rules);
    let start_path = local_path(&start, Kind::Page);
    let mut summary = Summary {
        start: start_path.clone(),
        ..Summary::default()
    };
    // Every address gets one local path, decided when it is first seen.
    let mut seen: HashMap<String, String> = HashMap::new();
    let mut queue: VecDeque<Item> = VecDeque::new();
    seen.insert(key(&start), start_path.clone());
    queue.push_back(Item {
        url: start.clone(),
        kind: Kind::Page,
        depth: 0,
        path: start_path.clone(),
    });
    let budget = options.max_megabytes.saturating_mul(1024 * 1024);
    let mut running = tokio::task::JoinSet::new();
    let mut pages_queued = 1usize;
    let mut last_report = Instant::now() - Duration::from_secs(1);
    let stopping = AtomicBool::new(false);

    loop {
        if cancelled() {
            summary.stopped = Some("Stopped.".into());
            running.abort_all();
            break;
        }
        while running.len() < WORKERS && !stopping.load(Ordering::Relaxed) {
            let Some(item) = queue.pop_front() else { break };
            let client = client.clone();
            let delay = options.delay_ms.min(10_000);
            running.spawn(async move {
                if delay > 0 {
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                }
                let result = fetch(&client, &item.url).await;
                Fetched { item, result }
            });
        }
        let Some(joined) = running.join_next().await else {
            break;
        };
        let Ok(Fetched { item, result }) = joined else {
            continue;
        };
        let (bytes, content_type, final_url) = match result {
            Ok(ok) => ok,
            Err(error) => {
                if summary.failed.len() < 200 {
                    summary.failed.push((item.url.to_string(), error));
                }
                continue;
            }
        };
        let is_html = content_type
            .as_deref()
            .is_some_and(|t| t.contains("text/html") || t.contains("application/xhtml"));
        let is_css = item.kind == Kind::Style
            || content_type
                .as_deref()
                .is_some_and(|t| t.contains("text/css"));
        let mut discovered: Vec<Found> = Vec::new();
        let rules_ref = rules.clone();
        let depth = item.depth;
        let outside_assets = options.outside_assets;
        let seen_snapshot = &seen;
        // Addresses to copy get a local path; others stay on the web.
        let map = |url: &Url, kind: Kind| -> Option<String> {
            if let Some(known) = seen_snapshot.get(&key(url)) {
                return Some(known.clone());
            }
            let wanted = match kind {
                Kind::Page => {
                    depth < options.depth
                        && rules_ref.in_scope(url)
                        && (!options.robots || rules_ref.allowed(url))
                }
                _ => {
                    matches!(url.scheme(), "http" | "https")
                        && (outside_assets || rules_ref.in_scope(url))
                }
            };
            wanted.then(|| local_path(url, kind))
        };
        let body = if item.kind == Kind::Page && is_html {
            match rewrite_html(
                &bytes,
                charset_of(content_type.as_deref()).as_deref(),
                &final_url,
                &item.path,
                &map,
            ) {
                Ok((html, found)) => {
                    discovered = found;
                    html
                }
                Err(error) => {
                    summary.failed.push((item.url.to_string(), error));
                    bytes
                }
            }
        } else if is_css {
            let text = String::from_utf8_lossy(&bytes);
            let (css, found) = rewrite_css(&text, &final_url, &item.path, &map);
            discovered = found;
            css.into_bytes()
        } else {
            bytes
        };
        if let Err(error) = write_file(&root, &item.path, &body) {
            summary.failed.push((item.url.to_string(), error));
            continue;
        }
        summary.bytes += body.len() as u64;
        if item.kind == Kind::Page && is_html {
            summary.pages += 1;
        } else {
            summary.files += 1;
        }
        for found in discovered {
            let k = key(&found.url);
            if seen.contains_key(&k) {
                continue;
            }
            if found.kind == Kind::Page && pages_queued >= options.max_pages {
                summary.skipped += 1;
                continue;
            }
            if seen.len() >= MAX_FILES {
                summary.skipped += 1;
                continue;
            }
            let path = local_path(&found.url, found.kind);
            seen.insert(k, path.clone());
            if found.kind == Kind::Page {
                pages_queued += 1;
            }
            let item = Item {
                url: found.url,
                kind: found.kind,
                depth: if found.kind == Kind::Page {
                    depth + 1
                } else {
                    depth
                },
                path,
            };
            // Pictures and styles first, so pages are complete early.
            if item.kind == Kind::Page {
                queue.push_back(item);
            } else {
                queue.push_front(item);
            }
        }
        if summary.bytes >= budget && !stopping.load(Ordering::Relaxed) {
            stopping.store(true, Ordering::Relaxed);
            summary.stopped = Some(format!(
                "Stopped at the size limit of {} MB.",
                options.max_megabytes
            ));
            queue.clear();
        }
        if last_report.elapsed() > Duration::from_millis(200) || queue.is_empty() {
            last_report = Instant::now();
            report(
                json!({ "pages": summary.pages, "files": summary.files, "bytes": summary.bytes, "queued": queue.len() + running.len(), "failed": summary.failed.len(), "current": item.url.as_str() }),
            );
        }
    }
    // A page at the top of the folder leads to the copy.
    let index = root.join("index.html");
    if !index.exists() {
        let page = format!(
            "<!DOCTYPE html><meta charset=\"utf-8\"><title>Copy of {host}</title><meta http-equiv=\"refresh\" content=\"0; url={href}\"><p><a href=\"{href}\">Open the copy of {host}</a></p>",
            host = start.host_str().unwrap_or("the site"),
            href = relative("index.html", &start_path)
        );
        let _ = std::fs::write(&index, page);
    }
    Ok(summary)
}

#[tauri::command]
pub async fn mirror_run(
    app: AppHandle,
    id: String,
    options: MirrorOptions,
    state: State<'_, MirrorState>,
    picked: State<'_, PickedFiles>,
) -> Result<Summary, String> {
    let root = picked
        .path(&options.folder)
        .ok_or("Choose the folder for the copy again.")?;
    if !root.is_dir() {
        return Err("The folder for the copy does not exist.".into());
    }
    state
        .cancelled
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    let report = |mut progress: serde_json::Value| {
        progress["id"] = json!(id);
        let _ = app.emit("mirror-progress", progress);
    };
    let cancelled = || {
        state
            .cancelled
            .lock()
            .map(|c| c.contains(&id))
            .unwrap_or(false)
    };
    let mut summary = copy_site(&report, &cancelled, options, root.clone()).await?;
    let start_file = summary
        .start
        .split('/')
        .fold(root.clone(), |p, s| p.join(s));
    summary.token = picked.register(if start_file.exists() {
        start_file
    } else {
        root
    });
    state
        .cancelled
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    Ok(summary)
}

#[tauri::command]
pub fn mirror_cancel(id: String, state: State<'_, MirrorState>) {
    if let Ok(mut cancelled) = state.cancelled.lock() {
        cancelled.insert(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn maps_addresses_to_safe_local_files() {
        assert_eq!(
            local_path(&u("https://Example.org/"), Kind::Page),
            "example.org/index.html"
        );
        assert_eq!(
            local_path(&u("https://example.org/about"), Kind::Page),
            "example.org/about.html"
        );
        assert_eq!(
            local_path(&u("https://example.org/docs/"), Kind::Page),
            "example.org/docs/index.html"
        );
        assert_eq!(
            local_path(&u("https://example.org/a/index.php?id=4"), Kind::Page),
            format!("example.org/a/index_{}.php.html", short_hash("id=4"))
        );
        assert_eq!(
            local_path(&u("https://cdn.example.org/s/app"), Kind::Script),
            "cdn.example.org/s/app.js"
        );
        assert_eq!(
            local_path(&u("http://example.org:8080/img/a%20b.png"), Kind::Asset),
            "example.org_8080/img/a b.png"
        );
        assert_eq!(
            local_path(&u("https://example.org/../../etc/passwd"), Kind::Asset),
            "example.org/etc/passwd"
        );
        assert_eq!(
            local_path(&u("https://example.org/con.txt"), Kind::Asset),
            "example.org/_con.txt"
        );
    }

    #[test]
    fn makes_relative_links() {
        assert_eq!(
            relative("example.org/a/b/index.html", "example.org/img/x.png"),
            "../../img/x.png"
        );
        assert_eq!(
            relative("example.org/index.html", "example.org/about.html"),
            "about.html"
        );
        assert_eq!(
            relative("example.org/index.html", "cdn.net/a b.css"),
            "../cdn.net/a%20b.css"
        );
        assert_eq!(
            relative("index.html", "example.org/index.html"),
            "example.org/index.html"
        );
    }

    #[test]
    fn keeps_to_its_scope_and_robots_txt() {
        let rules = Rules { start: u("https://www.example.org/museum/visit.html"), scope: Scope::Host, exclude: vec!["/private".into()], disallow: parse_robots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /tmp/\nAllow: /tmp/ok\n") };
        assert!(rules.in_scope(&u("https://www.example.org/other")));
        assert!(rules.in_scope(&u("https://example.org/other")));
        assert!(!rules.in_scope(&u("https://shop.example.org/")));
        assert!(!rules.in_scope(&u("https://www.example.org/private/x")));
        assert!(!rules.allowed(&u("https://www.example.org/tmp/a")));
        assert!(rules.allowed(&u("https://www.example.org/tmp/ok.html")));
        assert!(rules.allowed(&u("https://www.example.org/museum/")));
        let domain = Rules {
            scope: Scope::Domain,
            ..rules
        };
        assert!(domain.in_scope(&u("https://shop.example.org/")));
        let folder = Rules {
            start: u("https://example.org/museum/visit.html"),
            scope: Scope::Folder,
            exclude: vec![],
            disallow: vec![],
        };
        assert!(folder.in_scope(&u("https://example.org/museum/halls/1")));
        assert!(!folder.in_scope(&u("https://example.org/shop/")));
    }

    /// A tiny web server with a few pages, for copying.
    async fn serve(files: Vec<(&'static str, &'static str, &'static str)>) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let files = files.clone();
                tokio::spawn(async move {
                    let mut buffer = vec![0u8; 4096];
                    let n = socket.read(&mut buffer).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..n]);
                    let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let found = files.iter().find(|(p, _, _)| *p == path);
                    let response = match found {
                        Some((_, kind, body)) => format!("HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()),
                        None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
                    };
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        address
    }

    #[test]
    fn copies_a_small_site() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let address = serve(vec![
                ("/robots.txt", "text/plain", "User-agent: *\nDisallow: /secret/\n"),
                ("/", "text/html; charset=utf-8", r#"<html><head><link rel=stylesheet href="/s.css"></head><body><a href="/a">A</a> <a href="/secret/x">S</a> <img src="/logo.png"></body></html>"#),
                ("/a", "text/html", r#"<a href="/b">B</a> <a href="/">home</a>"#),
                ("/b", "text/html", r#"<a href="/c">C</a>"#),
                ("/c", "text/html", "deep"),
                ("/s.css", "text/css", "body{background:url(bg.png)}"),
                ("/bg.png", "image/png", "PNG"),
                ("/logo.png", "image/png", "PNG"),
                ("/secret/x", "text/html", "secret"),
            ])
            .await;
            let folder = std::env::temp_dir().join(format!("benchtop-mirror-test-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&folder);
            std::fs::create_dir_all(&folder).unwrap();
            let options = MirrorOptions { url: format!("{address}/"), folder: String::new(), depth: 2, scope: Scope::Host, max_pages: 50, max_megabytes: 10, outside_assets: true, robots: true, delay_ms: 0, exclude: vec![] };
            let summary = copy_site(&|_| {}, &|| false, options, folder.clone()).await.unwrap();
            assert_eq!(summary.failed, Vec::<(String, String)>::new());
            assert_eq!(summary.pages, 3, "{summary:?}");
            assert_eq!(summary.files, 3);
            let host = address.trim_start_matches("http://").replace(':', "_");
            let index = std::fs::read_to_string(folder.join(&host).join("index.html")).unwrap();
            assert!(index.contains(r#"href="a.html""#), "{index}");
            assert!(index.contains("/secret/x"), "robots.txt keeps it on the web: {index}");
            assert!(std::fs::read_to_string(folder.join(&host).join("s.css")).unwrap().contains("url('bg.png')"));
            assert!(folder.join(&host).join("b.html").exists());
            assert!(!folder.join(&host).join("c.html").exists(), "deeper than the limit");
            assert!(folder.join("index.html").exists());
            let _ = std::fs::remove_dir_all(&folder);
        });
    }

    #[test]
    fn rewrites_pages_and_styles() {
        let base = u("https://example.org/museum/index.html");
        let map = |url: &Url, kind: Kind| -> Option<String> {
            (url.host_str() == Some("example.org")).then(|| local_path(url, kind))
        };
        let html = br##"<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'"><link rel="stylesheet" href="/css/site.css" integrity="sha384-x"><style>body{background:url('../img/bg.png')}</style></head>
<body><a href="halls/">Halls</a> <a href="https://other.org/">Away</a> <a href="#top">Top</a>
<img src="img/a.jpg" srcset="img/a.jpg 1x, img/a@2x.jpg 2x" loading="lazy"><div style="background-image:url(/img/c.png)"></div></body></html>"##;
        let (out, found) =
            rewrite_html(html, None, &base, "example.org/museum/index.html", &map).unwrap();
        let out = String::from_utf8(out).unwrap();
        assert!(out.contains(r#"href="halls/index.html""#), "{out}");
        assert!(out.contains(r#"href="https://other.org/""#));
        assert!(out.contains(r##"href="#top""##));
        assert!(out.contains(r#"href="../css/site.css""#));
        assert!(!out.contains("integrity"));
        assert!(!out.contains("Content-Security-Policy"));
        assert!(out.contains("url('../img/bg.png')"), "{out}");
        assert!(out.contains(r#"srcset="img/a.jpg 1x, img/a@2x.jpg 2x""#));
        assert!(out.contains("url('../img/c.png')"), "{out}");
        assert!(!out.contains("loading="));
        let kinds: Vec<(String, Kind)> = found
            .iter()
            .map(|f| (f.url.path().to_string(), f.kind))
            .collect();
        assert!(kinds.contains(&("/museum/halls/".into(), Kind::Page)));
        assert!(kinds.contains(&("/css/site.css".into(), Kind::Style)));
        assert!(kinds.contains(&("/img/bg.png".into(), Kind::Asset)));
        let (css, more) = rewrite_css("@import 'base.css'; a{background:url(data:image/png;base64,AA)} b{background:url( \"/f/x.woff2\" )}", &u("https://example.org/css/site.css"), "example.org/css/site.css", &map);
        assert!(css.contains("@import 'base.css'"), "{css}");
        assert!(css.contains("url(data:image/png;base64,AA)"));
        assert!(css.contains("url('../f/x.woff2')"), "{css}");
        assert_eq!(more.len(), 2);
    }
}
