/** Networking: packet headers, HTTP, IP addresses and ranges, URIs, MAC addresses, defanging, fingerprints. */
import { type Address, classify, formatAddress, formatIPv4, fullIPv6, hostRange, parseAddress, parseCidr } from '../../lib/subnet';
import { bArg, bool, bytesToLatin1, cjs, defineOp, hex, hexToBytes, nArg, num, OpError, type Operation, sArg, sel, toBytes } from '../core';
import { base64Decode } from './data-format';

const C = 'Networking' as const;

const u16 = (b: Uint8Array, i: number) => (((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)) >>> 0;
const u32 = (b: Uint8Array, i: number) => (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0;

function packet(input: string, format: string): Uint8Array {
  if (format === 'Hex') return hexToBytes(input);
  if (format === 'Base64') return base64Decode(input, 'A-Za-z0-9+/=');
  return toBytes(input);
}

function table(rows: [string, string][]): string {
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${k.padEnd(width)}  ${v}`).join('\n');
}

function ipv4Header(b: Uint8Array) {
  if (b.length < 20 || b[0] === undefined || b[0] >> 4 !== 4) throw new OpError('This is not an IPv4 header.');
  const ihl = (b[0] & 15) * 4;
  const flags = (b[6] ?? 0) >> 5;
  return {
    ihl,
    rows: [
      ['Version', '4'],
      ['Header length', `${ihl} bytes`],
      ['DSCP', String((b[1] ?? 0) >> 2)],
      ['ECN', String((b[1] ?? 0) & 3)],
      ['Total length', String(u16(b, 2))],
      ['Identification', `0x${u16(b, 4).toString(16).padStart(4, '0')} (${u16(b, 4)})`],
      ['Flags', `${flags & 2 ? "Don't fragment " : ''}${flags & 1 ? 'More fragments' : ''}`.trim() || 'none'],
      ['Fragment offset', String(u16(b, 6) & 0x1fff)],
      ['TTL', String(b[8])],
      ['Protocol', `${b[9]} (${({ 1: 'ICMP', 6: 'TCP', 17: 'UDP', 41: 'IPv6', 47: 'GRE', 50: 'ESP', 58: 'ICMPv6' } as Record<number, string>)[b[9] ?? 0] ?? 'other'})`],
      ['Header checksum', `0x${u16(b, 10).toString(16).padStart(4, '0')}`],
      ['Source IP', formatIPv4(BigInt(u32(b, 12)))],
      ['Destination IP', formatIPv4(BigInt(u32(b, 16)))],
    ] as [string, string][],
  };
}

const TCP_FLAGS = ['FIN', 'SYN', 'RST', 'PSH', 'ACK', 'URG', 'ECE', 'CWR'];

function tcpHeader(b: Uint8Array) {
  if (b.length < 20) throw new OpError('A TCP header is at least 20 bytes.');
  const offset = ((b[12] ?? 0) >> 4) * 4;
  const flags = b[13] ?? 0;
  return {
    offset,
    info: {
      'Source port': u16(b, 0),
      'Destination port': u16(b, 2),
      'Sequence number': u32(b, 4),
      'Acknowledgement number': u32(b, 8),
      'Data offset': offset,
      Flags: TCP_FLAGS.filter((_, i) => flags & (1 << i)),
      'Window size': u16(b, 14),
      Checksum: `0x${u16(b, 16).toString(16).padStart(4, '0')}`,
      'Urgent pointer': u16(b, 18),
      Options: hex(b.slice(20, offset)),
      Data: hex(b.slice(offset)),
    },
  };
}

const TLS_TYPES: Record<number, string> = { 20: 'Change cipher spec', 21: 'Alert', 22: 'Handshake', 23: 'Application data', 24: 'Heartbeat' };
const HANDSHAKE: Record<number, string> = {
  0: 'Hello request',
  1: 'Client hello',
  2: 'Server hello',
  4: 'New session ticket',
  8: 'Encrypted extensions',
  11: 'Certificate',
  12: 'Server key exchange',
  13: 'Certificate request',
  14: 'Server hello done',
  15: 'Certificate verify',
  16: 'Client key exchange',
  20: 'Finished',
};
const versionName = (v: number) => ({ 768: 'SSL 3.0', 769: 'TLS 1.0', 770: 'TLS 1.1', 771: 'TLS 1.2', 772: 'TLS 1.3' })[v] ?? `0x${v.toString(16)}`;

/** GREASE values (RFC 8701) are ignored by JA3. */
const isGrease = (v: number) => (v & 0x0f0f) === 0x0a0a && v >> 8 === (v & 255);

interface Hello {
  version: number;
  ciphers: number[];
  extensions: number[];
  curves: number[];
  formats: number[];
}

function parseHello(data: Uint8Array, wanted: 1 | 2): Hello {
  let at = 0;
  if (data[0] === 22) at = 5;
  if (data[at] !== wanted) throw new OpError(`This is not a TLS ${wanted === 1 ? 'Client' : 'Server'} Hello.`);
  at += 4;
  const version = u16(data, at);
  at += 2 + 32;
  const sessionLength = data[at] ?? 0;
  at += 1 + sessionLength;
  const ciphers: number[] = [];
  if (wanted === 1) {
    const cipherLength = u16(data, at);
    at += 2;
    for (let i = 0; i < cipherLength; i += 2) ciphers.push(u16(data, at + i));
    at += cipherLength;
    at += 1 + (data[at] ?? 0);
  } else {
    ciphers.push(u16(data, at));
    at += 3;
  }
  const extensions: number[] = [];
  const curves: number[] = [];
  const formats: number[] = [];
  if (at + 2 <= data.length) {
    const end = at + 2 + u16(data, at);
    at += 2;
    while (at + 4 <= end && at + 4 <= data.length) {
      const type = u16(data, at);
      const length = u16(data, at + 2);
      const body = data.slice(at + 4, at + 4 + length);
      extensions.push(type);
      if (type === 10) for (let i = 2; i + 1 < body.length; i += 2) curves.push(u16(body, i));
      if (type === 11) for (let i = 1; i < body.length; i++) formats.push(body[i] as number);
      at += 4 + length;
    }
  }
  return { version, ciphers, extensions, curves, formats };
}

async function md5Hex(text: string): Promise<string> {
  const { md5 } = await import('@noble/hashes/legacy.js');
  return hex(md5(new TextEncoder().encode(text)));
}

function sshKexInit(data: Uint8Array): string[] {
  let at = 0;
  // Skip the SSH packet header (length, padding length, message code 20) when present.
  if (data[5] === 20) at = 6;
  else if (data[0] === 20) at = 1;
  else throw new OpError('This is not an SSH key-exchange-init message.');
  at += 16;
  const lists: string[] = [];
  for (let i = 0; i < 10; i++) {
    const length = u32(data, at);
    lists.push(new TextDecoder().decode(data.slice(at + 4, at + 4 + length)));
    at += 4 + length;
  }
  return lists;
}

function fingerprintOp(name: string, kind: 'ja3' | 'ja3s' | 'hassh' | 'hasshServer', stringLabel: string): Operation {
  return defineOp({
    name,
    category: C,
    description:
      kind === 'ja3'
        ? 'Fingerprints a TLS client from its Client Hello (JA3).'
        : kind === 'ja3s'
          ? 'Fingerprints a TLS server from its Server Hello (JA3S).'
          : `Fingerprints an SSH ${kind === 'hassh' ? 'client' : 'server'} from its key exchange init message (HASSH).`,
    input: 'text',
    output: 'text',
    args: [sel('format', 'Input format', ['Hex', 'Base64', 'Raw']), sel('output', 'Output format', ['Hash digest', stringLabel, 'Full details'])],
    run: async (input, a) => {
      const data = packet(input, sArg(a, 'format'));
      let text: string;
      if (kind === 'ja3' || kind === 'ja3s') {
        const hello = parseHello(data, kind === 'ja3' ? 1 : 2);
        const clean = (list: number[]) => list.filter((v) => !isGrease(v)).join('-');
        text =
          kind === 'ja3'
            ? [hello.version, clean(hello.ciphers), clean(hello.extensions), clean(hello.curves), hello.formats.join('-')].join(',')
            : [hello.version, hello.ciphers[0], clean(hello.extensions)].join(',');
      } else {
        const lists = sshKexInit(data);
        text = kind === 'hassh' ? [lists[0], lists[2], lists[4], lists[6]].join(';') : [lists[0], lists[3], lists[5], lists[7]].join(';');
      }
      const digest = await md5Hex(text);
      const output = sArg(a, 'output');
      if (output === 'Hash digest') return digest;
      if (output === stringLabel) return text;
      return `Hash digest:\n${digest}\n\nFull ${stringLabel.replace(/ string$/, '')} string:\n${text}`;
    },
  });
}

function defangUrl(text: string): string {
  return text
    .replace(/\./g, '[.]')
    .replace(/http/gi, (m) => (m === 'http' ? 'hxxp' : 'HXXP'))
    .replace(/:\/\//g, '[://]');
}

const MAC_RE = /[A-F\d]{2}(?:[:-]?[A-F\d]{2}){5}|[A-F\d]{4}\.[A-F\d]{4}\.[A-F\d]{4}/gi;

export const networkingOps: Operation[] = [
  defineOp({
    name: 'Strip HTTP headers',
    category: C,
    description: 'Removes the HTTP request or response headers, leaving the body.',
    input: 'text',
    output: 'text',
    magic: [{ pattern: /^HTTP(.|\s)+?(\r?\n){2}/ }],
    run: (input) => {
      const at = input.search(/\r?\n\r?\n/);
      return at === -1 ? input : input.slice(input.slice(at).match(/^\r?\n\r?\n/)?.[0].length ?? 0).slice(at);
    },
  }),
  defineOp({
    name: 'Dechunk HTTP response',
    category: C,
    description: 'Joins the chunks of a chunked HTTP body.',
    input: 'text',
    output: 'text',
    magic: [{ pattern: /^[0-9A-F]+\r\n/i }],
    run: (input) => {
      let at = 0;
      let out = '';
      while (at < input.length) {
        const lineEnd = input.indexOf('\n', at);
        if (lineEnd === -1) break;
        const size = Number.parseInt(input.slice(at, lineEnd).trim().split(';')[0] ?? '', 16);
        if (!Number.isFinite(size) || size === 0) break;
        out += input.slice(lineEnd + 1, lineEnd + 1 + size);
        at = lineEnd + 1 + size;
        while (input[at] === '\r' || input[at] === '\n') at++;
      }
      return out;
    },
  }),
  defineOp({
    name: 'Parse Ethernet frame',
    category: C,
    description: 'Splits an Ethernet II frame into MAC addresses, type and payload.',
    input: 'text',
    output: 'text',
    args: [sel('input', 'Input type', ['Raw', 'Hex']), sel('output', 'Return type', ['Text output', 'Packet data', 'Packet data (hex)'])],
    run: (input, a) => {
      const b = packet(input, sArg(a, 'input'));
      if (b.length < 14) throw new OpError('An Ethernet frame is at least 14 bytes.');
      const mac = (i: number) => hex(b.slice(i, i + 6), ':');
      let at = 12;
      let vlan = '';
      if (u16(b, 12) === 0x8100) {
        vlan = String(u16(b, 14) & 0xfff);
        at = 16;
      }
      const type = u16(b, at);
      const payload = b.slice(at + 2);
      const out = sArg(a, 'output');
      if (out === 'Packet data') return bytesToLatin1(payload);
      if (out === 'Packet data (hex)') return hex(payload);
      return table([
        ['Destination MAC', mac(0)],
        ['Source MAC', mac(6)],
        ...(vlan ? ([['VLAN', vlan]] as [string, string][]) : []),
        ['Type', `0x${type.toString(16).padStart(4, '0')} (${({ 2048: 'IPv4', 34525: 'IPv6', 2054: 'ARP' } as Record<number, string>)[type] ?? 'other'})`],
        ['Payload', `${payload.length} bytes`],
      ]);
    },
  }),
  defineOp({
    name: 'Parse User Agent',
    category: C,
    description: 'Identifies the browser, engine, operating system and device in a User-Agent string.',
    input: 'text',
    output: 'text',
    magic: [{ pattern: /^(User-Agent:|Mozilla\/)[^\n\r]+\s*$/ }],
    run: async (input) => {
      const Bowser = cjs(await import('bowser'));
      const r = Bowser.parse(input.replace(/^User-Agent:\s*/i, '').trim());
      return table([
        ['Browser', `${r.browser.name ?? 'unknown'} ${r.browser.version ?? ''}`.trim()],
        ['Engine', `${r.engine.name ?? 'unknown'} ${r.engine.version ?? ''}`.trim()],
        ['Operating system', `${r.os.name ?? 'unknown'} ${r.os.versionName ?? r.os.version ?? ''}`.trim()],
        ['Device', `${r.platform.type ?? 'unknown'}${r.platform.vendor ? ` (${r.platform.vendor}${r.platform.model ? ` ${r.platform.model}` : ''})` : ''}`],
      ]);
    },
  }),
  defineOp({
    name: 'Parse IP range',
    category: C,
    description: 'Lists the addresses in a CIDR range (10.0.0.0/24), a hyphenated range or a list.',
    input: 'text',
    output: 'text',
    args: [bool('info', 'Include network info', true), bool('enumerate', 'Enumerate IP addresses', true), bool('large', 'Allow large queries')],
    run: (input, a) => {
      const text = input.trim();
      const limit = bArg(a, 'large') ? 1_000_000n : 65_536n;
      let first: bigint;
      let last: bigint;
      let family: 4 | 6;
      const info: string[] = [];
      if (text.includes('-')) {
        const [x, y] = text.split('-').map((part) => parseAddress(part)) as [Address, Address];
        if (x.family !== y.family) throw new OpError('Both ends of a range must be the same IP version.');
        [first, last, family] = [x.value, y.value, x.family];
      } else {
        const net = parseCidr(text);
        family = net.family;
        first = net.network;
        last = net.last;
        info.push(
          `Network: ${formatAddress(family, net.network)}`,
          `CIDR: ${net.prefix}`,
          `Mask: ${formatAddress(family, net.mask)}`,
          `Range: ${formatAddress(family, first)} - ${formatAddress(family, last)}`,
          `Total addresses in range: ${net.size}`,
        );
        if (family === 4 && net.prefix < 31) info.push(`Usable hosts: ${hostRange(net).count}`);
      }
      const count = last - first + 1n;
      const lines = bArg(a, 'info') ? [...info] : [];
      if (bArg(a, 'enumerate')) {
        if (count > limit) throw new OpError(`The range has ${count} addresses; turn on "Allow large queries" or choose a smaller range.`);
        if (lines.length) lines.push('');
        for (let v = first; v <= last; v++) lines.push(formatAddress(family, v));
      }
      return lines.join('\n');
    },
  }),
  defineOp({
    name: 'Parse IPv6 address',
    category: C,
    description: 'Expands an IPv6 address and explains what kind of address it is.',
    input: 'text',
    output: 'text',
    run: (input) => {
      const address = parseAddress(input);
      if (address.family !== 6) throw new OpError('Enter an IPv6 address.');
      const v = address.value;
      const lines = [`Longhand:  ${fullIPv6(v)}`, `Shorthand: ${formatAddress(6, v)}`, `Type:      ${classify(6, v)}`];
      if (v >> 32n === 0xffffn) lines.push(`IPv4-mapped address: ${formatIPv4(v & 0xffffffffn)}`);
      if (v >> 112n === 0x2002n) lines.push(`6to4 embedded IPv4: ${formatIPv4((v >> 80n) & 0xffffffffn)}`);
      if (v >> 96n === 0x20010000n)
        lines.push(`Teredo server: ${formatIPv4((v >> 64n) & 0xffffffffn)}`, `Teredo client (public IPv4): ${formatIPv4(~v & 0xffffffffn)}`, `Teredo client port: ${Number(~(v >> 32n) & 0xffffn)}`);
      if (v >> 32n === 0x0064ff9b0000000000000000n) lines.push(`NAT64 embedded IPv4: ${formatIPv4(v & 0xffffffffn)}`);
      const iid = v & 0xffffffffffffffffn;
      if (((iid >> 24n) & 0xffffn) === 0xfffen) {
        const mac = (((iid >> 40n) ^ 0x020000n) << 24n) | (iid & 0xffffffn);
        lines.push(
          `Interface ID from MAC (EUI-64): ${hex(
            Uint8Array.from({ length: 6 }, (_, i) => Number((mac >> BigInt(40 - i * 8)) & 255n)),
            ':',
          )}`,
        );
      }
      return lines.join('\n');
    },
  }),
  defineOp({
    name: 'IPv6 Transition Addresses',
    category: C,
    description: 'Shows the 6to4, IPv4-mapped, IPv4-translated and NAT64 forms of an IPv4 address.',
    input: 'text',
    output: 'text',
    args: [bool('ignoreRanges', 'Ignore ranges', true)],
    run: (input) =>
      input
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const address = parseAddress(line.split('/')[0] ?? '');
          if (address.family !== 4) throw new OpError(`"${line}" is not an IPv4 address.`);
          const v = address.value;
          return [
            `IPv4: ${line}`,
            `6to4: ${formatAddress(6, (0x2002n << 112n) | (v << 80n))}`,
            `IPv4-mapped: ::ffff:${formatIPv4(v)}`,
            `IPv4-translated: ::ffff:0:${formatIPv4(v)}`,
            `NAT64: 64:ff9b::${formatIPv4(v)}`,
            `ISATAP: fe80::5efe:${formatIPv4(v)}`,
          ].join('\n');
        })
        .join('\n\n'),
  }),
  defineOp({
    name: 'Parse IPv4 header',
    category: C,
    description: 'Decodes the fields of an IPv4 header.',
    input: 'text',
    output: 'text',
    args: [sel('format', 'Input format', ['Hex', 'Raw']), sel('output', 'Output format', ['Table', 'Data (hex)', 'Data (raw)'])],
    run: (input, a) => {
      const b = packet(input, sArg(a, 'format'));
      const header = ipv4Header(b);
      const out = sArg(a, 'output');
      if (out === 'Data (hex)') return hex(b.slice(header.ihl));
      if (out === 'Data (raw)') return bytesToLatin1(b.slice(header.ihl));
      return table(header.rows);
    },
  }),
  defineOp({
    name: 'Strip IPv4 header',
    category: C,
    description: 'Removes the IPv4 header, leaving the payload.',
    input: 'bytes',
    output: 'bytes',
    run: (input) => input.slice(ipv4Header(input).ihl),
  }),
  defineOp({
    name: 'Parse TCP',
    category: C,
    description: 'Decodes the fields of a TCP header.',
    input: 'text',
    output: 'text',
    args: [sel('format', 'Input format', ['Hex', 'Raw'])],
    run: (input, a) => JSON.stringify(tcpHeader(packet(input, sArg(a, 'format'))).info, null, 4),
  }),
  defineOp({
    name: 'Strip TCP header',
    category: C,
    description: 'Removes the TCP header, leaving the payload.',
    input: 'bytes',
    output: 'bytes',
    run: (input) => input.slice(tcpHeader(input).offset),
  }),
  defineOp({
    name: 'Parse TLS record',
    category: C,
    description: 'Lists the TLS records and handshake messages in captured bytes.',
    input: 'bytes',
    output: 'text',
    run: (input) => {
      const records: unknown[] = [];
      let at = 0;
      while (at + 5 <= input.length) {
        const type = input[at] as number;
        const length = u16(input, at + 3);
        const body = input.slice(at + 5, at + 5 + length);
        const record: Record<string, unknown> = { type: TLS_TYPES[type] ?? `Unknown (${type})`, version: versionName(u16(input, at + 1)), length };
        if (type === 22 && body.length >= 4) {
          const messages: unknown[] = [];
          let h = 0;
          while (h + 4 <= body.length) {
            const size = ((body[h + 1] as number) << 16) | u16(body, h + 2);
            messages.push({ type: HANDSHAKE[body[h] as number] ?? `Unknown (${body[h]})`, length: size });
            h += 4 + size;
          }
          record.handshake = messages;
        }
        records.push(record);
        at += 5 + length;
      }
      if (records.length === 0) throw new OpError('No TLS records were found.');
      return JSON.stringify(records, null, 4);
    },
  }),
  defineOp({
    name: 'Parse UDP',
    category: C,
    description: 'Decodes the fields of a UDP header.',
    input: 'text',
    output: 'text',
    args: [sel('format', 'Input format', ['Hex', 'Raw'])],
    run: (input, a) => {
      const b = packet(input, sArg(a, 'format'));
      if (b.length < 8) throw new OpError('A UDP header is 8 bytes.');
      return JSON.stringify({ 'Source port': u16(b, 0), 'Destination port': u16(b, 2), Length: u16(b, 4), Checksum: `0x${u16(b, 6).toString(16).padStart(4, '0')}`, Data: hex(b.slice(8)) }, null, 4);
    },
  }),
  defineOp({
    name: 'Strip UDP header',
    category: C,
    description: 'Removes the 8-byte UDP header.',
    input: 'bytes',
    output: 'bytes',
    run: (input) => input.slice(8),
  }),
  defineOp({
    name: 'Parse URI',
    category: C,
    description: 'Splits a URI into protocol, credentials, host, port, path, query parameters and fragment.',
    input: 'text',
    output: 'text',
    run: (input) => {
      let url: URL;
      try {
        url = new URL(input.trim());
      } catch {
        throw new OpError('This is not a valid absolute URI.');
      }
      const rows: [string, string][] = [['Protocol', url.protocol]];
      if (url.username) rows.push(['Username', decodeURIComponent(url.username)]);
      if (url.password) rows.push(['Password', decodeURIComponent(url.password)]);
      rows.push(['Hostname', url.hostname]);
      if (url.port) rows.push(['Port', url.port]);
      rows.push(['Path name', decodeURIComponent(url.pathname)]);
      if (url.search) {
        rows.push(['Arguments', '']);
        for (const [k, v] of url.searchParams) rows.push([`  ${k}`, v]);
      }
      if (url.hash) rows.push(['Hash', decodeURIComponent(url.hash)]);
      return table(rows);
    },
  }),
  defineOp({
    name: 'VarInt Encode',
    category: C,
    description: 'Encodes a whole number as a Protocol Buffers varint.',
    input: 'text',
    output: 'bytes',
    run: (input) => {
      let v = BigInt(input.trim());
      if (v < 0n) v = (1n << 64n) + v;
      const out: number[] = [];
      do {
        let byte = Number(v & 127n);
        v >>= 7n;
        if (v > 0n) byte |= 128;
        out.push(byte);
      } while (v > 0n);
      return Uint8Array.from(out);
    },
  }),
  defineOp({
    name: 'VarInt Decode',
    category: C,
    description: 'Decodes a Protocol Buffers varint.',
    input: 'bytes',
    output: 'text',
    run: (input) => readVarint(input, 0)[0].toString(),
  }),
  fingerprintOp('JA3 Fingerprint', 'ja3', 'JA3 string'),
  fingerprintOp('JA3S Fingerprint', 'ja3s', 'JA3S string'),
  fingerprintOp('HASSH Client Fingerprint', 'hassh', 'HASSH algorithms string'),
  fingerprintOp('HASSH Server Fingerprint', 'hasshServer', 'HASSH algorithms string'),
  defineOp({
    name: 'Format MAC addresses',
    category: C,
    description: 'Lists MAC addresses in several common notations.',
    input: 'text',
    output: 'text',
    args: [
      sel('case', 'Output case', ['Both', 'Upper only', 'Lower only']),
      bool('none', 'No delimiter', true),
      bool('dash', 'Dash delimiter', true),
      bool('colon', 'Colon delimiter', true),
      bool('cisco', 'Cisco style'),
      bool('ipv6', 'IPv6 interface ID'),
    ],
    run: (input, a) => {
      const macs = input.match(MAC_RE) ?? [];
      const out: string[] = [];
      for (const raw of macs) {
        const digits = raw.replace(/[^0-9a-f]/gi, '').toLowerCase();
        const pairs = digits.match(/../g) ?? [];
        const forms: string[] = [];
        if (bArg(a, 'none')) forms.push(digits);
        if (bArg(a, 'dash')) forms.push(pairs.join('-'));
        if (bArg(a, 'colon')) forms.push(pairs.join(':'));
        if (bArg(a, 'cisco')) forms.push((digits.match(/.{4}/g) ?? []).join('.'));
        if (bArg(a, 'ipv6')) {
          const first = ((Number.parseInt(pairs[0] ?? '0', 16) ^ 2) & 255).toString(16).padStart(2, '0');
          forms.push(`${first}${pairs[1]}:${pairs[2]}ff:fe${pairs[3]}:${pairs[4]}${pairs[5]}`);
        }
        const mode = sArg(a, 'case');
        for (const form of forms) {
          if (mode !== 'Lower only') out.push(form.toUpperCase());
          if (mode !== 'Upper only') out.push(form);
        }
        out.push('');
      }
      return out.join('\n').trim();
    },
  }),
  defineOp({
    name: 'Group IP addresses',
    category: C,
    description: 'Groups IPv4 addresses by subnet.',
    input: 'text',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', ['Line feed', 'CRLF', 'Space', 'Comma', 'Semi-colon']), num('cidr', 'Subnet (CIDR)', 24, { min: 0, max: 32 }), bool('only', 'Only show the subnets')],
    run: (input, a) => {
      const prefix = nArg(a, 'cidr');
      const mask = prefix === 0 ? 0n : ((1n << 32n) - 1n) ^ ((1n << BigInt(32 - prefix)) - 1n);
      const groups = new Map<bigint, string[]>();
      for (const part of input.split(/[\s,;]+/).filter(Boolean)) {
        const address = parseAddress(part);
        if (address.family !== 4) continue;
        const net = address.value & mask;
        groups.set(net, [...(groups.get(net) ?? []), formatIPv4(address.value)]);
      }
      return [...groups.entries()]
        .sort(([x], [y]) => (x < y ? -1 : 1))
        .map(([net, list]) => (bArg(a, 'only') ? `${formatIPv4(net)}/${prefix}` : `${formatIPv4(net)}/${prefix}\n${list.map((ip) => `   ${ip}`).join('\n')}`))
        .join('\n');
    },
  }),
  defineOp({
    name: 'Encode NetBIOS Name',
    category: C,
    description: 'Encodes a NetBIOS name (first-level encoding, 16 bytes to 32 characters).',
    input: 'bytes',
    output: 'bytes',
    args: [num('offset', 'Offset', 65, { min: 0, max: 255 })],
    run: (input, a) => {
      const name = new Uint8Array(16).fill(0x20);
      name.set(input.slice(0, 16));
      const offset = nArg(a, 'offset');
      return Uint8Array.from(Array.from(name).flatMap((b) => [(b >> 4) + offset, (b & 15) + offset]));
    },
  }),
  defineOp({
    name: 'Decode NetBIOS Name',
    category: C,
    description: 'Decodes a first-level encoded NetBIOS name.',
    input: 'bytes',
    output: 'bytes',
    args: [num('offset', 'Offset', 65, { min: 0, max: 255 })],
    magic: [{ pattern: /^\s*\S{32}$/ }],
    run: (input, a) => {
      const offset = nArg(a, 'offset');
      const out: number[] = [];
      for (let i = 0; i + 1 < input.length; i += 2) out.push((((input[i] as number) - offset) << 4) | (((input[i + 1] as number) - offset) & 15));
      return Uint8Array.from(out);
    },
  }),
  defineOp({
    name: 'Defang URL',
    category: C,
    description: 'Makes URLs safe to share by breaking their dots, http and :// (hxxp[://]example[.]com).',
    input: 'text',
    output: 'text',
    args: [
      bool('dots', 'Escape dots', true),
      bool('http', 'Escape http', true),
      bool('slashes', 'Escape ://', true),
      sel('process', 'Process', ['Valid domains and full URLs', 'Only full URLs', 'Everything']),
    ],
    run: (input, a) => {
      const defang = (text: string) => {
        let t = text;
        if (bArg(a, 'dots')) t = t.replace(/\./g, '[.]');
        if (bArg(a, 'http')) t = t.replace(/http/gi, (m) => (m === 'http' ? 'hxxp' : 'HXXP'));
        if (bArg(a, 'slashes')) t = t.replace(/:\/\//g, '[://]');
        return t;
      };
      const mode = sArg(a, 'process');
      if (mode === 'Everything') return defang(input);
      const url = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
      if (mode === 'Only full URLs') return input.replace(url, defang);
      return input.replace(new RegExp(`${url.source}|\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,}\\b`, 'gi'), defang);
    },
  }),
  defineOp({
    name: 'Fang URL',
    category: C,
    description: 'Restores defanged URLs.',
    input: 'text',
    output: 'text',
    args: [bool('dots', 'Restore [.]', true), bool('http', 'Restore hxxp', true), bool('slashes', 'Restore ://', true)],
    magic: [{ pattern: /hxxps?(\[:\/\/\]|:\/\/)|\[\.\]/i }],
    run: (input, a) => {
      let t = input;
      if (bArg(a, 'dots')) t = t.replace(/\[\.\]/g, '.');
      if (bArg(a, 'http')) t = t.replace(/hxxp/gi, (m) => (m === 'hxxp' ? 'http' : 'HTTP'));
      if (bArg(a, 'slashes')) t = t.replace(/\[:\/\/\]/g, '://');
      return t;
    },
  }),
  defineOp({
    name: 'Defang IP Addresses',
    category: C,
    description: 'Breaks IPv4 and IPv6 addresses so they are not clickable (1[.]2[.]3[.]4).',
    input: 'text',
    output: 'text',
    magic: [{ pattern: /^\s*(([0-9]{1,3}\.){3}[0-9]{1,3}|([0-9a-f]{4}:){7}[0-9a-f]{4})\s*$/i }],
    run: (input) => input.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) => ip.replace(/\./g, '[.]')).replace(/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi, (ip) => ip.replace(/:/g, '[:]')),
  }),
];

void defangUrl;

function readVarint(bytes: Uint8Array, start: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  let at = start;
  for (;;) {
    if (at >= bytes.length) throw new OpError('The varint ends early.');
    const byte = bytes[at++] as number;
    value |= BigInt(byte & 127) << shift;
    if (!(byte & 128)) break;
    shift += 7n;
    if (shift > 63n) throw new OpError('The varint is too long.');
  }
  return [value, at];
}
