import { blake2b, blake2s } from '@noble/hashes/blake2.js';
import { blake3 } from '@noble/hashes/blake3.js';
import { hmac } from '@noble/hashes/hmac.js';
import { md5, ripemd160, sha1 } from '@noble/hashes/legacy.js';
import { sha224, sha256, sha384, sha512, sha512_256 } from '@noble/hashes/sha2.js';
import { keccak_256, keccak_512, sha3_224, sha3_256, sha3_384, sha3_512 } from '@noble/hashes/sha3.js';
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
  'sha512-256': { label: 'SHA-512/256', hash: sha512_256 },
  'sha3-224': { label: 'SHA3-224', hash: sha3_224 },
  'sha3-256': { label: 'SHA3-256', hash: sha3_256 },
  'sha3-384': { label: 'SHA3-384', hash: sha3_384 },
  'sha3-512': { label: 'SHA3-512', hash: sha3_512 },
  'keccak-256': { label: 'Keccak-256 (Ethereum)', hash: keccak_256 },
  'keccak-512': { label: 'Keccak-512', hash: keccak_512 },
  blake2b: { label: 'BLAKE2b-512', hash: blake2b },
  blake2s: { label: 'BLAKE2s-256', hash: blake2s },
  blake3: { label: 'BLAKE3', hash: blake3 },
  ripemd160: { label: 'RIPEMD-160', hash: ripemd160 },
} as const;

/** Algorithms computed with hash-wasm (WebAssembly); these have no HMAC form here. */
const EXTRA = {
  md4: 'MD4',
  ntlm: 'NTLM (Windows password hash)',
  whirlpool: 'Whirlpool',
  sm3: 'SM3',
  xxhash32: 'xxHash32',
  xxhash64: 'xxHash64',
  xxhash3: 'XXH3-64',
  xxhash128: 'XXH3-128',
  crc32c: 'CRC-32C (Castagnoli)',
  crc64: 'CRC-64 (ECMA)',
  adler32: 'Adler-32',
} as const;

type ExtraId = keyof typeof EXTRA;

async function extraDigest(id: ExtraId, data: Uint8Array): Promise<Uint8Array> {
  const wasm = await import('hash-wasm');
  const hex = await (async () => {
    switch (id) {
      case 'md4':
        return wasm.md4(data);
      case 'ntlm': {
        const text = new TextDecoder().decode(data);
        const utf16 = new Uint8Array(text.length * 2);
        for (let i = 0; i < text.length; i++) {
          utf16[i * 2] = text.charCodeAt(i) & 255;
          utf16[i * 2 + 1] = text.charCodeAt(i) >> 8;
        }
        return wasm.md4(utf16);
      }
      case 'whirlpool':
        return wasm.whirlpool(data);
      case 'sm3':
        return wasm.sm3(data);
      case 'xxhash32':
        return wasm.xxhash32(data);
      case 'xxhash64':
        return wasm.xxhash64(data);
      case 'xxhash3':
        return wasm.xxhash3(data);
      case 'xxhash128':
        return wasm.xxhash128(data);
      case 'crc32c':
        return wasm.crc32(data, 0x82f63b78);
      case 'crc64':
        return wasm.crc64(data);
      default:
        return wasm.adler32(data);
    }
  })();
  return fromHex(hex);
}

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
      choices: [
        ...Object.entries(ALGORITHMS).map(([value, { label }]) => ({ value, label })),
        { value: 'crc32', label: 'CRC-32 (checksum)' },
        ...Object.entries(EXTRA).map(([value, label]) => ({ value, label })),
        { value: 'all', label: 'All of the above' },
      ],
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
  async run(input, o, ctx) {
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
        const label = ALGORITHMS[id].label.replace(/ \(.*/, '');
        return `${(key ? `HMAC-${label}` : label).padEnd(key ? 14 : 9)} ${value}`;
      });
      if (!key) {
        const value = checksum();
        digests.push(value);
        rows.push(`${'CRC-32'.padEnd(9)} ${value}`);
        for (const id of Object.keys(EXTRA) as ExtraId[]) {
          const extra = encode(await extraDigest(id, data));
          digests.push(extra);
          rows.push(`${EXTRA[id].replace(/ \(.*/, '').padEnd(9)} ${extra}`);
        }
      }
      output = rows.join('\n');
    } else if (o.algorithm === 'crc32') {
      if (key) throw new ToolError('CRC-32 is a checksum, not a hash function, and cannot be used for HMAC.');
      output = checksum();
      digests.push(output);
    } else if (o.algorithm in EXTRA) {
      if (key) throw new ToolError(`${EXTRA[o.algorithm as ExtraId]} has no HMAC form here; clear the key or pick a SHA or BLAKE algorithm.`);
      output = encode(await extraDigest(o.algorithm as ExtraId, data));
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
    // The integrity attribute for <script> and <link> tags (Subresource Integrity) takes a Base64 SHA-2 digest.
    if (!key && ['sha256', 'sha384', 'sha512', 'all'].includes(o.algorithm)) {
      const id = o.algorithm === 'all' ? 'sha384' : (o.algorithm as 'sha256' | 'sha384' | 'sha512');
      fields.push({ label: 'Subresource Integrity', value: `${id}-${toBase64(ALGORITHMS[id].hash(data))}`, mono: true });
    }
    const subject = ctx.file ? `${ctx.file.name} (${formatBytes(data.length)})` : formatBytes(data.length);
    const weak = !key && ['md5', 'sha1', 'md4', 'ntlm'].includes(o.algorithm);
    return {
      output,
      fields,
      info: `${key ? 'HMAC of' : 'Digest of'} ${subject}`,
      warnings: weak ? ['MD4, MD5, SHA-1 and NTLM are broken for security purposes. Use them only for checksums or legacy systems.'] : undefined,
    };
  },
});
