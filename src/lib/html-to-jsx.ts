/**
 * HTML to JSX: attributes renamed for React (class, for, tabindex, SVG's
 * hyphenated names), inline styles turned into objects, void and empty
 * elements self-closed, comments wrapped, and text escaped so JSX reads it
 * exactly as the browser would have shown it.
 */
import { parseDocument } from 'htmlparser2';

interface DomNode {
  readonly type: string;
}
interface DomText extends DomNode {
  readonly data: string;
}
interface DomElement extends DomNode {
  readonly name: string;
  readonly attribs: Record<string, string>;
  readonly children: readonly DomNode[];
}

export interface JsxOptions {
  /** Wrap the markup in `export default function Name() { return (...) }`. */
  readonly component?: string;
  /** Turn value, checked and selected into defaultValue and defaultChecked. */
  readonly uncontrolled?: boolean;
  readonly indent?: number;
  /** Longest line before attributes and inline content are broken up. */
  readonly width?: number;
}

export interface JsxResult {
  readonly code: string;
  readonly warnings: string[];
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const INLINE = new Set(
  'a abbr audio b bdi bdo br button canvas cite code data del dfn em embed i iframe img input ins kbd label mark math meter object output picture progress q s samp select small span strong sub sup svg textarea time u var video wbr'.split(
    ' ',
  ),
);
const BOOLEAN = new Set(
  'allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected'.split(
    ' ',
  ),
);
const RENAMED: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  'accept-charset': 'acceptCharset',
  accesskey: 'accessKey',
  allowfullscreen: 'allowFullScreen',
  autocapitalize: 'autoCapitalize',
  autocomplete: 'autoComplete',
  autofocus: 'autoFocus',
  autoplay: 'autoPlay',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  charset: 'charSet',
  colspan: 'colSpan',
  contenteditable: 'contentEditable',
  controlslist: 'controlsList',
  crossorigin: 'crossOrigin',
  datetime: 'dateTime',
  enctype: 'encType',
  enterkeyhint: 'enterKeyHint',
  fetchpriority: 'fetchPriority',
  formaction: 'formAction',
  formenctype: 'formEncType',
  formmethod: 'formMethod',
  formnovalidate: 'formNoValidate',
  formtarget: 'formTarget',
  frameborder: 'frameBorder',
  hreflang: 'hrefLang',
  'http-equiv': 'httpEquiv',
  inputmode: 'inputMode',
  itemprop: 'itemProp',
  itemscope: 'itemScope',
  itemtype: 'itemType',
  marginheight: 'marginHeight',
  marginwidth: 'marginWidth',
  maxlength: 'maxLength',
  minlength: 'minLength',
  nomodule: 'noModule',
  novalidate: 'noValidate',
  playsinline: 'playsInline',
  popovertarget: 'popoverTarget',
  readonly: 'readOnly',
  referrerpolicy: 'referrerPolicy',
  rowspan: 'rowSpan',
  spellcheck: 'spellCheck',
  srcdoc: 'srcDoc',
  srclang: 'srcLang',
  srcset: 'srcSet',
  tabindex: 'tabIndex',
  usemap: 'useMap',
};
const EVENTS: Record<string, string> = Object.fromEntries(
  (
    'Abort AnimationEnd AnimationIteration AnimationStart AuxClick Blur CanPlay Change Click ContextMenu Copy Cut DoubleClick Drag DragEnd DragEnter DragLeave DragOver DragStart Drop Ended Error Focus Input Invalid ' +
    'KeyDown KeyPress KeyUp Load LoadedData LoadedMetadata MouseDown MouseEnter MouseLeave MouseMove MouseOut MouseOver MouseUp Paste Pause Play Playing PointerDown PointerEnter PointerLeave PointerMove PointerOut ' +
    'PointerOver PointerUp Reset Resize Scroll Select Submit TimeUpdate Toggle TouchCancel TouchEnd TouchMove TouchStart TransitionEnd VolumeChange Wheel'
  )
    .split(' ')
    .map((name) => [`on${name.toLowerCase()}`, `on${name}`]),
);
EVENTS.ondblclick = 'onDoubleClick';

/** HTML collapses ASCII whitespace only; a no-break space is content. */
const SPACE = /[ \t\n\r\f]+/g;
const trimSpace = (text: string) => text.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '');
const isBlank = (text: string) => trimSpace(text) === '';
const camel = (name: string) => name.replace(/[-:]([a-z])/g, (_, c: string) => c.toUpperCase());
const isText = (node: DomNode): node is DomText => node.type === 'text' || node.type === 'cdata';
const isElement = (node: DomNode): node is DomElement => node.type === 'tag' || node.type === 'script' || node.type === 'style';
/** Text as JSX shows it: entities for characters JSX would misread. */
const escapeText = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, '&nbsp;')
    .replace(/[{}]/g, (c) => `{'${c}'}`);
const cssValue = (value: string) => (/^-?(\d+\.?\d*|\.\d+)$/.test(value) ? value : `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);

/** Splits a style attribute on semicolons outside quotes and brackets. */
function declarations(style: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (end: number) => {
    const part = style.slice(start, end);
    const colon = part.indexOf(':');
    if (colon > 0) out.push([part.slice(0, colon).trim(), part.slice(colon + 1).trim()]);
  };
  for (let i = 0; i < style.length; i++) {
    const c = style[i] as string;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(style.length);
  return out.filter(([property, value]) => property !== '' && value !== '');
}

export function htmlToJsx(html: string, options: JsxOptions = {}): JsxResult {
  const unit = ' '.repeat(options.indent ?? 2);
  const width = options.width ?? 100;
  const warnings = new Set<string>();
  const document = parseDocument(html, { decodeEntities: true, lowerCaseTags: false, lowerCaseAttributeNames: false, recognizeSelfClosing: true }) as unknown as DomElement;

  // A whole page contributes its body; head content has no place in a component.
  const find = (nodes: readonly DomNode[], name: string): DomElement | undefined => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      if (node.name.toLowerCase() === name) return node;
      if (node.name.toLowerCase() === 'html') {
        const inner = find(node.children, name);
        if (inner) return inner;
      }
    }
    return undefined;
  };
  const body = find(document.children, 'body');
  const html_ = find(document.children, 'html');
  if (find(document.children, 'head') && body) warnings.add('The <head> was left out; only the <body> content was converted.');
  const blank = (node: DomNode) => isText(node) && isBlank(node.data);
  const top = (body ?? html_ ?? document).children.filter((node) => node.type !== 'directive');
  const significant = top.filter((node) => !blank(node));

  function attributes(element: DomElement, tag: string, svg: boolean, extra: string[]): string[] {
    const out: string[] = [];
    for (const [raw, value] of Object.entries(element.attribs)) {
      const lower = raw.toLowerCase();
      if (lower === 'selected' && tag === 'option' && options.uncontrolled !== false) continue;
      if (lower === 'style') {
        const parts = declarations(value).map(([property, v]) => {
          let css = v;
          if (/!important\s*$/i.test(css)) {
            css = css.replace(/\s*!important\s*$/i, '');
            warnings.add('React inline styles cannot be !important; the flag was removed.');
          }
          const key = property.startsWith('--')
            ? `'${property}'`
            : camel(
                property
                  .toLowerCase()
                  .replace(/^-ms-/, 'ms-')
                  .replace(/^-(webkit|moz|o)-/, (_, p: string) => `${p[0]?.toUpperCase()}${p.slice(1)}-`),
              );
          return `${key}: ${cssValue(css)}`;
        });
        if (parts.length > 0) out.push(`style={{ ${parts.join(', ')} }}`);
        continue;
      }
      if (lower.startsWith('on') && EVENTS[lower]) {
        out.push(`${EVENTS[lower]}={(event) => { ${value.trim().replace(/;?\s*$/, ';')} }}`);
        warnings.add('Inline event handlers became arrow functions; check that they still make sense in React.');
        continue;
      }
      let name = RENAMED[lower] ?? (lower.startsWith('data-') || lower.startsWith('aria-') ? lower : svg && /[-:]/.test(raw) ? camel(raw) : svg ? raw : lower);
      if (options.uncontrolled !== false && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
        if (lower === 'value') name = 'defaultValue';
        if (lower === 'checked') name = 'defaultChecked';
      }
      if (BOOLEAN.has(lower) && (value === '' || value.toLowerCase() === lower)) {
        out.push(name);
        continue;
      }
      out.push(/["&]/.test(value) ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`);
    }
    return [...out, ...extra];
  }

  /** Text of an element whose whitespace matters, as a JS string expression. */
  const preserved = (nodes: readonly DomNode[]): string =>
    nodes
      .map((node) => {
        if (isText(node)) return `{${JSON.stringify(node.data)}}`;
        if (isElement(node)) return element(node, '', false, true).join('');
        return '';
      })
      .join('');

  /** A single-line rendering, or null when the node needs several lines. */
  /**
   * A flowing piece of a line: text (with its surrounding spaces) or an inline
   * element, which may need several lines of its own when it is long.
   */
  type Piece = { kind: 'text'; text: string } | { kind: 'element'; lines: string[] };

  function children(nodes: readonly DomNode[], depth: string, svg: boolean): string[] {
    const out: string[] = [];
    let run: Piece[] = [];
    const flush = () => {
      // Spaces at the edges of a run of inline content do not show.
      const blankPiece = (piece: Piece | undefined) => piece?.kind === 'text' && isBlank(piece.text);
      while (blankPiece(run[0])) run.shift();
      while (blankPiece(run[run.length - 1])) run.pop();
      if (run.length === 0) return;
      // One line when everything fits...
      if (run.every((piece) => piece.kind === 'text' || piece.lines.length === 1)) {
        const joined = trimSpace(run.map((piece) => (piece.kind === 'text' ? piece.text : trimSpace(piece.lines[0] as string))).join(''));
        if (depth.length + joined.length <= width) {
          out.push(depth + joined);
          run = [];
          return;
        }
      }
      // ...otherwise one piece per line, with {' '} wherever a space separated two pieces.
      const lines: string[] = [];
      let space = false;
      for (const piece of run) {
        if (piece.kind === 'text') {
          if (isBlank(piece.text)) {
            space = true;
            continue;
          }
          if (/^[ \t\n\r\f]/.test(piece.text)) space = true;
        }
        if (space && lines.length > 0) lines[lines.length - 1] += "{' '}";
        space = false;
        if (piece.kind === 'text') {
          lines.push(depth + trimSpace(piece.text));
          space = /[ \t\n\r\f]$/.test(piece.text);
        } else lines.push(...piece.lines);
      }
      out.push(...lines);
      run = [];
    };
    for (const node of nodes) {
      if (node.type === 'directive') continue;
      const tag = isElement(node) ? node.name.toLowerCase() : '';
      if (isText(node)) {
        // Inside SVG, whitespace between shapes means nothing.
        if (!(svg && blank(node))) run.push({ kind: 'text', text: escapeText(node.data.replace(SPACE, ' ')) });
        continue;
      }
      // Inside SVG only text spans flow; its shapes go one per line.
      if (isElement(node) && (svg ? tag === 'tspan' : INLINE.has(tag))) {
        run.push({ kind: 'element', lines: element(node, depth, svg, false) });
        continue;
      }
      flush();
      if (node.type === 'comment') {
        const text = (node as DomText).data.trim().replace(/\*\//g, '* /');
        out.push(`${depth}{/* ${text} */}`);
      } else if (isElement(node)) out.push(...element(node, depth, svg, false));
    }
    flush();
    return out;
  }

  function element(node: DomElement, depth: string, parentSvg: boolean, pre: boolean): string[] {
    const lower = node.name.toLowerCase();
    const svg = parentSvg || lower === 'svg';
    const tag = svg ? (lower === 'svg' ? 'svg' : node.name) : lower;
    const extra: string[] = [];
    let kids = node.children;

    if (tag === 'script' || tag === 'style') {
      const code = kids.map((child) => (isText(child) ? child.data : '')).join('');
      if (tag === 'script') warnings.add('React does not run <script> tags it renders; load scripts another way.');
      if (code.trim() !== '') extra.push(`dangerouslySetInnerHTML={{ __html: ${JSON.stringify(code)} }}`);
      kids = [];
    } else if (tag === 'textarea') {
      const text = kids
        .map((child) => (isText(child) ? child.data : ''))
        .join('')
        .replace(/^\n/, '');
      if (text !== '') extra.push(`${options.uncontrolled === false ? 'value' : 'defaultValue'}={${JSON.stringify(text)}}`);
      kids = [];
    } else if (tag === 'select' && options.uncontrolled !== false) {
      const options_: DomElement[] = [];
      const collect = (nodes: readonly DomNode[]) => {
        for (const child of nodes) {
          if (!isElement(child)) continue;
          if (child.name.toLowerCase() === 'option') options_.push(child);
          else collect(child.children);
        }
      };
      collect(kids);
      const chosen = options_.filter((option) => 'selected' in option.attribs);
      if (chosen.length > 0) {
        const optionValue = (option: DomElement) =>
          option.attribs.value ??
          option.children
            .map((child) => (isText(child) ? child.data : ''))
            .join('')
            .trim();
        extra.push('multiple' in node.attribs ? `defaultValue={${JSON.stringify(chosen.map(optionValue))}}` : `defaultValue=${JSON.stringify(optionValue(chosen[0] as DomElement))}`);
      }
    }

    const attrs = attributes(node, tag, svg, extra);
    const meaningful = kids.filter((child) => child.type !== 'directive');
    const open = (close: string) => {
      const flat = `${depth}<${tag}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}${close}`;
      if (flat.length <= width || attrs.length < 2) return [flat];
      return [`${depth}<${tag}`, ...attrs.map((attr) => `${depth}${unit}${attr}`), `${depth}${close.trim()}`];
    };

    if (VOID.has(tag) || meaningful.every(blank)) return open(' />');
    if (pre || tag === 'pre') {
      const head = open('>');
      const content = preserved(meaningful);
      if (head.length === 1) return [`${head[0]}${content}</${tag}>`];
      return [...head, `${depth}${unit}${content}`, `${depth}</${tag}>`];
    }
    const head = open('>');
    const body = children(meaningful, depth + unit, svg);
    // Short content stays on the opening tag's line.
    if (head.length === 1 && body.length === 1) {
      const single = `${head[0]}${(body[0] as string).trim()}</${tag}>`;
      if (single.length <= width && !(body[0] as string).trim().startsWith('{/*')) return [single];
    }
    return [...head, ...body, `${depth}</${tag}>`];
  }

  const base = options.component ? unit.repeat(2) : '';
  let lines: string[];
  if (significant.length === 1 && isElement(significant[0] as DomNode)) lines = element(significant[0] as DomElement, base, false, false);
  else if (significant.length === 0) lines = [`${base}<></>`];
  else lines = [`${base}<>`, ...children(top, base + unit, false), `${base}</>`];

  const markup = lines.join('\n');
  const component = options.component
    ? options.component
        .split(/[^A-Za-z0-9_$]+/)
        .filter(Boolean)
        .map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`)
        .join('')
        .replace(/^(\d)/, 'C$1') || 'Component'
    : '';
  const code = component ? `export default function ${component}() {\n${unit}return (\n${markup}\n${unit});\n}\n` : `${markup}\n`;
  return { code, warnings: [...warnings] };
}
