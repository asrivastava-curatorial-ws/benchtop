/**
 * DNS helpers for the online checks: public resolvers, record types, reverse
 * names, TXT strings and dig-style output.  No network access here.
 */

import type { DnsRecord, DnsResponse } from '../../platform/net';
import { parseIPv4, parseIPv6 } from '../subnet';

export type Continent = 'North America' | 'South America' | 'Europe' | 'Africa' | 'Asia' | 'Oceania';

export interface Resolver {
  readonly id: string;
  readonly provider: string;
  readonly address: string;
  readonly city: string;
  readonly country: string;
  readonly continent: Continent;
  readonly lat: number;
  readonly lon: number;
  /** Answers from the site nearest to you, wherever that is. */
  readonly anycast?: boolean;
}

/** Open resolvers around the world for propagation checks.  Locations are approximate. */
export const PROPAGATION_RESOLVERS: readonly Resolver[] = [
  { id: 'opendns-sf', provider: 'OpenDNS', address: '208.67.222.220', city: 'San Francisco', country: 'United States', continent: 'North America', lat: 37.77, lon: -122.42 },
  { id: 'google', provider: 'Google', address: '8.8.8.8', city: 'Mountain View', country: 'United States', continent: 'North America', lat: 37.39, lon: -122.08, anycast: true },
  { id: 'quad9', provider: 'Quad9', address: '9.9.9.9', city: 'Berkeley', country: 'United States', continent: 'North America', lat: 37.87, lon: -122.27, anycast: true },
  { id: 'he', provider: 'Hurricane Electric', address: '74.82.42.42', city: 'Fremont', country: 'United States', continent: 'North America', lat: 37.55, lon: -121.99, anycast: true },
  { id: 'level3', provider: 'Level 3 (Lumen)', address: '4.2.2.1', city: 'Broomfield', country: 'United States', continent: 'North America', lat: 39.92, lon: -105.09 },
  { id: 'akamai', provider: 'Akamai', address: '88.221.162.157', city: 'Cambridge', country: 'United States', continent: 'North America', lat: 42.37, lon: -71.11 },
  { id: 'cisco-van', provider: 'Cisco OpenDNS', address: '146.112.41.2', city: 'Vancouver', country: 'Canada', continent: 'North America', lat: 49.28, lon: -123.12 },
  { id: 'fortiguard', provider: 'FortiGuard', address: '96.45.46.46', city: 'Vancouver', country: 'Canada', continent: 'North America', lat: 49.25, lon: -123.0 },
  { id: 'controld', provider: 'Control D', address: '76.76.2.0', city: 'Toronto', country: 'Canada', continent: 'North America', lat: 43.65, lon: -79.38, anycast: true },
  { id: 'cira', provider: 'CIRA Canadian Shield', address: '149.112.121.10', city: 'Ottawa', country: 'Canada', continent: 'North America', lat: 45.42, lon: -75.69 },
  { id: 'ula-mx', provider: 'Universidad Latinoamericana', address: '200.33.3.123', city: 'Mexico City', country: 'Mexico', continent: 'North America', lat: 19.43, lon: -99.13 },
  { id: 'oracle-br', provider: 'Oracle Dyn', address: '216.146.36.36', city: 'São Paulo', country: 'Brazil', continent: 'South America', lat: -23.55, lon: -46.63 },
  { id: 'virgin-uk', provider: 'Virgin Media', address: '194.168.4.123', city: 'Bristol', country: 'United Kingdom', continent: 'Europe', lat: 51.45, lon: -2.59 },
  { id: 'cleanbrowsing', provider: 'CleanBrowsing', address: '185.228.168.9', city: 'Dublin', country: 'Ireland', continent: 'Europe', lat: 53.35, lon: -6.26 },
  { id: 'nos-pt', provider: 'NOS', address: '195.23.236.90', city: 'Setúbal', country: 'Portugal', continent: 'Europe', lat: 38.52, lon: -8.89 },
  { id: 'dinahosting', provider: 'Dinahosting', address: '82.98.169.6', city: 'Madrid', country: 'Spain', continent: 'Europe', lat: 40.42, lon: -3.7 },
  { id: 'arn-fr', provider: 'Alsace Réseau Neutre', address: '89.234.141.66', city: 'Strasbourg', country: 'France', continent: 'Europe', lat: 48.58, lon: 7.75 },
  { id: 'fns-nl', provider: 'F.N.S. Holdings', address: '85.203.37.2', city: 'Heiloo', country: 'Netherlands', continent: 'Europe', lat: 52.6, lon: 4.7 },
  { id: 'northc-de', provider: 'NorthC', address: '62.146.202.2', city: 'Nuremberg', country: 'Germany', continent: 'Europe', lat: 49.45, lon: 11.08 },
  { id: 'dnssb', provider: 'DNS.SB', address: '185.222.222.222', city: 'Frankfurt', country: 'Germany', continent: 'Europe', lat: 50.11, lon: 8.68, anycast: true },
  { id: 'fenaco-ch', provider: 'fenaco', address: '195.245.237.35', city: 'Zürich', country: 'Switzerland', continent: 'Europe', lat: 47.37, lon: 8.54 },
  { id: 'nemox-at', provider: 'nemox.net', address: '83.137.41.9', city: 'Innsbruck', country: 'Austria', continent: 'Europe', lat: 47.27, lon: 11.39 },
  { id: 'tdc-dk', provider: 'TDC', address: '87.49.54.222', city: 'Helsinge', country: 'Denmark', continent: 'Europe', lat: 56.02, lon: 12.2 },
  { id: 'yandex', provider: 'Yandex', address: '77.88.8.8', city: 'Moscow', country: 'Russia', continent: 'Europe', lat: 55.75, lon: 37.62 },
  { id: 'skydns-ru', provider: 'SkyDNS', address: '195.46.39.39', city: 'Yekaterinburg', country: 'Russia', continent: 'Europe', lat: 56.84, lon: 60.6 },
  { id: 'teknet-tr', provider: 'Teknet', address: '31.7.37.37', city: 'Antalya', country: 'Türkiye', continent: 'Asia', lat: 36.9, lon: 30.7 },
  { id: 'adguard', provider: 'AdGuard', address: '94.140.14.14', city: 'Limassol', country: 'Cyprus', continent: 'Europe', lat: 34.68, lon: 33.04, anycast: true },
  { id: 'liquid-za', provider: 'Liquid Telecom', address: '5.11.11.5', city: 'Cullinan', country: 'South Africa', continent: 'Africa', lat: -25.67, lon: 28.52 },
  { id: 'connect-pk', provider: 'Connect Communications', address: '118.103.239.9', city: 'Karachi', country: 'Pakistan', continent: 'Asia', lat: 24.86, lon: 67.0 },
  { id: 'skylink-in', provider: 'Skylink Fibernet', address: '103.99.150.10', city: 'Coimbatore', country: 'India', continent: 'Asia', lat: 11.02, lon: 76.96 },
  { id: 'kaharole-bd', provider: 'Local ISP', address: '103.157.237.34', city: 'Kaharole', country: 'Bangladesh', continent: 'Asia', lat: 25.8, lon: 88.6 },
  { id: 'bigband-my', provider: 'Bigband', address: '103.26.170.103', city: 'Port Dickson', country: 'Malaysia', continent: 'Asia', lat: 2.52, lon: 101.8 },
  { id: 'do-sg', provider: 'DigitalOcean', address: '139.59.219.245', city: 'Singapore', country: 'Singapore', continent: 'Asia', lat: 1.35, lon: 103.82 },
  { id: 'baidu', provider: 'Baidu', address: '180.76.76.76', city: 'Beijing', country: 'China', continent: 'Asia', lat: 39.9, lon: 116.4 },
  { id: 'alidns', provider: 'AliDNS', address: '223.5.5.5', city: 'Hangzhou', country: 'China', continent: 'Asia', lat: 30.27, lon: 120.16, anycast: true },
  { id: 'dnspod', provider: 'DNSPod (Tencent)', address: '119.29.29.29', city: 'Shenzhen', country: 'China', continent: 'Asia', lat: 22.54, lon: 114.06 },
  { id: 'kt-kr', provider: 'KT', address: '168.126.63.1', city: 'Seoul', country: 'South Korea', continent: 'Asia', lat: 37.57, lon: 126.98 },
  { id: 'cloudflare', provider: 'Cloudflare', address: '1.1.1.1', city: 'Research', country: 'Australia', continent: 'Oceania', lat: -37.7, lon: 145.1, anycast: true },
  { id: 'pacific-au', provider: 'Pacific Internet', address: '61.8.0.113', city: 'Melbourne', country: 'Australia', continent: 'Oceania', lat: -37.81, lon: 144.96 },
  { id: 'voyager-nz', provider: 'Voyager', address: '49.50.244.107', city: 'Auckland', country: 'New Zealand', continent: 'Oceania', lat: -36.85, lon: 174.76 },
];

export const CONTINENTS: readonly Continent[] = ['North America', 'South America', 'Europe', 'Africa', 'Asia', 'Oceania'];

/** Resolvers offered by the DNS Lookup tool. */
export const LOOKUP_SERVERS = [
  { value: 'system', label: 'This computer’s resolver', server: 'system' },
  { value: 'google', label: 'Google (8.8.8.8)', server: '8.8.8.8' },
  { value: 'cloudflare', label: 'Cloudflare (1.1.1.1)', server: '1.1.1.1' },
  { value: 'quad9', label: 'Quad9 (9.9.9.9)', server: '9.9.9.9' },
  { value: 'opendns', label: 'OpenDNS (208.67.222.222)', server: '208.67.222.222' },
  { value: 'adguard', label: 'AdGuard (94.140.14.14, filters ads)', server: '94.140.14.14' },
  { value: 'controld', label: 'Control D (76.76.2.0)', server: '76.76.2.0' },
  { value: 'doh-cloudflare', label: 'Cloudflare over HTTPS', server: 'https://cloudflare-dns.com/dns-query' },
  { value: 'doh-google', label: 'Google over HTTPS', server: 'https://dns.google/dns-query' },
  { value: 'doh-quad9', label: 'Quad9 over HTTPS', server: 'https://dns.quad9.net/dns-query' },
  { value: 'custom', label: 'Another server…', server: '' },
] as const;

export const RECORD_TYPES: readonly { readonly type: string; readonly about: string }[] = [
  { type: 'A', about: 'IPv4 address' },
  { type: 'AAAA', about: 'IPv6 address' },
  { type: 'CNAME', about: 'Alias for another name' },
  { type: 'MX', about: 'Mail servers, by priority' },
  { type: 'NS', about: 'Authoritative name servers' },
  { type: 'TXT', about: 'Text (SPF, verification tokens…)' },
  { type: 'SOA', about: 'Start of authority (zone serial and timers)' },
  { type: 'SRV', about: 'Service location (_service._proto.name)' },
  { type: 'CAA', about: 'Which CAs may issue certificates' },
  { type: 'PTR', about: 'Reverse lookup (name for an IP address)' },
  { type: 'HTTPS', about: 'HTTPS service binding (ALPN, hints)' },
  { type: 'SVCB', about: 'General service binding' },
  { type: 'DS', about: 'DNSSEC delegation signer (in the parent zone)' },
  { type: 'DNSKEY', about: 'DNSSEC public keys' },
  { type: 'NAPTR', about: 'Naming authority pointer' },
  { type: 'TLSA', about: 'DANE certificate association (_443._tcp.name)' },
  { type: 'SSHFP', about: 'SSH host key fingerprints' },
];

/** Asked one by one by "All common types" (ANY queries are refused by most servers, RFC 8482). */
export const COMMON_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA', 'HTTPS', 'DS', 'DNSKEY'] as const;

const RCODES: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
  6: 'YXDOMAIN',
  7: 'YXRRSET',
  8: 'NXRRSET',
  9: 'NOTAUTH',
  10: 'NOTZONE',
  16: 'BADVERS',
};

export const rcodeName = (code: number): string => RCODES[code] ?? `RCODE${code}`;

/** What a response code means, in plain words. */
export function rcodeMeaning(code: number): string {
  switch (code) {
    case 0:
      return 'The query succeeded.';
    case 2:
      return 'The server could not answer (often a broken delegation or a DNSSEC validation failure).';
    case 3:
      return 'The name does not exist.';
    case 5:
      return 'The server refused to answer this query.';
    default:
      return rcodeName(code);
  }
}

/** Reverse-lookup name for an IP address, or null when the text is not one. */
export function reverseName(text: string): string | null {
  const trimmed = text.trim();
  const v4 = parseIPv4(trimmed);
  if (v4 !== null) return `${[0, 8, 16, 24].map((shift) => Number((v4 >> BigInt(shift)) & 255n)).join('.')}.in-addr.arpa.`;
  const v6 = parseIPv6(trimmed);
  if (v6 !== null) return `${v6.toString(16).padStart(32, '0').split('').reverse().join('.')}.ip6.arpa.`;
  return null;
}

export const isIpAddress = (text: string): boolean => parseIPv4(text.trim()) !== null || parseIPv6(text.trim()) !== null;

/** Cleans a typed name: drops a scheme, path, port and spaces; converts to ASCII where possible. */
export function cleanName(text: string): string {
  let name = text.trim();
  name = name.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  name = name.replace(/[/?#].*$/, '');
  if (!name.startsWith('[')) name = name.replace(/:\d+$/, '');
  name = name.replace(/^\[|\]$/g, '');
  if (name === '') return '';
  try {
    // The URL parser applies IDNA (Punycode) to international names.
    if (!isIpAddress(name)) return new URL(`http://${name}`).hostname;
  } catch {
    // Leave it as typed; the DNS layer reports the problem.
  }
  return name.toLowerCase();
}

/** The text of a TXT record shown as quoted strings: the strings joined without spaces (RFC 7208). */
export function txtValue(data: string): string {
  const parts: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"/g;
  for (const match of data.matchAll(pattern)) parts.push((match[1] as string).replace(/\\(.)/g, '$1'));
  return parts.length > 0 ? parts.join('') : data;
}

/** The value to compare in propagation checks: TXT text, a lower-case name without the final dot, or the data. */
export function recordValue(record: DnsRecord): string {
  if (record.recordType === 'TXT') return txtValue(record.data);
  if (['CNAME', 'NS', 'PTR'].includes(record.recordType)) return record.data.replace(/\.$/, '').toLowerCase();
  if (record.recordType === 'MX') return record.data.replace(/\.$/, '').toLowerCase();
  return record.data;
}

export type MatchMode = 'exact' | 'contains' | 'regex';

/** Whether any of `values` matches `expected`.  Comparison ignores case and a final dot. */
export function matchesExpected(values: readonly string[], expected: string, mode: MatchMode): boolean {
  const want = expected.trim().replace(/\.$/, '').toLowerCase();
  if (want === '') return true;
  if (mode === 'regex') {
    let pattern: RegExp;
    try {
      pattern = new RegExp(expected.trim(), 'i');
    } catch {
      return false;
    }
    return values.some((value) => pattern.test(value));
  }
  return values.some((value) => {
    const have = value.replace(/\.$/, '').toLowerCase();
    return mode === 'exact' ? have === want : have.includes(want);
  });
}

const flagList = (response: DnsResponse): string =>
  ['qr', response.flags.aa && 'aa', response.flags.tc && 'tc', response.flags.rd && 'rd', response.flags.ra && 'ra', response.flags.ad && 'ad', response.flags.cd && 'cd'].filter(Boolean).join(' ');

function section(title: string, records: readonly DnsRecord[]): string {
  if (records.length === 0) return '';
  const width = Math.min(48, Math.max(...records.map((record) => record.name.length)) + 1);
  const rows = records.map((record) => `${record.name.padEnd(width)} ${String(record.ttl).padStart(6)}  ${record.class}  ${record.recordType.padEnd(6)} ${record.data}`);
  return `\n;; ${title} SECTION:\n${rows.join('\n')}\n`;
}

/** The response as dig prints it, so it can be compared with dig output or pasted into a ticket. */
export function formatDig(name: string, type: string, response: DnsResponse): string {
  const fqdn = name.endsWith('.') ? name : `${name}.`;
  return [
    `; <<>> Benchtop DNS lookup <<>> ${fqdn} ${type} @${response.server}`,
    `;; ->>HEADER<<- opcode: QUERY, status: ${rcodeName(response.rcode)}`,
    `;; flags: ${flagList(response)}; QUERY: 1, ANSWER: ${response.answers.length}, AUTHORITY: ${response.authority.length}, ADDITIONAL: ${response.additional.length}`,
    '',
    ';; QUESTION SECTION:',
    `;${fqdn}\t\tIN\t${type}`,
    section('ANSWER', response.answers) + section('AUTHORITY', response.authority) + section('ADDITIONAL', response.additional),
    `;; Query time: ${Math.round(response.elapsedMs)} msec`,
    `;; SERVER: ${response.server} (${response.transport.toUpperCase()})`,
    `;; MSG SIZE  rcvd: ${response.size}`,
  ].join('\n');
}

/** "1 h 30 min" for a TTL in seconds. */
export function formatTtl(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const parts: string[] = [];
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) parts.push(`${days} d`);
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes} min`);
  return parts.join(' ') || `${seconds} s`;
}
