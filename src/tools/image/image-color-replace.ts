import { toRgba } from '../../lib/color';
import { replaceColor } from '../../lib/pixels';
import { defineImageTool, type Values } from '../types';
import { canvasFrom, readPixels } from './_shared';

export default defineImageTool({
  controls: [
    { key: 'from', label: 'Colour to replace', type: 'color', default: '#ffffff', help: 'Tip: the Image Colour Picker tool finds exact colours in an image.' },
    {
      key: 'action',
      label: 'Replace with',
      type: 'segmented',
      choices: [
        { value: 'color', label: 'A colour' },
        { value: 'transparent', label: 'Transparency' },
      ],
      default: 'color',
    },
    { key: 'to', label: 'New colour', type: 'color', alpha: true, default: '#17694e', showIf: (v: Values) => v.action === 'color' },
    { key: 'swap', label: 'Swap both ways', type: 'toggle', default: false, showIf: (v: Values) => v.action === 'color', help: 'Also turns the new colour into the old one.' },
    { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 12 },
    { key: 'feather', label: 'Soft edge', type: 'range', min: 0, max: 50, step: 1, unit: '%', default: 6 },
  ],
  formats: ['png', 'webp', 'avif', 'jpeg'],
  process(source, v) {
    const to = v.action === 'transparent' ? { r: 0, g: 0, b: 0, a: 0 } : toRgba(v.to);
    const { pixels, changed } = replaceColor(readPixels(source), { from: toRgba(v.from), to, tolerance: v.tolerance, feather: v.feather, swap: v.action === 'color' && v.swap });
    const total = source.width * source.height;
    return {
      outputs: [{ canvas: canvasFrom(pixels, source.width, source.height) }],
      info: `${((changed / total) * 100).toFixed(1)}% of the pixels changed.${v.action === 'transparent' ? ' Save as PNG, WebP or AVIF to keep the transparency.' : ''}`,
    };
  },
});
