import { ToolError } from '../../lib/errors';
import { escapeHtml } from '../../lib/text';
import { defineTextTool } from '../types';

const addresses = (text: string): string[] =>
  text
    .split(/[,;\s]+/)
    .map((address) => address.trim())
    .filter(Boolean);

export function buildMailto(to: string[], fields: { cc?: string[]; bcc?: string[]; subject?: string; body?: string }): string {
  const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  const recipients = (list: string[]) => list.map((address) => encode(address).replace(/%40/g, '@')).join(',');
  const query: string[] = [];
  if (fields.cc?.length) query.push(`cc=${recipients(fields.cc)}`);
  if (fields.bcc?.length) query.push(`bcc=${recipients(fields.bcc)}`);
  if (fields.subject) query.push(`subject=${encode(fields.subject)}`);
  // RFC 6068: line breaks in the body must be encoded as CRLF.
  if (fields.body) query.push(`body=${encode(fields.body.replace(/\r\n|\r|\n/g, '\r\n'))}`);
  return `mailto:${recipients(to)}${query.length > 0 ? `?${query.join('&')}` : ''}`;
}

/** Every character as a numeric character reference, alternating decimal and hex. */
const entities = (text: string): string => Array.from(text, (ch, index) => (index % 2 === 0 ? `&#${ch.codePointAt(0)};` : `&#x${ch.codePointAt(0)?.toString(16)};`)).join('');

export default defineTextTool({
  input: false,
  output: { label: 'Code' },
  options: [
    { key: 'to', label: 'To', type: 'text', default: 'hello@example.org', wide: true, placeholder: 'one or more addresses' },
    { key: 'cc', label: 'Cc', type: 'text', default: '' },
    { key: 'bcc', label: 'Bcc', type: 'text', default: '' },
    { key: 'subject', label: 'Subject', type: 'text', default: 'Question about your project', wide: true },
    { key: 'body', label: 'Message', type: 'text', default: 'Hello,\n\nI would like to know more about…', multiline: true },
    { key: 'label', label: 'Link text', type: 'text', default: 'Email us' },
    {
      key: 'format',
      label: 'Output',
      type: 'select',
      choices: [
        { value: 'html', label: 'HTML link' },
        { value: 'url', label: 'mailto: URL only' },
        { value: 'entities', label: 'HTML link, obfuscated with entities' },
        { value: 'script', label: 'HTML link assembled by JavaScript' },
        { value: 'markdown', label: 'Markdown link' },
      ],
      default: 'html',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const to = addresses(o.to);
    if (to.length === 0) throw new ToolError('Enter at least one recipient address.');
    const cc = addresses(o.cc);
    const bcc = addresses(o.bcc);
    const invalid = [...to, ...cc, ...bcc].filter((address) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address));
    const url = buildMailto(to, { cc, bcc, subject: o.subject, body: o.body });
    const label = o.label.trim() || to[0] || '';
    let output: string;
    switch (o.format) {
      case 'url':
        output = url;
        break;
      case 'markdown':
        output = `[${label.replace(/[[\]]/g, '\\$&')}](${url})`;
        break;
      case 'entities':
        output = `<a href="${entities(url)}">${label.includes('@') ? entities(label) : escapeHtml(label)}</a>`;
        break;
      case 'script': {
        const [user = '', domain = ''] = (to[0] ?? '').split('@');
        const rest = url.slice(`mailto:${to[0]}`.length);
        output = [
          `<a href="#" data-mail-user="${escapeHtml(user)}" data-mail-domain="${escapeHtml(domain)}"${rest ? ` data-mail-rest="${escapeHtml(rest)}"` : ''}>${escapeHtml(label.includes('@') ? 'Email' : label)}</a>`,
          '<script>',
          "  document.querySelectorAll('a[data-mail-user]').forEach(function (link) {",
          "    var address = link.dataset.mailUser + '@' + link.dataset.mailDomain;",
          "    link.href = 'mailto:' + address + (link.dataset.mailRest || '');",
          '  });',
          '</script>',
        ].join('\n');
        break;
      }
      default:
        output = `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
    }
    const warnings: string[] = [];
    if (invalid.length > 0) warnings.push(`These do not look like email addresses: ${invalid.join(', ')}`);
    if (o.format === 'script' && to.length > 1) warnings.push('The JavaScript variant hides the first recipient only; the others stay visible in the page source.');
    if (url.length > 2000) warnings.push(`The link is ${url.length} characters long; some mail clients truncate mailto links beyond about 2000.`);
    return {
      output,
      language: o.format === 'url' ? 'text' : o.format === 'markdown' ? 'markdown' : 'html',
      fields: [{ label: 'mailto URL', value: url, mono: true }],
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
});
