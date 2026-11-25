import { describe, expect, it } from 'vitest';
import { chiSquare, chiSquareP, complement, cross, type Gene, hardyWeinberg, mutate, mutationEffect, ratio, simulate, transcribe, translate } from '../../src/lib/genetics';

const het = (letter: string, kind: Gene['kind'] = 'complete'): Gene => ({ kind, letter, mother: ['D', 'r'], father: ['D', 'r'] });

describe('genetics', () => {
  it('works Punnett squares for one, two and three genes', () => {
    const mono = cross([het('A')]);
    expect(mono.genotypes.map((g) => `${g.text}:${g.count}`)).toEqual(['Aa:2', 'AA:1', 'aa:1']);
    expect(ratio(mono.phenotypes.map((p) => p.count))).toBe('3 : 1');
    const di = cross([het('A'), het('B')]);
    expect(di.total).toBe(16);
    expect(ratio(di.phenotypes.map((p) => p.count))).toBe('9 : 3 : 3 : 1');
    const tri = cross([het('A'), het('B'), het('C')]);
    expect(tri.total).toBe(64);
    expect(ratio(tri.phenotypes.map((p) => p.count))).toBe('27 : 9 : 9 : 9 : 3 : 3 : 3 : 1');
    expect(ratio(cross([het('R', 'incomplete')]).phenotypes.map((p) => p.count))).toBe('2 : 1 : 1');
  });

  it('handles blood groups and X-linked genes', () => {
    const abo = cross([{ kind: 'abo', letter: 'I', mother: ['A', 'O'], father: ['B', 'O'] }]);
    expect(abo.phenotypes.map((p) => p.text).sort()).toEqual(['blood group A', 'blood group AB', 'blood group B', 'blood group O']);
    expect(abo.genotypes.map((g) => g.text).sort()).toEqual(['Iᴬi', 'IᴬIᴮ', 'Iᴮi', 'ii'].sort());
    const colour = cross([{ kind: 'xlinked', letter: 'B', mother: ['D', 'r'], father: ['D', 'Y'] }]);
    expect(Object.fromEntries(colour.phenotypes.map((p) => [p.text, p.count]))).toEqual({
      'daughter, unaffected': 1,
      'daughter, carrier': 1,
      'son, unaffected': 1,
      'son, affected': 1,
    });
    expect(colour.genotypes.map((g) => g.text)).toContain('XBXb');
    expect(colour.genotypes.map((g) => g.text)).toContain('XbY');
  });

  it('tests fits with chi-square', () => {
    expect(chiSquareP(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquareP(5.991, 2)).toBeCloseTo(0.05, 3);
    expect(chiSquareP(0, 3)).toBe(1);
    const mendel = chiSquare([315, 108, 101, 32], [9, 3, 3, 1]);
    expect(mendel.chi2).toBeCloseTo(0.47, 2);
    expect(mendel.p).toBeCloseTo(0.925, 2);
    expect(mendel.df).toBe(3);
    const hw = hardyWeinberg(25, 50, 25);
    expect(hw.p).toBe(0.5);
    expect(hw.chi2).toBe(0);
    expect(hardyWeinberg(50, 0, 50).pValue).toBeLessThan(1e-6);
  });

  it('runs populations with selection and drift', () => {
    // Without drift, a recessive lethal falls as q / (1 + t q).
    const [line] = simulate({ p0: 0.5, size: Number.POSITIVE_INFINITY, generations: 10, fitness: [1, 1, 0], runs: 1, seed: 1 });
    expect(1 - (line?.[10] ?? 0)).toBeCloseTo(0.5 / (1 + 10 * 0.5), 9);
    // Small populations drift to fixation or loss.
    const lines = simulate({ p0: 0.5, size: 10, generations: 400, fitness: [1, 1, 1], runs: 10, seed: 3 });
    expect(lines.filter((l) => l.at(-1) === 0 || l.at(-1) === 1).length).toBeGreaterThanOrEqual(8);
    // The same seed gives the same history.
    expect(simulate({ p0: 0.3, size: 50, generations: 20, fitness: [1, 1, 1], runs: 2, seed: 9 })).toEqual(simulate({ p0: 0.3, size: 50, generations: 20, fitness: [1, 1, 1], runs: 2, seed: 9 }));
  });

  it('reads DNA into protein and classifies mutations', () => {
    const gene = 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG';
    expect(transcribe('ATGC')).toBe('AUGC');
    expect(complement('ATGC')).toBe('TACG');
    const t = translate(gene);
    expect(t.protein).toBe('MAIVMGR');
    expect(t.stopped).toBe(true);
    const silent = { kind: 'substitute', at: 5, base: 'A' } as const;
    expect(mutationEffect(t, translate(mutate(gene, silent)), silent)).toMatch(/^silent/);
    const missense = { kind: 'substitute', at: 9, base: 'T' } as const;
    expect(mutationEffect(t, translate(mutate(gene, missense)), missense)).toMatch(/^missense: 1 amino acid changed/);
    const short = 'ATGAAATGGTAA';
    const nonsense = { kind: 'substitute', at: 8, base: 'A' } as const;
    expect(mutationEffect(translate(short), translate(mutate(short, nonsense)), nonsense)).toMatch(/^nonsense/);
    const insertion = { kind: 'insert', at: 4, base: 'G' } as const;
    expect(mutationEffect(t, translate(mutate(gene, insertion)), insertion)).toMatch(/^frameshift/);
  });
});
