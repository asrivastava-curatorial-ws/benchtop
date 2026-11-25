/**
 * Genetics for the Genetics Lab: Punnett squares for up to three genes
 * (complete and incomplete dominance, codominance, ABO blood groups and
 * X-linked genes), Wright–Fisher populations with selection and drift,
 * Hardy–Weinberg and chi-square tests, and DNA → mRNA → protein with
 * mutations.
 */

/* ------------------------------------------------------------- crosses -- */

export type GeneKind = 'complete' | 'incomplete' | 'codominant' | 'abo' | 'xlinked';

export interface Gene {
  readonly kind: GeneKind;
  /** The gene's letter (A, B, …); ABO and X-linked genes use their own symbols. */
  readonly letter: string;
  /** Each parent's two alleles: 'D' dominant/first, 'r' recessive/second; ABO uses 'A', 'B', 'O'; an X-linked father has 'Y' second. */
  readonly mother: readonly [string, string];
  readonly father: readonly [string, string];
}

/** The order alleles are written in: dominant (or first) first. */
const RANK: Readonly<Record<string, number>> = { D: 0, A: 0, B: 1, r: 2, O: 2, Y: 3 };
const sortPair = (a: string, b: string) => ((RANK[a] ?? 9) <= (RANK[b] ?? 9) ? [a, b] : [b, a]);

/** How an allele is written for this gene. */
export function alleleText(gene: Gene, allele: string): string {
  const L = gene.letter.toUpperCase();
  switch (gene.kind) {
    case 'complete':
    case 'incomplete':
      return allele === 'D' ? L : L.toLowerCase();
    case 'codominant':
      return allele === 'D' ? `${L}¹` : `${L}²`;
    case 'abo':
      return allele === 'A' ? 'Iᴬ' : allele === 'B' ? 'Iᴮ' : 'i';
    case 'xlinked':
      return allele === 'Y' ? 'Y' : allele === 'D' ? `X${L}` : `X${L.toLowerCase()}`;
  }
}

export function genotypeText(gene: Gene, a: string, b: string): string {
  const [x = a, y = b] = sortPair(a, b);
  return `${alleleText(gene, x)}${alleleText(gene, y)}`;
}

export function phenotype(gene: Gene, a: string, b: string): string {
  const L = gene.letter.toUpperCase();
  const n = (a === 'D' ? 1 : 0) + (b === 'D' ? 1 : 0);
  switch (gene.kind) {
    case 'complete':
      return n > 0 ? `${L} trait (dominant)` : `${L.toLowerCase()} trait (recessive)`;
    case 'incomplete':
      return n === 2 ? `full ${L}` : n === 1 ? `blend of ${L} and ${L.toLowerCase()}` : `full ${L.toLowerCase()}`;
    case 'codominant':
      return n === 2 ? `${L}¹ only` : n === 1 ? `${L}¹ and ${L}² both show` : `${L}² only`;
    case 'abo': {
      const has = (x: string) => a === x || b === x;
      return has('A') && has('B') ? 'blood group AB' : has('A') ? 'blood group A' : has('B') ? 'blood group B' : 'blood group O';
    }
    case 'xlinked': {
      const male = a === 'Y' || b === 'Y';
      const x = male ? (a === 'Y' ? b : a) : null;
      if (male) return x === 'D' ? 'son, unaffected' : 'son, affected';
      return n === 2 ? 'daughter, unaffected' : n === 1 ? 'daughter, carrier' : 'daughter, affected';
    }
  }
}

/** Every combination of one allele from each gene, for one parent: 2ⁿ gametes, equally likely. */
export function gametes(genes: readonly Gene[], parent: 'mother' | 'father'): string[][] {
  let out: string[][] = [[]];
  for (const g of genes) {
    const [x, y] = g[parent];
    out = out.flatMap((combo) => [
      [...combo, x],
      [...combo, y],
    ]);
  }
  return out;
}

export interface Cross {
  readonly eggs: string[][];
  readonly sperm: string[][];
  /** cells[i][j] is the child of egg i and sperm j: each gene's pair of alleles. */
  readonly cells: (readonly (readonly [string, string])[])[][];
  /** Genotypes and phenotypes with how many cells show each (out of eggs × sperm). */
  readonly genotypes: readonly { readonly text: string; readonly count: number }[];
  readonly phenotypes: readonly { readonly text: string; readonly count: number }[];
  readonly total: number;
}

export function cross(genes: readonly Gene[]): Cross {
  const eggs = gametes(genes, 'mother');
  const sperm = gametes(genes, 'father');
  const g = new Map<string, number>();
  const p = new Map<string, number>();
  const cells = eggs.map((e) =>
    sperm.map((s) => {
      const pairs = genes.map((_, k) => [e[k] ?? '', s[k] ?? ''] as const);
      const gt = genes.map((gene, k) => genotypeText(gene, pairs[k]?.[0] ?? '', pairs[k]?.[1] ?? '')).join(' ');
      const ph = genes.map((gene, k) => phenotype(gene, pairs[k]?.[0] ?? '', pairs[k]?.[1] ?? '')).join('; ');
      g.set(gt, (g.get(gt) ?? 0) + 1);
      p.set(ph, (p.get(ph) ?? 0) + 1);
      return pairs;
    }),
  );
  // Most common first; ties in code-point order, so capitals (dominant) come before small letters.
  const sorted = (m: Map<string, number>) => [...m.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  return { eggs, sperm, cells, genotypes: sorted(g), phenotypes: sorted(p), total: eggs.length * sperm.length };
}

/** The phenotype label of one cell, for colouring. */
export const cellPhenotype = (genes: readonly Gene[], pairs: readonly (readonly [string, string])[]) => genes.map((gene, k) => phenotype(gene, pairs[k]?.[0] ?? '', pairs[k]?.[1] ?? '')).join('; ');

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
/** Counts as the smallest whole-number ratio, e.g. 9 : 3 : 3 : 1. */
export function ratio(counts: readonly number[]): string {
  const g = counts.reduce((x, y) => gcd(x, y), 0) || 1;
  return counts.map((c) => c / g).join(' : ');
}

/* ------------------------------------------------------------ statistics -- */

/** ln Γ(x) (Lanczos). */
export function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941678, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -5.395239384953e-6];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const k of c) ser += k / ++y;
  return -tmp + Math.log((2.5066282746310002 * ser) / x);
}

/** The regularised upper incomplete gamma function Q(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const gln = lnGamma(a);
  if (x < a + 1) {
    // Series for P, then Q = 1 − P.
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  // Continued fraction for Q (Lentz).
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

/** The chance of a chi-square value at least this big with `df` degrees of freedom. */
export const chiSquareP = (chi2: number, df: number) => gammaQ(df / 2, chi2 / 2);

/** Pearson's chi-square of observed counts against an expected ratio. */
export function chiSquare(observed: readonly number[], expectedRatio: readonly number[]) {
  const n = observed.reduce((a, b) => a + b, 0);
  const r = expectedRatio.reduce((a, b) => a + b, 0);
  const expected = expectedRatio.map((x) => (n * x) / r);
  const chi2 = observed.reduce((s, o, i) => {
    const e = expected[i] ?? 0;
    return e > 0 ? s + (o - e) ** 2 / e : s;
  }, 0);
  const df = observed.length - 1;
  // Rounding leaves a perfect fit at 10⁻³⁰ or so rather than 0.
  const x = chi2 < 1e-9 ? 0 : chi2;
  return { n, expected, chi2: x, df, p: df > 0 ? chiSquareP(x, df) : 1 };
}

/** Whether genotype counts AA, Aa, aa fit Hardy–Weinberg proportions (one degree of freedom). */
export function hardyWeinberg(aa: number, ab: number, bb: number) {
  const n = aa + ab + bb;
  const p = (2 * aa + ab) / (2 * n);
  const q = 1 - p;
  const expected = [p * p * n, 2 * p * q * n, q * q * n];
  const chi2 = [aa, ab, bb].reduce((s, o, i) => {
    const e = expected[i] ?? 0;
    return e > 0 ? s + (o - e) ** 2 / e : s;
  }, 0);
  const x = chi2 < 1e-9 ? 0 : chi2;
  return { n, p, q, expected, chi2: x, pValue: chiSquareP(x, 1) };
}

/* ------------------------------------------------------------ populations -- */

/** A small, repeatable random number source (mulberry32). */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A binomial draw: counted out for small samples, by the normal approximation for big ones. */
function binomial(n: number, p: number, rand: () => number): number {
  if (p <= 0) return 0;
  if (p >= 1) return n;
  if (n <= 1000) {
    let k = 0;
    for (let i = 0; i < n; i++) if (rand() < p) k++;
    return k;
  }
  const u1 = Math.max(1e-12, rand());
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.min(n, Math.max(0, Math.round(n * p + z * Math.sqrt(n * p * (1 - p)))));
}

export interface Population {
  /** Starting frequency of allele A, population size (diploid individuals), generations. */
  readonly p0: number;
  readonly size: number;
  readonly generations: number;
  /** Relative fitness of AA, Aa and aa. */
  readonly fitness: readonly [number, number, number];
  /** Mutation rate from A to a and back, per generation. */
  readonly mutation?: number;
  readonly runs: number;
  readonly seed: number;
}

/** Wright–Fisher populations: random mating, then selection, mutation and a random sample of 2N alleles each generation. */
export function simulate(pop: Population): number[][] {
  const rand = random(pop.seed);
  const [wAA, wAa, waa] = pop.fitness;
  const u = pop.mutation ?? 0;
  const out: number[][] = [];
  for (let r = 0; r < pop.runs; r++) {
    let p = pop.p0;
    const line = [p];
    for (let g = 0; g < pop.generations; g++) {
      const q = 1 - p;
      const mean = p * p * wAA + 2 * p * q * wAa + q * q * waa;
      let next = mean > 0 ? (p * p * wAA + p * q * wAa) / mean : p;
      next = next * (1 - u) + (1 - next) * u;
      p = Number.isFinite(pop.size) ? binomial(2 * pop.size, next, rand) / (2 * pop.size) : next;
      line.push(p);
    }
    out.push(line);
  }
  return out;
}

/* ------------------------------------------------------- DNA to protein -- */

const BASES = 'UCAG';
const AMINO = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
const THREE: Readonly<Record<string, string>> = {
  A: 'Ala',
  R: 'Arg',
  N: 'Asn',
  D: 'Asp',
  C: 'Cys',
  Q: 'Gln',
  E: 'Glu',
  G: 'Gly',
  H: 'His',
  I: 'Ile',
  L: 'Leu',
  K: 'Lys',
  M: 'Met',
  F: 'Phe',
  P: 'Pro',
  S: 'Ser',
  T: 'Thr',
  W: 'Trp',
  Y: 'Tyr',
  V: 'Val',
  '*': 'Stop',
};

/** The standard genetic code: an mRNA codon to its one-letter amino acid ('*' for stop). */
export function codonToAmino(codon: string): string {
  const c = codon.toUpperCase().replace(/T/g, 'U');
  if (!/^[UCAG]{3}$/.test(c)) return '?';
  const i = BASES.indexOf(c[0] ?? '') * 16 + BASES.indexOf(c[1] ?? '') * 4 + BASES.indexOf(c[2] ?? '');
  return AMINO[i] ?? '?';
}
export const aminoName = (one: string) => THREE[one] ?? '?';

export const cleanDna = (text: string) =>
  text
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^ACGT]/g, '');
export const transcribe = (dna: string) => cleanDna(dna).replace(/T/g, 'U');
const PAIR: Readonly<Record<string, string>> = { A: 'T', T: 'A', C: 'G', G: 'C' };
export const complement = (dna: string) => [...cleanDna(dna)].map((b) => PAIR[b] ?? 'N').join('');

export interface Translation {
  /** Where the first AUG starts (−1: none), the codons read from there and the protein up to the stop. */
  readonly start: number;
  readonly codons: readonly string[];
  readonly protein: string;
  readonly stopped: boolean;
}

/** Reads from the first ATG to the first stop codon in frame. */
export function translate(dna: string): Translation {
  const mrna = transcribe(dna);
  const start = mrna.indexOf('AUG');
  if (start < 0) return { start, codons: [], protein: '', stopped: false };
  const codons: string[] = [];
  let protein = '';
  for (let i = start; i + 3 <= mrna.length; i += 3) {
    const codon = mrna.slice(i, i + 3);
    codons.push(codon);
    const aa = codonToAmino(codon);
    if (aa === '*') return { start, codons, protein, stopped: true };
    protein += aa;
  }
  return { start, codons, protein, stopped: false };
}

export type Mutation =
  | { readonly kind: 'substitute'; readonly at: number; readonly base: string }
  | { readonly kind: 'insert'; readonly at: number; readonly base: string }
  | { readonly kind: 'delete'; readonly at: number };

export function mutate(dna: string, m: Mutation): string {
  const s = cleanDna(dna);
  const at = Math.max(0, Math.min(s.length, m.at));
  if (m.kind === 'substitute') return s.slice(0, at) + cleanDna(m.base).slice(0, 1) + s.slice(at + 1);
  if (m.kind === 'insert') return s.slice(0, at) + cleanDna(m.base).slice(0, 1) + s.slice(at);
  return s.slice(0, at) + s.slice(at + 1);
}

/** What a mutation did to the protein. */
export function mutationEffect(before: Translation, after: Translation, m: Mutation): string {
  if (m.kind !== 'substitute') {
    const inFrame = after.start === before.start;
    return inFrame ? 'frameshift: every codon after it is read differently' : 'it moved the start codon';
  }
  if (after.protein === before.protein && after.stopped === before.stopped) return 'silent: the same amino acids';
  if (after.protein.length < before.protein.length && after.stopped && before.protein.startsWith(after.protein)) return 'nonsense: a stop codon cuts the protein short';
  if (after.protein.length === before.protein.length) {
    const diffs = [...after.protein].filter((a, i) => a !== before.protein[i]).length;
    return `missense: ${diffs} amino acid${diffs === 1 ? '' : 's'} changed`;
  }
  return 'the protein changed length (the stop codon was lost or moved)';
}
