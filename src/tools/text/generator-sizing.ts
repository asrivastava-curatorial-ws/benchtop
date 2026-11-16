import { GENSET_SIZES, STARTING_MULTIPLIER } from '../../lib/electrical';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

export default defineTextTool({
  input: {
    label: 'Loads',
    placeholder: 'One per line: name, kW, quantity, motor? (yes for motors)',
    sample: 'Lighting, 12, 1\nAir handling unit fan, 7.5, 2, yes\nLift, 11, 1, yes\nComputers and servers, 18, 1\nPumps, 5.5, 2, yes',
  },
  output: false,
  options: [
    { key: 'pf', label: 'Generator power factor', type: 'number', default: 0.8, min: 0.5, max: 1, step: 0.05 },
    {
      key: 'starter',
      label: 'Largest motor starts by',
      type: 'select',
      choices: [
        { value: 'dol', label: 'Direct on line' },
        { value: 'star', label: 'Star-delta' },
        { value: 'soft', label: 'Soft starter' },
        { value: 'vfd', label: 'Variable frequency drive' },
      ],
      default: 'star',
    },
    { key: 'diversity', label: 'Diversity factor', type: 'number', default: 0.9, min: 0.3, max: 1, step: 0.05, help: 'Share of the connected load running at once.' },
    { key: 'altitude', label: 'Site altitude', type: 'number', default: 900, min: 0, max: 5000, step: 100, unit: 'm' },
    { key: 'ambient', label: 'Hottest ambient', type: 'number', default: 40, min: 10, max: 60, step: 1, unit: '°C' },
    { key: 'margin', label: 'Spare capacity', type: 'number', default: 20, min: 0, max: 100, step: 5, unit: '%' },
    { key: 'tank', label: 'Fuel tank', type: 'number', default: 990, min: 0, step: 10, unit: 'litres' },
  ],
  runOnEmpty: true,
  run(input, o) {
    const loads = input
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line, index) => {
        const [name = '', kw = '', quantity = '1', motor = ''] = line.split(',').map((part) => part.trim());
        const power = Number(kw);
        if (!(power >= 0)) throw new ToolError(`Line ${index + 1}: the second value must be kW.`, { line: index + 1 });
        return { name, kw: power * (Number(quantity) || 1), unit: power, motor: /^(y|yes|motor|m|true)$/i.test(motor) };
      });
    const running = loads.reduce((sum, load) => sum + load.kw, 0) * o.diversity;
    const largest = loads.filter((load) => load.motor).sort((a, b) => b.unit - a.unit)[0];
    // Starting kVA of the largest motor on top of everything else already running.
    const startKva = largest ? ((largest.unit / 0.88) * (STARTING_MULTIPLIER[o.starter] ?? 3)) / 0.85 : 0;
    const steadyKva = running / o.pf;
    const peakKva = steadyKva - (largest ? largest.unit / 0.85 : 0) + startKva;
    const altitudeDerate = o.altitude > 1000 ? 1 - ((o.altitude - 1000) / 300) * 0.035 : 1;
    const heatDerate = o.ambient > 40 ? 1 - (o.ambient - 40) * 0.01 : 1;
    const needed = (Math.max(steadyKva, peakKva / 1.5) * (1 + o.margin / 100)) / (altitudeDerate * heatDerate);
    const choice = GENSET_SIZES.find((size) => size >= needed);
    const loadFraction = choice ? Math.min(1, running / (choice * o.pf)) : 1;
    // Typical diesel use: about 0.27 l/kWh near full load, rising at light load.
    const litresPerHour = choice ? running * (0.24 + 0.08 * (1 - loadFraction)) + choice * 0.008 : 0;
    const fields: Field[] = [
      heading('Load'),
      { label: 'Running load', value: `${num(running, 1)} kW, ${num(steadyKva, 1)} kVA`, mono: true },
      { label: 'Largest motor start', value: largest ? `${largest.name}: about ${num(startKva, 0)} kVA while starting` : 'No motors listed', mono: true },
      { label: 'Derating', value: `${num(altitudeDerate * heatDerate * 100, 0)}% of nameplate at ${o.altitude} m and ${o.ambient} °C` },
      heading('Generator'),
      { label: 'Minimum rating', value: `${num(needed, 0)} kVA`, mono: true },
      {
        label: 'Standard set',
        value: choice ? `${choice} kVA (${num(choice * 0.8, 0)} kW prime at 0.8 pf)` : 'Larger than standard sets: use several in parallel',
        mono: true,
        tone: choice ? 'ok' : 'bad',
      },
      { label: 'Load on the set', value: `${num(loadFraction * 100, 0)}%`, tone: loadFraction < 0.3 ? 'warn' : 'ok' },
      { label: 'Fuel use', value: `about ${num(litresPerHour, 1)} l/h`, mono: true },
      { label: 'Runtime on a full tank', value: litresPerHour > 0 ? `about ${num(o.tank / litresPerHour, 1)} hours` : '—', mono: true },
    ];
    if (loadFraction < 0.3) fields.push({ label: 'Note', value: 'Diesel sets run below 30% load for long periods suffer wet stacking; consider a smaller set or a load bank.', tone: 'warn' });
    return { fields, info: ESTIMATE };
  },
});
