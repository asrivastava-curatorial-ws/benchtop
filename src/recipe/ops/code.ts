/** Code tidy: beautify and minify JavaScript, JSON, XML, SQL and CSS; jq; PHP serialisation; case styles; Markdown. */
import { loadXmlFormatter } from '../../lib/xml-format';
import { bArg, bool, cjs, defineOp, OpError, type Operation, sArg, sel, str, unescapeShort } from '../core';

const C = 'Code tidy' as const;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

function words(text: string, contextAware: boolean): string[] {
  const source = contextAware ? text.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') : text;
  return source.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function caseOp(name: string, join: (parts: string[]) => string): Operation {
  return defineOp({
    name,
    category: C,
    description: `Rewrites identifiers in ${name.replace('To ', '')}.`,
    input: 'text',
    output: 'text',
    args: [bool('context', 'Attempt to be context aware')],
    run: (input, a) =>
      bArg(a, 'context')
        ? input.replace(/[\p{L}\p{N}_-]+/gu, (token) => join(words(token, true)))
        : input
            .split('\n')
            .map((line) => join(words(line, true)))
            .join('\n'),
  });
}

function phpSerialize(value: unknown): string {
  if (value === null) return 'N;';
  if (typeof value === 'boolean') return `b:${value ? 1 : 0};`;
  if (typeof value === 'number') return Number.isInteger(value) ? `i:${value};` : `d:${value};`;
  if (typeof value === 'string') return `s:${new TextEncoder().encode(value).length}:"${value}";`;
  const entries = Array.isArray(value) ? value.map((v, i) => [i, v] as const) : Object.entries(value as Record<string, unknown>);
  return `a:${entries.length}:{${entries.map(([k, v]) => phpSerialize(typeof k === 'number' || /^\d+$/.test(k) ? Number(k) : k) + phpSerialize(v)).join('')}}`;
}

function phpUnserialize(text: string, validJson: boolean): string {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  const readUntil = (ch: string) => {
    const end = text.indexOf(ch, at);
    if (end === -1) throw new OpError('The serialised PHP data is incomplete.');
    const out = text.slice(at, end);
    at = end + 1;
    return out;
  };
  const value = (): unknown => {
    const type = text[at];
    at += 2;
    switch (type) {
      case 'N':
        return null;
      case 'b':
        return readUntil(';') === '1';
      case 'i':
        return Number(readUntil(';'));
      case 'd':
        return Number(readUntil(';'));
      case 's': {
        const length = Number(readUntil(':'));
        at++;
        const byteStart = new TextEncoder().encode(text.slice(0, at)).length;
        const s = new TextDecoder().decode(bytes.slice(byteStart, byteStart + length));
        at += s.length + 2;
        return s;
      }
      case 'a': {
        const count = Number(readUntil(':'));
        at++;
        const obj: Record<string, unknown> = {};
        let list = true;
        for (let i = 0; i < count; i++) {
          const key = value();
          if (key !== i) list = false;
          obj[String(key)] = value();
        }
        at++;
        return list ? Object.values(obj) : obj;
      }
      case 'O': {
        readUntil(':');
        readUntil(':');
        const count = Number(readUntil(':'));
        at++;
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < count; i++) obj[String(value())] = value();
        at++;
        return obj;
      }
      default:
        throw new OpError(`Unknown PHP type "${type}".`);
    }
  };
  const result = value();
  return validJson ? JSON.stringify(result, null, 4) : String(JSON.stringify(result));
}

export const codeOps: Operation[] = [
  defineOp({
    name: 'Generic Code Beautify',
    category: C,
    description: 'Indents brace-based code (C, Java, C#, Go…) one level per {.',
    input: 'text',
    output: 'text',
    run: (input) => {
      let depth = 0;
      const out: string[] = [];
      for (const raw of input.replace(/([{;}])(?=\S)/g, '$1\n').split('\n')) {
        const line = raw.trim();
        if (line === '') continue;
        if (/^[}\])]/.test(line)) depth = Math.max(0, depth - 1);
        out.push(`${'    '.repeat(depth)}${line}`);
        const opens = (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length + (/^[}\])]/.test(line) ? 1 : 0);
        depth = Math.max(0, depth + opens);
      }
      return out.join('\n');
    },
  }),
  defineOp({
    name: 'JavaScript Beautify',
    category: C,
    description: 'Formats JavaScript.',
    input: 'text',
    output: 'text',
    args: [
      str('indent', 'Indent string', '\\t'),
      sel('quotes', 'Quotes', ['Auto', 'Single', 'Double']),
      bool('semicolons', 'Semicolons before closing braces', true),
      bool('comments', 'Include comments', true),
    ],
    run: async (input, a) => {
      const beautify = cjs(await import('js-beautify'));
      let out = beautify.js(input, { indent_with_tabs: unescapeShort(sArg(a, 'indent')) === '\t', indent_size: unescapeShort(sArg(a, 'indent')).length || 4 });
      if (!bArg(a, 'comments')) out = out.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const quotes = sArg(a, 'quotes');
      if (quotes !== 'Auto')
        out = out.replace(/(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g, (_m, _q: string, body: string) => (quotes === 'Single' ? `'${body.replace(/'/g, "\\'")}'` : `"${body.replace(/"/g, '\\"')}"`));
      return out;
    },
  }),
  defineOp({
    name: 'JavaScript Minify',
    category: C,
    description: 'Minifies JavaScript with Terser.',
    input: 'text',
    output: 'text',
    run: async (input) => {
      const { minify } = await import('terser');
      const result = await minify(input, { compress: true, mangle: true });
      return result.code ?? '';
    },
  }),
  defineOp({
    name: 'JSON Beautify',
    category: C,
    description: 'Indents JSON, optionally sorting object keys.',
    input: 'text',
    output: 'text',
    args: [str('indent', 'Indent string', '    '), bool('sort', 'Sort Object Keys'), bool('formatted', 'Formatted', true)],
    run: (input, a) => {
      if (input.trim() === '') return '';
      let value = JSON.parse(input) as unknown;
      if (bArg(a, 'sort')) value = sortKeys(value);
      return JSON.stringify(value, null, unescapeShort(sArg(a, 'indent')));
    },
  }),
  defineOp({
    name: 'JSON Minify',
    category: C,
    description: 'Removes the whitespace from JSON.',
    input: 'text',
    output: 'text',
    run: (input) => (input.trim() === '' ? '' : JSON.stringify(JSON.parse(input))),
  }),
  defineOp({
    name: 'XML Beautify',
    category: C,
    description: 'Indents XML.',
    input: 'text',
    output: 'text',
    args: [str('indent', 'Indent string', '\\t')],
    run: async (input, a) => (await loadXmlFormatter())(input, { indentation: unescapeShort(sArg(a, 'indent')), collapseContent: true, lineSeparator: '\n' }),
  }),
  defineOp({
    name: 'XML Minify',
    category: C,
    description: 'Removes the whitespace between XML tags.',
    input: 'text',
    output: 'text',
    args: [bool('comments', 'Preserve comments')],
    run: async (input, a) => {
      const format = await loadXmlFormatter();
      const min = format.minify(input, { collapseContent: true });
      return bArg(a, 'comments') ? min : min.replace(/<!--[\s\S]*?-->/g, '');
    },
  }),
  defineOp({
    name: 'SQL Beautify',
    category: C,
    description: 'Formats SQL.',
    input: 'text',
    output: 'text',
    args: [str('indent', 'Indent string', '\\t')],
    run: async (input, a) => {
      const { format } = await import('sql-formatter');
      const indent = unescapeShort(sArg(a, 'indent'));
      return format(input, { useTabs: indent === '\t', tabWidth: indent === '\t' ? 4 : indent.length || 2 });
    },
  }),
  defineOp({
    name: 'SQL Minify',
    category: C,
    description: 'Removes comments and extra whitespace from SQL.',
    input: 'text',
    output: 'text',
    run: (input) =>
      input
        .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
        .replace(/('(?:''|[^'])*')|\s+/g, (_m, str: string | undefined) => str ?? ' ')
        .replace(/\s*([(),;=<>])\s*/g, '$1')
        .trim(),
  }),
  defineOp({
    name: 'CSS Beautify',
    category: C,
    description: 'Formats CSS.',
    input: 'text',
    output: 'text',
    args: [str('indent', 'Indent string', '\\t')],
    run: async (input, a) => {
      const beautify = cjs(await import('js-beautify'));
      const indent = unescapeShort(sArg(a, 'indent'));
      return beautify.css(input, { indent_with_tabs: indent === '\t', indent_size: indent.length || 4 });
    },
  }),
  defineOp({
    name: 'CSS Minify',
    category: C,
    description: 'Minifies CSS with CSSO.',
    input: 'text',
    output: 'text',
    args: [bool('comments', 'Preserve comments')],
    run: async (input, a) => (await import('csso')).minify(input, { comments: bArg(a, 'comments') ? 'exclamation' : false }).css,
  }),
  defineOp({
    name: 'Jq',
    category: C,
    description: 'Runs a jq query on JSON.',
    input: 'text',
    output: 'text',
    args: [str('query', 'Query', '.'), bool('raw', 'Raw')],
    run: async (input, a) => {
      const jq = await import('jq-wasm');
      const result = await jq.raw(input, sArg(a, 'query') || '.', bArg(a, 'raw') ? ['-r'] : []);
      if (result.exitCode !== 0) throw new OpError(result.stderr.trim() || 'jq failed.');
      return result.stdout.replace(/\n$/, '');
    },
  }),
  defineOp({
    name: 'PHP Deserialize',
    category: C,
    description: 'Turns PHP serialize() output into JSON.',
    input: 'text',
    output: 'text',
    args: [bool('json', 'Output valid JSON', true)],
    run: (input, a) => phpUnserialize(input.trim(), bArg(a, 'json')),
  }),
  defineOp({
    name: 'PHP Serialize',
    category: C,
    description: 'Writes JSON as PHP serialize() output.',
    input: 'text',
    output: 'text',
    run: (input) => phpSerialize(JSON.parse(input)),
  }),
  defineOp({
    name: 'Strip HTML tags',
    category: C,
    description: 'Removes HTML tags, keeping the text.',
    input: 'text',
    output: 'text',
    args: [bool('indent', 'Remove indentation', true), bool('breaks', 'Remove excess line breaks', true)],
    magic: [{ pattern: /(<\/html>|<\/div>|<\/body>)/i }],
    run: (input, a) => {
      let out = input.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '');
      if (bArg(a, 'indent')) out = out.replace(/^[ \t]+/gm, '');
      if (bArg(a, 'breaks')) out = out.replace(/\n{2,}/g, '\n\n').trim();
      return out;
    },
  }),
  caseOp('To Snake case', (p) => p.map((w) => w.toLowerCase()).join('_')),
  caseOp('To Camel case', (p) => p.map((w, i) => (i === 0 ? w.toLowerCase() : (w[0] ?? '').toUpperCase() + w.slice(1).toLowerCase())).join('')),
  caseOp('To Kebab case', (p) => p.map((w) => w.toLowerCase()).join('-')),
  defineOp({
    name: 'Render Markdown',
    category: C,
    description: 'Renders Markdown as HTML.',
    input: 'text',
    output: 'text',
    args: [bool('links', 'Autoconvert URLs to links')],
    run: async (input) => {
      const { marked } = await import('marked');
      const html = await marked.parse(input, { gfm: true });
      return { value: html, preview: { kind: 'html', html } };
    },
  }),
];
