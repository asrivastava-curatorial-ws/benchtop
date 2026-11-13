import { fromHex, toHex, utf8Encode } from '../../lib/bytes';
import { defineTextTool } from '../types';
import { decodedResult, isEncode, MODE, swapMode } from './_shared';

const STYLES: Record<string, { separator: string; prefix: string }> = {
  none: { separator: '', prefix: '' },
  space: { separator: ' ', prefix: '' },
  colon: { separator: ':', prefix: '' },
  comma: { separator: ', ', prefix: '0x' },
  '0x': { separator: ' ', prefix: '0x' },
  escape: { separator: '', prefix: '\\x' },
  percent: { separator: '', prefix: '%' },
};

export default defineTextTool({
  input: { label: 'Input', sample: 'Hex ↔ text', binary: true },
  output: { label: 'Output' },
  options: [
    {
      ...MODE,
      choices: [
        { value: 'encode', label: 'Text → Hex' },
        { value: 'decode', label: 'Hex → Text' },
      ],
    },
    {
      key: 'style',
      label: 'Format',
      type: 'select',
      choices: [
        { value: 'space', label: '48 65 6c' },
        { value: 'none', label: '48656c' },
        { value: 'colon', label: '48:65:6c' },
        { value: '0x', label: '0x48 0x65' },
        { value: 'comma', label: '0x48, 0x65' },
        { value: 'escape', label: '\\x48\\x65' },
        { value: 'percent', label: '%48%65' },
      ],
      default: 'space',
      showIf: isEncode,
    },
    { key: 'upper', label: 'Uppercase', type: 'toggle', default: false, showIf: isEncode },
  ],
  swap: swapMode,
  run(input, o, ctx) {
    if (o.mode === 'encode') {
      const style = STYLES[o.style] ?? { separator: ' ', prefix: '' };
      return toHex(ctx.file ? ctx.file.bytes : utf8Encode(input), { upper: o.upper, ...style });
    }
    return decodedResult(fromHex(input));
  },
});
