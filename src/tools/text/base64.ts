import { formatBytes, fromBase64, toBase64, utf8Decode, utf8Encode, wrapLines } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Values } from '../types';
import { decodedResult, isEncode, MODE, swapMode } from './_shared';

export default defineTextTool({
  input: {
    label: 'Input',
    placeholder: 'Type or paste text, open any file, or paste Base64 / a data: URI to decode',
    sample: 'Hello, Benchtop! ✓',
    binary: true,
  },
  output: { label: 'Output' },
  options: [
    MODE,
    {
      key: 'variant',
      label: 'Alphabet',
      type: 'select',
      choices: [
        { value: 'standard', label: 'Standard (+ /)' },
        { value: 'url', label: 'URL-safe (- _)' },
      ],
      default: 'standard',
      showIf: isEncode,
    },
    { key: 'padding', label: 'Padding (=)', type: 'toggle', default: true, showIf: isEncode },
    {
      key: 'wrap',
      label: 'Wrap lines',
      type: 'select',
      choices: [
        { value: '0', label: 'No wrapping' },
        { value: '64', label: '64 columns (PEM)' },
        { value: '76', label: '76 columns (MIME)' },
      ],
      default: '0',
      showIf: (v: Values) => isEncode(v) && v.dataUri !== true,
    },
    { key: 'dataUri', label: 'As data: URI', type: 'toggle', default: false, showIf: isEncode },
  ],
  swap: swapMode,
  run(input, o, ctx) {
    if (o.mode === 'encode') {
      const bytes = ctx.file ? ctx.file.bytes : utf8Encode(input);
      const encoded = toBase64(bytes, { urlSafe: o.variant === 'url', pad: o.padding });
      const mime = ctx.file ? ctx.file.mime || 'application/octet-stream' : 'text/plain;charset=utf-8';
      const output = o.dataUri ? `data:${mime};base64,${encoded}` : wrapLines(encoded, Number(o.wrap));
      return { output, info: `${formatBytes(bytes.length)} → ${formatBytes(output.length)} of Base64` };
    }

    const text = (ctx.file ? utf8Decode(ctx.file.bytes) : input).trim();
    const dataUri = /^data:([^;,]*)([^,]*),/i.exec(text);
    if (dataUri) {
      const body = text.slice(dataUri[0].length);
      const mime = dataUri[1] ?? '';
      if (/;base64$/i.test(dataUri[2] ?? '')) return decodedResult(fromBase64(body), mime);
      try {
        return { output: decodeURIComponent(body), info: 'Decoded a percent-encoded data: URI' };
      } catch {
        throw new ToolError('The data: URI is neither Base64 nor valid percent-encoding.');
      }
    }
    return decodedResult(fromBase64(text));
  },
});
