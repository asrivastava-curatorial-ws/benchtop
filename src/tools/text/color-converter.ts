import palette from 'tailwindcss/colors';
import { colorDistance, contrastRatio, describeColor, hexOf, isColor } from '../../lib/color';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

let tailwind: [name: string, hex: string][] | undefined;

export function tailwindPalette(): [name: string, hex: string][] {
  if (!tailwind) {
    tailwind = [];
    for (const [family, shades] of Object.entries(palette)) {
      if (typeof shades !== 'object' || shades === null) continue;
      for (const [shade, value] of Object.entries(shades)) {
        if (typeof value === 'string' && isColor(value)) tailwind.push([`${family}-${shade}`, hexOf(value)]);
      }
    }
  }
  return tailwind;
}

export function nearestTailwind(color: string): { name: string; hex: string; distance: number } {
  let best = { name: '', hex: '', distance: Number.POSITIVE_INFINITY };
  for (const [name, hex] of tailwindPalette()) {
    const distance = colorDistance(color, hex);
    if (distance < best.distance) best = { name, hex, distance };
  }
  return best;
}

export default defineTextTool({
  input: false,
  output: false,
  options: [{ key: 'color', label: 'Colour', type: 'color', default: 'oklch(62.3% 0.214 259.8)', alpha: true }],
  runOnEmpty: true,
  run(_input, o) {
    const formats = describeColor(o.color);
    if (!formats) {
      throw new ToolError(`"${o.color}" is not a colour this tool understands. Try #3b82f6, rgb(59 130 246), hsl(217 91% 60%) or oklch(62% 0.21 260).`);
    }
    const solid = hexOf(o.color);
    const nearest = nearestTailwind(solid);
    const fields: Field[] = [
      { label: 'HEX', value: formats.hex, mono: true, swatch: formats.hex },
      { label: 'RGB', value: formats.rgb, mono: true },
      { label: 'HSL', value: formats.hsl, mono: true },
      { label: 'HWB', value: formats.hwb, mono: true },
      { label: 'OKLCH', value: formats.oklch, mono: true },
      { label: 'OKLab', value: formats.oklab, mono: true },
      { label: 'LCH', value: formats.lch, mono: true },
      { label: 'Lab', value: formats.lab, mono: true },
      { label: 'Display P3', value: formats.p3, mono: true },
      formats.inSrgb
        ? { label: 'sRGB gamut', value: 'Inside sRGB — every screen can show this colour exactly', tone: 'ok' }
        : {
            label: 'sRGB gamut',
            value: `Outside sRGB${formats.inP3 ? ' (inside Display P3)' : ' and outside Display P3'} — HEX, RGB, HSL and HWB show the nearest sRGB colour`,
            tone: 'warn',
          },
      {
        label: 'Nearest Tailwind colour',
        value: `${nearest.name}  ${nearest.hex}${nearest.distance < 0.002 ? '  (exact)' : ''}`,
        mono: true,
        swatch: nearest.hex,
      },
      { label: 'Contrast on white / black', value: `${contrastRatio(solid, '#ffffff').toFixed(2)}:1  /  ${contrastRatio(solid, '#000000').toFixed(2)}:1`, mono: true },
    ];
    return { fields };
  },
});
