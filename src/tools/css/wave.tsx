import { rgbaString, toRgba, trimNumber } from '../../lib/color';
import { wavePath } from '../../lib/geometry';
import { defineVisualTool } from '../types';
import { css, html, rule, svgDataUri, svgDownload, svgPngDownload, xml } from './_shared';

const controls = [
  { key: 'seed', label: 'Wave number', type: 'number', min: 1, max: 999999, step: 1, default: 42 },
  { key: 'layers', label: 'Layers', type: 'range', min: 1, max: 5, step: 1, default: 3 },
  { key: 'height', label: 'Height', type: 'range', min: 40, max: 600, step: 10, unit: 'px', default: 240 },
  { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 45 },
  { key: 'segments', label: 'Complexity', type: 'range', min: 2, max: 20, step: 1, default: 6 },
  {
    key: 'style',
    label: 'Style',
    type: 'segmented',
    choices: [
      { value: 'smooth', label: 'Smooth' },
      { value: 'peaks', label: 'Peaks' },
    ],
    default: 'smooth',
  },
  {
    key: 'position',
    label: 'Position',
    type: 'segmented',
    choices: [
      { value: 'bottom', label: 'Bottom' },
      { value: 'top', label: 'Top' },
    ],
    default: 'bottom',
  },
  { key: 'color', label: 'Colour', type: 'color', default: '#17694e' },
  { key: 'fade', label: 'Fade back layers', type: 'toggle', default: true },
] as const;

const WIDTH = 1440;

export function waveSvg(v: { seed: number; layers: number; height: number; amplitude: number; segments: number; style: string; position: string; color: string; fade: boolean }): string {
  const height = Math.round(v.height);
  const count = Math.round(v.layers);
  const base = toRgba(v.color);
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    // Back layers sit higher and are more transparent.
    const band = height / (count + 1);
    const baseline = band * (i + 1) * 0.9 + band * 0.4;
    const amplitude = (band * v.amplitude) / 100 + 4;
    const opacity = count === 1 || !v.fade ? 1 : 0.35 + (0.65 * (i + 1)) / count;
    const d = wavePath(Math.round(v.seed) + i * 101, WIDTH, height, baseline, amplitude, Math.round(v.segments), v.style === 'smooth');
    paths.push(`  <path fill="rgb(${base.r}, ${base.g}, ${base.b})"${opacity < 1 ? ` fill-opacity="${trimNumber(opacity, 2)}"` : ''} d="${d}"/>`);
  }
  const flip = v.position === 'top' ? ` transform="rotate(180 ${WIDTH / 2} ${height / 2})"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" preserveAspectRatio="none">\n<g${flip}>\n${paths.join('\n')}\n</g>\n</svg>\n`;
}

export default defineVisualTool({
  controls,
  randomize: () => ({ seed: 1 + Math.floor(Math.random() * 999998) }),
  render(v) {
    const svg = waveSvg(v);
    const height = Math.round(v.height);
    const uri = svgDataUri(svg);
    return {
      preview: (
        <div class="pv-wave-section">
          {v.position === 'top' && <img class="pv-wave" src={uri} alt="Wave divider" style={`height: ${height / 2}px;`} />}
          <div class="pv-wave-content">Section content</div>
          {v.position === 'bottom' && <img class="pv-wave" src={uri} alt="Wave divider" style={`height: ${height / 2}px;`} />}
        </div>
      ),
      css: `.pv-wave-section { width: 100%; display: flex; flex-direction: column; border-radius: 6px; overflow: hidden; background: var(--panel); border: 1px solid var(--line); } .pv-wave { display: block; width: 100%; } .pv-wave-content { padding: 48px 24px; text-align: center; color: var(--muted); }`,
      outputs: [
        xml(svg, 'SVG', 'wave.svg'),
        html(`<section class="hero">\n  <!-- content -->\n  <svg class="wave" ${svg.slice(5)}</section>\n`, 'Inline HTML'),
        css(
          `${rule('.wave', [
            ['display', 'block'],
            ['width', '100%'],
            ['height', `${height}px`],
          ])}\n/* Or as a background: */\n${rule('.section', [
            ['background', `url("${uri}") ${v.position} / 100% ${height}px no-repeat`],
            [`padding-${v.position}`, `${height}px`],
          ])}`,
        ),
      ],
      downloads: [svgDownload(() => svg, `wave-${v.seed}.svg`), svgPngDownload(() => svg.replace('preserveAspectRatio="none"', ''), WIDTH, height, `wave-${v.seed}.png`, `PNG ${WIDTH} × ${height}`)],
      note: `Wave colour ${rgbaString(v.color)}. The SVG stretches to any width.`,
    };
  },
});
