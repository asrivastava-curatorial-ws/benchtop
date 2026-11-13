import { rgbaString, trimNumber } from '../../lib/color';
import { blobPath } from '../../lib/geometry';
import { defineVisualTool, type Values } from '../types';
import { css, rule, svgDataUri, svgDownload, svgPngDownload, xml } from './_shared';

const gradient = (v: Values) => v.fillType === 'gradient';

const controls = [
  { key: 'seed', label: 'Shape number', type: 'number', min: 1, max: 999999, step: 1, default: 2604 },
  { key: 'points', label: 'Complexity', type: 'range', min: 3, max: 14, step: 1, default: 7 },
  { key: 'randomness', label: 'Randomness', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 55 },
  { key: 'size', label: 'Size', type: 'range', min: 64, max: 1024, step: 8, unit: 'px', default: 400 },
  { key: 'fillType', label: 'Fill', type: 'segmented', choices: ['solid', 'gradient', 'outline'], default: 'gradient' },
  { key: 'color', label: 'Colour', type: 'color', alpha: true, default: '#17694e' },
  { key: 'color2', label: 'Second colour', type: 'color', alpha: true, default: '#c8962e', showIf: gradient },
  { key: 'stroke', label: 'Outline width', type: 'range', min: 1, max: 24, step: 1, unit: 'px', default: 4, showIf: (v: Values) => v.fillType === 'outline' },
  { key: 'animate', label: 'Morph', type: 'toggle', default: false, help: 'Morphs between this shape and the next shape number.' },
  { key: 'duration', label: 'Morph duration', type: 'range', min: 1, max: 20, step: 0.5, unit: 's', default: 6, showIf: (v: Values) => v.animate === true },
] as const;

export function blobSvg(v: {
  seed: number;
  points: number;
  randomness: number;
  size: number;
  fillType: string;
  color: string;
  color2: string;
  stroke: number;
  animate: boolean;
  duration: number;
}): string {
  const size = Math.round(v.size);
  const d = blobPath(Math.round(v.seed), Math.round(v.points), v.randomness / 100, size);
  const outline = v.fillType === 'outline';
  const defs =
    v.fillType === 'gradient'
      ? `  <defs>\n    <linearGradient id="blob-fill" x1="0" y1="0" x2="1" y2="1">\n      <stop offset="0" stop-color="${rgbaString(v.color)}"/>\n      <stop offset="1" stop-color="${rgbaString(v.color2)}"/>\n    </linearGradient>\n  </defs>\n`
      : '';
  const paint = outline
    ? `fill="none" stroke="${rgbaString(v.color)}" stroke-width="${v.stroke}" stroke-linejoin="round"`
    : `fill="${v.fillType === 'gradient' ? 'url(#blob-fill)' : rgbaString(v.color)}"`;
  // Shapes with the same number of points share a path structure, so SVG can morph between them.
  const next = blobPath(Math.round(v.seed) + 1, Math.round(v.points), v.randomness / 100, size);
  const animation = v.animate
    ? `\n    <animate attributeName="d" dur="${trimNumber(v.duration, 2)}s" repeatCount="indefinite" values="${d};${next};${d}" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>\n  `
    : '';
  // Outlines need room for the stroke inside the viewBox.
  const pad = outline ? Math.ceil(v.stroke / 2) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}">\n${defs}  <path ${paint} d="${d}">${animation}</path>\n</svg>\n`;
}

export default defineVisualTool({
  controls,
  randomize: () => ({ seed: 1 + Math.floor(Math.random() * 999998) }),
  render(v) {
    const svg = blobSvg(v);
    const size = Math.round(v.size);
    const clipPath = `path("${blobPath(Math.round(v.seed), Math.round(v.points), v.randomness / 100, size)}")`;
    return {
      preview: <img class="pv-blob" src={svgDataUri(svg)} alt="Generated blob" width={size} height={size} />,
      css: '.pv-blob { max-width: min(100%, 440px); height: auto; }',
      outputs: [
        xml(svg, 'SVG', 'blob.svg'),
        css(
          `${rule('.blob', [
            ['width', `${size}px`],
            ['height', `${size}px`],
            ['background', 'linear-gradient(135deg, #17694e, #c8962e)'],
            ['clip-path', clipPath],
          ])}\n/* Or as a background image: */\n${rule('.blob-background', [['background', `url("${svgDataUri(svg.replace(/\n\s*/g, ' '))}") center / contain no-repeat`]])}`,
        ),
      ],
      downloads: [svgDownload(() => svg, `blob-${v.seed}.svg`), svgPngDownload(() => svg.replace(/<animate[^>]*\/>/, ''), size * 2, size * 2, `blob-${v.seed}.png`, `PNG ${size * 2} px`)],
      note: v.animate ? 'The morph uses SVG animation, which plays when the SVG is used inline or as an image.' : `Shape number ${v.seed}: the same number always gives the same shape.`,
    };
  },
});
