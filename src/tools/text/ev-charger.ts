import { IEC_BREAKERS, nextSize, SQRT3 } from '../../lib/electrical';
import { defineTextTool, type Field } from '../types';
import { duration, ESTIMATE, heading, num } from './_calc';

/** Charger output and, for AC chargers, the rated supply current per phase. */
const CHARGERS: readonly { value: string; label: string; amps?: number }[] = [
  { value: '3.3', label: '3.3 kW AC (15 A single-phase)', amps: 15 },
  { value: '7.4', label: '7.4 kW AC (32 A single-phase)', amps: 32 },
  { value: '11', label: '11 kW AC (16 A three-phase)', amps: 16 },
  { value: '22', label: '22 kW AC (32 A three-phase)', amps: 32 },
  { value: '30', label: '30 kW DC fast' },
  { value: '60', label: '60 kW DC fast' },
  { value: '120', label: '120 kW DC fast' },
];

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'charger', label: 'Charger', type: 'select', choices: CHARGERS, default: '7.4' },
    { key: 'count', label: 'Number of chargers', type: 'number', default: 1, min: 1, max: 200, step: 1 },
    { key: 'simultaneity', label: 'Share charging at once', type: 'number', default: 100, min: 10, max: 100, step: 5, unit: '%' },
    { key: 'battery', label: 'Vehicle battery', type: 'number', default: 40, min: 1, max: 300, step: 1, unit: 'kWh' },
    { key: 'from', label: 'Charge from', type: 'number', default: 20, min: 0, max: 100, step: 5, unit: '%' },
    { key: 'to', label: 'Charge to', type: 'number', default: 80, min: 0, max: 100, step: 5, unit: '%' },
    { key: 'onboard', label: 'Car’s on-board charger limit (AC)', type: 'number', default: 7.2, min: 1, max: 22, step: 0.1, unit: 'kW' },
    { key: 'tariff', label: 'Energy charge', type: 'number', default: 8.5, min: 0, step: 0.1, help: 'Per kWh.' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const kw = Number(o.charger);
    const ac = kw <= 22;
    const threePhase = kw >= 11;
    const volts = threePhase ? 415 : 230;
    // AC chargers draw their rated current; DC chargers draw their output through about 95% efficiency at 0.95 power factor.
    const rated = CHARGERS.find((charger) => charger.value === o.charger)?.amps;
    const amps = rated ?? (threePhase ? (kw * 1000) / (SQRT3 * volts * (ac ? 1 : 0.95 * 0.95)) : (kw * 1000) / volts);
    const effective = ac ? Math.min(kw, o.onboard) : kw;
    const energy = (o.battery * Math.max(0, o.to - o.from)) / 100;
    const hours = energy / (effective * (ac ? 0.9 : 0.93));
    const siteKw = kw * o.count * (o.simultaneity / 100);
    const fields: Field[] = [
      heading('Each charger'),
      { label: 'Supply', value: `${threePhase ? 'Three-phase 415 V' : 'Single-phase 230 V'}, ${num(amps, 1)} A`, mono: true },
      { label: 'Circuit breaker', value: `${nextSize(IEC_BREAKERS, amps * 1.25) ?? '—'} A (125% of the continuous current)`, mono: true, tone: 'ok' },
      { label: 'Residual current protection', value: 'Type A RCD with 6 mA DC detection, or type B (IEC 60364-7-722)' },
      heading('Charging'),
      { label: 'Energy added', value: `${num(energy, 1)} kWh`, mono: true },
      { label: 'Time', value: `${duration(hours * 60)}${ac && o.onboard < kw ? ` (limited by the car’s ${o.onboard} kW on-board charger)` : ''}`, mono: true },
      { label: 'Cost', value: num((energy / 0.9) * o.tariff, 0), mono: true },
      heading('Site'),
      { label: 'Simultaneous load', value: `${num(siteKw, 1)} kW (${num(siteKw / 0.95, 1)} kVA)`, mono: true },
      { label: 'Site current at 415 V', value: `${num((siteKw * 1000) / (SQRT3 * 415 * 0.95), 0)} A`, mono: true },
    ];
    if (!ac) fields.push({ label: 'Note', value: 'DC fast charging slows down above about 80% state of charge, so real times are longer near full.', tone: 'warn' });
    return { fields, info: ESTIMATE };
  },
});
