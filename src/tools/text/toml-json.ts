import { parse, stringify } from 'smol-toml';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { defineTextTool } from '../types';

const SAMPLE = `# Exhibit kiosk settings
title = "Find the Queen"
version = "1.2.0"
fullscreen = true
round_seconds = 25
started = 2026-08-15T09:30:00+05:30

[display]
width = 1080
height = 1080
shape = "circle"

[[videos]]
file = "hive-01.mp4"
queen_visible = true

[[videos]]
file = "hive-02.mp4"
queen_visible = false
`;

/** JSON has no dates: TOML dates and times become ISO strings. */
const toJsonValue = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonValue(v)]));
  return value;
};

export default defineTextTool({
  input: { label: 'Input', language: 'text', sample: SAMPLE, accept: '.toml,.json' },
  output: { label: 'Output', language: 'json' },
  options: [
    {
      key: 'mode',
      label: 'Direction',
      type: 'segmented',
      choices: [
        { value: 'encode', label: 'TOML → JSON' },
        { value: 'decode', label: 'JSON → TOML' },
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
        { value: 'tab', label: 'Tab' },
      ],
      default: '2',
    },
  ],
  swap: (v) => ({ mode: v.mode === 'encode' ? 'decode' : 'encode' }),
  run(input, o) {
    if (o.mode === 'encode') {
      let data: unknown;
      try {
        data = parse(input);
      } catch (error) {
        const e = error as { message: string; line?: number; column?: number };
        throw new ToolError(e.message.split('\n')[0] ?? 'Invalid TOML.', { line: e.line, column: e.column });
      }
      return { output: `${JSON.stringify(toJsonValue(data), null, o.indent === 'tab' ? '\t' : Number(o.indent))}\n`, language: 'json' };
    }
    const data = parseJson(input);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new ToolError('TOML needs a JSON object at the top level.');
    try {
      return { output: `${stringify(data)}\n`, language: 'text' };
    } catch (error) {
      throw new ToolError(`This JSON cannot be written as TOML: ${(error as Error).message}`);
    }
  },
});
