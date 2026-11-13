import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';
import { MODE, swapMode } from './_shared';

export default defineTextTool({
  input: { label: 'Input', sample: 'https://example.org/search?q=café & crème&lang=fr#résumé' },
  output: { label: 'Output' },
  options: [
    MODE,
    {
      key: 'scope',
      label: 'Treat input as',
      type: 'select',
      choices: [
        { value: 'component', label: 'A value (encode everything reserved)' },
        { value: 'uri', label: 'A whole URL (keep : / ? & = #)' },
        { value: 'form', label: 'Form data (spaces become +)' },
      ],
      default: 'component',
    },
  ],
  swap: swapMode,
  run(input, o) {
    if (o.mode === 'encode') {
      try {
        if (o.scope === 'uri') return encodeURI(input);
        const encoded = encodeURIComponent(input).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
        return o.scope === 'form' ? encoded.replace(/%20/g, '+') : encoded;
      } catch {
        throw new ToolError('The text contains an unpaired surrogate and cannot be encoded as UTF-8.');
      }
    }
    const source = o.scope === 'form' ? input.replace(/\+/g, ' ') : input;
    try {
      return o.scope === 'uri' ? decodeURI(source) : decodeURIComponent(source);
    } catch {
      const bad = /%(?![0-9a-fA-F]{2})/.exec(source);
      throw new ToolError(bad ? `Malformed percent-escape at position ${bad.index + 1}: "%" must be followed by two hex digits.` : 'The percent-escapes do not form valid UTF-8.');
    }
  },
});
