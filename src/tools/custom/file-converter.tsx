/**
 * File converter in the spirit of ConvertX and FreeConvert: choose any mix of
 * files and turn each into another format with the right program on this
 * computer (FFmpeg, LibreOffice, Pandoc, ImageMagick, Inkscape, Calibre,
 * Ghostscript, MuPDF or bsdtar), or here in the app for e-mails, HEIC photos,
 * TAR archives and pictures traced into SVG.
 */

import { useMemo } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { archiveToZip } from '../../lib/archives';
import type { Preset } from '../../lib/trace';
import { htmlToPdf, isDesktop } from '../../platform';
import { stageFile } from '../../platform/ai';
import { PROGRAMS, type ProgramId } from '../../platform/convert';
import { context2d, createCanvas, downscale, encodeCanvas, loadImage } from '../../ui/canvas';
import { attempt } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { chooseFiles, DestinationControl, extensionOf, has, InstallHint, type LocalResult, type QueueItem, QueueList, useDestination, usePrograms, useQueue } from './_convert';
import { usePersistentState } from './_shared';

type External = Exclude<ProgramId, 'ffprobe'>;
/** An installed program, or 'builtin' for conversions done here in the app. */
type Program = External | 'builtin';

const programName = (program: Program) => (program === 'builtin' ? 'Benchtop' : PROGRAMS[program].name);

interface Family {
  readonly id: string;
  readonly label: string;
  readonly program: Program;
  readonly recipe: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly (readonly [string, string])[];
  readonly defaultTo: string;
  /** For 'builtin' families: the conversion itself. */
  readonly local?: (bytes: Uint8Array, name: string, to: string, settings: Settings) => Promise<LocalResult>;
  /** A word on what to expect. */
  readonly note?: string;
}

const TRACE_PRESETS: readonly (readonly [Preset, string])[] = [
  ['logo', 'Logo or icon'],
  ['artwork', 'Artwork (many colours)'],
  ['poster', 'Poster (smooth shapes)'],
  ['lineart', 'Line art (two colours)'],
];

const VIDEO_IN = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', 'ogv'];
const AUDIO_IN = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'amr', 'ac3', 'mka'];
const AUDIO_OUT = [
  ['mp3', 'MP3'],
  ['m4a', 'M4A (AAC)'],
  ['wav', 'WAV'],
  ['flac', 'FLAC'],
  ['ogg', 'Ogg Vorbis'],
  ['opus', 'Opus'],
  ['aac', 'AAC'],
] as const;

/** Families in order of preference for files more than one can read. */
export const FAMILIES: readonly Family[] = [
  {
    id: 'heic',
    label: 'HEIC photos',
    program: 'builtin',
    recipe: 'local',
    inputs: ['heic', 'heif', 'hif'],
    outputs: [
      ['jpg', 'JPEG'],
      ['png', 'PNG'],
      ['webp', 'WebP'],
    ],
    defaultTo: 'jpg',
    note: 'Decoded here with libheif; camera details and location are left out.',
    local: async (bytes, _name, to, settings) => {
      const { decodeHeif } = await import('../../lib/heic');
      const pixels = await decodeHeif(bytes);
      let canvas = createCanvas(pixels.width, pixels.height);
      context2d(canvas).putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
      if (settings.size > 0) canvas = downscale(canvas, settings.size).canvas;
      const blob = await encodeCanvas(canvas, { format: to === 'png' ? 'png' : to === 'webp' ? 'webp' : 'jpeg', quality: settings.imageQuality });
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: to };
    },
  },
  {
    id: 'email',
    label: 'E-mails and saved web pages',
    program: 'builtin',
    recipe: 'local',
    inputs: ['eml', 'mht', 'mhtml'],
    outputs: [
      ['html', 'HTML page (pictures and attachments inside)'],
      ['pdf', 'PDF'],
    ],
    defaultTo: 'html',
    note: 'Remote pictures and scripts in messages are blocked.',
    local: async (bytes, _name, to) => {
      const { messageToHtml } = await import('../../lib/eml');
      const page = messageToHtml(bytes, { embedAttachments: to === 'html' });
      if (to === 'pdf') return { bytes: await htmlToPdf(page.html, { paper: 'A4', background: true }), ext: 'pdf' };
      return { bytes: new TextEncoder().encode(page.html), ext: 'html' };
    },
  },
  {
    id: 'video',
    label: 'Video',
    program: 'ffmpeg',
    recipe: 'media-convert',
    inputs: VIDEO_IN,
    outputs: [['mp4', 'MP4 (H.264)'], ['mkv', 'MKV'], ['webm', 'WebM (VP9)'], ['mov', 'MOV'], ['avi', 'AVI'], ['gif', 'Animated GIF'], ...AUDIO_OUT.map(([v, l]) => [v, `${l}, sound only`] as const)],
    defaultTo: 'mp4',
  },
  { id: 'audio', label: 'Audio', program: 'ffmpeg', recipe: 'media-convert', inputs: AUDIO_IN, outputs: AUDIO_OUT, defaultTo: 'mp3' },
  {
    id: 'image',
    label: 'Pictures',
    program: 'imagemagick',
    recipe: 'image',
    inputs: [
      'png',
      'jpg',
      'jpeg',
      'jfif',
      'webp',
      'gif',
      'bmp',
      'tif',
      'tiff',
      'heic',
      'heif',
      'avif',
      'jxl',
      'psd',
      'ico',
      'tga',
      'ppm',
      'pgm',
      'pbm',
      'pnm',
      'jp2',
      'dds',
      'xcf',
      'cr2',
      'nef',
      'arw',
      'dng',
    ],
    outputs: [
      ['png', 'PNG'],
      ['jpg', 'JPEG'],
      ['webp', 'WebP'],
      ['avif', 'AVIF'],
      ['heic', 'HEIC'],
      ['gif', 'GIF'],
      ['tiff', 'TIFF'],
      ['bmp', 'BMP'],
      ['ico', 'ICO (icon sizes 16 to 256)'],
      ['pdf', 'PDF'],
    ],
    defaultTo: 'png',
  },
  {
    id: 'trace',
    label: 'Pictures traced into drawings',
    program: 'builtin',
    recipe: 'local',
    inputs: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'],
    outputs: [['svg', 'SVG (traced shapes)']],
    defaultTo: 'svg',
    note: 'Best for logos, icons and drawings; photos become many small shapes.',
    local: async (bytes, _name, _to, settings) => {
      const canvas = await loadImage(new Blob([bytes as BlobPart]));
      const { PRESETS, traceToSvg } = await import('../../lib/trace');
      const svg = await traceToSvg(canvas, { preset: settings.trace, ...PRESETS[settings.trace] });
      return { bytes: new TextEncoder().encode(svg), ext: 'svg', suffix: ' (traced)' };
    },
  },
  {
    id: 'postscript',
    label: 'PostScript and EPS',
    program: 'ghostscript',
    recipe: 'postscript',
    inputs: ['ps', 'eps', 'epsi', 'epsf'],
    outputs: [
      ['pdf', 'PDF'],
      ['png', 'PNG (first page)'],
    ],
    defaultTo: 'pdf',
  },
  {
    id: 'xps',
    label: 'XPS documents',
    program: 'mutool',
    recipe: 'xps',
    inputs: ['xps', 'oxps'],
    outputs: [['pdf', 'PDF']],
    defaultTo: 'pdf',
  },
  {
    id: 'vector',
    label: 'Drawings',
    program: 'inkscape',
    recipe: 'vector',
    inputs: ['svg', 'svgz', 'eps', 'ai', 'emf', 'wmf', 'cdr', 'vsd'],
    outputs: [
      ['png', 'PNG'],
      ['pdf', 'PDF'],
      ['svg', 'Plain SVG'],
      ['eps', 'EPS'],
      ['ps', 'PostScript'],
      ['emf', 'EMF'],
    ],
    defaultTo: 'png',
  },
  {
    id: 'ebook',
    label: 'E-books',
    program: 'calibre',
    recipe: 'ebook',
    inputs: ['epub', 'mobi', 'azw', 'azw3', 'azw4', 'fb2', 'fbz', 'lit', 'pdb', 'lrf', 'cbz', 'cbr', 'cb7', 'snb', 'tcr', 'htmlz', 'txtz'],
    outputs: [
      ['epub', 'EPUB'],
      ['azw3', 'AZW3 (Kindle)'],
      ['mobi', 'MOBI'],
      ['pdf', 'PDF'],
      ['docx', 'Word (DOCX)'],
      ['fb2', 'FB2'],
      ['txt', 'Plain text'],
      ['htmlz', 'HTMLZ'],
    ],
    defaultTo: 'epub',
  },
  {
    id: 'writer',
    label: 'Documents',
    program: 'libreoffice',
    recipe: 'document',
    inputs: ['doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'odt', 'ott', 'fodt', 'rtf', 'wpd', 'wps', 'pages', 'hwp', 'lwp', 'abw', 'zabw', 'sxw', 'uot', 'txt', 'html', 'htm', 'xml'],
    outputs: [
      ['pdf', 'PDF'],
      ['docx', 'Word (DOCX)'],
      ['odt', 'OpenDocument text'],
      ['rtf', 'RTF'],
      ['txt', 'Plain text'],
      ['html', 'HTML'],
    ],
    defaultTo: 'pdf',
  },
  {
    id: 'calc',
    label: 'Spreadsheets',
    program: 'libreoffice',
    recipe: 'document',
    inputs: ['xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'xltm', 'ods', 'ots', 'fods', 'sxc', 'uos', 'csv', 'numbers', 'dbf'],
    outputs: [
      ['pdf', 'PDF'],
      ['xlsx', 'Excel (XLSX)'],
      ['ods', 'OpenDocument spreadsheet'],
      ['csv', 'CSV (first sheet)'],
      ['html', 'HTML'],
    ],
    defaultTo: 'xlsx',
  },
  {
    id: 'impress',
    label: 'Presentations',
    program: 'libreoffice',
    recipe: 'document',
    inputs: ['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'pot', 'potx', 'potm', 'odp', 'otp', 'fodp', 'sxi', 'uop', 'key'],
    outputs: [
      ['pdf', 'PDF'],
      ['pptx', 'PowerPoint (PPTX)'],
      ['odp', 'OpenDocument presentation'],
      ['png', 'PNG (first slide)'],
    ],
    defaultTo: 'pdf',
  },
  {
    id: 'draw',
    label: 'Diagrams and publications',
    program: 'libreoffice',
    recipe: 'document',
    inputs: ['vsd', 'vsdx', 'vsdm', 'vdx', 'pub', 'odg', 'otg', 'fodg', 'wpg', 'cdr'],
    outputs: [
      ['pdf', 'PDF'],
      ['png', 'PNG (first page)'],
      ['svg', 'SVG (first page)'],
      ['odg', 'OpenDocument drawing'],
    ],
    defaultTo: 'pdf',
  },
  {
    id: 'pdf-word',
    label: 'PDFs to edit',
    program: 'libreoffice',
    recipe: 'document',
    inputs: ['pdf'],
    outputs: [
      ['docx', 'Word (DOCX)'],
      ['odt', 'OpenDocument text'],
      ['rtf', 'RTF'],
    ],
    defaultTo: 'docx',
    note: 'The text becomes editable and keeps its places in text frames; scanned pages stay pictures (PDF Studio reads them with OCR).',
  },
  {
    id: 'archive',
    label: 'Archives',
    program: 'bsdtar',
    recipe: 'archive',
    inputs: ['rar', '7z', 'zip', 'tar', 'tgz', 'gz', 'tbz', 'tbz2', 'bz2', 'txz', 'xz', 'tzst', 'zst', 'cab', 'iso', 'lzh', 'lha', 'cpio', 'xar'],
    outputs: [
      ['zip', 'ZIP'],
      ['7z', '7z'],
      ['tgz', 'TAR.GZ'],
    ],
    defaultTo: 'zip',
    note: 'Password-protected archives cannot be converted.',
  },
  {
    id: 'tar',
    label: 'TAR archives',
    program: 'builtin',
    recipe: 'local',
    inputs: ['tar', 'tgz', 'gz', 'tbz', 'tbz2', 'bz2'],
    outputs: [['zip', 'ZIP']],
    defaultTo: 'zip',
    local: async (bytes, name) => ({ bytes: await archiveToZip(name, bytes), ext: 'zip' }),
  },
  {
    id: 'markup',
    label: 'Markup and text',
    program: 'pandoc',
    recipe: 'markup',
    inputs: ['md', 'markdown', 'txt', 'html', 'htm', 'rst', 'tex', 'latex', 'org', 'textile', 'docx', 'odt', 'epub', 'ipynb', 'fb2', 'opml', 'csv', 'rtf', 'typ'],
    outputs: [
      ['html', 'HTML'],
      ['md', 'Markdown (GitHub)'],
      ['docx', 'Word (DOCX)'],
      ['odt', 'OpenDocument text'],
      ['rtf', 'RTF'],
      ['epub', 'EPUB'],
      ['rst', 'reStructuredText'],
      ['tex', 'LaTeX'],
      ['asciidoc', 'AsciiDoc'],
      ['org', 'Org mode'],
      ['mediawiki', 'MediaWiki'],
      ['textile', 'Textile'],
      ['pptx', 'PowerPoint slides (each heading starts a slide)'],
      ['txt', 'Plain text'],
    ],
    defaultTo: 'html',
  },
];

const ALL_EXTENSIONS = [...new Set(FAMILIES.flatMap((f) => f.inputs))];

/** Families that read this extension, best first; installed programs (and the app itself) come first. */
export function familiesFor(ext: string, installed: (program: Program) => boolean): Family[] {
  const all = FAMILIES.filter((f) => f.inputs.includes(ext));
  return [...all.filter((f) => installed(f.program)), ...all.filter((f) => !installed(f.program))];
}

interface Settings {
  /** Output format per family. */
  readonly to: Readonly<Record<string, string>>;
  /** Family chosen by extension, when more than one can read it. */
  readonly using: Readonly<Record<string, string>>;
  readonly quality: 'high' | 'balanced' | 'small';
  readonly bitrate: string;
  readonly size: number;
  readonly imageQuality: number;
  readonly strip: boolean;
  readonly dpi: number;
  readonly trace: Preset;
}

const read = (s: Values | undefined): Settings => {
  const record = (v: unknown) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) : {}) as Record<string, string>;
  const num = (v: unknown, d: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
  return {
    to: record(s?.to),
    using: record(s?.using),
    quality: (['high', 'balanced', 'small'] as const).find((q) => q === s?.quality) ?? 'balanced',
    bitrate: ['128', '192', '256', '320'].find((b) => b === s?.bitrate) ?? '192',
    size: num(s?.size, 0, 0, 20000),
    imageQuality: num(s?.imageQuality, 85, 1, 100),
    strip: typeof s?.strip === 'boolean' ? s.strip : true,
    dpi: num(s?.dpi, 192, 24, 1200),
    trace: TRACE_PRESETS.find(([p]) => p === s?.trace)?.[0] ?? 'logo',
  };
};

const CRF = { high: 20, balanced: 23, small: 28 } as const;

function FileConverter({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({ ...s }) as unknown as Values);
  const { programs, error, recheck } = usePrograms();
  const queue = useQueue();
  const [target, setTarget] = useDestination();
  // Files dropped on the window are copied to a temporary folder for the converters to read.
  useIncomingFiles((files) =>
    attempt(async () => {
      const staged = [];
      for (const file of files) if (ALL_EXTENSIONS.includes(extensionOf(file.name))) staged.push(await stageFile(file));
      if (staged.length) queue.add(staged);
    }),
  );
  const installed = (program: Program) => program === 'builtin' || has(programs, program);

  const familyOf = (item: QueueItem): Family | null => {
    const ext = extensionOf(item.file.name);
    const options = familiesFor(ext, installed);
    return options.find((f) => f.id === settings.using[ext]) ?? options[0] ?? null;
  };

  const groups = useMemo(() => {
    const map = new Map<string, { family: Family; items: QueueItem[]; extensions: Set<string> }>();
    for (const item of queue.items) {
      const family = familyOf(item);
      if (!family) continue;
      const group = map.get(family.id) ?? { family, items: [], extensions: new Set<string>() };
      group.items.push(item);
      group.extensions.add(extensionOf(item.file.name));
      map.set(family.id, group);
    }
    return [...map.values()];
  }, [queue.items, settings.using, programs]);

  if (!isDesktop) {
    return (
      <div data-testid="tool" class="tool">
        <div class="ai-gate" data-testid="convert-gate">
          <h2>The file converter needs the desktop app</h2>
          <p>It runs programs installed on your computer, such as FFmpeg, LibreOffice and Pandoc, which a web page cannot start. Files never leave your computer.</p>
        </div>
      </div>
    );
  }
  if (error) return <p class="recipe-error">{error}</p>;
  if (!programs) return <p class="tool-loading">Looking for converters…</p>;

  const toFor = (family: Family) => {
    const chosen = settings.to[family.id];
    return family.outputs.some(([v]) => v === chosen) ? chosen : family.defaultTo;
  };

  const optionsFor = (family: Family): Record<string, unknown> => {
    const to = toFor(family);
    switch (family.id) {
      case 'video':
      case 'audio':
        return { to, crf: CRF[settings.quality], bitrate: Number(settings.bitrate) };
      case 'image':
        return { to, size: settings.size, quality: settings.imageQuality, strip: settings.strip };
      case 'vector':
      case 'postscript':
        return { to, dpi: settings.dpi };
      default:
        return { to };
    }
  };

  const unsupported = queue.items.filter((i) => !familyOf(i));
  const missing = [...new Set(groups.filter((g) => !installed(g.family.program)).map((g) => g.family.program as External))];
  const convertible = queue.items.filter((i) => i.state !== 'running' && familyOf(i) && installed((familyOf(i) as Family).program));
  const pending = convertible.filter((i) => i.state !== 'done');
  const again = pending.length === 0 && convertible.length > 0;
  const runnable = again ? convertible : pending;

  const describe = (item: QueueItem) => {
    const family = familyOf(item);
    if (!family) return `no converter reads .${extensionOf(item.file.name) || 'this'} files`;
    const label = family.outputs.find(([v]) => v === toFor(family))?.[1] ?? toFor(family);
    return installed(family.program) ? `to ${label} with ${programName(family.program)}` : `needs ${programName(family.program)}`;
  };

  const run = () =>
    void attempt(() =>
      queue.runAll(
        (item) => {
          const family = familyOf(item);
          if (!family || !installed(family.program)) return null;
          const local = family.local;
          if (local) return { recipe: family.recipe, local: (bytes) => local(bytes, item.file.name, toFor(family), settings) };
          return { recipe: family.recipe, options: optionsFor(family) };
        },
        target,
        again,
      ),
    );

  const setTo = (family: string, to: string) => setSettings((s) => ({ ...s, to: { ...s.to, [family]: to } }));
  const setUsing = (extensions: Iterable<string>, family: string) =>
    setSettings((s) => {
      const using = { ...s.using };
      for (const ext of extensions) if (FAMILIES.find((f) => f.id === family)?.inputs.includes(ext)) using[ext] = family;
      return { ...s, using };
    });

  return (
    <div data-testid="tool" class="tool ai-tool conv-tool">
      <div class="ai-controls">
        <div class="button-row">
          <button
            type="button"
            class="button button-primary"
            disabled={queue.running}
            onClick={() =>
              attempt(async () => {
                const files = await chooseFiles(true, 'Files the converters read', ALL_EXTENSIONS);
                if (files.length) queue.add(files);
              })
            }
            data-testid="convert-choose"
          >
            Choose files
          </button>
          {queue.items.length > 0 && (
            <button type="button" class="button button-quiet" disabled={queue.running} onClick={queue.clear}>
              Clear list
            </button>
          )}
        </div>
        {groups.map(({ family, items, extensions }) => {
          const alternatives = FAMILIES.filter((f) => f.id !== family.id && [...extensions].every((ext) => f.inputs.includes(ext)));
          return (
            <fieldset key={family.id} class="conv-group" data-testid={`convert-group-${family.id}`}>
              <legend>
                {family.label} ({items.length}: {[...extensions].map((e) => e.toUpperCase()).join(', ')})
              </legend>
              <div class="control">
                <label class="control-label" for={`conv-to-${family.id}`}>
                  Convert to
                </label>
                <select id={`conv-to-${family.id}`} class="input" value={toFor(family)} onChange={(e) => setTo(family.id, e.currentTarget.value)}>
                  {family.outputs.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {alternatives.length > 0 && (
                <div class="control">
                  <label class="control-label" for={`conv-using-${family.id}`}>
                    Using
                  </label>
                  <select id={`conv-using-${family.id}`} class="input" value={family.id} onChange={(e) => setUsing(extensions, e.currentTarget.value)}>
                    {[family, ...alternatives].map((f) => (
                      <option key={f.id} value={f.id}>
                        {programName(f.program)} ({f.label.toLowerCase()}){installed(f.program) ? '' : ', not installed'}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {(family.id === 'video' || family.id === 'audio') && (
                <div class="control">
                  <label class="control-label" for={`conv-q-${family.id}`}>
                    {family.id === 'video' ? 'Quality' : 'Bit rate'}
                  </label>
                  {family.id === 'video' ? (
                    <select id={`conv-q-${family.id}`} class="input" value={settings.quality} onChange={(e) => setSettings((s) => ({ ...s, quality: e.currentTarget.value as Settings['quality'] }))}>
                      <option value="high">High (larger files)</option>
                      <option value="balanced">Balanced</option>
                      <option value="small">Small files</option>
                    </select>
                  ) : (
                    <select id={`conv-q-${family.id}`} class="input" value={settings.bitrate} onChange={(e) => setSettings((s) => ({ ...s, bitrate: e.currentTarget.value }))}>
                      {['128', '192', '256', '320'].map((b) => (
                        <option key={b} value={b}>
                          {b} kbit/s
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {family.note && <p class="tone-muted conv-note">{family.note}</p>}
              {family.id === 'trace' && (
                <div class="control">
                  <label class="control-label" for="conv-trace">
                    Picture type
                  </label>
                  <select id="conv-trace" class="input" value={settings.trace} onChange={(e) => setSettings((s) => ({ ...s, trace: e.currentTarget.value as Preset }))}>
                    {TRACE_PRESETS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {(family.id === 'image' || family.id === 'heic') && (
                <>
                  <div class="control">
                    <label class="control-label" for="conv-size">
                      Largest side (px, 0 keeps the size)
                    </label>
                    <input
                      id="conv-size"
                      class="input input-number"
                      type="number"
                      min={0}
                      max={20000}
                      value={settings.size}
                      onInput={(e) => setSettings((s) => ({ ...s, size: Math.max(0, Number(e.currentTarget.value) || 0) }))}
                    />
                  </div>
                  <div class="control">
                    <label class="control-label" for="conv-iq">
                      Quality ({settings.imageQuality})
                    </label>
                    <input id="conv-iq" type="range" min={40} max={100} value={settings.imageQuality} onInput={(e) => setSettings((s) => ({ ...s, imageQuality: Number(e.currentTarget.value) }))} />
                  </div>
                  {family.id === 'image' && (
                    <label class="toggle" for="conv-strip">
                      <input
                        id="conv-strip"
                        type="checkbox"
                        role="switch"
                        aria-checked={settings.strip}
                        checked={settings.strip}
                        onChange={(e) => setSettings((s) => ({ ...s, strip: e.currentTarget.checked }))}
                      />
                      <span class="toggle-track" aria-hidden="true" />
                      <span>Remove camera details and location (metadata)</span>
                    </label>
                  )}
                </>
              )}
              {(family.id === 'vector' || family.id === 'postscript') && toFor(family) === 'png' && (
                <div class="control">
                  <label class="control-label" for="conv-dpi">
                    Resolution (dpi)
                  </label>
                  <input
                    id="conv-dpi"
                    class="input input-number"
                    type="number"
                    min={24}
                    max={1200}
                    value={settings.dpi}
                    onInput={(e) => setSettings((s) => ({ ...s, dpi: Math.max(24, Number(e.currentTarget.value) || 96) }))}
                  />
                </div>
              )}
            </fieldset>
          );
        })}
        {queue.items.length > 0 && <DestinationControl value={target.destination} folderPath={target.folderPath} onChange={setTarget} />}
        {queue.items.length > 0 && (
          <div class="button-row">
            <button type="button" class="button button-primary" disabled={!runnable.length || queue.running} onClick={run} data-testid="convert-run">
              Convert {runnable.length === 1 ? 'file' : `${runnable.length} files`}
              {again ? ' again' : ''}
            </button>
            {queue.running && (
              <button type="button" class="button" onClick={queue.stop}>
                Stop
              </button>
            )}
          </div>
        )}
      </div>
      <div class="ai-work">
        {queue.items.length === 0 ? (
          <div class="conv-empty">
            <p>
              Choose files of any kind: video, audio, pictures, drawings, Office documents, Visio and Publisher files, PDFs to edit in Word, PostScript and XPS, archives, e-mails, Markdown and other
              markup, or e-books. Each is converted on this computer by the program that reads it best.
            </p>
            <p class="tone-muted">Built into Benchtop: HEIC photos, e-mails (EML) and saved web pages (MHTML), TAR archives to ZIP, and pictures traced into SVG.</p>
            <ul class="conv-programs" data-testid="convert-programs">
              {(Object.keys(PROGRAMS) as External[]).map((id) => (
                <li key={id} class={installed(id) ? 'is-found' : 'is-missing'}>
                  <strong>{PROGRAMS[id].name}</strong> <span>{installed(id) ? 'found' : 'not installed'}</span>
                  <span class="tone-muted">{PROGRAMS[id].use}</span>
                </li>
              ))}
            </ul>
            {(Object.keys(PROGRAMS) as External[]).some((id) => !installed(id)) && (
              <details class="conv-missing">
                <summary>How to install the missing programs</summary>
                {(Object.keys(PROGRAMS) as External[])
                  .filter((id) => !installed(id))
                  .map((id) => (
                    <InstallHint key={id} id={id} os={programs.os} />
                  ))}
                <button type="button" class="button button-quiet" onClick={recheck}>
                  Check again
                </button>
              </details>
            )}
          </div>
        ) : (
          <>
            {missing.length > 0 && (
              <details class="conv-missing conv-missing-box" open>
                <summary>{missing.length === 1 ? `${PROGRAMS[missing[0]].name} is` : `${missing.map((id) => PROGRAMS[id].name).join(' and ')} are`} needed for some of these files</summary>
                {missing.map((id) => (
                  <InstallHint key={id} id={id} os={programs.os} />
                ))}
                <button type="button" class="button button-quiet" onClick={recheck}>
                  Check again
                </button>
              </details>
            )}
            {unsupported.length > 0 && (
              <p class="tone-muted">{unsupported.length === 1 ? 'One file has' : `${unsupported.length} files have`} a format none of the converters reads; it will be skipped.</p>
            )}
            <QueueList items={queue.items} running={queue.running} onRemove={queue.remove} describe={describe} />
          </>
        )}
      </div>
    </div>
  );
}

export default defineCustomTool(FileConverter);
