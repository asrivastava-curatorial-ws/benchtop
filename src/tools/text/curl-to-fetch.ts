import { curlToFetch } from '../../lib/curl';
import { CURL_LANGUAGES, type CurlLanguage, curlToCode } from '../../lib/curl-code';
import { indentUnit } from '../../lib/json';
import { defineTextTool } from '../types';
import { INDENT } from './_shared';

const SAMPLE = `curl -X POST 'https://api.example.org/v1/users?notify=true' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer YOUR_TOKEN' \\
  --max-time 10 -L \\
  -d '{"name": "Ada Lovelace", "roles": ["admin", "editor"], "active": true}'`;

const isJs = (v: Record<string, unknown>) => v.language === 'javascript';

export default defineTextTool({
  input: { label: 'curl command', sample: SAMPLE, placeholder: "curl 'https://example.org/api' -H 'Accept: application/json'" },
  output: { label: 'Code', language: 'javascript' },
  options: [
    {
      key: 'language',
      label: 'Language',
      type: 'select',
      choices: [{ value: 'javascript', label: 'JavaScript (fetch)' }, ...CURL_LANGUAGES.map(({ value, label }) => ({ value, label }))],
      default: 'javascript',
    },
    {
      key: 'style',
      label: 'Style',
      type: 'select',
      choices: [
        { value: 'await', label: 'async / await' },
        { value: 'then', label: 'Promise chain (.then)' },
      ],
      default: 'await',
      showIf: isJs,
    },
    { ...INDENT, showIf: isJs },
  ],
  run(input, o) {
    if (o.language === 'javascript') {
      const { code, warnings } = curlToFetch(input, { style: o.style as 'await' | 'then', indent: indentUnit(o.indent) });
      return { output: code, language: 'javascript', warnings: warnings.length > 0 ? warnings : undefined, filename: 'request.js' };
    }
    const target = CURL_LANGUAGES.find((language) => language.value === o.language) ?? (CURL_LANGUAGES[0] as (typeof CURL_LANGUAGES)[number]);
    const { code, warnings } = curlToCode(input, target.value as CurlLanguage);
    return { output: code, language: 'text', warnings: warnings.length > 0 ? warnings : undefined, filename: target.filename };
  },
});
