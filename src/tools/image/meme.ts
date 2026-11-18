import { context2d, createCanvas } from '../../ui/canvas';
import { defineImageTool, type Values } from '../types';
import { fontFor, ready, wrap } from './_text';

export default defineImageTool({
  controls: [
    { key: 'top', label: 'Top text', type: 'text', default: 'When the build passes', multiline: true },
    { key: 'bottom', label: 'Bottom text', type: 'text', default: 'on the first try', multiline: true },
    {
      key: 'style',
      label: 'Style',
      type: 'segmented',
      choices: [
        { value: 'over', label: 'On the picture' },
        { value: 'bars', label: 'In bars' },
      ],
      default: 'over',
    },
    { key: 'size', label: 'Text size', type: 'range', min: 3, max: 20, step: 0.5, unit: '% of width', default: 9 },
    { key: 'caps', label: 'Capital letters', type: 'toggle', default: true },
    { key: 'colour', label: 'Text colour', type: 'color', default: '#ffffff', showIf: (v: Values) => v.style === 'over' },
    { key: 'outline', label: 'Outline colour', type: 'color', default: '#000000', showIf: (v: Values) => v.style === 'over' },
    { key: 'bar', label: 'Bar colour', type: 'color', default: '#ffffff', showIf: (v: Values) => v.style === 'bars' },
    { key: 'barText', label: 'Bar text colour', type: 'color', default: '#111111', showIf: (v: Values) => v.style === 'bars' },
  ],
  async process(source, v) {
    const size = (source.width * v.size) / 100;
    const font = fontFor('condensed', 700, size);
    await ready(font);
    const measure = context2d(createCanvas(1, 1));
    measure.font = font;
    const maxWidth = source.width * 0.92;
    const lines = (text: string) => (text.trim() ? wrap(measure, v.caps ? text.toUpperCase() : text, maxWidth) : []);
    const top = lines(v.top);
    const bottom = lines(v.bottom);
    const lineHeight = size * 1.08;
    const pad = size * 0.45;
    const topBar = v.style === 'bars' && top.length ? top.length * lineHeight + pad * 2 : 0;
    const bottomBar = v.style === 'bars' && bottom.length ? bottom.length * lineHeight + pad * 2 : 0;
    const canvas = createCanvas(source.width, source.height + topBar + bottomBar);
    const context = context2d(canvas);
    if (v.style === 'bars') {
      context.fillStyle = v.bar;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(source, 0, topBar);
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.lineJoin = 'round';
    const block = (text: string[], y: number) => {
      text.forEach((line, i) => {
        const ly = y + i * lineHeight;
        if (v.style === 'over') {
          context.lineWidth = Math.max(2, size * 0.14);
          context.strokeStyle = v.outline;
          context.strokeText(line, canvas.width / 2, ly);
          context.fillStyle = v.colour;
        } else {
          context.fillStyle = v.barText;
        }
        context.fillText(line, canvas.width / 2, ly);
      });
    };
    if (v.style === 'bars') {
      block(top, pad);
      block(bottom, topBar + source.height + pad);
    } else {
      block(top, size * 0.35);
      block(bottom, canvas.height - size * 0.35 - bottom.length * lineHeight);
    }
    return { outputs: [{ canvas }] };
  },
});
