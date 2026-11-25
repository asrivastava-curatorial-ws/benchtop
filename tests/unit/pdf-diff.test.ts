import { describe, expect, it } from 'vitest';
import { changesOf, compareText, DIFF_COLOURS, diff, type Hunk, linesOf, pixelDiff, type Word, wordsOf } from '../../src/lib/pdf-diff';
import type { TextItem } from '../../src/lib/pdf-redact';

const codes = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Applies the hunks to `a`, which must give `b`. */
function apply(a: readonly number[], b: readonly number[], hunks: readonly Hunk[]): number[] {
  const out: number[] = [];
  let aAt = 0;
  let bAt = 0;
  for (const h of hunks) {
    expect(h.aStart).toBe(aAt);
    expect(h.bStart).toBe(bAt);
    if (h.op === 'same') expect(a.slice(h.aStart, h.aEnd)).toEqual(b.slice(h.bStart, h.bEnd));
    if (h.op !== 'removed') out.push(...b.slice(h.bStart, h.bEnd));
    aAt = h.aEnd;
    bAt = h.bEnd;
  }
  expect(aAt).toBe(a.length);
  return out;
}

/** Text items, one per word, laid out in lines 20 points apart. */
function page(lines: string[]): TextItem[] {
  const items: TextItem[] = [];
  lines.forEach((line, row) => {
    let x = 10;
    for (const word of line.split(' ')) {
      const w = word.length * 6;
      items.push({ text: `${word} `, x, y: 10 + row * 20, w: w + 6, h: 12 });
      x += w + 6;
    }
  });
  return items;
}

const texts = (words: readonly Word[]) => words.map((w) => w.text).join(' ');

describe('PDF comparison', () => {
  it('finds the shortest edit', () => {
    const a = codes('ABCABBA');
    const b = codes('CBABAC');
    const hunks = diff(a, b);
    expect(apply(a, b, hunks)).toEqual(b);
    const edits = hunks.filter((h) => h.op !== 'same').reduce((sum, h) => sum + (h.aEnd - h.aStart) + (h.bEnd - h.bStart), 0);
    expect(edits).toBe(5);
    for (const [x, y] of [
      ['', 'abc'],
      ['abc', ''],
      ['same', 'same'],
      ['kitten', 'sitting'],
      ['the quick brown fox', 'the quack brown box!'],
    ] as const)
      expect(apply(codes(x), codes(y), diff(codes(x), codes(y)))).toEqual(codes(y));
    // Too different to work out: everything in between is replaced.
    expect(diff(codes('xaaay'), codes('xbbby'), 0).map((h) => h.op)).toEqual(['same', 'removed', 'added', 'same']);
  });

  it('reads words and lines from page text', () => {
    const words = wordsOf(page(['The engine runs', 'Second line']), 3);
    expect(words.map((w) => w.text)).toEqual(['The', 'engine', 'runs', 'Second', 'line']);
    expect(words[0]?.page).toBe(3);
    expect(words[1]?.box.x).toBeCloseTo(34, 0);
    expect(linesOf(words).map((l) => l.key)).toEqual(['The engine runs', 'Second line']);
  });

  it('compares the words of two documents', () => {
    const a = wordsOf(page(['The engine runs fast', 'Second line', 'Old ending']), 1);
    const b = wordsOf(page(['The engine runs slowly', 'Second line', 'New line', 'Old ending']), 1);
    const segments = compareText(a, b);
    expect(segments.map((s) => [s.op, texts(s.op === 'added' ? s.b : s.a)])).toEqual([
      ['same', 'The engine runs'],
      ['removed', 'fast'],
      ['added', 'slowly'],
      ['same', 'Second line'],
      ['added', 'New line'],
      ['same', 'Old ending'],
    ]);
    const changes = changesOf(segments, 2);
    expect(changes).toHaveLength(2);
    expect([texts(changes[0]?.removed ?? []), texts(changes[0]?.added ?? []), changes[0]?.before, changes[0]?.after]).toEqual(['fast', 'slowly', 'engine runs', 'Second line']);
    expect(changes[1]?.pageB).toBe(1);
    expect(compareText(a, a).every((s) => s.op === 'same')).toBe(true);
  });

  it('colours the pixels that differ', () => {
    const white = [255, 255, 255, 255];
    const black = [0, 0, 0, 255];
    const red = [200, 30, 30, 255];
    const a = { width: 3, height: 1, data: new Uint8ClampedArray([...white, ...black, ...black]) };
    const b = { width: 3, height: 1, data: new Uint8ClampedArray([...black, ...black, ...red]) };
    const d = pixelDiff(a, b);
    expect(d.changed).toBe(2);
    expect([...d.data.slice(0, 3)]).toEqual([...DIFF_COLOURS.added]);
    expect(d.data[4]).toBe(d.data[5]);
    expect([...d.data.slice(8, 11)]).toEqual([...DIFF_COLOURS.removed]);
    // A bigger page: the part the smaller one lacks counts as white paper.
    const tall = pixelDiff({ width: 1, height: 1, data: new Uint8ClampedArray(black) }, { width: 1, height: 2, data: new Uint8ClampedArray([...black, ...black]) });
    expect([tall.width, tall.height, tall.changed]).toEqual([1, 2, 1]);
  });
});
