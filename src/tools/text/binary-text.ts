import { utf8Decode, utf8Encode } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Values } from '../types';
import { MODE, swapMode } from './_shared';

const bits = (byte: number): string => byte.toString(2).padStart(8, '0');

function breakdown(bytes: Uint8Array): string {
  const rows = ['Binary    Dec  Hex  Char'];
  for (const byte of bytes) {
    const char = byte >= 32 && byte < 127 ? String.fromCharCode(byte) : byte < 128 ? '·' : '(UTF-8)';
    rows.push(`${bits(byte)}  ${String(byte).padStart(3)}  ${byte.toString(16).padStart(2, '0').toUpperCase()}   ${char}`);
  }
  return rows.join('\n');
}

export default defineTextTool({
  input: { label: 'Input', sample: 'Hi there' },
  output: { label: 'Output' },
  options: [
    {
      ...MODE,
      choices: [
        { value: 'encode', label: 'Text → Binary' },
        { value: 'decode', label: 'Binary → Text' },
      ],
    },
    {
      key: 'separator',
      label: 'Between bytes',
      type: 'select',
      choices: [
        { value: ' ', label: 'Space' },
        { value: '', label: 'Nothing' },
        { value: '\n', label: 'New line' },
      ],
      default: ' ',
      showIf: (v: Values) => v.mode === 'encode' && v.breakdown !== true,
    },
    { key: 'breakdown', label: 'Per-byte breakdown', type: 'toggle', default: false },
  ],
  swap: swapMode,
  run(input, o) {
    if (o.mode === 'encode') {
      const bytes = utf8Encode(input);
      return o.breakdown ? breakdown(bytes) : Array.from(bytes, bits).join(o.separator);
    }
    const digits = input.replace(/[^01]/g, '');
    const stray = /[^01\s,;|_-]/.exec(input);
    if (stray) throw new ToolError(`"${stray[0]}" is not a binary digit. Binary uses only 0 and 1.`);
    if (digits.length % 8 !== 0) {
      throw new ToolError(`Got ${digits.length} bits; binary text needs whole bytes (a multiple of 8 bits).`);
    }
    const bytes = new Uint8Array(digits.length / 8);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(digits.slice(i * 8, i * 8 + 8), 2);
    return o.breakdown ? { output: utf8Decode(bytes), fields: [{ label: 'Bytes', value: breakdown(bytes), mono: true }] } : utf8Decode(bytes);
  },
});
