import { byteLength, sizeChange } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

export const SVG_SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with a vector editor -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120.000" height="120.000" viewBox="0 0 120 120" version="1.1" id="svg1">
  <title>Sample badge</title>
  <metadata>editor metadata that can be dropped</metadata>
  <defs>
    <linearGradient id="gradient-fill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1.000" />
      <stop offset="100%" style="stop-color:#06b6d4;stop-opacity:1.000" />
    </linearGradient>
  </defs>
  <rect x="0.000" y="0.000" width="120.000" height="120.000" fill="#ffffff" />
  <g id="layer1" transform="translate(0.000000,0.000000)">
    <circle cx="60.0000" cy="60.0000" r="44.0000" fill="url(#gradient-fill)" stroke="#1e293b" stroke-width="4.0000" />
    <path d="M 40.000,62.000 L 54.000,76.000 L 82.000,46.000" fill="none" stroke="#ffffff" stroke-width="8.000" stroke-linecap="round" stroke-linejoin="round" />
  </g>
</svg>`;

export default defineTextTool({
  input: { label: 'SVG', language: 'xml', sample: SVG_SAMPLE, accept: '.svg,image/svg+xml' },
  output: { label: 'Optimised SVG', language: 'xml' },
  options: [
    { key: 'precision', label: 'Decimal places', type: 'range', default: 2, min: 0, max: 6, step: 1 },
    { key: 'multipass', label: 'Multiple passes', type: 'toggle', default: true },
    { key: 'keepIds', label: 'Keep IDs', type: 'toggle', default: false, help: 'Enable when CSS or scripts refer to element IDs.' },
    { key: 'dimensions', label: 'Drop width/height (keep viewBox)', type: 'toggle', default: false },
    { key: 'pretty', label: 'Readable output', type: 'toggle', default: false },
  ],
  async run(input, o) {
    const { optimize } = await import('svgo/browser');
    let output: string;
    try {
      output = optimize(input, {
        multipass: o.multipass,
        floatPrecision: o.precision,
        js2svg: { pretty: o.pretty, indent: 2 },
        plugins: [{ name: 'preset-default', params: { overrides: o.keepIds ? { cleanupIds: false } : {} } }, ...(o.dimensions ? (['removeDimensions'] as const) : [])],
      }).data;
    } catch (error) {
      const detail = error as { reason?: string; message?: string; line?: number; column?: number };
      throw new ToolError(`${detail.reason ?? detail.message?.split('\n')[0] ?? 'Invalid SVG'}${detail.line ? ` (line ${detail.line}, column ${detail.column})` : ''}.`, {
        line: detail.line,
        column: detail.column,
      });
    }
    return {
      output,
      preview: { kind: 'svg', svg: output, checker: true },
      info: sizeChange(byteLength(input), byteLength(output)),
      filename: 'image.min.svg',
    };
  },
});
