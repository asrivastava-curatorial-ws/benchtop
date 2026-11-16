import { Parser } from 'htmlparser2';
import { ToolError } from '../../lib/errors';
import { BROWSER_USER_AGENT, bodyText, describeStatus, followRedirects, header, normalizeUrl } from '../../lib/net/http';
import { esc, formatMs, heading, html, note, pill, report, type Tone, table } from '../../lib/net/report';
import { mapLimit, type NetTransport, net, settle } from '../../platform/net';
import { defineTextTool } from '../types';

interface Link {
  readonly url: string;
  readonly tag: string;
  readonly text: string;
}

const LINK_ATTRIBUTES: Record<string, string[]> = {
  a: ['href'],
  area: ['href'],
  link: ['href'],
  img: ['src'],
  script: ['src'],
  iframe: ['src'],
  source: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  embed: ['src'],
};

/** Every link and resource address in a page, resolved against its base URL. */
export function extractLinks(source: string, pageUrl: string, includeResources: boolean): Link[] {
  let base = pageUrl;
  const found = new Map<string, Link>();
  let anchor: { url: string; text: string } | null = null;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === 'base' && attributes.href) {
          try {
            base = new URL(attributes.href, pageUrl).toString();
          } catch {
            // ignore a broken <base>
          }
        }
        const wanted = LINK_ATTRIBUTES[name];
        if (!wanted || (!includeResources && name !== 'a' && name !== 'area')) return;
        if (name === 'link' && !/stylesheet|icon|preload|manifest/i.test(attributes.rel ?? '')) return;
        for (const attribute of wanted) {
          const value = attributes[attribute]?.trim();
          if (!value || /^(#|javascript:|mailto:|tel:|data:|sms:|about:)/i.test(value)) continue;
          try {
            const url = new URL(value, base);
            if (!/^https?:$/.test(url.protocol)) continue;
            url.hash = '';
            const key = url.toString();
            if (!found.has(key)) found.set(key, { url: key, tag: name, text: '' });
            if (name === 'a') anchor = { url: key, text: '' };
          } catch {
            // unparseable address: skip
          }
        }
      },
      ontext(text) {
        if (anchor) anchor.text += text;
      },
      onclosetag(name) {
        if (name === 'a' && anchor) {
          const link = found.get(anchor.url);
          const text = anchor.text.replace(/\s+/g, ' ').trim();
          if (link && link.text === '' && text !== '') found.set(anchor.url, { ...link, text: text.slice(0, 80) });
          anchor = null;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(source);
  parser.end();
  return [...found.values()];
}

interface Checked {
  readonly link: Link;
  readonly status?: number;
  readonly finalUrl?: string;
  readonly redirects: number;
  readonly ms?: number;
  readonly error?: string;
}

async function check(transport: NetTransport, link: Link, headers: [string, string][], timeoutMs: number): Promise<Checked> {
  const started = performance.now();
  let result = await settle(followRedirects(transport, { url: link.url, method: 'HEAD', headers, timeoutMs, maxBody: 0 }, 8));
  // Many servers mishandle HEAD; ask again with GET before calling a link broken.
  if (!result.ok || [403, 404, 405, 501, 400].includes(result.value.final.status)) {
    const retry = await settle(followRedirects(transport, { url: link.url, method: 'GET', headers, timeoutMs, maxBody: 1024 }, 8));
    if (retry.ok || !result.ok) result = retry;
  }
  const ms = performance.now() - started;
  if (!result.ok) return { link, error: result.error, redirects: 0, ms };
  const chain = result.value;
  return { link, status: chain.final.status, finalUrl: chain.hops[chain.hops.length - 1]?.url, redirects: chain.hops.length - 1, ms, error: chain.problem };
}

const verdict = (item: Checked): [string, Tone] => {
  if (item.error && item.status === undefined) return ['Unreachable', 'bad'];
  if (item.status === undefined) return ['?', 'muted'];
  if (item.status >= 400 && item.status !== 401 && item.status !== 403 && item.status !== 429) return ['Broken', 'bad'];
  if (item.status === 401 || item.status === 403 || item.status === 429) return ['Blocked', 'warn'];
  if (item.redirects > 0) return ['Redirects', 'info'];
  return ['OK', 'ok'];
};

export default defineTextTool({
  input: false,
  output: { label: 'Table' },
  options: [
    { key: 'url', label: 'Page', type: 'text', default: '', placeholder: 'https://example.org/', mono: true, wide: true },
    {
      key: 'scope',
      label: 'Check',
      type: 'segmented',
      choices: [
        { value: 'all', label: 'All links' },
        { value: 'site', label: 'This site only' },
        { value: 'external', label: 'Other sites only' },
      ],
      default: 'all',
    },
    { key: 'resources', label: 'Include images, scripts and stylesheets', type: 'toggle', default: true },
    { key: 'limit', label: 'Check at most', type: 'number', default: 150, min: 1, max: 500, step: 10, unit: 'links' },
    { key: 'browser', label: 'Identify as a web browser', type: 'toggle', default: true, help: 'Some sites refuse requests from tools that do not look like a browser.' },
    { key: 'timeout', label: 'Give up after', type: 'number', default: 15, min: 2, max: 60, step: 1, unit: 's' },
  ],
  live: false,
  action: 'Check links',
  mainThread: true,
  async run(_input, o) {
    const transport = net();
    const pageUrl = normalizeUrl(o.url);
    if (pageUrl === '') throw new ToolError('Enter the address of a page.');
    const headers: [string, string][] = [['accept-encoding', 'gzip, deflate']];
    if (o.browser) headers.push(['user-agent', BROWSER_USER_AGENT]);
    const page = await followRedirects(transport, { url: pageUrl, headers: [...headers, ['accept', 'text/html,*/*;q=0.5']], timeoutMs: o.timeout * 1000, maxBody: 4 * 1024 * 1024 });
    if (page.final.status >= 400) throw new ToolError(`The page itself answered ${page.final.status}: ${describeStatus(page.final.status, page.final.reason)}`);
    if (!/html/i.test(header(page.final, 'content-type') ?? 'text/html')) throw new ToolError('That address is not an HTML page.');
    const finalUrl = page.hops[page.hops.length - 1]?.url ?? pageUrl;
    const host = new URL(finalUrl).host;
    let links = extractLinks(bodyText(page.final), finalUrl, o.resources);
    const total = links.length;
    if (o.scope === 'site') links = links.filter((link) => new URL(link.url).host === host);
    if (o.scope === 'external') links = links.filter((link) => new URL(link.url).host !== host);
    const limited = links.slice(0, o.limit);
    const checked = await mapLimit(limited, 6, (link) => check(transport, link, headers, o.timeout * 1000));
    const order: Record<string, number> = { Unreachable: 0, Broken: 1, Blocked: 2, Redirects: 3, OK: 4 };
    const sorted = [...checked].sort((a, b) => (order[verdict(a)[0]] ?? 9) - (order[verdict(b)[0]] ?? 9));
    const broken = checked.filter((item) => verdict(item)[1] === 'bad');
    const rows = sorted.map((item) => {
      const [label, tone] = verdict(item);
      return [
        html(pill(label, tone)),
        item.status ?? '',
        html(`<code>${esc(item.link.url)}</code>${item.redirects > 0 && item.finalUrl ? `<br><small>→ <code>${esc(item.finalUrl)}</code></small>` : ''}`),
        item.link.tag === 'a' ? item.link.text : `<${item.link.tag}>`,
        item.error && item.status === undefined ? item.error : item.ms !== undefined ? formatMs(item.ms) : '',
      ];
    });
    return {
      fields: [
        { label: 'Broken or unreachable', value: String(broken.length), tone: broken.length === 0 ? 'ok' : 'bad' },
        { label: 'Checked', value: `${checked.length} of ${links.length}${links.length > limited.length ? ` (limit ${o.limit})` : ''}` },
        { label: 'Links on the page', value: String(total) },
        { label: 'Page', value: finalUrl, mono: true },
      ],
      output: [
        'result\tstatus\turl\tfinal_url\ttext',
        ...sorted.map((item) => [verdict(item)[0], item.status ?? item.error ?? '', item.link.url, item.finalUrl ?? '', item.link.text].join('\t')),
      ].join('\n'),
      filename: 'links.tsv',
      preview: {
        kind: 'html',
        html: report(
          broken.length === 0 ? note('No broken links found.', 'ok') : note(`${broken.length} broken or unreachable link${broken.length === 1 ? '' : 's'}.`, 'bad'),
          note('"Blocked" means the server refused an automated check (401, 403 or 429); the link may still work in a browser.'),
          heading('Links'),
          table(['Result', 'Status', 'Address', 'Link text', 'Time'], rows, { numeric: [1] }),
        ),
      },
    };
  },
});
