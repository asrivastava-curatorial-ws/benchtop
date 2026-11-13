import { trimNumber } from '../../lib/color';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

const TABLE = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 112, 128];

export default defineTextTool({
  input: false,
  output: { label: 'Reference table' },
  options: [
    { key: 'value', label: 'Value', type: 'text', default: '24', mono: true, placeholder: '24, 1.5rem, 18px' },
    {
      key: 'direction',
      label: 'Convert',
      type: 'segmented',
      choices: [
        { value: 'px', label: 'px → rem' },
        { value: 'rem', label: 'rem → px' },
      ],
      default: 'px',
    },
    { key: 'base', label: 'Root font size', type: 'number', default: 16, min: 1, max: 200, step: 1, unit: 'px' },
    { key: 'precision', label: 'Decimals', type: 'number', default: 4, min: 0, max: 8, step: 1 },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const match = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(px|rem|em)?\s*$/i.exec(o.value);
    if (!match) throw new ToolError(`"${o.value}" is not a length. Enter a number, optionally followed by px or rem.`);
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    // A unit typed by the user wins over the direction switch.
    const fromPx = unit ? unit === 'px' : o.direction === 'px';
    const px = fromPx ? amount : amount * o.base;
    const rem = px / o.base;
    const fields: Field[] = [
      { label: 'Pixels', value: `${trimNumber(px, o.precision)}px`, mono: true },
      { label: 'rem', value: `${trimNumber(rem, o.precision)}rem`, mono: true },
      { label: 'em (same font size)', value: `${trimNumber(rem, o.precision)}em`, mono: true },
      { label: 'Percent of root', value: `${trimNumber(rem * 100, Math.max(0, o.precision - 2))}%`, mono: true },
      { label: 'Points (print)', value: `${trimNumber(px * 0.75, o.precision)}pt`, mono: true },
      { label: 'Tailwind spacing', value: `${trimNumber(rem * 4, 4)}  (e.g. p-${trimNumber(rem * 4, 4)})`, mono: true },
    ];
    const rows = TABLE.map((size) => `${String(size).padStart(4)}px  =  ${trimNumber(size / o.base, o.precision)}rem`);
    return { output: `Root font size: ${o.base}px\n\n${rows.join('\n')}`, fields };
  },
});
