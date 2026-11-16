import { ToolError } from '../../lib/errors';
import { COMMON_TYPES, cleanName, formatDig, formatTtl, LOOKUP_SERVERS, RECORD_TYPES, rcodeMeaning, rcodeName, reverseName, txtValue } from '../../lib/net/dns';
import { esc, formatMs, heading, html, note, pill, report, table } from '../../lib/net/report';
import { type DnsResponse, type NetTransport, net, settle } from '../../platform/net';
import { defineTextTool, type Field, type Values } from '../types';

const isDoh = (values: Values): boolean => String(values.server).startsWith('doh-');

/** The servers that are authoritative for `name`: the NS set of the closest enclosing zone. */
async function authoritativeServer(transport: NetTransport, name: string, resolver: string, timeoutMs: number): Promise<{ zone: string; server: string; host: string }> {
  const labels = name.replace(/\.$/, '').split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const zone = labels.slice(i).join('.');
    const answer = await transport.dns({ name: zone, recordType: 'NS', server: resolver, timeoutMs });
    const hosts = answer.answers.filter((record) => record.recordType === 'NS').map((record) => record.data);
    if (hosts.length === 0) continue;
    for (const host of hosts) {
      const address = await settle(transport.dns({ name: host, recordType: 'A', server: resolver, timeoutMs }));
      const ip = address.ok ? address.value.answers.find((record) => record.recordType === 'A')?.data : undefined;
      if (ip) return { zone, server: ip, host: host.replace(/\.$/, '') };
    }
  }
  throw new ToolError(`No authoritative name server could be found for ${name}.`);
}

export default defineTextTool({
  input: false,
  output: { label: 'dig output' },
  options: [
    { key: 'name', label: 'Name', type: 'text', default: '', placeholder: 'example.org or an IP address', mono: true, wide: true },
    {
      key: 'type',
      label: 'Record type',
      type: 'select',
      choices: [{ value: 'common', label: 'All common types' }, ...RECORD_TYPES.map(({ type, about }) => ({ value: type, label: `${type}: ${about}` }))],
      default: 'common',
    },
    { key: 'server', label: 'Ask', type: 'select', choices: LOOKUP_SERVERS.map(({ value, label }) => ({ value, label })), default: 'cloudflare' },
    { key: 'custom', label: 'Server address', type: 'text', default: '', placeholder: '192.0.2.53, [2001:db8::53]:5353 or https://…/dns-query', mono: true, showIf: (v) => v.server === 'custom' },
    {
      key: 'transport',
      label: 'Transport',
      type: 'segmented',
      choices: [
        { value: 'udp', label: 'UDP' },
        { value: 'tcp', label: 'TCP' },
      ],
      default: 'udp',
      showIf: (v) => !isDoh(v) && !String(v.custom).startsWith('https://'),
    },
    {
      key: 'authoritative',
      label: 'Ask the domain’s own name servers',
      type: 'toggle',
      default: false,
      help: 'Skips caches: finds the zone’s NS records and asks the first one directly, without recursion.',
    },
    { key: 'dnssec', label: 'Request DNSSEC records', type: 'toggle', default: false, help: 'Sets the DO bit. A validating resolver then marks verified answers with the AD flag.' },
    { key: 'timeout', label: 'Give up after', type: 'number', default: 5, min: 1, max: 30, step: 1, unit: 's' },
  ],
  live: false,
  action: 'Look up',
  mainThread: true,
  async run(_input, o) {
    const transport = net();
    const typed = o.name.trim();
    if (typed === '') throw new ToolError('Enter a domain name or an IP address.');
    let name = cleanName(typed);
    const reverse = reverseName(name);
    const types = reverse !== null && (o.type === 'common' || o.type === 'PTR') ? ['PTR'] : o.type === 'common' ? [...COMMON_TYPES] : [o.type];
    if (reverse !== null) name = reverse;
    const choice = LOOKUP_SERVERS.find((server) => server.value === o.server);
    let server = o.server === 'custom' ? o.custom.trim() : (choice?.server ?? 'system');
    if (server === '') throw new ToolError('Enter the address of the DNS server to ask.');
    const timeoutMs = o.timeout * 1000;
    let authority: { zone: string; server: string; host: string } | undefined;
    if (o.authoritative) {
      authority = await authoritativeServer(transport, name, server, timeoutMs);
      server = authority.server;
    }
    const transportKind = server.startsWith('https://') ? undefined : (o.transport as 'udp' | 'tcp');
    const answers = await Promise.all(
      types.map(async (type) => ({
        type,
        result: await settle(transport.dns({ name, recordType: type, server, transport: transportKind, dnssec: o.dnssec, recursion: !o.authoritative, timeoutMs })),
      })),
    );
    const ok = answers.flatMap((item) => (item.result.ok ? [{ type: item.type, value: item.result.value as DnsResponse }] : []));
    if (ok.length === 0) {
      const failure = answers[0]?.result;
      throw new ToolError(failure && !failure.ok ? failure.error : 'No answer.');
    }
    const first = (ok[0] as (typeof ok)[number]).value;
    const records = ok.flatMap(({ value }) => value.answers);
    const fields: Field[] = [
      { label: 'Name', value: name, mono: true },
      { label: 'Status', value: `${rcodeName(first.rcode)}: ${rcodeMeaning(first.rcode)}`, tone: first.rcode === 0 ? (records.length > 0 ? 'ok' : 'warn') : 'bad' },
      { label: 'Answers', value: String(records.length), tone: records.length > 0 ? 'ok' : 'warn' },
      { label: 'Server', value: authority ? `${authority.host} (${authority.server}), authoritative for ${authority.zone}` : `${choice?.label ?? server} (${first.server})`, mono: true },
      { label: 'Query time', value: formatMs(Math.max(...ok.map(({ value }) => value.elapsedMs))), mono: true },
    ];
    if (o.authoritative) fields.push({ label: 'Authoritative answer', value: first.flags.aa ? 'Yes (AA flag set)' : 'No', tone: first.flags.aa ? 'ok' : 'warn' });
    if (o.dnssec)
      fields.push({
        label: 'DNSSEC',
        value: first.flags.ad ? 'Validated by the resolver (AD flag)' : 'Not validated (unsigned zone or a non-validating resolver)',
        tone: first.flags.ad ? 'ok' : 'muted',
      });

    const groups = types
      .map((type) => {
        const item = answers.find((answer) => answer.type === type);
        if (!item) return '';
        if (!item.result.ok) return heading(type) + note(item.result.error, 'bad');
        const rows = item.result.value.answers;
        if (rows.length === 0) return types.length === 1 ? heading(type) + note(`No ${type} records (${rcodeName(item.result.value.rcode)}).`, 'warn') : '';
        return (
          heading(`${type} (${rows.length})`) +
          table(
            ['Name', 'TTL', 'Type', 'Data'],
            rows.map((record) => [
              html(`<code>${esc(record.name)}</code>`),
              html(`<span title="${record.ttl} seconds">${esc(formatTtl(record.ttl))}</span>`),
              record.recordType === type ? record.recordType : html(pill(record.recordType, 'info')),
              html(`<code>${esc(record.recordType === 'TXT' ? txtValue(record.data) : record.data)}</code>`),
            ]),
          )
        );
      })
      .join('');
    const empty = types.filter((type) => {
      const item = answers.find((answer) => answer.type === type);
      return item?.result.ok && item.result.value.answers.length === 0;
    });
    return {
      fields,
      output: ok.map(({ type, value }) => formatDig(name, type, value)).join('\n\n'),
      filename: `${name.replace(/\.$/, '')}-dns.txt`,
      preview: { kind: 'html', html: report(groups || note('No records found.', 'warn'), types.length > 1 && empty.length > 0 ? note(`No records of type ${empty.join(', ')}.`) : '') },
    };
  },
});
