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

const channels = (hex: string): [number, number, number] => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number];

/** HSV (also called HSB), as used by design tools' colour pickers. */
export function hsvOf(hex: string): string {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let hue = 0;
  if (delta > 0) hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return `hsv(${Math.round((hue * 60 + 360) % 360)}, ${Math.round(max === 0 ? 0 : (delta / max) * 100)}%, ${Math.round(max * 100)}%)`;
}

/** Device-independent CMYK from RGB; real print colours depend on the press profile. */
export function cmykOf(hex: string): string {
  const [r, g, b] = channels(hex);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return 'cmyk(0%, 0%, 0%, 100%)';
  const part = (value: number) => Math.round(((1 - value - k) / (1 - k)) * 100);
  return `cmyk(${part(r)}%, ${part(g)}%, ${part(b)}%, ${Math.round(k * 100)}%)`;
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
      { label: 'HSV / HSB', value: hsvOf(solid), mono: true },
      { label: 'CMYK (naive)', value: cmykOf(solid), mono: true },
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
