import { ToolError } from '../../lib/errors';
import { cleanName, isIpAddress } from '../../lib/net/dns';
import { daysUntil, esc, expiryTone, formatDay, heading, html, note, pairs, pill, relativeDays, report, table } from '../../lib/net/report';
import {
  getJson,
  normalizeStatus,
  parseRdapDomain,
  parseWhoisText,
  type Registration,
  rdapBaseForDomain,
  referralServer,
  registrableDomain,
  statusMeaning,
  statusTone,
  whoisQuery,
} from '../../lib/net/whois';
import { mapLimit, NetError, type NetTransport, net, settle } from '../../platform/net';
import { defineTextTool, type Field } from '../types';
import { TIMEOUT, targetLines } from './_online';

type Source = 'auto' | 'rdap' | 'whois';

async function viaRdap(transport: NetTransport, domain: string): Promise<Registration | null> {
  const base = await rdapBaseForDomain(transport, domain);
  if (base === null) return null;
  const url = `${base}domain/${encodeURIComponent(domain)}`;
  const { status, json, text } = await getJson(transport, url, 'application/rdap+json, application/json');
  if (status === 404) return { source: 'rdap', server: base, domain, registered: false, statuses: [], nameServers: [], contacts: [], raw: text };
  if (status !== 200 || json === null) throw new NetError('http', `The RDAP server answered HTTP ${status}.`);
  return parseRdapDomain(json, new URL(base).host, JSON.stringify(json, null, 2));
}

async function viaWhois(transport: NetTransport, domain: string, timeoutMs: number, askRegistrar: boolean): Promise<Registration> {
  const tld = domain.split('.').pop() ?? domain;
  const iana = await transport.whois({ server: 'whois.iana.org', query: tld, timeoutMs });
  const server = referralServer(iana.text);
  if (!server) throw new NetError('http', `IANA lists no WHOIS server for .${tld}.`);
  const answer = await transport.whois({ server, query: whoisQuery(server, domain), timeoutMs });
  let registration = parseWhoisText(answer.text, server, domain);
  const registrarServer = registration.registrarServer?.toLowerCase();
  if (askRegistrar && registration.registered && registrarServer && registrarServer !== server && /^[a-z0-9.-]+$/.test(registrarServer)) {
    const detail = await settle(transport.whois({ server: registrarServer, query: domain, timeoutMs }));
    if (detail.ok && detail.value.text.trim() !== '') {
      const thick = parseWhoisText(detail.value.text, registrarServer, domain);
      registration = {
        ...registration,
        registrar: registration.registrar ?? thick.registrar,
        created: registration.created ?? thick.created,
        expires: registration.expires ?? thick.expires,
        raw: `${answer.text.trim()}\n\n# ---- ${registrarServer} ----\n\n${detail.value.text.trim()}\n`,
      };
    }
  }
  return registration;
}

async function lookup(transport: NetTransport, domain: string, source: Source, timeoutMs: number, askRegistrar: boolean): Promise<Registration> {
  if (source !== 'whois') {
    const rdap = await settle(viaRdap(transport, domain));
    if (rdap.ok && rdap.value !== null) {
      const registration = rdap.value;
      // Some registry RDAP records leave out the expiry date; the registrar's record usually has it.
      if (askRegistrar && registration.registered && registration.expires === undefined && registration.registrarServer) {
        const detail = await settle(getJson(transport, registration.registrarServer, 'application/rdap+json'));
        if (detail.ok && detail.value.status === 200 && detail.value.json) {
          const thick = parseRdapDomain(detail.value.json, new URL(registration.registrarServer).host, detail.value.text);
          return { ...registration, expires: thick.expires, registrar: registration.registrar ?? thick.registrar };
        }
      }
      return registration;
    }
    if (source === 'rdap') {
      if (rdap.ok) throw new ToolError(`.${domain.split('.').pop()} has no RDAP service. Choose WHOIS or Automatic.`);
      throw new NetError(rdap.kind, rdap.error);
    }
  }
  return viaWhois(transport, domain, timeoutMs, askRegistrar);
}

function age(created: Date | undefined): string {
  if (!created) return '';
  const days = Math.floor((Date.now() - created.getTime()) / 86_400_000);
  const years = Math.floor(days / 365.25);
  return years >= 1 ? `${years} year${years === 1 ? '' : 's'} old` : `${days} days old`;
}

export default defineTextTool({
  input: { label: 'Domains', placeholder: 'One domain per line, for example\nexample.org\nexample.co.in', sample: 'wikipedia.org\nexample.com' },
  output: { label: 'Raw record' },
  options: [
    {
      key: 'source',
      label: 'Look up with',
      type: 'select',
      choices: [
        { value: 'auto', label: 'RDAP, then WHOIS' },
        { value: 'rdap', label: 'RDAP only' },
        { value: 'whois', label: 'WHOIS only' },
      ],
      default: 'auto',
      help: 'RDAP is the registries’ modern service with structured data. WHOIS (port 43) covers the TLDs that have no RDAP yet.',
    },
    { key: 'registrar', label: 'Also ask the registrar', type: 'toggle', default: true, help: 'Fetches the registrar’s own record when the registry’s leaves fields out.' },
    { key: 'warn', label: 'Warn when fewer days remain than', type: 'number', default: 30, min: 1, max: 365, step: 1, unit: 'days' },
    TIMEOUT,
  ],
  live: false,
  action: 'Look up',
  mainThread: true,
  async run(input, o) {
    const transport = net();
    const domains = targetLines(input, 30).map((line) => {
      const name = cleanName(line);
      if (isIpAddress(name)) throw new ToolError(`${name} is an IP address. Use IP Lookup for addresses.`);
      return registrableDomain(name);
    });
    const results = await mapLimit(domains, 4, async (domain) => ({ domain, result: await settle(lookup(transport, domain, o.source as Source, o.timeout * 1000, o.registrar)) }));

    if (results.length === 1) {
      const { domain, result } = results[0] as (typeof results)[number];
      if (!result.ok) return { fields: [{ label: 'Result', value: result.error, tone: 'bad' }], preview: { kind: 'html', html: report(note(result.error, 'bad')) } };
      const r = result.value;
      if (!r.registered) {
        return {
          fields: [
            { label: 'Domain', value: domain, mono: true },
            { label: 'Status', value: 'Not registered: it may be available', tone: 'warn' },
            { label: 'Source', value: `${r.source.toUpperCase()} (${r.server})`, mono: true },
          ],
          output: r.raw,
          preview: { kind: 'html', html: report(note(`${domain} is not registered according to ${r.server}.`, 'warn')) },
        };
      }
      const days = r.expires ? daysUntil(r.expires) : undefined;
      const fields: Field[] = [
        { label: 'Domain', value: r.domain || domain, mono: true },
        {
          label: 'Expires',
          value: r.expires ? `${formatDay(r.expires)} (${relativeDays(days as number)})` : 'Not published by the registry',
          tone: days === undefined ? 'muted' : expiryTone(days, o.warn),
        },
        { label: 'Registered', value: r.created ? `${formatDay(r.created)} (${age(r.created)})` : '—' },
        { label: 'Last changed', value: r.updated ? formatDay(r.updated) : '—' },
        { label: 'Registrar', value: `${r.registrar ?? '—'}${r.registrarIanaId ? ` (IANA ${r.registrarIanaId})` : ''}` },
        { label: 'Name servers', value: r.nameServers.join(', ') || '—', mono: true },
        { label: 'DNSSEC', value: r.dnssec === undefined ? 'Not stated' : r.dnssec ? 'Signed' : 'Unsigned', tone: r.dnssec ? 'ok' : 'muted' },
        { label: 'Source', value: `${r.source.toUpperCase()} (${r.server})`, mono: true },
      ];
      const parts = [
        heading('Status codes'),
        r.statuses.length > 0
          ? table(
              ['Status', 'Meaning'],
              r.statuses.map((status) => [html(pill(normalizeStatus(status), statusTone(status))), statusMeaning(status) ?? '']),
            )
          : note('No status codes published.'),
        r.contacts.length > 0
          ? heading('Contacts') +
            table(
              ['Role', 'Name', 'Organisation', 'Email', 'Phone', 'Country'],
              r.contacts.map((contact) => [contact.roles.join(', '), contact.name ?? '', contact.org ?? '', contact.email ?? '', contact.phone ?? '', contact.country ?? '']),
            )
          : '',
        r.registrarUrl ? pairs([['Registrar website', html(`<code>${esc(r.registrarUrl)}</code>`)]]) : '',
        note('Registrant details are usually redacted for privacy (GDPR). Ask the registrar for contact through its abuse or relay address.'),
      ];
      return {
        fields,
        output: r.raw,
        filename: `${domain}.${r.source === 'rdap' ? 'json' : 'txt'}`,
        language: r.source === 'rdap' ? 'json' : 'text',
        preview: { kind: 'html', html: report(...parts) },
      };
    }

    const rows = results.map(({ domain, result }) => {
      if (!result.ok) return [html(`<code>${esc(domain)}</code>`), html(pill('Failed', 'bad')), result.error, '', '', ''];
      const r = result.value;
      if (!r.registered) return [html(`<code>${esc(domain)}</code>`), html(pill('Not registered', 'warn')), '', '', '', ''];
      const days = r.expires ? daysUntil(r.expires) : undefined;
      return [
        html(`<code>${esc(domain)}</code>`),
        r.registrar ?? '',
        r.created ? formatDay(r.created) : '',
        r.expires ? formatDay(r.expires) : '—',
        days === undefined ? '' : html(pill(relativeDays(days), expiryTone(days, o.warn))),
        r.statuses.map(normalizeStatus).join(', '),
      ];
    });
    const sorted = results.flatMap(({ domain, result }) => (result.ok && result.value.expires ? [{ domain, days: daysUntil(result.value.expires) }] : [])).sort((a, b) => a.days - b.days);
    return {
      fields: [
        { label: 'Domains', value: String(results.length) },
        ...(sorted[0] ? [{ label: 'Expires first', value: `${sorted[0].domain} (${relativeDays(sorted[0].days)})`, tone: expiryTone(sorted[0].days, o.warn) } as Field] : []),
        { label: 'Failed', value: String(results.filter(({ result }) => !result.ok).length), tone: results.some(({ result }) => !result.ok) ? 'bad' : 'ok' },
      ],
      output: [
        'domain\tregistrar\tcreated\texpires\tdays_left\tstatus',
        ...results.map(({ domain, result }) =>
          (result.ok
            ? [
                domain,
                result.value.registrar ?? '',
                result.value.created ? formatDay(result.value.created) : '',
                result.value.expires ? formatDay(result.value.expires) : '',
                result.value.expires ? daysUntil(result.value.expires) : '',
                result.value.statuses.map(normalizeStatus).join('; '),
              ]
            : [domain, '', '', '', '', result.error]
          ).join('\t'),
        ),
      ].join('\n'),
      filename: 'domains.tsv',
      preview: { kind: 'html', html: report(table(['Domain', 'Registrar', 'Registered', 'Expires', 'Days left', 'Status'], rows)) },
    };
  },
});
