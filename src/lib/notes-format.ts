/**
 * Benchtop notes and the .bnote file format.
 *
 * A note is a list of blocks: rich text, Markdown, code, checklists, dividers,
 * links (optionally with a PDF snapshot of the page) and files.  Files are
 * copies kept inside the note, so a note stays whole when the originals are
 * moved or deleted.
 *
 * A .bnote file is a ZIP archive (see docs/NOTE-FORMAT.md):
 *   mimetype                     application/vnd.benchtop.note+zip (first, stored)
 *   note.json                    { format, version, note }
 *   files/<sha-256>/<file name>  every attached file, once
 *   index.html                   a readable copy that opens in any browser
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { escapeHtml } from './text';

export const NOTE_MIME = 'application/vnd.benchtop.note+zip';
export const NOTE_FORMAT = 'benchtop-note';
export const NOTE_VERSION = 1;

export interface Attachment {
  /** SHA-256 of the bytes, in hex: the same file attached twice is kept once. */
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export type Block =
  | { readonly id: string; readonly type: 'text'; readonly html: string }
  | { readonly id: string; readonly type: 'markdown'; readonly source: string }
  | { readonly id: string; readonly type: 'code'; readonly source: string; readonly language: string }
  | { readonly id: string; readonly type: 'checklist'; readonly items: readonly { readonly text: string; readonly done: boolean }[] }
  | { readonly id: string; readonly type: 'divider' }
  | { readonly id: string; readonly type: 'link'; readonly url: string; readonly title: string; readonly note: string; readonly snapshot?: string; readonly savedAt?: string }
  | { readonly id: string; readonly type: 'file'; readonly file: string; readonly caption: string; readonly width?: number };

export type BlockType = Block['type'];

export interface Note {
  readonly id: string;
  readonly title: string;
  readonly created: string;
  readonly modified: string;
  readonly pinned: boolean;
  readonly tags: readonly string[];
  readonly blocks: readonly Block[];
  /** Every file the blocks refer to. */
  readonly attachments: readonly Attachment[];
}

export const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export function emptyNote(title = ''): Note {
  const now = new Date().toISOString();
  return { id: newId(), title, created: now, modified: now, pinned: false, tags: [], blocks: [{ id: newId(), type: 'text', html: '' }], attachments: [] };
}

/* --------------------------------------------------------------- kinds -- */

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'model' | 'text' | 'other';

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|toml|ini|log|py|js|ts|tsx|jsx|c|h|cpp|hpp|rs|go|java|kt|sh|bat|ps1|html|css|sql|ino|svg)$/i;
const MODEL_EXT = /\.(stl|obj|ply|glb|gltf|3mf|amf|dae|fbx|wrl|vrml|vtk|vtp|3ds|pcd|xyz|gcode|gco|nc|ngc|tap)$/i;

export function fileKind(a: Pick<Attachment, 'name' | 'type'>): FileKind {
  const t = a.type.toLowerCase();
  if (t === 'application/pdf' || /\.pdf$/i.test(a.name)) return 'pdf';
  if (MODEL_EXT.test(a.name) || t.startsWith('model/')) return 'model';
  if (t === 'image/svg+xml' || /\.svg$/i.test(a.name)) return 'image';
  if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(a.name)) return 'image';
  if (t.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(a.name)) return 'video';
  if (t.startsWith('audio/') || /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|weba)$/i.test(a.name)) return 'audio';
  if (t.startsWith('text/') || TEXT_EXT.test(a.name) || t === 'application/json') return 'text';
  return 'other';
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/opus',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  stl: 'model/stl',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  obj: 'model/obj',
  '3mf': 'model/3mf',
};

/** A MIME type for a file, from its own or from its name. */
export function mimeOf(name: string, given = ''): string {
  if (given && given !== 'application/octet-stream') return given;
  return MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** Keeps a file name safe inside the archive and on any disk. */
export function safeName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const cleaned = [...base].map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch)).join('');
  return cleaned.replace(/^\.+/, '').trim().slice(0, 120) || 'file';
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Ids of the files a list of blocks refers to. */
export function referencedFiles(blocks: readonly Block[]): Set<string> {
  const ids = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'file') ids.add(b.file);
    if (b.type === 'link' && b.snapshot) ids.add(b.snapshot);
  }
  return ids;
}

/** The attachment list cut down to what the blocks still use. */
export function pruneAttachments(note: Note, known: readonly Attachment[] = note.attachments): Attachment[] {
  const used = referencedFiles(note.blocks);
  const seen = new Set<string>();
  return known.filter((a) => used.has(a.id) && !seen.has(a.id) && seen.add(a.id));
}

/* ---------------------------------------------------------------- text -- */

export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote|\/pre)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** All the words in a note, for search and the list's preview line. */
export function noteText(note: Note): string {
  const parts: string[] = [note.title];
  for (const b of note.blocks) {
    if (b.type === 'text') parts.push(htmlToText(b.html));
    else if (b.type === 'markdown' || b.type === 'code') parts.push(b.source);
    else if (b.type === 'checklist') parts.push(b.items.map((i) => i.text).join('\n'));
    else if (b.type === 'link') parts.push(b.title, b.url, b.note);
    else if (b.type === 'file') parts.push(b.caption, note.attachments.find((a) => a.id === b.file)?.name ?? '');
  }
  return parts.filter(Boolean).join('\n');
}

export function noteTitle(note: Note): string {
  if (note.title.trim()) return note.title.trim();
  const first = noteText({ ...note, title: '' })
    .split('\n')
    .find((l) => l.trim());
  return first ? first.trim().slice(0, 80) : 'Untitled note';
}

/* ------------------------------------------------------------- reading -- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

function readBlock(v: unknown): Block | null {
  if (!isObj(v)) return null;
  const id = str(v.id) || newId();
  switch (v.type) {
    case 'text':
      return { id, type: 'text', html: str(v.html) };
    case 'markdown':
      return { id, type: 'markdown', source: str(v.source) };
    case 'code':
      return { id, type: 'code', source: str(v.source), language: str(v.language, 'text') };
    case 'checklist':
      return { id, type: 'checklist', items: Array.isArray(v.items) ? v.items.filter(isObj).map((i) => ({ text: str(i.text), done: i.done === true })) : [] };
    case 'divider':
      return { id, type: 'divider' };
    case 'link':
      return {
        id,
        type: 'link',
        url: str(v.url),
        title: str(v.title),
        note: str(v.note),
        ...(typeof v.snapshot === 'string' ? { snapshot: v.snapshot } : {}),
        ...(typeof v.savedAt === 'string' ? { savedAt: v.savedAt } : {}),
      };
    case 'file':
      return typeof v.file === 'string' ? { id, type: 'file', file: v.file, caption: str(v.caption), ...(typeof v.width === 'number' ? { width: v.width } : {}) } : null;
    default:
      return null;
  }
}

/** A note from stored JSON, with anything unknown or malformed dropped. */
export function readNote(v: unknown): Note {
  if (!isObj(v)) throw new Error('This is not a Benchtop note.');
  const now = new Date().toISOString();
  const attachments = Array.isArray(v.attachments)
    ? v.attachments
        .filter(isObj)
        .flatMap((a) =>
          typeof a.id === 'string' && /^[0-9a-f]{64}$/.test(a.id)
            ? [{ id: a.id, name: safeName(str(a.name, 'file')), type: str(a.type, 'application/octet-stream'), size: typeof a.size === 'number' ? a.size : 0 }]
            : [],
        )
    : [];
  const blocks = Array.isArray(v.blocks) ? v.blocks.map(readBlock).filter((b): b is Block => b !== null) : [];
  return {
    id: str(v.id) || newId(),
    title: str(v.title),
    created: str(v.created, now),
    modified: str(v.modified, now),
    pinned: v.pinned === true,
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : [],
    blocks: blocks.length ? blocks : [{ id: newId(), type: 'text', html: '' }],
    attachments,
  };
}

/* ------------------------------------------------------- .bnote files -- */

export type FileBytes = ReadonlyMap<string, Uint8Array>;

/** Packs a note and its files into a .bnote archive. */
export function packNote(note: Note, files: FileBytes, sanitize: (html: string) => string = (h) => h): Uint8Array {
  const attachments = pruneAttachments(note);
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8(NOTE_MIME), { level: 0 }],
    'note.json': strToU8(JSON.stringify({ format: NOTE_FORMAT, version: NOTE_VERSION, note: { ...note, attachments } }, null, 1)),
  };
  for (const a of attachments) {
    const bytes = files.get(a.id);
    if (!bytes) throw new Error(`The note's copy of ${a.name} is missing.`);
    // Pictures, audio and video are already compressed.
    const stored = /^(image\/(png|jpeg|gif|webp|avif)|video\/|audio\/)/.test(a.type) || /\.(zip|docx|xlsx|pptx|gz|7z)$/i.test(a.name);
    entries[`files/${a.id}/${safeName(a.name)}`] = stored ? [bytes, { level: 0 }] : bytes;
  }
  entries['index.html'] = strToU8(noteHtml({ ...note, attachments }, (a) => `files/${a.id}/${encodeURIComponent(safeName(a.name))}`, sanitize));
  return zipSync(entries as Parameters<typeof zipSync>[0]);
}

/** Reads a .bnote archive: the note and its files.  Files not listed in the note are ignored. */
export function unpackNote(zip: Uint8Array): { note: Note; files: Map<string, Uint8Array> } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new Error('This file is not a Benchtop note (.bnote): it could not be opened as an archive.');
  }
  const manifest = entries['note.json'];
  if (!manifest) throw new Error('This archive has no note.json, so it is not a Benchtop note.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(manifest));
  } catch {
    throw new Error('The note inside this file is damaged (note.json is not valid JSON).');
  }
  if (!isObj(parsed) || parsed.format !== NOTE_FORMAT) throw new Error('This archive is not a Benchtop note.');
  if (typeof parsed.version === 'number' && parsed.version > NOTE_VERSION) throw new Error('This note was made by a newer version of Benchtop. Update Benchtop to open it.');
  const note = readNote(parsed.note);
  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(entries)) {
    const m = /^files\/([0-9a-f]{64})\//.exec(path);
    if (m && note.attachments.some((a) => a.id === m[1])) files.set(m[1] as string, bytes);
  }
  const missing = note.attachments.filter((a) => !files.has(a.id));
  if (missing.length) throw new Error(`The note is missing ${missing.length === 1 ? `its copy of ${missing[0]?.name}` : `${missing.length} of its files`}.`);
  return { note, files };
}

/* ------------------------------------------------------------- export -- */

export const NOTE_CSS = `
body { margin: 0 auto; max-width: 48rem; padding: 2.5rem 1.5rem; font: 16px/1.6 system-ui, "Segoe UI", "Noto Sans", "Noto Sans Devanagari", "Noto Sans Kannada", sans-serif; color: #1f2328; }
h1.note-title { font-size: 2em; margin: 0 0 0.2em; }
.note-meta { color: #59636e; font-size: 0.85em; margin-bottom: 2em; }
img, video { max-width: 100%; }
figure { margin: 1.2em 0; }
figcaption { color: #59636e; font-size: 0.9em; margin-top: 0.3em; }
pre { background: #f6f8fa; padding: 1em; border-radius: 6px; overflow: auto; }
code { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 0.9em; }
blockquote { margin: 1em 0; padding: 0 1em; color: #59636e; border-left: 4px solid #d1d9e0; }
table { border-collapse: collapse; } th, td { border: 1px solid #d1d9e0; padding: 4px 10px; }
.note-link, .note-file { display: block; padding: 0.8em 1em; border: 1px solid #d1d9e0; border-radius: 8px; margin: 1em 0; color: inherit; text-decoration: none; }
.note-link strong { display: block; } .note-link span { color: #0969da; font-size: 0.9em; overflow-wrap: anywhere; }
ul.checklist { list-style: none; padding-left: 0.2em; } ul.checklist li.done { color: #59636e; text-decoration: line-through; }
hr { border: 0; border-top: 1px solid #d1d9e0; margin: 2em 0; }
img.md-math { vertical-align: baseline; max-width: none; }
.md-math-display { display: block; text-align: center; margin: 1em 0; }
@media print { video, audio { display: none; } .note-media-print { display: block !important; } }
`;

/**
 * The note as an HTML page.  `href` gives each file's address (a path inside the
 * archive, or a data: URL for one self-contained file); `renderMarkdown` draws
 * Markdown blocks (plain text without it).
 */
export function noteHtml(note: Note, href: (a: Attachment) => string, sanitize: (html: string) => string = (h) => h, renderMarkdown?: (md: string) => string): string {
  const body: string[] = [];
  for (const b of note.blocks) {
    if (b.type === 'text') body.push(sanitize(b.html));
    else if (b.type === 'markdown') body.push(renderMarkdown ? sanitize(renderMarkdown(b.source)) : `<pre>${escapeHtml(b.source)}</pre>`);
    else if (b.type === 'code') body.push(`<pre><code${b.language && b.language !== 'text' ? ` class="language-${escapeHtml(b.language)}"` : ''}>${escapeHtml(b.source)}</code></pre>`);
    else if (b.type === 'checklist') body.push(`<ul class="checklist">${b.items.map((i) => `<li${i.done ? ' class="done"' : ''}>${i.done ? '☑' : '☐'} ${escapeHtml(i.text)}</li>`).join('')}</ul>`);
    else if (b.type === 'divider') body.push('<hr>');
    else if (b.type === 'link') {
      const snap = b.snapshot ? note.attachments.find((a) => a.id === b.snapshot) : undefined;
      const safeUrl = /^(https?:|mailto:)/i.test(b.url) ? b.url : '#';
      body.push(
        `<a class="note-link" href="${escapeHtml(safeUrl)}"><strong>${escapeHtml(b.title || b.url)}</strong><span>${escapeHtml(b.url)}</span>${b.note ? `<p>${escapeHtml(b.note)}</p>` : ''}</a>${snap ? `<p><a href="${escapeHtml(href(snap))}">Saved copy of the page (PDF${b.savedAt ? `, ${escapeHtml(b.savedAt.slice(0, 10))}` : ''})</a></p>` : ''}`,
      );
    } else if (b.type === 'file') {
      const a = note.attachments.find((x) => x.id === b.file);
      if (!a) continue;
      const src = escapeHtml(href(a));
      const caption = b.caption ? `<figcaption>${escapeHtml(b.caption)}</figcaption>` : '';
      const kind = fileKind(a);
      if (kind === 'image') body.push(`<figure><img src="${src}" alt="${escapeHtml(b.caption || a.name)}"${b.width ? ` style="width:${Math.round(b.width)}%"` : ''}>${caption}</figure>`);
      else if (kind === 'video')
        body.push(
          `<figure><video controls preload="metadata" src="${src}"></video><a class="note-file note-media-print" style="display:none" href="${src}">Video: ${escapeHtml(a.name)}</a>${caption}</figure>`,
        );
      else if (kind === 'audio') body.push(`<figure><audio controls preload="metadata" src="${src}"></audio>${caption}</figure>`);
      else body.push(`<a class="note-file" href="${src}" download="${escapeHtml(safeName(a.name))}">📎 ${escapeHtml(a.name)} <small>(${formatSize(a.size)})</small></a>${caption}`);
    }
  }
  const title = noteTitle(note);
  const meta = `Created ${new Date(note.created).toLocaleString('en-IN')} · changed ${new Date(note.modified).toLocaleString('en-IN')}`;
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="generator" content="Benchtop">\n<title>${escapeHtml(title)}</title>\n<style>${NOTE_CSS}</style>\n</head>\n<body>\n<h1 class="note-title">${escapeHtml(title)}</h1>\n<p class="note-meta">${escapeHtml(meta)}</p>\n${body.join('\n')}\n</body>\n</html>\n`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The note as Markdown, with its files beside it in files/ (a ZIP). */
export function noteMarkdownZip(note: Note, files: FileBytes, htmlToMarkdown: (html: string) => string): Uint8Array {
  const lines: string[] = [`# ${noteTitle(note)}`, ''];
  const path = (a: Attachment) => `files/${a.id.slice(0, 8)}-${safeName(a.name)}`;
  const entries: Record<string, Uint8Array> = {};
  const use = (id: string) => {
    const a = note.attachments.find((x) => x.id === id);
    const bytes = a && files.get(a.id);
    if (a && bytes) entries[path(a)] = bytes;
    return a;
  };
  const link = (p: string) => p.replace(/ /g, '%20');
  for (const b of note.blocks) {
    if (b.type === 'text') lines.push(htmlToMarkdown(b.html), '');
    else if (b.type === 'markdown') lines.push(b.source, '');
    else if (b.type === 'code') lines.push(`\`\`\`${b.language === 'text' ? '' : b.language}`, b.source, '```', '');
    else if (b.type === 'checklist') lines.push(...b.items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`), '');
    else if (b.type === 'divider') lines.push('---', '');
    else if (b.type === 'link') {
      lines.push(`[${b.title || b.url}](${b.url})${b.note ? ` — ${b.note}` : ''}`, '');
      const snap = b.snapshot ? use(b.snapshot) : undefined;
      if (snap) lines.push(`[Saved copy (PDF)](${link(path(snap))})`, '');
    } else if (b.type === 'file') {
      const a = use(b.file);
      if (!a) continue;
      lines.push(fileKind(a) === 'image' ? `![${b.caption || a.name}](${link(path(a))})` : `[${a.name}](${link(path(a))})${b.caption ? ` — ${b.caption}` : ''}`, '');
    }
  }
  entries['note.md'] = strToU8(
    `${lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()}\n`,
  );
  return zipSync(entries);
}
