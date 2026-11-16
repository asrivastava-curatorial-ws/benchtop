import { ToolError } from '../../lib/errors';
import { cleanName, isIpAddress, reverseName, txtValue } from '../../lib/net/dns';
import { bodyText } from '../../lib/net/http';
import { esc, heading, html, note, pairs, report } from '../../lib/net/report';
import { getJson, rdapBaseForIp } from '../../lib/net/whois';
import { classify, parseAddress } from '../../lib/subnet';
import { type NetTransport, net, settle } from '../../platform/net';
import { defineTextTool, type Field } from '../types';

const RESOLVER = '1.1.1.1';

interface Network {
  readonly name?: string;
  readonly handle?: string;
  readonly range?: string;
  readonly cidr?: string;
  readonly country?: string;
  readonly org?: string;
  readonly abuse?: string;
  readonly registry?: string;
  readonly raw: string;
}

async function myAddress(transport: NetTransport, timeoutMs: number): Promise<string> {
  // OpenDNS answers this name with the address the query came from.
  const viaDns = await settle(transport.dns({ name: 'myip.opendns.com', recordType: 'A', server: '208.67.222.222', timeoutMs }));
  const ip = viaDns.ok ? viaDns.value.answers.find((record) => record.recordType === 'A')?.data : undefined;
  if (ip) return ip;
  const viaHttp = await transport.http({ url: 'https://api.ipify.org/', timeoutMs });
  const text = bodyText(viaHttp).trim();
  if (!isIpAddress(text)) throw new ToolError('Your public address could not be found.');
  return text;
}

async function asn(transport: NetTransport, ip: string, timeoutMs: number): Promise<{ number: string; prefix: string; country: string; registry: string; name: string } | null> {
  const reverse = reverseName(ip);
  if (reverse === null) return null;
  const zone = reverse.endsWith('in-addr.arpa.') ? 'origin.asn.cymru.com' : 'origin6.asn.cymru.com';
  const name = reverse.replace(/\.(in-addr|ip6)\.arpa\.$/, `.${zone}`);
  const origin = await settle(transport.dns({ name, recordType: 'TXT', server: RESOLVER, timeoutMs }));
  const text = origin.ok ? origin.value.answers.find((record) => record.recordType === 'TXT')?.data : undefined;
  if (!text) return null;
  const [number = '', prefix = '', country = '', registry = ''] = txtValue(text)
    .split('|')
    .map((part) => part.trim());
  const firstAs = number.split(/\s+/)[0] ?? number;
  const described = await settle(transport.dns({ name: `AS${firstAs}.asn.cymru.com`, recordType: 'TXT', server: RESOLVER, timeoutMs }));
  const description = described.ok ? described.value.answers.find((record) => record.recordType === 'TXT')?.data : undefined;
  const asName = description ? (txtValue(description).split('|')[4]?.trim() ?? '') : '';
  return { number: firstAs, prefix, country, registry, name: asName };
}

async function rdapNetwork(transport: NetTransport, ip: string): Promise<Network | null> {
  const base = await rdapBaseForIp(transport, ip);
  if (base === null) return null;
  const { status, json, text } = await getJson(transport, `${base}ip/${encodeURIComponent(ip)}`, 'application/rdap+json');
  if (status !== 200 || json === null) return null;
  const data = json as Record<string, unknown>;
  const entities = Array.isArray(data.entities) ? (data.entities as Record<string, unknown>[]) : [];
  const flat: Record<string, unknown>[] = [];
  const walk = (list: Record<string, unknown>[]) => {
    for (const entity of list) {
      flat.push(entity);
      if (Array.isArray(entity.entities)) walk(entity.entities as Record<string, unknown>[]);
    }
  };
  walk(entities);
  const vcard = (entity: Record<string, unknown> | undefined, property: string): string | undefined => {
    const card = entity?.vcardArray;
    const items = Array.isArray(card) && Array.isArray(card[1]) ? (card[1] as unknown[][]) : [];
    const found = items.find((item) => item[0] === property);
    return typeof found?.[3] === 'string' ? found[3] : undefined;
  };
  const withRole = (role: string) => flat.find((entity) => Array.isArray(entity.roles) && (entity.roles as string[]).includes(role));
  const cidr = Array.isArray(data.cidr0_cidrs)
    ? (data.cidr0_cidrs as { v4prefix?: string; v6prefix?: string; length?: number }[]).map((item) => `${item.v4prefix ?? item.v6prefix}/${item.length}`).join(', ')
    : undefined;
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    handle: typeof data.handle === 'string' ? data.handle : undefined,
    range: typeof data.startAddress === 'string' ? `${data.startAddress} – ${data.endAddress}` : undefined,
    cidr,
    country: typeof data.country === 'string' ? data.country : undefined,
    org: vcard(withRole('registrant'), 'fn') ?? vcard(withRole('administrative'), 'fn'),
    abuse: vcard(withRole('abuse'), 'email'),
    registry: new URL(base).host,
    raw: JSON.stringify(json, null, 2) || text,
  };
}

export default defineTextTool({
  input: false,
  output: { label: 'RDAP record' },
  options: [
    { key: 'target', label: 'IP address or host name', type: 'text', default: '', placeholder: 'Leave empty for your own public address', mono: true, wide: true },
    { key: 'timeout', label: 'Give up after', type: 'number', default: 8, min: 2, max: 30, step: 1, unit: 's' },
  ],
  live: false,
  action: 'Look up',
  mainThread: true,
  runOnEmpty: true,
  async run(_input, o) {
    const transport = net();
    const timeoutMs = o.timeout * 1000;
    const typed = cleanName(o.target);
    let ip: string;
    let host: string | undefined;
    const fields: Field[] = [];
    if (typed === '') {
      ip = await myAddress(transport, timeoutMs);
      fields.push({ label: 'Your public address', value: ip, mono: true, tone: 'ok' });
    } else if (isIpAddress(typed)) {
      ip = typed;
    } else {
      host = typed;
      const [v4, v6] = await Promise.all(['A', 'AAAA'].map((type) => settle(transport.dns({ name: typed, recordType: type, server: RESOLVER, timeoutMs }))));
      const addresses = [v4, v6].flatMap((result) =>
        result?.ok ? result.value.answers.filter((record) => record.recordType === 'A' || record.recordType === 'AAAA').map((record) => record.data) : [],
      );
      if (addresses.length === 0) throw new ToolError(`${typed} has no A or AAAA records.`);
      ip = addresses[0] as string;
      fields.push({ label: 'Host', value: typed, mono: true }, { label: 'Addresses', value: addresses.join(', '), mono: true });
    }
    const address = parseAddress(ip);
    const kind = classify(address.family, address.value);
    fields.push({ label: 'Address', value: ip, mono: true }, { label: 'Type', value: `IPv${address.family}, ${kind}` });
    const isPublic = /public|global/i.test(kind);

    const reverse = reverseName(ip) as string;
    const [ptr, origin, rdap] = await Promise.all([
      settle(transport.dns({ name: reverse, recordType: 'PTR', server: RESOLVER, timeoutMs })),
      isPublic ? settle(asn(transport, ip, timeoutMs)) : Promise.resolve(null),
      isPublic ? settle(rdapNetwork(transport, ip)) : Promise.resolve(null),
    ]);
    const ptrName = ptr.ok ? ptr.value.answers.find((record) => record.recordType === 'PTR')?.data.replace(/\.$/, '') : undefined;
    fields.push({ label: 'Reverse DNS (PTR)', value: ptrName ?? 'none', mono: true, tone: ptrName ? undefined : 'muted' });
    if (ptrName) {
      const confirm = await settle(transport.dns({ name: ptrName, recordType: address.family === 4 ? 'A' : 'AAAA', server: RESOLVER, timeoutMs }));
      const confirmed = confirm.ok && confirm.value.answers.some((record) => record.data === ip);
      fields.push({ label: 'Forward-confirmed', value: confirmed ? `Yes: ${ptrName} points back to ${ip}` : `No: ${ptrName} does not point back to ${ip}`, tone: confirmed ? 'ok' : 'warn' });
    }
    if (origin?.ok && origin.value) {
      const a = origin.value;
      fields.push(
        { label: 'Network (ASN)', value: `AS${a.number}${a.name ? ` ${a.name}` : ''}`, mono: true },
        { label: 'Announced prefix', value: a.prefix, mono: true },
        { label: 'Registry country', value: a.country || '—' },
      );
    }
    let raw = '';
    if (rdap?.ok && rdap.value) {
      const n = rdap.value;
      raw = n.raw;
      if (n.org) fields.push({ label: 'Organisation', value: n.org });
      if (n.name) fields.push({ label: 'Network name', value: n.name, mono: true });
      if (n.cidr ?? n.range) fields.push({ label: 'Allocated block', value: n.cidr ?? n.range ?? '', mono: true });
      if (n.abuse) fields.push({ label: 'Abuse contact', value: n.abuse, mono: true });
      fields.push({ label: 'Registry', value: n.registry ?? '', mono: true });
    }
    const parts = [
      !isPublic ? note(`${ip} is a ${kind} address, so it has no public owner or network.`, 'warn') : '',
      heading('Summary'),
      pairs(fields.map((field): [string, string | { html: string }] => [field.label, field.mono ? html(`<code>${esc(field.value)}</code>`) : field.value])),
      note('Location databases are not included: an address’s registry country is where its block was registered, not necessarily where it is used.'),
    ];
    return {
      fields,
      output: raw,
      filename: `${ip.replace(/:/g, '_')}-rdap.json`,
      language: 'json',
      preview: { kind: 'html', html: report(...parts) },
      info: host ? `Showing the first address of ${host}.` : undefined,
    };
  },
});
