import { ToolError } from '../../lib/errors';
import { context2d, createCanvas } from '../../ui/canvas';
import { defineImageTool, type Values } from '../types';

const byPixels = (v: Values) => v.mode === 'pixels';

export default defineImageTool({
  controls: [
    {
      key: 'mode',
      label: 'Resize by',
      type: 'segmented',
      choices: [
        { value: 'percent', label: 'Percentage' },
        { value: 'pixels', label: 'Pixels' },
      ],
      default: 'percent',
    },
    { key: 'percent', label: 'Scale', type: 'range', min: 1, max: 400, step: 1, unit: '%', default: 50, showIf: (v: Values) => v.mode === 'percent' },
    { key: 'width', label: 'Width', type: 'number', min: 0, max: 16384, step: 1, unit: 'px', default: 1280, showIf: byPixels, help: '0 means "work it out from the height".' },
    { key: 'height', label: 'Height', type: 'number', min: 0, max: 16384, step: 1, unit: 'px', default: 0, showIf: byPixels, help: '0 means "work it out from the width".' },
    {
      key: 'fit',
      label: 'When both are set',
      type: 'select',
      choices: [
        { value: 'stretch', label: 'Stretch to exactly that size' },
        { value: 'contain', label: 'Fit inside, keep proportions' },
        { value: 'cover', label: 'Fill and crop, keep proportions' },
      ],
      default: 'contain',
      showIf: byPixels,
    },
    {
      key: 'smoothing',
      label: 'Quality',
      type: 'select',
      choices: [
        { value: 'high', label: 'Smooth (photos)' },
        { value: 'pixelated', label: 'Hard edges (pixel art)' },
      ],
      default: 'high',
    },
  ],
  process(source, v, env) {
    const fullWidth = source.width / env.scale;
    const fullHeight = source.height / env.scale;
    let width: number;
    let height: number;
    let crop = { sx: 0, sy: 0, sw: source.width, sh: source.height };
    if (v.mode === 'percent') {
      width = (fullWidth * v.percent) / 100;
      height = (fullHeight * v.percent) / 100;
    } else {
      if (v.width <= 0 && v.height <= 0) throw new ToolError('Enter a width, a height or both.');
      if (v.width > 0 && v.height > 0) {
        width = v.width;
        height = v.height;
        if (v.fit !== 'stretch') {
          const scale = v.fit === 'contain' ? Math.min(v.width / fullWidth, v.height / fullHeight) : Math.max(v.width / fullWidth, v.height / fullHeight);
          if (v.fit === 'contain') {
            width = fullWidth * scale;
            height = fullHeight * scale;
          } else {
            const sw = (v.width / scale) * env.scale;
            const sh = (v.height / scale) * env.scale;
            crop = { sx: (source.width - sw) / 2, sy: (source.height - sh) / 2, sw, sh };
          }
        }
      } else if (v.width > 0) {
        width = v.width;
        height = (fullHeight * v.width) / fullWidth;
      } else {
        height = v.height;
        width = (fullWidth * v.height) / fullHeight;
      }
    }
    const targetWidth = Math.max(1, Math.round(width));
    const targetHeight = Math.max(1, Math.round(height));
    // Previews work on a reduced copy, so draw at the same reduction.
    const canvas = createCanvas(Math.max(1, Math.round(targetWidth * env.scale)), Math.max(1, Math.round(targetHeight * env.scale)));
    const context = context2d(canvas);
    context.imageSmoothingEnabled = v.smoothing !== 'pixelated';
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
    return { outputs: [{ label: `${targetWidth} × ${targetHeight} px`, canvas }], info: `${Math.round(fullWidth)} × ${Math.round(fullHeight)} px becomes ${targetWidth} × ${targetHeight} px.` };
  },
});
