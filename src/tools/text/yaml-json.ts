import { parseAllDocuments, stringify } from 'yaml';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { defineTextTool } from '../types';

const SAMPLE = `# Deployment settings
service: benchtop
replicas: 3
enabled: yes          # stays a string in YAML 1.2
ports: [8080, 8443]
env:
  LOG_LEVEL: info
  FEATURES:
    - offline
    - "quoted: value"
notes: |
  Multi-line text
  keeps its line breaks.
`;

export default defineTextTool({
  input: { label: 'Input', language: 'yaml', sample: SAMPLE, accept: '.yaml,.yml,.json,.txt' },
  output: { label: 'Output', language: 'json' },
  options: [
    {
      key: 'mode',
      label: 'Direction',
      type: 'segmented',
      choices: [
        { value: 'encode', label: 'YAML → JSON' },
        { value: 'decode', label: 'JSON → YAML' },
      ],
      default: 'encode',
    },
    {
      key: 'indent',
      label: 'Indent',
      type: 'select',
      choices: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
      ],
      default: '2',
    },
  ],
  swap: (values) => ({ mode: values.mode === 'encode' ? 'decode' : 'encode' }),
  run(input, o) {
    const indent = Number.parseInt(o.indent, 10);
    if (o.mode === 'decode') {
      const output = stringify(parseJson(input), { indent, lineWidth: 0 });
      return { output, language: 'yaml', filename: 'data.yaml' };
    }
    const documents = parseAllDocuments(input, { prettyErrors: true });
    const warnings: string[] = [];
    const values: unknown[] = [];
    for (const document of documents) {
      const error = document.errors[0];
      if (error) {
        const position = error.linePos?.[0];
        throw new ToolError(error.message.split('\n')[0] ?? 'Invalid YAML', { line: position?.line, column: position?.col });
      }
      for (const warning of document.warnings) warnings.push(warning.message.split('\n')[0] ?? '');
      values.push(document.toJS());
    }
    if (values.length === 0) throw new ToolError('The YAML document is empty.');
    if (values.length > 1) warnings.push(`${values.length} YAML documents were found; they are returned as a JSON array.`);
    const value = values.length === 1 ? values[0] : values;
    const output = JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), indent);
    if (output === undefined) throw new ToolError('This YAML value cannot be represented in JSON.');
    return { output, language: 'json', warnings: warnings.length > 0 ? warnings : undefined, filename: 'data.json' };
  },
});
