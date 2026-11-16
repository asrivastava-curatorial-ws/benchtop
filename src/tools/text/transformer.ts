import { IEC_TRANSFORMERS, SQRT3, US_TRANSFORMERS } from '../../lib/electrical';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'phase',
      label: 'Transformer',
      type: 'segmented',
      choices: [
        { value: '3', label: 'Three-phase' },
        { value: '1', label: 'Single-phase' },
      ],
      default: '3',
    },
    {
      key: 'mode',
      label: 'Start from',
      type: 'segmented',
      choices: [
        { value: 'rating', label: 'Its rating' },
        { value: 'load', label: 'The load to supply' },
      ],
      default: 'rating',
    },
    { key: 'kva', label: 'Rating', type: 'number', default: 500, min: 0.1, step: 1, unit: 'kVA', showIf: (v) => v.mode === 'rating' },
    { key: 'loadKw', label: 'Connected load', type: 'number', default: 320, min: 0, step: 1, unit: 'kW', showIf: (v) => v.mode === 'load' },
    { key: 'demand', label: 'Demand factor', type: 'number', default: 0.8, min: 0.1, max: 1, step: 0.05, showIf: (v) => v.mode === 'load' },
    { key: 'pf', label: 'Load power factor', type: 'number', default: 0.9, min: 0.5, max: 1, step: 0.01, showIf: (v) => v.mode === 'load' },
    { key: 'growth', label: 'Future growth', type: 'number', default: 20, min: 0, max: 200, step: 5, unit: '%', showIf: (v) => v.mode === 'load' },
    { key: 'loading', label: 'Maximum loading', type: 'number', default: 80, min: 30, max: 100, step: 5, unit: '%', showIf: (v) => v.mode === 'load' },
    { key: 'primary', label: 'Primary voltage', type: 'number', default: 11000, min: 1, step: 1, unit: 'V' },
    { key: 'secondary', label: 'Secondary voltage', type: 'number', default: 433, min: 1, step: 1, unit: 'V' },
    { key: 'impedance', label: 'Impedance', type: 'number', default: 4.5, min: 0.5, max: 20, step: 0.1, unit: '%' },
    {
      key: 'sizes',
      label: 'Standard ratings',
      type: 'segmented',
      choices: [
        { value: 'iec', label: 'IEC / IS' },
        { value: 'us', label: 'US' },
      ],
      default: 'iec',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    let kva = o.kva;
    const fields: Field[] = [];
    if (o.mode === 'load') {
      const needed = (((o.loadKw * o.demand) / o.pf) * (1 + o.growth / 100)) / (o.loading / 100);
      const sizes = o.sizes === 'us' ? US_TRANSFORMERS : IEC_TRANSFORMERS;
      kva = sizes.find((size) => size >= needed) ?? Math.ceil(needed / 500) * 500;
      fields.push(
        { label: 'Load to supply', value: `${num(o.loadKw * o.demand, 1)} kW → ${num(needed, 1)} kVA with growth and loading margin`, mono: true },
        { label: 'Choose', value: `${kva} kVA`, mono: true, tone: 'ok' },
      );
    }
    if (!(kva > 0)) throw new ToolError('Enter the rating.');
    const divisor = (volts: number) => (o.phase === '3' ? SQRT3 * volts : volts);
    const primaryAmps = (kva * 1000) / divisor(o.primary);
    const secondaryAmps = (kva * 1000) / divisor(o.secondary);
    const faultAmps = secondaryAmps / (o.impedance / 100);
    fields.push(
      heading('Currents at full load'),
      { label: 'Primary', value: `${num(primaryAmps, 2)} A`, mono: true },
      { label: 'Secondary', value: `${num(secondaryAmps, 1)} A`, mono: true },
      heading('Other values'),
      { label: 'Turns ratio', value: `${num(o.primary / o.secondary, 3)} : 1`, mono: true },
      { label: 'Secondary fault current (infinite source)', value: `${num(faultAmps / 1000, 2)} kA`, mono: true, tone: 'warn' },
      { label: 'Fault level', value: `${num(kva / (o.impedance / 100) / 1000, 2)} MVA`, mono: true },
      { label: 'Breaking capacity needed downstream', value: `at least ${num(Math.ceil(faultAmps / 1000), 0)} kA` },
    );
    return { fields, info: `${ESTIMATE} The fault current ignores the supply and cable impedance, so the real value is lower.` };
  },
});
