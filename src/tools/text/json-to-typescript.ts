import { indentUnit, parseJson } from '../../lib/json';
import { jsonToTypeScript } from '../../lib/json-to-ts';
import { defineTextTool } from '../types';
import { INDENT } from './_shared';

const SAMPLE = `{
  "id": 42,
  "name": "Ada Lovelace",
  "email": null,
  "roles": ["admin", "editor"],
  "address": { "city": "London", "geo": { "lat": 51.5, "lng": -0.12 } },
  "projects": [
    { "id": 1, "title": "Analytical Engine", "tags": ["math"], "archived": false },
    { "id": 2, "title": "Notes", "tags": [], "stars": 128 }
  ]
}`;

export default defineTextTool({
  input: { label: 'JSON sample', language: 'json', sample: SAMPLE, accept: '.json,.txt,application/json' },
  output: { label: 'TypeScript', language: 'typescript' },
  options: [
    { key: 'rootName', label: 'Root type name', type: 'text', default: 'Root', mono: true },
    {
      key: 'style',
      label: 'Declare with',
      type: 'select',
      choices: [
        { value: 'interface', label: 'interface' },
        { value: 'type', label: 'type alias' },
      ],
      default: 'interface',
    },
    { key: 'exportTypes', label: 'export', type: 'toggle', default: true },
    {
      key: 'nullAsOptional',
      label: 'null → optional',
      type: 'toggle',
      default: false,
      help: 'Write "key?: T" instead of "key: T | null" for values that are sometimes null.',
    },
    INDENT,
  ],
  run(input, o) {
    return {
      output: jsonToTypeScript(parseJson(input), {
        rootName: o.rootName,
        typeAliases: o.style === 'type',
        exportTypes: o.exportTypes,
        nullAsOptional: o.nullAsOptional,
        indent: indentUnit(o.indent),
      }),
      filename: 'types.ts',
    };
  },
});
