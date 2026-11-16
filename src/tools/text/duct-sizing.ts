import { ToolError } from '../../lib/errors';
import { frictionFactor } from '../../lib/fluids';
import { defineTextTool, type Field } from '../types';
import { heading, num } from './_calc';

const MATERIALS: Record<string, { label: string; roughness: number }> = {
  galvanised: { label: 'Galvanised steel', roughness: 0.09e-3 },
  smooth: { label: 'PVC, aluminium, stainless', roughness: 0.03e-3 },
  board: { label: 'Fibreglass duct board', roughness: 0.9e-3 },
  flexible: { label: 'Flexible duct, fully stretched', roughness: 3e-3 },
};

const FLOW_UNITS: Record<string, { label: string; m3s: number }> = {
  cfm: { label: 'CFM', m3s: 0.000471947 },
  m3h: { label: 'm³/h', m3s: 1 / 3600 },
  ls: { label: 'l/s', m3s: 0.001 },
};

/** Standard round duct sizes (EN 1506), mm. */
export const ROUND_SIZES = [80, 100, 125, 150, 160, 200, 250, 300, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000, 1120, 1250, 1400, 1600];

/** Huebscher's equivalent diameter of a rectangular duct for equal friction. */
export const equivalentDiameter = (a: number, b: number): number => (1.3 * (a * b) ** 0.625) / (a + b) ** 0.25;

export interface DuctFlow {
  readonly velocity: number;
  /** Pressure gradient, Pa/m. */
  readonly gradient: number;
  readonly velocityPressure: number;
}

export function ductFlow(flow: number, diameter: number, roughness: number, density: number, viscosity: number, area = (Math.PI * diameter * diameter) / 4): DuctFlow {
  const velocity = flow / area;
  const reynolds = (density * velocity * diameter) / viscosity;
  const velocityPressure = (density * velocity * velocity) / 2;
  return { velocity, gradient: (frictionFactor(reynolds, roughness, diameter) / diameter) * velocityPressure, velocityPressure };
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'flow', label: 'Airflow', type: 'number', default: 1000, min: 1, step: 10 },
    { key: 'unit', label: 'Airflow unit', type: 'segmented', choices: Object.entries(FLOW_UNITS).map(([value, { label }]) => ({ value, label })), default: 'cfm' },
    {
      key: 'method',
      label: 'Size by',
      type: 'segmented',
      choices: [
        { value: 'friction', label: 'Friction rate' },
        { value: 'velocity', label: 'Velocity' },
      ],
      default: 'friction',
    },
    {
      key: 'friction',
      label: 'Friction rate',
      type: 'number',
      default: 0.8,
      min: 0.1,
      max: 10,
      step: 0.1,
      unit: 'Pa/m',
      help: '0.8 Pa/m is about 0.1 in. w.g. per 100 ft, the usual low-velocity design rate.',
      showIf: (v) => v.method === 'friction',
    },
    {
      key: 'velocity',
      label: 'Velocity',
      type: 'number',
      default: 6,
      min: 0.5,
      max: 30,
      step: 0.5,
      unit: 'm/s',
      help: 'About 5–8 m/s for main ducts and 3–5 m/s for branches in quiet spaces.',
      showIf: (v) => v.method === 'velocity',
    },
    { key: 'material', label: 'Duct material', type: 'select', choices: Object.entries(MATERIALS).map(([value, { label }]) => ({ value, label })), default: 'galvanised' },
    { key: 'temperature', label: 'Air temperature', type: 'number', default: 20, min: -40, max: 200, step: 1, unit: '°C' },
    { key: 'length', label: 'Duct length', type: 'number', default: 0, min: 0, step: 1, unit: 'm', help: 'Optional: gives the friction loss of the run.' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const flow = o.flow * (FLOW_UNITS[o.unit]?.m3s ?? 1 / 3600);
    if (!(flow > 0)) throw new ToolError('Enter the airflow.');
    const material = MATERIALS[o.material] ?? (MATERIALS.galvanised as (typeof MATERIALS)[string]);
    const kelvin = o.temperature + 273.15;
    const density = 101325 / (287.05 * kelvin);
    const viscosity = (1.458e-6 * kelvin ** 1.5) / (kelvin + 110.4);
    const at = (d: number) => ductFlow(flow, d, material.roughness, density, viscosity);
    let diameter: number;
    if (o.method === 'velocity') diameter = Math.sqrt((4 * flow) / (Math.PI * o.velocity));
    else {
      let low = 0.01;
      let high = 5;
      for (let i = 0; i < 80; i++) {
        const mid = Math.sqrt(low * high);
        if (at(mid).gradient > o.friction) low = mid;
        else high = mid;
      }
      diameter = high;
    }
    const exact = at(diameter);
    const standard = ROUND_SIZES.find((size) => size >= diameter * 1000 - 0.5);
    const fields: Field[] = [
      { label: 'Round duct', value: `Ø${num(diameter * 1000, 0)} mm (${num((diameter * 1000) / 25.4, 1)} in)`, mono: true },
      { label: 'Velocity', value: `${num(exact.velocity, 2)} m/s = ${num(exact.velocity * 196.85, 0)} fpm`, mono: true },
      { label: 'Friction', value: `${num(exact.gradient, 2)} Pa/m = ${num(exact.gradient / 8.1721, 3)} in. w.g./100 ft`, mono: true },
      { label: 'Velocity pressure', value: `${num(exact.velocityPressure, 1)} Pa`, mono: true },
    ];
    if (standard) {
      const s = at(standard / 1000);
      fields.push({
        label: 'Standard size',
        value: `Ø${standard} mm: ${num(s.velocity, 2)} m/s, ${num(s.gradient, 2)} Pa/m${o.length > 0 ? `, ${num(s.gradient * o.length, 0)} Pa over ${o.length} m` : ''}`,
        mono: true,
        tone: 'ok',
      });
    }
    fields.push(heading('Rectangular equivalents (equal friction, rounded up to 50 mm)'));
    for (const ratio of [1, 1.5, 2, 3, 4]) {
      // De = 1.30·r^0.625·b / (r + 1)^0.25 for a = r·b.
      const b = (diameter * (ratio + 1) ** 0.25) / (1.3 * ratio ** 0.625);
      const bRounded = Math.ceil((b * 1000) / 50) * 50;
      const aRounded = Math.ceil((ratio * b * 1000) / 50) * 50;
      const de = equivalentDiameter(aRounded, bRounded) / 1000;
      const area = (aRounded * bRounded) / 1e6;
      const r = ductFlow(flow, de, material.roughness, density, viscosity, (Math.PI * de * de) / 4);
      fields.push({ label: `${ratio}:1`, value: `${aRounded} × ${bRounded} mm: ${num(flow / area, 2)} m/s, ${num(r.gradient, 2)} Pa/m`, mono: true, tone: ratio > 3 ? 'warn' : undefined });
    }
    return { fields, info: 'Darcy–Weisbach with the Swamee–Jain friction factor; Huebscher equivalent diameters. Keep aspect ratios at 4:1 or less to limit friction and material.' };
  },
});
