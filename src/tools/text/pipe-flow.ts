import { ToolError } from '../../lib/errors';
import { pipeFlow, ROUGHNESS, water } from '../../lib/fluids';
import { defineTextTool, type Field } from '../types';
import { heading, num } from './_calc';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'flow', label: 'Flow', type: 'number', default: 2, min: 0.0001, step: 0.1, unit: 'l/s' },
    { key: 'diameter', label: 'Inside diameter', type: 'number', default: 40, min: 1, step: 0.5, unit: 'mm' },
    { key: 'length', label: 'Length', type: 'number', default: 50, min: 0, step: 1, unit: 'm' },
    { key: 'fittings', label: 'Minor losses (sum of K)', type: 'number', default: 0, min: 0, step: 0.5 },
    { key: 'material', label: 'Material', type: 'select', choices: Object.entries(ROUGHNESS).map(([value, { label }]) => ({ value, label })), default: 'pvc' },
    {
      key: 'fluid',
      label: 'Fluid',
      type: 'select',
      choices: [
        { value: 'water', label: 'Water' },
        { value: 'custom', label: 'Other (enter properties)' },
      ],
      default: 'water',
    },
    { key: 'temperature', label: 'Water temperature', type: 'number', default: 20, min: 0, max: 100, step: 1, unit: '°C', showIf: (v) => v.fluid === 'water' },
    { key: 'density', label: 'Density', type: 'number', default: 850, min: 0.1, step: 1, unit: 'kg/m³', showIf: (v) => v.fluid === 'custom' },
    { key: 'viscosity', label: 'Dynamic viscosity', type: 'number', default: 10, min: 0.001, step: 0.1, unit: 'mPa·s (cP)', showIf: (v) => v.fluid === 'custom' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    if (o.flow <= 0 || o.diameter <= 0) throw new ToolError('Enter the flow and diameter.');
    const props = o.fluid === 'water' ? water(o.temperature) : { density: o.density, viscosity: o.viscosity / 1000 };
    const d = o.diameter / 1000;
    const result = pipeFlow(o.flow / 1000, d, o.length, props.density, props.viscosity, ROUGHNESS[o.material]?.metres ?? 0.0015e-3, o.fittings);
    const volume = ((Math.PI * d * d) / 4) * o.length;
    const fields: Field[] = [
      { label: 'Velocity', value: `${num(result.velocity, 3)} m/s`, mono: true },
      { label: 'Reynolds number', value: `${num(result.reynolds, 0)} (${result.reynolds < 2300 ? 'laminar' : result.reynolds < 4000 ? 'transitional' : 'turbulent'})`, mono: true },
      { label: 'Friction factor (Darcy)', value: num(result.friction, 5), mono: true },
      heading('Losses'),
      { label: 'Pressure drop', value: `${num(result.pressureDrop / 1000, 3)} kPa = ${num(result.pressureDrop / 1e5, 4)} bar = ${num(result.pressureDrop / 6894.76, 3)} psi`, mono: true, tone: 'ok' },
      { label: 'Head loss', value: `${num(result.headLoss, 3)} m`, mono: true },
      { label: 'Per 100 m', value: `${num(((result.pressureDrop / Math.max(o.length, 1e-9)) * 100) / 1000, 2)} kPa`, mono: true },
      heading('Pipe'),
      { label: 'Volume', value: `${num(volume * 1000, 2)} litres`, mono: true },
      { label: 'Travel time end to end', value: `${num(o.length / result.velocity, 1)} s`, mono: true },
    ];
    return { fields, info: 'Darcy–Weisbach with the Swamee–Jain friction factor (64/Re when laminar).' };
  },
});
