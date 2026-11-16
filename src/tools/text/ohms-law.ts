import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { num } from './_calc';

const PREFIXES: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
];

export const engineering = (value: number, unit: string): string => {
  if (value === 0 || !Number.isFinite(value)) return `${num(value, 4)} ${unit}`;
  const [factor, prefix] = PREFIXES.find(([size]) => Math.abs(value) >= size * 0.9999) ?? PREFIXES[PREFIXES.length - 1] ?? [1, ''];
  return `${Number((value / factor).toPrecision(5))} ${prefix}${unit}`;
};

/** Solves V = I·R and P = V·I from any two of the four. */
export function solveOhm(known: Partial<Record<'v' | 'i' | 'r' | 'p', number>>): Record<'v' | 'i' | 'r' | 'p', number> {
  let { v, i, r, p } = known;
  if (v !== undefined && i !== undefined) {
    r = v / i;
    p = v * i;
  } else if (v !== undefined && r !== undefined) {
    i = v / r;
    p = (v * v) / r;
  } else if (v !== undefined && p !== undefined) {
    i = p / v;
    r = (v * v) / p;
  } else if (i !== undefined && r !== undefined) {
    v = i * r;
    p = i * i * r;
  } else if (i !== undefined && p !== undefined) {
    v = p / i;
    r = p / (i * i);
  } else if (r !== undefined && p !== undefined) {
    v = Math.sqrt(p * r);
    i = Math.sqrt(p / r);
  } else throw new ToolError('Enter any two of voltage, current, resistance and power.');
  return { v: v as number, i: i as number, r: r as number, p: p as number };
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'v', label: 'Voltage', type: 'text', default: '230', mono: true, placeholder: 'V' },
    { key: 'i', label: 'Current', type: 'text', default: '', mono: true, placeholder: 'A' },
    { key: 'r', label: 'Resistance', type: 'text', default: '52.9', mono: true, placeholder: 'Ω (k and M prefixes work)' },
    { key: 'p', label: 'Power', type: 'text', default: '', mono: true, placeholder: 'W' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const read = (text: string): number | undefined => {
      const match = /^\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*([GMkmuµn]?)/i.exec(text);
      if (!match || text.trim() === '') return undefined;
      const scale: Record<string, number> = { G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, µ: 1e-6, n: 1e-9, '': 1 };
      return Number(match[1]) * (scale[match[2] as string] ?? 1);
    };
    const known = { v: read(o.v), i: read(o.i), r: read(o.r), p: read(o.p) };
    const given = Object.values(known).filter((value) => value !== undefined).length;
    if (given !== 2) throw new ToolError(given > 2 ? 'Leave all but two of the boxes empty, so the others can be worked out.' : 'Enter any two of voltage, current, resistance and power.');
    const result = solveOhm(known);
    const fields: Field[] = [
      { label: 'Voltage', value: engineering(result.v, 'V'), mono: true, tone: known.v === undefined ? 'ok' : undefined },
      { label: 'Current', value: engineering(result.i, 'A'), mono: true, tone: known.i === undefined ? 'ok' : undefined },
      { label: 'Resistance', value: engineering(result.r, 'Ω'), mono: true, tone: known.r === undefined ? 'ok' : undefined },
      { label: 'Power', value: engineering(result.p, 'W'), mono: true, tone: known.p === undefined ? 'ok' : undefined },
      { label: 'Conductance', value: engineering(1 / result.r, 'S'), mono: true },
      { label: 'Energy in one hour', value: engineering(result.p * 3600, 'J'), mono: true },
    ];
    return { fields, info: 'DC or resistive AC (RMS values). Prefixes such as 4.7k, 2M and 300m are understood.' };
  },
});
