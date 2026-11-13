import { parseDotenv, stringifyDotenv } from '../../lib/devops';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { defineTextTool, type Values } from '../types';

const SAMPLE = `# Ticketing service
export APP_NAME="VITM Tickets"
PORT=8080
DATABASE_URL=postgres://tickets@localhost:5432/tickets
FEATURE_FLAGS=online-booking,group-discounts
WELCOME_MESSAGE="Welcome!\\nShows start every hour."
`;

export default defineTextTool({
  input: { label: 'Input', sample: SAMPLE, accept: '.env,.json,.txt' },
  output: { label: 'Output', language: 'json' },
  options: [
    {
      key: 'mode',
      label: 'Direction',
      type: 'segmented',
      choices: [
        { value: 'encode', label: '.env → JSON' },
        { value: 'decode', label: 'JSON → .env' },
      ],
      default: 'encode',
    },
    { key: 'types', label: 'Convert numbers and true/false', type: 'toggle', default: false, showIf: (v: Values) => v.mode === 'encode' },
    { key: 'export', label: 'Prefix with export', type: 'toggle', default: false, showIf: (v: Values) => v.mode === 'decode' },
  ],
  swap: (v) => ({ mode: v.mode === 'encode' ? 'decode' : 'encode' }),
  run(input, o) {
    if (o.mode === 'decode') {
      const data = parseJson(input);
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new ToolError('Give a JSON object of names and values.');
      return { output: stringifyDotenv(data as Record<string, unknown>, o.export), language: 'text', filename: '.env' };
    }
    const { values, duplicates } = parseDotenv(input);
    const typed = o.types
      ? Object.fromEntries(Object.entries(values).map(([key, value]) => [key, /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value === 'true' ? true : value === 'false' ? false : value]))
      : values;
    return {
      output: `${JSON.stringify(typed, null, 2)}\n`,
      language: 'json',
      warnings: duplicates.length > 0 ? [`Defined more than once (the last value wins): ${duplicates.join(', ')}`] : [],
      info: `${Object.keys(values).length} variables`,
    };
  },
});
