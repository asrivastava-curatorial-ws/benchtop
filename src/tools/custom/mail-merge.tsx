/**
 * Certificates, Badges and Labels: mail merge from a spreadsheet to a PDF.
 * The preview is the real PDF for one row, drawn by PDF.js, with the layout's
 * items on top to select, drag and resize.
 */
import { zipSync } from 'fflate';
import Papa from 'papaparse';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../../lib/errors';
import {
  type Assets,
  fieldsUsed,
  fillTemplate,
  findPhoto,
  type Item,
  type ItemKind,
  item,
  type Layout,
  mergePdf,
  type Picture,
  PRESETS,
  type Preset,
  pageCount,
  type Row,
  type Sheet,
  sheetProblems,
  starterItems,
} from '../../lib/mail-merge';
import { openPdf, renderPage } from '../../lib/pdf-render';
import { readTableFile, TABLE_ACCEPT } from '../../lib/table-files';
import { saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { MultiDrop } from './_files';
import { clamp, nudge, Segmented, startDrag, usePersistentState } from './_shared';

const SAMPLE_CSV = `Name,School,Event,Date,ID,Role,Photo,Address,City,PIN
Ananya Rao,Kendriya Vidyalaya Hebbal,the Young Scientists Workshop,14 November 2026,VITM-2026-0101,Student,ananya.jpg,"12, 4th Cross, Malleswaram",Bengaluru,560003
Rahul Menon,National Public School,the Young Scientists Workshop,14 November 2026,VITM-2026-0102,Student,rahul.jpg,"221 Residency Road",Bengaluru,560025
Fatima Sheikh,Sophia High School,the Young Scientists Workshop,14 November 2026,VITM-2026-0103,Volunteer,fatima.jpg,"7 Lavelle Road",Bengaluru,560001
Kiran Gowda,Government High School Mysuru,the Young Scientists Workshop,14 November 2026,VITM-2026-0104,Student,kiran.jpg,"45 Sayyaji Rao Road",Mysuru,570001
प्रिया शर्मा,Kendriya Vidyalaya ASC,the Young Scientists Workshop,14 November 2026,VITM-2026-0105,Explainer,priya.jpg,"3 MG Road",Bengaluru,560001
`;

type Kind = Preset['group'];

interface State {
  readonly presetId: string;
  readonly layout: Layout;
}

const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? (PRESETS[0] as Preset);
const layoutFor = (preset: Preset): Layout => ({ card: preset.card, sheet: preset.sheet, items: starterItems(preset), cutMarks: preset.group === 'Badges', outlines: false });

const isItem = (v: unknown): v is Item => typeof v === 'object' && v !== null && typeof (v as Item).id === 'string' && ['text', 'image', 'qr', 'barcode', 'line', 'box'].includes((v as Item).kind);

function readLayout(v: unknown, fallback: Layout): Layout {
  if (typeof v !== 'object' || v === null) return fallback;
  const l = v as Partial<Layout>;
  if (!l.card || typeof l.card.w !== 'number' || typeof l.card.h !== 'number' || !Array.isArray(l.items)) return fallback;
  return {
    card: { w: l.card.w, h: l.card.h },
    sheet: l.sheet && typeof l.sheet === 'object' && Array.isArray(l.sheet.paper) ? (l.sheet as Sheet) : null,
    items: l.items.filter(isItem).map((it) => ({ ...item(it.kind), ...it })),
    cutMarks: l.cutMarks === true,
    outlines: l.outlines === true,
  };
}

const readState = (v: Values | undefined): State => {
  const preset = presetById(typeof v?.presetId === 'string' ? v.presetId : 'cert-a4');
  let layout = layoutFor(preset);
  if (typeof v?.layout === 'string') {
    try {
      layout = readLayout(JSON.parse(v.layout), layout);
    } catch {
      // keep the starter layout
    }
  }
  return { presetId: preset.id, layout };
};
const writeState = (s: State): Values => ({ presetId: s.presetId, layout: JSON.stringify(s.layout) });

const KIND_LABEL: Record<ItemKind, string> = { text: 'Text', image: 'Picture', qr: 'QR code', barcode: 'Barcode', line: 'Line', box: 'Box' };

/* ------------------------------------------------------------- pictures -- */

/** Pictures become PNG (keeps transparency) or JPEG, no larger than `max` pixels on the long side. */
async function toPicture(file: Blob, max: number): Promise<Picture> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const bitmap = await createImageBitmap(file);
  const long = Math.max(bitmap.width, bitmap.height);
  if ((isPng || isJpg) && long <= max) {
    bitmap.close();
    return { bytes, type: isPng ? 'png' : 'jpg' };
  }
  const scale = Math.min(1, max / long);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = isJpg ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error('The picture could not be converted.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: type === 'image/png' ? 'png' : 'jpg' };
}

const pictureUrl = (p: Picture) => `data:image/${p.type === 'png' ? 'png' : 'jpeg'};base64,${btoa(Array.from(p.bytes, (b) => String.fromCharCode(b)).join(''))}`;
function urlPicture(url: unknown): Picture | null {
  if (typeof url !== 'string') return null;
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(url);
  return m ? { type: m[1] === 'png' ? 'png' : 'jpg', bytes: Uint8Array.from(atob(m[2] as string), (c) => c.charCodeAt(0)) } : null;
}

/* ----------------------------------------------------------------- data -- */

function rowsFromCsv(text: string): { rows: Row[]; columns: string[] } {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  const columns = (parsed.meta.fields ?? []).filter((f) => f);
  return { rows: parsed.data.map((r) => Object.fromEntries(columns.map((c) => [c, String(r[c] ?? '').trim()]))), columns };
}

async function rowsFromFile(file: File): Promise<{ rows: Row[]; columns: string[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const [source] = await readTableFile(file.name, bytes);
  if (!source) throw new Error(`${file.name} has no rows.`);
  if (source.kind === 'csv') return rowsFromCsv(new TextDecoder().decode(source.bytes));
  if (source.kind === 'columns') {
    const columns = source.columns.map((c) => c.name);
    const count = Math.max(0, ...source.columns.map((c) => c.values.length));
    const rows = Array.from({ length: count }, (_, i) => Object.fromEntries(source.columns.map((c) => [c.name, c.values[i] === null || c.values[i] === undefined ? '' : String(c.values[i])])));
    return { rows, columns };
  }
  throw new Error('Open a CSV, Excel or JSON file.');
}

/* --------------------------------------------------------------- preview -- */

interface PreviewImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

function usePreview(layout: Layout, row: Row | undefined, index: number, assets: Assets, width: number): { image: PreviewImage | null; error: string | null } {
  const [image, setImage] = useState<PreviewImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const bytes = await mergePdf(layout, [row ?? {}], assets, { only: [0], single: true });
        const { doc, close } = await openPdf(bytes);
        try {
          const target = Math.max(200, width) * Math.min(2, window.devicePixelRatio || 1);
          const canvas = await renderPage(doc, 1, target / ((layout.card.w * 72) / 25.4));
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (cancelled || !blob) return;
          const url = URL.createObjectURL(blob);
          setImage((old) => {
            if (old) URL.revokeObjectURL(old.url);
            return { url, width: canvas.width, height: canvas.height };
          });
          setError(null);
        } finally {
          await close();
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [layout, row, index, assets, Math.round(width / 50)]);
  return { image, error };
}

/* -------------------------------------------------------------- the tool -- */

function MailMerge({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readState, writeState);
  const [data, setData] = useState<{ rows: Row[]; columns: string[]; name: string }>(() => ({ ...rowsFromCsv(SAMPLE_CSV), name: 'sample' }));
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [assets, setAssets] = useState<Assets>({});
  const [skip, setSkip] = useState(0);
  const [fileNames, setFileNames] = useState('{{Name}}');
  const [paste, setPaste] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stageWidth, setStageWidth] = useState(640);
  const stage = useRef<HTMLDivElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);

  const preset = presetById(state.presetId);
  const { layout } = state;
  const kind: Kind = preset.group;
  const rowCount = data.rows.length;
  const index = clamp(current, 0, Math.max(0, rowCount - 1));
  const row = data.rows[index];
  const { image, error } = usePreview(layout, row, index, assets, stageWidth);
  const sel = layout.items.find((it) => it.id === selected) ?? null;

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setStageWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const setLayout = (next: Layout | ((l: Layout) => Layout)) => setState((s) => ({ ...s, layout: typeof next === 'function' ? next(s.layout) : next }));
  const updateItem = (id: string, patch: Partial<Item>) => setLayout((l) => ({ ...l, items: l.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));
  const addItem = (it: Item, front = true) => {
    setLayout((l) => ({ ...l, items: front ? [...l.items, it] : [it, ...l.items] }));
    setSelected(it.id);
  };
  const removeItem = (id: string) => {
    setLayout((l) => ({ ...l, items: l.items.filter((it) => it.id !== id) }));
    setSelected(null);
  };
  const moveItem = (id: string, by: number) =>
    setLayout((l) => {
      const i = l.items.findIndex((it) => it.id === id);
      const j = clamp(i + by, 0, l.items.length - 1);
      if (i < 0 || i === j) return l;
      const items = [...l.items];
      const [it] = items.splice(i, 1);
      items.splice(j, 0, it as Item);
      return { ...l, items };
    });

  const choosePreset = (id: string) => {
    const next = presetById(id);
    setState((s) => {
      const old = presetById(s.presetId);
      if (old.group !== next.group) return { presetId: next.id, layout: layoutFor(next) };
      // Same kind of stationery: scale the design to the new card.
      const sx = next.card.w / s.layout.card.w;
      const sy = next.card.h / s.layout.card.h;
      const ss = Math.min(sx, sy);
      return {
        presetId: next.id,
        layout: {
          ...s.layout,
          card: next.card,
          sheet: next.sheet,
          items: s.layout.items.map((it) => ({ ...it, x: it.x * sx, y: it.y * sy, w: it.w * sx, h: it.h * sy, size: it.size * ss, stroke: it.stroke * ss })),
        },
      };
    });
    setSelected(null);
  };

  const loadRows = (next: { rows: Row[]; columns: string[] }, name: string) => {
    if (!next.rows.length) throw new Error(`${name} has no rows below its header.`);
    setData({ ...next, name });
    setCurrent(0);
  };

  const missing = useMemo(() => {
    const have = new Set(data.columns.map((c) => c.toLowerCase()));
    return fieldsUsed(layout).filter((f) => !have.has(f.toLowerCase()));
  }, [layout, data.columns]);

  const photoStats = useMemo(() => {
    const photoItems = layout.items.filter((it) => it.kind === 'image' && !['background', 'logo'].includes(it.text.trim().toLowerCase()));
    if (!photoItems.length || !assets.photos?.size) return null;
    const found = data.rows.filter((r, i) => photoItems.every((it) => findPhoto(assets.photos, fillTemplate(it.text, r, i)))).length;
    return { found, total: data.rows.length };
  }, [layout, data.rows, assets.photos]);

  const loadPicture = (which: 'background' | 'logo') => async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const picture = await toPicture(file, which === 'background' ? 3600 : 1600);
    setAssets((a) => ({ ...a, [which]: picture }));
    if (!layout.items.some((it) => it.kind === 'image' && it.text.trim().toLowerCase() === which)) {
      if (which === 'background') addItem(item('image', { text: 'background', x: 0, y: 0, w: layout.card.w, h: layout.card.h, fit: 'cover' }), false);
      else addItem(item('image', { text: 'logo', x: 4, y: 4, w: Math.min(30, layout.card.w / 4), h: Math.min(20, layout.card.h / 5) }));
    }
  };

  const loadPhotos = async (files: File[]) => {
    const photos = new Map(assets.photos ?? []);
    let added = 0;
    for (const file of files) {
      if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)) continue;
      try {
        const picture = await toPicture(file, 1000);
        const name = file.name.toLowerCase();
        photos.set(name, picture);
        photos.set(name.replace(/\.[^.]+$/, ''), picture);
        added++;
      } catch {
        notify(`${file.name} could not be read as a picture.`, 'error');
      }
    }
    setAssets((a) => ({ ...a, photos }));
    notify(`${added} ${added === 1 ? 'photo' : 'photos'} added`);
  };

  const loadFont = (which: 'font' | 'boldFont') => async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const tag = String.fromCharCode(...bytes.subarray(0, 4));
    if (!['\u0000\u0001\u0000\u0000', 'OTTO', 'true'].includes(tag)) throw new Error(`${file.name} is not a TrueType or OpenType font (.ttf or .otf). WOFF files must be converted first.`);
    setAssets((a) => ({ ...a, [which]: bytes }));
  };

  const baseName = kind === 'Certificates' ? 'certificates' : kind === 'Badges' ? 'badges' : 'labels';

  const savePdf = () =>
    attempt(async () => {
      if (!rowCount) throw new Error('Open a spreadsheet first: each row makes one card.');
      setBusy(true);
      try {
        const bytes = await mergePdf(layout, data.rows, assets, { skip });
        const outcome = await saveFile(`${baseName}.pdf`, bytes, 'application/pdf');
        if (outcome.saved) notify(`Saved ${rowCount} ${rowCount === 1 ? 'card' : 'cards'} to ${outcome.location}`);
      } finally {
        setBusy(false);
      }
    });

  const saveSeparate = () =>
    attempt(async () => {
      if (!rowCount) throw new Error('Open a spreadsheet first: each row makes one card.');
      setBusy(true);
      try {
        const files: Record<string, Uint8Array> = {};
        const used = new Set<string>();
        for (let i = 0; i < rowCount; i++) {
          const raw = fillTemplate(fileNames || '{{#}}', data.rows[i] ?? {}, i);
          const cleaned = [...raw].map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? ' ' : ch)).join('');
          let name = cleaned.replace(/ +/g, ' ').trim().slice(0, 100) || `card-${i + 1}`;
          let n = 2;
          const base = name;
          while (used.has(name.toLowerCase())) name = `${base} (${n++})`;
          used.add(name.toLowerCase());
          files[`${name}.pdf`] = await mergePdf(layout, data.rows, assets, { only: [i], single: true });
        }
        const outcome = await saveFile(`${baseName}.zip`, zipSync(files, { level: 0 }), 'application/zip');
        if (outcome.saved) notify(`Saved ${rowCount} PDFs to ${outcome.location}`);
      } finally {
        setBusy(false);
      }
    });

  const saveDesign = () =>
    attempt(async () => {
      const design = {
        benchtop: 'mail-merge',
        version: 1,
        presetId: state.presetId,
        layout,
        background: assets.background ? pictureUrl(assets.background) : undefined,
        logo: assets.logo ? pictureUrl(assets.logo) : undefined,
      };
      const outcome = await saveFile(`${baseName}-design.json`, JSON.stringify(design, null, 2), 'application/json');
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });

  const openDesign = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const json = JSON.parse(await file.text()) as Record<string, unknown>;
    if (json.benchtop !== 'mail-merge') throw new Error(`${file.name} is not a design saved by this tool.`);
    const p = presetById(typeof json.presetId === 'string' ? json.presetId : 'cert-a4');
    setState({ presetId: p.id, layout: readLayout(json.layout, layoutFor(p)) });
    setAssets((a) => ({ ...a, background: urlPicture(json.background), logo: urlPicture(json.logo) }));
    setSelected(null);
  };

  const insertField = (name: string) => {
    if (!sel) return;
    const field = `{{${name}}}`;
    const area = textArea.current;
    if (area && sel.kind !== 'image') {
      const start = area.selectionStart ?? sel.text.length;
      const end = area.selectionEnd ?? sel.text.length;
      updateItem(sel.id, { text: sel.text.slice(0, start) + field + sel.text.slice(end) });
      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(start + field.length, start + field.length);
      });
    } else updateItem(sel.id, { text: field });
  };

  // Dragging and resizing on the preview.
  const beginDrag = (event: PointerEvent, it: Item, mode: 'move' | 'size') => {
    const surface = stage.current?.querySelector<HTMLElement>('.mm-surface');
    if (!surface) return;
    event.stopPropagation();
    setSelected(it.id);
    const rect = surface.getBoundingClientRect();
    const fx0 = (event.clientX - rect.left) / rect.width;
    const fy0 = (event.clientY - rect.top) / rect.height;
    const snap = (v: number) => Math.round(v * 2) / 2;
    startDrag(event, surface, (fx, fy, e) => {
      const dx = (fx - fx0) * layout.card.w;
      const dy = (fy - fy0) * layout.card.h;
      const fine = e.altKey ? (v: number) => Math.round(v * 10) / 10 : snap;
      if (mode === 'move') updateItem(it.id, { x: fine(it.x + dx), y: fine(it.y + dy) });
      else updateItem(it.id, { w: Math.max(2, fine(it.w + dx)), h: it.kind === 'line' ? 0 : Math.max(2, fine(it.h + dy)) });
    });
  };

  const onBoxKey = (event: KeyboardEvent, it: Item) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeItem(it.id);
      return;
    }
    const step = nudge(event);
    if (!step) return;
    event.preventDefault();
    // nudge() gives 1, or 10 with Shift: half a millimetre or 5 mm.
    updateItem(it.id, { x: Math.round((it.x + step.dx * 0.5) * 10) / 10, y: Math.round((it.y + step.dy * 0.5) * 10) / 10 });
  };

  const problems = sheetProblems(layout);
  const pages = pageCount(layout, rowCount, skip);
  const num = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

  return (
    <section class="tool mm-tool" data-testid="tool" data-state={image ? 'done' : 'idle'}>
      <div class="button-row mm-top">
        <MultiDrop
          icon="file"
          compact
          accept={TABLE_ACCEPT}
          title="Open spreadsheet"
          testId="mm-open"
          onFiles={(f) => f[0] && void attempt(async () => loadRows(await rowsFromFile(f[0] as File), (f[0] as File).name))}
        />
        <button type="button" class="button button-quiet" onClick={() => setPaste(paste === null ? '' : null)} aria-expanded={paste !== null}>
          <Icon name="paste" size={14} /> Paste rows
        </button>
        <button type="button" class="button button-quiet" onClick={() => loadRows(rowsFromCsv(SAMPLE_CSV), 'sample')} data-testid="mm-sample">
          <Icon name="sample" size={14} /> Sample rows
        </button>
        <label class="control control-inline mm-preset">
          <span class="control-label">Stationery</span>
          <select class="select" value={state.presetId} onChange={(e) => choosePreset(e.currentTarget.value)} data-testid="mm-preset">
            {(['Certificates', 'Badges', 'Labels'] as const).map((group) => (
              <optgroup key={group} label={group}>
                {PRESETS.filter((p) => p.group === group).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <span class="mm-design">
          <MultiDrop icon="file" compact accept=".json,application/json" title="Open design" onFiles={(f) => void attempt(() => openDesign(f))} />
          <button type="button" class="button button-quiet" onClick={saveDesign}>
            <Icon name="save" size={14} /> Save design
          </button>
          <button
            type="button"
            class="button button-quiet"
            onClick={() => {
              setLayout(layoutFor(preset));
              setSelected(null);
            }}
          >
            Start again
          </button>
        </span>
      </div>
      {paste !== null && (
        <div class="mm-paste">
          <textarea
            class="input"
            rows={5}
            value={paste}
            placeholder={'Name,School\nAnanya Rao,KV Hebbal'}
            aria-label="Rows to paste (CSV or copied from a spreadsheet)"
            onInput={(e) => setPaste(e.currentTarget.value)}
            data-testid="mm-paste"
          />
          <button
            type="button"
            class="button"
            onClick={() =>
              attempt(() => {
                loadRows(rowsFromCsv(paste), 'pasted rows');
                setPaste(null);
              })
            }
            data-testid="mm-paste-use"
          >
            Use these rows
          </button>
          <span class="control-help">Paste CSV, or cells copied from a spreadsheet (tab-separated). The first row names the columns.</span>
        </div>
      )}
      <div class="mm-layout">
        <aside class="mm-side">
          <div class="mm-panel" data-testid="mm-data">
            <h3>Data</h3>
            <p class="tone-muted">
              {rowCount} {rowCount === 1 ? 'row' : 'rows'} from {data.name}
            </p>
            <div class="mm-fields" role="group" aria-label="Insert a field">
              {data.columns.map((c) => (
                <button
                  key={c}
                  type="button"
                  class="chip"
                  disabled={!sel || sel.kind === 'line' || sel.kind === 'box'}
                  title={sel ? `Insert {{${c}}}` : 'Select a text, picture or code first'}
                  onClick={() => insertField(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            {missing.length > 0 && (
              <p class="mm-warn" role="status" data-testid="mm-missing">
                The data has no {missing.map((m) => `“${m}”`).join(', ')} column{missing.length === 1 ? '' : 's'}; those fields print empty.
              </p>
            )}
          </div>
          <div class="mm-panel">
            <h3>Items</h3>
            <div class="mm-add" role="group" aria-label="Add">
              {(['text', 'image', 'qr', 'barcode', 'line', 'box'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  class="button button-small"
                  onClick={() =>
                    addItem(
                      item(k, {
                        x: layout.card.w * 0.1,
                        y: layout.card.h * 0.4,
                        w: k === 'qr' ? Math.min(20, layout.card.h * 0.4) : layout.card.w * 0.5,
                        h: k === 'line' ? 0 : k === 'qr' ? Math.min(20, layout.card.h * 0.4) : Math.min(12, layout.card.h * 0.2),
                        size: Math.min(14, layout.card.h * 0.3),
                        text: k === 'image' ? (data.columns.find((c) => /photo|picture|image/i.test(c)) ? `{{${data.columns.find((c) => /photo|picture|image/i.test(c))}}}` : 'logo') : undefined,
                      }),
                    )
                  }
                >
                  + {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <ol class="mm-items" data-testid="mm-items">
              {layout.items.map((it) => (
                <li key={it.id}>
                  <button type="button" class={`mm-item${it.id === selected ? ' is-active' : ''}`} aria-pressed={it.id === selected} onClick={() => setSelected(it.id === selected ? null : it.id)}>
                    <span class="mm-item-kind">{KIND_LABEL[it.kind]}</span>
                    <span class="mm-item-text">{it.kind === 'line' || it.kind === 'box' ? `${num(it.w)} × ${num(it.h)} mm` : it.text.split('\n')[0]}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div class="mm-panel">
            <h3>Pictures and fonts</h3>
            <div class="mm-assets">
              <MultiDrop
                icon="image"
                compact
                accept="image/*"
                title={assets.background ? 'Background ✓' : 'Background picture'}
                onFiles={(f) => void attempt(() => loadPicture('background')(f))}
                testId="mm-background"
              />
              <MultiDrop icon="image" compact accept="image/*" title={assets.logo ? 'Logo ✓' : 'Logo'} onFiles={(f) => void attempt(() => loadPicture('logo')(f))} testId="mm-logo" />
              <MultiDrop
                icon="image"
                compact
                accept="image/*"
                title={assets.photos?.size ? `Photos (${new Set(assets.photos.values()).size})` : 'Photos'}
                onFiles={(f) => void attempt(() => loadPhotos(f))}
                testId="mm-photos"
              />
              <MultiDrop
                icon="file"
                compact
                accept=".ttf,.otf,font/ttf,font/otf"
                title={assets.font ? 'Font ✓' : 'Font file'}
                onFiles={(f) => void attempt(() => loadFont('font')(f))}
                testId="mm-font"
              />
              {assets.font && (
                <MultiDrop
                  icon="file"
                  compact
                  accept=".ttf,.otf,font/ttf,font/otf"
                  title={assets.boldFont ? 'Bold font ✓' : 'Bold font file'}
                  onFiles={(f) => void attempt(() => loadFont('boldFont')(f))}
                />
              )}
            </div>
            {photoStats && (
              <p class="tone-muted" data-testid="mm-photo-stats">
                Photos found for {photoStats.found} of {photoStats.total} rows (matched by file name).
              </p>
            )}
            <p class="control-help">Text is set in Benchtop Sans (English and Hindi). For Kannada, Tamil or other scripts, add a font file such as Noto Sans Kannada.</p>
            {(assets.background || assets.logo || assets.photos?.size || assets.font) && (
              <button type="button" class="button button-small button-quiet" onClick={() => setAssets({})}>
                Remove pictures and fonts
              </button>
            )}
          </div>
        </aside>
        <div class="mm-main">
          <div class="mm-nav button-row">
            <button type="button" class="icon-button" aria-label="Previous row" disabled={index <= 0} onClick={() => setCurrent(index - 1)}>
              <Icon name="left" size={16} />
            </button>
            <span data-testid="mm-record">
              Row {rowCount ? index + 1 : 0} of {rowCount}
              {row && <span class="tone-muted"> · {Object.values(row).find((v) => v) ?? ''}</span>}
            </span>
            <button type="button" class="icon-button" aria-label="Next row" disabled={index >= rowCount - 1} onClick={() => setCurrent(index + 1)}>
              <Icon name="right" size={16} />
            </button>
            <span class="control-help mm-hint">Drag items to move them; drag the corner to resize. Arrow keys nudge, Delete removes.</span>
          </div>
          <div ref={stage} class="mm-stage" onPointerDown={() => setSelected(null)}>
            <div class="mm-surface" style={{ aspectRatio: `${layout.card.w} / ${layout.card.h}` }} data-testid="mm-preview">
              {image && <img src={image.url} alt={`Preview of row ${index + 1}`} draggable={false} />}
              {layout.items.map((it) => {
                const isLine = it.kind === 'line';
                const top = isLine ? it.y - 1 : it.y;
                const height = isLine ? 2 : it.h;
                return (
                  <div
                    key={it.id}
                    class={`mm-box${it.id === selected ? ' is-selected' : ''}`}
                    style={{
                      left: `${(it.x / layout.card.w) * 100}%`,
                      top: `${(top / layout.card.h) * 100}%`,
                      width: `${(it.w / layout.card.w) * 100}%`,
                      height: `${(height / layout.card.h) * 100}%`,
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${KIND_LABEL[it.kind]}: ${it.text.split('\n')[0] || 'item'}`}
                    aria-pressed={it.id === selected}
                    onPointerDown={(e) => beginDrag(e, it, 'move')}
                    onKeyDown={(e) => onBoxKey(e, it)}
                    onFocus={() => setSelected(it.id)}
                  >
                    {it.id === selected && <span class="mm-handle" aria-hidden="true" onPointerDown={(e) => beginDrag(e, it, 'size')} />}
                  </div>
                );
              })}
            </div>
          </div>
          {error && (
            <p class="recipe-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <aside class="mm-side mm-props">
          {sel ? (
            <div class="mm-panel" data-testid="mm-props">
              <h3>{KIND_LABEL[sel.kind]}</h3>
              {(sel.kind === 'text' || sel.kind === 'qr' || sel.kind === 'barcode') && (
                <label class="control">
                  <span class="control-label">{sel.kind === 'text' ? 'Text' : 'Content'}</span>
                  <textarea
                    ref={textArea}
                    class="input"
                    rows={sel.kind === 'text' ? 3 : 2}
                    value={sel.text}
                    onInput={(e) => updateItem(sel.id, { text: e.currentTarget.value })}
                    data-testid="mm-text"
                  />
                  <span class="control-help">
                    {'{{Column}}'} is replaced by each row's value; add |upper, |lower or |title to change the case. {'{{#}}'} is the row number.
                  </span>
                </label>
              )}
              {sel.kind === 'image' && (
                <label class="control">
                  <span class="control-label">Picture</span>
                  <select
                    class="select"
                    value={['background', 'logo'].includes(sel.text.trim().toLowerCase()) ? sel.text.trim().toLowerCase() : 'photo'}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      const photoColumn = data.columns.find((c) => /photo|picture|image/i.test(c)) ?? data.columns[0] ?? 'Photo';
                      updateItem(sel.id, { text: v === 'photo' ? `{{${photoColumn}}}` : v, fit: v === 'background' ? 'cover' : sel.fit });
                    }}
                  >
                    <option value="background">Background picture</option>
                    <option value="logo">Logo</option>
                    <option value="photo">Photo named in a column</option>
                  </select>
                  {!['background', 'logo'].includes(sel.text.trim().toLowerCase()) && (
                    <input class="input" value={sel.text} aria-label="Photo file name" onInput={(e) => updateItem(sel.id, { text: e.currentTarget.value })} />
                  )}
                </label>
              )}
              <div class="mm-grid">
                {(['x', 'y', 'w', 'h'] as const)
                  .filter((k) => !(sel.kind === 'line' && k === 'h'))
                  .map((k) => (
                    <label key={k} class="control">
                      <span class="control-label">{{ x: 'Left', y: 'Top', w: 'Width', h: 'Height' }[k]} (mm)</span>
                      <input class="input" type="number" step={0.5} value={num(sel[k])} onInput={(e) => updateItem(sel.id, { [k]: Number(e.currentTarget.value) || 0 })} />
                    </label>
                  ))}
              </div>
              {sel.kind === 'text' && (
                <>
                  <div class="mm-grid">
                    <label class="control">
                      <span class="control-label">Size (pt)</span>
                      <input
                        class="input"
                        type="number"
                        step={0.5}
                        min={4}
                        max={200}
                        value={num(sel.size)}
                        onInput={(e) => updateItem(sel.id, { size: clamp(Number(e.currentTarget.value) || 12, 4, 200) })}
                        data-testid="mm-size"
                      />
                    </label>
                    <label class="control">
                      <span class="control-label">Colour</span>
                      <input type="color" value={sel.color} onInput={(e) => updateItem(sel.id, { color: e.currentTarget.value })} />
                    </label>
                  </div>
                  <Segmented
                    label="Alignment"
                    value={sel.align}
                    onChange={(align) => updateItem(sel.id, { align })}
                    choices={[
                      { value: 'left', label: 'Left' },
                      { value: 'center', label: 'Centre' },
                      { value: 'right', label: 'Right' },
                    ]}
                  />
                  <label class="check">
                    <input type="checkbox" checked={sel.bold} onChange={(e) => updateItem(sel.id, { bold: e.currentTarget.checked })} /> Bold
                  </label>
                  <p class="control-help">Long text gets smaller (down to half size), then wraps, to stay inside its box.</p>
                </>
              )}
              {(sel.kind === 'qr' || sel.kind === 'barcode' || sel.kind === 'line') && (
                <label class="control control-inline">
                  <span class="control-label">Colour</span>
                  <input type="color" value={sel.color} onInput={(e) => updateItem(sel.id, { color: e.currentTarget.value })} />
                </label>
              )}
              {(sel.kind === 'line' || sel.kind === 'box') && (
                <label class="control control-inline">
                  <span class="control-label">{sel.kind === 'line' ? 'Thickness' : 'Border'} (mm)</span>
                  <input
                    class="input input-narrow"
                    type="number"
                    step={0.1}
                    min={0}
                    value={sel.stroke}
                    onInput={(e) => updateItem(sel.id, { stroke: Math.max(0, Number(e.currentTarget.value) || 0) })}
                  />
                </label>
              )}
              {sel.kind === 'box' && (
                <div class="mm-grid">
                  <label class="control">
                    <span class="control-label">Border colour</span>
                    <input type="color" value={sel.color} onInput={(e) => updateItem(sel.id, { color: e.currentTarget.value })} />
                  </label>
                  <label class="control">
                    <span class="control-label">
                      <input type="checkbox" checked={!!sel.fill} onChange={(e) => updateItem(sel.id, { fill: e.currentTarget.checked ? '#e8f0ec' : '' })} /> Fill
                    </span>
                    {sel.fill && <input type="color" value={sel.fill} onInput={(e) => updateItem(sel.id, { fill: e.currentTarget.value })} />}
                  </label>
                </div>
              )}
              {sel.kind === 'image' && (
                <Segmented
                  label="Fit"
                  value={sel.fit}
                  onChange={(fit) => updateItem(sel.id, { fit })}
                  choices={[
                    { value: 'contain', label: 'Whole picture' },
                    { value: 'cover', label: 'Fill the box' },
                  ]}
                />
              )}
              <div class="button-row">
                <button type="button" class="button button-small" onClick={() => moveItem(sel.id, 1)} title="Draw later, on top of other items">
                  Bring forward
                </button>
                <button type="button" class="button button-small" onClick={() => moveItem(sel.id, -1)} title="Draw earlier, under other items">
                  Send back
                </button>
                <button type="button" class="button button-small" onClick={() => addItem({ ...sel, id: item(sel.kind).id, x: sel.x + 3, y: sel.y + 3 })}>
                  Duplicate
                </button>
                <button type="button" class="button button-small button-danger" onClick={() => removeItem(sel.id)}>
                  <Icon name="trash" size={13} /> Delete
                </button>
              </div>
            </div>
          ) : (
            <div class="mm-panel">
              <h3>Card</h3>
              <p class="tone-muted">
                {num(layout.card.w)} × {num(layout.card.h)} mm
                {layout.sheet ? `, ${layout.sheet.cols * layout.sheet.rows} to a ${layout.sheet.paper[0] === 210 ? 'A4' : 'Letter'} sheet` : ', one per page'}
              </p>
              <p class="control-help">Select an item on the card or in the list to change it.</p>
              <details class="mm-sizes">
                <summary>Card and sheet sizes</summary>
                <div class="mm-grid">
                  {(['w', 'h'] as const).map((k) => (
                    <label key={k} class="control">
                      <span class="control-label">Card {k === 'w' ? 'width' : 'height'} (mm)</span>
                      <input
                        class="input"
                        type="number"
                        step={0.1}
                        value={num(layout.card[k], 2)}
                        onInput={(e) => setLayout((l) => ({ ...l, card: { ...l.card, [k]: Math.max(5, Number(e.currentTarget.value) || 5) } }))}
                      />
                    </label>
                  ))}
                  {layout.sheet &&
                    (['cols', 'rows', 'left', 'top', 'pitchX', 'pitchY'] as const).map((k) => (
                      <label key={k} class="control">
                        <span class="control-label">{{ cols: 'Across', rows: 'Down', left: 'Left margin (mm)', top: 'Top margin (mm)', pitchX: 'Step across (mm)', pitchY: 'Step down (mm)' }[k]}</span>
                        <input
                          class="input"
                          type="number"
                          step={k === 'cols' || k === 'rows' ? 1 : 0.05}
                          min={k === 'cols' || k === 'rows' ? 1 : 0}
                          value={num(layout.sheet?.[k] ?? 0, 2)}
                          onInput={(e) => {
                            const v = Number(e.currentTarget.value) || 0;
                            setLayout((l) => (l.sheet ? { ...l, sheet: { ...l.sheet, [k]: k === 'cols' || k === 'rows' ? Math.max(1, Math.round(v)) : Math.max(0, v) } } : l));
                          }}
                        />
                      </label>
                    ))}
                </div>
                <p class="control-help">“Step” is the distance from one card's edge to the same edge of the next: the card size plus the gap.</p>
              </details>
              {problems.map((p) => (
                <p key={p} class="mm-warn" role="status">
                  {p}
                </p>
              ))}
            </div>
          )}
          <div class="mm-panel mm-output">
            <h3>Save</h3>
            {layout.sheet && (
              <>
                <label class="check">
                  <input type="checkbox" checked={layout.cutMarks} onChange={(e) => setLayout((l) => ({ ...l, cutMarks: e.currentTarget.checked }))} /> Cut marks
                </label>
                <label class="check">
                  <input type="checkbox" checked={layout.outlines} onChange={(e) => setLayout((l) => ({ ...l, outlines: e.currentTarget.checked }))} /> Card outlines (for a test print)
                </label>
                <label class="control control-inline">
                  <span class="control-label">Skip the first</span>
                  <input
                    class="input input-narrow"
                    type="number"
                    min={0}
                    max={layout.sheet.cols * layout.sheet.rows - 1}
                    value={skip}
                    onInput={(e) => setSkip(clamp(Math.round(Number(e.currentTarget.value) || 0), 0, (layout.sheet?.cols ?? 1) * (layout.sheet?.rows ?? 1) - 1))}
                  />
                  <span class="tone-muted">positions (already used)</span>
                </label>
              </>
            )}
            <p class="tone-muted" data-testid="mm-pages">
              {rowCount} {rowCount === 1 ? 'card' : 'cards'} on {pages} {pages === 1 ? 'page' : 'pages'}
            </p>
            <button type="button" class="button button-primary" disabled={busy || !rowCount} onClick={savePdf} data-testid="mm-save">
              <Icon name="save" size={15} /> {busy ? 'Making the PDF…' : 'Save PDF'}
            </button>
            {kind === 'Certificates' && (
              <>
                <label class="control">
                  <span class="control-label">File names for separate PDFs</span>
                  <input class="input" value={fileNames} onInput={(e) => setFileNames(e.currentTarget.value)} />
                </label>
                <button type="button" class="button" disabled={busy || !rowCount} onClick={saveSeparate} data-testid="mm-zip">
                  One PDF per row (ZIP)
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

export default defineCustomTool(MailMerge);
