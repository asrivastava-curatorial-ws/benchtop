import { normalizeNewlines } from '../../lib/text';
import { defineTextTool, type Values } from '../types';

const SAMPLE = `This paragraph was copied from a PDF,
so every line ends with a hard
line break.

A second paragraph follows after
a blank line.`;

export default defineTextTool({
  input: { label: 'Text', sample: SAMPLE },
  output: { label: 'Result' },
  options: [
    {
      key: 'mode',
      label: 'Line breaks',
      type: 'select',
      choices: [
        { value: 'space', label: 'Replace with a space' },
        { value: 'paragraphs', label: 'Replace, but keep paragraph breaks' },
        { value: 'remove', label: 'Remove completely' },
        { value: 'custom', label: 'Replace with custom text' },
      ],
      default: 'paragraphs',
    },
    { key: 'replacement', label: 'Replacement', type: 'text', default: ', ', mono: true, showIf: (v: Values) => v.mode === 'custom' },
    { key: 'collapse', label: 'Collapse repeated spaces', type: 'toggle', default: true },
    { key: 'dehyphenate', label: 'Rejoin hyphenated words', type: 'toggle', default: false, help: 'Joins words that were split with a hyphen at the end of a line.' },
  ],
  run(input, o) {
    let text = normalizeNewlines(input);
    if (o.dehyphenate) text = text.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2');
    const breaks = (text.match(/\n/g) ?? []).length;
    const tidy = (value: string): string =>
      o.collapse
        ? value
            .replace(/[ \t]+/g, ' ')
            .replace(/ ?\n ?/g, '\n')
            .trim()
        : value;
    let output: string;
    if (o.mode === 'paragraphs') {
      output = text
        .split(/\n[ \t]*\n+/)
        .map((paragraph) => tidy(paragraph.replace(/\n/g, ' ')))
        .filter((paragraph) => paragraph !== '')
        .join('\n\n');
    } else {
      const replacement = o.mode === 'space' ? ' ' : o.mode === 'remove' ? '' : o.replacement;
      output = tidy(text.replace(/\n/g, replacement));
    }
    const remaining = (output.match(/\n/g) ?? []).length;
    return { output, info: `${breaks - remaining} line break${breaks - remaining === 1 ? '' : 's'} removed` };
  },
});
