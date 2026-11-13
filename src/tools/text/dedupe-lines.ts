import { plural, splitLines } from '../../lib/text';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: { label: 'Lines', sample: 'apple\nBanana\napple\n  apple  \nbanana\n\ncherry\n\nApple\ncherry' },
  output: { label: 'Unique lines' },
  options: [
    { key: 'ignoreCase', label: 'Ignore case', type: 'toggle', default: false },
    { key: 'trim', label: 'Ignore surrounding spaces', type: 'toggle', default: false },
    {
      key: 'keep',
      label: 'Keep',
      type: 'select',
      choices: [
        { value: 'first', label: 'First occurrence' },
        { value: 'last', label: 'Last occurrence' },
        { value: 'unique', label: 'Only lines that never repeat' },
        { value: 'duplicates', label: 'Only lines that repeat (once each)' },
      ],
      default: 'first',
    },
    { key: 'dropEmpty', label: 'Remove empty lines', type: 'toggle', default: false },
    {
      key: 'sort',
      label: 'Sort',
      type: 'select',
      choices: [
        { value: 'none', label: 'Keep original order' },
        { value: 'asc', label: 'A → Z' },
        { value: 'desc', label: 'Z → A' },
      ],
      default: 'none',
    },
  ],
  run(input, o) {
    const source = splitLines(input);
    const key = (line: string): string => {
      const trimmed = o.trim ? line.trim() : line;
      return o.ignoreCase ? trimmed.toLowerCase() : trimmed;
    };
    const lines = o.dropEmpty ? source.filter((line) => line.trim() !== '') : source;
    const counts = new Map<string, number>();
    for (const line of lines) counts.set(key(line), (counts.get(key(line)) ?? 0) + 1);

    let result: string[];
    if (o.keep === 'last') {
      const seen = new Set<string>();
      result = [];
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i] as string;
        if (!seen.has(key(line))) {
          seen.add(key(line));
          result.unshift(line);
        }
      }
    } else {
      const seen = new Set<string>();
      result = lines.filter((line) => {
        const id = key(line);
        if (seen.has(id)) return false;
        seen.add(id);
        const count = counts.get(id) ?? 0;
        return o.keep === 'unique' ? count === 1 : o.keep === 'duplicates' ? count > 1 : true;
      });
    }
    if (o.sort !== 'none') {
      result.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: o.ignoreCase ? 'accent' : 'variant', numeric: true }));
      if (o.sort === 'desc') result.reverse();
    }
    return {
      output: result.join('\n'),
      info: `${plural(source.length, 'line')} in, ${plural(result.length, 'line')} out (${plural(source.length - result.length, 'line')} removed)`,
    };
  },
});
