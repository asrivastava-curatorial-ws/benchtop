import Papa from 'papaparse';
import { type Align, markdownTable } from '../../lib/devops';
import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: { label: 'CSV, TSV or cells copied from a spreadsheet', sample: 'Gallery\tFloor\tExhibits\nEngine Hall\t0\t42\nElectrotechnic\t1\t35\nSpace | Science\t2\t18', accept: '.csv,.tsv,.txt' },
  output: { label: 'Markdown', language: 'markdown' },
  options: [
    {
      key: 'align',
      label: 'Align columns',
      type: 'segmented',
      choices: [
        { value: 'none', label: 'Default' },
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Centre' },
        { value: 'right', label: 'Right' },
      ],
      default: 'none',
    },
    { key: 'pad', label: 'Line up the columns', type: 'toggle', default: true },
  ],
  run(input, o) {
    const parsed = Papa.parse<string[]>(input.trim(), { skipEmptyLines: true });
    if (parsed.data.length === 0) throw new ToolError('Paste some rows: comma- or tab-separated.');
    const output = markdownTable(parsed.data, o.align as Align, o.pad);
    return {
      output,
      info: `${parsed.data.length - 1} rows, ${Math.max(...parsed.data.map((row) => row.length))} columns. Detected separator: ${parsed.meta.delimiter === '\t' ? 'tab' : JSON.stringify(parsed.meta.delimiter)}.`,
    };
  },
});
