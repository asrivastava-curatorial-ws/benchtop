import { fromBase64 } from '../../lib/bytes';
import { BROWSER_USER_AGENT, bodyText, type Chain, describeFailure, describeStatus, followRedirects, header, normalizeUrl, pageTitle, securityHeaderChecks, verdict } from '../../lib/net/http';
import { daysUntil, esc, expiryTone, type FieldTone, formatDay, formatMs, heading, html, note, pairs, pill, relativeDays, report, table } from '../../lib/net/report';
import { commonName } from '../../lib/net/tls';
import { parseCertificate } from '../../lib/x509';
import { mapLimit, net, settle } from '../../platform/net';
import { defineTextTool, type Field } from '../types';
import { TIMEOUT, targetLines } from './_online';

interface Outcome {
  readonly target: string;
  readonly url: string;
  readonly chain?: Chain;
  readonly error?: string;
  readonly title?: string;
  readonly certDays?: number;
  readonly certExpiry?: Date;
  readonly certIssuer?: string;
}

const VERDICT_LABEL: Record<string, [string, FieldTone]> = {
  up: ['Up', 'ok'],
  redirect: ['Redirect', 'warn'],
  'client-error': ['Page error', 'warn'],
  'server-error': ['Server error', 'bad'],
  down: ['Down', 'bad'],
};

function summary(outcome: Outcome): [string, FieldTone] {
  if (!outcome.chain) return VERDICT_LABEL.down as [string, FieldTone];
  const status = outcome.chain.final.status;
  if (outcome.chain.problem) return ['Redirect problem', 'bad'];
  return VERDICT_LABEL[verdict(status)] as [string, FieldTone];
}

function rawHeaders(chain: Chain): string {
  return chain.hops
    .map((hop) => {
      const r = hop.response;
      return [`# ${hop.url}`, `${r.version} ${r.status} ${r.reason}`.trim(), ...r.headers.map(([name, value]) => `${name}: ${value}`)].join('\n');
    })
    .join('\n\n');
}

export default defineTextTool({
  input: { label: 'Websites', placeholder: 'One address per line, for example\nexample.org\nhttps://example.com/login', sample: 'example.org\nhttps://www.wikipedia.org/' },
  output: { label: 'Headers' },
  options: [
    {
      key: 'method',
      label: 'Request',
      type: 'segmented',
      choices: [
        { value: 'GET', label: 'GET' },
        { value: 'HEAD', label: 'HEAD' },
      ],
      default: 'GET',
      help: 'GET downloads the page (needed for its title). HEAD asks for headers only, but some servers answer it differently.',
    },
    { key: 'follow', label: 'Follow redirects', type: 'toggle', default: true },
    {
      key: 'agent',
      label: 'Identify as',
      type: 'select',
      choices: [
        { value: 'benchtop', label: 'Benchtop' },
        { value: 'browser', label: 'A web browser' },
      ],
      default: 'benchtop',
      help: 'Some sites block requests that do not look like a browser.',
    },
    TIMEOUT,
  ],
  live: false,
  action: 'Check',
  mainThread: true,
  async run(input, o) {
    const transport = net();
    const targets = targetLines(input);
    const headers: [string, string][] = [
      ['accept', 'text/html,application/xhtml+xml,*/*;q=0.8'],
      ['accept-encoding', 'gzip, deflate'],
    ];
    if (o.agent === 'browser') headers.push(['user-agent', BROWSER_USER_AGENT]);
    const outcomes = await mapLimit(targets, 6, async (target): Promise<Outcome> => {
      const url = normalizeUrl(target);
      const result = await settle(followRedirects(transport, { url, method: o.method, headers, timeoutMs: o.timeout * 1000, maxBody: 512 * 1024 }, o.follow ? 10 : 0));
      if (!result.ok) return { target, url, error: result.error };
      const chain = result.value;
      const final = chain.final;
      const contentType = header(final, 'content-type') ?? '';
      const title = o.method === 'GET' && /html/i.test(contentType) ? pageTitle(bodyText(final)) : undefined;
      let certDays: number | undefined;
      let certExpiry: Date | undefined;
      let certIssuer: string | undefined;
      const certificate = [...chain.hops].reverse().find((hop) => hop.response.peerCertificate)?.response.peerCertificate;
      if (certificate) {
        try {
          const cert = parseCertificate(fromBase64(certificate));
          certExpiry = cert.notAfter;
          certDays = daysUntil(cert.notAfter);
          certIssuer = commonName(cert.issuer);
        } catch {
          // not fatal: the status is what matters here
        }
      }
      return { target, url, chain, title, certDays, certExpiry, certIssuer };
    });

    const upCount = outcomes.filter((outcome) => summary(outcome)[1] === 'ok').length;
    const fields: Field[] = [];
    let preview: string;
    let output: string;

    if (outcomes.length === 1) {
      const outcome = outcomes[0] as Outcome;
      const [label, tone] = summary(outcome);
      if (!outcome.chain) {
        fields.push({ label: 'Result', value: 'Down', tone: 'bad' }, { label: 'Why', value: describeFailure(outcome.error) });
        return {
          fields,
          output: outcome.error ?? '',
          preview: { kind: 'html', html: report(note(`${outcome.url} could not be reached from this computer. ${outcome.error ?? ''}`, 'bad')) },
          info: 'Checked from this computer, so a local network or firewall problem also shows as down.',
        };
      }
      const chain = outcome.chain;
      const final = chain.final;
      const first = chain.hops[0]?.response;
      fields.push(
        { label: 'Result', value: `${label}: ${describeStatus(final.status, final.reason)}`, tone },
        { label: 'Status', value: `${final.status} ${final.reason}`.trim(), mono: true, tone },
        { label: 'Final address', value: chain.hops[chain.hops.length - 1]?.url ?? outcome.url, mono: true },
        { label: 'Redirects', value: String(chain.hops.length - 1), tone: chain.problem ? 'bad' : undefined },
        { label: 'First byte', value: formatMs(first?.headersMs ?? 0), mono: true },
        { label: 'Total time', value: formatMs(chain.hops.reduce((sum, hop) => sum + hop.response.elapsedMs, 0)), mono: true },
        { label: 'Server address', value: final.remoteAddr ?? '—', mono: true },
        { label: 'Protocol', value: final.version, mono: true },
      );
      const server = header(final, 'server');
      if (server) fields.push({ label: 'Server software', value: server, mono: true });
      const contentType = header(final, 'content-type');
      if (contentType) fields.push({ label: 'Content type', value: contentType, mono: true });
      const encoding = header(final, 'content-encoding');
      fields.push({ label: 'Compression', value: encoding ?? 'none', tone: encoding ? 'ok' : 'warn' });
      if (outcome.title) fields.push({ label: 'Page title', value: outcome.title });
      if (outcome.certExpiry && outcome.certDays !== undefined) {
        fields.push({ label: 'Certificate expires', value: `${formatDay(outcome.certExpiry)} (${relativeDays(outcome.certDays)})`, tone: expiryTone(outcome.certDays) });
      }
      const https = (chain.hops[chain.hops.length - 1]?.url ?? '').startsWith('https:');
      const security = securityHeaderChecks(final, https);
      fields.push({ label: 'Security headers', value: `Grade ${security.grade}`, tone: security.grade.startsWith('A') ? 'ok' : security.grade <= 'C' ? 'warn' : 'bad' });

      const parts = [
        chain.problem ? note(chain.problem, 'bad') : '',
        heading('Redirect chain'),
        table(
          ['#', 'Address', 'Status', 'Time'],
          chain.hops.map((hop, index) => [
            index + 1,
            html(`<code>${esc(hop.url)}</code>`),
            html(pill(`${hop.response.status} ${hop.response.reason}`.trim(), hop.response.status < 300 ? 'ok' : hop.response.status < 400 ? 'info' : 'bad')),
            formatMs(hop.response.elapsedMs),
          ]),
          { numeric: [0, 3] },
        ),
        heading(`Security headers: grade ${security.grade}`),
        table(
          ['Header', 'Result', 'Notes'],
          security.checks.map((check) => [check.name, html(pill(check.present ? 'Present' : 'Missing', check.tone === 'muted' ? 'muted' : check.tone)), check.advice]),
        ),
        heading('Response headers'),
        pairs(final.headers.map(([name, value]) => [name, html(`<code>${esc(value)}</code>`)])),
      ];
      preview = report(...parts);
      output = rawHeaders(chain);
    } else {
      const rows = outcomes.map((outcome) => {
        const [label, tone] = summary(outcome);
        const final = outcome.chain?.final;
        return [
          html(`<code>${esc(outcome.target)}</code>`),
          html(pill(label, tone)),
          final ? `${final.status}` : (outcome.error ?? ''),
          final ? formatMs(outcome.chain?.hops.reduce((sum, hop) => sum + hop.response.elapsedMs, 0) ?? 0) : '',
          final?.remoteAddr?.replace(/:\d+$/, '') ?? '',
          outcome.certDays !== undefined ? html(pill(relativeDays(outcome.certDays), expiryTone(outcome.certDays))) : '',
          outcome.title ?? '',
        ];
      });
      preview = report(table(['Address', 'Result', 'Status', 'Time', 'IP address', 'Certificate', 'Title'], rows, { numeric: [3] }));
      output = [
        'address\tresult\tstatus\ttime_ms\tip\tcert_days\ttitle',
        ...outcomes.map((outcome) =>
          [
            outcome.target,
            summary(outcome)[0],
            outcome.chain?.final.status ?? outcome.error ?? '',
            Math.round(outcome.chain?.hops.reduce((sum, hop) => sum + hop.response.elapsedMs, 0) ?? 0),
            outcome.chain?.final.remoteAddr ?? '',
            outcome.certDays ?? '',
            outcome.title ?? '',
          ].join('\t'),
        ),
      ].join('\n');
      fields.push({ label: 'Up', value: `${upCount} of ${outcomes.length}`, tone: upCount === outcomes.length ? 'ok' : upCount === 0 ? 'bad' : 'warn' });
    }
    return {
      fields,
      output,
      filename: outcomes.length === 1 ? 'headers.txt' : 'website-status.tsv',
      preview: { kind: 'html', html: preview },
      info: `Checked from this computer at ${new Date().toLocaleTimeString()}. A local network or firewall problem also shows as down.`,
    };
  },
});
