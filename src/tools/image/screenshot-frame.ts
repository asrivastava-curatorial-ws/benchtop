import { context2d, createCanvas } from '../../ui/canvas';
import { defineImageTool, type Values } from '../types';
import { fontFor, ready } from './_text';

const GRADIENTS: Record<string, [string, string]> = {
  ocean: ['#2b5876', '#4e9fbd'],
  dawn: ['#f6d365', '#fda085'],
  meadow: ['#56ab2f', '#a8e063'],
  dusk: ['#5f2c82', '#49a09d'],
  slate: ['#1f2933', '#52606d'],
  paper: ['#eef1f4', '#d9dee4'],
};

const RATIOS: Record<string, number> = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16 };

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.roundRect(x, y, w, h, radius);
}

export default defineImageTool({
  controls: [
    {
      key: 'background',
      label: 'Background',
      type: 'select',
      choices: [
        { value: 'ocean', label: 'Ocean gradient' },
        { value: 'dawn', label: 'Dawn gradient' },
        { value: 'meadow', label: 'Meadow gradient' },
        { value: 'dusk', label: 'Dusk gradient' },
        { value: 'slate', label: 'Slate gradient' },
        { value: 'paper', label: 'Paper gradient' },
        { value: 'solid', label: 'Solid colour' },
        { value: 'none', label: 'Transparent' },
      ],
      default: 'ocean',
    },
    { key: 'colour', label: 'Colour', type: 'color', default: '#0b6e4f', showIf: (v: Values) => v.background === 'solid' },
    {
      key: 'frame',
      label: 'Window',
      type: 'segmented',
      choices: [
        { value: 'none', label: 'None' },
        { value: 'window', label: 'App' },
        { value: 'browser', label: 'Browser' },
      ],
      default: 'window',
    },
    { key: 'dark', label: 'Dark window bar', type: 'toggle', default: false, showIf: (v: Values) => v.frame !== 'none' },
    { key: 'address', label: 'Address', type: 'text', default: 'example.org', showIf: (v: Values) => v.frame === 'browser' },
    { key: 'padding', label: 'Space around', type: 'range', min: 0, max: 30, step: 0.5, unit: '%', default: 7 },
    { key: 'radius', label: 'Corner rounding', type: 'range', min: 0, max: 6, step: 0.1, unit: '%', default: 1.2 },
    { key: 'shadow', label: 'Shadow', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 45 },
    {
      key: 'ratio',
      label: 'Shape',
      type: 'select',
      choices: [
        { value: 'auto', label: 'Fit the screenshot' },
        { value: '16:9', label: '16:9 (slides, video)' },
        { value: '4:3', label: '4:3' },
        { value: '1:1', label: 'Square' },
        { value: '4:5', label: '4:5 (social posts)' },
        { value: '9:16', label: '9:16 (stories)' },
      ],
      default: 'auto',
    },
  ],
  formats: ['png', 'webp', 'jpeg', 'avif'],
  async process(source, v) {
    const base = Math.max(source.width, source.height);
    const bar = v.frame === 'none' ? 0 : Math.round(Math.max(22, source.width * 0.035));
    const innerW = source.width;
    const innerH = source.height + bar;
    const pad = (base * v.padding) / 100;
    let width = innerW + pad * 2;
    let height = innerH + pad * 2;
    const ratio = RATIOS[v.ratio];
    if (ratio) {
      if (width / height < ratio) width = height * ratio;
      else height = width / ratio;
    }
    const canvas = createCanvas(width, height);
    const context = context2d(canvas);
    if (v.background === 'solid') {
      context.fillStyle = v.colour;
      context.fillRect(0, 0, canvas.width, canvas.height);
    } else if (v.background !== 'none') {
      const [a, b] = GRADIENTS[v.background] ?? GRADIENTS.ocean;
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, a);
      gradient.addColorStop(1, b);
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    const x = (canvas.width - innerW) / 2;
    const y = (canvas.height - innerH) / 2;
    const radius = (base * v.radius) / 100;
    // Shadow under the window.
    if (v.shadow > 0) {
      context.save();
      context.shadowColor = `rgba(0, 0, 0, ${0.55 * (v.shadow / 100)})`;
      context.shadowBlur = base * 0.04 * (v.shadow / 100) + 4;
      context.shadowOffsetY = base * 0.015 * (v.shadow / 100);
      roundedRect(context, x, y, innerW, innerH, radius);
      context.fillStyle = v.dark ? '#1f2328' : '#ffffff';
      context.fill();
      context.restore();
    }
    context.save();
    roundedRect(context, x, y, innerW, innerH, radius);
    context.clip();
    if (bar) {
      context.fillStyle = v.dark ? '#2d333b' : '#eceff2';
      context.fillRect(x, y, innerW, bar);
      const dot = bar * 0.22;
      ['#ff5f57', '#febc2e', '#28c840'].forEach((fill, i) => {
        context.beginPath();
        context.arc(x + bar * 0.62 + i * dot * 3.1, y + bar / 2, dot, 0, Math.PI * 2);
        context.fillStyle = fill;
        context.fill();
      });
      if (v.frame === 'browser') {
        const fieldX = x + bar * 0.62 + dot * 9 + bar * 0.4;
        const fieldW = Math.min(innerW * 0.6, innerW - (fieldX - x) - bar * 0.6);
        context.fillStyle = v.dark ? '#22272e' : '#ffffff';
        roundedRect(context, fieldX, y + bar * 0.2, fieldW, bar * 0.6, bar * 0.3);
        context.fill();
        const font = fontFor('sans', 400, bar * 0.36);
        await ready(font);
        context.font = font;
        context.fillStyle = v.dark ? '#adbac7' : '#57606a';
        context.textBaseline = 'middle';
        context.fillText(v.address, fieldX + bar * 0.35, y + bar / 2, fieldW - bar * 0.7);
      }
    }
    context.drawImage(source, x, y + bar);
    context.restore();
    return { outputs: [{ canvas }], info: v.background === 'none' ? 'Save as PNG, WebP or AVIF to keep the transparent background.' : undefined };
  },
});
