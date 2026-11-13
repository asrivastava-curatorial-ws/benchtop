import { trimNumber } from '../../lib/color';
import { defineVisualTool } from '../types';
import { arbitrary, color, css, inline, px, rule, tailwind } from './_shared';

const LAYER = [
  { key: 'x', label: 'Offset X', type: 'range', min: -100, max: 100, step: 1, unit: 'px', default: 0 },
  { key: 'y', label: 'Offset Y', type: 'range', min: -100, max: 100, step: 1, unit: 'px', default: 10 },
  { key: 'blur', label: 'Blur', type: 'range', min: 0, max: 200, step: 1, unit: 'px', default: 30 },
  { key: 'spread', label: 'Spread', type: 'range', min: -100, max: 100, step: 1, unit: 'px', default: -6 },
  { key: 'color', label: 'Colour', type: 'color', alpha: true, default: '#0f172a33' },
  { key: 'inset', label: 'Inset', type: 'toggle', default: false },
] as const;

const controls = [
  {
    key: 'layers',
    label: 'Shadow layers',
    type: 'list',
    item: LAYER,
    min: 1,
    max: 8,
    itemLabel: 'Layer',
    default: [
      { x: 0, y: 1, blur: 2, spread: 0, color: '#0f172a14', inset: false },
      { x: 0, y: 10, blur: 30, spread: -6, color: '#0f172a33', inset: false },
    ],
  },
  { key: 'heading', label: 'Box', type: 'heading' },
  { key: 'background', label: 'Box colour', type: 'color', default: '#ffffff' },
  { key: 'stage', label: 'Backdrop colour', type: 'color', default: '#e5e7eb' },
  { key: 'radius', label: 'Corner radius', type: 'range', min: 0, max: 120, step: 1, unit: 'px', default: 16 },
  { key: 'size', label: 'Box size', type: 'range', min: 60, max: 320, step: 1, unit: 'px', default: 200 },
] as const;

interface Layer {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: string;
  readonly inset: boolean;
}

export function shadowValue(layers: readonly Layer[]): string {
  return layers.map((l) => `${l.inset ? 'inset ' : ''}${px(l.x)} ${px(l.y)} ${px(l.blur)} ${px(l.spread)} ${color(l.color)}`).join(', ');
}

export default defineVisualTool({
  controls,
  presets: [
    {
      name: 'Subtle',
      values: {
        layers: [
          { x: 0, y: 1, blur: 3, spread: 0, color: '#0000001a', inset: false },
          { x: 0, y: 1, blur: 2, spread: -1, color: '#0000001a', inset: false },
        ],
      },
    },
    { name: 'Floating', values: { layers: [{ x: 0, y: 25, blur: 50, spread: -12, color: '#00000040', inset: false }] } },
    { name: 'Layered', values: { layers: [1, 2, 4, 8, 16].map((n) => ({ x: 0, y: n, blur: n * 2, spread: 0, color: '#0f172a12', inset: false })) } },
    {
      name: 'Soft UI',
      values: {
        background: '#e0e5ec',
        stage: '#e0e5ec',
        layers: [
          { x: 9, y: 9, blur: 16, spread: 0, color: '#a3b1c699', inset: false },
          { x: -9, y: -9, blur: 16, spread: 0, color: '#ffffff80', inset: false },
        ],
      },
    },
    {
      name: 'Pressed',
      values: {
        background: '#e0e5ec',
        stage: '#e0e5ec',
        layers: [
          { x: 6, y: 6, blur: 10, spread: 0, color: '#a3b1c6b3', inset: true },
          { x: -6, y: -6, blur: 10, spread: 0, color: '#ffffffb3', inset: true },
        ],
      },
    },
    { name: 'Glow', values: { background: '#1e1b4b', stage: '#0b0a1f', layers: [{ x: 0, y: 0, blur: 24, spread: 4, color: '#818cf8b3', inset: false }] } },
    { name: 'Hard edge', values: { layers: [{ x: 8, y: 8, blur: 0, spread: 0, color: '#111827', inset: false }] } },
  ],
  render(v) {
    const value = shadowValue(v.layers as readonly Layer[]);
    const box = inline([
      ['width', px(v.size)],
      ['height', px(v.size)],
      ['background', color(v.background)],
      ['border-radius', px(v.radius)],
      ['box-shadow', value],
    ]);
    return {
      preview: (
        <div class="pv-backdrop" style={`background: ${color(v.stage)};`}>
          <div style={box} />
        </div>
      ),
      css: '.pv-backdrop { display: grid; place-items: center; width: 100%; height: 100%; min-height: 320px; border-radius: 6px; }',
      outputs: [
        css(
          rule('.card', [
            ['background', color(v.background)],
            ['border-radius', px(v.radius)],
            ['box-shadow', value],
          ]),
        ),
        tailwind([`bg-${arbitrary(color(v.background))}`, `rounded-${arbitrary(px(v.radius))}`, `shadow-${arbitrary(value)}`]),
      ],
      note: `${(v.layers as readonly Layer[]).length} layer${(v.layers as readonly Layer[]).length === 1 ? '' : 's'}; the first layer is drawn on top. Box ${trimNumber(v.size, 0)} px.`,
    };
  },
});
