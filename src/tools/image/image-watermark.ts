import { context2d } from '../../ui/canvas';
import { defineImageTool, type Values } from '../types';
import { copyCanvas } from './_shared';
import { FONTS, fontFor, hexToRgba, ready } from './_text';

export default defineImageTool({
  controls: [
    { key: 'text', label: 'Text', type: 'text', default: '© Your name' },
    { key: 'font', label: 'Font', type: 'select', choices: FONTS, default: 'sans' },
    { key: 'bold', label: 'Bold', type: 'toggle', default: true },
    { key: 'size', label: 'Size', type: 'range', min: 1, max: 30, step: 0.5, unit: '% of width', default: 5 },
    { key: 'colour', label: 'Colour', type: 'color', default: '#ffffff' },
    { key: 'opacity', label: 'Opacity', type: 'range', min: 5, max: 100, step: 1, unit: '%', default: 55 },
    {
      key: 'position',
      label: 'Position',
      type: 'select',
      choices: [
        { value: 'bottom-right', label: 'Bottom right' },
        { value: 'bottom-left', label: 'Bottom left' },
        { value: 'bottom-center', label: 'Bottom centre' },
        { value: 'top-right', label: 'Top right' },
        { value: 'top-left', label: 'Top left' },
        { value: 'center', label: 'Centre' },
        { value: 'tiled', label: 'Repeated across the picture' },
      ],
      default: 'bottom-right',
    },
    { key: 'angle', label: 'Angle', type: 'range', min: -90, max: 90, step: 1, unit: '°', default: 0, help: 'Tilt, for example −30° for a diagonal repeated watermark.' },
    { key: 'margin', label: 'Margin', type: 'range', min: 0, max: 20, step: 0.5, unit: '%', default: 3, showIf: (v: Values) => v.position !== 'tiled' && v.position !== 'center' },
    { key: 'spacing', label: 'Spacing', type: 'range', min: 50, max: 400, step: 10, unit: '%', default: 120, showIf: (v: Values) => v.position === 'tiled' },
    { key: 'shadow', label: 'Shadow for legibility', type: 'toggle', default: true },
  ],
  async process(source, v) {
    const canvas = copyCanvas(source);
    const text = v.text.trim();
    if (!text) return { outputs: [{ canvas }], info: 'Type the watermark text.' };
    const context = context2d(canvas);
    const size = (canvas.width * v.size) / 100;
    const font = fontFor(v.font, v.bold ? 700 : 400, size);
    await ready(font);
    context.font = font;
    context.fillStyle = hexToRgba(v.colour, v.opacity / 100);
    context.textBaseline = 'middle';
    if (v.shadow) {
      context.shadowColor = `rgba(0, 0, 0, ${0.45 * (v.opacity / 100)})`;
      context.shadowBlur = size * 0.12;
      context.shadowOffsetY = size * 0.04;
    }
    const width = context.measureText(text).width;
    const draw = (cx: number, cy: number) => {
      context.save();
      context.translate(cx, cy);
      context.rotate((-v.angle * Math.PI) / 180);
      context.textAlign = 'center';
      context.fillText(text, 0, 0);
      context.restore();
    };
    if (v.position === 'tiled') {
      const stepX = width * (v.spacing / 100) + size;
      const stepY = size * 2.2 * (v.spacing / 100);
      const diagonal = Math.hypot(canvas.width, canvas.height);
      context.save();
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((-v.angle * Math.PI) / 180);
      context.textAlign = 'center';
      let row = 0;
      for (let y = -diagonal / 2; y <= diagonal / 2; y += stepY, row++) for (let x = -diagonal / 2 + (row % 2 ? stepX / 2 : 0); x <= diagonal / 2; x += stepX) context.fillText(text, x, y);
      context.restore();
    } else if (v.position === 'center') {
      draw(canvas.width / 2, canvas.height / 2);
    } else {
      const margin = (Math.min(canvas.width, canvas.height) * v.margin) / 100;
      const [vertical, horizontal] = v.position.split('-');
      // Room for the rotated text box, so tilted text stays inside the picture.
      const a = (Math.abs(v.angle) * Math.PI) / 180;
      const boxW = width * Math.cos(a) + size * Math.sin(a);
      const boxH = width * Math.sin(a) + size * Math.cos(a);
      const cx = horizontal === 'left' ? margin + boxW / 2 : horizontal === 'right' ? canvas.width - margin - boxW / 2 : canvas.width / 2;
      const cy = vertical === 'top' ? margin + boxH / 2 : canvas.height - margin - boxH / 2;
      draw(cx, cy);
    }
    return { outputs: [{ canvas }] };
  },
});
