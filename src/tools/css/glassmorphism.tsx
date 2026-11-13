import { toRgba, trimNumber } from '../../lib/color';
import { defineVisualTool } from '../types';
import { arbitrary, css, inline, px, rule, tailwind } from './_shared';

const controls = [
  { key: 'blur', label: 'Blur', type: 'range', min: 0, max: 40, step: 1, unit: 'px', default: 14 },
  { key: 'tint', label: 'Tint', type: 'color', default: '#ffffff' },
  { key: 'opacity', label: 'Tint strength', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 18 },
  { key: 'saturation', label: 'Saturation', type: 'range', min: 50, max: 250, step: 5, unit: '%', default: 160 },
  { key: 'border', label: 'Edge highlight', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 35 },
  { key: 'radius', label: 'Corner radius', type: 'range', min: 0, max: 60, step: 1, unit: 'px', default: 18 },
  { key: 'shadow', label: 'Shadow', type: 'toggle', default: true },
  {
    key: 'backdrop',
    label: 'Backdrop',
    type: 'select',
    choices: [
      { value: 'blobs', label: 'Colour blobs' },
      { value: 'stripes', label: 'Stripes' },
      { value: 'dark', label: 'Dark blobs' },
    ],
    default: 'blobs',
  },
] as const;

const BACKDROPS: Record<string, string> = {
  blobs:
    'radial-gradient(circle at 20% 25%, #f472b6 0 18%, transparent 19%), radial-gradient(circle at 78% 30%, #38bdf8 0 22%, transparent 23%), radial-gradient(circle at 55% 80%, #facc15 0 20%, transparent 21%), linear-gradient(135deg, #6366f1, #14b8a6)',
  stripes: 'repeating-linear-gradient(45deg, #0ea5e9 0 24px, #f97316 24px 48px, #84cc16 48px 72px)',
  dark: 'radial-gradient(circle at 25% 30%, #7c3aed 0 20%, transparent 21%), radial-gradient(circle at 75% 70%, #db2777 0 24%, transparent 25%), #0f172a',
};

export default defineVisualTool({
  controls,
  presets: [
    { name: 'Frosted', values: { blur: 14, tint: '#ffffff', opacity: 18, saturation: 160, border: 35 } },
    { name: 'Clear', values: { blur: 6, tint: '#ffffff', opacity: 8, saturation: 120, border: 25 } },
    { name: 'Smoked', values: { blur: 18, tint: '#0f172a', opacity: 45, saturation: 140, border: 15, backdrop: 'dark' } },
  ],
  render(v) {
    const tint = toRgba(v.tint);
    const background = `rgb(${tint.r} ${tint.g} ${tint.b} / ${trimNumber(v.opacity / 100, 2)})`;
    const filter = `blur(${px(v.blur)}) saturate(${trimNumber(v.saturation, 0)}%)`;
    const declarations: [string, string][] = [
      ['background', background],
      ['backdrop-filter', filter],
      ['-webkit-backdrop-filter', filter],
      ['border', `1px solid rgb(255 255 255 / ${trimNumber(v.border / 100, 2)})`],
      ['border-radius', px(v.radius)],
    ];
    if (v.shadow) declarations.push(['box-shadow', '0 8px 32px rgb(0 0 0 / 0.18)']);
    return {
      preview: (
        <div class="pv-glass-stage" style={`background: ${BACKDROPS[v.backdrop] ?? BACKDROPS.blobs};`}>
          <div class="pv-glass" style={inline(declarations)}>
            <strong>Glass panel</strong>
            <span>Content stays readable over a busy background.</span>
          </div>
        </div>
      ),
      css: '.pv-glass-stage { width: 100%; height: 100%; min-height: 340px; display: grid; place-items: center; border-radius: 6px; } .pv-glass { width: min(80%, 340px); padding: 28px; display: grid; gap: 6px; color: #fff; text-shadow: 0 1px 2px rgb(0 0 0 / .35); }',
      outputs: [
        css(rule('.glass', declarations)),
        tailwind([
          `bg-${arbitrary(background)}`,
          `backdrop-blur-${arbitrary(px(v.blur))}`,
          `backdrop-saturate-${arbitrary(`${v.saturation}%`)}`,
          `border`,
          `border-${arbitrary(`rgb(255 255 255 / ${trimNumber(v.border / 100, 2)})`)}`,
          `rounded-${arbitrary(px(v.radius))}`,
          v.shadow && 'shadow-[0_8px_32px_rgb(0_0_0/0.18)]',
        ]),
      ],
      note: 'backdrop-filter blurs whatever is behind the element, so the panel needs something colourful underneath.',
    };
  },
});
