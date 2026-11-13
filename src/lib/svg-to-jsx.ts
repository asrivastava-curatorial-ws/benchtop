/** Converts SVG markup into a React component (JSX or TSX). */
import { ToolError } from './errors';
import { attr, parseXml, rootElement, svgLength, type XmlElement, type XmlNode } from './xml-scan';

export interface SvgToJsxOptions {
  readonly componentName: string;
  readonly typescript: boolean;
  /** What to do with the root width/height. */
  readonly dimensions: 'keep' | 'remove' | 'em';
  /** Replace hard-coded fill/stroke colours with `currentColor`. */
  readonly currentColor: boolean;
  readonly memo: boolean;
  readonly exportDefault: boolean;
}

const EDITOR_PREFIXES = /^(sodipodi|inkscape|rdf|cc|dc|sketch|serif|ns\d*):/;
const COLOR_ATTRS = new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color']);
const KEEP_COLOR = /^(none|transparent|currentcolor|inherit|context-fill|context-stroke)$|^url\(/i;

function jsxAttrName(name: string): string {
  if (name === 'class') return 'className';
  if (name === 'for') return 'htmlFor';
  if (name === 'tabindex') return 'tabIndex';
  if (name === 'crossorigin') return 'crossOrigin';
  if (/^(data|aria)-/.test(name)) return name;
  return name.replace(/[-:]([a-zA-Z])/g, (_match, letter: string) => letter.toUpperCase());
}

function styleKey(property: string): string {
  if (property.startsWith('--')) return JSON.stringify(property);
  const camel = property
    .replace(/^-ms-/, 'ms-')
    .replace(/^-(webkit|moz|o)-/, (_match, vendor: string) => `${vendor[0]?.toUpperCase()}${vendor.slice(1)}-`)
    .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return /^[A-Za-z_$][\w$]*$/.test(camel) ? camel : JSON.stringify(camel);
}

/** Splits `a: b; c: url(x;y)` on semicolons that are not inside brackets or quotes. */
export function splitDeclarations(style: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  const flush = () => {
    const index = current.indexOf(':');
    if (index > 0) {
      const property = current.slice(0, index).trim();
      const value = current.slice(index + 1).trim();
      if (property !== '' && value !== '') out.push([property, value]);
    }
    current = '';
  };
  for (const ch of style) {
    if (quote !== '') {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      flush();
      continue;
    }
    current += ch;
  }
  flush();
  return out;
}

const jsString = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;

export function svgToReact(svg: string, options: SvgToJsxOptions): string {
  const nodes = parseXml(svg);
  const root = rootElement(nodes);
  if (root?.name !== 'svg') throw new ToolError('No <svg> root element found.');
  const name = /^[A-Z][A-Za-z0-9_$]*$/.test(options.componentName) ? options.componentName : null;
  if (name === null) {
    throw new ToolError('The component name must start with a capital letter and contain only letters, digits, _ or $.');
  }

  const recolor = (property: string, value: string): string => (options.currentColor && COLOR_ATTRS.has(property) && !KEEP_COLOR.test(value.trim()) ? 'currentColor' : value);

  const renderAttrs = (element: XmlElement, isRoot: boolean): string[] => {
    const out: string[] = [];
    let hasViewBox = false;
    for (const attribute of element.attrs) {
      const key = attribute.name;
      let value = attribute.value;
      if (EDITOR_PREFIXES.test(key) || /^xmlns:(sodipodi|inkscape|rdf|cc|dc|sketch|serif|svg)$/.test(key)) continue;
      if (/^on[a-z]+$/.test(key)) continue; // string event handlers are not valid in React
      if (key === 'viewBox') hasViewBox = true;
      if (isRoot && (key === 'width' || key === 'height')) {
        if (options.dimensions === 'remove') continue;
        if (options.dimensions === 'em') value = '1em';
      }
      if (key === 'style') {
        const entries = splitDeclarations(value).map(([property, raw]) => `${styleKey(property)}: ${jsString(recolor(property, raw))}`);
        if (entries.length > 0) out.push(`style={{ ${entries.join(', ')} }}`);
        continue;
      }
      value = recolor(key, value);
      out.push(/["&\n\r\\{}<>]/.test(value) ? `${jsxAttrName(key)}={${jsString(value)}}` : `${jsxAttrName(key)}="${value}"`);
    }
    if (isRoot) {
      // Without width/height the viewBox is what keeps the drawing scalable.
      if (options.dimensions !== 'keep' && !hasViewBox) {
        const width = svgLength(attr(element, 'width'));
        const height = svgLength(attr(element, 'height'));
        if (width !== undefined && height !== undefined) out.push(`viewBox="0 0 ${width} ${height}"`);
      }
      out.push('{...props}');
    }
    return out;
  };

  const renderText = (value: string, preserve: boolean): string => {
    const text = preserve ? value : value.replace(/\s+/g, ' ').trim();
    if (text === '') return '';
    return /[{}<>&]|^\s|\s$/.test(text) ? `{${jsString(text)}}` : text;
  };

  const render = (element: XmlElement, depth: number, isRoot: boolean): string => {
    const pad = '  '.repeat(depth);
    const attrs = renderAttrs(element, isRoot);
    const inline = `<${element.name}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}`;
    const open = pad.length + inline.length <= 100 ? inline : `<${element.name}\n${attrs.map((item) => `${pad}  ${item}`).join('\n')}\n${pad}`;

    if (element.name === 'style') {
      const css = element.children
        .map((child) => (child.type === 'text' ? child.value : ''))
        .join('')
        .trim();
      return `${pad}${open}>{\`${css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`}</style>`;
    }

    const preserve = attr(element, 'xml:space') === 'preserve';
    const children: string[] = [];
    let onlyText = true;
    for (const child of element.children as XmlNode[]) {
      if (child.type === 'text') {
        const text = renderText(child.value, preserve);
        if (text !== '') children.push(text);
      } else if (child.type === 'element') {
        if (child.name === 'metadata' || child.name === 'script' || EDITOR_PREFIXES.test(child.name)) continue;
        onlyText = false;
        children.push(render(child, depth + 1, false));
      }
    }
    if (children.length === 0) return `${pad}${open}${open.includes('\n') ? '' : ' '}/>`;
    if (onlyText) return `${pad}${open}>${children.join(' ')}</${element.name}>`;
    const body = children.map((child) => (child.startsWith(' ') ? child : `${pad}  ${child}`)).join('\n');
    return `${pad}${open}>\n${body}\n${pad}</${element.name}>`;
  };

  const jsx = render(root, 2, true);
  const propsType = options.typescript ? ': SVGProps<SVGSVGElement>' : '';
  const lines: string[] = [];
  const reactImports = [options.memo ? 'memo' : '', options.typescript ? 'type SVGProps' : ''].filter(Boolean);
  if (reactImports.length > 0) lines.push(`import { ${reactImports.join(', ')} } from 'react';`, '');
  const inlineExport = !options.memo ? (options.exportDefault ? 'export default ' : 'export ') : '';
  lines.push(`${inlineExport}function ${name}(props${propsType}) {`, '  return (', jsx, '  );', '}');
  if (options.memo) {
    lines.push('', options.exportDefault ? `export default memo(${name});` : `const Memo${name} = memo(${name});\nexport { Memo${name} as ${name} };`);
  }
  return `${lines.join('\n')}\n`;
}
