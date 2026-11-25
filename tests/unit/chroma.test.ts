import { describe, expect, it } from 'vitest';
import { alphaMap, chromaOf, despill, type Frame, ffmpegKey, fitRect, guessKey, hexOf, keyFrame, matteFrame, rgbOf, sourceColour, spillType, subjectRect } from '../../src/lib/chroma';

const GREEN = [0, 177, 64] as const;

/** A picture from rows of colour names. */
function picture(rows: string[], colours: Record<string, readonly [number, number, number]>): Frame {
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((row, y) => {
    [...row].forEach((name, x) => {
      const [r, g, b] = colours[name] ?? [0, 0, 0];
      data.set([r, g, b, 255], (y * width + x) * 4);
    });
  });
  return { data, width, height: rows.length };
}

const COLOURS = { g: GREEN, r: [200, 30, 30], s: [224, 172, 140], w: [255, 255, 255] } as const;

describe('green-screen keying', () => {
  it('makes the backdrop see-through and keeps the subject', () => {
    const frame = picture(['ggggggg', 'ggggggg', 'ggrrrgg', 'ggrrrgg', 'ggrrrgg', 'ggggggg', 'ggggggg'], COLOURS);
    const alpha = alphaMap(frame, { key: GREEN, similarity: 0.15, blend: 0, spill: 0 });
    const at = (x: number, y: number) => alpha[y * 7 + x];
    expect(at(0, 0)).toBe(0);
    expect(at(6, 6)).toBe(0);
    expect(at(3, 3)).toBe(255);
    // A hard edge: every pixel is either gone or kept.
    expect(new Set(alpha)).toEqual(new Set([0, 255]));
    // With a soft edge, the rim of the subject is partly see-through and its middle is solid.
    const soft = alphaMap(frame, { key: GREEN, similarity: 0.1, blend: 0.3, spill: 0 });
    expect(soft[3 * 7 + 3]).toBe(255);
    expect(soft[2 * 7 + 2]).toBeGreaterThan(0);
    expect(soft[2 * 7 + 2]).toBeLessThan(255);
    expect(soft[0]).toBe(0);
  });

  it('treats the edge of the picture like the rest of it', () => {
    const frame = picture(['rrr', 'rrr'], COLOURS);
    expect([...alphaMap(frame, { key: GREEN, similarity: 0.3, blend: 0, spill: 0 })]).toEqual([255, 255, 255, 255, 255, 255]);
    expect([...alphaMap(picture(['ggg', 'ggg'], COLOURS), { key: GREEN, similarity: 0.01, blend: 0.1, spill: 0 })]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('measures colour, not brightness: a darker or lighter green is still backdrop', () => {
    const [b1, r1] = chromaOf(0, 177, 64);
    expect(b1).toBeCloseTo(-26.6, 1);
    expect(r1).toBeCloseTo(-79.3, 1);
    const shades = picture(['abc'], { a: [0, 140, 50], b: GREEN, c: [40, 215, 100] });
    expect([...alphaMap(shades, { key: GREEN, similarity: 0.12, blend: 0, spill: 0 })]).toEqual([0, 0, 0]);
    // White, skin and red are far from green whatever the matrix.
    for (const matrix of ['bt601', 'bt709'] as const) expect([...alphaMap(picture(['wsr'], COLOURS), { key: GREEN, similarity: 0.12, blend: 0, spill: 0 }, matrix)]).toEqual([255, 255, 255]);
  });

  it('takes the green tint off the subject and leaves other colours alone', () => {
    const data = new Uint8ClampedArray([200, 240, 180, 255, 200, 30, 30, 255, 60, 60, 200, 255]);
    despill(data, 'green', 1);
    // Green comes down to the mean of red and blue; nothing else moves.
    expect([...data]).toEqual([200, 190, 180, 255, 200, 30, 30, 255, 60, 60, 200, 255]);
    const half = new Uint8ClampedArray([200, 240, 180, 255]);
    despill(half, 'green', 0.5);
    expect(half[1]).toBe(215);
    const blue = new Uint8ClampedArray([100, 110, 220, 255]);
    despill(blue, 'blue', 1);
    expect([...blue]).toEqual([100, 110, 105, 255]);
    expect(spillType(GREEN)).toBe('green');
    expect(spillType([0, 71, 187])).toBe('blue');
  });

  it('gives the keyed picture and its matte', () => {
    const frame = picture(['gs'], COLOURS);
    frame.data[7] = 128;
    const keyed = keyFrame(frame, { key: GREEN, similarity: 0.12, blend: 0, spill: 0 });
    // The backdrop is gone; a subject that was half see-through stays half see-through.
    expect([keyed[3], keyed[7]]).toEqual([0, 128]);
    expect([...keyed.slice(4, 7)]).toEqual([224, 172, 140]);
    expect([...matteFrame(frame, { key: GREEN, similarity: 0.12, blend: 0, spill: 0 })]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    // The frame handed in is not changed.
    expect(frame.data[3]).toBe(255);
  });

  it('guesses the backdrop colour from the edges', () => {
    const rows = Array.from({ length: 20 }, (_, y) => (y > 5 && y < 15 ? 'ggggggggssssgggggggg' : 'gggggggggggggggggggg'));
    expect(guessKey(picture(rows, COLOURS))).toEqual([0, 177, 64]);
    expect(guessKey(picture(rows, { g: [10, 60, 200], s: COLOURS.s }))).toEqual([10, 60, 200]);
    // Nothing strongly green or blue at the edges: the usual studio green.
    expect(guessKey(picture(['www', 'wsw', 'www'], COLOURS))).toEqual([0, 177, 64]);
  });

  it('reads and writes colours', () => {
    expect(hexOf([0, 177, 64])).toBe('#00b140');
    expect(hexOf([-4, 300, 15.6])).toBe('#00ff10');
    expect(rgbOf('#00B140')).toEqual([0, 177, 64]);
    expect(rgbOf('00b140')).toEqual([0, 177, 64]);
    expect(rgbOf('#0b1')).toBeNull();
    expect(rgbOf('green')).toBeNull();
  });

  it('restates the settings in the terms FFmpeg compares colours in', () => {
    expect(sourceColour({ pix_fmt: 'yuv420p', color_space: 'bt709', color_range: 'tv' })).toEqual({ matrix: 'bt709', full: false });
    expect(sourceColour({ pix_fmt: 'yuvj420p' })).toEqual({ matrix: 'bt601', full: true });
    expect(sourceColour({ pix_fmt: 'rgb24', color_range: 'pc' })).toEqual({ matrix: 'bt601', full: false });
    expect(sourceColour(undefined)).toEqual({ matrix: 'bt601', full: false });
    const settings = { key: GREEN, similarity: 0.2, blend: 0.1, spill: 0.4 };
    // Full-range video in BT.601 is compared as it is.
    expect(ffmpegKey(settings, { matrix: 'bt601', full: true })).toEqual({ key: '#00b140', similarity: 0.2, blend: 0.1, spill: 0.4, spillType: 'green' });
    // Broadcast-range video stores colour differences at 224/255 of their size: the key colour and the tolerances shrink with them.
    const squeezed = ffmpegKey(settings, { matrix: 'bt601', full: false });
    expect(squeezed.similarity).toBeCloseTo(0.2 * (224 / 255), 6);
    expect(squeezed.blend).toBeCloseTo(0.1 * (224 / 255), 6);
    const stated = rgbOf(squeezed.key) ?? [0, 0, 0];
    const [b, r] = chromaOf(stated[0], stated[1], stated[2]);
    const [kb, kr] = chromaOf(0, 177, 64);
    expect(b).toBeCloseTo((kb * 224) / 255, 0);
    expect(r).toBeCloseTo((kr * 224) / 255, 0);
    // In BT.709 video the same green has other colour differences; the key is restated from those.
    const hd = rgbOf(ffmpegKey(settings, { matrix: 'bt709', full: true }).key) ?? [0, 0, 0];
    const [hb, hr] = chromaOf(hd[0], hd[1], hd[2]);
    const [wb, wr] = chromaOf(0, 177, 64, 'bt709');
    expect(Math.abs(hb - wb)).toBeLessThan(1.5);
    expect(Math.abs(hr - wr)).toBeLessThan(1.5);
    expect(ffmpegKey({ ...settings, similarity: 0 }, { matrix: 'bt601', full: true }).similarity).toBeGreaterThan(0);
  });

  it('places the background and the subject as FFmpeg does', () => {
    expect(fitRect(400, 200, 200, 200, 'cover')).toEqual({ x: -100, y: 0, width: 400, height: 200 });
    expect(fitRect(400, 200, 200, 200, 'contain')).toEqual({ x: 0, y: 50, width: 200, height: 100 });
    expect(fitRect(400, 200, 200, 200, 'stretch')).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    expect(subjectRect(1920, 1080, 1, 0, 0)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    // Half size, a quarter of the frame to the right: sizes are even, as video encoders want.
    expect(subjectRect(160, 120, 0.5, 0.25, 0)).toEqual({ x: 80, y: 30, width: 80, height: 60 });
    expect(subjectRect(101, 75, 0.5, 0, -0.1)).toEqual({ x: 25.5, y: 12, width: 50, height: 36 });
  });
});
