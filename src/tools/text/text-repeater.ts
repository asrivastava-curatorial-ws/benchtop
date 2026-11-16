import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

const MAX_OUTPUT = 5_000_000;

export default defineTextTool({
  input: { label: 'Text', sample: 'Hello' },
  output: { label: 'Repeated' },
  options: [
    { key: 'count', label: 'Times', type: 'number', default: 10, min: 1, max: 100000, step: 1 },
    {
      key: 'separator',
      label: 'Between copies',
      type: 'select',
      choices: [
        { value: '\n', label: 'New line' },
        { value: ' ', label: 'Space' },
        { value: '', label: 'Nothing' },
        { value: ', ', label: 'Comma' },
        { value: '\t', label: 'Tab' },
      ],
      default: '\n',
    },
    { key: 'number', label: 'Number each copy', type: 'toggle', default: false },
    { key: 'start', label: 'Start numbering at', type: 'number', default: 1, step: 1, showIf: (v) => v.number === true },
  ],
  run(input, o) {
    if (input === '') return '';
    if (input.length * o.count > MAX_OUTPUT) throw new ToolError('That would make more than 5 million characters.');
    const copies = Array.from({ length: o.count }, (_, index) => (o.number ? `${o.start + index}. ${input}` : input));
    return { output: copies.join(o.separator), info: `${o.count} copies` };
  },
});
