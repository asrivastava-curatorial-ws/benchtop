/**
 * Asset Finder's shared shapes: what a connector (a library's search code)
 * returns, cleaned up so the rest of the app can trust it.
 */
import { type Licence, parseLicence } from './licences';

export type AssetType = 'image' | 'video' | 'video3d' | 'audio' | 'text' | 'model' | 'texture' | 'icon' | 'font';

export const ASSET_TYPES: readonly { readonly id: AssetType; readonly label: string; readonly hint: string; readonly folder: string }[] = [
  { id: 'image', label: 'Pictures', hint: 'Photos, artworks, scans, maps and illustrations', folder: 'Pictures' },
  { id: 'video', label: 'Films and video', hint: 'Films, newsreels, clips and stock footage', folder: 'Video' },
  { id: 'video3d', label: 'Stereo 3D, 360° and VR180', hint: 'Side-by-side, top-bottom and anaglyph films, and 360° or 180° video for headsets and domes', folder: 'Video 3D and 360' },
  { id: 'audio', label: 'Sound and music', hint: 'Music, sound effects, recordings and audiobooks', folder: 'Sound' },
  { id: 'text', label: 'Books and text', hint: 'Books, papers, articles and transcriptions', folder: 'Books and text' },
  { id: 'model', label: '3D models and CAD', hint: 'Meshes for printing and rendering, scans and CAD parts', folder: '3D models' },
  { id: 'texture', label: 'Textures and HDRIs', hint: 'PBR materials, textures and lighting environments', folder: 'Textures' },
  { id: 'icon', label: 'Icons and vectors', hint: 'Icon sets and SVG drawings', folder: 'Icons' },
  { id: 'font', label: 'Fonts', hint: 'Typefaces under open font licences', folder: 'Fonts' },
];

export const isAssetType = (value: unknown): value is AssetType => ASSET_TYPES.some((t) => t.id === value);
export const typeLabel = (type: AssetType) => ASSET_TYPES.find((t) => t.id === type)?.label ?? type;

/** How far the licence filter reaches, each level including the ones before it. */
export type LicenceLevel = 'pd' | 'by' | 'by-sa' | 'nc' | 'any';
/** What the asset is for: it decides which licences clash. */
export type AssetUse = 'free' | 'ticketed' | 'print' | 'web' | 'internal';

export interface AssetQuery {
  readonly text: string;
  /** The kinds asked for (a library is asked only for the ones it has). */
  readonly types: readonly AssetType[];
  readonly page: number;
  readonly pageSize: number;
  readonly licence: LicenceLevel;
  /** Include the Pexels, Pixabay and Unsplash licences. */
  readonly stock: boolean;
  readonly use: AssetUse;
}

export type Stereo = 'sbs' | 'tb' | 'anaglyph' | '3d' | '360' | '180';

export interface AssetFile {
  readonly label: string;
  /** Where it is downloaded from; `text` instead for files the connector writes itself. */
  readonly url?: string;
  readonly text?: string;
  readonly name: string;
  readonly size?: number;
  readonly format?: string;
  readonly width?: number;
  readonly height?: number;
  readonly md5?: string;
  readonly sha1?: string;
  readonly sha256?: string;
  /** The original as the library holds it (rather than a copy it made). */
  readonly original?: boolean;
  readonly note?: string;
  /** Sent with the download (a library key, for libraries that need one to download). */
  readonly headers?: readonly (readonly [string, string])[];
  /** Unpack after downloading (ZIP). */
  readonly unzip?: boolean;
  /** Files that go with this one (a glTF's buffers and textures), by path inside the asset's folder. */
  readonly parts?: readonly { readonly url: string; readonly name: string; readonly size?: number; readonly md5?: string }[];
}

export interface AssetItem {
  /** The library's own id (with the library's id, unique across libraries). */
  readonly id: string;
  readonly source: string;
  readonly type: AssetType;
  readonly title: string;
  readonly creator: string;
  readonly creatorUrl: string;
  readonly page: string;
  readonly thumb: string;
  readonly preview: string;
  readonly description: string;
  readonly date: string;
  readonly year?: number;
  /** The year the author died, when the library knows it (for the India check). */
  readonly deathYear?: number;
  readonly licence: Licence;
  readonly width?: number;
  readonly height?: number;
  /** Seconds. */
  readonly duration?: number;
  readonly size?: number;
  readonly formats: readonly string[];
  readonly tags: readonly string[];
  /** A collection or contributor inside the library. */
  readonly provider: string;
  readonly stereo?: Stereo;
  /** Files known at search time (otherwise the connector's files() lists them). */
  readonly files?: readonly AssetFile[];
  /** Whatever the connector keeps for files(). */
  readonly extra: unknown;
}

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
};
const year = (v: unknown): number | undefined => {
  const n = num(v);
  if (n !== undefined && n >= 1000 && n <= 3000) return Math.round(n);
  const m = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(str(v));
  return m ? Number(m[1]) : undefined;
};

/** Upgrades http and protocol-relative addresses to https; keeps plain http only for this computer. */
export function safeUrl(raw: unknown): string {
  let url = str(raw, 4000);
  if (!url) return '';
  if (url.startsWith('//')) url = `https:${url}`;
  try {
    const parsed = new URL(url);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol === 'http:' && !local) parsed.protocol = 'https:';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

const normalise = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9°]+/g, ' ')} `;

/** Stereo 3D or immersive video, from words in the title and tags and the picture's shape. */
export function detectStereo(text: string, width?: number, height?: number): Stereo | undefined {
  const t = normalise(text);
  if (/ (vr ?180|180 ?°|180 degree|180 3d) /.test(t)) return '180';
  if (/ (360 ?°|360 degree|360 video|360 vr|equirectangular|spherical video|vr 360) /.test(t)) return '360';
  if (/ (arcd|arcc|agmh|anaglyph|red cyan) /.test(t)) return 'anaglyph';
  if (/ (ou|tb|abl|3dv|htb|top bottom 3d|top and bottom 3d|over under 3d) /.test(t)) return 'tb';
  if (/ (sbs|hsbs|3dh|side by side 3d|3d side by side|half side by side|full side by side) /.test(t)) return 'sbs';
  if (/ (stereoscopic|stereo 3d|3d movie|3d film|s3d|stereograph) /.test(t)) {
    if (width && height) {
      const aspect = width / height;
      if (aspect >= 3.2) return 'sbs';
      if (aspect <= 1) return 'tb';
      if (Math.abs(aspect - 2) < 0.02) return '360';
    }
    return '3d';
  }
  return undefined;
}

export const STEREO_LABELS: Readonly<Record<Stereo, string>> = {
  sbs: 'Side-by-side 3D',
  tb: 'Top-bottom 3D',
  anaglyph: 'Anaglyph 3D',
  '3d': 'Stereo 3D',
  '360': '360°',
  '180': 'VR180',
};

function cleanFile(raw: unknown): AssetFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const url = safeUrl(f.url);
  const text = typeof f.text === 'string' ? f.text : undefined;
  if (!url && text === undefined) return null;
  const headers = Array.isArray(f.headers)
    ? f.headers.filter((h): h is [string, string] => Array.isArray(h) && h.length === 2 && typeof h[0] === 'string' && typeof h[1] === 'string').map(([a, b]) => [a, b] as const)
    : undefined;
  const fromUrl = url ? decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '') : '';
  const parts = Array.isArray(f.parts)
    ? f.parts
        .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : null))
        .filter((p): p is Record<string, unknown> => p !== null && !!safeUrl(p.url))
        .map((p) => ({
          url: safeUrl(p.url),
          name: str(p.name, 240)
            .split(/[\\/]+/)
            .filter((seg) => seg && seg !== '.' && seg !== '..')
            .join('/'),
          ...(num(p.size) !== undefined ? { size: num(p.size) } : {}),
          ...(str(p.md5) ? { md5: str(p.md5, 64) } : {}),
        }))
        .filter((p) => p.name)
        .slice(0, 400)
    : [];
  return {
    label: str(f.label, 200) || fromUrl || 'File',
    ...(url ? { url } : {}),
    ...(text !== undefined ? { text: text.slice(0, 20 << 20) } : {}),
    name: str(f.name, 240) || fromUrl || 'file',
    ...(num(f.size) !== undefined ? { size: num(f.size) } : {}),
    ...(str(f.format) ? { format: str(f.format, 20).toLowerCase() } : {}),
    ...(num(f.width) ? { width: num(f.width) } : {}),
    ...(num(f.height) ? { height: num(f.height) } : {}),
    ...(str(f.md5) ? { md5: str(f.md5, 64) } : {}),
    ...(str(f.sha1) ? { sha1: str(f.sha1, 64) } : {}),
    ...(str(f.sha256) ? { sha256: str(f.sha256, 80) } : {}),
    ...(f.original === true ? { original: true } : {}),
    ...(str(f.note) ? { note: str(f.note, 400) } : {}),
    ...(headers?.length ? { headers } : {}),
    ...(f.unzip === true ? { unzip: true } : {}),
    ...(parts.length ? { parts } : {}),
  };
}

export const cleanFiles = (raw: unknown): AssetFile[] =>
  Array.isArray(raw)
    ? raw
        .map(cleanFile)
        .filter((f): f is AssetFile => f !== null)
        .slice(0, 500)
    : [];

/** Turns what a connector returned into an item the app can show, or null when it lacks a title or id. */
export function cleanItem(raw: unknown, source: string, fallbackType: AssetType): AssetItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 400);
  const title = str(r.title, 300) || 'Untitled';
  if (!id) return null;
  const type = isAssetType(r.type) ? r.type : fallbackType;
  const width = num(r.width);
  const height = num(r.height);
  const tags = Array.isArray(r.tags)
    ? r.tags
        .map((t) => str(t, 80))
        .filter(Boolean)
        .slice(0, 30)
    : [];
  const licence =
    r.licence && typeof r.licence === 'object' && 'code' in (r.licence as object) ? (r.licence as Licence) : parseLicence(str(r.licence, 400), str(r.licenceUrl, 400), str(r.licenceNote, 400));
  const stereo =
    (['sbs', 'tb', 'anaglyph', '3d', '360', '180'] as const).find((s) => s === r.stereo) ??
    (type === 'video' || type === 'video3d' || type === 'image' ? detectStereo(`${title} ${tags.join(' ')}`, width, height) : undefined);
  const files = r.files === undefined ? undefined : cleanFiles(r.files);
  return {
    id,
    source,
    type: type === 'video' && stereo ? 'video3d' : type,
    title,
    creator: str(r.creator, 300),
    creatorUrl: safeUrl(r.creatorUrl),
    page: safeUrl(r.page),
    thumb: safeUrl(r.thumb),
    preview: safeUrl(r.preview),
    description: str(r.description, 4000),
    date: str(r.date, 80),
    ...((year(r.year) ?? year(r.date)) ? { year: year(r.year) ?? year(r.date) } : {}),
    ...(year(r.deathYear) ? { deathYear: year(r.deathYear) } : {}),
    licence,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(num(r.duration) ? { duration: num(r.duration) } : {}),
    ...(num(r.size) ? { size: num(r.size) } : {}),
    formats: Array.isArray(r.formats)
      ? r.formats
          .map((f) => str(f, 20).toLowerCase())
          .filter(Boolean)
          .slice(0, 12)
      : [],
    tags,
    provider: str(r.provider, 200),
    ...(stereo ? { stereo } : {}),
    ...(files ? { files } : {}),
    extra: r.extra ?? null,
  };
}

/** One key for the same work found in two libraries (Openverse lists Wikimedia files, for example). */
export function sameWorkKey(item: AssetItem): string {
  const simple = (s: string) =>
    s
      .toLowerCase()
      .replace(/^file:/, '')
      .replace(/\.[a-z0-9]{2,4}$/, '')
      .replace(/[^a-z0-9]+/g, '');
  return `${item.type}|${simple(item.title)}|${simple(item.creator)}`;
}

/** Folder names for an asset inside the library: kind, library, then "Title [id]". */
export function assetFolder(item: AssetItem, sourceName: string): string[] {
  const kind = ASSET_TYPES.find((t) => t.id === item.type)?.folder ?? 'Other';
  const shortId = item.id.replace(/[^\w.-]+/g, '-').slice(-40);
  return [kind, sourceName, `${item.title.slice(0, 80)} [${shortId}]`];
}

export const humanSize = (bytes?: number): string => {
  if (!bytes) return '';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  return u === 0 ? `${n} bytes` : `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[u]}`;
};

export const humanDuration = (seconds?: number): string => {
  if (!seconds) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${m}:${String(rest).padStart(2, '0')}`;
};
