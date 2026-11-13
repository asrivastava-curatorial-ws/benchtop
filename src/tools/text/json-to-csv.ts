import Papa from 'papaparse';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { plural } from '../../lib/text';
import { defineTextTool } from '../types';

const SAMPLE = `[
  { "id": 1, "name": "Ada Lovelace", "address": { "city": "London", "zip": "W1" }, "tags": ["math", "poetry"] },
  { "id": 2, "name": "Grace \\"Amazing\\" Hopper", "address": { "city": "Arlington" }, "active": true },
  { "id": 3, "name": "Alan Turing", "tags": [] }
]`;

type Cell = string | number | boolean | null;
type ArrayMode = 'json' | 'join' | 'index';

function flatten(value: unknown, prefix: string, arrays: ArrayMode, out: Map<string, Cell>): void {
  if (value === null || typeof value !== 'object') {
    out.set(prefix, value as Cell);
    return;
  }
  if (Array.isArray(value)) {
    if (arrays === 'index') {
      if (value.length === 0) out.set(prefix, '');
      value.forEach((item, index) => {
        flatten(item, prefix === '' ? String(index) : `${prefix}.${index}`, arrays, out);
      });
    } else if (arrays === 'join' && value.every((item) => item === null || typeof item !== 'object')) {
      out.set(prefix, value.map((item) => (item === null ? '' : String(item))).join('; '));
    } else {
      out.set(prefix, JSON.stringify(value));
    }
    return;
  }
  const entries = Object.entries(value);
  if (entries.length === 0 && prefix !== '') out.set(prefix, '{}');
  for (const [key, item] of entries) flatten(item, prefix === '' ? key : `${prefix}.${key}`, arrays, out);
}

export default defineTextTool({
  input: { label: 'JSON', language: 'json', sample: SAMPLE, accept: '.json,.txt,application/json' },
  output: { label: 'CSV' },
  options: [
    {
      key: 'delimiter',
      label: 'Delimiter',
      type: 'select',
      choices: [
        { value: ',', label: 'Comma' },
        { value: ';', label: 'Semicolon' },
        { value: '\t', label: 'Tab' },
        { value: '|', label: 'Pipe' },
      ],
      default: ',',
    },
    { key: 'header', label: 'Header row', type: 'toggle', default: true },
    {
      key: 'arrays',
      label: 'Arrays become',
      type: 'select',
      choices: [
        { value: 'join', label: 'One cell: a; b; c' },
        { value: 'json', label: 'One cell: ["a","b"]' },
        { value: 'index', label: 'Columns: tags.0, tags.1' },
      ],
      default: 'join',
    },
    { key: 'quoteAll', label: 'Quote every value', type: 'toggle', default: false },
    {
      key: 'safe',
      label: 'Neutralise formulas',
      type: 'toggle',
      default: false,
      help: 'Prefix cells starting with = + - @ so spreadsheet apps do not execute them as formulas.',
    },
    { key: 'bom', label: 'Excel-friendly (UTF-8 BOM, CRLF)', type: 'toggle', default: false },
  ],
  run(input, o) {
    const data = parseJson(input);
    const records = Array.isArray(data) ? data : [data];
    if (records.length === 0) throw new ToolError('The JSON array is empty, so there are no rows to write.');
    const common = {
      delimiter: o.delimiter,
      quotes: o.quoteAll,
      escapeFormulae: o.safe,
      newline: o.bom ? '\r\n' : '\n',
    };
    let csv: string;
    let columns: number;
    if (records.every((record) => Array.isArray(record))) {
      const rows = (records as unknown[][]).map((row) => row.map((cell) => (cell !== null && typeof cell === 'object' ? JSON.stringify(cell) : cell)));
      columns = Math.max(...rows.map((row) => row.length));
      csv = Papa.unparse(rows, common);
    } else {
      const fields: string[] = [];
      const seen = new Set<string>();
      const rows = records.map((record) => {
        const flat = new Map<string, Cell>();
        if (record !== null && typeof record === 'object' && !Array.isArray(record)) flatten(record, '', o.arrays as ArrayMode, flat);
        else flat.set('value', record !== null && typeof record === 'object' ? JSON.stringify(record) : (record as Cell));
        for (const key of flat.keys()) {
          if (!seen.has(key)) {
            seen.add(key);
            fields.push(key);
          }
        }
        return flat;
      });
      columns = fields.length;
      csv = Papa.unparse({ fields, data: rows.map((row) => fields.map((field) => row.get(field) ?? '')) }, { ...common, header: o.header });
    }
    return {
      output: (o.bom ? '\uFEFF' : '') + csv,
      info: `${plural(records.length, 'row')} × ${plural(columns, 'column')}`,
      filename: 'data.csv',
    };
  },
});
