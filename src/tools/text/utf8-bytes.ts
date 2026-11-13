import { fromHex, toHex, utf8Decode, utf8Encode } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { MODE, swapMode } from './_shared';

function percentDecode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; ) {
    if (text[i] === '%') {
      const pair = text.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(pair)) {
        throw new ToolError(`Malformed percent-escape at position ${i + 1}: "%" must be followed by two hex digits.`);
      }
      out.push(Number.parseInt(pair, 16));
      i += 3;
    } else {
      const point = text.codePointAt(i) ?? 0;
      const ch = String.fromCodePoint(point);
      out.push(...utf8Encode(ch));
      i += ch.length;
    }
  }
  return Uint8Array.from(out);
}

function parseBytes(text: string, format: string): Uint8Array {
  if (format === 'percent') return percentDecode(text.trim());
  if (format === 'hex') return fromHex(text);
  const radix = format === 'binary' ? 2 : 10;
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  return Uint8Array.from(
    tokens.map((token) => {
      const value = (radix === 2 ? /^[01]{1,8}$/ : /^[0-9]{1,3}$/).test(token) ? Number.parseInt(token, radix) : Number.NaN;
      if (!(value >= 0 && value <= 255)) throw new ToolError(`"${token}" is not a byte value (0-255) in ${format}.`);
      return value;
    }),
  );
}

function formatBytesAs(bytes: Uint8Array, format: string): string {
  switch (format) {
    case 'percent':
      return toHex(bytes, { upper: true, prefix: '%' });
    case 'hex':
      return toHex(bytes, { separator: ' ' });
    case 'binary':
      return Array.from(bytes, (byte) => byte.toString(2).padStart(8, '0')).join(' ');
    default:
      return Array.from(bytes).join(' ');
  }
}

function codePointFields(text: string): Field[] {
  const fields: Field[] = [];
  for (const ch of text) {
    if (fields.length >= 40) {
      fields.push({ label: '…', value: 'Only the first 40 characters are listed', tone: 'muted' });
      break;
    }
    const point = ch.codePointAt(0) ?? 0;
    const bytes = utf8Encode(ch);
    fields.push({
      label: `U+${point.toString(16).toUpperCase().padStart(4, '0')}  ${point < 32 || point === 127 ? '␀' : ch}`,
      value: `${toHex(bytes, { separator: ' ' })}  (${bytes.length} byte${bytes.length === 1 ? '' : 's'})`,
      mono: true,
    });
  }
  return fields;
}

export default defineTextTool({
  input: { label: 'Input', sample: 'naïve ✓ 日本 🚀' },
  output: { label: 'Output' },
  options: [
    {
      ...MODE,
      choices: [
        { value: 'encode', label: 'Text → Bytes' },
        { value: 'decode', label: 'Bytes → Text' },
      ],
    },
    {
      key: 'format',
      label: 'Byte format',
      type: 'select',
      choices: [
        { value: 'hex', label: 'Hex (e2 9c 93)' },
        { value: 'percent', label: 'Percent (%E2%9C%93)' },
        { value: 'decimal', label: 'Decimal (226 156 147)' },
        { value: 'binary', label: 'Binary (11100010 …)' },
      ],
      default: 'hex',
    },
  ],
  swap: swapMode,
  run(input, o) {
    if (o.mode === 'encode') {
      const bytes = utf8Encode(input);
      return {
        output: formatBytesAs(bytes, o.format),
        fields: codePointFields(input),
        info: `${Array.from(input).length} code points → ${bytes.length} bytes`,
      };
    }
    const bytes = parseBytes(input, o.format);
    const text = utf8Decode(bytes);
    return { output: text, fields: codePointFields(text), info: `${bytes.length} bytes → ${Array.from(text).length} code points` };
  },
});
