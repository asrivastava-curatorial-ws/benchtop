import { formatBytes, looksLikeText } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { bodyBytes, bodyText, followRedirects, header, normalizeUrl, parseHeaderLines } from '../../lib/net/http';
import { esc, formatMs, heading, html, note, pairs, pill, report, table } from '../../lib/net/report';
import { net } from '../../platform/net';
import { defineTextTool, type Lang } from '../types';

const languageFor = (contentType: string): Lang => {
  if (/json/i.test(contentType)) return 'json';
  if (/html/i.test(contentType)) return 'html';
  if (/xml/i.test(contentType)) return 'xml';
  if (/css/i.test(contentType)) return 'css';
  if (/javascript|ecmascript/i.test(contentType)) return 'javascript';
  if (/yaml/i.test(contentType)) return 'yaml';
  if (/markdown/i.test(contentType)) return 'markdown';
  return 'text';
};

const extensionFor = (contentType: string): string => {
  const subtype = /\/([a-z0-9.+-]+)/i.exec(contentType)?.[1]?.replace(/^.*\+/, '') ?? 'bin';
  return { 'svg+xml': 'svg', jpeg: 'jpg', 'octet-stream': 'bin', plain: 'txt', javascript: 'js' }[subtype] ?? subtype;
};

export default defineTextTool({
  input: false,
  output: { label: 'Body' },
  options: [
    { key: 'method', label: 'Method', type: 'select', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], default: 'GET' },
    { key: 'url', label: 'URL', type: 'text', default: '', placeholder: 'https://api.example.org/v1/items', mono: true, wide: true },
    {
      key: 'headers',
      label: 'Headers',
      type: 'text',
      default: 'Accept: application/json',
      multiline: true,
      mono: true,
      placeholder: 'Name: value, one per line',
      help: 'Values marked as secret are not saved; headers are, so do not keep long-lived tokens here.',
    },
    { key: 'auth', label: 'Bearer token', type: 'text', default: '', secret: true, mono: true, placeholder: 'Optional; sent as Authorization: Bearer …' },
    { key: 'body', label: 'Body', type: 'text', default: '', multiline: true, mono: true, placeholder: '{"name": "value"}', showIf: (v) => !['GET', 'HEAD', 'OPTIONS'].includes(String(v.method)) },
    { key: 'follow', label: 'Follow redirects', type: 'toggle', default: true },
    { key: 'insecure', label: 'Ignore certificate errors', type: 'toggle', default: false, help: 'Only for your own test servers with self-signed certificates.' },
    { key: 'pretty', label: 'Pretty-print JSON', type: 'toggle', default: true },
    { key: 'timeout', label: 'Give up after', type: 'number', default: 30, min: 2, max: 120, step: 1, unit: 's' },
  ],
  live: false,
  action: 'Send',
  mainThread: true,
  async run(_input, o) {
    const transport = net();
    const url = normalizeUrl(o.url);
    if (url === '') throw new ToolError('Enter a URL.');
    const headers = parseHeaderLines(o.headers);
    if (o.auth.trim() !== '') headers.push(['Authorization', `Bearer ${o.auth.trim()}`]);
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(o.method) && o.body !== '';
    if (hasBody && !headers.some(([name]) => name.toLowerCase() === 'content-type')) {
      const trimmed = o.body.trim();
      headers.push(['Content-Type', trimmed.startsWith('{') || trimmed.startsWith('[') ? 'application/json' : 'text/plain;charset=utf-8']);
    }
    if (!headers.some(([name]) => name.toLowerCase() === 'accept-encoding')) headers.push(['Accept-Encoding', 'gzip, deflate']);
    const chain = await followRedirects(
      transport,
      { url, method: o.method, headers, body: hasBody ? o.body : undefined, timeoutMs: o.timeout * 1000, maxBody: 8 * 1024 * 1024, insecure: o.insecure },
      o.follow ? 10 : 0,
    );
    const response = chain.final;
    const contentType = header(response, 'content-type') ?? '';
    const bytes = bodyBytes(response);
    const textual = bytes.length === 0 || /text|json|xml|javascript|yaml|csv|html|svg|x-www-form-urlencoded/i.test(contentType) || (contentType === '' && looksLikeText(bytes));
    let output = textual ? bodyText(response) : '';
    let language = languageFor(contentType);
    if (textual && o.pretty && (language === 'json' || /^\s*[[{]/.test(output))) {
      try {
        output = `${JSON.stringify(JSON.parse(output), null, 2)}\n`;
        language = 'json';
      } catch {
        // not JSON after all; show as received
      }
    }
    const tone = response.status < 300 ? 'ok' : response.status < 400 ? 'info' : 'bad';
    return {
      fields: [
        { label: 'Status', value: `${response.status} ${response.reason}`.trim(), tone: tone === 'info' ? 'warn' : tone, mono: true },
        { label: 'Time', value: `${formatMs(chain.hops.reduce((sum, hop) => sum + hop.response.elapsedMs, 0))} (first byte ${formatMs(chain.hops[0]?.response.headersMs ?? 0)})`, mono: true },
        {
          label: 'Size',
          value: `${formatBytes(bytes.length)}${response.truncated ? ' (cut off at 8 MB)' : ''}${header(response, 'content-encoding') ? `, ${formatBytes(response.bodySize)} compressed` : ''}`,
          mono: true,
        },
        { label: 'Content type', value: contentType || '—', mono: true },
        { label: 'Protocol', value: `${response.version}${response.remoteAddr ? ` from ${response.remoteAddr}` : ''}`, mono: true },
      ],
      output,
      language,
      filename: `response.${textual ? (language === 'text' ? 'txt' : language === 'javascript' ? 'js' : language) : extensionFor(contentType)}`,
      binary: textual ? undefined : { name: `response.${extensionFor(contentType)}`, mime: contentType || 'application/octet-stream', bytes },
      preview: {
        kind: 'html',
        html: report(
          chain.problem ? note(chain.problem, 'bad') : '',
          chain.hops.length > 1
            ? heading('Redirects') +
                table(
                  ['#', 'Address', 'Status'],
                  chain.hops.map((hop, index) => [index + 1, html(`<code>${esc(hop.url)}</code>`), html(pill(String(hop.response.status), hop.response.status < 300 ? 'ok' : 'info'))]),
                  { numeric: [0] },
                )
            : '',
          heading(`Response headers (${response.headers.length})`),
          pairs(response.headers.map(([name, value]) => [name, html(`<code>${esc(value)}</code>`)])),
          !textual ? note(`The body is binary (${formatBytes(bytes.length)}). Use the save button to keep it.`) : '',
        ),
      },
    };
  },
});
