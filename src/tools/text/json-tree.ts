import { parseJson } from '../../lib/json';
import { esc } from '../../lib/net/report';
import { defineTextTool } from '../types';

const MAX_NODES = 20_000;

function render(value: unknown, key: string | null, depth: number, open: number, budget: { left: number }, path: string): string {
  budget.left--;
  const label = key === null ? '' : `<span class="json-key">${esc(key)}</span>: `;
  if (value === null || typeof value !== 'object') {
    const kind = value === null ? 'null' : typeof value;
    const text = typeof value === 'string' ? JSON.stringify(value) : String(value);
    return `<li title="${esc(path)}">${label}<span class="json-${kind}">${esc(text)}</span></li>`;
  }
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value as Record<string, unknown>);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  if (budget.left <= 0) return `<li>${label}<span class="json-more">${summary} not shown (document too large)</span></li>`;
  const children = entries
    .map(([childKey, child]) =>
      render(
        child,
        childKey,
        depth + 1,
        open,
        budget,
        Array.isArray(value) ? `${path}[${childKey}]` : /^[A-Za-z_$][\w$]*$/.test(childKey) ? `${path}.${childKey}` : `${path}[${JSON.stringify(childKey)}]`,
      ),
    )
    .join('');
  return `<li><details${depth < open ? ' open' : ''}><summary title="${esc(path)}">${label}<span class="json-count">${summary}</span></summary><ul>${children}</ul></details></li>`;
}

export default defineTextTool({
  input: {
    label: 'JSON',
    language: 'json',
    sample:
      '{\n  "museum": "Example",\n  "open": true,\n  "galleries": [\n    { "name": "Engines", "exhibits": 42 },\n    { "name": "Space", "exhibits": 31, "tags": ["rockets", "satellites"] }\n  ],\n  "address": { "city": "Bengaluru", "pin": null }\n}',
  },
  output: false,
  options: [{ key: 'open', label: 'Open levels', type: 'number', default: 2, min: 0, max: 20, step: 1, help: 'Click a row to open or close it. Hover over a value to see its path.' }],
  mainThread: false,
  run(input, o) {
    if (input.trim() === '') return {};
    const value = parseJson(input);
    const budget = { left: MAX_NODES };
    const html = `<ul class="json-tree">${render(value, null, 0, o.open, budget, '$')}</ul>`;
    return { preview: { kind: 'html', html }, info: budget.left <= 0 ? `Showing the first ${MAX_NODES.toLocaleString('en-US')} values.` : undefined };
  },
});
