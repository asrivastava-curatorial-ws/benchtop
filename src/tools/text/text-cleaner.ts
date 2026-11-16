import { defineTextTool } from '../types';

export default defineTextTool({
  input: { label: 'Text', sample: '  1. “Smart quotes” — and   double  spaces\t\n\n\n2. <b>HTML</b> tags &amp; entities\n3. Accents: café, naïve, Zürich\n4. Emoji 🎉 and trailing spaces    \n' },
  output: { label: 'Cleaned' },
  options: [
    { key: 'trim', label: 'Trim each line', type: 'toggle', default: true },
    { key: 'spaces', label: 'Collapse repeated spaces', type: 'toggle', default: true },
    {
      key: 'empty',
      label: 'Empty lines',
      type: 'select',
      choices: [
        { value: 'keep', label: 'Keep' },
        { value: 'collapse', label: 'At most one in a row' },
        { value: 'remove', label: 'Remove all' },
      ],
      default: 'collapse',
    },
    { key: 'html', label: 'Strip HTML tags and entities', type: 'toggle', default: false },
    { key: 'quotes', label: 'Straighten quotes, dashes and ellipses', type: 'toggle', default: false },
    { key: 'accents', label: 'Remove accents (café → cafe)', type: 'toggle', default: false },
    { key: 'emoji', label: 'Remove emoji', type: 'toggle', default: false },
    { key: 'ascii', label: 'Remove all other non-ASCII', type: 'toggle', default: false },
    { key: 'punctuation', label: 'Remove punctuation', type: 'toggle', default: false },
    {
      key: 'numbers',
      label: 'Line numbers',
      type: 'select',
      choices: [
        { value: 'keep', label: 'Keep' },
        { value: 'remove', label: 'Remove' },
        { value: 'add', label: 'Add' },
      ],
      default: 'keep',
    },
    {
      key: 'tabs',
      label: 'Tabs',
      type: 'select',
      choices: [
        { value: 'keep', label: 'Keep' },
        { value: '2', label: 'To 2 spaces' },
        { value: '4', label: 'To 4 spaces' },
      ],
      default: 'keep',
    },
    { key: 'filter', label: 'Lines containing', type: 'text', default: '', placeholder: 'Optional text to look for' },
    {
      key: 'filterMode',
      label: 'Those lines',
      type: 'segmented',
      choices: [
        { value: 'remove', label: 'Remove' },
        { value: 'keep', label: 'Keep only' },
      ],
      default: 'remove',
      showIf: (v) => String(v.filter) !== '',
    },
    {
      key: 'breaks',
      label: 'Line breaks',
      type: 'select',
      choices: [
        { value: 'keep', label: 'Keep' },
        { value: 'br', label: 'To <br>' },
        { value: 'paragraphs', label: 'To <p> paragraphs' },
        { value: 'join', label: 'Join into one line' },
      ],
      default: 'keep',
    },
  ],
  run(input, o) {
    let text = input.replace(/\r\n?/g, '\n');
    if (o.html)
      text = text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h\d)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
    if (o.quotes)
      text = text
        .replace(/[‘’‚‛′]/g, "'")
        .replace(/[“”„‟″]/g, '"')
        .replace(/[–—―]/g, '-')
        .replace(/…/g, '...')
        .replace(/\u00A0/g, ' ');
    if (o.accents) text = text.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
    if (o.emoji) text = text.replace(/\p{Extended_Pictographic}(\u200D\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*/gu, '');
    if (o.ascii) text = text.replace(/[^\t\n\x20-\x7e]/g, '');
    if (o.punctuation) text = text.replace(/[\p{P}]/gu, '');
    if (o.tabs !== 'keep') text = text.replace(/\t/g, ' '.repeat(Number(o.tabs)));
    let lines = text.split('\n');
    if (o.numbers === 'remove') lines = lines.map((line) => line.replace(/^\s*(\d+[.):]|\d+\s+-)\s?/, ''));
    if (o.spaces) lines = lines.map((line) => line.replace(/(\S)[ \t]{2,}/g, '$1 '));
    if (o.trim) lines = lines.map((line) => line.trim());
    if (o.filter !== '') lines = lines.filter((line) => line.includes(o.filter) === (o.filterMode === 'keep'));
    if (o.empty === 'remove') lines = lines.filter((line) => line.trim() !== '');
    if (o.empty === 'collapse') lines = lines.filter((line, index) => line.trim() !== '' || (lines[index - 1] ?? '').trim() !== '');
    if (o.numbers === 'add') {
      const width = String(lines.length).length;
      lines = lines.map((line, index) => `${String(index + 1).padStart(width)}. ${line}`);
    }
    let output = lines.join('\n');
    if (o.breaks === 'br') output = lines.join('<br>\n');
    if (o.breaks === 'join') output = lines.filter((line) => line.trim() !== '').join(' ');
    if (o.breaks === 'paragraphs')
      output = output
        .split(/\n{2,}/)
        .map((block) => `<p>${block.replace(/\n/g, '<br>\n')}</p>`)
        .join('\n');
    return { output, info: `${input.length.toLocaleString('en-US')} → ${output.length.toLocaleString('en-US')} characters` };
  },
});
