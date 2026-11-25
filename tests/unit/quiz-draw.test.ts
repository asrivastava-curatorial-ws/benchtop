import { describe, expect, it } from 'vitest';
import { arcPath, cloudBox, layoutCloud, percents, sharesOf, wheelTurn } from '../../src/lib/quiz-draw';

const mono = (text: string) => [...text].length * 0.6;

describe('the word cloud', () => {
  const words = [
    { text: 'curious', count: 9 },
    { text: 'fun', count: 6 },
    { text: 'loud', count: 3 },
    { text: 'engines', count: 3 },
    { text: 'bright', count: 2 },
    { text: 'crowded', count: 1 },
    { text: 'calm', count: 1 },
    { text: 'surprising', count: 1 },
  ];

  it('puts the commonest word in the middle, biggest, and keeps every word clear of the others and on the sheet', () => {
    const placed = layoutCloud(words, 800, 400, mono);
    expect(placed).toHaveLength(words.length);
    expect(placed[0]).toMatchObject({ text: 'curious', x: 400, y: 200, size: 60 });
    expect(placed[placed.length - 1]?.size).toBe(15);
    for (const a of placed) {
      expect(a.x - a.width / 2).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width / 2).toBeLessThanOrEqual(800);
      expect(a.y - a.height / 2).toBeGreaterThanOrEqual(0);
      expect(a.y + a.height / 2).toBeLessThanOrEqual(400);
      for (const b of placed) {
        if (a === b) continue;
        const apart = Math.abs(a.x - b.x) * 2 >= a.width + b.width || Math.abs(a.y - b.y) * 2 >= a.height + b.height;
        expect(apart, `${a.text} / ${b.text}`).toBe(true);
      }
    }
    // Words said equally often are the same size.
    expect(placed.find((w) => w.text === 'loud')?.size).toBe(placed.find((w) => w.text === 'engines')?.size);
  });

  it('shrinks a word that is too long for the sheet, and leaves out what cannot fit', () => {
    const long = layoutCloud([{ text: 'x'.repeat(40), count: 5 }], 300, 200, mono);
    expect(long[0]?.width).toBeLessThanOrEqual(300 * 0.9 + 0.001);
    const crowd = Array.from({ length: 200 }, (_, i) => ({ text: `word${i}`, count: 1 }));
    const placed = layoutCloud(crowd, 300, 120, mono, { limit: 200 });
    expect(placed.length).toBeGreaterThan(5);
    expect(placed.length).toBeLessThan(200);
    expect(layoutCloud(crowd, 300, 120, mono).length).toBeLessThanOrEqual(60);
    expect(layoutCloud([], 300, 120, mono)).toEqual([]);
    // One word alone is shown at full size; several said once each sit in the middle of the range.
    expect(layoutCloud([{ text: 'solo', count: 1 }], 800, 400, mono)[0]?.size).toBe(60);
    expect(layoutCloud(crowd.slice(0, 2), 800, 400, mono)[0]?.size).toBe(37.5);
  });

  it('cuts the sheet to the words', () => {
    const placed = layoutCloud([{ text: 'solo', count: 1 }], 800, 400, mono);
    // Four letters at size 60: 144 wide and 69 tall, in the middle of the sheet.
    const box = cloudBox(placed, 10);
    expect(box?.x).toBeCloseTo(400 - 72 - 10);
    expect(box?.y).toBeCloseTo(200 - 34.5 - 10);
    expect(box?.width).toBeCloseTo(164);
    expect(box?.height).toBeCloseTo(89);
    expect(cloudBox([])).toBeNull();
  });
});

describe('rings and pies', () => {
  it('splits counts into shares that go once round', () => {
    const parts = sharesOf([2, 0, 6]);
    expect(parts.map((p) => [p.share, p.from, p.to])).toEqual([
      [0.25, 0, 0.25],
      [0, 0.25, 0.25],
      [0.75, 0.25, 1],
    ]);
    expect(sharesOf([0, 0]).every((p) => p.share === 0)).toBe(true);
  });

  it('gives per cents in which equal counts read the same', () => {
    expect(percents([1, 1, 1])).toEqual([33, 33, 33]);
    expect(percents([1, 3, 1, 1])).toEqual([17, 50, 17, 17]);
    expect(percents([2, 1])).toEqual([67, 33]);
    expect(percents([0, 0])).toEqual([0, 0]);
    expect(percents([5])).toEqual([100]);
  });

  it('draws a quarter of a ring, a pie slice, and a whole ring in two halves', () => {
    expect(arcPath(100, 100, 80, 50, 0, 0.25)).toBe('M100 20 A80 80 0 0 1 180 100 L150 100 A50 50 0 0 0 100 50 Z');
    expect(arcPath(100, 100, 80, 0, 0.25, 0.5)).toBe('M100 100 L180 100 A80 80 0 0 1 100 180 Z');
    // More than half the way round takes the long way.
    expect(arcPath(100, 100, 80, 50, 0, 0.75)).toContain('A80 80 0 1 1 20 100');
    const whole = arcPath(100, 100, 80, 50, 0, 1);
    expect(whole.match(/M/g)).toHaveLength(2);
    expect(whole).not.toContain('NaN');
    expect(arcPath(100, 100, 80, 50, 0.3, 0.3)).toBe('');
  });
});

describe('the spinner wheel', () => {
  it('turns five times for every spin and stops with the chosen entry at the top', () => {
    expect(wheelTurn(0, 4, 0)).toBe(0);
    expect(wheelTurn(0, 4, 1)).toBe(1800 - 45);
    expect(wheelTurn(3, 4, 2)).toBe(3600 - 315);
    expect(wheelTurn(0, 0, 3)).toBe(0);
    // A later spin always turns further than the one before, whatever it stops on.
    expect(wheelTurn(0, 12, 2)).toBeGreaterThan(wheelTurn(11, 12, 1));
  });
});
