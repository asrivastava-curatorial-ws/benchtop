/** Unix permissions, .env files and Markdown tables. */
import { ToolError } from './errors';

/* ------------------------------------------------------------------ chmod -- */

export interface Permissions {
  /** [owner, group, others] x [read, write, execute] */
  readonly bits: readonly [readonly [boolean, boolean, boolean], readonly [boolean, boolean, boolean], readonly [boolean, boolean, boolean]];
  readonly setuid: boolean;
  readonly setgid: boolean;
  readonly sticky: boolean;
}

export function fromMode(mode: number): Permissions {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) throw new ToolError('A mode is an octal number from 0 to 7777.');
  const triple = (shift: number) => [Boolean(mode & (4 << shift)), Boolean(mode & (2 << shift)), Boolean(mode & (1 << shift))] as const;
  return { bits: [triple(6), triple(3), triple(0)], setuid: Boolean(mode & 0o4000), setgid: Boolean(mode & 0o2000), sticky: Boolean(mode & 0o1000) };
}

export function toMode(p: Permissions): number {
  let mode = (p.setuid ? 0o4000 : 0) | (p.setgid ? 0o2000 : 0) | (p.sticky ? 0o1000 : 0);
  p.bits.forEach((triple, index) => {
    const shift = 6 - index * 3;
    if (triple[0]) mode |= 4 << shift;
    if (triple[1]) mode |= 2 << shift;
    if (triple[2]) mode |= 1 << shift;
  });
  return mode;
}

export const octal = (mode: number): string => (mode > 0o777 ? mode.toString(8).padStart(4, '0') : mode.toString(8).padStart(3, '0'));

/** The nine-character form used by `ls -l`, with s/S and t/T for the special bits. */
export function symbolic(p: Permissions): string {
  const special = [p.setuid, p.setgid, p.sticky];
  return p.bits
    .map((triple, index) => {
      const r = triple[0] ? 'r' : '-';
      const w = triple[1] ? 'w' : '-';
      const flag = special[index] as boolean;
      const letter = index === 2 ? 't' : 's';
      const x = flag ? (triple[2] ? letter : letter.toUpperCase()) : triple[2] ? 'x' : '-';
      return `${r}${w}${x}`;
    })
    .join('');
}

/** The `u=rwx,g=rx,o=` form accepted by chmod. */
export function chmodSymbolic(p: Permissions): string {
  const who = ['u', 'g', 'o'];
  return p.bits
    .map((triple, index) => {
      let set = `${triple[0] ? 'r' : ''}${triple[1] ? 'w' : ''}${triple[2] ? 'x' : ''}`;
      if (index === 0 && p.setuid) set += 's';
      if (index === 1 && p.setgid) set += 's';
      if (index === 2 && p.sticky) set += 't';
      return `${who[index]}=${set}`;
    })
    .join(',');
}

/** Reads "755", "0644", "rwxr-xr-x", "-rw-r--r--" or "drwxrwsr-t". */
export function parsePermissions(text: string): Permissions {
  const value = text.trim();
  if (/^0?[0-7]{3,4}$/.test(value)) return fromMode(Number.parseInt(value, 8));
  const nine = value.length === 10 ? value.slice(1) : value;
  if (/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(nine)) {
    const c = [...nine];
    const exec = (ch: string | undefined) => ch === 'x' || ch === 's' || ch === 't';
    return {
      bits: [
        [c[0] === 'r', c[1] === 'w', exec(c[2])],
        [c[3] === 'r', c[4] === 'w', exec(c[5])],
        [c[6] === 'r', c[7] === 'w', exec(c[8])],
      ],
      setuid: c[2] === 's' || c[2] === 'S',
      setgid: c[5] === 's' || c[5] === 'S',
      sticky: c[8] === 't' || c[8] === 'T',
    };
  }
  throw new ToolError(`"${value}" is not a mode. Use an octal number such as 755, or a form such as rwxr-xr-x.`);
}

/* ------------------------------------------------------------------- .env -- */

/** Parses dotenv syntax: comments, `export`, quotes, escapes in double quotes and multi-line values. */
export function parseDotenv(text: string): { values: Record<string, string>; duplicates: string[] } {
  const values: Record<string, string> = {};
  const duplicates: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new ToolError(`Line ${i + 1} is not KEY=value: ${line.slice(0, 60)}`);
    const key = match[1] as string;
    let raw = match[2] as string;
    let value: string;
    const quote = raw[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      // Values may continue over several lines until the closing quote.
      let body = raw.slice(1);
      let close = findClosing(body, quote);
      while (close < 0 && i + 1 < lines.length) {
        body += `\n${lines[++i] as string}`;
        close = findClosing(body, quote);
      }
      if (close < 0) throw new ToolError(`The value of ${key} has no closing ${quote}.`);
      value = body.slice(0, close);
      if (quote === '"') value = value.replace(/\\([nrt"\\$])/g, (_, ch: string) => ({ n: '\n', r: '\r', t: '\t' })[ch] ?? ch);
    } else {
      raw = raw.replace(/\s+#.*$/, '');
      value = raw.trim();
    }
    if (key in values) duplicates.push(key);
    values[key] = value;
  }
  return { values, duplicates };
}

function findClosing(body: string, quote: string): number {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && quote === '"') {
      i++;
      continue;
    }
    if (body[i] === quote) return i;
  }
  return -1;
}

/** Writes a .env file, quoting only when needed. */
export function stringifyDotenv(values: Record<string, unknown>, exportPrefix = false): string {
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) throw new ToolError(`"${key}" cannot be used as a variable name.`);
    const value = raw === null || raw === undefined ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
    const needsQuotes = value === '' ? false : /[\s#"'`$\\=]/.test(value);
    const written = needsQuotes ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\$/g, '\\$')}"` : value;
    lines.push(`${exportPrefix ? 'export ' : ''}${key}=${written}`);
  }
  return `${lines.join('\n')}\n`;
}

/* --------------------------------------------------------- Markdown tables -- */

export type Align = 'none' | 'left' | 'center' | 'right';

/** Builds a GitHub-flavoured Markdown table from rows; the first row is the header. */
export function markdownTable(rows: readonly (readonly string[])[], align: Align, pad: boolean): string {
  if (rows.length === 0) throw new ToolError('There is nothing to put in the table.');
  const width = Math.max(...rows.map((row) => row.length));
  const cell = (text: string | undefined) => (text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
  const grid = rows.map((row) => Array.from({ length: width }, (_, i) => cell(row[i])));
  const widths = Array.from({ length: width }, (_, i) => Math.max(3, ...grid.map((row) => [...(row[i] as string)].length)));
  const fit = (text: string, i: number) => (pad ? text + ' '.repeat((widths[i] as number) - [...text].length) : text);
  const rule = widths.map((w) => {
    const size = pad ? w : 3;
    if (align === 'left') return `:${'-'.repeat(size - 1)}`;
    if (align === 'right') return `${'-'.repeat(size - 1)}:`;
    if (align === 'center') return `:${'-'.repeat(Math.max(1, size - 2))}:`;
    return '-'.repeat(size);
  });
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  const [header, ...body] = grid;
  return `${[line((header as string[]).map(fit)), line(rule), ...body.map((row) => line(row.map(fit)))].join('\n')}\n`;
}
