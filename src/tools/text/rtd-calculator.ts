import { RTD_TOLERANCE, rtdResistance, rtdTemperature } from '../../lib/electrical';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { heading, num } from './_calc';

export default defineTextTool({
  input: false,
  output: { label: 'Table' },
  options: [
    {
      key: 'sensor',
      label: 'Sensor',
      type: 'segmented',
      choices: [
        { value: '100', label: 'Pt100' },
        { value: '500', label: 'Pt500' },
        { value: '1000', label: 'Pt1000' },
      ],
      default: '100',
    },
    {
      key: 'direction',
      label: 'Convert',
      type: 'segmented',
      choices: [
        { value: 't', label: 'Temperature → Ω' },
        { value: 'r', label: 'Ω → temperature' },
      ],
      default: 't',
    },
    { key: 'temperature', label: 'Temperature', type: 'number', default: 25, min: -200, max: 850, step: 0.1, unit: '°C', showIf: (v) => v.direction === 't' },
    { key: 'resistance', label: 'Resistance', type: 'number', default: 109.73, min: 1, max: 5000, step: 0.01, unit: 'Ω', showIf: (v) => v.direction === 'r' },
    {
      key: 'wires',
      label: 'Wiring',
      type: 'segmented',
      choices: [
        { value: '2', label: '2-wire' },
        { value: '3', label: '3-wire' },
        { value: '4', label: '4-wire' },
      ],
      default: '3',
    },
    { key: 'lead', label: 'Resistance of each lead', type: 'number', default: 0, min: 0, max: 100, step: 0.01, unit: 'Ω', showIf: (v) => v.wires === '2' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const r0 = Number(o.sensor);
    const fields: Field[] = [];
    let t: number;
    if (o.direction === 't') {
      if (o.temperature < -200 || o.temperature > 850) throw new ToolError('IEC 60751 covers −200 °C to 850 °C.');
      t = o.temperature;
      const r = rtdResistance(t, r0);
      fields.push({ label: 'Resistance', value: `${num(r, 3)} Ω`, mono: true, tone: 'ok' });
      if (o.wires === '2' && o.lead > 0)
        fields.push({ label: 'Reading with lead resistance', value: `${num(r + 2 * o.lead, 3)} Ω (reads as ${num(rtdTemperature(r + 2 * o.lead, r0), 2)} °C)`, mono: true, tone: 'warn' });
    } else {
      const measured = o.wires === '2' ? o.resistance - 2 * o.lead : o.resistance;
      t = rtdTemperature(measured, r0);
      fields.push({ label: 'Temperature', value: `${num(t, 2)} °C (${num((t * 9) / 5 + 32, 2)} °F)`, mono: true, tone: 'ok' });
    }
    fields.push({ label: 'Sensitivity here', value: `${num((rtdResistance(t + 0.5, r0) - rtdResistance(t - 0.5, r0)) * 1, 4)} Ω/°C`, mono: true }, heading('IEC 60751 tolerance at this temperature'));
    for (const [cls, tolerance] of Object.entries(RTD_TOLERANCE)) fields.push({ label: `Class ${cls}`, value: `±${num(tolerance(t), 3)} °C`, mono: true });
    const table = Array.from({ length: 21 }, (_, index) => -50 + index * 25)
      .filter((value) => value <= 450)
      .map((value) => `${String(value).padStart(5)} °C   ${num(rtdResistance(value, r0), 3).padStart(10)} Ω`)
      .join('\n');
    return { fields, output: `Pt${r0} (α = 0.00385)\n${table}`, info: 'Callendar–Van Dusen equation with the IEC 60751 coefficients.' };
  },
});
