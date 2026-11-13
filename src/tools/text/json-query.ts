import { JSONPath } from 'jsonpath-plus';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { defineTextTool, type Values } from '../types';

const SAMPLE = `{
  "museum": "VITM",
  "galleries": [
    { "name": "Engine Hall", "floor": 0, "exhibits": [{ "id": 1, "title": "Steam engine", "working": true }, { "id": 2, "title": "Jet engine", "working": false }] },
    { "name": "Space", "floor": 1, "exhibits": [{ "id": 3, "title": "Rocket model", "working": true }] }
  ]
}`;

export default defineTextTool({
  input: { label: 'JSON', language: 'json', sample: SAMPLE, accept: '.json' },
  output: { label: 'Result', language: 'json' },
  options: [
    {
      key: 'engine',
      label: 'Language',
      type: 'segmented',
      choices: [
        { value: 'jsonpath', label: 'JSONPath' },
        { value: 'jq', label: 'jq' },
      ],
      default: 'jsonpath',
    },
    {
      key: 'path',
      label: 'JSONPath',
      type: 'text',
      default: '$.galleries[*].exhibits[?(@.working)].title',
      mono: true,
      wide: true,
      showIf: (v: Values) => v.engine === 'jsonpath',
      help: 'Examples: $..title, $.galleries[0].name, $..exhibits[?(@.id > 1)]',
    },
    {
      key: 'jq',
      label: 'jq filter',
      type: 'text',
      default: '[.galleries[] | {name, count: (.exhibits | length)}]',
      mono: true,
      wide: true,
      showIf: (v: Values) => v.engine === 'jq',
      help: 'Runs jq 1.8 (compiled to WebAssembly) on this computer.',
    },
    { key: 'paths', label: 'Show paths', type: 'toggle', default: false, showIf: (v: Values) => v.engine === 'jsonpath' },
  ],
  async run(input, o) {
    if (o.engine === 'jq') {
      const { raw } = await import('jq-wasm');
      if (o.jq.trim() === '') return { output: '' };
      const result = await raw(input, o.jq, ['--indent', '2']);
      if (result.exitCode !== 0) throw new ToolError(result.stderr.trim().replace(/^jq: /, '') || 'jq could not run this filter.');
      return { output: result.stdout, info: result.stderr.trim() || undefined };
    }
    const json = parseJson(input);
    if (o.path.trim() === '') return { output: '' };
    let values: unknown[];
    try {
      values = JSONPath({ path: o.path, json: json as object, resultType: o.paths ? 'path' : 'value', eval: 'safe', wrap: true }) as unknown[];
    } catch (error) {
      throw new ToolError(`This JSONPath is not valid: ${(error as Error).message}`);
    }
    return { output: `${JSON.stringify(values, null, 2)}\n`, info: `${values.length} result${values.length === 1 ? '' : 's'}` };
  },
});
