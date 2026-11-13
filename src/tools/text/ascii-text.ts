import { ToolError } from '../../lib/errors';
import { plural } from '../../lib/text';
import { defineTextTool, type Values } from '../types';
import { MODE, swapMode } from './_shared';

const RADIX: Record<string, number> = { decimal: 10, octal: 8, hex: 16, binary: 2 };
const SEPARATORS: Record<string, string> = { space: ' ', comma: ', ', newline: '\n' };

export default defineTextTool({
  input: { label: 'Input', sample: 'Hello, World!' },
  output: { label: 'Output' },
  options: [
    {
      ...MODE,
      choices: [
        { value: 'encode', label: 'Text → Codes' },
        { value: 'decode', label: 'Codes → Text' },
      ],
    },
    {
      key: 'base',
      label: 'Code format',
      type: 'select',
      choices: [
        { value: 'decimal', label: 'Decimal (72)' },
        { value: 'octal', label: 'Octal (110)' },
        { value: 'hex', label: 'Hex (48)' },
        { value: 'binary', label: 'Binary (1001000)' },
      ],
      default: 'decimal',
    },
    {
      key: 'separator',
      label: 'Separator',
      type: 'select',
      choices: [
        { value: 'space', label: 'Space' },
        { value: 'comma', label: 'Comma' },
        { value: 'newline', label: 'New line' },
      ],
      default: 'space',
      showIf: (v: Values) => v.mode === 'encode',
    },
  ],
  swap: swapMode,
  run(input, o) {
    const radix = RADIX[o.base] ?? 10;
    if (o.mode === 'encode') {
      const points = Array.from(input, (ch) => ch.codePointAt(0) ?? 0);
      const outside = points.filter((point) => point > 127).length;
      return {
        output: points.map((point) => point.toString(radix)).join(SEPARATORS[o.separator] ?? ' '),
        warnings: outside > 0 ? [`${plural(outside, 'character')} outside ASCII (0-127): Unicode code points are shown for those.`] : undefined,
      };
    }
    const tokens = input.split(/[\s,;]+/).filter(Boolean);
    const valid = radix === 16 ? /^(0x)?[0-9a-f]+$/i : radix === 10 ? /^[0-9]+$/ : radix === 8 ? /^[0-7]+$/ : /^[01]+$/;
    return tokens
      .map((token) => {
        if (!valid.test(token)) throw new ToolError(`"${token}" is not a valid ${o.base} code.`);
        const point = Number.parseInt(token.replace(/^0x/i, ''), radix);
        if (point > 0x10ffff) throw new ToolError(`"${token}" is larger than the highest Unicode code point (U+10FFFF).`);
        return String.fromCodePoint(point);
      })
      .join('');
  },
});
