import { MAX, NIL, v1, v4, v6, v7 } from 'uuid';
import { ToolError } from '../../lib/errors';
import { relativeTime } from '../../lib/jwt';
import { defineTextTool, type Field } from '../types';

const GENERATORS: Record<string, () => string> = { v4, v7, v1, v6, nil: () => NIL, max: () => MAX };

/** 100-nanosecond intervals between the Gregorian epoch (1582-10-15) and the Unix epoch. */
const GREGORIAN_OFFSET = 0x01b21dd213814000n;

export interface UuidInfo {
  readonly canonical: string;
  readonly version: number;
  readonly variant: string;
  readonly timestampMs?: number;
  readonly node?: string;
  readonly clockSequence?: number;
}

export function inspectUuid(text: string): UuidInfo {
  const hex = text
    .trim()
    .replace(/^urn:uuid:/i, '')
    .replace(/^\{|\}$/g, '')
    .replace(/-/g, '')
    .toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new ToolError(`"${text.trim()}" is not a UUID (32 hexadecimal digits, with or without hyphens).`);
  const canonical = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const variantBits = Number.parseInt(hex[16] as string, 16);
  const variant =
    hex === '0'.repeat(32)
      ? 'Nil UUID'
      : hex === 'f'.repeat(32)
        ? 'Max UUID'
        : variantBits < 8
          ? 'NCS (reserved, backward compatibility)'
          : variantBits < 12
            ? 'RFC 9562 / RFC 4122'
            : variantBits < 14
              ? 'Microsoft (reserved)'
              : 'Reserved for future use';
  const version = Number.parseInt(hex[12] as string, 16);
  const info: { -readonly [K in keyof UuidInfo]: UuidInfo[K] } = { canonical, version, variant };
  if (variant !== 'RFC 9562 / RFC 4122') return info;
  if (version === 1 || version === 6) {
    const ticks = version === 1 ? BigInt(`0x${hex.slice(13, 16)}${hex.slice(8, 12)}${hex.slice(0, 8)}`) : BigInt(`0x${hex.slice(0, 12)}${hex.slice(13, 16)}`);
    info.timestampMs = Number((ticks - GREGORIAN_OFFSET) / 10000n);
    info.clockSequence = Number.parseInt(hex.slice(16, 20), 16) & 0x3fff;
    info.node = (hex.slice(20).match(/../g) ?? []).join(':');
  } else if (version === 7) {
    info.timestampMs = Number.parseInt(hex.slice(0, 12), 16);
  }
  return info;
}

const VERSION_NOTES: Record<number, string> = {
  1: 'time-based (Gregorian timestamp + node)',
  2: 'DCE security',
  3: 'name-based (MD5)',
  4: 'random',
  5: 'name-based (SHA-1)',
  6: 'time-ordered (reordered version 1)',
  7: 'time-ordered (Unix milliseconds + random)',
  8: 'custom / vendor-defined',
};

export default defineTextTool({
  input: false,
  output: { label: 'UUIDs' },
  options: [
    {
      key: 'version',
      label: 'Version',
      type: 'select',
      choices: [
        { value: 'v4', label: 'v4 — random' },
        { value: 'v7', label: 'v7 — time-ordered (sortable)' },
        { value: 'v1', label: 'v1 — timestamp + node' },
        { value: 'v6', label: 'v6 — reordered v1' },
        { value: 'nil', label: 'Nil (all zeros)' },
        { value: 'max', label: 'Max (all ones)' },
      ],
      default: 'v4',
    },
    { key: 'count', label: 'How many', type: 'number', default: 5, min: 1, max: 5000, step: 1 },
    { key: 'uppercase', label: 'Uppercase', type: 'toggle', default: false },
    { key: 'hyphens', label: 'Hyphens', type: 'toggle', default: true },
    { key: 'braces', label: '{Braces}', type: 'toggle', default: false },
    { key: 'inspect', label: 'Inspect a UUID', type: 'text', default: '', mono: true, wide: true, placeholder: 'paste a UUID or GUID to decode it' },
  ],
  action: 'Generate',
  runOnEmpty: true,
  run(_input, o) {
    const generate = GENERATORS[o.version] ?? v4;
    const count = Math.max(1, Math.min(5000, Math.trunc(o.count)));
    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
      let id = generate();
      if (!o.hyphens) id = id.replace(/-/g, '');
      if (o.uppercase) id = id.toUpperCase();
      lines.push(o.braces ? `{${id}}` : id);
    }
    const fields: Field[] = [];
    if (o.inspect.trim() !== '') {
      const info = inspectUuid(o.inspect);
      const standard = info.variant === 'RFC 9562 / RFC 4122';
      fields.push({ label: 'Canonical form', value: info.canonical, mono: true }, { label: 'Variant', value: info.variant });
      if (standard) fields.push({ label: 'Version', value: `${info.version} — ${VERSION_NOTES[info.version] ?? 'unknown'}` });
      if (info.timestampMs !== undefined) {
        const valid = Math.abs(info.timestampMs) < 8.64e15;
        fields.push({
          label: 'Timestamp',
          value: valid ? `${new Date(info.timestampMs).toISOString()}  (${relativeTime(info.timestampMs, Date.now())})` : 'out of range',
          mono: true,
        });
      }
      if (info.clockSequence !== undefined) fields.push({ label: 'Clock sequence', value: String(info.clockSequence), mono: true });
      if (info.node !== undefined) fields.push({ label: 'Node', value: info.node, mono: true });
    }
    return { output: lines.join('\n'), fields, filename: 'uuids.txt' };
  },
});
