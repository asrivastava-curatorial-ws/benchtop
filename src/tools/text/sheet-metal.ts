import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

/** Tensile strength (MPa) for the press-brake force estimate. */
const MATERIALS: Record<string, { label: string; uts: number; radius: number }> = {
  mild: { label: 'Mild steel (CRCA, GI)', uts: 450, radius: 0.16 },
  stainless: { label: 'Stainless steel 304', uts: 650, radius: 0.21 },
  al5052: { label: 'Aluminium 5052-H32', uts: 230, radius: 0.13 },
  al6061: { label: 'Aluminium 6061-T6', uts: 310, radius: 0.15 },
  copper: { label: 'Copper (half hard)', uts: 250, radius: 0.14 },
};

/** K-factor from the DIN 6935 correction: K = 0.325 + 0.25·log₁₀(R/T), within 0.25–0.5. */
export const dinKFactor = (radius: number, thickness: number): number => Math.min(0.5, Math.max(0.25, 0.325 + 0.25 * Math.log10(radius / thickness)));

export interface Bend {
  readonly allowance: number;
  readonly setback: number;
  readonly deduction: number;
}

/** Bend allowance, outside setback and bend deduction for a bend of `angle` degrees (90 = right angle). */
export function bend(thickness: number, radius: number, angle: number, k: number): Bend {
  const allowance = (Math.PI / 180) * angle * (radius + k * thickness);
  const setback = Math.tan(((angle / 2) * Math.PI) / 180) * (radius + thickness);
  return { allowance, setback, deduction: 2 * setback - allowance };
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'material', label: 'Material', type: 'select', choices: Object.entries(MATERIALS).map(([value, { label }]) => ({ value, label })), default: 'mild' },
    { key: 'thickness', label: 'Thickness T', type: 'number', default: 2, min: 0.1, max: 50, step: 0.1, unit: 'mm' },
    { key: 'radius', label: 'Inside radius R', type: 'number', default: 2, min: 0, max: 500, step: 0.1, unit: 'mm', help: '0 uses the natural radius of an air bend in the chosen die.' },
    { key: 'angle', label: 'Bend angle', type: 'number', default: 90, min: 1, max: 179, step: 1, unit: '°', help: 'How far the flange turns: 90 for a right angle (not the included angle).' },
    { key: 'k', label: 'K-factor', type: 'number', default: 0, min: 0, max: 0.5, step: 0.01, help: '0 picks one from R/T (DIN 6935).' },
    { key: 'flange1', label: 'Flange A (outside)', type: 'number', default: 50, min: 0, step: 1, unit: 'mm' },
    { key: 'flange2', label: 'Flange B (outside)', type: 'number', default: 30, min: 0, step: 1, unit: 'mm' },
    { key: 'vdie', label: 'V-die opening', type: 'number', default: 0, min: 0, max: 400, step: 1, unit: 'mm', help: '0 picks 8 × T (6 × T under 3 mm, 10 × T over 10 mm).' },
    { key: 'length', label: 'Bend length', type: 'number', default: 1000, min: 1, step: 10, unit: 'mm' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const material = MATERIALS[o.material] ?? (MATERIALS.mild as (typeof MATERIALS)[string]);
    const t = o.thickness;
    const vdie = o.vdie > 0 ? o.vdie : t * (t < 3 ? 6 : t > 10 ? 10 : 8);
    const natural = vdie * material.radius;
    const r = o.radius > 0 ? o.radius : natural;
    const k = o.k > 0 ? o.k : dinKFactor(Math.max(r, 0.01), t);
    const result = bend(t, r, o.angle, k);
    const flat = o.flange1 + o.flange2 - result.deduction;
    if (flat <= 0) throw new ToolError('The flanges are too short for this bend.');
    // Air-bending force: F = 1.42 · UTS · L · T² / V (N), the press-brake makers' chart formula.
    const force = (1.42 * material.uts * o.length * t * t) / vdie;
    const minFlange = 0.7 * vdie;
    const fields: Field[] = [
      { label: 'K-factor used', value: `${num(k, 3)}${o.k > 0 ? '' : ' (DIN 6935)'}`, mono: true },
      { label: 'Inside radius used', value: `${num(r, 2)} mm${o.radius > 0 ? '' : ' (natural air-bend radius)'}`, mono: true },
      heading('Bend'),
      { label: 'Bend allowance BA', value: `${num(result.allowance, 3)} mm`, mono: true },
      { label: 'Outside setback OSSB', value: `${num(result.setback, 3)} mm`, mono: true },
      { label: 'Bend deduction BD', value: `${num(result.deduction, 3)} mm`, mono: true },
      { label: 'Flat blank length', value: `${num(flat, 2)} mm`, mono: true, tone: 'ok' },
      heading('Press brake'),
      { label: 'V-die opening', value: `${num(vdie, 0)} mm${o.vdie > 0 ? '' : ' (suggested)'}`, mono: true },
      { label: 'Bending force', value: `${num(force / 1000, 1)} kN = ${num(force / 9806.65, 1)} t`, mono: true, tone: 'ok' },
      { label: 'Shortest flange for this die', value: `${num(minFlange, 1)} mm`, mono: true, tone: Math.min(o.flange1, o.flange2) < minFlange ? 'bad' : undefined },
    ];
    return { fields, info: `${ESTIMATE} Flat length = A + B − BD, with A and B measured to the outside mould lines. Bend a test piece to confirm the K-factor.` };
  },
});
