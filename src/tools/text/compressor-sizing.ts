import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

/** Typical specific power at 7 bar(g), kW per m³/min of free air delivered. */
const TYPES: Record<string, { label: string; specific: number }> = {
  screw: { label: 'Oil-injected screw', specific: 6.5 },
  vsd: { label: 'Variable-speed screw', specific: 6.0 },
  piston: { label: 'Reciprocating (piston)', specific: 7.5 },
  oilfree: { label: 'Oil-free screw', specific: 7.0 },
};

export default defineTextTool({
  input: {
    label: 'Air users',
    placeholder: 'One per line: name, l/min of free air, duty % (share of time in use)',
    sample: 'Pneumatic cylinders line A, 450, 60\nBlow-off nozzles, 300, 25\nPaint gun, 250, 40\nTool station, 600, 30',
  },
  output: false,
  options: [
    { key: 'type', label: 'Compressor type', type: 'select', choices: Object.entries(TYPES).map(([value, { label }]) => ({ value, label })), default: 'screw' },
    { key: 'pressure', label: 'Working pressure', type: 'number', default: 7, min: 1, max: 15, step: 0.5, unit: 'bar g' },
    { key: 'leakage', label: 'Leakage allowance', type: 'number', default: 15, min: 0, max: 50, step: 5, unit: '%' },
    { key: 'growth', label: 'Future growth', type: 'number', default: 20, min: 0, max: 200, step: 5, unit: '%' },
    { key: 'band', label: 'Pressure band (load/unload)', type: 'number', default: 1, min: 0.2, max: 3, step: 0.1, unit: 'bar' },
    {
      key: 'cyclesPerHour',
      label: 'Most load cycles per hour',
      type: 'number',
      default: 120,
      min: 10,
      max: 240,
      step: 10,
      help: '120 is one load/unload cycle every 30 seconds, a common limit for screw compressors.',
    },
    { key: 'hours', label: 'Running hours per year', type: 'number', default: 4000, min: 0, max: 8760, step: 100 },
    { key: 'tariff', label: 'Energy charge', type: 'number', default: 8.5, min: 0, step: 0.1, help: 'Per kWh.' },
  ],
  runOnEmpty: true,
  run(input, o) {
    const users = input
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line, index) => {
        const [name = '', lpm = '', duty = '100'] = line.split(',').map((part) => part.trim());
        const flow = Number(lpm);
        if (!(flow >= 0)) throw new ToolError(`Line ${index + 1}: the second value must be litres per minute.`, { line: index + 1 });
        return { name, average: flow * ((Number(duty) || 100) / 100), peak: flow };
      });
    const peak = users.reduce((sum, user) => sum + user.peak, 0);
    const average = users.reduce((sum, user) => sum + user.average, 0);
    const design = average * (1 + o.leakage / 100) * (1 + o.growth / 100);
    const m3min = design / 1000;
    const type = TYPES[o.type] ?? (TYPES.screw as (typeof TYPES)[string]);
    // Specific power rises about 7% per bar above 7 bar(g).
    const specific = type.specific * (1 + 0.07 * (o.pressure - 7));
    const kw = m3min * specific;
    // Receiver for load/unload control: V = 0.25·qc·p1 / (fmax·Δp), qc free air, p1 inlet pressure, fmax cycles per unit time.
    const receiver = (m3min * 1.01325 * 60) / (4 * o.cyclesPerHour * o.band);
    const fields: Field[] = [
      heading('Demand'),
      { label: 'Average demand', value: `${num(average, 0)} l/min`, mono: true },
      { label: 'Every user at once', value: `${num(peak, 0)} l/min: the receiver covers short peaks above the average`, mono: true },
      { label: 'Design capacity (free air)', value: `${num(m3min, 2)} m³/min = ${num(design / 28.317, 1)} CFM`, mono: true, tone: 'ok' },
      heading('Compressor'),
      { label: 'Input power', value: `about ${num(kw, 1)} kW (${num(kw / 0.7457, 0)} hp)`, mono: true, tone: 'ok' },
      { label: 'Energy cost', value: `${num(kw * o.hours * o.tariff, 0)} a year`, mono: true },
      { label: 'Heat recoverable', value: `up to ${num(kw * 0.9, 1)} kW of warm air or water`, mono: true },
      heading('Air receiver'),
      { label: 'Receiver volume', value: `at least ${num(receiver * 1000, 0)} litres (${num(receiver, 2)} m³)`, mono: true, tone: 'ok' },
      { label: 'Rule of thumb check', value: `${num(((m3min * 1000) / 60) * 6, 0)}–${num(((m3min * 1000) / 60) * 10, 0)} litres (6–10 l per l/s of capacity)`, mono: true },
    ];
    return { fields, info: ESTIMATE };
  },
});
