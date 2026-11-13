/** Escaping and unescaping text for string literals in common languages. */
import { ToolError } from './errors';

export type EscapeTarget = 'json' | 'javascript' | 'java' | 'csharp' | 'c' | 'python' | 'shell' | 'powershell' | 'sql' | 'regex' | 'csv';

export const ESCAPE_TARGETS: readonly { value: EscapeTarget; label: string }[] = [
  { value: 'json', label: 'JSON string' },
  { value: 'javascript', label: 'JavaScript string' },
  { value: 'java', label: 'Java string' },
  { value: 'csharp', label: 'C# string' },
  { value: 'c', label: 'C / C++ string' },
  { value: 'python', label: 'Python string' },
  { value: 'shell', label: 'Shell (POSIX, single quotes)' },
  { value: 'powershell', label: 'PowerShell (single quotes)' },
  { value: 'sql', label: 'SQL string' },
  { value: 'regex', label: 'Regular expression (literal match)' },
  { value: 'csv', label: 'CSV field' },
];

const hex4 = (code: number) => code.toString(16).toUpperCase().padStart(4, '0');

function escapeCLike(text: string, target: EscapeTarget, quote: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    switch (char) {
      case '\\':
        out += '\\\\';
        continue;
      case '\n':
        out += '\\n';
        continue;
      case '\r':
        out += '\\r';
        continue;
      case '\t':
        out += '\\t';
        continue;
      case '\b':
        out += '\\b';
        continue;
      case '\f':
        out += '\\f';
        continue;
      default:
        break;
    }
    if (char === quote) {
      out += `\\${quote}`;
      continue;
    }
    if (target === 'javascript' && char === '`') {
      out += char;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      out += target === 'c' ? `\\x${code.toString(16).padStart(2, '0')}` : target === 'python' ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${hex4(code)}`;
      continue;
    }
    // Line and paragraph separators break JavaScript string literals in older engines.
    if ((target === 'javascript' || target === 'json') && (code === 0x2028 || code === 0x2029)) {
      out += `\\u${hex4(code)}`;
      continue;
    }
    if (target === 'c' && code > 0x7e) {
      // C source is safest as ASCII: write UTF-8 bytes as escapes.
      for (const byte of new TextEncoder().encode(char)) out += `\\x${byte.toString(16).padStart(2, '0')}`;
      // An escape followed by a hex digit would be read as part of it; split the literal.
      continue;
    }
    out += char;
  }
  if (target === 'c') out = out.replace(/(\\x[0-9a-f]{2})(?=[0-9a-fA-F])/g, '$1""');
  return out;
}

export function escapeString(text: string, target: EscapeTarget): string {
  switch (target) {
    case 'json':
      return JSON.stringify(text)
        .slice(1, -1)
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
    case 'javascript':
    case 'java':
    case 'csharp':
    case 'c':
    case 'python':
      return escapeCLike(text, target, '"');
    case 'shell':
      return `'${text.replace(/'/g, `'"'"'`)}'`;
    case 'powershell':
      return `'${text.replace(/'/g, "''")}'`;
    case 'sql':
      return `'${text.replace(/'/g, "''")}'`;
    case 'regex':
      return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    case 'csv':
      return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
}

function unescapeCLike(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = text[++i];
    if (next === undefined) throw new ToolError('The text ends with a lone backslash.');
    const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', a: '\u0007', '0': '\0', '\\': '\\', "'": "'", '"': '"', '`': '`', '/': '/', '?': '?', e: '\u001b' };
    if (next === 'x') {
      const hex = /^[0-9a-fA-F]{1,2}/.exec(text.slice(i + 1))?.[0];
      if (!hex) throw new ToolError(`"\\x" at position ${i} needs hexadecimal digits.`);
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += hex.length;
    } else if (next === 'u') {
      const braced = /^\{([0-9a-fA-F]{1,6})\}/.exec(text.slice(i + 1));
      const plain = /^[0-9a-fA-F]{4}/.exec(text.slice(i + 1));
      if (braced) {
        out += String.fromCodePoint(Number.parseInt(braced[1] as string, 16));
        i += braced[0].length;
      } else if (plain) {
        out += String.fromCharCode(Number.parseInt(plain[0], 16));
        i += 4;
      } else throw new ToolError(`"\\u" at position ${i} needs four hexadecimal digits.`);
    } else if (next === 'U') {
      const long = /^[0-9a-fA-F]{8}/.exec(text.slice(i + 1));
      if (!long) throw new ToolError(`"\\U" at position ${i} needs eight hexadecimal digits.`);
      out += String.fromCodePoint(Number.parseInt(long[0], 16));
      i += 8;
    } else if (/[0-7]/.test(next) && /[0-7]/.test(text[i + 1] ?? '')) {
      const octal = /^[0-7]{1,3}/.exec(text.slice(i))?.[0] as string;
      out += String.fromCharCode(Number.parseInt(octal, 8));
      i += octal.length - 1;
    } else if (next === '\n') {
      // A backslash before a newline continues the line.
    } else if (next in simple) {
      out += simple[next];
    } else {
      out += next;
    }
  }
  // Re-join UTF-8 byte escapes (\xE2\x82\xAC) into characters when they form valid UTF-8.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the test is exactly whether every character is a single byte
  if (/[\x80-\xff]/.test(out) && !/[^\x00-\xff]/.test(out)) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(out, (c) => c.charCodeAt(0)));
    } catch {
      return out;
    }
  }
  return out;
}

export function unescapeString(input: string, target: EscapeTarget): string {
  const text = input.trim();
  switch (target) {
    case 'json': {
      const body = text.startsWith('"') && text.endsWith('"') && text.length > 1 ? text : `"${text}"`;
      try {
        const value: unknown = JSON.parse(body);
        if (typeof value === 'string') return value;
      } catch {
        // fall through to the error below
      }
      throw new ToolError('This is not a valid JSON string body. Check for unescaped quotes or backslashes.');
    }
    case 'shell': {
      // Undo the '...'"'"'...' pattern produced by single-quote escaping.
      if (/^'.*'$/s.test(text)) return text.slice(1, -1).replace(/'"'"'/g, "'").replace(/'\\''/g, "'");
      return unescapeCLike(text);
    }
    case 'powershell':
    case 'sql': {
      const body = /^'.*'$/s.test(text) ? text.slice(1, -1) : text;
      return body.replace(/''/g, "'");
    }
    case 'regex':
      return text.replace(/\\(.)/g, '$1');
    case 'csv':
      return /^".*"$/s.test(text) ? text.slice(1, -1).replace(/""/g, '"') : text;
    default: {
      const body = /^(["'`]).*\1$/s.test(text) && text.length > 1 ? text.slice(1, -1) : text;
      return unescapeCLike(body);
    }
  }
}
