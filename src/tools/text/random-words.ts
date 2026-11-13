import * as randomWords from 'random-words';
import { randomInt } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { capitalize } from '../../lib/text';
import { defineTextTool } from '../types';

// The package's type declarations misspell this export as `wordsList`.
const wordList = (randomWords as unknown as { wordList: string[] }).wordList;

const SEPARATORS: Record<string, string> = { newline: '\n', space: ' ', comma: ', ', hyphen: '-', dot: '.', underscore: '_', none: '' };

export default defineTextTool({
  input: false,
  output: { label: 'Words' },
  options: [
    { key: 'count', label: 'How many', type: 'number', default: 12, min: 1, max: 2000, step: 1 },
    { key: 'min', label: 'Min length', type: 'number', default: 3, min: 1, max: 20, step: 1 },
    { key: 'max', label: 'Max length', type: 'number', default: 10, min: 1, max: 20, step: 1 },
    {
      key: 'case',
      label: 'Case',
      type: 'select',
      choices: [
        { value: 'lower', label: 'lowercase' },
        { value: 'upper', label: 'UPPERCASE' },
        { value: 'title', label: 'Capitalised' },
      ],
      default: 'lower',
    },
    {
      key: 'separator',
      label: 'Separate with',
      type: 'select',
      choices: [
        { value: 'newline', label: 'New line' },
        { value: 'space', label: 'Space' },
        { value: 'comma', label: 'Comma' },
        { value: 'hyphen', label: 'Hyphen (passphrase)' },
        { value: 'dot', label: 'Dot' },
        { value: 'underscore', label: 'Underscore' },
        { value: 'none', label: 'Nothing' },
      ],
      default: 'newline',
    },
    { key: 'unique', label: 'No repeats', type: 'toggle', default: false },
    { key: 'starts', label: 'Starting with', type: 'text', default: '', placeholder: 'any' },
  ],
  action: 'Generate',
  runOnEmpty: true,
  run(_input, o) {
    const min = Math.min(o.min, o.max);
    const max = Math.max(o.min, o.max);
    const prefix = o.starts.trim().toLowerCase();
    const pool = wordList.filter((word) => word.length >= min && word.length <= max && word.startsWith(prefix));
    if (pool.length === 0) throw new ToolError('No words match those filters. Widen the length range or clear "Starting with".');
    const count = Math.trunc(o.count);
    if (o.unique && count > pool.length) {
      throw new ToolError(`Only ${pool.length} different words match those filters; ask for fewer, or allow repeats.`);
    }
    const picked: string[] = [];
    const available = [...pool];
    for (let i = 0; i < count; i++) {
      const index = randomInt(available.length);
      picked.push(available[index] as string);
      if (o.unique) available.splice(index, 1);
    }
    const cased = picked.map((word) => (o.case === 'upper' ? word.toUpperCase() : o.case === 'title' ? capitalize(word) : word));
    const bits = o.unique ? Array.from({ length: count }, (_, i) => Math.log2(pool.length - i)).reduce((sum, value) => sum + value, 0) : count * Math.log2(pool.length);
    return {
      output: cased.join(SEPARATORS[o.separator] ?? '\n'),
      info: `Chosen with the system's secure random generator from ${pool.length.toLocaleString('en-US')} words · about ${Math.floor(bits)} bits of entropy`,
      filename: 'words.txt',
    };
  },
});
