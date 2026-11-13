import { defineVisualTool } from '../types';
import { arbitrary, color, css, px, rule, SAMPLE_SCENE, svgDataUri, tailwind } from './_shared';

const controls = [
  {
    key: 'target',
    label: 'Apply as',
    type: 'segmented',
    choices: [
      { value: 'filter', label: 'filter' },
      { value: 'backdrop', label: 'backdrop-filter' },
    ],
    default: 'filter',
  },
  { key: 'blur', label: 'Blur', type: 'range', min: 0, max: 30, step: 0.5, unit: 'px', default: 0 },
  { key: 'brightness', label: 'Brightness', type: 'range', min: 0, max: 300, step: 1, unit: '%', default: 100 },
  { key: 'contrast', label: 'Contrast', type: 'range', min: 0, max: 300, step: 1, unit: '%', default: 100 },
  { key: 'saturate', label: 'Saturation', type: 'range', min: 0, max: 300, step: 1, unit: '%', default: 100 },
  { key: 'grayscale', label: 'Greyscale', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 0 },
  { key: 'sepia', label: 'Sepia', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 0 },
  { key: 'hue', label: 'Hue rotate', type: 'range', min: 0, max: 360, step: 1, unit: '°', default: 0 },
  { key: 'invert', label: 'Invert', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 0 },
  { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 100 },
  { key: 'shadow', label: 'Drop shadow', type: 'toggle', default: false },
  { key: 'shadowColor', label: 'Shadow colour', type: 'color', alpha: true, default: '#00000080', showIf: (v: Record<string, unknown>) => v.shadow === true },
  { key: 'shadowBlur', label: 'Shadow blur', type: 'range', min: 0, max: 40, step: 1, unit: 'px', default: 8, showIf: (v: Record<string, unknown>) => v.shadow === true },
  { key: 'shadowY', label: 'Shadow offset', type: 'range', min: -30, max: 30, step: 1, unit: 'px', default: 6, showIf: (v: Record<string, unknown>) => v.shadow === true },
] as const;

interface FilterValues {
  blur: number;
  brightness: number;
  contrast: number;
  saturate: number;
  grayscale: number;
  sepia: number;
  hue: number;
  invert: number;
  opacity: number;
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowY: number;
}

export function filterList(v: FilterValues): { css: string; tailwind: string[] } {
  const parts: string[] = [];
  const tw: string[] = [];
  const add = (fn: string, value: string, twName: string, twValue: string) => {
    parts.push(`${fn}(${value})`);
    tw.push(`${twName}-${arbitrary(twValue)}`);
  };
  if (v.blur > 0) add('blur', px(v.blur), 'blur', px(v.blur));
  if (v.brightness !== 100) add('brightness', `${v.brightness}%`, 'brightness', `${v.brightness / 100}`);
  if (v.contrast !== 100) add('contrast', `${v.contrast}%`, 'contrast', `${v.contrast / 100}`);
  if (v.saturate !== 100) add('saturate', `${v.saturate}%`, 'saturate', `${v.saturate / 100}`);
  if (v.grayscale > 0) add('grayscale', `${v.grayscale}%`, 'grayscale', `${v.grayscale}%`);
  if (v.sepia > 0) add('sepia', `${v.sepia}%`, 'sepia', `${v.sepia}%`);
  if (v.hue > 0) add('hue-rotate', `${v.hue}deg`, 'hue-rotate', `${v.hue}deg`);
  if (v.invert > 0) add('invert', `${v.invert}%`, 'invert', `${v.invert}%`);
  if (v.opacity !== 100) add('opacity', `${v.opacity}%`, 'opacity', `${v.opacity}%`);
  if (v.shadow) {
    const shadow = `0 ${px(v.shadowY)} ${px(v.shadowBlur)} ${color(v.shadowColor)}`;
    parts.push(`drop-shadow(${shadow})`);
    tw.push(`drop-shadow-${arbitrary(shadow)}`);
  }
  return { css: parts.length > 0 ? parts.join(' ') : 'none', tailwind: tw };
}

export default defineVisualTool({
  controls,
  presets: [
    { name: 'None', values: { blur: 0, brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, hue: 0, invert: 0, opacity: 100, shadow: false } },
    { name: 'Vintage', values: { blur: 0, brightness: 105, contrast: 90, saturate: 80, grayscale: 0, sepia: 45, hue: 0, invert: 0 } },
    { name: 'Noir', values: { blur: 0, brightness: 95, contrast: 140, saturate: 100, grayscale: 100, sepia: 0, hue: 0, invert: 0 } },
    { name: 'Vivid', values: { blur: 0, brightness: 105, contrast: 115, saturate: 170, grayscale: 0, sepia: 0, hue: 0, invert: 0 } },
    { name: 'Dark mode image', values: { blur: 0, brightness: 100, contrast: 90, saturate: 100, grayscale: 0, sepia: 0, hue: 180, invert: 100 } },
  ],
  render(v) {
    const list = filterList(v);
    const backdrop = v.target === 'backdrop';
    const property = backdrop ? 'backdrop-filter' : 'filter';
    const scene = svgDataUri(SAMPLE_SCENE);
    return {
      preview: backdrop ? (
        <div class="pv-filter-stage" style={`background: url("${scene}") center / cover;`}>
          <div class="pv-filter-pane" style={`backdrop-filter: ${list.css}; -webkit-backdrop-filter: ${list.css};`}>
            backdrop-filter
          </div>
        </div>
      ) : (
        <div class="pv-filter-pair">
          <figure>
            <img src={scene} alt="Original sample" />
            <figcaption>Original</figcaption>
          </figure>
          <figure>
            <img src={scene} alt="Filtered sample" style={`filter: ${list.css};`} />
            <figcaption>Filtered</figcaption>
          </figure>
        </div>
      ),
      css: '.pv-filter-pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; width: 100%; } .pv-filter-pair figure { margin: 0; } .pv-filter-pair img { width: 100%; display: block; border-radius: 6px; } .pv-filter-pair figcaption { font-size: 12px; color: var(--muted); margin-top: 4px; } .pv-filter-stage { width: 100%; aspect-ratio: 3 / 2; display: grid; place-items: center; border-radius: 6px; } .pv-filter-pane { width: 60%; height: 50%; display: grid; place-items: center; border-radius: 10px; border: 1px solid rgb(255 255 255 / .5); background: rgb(255 255 255 / .1); color: #fff; font: 600 14px var(--font-mono); }',
      outputs: [
        css(
          rule(
            backdrop ? '.panel' : 'img',
            backdrop
              ? [
                  [property, list.css],
                  ['-webkit-backdrop-filter', list.css],
                ]
              : [[property, list.css]],
          ),
        ),
        tailwind(backdrop ? list.tailwind.map((name) => `backdrop-${name.replace(/^drop-shadow-.*/, '')}`).filter((name) => name !== 'backdrop-') : list.tailwind),
      ],
      note: backdrop && v.shadow ? 'drop-shadow() has no effect in backdrop-filter.' : undefined,
    };
  },
});
