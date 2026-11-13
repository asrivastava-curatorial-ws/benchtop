import { byteLength, sizeChange } from '../../lib/bytes';
import { colorDistance, isColor } from '../../lib/color';
import { ToolError } from '../../lib/errors';
import { splitDeclarations } from '../../lib/svg-to-jsx';
import { applyEdits, attr, readSvg, svgIntrinsicSize, svgLength, type XmlElement } from '../../lib/xml-scan';
import { defineTextTool, type Values } from '../types';

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120" style="background-color: #f1f5f9">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="20" y="20" width="160" height="80" rx="12" fill="#6366f1"/>
  <circle cx="60" cy="60" r="22" fill="#fbbf24"/>
  <text x="96" y="67" font-family="sans-serif" font-size="20" fill="#ffffff">Logo</text>
</svg>`;

const WRAPPERS = new Set(['g', 'a', 'switch']);
const NON_RENDERING = new Set(['defs', 'title', 'desc', 'metadata', 'style', 'script', 'linearGradient', 'radialGradient', 'pattern', 'clipPath', 'mask', 'filter', 'symbol']);

function declaredFill(element: XmlElement): string | undefined {
  const style = attr(element, 'style');
  const fromStyle = style ? splitDeclarations(style).find(([property]) => property === 'fill')?.[1] : undefined;
  return fromStyle ?? attr(element, 'fill');
}

export default defineTextTool({
  input: { label: 'SVG', language: 'xml', sample: SAMPLE, accept: '.svg,image/svg+xml' },
  output: { label: 'SVG without background', language: 'xml' },
  options: [
    {
      key: 'match',
      label: 'Remove',
      type: 'select',
      choices: [
        { value: 'first', label: 'The backdrop shape (first full-size rectangle)' },
        { value: 'color', label: 'Full-size rectangles of one colour' },
        { value: 'all', label: 'Every full-size rectangle' },
      ],
      default: 'first',
    },
    { key: 'color', label: 'Colour', type: 'color', default: '#ffffff', showIf: (v: Values) => v.match === 'color' },
    { key: 'rootStyle', label: 'Also clear background styles on <svg>', type: 'toggle', default: true },
  ],
  run(input, o) {
    const info = readSvg(input);
    const size = svgIntrinsicSize(info);
    const box = info.viewBox ?? ([0, 0, size.width, size.height] as const);
    const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.005);

    const coversCanvas = (element: XmlElement): boolean => {
      if (attr(element, 'transform') !== undefined) return false;
      const width = attr(element, 'width');
      const height = attr(element, 'height');
      const x = attr(element, 'x') ?? '0';
      const y = attr(element, 'y') ?? '0';
      const full = (value: string | undefined, target: number) => value !== undefined && (value.trim() === '100%' || near(svgLength(value) ?? Number.NaN, target));
      const origin = (value: string, target: number) => value.trim() === '0%' || near(svgLength(value) ?? Number.NaN, target);
      return full(width, box[2]) && full(height, box[3]) && origin(x, box[0]) && origin(y, box[1]);
    };

    const matchesColor = (element: XmlElement): boolean => {
      if (o.match !== 'color') return true;
      const fill = declaredFill(element) ?? '#000000';
      return isColor(fill) && colorDistance(fill, o.color) < 0.02;
    };

    const targets: XmlElement[] = [];
    // Returns true once real artwork has been seen, after which nothing is a "backdrop" any more.
    const visit = (element: XmlElement, depth: number): boolean => {
      for (const child of element.children) {
        if (child.type !== 'element' || NON_RENDERING.has(child.name)) continue;
        if (child.name === 'rect' && coversCanvas(child)) {
          const fill = declaredFill(child);
          if (fill?.trim() !== 'none' && matchesColor(child)) {
            targets.push(child);
            if (o.match === 'first') return true;
            continue;
          }
        }
        if (WRAPPERS.has(child.name) && depth < 4) {
          if (visit(child, depth + 1) && o.match === 'first') return true;
          continue;
        }
        if (o.match === 'first') return true;
      }
      return false;
    };
    visit(info.root, 0);

    const edits = targets.map((target) => {
      // Take the indentation before the element along with it, so no blank line is left behind.
      let start = target.start;
      while (start > 0 && (input[start - 1] === ' ' || input[start - 1] === '\t')) start--;
      if (start > 0 && input[start - 1] === '\n') start--;
      else start = target.start;
      return { start, end: target.end, text: '' };
    });

    let rootChanged = false;
    if (o.rootStyle) {
      const style = info.root.attrs.find((candidate) => candidate.name === 'style');
      if (style) {
        const kept = splitDeclarations(style.value).filter(([property]) => !/^background(-color|-image)?$/.test(property));
        if (kept.length !== splitDeclarations(style.value).length) {
          rootChanged = true;
          const text = kept.length > 0 ? `style="${kept.map(([property, value]) => `${property}: ${value}`).join('; ')}"` : '';
          const start = text === '' && input[style.start - 1] === ' ' ? style.start - 1 : style.start;
          edits.push({ start, end: style.end, text });
        }
      }
    }

    if (edits.length === 0) {
      throw new ToolError(
        o.match === 'color'
          ? 'No full-size rectangle with that colour was found. Try another colour or "Every full-size rectangle".'
          : 'No background was found: there is no rectangle covering the whole canvas and no background style on <svg>.',
      );
    }
    const output = applyEdits(input, edits);
    const removed = [targets.length > 0 ? `${targets.length} rectangle${targets.length === 1 ? '' : 's'}` : '', rootChanged ? 'the background style on <svg>' : ''].filter(Boolean);
    return {
      output,
      preview: { kind: 'svg', svg: output, checker: true },
      info: `Removed ${removed.join(' and ')} · ${sizeChange(byteLength(input), byteLength(output))}`,
      filename: 'image-transparent.svg',
    };
  },
});
