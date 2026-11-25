import { describe, expect, it } from 'vitest';
import {
  balance,
  combustionAnalysis,
  empiricalFormula,
  Fraction,
  nullSpace,
  oxidationStates,
  parseComposition,
  parseSpecies,
  speciesText,
  splitTerms,
  stoichiometry,
} from '../../src/lib/chem-balance';
import { ACIDS, cell, convertConcentration, dilution, equilibrium, idealGas, orderFromData, prepareSolution, rateLaw, solvePh, titration, VDW_GASES, vanDerWaals } from '../../src/lib/chem-solve';

const coefficients = (eq: string, options?: Parameters<typeof balance>[1]) => {
  const b = balance(eq, options);
  return [...b.reactants, ...b.products].map((t) => `${t.coefficient} ${t.species.ce}`).join(', ');
};

describe('reading species and equations', () => {
  it('reads charges, states, hydrates and complexes', () => {
    expect(parseSpecies('SO4^2-').charge).toBe(-2);
    expect(parseSpecies('NH4+').charge).toBe(1);
    expect(parseSpecies('Fe{3+}').charge).toBe(3);
    expect(parseSpecies('Fe+3').charge).toBe(3);
    const iron = parseSpecies('Fe3+');
    expect([iron.formula, iron.charge, iron.note]).toEqual(['Fe', 3, 'Fe3+ read as Fe^3+']);
    expect(parseSpecies('H2O(l)').state).toBe('l');
    expect(parseSpecies('e-').electron).toBe(true);
    expect(parseSpecies('CuSO4·5H2O').atoms.get('O')).toBe(9);
    expect(parseSpecies('K4[Fe(CN)6]').atoms.get('C')).toBe(6);
    expect(speciesText(parseSpecies('[Fe(CN)6]^3-'))).toBe('[Fe(CN)₆]³⁻');
    expect(() => parseSpecies('Xy2')).toThrow('not an element');
  });

  it('tells separating pluses from charges', () => {
    expect(splitTerms('NH4+ + OH-')).toEqual(['NH4+', 'OH-']);
    expect(splitTerms('H2+O2')).toEqual(['H2', 'O2']);
    expect(splitTerms('Fe++ + e-')).toEqual(['Fe++', 'e-']);
    expect(splitTerms('Cu + 2Ag+')).toEqual(['Cu', '2Ag+']);
  });

  it('finds null spaces exactly', () => {
    const f = (n: number) => Fraction.of(n);
    const basis = nullSpace(
      [
        [f(2), f(0), f(-2)],
        [f(0), f(2), f(-1)],
      ],
      3,
    );
    expect(basis.map((v) => v.map(String))).toEqual([['1', '1/2', '1']]);
  });
});

describe('balancing', () => {
  it('balances textbook equations', () => {
    expect(coefficients('H2 + O2 -> H2O')).toBe('2 H2, 1 O2, 2 H2O');
    expect(coefficients('C3H8 + O2 -> CO2 + H2O')).toBe('1 C3H8, 5 O2, 3 CO2, 4 H2O');
    expect(coefficients('Fe + O2 -> Fe2O3')).toBe('4 Fe, 3 O2, 2 Fe2O3');
    expect(coefficients('KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2')).toBe('2 KMnO4, 16 HCl, 2 KCl, 2 MnCl2, 8 H2O, 5 Cl2');
    expect(coefficients('Cu + HNO3 -> Cu(NO3)2 + NO + H2O')).toBe('3 Cu, 8 HNO3, 3 Cu(NO3)2, 2 NO, 4 H2O');
    expect(coefficients('K4[Fe(CN)6] + KMnO4 + H2SO4 -> KHSO4 + Fe2(SO4)3 + MnSO4 + HNO3 + CO2 + H2O')).toBe(
      '10 K4[Fe(CN)6], 122 KMnO4, 299 H2SO4, 162 KHSO4, 5 Fe2(SO4)3, 122 MnSO4, 60 HNO3, 60 CO2, 188 H2O',
    );
  });

  it('balances redox in acidic and basic solution, and half-reactions', () => {
    expect(coefficients('MnO4^- + Fe^2+ -> Mn^2+ + Fe^3+', { medium: 'acidic' })).toBe('1 MnO4^-, 5 Fe^2+, 8 H^+, 1 Mn^2+, 5 Fe^3+, 4 H2O');
    expect(coefficients('MnO4^- + I^- -> MnO2 + I2', { medium: 'basic' })).toBe('2 MnO4^-, 6 I^-, 4 H2O, 2 MnO2, 3 I2, 8 OH^-');
    expect(coefficients('Cr2O7^2- -> Cr^3+', { medium: 'acidic', half: true })).toBe('1 Cr2O7^2-, 14 H^+, 6 e-, 2 Cr^3+, 7 H2O');
    const b = balance('MnO4^- + Fe^2+ -> Mn^2+ + Fe^3+', { medium: 'acidic' });
    expect(b.redox.join(' ')).toContain('Mn: +7 in MnO₄⁻ → +2 in Mn²⁺, reduced');
    expect(b.redox.join(' ')).toContain('5 electrons');
    expect(b.table?.rows.find((r) => r[0] === 'Charge')).toEqual(['Charge', '17', '17']);
  });

  it('settles redox reactions that balance in more than one ratio', () => {
    const b = balance('H2O2 + KMnO4 + H2SO4 -> K2SO4 + MnSO4 + O2 + H2O');
    expect([...b.reactants, ...b.products].map((t) => t.coefficient)).toEqual([5, 2, 3, 1, 2, 5, 8]);
    expect(b.unique).toBe(true);
  });

  it('explains what cannot balance', () => {
    expect(() => balance('H2 + O2 -> H2O2 + NaCl')).toThrow('only one side');
    expect(() => balance('H2O -> H2 + O2 + H2O2 + Xq')).toThrow();
    expect(() => balance('H2O + O2')).toThrow('arrow');
  });
});

describe('oxidation states', () => {
  const states = (f: string) => oxidationStates(f).text;
  it('follows the textbook rules', () => {
    expect(states('K2Cr2O7')).toBe('K +1, Cr +6, O −2');
    expect(states('H2O2')).toBe('H +1, O −1');
    expect(states('OF2')).toBe('O +2, F −1');
    expect(states('NaH')).toBe('Na +1, H −1');
    expect(states('Fe3O4')).toBe('Fe +8/3, O −2');
    expect(states('KO2')).toBe('K +1, O −1/2');
    expect(states('NH4+')).toBe('N −3, H +1');
    expect(states('KSCN')).toBe('K +1, S −2, C +4, N −3');
    expect(states('FeSO4')).toBe('Fe +2, S +6, O −2');
    expect(states('Fe2(SO4)3')).toBe('Fe +3, S +6, O −2');
    expect(states('CuSO4·5H2O')).toBe('Cu +2, S +6, O −2, H +1');
    expect(states('K4[Fe(CN)6]')).toBe('K +1, Fe +2, C +2, N −3');
    expect(states('[Cu(NH3)4]SO4')).toBe('Cu +2, N −3, H +1, S +6, O −2');
    expect(states('Cr2O7^2-')).toBe('Cr +6, O −2');
    expect(states('O2')).toBe('O 0');
  });
});

describe('stoichiometry and formulas', () => {
  it('finds the limiting reagent, the products and the yield', () => {
    const b = balance('N2 + H2 -> NH3');
    const r = stoichiometry(b, [{ value: 28, unit: 'g' }, { value: 10, unit: 'g' }, null], { index: 2, grams: 25.5 });
    expect(r.limiting).toBe(0);
    expect(r.table?.rows[2]?.[4]).toBe('34.04 g');
    expect(r.text).toMatch(/^74\.9\d* % yield$/);
  });

  it('works out empirical and molecular formulas', () => {
    const glucose = empiricalFormula(parseComposition('C 40.0, H 6.71, O 53.3'), 180.16);
    expect(glucose.text).toBe('Empirical CH₂O, molecular C₆H₁₂O₆');
    // A ratio of 1 : 1.5 needs doubling.
    expect(empiricalFormula(parseComposition('Fe 69.94 O 30.06')).text).toBe('Empirical formula Fe₂O₃');
    const burnt = combustionAnalysis(0.255, 0.561, 0.306);
    expect(burnt.text).toBe('Empirical formula C₃H₈O');
  });
});

describe('acids, bases and buffers', () => {
  it('works out pH exactly', () => {
    expect(solvePh({ kind: 'strong-acid', c: 0.01 }).value).toBeCloseTo(2, 6);
    expect(solvePh({ kind: 'strong-acid', c: 1e-8 }).value).toBeCloseTo(6.978, 3);
    expect(solvePh({ kind: 'strong-base', c: 0.001 }).value).toBeCloseTo(11, 6);
    const acetic = ACIDS.find((a) => a.name === 'Acetic acid')?.k ?? 0;
    expect(solvePh({ kind: 'weak-acid', c: 0.1, k: acetic }).value).toBeCloseTo(2.88, 2);
    expect(solvePh({ kind: 'weak-base', c: 0.1, k: 1.8e-5 }).value).toBeCloseTo(11.125, 3);
    expect(solvePh({ kind: 'buffer', c: 0.1, cBase: 0.1, k: acetic }).value).toBeCloseTo(4.757, 2);
  });

  it('solves equilibria from K and the starting amounts', () => {
    // H2 + I2 ⇌ 2HI with K = 50.5, 1 M each to start: x = 0.780.
    const r = equilibrium('H2 + I2 <=> HI', 50.5, [1, 1, 0]);
    expect(r.value).toBeCloseTo(0.7804, 3);
    expect(r.check).toContain('equal to K');
    // N2O4 ⇌ 2NO2, K = 4.63e-3, 0.1 M N2O4.
    const n = equilibrium('N2O4 <=> NO2', 4.63e-3, [0.1, 0]);
    expect(n.value).toBeCloseTo(0.01, 3);
    // Solids do not count.
    const s = equilibrium('CaCO3(s) <=> CaO(s) + CO2(g)', 0.25, [1, 0, 0]);
    expect(s.value).toBeCloseTo(0.25, 9);
  });
});

describe('kinetics, titrations, cells, gases and solutions', () => {
  it('uses integrated rate laws and finds the order from data', () => {
    expect(rateLaw(1, Math.LN2 / 10, 1).value).toBeCloseTo(10, 9);
    expect(rateLaw(1, 0.1, 2, 10).value).toBeCloseTo(2 * Math.exp(-1), 9);
    expect(rateLaw(2, 0.5, 1, undefined, 0.5).value).toBeCloseTo(2, 9);
    const t = [0, 10, 20, 30, 40];
    const r = orderFromData(
      t,
      t.map((x) => 1 / (1 / 0.5 + 0.2 * x)),
    );
    expect(r.best.order).toBe(2);
    expect(r.value).toBeCloseTo(0.2, 9);
  });

  it('draws titration curves with the right landmarks', () => {
    const t = titration({ analyte: 'weak-acid', c: 0.1, volume: 25, k: 1.75e-5, titrant: 0.1 });
    expect(t.equivalence).toBeCloseTo(25, 9);
    expect(t.ph(12.5)).toBeCloseTo(4.757, 2);
    expect(t.ph(25)).toBeCloseTo(8.72, 1);
    expect(t.indicator).toBe('Phenolphthalein');
    const strong = titration({ analyte: 'strong-acid', c: 0.1, volume: 25, titrant: 0.1 });
    expect(strong.ph(25)).toBeCloseTo(7, 3);
    expect(strong.ph(0)).toBeCloseTo(1, 3);
  });

  it('works out cell potentials with the Nernst equation', () => {
    const daniell = cell('Cu', 'Zn');
    expect(daniell.value).toBeCloseTo(1.1037, 3);
    expect(daniell.check).toContain('Zn(s) | Zn²⁺(aq) ‖ Cu²⁺(aq) | Cu(s)');
    // [Zn²⁺] 1 M, [Cu²⁺] 0.01 M: E = 1.1037 − (0.025693/2) ln 100.
    const dilute = cell('Cu', 'Zn', { 'Cu^2+(aq)': 0.01 });
    expect(dilute.value).toBeCloseTo(1.1037 - (0.0256926 / 2) * Math.log(100), 4);
    // Given the wrong way round, the half-reactions swap.
    expect(cell('Zn', 'Cu').value).toBeCloseTo(1.1037, 3);
  });

  it('applies the gas laws', () => {
    expect(idealGas({ solveFor: 'V', P: [1, 'atm'], n: 1, T: [0, 'C'] }).value).toBeCloseTo(22.414, 2);
    expect(idealGas({ solveFor: 'P', V: [10, 'L'], n: 2, T: [300, 'K'] }).value).toBeCloseTo(4.9234, 3);
    const co2 = VDW_GASES.find((g) => g.formula === 'CO2');
    if (!co2) throw new Error('CO2 missing');
    const r = vanDerWaals(co2, 1, 1, 300);
    expect(r.value).toBeCloseTo(22.41, 1);
  });

  it('makes up and converts solutions', () => {
    expect(prepareSolution('NaCl', 0.1, 0.5).value).toBeCloseTo(2.922, 2);
    expect(dilution(1, null, 0.1, 500).value).toBeCloseTo(50, 9);
    const c = convertConcentration('NaCl', 'molality', 1, 1.04);
    expect(c.table?.rows[2]?.[1]).toBe('5.521 %');
    expect(() => dilution(0.1, 10, 1, null)).toThrow('stronger');
  });
});
