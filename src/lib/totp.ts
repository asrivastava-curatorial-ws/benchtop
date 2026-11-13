/** One-time passwords: HOTP (RFC 4226) and TOTP (RFC 6238), plus otpauth:// URIs. */
import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { fromBase32, randomBytes, toBase32 } from './bytes';
import { ToolError } from './errors';

export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

const HASHES = { SHA1: sha1, SHA256: sha256, SHA512: sha512 } as const;

export function hotp(key: Uint8Array, counter: bigint, digits = 6, algorithm: OtpAlgorithm = 'SHA1'): string {
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, counter);
  const mac = hmac(HASHES[algorithm], key, message);
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const binary = (((mac[offset] as number) & 0x7f) << 24) | ((mac[offset + 1] as number) << 16) | ((mac[offset + 2] as number) << 8) | (mac[offset + 3] as number);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totp(key: Uint8Array, timeMs: number, options: { period?: number; digits?: number; algorithm?: OtpAlgorithm } = {}): string {
  const period = options.period ?? 30;
  return hotp(key, BigInt(Math.floor(timeMs / 1000 / period)), options.digits ?? 6, options.algorithm ?? 'SHA1');
}

/** Checks a code against the current step and `window` steps either side; returns the offset that matched. */
export function verifyTotp(key: Uint8Array, code: string, timeMs: number, options: { period?: number; digits?: number; algorithm?: OtpAlgorithm; window?: number } = {}): number | null {
  const period = options.period ?? 30;
  const window = options.window ?? 1;
  const step = BigInt(Math.floor(timeMs / 1000 / period));
  const wanted = code.replace(/\s/g, '');
  for (let offset = -window; offset <= window; offset++) {
    if (hotp(key, step + BigInt(offset), options.digits ?? 6, options.algorithm ?? 'SHA1') === wanted) return offset;
  }
  return null;
}

/** Decodes a Base32 secret as authenticator apps accept it: spaces, dashes and lower case allowed, padding optional. */
export function decodeSecret(text: string): Uint8Array {
  const cleaned = text.replace(/[\s-]/g, '').toUpperCase().replace(/=+$/, '');
  if (cleaned === '') throw new ToolError('Enter the secret (Base32, as shown by the service when you set up the authenticator).');
  if (!/^[A-Z2-7]+$/.test(cleaned)) throw new ToolError('The secret must be Base32: letters A-Z and digits 2-7.');
  return fromBase32(cleaned);
}

export function newSecret(bytes = 20): string {
  return toBase32(randomBytes(bytes), undefined, false);
}

export interface OtpAuth {
  readonly issuer: string;
  readonly account: string;
  readonly secret: string;
  readonly algorithm: OtpAlgorithm;
  readonly digits: number;
  readonly period: number;
}

export function buildOtpAuthUri(info: OtpAuth): string {
  const label = info.issuer ? `${encodeURIComponent(info.issuer)}:${encodeURIComponent(info.account)}` : encodeURIComponent(info.account);
  const params = new URLSearchParams({ secret: info.secret.replace(/[\s=-]/g, '').toUpperCase() });
  if (info.issuer) params.set('issuer', info.issuer);
  if (info.algorithm !== 'SHA1') params.set('algorithm', info.algorithm);
  if (info.digits !== 6) params.set('digits', String(info.digits));
  if (info.period !== 30) params.set('period', String(info.period));
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function parseOtpAuthUri(uri: string): OtpAuth {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    throw new ToolError('This is not an otpauth:// link.');
  }
  if (url.protocol !== 'otpauth:') throw new ToolError('This is not an otpauth:// link.');
  if (url.host !== 'totp') throw new ToolError(`Only time-based (totp) links are supported, not "${url.host}".`);
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const [labelIssuer, account] = label.includes(':') ? (label.split(/:(.*)/s, 2) as [string, string]) : ['', label];
  const algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase();
  if (!(algorithm in HASHES)) throw new ToolError(`Unsupported algorithm "${algorithm}".`);
  const secret = url.searchParams.get('secret') ?? '';
  decodeSecret(secret);
  return {
    issuer: url.searchParams.get('issuer') ?? labelIssuer,
    account: account.trim(),
    secret: secret.toUpperCase(),
    algorithm: algorithm as OtpAlgorithm,
    digits: Number(url.searchParams.get('digits') ?? 6),
    period: Number(url.searchParams.get('period') ?? 30),
  };
}
