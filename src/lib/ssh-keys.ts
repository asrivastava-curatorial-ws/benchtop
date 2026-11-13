/**
 * Key pairs for SSH and TLS: generated with the system's Web Crypto (RSA,
 * ECDSA) or @noble/curves (Ed25519), exported as OpenSSH and PEM files.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, fromBase64, toBase64, utf8Encode, wrapLines } from './bytes';
import { ToolError } from './errors';

export type KeyKind = 'ed25519' | 'ecdsa-p256' | 'ecdsa-p384' | 'ecdsa-p521' | 'rsa-2048' | 'rsa-3072' | 'rsa-4096';

export const KEY_KINDS: readonly { value: KeyKind; label: string }[] = [
  { value: 'ed25519', label: 'Ed25519 (recommended)' },
  { value: 'ecdsa-p256', label: 'ECDSA P-256' },
  { value: 'ecdsa-p384', label: 'ECDSA P-384' },
  { value: 'ecdsa-p521', label: 'ECDSA P-521' },
  { value: 'rsa-3072', label: 'RSA 3072' },
  { value: 'rsa-4096', label: 'RSA 4096' },
  { value: 'rsa-2048', label: 'RSA 2048 (legacy systems)' },
];

export interface KeyPair {
  readonly kind: KeyKind;
  /** One line for authorized_keys: "ssh-ed25519 AAAA... comment". */
  readonly sshPublic: string;
  /** "-----BEGIN OPENSSH PRIVATE KEY-----", unencrypted. */
  readonly sshPrivate: string;
  readonly pemPublic: string;
  readonly pemPrivate: string;
  readonly fingerprint: string;
  readonly bits: number;
}

/* ------------------------------------------------------------ wire format -- */

const u32 = (value: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
};

const sshString = (data: Uint8Array | string): Uint8Array => {
  const bytes = typeof data === 'string' ? utf8Encode(data) : data;
  return concatBytes(u32(bytes.length), bytes);
};

/** SSH mpint: big-endian, minimal, with a leading zero when the top bit is set. */
function mpint(unsigned: Uint8Array): Uint8Array {
  let start = 0;
  while (start < unsigned.length - 1 && unsigned[start] === 0) start++;
  let body = unsigned.subarray(start);
  if (body.length === 1 && body[0] === 0) body = new Uint8Array();
  else if (((body[0] as number) & 0x80) !== 0) body = concatBytes(new Uint8Array([0]), body);
  return sshString(body);
}

const base64Url = (text: string): Uint8Array => fromBase64(text.replace(/-/g, '+').replace(/_/g, '/'));

const pem = (label: string, der: Uint8Array): string => `-----BEGIN ${label}-----\n${wrapLines(toBase64(der), 64)}\n-----END ${label}-----\n`;

function openSshPrivate(publicBlob: Uint8Array, privateFields: Uint8Array, comment: string): string {
  const check = new Uint8Array(4);
  crypto.getRandomValues(check);
  let section = concatBytes(check, check, privateFields, sshString(comment));
  const padding: number[] = [];
  for (let i = 1; (section.length + padding.length) % 8 !== 0; i++) padding.push(i);
  section = concatBytes(section, new Uint8Array(padding));
  const body = concatBytes(utf8Encode('openssh-key-v1\0'), sshString('none'), sshString('none'), sshString(''), u32(1), sshString(publicBlob), sshString(section));
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrapLines(toBase64(body), 70)}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

const fingerprintOf = (blob: Uint8Array): string => `SHA256:${toBase64(sha256(blob)).replace(/=+$/, '')}`;

/* ---------------------------------------------------------------- creation -- */

const ED25519_PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const ED25519_SPKI_PREFIX = new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

function ed25519Pair(comment: string, seed?: Uint8Array): KeyPair {
  const secret = seed ?? ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(secret);
  const blob = concatBytes(sshString('ssh-ed25519'), sshString(pub));
  const privateFields = concatBytes(sshString('ssh-ed25519'), sshString(pub), sshString(concatBytes(secret, pub)));
  return {
    kind: 'ed25519',
    sshPublic: `ssh-ed25519 ${toBase64(blob)}${comment ? ` ${comment}` : ''}`,
    sshPrivate: openSshPrivate(blob, privateFields, comment),
    pemPublic: pem('PUBLIC KEY', concatBytes(ED25519_SPKI_PREFIX, pub)),
    pemPrivate: pem('PRIVATE KEY', concatBytes(ED25519_PKCS8_PREFIX, secret)),
    fingerprint: fingerprintOf(blob),
    bits: 256,
  };
}

const CURVES = { 'ecdsa-p256': ['P-256', 'nistp256', 256], 'ecdsa-p384': ['P-384', 'nistp384', 384], 'ecdsa-p521': ['P-521', 'nistp521', 521] } as const;

async function ecdsaPair(kind: keyof typeof CURVES, comment: string): Promise<KeyPair> {
  const [curve, sshCurve, bits] = CURVES[kind];
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const q = concatBytes(new Uint8Array([4]), base64Url(jwk.x as string), base64Url(jwk.y as string));
  const type = `ecdsa-sha2-${sshCurve}`;
  const blob = concatBytes(sshString(type), sshString(sshCurve), sshString(q));
  const privateFields = concatBytes(sshString(type), sshString(sshCurve), sshString(q), mpint(base64Url(jwk.d as string)));
  return {
    kind,
    sshPublic: `${type} ${toBase64(blob)}${comment ? ` ${comment}` : ''}`,
    sshPrivate: openSshPrivate(blob, privateFields, comment),
    pemPublic: pem('PUBLIC KEY', new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))),
    pemPrivate: pem('PRIVATE KEY', new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey))),
    fingerprint: fingerprintOf(blob),
    bits,
  };
}

async function rsaPair(bits: number, kind: KeyKind, comment: string): Promise<KeyPair> {
  const keys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const [n, e, d, p, q, qi] = [jwk.n, jwk.e, jwk.d, jwk.p, jwk.q, jwk.qi].map((value) => base64Url(value as string)) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  const blob = concatBytes(sshString('ssh-rsa'), mpint(e), mpint(n));
  // OpenSSH stores iqmp = q^-1 mod p, which is the JWK "qi" coefficient.
  const privateFields = concatBytes(sshString('ssh-rsa'), mpint(n), mpint(e), mpint(d), mpint(qi), mpint(p), mpint(q));
  return {
    kind,
    sshPublic: `ssh-rsa ${toBase64(blob)}${comment ? ` ${comment}` : ''}`,
    sshPrivate: openSshPrivate(blob, privateFields, comment),
    pemPublic: pem('PUBLIC KEY', new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))),
    pemPrivate: pem('PRIVATE KEY', new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey))),
    fingerprint: fingerprintOf(blob),
    bits,
  };
}

export async function generateKeyPair(kind: KeyKind, comment: string): Promise<KeyPair> {
  const cleanComment = comment.replace(/[\r\n]+/g, ' ').trim();
  if (kind === 'ed25519') return ed25519Pair(cleanComment);
  if (kind in CURVES) return ecdsaPair(kind as keyof typeof CURVES, cleanComment);
  const bits = Number(kind.slice(4));
  if (![2048, 3072, 4096].includes(bits)) throw new ToolError(`Unknown key type "${kind}".`);
  return rsaPair(bits, kind, cleanComment);
}

/** Deterministic Ed25519 pair from a 32-byte seed, for tests. */
export const ed25519FromSeed = (seed: Uint8Array, comment: string): KeyPair => ed25519Pair(comment, seed);

/** Fingerprint of an existing public key line ("ssh-ed25519 AAAA... comment"). */
export function fingerprintOfLine(line: string): { type: string; fingerprint: string; comment: string } {
  const [type, data, ...rest] = line.trim().split(/\s+/);
  if (!type || !data) throw new ToolError('Paste a public key line such as "ssh-ed25519 AAAA... you@host".');
  return { type, fingerprint: fingerprintOf(fromBase64(data)), comment: rest.join(' ') };
}
