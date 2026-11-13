import { BASE32_HEX, BASE32_STD, fromBase32, toBase32, utf8Encode } from '../../lib/bytes';
import { defineTextTool } from '../types';
import { decodedResult, isEncode, MODE, swapMode } from './_shared';

export default defineTextTool({
  input: { label: 'Input', sample: 'Hello, Base32!', binary: true },
  output: { label: 'Output' },
  options: [
    MODE,
    {
      key: 'variant',
      label: 'Alphabet',
      type: 'select',
      choices: [
        { value: 'standard', label: 'RFC 4648 (A-Z 2-7)' },
        { value: 'hex', label: 'Base32hex (0-9 A-V)' },
      ],
      default: 'standard',
    },
    { key: 'padding', label: 'Padding (=)', type: 'toggle', default: true, showIf: isEncode },
    { key: 'lowercase', label: 'Lowercase', type: 'toggle', default: false, showIf: isEncode },
  ],
  swap: swapMode,
  run(input, o, ctx) {
    const alphabet = o.variant === 'hex' ? BASE32_HEX : BASE32_STD;
    if (o.mode === 'encode') {
      const encoded = toBase32(ctx.file ? ctx.file.bytes : utf8Encode(input), alphabet, o.padding);
      return o.lowercase ? encoded.toLowerCase() : encoded;
    }
    return decodedResult(fromBase32(input, alphabet));
  },
});
