/**
 * E-mail messages (.eml: RFC 5322 with MIME) and saved web pages (.mht,
 * .mhtml) as one self-contained HTML page: the message's headers, its HTML
 * (or plain text) body with its inline pictures, and its attachments.
 * Remote content and scripts are blocked by the page's own security policy.
 */

export interface MimePart {
  /** Header names in lower case; the first of each, unfolded. */
  readonly headers: ReadonlyMap<string, string>;
  /** Media type in lower case, such as text/html. */
  readonly type: string;
  readonly params: Readonly<Record<string, string>>;
  /** The content with its transfer encoding (base64, quoted-printable) undone. */
  readonly body: Uint8Array;
  readonly parts: readonly MimePart[];
}

export interface Attachment {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

export interface Rendered {
  readonly html: string;
  readonly subject: string;
  readonly attachments: readonly Attachment[];
}

/** Bytes as a string of the same length (one character per byte), for finding boundaries. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}

const fromLatin1 = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
  return out;
};

/** Text in a named character set, falling back to UTF-8. */
export function decodeCharset(bytes: Uint8Array, charset = 'utf-8'): string {
  const label = charset.trim().replace(/^"|"$/g, '').toLowerCase() || 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const ENCODED_WORD = /=\?([^?\s]+)\?([QqBb])\?([^?\s]*)\?=/g;

function wordBytes(encoding: string, text: string): Uint8Array {
  if (encoding.toUpperCase() === 'B') return base64(text);
  return fromLatin1(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));
}

/** Header text with RFC 2047 encoded words (=?UTF-8?B?…?=) decoded. */
export function decodeWords(text: string): string {
  // White space between two encoded words is not part of the text.
  const joined = text.replace(/(=\?[^?\s]+\?[QqBb]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[QqBb]\?[^?\s]*\?=)/g, '$1');
  let out = '';
  let last = 0;
  // Neighbouring words in one character set are joined as bytes, so a character split between them survives.
  let run: { charset: string; bytes: number[] } | null = null;
  const flush = () => {
    if (run) out += decodeCharset(Uint8Array.from(run.bytes), run.charset);
    run = null;
  };
  for (const m of joined.matchAll(ENCODED_WORD)) {
    const between = joined.slice(last, m.index);
    if (between) {
      flush();
      out += between;
    }
    const charset = (m[1] ?? 'utf-8').replace(/\*.*$/, '');
    const bytes = wordBytes(m[2] ?? 'Q', m[3] ?? '');
    if (run && (run as { charset: string }).charset.toLowerCase() === charset.toLowerCase()) (run as { bytes: number[] }).bytes.push(...bytes);
    else {
      flush();
      run = { charset, bytes: [...bytes] };
    }
    last = m.index + m[0].length;
  }
  flush();
  return out + joined.slice(last);
}

function base64(text: string): Uint8Array {
  let clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  if (clean.length % 4 === 1) clean = clean.slice(0, -1);
  clean += '='.repeat((4 - (clean.length % 4)) % 4);
  try {
    return fromLatin1(atob(clean));
  } catch {
    return new Uint8Array(0);
  }
}

function decodeTransfer(raw: string, encoding: string): Uint8Array {
  const kind = encoding.trim().toLowerCase();
  if (kind === 'base64') return base64(raw);
  if (kind === 'quoted-printable') return fromLatin1(raw.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));
  return fromLatin1(raw);
}

function splitHead(text: string): { head: string; body: string } {
  const blank = /^\r?\n/.exec(text);
  if (blank) return { head: '', body: text.slice(blank[0].length) };
  const m = /\r?\n\r?\n/.exec(text);
  return m ? { head: text.slice(0, m.index), body: text.slice(m.index + m[0].length) } : { head: text, body: '' };
}

function parseHeaders(head: string): Map<string, string> {
  const map = new Map<string, string>();
  let name = '';
  let value = '';
  const flush = () => {
    if (name && !map.has(name)) map.set(name, value.trim());
  };
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && name) {
      value += ` ${line.trim()}`;
      continue;
    }
    flush();
    const colon = line.indexOf(':');
    name = colon > 0 ? line.slice(0, colon).trim().toLowerCase() : '';
    value = colon > 0 ? line.slice(colon + 1) : '';
  }
  flush();
  return map;
}

/** A header value and its parameters (with RFC 2231 continuations and character sets). */
export function parseParams(header: string): { value: string; params: Record<string, string> } {
  const pieces: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < header.length; i++) {
    const c = header[i] as string;
    if (c === '\\' && quoted) {
      current += c + (header[i + 1] ?? '');
      i++;
    } else if (c === '"') {
      quoted = !quoted;
      current += c;
    } else if (c === ';' && !quoted) {
      pieces.push(current);
      current = '';
    } else current += c;
  }
  pieces.push(current);
  const value = (pieces.shift() ?? '').trim();
  const simple: Record<string, string> = {};
  const extended = new Map<string, { index: number; text: string; encoded: boolean }[]>();
  for (const piece of pieces) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const key = piece.slice(0, eq).trim().toLowerCase();
    let text = piece.slice(eq + 1).trim();
    if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) text = text.slice(1, -1).replace(/\\(.)/g, '$1');
    const m = /^(.+?)\*(?:(\d+)\*?|)$/.exec(key);
    if (m && key.includes('*')) {
      const base = m[1] as string;
      const list = extended.get(base) ?? [];
      list.push({ index: Number(m[2] ?? 0), text, encoded: key.endsWith('*') });
      extended.set(base, list);
    } else simple[key] = decodeWords(text);
  }
  for (const [base, list] of extended) {
    list.sort((a, b) => a.index - b.index);
    let charset = 'utf-8';
    const bytes: number[] = [];
    list.forEach((piece, i) => {
      let text = piece.text;
      if (piece.encoded && i === 0) {
        const parts = text.split("'");
        if (parts.length >= 3) {
          charset = parts[0] || 'utf-8';
          text = parts.slice(2).join("'");
        }
      }
      if (piece.encoded) bytes.push(...fromLatin1(text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))));
      else bytes.push(...new TextEncoder().encode(text));
    });
    simple[base] = decodeCharset(Uint8Array.from(bytes), charset);
  }
  return { value, params: simple };
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function splitMultipart(body: string, boundary: string): string[] {
  const re = new RegExp(`(?:^|\\r?\\n)--${escapeRegex(boundary)}(--)?[ \\t]*(?=\\r?\\n|$)`, 'g');
  const parts: string[] = [];
  let start = -1;
  for (const m of body.matchAll(re)) {
    if (start >= 0) parts.push(body.slice(start, m.index));
    if (m[1]) return parts;
    let next = m.index + m[0].length;
    if (body.startsWith('\r\n', next)) next += 2;
    else if (body[next] === '\n') next += 1;
    start = next;
  }
  if (start >= 0) parts.push(body.slice(start));
  return parts;
}

function parsePart(text: string, depth: number): MimePart {
  const { head, body } = splitHead(text);
  const headers = parseHeaders(head);
  const { value, params } = parseParams(headers.get('content-type') ?? 'text/plain; charset=us-ascii');
  const type = value.toLowerCase() || 'text/plain';
  if (type.startsWith('multipart/') && params.boundary && depth < 24) {
    return { headers, type, params, body: new Uint8Array(0), parts: splitMultipart(body, params.boundary).map((part) => parsePart(part, depth + 1)) };
  }
  return { headers, type, params, body: decodeTransfer(body, headers.get('content-transfer-encoding') ?? '7bit'), parts: [] };
}

/** A whole message (or MHTML page) as a tree of parts. */
export function parseMime(bytes: Uint8Array): MimePart {
  return parsePart(latin1(bytes), 0);
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const textOf = (part: MimePart) => decodeCharset(part.body, part.params.charset ?? 'utf-8');

const dispositionOf = (part: MimePart) => parseParams(part.headers.get('content-disposition') ?? '');

/** The name a part is saved under, if it has one. */
function fileName(part: MimePart): string {
  const d = dispositionOf(part);
  return d.params.filename ?? part.params.name ?? '';
}

/** Parts meant to be saved rather than shown: marked as attachments, or named files shown nowhere else. */
function isAttachment(part: MimePart): boolean {
  const disposition = dispositionOf(part).value.toLowerCase();
  if (part.type === 'message/rfc822' || disposition === 'attachment') return true;
  return disposition !== 'inline' && !!fileName(part) && !part.type.startsWith('text/');
}

const contentId = (part: MimePart) => (part.headers.get('content-id') ?? '').trim().replace(/^<|>$/g, '');

function dataUri(part: MimePart): string {
  let binary = '';
  for (let i = 0; i < part.body.length; i += 0x8000) binary += String.fromCharCode(...part.body.subarray(i, i + 0x8000));
  return `data:${part.type};base64,${btoa(binary)}`;
}

/** Plain text as HTML that keeps its lines, with web links made into links. */
function plainToHtml(text: string): string {
  const escaped = escapeHtml(text.replace(/\r\n/g, '\n'));
  return `<div class="mail-text">${escaped.replace(/\bhttps?:\/\/[^\s<>&"']+[^\s<>&"'.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`)}</div>`;
}

/** The inside of an HTML document's body, with the styles of its head. */
function htmlBody(html: string): string {
  const styles = [...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map((m) => m[0]).join('\n');
  const body = /<body\b[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(html);
  const inner = body ? (body[1] ?? '') : html.replace(/<\/?(?:html|head)\b[^>]*>/gi, '').replace(/<(?:meta|title|base|link)\b[^>]*>(?:[\s\S]*?<\/title>)?/gi, '');
  // Scripts would be blocked anyway; they are taken out so the page reads the same everywhere.
  return `${styles}\n${inner}`.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<(?:iframe|object|embed)\b[\s\S]*?(?:<\/(?:iframe|object)>|>)/gi, '');
}

interface Walk {
  readonly html: string[];
  readonly attachments: MimePart[];
  readonly resources: MimePart[];
}

function render(part: MimePart, walk: Walk): void {
  if (part.type === 'multipart/alternative') {
    const choice =
      [...part.parts].reverse().find((p) => p.type === 'text/html' || p.type === 'multipart/related') ??
      [...part.parts].reverse().find((p) => p.type === 'text/plain') ??
      part.parts[part.parts.length - 1];
    for (const p of part.parts) if (p !== choice) collectResources(p, walk);
    if (choice) render(choice, walk);
    return;
  }
  if (part.type === 'multipart/related') {
    const start = (part.params.start ?? '').replace(/^<|>$/g, '');
    const root = part.parts.find((p) => start && contentId(p) === start) ?? part.parts[0];
    for (const p of part.parts) if (p !== root) collectResources(p, walk);
    if (root) render(root, walk);
    return;
  }
  if (part.type.startsWith('multipart/')) {
    for (const p of part.parts) render(p, walk);
    return;
  }
  if (isAttachment(part)) {
    walk.attachments.push(part);
    if (contentId(part) || part.headers.has('content-location')) walk.resources.push(part);
    return;
  }
  if (part.type === 'text/html') walk.html.push(htmlBody(textOf(part)));
  else if (part.type.startsWith('text/')) walk.html.push(plainToHtml(textOf(part)));
  else if (part.type.startsWith('image/')) {
    walk.resources.push(part);
    walk.html.push(`<p><img src="${dataUri(part)}" alt="${escapeHtml(fileName(part) || 'Picture')}"></p>`);
  } else walk.attachments.push(part);
}

function collectResources(part: MimePart, walk: Walk): void {
  if (part.parts.length) {
    for (const p of part.parts) collectResources(p, walk);
    return;
  }
  // Pictures the HTML refers to are part of it, even when they carry a file name.
  const referable = !!contentId(part) || part.headers.has('content-location');
  if (referable) walk.resources.push(part);
  if (dispositionOf(part).value.toLowerCase() === 'attachment' || (!referable && isAttachment(part))) walk.attachments.push(part);
}

const sizeText = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`);

const STYLE = `
  .mail-head { margin: 0 0 18px; padding: 0 0 12px; border-bottom: 1px solid #c8cdd2; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a1f24; }
  .mail-head h1 { margin: 0 0 8px; font-size: 20px; line-height: 1.3; }
  .mail-head table { border-collapse: collapse; }
  .mail-head th { padding: 1px 12px 1px 0; color: #5a636c; font-weight: 600; text-align: left; vertical-align: top; white-space: nowrap; }
  .mail-head td { padding: 1px 0; overflow-wrap: anywhere; }
  .mail-text { white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .mail-files { margin-top: 24px; padding-top: 12px; border-top: 1px solid #c8cdd2; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .mail-files h2 { margin: 0 0 6px; font-size: 15px; }
  img { max-width: 100%; height: auto; }
`;

/**
 * A message (or saved page) as one HTML page.  Pictures it refers to by Content-ID or
 * Content-Location are put inside the page; attachments are listed, and with
 * `embedAttachments` they can be saved from it (up to 25 MB in all).
 */
export function messageToHtml(bytes: Uint8Array, options: { embedAttachments?: boolean } = {}): Rendered {
  const root = parseMime(bytes);
  const walk: Walk = { html: [], attachments: [], resources: [] };
  render(root, walk);
  let body = walk.html.join('\n<hr>\n');
  // Pictures and other parts the HTML refers to: cid: links and (in saved pages) their addresses.
  const cids = new Map<string, string>();
  const locations = new Map<string, string>();
  for (const part of walk.resources) {
    const uri = dataUri(part);
    const id = contentId(part);
    if (id) cids.set(id.toLowerCase(), uri);
    const location = part.headers.get('content-location');
    if (location) locations.set(location.trim(), uri);
  }
  body = body.replace(/cid:([^"'\s)>]+)/gi, (whole, id: string) => {
    let key = id;
    try {
      key = decodeURIComponent(id);
    } catch {
      // Keep it as written.
    }
    return cids.get(key.toLowerCase()) ?? whole;
  });
  for (const [location, uri] of locations) {
    for (const quote of ['"', "'"]) body = body.split(`${quote}${location}${quote}`).join(`${quote}${uri}${quote}`);
    body = body.split(`url(${location})`).join(`url(${uri})`);
  }
  const header = (name: string) => decodeWords(root.headers.get(name) ?? '');
  const subject = header('subject');
  const savedPage = root.headers.has('snapshot-content-location') || (root.type === 'multipart/related' && !root.headers.has('from'));
  const rows = (['from', 'to', 'cc', 'date'] as const)
    .map((name) => [name, header(name)] as const)
    .filter(([, value]) => value)
    .map(([name, value]) => `<tr><th>${{ from: 'From', to: 'To', cc: 'Cc', date: 'Date' }[name]}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  const attachments: Attachment[] = walk.attachments.map((part, i) => {
    const inner = part.type === 'message/rfc822' ? decodeWords(parseHeaders(splitHead(latin1(part.body)).head).get('subject') ?? '') : '';
    const name = fileName(part) || (inner ? `${inner}.eml` : `attachment-${i + 1}${part.type === 'message/rfc822' ? '.eml' : ''}`);
    return { name, type: part.type, bytes: part.body };
  });
  let embedded = 0;
  const files = attachments
    .map((a, i) => {
      const part = walk.attachments[i] as MimePart;
      const label = `${escapeHtml(a.name)} <span>(${escapeHtml(a.type)}, ${sizeText(a.bytes.length)})</span>`;
      if (options.embedAttachments && embedded + a.bytes.length <= 25e6) {
        embedded += a.bytes.length;
        return `<li><a download="${escapeHtml(a.name)}" href="${dataUri(part)}">${label}</a></li>`;
      }
      return `<li>${label}</li>`;
    })
    .join('');
  const policy = "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline' data:; font-src data:";
  const html = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(subject || 'Message')}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    savedPage ? '' : `<header class="mail-head"><h1>${escapeHtml(subject || '(no subject)')}</h1><table>${rows}</table></header>`,
    `<main class="mail-body">\n${body}\n</main>`,
    files ? `<footer class="mail-files"><h2>Attachments</h2><ul>${files}</ul></footer>` : '',
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return { html, subject, attachments };
}
