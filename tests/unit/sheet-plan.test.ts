import { describe, expect, it } from 'vitest';
import { bestLayout, type Job, type Press, piecesOf, planJob, type Stock, withoutWorse } from '../../src/lib/sheet-plan';

const noOverlap = (pieces: ReturnType<typeof piecesOf>, gap: number, w: number, h: number) => {
  for (const p of pieces) {
    expect(p.x).toBeGreaterThanOrEqual(-1e-6);
    expect(p.y).toBeGreaterThanOrEqual(-1e-6);
    expect(p.x + p.width).toBeLessThanOrEqual(w + 1e-6);
    expect(p.y + p.height).toBeLessThanOrEqual(h + 1e-6);
  }
  for (const [i, a] of pieces.entries())
    for (const b of pieces.slice(i + 1))
      expect(a.x + a.width + gap <= b.x + 1e-6 || b.x + b.width + gap <= a.x + 1e-6 || a.y + a.height + gap <= b.y + 1e-6 || b.y + b.height + gap <= a.y + 1e-6).toBe(true);
};

describe('pieces on a sheet', () => {
  it('counts a plain grid, upright or turned, whichever holds more', () => {
    // Business cards on the printable area of an SRA3 sheet.
    expect(bestLayout(310, 440, 90, 55, 0)).toMatchObject({ count: 24, blocks: [{ cols: 3, rows: 8, turned: false }] });
    expect(bestLayout(310, 440, 90, 55, 0, 'turned')).toMatchObject({ count: 20, blocks: [{ cols: 5, rows: 4, turned: true, width: 55, height: 90 }] });
    // A4 on SRA3: two, turned.
    expect(bestLayout(310, 440, 210, 297, 0)).toMatchObject({ count: 2, blocks: [{ cols: 1, rows: 2, turned: true }] });
    expect(bestLayout(310, 440, 210, 297, 0, 'upright')).toMatchObject({ count: 1 });
  });

  it('fills the strip beside a grid the other way when that holds more', () => {
    // Upright gives 3 × 6 = 18; five rows upright and a row of four turned below gives 19.
    const mixed = bestLayout(320, 450, 100, 70, 0);
    expect(mixed.count).toBe(19);
    expect(mixed.blocks).toHaveLength(2);
    expect(mixed.blocks[0]).toMatchObject({ cols: 3, rows: 5, turned: false });
    expect(mixed.blocks[1]).toMatchObject({ x: 0, y: 350, cols: 4, rows: 1, turned: true, width: 70, height: 100 });
    const pieces = piecesOf(mixed, 0);
    expect(pieces).toHaveLength(19);
    noOverlap(pieces, 0, 320, 450);
    expect(bestLayout(320, 450, 100, 70, 0, 'upright').count).toBe(18);
  });

  it('keeps the gap between pieces, and between the two blocks', () => {
    const layout = bestLayout(300, 420, 95, 60, 5);
    // Columns: (300 + 5) / 100 = 3; rows: (420 + 5) / 65 = 6.
    expect(layout.count).toBeGreaterThanOrEqual(18);
    noOverlap(piecesOf(layout, 5), 5, 300, 420);
    expect(layout.usedWidth).toBeLessThanOrEqual(300);
    expect(layout.usedHeight).toBeLessThanOrEqual(420);
    // An exact fit counts, and a hair too large does not.
    expect(bestLayout(200, 100, 100, 100, 0).count).toBe(2);
    expect(bestLayout(199.9, 100, 100, 100, 0).count).toBe(1);
    expect(bestLayout(100, 100, 120, 80, 0)).toMatchObject({ count: 0, blocks: [] });
    expect(bestLayout(0, 100, 10, 10, 0).count).toBe(0);
    // A square has no "turned".
    expect(bestLayout(100, 100, 50, 50, 0).blocks).toHaveLength(1);
  });
});

describe('planning a job', () => {
  const job: Job = { width: 148, height: 210, bleed: 3, gap: 0, quantity: 5000, spoilage: 5, gripper: 10, edge: 5, turn: true, grain: 'any' };
  const press: Press = { maxLong: 720, maxShort: 520, minLong: 297, minShort: 210 };
  const stocks: Stock[] = [
    { id: 'sra3', name: 'SRA3', width: 320, height: 450, grain: 'long', cost: 6 },
    { id: 'sra1', name: 'SRA1', width: 640, height: 900, grain: 'long', cost: 20 },
    { id: 'huge', name: 'Too large for anything', width: 3000, height: 4000, grain: 'none', cost: 1 },
  ];

  it('finds the cheapest paper and cut, and says how much is wasted', () => {
    const plans = planJob(job, stocks, press);
    expect(plans.length).toBeGreaterThan(2);
    // Nothing the press cannot take: a whole SRA1 is too long, and the huge sheet fits no cut.
    for (const plan of plans) {
      expect(Math.max(plan.sheet.width, plan.sheet.height)).toBeLessThanOrEqual(720);
      expect(Math.min(plan.sheet.width, plan.sheet.height)).toBeLessThanOrEqual(520);
      expect(plan.stock.id).not.toBe('huge');
      expect(plan.cost).toBe(plan.boughtSheets * plan.stock.cost);
      expect(plan.waste).toBeGreaterThan(0);
      expect(plan.waste).toBeLessThan(1);
    }
    for (let i = 1; i < plans.length; i++) expect((plans[i] as (typeof plans)[0]).cost).toBeGreaterThanOrEqual((plans[i - 1] as (typeof plans)[0]).cost);
    // A5 with bleed is 154 × 216: SRA3 takes two, one above the other beside the gripper strip.
    const sra3 = plans.find((plan) => plan.stock.id === 'sra3' && plan.cut.across === 1 && plan.cut.down === 1);
    expect(sra3).toMatchObject({ perSheet: 2, pressSheets: 2625, boughtSheets: 2625, cost: 15750 });
    expect(sra3?.area).toEqual({ x: 10, y: 5, width: 305, height: 440 });
    // SRA1 cut in two (640 × 450) takes eight a press sheet: fewer sheets to buy.
    const half = plans.find((plan) => plan.stock.id === 'sra1' && plan.cut.across === 1 && plan.cut.down === 2);
    expect(half).toMatchObject({ perSheet: 8, pressSheets: 657, boughtSheets: 329, cost: 6580 });
    expect(half?.sheet).toEqual({ width: 640, height: 450, grain: 'height' });
    expect(plans[0]?.cost).toBeLessThanOrEqual(6580);
    expect(half?.waste).toBeCloseTo(1 - (5000 * 148 * 210) / (329 * 640 * 900), 6);
  });

  it('keeps the grain along the piece when asked to', () => {
    // SRA3 long grain: the grain runs along its 450 mm height.  A piece whose height must follow the grain stands upright.
    const along = planJob({ ...job, grain: 'height' }, [stocks[0] as Stock], press).find((plan) => plan.cut.across === 1 && plan.cut.down === 1);
    expect(along?.layout.blocks.every((block) => !block.turned)).toBe(true);
    expect(along?.perSheet).toBe(2);
    // Across the grain it must lie turned.
    const across = planJob({ ...job, grain: 'width' }, [stocks[0] as Stock], press).find((plan) => plan.cut.across === 1 && plan.cut.down === 1);
    expect(across?.layout.blocks.every((block) => block.turned)).toBe(true);
    expect(across?.perSheet).toBe(2);
    // Paper with no grain leaves the choice free.
    expect(planJob({ ...job, grain: 'height' }, [{ ...(stocks[0] as Stock), grain: 'none' }], press)[0]?.perSheet).toBe(2);
  });

  it('ranks papers without a price after the priced ones, and leaves out ways no one would choose', () => {
    const mixed = planJob(job, [{ ...(stocks[0] as Stock), cost: 0 }, stocks[1] as Stock], press);
    // SRA3 has no price: it is not treated as free.
    expect(mixed[0]?.stock.id).toBe('sra1');
    const firstUnpriced = mixed.findIndex((plan) => plan.stock.cost === 0);
    expect(firstUnpriced).toBeGreaterThan(0);
    expect(mixed.slice(firstUnpriced).every((plan) => plan.stock.cost === 0)).toBe(true);
    // Of the ways of cutting one paper, those that need more sheets bought and more through the press than another are dropped.
    const all = planJob(job, stocks, press);
    const kept = withoutWorse(all);
    expect(kept.length).toBeLessThan(all.length);
    expect(kept[0]).toBe(all[0]);
    for (const plan of all) {
      const better = all.some(
        (other) =>
          other !== plan &&
          other.stock.id === plan.stock.id &&
          other.boughtSheets <= plan.boughtSheets &&
          other.pressSheets <= plan.pressSheets &&
          (other.boughtSheets < plan.boughtSheets || other.pressSheets < plan.pressSheets),
      );
      if (better) expect(kept).not.toContain(plan);
    }
    for (const id of ['sra3', 'sra1']) expect(kept.some((plan) => plan.stock.id === id)).toBe(true);
  });

  it('returns nothing when there is nothing to plan', () => {
    expect(planJob({ ...job, quantity: 0 }, stocks, press)).toEqual([]);
    expect(planJob({ ...job, width: 2000 }, stocks, press)).toEqual([]);
    expect(planJob(job, [], press)).toEqual([]);
  });
});
