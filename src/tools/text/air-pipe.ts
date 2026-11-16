import { defineTextTool, type Field } from '../types';
import { ESTIMATE, num } from './_calc';

/** Compressed-air pressure drop (bar): Δp = 450·qc^1.85·l / (d^5·p), qc in l/s free air, l in m, d in mm, p in bar(a). */
export const airPressureDrop = (lps: number, metres: number, mm: number, barAbs: number): number => (450 * lps ** 1.85 * metres) / (mm ** 5 * barAbs);

const PIPE_SIZES = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200];

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'flow', label: 'Flow (free air)', type: 'number', default: 2000, min: 1, step: 10, unit: 'l/min' },
    { key: 'pressure', label: 'Pressure', type: 'number', default: 7, min: 1, max: 40, step: 0.5, unit: 'bar g' },
    { key: 'length', label: 'Pipe length (add 1–2 m per bend)', type: 'number', default: 80, min: 1, step: 1, unit: 'm' },
    { key: 'allowed', label: 'Allowed pressure drop', type: 'number', default: 0.1, min: 0.01, max: 1, step: 0.01, unit: 'bar' },
    { key: 'diameter', label: 'Your pipe inside diameter', type: 'number', default: 0, min: 0, step: 1, unit: 'mm', help: 'Optional: 0 finds the size.' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const lps = o.flow / 60;
    const absolute = o.pressure + 1.01325;
    const minimum = ((450 * lps ** 1.85 * o.length) / (o.allowed * absolute)) ** (1 / 5);
    const nominal = PIPE_SIZES.find((size) => size >= minimum);
    const fields: Field[] = [
      { label: 'Smallest inside diameter', value: `${num(minimum, 1)} mm`, mono: true },
      { label: 'Pipe size', value: nominal ? `${nominal} mm bore` : 'Above 200 mm: use a ring main', mono: true, tone: 'ok' },
    ];
    for (const size of PIPE_SIZES.filter((candidate) => candidate >= minimum * 0.6).slice(0, 5)) {
      const drop = airPressureDrop(lps, o.length, size, absolute);
      const velocity = lps / 1000 / (absolute / 1.01325) / ((Math.PI * (size / 1000) ** 2) / 4);
      fields.push({ label: `${size} mm`, value: `drop ${num(drop, 3)} bar, velocity ${num(velocity, 1)} m/s`, mono: true, tone: drop <= o.allowed ? 'ok' : 'bad' });
    }
    if (o.diameter > 0) fields.push({ label: `Your ${o.diameter} mm pipe`, value: `drop ${num(airPressureDrop(lps, o.length, o.diameter, absolute), 3)} bar`, mono: true });
    return { fields, info: `${ESTIMATE} Keep main-line air speed under about 6 m/s and the drop to the farthest user under 0.1 bar.` };
  },
});
