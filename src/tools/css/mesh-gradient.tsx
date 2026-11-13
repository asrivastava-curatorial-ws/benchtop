import { rgbaString, toRgba, trimNumber, withAlpha } from '../../lib/color';
import { radialGradientRadii } from '../../lib/geometry';
import { defineVisualTool } from '../types';
import { arbitrary, canvasPngDownload, color, css, rule, svgDownload, xml } from './_shared';

const POINT = [
  { key: 'color', label: 'Colour', type: 'color', alpha: true, default: '#f472b6' },
  { key: 'x', label: 'X', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
  { key: 'y', label: 'Y', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
  { key: 'size', label: 'Spread', type: 'range', min: 10, max: 120, step: 1, unit: '%', default: 60 },
] as const;

const controls = [
  { key: 'base', label: 'Base colour', type: 'color', default: '#0f172a' },
  {
    key: 'points',
    label: 'Colour points',
    type: 'list',
    item: POINT,
    min: 1,
    max: 10,
    itemLabel: 'Point',
    default: [
      { color: '#6366f1', x: 15, y: 20, size: 55 },
      { color: '#ec4899', x: 85, y: 15, size: 50 },
      { color: '#22d3ee', x: 70, y: 85, size: 60 },
      { color: '#f59e0b', x: 20, y: 90, size: 45 },
    ],
  },
  { key: 'grain', label: 'Grain', type: 'toggle', default: false, help: 'Adds subtle noise (an embedded SVG filter) to reduce colour banding.' },
  { key: 'width', label: 'Image width', type: 'number', min: 1, max: 8192, step: 1, unit: 'px', default: 1600 },
  { key: 'height', label: 'Image height', type: 'number', min: 1, max: 8192, step: 1, unit: 'px', default: 1000 },
] as const;

interface Point {
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 .09 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

function layers(points: readonly Point[]): string[] {
  return points.map((p) => `radial-gradient(at ${trimNumber(p.x, 2)}% ${trimNumber(p.y, 2)}%, ${color(p.color)} 0, ${color(withAlpha(p.color, 0))} ${trimNumber(p.size, 2)}%)`);
}

function svgCode(base: string, points: readonly Point[], width: number, height: number): string {
  const defs = points
    .map((p, i) => {
      const c = toRgba(p.color);
      const rgb = `rgb(${c.r}, ${c.g}, ${c.b})`;
      const cx = (p.x / 100) * width;
      const cy = (p.y / 100) * height;
      // Same geometry as CSS: an ellipse reaching the farthest corner, cut at the spread percentage.
      const { rx, ry } = radialGradientRadii(cx, cy, width, height, false);
      const r = (rx * p.size) / 100;
      const transform =
        rx !== ry ? ` gradientTransform="translate(${trimNumber(cx, 2)} ${trimNumber(cy, 2)}) scale(1 ${trimNumber(ry / rx, 5)}) translate(${trimNumber(-cx, 2)} ${trimNumber(-cy, 2)})"` : '';
      return `    <radialGradient id="p${i}" gradientUnits="userSpaceOnUse" cx="${trimNumber(cx, 2)}" cy="${trimNumber(cy, 2)}" r="${trimNumber(r, 2)}"${transform}>\n      <stop offset="0" stop-color="${rgb}" stop-opacity="${trimNumber(c.a, 3)}"/>\n      <stop offset="1" stop-color="${rgb}" stop-opacity="0"/>\n    </radialGradient>`;
    })
    .join('\n');
  // CSS paints the first layer on top, so SVG lists them in reverse.
  const rects = points.map((_, i) => `  <rect width="100%" height="100%" fill="url(#p${points.length - 1 - i})"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <defs>\n${defs}\n  </defs>\n  <rect width="100%" height="100%" fill="${rgbaString(base)}"/>\n${rects}\n</svg>\n`;
}

function draw(base: string, points: readonly Point[], context: CanvasRenderingContext2D, width: number, height: number): void {
  context.fillStyle = rgbaString(base);
  context.fillRect(0, 0, width, height);
  for (const p of [...points].reverse()) {
    const cx = (p.x / 100) * width;
    const cy = (p.y / 100) * height;
    const { rx, ry } = radialGradientRadii(cx, cy, width, height, false);
    const r = (rx * p.size) / 100;
    context.save();
    context.translate(cx, cy);
    context.scale(1, ry / rx);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, r);
    gradient.addColorStop(0, rgbaString(p.color));
    gradient.addColorStop(1, rgbaString(withAlpha(p.color, 0)));
    context.fillStyle = gradient;
    const reach = (width + height) * (rx / Math.min(rx, ry)) * 2;
    context.fillRect(-reach, -reach, reach * 2, reach * 2);
    context.restore();
  }
}

export default defineVisualTool({
  controls,
  presets: [
    {
      name: 'Aurora',
      values: {
        base: '#020617',
        points: [
          { color: '#22c55e', x: 20, y: 30, size: 50 },
          { color: '#06b6d4', x: 60, y: 10, size: 55 },
          { color: '#a855f7', x: 85, y: 60, size: 50 },
        ],
      },
    },
    {
      name: 'Peach',
      values: {
        base: '#fff7ed',
        points: [
          { color: '#fdba74', x: 10, y: 10, size: 60 },
          { color: '#f9a8d4', x: 90, y: 20, size: 55 },
          { color: '#fde68a', x: 50, y: 95, size: 60 },
        ],
      },
    },
    {
      name: 'Deep sea',
      values: {
        base: '#082f49',
        points: [
          { color: '#0ea5e9', x: 0, y: 0, size: 70 },
          { color: '#1e3a8a', x: 100, y: 100, size: 70 },
          { color: '#14b8a6', x: 70, y: 30, size: 40 },
        ],
      },
    },
  ],
  randomize(values) {
    const count = Math.max(1, (values.points as readonly unknown[]).length);
    const hue = Math.random() * 360;
    return {
      points: Array.from({ length: count }, (_, i) => ({
        color: `oklch(${trimNumber(0.6 + Math.random() * 0.25, 3)} ${trimNumber(0.15 + Math.random() * 0.1, 3)} ${trimNumber((hue + i * 70) % 360, 1)})`,
        x: Math.round(Math.random() * 100),
        y: Math.round(Math.random() * 100),
        size: 35 + Math.round(Math.random() * 40),
      })),
    };
  },
  render(v) {
    const points = v.points as readonly Point[];
    const images = [...(v.grain ? [GRAIN] : []), ...layers(points)];
    const declarations = [
      ['background-color', color(v.base)],
      ['background-image', images.join(',\n    ')],
    ] as const;
    const width = Math.max(1, Math.round(v.width));
    const height = Math.max(1, Math.round(v.height));
    const svg = svgCode(v.base, points, width, height);
    const style = `background-color: ${color(v.base)}; background-image: ${images.join(', ')}; aspect-ratio: ${width} / ${height};`;
    return {
      preview: <div class="pv-fill" style={style} />,
      css: '.pv-fill { width: min(100%, 560px); border-radius: 6px; }',
      outputs: [
        css(rule('.mesh', declarations)),
        { label: 'Tailwind', language: 'html', code: `<div class="bg-${arbitrary(color(v.base))} bg-${arbitrary(layers(points).join(','))}"></div>\n` },
        xml(svg, 'SVG', 'mesh-gradient.svg'),
      ],
      downloads: [
        canvasPngDownload((context, w, h) => draw(v.base, points, context, w, h), width, height, 'mesh-gradient.png', `PNG ${width} × ${height}`),
        svgDownload(() => svg, 'mesh-gradient.svg'),
      ],
      note: v.grain ? 'Grain is included in the CSS only.' : undefined,
    };
  },
});
