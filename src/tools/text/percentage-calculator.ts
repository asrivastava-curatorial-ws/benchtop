import { defineTextTool, type Field } from '../types';

const fmt = (value: number): string => (Number.isFinite(value) ? Number(value.toFixed(6)).toLocaleString('en-IN', { maximumFractionDigits: 6 }) : '—');

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'a', label: 'X', type: 'number', default: 15, step: 0.01 },
    { key: 'b', label: 'Y', type: 'number', default: 240, step: 0.01 },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const { a, b } = o;
    const change = ((b - a) / Math.abs(a)) * 100;
    const fields: Field[] = [
      { label: `${fmt(a)}% of ${fmt(b)}`, value: fmt((a / 100) * b), mono: true },
      { label: `${fmt(a)} is what % of ${fmt(b)}`, value: `${fmt((a / b) * 100)}%`, mono: true },
      { label: `${fmt(b)} is what % of ${fmt(a)}`, value: `${fmt((b / a) * 100)}%`, mono: true },
      { label: `Change from ${fmt(a)} to ${fmt(b)}`, value: `${change >= 0 ? '+' : ''}${fmt(change)}%`, mono: true, tone: change >= 0 ? 'ok' : 'bad' },
      { label: `Difference as % of the average`, value: `${fmt((Math.abs(a - b) / ((a + b) / 2)) * 100)}%`, mono: true },
      { label: `${fmt(b)} increased by ${fmt(a)}%`, value: fmt(b * (1 + a / 100)), mono: true },
      { label: `${fmt(b)} decreased by ${fmt(a)}%`, value: fmt(b * (1 - a / 100)), mono: true },
      { label: `${fmt(b)} is ${fmt(a)}% more than`, value: fmt(b / (1 + a / 100)), mono: true },
      { label: `${fmt(b)} plus ${fmt(a)}% GST`, value: `${fmt(b * (1 + a / 100))} (tax ${fmt((b * a) / 100)})`, mono: true },
      { label: `${fmt(b)} including ${fmt(a)}% GST`, value: `${fmt(b / (1 + a / 100))} before tax (tax ${fmt(b - b / (1 + a / 100))})`, mono: true },
    ];
    return { fields };
  },
});
