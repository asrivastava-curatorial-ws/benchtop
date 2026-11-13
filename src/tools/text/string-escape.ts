import { ESCAPE_TARGETS, type EscapeTarget, escapeString, unescapeString } from '../../lib/string-escape';
import { defineTextTool } from '../types';
import { swapMode } from './_shared';

export default defineTextTool({
  input: { label: 'Text', sample: 'She said "hello" and left.\nPath: C:\\Users\\ada\nPrice: ₹1,200 — 10% off' },
  output: { label: 'Result' },
  options: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'segmented',
      choices: [
        { value: 'encode', label: 'Escape' },
        { value: 'decode', label: 'Unescape' },
      ],
      default: 'encode',
    },
    { key: 'target', label: 'For', type: 'select', choices: ESCAPE_TARGETS, default: 'json' },
  ],
  swap: swapMode,
  run: (input, o) => (o.mode === 'decode' ? unescapeString(input, o.target as EscapeTarget) : escapeString(input, o.target as EscapeTarget)),
});
