import { fadeAlpha } from '../../lib/pixels';
import { defineImageTool, type Values } from '../types';
import { transformPixels } from './_shared';

export default defineImageTool({
  controls: [
    {
      key: 'kind',
      label: 'Fade',
      type: 'segmented',
      choices: [
        { value: 'linear', label: 'Along a line' },
        { value: 'radial', label: 'From a point' },
        { value: 'solid', label: 'Evenly' },
      ],
      default: 'linear',
    },
    { key: 'angle', label: 'Direction', type: 'range', min: 0, max: 360, step: 1, unit: '°', default: 180, showIf: (v: Values) => v.kind === 'linear', help: '180° fades towards the bottom.' },
    { key: 'centerX', label: 'Centre X', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50, showIf: (v: Values) => v.kind === 'radial' },
    { key: 'centerY', label: 'Centre Y', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50, showIf: (v: Values) => v.kind === 'radial' },
    { key: 'from', label: 'Opacity at the start', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 100 },
    { key: 'to', label: 'Opacity at the end', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 0, showIf: (v: Values) => v.kind !== 'solid' },
    { key: 'start', label: 'Fade begins at', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 40, showIf: (v: Values) => v.kind !== 'solid' },
    { key: 'end', label: 'Fade ends at', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 100, showIf: (v: Values) => v.kind !== 'solid' },
  ],
  formats: ['png', 'webp', 'avif'],
  process(source, v) {
    return {
      outputs: [{ canvas: transformPixels(source, (pixels, width, height) => fadeAlpha(pixels, width, height, v as Parameters<typeof fadeAlpha>[3])) }],
      info: 'Transparency is kept in PNG, WebP and AVIF.',
    };
  },
});
