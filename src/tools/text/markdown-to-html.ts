import { marked } from 'marked';
import { escapeHtml } from '../../lib/text';
import { defineTextTool, type Values } from '../types';

const SAMPLE = `# Release notes

Benchtop converts **Markdown** to HTML with _GitHub-flavoured_ extras.

| Feature        | Status |
| -------------- | :----: |
| Tables         |   yes  |
| ~~Strikeout~~  |   yes  |

- [x] Task lists
- [ ] Footnotes

\`\`\`js
console.log('code blocks keep their text');
\`\`\`

> Links are shown but never opened: [example](https://example.org).
`;

export default defineTextTool({
  input: { label: 'Markdown', language: 'markdown', sample: SAMPLE, accept: '.md,.markdown,.txt,text/markdown' },
  output: { label: 'HTML', language: 'html' },
  options: [
    { key: 'gfm', label: 'GitHub flavour (tables, task lists)', type: 'toggle', default: true },
    { key: 'breaks', label: 'Line breaks become <br>', type: 'toggle', default: false },
    { key: 'document', label: 'Full HTML document', type: 'toggle', default: false },
    { key: 'title', label: 'Title', type: 'text', default: 'Document', showIf: (v: Values) => v.document === true },
  ],
  runOnEmpty: false,
  run(input, o) {
    const body = marked.parse(input, { gfm: o.gfm, breaks: o.breaks, async: false });
    const output = o.document
      ? `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(o.title)}</title>\n</head>\n<body>\n${body}</body>\n</html>\n`
      : body;
    return { output, preview: { kind: 'html', html: body }, filename: 'document.html' };
  },
});
