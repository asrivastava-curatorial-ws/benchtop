import { context2d, createCanvas } from '../../ui/canvas';
import { defineImageTool, type Values } from '../types';

export default defineImageTool({
  controls: [
    { key: 'angle', label: 'Angle', type: 'range', min: -180, max: 180, step: 1, unit: '°', default: 90 },
    { key: 'flipH', label: 'Flip horizontally', type: 'toggle', default: false },
    { key: 'flipV', label: 'Flip vertically', type: 'toggle', default: false },
    {
      key: 'fit',
      label: 'Canvas',
      type: 'segmented',
      choices: [
        { value: 'expand', label: 'Grow to fit' },
        { value: 'keep', label: 'Keep size' },
      ],
      default: 'expand',
      showIf: (v: Values) => Number(v.angle) % 90 !== 0,
    },
    { key: 'background', label: 'Fill corners with', type: 'color', alpha: true, default: '#00000000', showIf: (v: Values) => Number(v.angle) % 90 !== 0 },
  ],
  presets: [
    { name: 'Left 90°', values: { angle: -90, flipH: false, flipV: false } },
    { name: 'Right 90°', values: { angle: 90, flipH: false, flipV: false } },
    { name: '180°', values: { angle: 180, flipH: false, flipV: false } },
    { name: 'Mirror', values: { angle: 0, flipH: true, flipV: false } },
  ],
  process(source, v) {
    const radians = (v.angle * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const square = v.angle % 90 === 0;
    const expand = square || v.fit === 'expand';
    const width = expand ? Math.round(source.width * cos + source.height * sin) : source.width;
    const height = expand ? Math.round(source.width * sin + source.height * cos) : source.height;
    const canvas = createCanvas(width, height);
    const context = context2d(canvas);
    if (!square) {
      context.fillStyle = v.background;
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingQuality = 'high';
    context.translate(width / 2, height / 2);
    context.rotate(radians);
    context.scale(v.flipH ? -1 : 1, v.flipV ? -1 : 1);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    return { outputs: [{ canvas }] };
  },
});
