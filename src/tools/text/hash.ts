import { hmac } from '@noble/hashes/hmac.js';
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { sha224, sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { sha3_256, sha3_512 } from '@noble/hashes/sha3.js';
import { formatBytes, fromBase64, fromHex, toBase64, toHex, utf8Encode } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field, type Values } from '../types';

const ALGORITHMS = {
  md5: { label: 'MD5', hash: md5 },
  sha1: { label: 'SHA-1', hash: sha1 },
  sha224: { label: 'SHA-224', hash: sha224 },
  sha256: { label: 'SHA-256', hash: sha256 },
  sha384: { label: 'SHA-384', hash: sha384 },
  sha512: { label: 'SHA-512', hash: sha512 },
  'sha3-256': { label: 'SHA3-256', hash: sha3_256 },
  'sha3-512': { label: 'SHA3-512', hash: sha3_512 },
} as const;

type AlgorithmId = keyof typeof ALGORITHMS;

let crcTable: Uint32Array | undefined;

/** CRC-32 (IEEE 802.3, as used by zip, gzip and PNG). */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crcTable[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parseKey(key: string, encoding: string): Uint8Array {
  try {
    if (encoding === 'hex') return fromHex(key);
    if (encoding === 'base64') return fromBase64(key);
  } catch (error) {
    throw new ToolError(`HMAC key: ${error instanceof Error ? error.message : 'invalid encoding'}`);
  }
  return utf8Encode(key);
}

const usesKey = (v: Values): boolean => typeof v.key === 'string' && v.key !== '';

export default defineTextTool({
  input: { label: 'Text or file', sample: 'The quick brown fox jumps over the lazy dog', binary: true, placeholder: 'Type text, or open / drop any file' },
  output: { label: 'Digest' },
  options: [
    {
      key: 'algorithm',
      label: 'Algorithm',
      type: 'select',
      choices: [...Object.entries(ALGORITHMS).map(([value, { label }]) => ({ value, label })), { value: 'crc32', label: 'CRC-32 (checksum)' }, { value: 'all', label: 'All of the above' }],
      default: 'sha256',
    },
    {
      key: 'encoding',
      label: 'Output',
      type: 'select',
      choices: [
        { value: 'hex', label: 'hex' },
        { value: 'HEX', label: 'HEX' },
        { value: 'base64', label: 'Base64' },
      ],
      default: 'hex',
    },
    { key: 'key', label: 'HMAC key (optional)', type: 'text', default: '', secret: true, wide: true },
    {
      key: 'keyEncoding',
      label: 'Key is',
      type: 'select',
      choices: [
        { value: 'utf8', label: 'Text' },
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ],
      default: 'utf8',
      showIf: usesKey,
    },
    { key: 'expected', label: 'Compare with', type: 'text', default: '', mono: true, wide: true, placeholder: 'expected checksum' },
  ],
  runOnEmpty: true,
  run(input, o, ctx) {
    const data = ctx.file ? ctx.file.bytes : utf8Encode(input);
    const key = o.key === '' ? null : parseKey(o.key, o.keyEncoding);
    const encode = (bytes: Uint8Array): string => (o.encoding === 'base64' ? toBase64(bytes) : toHex(bytes, { upper: o.encoding === 'HEX' }));
    const digest = (id: AlgorithmId): string => {
      const { hash } = ALGORITHMS[id];
      return encode(key ? hmac(hash, key, data) : hash(data));
    };
    const checksum = (): string => {
      const value = crc32(data);
      return encode(Uint8Array.from([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]));
    };

    let output: string;
    const digests: string[] = [];
    if (o.algorithm === 'all') {
      const rows = (Object.keys(ALGORITHMS) as AlgorithmId[]).map((id) => {
        const value = digest(id);
        digests.push(value);
        return `${(key ? `HMAC-${ALGORITHMS[id].label}` : ALGORITHMS[id].label).padEnd(key ? 14 : 9)} ${value}`;
      });
      if (!key) {
        const value = checksum();
        digests.push(value);
        rows.push(`${'CRC-32'.padEnd(9)} ${value}`);
      }
      output = rows.join('\n');
    } else if (o.algorithm === 'crc32') {
      if (key) throw new ToolError('CRC-32 is a checksum, not a hash function, and cannot be used for HMAC.');
      output = checksum();
      digests.push(output);
    } else {
      output = digest(o.algorithm as AlgorithmId);
      digests.push(output);
    }

    const fields: Field[] = [];
    const expected = o.expected.trim().replace(/^(sha\d*|md5|crc32)[-:=\s]+/i, '');
    if (expected !== '') {
      const normalise = (value: string) => (o.encoding === 'base64' ? value.replace(/=+$/, '') : value.toLowerCase().replace(/[\s:]/g, ''));
      const match = digests.some((value) => normalise(value) === normalise(expected));
      fields.push(match ? { label: 'Comparison', value: 'Match — the checksum is identical', tone: 'ok' } : { label: 'Comparison', value: 'MISMATCH — the checksum differs', tone: 'bad' });
    }
    const subject = ctx.file ? `${ctx.file.name} (${formatBytes(data.length)})` : formatBytes(data.length);
    const weak = !key && (o.algorithm === 'md5' || o.algorithm === 'sha1');
    return {
      output,
      fields,
      info: `${key ? 'HMAC of' : 'Digest of'} ${subject}`,
      warnings: weak ? ['MD5 and SHA-1 are broken for security purposes. Use them only for checksums or legacy systems.'] : undefined,
    };
  },
});
