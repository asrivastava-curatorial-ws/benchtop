/**
 * Byte-level helpers: UTF-8, hex, Base64, Base32 and arbitrary-alphabet
 * (Base58 / Base62) codecs.  Everything here is pure and synchronous.
 */
import { ToolError } from './errors';

const encoder = new TextEncoder();

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Decodes UTF-8 strictly: malformed sequences raise instead of becoming U+FFFD. */
export function utf8Decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new ToolError('These bytes are not valid UTF-8 text.');
  }
}

export function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** True when the text decodes cleanly and has no control characters besides whitespace. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (!isUtf8(bytes)) return false;
  const limit = Math.min(bytes.length, 4096);
  for (let i = 0; i < limit; i++) {
    const b = bytes[i] as number;
    if (b < 9 || (b > 13 && b < 32) || b === 127) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ hex -- */

const HEX_LOWER = '0123456789abcdef';
const HEX_UPPER = '0123456789ABCDEF';

export function toHex(bytes: Uint8Array, options: { upper?: boolean; separator?: string; prefix?: string } = {}): string {
  const digits = options.upper ? HEX_UPPER : HEX_LOWER;
  const separator = options.separator ?? '';
  const prefix = options.prefix ?? '';
  const parts = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    parts[i] = prefix + digits[b >> 4] + digits[b & 15];
  }
  return parts.join(separator);
}

/**
 * Parses hex written in any of the usual notations: `48656c6c6f`,
 * `48 65 6c`, `48:65:6C`, `0x48, 0x65`, `\x48\x65` and `%48%65`.
 */
export function fromHex(text: string): Uint8Array {
  const normalised = text
    .replace(/\\x|%/gi, ' ')
    .replace(/(^|[^0-9a-fA-F])0x/gi, '$1 ')
    .trim();
  if (normalised === '') return new Uint8Array(0);
  const tokens = normalised.split(/[\s,:;_-]+/).filter(Boolean);
  for (const token of tokens) {
    const bad = /[^0-9a-fA-F]/.exec(token);
    if (bad) throw new ToolError(`"${bad[0]}" is not a hexadecimal digit.`);
  }
  let digits: string;
  if (tokens.length > 1 && tokens.every((token) => token.length <= 2)) {
    digits = tokens.map((token) => token.padStart(2, '0')).join('');
  } else {
    digits = tokens.join('');
  }
  if (digits.length % 2 !== 0) {
    throw new ToolError(`Hex input has an odd number of digits (${digits.length}); each byte needs two.`);
  }
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/* --------------------------------------------------------------- base64 -- */

export function toBase64(bytes: Uint8Array, options: { urlSafe?: boolean; pad?: boolean } = {}): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  let out = btoa(binary);
  if (options.urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_');
  if (options.pad === false) out = out.replace(/=+$/, '');
  return out;
}

/** Accepts standard and URL-safe alphabets, optional padding and embedded whitespace. */
export function fromBase64(text: string): Uint8Array {
  const compact = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const body = compact.replace(/=+$/, '');
  const bad = /[^A-Za-z0-9+/]/.exec(body);
  if (bad) {
    throw new ToolError(`Invalid Base64: unexpected character "${bad[0]}" at position ${bad.index + 1}.`);
  }
  if (body.length % 4 === 1) {
    throw new ToolError('Invalid Base64: the length is not possible (one character is missing or extra).');
  }
  const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function wrapLines(text: string, width: number): string {
  if (width <= 0 || text.length <= width) return text;
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join('\n');
}

/* --------------------------------------------------------------- base32 -- */

export const BASE32_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const BASE32_HEX = '0123456789ABCDEFGHIJKLMNOPQRSTUV';

export function toBase32(bytes: Uint8Array, alphabet = BASE32_STD, pad = true): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
  if (pad) out += '='.repeat((8 - (out.length % 8)) % 8);
  return out;
}

export function fromBase32(text: string, alphabet = BASE32_STD): Uint8Array {
  const body = text.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase();
  const remainder = body.length % 8;
  if (remainder === 1 || remainder === 3 || remainder === 6) {
    throw new ToolError('Invalid Base32: the length is not possible (characters are missing or extra).');
  }
  const out = new Uint8Array(Math.floor((body.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let i = 0; i < body.length; i++) {
    const value = alphabet.indexOf(body[i] as string);
    if (value < 0) {
      throw new ToolError(`Invalid Base32: unexpected character "${body[i]}" at position ${i + 1}.`);
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 255;
      buffer &= (1 << bits) - 1;
    }
  }
  return out;
}

/* ------------------------------------------------ base58 / base62 (base-x) -- */

export const BASE58_BITCOIN = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const BASE58_FLICKR = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
export const BASE58_RIPPLE = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';
export const BASE62_DIGITS_UPPER_LOWER = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const BASE62_DIGITS_LOWER_UPPER = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Quadratic-time codecs are only sensible for short values such as keys and identifiers. */
export const BASE_X_LIMIT = 64 * 1024;

/**
 * Encodes bytes as a big-endian number in the given alphabet.  Leading zero
 * bytes are preserved as leading "zero" characters (the Bitcoin convention).
 */
export function baseXEncode(source: Uint8Array, alphabet: string): string {
  if (source.length > BASE_X_LIMIT) {
    throw new ToolError(`Input is too large for this encoding (limit ${BASE_X_LIMIT / 1024} kB).`);
  }
  const base = alphabet.length;
  let zeroes = 0;
  while (zeroes < source.length && source[zeroes] === 0) zeroes++;
  const size = Math.ceil(((source.length - zeroes) * Math.log(256)) / Math.log(base)) + 1;
  const digits = new Uint8Array(size);
  let length = 0;
  for (let i = zeroes; i < source.length; i++) {
    let carry = source[i] as number;
    let used = 0;
    for (let k = size - 1; (carry !== 0 || used < length) && k >= 0; k--, used++) {
      carry += 256 * (digits[k] as number);
      digits[k] = carry % base;
      carry = Math.floor(carry / base);
    }
    length = used;
  }
  let start = size - length;
  while (start < size && digits[start] === 0) start++;
  let out = (alphabet[0] as string).repeat(zeroes);
  for (let i = start; i < size; i++) out += alphabet[digits[i] as number];
  return out;
}

export function baseXDecode(text: string, alphabet: string, name = 'input'): Uint8Array {
  const source = text.replace(/\s+/g, '');
  if (source.length > BASE_X_LIMIT * 2) {
    throw new ToolError(`Input is too large for this encoding (limit ${(BASE_X_LIMIT * 2) / 1024} kB).`);
  }
  const base = alphabet.length;
  const zero = alphabet[0] as string;
  let zeroes = 0;
  while (zeroes < source.length && source[zeroes] === zero) zeroes++;
  const size = Math.ceil(((source.length - zeroes) * Math.log(base)) / Math.log(256)) + 1;
  const bytes = new Uint8Array(size);
  let length = 0;
  for (let i = zeroes; i < source.length; i++) {
    let carry = alphabet.indexOf(source[i] as string);
    if (carry < 0) {
      throw new ToolError(`Invalid ${name}: unexpected character "${source[i]}" at position ${i + 1}.`);
    }
    let used = 0;
    for (let k = size - 1; (carry !== 0 || used < length) && k >= 0; k--, used++) {
      carry += base * (bytes[k] as number);
      bytes[k] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    length = used;
  }
  let start = size - length;
  while (start < size && bytes[start] === 0) start++;
  const out = new Uint8Array(zeroes + (size - start));
  out.set(bytes.subarray(start), zeroes);
  return out;
}

/* ----------------------------------------------------------------- misc -- */

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  // getRandomValues is limited to 65536 bytes per call.
  for (let offset = 0; offset < length; offset += 65536) {
    crypto.getRandomValues(out.subarray(offset, Math.min(length, offset + 65536)));
  }
  return out;
}

/** Uniform random integer in [0, max) without modulo bias. */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0xffffffff) throw new RangeError('max out of range');
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] as number;
    if (value < limit) return value % max;
  }
}

export function formatBytes(size: number): string {
  if (size < 1000) return `${size} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = size;
  let unit = -1;
  do {
    value /= 1000;
    unit++;
  } while (value >= 1000 && unit < units.length - 1);
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}

/** "1.2 kB -> 640 B (47% smaller)" */
export function sizeChange(before: number, after: number): string {
  if (before === 0) return `${formatBytes(after)}`;
  const delta = ((after - before) / before) * 100;
  const summary = Math.abs(delta) < 0.05 ? 'same size' : `${Math.abs(delta).toFixed(1)}% ${delta < 0 ? 'smaller' : 'larger'}`;
  return `${formatBytes(before)} → ${formatBytes(after)} (${summary})`;
}

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}
