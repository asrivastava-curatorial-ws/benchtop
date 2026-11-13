import { ToolError } from '../../lib/errors';
import { defineVisualTool, type Values } from '../types';
import { css, rule } from './_shared';
import { EASINGS } from './transition';

export const KEYFRAMES: Record<string, string> = {
  'fade-in': 'from { opacity: 0; }\n  to { opacity: 1; }',
  'slide-up': 'from { opacity: 0; transform: translateY(40px); }\n  to { opacity: 1; transform: translateY(0); }',
  'slide-in-left': 'from { opacity: 0; transform: translateX(-60px); }\n  to { opacity: 1; transform: translateX(0); }',
  'zoom-in': 'from { opacity: 0; transform: scale(0.6); }\n  to { opacity: 1; transform: scale(1); }',
  bounce:
    '0%, 20%, 53%, 100% { transform: translateY(0); animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1); }\n  40%, 43% { transform: translateY(-30px); animation-timing-function: cubic-bezier(0.755, 0.05, 0.855, 0.06); }\n  70% { transform: translateY(-15px); animation-timing-function: cubic-bezier(0.755, 0.05, 0.855, 0.06); }\n  90% { transform: translateY(-4px); }',
  pulse: '0%, 100% { transform: scale(1); }\n  50% { transform: scale(1.08); }',
  heartbeat: '0%, 28%, 70% { transform: scale(1); }\n  14%, 42% { transform: scale(1.2); }',
  shake: '0%, 100% { transform: translateX(0); }\n  10%, 30%, 50%, 70%, 90% { transform: translateX(-8px); }\n  20%, 40%, 60%, 80% { transform: translateX(8px); }',
  wobble:
    '0%, 100% { transform: translateX(0) rotate(0); }\n  15% { transform: translateX(-20%) rotate(-5deg); }\n  30% { transform: translateX(15%) rotate(3deg); }\n  45% { transform: translateX(-10%) rotate(-3deg); }\n  60% { transform: translateX(7%) rotate(2deg); }\n  75% { transform: translateX(-4%) rotate(-1deg); }',
  swing: '20% { transform: rotate(15deg); }\n  40% { transform: rotate(-10deg); }\n  60% { transform: rotate(5deg); }\n  80% { transform: rotate(-5deg); }\n  100% { transform: rotate(0); }',
  spin: 'from { transform: rotate(0); }\n  to { transform: rotate(360deg); }',
  flip: 'from { transform: perspective(600px) rotateY(0); }\n  to { transform: perspective(600px) rotateY(360deg); }',
  float: '0%, 100% { transform: translateY(0); }\n  50% { transform: translateY(-14px); }',
  blink: '0%, 49% { opacity: 1; }\n  50%, 100% { opacity: 0; }',
};

const controls = [
  { key: 'preset', label: 'Keyframes', type: 'select', choices: [...Object.keys(KEYFRAMES), { value: 'custom', label: 'Write my own' }], default: 'bounce' },
  {
    key: 'custom',
    label: 'Custom keyframes',
    type: 'text',
    multiline: true,
    mono: true,
    default: '0% { transform: rotate(0) scale(1); }\n50% { transform: rotate(10deg) scale(1.1); }\n100% { transform: rotate(0) scale(1); }',
    showIf: (v: Values) => v.preset === 'custom',
    help: 'Only the blocks inside @keyframes.',
  },
  { key: 'name', label: 'Animation name', type: 'text', default: '', placeholder: 'Same as the keyframes', mono: true },
  { key: 'duration', label: 'Duration', type: 'range', min: 100, max: 5000, step: 50, unit: 'ms', default: 1000 },
  { key: 'easing', label: 'Timing function', type: 'select', choices: Object.keys(EASINGS).filter((key) => key !== 'custom'), default: 'ease' },
  { key: 'delay', label: 'Delay', type: 'range', min: 0, max: 3000, step: 50, unit: 'ms', default: 0 },
  { key: 'infinite', label: 'Repeat forever', type: 'toggle', default: true },
  { key: 'count', label: 'Iterations', type: 'range', min: 1, max: 10, step: 1, default: 1, showIf: (v: Values) => v.infinite !== true },
  { key: 'direction', label: 'Direction', type: 'select', choices: ['normal', 'reverse', 'alternate', 'alternate-reverse'], default: 'normal' },
  { key: 'fill', label: 'Fill mode', type: 'select', choices: ['none', 'forwards', 'backwards', 'both'], default: 'both' },
] as const;

const ms = (value: number) => (value % 1000 === 0 ? `${value / 1000}s` : `${value}ms`);

function checkKeyframes(body: string): string {
  const trimmed = body.trim();
  if (trimmed === '') throw new ToolError('Write at least one keyframe block, for example "50% { opacity: 0.5; }".');
  let depth = 0;
  for (const ch of trimmed) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0 || depth > 1) throw new ToolError('Keyframes have unbalanced braces. Write blocks like "50% { opacity: 0.5; }" without nesting.');
  }
  if (depth !== 0) throw new ToolError('A keyframe block is missing its closing "}".');
  if (/@|<\/?style/i.test(trimmed)) throw new ToolError('Write only the keyframe blocks, without "@keyframes" or other at-rules.');
  return trimmed.replace(/\n\s*/g, '\n  ');
}

export default defineVisualTool({
  controls,
  render(v) {
    const base = v.preset === 'custom' ? 'custom-animation' : v.preset;
    const name = (v.name.trim() || base).replace(/[^\w-]/g, '-').replace(/^(\d)/, '_$1');
    const body = v.preset === 'custom' ? checkKeyframes(v.custom) : (KEYFRAMES[v.preset] ?? '');
    const timing = EASINGS[v.easing] ?? 'ease';
    const iterations = v.infinite ? 'infinite' : String(v.count);
    const shorthand = [name, ms(v.duration), timing, v.delay > 0 ? ms(v.delay) : '', iterations !== '1' ? iterations : '', v.direction !== 'normal' ? v.direction : '', v.fill !== 'none' ? v.fill : '']
      .filter(Boolean)
      .join(' ');
    const keyframes = `@keyframes ${name} {\n  ${body}\n}\n`;
    const previewName = `pv-${name}`;
    return {
      preview: (
        <div class="pv-anim-stage">
          <div class="pv-anim" style={`animation: ${shorthand.replace(name, previewName)};`}>
            {name}
          </div>
        </div>
      ),
      css: `.pv-anim-stage { width: 100%; height: 100%; min-height: 320px; display: grid; place-items: center; overflow: hidden; } .pv-anim { width: 140px; height: 140px; display: grid; place-items: center; border-radius: 12px; background: linear-gradient(135deg, var(--accent), var(--brass)); color: #fff; font: 600 14px var(--font-ui); } ${keyframes.replace(`@keyframes ${name}`, `@keyframes ${previewName}`)}`,
      outputs: [
        css(`${keyframes}\n${rule('.animated', [['animation', shorthand]])}`),
        css(
          `@import "tailwindcss";\n\n@theme {\n  --animate-${name}: ${shorthand.replace(`${name} `, `${name} `)};\n\n  ${keyframes.replace(/\n/g, '\n  ').trimEnd()}\n}\n\n/* Then use: class="animate-${name}" */\n`,
          'Tailwind v4',
        ),
      ],
      note: 'Use Replay to restart animations that run once. People who ask their system for reduced motion should get a calmer version: wrap the rule in @media (prefers-reduced-motion: no-preference).',
    };
  },
});
