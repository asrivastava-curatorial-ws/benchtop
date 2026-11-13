import { lorem } from '../../lib/words';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: false,
  output: { label: 'Placeholder text' },
  options: [
    {
      key: 'unit',
      label: 'Generate',
      type: 'segmented',
      choices: [
        { value: 'paragraphs', label: 'Paragraphs' },
        { value: 'sentences', label: 'Sentences' },
        { value: 'words', label: 'Words' },
      ],
      default: 'paragraphs',
    },
    { key: 'count', label: 'How many', type: 'number', min: 1, max: 5000, step: 1, default: 3 },
    { key: 'classicStart', label: 'Start with “Lorem ipsum dolor sit amet”', type: 'toggle', default: true },
    { key: 'html', label: 'Wrap in <p> tags', type: 'toggle', default: false },
  ],
  action: 'Generate',
  runOnEmpty: true,
  run(_input, o) {
    const output = lorem({ unit: o.unit as 'paragraphs', count: o.count, classicStart: o.classicStart, html: o.html });
    return { output, language: o.html ? 'html' : 'text', info: `${(output.match(/[\p{L}]+/gu) ?? []).length} words` };
  },
});
