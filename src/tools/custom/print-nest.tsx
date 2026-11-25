/**
 * Print Production Studio, nesting: pieces of different sizes fitted onto
 * sheets or along a roll with as little waste as it finds, for ganging small
 * jobs on one press sheet and for cutting board, vinyl and fabric.  Pieces
 * are typed in, or taken from PDFs and pictures whose artwork then goes into
 * the PDF of the sheets.
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import { cutList, type NestResult, nest, type Placement } from '../../lib/nesting';
import { findPaper } from '../../lib/paper';
import { type NestSource, nestPdf, PT } from '../../lib/print-pdf';
import { pickFiles, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import type { Values } from '../types';
import { isPdf, readPdf } from './_pdf';
import { clamp, Sure } from './_shared';

export interface NestPiece {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly quantity: number;
  readonly rotate: boolean;
}

export interface NestSettings {
  /** A paper's id, `roll`, or `custom`. */
  readonly paper: string;
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly gap: number;
  readonly marks: boolean;
  readonly pieces: readonly NestPiece[];
}

const SHEET_CHOICES = ['a4', 'a3', 'sra3', 'sra2', 'sra1', 'b2', 'b1', 'double-demy', 'double-crown', 'tabloid', 'arch-d'] as const;
/** More copies than this would take too long to place. */
const MAX_COPIES = 3000;

const num = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback);

export function readNest(v: Values | undefined): NestSettings {
  const pieces: NestPiece[] = [];
  if (Array.isArray(v?.pieces)) {
    for (const raw of v.pieces.slice(0, 200)) {
      if (!raw || typeof raw !== 'object') continue;
      const p = raw as Record<string, unknown>;
      if (typeof p.id !== 'string' || !p.id || pieces.some((q) => q.id === p.id)) continue;
      pieces.push({
        id: p.id.slice(0, 40),
        name: typeof p.name === 'string' ? p.name.slice(0, 80) : '',
        width: num(p.width, 100, 1, 20000),
        height: num(p.height, 100, 1, 20000),
        quantity: Math.round(num(p.quantity, 1, 0, MAX_COPIES)),
        rotate: p.rotate !== false,
      });
    }
  }
  const paper = typeof v?.paper === 'string' && (v.paper === 'roll' || v.paper === 'custom' || findPaper(v.paper)) ? v.paper : 'sra3';
  return { paper, width: num(v?.width, 320, 10, 20000), height: num(v?.height, 450, 10, 100000), margin: num(v?.margin, 10, 0, 200), gap: num(v?.gap, 4, 0, 200), marks: v?.marks === true, pieces };
}

const SAMPLE: readonly Omit<NestPiece, 'id'>[] = [
  { name: 'Flyer A5', width: 148, height: 210, quantity: 4, rotate: true },
  { name: 'Postcard', width: 148, height: 105, quantity: 6, rotate: true },
  { name: 'Business card', width: 85, height: 55, quantity: 20, rotate: true },
  { name: 'Bookmark', width: 50, height: 180, quantity: 8, rotate: true },
  { name: 'Round sticker (60 mm)', width: 60, height: 60, quantity: 12, rotate: false },
];

let made = 0;
const newId = () => `p${Date.now().toString(36)}${(made++).toString(36)}`;
const round1 = (value: number) => Math.round(value * 10) / 10;

/** A picture as PNG or JPEG bytes, which is what a PDF can hold: other kinds are redrawn as PNG. */
async function pictureSource(file: File): Promise<{ source: NestSource; width: number; height: number }> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`${file.name} could not be read as a picture.`);
  });
  try {
    const { width, height } = bitmap;
    if (file.type === 'image/png' || file.type === 'image/jpeg')
      return { source: { kind: 'image', bytes: new Uint8Array(await file.arrayBuffer()), type: file.type === 'image/png' ? 'png' : 'jpeg' }, width, height };
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    if (!blob) throw new Error(`${file.name} could not be read as a picture.`);
    return { source: { kind: 'image', bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' }, width, height };
  } finally {
    bitmap.close();
  }
}

function SheetPicture({
  index,
  width,
  height,
  margin,
  placed,
  names,
  letters,
  roll,
}: {
  index: number;
  width: number;
  height: number;
  margin: number;
  placed: readonly Placement[];
  names: Readonly<Record<string, string>>;
  letters: Readonly<Record<string, string>>;
  roll: boolean;
}) {
  // Lettering is sized in the sheet's own millimetres, so it is set against the sheet's width.
  const least = width / 46;
  const corner = Math.max(2.5, width / 90);
  return (
    <svg
      class="pn-sheet"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${roll ? 'The roll' : `Sheet ${index + 1}`}: ${placed.length} piece${placed.length === 1 ? '' : 's'}`}
      data-testid="pn-sheet"
    >
      <rect class="pn-paper" x={0} y={0} width={width} height={height} />
      {margin > 0 && width > 2 * margin && height > 2 * margin && <rect class="pn-margin" x={margin} y={margin} width={width - 2 * margin} height={height - 2 * margin} />}
      {placed.map((p) => {
        const tall = p.height > p.width * 1.3;
        const along = tall ? p.height : p.width;
        const across = tall ? p.width : p.height;
        const sizeFor = (text: string) => Math.min(along / Math.max(1.6, text.length * 0.58), across * 0.42, width / 22);
        // The piece's name where there is room for it, and otherwise its letter from the list.
        const full = names[p.id] ?? '';
        const name = full && sizeFor(full) >= least ? full : (letters[p.id] ?? '');
        const size = sizeFor(name);
        const cx = p.x + p.width / 2;
        const cy = p.y + p.height / 2;
        // The corner mark sits at the top left of the piece's artwork: the bottom left of its box when it is turned.
        const mark = p.rotated ? `${p.x},${p.y + p.height} ${p.x + corner},${p.y + p.height} ${p.x},${p.y + p.height - corner}` : `${p.x},${p.y} ${p.x + corner},${p.y} ${p.x},${p.y + corner}`;
        return (
          <g key={`${p.id}-${p.copy}`}>
            <rect class="pn-piece" x={p.x} y={p.y} width={p.width} height={p.height} />
            <polygon class="pn-corner" points={mark} />
            {name && size >= least && (
              <text class="pn-label" x={cx} y={cy} font-size={size} text-anchor="middle" dominant-baseline="central" transform={tall ? `rotate(-90 ${cx} ${cy})` : undefined}>
                {name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function NestTab({ settings, set }: { settings: NestSettings; set: (patch: Partial<NestSettings>) => void }) {
  // Artwork is kept beside the list, not in it: it is too large to store with the settings.
  const sources = useRef<Record<string, NestSource & { ratio?: number }>>({});
  const [, redraw] = useState(0);
  const [busy, setBusy] = useState(false);

  const roll = settings.paper === 'roll';
  const pieces = settings.pieces;
  const copies = pieces.reduce((sum, p) => sum + Math.max(0, p.quantity), 0);
  const names = useMemo(() => Object.fromEntries(pieces.map((p, i) => [p.id, p.name.trim() || `Piece ${i + 1}`])), [pieces]);
  const letters = useMemo(() => Object.fromEntries(pieces.map((p, i) => [p.id, i < 26 ? String.fromCharCode(65 + i) : String(i + 1)])), [pieces]);

  const result = useMemo<NestResult | null>(() => {
    if (!copies || copies > MAX_COPIES) return null;
    return nest(pieces, { sheetWidth: settings.width, sheetHeight: roll ? 0 : settings.height, margin: settings.margin, gap: settings.gap });
  }, [pieces, copies, settings.width, settings.height, settings.margin, settings.gap, roll]);

  const change = (id: string, patch: Partial<NestPiece>) => {
    const ratio = sources.current[id]?.ratio;
    set({
      pieces: pieces.map((p) => {
        if (p.id !== id) return p;
        // A piece with artwork keeps its proportions: one side follows the other.
        if (ratio && patch.width !== undefined) return { ...p, width: patch.width, height: round1(patch.width / ratio) };
        if (ratio && patch.height !== undefined) return { ...p, height: patch.height, width: round1(patch.height * ratio) };
        return { ...p, ...patch };
      }),
    });
  };
  const remove = (id: string) => {
    delete sources.current[id];
    set({ pieces: pieces.filter((p) => p.id !== id) });
  };
  const add = (extra: readonly NestPiece[]) => set({ pieces: [...pieces, ...extra].slice(0, 200) });

  const choosePaper = (id: string) => {
    if (id === 'roll') set({ paper: 'roll', width: settings.paper === 'roll' ? settings.width : 1370 });
    else if (id === 'custom') set({ paper: 'custom' });
    else {
      const paper = findPaper(id);
      if (paper) set({ paper: id, width: paper.width, height: paper.height });
    }
  };

  const addFiles = () =>
    attempt(async () => {
      const files = await pickFiles('.pdf,application/pdf,image/png,image/jpeg,image/webp,image/avif');
      if (!files.length) return;
      setBusy(true);
      try {
        const extra: NestPiece[] = [];
        for (const file of files) {
          if (isPdf(file)) {
            const pdf = await readPdf(file);
            const count = Math.min(pdf.pages, 40);
            for (let page = 0; page < count; page++) {
              const size = pdf.doc.getPage(page).getSize();
              if (!(size.width > 0 && size.height > 0)) continue;
              const id = newId();
              sources.current[id] = { kind: 'pdf', doc: pdf.doc, page, ratio: size.width / size.height };
              extra.push({
                id,
                name: `${file.name.replace(/\.pdf$/i, '')}${pdf.pages > 1 ? `, page ${page + 1}` : ''}`.slice(0, 80),
                width: round1(size.width / PT),
                height: round1(size.height / PT),
                quantity: 1,
                rotate: true,
              });
            }
          } else {
            const { source, width, height } = await pictureSource(file);
            const id = newId();
            sources.current[id] = { ...source, ratio: width / height };
            // A picture has no size of its own on paper: 300 dots to the inch is the usual start.
            extra.push({ id, name: file.name.replace(/\.[^.]+$/, '').slice(0, 80), width: round1((width / 300) * 25.4), height: round1((height / 300) * 25.4), quantity: 1, rotate: true });
          }
        }
        add(extra);
      } finally {
        setBusy(false);
        redraw((n) => n + 1);
      }
    });

  const sheetHeight = roll ? (result?.usedHeight ?? 0) : settings.height;
  const savePdf = () =>
    attempt(async () => {
      if (!result?.placements.length) return;
      setBusy(true);
      try {
        const bytes = await nestPdf(result.placements, sources.current, { width: settings.width, height: sheetHeight, marks: settings.marks, names });
        const saved = await saveFile('nested-sheets.pdf', bytes, 'application/pdf');
        if (saved.saved) notify(`Saved to ${saved.location}`);
      } finally {
        setBusy(false);
      }
    });
  const saveList = () =>
    attempt(async () => {
      if (!result?.placements.length) return;
      const saved = await saveFile('cutting-list.csv', new TextEncoder().encode(`\uFEFF${cutList(result.placements, names)}`), 'text/csv');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });

  const placedCount = result?.placements.length ?? 0;
  const left = result?.leftOut.reduce((sum, l) => sum + l.copies, 0) ?? 0;
  const shownSheets = Math.min(result?.sheets ?? 0, 12);
  const tight = settings.marks && (settings.gap < 4 || settings.margin < 4);

  return (
    <div class="pp-main" data-testid="pp-nest" data-state={result ? 'done' : 'idle'}>
      <div class="pp-stage">
        {result && placedCount > 0 ? (
          <>
            <p class="pn-summary" data-testid="pn-summary">
              {roll
                ? `${placedCount} piece${placedCount === 1 ? '' : 's'} on ${(result.usedHeight / 1000).toFixed(2)} m of the roll`
                : `${placedCount} piece${placedCount === 1 ? '' : 's'} on ${result.sheets} sheet${result.sheets === 1 ? '' : 's'}`}
              , {Math.round(result.coverage * 100)} % of the {roll ? 'length used' : 'paper'} covered
            </p>
            <div class="pn-sheets" {...scrollRegion('The sheets')}>
              {Array.from({ length: shownSheets }, (_, s) => (
                <figure key={s} class="pn-figure">
                  <SheetPicture
                    index={s}
                    width={settings.width}
                    height={sheetHeight}
                    margin={settings.margin}
                    placed={result.placements.filter((p) => p.sheet === s)}
                    names={names}
                    letters={letters}
                    roll={roll}
                  />
                  <figcaption>
                    {roll ? `Roll, ${round1(settings.width)} mm wide` : `Sheet ${s + 1}`}: {result.placements.filter((p) => p.sheet === s).length} pieces
                  </figcaption>
                </figure>
              ))}
            </div>
            {result.sheets > shownSheets && (
              <p class="control-help">
                The first {shownSheets} sheets are drawn here; all {result.sheets} are in the PDF and in the cutting list.
              </p>
            )}
            <p class="control-help">
              The small corner on each piece marks the top left of its artwork, so a turned piece is easy to tell. A piece too small for its name carries its letter from the list.
            </p>
          </>
        ) : (
          <p class="pp-empty" data-testid="pn-empty">
            {copies > MAX_COPIES
              ? `That is ${copies} pieces in all; up to ${MAX_COPIES} are placed here. Lower the quantities, or nest the job in parts.`
              : left > 0
                ? 'None of the pieces fits the sheet: choose a larger sheet, or smaller margins.'
                : 'List the pieces to fit on the sheet: type their sizes, add PDFs or pictures, or load the sample job.'}
          </p>
        )}
      </div>

      <div class="pp-side">
        <div class="pp-panel">
          <span class="pane-title">Sheet</span>
          <label class="control">
            <span class="control-label">Size</span>
            <select class="select" value={settings.paper} onChange={(e) => choosePaper(e.currentTarget.value)} data-testid="pn-paper">
              {SHEET_CHOICES.map((id) => {
                const paper = findPaper(id);
                return paper ? (
                  <option key={id} value={id}>
                    {paper.name} ({round1(paper.width)} × {round1(paper.height)} mm)
                  </option>
                ) : null;
              })}
              <option value="roll">A roll (as long as it takes)</option>
              <option value="custom">Another size</option>
            </select>
          </label>
          <div class="control-row">
            <label class="control">
              <span class="control-label">Width (mm)</span>
              <input
                class="input input-number"
                type="number"
                min={10}
                max={20000}
                step={1}
                value={settings.width}
                onChange={(e) => set({ paper: roll ? 'roll' : 'custom', width: clamp(Number(e.currentTarget.value) || 10, 10, 20000) })}
                data-testid="pn-width"
              />
            </label>
            {!roll && (
              <label class="control">
                <span class="control-label">Height (mm)</span>
                <input
                  class="input input-number"
                  type="number"
                  min={10}
                  max={100000}
                  step={1}
                  value={settings.height}
                  onChange={(e) => set({ paper: 'custom', height: clamp(Number(e.currentTarget.value) || 10, 10, 100000) })}
                  data-testid="pn-height"
                />
              </label>
            )}
            {!roll && (
              <button type="button" class="button button-small button-quiet" onClick={() => set({ paper: 'custom', width: settings.height, height: settings.width })} data-testid="pn-turn">
                <Icon name="rotate-right" size={14} /> Turn the sheet
              </button>
            )}
          </div>
          <div class="control-row">
            <label class="control">
              <span class="control-label">Clear edge (mm)</span>
              <input
                class="input input-number"
                type="number"
                min={0}
                max={200}
                step={1}
                value={settings.margin}
                onChange={(e) => set({ margin: clamp(Number(e.currentTarget.value) || 0, 0, 200) })}
                data-testid="pn-margin"
              />
            </label>
            <label class="control">
              <span class="control-label">Between pieces (mm)</span>
              <input
                class="input input-number"
                type="number"
                min={0}
                max={200}
                step={1}
                value={settings.gap}
                onChange={(e) => set({ gap: clamp(Number(e.currentTarget.value) || 0, 0, 200) })}
                data-testid="pn-gap"
              />
            </label>
          </div>
          <label class="check">
            <input type="checkbox" checked={settings.marks} onChange={(e) => set({ marks: e.currentTarget.checked })} data-testid="pn-marks" />
            Crop marks at every piece in the PDF
          </label>
          {tight && <p class="control-help">Crop marks are 3 mm long and stand 1 mm off each piece: leave at least 4 mm between pieces and at the edge, or they run into the neighbours.</p>}
        </div>

        <div class="pp-panel">
          <span class="pane-title">Pieces</span>
          {pieces.length > 0 && (
            <div class="pn-table" data-testid="pn-pieces">
              <div class="pn-row pn-head" aria-hidden="true">
                <span />
                <span>Name</span>
                <span>Width</span>
                <span>Height</span>
                <span>Copies</span>
                <span title="May be turned a quarter turn">Turn</span>
                <span />
              </div>
              {pieces.map((p, i) => {
                const label = names[p.id] ?? `Piece ${i + 1}`;
                const art = sources.current[p.id]?.kind;
                return (
                  <div key={p.id} class="pn-row" data-testid="pn-piece">
                    <span class="pn-letter" aria-hidden="true">
                      {letters[p.id]}
                    </span>
                    <span class="pn-name">
                      <input
                        class="input"
                        type="text"
                        value={p.name}
                        maxLength={80}
                        placeholder={`Piece ${i + 1}`}
                        aria-label={`Name of piece ${i + 1}`}
                        onChange={(e) => change(p.id, { name: e.currentTarget.value })}
                      />
                      {art && art !== 'outline' && <span class="pn-art">{art === 'pdf' ? 'PDF artwork' : 'picture'}</span>}
                    </span>
                    <input
                      class="input input-number"
                      type="number"
                      min={1}
                      max={20000}
                      step={0.5}
                      value={p.width}
                      aria-label={`Width of ${label} in millimetres`}
                      onChange={(e) => change(p.id, { width: clamp(Number(e.currentTarget.value) || 1, 1, 20000) })}
                    />
                    <input
                      class="input input-number"
                      type="number"
                      min={1}
                      max={20000}
                      step={0.5}
                      value={p.height}
                      aria-label={`Height of ${label} in millimetres`}
                      onChange={(e) => change(p.id, { height: clamp(Number(e.currentTarget.value) || 1, 1, 20000) })}
                    />
                    <input
                      class="input input-number"
                      type="number"
                      min={0}
                      max={MAX_COPIES}
                      step={1}
                      value={p.quantity}
                      aria-label={`Copies of ${label}`}
                      onChange={(e) => change(p.id, { quantity: clamp(Math.round(Number(e.currentTarget.value)) || 0, 0, MAX_COPIES) })}
                    />
                    <input type="checkbox" checked={p.rotate} aria-label={`${label} may be turned`} onChange={(e) => change(p.id, { rotate: e.currentTarget.checked })} />
                    <button type="button" class="icon-button" aria-label={`Remove ${label}`} onClick={() => remove(p.id)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div class="button-row">
            <button type="button" class="button button-small" onClick={() => add([{ id: newId(), name: '', width: 100, height: 100, quantity: 1, rotate: true }])} data-testid="pn-add">
              <Icon name="plus" size={14} /> Add a piece
            </button>
            <button type="button" class="button button-small" disabled={busy} onClick={addFiles} data-testid="pn-files">
              <Icon name="file" size={14} /> Add PDFs or pictures
            </button>
            {pieces.length === 0 ? (
              <button type="button" class="button button-small button-quiet" onClick={() => set({ pieces: SAMPLE.map((p) => ({ ...p, id: newId() })) })} data-testid="pn-sample">
                <Icon name="sample" size={14} /> Sample job
              </button>
            ) : (
              <Sure
                class="button button-small button-quiet"
                sure="Remove every piece?"
                onConfirm={() => {
                  sources.current = {};
                  set({ pieces: [] });
                }}
                testId="pn-clear"
              >
                Remove all
              </Sure>
            )}
          </div>
          <p class="control-help">Untick “Turn” for a piece whose grain, weave or pattern has to run one way. Pieces from files keep their proportions, and each page of a PDF becomes a piece.</p>
        </div>

        <div class="pp-panel" data-testid="pn-result">
          <span class="pane-title">Result</span>
          {result && placedCount > 0 ? (
            <dl class="pp-facts">
              <div>
                <dt>{roll ? 'Length of roll used' : 'Sheets'}</dt>
                <dd data-testid="pn-sheets">{roll ? `${(result.usedHeight / 1000).toFixed(2)} m` : result.sheets}</dd>
              </div>
              <div>
                <dt>Covered by pieces</dt>
                <dd data-testid="pn-coverage">{Math.round(result.coverage * 100)} %</dd>
              </div>
              <div>
                <dt>Pieces placed</dt>
                <dd data-testid="pn-placed">
                  {placedCount} of {copies}
                </dd>
              </div>
            </dl>
          ) : (
            <p class="tone-muted">Nothing yet.</p>
          )}
          {result && result.leftOut.length > 0 && (
            <p class="pp-warning" data-testid="pn-left">
              <Icon name="alert" size={15} />
              <span>Too large for the sheet, and left out: {result.leftOut.map((l) => `${l.copies} × ${names[l.id] ?? l.id}`).join(', ')}.</span>
            </p>
          )}
          <div class="button-row">
            <button type="button" class="button button-small button-primary" disabled={!placedCount || busy} onClick={savePdf} data-testid="pn-save">
              <Icon name="save" size={14} /> PDF of the sheets
            </button>
            <button type="button" class="button button-small" disabled={!placedCount} onClick={saveList} data-testid="pn-list">
              <Icon name="save" size={14} /> Cutting list (CSV)
            </button>
          </div>
          <p class="control-help">
            The nesting tries fifteen ways of ordering and fitting the pieces and keeps the best: good for a quick layout, though a patient person can sometimes find a tighter one by hand.
          </p>
        </div>
      </div>
    </div>
  );
}
