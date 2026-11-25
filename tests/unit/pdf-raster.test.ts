import { describe, expect, it } from 'vitest';
import { dominantAngle, fileNameFrom, findRegions, inkShare, recolour, titleFromItems } from '../../src/lib/pdf-raster';

const pixels = (rgb: number[][]) => new Uint8ClampedArray(rgb.flatMap((c) => [...c, 255]));

describe('PDF pictures and text', () => {
  it('recolours pixels', () => {
    const a = pixels([
      [255, 0, 0],
      [10, 20, 30],
    ]);
    recolour(a, { kind: 'invert' });
    expect([...a.slice(0, 3)]).toEqual([0, 255, 255]);
    const g = pixels([[255, 0, 0]]);
    recolour(g, { kind: 'grayscale' });
    expect(g[0]).toBe(g[1]);
    expect(g[0]).toBe(54);
    const bw = pixels([
      [200, 200, 200],
      [90, 90, 90],
    ]);
    recolour(bw, { kind: 'blackwhite', threshold: 128 });
    expect([bw[0], bw[4]]).toEqual([255, 0]);
    const r = pixels([
      [250, 5, 5],
      [0, 0, 250],
    ]);
    recolour(r, { kind: 'replace', from: '#ff0000', to: '#00ff00', tolerance: 20 });
    expect([...r.slice(0, 3)]).toEqual([0, 255, 0]);
    expect([...r.slice(4, 7)]).toEqual([0, 0, 250]);
  });

  it('measures ink', () => {
    expect(inkShare(pixels([[255, 255, 255]]))).toBe(0);
    expect(
      inkShare(
        pixels([
          [0, 0, 0],
          [255, 255, 255],
          [255, 255, 255],
          [255, 255, 255],
        ]),
      ),
    ).toBe(0.25);
  });

  it('finds which way text runs and a title', () => {
    const t = (str: string, a: number, b: number, size = 12, x = 0, y = 0) => ({ str, transform: [a * size, b * size, -b * size, a * size, x, y] });
    expect(dominantAngle([t('Hello world', 1, 0), t('x', 0, 1)])).toBe(0);
    expect(dominantAngle([t('Sideways text here', 0, 1), t('ab', 1, 0)])).toBe(90);
    expect(dominantAngle([t('Upside down', -1, 0)])).toBe(180);
    expect(dominantAngle([])).toBeNull();
    const items = [t('Annual report', 1, 0, 28, 72, 760), t('2025–26', 1, 0, 28, 300, 760), t('Body text that is long', 1, 0, 11, 72, 700), t('Footer', 1, 0, 30, 72, 30)];
    expect(titleFromItems(items, 842)).toBe('Annual report 2025–26');
    expect(fileNameFrom('Report: Q1/Q2 <draft>? ')).toBe('Report Q1 Q2 draft');
  });

  it('finds separate photos on a scan', () => {
    const w = 200;
    const h = 120;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const paint = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          data[i] = 30;
          data[i + 1] = 90;
          data[i + 2] = 160;
        }
    };
    paint(16, 16, 80, 96);
    paint(120, 24, 184, 88);
    const boxes = findRegions(data, w, h);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toEqual({ x: 16, y: 16, width: 64, height: 80 });
    expect(boxes[1]).toEqual({ x: 120, y: 24, width: 64, height: 64 });
  });
});
