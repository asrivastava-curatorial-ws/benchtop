import { BASE58_BITCOIN, BASE58_FLICKR, BASE58_RIPPLE, baseXDecode, baseXEncode, fromHex, toHex, utf8Encode } from '../../lib/bytes';
import { defineTextTool } from '../types';
import { decodedResult, MODE, swapMode } from './_shared';

const ALPHABETS: Record<string, string> = {
  bitcoin: BASE58_BITCOIN,
  flickr: BASE58_FLICKR,
  ripple: BASE58_RIPPLE,
};

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
      help: 'Whether the unencoded side is text or hexadecimal bytes.',
    },
    {
      key: 'alphabet',
      label: 'Alphabet',
      type: 'select',
      choices: [
        { value: 'bitcoin', label: 'Bitcoin / IPFS' },
        { value: 'flickr', label: 'Flickr' },
        { value: 'ripple', label: 'Ripple' },
      ],
      default: 'bitcoin',
    },
  ],
  swap: swapMode,
  run(input, o) {
    const alphabet = ALPHABETS[o.alphabet] ?? BASE58_BITCOIN;
    if (o.mode === 'encode') {
      return baseXEncode(o.data === 'hex' ? fromHex(input) : utf8Encode(input), alphabet);
    }
    const bytes = baseXDecode(input, alphabet, 'Base58');
    return o.data === 'hex' ? toHex(bytes) : decodedResult(bytes);
  },
});
