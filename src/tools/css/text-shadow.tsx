import { escapeHtml } from '../../lib/text';
import { defineVisualTool } from '../types';
import { arbitrary, color, css, inline, px, rule, tailwind } from './_shared';

const LAYER = [
  { key: 'x', label: 'Offset X', type: 'range', min: -50, max: 50, step: 1, unit: 'px', default: 2 },
  { key: 'y', label: 'Offset Y', type: 'range', min: -50, max: 50, step: 1, unit: 'px', default: 2 },
  { key: 'blur', label: 'Blur', type: 'range', min: 0, max: 80, step: 1, unit: 'px', default: 4 },
  { key: 'color', label: 'Colour', type: 'color', alpha: true, default: '#00000059' },
] as const;

const controls = [
  { key: 'text', label: 'Text', type: 'text', default: 'Benchtop', wide: true },
  { key: 'size', label: 'Font size', type: 'range', min: 12, max: 160, step: 1, unit: 'px', default: 88 },
  { key: 'weight', label: 'Weight', type: 'select', choices: ['400', '500', '600', '700', '800', '900'], default: '800' },
  {
    key: 'font',
    label: 'Font',
    type: 'select',
    choices: [
      { value: 'sans', label: 'Sans-serif' },
      { value: 'serif', label: 'Serif' },
      { value: 'mono', label: 'Monospace' },
    ],
    default: 'sans',
  },
  { key: 'fill', label: 'Text colour', type: 'color', alpha: true, default: '#ffffff' },
  { key: 'background', label: 'Background', type: 'color', default: '#2563eb' },
  { key: 'layers', label: 'Shadow layers', type: 'list', item: LAYER, min: 1, max: 12, itemLabel: 'Layer', default: [{ x: 2, y: 3, blur: 6, color: '#00000059' }] },
] as const;

const FONTS: Record<string, string> = {
  sans: 'system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "Cascadia Code", Menlo, monospace',
};

interface Layer {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly color: string;
}

const depth = (count: number, colour: string): Layer[] => Array.from({ length: count }, (_, i) => ({ x: i + 1, y: i + 1, blur: 0, color: colour }));

export default defineVisualTool({
  controls,
  presets: [
    { name: 'Soft', values: { fill: '#ffffff', background: '#2563eb', layers: [{ x: 2, y: 3, blur: 6, color: '#00000059' }] } },
    {
      name: 'Neon',
      values: {
        fill: '#fdf4ff',
        background: '#0b0a1f',
        layers: [
          { x: 0, y: 0, blur: 4, color: '#ffffff' },
          { x: 0, y: 0, blur: 12, color: '#f0abfc' },
          { x: 0, y: 0, blur: 28, color: '#d946ef' },
          { x: 0, y: 0, blur: 48, color: '#a21caf' },
        ],
      },
    },
    {
      name: 'Outline',
      values: {
        fill: '#ffffff',
        background: '#f1f5f9',
        layers: [
          { x: -2, y: -2, blur: 0, color: '#0f172a' },
          { x: 2, y: -2, blur: 0, color: '#0f172a' },
          { x: -2, y: 2, blur: 0, color: '#0f172a' },
          { x: 2, y: 2, blur: 0, color: '#0f172a' },
        ],
      },
    },
    { name: '3D', values: { fill: '#fde047', background: '#7c2d12', layers: [...depth(6, '#b45309'), { x: 8, y: 10, blur: 12, color: '#00000080' }] } },
    {
      name: 'Retro',
      values: {
        fill: '#fef3c7',
        background: '#1f2937',
        layers: [
          { x: 4, y: 4, blur: 0, color: '#ef4444' },
          { x: 8, y: 8, blur: 0, color: '#3b82f6' },
        ],
      },
    },
    {
      name: 'Letterpress',
      values: {
        fill: '#64748b',
        background: '#94a3b8',
        layers: [
          { x: 0, y: 1, blur: 0, color: '#ffffff66' },
          { x: 0, y: -1, blur: 0, color: '#00000040' },
        ],
      },
    },
  ],
  render(v) {
    const value = (v.layers as readonly Layer[]).map((l) => `${px(l.x)} ${px(l.y)} ${px(l.blur)} ${color(l.color)}`).join(', ');
    const declarations = [
      ['color', color(v.fill)],
      ['font-family', FONTS[v.font] ?? FONTS.sans],
      ['font-size', px(v.size)],
      ['font-weight', v.weight],
      ['text-shadow', value],
    ] as const;
    return {
      preview: (
        <div class="pv-backdrop" style={`background: ${color(v.background)};`}>
          <p class="pv-text" style={inline(declarations)}>
            {v.text || 'Text'}
          </p>
        </div>
      ),
      css: '.pv-backdrop { display: grid; place-items: center; width: 100%; height: 100%; min-height: 300px; border-radius: 6px; padding: 24px; } .pv-text { margin: 0; line-height: 1.1; text-align: center; overflow-wrap: anywhere; }',
      outputs: [
        css(rule('.headline', declarations)),
        tailwind(
          [`text-${arbitrary(color(v.fill))}`, `text-${arbitrary(px(v.size))}`, `font-${arbitrary(v.weight)}`, `text-shadow-${arbitrary(value)}`],
          'text-shadow-[...] needs Tailwind CSS 4.1 or later',
        ),
        { label: 'HTML', language: 'html', code: `<h1 class="headline">${escapeHtml(v.text)}</h1>\n` },
      ],
    };
  },
});
