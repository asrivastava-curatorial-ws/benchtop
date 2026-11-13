import { rgbaString, trimNumber } from '../../lib/color';
import { radialGradientRadii, sunburstPath } from '../../lib/geometry';
import { defineVisualTool } from '../types';
import { color, css, rule, svgDataUri, svgDownload, svgPngDownload, xml } from './_shared';

const controls = [
  { key: 'rays', label: 'Rays', type: 'range', min: 6, max: 72, step: 2, default: 24, help: 'Always even, so light and dark rays alternate evenly.' },
  { key: 'color1', label: 'Ray colour', type: 'color', alpha: true, default: '#f59e0b' },
  { key: 'color2', label: 'Gap colour', type: 'color', alpha: true, default: '#fbbf24' },
  { key: 'rotation', label: 'Rotation', type: 'range', min: 0, max: 360, step: 1, unit: '°', default: 0 },
  { key: 'x', label: 'Centre X', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
  { key: 'y', label: 'Centre Y', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 60 },
  { key: 'vignette', label: 'Fade the edges', type: 'toggle', default: true },
  { key: 'width', label: 'Image width', type: 'number', min: 16, max: 8192, step: 1, unit: 'px', default: 1600 },
  { key: 'height', label: 'Image height', type: 'number', min: 16, max: 8192, step: 1, unit: 'px', default: 900 },
] as const;

export default defineVisualTool({
  controls,
  presets: [
    { name: 'Retro', values: { color1: '#f59e0b', color2: '#fbbf24', rays: 24, vignette: true } },
    { name: 'Comic', values: { color1: '#dc2626', color2: '#facc15', rays: 32, vignette: false } },
    { name: 'Calm', values: { color1: '#bae6fd', color2: '#e0f2fe', rays: 16, vignette: true } },
    { name: 'Night', values: { color1: '#1e1b4b', color2: '#312e81', rays: 40, vignette: true } },
  ],
  render(v) {
    const rays = Math.max(2, Math.round(v.rays / 2) * 2);
    const step = 360 / rays;
    const c1 = color(v.color1);
    const c2 = color(v.color2);
    const at = `at ${v.x}% ${v.y}%`;
    const layers = [`repeating-conic-gradient(from ${trimNumber(v.rotation, 2)}deg ${at}, ${c1} 0deg ${trimNumber(step, 4)}deg, ${c2} ${trimNumber(step, 4)}deg ${trimNumber(step * 2, 4)}deg)`];
    if (v.vignette) layers.unshift(`radial-gradient(circle ${at}, transparent 30%, rgb(0 0 0 / 0.35))`);
    const width = Math.round(v.width);
    const height = Math.round(v.height);
    const cx = (v.x / 100) * width;
    const cy = (v.y / 100) * height;
    const { rx } = radialGradientRadii(cx, cy, width, height, true);
    const vignette = v.vignette
      ? `\n  <defs>\n    <radialGradient id="v" gradientUnits="userSpaceOnUse" cx="${trimNumber(cx, 2)}" cy="${trimNumber(cy, 2)}" r="${trimNumber(rx, 2)}">\n      <stop offset="0.3" stop-color="#000" stop-opacity="0"/>\n      <stop offset="1" stop-color="#000" stop-opacity="0.35"/>\n    </radialGradient>\n  </defs>`
      : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${vignette}\n  <rect width="100%" height="100%" fill="${rgbaString(v.color2)}"/>\n  <path fill="${rgbaString(v.color1)}" d="${sunburstPath(rays, cx, cy, Math.hypot(width, height), v.rotation)}"/>${v.vignette ? '\n  <rect width="100%" height="100%" fill="url(#v)"/>' : ''}\n</svg>\n`;
    return {
      preview: <div class="pv-fill" style={`background: ${layers.join(', ')}; aspect-ratio: ${width} / ${height};`} />,
      css: '.pv-fill { width: min(100%, 560px); border-radius: 6px; }',
      outputs: [
        css(rule('.sunburst', [['background', layers.join(',\n    ')]])),
        xml(svg, 'SVG', 'sunburst.svg'),
        css(rule('.sunburst', [['background', `url("${svgDataUri(svg)}") center / cover`]]), 'CSS with SVG'),
      ],
      downloads: [svgPngDownload(() => svg, width, height, 'sunburst.png', `PNG ${width} × ${height}`), svgDownload(() => svg, 'sunburst.svg')],
    };
  },
});
