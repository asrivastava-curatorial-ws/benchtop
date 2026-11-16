import { formatBytes } from '../../lib/bytes';
import { documentText } from '../../lib/documents';
import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: { label: 'Document', binary: true, accept: '.pdf,.docx,.docm,.xlsx,.xlsm,.pptx,.odt,.ods,.odp', placeholder: 'Open or drop a PDF, Word, Excel, PowerPoint or OpenDocument file' },
  output: { label: 'Text' },
  options: [
    { key: 'collapse', label: 'Collapse runs of blank lines', type: 'toggle', default: true },
    { key: 'unwrap', label: 'Join lines broken mid-sentence', type: 'toggle', default: false, help: 'Useful for PDFs, where every printed line ends with a line break.' },
  ],
  mainThread: true,
  async run(_input, o, ctx) {
    if (!ctx.file) return {};
    if (!/\.(pdf|docx|docm|xlsx|xlsm|pptx|odt|ods|odp)$/i.test(ctx.file.name)) throw new ToolError('Open a PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx) or OpenDocument file.');
    let text = await documentText(ctx.file.name, ctx.file.bytes);
    if (o.unwrap) text = text.replace(/([^\n.!?:;])\n(?=[a-z(])/g, '$1 ');
    if (o.collapse) text = text.replace(/\n{3,}/g, '\n\n');
    const words = text.split(/\s+/).filter(Boolean).length;
    return { output: text, filename: ctx.file.name.replace(/\.[^.]+$/, '.txt'), info: `${ctx.file.name} (${formatBytes(ctx.file.bytes.length)}): ${words.toLocaleString('en-US')} words` };
  },
});
