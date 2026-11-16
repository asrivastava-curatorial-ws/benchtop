import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'bore', label: 'Bore', type: 'number', default: 80, min: 5, max: 1000, step: 1, unit: 'mm' },
    { key: 'rod', label: 'Rod', type: 'number', default: 45, min: 1, max: 900, step: 1, unit: 'mm' },
    { key: 'stroke', label: 'Stroke', type: 'number', default: 400, min: 1, step: 10, unit: 'mm' },
    { key: 'pressure', label: 'Working pressure', type: 'number', default: 160, min: 1, max: 700, step: 5, unit: 'bar' },
    { key: 'flow', label: 'Pump flow', type: 'number', default: 30, min: 0.1, step: 0.5, unit: 'l/min' },
    { key: 'efficiency', label: 'Pump overall efficiency', type: 'number', default: 85, min: 30, max: 98, step: 1, unit: '%' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const capArea = (Math.PI * (o.bore / 10) ** 2) / 4; // cm²
    const annulus = capArea - (Math.PI * (o.rod / 10) ** 2) / 4;
    const pushKn = (o.pressure * capArea) / 100;
    const pullKn = (o.pressure * annulus) / 100;
    const extendSpeed = o.flow / (6 * capArea); // m/s
    const retractSpeed = o.flow / (6 * annulus);
    const extendVolume = (capArea * o.stroke) / 10000; // litres
    const retractVolume = (annulus * o.stroke) / 10000;
    const powerKw = (o.pressure * o.flow) / 600 / (o.efficiency / 100);
    const fields: Field[] = [
      heading('Force'),
      { label: 'Push (extend)', value: `${num(pushKn, 1)} kN = ${num((pushKn * 1000) / 9.80665, 0)} kgf`, mono: true, tone: 'ok' },
      { label: 'Pull (retract)', value: `${num(pullKn, 1)} kN = ${num((pullKn * 1000) / 9.80665, 0)} kgf`, mono: true },
      { label: 'Area ratio', value: num(capArea / annulus, 2), mono: true },
      heading('Speed'),
      { label: 'Extend', value: `${num(extendSpeed * 1000, 0)} mm/s, stroke in ${num(o.stroke / 1000 / extendSpeed, 1)} s`, mono: true },
      { label: 'Retract', value: `${num(retractSpeed * 1000, 0)} mm/s, stroke in ${num(o.stroke / 1000 / retractSpeed, 1)} s`, mono: true },
      { label: 'Oil per stroke', value: `${num(extendVolume, 2)} l out, ${num(retractVolume, 2)} l back`, mono: true },
      heading('Pump'),
      { label: 'Drive power', value: `${num(powerKw, 2)} kW (${num(powerKw / 0.7457, 1)} hp)`, mono: true, tone: 'ok' },
      { label: 'Return flow when retracting', value: `${num(o.flow * (capArea / annulus), 1)} l/min (size the return line for it)`, mono: true },
    ];
    if (o.rod >= o.bore) return { fields: [{ label: 'Rod', value: 'The rod must be smaller than the bore.', tone: 'bad' }] };
    return { fields, info: `${ESTIMATE} Friction and seal losses reduce the force by about 5–10%.` };
  },
});
