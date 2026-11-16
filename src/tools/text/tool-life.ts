import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { duration, heading, num } from './_calc';

/** Typical Taylor exponents n for V·Tⁿ = C. */
const TOOLS: Record<string, { label: string; n: number }> = {
  hss: { label: 'HSS (n ≈ 0.125)', n: 0.125 },
  carbide: { label: 'Uncoated carbide (n ≈ 0.25)', n: 0.25 },
  coated: { label: 'Coated carbide (n ≈ 0.3)', n: 0.3 },
  ceramic: { label: 'Ceramic (n ≈ 0.6)', n: 0.6 },
};

export const taylorC = (v: number, t: number, n: number): number => v * t ** n;
export const taylorLife = (c: number, v: number, n: number): number => (c / v) ** (1 / n);
export const taylorSpeed = (c: number, t: number, n: number): number => c / t ** n;

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'mode',
      label: 'Known data',
      type: 'segmented',
      choices: [
        { value: 'one', label: 'One test and the tool type' },
        { value: 'two', label: 'Two tests' },
      ],
      default: 'one',
    },
    { key: 'tool', label: 'Tool material', type: 'select', choices: Object.entries(TOOLS).map(([value, { label }]) => ({ value, label })), default: 'coated', showIf: (v) => v.mode === 'one' },
    { key: 'v1', label: 'Test 1 cutting speed', type: 'number', default: 200, min: 0.1, step: 5, unit: 'm/min' },
    { key: 't1', label: 'Test 1 tool life', type: 'number', default: 15, min: 0.1, step: 1, unit: 'min' },
    { key: 'v2', label: 'Test 2 cutting speed', type: 'number', default: 250, min: 0.1, step: 5, unit: 'm/min', showIf: (v) => v.mode === 'two' },
    { key: 't2', label: 'Test 2 tool life', type: 'number', default: 7, min: 0.1, step: 1, unit: 'min', showIf: (v) => v.mode === 'two' },
    { key: 'speed', label: 'Speed to evaluate', type: 'number', default: 180, min: 0.1, step: 5, unit: 'm/min' },
    { key: 'change', label: 'Tool change time', type: 'number', default: 2, min: 0, step: 0.5, unit: 'min' },
    { key: 'edgeCost', label: 'Cost per cutting edge', type: 'number', default: 150, min: 0, step: 10 },
    { key: 'rate', label: 'Machine and operator cost per minute', type: 'number', default: 15, min: 0, step: 1 },
  ],
  runOnEmpty: true,
  run(_input, o) {
    let n: number;
    if (o.mode === 'two') {
      if (o.v1 === o.v2 || o.t1 === o.t2) throw new ToolError('The two tests need different speeds and lives.');
      n = Math.log(o.v1 / o.v2) / Math.log(o.t2 / o.t1);
      if (!(n > 0 && n < 1.5)) throw new ToolError('The tests give a non-physical exponent: life should fall as speed rises.');
    } else {
      n = (TOOLS[o.tool] ?? (TOOLS.coated as { n: number })).n;
    }
    const c = taylorC(o.v1, o.t1, n);
    const life = taylorLife(c, o.speed, n);
    // Gilbert: minimum-cost life T = (1/n − 1)(tc + Ct/Co); maximum-production life T = (1/n − 1)·tc.
    const costLife = (1 / n - 1) * (o.change + (o.rate > 0 ? o.edgeCost / o.rate : 0));
    const productionLife = (1 / n - 1) * o.change;
    const fields: Field[] = [
      { label: 'Taylor exponent n', value: num(n, 3), mono: true },
      { label: 'Taylor constant C', value: `${num(c, 1)} m/min (speed for a 1-minute life)`, mono: true },
      { label: `Tool life at ${o.speed} m/min`, value: duration(life), mono: true, tone: 'ok' },
      heading('Economic speeds'),
      { label: 'Minimum cost', value: `${num(taylorSpeed(c, costLife, n), 0)} m/min for a ${duration(costLife)} life`, mono: true, tone: 'ok' },
      { label: 'Maximum output', value: o.change > 0 ? `${num(taylorSpeed(c, productionLife, n), 0)} m/min for a ${duration(productionLife)} life` : 'Enter the tool change time', mono: true },
      heading('Life against speed'),
    ];
    for (const factor of [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3]) {
      const v = o.speed * factor;
      fields.push({
        label: `${num(v, 0)} m/min (${factor === 1 ? 'chosen' : `${factor > 1 ? '+' : '−'}${Math.round(Math.abs(factor - 1) * 100)}%`})`,
        value: duration(taylorLife(c, v, n)),
        mono: true,
        tone: factor === 1 ? 'ok' : undefined,
      });
    }
    return { fields, info: 'Taylor’s equation V·Tⁿ = C holds for one tool, workpiece, feed and depth of cut; re-test when those change.' };
  },
});
