import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';
import { ESTIMATE, heading, num } from './_calc';

const STEPS = [1, 2, 2.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300];

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'kw', label: 'Load', type: 'number', default: 100, min: 0, step: 1, unit: 'kW' },
    { key: 'from', label: 'Present power factor', type: 'number', default: 0.75, min: 0.1, max: 1, step: 0.01 },
    { key: 'to', label: 'Target power factor', type: 'number', default: 0.97, min: 0.1, max: 1, step: 0.01 },
    { key: 'volts', label: 'Line voltage', type: 'number', default: 415, min: 1, step: 1, unit: 'V' },
    {
      key: 'hz',
      label: 'Frequency',
      type: 'segmented',
      choices: [
        { value: '50', label: '50 Hz' },
        { value: '60', label: '60 Hz' },
      ],
      default: '50',
    },
    {
      key: 'connection',
      label: 'Capacitor bank',
      type: 'segmented',
      choices: [
        { value: 'delta', label: 'Delta' },
        { value: 'star', label: 'Star' },
        { value: 'single', label: 'Single-phase' },
      ],
      default: 'delta',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    if (o.to <= o.from) throw new ToolError('The target power factor must be higher than the present one.');
    const tan = (pf: number) => Math.tan(Math.acos(pf));
    const kvar = o.kw * (tan(o.from) - tan(o.to));
    const omega = 2 * Math.PI * Number(o.hz);
    const v2 = o.volts * o.volts;
    const microfarads = (o.connection === 'delta' ? (kvar * 1000) / (3 * omega * v2) : (kvar * 1000) / (omega * v2)) * 1e6;
    const kvaBefore = o.kw / o.from;
    const kvaAfter = o.kw / o.to;
    const ampsBefore = (kvaBefore * 1000) / (Math.sqrt(3) * o.volts);
    const ampsAfter = (kvaAfter * 1000) / (Math.sqrt(3) * o.volts);
    const step = STEPS.find((size) => size >= kvar) ?? Math.ceil(kvar / 50) * 50;
    return {
      fields: [
        { label: 'Capacitor bank needed', value: `${num(kvar, 2)} kVAR`, mono: true, tone: 'ok' },
        { label: 'Next standard size', value: `${num(step, 1)} kVAR`, mono: true },
        { label: o.connection === 'single' ? 'Capacitance' : 'Capacitance per phase', value: `${num(microfarads, 1)} µF`, mono: true },
        heading('Effect'),
        { label: 'Apparent power', value: `${num(kvaBefore, 1)} → ${num(kvaAfter, 1)} kVA`, mono: true },
        { label: 'Line current (three-phase)', value: `${num(ampsBefore, 1)} → ${num(ampsAfter, 1)} A (−${num((1 - ampsAfter / ampsBefore) * 100, 1)}%)`, mono: true },
        { label: 'Cable losses', value: `about −${num((1 - (ampsAfter / ampsBefore) ** 2) * 100, 0)}% (they scale with current²)` },
      ],
      info: `${ESTIMATE} Check harmonic content before adding capacitors; use detuned reactors where drives are present.`,
    };
  },
});
