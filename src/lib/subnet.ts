/** IPv4 and IPv6 address and CIDR arithmetic, using BigInt so both families share one code path. */
import { ToolError } from './errors';

export type Family = 4 | 6;

export interface Address {
  readonly family: Family;
  readonly value: bigint;
}

const BITS: Record<Family, number> = { 4: 32, 6: 128 };

export function parseIPv4(text: string): bigint | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

export function parseIPv6(input: string): bigint | null {
  let text = input.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  // An embedded IPv4 address in the last 32 bits, such as ::ffff:192.0.2.1.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  let tail: bigint | null = null;
  if (v4) {
    tail = parseIPv4(v4[1] as string);
    if (tail === null) return null;
    text = `${text.slice(0, v4.index)}${((tail >> 16n) & 0xffffn).toString(16)}:${(tail & 0xffffn).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : (halves[0] as string).split(':');
  const rest = halves.length === 2 ? (halves[1] === '' ? [] : (halves[1] as string).split(':')) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'), ...rest];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(`0x${group}`);
  }
  return value;
}

export function parseAddress(text: string): Address {
  const trimmed = text.trim().replace(/^\[|\]$/g, '');
  const v4 = parseIPv4(trimmed);
  if (v4 !== null) return { family: 4, value: v4 };
  const v6 = parseIPv6(trimmed);
  if (v6 !== null) return { family: 6, value: v6 };
  throw new ToolError(`"${text.trim()}" is not an IPv4 or IPv6 address.`);
}

export function formatIPv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join('.');
}

/** RFC 5952 canonical text: lower case, no leading zeros, longest zero run (2+ groups) as "::". */
export function formatIPv6(value: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) => Number((value >> BigInt(112 - i * 16)) & 0xffffn));
  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestStart < 0) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

export const formatAddress = (family: Family, value: bigint): string => (family === 4 ? formatIPv4(value) : formatIPv6(value));

export function fullIPv6(value: bigint): string {
  return Array.from({ length: 8 }, (_, i) => ((value >> BigInt(112 - i * 16)) & 0xffffn).toString(16).padStart(4, '0')).join(':');
}

export interface Network {
  readonly family: Family;
  readonly prefix: number;
  readonly address: bigint;
  readonly network: bigint;
  readonly last: bigint;
  readonly mask: bigint;
  readonly size: bigint;
}

const maskOf = (family: Family, prefix: number): bigint => {
  const bits = BigInt(BITS[family]);
  return prefix === 0 ? 0n : ((1n << bits) - 1n) ^ ((1n << (bits - BigInt(prefix))) - 1n);
};

/** Parses "address/prefix", "address netmask" or a bare address (a single host). */
export function parseCidr(text: string): Network {
  const trimmed = text.trim();
  if (trimmed === '') throw new ToolError('Enter an address such as 192.168.1.10/24 or 2001:db8::/48.');
  const [addressText, prefixText] = trimmed.includes('/') ? (trimmed.split('/', 2) as [string, string]) : (trimmed.split(/\s+/, 2) as [string, string | undefined]);
  const address = parseAddress(addressText);
  const bits = BITS[address.family];
  let prefix = bits;
  if (prefixText !== undefined && prefixText !== '') {
    if (/^\d+$/.test(prefixText)) {
      prefix = Number(prefixText);
      if (prefix > bits) throw new ToolError(`An IPv${address.family} prefix must be between 0 and ${bits}.`);
    } else if (address.family === 4) {
      const mask = parseIPv4(prefixText);
      if (mask === null) throw new ToolError(`"${prefixText}" is not a prefix length or a netmask.`);
      prefix = mask.toString(2).replace(/^0+/, '').padStart(32, '0').indexOf('0');
      if (prefix < 0) prefix = 32;
      if (maskOf(4, prefix) !== mask) throw new ToolError(`${prefixText} is not a valid netmask: its one bits must be contiguous.`);
    } else {
      throw new ToolError('Give IPv6 prefixes as a number, such as /64.');
    }
  }
  const mask = maskOf(address.family, prefix);
  const all = (1n << BigInt(bits)) - 1n;
  const network = address.value & mask;
  return { family: address.family, prefix, address: address.value, network, last: network | (all ^ mask), mask, size: 1n << BigInt(bits - prefix) };
}

/** Usable host range: IPv4 excludes the network and broadcast addresses except for /31 and /32 (RFC 3021). */
export function hostRange(net: Network): { first: bigint; last: bigint; count: bigint } {
  if (net.family === 4 && net.prefix < 31) return { first: net.network + 1n, last: net.last - 1n, count: net.size - 2n };
  return { first: net.network, last: net.last, count: net.size };
}

/** Splits a network into equal subnets with a longer prefix. */
export function subdivide(net: Network, newPrefix: number, limit = 256): { subnets: bigint[]; total: bigint } {
  const bits = BITS[net.family];
  if (newPrefix < net.prefix || newPrefix > bits) throw new ToolError(`Choose a prefix between /${net.prefix} and /${bits}.`);
  const total = 1n << BigInt(newPrefix - net.prefix);
  const step = 1n << BigInt(bits - newPrefix);
  const subnets: bigint[] = [];
  for (let i = 0n; i < total && i < BigInt(limit); i++) subnets.push(net.network + i * step);
  return { subnets, total };
}

const IPV4_RANGES: [string, string][] = [
  ['0.0.0.0/8', 'This network (RFC 791)'],
  ['10.0.0.0/8', 'Private (RFC 1918)'],
  ['100.64.0.0/10', 'Shared address space, carrier-grade NAT (RFC 6598)'],
  ['127.0.0.0/8', 'Loopback'],
  ['169.254.0.0/16', 'Link-local'],
  ['172.16.0.0/12', 'Private (RFC 1918)'],
  ['192.0.0.0/24', 'IETF protocol assignments'],
  ['192.0.2.0/24', 'Documentation (TEST-NET-1)'],
  ['192.88.99.0/24', 'Deprecated 6to4 relay anycast'],
  ['192.168.0.0/16', 'Private (RFC 1918)'],
  ['198.18.0.0/15', 'Benchmarking (RFC 2544)'],
  ['198.51.100.0/24', 'Documentation (TEST-NET-2)'],
  ['203.0.113.0/24', 'Documentation (TEST-NET-3)'],
  ['224.0.0.0/4', 'Multicast'],
  ['240.0.0.0/4', 'Reserved'],
  ['255.255.255.255/32', 'Limited broadcast'],
];

const IPV6_RANGES: [string, string][] = [
  ['::/128', 'Unspecified'],
  ['::1/128', 'Loopback'],
  ['::ffff:0:0/96', 'IPv4-mapped'],
  ['64:ff9b::/96', 'IPv4/IPv6 translation (RFC 6052)'],
  ['100::/64', 'Discard prefix'],
  ['2001::/32', 'Teredo'],
  ['2001:db8::/32', 'Documentation'],
  ['2002::/16', '6to4'],
  ['fc00::/7', 'Unique local (private)'],
  ['fe80::/10', 'Link-local'],
  ['ff00::/8', 'Multicast'],
  ['2000::/3', 'Global unicast'],
];

/** The special-purpose range an address belongs to, if any; otherwise public (IPv4). */
export function classify(family: Family, value: bigint): string {
  for (const [cidr, label] of family === 4 ? IPV4_RANGES : IPV6_RANGES) {
    const range = parseCidr(cidr);
    if ((value & range.mask) === range.network) return label;
  }
  return family === 4 ? 'Public' : 'Reserved by the IETF';
}
