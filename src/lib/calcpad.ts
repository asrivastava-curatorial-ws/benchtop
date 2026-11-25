/**
 * Engineering worksheets in the manner of Calcpad: a plain-text script of
 * headings, notes and formulas becomes a report in which every formula is
 * shown typeset, with its values put in and its result, units and all.
 *
 *   "Heading                       a heading
 *   'A note                        a paragraph (also after a formula)
 *   F = m_1*a                      F = m₁·a = 3 kg · 2 m/s² = 6 N
 *   L = ?{6} m                     an input box in the report (default 6)
 *   f(x; y) = x^2 - y              a function
 *   δ|mm                           a result in chosen units
 *   #if cond / #else if / #else / #end if
 *   #for i = 1 : 5 / #repeat n / #while cond … #loop, #break
 *   #hide #show #val #equ #noc #round n #deg #rad
 *   $Root{f(x) = 0 @ x = a : b}   also $Find $Sup $Inf $Area $Slope $Sum $Product $Repeat
 *   $Plot{f(x) & g(x) @ x = a : b}, $Map{f(x; y) @ x = a : b & y = c : d}
 *
 * Expressions are mathjs's (units, matrices, complex numbers) with Calcpad's
 * spellings: ; between arguments and elements, | between matrix rows, and
 * ≡ ≠ ≤ ≥ · × ÷ π √.  Nothing here touches the DOM, so it runs in tests.
 */
import type { FunctionNode, MathJsInstance, MathNode, OperatorNode, SymbolNode, Unit } from 'mathjs';
import { encodePng } from './metadata';
import { CHART_COLORS, niceScale } from './svg-chart';
import { escapeXml } from './text';

export type Mode = 'equ' | 'noc' | 'val';

export interface Settings {
  /** Decimal places shown (#round). */
  readonly decimals: number;
  /** Angles of trigonometric functions in degrees (#deg) or radians (#rad). */
  readonly degrees: boolean;
  /** Formulas with values put in (equ), formulas and results (noc), or results only (val). */
  readonly mode: Mode;
}

export const DEFAULT_SETTINGS: Settings = { decimals: 3, degrees: true, mode: 'equ' };

export type Block =
  | { readonly kind: 'heading'; readonly text: string; readonly line: number }
  | { readonly kind: 'text'; readonly text: string; readonly line: number }
  | { readonly kind: 'math'; readonly tex: string; readonly source: string; readonly line: number; readonly note?: string; readonly warning?: string }
  | {
      readonly kind: 'input';
      /** The name, typeset, with its "=". */
      readonly label: string;
      readonly value: string;
      /** The units after the box, typeset ('' for none). */
      readonly unit: string;
      readonly source: string;
      readonly line: number;
      readonly note?: string;
    }
  | { readonly kind: 'plot'; readonly svg: string; readonly source: string; readonly line: number }
  | { readonly kind: 'error'; readonly message: string; readonly source: string; readonly line: number };

export interface Report {
  readonly blocks: readonly Block[];
  readonly errors: number;
  /** Variables at the end, as text. */
  readonly values: ReadonlyMap<string, string>;
}

/* ------------------------------------------------------------- structure -- */

interface Line {
  readonly n: number;
  readonly text: string;
}

type LoopHead =
  | { readonly kind: 'for'; readonly name: string; readonly from: string; readonly to: string }
  | { readonly kind: 'repeat'; readonly count: string }
  | { readonly kind: 'while'; readonly cond: string };

type Statement =
  | { readonly kind: 'line'; readonly line: Line }
  | { readonly kind: 'problem'; readonly line: Line; readonly message: string }
  | { readonly kind: 'if'; readonly branches: readonly { readonly cond: string | null; readonly line: Line; readonly body: readonly Statement[] }[] }
  | { readonly kind: 'loop'; readonly head: Line; readonly loop: LoopHead; readonly body: readonly Statement[] };

class ScriptError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

/** mathjs's messages in the worksheet's terms. */
function friendly(message: string): string {
  return message
    .replace(/^Undefined symbol (.+)$/, '$1 is not defined above this line')
    .replace(/^Undefined function (.+)$/, 'There is no function $1')
    .replace(/^Units do not match.*$/, 'The units do not match')
    .replace(
      /^Unexpected type of argument in function (?:add|subtract)Scalar \(expected: (?:Unit|number)[^,]*, actual: (?:Unit|number).*$/,
      'A value with units is added to or taken from one without units',
    )
    .replace(/\s*\(char \d+\)$/, '');
}

/** Thrown by #break; caught by the loop around it. */
class BreakLoop extends Error {}

const directive = (text: string) => /^#\s*(else\s+if|end\s+if|\w+)\s*(.*)$/i.exec(text.trim());
const word = (m: RegExpExecArray | null) => (m ? (m[1] as string).toLowerCase().replace(/\s+/g, ' ') : '');

function structure(lines: readonly Line[]): Statement[] {
  let at = 0;
  const block = (until: (w: string) => boolean): Statement[] => {
    const out: Statement[] = [];
    while (at < lines.length) {
      const line = lines[at] as Line;
      const d = directive(line.text);
      const w = word(d);
      if (d && until(w)) return out;
      at++;
      if (w === 'if') {
        const branches: { cond: string | null; line: Line; body: Statement[] }[] = [];
        let current: { cond: string | null; line: Line; body: Statement[] } = { cond: (d?.[2] ?? '').trim(), line, body: [] };
        for (;;) {
          current.body = block((x) => x === 'else if' || x === 'else' || x === 'end if');
          branches.push(current);
          const end = lines[at];
          if (!end) {
            out.push({ kind: 'problem', line, message: '#if without #end if' });
            break;
          }
          const e = directive(end.text);
          const x = word(e);
          at++;
          if (x === 'end if') break;
          current = { cond: x === 'else' ? null : (e?.[2] ?? '').trim(), line: end, body: [] };
        }
        out.push({ kind: 'if', branches });
      } else if (w === 'for' || w === 'repeat' || w === 'while') {
        const rest = (d?.[2] ?? '').trim();
        let loop: LoopHead;
        const m = w === 'for' ? /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.+?)\s*:\s*(.+)$/u.exec(rest) : null;
        if (w === 'for' && m) loop = { kind: 'for', name: m[1] as string, from: m[2] as string, to: m[3] as string };
        else if (w === 'repeat') loop = { kind: 'repeat', count: rest || '1' };
        else loop = { kind: 'while', cond: rest };
        const body = block((x) => x === 'loop');
        const closed = at < lines.length;
        if (closed) at++;
        if (w === 'for' && !m) out.push({ kind: 'problem', line, message: '#for needs a counter and a range: #for i = 1 : 10' });
        else if (w === 'while' && !rest) out.push({ kind: 'problem', line, message: '#while needs a condition' });
        else if (!closed) out.push({ kind: 'problem', line, message: `#${w} without #loop` });
        else out.push({ kind: 'loop', head: line, loop, body });
      } else if (w === 'else if' || w === 'else' || w === 'end if') out.push({ kind: 'problem', line, message: `#${w} without #if` });
      else if (w === 'loop') out.push({ kind: 'problem', line, message: '#loop without #for, #repeat or #while' });
      else out.push({ kind: 'line', line });
    }
    return out;
  };
  return block(() => false);
}

/* ------------------------------------------------------------- spellings -- */

/** Calcpad's spellings to mathjs's. */
export function normalise(text: string): string {
  const swapped = text
    .replace(/≡/g, '==')
    .replace(/≠/g, '!=')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/[·×∙⋅]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/√\s*([\p{L}_][\p{L}\p{N}_]*|\d+(?:\.\d+)?)/gu, 'sqrt($1)')
    .replace(/(\d)\s*°/g, '$1 deg')
    .replace(/Ω/g, 'ohm')
    .replace(/[−–]/g, '-')
    .replace(/;/g, ',');
  // Inside [ ], | separates rows (mathjs writes ;).
  let depth = 0;
  let out = '';
  for (const c of swapped) {
    if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    out += c === '|' && depth > 0 ? ';' : c;
  }
  return out;
}

/** The note after an apostrophe, outside { }. */
function splitNote(text: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === "'" && depth === 0) return [text.slice(0, i).trimEnd(), text.slice(i + 1).trim()];
  }
  return [text, ''];
}

/** The `|units` at the end of a formula, if any (bars inside brackets are matrix rows). */
function splitTarget(text: string): [string, string] {
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '}' || c === ')' || c === ']') depth++;
    else if (c === '{' || c === '(' || c === '[') depth--;
    else if (c === '|' && depth === 0) return [text.slice(0, i).trimEnd(), text.slice(i + 1).trim()];
  }
  return [text, ''];
}

const NAME = String.raw`[\p{L}_][\p{L}\p{N}_]*`;
const INPUT = new RegExp(String.raw`^\s*(${NAME})\s*=\s*\?\s*(?:\{([^}]*)\})?\s*(.*)$`, 'u');

/** Puts a new value in the input box on a line (`name = ?{value} units`). */
export function setInput(source: string, line: number, value: string): string {
  const lines = source.split(/\r?\n/);
  const text = lines[line - 1];
  if (text === undefined) return source;
  const clean = value.replace(/[{}'\r\n]/g, '').trim();
  lines[line - 1] = text.replace(/=\s*\?(\s*\{[^}]*\})?/, `= ?{${clean}}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------- numerics -- */

/** A plain number for a value: units in SI, complex numbers by their real part. */
function numberOf(math: MathJsInstance, v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (math.isUnit(v)) return (v as Unit).value ?? Number.NaN;
  if (math.isComplex(v)) return (v as { re: number }).re;
  if (math.isBigNumber(v) || math.isFraction(v)) return Number(v);
  return Number.NaN;
}

/** A unit like `like` holding `si` (in SI units). */
function withSi(like: Unit, si: number): Unit {
  const u = like.clone();
  u.value = si;
  return u;
}

function brent(f: (x: number) => number, a0: number, b0: number): number {
  let a = a0;
  let b = b0;
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < 200; i++) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol = 2e-15 * Math.abs(b) + 1e-300;
    const m = (c - b) / 2;
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const r = fb / fc;
        const t = fa / fc;
        p = s * (2 * m * t * (t - r) - (b - a) * (r - 1));
        q = (t - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = m;
      }
    } else {
      d = m;
      e = m;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = f(b);
  }
  return b;
}

/** A root in [a, b]: the first sign change found by scanning, refined by Brent's method. */
export function findRoot(f: (x: number) => number, a: number, b: number): number {
  const n = 400;
  let x0 = a;
  let f0 = f(a);
  if (f0 === 0) return a;
  for (let i = 1; i <= n; i++) {
    const x1 = a + ((b - a) * i) / n;
    const f1 = f(x1);
    if (f1 === 0) return x1;
    if (Number.isFinite(f0) && Number.isFinite(f1) && f0 * f1 < 0) return brent(f, x0, x1);
    x0 = x1;
    f0 = f1;
  }
  throw new Error('No root was found in the range: the function does not change sign there.');
}

/** The largest (or smallest) value of f on [a, b]: sampled, then refined by golden sections.  Returns x. */
export function extreme(f: (x: number) => number, a: number, b: number, max: boolean): number {
  const g = (x: number) => {
    const v = f(x);
    return Number.isFinite(v) ? (max ? -v : v) : Number.POSITIVE_INFINITY;
  };
  const n = 400;
  let best = a;
  let bestValue = g(a);
  for (let i = 1; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    const v = g(x);
    if (v < bestValue) {
      best = x;
      bestValue = v;
    }
  }
  let lo = Math.max(a, best - (b - a) / n);
  let hi = Math.min(b, best + (b - a) / n);
  const r = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - r * (hi - lo);
  let x2 = lo + r * (hi - lo);
  let f1 = g(x1);
  let f2 = g(x2);
  for (let i = 0; i < 200 && hi - lo > 1e-13 * (Math.abs(lo) + Math.abs(hi)) + 1e-300; i++) {
    if (f1 < f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - r * (hi - lo);
      f1 = g(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + r * (hi - lo);
      f2 = g(x2);
    }
  }
  const x = (lo + hi) / 2;
  return g(x) <= bestValue ? x : best;
}

const KRONROD_X = [0.991455371120813, 0.949107912342759, 0.864864423359769, 0.741531185599394, 0.58608723546769, 0.405845151377397, 0.207784955007898, 0];
const KRONROD_W = [0.02293532201052922, 0.063092092629979, 0.10479001032225, 0.140653259715525, 0.169004726639267, 0.190350578064785, 0.204432940075298, 0.209482141084728];
const GAUSS_W = [0.12948496616887, 0.279705391489277, 0.381830050505119, 0.417959183673469];

/** ∫ f from a to b by adaptive Gauss–Kronrod (7 and 15 points). */
export function integrate(f: (x: number) => number, a: number, b: number): number {
  if (a === b) return 0;
  const segment = (lo: number, hi: number): [number, number] => {
    const c = (lo + hi) / 2;
    const h = (hi - lo) / 2;
    let k = 0;
    let gauss = 0;
    for (let i = 0; i < 8; i++) {
      const x = KRONROD_X[i] as number;
      const w = KRONROD_W[i] as number;
      const v = x === 0 ? f(c) : f(c - h * x) + f(c + h * x);
      k += w * v;
      if (x === 0) gauss += (GAUSS_W[3] as number) * v;
      else if (i % 2 === 1) gauss += (GAUSS_W[(i - 1) / 2] as number) * v;
    }
    return [k * h, Math.abs((k - gauss) * h)];
  };
  const [whole] = segment(a, b);
  const tolerance = 1e-11 * Math.max(1e-300, Math.abs(whole));
  let total = 0;
  const stack: [number, number, number][] = [[a, b, 0]];
  let pieces = 0;
  while (stack.length) {
    const [lo, hi, depth] = stack.pop() as [number, number, number];
    const [value, error] = segment(lo, hi);
    if (!Number.isFinite(value)) throw new Error('The function is not finite in the range.');
    if (error <= Math.max(tolerance * ((hi - lo) / (b - a)), 1e-15 * Math.abs(value)) || depth > 40 || ++pieces > 20_000) total += value;
    else {
      const mid = (lo + hi) / 2;
      stack.push([lo, mid, depth + 1], [mid, hi, depth + 1]);
    }
  }
  return total;
}

/** f′(x) by central differences with Richardson extrapolation. */
export function slope(f: (x: number) => number, x: number): number {
  let h = Math.max(1e-3, Math.abs(x) * 1e-3);
  const table: number[][] = [];
  for (let i = 0; i < 6; i++, h /= 2) {
    const row = [(f(x + h) - f(x - h)) / (2 * h)];
    for (let j = 1; j <= i; j++) {
      const prev = table[i - 1] as number[];
      const k = 4 ** j;
      row.push(((row[j - 1] as number) * k - (prev[j - 1] as number)) / (k - 1));
    }
    table.push(row);
  }
  const last = table[table.length - 1] as number[];
  return last[last.length - 1] as number;
}

/* ------------------------------------------------------------ formatting -- */

/** A number rounded as Calcpad shows it: n decimals, significant digits below 1, powers of ten at the ends. */
export function formatNumber(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '\\text{undefined}' : v > 0 ? '\\infty' : '-\\infty';
  if (v === 0) return '0';
  const a = Math.abs(v);
  const power = () => {
    let e = Math.floor(Math.log10(a));
    let mantissa = Number((v / 10 ** e).toFixed(Math.max(decimals, 2)));
    if (Math.abs(mantissa) >= 10) {
      e++;
      mantissa = Number((v / 10 ** e).toFixed(Math.max(decimals, 2)));
    }
    return `${mantissa}\\times 10^{${e}}`;
  };
  if (a >= 1e7) return power();
  if (a >= 1) return String(Number(v.toFixed(decimals)));
  if (a >= 1e-3) return String(Number(v.toPrecision(Math.max(decimals, 1))));
  return power();
}

const UNIT_NAMES: Readonly<Record<string, string>> = { ohm: '\\Omega', deg: '°', degC: '°C', degF: '°F', celsius: '°C', fahrenheit: '°F' };

/** Units as mathjs writes them ("kN m / s^2") in TeX. */
export function unitTex(units: string): string {
  const clean = units.replace(/[^\p{L}\p{N}\s^*/·.()°-]/gu, '').trim();
  if (!clean) return '';
  const body = clean
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*[*·]\s*/g, ' ')
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .split(/(\s+|\/|\(|\))/)
    .map((token) => {
      if (/^\s+$/.test(token)) return '\\cdot ';
      const m = /^(\p{L}+)(?:\^(-?[\d.]+))?$/u.exec(token);
      if (!m) return token;
      let name = m[1] as string;
      const known = UNIT_NAMES[name] ?? (/^.ohm$/.test(name) ? `${name[0]}\\Omega` : null);
      if (known) name = known;
      else if (/^u[A-Za-z]/.test(name)) name = `\\mu ${name.slice(1)}`;
      return m[2] ? `${name}^{${m[2]}}` : name;
    })
    .join('');
  return `\\mathrm{${body}}`;
}

const GREEK: Readonly<Record<string, string>> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  ε: 'varepsilon',
  ζ: 'zeta',
  η: 'eta',
  θ: 'theta',
  ι: 'iota',
  κ: 'kappa',
  λ: 'lambda',
  μ: 'mu',
  ν: 'nu',
  ξ: 'xi',
  π: 'pi',
  ρ: 'rho',
  σ: 'sigma',
  ς: 'varsigma',
  τ: 'tau',
  υ: 'upsilon',
  φ: 'varphi',
  χ: 'chi',
  ψ: 'psi',
  ω: 'omega',
  Γ: 'Gamma',
  Δ: 'Delta',
  Θ: 'Theta',
  Λ: 'Lambda',
  Ξ: 'Xi',
  Π: 'Pi',
  Σ: 'Sigma',
  Φ: 'Phi',
  Ψ: 'Psi',
  Ω: 'Omega',
};
const GREEK_WORDS = new Set(Object.values(GREEK).concat(['epsilon', 'phi', 'theta']));

function namePart(s: string, upright: boolean): string {
  if (GREEK_WORDS.has(s)) return `\\${s}`;
  let out = '';
  for (const c of s) {
    const g = GREEK[c];
    if (g) out += `\\${g} `;
    else if (/[A-Za-z0-9]/.test(c)) out += c;
  }
  out = out.trim();
  if (!out) return '?';
  if (upright) return /^[0-9]+$/.test(out) ? out : `\\mathrm{${out}}`;
  return [...s].length > 1 && /^[A-Za-z]+$/.test(s) ? `\\mathit{${out}}` : out;
}

/** A name in TeX: x_1 → x₁, M_max → M with an upright "max", alpha → α. */
export function symbolTex(name: string): string {
  const [base = '', ...subs] = name.split('_').filter((s, i) => i === 0 || s !== '');
  const head = namePart(base, false);
  if (!subs.length) return head;
  const sub = subs.map((s) => ([...s].length > 1 && !GREEK_WORDS.has(s) ? namePart(s, true) : namePart(s, false))).join(',');
  return `${head}_{${sub}}`;
}

/* ------------------------------------------------------------------ plots -- */

export interface PlotSeries {
  readonly label: string;
  readonly x: readonly number[];
  readonly y: readonly number[];
}

/** A line plot in SVG (one axis, Okabe–Ito colours in order, a legend for two or more lines). */
export function plotSvg(series: readonly PlotSeries[], xLabel: string): string {
  const W = 600;
  const H = 320;
  const L = 60;
  const R = 16;
  const T = 14;
  const B = 40;
  const xs = series.flatMap((s) => s.x).filter(Number.isFinite);
  const ys = series.flatMap((s) => s.y).filter(Number.isFinite);
  if (!xs.length) throw new Error('Nothing to plot.');
  const xScale = niceScale(Math.min(...xs), Math.max(...xs), false);
  const yScale = ys.length ? niceScale(Math.min(...ys), Math.max(...ys), false) : { lo: -1, hi: 1, ticks: [-1, 0, 1] };
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const sx = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - yScale.lo) / (yScale.hi - yScale.lo || 1)) * (H - T - B);
  const tick = (v: number) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1) : String(Number(v.toPrecision(6))));
  const font = 'font-family="system-ui, sans-serif"';
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="cp-plot" role="img" aria-label="${escapeXml(`Plot of ${series.map((s) => s.label).join(', ')}`)}">`,
  ];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  for (const t of yScale.ticks) {
    if (t < yScale.lo - 1e-12 || t > yScale.hi + 1e-12) continue;
    const y = sy(t).toFixed(1);
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${t === 0 ? '#818b98' : '#d1d9e0'}" stroke-width="1"/>`);
    parts.push(`<text x="${L - 6}" y="${(Number(y) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="#59636e" ${font}>${tick(t)}</text>`);
  }
  for (const t of xScale.ticks) {
    if (t < x0 - 1e-12 * Math.abs(x1 - x0) || t > x1 + 1e-12 * Math.abs(x1 - x0)) continue;
    const x = sx(t).toFixed(1);
    parts.push(`<line x1="${x}" x2="${x}" y1="${T}" y2="${H - B}" stroke="${t === 0 ? '#818b98' : '#eef1f4'}" stroke-width="1"/>`);
    parts.push(`<text x="${x}" y="${H - B + 15}" font-size="11" text-anchor="middle" fill="#59636e" ${font}>${tick(t)}</text>`);
  }
  parts.push(`<text x="${(L + W - R) / 2}" y="${H - 6}" font-size="12" text-anchor="middle" fill="#59636e" font-style="italic" ${font}>${escapeXml(xLabel)}</text>`);
  series.forEach((s, k) => {
    let d = '';
    let pen = false;
    const span = yScale.hi - yScale.lo;
    s.x.forEach((x, i) => {
      const y = s.y[i] as number;
      if (!Number.isFinite(y) || y < yScale.lo - span * 5 || y > yScale.hi + span * 5) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`;
      pen = true;
    });
    parts.push(`<path d="${d}" fill="none" stroke="${CHART_COLORS[k % 6]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${k >= 6 ? ' stroke-dasharray="6 3"' : ''}/>`);
  });
  if (series.length > 1) {
    const width = Math.max(...series.map((s) => s.label.length)) * 6.6 + 34;
    parts.push(`<rect x="${L + 8}" y="${T + 6}" width="${width.toFixed(0)}" height="${series.length * 17 + 6}" rx="4" fill="#ffffff" fill-opacity="0.9" stroke="#d1d9e0"/>`);
    series.forEach((s, k) => {
      const y = T + 19 + k * 17;
      parts.push(`<line x1="${L + 14}" x2="${L + 32}" y1="${y - 4}" y2="${y - 4}" stroke="${CHART_COLORS[k % 6]}" stroke-width="2"${k >= 6 ? ' stroke-dasharray="6 3"' : ''}/>`);
      parts.push(`<text x="${L + 38}" y="${y}" font-size="11" fill="#1f2328" ${font}>${escapeXml(s.label)}</text>`);
    });
  }
  parts.push('</svg>');
  return parts.join('');
}

const BLUES: readonly (readonly [number, number, number])[] = [
  [247, 251, 255],
  [198, 219, 239],
  [107, 174, 214],
  [33, 113, 181],
  [8, 48, 107],
];

/** The sequential blue scale at t (0 light … 1 dark). */
function ramp(t: number): [number, number, number] {
  const s = Math.min(Math.max(t, 0), 1) * (BLUES.length - 1);
  const i = Math.min(Math.floor(s), BLUES.length - 2);
  const a = BLUES[i] as readonly number[];
  const b = BLUES[i + 1] as readonly number[];
  const f = s - i;
  return [0, 1, 2].map((k) => Math.round((a[k] as number) + ((b[k] as number) - (a[k] as number)) * f)) as [number, number, number];
}

const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function pngDataUrl(width: number, height: number, rgba: Uint8Array): string {
  const bytes = encodePng(width, height, rgba);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * A colour map of z (rows from the lowest y up), light for low values and
 * dark for high, with a scale.  The grid is a small PNG that the viewer
 * smooths when it scales it up.
 */
export function mapSvg(z: readonly (readonly number[])[], x: readonly [number, number], y: readonly [number, number], labels: readonly [string, string, string]): string {
  const W = 600;
  const H = 340;
  const L = 60;
  const T = 14;
  const B = 40;
  const side = H - T - B;
  const rows = z.length;
  const columns = z[0]?.length ?? 0;
  const values = z.flat().filter(Number.isFinite);
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const rgba = new Uint8Array(rows * columns * 4);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < columns; j++) {
      const v = (z[i] as number[])[j] as number;
      // PNG rows run top to bottom: the highest y first.
      const at = ((rows - 1 - i) * columns + j) * 4;
      if (!Number.isFinite(v)) continue;
      rgba.set([...ramp(hi === lo ? 0.5 : (v - lo) / (hi - lo)), 255], at);
    }
  }
  const font = 'font-family="system-ui, sans-serif"';
  const tick = (v: number) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1) : String(Number(v.toPrecision(5))));
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="cp-plot" role="img" aria-label="${escapeXml(`Map of ${labels[2]}`)}">`];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<rect x="${L}" y="${T}" width="${side}" height="${side}" fill="#eef1f4"/>`);
  if (rows && columns) parts.push(`<image x="${L}" y="${T}" width="${side}" height="${side}" preserveAspectRatio="none" href="${pngDataUrl(columns, rows, rgba)}"/>`);
  parts.push(`<rect x="${L}" y="${T}" width="${side}" height="${side}" fill="none" stroke="#818b98"/>`);
  parts.push(`<text x="${L}" y="${H - B + 15}" font-size="11" fill="#59636e" ${font}>${tick(x[0])}</text>`);
  parts.push(`<text x="${L + side}" y="${H - B + 15}" font-size="11" text-anchor="end" fill="#59636e" ${font}>${tick(x[1])}</text>`);
  parts.push(`<text x="${L + side / 2}" y="${H - 6}" font-size="12" text-anchor="middle" font-style="italic" fill="#59636e" ${font}>${escapeXml(labels[0])}</text>`);
  parts.push(`<text x="${L - 6}" y="${T + side}" font-size="11" text-anchor="end" fill="#59636e" ${font}>${tick(y[0])}</text>`);
  parts.push(`<text x="${L - 6}" y="${T + 10}" font-size="11" text-anchor="end" fill="#59636e" ${font}>${tick(y[1])}</text>`);
  parts.push(`<text transform="translate(${L - 30} ${T + side / 2}) rotate(-90)" font-size="12" text-anchor="middle" font-style="italic" fill="#59636e" ${font}>${escapeXml(labels[1])}</text>`);
  // The scale: low at the bottom, high at the top.
  const bx = L + side + 40;
  const steps = 40;
  for (let k = 0; k < steps; k++)
    parts.push(`<rect x="${bx}" y="${(T + side - ((k + 1) * side) / steps).toFixed(2)}" width="16" height="${(side / steps + 0.5).toFixed(2)}" fill="${hex(ramp(k / (steps - 1)))}"/>`);
  parts.push(`<rect x="${bx}" y="${T}" width="16" height="${side}" fill="none" stroke="#818b98"/>`);
  parts.push(`<text x="${bx + 22}" y="${T + 10}" font-size="11" fill="#1f2328" ${font}>${tick(hi)}</text>`);
  parts.push(`<text x="${bx + 22}" y="${T + side}" font-size="11" fill="#1f2328" ${font}>${tick(lo)}</text>`);
  parts.push(`<text x="${bx + 22}" y="${T + side / 2 + 4}" font-size="11" fill="#59636e" ${font}>${escapeXml(labels[2].length > 26 ? `${labels[2].slice(0, 25)}…` : labels[2])}</text>`);
  parts.push('</svg>');
  return parts.join('');
}

/* ------------------------------------------------------------ calculating -- */

const SOLVERS = new Set(['root', 'find', 'sup', 'inf', 'area', 'integral', 'slope', 'sum', 'product', 'repeat']);
/** Names that are both a mathjs function or constant and a unit: bare, they mean the unit. */
const UNIT_FIRST = new Set(['min', 'sec', 'chain', 'coulomb']);
const MAX_BLOCKS = 4000;

interface SolverCall {
  readonly name: string;
  readonly expression: string;
  readonly rhs: string;
  readonly variable: string;
  readonly from: string;
  readonly to: string;
}

function parseSolver(name: string, body: string, line: number): SolverCall {
  const at = body.lastIndexOf('@');
  if (at < 0) throw new ScriptError(`$${name} needs "@ variable = start : end"`, line);
  const left = body.slice(0, at).trim();
  const m = /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.+?)(?:\s*:\s*(.+))?$/u.exec(body.slice(at + 1).trim());
  if (!m) throw new ScriptError(`$${name}: write the range as "@ x = start : end"`, line);
  // "f(x) = g(x)" inside a solver means f − g = 0 (== <= >= != are comparisons).
  const eq = /(^|[^=<>!])=([^=]|$)/.exec(left);
  let expression = left;
  let rhs = '';
  if (eq) {
    const i = eq.index + (eq[1] as string).length;
    expression = left.slice(0, i).trim();
    rhs = left.slice(i + 1).trim();
  }
  if (!expression) throw new ScriptError(`$${name} has nothing to work on`, line);
  return { name, expression, rhs, variable: m[1] as string, from: m[2] as string, to: (m[3] ?? m[2]) as string };
}

interface Range {
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

const parseRange = (text: string): Range | null => {
  const m = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.+?)\s*:\s*(.+?)\s*$/u.exec(text);
  return m ? { name: m[1] as string, from: m[2] as string, to: m[3] as string } : null;
};

/**
 * Runs a worksheet with a mathjs instance (create(all, { number: 'number' })).
 * The worksheet's variables live in a scope of its own.
 */
export function calculate(math: MathJsInstance, source: string, initial: Settings = DEFAULT_SETTINGS): Report {
  const lines = source.split(/\r?\n/).map((text, i) => ({ n: i + 1, text }));
  const blocks: Block[] = [];
  let errors = 0;
  const scope = new Map<string, unknown>();
  const userFunctions = new Set<string>();
  let settings = { ...initial };
  let hidden = false;
  let budget = 200_000;
  let solverCount = 0;

  const push = (b: Block) => {
    if (blocks.length >= MAX_BLOCKS) throw new ScriptError(`The report is longer than ${MAX_BLOCKS} lines: hide loop bodies with #hide.`, b.line);
    blocks.push(b);
  };

  // Trigonometry in degrees or radians, as #deg and #rad say.
  {
    const toRad = (x: unknown) => (typeof x === 'number' && settings.degrees ? (x * Math.PI) / 180 : x);
    const fromRad = (x: unknown) => (typeof x === 'number' && settings.degrees ? (x * 180) / Math.PI : x);
    for (const n of ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'] as const) scope.set(n, (x: unknown) => (math[n] as (v: unknown) => unknown)(toRad(x)));
    for (const n of ['asin', 'acos', 'atan', 'asec', 'acsc', 'acot'] as const) scope.set(n, (x: unknown) => fromRad((math[n] as (v: unknown) => unknown)(x)));
    scope.set('atan2', (y: number, x: number) => fromRad(math.atan2(y, x)));
  }
  const builtIn = new Set(scope.keys());

  const isUnitName = (name: string) => {
    try {
      return math.Unit.isValuelessUnit(name);
    } catch {
      return false;
    }
  };

  const parse = (text: string): MathNode => math.parse(normalise(text));
  /** The tree to run: min, sec … read as units where they are not called as functions. */
  const runnable = (node: MathNode): MathNode =>
    node.transform((n: MathNode, path: string) => {
      if (!math.isSymbolNode(n) || path === 'fn' || path === 'object') return n;
      const name = (n as SymbolNode).name;
      return UNIT_FIRST.has(name) && !scope.has(name) ? new math.ConstantNode(math.unit(name) as unknown as number) : n;
    });
  const evaluate = (text: string): unknown => runnable(parse(text)).evaluate(scope);

  /** Units shown as Calcpad would: like units cancelled, moments kept as kN·m, otherwise mathjs's derived unit. */
  const tidyUnit = (u: Unit): Unit | number => {
    if (u.value === null || u.units.length === 0) return u;
    if (u.dimensions.every((d) => Math.abs(d) < 1e-12) && !u.units.some((c) => c.unit.offset)) return u.value;
    if (u.skipAutomaticSimplification) return u;
    const groups = new Map<string, { unit: Unit['units'][number]['unit']; prefix: Unit['units'][number]['prefix']; power: number }>();
    for (const c of u.units) {
      const key = (c.unit.base as unknown as { key: string }).key;
      const g = groups.get(key);
      if (g) g.power += c.power;
      else groups.set(key, { unit: c.unit, prefix: c.prefix, power: c.power });
    }
    const merged = [...groups.values()].filter((g) => Math.abs(g.power) > 1e-12);
    const build = (list: typeof merged) => {
      const v = u.clone();
      v.units = list.map((g) => ({ unit: g.unit, prefix: g.prefix, power: g.power }));
      v.skipAutomaticSimplification = true;
      v.fixPrefix = true;
      return v;
    };
    if (merged.length <= 1) return build(merged);
    const bases = merged.map((g) => `${(g.unit.base as unknown as { key: string }).key}^${g.power}`).sort();
    if (bases.length === 2 && bases[0] === 'FORCE^1' && bases[1] === 'LENGTH^1') return build(merged);
    const simple = u.simplify();
    if (simple.units.length === 1) return u;
    return merged.length <= 3 ? build(merged) : u;
  };

  const valueTex = (v: unknown): string => {
    const decimals = settings.decimals;
    if (typeof v === 'number') return formatNumber(v, decimals);
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (math.isUnit(v)) {
      const tidy = tidyUnit(v as Unit);
      if (typeof tidy === 'number') return formatNumber(tidy, decimals);
      const text = math.format(tidy, { precision: 15 });
      const m = /^\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(.*)$/i.exec(text);
      if (!m) return unitTex(text);
      const units = unitTex(m[2] as string);
      const number = formatNumber(Number(m[1]), decimals);
      return units === '\\mathrm{°}' ? `${number}°` : `${number}\\ ${units}`;
    }
    if (math.isComplex(v)) {
      const { re, im } = v as { re: number; im: number };
      if (im === 0) return formatNumber(re, decimals);
      const imag = `${formatNumber(Math.abs(im), decimals)}\\,i`;
      return re === 0 ? `${im < 0 ? '-' : ''}${imag}` : `${formatNumber(re, decimals)}${im < 0 ? '-' : '+'}${imag}`;
    }
    if (math.isMatrix(v) || Array.isArray(v)) {
      const arr = (math.isMatrix(v) ? (v as { toArray(): unknown[] }).toArray() : v) as unknown[];
      if (!Array.isArray(arr[0])) {
        // A vector: a column, or a row marked as transposed when it is long.
        if (arr.length > 40) return `\\text{a vector of ${arr.length} values}`;
        return arr.length <= 8 ? `\\begin{bmatrix}${arr.map(valueTex).join(' \\\\ ')}\\end{bmatrix}` : `\\begin{bmatrix}${arr.map(valueTex).join(' & ')}\\end{bmatrix}^{\\mathsf{T}}`;
      }
      const rows = arr as unknown[][];
      if (rows.length > 40 || (rows[0]?.length ?? 0) > 20) return `\\text{a ${rows.length} × ${rows[0]?.length ?? 0} matrix}`;
      return `\\begin{bmatrix}${rows.map((r) => r.map(valueTex).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;
    }
    if (math.isBigNumber(v) || math.isFraction(v)) return formatNumber(Number(v), decimals);
    if (typeof v === 'string') return `\\text{${v.replace(/[{}\\$&#^_%~]/g, '')}}`;
    if (typeof v === 'function') return '\\text{function}';
    return '\\text{?}';
  };

  const valueText = (v: unknown): string => {
    if (typeof v === 'number') return String(Number(v.toFixed(settings.decimals)));
    if (math.isUnit(v)) {
      const tidy = tidyUnit(v as Unit);
      return typeof tidy === 'number' ? String(Number(tidy.toFixed(settings.decimals))) : math.format(tidy, { precision: Math.max(4, settings.decimals + 2) });
    }
    return math.format(v as number, { precision: Math.max(4, settings.decimals + 2) });
  };

  /**
   * TeX for a formula: variables in italics, units upright, solver calls as
   * written, and (given `values`) placeholders replaced by values.  Every
   * piece starts with a space, so "\cdot" never runs into a letter.
   */
  const texOf = (node: MathNode, solvers: ReadonlyMap<string, string>, locals: ReadonlySet<string> = new Set(), values: ReadonlyMap<string, string> = new Map()): string =>
    node.toTex({
      parenthesis: 'auto',
      implicit: 'hide',
      handler: (n: MathNode, options: object) => {
        if (math.isSymbolNode(n)) {
          const name = (n as SymbolNode).name;
          if (locals.has(name)) return ` ${symbolTex(name)}`;
          const given = values.get(name) ?? solvers.get(name);
          if (given) return ` ${given}`;
          if (!scope.has(name) && isUnitName(name)) return ` ${unitTex(name)}`;
          return ` ${symbolTex(name)}`;
        }
        if (math.isFunctionNode(n)) {
          const f = n as FunctionNode;
          const name = math.isSymbolNode(f.fn) ? (f.fn as SymbolNode).name : '';
          if (name && userFunctions.has(name) && !locals.has(name)) return ` ${symbolTex(name)}{\\left(${f.args.map((a) => a.toTex(options)).join(';\\ ')}\\right)}`;
        }
        return undefined;
      },
    });

  /** The formula with each variable's value put in, bracketed only where it would otherwise read wrongly. */
  const filledIn = (node: MathNode, solvers: ReadonlyMap<string, string>): string => {
    const values = new Map<string, string>();
    const replaced = node.transform((n: MathNode, path: string, parent: MathNode | null) => {
      if (!math.isSymbolNode(n) || path === 'fn') return n;
      const name = (n as SymbolNode).name;
      if (solvers.has(name) || !scope.has(name) || builtIn.has(name)) return n;
      const v = scope.get(name);
      if (typeof v === 'function') return n;
      let tex = valueTex(v);
      const negative = tex.startsWith('-');
      // Matrices carry their own brackets; units, complex numbers and powers of ten need them in products.
      const compound = !math.isMatrix(v) && !Array.isArray(v) && (math.isUnit(v) || math.isComplex(v) || tex.includes('\\times'));
      const op: string = parent && math.isOperatorNode(parent) ? String((parent as OperatorNode).fn) : '';
      const bracket =
        op === 'pow'
          ? path === 'args[0]' && (negative || compound)
          : op === 'multiply' || op === 'unaryMinus' || op === 'unaryPlus' || op === 'dotMultiply'
            ? negative || compound
            : op === 'add' || op === 'subtract'
              ? negative && path !== 'args[0]'
              : op === 'mod' || op === 'factorial'
                ? negative || compound
                : false;
      if (bracket) tex = `\\left(${tex}\\right)`;
      const key = `__value${values.size}`;
      values.set(key, tex);
      return new math.SymbolNode(key);
    });
    return values.size ? texOf(replaced, solvers, new Set(), values) : '';
  };

  const solverTex = (call: SolverCall): string => {
    const part = (s: string) => {
      try {
        return texOf(parse(s), new Map(), new Set([call.variable])).trim();
      } catch {
        return `\\text{${s.replace(/[{}\\$&#^_%~]/g, '')}}`;
      }
    };
    const name = call.name.charAt(0).toUpperCase() + call.name.slice(1);
    const body = `${part(call.expression)}${call.rhs ? ` = ${part(call.rhs)}` : ''}`;
    const v = symbolTex(call.variable);
    const range = call.name === 'slope' ? `${v} = ${part(call.from)}` : `${v} = ${part(call.from)} \\ldots ${part(call.to)}`;
    return `\\mathrm{${name}}\\left\\{${body};\\ ${range}\\right\\}`;
  };

  const runSolver = (call: SolverCall): unknown => {
    const compiled = runnable(parse(call.rhs ? `(${call.expression}) - (${call.rhs})` : call.expression)).compile();
    const a = evaluate(call.from);
    const b = evaluate(call.to);
    const had = scope.has(call.variable);
    const saved = scope.get(call.variable);
    const xa = numberOf(math, a);
    const xb = numberOf(math, b);
    if (!Number.isFinite(xa) || !Number.isFinite(xb)) throw new Error(`The range of $${call.name} must be numbers.`);
    const unitX = math.isUnit(a) ? (a as Unit) : math.isUnit(b) ? (b as Unit) : null;
    const at = (x: number): unknown => (unitX ? withSi(unitX, x) : x);
    const value = (x: number) => {
      scope.set(call.variable, at(x));
      return compiled.evaluate(scope) as unknown;
    };
    const f = (x: number) => numberOf(math, value(x));
    try {
      switch (call.name) {
        case 'root':
        case 'find':
          return at(findRoot(f, Math.min(xa, xb), Math.max(xa, xb)));
        case 'sup':
        case 'inf':
          return value(extreme(f, Math.min(xa, xb), Math.max(xa, xb), call.name === 'sup'));
        case 'area':
        case 'integral': {
          const area = integrate(f, xa, xb);
          const sample = value((xa + xb) / 2);
          const unit = math.isUnit(sample) || unitX ? (math.multiply(math.isUnit(sample) ? (sample as Unit) : 1, unitX ?? 1) as unknown) : null;
          return unit && math.isUnit(unit) ? withSi(unit as Unit, area) : area;
        }
        case 'slope': {
          const d = slope(f, xa);
          const sample = value(xa);
          const unit = math.isUnit(sample) || unitX ? (math.divide(math.isUnit(sample) ? (sample as Unit) : 1, unitX ?? 1) as unknown) : null;
          return unit && math.isUnit(unit) ? withSi(unit as Unit, d) : d;
        }
        default: {
          const lo = Math.round(xa);
          const hi = Math.round(xb);
          if (Math.abs(hi - lo) > 1_000_000) throw new Error('The range is longer than a million terms.');
          let acc: unknown = call.name === 'product' ? 1 : 0;
          for (let k = lo; k <= hi; k++) {
            scope.set(call.variable, k);
            const v = compiled.evaluate(scope) as unknown;
            acc = call.name === 'sum' ? math.add(acc as number, v as number) : call.name === 'product' ? math.multiply(acc as number, v as number) : v;
          }
          return acc;
        }
      }
    } finally {
      if (had) scope.set(call.variable, saved);
      else scope.delete(call.variable);
    }
  };

  /** Replaces solver calls with names holding their results. */
  const solve = (text: string, line: number): { text: string; solvers: Map<string, string> } => {
    const solvers = new Map<string, string>();
    let out = '';
    let i = 0;
    for (;;) {
      const m = /\$([A-Za-z]+)\s*\{/.exec(text.slice(i));
      if (!m) {
        out += text.slice(i);
        break;
      }
      const start = i + m.index;
      out += text.slice(i, start);
      let depth = 0;
      let end = -1;
      for (let j = start + m[0].length - 1; j < text.length; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}' && --depth === 0) {
          end = j;
          break;
        }
      }
      if (end < 0) throw new ScriptError(`$${m[1]}{ is not closed`, line);
      const name = (m[1] as string).toLowerCase();
      if (!SOLVERS.has(name)) throw new ScriptError(`There is no $${m[1]}: use $Root, $Find, $Sup, $Inf, $Area, $Slope, $Sum, $Product, $Repeat, $Plot or $Map`, line);
      const call = parseSolver(name, text.slice(start + m[0].length, end), line);
      const symbol = `__solver${++solverCount}`;
      scope.set(symbol, runSolver(call));
      solvers.set(symbol, solverTex(call));
      out += symbol;
      i = end + 1;
    }
    return { text: out, solvers };
  };

  /** $Plot and $Map lines. */
  const graph = (kind: string, body: string, line: Line) => {
    const at = body.lastIndexOf('@');
    if (at < 0) throw new ScriptError(kind === 'plot' ? '$Plot{f(x) & g(x) @ x = start : end}' : '$Map{f(x; y) @ x = start : end & y = start : end}', line.n);
    const ranges = body
      .slice(at + 1)
      .split('&')
      .map(parseRange);
    const range = ranges[0];
    if (!range || ranges.some((x) => !x)) throw new ScriptError('Write each range as "x = start : end"', line.n);
    const span = (r: Range) => {
      const a = evaluate(r.from);
      const b = evaluate(r.to);
      const lo = numberOf(math, a);
      const hi = numberOf(math, b);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) throw new ScriptError(`The range of ${r.name} must be two different numbers`, line.n);
      const unit = math.isUnit(a) ? (a as Unit) : math.isUnit(b) ? (b as Unit) : null;
      return { lo, hi, at: (x: number): unknown => (unit ? withSi(unit, x) : x) };
    };
    const names = ranges.map((x) => (x as Range).name);
    const r = (v: number) => String(Number(v.toPrecision(6)));
    const saved = names.map((n) => [n, scope.has(n), scope.get(n)] as const);
    try {
      if (kind === 'plot') {
        const expressions = body
          .slice(0, at)
          .split('&')
          .map((s) => s.trim())
          .filter(Boolean);
        if (!expressions.length) throw new ScriptError('$Plot has nothing to draw', line.n);
        if (expressions.length > 8) throw new ScriptError('$Plot draws up to 8 lines', line.n);
        const x = span(range);
        const compiled = expressions.map((e) => runnable(parse(e)).compile());
        const series = expressions.map((label, k) => {
          const xs: number[] = [];
          const ys: number[] = [];
          let problem = '';
          for (let i = 0; i <= 400; i++) {
            const t = x.lo + ((x.hi - x.lo) * i) / 400;
            scope.set(range.name, x.at(t));
            let v = Number.NaN;
            try {
              v = numberOf(math, (compiled[k] as { evaluate(s: unknown): unknown }).evaluate(scope));
            } catch (e) {
              problem ||= friendly(e instanceof Error ? e.message : String(e));
            }
            xs.push(t);
            ys.push(v);
          }
          if (!ys.some(Number.isFinite))
            throw new ScriptError(
              `${label} has no value anywhere from ${r(x.lo)} to ${r(x.hi)}${problem ? `: ${problem}` : ''}${/units/i.test(problem) ? ' (give the range units, as in x = 0 m : 6 m)' : ''}`,
              line.n,
            );
          return { label, x: xs, y: ys };
        });
        return plotSvg(series, range.name);
      }
      const second = ranges[1];
      if (!second) throw new ScriptError('$Map needs two ranges: @ x = start : end & y = start : end', line.n);
      const expression = body.slice(0, at).trim();
      const compiled = runnable(parse(expression)).compile();
      const x = span(range);
      const y = span(second);
      const N = 64;
      const z: number[][] = [];
      let problem = '';
      for (let i = 0; i < N; i++) {
        const row: number[] = [];
        scope.set(second.name, y.at(y.lo + ((y.hi - y.lo) * (i + 0.5)) / N));
        for (let j = 0; j < N; j++) {
          scope.set(range.name, x.at(x.lo + ((x.hi - x.lo) * (j + 0.5)) / N));
          let v = Number.NaN;
          try {
            v = numberOf(math, compiled.evaluate(scope));
          } catch (e) {
            problem ||= friendly(e instanceof Error ? e.message : String(e));
          }
          row.push(v);
        }
        z.push(row);
      }
      if (!z.some((row) => row.some(Number.isFinite))) throw new ScriptError(`${expression} has no value anywhere in the ranges${problem ? `: ${problem}` : ''}`, line.n);
      return mapSvg(z, [x.lo, x.hi], [y.lo, y.hi], [range.name, second.name, expression]);
    } finally {
      for (const [n, had, v] of saved) {
        if (had) scope.set(n, v);
        else scope.delete(n);
      }
    }
  };

  /** A variable that hides a unit, used where the unit was meant ("2 m" with m = 5 kg). */
  const shadowed = (node: MathNode): string | undefined => {
    let found: string | undefined;
    node.traverse((n: MathNode) => {
      if (found || !math.isOperatorNode(n)) return;
      const op = n as OperatorNode;
      if (op.fn !== 'multiply' || !(op as unknown as { implicit: boolean }).implicit) return;
      const [a, b] = op.args;
      if (a && b && math.isConstantNode(a) && math.isSymbolNode(b)) {
        const name = (b as SymbolNode).name;
        if (scope.has(name) && isUnitName(name)) found = `“${name}” here is your variable ${name}, not the unit ${name}.`;
      }
    });
    return found;
  };

  const doLine = (line: Line) => {
    const raw = line.text.trim();
    if (!raw) return;
    if (raw.startsWith('"')) {
      if (!hidden) push({ kind: 'heading', text: raw.replace(/^"+/, '').replace(/"+$/, '').trim(), line: line.n });
      return;
    }
    if (raw.startsWith("'")) {
      if (!hidden) push({ kind: 'text', text: raw.slice(1).replace(/'$/, '').trim(), line: line.n });
      return;
    }
    const d = directive(raw);
    if (d) {
      const w = word(d);
      const arg = (d[2] ?? '').trim();
      switch (w) {
        case 'hide':
          hidden = true;
          return;
        case 'show':
          hidden = false;
          return;
        case 'val':
        case 'equ':
        case 'noc':
          settings = { ...settings, mode: w };
          return;
        case 'deg':
          settings = { ...settings, degrees: true };
          return;
        case 'rad':
          settings = { ...settings, degrees: false };
          return;
        case 'round': {
          const n = Number(arg);
          if (!Number.isInteger(n) || n < 0 || n > 15) throw new ScriptError('#round takes a whole number of decimal places, 0 to 15', line.n);
          settings = { ...settings, decimals: n };
          return;
        }
        case 'break':
          throw new BreakLoop();
        default:
          throw new ScriptError(`There is no #${d[1]}`, line.n);
      }
    }
    const [formula, note] = splitNote(raw);
    const graphCall = /^\$(Plot|Map)\s*\{([\s\S]*)\}\s*$/i.exec(formula);
    if (graphCall) {
      const svg = graph((graphCall[1] as string).toLowerCase(), graphCall[2] as string, line);
      if (!hidden) push({ kind: 'plot', svg, source: raw, line: line.n });
      if (note && !hidden) push({ kind: 'text', text: note, line: line.n });
      return;
    }
    const input = INPUT.exec(formula);
    if (input) {
      const name = input[1] as string;
      const value = (input[2] ?? '').trim();
      const units = (input[3] ?? '').trim();
      if (!value) throw new ScriptError(`Enter a value for ${name}`, line.n);
      const v = evaluate(units ? `(${value}) * (${units})` : value);
      scope.set(name, v);
      if (!hidden) push({ kind: 'input', label: `${symbolTex(name)} =`, value, unit: units ? unitTex(normalise(units)) : '', source: raw, line: line.n, ...(note ? { note } : {}) });
      return;
    }
    const [expression, target] = splitTarget(formula);
    const { text, solvers } = solve(expression, line.n);
    if (!text.trim()) {
      if (note && !hidden) push({ kind: 'text', text: note, line: line.n });
      return;
    }
    const node = parse(text);
    if (math.isFunctionAssignmentNode(node)) {
      const f = node as unknown as { name: string; params: string[]; expr: MathNode };
      if (builtIn.has(f.name)) throw new ScriptError(`${f.name} is built in; choose another name`, line.n);
      runnable(node).evaluate(scope);
      userFunctions.add(f.name);
      if (!hidden && settings.mode !== 'val') {
        const tex = `${symbolTex(f.name)}{\\left(${f.params.map(symbolTex).join(';\\ ')}\\right)} = ${texOf(f.expr, solvers, new Set(f.params)).trim()}`;
        push({ kind: 'math', tex, source: raw, line: line.n, ...(note ? { note } : {}) });
      }
      return;
    }
    const warning = shadowed(node);
    let value = runnable(node).evaluate(scope) as unknown;
    let lhs = '';
    let rhs: MathNode = node;
    if (math.isAssignmentNode(node)) {
      const a = node as unknown as { object: MathNode; value: MathNode; name?: string };
      lhs = `${texOf(a.object, solvers).trim()} = `;
      rhs = a.value;
      if (math.isSymbolNode(a.object) && builtIn.has((a.object as SymbolNode).name)) throw new ScriptError(`${(a.object as SymbolNode).name} is built in; choose another name`, line.n);
    }
    if (target) {
      value = math.evaluate(
        '__value to __target',
        new Map<string, unknown>([
          ['__value', value],
          ['__target', evaluate(target)],
        ]),
      );
      if (math.isAssignmentNode(node) && math.isSymbolNode((node as unknown as { object: MathNode }).object)) scope.set(((node as unknown as { object: SymbolNode }).object as SymbolNode).name, value);
    }
    if (hidden) return;
    const result = valueTex(value);
    let tex: string;
    // A value written out (6, -2, [1; 2], 12 kN/m) is shown once, not as a formula.
    const unitSymbol = (n: MathNode) => math.isSymbolNode(n) && !scope.has((n as SymbolNode).name) && isUnitName((n as SymbolNode).name);
    const literal = (n: MathNode): boolean => {
      if (math.isConstantNode(n)) return true;
      if (math.isParenthesisNode(n)) return literal((n as unknown as { content: MathNode }).content);
      if (math.isArrayNode(n)) return (n as unknown as { items: MathNode[] }).items.every(literal);
      return math.isOperatorNode(n) && ['unaryMinus', 'unaryPlus'].includes((n as OperatorNode).fn) && (n as OperatorNode).args.every(literal);
    };
    const measure = (n: MathNode): boolean => {
      if (math.isConstantNode(n) || unitSymbol(n)) return true;
      if (math.isParenthesisNode(n)) return measure((n as unknown as { content: MathNode }).content);
      return math.isOperatorNode(n) && ['multiply', 'divide', 'pow', 'unaryMinus', 'unaryPlus'].includes((n as OperatorNode).fn) && (n as OperatorNode).args.every(measure);
    };
    const isQuantity = (n: MathNode) => literal(n) || (measure(n) && n.filter(unitSymbol).length > 0);
    if (settings.mode === 'val' || (isQuantity(rhs) && !target)) tex = `${lhs}${result}`;
    else {
      const steps = [texOf(rhs, solvers).trim()];
      if (settings.mode === 'equ' && !math.isSymbolNode(rhs)) {
        const filled = filledIn(rhs, solvers).trim();
        if (filled && filled !== steps[0]) steps.push(filled);
      }
      if (steps[steps.length - 1] !== result) steps.push(result);
      tex = `${lhs}${steps.join(' = ')}`;
    }
    push({ kind: 'math', tex, source: raw, line: line.n, ...(note ? { note } : {}), ...(warning ? { warning } : {}) });
  };

  const report = (e: unknown, line: Line) => {
    errors++;
    const message = friendly(e instanceof Error ? e.message : String(e));
    if (blocks.length < MAX_BLOCKS + 1) blocks.push({ kind: 'error', message, source: line.text, line: line.n });
  };

  const run = (statements: readonly Statement[]) => {
    for (const s of statements) {
      if (s.kind === 'problem') {
        report(new Error(s.message), s.line);
        continue;
      }
      const head = s.kind === 'line' ? s.line : s.kind === 'loop' ? s.head : (s.branches[0] as { line: Line }).line;
      if (--budget < 0) throw new ScriptError('The worksheet took more than 200,000 steps: check the loops.', head.n);
      if (s.kind === 'line') {
        try {
          doLine(s.line);
        } catch (e) {
          if (e instanceof BreakLoop) throw e;
          if (e instanceof ScriptError && /longer than|steps/.test(e.message)) throw e;
          report(e, s.line);
        }
      } else if (s.kind === 'if') {
        for (const branch of s.branches) {
          let take = branch.cond === null;
          if (!take) {
            try {
              take = numberOf(math, evaluate(branch.cond ?? '0')) !== 0;
            } catch (e) {
              report(e, branch.line);
              break;
            }
          }
          if (take) {
            run(branch.body);
            break;
          }
        }
      } else {
        const { loop } = s;
        const body = () => {
          try {
            run(s.body);
            return true;
          } catch (e) {
            if (e instanceof BreakLoop) return false;
            throw e;
          }
        };
        try {
          if (loop.kind === 'for') {
            const from = numberOf(math, evaluate(loop.from));
            const to = numberOf(math, evaluate(loop.to));
            if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('The range of #for must be numbers.');
            const step = to >= from ? 1 : -1;
            for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
              scope.set(loop.name, i);
              if (!body()) break;
            }
          } else if (loop.kind === 'repeat') {
            const n = Math.round(numberOf(math, evaluate(loop.count)));
            for (let i = 0; i < n; i++) if (!body()) break;
          } else {
            while (numberOf(math, evaluate(loop.cond)) !== 0) {
              if (--budget < 0) throw new ScriptError('The worksheet took more than 200,000 steps: check the loops.', head.n);
              if (!body()) break;
            }
          }
        } catch (e) {
          if (e instanceof BreakLoop || e instanceof ScriptError) throw e;
          report(e, s.head);
        }
      }
    }
  };

  try {
    run(structure(lines));
  } catch (e) {
    if (!(e instanceof BreakLoop)) {
      const line = e instanceof ScriptError ? e.line : 0;
      report(e, { n: line, text: lines[line - 1]?.text ?? '' });
    }
  }
  const values = new Map<string, string>();
  for (const [name, v] of scope) {
    if (name.startsWith('__') || builtIn.has(name) || typeof v === 'function') continue;
    try {
      values.set(name, valueText(v));
    } catch {
      // Values that cannot be shown are left out.
    }
  }
  return { blocks, errors, values };
}

/* -------------------------------------------------------------- examples -- */

export interface CalcpadExample {
  readonly id: string;
  readonly title: string;
  readonly source: string;
}

export const CALCPAD_EXAMPLES: readonly CalcpadExample[] = [
  {
    id: 'beam',
    title: 'Simply supported beam',
    source: `"Simply supported beam under a uniform load
'A steel beam spans L and carries a uniformly distributed load q. Change the values in the boxes.
L = ?{6} m 'span
q = ?{12} kN/m 'load
E = 200 GPa 'modulus of elasticity
I = 8360 cm^4 'second moment of area (an IPE 300)
"Reactions and moment
R = q*L/2
M_max = q*L^2/8
"Deflection at midspan
δ_max = 5*q*L^4/(384*E*I)
δ_max|mm
δ_allow = L/250
#if δ_max ≤ δ_allow
'The deflection is within L/250.
#else
'The deflection exceeds L/250: choose a stiffer section.
#end if
"Bending moment along the beam
M(x) = q*x*(L - x)/2
$Plot{M(x)/(kN*m) @ x = 0 m : L}`,
  },
  {
    id: 'led',
    title: 'LED series resistor',
    source: `"LED series resistor
V_s = ?{9} V 'supply
V_f = ?{2} V 'LED forward voltage
I_f = ?{20} mA 'LED current
R = (V_s - V_f)/I_f
P = I_f^2*R
'Choose the next larger standard value, and a resistor rated at least twice P.`,
  },
  {
    id: 'methods',
    title: 'Equations, integrals and loops',
    source: `"Numerical methods
f(x) = x^3 - 2*x - 5
x_1 = $Root{f(x) = 0 @ x = 2 : 3}
f(x_1)
A = $Area{f(x) @ x = 0 : 3}
y_max = $Sup{sin(x) @ x = 0 : 180}
k = $Slope{x^2 @ x = 3}
S = $Sum{1/n^2 @ n = 1 : 1000}
'S approaches π²/6:
π^2/6
"A table by a loop
#for i = 1 : 4
a_i = 2^i
#loop
$Plot{f(x) & 3*x @ x = 0 : 3}
$Map{sin(x)*cos(y) @ x = 0 : 360 & y = 0 : 360}`,
  },
  {
    id: 'units',
    title: 'Units and conversions',
    source: `"Working with units
v = 72 km/h
v|m/s
t = 15 min
d = v*t
F = 2 kN
A = 40 cm^2
σ = F/A
σ|MPa
T = 25 degC
T|degF
"Matrices
K = [4; -2 | -2; 4]
u = [1; 2]
K*u
det(K)
inv(K)`,
  },
];

/* --------------------------------------------------------------- reports -- */

/** Note text as HTML: escaped, with Calcpad's simple tags (b, i, u, sub, sup, br, em, strong) kept. */
export function inlineHtml(text: string): string {
  return escapeXml(text)
    .replace(/&lt;(\/?)(b|i|u|em|strong|sub|sup|small|mark)&gt;/gi, (_m, close: string, tag: string) => `<${close}${tag.toLowerCase()}>`)
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
}

export interface RenderedTex {
  readonly svg: string;
  /** How far the picture reaches below the text baseline, in pixels. */
  readonly depth: number;
}

const REPORT_CSS = `
:root { color-scheme: light; }
body { margin: 0; background: #ffffff; color: #1f2328; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; }
main { max-width: 820px; margin: 0 auto; padding: 28px 32px 40px; }
h1 { font-size: 24px; line-height: 1.25; margin: 0 0 14px; }
h2 { font-size: 18px; line-height: 1.3; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #d1d9e0; }
p { margin: 6px 0; }
.eq { margin: 8px 0; }
.eq svg { vertical-align: middle; }
.note { color: #59636e; font-style: italic; margin-left: 10px; }
.warn { display: block; color: #9a6700; font-size: 13px; }
.box { display: inline-block; min-width: 3em; padding: 0 6px; margin: 0 4px; border: 1px solid #818b98; border-radius: 3px; background: #fff8c5; font-variant-numeric: tabular-nums; }
.error { color: #d1242f; font-size: 13px; }
figure { margin: 12px 0; }
figure svg { max-width: 100%; height: auto; }
@media print { main { padding: 0; } h2 { break-after: avoid; } .eq, figure { break-inside: avoid; } }
@page { margin: 16mm; }
`;

/** A worksheet's report as a standalone page (nothing loaded from outside, no scripts). */
export function reportHtml(blocks: readonly Block[], render: (tex: string) => RenderedTex, title: string): string {
  const tex = (latex: string) => {
    const r = render(latex);
    return r.svg.replace('<svg', `<svg style="vertical-align: -${r.depth}px"`);
  };
  let headings = 0;
  const body = blocks
    .map((b) => {
      switch (b.kind) {
        case 'heading':
          return headings++ === 0 ? `<h1>${inlineHtml(b.text)}</h1>` : `<h2>${inlineHtml(b.text)}</h2>`;
        case 'text':
          return `<p>${inlineHtml(b.text)}</p>`;
        case 'math':
          return `<p class="eq">${tex(b.tex)}${b.note ? `<span class="note">${inlineHtml(b.note)}</span>` : ''}${b.warning ? `<span class="warn">${escapeXml(b.warning)}</span>` : ''}</p>`;
        case 'input':
          return `<p class="eq">${tex(b.label)}<span class="box">${escapeXml(b.value)}</span>${b.unit ? tex(b.unit) : ''}${b.note ? `<span class="note">${inlineHtml(b.note)}</span>` : ''}</p>`;
        case 'plot':
          return `<figure>${b.svg}</figure>`;
        default:
          return `<p class="error">Line ${b.line}: ${escapeXml(b.message)}</p>`;
      }
    })
    .join('\n');
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeXml(title)}</title>\n<style>${REPORT_CSS}</style>\n</head>\n<body>\n<main>\n${body}\n</main>\n</body>\n</html>\n`;
}

/** The report's title: its first heading, else "Worksheet". */
export function reportTitle(blocks: readonly Block[]): string {
  const first = blocks.find((b) => b.kind === 'heading');
  return first && first.kind === 'heading' ? first.text.replace(/<[^>]*>/g, '').slice(0, 120) || 'Worksheet' : 'Worksheet';
}
