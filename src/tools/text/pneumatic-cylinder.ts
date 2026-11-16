import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

/** ISO 15552 bores with their usual rod diameters (mm). */
export const ISO_BORES: readonly (readonly [number, number])[] = [
  [32, 12],
  [40, 16],
  [50, 20],
  [63, 20],
  [80, 25],
  [100, 25],
  [125, 32],
  [160, 40],
  [200, 40],
  [250, 50],
  [320, 63],
];

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'mode',
      label: 'Start from',
      type: 'segmented',
      choices: [
        { value: 'bore', label: 'A bore' },
        { value: 'force', label: 'The force needed' },
      ],
      default: 'force',
    },
    { key: 'bore', label: 'Bore', type: 'number', default: 50, min: 2, max: 500, step: 1, unit: 'mm', showIf: (v) => v.mode === 'bore' },
    { key: 'rod', label: 'Rod', type: 'number', default: 20, min: 1, max: 200, step: 1, unit: 'mm', showIf: (v) => v.mode === 'bore' },
    { key: 'force', label: 'Force needed', type: 'number', default: 800, min: 1, step: 10, unit: 'N', showIf: (v) => v.mode === 'force' },
    {
      key: 'loadFactor',
      label: 'Load factor',
      type: 'number',
      default: 0.7,
      min: 0.3,
      max: 1,
      step: 0.05,
      help: '0.7 for moving loads, up to 0.85 for slow clamping: leaves pressure to accelerate the load and overcome friction.',
      showIf: (v) => v.mode === 'force',
    },
    { key: 'pressure', label: 'Supply pressure', type: 'number', default: 6, min: 0.5, max: 16, step: 0.5, unit: 'bar g' },
    { key: 'stroke', label: 'Stroke', type: 'number', default: 200, min: 1, step: 10, unit: 'mm' },
    { key: 'cycles', label: 'Cycles per minute', type: 'number', default: 10, min: 0, step: 1 },
    {
      key: 'action',
      label: 'Cylinder',
      type: 'segmented',
      choices: [
        { value: 'double', label: 'Double-acting' },
        { value: 'single', label: 'Single-acting' },
      ],
      default: 'double',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const pa = o.pressure * 1e5;
    const area = (d: number) => (Math.PI * (d / 1000) ** 2) / 4;
    let bore = o.bore;
    let rod = o.rod;
    const fields: Field[] = [];
    if (o.mode === 'force') {
      const minimum = Math.sqrt((4 * o.force) / (Math.PI * pa * o.loadFactor)) * 1000;
      const chosen = ISO_BORES.find(([size]) => size >= minimum) ?? (ISO_BORES[ISO_BORES.length - 1] as readonly [number, number]);
      [bore, rod] = chosen;
      fields.push({ label: 'Minimum bore', value: `${num(minimum, 1)} mm`, mono: true }, { label: 'Standard bore (ISO 15552)', value: `Ø${bore} mm with Ø${rod} mm rod`, mono: true, tone: 'ok' });
    }
    const push = pa * area(bore);
    const pull = pa * (area(bore) - area(rod));
    const absolute = (o.pressure + 1.01325) / 1.01325;
    const perStroke = area(bore) * (o.stroke / 1000) * absolute + (o.action === 'double' ? (area(bore) - area(rod)) * (o.stroke / 1000) * absolute : 0);
    const freeAirPerMin = perStroke * o.cycles * 1000;
    fields.push(
      heading('Theoretical force'),
      { label: 'Extend', value: `${num(push, 0)} N = ${num(push / 9.80665, 1)} kgf`, mono: true },
      { label: 'Retract', value: o.action === 'double' ? `${num(pull, 0)} N = ${num(pull / 9.80665, 1)} kgf` : 'Spring return', mono: true },
      heading('Air'),
      { label: 'Free air per cycle', value: `${num(perStroke * 1000, 3)} l`, mono: true },
      { label: 'Consumption', value: `${num(freeAirPerMin, 1)} l/min = ${num(freeAirPerMin / 28.317, 2)} CFM (free air)`, mono: true, tone: 'ok' },
    );
    return { fields, info: `${ESTIMATE} Add 10–20% for tubing volume and leaks.` };
  },
});
