import { byteLength, sizeChange } from '../../lib/bytes';
import { defineTextTool, type Values } from '../types';
import { INDENT } from './_shared';

const SAMPLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Demo</title><style>body{margin:0;font-family:sans-serif}.card{padding:1rem}</style></head><body><!-- main --><main class="card"><h1>Hello</h1><p>Formatted <em>or</em> minified, <code>pre</code> blocks stay intact.</p><pre>  keep   this
  spacing</pre><script>document.querySelector("h1").textContent+="!";</script></main></body></html>`;

const isFormat = (v: Values): boolean => v.mode === 'format';
const isMinify = (v: Values): boolean => v.mode === 'minify';

export default defineTextTool({
  input: { label: 'HTML', language: 'html', sample: SAMPLE, accept: '.html,.htm,.xhtml,.vue,.txt,text/html' },
  output: { label: 'Result', language: 'html' },
  options: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'segmented',
      choices: [
        { value: 'format', label: 'Format' },
        { value: 'minify', label: 'Minify' },
      ],
      default: 'format',
    },
    { ...INDENT, showIf: isFormat },
    {
      key: 'wrap',
      label: 'Wrap at',
      type: 'select',
      choices: [
        { value: '0', label: 'No wrapping' },
        { value: '80', label: '80 columns' },
        { value: '120', label: '120 columns' },
        { value: '160', label: '160 columns' },
      ],
      default: '120',
      showIf: isFormat,
    },
    {
      key: 'inline',
      label: 'Inline <script>/<style>',
      type: 'select',
      choices: [
        { value: 'keep', label: 'Leave untouched' },
        { value: 'process', label: 'Format / minify too' },
      ],
      default: 'keep',
    },
    { key: 'comments', label: 'Remove comments', type: 'toggle', default: true, showIf: isMinify },
    {
      key: 'whitespace',
      label: 'Whitespace',
      type: 'select',
      choices: [
        { value: 'conservative', label: 'Collapse to one space (safest)' },
        { value: 'smart', label: 'Also remove around block tags' },
        { value: 'aggressive', label: 'Remove around every tag' },
      ],
      default: 'conservative',
      showIf: isMinify,
      help: 'Removing whitespace entirely can change spacing between inline or inline-block elements.',
    },
  ],
  async run(input, o) {
    if (o.mode === 'format') {
      const beautify = (await import('js-beautify')).default;
      const untouched = o.inline === 'keep' ? ['pre', 'textarea', 'script', 'style'] : ['pre', 'textarea'];
      const output = beautify.html(input, {
        indent_size: o.indent === 'tab' ? 1 : Number.parseInt(o.indent, 10),
        indent_char: o.indent === 'tab' ? '\t' : ' ',
        wrap_line_length: Number(o.wrap),
        preserve_newlines: true,
        max_preserve_newlines: 1,
        end_with_newline: false,
        indent_inner_html: true,
        content_unformatted: untouched,
        extra_liners: [],
      });
      const text = output.endsWith('\n') ? output : `${output}\n`;
      return { output: text, info: sizeChange(byteLength(input), byteLength(text)), filename: 'index.html' };
    }
    const { minifyHtml } = await import('../../lib/html-minify');
    const { html: output, warnings } = await minifyHtml(input, {
      whitespace: o.whitespace as 'conservative' | 'smart' | 'aggressive',
      removeComments: o.comments,
      processInline: o.inline === 'process',
    });
    return {
      output,
      info: sizeChange(byteLength(input), byteLength(output)),
      warnings: warnings.length > 0 ? warnings : undefined,
      filename: 'index.min.html',
    };
  },
});
