/**
 * Transfer functions in s for the Laplace block: a small parser that turns
 * an expression such as `1/(1 + s/1k)` or `100/(s^2 + 10s + 100)` into a
 * ratio of polynomials, its value at a frequency, and a state-space form
 * for the time domain.
 */

/** Polynomial coefficients from the constant term upwards. */
export type Poly = readonly number[];

export interface Rational {
  readonly num: Poly;
  readonly den: Poly;
}

const SUFFIX: Readonly<Record<string, number>> = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, µ: 1e-6, μ: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };

function trim(p: readonly number[]): number[] {
  const out = [...p];
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out.length ? out : [0];
}

function add(a: Poly, b: Poly): number[] {
  return trim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0)));
}

function mul(a: Poly, b: Poly): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => {
    b.forEach((y, j) => {
      out[i + j] = (out[i + j] as number) + x * y;
    });
  });
  return trim(out);
}

const scale = (a: Poly, k: number) => trim(a.map((x) => x * k));
const isZero = (p: Poly) => p.every((x) => x === 0);

const ratio = (num: Poly, den: Poly = [1]): Rational => ({ num: trim(num), den: trim(den) });
const plus = (a: Rational, b: Rational) => ratio(add(mul(a.num, b.den), mul(b.num, a.den)), mul(a.den, b.den));
const times = (a: Rational, b: Rational) => ratio(mul(a.num, b.num), mul(a.den, b.den));
function over(a: Rational, b: Rational): Rational {
  if (isZero(b.num)) throw new Error('Division by zero in the transfer function.');
  return ratio(mul(a.num, b.den), mul(a.den, b.num));
}
const negate = (a: Rational) => ratio(scale(a.num, -1), a.den);

function power(a: Rational, n: number): Rational {
  if (!Number.isInteger(n) || Math.abs(n) > 20) throw new Error('Powers must be whole numbers up to 20.');
  let out = ratio([1]);
  for (let i = 0; i < Math.abs(n); i++) out = times(out, a);
  return n < 0 ? over(ratio([1]), out) : out;
}

/**
 * Parses an expression in s: numbers (with SI suffixes such as k, M, m, u,
 * n, p), s, pi, + − * / ^ (whole powers), brackets, and multiplication
 * written by juxtaposition (`10s`, `(s+1)(s+2)`).
 */
export function parseTransfer(text: string): Rational {
  const src = text.replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/×/g, '*').replace(/π/g, 'pi');
  let at = 0;
  const peek = () => src[at] ?? '';
  const fail = (why: string): never => {
    throw new Error(`${why} at character ${at + 1} of the transfer function.`);
  };
  function primary(): Rational {
    const c = peek();
    if (c === '(') {
      at++;
      const v = sum();
      if (peek() !== ')') fail('Expected a closing bracket');
      at++;
      return v;
    }
    if (c === 's') {
      at++;
      return ratio([0, 1]);
    }
    if (src.startsWith('pi', at)) {
      at += 2;
      return ratio([Math.PI]);
    }
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(at));
    if (!m) return fail(c ? `Unexpected “${c}”` : 'Unexpected end');
    at += m[0].length;
    let value = Number(m[0]);
    const suffix = peek();
    // An SI suffix (10k, 1m), unless the p starts pi.
    if (suffix in SUFFIX && !(suffix === 'p' && src[at + 1] === 'i')) {
      value *= SUFFIX[suffix] as number;
      at++;
    }
    return ratio([value]);
  }
  function factor(): Rational {
    const base = primary();
    if (peek() !== '^') return base;
    at++;
    let sign = 1;
    if (peek() === '-') {
      sign = -1;
      at++;
    }
    const m = /^\d+/.exec(src.slice(at));
    if (!m) return fail('Expected a whole-number power');
    at += m[0].length;
    return power(base, sign * Number(m[0]));
  }
  function unary(): Rational {
    if (peek() === '-') {
      at++;
      return negate(unary());
    }
    if (peek() === '+') {
      at++;
      return unary();
    }
    return factor();
  }
  function product(): Rational {
    let v = unary();
    for (;;) {
      const c = peek();
      if (c === '*') {
        at++;
        v = times(v, unary());
      } else if (c === '/') {
        at++;
        v = over(v, unary());
      } else if (c === '(' || c === 's' || c === 'p' || /[\d.]/.test(c)) v = times(v, factor());
      else return v;
    }
  }
  function sum(): Rational {
    let v = product();
    for (;;) {
      const c = peek();
      if (c === '+') {
        at++;
        v = plus(v, product());
      } else if (c === '-') {
        at++;
        v = plus(v, negate(product()));
      } else return v;
    }
  }
  if (!src) throw new Error('Enter a transfer function, such as 1/(1 + s/1000).');
  const result = sum();
  if (at < src.length) fail(`Unexpected “${peek()}”`);
  if (isZero(result.den)) throw new Error('The denominator is zero.');
  // Scale so the denominator's highest power has coefficient 1.
  const lead = result.den[result.den.length - 1] as number;
  return ratio(scale(result.num, 1 / lead), scale(result.den, 1 / lead));
}

/** H(jω) as [real, imaginary]. */
export function evaluate(h: Rational, omega: number): [number, number] {
  const at = (p: Poly): [number, number] => {
    let re = 0;
    let im = 0;
    for (let i = p.length - 1; i >= 0; i--) {
      // (re + j·im)·jω + c
      const r = -im * omega + (p[i] as number);
      im = re * omega;
      re = r;
    }
    return [re, im];
  };
  const [nr, ni] = at(h.num);
  const [dr, di] = at(h.den);
  const d = dr * dr + di * di;
  if (d === 0) return [Number.POSITIVE_INFINITY, 0];
  return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d];
}

/** Whether the function has no more zeros than poles (so it can run in the time domain). */
export const isProper = (h: Rational) => h.num.length <= h.den.length;

/**
 * Controllable canonical state-space form: x' = A·x + B·u, y = C·x + D·u,
 * with A the companion matrix of the (monic) denominator and B = [0 … 0 1].
 */
export interface StateSpace {
  readonly order: number;
  /** Row-major n×n. */
  readonly a: Float64Array;
  readonly c: Float64Array;
  readonly d: number;
}

export function stateSpace(h: Rational): StateSpace {
  if (!isProper(h)) throw new Error('The transfer function has more zeros than poles, so it cannot run in the time domain.');
  const n = h.den.length - 1;
  // Denominator is monic (parseTransfer scales it); split off the direct term.
  const num = [...h.num, ...new Array<number>(Math.max(0, h.den.length - h.num.length)).fill(0)];
  const d = n >= 0 && num.length === h.den.length ? (num[n] as number) : 0;
  const rest = num.slice(0, n).map((c, i) => c - d * (h.den[i] as number));
  const a = new Float64Array(n * n);
  for (let i = 0; i < n - 1; i++) a[i * n + i + 1] = 1;
  for (let j = 0; j < n; j++) a[(n - 1) * n + j] = -(h.den[j] as number);
  return { order: n, a, c: Float64Array.from(rest), d };
}

/** Solves M·x = b in place for a small dense system (returns false if singular). */
export function solveSmall(m: Float64Array, b: Float64Array, n: number): boolean {
  for (let k = 0; k < n; k++) {
    let best = k;
    for (let r = k + 1; r < n; r++) if (Math.abs(m[r * n + k] as number) > Math.abs(m[best * n + k] as number)) best = r;
    if (Math.abs(m[best * n + k] as number) < 1e-300) return false;
    if (best !== k) {
      for (let c = 0; c < n; c++) {
        const t = m[k * n + c] as number;
        m[k * n + c] = m[best * n + c] as number;
        m[best * n + c] = t;
      }
      const t = b[k] as number;
      b[k] = b[best] as number;
      b[best] = t;
    }
    for (let r = k + 1; r < n; r++) {
      const f = (m[r * n + k] as number) / (m[k * n + k] as number);
      if (f === 0) continue;
      for (let c = k; c < n; c++) m[r * n + c] = (m[r * n + c] as number) - f * (m[k * n + c] as number);
      b[r] = (b[r] as number) - f * (b[k] as number);
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r] as number;
    for (let c = r + 1; c < n; c++) sum -= (m[r * n + c] as number) * (b[c] as number);
    b[r] = sum / (m[r * n + r] as number);
  }
  return true;
}

/** Renders a polynomial ratio back as text, for messages and SPICE comments. */
export function formatTransfer(h: Rational): string {
  const poly = (p: Poly) => {
    const terms: string[] = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const c = p[i] as number;
      if (c === 0) continue;
      const k = Number(c.toPrecision(6));
      const coef = i === 0 ? String(k) : k === 1 ? '' : k === -1 ? '-' : `${k}`;
      terms.push(`${coef}${i === 0 ? '' : i === 1 ? 's' : `s^${i}`}`);
    }
    return terms.length ? terms.join(' + ').replace(/\+ -/g, '- ') : '0';
  };
  return `(${poly(h.num)}) / (${poly(h.den)})`;
}
