import { defineVisualTool, type Values } from '../types';
import { arbitrary, color, css, inline, px, rule, tailwind } from './_shared';

const STYLES = ['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset', 'none'];
const linked = (v: Values) => v.linked === true;
const separate = (v: Values) => v.linked !== true;

const side = <N extends 'top' | 'right' | 'bottom' | 'left'>(name: N, label: string) =>
  [
    { key: `${name}Width`, label: `${label} width`, type: 'range', min: 0, max: 40, step: 1, unit: 'px', default: 4, showIf: separate },
    { key: `${name}Style`, label: `${label} style`, type: 'select', choices: STYLES, default: 'solid', showIf: separate },
    { key: `${name}Color`, label: `${label} colour`, type: 'color', alpha: true, default: '#17694e', showIf: separate },
  ] as const;

const controls = [
  { key: 'linked', label: 'Same on every side', type: 'toggle', default: true },
  { key: 'width', label: 'Width', type: 'range', min: 0, max: 40, step: 1, unit: 'px', default: 4, showIf: linked },
  { key: 'style', label: 'Style', type: 'select', choices: STYLES, default: 'dashed', showIf: linked },
  { key: 'color', label: 'Colour', type: 'color', alpha: true, default: '#17694e', showIf: linked },
  ...side('top', 'Top'),
  ...side('right', 'Right'),
  ...side('bottom', 'Bottom'),
  ...side('left', 'Left'),
  { key: 'radius', label: 'Corner radius', type: 'range', min: 0, max: 120, step: 1, unit: 'px', default: 12 },
  { key: 'background', label: 'Box colour', type: 'color', alpha: true, default: '#ffffff' },
] as const;

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const TW_SIDE: Record<(typeof SIDES)[number], string> = { top: 't', right: 'r', bottom: 'b', left: 'l' };

export default defineVisualTool({
  controls,
  render(v) {
    const declarations: [string, string][] = [];
    const classes: string[] = [];
    if (v.linked) {
      declarations.push(['border', `${px(v.width)} ${v.style} ${color(v.color)}`]);
      classes.push(
        `border-${arbitrary(px(v.width))}`,
        `border-${v.style === 'groove' || v.style === 'ridge' || v.style === 'inset' || v.style === 'outset' ? arbitrary(v.style) : v.style}`,
        `border-${arbitrary(color(v.color))}`,
      );
    } else {
      const values = v as unknown as Record<string, string | number>;
      for (const name of SIDES) {
        const width = Number(values[`${name}Width`]);
        const style = String(values[`${name}Style`]);
        const colour = color(String(values[`${name}Color`]));
        declarations.push([`border-${name}`, `${px(width)} ${style} ${colour}`]);
        classes.push(`border-${TW_SIDE[name]}-${arbitrary(px(width))}`, `border-${TW_SIDE[name]}-${arbitrary(colour)}`);
      }
      classes.push(`[border-style:${SIDES.map((name) => values[`${name}Style`]).join('_')}]`);
    }
    if (v.radius > 0) {
      declarations.push(['border-radius', px(v.radius)]);
      classes.push(`rounded-${arbitrary(px(v.radius))}`);
    }
    declarations.push(['background', color(v.background)]);
    classes.push(`bg-${arbitrary(color(v.background))}`);
    return {
      preview: <div style={`${inline(declarations)} width: 260px; height: 180px; max-width: 100%;`} />,
      outputs: [css(rule('.box', declarations)), tailwind(classes)],
    };
  },
});
