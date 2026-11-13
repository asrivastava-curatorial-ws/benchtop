/**
 * A deliberately conservative HTML minifier.
 *
 * htmlparser2's forgiving tokenizer locates text, comments and tags in the
 * source; tags are copied through (only redundant spaces between attributes
 * are dropped), so attribute values are never rewritten.  Only whitespace in
 * text, comments and, optionally, the contents of inline <style>/<script> are
 * changed.  <pre>, <textarea> and other raw-text elements are left alone.
 */
import { Parser } from 'htmlparser2';

export interface HtmlMinifyOptions {
  /**
   * - `conservative`: collapse whitespace runs to a single space, never remove them
   * - `smart`: additionally remove whitespace next to block-level tags
   * - `aggressive`: remove whitespace around every tag
   */
  readonly whitespace: 'conservative' | 'smart' | 'aggressive';
  readonly removeComments: boolean;
  /** Minify the contents of inline <style> and <script> elements. */
  readonly processInline: boolean;
}

export interface HtmlMinifyResult {
  readonly html: string;
  readonly warnings: string[];
}

const BLOCK_TAGS = new Set(
  (
    'address article aside base blockquote body br caption col colgroup dd details dialog div dl dt fieldset ' +
    'figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html legend li link main meta nav ' +
    'noscript ol optgroup option p pre script section source style summary table tbody td template tfoot th ' +
    'thead title tr track ul'
  ).split(' '),
);

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);
const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript']);
const JSON_TYPES = new Set(['application/json', 'application/ld+json', 'importmap', 'speculationrules']);
const WHITESPACE_RUN = /[ \t\n\r\f]+/g;

type Boundary = 'edge' | 'block' | 'inline';

/** Collapses whitespace between attributes without touching quoted values. */
function tidyTag(raw: string): string {
  let out = '';
  let quote = '';
  let space = false;
  let last = '';
  for (const ch of raw) {
    if (quote !== '') {
      out += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
      space = true;
      continue;
    }
    if (space) {
      if (ch !== '>') out += ' ';
      space = false;
    }
    // A quote only opens a value directly after "=" (whitespace in between is allowed).
    if ((ch === '"' || ch === "'") && last === '=') quote = ch;
    out += ch;
    last = ch;
  }
  return out;
}

async function minifyScript(code: string, type: string, warnings: string[]): Promise<string> {
  if (JSON_TYPES.has(type)) {
    try {
      return JSON.stringify(JSON.parse(code)).replace(/</g, '\\u003c');
    } catch {
      warnings.push(`An inline <script type="${type}"> block is not valid JSON and was left unchanged.`);
      return code;
    }
  }
  if (!JS_TYPES.has(type)) return code;
  try {
    const { minify } = await import('terser');
    const result = await minify(code, { module: type === 'module', format: { inline_script: true } });
    return result.code ?? code;
  } catch (error) {
    const detail = error as { message?: string; line?: number };
    warnings.push(`An inline <script> could not be parsed (${detail.message ?? 'syntax error'}${detail.line ? `, line ${detail.line} of the script` : ''}) and was left unchanged.`);
    return code;
  }
}

async function minifyStyle(css: string, warnings: string[]): Promise<string> {
  try {
    const { minify } = await import('csso');
    return minify(css, { restructure: false }).css;
  } catch {
    warnings.push('An inline <style> block could not be parsed and was left unchanged.');
    return css;
  }
}

export async function minifyHtml(source: string, options: HtmlMinifyOptions): Promise<HtmlMinifyResult> {
  const warnings: string[] = [];
  const parts: (string | Promise<string>)[] = [];
  let cursor = 0;
  let pending = '';
  let previous: Boundary = 'edge';
  let preDepth = 0;
  let raw: { name: string; type: string } | null = null;

  const flushText = (next: Boundary) => {
    if (pending === '') return;
    let text = pending;
    pending = '';
    if (raw !== null) {
      const element = raw;
      if (options.processInline && element.name === 'script') parts.push(minifyScript(text, element.type, warnings));
      else if (options.processInline && element.name === 'style') parts.push(minifyStyle(text, warnings));
      else parts.push(text);
      return;
    }
    if (preDepth > 0) {
      parts.push(text);
      return;
    }
    text = text.replace(WHITESPACE_RUN, ' ');
    const trimStart = previous === 'edge' || options.whitespace === 'aggressive' || (options.whitespace === 'smart' && previous === 'block');
    const trimEnd = next === 'edge' || options.whitespace === 'aggressive' || (options.whitespace === 'smart' && next === 'block');
    if (trimStart) text = text.replace(/^ /, '');
    if (trimEnd) text = text.replace(/ $/, '');
    if (text !== '') {
      parts.push(text);
      previous = 'inline';
    }
  };

  /** Emits any source the tokenizer skipped, then the token itself. */
  const take = (start: number, end: number): string => {
    if (start > cursor) pending += source.slice(cursor, start);
    cursor = end + 1;
    return source.slice(start, end + 1);
  };

  const handleTag = (start: number, end: number, attribs: Record<string, string> | null) => {
    if (start < cursor) return; // already emitted (implied open/close pairs share one source range)
    const name = /^<\/?([^\s/>]+)/.exec(source.slice(start, Math.min(end + 1, start + 64)))?.[1]?.toLowerCase() ?? '';
    const closing = source[start + 1] === '/';
    const boundary: Boundary = BLOCK_TAGS.has(name) ? 'block' : 'inline';
    if (start > cursor) pending += source.slice(cursor, start);
    flushText(boundary);
    cursor = end + 1;
    const text = source.slice(start, end + 1);
    parts.push(tidyTag(text));
    previous = boundary;
    if (closing) {
      if (name === 'pre' && preDepth > 0) preDepth--;
      if (raw !== null && raw.name === name) raw = null;
    } else if (!text.endsWith('/>')) {
      if (name === 'pre') preDepth++;
      if (RAW_TEXT_TAGS.has(name)) raw = { name, type: (attribs?.type ?? '').trim().toLowerCase() };
    }
  };

  const parser = new Parser(
    {
      onopentag(_name, attribs) {
        handleTag(parser.startIndex, parser.endIndex, attribs);
      },
      onclosetag(_name, isImplied) {
        if (!isImplied) handleTag(parser.startIndex, parser.endIndex, null);
      },
      ontext() {
        if (parser.startIndex >= cursor) pending += take(parser.startIndex, parser.endIndex);
      },
      oncomment() {
        const start = parser.startIndex;
        const end = parser.endIndex;
        if (start < cursor) return;
        const text = source.slice(start, end + 1);
        const keep = !options.removeComments || !text.startsWith('<!--') || /^<!--(\[if\b|<!\[endif\]|!)/i.test(text) || raw !== null || preDepth > 0;
        if (!keep) {
          // Text on both sides of a removed comment is merged so that it collapses as one run.
          if (start > cursor) pending += source.slice(cursor, start);
          cursor = end + 1;
          return;
        }
        if (start > cursor) pending += source.slice(cursor, start);
        flushText('inline');
        cursor = end + 1;
        parts.push(text);
        previous = 'inline';
      },
      onprocessinginstruction() {
        const start = parser.startIndex;
        const end = parser.endIndex;
        if (start < cursor) return;
        if (start > cursor) pending += source.slice(cursor, start);
        flushText('block');
        cursor = end + 1;
        parts.push(source.slice(start, end + 1));
        previous = 'block';
      },
    },
    { decodeEntities: false, lowerCaseTags: false, lowerCaseAttributeNames: false, recognizeSelfClosing: true },
  );
  parser.write(source);
  parser.end();
  if (cursor < source.length) pending += source.slice(cursor);
  flushText('edge');

  return { html: (await Promise.all(parts)).join(''), warnings };
}
