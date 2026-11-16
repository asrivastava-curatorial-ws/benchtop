import { defineTextTool, type Field } from '../types';
import { heading, num, TR } from './_calc';

/** Ratings and their factor to W/W (Wh of cooling per Wh of electricity). */
const RATINGS: Record<string, { label: string; toWw: number }> = {
  iseer: { label: 'ISEER (India, BEE)', toWw: 1 },
  seerEu: { label: 'SEER (Europe, W/W)', toWw: 1 },
  seerUs: { label: 'SEER2 or SEER (US, BTU/Wh)', toWw: 1 / 3.412 },
  eer: { label: 'EER (BTU/Wh)', toWw: 1 / 3.412 },
  cop: { label: 'EER or COP (W/W)', toWw: 1 },
};

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'capacity', label: 'Capacity', type: 'number', default: 1.5, min: 0.1, step: 0.1, unit: 'TR' },
    { key: 'units', label: 'Number of units', type: 'number', default: 1, min: 1, step: 1 },
    { key: 'rating', label: 'Rating type', type: 'select', choices: Object.entries(RATINGS).map(([value, { label }]) => ({ value, label })), default: 'iseer' },
    { key: 'a', label: 'Rating of unit A (current or cheaper)', type: 'number', default: 3.8, min: 0.5, max: 40, step: 0.05 },
    { key: 'b', label: 'Rating of unit B (efficient)', type: 'number', default: 5.2, min: 0.5, max: 40, step: 0.05 },
    { key: 'hours', label: 'Running hours per year', type: 'number', default: 1600, min: 0, max: 8760, step: 100, help: 'BEE’s ISEER test season is 1,600 hours.' },
    { key: 'load', label: 'Average load', type: 'number', default: 60, min: 10, max: 100, step: 5, unit: '%', help: 'Share of the rated capacity the units deliver over those hours.' },
    { key: 'tariff', label: 'Energy charge', type: 'number', default: 8.5, min: 0, step: 0.1, help: 'Per kWh.' },
    { key: 'premium', label: 'Extra price of unit B', type: 'number', default: 12000, min: 0, step: 500, help: 'Per unit.' },
    { key: 'years', label: 'Years of use', type: 'number', default: 10, min: 1, max: 30, step: 1 },
    { key: 'co2', label: 'Grid emission factor', type: 'number', default: 0.716, min: 0, max: 2, step: 0.001, unit: 'kg CO₂/kWh' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const rating = RATINGS[o.rating] ?? (RATINGS.iseer as (typeof RATINGS)[string]);
    const cooling = ((o.capacity * TR) / 1000) * o.hours * (o.load / 100) * o.units; // kWh of cooling
    const kwhA = cooling / (o.a * rating.toWw);
    const kwhB = cooling / (o.b * rating.toWw);
    const saved = kwhA - kwhB;
    const money = saved * o.tariff;
    const payback = money > 0 ? (o.premium * o.units) / money : Number.POSITIVE_INFINITY;
    const fields: Field[] = [
      { label: 'Cooling delivered', value: `${num(cooling, 0)} kWh a year`, mono: true },
      heading('Electricity per year'),
      { label: 'Unit A', value: `${num(kwhA, 0)} kWh = ${num(kwhA * o.tariff, 0)}`, mono: true },
      { label: 'Unit B', value: `${num(kwhB, 0)} kWh = ${num(kwhB * o.tariff, 0)}`, mono: true },
      { label: 'Saving with B', value: `${num(saved, 0)} kWh (${num((saved / kwhA) * 100, 1)}%) = ${num(money, 0)} a year`, mono: true, tone: saved > 0 ? 'ok' : 'warn' },
      { label: 'CO₂ avoided', value: `${num((saved * o.co2) / 1000, 2)} t a year`, mono: true },
      heading('Over the life'),
      { label: 'Payback of the extra price', value: Number.isFinite(payback) ? `${num(payback, 1)} years` : 'Never at these figures', mono: true, tone: payback <= o.years ? 'ok' : 'warn' },
      { label: `Net saving over ${o.years} years`, value: num(money * o.years - o.premium * o.units, 0), mono: true, tone: money * o.years >= o.premium * o.units ? 'ok' : 'bad' },
    ];
    return { fields, info: 'Seasonal ratings compare like with like only: use the same rating type for both units. Savings are linear in hours, load and tariff.' };
  },
});
