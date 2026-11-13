import { toRgba, trimNumber } from '../../lib/color';
import { escapeXml } from '../../lib/text';
import { defineVisualTool, type Values } from '../types';
import { color, inline, xml } from './_shared';

const gradient = (v: Values) => v.fill === 'gradient';

const controls = [
  { key: 'label', label: 'Text', type: 'text', default: 'Continue', wide: true },
  { key: 'textColor', label: 'Text colour', type: 'color', default: '#ffffff' },
  { key: 'textSize', label: 'Text size', type: 'range', min: 10, max: 32, step: 1, unit: 'sp', default: 16 },
  { key: 'bold', label: 'Bold', type: 'toggle', default: true },
  { key: 'fill', label: 'Fill', type: 'segmented', choices: ['solid', 'gradient'], default: 'solid' },
  { key: 'color', label: 'Colour', type: 'color', default: '#17694e' },
  { key: 'endColor', label: 'End colour', type: 'color', default: '#0f4c39', showIf: gradient },
  {
    key: 'angle',
    label: 'Gradient angle',
    type: 'select',
    choices: ['0', '45', '90', '135', '180', '225', '270', '315'],
    default: '270',
    showIf: gradient,
    help: 'Android angles: 0 is left to right, 90 is bottom to top.',
  },
  { key: 'pressed', label: 'Pressed colour', type: 'color', default: '#0f4c39' },
  { key: 'radius', label: 'Corner radius', type: 'range', min: 0, max: 48, step: 1, unit: 'dp', default: 12 },
  { key: 'strokeWidth', label: 'Border width', type: 'range', min: 0, max: 8, step: 1, unit: 'dp', default: 0 },
  { key: 'strokeColor', label: 'Border colour', type: 'color', default: '#c8962e', showIf: (v: Values) => Number(v.strokeWidth) > 0 },
  { key: 'paddingX', label: 'Horizontal padding', type: 'range', min: 0, max: 48, step: 1, unit: 'dp', default: 24 },
  { key: 'paddingY', label: 'Vertical padding', type: 'range', min: 0, max: 32, step: 1, unit: 'dp', default: 12 },
  { key: 'name', label: 'Drawable name', type: 'text', default: 'button_primary', mono: true },
] as const;

/** Android colour resources are #AARRGGBB. */
export function androidColor(input: string): string {
  const c = toRgba(input);
  const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0').toUpperCase();
  return c.a < 1 ? `#${hex(c.a * 255)}${hex(c.r)}${hex(c.g)}${hex(c.b)}` : `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

function shape(v: Values, fillColor: string, indent: string): string {
  const lines = [`${indent}<shape android:shape="rectangle">`];
  if (v.fill === 'gradient' && fillColor === v.color) {
    lines.push(`${indent}    <gradient android:angle="${v.angle}" android:startColor="${androidColor(String(v.color))}" android:endColor="${androidColor(String(v.endColor))}" />`);
  } else {
    lines.push(`${indent}    <solid android:color="${androidColor(fillColor)}" />`);
  }
  if (Number(v.radius) > 0) lines.push(`${indent}    <corners android:radius="${v.radius}dp" />`);
  if (Number(v.strokeWidth) > 0) lines.push(`${indent}    <stroke android:width="${v.strokeWidth}dp" android:color="${androidColor(String(v.strokeColor))}" />`);
  lines.push(`${indent}    <padding android:left="${v.paddingX}dp" android:top="${v.paddingY}dp" android:right="${v.paddingX}dp" android:bottom="${v.paddingY}dp" />`);
  lines.push(`${indent}</shape>`);
  return lines.join('\n');
}

export default defineVisualTool({
  controls,
  render(v) {
    const name =
      v.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^([^a-z])/, 'b_$1') || 'button_primary';
    const drawable = `<?xml version="1.0" encoding="utf-8"?>\n<!-- res/drawable/${name}.xml -->\n<selector xmlns:android="http://schemas.android.com/apk/res/android">\n    <item android:state_pressed="true">\n${shape(v, v.pressed, '        ')}\n    </item>\n    <item android:state_enabled="false">\n${shape(v, '#9E9E9E', '        ')}\n    </item>\n    <item>\n${shape(v, v.color, '        ')}\n    </item>\n</selector>\n`;
    const layout = `<Button\n    android:id="@+id/${name}"\n    android:layout_width="wrap_content"\n    android:layout_height="wrap_content"\n    android:background="@drawable/${name}"\n    android:text="${escapeXml(v.label)}"\n    android:textAllCaps="false"\n    android:textColor="${androidColor(v.textColor)}"\n    android:textSize="${v.textSize}sp"${v.bold ? '\n    android:textStyle="bold"' : ''}\n    android:stateListAnimator="@null" />\n`;
    const background = v.fill === 'gradient' ? `linear-gradient(${trimNumber((90 - Number(v.angle) + 360) % 360, 0)}deg, ${color(v.color)}, ${color(v.endColor)})` : color(v.color);
    const style = inline([
      ['background', background],
      ['color', color(v.textColor)],
      ['font-size', `${v.textSize}px`],
      ['font-weight', v.bold ? '700' : '400'],
      ['border-radius', `${v.radius}px`],
      ['border', v.strokeWidth > 0 ? `${v.strokeWidth}px solid ${color(v.strokeColor)}` : 'none'],
      ['padding', `${v.paddingY}px ${v.paddingX}px`],
      ['--pressed', color(v.pressed)],
    ]);
    return {
      preview: (
        <div class="pv-phone">
          <button type="button" class="pv-android-button" style={style}>
            {v.label || 'Button'}
          </button>
          <small>Press and hold to see the pressed state</small>
        </div>
      ),
      css: '.pv-phone { width: 300px; min-height: 360px; padding: 24px; display: grid; place-content: center; gap: 12px; justify-items: center; border: 10px solid #1f2937; border-radius: 32px; background: #fafafa; color: #555; font-family: Roboto, system-ui, sans-serif; } .pv-android-button { font-family: inherit; cursor: pointer; } .pv-android-button:active { background: var(--pressed) !important; }',
      outputs: [xml(drawable, 'Drawable', `${name}.xml`), xml(layout, 'Layout')],
    };
  },
});
