import { formatBytes, toBase64 } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { sniffType } from '../../lib/text';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: { label: 'Image', binary: true, accept: 'image/*,.svg,.ico', placeholder: 'Open or drop an image file' },
  output: { label: 'Output' },
  options: [
    {
      key: 'format',
      label: 'Output as',
      type: 'select',
      choices: [
        { value: 'uri', label: 'data: URI' },
        { value: 'raw', label: 'Raw Base64' },
        { value: 'css', label: 'CSS background' },
        { value: 'html', label: 'HTML <img>' },
        { value: 'markdown', label: 'Markdown image' },
      ],
      default: 'uri',
    },
  ],
  run(_input, o, ctx) {
    if (!ctx.file) throw new ToolError('Open or drop an image file to encode it.');
    const { bytes, name } = ctx.file;
    const mime = sniffType(bytes)?.mime ?? (ctx.file.mime || 'application/octet-stream');
    if (!mime.startsWith('image/')) throw new ToolError(`"${name}" does not look like an image (${mime}).`);
    const raw = toBase64(bytes);
    const uri = `data:${mime};base64,${raw}`;
    const alt = name.replace(/\.[^.]+$/, '');
    const output =
      o.format === 'raw'
        ? raw
        : o.format === 'css'
          ? `background-image: url("${uri}");`
          : o.format === 'html'
            ? `<img src="${uri}" alt="${alt.replace(/"/g, '&quot;')}">`
            : o.format === 'markdown'
              ? `![${alt.replace(/[[\]]/g, '')}](${uri})`
              : uri;
    return {
      output,
      preview: { kind: 'image', bytes, mime },
      fields: [
        { label: 'Type', value: mime },
        { label: 'Original size', value: formatBytes(bytes.length) },
        { label: 'Encoded size', value: `${formatBytes(uri.length)} (${((uri.length / Math.max(1, bytes.length) - 1) * 100).toFixed(0)}% larger)` },
      ],
    };
  },
});
