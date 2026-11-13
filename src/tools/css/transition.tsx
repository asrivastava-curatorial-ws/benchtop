import { defineVisualTool, type Values } from '../types';
import { css, rule, tailwind } from './_shared';

export const EASINGS: Record<string, string> = {
  ease: 'ease',
  linear: 'linear',
  'ease-in': 'ease-in',
  'ease-out': 'ease-out',
  'ease-in-out': 'ease-in-out',
  'ease-out-back': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  'ease-in-back': 'cubic-bezier(0.36, 0, 0.66, -0.56)',
  'ease-out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
  'ease-in-out-quint': 'cubic-bezier(0.83, 0, 0.17, 1)',
  'steps-5': 'steps(5, end)',
  custom: '',
};

const EFFECTS: Record<string, { label: string; property: string; hover: string }> = {
  lift: { label: 'Lift and shadow', property: 'transform, box-shadow', hover: 'transform: translateY(-8px); box-shadow: 0 16px 30px rgb(0 0 0 / .25);' },
  grow: { label: 'Grow', property: 'transform', hover: 'transform: scale(1.15);' },
  slide: { label: 'Slide right', property: 'transform', hover: 'transform: translateX(120px);' },
  spin: { label: 'Rotate', property: 'transform', hover: 'transform: rotate(180deg);' },
  color: { label: 'Colour', property: 'background-color, color', hover: 'background-color: #c8962e; color: #111;' },
  fade: { label: 'Fade', property: 'opacity', hover: 'opacity: .25;' },
  radius: { label: 'Round off', property: 'border-radius', hover: 'border-radius: 50%;' },
};

const controls = [
  { key: 'effect', label: 'Effect on hover', type: 'select', choices: Object.entries(EFFECTS).map(([value, effect]) => ({ value, label: effect.label })), default: 'lift' },
  { key: 'property', label: 'transition-property', type: 'select', choices: [{ value: 'auto', label: 'What the effect changes' }, 'all'], default: 'auto' },
  { key: 'duration', label: 'Duration', type: 'range', min: 0, max: 3000, step: 10, unit: 'ms', default: 300 },
  { key: 'easing', label: 'Timing function', type: 'select', choices: Object.keys(EASINGS), default: 'ease-out-back' },
  { key: 'custom', label: 'Custom timing', type: 'text', default: 'cubic-bezier(0.25, 0.1, 0.25, 1)', mono: true, wide: true, showIf: (v: Values) => v.easing === 'custom' },
  { key: 'delay', label: 'Delay', type: 'range', min: 0, max: 2000, step: 10, unit: 'ms', default: 0 },
  { key: 'demo', label: 'Keep toggling', type: 'toggle', default: false, help: 'Plays the effect repeatedly instead of on hover.' },
] as const;

const ms = (value: number) => (value % 1000 === 0 && value > 0 ? `${value / 1000}s` : `${value}ms`);

export default defineVisualTool({
  controls,
  render(v) {
    const effect = EFFECTS[v.effect] ?? (EFFECTS.lift as (typeof EFFECTS)[string]);
    const timing = v.easing === 'custom' ? v.custom.trim() || 'ease' : (EASINGS[v.easing] ?? 'ease');
    const properties = v.property === 'all' ? ['all'] : effect.property.split(/,\s*/);
    const value = properties.map((property) => `${property} ${ms(v.duration)} ${timing}${v.delay > 0 ? ` ${ms(v.delay)}` : ''}`).join(', ');
    const hover = effect.hover;
    const preview = `.pv-trans { transition: ${value}; } .pv-trans-zone:hover .pv-trans { ${hover} }${v.demo ? ` @keyframes pv-toggle { 0%, 45% { } 50%, 95% { ${hover} } } .pv-trans.is-demo { animation: pv-toggle ${Math.max(400, (v.duration + v.delay) * 2 + 800)}ms steps(1, end) infinite; }` : ''}`;
    return {
      preview: (
        <div class="pv-trans-zone">
          <div class={`pv-trans${v.demo ? ' is-demo' : ''}`}>Hover me</div>
        </div>
      ),
      css: `.pv-trans-zone { width: 100%; height: 100%; min-height: 320px; display: grid; place-items: center; } .pv-trans { width: 150px; height: 150px; display: grid; place-items: center; border-radius: 10px; background: var(--accent); color: #fff; font: 600 16px var(--font-ui); cursor: pointer; } ${preview}`,
      outputs: [
        css(`${rule('.button', [['transition', value]])}\n.button:hover {\n  ${hover.replace(/;\s*/g, ';\n  ').trim()}\n}\n`),
        tailwind([
          `transition-${v.property === 'all' ? 'all' : `[${effect.property.replace(/\s+/g, '')}]`}`,
          `duration-${v.duration}`,
          `ease-[${timing.replace(/\s+/g, '')}]`,
          v.delay > 0 && `delay-${v.delay}`,
        ]),
      ],
      note: v.demo ? 'The preview toggles the effect on a loop so you can watch the timing.' : 'Hover over the box to play the transition; move away to play it in reverse.',
    };
  },
});
