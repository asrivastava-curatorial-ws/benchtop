/**
 * Solves a calculator's equations for whatever the user left empty.  Each
 * equation with exactly one unknown is solved numerically (bracketing over a
 * wide logarithmic range, then bisection), and the newly found value may make
 * another equation solvable, until nothing changes.
 */
import type { EvalFunction, MathNode } from 'mathjs';
import { type Calculator, CONSTANTS, type Equation, isChoice } from './types';

type MathJs = typeof import('mathjs/number');

interface Compiled {
  readonly text: string;
  readonly lhs: EvalFunction;
  readonly rhs: EvalFunction;
  readonly symbols: readonly string[];
  readonly when?: Readonly<Record<string, number>>;
}

const cache = new WeakMap<Calculator, Compiled[]>();
let mathjs: MathJs | null = null;

export async function loadMath(): Promise<MathJs> {
  mathjs ??= await import('mathjs/number');
  return mathjs;
}

const BUILT_IN = new Set(['pi', 'e', 'Infinity', 'true', 'false', 'NaN', 'null']);
/** Words math.js will not accept as variable names. */
const RESERVED = new Set(['end', 'to', 'in', 'mod', 'not', 'and', 'or', 'xor']);

function symbolsOf(node: MathNode): string[] {
  const names = new Set<string>();
  node.traverse((child, path, parent) => {
    if ((child as { isSymbolNode?: boolean }).isSymbolNode && !(parent && (parent as { isFunctionNode?: boolean }).isFunctionNode && path === 'fn')) {
      const name = (child as unknown as { name: string }).name;
      if (!BUILT_IN.has(name) && !(name in CONSTANTS)) names.add(name);
    }
  });
  return [...names];
}

/** Parses and checks a calculator's equations (once per calculator). */
export function compile(math: MathJs, calc: Calculator): Compiled[] {
  const known = cache.get(calc);
  if (known) return known;
  for (const v of calc.vars) if (v.key in CONSTANTS || BUILT_IN.has(v.key) || RESERVED.has(v.key)) throw new Error(`${calc.id}: "${v.key}" is reserved and cannot name a variable`);
  const compiled = calc.eqs.map((equation: Equation) => {
    const text = typeof equation === 'string' ? equation : equation.eq;
    const at = text.indexOf('=');
    if (at < 0) throw new Error(`${calc.id}: "${text}" has no "="`);
    const lhs = math.parse(text.slice(0, at));
    const rhs = math.parse(text.slice(at + 1));
    const symbols = [...new Set([...symbolsOf(lhs), ...symbolsOf(rhs)])];
    for (const name of symbols) if (!calc.vars.some((v) => v.key === name)) throw new Error(`${calc.id}: "${name}" in "${text}" is not a variable`);
    return { text, lhs: lhs.compile(), rhs: rhs.compile(), symbols, when: typeof equation === 'string' ? undefined : equation.when };
  });
  cache.set(calc, compiled);
  return compiled;
}

export interface Solution {
  /** Every known value, in formula units. */
  readonly values: Readonly<Record<string, number>>;
  /** Keys that were calculated. */
  readonly computed: ReadonlySet<string>;
  /** Number variables still unknown. */
  readonly missing: readonly string[];
  /** Equations the given values contradict. */
  readonly conflicts: readonly string[];
  /** Variables used by the equations that apply to the chosen options. */
  readonly active: ReadonlySet<string>;
}

const applies = (eq: Compiled, choices: Readonly<Record<string, number>>) => !eq.when || Object.entries(eq.when).every(([key, value]) => choices[key] === value);

function evaluate(fn: EvalFunction, scope: Record<string, number>): number {
  try {
    const value = fn.evaluate({ ...scope });
    return typeof value === 'number' ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

interface Residual {
  readonly value: number;
  readonly scale: number;
}

function residual(eq: Compiled, scope: Record<string, number>): Residual {
  const l = evaluate(eq.lhs, scope);
  const r = evaluate(eq.rhs, scope);
  return { value: l - r, scale: Math.abs(l) + Math.abs(r) };
}

const close = (r: Residual) => Number.isFinite(r.value) && Math.abs(r.value) <= 1e-9 * Math.max(r.scale, 1e-300) + 1e-300;

/** Narrows a bracket with a sign change to machine precision; null when it held a pole, not a root. */
function bisect(f: (x: number) => Residual, a: number, b: number, fa: number): number | null {
  let lo = a;
  let hi = b;
  let flo = fa;
  for (let i = 0; i < 400; i++) {
    // Geometric steps first across wide positive or negative brackets, then halving.
    const mid = lo > 0 && hi > 0 && hi / lo > 2 ? Math.sqrt(lo * hi) : lo < 0 && hi < 0 && lo / hi > 2 ? -Math.sqrt(lo * hi) : lo + (hi - lo) / 2;
    if (mid === lo || mid === hi) break;
    const fm = f(mid).value;
    if (!Number.isFinite(fm)) return null;
    if (fm === 0) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  const rlo = f(lo);
  const rhi = f(hi);
  const [x, r] = Math.abs(rlo.value) <= Math.abs(rhi.value) ? [lo, rlo] : [hi, rhi];
  return Number.isFinite(r.value) && Math.abs(r.value) <= 1e-7 * Math.max(r.scale, 1e-300) + 1e-12 ? x : null;
}

/** Secant steps from a guess: quick for the smooth, mostly monotonic formulas in the library. */
function secant(f: (x: number) => Residual, guess: number): number | null {
  let x0 = guess;
  let x1 = guess === 0 ? 1 : guess * 1.1;
  let f0 = f(x0).value;
  let f1 = f(x1).value;
  for (let i = 0; i < 100; i++) {
    if (!Number.isFinite(f0) || !Number.isFinite(f1)) return null;
    if (f1 === 0 || f1 === f0) break;
    const x2 = x1 - (f1 * (x1 - x0)) / (f1 - f0);
    if (!Number.isFinite(x2)) return null;
    const settled = Math.abs(x2 - x1) <= 1e-15 * Math.abs(x2);
    x0 = x1;
    f0 = f1;
    x1 = x2;
    f1 = f(x1).value;
    if (settled) break;
  }
  return close(f(x1)) ? x1 : null;
}

/**
 * Finds x with f(x) = 0.  Tries secant steps from `guess` first, then scans
 * 10⁻⁴⁰ to 10⁴⁰ (and the negatives, for signed quantities) for sign changes,
 * keeping the root nearest the guess.
 */
export function findRoot(f: (x: number) => Residual, signed: boolean, guess: number): number | null {
  const quick = secant(f, guess);
  if (quick !== null && (signed || quick > 0)) return quick;
  const roots: number[] = [];
  const grid: number[] = [];
  for (let p = -40; p <= 40.0001; p += 0.1) grid.push(10 ** p);
  const points = signed ? [...grid.map((x) => -x).reverse(), 0, ...grid] : grid;
  let previous: { x: number; v: number } | null = null;
  for (const x of points) {
    const r = f(x);
    if (!Number.isFinite(r.value)) {
      previous = null;
      continue;
    }
    if (r.value === 0) roots.push(x);
    else if (previous && previous.v !== 0 && Math.sign(previous.v) !== Math.sign(r.value)) {
      const root = bisect(f, previous.x, x, previous.v);
      if (root !== null) roots.push(root);
    }
    previous = { x, v: r.value };
  }
  if (!roots.length) return null;
  const distance = (x: number) => (guess > 0 && x > 0 ? Math.abs(Math.log(x / guess)) : Math.abs(x - guess));
  return roots.reduce((best, x) => (distance(x) < distance(best) ? x : best));
}

/**
 * Solves for every unknown it can.  `given` holds typed values and `choices`
 * the selected option values, both in formula units; `guesses` steer the
 * choice between several roots (the example values).
 */
export function solve(math: MathJs, calc: Calculator, given: Readonly<Record<string, number>>, choices: Readonly<Record<string, number>>, guesses: Readonly<Record<string, number>> = {}): Solution {
  const equations = compile(math, calc).filter((eq) => applies(eq, choices));
  const active = new Set<string>(equations.flatMap((eq) => eq.symbols));
  for (const v of calc.vars) if (isChoice(v)) active.add(v.key);
  const scope: Record<string, number> = { ...CONSTANTS, ...choices };
  for (const [key, value] of Object.entries(given)) if (active.has(key) && Number.isFinite(value)) scope[key] = value;
  const computed = new Set<string>();
  const conflicts = new Set<string>();
  const unknown = (eq: Compiled) => eq.symbols.filter((s) => !(s in scope));
  let progress = true;
  while (progress) {
    progress = false;
    for (const eq of equations) {
      const open = unknown(eq);
      if (open.length !== 1) continue;
      const key = open[0];
      const variable = calc.vars.find((v) => v.key === key);
      const signed = variable && !isChoice(variable) ? variable.signed === true : false;
      const root = findRoot((x) => residual(eq, { ...scope, [key]: x }), signed, guesses[key] ?? 1);
      if (root !== null) {
        scope[key] = root;
        computed.add(key);
        progress = true;
      }
    }
  }
  for (const eq of equations) if (unknown(eq).length === 0 && !close(residual(eq, scope)) && !closeEnough(residual(eq, scope))) conflicts.add(eq.text);
  const values: Record<string, number> = {};
  for (const key of active) if (key in scope) values[key] = scope[key];
  const missing = calc.vars.filter((v) => !isChoice(v) && active.has(v.key) && !(v.key in scope)).map((v) => v.key);
  return { values, computed, missing, conflicts: [...conflicts], active };
}

/** Typed values are rounded, so allow a little slack before calling them inconsistent. */
const closeEnough = (r: Residual) => Number.isFinite(r.value) && Math.abs(r.value) <= 5e-4 * Math.max(r.scale, 1e-300);
