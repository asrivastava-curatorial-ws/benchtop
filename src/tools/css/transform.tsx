import { composeTransform, formatMatrix } from '../../lib/geometry';
import { defineVisualTool, type Values } from '../types';
import { arbitrary, css, deg, num, px, rule, tailwind } from './_shared';

const three = (v: Values) => v.use3d === true;

const controls = [
  { key: 'translateX', label: 'Translate X', type: 'range', min: -200, max: 200, step: 1, unit: 'px', default: 0 },
  { key: 'translateY', label: 'Translate Y', type: 'range', min: -200, max: 200, step: 1, unit: 'px', default: 0 },
  { key: 'rotate', label: 'Rotate', type: 'range', min: -360, max: 360, step: 1, unit: '°', default: 15 },
  { key: 'scaleX', label: 'Scale X', type: 'range', min: -3, max: 3, step: 0.05, default: 1 },
  { key: 'scaleY', label: 'Scale Y', type: 'range', min: -3, max: 3, step: 0.05, default: 1 },
  { key: 'skewX', label: 'Skew X', type: 'range', min: -80, max: 80, step: 1, unit: '°', default: 0 },
  { key: 'skewY', label: 'Skew Y', type: 'range', min: -80, max: 80, step: 1, unit: '°', default: 0 },
  { key: 'origin', label: 'transform-origin', type: 'select', choices: ['center', 'top left', 'top', 'top right', 'left', 'right', 'bottom left', 'bottom', 'bottom right'], default: 'center' },
  { key: 'use3d', label: '3D', type: 'toggle', default: false },
  { key: 'perspective', label: 'Perspective', type: 'range', min: 100, max: 2000, step: 10, unit: 'px', default: 800, showIf: three },
  { key: 'rotateX', label: 'Rotate X', type: 'range', min: -180, max: 180, step: 1, unit: '°', default: 20, showIf: three },
  { key: 'rotateY', label: 'Rotate Y', type: 'range', min: -180, max: 180, step: 1, unit: '°', default: -25, showIf: three },
  { key: 'translateZ', label: 'Translate Z', type: 'range', min: -300, max: 300, step: 1, unit: 'px', default: 0, showIf: three },
] as const;

export function transformList(v: Values): string {
  const parts: string[] = [];
  const n = (key: string) => Number(v[key]);
  if (v.use3d && n('perspective') > 0) parts.push(`perspective(${px(n('perspective'))})`);
  if (n('translateX') !== 0 || n('translateY') !== 0) parts.push(`translate(${px(n('translateX'))}, ${px(n('translateY'))})`);
  if (v.use3d && n('translateZ') !== 0) parts.push(`translateZ(${px(n('translateZ'))})`);
  if (v.use3d && n('rotateX') !== 0) parts.push(`rotateX(${deg(n('rotateX'))})`);
  if (v.use3d && n('rotateY') !== 0) parts.push(`rotateY(${deg(n('rotateY'))})`);
  if (n('rotate') !== 0) parts.push(`rotate(${deg(n('rotate'))})`);
  if (n('scaleX') !== 1 || n('scaleY') !== 1) parts.push(n('scaleX') === n('scaleY') ? `scale(${num(n('scaleX'))})` : `scale(${num(n('scaleX'))}, ${num(n('scaleY'))})`);
  if (n('skewX') !== 0 || n('skewY') !== 0) parts.push(`skew(${deg(n('skewX'))}, ${deg(n('skewY'))})`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

export default defineVisualTool({
  controls,
  presets: [
    { name: 'Tilt', values: { rotate: -6, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, use3d: false } },
    { name: 'Mirror', values: { rotate: 0, scaleX: -1, scaleY: 1, use3d: false } },
    { name: 'Card flip', values: { rotate: 0, use3d: true, rotateY: 180, rotateX: 0, perspective: 800 } },
    { name: 'Isometric', values: { rotate: 45, skewX: 0, skewY: 0, scaleX: 1, scaleY: 0.58, use3d: false } },
  ],
  render(v) {
    const value = transformList(v);
    const matrix = formatMatrix(composeTransform(v));
    const outputs = [
      css(rule('.box', [['transform', value], ...(v.origin !== 'center' ? ([['transform-origin', v.origin]] as [string, string][]) : [])])),
      ...(v.use3d ? [] : [css(rule('.box', [['transform', matrix]]), 'matrix()')]),
      tailwind([`transform-${arbitrary(value)}`, v.origin !== 'center' && `origin-${v.origin.replace(' ', '-')}`]),
    ];
    return {
      preview: (
        <div class="pv-transform-stage">
          <div class="pv-transform-ghost" />
          <div class="pv-transform" style={`transform: ${value}; transform-origin: ${v.origin};`}>
            <span>Box</span>
          </div>
        </div>
      ),
      css: '.pv-transform-stage { position: relative; width: 100%; height: 100%; min-height: 360px; display: grid; place-items: center; overflow: hidden; } .pv-transform-ghost, .pv-transform { grid-area: 1 / 1; width: 160px; height: 160px; border-radius: 6px; } .pv-transform-ghost { border: 2px dashed var(--line-strong); } .pv-transform { display: grid; place-items: center; background: linear-gradient(135deg, var(--accent), var(--brass)); color: #fff; font: 600 18px var(--font-ui); backface-visibility: visible; }',
      outputs,
      note: v.use3d ? 'matrix() can only express 2D transforms; turn off 3D to see it.' : `matrix() combines the whole list: ${matrix}`,
    };
  },
});
