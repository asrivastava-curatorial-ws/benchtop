import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { heading, num } from './_calc';

export default defineTextTool({
  input: {
    label: 'Appliances',
    placeholder: 'One per line: name, watts, quantity, hours per day',
    sample: 'LED panel, 36, 40, 10\nSplit AC 1.5 TR, 1600, 6, 8\nProjector, 450, 4, 9\nDesktop PC, 120, 12, 9\nWater cooler, 500, 2, 12',
  },
  output: { label: 'Table' },
  options: [
    { key: 'tariff', label: 'Energy charge', type: 'number', default: 8.5, min: 0, step: 0.05, help: 'Per kWh (unit), in your currency.' },
    { key: 'days', label: 'Days in use per month', type: 'number', default: 26, min: 1, max: 31, step: 1 },
    {
      key: 'diversity',
      label: 'Diversity factor',
      type: 'number',
      default: 0.8,
      min: 0.2,
      max: 1,
      step: 0.05,
      help: 'Share of the connected load that runs at the same time; sets the maximum demand.',
    },
    { key: 'fixed', label: 'Demand charge per kVA per month', type: 'number', default: 0, min: 0, step: 1 },
    { key: 'pf', label: 'Average power factor', type: 'number', default: 0.9, min: 0.5, max: 1, step: 0.01 },
    { key: 'co2', label: 'Grid emission factor', type: 'number', default: 0.716, min: 0, max: 2, step: 0.001, unit: 'kg CO₂/kWh', help: 'India’s grid average is about 0.72 (CEA).' },
  ],
  run(input, o) {
    const rows = input
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line, index) => {
        const [name = '', watts = '', quantity = '1', hours = '0'] = line.split(',').map((part) => part.trim());
        const w = Number(watts);
        if (!(w >= 0)) throw new ToolError(`Line ${index + 1}: the second value must be watts.`, { line: index + 1 });
        const q = Number(quantity) || 1;
        const h = Number(hours) || 0;
        return { name, connected: w * q, daily: (w * q * h) / 1000 };
      });
    const connected = rows.reduce((sum, row) => sum + row.connected, 0) / 1000;
    const daily = rows.reduce((sum, row) => sum + row.daily, 0);
    const monthly = daily * o.days;
    const demandKva = (connected * o.diversity) / o.pf;
    const bill = monthly * o.tariff + demandKva * o.fixed;
    const fields: Field[] = [
      { label: 'Connected load', value: `${num(connected, 2)} kW`, mono: true },
      { label: 'Maximum demand', value: `${num(connected * o.diversity, 2)} kW, ${num(demandKva, 2)} kVA`, mono: true },
      heading('Energy'),
      { label: 'Per day', value: `${num(daily, 2)} kWh`, mono: true },
      { label: 'Per month', value: `${num(monthly, 1)} kWh`, mono: true },
      { label: 'Per year', value: `${num(monthly * 12, 0)} kWh`, mono: true },
      { label: 'Load factor', value: connected > 0 ? `${num((daily / 24 / (connected * o.diversity)) * 100, 1)}% (average load over a day ÷ maximum demand)` : '—', mono: true },
      heading('Cost'),
      { label: 'Per month', value: num(bill, 0), mono: true, tone: 'ok' },
      { label: 'Per year', value: num(bill * 12, 0), mono: true },
      { label: 'CO₂ per year', value: `${num((monthly * 12 * o.co2) / 1000, 2)} tonnes`, mono: true },
    ];
    const table = rows
      .sort((a, b) => b.daily - a.daily)
      .map(
        (row) =>
          `${row.name.padEnd(28)} ${num(row.connected / 1000, 2).padStart(8)} kW ${num(row.daily * o.days, 1).padStart(9)} kWh/month ${num((row.daily / Math.max(daily, 1e-9)) * 100, 1).padStart(6)}%`,
      )
      .join('\n');
    return { fields, output: table, info: 'Biggest users first. Taxes and slab tariffs are not included.' };
  },
});
