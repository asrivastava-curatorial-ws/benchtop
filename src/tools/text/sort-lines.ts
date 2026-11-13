import { type SortMode, sortLines } from '../../lib/words';
import { defineTextTool, type Values } from '../types';

export default defineTextTool({
  input: { label: 'Lines', sample: 'gallery-10\nGallery-2\nengine hall\nspace\ngallery-1\nspace\n' },
  output: { label: 'Sorted' },
  options: [
    {
      key: 'mode',
      label: 'Order',
      type: 'select',
      choices: [
        { value: 'natural', label: 'Natural (2 before 10)' },
        { value: 'alpha', label: 'Alphabetical' },
        { value: 'numeric', label: 'By first number' },
        { value: 'length', label: 'By length' },
        { value: 'reverse', label: 'Reverse current order' },
        { value: 'shuffle', label: 'Shuffle' },
      ],
      default: 'natural',
    },
    { key: 'descending', label: 'Descending', type: 'toggle', default: false, showIf: (v: Values) => v.mode !== 'reverse' && v.mode !== 'shuffle' },
    { key: 'caseSensitive', label: 'Case-sensitive', type: 'toggle', default: false },
    { key: 'unique', label: 'Remove duplicates', type: 'toggle', default: false },
    { key: 'trim', label: 'Trim spaces', type: 'toggle', default: true },
    { key: 'removeEmpty', label: 'Remove empty lines', type: 'toggle', default: true },
  ],
  run(input, o, ctx) {
    void ctx.nonce;
    const output = sortLines(input, { ...o, mode: o.mode as SortMode });
    return { output, info: `${output === '' ? 0 : output.split('\n').length - 1} lines` };
  },
});
