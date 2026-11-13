import { trimNumber } from '../../lib/color';
import { defineVisualTool, type Values } from '../types';
import { arbitrary, color, css, inline, rule, tailwind } from './_shared';

const corner = <K extends string>(key: K, label: string, value: number, show: (v: Values) => boolean) =>
  ({ key, label, type: 'range', min: 0, max: 100, step: 1, unit: '%', default: value, showIf: show }) as const;

const isSimple = (v: Values) => v.mode === 'simple';
const isCorners = (v: Values) => v.mode === 'corners';
const isBlob = (v: Values) => v.mode === 'blob';

const controls = [
  {
    key: 'mode',
    label: 'Mode',
    type: 'segmented',
    choices: [
      { value: 'simple', label: 'All corners' },
      { value: 'corners', label: 'Each corner' },
      { value: 'blob', label: 'Organic' },
    ],
    default: 'corners',
  },
  { key: 'unit', label: 'Unit', type: 'segmented', choices: ['px', '%'], default: 'px', showIf: (v: Values) => v.mode !== 'blob' },
  { key: 'all', label: 'Radius', type: 'range', min: 0, max: 200, step: 1, default: 24, showIf: isSimple },
  { key: 'tl', label: 'Top left', type: 'range', min: 0, max: 200, step: 1, default: 40, showIf: isCorners },
  { key: 'tr', label: 'Top right', type: 'range', min: 0, max: 200, step: 1, default: 8, showIf: isCorners },
  { key: 'br', label: 'Bottom right', type: 'range', min: 0, max: 200, step: 1, default: 40, showIf: isCorners },
  { key: 'bl', label: 'Bottom left', type: 'range', min: 0, max: 200, step: 1, default: 8, showIf: isCorners },
  corner('h1', 'Top edge, from left', 30, isBlob),
  corner('h2', 'Right edge, from top', 30, isBlob),
  corner('h3', 'Bottom edge, from right', 30, isBlob),
  corner('h4', 'Left edge, from bottom', 70, isBlob),
  corner('v1', 'Top-left vertical', 30, isBlob),
  corner('v2', 'Top-right vertical', 70, isBlob),
  corner('v3', 'Bottom-right vertical', 70, isBlob),
  corner('v4', 'Bottom-left vertical', 30, isBlob),
  { key: 'heading', label: 'Shape', type: 'heading' },
  { key: 'width', label: 'Width', type: 'range', min: 60, max: 480, step: 1, unit: 'px', default: 280 },
  { key: 'height', label: 'Height', type: 'range', min: 60, max: 480, step: 1, unit: 'px', default: 220 },
  { key: 'fill', label: 'Colour', type: 'color', default: '#17694e' },
] as const;

const n = (value: number) => trimNumber(value, 2);

export function radiusValue(v: Values): string {
  const unit = v.unit === '%' ? '%' : 'px';
  const len = (value: unknown) => (Number(value) === 0 ? '0' : `${n(Number(value))}${unit}`);
  if (v.mode === 'simple') return len(v.all);
  if (v.mode === 'corners') {
    const values = [v.tl, v.tr, v.br, v.bl].map(len);
    if (values.every((value) => value === values[0])) return values[0] as string;
    if (values[0] === values[2] && values[1] === values[3]) return `${values[0]} ${values[1]}`;
    return values.join(' ');
  }
  // Organic shapes: each edge's two corners always add up to 100%, so curves meet without flat sides.
  const h = [Number(v.h1), 100 - Number(v.h1), Number(v.h3), 100 - Number(v.h3)];
  const vertical = [Number(v.v1), Number(v.v2), 100 - Number(v.v2), 100 - Number(v.v1)];
  return `${h.map((x) => `${n(x)}%`).join(' ')} / ${vertical.map((x) => `${n(x)}%`).join(' ')}`;
}

export default defineVisualTool({
  controls,
  presets: [
    { name: 'Card', values: { mode: 'simple', unit: 'px', all: 12 } },
    { name: 'Pill', values: { mode: 'simple', unit: 'px', all: 200, height: 90 } },
    { name: 'Circle', values: { mode: 'simple', unit: '%', all: 50, width: 240, height: 240 } },
    { name: 'Leaf', values: { mode: 'corners', unit: 'px', tl: 0, tr: 120, br: 0, bl: 120 } },
    { name: 'Tab', values: { mode: 'corners', unit: 'px', tl: 16, tr: 16, br: 0, bl: 0 } },
    { name: 'Blob', values: { mode: 'blob', h1: 63, h3: 41, v1: 37, v2: 52 } },
  ],
  randomize: () => ({
    mode: 'blob',
    h1: 20 + Math.round(Math.random() * 60),
    h3: 20 + Math.round(Math.random() * 60),
    v1: 20 + Math.round(Math.random() * 60),
    v2: 20 + Math.round(Math.random() * 60),
  }),
  render(v) {
    const value = radiusValue(v);
    return {
      preview: (
        <div
          style={inline([
            ['width', `${v.width}px`],
            ['height', `${v.height}px`],
            ['max-width', '100%'],
            ['background', color(v.fill)],
            ['border-radius', value],
            ['transition', 'border-radius .2s'],
          ])}
        />
      ),
      outputs: [css(rule('.shape', [['border-radius', value]])), tailwind([`rounded-${arbitrary(value)}`])],
    };
  },
});
