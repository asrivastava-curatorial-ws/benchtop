import { defineTextTool } from '../types';

export default defineTextTool({
  input: { label: 'List', sample: 'banana\napple\n  cherry  \napple\n\ndate' },
  output: { label: 'Result' },
  options: [
    {
      key: 'split',
      label: 'Items separated by',
      type: 'select',
      choices: [
        { value: 'lines', label: 'New lines' },
        { value: 'comma', label: 'Commas' },
        { value: 'space', label: 'Spaces' },
        { value: 'tab', label: 'Tabs' },
        { value: 'semicolon', label: 'Semicolons' },
      ],
      default: 'lines',
    },
    { key: 'trim', label: 'Trim spaces', type: 'toggle', default: true },
    { key: 'removeEmpty', label: 'Remove empty items', type: 'toggle', default: true },
    { key: 'unique', label: 'Remove duplicates', type: 'toggle', default: false },
    {
      key: 'sort',
      label: 'Sort',
      type: 'select',
      choices: [
        { value: 'none', label: 'Keep order' },
        { value: 'asc', label: 'A to Z' },
        { value: 'desc', label: 'Z to A' },
        { value: 'natural', label: 'Natural (item2 before item10)' },
        { value: 'length', label: 'By length' },
        { value: 'reverse', label: 'Reverse' },
        { value: 'shuffle', label: 'Shuffle' },
      ],
      default: 'none',
    },
    {
      key: 'case',
      label: 'Case',
      type: 'select',
      choices: [
        { value: 'keep', label: 'Keep' },
        { value: 'lower', label: 'lower' },
        { value: 'upper', label: 'UPPER' },
      ],
      default: 'keep',
    },
    { key: 'prefix', label: 'Before each item', type: 'text', default: '', mono: true },
    { key: 'suffix', label: 'After each item', type: 'text', default: '', mono: true },
    {
      key: 'quote',
      label: 'Wrap in',
      type: 'select',
      choices: [
        { value: '', label: 'Nothing' },
        { value: "'", label: "'single quotes'" },
        { value: '"', label: '"double quotes"' },
        { value: '`', label: '`backticks`' },
      ],
      default: '',
    },
    {
      key: 'join',
      label: 'Join with',
      type: 'select',
      choices: [
        { value: '\n', label: 'New lines' },
        { value: ', ', label: 'Comma and space' },
        { value: ',', label: 'Comma' },
        { value: ' ', label: 'Space' },
        { value: '\t', label: 'Tab' },
        { value: ' | ', label: 'Pipe' },
        { value: ';', label: 'Semicolon' },
      ],
      default: '\n',
    },
    {
      key: 'wrap',
      label: 'Wrap the whole list',
      type: 'select',
      choices: [
        { value: 'none', label: 'No' },
        { value: 'brackets', label: '[ … ]' },
        { value: 'parens', label: '( … )' },
        { value: 'braces', label: '{ … }' },
        { value: 'sql', label: 'SQL IN ( … )' },
      ],
      default: 'none',
    },
  ],
  run(input, o) {
    const separators: Record<string, RegExp> = { lines: /\r?\n/, comma: /,/, space: /\s+/, tab: /\t/, semicolon: /;/ };
    let items = input.split(separators[o.split] ?? /\r?\n/);
    if (o.trim) items = items.map((item) => item.trim());
    if (o.removeEmpty) items = items.filter((item) => item !== '');
    if (o.case === 'lower') items = items.map((item) => item.toLowerCase());
    if (o.case === 'upper') items = items.map((item) => item.toUpperCase());
    if (o.unique) items = [...new Set(items)];
    const collator = new Intl.Collator(undefined, { numeric: o.sort === 'natural', sensitivity: 'base' });
    if (o.sort === 'asc' || o.sort === 'natural') items.sort(collator.compare);
    if (o.sort === 'desc') items.sort((a, b) => collator.compare(b, a));
    if (o.sort === 'length') items.sort((a, b) => a.length - b.length || collator.compare(a, b));
    if (o.sort === 'reverse') items.reverse();
    if (o.sort === 'shuffle') {
      const random = new Uint32Array(items.length);
      crypto.getRandomValues(random);
      for (let i = items.length - 1; i > 0; i--) {
        const j = (random[i] as number) % (i + 1);
        [items[i], items[j]] = [items[j] as string, items[i] as string];
      }
    }
    const quote = o.wrap === 'sql' && o.quote === '' ? "'" : o.quote;
    const shaped = items.map((item) => `${o.prefix}${quote}${quote === "'" && o.wrap === 'sql' ? item.replace(/'/g, "''") : item}${quote}${o.suffix}`);
    const joined = shaped.join(o.wrap === 'sql' && o.join === '\n' ? ', ' : o.join);
    const wrapped = { none: joined, brackets: `[${joined}]`, parens: `(${joined})`, braces: `{${joined}}`, sql: `IN (${joined})` }[o.wrap as 'none'] ?? joined;
    return { output: wrapped, info: `${items.length} item${items.length === 1 ? '' : 's'}` };
  },
});
