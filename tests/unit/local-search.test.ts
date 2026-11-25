import { describe, expect, it } from 'vitest';
import { CLOSE, findWord, fold, groupHits, OPEN, parseTerms, placeLabel, searchNotes, splitMarked } from '../../src/lib/local-search';

const m = (text: string) => text.replaceAll('[', OPEN).replaceAll(']', CLOSE);

describe('marked text', () => {
  it('becomes plain pieces, never markup', () => {
    expect(splitMarked(m('a [b] <i>c</i> [d]'))).toEqual([
      { text: 'a ', hit: false },
      { text: 'b', hit: true },
      { text: ' <i>c</i> ', hit: false },
      { text: 'd', hit: true },
    ]);
    expect(splitMarked('')).toEqual([]);
    expect(splitMarked(m('[all]'))).toEqual([{ text: 'all', hit: true }]);
  });

  it('names the place of a match', () => {
    expect(placeLabel({ label: '', line: 1200 })).toBe(`Line ${(1200).toLocaleString()}`);
    expect(placeLabel({ label: 'Page 3', line: 0 })).toBe('Page 3');
    expect(placeLabel({ label: '', line: 0 })).toBe('');
  });

  it('groups matches by file in the order of the best match', () => {
    const groups = groupHits([
      { file: 2, row: 1 },
      { file: 1, row: 2 },
      { file: 2, row: 3 },
    ]);
    expect(groups.map((g) => [g.file, g.places.map((p) => p.row)])).toEqual([
      [2, [1, 3]],
      [1, [2]],
    ]);
  });
});

describe('searching notes', () => {
  const notes = [
    { id: 'a', title: 'Engine Hall', text: 'Polish the brass on the beam engine.\nCall the électricien about the lamps.', modified: '2026-11-01T10:00:00Z' },
    { id: 'b', title: 'Shopping', text: 'Brass polish, lamp oil and rags', modified: '2026-11-20T10:00:00Z' },
    { id: 'c', title: 'संग्रहालय', text: 'विश्वेश्वरैया संग्रहालय बेंगलुरु', modified: '2026-10-01T10:00:00Z' },
  ];
  const ids = (query: string) => searchNotes(notes, query).map((n) => n.id);

  it('folds case and accents without changing lengths', () => {
    expect(fold('ÉCOLE Zürich')).toBe('ecole zurich');
    expect(fold('İstanbul').length).toBe('İstanbul'.length);
    expect(fold('संग्रहालय')).toBe('संग्रहालय');
  });

  it('reads the same query language as the index', () => {
    expect(parseTerms('"beam engine" -toy brass OR bronze turb* name:hall')).toEqual({ must: [['beam engine'], ['brass', 'bronze'], ['turb'], ['hall']], not: ['toy'], filesOnly: false });
    expect(parseTerms('report ext:pdf').filesOnly).toBe(true);
    expect(parseTerms('-only *** OR').must).toEqual([]);
  });

  it('matches at the start of words only', () => {
    expect(findWord('the lamps are lit', 'lamp')).toBe(4);
    expect(findWord('a clamp', 'lamp')).toBe(-1);
  });

  it('finds notes holding every word, newest first', () => {
    expect(ids('brass')).toEqual(['b', 'a']);
    expect(ids('brass engine')).toEqual(['a']);
    expect(ids('brass -engine')).toEqual(['b']);
    expect(ids('"lamp oil"')).toEqual(['b']);
    expect(ids('electricien')).toEqual(['a']);
    expect(ids('engine OR rags')).toEqual(['b', 'a']);
    expect(ids('hall')).toEqual(['a']);
    expect(ids('संग्रहालय')).toEqual(['c']);
    expect(ids('संग')).toEqual(['c']);
    expect(ids('rass')).toEqual([]);
    expect(ids('')).toEqual([]);
    expect(ids('brass ext:pdf')).toEqual([]);
  });

  it('shows the line around the first match in the text', () => {
    const [hit] = searchNotes(notes, 'electricien lamps');
    expect(hit?.snippet).toBe(m('Call the [électricien] about the [lamps].'));
    const [title] = searchNotes(notes, 'shopping');
    expect(title?.snippet).toBe(m('[Shopping] Brass polish, lamp oil and rags'));
  });
});
