import { describeColor } from '../../lib/color';
import { ToolError } from '../../lib/errors';
import { generateShades, type Shade, shadeOklch } from '../../lib/shades';
import { defineTextTool } from '../types';

function formatShade(shade: Shade, notation: string): string {
  if (notation === 'oklch') return shadeOklch(shade);
  const formats = describeColor(shade.hex);
  if (!formats) return shade.hex;
  return notation === 'rgb' ? formats.rgb : notation === 'hsl' ? formats.hsl : shade.hex;
}

export default defineTextTool({
  input: false,
  output: { label: 'Code', language: 'css' },
  options: [
    { key: 'color', label: 'Base colour', type: 'color', default: '#6366f1' },
    { key: 'name', label: 'Name', type: 'text', default: 'brand', mono: true },
    {
      key: 'notation',
      label: 'Colour values',
      type: 'select',
      choices: [
        { value: 'hex', label: 'HEX' },
        { value: 'oklch', label: 'OKLCH' },
        { value: 'rgb', label: 'RGB' },
        { value: 'hsl', label: 'HSL' },
      ],
      default: 'hex',
    },
    {
      key: 'format',
      label: 'Export as',
      type: 'select',
      choices: [
        { value: 'css', label: 'CSS custom properties' },
        { value: 'tailwind4', label: 'Tailwind v4 @theme' },
        { value: 'tailwind3', label: 'Tailwind v3 config' },
        { value: 'scss', label: 'SCSS map' },
        { value: 'json', label: 'JSON (design tokens)' },
      ],
      default: 'css',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const name = o.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (name === '') throw new ToolError('Give the scale a name, for example "brand".');
    const shades = generateShades(o.color);
    const value = (shade: Shade) => formatShade(shade, o.notation);
    let output: string;
    let language: 'css' | 'javascript' | 'json' = 'css';
    switch (o.format) {
      case 'tailwind4':
        output = `@theme {\n${shades.map((shade) => `  --color-${name}-${shade.step}: ${value(shade)};`).join('\n')}\n}\n`;
        break;
      case 'tailwind3':
        language = 'javascript';
        output = `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        ${/^[a-z_$][\w$]*$/.test(name) ? name : `'${name}'`}: {\n${shades.map((shade) => `          ${shade.step}: '${value(shade)}',`).join('\n')}\n        },\n      },\n    },\n  },\n};\n`;
        break;
      case 'scss':
        output = `$${name}: (\n${shades.map((shade) => `  ${shade.step}: ${value(shade)},`).join('\n')}\n);\n`;
        break;
      case 'json':
        language = 'json';
        output = `${JSON.stringify({ [name]: Object.fromEntries(shades.map((shade) => [shade.step, { $type: 'color', $value: value(shade) }])) }, null, 2)}\n`;
        break;
      default:
        output = `:root {\n${shades.map((shade) => `  --${name}-${shade.step}: ${value(shade)};`).join('\n')}\n}\n`;
    }
    const base = shades.find((shade) => shade.base);
    return {
      output,
      language,
      fields: shades.map((shade) => ({
        label: `${name}-${shade.step}${shade.base ? '  (your colour)' : ''}`,
        value: `${shade.hex}   ${shadeOklch(shade)}`,
        mono: true,
        swatch: shade.hex,
      })),
      info: base ? `Your colour sits at step ${base.step}; lightness and chroma follow an OKLCH ramp with a constant hue` : undefined,
    };
  },
});
