/**
 * PDF tools that run in the page with pdf-lib and PDF.js: merge and organise
 * pages, split, stamp (watermark, page numbers, header or footer), edit
 * properties, and convert between pictures and PDF.  Nothing is uploaded.
 */

import { zipSync } from 'fflate';
import type { PDFDocument } from 'pdf-lib';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { formatBytes } from '../../lib/bytes';
import { jpegOrientation } from '../../lib/metadata';
import {
  assemble,
  type Corner,
  ENCRYPTED_MESSAGE,
  extractPages,
  loadPdf,
  type PageRef,
  type PageSize,
  type PdfFacts,
  type PdfInfo,
  parsePages,
  picturesToPdf,
  planSplit,
  readInfo,
  type SplitMode,
  stampPdf,
  stampPreview,
  writeInfo,
} from '../../lib/pdf-edit';
import { openPdf, renderPage } from '../../lib/pdf-render';
import { pickFiles, saveFile } from '../../platform';
import { encodeCanvas, loadImage, replaceExtension } from '../../ui/canvas';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

const MAX_PDF = 300 * 1024 * 1024;

interface PdfFile {
  readonly id: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly doc: PDFDocument;
  readonly pages: number;
}

let ids = 0;

async function readPdf(file: File): Promise<PdfFile> {
  if (file.size > MAX_PDF) throw new Error(`${file.name} is larger than 300 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = await loadPdf(bytes);
    return { id: `pdf-${ids++}`, name: file.name, bytes, doc, pages: doc.getPageCount() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message === ENCRYPTED_MESSAGE ? `${file.name}: ${message}` : message);
  }
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'document';

async function save(name: string, bytes: Uint8Array, mime = 'application/pdf') {
  const saved = await saveFile(name, bytes, mime);
  if (saved.saved) notify(`Saved to ${saved.location}`);
}

/** A drop area that also opens the file picker. */
function FileDrop({
  accept,
  multiple,
  onFiles,
  title,
  hint,
  compact = false,
  testId,
}: {
  accept: string;
  multiple: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint?: string;
  compact?: boolean;
  testId?: string;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <button
      type="button"
      class={`dropzone${compact ? ' dropzone-compact' : ''}${dragging ? ' is-dragging' : ''}`}
      data-testid={testId}
      onClick={() =>
        attempt(async () => {
          const files = await pickFiles(accept);
          if (files.length) onFiles(multiple ? files : files.slice(0, 1));
        })
      }
      onDragOver={(event) => {
        if (event.dataTransfer?.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        setDragging(false);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length) {
          event.preventDefault();
          onFiles(multiple ? files : files.slice(0, 1));
        }
      }}
    >
      <Icon name="file" size={compact ? 20 : 30} />
      <span class="dropzone-title">{title}</span>
      {hint && <span class="dropzone-hint">{hint}</span>}
    </button>
  );
}

/** Page pictures for a PDF, drawn one after another so the first appear quickly. */
function useThumbnails(file: PdfFile | null, width = 150, limit = 400): readonly string[] {
  const [thumbs, setThumbs] = useState<string[]>([]);
  useEffect(() => {
    setThumbs([]);
    if (!file) return;
    let cancelled = false;
    let close: (() => Promise<void>) | null = null;
    void (async () => {
      try {
        const opened = await openPdf(file.bytes);
        close = opened.close;
        const count = Math.min(file.pages, limit);
        for (let n = 1; n <= count && !cancelled; n++) {
          const page = await opened.doc.getPage(n);
          const scale = width / page.getViewport({ scale: 1 }).width;
          const canvas = await renderPage(opened.doc, n, scale);
          if (cancelled) break;
          const url = canvas.toDataURL('image/jpeg', 0.72);
          setThumbs((list) => {
            const next = [...list];
            next[n - 1] = url;
            return next;
          });
        }
      } catch {
        // Thumbnails are a convenience; the tools still work without them.
      }
    })();
    return () => {
      cancelled = true;
      void close?.();
    };
  }, [file, width, limit]);
  return thumbs;
}

function FileBar({ file, onReplace, onClear }: { file: PdfFile; onReplace: () => void; onClear: () => void }) {
  return (
    <div class="image-source">
      <Icon name="file" size={18} />
      <div class="image-source-text">
        <div class="file-name">{file.name}</div>
        <div class="file-meta">
          {file.pages} page{file.pages === 1 ? '' : 's'}, {formatBytes(file.bytes.length)}
        </div>
      </div>
      <button type="button" class="button button-small" onClick={onReplace}>
        Replace
      </button>
      <button type="button" class="button button-small button-quiet" onClick={onClear}>
        Remove
      </button>
    </div>
  );
}

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

function useSinglePdf(): [PdfFile | null, (files: File[]) => void, () => void, boolean] {
  const [file, setFile] = useState<PdfFile | null>(null);
  const [loading, setLoading] = useState(false);
  const take = (files: File[]) => {
    const first = files[0];
    if (!first) return;
    setLoading(true);
    void attempt(async () => setFile(await readPdf(first))).finally(() => setLoading(false));
  };
  useIncomingFiles(take, isPdf);
  return [file, take, () => setFile(null), loading];
}

/* --------------------------------------------------------- organise -- */

interface PageCard extends PageRef {
  readonly key: string;
}

let cardIds = 0;

function Organise() {
  const [sources, setSources] = useState<PdfFile[]>([]);
  const [cards, setCards] = useState<PageCard[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [dragged, setDragged] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = (files: File[]) =>
    void attempt(async () => {
      setBusy(true);
      try {
        const loaded: PdfFile[] = [];
        for (const file of files) loaded.push(await readPdf(file));
        setSources((list) => {
          const offset = list.length;
          setCards((current) => [...current, ...loaded.flatMap((pdf, i) => Array.from({ length: pdf.pages }, (_, index) => ({ key: `card-${cardIds++}`, source: offset + i, index, rotate: 0 })))]);
          return [...list, ...loaded];
        });
        for (const pdf of loaded) void drawThumbs(pdf);
      } finally {
        setBusy(false);
      }
    });
  useIncomingFiles(add, isPdf);

  const drawThumbs = async (pdf: PdfFile) => {
    try {
      const { doc, close } = await openPdf(pdf.bytes);
      for (let n = 1; n <= Math.min(pdf.pages, 500); n++) {
        const page = await doc.getPage(n);
        const canvas = await renderPage(doc, n, 140 / page.getViewport({ scale: 1 }).width);
        const url = canvas.toDataURL('image/jpeg', 0.72);
        setThumbs((t) => ({ ...t, [`${pdf.id}:${n - 1}`]: url }));
      }
      await close();
    } catch {
      // Pages without pictures still work.
    }
  };

  const move = (key: string, to: number) =>
    setCards((list) => {
      const from = list.findIndex((c) => c.key === key);
      if (from < 0 || to < 0 || to >= list.length || from === to) return list;
      const next = [...list];
      const [card] = next.splice(from, 1);
      next.splice(to, 0, card);
      return next;
    });
  const turn = (key: string | null, by: number) => setCards((list) => list.map((c) => (key === null || c.key === key ? { ...c, rotate: (((c.rotate + by) % 360) + 360) % 360 } : c)));
  const removeSource = (index: number) => {
    setCards((list) => list.filter((c) => c.source !== index).map((c) => (c.source > index ? { ...c, source: c.source - 1 } : c)));
    setSources((list) => list.filter((_, i) => i !== index));
  };

  const name = sources.length === 1 ? `${stem(sources[0].name)} (edited).pdf` : 'merged.pdf';
  const doSave = () =>
    void attempt(async () => {
      setBusy(true);
      try {
        await save(
          name,
          await assemble(
            sources.map((s) => s.doc),
            cards,
          ),
        );
      } finally {
        setBusy(false);
      }
    });

  if (!sources.length) {
    return (
      <div data-testid="tool" class="tool">
        <FileDrop
          accept=".pdf,application/pdf"
          multiple
          onFiles={add}
          title={busy ? 'Reading…' : 'Drop PDFs here, or click to choose'}
          hint="Add one PDF to reorder, rotate or delete pages, or several to merge them. Nothing leaves this computer."
          testId="pdf-drop"
        />
      </div>
    );
  }
  return (
    <div data-testid="tool" class="tool pdf-tool">
      <div class="pdf-side">
        <ul class="pdf-sources">
          {sources.map((s, i) => (
            <li key={s.id}>
              <span class="pdf-source-mark" data-source={i % 6} aria-hidden="true" />
              <span class="pdf-source-name">{s.name}</span>
              <span class="tone-muted">{s.pages} p.</span>
              <button type="button" class="icon-button" aria-label={`Remove ${s.name}`} onClick={() => removeSource(i)}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
        <FileDrop accept=".pdf,application/pdf" multiple compact onFiles={add} title="Add more PDFs" />
        <div class="button-row">
          <button type="button" class="button" onClick={() => turn(null, -90)}>
            <Icon name="rotate-left" size={15} /> All
          </button>
          <button type="button" class="button" onClick={() => turn(null, 90)}>
            <Icon name="rotate-right" size={15} /> All
          </button>
          <button type="button" class="button" onClick={() => setCards((list) => [...list].reverse())}>
            Reverse
          </button>
        </div>
        <p class="tone-muted pdf-note">
          {cards.length} page{cards.length === 1 ? '' : 's'}. Drag pages to reorder them.
        </p>
        <button type="button" class="button button-primary" disabled={busy || !cards.length} onClick={doSave} data-testid="pdf-save">
          {busy ? 'Working…' : sources.length > 1 ? 'Save merged PDF' : 'Save PDF'}
        </button>
      </div>
      <ol class="pdf-grid" aria-label="Pages">
        {cards.map((card, position) => {
          const source = sources[card.source];
          const thumb = thumbs[`${source?.id}:${card.index}`];
          return (
            <li
              key={card.key}
              class={`pdf-page${dragged === card.key ? ' is-dragged' : ''}`}
              draggable
              onDragStart={(event) => {
                setDragged(card.key);
                event.dataTransfer?.setData('text/plain', card.key);
              }}
              onDragEnd={() => setDragged(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged) move(dragged, position);
                setDragged(null);
              }}
            >
              <div class="pdf-thumb">
                {thumb ? <img src={thumb} alt="" style={{ transform: `rotate(${card.rotate}deg)${card.rotate % 180 ? ' scale(0.78)' : ''}` }} /> : <span class="spinner" aria-hidden="true" />}
              </div>
              <div class="pdf-page-label">
                <span class="pdf-source-mark" data-source={card.source % 6} aria-hidden="true" />
                {position + 1}
                <span class="tone-muted">
                  {' '}
                  ({sources.length > 1 ? `${stem(source?.name ?? '')} ` : 'p. '}
                  {card.index + 1})
                </span>
              </div>
              <div class="pdf-page-actions">
                <button type="button" class="icon-button" aria-label={`Move page ${position + 1} earlier`} disabled={position === 0} onClick={() => move(card.key, position - 1)}>
                  <Icon name="left" size={14} />
                </button>
                <button type="button" class="icon-button" aria-label={`Rotate page ${position + 1} left`} onClick={() => turn(card.key, -90)}>
                  <Icon name="rotate-left" size={14} />
                </button>
                <button type="button" class="icon-button" aria-label={`Rotate page ${position + 1} right`} onClick={() => turn(card.key, 90)}>
                  <Icon name="rotate-right" size={14} />
                </button>
                <button type="button" class="icon-button" aria-label={`Delete page ${position + 1}`} onClick={() => setCards((list) => list.filter((c) => c.key !== card.key))}>
                  <Icon name="trash" size={14} />
                </button>
                <button type="button" class="icon-button" aria-label={`Move page ${position + 1} later`} disabled={position === cards.length - 1} onClick={() => move(card.key, position + 1)}>
                  <Icon name="right" size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------ split -- */

interface SplitSettings {
  readonly mode: SplitMode;
  readonly size: number;
  readonly ranges: string;
}

const readSplit = (s: Values | undefined): SplitSettings => ({
  mode: (['every', 'chunks', 'ranges', 'extract', 'remove'] as const).find((m) => m === s?.mode) ?? 'ranges',
  size: typeof s?.size === 'number' && s.size >= 1 ? Math.floor(s.size) : 2,
  ranges: typeof s?.ranges === 'string' ? s.ranges : '1-3, 4-',
});

function Split({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<SplitSettings>(`${toolId}`, readSplit, (s) => ({ ...s }));
  const [file, take, clear, loading] = useSinglePdf();
  const thumbs = useThumbnails(file, 110);
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => {
    if (!file) return { parts: [], error: '' };
    try {
      return { parts: planSplit(settings.mode, file.pages, { size: settings.size, ranges: settings.ranges }, stem(file.name)), error: '' };
    } catch (error) {
      return { parts: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [file, settings]);
  const included = useMemo(() => new Set(plan.parts.flatMap((p) => p.pages)), [plan]);

  const run = () =>
    void attempt(async () => {
      if (!file || !plan.parts.length) return;
      setBusy(true);
      try {
        if (plan.parts.length === 1) {
          await save(plan.parts[0].name, await extractPages(file.doc, plan.parts[0].pages));
          return;
        }
        const files: Record<string, Uint8Array> = {};
        for (const part of plan.parts) files[part.name] = await extractPages(file.doc, part.pages);
        // PDFs are already compressed; storing them is faster and as small.
        await save(`${stem(file.name)} (split).zip`, zipSync(files, { level: 0 }), 'application/zip');
      } finally {
        setBusy(false);
      }
    });

  const pick = () => attempt(async () => take(await pickFiles('.pdf,application/pdf')));
  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        {file ? <FileBar file={file} onReplace={pick} onClear={clear} /> : null}
        <div class="control">
          <span class="control-label">Split into</span>
          <select class="input" value={settings.mode} onChange={(e) => setSettings((s) => ({ ...s, mode: e.currentTarget.value as SplitMode }))} data-testid="split-mode" aria-label="Split into">
            <option value="ranges">Files by page ranges</option>
            <option value="every">One file per page</option>
            <option value="chunks">Files of a fixed number of pages</option>
            <option value="extract">One file with chosen pages</option>
            <option value="remove">The PDF without some pages</option>
          </select>
        </div>
        {settings.mode === 'chunks' && (
          <div class="control">
            <label class="control-label" for="split-size">
              Pages per file
            </label>
            <input
              id="split-size"
              class="input input-number"
              type="number"
              min={1}
              value={settings.size}
              onInput={(e) => setSettings((s) => ({ ...s, size: Math.max(1, Number(e.currentTarget.value) || 1) }))}
            />
          </div>
        )}
        {(settings.mode === 'ranges' || settings.mode === 'extract' || settings.mode === 'remove') && (
          <div class="control">
            <label class="control-label" for="split-ranges">
              {settings.mode === 'ranges' ? 'Ranges (each becomes a file)' : settings.mode === 'extract' ? 'Pages to keep, in this order' : 'Pages to remove'}
            </label>
            <input
              id="split-ranges"
              class="input input-mono"
              value={settings.ranges}
              onInput={(e) => setSettings((s) => ({ ...s, ranges: e.currentTarget.value }))}
              placeholder="1-3, 4-10, 11-"
              data-testid="split-ranges"
            />
            <span class="control-hint tone-muted">Commas separate parts. 8- means page 8 to the end; odd, even and last also work.</span>
          </div>
        )}
        {plan.error && <p class="recipe-error">{plan.error}</p>}
        {plan.parts.length > 0 && (
          <ul class="pdf-plan" data-testid="split-plan">
            {plan.parts.slice(0, 12).map((part) => (
              <li key={part.name}>
                <span>{part.name}</span>
                <span class="tone-muted">{part.pages.length} p.</span>
              </li>
            ))}
            {plan.parts.length > 12 && <li class="tone-muted">and {plan.parts.length - 12} more</li>}
          </ul>
        )}
        <button type="button" class="button button-primary" disabled={!file || !plan.parts.length || busy} onClick={run} data-testid="split-run">
          {busy ? 'Working…' : plan.parts.length > 1 ? `Save ${plan.parts.length} PDFs as a ZIP` : 'Save PDF'}
        </button>
      </div>
      <div class="ai-work">
        {file ? (
          <ol class="pdf-grid pdf-grid-small" aria-label="Pages">
            {Array.from({ length: Math.min(file.pages, 400) }, (_, i) => (
              <li key={i} class={`pdf-page${included.has(i + 1) ? '' : ' is-left-out'}`}>
                <div class="pdf-thumb">{thumbs[i] ? <img src={thumbs[i]} alt="" /> : <span class="spinner" aria-hidden="true" />}</div>
                <div class="pdf-page-label">{i + 1}</div>
              </li>
            ))}
          </ol>
        ) : (
          <FileDrop
            accept=".pdf,application/pdf"
            multiple={false}
            onFiles={take}
            title={loading ? 'Reading…' : 'Drop a PDF here, or click to choose'}
            hint="Split it into several files, keep some pages, or remove some. Nothing leaves this computer."
            testId="pdf-drop"
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ stamp -- */

interface StampSettings {
  readonly watermarkOn: boolean;
  readonly watermark: string;
  readonly wmSize: number;
  readonly wmColour: string;
  readonly wmOpacity: number;
  readonly wmAngle: number;
  readonly wmTiled: boolean;
  readonly numbersOn: boolean;
  readonly format: string;
  readonly numPosition: Corner;
  readonly numSize: number;
  readonly start: number;
  readonly textOn: boolean;
  readonly text: string;
  readonly textPosition: Corner;
  readonly pages: string;
  readonly margin: number;
}

const CORNERS: readonly [Corner, string][] = [
  ['bottom-center', 'Bottom centre'],
  ['bottom-right', 'Bottom right'],
  ['bottom-left', 'Bottom left'],
  ['top-center', 'Top centre'],
  ['top-right', 'Top right'],
  ['top-left', 'Top left'],
];

const readStamp = (s: Values | undefined): StampSettings => {
  const str = (k: string, d: string) => (typeof s?.[k] === 'string' ? (s[k] as string) : d);
  const num = (k: string, d: number, min: number, max: number) => (typeof s?.[k] === 'number' && Number.isFinite(s[k]) ? Math.min(max, Math.max(min, s[k] as number)) : d);
  const bool = (k: string, d: boolean) => (typeof s?.[k] === 'boolean' ? (s[k] as boolean) : d);
  const corner = (k: string, d: Corner) => CORNERS.find(([c]) => c === s?.[k])?.[0] ?? d;
  return {
    watermarkOn: bool('watermarkOn', true),
    watermark: str('watermark', 'CONFIDENTIAL'),
    wmSize: num('wmSize', 64, 6, 300),
    wmColour: str('wmColour', '#c0392b'),
    wmOpacity: num('wmOpacity', 0.18, 0.02, 1),
    wmAngle: num('wmAngle', 45, -90, 90),
    wmTiled: bool('wmTiled', false),
    numbersOn: bool('numbersOn', true),
    format: str('format', 'Page {n} of {total}'),
    numPosition: corner('numPosition', 'bottom-center'),
    numSize: num('numSize', 10, 5, 48),
    start: num('start', 1, 0, 100000),
    textOn: bool('textOn', false),
    text: str('text', ''),
    textPosition: corner('textPosition', 'top-left'),
    pages: str('pages', ''),
    margin: num('margin', 10, 0, 100),
  };
};

function Stamp({ toolId }: { toolId: string }) {
  const [s, setSettings] = usePersistentState<StampSettings>(toolId, readStamp, (v) => ({ ...v }));
  const set = (patch: Partial<StampSettings>) => setSettings((v) => ({ ...v, ...patch }));
  const [file, take, clear, loading] = useSinglePdf();
  const [preview, setPreview] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const options = (): Parameters<typeof stampPdf>[1] => ({
    pages: s.pages,
    watermark: s.watermarkOn && s.watermark.trim() ? { text: s.watermark.trim(), size: s.wmSize, colour: s.wmColour, opacity: s.wmOpacity, angle: s.wmAngle, tiled: s.wmTiled, bold: true } : undefined,
    numbers: s.numbersOn && s.format.trim() ? { format: s.format, position: s.numPosition, size: s.numSize, colour: '#222222', start: s.start, margin: s.margin } : undefined,
    text: s.textOn && s.text.trim() ? { value: s.text.trim(), position: s.textPosition, size: Math.max(7, s.numSize - 1), colour: '#444444', margin: s.margin } : undefined,
  });

  // Live preview of one page, redrawn shortly after each change.
  useEffect(() => {
    if (!file) return;
    const run = ++generation.current;
    const timer = setTimeout(async () => {
      try {
        const page = Math.min(previewPage, file.pages);
        const { doc, close } = await openPdf(await stampPreview(file.doc, options(), page));
        const canvas = await renderPage(doc, 1, 1.2);
        await close();
        if (run === generation.current) {
          setPreview(canvas.toDataURL('image/png'));
          setError('');
        }
      } catch (e) {
        if (run === generation.current) setError(e instanceof Error ? e.message : String(e));
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [file, s, previewPage]);

  const run = () =>
    void attempt(async () => {
      if (!file) return;
      setBusy(true);
      try {
        await save(`${stem(file.name)} (stamped).pdf`, await stampPdf(await loadPdf(file.bytes), options()));
      } finally {
        setBusy(false);
      }
    });

  const pick = () => attempt(async () => take(await pickFiles('.pdf,application/pdf')));
  const cornerSelect = (id: string, value: Corner, onChange: (c: Corner) => void) => (
    <select id={id} class="input" value={value} onChange={(e) => onChange(e.currentTarget.value as Corner)}>
      {CORNERS.map(([c, label]) => (
        <option key={c} value={c}>
          {label}
        </option>
      ))}
    </select>
  );
  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        {file && <FileBar file={file} onReplace={pick} onClear={clear} />}
        <fieldset class={`conv-group${s.watermarkOn ? '' : ' is-off'}`}>
          <legend>
            <label class="toggle" for="st-wm">
              <input id="st-wm" type="checkbox" role="switch" aria-checked={s.watermarkOn} checked={s.watermarkOn} onChange={(e) => set({ watermarkOn: e.currentTarget.checked })} />
              <span class="toggle-track" aria-hidden="true" />
              <span>Watermark</span>
            </label>
          </legend>
          {s.watermarkOn && (
            <>
              <input class="input" value={s.watermark} onInput={(e) => set({ watermark: e.currentTarget.value })} aria-label="Watermark text" data-testid="stamp-watermark" />
              <div class="pdf-pair">
                <label class="control">
                  <span class="control-label">Size</span>
                  <input class="input input-number" type="number" min={6} max={300} value={s.wmSize} onInput={(e) => set({ wmSize: Number(e.currentTarget.value) || 64 })} />
                </label>
                <label class="control">
                  <span class="control-label">Angle (°)</span>
                  <input class="input input-number" type="number" min={-90} max={90} value={s.wmAngle} onInput={(e) => set({ wmAngle: Number(e.currentTarget.value) || 0 })} />
                </label>
              </div>
              <div class="pdf-pair">
                <label class="control">
                  <span class="control-label">Colour</span>
                  <input type="color" value={s.wmColour} onInput={(e) => set({ wmColour: e.currentTarget.value })} />
                </label>
                <label class="control">
                  <span class="control-label">Opacity ({Math.round(s.wmOpacity * 100)}%)</span>
                  <input type="range" min={0.02} max={1} step={0.01} value={s.wmOpacity} onInput={(e) => set({ wmOpacity: Number(e.currentTarget.value) })} />
                </label>
              </div>
              <label class="toggle" for="st-tiled">
                <input id="st-tiled" type="checkbox" role="switch" aria-checked={s.wmTiled} checked={s.wmTiled} onChange={(e) => set({ wmTiled: e.currentTarget.checked })} />
                <span class="toggle-track" aria-hidden="true" />
                <span>Repeat across the page</span>
              </label>
            </>
          )}
        </fieldset>
        <fieldset class={`conv-group${s.numbersOn ? '' : ' is-off'}`}>
          <legend>
            <label class="toggle" for="st-num">
              <input id="st-num" type="checkbox" role="switch" aria-checked={s.numbersOn} checked={s.numbersOn} onChange={(e) => set({ numbersOn: e.currentTarget.checked })} />
              <span class="toggle-track" aria-hidden="true" />
              <span>Page numbers</span>
            </label>
          </legend>
          {s.numbersOn && (
            <>
              <label class="control">
                <span class="control-label">
                  Format ({'{n}'} is the number, {'{total}'} the last)
                </span>
                <input class="input input-mono" value={s.format} onInput={(e) => set({ format: e.currentTarget.value })} data-testid="stamp-format" />
              </label>
              <div class="pdf-pair">
                <div class="control">
                  <label class="control-label" for="st-num-pos">
                    Position
                  </label>
                  {cornerSelect('st-num-pos', s.numPosition, (numPosition) => set({ numPosition }))}
                </div>
                <label class="control">
                  <span class="control-label">First number</span>
                  <input class="input input-number" type="number" min={0} value={s.start} onInput={(e) => set({ start: Math.max(0, Number(e.currentTarget.value) || 0) })} />
                </label>
              </div>
            </>
          )}
        </fieldset>
        <fieldset class={`conv-group${s.textOn ? '' : ' is-off'}`}>
          <legend>
            <label class="toggle" for="st-text">
              <input id="st-text" type="checkbox" role="switch" aria-checked={s.textOn} checked={s.textOn} onChange={(e) => set({ textOn: e.currentTarget.checked })} />
              <span class="toggle-track" aria-hidden="true" />
              <span>Header or footer text</span>
            </label>
          </legend>
          {s.textOn && (
            <>
              <input class="input" value={s.text} placeholder="Draft for review, 12 March" onInput={(e) => set({ text: e.currentTarget.value })} aria-label="Header or footer text" />
              <div class="control">
                <label class="control-label" for="st-text-pos">
                  Position
                </label>
                {cornerSelect('st-text-pos', s.textPosition, (textPosition) => set({ textPosition }))}
              </div>
            </>
          )}
        </fieldset>
        <div class="pdf-pair">
          <label class="control">
            <span class="control-label">Pages (empty for all)</span>
            <input class="input input-mono" value={s.pages} placeholder="2-" onInput={(e) => set({ pages: e.currentTarget.value })} />
          </label>
          <label class="control">
            <span class="control-label">Text size, margin (mm)</span>
            <span class="pdf-pair pdf-pair-tight">
              <input class="input input-number" type="number" min={5} max={48} value={s.numSize} aria-label="Text size" onInput={(e) => set({ numSize: Number(e.currentTarget.value) || 10 })} />
              <input
                class="input input-number"
                type="number"
                min={0}
                max={100}
                value={s.margin}
                aria-label="Margin in millimetres"
                onInput={(e) => set({ margin: Math.max(0, Number(e.currentTarget.value) || 0) })}
              />
            </span>
          </label>
        </div>
        {error && <p class="recipe-error">{error}</p>}
        <button type="button" class="button button-primary" disabled={!file || busy || Boolean(error)} onClick={run} data-testid="stamp-run">
          {busy ? 'Working…' : 'Save stamped PDF'}
        </button>
      </div>
      <div class="ai-work">
        {file ? (
          <figure class="ai-figure pdf-preview">
            <figcaption class="pdf-preview-bar">
              <span>Preview</span>
              <button type="button" class="icon-button" aria-label="Previous page" disabled={previewPage <= 1} onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}>
                <Icon name="left" size={14} />
              </button>
              <span>
                Page {Math.min(previewPage, file.pages)} of {file.pages}
              </span>
              <button type="button" class="icon-button" aria-label="Next page" disabled={previewPage >= file.pages} onClick={() => setPreviewPage((p) => Math.min(file.pages, p + 1))}>
                <Icon name="right" size={14} />
              </button>
            </figcaption>
            <div class="ai-stage">{preview ? <img src={preview} alt="Preview of the stamped page" data-testid="stamp-preview" /> : <span class="spinner" aria-hidden="true" />}</div>
          </figure>
        ) : (
          <FileDrop
            accept=".pdf,application/pdf"
            multiple={false}
            onFiles={take}
            title={loading ? 'Reading…' : 'Drop a PDF here, or click to choose'}
            hint="Add a watermark, page numbers or a header line, in English, Hindi or other scripts; ₹ works too."
            testId="pdf-drop"
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- properties -- */

const INFO_FIELDS: readonly [keyof PdfInfo, string][] = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['subject', 'Subject'],
  ['keywords', 'Keywords (comma-separated)'],
  ['creator', 'Created with'],
  ['producer', 'Producer'],
  ['created', 'Created'],
];

function Properties() {
  const [file, take, clear, loading] = useSinglePdf();
  const [info, setInfo] = useState<PdfInfo | null>(null);
  const [facts, setFacts] = useState<PdfFacts | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!file) {
      setInfo(null);
      setFacts(null);
      return;
    }
    const read = readInfo(file.doc, file.bytes);
    setInfo(read.info);
    setFacts(read.facts);
  }, [file]);

  const write = (clearAll: boolean) =>
    void attempt(async () => {
      if (!file || !info) return;
      setBusy(true);
      try {
        await save(`${stem(file.name)}${clearAll ? ' (no properties)' : ''}.pdf`, await writeInfo(await loadPdf(file.bytes), info, clearAll));
      } finally {
        setBusy(false);
      }
    });

  const pick = () => attempt(async () => take(await pickFiles('.pdf,application/pdf')));
  if (!file || !info || !facts) {
    return (
      <div data-testid="tool" class="tool">
        <FileDrop
          accept=".pdf,application/pdf"
          multiple={false}
          onFiles={take}
          title={loading ? 'Reading…' : 'Drop a PDF here, or click to choose'}
          hint="See its page sizes and version, and edit or remove its title, author and other properties."
          testId="pdf-drop"
        />
      </div>
    );
  }
  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        <FileBar file={file} onReplace={pick} onClear={clear} />
        <dl class="pdf-facts" data-testid="pdf-facts">
          <div>
            <dt>Pages</dt>
            <dd>{facts.pages}</dd>
          </div>
          <div>
            <dt>Page size</dt>
            <dd>{facts.sizes.map((size) => `${size.name}${facts.sizes.length > 1 ? ` (${size.count})` : ''}`).join(', ')}</dd>
          </div>
          <div>
            <dt>PDF version</dt>
            <dd>{facts.version}</dd>
          </div>
          <div>
            <dt>Form fields</dt>
            <dd>{facts.forms || 'None'}</dd>
          </div>
          <div>
            <dt>XMP metadata</dt>
            <dd>{facts.hasXmp ? 'Yes (replaced when saving)' : 'No'}</dd>
          </div>
          {info.modified && (
            <div>
              <dt>Last changed</dt>
              <dd>{info.modified.replace('T', ' ')}</dd>
            </div>
          )}
        </dl>
      </div>
      <div class="ai-work">
        <div class="pdf-form">
          {INFO_FIELDS.map(([key, label]) => (
            <div key={key} class="control">
              <label class="control-label" for={`pdf-${key}`}>
                {label}
              </label>
              {key === 'created' ? (
                <input id={`pdf-${key}`} class="input" type="datetime-local" value={info[key]} onInput={(e) => setInfo({ ...info, [key]: e.currentTarget.value })} data-testid={`pdf-${key}`} />
              ) : (
                <input id={`pdf-${key}`} class="input" type="text" value={info[key]} onInput={(e) => setInfo({ ...info, [key]: e.currentTarget.value })} data-testid={`pdf-${key}`} />
              )}
            </div>
          ))}
          <div class="button-row">
            <button type="button" class="button button-primary" disabled={busy} onClick={() => write(false)} data-testid="pdf-write">
              Save with these properties
            </button>
            <button type="button" class="button" disabled={busy} onClick={() => write(true)}>
              Save without any properties
            </button>
          </div>
          <p class="tone-muted pdf-note">Saving makes a copy; the original file is not changed.</p>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- pictures -- */

interface Picture {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly file: File;
}

/** JPEG and PNG go in unchanged (unless a JPEG is turned by its EXIF data); other pictures become PNG or JPEG. */
async function preparePicture(file: File): Promise<{ bytes: Uint8Array; kind: 'jpg' | 'png' }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  if (isPng) return { bytes, kind: 'png' };
  if (isJpeg && jpegOrientation(bytes) === 1) return { bytes, kind: 'jpg' };
  // The browser applies the EXIF orientation when it draws the picture.
  const canvas = await loadImage(file);
  const opaque = isJpeg || !hasTransparency(canvas);
  const blob = await encodeCanvas(canvas, opaque ? { format: 'jpeg', quality: 92 } : { format: 'png', quality: 100 });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), kind: opaque ? 'jpg' : 'png' };
}

function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d');
  if (!context) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

interface PictureSettings {
  readonly direction: 'to-pdf' | 'from-pdf';
  readonly size: PageSize;
  readonly orientation: 'auto' | 'portrait' | 'landscape';
  readonly margin: number;
  readonly format: 'png' | 'jpeg' | 'webp';
  readonly dpi: number;
  readonly quality: number;
  readonly pages: string;
}

const readPictures = (s: Values | undefined): PictureSettings => ({
  direction: s?.direction === 'from-pdf' ? 'from-pdf' : 'to-pdf',
  size: (['fit', 'a4', 'letter', 'a3', 'a5', 'legal'] as const).find((v) => v === s?.size) ?? 'a4',
  orientation: (['auto', 'portrait', 'landscape'] as const).find((v) => v === s?.orientation) ?? 'auto',
  margin: typeof s?.margin === 'number' ? Math.min(50, Math.max(0, s.margin)) : 10,
  format: (['png', 'jpeg', 'webp'] as const).find((v) => v === s?.format) ?? 'png',
  dpi: typeof s?.dpi === 'number' ? Math.min(600, Math.max(36, s.dpi)) : 150,
  quality: typeof s?.quality === 'number' ? Math.min(100, Math.max(30, s.quality)) : 88,
  pages: typeof s?.pages === 'string' ? s.pages : '',
});

function Pictures({ toolId }: { toolId: string }) {
  const [s, setSettings] = usePersistentState<PictureSettings>(toolId, readPictures, (v) => ({ ...v }));
  const set = (patch: Partial<PictureSettings>) => setSettings((v) => ({ ...v, ...patch }));
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [file, take, clear, loading] = useSinglePdf();
  const thumbs = useThumbnails(s.direction === 'from-pdf' ? file : null, 110);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const latest = useRef(pictures);
  latest.current = pictures;
  useEffect(
    () => () => {
      for (const p of latest.current) URL.revokeObjectURL(p.url);
    },
    [],
  );

  const addPictures = (files: File[]) =>
    setPictures((list) => [
      ...list,
      ...files
        .filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(f.name))
        .map((f) => ({ id: `pic-${ids++}`, name: f.name, url: URL.createObjectURL(f), file: f })),
    ]);
  const movePicture = (index: number, by: number) =>
    setPictures((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  const makePdf = () =>
    void attempt(async () => {
      setBusy(true);
      try {
        const prepared = [];
        for (const [i, picture] of pictures.entries()) {
          setProgress(`Preparing picture ${i + 1} of ${pictures.length}`);
          prepared.push(await preparePicture(picture.file));
        }
        setProgress('');
        await save(
          pictures.length === 1 ? replaceExtension(pictures[0].name, 'pdf') : 'pictures.pdf',
          await picturesToPdf(prepared, { size: s.size, orientation: s.orientation, margin: s.margin, dpi: 96 }),
        );
      } finally {
        setBusy(false);
        setProgress('');
      }
    });

  const makePictures = () =>
    void attempt(async () => {
      if (!file) return;
      setBusy(true);
      const { doc, close } = await openPdf(file.bytes);
      try {
        const pages = s.pages.trim() ? [...new Set(parsePages(s.pages, file.pages))] : Array.from({ length: file.pages }, (_, i) => i + 1);
        const ext = s.format === 'jpeg' ? 'jpg' : s.format;
        const width = String(file.pages).length;
        const out: Record<string, Uint8Array> = {};
        for (const [i, n] of pages.entries()) {
          setProgress(`Drawing page ${i + 1} of ${pages.length}`);
          const canvas = await renderPage(doc, n, s.dpi / 72);
          const blob = await encodeCanvas(canvas, { format: s.format, quality: s.quality });
          out[`${stem(file.name)} p${String(n).padStart(width, '0')}.${ext}`] = new Uint8Array(await blob.arrayBuffer());
        }
        const names = Object.keys(out);
        if (names.length === 1) await save(names[0], out[names[0]], `image/${s.format}`);
        else await save(`${stem(file.name)} (pictures).zip`, zipSync(out, { level: 0 }), 'application/zip');
      } finally {
        await close();
        setBusy(false);
        setProgress('');
      }
    });

  const pick = () => attempt(async () => take(await pickFiles('.pdf,application/pdf')));
  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        <Segmented
          label="Direction"
          small={false}
          value={s.direction}
          onChange={(direction) => set({ direction })}
          choices={[
            { value: 'to-pdf', label: 'Pictures to PDF' },
            { value: 'from-pdf', label: 'PDF to pictures' },
          ]}
        />
        {s.direction === 'to-pdf' ? (
          <>
            <div class="control">
              <label class="control-label" for="pp-size">
                Page size
              </label>
              <select id="pp-size" class="input" value={s.size} onChange={(e) => set({ size: e.currentTarget.value as PageSize })}>
                <option value="a4">A4</option>
                <option value="letter">US Letter</option>
                <option value="a3">A3</option>
                <option value="a5">A5</option>
                <option value="legal">US Legal</option>
                <option value="fit">Same as each picture</option>
              </select>
            </div>
            {s.size !== 'fit' && (
              <div class="control">
                <span class="control-label">Orientation</span>
                <Segmented
                  label="Orientation"
                  small={false}
                  value={s.orientation}
                  onChange={(orientation) => set({ orientation })}
                  choices={[
                    { value: 'auto', label: 'Match picture' },
                    { value: 'portrait', label: 'Portrait' },
                    { value: 'landscape', label: 'Landscape' },
                  ]}
                />
              </div>
            )}
            <div class="control">
              <label class="control-label" for="pp-margin">
                Margin (mm)
              </label>
              <input id="pp-margin" class="input input-number" type="number" min={0} max={50} value={s.margin} onInput={(e) => set({ margin: Math.max(0, Number(e.currentTarget.value) || 0) })} />
            </div>
            <button type="button" class="button button-primary" disabled={!pictures.length || busy} onClick={makePdf} data-testid="pictures-run">
              {busy ? progress || 'Working…' : `Save PDF${pictures.length > 1 ? ` of ${pictures.length} pictures` : ''}`}
            </button>
          </>
        ) : (
          <>
            {file && <FileBar file={file} onReplace={pick} onClear={clear} />}
            <div class="control">
              <span class="control-label">Format</span>
              <Segmented
                label="Format"
                small={false}
                value={s.format}
                onChange={(format) => set({ format })}
                choices={[
                  { value: 'png', label: 'PNG' },
                  { value: 'jpeg', label: 'JPEG' },
                  { value: 'webp', label: 'WebP' },
                ]}
              />
            </div>
            <div class="pdf-pair">
              <label class="control">
                <span class="control-label">Resolution (dpi)</span>
                <input class="input input-number" type="number" min={36} max={600} value={s.dpi} onInput={(e) => set({ dpi: Math.min(600, Math.max(36, Number(e.currentTarget.value) || 150)) })} />
              </label>
              <label class="control">
                <span class="control-label">Pages (empty for all)</span>
                <input class="input input-mono" value={s.pages} placeholder="1-3" onInput={(e) => set({ pages: e.currentTarget.value })} />
              </label>
            </div>
            {s.format !== 'png' && (
              <label class="control">
                <span class="control-label">Quality ({s.quality})</span>
                <input type="range" min={30} max={100} value={s.quality} onInput={(e) => set({ quality: Number(e.currentTarget.value) })} />
              </label>
            )}
            <button type="button" class="button button-primary" disabled={!file || busy} onClick={makePictures} data-testid="pictures-run">
              {busy ? progress || 'Working…' : 'Save pictures'}
            </button>
          </>
        )}
      </div>
      <div class="ai-work">
        {s.direction === 'to-pdf' ? (
          <>
            <FileDrop
              accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.svg"
              multiple
              compact={pictures.length > 0}
              onFiles={addPictures}
              title={pictures.length ? 'Add more pictures' : 'Drop pictures here, or click to choose'}
              hint={pictures.length ? undefined : 'Each picture becomes a page, in the order listed. JPEG photos go in without being re-compressed.'}
              testId="pictures-drop"
            />
            {pictures.length > 0 && (
              <ol class="pdf-grid" aria-label="Pictures">
                {pictures.map((p, i) => (
                  <li key={p.id} class="pdf-page">
                    <div class="pdf-thumb">
                      <img src={p.url} alt="" />
                    </div>
                    <div class="pdf-page-label">
                      {i + 1} <span class="tone-muted">{p.name}</span>
                    </div>
                    <div class="pdf-page-actions">
                      <button type="button" class="icon-button" aria-label={`Move ${p.name} earlier`} disabled={i === 0} onClick={() => movePicture(i, -1)}>
                        <Icon name="left" size={14} />
                      </button>
                      <button
                        type="button"
                        class="icon-button"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => {
                          URL.revokeObjectURL(p.url);
                          setPictures((list) => list.filter((x) => x.id !== p.id));
                        }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                      <button type="button" class="icon-button" aria-label={`Move ${p.name} later`} disabled={i === pictures.length - 1} onClick={() => movePicture(i, 1)}>
                        <Icon name="right" size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : file ? (
          <ol class="pdf-grid pdf-grid-small" aria-label="Pages">
            {Array.from({ length: Math.min(file.pages, 400) }, (_, i) => (
              <li key={i} class="pdf-page">
                <div class="pdf-thumb">{thumbs[i] ? <img src={thumbs[i]} alt="" /> : <span class="spinner" aria-hidden="true" />}</div>
                <div class="pdf-page-label">{i + 1}</div>
              </li>
            ))}
          </ol>
        ) : (
          <FileDrop
            accept=".pdf,application/pdf"
            multiple={false}
            onFiles={take}
            title={loading ? 'Reading…' : 'Drop a PDF here, or click to choose'}
            hint="Each page is saved as a picture; several pages come as a ZIP."
            testId="pdf-drop"
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ entry -- */

function PdfTools({ toolId }: { toolId: string }) {
  switch (toolId) {
    case 'pdf-split':
      return <Split toolId={toolId} />;
    case 'pdf-stamp':
      return <Stamp toolId={toolId} />;
    case 'pdf-properties':
      return <Properties />;
    case 'pdf-pictures':
      return <Pictures toolId={toolId} />;
    default:
      return <Organise />;
  }
}

export default defineCustomTool(PdfTools);
