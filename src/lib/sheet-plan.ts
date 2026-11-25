/**
 * Planning a print job on sheets: how many copies of a piece fit on a press
 * sheet (upright, turned, or a block of each), and which paper to buy and how
 * to cut it so that the job costs least.  Sizes are in millimetres.
 */

export interface Block {
  /** From the top left corner of the printable area. */
  readonly x: number;
  readonly y: number;
  readonly cols: number;
  readonly rows: number;
  /** One piece as it lies in this block, bleed included. */
  readonly width: number;
  readonly height: number;
  readonly turned: boolean;
}

export interface Layout {
  readonly count: number;
  readonly blocks: readonly Block[];
  readonly usedWidth: number;
  readonly usedHeight: number;
}

export type Turning = 'free' | 'upright' | 'turned';

const howMany = (space: number, size: number, gap: number) => (size > 0 && space + 1e-9 >= size ? Math.floor((space + gap + 1e-9) / (size + gap)) : 0);
const span = (count: number, size: number, gap: number) => (count > 0 ? count * size + (count - 1) * gap : 0);

/**
 * The most pieces of one size on an area: a grid of upright pieces, a grid of turned ones,
 * or a main grid with the strip left beside or below it filled the other way (which a
 * guillotine can still cut: one cut parts the two blocks).
 */
export function bestLayout(areaWidth: number, areaHeight: number, width: number, height: number, gap: number, turning: Turning = 'free'): Layout {
  const none: Layout = { count: 0, blocks: [], usedWidth: 0, usedHeight: 0 };
  if (!(areaWidth > 0 && areaHeight > 0 && width > 0 && height > 0)) return none;
  const grid = (x: number, y: number, w: number, h: number, pw: number, ph: number, turned: boolean): Block | null => {
    const cols = howMany(w, pw, gap);
    const rows = howMany(h, ph, gap);
    return cols > 0 && rows > 0 ? { x, y, cols, rows, width: pw, height: ph, turned } : null;
  };
  const candidates: Block[][] = [];
  const kinds: { pw: number; ph: number; turned: boolean }[] = [];
  if (turning !== 'turned') kinds.push({ pw: width, ph: height, turned: false });
  if (turning !== 'upright' && Math.abs(width - height) > 1e-9) kinds.push({ pw: height, ph: width, turned: true });
  else if (turning === 'turned') kinds.push({ pw: height, ph: width, turned: true });
  for (const main of kinds) {
    const whole = grid(0, 0, areaWidth, areaHeight, main.pw, main.ph, main.turned);
    if (!whole) continue;
    candidates.push([whole]);
    if (turning !== 'free') continue;
    const other = { pw: main.ph, ph: main.pw, turned: !main.turned };
    // The main grid with fewer columns, and the strip to its right filled the other way.
    for (let cols = whole.cols; cols >= 1; cols--) {
      const used = span(cols, main.pw, gap) + gap;
      const strip = grid(used, 0, areaWidth - used, areaHeight, other.pw, other.ph, other.turned);
      if (strip) candidates.push([{ ...whole, cols }, strip]);
    }
    // The main grid with fewer rows, and the strip below it filled the other way.
    for (let rows = whole.rows; rows >= 1; rows--) {
      const used = span(rows, main.ph, gap) + gap;
      const strip = grid(0, used, areaWidth, areaHeight - used, other.pw, other.ph, other.turned);
      if (strip) candidates.push([{ ...whole, rows }, strip]);
    }
  }
  let best = none;
  for (const blocks of candidates) {
    const count = blocks.reduce((sum, b) => sum + b.cols * b.rows, 0);
    const usedWidth = Math.max(...blocks.map((b) => b.x + span(b.cols, b.width, gap)));
    const usedHeight = Math.max(...blocks.map((b) => b.y + span(b.rows, b.height, gap)));
    // More pieces wins; then the simpler cut (one block); then the smaller footprint.
    const better =
      count > best.count ||
      (count === best.count && count > 0 && (blocks.length < best.blocks.length || (blocks.length === best.blocks.length && usedWidth * usedHeight < best.usedWidth * best.usedHeight - 1e-6)));
    if (better) best = { count, blocks, usedWidth, usedHeight };
  }
  return best;
}

/** Where every piece of a layout lies: its top left corner within the area, and whether it is turned. */
export function piecesOf(layout: Layout, gap: number): { x: number; y: number; width: number; height: number; turned: boolean }[] {
  const out: { x: number; y: number; width: number; height: number; turned: boolean }[] = [];
  for (const block of layout.blocks) {
    for (let row = 0; row < block.rows; row++) {
      for (let col = 0; col < block.cols; col++)
        out.push({ x: block.x + col * (block.width + gap), y: block.y + row * (block.height + gap), width: block.width, height: block.height, turned: block.turned });
    }
  }
  return out;
}

export interface Stock {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Long grain runs along the sheet's long side; short grain across it. */
  readonly grain: 'long' | 'short' | 'none';
  /** What one sheet costs, in any currency. */
  readonly cost: number;
}

export interface Job {
  /** The finished (trimmed) piece. */
  readonly width: number;
  readonly height: number;
  readonly bleed: number;
  /** Space between neighbouring pieces, beyond their bleed. */
  readonly gap: number;
  readonly quantity: number;
  /** Extra sheets for setting up and for spoils, in per cent. */
  readonly spoilage: number;
  /** The strip along one long edge of the press sheet that the grippers hold and nothing prints on. */
  readonly gripper: number;
  /** Clear space at the other three edges. */
  readonly edge: number;
  readonly turn: boolean;
  /** The paper's grain must run along the piece's height or width (books, cards that fold), or may run either way. */
  readonly grain: 'any' | 'height' | 'width';
}

export interface Press {
  /** The largest sheet the press takes, long side by short side. */
  readonly maxLong: number;
  readonly maxShort: number;
  readonly minLong: number;
  readonly minShort: number;
}

export interface Plan {
  readonly stock: Stock;
  /** The bought sheet is cut into this many press sheets across its width and down its height. */
  readonly cut: { readonly across: number; readonly down: number };
  readonly sheet: { readonly width: number; readonly height: number; readonly grain: 'width' | 'height' | 'none' };
  /** The printable area's top left corner on the press sheet, and its size. */
  readonly area: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly layout: Layout;
  readonly perSheet: number;
  readonly pressSheets: number;
  readonly boughtSheets: number;
  /** The share of the bought paper that does not end up as finished pieces, 0 to 1. */
  readonly waste: number;
  readonly cost: number;
}

/**
 * Every way of printing the job on the papers on offer that the press can take, cheapest first
 * (and of two that cost the same, the one that wastes less paper).  Papers without a price come last.
 */
export function planJob(job: Job, stocks: readonly Stock[], press: Press): Plan[] {
  const plans: Plan[] = [];
  const quantity = Math.max(0, Math.floor(job.quantity));
  if (!(job.width > 0 && job.height > 0) || quantity === 0) return plans;
  for (const stock of stocks) {
    if (!(stock.width > 0 && stock.height > 0)) continue;
    // The grain's direction on the bought sheet, which its cut pieces keep.
    const long = stock.width >= stock.height ? 'width' : 'height';
    const grain = stock.grain === 'none' ? 'none' : stock.grain === 'long' ? long : long === 'width' ? 'height' : 'width';
    for (let across = 1; across <= 4; across++) {
      for (let down = 1; down <= 4; down++) {
        const width = stock.width / across;
        const height = stock.height / down;
        const longSide = Math.max(width, height);
        const shortSide = Math.min(width, height);
        if (longSide > press.maxLong + 1e-6 || shortSide > press.maxShort + 1e-6 || longSide < press.minLong - 1e-6 || shortSide < press.minShort - 1e-6) continue;
        // The grippers take a long edge: the bottom of a wide sheet, the left of a tall one.
        const wide = width >= height;
        const area = wide
          ? { x: job.edge, y: job.edge, width: width - 2 * job.edge, height: height - job.edge - job.gripper }
          : { x: job.gripper, y: job.edge, width: width - job.edge - job.gripper, height: height - 2 * job.edge };
        let turning: Turning = job.turn ? 'free' : 'upright';
        if (job.grain !== 'any' && grain !== 'none') turning = (job.grain === 'height') === (grain === 'height') ? 'upright' : 'turned';
        const layout = bestLayout(area.width, area.height, job.width + 2 * job.bleed, job.height + 2 * job.bleed, job.gap, turning);
        if (layout.count === 0) continue;
        const pressSheets = Math.ceil(Math.ceil(quantity / layout.count) * (1 + Math.max(0, job.spoilage) / 100));
        const boughtSheets = Math.ceil(pressSheets / (across * down));
        plans.push({
          stock,
          cut: { across, down },
          sheet: { width, height, grain },
          area,
          layout,
          perSheet: layout.count,
          pressSheets,
          boughtSheets,
          waste: 1 - (quantity * job.width * job.height) / (boughtSheets * stock.width * stock.height),
          cost: boughtSheets * stock.cost,
        });
      }
    }
  }
  // A paper with no price is not a free one: those come after the papers whose cost is known.
  const unpriced = (plan: Plan) => (plan.stock.cost > 0 ? 0 : 1);
  return plans.sort((a, b) => unpriced(a) - unpriced(b) || a.cost - b.cost || a.waste - b.waste || a.pressSheets - b.pressSheets);
}

/**
 * The plans worth looking at: a way of cutting a paper is left out when another way of cutting
 * the same paper needs no more sheets bought and no more sheets through the press.
 */
export function withoutWorse(plans: readonly Plan[]): Plan[] {
  return plans.filter(
    (p, i) =>
      !plans.some(
        (q, j) =>
          j !== i && q.stock.id === p.stock.id && q.boughtSheets <= p.boughtSheets && q.pressSheets <= p.pressSheets && (q.boughtSheets < p.boughtSheets || q.pressSheets < p.pressSheets || j < i),
      ),
  );
}

/** Papers a small print shop is likely to stock, as a start for the list (costs are for the user to fill in). */
export const STOCKS: readonly Omit<Stock, 'cost'>[] = [
  { id: 'sra3', name: 'SRA3', width: 320, height: 450, grain: 'long' },
  { id: 'sra2', name: 'SRA2', width: 450, height: 640, grain: 'long' },
  { id: 'sra1', name: 'SRA1', width: 640, height: 900, grain: 'long' },
  { id: 'b2', name: 'B2', width: 500, height: 707, grain: 'long' },
  { id: 'b1', name: 'B1', width: 707, height: 1000, grain: 'long' },
  { id: '23x36', name: '23 × 36 in', width: 584, height: 914, grain: 'long' },
  { id: '25x36', name: '25 × 36 in', width: 635, height: 914, grain: 'long' },
  { id: '20x30', name: '20 × 30 in', width: 508, height: 762, grain: 'long' },
  { id: '13x19', name: '13 × 19 in', width: 330, height: 483, grain: 'long' },
];
