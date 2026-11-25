/**
 * Chemical equations: reading species (formulas with charges and states),
 * balancing by exact rational arithmetic (the null space of the element and
 * charge matrix), redox in acidic or basic solution and half-reactions,
 * oxidation states by the textbook rules, stoichiometry with the limiting
 * reagent, and empirical and molecular formulas.  Every result carries the
 * worked steps.  Formulas in TeX use mhchem's \ce{}.
 */
import { elementBySymbol, formulaCounts } from './elements';

export interface Step {
  readonly rule: string;
  readonly tex: string;
}

export interface Table {
  readonly head: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface ChemResult {
  readonly ok: boolean;
  readonly tex: string;
  readonly text: string;
  readonly steps: readonly Step[];
  readonly check: string;
  readonly note?: string;
  readonly table?: Table;
  readonly value?: number;
}

/* ------------------------------------------------------- numbers for show -- */

/** A number to n significant figures, without trailing zeros or exponent noise. */
export function sig(x: number, n = 4): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e6) return String(Number(x.toPrecision(n)));
  const [m, e] = x.toExponential(n - 1).split('e') as [string, string];
  return `${Number(m)}e${Number(e)}`;
}

/** The same in TeX, with × 10ⁿ for very large and small numbers. */
export function sigTex(x: number, n = 4): string {
  const s = sig(x, n);
  const m = /^(-?[\d.]+)e(-?\d+)$/.exec(s);
  return m ? `${m[1]} \\times 10^{${m[2]}}` : s.replace('∞', '\\infty').replace('−', '-');
}

/* ------------------------------------------------------- exact fractions -- */

const babs = (x: bigint) => (x < 0n ? -x : x);
function bgcd(a: bigint, b: bigint): bigint {
  let x = babs(a);
  let y = babs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

/** A fraction of big integers, always in lowest terms with a positive denominator. */
export class Fraction {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = 1n) {
    if (d === 0n) throw new Error('Division by zero.');
    const g = bgcd(n, d) || 1n;
    const s = d < 0n ? -1n : 1n;
    this.n = (s * n) / g;
    this.d = (s * d) / g;
  }
  static of(x: number | bigint): Fraction {
    if (typeof x === 'bigint') return new Fraction(x);
    if (Number.isInteger(x)) return new Fraction(BigInt(x));
    // Decimals as typed (counts like 0.5 in non-stoichiometric formulas).
    const [whole, frac = ''] = String(x).split('.');
    const scale = 10n ** BigInt(frac.length);
    return new Fraction(BigInt(`${whole}${frac}`), scale);
  }
  add(o: Fraction): Fraction {
    return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Fraction): Fraction {
    return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o: Fraction): Fraction {
    return new Fraction(this.n * o.n, this.d * o.d);
  }
  div(o: Fraction): Fraction {
    return new Fraction(this.n * o.d, this.d * o.n);
  }
  neg(): Fraction {
    return new Fraction(-this.n, this.d);
  }
  get zero(): boolean {
    return this.n === 0n;
  }
  get sign(): number {
    return this.n === 0n ? 0 : this.n > 0n ? 1 : -1;
  }
  toNumber(): number {
    return Number(this.n) / Number(this.d);
  }
  toString(): string {
    return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`;
  }
  toTex(): string {
    if (this.d === 1n) return String(this.n);
    return `${this.n < 0n ? '-' : ''}\\tfrac{${babs(this.n)}}{${this.d}}`;
  }
}

const F0 = new Fraction(0n);
const F1 = new Fraction(1n);

/** A basis of the null space of a matrix of fractions (Gauss–Jordan elimination). */
export function nullSpace(matrix: readonly (readonly Fraction[])[], columns: number): Fraction[][] {
  const m = matrix.map((r) => [...r]);
  const pivots: number[] = [];
  let row = 0;
  for (let c = 0; c < columns && row < m.length; c++) {
    let p = row;
    while (p < m.length && ((m[p] as Fraction[])[c] as Fraction).zero) p++;
    if (p === m.length) continue;
    [m[row], m[p]] = [m[p] as Fraction[], m[row] as Fraction[]];
    const lead = (m[row] as Fraction[])[c] as Fraction;
    m[row] = (m[row] as Fraction[]).map((x) => x.div(lead));
    for (let r = 0; r < m.length; r++) {
      if (r === row) continue;
      const f = (m[r] as Fraction[])[c] as Fraction;
      if (f.zero) continue;
      m[r] = (m[r] as Fraction[]).map((x, j) => x.sub(f.mul((m[row] as Fraction[])[j] as Fraction)));
    }
    pivots.push(c);
    row++;
  }
  const free = Array.from({ length: columns }, (_, c) => c).filter((c) => !pivots.includes(c));
  return free.map((f) => {
    const v = Array.from({ length: columns }, () => F0);
    v[f] = F1;
    pivots.forEach((pc, i) => {
      v[pc] = ((m[i] as Fraction[])[f] as Fraction).neg();
    });
    return v;
  });
}

/** The smallest whole numbers in the same ratio. */
function wholeNumbers(v: readonly Fraction[]): bigint[] {
  let l = 1n;
  for (const x of v) l = (l * x.d) / (bgcd(l, x.d) || 1n);
  const ints = v.map((x) => (x.n * l) / x.d);
  let g = 0n;
  for (const x of ints) g = bgcd(g, x);
  return ints.map((x) => (g ? x / g : x));
}

/* --------------------------------------------------------------- species -- */

export interface Species {
  /** How it is written in mhchem: "Fe^3+", "SO4^2-", "H2O(l)", "e-". */
  readonly ce: string;
  readonly formula: string;
  readonly charge: number;
  readonly state: 's' | 'l' | 'g' | 'aq' | null;
  readonly atoms: ReadonlyMap<string, number>;
  readonly electron: boolean;
  /** How an ambiguous way of writing it was read. */
  readonly note?: string;
}

const METALS = new Set(
  'Li Be Na Mg Al K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po Fr Ra Ac Th Pa U Np Pu Am'.split(
    ' ',
  ),
);

const MINUS = /[−–]/g;

/** Reads one species: "Fe^3+", "SO4^2-", "NH4+", "[Fe(CN)6]^3-", "Cu(s)", "e-", "CuSO4·5H2O". */
export function parseSpecies(token0: string): Species {
  let token = token0.trim().replace(MINUS, '-').replace(/\s+/g, '');
  if (!token) throw new Error('An empty term: check for a doubled “+”.');
  // A coefficient typed in front is recomputed anyway.
  token = token.replace(/^\d+(?:\.\d+)?(?=[A-Z([{e])/, '');
  let state: Species['state'] = null;
  const st = /\((s|l|g|aq)\)$/i.exec(token);
  if (st) {
    state = (st[1] as string).toLowerCase() as Species['state'];
    token = token.slice(0, st.index);
  }
  if (/^e(\^?-|\^\{-\}|\{-\})?$/.test(token)) return { ce: 'e-', formula: 'e', charge: -1, state: null, atoms: new Map(), electron: true };
  let charge = 0;
  let formula = token;
  let note: string | undefined;
  const caret = /\^\{?(\d*)([+-])\}?$/.exec(token);
  const braces = caret ? null : /\{(\d*)([+-])\}$/.exec(token);
  const signFirst = caret || braces ? null : /([+-])(\d+)$/.exec(token);
  const metalIon = caret || braces || signFirst ? null : /^([A-Z][a-z]?)(\d+)([+-])$/.exec(token);
  const trailing = caret || braces || signFirst || (metalIon && METALS.has(metalIon[1] as string)) ? null : /([+-]+)$/.exec(token);
  const m = caret ?? braces;
  if (m) {
    charge = (m[2] === '-' ? -1 : 1) * (m[1] ? Number(m[1]) : 1);
    formula = token.slice(0, m.index);
  } else if (signFirst) {
    charge = (signFirst[1] === '-' ? -1 : 1) * Number(signFirst[2]);
    formula = token.slice(0, signFirst.index);
  } else if (metalIon && METALS.has(metalIon[1] as string)) {
    // Fe3+ is the iron(III) ion, not Fe₃⁺.
    charge = (metalIon[3] === '-' ? -1 : 1) * Number(metalIon[2]);
    formula = metalIon[1] as string;
    note = `${token} read as ${formula}^${metalIon[2]}${metalIon[3]}`;
  } else if (trailing) {
    charge = (trailing[1]?.[0] === '-' ? -1 : 1) * (trailing[1] as string).length;
    formula = token.slice(0, trailing.index);
  }
  if (!formula) throw new Error(`“${token0.trim()}” has no formula.`);
  let atoms: Map<string, number>;
  try {
    atoms = formulaCounts(formula);
  } catch (e) {
    throw new Error(`“${token0.trim()}”: ${e instanceof Error ? e.message : String(e)}`);
  }
  for (const symbol of atoms.keys())
    if (!elementBySymbol(symbol)) throw new Error(`“${symbol}” in “${token0.trim()}” is not an element. Symbols start with a capital letter: Co is cobalt, CO is carbon monoxide.`);
  const chargeText = charge === 0 ? '' : `^${Math.abs(charge) === 1 ? '' : Math.abs(charge)}${charge > 0 ? '+' : '-'}`;
  const ce = `${formula.replace(/[·•*]/g, '*')}${chargeText}${state ? `(${state})` : ''}`;
  return { ce, formula, charge, state, atoms, electron: false, ...(note ? { note } : {}) };
}

/** Plain text with Unicode subscripts and superscripts: "SO₄²⁻". */
export function speciesText(s: Species): string {
  if (s.electron) return 'e⁻';
  const sub = '₀₁₂₃₄₅₆₇₈₉';
  const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const body = s.formula
    .split(/[·*•]/)
    .map((part) => {
      const lead = /^\d+/.exec(part)?.[0] ?? '';
      return lead + part.slice(lead.length).replace(/\d/g, (c) => sub[Number(c)] as string);
    })
    .join('·');
  const charge = s.charge === 0 ? '' : `${Math.abs(s.charge) === 1 ? '' : [...String(Math.abs(s.charge))].map((c) => sup[Number(c)]).join('')}${s.charge > 0 ? '⁺' : '⁻'}`;
  return `${body}${charge}${s.state ? `(${s.state})` : ''}`;
}

/** Splits one side of an equation into its terms; "+" also ends charges such as NH4+. */
export function splitTerms(side: string): string[] {
  const out: string[] = [];
  let token = '';
  let depth = 0;
  const text = side.replace(MINUS, '-');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (ch !== '+') {
      token += ch;
      continue;
    }
    const prev = text[i - 1] ?? '';
    const next = text[i + 1] ?? '';
    const rest = text.slice(i + 1).trimStart();
    let charge: boolean;
    if (depth > 0 || prev === '^' || /\^\d+$/.test(token)) charge = true;
    else if (/^\((aq|s|l|g)\)/i.test(text.slice(i + 1))) charge = true;
    else if (next === '') charge = token.trim() !== '';
    else if (/\s/.test(next)) charge = token.trim() !== '' && !/\s/.test(prev) && (rest === '' || rest.startsWith('+'));
    else if (/\s/.test(prev)) charge = false;
    else if (next === '+') charge = true;
    else charge = false;
    if (charge) token += ch;
    else {
      if (token.trim()) out.push(token.trim());
      token = '';
    }
  }
  if (token.trim()) out.push(token.trim());
  return out;
}

export interface Equation {
  readonly reactants: readonly Species[];
  readonly products: readonly Species[];
  readonly reversible: boolean;
}

export function parseEquation(text: string): Equation {
  const t = text.trim();
  const arrow = /\s*(<=>|<->|⇌|⇄|<-->|-->|->|→|⟶|=>|=)\s*/.exec(t);
  if (!arrow) throw new Error('Write the reaction with an arrow between the two sides: H2 + O2 -> H2O.');
  const left = t.slice(0, arrow.index);
  const right = t.slice(arrow.index + arrow[0].length);
  if (/(<=>|<->|⇌|⇄|->|→|⟶|=>|=)/.test(right)) throw new Error('Only one arrow, please.');
  const reactants = splitTerms(left).map(parseSpecies);
  const products = splitTerms(right).map(parseSpecies);
  if (!reactants.length || !products.length) throw new Error('Both sides of the arrow need at least one species.');
  return { reactants, products, reversible: /<=>|<->|⇌|⇄/.test(arrow[1] as string) };
}

/* -------------------------------------------------------------- balancing -- */

export interface Term {
  readonly species: Species;
  readonly coefficient: number;
}

export interface Balanced extends ChemResult {
  readonly reactants: readonly Term[];
  readonly products: readonly Term[];
  readonly reversible: boolean;
  /** Other ratios balance too (independent reactions); this is the simplest. */
  readonly unique: boolean;
  readonly redox: readonly string[];
}

export type Medium = 'none' | 'acidic' | 'basic';

const LETTERS = 'abcdfghjkmnpqrstuvwxyz';

function cePart(terms: readonly Term[]): string {
  return terms.map((t) => `${t.coefficient === 1 ? '' : `${t.coefficient} `}${t.species.ce}`).join(' + ');
}
function textPart(terms: readonly Term[]): string {
  return terms.map((t) => `${t.coefficient === 1 ? '' : `${t.coefficient} `}${speciesText(t.species)}`).join(' + ');
}
export function equationTex(reactants: readonly Term[], products: readonly Term[], reversible = false): string {
  return `\\ce{${cePart(reactants)} ${reversible ? '<=>' : '->'} ${cePart(products)}}`;
}
export function equationText(reactants: readonly Term[], products: readonly Term[], reversible = false): string {
  return `${textPart(reactants)} ${reversible ? '⇌' : '→'} ${textPart(products)}`;
}

/**
 * Balances an equation.  In acidic or basic solution water and H⁺ (or OH⁻)
 * are added where they are needed; a half-reaction adds electrons.  Throws
 * when no positive coefficients balance it.
 */
export function balance(input: string, options: { medium?: Medium; half?: boolean } = {}): Balanced {
  const eq = parseEquation(input);
  const medium = options.medium ?? 'none';
  const fixed = [...eq.reactants, ...eq.products];
  const has = (ce: string) => fixed.some((s) => s.ce.replace(/\((aq|l)\)$/, '') === ce);
  const extras: Species[] = [];
  if (medium !== 'none') {
    if (!has('H2O')) extras.push(parseSpecies('H2O'));
    if (medium === 'acidic' && !has('H^+')) extras.push(parseSpecies('H^+'));
    if (medium === 'basic' && !has('OH^-')) extras.push(parseSpecies('OH^-'));
  }
  if (options.half && !fixed.some((s) => s.electron)) extras.push(parseSpecies('e-'));
  const all = [...fixed, ...extras];
  const nR = eq.reactants.length;
  const nFixed = fixed.length;
  const elements: string[] = [];
  for (const s of all) for (const el of s.atoms.keys()) if (!elements.includes(el)) elements.push(el);
  const charged = all.some((s) => s.charge !== 0);
  const rows = [...elements, ...(charged ? ['charge'] : [])];
  const sign = (j: number) => (j < nR || j >= nFixed ? 1 : -1);
  const entry = (row: string, j: number) => {
    const s = all[j] as Species;
    const raw = row === 'charge' ? s.charge : (s.atoms.get(row) ?? 0);
    return Fraction.of(raw).mul(Fraction.of(sign(j)));
  };
  const matrix = rows.map((row) => all.map((_, j) => entry(row, j)));
  const basis = nullSpace(matrix, all.length);
  // Elements that appear on one side only cannot balance.
  for (const el of elements) {
    const left = all.some((s, j) => (j < nR || j >= nFixed) && s.atoms.has(el));
    const right = all.some((s, j) => (j >= nR || j >= nFixed) && s.atoms.has(el));
    if (!left || !right)
      throw new Error(`${el} appears on only one side, so the equation cannot balance. Check the formulas${medium === 'none' ? ', or choose acidic or basic solution for a redox reaction' : ''}.`);
  }
  if (!basis.length)
    throw new Error(
      `No coefficients balance this equation${charged ? ' (the charges cannot match)' : ''}. Check the formulas${medium === 'none' && charged ? ', or choose acidic or basic solution' : ''}.`,
    );
  // One solution, or the simplest positive combination of several.
  let vector: Fraction[] | null = null;
  let unique = basis.length === 1;
  let pinnedNote = '';
  const positive = (v: readonly Fraction[]) => v.slice(0, nFixed).every((x) => x.sign > 0);
  if (basis.length === 1) {
    const v = basis[0] as Fraction[];
    const flipped = (v[0] as Fraction).sign < 0 ? v.map((x) => x.neg()) : v;
    if (positive(flipped)) vector = flipped;
    else {
      const bad = flipped.slice(0, nFixed).findIndex((x) => x.sign <= 0);
      const s = fixed[bad] as Species;
      throw new Error(
        (flipped[bad] as Fraction).zero ? `${speciesText(s)} takes no part in this reaction: leave it out.` : `This balances only with ${speciesText(s)} on the other side of the arrow.`,
      );
    }
  } else {
    // Redox pairs pin the ratio down: the atoms that change state go from one species to one other.
    const pinned = pinByRedoxPairs(all, nR, nFixed, matrix);
    if (pinned) {
      vector = pinned.vector;
      pinnedNote = pinned.note;
      unique = true;
    }
  }
  if (!vector) {
    let best: { v: Fraction[]; total: bigint } | null = null;
    const range = basis.length === 2 ? 12 : basis.length === 3 ? 5 : 2;
    const weights = (k: number): number[][] => (k === 0 ? [[]] : weights(k - 1).flatMap((w) => Array.from({ length: 2 * range + 1 }, (_, i) => [...w, i - range])));
    for (const w of weights(basis.length)) {
      if (w.every((x) => x === 0)) continue;
      const v = Array.from({ length: all.length }, (_, j) => basis.reduce((acc, b, i) => acc.add((b[j] as Fraction).mul(Fraction.of(w[i] as number))), F0));
      if (!positive(v)) continue;
      const ints = wholeNumbers(v);
      const total = ints.slice(0, nFixed).reduce((a, b) => a + babs(b), 0n);
      if (!best || total < best.total) best = { v, total };
    }
    if (!best) throw new Error('This equation has no balance with every species taking part. Check the formulas.');
    vector = best.v;
    unique = false;
  }
  const ints = wholeNumbers(vector);
  const reactants: Term[] = [];
  const products: Term[] = [];
  all.forEach((s, j) => {
    const c = Number(ints[j] as bigint);
    if (j < nR) reactants.push({ species: s, coefficient: c });
    else if (j < nFixed) products.push({ species: s, coefficient: c });
    else if (c > 0) reactants.push({ species: s, coefficient: c });
    else if (c < 0) products.push({ species: s, coefficient: -c });
  });
  // Steps.
  const steps: Step[] = [];
  const letter = (j: number) => LETTERS[j] ?? `x_{${j}}`;
  if (extras.length)
    steps.push({ rule: `Add what the reaction may need: ${extras.map(speciesText).join(', ')} (their side is decided by the algebra)`, tex: extras.map((s) => `\\ce{${s.ce}}`).join(',\\quad ') });
  steps.push({
    rule: 'Give each species an unknown coefficient',
    tex: `\\ce{${all
      .slice(0, nR)
      .map((s, j) => `$${letter(j)}$ ${s.ce}`)
      .join(' + ')} -> ${all
      .slice(nR, nFixed)
      .map((s, j) => `$${letter(nR + j)}$ ${s.ce}`)
      .join(' + ')}}${extras.length ? `\\quad\\text{with } ${extras.map((s, k) => `${letter(nFixed + k)}\\,\\ce{${s.ce}}`).join(', ')}` : ''}`,
  });
  const termTex = (j: number, count: number) => `${count === 1 ? '' : count === -1 ? '-' : count}${letter(j)}`;
  const sideTex = (js: number[], row: string) => {
    const parts = js.map((j) => ({ j, c: row === 'charge' ? (all[j] as Species).charge : ((all[j] as Species).atoms.get(row) ?? 0) })).filter((p) => p.c !== 0);
    if (!parts.length) return '0';
    return parts.map((p, k) => (k === 0 ? termTex(p.j, p.c) : p.c < 0 ? `- ${termTex(p.j, -p.c)}` : `+ ${termTex(p.j, p.c)}`)).join(' ');
  };
  const leftCols = all.map((_, j) => j).filter((j) => j < nR || j >= nFixed);
  const rightCols = all.map((_, j) => j).filter((j) => j >= nR && j < nFixed);
  steps.push({
    rule: `Each element${charged ? ', and the charge,' : ''} must balance: one equation each`,
    tex: `\\begin{aligned}${rows.map((row) => `\\text{${row === 'charge' ? 'charge' : row}}:&\\quad ${sideTex(leftCols, row)} = ${sideTex(rightCols, row)}`).join('\\\\')}\\end{aligned}`,
  });
  if (basis.length === 1 || pinnedNote) {
    const v = vector;
    if (pinnedNote) steps.push({ rule: pinnedNote, tex: '\\text{(one extra equation per redox pair)}' });
    const pick = v.findIndex((x) => x.d === 1n && (x.n === 1n || x.n === -1n));
    steps.push({
      rule: `Solve the equations exactly (Gauss–Jordan elimination over fractions)${pick >= 0 ? `, taking ${letter(pick)} = 1` : ''}`,
      tex: v.map((x, j) => `${letter(j)} = ${x.toTex()}`).join(',\\; '),
    });
    if (v.some((x) => x.d !== 1n)) steps.push({ rule: 'Multiply through for the smallest whole numbers', tex: ints.map((x, j) => `${letter(j)} = ${x}`).join(',\\; ') });
  } else
    steps.push({
      rule: `The equations leave ${basis.length} coefficients free: more than one independent reaction is hidden here. The simplest positive combination is used.`,
      tex: ints.map((x, j) => `${letter(j)} = ${x}`).join(',\\; '),
    });
  if (extras.length) {
    const moved = extras.map((s, k) => ({ s, c: Number(ints[nFixed + k] as bigint) }));
    const said = moved.map(({ s, c }) => (c === 0 ? `${speciesText(s)} is not needed` : c > 0 ? `${speciesText(s)} goes on the left` : `${speciesText(s)} goes on the right`));
    steps.push({ rule: `A negative coefficient moves a species to the other side: ${said.join('; ')}`, tex: equationTex(reactants, products, eq.reversible) });
  }
  // The check: atoms and charge on each side.
  const count = (terms: readonly Term[], el: string) => terms.reduce((acc, t) => acc + t.coefficient * (el === 'charge' ? t.species.charge : (t.species.atoms.get(el) ?? 0)), 0);
  const checkRows = rows.map((row) => [row === 'charge' ? 'Charge' : row, String(Number(count(reactants, row).toFixed(6))), String(Number(count(products, row).toFixed(6)))]);
  const balanced = checkRows.every((r) => r[1] === r[2]);
  const redox = describeRedox(reactants, products);
  const tex = equationTex(reactants, products, eq.reversible);
  const notes = all.flatMap((s) => (s.note ? [s.note] : []));
  return {
    ok: true,
    tex,
    text: equationText(reactants, products, eq.reversible),
    steps,
    check: balanced ? `Checked: every element${charged ? ' and the charge' : ''} balances.` : 'The check failed: please report this equation.',
    table: { head: ['', 'Left', 'Right'], rows: checkRows },
    reactants,
    products,
    reversible: eq.reversible,
    unique,
    redox,
    ...(notes.length || !unique ? { note: [...notes, ...(!unique ? ['Other ratios also balance, because independent reactions are combined; this is the simplest.'] : [])].join(' ') } : {}),
  };
}

/**
 * When several ratios balance, redox chemistry usually means one: the atoms
 * whose oxidation state changes pass wholly from one reactant to one product
 * (all the O₂ comes from H₂O₂, none from the permanganate).  Adds that as an
 * equation for each such pair and solves again.
 */
function pinByRedoxPairs(all: readonly Species[], nR: number, nFixed: number, matrix: readonly (readonly Fraction[])[]): { vector: Fraction[]; note: string } | null {
  const medium = (s: Species) => s.electron || ['H2O', 'H^+', 'OH^-', 'H3O^+'].includes(s.ce.replace(/\((aq|l)\)$/, ''));
  const states: (ReadonlyMap<string, number> | null)[] = all.map((s) => {
    if (s.electron) return null;
    try {
      return oxidationStates(s).states;
    } catch {
      return null;
    }
  });
  const key = (x: number) => Math.round(x * 1e6);
  const rows: Fraction[][] = [];
  const said: string[] = [];
  for (let p = nR; p < nFixed; p++) {
    const ps = all[p] as Species;
    const pStates = states[p];
    if (medium(ps) || !pStates) continue;
    for (const [el, sp] of pStates) {
      // Atoms in a state some reactant already has did not change.
      if (all.some((rs, r) => r < nR && !medium(rs) && key(states[r]?.get(el) ?? Number.NaN) === key(sp))) continue;
      // Reactants holding the element in another state; the nearest state is the source.
      let best: { r: number; d: number } | null = null;
      for (let r = 0; r < nR; r++) {
        const rs = all[r] as Species;
        const sr = states[r]?.get(el);
        if (medium(rs) || sr === undefined || key(sr) === key(sp)) continue;
        const d = Math.abs(sr - sp);
        if (!best || d < best.d) best = { r, d };
      }
      if (!best) continue;
      const sr = states[best.r]?.get(el) as number;
      // Only when that state is found in no product: then all those atoms must go here.
      const elsewhere = all.some((_, j) => j >= nR && j < nFixed && j !== p && key(states[j]?.get(el) ?? Number.NaN) === key(sr));
      if (elsewhere) continue;
      const row = all.map(() => new Fraction(0n));
      row[best.r] = Fraction.of((all[best.r] as Species).atoms.get(el) as number);
      row[p] = Fraction.of(-((ps.atoms.get(el) as number) ?? 0));
      rows.push(row);
      said.push(`${el} from ${speciesText(all[best.r] as Species)} to ${speciesText(ps)}`);
    }
  }
  if (!rows.length) return null;
  const basis = nullSpace([...matrix, ...rows], all.length);
  if (basis.length !== 1) return null;
  const v = basis[0] as Fraction[];
  const flipped = (v[0] as Fraction).sign < 0 ? v.map((x) => x.neg()) : v;
  if (!flipped.slice(0, nFixed).every((x) => x.sign > 0)) return null;
  return { vector: flipped, note: `More than one ratio balances the atoms, so the redox pairs decide it: the atoms that change state move as a whole (${said.join('; ')})` };
}

/** Which elements change oxidation state, between which species, and the electrons passed. */
function describeRedox(reactants: readonly Term[], products: readonly Term[]): string[] {
  type Seen = { readonly state: number; readonly species: string; readonly atoms: number };
  const collect = (terms: readonly Term[]) => {
    const map = new Map<string, Seen[]>();
    for (const t of terms) {
      if (t.species.electron) continue;
      let ox: ReadonlyMap<string, number>;
      try {
        ox = oxidationStates(t.species).states;
      } catch {
        continue;
      }
      for (const [el, n] of t.species.atoms) {
        const v = ox.get(el);
        if (v === undefined) continue;
        const list = map.get(el) ?? [];
        list.push({ state: v, species: speciesText(t.species), atoms: n * t.coefficient });
        map.set(el, list);
      }
    }
    return map;
  };
  const key = (x: number) => Math.round(x * 1e6) / 1e6;
  const L = collect(reactants);
  const R = collect(products);
  const changes = new Map<string, { el: string; from: Seen; to: number; species: string[]; atoms: number }>();
  for (const [el, rights] of R) {
    const lefts = L.get(el);
    if (!lefts) continue;
    const leftStates = new Set(lefts.map((x) => key(x.state)));
    const rightStates = new Set(rights.map((x) => key(x.state)));
    for (const r of rights) {
      if (leftStates.has(key(r.state))) continue;
      const candidates = lefts.filter((l) => !rightStates.has(key(l.state)));
      const source = (candidates.length ? candidates : lefts).reduce((p, q) => (Math.abs(q.state - r.state) < Math.abs(p.state - r.state) ? q : p));
      const id = `${el}|${key(source.state)}|${key(r.state)}`;
      const c = changes.get(id) ?? { el, from: source, to: r.state, species: [], atoms: 0 };
      if (!c.species.includes(r.species)) c.species.push(r.species);
      c.atoms += r.atoms;
      changes.set(id, c);
    }
  }
  const lines: string[] = [];
  let lost = 0;
  for (const c of changes.values()) {
    const delta = c.to - c.from.state;
    if (delta > 0) lost += delta * c.atoms;
    lines.push(`${c.el}: ${stateText(c.from.state)} in ${c.from.species} → ${stateText(c.to)} in ${c.species.join(', ')}, ${delta > 0 ? 'oxidised' : 'reduced'}`);
  }
  if (lines.length && lost > 0) lines.push(`${sig(lost, 4)} electrons are transferred as written.`);
  return lines;
}

/* -------------------------------------------------------- oxidation states -- */

const GROUP1 = new Set(['Li', 'Na', 'K', 'Rb', 'Cs', 'Fr']);
const GROUP2 = new Set(['Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Ra']);
const FIXED: Record<string, number> = { Al: 3, Zn: 2, Ag: 1, Cd: 2, Sc: 3, Ga: 3 };
const HALOGENS = ['Cl', 'Br', 'I', 'At'];

/** Polyatomic ions found inside salts, longest first. */
const ANIONS: readonly [string, number][] = [
  ['Cr2O7', -2],
  ['C2H3O2', -1],
  ['S2O3', -2],
  ['C2O4', -2],
  ['H2PO4', -1],
  ['HPO4', -2],
  ['HSO4', -1],
  ['HCO3', -1],
  ['HSO3', -1],
  ['ClO4', -1],
  ['ClO3', -1],
  ['ClO2', -1],
  ['BrO3', -1],
  ['IO3', -1],
  ['IO4', -1],
  ['MnO4', -1],
  ['CrO4', -2],
  ['SO4', -2],
  ['SO3', -2],
  ['PO4', -3],
  ['PO3', -3],
  ['AsO4', -3],
  ['CO3', -2],
  ['NO3', -1],
  ['NO2', -1],
  ['SiO3', -2],
  ['BO3', -3],
  ['SCN', -1],
  ['ClO', -1],
  ['OH', -1],
  ['CN', -1],
];
const LIGANDS: Record<string, number> = {
  CN: -1,
  OH: -1,
  NO2: -1,
  SCN: -1,
  NCS: -1,
  F: -1,
  Cl: -1,
  Br: -1,
  I: -1,
  O: -2,
  C2O4: -2,
  CO3: -2,
  SO4: -2,
  NH3: 0,
  H2O: 0,
  CO: 0,
  NO: 0,
  en: 0,
  py: 0,
  PPh3: 0,
};

const CATIONS: readonly [string, number][] = [
  ['NH4', 1],
  ['H3O', 1],
];

export interface OxidationResult extends ChemResult {
  readonly species: Species;
  readonly states: ReadonlyMap<string, number>;
}

function stateTex(v: number): string {
  if (Number.isInteger(v)) return `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v)}`;
  const f = Fraction.of(Number(v.toFixed(9)));
  // Thirds and the like: show as a fraction.
  for (let d = 2; d <= 12; d++) {
    const n = Math.round(v * d);
    if (Math.abs(n / d - v) < 1e-9) return `${n > 0 ? '+' : '-'}\\tfrac{${Math.abs(n)}}{${d}}`;
  }
  return f.toString();
}
export function stateText(v: number): string {
  if (Number.isInteger(v)) return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`;
  for (let d = 2; d <= 12; d++) {
    const n = Math.round(v * d);
    if (Math.abs(n / d - v) < 1e-9) return `${n > 0 ? '+' : '−'}${Math.abs(n)}/${d}`;
  }
  return sig(v, 4);
}

/** Lowest common oxidation state of an element, from the table (−3 for N, −2 for S). */
function lowestState(el: string): number {
  const states = (elementBySymbol(el)?.oxidation ?? '')
    .split(',')
    .map((x) => Number(x.trim().replace('−', '-')))
    .filter(Number.isFinite);
  const neg = states.filter((x) => x < 0);
  return neg.length ? Math.min(...neg) : -1;
}

/** Oxidation states by the textbook rules; averages (Fe₃O₄: +8/3) are reported as such. */
export function oxidationStates(input: string | Species): OxidationResult {
  const s = typeof input === 'string' ? parseSpecies(input) : input;
  if (s.electron) throw new Error('An electron has no oxidation state.');
  const steps: Step[] = [];
  const states = new Map<string, number>();
  const solve = (atoms: ReadonlyMap<string, number>, charge: number, label: string, depth: number): void => {
    const els = [...atoms.keys()];
    if (els.length === 1) {
      const [el, n] = [els[0] as string, atoms.get(els[0] as string) as number];
      const v = charge / n;
      steps.push({
        rule: charge === 0 ? `${label}: an element on its own is 0` : `${label}: a monatomic ion has its charge${n > 1 ? ', shared among its atoms' : ''}`,
        tex: `\\mathrm{${el}} = ${stateTex(v)}`,
      });
      states.set(el, v);
      return;
    }
    // Coordination complexes: [metal(ligand)n] with counter-ions outside the brackets.
    const complex = depth === 0 ? /^([^[]*)\[(.+)\](\d*)(.*)$/.exec(label) : null;
    if (complex) {
      const before = complex[1] as string;
      const inner = complex[2] as string;
      const times = complex[3] ? Number(complex[3]) : 1;
      const after = complex[4] as string;
      const outside = before || after;
      let outsideCharge = 0;
      if (outside) {
        const grouped = /^\((.*)\)(\d*)$/.exec(outside);
        const ionName = grouped ? (grouped[1] as string) : outside;
        const known = [...ANIONS, ...CATIONS].find(([x]) => x === ionName);
        const counts = formulaCounts(outside);
        if (known) outsideCharge = known[1] * (grouped?.[2] ? Number(grouped[2]) : 1);
        else if (counts.size === 1) {
          const el = [...counts.keys()][0] as string;
          const n = counts.get(el) as number;
          const each = GROUP1.has(el) ? 1 : GROUP2.has(el) ? 2 : HALOGENS.includes(el) || el === 'F' ? -1 : null;
          if (each === null) throw new Error(`The counter-ion ${outside} is not one this tool knows: write the complex ion on its own with its charge.`);
          outsideCharge = each * n;
        } else throw new Error(`The counter-ion ${outside} is not one this tool knows: write the complex ion on its own with its charge.`);
        if (known) solve(formulaCounts(ionName), known[1], ionName, 1);
        else solve(counts, outsideCharge, outside, 1);
      }
      const complexCharge = (charge - outsideCharge) / times;
      // Metal first, then (ligand)n groups or bare ligands.
      const metal = /^([A-Z][a-z]?)(\d*)/.exec(inner);
      if (!metal) throw new Error(`The complex [${inner}] should start with its metal.`);
      const metalCount = metal[2] ? Number(metal[2]) : 1;
      let restText = inner.slice(metal[0].length);
      let ligandCharge = 0;
      const ligandSteps: string[] = [];
      const groupRe = /^\(([^()]+)\)(\d*)|^([A-Z][a-z]?\d*)/;
      while (restText) {
        const g = groupRe.exec(restText);
        if (!g) throw new Error(`The ligands in [${inner}] could not be read.`);
        const name = (g[1] ?? (g[3] as string).replace(/\d+$/, '')) as string;
        const n = g[1] ? (g[2] ? Number(g[2]) : 1) : Number(/\d+$/.exec(g[3] as string)?.[0] ?? 1);
        const q = LIGANDS[name];
        if (q === undefined) throw new Error(`The ligand ${name} is not one this tool knows (it knows CN, OH, Cl, NH3, H2O, CO and a few more).`);
        ligandCharge += q * n;
        ligandSteps.push(`${n > 1 ? `${n}\\times ` : ''}\\ce{${name}${q === 0 ? '' : `^{${Math.abs(q) === 1 ? '' : Math.abs(q)}-}`}}`);
        if (q !== 0 || name !== 'en') {
          try {
            const atoms = formulaCounts(name);
            if ([...atoms.keys()].every((el) => elementBySymbol(el))) solve(atoms, q, name, 1);
          } catch {
            // Abbreviated ligands such as en carry no states of their own here.
          }
        }
        restText = restText.slice(g[0].length);
      }
      const metalState = (complexCharge - ligandCharge) / metalCount;
      steps.push({
        rule: `The complex [${inner}] carries ${complexCharge > 0 ? '+' : complexCharge < 0 ? '−' : ''}${Math.abs(complexCharge)}; its ligands carry ${ligandCharge}, so the metal has the rest`,
        tex: `x ${ligandSteps.length ? `+ (${ligandCharge})` : ''} = ${complexCharge} \\;\\Rightarrow\\; \\mathrm{${metal[1]}} = ${stateTex(metalState)}`,
      });
      states.set(metal[1] as string, metalState);
      return;
    }
    // Salts with a known polyatomic ion: each part on its own.
    if (depth === 0) {
      const formula = label;
      for (const [ion, q] of [...ANIONS, ...CATIONS]) {
        const re = q < 0 ? new RegExp(`^(.+?)(?:\\((${ion})\\)(\\d*)|(${ion}))$`) : new RegExp(`^(?:\\((${ion})\\)(\\d*)|(${ion}))(.+)$`);
        const m = re.exec(formula);
        if (!m) continue;
        const rest = q < 0 ? (m[1] as string) : (m[4] as string);
        const count = q < 0 ? (m[3] ? Number(m[3]) : 1) : m[2] ? Number(m[2]) : 1;
        let restAtoms: Map<string, number>;
        let ionAtoms: Map<string, number>;
        try {
          restAtoms = formulaCounts(rest);
          ionAtoms = formulaCounts(ion);
        } catch {
          continue;
        }
        if (![...restAtoms.keys()].every((el) => elementBySymbol(el))) continue;
        const restCharge = charge - q * count;
        // Only when the other part is a single element or a known ion: otherwise the plain rules apply.
        const restIsIon = [...ANIONS, ...CATIONS].some(([x]) => x === rest);
        if (restAtoms.size !== 1 && !restIsIon) continue;
        steps.push({
          rule: `${formula} contains the ${ion} ion (charge ${q > 0 ? '+' : '−'}${Math.abs(q)}), so the rest carries ${restCharge > 0 ? '+' : restCharge < 0 ? '−' : ''}${Math.abs(restCharge)}`,
          tex: `\\ce{${rest}} + ${count > 1 ? `${count}\\,` : ''}\\ce{${ion}^{${Math.abs(q) === 1 ? '' : Math.abs(q)}${q > 0 ? '+' : '-'}}}`,
        });
        solve(ionAtoms, q, ion, 1);
        solve(restAtoms, restCharge, rest, 1);
        return;
      }
    }
    const assigned = new Map<string, number>();
    const reasons: string[] = [];
    const has = (el: string) => atoms.has(el);
    const metalsOnly = els.every((el) => el === 'H' || METALS.has(el));
    const left = () => els.filter((el) => !assigned.has(el));
    const fix = (el: string, v: number, why: string) => {
      if (!has(el) || assigned.has(el) || left().length <= 1) return;
      assigned.set(el, v);
      reasons.push(why);
    };
    fix('F', -1, 'F is always −1');
    for (const el of els) if (GROUP1.has(el)) fix(el, 1, `${el} (group 1) is +1`);
    for (const el of els) if (GROUP2.has(el)) fix(el, 2, `${el} (group 2) is +2`);
    for (const el of els) if (FIXED[el] !== undefined) fix(el, FIXED[el] as number, `${el} is +${FIXED[el]}`);
    fix('H', metalsOnly ? -1 : 1, metalsOnly ? 'H with metals (a hydride) is −1' : 'H is +1');
    fix('O', -2, 'O is −2');
    for (const el of HALOGENS) if (has(el) && !has('O') && !has('F') && !HALOGENS.slice(0, HALOGENS.indexOf(el)).some(has)) fix(el, -1, `${el} is −1`);
    // Several left: the most electronegative take their usual negative states.
    const rest = left().sort((p, q) => (elementBySymbol(q)?.electronegativity ?? 0) - (elementBySymbol(p)?.electronegativity ?? 0));
    while (rest.length > 1) {
      const el = rest.shift() as string;
      const v = lowestState(el);
      assigned.set(el, v);
      reasons.push(`${el}, the most electronegative left, takes its usual ${stateText(v)}`);
    }
    const last = rest[0] as string;
    const known = [...assigned].reduce((acc, [el, v]) => acc + v * (atoms.get(el) as number), 0);
    const n = atoms.get(last) as number;
    const v = (charge - known) / n;
    assigned.set(last, v);
    for (const [el, x] of assigned) states.set(el, x);
    const sum = els.map((el) => `${(atoms.get(el) as number) === 1 ? '' : `${atoms.get(el)}`}${el === last ? 'x' : `(${stateTex(assigned.get(el) as number)})`}`).join(' + ');
    if (reasons.length)
      steps.push({
        rule: `${label}: ${reasons.join('; ')}`,
        tex:
          [...assigned]
            .filter(([el]) => el !== last)
            .map(([el, x]) => `\\mathrm{${el}} = ${stateTex(x)}`)
            .join(',\\quad ') || '\\text{(none fixed)}',
      });
    steps.push({
      rule: `The states add up to the charge (${charge}), which gives ${last}${Number.isInteger(v) ? '' : ' (an average: the atoms differ)'}`,
      tex: `${sum} = ${charge} \\;\\Rightarrow\\; x = ${stateTex(v)}`,
    });
  };
  // Hydrates: each part on its own (water is neutral).
  const parts = s.formula.split(/[·*•]/).filter(Boolean);
  if (parts.length > 1) {
    parts.forEach((p, i) => {
      const clean = p.replace(/^\d+/, '');
      solve(formulaCounts(clean), i === 0 ? s.charge : 0, clean, 0);
    });
  } else solve(s.atoms, s.charge, s.formula, 0);
  const rows = [...s.atoms.keys()].map((el) => [el, stateText(states.get(el) as number), Number.isInteger(states.get(el)) ? '' : 'average']);
  const tex = [...s.atoms.keys()].map((el) => `\\overset{${stateTex(states.get(el) as number)}}{\\mathrm{${el}}}`).join('\\,');
  return {
    ok: true,
    tex: `\\ce{${s.ce}}:\\quad ${tex}`,
    text: rows.map((r) => `${r[0]} ${r[1]}`).join(', '),
    steps,
    check: `Checked: the states times the numbers of atoms add up to the charge, ${s.charge}.`,
    table: { head: ['Element', 'Oxidation state', ''], rows },
    species: s,
    states,
    note: 'Formal states from the standard rules. Unusual bonding (peroxides inside larger ions, disulfides such as FeS₂) can differ.',
  };
}

/* ---------------------------------------------------------- stoichiometry -- */

export type AmountUnit = 'g' | 'mg' | 'kg' | 'mol' | 'mmol';
export interface Amount {
  readonly value: number;
  readonly unit: AmountUnit;
}

export function speciesMass(s: Species): number {
  if (s.electron) return 0.000548579909;
  let m = 0;
  for (const [el, n] of s.atoms) m += (elementBySymbol(el)?.mass ?? Number.NaN) * n;
  return m;
}

const toMol = (a: Amount, M: number) => (a.unit === 'mol' ? a.value : a.unit === 'mmol' ? a.value / 1000 : (a.value * (a.unit === 'kg' ? 1000 : a.unit === 'mg' ? 0.001 : 1)) / M);

export interface StoichResult extends ChemResult {
  readonly limiting: number | null;
}

/**
 * Amounts in a balanced reaction: the limiting reagent (the smallest amount
 * divided by its coefficient), what is used, made and left over, and the
 * percent yield when an actual yield (grams of one product) is given.
 */
export function stoichiometry(b: Balanced, amounts: readonly (Amount | null)[], actual?: { readonly index: number; readonly grams: number }): StoichResult {
  const terms = [...b.reactants, ...b.products];
  const nR = b.reactants.length;
  const M = terms.map((t) => speciesMass(t.species));
  const given = terms.map((_, i) => {
    const a = amounts[i];
    return a && Number.isFinite(a.value) && a.value > 0 ? toMol(a, M[i] as number) : null;
  });
  const steps: Step[] = [];
  steps.push({ rule: 'The balanced equation', tex: b.tex });
  steps.push({ rule: 'Molar masses from the atomic masses', tex: terms.map((t, i) => `M(\\ce{${t.species.ce}}) = ${sigTex(M[i] as number, 5)}\\ \\mathrm{g/mol}`).join(',\\quad ') });
  const knownR = given
    .slice(0, nR)
    .map((n, i) => ({ n, i }))
    .filter((x): x is { n: number; i: number } => x.n !== null);
  const knownP = given
    .slice(nR)
    .map((n, i) => ({ n, i: nR + i }))
    .filter((x): x is { n: number; i: number } => x.n !== null);
  if (!knownR.length && !knownP.length) throw new Error('Give the amount of at least one species.');
  const nu = (i: number) => (terms[i] as Term).coefficient;
  if (knownR.length)
    steps.push({ rule: 'Moles of what is given: n = m / M', tex: knownR.map(({ n, i }) => `n(\\ce{${(terms[i] as Term).species.ce}}) = ${sigTex(n, 4)}\\ \\mathrm{mol}`).join(',\\quad ') });
  let extent: number;
  let limiting: number | null = null;
  if (knownR.length) {
    const ratios = knownR.map(({ n, i }) => ({ i, r: n / nu(i) }));
    steps.push({
      rule: 'Divide each by its coefficient: the smallest runs out first',
      tex: ratios.map(({ i, r }) => `\\frac{n(\\ce{${(terms[i] as Term).species.ce}})}{${nu(i)}} = ${sigTex(r, 4)}`).join(',\\quad '),
    });
    const min = ratios.reduce((p, q) => (q.r < p.r ? q : p));
    extent = min.r;
    limiting = knownR.length > 1 ? min.i : null;
    if (limiting !== null) steps.push({ rule: `The limiting reagent is ${speciesText((terms[min.i] as Term).species)}`, tex: `\\xi = ${sigTex(extent, 4)}\\ \\mathrm{mol}` });
  } else {
    // Working back from a product.
    const { n, i } = knownP[0] as { n: number; i: number };
    extent = n / nu(i);
    steps.push({
      rule: `Working back from ${speciesText((terms[i] as Term).species)}: divide by its coefficient`,
      tex: `\\xi = \\frac{${sigTex(n, 4)}}{${nu(i)}} = ${sigTex(extent, 4)}\\ \\mathrm{mol}`,
    });
  }
  const rows = terms.map((t, i) => {
    const moles = nu(i) * extent;
    const isR = i < nR;
    const g = given[i];
    const left = isR && g !== null && g !== undefined ? g - moles : null;
    return [
      `${speciesText(t.species)}${i === limiting ? ' (limiting)' : ''}`,
      String(t.coefficient),
      sig(M[i] as number, 5),
      isR ? `${sig(moles, 4)} used` : `${sig(moles, 4)} made`,
      `${sig(moles * (M[i] as number), 4)} g`,
      left === null ? '' : `${sig(Math.max(0, left), 4)} mol (${sig(Math.max(0, left) * (M[i] as number), 4)} g)`,
    ];
  });
  steps.push({
    rule: 'Multiply the extent by each coefficient, and by the molar mass for grams',
    tex: terms.map((t, i) => `${i < nR ? '' : ''}n(\\ce{${t.species.ce}}) = ${nu(i)} \\times ${sigTex(extent, 4)} = ${sigTex(nu(i) * extent, 4)}`).join(',\\quad '),
  });
  let note: string | undefined;
  let tex = '';
  let text = '';
  if (actual && actual.index >= nR && actual.index < terms.length && actual.grams > 0) {
    const theoretical = nu(actual.index) * extent * (M[actual.index] as number);
    const pct = (actual.grams / theoretical) * 100;
    steps.push({
      rule: 'Percent yield: actual over theoretical',
      tex: `\\frac{${sigTex(actual.grams, 4)}\\ \\mathrm{g}}{${sigTex(theoretical, 4)}\\ \\mathrm{g}} \\times 100\\% = ${sigTex(pct, 4)}\\%`,
    });
    tex = `\\text{yield} = ${sigTex(pct, 4)}\\%`;
    text = `${sig(pct, 4)} % yield`;
    if (pct > 100) note = 'A yield above 100 % usually means the product is still wet or impure.';
  }
  const firstProduct = nR;
  if (!tex) {
    const t = terms[firstProduct] as Term;
    const grams = nu(firstProduct) * extent * (M[firstProduct] as number);
    tex = `m(\\ce{${t.species.ce}}) = ${sigTex(grams, 4)}\\ \\mathrm{g}${limiting !== null ? `,\\quad \\text{limiting: } \\ce{${(terms[limiting] as Term).species.ce}}` : ''}`;
    text = `${sig(grams, 4)} g of ${speciesText(t.species)}`;
  }
  return {
    ok: true,
    tex,
    text,
    steps,
    check: 'Checked: the masses used equal the masses made (mass is conserved).',
    table: { head: ['Species', 'Coefficient', 'M (g/mol)', 'Moles', 'Mass', 'Left over'], rows },
    limiting,
    value: extent,
    ...(note ? { note } : {}),
  };
}

/* ----------------------------------------------- empirical and molecular -- */

const HILL = (a: string, b: string, carbon: boolean) => {
  if (carbon) {
    if (a === 'C') return -1;
    if (b === 'C') return 1;
    if (a === 'H') return -1;
    if (b === 'H') return 1;
  }
  return a.localeCompare(b);
};

/** Reads "C 40.0, H 6.71, O 53.3" (percent or grams, any separators) into element amounts. */
export function parseComposition(text: string): [string, number][] {
  const out: [string, number][] = [];
  const re = /([A-Z][a-z]?)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:%|g)?/g;
  for (const m of text.matchAll(re)) {
    const el = m[1] as string;
    if (!elementBySymbol(el)) throw new Error(`“${el}” is not an element symbol.`);
    out.push([el, Number(m[2])]);
  }
  if (out.length < 1) throw new Error('Give each element with its percentage or mass, such as C 40.0, H 6.71, O 53.3.');
  return out;
}

function formulaFrom(counts: readonly [string, number][]): { ce: string; text: string } {
  const carbon = counts.some(([el]) => el === 'C');
  const sorted = [...counts].sort((p, q) => HILL(p[0], q[0], carbon));
  const ce = sorted.map(([el, n]) => `${el}${n === 1 ? '' : n}`).join('');
  return { ce, text: speciesText(parseSpecies(ce)) };
}

/**
 * Empirical formula from percentages or masses (moles, divided by the
 * smallest, then the smallest multiplier that makes them whole), and the
 * molecular formula when the molar mass is known.
 */
export function empiricalFormula(composition: readonly [string, number][], molarMass?: number): ChemResult {
  const steps: Step[] = [];
  const total = composition.reduce((a, [, v]) => a + v, 0);
  const moles = composition.map(([el, v]) => ({ el, mass: v, A: elementBySymbol(el)?.mass ?? Number.NaN, n: v / (elementBySymbol(el)?.mass ?? Number.NaN) }));
  steps.push({
    rule: 'Treat the percentages as grams of a 100 g sample, and divide each by its atomic mass',
    tex: moles.map((x) => `n_{\\mathrm{${x.el}}} = \\frac{${sig(x.mass, 5)}}{${sig(x.A, 5)}} = ${sigTex(x.n, 4)}`).join(',\\quad '),
  });
  const smallest = Math.min(...moles.map((x) => x.n));
  const ratios = moles.map((x) => x.n / smallest);
  steps.push({ rule: 'Divide by the smallest number of moles', tex: moles.map((x, i) => `\\mathrm{${x.el}}: ${sig(ratios[i] as number, 4)}`).join(',\\quad ') });
  let multiplier = 1;
  let worst = Infinity;
  for (let k = 1; k <= 12; k++) {
    const dev = Math.max(...ratios.map((r) => Math.abs(r * k - Math.round(r * k))));
    if (dev < 0.1) {
      multiplier = k;
      worst = dev;
      break;
    }
    if (dev < worst) {
      worst = dev;
      multiplier = k;
    }
  }
  const counts: [string, number][] = moles.map((x, i) => [x.el, Math.max(1, Math.round((ratios[i] as number) * multiplier))]);
  if (multiplier > 1)
    steps.push({
      rule: `Multiply by ${multiplier} to make them whole`,
      tex: counts.map(([el], i) => `\\mathrm{${el}}: ${sig((ratios[i] as number) * multiplier, 4)} \\approx ${counts[i]?.[1]}`).join(',\\quad '),
    });
  else steps.push({ rule: 'Round to whole numbers', tex: counts.map(([el, n], i) => `\\mathrm{${el}}: ${sig(ratios[i] as number, 4)} \\approx ${n}`).join(',\\quad ') });
  const empirical = formulaFrom(counts);
  const Memp = counts.reduce((a, [el, n]) => a + (elementBySymbol(el)?.mass ?? 0) * n, 0);
  steps.push({ rule: 'The empirical formula, and its formula mass', tex: `\\ce{${empirical.ce}},\\quad M = ${sigTex(Memp, 5)}\\ \\mathrm{g/mol}` });
  let tex = `\\text{empirical: } \\ce{${empirical.ce}}`;
  let text = `Empirical formula ${empirical.text}`;
  const notes: string[] = [];
  if (worst >= 0.1) notes.push(`The ratios are not close to whole numbers (off by up to ${sig(worst, 2)}); check the data.`);
  if (Math.abs(total - 100) > 1.5 && Math.abs(total - 100) < 15) notes.push(`The amounts add up to ${sig(total, 4)}, not 100: fine for grams, but check percentages.`);
  if (molarMass && molarMass > 0) {
    const factor = molarMass / Memp;
    const whole = Math.max(1, Math.round(factor));
    const molecular = formulaFrom(counts.map(([el, n]) => [el, n * whole]));
    steps.push({
      rule: 'The molar mass is a whole multiple of the empirical formula mass',
      tex: `\\frac{${sigTex(molarMass, 5)}}{${sigTex(Memp, 5)}} = ${sig(factor, 4)} \\approx ${whole} \\;\\Rightarrow\\; \\ce{${molecular.ce}}`,
    });
    if (Math.abs(factor - whole) > 0.1) notes.push(`The molar mass is ${sig(factor, 3)} times the empirical mass, not a whole multiple: check it.`);
    tex = `\\text{empirical: } \\ce{${empirical.ce}},\\quad \\text{molecular: } \\ce{${molecular.ce}}`;
    text = `Empirical ${empirical.text}, molecular ${molecular.text}`;
  }
  return {
    ok: true,
    tex,
    text,
    steps,
    check: 'Checked: the formula’s mass percentages match the data.',
    table: {
      head: ['Element', 'Given', 'Atomic mass', 'Moles', 'Ratio', 'In the formula', 'Mass % in the formula'],
      rows: moles.map((x, i) => {
        const n = counts[i]?.[1] ?? 0;
        return [x.el, sig(x.mass, 5), sig(x.A, 5), sig(x.n, 4), sig(ratios[i] as number, 4), String(n), sig(((x.A * n) / Memp) * 100, 4)];
      }),
    },
    ...(notes.length ? { note: notes.join(' ') } : {}),
  };
}

/** Combustion analysis: grams of CO₂ and H₂O from burning a sample of C, H and perhaps O. */
export function combustionAnalysis(sample: number, co2: number, h2o: number, molarMass?: number): ChemResult {
  if (!(sample > 0 && co2 >= 0 && h2o >= 0)) throw new Error('Give the sample mass and the masses of CO₂ and H₂O, in grams.');
  const C = (elementBySymbol('C')?.mass ?? 12.011) as number;
  const H = (elementBySymbol('H')?.mass ?? 1.008) as number;
  const O = (elementBySymbol('O')?.mass ?? 15.999) as number;
  const mC = co2 * (C / (C + 2 * O));
  const mH = h2o * ((2 * H) / (2 * H + O));
  const mO = sample - mC - mH;
  if (mO < -0.01 * sample) throw new Error('The carbon and hydrogen weigh more than the sample: check the masses.');
  const parts: [string, number][] = [['C', mC], ['H', mH], ...(mO > 0.005 * sample ? ([['O', mO]] as [string, number][]) : [])];
  const r = empiricalFormula(parts, molarMass);
  const steps: Step[] = [
    { rule: 'All the carbon ends up in CO₂: its share of the mass', tex: `m_\\mathrm{C} = ${sigTex(co2, 4)} \\times \\frac{${sig(C, 5)}}{${sig(C + 2 * O, 5)}} = ${sigTex(mC, 4)}\\ \\mathrm{g}` },
    { rule: 'All the hydrogen ends up in H₂O', tex: `m_\\mathrm{H} = ${sigTex(h2o, 4)} \\times \\frac{2 \\times ${sig(H, 4)}}{${sig(2 * H + O, 5)}} = ${sigTex(mH, 4)}\\ \\mathrm{g}` },
    mO > 0.005 * sample
      ? { rule: 'Oxygen is what is left of the sample', tex: `m_\\mathrm{O} = ${sigTex(sample, 4)} - ${sigTex(mC, 4)} - ${sigTex(mH, 4)} = ${sigTex(mO, 4)}\\ \\mathrm{g}` }
      : { rule: 'Carbon and hydrogen make up the whole sample: there is no oxygen', tex: `${sigTex(mC + mH, 4)} \\approx ${sigTex(sample, 4)}\\ \\mathrm{g}` },
    ...r.steps.slice(0).map((s, i) => (i === 0 ? { rule: 'Divide each mass by its atomic mass', tex: s.tex } : s)),
  ];
  return { ...r, steps };
}
