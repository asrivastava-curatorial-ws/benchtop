/** JSON Web Token helpers (RFC 7519 / RFC 7515, HMAC algorithms). */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { fromBase64, toBase64, utf8Decode, utf8Encode } from './bytes';
import { ToolError } from './errors';

export const HMAC_ALGORITHMS = { HS256: sha256, HS384: sha384, HS512: sha512 } as const;
export type HmacAlgorithm = keyof typeof HMAC_ALGORITHMS;

export const isHmacAlgorithm = (value: unknown): value is HmacAlgorithm => typeof value === 'string' && value in HMAC_ALGORITHMS;

const b64url = (bytes: Uint8Array): string => toBase64(bytes, { urlSafe: true, pad: false });

export function signJwt(header: Record<string, unknown>, payload: unknown, secret: Uint8Array, algorithm: HmacAlgorithm): string {
  const signingInput = `${b64url(utf8Encode(JSON.stringify(header)))}.${b64url(utf8Encode(JSON.stringify(payload)))}`;
  const signature = hmac(HMAC_ALGORITHMS[algorithm], secret, utf8Encode(signingInput));
  return `${signingInput}.${b64url(signature)}`;
}

export interface DecodedJwt {
  readonly header: Record<string, unknown>;
  readonly payload: unknown;
  readonly signature: Uint8Array;
  readonly signingInput: string;
}

function decodePart(part: string, name: string): unknown {
  let text: string;
  try {
    text = utf8Decode(fromBase64(part));
  } catch {
    throw new ToolError(`The ${name} is not valid Base64URL-encoded text.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ToolError(`The ${name} is not valid JSON.`);
  }
}

export function decodeJwt(token: string): DecodedJwt {
  const compact = token.trim().replace(/^Bearer\s+/i, '');
  const parts = compact.split('.');
  if (parts.length === 5) {
    throw new ToolError('This is an encrypted token (JWE, five parts). Its contents cannot be read without the key.');
  }
  if (parts.length !== 3) {
    throw new ToolError(`A JWT has three dot-separated parts (header.payload.signature); this has ${parts.length}.`);
  }
  const [head, body, sig] = parts as [string, string, string];
  const header = decodePart(head, 'header');
  if (header === null || typeof header !== 'object' || Array.isArray(header)) {
    throw new ToolError('The header must be a JSON object.');
  }
  let signature: Uint8Array;
  try {
    signature = fromBase64(sig);
  } catch {
    throw new ToolError('The signature is not valid Base64URL.');
  }
  return {
    header: header as Record<string, unknown>,
    payload: decodePart(body, 'payload'),
    signature,
    signingInput: `${head}.${body}`,
  };
}

/** `true`/`false` for HMAC tokens, `null` when the algorithm cannot be checked with a shared secret. */
export function verifyJwt(decoded: DecodedJwt, secret: Uint8Array): boolean | null {
  const algorithm = decoded.header.alg;
  if (!isHmacAlgorithm(algorithm)) return null;
  const expected = hmac(HMAC_ALGORITHMS[algorithm], secret, utf8Encode(decoded.signingInput));
  if (expected.length !== decoded.signature.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= (expected[i] as number) ^ (decoded.signature[i] as number);
  return difference === 0;
}

/** "in 3 days", "5 minutes ago" */
export function relativeTime(target: number, now: number): string {
  const seconds = Math.round((target - now) / 1000);
  const abs = Math.abs(seconds);
  const units: [number, string][] = [
    [31557600, 'year'],
    [2629800, 'month'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ];
  for (const [size, name] of units) {
    if (abs >= size) {
      const count = Math.floor(abs / size);
      const label = `${count} ${name}${count === 1 ? '' : 's'}`;
      return seconds < 0 ? `${label} ago` : `in ${label}`;
    }
  }
  return 'now';
}
