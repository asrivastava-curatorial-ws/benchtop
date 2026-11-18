import { describe, expect, it } from 'vitest';
import { mergeTables, splitByColumn, splitByRows, type Table } from '../../src/lib/csv-merge';

const a: Table = {
  name: 'a.csv',
  header: ['id', 'name'],
  rows: [
    ['1', 'Asha'],
    ['2', 'Ravi'],
  ],
};
const b: Table = {
  name: 'b.csv',
  header: ['name', 'city', 'id'],
  rows: [
    ['Meera', 'Pune', '3'],
    ['Ravi', '', '2'],
  ],
};

describe('CSV merge and split', () => {
  it('merges by column name', () => {
    const m = mergeTables([a, b], { byName: true, source: false, dedupe: false });
    expect(m.header).toEqual(['id', 'name', 'city']);
    expect(m.rows).toEqual([
      ['1', 'Asha', ''],
      ['2', 'Ravi', ''],
      ['3', 'Meera', 'Pune'],
      ['2', 'Ravi', ''],
    ]);
  });

  it('removes repeats, ignoring the source column', () => {
    const m = mergeTables([a, b], { byName: true, source: true, dedupe: true });
    expect(m.header[0]).toBe('Source file');
    expect(m.rows.map((r) => r[0])).toEqual(['a.csv', 'a.csv', 'b.csv']);
  });

  it('appends rows as they are', () => {
    const m = mergeTables([a, { name: 'c.csv', header: ['x', 'y', 'z'], rows: [['p', 'q', 'r']] }], { byName: false, source: false, dedupe: false });
    expect(m.header).toEqual(['id', 'name', 'Column 3']);
    expect(m.rows[2]).toEqual(['p', 'q', 'r']);
    expect(m.rows[0]).toEqual(['1', 'Asha', '']);
  });

  it('splits by rows and by column value', () => {
    const big: Table = { name: 't', header: ['k', 'v'], rows: Array.from({ length: 5 }, (_, i) => [i % 2 ? 'odd' : 'even/x', String(i)]) };
    expect(splitByRows(big, 2, 't').map((p) => [p.name, p.rows.length])).toEqual([
      ['t part 1.csv', 2],
      ['t part 2.csv', 2],
      ['t part 3.csv', 1],
    ]);
    const parts = splitByColumn(big, 0, 't');
    expect(parts.map((p) => [p.name, p.rows.length])).toEqual([
      ['t even_x.csv', 3],
      ['t odd.csv', 2],
    ]);
  });
});
