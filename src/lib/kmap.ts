/**
 * Karnaugh maps and exact two-level logic minimisation: Quine–McCluskey for
 * the prime implicants, then Petrick's method for the cheapest covers.
 * Works for 2 to 6 variables (and more, slowly).
 */

/** A product term: bits where `mask` is 1 are fixed to the bits of `value`; the rest are free. */
export interface Implicant {
  readonly mask: number;
  readonly value: number;
}

export type Cell = 0 | 1 | 'x';

const popcount = (v: number): number => {
  let n = 0;
  for (let x = v; x; x &= x - 1) n++;
  return n;
};

export const covers = (imp: Implicant, minterm: number): boolean => (minterm & imp.mask) === imp.value;

/** Every minterm an implicant covers. */
export function mintermsOf(imp: Implicant, vars: number): number[] {
  const out: number[] = [];
  for (let m = 0; m < 1 << vars; m++) if (covers(imp, m)) out.push(m);
  return out;
}

/** The prime implicants of the function that is 1 on `ones`, free on `dontCares`. */
export function primeImplicants(vars: number, ones: readonly number[], dontCares: readonly number[] = []): Implicant[] {
  const full = (1 << vars) - 1;
  let current = new Map<string, Implicant>();
  for (const m of new Set([...ones, ...dontCares])) current.set(`${full}:${m}`, { mask: full, value: m });
  const primes = new Map<string, Implicant>();
  while (current.size) {
    const list = [...current.values()];
    const used = new Set<string>();
    const next = new Map<string, Implicant>();
    // Group by mask, then combine terms that differ in one fixed bit.
    const byMask = new Map<number, Implicant[]>();
    for (const t of list) {
      const group = byMask.get(t.mask);
      if (group) group.push(t);
      else byMask.set(t.mask, [t]);
    }
    for (const group of byMask.values()) {
      const byValue = new Set(group.map((t) => t.value));
      for (const t of group) {
        for (let bit = 1; bit <= full; bit <<= 1) {
          if (!(t.mask & bit) || t.value & bit) continue;
          const partner = t.value | bit;
          if (!byValue.has(partner)) continue;
          const merged = { mask: t.mask & ~bit, value: t.value & ~bit };
          next.set(`${merged.mask}:${merged.value}`, merged);
          used.add(`${t.mask}:${t.value}`);
          used.add(`${t.mask}:${partner}`);
        }
      }
    }
    for (const t of list) if (!used.has(`${t.mask}:${t.value}`)) primes.set(`${t.mask}:${t.value}`, t);
    current = next;
  }
  // Terms made only of don't-cares are of no use.
  return [...primes.values()].filter((p) => ones.some((m) => covers(p, m))).sort((a, b) => popcount(a.mask) - popcount(b.mask) || a.value - b.value);
}

const literals = (imp: Implicant): number => popcount(imp.mask);

export interface Cover {
  readonly terms: readonly Implicant[];
  /** Prime implicants every cover must use. */
  readonly essential: readonly Implicant[];
  /** All the primes found. */
  readonly primes: readonly Implicant[];
  /** How many covers tie for cheapest (at most 50 are counted). */
  readonly alternatives: number;
  /** False when the search had to settle for a good cover rather than a proven best one. */
  readonly exact: boolean;
}

/** The cheapest cover (fewest terms, then fewest literals) of `ones` by prime implicants. */
export function minimalCover(vars: number, ones: readonly number[], dontCares: readonly number[] = []): Cover {
  const care = [...new Set(ones)].filter((m) => !dontCares.includes(m)).sort((a, b) => a - b);
  const primes = primeImplicants(vars, care, dontCares);
  if (!care.length) return { terms: [], essential: [], primes: [], alternatives: 1, exact: true };
  const essential: Implicant[] = [];
  for (const m of care) {
    const by = primes.filter((p) => covers(p, m));
    const only = by[0];
    if (by.length === 1 && only && !essential.includes(only)) essential.push(only);
  }
  const left = care.filter((m) => !essential.some((p) => covers(p, m)));
  if (!left.length) return { terms: essential, essential, primes, alternatives: 1, exact: true };
  const pool = primes.filter((p) => !essential.includes(p) && left.some((m) => covers(p, m)));
  // Petrick's method: multiply out the sums of primes covering each minterm, as sets of pool indices.
  let products: bigint[] = [0n];
  let exact = true;
  for (const m of left) {
    const options = pool.map((p, i) => (covers(p, m) ? i : -1)).filter((i) => i >= 0);
    const next = new Set<bigint>();
    for (const product of products) {
      if (options.some((i) => product & (1n << BigInt(i)))) {
        next.add(product);
        continue;
      }
      for (const i of options) next.add(product | (1n << BigInt(i)));
    }
    // Absorption: drop any product that contains another.
    let kept = [...next].sort((a, b) => bitCount(a) - bitCount(b));
    kept = kept.filter((p, i) => !kept.slice(0, i).some((q) => (p & q) === q));
    if (kept.length > 4000) {
      exact = false;
      kept = kept.sort((a, b) => cost(a) - cost(b)).slice(0, 4000);
    }
    products = kept;
  }
  function bitCount(v: bigint): number {
    let n = 0;
    for (let x = v; x; x &= x - 1n) n++;
    return n;
  }
  function cost(v: bigint): number {
    let terms = 0;
    let lits = 0;
    pool.forEach((p, i) => {
      if (v & (1n << BigInt(i))) {
        terms++;
        lits += literals(p);
      }
    });
    return terms * 1000 + lits;
  }
  const ranked = products.map((p) => ({ p, c: cost(p) })).sort((a, b) => a.c - b.c);
  const best = ranked[0]?.p ?? 0n;
  const alternatives = Math.min(50, ranked.filter((r) => r.c === ranked[0]?.c).length);
  const chosen = pool.filter((_, i) => best & (1n << BigInt(i)));
  return { terms: [...essential, ...chosen], essential, primes, alternatives, exact };
}

export type Form = 'sop' | 'pos';

/** A term as text: a product (A·B′) for sum-of-products, a sum (A + B′) for product-of-sums. */
export function termText(imp: Implicant, names: readonly string[], form: Form, style: 'math' | 'c' | 'verilog' = 'math'): string {
  const vars = names.length;
  const parts: string[] = [];
  for (let i = 0; i < vars; i++) {
    const bit = 1 << (vars - 1 - i);
    if (!(imp.mask & bit)) continue;
    const name = names[i] ?? `x${i}`;
    // In a product-of-sums term the literal is complemented: a maxterm's 1 bit is the variable negated.
    const positive = form === 'sop' ? Boolean(imp.value & bit) : !(imp.value & bit);
    if (style === 'math') parts.push(positive ? name : `${name}′`);
    else if (style === 'c') parts.push(positive ? name : `!${name}`);
    else parts.push(positive ? name : `~${name}`);
  }
  if (!parts.length) return form === 'sop' ? '1' : '0';
  if (form === 'sop') return parts.join(style === 'math' ? '·' : style === 'c' ? ' && ' : ' & ');
  const sum = parts.join(style === 'math' ? ' + ' : style === 'c' ? ' || ' : ' | ');
  return parts.length > 1 ? `(${sum})` : sum;
}

/** A whole expression from its terms. */
export function expressionText(terms: readonly Implicant[], names: readonly string[], form: Form, style: 'math' | 'c' | 'verilog' = 'math'): string {
  if (!terms.length) return form === 'sop' ? '0' : '1';
  const texts = terms.map((t) => termText(t, names, form, style));
  if (form === 'sop') {
    const wrapped = style === 'math' ? texts : texts.map((t) => (terms.length > 1 && t.includes(' ') ? `(${t})` : t));
    return wrapped.join(style === 'math' ? ' + ' : style === 'c' ? ' || ' : ' | ');
  }
  return texts.join(style === 'math' ? '·' : style === 'c' ? ' && ' : ' & ');
}

export interface Minimised {
  readonly sop: Cover;
  /** Covers of the zeros: read as a product of sums. */
  readonly pos: Cover;
}

export function minimise(vars: number, cells: readonly Cell[]): Minimised {
  const ones: number[] = [];
  const zeros: number[] = [];
  const dc: number[] = [];
  cells.forEach((c, m) => {
    if (c === 1) ones.push(m);
    else if (c === 'x') dc.push(m);
    else zeros.push(m);
  });
  return { sop: minimalCover(vars, ones, dc), pos: minimalCover(vars, zeros, dc) };
}

/** Evaluates a cover at a minterm. */
export function evaluate(terms: readonly Implicant[], minterm: number, form: Form): boolean {
  const hit = terms.some((t) => covers(t, minterm));
  return form === 'sop' ? hit : !hit;
}

/* --------------------------------------------------------------- maps -- */

/** Gray code of `bits` bits: 0, 1, 3, 2, 6, 7, 5, 4 … */
export const gray = (bits: number): number[] => Array.from({ length: 1 << bits }, (_, i) => i ^ (i >> 1));

export interface MapLayout {
  /** Variables (most significant first) that pick the sub-map, the row and the column. */
  readonly mapBits: number;
  readonly rowBits: number;
  readonly colBits: number;
}

/** How n variables spread over sub-maps, rows and columns: up to 4 on one map, then 2 or 4 maps. */
export function layout(vars: number): MapLayout {
  const mapBits = Math.max(0, vars - 4);
  const rest = vars - mapBits;
  const rowBits = Math.floor(rest / 2);
  return { mapBits, rowBits, colBits: rest - rowBits };
}

/** The minterm in sub-map `map`, row `r` and column `c` (all in Gray order on screen). */
export function mintermAt(vars: number, map: number, r: number, c: number): number {
  const { rowBits, colBits } = layout(vars);
  const rowCode = gray(rowBits)[r] ?? 0;
  const colCode = gray(colBits)[c] ?? 0;
  return (map << (rowBits + colBits)) | (rowCode << colBits) | colCode;
}

/** Where a minterm is drawn. */
export function cellOf(vars: number, minterm: number): { map: number; row: number; col: number } {
  const { rowBits, colBits } = layout(vars);
  const col = gray(colBits).indexOf(minterm & ((1 << colBits) - 1));
  const row = gray(rowBits).indexOf((minterm >> colBits) & ((1 << rowBits) - 1));
  return { map: minterm >> (rowBits + colBits), row, col };
}

/** Runs of consecutive indices in a cyclic sequence of `size` (a group that wraps around is two runs). */
export function runs(indices: readonly number[], size: number): [number, number][] {
  const set = new Set(indices);
  if (set.size === size) return [[0, size - 1]];
  const out: [number, number][] = [];
  for (let i = 0; i < size; i++) {
    if (!set.has(i) || set.has(i - 1)) continue;
    let j = i;
    while (set.has(j + 1)) j++;
    out.push([i, j]);
  }
  return out;
}

/* ----------------------------------------------------------- reading -- */

/** Minterm numbers from text like "1, 3, 5-7" or "m(1,3,5)". */
export function parseList(text: string, vars: number): number[] {
  const out = new Set<number>();
  const cleaned = text.replace(/[a-zA-Z]+\s*\(/g, '').replace(/[()Σ∑]/g, ' ');
  for (const part of cleaned.split(/[\s,;+]+/).filter(Boolean)) {
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part);
    const nums = range ? Array.from({ length: Math.max(0, Number(range[2]) - Number(range[1]) + 1) }, (_, i) => Number(range[1]) + i) : [Number(part)];
    for (const n of nums) {
      if (!Number.isInteger(n) || n < 0 || n >= 1 << vars) throw new Error(`${part} is not a minterm of ${vars} variables (0 to ${(1 << vars) - 1}).`);
      out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

type Node = { k: 'var'; i: number } | { k: 'const'; v: boolean } | { k: 'not'; a: Node } | { k: 'and' | 'or' | 'xor'; a: Node; b: Node };

/**
 * A Boolean expression to a truth table.  Understands A′, A', !A, ~A and ¬A;
 * AND as ·, *, &, ∧ or two letters side by side; OR as +, |, ∨; XOR as ^ or ⊕.
 */
export function parseExpression(text: string, names: readonly string[]): boolean[] {
  const tokens = text.match(/[A-Za-z_][A-Za-z0-9_]*|[01]|[()+|*&·∧∨^⊕!~¬'′]/g) ?? [];
  if (tokens.join('').replace(/\s/g, '') !== text.replace(/\s/g, '')) throw new Error('The expression has characters I do not understand.');
  let at = 0;
  const peek = () => tokens[at];
  const index = (name: string) => {
    const i = names.findIndex((n) => n.toLowerCase() === name.toLowerCase());
    if (i >= 0) return i;
    throw new Error(`${name} is not one of the variables (${names.join(', ')}).`);
  };
  const atom = (): Node => {
    const t = tokens[at++];
    if (t === undefined) throw new Error('The expression ends too soon.');
    let node: Node;
    if (t === '(') {
      node = or();
      if (tokens[at++] !== ')') throw new Error('A bracket is not closed.');
    } else if (t === '!' || t === '~' || t === '¬') node = { k: 'not', a: atom() };
    else if (t === '0' || t === '1') node = { k: 'const', v: t === '1' };
    else if (/^[A-Za-z_]/.test(t)) {
      // Several single-letter names run together (AB) mean A AND B.
      if (!names.some((n) => n.toLowerCase() === t.toLowerCase()) && [...t].every((c) => names.some((n) => n.toLowerCase() === c.toLowerCase()))) {
        node = [...t].map((c): Node => ({ k: 'var', i: index(c) })).reduce((a, b) => ({ k: 'and', a, b }));
      } else node = { k: 'var', i: index(t) };
    } else throw new Error(`Unexpected “${t}”.`);
    while (peek() === "'" || peek() === '′') {
      at++;
      node = { k: 'not', a: node };
    }
    return node;
  };
  const and = (): Node => {
    let node = atom();
    for (;;) {
      const t = peek();
      if (t === '*' || t === '&' || t === '·' || t === '∧') {
        at++;
        node = { k: 'and', a: node, b: atom() };
      } else if (t !== undefined && (t === '(' || t === '!' || t === '~' || t === '¬' || t === '0' || t === '1' || /^[A-Za-z_]/.test(t))) node = { k: 'and', a: node, b: atom() };
      else return node;
    }
  };
  const xor = (): Node => {
    let node = and();
    while (peek() === '^' || peek() === '⊕') {
      at++;
      node = { k: 'xor', a: node, b: and() };
    }
    return node;
  };
  function or(): Node {
    let node = xor();
    while (peek() === '+' || peek() === '|' || peek() === '∨') {
      at++;
      node = { k: 'or', a: node, b: xor() };
    }
    return node;
  }
  if (!tokens.length) throw new Error('Type an expression, such as A′B + AC.');
  const tree = or();
  if (at < tokens.length) throw new Error(`Unexpected “${tokens[at]}”.`);
  const vars = names.length;
  const value = (n: Node, m: number): boolean => {
    switch (n.k) {
      case 'var':
        return Boolean(m & (1 << (vars - 1 - n.i)));
      case 'const':
        return n.v;
      case 'not':
        return !value(n.a, m);
      case 'and':
        return value(n.a, m) && value(n.b, m);
      case 'or':
        return value(n.a, m) || value(n.b, m);
      case 'xor':
        return value(n.a, m) !== value(n.b, m);
    }
  };
  return Array.from({ length: 1 << vars }, (_, m) => value(tree, m));
}
