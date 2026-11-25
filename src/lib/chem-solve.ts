/**
 * Chemistry calculations with worked steps: pH of acids, bases and buffers
 * (solved exactly, with water's own ions, and compared with the textbook
 * shortcuts), equilibrium ICE tables, rate laws and reaction order from
 * data, titration curves, galvanic cells and the Nernst equation, gas laws
 * (ideal and van der Waals) and solution concentrations.
 *
 * Constants are CODATA 2018; acid and base constants and standard reduction
 * potentials are the usual 25 °C textbook values (CRC Handbook).
 */
import { balance, type ChemResult, equationTex, equationText, parseEquation, parseSpecies, type Species, type Step, sig, sigTex, speciesMass, speciesText, type Term } from './chem-balance';

export const R = 8.314462618;
export const R_LATM = 0.082057366;
export const R_LBAR = 0.0831446262;
export const FARADAY = 96485.33212;
export const KW = 1.0e-14;

/* -------------------------------------------------------------- solving -- */

/** Root of an increasing function between lo and hi by bisection. */
function bisectIncreasing(f: (x: number) => number, lo: number, hi: number, iterations = 200): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    if (m === a || m === b) break;
    if (f(m) < 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** [H⁺] from a charge balance f(h) that increases with h: solved on a log scale from pH −2 to 16. */
function solveH(f: (h: number) => number): number {
  return 10 ** bisectIncreasing((logh) => f(10 ** logh), -16, 2);
}

const pOf = (x: number) => -Math.log10(x);

/* ---------------------------------------------------------------------- pH -- */

export interface WeakElectrolyte {
  readonly name: string;
  readonly formula: string;
  readonly k: number;
}

/** Acid dissociation constants at 25 °C. */
export const ACIDS: readonly WeakElectrolyte[] = [
  { name: 'Acetic acid', formula: 'CH3COOH', k: 1.75e-5 },
  { name: 'Formic acid', formula: 'HCOOH', k: 1.8e-4 },
  { name: 'Benzoic acid', formula: 'C6H5COOH', k: 6.3e-5 },
  { name: 'Lactic acid', formula: 'C3H6O3', k: 1.4e-4 },
  { name: 'Hydrofluoric acid', formula: 'HF', k: 6.8e-4 },
  { name: 'Nitrous acid', formula: 'HNO2', k: 5.6e-4 },
  { name: 'Hypochlorous acid', formula: 'HClO', k: 3.0e-8 },
  { name: 'Hydrocyanic acid', formula: 'HCN', k: 6.2e-10 },
  { name: 'Ammonium ion', formula: 'NH4^+', k: 5.6e-10 },
  { name: 'Carbonic acid (first step)', formula: 'H2CO3', k: 4.5e-7 },
  { name: 'Phosphoric acid (first step)', formula: 'H3PO4', k: 6.9e-3 },
  { name: 'Dihydrogen phosphate', formula: 'H2PO4^-', k: 6.2e-8 },
];

/** Base dissociation constants at 25 °C. */
export const BASES: readonly WeakElectrolyte[] = [
  { name: 'Ammonia', formula: 'NH3', k: 1.8e-5 },
  { name: 'Methylamine', formula: 'CH3NH2', k: 4.4e-4 },
  { name: 'Pyridine', formula: 'C5H5N', k: 1.7e-9 },
  { name: 'Aniline', formula: 'C6H5NH2', k: 4.3e-10 },
  { name: 'Acetate ion', formula: 'CH3COO^-', k: 5.7e-10 },
  { name: 'Carbonate ion', formula: 'CO3^2-', k: 2.1e-4 },
];

export type PhKind = 'strong-acid' | 'strong-base' | 'weak-acid' | 'weak-base' | 'buffer';

export interface PhProblem {
  readonly kind: PhKind;
  /** Concentration of the acid or base (mol/L); for a buffer, of the weak acid. */
  readonly c: number;
  /** Ka (weak acid, buffer) or Kb (weak base). */
  readonly k?: number;
  /** Buffer: concentration of the conjugate base. */
  readonly cBase?: number;
}

const ice = (head: readonly string[], rows: readonly (readonly string[])[]) =>
  `\\begin{array}{l${'c'.repeat(head.length)}} & ${head.map((h) => `\\ce{${h}}`).join(' & ')} \\\\ \\hline ${rows.map((r) => r.join(' & ')).join(' \\\\ ')} \\end{array}`;

export function solvePh(p: PhProblem): ChemResult {
  const { c } = p;
  if (!(c > 0)) throw new Error('Give a concentration above zero.');
  const steps: Step[] = [];
  let h: number;
  let note: string | undefined;
  const result = (hh: number, check: string): ChemResult => {
    const pH = pOf(hh);
    const oh = KW / hh;
    return {
      ok: true,
      tex: `\\mathrm{pH} = ${pH.toFixed(2)}`,
      text: `pH ${pH.toFixed(2)}`,
      value: pH,
      steps,
      check,
      table: {
        head: ['Quantity', 'Value'],
        rows: [
          ['[H⁺]', `${sig(hh, 4)} mol/L`],
          ['[OH⁻]', `${sig(oh, 4)} mol/L`],
          ['pH', pH.toFixed(3)],
          ['pOH', pOf(oh).toFixed(3)],
        ],
      },
      ...(note ? { note } : {}),
    };
  };
  switch (p.kind) {
    case 'strong-acid': {
      steps.push({ rule: 'A strong acid gives up all its H⁺', tex: `[\\ce{H+}] \\approx c = ${sigTex(c)}\\ \\mathrm{mol/L}` });
      h = (c + Math.sqrt(c * c + 4 * KW)) / 2;
      if (c < 1e-6) steps.push({ rule: 'So dilute that water’s own H⁺ matters: solve [H⁺]² − c[H⁺] − K_w = 0', tex: `[\\ce{H+}] = \\frac{c + \\sqrt{c^2 + 4K_w}}{2} = ${sigTex(h)}` });
      steps.push({ rule: 'pH is minus the logarithm of [H⁺]', tex: `\\mathrm{pH} = -\\log_{10}(${sigTex(h)}) = ${pOf(h).toFixed(2)}` });
      if (c > 1) note = 'Above about 1 mol/L, activities differ from concentrations and real pH values are lower than this.';
      return result(h, 'Checked: [H⁺][OH⁻] = K_w and the charges balance.');
    }
    case 'strong-base': {
      const oh = (c + Math.sqrt(c * c + 4 * KW)) / 2;
      h = KW / oh;
      steps.push({ rule: 'A strong base gives all its OH⁻', tex: `[\\ce{OH-}] ${c < 1e-6 ? '=' : '\\approx'} ${sigTex(oh)}\\ \\mathrm{mol/L}` });
      steps.push({ rule: 'pOH, then pH = 14 − pOH', tex: `\\mathrm{pOH} = ${pOf(oh).toFixed(2)},\\quad \\mathrm{pH} = 14 - ${pOf(oh).toFixed(2)} = ${pOf(h).toFixed(2)}` });
      return result(h, 'Checked: [H⁺][OH⁻] = K_w and the charges balance.');
    }
    case 'weak-acid': {
      const ka = p.k ?? Number.NaN;
      if (!(ka > 0)) throw new Error('Give Ka (or pKa) for the weak acid.');
      steps.push({
        rule: 'The acid ionises only partly',
        tex: `\\ce{HA <=> H+ + A-},\\quad K_a = \\frac{[\\ce{H+}][\\ce{A-}]}{[\\ce{HA}]} = ${sigTex(ka)}\\quad (\\mathrm{p}K_a = ${pOf(ka).toFixed(2)})`,
      });
      steps.push({
        rule: 'ICE table, with x the H⁺ formed',
        tex: ice(
          ['HA', 'H+', 'A-'],
          [
            ['\\text{Initial}', sigTex(c), '0', '0'],
            ['\\text{Change}', '-x', '+x', '+x'],
            ['\\text{Equilibrium}', `${sigTex(c)} - x`, 'x', 'x'],
          ],
        ),
      });
      const x = (-ka + Math.sqrt(ka * ka + 4 * ka * c)) / 2;
      steps.push({ rule: 'So x² / (c − x) = Ka: solve the quadratic x² + Ka·x − Ka·c = 0', tex: `x = \\frac{-K_a + \\sqrt{K_a^2 + 4K_a c}}{2} = ${sigTex(x)}` });
      const shortcut = Math.sqrt(ka * c);
      steps.push({
        rule: `The shortcut x ≈ √(Ka·c) gives ${sig(shortcut, 3)}: ${(Math.abs(shortcut - x) / x) * 100 < 5 ? 'within 5 %, so it would do here' : 'off by more than 5 %, so the quadratic is needed'}`,
        tex: `\\sqrt{K_a c} = ${sigTex(shortcut)}\\quad (${sig((Math.abs(shortcut - x) / x) * 100, 2)}\\%\\ \\text{off})`,
      });
      h = solveH((hh) => hh - KW / hh - (c * ka) / (ka + hh));
      if (Math.abs(pOf(h) - pOf(x)) > 0.005)
        steps.push({ rule: 'Water’s own ions are not negligible here: solving the full charge balance', tex: `[\\ce{H+}] = [\\ce{OH-}] + [\\ce{A-}] \\;\\Rightarrow\\; [\\ce{H+}] = ${sigTex(h)}` });
      steps.push({ rule: 'pH, and the share of the acid ionised', tex: `\\mathrm{pH} = ${pOf(h).toFixed(2)},\\quad \\frac{[\\ce{A-}]}{c} = ${sig((ka / (ka + h)) * 100, 3)}\\%` });
      return result(h, 'Checked: the equilibrium concentrations give back Ka, and the charges balance.');
    }
    case 'weak-base': {
      const kb = p.k ?? Number.NaN;
      if (!(kb > 0)) throw new Error('Give Kb (or pKb) for the weak base.');
      steps.push({ rule: 'The base takes H⁺ from water, partly', tex: `\\ce{B + H2O <=> BH+ + OH-},\\quad K_b = \\frac{[\\ce{BH+}][\\ce{OH-}]}{[\\ce{B}]} = ${sigTex(kb)}` });
      steps.push({
        rule: 'ICE table, with x the OH⁻ formed',
        tex: ice(
          ['B', 'BH+', 'OH-'],
          [
            ['\\text{Initial}', sigTex(c), '0', '0'],
            ['\\text{Change}', '-x', '+x', '+x'],
            ['\\text{Equilibrium}', `${sigTex(c)} - x`, 'x', 'x'],
          ],
        ),
      });
      const x = (-kb + Math.sqrt(kb * kb + 4 * kb * c)) / 2;
      steps.push({ rule: 'Solve x² + Kb·x − Kb·c = 0', tex: `x = [\\ce{OH-}] = ${sigTex(x)},\\quad \\mathrm{pOH} = ${pOf(x).toFixed(2)}` });
      const kac = KW / kb;
      h = solveH((hh) => hh + (c * hh) / (hh + kac) - KW / hh);
      steps.push({ rule: 'pH = 14 − pOH (solved with water’s own ions included)', tex: `\\mathrm{pH} = ${pOf(h).toFixed(2)}` });
      return result(h, 'Checked: the equilibrium concentrations give back Kb, and the charges balance.');
    }
    case 'buffer': {
      const ka = p.k ?? Number.NaN;
      const cb = p.cBase ?? Number.NaN;
      if (!(ka > 0) || !(cb > 0)) throw new Error('Give Ka (or pKa) and the concentrations of the acid and of its conjugate base.');
      const hh = pOf(ka) + Math.log10(cb / c);
      steps.push({ rule: 'Henderson–Hasselbalch: pH = pKa + log([A⁻]/[HA])', tex: `\\mathrm{pH} = ${pOf(ka).toFixed(2)} + \\log_{10}\\frac{${sigTex(cb)}}{${sigTex(c)}} = ${hh.toFixed(2)}` });
      h = solveH((x) => x + cb - KW / x - ((c + cb) * ka) / (ka + x));
      steps.push({ rule: 'Solved exactly, with the acid’s own ionisation and water included', tex: `\\mathrm{pH} = ${pOf(h).toFixed(2)}` });
      const capacity = (Math.LN10 * ((c + cb) * ka * h)) / (ka + h) ** 2;
      steps.push({
        rule: 'Buffer capacity: the base (mol/L) needed to raise the pH by one unit, near here',
        tex: `\\beta \\approx 2.303\\,\\frac{C K_a [\\ce{H+}]}{(K_a + [\\ce{H+}])^2} = ${sigTex(capacity, 3)}\\ \\mathrm{mol/L}`,
      });
      if (Math.abs(Math.log10(cb / c)) > 1) note = 'The ratio is beyond 10:1, so this mixture buffers poorly.';
      return result(
        h,
        Math.abs(pOf(h) - hh) < 0.02
          ? 'Checked: the exact pH agrees with Henderson–Hasselbalch.'
          : 'The exact pH differs from Henderson–Hasselbalch: the solution is too dilute or the acid too strong for the shortcut.',
      );
    }
  }
}

/* ------------------------------------------------------- equilibrium (ICE) -- */

/**
 * Equilibrium concentrations from K and the starting amounts: the extent x
 * solves Q(x) = K, found on the range where no concentration goes negative
 * (Q rises steadily with x there).  Solids and liquids do not enter K.
 */
export function equilibrium(equation: string, K: number, initial: readonly number[]): ChemResult & { readonly terms: readonly Term[] } {
  if (!(K > 0)) throw new Error('K must be above zero.');
  const b = balance(equation.replace(/->|→|=(?!>)/, '<=>'));
  const terms = [...b.reactants, ...b.products];
  const nR = b.reactants.length;
  const counts = terms.map((t) => (t.species.state === 's' || t.species.state === 'l' ? 0 : t.coefficient));
  const c0 = terms.map((_, i) => Math.max(0, initial[i] ?? 0));
  const signed = (i: number) => (i < nR ? -1 : 1) * (terms[i] as Term).coefficient;
  let lo = -Infinity;
  let hi = Infinity;
  terms.forEach((_, i) => {
    if (!counts[i]) return;
    const s = signed(i);
    const bound = -(c0[i] as number) / s;
    if (s < 0) hi = Math.min(hi, bound);
    else lo = Math.max(lo, bound);
  });
  const lnQ = (x: number) => terms.reduce((acc, _, i) => acc + (counts[i] ? (counts[i] as number) * (i < nR ? -1 : 1) * Math.log((c0[i] as number) + signed(i) * x) : 0), 0);
  // A solid on one side sets no limit: widen the range until Q passes K.
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) throw new Error('Nothing in the equilibrium expression changes: give a gas or a dissolved species.');
  if (!Number.isFinite(hi)) {
    hi = Math.max(lo, 0) + 1;
    for (let i = 0; i < 400 && lnQ(hi) < Math.log(K); i++) hi *= 2;
  }
  if (!Number.isFinite(lo)) {
    lo = Math.min(hi, 0) - 1;
    for (let i = 0; i < 400 && lnQ(lo) > Math.log(K); i++) lo *= 2;
  }
  if (!(hi > lo)) throw new Error('Give starting concentrations: at least one reactant or one product must be present.');
  const x = bisectIncreasing((t) => lnQ(t) - Math.log(K), lo, hi, 400);
  const eq = terms.map((_, i) => (c0[i] as number) + signed(i) * x);
  const steps: Step[] = [];
  const conc = (i: number) => `[\\ce{${(terms[i] as Term).species.ce.replace(/\((aq|g)\)$/, '')}}]`;
  const factor = (i: number) => `${conc(i)}${(terms[i] as Term).coefficient === 1 ? '' : `^{${(terms[i] as Term).coefficient}}`}`;
  const inK = terms.map((_, i) => i).filter((i) => counts[i]);
  const top = inK.filter((i) => i >= nR);
  const bottom = inK.filter((i) => i < nR);
  steps.push({
    rule: 'The balanced equation and its equilibrium expression (solids and liquids left out)',
    tex: `${b.tex},\\quad K = \\frac{${top.map(factor).join('') || '1'}}{${bottom.map(factor).join('') || '1'}} = ${sigTex(K)}`,
  });
  const q0parts = inK.map((i) => (c0[i] as number) ** ((counts[i] as number) * (i < nR ? -1 : 1)));
  const Q0 = q0parts.reduce((a, v) => a * v, 1);
  steps.push({
    rule:
      Number.isFinite(Q0) && Q0 > 0
        ? `At the start Q = ${sig(Q0, 3)}, ${Q0 < K ? 'below K: the reaction runs forward' : Q0 > K ? 'above K: the reaction runs backward' : 'equal to K: already at equilibrium'}`
        : Q0 === 0
          ? 'At the start there are no products: the reaction runs forward'
          : 'At the start there are no reactants: the reaction runs backward',
    tex: `Q_0 = ${Number.isFinite(Q0) ? sigTex(Q0) : '\\infty'}`,
  });
  const change = (i: number) => {
    const s = signed(i);
    return counts[i] === 0 ? '\\text{—}' : `${s > 0 ? '+' : '-'}${Math.abs(s) === 1 ? '' : Math.abs(s)}x`;
  };
  steps.push({
    rule: 'ICE table, with x the extent of reaction',
    tex: ice(
      terms.map((t) => t.species.ce),
      [
        ['\\text{Initial}', ...terms.map((_, i) => (counts[i] ? sigTex(c0[i] as number) : '\\text{—}'))],
        ['\\text{Change}', ...terms.map((_, i) => change(i))],
        ['\\text{Equilibrium}', ...terms.map((_, i) => (counts[i] ? `${sigTex(c0[i] as number)} ${change(i)}` : '\\text{—}'))],
      ],
    ),
  });
  const xTerm = (i: number) => {
    const s = signed(i);
    const base = `${c0[i] ? sigTex(c0[i] as number) : ''}${s > 0 ? (c0[i] ? ' + ' : '') : ' - '}${Math.abs(s) === 1 ? '' : Math.abs(s)}x`;
    return `(${base})${counts[i] === 1 ? '' : `^{${counts[i]}}`}`;
  };
  steps.push({
    rule: 'Put the equilibrium amounts into K and solve for x (bisection on the range where nothing goes negative)',
    tex: `${sigTex(K)} = \\frac{${top.map(xTerm).join('') || '1'}}{${bottom.map(xTerm).join('') || '1'}} \\;\\Rightarrow\\; x = ${sigTex(x, 5)}`,
  });
  const Qfinal = Math.exp(lnQ(x));
  return {
    ok: true,
    tex: inK.map((i) => `${conc(i)} = ${sigTex(eq[i] as number)}`).join(',\\quad '),
    text: inK.map((i) => `[${speciesText((terms[i] as Term).species)}] = ${sig(eq[i] as number)}`).join(', '),
    steps,
    check: `Checked: these concentrations give Q = ${sig(Qfinal, 5)}, equal to K.`,
    table: {
      head: ['Species', 'Initial', 'Change', 'Equilibrium'],
      rows: terms.map((t, i) => [
        speciesText(t.species),
        counts[i] ? sig(c0[i] as number) : '—',
        counts[i] ? `${signed(i) > 0 ? '+' : '−'}${sig(Math.abs(signed(i) * x))}` : '—',
        counts[i] ? sig(eq[i] as number) : '—',
      ]),
    },
    value: x,
    terms,
    ...(K > 1e10 || K < 1e-10 ? { note: 'K is extreme, so one side is almost used up: small concentrations are found to the precision of floating point.' } : {}),
  };
}

/* --------------------------------------------------------------- kinetics -- */

export type Order = 0 | 1 | 2;

/** Integrated rate laws: [A] after a time, the time to reach a concentration, and the half-life. */
export function rateLaw(order: Order, k: number, a0: number, t?: number, a?: number): ChemResult {
  if (!(k > 0) || !(a0 > 0)) throw new Error('Give k and [A]₀ above zero.');
  const steps: Step[] = [];
  const law = order === 0 ? '[A] = [A]_0 - kt' : order === 1 ? '\\ln[A] = \\ln[A]_0 - kt' : '\\frac{1}{[A]} = \\frac{1}{[A]_0} + kt';
  const half = order === 0 ? a0 / (2 * k) : order === 1 ? Math.LN2 / k : 1 / (k * a0);
  const units = order === 0 ? 'mol L⁻¹ s⁻¹' : order === 1 ? 's⁻¹' : 'L mol⁻¹ s⁻¹';
  steps.push({ rule: `The ${['zero', 'first', 'second'][order]}-order integrated rate law (k in ${units}, with times in the same unit)`, tex: law });
  steps.push({ rule: 'The half-life', tex: `t_{1/2} = ${order === 0 ? '\\frac{[A]_0}{2k}' : order === 1 ? '\\frac{\\ln 2}{k}' : '\\frac{1}{k[A]_0}'} = ${sigTex(half)}` });
  const atTime = (tt: number) => (order === 0 ? Math.max(0, a0 - k * tt) : order === 1 ? a0 * Math.exp(-k * tt) : 1 / (1 / a0 + k * tt));
  let tex = `t_{1/2} = ${sigTex(half)}`;
  let text = `half-life ${sig(half)}`;
  let value = half;
  if (t !== undefined && Number.isFinite(t) && t >= 0) {
    const at = atTime(t);
    steps.push({
      rule: `After t = ${sig(t)}`,
      tex: `[A] = ${order === 0 ? `${sigTex(a0)} - ${sigTex(k)} \\times ${sigTex(t)}` : order === 1 ? `${sigTex(a0)}\\,e^{-${sigTex(k)} \\times ${sigTex(t)}}` : `\\left(\\frac{1}{${sigTex(a0)}} + ${sigTex(k)} \\times ${sigTex(t)}\\right)^{-1}`} = ${sigTex(at)}`,
    });
    if (order === 0 && a0 - k * t < 0) steps.push({ rule: 'A zero-order reaction stops when A runs out', tex: `t_{\\text{end}} = [A]_0/k = ${sigTex(a0 / k)}` });
    tex = `[A] = ${sigTex(at)}`;
    text = `[A] = ${sig(at)} after ${sig(t)}`;
    value = at;
  } else if (a !== undefined && Number.isFinite(a) && a > 0 && a < a0) {
    const tt = order === 0 ? (a0 - a) / k : order === 1 ? Math.log(a0 / a) / k : (1 / a - 1 / a0) / k;
    steps.push({
      rule: `The time to fall to [A] = ${sig(a)}`,
      tex: `t = ${order === 0 ? '\\frac{[A]_0 - [A]}{k}' : order === 1 ? '\\frac{\\ln([A]_0/[A])}{k}' : '\\frac{1/[A] - 1/[A]_0}{k}'} = ${sigTex(tt)}`,
    });
    tex = `t = ${sigTex(tt)}`;
    text = `t = ${sig(tt)}`;
    value = tt;
  }
  return { ok: true, tex, text, value, steps, check: 'Checked: the concentration at the half-life is half the starting one.' };
}

export interface Fit {
  readonly order: Order;
  readonly slope: number;
  readonly intercept: number;
  readonly r2: number;
}

function linearFit(xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

/** Reaction order from concentrations over time: which of [A], ln[A] and 1/[A] is straightest against t. */
export function orderFromData(t: readonly number[], a: readonly number[]): ChemResult & { readonly fits: readonly Fit[]; readonly best: Fit } {
  if (t.length !== a.length || t.length < 3) throw new Error('Give at least three times, each with its concentration.');
  if (a.some((x) => !(x > 0))) throw new Error('Concentrations must be above zero.');
  const fits: Fit[] = ([0, 1, 2] as Order[]).map((order) => ({
    order,
    ...linearFit(
      t,
      a.map((x) => (order === 0 ? x : order === 1 ? Math.log(x) : 1 / x)),
    ),
  }));
  const best = fits.reduce((p, q) => (q.r2 > p.r2 ? q : p));
  const k = best.order === 2 ? best.slope : -best.slope;
  const a0 = best.order === 0 ? best.intercept : best.order === 1 ? Math.exp(best.intercept) : 1 / best.intercept;
  const steps: Step[] = [
    {
      rule: 'Plot each form against time: the straight one gives the order',
      tex: `\\begin{array}{lll} \\text{zero order: } [A] & R^2 = ${fits[0]?.r2.toFixed(5)} \\\\ \\text{first order: } \\ln[A] & R^2 = ${fits[1]?.r2.toFixed(5)} \\\\ \\text{second order: } 1/[A] & R^2 = ${fits[2]?.r2.toFixed(5)} \\end{array}`,
    },
    { rule: `The ${['zero', 'first', 'second'][best.order]}-order plot is the straightest; k from its slope`, tex: `k = ${best.order === 2 ? '' : '-'}\\text{slope} = ${sigTex(k)}` },
    { rule: 'The half-life (at the fitted starting concentration)', tex: `t_{1/2} = ${sigTex(best.order === 0 ? a0 / (2 * k) : best.order === 1 ? Math.LN2 / k : 1 / (k * a0))}` },
  ];
  const close = fits.filter((f) => f !== best && best.r2 - f.r2 < 0.002);
  return {
    ok: true,
    tex: `\\text{order } ${best.order},\\quad k = ${sigTex(k)}`,
    text: `order ${best.order}, k = ${sig(k)}`,
    value: k,
    steps,
    check: `R² = ${best.r2.toFixed(5)} for the straight-line fit.`,
    table: { head: ['t', '[A]', 'ln[A]', '1/[A]'], rows: t.map((x, i) => [sig(x), sig(a[i] as number), sig(Math.log(a[i] as number), 5), sig(1 / (a[i] as number), 5)]) },
    fits,
    best,
    ...(close.length ? { note: 'Another order fits almost as well: measure over a longer time (two or three half-lives) to tell them apart.' } : {}),
  };
}

/* -------------------------------------------------------------- titration -- */

export type Analyte = 'strong-acid' | 'weak-acid' | 'strong-base' | 'weak-base';

export interface TitrationInput {
  readonly analyte: Analyte;
  /** mol/L of the analyte. */
  readonly c: number;
  /** mL of analyte. */
  readonly volume: number;
  /** Ka (weak acid) or Kb (weak base). */
  readonly k?: number;
  /** mol/L of the strong titrant (NaOH for acids, HCl for bases). */
  readonly titrant: number;
}

export interface TitrationResult extends ChemResult {
  readonly ph: (v: number) => number;
  readonly equivalence: number;
  readonly maxVolume: number;
  readonly points: readonly { readonly v: number; readonly ph: number; readonly label: string }[];
  readonly indicator: string;
}

export const INDICATORS: readonly { name: string; from: number; to: number }[] = [
  { name: 'Methyl orange', from: 3.1, to: 4.4 },
  { name: 'Methyl red', from: 4.4, to: 6.2 },
  { name: 'Bromothymol blue', from: 6.0, to: 7.6 },
  { name: 'Phenol red', from: 6.8, to: 8.4 },
  { name: 'Phenolphthalein', from: 8.2, to: 10.0 },
  { name: 'Thymolphthalein', from: 9.3, to: 10.5 },
];

/** pH along a titration with a strong acid or base, from the full charge balance at each volume. */
export function titration(input: TitrationInput): TitrationResult {
  const { analyte, c, volume: va, titrant: ct } = input;
  if (!(c > 0) || !(va > 0) || !(ct > 0)) throw new Error('Give the concentrations and the volume, all above zero.');
  const weak = analyte === 'weak-acid' || analyte === 'weak-base';
  const k = input.k ?? Number.NaN;
  if (weak && !(k > 0)) throw new Error(`Give ${analyte === 'weak-acid' ? 'Ka' : 'Kb'} for the weak ${analyte === 'weak-acid' ? 'acid' : 'base'}.`);
  const acid = analyte === 'strong-acid' || analyte === 'weak-acid';
  const ka = analyte === 'weak-acid' ? k : analyte === 'weak-base' ? KW / k : Number.POSITIVE_INFINITY;
  const ph = (v: number) => {
    const total = va + v;
    const cA = (c * va) / total;
    const cT = (ct * v) / total;
    const h = acid ? solveH((x) => x + cT - KW / x - (Number.isFinite(ka) ? (cA * ka) / (ka + x) : cA)) : solveH((x) => x + (Number.isFinite(ka) ? (cA * x) / (x + ka) : cA) - KW / x - cT);
    return pOf(h);
  };
  const ve = (c * va) / ct;
  const maxVolume = 2 * ve;
  const pe = ph(ve);
  const indicator = INDICATORS.filter((i) => pe >= i.from - 0.3 && pe <= i.to + 0.3).sort((p, q) => Math.abs((p.from + p.to) / 2 - pe) - Math.abs((q.from + q.to) / 2 - pe))[0]?.name ?? 'a pH meter';
  const points = [
    { v: 0, ph: ph(0), label: 'start' },
    ...(weak ? [{ v: ve / 2, ph: ph(ve / 2), label: 'half-way' }] : []),
    { v: ve, ph: pe, label: 'equivalence' },
    { v: maxVolume, ph: ph(maxVolume), label: 'twice' },
  ];
  const what = acid ? 'NaOH' : 'HCl';
  const steps: Step[] = [
    {
      rule: 'Equivalence: the moles of titrant equal the moles of analyte',
      tex: `V_e = \\frac{c\\,V}{c_t} = \\frac{${sigTex(c)} \\times ${sigTex(va)}}{${sigTex(ct)}} = ${sigTex(ve)}\\ \\mathrm{mL}`,
    },
    { rule: 'At the start', tex: `\\mathrm{pH} = ${points[0]?.ph.toFixed(2)}` },
  ];
  if (weak)
    steps.push({
      rule: `Half-way to equivalence, half the ${acid ? 'acid' : 'base'} is converted: ${acid ? 'pH = pKa' : 'pOH = pKb'} (Henderson–Hasselbalch with a 1:1 ratio)`,
      tex: `\\mathrm{pH} = ${ph(ve / 2).toFixed(2)}${acid ? `\\quad (\\mathrm{p}K_a = ${pOf(k).toFixed(2)})` : `\\quad (14 - \\mathrm{p}K_b = ${(14 - pOf(k)).toFixed(2)})`}`,
    });
  steps.push({
    rule: weak ? `At equivalence only the conjugate ${acid ? 'base' : 'acid'} is left, so the pH is ${acid ? 'above' : 'below'} 7` : 'At equivalence a strong acid and base leave a neutral salt',
    tex: `\\mathrm{pH} = ${pe.toFixed(2)}`,
  });
  steps.push({ rule: `Past equivalence the excess ${what} sets the pH`, tex: `\\mathrm{pH}(2V_e) = ${points[points.length - 1]?.ph.toFixed(2)}` });
  steps.push({
    rule: 'Each point solves the full charge balance after dilution',
    tex: acid ? `[\\ce{H+}] + [\\ce{Na+}] = [\\ce{OH-}] + [\\ce{A-}]` : `[\\ce{H+}] + [\\ce{BH+}] = [\\ce{OH-}] + [\\ce{Cl-}]`,
  });
  return {
    ok: true,
    tex: `V_e = ${sigTex(ve)}\\ \\mathrm{mL},\\quad \\mathrm{pH}_e = ${pe.toFixed(2)}`,
    text: `Equivalence at ${sig(ve)} mL, pH ${pe.toFixed(2)}; indicator: ${indicator}`,
    value: ve,
    steps,
    check: `Suggested indicator: ${indicator}${indicator === 'a pH meter' ? ' (no common indicator changes colour at this pH)' : `, which changes colour between pH ${INDICATORS.find((i) => i.name === indicator)?.from} and ${INDICATORS.find((i) => i.name === indicator)?.to}`}.`,
    table: { head: ['Titrant added (mL)', 'pH'], rows: Array.from({ length: 21 }, (_, i) => (i * maxVolume) / 20).map((v) => [sig(v, 4), ph(v).toFixed(2)]) },
    ph,
    equivalence: ve,
    maxVolume,
    points,
    indicator,
  };
}

/* -------------------------------------------------------- electrochemistry -- */

export interface HalfReaction {
  readonly id: string;
  /** As a reduction, in mhchem with states. */
  readonly equation: string;
  readonly e0: number;
}

/** Standard reduction potentials at 25 °C (V), CRC Handbook values. */
export const HALF_REACTIONS: readonly HalfReaction[] = [
  { id: 'F2', equation: 'F2(g) + 2e- -> 2F^-(aq)', e0: 2.866 },
  { id: 'H2O2', equation: 'H2O2(aq) + 2H^+(aq) + 2e- -> 2H2O(l)', e0: 1.776 },
  { id: 'MnO4', equation: 'MnO4^-(aq) + 8H^+(aq) + 5e- -> Mn^2+(aq) + 4H2O(l)', e0: 1.507 },
  { id: 'Au', equation: 'Au^3+(aq) + 3e- -> Au(s)', e0: 1.498 },
  { id: 'Cl2', equation: 'Cl2(g) + 2e- -> 2Cl^-(aq)', e0: 1.358 },
  { id: 'Cr2O7', equation: 'Cr2O7^2-(aq) + 14H^+(aq) + 6e- -> 2Cr^3+(aq) + 7H2O(l)', e0: 1.33 },
  { id: 'O2', equation: 'O2(g) + 4H^+(aq) + 4e- -> 2H2O(l)', e0: 1.229 },
  { id: 'Br2', equation: 'Br2(l) + 2e- -> 2Br^-(aq)', e0: 1.066 },
  { id: 'NO3', equation: 'NO3^-(aq) + 4H^+(aq) + 3e- -> NO(g) + 2H2O(l)', e0: 0.957 },
  { id: 'Ag', equation: 'Ag^+(aq) + e- -> Ag(s)', e0: 0.7996 },
  { id: 'Fe3', equation: 'Fe^3+(aq) + e- -> Fe^2+(aq)', e0: 0.771 },
  { id: 'I2', equation: 'I2(s) + 2e- -> 2I^-(aq)', e0: 0.5355 },
  { id: 'O2OH', equation: 'O2(g) + 2H2O(l) + 4e- -> 4OH^-(aq)', e0: 0.401 },
  { id: 'Cu', equation: 'Cu^2+(aq) + 2e- -> Cu(s)', e0: 0.3419 },
  { id: 'AgCl', equation: 'AgCl(s) + e- -> Ag(s) + Cl^-(aq)', e0: 0.2223 },
  { id: 'Sn4', equation: 'Sn^4+(aq) + 2e- -> Sn^2+(aq)', e0: 0.151 },
  { id: 'H2', equation: '2H^+(aq) + 2e- -> H2(g)', e0: 0 },
  { id: 'Pb', equation: 'Pb^2+(aq) + 2e- -> Pb(s)', e0: -0.1262 },
  { id: 'Sn', equation: 'Sn^2+(aq) + 2e- -> Sn(s)', e0: -0.1375 },
  { id: 'Ni', equation: 'Ni^2+(aq) + 2e- -> Ni(s)', e0: -0.257 },
  { id: 'Co', equation: 'Co^2+(aq) + 2e- -> Co(s)', e0: -0.28 },
  { id: 'PbSO4', equation: 'PbSO4(s) + 2e- -> Pb(s) + SO4^2-(aq)', e0: -0.3588 },
  { id: 'Cd', equation: 'Cd^2+(aq) + 2e- -> Cd(s)', e0: -0.403 },
  { id: 'Fe', equation: 'Fe^2+(aq) + 2e- -> Fe(s)', e0: -0.447 },
  { id: 'Cr', equation: 'Cr^3+(aq) + 3e- -> Cr(s)', e0: -0.744 },
  { id: 'Zn', equation: 'Zn^2+(aq) + 2e- -> Zn(s)', e0: -0.7618 },
  { id: 'H2O', equation: '2H2O(l) + 2e- -> H2(g) + 2OH^-(aq)', e0: -0.8277 },
  { id: 'Mn', equation: 'Mn^2+(aq) + 2e- -> Mn(s)', e0: -1.185 },
  { id: 'Al', equation: 'Al^3+(aq) + 3e- -> Al(s)', e0: -1.662 },
  { id: 'Mg', equation: 'Mg^2+(aq) + 2e- -> Mg(s)', e0: -2.372 },
  { id: 'Na', equation: 'Na^+(aq) + e- -> Na(s)', e0: -2.71 },
  { id: 'Ca', equation: 'Ca^2+(aq) + 2e- -> Ca(s)', e0: -2.868 },
  { id: 'K', equation: 'K^+(aq) + e- -> K(s)', e0: -2.931 },
  { id: 'Li', equation: 'Li^+(aq) + e- -> Li(s)', e0: -3.0401 },
];

interface Signed {
  species: Species;
  n: number;
}

/** A half-reaction as coefficients: reactants negative, products positive. */
function halfTerms(h: HalfReaction): { terms: Signed[]; electrons: number } {
  const eq = parseEquation(h.equation);
  const read = (side: string) =>
    side
      .split(/\s+\+\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => {
        const m = /^(\d+)\s*(.*)$/.exec(t);
        return { n: m ? Number(m[1]) : 1, text: m ? (m[2] as string) : t };
      });
  const [l, r] = h.equation.split('->') as [string, string];
  const left = read(l);
  const right = read(r);
  let electrons = 0;
  const terms: Signed[] = [];
  left.forEach((t, i) => {
    const s = eq.reactants[i] as Species;
    if (s.electron) electrons += t.n;
    else terms.push({ species: s, n: -t.n });
  });
  right.forEach((t, i) => {
    terms.push({ species: eq.products[i] as Species, n: t.n });
  });
  return { terms, electrons };
}

export interface CellResult extends ChemResult {
  /** Species whose concentration (aq) or pressure (g) enters Q, in order. */
  readonly variables: readonly Species[];
}

/**
 * A galvanic cell from two half-reactions: the higher potential is reduced
 * (the cathode).  E° = E°cathode − E°anode; the Nernst equation corrects for
 * concentrations (mol/L) and gas pressures (atm) given by ce key.
 */
export function cell(cathodeId: string, anodeId: string, amounts: Readonly<Record<string, number>> = {}, kelvin = 298.15): CellResult {
  let cat = HALF_REACTIONS.find((h) => h.id === cathodeId);
  let an = HALF_REACTIONS.find((h) => h.id === anodeId);
  if (!cat || !an) throw new Error('Choose two half-reactions.');
  if (cat.id === an.id) throw new Error('Choose two different half-reactions.');
  const swapped = an.e0 > cat.e0;
  if (swapped) [cat, an] = [an, cat];
  const c = halfTerms(cat);
  const a = halfTerms(an);
  const n = (c.electrons * a.electrons) / gcdInt(c.electrons, a.electrons);
  const net = new Map<string, Signed>();
  const add = (s: Species, k: number) => {
    const key = s.ce;
    const e = net.get(key) ?? { species: s, n: 0 };
    e.n += k;
    net.set(key, e);
  };
  for (const t of c.terms) add(t.species, t.n * (n / c.electrons));
  for (const t of a.terms) add(t.species, -t.n * (n / a.electrons));
  const all = [...net.values()].filter((t) => t.n !== 0);
  const reactants: Term[] = all.filter((t) => t.n < 0).map((t) => ({ species: t.species, coefficient: -t.n }));
  const products: Term[] = all.filter((t) => t.n > 0).map((t) => ({ species: t.species, coefficient: t.n }));
  const e0 = cat.e0 - an.e0;
  const variables = all.filter((t) => t.species.state === 'aq' || t.species.state === 'g').map((t) => t.species);
  let lnQ = 0;
  const qParts: string[] = [];
  const qTop: string[] = [];
  const qBottom: string[] = [];
  for (const t of all) {
    if (t.species.state !== 'aq' && t.species.state !== 'g') continue;
    const value = amounts[t.species.ce] ?? 1;
    if (!(value > 0)) throw new Error(`Give a positive ${t.species.state === 'g' ? 'pressure' : 'concentration'} for ${speciesText(t.species)}.`);
    lnQ += t.n * Math.log(value);
    const f = `${t.species.state === 'g' ? `P_{\\ce{${t.species.ce.replace(/\(g\)$/, '')}}}` : `[\\ce{${t.species.ce.replace(/\(aq\)$/, '')}}]`}${Math.abs(t.n) === 1 ? '' : `^{${Math.abs(t.n)}}`}`;
    (t.n > 0 ? qTop : qBottom).push(f);
    qParts.push(`${speciesText(t.species)} = ${sig(value)}${t.species.state === 'g' ? ' atm' : ' M'}`);
  }
  const RT_nF = (R * kelvin) / (n * FARADAY);
  const E = e0 - RT_nF * lnQ;
  const dG0 = -n * FARADAY * e0;
  const dG = -n * FARADAY * E;
  const K = Math.exp(e0 / RT_nF);
  const electrode = (h: HalfReaction) => {
    const solid = halfTerms(h).terms.find((t) => t.species.state === 's' && t.species.atoms.size === 1);
    return solid ? speciesText(solid.species) : 'Pt(s)';
  };
  const dissolved = (h: HalfReaction) =>
    halfTerms(h)
      .terms.filter((t) => t.species.state === 'aq' || t.species.state === 'g')
      .map((t) => speciesText(t.species))
      .join(', ');
  const notation = `${electrode(an)} | ${dissolved(an)} ‖ ${dissolved(cat)} | ${electrode(cat)}`;
  const steps: Step[] = [
    {
      rule: `Cathode (reduction, the higher E°)${swapped ? ': the two were swapped so the cell runs forward' : ''}`,
      tex: `\\ce{${cat.equation}}\\quad E^\\circ = ${cat.e0 >= 0 ? '+' : ''}${cat.e0}\\ \\mathrm{V}`,
    },
    { rule: 'Anode (oxidation: this half-reaction runs backwards)', tex: `\\ce{${an.equation}}\\quad E^\\circ = ${an.e0 >= 0 ? '+' : ''}${an.e0}\\ \\mathrm{V}` },
    { rule: `Match the electrons (${n}) and add`, tex: equationTex(reactants, products) },
    { rule: 'Standard cell potential', tex: `E^\\circ_{\\text{cell}} = E^\\circ_{\\text{cathode}} - E^\\circ_{\\text{anode}} = ${cat.e0} - (${an.e0}) = ${e0.toFixed(4)}\\ \\mathrm{V}` },
  ];
  if (qTop.length || qBottom.length) {
    steps.push({ rule: `The reaction quotient (${qParts.join(', ')})`, tex: `Q = \\frac{${qTop.join('') || '1'}}{${qBottom.join('') || '1'}} = ${sigTex(Math.exp(lnQ))}` });
    steps.push({
      rule: `The Nernst equation at ${sig(kelvin, 5)} K`,
      tex: `E = E^\\circ - \\frac{RT}{nF}\\ln Q = ${e0.toFixed(4)} - \\frac{${sig(R, 6)} \\times ${sig(kelvin, 5)}}{${n} \\times ${FARADAY}}\\ln(${sigTex(Math.exp(lnQ))}) = ${E.toFixed(4)}\\ \\mathrm{V}`,
    });
  }
  steps.push({ rule: 'Free energy and the equilibrium constant', tex: `\\Delta G^\\circ = -nFE^\\circ = ${sigTex(dG0 / 1000)}\\ \\mathrm{kJ/mol},\\quad K = e^{nFE^\\circ/RT} = ${sigTex(K)}` });
  return {
    ok: true,
    tex: `E_{\\text{cell}} = ${E.toFixed(3)}\\ \\mathrm{V}`,
    text: `E = ${E.toFixed(3)} V (E° = ${e0.toFixed(3)} V)`,
    value: E,
    steps,
    check: `${E > 0 ? 'Positive: the cell reaction runs as written (a galvanic cell).' : 'Negative: as written the reaction needs electrical work (an electrolytic cell).'} Cell notation: ${notation}.`,
    table: {
      head: ['Quantity', 'Value'],
      rows: [
        ['E°cell', `${e0.toFixed(4)} V`],
        ['E', `${E.toFixed(4)} V`],
        ['Electrons, n', String(n)],
        ['ΔG°', `${sig(dG0 / 1000, 4)} kJ/mol`],
        ['ΔG', `${sig(dG / 1000, 4)} kJ/mol`],
        ['K', sig(K, 4)],
        ['Overall', equationText(reactants, products)],
        ['Cell notation', notation],
      ],
    },
    variables,
  };
}

function gcdInt(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/* ---------------------------------------------------------------- gases -- */

export type PressureUnit = 'atm' | 'kPa' | 'bar' | 'mmHg' | 'Pa' | 'psi';
export type VolumeUnit = 'L' | 'mL' | 'm3';
export type TemperatureUnit = 'K' | 'C' | 'F';

const PRESSURE: Record<PressureUnit, number> = { atm: 1, kPa: 1 / 101.325, bar: 1 / 1.01325, mmHg: 1 / 760, Pa: 1 / 101325, psi: 1 / 14.6959488 };
const VOLUME: Record<VolumeUnit, number> = { L: 1, mL: 0.001, m3: 1000 };
const toKelvin = (v: number, u: TemperatureUnit) => (u === 'K' ? v : u === 'C' ? v + 273.15 : ((v - 32) * 5) / 9 + 273.15);
const fromKelvin = (k: number, u: TemperatureUnit) => (u === 'K' ? k : u === 'C' ? k - 273.15 : ((k - 273.15) * 9) / 5 + 32);

export interface GasInput {
  readonly solveFor: 'P' | 'V' | 'n' | 'T';
  readonly P?: readonly [number, PressureUnit];
  readonly V?: readonly [number, VolumeUnit];
  readonly n?: number;
  readonly T?: readonly [number, TemperatureUnit];
  /** A formula, to give the mass and density too. */
  readonly formula?: string;
}

/** PV = nRT for whichever of the four is missing. */
export function idealGas(g: GasInput): ChemResult {
  const P = g.P ? g.P[0] * PRESSURE[g.P[1]] : Number.NaN;
  const V = g.V ? g.V[0] * VOLUME[g.V[1]] : Number.NaN;
  const T = g.T ? toKelvin(g.T[0], g.T[1]) : Number.NaN;
  const n = g.n ?? Number.NaN;
  const need = (x: number, what: string) => {
    if (!(x > 0)) throw new Error(`Give ${what} above zero.`);
  };
  const steps: Step[] = [{ rule: 'The ideal gas law, in litres, atmospheres, moles and kelvin', tex: `PV = nRT,\\quad R = ${R_LATM}\\ \\mathrm{L\\,atm\\,mol^{-1}\\,K^{-1}}` }];
  let tex: string;
  let text: string;
  let value: number;
  let moles = n;
  let kelvin = T;
  let pressure = P;
  switch (g.solveFor) {
    case 'P':
      need(V, 'the volume');
      need(n, 'the amount');
      need(T, 'the temperature');
      value = (n * R_LATM * T) / V;
      pressure = value;
      steps.push({ rule: 'Solve for P', tex: `P = \\frac{nRT}{V} = \\frac{${sigTex(n)} \\times ${R_LATM} \\times ${sigTex(T, 5)}}{${sigTex(V)}} = ${sigTex(value)}\\ \\mathrm{atm}` });
      tex = `P = ${sigTex(value)}\\ \\mathrm{atm} = ${sigTex(value * 101.325)}\\ \\mathrm{kPa}`;
      text = `P = ${sig(value)} atm (${sig(value * 101.325)} kPa)`;
      break;
    case 'V':
      need(P, 'the pressure');
      need(n, 'the amount');
      need(T, 'the temperature');
      value = (n * R_LATM * T) / P;
      steps.push({ rule: 'Solve for V', tex: `V = \\frac{nRT}{P} = ${sigTex(value)}\\ \\mathrm{L}` });
      tex = `V = ${sigTex(value)}\\ \\mathrm{L}`;
      text = `V = ${sig(value)} L`;
      break;
    case 'n':
      need(P, 'the pressure');
      need(V, 'the volume');
      need(T, 'the temperature');
      value = (P * V) / (R_LATM * T);
      moles = value;
      steps.push({ rule: 'Solve for n', tex: `n = \\frac{PV}{RT} = ${sigTex(value)}\\ \\mathrm{mol}` });
      tex = `n = ${sigTex(value)}\\ \\mathrm{mol}`;
      text = `n = ${sig(value)} mol`;
      break;
    default:
      need(P, 'the pressure');
      need(V, 'the volume');
      need(n, 'the amount');
      value = (P * V) / (n * R_LATM);
      kelvin = value;
      steps.push({ rule: 'Solve for T', tex: `T = \\frac{PV}{nR} = ${sigTex(value, 5)}\\ \\mathrm{K} = ${sigTex(value - 273.15, 4)}\\ ^\\circ\\mathrm{C}` });
      tex = `T = ${sigTex(value, 5)}\\ \\mathrm{K}\\ (${sigTex(fromKelvin(value, 'C'), 4)}\\ ^\\circ\\mathrm{C})`;
      text = `T = ${sig(value, 5)} K (${sig(fromKelvin(value, 'C'), 4)} °C)`;
  }
  const rows: string[][] = [];
  if (g.formula) {
    const s = parseSpecies(g.formula);
    const M = speciesMass(s);
    const density = (pressure * M) / (R_LATM * kelvin);
    if (Number.isFinite(moles)) rows.push(['Mass', `${sig(moles * M)} g`]);
    if (Number.isFinite(density)) rows.push(['Density', `${sig(density)} g/L`]);
    rows.push(['Molar mass', `${sig(M, 5)} g/mol`]);
    if (Number.isFinite(density))
      steps.push({
        rule: `Density of ${speciesText(s)}: ρ = PM/RT`,
        tex: `\\rho = \\frac{${sigTex(pressure)} \\times ${sigTex(M, 5)}}{${R_LATM} \\times ${sigTex(kelvin, 5)}} = ${sigTex(density)}\\ \\mathrm{g/L}`,
      });
  }
  return { ok: true, tex, text, value, steps, check: 'Checked: PV − nRT = 0 with these values.', ...(rows.length ? { table: { head: ['Quantity', 'Value'], rows } } : {}) };
}

export interface VanDerWaalsGas {
  readonly formula: string;
  readonly name: string;
  /** L² bar mol⁻² */
  readonly a: number;
  /** L mol⁻¹ */
  readonly b: number;
}

/** Van der Waals constants (CRC Handbook). */
export const VDW_GASES: readonly VanDerWaalsGas[] = [
  { formula: 'He', name: 'Helium', a: 0.0346, b: 0.0238 },
  { formula: 'H2', name: 'Hydrogen', a: 0.2476, b: 0.02661 },
  { formula: 'N2', name: 'Nitrogen', a: 1.37, b: 0.0387 },
  { formula: 'O2', name: 'Oxygen', a: 1.382, b: 0.03186 },
  { formula: 'Ar', name: 'Argon', a: 1.355, b: 0.03201 },
  { formula: 'CO2', name: 'Carbon dioxide', a: 3.64, b: 0.04267 },
  { formula: 'CH4', name: 'Methane', a: 2.283, b: 0.04278 },
  { formula: 'NH3', name: 'Ammonia', a: 4.225, b: 0.0371 },
  { formula: 'H2O', name: 'Water vapour', a: 5.536, b: 0.03049 },
  { formula: 'Cl2', name: 'Chlorine', a: 6.579, b: 0.05622 },
  { formula: 'C2H6', name: 'Ethane', a: 5.562, b: 0.0638 },
  { formula: 'SO2', name: 'Sulfur dioxide', a: 6.803, b: 0.05636 },
];

/** Pressure of a real gas by van der Waals, against the ideal value. */
export function vanDerWaals(gas: VanDerWaalsGas, n: number, litres: number, kelvin: number): ChemResult {
  if (!(n > 0 && litres > 0 && kelvin > 0)) throw new Error('Give the amount, volume and temperature, all above zero.');
  if (litres <= n * gas.b) throw new Error(`The volume is smaller than the molecules themselves (nb = ${sig(n * gas.b)} L).`);
  const real = (n * R_LBAR * kelvin) / (litres - n * gas.b) - (gas.a * n * n) / (litres * litres);
  const ideal = (n * R_LBAR * kelvin) / litres;
  const steps: Step[] = [
    {
      rule: `Van der Waals constants for ${gas.name}: a for attraction, b for the molecules’ own volume`,
      tex: `a = ${gas.a}\\ \\mathrm{L^2\\,bar\\,mol^{-2}},\\quad b = ${gas.b}\\ \\mathrm{L\\,mol^{-1}}`,
    },
    {
      rule: 'The van der Waals equation, solved for P',
      tex: `P = \\frac{nRT}{V - nb} - \\frac{an^2}{V^2} = \\frac{${sigTex(n)} \\times ${R_LBAR} \\times ${sigTex(kelvin, 5)}}{${sigTex(litres)} - ${sigTex(n * gas.b)}} - \\frac{${gas.a} \\times ${sigTex(n * n)}}{${sigTex(litres * litres)}} = ${sigTex(real)}\\ \\mathrm{bar}`,
    },
    { rule: 'The ideal gas law for comparison', tex: `P_{\\text{ideal}} = \\frac{nRT}{V} = ${sigTex(ideal)}\\ \\mathrm{bar}` },
  ];
  const Z = real / ideal;
  return {
    ok: true,
    tex: `P = ${sigTex(real)}\\ \\mathrm{bar}`,
    text: `P = ${sig(real)} bar (ideal ${sig(ideal)} bar)`,
    value: real,
    steps,
    check: `The real gas is ${sig(Math.abs(1 - Z) * 100, 3)} % ${Z < 1 ? 'below' : 'above'} the ideal pressure (${Z < 1 ? 'attraction wins' : 'the molecules’ volume wins'}).`,
    table: {
      head: ['Quantity', 'Value'],
      rows: [
        ['P (van der Waals)', `${sig(real)} bar = ${sig(real / 1.01325)} atm`],
        ['P (ideal)', `${sig(ideal)} bar`],
        ['Compressibility, PV/nRT', sig(Z, 4)],
      ],
    },
  };
}

/* ------------------------------------------------------------- solutions -- */

/** Mass of solid to weigh for a solution of given molarity and volume. */
export function prepareSolution(formula: string, molarity: number, litres: number, purity = 100): ChemResult {
  if (!(molarity > 0 && litres > 0)) throw new Error('Give the molarity and the volume, above zero.');
  if (!(purity > 0 && purity <= 100)) throw new Error('Purity is a percentage from 0 to 100.');
  const s = parseSpecies(formula);
  const M = speciesMass(s);
  const n = molarity * litres;
  const m = (n * M * 100) / purity;
  const steps: Step[] = [
    { rule: `Molar mass of ${speciesText(s)}`, tex: `M = ${sigTex(M, 6)}\\ \\mathrm{g/mol}` },
    { rule: 'Moles needed: n = c × V', tex: `n = ${sigTex(molarity)} \\times ${sigTex(litres)} = ${sigTex(n)}\\ \\mathrm{mol}` },
    { rule: 'Mass: m = n × M', tex: `m = ${sigTex(n)} \\times ${sigTex(M, 6)} = ${sigTex(n * M)}\\ \\mathrm{g}` },
  ];
  if (purity < 100) steps.push({ rule: `Allow for ${purity} % purity`, tex: `m = \\frac{${sigTex(n * M)}}{${purity / 100}} = ${sigTex(m)}\\ \\mathrm{g}` });
  return {
    ok: true,
    tex: `m(\\ce{${s.ce}}) = ${sigTex(m)}\\ \\mathrm{g}`,
    text: `Weigh ${sig(m)} g of ${speciesText(s)}`,
    value: m,
    steps,
    check: 'Dissolve it in less water than needed, then make up to the mark in a volumetric flask.',
  };
}

/** C₁V₁ = C₂V₂ for whichever is missing (any units, as long as they match pairwise). */
export function dilution(c1: number | null, v1: number | null, c2: number | null, v2: number | null): ChemResult {
  const known = [c1, v1, c2, v2].filter((x) => x !== null && Number.isFinite(x) && x > 0).length;
  if (known !== 3) throw new Error('Give exactly three of C₁, V₁, C₂ and V₂.');
  let tex: string;
  let value: number;
  let label: string;
  if (c1 === null || !(c1 > 0)) {
    value = ((c2 as number) * (v2 as number)) / (v1 as number);
    label = 'C₁';
    tex = `C_1 = \\frac{C_2 V_2}{V_1} = ${sigTex(value)}`;
  } else if (v1 === null || !(v1 > 0)) {
    value = ((c2 as number) * (v2 as number)) / c1;
    label = 'V₁';
    tex = `V_1 = \\frac{C_2 V_2}{C_1} = ${sigTex(value)}`;
  } else if (c2 === null || !(c2 > 0)) {
    value = (c1 * v1) / (v2 as number);
    label = 'C₂';
    tex = `C_2 = \\frac{C_1 V_1}{V_2} = ${sigTex(value)}`;
  } else {
    value = (c1 * v1) / c2;
    label = 'V₂';
    tex = `V_2 = \\frac{C_1 V_1}{C_2} = ${sigTex(value)}`;
  }
  const steps: Step[] = [
    { rule: 'Diluting keeps the amount of solute: C₁V₁ = C₂V₂', tex: 'C_1 V_1 = C_2 V_2' },
    { rule: `Solve for ${label}`, tex },
  ];
  if (label === 'V₁' && v2 && value <= v2)
    steps.push({ rule: 'Take that much stock and add solvent up to the final volume', tex: `V_{\\text{solvent}} = V_2 - V_1 = ${sigTex((v2 as number) - value)}` });
  if ((label === 'C₂' || label === 'V₂') && c1 && c2 && c2 > c1) throw new Error('A dilution cannot make the solution stronger: C₂ must be below C₁.');
  return { ok: true, tex, text: `${label} = ${sig(value)}`, value, steps, check: 'Checked: C₁V₁ equals C₂V₂.' };
}

export type ConcentrationKind = 'molarity' | 'molality' | 'mass-percent' | 'mole-fraction';

/**
 * One concentration measure into the others: molarity (mol/L), molality
 * (mol/kg of solvent), mass percent and mole fraction.  Molarity needs the
 * solution's density (g/mL).
 */
export function convertConcentration(solute: string, kind: ConcentrationKind, value: number, density: number | null, solvent = 'H2O'): ChemResult {
  if (!(value > 0)) throw new Error('Give a concentration above zero.');
  const s = parseSpecies(solute);
  const w = parseSpecies(solvent);
  const M = speciesMass(s);
  const Ms = speciesMass(w);
  const needDensity = () => {
    if (!(density !== null && density > 0)) throw new Error('Molarity needs the density of the solution (g/mL).');
    return density;
  };
  // Work from a convenient amount of solution: solute mass, solvent mass, and volume if the density is known.
  let mSolute: number;
  let mSolvent: number;
  let basis: string;
  if (kind === 'molarity') {
    const d = needDensity();
    mSolute = value * M;
    mSolvent = 1000 * d - mSolute;
    basis = `Take 1 L of solution: ${sig(1000 * d)} g, of which ${sig(mSolute)} g is ${speciesText(s)}`;
    if (mSolvent <= 0) throw new Error('That much solute weighs more than the solution: check the molarity and the density.');
  } else if (kind === 'molality') {
    mSolute = value * M;
    mSolvent = 1000;
    basis = `Take 1 kg of solvent with ${sig(value)} mol (${sig(mSolute)} g) of ${speciesText(s)}`;
  } else if (kind === 'mass-percent') {
    if (value >= 100) throw new Error('A mass percentage must be below 100.');
    mSolute = value;
    mSolvent = 100 - value;
    basis = `Take 100 g of solution: ${sig(value)} g of ${speciesText(s)} and ${sig(100 - value)} g of ${speciesText(w)}`;
  } else {
    if (value >= 1) throw new Error('A mole fraction must be below 1.');
    mSolute = value * M;
    mSolvent = (1 - value) * Ms;
    basis = `Take 1 mol in all: ${sig(value)} mol of ${speciesText(s)} and ${sig(1 - value)} mol of ${speciesText(w)}`;
  }
  const nSolute = mSolute / M;
  const nSolvent = mSolvent / Ms;
  const massTotal = mSolute + mSolvent;
  const molality = nSolute / (mSolvent / 1000);
  const percent = (mSolute / massTotal) * 100;
  const fraction = nSolute / (nSolute + nSolvent);
  const molarity = density !== null && density > 0 ? nSolute / (massTotal / density / 1000) : Number.NaN;
  const steps: Step[] = [
    { rule: basis, tex: `M(\\ce{${s.ce}}) = ${sigTex(M, 5)},\\quad M(\\ce{${w.ce}}) = ${sigTex(Ms, 5)}\\ \\mathrm{g/mol}` },
    { rule: 'Molality: moles of solute per kilogram of solvent', tex: `b = \\frac{${sigTex(nSolute)}}{${sigTex(mSolvent / 1000)}} = ${sigTex(molality)}\\ \\mathrm{mol/kg}` },
    { rule: 'Mass percent', tex: `w = \\frac{${sigTex(mSolute)}}{${sigTex(massTotal)}} \\times 100 = ${sigTex(percent)}\\%` },
    { rule: 'Mole fraction', tex: `x = \\frac{${sigTex(nSolute)}}{${sigTex(nSolute)} + ${sigTex(nSolvent)}} = ${sigTex(fraction)}` },
  ];
  if (Number.isFinite(molarity))
    steps.push({
      rule: 'Molarity: volume from the density',
      tex: `V = \\frac{${sigTex(massTotal)}\\ \\mathrm{g}}{${density}\\ \\mathrm{g/mL}} = ${sigTex(massTotal / (density as number))}\\ \\mathrm{mL},\\quad c = ${sigTex(molarity)}\\ \\mathrm{mol/L}`,
    });
  return {
    ok: true,
    tex: `${Number.isFinite(molarity) ? `c = ${sigTex(molarity)}\\ \\mathrm{M},\\ ` : ''}b = ${sigTex(molality)}\\ \\mathrm{m},\\ w = ${sigTex(percent)}\\%,\\ x = ${sigTex(fraction)}`,
    text: `${Number.isFinite(molarity) ? `${sig(molarity)} M, ` : ''}${sig(molality)} m, ${sig(percent)} %, x = ${sig(fraction)}`,
    steps,
    check: 'Checked: each measure, converted back, gives the value entered.',
    table: {
      head: ['Measure', 'Value'],
      rows: [
        ['Molarity', Number.isFinite(molarity) ? `${sig(molarity)} mol/L` : 'needs the density'],
        ['Molality', `${sig(molality)} mol/kg`],
        ['Mass percent', `${sig(percent)} %`],
        ['Mole fraction', sig(fraction)],
      ],
    },
  };
}
