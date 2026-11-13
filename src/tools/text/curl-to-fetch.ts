import { curlToFetch } from '../../lib/curl';
import { indentUnit } from '../../lib/json';
import { defineTextTool } from '../types';
import { INDENT } from './_shared';

const SAMPLE = `curl -X POST 'https://api.example.org/v1/users?notify=true' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer YOUR_TOKEN' \\
  --max-time 10 -L \\
  -d '{"name": "Ada Lovelace", "roles": ["admin", "editor"], "active": true}'`;

export default defineTextTool({
  input: { label: 'curl command', sample: SAMPLE, placeholder: "curl 'https://example.org/api' -H 'Accept: application/json'" },
  output: { label: 'JavaScript', language: 'javascript' },
  options: [
    {
      key: 'style',
      label: 'Style',
      type: 'select',
      choices: [
        { value: 'await', label: 'async / await' },
        { value: 'then', label: 'Promise chain (.then)' },
      ],
      default: 'await',
    },
    INDENT,
  ],
  run(input, o) {
    const { code, warnings } = curlToFetch(input, { style: o.style as 'await' | 'then', indent: indentUnit(o.indent) });
    return { output: code, warnings: warnings.length > 0 ? warnings : undefined, filename: 'request.js' };
  },
});
