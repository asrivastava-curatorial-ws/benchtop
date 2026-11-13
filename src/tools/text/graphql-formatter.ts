import { formatWithPrettier } from '../../lib/prettier';
import { defineTextTool } from '../types';

const SAMPLE = `query Exhibits($floor:Int!,$first:Int=10){galleries(floor:$floor){name exhibits(first:$first,status:OPEN){edges{node{id title ...Media}}}}} fragment Media on Exhibit{image{url(size:LARGE) alt}}`;

/** Removes insignificant whitespace, commas and comments while leaving strings untouched. */
export function minifyGraphql(source: string): string {
  return source
    .split(/("""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*")/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/#[^\n]*/g, '')
            .replace(/[\s,]+/g, ' ')
            .replace(/\s*([{}():=!$@[\]|&])\s*/g, '$1'),
    )
    .join('')
    .trim();
}

export default defineTextTool({
  input: { label: 'GraphQL', sample: SAMPLE, accept: '.graphql,.gql' },
  output: { label: 'Formatted' },
  options: [
    {
      key: 'indent',
      label: 'Indent',
      type: 'select',
      choices: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
        { value: 'tab', label: 'Tab' },
      ],
      default: '2',
    },
    { key: 'minify', label: 'Minify', type: 'toggle', default: false },
  ],
  async run(input, o) {
    // Formatting also checks the syntax, so minified output is always valid GraphQL.
    const pretty = await formatWithPrettier(input, 'graphql', { tabWidth: o.indent === '4' ? 4 : 2, useTabs: o.indent === 'tab' });
    return o.minify ? `${minifyGraphql(input)}\n` : pretty;
  },
});
