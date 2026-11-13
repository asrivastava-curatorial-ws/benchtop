import { alphaOf, trimNumber, withAlpha } from '../../lib/color';
import { seededRandom } from '../../lib/text';
import { defineVisualTool, type Values } from '../types';
import { color, css, inline, px, rule, tailwind } from './_shared';

const PATTERNS = [
  { value: 'grid', label: 'Grid lines' },
  { value: 'graph', label: 'Graph paper' },
  { value: 'dots', label: 'Dots' },
  { value: 'offset-dots', label: 'Offset dots' },
  { value: 'diagonal', label: 'Diagonal stripes' },
  { value: 'horizontal', label: 'Horizontal stripes' },
  { value: 'vertical', label: 'Vertical stripes' },
  { value: 'checker', label: 'Checkerboard' },
  { value: 'cross', label: 'Plus signs' },
  { value: 'zigzag', label: 'Zigzag' },
  { value: 'stars', label: 'Starfield' },
] as const;

const controls = [
  { key: 'pattern', label: 'Pattern', type: 'select', choices: PATTERNS, default: 'grid' },
  { key: 'fg', label: 'Pattern colour', type: 'color', alpha: true, default: '#17694e40' },
  { key: 'bg', label: 'Background', type: 'color', default: '#f8fafc' },
  { key: 'size', label: 'Size', type: 'range', min: 4, max: 160, step: 1, unit: 'px', default: 32 },
  { key: 'thickness', label: 'Line or dot size', type: 'range', min: 1, max: 40, step: 1, unit: 'px', default: 1, showIf: (v: Values) => !['checker', 'zigzag', 'stars'].includes(String(v.pattern)) },
  { key: 'count', label: 'Stars', type: 'range', min: 5, max: 80, step: 1, default: 30, showIf: (v: Values) => v.pattern === 'stars' },
  { key: 'seed', label: 'Seed', type: 'number', min: 1, max: 99999, step: 1, default: 7, showIf: (v: Values) => v.pattern === 'stars' },
] as const;

interface Pattern {
  readonly image: string;
  readonly size?: string;
  readonly position?: string;
}

/** One plus sign per tile, drawn as an SVG data URI so it stays crisp at any size. */
function crossTile(fg: string, size: number, thickness: number): string {
  const arm = size / 3;
  const c = size / 2;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><path d='M${trimNumber(c - arm / 2, 2)} ${trimNumber(c, 2)}h${trimNumber(arm, 2)}M${trimNumber(c, 2)} ${trimNumber(c - arm / 2, 2)}v${trimNumber(arm, 2)}' stroke='${color(fg)}' stroke-width='${thickness}'/></svg>`;
  return `url("data:image/svg+xml,${svg.replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`;
}

export function pattern(v: { pattern: string; fg: string; size: number; thickness: number; count: number; seed: number }): Pattern {
  const fg = color(v.fg);
  const faint = color(withAlpha(v.fg, alphaOf(v.fg) * 0.5));
  const clear = 'transparent';
  const s = px(v.size);
  const t = px(v.thickness);
  const tile = `${s} ${s}`;
  switch (v.pattern) {
    case 'graph': {
      const major = px(v.size * 5);
      return {
        image: [
          `linear-gradient(${fg} ${t}, ${clear} ${t})`,
          `linear-gradient(90deg, ${fg} ${t}, ${clear} ${t})`,
          `linear-gradient(${faint} 1px, ${clear} 1px)`,
          `linear-gradient(90deg, ${faint} 1px, ${clear} 1px)`,
        ].join(', '),
        size: `${major} ${major}, ${major} ${major}, ${tile}, ${tile}`,
      };
    }
    case 'dots':
      return { image: `radial-gradient(circle, ${fg} ${t}, ${clear} calc(${t} + 0.5px))`, size: tile };
    case 'offset-dots': {
      const dot = `radial-gradient(circle, ${fg} ${t}, ${clear} calc(${t} + 0.5px))`;
      return { image: `${dot}, ${dot}`, size: tile, position: `0 0, ${px(v.size / 2)} ${px(v.size / 2)}` };
    }
    case 'diagonal':
      return { image: `repeating-linear-gradient(45deg, ${fg} 0 ${t}, ${clear} ${t} ${s})` };
    case 'horizontal':
      return { image: `repeating-linear-gradient(0deg, ${fg} 0 ${t}, ${clear} ${t} ${s})` };
    case 'vertical':
      return { image: `repeating-linear-gradient(90deg, ${fg} 0 ${t}, ${clear} ${t} ${s})` };
    case 'checker':
      return { image: `repeating-conic-gradient(${fg} 0 25%, ${clear} 0 50%)`, size: tile };
    case 'cross':
      return { image: crossTile(v.fg, v.size, v.thickness), size: tile };
    case 'zigzag': {
      const half = px(v.size / 2);
      return {
        image: [
          `linear-gradient(135deg, ${fg} 25%, ${clear} 25%)`,
          `linear-gradient(225deg, ${fg} 25%, ${clear} 25%)`,
          `linear-gradient(315deg, ${fg} 25%, ${clear} 25%)`,
          `linear-gradient(45deg, ${fg} 25%, ${clear} 25%)`,
        ].join(', '),
        size: tile,
        position: `-${half} 0, -${half} 0, 0 0, 0 0`,
      };
    }
    case 'stars': {
      const random = seededRandom(Math.round(v.seed));
      const layers: string[] = [];
      for (let i = 0; i < v.count; i++) {
        const r = trimNumber(0.6 + random() * 1.6, 2);
        layers.push(`radial-gradient(${r}px ${r}px at ${trimNumber(random() * 100, 2)}% ${trimNumber(random() * 100, 2)}%, ${fg}, ${clear})`);
      }
      const area = px(v.size * 6);
      return { image: layers.join(', '), size: `${area} ${area}` };
    }
    default:
      return { image: `linear-gradient(${fg} ${t}, ${clear} ${t}), linear-gradient(90deg, ${fg} ${t}, ${clear} ${t})`, size: tile };
  }
}

export default defineVisualTool({
  controls,
  presets: [
    { name: 'Blueprint', values: { pattern: 'graph', fg: '#ffffff59', bg: '#1e40af', size: 20, thickness: 2 } },
    { name: 'Notebook', values: { pattern: 'horizontal', fg: '#93c5fd', bg: '#ffffff', size: 28, thickness: 1 } },
    { name: 'Polka', values: { pattern: 'offset-dots', fg: '#f472b6', bg: '#fdf2f8', size: 36, thickness: 5 } },
    { name: 'Hazard', values: { pattern: 'diagonal', fg: '#facc15', bg: '#111827', size: 40, thickness: 20 } },
    { name: 'Night sky', values: { pattern: 'stars', fg: '#ffffff', bg: '#0b1026', size: 40, count: 40 } },
  ],
  randomize: () => ({ seed: 1 + Math.floor(Math.random() * 99998) }),
  render(v) {
    const p = pattern(v);
    const declarations: [string, string][] = [
      ['background-color', color(v.bg)],
      ['background-image', p.image],
    ];
    if (p.size) declarations.push(['background-size', p.size]);
    if (p.position) declarations.push(['background-position', p.position]);
    return {
      preview: <div class="pv-pattern" style={inline(declarations)} />,
      css: '.pv-pattern { width: 100%; height: 100%; min-height: 320px; border-radius: 6px; }',
      outputs: [css(rule('.pattern', declarations)), tailwind(declarations.map(([property, value]) => `[${property}:${value.replace(/_/g, '\\_').replace(/\s+/g, '_')}]`))],
      note: `${PATTERNS.find((item) => item.value === v.pattern)?.label ?? 'Pattern'}, made from CSS alone with no image files.`,
    };
  },
});
