/**
 * Domain registration data: RDAP first (structured JSON, the registries' modern
 * service), WHOIS as the fallback.  Also the RDAP bootstrap files that say which
 * server holds a TLD, an IP block or an AS number.
 */

import type { NetTransport } from '../../platform/net';
import { NetError } from '../../platform/net';
import { fromBase64, utf8Decode } from '../bytes';
import { parseAddress, parseCidr } from '../subnet';

/* ------------------------------------------------------------- bootstrap -- */

type Bootstrap = readonly (readonly [readonly string[], readonly string[]])[];

const BOOTSTRAP_URLS = {
  dns: 'https://data.iana.org/rdap/dns.json',
  ipv4: 'https://data.iana.org/rdap/ipv4.json',
  ipv6: 'https://data.iana.org/rdap/ipv6.json',
  asn: 'https://data.iana.org/rdap/asn.json',
} as const;

const bootstrapCache = new Map<string, Promise<Bootstrap>>();

export async function getJson(transport: NetTransport, url: string, accept = 'application/json'): Promise<{ status: number; json: unknown; text: string }> {
  const response = await transport.http({ url, headers: [['accept', accept]], timeoutMs: 20_000, maxBody: 4 * 1024 * 1024 });
  const text = utf8Decode(fromBase64(response.body));
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

function loadBootstrap(transport: NetTransport, kind: keyof typeof BOOTSTRAP_URLS): Promise<Bootstrap> {
  const cached = bootstrapCache.get(kind);
  if (cached) return cached;
  const promise = getJson(transport, BOOTSTRAP_URLS[kind]).then(({ status, json }) => {
    const services = (json as { services?: unknown } | null)?.services;
    if (status !== 200 || !Array.isArray(services)) throw new NetError('http', `The IANA RDAP directory could not be read (HTTP ${status}).`);
    return services as Bootstrap;
  });
  bootstrapCache.set(kind, promise);
  promise.catch(() => bootstrapCache.delete(kind));
  return promise;
}

const withSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`);
const preferHttps = (urls: readonly string[]): string | null => urls.find((url) => url.startsWith('https://')) ?? urls[0] ?? null;

/** The RDAP base URL for a domain's TLD (longest matching label wins), or null when the TLD has none. */
export async function rdapBaseForDomain(transport: NetTransport, domain: string): Promise<string | null> {
  const services = await loadBootstrap(transport, 'dns');
  const labels = domain.toLowerCase().replace(/\.$/, '').split('.');
  for (let i = 1; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    for (const [suffixes, urls] of services) if (suffixes.includes(suffix)) return withSlash(preferHttps(urls) ?? '');
  }
  return null;
}

export async function rdapBaseForIp(transport: NetTransport, ip: string): Promise<string | null> {
  const address = parseAddress(ip);
  const services = await loadBootstrap(transport, address.family === 4 ? 'ipv4' : 'ipv6');
  let best: { prefix: number; url: string } | null = null;
  for (const [prefixes, urls] of services) {
    for (const prefix of prefixes) {
      try {
        const network = parseCidr(prefix);
        if (network.family !== address.family) continue;
        if ((address.value & network.mask) === network.network && (best === null || network.prefix > best.prefix)) best = { prefix: network.prefix, url: preferHttps(urls) ?? '' };
      } catch {
        // skip malformed entries
      }
    }
  }
  return best ? withSlash(best.url) : null;
}

export async function rdapBaseForAsn(transport: NetTransport, asn: number): Promise<string | null> {
  const services = await loadBootstrap(transport, 'asn');
  for (const [ranges, urls] of services) {
    for (const range of ranges) {
      const [low, high] = range.split('-').map(Number);
      if (low !== undefined && asn >= low && asn <= (high ?? low)) return withSlash(preferHttps(urls) ?? '');
    }
  }
  return null;
}

/* ------------------------------------------------------------- RDAP data -- */

export interface Contact {
  readonly roles: readonly string[];
  readonly name?: string;
  readonly org?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly country?: string;
  readonly ianaId?: string;
}

export interface Registration {
  readonly source: 'rdap' | 'whois';
  readonly server: string;
  readonly domain: string;
  readonly registered: boolean;
  readonly registrar?: string;
  readonly registrarIanaId?: string;
  readonly registrarUrl?: string;
  readonly created?: Date;
  readonly updated?: Date;
  readonly expires?: Date;
  readonly statuses: readonly string[];
  readonly nameServers: readonly string[];
  readonly dnssec?: boolean;
  readonly contacts: readonly Contact[];
  readonly raw: string;
  /** Where the registrar's own (often more detailed) record lives. */
  readonly registrarServer?: string;
}

type Json = Record<string, unknown>;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

function vcardValue(vcard: unknown, property: string): string | undefined {
  const entries = asArray(asArray(vcard)[1]);
  for (const entry of entries) {
    const parts = asArray(entry);
    if (parts[0] !== property) continue;
    const value = parts[3];
    if (property === 'adr') {
      const country = asArray(value)[6];
      if (typeof country === 'string' && country !== '') return country;
      const label = (parts[1] as Json | undefined)?.label;
      return asString(label);
    }
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item !== '').join(' ') || undefined;
    return asString(value)
      ?.replace(/^tel:/, '')
      .replace(/^mailto:/, '');
  }
  return undefined;
}

function contacts(entities: unknown, out: Contact[] = []): Contact[] {
  for (const raw of asArray(entities)) {
    const entity = raw as Json;
    const vcard = entity.vcardArray;
    const ianaId = asArray(entity.publicIds)
      .map((item) => item as Json)
      .find((item) => String(item.type).toLowerCase().includes('iana'))?.identifier;
    out.push({
      roles: asArray(entity.roles).map(String),
      name: vcardValue(vcard, 'fn'),
      org: vcardValue(vcard, 'org'),
      email: vcardValue(vcard, 'email'),
      phone: vcardValue(vcard, 'tel'),
      country: vcardValue(vcard, 'adr'),
      ianaId: ianaId === undefined ? undefined : String(ianaId),
    });
    contacts(entity.entities, out);
  }
  return out;
}

const event = (events: unknown, ...actions: string[]): Date | undefined => {
  for (const raw of asArray(events)) {
    const item = raw as Json;
    if (actions.includes(String(item.eventAction).toLowerCase())) {
      const date = new Date(String(item.eventDate));
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return undefined;
};

/** Reads an RDAP domain object (RFC 9083). */
export function parseRdapDomain(json: unknown, server: string, raw: string): Registration {
  const data = (json ?? {}) as Json;
  const people = contacts(data.entities);
  const registrar = people.find((person) => person.roles.includes('registrar'));
  const related = asArray(data.links)
    .map((link) => link as Json)
    .find((link) => link.rel === 'related' && String(link.type ?? '').includes('rdap') && typeof link.href === 'string');
  const registrarUrl = asArray((asArray(data.entities).find((raw) => asArray((raw as Json).roles).includes('registrar')) as Json | undefined)?.links)
    .map((link) => link as Json)
    .find((link) => typeof link.href === 'string' && !String(link.href).includes('/rdap'))?.href;
  return {
    source: 'rdap',
    server,
    domain: asString(data.unicodeName) ?? asString(data.ldhName)?.toLowerCase() ?? '',
    registered: true,
    registrar: registrar?.name ?? registrar?.org,
    registrarIanaId: registrar?.ianaId,
    registrarUrl: typeof registrarUrl === 'string' ? registrarUrl : undefined,
    created: event(data.events, 'registration'),
    updated: event(data.events, 'last changed'),
    expires: event(data.events, 'expiration', 'registrar expiration'),
    statuses: asArray(data.status).map(String),
    nameServers: asArray(data.nameservers)
      .map((item) =>
        asString((item as Json).ldhName)
          ?.toLowerCase()
          .replace(/\.$/, ''),
      )
      .filter((name): name is string => name !== undefined),
    dnssec: typeof (data.secureDNS as Json | undefined)?.delegationSigned === 'boolean' ? Boolean((data.secureDNS as Json).delegationSigned) : undefined,
    contacts: people.filter((person) => !person.roles.includes('registrar') || person.email !== undefined),
    raw,
    registrarServer: typeof related?.href === 'string' ? related.href : undefined,
  };
}

/* ----------------------------------------------------------------- WHOIS -- */

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Dates as WHOIS servers write them: ISO 8601, 13-Aug-2025, 2025.08.13, 13.08.2025, 13/08/2025. */
export function parseWhoisDate(text: string): Date | undefined {
  const value = text.trim().replace(/\s*\(.*\)$/, '');
  let match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?)?/i.exec(value);
  if (match) {
    const [, y, m, d, hh = '0', mm = '0', ss = '0', zone] = match;
    let ms = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    if (zone && /^[+-]/.test(zone)) {
      const sign = zone.startsWith('-') ? -1 : 1;
      const digits = zone.replace(/[^0-9]/g, '');
      ms -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
    }
    return new Date(ms);
  }
  match = /^(\d{1,2})[-\s]([a-z]{3})[a-z]*[-\s](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i.exec(value);
  if (match) {
    const month = MONTHS[(match[2] as string).toLowerCase()];
    if (month !== undefined) return new Date(Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0)));
  }
  match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(value);
  if (match) return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

/** "Key: value" lines, keys lower-cased, every value kept (a key can repeat). */
export function whoisFields(text: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  let blockKey: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim() === '' || /^[%#>]/.test(line.trim())) {
      blockKey = null;
      continue;
    }
    const match = /^\s*([A-Za-z][A-Za-z0-9 /().'_-]{0,60}?)\s*(?:\.{2,})?\s*:\s*(.*)$/.exec(line);
    if (match && !/^https?$/i.test(match[1] as string)) {
      const key = (match[1] as string).toLowerCase().trim();
      const value = (match[2] as string).trim();
      if (value === '') {
        blockKey = key;
        continue;
      }
      blockKey = null;
      fields.set(key, [...(fields.get(key) ?? []), value]);
    } else if (blockKey !== null && /^\s+\S/.test(line)) {
      // Indented block lines, as in "Name servers:\n    ns1.example.org".
      fields.set(blockKey, [...(fields.get(blockKey) ?? []), line.trim()]);
    }
  }
  return fields;
}

const first = (fields: Map<string, string[]>, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = fields.get(key)?.find((item) => item.trim() !== '');
    if (value !== undefined) return value;
  }
  return undefined;
};

const all = (fields: Map<string, string[]>, ...keys: string[]): string[] => keys.flatMap((key) => fields.get(key) ?? []);

const NOT_FOUND = /no match for|not found|no data found|no entries found|status:\s*(free|available)|is available for|domain not registered|no object found|object does not exist|nothing found/i;

/** Reads the common fields out of a WHOIS answer.  Formats vary by registry; unknown ones give fewer fields. */
export function parseWhoisText(text: string, server: string, domain: string): Registration {
  const fields = whoisFields(text);
  const dateOf = (...keys: string[]) => {
    const value = first(fields, ...keys);
    return value === undefined ? undefined : parseWhoisDate(value);
  };
  const expires = dateOf(
    'registry expiry date',
    'registrar registration expiration date',
    'expiration date',
    'expiry date',
    'expires',
    'expires on',
    'expire date',
    'paid-till',
    'valid until',
    'renewal date',
    'registry expiration date',
    'domain expiration date',
    'expiration time',
  );
  const nameServers = [
    ...new Set(
      all(fields, 'name server', 'nserver', 'name servers', 'nameservers', 'nameserver', 'dns')
        .map((value) => value.split(/\s+/)[0]?.toLowerCase().replace(/\.$/, '') ?? '')
        .filter((value) => /^[a-z0-9.-]+\.[a-z0-9-]+$/i.test(value)),
    ),
  ];
  const statuses = [...new Set(all(fields, 'domain status', 'status', 'state').map((value) => value.split(/\s+https?:/)[0]?.trim() ?? value))];
  const dnssec = first(fields, 'dnssec');
  const registrar = first(fields, 'registrar', 'sponsoring registrar', 'registrar name', 'registrar organization');
  const registered = !NOT_FOUND.test(text) || expires !== undefined || nameServers.length > 0;
  return {
    source: 'whois',
    server,
    domain: (first(fields, 'domain name', 'domain') ?? domain).toLowerCase(),
    registered,
    registrar: registrar?.replace(/\s+https?:\/\/\S+$/, ''),
    registrarIanaId: first(fields, 'registrar iana id'),
    registrarUrl: first(fields, 'registrar url', 'referral url'),
    created: dateOf('creation date', 'created', 'created on', 'registered on', 'registration date', 'registration time', 'domain registration date', 'registered'),
    updated: dateOf('updated date', 'last updated', 'last-modified', 'changed', 'last modified', 'updated on'),
    expires,
    statuses,
    nameServers,
    dnssec: dnssec === undefined ? undefined : /^(signed|yes|active)/i.test(dnssec) && !/unsigned/i.test(dnssec),
    contacts: [],
    raw: text,
    registrarServer: first(fields, 'registrar whois server', 'whois server')?.replace(/^whois:\/\//, ''),
  };
}

/** The WHOIS server IANA lists for a TLD ("refer:" in its answer). */
export function referralServer(ianaAnswer: string): string | undefined {
  const fields = whoisFields(ianaAnswer);
  return first(fields, 'refer', 'whois');
}

/** Some registries need a special query to return the full record. */
export function whoisQuery(server: string, domain: string): string {
  if (server === 'whois.verisign-grs.com') return `domain ${domain}`;
  if (server === 'whois.denic.de') return `-T dn,ace ${domain}`;
  if (server === 'whois.jprs.jp') return `${domain}/e`;
  return domain;
}

/* --------------------------------------------------------- status labels -- */

const STATUS_MEANINGS: Record<string, string> = {
  ok: 'No restrictions: the domain is active.',
  active: 'Active; no restrictions.',
  inactive: 'Has no name servers, so it does not resolve.',
  'add period': 'Recently registered; the registrar can still cancel it for a refund.',
  'auto renew period': 'Just renewed automatically; the renewal can still be cancelled.',
  'renew period': 'Recently renewed.',
  'transfer period': 'Recently transferred to a new registrar.',
  'redemption period': 'Expired and deleted by the registrar; the owner can still restore it (for a fee).',
  'pending delete': 'Will be released in a few days and can then be registered by anyone.',
  'pending transfer': 'A transfer to another registrar is under way.',
  'pending update': 'An update is waiting to be processed.',
  'pending renew': 'A renewal is waiting to be processed.',
  'pending restore': 'A restore from redemption is being processed.',
  'pending create': 'A registration is being processed.',
  'client hold': 'Suspended by the registrar: the domain does not resolve.',
  'server hold': 'Suspended by the registry: the domain does not resolve.',
  'client transfer prohibited': 'Locked against transfers by the registrar (normal protection).',
  'server transfer prohibited': 'Locked against transfers by the registry.',
  'client update prohibited': 'Changes are locked by the registrar.',
  'server update prohibited': 'Changes are locked by the registry.',
  'client delete prohibited': 'Deletion is locked by the registrar.',
  'server delete prohibited': 'Deletion is locked by the registry.',
  'client renew prohibited': 'Renewal is blocked by the registrar (often during a dispute).',
  'server renew prohibited': 'Renewal is blocked by the registry.',
  associated: 'Linked to other registry objects.',
  locked: 'Locked against changes.',
};

/** "clientTransferProhibited https://icann.org/epp#…" or "client transfer prohibited" → "client transfer prohibited". */
export const normalizeStatus = (status: string): string =>
  (status.split(/\s+https?:/)[0] ?? status)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase()
    .trim();

export const statusMeaning = (status: string): string | undefined => STATUS_MEANINGS[normalizeStatus(status)];

export const statusTone = (status: string): 'ok' | 'warn' | 'bad' | 'muted' => {
  const normal = normalizeStatus(status);
  if (/hold|redemption|pending delete|renew prohibited/.test(normal)) return 'bad';
  if (/pending|inactive/.test(normal)) return 'warn';
  if (normal === 'ok' || normal === 'active') return 'ok';
  return 'muted';
};

/** The registrable domain for typical input: strips "www." and subdomains of well-known two-level suffixes. */
export function registrableDomain(name: string): string {
  const labels = name.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const secondLevel = new Set([
    'co',
    'com',
    'net',
    'org',
    'gov',
    'ac',
    'edu',
    'res',
    'nic',
    'gen',
    'firm',
    'ind',
    'mil',
    'or',
    'ne',
    'go',
    'ltd',
    'plc',
    'me',
    'sch',
    'nhs',
    'police',
    'govt',
    'nom',
    'info',
    'biz',
  ]);
  const tail = labels.slice(-2);
  const keep = secondLevel.has(tail[0] as string) && (tail[1] as string).length === 2 ? 3 : 2;
  return labels.slice(-keep).join('.');
}
