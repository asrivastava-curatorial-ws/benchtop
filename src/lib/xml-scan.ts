/**
 * A small XML reader that records where every node sits in the source text.
 *
 * It exists so SVG tools can make surgical edits (cut out one element, change
 * one attribute) and leave every other byte exactly as the author wrote it,
 * which a parse-and-reserialise round trip cannot guarantee.
 */
import { lineColumn, ToolError } from './errors';

export interface XmlAttr {
  readonly name: string;
  /** Value with character references decoded. */
  readonly value: string;
  /** Range of `name="value"` in the source. */
  readonly start: number;
  readonly end: number;
}

export interface XmlElement {
  readonly type: 'element';
  readonly name: string;
  readonly attrs: XmlAttr[];
  readonly children: XmlNode[];
  /** Index of the opening `<`. */
  readonly start: number;
  /** Index just past the `>` of the start tag. */
  readonly openEnd: number;
  /** Index just past the whole element (its end tag, or the `/>`). */
  end: number;
  readonly selfClosing: boolean;
}

export interface XmlText {
  readonly type: 'text';
  /** Decoded text. */
  readonly value: string;
  readonly cdata: boolean;
  readonly start: number;
  readonly end: number;
}

export interface XmlOther {
  readonly type: 'comment' | 'pi' | 'doctype';
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

export type XmlNode = XmlElement | XmlText | XmlOther;

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXmlEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';

export function parseXml(source: string): XmlNode[] {
  const nodes: XmlNode[] = [];
  const stack: XmlElement[] = [];
  const length = source.length;
  let i = 0;

  const fail = (message: string, at: number): never => {
    const { line, column } = lineColumn(source, at);
    throw new ToolError(`${message} (line ${line}, column ${column}).`, { line, column });
  };
  const push = (node: XmlNode) => {
    const parent = stack[stack.length - 1];
    (parent ? parent.children : nodes).push(node);
  };
  const until = (terminator: string, from: number, what: string): number => {
    const index = source.indexOf(terminator, from);
    if (index < 0) fail(`Unterminated ${what}`, i);
    return index;
  };

  while (i < length) {
    if (source[i] !== '<') {
      let end = source.indexOf('<', i);
      if (end < 0) end = length;
      const raw = source.slice(i, end);
      if (raw.trim() !== '' || stack.length > 0) push({ type: 'text', value: decodeXmlEntities(raw), cdata: false, start: i, end });
      i = end;
      continue;
    }
    if (source.startsWith('<!--', i)) {
      const end = until('-->', i + 4, 'comment') + 3;
      push({ type: 'comment', raw: source.slice(i, end), start: i, end });
      i = end;
    } else if (source.startsWith('<![CDATA[', i)) {
      const close = until(']]>', i + 9, 'CDATA section');
      push({ type: 'text', value: source.slice(i + 9, close), cdata: true, start: i, end: close + 3 });
      i = close + 3;
    } else if (source.startsWith('<?', i)) {
      const end = until('?>', i + 2, 'processing instruction') + 2;
      push({ type: 'pi', raw: source.slice(i, end), start: i, end });
      i = end;
    } else if (source.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal subset in [ ... ].
      let depth = 0;
      let j = i + 2;
      for (; j < length; j++) {
        const ch = source[j];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '"' || ch === "'") j = until(ch, j + 1, 'quoted string in DOCTYPE');
        else if (ch === '>' && depth <= 0) break;
      }
      if (j >= length) fail('Unterminated declaration', i);
      push({ type: 'doctype', raw: source.slice(i, j + 1), start: i, end: j + 1 });
      i = j + 1;
    } else if (source[i + 1] === '/') {
      const close = until('>', i + 2, 'closing tag');
      const name = source.slice(i + 2, close).trim();
      const open = stack.pop();
      if (!open) return fail(`Closing tag </${name}> has no matching opening tag`, i);
      if (open.name !== name) fail(`Closing tag </${name}> does not match <${open.name}>`, i);
      open.end = close + 1;
      i = close + 1;
    } else {
      const start = i;
      let j = i + 1;
      while (j < length && !isSpace(source[j]) && source[j] !== '>' && source[j] !== '/') j++;
      const name = source.slice(i + 1, j);
      if (name === '') fail('Unexpected "<" (use &lt; for a literal less-than sign)', i);
      const attrs: XmlAttr[] = [];
      let selfClosing = false;
      for (;;) {
        while (isSpace(source[j])) j++;
        if (j >= length) fail(`Unterminated <${name}> tag`, start);
        if (source[j] === '>') {
          j++;
          break;
        }
        if (source[j] === '/' && source[j + 1] === '>') {
          selfClosing = true;
          j += 2;
          break;
        }
        const attrStart = j;
        while (j < length && !isSpace(source[j]) && source[j] !== '=' && source[j] !== '>' && source[j] !== '/') j++;
        const attrName = source.slice(attrStart, j);
        if (attrName === '') fail(`Unexpected "${source[j]}" in <${name}> tag`, j);
        while (isSpace(source[j])) j++;
        if (source[j] !== '=') fail(`Attribute "${attrName}" has no value`, attrStart);
        j++;
        while (isSpace(source[j])) j++;
        const quote = source[j];
        if (quote !== '"' && quote !== "'") fail(`The value of attribute "${attrName}" must be quoted`, j);
        const close = source.indexOf(quote as string, j + 1);
        if (close < 0) fail(`Unterminated value for attribute "${attrName}"`, j);
        attrs.push({ name: attrName, value: decodeXmlEntities(source.slice(j + 1, close)), start: attrStart, end: close + 1 });
        j = close + 1;
      }
      const element: XmlElement = { type: 'element', name, attrs, children: [], start, openEnd: j, end: j, selfClosing };
      push(element);
      if (!selfClosing) stack.push(element);
      i = j;
    }
  }
  const unclosed = stack[stack.length - 1];
  if (unclosed) fail(`<${unclosed.name}> is never closed`, unclosed.start);
  return nodes;
}

export function rootElement(nodes: XmlNode[]): XmlElement | undefined {
  return nodes.find((node): node is XmlElement => node.type === 'element');
}

export function attr(element: XmlElement, name: string): string | undefined {
  return element.attrs.find((candidate) => candidate.name === name)?.value;
}

export function countElements(element: XmlElement): number {
  let total = 1;
  for (const child of element.children) if (child.type === 'element') total += countElements(child);
  return total;
}

/** Applies non-overlapping `[start, end) -> replacement` edits to the source. */
export function applyEdits(source: string, edits: { start: number; end: number; text: string }[]): string {
  const ordered = [...edits].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const edit of ordered) {
    if (edit.start < cursor) continue;
    out += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + source.slice(cursor);
}

/** Parses the root <svg> and reports its intrinsic size and viewBox. */
export interface SvgInfo {
  readonly root: XmlElement;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly viewBox: readonly [number, number, number, number] | undefined;
}

const UNIT_TO_PX: Record<string, number> = { '': 1, px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };

/** Absolute SVG length in CSS pixels; `undefined` for percentages and relative units. */
export function svgLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(value);
  if (!match) return undefined;
  const factor = UNIT_TO_PX[(match[2] ?? '').toLowerCase()];
  return factor === undefined ? undefined : Number(match[1]) * factor;
}

export function readSvg(source: string): SvgInfo {
  const root = rootElement(parseXml(source));
  if (!root || !/^(?:\w+:)?svg$/.test(root.name)) throw new ToolError('No <svg> root element found.');
  const box = attr(root, 'viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const viewBox = box && box.length === 4 && box.every(Number.isFinite) ? (box as [number, number, number, number]) : undefined;
  return { root, width: svgLength(attr(root, 'width')), height: svgLength(attr(root, 'height')), viewBox };
}

/** The size an SVG is drawn at when placed in an <img>: width/height, else viewBox, else 300x150. */
export function svgIntrinsicSize(info: SvgInfo): { width: number; height: number } {
  const ratio = info.viewBox && info.viewBox[3] > 0 ? info.viewBox[2] / info.viewBox[3] : undefined;
  if (info.width !== undefined && info.height !== undefined) return { width: info.width, height: info.height };
  if (info.width !== undefined && ratio !== undefined) return { width: info.width, height: info.width / ratio };
  if (info.height !== undefined && ratio !== undefined) return { width: info.height * ratio, height: info.height };
  if (info.viewBox) return { width: info.viewBox[2], height: info.viewBox[3] };
  return { width: info.width ?? 300, height: info.height ?? 150 };
}
