import { describe, expect, it } from 'vitest';
import { cutList, type NestOptions, nest, type Piece, type Placement } from '../../src/lib/nesting';

/** Every piece inside the margins, and no two closer than the gap. */
function checkLayout(placements: readonly Placement[], options: NestOptions) {
  for (const p of placements) {
    expect(p.x).toBeGreaterThanOrEqual(options.margin - 1e-6);
    expect(p.y).toBeGreaterThanOrEqual(options.margin - 1e-6);
    expect(p.x + p.width).toBeLessThanOrEqual(options.sheetWidth - options.margin + 1e-6);
    if (options.sheetHeight > 0) expect(p.y + p.height).toBeLessThanOrEqual(options.sheetHeight - options.margin + 1e-6);
  }
  for (const [i, a] of placements.entries()) {
    for (const b of placements.slice(i + 1)) {
      if (a.sheet !== b.sheet) continue;
      const apart = a.x + a.width + options.gap <= b.x + 1e-6 || b.x + b.width + options.gap <= a.x + 1e-6 || a.y + a.height + options.gap <= b.y + 1e-6 || b.y + b.height + options.gap <= a.y + 1e-6;
      expect(apart, `${a.id}#${a.copy} and ${b.id}#${b.copy} on sheet ${a.sheet}`).toBe(true);
    }
  }
}

describe('nesting', () => {
  it('fills a sheet exactly when the pieces allow it', () => {
    const pieces: Piece[] = [
      { id: 'a', width: 100, height: 50, quantity: 4, rotate: false },
      { id: 'b', width: 50, height: 50, quantity: 8, rotate: false },
    ];
    const options = { sheetWidth: 200, sheetHeight: 200, margin: 0, gap: 0 };
    const result = nest(pieces, options);
    expect(result.sheets).toBe(1);
    expect(result.placements).toHaveLength(12);
    expect(result.coverage).toBeCloseTo(1);
    expect(result.leftOut).toEqual([]);
    checkLayout(result.placements, options);
  });

  it('keeps margins and gaps, turns pieces that may be turned, and opens a new sheet when one is full', () => {
    const pieces: Piece[] = [
      { id: 'card', width: 90, height: 55, quantity: 24, rotate: true },
      { id: 'flyer', width: 148, height: 210, quantity: 3, rotate: true },
      { id: 'label', width: 60, height: 40, quantity: 10, rotate: false },
    ];
    const options = { sheetWidth: 320, sheetHeight: 450, margin: 10, gap: 4 };
    const result = nest(pieces, options);
    expect(result.placements).toHaveLength(37);
    expect(result.leftOut).toEqual([]);
    checkLayout(result.placements, options);
    // 37 pieces need 235 000 mm² in all; a sheet's usable area is 300 × 430 = 129 000 mm².
    expect(result.sheets).toBeGreaterThanOrEqual(2);
    expect(result.sheets).toBeLessThanOrEqual(3);
    expect(result.placements.some((p) => p.rotated)).toBe(true);
    // A label may not be turned: it keeps its width.
    for (const p of result.placements.filter((placed) => placed.id === 'label')) expect([p.width, p.height, p.rotated]).toEqual([60, 40, false]);
    // A turned piece has its sides swapped.
    for (const p of result.placements.filter((placed) => placed.rotated && placed.id === 'card')) expect([p.width, p.height]).toEqual([55, 90]);
    // Every copy is placed once.
    expect(new Set(result.placements.map((p) => `${p.id}#${p.copy}`)).size).toBe(37);
    expect(result.coverage).toBeGreaterThan(0.5);
  });

  it('lays pieces along a roll and reports the length used', () => {
    const pieces: Piece[] = [
      { id: 'banner', width: 600, height: 1500, quantity: 2, rotate: false },
      { id: 'sign', width: 300, height: 400, quantity: 6, rotate: true },
    ];
    const options = { sheetWidth: 1300, sheetHeight: 0, margin: 10, gap: 10 };
    const result = nest(pieces, options);
    expect(result.sheets).toBe(1);
    expect(result.placements).toHaveLength(8);
    checkLayout(result.placements, options);
    // The two banners side by side set the length; the signs must not make it much longer.
    expect(result.usedHeight).toBeGreaterThanOrEqual(1520);
    expect(result.usedHeight).toBeLessThanOrEqual(2400);
    expect(result.coverage).toBeGreaterThan(0.75);
  });

  it('says what fits on no sheet, and copes with nothing to place', () => {
    const result = nest(
      [
        { id: 'poster', width: 700, height: 1000, quantity: 2, rotate: true },
        { id: 'card', width: 90, height: 55, quantity: 1, rotate: false },
        { id: 'none', width: 10, height: 10, quantity: 0, rotate: false },
        { id: 'bad', width: 0, height: 10, quantity: 3, rotate: false },
      ],
      { sheetWidth: 320, sheetHeight: 450, margin: 5, gap: 0 },
    );
    expect(result.leftOut).toEqual([{ id: 'poster', copies: 2 }]);
    expect(result.placements.map((p) => p.id)).toEqual(['card']);
    expect(nest([], { sheetWidth: 320, sheetHeight: 450, margin: 5, gap: 0 })).toEqual({ placements: [], sheets: 0, leftOut: [], usedHeight: 0, coverage: 0 });
    // A piece that only fits turned is turned.
    const turned = nest([{ id: 'strip', width: 400, height: 100, quantity: 1, rotate: true }], { sheetWidth: 200, sheetHeight: 500, margin: 0, gap: 0 });
    expect(turned.placements[0]).toMatchObject({ rotated: true, width: 100, height: 400 });
  });

  it('writes a cutting list', () => {
    const list = cutList(
      [
        { id: 'a', copy: 0, sheet: 0, x: 10, y: 10.004, width: 90, height: 55, rotated: false },
        { id: 'b', copy: 1, sheet: 1, x: 104.5, y: 10, width: 55, height: 90, rotated: true },
      ],
      { a: 'Business card', b: '=cmd, "label"' },
    );
    expect(list.split('\r\n')).toEqual(['Sheet,Piece,Copy,X (mm),Y (mm),Width (mm),Height (mm),Turned', '1,Business card,1,10,10,90,55,no', '2,"\'=cmd, ""label""",2,104.5,10,55,90,yes', '']);
  });
});
