import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { defineTextTool } from '../types';

const SAMPLE = `<article>
  <h1>Release notes</h1>
  <p>Converts <strong>HTML</strong> to <em>Markdown</em>, including <del>strikethrough</del> and <a href="https://example.org">links</a>.</p>
  <table>
    <thead><tr><th>Feature</th><th>Status</th></tr></thead>
    <tbody><tr><td>Tables</td><td>yes</td></tr><tr><td>Task lists</td><td>yes</td></tr></tbody>
  </table>
  <ul><li><input type="checkbox" checked> Done</li><li><input type="checkbox"> To do</li></ul>
  <pre><code class="language-js">console.log('kept as a fenced block');</code></pre>
  <script>alert('scripts are dropped')</script>
</article>`;

export default defineTextTool({
  input: { label: 'HTML', language: 'html', sample: SAMPLE, accept: '.html,.htm,.txt,text/html' },
  output: { label: 'Markdown', language: 'markdown' },
  // Turndown walks a DOM, which only exists on the main thread.
  mainThread: true,
  options: [
    { key: 'gfm', label: 'GitHub flavour (tables, strikethrough)', type: 'toggle', default: true },
    {
      key: 'headings',
      label: 'Headings',
      type: 'select',
      choices: [
        { value: 'atx', label: '# ATX' },
        { value: 'setext', label: 'Underlined (Setext)' },
      ],
      default: 'atx',
    },
    { key: 'bullet', label: 'Bullets', type: 'select', choices: ['-', '*', '+'], default: '-' },
    {
      key: 'code',
      label: 'Code blocks',
      type: 'select',
      choices: [
        { value: 'fenced', label: '``` fenced' },
        { value: 'indented', label: 'Indented' },
      ],
      default: 'fenced',
    },
    {
      key: 'emphasis',
      label: 'Emphasis',
      type: 'select',
      choices: [
        { value: '_', label: '_italic_' },
        { value: '*', label: '*italic*' },
      ],
      default: '_',
    },
    {
      key: 'links',
      label: 'Links',
      type: 'select',
      choices: [
        { value: 'inlined', label: 'Inline' },
        { value: 'referenced', label: 'Reference list' },
      ],
      default: 'inlined',
    },
  ],
  run(input, o) {
    const service = new TurndownService({
      headingStyle: o.headings as 'atx' | 'setext',
      bulletListMarker: o.bullet as '-' | '*' | '+',
      codeBlockStyle: o.code as 'fenced' | 'indented',
      emDelimiter: o.emphasis as '_' | '*',
      linkStyle: o.links as 'inlined' | 'referenced',
      hr: '---',
    });
    if (o.gfm) {
      service.use(gfm);
      // The plugin writes ~text~; the double tilde is understood by far more Markdown renderers.
      service.addRule('strikethrough', {
        filter: ['del', 's'],
        replacement: (content) => `~~${content}~~`,
      });
    }
    // Turndown pads list markers to four columns ("-   item"); use the conventional single space.
    service.addRule('listItem', {
      filter: 'li',
      replacement(content, node, options) {
        const parent = node.parentNode as (Node & { children?: ArrayLike<Node>; getAttribute?: (name: string) => string | null }) | null;
        let prefix = `${options.bulletListMarker} `;
        if (parent?.nodeName === 'OL') {
          const start = Number(parent.getAttribute?.('start') ?? 1) || 1;
          const index = Array.prototype.indexOf.call(parent.children ?? [], node);
          prefix = `${start + Math.max(0, index)}. `;
        }
        const body = content
          .replace(/^\n+/, '')
          .replace(/\n+$/, '\n')
          .replace(/\n/gm, `\n${' '.repeat(prefix.length)}`);
        return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '');
      },
    });
    service.remove(['script', 'style', 'noscript', 'template']);
    return { output: `${service.turndown(input).trim()}\n`, filename: 'document.md' };
  },
});
