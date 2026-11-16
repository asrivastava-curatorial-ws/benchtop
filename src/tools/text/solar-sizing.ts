import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

/** Approximate annual average global horizontal irradiation (peak sun hours, kWh/m²/day). */
export const CITIES: Record<string, { hours: number; latitude: number }> = {
  Bengaluru: { hours: 5.3, latitude: 13 },
  Mysuru: { hours: 5.4, latitude: 12.3 },
  Chennai: { hours: 5.4, latitude: 13.1 },
  Hyderabad: { hours: 5.5, latitude: 17.4 },
  Mumbai: { hours: 5.0, latitude: 19.1 },
  Pune: { hours: 5.3, latitude: 18.5 },
  'New Delhi': { hours: 5.1, latitude: 28.6 },
  Jaipur: { hours: 5.8, latitude: 26.9 },
  Ahmedabad: { hours: 5.6, latitude: 23 },
  Kolkata: { hours: 4.6, latitude: 22.6 },
  Guwahati: { hours: 4.3, latitude: 26.1 },
  Kochi: { hours: 5.0, latitude: 10 },
  Bhopal: { hours: 5.4, latitude: 23.3 },
  Lucknow: { hours: 5.0, latitude: 26.8 },
};

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'kind',
      label: 'System',
      type: 'segmented',
      choices: [
        { value: 'grid', label: 'Grid-tied' },
        { value: 'offgrid', label: 'Off-grid with batteries' },
      ],
      default: 'grid',
    },
    { key: 'daily', label: 'Daily energy to cover', type: 'number', default: 20, min: 0.1, step: 0.5, unit: 'kWh' },
    { key: 'city', label: 'Location', type: 'select', choices: [...Object.keys(CITIES), 'Custom'], default: 'Bengaluru' },
    { key: 'sunHours', label: 'Peak sun hours', type: 'number', default: 5, min: 1, max: 8, step: 0.1, showIf: (v) => v.city === 'Custom' },
    { key: 'derate', label: 'System losses', type: 'number', default: 22, min: 5, max: 40, step: 1, unit: '%', help: 'Heat, dust, wiring, inverter and mismatch together; 18–25% is usual in India.' },
    { key: 'panel', label: 'Panel rating', type: 'number', default: 550, min: 50, max: 800, step: 5, unit: 'W' },
    { key: 'voc', label: 'Panel open-circuit voltage (Voc)', type: 'number', default: 49.9, min: 5, max: 100, step: 0.1, unit: 'V' },
    { key: 'isc', label: 'Panel short-circuit current (Isc)', type: 'number', default: 14, min: 1, max: 25, step: 0.1, unit: 'A' },
    { key: 'tempCoeff', label: 'Voc temperature coefficient', type: 'number', default: -0.27, min: -0.6, max: 0, step: 0.01, unit: '%/°C' },
    { key: 'coldest', label: 'Coldest morning', type: 'number', default: 10, min: -40, max: 35, step: 1, unit: '°C' },
    { key: 'maxVolts', label: 'Inverter or controller maximum DC voltage', type: 'number', default: 1000, min: 50, max: 1500, step: 10, unit: 'V' },
    { key: 'autonomy', label: 'Days of battery autonomy', type: 'number', default: 1, min: 0.5, max: 7, step: 0.5, showIf: (v) => v.kind === 'offgrid' },
    { key: 'batteryVolts', label: 'Battery bank voltage', type: 'number', default: 48, min: 12, max: 800, step: 12, unit: 'V', showIf: (v) => v.kind === 'offgrid' },
    { key: 'dod', label: 'Battery usable depth', type: 'number', default: 80, min: 30, max: 100, step: 5, unit: '%', showIf: (v) => v.kind === 'offgrid' },
    { key: 'tariff', label: 'Energy charge saved', type: 'number', default: 8.5, min: 0, step: 0.1, help: 'Per kWh.' },
    { key: 'costPerKw', label: 'Installed cost per kWp', type: 'number', default: 55000, min: 0, step: 1000 },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const place = CITIES[o.city];
    const sun = place ? place.hours : o.sunHours;
    const performance = 1 - o.derate / 100;
    if (!(sun > 0)) throw new ToolError('Enter the peak sun hours.');
    const kwp = o.daily / (sun * performance) / (o.kind === 'offgrid' ? 0.9 : 1);
    const panels = Math.ceil((kwp * 1000) / o.panel);
    const actualKwp = (panels * o.panel) / 1000;
    const annual = actualKwp * sun * performance * 365;
    const vocCold = o.voc * (1 + (o.tempCoeff / 100) * (o.coldest - 25));
    const maxSeries = Math.floor(o.maxVolts / vocCold);
    const fields: Field[] = [
      heading('Array'),
      { label: 'Array size', value: `${num(kwp, 2)} kWp → ${panels} × ${o.panel} W = ${num(actualKwp, 2)} kWp`, mono: true, tone: 'ok' },
      { label: 'Roof area', value: `about ${num(panels * 2.6, 0)} m² (${num(panels * 2.6 * 10.764, 0)} ft²) shadow-free`, mono: true },
      { label: 'Tilt', value: place ? `about ${num(place.latitude, 0)}° facing south` : 'about your latitude, facing south' },
      heading('Output'),
      { label: 'Energy per year', value: `${num(annual, 0)} kWh (${num(annual / actualKwp, 0)} kWh per kWp)`, mono: true },
      { label: 'Saving per year', value: num(annual * o.tariff, 0), mono: true },
      { label: 'Simple payback', value: `${num((actualKwp * o.costPerKw) / Math.max(1, annual * o.tariff), 1)} years`, mono: true },
      heading('Strings'),
      { label: 'Voc on the coldest morning', value: `${num(vocCold, 2)} V per panel`, mono: true },
      { label: 'Most panels in series', value: `${maxSeries} (${num(maxSeries * vocCold, 0)} V ≤ ${o.maxVolts} V)`, mono: true, tone: maxSeries > 0 ? 'ok' : 'bad' },
      { label: 'Fuse or controller current per string', value: `${num(o.isc * 1.25, 1)} A (Isc × 1.25)`, mono: true },
    ];
    if (o.kind === 'offgrid') {
      const kwh = (o.daily * o.autonomy) / (o.dod / 100) / 0.9;
      fields.push(
        heading('Battery bank'),
        { label: 'Capacity', value: `${num(kwh, 1)} kWh = ${num((kwh * 1000) / o.batteryVolts, 0)} Ah at ${o.batteryVolts} V`, mono: true, tone: 'ok' },
        { label: 'Charge controller', value: `at least ${num(((actualKwp * 1000) / o.batteryVolts) * 1.25, 0)} A at ${o.batteryVolts} V`, mono: true },
      );
    }
    return { fields, info: `${ESTIMATE} Sun hours are rough annual averages; monsoon months produce much less.` };
  },
});
