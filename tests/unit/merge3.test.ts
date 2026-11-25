import { describe, expect, it } from 'vitest';
import { type Chunk, conflictsIn, graphRows, linesOf, merge3, mergedText, parseUnifiedDiff, resolved } from '../../src/lib/merge3';

const L = (text: string) => linesOf(text);
const merge = (base: string, ours: string, theirs: string) => merge3(L(base), L(ours), L(theirs));
const text = (chunks: Chunk[]) => mergedText(chunks, new Map());

describe('three-way merge', () => {
  it('keeps line ends, also a missing last one', () => {
    expect(linesOf('a\nb\n')).toEqual(['a\n', 'b\n']);
    expect(linesOf('a\n\nb')).toEqual(['a\n', '\n', 'b']);
    expect(linesOf('')).toEqual([]);
  });

  it('takes changes made on one side only', () => {
    const chunks = merge('one\ntwo\nthree\nfour\n', 'one\nTWO\nthree\nfour\n', 'one\ntwo\nthree\nfour\nfive\n');
    expect(conflictsIn(chunks)).toBe(0);
    expect(text(chunks)).toBe('one\nTWO\nthree\nfour\nfive\n');
    expect(chunks.map((c) => (c.kind === 'plain' ? c.from : 'conflict'))).toEqual(['base', 'ours', 'base', 'theirs']);
  });

  it('takes deletions and insertions from either side', () => {
    expect(text(merge('a\nb\nc\nd\ne\n', 'a\nc\nd\ne\n', 'a\nb\nc\nd\nX\ne\n'))).toBe('a\nc\nd\nX\ne\n');
    expect(text(merge('a\nb\n', 'a\nb\n', 'a\nb\n'))).toBe('a\nb\n');
    expect(text(merge('', 'new\n', ''))).toBe('new\n');
    expect(text(merge('gone\n', '', 'gone\n'))).toBe('');
  });

  it('accepts the same change made on both sides', () => {
    const chunks = merge('a\nb\nc\n', 'a\nB\nc\n', 'a\nB\nc\n');
    expect(conflictsIn(chunks)).toBe(0);
    expect(chunks.find((c) => c.kind === 'plain' && c.from === 'both')).toBeDefined();
    expect(text(chunks)).toBe('a\nB\nc\n');
  });

  it('reports a conflict where both sides changed the same lines differently', () => {
    const chunks = merge('title\nold line\nend\n', 'title\nour line\nend\n', 'title\ntheir line\nend\n');
    expect(conflictsIn(chunks)).toBe(1);
    const index = chunks.findIndex((c) => c.kind === 'conflict');
    const conflict = chunks[index] as Extract<Chunk, { kind: 'conflict' }>;
    expect(conflict).toEqual({ kind: 'conflict', base: ['old line\n'], ours: ['our line\n'], theirs: ['their line\n'] });
    expect(text(chunks)).toBe('title\n<<<<<<< ours\nour line\n||||||| base\nold line\n=======\ntheir line\n>>>>>>> theirs\nend\n');
    expect(mergedText(chunks, new Map([[index, resolved(conflict, 'theirs-ours')]]))).toBe('title\ntheir line\nour line\nend\n');
    expect(mergedText(chunks, new Map([[index, resolved(conflict, 'none')]]))).toBe('title\nend\n');
    expect(mergedText(chunks, new Map([[index, ['typed by hand\n']]]))).toBe('title\ntyped by hand\nend\n');
  });

  it('keeps separate changes separate and joins overlapping ones into one conflict', () => {
    const base = '1\n2\n3\n4\n5\n6\n7\n8\n';
    const chunks = merge(base, '1\n2a\n3\n4\n5\n6\n7a\n8\n', '1\n2\n3\n4b\n5\n6\n7b\n8\n');
    expect(conflictsIn(chunks)).toBe(1);
    expect(text(chunks)).toBe('1\n2a\n3\n4b\n5\n6\n<<<<<<< ours\n7a\n||||||| base\n7\n=======\n7b\n>>>>>>> theirs\n8\n');
    // One side rewrites lines 2 to 4, the other only line 3: one conflict over all three.
    const wide = merge(base, '1\nA\nB\nC\n5\n6\n7\n8\n', '1\n2\nX\n4\n5\n6\n7\n8\n');
    expect(conflictsIn(wide)).toBe(1);
    expect(wide.find((c) => c.kind === 'conflict')).toMatchObject({ base: ['2\n', '3\n', '4\n'], ours: ['A\n', 'B\n', 'C\n'], theirs: ['2\n', 'X\n', '4\n'] });
  });

  it('treats both sides adding at the same place as a conflict, and marks a missing final newline', () => {
    const chunks = merge('a\nz\n', 'a\nours\nz\n', 'a\ntheirs\nz\n');
    expect(conflictsIn(chunks)).toBe(1);
    expect(chunks.find((c) => c.kind === 'conflict')).toMatchObject({ base: [], ours: ['ours\n'], theirs: ['theirs\n'] });
    expect(text(merge('a\n', 'a\nx', 'a\ny'))).toBe('a\n<<<<<<< ours\nx\n||||||| base\n=======\ny\n>>>>>>> theirs\n');
  });

  it('merges long texts with many changes the way git does', () => {
    const base = Array.from({ length: 200 }, (_, i) => `line ${i}\n`);
    const ours = base.map((line, i) => (i % 20 === 3 ? `ours ${i}\n` : line));
    const theirs = base.flatMap((line, i) => (i % 20 === 13 ? [line, `added ${i}\n`] : i === 50 ? [] : [line]));
    const chunks = merge3(base, ours, theirs);
    expect(conflictsIn(chunks)).toBe(0);
    const merged = linesOf(text(chunks));
    expect(merged).toHaveLength(200 + 10 - 1);
    expect(merged.filter((l) => l.startsWith('ours'))).toHaveLength(10);
    expect(merged.filter((l) => l.startsWith('added'))).toHaveLength(10);
    expect(merged).not.toContain('line 50\n');
  });
});

describe('commit graph', () => {
  it('draws a straight history in one lane', () => {
    const rows = graphRows([
      { hash: 'c', parents: ['b'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] },
    ]);
    expect(rows.map((r) => [r.lane, r.joins, r.out])).toEqual([
      [0, [], [0]],
      [0, [0], [0]],
      [0, [0], []],
    ]);
  });

  it('opens a lane for a merged branch and closes it where the branch began', () => {
    // m merges f into main; f and d both come from b.
    const rows = graphRows([
      { hash: 'm', parents: ['d', 'f'] },
      { hash: 'f', parents: ['b'] },
      { hash: 'd', parents: ['b'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] },
    ]);
    expect(rows[0]).toMatchObject({ lane: 0, out: [0, 1], width: 2 });
    expect(rows[1]).toMatchObject({ lane: 1, joins: [1], passing: [0], out: [1] });
    expect(rows[2]).toMatchObject({ lane: 0, joins: [0], passing: [1], out: [1] });
    expect(rows[3]).toMatchObject({ lane: 1, joins: [1], out: [1] });
    expect(rows[4]).toMatchObject({ joins: [1], out: [] });
  });
});

describe('unified diffs', () => {
  it('numbers the lines of each side', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      'index 1..2 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -3,4 +3,5 @@ heading',
      ' same',
      '-old',
      '+new',
      '+more',
      ' tail',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const lines = parseUnifiedDiff(diff);
    expect(lines.filter((l) => l.kind === 'meta')).toHaveLength(5);
    expect(lines.filter((l) => l.kind !== 'meta').map((l) => [l.kind, l.old, l.new, l.text])).toEqual([
      ['hunk', undefined, undefined, '@@ -3,4 +3,5 @@ heading'],
      ['same', 3, 3, 'same'],
      ['remove', 4, undefined, 'old'],
      ['add', undefined, 4, 'new'],
      ['add', undefined, 5, 'more'],
      ['same', 5, 6, 'tail'],
    ]);
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
