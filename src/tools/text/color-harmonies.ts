import { contrastRatio, hexOf, isColor, oklchToHex, toOklchValues } from '../../lib/color';
import { ToolError } from '../../lib/errors';
import { escapeXml } from '../../lib/text';
import { defineTextTool, type Field } from '../types';

/** Hue offsets for each scheme, applied in OKLCH so the colours look evenly spaced. */
const SCHEMES: Record<string, { label: string; hues: number[] }> = {
  complementary: { label: 'Complementary', hues: [0, 180] },
  split: { label: 'Split complementary', hues: [0, 150, 210] },
  analogous: { label: 'Analogous', hues: [-30, 0, 30] },
  triadic: { label: 'Triadic', hues: [0, 120, 240] },
  tetradic: { label: 'Tetradic (rectangle)', hues: [0, 60, 180, 240] },
  square: { label: 'Square', hues: [0, 90, 180, 270] },
  monochrome: { label: 'Monochromatic', hues: [0, 0, 0, 0, 0] },
};

export function harmony(base: string, scheme: string): string[] {
  const values = toOklchValues(base);
  if (!values) throw new ToolError('That is not a colour.');
  const { l, c, h } = values;
  const entry = SCHEMES[scheme] ?? (SCHEMES.complementary as (typeof SCHEMES)[string]);
  if (scheme === 'monochrome') return [0.35, 0.5, l, 0.75, 0.9].map((lightness) => oklchToHex(lightness, Math.min(c, 0.25), h));
  return entry.hues.map((offset) => oklchToHex(l, c, ((((h ?? 0) + offset) % 360) + 360) % 360));
}

export default defineTextTool({
  input: false,
  output: { label: 'CSS' },
  options: [
    { key: 'color', label: 'Base colour', type: 'color', default: '#2f81f7' },
    { key: 'scheme', label: 'Scheme', type: 'select', choices: [...Object.entries(SCHEMES).map(([value, { label }]) => ({ value, label })), { value: 'all', label: 'All schemes' }], default: 'all' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    if (!isColor(o.color)) throw new ToolError('Choose a valid colour.');
    const base = hexOf(o.color);
    const schemes = o.scheme === 'all' ? Object.keys(SCHEMES) : [o.scheme];
    const palettes = schemes.map((scheme) => ({ scheme, colors: harmony(base, scheme) }));
    const row = 56;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${palettes.length * row + 8}" viewBox="0 0 640 ${palettes.length * row + 8}"><rect width="100%" height="100%" rx="8" fill="#0d1117"/>${palettes
      .map(({ scheme, colors }, index) => {
        const y = 8 + index * row;
        const width = 440 / colors.length;
        return `<text x="12" y="${y + 28}" fill="#c9d1d9" font-family="system-ui, sans-serif" font-size="13">${escapeXml(SCHEMES[scheme]?.label ?? scheme)}</text>${colors
          .map(
            (color, i) =>
              `<rect x="${(190 + i * width).toFixed(1)}" y="${y}" width="${(width - 4).toFixed(1)}" height="${row - 12}" rx="5" fill="${color}"/><text x="${(190 + i * width + width / 2 - 2).toFixed(1)}" y="${y + 27}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" fill="${contrastRatio(color, '#ffffff') > 3.5 ? '#ffffff' : '#000000'}">${color}</text>`,
          )
          .join('')}`;
      })
      .join('')}</svg>`;
    const fields: Field[] = palettes.map(({ scheme, colors }) => ({ label: SCHEMES[scheme]?.label ?? scheme, value: colors.join('  '), mono: true }));
    const css = palettes.map(({ scheme, colors }) => `/* ${SCHEMES[scheme]?.label} */\n${colors.map((color, index) => `--${scheme}-${index + 1}: ${color};`).join('\n')}`).join('\n\n');
    return { output: `:root {\n${css.replace(/^/gm, '  ')}\n}\n`, language: 'css', preview: { kind: 'svg', svg }, fields, filename: 'harmonies.css' };
  },
});
