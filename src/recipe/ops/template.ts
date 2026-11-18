/**
 * Template: renders a Handlebars template with JSON input.
 *
 * Handlebars compiles templates to JavaScript functions, which the app's
 * security policy forbids, so this is an interpreter for the same language:
 * {{value}} and {{{raw}}}, paths (this, ../, @root, [literal]), literals and
 * subexpressions, the built-in helpers (if, unless, each, with, lookup, log),
 * block parameters, comments, whitespace control (~ and Handlebars' rules for
 * tags standing alone on a line), partials, inline partials and partial
 * blocks.  Custom helpers cannot be defined, as in CyberChef.
 */
import { defineOp, OpError, type Operation, sArg, txt } from '../core';

/* ------------------------------------------------------------------ AST --- */

interface Strip {
  open: boolean;
  close: boolean;
}

type Expr =
  | { type: 'path'; data: boolean; parts: string[]; depth: number; original: string; scoped: boolean }
  | { type: 'literal'; value: string | number | boolean | null | undefined }
  | { type: 'sexpr'; path: Expr; params: Expr[]; hash: [string, Expr][] };

interface Call {
  path: Expr;
  params: Expr[];
  hash: [string, Expr][];
  blockParams: string[];
}

interface Program {
  body: Node[];
  blockParams: string[];
  chained?: boolean;
}

type Node =
  | { type: 'content'; value: string; original: string; leftStripped?: boolean; rightStripped?: boolean }
  | { type: 'mustache'; call: Call; escaped: boolean; strip: Strip }
  | { type: 'comment'; strip: Strip }
  | { type: 'partial'; name: Expr; context?: Expr; hash: [string, Expr][]; strip: Strip; indent: string }
  | {
      type: 'block' | 'decorator' | 'partialBlock';
      call: Call;
      program: Program;
      inverse?: Program;
      openStrip: Strip;
      inverseStrip: Strip;
      closeStrip: Strip;
    };

type BlockNode = Extract<Node, { type: 'block' | 'decorator' | 'partialBlock' }>;

/* ---------------------------------------------------------------- lexer --- */

interface Tag {
  kind: string; // '' expression, '{' raw, '&' raw, '#', '#*', '#>', '/', '^', 'else', '>', '!'
  body: string;
  strip: Strip;
  start: number;
  end: number;
  line: number;
}

type Piece = { text: string } | { tag: Tag };

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function fail(source: string, index: number, message: string): never {
  throw new OpError(`Parse error on line ${lineAt(source, index)}: ${message}`);
}

function lex(source: string): Piece[] {
  const pieces: Piece[] = [];
  let text = '';
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('{{', i);
    if (open === -1) {
      text += source.slice(i);
      break;
    }
    // \{{ is a literal "{{"; \\{{ is a backslash before a real tag.
    if (open > 0 && source[open - 1] === '\\' && !(open > 1 && source[open - 2] === '\\')) {
      text += `${source.slice(i, open - 1)}{{`;
      i = open + 2;
      const next = source.indexOf('{{', i);
      const stop = next === -1 ? source.length : next;
      text += source.slice(i, stop);
      i = stop;
      continue;
    }
    text += source.slice(i, open > 0 && source[open - 1] === '\\' ? open - 1 : open);
    if (text) pieces.push({ text });
    text = '';
    let at = open + 2;
    // Raw blocks: {{{{raw}}}} ... {{{{/raw}}}}
    if (source.startsWith('{{', at)) {
      const close = source.indexOf('}}}}', at);
      if (close === -1) fail(source, open, 'unclosed raw block');
      const name =
        source
          .slice(at + 2, close)
          .trim()
          .split(/\s+/)[0] ?? '';
      const end = source.indexOf(`{{{{/${name}}}}}`, close + 4);
      if (end === -1) fail(source, open, `raw block "${name}" is not closed`);
      pieces.push({ tag: { kind: 'raw', body: source.slice(close + 4, end), strip: { open: false, close: false }, start: open, end: end + name.length + 9, line: lineAt(source, open) } });
      i = end + name.length + 9;
      continue;
    }
    let triple = false;
    if (source[at] === '{') {
      triple = true;
      at++;
    }
    const stripOpen = source[at] === '~';
    if (stripOpen) at++;
    // Comments may contain "}}" when written {{!-- --}}.
    if (!triple && source.startsWith('!--', at)) {
      const close = source.indexOf('--', at + 3);
      let end = close;
      while (end !== -1 && !/^--~?}}/.test(source.slice(end))) end = source.indexOf('--', end + 1);
      if (end === -1) fail(source, open, 'unclosed comment');
      const stripClose = source[end + 2] === '~';
      i = end + (stripClose ? 5 : 4);
      pieces.push({ tag: { kind: '!', body: '', strip: { open: stripOpen, close: stripClose }, start: open, end: i, line: lineAt(source, open) } });
      continue;
    }
    const closer = triple ? '}}}' : '}}';
    let close = source.indexOf(closer, at);
    // Skip "}}" inside quoted strings.
    for (let scan = at; ; ) {
      const quote = /["']/.exec(source.slice(scan, close === -1 ? source.length : close));
      if (!quote || close === -1) break;
      const q = scan + quote.index;
      const qEnd = source.indexOf(quote[0], q + 1);
      if (qEnd === -1) break;
      scan = qEnd + 1;
      if (qEnd > close) close = source.indexOf(closer, qEnd + 1);
    }
    if (close === -1) fail(source, open, 'unclosed tag');
    let inner = source.slice(at, close);
    const stripClose = inner.endsWith('~');
    if (stripClose) inner = inner.slice(0, -1);
    let kind = triple ? '{' : '';
    if (!triple) {
      const m = /^\s*(#\*|#>|[#/^>!&*])/.exec(inner);
      if (m) {
        kind = m[1] as string;
        inner = inner.slice(m[0].length);
      } else if (/^\s*else(?=[\s~}]|$)/.test(inner)) {
        kind = 'else';
        inner = inner.replace(/^\s*else/, '');
      }
    }
    pieces.push({ tag: { kind, body: inner, strip: { open: stripOpen, close: stripClose }, start: open, end: close + closer.length, line: lineAt(source, open) } });
    i = close + closer.length;
  }
  if (text) pieces.push({ text });
  return pieces;
}

/* --------------------------------------------------- expression parsing --- */

function parseCall(source: string, body: string, at: number): Call {
  let i = 0;
  const skip = () => {
    while (i < body.length && /\s/.test(body[i] as string)) i++;
  };
  const ID = /^[^\s!"#%-,./;->@[-^`{-~]+/;

  const path = (): Expr => {
    const start = i;
    let data = false;
    if (body[i] === '@') {
      data = true;
      i++;
    }
    const parts: string[] = [];
    let depth = 0;
    let scoped = false;
    for (;;) {
      if (body.startsWith('..', i)) {
        depth++;
        scoped = true;
        i += 2;
      } else if (body[i] === '.' && !/[\w[]/.test(body[i + 1] ?? '')) {
        scoped = true;
        i++;
      } else if (body[i] === '[') {
        const end = body.indexOf(']', i);
        if (end === -1) fail(source, at, 'unclosed [ in a path');
        parts.push(body.slice(i + 1, end));
        i = end + 1;
      } else {
        const m = ID.exec(body.slice(i));
        if (!m) break;
        if (m[0] === 'this' && parts.length === 0 && depth === 0) scoped = true;
        else parts.push(m[0]);
        i += m[0].length;
      }
      if (body[i] === '.' || body[i] === '/') {
        if (body.startsWith('..', i) && parts.length === 0) continue;
        i++;
        continue;
      }
      break;
    }
    if (i === start) fail(source, at, `unexpected "${body.slice(i, i + 10)}"`);
    return { type: 'path', data, parts, depth, original: body.slice(start, i), scoped };
  };

  const value = (): Expr => {
    skip();
    const ch = body[i];
    if (ch === '(') {
      i++;
      const head = value();
      const { params, hash } = args(')');
      if (body[i] !== ')') fail(source, at, 'unclosed subexpression');
      i++;
      return { type: 'sexpr', path: head, params, hash };
    }
    if (ch === '"' || ch === "'") {
      let s = '';
      i++;
      while (i < body.length && body[i] !== ch) {
        if (body[i] === '\\' && body[i + 1] === ch) i++;
        s += body[i++];
      }
      i++;
      return { type: 'literal', value: s };
    }
    const num = /^-?\d+(?:\.\d+)?(?=[\s)}~|=]|$)/.exec(body.slice(i));
    if (num) {
      i += num[0].length;
      return { type: 'literal', value: Number(num[0]) };
    }
    const word = /^(true|false|null|undefined)(?=[\s)}~|]|$)/.exec(body.slice(i));
    if (word) {
      i += word[0].length;
      return { type: 'literal', value: word[1] === 'true' ? true : word[1] === 'false' ? false : word[1] === 'null' ? null : undefined };
    }
    return path();
  };

  const args = (until: string) => {
    const params: Expr[] = [];
    const hash: [string, Expr][] = [];
    for (;;) {
      skip();
      if (i >= body.length || body[i] === until || body.startsWith('as |', i)) break;
      const key = /^([^\s!"#%-,./;->@[-^`{-~]+)\s*=/.exec(body.slice(i));
      if (key) {
        i += key[0].length;
        hash.push([key[1] as string, value()]);
      } else if (hash.length) fail(source, at, 'positional arguments must come before named ones');
      else params.push(value());
    }
    return { params, hash };
  };

  skip();
  const head = value();
  const { params, hash } = args('');
  skip();
  let blockParams: string[] = [];
  if (body.startsWith('as |', i)) {
    const end = body.indexOf('|', i + 4);
    if (end === -1) fail(source, at, 'unclosed block parameters');
    blockParams = body
      .slice(i + 4, end)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    i = end + 1;
    skip();
  }
  if (i < body.length) fail(source, at, `unexpected "${body.slice(i, i + 10)}"`);
  return { path: head, params, hash, blockParams };
}

/* --------------------------------------------------------------- parser --- */

const noStrip: Strip = { open: false, close: false };

function parse(source: string): Program {
  const pieces = lex(source);
  let p = 0;

  const name = (call: Call): string => (call.path.type === 'path' ? call.path.original : call.path.type === 'literal' ? String(call.path.value) : '');

  /** Parses statements until a closing tag, an else, or the end. */
  const program = (blockParams: string[] = []): { prog: Program; stop?: Tag } => {
    const body: Node[] = [];
    while (p < pieces.length) {
      const piece = pieces[p++] as Piece;
      if ('text' in piece) {
        body.push({ type: 'content', value: piece.text, original: piece.text });
        continue;
      }
      const tag = piece.tag;
      switch (tag.kind) {
        case '/':
          return { prog: { body, blockParams }, stop: tag };
        case 'else':
          return { prog: { body, blockParams }, stop: tag };
        case '^':
          if (tag.body.trim() === '') return { prog: { body, blockParams }, stop: { ...tag, kind: 'else' } };
          body.push(block(tag, true));
          break;
        case '!':
          body.push({ type: 'comment', strip: tag.strip });
          break;
        case 'raw':
          body.push({ type: 'content', value: tag.body, original: tag.body });
          break;
        case '>': {
          const call = parseCall(source, tag.body, tag.start);
          body.push({ type: 'partial', name: call.path, context: call.params[0], hash: call.hash, strip: tag.strip, indent: '' });
          break;
        }
        case '#':
        case '#*':
        case '#>':
          body.push(block(tag, false));
          break;
        case '*':
          // Decorators other than inline partials do nothing here.
          break;
        default:
          body.push({ type: 'mustache', call: parseCall(source, tag.body, tag.start), escaped: tag.kind === '', strip: tag.strip });
      }
    }
    return { prog: { body, blockParams } };
  };

  const block = (open: Tag, inverted: boolean, closeLabel?: string): BlockNode => {
    const call = parseCall(source, open.body, open.start);
    const label = closeLabel ?? name(call);
    const first = program(call.blockParams);
    let mainProgram = first.prog;
    let inverse: Program | undefined;
    let inverseStrip = noStrip;
    let stop = first.stop;
    if (stop?.kind === 'else') {
      inverseStrip = stop.strip;
      const chainedBody = stop.body.trim();
      if (chainedBody !== '') {
        // {{else if x}}: the rest is a block nested in the inverse, closed by the same {{/...}}.
        const nested = block({ ...stop, kind: '#', body: chainedBody }, false, label);
        inverse = { body: [nested], blockParams: [], chained: true };
        const closeStrip = (nested as BlockNode & { _close?: Strip })._close ?? noStrip;
        return finish(open, call, mainProgram, inverse, inverseStrip, closeStrip, inverted);
      }
      const second = program();
      inverse = second.prog;
      stop = second.stop;
    }
    if (stop?.kind !== '/') fail(source, open.start, `{{#${label}}} is not closed`);
    const closeName = stop.body.trim();
    if (closeName !== label) fail(source, stop.start, `${label} doesn't match ${closeName}`);
    if (inverted) {
      const swap = mainProgram;
      mainProgram = inverse ?? { body: [], blockParams: [] };
      inverse = swap;
    }
    return finish(open, call, mainProgram, inverse, inverseStrip, stop.strip, false);
  };

  const finish = (open: Tag, call: Call, prog: Program, inverse: Program | undefined, inverseStrip: Strip, closeStrip: Strip, inverted: boolean): BlockNode => {
    const type = open.kind === '#*' ? 'decorator' : open.kind === '#>' ? 'partialBlock' : 'block';
    const node: BlockNode & { _close?: Strip } = inverted
      ? { type, call, program: inverse ?? { body: [], blockParams: [] }, inverse: prog, openStrip: open.strip, inverseStrip, closeStrip }
      : { type, call, program: prog, inverse, openStrip: open.strip, inverseStrip, closeStrip };
    node._close = closeStrip;
    return node;
  };

  const root = program();
  if (root.stop) fail(source, root.stop.start, root.stop.kind === 'else' ? 'unexpected {{else}}' : `unexpected {{/${root.stop.body.trim()}}}`);
  return root.prog;
}

/* --------------------------------------------------- whitespace control --- */
// A port of Handlebars' WhitespaceControl visitor.

type Content = Extract<Node, { type: 'content' }>;
const isContent = (node: Node | undefined): node is Content => node?.type === 'content';

function isPrevWhitespace(body: Node[], i: number | undefined, isRoot?: boolean): boolean {
  const at = i ?? body.length;
  const prev = body[at - 1];
  const sibling = body[at - 2];
  if (!prev) return !!isRoot;
  if (isContent(prev)) return (sibling || !isRoot ? /(?:^|\S)[^\S\n]*\n\s*$/ : /^\s*$|(?:^|\S)[^\S\n]*\n\s*$/).test(prev.original);
  return false;
}

function isNextWhitespace(body: Node[], i: number | undefined, isRoot?: boolean): boolean {
  const at = i ?? -1;
  const next = body[at + 1];
  const sibling = body[at + 2];
  if (!next) return !!isRoot;
  if (isContent(next)) return (sibling || !isRoot ? /^\s*?\r?\n/ : /^\s*?(\r?\n|$)/).test(next.original);
  return false;
}

function omitRight(body: Node[], i: number | null, multiple = false): void {
  const current = body[i == null ? 0 : i + 1];
  if (!isContent(current) || (!multiple && current.rightStripped)) return;
  const original = current.value;
  current.value = current.value.replace(multiple ? /^\s+/ : /^[ \t]*\r?\n?/, '');
  current.rightStripped = current.value !== original;
}

function omitLeft(body: Node[], i: number | null, multiple = false): boolean {
  const current = body[i == null ? body.length - 1 : i - 1];
  if (!isContent(current) || (!multiple && current.leftStripped)) return false;
  const original = current.value;
  current.value = current.value.replace(multiple ? /(^|\S)\s+$/ : /(^|[^ \t])[ \t]+$/, '$1');
  current.leftStripped = current.value !== original;
  return current.leftStripped;
}

interface StripInfo {
  open?: boolean;
  close?: boolean;
  openStandalone?: boolean;
  closeStandalone?: boolean;
  inlineStandalone?: boolean;
}

let rootSeen = false;

function visitProgram(program: Program): void {
  const isRoot = !rootSeen;
  rootSeen = true;
  const body = program.body;
  for (let i = 0; i < body.length; i++) {
    const current = body[i] as Node;
    const strip = visitNode(current);
    if (!strip) continue;
    const prevWs = isPrevWhitespace(body, i, isRoot);
    const nextWs = isNextWhitespace(body, i, isRoot);
    const openStandalone = strip.openStandalone && prevWs;
    const closeStandalone = strip.closeStandalone && nextWs;
    const inlineStandalone = strip.inlineStandalone && prevWs && nextWs;
    if (strip.close) omitRight(body, i, true);
    if (strip.open) omitLeft(body, i, true);
    if (inlineStandalone) {
      omitRight(body, i);
      if (omitLeft(body, i) && current.type === 'partial') {
        const prev = body[i - 1] as Content;
        current.indent = /(?:^|[^ \t])([ \t]+)$/.exec(prev.original)?.[1] ?? '';
      }
    }
    if (openStandalone && 'program' in current) {
      omitRight((current.program ?? current.inverse).body, null);
      omitLeft(body, i);
    }
    if (closeStandalone && 'program' in current) {
      omitRight(body, i);
      omitLeft((current.inverse ?? current.program).body, null);
    }
  }
}

function visitNode(node: Node): StripInfo | undefined {
  switch (node.type) {
    case 'mustache':
      return node.strip;
    case 'partial':
    case 'comment':
      return { inlineStandalone: true, open: node.strip.open, close: node.strip.close };
    case 'content':
      return undefined;
    default:
      return visitBlock(node);
  }
}

function visitBlock(block: BlockNode): StripInfo {
  visitProgram(block.program);
  if (block.inverse) visitProgram(block.inverse);
  const program = block.program;
  const inverse = block.inverse;
  let firstInverse = inverse;
  let lastInverse = inverse;
  if (inverse?.chained) {
    firstInverse = (inverse.body[0] as BlockNode).program;
    while (lastInverse?.chained) lastInverse = (lastInverse.body[lastInverse.body.length - 1] as BlockNode).program;
  }
  const strip: StripInfo = {
    open: block.openStrip.open,
    close: block.closeStrip.close,
    openStandalone: isNextWhitespace(program.body, undefined),
    closeStandalone: isPrevWhitespace((firstInverse ?? program).body, undefined),
  };
  if (block.openStrip.close) omitRight(program.body, null, true);
  if (inverse && firstInverse && lastInverse) {
    if (block.inverseStrip.open) omitLeft(program.body, null, true);
    if (block.inverseStrip.close) omitRight(firstInverse.body, null, true);
    if (block.closeStrip.open) omitLeft(lastInverse.body, null, true);
    if (isPrevWhitespace(program.body, undefined) && isNextWhitespace(firstInverse.body, undefined)) {
      omitLeft(program.body, null);
      omitRight(firstInverse.body, null);
    }
  } else if (block.closeStrip.open) omitLeft(program.body, null, true);
  return strip;
}

/* -------------------------------------------------------------- runtime --- */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '`': '&#x60;', '=': '&#x3D;' };

export function escapeExpression(value: unknown): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : String(value);
  return text.replace(/[&<>"'`=]/g, (ch) => ESCAPES[ch] as string);
}

const isEmpty = (value: unknown): boolean => (!value && value !== 0) || (Array.isArray(value) && value.length === 0);

/** Own properties only, as Handlebars allows by default. */
function property(parent: unknown, name: string): unknown {
  if (parent == null) return undefined;
  const target = Object(parent) as Record<string, unknown>;
  return Object.hasOwn(target, name) ? target[name] : undefined;
}

interface Frame {
  readonly context: unknown;
  /** Contexts of enclosing blocks that changed it, innermost first (for ../). */
  readonly depths: readonly unknown[];
  readonly data: Readonly<Record<string, unknown>>;
  readonly blockParams: readonly (readonly [string, unknown])[];
  readonly partials: Map<string, Program>;
  readonly partialBlock?: { program: Program; frame: Frame };
}

const MAX_DEPTH = 200;

class Renderer {
  private steps = 0;
  private nesting = 0;

  run(program: Program, frame: Frame): string {
    if (++this.nesting > MAX_DEPTH) throw new OpError('The template nests too deeply (a partial may include itself).');
    // Inline partials are available throughout the program that declares them.
    let partials = frame.partials;
    for (const node of program.body) {
      if (node.type === 'decorator' && node.call.path.type === 'path' && node.call.path.original === 'inline') {
        const name = this.evaluate(node.call.params[0] as Expr, frame);
        if (partials === frame.partials) partials = new Map(partials);
        partials.set(String(name), node.program);
      }
    }
    const inner = partials === frame.partials ? frame : { ...frame, partials };
    let out = '';
    for (const node of program.body) out += this.node(node, inner);
    this.nesting--;
    return out;
  }

  private tick(): void {
    if (++this.steps > 2_000_000) throw new OpError('The template takes too long to render.');
  }

  private lookupPath(expr: Extract<Expr, { type: 'path' }>, frame: Frame): unknown {
    this.tick();
    const [first, ...rest] = expr.parts;
    let value: unknown;
    if (expr.data) {
      if (first === 'root') value = frame.depths[frame.depths.length - 1] ?? frame.context;
      else value = frame.data[first ?? ''];
    } else if (!expr.scoped && first !== undefined) {
      const param = frame.blockParams.find(([n]) => n === first);
      if (param) value = param[1];
      else value = property(frame.context, first);
    } else {
      const base = expr.depth === 0 ? frame.context : frame.depths[expr.depth];
      value = first === undefined ? base : property(base, first);
    }
    for (const part of rest) value = property(value, part);
    return value;
  }

  evaluate(expr: Expr, frame: Frame): unknown {
    if (expr.type === 'literal') return expr.value;
    if (expr.type === 'sexpr') return this.helper({ path: expr.path, params: expr.params, hash: expr.hash, blockParams: [] }, frame, true);
    return this.lookupPath(expr, frame);
  }

  private helperName(call: Call, frame: Frame): string | undefined {
    if (call.path.type !== 'path' || call.path.data || call.path.depth > 0 || call.path.parts.length !== 1) return undefined;
    const name = call.path.parts[0] as string;
    if (frame.blockParams.some(([n]) => n === name)) return undefined;
    return ['if', 'unless', 'each', 'with', 'lookup', 'log'].includes(name) ? name : undefined;
  }

  /** A mustache or subexpression: a helper call, or a value lookup. */
  private helper(call: Call, frame: Frame, sub: boolean): unknown {
    const name = this.helperName(call, frame);
    const params = call.params.map((p) => this.evaluate(p, frame));
    if (name === 'lookup') return property(params[0], String(params[1]));
    if (name === 'log') return '';
    if ((name === 'if' || name === 'unless') && (sub || params.length > 0)) {
      if (params.length !== 1) throw new OpError(`#${name} requires exactly one argument`);
      return name === 'if' ? !isEmpty(params[0]) : isEmpty(params[0]);
    }
    if (call.params.length > 0 || call.hash.length > 0) throw new OpError(`Missing helper: "${call.path.type === 'path' ? call.path.original : String((call.path as { value?: unknown }).value)}"`);
    return this.evaluate(call.path, frame);
  }

  private withContext(frame: Frame, context: unknown, extra: { data?: Record<string, unknown>; params?: [string, unknown][] } = {}): Frame {
    const depths = context !== frame.context ? [context, ...frame.depths] : frame.depths;
    return {
      ...frame,
      context,
      depths: depths.length === 0 ? [context] : depths,
      data: extra.data ? { ...frame.data, ...extra.data } : frame.data,
      blockParams: extra.params ? [...extra.params, ...frame.blockParams] : frame.blockParams,
    };
  }

  private each(value: unknown, block: BlockNode, frame: Frame): string {
    const names = block.program.blockParams;
    let out = '';
    let count = 0;
    const iterate = (key: string | number, item: unknown, index: number, last: boolean) => {
      count++;
      const params: [string, unknown][] = [];
      if (names[0]) params.push([names[0], item]);
      if (names[1]) params.push([names[1], key]);
      out += this.run(block.program, this.withContext(frame, item, { data: { key, index, first: index === 0, last }, params }));
    };
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (const [i, item] of value.entries()) iterate(i, item, i, i === value.length - 1);
      } else {
        const keys = Object.keys(value);
        for (const [i, key] of keys.entries()) iterate(key, (value as Record<string, unknown>)[key], i, i === keys.length - 1);
      }
    }
    if (count === 0 && block.inverse) return this.run(block.inverse, frame);
    return out;
  }

  private block(node: BlockNode, frame: Frame): string {
    if (node.type === 'decorator') return '';
    if (node.type === 'partialBlock') return this.partial(node.call.path, node.call.params[0], node.call.hash, '', frame, { program: node.program, frame });
    const name = this.helperName(node.call, frame);
    const params = node.call.params.map((p) => this.evaluate(p, frame));
    const inverse = () => (node.inverse ? this.run(node.inverse, frame) : '');
    switch (name) {
      case 'if':
      case 'unless': {
        if (params.length !== 1) throw new OpError(`#${name} requires exactly one argument`);
        const includeZero = node.call.hash.some(([k, v]) => k === 'includeZero' && this.evaluate(v, frame) === true);
        let truthy = !isEmpty(params[0]) || (includeZero && params[0] === 0);
        if (name === 'unless') truthy = !truthy;
        return truthy ? this.run(node.program, frame) : inverse();
      }
      case 'each':
        if (params.length < 1) throw new OpError('Must pass iterator to #each');
        return this.each(params[0], node, frame);
      case 'with': {
        if (params.length !== 1) throw new OpError('#with requires exactly one argument');
        if (isEmpty(params[0])) return inverse();
        const names = node.program.blockParams;
        return this.run(node.program, this.withContext(frame, params[0], { params: names[0] ? [[names[0], params[0]]] : [] }));
      }
      case 'lookup':
      case 'log':
        return this.run(node.program, frame);
    }
    if (params.length > 0 || node.call.hash.length > 0) throw new OpError(`Missing helper: "${node.call.path.type === 'path' ? node.call.path.original : ''}"`);
    // A plain value as a block, as Handlebars' blockHelperMissing treats it.
    const value = this.evaluate(node.call.path, frame);
    if (value === true) return this.run(node.program, frame);
    if (value === false || value == null) return inverse();
    if (Array.isArray(value)) return value.length > 0 ? this.each(value, node, frame) : inverse();
    return this.run(node.program, this.withContext(frame, value));
  }

  private partial(nameExpr: Expr, contextExpr: Expr | undefined, hash: [string, Expr][], indent: string, frame: Frame, fallback?: { program: Program; frame: Frame }): string {
    const name = nameExpr.type === 'path' ? nameExpr.original : nameExpr.type === 'literal' ? String(nameExpr.value) : String(this.evaluate(nameExpr, frame));
    let context = contextExpr ? this.evaluate(contextExpr, frame) : frame.context;
    if (hash.length) {
      const extra = Object.fromEntries(hash.map(([k, v]) => [k, this.evaluate(v, frame)]));
      context = context && typeof context === 'object' ? { ...(context as object), ...extra } : extra;
    }
    let out: string;
    if (name === '@partial-block') {
      if (!frame.partialBlock) throw new OpError('The partial @partial-block could not be found');
      out = this.run(frame.partialBlock.program, { ...frame.partialBlock.frame, context, depths: [context, ...frame.partialBlock.frame.depths] });
    } else {
      const program = frame.partials.get(name);
      if (!program) {
        if (fallback) return this.run(fallback.program, fallback.frame);
        throw new OpError(`The partial ${name} could not be found`);
      }
      out = this.run(program, { ...frame, context, depths: [context, ...frame.depths], partialBlock: fallback ?? frame.partialBlock });
    }
    if (indent) {
      const lines = out.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i] && i + 1 === lines.length) break;
        lines[i] = indent + lines[i];
      }
      out = lines.join('\n');
    }
    return out;
  }

  private node(node: Node, frame: Frame): string {
    switch (node.type) {
      case 'content':
        return node.value;
      case 'comment':
        return '';
      case 'mustache': {
        const value = this.helper(node.call, frame, false);
        if (node.escaped) return escapeExpression(value);
        return value == null ? '' : String(value);
      }
      case 'partial':
        return this.partial(node.name, node.context, node.hash, node.indent, frame);
      default:
        return this.block(node, frame);
    }
  }
}

export function renderTemplate(template: string, data: unknown): string {
  const program = parse(template);
  rootSeen = false;
  visitProgram(program);
  return new Renderer().run(program, { context: data, depths: [data], data: { root: data }, blockParams: [], partials: new Map() });
}

export const templateOps: Operation[] = [
  defineOp({
    name: 'Template',
    category: 'Extractors',
    description:
      'Renders a Handlebars template with the input JSON as its data: {{name}} inserts a value (HTML-escaped; {{{name}}} inserts it as is), with #if, #unless, #each, #with, lookup, partials and inline partials.',
    input: 'text',
    output: 'text',
    keywords: ['handlebars', 'mustache', 'render', 'json'],
    args: [txt('template', 'Template definition (.handlebars)')],
    run: (input, a) => {
      let data: unknown;
      try {
        data = JSON.parse(input);
      } catch (error) {
        throw new OpError(`The input is not valid JSON: ${(error as Error).message}`);
      }
      return renderTemplate(sArg(a, 'template'), data);
    },
  }),
];
