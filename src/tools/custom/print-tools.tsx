/**
 * Print tools for PDFs: imposition (booklets, zines, n-up), preflight checks
 * and cropping.  Everything runs in the app with pdf-lib and PDF.js.
 */
import { PDFDocument } from 'pdf-lib';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type ImposeOptions, type ImposeResult, impose, type Layout, POINTS_PER_MM } from '../../lib/imposition';
import { findPaper } from '../../lib/paper';
import { contentMargins, cropPages, type Margins } from '../../lib/pdf-crop';
import { paperName, parsePages } from '../../lib/pdf-edit';
import { openPdf, renderPage } from '../../lib/pdf-render';
import { MM_PER_PT, type Placement, placements, type StructureFacts, scanStructure } from '../../lib/preflight';
import { pickFiles } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { FileBar, FileDrop, save, stem, useSinglePdf, useThumbnails } from './_pdf';
import { type SegmentChoice, Segmented, usePersistentState } from './_shared';

const mmOf = (pt: number) => Math.round(pt * MM_PER_PT * 10) / 10;
const pick = (take: (files: File[]) => void) => () => attempt(async () => take(await pickFiles('.pdf,application/pdf')));

/* ---------------------------------------------------------------- imposer -- */

const SHEETS: readonly { id: string; label: string }[] = [
  { id: 'auto', label: 'Two pages side by side' },
  { id: 'a4', label: 'A4' },
  { id: 'a3', label: 'A3' },
  { id: 'sra3', label: 'SRA3' },
  { id: 'letter', label: 'Letter' },
  { id: 'tabloid', label: 'Tabloid (11 × 17 in)' },
  { id: 'legal', label: 'Legal' },
  { id: 'fs', label: 'Foolscap (FS)' },
];

const sheetPoints = (id: string) => {
  const p = id === 'auto' ? null : findPaper(id);
  return p ? { width: p.width * POINTS_PER_MM, height: p.height * POINTS_PER_MM } : null;
};

interface ImposeSettings {
  readonly layout: Layout;
  readonly sheet: string;
  readonly orientation: ImposeOptions['orientation'];
  readonly cols: number;
  readonly rows: number;
  readonly margin: number;
  readonly gap: number;
  readonly signature: number;
  readonly creep: number;
  readonly cutStack: boolean;
  readonly marks: boolean;
  readonly fit: ImposeOptions['fit'];
}

const IMPOSE_DEFAULTS: ImposeSettings = {
  layout: 'booklet',
  sheet: 'auto',
  orientation: 'auto',
  cols: 2,
  rows: 2,
  margin: 5,
  gap: 0,
  signature: 0,
  creep: 0,
  cutStack: false,
  marks: true,
  fit: 'fit',
};

function readImpose(stored: Values | undefined): ImposeSettings {
  const s = stored ?? {};
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    layout: ['booklet', 'zine', 'nup', 'repeat'].includes(s.layout as string) ? (s.layout as Layout) : IMPOSE_DEFAULTS.layout,
    sheet: SHEETS.some((x) => x.id === s.sheet) ? (s.sheet as string) : IMPOSE_DEFAULTS.sheet,
    orientation: ['auto', 'portrait', 'landscape'].includes(s.orientation as string) ? (s.orientation as ImposeSettings['orientation']) : 'auto',
    cols: n(s.cols, 1, 8, 2),
    rows: n(s.rows, 1, 8, 2),
    margin: n(s.margin, 0, 50, 5),
    gap: n(s.gap, 0, 50, 0),
    signature: n(s.signature, 0, 64, 0),
    creep: n(s.creep, 0, 2, 0),
    cutStack: s.cutStack === true,
    marks: s.marks !== false,
    fit: s.fit === 'actual' ? 'actual' : 'fit',
  };
}

const LAYOUTS: readonly SegmentChoice<Layout>[] = [
  { value: 'booklet', label: 'Booklet' },
  { value: 'zine', label: 'Mini zine' },
  { value: 'nup', label: 'Pages per sheet' },
  { value: 'repeat', label: 'Repeat' },
];

const HOW_TO: Record<Layout, string> = {
  booklet: 'Print on both sides, flipping on the short edge. Stack the sheets in order, fold them in half together and staple on the fold.',
  zine: 'Print on one side. Fold in half both ways, open, cut along the solid line in the middle, then fold lengthwise and push the ends together to make an eight-page book.',
  nup: 'Print, then cut along the marks. With “cut and stack” on, cut the whole pile at once and the stacks are already in page order.',
  repeat: 'Each page fills its own sheet with copies, for cards, labels and tickets. Cut along the marks.',
};

function Imposer({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState(toolId, readImpose, (s: ImposeSettings): Values => ({ ...s }));
  const [file, take, clear, loading] = useSinglePdf();
  const [result, setResult] = useState<ImposeResult | null>(null);
  const [error, setError] = useState('');
  const set = (patch: Partial<ImposeSettings>) => setSettings((s) => ({ ...s, ...patch }));

  useEffect(() => {
    setResult(null);
    setError('');
    if (!file) return;
    let live = true;
    const timer = setTimeout(() => {
      void impose(file.doc, {
        layout: settings.layout,
        sheet: sheetPoints(settings.sheet),
        orientation: settings.orientation,
        cols: settings.cols,
        rows: settings.rows,
        margin: settings.margin * POINTS_PER_MM,
        gutter: settings.gap * POINTS_PER_MM,
        signature: settings.signature,
        creep: settings.creep * POINTS_PER_MM,
        cutStack: settings.cutStack,
        marks: settings.marks,
        fit: settings.fit,
      }).then(
        (r) => live && setResult(r),
        (e) => live && setError(e instanceof Error ? e.message : String(e)),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [file, settings]);

  const preview = useMemo(() => (result ? { bytes: result.bytes, pages: result.sides } : null), [result]);
  const thumbs = useThumbnails(preview, 260, 12);
  const grid = settings.layout === 'nup' || settings.layout === 'repeat';
  const booklet = settings.layout === 'booklet';
  const suffix = { booklet: 'booklet', zine: 'zine', nup: `${settings.cols * settings.rows}-up`, repeat: 'repeat' }[settings.layout];

  return (
    <div data-testid="tool" class="tool ai-tool" data-state={result ? 'done' : 'idle'}>
      <div class="ai-controls">
        {file && <FileBar file={file} onReplace={pick(take)} onClear={clear} />}
        <div class="control">
          <span class="control-label">Layout</span>
          <Segmented
            label="Layout"
            value={settings.layout}
            choices={LAYOUTS}
            onChange={(layout) => set({ layout, sheet: layout === 'booklet' ? settings.sheet : settings.sheet === 'auto' ? 'a4' : settings.sheet })}
          />
        </div>
        <div class="icon-row">
          <label class="control">
            <span class="control-label">Sheet</span>
            <select class="input" value={settings.sheet} onChange={(e) => set({ sheet: e.currentTarget.value })} data-testid="impose-sheet">
              {SHEETS.filter((s) => booklet || s.id !== 'auto').map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label class="control">
            <span class="control-label">Orientation</span>
            <select class="input" value={settings.orientation} onChange={(e) => set({ orientation: e.currentTarget.value as ImposeSettings['orientation'] })}>
              <option value="auto">Best fit</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
        </div>
        {grid && (
          <div class="icon-row">
            <label class="control">
              <span class="control-label">Across</span>
              <input
                class="input input-number"
                type="number"
                min={1}
                max={8}
                value={settings.cols}
                onInput={(e) => set({ cols: Math.max(1, Math.min(8, Number(e.currentTarget.value) || 1)) })}
                data-testid="impose-cols"
              />
            </label>
            <label class="control">
              <span class="control-label">Down</span>
              <input class="input input-number" type="number" min={1} max={8} value={settings.rows} onInput={(e) => set({ rows: Math.max(1, Math.min(8, Number(e.currentTarget.value) || 1)) })} />
            </label>
            <label class="control">
              <span class="control-label">Gap (mm)</span>
              <input class="input input-number" type="number" min={0} max={50} step={0.5} value={settings.gap} onInput={(e) => set({ gap: Math.max(0, Number(e.currentTarget.value) || 0) })} />
            </label>
          </div>
        )}
        <div class="icon-row">
          <label class="control">
            <span class="control-label">Margin (mm)</span>
            <input class="input input-number" type="number" min={0} max={50} step={0.5} value={settings.margin} onInput={(e) => set({ margin: Math.max(0, Number(e.currentTarget.value) || 0) })} />
          </label>
          <label class="control">
            <span class="control-label">Page size</span>
            <select class="input" value={settings.fit} onChange={(e) => set({ fit: e.currentTarget.value as ImposeSettings['fit'] })}>
              <option value="fit">Scale to fit</option>
              <option value="actual">Actual size</option>
            </select>
          </label>
        </div>
        {booklet && (
          <div class="icon-row">
            <label class="control">
              <span class="control-label">Sections</span>
              <select class="input" value={settings.signature} onChange={(e) => set({ signature: Number(e.currentTarget.value) })}>
                <option value={0}>One booklet</option>
                {[8, 12, 16, 20, 24, 32].map((n) => (
                  <option key={n} value={n}>
                    {n} pages each (sewn or glued)
                  </option>
                ))}
              </select>
            </label>
            <label class="control">
              <span class="control-label">Creep per sheet (mm)</span>
              <input class="input input-number" type="number" min={0} max={2} step={0.05} value={settings.creep} onInput={(e) => set({ creep: Math.max(0, Number(e.currentTarget.value) || 0) })} />
            </label>
          </div>
        )}
        {settings.layout === 'nup' && (
          <label class="toggle">
            <input type="checkbox" checked={settings.cutStack} onChange={(e) => set({ cutStack: e.currentTarget.checked })} />
            <span class="toggle-track" aria-hidden="true" />
            Cut and stack order
          </label>
        )}
        <label class="toggle">
          <input type="checkbox" checked={settings.marks} onChange={(e) => set({ marks: e.currentTarget.checked })} />
          <span class="toggle-track" aria-hidden="true" />
          {booklet ? 'Fold marks' : settings.layout === 'zine' ? 'Fold and cut lines' : 'Crop marks'}
        </label>
        <p class="control-help">{HOW_TO[settings.layout]}</p>
        {error && <p class="recipe-error">{error}</p>}
        {result && file && (
          <p class="impose-summary" data-testid="impose-summary">
            {file.pages} page{file.pages === 1 ? '' : 's'} on {result.sheets} sheet{result.sheets === 1 ? '' : 's'}
            {booklet ? `, ${result.sides} sides to print` : ''}
            {result.blanks ? `; ${result.blanks} blank${result.blanks === 1 ? '' : 's'} added` : ''}. Sheet {mmOf(result.sheetSize.width)} × {mmOf(result.sheetSize.height)} mm (
            {paperName(result.sheetSize.width, result.sheetSize.height)}).
          </p>
        )}
        <button
          type="button"
          class="button button-primary"
          disabled={!result}
          onClick={() => file && result && attempt(() => save(`${stem(file.name)} (${suffix}).pdf`, result.bytes))}
          data-testid="impose-save"
        >
          <Icon name="save" size={16} /> Save PDF for printing
        </button>
      </div>
      <div class="ai-work">
        {file ? (
          <ol class="impose-sides" aria-label="Printed sides">
            {Array.from({ length: Math.min(result?.sides ?? 0, 12) }, (_, i) => (
              <li key={i}>
                <div class="impose-thumb">{thumbs[i] ? <img src={thumbs[i]} alt={`Side ${i + 1}`} /> : <span class="spinner" aria-hidden="true" />}</div>
                <span class="pdf-page-label">{booklet ? `Sheet ${Math.floor(i / 2) + 1}, ${i % 2 ? 'back' : 'front'}` : `Sheet ${i + 1}`}</span>
              </li>
            ))}
          </ol>
        ) : (
          <FileDrop
            accept=".pdf,application/pdf"
            multiple={false}
            onFiles={take}
            title={loading ? 'Reading…' : 'Drop a PDF here, or click to choose'}
            hint="Lay it out as a booklet, a mini zine, several pages per sheet or repeated cards. Nothing leaves this computer."
            testId="pdf-drop"
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- preflight -- */

interface PreflightSettings {
  readonly dpi: number;
  readonly bleed: number;
}

const readPreflight = (s: Values | undefined): PreflightSettings => ({
  dpi: typeof s?.dpi === 'number' && [150, 200, 240, 300].includes(s.dpi) ? s.dpi : 300,
  bleed: typeof s?.bleed === 'number' && s.bleed >= 0 && s.bleed <= 20 ? s.bleed : 3,
});

type Tone = 'ok' | 'warn' | 'bad' | 'info';
interface Check {
  readonly tone: Tone;
  readonly title: string;
  readonly detail: string;
}

function checksFor(facts: StructureFacts, images: readonly Placement[] | null, settings: PreflightSettings): Check[] {
  const out: Check[] = [];
  const sizes = new Map<string, number[]>();
  for (const p of facts.pages) {
    const box = p.trim ?? p.media;
    const rotated = p.rotate % 180 !== 0;
    const key = `${mmOf(rotated ? box.height : box.width)} × ${mmOf(rotated ? box.width : box.height)} mm`;
    sizes.set(key, [...(sizes.get(key) ?? []), p.number]);
  }
  const first = facts.pages[0];
  if (sizes.size === 1 && first) {
    const box = first.trim ?? first.media;
    out.push({ tone: 'ok', title: 'Page size', detail: `Every page is ${[...sizes.keys()][0]} (${paperName(box.width, box.height)}).` });
  } else {
    out.push({
      tone: 'warn',
      title: 'Page size',
      detail: `Pages come in ${sizes.size} sizes: ${[...sizes.entries()]
        .slice(0, 4)
        .map(([k, v]) => `${k} (${v.length} page${v.length === 1 ? '' : 's'})`)
        .join(', ')}.`,
    });
  }

  const withTrim = facts.pages.filter((p) => p.trim).length;
  const need = settings.bleed / MM_PER_PT;
  if (settings.bleed === 0) out.push({ tone: 'info', title: 'Bleed', detail: 'Not checked: you said the job needs no bleed.' });
  else if (withTrim === 0)
    out.push({ tone: 'warn', title: 'Bleed', detail: `No trim box, so the printer cannot tell the finished size from the bleed. Export with ${settings.bleed} mm bleed and crop marks, or as PDF/X.` });
  else {
    const short = facts.pages.filter((p) => p.bleedAmount !== null && p.bleedAmount < need - 0.5);
    out.push(
      short.length
        ? {
            tone: 'bad',
            title: 'Bleed',
            detail: `${short.length} page${short.length === 1 ? ' has' : 's have'} less than ${settings.bleed} mm of bleed (smallest ${mmOf(Math.min(...short.map((p) => p.bleedAmount ?? 0)))} mm).`,
          }
        : { tone: 'ok', title: 'Bleed', detail: `At least ${settings.bleed} mm of bleed on ${withTrim === facts.pages.length ? 'every page' : `${withTrim} pages`}.` },
    );
  }

  const missing = facts.fonts.filter((f) => !f.embedded);
  out.push(
    facts.fonts.length === 0
      ? { tone: 'info', title: 'Fonts', detail: 'No fonts: the text, if any, is outlines or pictures.' }
      : missing.length
        ? {
            tone: 'bad',
            title: 'Fonts',
            detail: `${missing.length} of ${facts.fonts.length} font${facts.fonts.length === 1 ? ' is' : 's are'} not embedded: ${missing.map((f) => f.name).join(', ')}. The printer would substitute ${missing.length === 1 ? 'it' : 'them'}.`,
          }
        : { tone: 'ok', title: 'Fonts', detail: `All ${facts.fonts.length} font${facts.fonts.length === 1 ? ' is' : 's are'} embedded.` },
  );

  if (images === null) out.push({ tone: 'info', title: 'Picture resolution', detail: 'Measuring…' });
  else if (!images.length) out.push({ tone: 'info', title: 'Picture resolution', detail: 'No pictures are placed.' });
  else {
    const low = images.filter((i) => i.dpi < settings.dpi);
    const veryLow = images.filter((i) => i.dpi < settings.dpi / 2);
    const lowest = Math.min(...images.map((i) => i.dpi));
    out.push(
      low.length
        ? {
            tone: veryLow.length ? 'bad' : 'warn',
            title: 'Picture resolution',
            detail: `${low.length} of ${images.length} placed picture${images.length === 1 ? ' is' : 's are'} below ${settings.dpi} dpi at printed size; the lowest is ${Math.round(lowest)} dpi.`,
          }
        : {
            tone: 'ok',
            title: 'Picture resolution',
            detail: `All ${images.length} placed picture${images.length === 1 ? ' is' : 's are'} at least ${settings.dpi} dpi (lowest ${Math.round(lowest)} dpi).`,
          },
    );
  }

  const c = facts.colour;
  const parts = [c.cmykImages && `${c.cmykImages} CMYK`, c.rgbImages && `${c.rgbImages} RGB`, c.grayImages && `${c.grayImages} greyscale`, c.otherImages && `${c.otherImages} other`].filter(Boolean);
  out.push({
    tone: c.rgbImages ? 'warn' : 'ok',
    title: 'Colour',
    detail: `${parts.length ? `Pictures: ${parts.join(', ')}.` : 'No colour pictures.'}${c.rgbImages ? ' RGB is converted to CMYK at the press; bright greens and blues may dull.' : ''}${c.spots.length ? ` Spot colours: ${c.spots.join(', ')}.` : ''}`,
  });

  out.push(
    facts.transparency.length
      ? { tone: 'info', title: 'Transparency', detail: `${facts.transparency.join(', ')}. Fine for PDF/X-4 workflows; older RIPs (PDF/X-1a) need it flattened.` }
      : { tone: 'ok', title: 'Transparency', detail: 'None used.' },
  );

  out.push(
    facts.outputIntents.length || facts.pdfx
      ? { tone: 'ok', title: 'PDF/X', detail: `${facts.pdfx || 'Output intent'}${facts.outputIntents.length ? `: ${facts.outputIntents.join('; ')}` : ''}.` }
      : { tone: 'info', title: 'PDF/X', detail: `No output intent; this is a plain PDF ${facts.version}. Many printers prefer PDF/X-1a or PDF/X-4.` },
  );

  const comments = facts.pages.reduce((t, p) => t + p.annotations, 0);
  const fields = facts.pages.reduce((t, p) => t + p.widgets, 0);
  if (comments || fields || facts.hasForms)
    out.push({
      tone: 'warn',
      title: 'Comments and form fields',
      detail: `${comments} comment${comments === 1 ? '' : 's'} or markup and ${fields} form field${fields === 1 ? '' : 's'}; these may not print. Flatten them first.`,
    });

  const n = facts.pages.length;
  out.push({
    tone: n % 4 === 0 ? 'ok' : 'info',
    title: 'Page count',
    detail:
      n % 4 === 0
        ? `${n} pages: fits a saddle-stitched booklet exactly.`
        : `${n} pages: a saddle-stitched booklet needs ${Math.ceil(n / 4) * 4}, so ${Math.ceil(n / 4) * 4 - n} blank${Math.ceil(n / 4) * 4 - n === 1 ? '' : 's'} would be added.`,
  });
  return out;
}

const TONE_ICON: Record<Tone, 'check' | 'alert' | 'close' | 'info'> = { ok: 'check', warn: 'alert', bad: 'close', info: 'info' };

function Preflight({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState(toolId, readPreflight, (s: PreflightSettings): Values => ({ ...s }));
  const [file, take, clear, loading] = useSinglePdf();
  const [images, setImages] = useState<Placement[] | null>(null);
  const [progress, setProgress] = useState('');
  const facts = useMemo(() => (file ? scanStructure(file.doc, file.bytes) : null), [file]);

  useEffect(() => {
    setImages(null);
    if (!file) return;
    let live = true;
    let close: (() => Promise<void>) | null = null;
    void (async () => {
      try {
        const opened = await openPdf(file.bytes);
        close = opened.close;
        const found: Placement[] = [];
        const count = Math.min(file.pages, 300);
        for (let n = 1; n <= count && live; n++) {
          setProgress(`Measuring pictures on page ${n} of ${count}…`);
          const page = await opened.doc.getPage(n);
          const ops = await page.getOperatorList();
          found.push(...placements(n, ops.fnArray, ops.argsArray));
          page.cleanup();
        }
        if (live) setImages(found);
      } catch {
        if (live) setImages([]);
      } finally {
        if (live) setProgress('');
      }
    })();
    return () => {
      live = false;
      void close?.();
    };
  }, [file]);

  const checks = useMemo(() => (facts ? checksFor(facts, images, settings) : []), [facts, images, settings]);
  const lowImages = useMemo(() => (images ?? []).filter((i) => i.dpi < settings.dpi).sort((a, b) => a.dpi - b.dpi), [images, settings.dpi]);

  return (
    <div data-testid="tool" class="tool ai-tool" data-state={facts && images ? 'done' : file ? 'running' : 'idle'}>
      <div class="ai-controls">
        {file && <FileBar file={file} onReplace={pick(take)} onClear={clear} />}
        <label class="control">
          <span class="control-label">Pictures need at least</span>
          <select class="input" value={settings.dpi} onChange={(e) => setSettings((s) => ({ ...s, dpi: Number(e.currentTarget.value) }))}>
            <option value={300}>300 dpi (brochures, books)</option>
            <option value={240}>240 dpi (magazines)</option>
            <option value={200}>200 dpi (newsprint, large photos)</option>
            <option value={150}>150 dpi (posters and banners seen from afar)</option>
          </select>
        </label>
        <label class="control">
          <span class="control-label">Bleed the printer asks for (mm)</span>
          <input
            class="input input-number"
            type="number"
            min={0}
            max={20}
            step={0.5}
            value={settings.bleed}
            onInput={(e) => setSettings((s) => ({ ...s, bleed: Math.max(0, Math.min(20, Number(e.currentTarget.value) || 0)) }))}
          />
        </label>
        <p class="control-help">Checks are a guide; your printer’s own preflight has the final say.</p>
      </div>
      <div class="ai-work">
        {file && facts ? (
          <div class="pf-report">
            <ul class="pf-checks" data-testid="pf-checks">
              {checks.map((c) => (
                <li key={c.title} class={`pf-check is-${c.tone}`}>
                  <span class="pf-icon" aria-hidden="true">
                    <Icon name={TONE_ICON[c.tone]} size={16} />
                  </span>
                  <span>
                    <strong>{c.title}</strong>
                    <span class="visually-hidden"> ({c.tone === 'ok' ? 'passed' : c.tone === 'warn' ? 'warning' : c.tone === 'bad' ? 'problem' : 'note'})</span>
                    <span class="pf-detail">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            {progress && <p class="control-help">{progress}</p>}
            {facts.fonts.length > 0 && (
              <details class="pf-section" open={facts.fonts.some((f) => !f.embedded)}>
                <summary>Fonts ({facts.fonts.length})</summary>
                <table class="ref-table pf-table">
                  <thead>
                    <tr>
                      <th scope="col">Font</th>
                      <th scope="col">Type</th>
                      <th scope="col">Embedded</th>
                      <th scope="col">Pages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facts.fonts.map((f, i) => (
                      <tr key={`${f.name}-${i}`}>
                        <td>{f.name}</td>
                        <td>{f.type}</td>
                        <td class={f.embedded ? '' : 'tone-bad'}>{f.embedded ? (f.subset ? 'Yes, subset' : 'Yes') : 'No'}</td>
                        <td>{f.pages.length > 6 ? `${f.pages.slice(0, 6).join(', ')}…` : f.pages.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
            {lowImages.length > 0 && (
              <details class="pf-section" open>
                <summary>
                  Pictures below {settings.dpi} dpi ({lowImages.length})
                </summary>
                <table class="ref-table pf-table" data-testid="pf-images">
                  <thead>
                    <tr>
                      <th scope="col">Page</th>
                      <th scope="col">Pixels</th>
                      <th scope="col">Printed size</th>
                      <th scope="col">Resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowImages.slice(0, 200).map((img, i) => (
                      <tr key={i}>
                        <td>{img.page}</td>
                        <td>
                          {img.pixelsWide} × {img.pixelsHigh}
                        </td>
                        <td>
                          {mmOf(img.width)} × {mmOf(img.height)} mm
                        </td>
                        <td class={img.dpi < settings.dpi / 2 ? 'tone-bad' : 'tone-warn'}>{Math.round(img.dpi)} dpi</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
            <details class="pf-section">
              <summary>Pages ({facts.pages.length})</summary>
              <table class="ref-table pf-table">
                <thead>
                  <tr>
                    <th scope="col">Page</th>
                    <th scope="col">Paper (media box)</th>
                    <th scope="col">Trim box</th>
                    <th scope="col">Bleed</th>
                  </tr>
                </thead>
                <tbody>
                  {facts.pages.slice(0, 500).map((p) => (
                    <tr key={p.number}>
                      <td>{p.number}</td>
                      <td>
                        {mmOf(p.media.width)} × {mmOf(p.media.height)} mm
                      </td>
                      <td>{p.trim ? `${mmOf(p.trim.width)} × ${mmOf(p.trim.height)} mm` : '—'}</td>
                      <td>{p.bleedAmount === null ? '—' : `${mmOf(p.bleedAmount)} mm`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        ) : (
          <FileDrop
            accept=".pdf,application/pdf"
            multiple={false}
            onFiles={take}
            title={loading ? 'Reading…' : 'Drop a PDF here, or click to choose'}
            hint="Checks page size, bleed, fonts, picture resolution and colours before you send it to the printer. Nothing leaves this computer."
            testId="pdf-drop"
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- crop -- */

interface CropSettings {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly pages: string;
  readonly permanent: boolean;
}

const readCrop = (s: Values | undefined): CropSettings => {
  const n = (v: unknown) => (typeof v === 'number' && v >= 0 && v < 1000 ? v : 10);
  return { top: n(s?.top), right: n(s?.right), bottom: n(s?.bottom), left: n(s?.left), pages: typeof s?.pages === 'string' ? s.pages : 'all', permanent: s?.permanent === true };
};

function Crop({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState(toolId, readCrop, (s: CropSettings): Values => ({ ...s }));
  const [file, take, clear, loading] = useSinglePdf();
  const [shown, setShown] = useState(1);
  const [picture, setPicture] = useState<{ url: string; width: number; height: number; scale: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const set = (patch: Partial<CropSettings>) => setSettings((s) => ({ ...s, ...patch }));

  const selection = useMemo(() => {
    if (!file) return { pages: [] as number[], error: '' };
    try {
      return { pages: [...new Set(parsePages(settings.pages || 'all', file.pages))], error: '' };
    } catch (e) {
      return { pages: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [file, settings.pages]);

  useEffect(() => {
    setShown(1);
  }, [file]);

  useEffect(() => {
    setPicture(null);
    if (!file) return;
    let live = true;
    let close: (() => Promise<void>) | null = null;
    void (async () => {
      const opened = await openPdf(file.bytes);
      close = opened.close;
      const page = await opened.doc.getPage(shown);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 560 / base.width, 640 / base.height);
      const canvas = await renderPage(opened.doc, shown, scale);
      canvasRef.current = canvas;
      if (live) setPicture({ url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, scale });
    })().catch(() => undefined);
    return () => {
      live = false;
      void close?.();
    };
  }, [file, shown]);

  const marginsPt: Margins = { top: settings.top / MM_PER_PT, right: settings.right / MM_PER_PT, bottom: settings.bottom / MM_PER_PT, left: settings.left / MM_PER_PT };

  const detect = () => {
    const canvas = canvasRef.current;
    if (!canvas || !picture) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const m = contentMargins(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (!m) return;
    // A little air around the content, then pixels to millimetres.
    const toMm = (px: number) => Math.max(0, Math.round(((px / picture.scale) * MM_PER_PT - 2) * 2) / 2);
    set({ top: toMm(m.top), right: toMm(m.right), bottom: toMm(m.bottom), left: toMm(m.left) });
  };

  const run = () =>
    attempt(async () => {
      if (!file) return;
      if (selection.error) throw new Error(selection.error);
      const doc = await PDFDocument.load(file.bytes, { updateMetadata: false });
      cropPages(doc, selection.pages, () => marginsPt, settings.permanent);
      await save(`${stem(file.name)} (cropped).pdf`, await doc.save());
    });

  const box = picture
    ? {
        left: (marginsPt.left * picture.scale * 100) / picture.width,
        top: (marginsPt.top * picture.scale * 100) / picture.height,
        right: (marginsPt.right * picture.scale * 100) / picture.width,
        bottom: (marginsPt.bottom * picture.scale * 100) / picture.height,
      }
    : null;

  return (
    <div data-testid="tool" class="tool ai-tool" data-state={file ? 'done' : 'idle'}>
      <div class="ai-controls">
        {file && <FileBar file={file} onReplace={pick(take)} onClear={clear} />}
        <fieldset class="np-ranges">
          <legend>Cut off (mm)</legend>
          <div class="pdfcrop-margins">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <label key={side}>
                {side[0]?.toUpperCase() + side.slice(1)}
                <input
                  class="input input-number"
                  type="number"
                  min={0}
                  step={0.5}
                  value={settings[side]}
                  onInput={(e) => set({ [side]: Math.max(0, Number(e.currentTarget.value) || 0) })}
                  data-testid={`crop-${side}`}
                />
              </label>
            ))}
          </div>
          <button type="button" class="button button-small" onClick={detect} disabled={!picture} data-testid="crop-detect">
            Find the white margins
          </button>
        </fieldset>
        <label class="control">
          <span class="control-label">Pages</span>
          <input class="input input-mono" value={settings.pages} onInput={(e) => set({ pages: e.currentTarget.value })} placeholder="all, odd, even, 1-3, 8-" />
          {selection.error && <span class="recipe-error">{selection.error}</span>}
        </label>
        <label class="toggle">
          <input type="checkbox" checked={settings.permanent} onChange={(e) => set({ permanent: e.currentTarget.checked })} />
          <span class="toggle-track" aria-hidden="true" />
          Also change the paper size
        </label>
        <p class="control-help">
          Cropping hides the edges; the content is still in the file, so you can undo it later. Changing the paper size makes every program, printers included, use the smaller page.
        </p>
        <button type="button" class="button button-primary" disabled={!file || !selection.pages.length} onClick={run} data-testid="crop-save">
          <Icon name="save" size={16} /> Save cropped PDF
        </button>
      </div>
      <div class="ai-work">
        {file ? (
          <div class="pdfcrop-view">
            {file.pages > 1 && (
              <div class="doc-pager">
                <button type="button" class="icon-button" aria-label="Previous page" disabled={shown <= 1} onClick={() => setShown((n) => Math.max(1, n - 1))}>
                  <Icon name="left" size={16} />
                </button>
                <span>
                  Page {shown} of {file.pages}
                  {selection.pages.includes(shown) ? '' : ' (not cropped)'}
                </span>
                <button type="button" class="icon-button" aria-label="Next page" disabled={shown >= file.pages} onClick={() => setShown((n) => Math.min(file.pages, n + 1))}>
                  <Icon name="right" size={16} />
                </button>
              </div>
            )}
            {picture && box ? (
              <div class="pdfcrop-stage" style={{ width: `${picture.width}px`, maxWidth: '100%', aspectRatio: `${picture.width} / ${picture.height}` }}>
                <img src={picture.url} alt={`Page ${shown}`} />
                {selection.pages.includes(shown) && (
                  <div class="pdfcrop-keep" style={{ left: `${box.left}%`, top: `${box.top}%`, right: `${box.right}%`, bottom: `${box.bottom}%` }} data-testid="crop-box" />
                )}
              </div>
            ) : (
              <span class="spinner" aria-hidden="true" />
            )}
          </div>
        ) : (
          <FileDrop
            accept=".pdf,application/pdf"
            multiple={false}
            onFiles={take}
            title={loading ? 'Reading…' : 'Drop a PDF here, or click to choose'}
            hint="Trim white margins or crop scans to the page. Nothing leaves this computer."
            testId="pdf-drop"
          />
        )}
      </div>
    </div>
  );
}

function PrintTools({ toolId }: { toolId: string }) {
  if (toolId === 'pdf-preflight') return <Preflight toolId={toolId} />;
  if (toolId === 'pdf-crop') return <Crop toolId={toolId} />;
  return <Imposer toolId={toolId} />;
}

export default defineCustomTool(PrintTools);
