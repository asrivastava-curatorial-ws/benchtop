import { type Document, isMap, isSeq, parseAllDocuments } from 'yaml';
import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

function sortMaps(node: unknown): void {
  if (isMap(node)) {
    node.items.sort((a, b) => String((a.key as { value?: unknown })?.value ?? a.key).localeCompare(String((b.key as { value?: unknown })?.value ?? b.key)));
    for (const pair of node.items) sortMaps(pair.value);
  } else if (isSeq(node)) for (const item of node.items) sortMaps(item);
}

export default defineTextTool({
  input: {
    label: 'YAML',
    language: 'yaml',
    sample: 'services:\n    web:\n        image: "nginx:1.27"\n        ports: [ "80:80", "443:443" ]\n    db: {image: postgres:17, environment: {POSTGRES_PASSWORD: example}}\n',
  },
  output: { label: 'Formatted', language: 'yaml' },
  options: [
    { key: 'indent', label: 'Indent', type: 'select', choices: ['2', '4'], default: '2' },
    { key: 'sort', label: 'Sort keys', type: 'toggle', default: false },
    { key: 'flow', label: 'Short lists on one line', type: 'toggle', default: false },
    {
      key: 'quotes',
      label: 'Strings',
      type: 'select',
      choices: [
        { value: 'plain', label: 'Unquoted where possible' },
        { value: 'double', label: '"Double quotes"' },
        { value: 'single', label: "'Single quotes'" },
      ],
      default: 'plain',
    },
    { key: 'width', label: 'Wrap long text at', type: 'number', default: 0, min: 0, max: 400, step: 10, unit: 'chars', help: '0 never wraps.' },
  ],
  run(input, o) {
    if (input.trim() === '') return '';
    const documents: Document[] = parseAllDocuments(input) as Document[];
    for (const document of documents) {
      if (document.errors.length > 0) {
        const error = document.errors[0];
        throw new ToolError(`Invalid YAML: ${error?.message.split('\n')[0]}`, { line: error?.linePos?.[0]?.line, column: error?.linePos?.[0]?.col });
      }
      if (o.sort) sortMaps(document.contents);
    }
    const options = {
      indent: Number(o.indent),
      lineWidth: o.width,
      defaultStringType: o.quotes === 'double' ? ('QUOTE_DOUBLE' as const) : o.quotes === 'single' ? ('QUOTE_SINGLE' as const) : ('PLAIN' as const),
      defaultKeyType: 'PLAIN' as const,
      flowCollectionPadding: true,
      collectionStyle: o.flow ? ('any' as const) : ('block' as const),
    };
    const output = documents.map((document) => document.toString(options)).join('---\n');
    return { output, info: `${documents.length} document${documents.length === 1 ? '' : 's'}` };
  },
});
