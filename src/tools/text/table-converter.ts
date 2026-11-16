import { Parser } from 'htmlparser2';
import Papa from 'papaparse';
import { stringify as yamlStringify } from 'yaml';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { escapeHtml, escapeXml } from '../../lib/text';
import { defineTextTool, type Lang } from '../types';

type Table = { header: string[]; rows: string[][] };

const cellText = (value: unknown): string => (value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));

export function detectInput(text: string): string {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) return 'json';
  if (/^<table|<tr[\s>]/i.test(trimmed)) return 'html';
  if (/^\|.*\|\s*$/m.test(trimmed.split('\n')[0] ?? '')) return 'markdown';
  if (/^\s*insert\s+into/i.test(trimmed)) return 'sql';
  return 'csv';
}

function fromMarkdown(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|') || line.includes('|'))
    .filter((line) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim().replace(/\\\|/g, '|')),
    );
}

function fromHtml(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] | null = null;
  let cell: string | null = null;
  const parser = new Parser(
    {
      onopentag(name) {
        if (name === 'tr') row = [];
        else if ((name === 'td' || name === 'th') && row) cell = '';
        else if (name === 'br' && cell !== null) cell += '\n';
      },
      ontext(value) {
        if (cell !== null) cell += value;
      },
      onclosetag(name) {
        if ((name === 'td' || name === 'th') && row && cell !== null) {
          row.push(cell.replace(/\s+/g, ' ').trim());
          cell = null;
        } else if (name === 'tr' && row) {
          rows.push(row);
          row = null;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(text);
  parser.end();
  return rows;
}

function fromSql(text: string): Table {
  const columns =
    /insert\s+into\s+[`"[\]\w.]+\s*\(([^)]*)\)/i
      .exec(text)?.[1]
      ?.split(',')
      .map((name) => name.trim().replace(/^[`"[]|[`"\]]$/g, '')) ?? [];
  const rows: string[][] = [];
  for (const group of text.matchAll(/\(((?:[^()']|'(?:[^']|'')*')*)\)/g)) {
    if (group.index !== undefined && /into\s+[`"[\]\w.]+\s*$/i.test(text.slice(0, group.index))) continue;
    const values = [...(group[1] as string).matchAll(/'((?:[^']|'')*)'|([^,\s][^,]*)/g)].map((match) =>
      match[1] !== undefined ? match[1].replace(/''/g, "'") : (match[2] ?? '').trim().replace(/^NULL$/i, ''),
    );
    rows.push(values);
  }
  return { header: columns.length > 0 ? columns : (rows[0] ?? []).map((_, index) => `column${index + 1}`), rows };
}

function read(text: string, format: string, hasHeader: boolean): Table {
  let grid: string[][];
  switch (format) {
    case 'json': {
      const value = parseJson(text);
      if (!Array.isArray(value)) throw new ToolError('JSON input must be an array of objects or of arrays.');
      if (value.every((item) => Array.isArray(item))) grid = (value as unknown[][]).map((item) => item.map(cellText));
      else {
        const keys = [...new Set(value.flatMap((item) => (item !== null && typeof item === 'object' ? Object.keys(item) : ['value'])))];
        return { header: keys, rows: value.map((item) => keys.map((key) => cellText(item !== null && typeof item === 'object' ? (item as Record<string, unknown>)[key] : item))) };
      }
      break;
    }
    case 'markdown':
      return (() => {
        const rows = fromMarkdown(text);
        return { header: rows[0] ?? [], rows: rows.slice(1) };
      })();
    case 'html':
      grid = fromHtml(text);
      break;
    case 'sql':
      return fromSql(text);
    default: {
      const parsed = Papa.parse<string[]>(text.trim(), { delimiter: format === 'tsv' ? '\t' : '', skipEmptyLines: true });
      grid = parsed.data;
    }
  }
  if (grid.length === 0) throw new ToolError('No table rows found.');
  const width = Math.max(...grid.map((row) => row.length));
  const square = grid.map((row) => [...row, ...Array<string>(width - row.length).fill('')]);
  return hasHeader ? { header: square[0] as string[], rows: square.slice(1) } : { header: (square[0] as string[]).map((_, index) => `Column ${index + 1}`), rows: square };
}

const width = (text: string) => [...text].length;

function asciiTable(table: Table, unicode: boolean): string {
  const all = [table.header, ...table.rows];
  const widths = table.header.map((_, column) => Math.max(...all.map((row) => width(row[column] ?? ''))));
  const [h, v, tl, tm, tr, ml, mm, mr, bl, bm, br] = unicode ? ['─', '│', '┌', '┬', '┐', '├', '┼', '┤', '└', '┴', '┘'] : ['-', '|', '+', '+', '+', '+', '+', '+', '+', '+', '+'];
  const line = (left: string, middle: string, right: string) => left + widths.map((size) => h.repeat(size + 2)).join(middle) + right;
  const row = (cells: string[]) => v + cells.map((cell, index) => ` ${cell}${' '.repeat((widths[index] ?? 0) - width(cell))} `).join(v) + v;
  return [line(tl, tm, tr), row(table.header), line(ml, mm, mr), ...table.rows.map(row), line(bl, bm, br)].join('\n');
}

const sqlValue = (value: string): string => (value === '' ? 'NULL' : /^-?\d+(\.\d+)?$/.test(value) && !/^0\d/.test(value) ? value : `'${value.replace(/'/g, "''")}'`);
const identifier = (name: string): string => `"${name.replace(/"/g, '""')}"`;

function write(table: Table, format: string, o: { tableName: string; typed: boolean }): { text: string; language: Lang } {
  const objects = () =>
    table.rows.map((row) =>
      Object.fromEntries(
        table.header.map((key, index) => {
          const value = row[index] ?? '';
          return [key, o.typed && /^-?\d+(\.\d+)?$/.test(value) && !/^0\d/.test(value) ? Number(value) : o.typed && /^(true|false)$/i.test(value) ? value.toLowerCase() === 'true' : value];
        }),
      ),
    );
  switch (format) {
    case 'json':
      return { text: `${JSON.stringify(objects(), null, 2)}\n`, language: 'json' };
    case 'json-arrays':
      return { text: `${JSON.stringify([table.header, ...table.rows])}\n`, language: 'json' };
    case 'yaml':
      return { text: yamlStringify(objects()), language: 'yaml' };
    case 'tsv':
      return { text: `${Papa.unparse([table.header, ...table.rows], { delimiter: '\t' })}\n`, language: 'text' };
    case 'markdown': {
      const escapeCell = (cell: string) => cell.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
      return {
        text: `| ${table.header.map(escapeCell).join(' | ')} |\n| ${table.header.map(() => '---').join(' | ')} |\n${table.rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`).join('\n')}\n`,
        language: 'markdown',
      };
    }
    case 'html':
      return {
        text: `<table>\n  <thead>\n    <tr>${table.header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr>\n  </thead>\n  <tbody>\n${table.rows.map((row) => `    <tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('\n')}\n  </tbody>\n</table>\n`,
        language: 'html',
      };
    case 'sql': {
      const name = identifier(o.tableName || 'my_table');
      const create = `CREATE TABLE ${name} (\n${table.header.map((column, index) => `  ${identifier(column)} ${table.rows.every((row) => /^-?\d+$/.test(row[index] ?? '') || row[index] === '') ? 'INTEGER' : table.rows.every((row) => /^-?\d+(\.\d+)?$/.test(row[index] ?? '') || row[index] === '') ? 'NUMERIC' : 'TEXT'}`).join(',\n')}\n);\n\n`;
      return {
        text: `${create}INSERT INTO ${name} (${table.header.map(identifier).join(', ')}) VALUES\n${table.rows.map((row) => `  (${row.map(sqlValue).join(', ')})`).join(',\n')};\n`,
        language: 'text',
      };
    }
    case 'xml':
      return {
        text: `<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n${table.rows
          .map(
            (row) =>
              `  <row>${table.header
                .map((key, index) => {
                  const tag = key.replace(/[^\w.-]/g, '_').replace(/^(\d)/, '_$1') || 'column';
                  return `<${tag}>${escapeXml(row[index] ?? '')}</${tag}>`;
                })
                .join('')}</row>`,
          )
          .join('\n')}\n</rows>\n`,
        language: 'xml',
      };
    case 'ascii':
      return { text: `${asciiTable(table, false)}\n`, language: 'text' };
    case 'unicode':
      return { text: `${asciiTable(table, true)}\n`, language: 'text' };
    case 'latex':
      return {
        text: `\\begin{tabular}{${table.header.map(() => 'l').join('')}}\n\\hline\n${table.header.join(' & ')} \\\\\n\\hline\n${table.rows.map((row) => `${row.map((cell) => cell.replace(/([&%$#_{}])/g, '\\$1')).join(' & ')} \\\\`).join('\n')}\n\\hline\n\\end{tabular}\n`,
        language: 'text',
      };
    default:
      return { text: `${Papa.unparse([table.header, ...table.rows])}\n`, language: 'text' };
  }
}

export default defineTextTool({
  input: {
    label: 'Table',
    placeholder: 'Paste CSV, TSV, a spreadsheet selection, Markdown, an HTML table, JSON or SQL INSERTs. Excel and OpenDocument files open as text.',
    sample: 'Gallery,Floor,Exhibits\nEngines,Ground,42\nSpace,First,31\nElectricity,First,27',
    documents: true,
  },
  output: { label: 'Converted' },
  options: [
    { key: 'from', label: 'From', type: 'select', choices: [{ value: 'auto', label: 'Detect' }, 'csv', 'tsv', 'markdown', 'html', 'json', 'sql'], default: 'auto' },
    {
      key: 'to',
      label: 'To',
      type: 'select',
      choices: [
        { value: 'markdown', label: 'Markdown' },
        { value: 'csv', label: 'CSV' },
        { value: 'tsv', label: 'TSV (paste into Excel)' },
        { value: 'json', label: 'JSON objects' },
        { value: 'json-arrays', label: 'JSON arrays' },
        { value: 'yaml', label: 'YAML' },
        { value: 'html', label: 'HTML table' },
        { value: 'sql', label: 'SQL CREATE and INSERT' },
        { value: 'xml', label: 'XML' },
        { value: 'ascii', label: 'ASCII table' },
        { value: 'unicode', label: 'Box-drawing table' },
        { value: 'latex', label: 'LaTeX tabular' },
      ],
      default: 'markdown',
    },
    { key: 'header', label: 'First row is a header', type: 'toggle', default: true },
    { key: 'typed', label: 'Numbers and booleans as JSON values', type: 'toggle', default: true },
    { key: 'tableName', label: 'SQL table name', type: 'text', default: 'my_table', showIf: (v) => v.to === 'sql' },
  ],
  run(input, o) {
    if (input.trim() === '') return '';
    const source = input.replace(/^# .+\n/, '');
    const from = o.from === 'auto' ? (/\t/.test(source.split('\n')[0] ?? '') ? 'tsv' : detectInput(source)) : o.from;
    const table = read(source, from, o.header || from === 'json' || from === 'sql');
    const { text, language } = write(table, o.to, o);
    return {
      output: text,
      language,
      info: `${table.rows.length} rows × ${table.header.length} columns, read as ${from.toUpperCase()}`,
      filename: `table.${{ markdown: 'md', 'json-arrays': 'json', unicode: 'txt', ascii: 'txt', latex: 'tex' }[o.to] ?? o.to}`,
    };
  },
});
