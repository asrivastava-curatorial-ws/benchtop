/**
 * Font File Explorer (what is inside a TTF, OTF, WOFF or WOFF2: names,
 * metrics, licence, variable axes, OpenType features, coverage, glyphs) and
 * Glyph Browser (Unicode blocks in any font, with every way to write a
 * character in code).
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { BLOCKS, blockOf, encodings, parseCodePoint } from '../../lib/unicode-blocks';
import { copyText, pickFile } from '../../platform';
import { CodeOutput } from '../../ui/CodeOutput';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

/* ---------------------------------------------------------------- loading -- */

interface Axis {
  readonly tag: string;
  readonly name: string;
  readonly min: number;
  readonly default: number;
  readonly max: number;
}

interface FontInfo {
  readonly fileName: string;
  readonly format: string;
  readonly size: number;
  readonly family: string;
  readonly style: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly version: string;
  readonly names: readonly { label: string; value: string }[];
  readonly metrics: readonly { label: string; value: string }[];
  readonly weight: number;
  readonly widthClass: number;
  readonly italic: boolean;
  readonly monospace: boolean;
  readonly embedding: string;
  readonly glyphs: number;
  readonly characters: readonly number[];
  readonly features: readonly string[];
  readonly axes: readonly Axis[];
  readonly instances: readonly { name: string; coords: Record<string, number> }[];
  /** CSS family name the file is registered under for previews. */
  readonly cssFamily: string;
}

const FEATURE_NAMES: Record<string, string> = {
  aalt: 'All alternates',
  abvs: 'Above-base substitutions',
  akhn: 'Akhand',
  blwf: 'Below-base forms',
  calt: 'Contextual alternates',
  case: 'Case-sensitive forms',
  ccmp: 'Glyph composition',
  cpsp: 'Capital spacing',
  dlig: 'Discretionary ligatures',
  dnom: 'Denominators',
  frac: 'Fractions',
  half: 'Half forms',
  hlig: 'Historical ligatures',
  kern: 'Kerning',
  liga: 'Standard ligatures',
  lnum: 'Lining figures',
  locl: 'Localised forms',
  mark: 'Mark positioning',
  mkmk: 'Mark-to-mark positioning',
  nukt: 'Nukta forms',
  numr: 'Numerators',
  onum: 'Old-style figures',
  ordn: 'Ordinals',
  pnum: 'Proportional figures',
  pres: 'Pre-base substitutions',
  psts: 'Post-base substitutions',
  rkrf: 'Rakar forms',
  rphf: 'Reph form',
  salt: 'Stylistic alternates',
  sinf: 'Scientific inferiors',
  smcp: 'Small capitals',
  c2sc: 'Capitals to small capitals',
  ss01: 'Stylistic set 1',
  ss02: 'Stylistic set 2',
  ss03: 'Stylistic set 3',
  ss04: 'Stylistic set 4',
  ss05: 'Stylistic set 5',
  ss06: 'Stylistic set 6',
  ss07: 'Stylistic set 7',
  subs: 'Subscript',
  sups: 'Superscript',
  swsh: 'Swash',
  tnum: 'Tabular figures',
  vatu: 'Vattu variants',
  zero: 'Slashed zero',
};

const AXIS_NAMES: Record<string, string> = { wght: 'Weight', wdth: 'Width', slnt: 'Slant', ital: 'Italic', opsz: 'Optical size', GRAD: 'Grade' };

const EMBEDDING = (fsType: Record<string, boolean> | undefined): string => {
  if (!fsType) return 'Not stated';
  if (fsType.noEmbedding) return 'Restricted: may not be embedded in documents';
  if (fsType.viewOnly) return 'Preview and print: documents may embed it read-only';
  if (fsType.editable) return 'Editable: documents may embed it and be edited';
  return 'Installable: may be embedded and installed';
};

function formatOf(bytes: Uint8Array): string {
  const tag = new TextDecoder('latin1').decode(bytes.subarray(0, 4));
  if (tag === 'wOF2') return 'WOFF2';
  if (tag === 'wOFF') return 'WOFF';
  if (tag === 'OTTO') return 'OpenType (CFF outlines)';
  if (tag === 'ttcf') return 'TrueType collection';
  return 'TrueType';
}

let faceCount = 0;

const copyAndTell = (text: string, message = 'Copied') =>
  attempt(async () => {
    await copyText(text);
    notify(message);
  });

async function readFont(file: File): Promise<FontInfo> {
  if (file.size > 60 * 1024 * 1024) throw new Error('That font file is larger than 60 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { default: fontkit } = await import('@pdf-lib/fontkit');
  let font: Record<string, unknown> & { getName?: (key: string) => string | null };
  try {
    const created = fontkit.create(bytes) as unknown as Record<string, unknown>;
    font = (Array.isArray(created.fonts) ? created.fonts[0] : created) as typeof font;
  } catch (error) {
    throw new Error(`This is not a font file Benchtop can read (${error instanceof Error ? error.message : String(error)}). Use TTF, OTF, WOFF or WOFF2.`);
  }
  const get = <T,>(key: string, fallback: T): T => {
    try {
      const v = font[key] as T | undefined;
      return v ?? fallback;
    } catch {
      return fallback;
    }
  };
  const name = (key: string) => {
    try {
      return font.getName?.(key) ?? '';
    } catch {
      return '';
    }
  };
  const os2 = get<Record<string, unknown> | null>('OS/2', null);
  const upem = get('unitsPerEm', 1000);
  const axesRaw = get<Record<string, { name: string; min: number; default: number; max: number }>>('variationAxes', {});
  const axes = Object.entries(axesRaw).map(([tag, a]) => ({ tag, name: a.name || AXIS_NAMES[tag] || tag, min: a.min, default: a.default, max: a.max }));
  const named = get<Record<string, Record<string, number>>>('namedVariations', {});
  const family = name('preferredFamily') || (get<string | null>('familyName', null) ?? file.name);
  const style = name('preferredSubfamily') || (get<string | null>('subfamilyName', null) ?? 'Regular');
  const cssFamily = `bt-font-${++faceCount}`;
  const descriptors: FontFaceDescriptors = axes.some((a) => a.tag === 'wght') ? { weight: `${axes.find((a) => a.tag === 'wght')?.min} ${axes.find((a) => a.tag === 'wght')?.max}` } : {};
  const face = new FontFace(cssFamily, bytes.slice().buffer, descriptors);
  await face.load();
  document.fonts.add(face);
  const characters = [...get<number[]>('characterSet', [])].filter((cp) => cp >= 0x20 && cp !== 0x7f && !(cp >= 0x80 && cp < 0xa0)).sort((a, b) => a - b);
  const em = (v: number) => `${v} (${Math.round((v / upem) * 1000) / 10}% of the em)`;
  const metrics = [
    { label: 'Units per em', value: String(upem) },
    { label: 'Ascender', value: em(get('ascent', 0)) },
    { label: 'Descender', value: em(get('descent', 0)) },
    { label: 'Line gap', value: String(get('lineGap', 0)) },
    { label: 'Cap height', value: em(get('capHeight', 0)) },
    { label: 'x-height', value: em(get('xHeight', 0)) },
    { label: 'Italic angle', value: `${get('italicAngle', 0)}°` },
    { label: 'Underline', value: `position ${get('underlinePosition', 0)}, thickness ${get('underlineThickness', 0)}` },
  ];
  const names = [
    ['Copyright', name('copyright')],
    ['Trademark', name('trademark')],
    ['Designer', name('designer')],
    ['Designer website', name('designerURL')],
    ['Manufacturer', name('manufacturer')],
    ['Vendor website', name('vendorURL')],
    ['Vendor ID', String(os2?.vendorID ?? '').trim()],
    ['Licence', name('license')],
    ['Licence website', name('licenseURL')],
    ['Description', name('description')],
  ]
    .filter(([, v]) => v)
    .map(([label, value]) => ({ label: label as string, value: value as string }));
  return {
    fileName: file.name,
    format: formatOf(bytes),
    size: bytes.length,
    family,
    style,
    fullName: get<string | null>('fullName', null) ?? `${family} ${style}`,
    postscriptName: get<string | null>('postscriptName', null) ?? '',
    version: get<string | null>('version', null) ?? '',
    names,
    metrics,
    weight: Number(os2?.usWeightClass ?? 400),
    widthClass: Number(os2?.usWidthClass ?? 5),
    italic: !!(get<{ macStyle?: { italic?: boolean } }>('head', {}).macStyle?.italic || get('italicAngle', 0) !== 0),
    monospace: !!get<{ isFixedPitch?: boolean }>('post', {}).isFixedPitch,
    embedding: EMBEDDING(os2?.fsType as Record<string, boolean> | undefined),
    glyphs: get('numGlyphs', 0),
    characters,
    features: [...new Set(get<string[]>('availableFeatures', []))].sort(),
    axes,
    instances: Object.entries(named).map(([n, coords]) => ({ name: n, coords })),
    cssFamily,
  };
}

/** Scripts a font covers, by counting characters in their main blocks. */
function coverage(chars: readonly number[]): { name: string; have: number; total: number }[] {
  const wanted = [
    'Basic Latin',
    'Latin-1 Supplement',
    'Latin Extended-A',
    'Greek and Coptic',
    'Cyrillic',
    'Devanagari',
    'Bengali',
    'Gurmukhi',
    'Gujarati',
    'Oriya',
    'Tamil',
    'Telugu',
    'Kannada',
    'Malayalam',
    'Arabic',
    'Hebrew',
    'Thai',
    'General Punctuation',
    'Currency Symbols',
    'Arrows',
    'Mathematical Operators',
    'Box Drawing',
    'CJK Unified Ideographs',
    'Emoticons',
  ];
  const set = new Set(chars);
  return BLOCKS.filter((b) => wanted.includes(b.name))
    .map((b) => {
      let have = 0;
      for (let cp = b.start; cp <= b.end; cp++) if (set.has(cp)) have++;
      return { name: b.name, have, total: b.end - b.start + 1 };
    })
    .filter((r) => r.have > 0);
}

const WEIGHTS: Record<number, string> = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };

function fontFaceCss(info: FontInfo): string {
  const wght = info.axes.find((a) => a.tag === 'wght');
  const ext = info.format === 'WOFF2' ? 'woff2' : info.format === 'WOFF' ? 'woff' : info.format.startsWith('OpenType') ? 'otf' : 'ttf';
  const format = ext === 'otf' ? 'opentype' : ext === 'ttf' ? 'truetype' : ext;
  const file = info.fileName.replace(/\.[^.]+$/, '');
  const ranges = [];
  let start = -1;
  let prev = -2;
  for (const cp of info.characters) {
    if (cp !== prev + 1) {
      if (start >= 0) ranges.push(start === prev ? `U+${start.toString(16).toUpperCase()}` : `U+${start.toString(16).toUpperCase()}-${prev.toString(16).toUpperCase()}`);
      start = cp;
    }
    prev = cp;
  }
  if (start >= 0) ranges.push(start === prev ? `U+${start.toString(16).toUpperCase()}` : `U+${start.toString(16).toUpperCase()}-${prev.toString(16).toUpperCase()}`);
  const range = ranges.length <= 40 ? `\n  unicode-range: ${ranges.join(', ')};` : '';
  return `@font-face {
  font-family: "${info.family.replace(/"/g, '')}";
  src: url("${file}.${ext}") format("${format}");
  font-weight: ${wght ? `${wght.min} ${wght.max}` : info.weight};
  font-style: ${info.italic ? 'italic' : 'normal'};
  font-display: swap;${range}
}
`;
}

/* --------------------------------------------------------- font explorer -- */

const SAMPLE = 'The quick brown fox jumps over the lazy dog. 0123456789 — संग्रहालय में आपका स्वागत है';

function FontExplorer({ toolId }: { toolId: string }) {
  const [prefs, setPrefs] = usePersistentState(
    toolId,
    (s: Values | undefined) => ({ text: typeof s?.text === 'string' ? s.text : SAMPLE, size: typeof s?.size === 'number' ? s.size : 40 }),
    (p: { text: string; size: number }): Values => ({ ...p }),
  );
  const [info, setInfo] = useState<FontInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [axes, setAxes] = useState<Record<string, number>>({});
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);

  const open = (file: File | null) => {
    if (!file) return;
    setBusy(true);
    void attempt(async () => {
      const read = await readFont(file);
      setInfo(read);
      setAxes(Object.fromEntries(read.axes.map((a) => [a.tag, a.default])));
      setFeatures({});
      setPage(0);
    }).finally(() => setBusy(false));
  };

  const style = info
    ? {
        fontFamily: `"${info.cssFamily}", "Benchtop Sans", sans-serif`,
        fontVariationSettings: info.axes.length ? info.axes.map((a) => `"${a.tag}" ${axes[a.tag] ?? a.default}`).join(', ') : undefined,
        fontFeatureSettings: Object.entries(features).length
          ? Object.entries(features)
              .map(([tag, on]) => `"${tag}" ${on ? 1 : 0}`)
              .join(', ')
          : undefined,
      }
    : {};
  const cover = useMemo(() => (info ? coverage(info.characters) : []), [info]);
  const PER_PAGE = 512;
  const pageChars = info ? info.characters.slice(page * PER_PAGE, (page + 1) * PER_PAGE) : [];
  const pages = info ? Math.ceil(info.characters.length / PER_PAGE) : 0;

  return (
    <section class="tool fx-tool" data-testid="tool" data-state={info ? 'done' : 'idle'}>
      {!info ? (
        <button
          type="button"
          class="dropzone"
          data-testid="font-drop"
          onClick={() => attempt(async () => open(await pickFile('.ttf,.otf,.woff,.woff2,.ttc,font/*')))}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            const f = e.dataTransfer?.files[0];
            if (f) {
              e.preventDefault();
              open(f);
            }
          }}
          disabled={busy}
        >
          <Icon name="file" size={30} />
          <span class="dropzone-title">{busy ? 'Reading…' : 'Drop a font file here, or click to choose'}</span>
          <span class="dropzone-hint">TTF, OTF, WOFF or WOFF2. See its licence, metrics, features, languages and every glyph. Nothing leaves this computer.</span>
        </button>
      ) : (
        <>
          <div class="fx-head">
            <div>
              <h2 class="fx-name" style={style}>
                {info.family}
              </h2>
              <p class="fx-meta">
                {info.style} · {WEIGHTS[Math.round(info.weight / 100) * 100] ?? info.weight} ({info.weight}) · {info.format} · {Math.round(info.size / 1024)} KB · {info.glyphs} glyphs,{' '}
                {info.characters.length} characters
                {info.axes.length ? ` · variable (${info.axes.map((a) => a.tag).join(', ')})` : ''}
                {info.monospace ? ' · monospaced' : ''}
              </p>
            </div>
            <button type="button" class="button button-small" onClick={() => attempt(async () => open(await pickFile('.ttf,.otf,.woff,.woff2,.ttc,font/*')))}>
              Open another font
            </button>
          </div>

          <div class="fx-specimen">
            <div class="icon-row">
              <label class="control fx-grow">
                <span class="control-label">Sample text</span>
                <input class="input" type="text" value={prefs.text} onInput={(e) => setPrefs((p) => ({ ...p, text: e.currentTarget.value }))} data-testid="font-sample" />
              </label>
              <label class="control">
                <span class="control-label">Size {prefs.size}px</span>
                <input class="range" type="range" min={10} max={160} value={prefs.size} onInput={(e) => setPrefs((p) => ({ ...p, size: Number(e.currentTarget.value) }))} />
              </label>
            </div>
            {info.axes.length > 0 && (
              <div class="fx-axes">
                {info.instances.length > 0 && (
                  <label class="control">
                    <span class="control-label">Named style</span>
                    <select class="input" onChange={(e) => setAxes({ ...axes, ...(info.instances[Number(e.currentTarget.value)]?.coords ?? {}) })}>
                      {info.instances.map((inst, i) => (
                        <option key={inst.name} value={i}>
                          {inst.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {info.axes.map((a) => (
                  <label class="control" key={a.tag}>
                    <span class="control-label">
                      {a.name} ({a.tag}) {Math.round((axes[a.tag] ?? a.default) * 10) / 10}
                    </span>
                    <input
                      class="range"
                      type="range"
                      min={a.min}
                      max={a.max}
                      step={(a.max - a.min) / 100 || 1}
                      value={axes[a.tag] ?? a.default}
                      onInput={(e) => setAxes({ ...axes, [a.tag]: Number(e.currentTarget.value) })}
                    />
                  </label>
                ))}
              </div>
            )}
            <p class="fx-big" style={{ ...style, fontSize: `${prefs.size}px` }} data-testid="font-preview">
              {prefs.text || SAMPLE}
            </p>
            <div class="fx-waterfall" style={style}>
              {[12, 16, 20, 28, 36].map((s) => (
                <p key={s} style={{ fontSize: `${s}px` }}>
                  <span class="fx-size">{s}</span>
                  {prefs.text || SAMPLE}
                </p>
              ))}
            </div>
          </div>

          {info.features.length > 0 && (
            <fieldset class="fx-features">
              <legend>OpenType features ({info.features.length})</legend>
              {info.features.map((tag) => (
                <label class="toggle" key={tag} title={tag}>
                  <input
                    type="checkbox"
                    checked={
                      features[tag] ??
                      ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'rlig', 'clig', 'akhn', 'blwf', 'half', 'pres', 'psts', 'rphf', 'abvs', 'blws', 'nukt', 'rkrf', 'vatu', 'cjct'].includes(
                        tag,
                      )
                    }
                    onChange={(e) => setFeatures({ ...features, [tag]: e.currentTarget.checked })}
                  />
                  <span class="toggle-track" aria-hidden="true" />
                  <code>{tag}</code> {FEATURE_NAMES[tag] ?? ''}
                </label>
              ))}
            </fieldset>
          )}

          <div class="fx-columns">
            <table class="ref-table fx-table" data-testid="font-info">
              <caption>Names and licence</caption>
              <tbody>
                {[
                  { label: 'Full name', value: info.fullName },
                  { label: 'PostScript name', value: info.postscriptName },
                  { label: 'Version', value: info.version },
                  ...info.names,
                  { label: 'Embedding', value: info.embedding },
                ].map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div class="fx-side">
              <table class="ref-table fx-table">
                <caption>Metrics</caption>
                <tbody>
                  {info.metrics.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table class="ref-table fx-table">
                <caption>Languages and symbols</caption>
                <tbody>
                  {cover.map((c) => (
                    <tr key={c.name}>
                      <th scope="row">{c.name}</th>
                      <td>
                        {c.have} of {c.total}
                        {c.have === c.total ? ' (complete)' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <CodeOutput outputs={[{ label: '@font-face', language: 'css', code: fontFaceCss(info), filename: 'font-face.css' }]} baseName="font-face" />

          <div class="fx-glyph-head">
            <h3>Characters</h3>
            {pages > 1 && (
              <div class="doc-pager">
                <button type="button" class="icon-button" aria-label="Previous characters" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  <Icon name="left" size={16} />
                </button>
                <span>
                  {page * PER_PAGE + 1}–{Math.min(info.characters.length, (page + 1) * PER_PAGE)} of {info.characters.length}
                </span>
                <button type="button" class="icon-button" aria-label="Next characters" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                  <Icon name="right" size={16} />
                </button>
              </div>
            )}
          </div>
          <div class="gb-grid" style={style} data-testid="font-glyphs">
            {pageChars.map((cp) => (
              <button
                key={cp}
                type="button"
                class="gb-cell"
                title={`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`}
                aria-label={`Copy U+${cp.toString(16).toUpperCase().padStart(4, '0')}`}
                onClick={() => copyAndTell(String.fromCodePoint(cp), `Copied ${String.fromCodePoint(cp)}`)}
              >
                {String.fromCodePoint(cp)}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- glyph browser -- */

const FAMILIES = [
  { value: '"Benchtop Sans", system-ui, sans-serif', label: 'Benchtop Sans (Latin and Devanagari)' },
  { value: 'system-ui, sans-serif', label: 'System sans-serif' },
  { value: 'serif', label: 'System serif' },
  { value: '"JetBrains Mono Variable", monospace', label: 'JetBrains Mono' },
  { value: 'emoji', label: 'Emoji' },
];

interface GlyphPrefs {
  readonly block: string;
  readonly family: string;
  readonly custom: string;
}

const PER = 256;

function GlyphBrowser({ toolId }: { toolId: string }) {
  const [prefs, setPrefs] = usePersistentState(
    toolId,
    (s: Values | undefined): GlyphPrefs => ({
      block: BLOCKS.some((b) => b.name === s?.block) ? (s?.block as string) : 'Devanagari',
      family: typeof s?.family === 'string' ? s.family : (FAMILIES[0]?.value as string),
      custom: typeof s?.custom === 'string' ? s.custom : '',
    }),
    (p: GlyphPrefs): Values => ({ ...p }),
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const block = BLOCKS.find((b) => b.name === prefs.block) ?? (BLOCKS[0] as (typeof BLOCKS)[number]);
  const total = block.end - block.start + 1;
  const pages = Math.ceil(total / PER);
  const family = prefs.custom.trim() ? `"${prefs.custom.trim().replace(/"/g, '')}", ${prefs.family}` : prefs.family;

  useEffect(() => setPage(0), [prefs.block]);

  const find = () => {
    const cp = parseCodePoint(query);
    if (cp === null || cp > 0x10ffff) return notify('Type a character, or a code such as U+0905.');
    const b = blockOf(cp);
    if (b) {
      setPrefs((p) => ({ ...p, block: b.name }));
      setTimeout(() => setPage(Math.floor((cp - b.start) / PER)), 0);
    }
    setSelected(cp);
  };

  const cells = [];
  for (let cp = block.start + page * PER; cp <= Math.min(block.end, block.start + (page + 1) * PER - 1); cp++) cells.push(cp);
  const isMark = (cp: number) => /\p{M}/u.test(String.fromCodePoint(cp));

  return (
    <section class="tool gb-tool" data-testid="tool" data-state="done">
      <div class="gb-bar">
        <label class="control">
          <span class="control-label">Block</span>
          <select class="input" value={prefs.block} onChange={(e) => setPrefs((p) => ({ ...p, block: e.currentTarget.value }))} data-testid="glyph-block">
            {BLOCKS.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name} (U+{b.start.toString(16).toUpperCase().padStart(4, '0')})
              </option>
            ))}
          </select>
        </label>
        <label class="control">
          <span class="control-label">Font</span>
          <select class="input" value={prefs.family} onChange={(e) => setPrefs((p) => ({ ...p, family: e.currentTarget.value }))}>
            {FAMILIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label class="control">
          <span class="control-label">Or an installed font</span>
          <input class="input" type="text" placeholder="Noto Sans Tamil" value={prefs.custom} onInput={(e) => setPrefs((p) => ({ ...p, custom: e.currentTarget.value }))} />
        </label>
        <form
          class="control gb-find"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <span class="control-label">Find a character or code</span>
          <span class="gb-find-row">
            <input class="input" type="text" placeholder="अ or U+0905" value={query} onInput={(e) => setQuery(e.currentTarget.value)} aria-label="Find a character or code" data-testid="glyph-find" />
            <button type="submit" class="button button-small">
              Find
            </button>
          </span>
        </form>
      </div>
      <div class="gb-body">
        <div>
          {pages > 1 && (
            <div class="doc-pager">
              <button type="button" class="icon-button" aria-label="Previous characters" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <Icon name="left" size={16} />
              </button>
              <span>
                U+{(block.start + page * PER).toString(16).toUpperCase()} to U+
                {Math.min(block.end, block.start + (page + 1) * PER - 1)
                  .toString(16)
                  .toUpperCase()}{' '}
                (page {page + 1} of {pages})
              </span>
              <button type="button" class="icon-button" aria-label="Next characters" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                <Icon name="right" size={16} />
              </button>
            </div>
          )}
          <div class="gb-grid" style={{ fontFamily: family }} data-testid="glyph-grid">
            {cells.map((cp) => (
              <button
                key={cp}
                type="button"
                class={`gb-cell${selected === cp ? ' is-selected' : ''}`}
                aria-label={`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`}
                aria-pressed={selected === cp}
                onClick={() => setSelected(cp)}
              >
                {isMark(cp) ? `◌${String.fromCodePoint(cp)}` : String.fromCodePoint(cp)}
              </button>
            ))}
          </div>
        </div>
        <aside class="gb-detail" aria-live="polite" data-testid="glyph-detail">
          {selected === null ? (
            <p class="control-help">Choose a character to see how to write it in HTML, CSS, JavaScript and Python.</p>
          ) : (
            <>
              <div class="gb-char" style={{ fontFamily: family }}>
                {isMark(selected) ? `◌${String.fromCodePoint(selected)}` : String.fromCodePoint(selected)}
              </div>
              <p class="gb-block">{blockOf(selected)?.name ?? 'Other'}</p>
              <dl class="gb-codes">
                {encodings(selected).map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>
                      <code>{row.value}</code>
                      <button type="button" class="icon-button" aria-label={`Copy ${row.label}`} onClick={() => copyAndTell(row.value)}>
                        <Icon name="copy" size={14} />
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>
              <button type="button" class="button button-primary button-small" onClick={() => copyAndTell(String.fromCodePoint(selected))} data-testid="glyph-copy">
                <Icon name="copy" size={14} /> Copy the character
              </button>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function FontTools({ toolId }: { toolId: string }) {
  return toolId === 'glyph-browser' ? <GlyphBrowser toolId={toolId} /> : <FontExplorer toolId={toolId} />;
}

export default defineCustomTool(FontTools);
