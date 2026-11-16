import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { heading, num } from './_calc';

interface Thread {
  readonly id: string;
  readonly label: string;
  readonly system: 'metric' | 'inch' | 'pipe';
  /** Major diameter, mm. */
  readonly d: number;
  /** Pitch, mm. */
  readonly p: number;
  /** Recommended drill, mm (ISO 2306 for metric, standard practice for pipe threads). */
  readonly drill?: number;
}

const metric = (d: number, p: number, drill: number, fine = false): Thread => ({ id: `M${d}x${p}`, label: `M${d} × ${p}${fine ? ' fine' : ''}`, system: 'metric', d, p, drill });
const inch = (name: string, inches: number, tpi: number, series: 'UNC' | 'UNF'): Thread => ({
  id: `${name}-${tpi}`,
  label: `${name}-${tpi} ${series}`,
  system: 'inch',
  d: inches * 25.4,
  p: 25.4 / tpi,
});
const pipe = (name: string, tpi: number, drill: number, kind: 'G' | 'NPT'): Thread => ({
  id: `${kind}${name}`,
  label: kind === 'G' ? `G ${name} (BSPP), ${tpi} TPI` : `${name} NPT, ${tpi} TPI`,
  system: 'pipe',
  d: 0,
  p: 25.4 / tpi,
  drill,
});

export const THREADS: readonly Thread[] = [
  metric(1.6, 0.35, 1.25),
  metric(2, 0.4, 1.6),
  metric(2.5, 0.45, 2.05),
  metric(3, 0.5, 2.5),
  metric(3.5, 0.6, 2.9),
  metric(4, 0.7, 3.3),
  metric(5, 0.8, 4.2),
  metric(6, 1, 5),
  metric(8, 1.25, 6.8),
  metric(10, 1.5, 8.5),
  metric(12, 1.75, 10.2),
  metric(14, 2, 12),
  metric(16, 2, 14),
  metric(18, 2.5, 15.5),
  metric(20, 2.5, 17.5),
  metric(22, 2.5, 19.5),
  metric(24, 3, 21),
  metric(27, 3, 24),
  metric(30, 3.5, 26.5),
  metric(33, 3.5, 29.5),
  metric(36, 4, 32),
  metric(42, 4.5, 37.5),
  metric(48, 5, 43),
  metric(8, 1, 7, true),
  metric(10, 1.25, 8.8, true),
  metric(10, 1, 9, true),
  metric(12, 1.5, 10.5, true),
  metric(12, 1.25, 10.8, true),
  metric(14, 1.5, 12.5, true),
  metric(16, 1.5, 14.5, true),
  metric(18, 1.5, 16.5, true),
  metric(20, 1.5, 18.5, true),
  metric(22, 1.5, 20.5, true),
  metric(24, 2, 22, true),
  inch('#2', 0.086, 56, 'UNC'),
  inch('#4', 0.112, 40, 'UNC'),
  inch('#6', 0.138, 32, 'UNC'),
  inch('#8', 0.164, 32, 'UNC'),
  inch('#10', 0.19, 24, 'UNC'),
  inch('1/4', 0.25, 20, 'UNC'),
  inch('5/16', 0.3125, 18, 'UNC'),
  inch('3/8', 0.375, 16, 'UNC'),
  inch('7/16', 0.4375, 14, 'UNC'),
  inch('1/2', 0.5, 13, 'UNC'),
  inch('5/8', 0.625, 11, 'UNC'),
  inch('3/4', 0.75, 10, 'UNC'),
  inch('7/8', 0.875, 9, 'UNC'),
  inch('1', 1, 8, 'UNC'),
  inch('#4', 0.112, 48, 'UNF'),
  inch('#6', 0.138, 40, 'UNF'),
  inch('#8', 0.164, 36, 'UNF'),
  inch('#10', 0.19, 32, 'UNF'),
  inch('1/4', 0.25, 28, 'UNF'),
  inch('5/16', 0.3125, 24, 'UNF'),
  inch('3/8', 0.375, 24, 'UNF'),
  inch('7/16', 0.4375, 20, 'UNF'),
  inch('1/2', 0.5, 20, 'UNF'),
  inch('5/8', 0.625, 18, 'UNF'),
  inch('3/4', 0.75, 16, 'UNF'),
  inch('1', 1, 12, 'UNF'),
  pipe('1/8', 28, 8.8, 'G'),
  pipe('1/4', 19, 11.8, 'G'),
  pipe('3/8', 19, 15.25, 'G'),
  pipe('1/2', 14, 19, 'G'),
  pipe('3/4', 14, 24.5, 'G'),
  pipe('1', 11, 30.75, 'G'),
  pipe('1/8', 27, 0.339 * 25.4, 'NPT'),
  pipe('1/4', 18, 0.4375 * 25.4, 'NPT'),
  pipe('3/8', 18, 0.5781 * 25.4, 'NPT'),
  pipe('1/2', 14, 0.7188 * 25.4, 'NPT'),
  pipe('3/4', 14, 0.9219 * 25.4, 'NPT'),
  pipe('1', 11.5, 1.1562 * 25.4, 'NPT'),
];

/** Number and letter drills (inches). */
const NUMBER_DRILLS = [
  0.228, 0.221, 0.213, 0.209, 0.2055, 0.204, 0.201, 0.199, 0.196, 0.1935, 0.191, 0.189, 0.185, 0.182, 0.18, 0.177, 0.173, 0.1695, 0.166, 0.161, 0.159, 0.157, 0.154, 0.152, 0.1495, 0.147, 0.144,
  0.1405, 0.136, 0.1285, 0.12, 0.116, 0.113, 0.111, 0.11, 0.1065, 0.104, 0.1015, 0.0995, 0.098, 0.096, 0.0935, 0.089, 0.086, 0.082, 0.081, 0.0785, 0.076, 0.073, 0.07, 0.067, 0.0635, 0.0595, 0.055,
  0.052, 0.0465, 0.043, 0.042, 0.041, 0.04,
];
const LETTER_DRILLS = [
  0.234, 0.238, 0.242, 0.246, 0.25, 0.257, 0.261, 0.266, 0.272, 0.277, 0.281, 0.29, 0.295, 0.302, 0.316, 0.323, 0.332, 0.339, 0.348, 0.358, 0.368, 0.377, 0.386, 0.397, 0.404, 0.413,
];

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export interface Drill {
  readonly name: string;
  readonly mm: number;
}

/** Inch drills: numbers #1–#60, letters A–Z and fractions in 1/64 steps to 1-1/2". */
export const INCH_DRILLS: readonly Drill[] = [
  ...NUMBER_DRILLS.map((inches, index) => ({ name: `#${index + 1}`, mm: inches * 25.4 })),
  ...LETTER_DRILLS.map((inches, index) => ({ name: String.fromCharCode(65 + index), mm: inches * 25.4 })),
  ...Array.from({ length: 96 }, (_, index) => {
    const n = index + 1;
    const whole = Math.floor(n / 64);
    const rest = n % 64;
    const divisor = rest === 0 ? 1 : gcd(rest, 64);
    const fraction = rest === 0 ? '' : `${rest / divisor}/${64 / divisor}`;
    return { name: `${whole > 0 ? `${whole}${fraction ? '-' : ''}` : ''}${fraction}"`, mm: (n / 64) * 25.4 };
  }),
].sort((a, b) => a.mm - b.mm);

/** Metric drills: 0.1 mm steps to 13 mm, 0.5 mm steps to 50 mm. */
export const METRIC_DRILLS: readonly Drill[] = [...Array.from({ length: 121 }, (_, index) => (10 + index) / 10), ...Array.from({ length: 74 }, (_, index) => 13.5 + index * 0.5)].map((mm) => ({
  name: `${num(mm, 2)} mm`,
  mm,
}));

export const nearestDrill = (list: readonly Drill[], mm: number): Drill => list.reduce((best, drill) => (Math.abs(drill.mm - mm) < Math.abs(best.mm - mm) ? drill : best));

/** Thread engagement for a cut tap: % = 76.98 · (D − drill) / P (the same constant serves inch threads in mm). */
export const threadPercent = (d: number, p: number, drill: number): number => (76.98 * (d - drill)) / p;

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'thread',
      label: 'Thread',
      type: 'select',
      choices: [...THREADS.map(({ id, label }) => ({ value: id, label })), { value: 'custom', label: 'Other: enter diameter and pitch' }],
      default: 'M10x1.5',
    },
    { key: 'd', label: 'Major diameter', type: 'number', default: 10, min: 0.5, max: 200, step: 0.1, unit: 'mm', showIf: (v) => v.thread === 'custom' },
    { key: 'p', label: 'Pitch', type: 'number', default: 1.5, min: 0.1, max: 10, step: 0.05, unit: 'mm', help: 'For threads per inch, pitch = 25.4 ÷ TPI.', showIf: (v) => v.thread === 'custom' },
    {
      key: 'tap',
      label: 'Tap',
      type: 'segmented',
      choices: [
        { value: 'cut', label: 'Cutting tap' },
        { value: 'form', label: 'Forming (roll) tap' },
      ],
      default: 'cut',
    },
    {
      key: 'percent',
      label: 'Thread engagement',
      type: 'number',
      default: 75,
      min: 50,
      max: 100,
      step: 5,
      unit: '%',
      help: '75% is the usual target; 60–65% in stainless and tough alloys halves tapping torque and loses little strength.',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const preset = THREADS.find((thread) => thread.id === o.thread);
    const fields: Field[] = [];
    if (preset?.system === 'pipe') {
      const drill = preset.drill ?? 0;
      fields.push(
        { label: 'Tap drill', value: `${num(drill, 2)} mm = ${num(drill / 25.4, 4)}"`, mono: true, tone: 'ok' },
        { label: 'Nearest inch drill', value: nearestDrill(INCH_DRILLS, drill).name, mono: true },
        {
          label: 'Thread',
          value: preset.id.startsWith('G') ? 'Parallel (ISO 228-1): seals with a washer or O-ring' : 'Tapered (ASME B1.20.1): seals on the thread; ream with a 1:16 taper reamer for a better fit',
        },
      );
      return { fields, info: 'Pipe-thread drills are standard practice values; the thread angle and taper rule out a % thread calculation.' };
    }
    const d = preset?.d ?? o.d;
    const p = preset?.p ?? o.p;
    if (!(d > p)) throw new ToolError('The diameter must be larger than the pitch.');
    const forming = o.tap === 'form';
    // Cutting tap: drill = D − %·P / 76.98. Forming tap: drill = D − 0.0068·%·P.
    const ideal = forming ? d - 0.0068 * o.percent * p : d - (o.percent * p) / 76.98;
    const minor = d - 1.082532 * p;
    const percentFor = (drill: number) => (forming ? (d - drill) / (0.0068 * p) : threadPercent(d, p, drill));
    const metricDrill = nearestDrill(METRIC_DRILLS, ideal);
    fields.push(
      { label: 'Thread', value: preset ? preset.label : `Ø${num(d, 3)} × ${num(p, 3)} mm (${num(25.4 / p, 1)} TPI)`, mono: true },
      { label: 'Basic minor diameter', value: `${num(minor, 3)} mm`, mono: true },
      { label: `Drill for ${o.percent}% thread`, value: `${num(ideal, 3)} mm = ${num(ideal / 25.4, 4)}"`, mono: true },
      heading('Drills to use'),
    );
    if (preset?.system === 'metric' && preset.drill && !forming)
      fields.push({ label: 'ISO 2306 recommended', value: `${num(preset.drill, 2)} mm, ${num(percentFor(preset.drill), 0)}% thread`, mono: true, tone: 'ok' });
    fields.push({
      label: 'Nearest metric drill',
      value: `${metricDrill.name}, ${num(percentFor(metricDrill.mm), 0)}% thread`,
      mono: true,
      tone: preset?.system === 'metric' && !forming ? undefined : 'ok',
    });
    if (preset?.system !== 'metric') {
      const inchDrill = nearestDrill(INCH_DRILLS, ideal);
      fields.push({ label: 'Nearest inch drill', value: `${inchDrill.name} (${num(inchDrill.mm / 25.4, 4)}"), ${num(percentFor(inchDrill.mm), 0)}% thread`, mono: true, tone: 'ok' });
    }
    return {
      fields,
      info: forming
        ? 'Forming taps displace metal instead of cutting it, so they need a larger hole: aim for 60–70% thread, in ductile materials only, and check the tap maker’s chart.'
        : 'Above 75% thread, tapping torque climbs steeply while strength barely improves.',
    };
  },
});
