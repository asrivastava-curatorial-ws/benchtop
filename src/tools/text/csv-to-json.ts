import Papa from 'papaparse';
import { ToolError } from '../../lib/errors';
import { indentUnit } from '../../lib/json';
import { plural } from '../../lib/text';
import { defineTextTool } from '../types';
import { INDENT } from './_shared';

const SAMPLE = `id,name,joined,active,notes
1,Ada Lovelace,1843-10-18,true,"Wrote the first program, by hand"
2,Grace Hopper,1944-07-02,true,"Said ""it's easier to ask forgiveness"""
3,Alan Turing,1936-05-28,false,"Multi-line
note"`;

export const DELIMITERS = [
  { value: 'auto', label: 'Auto-detect' },
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe' },
] as const;

const DELIMITER_NAMES: Record<string, string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };

export default defineTextTool({
  input: { label: 'CSV', sample: SAMPLE, accept: '.csv,.tsv,.txt,text/csv' },
  output: { label: 'JSON', language: 'json' },
  options: [
    { key: 'delimiter', label: 'Delimiter', type: 'select', choices: DELIMITERS, default: 'auto' },
    { key: 'header', label: 'First row is a header', type: 'toggle', default: true },
    { key: 'typed', label: 'Detect numbers and booleans', type: 'toggle', default: true, help: 'Empty cells become null.' },
    { key: 'trim', label: 'Trim values', type: 'toggle', default: false },
    INDENT,
  ],
  run(input, o) {
    const parsed = Papa.parse<unknown>(input.replace(/^\uFEFF/, ''), {
      delimiter: o.delimiter === 'auto' ? '' : o.delimiter,
      header: o.header,
      dynamicTyping: o.typed,
      skipEmptyLines: 'greedy',
      transform: o.trim ? (value: string) => value.trim() : undefined,
      transformHeader: o.header ? (name: string) => name.trim() : undefined,
    });
    const fatal = parsed.errors.find((error) => error.type === 'Quotes');
    if (fatal) {
      throw new ToolError(`${fatal.message}${fatal.row !== undefined ? ` (data row ${fatal.row + 1})` : ''}.`);
    }
    const warnings = parsed.errors
      .filter((error) => error.type === 'FieldMismatch')
      .slice(0, 5)
      .map((error) => `Row ${(error.row ?? 0) + (o.header ? 2 : 1)}: ${error.message}`);
    const rows = parsed.data;
    const columns = o.header ? (parsed.meta.fields?.length ?? 0) : Array.isArray(rows[0]) ? rows[0].length : 0;
    return {
      output: JSON.stringify(rows, null, indentUnit(o.indent)),
      info: `${plural(rows.length, 'row')} × ${plural(columns, 'column')} · ${DELIMITER_NAMES[parsed.meta.delimiter] ?? JSON.stringify(parsed.meta.delimiter)}-separated`,
      warnings: warnings.length > 0 ? warnings : undefined,
      filename: 'data.json',
    };
  },
});
