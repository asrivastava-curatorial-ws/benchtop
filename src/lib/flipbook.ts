/**
 * Flipbooks: pages from PDFs, pictures or blank pages, with hotspots,
 * contents and settings.  A project is kept in a .flipbook file (a ZIP with
 * book.json beside the pictures and media) and exported as one HTML file that
 * works offline, with the reader (flipbook-runtime.js) and StPageFlip inside.
 */
import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from 'fflate';
import type { FlipAction, FlipBookData } from './flipbook-runtime';

export interface Asset {
  readonly name: string;
  /** MIME type, such as image/jpeg or video/mp4. */
  readonly type: string;
  readonly bytes: Uint8Array;
}

export interface Hotspot {
  readonly id: string;
  /** Place and size as fractions of the page. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly label: string;
  /** Video and sound name an asset in `media`. */
  readonly action: FlipAction;
}

export interface BookPage {
  readonly id: string;
  /** Asset of the page's picture; null for a blank page. */
  readonly image: string | null;
  /** Colour of a blank page (and behind a picture that does not fill the page). */
  readonly color: string;
  /** Words on the page, for search (from a PDF's text). */
  readonly text: string;
  readonly hotspots: readonly Hotspot[];
}

export interface BookSettings {
  readonly spread: 'double' | 'single';
  readonly rtl: boolean;
  readonly hardCovers: boolean;
  readonly cover: boolean;
  readonly background: string;
  /** Asset shown behind the book, or null. */
  readonly backgroundImage: string | null;
  readonly sound: boolean;
  readonly autoFlip: number;
  readonly idleReset: number;
  readonly flipTime: number;
  readonly pageNumbers: boolean;
}

export interface ContentsEntry {
  readonly title: string;
  readonly page: number;
}

export interface Book {
  readonly title: string;
  /** Page size in pixels; only the proportion matters. */
  readonly width: number;
  readonly height: number;
  readonly pages: readonly BookPage[];
  readonly contents: readonly ContentsEntry[];
  readonly settings: BookSettings;
  readonly assets: Readonly<Record<string, Asset>>;
}

export const DEFAULT_SETTINGS: BookSettings = {
  spread: 'double',
  rtl: false,
  hardCovers: true,
  cover: true,
  background: '#2b3036',
  backgroundImage: null,
  sound: true,
  autoFlip: 0,
  idleReset: 0,
  flipTime: 800,
  pageNumbers: false,
};

export const emptyBook = (): Book => ({ title: 'Untitled flipbook', width: 595, height: 842, pages: [], contents: [], settings: DEFAULT_SETTINGS, assets: {} });

let counter = 0;
/** A fresh id of letters and digits (also used as the asset's file name inside the project). */
export const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1e8).toString(36)}`;

export const blankPage = (color = '#ffffff'): BookPage => ({ id: newId('p'), image: null, color, text: '', hotspots: [] });

const FORMAT = 'benchtop-flipbook';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const MIME = /^(image|video|audio)\/[A-Za-z0-9.+-]{1,60}$/;
/** Links a hotspot may open: web pages and e-mail. */
const SAFE_LINK = /^(https?:\/\/|mailto:)[^\s<>"]+$/i;

/** Whether a hotspot may open this link (web pages and e-mail only). */
export const isSafeLink = (url: string): boolean => SAFE_LINK.test(url.trim());
const LIMITS = { pages: 2000, hotspots: 100, contents: 500, text: 200_000, note: 20_000, label: 200 };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const number = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const colour = (v: unknown, fallback: string) => (typeof v === 'string' && COLOUR.test(v) ? v.toLowerCase() : fallback);

function action(v: unknown, assets: Readonly<Record<string, Asset>>, pages: number): FlipAction | null {
  if (!isObject(v)) return null;
  switch (v.kind) {
    case 'link': {
      const url = text(v.url, 2000).trim();
      return SAFE_LINK.test(url) ? { kind: 'link', url } : null;
    }
    case 'page':
      return { kind: 'page', page: Math.round(number(v.page, 1, 1, Math.max(1, pages))) };
    case 'video':
    case 'audio': {
      const media = text(v.media, 64);
      const asset = assets[media];
      if (!asset?.type.startsWith(v.kind === 'video' ? 'video/' : 'audio/')) return null;
      return { kind: v.kind, media, title: text(v.title, LIMITS.label) };
    }
    case 'note':
      return { kind: 'note', title: text(v.title, LIMITS.label), text: text(v.text, LIMITS.note) };
    default:
      return null;
  }
}

/** A book from anything read from a project file: checked, limited and with defaults filled in. */
export function normaliseBook(raw: unknown, assets: Readonly<Record<string, Asset>>): Book {
  const v = isObject(raw) ? raw : {};
  const pageList = Array.isArray(v.pages) ? v.pages.slice(0, LIMITS.pages) : [];
  const s = isObject(v.settings) ? v.settings : {};
  const pages: BookPage[] = pageList.map((p) => {
    const page = isObject(p) ? p : {};
    const image = typeof page.image === 'string' && assets[page.image]?.type.startsWith('image/') ? page.image : null;
    const hotspots = (Array.isArray(page.hotspots) ? page.hotspots.slice(0, LIMITS.hotspots) : []).flatMap((h): Hotspot[] => {
      if (!isObject(h)) return [];
      const made = action(h.action, assets, pageList.length);
      if (!made) return [];
      const x = number(h.x, 0, 0, 1);
      const y = number(h.y, 0, 0, 1);
      const w = number(h.w, 0.1, 0.005, 1 - x);
      const hh = number(h.h, 0.1, 0.005, 1 - y);
      if (w <= 0 || hh <= 0) return [];
      return [{ id: typeof h.id === 'string' && ID.test(h.id) ? h.id : newId('h'), x, y, w, h: hh, label: text(h.label, LIMITS.label), action: made }];
    });
    return {
      id: typeof page.id === 'string' && ID.test(page.id) ? page.id : newId('p'),
      image,
      color: colour(page.color, '#ffffff'),
      text: text(page.text, LIMITS.text),
      hotspots,
    };
  });
  const contents = (Array.isArray(v.contents) ? v.contents.slice(0, LIMITS.contents) : []).flatMap((c): ContentsEntry[] => {
    if (!isObject(c)) return [];
    const title = text(c.title, LIMITS.label).trim();
    return title ? [{ title, page: Math.round(number(c.page, 1, 1, Math.max(1, pages.length))) }] : [];
  });
  const background = typeof s.backgroundImage === 'string' && assets[s.backgroundImage]?.type.startsWith('image/') ? s.backgroundImage : null;
  return {
    title: text(v.title, LIMITS.label, 'Untitled flipbook') || 'Untitled flipbook',
    width: Math.round(number(v.width, 595, 50, 20000)),
    height: Math.round(number(v.height, 842, 50, 20000)),
    pages,
    contents,
    settings: {
      spread: s.spread === 'single' ? 'single' : 'double',
      rtl: s.rtl === true,
      hardCovers: s.hardCovers !== false,
      cover: s.cover !== false,
      background: colour(s.background, DEFAULT_SETTINGS.background),
      backgroundImage: background,
      sound: s.sound !== false,
      autoFlip: Math.round(number(s.autoFlip, 0, 0, 3600)),
      idleReset: Math.round(number(s.idleReset, 0, 0, 86400)),
      flipTime: Math.round(number(s.flipTime, 800, 200, 3000)),
      pageNumbers: s.pageNumbers === true,
    },
    assets,
  };
}

/** Assets no page, background or hotspot uses any more. */
export function unusedAssets(book: Book): string[] {
  const used = new Set<string>();
  for (const page of book.pages) {
    if (page.image) used.add(page.image);
    for (const h of page.hotspots) if (h.action.kind === 'video' || h.action.kind === 'audio') used.add(h.action.media);
  }
  if (book.settings.backgroundImage) used.add(book.settings.backgroundImage);
  return Object.keys(book.assets).filter((id) => !used.has(id));
}

/** The book as a .flipbook file: a ZIP of book.json and the assets (stored as they are). */
export function saveProject(book: Book): Uint8Array {
  const unused = new Set(unusedAssets(book));
  const assets = Object.entries(book.assets).filter(([id]) => !unused.has(id));
  const manifest = {
    format: FORMAT,
    version: 1,
    title: book.title,
    width: book.width,
    height: book.height,
    pages: book.pages,
    contents: book.contents,
    settings: book.settings,
    assets: Object.fromEntries(assets.map(([id, a]) => [id, { name: a.name, type: a.type }])),
  };
  const files: Zippable = { 'book.json': [strToU8(JSON.stringify(manifest, null, 1)), { level: 6 }] };
  for (const [id, asset] of assets) files[`assets/${id}`] = [asset.bytes, { level: asset.type.startsWith('image/svg') ? 6 : 0 }];
  return zipSync(files);
}

/** A .flipbook file opened again. */
export function openProject(bytes: Uint8Array): Book {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        if (total > 2 * 1024 ** 3) throw new Error('This flipbook unpacks to more than 2 GB.');
        return file.name === 'book.json' || /^assets\/[A-Za-z0-9_-]{1,64}$/.test(file.name);
      },
    });
  } catch (error) {
    throw new Error(error instanceof Error && error.message.includes('2 GB') ? error.message : 'This is not a flipbook file (it should be a ZIP with book.json inside).');
  }
  const manifest = files['book.json'];
  if (!manifest) throw new Error('This is not a flipbook file: it has no book.json.');
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(manifest));
  } catch {
    throw new Error('The flipbook’s book.json is damaged.');
  }
  if (!isObject(json) || json.format !== FORMAT) throw new Error('This is not a Benchtop flipbook.');
  const assets: Record<string, Asset> = {};
  const listed = isObject(json.assets) ? json.assets : {};
  for (const [id, meta] of Object.entries(listed)) {
    const data = files[`assets/${id}`];
    if (!ID.test(id) || !data || !isObject(meta) || typeof meta.type !== 'string' || !MIME.test(meta.type)) continue;
    assets[id] = { name: text(meta.name, 200, id), type: meta.type, bytes: data };
  }
  return normaliseBook(json, assets);
}

/** The book as the reader takes it, with `url` giving each asset's address. */
export function runtimeData(book: Book, url: (id: string) => string): FlipBookData {
  const media: Record<string, { url: string; type: string }> = {};
  for (const [id, asset] of Object.entries(book.assets)) if (asset.type.startsWith('video/') || asset.type.startsWith('audio/')) media[id] = { url: url(id), type: asset.type };
  return {
    title: book.title,
    width: book.width,
    height: book.height,
    pages: book.pages.map((page) => ({ src: page.image && book.assets[page.image] ? url(page.image) : null, text: page.text, color: page.color, hotspots: page.hotspots })),
    contents: book.contents,
    settings: { ...book.settings, backgroundImage: book.settings.backgroundImage && book.assets[book.settings.backgroundImage] ? url(book.settings.backgroundImage) : null },
    media,
  };
}

/** An asset as a data: URL. */
export function dataUrl(asset: Asset): string {
  let binary = '';
  for (let i = 0; i < asset.bytes.length; i += 0x8000) binary += String.fromCharCode(...asset.bytes.subarray(i, i + 0x8000));
  return `data:${asset.type};base64,${btoa(binary)}`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** What a script element may hold: no "</script" closing it early. */
const scriptSafe = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1');

/**
 * The flipbook as one HTML file that works offline: pictures and media as data URLs, the
 * StPageFlip library (`pageFlip`, its UMD build) and the reader (`runtime`) inside, and a
 * content security policy that keeps the page from loading anything from the network.
 */
export function exportHtml(book: Book, runtime: string, pageFlip: string, pageFlipLicence = ''): string {
  const data = runtimeData(book, (id) => dataUrl(book.assets[id] as Asset));
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));
  const policy = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";
  const licence = pageFlipLicence ? `\n<!--\nStPageFlip (page-flip) is included under its licence:\n\n${pageFlipLicence.replace(/--/g, '- -')}\n-->` : '';
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="generator" content="Benchtop Flipbook Editor">',
    `<title>${escapeHtml(book.title)}</title>`,
    `<style>html, body { height: 100%; margin: 0; background: ${book.settings.background}; } #book { width: 100%; height: 100%; }</style>`,
    '</head>',
    '<body>',
    '<div id="book"></div>',
    `<script>${scriptSafe(pageFlip)}</script>`,
    `<script type="application/json" id="book-data">${json}</script>`,
    '<script type="module">',
    scriptSafe(runtime),
    "const root = document.getElementById('book');",
    "mountFlipbook(root, JSON.parse(document.getElementById('book-data').textContent), { PageFlip: window.St.PageFlip });",
    'root.focus();',
    '</script>',
    `<!-- Made with Benchtop (MIT licence). -->${licence}`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
