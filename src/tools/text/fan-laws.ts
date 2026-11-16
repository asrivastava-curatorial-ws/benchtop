import { ToolError } from '../../lib/errors';
import { pressureAtAltitude } from '../../lib/psychro';
import { defineTextTool, type Field } from '../types';
import { heading, num } from './_calc';

export interface Affinity {
  readonly flow: number;
  readonly pressure: number;
  readonly power: number;
}

/** Fan (and pump) affinity laws: Q ∝ N·D³, p ∝ ρ·N²·D², P ∝ ρ·N³·D⁵. */
export function affinity(base: Affinity, speedRatio: number, diameterRatio: number, densityRatio: number): Affinity {
  return {
    flow: base.flow * speedRatio * diameterRatio ** 3,
    pressure: base.pressure * densityRatio * speedRatio ** 2 * diameterRatio ** 2,
    power: base.power * densityRatio * speedRatio ** 3 * diameterRatio ** 5,
  };
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'change',
      label: 'Change',
      type: 'segmented',
      choices: [
        { value: 'speed', label: 'Speed' },
        { value: 'diameter', label: 'Diameter' },
        { value: 'density', label: 'Air density' },
      ],
      default: 'speed',
      help: 'Diameter means the impeller; air density changes with temperature and altitude.',
    },
    { key: 'flow', label: 'Flow now', type: 'number', default: 10000, min: 0, step: 100, help: 'Any unit: the result uses the same one.' },
    { key: 'pressure', label: 'Pressure now', type: 'number', default: 500, min: 0, step: 10, unit: 'Pa' },
    { key: 'power', label: 'Shaft power now', type: 'number', default: 5.5, min: 0, step: 0.1, unit: 'kW' },
    { key: 'speed1', label: 'Speed now', type: 'number', default: 1450, min: 1, step: 10, unit: 'rpm', showIf: (v) => v.change === 'speed' },
    { key: 'speed2', label: 'New speed', type: 'number', default: 1160, min: 1, step: 10, unit: 'rpm', showIf: (v) => v.change === 'speed' },
    { key: 'd1', label: 'Diameter now', type: 'number', default: 500, min: 1, step: 5, unit: 'mm', showIf: (v) => v.change === 'diameter' },
    { key: 'd2', label: 'New diameter', type: 'number', default: 475, min: 1, step: 5, unit: 'mm', showIf: (v) => v.change === 'diameter' },
    { key: 't1', label: 'Air temperature now', type: 'number', default: 20, min: -50, max: 400, step: 1, unit: '°C', showIf: (v) => v.change === 'density' },
    { key: 't2', label: 'New air temperature', type: 'number', default: 40, min: -50, max: 400, step: 1, unit: '°C', showIf: (v) => v.change === 'density' },
    { key: 'alt1', label: 'Altitude now', type: 'number', default: 0, min: 0, max: 6000, step: 50, unit: 'm', showIf: (v) => v.change === 'density' },
    { key: 'alt2', label: 'New altitude', type: 'number', default: 0, min: 0, max: 6000, step: 50, unit: 'm', showIf: (v) => v.change === 'density' },
    { key: 'hours', label: 'Running hours per year', type: 'number', default: 6000, min: 0, max: 8760, step: 100, showIf: (v) => v.change === 'speed' },
    { key: 'tariff', label: 'Energy charge', type: 'number', default: 8.5, min: 0, step: 0.1, help: 'Per kWh.', showIf: (v) => v.change === 'speed' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    let speedRatio = 1;
    let diameterRatio = 1;
    let densityRatio = 1;
    if (o.change === 'speed') speedRatio = o.speed2 / o.speed1;
    else if (o.change === 'diameter') diameterRatio = o.d2 / o.d1;
    else densityRatio = (pressureAtAltitude(o.alt2) / pressureAtAltitude(o.alt1)) * ((o.t1 + 273.15) / (o.t2 + 273.15));
    if (!Number.isFinite(speedRatio * diameterRatio * densityRatio)) throw new ToolError('Check the values: a ratio could not be formed.');
    const next = affinity({ flow: o.flow, pressure: o.pressure, power: o.power }, speedRatio, diameterRatio, densityRatio);
    const change = (from: number, to: number) => (from > 0 ? ` (${to >= from ? '+' : '−'}${num(Math.abs((to / from - 1) * 100), 1)}%)` : '');
    const fields: Field[] = [
      { label: 'New flow', value: `${num(next.flow, 0)}${change(o.flow, next.flow)}`, mono: true, tone: 'ok' },
      { label: 'New pressure', value: `${num(next.pressure, 0)} Pa${change(o.pressure, next.pressure)}`, mono: true, tone: 'ok' },
      { label: 'New shaft power', value: `${num(next.power, 2)} kW${change(o.power, next.power)}`, mono: true, tone: 'ok' },
    ];
    if (o.change === 'density')
      fields.splice(0, 1, {
        label: 'New flow',
        value: `${num(next.flow, 0)}: the same volume, with mass flow ${densityRatio >= 1 ? '+' : '−'}${num(Math.abs(densityRatio - 1) * 100, 1)}%`,
        mono: true,
        tone: 'ok',
      });
    if (o.change === 'speed' && o.power > 0) {
      const saved = (o.power - next.power) * o.hours;
      fields.push(heading('Energy'), {
        label: saved >= 0 ? 'Saved per year' : 'Extra per year',
        value: `${num(Math.abs(saved), 0)} kWh = ${num(Math.abs(saved) * o.tariff, 0)}`,
        mono: true,
        tone: saved >= 0 ? 'ok' : 'warn',
      });
    }
    return {
      fields,
      info: 'The affinity laws hold for the same fan on a system without fixed static pressure; with a fixed lift or static (pumps, filters with set points), savings are smaller. A variable-speed drive adds 2–4% losses.',
    };
  },
});
