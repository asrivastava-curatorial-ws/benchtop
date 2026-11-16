import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

const TYPES: Record<string, { label: string; dod: number; peukert: number; chargeFactor: number; nominal: number }> = {
  flooded: { label: 'Lead-acid, flooded', dod: 0.5, peukert: 1.25, chargeFactor: 1.2, nominal: 2 },
  vrla: { label: 'Lead-acid, AGM/VRLA', dod: 0.5, peukert: 1.15, chargeFactor: 1.15, nominal: 2 },
  gel: { label: 'Lead-acid, gel', dod: 0.6, peukert: 1.12, chargeFactor: 1.15, nominal: 2 },
  lfp: { label: 'Lithium iron phosphate (LFP)', dod: 0.9, peukert: 1.03, chargeFactor: 1.05, nominal: 3.2 },
  nmc: { label: 'Lithium NMC', dod: 0.85, peukert: 1.05, chargeFactor: 1.05, nominal: 3.6 },
};

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'type', label: 'Battery type', type: 'select', choices: Object.entries(TYPES).map(([value, { label }]) => ({ value, label })), default: 'lfp' },
    { key: 'volts', label: 'Battery voltage', type: 'number', default: 12.8, min: 1, step: 0.1, unit: 'V' },
    { key: 'ah', label: 'Capacity (20-hour rate)', type: 'number', default: 100, min: 0.1, step: 1, unit: 'Ah' },
    { key: 'series', label: 'In series', type: 'number', default: 1, min: 1, max: 100, step: 1 },
    { key: 'parallel', label: 'In parallel', type: 'number', default: 1, min: 1, max: 100, step: 1 },
    { key: 'load', label: 'Load', type: 'number', default: 300, min: 0, step: 1, unit: 'W' },
    { key: 'inverter', label: 'Through an inverter', type: 'toggle', default: true },
    { key: 'dod', label: 'Usable depth of discharge', type: 'number', default: 0, min: 0, max: 100, step: 5, unit: '%', help: '0 uses a sensible value for the chemistry.' },
    { key: 'charger', label: 'Charging current', type: 'number', default: 20, min: 0.1, step: 0.5, unit: 'A' },
    { key: 'soc', label: 'Charge from', type: 'number', default: 20, min: 0, max: 100, step: 5, unit: '%' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const type = TYPES[o.type] ?? (TYPES.lfp as (typeof TYPES)[string]);
    if (o.volts <= 0 || o.ah <= 0) throw new ToolError('Enter the battery voltage and capacity.');
    const bankVolts = o.volts * o.series;
    const bankAh = o.ah * o.parallel;
    const wh = bankVolts * bankAh;
    const dod = o.dod > 0 ? o.dod / 100 : type.dod;
    const watts = o.load / (o.inverter ? 0.9 : 1);
    const current = watts / bankVolts;
    const cRate = current / bankAh;
    // Peukert's law relative to the 20-hour rate.
    const hours = current > 0 ? 20 * ((bankAh * dod) / (current * 20)) ** type.peukert : Number.POSITIVE_INFINITY;
    const chargeHours = ((bankAh * (1 - o.soc / 100)) / o.charger) * type.chargeFactor;
    const fields: Field[] = [
      heading('Bank'),
      { label: 'Voltage and capacity', value: `${num(bankVolts, 1)} V, ${num(bankAh, 0)} Ah`, mono: true },
      { label: 'Energy', value: `${num(wh / 1000, 2)} kWh nominal, ${num((wh * dod) / 1000, 2)} kWh usable`, mono: true },
      { label: 'Cells in series (approx.)', value: `${Math.round(bankVolts / type.nominal)}`, mono: true },
      heading('Discharge'),
      { label: 'Current drawn', value: `${num(current, 2)} A (${num(cRate, 2)} C)`, mono: true, tone: cRate > (o.type === 'lfp' || o.type === 'nmc' ? 1 : 0.3) ? 'warn' : undefined },
      { label: 'Runtime', value: Number.isFinite(hours) ? `${Math.floor(hours)} h ${Math.round((hours % 1) * 60)} min to ${Math.round((1 - dod) * 100)}% charge` : '—', mono: true, tone: 'ok' },
      heading('Charging'),
      { label: 'Charge rate', value: `${num(o.charger / bankAh, 2)} C`, mono: true, tone: o.charger / bankAh > (o.type === 'lfp' ? 0.5 : 0.2) ? 'warn' : undefined },
      { label: `Time from ${o.soc}% to full`, value: `about ${num(chargeHours, 1)} hours`, mono: true },
    ];
    if (o.type !== 'lfp' && o.type !== 'nmc' && dod > 0.6) fields.push({ label: 'Note', value: 'Discharging lead-acid batteries deeper than 50% shortens their life sharply.', tone: 'warn' });
    return { fields, info: ESTIMATE };
  },
});
