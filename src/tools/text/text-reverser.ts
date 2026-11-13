import { graphemes, splitLines } from '../../lib/text';
import { defineTextTool, type Values } from '../types';

const reverseCharacters = (text: string): string => graphemes(text).reverse().join('');

export default defineTextTool({
  input: { label: 'Text', sample: 'Hello, World! 👋🏽\nA man, a plan, a canal: Panama' },
  output: { label: 'Reversed' },
  options: [
    {
      key: 'mode',
      label: 'Reverse',
      type: 'select',
      choices: [
        { value: 'characters', label: 'All characters' },
        { value: 'words', label: 'Word order' },
        { value: 'each', label: 'Letters inside each word' },
        { value: 'lines', label: 'Line order' },
      ],
      default: 'characters',
    },
    {
      key: 'perLine',
      label: 'Line by line',
      type: 'toggle',
      default: true,
      showIf: (v: Values) => v.mode === 'characters' || v.mode === 'words',
      help: 'Reverse each line separately instead of the whole text.',
    },
  ],
  run(input, o) {
    const lines = splitLines(input);
    switch (o.mode) {
      case 'lines':
        return lines.reverse().join('\n');
      case 'each':
        return lines
          .map((line) =>
            line
              .split(/(\s+)/)
              .map((token) => (/\s/.test(token) ? token : reverseCharacters(token)))
              .join(''),
          )
          .join('\n');
      case 'words': {
        const reverseWords = (text: string) => text.split(/(\s+)/).reverse().join('');
        return o.perLine ? lines.map(reverseWords).join('\n') : reverseWords(input);
      }
      default:
        // Graphemes keep emoji, flags and accented letters intact instead of tearing them apart.
        return o.perLine ? lines.map(reverseCharacters).join('\n') : reverseCharacters(input);
    }
  },
});
