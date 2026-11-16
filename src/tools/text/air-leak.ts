import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

/** Choked mass flow of air through an orifice (kg/s): Cd·A·p·√(k/(R·T)·(2/(k+1))^((k+1)/(k−1))). */
export function leakMassFlow(diameterMm: number, gaugeBar: number, celsius = 20, cd = 0.65): number {
  const area = (Math.PI * (diameterMm / 1000) ** 2) / 4;
  const p = (gaugeBar + 1.01325) * 1e5;
  const t = celsius + 273.15;
  const k = 1.4;
  const r = 287.05;
  return cd * area * p * Math.sqrt((k / (r * t)) * (2 / (k + 1)) ** ((k + 1) / (k - 1)));
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'diameter', label: 'Hole diameter', type: 'number', default: 3, min: 0.1, max: 50, step: 0.1, unit: 'mm' },
    { key: 'count', label: 'Number of such leaks', type: 'number', default: 1, min: 1, max: 10000, step: 1 },
    { key: 'pressure', label: 'Line pressure', type: 'number', default: 7, min: 1, max: 40, step: 0.5, unit: 'bar g' },
    { key: 'specific', label: 'Compressor specific power', type: 'number', default: 6.5, min: 4, max: 10, step: 0.1, unit: 'kW per m³/min' },
    { key: 'hours', label: 'Hours under pressure per year', type: 'number', default: 6000, min: 0, max: 8760, step: 100 },
    { key: 'tariff', label: 'Energy charge', type: 'number', default: 8.5, min: 0, step: 0.1, help: 'Per kWh.' },
    { key: 'co2', label: 'Grid emission factor', type: 'number', default: 0.716, min: 0, max: 2, step: 0.001, unit: 'kg CO₂/kWh' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const mass = leakMassFlow(o.diameter, o.pressure) * o.count;
    const freeAir = (mass / 1.204) * 60; // m³/min at 20 °C, 1.013 bar
    const kw = freeAir * o.specific;
    const kwh = kw * o.hours;
    const fields: Field[] = [
      { label: 'Air lost', value: `${num(freeAir * 1000, 1)} l/min = ${num(freeAir * 35.315, 2)} CFM (free air)`, mono: true },
      { label: 'Compressor power wasted', value: `${num(kw, 2)} kW`, mono: true, tone: 'warn' },
      heading('Per year'),
      { label: 'Energy', value: `${num(kwh, 0)} kWh`, mono: true },
      { label: 'Cost', value: num(kwh * o.tariff, 0), mono: true, tone: 'bad' },
      { label: 'CO₂', value: `${num((kwh * o.co2) / 1000, 2)} tonnes`, mono: true },
    ];
    return { fields, info: `${ESTIMATE} Choked flow through a sharp-edged hole (discharge coefficient 0.65).` };
  },
});
