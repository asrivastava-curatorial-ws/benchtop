import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { heading, num, TR } from './_calc';

/** Fluid density (kg/m³) and specific heat (kJ/kg·K) near chilled-water temperatures. */
const FLUIDS: Record<string, { label: string; density: number; cp: number }> = {
  water: { label: 'Water', density: 999.7, cp: 4.192 },
  eg30: { label: '30% ethylene glycol', density: 1045, cp: 3.67 },
  pg30: { label: '30% propylene glycol', density: 1030, cp: 3.85 },
};

const FLOW_UNITS: Record<string, { label: string; m3h: number }> = {
  m3h: { label: 'm³/h', m3h: 1 },
  ls: { label: 'l/s', m3h: 3.6 },
  gpm: { label: 'US gpm', m3h: 0.227125 },
};

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'mode',
      label: 'Find',
      type: 'segmented',
      choices: [
        { value: 'capacity', label: 'Capacity from flow' },
        { value: 'flow', label: 'Flow from capacity' },
      ],
      default: 'capacity',
    },
    { key: 'flow', label: 'Chilled-water flow', type: 'number', default: 60, min: 0.01, step: 1, showIf: (v) => v.mode === 'capacity' },
    { key: 'capacity', label: 'Cooling capacity', type: 'number', default: 100, min: 0.1, step: 5, unit: 'TR', showIf: (v) => v.mode === 'flow' },
    { key: 'unit', label: 'Flow unit', type: 'segmented', choices: Object.entries(FLOW_UNITS).map(([value, { label }]) => ({ value, label })), default: 'm3h' },
    { key: 'supply', label: 'Supply temperature', type: 'number', default: 7, min: -20, max: 25, step: 0.5, unit: '°C' },
    { key: 'return', label: 'Return temperature', type: 'number', default: 12, min: -15, max: 30, step: 0.5, unit: '°C' },
    { key: 'fluid', label: 'Fluid', type: 'select', choices: Object.entries(FLUIDS).map(([value, { label }]) => ({ value, label })), default: 'water' },
    { key: 'power', label: 'Chiller input power', type: 'number', default: 0, min: 0, step: 1, unit: 'kW', help: 'Optional: gives the efficiency and condenser duty; 0 assumes COP 5.' },
    { key: 'condenserDt', label: 'Condenser water range', type: 'number', default: 5, min: 1, max: 15, step: 0.5, unit: 'K', help: '5 K is the usual 32 → 37 °C cooling-tower range.' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const dt = o.return - o.supply;
    if (!(dt > 0)) throw new ToolError('The return temperature must be above the supply temperature.');
    const fluid = FLUIDS[o.fluid] ?? (FLUIDS.water as (typeof FLUIDS)[string]);
    const unit = FLOW_UNITS[o.unit] ?? (FLOW_UNITS.m3h as (typeof FLOW_UNITS)[string]);
    const perM3h = (fluid.density * fluid.cp) / 3600; // kW per (m³/h · K)
    let kw: number;
    let m3h: number;
    if (o.mode === 'capacity') {
      m3h = o.flow * unit.m3h;
      kw = m3h * perM3h * dt;
    } else {
      kw = o.capacity * (TR / 1000);
      m3h = kw / (perM3h * dt);
    }
    const tons = kw / (TR / 1000);
    const input = o.power > 0 ? o.power : kw / 5;
    const rejection = kw + input;
    const condenser = rejection / ((999 * 4.18) / 3600) / o.condenserDt;
    const fields: Field[] = [
      { label: 'Cooling capacity', value: `${num(kw, 1)} kW = ${num(tons, 1)} TR`, mono: true, tone: o.mode === 'capacity' ? 'ok' : undefined },
      { label: 'Chilled-water flow', value: `${num(m3h, 2)} m³/h = ${num(m3h / 3.6, 2)} l/s = ${num(m3h / 0.227125, 1)} US gpm`, mono: true, tone: o.mode === 'flow' ? 'ok' : undefined },
      { label: 'Flow per TR', value: `${num(m3h / tons, 3)} m³/h (${num(m3h / 0.227125 / tons, 2)} gpm)`, mono: true },
      { label: 'Temperature difference', value: `${num(dt, 1)} K (${num(dt * 1.8, 1)} °F)`, mono: true },
      heading('Efficiency and condenser'),
    ];
    if (o.power > 0) {
      fields.push(
        { label: 'kW per TR', value: num(o.power / tons, 3), mono: true, tone: o.power / tons <= 0.7 ? 'ok' : o.power / tons <= 1 ? undefined : 'warn' },
        { label: 'COP / EER', value: `${num(kw / o.power, 2)} / ${num((kw / o.power) * 3.412, 1)} BTU/Wh`, mono: true },
      );
    }
    fields.push(
      { label: 'Heat rejected', value: `${num(rejection, 1)} kW${o.power > 0 ? '' : ' (assuming COP 5)'}`, mono: true },
      { label: 'Condenser water flow', value: `${num(condenser, 1)} m³/h = ${num(condenser / 0.227125, 0)} US gpm`, mono: true, tone: 'ok' },
    );
    return { fields, info: 'Q = ρ · cp · flow · ΔT. Glycol lowers capacity for the same flow and raises pumping power; check the maker’s correction factors.' };
  },
});
