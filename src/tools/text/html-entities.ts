import { decode, encode, escape as escapeSpecial } from 'he';
import { defineTextTool, type Values } from '../types';
import { isEncode, MODE, swapMode } from './_shared';

export default defineTextTool({
  input: { label: 'Input', language: 'html', sample: '<p class="note">Fish & chips — £5.50 © 2026</p>' },
  output: { label: 'Output', language: 'html' },
  options: [
    MODE,
    {
      key: 'scope',
      label: 'Encode',
      type: 'select',
      choices: [
        { value: 'special', label: 'Only & < > " \' `' },
        { value: 'nonascii', label: 'Special + non-ASCII' },
        { value: 'all', label: 'Every character' },
      ],
      default: 'nonascii',
      showIf: isEncode,
    },
    {
      key: 'style',
      label: 'Entity style',
      type: 'select',
      choices: [
        { value: 'named', label: 'Named (&copy;)' },
        { value: 'decimal', label: 'Decimal (&#169;)' },
        { value: 'hex', label: 'Hex (&#xA9;)' },
      ],
      default: 'named',
      showIf: (v: Values) => isEncode(v) && v.scope !== 'special',
    },
  ],
  swap: swapMode,
  run(input, o) {
    if (o.mode === 'decode') return decode(input);
    if (o.scope === 'special') return escapeSpecial(input);
    return encode(input, {
      useNamedReferences: o.style === 'named',
      decimal: o.style === 'decimal',
      encodeEverything: o.scope === 'all',
    });
  },
});
