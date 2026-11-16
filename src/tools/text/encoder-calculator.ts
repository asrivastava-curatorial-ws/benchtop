import { defineTextTool, type Field } from '../types';
import { heading, num } from './_calc';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'ppr', label: 'Pulses per revolution (PPR)', type: 'number', default: 1024, min: 1, step: 1 },
    { key: 'rpm', label: 'Shaft speed', type: 'number', default: 1500, min: 0, step: 10, unit: 'rpm' },
    {
      key: 'decoding',
      label: 'Counting',
      type: 'segmented',
      choices: [
        { value: '1', label: '×1' },
        { value: '2', label: '×2' },
        { value: '4', label: '×4 (quadrature)' },
      ],
      default: '4',
    },
    { key: 'maxHz', label: 'Counter input limit', type: 'number', default: 100, min: 1, step: 1, unit: 'kHz' },
    {
      key: 'drive',
      label: 'Linear motion',
      type: 'select',
      choices: [
        { value: 'none', label: 'None' },
        { value: 'wheel', label: 'Measuring wheel or roller' },
        { value: 'screw', label: 'Lead screw' },
      ],
      default: 'none',
    },
    { key: 'diameter', label: 'Wheel diameter', type: 'number', default: 63.66, min: 0.01, step: 0.01, unit: 'mm', showIf: (v) => v.drive === 'wheel' },
    { key: 'lead', label: 'Screw lead', type: 'number', default: 5, min: 0.01, step: 0.01, unit: 'mm', showIf: (v) => v.drive === 'screw' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const counts = o.ppr * Number(o.decoding);
    const frequency = (o.ppr * o.rpm) / 60;
    const countRate = frequency * Number(o.decoding);
    const maxRpm = ((o.maxHz * 1000) / o.ppr) * 60;
    const fields: Field[] = [
      { label: 'Pulse frequency per channel', value: `${num(frequency / 1000, 3)} kHz`, mono: true, tone: frequency > o.maxHz * 1000 ? 'bad' : 'ok' },
      { label: 'Count rate', value: `${num(countRate / 1000, 3)} kcounts/s`, mono: true },
      { label: 'Counts per revolution', value: num(counts, 0), mono: true },
      { label: 'Angular resolution', value: `${num(360 / counts, 4)}° (${num((360 / counts) * 60, 2)} arcmin)`, mono: true },
      { label: 'Highest speed for the counter', value: `${num(maxRpm, 0)} rpm`, mono: true, tone: maxRpm < o.rpm ? 'bad' : undefined },
    ];
    const travel = o.drive === 'wheel' ? Math.PI * o.diameter : o.drive === 'screw' ? o.lead : 0;
    if (travel > 0) {
      fields.push(
        heading('Linear'),
        { label: 'Travel per revolution', value: `${num(travel, 3)} mm`, mono: true },
        { label: 'Resolution', value: `${num((travel / counts) * 1000, 3)} µm per count`, mono: true },
        { label: 'Linear speed', value: `${num((travel * o.rpm) / 60 / 1000, 4)} m/s (${num((travel * o.rpm) / 1000, 2)} m/min)`, mono: true },
      );
    }
    return { fields };
  },
});
