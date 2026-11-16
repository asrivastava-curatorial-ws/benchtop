import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

let math: Promise<import('mathjs').MathJsInstance> | null = null;

async function load() {
  math ??= import('mathjs').then(({ all, create }) => create(all, { number: 'number', precision: 64 }));
  return math;
}

export default defineTextTool({
  input: {
    label: 'Expressions',
    placeholder: 'One per line; earlier lines can define variables',
    sample: 'r = 2.5 m\narea = pi * r^2\narea to ft^2\nsqrt(3^2 + 4^2)\n15% * 2400\nsin(30 deg)\n[1, 2; 3, 4] * 2\n5 kW * 8 h to kWh\n1.21 GW / (88 mi/h) to N',
  },
  output: { label: 'Results' },
  options: [
    { key: 'precision', label: 'Significant digits', type: 'number', default: 12, min: 1, max: 64, step: 1 },
    { key: 'echo', label: 'Show the expressions', type: 'toggle', default: true },
  ],
  async run(input, o) {
    const engine = await load();
    const scope = new Map<string, unknown>();
    const lines = input.split(/\r?\n/);
    const out = lines.map((line, index) => {
      const expression = line.replace(/\s*(#|\/\/).*$/, '').replace(/(\d)%(?!\s*\d)/g, '($1/100)');
      if (expression.trim() === '') return line;
      try {
        const value = engine.evaluate(expression, scope);
        if (typeof value === 'function') return o.echo ? `${line}  → function` : 'function';
        const text = value === undefined ? '' : engine.format(value, { precision: o.precision });
        return o.echo ? `${line} = ${text}` : text;
      } catch (error) {
        throw new ToolError(`Line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`, { line: index + 1 });
      }
    });
    return { output: out.join('\n'), info: 'Units (m, ft, kg, kWh, deg…), matrices, complex numbers and variables work. Powered by math.js.' };
  },
});
