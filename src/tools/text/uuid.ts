import { MAX, NIL, v1, v3, v4, v5, v6, v7, validate } from 'uuid';
import { randomBytes, randomInt, toHex } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { relativeTime } from '../../lib/jwt';
import { defineTextTool, type Field } from '../types';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const NANOID = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
/** KSUID timestamps count seconds from 2014-05-13T16:53:20Z. */
const KSUID_EPOCH = 1_400_000_000;

/** ULID: 48-bit millisecond time and 80 random bits in Crockford Base32 (26 characters, sortable). */
export function ulid(now = Date.now()): string {
  let time = '';
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let random = '';
  for (const byte of randomBytes(16)) random += CROCKFORD[byte & 31];
  return time + random;
}

/** MongoDB ObjectId: 4-byte seconds, 5 random bytes, 3-byte counter (24 hex digits). */
let objectIdCounter = randomInt(0xffffff);
const objectIdProcess = toHex(randomBytes(5));
export function objectId(now = Date.now()): string {
  objectIdCounter = (objectIdCounter + 1) & 0xffffff;
  return (
    Math.floor(now / 1000)
      .toString(16)
      .padStart(8, '0') +
    objectIdProcess +
    objectIdCounter.toString(16).padStart(6, '0')
  );
}

/** Nano ID: 21 URL-safe characters (126 random bits). */
export const nanoid = (size = 21): string => Array.from(randomBytes(size), (byte) => NANOID[byte & 63]).join('');

/** KSUID: 4-byte timestamp and 16 random bytes in Base62 (27 characters, sortable). */
export function ksuid(now = Date.now()): string {
  const bytes = new Uint8Array(20);
  new DataView(bytes.buffer).setUint32(0, Math.floor(now / 1000) - KSUID_EPOCH);
  bytes.set(randomBytes(16), 4);
  let value = BigInt(`0x${toHex(bytes)}`);
  let out = '';
  while (value > 0n) {
    out = BASE62[Number(value % 62n)] + out;
    value /= 62n;
  }
  return out.padStart(27, '0');
}

const GENERATORS: Record<string, () => string> = { v4, v7, v1, v6, nil: () => NIL, max: () => MAX, ulid: () => ulid(), objectid: () => objectId(), nanoid: () => nanoid(), ksuid: () => ksuid() };
const NAMESPACES: Record<string, string> = {
  dns: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  url: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  oid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  x500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
};
const isUuidVersion = (version: string): boolean => /^v\d$|^nil$|^max$/.test(version);

/** Decodes the time inside a ULID, ObjectId or KSUID; null when the text is none of them. */
export function inspectOtherId(text: string): { kind: string; timestampMs: number } | null {
  const id = text.trim();
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id)) {
    let ms = 0;
    for (const char of id.slice(0, 10).toUpperCase()) ms = ms * 32 + CROCKFORD.indexOf(char);
    return { kind: 'ULID', timestampMs: ms };
  }
  if (/^[0-9a-f]{24}$/i.test(id)) return { kind: 'MongoDB ObjectId', timestampMs: Number.parseInt(id.slice(0, 8), 16) * 1000 };
  if (/^[0-9A-Za-z]{27}$/.test(id)) {
    let value = 0n;
    for (const char of id) value = value * 62n + BigInt(BASE62.indexOf(char));
    return { kind: 'KSUID', timestampMs: (Number(value >> 128n) + KSUID_EPOCH) * 1000 };
  }
  return null;
}

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
        { value: 'v5', label: 'v5 — from a name (SHA-1)' },
        { value: 'v3', label: 'v3 — from a name (MD5)' },
        { value: 'nil', label: 'Nil (all zeros)' },
        { value: 'max', label: 'Max (all ones)' },
        { value: 'ulid', label: 'ULID (sortable, 26 characters)' },
        { value: 'objectid', label: 'MongoDB ObjectId' },
        { value: 'ksuid', label: 'KSUID (sortable, 27 characters)' },
        { value: 'nanoid', label: 'Nano ID (21 characters)' },
      ],
      default: 'v4',
    },
    {
      key: 'namespace',
      label: 'Namespace',
      type: 'select',
      choices: [
        { value: 'dns', label: 'DNS names' },
        { value: 'url', label: 'URLs' },
        { value: 'oid', label: 'ISO OIDs' },
        { value: 'x500', label: 'X.500 names' },
        { value: 'custom', label: 'Another UUID…' },
      ],
      default: 'dns',
      showIf: (v) => v.version === 'v5' || v.version === 'v3',
    },
    {
      key: 'customNamespace',
      label: 'Namespace UUID',
      type: 'text',
      default: '',
      mono: true,
      placeholder: '00000000-0000-0000-0000-000000000000',
      showIf: (v) => (v.version === 'v5' || v.version === 'v3') && v.namespace === 'custom',
    },
    {
      key: 'name',
      label: 'Names',
      type: 'text',
      default: 'example.org',
      mono: true,
      wide: true,
      multiline: true,
      help: 'The same namespace and name always give the same UUID; one name per line gives one UUID each.',
      showIf: (v) => v.version === 'v5' || v.version === 'v3',
    },
    { key: 'count', label: 'How many', type: 'number', default: 5, min: 1, max: 5000, step: 1, showIf: (v) => v.version !== 'v5' && v.version !== 'v3' },
    { key: 'uppercase', label: 'Uppercase', type: 'toggle', default: false, showIf: (v) => isUuidVersion(String(v.version)) },
    { key: 'hyphens', label: 'Hyphens', type: 'toggle', default: true, showIf: (v) => isUuidVersion(String(v.version)) },
    { key: 'braces', label: '{Braces}', type: 'toggle', default: false, showIf: (v) => isUuidVersion(String(v.version)) },
    { key: 'inspect', label: 'Inspect an ID', type: 'text', default: '', mono: true, wide: true, placeholder: 'paste a UUID, ULID, ObjectId or KSUID to decode it' },
  ],
  action: 'Generate',
  runOnEmpty: true,
  run(_input, o) {
    const named = o.version === 'v5' || o.version === 'v3';
    const namespace = o.namespace === 'custom' ? o.customNamespace.trim() : (NAMESPACES[o.namespace] ?? NAMESPACES.dns);
    if (named && !validate(namespace ?? '')) throw new ToolError('The namespace must be a UUID.');
    const ids = named
      ? o.name
          .split(/\r?\n/)
          .filter((name) => name !== '')
          .map((name) => (o.version === 'v5' ? v5 : v3)(name, namespace as string))
      : Array.from({ length: Math.max(1, Math.min(5000, Math.trunc(o.count))) }, () => (GENERATORS[o.version] ?? v4)());
    const lines = ids.map((generated) => {
      let id = generated;
      if (!isUuidVersion(o.version)) return id;
      if (!o.hyphens) id = id.replace(/-/g, '');
      if (o.uppercase) id = id.toUpperCase();
      return o.braces ? `{${id}}` : id;
    });
    const fields: Field[] = [];
    const other = o.inspect.trim() !== '' ? inspectOtherId(o.inspect) : null;
    if (other) {
      fields.push({ label: 'Kind', value: other.kind }, { label: 'Timestamp', value: `${new Date(other.timestampMs).toISOString()}  (${relativeTime(other.timestampMs, Date.now())})`, mono: true });
    } else if (o.inspect.trim() !== '') {
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
