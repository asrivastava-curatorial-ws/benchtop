import { byteLength, sizeChange } from '../../lib/bytes';
import { indentUnit, parseJsonLossless, writeJson } from '../../lib/json';
import { defineTextTool, type Values } from '../types';
import { INDENT } from './_shared';

const SAMPLE = `{"name":"Benchtop","version":"1.0.0","offline":true,"tags":["json","format","minify"],"limits":{"maxSafeInteger":9007199254740993,"ratio":1.50},"owner":null}`;

export default defineTextTool({
  input: { label: 'JSON', language: 'json', sample: SAMPLE, accept: '.json,.txt,application/json' },
  output: { label: 'Result', language: 'json' },
  options: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'segmented',
      choices: [
        { value: 'format', label: 'Format' },
        { value: 'minify', label: 'Minify' },
      ],
      default: 'format',
    },
    { ...INDENT, showIf: (v: Values) => v.mode === 'format' },
    { key: 'sortKeys', label: 'Sort keys', type: 'toggle', default: false },
  ],
  run(input, o) {
    const { root, duplicateKeys } = parseJsonLossless(input);
    const output = writeJson(root, { indent: o.mode === 'minify' ? '' : indentUnit(o.indent), sortKeys: o.sortKeys });
    return {
      output,
      info: `Valid JSON · ${sizeChange(byteLength(input), byteLength(output))}`,
      warnings: duplicateKeys.length > 0 ? [`Duplicate keys in the same object (parsers keep only the last value): ${duplicateKeys.map((key) => JSON.stringify(key)).join(', ')}`] : undefined,
      filename: 'data.json',
    };
  },
});
