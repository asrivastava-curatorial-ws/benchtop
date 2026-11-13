import { Validator } from '@cfworker/json-schema';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { defineTextTool, type Field } from '../types';

const DATA = `{
  "id": 42,
  "name": "Pendulum",
  "tags": ["physics", "physics"],
  "dimensions": { "height": -3 }
}`;

const SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["id", "name", "gallery"],
  "properties": {
    "id": { "type": "integer", "minimum": 1 },
    "name": { "type": "string", "minLength": 2 },
    "gallery": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" }, "uniqueItems": true },
    "dimensions": {
      "type": "object",
      "properties": { "height": { "type": "number", "exclusiveMinimum": 0 } }
    }
  },
  "additionalProperties": false
}`;

const SUMMARY_KEYWORDS = new Set(['properties', 'patternProperties', 'items', 'prefixItems', 'allOf', '$ref', '$dynamicRef', '$recursiveRef', 'dependentSchemas', 'then', 'else', 'false']);

export default defineTextTool({
  input: { label: 'JSON data', language: 'json', sample: DATA, accept: '.json' },
  input2: { label: 'JSON Schema', language: 'json', sample: SCHEMA, accept: '.json' },
  output: { label: 'Report' },
  options: [
    { key: 'draft', label: 'Draft', type: 'select', choices: [{ value: 'auto', label: 'From $schema (default 2020-12)' }, '2020-12', '2019-09', '7', '4'], default: 'auto' },
    { key: 'all', label: 'Report every error', type: 'toggle', default: true },
  ],
  runOnEmpty: true,
  run(input, o, ctx) {
    if (input.trim() === '' || ctx.input2.trim() === '') return { output: '', info: 'Paste the data on the left and the schema on the right.' };
    const data = parseJson(input);
    let schema: unknown;
    try {
      schema = parseJson(ctx.input2);
    } catch (error) {
      throw new ToolError(`The schema is not valid JSON: ${(error as Error).message}`);
    }
    if (typeof schema !== 'object' && typeof schema !== 'boolean') throw new ToolError('A schema must be a JSON object (or true/false).');
    const fromSchema = typeof schema === 'object' && schema !== null ? String((schema as { $schema?: unknown }).$schema ?? '') : '';
    const draft = o.draft !== 'auto' ? o.draft : /draft-04/.test(fromSchema) ? '4' : /draft-07/.test(fromSchema) ? '7' : /2019-09/.test(fromSchema) ? '2019-09' : '2020-12';
    const validator = new Validator(schema as object, draft as '4' | '7' | '2019-09' | '2020-12', !o.all);
    const result = validator.validate(data);
    // The validator also reports every parent keyword whose subschema failed ("Property "x" does not match
    // schema"); those summaries repeat the specific errors below them, so only the specific ones are shown.
    const errors = result.errors.filter((error) => !SUMMARY_KEYWORDS.has(error.keyword));
    const shown = errors.length > 0 ? errors : result.errors;
    const fields: Field[] = [
      { label: 'Result', value: result.valid ? 'Valid' : `${shown.length} problem${shown.length === 1 ? '' : 's'}`, tone: result.valid ? 'ok' : 'bad' },
      { label: 'Draft', value: draft },
    ];
    const lines = shown.map((error) => `${error.instanceLocation.replace(/^#/, '') || '/'}  ${error.error}  (${error.keyword})`);
    return { output: result.valid ? 'The data matches the schema.\n' : `${lines.join('\n')}\n`, fields };
  },
});
