import { describe, expect, it } from 'vitest';
import { discSpans, encodeBmp, flip, floodFill, hexToRgba, invert, linePixels, PALETTE, type Pixels, rgbaToHex, rotate } from '../../src/lib/paint';

/** A picture from rows of characters, each a colour. */
const picture = (rows: string[], colours: Record<string, [number, number, number, number]>): Pixels => {
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      data.set(colours[ch] ?? [0, 0, 0, 255], (y * width + x) * 4);
    });
  });
  return { width, height: rows.length, data };
};
const W: [number, number, number, number] = [255, 255, 255, 255];
const K: [number, number, number, number] = [0, 0, 0, 255];
const R: [number, number, number, number] = [255, 0, 0, 255];
const G: [number, number, number, number] = [250, 250, 250, 255];
const at = (p: Pixels, x: number, y: number) => Array.from(p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4));

describe('paint', () => {
  it('fills the enclosed area only, and with a tolerance, near colours too', () => {
    const rows = ['.....', '.###.', '.#.#.', '.###.', '.....'];
    const p = picture(rows, { '.': W, '#': K });
    expect(floodFill(p, 2, 2, R)).toBe(1);
    expect(at(p, 2, 2)).toEqual(R);
    expect(at(p, 0, 0)).toEqual(W);
    expect(floodFill(p, 0, 0, R)).toBe(16);
    expect(at(p, 1, 1)).toEqual(K);
    // Filling with the colour already there does nothing.
    expect(floodFill(p, 0, 0, R)).toBe(0);
    const near = picture(['..,,', '..,,'], { '.': W, ',': G });
    expect(floodFill({ ...near, data: new Uint8ClampedArray(near.data) }, 0, 0, R, 0)).toBe(4);
    expect(floodFill(near, 0, 0, R, 8)).toBe(8);
    // A large open area (no recursion limits).
    const big = { width: 600, height: 600, data: new Uint8ClampedArray(600 * 600 * 4) };
    expect(floodFill(big, 300, 300, R)).toBe(360000);
  });

  it('draws aliased lines and round brushes', () => {
    const points: [number, number][] = [];
    linePixels(0, 0, 4, 2, (x, y) => points.push([x, y]));
    // One pixel a column, each touching the last, from end to end.
    expect(points.map(([x]) => x)).toEqual([0, 1, 2, 3, 4]);
    expect(points[0]).toEqual([0, 0]);
    expect(points.at(-1)).toEqual([4, 2]);
    for (let i = 1; i < points.length; i++) expect(Math.abs((points[i]?.[1] ?? 0) - (points[i - 1]?.[1] ?? 0))).toBeLessThanOrEqual(1);
    const back: string[] = [];
    linePixels(4, 2, 0, 0, (x, y) => back.push(`${x},${y}`));
    expect(back).toHaveLength(5);
    expect(discSpans(1)).toEqual([[0, 0, 0]]);
    expect(discSpans(2)).toEqual([
      [-1, 0, -1],
      [-1, 0, 0],
    ]);
    const five = discSpans(5);
    expect(five).toHaveLength(5);
    expect(five[0]).toEqual([-1, 1, -2]);
    expect(five[2]).toEqual([-2, 2, 0]);
  });

  it('rotates, flips and inverts', () => {
    const p = picture(['ab', 'cd', 'ef'], { a: [1, 0, 0, 255], b: [2, 0, 0, 255], c: [3, 0, 0, 255], d: [4, 0, 0, 255], e: [5, 0, 0, 255], f: [6, 0, 0, 255] });
    const name = (q: Pixels) => Array.from({ length: q.height }, (_, y) => Array.from({ length: q.width }, (_, x) => 'abcdef'[(at(q, x, y)[0] as number) - 1]).join('')).join('/');
    expect(name(rotate(p, 1))).toBe('eca/fdb');
    expect(name(rotate(p, 2))).toBe('fe/dc/ba');
    expect(name(rotate(p, -1))).toBe('bdf/ace');
    expect(name(rotate(rotate(p, 1), 3))).toBe('ab/cd/ef');
    expect(name(flip(p, true))).toBe('ba/dc/fe');
    expect(name(flip(p, false))).toBe('ef/cd/ab');
    expect(at(invert(picture(['.'], { '.': [10, 20, 30, 128] })), 0, 0)).toEqual([245, 235, 225, 128]);
  });

  it('writes 24-bit BMP files, bottom row first, rows padded to four bytes', () => {
    const p = picture(['rk', 'kw'], { r: R, k: K, w: [255, 255, 255, 0] });
    const bmp = encodeBmp(p);
    const view = new DataView(bmp.buffer);
    expect(String.fromCharCode(bmp[0] as number, bmp[1] as number)).toBe('BM');
    expect(view.getUint32(2, true)).toBe(54 + 8 * 2);
    expect(view.getInt32(18, true)).toBe(2);
    expect(view.getUint16(28, true)).toBe(24);
    // Bottom row (k, transparent → white) comes first, in BGR.
    expect(Array.from(bmp.subarray(54, 60))).toEqual([0, 0, 0, 255, 255, 255]);
    expect(Array.from(bmp.subarray(62, 68))).toEqual([0, 0, 255, 0, 0, 0]);
  });

  it('keeps the classic palette and converts colours', () => {
    expect(PALETTE).toHaveLength(28);
    expect(hexToRgba('#ff8040')).toEqual([255, 128, 64, 255]);
    expect(rgbaToHex(255, 128, 64)).toBe('#ff8040');
  });
});
