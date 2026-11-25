import { describe, expect, it } from 'vitest';
import { type Cell, cellOf, covers, evaluate, expressionText, layout, minimalCover, minimise, mintermAt, parseExpression, parseList, primeImplicants, runs } from '../../src/lib/kmap';

const ABC = ['A', 'B', 'C'];
const ABCD = ['A', 'B', 'C', 'D'];

/** A small seeded random generator, so failures repeat. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('Karnaugh maps', () => {
  it('finds prime implicants and the cheapest covers', () => {
    const primes = primeImplicants(3, [0, 1, 2, 5, 6, 7]);
    expect(primes).toHaveLength(6);
    const cyclic = minimalCover(3, [0, 1, 2, 5, 6, 7]);
    expect(cyclic.terms).toHaveLength(3);
    expect(cyclic.essential).toHaveLength(0);
    expect(cyclic.alternatives).toBe(2);
    const classic = minimalCover(4, [4, 8, 10, 11, 12, 15], [9, 14]);
    expect(expressionText(classic.terms, ABCD, 'sop').split(' + ').sort()).toEqual(['A·B′', 'A·C', 'B·C′·D′']);
    expect(expressionText(minimalCover(3, []).terms, ABC, 'sop')).toBe('0');
    expect(expressionText(minimalCover(2, [0, 1, 2, 3]).terms, ['A', 'B'], 'sop')).toBe('1');
  });

  it('gives sum-of-products and product-of-sums that agree with the function', () => {
    const random = rng(42);
    for (let trial = 0; trial < 60; trial++) {
      const vars = 2 + (trial % 5);
      const cells: Cell[] = Array.from({ length: 1 << vars }, () => {
        const r = random();
        return r < 0.45 ? 1 : r < 0.9 ? 0 : 'x';
      });
      const { sop, pos } = minimise(vars, cells);
      cells.forEach((c, m) => {
        if (c === 'x') return;
        expect(evaluate(sop.terms, m, 'sop'), `sop ${vars} ${m}`).toBe(c === 1);
        expect(evaluate(pos.terms, m, 'pos'), `pos ${vars} ${m}`).toBe(c === 1);
      });
      // Every term is a prime implicant that never covers a 0.
      for (const t of sop.terms) {
        cells.forEach((c, m) => {
          if (covers(t, m)) expect(c).not.toBe(0);
        });
      }
    }
  });

  it('writes expressions for maths, C and Verilog', () => {
    const cover = minimalCover(3, [1, 3, 5, 7]);
    expect(expressionText(cover.terms, ABC, 'sop')).toBe('C');
    const xor = minimise(2, [0, 1, 1, 0]);
    expect(expressionText(xor.sop.terms, ['A', 'B'], 'sop')).toBe('A′·B + A·B′');
    expect(expressionText(xor.sop.terms, ['a', 'b'], 'sop', 'c')).toBe('(!a && b) || (a && !b)');
    expect(expressionText(xor.pos.terms, ['A', 'B'], 'pos')).toBe('(A + B)·(A′ + B′)');
    expect(expressionText(xor.pos.terms, ['a', 'b'], 'pos', 'verilog')).toBe('(a | b) & (~a | ~b)');
  });

  it('reads expressions and minterm lists', () => {
    expect(parseExpression("A'B + AC", ABC).map(Number)).toEqual([0, 0, 1, 1, 0, 1, 0, 1]);
    expect(parseExpression('!(A | B) ^ C', ABC).map(Number)).toEqual([1, 0, 0, 1, 0, 1, 0, 1]);
    expect(parseExpression('A ⊕ B', ['A', 'B']).map(Number)).toEqual([0, 1, 1, 0]);
    expect(() => parseExpression('A + Q', ABC)).toThrow(/Q is not one of the variables/);
    expect(() => parseExpression('(A + B', ABC)).toThrow(/bracket/);
    expect(parseList('m(1, 3, 5-7)', 3)).toEqual([1, 3, 5, 6, 7]);
    expect(() => parseList('9', 3)).toThrow(/not a minterm/);
  });

  it('lays out up to six variables on Gray-coded maps', () => {
    expect(layout(4)).toEqual({ mapBits: 0, rowBits: 2, colBits: 2 });
    expect(layout(6)).toEqual({ mapBits: 2, rowBits: 2, colBits: 2 });
    for (const vars of [2, 3, 4, 5, 6])
      for (let m = 0; m < 1 << vars; m++) {
        const { map, row, col } = cellOf(vars, m);
        expect(mintermAt(vars, map, row, col)).toBe(m);
      }
    // Neighbouring cells differ in one variable, edges included.
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) expect(popcount(mintermAt(4, 0, r, c) ^ mintermAt(4, 0, r, (c + 1) % 4))).toBe(1);
    expect(runs([0, 3], 4)).toEqual([
      [0, 0],
      [3, 3],
    ]);
    expect(runs([1, 2], 4)).toEqual([[1, 2]]);
  });
});

function popcount(v: number): number {
  let n = 0;
  for (let x = v; x; x &= x - 1) n++;
  return n;
}
