import { byteLength, formatBytes } from '../../lib/bytes';
import { trimNumber } from '../../lib/color';
import { loadXmlFormatter } from '../../lib/xml-format';
import { attr, countElements, readSvg, svgIntrinsicSize } from '../../lib/xml-scan';
import { defineTextTool, type Field } from '../types';
import { SVG_SAMPLE } from './svg-minifier';

export default defineTextTool({
  input: { label: 'SVG', language: 'xml', sample: SVG_SAMPLE, accept: '.svg,image/svg+xml' },
  output: { label: 'Formatted source', language: 'xml' },
  options: [
    { key: 'checker', label: 'Transparency grid', type: 'toggle', default: true },
    { key: 'format', label: 'Tidy the source', type: 'toggle', default: true },
  ],
  async run(input, o) {
    const info = readSvg(input);
    const size = svgIntrinsicSize(info);
    const fields: Field[] = [
      { label: 'Rendered size', value: `${trimNumber(size.width, 2)} × ${trimNumber(size.height, 2)} px` },
      { label: 'width / height', value: `${attr(info.root, 'width') ?? '(not set)'} / ${attr(info.root, 'height') ?? '(not set)'}` },
      {
        label: 'viewBox',
        value: info.viewBox ? info.viewBox.join(' ') : '(not set — the image will not scale cleanly)',
        tone: info.viewBox ? undefined : 'warn',
      },
      { label: 'Elements', value: String(countElements(info.root)) },
      { label: 'File size', value: formatBytes(byteLength(input)) },
    ];
    const warnings: string[] = [];
    if (/<script[\s>]/i.test(input) || /\son[a-z]+\s*=/i.test(input)) {
      warnings.push('This SVG contains scripts or event handlers. They do not run in this preview, but would in a browser.');
    }
    if (/<(?:image|use)[^>]+href\s*=\s*["']https?:/i.test(input) || /url\(\s*["']?https?:/i.test(input)) {
      warnings.push('This SVG refers to external files, which are not loaded in this offline preview.');
    }
    let output = input;
    if (o.format) {
      const xmlFormat = await loadXmlFormatter();
      try {
        output = xmlFormat(input, { indentation: '  ', collapseContent: true, lineSeparator: '\n', throwOnFailure: true });
      } catch {
        output = input;
      }
    }
    return {
      output,
      preview: { kind: 'svg', svg: input, checker: o.checker },
      fields,
      warnings: warnings.length > 0 ? warnings : undefined,
      filename: 'image.svg',
    };
  },
});
