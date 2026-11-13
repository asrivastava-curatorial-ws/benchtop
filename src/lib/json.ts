/**
 * A strict (RFC 8259) JSON reader that keeps every number and string exactly
 * as written.  Formatting through `JSON.parse` silently rounds large integers
 * (12345678901234567890 becomes 12345678901234567000) and reports errors
 * differently in every engine, so the formatter works on this lossless tree
 * instead and always reports a precise line and column.
 */
import { lineColumn, ToolError } from './errors';

export type JsonNode =
  | { readonly type: 'object'; readonly entries: readonly { readonly key: string; readonly raw: string; readonly value: JsonNode }[] }
  | { readonly type: 'array'; readonly items: readonly JsonNode[] }
  | { readonly type: 'literal'; readonly raw: string };

export interface JsonParseResult {
  readonly root: JsonNode;
  /** Object keys that appear more than once in the same object. */
  readonly duplicateKeys: readonly string[];
}

const MAX_DEPTH = 2000;

export function parseJsonLossless(text: string): JsonParseResult {
  let pos = 0;
  const duplicateKeys = new Set<string>();

  const fail = (message: string, at = pos): never => {
    const { line, column } = lineColumn(text, at);
    throw new ToolError(`${message} at line ${line}, column ${column}.`, { line, column });
  };

  const describe = (at: number): string => {
    if (at >= text.length) return 'end of input';
    const ch = text[at] as string;
    if (ch === '\n' || ch === '\r') return 'a line break';
    return ch === '"' ? "'\"'" : `"${ch}"`;
  };

  const skipWhitespace = () => {
    for (;;) {
      const code = text.charCodeAt(pos);
      if (code === 32 || code === 9 || code === 10 || code === 13) pos++;
      else break;
    }
  };

  const readString = (): string => {
    const start = pos;
    pos++; // opening quote
    for (;;) {
      if (pos >= text.length) fail('Unterminated string', start);
      const code = text.charCodeAt(pos);
      if (code === 34) {
        pos++;
        return text.slice(start, pos);
      }
      if (code < 32) fail(`Unescaped control character in string (use \\u${code.toString(16).padStart(4, '0')})`);
      if (code === 92) {
        const next = text[pos + 1];
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(pos + 2, pos + 6))) fail('Invalid \\u escape (four hex digits expected)');
          pos += 6;
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) {
          pos += 2;
        } else {
          fail(`Invalid escape sequence \\${next ?? ''}`);
        }
      } else {
        pos++;
      }
    }
  };

  const readNumber = (): string => {
    const start = pos;
    if (text[pos] === '-') pos++;
    if (text[pos] === '0') {
      pos++;
      if (/[0-9]/.test(text[pos] ?? '')) fail('Numbers cannot have leading zeros', start);
    } else if (/[1-9]/.test(text[pos] ?? '')) {
      while (/[0-9]/.test(text[pos] ?? '')) pos++;
    } else {
      fail(`Unexpected ${describe(pos)} in number`);
    }
    if (text[pos] === '.') {
      pos++;
      if (!/[0-9]/.test(text[pos] ?? '')) fail('A digit must follow the decimal point');
      while (/[0-9]/.test(text[pos] ?? '')) pos++;
    }
    if (text[pos] === 'e' || text[pos] === 'E') {
      pos++;
      if (text[pos] === '+' || text[pos] === '-') pos++;
      if (!/[0-9]/.test(text[pos] ?? '')) fail('A digit must follow the exponent');
      while (/[0-9]/.test(text[pos] ?? '')) pos++;
    }
    return text.slice(start, pos);
  };

  const readValue = (depth: number): JsonNode => {
    if (depth > MAX_DEPTH) fail(`Nesting is deeper than ${MAX_DEPTH} levels`);
    skipWhitespace();
    const ch = text[pos];
    if (ch === '{') {
      pos++;
      const entries: { key: string; raw: string; value: JsonNode }[] = [];
      const seen = new Set<string>();
      skipWhitespace();
      if (text[pos] === '}') {
        pos++;
        return { type: 'object', entries };
      }
      for (;;) {
        skipWhitespace();
        if (text[pos] !== '"') {
          fail(text[pos] === '}' && entries.length > 0 ? 'Trailing comma before "}"' : `Expected a double-quoted property name but found ${describe(pos)}`);
        }
        const raw = readString();
        const key = JSON.parse(raw) as string;
        if (seen.has(key)) duplicateKeys.add(key);
        seen.add(key);
        skipWhitespace();
        if (text[pos] !== ':') fail(`Expected ":" after property name but found ${describe(pos)}`);
        pos++;
        entries.push({ key, raw, value: readValue(depth + 1) });
        skipWhitespace();
        if (text[pos] === ',') {
          pos++;
          continue;
        }
        if (text[pos] === '}') {
          pos++;
          return { type: 'object', entries };
        }
        fail(`Expected "," or "}" but found ${describe(pos)}`);
      }
    }
    if (ch === '[') {
      pos++;
      const items: JsonNode[] = [];
      skipWhitespace();
      if (text[pos] === ']') {
        pos++;
        return { type: 'array', items };
      }
      for (;;) {
        skipWhitespace();
        if (text[pos] === ']' && items.length > 0) fail('Trailing comma before "]"');
        items.push(readValue(depth + 1));
        skipWhitespace();
        if (text[pos] === ',') {
          pos++;
          continue;
        }
        if (text[pos] === ']') {
          pos++;
          return { type: 'array', items };
        }
        fail(`Expected "," or "]" but found ${describe(pos)}`);
      }
    }
    if (ch === '"') return { type: 'literal', raw: readString() };
    if (ch === '-' || (ch !== undefined && ch >= '0' && ch <= '9')) return { type: 'literal', raw: readNumber() };
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, pos)) {
        pos += word.length;
        return { type: 'literal', raw: word };
      }
    }
    if (ch === "'") fail('Strings must use double quotes');
    if (ch === undefined) fail(text.trim() === '' ? 'Input is empty' : 'Unexpected end of input');
    return fail(`Unexpected ${describe(pos)}`);
  };

  const root = readValue(0);
  skipWhitespace();
  if (pos < text.length) fail(`Unexpected ${describe(pos)} after the end of the JSON value`);
  return { root, duplicateKeys: [...duplicateKeys] };
}

export interface JsonWriteOptions {
  /** Indentation unit; an empty string produces minified output. */
  readonly indent: string;
  readonly sortKeys?: boolean;
}

export function writeJson(node: JsonNode, options: JsonWriteOptions): string {
  const { indent, sortKeys } = options;
  const pretty = indent !== '';
  const out: string[] = [];

  const write = (current: JsonNode, level: number) => {
    if (current.type === 'literal') {
      out.push(current.raw);
      return;
    }
    const inner = pretty ? `\n${indent.repeat(level + 1)}` : '';
    const closing = pretty ? `\n${indent.repeat(level)}` : '';
    if (current.type === 'array') {
      if (current.items.length === 0) {
        out.push('[]');
        return;
      }
      out.push('[');
      current.items.forEach((item, index) => {
        out.push(index === 0 ? inner : `,${inner}`);
        write(item, level + 1);
      });
      out.push(closing, ']');
      return;
    }
    if (current.entries.length === 0) {
      out.push('{}');
      return;
    }
    const entries = sortKeys ? [...current.entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) : current.entries;
    out.push('{');
    entries.forEach((entry, index) => {
      out.push(index === 0 ? inner : `,${inner}`, entry.raw, pretty ? ': ' : ':');
      write(entry.value, level + 1);
    });
    out.push(closing, '}');
  };

  write(node, 0);
  return out.join('');
}

/** Parses JSON to plain values, with the same precise error messages as the lossless reader. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    parseJsonLossless(text); // throws a ToolError with line/column
    throw new ToolError('Invalid JSON.');
  }
}

export function indentUnit(value: string): string {
  if (value === 'tab') return '\t';
  const size = Number.parseInt(value, 10);
  return ' '.repeat(Number.isFinite(size) && size > 0 ? Math.min(size, 8) : 2);
}
