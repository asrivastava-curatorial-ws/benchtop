/**
 * Matrices for the Matrix Calculator: reading "A = 1 2; 3 4" definitions, and
 * the operations math.js does not have (reduced row echelon form, rank, null
 * space, singular value decomposition, condition number).
 */
import { ToolError } from './errors';

export type Matrix = number[][];

const EPS = 1e-10;

/** Rows of numbers from "1 2; 3 4", "[[1,2],[3,4]]" or several lines of numbers. */
export function parseMatrix(text: string): Matrix {
  const t = text.trim();
  if (!t) throw new ToolError('The matrix is empty.');
  if (t.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(t.replace(/;/g, ','));
    } catch {
      throw new ToolError(`Could not read ${t.slice(0, 40)} as a matrix.`);
    }
    const rows = Array.isArray(data) && data.every(Array.isArray) ? (data as unknown[][]) : [data as unknown[]];
    return check(rows.map((r) => r.map(Number)));
  }
  const rows = t
    .split(/;|\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) =>
      r
        .split(/[\s,\t]+/)
        .filter(Boolean)
        .map((x) => {
          const n = Number(x);
          if (!Number.isFinite(n)) throw new ToolError(`"${x}" is not a number.`);
          return n;
        }),
    );
  return check(rows);
}

function check(m: Matrix): Matrix {
  const w = m[0]?.length ?? 0;
  if (!w) throw new ToolError('The matrix has no columns.');
  if (m.some((r) => r.length !== w)) throw new ToolError('Every row of a matrix needs the same number of values.');
  if (m.some((r) => r.some((x) => !Number.isFinite(x)))) throw new ToolError('A matrix holds numbers only.');
  return m;
}

/**
 * Definitions and expressions from the input: lines "NAME = values" (the values
 * may continue on the following lines) define matrices, other lines are
 * expressions to evaluate.
 */
export function parseInput(text: string): { matrices: Map<string, Matrix>; expressions: string[] } {
  const matrices = new Map<string, Matrix>();
  const expressions: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).replace(/#.*$/, '').trim();
    if (!line) continue;
    const def = /^([A-Za-z]\w*)\s*=\s*(.*)$/.exec(line);
    const isMatrix = def && /^[\d\s.,;eE+\-[\]]*$/.test(def[2] as string);
    if (def && isMatrix) {
      let body = def[2] as string;
      // Continuation lines: numbers only, until a blank line or another statement.
      while (i + 1 < lines.length && /^[\s\d.,;eE+\-[\]\t]+$/.test(lines[i + 1] as string) && (lines[i + 1] as string).trim()) body += `\n${lines[++i]}`;
      matrices.set(def[1] as string, parseMatrix(body));
    } else expressions.push(line);
  }
  return { matrices, expressions };
}

export const transpose = (m: Matrix): Matrix => (m[0] ?? []).map((_, j) => m.map((r) => r[j] as number));

/** Reduced row echelon form by Gauss–Jordan elimination with partial pivoting. */
export function rref(input: Matrix): { matrix: Matrix; pivots: number[] } {
  const m = input.map((r) => [...r]);
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  const pivots: number[] = [];
  let r = 0;
  const scale = Math.max(1, ...m.flat().map(Math.abs));
  for (let c = 0; c < cols && r < rows; c++) {
    let p = r;
    for (let i = r + 1; i < rows; i++) if (Math.abs((m[i] as number[])[c] as number) > Math.abs((m[p] as number[])[c] as number)) p = i;
    if (Math.abs((m[p] as number[])[c] as number) <= EPS * scale) continue;
    [m[r], m[p]] = [m[p] as number[], m[r] as number[]];
    const row = m[r] as number[];
    const pv = row[c] as number;
    for (let j = 0; j < cols; j++) row[j] = (row[j] as number) / pv;
    for (let i = 0; i < rows; i++) {
      if (i === r) continue;
      const f = (m[i] as number[])[c] as number;
      if (f !== 0) for (let j = 0; j < cols; j++) (m[i] as number[])[j] = ((m[i] as number[])[j] as number) - f * (row[j] as number);
    }
    pivots.push(c);
    r++;
  }
  return { matrix: m.map((row) => row.map((x) => (Math.abs(x) < EPS * scale ? 0 : x))), pivots };
}

export const rank = (m: Matrix): number => rref(m).pivots.length;

/** A basis of the null space (columns), from the free variables of the reduced form. */
export function nullSpace(m: Matrix): Matrix {
  const { matrix, pivots } = rref(m);
  const cols = m[0]?.length ?? 0;
  const free = Array.from({ length: cols }, (_, j) => j).filter((j) => !pivots.includes(j));
  const basis = free.map((f) => {
    const v = new Array<number>(cols).fill(0);
    v[f] = 1;
    pivots.forEach((p, i) => {
      v[p] = -((matrix[i] as number[])[f] as number);
    });
    return v;
  });
  return basis.length ? transpose(basis) : [];
}

/**
 * Singular value decomposition A = U·S·Vᵀ by one-sided Jacobi rotations, which
 * is simple and accurate for the matrix sizes typed by hand.
 */
export function svd(input: Matrix): { U: Matrix; S: number[]; V: Matrix } {
  const wide = (input[0]?.length ?? 0) > input.length;
  const a = wide ? transpose(input) : input.map((r) => [...r]);
  const m = a.length;
  const n = a[0]?.length ?? 0;
  const v: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 80; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < m; i++) {
          const ap = (a[i] as number[])[p] as number;
          const aq = (a[i] as number[])[q] as number;
          alpha += ap * ap;
          beta += aq * aq;
          gamma += ap * aq;
        }
        if (Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta) || gamma === 0) continue;
        off = Math.max(off, Math.abs(gamma) / Math.sqrt(alpha * beta));
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i++) {
          const row = a[i] as number[];
          const ap = row[p] as number;
          const aq = row[q] as number;
          row[p] = c * ap - s * aq;
          row[q] = s * ap + c * aq;
        }
        for (let i = 0; i < n; i++) {
          const row = v[i] as number[];
          const vp = row[p] as number;
          const vq = row[q] as number;
          row[p] = c * vp - s * vq;
          row[q] = s * vp + c * vq;
        }
      }
    if (off < 1e-15) break;
  }
  const S = Array.from({ length: n }, (_, j) => Math.sqrt(a.reduce((sum, r) => sum + (r[j] as number) ** 2, 0)));
  const order = S.map((_, j) => j).sort((x, y) => (S[y] as number) - (S[x] as number));
  const U = a.map((r) => order.map((j) => ((S[j] as number) > EPS ? (r[j] as number) / (S[j] as number) : 0)));
  const Vs = v.map((r) => order.map((j) => r[j] as number));
  const Ss = order.map((j) => S[j] as number);
  return wide ? { U: Vs, S: Ss, V: U } : { U, S: Ss, V: Vs };
}

/** The 2-norm condition number: largest over smallest singular value. */
export function cond(m: Matrix): number {
  const { S } = svd(m);
  const min = S[S.length - 1] ?? 0;
  return min <= EPS * (S[0] ?? 1) ? Number.POSITIVE_INFINITY : (S[0] as number) / min;
}

const num = (x: number, digits: number) => {
  if (Math.abs(x) < 1e-12) return '0';
  const r = Number(x.toPrecision(digits));
  return Number.isInteger(r) ? String(r) : String(r);
};

/** A matrix as aligned columns of text. */
export function formatMatrix(m: Matrix, digits = 6): string {
  const cells = m.map((r) => r.map((x) => num(x, digits)));
  const widths = (cells[0] ?? []).map((_, j) => Math.max(...cells.map((r) => (r[j] as string).length)));
  return cells.map((r) => r.map((c, j) => c.padStart(widths[j] as number)).join('  ')).join('\n');
}

export function matrixLatex(m: Matrix, digits = 6): string {
  return `\\begin{bmatrix} ${m.map((r) => r.map((x) => num(x, digits)).join(' & ')).join(' \\\\ ')} \\end{bmatrix}`;
}
