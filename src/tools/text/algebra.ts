import { ToolError } from '../../lib/errors';
import { formatComplex, polynomialRoots } from '../../lib/poly-roots';
import { defineTextTool, type Field, type TextResult } from '../types';

let math: Promise<import('mathjs').MathJsInstance> | null = null;
const load = () => {
  math ??= import('mathjs').then(({ all, create }) => create(all, { number: 'number' }));
  return math;
};

const SAMPLE = 'x^3 - 6x^2 + 11x - 6';

/** "a = b" becomes "a - (b)"; implicit products like 6x are fine for math.js. */
const asExpression = (text: string) => {
  const parts = text.split('=');
  if (parts.length > 2) throw new ToolError('Use at most one = sign.');
  return parts.length === 2 ? `(${parts[0]}) - (${parts[1]})` : text;
};

export default defineTextTool({
  input: { label: 'Expression or equation', language: 'text', sample: SAMPLE, placeholder: 'x^2 - 5x + 6 = 0' },
  output: { label: 'Result' },
  options: [
    {
      key: 'op',
      label: 'Do',
      type: 'select',
      choices: [
        { value: 'solve', label: 'Solve for the variable (polynomials)' },
        { value: 'simplify', label: 'Simplify' },
        { value: 'expand', label: 'Expand and collect terms' },
        { value: 'derivative', label: 'Derivative' },
        { value: 'evaluate', label: 'Evaluate at a value' },
      ],
      default: 'solve',
    },
    { key: 'variable', label: 'Variable', type: 'text', default: 'x', mono: true },
    { key: 'at', label: 'Value', type: 'number', default: 2, min: -1e12, max: 1e12, step: 0.1, showIf: (v) => v.op === 'evaluate' },
    { key: 'order', label: 'Order', type: 'number', default: 1, min: 1, max: 6, step: 1, showIf: (v) => v.op === 'derivative' },
  ],
  async run(input, o): Promise<TextResult> {
    const m = await load();
    const text = input.trim();
    if (!text) throw new ToolError('Type an expression such as x^2 - 5x + 6.');
    const variable = o.variable.trim() || 'x';
    const parse = (t: string) => {
      try {
        return m.parse(t);
      } catch (error) {
        throw new ToolError(`math.js could not read this: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const node = parse(asExpression(text));
    const fields: Field[] = [];
    let output: string;
    if (o.op === 'simplify') {
      const s = m.simplify(node);
      output = s.toString();
      fields.push({ label: 'LaTeX', value: s.toTex(), mono: true });
    } else if (o.op === 'expand') {
      const r = m.rationalize(node, {}, true) as unknown as { expression: import('mathjs').MathNode };
      output = r.expression.toString();
      fields.push({ label: 'LaTeX', value: r.expression.toTex(), mono: true });
    } else if (o.op === 'derivative') {
      let d = node;
      for (let k = 0; k < o.order; k++) d = m.derivative(d, variable);
      const s = m.simplify(d);
      output = s.toString();
      fields.push({ label: 'LaTeX', value: s.toTex(), mono: true });
    } else if (o.op === 'evaluate') {
      const value = node.evaluate({ [variable]: o.at });
      output = m.format(value, { precision: 14 });
    } else {
      let detail: { coefficients?: number[]; variables?: string[]; expression: import('mathjs').MathNode };
      try {
        detail = m.rationalize(node, {}, true) as unknown as typeof detail;
      } catch {
        throw new ToolError('Only polynomials can be solved here, such as 2x^3 - 3x + 1 = 0.');
      }
      if (!detail.coefficients || (detail.variables?.length ?? 0) > 1) throw new ToolError('Solving needs a polynomial in one variable, with numbers for coefficients.');
      if (detail.variables?.[0] && detail.variables[0] !== variable) throw new ToolError(`The equation is in ${detail.variables[0]}; set Variable to ${detail.variables[0]}.`);
      const roots = polynomialRoots(detail.coefficients);
      if (!roots.length) throw new ToolError('There is nothing to solve: the variable cancels out.');
      output = roots.map((r, i) => `${variable}${roots.length > 1 ? `${i + 1}` : ''} = ${formatComplex(r)}`).join('\n');
      fields.push(
        { label: 'Polynomial', value: detail.expression.toString(), mono: true },
        { label: 'Degree', value: String(detail.coefficients.length - 1) },
        { label: 'Real roots', value: String(roots.filter((r) => r.im === 0).length) },
      );
    }
    return { output, fields, info: 'Exact rules from math.js; roots are found numerically to about 10 significant digits' };
  },
});
