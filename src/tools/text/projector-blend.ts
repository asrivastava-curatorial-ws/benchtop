import { ToolError } from '../../lib/errors';
import { blend, formatLength, type LengthUnit, RESOLUTIONS, round, toMetres } from '../../lib/projection';
import { defineTextTool, type Field } from '../types';
import { UNITS } from './projector-calculator';

function layoutSvg(columns: number, rows: number, overlapX: number, overlapY: number): string {
  const unitW = 120;
  const unitH = unitW / (16 / 9);
  const stepX = unitW * (1 - overlapX);
  const stepY = unitH * (1 - overlapY);
  const width = stepX * (columns - 1) + unitW;
  const height = stepY * (rows - 1) + unitH;
  const pad = 16;
  const colours = ['#2f81f7', '#3fb950', '#d29922', '#db61a2', '#a371f7', '#39c5cf'];
  let shapes = '';
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const colour = colours[(row * columns + column) % colours.length] as string;
      shapes += `<rect x="${(pad + column * stepX).toFixed(1)}" y="${(pad + row * stepY).toFixed(1)}" width="${unitW}" height="${unitH.toFixed(1)}" fill="${colour}" fill-opacity="0.22" stroke="${colour}" stroke-width="1.5"/>`;
      shapes += `<text x="${(pad + column * stepX + unitW / 2).toFixed(1)}" y="${(pad + row * stepY + unitH / 2 + 4).toFixed(1)}" text-anchor="middle" fill="#c9d1d9" font-size="12" font-family="JetBrains Mono, monospace">P${row * columns + column + 1}</text>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${(width + pad * 2).toFixed(1)} ${(height + pad * 2).toFixed(1)}" width="${Math.round((width + pad * 2) * 2)}" height="${Math.round((height + pad * 2) * 2)}"><rect width="100%" height="100%" rx="8" fill="#0d1117" stroke="#30363d"/>${shapes}</svg>`;
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'unit', label: 'Units', type: 'select', choices: UNITS, default: 'm' },
    { key: 'columns', label: 'Projectors across', type: 'number', default: 3, min: 1, max: 20, step: 1 },
    { key: 'rows', label: 'Projectors down', type: 'number', default: 1, min: 1, max: 10, step: 1 },
    { key: 'resolution', label: 'Projector resolution', type: 'select', choices: Object.keys(RESOLUTIONS), default: '1920x1200' },
    { key: 'overlapX', label: 'Horizontal overlap', type: 'number', default: 15, min: 0, max: 50, step: 1, unit: '%', help: '10–25% of one image is usual for soft-edge blending.' },
    { key: 'overlapY', label: 'Vertical overlap', type: 'number', default: 15, min: 0, max: 50, step: 1, unit: '%' },
    { key: 'canvasWidth', label: 'Total image width', type: 'number', default: 12, min: 0.1, max: 100000, step: 0.1 },
    { key: 'throwRatio', label: 'Throw ratio', type: 'number', default: 1.2, min: 0.1, max: 20, step: 0.01 },
    { key: 'lumens', label: 'Brightness per projector', type: 'number', default: 7000, min: 100, max: 100000, step: 100, unit: 'lm' },
    { key: 'gain', label: 'Surface gain', type: 'number', default: 1, min: 0.3, max: 3, step: 0.1 },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const unit = o.unit as LengthUnit;
    const [pixelsX, pixelsY] = RESOLUTIONS[o.resolution] ?? [1920, 1200];
    if (o.columns < 1 || o.rows < 1) throw new ToolError('Use at least one projector in each direction.');
    const result = blend({ columns: o.columns, rows: o.rows, overlapX: o.overlapX / 100, overlapY: o.overlapY / 100, pixelsX, pixelsY });
    const canvasWidth = toMetres(o.canvasWidth, unit);
    const imageWidth = canvasWidth / result.widthFactor;
    const imageHeight = imageWidth / (pixelsX / pixelsY);
    const canvasHeight = imageHeight * result.heightFactor;
    const fmt = (metres: number) => formatLength(metres, unit);
    // Overlap zones get light from two (or four) projectors, but blending ramps each down, so the average is one projector's worth.
    const fl = (o.lumens * o.gain) / (imageWidth * imageHeight * 10.7639);
    const fields: Field[] = [
      { label: 'Canvas', value: '' },
      { label: 'Resolution', value: `${result.canvasPixelsX} × ${result.canvasPixelsY} px`, mono: true, tone: 'ok' },
      { label: 'Aspect ratio', value: `${round(result.canvasPixelsX / result.canvasPixelsY, 3)}:1`, mono: true },
      { label: 'Size', value: `${fmt(canvasWidth)} × ${fmt(canvasHeight)}`, mono: true },
      { label: 'Pixel pitch', value: `${round((canvasWidth / result.canvasPixelsX) * 1000, 2)} mm`, mono: true },
      { label: 'Each projector', value: '' },
      { label: 'Image size', value: `${fmt(imageWidth)} × ${fmt(imageHeight)}`, mono: true },
      { label: 'Throw distance', value: fmt(imageWidth * o.throwRatio), mono: true },
      { label: 'Spacing between projectors', value: `${fmt(imageWidth * (1 - o.overlapX / 100))} across${o.rows > 1 ? `, ${fmt(imageHeight * (1 - o.overlapY / 100))} down` : ''}`, mono: true },
      { label: 'Blend zone', value: '' },
      { label: 'Overlap width', value: o.columns > 1 ? `${result.overlapPixelsX} px, ${fmt(imageWidth * (o.overlapX / 100))}` : 'none', mono: true },
      { label: 'Overlap height', value: o.rows > 1 ? `${result.overlapPixelsY} px, ${fmt(imageHeight * (o.overlapY / 100))}` : 'none', mono: true },
      { label: 'Luminance', value: `${round(fl, 1)} fL, ${Math.round(fl * 3.426)} nits`, mono: true },
      { label: 'Projectors', value: String(o.columns * o.rows) },
    ];
    return {
      fields,
      preview: { kind: 'svg', svg: layoutSvg(o.columns, o.rows, o.overlapX / 100, o.overlapY / 100) },
      info: 'Assumes identical projectors in a regular grid. The blend software sets the exact overlap in pixels.',
      filename: 'blend-layout.svg',
    };
  },
});
