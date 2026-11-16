import { formatBytes, fromBase64, fromHex, toBase64, toHex } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

export const ENCODINGS = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'windows-1252',
  'iso-8859-1',
  'iso-8859-2',
  'iso-8859-5',
  'iso-8859-7',
  'iso-8859-15',
  'windows-1250',
  'windows-1251',
  'windows-1253',
  'windows-1254',
  'windows-1256',
  'koi8-r',
  'ibm866',
  'macintosh',
  'shift_jis',
  'euc-jp',
  'iso-2022-jp',
  'gbk',
  'gb18030',
  'big5',
  'euc-kr',
] as const;

const SINGLE_BYTE = new Set([
  'windows-1252',
  'iso-8859-1',
  'iso-8859-2',
  'iso-8859-5',
  'iso-8859-7',
  'iso-8859-15',
  'windows-1250',
  'windows-1251',
  'windows-1253',
  'windows-1254',
  'windows-1256',
  'koi8-r',
  'ibm866',
  'macintosh',
]);

const reverseTables = new Map<string, Map<string, number>>();

/** Encodes text in a single-byte encoding by inverting the platform's decoder. */
export function encodeSingleByte(text: string, encoding: string): { bytes: Uint8Array; unmappable: string[] } {
  let table = reverseTables.get(encoding);
  if (!table) {
    table = new Map();
    const decoder = new TextDecoder(encoding);
    for (let byte = 0; byte < 256; byte++) {
      const char = decoder.decode(new Uint8Array([byte]));
      if (char !== '\uFFFD' && !table.has(char)) table.set(char, byte);
    }
    reverseTables.set(encoding, table);
  }
  const bytes: number[] = [];
  const unmappable = new Set<string>();
  for (const char of text) {
    const byte = table.get(char);
    if (byte === undefined) {
      unmappable.add(char);
      bytes.push(0x3f);
    } else bytes.push(byte);
  }
  return { bytes: Uint8Array.from(bytes), unmappable: [...unmappable] };
}

export function encodeText(text: string, encoding: string): { bytes: Uint8Array; unmappable: string[] } {
  if (encoding === 'utf-8') return { bytes: new TextEncoder().encode(text), unmappable: [] };
  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      bytes[i * 2 + (encoding === 'utf-16le' ? 0 : 1)] = code & 255;
      bytes[i * 2 + (encoding === 'utf-16le' ? 1 : 0)] = code >> 8;
    }
    return { bytes, unmappable: [] };
  }
  if (SINGLE_BYTE.has(encoding)) return encodeSingleByte(text, encoding);
  throw new ToolError(`Writing ${encoding} is not supported; it can only be read. Choose UTF-8, UTF-16 or a single-byte encoding.`);
}

export default defineTextTool({
  input: { label: 'Input', binary: true, sample: 'CafÃ© MÃ¼nchen â€“ â€œquotesâ€\x9d', placeholder: 'Garbled text, hex, Base64 or a file' },
  output: { label: 'Output' },
  options: [
    {
      key: 'mode',
      label: 'Task',
      type: 'select',
      choices: [
        { value: 'repair', label: 'Repair garbled text (mojibake)' },
        { value: 'decode', label: 'Read bytes in an encoding' },
        { value: 'encode', label: 'Write text in an encoding' },
      ],
      default: 'repair',
    },
    {
      key: 'wrong',
      label: 'Text was wrongly read as',
      type: 'select',
      choices: [...ENCODINGS].filter((encoding) => SINGLE_BYTE.has(encoding)),
      default: 'windows-1252',
      showIf: (v) => v.mode === 'repair',
    },
    { key: 'actual', label: 'It really is', type: 'select', choices: [...ENCODINGS], default: 'utf-8', showIf: (v) => v.mode === 'repair' },
    {
      key: 'from',
      label: 'Bytes are',
      type: 'select',
      choices: [
        { value: 'file', label: 'The opened file' },
        { value: 'hex', label: 'Hex text' },
        { value: 'base64', label: 'Base64 text' },
      ],
      default: 'hex',
      showIf: (v) => v.mode === 'decode',
    },
    { key: 'encoding', label: 'Encoding', type: 'select', choices: [...ENCODINGS], default: 'windows-1252', showIf: (v) => v.mode !== 'repair' },
    {
      key: 'show',
      label: 'Show bytes as',
      type: 'segmented',
      choices: [
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ],
      default: 'hex',
      showIf: (v) => v.mode === 'encode',
    },
  ],
  run(input, o, ctx) {
    const fields: Field[] = [];
    if (o.mode === 'repair') {
      if (input === '') return '';
      const { bytes, unmappable } = encodeSingleByte(input, o.wrong);
      const repaired = new TextDecoder(o.actual).decode(bytes);
      if (unmappable.length > 0) fields.push({ label: 'Characters that do not fit the wrong encoding', value: unmappable.join(' '), tone: 'warn' });
      return { output: repaired, fields, info: `Re-encoded as ${o.wrong} and read as ${o.actual}.` };
    }
    if (o.mode === 'decode') {
      let bytes: Uint8Array;
      if (ctx.file) bytes = ctx.file.bytes;
      else if (input.trim() === '') return '';
      else {
        try {
          bytes = o.from === 'base64' ? fromBase64(input.trim()) : fromHex(input.trim());
        } catch {
          throw new ToolError(`The input is not valid ${o.from === 'base64' ? 'Base64' : 'hex'}. Open a file to read its bytes directly.`);
        }
      }
      const text = new TextDecoder(o.encoding).decode(bytes);
      const bad = (text.match(/\uFFFD/g) ?? []).length;
      return {
        output: text,
        fields: [
          { label: 'Bytes', value: formatBytes(bytes.length) },
          { label: 'Unreadable sequences', value: String(bad), tone: bad > 0 ? 'warn' : 'ok' },
        ],
      };
    }
    if (input === '' && !ctx.file) return '';
    const { bytes, unmappable } = encodeText(ctx.file ? new TextDecoder().decode(ctx.file.bytes) : input, o.encoding);
    if (unmappable.length > 0) fields.push({ label: `Not in ${o.encoding} (written as ?)`, value: unmappable.join(' '), tone: 'warn' });
    fields.push({ label: 'Bytes', value: formatBytes(bytes.length) });
    return { output: o.show === 'base64' ? toBase64(bytes) : toHex(bytes, { separator: ' ' }), fields, binary: { name: `text-${o.encoding}.txt`, mime: 'text/plain', bytes } };
  },
});
