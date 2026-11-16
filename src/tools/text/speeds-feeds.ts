import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { duration, ESTIMATE, heading, num } from './_calc';

export interface Material {
  readonly label: string;
  /** Starting cutting speed, m/min, for carbide and HSS tools. */
  readonly carbide: number;
  readonly hss: number;
  /** Specific cutting force at 1 mm chip thickness (N/mm²) and its chip-thickness exponent. */
  readonly kc1: number;
  readonly mc: number;
  /** Typical feed per tooth for a 10 mm carbide end mill, mm. */
  readonly fz: readonly [number, number];
  /** Drill feed per revolution as a fraction of the drill diameter. */
  readonly drillFeed: number;
}

/** Starting values in line with tool makers' catalogues; adjust to your tool's data. */
export const MATERIALS: Record<string, Material> = {
  steel: { label: 'Mild steel', carbide: 180, hss: 30, kc1: 1500, mc: 0.25, fz: [0.03, 0.1], drillFeed: 0.018 },
  alloy: { label: 'Alloy or tool steel (annealed)', carbide: 120, hss: 18, kc1: 1900, mc: 0.25, fz: [0.03, 0.08], drillFeed: 0.015 },
  stainless: { label: 'Stainless steel (austenitic)', carbide: 110, hss: 15, kc1: 2000, mc: 0.21, fz: [0.02, 0.07], drillFeed: 0.012 },
  castiron: { label: 'Grey cast iron', carbide: 150, hss: 22, kc1: 1100, mc: 0.28, fz: [0.05, 0.15], drillFeed: 0.022 },
  aluminium: { label: 'Aluminium alloy', carbide: 400, hss: 90, kc1: 700, mc: 0.25, fz: [0.05, 0.2], drillFeed: 0.025 },
  brass: { label: 'Brass, bronze', carbide: 250, hss: 60, kc1: 780, mc: 0.25, fz: [0.05, 0.15], drillFeed: 0.022 },
  titanium: { label: 'Titanium alloy', carbide: 50, hss: 10, kc1: 1400, mc: 0.23, fz: [0.02, 0.08], drillFeed: 0.01 },
};

/** Mean chip thickness for side milling with radial engagement ae on a cutter of diameter d. */
export function meanChipThickness(fz: number, ae: number, d: number): number {
  const ratio = Math.min(1, ae / d);
  const engagement = Math.acos(1 - 2 * ratio); // radians
  return (fz * 2 * ratio) / engagement;
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'operation',
      label: 'Operation',
      type: 'segmented',
      choices: [
        { value: 'mill', label: 'Milling' },
        { value: 'drill', label: 'Drilling' },
        { value: 'turn', label: 'Turning' },
      ],
      default: 'mill',
    },
    { key: 'material', label: 'Workpiece', type: 'select', choices: Object.entries(MATERIALS).map(([value, { label }]) => ({ value, label })), default: 'steel' },
    {
      key: 'tool',
      label: 'Tool',
      type: 'segmented',
      choices: [
        { value: 'carbide', label: 'Carbide' },
        { value: 'hss', label: 'HSS' },
      ],
      default: 'carbide',
    },
    { key: 'diameter', label: 'Diameter', type: 'number', default: 10, min: 0.1, max: 2000, step: 0.5, unit: 'mm', help: 'The cutter or drill; the workpiece when turning.' },
    { key: 'teeth', label: 'Flutes', type: 'number', default: 4, min: 1, max: 40, step: 1, showIf: (v) => v.operation === 'mill' },
    { key: 'vc', label: 'Cutting speed', type: 'number', default: 0, min: 0, max: 3000, step: 5, unit: 'm/min', help: '0 uses a starting value for the workpiece and tool.' },
    { key: 'feed', label: 'Feed', type: 'number', default: 0, min: 0, max: 5, step: 0.005, unit: 'mm', help: 'Per tooth when milling, per revolution when drilling or turning; 0 suggests one.' },
    {
      key: 'ap',
      label: 'Depth of cut',
      type: 'number',
      default: 2,
      min: 0.01,
      max: 100,
      step: 0.1,
      unit: 'mm',
      help: 'Axial depth when milling, radial depth when turning.',
      showIf: (v) => v.operation !== 'drill',
    },
    { key: 'ae', label: 'Width of cut', type: 'number', default: 0, min: 0, max: 2000, step: 0.5, unit: 'mm', help: '0 means a full-width slot.', showIf: (v) => v.operation === 'mill' },
    { key: 'length', label: 'Length of cut (hole depth when drilling)', type: 'number', default: 100, min: 0, step: 5, unit: 'mm' },
    { key: 'efficiency', label: 'Machine efficiency', type: 'number', default: 0.8, min: 0.3, max: 1, step: 0.05 },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const material = MATERIALS[o.material] ?? (MATERIALS.steel as Material);
    const d = o.diameter;
    if (!(d > 0)) throw new ToolError('Enter the diameter.');
    const suggestedVc = (o.tool === 'hss' ? material.hss : material.carbide) * (o.operation === 'drill' ? 0.8 : 1);
    const vc = o.vc > 0 ? o.vc : suggestedVc;
    const rpm = (vc * 1000) / (Math.PI * d);
    const toolFactor = o.tool === 'hss' ? 0.7 : 1;
    let feed = o.feed;
    let feedRate: number;
    let mrr: number; // cm³/min
    let hm: number;
    let power: number; // kW at the cutting edge
    const fields: Field[] = [];
    if (o.operation === 'mill') {
      if (!(feed > 0)) feed = ((material.fz[0] + material.fz[1]) / 2) * Math.min(2, Math.max(0.3, Math.sqrt(d / 10))) * toolFactor;
      const ae = o.ae > 0 ? Math.min(o.ae, d) : d;
      feedRate = rpm * feed * o.teeth;
      hm = meanChipThickness(feed, ae, d);
      const kc = material.kc1 * hm ** -material.mc;
      mrr = (o.ap * ae * feedRate) / 1000;
      power = (o.ap * ae * feedRate * kc) / 60e6;
      fields.push({ label: 'Feed per tooth', value: `${num(feed, 3)} mm${o.feed > 0 ? '' : ' (suggested)'}`, mono: true });
    } else if (o.operation === 'drill') {
      if (!(feed > 0)) feed = material.drillFeed * d * toolFactor;
      feedRate = rpm * feed;
      hm = (feed / 2) * Math.sin((59 * Math.PI) / 180);
      const kc = material.kc1 * hm ** -material.mc;
      mrr = (vc * d * feed) / 4;
      power = (feed * vc * d * kc) / 240e3;
      fields.push({ label: 'Feed per revolution', value: `${num(feed, 3)} mm${o.feed > 0 ? '' : ' (suggested)'}`, mono: true });
    } else {
      if (!(feed > 0)) feed = 0.2;
      feedRate = rpm * feed;
      hm = feed;
      const kc = material.kc1 * hm ** -material.mc;
      mrr = vc * o.ap * feed;
      power = (vc * o.ap * feed * kc) / 60e3;
      fields.push({ label: 'Feed per revolution', value: `${num(feed, 3)} mm${o.feed > 0 ? '' : ' (roughing default)'}`, mono: true });
    }
    const spindle = power / o.efficiency;
    const torque = (power * 30000) / (Math.PI * rpm);
    fields.unshift(
      { label: 'Cutting speed', value: `${num(vc, 0)} m/min = ${num(vc * 3.28084, 0)} SFM${o.vc > 0 ? '' : ' (starting value)'}`, mono: true },
      { label: 'Spindle speed', value: `${num(rpm, 0)} rpm`, mono: true, tone: 'ok' },
    );
    fields.push(
      { label: 'Feed rate', value: `${num(feedRate, 0)} mm/min = ${num(feedRate / 25.4, 1)} in/min`, mono: true, tone: 'ok' },
      { label: 'Mean chip thickness', value: `${num(hm, 3)} mm`, mono: true },
      heading('Load'),
      { label: 'Metal removal rate', value: `${num(mrr, 1)} cm³/min`, mono: true },
      { label: 'Cutting power', value: `${num(power, 2)} kW`, mono: true },
      { label: 'Spindle power needed', value: `${num(spindle, 2)} kW (${num(spindle / 0.7457, 1)} hp)`, mono: true, tone: 'ok' },
      { label: 'Spindle torque', value: `${num(torque, 1)} N·m`, mono: true },
      heading('Machining time'),
      { label: 'Time for the cut', value: o.length > 0 ? duration(o.length / feedRate) : '—', mono: true, tone: 'ok' },
    );
    const range = o.operation === 'mill' ? ` Typical feed per tooth for a 10 mm carbide cutter in this material: ${material.fz[0]}–${material.fz[1]} mm.` : '';
    return { fields, info: `${ESTIMATE} Power uses kc = kc1 · hm^−mc; time excludes approach and retract.${range}` };
  },
});
