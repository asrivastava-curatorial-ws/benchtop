import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { num } from './_calc';

const RANGES: Record<string, [number, number, string]> = {
  '4-20': [4, 20, 'mA'],
  '0-20': [0, 20, 'mA'],
  '0-10': [0, 10, 'V'],
  '1-5': [1, 5, 'V'],
  s7: [0, 27648, 'counts (Siemens S7)'],
  ab: [0, 32767, 'counts (16-bit signed)'],
  '12bit': [0, 4095, 'counts (12-bit)'],
  '16bit': [0, 65535, 'counts (16-bit unsigned)'],
};

export default defineTextTool({
  input: false,
  output: { label: 'Code' },
  options: [
    {
      key: 'signal',
      label: 'Signal range',
      type: 'select',
      choices: [
        { value: '4-20', label: '4–20 mA' },
        { value: '0-20', label: '0–20 mA' },
        { value: '0-10', label: '0–10 V' },
        { value: '1-5', label: '1–5 V' },
        { value: 's7', label: '0–27648 (Siemens S7)' },
        { value: 'ab', label: '0–32767' },
        { value: '12bit', label: '0–4095 (12-bit)' },
        { value: '16bit', label: '0–65535' },
        { value: 'custom', label: 'Custom' },
      ],
      default: '4-20',
    },
    { key: 'rawLow', label: 'Raw low', type: 'number', default: 4, step: 0.01, showIf: (v) => v.signal === 'custom' },
    { key: 'rawHigh', label: 'Raw high', type: 'number', default: 20, step: 0.01, showIf: (v) => v.signal === 'custom' },
    { key: 'low', label: 'Engineering value at the low end', type: 'number', default: 0, step: 0.01 },
    { key: 'high', label: 'Engineering value at the high end', type: 'number', default: 10, step: 0.01 },
    { key: 'unit', label: 'Engineering unit', type: 'text', default: 'bar' },
    {
      key: 'direction',
      label: 'Convert',
      type: 'segmented',
      choices: [
        { value: 'toEu', label: 'Signal → value' },
        { value: 'toRaw', label: 'Value → signal' },
      ],
      default: 'toEu',
    },
    { key: 'input', label: 'Input', type: 'number', default: 12, step: 0.01 },
    { key: 'sqrt', label: 'Square-root extraction (DP flow)', type: 'toggle', default: false },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const [rawLow, rawHigh, rawUnit] = o.signal === 'custom' ? [o.rawLow, o.rawHigh, ''] : (RANGES[o.signal] as [number, number, string]);
    if (rawHigh === rawLow || o.high === o.low) throw new ToolError('The low and high ends must differ.');
    const fields: Field[] = [];
    let fraction: number;
    if (o.direction === 'toEu') {
      fraction = (o.input - rawLow) / (rawHigh - rawLow);
      const shaped = o.sqrt ? Math.sqrt(Math.max(0, fraction)) : fraction;
      const value = o.low + shaped * (o.high - o.low);
      fields.push({ label: 'Value', value: `${num(value, 4)} ${o.unit}`, mono: true, tone: fraction < -0.0125 || fraction > 1.0125 ? 'bad' : 'ok' });
    } else {
      const shaped = (o.input - o.low) / (o.high - o.low);
      fraction = o.sqrt ? shaped * shaped : shaped;
      fields.push({ label: 'Signal', value: `${num(rawLow + fraction * (rawHigh - rawLow), 4)} ${rawUnit}`, mono: true, tone: 'ok' });
    }
    fields.push({ label: 'Percent of span', value: `${num(fraction * 100, 2)}%`, mono: true });
    if (o.signal === '4-20' && o.direction === 'toEu' && o.input < 3.8)
      fields.push({ label: 'Diagnosis', value: o.input < 3.6 ? 'Below 3.6 mA: NAMUR NE 43 failure signal (broken wire or sensor fault)' : 'Below range (under-range signal)', tone: 'bad' });
    if (o.signal === '4-20' && o.direction === 'toEu' && o.input > 20.5)
      fields.push({ label: 'Diagnosis', value: o.input > 21 ? 'Above 21 mA: NAMUR NE 43 failure signal' : 'Above range (over-range signal)', tone: 'bad' });
    const slope = (o.high - o.low) / (rawHigh - rawLow);
    const offset = o.low - slope * rawLow;
    const code = [
      `// ${rawLow}–${rawHigh} ${rawUnit} → ${o.low}–${o.high} ${o.unit}${o.sqrt ? ' (square-root extraction)' : ''}`,
      o.sqrt
        ? `value := ${o.low} + SQRT(MAX(0.0, (raw - ${rawLow}) / ${rawHigh - rawLow})) * ${o.high - o.low};`
        : `value := raw * ${Number(slope.toPrecision(8))} ${offset < 0 ? '-' : '+'} ${Math.abs(Number(offset.toPrecision(8)))};`,
      '',
      '// Structured Text, as a reusable expression:',
      `value := ${o.low} + (raw - ${rawLow}) * (${o.high} - ${o.low}) / (${rawHigh} - ${rawLow});`,
    ].join('\n');
    return { fields, output: code };
  },
});
