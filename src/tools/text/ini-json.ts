import { decode, encode } from 'ini';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { defineTextTool } from '../types';

const SAMPLE = `; Projector settings
name = Planetarium
debug = false

[display]
width = 4096
height = 4096
brightness = 0.85

[network]
host = 192.168.10.20
port = 9000
allowed[] = control-room
allowed[] = booth
`;

export default defineTextTool({
  input: { label: 'Input', language: 'text', sample: SAMPLE, accept: '.ini,.cfg,.conf,.json' },
  output: { label: 'Output', language: 'json' },
  options: [
    {
      key: 'mode',
      label: 'Direction',
      type: 'segmented',
      choices: [
        { value: 'encode', label: 'INI → JSON' },
        { value: 'decode', label: 'JSON → INI' },
      ],
      default: 'encode',
    },
    { key: 'types', label: 'Convert numbers and true/false', type: 'toggle', default: true, help: 'INI has no types: everything is text unless converted.' },
    { key: 'spaces', label: 'Spaces around =', type: 'toggle', default: true },
  ],
  swap: (v) => ({ mode: v.mode === 'encode' ? 'decode' : 'encode' }),
  run(input, o) {
    if (o.mode === 'encode') {
      const data = decode(input);
      const convert = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(convert);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)]));
        if (!o.types || typeof value !== 'string') return value;
        if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
        return value;
      };
      return { output: `${JSON.stringify(convert(data), null, 2)}\n`, language: 'json' };
    }
    const data = parseJson(input);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new ToolError('INI needs a JSON object at the top level.');
    return { output: encode(data as Record<string, unknown>, { whitespace: o.spaces }), language: 'text' };
  },
});
