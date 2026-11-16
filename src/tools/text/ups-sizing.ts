import { UPS_SIZES } from '../../lib/electrical';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

const CHEMISTRY: Record<string, { label: string; usable: number; peukert: number; cellVolts: number }> = {
  vrla: { label: 'Lead-acid (VRLA)', usable: 0.8, peukert: 1.15, cellVolts: 2 },
  lfp: { label: 'Lithium iron phosphate', usable: 0.9, peukert: 1.03, cellVolts: 3.2 },
};

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'load', label: 'Load', type: 'number', default: 6, min: 0.01, step: 0.1, unit: 'kW' },
    { key: 'pf', label: 'UPS output power factor', type: 'number', default: 0.9, min: 0.6, max: 1, step: 0.05 },
    { key: 'growth', label: 'Growth allowance', type: 'number', default: 20, min: 0, max: 200, step: 5, unit: '%' },
    { key: 'loading', label: 'Maximum loading', type: 'number', default: 80, min: 40, max: 100, step: 5, unit: '%' },
    {
      key: 'mode',
      label: 'Battery',
      type: 'segmented',
      choices: [
        { value: 'runtime', label: 'How long will mine last?' },
        { value: 'size', label: 'What do I need?' },
      ],
      default: 'runtime',
    },
    { key: 'chemistry', label: 'Chemistry', type: 'select', choices: Object.entries(CHEMISTRY).map(([value, { label }]) => ({ value, label })), default: 'vrla' },
    { key: 'busVolts', label: 'Battery bus voltage', type: 'number', default: 192, min: 12, max: 1000, step: 12, unit: 'V DC' },
    { key: 'ah', label: 'Battery capacity', type: 'number', default: 42, min: 1, step: 1, unit: 'Ah', showIf: (v) => v.mode === 'runtime' },
    { key: 'strings', label: 'Parallel strings', type: 'number', default: 1, min: 1, max: 20, step: 1, showIf: (v) => v.mode === 'runtime' },
    { key: 'minutes', label: 'Backup wanted', type: 'number', default: 30, min: 1, max: 1440, step: 5, unit: 'min', showIf: (v) => v.mode === 'size' },
    { key: 'efficiency', label: 'Inverter efficiency', type: 'number', default: 0.92, min: 0.7, max: 0.99, step: 0.01 },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const chemistry = CHEMISTRY[o.chemistry] ?? (CHEMISTRY.vrla as (typeof CHEMISTRY)[string]);
    if (o.load <= 0) throw new ToolError('Enter the load.');
    const needKva = ((o.load / o.pf) * (1 + o.growth / 100)) / (o.loading / 100);
    const frame = UPS_SIZES.find((size) => size >= needKva);
    const batteryWatts = (o.load * 1000) / o.efficiency;
    const current = batteryWatts / o.busVolts;
    const blocks = Math.round(o.busVolts / 12);
    const fields: Field[] = [
      heading('UPS'),
      { label: 'Rating needed', value: `${num(needKva, 2)} kVA`, mono: true },
      { label: 'Standard size', value: frame ? `${frame} kVA` : 'Use parallel UPS modules', mono: true, tone: 'ok' },
      { label: 'Load on it', value: frame ? `${num((o.load / o.pf / frame) * 100, 0)}% today` : '—' },
      heading('Battery'),
      { label: 'Discharge current', value: `${num(current, 1)} A from the ${o.busVolts} V bus`, mono: true },
    ];
    if (o.mode === 'runtime') {
      const capacityAh = o.ah * o.strings;
      // Peukert-adjusted run time relative to the 20-hour rating, limited to the usable depth of discharge.
      const hours = 20 * ((capacityAh * chemistry.usable) / (current * 20)) ** chemistry.peukert;
      fields.push(
        { label: 'Estimated runtime', value: `${num(hours * 60, 0)} minutes`, mono: true, tone: hours * 60 < 10 ? 'warn' : 'ok' },
        { label: 'Battery energy', value: `${num((capacityAh * o.busVolts) / 1000, 2)} kWh nominal`, mono: true },
      );
    } else {
      const hours = o.minutes / 60;
      // Invert the Peukert relation to find the 20-hour capacity that delivers `hours` at this current.
      const capacityAh = (current * 20 * (hours / 20) ** (1 / chemistry.peukert)) / chemistry.usable;
      fields.push(
        { label: 'Battery capacity needed', value: `${num(capacityAh, 0)} Ah at ${o.busVolts} V`, mono: true, tone: 'ok' },
        { label: 'Energy', value: `${num((capacityAh * o.busVolts) / 1000, 2)} kWh nominal`, mono: true },
      );
    }
    if (o.chemistry === 'vrla') fields.push({ label: 'Bank layout', value: `${blocks} × 12 V blocks in series per string`, mono: true });
    else fields.push({ label: 'Bank layout', value: `${Math.round(o.busVolts / chemistry.cellVolts)} LFP cells in series per string`, mono: true });
    fields.push({ label: 'Note', value: 'Battery makers publish constant-power discharge tables (W per cell for 5 to 60 minutes); use them for the final selection.', tone: 'muted' });
    return { fields, info: ESTIMATE };
  },
});
