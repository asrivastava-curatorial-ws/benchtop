//! Offline Search: a full-text index (SQLite FTS5, kept in the app's data folder) of the
//! folders the user chose.
//!
//! Rust walks the folders and reads plain text, code and office documents itself.  PDFs and
//! pictures are handed to the page, where PDF.js and Tesseract are already bundled; it sends
//! their text back.  Only a folder picked in the system's folder dialog can become a root, the
//! page never passes a path, and files are only ever read from inside a root.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, UNIX_EPOCH};

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::files::PickedFiles;

/// Text and code files above this size are listed by name only.
const MAX_TEXT_FILE: i64 = 16 * 1024 * 1024;
/// Office documents (ZIP containers) above this size are listed by name only.
const MAX_ARCHIVE_FILE: i64 = 256 * 1024 * 1024;
/// The most one entry of a ZIP container may unpack to (a guard against decompression bombs).
const MAX_ENTRY: u64 = 64 * 1024 * 1024;
/// The most text kept from one file.
const MAX_TEXT: usize = 8 * 1024 * 1024;
/// PDFs and pictures above this size are not sent to the page.
const MAX_HANDOFF: i64 = 256 * 1024 * 1024;
const CHUNK_BYTES: usize = 12 * 1024;
const CHUNK_LINES: i64 = 200;
/// Row ids of a file's parts are `file * PART_SPAN + part`, so they can be removed as a range.
const PART_SPAN: i64 = 65_536;
const OPEN: char = '\u{1}';
const CLOSE: char = '\u{2}';

/// Folders that hold other people's code or caches, skipped unless hidden files are included.
const SKIPPED_FOLDERS: [&str; 9] = [
    "node_modules",
    "__pycache__",
    ".git",
    ".svn",
    ".hg",
    ".venv",
    ".tox",
    ".gradle",
    ".cache",
];

#[derive(Default)]
pub struct SearchState {
    cancel: Arc<AtomicBool>,
    scanning: Arc<AtomicBool>,
}

fn sql(error: rusqlite::Error) -> String {
    format!("The search index could not be used: {error}")
}

fn db_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("benchtop"))
        .join("search")
        .join("index.sqlite")
}

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(folder) = path.parent() {
        crate::files::create_private_dir(folder)
            .map_err(|e| format!("Could not create {}: {e}", folder.display()))?;
    }
    let db = Connection::open(path).map_err(sql)?;
    db.busy_timeout(Duration::from_secs(15)).map_err(sql)?;
    // WAL lets a search run while the index is being updated.
    db.pragma_update(None, "journal_mode", "WAL").map_err(sql)?;
    db.pragma_update(None, "synchronous", "NORMAL")
        .map_err(sql)?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS roots(
            id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, ocr INTEGER NOT NULL DEFAULT 0,
            hidden INTEGER NOT NULL DEFAULT 0, scanned INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE IF NOT EXISTS files(
            id INTEGER PRIMARY KEY, root INTEGER NOT NULL, rel TEXT NOT NULL, ext TEXT NOT NULL,
            kind TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL,
            status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', UNIQUE(root, rel));
         CREATE INDEX IF NOT EXISTS files_status ON files(status);
         -- Marks (Mn, Mc) are part of a word, so Devanagari and other Indic scripts stay whole.
         CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
            name, body, label UNINDEXED, line UNINDEXED,
            tokenize = \"unicode61 remove_diacritics 2 categories 'L* N* Co Mn Mc'\");",
    )
    .map_err(sql)?;
    Ok(db)
}

/* ------------------------------------------------------------------ kinds -- */

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Text,
    Code,
    Document,
    Spreadsheet,
    Presentation,
    Pdf,
    Picture,
    Book,
    Other,
}

pub const KINDS: [&str; 9] = [
    "text",
    "code",
    "document",
    "spreadsheet",
    "presentation",
    "pdf",
    "picture",
    "book",
    "other",
];

impl Kind {
    pub fn id(self) -> &'static str {
        KINDS[self as usize]
    }
}

pub fn kind_of(ext: &str) -> Kind {
    match ext {
        "txt" | "md" | "markdown" | "rst" | "log" | "json" | "jsonl" | "ndjson" | "yaml"
        | "yml" | "toml" | "ini" | "cfg" | "conf" | "xml" | "tex" | "bib" | "srt" | "vtt"
        | "org" | "adoc" | "text" | "nfo" | "properties" | "env" | "rtf" | "geojson" | "svg" => {
            Kind::Text
        }
        "rs" | "py" | "js" | "mjs" | "cjs" | "ts" | "mts" | "cts" | "tsx" | "jsx" | "c" | "h"
        | "cpp" | "hpp" | "cc" | "hh" | "cxx" | "cs" | "java" | "kt" | "kts" | "go" | "rb"
        | "php" | "sh" | "bash" | "zsh" | "fish" | "ps1" | "bat" | "cmd" | "sql" | "css"
        | "scss" | "sass" | "less" | "lua" | "pl" | "pm" | "r" | "swift" | "m" | "mm" | "dart"
        | "scala" | "hs" | "ex" | "exs" | "erl" | "clj" | "vue" | "svelte" | "gd" | "ino"
        | "vhd" | "vhdl" | "v" | "sv" | "asm" | "s" | "cmake" | "gradle" | "proto" | "graphql"
        | "gql" | "tf" | "nix" | "zig" | "jl" | "f90" | "pas" | "vb" | "groovy" | "ipynb"
        | "gcode" | "scad" | "glsl" | "wgsl" | "shader" | "astro" | "mdx" => Kind::Code,
        "docx" | "docm" | "dotx" | "odt" | "ott" | "html" | "htm" | "xhtml" | "doc" => {
            Kind::Document
        }
        "xlsx" | "xlsm" | "ods" | "csv" | "tsv" | "xls" => Kind::Spreadsheet,
        "pptx" | "ppsx" | "odp" | "ppt" => Kind::Presentation,
        "pdf" => Kind::Pdf,
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "tif" | "tiff" | "gif" => Kind::Picture,
        "epub" => Kind::Book,
        _ => Kind::Other,
    }
}

/* ------------------------------------------------------------- extraction -- */

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Part {
    pub label: String,
    #[serde(default)]
    pub line: i64,
    pub text: String,
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// Text to index, with an optional note (truncated, for example).
    Parts(Vec<Part>, String),
    /// The page reads this file (PDF, or a picture when OCR is on).
    Pending,
    /// Only the name is searchable; the note says why when there is a reason worth telling.
    Name(String),
    Failed(String),
}

/// Control characters would confuse the match markers; tabs and line ends stay.
fn clean(text: &str) -> String {
    text.chars()
        .filter(|&c| c == '\n' || c == '\t' || (c >= ' ' && c != '\u{7f}'))
        .collect()
}

/// Cuts text into parts of about 200 lines, remembering each part's first line number.
pub fn chunk_lines(text: &str, label: &str, numbered: bool) -> Vec<Part> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut first = 1;
    let mut lines = 0;
    let push = |parts: &mut Vec<Part>, current: &mut String, first: i64| {
        if !current.trim().is_empty() {
            parts.push(Part {
                label: label.to_string(),
                line: if numbered { first } else { 0 },
                text: std::mem::take(current),
            });
        } else {
            current.clear();
        }
    };
    for (number, line) in text.lines().enumerate() {
        let number = number as i64 + 1;
        let mut rest = line;
        // One very long line (minified code) is cut on character boundaries.
        while rest.len() > CHUNK_BYTES {
            let mut cut = CHUNK_BYTES;
            while !rest.is_char_boundary(cut) {
                cut -= 1;
            }
            if current.is_empty() {
                first = number;
            }
            current.push_str(&rest[..cut]);
            push(&mut parts, &mut current, first);
            lines = 0;
            rest = &rest[cut..];
        }
        if current.is_empty() {
            first = number;
        }
        current.push_str(rest);
        current.push('\n');
        lines += 1;
        if lines >= CHUNK_LINES || current.len() >= CHUNK_BYTES {
            push(&mut parts, &mut current, first);
            lines = 0;
        }
    }
    push(&mut parts, &mut current, first);
    parts
}

/// Decodes a text file: UTF-8, UTF-16 with a byte-order mark, or (for known text types) Windows-1252.
fn decode(bytes: &[u8], known_text: bool) -> Option<String> {
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        let encoding = if bytes[0] == 0xFF {
            encoding_rs::UTF_16LE
        } else {
            encoding_rs::UTF_16BE
        };
        return Some(encoding.decode(bytes).0.into_owned());
    }
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return None;
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Some(text.trim_start_matches('\u{feff}').to_string()),
        Err(_) if known_text => Some(encoding_rs::WINDOWS_1252.decode(bytes).0.into_owned()),
        Err(_) => None,
    }
}

/* A small XML reader: enough for the well-formed XML inside office documents. */

pub enum Xml<'a> {
    Open(&'a str, &'a str),
    Close(&'a str),
    /// Character data, entities still escaped.
    Text(&'a str),
    /// A CDATA section, taken as it is.
    Raw(&'a str),
}

pub fn xml_events<'a>(xml: &'a str, mut on: impl FnMut(Xml<'a>)) {
    let mut rest = xml;
    while let Some(at) = rest.find('<') {
        if at > 0 {
            on(Xml::Text(&rest[..at]));
        }
        rest = &rest[at..];
        // A '<' that does not begin a tag (as in "a < b") is text.
        if !rest[1..]
            .starts_with(|c: char| c.is_ascii_alphabetic() || matches!(c, '/' | '!' | '?' | '_'))
        {
            on(Xml::Text(&rest[..1]));
            rest = &rest[1..];
            continue;
        }
        if let Some(body) = rest.strip_prefix("<!--") {
            rest = body.find("-->").map_or("", |end| &body[end + 3..]);
        } else if let Some(body) = rest.strip_prefix("<![CDATA[") {
            let end = body.find("]]>").unwrap_or(body.len());
            on(Xml::Raw(&body[..end]));
            rest = body.get(end + 3..).unwrap_or("");
        } else if rest.starts_with("<?") || rest.starts_with("<!") {
            rest = rest.find('>').map_or("", |end| &rest[end + 1..]);
        } else {
            // The end of the tag, not counting a '>' inside a quoted attribute value.
            let mut quote = None;
            let mut end = None;
            for (i, c) in rest.char_indices().skip(1) {
                match (quote, c) {
                    (None, '"' | '\'') => quote = Some(c),
                    (Some(q), c) if c == q => quote = None,
                    (None, '>') => {
                        end = Some(i);
                        break;
                    }
                    _ => {}
                }
            }
            let Some(end) = end else { return };
            let tag = &rest[1..end];
            rest = &rest[end + 1..];
            if let Some(name) = tag.strip_prefix('/') {
                on(Xml::Close(name.trim()));
                continue;
            }
            let closed = tag.ends_with('/');
            let tag = tag.trim_end_matches('/');
            let split = tag.find(char::is_whitespace).unwrap_or(tag.len());
            let (name, attributes) = (&tag[..split], &tag[split..]);
            on(Xml::Open(name, attributes));
            if closed {
                on(Xml::Close(name));
            }
        }
    }
    if !rest.is_empty() {
        on(Xml::Text(rest));
    }
}

pub fn unescape(raw: &str) -> String {
    if !raw.contains('&') {
        return raw.to_string();
    }
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(end) = rest.find(';').filter(|&end| end <= 12) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let known = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .map(|hex| u32::from_str_radix(hex, 16))
                .or_else(|| entity.strip_prefix('#').map(str::parse::<u32>))
                .and_then(Result::ok)
                .and_then(char::from_u32),
        };
        match known {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The value of one attribute in a tag's raw attribute text.
pub fn attribute(raw: &str, name: &str) -> Option<String> {
    let mut rest = raw;
    while let Some(at) = rest.find(name) {
        let before = rest[..at].chars().next_back();
        let after = rest[at + name.len()..].trim_start();
        if before.map_or(true, char::is_whitespace) && after.starts_with('=') {
            let value = after[1..].trim_start();
            let quote = value.chars().next().filter(|c| *c == '"' || *c == '\'')?;
            let value = &value[1..];
            return value.find(quote).map(|end| unescape(&value[..end]));
        }
        rest = &rest[at + name.len()..];
    }
    None
}

/// The part of a tag name after its namespace prefix.
fn local(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

type Zip = zip::ZipArchive<std::fs::File>;

fn zip_text(zip: &mut Zip, name: &str) -> Option<String> {
    let entry = zip.by_name(name).ok()?;
    let mut bytes = Vec::new();
    entry.take(MAX_ENTRY).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Entry names with a prefix and suffix, in natural order (slide2 before slide10).
fn zip_names(zip: &Zip, prefix: &str, suffix: &str) -> Vec<String> {
    let mut names: Vec<String> = zip
        .file_names()
        .filter(|n| {
            n.len() >= prefix.len() + suffix.len() && n.starts_with(prefix) && n.ends_with(suffix)
        })
        .filter(|n| !n[prefix.len()..].contains('/'))
        .map(str::to_string)
        .collect();
    let number = |name: &str| {
        name[prefix.len()..name.len() - suffix.len()]
            .parse::<u32>()
            .unwrap_or(u32::MAX)
    };
    names.sort_by(|a, b| number(a).cmp(&number(b)).then_with(|| a.cmp(b)));
    names
}

/// WordprocessingML and DrawingML: text sits in `t` elements, paragraphs end lines.
fn office_text(xml: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    xml_events(xml, |event| match event {
        Xml::Open(name, _) => match local(name) {
            "t" => inside = true,
            "tab" => out.push('\t'),
            "br" | "cr" => out.push('\n'),
            _ => {}
        },
        Xml::Close(name) => match local(name) {
            "t" => inside = false,
            "p" => out.push('\n'),
            "tc" => out.push('\t'),
            _ => {}
        },
        Xml::Text(text) if inside => out.push_str(&unescape(text)),
        Xml::Raw(text) if inside => out.push_str(text),
        _ => {}
    });
    out
}

fn docx(zip: &mut Zip) -> Vec<Part> {
    let mut text = zip_text(zip, "word/document.xml")
        .map(|xml| office_text(&xml))
        .unwrap_or_default();
    let mut extra: Vec<String> = [
        "word/footnotes.xml",
        "word/endnotes.xml",
        "word/comments.xml",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    extra.extend(zip_names(zip, "word/header", ".xml"));
    extra.extend(zip_names(zip, "word/footer", ".xml"));
    for name in extra {
        if let Some(xml) = zip_text(zip, &name) {
            let more = office_text(&xml);
            if !more.trim().is_empty() {
                text.push('\n');
                text.push_str(&more);
            }
        }
    }
    chunk_lines(&text, "", false)
}

fn pptx(zip: &mut Zip) -> Vec<Part> {
    let mut parts = Vec::new();
    for (index, name) in zip_names(zip, "ppt/slides/slide", ".xml")
        .iter()
        .enumerate()
    {
        if let Some(xml) = zip_text(zip, name) {
            parts.extend(chunk_lines(
                &office_text(&xml),
                &format!("Slide {}", index + 1),
                false,
            ));
        }
    }
    for name in zip_names(zip, "ppt/notesSlides/notesSlide", ".xml") {
        if let Some(xml) = zip_text(zip, &name) {
            parts.extend(chunk_lines(&office_text(&xml), "Speaker notes", false));
        }
    }
    parts
}

fn xlsx(zip: &mut Zip) -> Vec<Part> {
    // Shared strings: one entry per <si>, its text runs joined (phonetic runs left out).
    let mut strings: Vec<String> = Vec::new();
    if let Some(xml) = zip_text(zip, "xl/sharedStrings.xml") {
        let (mut inside, mut phonetic, mut current) = (false, false, String::new());
        xml_events(&xml, |event| match event {
            Xml::Open(name, _) => match local(name) {
                "t" => inside = true,
                "rPh" => phonetic = true,
                "si" => current.clear(),
                _ => {}
            },
            Xml::Close(name) => match local(name) {
                "t" => inside = false,
                "rPh" => phonetic = false,
                "si" => strings.push(std::mem::take(&mut current)),
                _ => {}
            },
            Xml::Text(text) if inside && !phonetic => current.push_str(&unescape(text)),
            Xml::Raw(text) if inside && !phonetic => current.push_str(text),
            _ => {}
        });
    }
    // Sheet names and files, through the workbook's relationships.
    let mut targets: HashMap<String, String> = HashMap::new();
    if let Some(xml) = zip_text(zip, "xl/_rels/workbook.xml.rels") {
        xml_events(&xml, |event| {
            if let Xml::Open(name, attributes) = event {
                if local(name) == "Relationship" {
                    if let (Some(id), Some(target)) =
                        (attribute(attributes, "Id"), attribute(attributes, "Target"))
                    {
                        let target = target.trim_start_matches('/');
                        let path = if target.starts_with("xl/") {
                            target.to_string()
                        } else {
                            format!("xl/{target}")
                        };
                        targets.insert(id, path);
                    }
                }
            }
        });
    }
    let mut sheets: Vec<(String, String)> = Vec::new();
    if let Some(xml) = zip_text(zip, "xl/workbook.xml") {
        xml_events(&xml, |event| {
            if let Xml::Open(name, attributes) = event {
                if local(name) == "sheet" {
                    let title = attribute(attributes, "name").unwrap_or_default();
                    if let Some(path) =
                        attribute(attributes, "r:id").and_then(|id| targets.get(&id))
                    {
                        sheets.push((title, path.clone()));
                    }
                }
            }
        });
    }
    if sheets.is_empty() {
        sheets = zip_names(zip, "xl/worksheets/sheet", ".xml")
            .into_iter()
            .enumerate()
            .map(|(i, path)| (format!("Sheet {}", i + 1), path))
            .collect();
    }
    let mut parts = Vec::new();
    for (title, path) in sheets {
        let Some(xml) = zip_text(zip, &path) else {
            continue;
        };
        let mut out = String::new();
        // What the current cell holds: 's' shared string, 'i' inline string, 'v' a value.
        let (mut cell, mut reading, mut first) = ('v', false, true);
        xml_events(&xml, |event| match event {
            Xml::Open(name, attributes) => match local(name) {
                "row" => first = true,
                "c" => {
                    cell = match attribute(attributes, "t").as_deref() {
                        Some("s") => 's',
                        Some("inlineStr") => 'i',
                        _ => 'v',
                    };
                }
                "v" => reading = true,
                "t" if cell == 'i' => reading = true,
                _ => {}
            },
            Xml::Close(name) => match local(name) {
                "v" | "t" => reading = false,
                "row" => out.push('\n'),
                _ => {}
            },
            Xml::Text(text) if reading => {
                let value = if cell == 's' {
                    text.trim()
                        .parse::<usize>()
                        .ok()
                        .and_then(|i| strings.get(i))
                        .cloned()
                        .unwrap_or_default()
                } else {
                    unescape(text)
                };
                if !value.is_empty() {
                    if !first {
                        out.push('\t');
                    }
                    out.push_str(&value);
                    first = false;
                }
            }
            _ => {}
        });
        parts.extend(chunk_lines(&out, &format!("Sheet “{title}”"), false));
    }
    parts
}

/// OpenDocument text, spreadsheets and presentations: one part per sheet or slide.
fn odf(zip: &mut Zip) -> Vec<Part> {
    let Some(xml) = zip_text(zip, "content.xml") else {
        return Vec::new();
    };
    let mut parts: Vec<(String, String)> = vec![(String::new(), String::new())];
    let (mut body, mut slides) = (false, 0);
    xml_events(&xml, |event| match event {
        Xml::Open(name, attributes) => match name {
            "office:body" => body = true,
            "table:table" => {
                let title = attribute(attributes, "table:name").unwrap_or_default();
                parts.push((format!("Sheet “{title}”"), String::new()));
            }
            "draw:page" => {
                slides += 1;
                parts.push((format!("Slide {slides}"), String::new()));
            }
            "text:tab" => parts.last_mut().expect("a part").1.push('\t'),
            "text:line-break" => parts.last_mut().expect("a part").1.push('\n'),
            "text:s" => parts.last_mut().expect("a part").1.push(' '),
            _ => {}
        },
        Xml::Close(name) => match name {
            "text:p" | "text:h" | "table:table-row" => {
                parts.last_mut().expect("a part").1.push('\n');
            }
            "table:table-cell" => parts.last_mut().expect("a part").1.push('\t'),
            _ => {}
        },
        Xml::Text(text) if body => parts
            .last_mut()
            .expect("a part")
            .1
            .push_str(&unescape(text)),
        Xml::Raw(text) if body => parts.last_mut().expect("a part").1.push_str(text),
        _ => {}
    });
    parts
        .iter()
        .flat_map(|(label, text)| chunk_lines(text, label, false))
        .collect()
}

/// The readable text of an HTML page: no tags, scripts or styles; block elements end lines.
pub fn html_text(html: &str) -> String {
    // Scripts and styles go first: what is inside them is not markup.
    let mut page = html.to_string();
    for element in ["script", "style"] {
        let (open, close) = (format!("<{element}"), format!("</{element}"));
        let mut from = 0;
        loop {
            let lower = page.to_ascii_lowercase();
            let Some(start) = lower[from..].find(&open).map(|i| i + from) else {
                break;
            };
            let end = lower[start..].find(&close).map(|i| i + start);
            let stop = end
                .and_then(|end| lower[end..].find('>').map(|i| end + i + 1))
                .unwrap_or(page.len());
            page.replace_range(start..stop, " ");
            from = start;
        }
    }
    let mut out = String::new();
    let mut skip: Option<String> = None;
    xml_events(&page, |event| match event {
        Xml::Open(name, _) => {
            let name = name.to_ascii_lowercase();
            if skip.is_none() && matches!(name.as_str(), "template" | "noscript") {
                skip = Some(name);
            } else if matches!(
                name.as_str(),
                "br" | "p"
                    | "div"
                    | "li"
                    | "tr"
                    | "h1"
                    | "h2"
                    | "h3"
                    | "h4"
                    | "h5"
                    | "h6"
                    | "section"
                    | "article"
                    | "title"
                    | "table"
                    | "blockquote"
                    | "pre"
            ) {
                out.push('\n');
            } else if matches!(name.as_str(), "td" | "th") {
                out.push('\t');
            }
        }
        Xml::Close(name) => {
            let name = name.to_ascii_lowercase();
            if skip.as_deref() == Some(name.as_str()) {
                skip = None;
            } else if matches!(
                name.as_str(),
                "p" | "div" | "li" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "title"
            ) {
                out.push('\n');
            }
        }
        Xml::Text(text) if skip.is_none() => out.push_str(&unescape(text)),
        Xml::Raw(text) if skip.is_none() => out.push_str(text),
        _ => {}
    });
    // Runs of blank lines and spaces carry nothing.
    let mut tidy = String::with_capacity(out.len());
    for line in out.lines().map(str::trim).filter(|line| !line.is_empty()) {
        tidy.push_str(line);
        tidy.push('\n');
    }
    tidy
}

fn epub(zip: &mut Zip) -> Vec<Part> {
    let names: Vec<String> = zip
        .file_names()
        .filter(|n| {
            let lower = n.to_ascii_lowercase();
            lower.ends_with(".xhtml") || lower.ends_with(".html") || lower.ends_with(".htm")
        })
        .map(str::to_string)
        .collect();
    let mut parts = Vec::new();
    for (index, name) in names.iter().enumerate() {
        if let Some(html) = zip_text(zip, name) {
            parts.extend(chunk_lines(
                &html_text(&html),
                &format!("Section {}", index + 1),
                false,
            ));
        }
    }
    parts
}

/// Keeps a file's text within `MAX_TEXT`, saying so when some had to go.
fn bounded(parts: Vec<Part>) -> Outcome {
    let mut total = 0;
    let mut kept = Vec::new();
    let mut note = String::new();
    for mut part in parts {
        if total + part.text.len() > MAX_TEXT || kept.len() as i64 >= PART_SPAN - 1 {
            note = "Only the first 8 MB of text is searchable.".to_string();
            break;
        }
        part.text = clean(&part.text);
        total += part.text.len();
        kept.push(part);
    }
    if kept.is_empty() && note.is_empty() {
        return Outcome::Name(String::new());
    }
    Outcome::Parts(kept, note)
}

/// Reads what can be searched in one file.
pub fn extract(path: &Path, ext: &str, size: i64, ocr: bool) -> (Kind, Outcome) {
    let kind = kind_of(ext);
    let archive = |read: fn(&mut Zip) -> Vec<Part>| -> Outcome {
        if size > MAX_ARCHIVE_FILE {
            return Outcome::Name("Larger than 256 MB: found by name only.".to_string());
        }
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(e) => return Outcome::Failed(format!("Could not be opened: {e}")),
        };
        match zip::ZipArchive::new(file) {
            Ok(mut zip) => bounded(read(&mut zip)),
            Err(_) => Outcome::Failed(
                "Not a readable document (it may be damaged or password-protected).".to_string(),
            ),
        }
    };
    let text = |known: bool, numbered: bool, html: bool| -> Option<Outcome> {
        if size > MAX_TEXT_FILE {
            return Some(Outcome::Name(
                "Larger than 16 MB: found by name only.".to_string(),
            ));
        }
        if !known {
            // An unknown type is read only if its beginning looks like text.
            let mut head = [0u8; 8192];
            let got = std::fs::File::open(path)
                .and_then(|mut f| f.read(&mut head))
                .ok()?;
            if got == 0
                || head[..got].contains(&0)
                || std::str::from_utf8(&head[..got]).is_err_and(|e| e.error_len().is_some())
            {
                return None;
            }
        }
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) => return Some(Outcome::Failed(format!("Could not be read: {e}"))),
        };
        let decoded = decode(&bytes, known)?;
        let body = if html { html_text(&decoded) } else { decoded };
        Some(bounded(chunk_lines(&body, "", numbered)))
    };
    let outcome = match (kind, ext) {
        (Kind::Pdf, _) if size > MAX_HANDOFF => {
            Outcome::Name("Larger than 256 MB: found by name only.".to_string())
        }
        (Kind::Pdf, _) => Outcome::Pending,
        (Kind::Picture, _) if ocr && size <= MAX_HANDOFF => Outcome::Pending,
        (Kind::Picture, _) => Outcome::Name(String::new()),
        (_, "docx" | "docm" | "dotx") => archive(docx),
        (_, "xlsx" | "xlsm") => archive(xlsx),
        (_, "pptx" | "ppsx") => archive(pptx),
        (_, "odt" | "ott" | "ods" | "odp") => archive(odf),
        (_, "epub") => archive(epub),
        (_, "doc" | "xls" | "ppt") => {
            Outcome::Name("Old binary Office format: found by name only.".to_string())
        }
        (_, "html" | "htm" | "xhtml") => {
            text(true, false, true).unwrap_or(Outcome::Name(String::new()))
        }
        (Kind::Text | Kind::Code | Kind::Spreadsheet, _) => {
            text(true, true, false).unwrap_or(Outcome::Name(String::new()))
        }
        _ => match text(false, true, false) {
            Some(outcome @ Outcome::Parts(..)) => return (Kind::Text, outcome),
            Some(other) => other,
            None => Outcome::Name(String::new()),
        },
    };
    (kind, outcome)
}

/* ---------------------------------------------------------------- roots -- */

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    id: i64,
    path: String,
    ocr: bool,
    hidden: bool,
    scanned: i64,
    files: i64,
    pending: i64,
    failed: i64,
    missing: bool,
}

pub fn roots(db: &Connection) -> Result<Vec<Root>, String> {
    let mut statement = db
        .prepare(
            "SELECT r.id, r.path, r.ocr, r.hidden, r.scanned,
                (SELECT count(*) FROM files f WHERE f.root = r.id),
                (SELECT count(*) FROM files f WHERE f.root = r.id AND f.status = 'pending'),
                (SELECT count(*) FROM files f WHERE f.root = r.id AND f.status = 'failed')
             FROM roots r ORDER BY r.path",
        )
        .map_err(sql)?;
    let rows = statement
        .query_map([], |row| {
            let path: String = row.get(1)?;
            Ok(Root {
                id: row.get(0)?,
                missing: !Path::new(&path).is_dir(),
                path,
                ocr: row.get(2)?,
                hidden: row.get(3)?,
                scanned: row.get(4)?,
                files: row.get(5)?,
                pending: row.get(6)?,
                failed: row.get(7)?,
            })
        })
        .map_err(sql)?;
    rows.collect::<Result<_, _>>().map_err(sql)
}

/// Windows' canonical paths start with `\\?\`; a drive path reads better without it.
fn plain(path: PathBuf) -> PathBuf {
    match path.to_str().and_then(|text| text.strip_prefix(r"\\?\")) {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path,
    }
}

pub fn add_root(db: &Connection, folder: &Path, ocr: bool) -> Result<i64, String> {
    let folder = plain(
        folder
            .canonicalize()
            .map_err(|e| format!("{} cannot be used: {e}", folder.display()))?,
    );
    if !folder.is_dir() {
        return Err(format!("{} is not a folder.", folder.display()));
    }
    for root in roots(db)? {
        let other = Path::new(&root.path);
        if folder.starts_with(other) {
            return Err(format!(
                "This folder is already searched as part of {}.",
                root.path
            ));
        }
        if other.starts_with(&folder) {
            return Err(format!(
                "{} is inside this folder and already searched. Forget it first, then add this one.",
                root.path
            ));
        }
    }
    let text = folder
        .to_str()
        .ok_or("This folder's name cannot be stored.")?;
    db.execute(
        "INSERT INTO roots(path, ocr) VALUES (?1, ?2)",
        params![text, ocr],
    )
    .map_err(sql)?;
    Ok(db.last_insert_rowid())
}

pub fn remove_root(db: &mut Connection, id: i64) -> Result<(), String> {
    let tx = db.transaction().map_err(sql)?;
    tx.execute(
        "DELETE FROM chunks WHERE rowid IN (SELECT c.rowid FROM chunks c JOIN files f ON f.id = (c.rowid >> 16) WHERE f.root = ?1)",
        [id],
    )
    .map_err(sql)?;
    tx.execute("DELETE FROM files WHERE root = ?1", [id])
        .map_err(sql)?;
    tx.execute("DELETE FROM roots WHERE id = ?1", [id])
        .map_err(sql)?;
    tx.commit().map_err(sql)
}

/* ---------------------------------------------------------------- scanning -- */

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub indexed: i64,
    pub pending: i64,
    pub by_name: i64,
    pub unchanged: i64,
    pub removed: i64,
    pub failed: i64,
    pub cancelled: bool,
}

impl Summary {
    fn add(&mut self, other: &Summary) {
        self.indexed += other.indexed;
        self.pending += other.pending;
        self.by_name += other.by_name;
        self.unchanged += other.unchanged;
        self.removed += other.removed;
        self.failed += other.failed;
        self.cancelled |= other.cancelled;
    }
}

fn write_parts(
    tx: &rusqlite::Transaction,
    file: i64,
    name: &str,
    parts: &[Part],
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM chunks WHERE rowid >= ?1 AND rowid < ?2",
        params![file * PART_SPAN, (file + 1) * PART_SPAN],
    )
    .map_err(sql)?;
    let mut insert = tx
        .prepare_cached(
            "INSERT INTO chunks(rowid, name, body, label, line) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(sql)?;
    let name = clean(name);
    if parts.is_empty() {
        insert
            .execute(params![file * PART_SPAN, name, "", "", 0])
            .map_err(sql)?;
    }
    for (index, part) in parts.iter().enumerate().take(PART_SPAN as usize - 1) {
        // The name is searchable once, on the file's first part.
        let shown = if index == 0 { name.as_str() } else { "" };
        insert
            .execute(params![
                file * PART_SPAN + index as i64,
                shown,
                part.text,
                part.label,
                part.line
            ])
            .map_err(sql)?;
    }
    Ok(())
}

struct Found {
    rel: String,
    path: PathBuf,
    size: i64,
    mtime: i64,
}

fn walk(folder: &Path, hidden: bool, cancel: &AtomicBool) -> Vec<Found> {
    let mut found = Vec::new();
    let walker = walkdir::WalkDir::new(folder)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 || hidden {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if name.starts_with('.') {
                return false;
            }
            if entry.file_type().is_dir() {
                if SKIPPED_FOLDERS.contains(&&*name) {
                    return false;
                }
                // A Rust build folder.
                if name == "target" && entry.path().with_file_name("Cargo.toml").is_file() {
                    return false;
                }
            }
            true
        });
    for entry in walker.flatten() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        // Links are not followed: what they point at may be outside the chosen folder.
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(folder) else {
            continue;
        };
        let pieces: Option<Vec<&str>> = relative
            .components()
            .map(|c| match c {
                Component::Normal(piece) => piece.to_str(),
                _ => None,
            })
            .collect();
        let (Some(pieces), Ok(meta)) = (pieces, entry.metadata()) else {
            continue;
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs() as i64);
        found.push(Found {
            rel: pieces.join("/"),
            path: entry.path().to_path_buf(),
            size: meta.len() as i64,
            mtime,
        });
    }
    found
}

pub fn extension(rel: &str) -> String {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && ext.len() <= 10 => ext.to_ascii_lowercase(),
        _ => String::new(),
    }
}

/// Brings one folder's part of the index up to date.
pub fn scan(
    db: &mut Connection,
    root: i64,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(i64, i64, &str),
) -> Result<Summary, String> {
    let (folder, ocr, hidden): (String, bool, bool) = db
        .query_row(
            "SELECT path, ocr, hidden FROM roots WHERE id = ?1",
            [root],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(sql)?
        .ok_or("That folder is no longer in the list.")?;
    let folder = PathBuf::from(folder);
    if !folder.is_dir() {
        return Err(format!(
            "{} cannot be found. If it is on a drive that is not connected, connect it and try again.",
            folder.display()
        ));
    }
    let mut summary = Summary::default();
    // With OCR switched on later, pictures and scanned PDFs seen before are read again.
    if ocr {
        db.execute(
            "UPDATE files SET status = 'pending' WHERE root = ?1 AND ((kind = 'picture' AND status = 'name' AND size <= ?2) OR status = 'partial')",
            params![root, MAX_HANDOFF],
        )
        .map_err(sql)?;
    }
    let mut known: HashMap<String, (i64, i64, i64, String)> = HashMap::new();
    {
        let mut statement = db
            .prepare("SELECT rel, id, size, mtime, status FROM files WHERE root = ?1")
            .map_err(sql)?;
        let rows = statement
            .query_map([root], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    (row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?),
                ))
            })
            .map_err(sql)?;
        for row in rows {
            let (rel, entry) = row.map_err(sql)?;
            known.insert(rel, entry);
        }
    }
    progress(0, 0, "Looking through the folder…");
    let found = walk(&folder, hidden, cancel);
    let total = found.len() as i64;
    let mut last = Instant::now();
    let mut tx = db.transaction().map_err(sql)?;
    let mut in_batch = 0;
    for (index, file) in found.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            summary.cancelled = true;
            break;
        }
        if last.elapsed() > Duration::from_millis(150) {
            progress(index as i64, total, &file.rel);
            last = Instant::now();
        }
        let before = known.remove(&file.rel);
        if let Some((_, size, mtime, status)) = &before {
            if *size == file.size && *mtime == file.mtime {
                if status == "pending" {
                    summary.pending += 1;
                } else {
                    summary.unchanged += 1;
                }
                continue;
            }
        }
        let ext = extension(&file.rel);
        let (kind, outcome) = extract(&file.path, &ext, file.size, ocr);
        let (status, note, parts) = match outcome {
            Outcome::Parts(parts, note) => ("done", note, parts),
            Outcome::Pending => ("pending", String::new(), Vec::new()),
            Outcome::Name(note) => ("name", note, Vec::new()),
            Outcome::Failed(note) => ("failed", note, Vec::new()),
        };
        match status {
            "done" => summary.indexed += 1,
            "pending" => summary.pending += 1,
            "failed" => summary.failed += 1,
            _ => summary.by_name += 1,
        }
        let id = match before {
            Some((id, ..)) => {
                tx.execute(
                    "UPDATE files SET ext = ?2, kind = ?3, size = ?4, mtime = ?5, status = ?6, note = ?7 WHERE id = ?1",
                    params![id, ext, kind.id(), file.size, file.mtime, status, note],
                )
                .map_err(sql)?;
                id
            }
            None => {
                tx.execute(
                    "INSERT INTO files(root, rel, ext, kind, size, mtime, status, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![root, file.rel, ext, kind.id(), file.size, file.mtime, status, note],
                )
                .map_err(sql)?;
                tx.last_insert_rowid()
            }
        };
        write_parts(&tx, id, &file.rel, &parts)?;
        in_batch += 1;
        if in_batch >= 200 {
            tx.commit().map_err(sql)?;
            tx = db.transaction().map_err(sql)?;
            in_batch = 0;
        }
    }
    // Whatever is still in the list was not found in the folder any more.
    if !summary.cancelled {
        for (id, ..) in known.values() {
            tx.execute(
                "DELETE FROM chunks WHERE rowid >= ?1 AND rowid < ?2",
                params![id * PART_SPAN, (id + 1) * PART_SPAN],
            )
            .map_err(sql)?;
            tx.execute("DELETE FROM files WHERE id = ?1", [id])
                .map_err(sql)?;
            summary.removed += 1;
        }
        let now = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        tx.execute(
            "UPDATE roots SET scanned = ?2 WHERE id = ?1",
            params![root, now],
        )
        .map_err(sql)?;
    }
    tx.commit().map_err(sql)?;
    progress(total, total, "");
    Ok(summary)
}

/* ------------------------------------------------- files read by the page -- */

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    id: i64,
    name: String,
    kind: String,
    size: i64,
    ocr: bool,
}

pub fn pending(db: &Connection, limit: i64) -> Result<Vec<Pending>, String> {
    let mut statement = db
        .prepare(
            "SELECT f.id, f.rel, f.kind, f.size, r.ocr FROM files f JOIN roots r ON r.id = f.root
             WHERE f.status = 'pending' ORDER BY f.size, f.rel LIMIT ?1",
        )
        .map_err(sql)?;
    let rows = statement
        .query_map([limit.clamp(1, 500)], |row| {
            Ok(Pending {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                size: row.get(3)?,
                ocr: row.get(4)?,
            })
        })
        .map_err(sql)?;
    rows.collect::<Result<_, _>>().map_err(sql)
}

/// The path of an indexed file, checked to be inside its folder still.
pub fn locate(db: &Connection, id: i64) -> Result<(PathBuf, String), String> {
    let (folder, rel): (String, String) = db
        .query_row(
            "SELECT r.path, f.rel FROM files f JOIN roots r ON r.id = f.root WHERE f.id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(sql)?
        .ok_or("That file is no longer in the index. Update the index and search again.")?;
    let relative = Path::new(&rel);
    if rel.is_empty()
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("That file's path is not usable.".to_string());
    }
    let folder = Path::new(&folder)
        .canonicalize()
        .map_err(|e| format!("{folder} cannot be found: {e}"))?;
    let path = folder
        .join(relative)
        .canonicalize()
        .map_err(|_| format!("{rel} is no longer there. Update the index."))?;
    if !path.starts_with(&folder) || !path.is_file() {
        return Err(format!("{rel} is no longer a file inside its folder."));
    }
    let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
    Ok((path, name))
}

/// Stores the text the page read from a PDF or picture.
pub fn store(
    db: &mut Connection,
    id: i64,
    parts: Vec<Part>,
    status: &str,
    note: &str,
) -> Result<(), String> {
    let status = match status {
        "done" | "partial" | "failed" | "name" => status,
        _ => return Err("Unknown status.".to_string()),
    };
    let rel: String = db
        .query_row(
            "SELECT rel FROM files WHERE id = ?1 AND status = 'pending'",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?
        .ok_or("That file is not waiting to be read.")?;
    let (parts, mut kept_note) = match bounded(parts) {
        Outcome::Parts(parts, note) => (parts, note),
        _ => (Vec::new(), String::new()),
    };
    if !note.is_empty() {
        kept_note = note.chars().take(300).collect();
    }
    let tx = db.transaction().map_err(sql)?;
    tx.execute(
        "UPDATE files SET status = ?2, note = ?3 WHERE id = ?1",
        params![id, status, kept_note],
    )
    .map_err(sql)?;
    write_parts(&tx, id, &rel, &parts)?;
    tx.commit().map_err(sql)
}

/* ---------------------------------------------------------------- queries -- */

#[derive(Debug, Default, PartialEq)]
pub struct Parsed {
    /// The FTS5 expression; empty when the query only has filters.
    pub fts: String,
    pub kinds: Vec<String>,
    pub extensions: Vec<String>,
    pub paths: Vec<String>,
}

fn quote(term: &str) -> String {
    format!("\"{}\"", term.replace('"', "\"\""))
}

/// Turns what was typed into a safe FTS5 expression plus filters.
///
/// Words must all be found; "quoted words" are found together; -word leaves results out;
/// OR between two words accepts either; word* matches a beginning.  `ext:pdf`, `type:code`,
/// `name:report` and `path:2024` narrow the search.
pub fn parse_query(text: &str, as_you_type: bool) -> Parsed {
    let mut tokens: Vec<(bool, bool, String)> = Vec::new(); // (negative, quoted, text)
    let mut chars = text.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
            continue;
        }
        let negative = c == '-';
        if negative {
            chars.next();
        }
        let mut token = String::new();
        let quoted = chars.peek() == Some(&'"');
        if quoted {
            chars.next();
            for c in chars.by_ref() {
                if c == '"' {
                    break;
                }
                token.push(c);
            }
        } else {
            while let Some(&c) = chars.peek() {
                if c.is_whitespace() {
                    break;
                }
                token.push(c);
                chars.next();
            }
        }
        tokens.push((negative, quoted, token));
    }
    let mut parsed = Parsed::default();
    let mut positive: Vec<String> = Vec::new();
    let mut negative: Vec<String> = Vec::new();
    let mut either = false;
    let count = tokens.len();
    let open_end = as_you_type && !text.ends_with(char::is_whitespace);
    for (index, (minus, quoted, token)) in tokens.into_iter().enumerate() {
        if !quoted && !minus && token == "OR" {
            either = !positive.is_empty();
            continue;
        }
        let mut column = "";
        let mut word = token.as_str();
        if !quoted {
            if let Some((key, value)) = token.split_once(':') {
                let value = value.trim_matches('"').to_lowercase();
                match key.to_ascii_lowercase().as_str() {
                    "ext" if !value.is_empty() => {
                        parsed
                            .extensions
                            .push(value.trim_start_matches('.').to_string());
                        continue;
                    }
                    "type" | "kind" if !value.is_empty() => {
                        let kind = value.trim_end_matches('s');
                        let kind = match kind {
                            "image" | "photo" => "picture",
                            "doc" | "word" => "document",
                            "sheet" | "excel" => "spreadsheet",
                            "slide" | "deck" => "presentation",
                            other => other,
                        };
                        if KINDS.contains(&kind) {
                            parsed.kinds.push(kind.to_string());
                        }
                        continue;
                    }
                    "path" | "folder" if !value.is_empty() => {
                        parsed.paths.push(value);
                        continue;
                    }
                    "name" | "file" => {
                        column = "name : ";
                        word = token.split_once(':').map_or("", |(_, v)| v);
                    }
                    _ => {}
                }
            }
        }
        let star = !quoted && word.ends_with('*');
        let word = word.trim_end_matches('*');
        if !word.chars().any(char::is_alphanumeric) {
            continue;
        }
        let prefix = star || (open_end && !quoted && !minus && index + 1 == count);
        let term = format!("{column}{}{}", quote(word), if prefix { "*" } else { "" });
        if minus {
            negative.push(term);
        } else if either && !positive.is_empty() {
            let previous = positive.pop().unwrap_or_default();
            positive.push(format!("({previous} OR {term})"));
            either = false;
        } else {
            positive.push(term);
        }
    }
    if !positive.is_empty() {
        parsed.fts = positive.join(" AND ");
        for term in negative {
            parsed.fts = format!("({}) NOT {term}", parsed.fts);
        }
    }
    parsed
}

/// A short piece of marked text around the first match, and the number of line ends before it.
pub fn snippet(marked: &str, width: usize) -> (String, i64) {
    let at = marked.find(OPEN);
    let lines = at.map_or(0, |at| marked[..at].matches('\n').count() as i64);
    let mut start = 0;
    let mut clipped = false;
    if let Some(at) = at {
        start = marked[..at].rfind('\n').map_or(0, |i| i + 1);
        if at - start > 60 {
            start = at - 60;
            while !marked.is_char_boundary(start) {
                start += 1;
            }
            // Begin at a word rather than in the middle of one.
            if let Some(space) = marked[start..at].find(char::is_whitespace) {
                start += space + 1;
            }
            clipped = true;
        }
    }
    let mut out = String::new();
    if clipped {
        out.push('…');
    }
    let (mut shown, mut open, mut gap, mut cut) = (0, false, true, false);
    for c in marked[start..].chars() {
        if c == OPEN || c == CLOSE {
            open = c == OPEN;
            out.push(c);
            continue;
        }
        if shown >= width && !open {
            cut = true;
            break;
        }
        if c.is_whitespace() {
            if !gap {
                out.push(' ');
                shown += 1;
            }
            gap = true;
        } else {
            out.push(c);
            shown += 1;
            gap = false;
        }
        if shown >= width * 3 {
            cut = true;
            break;
        }
    }
    if open {
        out.push(CLOSE);
    }
    let mut out = out.trim_end().to_string();
    if cut {
        out.push('…');
    }
    (out, lines)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    row: i64,
    file: i64,
    root: i64,
    folder: String,
    rel: String,
    kind: String,
    status: String,
    note: String,
    size: i64,
    mtime: i64,
    label: String,
    line: i64,
    /// The path inside the folder, with match markers.
    name: String,
    snippet: String,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    hits: Vec<Hit>,
    /// Matching places, and the number of files they are in.
    places: i64,
    files: i64,
    /// False when there was nothing to look for.
    searched: bool,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryOptions {
    #[serde(default)]
    kinds: Vec<String>,
    #[serde(default)]
    root: Option<i64>,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    whole_words: bool,
}

fn like(text: &str) -> String {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

pub fn query(db: &Connection, text: &str, options: &QueryOptions) -> Result<Answer, String> {
    let parsed = parse_query(text, !options.whole_words);
    let mut filters = String::new();
    let mut values: Vec<Value> = Vec::new();
    let kinds: Vec<&String> = options
        .kinds
        .iter()
        .chain(parsed.kinds.iter())
        .filter(|k| KINDS.contains(&k.as_str()))
        .collect();
    if !kinds.is_empty() {
        filters.push_str(&format!(
            " AND f.kind IN ({})",
            vec!["?"; kinds.len()].join(", ")
        ));
        values.extend(kinds.iter().map(|k| Value::Text((*k).clone())));
    }
    if !parsed.extensions.is_empty() {
        filters.push_str(&format!(
            " AND f.ext IN ({})",
            vec!["?"; parsed.extensions.len()].join(", ")
        ));
        values.extend(parsed.extensions.iter().map(|e| Value::Text(e.clone())));
    }
    for path in &parsed.paths {
        filters.push_str(" AND lower(f.rel) LIKE ? ESCAPE '\\'");
        values.push(Value::Text(like(path)));
    }
    if let Some(root) = options.root {
        filters.push_str(" AND f.root = ?");
        values.push(Value::Integer(root));
    }
    let limit = options.limit.unwrap_or(120).clamp(1, 500);
    let mut answer = Answer::default();
    if parsed.fts.is_empty() {
        if filters.is_empty() {
            return Ok(answer);
        }
        // Filters alone list the files, newest first.
        answer.searched = true;
        answer.files = db
            .query_row(
                &format!("SELECT count(*) FROM files f WHERE 1 = 1{filters}"),
                params_from_iter(values.iter()),
                |row| row.get(0),
            )
            .map_err(sql)?;
        answer.places = answer.files;
        let mut statement = db
            .prepare(&format!(
                "SELECT f.id, f.root, r.path, f.rel, f.kind, f.status, f.note, f.size, f.mtime
                 FROM files f JOIN roots r ON r.id = f.root WHERE 1 = 1{filters}
                 ORDER BY f.mtime DESC LIMIT {limit}"
            ))
            .map_err(sql)?;
        let rows = statement
            .query_map(params_from_iter(values.iter()), |row| {
                let file: i64 = row.get(0)?;
                let rel: String = row.get(3)?;
                Ok(Hit {
                    row: file * PART_SPAN,
                    file,
                    root: row.get(1)?,
                    folder: row.get(2)?,
                    name: rel.clone(),
                    rel,
                    kind: row.get(4)?,
                    status: row.get(5)?,
                    note: row.get(6)?,
                    size: row.get(7)?,
                    mtime: row.get(8)?,
                    label: String::new(),
                    line: 0,
                    snippet: String::new(),
                })
            })
            .map_err(sql)?;
        answer.hits = rows.collect::<Result<_, _>>().map_err(sql)?;
        return Ok(answer);
    }
    answer.searched = true;
    let mut all = vec![Value::Text(parsed.fts.clone())];
    all.extend(values);
    let understood =
        |error: rusqlite::Error| format!("That search could not be understood: {error}");
    (answer.places, answer.files) = db
        .query_row(
            &format!(
                "SELECT count(*), count(DISTINCT chunks.rowid >> 16) FROM chunks
                 JOIN files f ON f.id = (chunks.rowid >> 16) WHERE chunks MATCH ?{filters}"
            ),
            params_from_iter(all.iter()),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(understood)?;
    let mut statement = db
        .prepare(&format!(
            "SELECT chunks.rowid, f.id, f.root, r.path, f.rel, f.kind, f.status, f.note, f.size, f.mtime,
                    chunks.label, chunks.line,
                    highlight(chunks, 0, char(1), char(2)), highlight(chunks, 1, char(1), char(2))
             FROM chunks JOIN files f ON f.id = (chunks.rowid >> 16) JOIN roots r ON r.id = f.root
             WHERE chunks MATCH ?{filters}
             ORDER BY bm25(chunks, 6.0, 1.0) LIMIT {limit}"
        ))
        .map_err(understood)?;
    let rows = statement
        .query_map(params_from_iter(all.iter()), |row| {
            let rel: String = row.get(4)?;
            let name: String = row.get(12)?;
            let body: String = row.get(13)?;
            let first: i64 = row.get(11)?;
            let (snippet, lines) = snippet(&body, 180);
            Ok(Hit {
                row: row.get(0)?,
                file: row.get(1)?,
                root: row.get(2)?,
                folder: row.get(3)?,
                // Only a file's first part carries the name.
                name: if name.is_empty() { rel.clone() } else { name },
                rel,
                kind: row.get(5)?,
                status: row.get(6)?,
                note: row.get(7)?,
                size: row.get(8)?,
                mtime: row.get(9)?,
                label: row.get(10)?,
                line: if first > 0 && body.contains(OPEN) {
                    first + lines
                } else {
                    0
                },
                snippet,
            })
        })
        .map_err(understood)?;
    answer.hits = rows.collect::<Result<_, _>>().map_err(understood)?;
    Ok(answer)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    label: String,
    line: i64,
    /// The whole part, with match markers.
    text: String,
    /// Parts in this file.
    parts: i64,
    part: i64,
}

/// One part of a file as it was indexed, with the matches of `text` marked.
pub fn preview(
    db: &Connection,
    row: i64,
    text: &str,
    whole_words: bool,
) -> Result<Preview, String> {
    let parsed = parse_query(text, !whole_words);
    let file = row >> 16;
    let parts: i64 = db
        .query_row(
            "SELECT count(*) FROM chunks WHERE rowid >= ?1 AND rowid < ?2",
            params![file * PART_SPAN, (file + 1) * PART_SPAN],
            |r| r.get(0),
        )
        .map_err(sql)?;
    let marked: Option<(String, i64, String)> = if parsed.fts.is_empty() {
        None
    } else {
        db.query_row(
            "SELECT label, line, highlight(chunks, 1, char(1), char(2)) FROM chunks WHERE chunks MATCH ?1 AND rowid = ?2",
            params![parsed.fts, row],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .unwrap_or(None)
    };
    let (label, line, text) = match marked {
        Some(found) => found,
        None => db
            .query_row(
                "SELECT label, line, body FROM chunks WHERE rowid = ?1",
                [row],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(sql)?
            .ok_or("That part is no longer in the index.")?,
    };
    Ok(Preview {
        label,
        line,
        text,
        parts,
        part: row - file * PART_SPAN,
    })
}

/* --------------------------------------------------------------- commands -- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    roots: Vec<Root>,
    files: i64,
    pending: i64,
    bytes: u64,
    scanning: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    root: i64,
    done: i64,
    total: i64,
    file: String,
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("The search stopped unexpectedly: {e}"))?
}

#[tauri::command]
pub async fn search_status(
    app: AppHandle,
    state: State<'_, SearchState>,
) -> Result<Status, String> {
    let path = db_path(&app);
    let scanning = state.scanning.load(Ordering::Relaxed);
    blocking(move || {
        let db = open(&path)?;
        let (files, pending) = db
            .query_row(
                "SELECT count(*), coalesce(sum(status = 'pending'), 0) FROM files",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(sql)?;
        let bytes = ["", "-wal"]
            .iter()
            .filter_map(|suffix| {
                let mut name = path.clone().into_os_string();
                name.push(suffix);
                std::fs::metadata(name).ok()
            })
            .map(|meta| meta.len())
            .sum();
        Ok(Status {
            roots: roots(&db)?,
            files,
            pending,
            bytes,
            scanning,
        })
    })
    .await
}

#[tauri::command]
pub async fn search_add_root(
    app: AppHandle,
    token: String,
    ocr: bool,
    picked: State<'_, PickedFiles>,
) -> Result<i64, String> {
    let folder = picked.path(&token).ok_or("Choose the folder again.")?;
    let path = db_path(&app);
    blocking(move || add_root(&open(&path)?, &folder, ocr)).await
}

#[tauri::command]
pub async fn search_update_root(
    app: AppHandle,
    id: i64,
    ocr: bool,
    hidden: bool,
) -> Result<(), String> {
    let path = db_path(&app);
    blocking(move || {
        open(&path)?
            .execute(
                "UPDATE roots SET ocr = ?2, hidden = ?3 WHERE id = ?1",
                params![id, ocr, hidden],
            )
            .map(|_| ())
            .map_err(sql)
    })
    .await
}

#[tauri::command]
pub async fn search_remove_root(
    app: AppHandle,
    id: i64,
    state: State<'_, SearchState>,
) -> Result<(), String> {
    if state.scanning.load(Ordering::Relaxed) {
        return Err("Wait for the update to finish, or stop it first.".to_string());
    }
    let path = db_path(&app);
    blocking(move || remove_root(&mut open(&path)?, id)).await
}

#[tauri::command]
pub async fn search_scan(
    app: AppHandle,
    root: Option<i64>,
    state: State<'_, SearchState>,
) -> Result<Summary, String> {
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("The index is already being updated.".to_string());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let (cancel, scanning) = (state.cancel.clone(), state.scanning.clone());
    let path = db_path(&app);
    let result = blocking(move || {
        let mut db = open(&path)?;
        let ids: Vec<i64> = match root {
            Some(id) => vec![id],
            None => roots(&db)?
                .iter()
                .filter(|r| !r.missing)
                .map(|r| r.id)
                .collect(),
        };
        let mut total = Summary::default();
        for id in ids {
            let summary = scan(&mut db, id, &cancel, &mut |done, total, file| {
                let _ = app.emit(
                    "search-progress",
                    Progress {
                        root: id,
                        done,
                        total,
                        file: file.to_string(),
                    },
                );
            })?;
            total.add(&summary);
            if total.cancelled {
                break;
            }
        }
        Ok(total)
    })
    .await;
    scanning.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub fn search_cancel(state: State<'_, SearchState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn search_pending(app: AppHandle, limit: i64) -> Result<Vec<Pending>, String> {
    let path = db_path(&app);
    blocking(move || pending(&open(&path)?, limit)).await
}

/// The bytes of an indexed file, for the page to read (PDF text, OCR) or to open in a tool.
#[tauri::command]
pub async fn search_read(app: AppHandle, id: i64) -> Result<tauri::ipc::Response, String> {
    let path = db_path(&app);
    blocking(move || {
        let (file, name) = locate(&open(&path)?, id)?;
        let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        if size > MAX_HANDOFF as u64 {
            return Err(format!(
                "{name} is larger than 256 MB, too large to open here."
            ));
        }
        std::fs::read(&file)
            .map(tauri::ipc::Response::new)
            .map_err(|e| format!("{name} could not be read: {e}"))
    })
    .await
}

#[tauri::command]
pub async fn search_store(
    app: AppHandle,
    id: i64,
    parts: Vec<Part>,
    status: String,
    note: String,
) -> Result<(), String> {
    let path = db_path(&app);
    blocking(move || store(&mut open(&path)?, id, parts, &status, &note)).await
}

#[tauri::command]
pub async fn search_query(
    app: AppHandle,
    text: String,
    options: QueryOptions,
) -> Result<Answer, String> {
    let path = db_path(&app);
    blocking(move || query(&open(&path)?, &text, &options)).await
}

#[tauri::command]
pub async fn search_preview(
    app: AppHandle,
    row: i64,
    text: String,
    whole_words: bool,
) -> Result<Preview, String> {
    let path = db_path(&app);
    blocking(move || preview(&open(&path)?, row, &text, whole_words)).await
}

#[tauri::command]
pub async fn search_reveal(app: AppHandle, id: i64) -> Result<(), String> {
    let path = db_path(&app);
    blocking(move || {
        let (file, _) = locate(&open(&path)?, id)?;
        crate::convert::reveal_path(&file)
    })
    .await
}

/// Forgets every folder and deletes the index.
#[tauri::command]
pub async fn search_clear(app: AppHandle, state: State<'_, SearchState>) -> Result<(), String> {
    if state.scanning.load(Ordering::Relaxed) {
        return Err("Wait for the update to finish, or stop it first.".to_string());
    }
    let path = db_path(&app);
    blocking(move || {
        let db = open(&path)?;
        db.execute_batch("DELETE FROM chunks; DELETE FROM files; DELETE FROM roots; VACUUM;")
            .map_err(sql)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("benchtop-search-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(dir.join("files")).expect("scratch folder");
            Scratch(dir)
        }
        fn files(&self) -> PathBuf {
            self.0.join("files")
        }
        fn write(&self, rel: &str, bytes: &[u8]) {
            let path = self.files().join(rel);
            std::fs::create_dir_all(path.parent().expect("parent")).expect("folders");
            std::fs::write(path, bytes).expect("file");
        }
        fn db(&self) -> Connection {
            open(&self.0.join("index").join("index.sqlite")).expect("index")
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn zipped(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, text) in entries {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .expect("entry");
            writer.write_all(text.as_bytes()).expect("entry text");
        }
        writer.finish().expect("zip").into_inner()
    }

    fn run(db: &mut Connection, root: i64) -> Summary {
        scan(db, root, &AtomicBool::new(false), &mut |_, _, _| {}).expect("scan")
    }

    fn find(db: &Connection, text: &str) -> Vec<String> {
        let mut names: Vec<String> = query(db, text, &QueryOptions::default())
            .expect("query")
            .hits
            .into_iter()
            .map(|hit| hit.rel)
            .collect();
        names.sort();
        names.dedup();
        names
    }

    #[test]
    fn reads_xml_with_entities_cdata_and_quoted_brackets() {
        let mut seen = Vec::new();
        xml_events(
            "<?xml version=\"1.0\"?><a x=\"1 > 0\" y='q'><!-- no --><b/>one &amp; two<![CDATA[<raw>]]></a>tail",
            |event| match event {
                Xml::Open(name, attributes) => seen.push(format!("+{name}[{}]", attributes.trim())),
                Xml::Close(name) => seen.push(format!("-{name}")),
                Xml::Text(text) => seen.push(format!("t:{}", unescape(text))),
                Xml::Raw(text) => seen.push(format!("r:{text}")),
            },
        );
        assert_eq!(
            seen,
            [
                "+a[x=\"1 > 0\" y='q']",
                "+b[]",
                "-b",
                "t:one & two",
                "r:<raw>",
                "-a",
                "t:tail"
            ]
        );
        assert_eq!(
            attribute(" x=\"1 > 0\" y='q' r:id=\"rId3\"", "y").as_deref(),
            Some("q")
        );
        assert_eq!(
            attribute(" x=\"1 > 0\" r:id=\"rId3\"", "r:id").as_deref(),
            Some("rId3")
        );
        assert_eq!(
            attribute(" sheetId=\"4\" id=\"7\"", "id").as_deref(),
            Some("7")
        );
        assert_eq!(unescape("&lt;&#65;&#x42;&unknown; &"), "<AB&unknown; &");
    }

    #[test]
    fn turns_typed_text_into_safe_expressions() {
        let fts = |text: &str| parse_query(text, false).fts;
        assert_eq!(fts("steam engine"), "\"steam\" AND \"engine\"");
        assert_eq!(
            fts("\"steam engine\" -toy"),
            "(\"steam engine\") NOT \"toy\""
        );
        assert_eq!(
            fts("boiler OR turbine pump"),
            "(\"boiler\" OR \"turbine\") AND \"pump\""
        );
        assert_eq!(fts("turb*"), "\"turb\"*");
        assert_eq!(fts("name:label"), "name : \"label\"");
        // Operators and quotes typed by accident cannot break out of a term.
        assert_eq!(fts("a\"b NEAR( c"), "\"a\"\"b\" AND \"NEAR(\" AND \"c\"");
        assert_eq!(fts("-only"), "");
        assert_eq!(fts("*** ---"), "");
        // While typing, the word being typed matches as a beginning.
        assert_eq!(parse_query("steam eng", true).fts, "\"steam\" AND \"eng\"*");
        assert_eq!(parse_query("steam eng ", true).fts, "\"steam\" AND \"eng\"");
        let filters = parse_query("ext:.PDF type:images path:2024 report", false);
        assert_eq!(filters.extensions, ["pdf"]);
        assert_eq!(filters.kinds, ["picture"]);
        assert_eq!(filters.paths, ["2024"]);
        assert_eq!(filters.fts, "\"report\"");
    }

    #[test]
    fn cuts_snippets_around_the_first_match() {
        let (text, lines) = snippet("first line\nsecond \u{1}match\u{2} here\nthird", 40);
        assert_eq!(text, "second \u{1}match\u{2} here third");
        assert_eq!(lines, 1);
        let long = format!(
            "{} \u{1}needle\u{2} {}",
            "word ".repeat(40),
            "tail ".repeat(60)
        );
        let (text, _) = snippet(&long, 60);
        assert!(text.starts_with('…') && text.ends_with('…'), "{text}");
        assert!(text.contains("\u{1}needle\u{2}"));
        assert!(text.chars().count() < 90, "{text}");
        assert_eq!(snippet("no match in here", 8).0, "no match…");
    }

    #[test]
    fn numbers_lines_across_parts() {
        let text: String = (1..=450).map(|n| format!("line {n}\n")).collect();
        let parts = chunk_lines(&text, "", true);
        assert_eq!(
            parts.iter().map(|p| p.line).collect::<Vec<_>>(),
            [1, 201, 401]
        );
        assert!(parts[1].text.starts_with("line 201\n"));
        // A single enormous line is still cut into parts.
        let parts = chunk_lines(&"é".repeat(CHUNK_BYTES), "", true);
        assert!(parts.len() >= 2 && parts.iter().all(|p| p.text.len() <= CHUNK_BYTES + 1));
    }

    #[test]
    fn indexes_a_folder_and_finds_text_in_every_kind_of_file() {
        let scratch = Scratch::new("kinds");
        scratch.write(
            "notes/plan.txt",
            b"Polish the brass on the beam engine before Friday.\nCall the electrician.\n",
        );
        scratch.write(
            "src/main.rs",
            b"fn main() {\n    let flywheel_speed = 42;\n    println!(\"{flywheel_speed}\");\n}\n",
        );
        scratch.write("hindi.md", "# \u{938}\u{902}\u{917}\u{94d}\u{930}\u{939}\u{93e}\u{932}\u{92f}\n\u{935}\u{93f}\u{936}\u{94d}\u{935}\u{947}\u{936}\u{94d}\u{935}\u{930}\u{948}\u{92f}\u{93e} \u{938}\u{902}\u{917}\u{94d}\u{930}\u{939}\u{93e}\u{932}\u{92f} \u{92c}\u{947}\u{902}\u{917}\u{932}\u{941}\u{930}\u{941}\n".as_bytes());
        scratch.write("latin1.txt", b"Caf\xe9 du mus\xe9e\n");
        scratch.write("page.html", b"<html><head><title>Gallery guide</title><style>.x{color:red}</style><script>var hidden = 'cogwheel';</script></head><body><h1>Engine Hall</h1><p>The Corliss &amp; Watt engines.</p></body></html>");
        scratch.write(
            "label.docx",
            &zipped(&[
                ("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>Stephenson&#8217;s </w:t></w:r><w:r><w:t>Rocket locomotive</w:t></w:r></w:p><w:p><w:r><w:instrText>HYPERLINK secretfield</w:instrText><w:t xml:space=\"preserve\">Built 1829</w:t></w:r></w:p></w:body></w:document>"),
                ("word/footnotes.xml", "<w:footnotes><w:footnote><w:p><w:r><w:t>Rainhill trials</w:t></w:r></w:p></w:footnote></w:footnotes>"),
            ]),
        );
        scratch.write(
            "stock.xlsx",
            &zipped(&[
                ("xl/workbook.xml", "<workbook><sheets><sheet name=\"Spares &amp; tools\" sheetId=\"1\" r:id=\"rId7\"/></sheets></workbook>"),
                ("xl/_rels/workbook.xml.rels", "<Relationships><Relationship Id=\"rId7\" Type=\"x\" Target=\"worksheets/sheet3.xml\"/></Relationships>"),
                ("xl/sharedStrings.xml", "<sst><si><t>Gasket</t></si><si><r><t>Fly</t></r><r><t>wheel</t></r><rPh><t>phonetic</t></rPh></si></sst>"),
                ("xl/worksheets/sheet3.xml", "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\"><v>12</v></c></row><row r=\"2\"><c r=\"A2\" t=\"s\"><v>1</v></c><c r=\"B2\" t=\"inlineStr\"><is><t>Shelf C</t></is></c></row></sheetData></worksheet>"),
            ]),
        );
        scratch.write(
            "talk.pptx",
            &zipped(&[
                (
                    "ppt/slides/slide10.xml",
                    "<p:sld><a:p><a:r><a:t>Closing remarks</a:t></a:r></a:p></p:sld>",
                ),
                (
                    "ppt/slides/slide2.xml",
                    "<p:sld><a:p><a:r><a:t>Governor mechanism</a:t></a:r></a:p></p:sld>",
                ),
                (
                    "ppt/notesSlides/notesSlide2.xml",
                    "<p:notes><a:p><a:r><a:t>Mention centrifugal force</a:t></a:r></a:p></p:notes>",
                ),
            ]),
        );
        scratch.write(
            "report.odt",
            &zipped(&[("content.xml", "<office:document-content><office:automatic-styles>styletext</office:automatic-styles><office:body><office:text><text:h>Annual report</text:h><text:p>Visitor numbers<text:tab/>rose</text:p></office:text></office:body></office:document-content>")]),
        );
        scratch.write(
            "book.epub",
            &zipped(&[(
                "OEBPS/ch1.xhtml",
                "<html><body><p>Chapter about turbines</p></body></html>",
            )]),
        );
        scratch.write("scan.pdf", b"%PDF-1.4 not really");
        scratch.write("photo.png", b"\x89PNG\r\n\x1a\n");
        scratch.write("data.bin", b"\x00\x01\x02brass\x00");
        scratch.write("LICENSE", b"Permission is hereby granted, free of charge\n");
        scratch.write(".secret/key.txt", b"brass hidden\n");
        scratch.write("node_modules/pkg/index.js", b"const brass = 1;\n");

        let mut db = scratch.db();
        let root = add_root(&db, &scratch.files(), false).expect("root");
        let summary = run(&mut db, root);
        assert_eq!(
            summary.pending, 1,
            "the PDF waits for the page: {summary:?}"
        );
        assert_eq!(summary.failed, 0, "{summary:?}");
        assert_eq!(
            summary.by_name, 2,
            "the picture and the binary file: {summary:?}"
        );
        assert_eq!(summary.indexed, 11, "{summary:?}");

        assert_eq!(
            find(&db, "brass"),
            ["notes/plan.txt"],
            "hidden, binary and dependency folders are left out"
        );
        assert_eq!(find(&db, "flywheel_speed"), ["src/main.rs"]);
        assert_eq!(find(&db, "flywheel"), ["src/main.rs", "stock.xlsx"]);
        assert_eq!(
            find(
                &db,
                "\u{938}\u{902}\u{917}\u{94d}\u{930}\u{939}\u{93e}\u{932}\u{92f}"
            ),
            ["hindi.md"]
        );
        assert_eq!(
            find(&db, "\u{938}\u{902}\u{917}"),
            ["hindi.md"],
            "a beginning matches while typing"
        );
        assert_eq!(find(&db, "musee"), ["latin1.txt"], "accents are optional");
        assert_eq!(find(&db, "corliss watt"), ["page.html"]);
        assert!(find(&db, "cogwheel").is_empty(), "scripts are not text");
        assert_eq!(find(&db, "\"rocket locomotive\""), ["label.docx"]);
        assert_eq!(find(&db, "rainhill"), ["label.docx"]);
        assert!(
            find(&db, "secretfield").is_empty(),
            "field codes are not text"
        );
        assert_eq!(find(&db, "gasket"), ["stock.xlsx"]);
        assert_eq!(find(&db, "\"shelf c\""), ["stock.xlsx"]);
        assert!(find(&db, "phonetic").is_empty());
        assert_eq!(find(&db, "governor"), ["talk.pptx"]);
        assert_eq!(find(&db, "centrifugal"), ["talk.pptx"]);
        assert_eq!(find(&db, "visitor rose"), ["report.odt"]);
        assert!(find(&db, "styletext").is_empty());
        assert_eq!(find(&db, "turbines"), ["book.epub"]);
        assert_eq!(
            find(&db, "permission granted"),
            ["LICENSE"],
            "text files without an extension"
        );
        // Names are searchable for everything, readable or not.
        assert_eq!(find(&db, "photo"), ["photo.png"]);
        assert_eq!(find(&db, "name:scan"), ["scan.pdf"]);
        assert_eq!(find(&db, "ext:pptx"), ["talk.pptx"]);
        assert_eq!(find(&db, "type:spreadsheet"), ["stock.xlsx"]);
        assert_eq!(find(&db, "path:notes"), ["notes/plan.txt"]);
        assert_eq!(find(&db, "flywheel -speed"), ["stock.xlsx"]);
        assert_eq!(find(&db, "gasket OR governor"), ["stock.xlsx", "talk.pptx"]);
        assert!(find(&db, "").is_empty() && find(&db, "-brass").is_empty());

        let answer = query(&db, "electrician", &QueryOptions::default()).expect("query");
        let hit = &answer.hits[0];
        assert_eq!((answer.files, answer.places, hit.line), (1, 1, 2));
        assert_eq!(hit.snippet, "Call the \u{1}electrician\u{2}.");
        let hit = &query(&db, "governor", &QueryOptions::default())
            .expect("query")
            .hits[0];
        assert_eq!((hit.label.as_str(), hit.line), ("Slide 1", 0));
        let hit = &query(&db, "closing", &QueryOptions::default())
            .expect("query")
            .hits[0];
        assert_eq!(hit.label, "Slide 2", "slides are in natural order");
        let hit = &query(&db, "gasket", &QueryOptions::default())
            .expect("query")
            .hits[0];
        assert_eq!(hit.label, "Sheet “Spares & tools”");
        assert_eq!(hit.snippet, "\u{1}Gasket\u{2} 12 Flywheel Shelf C");
        let shown = preview(&db, hit.row, "gasket", false).expect("preview");
        assert_eq!(shown.text, "\u{1}Gasket\u{2}\t12\nFlywheel\tShelf C\n");
        assert_eq!((shown.parts, shown.part), (1, 0));
        let only = QueryOptions {
            kinds: vec!["code".to_string()],
            ..QueryOptions::default()
        };
        assert_eq!(query(&db, "flywheel", &only).expect("query").files, 1);
    }

    #[test]
    fn keeps_up_with_changes_and_takes_text_from_the_page() {
        let scratch = Scratch::new("changes");
        scratch.write("a.txt", b"alpha\n");
        scratch.write("b.txt", b"bravo\n");
        scratch.write("scan.pdf", b"%PDF");
        scratch.write("sign.png", b"\x89PNG");
        let mut db = scratch.db();
        let root = add_root(&db, &scratch.files(), false).expect("root");
        assert_eq!(run(&mut db, root).indexed, 2);
        let again = run(&mut db, root);
        assert_eq!((again.indexed, again.unchanged, again.pending), (0, 3, 1));

        // A changed file is read again, a deleted one leaves the index.
        scratch.write("a.txt", b"alpha changed to charlie\n");
        std::fs::remove_file(scratch.files().join("b.txt")).expect("remove");
        let third = run(&mut db, root);
        assert_eq!((third.indexed, third.removed), (1, 1));
        assert_eq!(find(&db, "charlie"), ["a.txt"]);
        assert!(find(&db, "bravo").is_empty());

        // The page reads the PDF and hands back its pages.
        let waiting = pending(&db, 10).expect("pending");
        assert_eq!(waiting.len(), 1);
        assert_eq!(waiting[0].name, "scan.pdf");
        let (path, name) = locate(&db, waiting[0].id).expect("locate");
        assert_eq!(name, "scan.pdf");
        assert!(path.ends_with("scan.pdf"));
        let pages = vec![
            Part {
                label: "Page 1".into(),
                line: 0,
                text: "Minutes of the\u{1} meeting".into(),
            },
            Part {
                label: "Page 2".into(),
                line: 0,
                text: "Budget for the planetarium dome".into(),
            },
        ];
        store(&mut db, waiting[0].id, pages.clone(), "partial", "").expect("store");
        let hit = &query(&db, "planetarium", &QueryOptions::default())
            .expect("query")
            .hits[0];
        assert_eq!(
            (hit.rel.as_str(), hit.label.as_str(), hit.status.as_str()),
            ("scan.pdf", "Page 2", "partial")
        );
        assert_eq!(
            find(&db, "minutes meeting"),
            ["scan.pdf"],
            "control characters are dropped"
        );
        assert!(
            store(&mut db, waiting[0].id, pages, "done", "").is_err(),
            "only waiting files accept text"
        );
        assert!(pending(&db, 10).expect("pending").is_empty());

        // With OCR switched on, the picture and the scanned PDF are queued.
        db.execute("UPDATE roots SET ocr = 1 WHERE id = ?1", [root])
            .expect("ocr on");
        assert_eq!(run(&mut db, root).pending, 2);
        let queued: Vec<String> = pending(&db, 10)
            .expect("pending")
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert_eq!(queued, ["scan.pdf", "sign.png"]);

        remove_root(&mut db, root).expect("forget");
        assert!(find(&db, "charlie").is_empty() && roots(&db).expect("roots").is_empty());
        let left: i64 = db
            .query_row("SELECT count(*) FROM chunks", [], |r| r.get(0))
            .expect("count");
        assert_eq!(left, 0);
    }

    #[test]
    fn refuses_folders_inside_each_other_and_paths_that_leave_a_folder() {
        let scratch = Scratch::new("guards");
        scratch.write("inner/deep/file.txt", b"inside\n");
        let db = scratch.db();
        let root = add_root(&db, &scratch.files().join("inner"), false).expect("root");
        assert!(add_root(&db, &scratch.files().join("inner/deep"), false)
            .unwrap_err()
            .contains("already searched as part"));
        assert!(add_root(&db, &scratch.files(), false)
            .unwrap_err()
            .contains("Forget it first"));
        assert!(add_root(&db, &scratch.files().join("missing"), false).is_err());
        // A row that points outside its folder (a tampered index) is not served.
        std::fs::write(scratch.0.join("outside.txt"), b"secret").expect("outside");
        db.execute(
            "INSERT INTO files(root, rel, ext, kind, size, mtime, status) VALUES (?1, '../../outside.txt', 'txt', 'text', 6, 0, 'done')",
            [root],
        )
        .expect("row");
        assert!(locate(&db, db.last_insert_rowid()).is_err());
        assert!(locate(&db, 9999).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_links_out_of_the_folder() {
        let scratch = Scratch::new("links");
        scratch.write("real.txt", b"genuine\n");
        std::fs::write(scratch.0.join("outside.txt"), b"elsewhere\n").expect("outside");
        std::os::unix::fs::symlink(
            scratch.0.join("outside.txt"),
            scratch.files().join("link.txt"),
        )
        .expect("link");
        std::os::unix::fs::symlink(&scratch.0, scratch.files().join("up")).expect("folder link");
        let mut db = scratch.db();
        let root = add_root(&db, &scratch.files(), false).expect("root");
        assert_eq!(run(&mut db, root).indexed, 1);
        assert!(find(&db, "elsewhere").is_empty());
        // Even a row for the link is refused when read.
        db.execute(
            "INSERT INTO files(root, rel, ext, kind, size, mtime, status) VALUES (?1, 'link.txt', 'txt', 'text', 10, 0, 'pending')",
            [root],
        )
        .expect("row");
        assert!(locate(&db, db.last_insert_rowid()).is_err());
    }

    #[test]
    fn survives_damaged_and_oversized_documents() {
        let scratch = Scratch::new("damaged");
        scratch.write("broken.docx", b"this is not a zip");
        scratch.write(
            "empty.xlsx",
            &zipped(&[("xl/workbook.xml", "<workbook><sheets>")]),
        );
        scratch.write("unclosed.html", b"<p>kept text <b unclosed");
        scratch.write("old.doc", b"\xd0\xcf\x11\xe0");
        let mut db = scratch.db();
        let root = add_root(&db, &scratch.files(), false).expect("root");
        let summary = run(&mut db, root);
        assert_eq!((summary.failed, summary.indexed), (1, 1), "{summary:?}");
        assert_eq!(find(&db, "kept"), ["unclosed.html"]);
        assert_eq!(find(&db, "name:broken"), ["broken.docx"]);
        let hit = &query(&db, "name:old", &QueryOptions::default())
            .expect("query")
            .hits[0];
        assert!(hit.note.contains("Old binary Office"));
        // Text beyond the limit is cut off, with a note.
        let huge = vec![
            Part {
                label: String::new(),
                line: 0,
                text: "x".repeat(MAX_TEXT),
            },
            Part {
                label: String::new(),
                line: 0,
                text: "more".into(),
            },
        ];
        match bounded(huge) {
            Outcome::Parts(parts, note) => assert!(parts.len() == 1 && note.contains("8 MB")),
            other => panic!("{other:?}"),
        }
    }
}
