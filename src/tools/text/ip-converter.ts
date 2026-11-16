import { randomBytes, toHex } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { classify, formatIPv4, formatIPv6, fullIPv6, parseAddress } from '../../lib/subnet';
import { defineTextTool, type Field } from '../types';

/** The fewest CIDR blocks that cover exactly the addresses from `start` to `end`. */
export function rangeToCidrs(start: bigint, end: bigint, bits: number): { address: bigint; prefix: number }[] {
  const blocks: { address: bigint; prefix: number }[] = [];
  let current = start;
  while (current <= end) {
    let size = 0;
    while (size < bits && (current & ((1n << BigInt(size + 1)) - 1n)) === 0n && current + (1n << BigInt(size + 1)) - 1n <= end) size++;
    blocks.push({ address: current, prefix: bits - size });
    current += 1n << BigInt(size);
    if (blocks.length > 10_000) throw new ToolError('That range needs more than 10 000 blocks.');
  }
  return blocks;
}

/** RFC 4193 unique local /48 prefix with a random 40-bit global ID. */
export function ulaPrefix(): string {
  const id = toHex(randomBytes(5));
  return `fd${id.slice(0, 2)}:${id.slice(2, 6)}:${id.slice(6, 10)}::/48`;
}

export default defineTextTool({
  input: false,
  output: { label: 'Result' },
  options: [
    {
      key: 'mode',
      label: 'Tool',
      type: 'segmented',
      choices: [
        { value: 'convert', label: 'Convert' },
        { value: 'range', label: 'Range to CIDR' },
        { value: 'ula', label: 'IPv6 ULA' },
      ],
      default: 'convert',
    },
    {
      key: 'address',
      label: 'Address',
      type: 'text',
      default: '192.168.1.10',
      mono: true,
      wide: true,
      placeholder: '192.168.1.10, 3232235786, 0xC0A8010A or 2001:db8::1',
      showIf: (v) => v.mode === 'convert',
    },
    { key: 'start', label: 'First address', type: 'text', default: '192.168.0.10', mono: true, showIf: (v) => v.mode === 'range' },
    { key: 'end', label: 'Last address', type: 'text', default: '192.168.0.200', mono: true, showIf: (v) => v.mode === 'range' },
  ],
  action: 'Generate',
  runOnEmpty: true,
  run(_input, o) {
    if (o.mode === 'ula') {
      const prefix = ulaPrefix();
      const base = prefix.replace('::/48', '');
      return {
        output: prefix,
        fields: [
          { label: 'Prefix', value: prefix, mono: true, tone: 'ok' },
          { label: 'First /64 subnet', value: `${base}:0::/64`.replace(':0::', '::'), mono: true },
          { label: 'Subnets available', value: '65 536 × /64' },
          { label: 'Note', value: 'Press Generate for a new random global ID (RFC 4193 section 3.2).', tone: 'muted' },
        ],
      };
    }
    if (o.mode === 'range') {
      const first = parseAddress(o.start.trim());
      const last = parseAddress(o.end.trim());
      if (first.family !== last.family) throw new ToolError('Both addresses must be IPv4 or both IPv6.');
      if (first.value > last.value) throw new ToolError('The first address must not come after the last.');
      const bits = first.family === 4 ? 32 : 128;
      const blocks = rangeToCidrs(first.value, last.value, bits);
      const format = first.family === 4 ? formatIPv4 : formatIPv6;
      return {
        output: blocks.map((block) => `${format(block.address)}/${block.prefix}`).join('\n'),
        fields: [
          { label: 'Addresses', value: (last.value - first.value + 1n).toLocaleString('en-US') },
          { label: 'CIDR blocks', value: String(blocks.length) },
        ],
      };
    }
    let text = o.address.trim();
    let value: bigint | null = null;
    let family: 4 | 6 = 4;
    if (/^0x[0-9a-f]+$/i.test(text) || /^\d+$/.test(text) || /^0b[01]+$/i.test(text)) {
      value = BigInt(text);
      family = value > 0xffffffffn ? 6 : 4;
      text = family === 4 ? formatIPv4(value) : formatIPv6(value);
    }
    const address = value === null ? parseAddress(text) : { family, value };
    const fields: Field[] = [{ label: 'Kind', value: `IPv${address.family}, ${classify(address.family, address.value)}` }];
    if (address.family === 4) {
      const octets = formatIPv4(address.value).split('.').map(Number);
      fields.push(
        { label: 'Dotted decimal', value: formatIPv4(address.value), mono: true },
        { label: 'Decimal', value: address.value.toString(), mono: true },
        { label: 'Hexadecimal', value: `0x${address.value.toString(16).toUpperCase().padStart(8, '0')}`, mono: true },
        { label: 'Octal', value: `0${address.value.toString(8)}`, mono: true },
        { label: 'Binary', value: octets.map((octet) => octet.toString(2).padStart(8, '0')).join('.'), mono: true },
        { label: 'Dotted hex', value: octets.map((octet) => `0x${octet.toString(16).padStart(2, '0')}`).join('.'), mono: true },
        { label: 'IPv6-mapped', value: `::ffff:${formatIPv4(address.value)}`, mono: true },
        { label: '6to4 prefix', value: `2002:${(address.value >> 16n).toString(16).padStart(4, '0')}:${(address.value & 0xffffn).toString(16).padStart(4, '0')}::/48`, mono: true },
        { label: 'Reverse DNS name', value: `${[...octets].reverse().join('.')}.in-addr.arpa`, mono: true },
      );
    } else {
      fields.push(
        { label: 'Compressed', value: formatIPv6(address.value), mono: true },
        { label: 'Full', value: fullIPv6(address.value), mono: true },
        { label: 'Decimal', value: address.value.toString(), mono: true },
        { label: 'Hexadecimal', value: `0x${address.value.toString(16).padStart(32, '0')}`, mono: true },
        { label: 'Binary', value: (address.value.toString(2).padStart(128, '0').match(/.{16}/g) ?? []).join(':'), mono: true },
      );
      if (address.value >> 32n === 0xffffn) fields.push({ label: 'Embedded IPv4', value: formatIPv4(address.value & 0xffffffffn), mono: true });
    }
    return {
      output: fields
        .filter((field) => field.mono)
        .map((field) => `${field.label}: ${field.value}`)
        .join('\n'),
      fields,
    };
  },
});
