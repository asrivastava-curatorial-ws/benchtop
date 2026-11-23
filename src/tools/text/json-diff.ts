import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { type ArrayMode, describeChanges, diffJson, toJsonPatch } from '../../lib/json-diff';
import { defineTextTool, type Field } from '../types';

const BEFORE = `{
  "museum": "VITM",
  "galleries": [
    { "id": 1, "name": "Engine Hall", "exhibits": 24 },
    { "id": 2, "name": "Electrotechnic", "exhibits": 31 }
  ],
  "open": "09:30",
  "closedOn": ["Diwali"]
}`;

const AFTER = `{
  "museum": "VITM",
  "galleries": [
    { "id": 1, "name": "Engine Hall", "exhibits": 26 },
    { "id": 3, "name": "Space Gallery", "exhibits": 18 },
    { "id": 2, "name": "Electrotechnic", "exhibits": 31 }
  ],
  "open": "10:00",
  "tickets": { "adult": 90 }
}`;

export default defineTextTool({
  input: { label: 'First JSON', language: 'json', sample: BEFORE, accept: '.json' },
  input2: { label: 'Second JSON', language: 'json', sample: AFTER, accept: '.json' },
  output: { label: 'Differences' },
  options: [
    {
      key: 'view',
      label: 'Show',
      type: 'segmented',
      choices: [
        { value: 'list', label: 'List of changes' },
        { value: 'patch', label: 'JSON Patch (RFC 6902)' },
      ],
      default: 'list',
    },
    {
      key: 'arrays',
      label: 'Compare lists',
      type: 'select',
      choices: [
        { value: 'lcs', label: 'Find inserted and removed items' },
        { value: 'index', label: 'Item by item, by position' },
        { value: 'unordered', label: 'Ignore the order of items' },
      ],
      default: 'lcs',
    },
    {
      key: 'matchKey',
      label: 'Pair list items by',
      type: 'text',
      default: 'id',
      mono: true,
      help: 'Objects in lists with the same value in this field are compared with each other. Leave empty to turn off.',
    },
    { key: 'ignoreKeys', label: 'Ignore keys', type: 'text', default: '', mono: true, help: 'Comma-separated, such as updatedAt, etag.' },
    { key: 'tolerance', label: 'Numbers equal within', type: 'number', default: 0, min: 0, max: 1e12, step: 0.001 },
    { key: 'ignoreCase', label: 'Ignore case in text', type: 'toggle', default: false },
  ],
  run(input, o, ctx) {
    if (!input.trim() || !ctx.input2.trim()) return { output: '', info: 'Paste one JSON document on each side.' };
    const parse = (text: string, side: string) => {
      try {
        return parseJson(text);
      } catch (error) {
        throw new ToolError(`${side}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const a = parse(input, 'First JSON');
    const b = parse(ctx.input2, 'Second JSON');
    const changes = diffJson(a, b, {
      arrays: o.arrays as ArrayMode,
      matchKey: o.matchKey.trim() || undefined,
      ignoreKeys: o.ignoreKeys
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      tolerance: o.tolerance,
      ignoreCase: o.ignoreCase,
    });
    const count = (op: string) => changes.filter((c) => c.op === op).length;
    const fields: Field[] = [
      { label: 'Added', value: String(count('add')), tone: count('add') ? 'ok' : 'muted' },
      { label: 'Removed', value: String(count('remove')), tone: count('remove') ? 'bad' : 'muted' },
      { label: 'Changed', value: String(count('replace')), tone: count('replace') ? 'warn' : 'muted' },
    ];
    if (!changes.length) return { output: o.view === 'patch' ? '[]\n' : '', fields, info: 'The documents are the same under these settings.' };
    return {
      output: o.view === 'patch' ? `${JSON.stringify(toJsonPatch(changes), null, 2)}\n` : `${describeChanges(changes)}\n`,
      language: o.view === 'patch' ? 'json' : 'text',
      filename: o.view === 'patch' ? 'changes.patch.json' : 'changes.txt',
      fields,
      info: `${changes.length} change${changes.length === 1 ? '' : 's'}. + added, − removed, ~ changed; paths are JSON Pointers.${o.matchKey.trim() || o.arrays === 'unordered' ? ' The patch reproduces the second document except for the order of paired list items.' : ''}`,
    };
  },
});
