import { escapeHtml } from '../../lib/text';
import { defineTextTool } from '../types';

type Parser = { parse(input: string): import('@lezer/common').Tree };

const LANGUAGES: Record<string, { label: string; load: () => Promise<Parser> }> = {
  javascript: { label: 'JavaScript', load: async () => (await import('@codemirror/lang-javascript')).javascript().language.parser },
  typescript: { label: 'TypeScript', load: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }).language.parser },
  jsx: { label: 'JSX / TSX', load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true }).language.parser },
  html: { label: 'HTML', load: async () => (await import('@codemirror/lang-html')).html().language.parser },
  css: { label: 'CSS', load: async () => (await import('@codemirror/lang-css')).css().language.parser },
  json: { label: 'JSON', load: async () => (await import('@codemirror/lang-json')).json().language.parser },
  xml: { label: 'XML', load: async () => (await import('@codemirror/lang-xml')).xml().language.parser },
  yaml: { label: 'YAML', load: async () => (await import('@codemirror/lang-yaml')).yaml().language.parser },
  markdown: { label: 'Markdown', load: async () => (await import('@codemirror/lang-markdown')).markdown().language.parser },
  python: { label: 'Python', load: async () => (await import('@codemirror/lang-python')).python().language.parser },
  sql: { label: 'SQL', load: async () => (await import('@codemirror/lang-sql')).sql().language.parser },
  java: { label: 'Java', load: async () => (await import('@codemirror/lang-java')).java().language.parser },
  cpp: { label: 'C / C++', load: async () => (await import('@codemirror/lang-cpp')).cpp().language.parser },
  rust: { label: 'Rust', load: async () => (await import('@codemirror/lang-rust')).rust().language.parser },
  go: { label: 'Go', load: async () => (await import('@codemirror/lang-go')).go().language.parser },
  php: { label: 'PHP', load: async () => (await import('@codemirror/lang-php')).php({ plain: true }).language.parser },
};

const THEMES: Record<string, { background: string; text: string; colors: Record<string, string> }> = {
  'github-light': {
    background: '#ffffff',
    text: '#1f2328',
    colors: {
      keyword: '#cf222e',
      string: '#0a3069',
      comment: '#6e7781',
      number: '#0550ae',
      bool: '#0550ae',
      atom: '#0550ae',
      typeName: '#953800',
      className: '#953800',
      definition: '#8250df',
      variableName: '#1f2328',
      propertyName: '#0550ae',
      tagName: '#116329',
      attributeName: '#0550ae',
      meta: '#6e7781',
      operator: '#cf222e',
      heading: '#0550ae',
      link: '#0a3069',
      invalid: '#82071e',
    },
  },
  'github-dark': {
    background: '#0d1117',
    text: '#e6edf3',
    colors: {
      keyword: '#ff7b72',
      string: '#a5d6ff',
      comment: '#8b949e',
      number: '#79c0ff',
      bool: '#79c0ff',
      atom: '#79c0ff',
      typeName: '#ffa657',
      className: '#ffa657',
      definition: '#d2a8ff',
      variableName: '#e6edf3',
      propertyName: '#79c0ff',
      tagName: '#7ee787',
      attributeName: '#79c0ff',
      meta: '#8b949e',
      operator: '#ff7b72',
      heading: '#79c0ff',
      link: '#a5d6ff',
      invalid: '#ffa198',
    },
  },
};

export default defineTextTool({
  input: { label: 'Code', sample: 'function greet(name: string): string {\n  // Say hello\n  return "Hello, " + name + "!";\n}\n\nconst count = 42;\nconsole.log(greet("Benchtop"), count);\n' },
  output: { label: 'HTML', language: 'html' },
  options: [
    { key: 'language', label: 'Language', type: 'select', choices: Object.entries(LANGUAGES).map(([value, { label }]) => ({ value, label })), default: 'typescript' },
    {
      key: 'theme',
      label: 'Colours',
      type: 'select',
      choices: [
        { value: 'github-light', label: 'GitHub light' },
        { value: 'github-dark', label: 'GitHub dark' },
      ],
      default: 'github-dark',
    },
    { key: 'lineNumbers', label: 'Line numbers', type: 'toggle', default: false },
    { key: 'font', label: 'Font', type: 'text', default: "'JetBrains Mono', ui-monospace, Consolas, monospace", mono: true },
  ],
  async run(input, o) {
    if (input === '') return '';
    const [{ highlightCode, classHighlighter }, parser] = await Promise.all([import('@lezer/highlight'), (LANGUAGES[o.language] ?? (LANGUAGES.javascript as (typeof LANGUAGES)[string])).load()]);
    const theme = THEMES[o.theme] ?? (THEMES['github-dark'] as (typeof THEMES)[string]);
    const lines: string[] = [''];
    highlightCode(
      input.replace(/\n$/, ''),
      parser.parse(input.replace(/\n$/, '')),
      classHighlighter,
      (text, classes) => {
        const names = classes.split(' ').map((name) => name.replace(/^tok-/, ''));
        const color = names.map((name) => theme.colors[name]).find(Boolean);
        const italic = names.includes('comment') || names.includes('emphasis');
        const bold = names.includes('strong') || names.includes('heading');
        const style = [color && `color:${color}`, italic && 'font-style:italic', bold && 'font-weight:bold'].filter(Boolean).join(';');
        lines[lines.length - 1] += style ? `<span style="${style}">${escapeHtml(text)}</span>` : escapeHtml(text);
      },
      () => lines.push(''),
    );
    const gutter = String(lines.length).length;
    const body = lines
      .map((line, index) => (o.lineNumbers ? `<span style="color:${theme.colors.comment};user-select:none">${String(index + 1).padStart(gutter, ' ')}  </span>${line}` : line))
      .join('\n');
    const html = `<pre style="background:${theme.background};color:${theme.text};padding:16px;border-radius:8px;overflow:auto;font-family:${escapeHtml(o.font)};font-size:14px;line-height:1.5"><code>${body}</code></pre>`;
    return { output: `${html}\n`, preview: { kind: 'html', html }, filename: 'highlighted.html' };
  },
});
