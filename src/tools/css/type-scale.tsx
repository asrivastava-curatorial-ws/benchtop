import { trimNumber } from '../../lib/color';
import { defineVisualTool, type Values } from '../types';
import { css } from './_shared';

const RATIOS = [
  { value: '1.067', label: 'Minor second (1.067)' },
  { value: '1.125', label: 'Major second (1.125)' },
  { value: '1.2', label: 'Minor third (1.2)' },
  { value: '1.25', label: 'Major third (1.25)' },
  { value: '1.333', label: 'Perfect fourth (1.333)' },
  { value: '1.414', label: 'Augmented fourth (1.414)' },
  { value: '1.5', label: 'Perfect fifth (1.5)' },
  { value: '1.6', label: 'Minor sixth (1.6)' },
  { value: '1.618', label: 'Golden ratio (1.618)' },
  { value: '1.667', label: 'Major sixth (1.667)' },
  { value: '2', label: 'Octave (2)' },
];

const FONTS: Record<string, string> = {
  sans: '"Barlow", system-ui, sans-serif',
  serif: 'Georgia, "Noto Serif", serif',
  mono: '"JetBrains Mono Variable", monospace',
  devanagari: '"Benchtop Sans", "Noto Sans Devanagari", sans-serif',
};

const fluid = (v: Values) => v.fluid === true;

const controls = [
  { key: 'base', label: 'Body text size', type: 'range', min: 10, max: 28, step: 0.5, unit: 'px', default: 16 },
  { key: 'ratio', label: 'Scale', type: 'select', choices: RATIOS, default: '1.25' },
  { key: 'up', label: 'Steps up', type: 'range', min: 1, max: 10, step: 1, default: 6 },
  { key: 'down', label: 'Steps down', type: 'range', min: 0, max: 4, step: 1, default: 2 },
  { key: 'units', label: 'Units', type: 'segmented', choices: ['rem', 'px'], default: 'rem' },
  { key: 'fluid', label: 'Grow with the screen (fluid)', type: 'toggle', default: false, help: 'Sizes move smoothly between a small and a large screen with clamp().' },
  { key: 'maxBase', label: 'Body size on large screens', type: 'range', min: 10, max: 32, step: 0.5, unit: 'px', default: 18, showIf: fluid },
  { key: 'maxRatio', label: 'Scale on large screens', type: 'select', choices: RATIOS, default: '1.333', showIf: fluid },
  { key: 'minWidth', label: 'Small screen width', type: 'number', min: 240, max: 1200, step: 10, unit: 'px', default: 360, showIf: fluid },
  { key: 'maxWidth', label: 'Large screen width', type: 'number', min: 600, max: 3000, step: 10, unit: 'px', default: 1280, showIf: fluid },
  { key: 'heading', label: 'Preview', type: 'heading' },
  {
    key: 'font',
    label: 'Typeface',
    type: 'select',
    choices: [
      { value: 'sans', label: 'Sans' },
      { value: 'serif', label: 'Serif' },
      { value: 'mono', label: 'Monospace' },
      { value: 'devanagari', label: 'Devanagari' },
    ],
    default: 'sans',
  },
  { key: 'sample', label: 'Sample text', type: 'text', default: 'Science is a way of thinking', wide: true },
  { key: 'prefix', label: 'Variable prefix', type: 'text', default: 'step', mono: true },
] as const;

export default defineVisualTool({
  controls,
  render(v) {
    const ratio = Number(v.ratio);
    const steps: number[] = [];
    for (let s = v.up; s >= -v.down; s--) steps.push(s);
    const prefix = v.prefix.trim().replace(/[^a-z0-9-]/gi, '') || 'step';
    const name = (s: number) => `--${prefix}-${s < 0 ? `-${-s}` : s}`;
    const fmt = (px: number) => (v.units === 'rem' ? `${trimNumber(px / 16, 4)}rem` : `${trimNumber(px, 2)}px`);
    const minW = Math.min(v.minWidth, v.maxWidth - 1);
    const maxW = Math.max(v.maxWidth, minW + 1);
    const rows = steps.map((s) => {
      const min = v.base * ratio ** s;
      if (!v.fluid) return { s, value: fmt(min), preview: min, min, max: min };
      const max = v.maxBase * Number(v.maxRatio) ** s;
      const slope = (max - min) / (maxW - minW);
      const intercept = min - slope * minW;
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      const value = `clamp(${fmt(lo)}, ${v.units === 'rem' ? `${trimNumber(intercept / 16, 4)}rem` : `${trimNumber(intercept, 2)}px`} + ${trimNumber(slope * 100, 4)}vw, ${fmt(hi)})`;
      return { s, value, preview: (min + max) / 2, min, max };
    });
    const lines = rows.map((r) => `  ${name(r.s)}: ${r.value};`).join('\n');
    const code = `:root {\n${lines}\n}\n\nbody { font-size: var(${name(0)}); line-height: 1.5; }\nh1 { font-size: var(${name(Math.min(v.up, 5))}); line-height: 1.1; }\nh2 { font-size: var(${name(Math.min(v.up, 4))}); line-height: 1.15; }\nh3 { font-size: var(${name(Math.min(v.up, 3))}); line-height: 1.2; }\nh4 { font-size: var(${name(Math.min(v.up, 2))}); line-height: 1.25; }\nsmall { font-size: var(${name(v.down ? -1 : 0)}); }\n`;
    const tailwind = `@theme {\n${rows.map((r) => `  --text-${prefix}-${r.s < 0 ? `-${-r.s}` : r.s}: ${r.value};`).join('\n')}\n}\n`;
    const scss = `$type-scale: (\n${rows.map((r) => `  ${r.s}: ${r.value},`).join('\n')}\n);\n`;
    return {
      preview: (
        <div class="ts-stage" style={{ fontFamily: FONTS[v.font] }}>
          {rows.map((r) => (
            <div class="ts-row" key={r.s}>
              <span class="ts-meta">
                {r.s}
                <br />
                {v.fluid ? `${trimNumber(r.min, 1)}–${trimNumber(r.max, 1)}px` : `${trimNumber(r.min, 1)}px`}
              </span>
              <span class="ts-sample" style={{ fontSize: `${r.preview}px` }}>
                {v.sample || 'Science is a way of thinking'}
              </span>
            </div>
          ))}
        </div>
      ),
      css: '.ts-stage { display: grid; gap: 10px; width: 100%; padding: 12px 18px; color: #1a2027; background: #fff; } .ts-row { display: grid; grid-template-columns: 74px minmax(0, 1fr); align-items: baseline; gap: 12px; border-bottom: 1px solid #e3e7ea; padding-bottom: 6px; } .ts-meta { color: #5f6b75; font: 11px/1.3 "JetBrains Mono Variable", monospace; } .ts-sample { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; line-height: 1.15; }',
      outputs: [
        css(code, 'CSS', 'type-scale.css'),
        { label: 'Tailwind v4', language: 'css', code: tailwind, filename: 'type-scale.tailwind.css' },
        { label: 'Sass', language: 'css', code: scss, filename: '_type-scale.scss' },
      ],
      note: v.fluid ? `Between ${minW}px and ${maxW}px wide the sizes grow smoothly; outside that range they stay at their smallest or largest.` : undefined,
    };
  },
});
