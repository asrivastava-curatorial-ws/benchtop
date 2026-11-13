import { BASE62_DIGITS_LOWER_UPPER, BASE62_DIGITS_UPPER_LOWER, baseXDecode, baseXEncode, fromHex, toHex, utf8Encode } from '../../lib/bytes';
import { defineTextTool } from '../types';
import { decodedResult, MODE, swapMode } from './_shared';

export default defineTextTool({
  input: { label: 'Input', sample: 'Hello World!' },
  output: { label: 'Output' },
  options: [
    MODE,
    {
      key: 'data',
      label: 'Data is',
      type: 'select',
      choices: [
        { value: 'text', label: 'Text (UTF-8)' },
        { value: 'hex', label: 'Hex bytes' },
      ],
      default: 'text',
    },
    {
      key: 'alphabet',
      label: 'Alphabet',
      type: 'select',
      choices: [
        { value: 'upper', label: '0-9 A-Z a-z' },
        { value: 'lower', label: '0-9 a-z A-Z' },
      ],
      default: 'upper',
      help: 'Base62 has no single standard; both sides must use the same character order.',
    },
  ],
  swap: swapMode,
  run(input, o) {
    const alphabet = o.alphabet === 'lower' ? BASE62_DIGITS_LOWER_UPPER : BASE62_DIGITS_UPPER_LOWER;
    if (o.mode === 'encode') {
      return baseXEncode(o.data === 'hex' ? fromHex(input) : utf8Encode(input), alphabet);
    }
    const bytes = baseXDecode(input, alphabet, 'Base62');
    return o.data === 'hex' ? toHex(bytes) : decodedResult(bytes);
  },
});
