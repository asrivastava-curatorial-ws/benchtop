/** Hashing: message digests, HMAC/CMAC, password hashes, checksums and CRCs. */

import type { CHash } from '@noble/hashes/utils.js';
import { bArg, bool, bytesToLatin1, cjs, defineOp, hex, hexToBytes, keyArg, keyed, nArg, num, OpError, type Operation, sArg, sel, str, toBytes } from '../core';
import { base64Encode } from './data-format';

const C = 'Hashing' as const;

type Digest = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

async function digests(): Promise<Record<string, Digest>> {
  const sha2 = await import('@noble/hashes/sha2.js');
  const sha3 = await import('@noble/hashes/sha3.js');
  const legacy = await import('@noble/hashes/legacy.js');
  const blake2 = await import('@noble/hashes/blake2.js');
  const blake3 = await import('@noble/hashes/blake3.js');
  const wasm = await import('hash-wasm');
  const fromHex = (f: (d: Uint8Array) => Promise<string>) => async (d: Uint8Array) => hexToBytes(await f(d));
  return {
    MD4: fromHex(wasm.md4),
    MD5: legacy.md5,
    SHA0: sha0,
    SHA1: legacy.sha1,
    'SHA2-224': sha2.sha224,
    'SHA2-256': sha2.sha256,
    'SHA2-384': sha2.sha384,
    'SHA2-512': sha2.sha512,
    'SHA2-512/224': sha2.sha512_224,
    'SHA2-512/256': sha2.sha512_256,
    'SHA3-224': sha3.sha3_224,
    'SHA3-256': sha3.sha3_256,
    'SHA3-384': sha3.sha3_384,
    'SHA3-512': sha3.sha3_512,
    'Keccak-224': sha3.keccak_224,
    'Keccak-256': sha3.keccak_256,
    'Keccak-384': sha3.keccak_384,
    'Keccak-512': sha3.keccak_512,
    'Shake128 (256 bits)': (d) => sha3.shake128(d, { dkLen: 32 }),
    'Shake256 (512 bits)': (d) => sha3.shake256(d, { dkLen: 64 }),
    'RIPEMD-160': legacy.ripemd160,
    Whirlpool: fromHex(wasm.whirlpool),
    SM3: fromHex(wasm.sm3),
    'BLAKE2b-512': (d) => blake2.blake2b(d, { dkLen: 64 }),
    'BLAKE2b-384': (d) => blake2.blake2b(d, { dkLen: 48 }),
    'BLAKE2b-256': (d) => blake2.blake2b(d, { dkLen: 32 }),
    'BLAKE2b-160': (d) => blake2.blake2b(d, { dkLen: 20 }),
    'BLAKE2b-128': (d) => blake2.blake2b(d, { dkLen: 16 }),
    'BLAKE2s-256': (d) => blake2.blake2s(d, { dkLen: 32 }),
    'BLAKE2s-160': (d) => blake2.blake2s(d, { dkLen: 20 }),
    'BLAKE2s-128': (d) => blake2.blake2s(d, { dkLen: 16 }),
    'BLAKE3-256': (d) => blake3.blake3(d),
  };
}

/** SHA-0: SHA-1 without the one-bit rotation in the message schedule (withdrawn in 1995). */
export function sha0(data: Uint8Array): Uint8Array {
  const length = data.length;
  const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
  padded.set(data);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32));
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 80; i++) w[i] = (w[i - 3] as number) ^ (w[i - 8] as number) ^ (w[i - 14] as number) ^ (w[i - 16] as number);
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + (w[i] as number)) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = t;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  for (const [i, v] of h.entries()) ov.setUint32(i * 4, v);
  return out;
}

function digestOp(name: string, description: string, pick: (a: Record<string, unknown>) => string, args = [] as ReturnType<typeof sel>[]): Operation {
  return defineOp({
    name,
    category: C,
    description,
    input: 'bytes',
    output: 'text',
    args,
    run: async (input, a) => {
      const table = await digests();
      const fn = table[pick(a)];
      if (!fn) throw new OpError(`Unknown hash ${pick(a)}.`);
      return hex(await fn(input));
    },
  });
}

/* ------------------------------------------------------------- checksums -- */

export interface CrcSpec {
  readonly width: number;
  readonly poly: bigint;
  readonly init: bigint;
  readonly refIn: boolean;
  readonly refOut: boolean;
  readonly xorOut: bigint;
}

const crc = (width: number, poly: bigint, init: bigint, refIn: boolean, refOut: boolean, xorOut: bigint): CrcSpec => ({ width, poly, init, refIn, refOut, xorOut });
const F64 = 0xffffffffffffffffn;

export const CRC_PRESETS: Record<string, CrcSpec> = {
  'CRC-8': crc(8, 0x07n, 0n, false, false, 0n),
  'CRC-8/CDMA2000': crc(8, 0x9bn, 0xffn, false, false, 0n),
  'CRC-8/DVB-S2': crc(8, 0xd5n, 0n, false, false, 0n),
  'CRC-8/I-CODE': crc(8, 0x1dn, 0xfdn, false, false, 0n),
  'CRC-8/MAXIM-DOW': crc(8, 0x31n, 0n, true, true, 0n),
  'CRC-8/ROHC': crc(8, 0x07n, 0xffn, true, true, 0n),
  'CRC-8/WCDMA': crc(8, 0x9bn, 0n, true, true, 0n),
  'CRC-16/ARC': crc(16, 0x8005n, 0n, true, true, 0n),
  'CRC-16/BUYPASS': crc(16, 0x8005n, 0n, false, false, 0n),
  'CRC-16/CCITT-FALSE': crc(16, 0x1021n, 0xffffn, false, false, 0n),
  'CRC-16/DNP': crc(16, 0x3d65n, 0n, true, true, 0xffffn),
  'CRC-16/GENIBUS': crc(16, 0x1021n, 0xffffn, false, false, 0xffffn),
  'CRC-16/KERMIT': crc(16, 0x1021n, 0n, true, true, 0n),
  'CRC-16/MAXIM': crc(16, 0x8005n, 0n, true, true, 0xffffn),
  'CRC-16/MODBUS': crc(16, 0x8005n, 0xffffn, true, true, 0n),
  'CRC-16/USB': crc(16, 0x8005n, 0xffffn, true, true, 0xffffn),
  'CRC-16/X-25': crc(16, 0x1021n, 0xffffn, true, true, 0xffffn),
  'CRC-16/XMODEM': crc(16, 0x1021n, 0n, false, false, 0n),
  'CRC-24/OPENPGP': crc(24, 0x864cfbn, 0xb704cen, false, false, 0n),
  'CRC-32': crc(32, 0x04c11db7n, 0xffffffffn, true, true, 0xffffffffn),
  'CRC-32/BZIP2': crc(32, 0x04c11db7n, 0xffffffffn, false, false, 0xffffffffn),
  'CRC-32C': crc(32, 0x1edc6f41n, 0xffffffffn, true, true, 0xffffffffn),
  'CRC-32/JAMCRC': crc(32, 0x04c11db7n, 0xffffffffn, true, true, 0n),
  'CRC-32/MPEG-2': crc(32, 0x04c11db7n, 0xffffffffn, false, false, 0n),
  'CRC-32/POSIX': crc(32, 0x04c11db7n, 0n, false, false, 0xffffffffn),
  'CRC-32Q': crc(32, 0x814141abn, 0n, false, false, 0n),
  'CRC-32/XFER': crc(32, 0xafn, 0n, false, false, 0n),
  'CRC-64/ECMA-182': crc(64, 0x42f0e1eba9ea3693n, 0n, false, false, 0n),
  'CRC-64/GO-ISO': crc(64, 0x1bn, F64, true, true, F64),
  'CRC-64/WE': crc(64, 0x42f0e1eba9ea3693n, F64, false, false, F64),
  'CRC-64/XZ': crc(64, 0x42f0e1eba9ea3693n, F64, true, true, F64),
};

function reflect(value: bigint, width: number): bigint {
  let out = 0n;
  for (let i = 0; i < width; i++) if ((value >> BigInt(i)) & 1n) out |= 1n << BigInt(width - 1 - i);
  return out;
}

export function crcCompute(data: Uint8Array, spec: CrcSpec): bigint {
  const width = BigInt(spec.width);
  const mask = (1n << width) - 1n;
  const top = 1n << (width - 1n);
  // A byte-wise table keeps long inputs fast even with BigInt.
  const table: bigint[] = [];
  for (let n = 0; n < 256; n++) {
    let r = BigInt(n) << (width > 8n ? width - 8n : 0n);
    if (width < 8n) r = BigInt(n);
    for (let k = 0; k < 8; k++) {
      if (width >= 8n) r = r & top ? ((r << 1n) ^ spec.poly) & mask : (r << 1n) & mask;
    }
    table.push(r);
  }
  let reg = spec.init & mask;
  if (spec.width >= 8) {
    for (const raw of data) {
      const byte = spec.refIn ? Number(reflect(BigInt(raw), 8)) : raw;
      const index = Number(((reg >> (width - 8n)) ^ BigInt(byte)) & 0xffn);
      reg = ((reg << 8n) & mask) ^ (table[index] as bigint);
    }
  } else {
    for (const raw of data) {
      const byte = spec.refIn ? Number(reflect(BigInt(raw), 8)) : raw;
      for (let i = 7; i >= 0; i--) {
        const bit = BigInt((byte >> i) & 1) ^ ((reg >> (width - 1n)) & 1n);
        reg = (reg << 1n) & mask;
        if (bit) reg ^= spec.poly;
      }
    }
  }
  if (spec.refOut) reg = reflect(reg, spec.width);
  return (reg ^ spec.xorOut) & mask;
}

const crcHex = (value: bigint, width: number) => value.toString(16).padStart(Math.ceil(width / 4), '0');

function fletcher(data: Uint8Array, bits: 8 | 16 | 32 | 64): string {
  if (bits === 64) {
    let a = 0n;
    let b = 0n;
    for (const byte of data) {
      a = (a + BigInt(byte)) % 0xffffffffn;
      b = (b + a) % 0xffffffffn;
    }
    return ((b << 32n) | a).toString(16).padStart(16, '0');
  }
  const mod = bits === 8 ? 0xf : bits === 16 ? 0xff : 0xffff;
  const shift = bits / 2;
  let a = 0;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % mod;
    b = (b + a) % mod;
  }
  return ((b * 2 ** shift + a) >>> 0).toString(16).padStart(bits / 4, '0');
}

function adler32(data: Uint8Array): string {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) | a) >>> 0).toString(16).padStart(8, '0');
}

function murmur3(data: Uint8Array, seed: number): number {
  let h = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const blocks = Math.floor(data.length / 4);
  for (let i = 0; i < blocks; i++) {
    let k = ((data[i * 4] as number) | ((data[i * 4 + 1] as number) << 8) | ((data[i * 4 + 2] as number) << 16) | ((data[i * 4 + 3] as number) << 24)) >>> 0;
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  let k = 0;
  const tail = blocks * 4;
  const rest = data.length & 3;
  if (rest >= 3) k ^= (data[tail + 2] as number) << 16;
  if (rest >= 2) k ^= (data[tail + 1] as number) << 8;
  if (rest >= 1) {
    k ^= data[tail] as number;
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
  }
  h ^= data.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

async function lmHash(password: string): Promise<string> {
  const CJ = cjs(await import('crypto-js'));
  const pass = new Uint8Array(14);
  pass.set(toBytes(password.toUpperCase()).slice(0, 14));
  const key = (seven: Uint8Array) => {
    const k = new Uint8Array(8);
    k[0] = (seven[0] as number) >> 1;
    k[1] = (((seven[0] as number) & 1) << 6) | ((seven[1] as number) >> 2);
    k[2] = (((seven[1] as number) & 3) << 5) | ((seven[2] as number) >> 3);
    k[3] = (((seven[2] as number) & 7) << 4) | ((seven[3] as number) >> 4);
    k[4] = (((seven[3] as number) & 15) << 3) | ((seven[4] as number) >> 5);
    k[5] = (((seven[4] as number) & 31) << 2) | ((seven[5] as number) >> 6);
    k[6] = (((seven[5] as number) & 63) << 1) | ((seven[6] as number) >> 7);
    k[7] = (seven[6] as number) & 127;
    return k.map((b) => b << 1);
  };
  const wa = (b: Uint8Array) => CJ.enc.Hex.parse(hex(b));
  const half = (seven: Uint8Array) => CJ.DES.encrypt(CJ.enc.Latin1.parse('KGS!@#$%'), wa(key(seven)), { mode: CJ.mode.ECB, padding: CJ.pad.NoPadding }).ciphertext.toString();
  return half(pass.slice(0, 7)) + half(pass.slice(7));
}

function luhn(input: string, radix: number): string {
  const digits = Array.from(input.replace(/\s/g, '').toLowerCase(), (ch) => {
    const d = Number.parseInt(ch, radix);
    if (Number.isNaN(d)) throw new OpError(`"${ch}" is not a digit in base ${radix}.`);
    return d;
  });
  const sum = (list: number[], parityStart: number) =>
    list.reduceRight((acc, d, i) => {
      const fromRight = list.length - 1 - i;
      if (fromRight % 2 === parityStart) {
        const doubled = d * 2;
        return acc + Math.floor(doubled / radix) + (doubled % radix);
      }
      return acc + d;
    }, 0);
  const checksum = sum(digits, 1) % radix;
  const checkDigit = (radix - (sum(digits, 0) % radix)) % radix;
  return `Checksum: ${checksum.toString(radix)}\nCheckdigit: ${checkDigit.toString(radix)}\nLuhn Validated String: ${input.trim()}${checkDigit.toString(radix)}`;
}

const HASH_LENGTHS: Record<number, string[]> = {
  8: ['Fletcher-8', 'CRC-8'],
  16: ['Fletcher-16', 'CRC-16'],
  32: ['Adler-32', 'CRC-32', 'Fletcher-32', 'MurmurHash3'],
  64: ['CRC-64', 'Fletcher-64', 'XXH64'],
  128: ['MD5', 'MD4', 'MD2', 'NTLM', 'LM', 'RIPEMD-128', 'Snefru', 'Tiger-128', 'BLAKE2b-128', 'BLAKE2s-128'],
  160: ['SHA-1', 'SHA-0', 'RIPEMD-160', 'Tiger-160', 'HAS-160', 'BLAKE2b-160', 'BLAKE2s-160'],
  192: ['Tiger'],
  224: ['SHA-224', 'SHA3-224', 'Keccak-224', 'SHA-512/224'],
  256: ['SHA-256', 'SHA3-256', 'Keccak-256', 'BLAKE2b-256', 'BLAKE2s-256', 'BLAKE3', 'SM3', 'RIPEMD-256', 'GOST R 34.11-94', 'Streebog-256', 'SHA-512/256'],
  320: ['RIPEMD-320'],
  384: ['SHA-384', 'SHA3-384', 'Keccak-384', 'BLAKE2b-384'],
  512: ['SHA-512', 'SHA3-512', 'Keccak-512', 'Whirlpool', 'BLAKE2b-512', 'Streebog-512'],
};

export const hashingOps: Operation[] = [
  defineOp({
    name: 'Analyse hash',
    category: C,
    description: 'Suggests which hash functions could have produced a hex or Base64 digest, from its length.',
    input: 'text',
    output: 'text',
    run: (input) => {
      const text = input.trim();
      const bits = /^[0-9a-f]+$/i.test(text) ? text.length * 4 : /^[A-Za-z0-9+/]+=*$/.test(text) ? Math.floor((text.replace(/=+$/, '').length * 6) / 8) * 8 : 0;
      if (bits === 0) throw new OpError('Enter a hash in hex or Base64.');
      return `Hash length: ${bits / 8} bytes (${bits} bits)\n\nBased on the length, this could be:\n${(HASH_LENGTHS[bits] ?? ['no common hash']).join('\n')}`;
    },
  }),
  defineOp({
    name: 'Generate all checksums',
    category: C,
    description: 'Runs every CRC and checksum on the input.',
    input: 'bytes',
    output: 'text',
    args: [bool('names', 'Include names', true)],
    run: (input, a) => {
      const rows: [string, string][] = [
        ['Adler-32', adler32(input)],
        ['Fletcher-8', fletcher(input, 8)],
        ['Fletcher-16', fletcher(input, 16)],
        ['Fletcher-32', fletcher(input, 32)],
        ['Fletcher-64', fletcher(input, 64)],
        ...Object.entries(CRC_PRESETS).map(([name, spec]) => [name, crcHex(crcCompute(input, spec), spec.width)] as [string, string]),
      ];
      return rows.map(([name, value]) => (bArg(a, 'names') ? `${name.padEnd(18)} ${value}` : value)).join('\n');
    },
  }),
  defineOp({
    name: 'Generate all hashes',
    category: C,
    description: 'Runs every hash function on the input.',
    input: 'bytes',
    output: 'text',
    args: [sel('length', 'Length (bits)', ['All', '128', '160', '224', '256', '384', '512']), bool('names', 'Include names', true)],
    run: async (input, a) => {
      const table = await digests();
      const want = sArg(a, 'length');
      const rows: string[] = [];
      for (const [name, fn] of Object.entries(table)) {
        const value = hex(await fn(input));
        if (want !== 'All' && value.length * 4 !== Number(want)) continue;
        rows.push(bArg(a, 'names') ? `${name.padEnd(20)} ${value}` : value);
      }
      return rows.join('\n');
    },
  }),
  digestOp('MD4', 'MD4 digest (broken; for legacy data only).', () => 'MD4'),
  digestOp('MD5', 'MD5 digest (broken for security; fine as a checksum).', () => 'MD5'),
  digestOp('SHA0', 'SHA-0, the withdrawn predecessor of SHA-1.', () => 'SHA0'),
  digestOp('SHA1', 'SHA-1 digest (no longer collision-resistant).', () => 'SHA1'),
  digestOp('SHA2', 'SHA-2 digests: SHA-224, SHA-256, SHA-384, SHA-512 and the truncated SHA-512 variants.', (a) => `SHA2-${a.size}`, [
    sel('size', 'Size', ['512', '384', '256', '224', '512/256', '512/224']),
  ]),
  digestOp('SHA3', 'SHA-3 digests (FIPS 202).', (a) => `SHA3-${a.size}`, [sel('size', 'Size', ['512', '384', '256', '224'])]),
  digestOp('Keccak', 'Original Keccak digests (as used by Ethereum), before the SHA-3 padding change.', (a) => `Keccak-${a.size}`, [sel('size', 'Size', ['512', '384', '256', '224'])]),
  defineOp({
    name: 'Shake',
    category: C,
    description: 'SHAKE extendable-output function, with any output length.',
    input: 'bytes',
    output: 'text',
    args: [sel('capacity', 'Capacity', ['256', '128']), num('size', 'Size', 512, { min: 8, step: 8 })],
    run: async (input, a) => {
      const { shake128, shake256 } = await import('@noble/hashes/sha3.js');
      const fn = sArg(a, 'capacity') === '128' ? shake128 : shake256;
      return hex(fn(input, { dkLen: Math.max(1, Math.floor(nArg(a, 'size') / 8)) }));
    },
  }),
  digestOp('SM3', 'SM3, the Chinese national hash standard.', () => 'SM3'),
  digestOp('RIPEMD', 'RIPEMD-160 digest.', () => 'RIPEMD-160', [sel('size', 'Size', ['160'])]),
  digestOp('Whirlpool', 'Whirlpool digest (512 bits).', () => 'Whirlpool'),
  ...(['BLAKE2b', 'BLAKE2s'] as const).map((name) =>
    defineOp({
      name,
      category: C,
      description: `${name} digest, optionally keyed.`,
      input: 'bytes',
      output: 'text',
      args: [
        sel('size', 'Size', name === 'BLAKE2b' ? ['512', '384', '256', '160', '128'] : ['256', '160', '128']),
        sel('encoding', 'Output Encoding', ['Hex', 'Base64', 'Raw']),
        keyed('key', 'Key', 'UTF8'),
      ],
      run: async (input, a) => {
        const { blake2b, blake2s } = await import('@noble/hashes/blake2.js');
        const key = keyArg(a, 'key');
        const fn = name === 'BLAKE2b' ? blake2b : blake2s;
        const out = fn(input, { dkLen: Number(sArg(a, 'size')) / 8, key: key.length ? key : undefined });
        const enc = sArg(a, 'encoding');
        return enc === 'Base64' ? base64Encode(out, 'A-Za-z0-9+/=') : enc === 'Raw' ? bytesToLatin1(out) : hex(out);
      },
    }),
  ),
  defineOp({
    name: 'BLAKE3',
    category: C,
    description: 'BLAKE3 digest of any length, optionally keyed with a 32-byte key.',
    input: 'bytes',
    output: 'text',
    args: [num('size', 'Size (bytes)', 16, { min: 1 }), str('key', 'Key', '')],
    run: async (input, a) => {
      const { blake3 } = await import('@noble/hashes/blake3.js');
      const key = toBytes(sArg(a, 'key'));
      if (key.length !== 0 && key.length !== 32) throw new OpError('A BLAKE3 key is exactly 32 bytes.');
      return hex(blake3(input, { dkLen: nArg(a, 'size'), key: key.length ? key : undefined }));
    },
  }),
  defineOp({
    name: 'HMAC',
    category: C,
    description: 'Keyed-hash message authentication code.',
    input: 'bytes',
    output: 'text',
    args: [
      keyed('key', 'Key', 'UTF8'),
      sel('hash', 'Hashing function', ['MD5', 'SHA1', 'SHA2-224', 'SHA2-256', 'SHA2-384', 'SHA2-512', 'SHA3-224', 'SHA3-256', 'SHA3-384', 'SHA3-512', 'Keccak-256', 'RIPEMD-160'], 'SHA2-256'),
    ],
    run: async (input, a) => {
      const { hmac } = await import('@noble/hashes/hmac.js');
      const sha2 = await import('@noble/hashes/sha2.js');
      const sha3 = await import('@noble/hashes/sha3.js');
      const legacy = await import('@noble/hashes/legacy.js');
      const table = {
        MD5: legacy.md5,
        SHA1: legacy.sha1,
        'SHA2-224': sha2.sha224,
        'SHA2-256': sha2.sha256,
        'SHA2-384': sha2.sha384,
        'SHA2-512': sha2.sha512,
        'SHA3-224': sha3.sha3_224,
        'SHA3-256': sha3.sha3_256,
        'SHA3-384': sha3.sha3_384,
        'SHA3-512': sha3.sha3_512,
        'Keccak-256': sha3.keccak_256,
        'RIPEMD-160': legacy.ripemd160,
      } as Record<string, CHash>;
      const fn = table[sArg(a, 'hash')];
      if (!fn) throw new OpError('Choose a hash function.');
      return hex(hmac(fn, keyArg(a, 'key'), input));
    },
  }),
  defineOp({
    name: 'CMAC',
    category: C,
    description: 'AES-CMAC message authentication code (RFC 4493).',
    input: 'bytes',
    output: 'text',
    args: [keyed('key', 'Key', 'Hex'), sel('algorithm', 'Encryption algorithm', ['AES'])],
    run: async (input, a) => {
      const { cmac } = await import('@noble/ciphers/aes.js');
      const key = keyArg(a, 'key');
      if (![16, 24, 32].includes(key.length)) throw new OpError('AES keys are 16, 24 or 32 bytes.');
      return hex(cmac(input, key));
    },
  }),
  defineOp({
    name: 'Bcrypt compare',
    category: C,
    description: 'Checks a password (the input) against a bcrypt hash.',
    input: 'text',
    output: 'text',
    args: [str('hash', 'Hash', '')],
    run: async (input, a) => {
      const bcrypt = cjs(await import('bcryptjs'));
      return (await bcrypt.compare(input, sArg(a, 'hash'))) ? `Match: ${input}` : 'No match';
    },
  }),
  defineOp({
    name: 'Bcrypt parse',
    category: C,
    description: 'Splits a bcrypt hash into its algorithm, cost, salt and hash.',
    input: 'text',
    output: 'text',
    run: (input) => {
      const m = /^\$(2[abxy]?)\$(\d{2})\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/.exec(input.trim());
      if (!m) throw new OpError('This is not a bcrypt hash ($2b$10$…).');
      return `Algorithm: $${m[1]}$\nRounds: ${Number(m[2])}\nSalt: ${m[3]}\nPassword hash: ${m[4]}`;
    },
  }),
  defineOp({
    name: 'Argon2',
    category: C,
    description: 'Hashes a password with Argon2i, Argon2d or Argon2id.',
    input: 'text',
    output: 'text',
    args: [
      keyed('salt', 'Salt', 'UTF8', undefined, { default: 'somesalt' }),
      num('iterations', 'Iterations', 3, { min: 1 }),
      num('memory', 'Memory (KiB)', 4096, { min: 8 }),
      num('parallelism', 'Parallelism', 1, { min: 1 }),
      num('length', 'Hash length (bytes)', 32, { min: 4 }),
      sel('type', 'Type', ['Argon2i', 'Argon2d', 'Argon2id']),
      sel('format', 'Output format', ['Encoded hash', 'Hex hash', 'Raw hash']),
    ],
    run: async (input, a) => {
      const wasm = await import('hash-wasm');
      const fn = sArg(a, 'type') === 'Argon2i' ? wasm.argon2i : sArg(a, 'type') === 'Argon2d' ? wasm.argon2d : wasm.argon2id;
      const salt = keyArg(a, 'salt');
      if (salt.length < 8) throw new OpError('The salt must be at least 8 bytes.');
      const format = sArg(a, 'format');
      const result = await fn({
        password: input,
        salt,
        iterations: nArg(a, 'iterations'),
        memorySize: nArg(a, 'memory'),
        parallelism: nArg(a, 'parallelism'),
        hashLength: nArg(a, 'length'),
        outputType: format === 'Encoded hash' ? 'encoded' : format === 'Raw hash' ? 'binary' : 'hex',
      });
      return typeof result === 'string' ? result : bytesToLatin1(result);
    },
  }),
  defineOp({
    name: 'Argon2 compare',
    category: C,
    description: 'Checks a password (the input) against an encoded Argon2 hash.',
    input: 'text',
    output: 'text',
    args: [str('hash', 'Encoded hash', '')],
    run: async (input, a) => ((await (await import('hash-wasm')).argon2Verify({ password: input, hash: sArg(a, 'hash') })) ? `Match: ${input}` : 'No match'),
  }),
  defineOp({
    name: 'NT Hash',
    category: C,
    description: 'The NTLM password hash (MD4 of the UTF-16LE password).',
    input: 'text',
    output: 'text',
    run: async (input) => {
      const bytes = new Uint8Array(input.length * 2);
      for (let i = 0; i < input.length; i++) {
        const c = input.charCodeAt(i);
        bytes[i * 2] = c & 255;
        bytes[i * 2 + 1] = c >> 8;
      }
      return (await (await import('hash-wasm')).md4(bytes)).toUpperCase();
    },
  }),
  defineOp({
    name: 'LM Hash',
    category: C,
    description: 'The obsolete LAN Manager password hash.',
    input: 'text',
    output: 'text',
    run: async (input) => (await lmHash(input)).toUpperCase(),
  }),
  defineOp({
    name: 'MurmurHash3',
    category: C,
    description: 'MurmurHash3 (32-bit x86), a fast non-cryptographic hash.',
    input: 'bytes',
    output: 'text',
    args: [num('seed', 'Seed', 0), bool('signed', 'Convert to Signed')],
    run: (input, a) => {
      const h = murmur3(input, nArg(a, 'seed'));
      return String(bArg(a, 'signed') ? h | 0 : h);
    },
  }),
  ...([8, 16, 32, 64] as const).map((bits) =>
    defineOp({
      name: `Fletcher-${bits} Checksum`,
      category: C,
      description: `Fletcher-${bits} checksum.`,
      input: 'bytes',
      output: 'text',
      run: (input) => fletcher(input, bits),
    }),
  ),
  defineOp({ name: 'Adler-32 Checksum', category: C, description: 'Adler-32 checksum (as used by zlib).', input: 'bytes', output: 'text', run: (input) => adler32(input) }),
  defineOp({
    name: 'Luhn Checksum',
    category: C,
    description: 'Luhn (mod 10) checksum and check digit, as used for card numbers and IMEIs.',
    input: 'text',
    output: 'text',
    args: [num('radix', 'Radix', 10, { min: 2, max: 36 })],
    run: (input, a) => luhn(input, nArg(a, 'radix')),
  }),
  defineOp({
    name: 'CRC Checksum',
    category: C,
    description: 'Cyclic redundancy checks: 30 standard CRC-8, 16, 24, 32 and 64 variants, or your own parameters.',
    input: 'bytes',
    output: 'text',
    keywords: ['crc32', 'crc16', 'crc8', 'crc64'],
    args: [
      sel('algorithm', 'Algorithm', [...Object.keys(CRC_PRESETS), 'Custom'], 'CRC-32'),
      num('width', 'Width (bits)', 32, { min: 1, max: 64, showIf: (a) => a.algorithm === 'Custom' }),
      str('poly', 'Polynomial', '04C11DB7', { showIf: (a) => a.algorithm === 'Custom' }),
      str('init', 'Initialization', 'FFFFFFFF', { showIf: (a) => a.algorithm === 'Custom' }),
      bool('refIn', 'Reflect input', true, { showIf: (a) => a.algorithm === 'Custom' }),
      bool('refOut', 'Reflect output', true, { showIf: (a) => a.algorithm === 'Custom' }),
      str('xorOut', 'Xor Output', 'FFFFFFFF', { showIf: (a) => a.algorithm === 'Custom' }),
    ],
    run: (input, a) => {
      const name = sArg(a, 'algorithm');
      const parseHex = (key: string) => BigInt(`0x${sArg(a, key).replace(/^0x/i, '') || '0'}`);
      const spec = name === 'Custom' ? crc(nArg(a, 'width'), parseHex('poly'), parseHex('init'), bArg(a, 'refIn'), bArg(a, 'refOut'), parseHex('xorOut')) : CRC_PRESETS[name];
      if (!spec) throw new OpError(`Unknown CRC ${name}.`);
      return crcHex(crcCompute(input, spec), spec.width);
    },
  }),
  defineOp({
    name: 'TCP/IP Checksum',
    category: C,
    description: "The 16-bit one's-complement checksum used in IP, TCP and UDP headers.",
    input: 'bytes',
    output: 'text',
    run: (input) => {
      let sum = 0;
      for (let i = 0; i < input.length; i += 2) sum += ((input[i] as number) << 8) | (input[i + 1] ?? 0);
      while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
      return (~sum & 0xffff).toString(16).padStart(4, '0');
    },
  }),
  defineOp({
    name: 'XOR Checksum',
    category: C,
    description: 'XORs blocks of the input together.',
    input: 'bytes',
    output: 'text',
    args: [num('size', 'Blocksize', 4, { min: 1 })],
    run: (input, a) => {
      const size = Math.max(1, nArg(a, 'size'));
      const out = new Uint8Array(size);
      input.forEach((b, i) => {
        out[i % size] = (out[i % size] as number) ^ b;
      });
      return hex(out);
    },
  }),
  defineOp({
    name: 'Parity Bit',
    category: C,
    description: 'Adds or checks an even or odd parity bit on binary strings.',
    input: 'text',
    output: 'text',
    args: [
      sel('mode', 'Mode', ['Even Parity', 'Odd Parity']),
      sel('position', 'Postion', ['Start', 'End']),
      sel('action', 'Encode or Decode', ['Encode', 'Decode']),
      str('delimiter', 'Delimiter', ''),
    ],
    run: (input, a) => {
      const delim = sArg(a, 'delimiter');
      const parts = delim ? input.split(delim) : [input.replace(/\s/g, '')];
      const odd = sArg(a, 'mode') === 'Odd Parity';
      const start = sArg(a, 'position') === 'Start';
      return parts
        .map((part) => {
          if (!/^[01]*$/.test(part)) throw new OpError('Parity Bit works on binary strings of 0s and 1s.');
          if (sArg(a, 'action') === 'Encode') {
            const ones = Array.from(part).filter((c) => c === '1').length;
            const bit = String((ones + (odd ? 1 : 0)) % 2);
            return start ? bit + part : part + bit;
          }
          return start ? part.slice(1) : part.slice(0, -1);
        })
        .join(delim);
    },
  }),
];
