/** Encryption and encoding: block and stream ciphers, classical ciphers, key derivation, JWTs. */

import type { CHash } from '@noble/hashes/utils.js';
import {
  type Args,
  bArg,
  bool,
  bytesToLatin1,
  type Choice,
  cjs,
  DELIMITERS,
  defineOp,
  delimiter,
  editable,
  hex,
  hexToBytes,
  keyArg,
  keyed,
  latin1ToBytes,
  nArg,
  num,
  OpError,
  type Operation,
  sArg,
  sel,
  str,
  toBytes,
  txt,
  unescapeShort,
  utf8,
} from '../core';
import { base64Decode, base64Encode } from './data-format';

const C = 'Encryption / Encoding' as const;

/* ------------------------------------------------------- data helpers -- */

function inputBytes(input: string, format: string): Uint8Array {
  return format === 'Hex' ? hexToBytes(input) : latin1OrUtf8(input);
}

/** "Raw" input: one byte per character when possible, else UTF-8 (CyberChef's rule). */
function latin1OrUtf8(text: string): Uint8Array {
  return toBytes(text);
}

function outputText(bytes: Uint8Array, format: string): string {
  return format === 'Hex' ? hex(bytes) : bytesToLatin1(bytes);
}

const XOR_FORMATS = ['Latin1', 'UTF8', 'UTF16', 'UTF16LE', 'UTF16BE', 'Hex', 'Base64'];

function fromFormat(text: string, format: string): Uint8Array {
  switch (format) {
    case 'Hex':
      return hexToBytes(text);
    case 'Base64':
      return base64Decode(text, 'A-Za-z0-9+/=');
    case 'UTF8':
      return utf8(text);
    case 'UTF16':
    case 'UTF16BE':
    case 'UTF16LE': {
      const out = new Uint8Array(text.length * 2);
      const little = format === 'UTF16LE';
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        out[i * 2 + (little ? 0 : 1)] = c & 255;
        out[i * 2 + (little ? 1 : 0)] = c >> 8;
      }
      return out;
    }
    default:
      return latin1ToBytes(text);
  }
}

function toFormat(bytes: Uint8Array, format: string): string {
  switch (format) {
    case 'Hex':
      return hex(bytes);
    case 'Base64':
      return base64Encode(bytes, 'A-Za-z0-9+/=');
    case 'UTF8':
      return new TextDecoder().decode(bytes);
    case 'UTF16':
    case 'UTF16BE':
    case 'UTF16LE': {
      let out = '';
      const little = format === 'UTF16LE';
      for (let i = 0; i + 1 < bytes.length; i += 2)
        out += String.fromCharCode(little ? (bytes[i] as number) | ((bytes[i + 1] as number) << 8) : ((bytes[i] as number) << 8) | (bytes[i + 1] as number));
      return out;
    }
    default:
      return bytesToLatin1(bytes);
  }
}

/* ------------------------------------------------- crypto-js bridging -- */

type WordArray = { words: number[]; sigBytes: number };
type CryptoJS = typeof import('crypto-js');

const toWords = (CJ: CryptoJS, bytes: Uint8Array): WordArray => {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) words[i >>> 2] = (words[i >>> 2] ?? 0) | ((bytes[i] as number) << (24 - (i % 4) * 8));
  return CJ.lib.WordArray.create(words, bytes.length) as unknown as WordArray;
};

const fromWords = (wa: WordArray): Uint8Array => {
  const out = new Uint8Array(wa.sigBytes);
  for (let i = 0; i < wa.sigBytes; i++) out[i] = ((wa.words[i >>> 2] ?? 0) >>> (24 - (i % 4) * 8)) & 255;
  return out;
};

async function cryptoJsCipher(name: 'DES' | 'TripleDES' | 'Blowfish', encrypt: boolean, input: string, args: Args, keySizes: readonly number[], blockSize: number): Promise<string> {
  const CJ = cjs(await import('crypto-js')) as unknown as CryptoJS;
  const key = keyArg(args, 'key');
  const iv = keyArg(args, 'iv');
  const modeName = sArg(args, 'mode');
  if (!keySizes.includes(key.length)) throw new OpError(`Invalid key length: ${key.length} bytes. ${name === 'Blowfish' ? 'Blowfish keys are 4 to 56 bytes.' : `Use ${keySizes.join(' or ')} bytes.`}`);
  const [modeId, paddingId] = modeName.split('/') as [string, string | undefined];
  if (modeId !== 'ECB' && iv.length !== blockSize) throw new OpError(`The IV must be ${blockSize} bytes long for ${modeId} mode.`);
  const mode = (CJ.mode as unknown as Record<string, unknown>)[modeId === 'CTR' ? 'CTR' : modeId];
  const noPadding = paddingId === 'NoPadding' || modeId === 'CTR' || modeId === 'CFB' || modeId === 'OFB';
  const options = { iv: toWords(CJ, iv), mode, padding: noPadding ? CJ.pad.NoPadding : CJ.pad.Pkcs7 };
  const cipher = (CJ as unknown as Record<string, { encrypt: (m: unknown, k: unknown, o: unknown) => { ciphertext: WordArray }; decrypt: (c: unknown, k: unknown, o: unknown) => WordArray }>)[name];
  if (!cipher) throw new OpError(`${name} is not available.`);
  const data = inputBytes(input, sArg(args, 'input'));
  if (encrypt) {
    const result = cipher.encrypt(toWords(CJ, data), toWords(CJ, key), options);
    return outputText(fromWords(result.ciphertext), sArg(args, 'output'));
  }
  const params = CJ.lib.CipherParams.create({ ciphertext: toWords(CJ, data) as never });
  const result = cipher.decrypt(params, toWords(CJ, key), options);
  if (result.sigBytes < 0) throw new OpError('Decryption failed: wrong key or IV, or the data is not padded correctly.');
  return outputText(fromWords(result), sArg(args, 'output'));
}

/* ----------------------------------------------------------- AES -- */

async function aes(encrypt: boolean, input: string, args: Args): Promise<string> {
  const { cbc, ecb, ctr, cfb, gcm } = await import('@noble/ciphers/aes.js');
  const key = keyArg(args, 'key');
  if (![16, 24, 32].includes(key.length)) throw new OpError(`Invalid key length: ${key.length} bytes. AES uses 16, 24 or 32 byte keys (128, 192 or 256 bits).`);
  let data = inputBytes(input, sArg(args, 'input'));
  let iv = keyArg(args, 'iv');
  const mode = sArg(args, 'mode');
  if (!encrypt) {
    const from = sArg(args, 'ivFrom');
    const length = nArg(args, 'ivLength') || 16;
    if (from === 'Prepend') {
      iv = data.slice(0, length);
      data = data.slice(length);
    } else if (from === 'Append') {
      iv = data.slice(data.length - length);
      data = data.slice(0, data.length - length);
    }
  }
  const needsIv = !mode.startsWith('ECB');
  if (needsIv && mode !== 'GCM' && iv.length !== 16) throw new OpError(`The IV must be 16 bytes for ${mode}; it is ${iv.length}.`);
  if (mode === 'GCM' && iv.length === 0) throw new OpError('GCM needs an IV (nonce), usually 12 bytes.');
  const aad = keyArg(args, 'aad');
  let out: Uint8Array;
  let tag: Uint8Array | null = null;
  switch (mode) {
    case 'CBC':
    case 'CBC/NoPadding':
      out = encrypt ? cbc(key, iv, { disablePadding: mode.endsWith('NoPadding') }).encrypt(data) : cbc(key, iv, { disablePadding: mode.endsWith('NoPadding') }).decrypt(data);
      break;
    case 'ECB':
    case 'ECB/NoPadding':
      out = encrypt ? ecb(key, { disablePadding: mode.endsWith('NoPadding') }).encrypt(data) : ecb(key, { disablePadding: mode.endsWith('NoPadding') }).decrypt(data);
      break;
    case 'CTR':
      out = ctr(key, iv).encrypt(data);
      break;
    case 'CFB':
      out = encrypt ? cfb(key, iv).encrypt(data) : cfb(key, iv).decrypt(data);
      break;
    case 'OFB': {
      out = new Uint8Array(data.length);
      let feedback = iv;
      for (let i = 0; i < data.length; i += 16) {
        // noble refuses to reuse a cipher instance, so each keystream block gets its own.
        feedback = ecb(key, { disablePadding: true }).encrypt(feedback);
        for (let j = 0; j < 16 && i + j < data.length; j++) out[i + j] = (data[i + j] as number) ^ (feedback[j] as number);
      }
      break;
    }
    case 'GCM': {
      if (encrypt) {
        const sealed = gcm(key, iv, aad.length ? aad : undefined).encrypt(data);
        out = sealed.slice(0, sealed.length - 16);
        tag = sealed.slice(sealed.length - 16);
      } else {
        const givenTag = keyArg(args, 'tag');
        if (givenTag.length === 0) throw new OpError('Enter the GCM tag to decrypt.');
        const joined = new Uint8Array(data.length + givenTag.length);
        joined.set(data);
        joined.set(givenTag, data.length);
        try {
          out = gcm(key, iv, aad.length ? aad : undefined).decrypt(joined);
        } catch {
          throw new OpError('Unable to decrypt: the tag does not match (wrong key, IV, tag or additional data).');
        }
      }
      break;
    }
    default:
      throw new OpError(`Unknown mode ${mode}.`);
  }
  if (encrypt) {
    const include = sArg(args, 'includeIv');
    if (include === 'Prepend') out = Uint8Array.from([...iv, ...out]);
    else if (include === 'Append') out = Uint8Array.from([...out, ...iv]);
  }
  const text = outputText(out, sArg(args, 'output'));
  return tag ? `${text}\n\nTag: ${hex(tag)}` : text;
}

const AES_MODES = ['CBC', 'CFB', 'OFB', 'CTR', 'GCM', 'ECB', 'CBC/NoPadding', 'ECB/NoPadding'];

/* ------------------------------------------- 64-bit block ciphers (TEA) -- */

type Block = (block: Uint8Array) => Uint8Array;

function pad(data: Uint8Array, size: number, scheme: string): Uint8Array {
  const missing = size - (data.length % size);
  if (scheme === 'NO') {
    if (data.length % size) throw new OpError(`Without padding the input must be a multiple of ${size} bytes.`);
    return data;
  }
  const extra = new Uint8Array(missing);
  if (scheme === 'PKCS5') extra.fill(missing);
  else if (scheme === 'RANDOM') crypto.getRandomValues(extra);
  else if (scheme === 'BIT') extra[0] = 0x80;
  if (scheme === 'ZERO' && missing === size) return data;
  return Uint8Array.from([...data, ...extra]);
}

function unpad(data: Uint8Array, scheme: string): Uint8Array {
  if (scheme === 'PKCS5') {
    const n = data[data.length - 1] ?? 0;
    if (n === 0 || n > data.length) throw new OpError('Bad PKCS#5 padding: wrong key or IV.');
    return data.slice(0, data.length - n);
  }
  if (scheme === 'ZERO') {
    let end = data.length;
    while (end > 0 && data[end - 1] === 0) end--;
    return data.slice(0, end);
  }
  if (scheme === 'BIT') {
    const at = data.lastIndexOf(0x80);
    return at === -1 ? data : data.slice(0, at);
  }
  return data;
}

function blockModes(enc: Block, dec: Block, size: number, mode: string, iv: Uint8Array, data: Uint8Array, encrypt: boolean, padding: string): Uint8Array {
  const stream = mode === 'CTR' || mode === 'OFB' || mode === 'CFB';
  if (mode !== 'ECB' && iv.length !== size) throw new OpError(`The IV must be ${size} bytes long.`);
  const input = encrypt && !stream ? pad(data, size, padding) : data;
  if (!stream && input.length % size) throw new OpError(`The input must be a multiple of ${size} bytes.`);
  const out = new Uint8Array(input.length);
  let feedback: Uint8Array = iv.slice();
  const counter = iv.slice();
  for (let at = 0; at < input.length; at += size) {
    const chunk = input.slice(at, at + size);
    let result: Uint8Array;
    if (mode === 'ECB') result = encrypt ? enc(chunk) : dec(chunk);
    else if (mode === 'CBC') {
      if (encrypt) {
        result = enc(chunk.map((b, i) => b ^ (feedback[i] as number)));
        feedback = result;
      } else {
        result = dec(chunk).map((b, i) => b ^ (feedback[i] as number));
        feedback = chunk;
      }
    } else if (mode === 'CFB') {
      const key = enc(feedback);
      result = chunk.map((b, i) => b ^ (key[i] as number));
      feedback = encrypt ? Uint8Array.from([...result, ...feedback.slice(result.length)]).slice(0, size) : Uint8Array.from([...chunk, ...feedback.slice(chunk.length)]).slice(0, size);
    } else if (mode === 'OFB') {
      feedback = enc(feedback);
      result = chunk.map((b, i) => b ^ (feedback[i] as number));
    } else {
      const key = enc(counter);
      result = chunk.map((b, i) => b ^ (key[i] as number));
      for (let i = size - 1; i >= 0; i--) {
        counter[i] = ((counter[i] as number) + 1) & 255;
        if (counter[i] !== 0) break;
      }
    }
    out.set(result.slice(0, chunk.length), at);
  }
  return encrypt || stream ? out : unpad(out, padding);
}

const readU32 = (b: Uint8Array, i: number) => (((b[i] as number) << 24) | ((b[i + 1] as number) << 16) | ((b[i + 2] as number) << 8) | (b[i + 3] as number)) >>> 0;
const writeU32 = (out: Uint8Array, i: number, v: number) => {
  out[i] = v >>> 24;
  out[i + 1] = (v >>> 16) & 255;
  out[i + 2] = (v >>> 8) & 255;
  out[i + 3] = v & 255;
};

function teaKey(key: Uint8Array): number[] {
  if (key.length !== 16) throw new OpError('TEA keys are 16 bytes (128 bits).');
  return [0, 4, 8, 12].map((i) => readU32(key, i));
}

const DELTA = 0x9e3779b9;

function teaBlock(key: number[], decrypt: boolean): Block {
  return (block) => {
    let v0 = readU32(block, 0);
    let v1 = readU32(block, 4);
    const [k0, k1, k2, k3] = key as [number, number, number, number];
    if (!decrypt) {
      let sum = 0;
      for (let i = 0; i < 32; i++) {
        sum = (sum + DELTA) >>> 0;
        v0 = (v0 + ((((v1 << 4) + k0) ^ (v1 + sum) ^ ((v1 >>> 5) + k1)) >>> 0)) >>> 0;
        v1 = (v1 + ((((v0 << 4) + k2) ^ (v0 + sum) ^ ((v0 >>> 5) + k3)) >>> 0)) >>> 0;
      }
    } else {
      let sum = Math.imul(DELTA, 32) >>> 0;
      for (let i = 0; i < 32; i++) {
        v1 = (v1 - ((((v0 << 4) + k2) ^ (v0 + sum) ^ ((v0 >>> 5) + k3)) >>> 0)) >>> 0;
        v0 = (v0 - ((((v1 << 4) + k0) ^ (v1 + sum) ^ ((v1 >>> 5) + k1)) >>> 0)) >>> 0;
        sum = (sum - DELTA) >>> 0;
      }
    }
    const out = new Uint8Array(8);
    writeU32(out, 0, v0);
    writeU32(out, 4, v1);
    return out;
  };
}

function xteaBlock(key: number[], rounds: number, decrypt: boolean): Block {
  return (block) => {
    let v0 = readU32(block, 0);
    let v1 = readU32(block, 4);
    if (!decrypt) {
      let sum = 0;
      for (let i = 0; i < rounds; i++) {
        v0 = (v0 + (((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + (key[sum & 3] as number))) >>> 0)) >>> 0;
        sum = (sum + DELTA) >>> 0;
        v1 = (v1 + (((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + (key[(sum >>> 11) & 3] as number))) >>> 0)) >>> 0;
      }
    } else {
      let sum = Math.imul(DELTA, rounds) >>> 0;
      for (let i = 0; i < rounds; i++) {
        v1 = (v1 - (((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + (key[(sum >>> 11) & 3] as number))) >>> 0)) >>> 0;
        sum = (sum - DELTA) >>> 0;
        v0 = (v0 - (((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + (key[sum & 3] as number))) >>> 0)) >>> 0;
      }
    }
    const out = new Uint8Array(8);
    writeU32(out, 0, v0);
    writeU32(out, 4, v1);
    return out;
  };
}

function xxtea(data: Uint8Array, key: Uint8Array, decrypt: boolean): Uint8Array {
  if (key.length !== 16) throw new OpError('XXTEA keys are 16 bytes (128 bits).');
  const padded = new Uint8Array(Math.max(8, Math.ceil(data.length / 4) * 4));
  padded.set(data);
  const view = new DataView(padded.buffer);
  const n = padded.length / 4;
  const v = Array.from({ length: n }, (_, i) => view.getUint32(i * 4, true));
  const kv = new DataView(key.buffer, key.byteOffset, 16);
  const k = [0, 1, 2, 3].map((i) => kv.getUint32(i * 4, true));
  const mx = (sum: number, y: number, z: number, p: number, e: number) => ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + ((k[(p & 3) ^ e] as number) ^ z))) >>> 0;
  let rounds = 6 + Math.floor(52 / n);
  if (!decrypt) {
    let sum = 0;
    let z = v[n - 1] as number;
    while (rounds-- > 0) {
      sum = (sum + DELTA) >>> 0;
      const e = (sum >>> 2) & 3;
      for (let p = 0; p < n; p++) {
        const y = v[(p + 1) % n] as number;
        v[p] = ((v[p] as number) + mx(sum, y, z, p, e)) >>> 0;
        z = v[p] as number;
      }
    }
  } else {
    let sum = Math.imul(rounds, DELTA) >>> 0;
    let y = v[0] as number;
    while (rounds-- > 0) {
      const e = (sum >>> 2) & 3;
      for (let p = n - 1; p >= 0; p--) {
        const z = v[(p + n - 1) % n] as number;
        v[p] = ((v[p] as number) - mx(sum, y, z, p, e)) >>> 0;
        y = v[p] as number;
      }
      sum = (sum - DELTA) >>> 0;
    }
  }
  for (const [i, word] of v.entries()) view.setUint32(i * 4, word, true);
  return padded;
}

/* --------------------------------------------------------- RC4 family -- */

function rc4(key: Uint8Array, data: Uint8Array, drop = 0, rounds = 1): Uint8Array {
  if (key.length === 0) throw new OpError('Enter a key.');
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < 256; i++) {
      j = (j + (s[i] as number) + (key[i % key.length] as number)) & 255;
      [s[i], s[j]] = [s[j] as number, s[i] as number];
    }
  }
  let i = 0;
  j = 0;
  const next = () => {
    i = (i + 1) & 255;
    j = (j + (s[i] as number)) & 255;
    [s[i], s[j]] = [s[j] as number, s[i] as number];
    return s[((s[i] as number) + (s[j] as number)) & 255] as number;
  };
  for (let n = 0; n < drop; n++) next();
  return data.map((b) => b ^ next());
}

/* --------------------------------------------------- classical ciphers -- */

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = LOWER.toUpperCase();

export function rot(bytes: Uint8Array, amount: number, lower: boolean, upper: boolean, numbers: boolean): Uint8Array {
  const shift = ((amount % 26) + 26) % 26;
  const digitShift = ((amount % 10) + 10) % 10;
  return bytes.map((b) => {
    if (lower && b >= 97 && b <= 122) return ((b - 97 + shift) % 26) + 97;
    if (upper && b >= 65 && b <= 90) return ((b - 65 + shift) % 26) + 65;
    if (numbers && b >= 48 && b <= 57) return ((b - 48 + digitShift) % 10) + 48;
    return b;
  });
}

export const rot47 = (bytes: Uint8Array, amount: number) => bytes.map((b) => (b >= 33 && b <= 126 ? ((b - 33 + (((amount % 94) + 94) % 94)) % 94) + 33 : b));

function rot8000(text: string): string {
  // ROT8000: rotate every printable code point in the BMP (excluding control, space and surrogates) by half its range.
  const valid: [number, number][] = [
    [33, 126],
    [161, 5759],
    [5761, 8191],
    [8203, 8231],
    [8234, 8238],
    [8240, 8286],
    [8288, 12287],
    [12289, 55295],
    [57344, 65535],
  ];
  const chars: number[] = [];
  for (const [from, to] of valid) for (let c = from; c <= to; c++) chars.push(c);
  const half = chars.length / 2;
  const index = new Map<number, number>();
  for (const [i, c] of chars.entries()) index.set(c, i);
  return Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    const at = index.get(code);
    if (at === undefined || ch.length > 1) return ch;
    return String.fromCharCode(chars[(at + half) % chars.length] as number);
  }).join('');
}

export function xorBytes(input: Uint8Array, key: Uint8Array, scheme: string, nullPreserving: boolean): Uint8Array {
  if (key.length === 0) return input.slice();
  const out = new Uint8Array(input.length);
  let previous = 0;
  for (let i = 0; i < input.length; i++) {
    const b = input[i] as number;
    const k = key[i % key.length] as number;
    let x: number;
    if (nullPreserving && (b === 0 || b === k)) x = b;
    else if (scheme === 'Input differential') x = b ^ k ^ (i === 0 ? 0 : (input[i - 1] as number));
    else if (scheme === 'Output differential') x = b ^ k ^ previous;
    else if (scheme === 'Cascade') x = b ^ (input[i + 1] ?? 0);
    else x = b ^ k;
    out[i] = x;
    previous = x;
  }
  return out;
}

function vigenere(text: string, key: string, decode: boolean): string {
  const k = key.toLowerCase().replace(/[^a-z]/g, '');
  if (k === '') throw new OpError('The key must contain letters.');
  let at = 0;
  return Array.from(text, (ch) => {
    const lower = LOWER.indexOf(ch);
    const upper = UPPER.indexOf(ch);
    if (lower === -1 && upper === -1) return ch;
    const shift = LOWER.indexOf(k[at++ % k.length] as string) * (decode ? -1 : 1);
    if (lower !== -1) return LOWER[(((lower + shift) % 26) + 26) % 26] as string;
    return UPPER[(((upper + shift) % 26) + 26) % 26] as string;
  }).join('');
}

const MORSE: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '&': '.-...',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '-': '-....-',
  _: '..--.-',
  '"': '.-..-.',
  $: '...-..-',
  '@': '.--.-.',
};
const LETTER_DELIMS = ['Space', 'Line feed', 'CRLF', 'Forward slash', 'Backslash', 'Comma', 'Semi-colon', 'Colon'];
const WORD_DELIMS = ['Line feed', 'CRLF', 'Forward slash', 'Backslash', 'Comma', 'Semi-colon', 'Colon'];

const BACON: Record<string, string> = { 'Standard (I=J and U=V)': 'ABCDEFGHIKLMNOPQRSTUWXYZ', Complete: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' };

function polybius(keyword: string): string {
  const alphabet = 'ABCDEFGHIKLMNOPQRSTUVWXYZ';
  const seen = new Set<string>();
  let out = '';
  for (const ch of `${keyword.toUpperCase().replace(/J/g, 'I')}${alphabet}`) {
    if (alphabet.includes(ch) && !seen.has(ch)) {
      seen.add(ch);
      out += ch;
    }
  }
  return out;
}

function bifid(text: string, keyword: string, decode: boolean): string {
  const square = polybius(keyword);
  const letters: { ch: string; upper: boolean }[] = [];
  for (const ch of text) if (/[a-z]/i.test(ch)) letters.push({ ch: ch.toUpperCase().replace('J', 'I'), upper: ch === ch.toUpperCase() });
  const coords = letters.map(({ ch }) => square.indexOf(ch));
  const rows = coords.map((c) => Math.floor(c / 5));
  const cols = coords.map((c) => c % 5);
  let result: number[];
  if (!decode) {
    const line = [...rows, ...cols];
    result = [];
    for (let i = 0; i < line.length; i += 2) result.push((line[i] as number) * 5 + (line[i + 1] as number));
  } else {
    const line = coords.flatMap((c) => [Math.floor(c / 5), c % 5]);
    const half = line.length / 2;
    result = Array.from({ length: half }, (_, i) => (line[i] as number) * 5 + (line[half + i] as number));
  }
  let at = 0;
  return Array.from(text, (ch) => {
    if (!/[a-z]/i.test(ch)) return ch;
    const out = square[result[at] as number] ?? ch;
    const upper = letters[at++]?.upper ?? true;
    return upper ? out : out.toLowerCase();
  }).join('');
}

function railFence(text: string, key: number, offset: number, decode: boolean): string {
  if (key < 2) throw new OpError('The key must be at least 2.');
  const cycle = 2 * (key - 1);
  const rail = (i: number) => {
    const pos = (i + offset) % cycle;
    return pos < key ? pos : cycle - pos;
  };
  const indices = Array.from(text, (_, i) => i);
  const order = indices.sort((a, b) => rail(a) - rail(b) || a - b);
  const chars = Array.from(text);
  if (!decode) return order.map((i) => chars[i]).join('');
  const out = new Array<string>(chars.length);
  order.forEach((target, i) => {
    out[target] = chars[i] as string;
  });
  return out.join('');
}

/* ------------------------------------------------------------ Enigma -- */

const ROTORS: readonly Choice[] = [
  { label: 'I', value: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ<R' },
  { label: 'II', value: 'AJDKSIRUXBLHWTMCQGZNPYFVOE<F' },
  { label: 'III', value: 'BDFHJLCPRTXVZNYEIWGAKMUSQO<W' },
  { label: 'IV', value: 'ESOVPZJAYQUIRHXLNFTGKDCMWB<K' },
  { label: 'V', value: 'VZBRGITYUPSDNHLXAWMJQOFECK<A' },
  { label: 'VI', value: 'JPGVOUMFYQBENHZRDKASXLICTW<AN' },
  { label: 'VII', value: 'NZJHGRCXMYSWBOUFAIVLPEKQDT<AN' },
  { label: 'VIII', value: 'FKQHTLXOCBJSPDZRAMEWNIUYGV<AN' },
];
const FOURTH: readonly Choice[] = [
  { label: 'Beta', value: 'LEYJVCNIXWPBQMDRTAKZGFUHOS' },
  { label: 'Gamma', value: 'FSOKANUERHMBTIYCWLQPZXVGJD' },
];
const REFLECTORS: readonly Choice[] = [
  { label: 'B', value: 'AY BR CU DH EQ FS GL IP JX KN MO TZ VW' },
  { label: 'C', value: 'AF BV CP DJ EI GO HY KR LZ MX NW TQ SU' },
  { label: 'B Thin', value: 'AE BN CK DQ FU GY HW IJ LO MP RX SZ TV' },
  { label: 'C Thin', value: 'AR BD CO EJ FN GT HK IV LM PW QZ SX UY' },
];
const LETTERS = UPPER.split('');

class Rotor {
  private readonly forward: number[];
  private readonly backward: number[];
  private readonly notches: number[];
  pos: number;
  constructor(
    spec: string,
    private readonly ring: number,
    start: number,
  ) {
    const [wiring = '', steps = ''] = spec.split('<');
    if (!/^[A-Z]{26}$/.test(wiring) || new Set(wiring).size !== 26) throw new OpError(`Rotor wiring "${wiring}" must be 26 different letters.`);
    this.forward = Array.from(wiring, (ch) => ch.charCodeAt(0) - 65);
    this.backward = new Array<number>(26);
    this.forward.forEach((to, from) => {
      this.backward[to] = from;
    });
    // CyberChef writes the letters the rotor steps *to*; the turnover happens one position earlier.
    this.notches = Array.from(steps, (ch) => (ch.charCodeAt(0) - 65 + 25) % 26);
    this.pos = start;
  }
  atNotch(): boolean {
    return this.notches.includes(this.pos);
  }
  step(): void {
    this.pos = (this.pos + 1) % 26;
  }
  in(c: number): number {
    const shift = this.pos - this.ring;
    return ((((this.forward[(((c + shift) % 26) + 26) % 26] as number) - shift) % 26) + 26) % 26;
  }
  out(c: number): number {
    const shift = this.pos - this.ring;
    return ((((this.backward[(((c + shift) % 26) + 26) % 26] as number) - shift) % 26) + 26) % 26;
  }
}

function pairs(spec: string, name: string): number[] {
  const map = Array.from({ length: 26 }, (_, i) => i);
  for (const pair of spec.toUpperCase().split(/\s+/).filter(Boolean)) {
    if (!/^[A-Z]{2}$/.test(pair)) throw new OpError(`${name} pairs are two letters, such as "AB": "${pair}" is not.`);
    const a = pair.charCodeAt(0) - 65;
    const b = pair.charCodeAt(1) - 65;
    if (map[a] !== a || map[b] !== b) throw new OpError(`Each letter can appear in only one ${name.toLowerCase()} pair.`);
    map[a] = b;
    map[b] = a;
  }
  return map;
}

function enigma(text: string, a: Args): string {
  const letter = (key: string) => Math.max(0, LETTERS.indexOf(sArg(a, key)));
  const fourRotor = sArg(a, 'model') === '4-rotor';
  const rotors = [
    new Rotor(sArg(a, 'right'), letter('rightRing'), letter('rightPos')),
    new Rotor(sArg(a, 'middle'), letter('middleRing'), letter('middlePos')),
    new Rotor(sArg(a, 'left'), letter('leftRing'), letter('leftPos')),
  ];
  const fourth = fourRotor ? new Rotor(`${sArg(a, 'fourth')}<`, letter('fourthRing'), letter('fourthPos')) : null;
  const reflector = pairs(sArg(a, 'reflector'), 'Reflector');
  if (reflector.some((to, from) => to === from)) throw new OpError('The reflector must pair all 26 letters.');
  const plugboard = pairs(sArg(a, 'plugboard'), 'Plugboard');
  const [right, middle, left] = rotors as [Rotor, Rotor, Rotor];
  let out = '';
  for (const ch of text) {
    const upper = ch.toUpperCase();
    const code = upper.charCodeAt(0) - 65;
    if (code < 0 || code > 25 || upper.length !== 1) {
      if (!bArg(a, 'strict')) out += ch;
      continue;
    }
    if (middle.atNotch()) {
      middle.step();
      left.step();
    } else if (right.atNotch()) middle.step();
    right.step();
    let c = plugboard[code] as number;
    c = left.in(middle.in(right.in(c)));
    if (fourth) c = fourth.in(c);
    c = reflector[c] as number;
    if (fourth) c = fourth.out(c);
    c = right.out(middle.out(left.out(c)));
    out += String.fromCharCode((plugboard[c] as number) + 65);
  }
  return bArg(a, 'strict') ? (out.match(/.{1,5}/g) ?? []).join(' ') : out;
}

/* --------------------------------------------------- Flask sessions -- */

const b64urlDecode = (text: string) => base64Decode(text, 'A-Za-z0-9\\-_');
const b64urlEncode = (bytes: Uint8Array) => base64Encode(bytes, 'A-Za-z0-9\\-_');

async function flaskSignature(value: string, args: Args): Promise<Uint8Array> {
  const { hmac } = await import('@noble/hashes/hmac.js');
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const { sha1 } = await import('@noble/hashes/legacy.js');
  const hash = sArg(args, 'algorithm') === 'sha256' ? sha256 : sha1;
  const derived = hmac(hash, keyArg(args, 'key'), keyArg(args, 'salt'));
  return hmac(hash, derived, utf8(value));
}

async function flaskDecode(cookie: string, showTime: boolean): Promise<string> {
  const text = cookie.trim();
  const compressed = text.startsWith('.');
  const parts = (compressed ? text.slice(1) : text).split('.');
  if (parts.length < 3) throw new OpError('A Flask session cookie has three dot-separated parts.');
  let payload = b64urlDecode(parts[0] ?? '');
  if (compressed) payload = (await import('fflate')).unzlibSync(payload);
  const data = JSON.parse(new TextDecoder().decode(payload)) as unknown;
  if (!showTime) return JSON.stringify(data, null, 4);
  let seconds = 0;
  for (const b of b64urlDecode(parts[1] ?? '')) seconds = seconds * 256 + b;
  return JSON.stringify({ payload: data, timestamp: new Date(seconds * 1000).toISOString() }, null, 4);
}

/* -------------------------------------------------------------- primes -- */

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function randomBig(bits: number): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(bits / 8)));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n & ((1n << BigInt(bits)) - 1n);
}

export function isProbablePrime(n: bigint, rounds = 20): boolean {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let r = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    r++;
  }
  const bits = n.toString(2).length;
  outer: for (let i = 0; i < rounds; i++) {
    const a = 2n + (randomBig(bits) % (n - 3n));
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let j = 1; j < r; j++) {
      x = (x * x) % n;
      if (x === n - 1n) continue outer;
    }
    return false;
  }
  return true;
}

/* ---------------------------------------------------------- operations -- */

const blockArgs = (enc: boolean, modes: readonly string[]) => [
  keyed('key', 'Key', 'Hex'),
  keyed('iv', 'IV', 'Hex'),
  sel('mode', 'Mode', modes),
  sel('input', 'Input', enc ? ['Raw', 'Hex'] : ['Hex', 'Raw']),
  sel('output', 'Output', enc ? ['Hex', 'Raw'] : ['Raw', 'Hex']),
];
const CJS_MODES = ['CBC', 'CFB', 'OFB', 'CTR', 'ECB'];
const CJS_DEC_MODES = [...CJS_MODES, 'CBC/NoPadding', 'ECB/NoPadding'];
const TEA_PAD = sel('padding', 'Padding', ['PKCS5', 'NO', 'ZERO', 'RANDOM', 'BIT']);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function brute(lines: string[], crib: string): string {
  return (crib ? lines.filter((line) => line.includes(crib)) : lines).join('\n');
}

function stream(name: string, nonceLabel: string): Operation {
  return defineOp({
    name,
    category: C,
    description: `${name} stream cipher (encryption and decryption are the same operation).`,
    input: 'text',
    output: 'text',
    args: [
      keyed('key', 'Key', 'Hex'),
      keyed('nonce', nonceLabel, 'Hex'),
      num('counter', 'Counter', 0, { min: 0 }),
      sel('rounds', 'Rounds', ['20', '12', '8']),
      sel('input', 'Input', ['Hex', 'Raw']),
      sel('output', 'Output', ['Raw', 'Hex']),
    ],
    run: async (input, a) => {
      const key = keyArg(a, 'key');
      const nonce = keyArg(a, 'nonce');
      const rounds = sArg(a, 'rounds');
      const counter = nArg(a, 'counter');
      const data = inputBytes(input, sArg(a, 'input'));
      if (key.length !== 32 && !(name === 'Salsa20' && key.length === 16)) throw new OpError(`${name} keys are 32 bytes${name === 'Salsa20' ? ' (or 16)' : ''}; this one is ${key.length}.`);
      let out: Uint8Array;
      if (name === 'ChaCha') {
        const c = await import('@noble/ciphers/chacha.js');
        if (rounds !== '20' && nonce.length !== 12) throw new OpError('8 and 12 rounds need a 12-byte nonce.');
        const fn = rounds === '8' ? c.chacha8 : rounds === '12' ? c.chacha12 : nonce.length === 8 ? c.chacha20orig : nonce.length === 24 ? c.xchacha20 : c.chacha20;
        if (![8, 12, 24].includes(nonce.length)) throw new OpError('ChaCha nonces are 8, 12 or 24 bytes.');
        out = fn(key, nonce, data, undefined, counter);
      } else {
        const s = await import('@noble/ciphers/salsa.js');
        if (rounds !== '20') throw new OpError(`Only 20 rounds of ${name} are supported.`);
        const want = name === 'Salsa20' ? 8 : 24;
        if (nonce.length !== want) throw new OpError(`${name} nonces are ${want} bytes.`);
        out = (name === 'Salsa20' ? s.salsa20 : s.xsalsa20)(key.length === 16 ? Uint8Array.from([...key, ...key]) : key, nonce, data, undefined, counter);
      }
      return outputText(out, sArg(a, 'output'));
    },
  });
}

export const encryptionOps: Operation[] = [
  defineOp({
    name: 'AES Encrypt',
    category: C,
    description: 'Encrypts with AES (128, 192 or 256-bit key) in CBC, CFB, OFB, CTR, GCM or ECB mode.',
    input: 'text',
    output: 'text',
    keywords: ['rijndael', 'cipher'],
    args: [
      keyed('key', 'Key', 'Hex'),
      keyed('iv', 'IV', 'Hex'),
      sel('mode', 'Mode', AES_MODES),
      sel('input', 'Input', ['Raw', 'Hex']),
      sel('output', 'Output', ['Hex', 'Raw']),
      keyed('aad', 'Additional Authenticated Data', 'Hex', undefined, { showIf: (a) => a.mode === 'GCM' }),
      sel('includeIv', 'Include IV in output', ['Off', 'Prepend', 'Append']),
    ],
    run: (input, a) => aes(true, input, a),
  }),
  defineOp({
    name: 'AES Decrypt',
    category: C,
    description: 'Decrypts AES in CBC, CFB, OFB, CTR, GCM or ECB mode.',
    input: 'text',
    output: 'text',
    keywords: ['rijndael', 'cipher'],
    args: [
      keyed('key', 'Key', 'Hex'),
      keyed('iv', 'IV', 'Hex'),
      num('ivLength', 'IV Length', 16, { min: 1, showIf: (a) => a.ivFrom !== 'Off' }),
      sel('mode', 'Mode', AES_MODES),
      sel('input', 'Input', ['Hex', 'Raw']),
      sel('output', 'Output', ['Raw', 'Hex']),
      keyed('tag', 'GCM Tag', 'Hex', undefined, { showIf: (a) => a.mode === 'GCM' }),
      keyed('aad', 'Additional Authenticated Data', 'Hex', undefined, { showIf: (a) => a.mode === 'GCM' }),
      sel('ivFrom', 'IV from input', ['Off', 'Prepend', 'Append']),
    ],
    run: (input, a) => aes(false, input, a),
  }),
  defineOp({
    name: 'Blowfish Encrypt',
    category: C,
    description: 'Encrypts with Blowfish (64-bit blocks, 4–56 byte key).',
    input: 'text',
    output: 'text',
    args: blockArgs(true, CJS_MODES),
    run: (input, a) => cryptoJsCipher('Blowfish', true, input, a, range(4, 56), 8),
  }),
  defineOp({
    name: 'Blowfish Decrypt',
    category: C,
    description: 'Decrypts Blowfish.',
    input: 'text',
    output: 'text',
    args: blockArgs(false, CJS_MODES),
    run: (input, a) => cryptoJsCipher('Blowfish', false, input, a, range(4, 56), 8),
  }),
  defineOp({
    name: 'DES Encrypt',
    category: C,
    description: 'Encrypts with single DES (8-byte key). Obsolete: for old systems only.',
    input: 'text',
    output: 'text',
    args: blockArgs(true, CJS_MODES),
    run: (input, a) => cryptoJsCipher('DES', true, input, a, [8], 8),
  }),
  defineOp({
    name: 'DES Decrypt',
    category: C,
    description: 'Decrypts single DES.',
    input: 'text',
    output: 'text',
    args: blockArgs(false, CJS_DEC_MODES),
    run: (input, a) => cryptoJsCipher('DES', false, input, a, [8], 8),
  }),
  defineOp({
    name: 'Triple DES Encrypt',
    category: C,
    description: 'Encrypts with Triple DES (16 or 24-byte key).',
    input: 'text',
    output: 'text',
    keywords: ['3des', 'tdes'],
    args: blockArgs(true, CJS_MODES),
    run: (input, a) => cryptoJsCipher('TripleDES', true, input, a, [16, 24], 8),
  }),
  defineOp({
    name: 'Triple DES Decrypt',
    category: C,
    description: 'Decrypts Triple DES.',
    input: 'text',
    output: 'text',
    keywords: ['3des', 'tdes'],
    args: blockArgs(false, CJS_DEC_MODES),
    run: (input, a) => cryptoJsCipher('TripleDES', false, input, a, [16, 24], 8),
  }),
  defineOp({
    name: 'Fernet Encrypt',
    category: C,
    description: 'Encrypts a message as a Fernet token (AES-128-CBC with HMAC-SHA256), as used by Python cryptography.',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [str('key', 'Key', '', { placeholder: 'URL-safe Base64, 32 bytes' })],
    run: async (input, a) => {
      const key = b64urlDecode(sArg(a, 'key'));
      if (key.length !== 32) throw new OpError('A Fernet key is 32 bytes of URL-safe Base64 (44 characters).');
      const { cbc } = await import('@noble/ciphers/aes.js');
      const { hmac } = await import('@noble/hashes/hmac.js');
      const { sha256 } = await import('@noble/hashes/sha2.js');
      const iv = crypto.getRandomValues(new Uint8Array(16));
      const time = new Uint8Array(8);
      new DataView(time.buffer).setBigUint64(0, BigInt(Math.floor(Date.now() / 1000)));
      const body = Uint8Array.from([0x80, ...time, ...iv, ...cbc(key.slice(16), iv).encrypt(utf8(input))]);
      const mac = hmac(sha256, key.slice(0, 16), body);
      return b64urlEncode(Uint8Array.from([...body, ...mac]));
    },
  }),
  defineOp({
    name: 'Fernet Decrypt',
    category: C,
    description: 'Checks and decrypts a Fernet token.',
    input: 'text',
    output: 'text',
    args: [str('key', 'Key', '')],
    run: async (input, a) => {
      const key = b64urlDecode(sArg(a, 'key'));
      if (key.length !== 32) throw new OpError('A Fernet key is 32 bytes of URL-safe Base64 (44 characters).');
      const token = b64urlDecode(input.trim());
      if (token[0] !== 0x80 || token.length < 57) throw new OpError('This is not a Fernet token.');
      const { cbc } = await import('@noble/ciphers/aes.js');
      const { hmac } = await import('@noble/hashes/hmac.js');
      const { sha256 } = await import('@noble/hashes/sha2.js');
      const body = token.slice(0, token.length - 32);
      const mac = hmac(sha256, key.slice(0, 16), body);
      if (hex(mac) !== hex(token.slice(token.length - 32))) throw new OpError('The token signature does not match this key.');
      return new TextDecoder().decode(cbc(key.slice(16), body.slice(9, 25)).decrypt(body.slice(25)));
    },
  }),
  defineOp({
    name: 'RC4',
    category: C,
    description: 'RC4 stream cipher (also known as ARC4). Insecure; for analysing old data.',
    input: 'text',
    output: 'text',
    keywords: ['arc4', 'arcfour'],
    args: [keyed('key', 'Passphrase', 'UTF8'), sel('inFormat', 'Input format', XOR_FORMATS), sel('outFormat', 'Output format', XOR_FORMATS)],
    run: (input, a) => toFormat(rc4(keyArg(a, 'key'), fromFormat(input, sArg(a, 'inFormat'))), sArg(a, 'outFormat')),
  }),
  defineOp({
    name: 'RC4 Drop',
    category: C,
    description: 'RC4 that discards the first part of the keystream.',
    input: 'text',
    output: 'text',
    args: [keyed('key', 'Passphrase', 'UTF8'), sel('inFormat', 'Input format', XOR_FORMATS), sel('outFormat', 'Output format', XOR_FORMATS), num('drop', 'Number of dwords to drop', 192, { min: 0 })],
    run: (input, a) => toFormat(rc4(keyArg(a, 'key'), fromFormat(input, sArg(a, 'inFormat')), nArg(a, 'drop') * 4), sArg(a, 'outFormat')),
  }),
  stream('ChaCha', 'Nonce'),
  stream('Salsa20', 'Nonce'),
  stream('XSalsa20', 'Nonce'),
  defineOp({
    name: 'Rabbit',
    category: C,
    description: 'Rabbit stream cipher (16-byte key, optional 8-byte IV).',
    input: 'text',
    output: 'text',
    args: [keyed('key', 'Key', 'Hex'), keyed('iv', 'IV', 'Hex'), sel('input', 'Input', ['Raw', 'Hex']), sel('output', 'Output', ['Raw', 'Hex'])],
    run: async (input, a) => {
      const CJ = cjs(await import('crypto-js')) as unknown as CryptoJS;
      const key = keyArg(a, 'key');
      const iv = keyArg(a, 'iv');
      if (key.length !== 16) throw new OpError('Rabbit keys are 16 bytes.');
      if (iv.length !== 0 && iv.length !== 8) throw new OpError('The Rabbit IV is 8 bytes (or empty).');
      const options = iv.length ? { iv: toWords(CJ, iv) } : {};
      const rabbit = CJ.Rabbit as unknown as { encrypt: (m: unknown, k: unknown, o: unknown) => { ciphertext: WordArray } };
      return outputText(fromWords(rabbit.encrypt(toWords(CJ, inputBytes(input, sArg(a, 'input'))), toWords(CJ, key), options).ciphertext), sArg(a, 'output'));
    },
  }),
  defineOp({
    name: 'ROT13',
    category: C,
    also: ['Arithmetic / Logic'],
    description: 'Shifts letters (and optionally digits) by a set amount; 13 swaps the alphabet halves.',
    input: 'bytes',
    output: 'bytes',
    keywords: ['caesar', 'rotate'],
    args: [bool('lower', 'Rotate lower case chars', true), bool('upper', 'Rotate upper case chars', true), bool('numbers', 'Rotate numbers'), num('amount', 'Amount', 13)],
    run: (input, a) => rot(input, nArg(a, 'amount'), bArg(a, 'lower'), bArg(a, 'upper'), bArg(a, 'numbers')),
  }),
  defineOp({
    name: 'ROT13 Brute Force',
    category: C,
    description: 'Tries every rotation and lists the results.',
    input: 'bytes',
    output: 'text',
    keywords: ['caesar'],
    args: [
      bool('lower', 'Rotate lower case chars', true),
      bool('upper', 'Rotate upper case chars', true),
      bool('numbers', 'Rotate numbers'),
      num('length', 'Sample length', 100, { min: 1 }),
      num('offset', 'Sample offset', 0, { min: 0 }),
      bool('print', 'Print amount', true),
      str('crib', 'Crib (known plaintext string)', ''),
    ],
    run: (input, a) => {
      const sample = input.slice(nArg(a, 'offset'), nArg(a, 'offset') + nArg(a, 'length'));
      const lines: string[] = [];
      for (let amount = 1; amount < 26; amount++) {
        const text = bytesToLatin1(rot(sample, amount, bArg(a, 'lower'), bArg(a, 'upper'), bArg(a, 'numbers')));
        lines.push(bArg(a, 'print') ? `Amount = ${String(amount).padStart(2)}: ${text}` : text);
      }
      return brute(lines, sArg(a, 'crib'));
    },
  }),
  defineOp({
    name: 'ROT47',
    category: C,
    description: 'Shifts printable ASCII characters (! to ~) by a set amount.',
    input: 'bytes',
    output: 'bytes',
    args: [num('amount', 'Amount', 47)],
    run: (input, a) => rot47(input, nArg(a, 'amount')),
  }),
  defineOp({
    name: 'ROT47 Brute Force',
    category: C,
    description: 'Tries every ROT47 amount and lists the results.',
    input: 'bytes',
    output: 'text',
    args: [num('length', 'Sample length', 100, { min: 1 }), num('offset', 'Sample offset', 0, { min: 0 }), bool('print', 'Print amount', true), str('crib', 'Crib (known plaintext string)', '')],
    run: (input, a) => {
      const sample = input.slice(nArg(a, 'offset'), nArg(a, 'offset') + nArg(a, 'length'));
      const lines: string[] = [];
      for (let amount = 1; amount < 94; amount++) {
        const text = bytesToLatin1(rot47(sample, amount));
        lines.push(bArg(a, 'print') ? `Amount = ${String(amount).padStart(2)}: ${text}` : text);
      }
      return brute(lines, sArg(a, 'crib'));
    },
  }),
  defineOp({
    name: 'ROT8000',
    category: C,
    also: ['Arithmetic / Logic'],
    description: 'Rotates every printable Unicode character by half of the Basic Multilingual Plane.',
    input: 'text',
    output: 'text',
    run: (input) => rot8000(input),
  }),
  defineOp({
    name: 'XOR',
    category: C,
    also: ['Arithmetic / Logic'],
    description: 'XORs the data with a repeating key.',
    input: 'bytes',
    output: 'bytes',
    args: [keyed('key', 'Key', 'Hex'), sel('scheme', 'Scheme', ['Standard', 'Input differential', 'Output differential', 'Cascade']), bool('nullPreserving', 'Null preserving')],
    run: (input, a) => xorBytes(input, keyArg(a, 'key'), sArg(a, 'scheme'), bArg(a, 'nullPreserving')),
  }),
  defineOp({
    name: 'XOR Brute Force',
    category: C,
    also: ['Arithmetic / Logic'],
    description: 'Tries every key of a given length (1 or 2 bytes) and lists the results, optionally only those containing a crib.',
    input: 'bytes',
    output: 'text',
    args: [
      num('keyLength', 'Key length', 1, { min: 1, max: 2 }),
      num('length', 'Sample length', 100, { min: 1 }),
      num('offset', 'Sample offset', 0, { min: 0 }),
      sel('scheme', 'Scheme', ['Standard', 'Input differential', 'Output differential']),
      bool('nullPreserving', 'Null preserving'),
      bool('print', 'Print key', true),
      bool('hex', 'Output as hex'),
      str('crib', 'Crib (known plaintext string)', ''),
    ],
    run: (input, a) => {
      const sample = input.slice(nArg(a, 'offset'), nArg(a, 'offset') + nArg(a, 'length'));
      const keyLength = Math.min(2, Math.max(1, nArg(a, 'keyLength')));
      const crib = unescapeShort(sArg(a, 'crib')).toLowerCase();
      const lines: string[] = [];
      for (let k = 1; k < 256 ** keyLength; k++) {
        const key = keyLength === 1 ? Uint8Array.of(k) : Uint8Array.of(k >> 8, k & 255);
        const result = xorBytes(sample, key, sArg(a, 'scheme'), bArg(a, 'nullPreserving'));
        const text = bArg(a, 'hex') ? hex(result) : bytesToLatin1(result);
        if (crib && !bytesToLatin1(result).toLowerCase().includes(crib)) continue;
        lines.push(bArg(a, 'print') ? `Key = ${hex(key)}: ${text}` : text);
      }
      return lines.join('\n');
    },
  }),
  defineOp({
    name: 'Vigenère Encode',
    category: C,
    description: 'Encodes with the Vigenère cipher.',
    input: 'text',
    output: 'text',
    keywords: ['vigenere'],
    args: [str('key', 'Key', '')],
    run: (input, a) => vigenere(input, sArg(a, 'key'), false),
  }),
  defineOp({
    name: 'Vigenère Decode',
    category: C,
    description: 'Decodes the Vigenère cipher.',
    input: 'text',
    output: 'text',
    keywords: ['vigenere'],
    args: [str('key', 'Key', '')],
    run: (input, a) => vigenere(input, sArg(a, 'key'), true),
  }),
  ...(['TEA', 'XTEA'] as const).flatMap((name) =>
    [true, false].map((enc) =>
      defineOp({
        name: `${name} ${enc ? 'Encrypt' : 'Decrypt'}`,
        category: C,
        description: `${enc ? 'Encrypts' : 'Decrypts'} with the ${name === 'TEA' ? 'Tiny Encryption Algorithm' : 'extended Tiny Encryption Algorithm'} (64-bit blocks, 16-byte key).`,
        input: 'text',
        output: 'text',
        args: [...blockArgs(enc, CJS_MODES), TEA_PAD, ...(name === 'XTEA' ? [num('rounds', 'Rounds', 32, { min: 1 })] : [])],
        run: (input, a) => {
          const key = teaKey(keyArg(a, 'key'));
          const rounds = nArg(a, 'rounds') || 32;
          const e = name === 'TEA' ? teaBlock(key, false) : xteaBlock(key, rounds, false);
          const d = name === 'TEA' ? teaBlock(key, true) : xteaBlock(key, rounds, true);
          return outputText(blockModes(e, d, 8, sArg(a, 'mode'), keyArg(a, 'iv'), inputBytes(input, sArg(a, 'input')), enc, sArg(a, 'padding')), sArg(a, 'output'));
        },
      }),
    ),
  ),
  defineOp({
    name: 'XXTEA Encrypt',
    category: C,
    description: 'Encrypts with Corrected Block TEA (XXTEA). Input shorter than 8 bytes is padded with zeros.',
    input: 'bytes',
    output: 'bytes',
    args: [keyed('key', 'Key', 'UTF8')],
    run: (input, a) => xxtea(input, keyArg(a, 'key'), false),
  }),
  defineOp({
    name: 'XXTEA Decrypt',
    category: C,
    description: 'Decrypts Corrected Block TEA (XXTEA).',
    input: 'bytes',
    output: 'bytes',
    args: [keyed('key', 'Key', 'UTF8')],
    run: (input, a) => xxtea(input, keyArg(a, 'key'), true),
  }),
  defineOp({
    name: 'To Morse Code',
    category: C,
    description: 'Writes text in Morse code.',
    input: 'text',
    output: 'text',
    args: [sel('format', 'Format options', ['-/.', '_/.', 'Dash/Dot', 'DASH/DOT', 'dash/dot']), sel('letter', 'Letter delimiter', LETTER_DELIMS), sel('word', 'Word delimiter', WORD_DELIMS)],
    run: (input, a) => {
      const format = sArg(a, 'format');
      const [dash, dot] = format === '-/.' ? ['-', '.'] : format === '_/.' ? ['_', '.'] : format === 'Dash/Dot' ? ['Dash', 'Dot'] : format === 'DASH/DOT' ? ['DASH', 'DOT'] : ['dash', 'dot'];
      const letterSep = delimiter(sArg(a, 'letter'));
      const words = input
        .toUpperCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) =>
          Array.from(word, (ch) => MORSE[ch])
            .filter((code): code is string => code !== undefined)
            .map((code) => Array.from(code, (s) => (s === '-' ? dash : dot)).join(dash.length > 1 ? ' ' : ''))
            .join(letterSep),
        );
      return words.join(delimiter(sArg(a, 'word')));
    },
  }),
  defineOp({
    name: 'From Morse Code',
    category: C,
    description: 'Reads Morse code back into text.',
    input: 'text',
    output: 'text',
    args: [sel('letter', 'Letter delimiter', LETTER_DELIMS), sel('word', 'Word delimiter', WORD_DELIMS)],
    magic: [{ pattern: /(?:^[-. \n]{5,}$|^[_. \n]{5,}$|^(?:dash|dot| |\n){5,}$)/i }],
    run: (input, a) => {
      const reverse = new Map(Object.entries(MORSE).map(([ch, code]) => [code, ch]));
      const normal = input
        .replace(/dash/gi, '-')
        .replace(/dot/gi, '.')
        .replace(/_/g, '-')
        .replace(/(?<=[-.]) (?=[-.])/g, sArg(a, 'letter') === 'Space' && /dash|dot/i.test(input) ? '' : ' ');
      return normal
        .split(delimiter(sArg(a, 'word')))
        .map((word) =>
          word
            .split(delimiter(sArg(a, 'letter')))
            .map((code) => reverse.get(code.trim()) ?? '')
            .join(''),
        )
        .join(' ');
    },
  }),
  defineOp({
    name: 'Bacon Cipher Encode',
    category: C,
    description: "Encodes letters with Francis Bacon's five-symbol cipher.",
    input: 'text',
    output: 'text',
    args: [sel('alphabet', 'Alphabet', Object.keys(BACON)), sel('translation', 'Translation', ['0/1', 'A/B']), bool('keep', 'Keep extra characters'), bool('invert', 'Invert Translation')],
    run: (input, a) => {
      const alphabet = BACON[sArg(a, 'alphabet')] ?? '';
      const [zero, one] = sArg(a, 'translation') === 'A/B' ? ['A', 'B'] : ['0', '1'];
      const [z, o] = bArg(a, 'invert') ? [one, zero] : [zero, one];
      const out: string[] = [];
      for (const raw of input.toUpperCase()) {
        let ch = raw;
        if (alphabet.length === 24) ch = ch.replace('J', 'I').replace('V', 'U');
        const index = alphabet.indexOf(ch);
        if (index === -1) {
          if (bArg(a, 'keep')) out.push(raw);
          continue;
        }
        out.push(
          index
            .toString(2)
            .padStart(5, '0')
            .replace(/0/g, z as string)
            .replace(/1/g, o as string),
        );
      }
      return out.join(bArg(a, 'keep') ? '' : ' ');
    },
  }),
  defineOp({
    name: 'Bacon Cipher Decode',
    category: C,
    description: "Decodes Francis Bacon's cipher, from 0/1, A/B, letter case or first-half/second-half letters.",
    input: 'text',
    output: 'text',
    args: [sel('alphabet', 'Alphabet', Object.keys(BACON)), sel('translation', 'Translation', ['0/1', 'A/B', 'Case', 'A-M/N-Z first letter']), bool('invert', 'Invert Translation')],
    magic: [{ pattern: /^\s*([01]{5}\s?)+$/ }, { pattern: /^\s*([AB]{5}\s?)+$/, args: { translation: 'A/B' } }],
    run: (input, a) => {
      const alphabet = BACON[sArg(a, 'alphabet')] ?? '';
      const translation = sArg(a, 'translation');
      let bits: string;
      if (translation === 'Case') bits = Array.from(input.replace(/[^a-z]/gi, ''), (ch) => (ch === ch.toUpperCase() ? '1' : '0')).join('');
      else if (translation === 'A-M/N-Z first letter')
        bits = input
          .split(/\s+/)
          .filter(Boolean)
          .map((word) => (/^[n-z]/i.test(word) ? '1' : '0'))
          .join('');
      else
        bits = input
          .toUpperCase()
          .replace(translation === 'A/B' ? /[^AB]/g : /[^01]/g, '')
          .replace(/A/g, '0')
          .replace(/B/g, '1');
      if (bArg(a, 'invert')) bits = bits.replace(/[01]/g, (b) => (b === '0' ? '1' : '0'));
      return (bits.match(/.{5}/g) ?? []).map((group) => alphabet[Number.parseInt(group, 2)] ?? '?').join('');
    },
  }),
  defineOp({
    name: 'Bifid Cipher Encode',
    category: C,
    description: 'Encodes with the Bifid cipher using a keyword Polybius square (I and J share a cell).',
    input: 'text',
    output: 'text',
    args: [str('keyword', 'Keyword', '')],
    run: (input, a) => bifid(input, sArg(a, 'keyword'), false),
  }),
  defineOp({
    name: 'Bifid Cipher Decode',
    category: C,
    description: 'Decodes the Bifid cipher.',
    input: 'text',
    output: 'text',
    args: [str('keyword', 'Keyword', '')],
    run: (input, a) => bifid(input, sArg(a, 'keyword'), true),
  }),
  defineOp({
    name: 'Caesar Box Cipher',
    category: C,
    description: 'Writes the text down columns of a set height and reads it back across the rows.',
    input: 'text',
    output: 'text',
    args: [num('height', 'Box Height', 1, { min: 1 })],
    run: (input, a) => {
      const text = input.replace(/\s/g, '');
      const height = Math.max(1, nArg(a, 'height'));
      const width = Math.ceil(text.length / height);
      let out = '';
      for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) out += text[col * height + row] ?? '';
      return out;
    },
  }),
  defineOp({
    name: 'Affine Cipher Encode',
    category: C,
    description: 'Encodes letters as (a × x + b) mod 26.',
    input: 'text',
    output: 'text',
    args: [num('a', 'a', 1), num('b', 'b', 0)],
    run: (input, args) => affine(input, nArg(args, 'a'), nArg(args, 'b'), false),
  }),
  defineOp({
    name: 'Affine Cipher Decode',
    category: C,
    description: 'Decodes the affine cipher.',
    input: 'text',
    output: 'text',
    args: [num('a', 'a', 1), num('b', 'b', 0)],
    run: (input, args) => affine(input, nArg(args, 'a'), nArg(args, 'b'), true),
  }),
  defineOp({
    name: 'Atbash Cipher',
    category: C,
    description: 'Reverses the alphabet: A↔Z, B↔Y and so on.',
    input: 'text',
    output: 'text',
    run: (input) => affine(input, 25, 25, false),
  }),
  defineOp({
    name: 'A1Z26 Cipher Encode',
    category: C,
    description: 'Replaces each letter with its position in the alphabet.',
    input: 'text',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', [...DELIMITERS])],
    run: (input, a) =>
      Array.from(input.toLowerCase())
        .map((ch) => LOWER.indexOf(ch))
        .filter((i) => i !== -1)
        .map((i) => i + 1)
        .join(delimiter(sArg(a, 'delimiter'))),
  }),
  defineOp({
    name: 'A1Z26 Cipher Decode',
    category: C,
    description: 'Turns alphabet positions (1–26) back into letters.',
    input: 'text',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', [...DELIMITERS])],
    magic: [{ pattern: /^\s*((?:0?[1-9]|1[0-9]|2[0-6]) )+(?:0?[1-9]|1[0-9]|2[0-6])\s*$/ }],
    run: (input, a) =>
      input
        .trim()
        .split(delimiter(sArg(a, 'delimiter')))
        .map((n) => LOWER[Number(n) - 1] ?? '')
        .join(''),
  }),
  defineOp({
    name: 'Rail Fence Cipher Encode',
    category: C,
    description: 'Writes the text in a zigzag across a number of rails and reads each rail in turn.',
    input: 'text',
    output: 'text',
    args: [num('key', 'Key', 2, { min: 2 }), num('offset', 'Offset', 0, { min: 0 })],
    run: (input, a) => railFence(input, nArg(a, 'key'), nArg(a, 'offset'), false),
  }),
  defineOp({
    name: 'Rail Fence Cipher Decode',
    category: C,
    description: 'Decodes the rail fence cipher.',
    input: 'text',
    output: 'text',
    args: [num('key', 'Key', 2, { min: 2 }), num('offset', 'Offset', 0, { min: 0 })],
    run: (input, a) => railFence(input, nArg(a, 'key'), nArg(a, 'offset'), true),
  }),
  defineOp({
    name: 'CipherSaber2 Encrypt',
    category: C,
    description: 'CipherSaber-2: RC4 with a random 10-byte IV prepended and a repeated key schedule.',
    input: 'bytes',
    output: 'bytes',
    volatile: true,
    args: [keyed('key', 'Key', 'UTF8'), num('rounds', 'Rounds', 20, { min: 1 })],
    run: (input, a) => {
      const iv = crypto.getRandomValues(new Uint8Array(10));
      return Uint8Array.from([...iv, ...rc4(Uint8Array.from([...keyArg(a, 'key'), ...iv]), input, 0, nArg(a, 'rounds'))]);
    },
  }),
  defineOp({
    name: 'CipherSaber2 Decrypt',
    category: C,
    description: 'Decrypts CipherSaber-2.',
    input: 'bytes',
    output: 'bytes',
    args: [keyed('key', 'Key', 'UTF8'), num('rounds', 'Rounds', 20, { min: 1 })],
    run: (input, a) => rc4(Uint8Array.from([...keyArg(a, 'key'), ...input.slice(0, 10)]), input.slice(10), 0, nArg(a, 'rounds')),
  }),
  defineOp({
    name: 'Cetacean Cipher Encode',
    category: C,
    description: 'Writes each character as 16 "e"s and "E"s (its binary code), the way whales would.',
    input: 'text',
    output: 'text',
    run: (input) =>
      input
        .split(' ')
        .map((word) => Array.from(word, (ch) => ch.charCodeAt(0).toString(2).padStart(16, '0').replace(/0/g, 'e').replace(/1/g, 'E')).join(''))
        .join(' '),
  }),
  defineOp({
    name: 'Cetacean Cipher Decode',
    category: C,
    description: 'Decodes the Cetacean cipher.',
    input: 'text',
    output: 'text',
    magic: [{ pattern: /^(?:[eE]{16,})(?: [eE]{16,})*$/ }],
    run: (input) =>
      input
        .trim()
        .split(' ')
        .map((word) => (word.match(/.{16}/g) ?? []).map((bits) => String.fromCharCode(Number.parseInt(bits.replace(/e/g, '0').replace(/E/g, '1'), 2))).join(''))
        .join(' '),
  }),
  defineOp({
    name: 'Substitute',
    category: C,
    description: 'Replaces each character of one alphabet with the matching character of another.',
    input: 'text',
    output: 'text',
    args: [str('plain', 'Plaintext', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), str('cipher', 'Ciphertext', 'XYZABCDEFGHIJKLMNOPQRSTUVW'), bool('ignoreCase', 'Ignore case')],
    run: (input, a) => {
      const plain = Array.from(unescapeShort(sArg(a, 'plain')));
      const cipher = Array.from(unescapeShort(sArg(a, 'cipher')));
      const map = new Map<string, string>();
      plain.forEach((ch, i) => {
        if (cipher[i] === undefined) return;
        map.set(ch, cipher[i] as string);
        if (bArg(a, 'ignoreCase')) {
          map.set(ch.toLowerCase(), (cipher[i] as string).toLowerCase());
          map.set(ch.toUpperCase(), (cipher[i] as string).toUpperCase());
        }
      });
      return Array.from(input, (ch) => map.get(ch) ?? ch).join('');
    },
  }),
  defineOp({
    name: 'Derive PBKDF2 key',
    category: C,
    description: 'Derives a key from a passphrase with PBKDF2.',
    input: 'text',
    output: 'text',
    args: [
      keyed('passphrase', 'Passphrase', 'UTF8'),
      num('size', 'Key size', 128, { min: 8, step: 8 }),
      num('iterations', 'Iterations', 1, { min: 1 }),
      sel('hash', 'Hashing function', ['SHA1', 'SHA256', 'SHA384', 'SHA512', 'MD5']),
      keyed('salt', 'Salt', 'Hex'),
    ],
    run: async (_input, a) => {
      const { pbkdf2Async } = await import('@noble/hashes/pbkdf2.js');
      const hash = await hashFn(sArg(a, 'hash'));
      return hex(await pbkdf2Async(hash, keyArg(a, 'passphrase'), keyArg(a, 'salt'), { c: Math.max(1, nArg(a, 'iterations')), dkLen: Math.max(1, Math.floor(nArg(a, 'size') / 8)) }));
    },
  }),
  defineOp({
    name: 'Derive EVP key',
    category: C,
    description: "Derives a key the way OpenSSL's EVP_BytesToKey does.",
    input: 'text',
    output: 'text',
    args: [
      keyed('passphrase', 'Passphrase', 'UTF8'),
      num('size', 'Key size', 128, { min: 8, step: 8 }),
      num('iterations', 'Iterations', 1, { min: 1 }),
      sel('hash', 'Hashing function', ['SHA1', 'SHA256', 'SHA384', 'SHA512', 'MD5']),
      keyed('salt', 'Salt', 'Hex'),
    ],
    run: async (_input, a) => {
      const hash = await hashFn(sArg(a, 'hash'));
      const pass = keyArg(a, 'passphrase');
      const salt = keyArg(a, 'salt');
      const want = Math.max(1, Math.floor(nArg(a, 'size') / 8));
      const out: number[] = [];
      let block: Uint8Array = new Uint8Array(0);
      while (out.length < want) {
        block = hash(Uint8Array.from([...block, ...pass, ...salt]));
        for (let i = 1; i < nArg(a, 'iterations'); i++) block = hash(block);
        out.push(...block);
      }
      return hex(Uint8Array.from(out.slice(0, want)));
    },
  }),
  defineOp({
    name: 'Derive HKDF key',
    category: C,
    description: 'Derives key material with HKDF (RFC 5869).',
    input: 'bytes',
    output: 'text',
    args: [
      keyed('salt', 'Salt', 'Hex'),
      keyed('info', 'Info', 'Hex'),
      sel('hash', 'Hashing function', ['SHA1', 'SHA256', 'SHA384', 'SHA512', 'MD5'], 'SHA256'),
      sel('extract', 'Extract mode', ['with salt', 'no salt', 'skip']),
      num('length', 'L (number of output octets)', 16, { min: 1 }),
    ],
    run: async (input, a) => {
      const { extract, expand } = await import('@noble/hashes/hkdf.js');
      const hash = await hashFn(sArg(a, 'hash'));
      const mode = sArg(a, 'extract');
      const prk = mode === 'skip' ? input : extract(hash, input, mode === 'no salt' ? undefined : keyArg(a, 'salt'));
      return hex(expand(hash, prk, keyArg(a, 'info'), nArg(a, 'length')));
    },
  }),
  defineOp({
    name: 'Bcrypt',
    category: C,
    also: ['Hashing'],
    description: 'Hashes a password with bcrypt.',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [num('rounds', 'Rounds', 10, { min: 4, max: 16 })],
    run: async (input, a) => {
      const bcrypt = cjs(await import('bcryptjs'));
      return bcrypt.hash(input, Math.min(16, Math.max(4, nArg(a, 'rounds'))));
    },
  }),
  defineOp({
    name: 'Scrypt',
    category: C,
    also: ['Hashing'],
    description: 'Derives a key with scrypt.',
    input: 'text',
    output: 'text',
    args: [
      keyed('salt', 'Salt', 'Hex'),
      num('n', 'Iterations (N)', 16384, { min: 2 }),
      num('r', 'Memory factor (r)', 8, { min: 1 }),
      num('p', 'Parallelization factor (p)', 1, { min: 1 }),
      num('length', 'Key length', 64, { min: 1 }),
    ],
    run: async (input, a) => {
      const { scryptAsync } = await import('@noble/hashes/scrypt.js');
      return hex(await scryptAsync(toBytes(input), keyArg(a, 'salt'), { N: nArg(a, 'n'), r: nArg(a, 'r'), p: nArg(a, 'p'), dkLen: nArg(a, 'length') }));
    },
  }),
  defineOp({
    name: 'JWT Sign',
    category: C,
    description: 'Signs a JSON payload as a JSON Web Token (HMAC, RSA, RSA-PSS, ECDSA or EdDSA).',
    input: 'text',
    output: 'text',
    args: [
      txt('key', 'Private/Secret Key', 'secret'),
      sel('algorithm', 'Signing algorithm', ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA', 'none']),
      txt('header', 'Header', '{}'),
    ],
    run: async (input, a) => {
      const jws = await import('../../lib/jws');
      const algorithm = sArg(a, 'algorithm') as Parameters<typeof jws.signToken>[2];
      const header = { ...(JSON.parse(sArg(a, 'header') || '{}') as Record<string, unknown>), alg: algorithm, typ: 'JWT' };
      const kind = jws.keyKind(algorithm);
      const key = kind === 'secret' || kind === 'none' ? utf8(sArg(a, 'key')) : jws.readKey(sArg(a, 'key'));
      return jws.signToken(header, JSON.parse(input), algorithm, key);
    },
  }),
  defineOp({
    name: 'JWT Verify',
    category: C,
    description: 'Checks the signature of a JSON Web Token and shows its payload.',
    input: 'text',
    output: 'text',
    args: [txt('key', 'Public/Secret Key', 'secret')],
    run: async (input, a) => {
      const jws = await import('../../lib/jws');
      const token = jws.parseToken(input);
      const algorithm = token.header.alg;
      if (!jws.isAlgorithm(algorithm) || algorithm === 'none') throw new OpError('The token has no usable "alg" in its header.');
      const kind = jws.keyKind(algorithm);
      const key = kind === 'secret' ? utf8(sArg(a, 'key')) : jws.readKey(sArg(a, 'key'), token.header);
      const ok = await jws.verifyBytes(algorithm, key, utf8(token.signingInput), token.signature);
      if (!ok) throw new OpError('The signature does not match this key.');
      return JSON.stringify(token.payload, null, 4);
    },
  }),
  defineOp({
    name: 'JWT Decode',
    category: C,
    description: 'Shows the payload of a JSON Web Token without checking its signature.',
    input: 'text',
    output: 'text',
    magic: [{ pattern: /^ey([A-Za-z0-9_-]+)\.ey([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/ }],
    run: async (input) => JSON.stringify((await import('../../lib/jws')).parseToken(input).payload, null, 4),
  }),
  defineOp({
    name: 'Citrix CTX1 Encode',
    category: C,
    description: 'Obfuscates a password with Citrix CTX1 encoding.',
    input: 'text',
    output: 'text',
    run: (input) => {
      const out: number[] = [];
      let temp = 0;
      for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        for (const byte of [code & 255, code >> 8]) {
          temp = byte ^ 0xa5 ^ temp;
          out.push(((temp >>> 4) & 15) + 0x41, (temp & 15) + 0x41);
        }
      }
      return String.fromCharCode(...out);
    },
  }),
  defineOp({
    name: 'Citrix CTX1 Decode',
    category: C,
    description: 'Decodes a Citrix CTX1 password.',
    input: 'bytes',
    output: 'text',
    run: (input) => {
      if (input.length % 4 !== 0) throw new OpError('Incorrect hash length: CTX1 strings are a multiple of 4 characters.');
      const rev = Array.from(input).reverse();
      const out: number[] = [];
      for (let i = 0; i < rev.length; i += 2) {
        const previous = i + 2 >= rev.length ? 0 : (((rev[i + 2] as number) - 0x41) & 15) ^ ((((rev[i + 3] as number) - 0x41) << 4) & 0xf0);
        out.push((((rev[i] as number) - 0x41) & 15) ^ ((((rev[i + 1] as number) - 0x41) << 4) & 0xf0) ^ 0xa5 ^ previous);
      }
      out.reverse();
      let text = '';
      for (let i = 0; i + 1 < out.length; i += 2) text += String.fromCharCode((out[i] as number) | ((out[i + 1] as number) << 8));
      return text;
    },
  }),
  defineOp({
    name: 'AES Key Wrap',
    category: C,
    description: 'Wraps a key with AES Key Wrap (RFC 3394).',
    input: 'text',
    output: 'text',
    args: [keyed('kek', 'Key (KEK)', 'Hex'), keyed('iv', 'IV', 'Hex', undefined, { default: 'a6a6a6a6a6a6a6a6' }), sel('input', 'Input', ['Hex', 'Raw']), sel('output', 'Output', ['Hex', 'Raw'])],
    run: async (input, a) => outputText(await keyWrap(keyArg(a, 'kek'), keyArg(a, 'iv'), inputBytes(input, sArg(a, 'input')), true), sArg(a, 'output')),
  }),
  defineOp({
    name: 'AES Key Unwrap',
    category: C,
    description: 'Unwraps a key wrapped with AES Key Wrap (RFC 3394) and checks its integrity value.',
    input: 'text',
    output: 'text',
    args: [keyed('kek', 'Key (KEK)', 'Hex'), keyed('iv', 'IV', 'Hex', undefined, { default: 'a6a6a6a6a6a6a6a6' }), sel('input', 'Input', ['Hex', 'Raw']), sel('output', 'Output', ['Hex', 'Raw'])],
    run: async (input, a) => outputText(await keyWrap(keyArg(a, 'kek'), keyArg(a, 'iv'), inputBytes(input, sArg(a, 'input')), false), sArg(a, 'output')),
  }),
  defineOp({
    name: 'Pseudo-Random Number Generator',
    category: C,
    also: ['Utils', 'Other'],
    description: 'Generates cryptographically secure random bytes.',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [num('count', 'Number of bytes', 32, { min: 1, max: 65536 }), sel('as', 'Output as', ['Hex', 'Integer', 'Byte array', 'Raw'])],
    run: (_input, a) => {
      const bytes = crypto.getRandomValues(new Uint8Array(Math.min(65536, Math.max(1, nArg(a, 'count')))));
      const as = sArg(a, 'as');
      if (as === 'Integer') {
        let n = 0n;
        for (const b of bytes) n = (n << 8n) | BigInt(b);
        return n.toString();
      }
      if (as === 'Byte array') return `[${Array.from(bytes).join(',')}]`;
      if (as === 'Raw') return bytesToLatin1(bytes);
      return hex(bytes);
    },
  }),
  defineOp({
    name: 'Pseudo-Random Prime Generator',
    category: C,
    description: 'Generates a random probable prime of a given bit length (Miller–Rabin tested).',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [num('bits', 'Bit length', 512, { min: 8, max: 4096 }), bool('crypto', 'Crypto grade'), sel('format', 'Output format', ['Decimal', 'Hexadecimal'])],
    run: (_input, a) => {
      const bits = Math.min(4096, Math.max(8, nArg(a, 'bits')));
      for (let attempt = 0; attempt < 100000; attempt++) {
        const candidate = randomBig(bits) | (1n << BigInt(bits - 1)) | 1n;
        if (isProbablePrime(candidate, bArg(a, 'crypto') ? 64 : 20)) return sArg(a, 'format') === 'Hexadecimal' ? candidate.toString(16) : candidate.toString();
      }
      throw new OpError('No prime found; try again.');
    },
  }),
  defineOp({
    name: 'Enigma',
    category: C,
    description: 'Simulates the Enigma machine (3 or 4 rotors, rings, reflector and plugboard). Encryption and decryption are the same.',
    input: 'text',
    output: 'text',
    args: [
      sel('model', 'Model', ['3-rotor', '4-rotor']),
      editable('fourth', 'Left-most (4th) rotor', FOURTH, FOURTH[0]?.value, { showIf: (a) => a.model === '4-rotor' }),
      sel('fourthRing', 'Left-most rotor ring setting', LETTERS, 'A', { showIf: (a) => a.model === '4-rotor' }),
      sel('fourthPos', 'Left-most rotor initial value', LETTERS, 'A', { showIf: (a) => a.model === '4-rotor' }),
      editable('left', 'Left-hand rotor', ROTORS, ROTORS[0]?.value),
      sel('leftRing', 'Left-hand rotor ring setting', LETTERS),
      sel('leftPos', 'Left-hand rotor initial value', LETTERS),
      editable('middle', 'Middle rotor', ROTORS, ROTORS[1]?.value),
      sel('middleRing', 'Middle rotor ring setting', LETTERS),
      sel('middlePos', 'Middle rotor initial value', LETTERS),
      editable('right', 'Right-hand rotor', ROTORS, ROTORS[2]?.value),
      sel('rightRing', 'Right-hand rotor ring setting', LETTERS),
      sel('rightPos', 'Right-hand rotor initial value', LETTERS),
      editable('reflector', 'Reflector', REFLECTORS),
      str('plugboard', 'Plugboard', ''),
      bool('strict', 'Strict output', true),
    ],
    run: (input, a) => enigma(input, a),
  }),
  defineOp({
    name: 'Flask Session Decode',
    category: C,
    description: 'Shows the contents of a Flask session cookie without checking its signature.',
    input: 'text',
    output: 'text',
    args: [bool('time', 'View TimeStamp')],
    run: (input, a) => flaskDecode(input, bArg(a, 'time')),
  }),
  defineOp({
    name: 'Flask Session Sign',
    category: C,
    description: 'Signs a JSON object as a Flask session cookie (itsdangerous).',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [keyed('key', 'Key', 'UTF8'), keyed('salt', 'Salt', 'UTF8', undefined, { default: 'cookie-session' }), sel('algorithm', 'Algorithm', ['sha1', 'sha256'])],
    run: async (input, a) => {
      const payload = b64urlEncode(utf8(JSON.stringify(JSON.parse(input))));
      let seconds = Math.floor(Date.now() / 1000);
      const time: number[] = [];
      while (seconds > 0) {
        time.unshift(seconds & 255);
        seconds = Math.floor(seconds / 256);
      }
      const value = `${payload}.${b64urlEncode(Uint8Array.from(time))}`;
      return `${value}.${b64urlEncode(await flaskSignature(value, a))}`;
    },
  }),
  defineOp({
    name: 'Flask Session Verify',
    category: C,
    description: 'Checks the signature of a Flask session cookie and shows its contents.',
    input: 'text',
    output: 'text',
    args: [
      keyed('key', 'Key', 'UTF8'),
      keyed('salt', 'Salt', 'UTF8', undefined, { default: 'cookie-session' }),
      sel('algorithm', 'Algorithm', ['sha1', 'sha256']),
      bool('time', 'View TimeStamp', true),
    ],
    run: async (input, a) => {
      const cookie = input.trim();
      const cut = cookie.lastIndexOf('.');
      const expected = b64urlEncode(await flaskSignature(cookie.slice(0, cut), a));
      if (expected !== cookie.slice(cut + 1)) throw new OpError('The signature does not match this key and salt.');
      return flaskDecode(cookie, bArg(a, 'time'));
    },
  }),
];

function affine(text: string, a: number, b: number, decode: boolean): string {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  if (gcd(((a % 26) + 26) % 26, 26) !== 1) throw new OpError('"a" must be coprime with 26 (1, 3, 5, 7, 9, 11, 15, 17, 19, 21, 23 or 25).');
  let inverse = 1;
  while ((((a * inverse) % 26) + 26) % 26 !== 1) inverse++;
  return Array.from(text, (ch) => {
    const lower = LOWER.indexOf(ch);
    const upper = UPPER.indexOf(ch);
    const x = lower !== -1 ? lower : upper;
    if (x === -1) return ch;
    const y = decode ? (((inverse * (x - b)) % 26) + 26) % 26 : (((a * x + b) % 26) + 26) % 26;
    return (lower !== -1 ? LOWER : UPPER)[y] as string;
  }).join('');
}

async function hashFn(name: string): Promise<CHash> {
  const sha2 = await import('@noble/hashes/sha2.js');
  const legacy = await import('@noble/hashes/legacy.js');
  const table: Record<string, CHash> = { SHA1: legacy.sha1, SHA256: sha2.sha256, SHA384: sha2.sha384, SHA512: sha2.sha512, MD5: legacy.md5 };
  const fn = table[name];
  if (!fn) throw new OpError(`Unknown hash ${name}.`);
  return fn;
}

async function keyWrap(kek: Uint8Array, iv: Uint8Array, data: Uint8Array, wrap: boolean): Promise<Uint8Array> {
  const { ecb } = await import('@noble/ciphers/aes.js');
  if (![16, 24, 32].includes(kek.length)) throw new OpError('The KEK must be 16, 24 or 32 bytes.');
  if (iv.length !== 8) throw new OpError('The IV must be 8 bytes.');
  const block = { encrypt: (b: Uint8Array) => ecb(kek, { disablePadding: true }).encrypt(b) };
  if (wrap) {
    if (data.length % 8 || data.length < 16) throw new OpError('The key to wrap must be at least 16 bytes and a multiple of 8.');
    const n = data.length / 8;
    let a = iv.slice();
    const r = Array.from({ length: n }, (_, i) => data.slice(i * 8, i * 8 + 8));
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < n; i++) {
        const b = block.encrypt(Uint8Array.from([...a, ...(r[i] as Uint8Array)]));
        const t = BigInt(n * j + i + 1);
        a = b.slice(0, 8);
        for (let k = 0; k < 8; k++) a[7 - k] = (a[7 - k] as number) ^ Number((t >> BigInt(8 * k)) & 255n);
        r[i] = b.slice(8);
      }
    }
    return Uint8Array.from([...a, ...r.flatMap((x) => Array.from(x))]);
  }
  if (data.length % 8 || data.length < 24) throw new OpError('Wrapped keys are at least 24 bytes and a multiple of 8.');
  const n = data.length / 8 - 1;
  let a = data.slice(0, 8);
  const r = Array.from({ length: n }, (_, i) => data.slice(8 + i * 8, 16 + i * 8));
  const dec = { decrypt: (b: Uint8Array) => ecb(kek, { disablePadding: true }).decrypt(b) };
  for (let j = 5; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const t = BigInt(n * j + i + 1);
      const x = a.slice();
      for (let k = 0; k < 8; k++) x[7 - k] = (x[7 - k] as number) ^ Number((t >> BigInt(8 * k)) & 255n);
      const b = dec.decrypt(Uint8Array.from([...x, ...(r[i] as Uint8Array)]));
      a = b.slice(0, 8);
      r[i] = b.slice(8);
    }
  }
  if (hex(a) !== hex(iv)) throw new OpError('Unwrapping failed: the integrity check value does not match (wrong KEK or IV).');
  return Uint8Array.from(r.flatMap((x) => Array.from(x)));
}
