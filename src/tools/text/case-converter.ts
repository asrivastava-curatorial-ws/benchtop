import { capitalize, splitLines, splitWords } from '../../lib/text';
import { defineTextTool } from '../types';

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in', 'nor', 'of', 'on', 'or', 'per', 'so', 'the', 'to', 'up', 'via', 'vs', 'yet']);

function titleCase(line: string): string {
  const words = line.toLowerCase().split(/(\s+)/);
  const lastWord = words.reduce((last, word, index) => (/\S/.test(word) ? index : last), -1);
  let seenWord = false;
  return words
    .map((word, index) => {
      if (!/\S/.test(word)) return word;
      const bare = word.replace(/[^\p{L}\p{N}']/gu, '');
      const keepSmall = seenWord && index !== lastWord && SMALL_WORDS.has(bare);
      seenWord = true;
      return keepSmall ? word : word.replace(/[\p{L}\p{N}]/u, (ch) => ch.toUpperCase());
    })
    .join('');
}

function sentenceCase(line: string): string {
  return line.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}

const CONVERTERS: Record<string, (line: string) => string> = {
  lower: (line) => line.toLowerCase(),
  upper: (line) => line.toUpperCase(),
  title: titleCase,
  sentence: sentenceCase,
  camel: (line) =>
    splitWords(line)
      .map((word, index) => (index === 0 ? word.toLowerCase() : capitalize(word)))
      .join(''),
  pascal: (line) => splitWords(line).map(capitalize).join(''),
  snake: (line) => splitWords(line).join('_').toLowerCase(),
  constant: (line) => splitWords(line).join('_').toUpperCase(),
  kebab: (line) => splitWords(line).join('-').toLowerCase(),
  cobol: (line) => splitWords(line).join('-').toUpperCase(),
  train: (line) => splitWords(line).map(capitalize).join('-'),
  dot: (line) => splitWords(line).join('.').toLowerCase(),
  path: (line) => splitWords(line).join('/').toLowerCase(),
  alternating: (line) => {
    let index = 0;
    return Array.from(line, (ch) => (/\p{L}/u.test(ch) ? (index++ % 2 === 0 ? ch.toLowerCase() : ch.toUpperCase()) : ch)).join('');
  },
  inverse: (line) => Array.from(line, (ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join(''),
};

export default defineTextTool({
  input: { label: 'Text', sample: 'the quick brown fox\nXMLHttpRequest and parseURL\nuser_first_name\nA Tale of two cities' },
  output: { label: 'Converted' },
  options: [
    {
      key: 'style',
      label: 'Convert to',
      type: 'select',
      choices: [
        { value: 'camel', label: 'camelCase' },
        { value: 'pascal', label: 'PascalCase' },
        { value: 'snake', label: 'snake_case' },
        { value: 'constant', label: 'CONSTANT_CASE' },
        { value: 'kebab', label: 'kebab-case' },
        { value: 'cobol', label: 'COBOL-CASE' },
        { value: 'train', label: 'Train-Case' },
        { value: 'dot', label: 'dot.case' },
        { value: 'path', label: 'path/case' },
        { value: 'title', label: 'Title Case' },
        { value: 'sentence', label: 'Sentence case' },
        { value: 'lower', label: 'lowercase' },
        { value: 'upper', label: 'UPPERCASE' },
        { value: 'alternating', label: 'aLtErNaTiNg' },
        { value: 'inverse', label: 'iNVERSE' },
      ],
      default: 'camel',
    },
  ],
  run(input, o) {
    const convert = CONVERTERS[o.style] ?? ((line: string) => line);
    // Each line is converted on its own so lists of identifiers keep their structure.
    return splitLines(input).map(convert).join('\n');
  },
});
