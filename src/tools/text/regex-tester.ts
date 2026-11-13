import { findMatches, highlightMatches, replaceMatches } from '../../lib/regex';
import { defineTextTool, type Field, type Values } from '../types';

const SAMPLE = `Order 2024-05-17 shipped to ada@example.org.
Order 2025-11-02 returned by grace@example.net.
Call +91 80 2286 4563 between 09:30 and 17:00.`;

export default defineTextTool({
  input: { label: 'Test text', sample: SAMPLE },
  output: { label: 'Matches' },
  options: [
    { key: 'pattern', label: 'Pattern', type: 'text', default: '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+(?:\\.[\\w-]+)+)', mono: true, wide: true, placeholder: 'without the surrounding slashes' },
    {
      key: 'flags',
      label: 'Flags',
      type: 'text',
      default: 'g',
      mono: true,
      help: 'g all matches, i ignore case, m multi-line, s dot matches newlines, u Unicode, v Unicode sets, y sticky, d indices',
    },
    {
      key: 'view',
      label: 'Show',
      type: 'segmented',
      choices: [
        { value: 'matches', label: 'Matches' },
        { value: 'replace', label: 'Replace' },
      ],
      default: 'matches',
    },
    {
      key: 'replacement',
      label: 'Replace with',
      type: 'text',
      default: '$<user> at $<domain>',
      mono: true,
      wide: true,
      showIf: (v: Values) => v.view === 'replace',
      help: '$1 or $<name> for groups, $& for the whole match, $$ for a dollar sign.',
    },
  ],
  run(input, o) {
    if (o.pattern === '') return { output: '', info: 'Enter a pattern.' };
    const result = findMatches(o.pattern, o.flags, input);
    const fields: Field[] = [
      { label: 'Matches', value: `${result.matches.length}${result.truncated ? '+ (stopped counting)' : ''}`, tone: result.matches.length > 0 ? 'ok' : 'warn' },
      { label: 'Groups', value: result.groupCount === 0 ? 'none' : `${result.groupCount}${result.groupNames.length ? ` (named: ${result.groupNames.join(', ')})` : ''}` },
      { label: 'JavaScript', value: `/${o.pattern.replace(/\//g, '\\/')}/${o.flags}`, mono: true },
    ];
    const preview = { kind: 'html' as const, html: `<pre class="regex-preview">${highlightMatches(input, result.matches)}</pre>` };
    if (o.view === 'replace') return { output: replaceMatches(o.pattern, o.flags, input, o.replacement), fields, preview };
    const lines = result.matches.map((match, index) => {
      const groups = match.groups.map(
        (group, g) =>
          `    ${(Object.entries(match.named).find(([, value]) => value === group && group !== undefined)?.[0] ?? '') || `$${g + 1}`}: ${group === undefined ? '(no match)' : JSON.stringify(group)}`,
      );
      return [`#${index + 1} at ${match.index}-${match.end}: ${JSON.stringify(match.text)}`, ...groups].join('\n');
    });
    return { output: lines.join('\n') || 'No matches.', fields, preview };
  },
});
