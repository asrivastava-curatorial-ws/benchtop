import { trimNumber } from '../../lib/color';
import { defineTextTool, type Field, type Values } from '../types';

const DENSITIES: [name: string, dpi: number][] = [
  ['ldpi', 120],
  ['mdpi', 160],
  ['hdpi', 240],
  ['xhdpi', 320],
  ['xxhdpi', 480],
  ['xxxhdpi', 640],
];

export default defineTextTool({
  input: false,
  output: { label: 'Across densities' },
  options: [
    { key: 'value', label: 'Value', type: 'number', default: 16, min: 0, max: 100000, step: 1 },
    { key: 'unit', label: 'Unit', type: 'select', choices: ['dp', 'px', 'sp', 'in', 'mm', 'pt'], default: 'dp' },
    {
      key: 'density',
      label: 'Screen density',
      type: 'select',
      choices: [...DENSITIES.map(([name, dpi]) => ({ value: String(dpi), label: `${name} (${dpi} dpi)` })), { value: 'custom', label: 'Custom dpi' }],
      default: '320',
    },
    { key: 'dpi', label: 'Custom dpi', type: 'number', default: 420, min: 1, max: 2000, step: 1, showIf: (v: Values) => v.density === 'custom' },
    { key: 'fontScale', label: 'Font scale (for sp)', type: 'number', default: 1, min: 0.5, max: 3, step: 0.05 },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const dpi = o.density === 'custom' ? o.dpi : Number(o.density);
    const scale = dpi / 160;
    // Everything is normalised to physical pixels on the chosen screen first.
    const toPx: Record<string, number> = {
      px: 1,
      dp: scale,
      sp: scale * o.fontScale,
      in: dpi,
      mm: dpi / 25.4,
      pt: dpi / 72,
    };
    const px = o.value * (toPx[o.unit] ?? 1);
    const show = (amount: number, unit: string): Field => ({ label: unit, value: `${trimNumber(amount, 3)} ${unit}`, mono: true });
    const fields: Field[] = [show(px, 'px'), show(px / scale, 'dp'), show(px / (scale * o.fontScale), 'sp'), show(px / dpi, 'in'), show((px / dpi) * 25.4, 'mm'), show((px / dpi) * 72, 'pt')];
    const dp = px / scale;
    const rows = DENSITIES.map(([name, value]) => `${name.padEnd(8)} ${String(value).padStart(3)} dpi  x${trimNumber(value / 160, 2).padEnd(4)}  ${trimNumber(dp * (value / 160), 2)} px`);
    return {
      output: `${trimNumber(dp, 3)} dp renders as:\n\n${rows.join('\n')}`,
      fields,
      info: `1 dp = ${trimNumber(scale, 3)} px at ${dpi} dpi`,
    };
  },
});
