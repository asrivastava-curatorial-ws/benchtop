/**
 * Print Production Studio, sheets: the cheapest way to print a job.  For a
 * finished size and a quantity it tries every paper on the list, cut every
 * way the press can take, with the pieces upright, turned or both, and ranks
 * the results by what the paper costs and how much of it is wasted.  The
 * chosen layout is drawn, and saved as a PDF of the press sheet.
 */
import type { PDFDocument } from 'pdf-lib';
import { useMemo, useState } from 'preact/hooks';
import type { Placement } from '../../lib/nesting';
import { type NestSource, nestPdf, PT, trimOf } from '../../lib/print-pdf';
import { type Job, type Plan, type Press, piecesOf, planJob, STOCKS, type Stock, withoutWorse } from '../../lib/sheet-plan';
import { pickFiles, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import type { Values } from '../types';
import { readPdf } from './_pdf';
import { clamp } from './_shared';

export interface StockRow extends Stock {
  /** Whether the paper is tried: papers not in stock just now can stay on the list. */
  readonly use: boolean;
}

export interface SheetSettings {
  readonly job: Job;
  /** One of the presses below, or `custom`. */
  readonly pressId: string;
  readonly press: Press;
  readonly stocks: readonly StockRow[];
}

/** Sheet sizes typical of each class of press; a press's own manual has its exact limits. */
const PRESSES: readonly ({ readonly id: string; readonly name: string } & Press)[] = [
  { id: 'digital', name: 'Digital press, SRA3 (to 330 × 487 mm)', maxLong: 487, maxShort: 330, minLong: 148, minShort: 100 },
  { id: 'b3', name: 'B3 offset press (to 370 × 520 mm)', maxLong: 520, maxShort: 370, minLong: 148, minShort: 105 },
  { id: 'b2', name: 'B2 offset press (to 530 × 740 mm)', maxLong: 740, maxShort: 530, minLong: 280, minShort: 210 },
  { id: 'b1', name: 'B1 offset press (to 720 × 1020 mm)', maxLong: 1020, maxShort: 720, minLong: 480, minShort: 340 },
];
const B2 = PRESSES[2] as Press;

const num = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback);
const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export function readSheets(v: Values | undefined): SheetSettings {
  const j = record(v?.job);
  const p = record(v?.press);
  const stocks: StockRow[] = [];
  if (Array.isArray(v?.stocks)) {
    for (const raw of v.stocks.slice(0, 60)) {
      const s = record(raw);
      if (typeof s.id !== 'string' || !s.id || stocks.some((other) => other.id === s.id)) continue;
      stocks.push({
        id: s.id.slice(0, 40),
        name: typeof s.name === 'string' ? s.name.slice(0, 60) : '',
        width: num(s.width, 450, 50, 5000),
        height: num(s.height, 640, 50, 5000),
        grain: s.grain === 'short' || s.grain === 'none' ? s.grain : 'long',
        cost: num(s.cost, 0, 0, 1e9),
        use: s.use !== false,
      });
    }
  }
  return {
    job: {
      width: num(j.width, 148, 5, 5000),
      height: num(j.height, 210, 5, 5000),
      bleed: num(j.bleed, 3, 0, 30),
      gap: num(j.gap, 0, 0, 100),
      quantity: Math.round(num(j.quantity, 1000, 1, 10_000_000)),
      spoilage: num(j.spoilage, 5, 0, 100),
      gripper: num(j.gripper, 10, 0, 100),
      edge: num(j.edge, 5, 0, 100),
      turn: j.turn !== false,
      grain: j.grain === 'height' || j.grain === 'width' ? j.grain : 'any',
    },
    pressId: typeof v?.pressId === 'string' && (v.pressId === 'custom' || PRESSES.some((press) => press.id === v.pressId)) ? v.pressId : 'b2',
    press: {
      maxLong: num(p.maxLong, B2.maxLong, 100, 5000),
      maxShort: num(p.maxShort, B2.maxShort, 100, 5000),
      minLong: num(p.minLong, B2.minLong, 0, 5000),
      minShort: num(p.minShort, B2.minShort, 0, 5000),
    },
    stocks: Array.isArray(v?.stocks) ? stocks : STOCKS.map((s) => ({ ...s, cost: 0, use: true })),
  };
}

interface Artwork {
  readonly name: string;
  readonly doc: PDFDocument;
  readonly pages: number;
}

/** How a PDF of the piece sits in the layout: how much of its bleed is kept, and which part of its page that is. */
type Fit = { readonly ok: true; readonly keep: number; readonly clip: NonNullable<Extract<NestSource, { kind: 'pdf' }>['clip']> } | { readonly ok: false; readonly why: string };

function fitArtwork(art: Artwork, job: Job): Fit {
  const page = art.doc.getPage(0);
  const { trim, media, own } = trimOf(page, 0);
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.6;
  const size = (w: number, h: number) => `${Math.round(w * 10) / 10} × ${Math.round(h * 10) / 10} mm`;
  let box = trim;
  if (!own) {
    const w = media.width / PT;
    const h = media.height / PT;
    if (near(w, job.width + 2 * job.bleed) && near(h, job.height + 2 * job.bleed) && job.bleed > 0) {
      const inset = job.bleed * PT;
      box = { x: media.x + inset, y: media.y + inset, width: media.width - 2 * inset, height: media.height - 2 * inset };
    } else if (!(near(w, job.width) && near(h, job.height))) {
      return {
        ok: false,
        why: `Its pages are ${size(w, h)}, which is neither the piece (${size(job.width, job.height)}) nor the piece with its bleed (${size(job.width + 2 * job.bleed, job.height + 2 * job.bleed)}).`,
      };
    }
  } else if (!(near(trim.width / PT, job.width) && near(trim.height / PT, job.height))) {
    return { ok: false, why: `Its pages are trimmed to ${size(trim.width / PT, trim.height / PT)}, and the piece is ${size(job.width, job.height)}.` };
  }
  // The same bleed is kept on every side, so that a turned piece needs no special care: the least the page has, up to what the job asks.
  const have = Math.min(box.x - media.x, box.y - media.y, media.x + media.width - (box.x + box.width), media.y + media.height - (box.y + box.height)) / PT;
  const keep = Math.max(0, Math.min(job.bleed, have));
  const k = keep * PT;
  return { ok: true, keep, clip: { left: box.x - k, bottom: box.y - k, right: box.x + box.width + k, top: box.y + box.height + k } };
}

const keyOf = (plan: Plan) => `${plan.stock.id}:${plan.cut.across}x${plan.cut.down}`;
const round1 = (value: number) => Math.round(value * 10) / 10;
const money = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: value < 100 ? 2 : 0 });

let made = 0;
const newId = () => `s${Date.now().toString(36)}${(made++).toString(36)}`;
const blankStock = (): StockRow => ({ id: newId(), name: '', width: 450, height: 640, grain: 'long', cost: 0, use: true });

function PlanPicture({ plan, job }: { plan: Plan; job: Job }) {
  const { width, height } = plan.sheet;
  const wide = width >= height;
  const boxes = piecesOf(plan.layout, job.gap);
  const corner = Math.max(2.5, Math.max(width, height) / 110);
  return (
    <svg
      class="ps-sheet"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`The press sheet, ${round1(width)} by ${round1(height)} millimetres, with ${plan.perSheet} pieces`}
      data-testid="ps-picture"
    >
      <rect class="pn-paper" x={0} y={0} width={width} height={height} />
      {job.gripper > 0 &&
        (wide ? <rect class="ps-gripper" x={0} y={height - job.gripper} width={width} height={job.gripper} /> : <rect class="ps-gripper" x={0} y={0} width={job.gripper} height={height} />)}
      <rect class="pn-margin" x={plan.area.x} y={plan.area.y} width={plan.area.width} height={plan.area.height} />
      {boxes.map((b, i) => {
        const x = plan.area.x + b.x;
        const y = plan.area.y + b.y;
        const tx = x + job.bleed;
        const ty = y + job.bleed;
        const tw = b.width - 2 * job.bleed;
        const th = b.height - 2 * job.bleed;
        const mark = b.turned ? `${tx},${ty + th} ${tx + corner},${ty + th} ${tx},${ty + th - corner}` : `${tx},${ty} ${tx + corner},${ty} ${tx},${ty + corner}`;
        return (
          <g key={i}>
            {job.bleed > 0 && <rect class="ps-bleed" x={x} y={y} width={b.width} height={b.height} />}
            <rect class="pn-piece" x={tx} y={ty} width={tw} height={th} />
            <polygon class="pn-corner" points={mark} />
          </g>
        );
      })}
    </svg>
  );
}

export function SheetsTab({ settings, set }: { settings: SheetSettings; set: (patch: Partial<SheetSettings>) => void }) {
  const { job, press, stocks } = settings;
  const [picked, setPicked] = useState('');
  const [art, setArt] = useState<Artwork | null>(null);
  const [busy, setBusy] = useState(false);

  const setJob = (patch: Partial<Job>) => set({ job: { ...job, ...patch } });
  const setStock = (id: string, patch: Partial<StockRow>) => set({ stocks: stocks.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const choosePress = (id: string) => {
    const preset = PRESSES.find((p) => p.id === id);
    if (preset) set({ pressId: id, press: { maxLong: preset.maxLong, maxShort: preset.maxShort, minLong: preset.minLong, minShort: preset.minShort } });
    else set({ pressId: 'custom' });
  };
  const setPress = (patch: Partial<Press>) => set({ pressId: 'custom', press: { ...press, ...patch } });

  const plans = useMemo(
    () =>
      withoutWorse(
        planJob(
          job,
          stocks.filter((s) => s.use),
          press,
        ),
      ),
    [job, stocks, press],
  );
  const plan = plans.find((p) => keyOf(p) === picked) ?? plans[0] ?? null;
  const priced = stocks.some((s) => s.use && s.cost > 0);
  const fit = useMemo(() => (art ? fitArtwork(art, job) : null), [art, job]);

  const number = (label: string, value: number, change: (value: number) => void, limits: { min: number; max: number; step?: number }, testId?: string) => (
    <label class="control">
      <span class="control-label">{label}</span>
      <input
        class="input input-number"
        type="number"
        min={limits.min}
        max={limits.max}
        step={limits.step ?? 1}
        value={value}
        onChange={(e) => change(clamp(Number(e.currentTarget.value) || limits.min, limits.min, limits.max))}
        data-testid={testId}
      />
    </label>
  );

  const chooseArt = () =>
    attempt(async () => {
      const [file] = await pickFiles('.pdf,application/pdf');
      if (!file) return;
      const pdf = await readPdf(file);
      setArt({ name: pdf.name, doc: pdf.doc, pages: pdf.pages });
    });

  const savePdf = () =>
    attempt(async () => {
      if (!plan) return;
      setBusy(true);
      try {
        const useArt = art && fit?.ok ? { art, keep: fit.keep, clip: fit.clip } : null;
        // With artwork, each piece's box is its trim and the bleed the artwork has; without, the whole bleed asked for.
        const shrink = useArt ? job.bleed - useArt.keep : 0;
        const { width, height } = plan.sheet;
        const front: Placement[] = piecesOf(plan.layout, job.gap).map((b, copy) => ({
          id: 'front',
          copy,
          sheet: 0,
          x: plan.area.x + b.x + shrink,
          y: plan.area.y + b.y + shrink,
          width: b.width - 2 * shrink,
          height: b.height - 2 * shrink,
          rotated: b.turned,
        }));
        const placements = [...front];
        const sources: Record<string, NestSource> = {};
        if (useArt) {
          sources.front = { kind: 'pdf', doc: useArt.art.doc, page: 0, clip: useArt.clip };
          if (useArt.art.pages > 1) {
            sources.back = { kind: 'pdf', doc: useArt.art.doc, page: 1, clip: useArt.clip };
            // The back of the sheet: the sheet is turned over about the edge the grippers hold, so each piece moves to the
            // mirrored place and is turned so that its head meets the head of the front.
            const wide = width >= height;
            for (const p of front)
              placements.push(wide ? { ...p, id: 'back', sheet: 1, x: width - p.x - p.width, flip: p.rotated } : { ...p, id: 'back', sheet: 1, y: height - p.y - p.height, flip: !p.rotated });
          }
        }
        const label = `${round1(job.width)} x ${round1(job.height)} mm`;
        const bytes = await nestPdf(placements, sources, { width, height, marks: true, names: { front: label, back: label }, inset: useArt ? useArt.keep : job.bleed });
        const saved = await saveFile(`press-sheet-${plan.perSheet}-up.pdf`, bytes, 'application/pdf');
        if (saved.saved) notify(`Saved to ${saved.location}`);
      } finally {
        setBusy(false);
      }
    });

  const turnedCount = plan ? plan.layout.blocks.filter((b) => b.turned).reduce((sum, b) => sum + b.cols * b.rows, 0) : 0;
  const cutText = (p: Plan) => `${round1(p.sheet.width)} × ${round1(p.sheet.height)} mm${p.cut.across * p.cut.down === 1 ? '' : `, ${p.cut.across * p.cut.down} from each`}`;
  const needW = job.width + 2 * job.bleed + 2 * job.edge;
  const needH = job.height + 2 * job.bleed + job.edge + job.gripper;

  return (
    <div class="pp-main" data-testid="pp-sheets" data-state={plan ? 'done' : 'idle'}>
      <div class="pp-stage">
        {plan ? (
          <>
            <p class="pn-summary" data-testid="ps-summary">
              Best: {plan.perSheet} to a sheet of {plan.stock.name}
              {plan.cut.across * plan.cut.down > 1 ? ` cut into ${plan.cut.across * plan.cut.down}` : ''}; buy {plan.boughtSheets.toLocaleString()} sheet{plan.boughtSheets === 1 ? '' : 's'}
              {priced ? `, ${money(plan.cost)} in paper` : ''}
            </p>
            <div class="ps-table-wrap">
              <table class="ps-plans" data-testid="ps-plans">
                <caption class="visually-hidden">Ways of printing the job, {priced ? 'cheapest' : 'least wasteful'} first</caption>
                <thead>
                  <tr>
                    <th scope="col">Paper</th>
                    <th scope="col">Press sheet</th>
                    <th scope="col" class="is-number">
                      Up
                    </th>
                    <th scope="col" class="is-number">
                      Press sheets
                    </th>
                    <th scope="col" class="is-number">
                      To buy
                    </th>
                    <th scope="col" class="is-number">
                      Waste
                    </th>
                    {priced && (
                      <th scope="col" class="is-number">
                        Paper cost
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {plans.slice(0, 12).map((p) => {
                    const key = keyOf(p);
                    return (
                      <tr key={key} class={p === plan ? 'is-chosen' : ''} data-testid="ps-plan">
                        <th scope="row">
                          <label class="ps-pick">
                            <input type="radio" name="ps-plan" checked={p === plan} onChange={() => setPicked(key)} />
                            {p.stock.name}
                          </label>
                        </th>
                        <td>{cutText(p)}</td>
                        <td class="is-number">{p.perSheet}</td>
                        <td class="is-number">{p.pressSheets.toLocaleString()}</td>
                        <td class="is-number">{p.boughtSheets.toLocaleString()}</td>
                        <td class="is-number">{Math.round(p.waste * 100)} %</td>
                        {priced && <td class="is-number">{p.stock.cost > 0 ? money(p.cost) : 'no price'}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {plans.length > 12 && <p class="control-help">The best 12 of {plans.length} ways are listed.</p>}
            {!priced && <p class="control-help">No paper has a price yet, so the list is in order of paper wasted. Enter what a sheet of each paper costs to rank by cost.</p>}
            <figure class="ps-figure">
              <PlanPicture plan={plan} job={job} />
              <figcaption data-testid="ps-caption">
                Press sheet {round1(plan.sheet.width)} × {round1(plan.sheet.height)} mm, {plan.perSheet} up
                {turnedCount > 0 && turnedCount < plan.perSheet ? ` (${plan.perSheet - turnedCount} upright, ${turnedCount} turned)` : turnedCount > 0 ? ' (all turned)' : ''}. The shaded edge is held
                by the grippers
                {plan.sheet.grain === 'none' ? '' : `; the grain runs ${plan.sheet.grain === 'height' ? 'up and down' : 'across'} the sheet as drawn`}.
              </figcaption>
            </figure>
          </>
        ) : (
          <p class="pp-empty" data-testid="ps-empty">
            {stocks.some((s) => s.use)
              ? `No paper on the list can be printed this way. The piece with its bleed and the press's margins needs a sheet of at least ${round1(Math.min(needW, needH))} × ${round1(Math.max(needW, needH))} mm, and the press takes sheets from ${press.minShort} × ${press.minLong} to ${press.maxShort} × ${press.maxLong} mm.`
              : 'Tick at least one paper to try.'}
          </p>
        )}
      </div>

      <div class="pp-side">
        <div class="pp-panel">
          <span class="pane-title">The job</span>
          <div class="control-row">
            {number('Finished width (mm)', job.width, (width) => setJob({ width }), { min: 5, max: 5000, step: 0.5 }, 'ps-width')}
            {number('Finished height (mm)', job.height, (height) => setJob({ height }), { min: 5, max: 5000, step: 0.5 }, 'ps-height')}
          </div>
          <div class="control-row">
            {number('Copies', job.quantity, (quantity) => setJob({ quantity: Math.round(quantity) }), { min: 1, max: 10_000_000 }, 'ps-quantity')}
            {number('Extra for spoils (%)', job.spoilage, (spoilage) => setJob({ spoilage }), { min: 0, max: 100 }, 'ps-spoilage')}
          </div>
          <div class="control-row">
            {number('Bleed (mm)', job.bleed, (bleed) => setJob({ bleed }), { min: 0, max: 30, step: 0.5 }, 'ps-bleed')}
            {number('Between pieces (mm)', job.gap, (gap) => setJob({ gap }), { min: 0, max: 100, step: 0.5 }, 'ps-gap')}
          </div>
          <label class="control">
            <span class="control-label">Paper grain</span>
            <select class="select" value={job.grain} onChange={(e) => setJob({ grain: e.currentTarget.value as Job['grain'] })} data-testid="ps-grain">
              <option value="any">May run either way</option>
              <option value="height">Must run along the piece’s height</option>
              <option value="width">Must run along the piece’s width</option>
            </select>
          </label>
          <label class={`check${job.grain === 'any' ? '' : ' is-off'}`}>
            <input type="checkbox" checked={job.turn} disabled={job.grain !== 'any'} onChange={(e) => setJob({ turn: e.currentTarget.checked })} data-testid="ps-turn" />
            Pieces may be turned to fit more on a sheet
          </label>
          <p class="control-help">Grain matters for anything folded or bound: a fold along the grain is clean, and a book opens well when the grain runs down its spine.</p>
        </div>

        <div class="pp-panel">
          <span class="pane-title">The press</span>
          <label class="control">
            <span class="control-label">Kind of press</span>
            <select class="select" value={settings.pressId} onChange={(e) => choosePress(e.currentTarget.value)} data-testid="ps-press">
              {PRESSES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="custom">My own limits</option>
            </select>
          </label>
          <div class="control-row">
            {number('Largest sheet, long side (mm)', press.maxLong, (maxLong) => setPress({ maxLong }), { min: 100, max: 5000 }, 'ps-max-long')}
            {number('Largest sheet, short side (mm)', press.maxShort, (maxShort) => setPress({ maxShort }), { min: 100, max: 5000 }, 'ps-max-short')}
          </div>
          <div class="control-row">
            {number('Smallest sheet, long side (mm)', press.minLong, (minLong) => setPress({ minLong }), { min: 0, max: 5000 })}
            {number('Smallest sheet, short side (mm)', press.minShort, (minShort) => setPress({ minShort }), { min: 0, max: 5000 })}
          </div>
          <div class="control-row">
            {number('Gripper edge (mm)', job.gripper, (gripper) => setJob({ gripper }), { min: 0, max: 100, step: 0.5 }, 'ps-gripper')}
            {number('Other edges (mm)', job.edge, (edge) => setJob({ edge }), { min: 0, max: 100, step: 0.5 }, 'ps-edge')}
          </div>
          <p class="control-help">The sizes are typical of each kind of press; yours has its exact limits in its manual. The grippers hold one long edge of the sheet, and nothing prints there.</p>
        </div>

        <div class="pp-panel">
          <span class="pane-title">Papers to try</span>
          <div class="ps-stock-line ps-stock-head" aria-hidden="true">
            <span>Paper</span>
            <span>Cost of a sheet</span>
          </div>
          <div class="ps-stocks" data-testid="ps-stocks">
            {stocks.map((s, i) => {
              const label = s.name.trim() || `Paper ${i + 1}`;
              return (
                <div key={s.id} class={`ps-stock${s.use ? '' : ' is-off'}`} data-testid="ps-stock">
                  <div class="ps-stock-line">
                    <input type="checkbox" checked={s.use} aria-label={`Try ${label}`} onChange={(e) => setStock(s.id, { use: e.currentTarget.checked })} />
                    <input
                      class="input ps-stock-name"
                      type="text"
                      value={s.name}
                      maxLength={60}
                      placeholder={`Paper ${i + 1}`}
                      aria-label={`Name of paper ${i + 1}`}
                      onChange={(e) => setStock(s.id, { name: e.currentTarget.value })}
                    />
                    <input
                      class="input input-number"
                      type="number"
                      min={0}
                      step={0.01}
                      value={s.cost}
                      aria-label={`Cost of one sheet of ${label}`}
                      title="Cost of one sheet"
                      onChange={(e) => setStock(s.id, { cost: clamp(Number(e.currentTarget.value) || 0, 0, 1e9) })}
                      data-testid="ps-cost"
                    />
                    <button type="button" class="icon-button" aria-label={`Remove ${label}`} onClick={() => set({ stocks: stocks.filter((other) => other.id !== s.id) })}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  <div class="ps-stock-line">
                    <input
                      class="input input-number"
                      type="number"
                      min={50}
                      max={5000}
                      step={1}
                      value={s.width}
                      aria-label={`Width of ${label} in millimetres`}
                      onChange={(e) => setStock(s.id, { width: clamp(Number(e.currentTarget.value) || 50, 50, 5000) })}
                    />
                    <span aria-hidden="true">×</span>
                    <input
                      class="input input-number"
                      type="number"
                      min={50}
                      max={5000}
                      step={1}
                      value={s.height}
                      aria-label={`Height of ${label} in millimetres`}
                      onChange={(e) => setStock(s.id, { height: clamp(Number(e.currentTarget.value) || 50, 50, 5000) })}
                    />
                    <span class="tone-muted">mm</span>
                    <select class="select" value={s.grain} aria-label={`Grain of ${label}`} onChange={(e) => setStock(s.id, { grain: e.currentTarget.value as Stock['grain'] })}>
                      <option value="long">long grain</option>
                      <option value="short">short grain</option>
                      <option value="none">no grain</option>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
          <div class="button-row">
            <button type="button" class="button button-small" onClick={() => set({ stocks: [...stocks, blankStock()].slice(0, 60) })} data-testid="ps-add">
              <Icon name="plus" size={14} /> Add a paper
            </button>
          </div>
          <p class="control-help">Costs may be in any currency. Untick a paper to leave it out for now. Long grain runs along a sheet’s long side.</p>
        </div>

        <div class="pp-panel" data-testid="ps-result">
          <span class="pane-title">The chosen way</span>
          {plan ? (
            <dl class="pp-facts">
              <div>
                <dt>Paper</dt>
                <dd>
                  {plan.stock.name}, {round1(plan.stock.width)} × {round1(plan.stock.height)} mm
                </dd>
              </div>
              <div>
                <dt>Cutting before printing</dt>
                <dd data-testid="ps-cut">{plan.cut.across * plan.cut.down === 1 ? 'none: printed as bought' : `each sheet into ${plan.cut.across} × ${plan.cut.down}`}</dd>
              </div>
              <div>
                <dt>Pieces to a press sheet</dt>
                <dd data-testid="ps-up">{plan.perSheet}</dd>
              </div>
              <div>
                <dt>Press sheets, spoils included</dt>
                <dd data-testid="ps-press-sheets">{plan.pressSheets.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Sheets to buy</dt>
                <dd data-testid="ps-buy">{plan.boughtSheets.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Paper that ends up as waste</dt>
                <dd>{Math.round(plan.waste * 100)} %</dd>
              </div>
              {plan.stock.cost > 0 && (
                <div>
                  <dt>Paper cost, and for each copy</dt>
                  <dd data-testid="ps-cost-total">
                    {money(plan.cost)}, {(plan.cost / job.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p class="tone-muted">Nothing yet.</p>
          )}
          <div class="button-row">
            <button type="button" class="button button-small" onClick={chooseArt} data-testid="ps-art">
              <Icon name="file" size={14} /> {art ? 'Change the artwork' : 'Artwork (a PDF of the piece)'}
            </button>
            {art && (
              <button type="button" class="button button-small button-quiet" onClick={() => setArt(null)}>
                Remove it
              </button>
            )}
          </div>
          {art && fit && (
            <p class={fit.ok ? 'control-help' : 'pp-warning'} data-testid="ps-art-note">
              {!fit.ok && <Icon name="alert" size={15} />}
              <span>
                {fit.ok
                  ? `${art.name}: page 1 goes on every piece${art.pages > 1 ? ', and page 2 on a second sheet for the back' : ''}${
                      fit.keep < job.bleed - 0.05 ? `. It has ${round1(fit.keep)} mm of bleed, less than the ${round1(job.bleed)} mm the job asks for.` : '.'
                    }`
                  : `${art.name} is not placed. ${fit.why}`}
              </span>
            </p>
          )}
          <div class="button-row">
            <button type="button" class="button button-small button-primary" disabled={!plan || busy} onClick={savePdf} data-testid="ps-save">
              <Icon name="save" size={14} /> PDF of the press sheet
            </button>
          </div>
          <p class="control-help">
            Without artwork the PDF shows each piece’s trim and bleed, for a cutting guide. With a two-page PDF the back is laid out for turning the sheet over about its gripper edge.
          </p>
        </div>
      </div>
    </div>
  );
}
