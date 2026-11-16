import { deflateSync, gunzipSync, gzipSync, inflateSync, unzlibSync, zlibSync } from 'fflate';
import { formatBytes, fromBase64, fromHex, sizeChange, toBase64, toHex, utf8Encode } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';
import { decodedResult } from './_shared';

export default defineTextTool({
  input: { label: 'Text or file', binary: true, sample: 'The galleries open at 10 am. '.repeat(20), placeholder: 'Text to compress, Base64/hex to decompress, or open a .gz file' },
  output: { label: 'Result' },
  options: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'segmented',
      choices: [
        { value: 'compress', label: 'Compress' },
        { value: 'decompress', label: 'Decompress' },
      ],
      default: 'compress',
    },
    {
      key: 'format',
      label: 'Format',
      type: 'select',
      choices: [
        { value: 'gzip', label: 'gzip (.gz, HTTP)' },
        { value: 'zlib', label: 'zlib (PNG, PDF)' },
        { value: 'deflate', label: 'Raw deflate' },
        { value: 'auto', label: 'Detect (decompress only)' },
      ],
      default: 'gzip',
    },
    { key: 'level', label: 'Level', type: 'range', default: 6, min: 0, max: 9, step: 1, showIf: (v) => v.mode === 'compress' },
    {
      key: 'encoding',
      label: 'Text form',
      type: 'segmented',
      choices: [
        { value: 'base64', label: 'Base64' },
        { value: 'hex', label: 'Hex' },
      ],
      default: 'base64',
    },
  ],
  swap: (v) => ({ mode: v.mode === 'compress' ? 'decompress' : 'compress' }),
  run(input, o, ctx) {
    if (o.mode === 'compress') {
      const data = ctx.file ? ctx.file.bytes : utf8Encode(input);
      if (data.length === 0) return '';
      const level = o.level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
      const packed = o.format === 'zlib' ? zlibSync(data, { level }) : o.format === 'deflate' ? deflateSync(data, { level }) : gzipSync(data, { level, filename: ctx.file?.name });
      const name = `${ctx.file?.name ?? 'data'}.${o.format === 'zlib' ? 'zz' : o.format === 'deflate' ? 'deflate' : 'gz'}`;
      return {
        output: o.encoding === 'hex' ? toHex(packed) : toBase64(packed),
        binary: { name, mime: 'application/gzip', bytes: packed },
        info: `${formatBytes(data.length)} → ${formatBytes(packed.length)} (${sizeChange(data.length, packed.length)})`,
      };
    }
    let packed: Uint8Array;
    if (ctx.file) packed = ctx.file.bytes;
    else {
      const text = input.trim();
      if (text === '') return '';
      try {
        packed = /^[0-9a-f\s]+$/i.test(text) && o.encoding === 'hex' ? fromHex(text) : fromBase64(text);
      } catch {
        throw new ToolError(`The input is not valid ${o.encoding === 'hex' ? 'hex' : 'Base64'}.`);
      }
    }
    const first = packed[0] ?? 0;
    const zlibHeader = (first & 0x0f) === 8 && ((first << 8) | (packed[1] ?? 0)) % 31 === 0;
    const format = o.format !== 'auto' ? o.format : first === 0x1f && packed[1] === 0x8b ? 'gzip' : zlibHeader ? 'zlib' : 'deflate';
    let data: Uint8Array;
    try {
      data = format === 'gzip' ? gunzipSync(packed) : format === 'zlib' ? unzlibSync(packed) : inflateSync(packed);
    } catch {
      throw new ToolError(`This is not valid ${format} data. Try another format or Detect.`);
    }
    return { ...decodedResult(data), info: `${format}: ${formatBytes(packed.length)} → ${formatBytes(data.length)}` };
  },
});
