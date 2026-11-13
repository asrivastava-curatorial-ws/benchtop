import { applyFilters, blur } from '../../lib/pixels';
import { defineImageTool } from '../types';
import { transformPixels } from './_shared';

export default defineImageTool({
  controls: [
    { key: 'brightness', label: 'Brightness', type: 'range', min: 0, max: 200, step: 1, unit: '%', default: 100 },
    { key: 'contrast', label: 'Contrast', type: 'range', min: 0, max: 200, step: 1, unit: '%', default: 100 },
    { key: 'saturation', label: 'Saturation', type: 'range', min: 0, max: 300, step: 1, unit: '%', default: 100 },
    { key: 'grayscale', label: 'Greyscale', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 0 },
    { key: 'sepia', label: 'Sepia', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 0 },
    { key: 'hue', label: 'Hue', type: 'range', min: -180, max: 180, step: 1, unit: '°', default: 0 },
    { key: 'invert', label: 'Invert', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 0 },
    { key: 'blur', label: 'Blur', type: 'range', min: 0, max: 40, step: 0.5, unit: 'px', default: 0 },
  ],
  presets: [
    { name: 'Greyscale', values: { brightness: 100, contrast: 100, saturation: 100, grayscale: 100, sepia: 0, hue: 0, invert: 0, blur: 0 } },
    { name: 'Sepia', values: { brightness: 105, contrast: 95, saturation: 100, grayscale: 0, sepia: 80, hue: 0, invert: 0, blur: 0 } },
    { name: 'High contrast', values: { brightness: 100, contrast: 150, saturation: 110, grayscale: 0, sepia: 0, hue: 0, invert: 0, blur: 0 } },
    { name: 'Faded', values: { brightness: 110, contrast: 80, saturation: 70, grayscale: 0, sepia: 10, hue: 0, invert: 0, blur: 0 } },
    { name: 'Negative', values: { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, hue: 0, invert: 100, blur: 0 } },
  ],
  process(source, v, env) {
    const canvas = transformPixels(source, (pixels, width, height) => {
      const adjusted = applyFilters(pixels, v);
      // Blur is in full-resolution pixels; previews are smaller, so scale it down to match.
      return v.blur > 0 ? blur(adjusted, width, height, v.blur * env.scale) : adjusted;
    });
    return { outputs: [{ canvas }] };
  },
});
