import { toBase64, utf8Encode } from '../../lib/bytes';
import { escapeXml } from '../../lib/text';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: false,
  output: { label: 'SVG', language: 'xml' },
  options: [
    { key: 'width', label: 'Width', type: 'number', default: 1200, min: 1, max: 10000, step: 10, unit: 'px' },
    { key: 'height', label: 'Height', type: 'number', default: 630, min: 1, max: 10000, step: 10, unit: 'px' },
    { key: 'background', label: 'Background', type: 'color', default: '#30363d' },
    { key: 'foreground', label: 'Text colour', type: 'color', default: '#c9d1d9' },
    { key: 'text', label: 'Text', type: 'text', default: '', placeholder: 'Leave empty to show the size' },
    { key: 'fontSize', label: 'Text size', type: 'number', default: 0, min: 0, max: 1000, step: 1, unit: 'px', help: '0 picks a size that fits.' },
    { key: 'cross', label: 'Draw diagonals', type: 'toggle', default: false },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const label = o.text.trim() === '' ? `${o.width} × ${o.height}` : o.text;
    const size = o.fontSize > 0 ? o.fontSize : Math.max(10, Math.round(Math.min(o.width / (label.length * 0.62), o.height / 3)));
    const cross = o.cross
      ? `<path d="M0 0L${o.width} ${o.height}M${o.width} 0L0 ${o.height}" stroke="${o.foreground}" stroke-opacity="0.25" stroke-width="${Math.max(1, Math.round(Math.min(o.width, o.height) / 200))}"/>`
      : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}"><rect width="100%" height="100%" fill="${o.background}"/>${cross}<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${size}" fill="${o.foreground}">${escapeXml(label)}</text></svg>`;
    const dataUri = `data:image/svg+xml;base64,${toBase64(utf8Encode(svg))}`;
    return {
      output: svg,
      preview: { kind: 'svg', svg },
      fields: [
        { label: 'Data URI', value: dataUri, mono: true },
        { label: 'HTML', value: `<img src="${dataUri.slice(0, 48)}…" width="${o.width}" height="${o.height}" alt="">`, mono: true },
      ],
      filename: `placeholder-${o.width}x${o.height}.svg`,
    };
  },
});
