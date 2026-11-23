import { ToolError } from '../../lib/errors';
import { cond, formatMatrix, type Matrix, matrixLatex, nullSpace, parseInput, rank, rref, svd } from '../../lib/matrix';
import { defineTextTool } from '../types';

const SAMPLE = `A = 4 -2 1; 3 6 -4; 2 1 8
B = 12; -25; 32

det(A)
inv(A)
A \\ B
eigs(A)
rank(A)
svd(A)`;

let math: Promise<import('mathjs').MathJsInstance> | null = null;
const load = () => {
  math ??= import('mathjs').then(({ all, create }) => create(all, { number: 'number' }));
  return math;
};

const asArray = (m: unknown): Matrix => {
  const v = (m as { valueOf?: () => unknown })?.valueOf?.() ?? m;
  if (Array.isArray(v)) return (v as unknown[]).map((r) => (Array.isArray(r) ? (r as number[]).map(Number) : [Number(r)]));
  return [[Number(v)]];
};

export default defineTextTool({
  input: { label: 'Matrices and expressions', language: 'text', sample: SAMPLE, placeholder: 'A = 1 2; 3 4\ninv(A)' },
  output: { label: 'Results' },
  options: [
    { key: 'digits', label: 'Significant digits', type: 'number', default: 6, min: 2, max: 15, step: 1 },
    { key: 'latex', label: 'Also show LaTeX', type: 'toggle', default: false },
  ],
  async run(input, o) {
    const { matrices, expressions } = parseInput(input);
    if (!matrices.size && !expressions.length) throw new ToolError('Define a matrix such as A = 1 2; 3 4, then write an expression such as inv(A) on its own line.');
    const m = await load();
    const scope: Record<string, unknown> = {};
    for (const [name, value] of matrices) scope[name] = m.matrix(value);
    // Functions math.js lacks, working on plain arrays.
    const plain = (x: unknown) => asArray(x);
    m.import(
      {
        rref: (x: unknown) => m.matrix(rref(plain(x)).matrix),
        rank: (x: unknown) => rank(plain(x)),
        nullspace: (x: unknown) => m.matrix(nullSpace(plain(x))),
        cond: (x: unknown) => cond(plain(x)),
        svd: (x: unknown) => {
          const r = svd(plain(x));
          return { U: m.matrix(r.U), S: r.S, V: m.matrix(r.V) };
        },
      },
      { override: true },
    );
    const show = (value: unknown): string => {
      if (value && typeof value === 'object' && 'U' in (value as object) && 'S' in (value as object)) {
        const r = value as { U: unknown; S: number[]; V: unknown };
        return `U =\n${formatMatrix(asArray(r.U), o.digits)}\n\nsingular values = ${r.S.map((s) => Number(s.toPrecision(o.digits))).join(', ')}\n\nV =\n${formatMatrix(asArray(r.V), o.digits)}`;
      }
      if (value && typeof value === 'object' && 'values' in (value as object) && 'eigenvectors' in (value as object)) {
        const r = value as { values: unknown; eigenvectors: { value: unknown; vector: unknown }[] };
        return r.eigenvectors.map((e, i) => `λ${i + 1} = ${m.format(e.value, { precision: o.digits })}\n  vector: ${m.format(e.vector, { precision: o.digits })}`).join('\n');
      }
      if (value && typeof value === 'object' && ('_data' in (value as object) || Array.isArray(value))) {
        const arr = asArray(value);
        return `${formatMatrix(arr, o.digits)}${o.latex ? `\n${matrixLatex(arr, o.digits)}` : ''}`;
      }
      return m.format(value, { precision: o.digits });
    };
    const blocks: string[] = [];
    for (const [name, value] of matrices) blocks.push(`${name} (${value.length}×${value[0]?.length ?? 0}) =\n${formatMatrix(value, o.digits)}`);
    // MATLAB-style "A \\ b" (solve A·x = b) becomes math.js lusolve(A, b).
    const operand = String.raw`(?:[A-Za-z_]\w*'?|\([^()]*\)|\[[^\[\]]*\])`;
    const solve = new RegExp(`(${operand})\\s*\\\\\\s*(${operand})`, 'g');
    for (const expr of expressions) {
      try {
        const value = m.evaluate(expr.replace(solve, 'lusolve($1, $2)'), scope);
        const assign = /^([A-Za-z]\w*)\s*=/.exec(expr);
        if (assign) scope[assign[1] as string] = value;
        blocks.push(`${expr} =\n${show(value)}`);
      } catch (error) {
        blocks.push(`${expr}\n  ✗ ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      output: `${blocks.join('\n\n')}\n`,
      info: "Expressions use math.js: inv, det, transpose (A'), A * B, A .* B, A \\ b (solve), eigs, lup, qr, pinv, kron, trace, norm, plus rref, rank, nullspace, svd and cond.",
    };
  },
});
