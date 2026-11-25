import { describe, expect, it } from 'vitest';
import { boxFrom, bytesMention, findMatches, joinItems, luhn, mentions, overlap, type TextItem, textUnder, verhoeff } from '../../src/lib/pdf-redact';

const line = (y: number, ...pieces: [string, number, number][]): TextItem[] => pieces.map(([text, x, w]) => ({ text, x, y, w, h: 10 }));

describe('finding text to redact', () => {
  it('joins the pieces of a page, with a space between lines and apart pieces', () => {
    const items = [...line(100, ['Curator: A. Sriv', 50, 80], ['astava', 130, 30]), ...line(120, ['Phone', 50, 30], ['98765 43210', 100, 60])];
    expect(joinItems(items).text).toBe('Curator: A. Srivastava Phone 98765 43210');
  });

  it('finds words that run across pieces and gives a box for each piece', () => {
    const items = line(100, ['Curator: A. Sriv', 50, 80], ['astava', 130, 30]);
    const [match] = findMatches(items, [{ kind: 'text', text: 'srivastava' }], 0);
    expect(match?.text).toBe('Srivastava');
    expect(match?.boxes).toEqual([
      { x: 110, y: 100, w: 20, h: 10 },
      { x: 130, y: 100, w: 30, h: 10 },
    ]);
  });

  it('uses measured character places when it has them, and whole pieces of turned text', () => {
    const narrow: TextItem = { text: 'ill WWW', x: 0, y: 0, w: 100, h: 10, cuts: [0, 0.04, 0.08, 0.12, 0.16, 0.44, 0.72, 1] };
    expect(findMatches([narrow], [{ kind: 'text', text: 'www' }], 0)[0]?.boxes).toEqual([{ x: 16, y: 0, w: 84, h: 10 }]);
    // With padding, a little more sideways than up and down.
    const [padded] = findMatches([narrow], [{ kind: 'text', text: 'www' }], 1)[0]?.boxes ?? [];
    expect(padded?.x).toBeCloseTo(16 - 2.2);
    expect(padded?.y).toBe(-1);
    const turned: TextItem = { text: 'sideways secret', x: 5, y: 5, w: 12, h: 90, whole: true };
    expect(findMatches([turned], [{ kind: 'text', text: 'secret' }], 0)[0]?.boxes).toEqual([{ x: 5, y: 5, w: 12, h: 90 }]);
  });

  it('matches across line breaks and honours case and whole words', () => {
    const items = [...line(100, ['Visvesvaraya Industrial and', 50, 150]), ...line(114, ['Technological Museum, museums', 50, 150])];
    expect(findMatches(items, [{ kind: 'text', text: 'industrial and technological' }])).toHaveLength(1);
    expect(findMatches(items, [{ kind: 'text', text: 'museum' }])).toHaveLength(2);
    expect(findMatches(items, [{ kind: 'text', text: 'museum', wholeWord: true }])).toHaveLength(1);
    expect(findMatches(items, [{ kind: 'text', text: 'museum', caseSensitive: true }])).toHaveLength(1);
    expect(findMatches(items, [{ kind: 'text', text: '  ' }])).toHaveLength(0);
    expect(findMatches(items, [{ kind: 'regex', source: 'Mus[a-z]+' }])).toHaveLength(2);
    expect(findMatches(items, [{ kind: 'regex', source: '(' }])).toHaveLength(0);
  });

  it('knows common personal details, with their checksums', () => {
    const text =
      'Mail a.b@museum.example or call +91 98765 43210. PAN ABCDE1234F, Aadhaar 2341 2341 2346 (not 2341 2341 2345), card 4111 1111 1111 1111 (not 4111 1111 1111 1112), from 192.168.1.20, total 1234567.';
    const items: TextItem[] = [{ text, x: 0, y: 0, w: text.length * 5, h: 10 }];
    const found = (id: string) => findMatches(items, [{ kind: 'pattern', id }]).map((m) => m.text);
    expect(found('email')).toEqual(['a.b@museum.example']);
    expect(found('phone')).toEqual(['+91 98765 43210']);
    expect(found('pan')).toEqual(['ABCDE1234F']);
    expect(found('aadhaar')).toEqual(['2341 2341 2346']);
    expect(found('card')).toEqual(['4111 1111 1111 1111']);
    expect(found('ip')).toEqual(['192.168.1.20']);
    expect(found('nothing')).toEqual([]);
  });

  it('checks Luhn and Verhoeff numbers', () => {
    expect(luhn('4111 1111 1111 1111')).toBe(true);
    expect(luhn('4111 1111 1111 1112')).toBe(false);
    expect(luhn('123')).toBe(false);
    expect(verhoeff('2363')).toBe(true);
    expect(verhoeff('2364')).toBe(false);
    expect(verhoeff('')).toBe(false);
  });
});

describe('checking a redaction', () => {
  it('measures what lies under a box', () => {
    const items = line(100, ['secret', 50, 60], ['public', 200, 60]);
    expect(overlap(items[0] as TextItem, { x: 40, y: 95, w: 50, h: 20 })).toBeCloseTo(40 / 60);
    expect(textUnder(items, [{ x: 40, y: 95, w: 50, h: 20 }]).map((i) => i.text)).toEqual(['secret']);
    expect(textUnder(items, [{ x: 105, y: 95, w: 50, h: 20 }])).toEqual([]);
    expect(boxFrom(120, 80, -10, 20, 100, 100)).toEqual({ x: 0, y: 20, w: 100, h: 60 });
  });

  it('looks for words in loose text and raw bytes', () => {
    const queries = [{ kind: 'text', text: 'Srivastava' } as const, { kind: 'pattern', id: 'email' } as const];
    expect(mentions('Author: a. srivastava <x@y.org>', queries)).toEqual(['Srivastava', 'E-mail addresses']);
    expect(mentions('Nothing here', queries)).toEqual([]);
    const plain = new TextEncoder().encode('%PDF /Title (Report by SRIVASTAVA)');
    expect(bytesMention(plain, 'Srivastava')).toBe(true);
    const wide = new Uint8Array([0xfe, 0xff, 0, 0x53, 0, 0x72, 0, 0x69, 0, 0x76]);
    expect(bytesMention(wide, 'Sriv')).toBe(true);
    expect(bytesMention(plain, 'curator')).toBe(false);
    expect(bytesMention(plain, 'PDF')).toBe(false);
  });
});
