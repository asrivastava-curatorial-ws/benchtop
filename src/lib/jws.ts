/**
 * JSON Web Signatures with every algorithm in common use (RFC 7515, 7518,
 * 8037, 8812 and 9864): HMAC, RSA PKCS #1 v1.5, RSA-PSS, ECDSA on P-256,
 * P-384, P-521 and secp256k1, and EdDSA on Ed25519 and Ed448.
 *
 * Keys can be PEM (public, private, PKCS #1, SEC 1 or a certificate), a JWK or
 * a JWK set.  RSA uses the platform's Web Crypto; the curves use @noble/curves.
 */
import { ed448 } from '@noble/curves/ed448.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256, p384, p521 } from '@noble/curves/nist.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { concatBytes, fromBase64, toBase64, utf8Decode, utf8Encode, wrapLines } from './bytes';
import { ToolError } from './errors';
import { type Der, decodeOid, parseDer } from './x509';

export const ALGORITHMS = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'ES256K', 'EdDSA', 'Ed25519', 'none'] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

export const isAlgorithm = (value: unknown): value is Algorithm => typeof value === 'string' && (ALGORITHMS as readonly string[]).includes(value);

export const ALGORITHM_NAMES: Record<Algorithm, string> = {
  HS256: 'HMAC with SHA-256',
  HS384: 'HMAC with SHA-384',
  HS512: 'HMAC with SHA-512',
  RS256: 'RSA PKCS #1 v1.5 with SHA-256',
  RS384: 'RSA PKCS #1 v1.5 with SHA-384',
  RS512: 'RSA PKCS #1 v1.5 with SHA-512',
  PS256: 'RSA-PSS with SHA-256',
  PS384: 'RSA-PSS with SHA-384',
  PS512: 'RSA-PSS with SHA-512',
  ES256: 'ECDSA on P-256 with SHA-256',
  ES384: 'ECDSA on P-384 with SHA-384',
  ES512: 'ECDSA on P-521 with SHA-512',
  ES256K: 'ECDSA on secp256k1 with SHA-256',
  EdDSA: 'EdDSA (Ed25519 or Ed448)',
  Ed25519: 'EdDSA on Ed25519',
  none: 'Unsigned',
};

export const b64url = (bytes: Uint8Array): string => toBase64(bytes, { urlSafe: true, pad: false });

const fromB64url = (text: string, what: string): Uint8Array => {
  try {
    return fromBase64(text);
  } catch {
    throw new ToolError(`${what} is not valid Base64URL.`);
  }
};

/* ------------------------------------------------------------ DER output -- */

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 255);
  return [0x80 | bytes.length, ...bytes];
}

const tlv = (tag: number, content: Uint8Array): Uint8Array => concatBytes(new Uint8Array([tag, ...derLength(content.length)]), content);
const seq = (...parts: Uint8Array[]): Uint8Array => tlv(0x30, concatBytes(...parts));
const octets = (bytes: Uint8Array): Uint8Array => tlv(0x04, bytes);
const bits = (bytes: Uint8Array): Uint8Array => tlv(0x03, concatBytes(new Uint8Array([0]), bytes));
const NULL = new Uint8Array([0x05, 0x00]);
const ZERO = new Uint8Array([0x02, 0x01, 0x00]);

function integer(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const trimmed = bytes.subarray(start);
  return tlv(0x02, (trimmed[0] as number) & 0x80 ? concatBytes(new Uint8Array([0]), trimmed) : trimmed);
}

function oid(dotted: string): Uint8Array {
  const parts = dotted.split('.').map(Number);
  const out: number[] = [(parts[0] as number) * 40 + (parts[1] as number)];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    for (let n = Math.floor(part / 128); n > 0; n = Math.floor(n / 128)) chunk.unshift((n & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, new Uint8Array(out));
}

export const pem = (label: string, der: Uint8Array): string => `-----BEGIN ${label}-----\n${wrapLines(toBase64(der), 64)}\n-----END ${label}-----\n`;

/* ----------------------------------------------------------------- keys -- */

const OID = {
  rsa: '1.2.840.113549.1.1.1',
  ec: '1.2.840.10045.2.1',
  ed25519: '1.3.101.112',
  ed448: '1.3.101.113',
} as const;

export type Curve = 'P-256' | 'P-384' | 'P-521' | 'secp256k1' | 'Ed25519' | 'Ed448';

const CURVE_OIDS: Record<string, Curve> = { '1.2.840.10045.3.1.7': 'P-256', '1.3.132.0.34': 'P-384', '1.3.132.0.35': 'P-521', '1.3.132.0.10': 'secp256k1' };
const CURVE_OID_OF: Record<string, string> = { 'P-256': '1.2.840.10045.3.1.7', 'P-384': '1.3.132.0.34', 'P-521': '1.3.132.0.35', secp256k1: '1.3.132.0.10' };
const WEIERSTRASS = { 'P-256': p256, 'P-384': p384, 'P-521': p521, secp256k1 } as const;
const FIELD_BYTES: Record<string, number> = { 'P-256': 32, 'P-384': 48, 'P-521': 66, secp256k1: 32, Ed25519: 32, Ed448: 57 };

/** A key reduced to its JWK form, which every algorithm below starts from. */
export interface Jwk {
  readonly kty: 'RSA' | 'EC' | 'OKP' | 'oct';
  readonly crv?: Curve;
  readonly n?: string;
  readonly e?: string;
  readonly d?: string;
  readonly p?: string;
  readonly q?: string;
  readonly dp?: string;
  readonly dq?: string;
  readonly qi?: string;
  readonly x?: string;
  readonly y?: string;
  readonly k?: string;
  readonly kid?: string;
  readonly alg?: string;
  readonly use?: string;
}

const node = (der: Der | undefined, what = 'key'): Der => {
  if (!der) throw new ToolError(`The ${what} is not in a format this tool recognises.`);
  return der;
};

const unsigned = (bytes: Uint8Array): Uint8Array => {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  return bytes.subarray(start);
};

const padTo = (bytes: Uint8Array, length: number): Uint8Array => {
  if (bytes.length >= length) return bytes.subarray(bytes.length - length);
  const out = new Uint8Array(length);
  out.set(bytes, length - bytes.length);
  return out;
};

const rsaPublicJwk = (rsaPublicKey: Der): Jwk => ({ kty: 'RSA', n: b64url(unsigned(node(rsaPublicKey.children[0]).content)), e: b64url(unsigned(node(rsaPublicKey.children[1]).content)) });

function rsaPrivateJwk(rsaPrivateKey: Der): Jwk {
  const values = rsaPrivateKey.children.slice(1, 9).map((item) => b64url(unsigned(item.content)));
  if (values.length < 8) throw new ToolError('The RSA private key is incomplete.');
  const [n, e, d, p, q, dp, dq, qi] = values as [string, string, string, string, string, string, string, string];
  return { kty: 'RSA', n, e, d, p, q, dp, dq, qi };
}

function ecPointJwk(curve: Curve, point: Uint8Array): Jwk {
  const size = FIELD_BYTES[curve] as number;
  let raw = point;
  if (raw[0] !== 4) raw = WEIERSTRASS[curve as keyof typeof WEIERSTRASS].Point.fromBytes(point).toBytes(false);
  return { kty: 'EC', crv: curve, x: b64url(raw.subarray(1, 1 + size)), y: b64url(raw.subarray(1 + size, 1 + 2 * size)) };
}

function ecPrivateJwk(curve: Curve, ecPrivateKey: Der): Jwk {
  const d = node(ecPrivateKey.children[1]).content;
  const size = FIELD_BYTES[curve] as number;
  const scalar = padTo(d, size);
  const publicPoint = WEIERSTRASS[curve as keyof typeof WEIERSTRASS].getPublicKey(scalar, false);
  return { ...ecPointJwk(curve, publicPoint), d: b64url(scalar) };
}

function curveOfSec1(ecPrivateKey: Der): Curve | undefined {
  const params = ecPrivateKey.children.find((item) => item.tag === 0xa0);
  const oidNode = params?.children[0];
  return oidNode ? CURVE_OIDS[decodeOid(oidNode.content)] : undefined;
}

function spkiJwk(spki: Der): Jwk {
  const algorithm = node(spki.children[0]);
  const type = decodeOid(node(algorithm.children[0]).content);
  const keyBits = node(spki.children[1]).content.subarray(1);
  if (type === OID.rsa) return rsaPublicJwk(parseDer(keyBits));
  if (type === OID.ec) {
    const curve = CURVE_OIDS[decodeOid(node(algorithm.children[1], 'curve').content)];
    if (!curve) throw new ToolError('This elliptic curve is not used for JWTs.');
    return ecPointJwk(curve, keyBits);
  }
  if (type === OID.ed25519) return { kty: 'OKP', crv: 'Ed25519', x: b64url(keyBits) };
  if (type === OID.ed448) return { kty: 'OKP', crv: 'Ed448', x: b64url(keyBits) };
  throw new ToolError(`Keys of type ${type} cannot sign JWTs.`);
}

function pkcs8Jwk(pkcs8: Der): Jwk {
  const algorithm = node(pkcs8.children[1]);
  const type = decodeOid(node(algorithm.children[0]).content);
  const inner = node(pkcs8.children[2]).content;
  if (type === OID.rsa) return rsaPrivateJwk(parseDer(inner));
  if (type === OID.ec) {
    const sec1 = parseDer(inner);
    const curve = CURVE_OIDS[decodeOid(node(algorithm.children[1], 'curve').content)] ?? curveOfSec1(sec1);
    if (!curve) throw new ToolError('This elliptic curve is not used for JWTs.');
    return ecPrivateJwk(curve, sec1);
  }
  if (type === OID.ed25519 || type === OID.ed448) {
    const crv: Curve = type === OID.ed25519 ? 'Ed25519' : 'Ed448';
    const seed = parseDer(inner).content;
    const publicKey = crv === 'Ed25519' ? ed25519.getPublicKey(seed) : ed448.getPublicKey(seed);
    return { kty: 'OKP', crv, x: b64url(publicKey), d: b64url(seed) };
  }
  throw new ToolError(`Keys of type ${type} cannot sign JWTs.`);
}

function certificateJwk(der: Der): Jwk {
  const tbs = node(der.children[0]);
  const hasVersion = tbs.children[0]?.tag === 0xa0;
  return spkiJwk(node(tbs.children[hasVersion ? 6 : 5], 'certificate'));
}

/** Reads the first key in PEM text. */
export function pemToJwk(text: string): Jwk {
  const match = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(text);
  if (!match) throw new ToolError('No PEM block found (-----BEGIN … -----).');
  const label = match[1] as string;
  const body = (match[2] as string).replace(/^[A-Za-z-]+:.*$/gm, '').replace(/\s+/g, '');
  const der = parseDer(fromBase64(body));
  switch (label) {
    case 'PUBLIC KEY':
      return spkiJwk(der);
    case 'RSA PUBLIC KEY':
      return rsaPublicJwk(der);
    case 'CERTIFICATE':
      return certificateJwk(der);
    case 'PRIVATE KEY':
      return pkcs8Jwk(der);
    case 'RSA PRIVATE KEY':
      return rsaPrivateJwk(der);
    case 'EC PRIVATE KEY': {
      const curve = curveOfSec1(der);
      if (!curve) throw new ToolError('The EC private key does not name its curve.');
      return ecPrivateJwk(curve, der);
    }
    case 'ENCRYPTED PRIVATE KEY':
      throw new ToolError('This private key is encrypted. Decrypt it first, for example: openssl pkey -in key.pem -out plain.pem');
    case 'OPENSSH PRIVATE KEY':
      throw new ToolError('OpenSSH private keys are not supported. Convert it: ssh-keygen -p -m PKCS8 -f key');
    default:
      throw new ToolError(`A "${label}" block is not a key.`);
  }
}

/** The JWK to use from a JWK, a JWK set or PEM text; `kid` and `alg` pick from a set. */
export function readKey(text: string, wanted: { kid?: unknown; alg?: unknown } = {}): Jwk {
  const trimmed = text.trim();
  if (trimmed.startsWith('-----BEGIN')) return pemToJwk(trimmed);
  if (!trimmed.startsWith('{')) throw new ToolError('Enter the key as PEM (-----BEGIN …) or as a JWK or JWK set (JSON).');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ToolError('The key looks like JSON but is not valid JSON.');
  }
  const object = parsed as { keys?: unknown; kty?: unknown };
  if (Array.isArray(object.keys)) {
    const keys = object.keys as Jwk[];
    const byKid = typeof wanted.kid === 'string' ? keys.filter((key) => key.kid === wanted.kid) : [];
    const byAlg = keys.filter((key) => key.alg === undefined || key.alg === wanted.alg);
    const kidMissing = typeof wanted.kid === 'string' && byKid.length === 0 && keys.some((key) => key.kid !== undefined);
    const chosen = kidMissing ? undefined : (byKid[0] ?? (keys.length === 1 ? keys[0] : byAlg.find((key) => key.use !== 'enc')));
    if (!chosen) throw new ToolError(typeof wanted.kid === 'string' ? `The key set has no key with kid "${wanted.kid}".` : 'The key set has several keys; the token names none (kid).');
    return chosen;
  }
  if (typeof object.kty !== 'string') throw new ToolError('A JWK needs a "kty" member.');
  return object as Jwk;
}

/** Converts a JWK to PEM (SubjectPublicKeyInfo, or PKCS #8 when it holds a private key). */
export function jwkToPem(jwk: Jwk, part: 'public' | 'private' = jwk.d ? 'private' : 'public'): string {
  const b = (value: string | undefined, what: string) => fromB64url(value ?? '', `The JWK member "${what}"`);
  if (jwk.kty === 'RSA') {
    const publicKey = seq(integer(b(jwk.n, 'n')), integer(b(jwk.e, 'e')));
    const algorithm = seq(oid(OID.rsa), NULL);
    if (part === 'public') return pem('PUBLIC KEY', seq(algorithm, bits(publicKey)));
    const fields = (['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'] as const).map((name) => integer(b(jwk[name], name)));
    return pem('PRIVATE KEY', seq(ZERO, algorithm, octets(seq(ZERO, ...fields))));
  }
  if (jwk.kty === 'EC') {
    const curve = jwk.crv as Curve;
    const curveOid = CURVE_OID_OF[curve];
    if (!curveOid) throw new ToolError(`The curve "${jwk.crv}" is not supported.`);
    const point = concatBytes(new Uint8Array([4]), b(jwk.x, 'x'), b(jwk.y, 'y'));
    const algorithm = seq(oid(OID.ec), oid(curveOid));
    if (part === 'public') return pem('PUBLIC KEY', seq(algorithm, bits(point)));
    const sec1 = seq(new Uint8Array([0x02, 0x01, 0x01]), octets(b(jwk.d, 'd')), tlv(0xa1, bits(point)));
    return pem('PRIVATE KEY', seq(ZERO, algorithm, octets(sec1)));
  }
  if (jwk.kty === 'OKP') {
    const algorithm = seq(oid(jwk.crv === 'Ed448' ? OID.ed448 : OID.ed25519));
    if (part === 'public') return pem('PUBLIC KEY', seq(algorithm, bits(b(jwk.x, 'x'))));
    return pem('PRIVATE KEY', seq(ZERO, algorithm, octets(octets(b(jwk.d, 'd')))));
  }
  throw new ToolError('Only RSA, EC and OKP keys can be written as PEM.');
}

export function publicJwk(jwk: Jwk): Jwk {
  const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, k: _k, ...rest } = jwk;
  return rest;
}

/** RFC 7638 thumbprint, used as a key ID. */
export function thumbprint(jwk: Jwk): string {
  const members: Record<string, (keyof Jwk)[]> = { RSA: ['e', 'kty', 'n'], EC: ['crv', 'kty', 'x', 'y'], OKP: ['crv', 'kty', 'x'], oct: ['k', 'kty'] };
  const canonical = `{${(members[jwk.kty] ?? []).map((name) => `"${name}":"${jwk[name]}"`).join(',')}}`;
  return b64url(sha256(utf8Encode(canonical)));
}

export function describeJwk(jwk: Jwk): string {
  if (jwk.kty === 'RSA') return `RSA ${unsigned(fromB64url(jwk.n ?? '', 'n')).length * 8}-bit ${jwk.d ? 'private' : 'public'} key`;
  if (jwk.kty === 'EC' || jwk.kty === 'OKP') return `${jwk.crv} ${jwk.d ? 'private' : 'public'} key`;
  return 'Shared secret';
}

/* ------------------------------------------------------- sign and verify -- */

const HASHES = { 256: sha256, 384: sha384, 512: sha512 } as const;
const bitsOf = (algorithm: Algorithm): 256 | 384 | 512 => Number(algorithm.slice(2, 5)) as 256 | 384 | 512;

/** Which key types an algorithm needs. */
export function keyKind(algorithm: Algorithm): 'secret' | 'rsa' | Curve | 'eddsa' | 'none' {
  if (algorithm.startsWith('HS')) return 'secret';
  if (algorithm.startsWith('RS') || algorithm.startsWith('PS')) return 'rsa';
  if (algorithm === 'ES256') return 'P-256';
  if (algorithm === 'ES384') return 'P-384';
  if (algorithm === 'ES512') return 'P-521';
  if (algorithm === 'ES256K') return 'secp256k1';
  if (algorithm === 'Ed25519') return 'Ed25519';
  if (algorithm === 'EdDSA') return 'eddsa';
  return 'none';
}

function checkKeyFits(algorithm: Algorithm, jwk: Jwk): void {
  const kind = keyKind(algorithm);
  if (kind === 'rsa' && jwk.kty !== 'RSA') throw new ToolError(`${algorithm} needs an RSA key; this is ${describeJwk(jwk)}.`);
  if (kind === 'eddsa' && (jwk.kty !== 'OKP' || (jwk.crv !== 'Ed25519' && jwk.crv !== 'Ed448'))) throw new ToolError(`EdDSA needs an Ed25519 or Ed448 key; this is ${describeJwk(jwk)}.`);
  if (kind !== 'rsa' && kind !== 'eddsa' && kind !== 'secret' && kind !== 'none' && jwk.crv !== kind) throw new ToolError(`${algorithm} needs a ${kind} key; this is ${describeJwk(jwk)}.`);
}

function rsaParams(algorithm: Algorithm): RsaHashedImportParams & { saltLength?: number } {
  const hash = `SHA-${bitsOf(algorithm)}`;
  return algorithm.startsWith('PS') ? { name: 'RSA-PSS', hash, saltLength: bitsOf(algorithm) / 8 } : { name: 'RSASSA-PKCS1-v1_5', hash };
}

async function rsaKey(algorithm: Algorithm, jwk: Jwk, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  const material: JsonWebKey = usage === 'verify' ? { kty: 'RSA', n: jwk.n, e: jwk.e } : { kty: 'RSA', n: jwk.n, e: jwk.e, d: jwk.d, p: jwk.p, q: jwk.q, dp: jwk.dp, dq: jwk.dq, qi: jwk.qi };
  try {
    return await crypto.subtle.importKey('jwk', material, rsaParams(algorithm), false, [usage]);
  } catch (error) {
    throw new ToolError(`The RSA key could not be used: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function signBytes(algorithm: Algorithm, key: Jwk | Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (algorithm === 'none') return new Uint8Array();
  if (algorithm.startsWith('HS')) {
    const secret = key instanceof Uint8Array ? key : fromB64url((key as Jwk).k ?? '', 'The JWK member "k"');
    return hmac(HASHES[bitsOf(algorithm)], secret, data);
  }
  if (key instanceof Uint8Array) throw new ToolError(`${algorithm} needs a private key, not a secret.`);
  checkKeyFits(algorithm, key);
  if (!key.d) throw new ToolError(`Signing needs a private key; this is ${describeJwk(key)}.`);
  const d = fromB64url(key.d, 'The private key');
  if (key.kty === 'RSA') {
    const params = rsaParams(algorithm);
    return new Uint8Array(
      await crypto.subtle.sign(
        params.name === 'RSA-PSS' ? { name: 'RSA-PSS', saltLength: params.saltLength as number } : { name: params.name },
        await rsaKey(algorithm, key, 'sign'),
        data as BufferSource,
      ),
    );
  }
  if (key.kty === 'OKP') return key.crv === 'Ed448' ? ed448.sign(data, d) : ed25519.sign(data, d);
  const curve = WEIERSTRASS[key.crv as keyof typeof WEIERSTRASS];
  return curve.sign(data, padTo(d, FIELD_BYTES[key.crv as string] as number), { prehash: true, lowS: key.crv === 'secp256k1', format: 'compact' });
}

export async function verifyBytes(algorithm: Algorithm, key: Jwk | Uint8Array, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
  if (algorithm === 'none') return signature.length === 0;
  if (algorithm.startsWith('HS')) {
    const expected = await signBytes(algorithm, key, data);
    if (expected.length !== signature.length) return false;
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference |= (expected[i] as number) ^ (signature[i] as number);
    return difference === 0;
  }
  if (key instanceof Uint8Array) throw new ToolError(`${algorithm} is checked with a public key, not a secret.`);
  checkKeyFits(algorithm, key);
  if (key.kty === 'RSA') {
    const params = rsaParams(algorithm);
    return crypto.subtle.verify(
      params.name === 'RSA-PSS' ? { name: 'RSA-PSS', saltLength: params.saltLength as number } : { name: params.name },
      await rsaKey(algorithm, key, 'verify'),
      signature as BufferSource,
      data as BufferSource,
    );
  }
  const x = fromB64url(key.x ?? '', 'The public key');
  try {
    if (key.kty === 'OKP') return key.crv === 'Ed448' ? ed448.verify(signature, data, x) : ed25519.verify(signature, data, x);
    const curve = WEIERSTRASS[key.crv as keyof typeof WEIERSTRASS];
    const point = concatBytes(new Uint8Array([4]), x, fromB64url(key.y ?? '', 'The public key'));
    if (signature.length !== 2 * (FIELD_BYTES[key.crv as string] as number)) return false;
    return curve.verify(signature, data, point, { prehash: true, lowS: false, format: 'compact' });
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- tokens -- */

export interface Token {
  readonly header: Record<string, unknown>;
  readonly payload: unknown;
  readonly payloadText: string;
  readonly signature: Uint8Array;
  readonly signingInput: string;
}

export function parseToken(text: string): Token {
  const compact = text.trim().replace(/^Bearer\s+/i, '');
  const parts = compact.split('.');
  if (parts.length === 5) throw new ToolError('This is an encrypted token (JWE, five parts). Its contents cannot be read without the key.');
  if (parts.length !== 3) throw new ToolError(`A JWT has three dot-separated parts (header.payload.signature); this has ${parts.length}.`);
  const [head, body, sig] = parts as [string, string, string];
  let header: unknown;
  try {
    header = JSON.parse(utf8Decode(fromB64url(head, 'The header')));
  } catch (error) {
    throw error instanceof ToolError ? error : new ToolError('The header is not valid JSON.');
  }
  if (header === null || typeof header !== 'object' || Array.isArray(header)) throw new ToolError('The header must be a JSON object.');
  const payloadText = (header as { b64?: unknown }).b64 === false ? body : utf8Decode(fromB64url(body, 'The payload'));
  let payload: unknown = payloadText;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    // A JWS payload need not be JSON; show it as text.
  }
  return { header: header as Record<string, unknown>, payload, payloadText, signature: fromB64url(sig, 'The signature'), signingInput: `${head}.${body}` };
}

export async function signToken(header: Record<string, unknown>, payload: unknown, algorithm: Algorithm, key: Jwk | Uint8Array): Promise<string> {
  const input = `${b64url(utf8Encode(JSON.stringify(header)))}.${b64url(utf8Encode(typeof payload === 'string' ? payload : JSON.stringify(payload)))}`;
  const signature = await signBytes(algorithm, key, utf8Encode(input));
  return `${input}.${b64url(signature)}`;
}

/* ------------------------------------------------------------ generation -- */

export interface KeyPair {
  readonly privateJwk: Jwk;
  readonly publicJwk: Jwk;
}

/** A new key pair (or a random secret) suitable for `algorithm`. */
export async function generateKey(algorithm: Algorithm, rsaBits = 2048): Promise<KeyPair | Uint8Array> {
  const kind = keyKind(algorithm);
  if (kind === 'secret') return crypto.getRandomValues(new Uint8Array(bitsOf(algorithm) / 8));
  if (kind === 'none') return new Uint8Array();
  if (kind === 'rsa') {
    const pair = (await crypto.subtle.generateKey({ ...rsaParams(algorithm), modulusLength: rsaBits, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const exported = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as Jwk & { key_ops?: unknown; ext?: unknown };
    const { key_ops: _ops, ext: _ext, alg: _alg, ...privateJwk } = exported;
    return { privateJwk, publicJwk: publicJwk(privateJwk) };
  }
  if (kind === 'eddsa' || kind === 'Ed25519' || kind === 'Ed448') {
    const crv = kind === 'Ed448' ? 'Ed448' : 'Ed25519';
    const { secretKey, publicKey } = crv === 'Ed448' ? ed448.keygen() : ed25519.keygen();
    const privateJwk: Jwk = { kty: 'OKP', crv, x: b64url(publicKey), d: b64url(secretKey) };
    return { privateJwk, publicJwk: publicJwk(privateJwk) };
  }
  const curve = WEIERSTRASS[kind as keyof typeof WEIERSTRASS];
  const { secretKey, publicKey } = curve.keygen();
  const jwk = { ...ecPointJwk(kind, publicKey), d: b64url(padTo(secretKey, FIELD_BYTES[kind] as number)) };
  return { privateJwk: jwk, publicJwk: publicJwk(jwk) };
}

/* ---------------------------------------------------------------- claims -- */

export const CLAIMS: Record<string, string> = {
  iss: 'Issuer: who created and signed the token',
  sub: 'Subject: whom the token is about (usually a user ID)',
  aud: 'Audience: who the token is meant for',
  exp: 'Expiration time: reject the token after this',
  nbf: 'Not before: reject the token before this',
  iat: 'Issued at',
  jti: 'JWT ID: unique identifier, used to prevent replay',
  name: 'Full name',
  given_name: 'Given name',
  family_name: 'Family name',
  middle_name: 'Middle name',
  nickname: 'Nickname',
  preferred_username: 'Preferred username',
  email: 'Email address',
  email_verified: 'Whether the email address was verified',
  phone_number: 'Phone number',
  phone_number_verified: 'Whether the phone number was verified',
  picture: 'Profile picture URL',
  profile: 'Profile page URL',
  website: 'Web site',
  gender: 'Gender',
  birthdate: 'Birthday',
  zoneinfo: 'Time zone',
  locale: 'Locale',
  updated_at: 'Time the profile was last updated',
  address: 'Postal address',
  nonce: 'Nonce: ties an ID token to the login request (OpenID Connect)',
  auth_time: 'Time the user authenticated',
  acr: 'Authentication context class',
  amr: 'Authentication methods used (pwd, otp, mfa…)',
  azp: 'Authorised party: the client the token was issued to',
  at_hash: 'Access token hash (OpenID Connect)',
  c_hash: 'Authorisation code hash (OpenID Connect)',
  sid: 'Session ID',
  scope: 'Granted scopes (OAuth)',
  scp: 'Granted scopes (OAuth)',
  client_id: 'OAuth client ID',
  roles: 'Roles',
  groups: 'Groups',
  entitlements: 'Entitlements',
  cnf: 'Confirmation: the key the token is bound to (proof of possession)',
  act: 'Actor: who acts on behalf of the subject (token exchange)',
  may_act: 'Who may act on behalf of the subject',
  events: 'Security events',
  tid: 'Tenant ID (Microsoft Entra ID)',
  oid: 'Object ID of the user (Microsoft Entra ID)',
  upn: 'User principal name (Microsoft)',
  ver: 'Token version',
  idp: 'Identity provider',
  typ: 'Token type',
};

export const HEADER_PARAMETERS: Record<string, string> = {
  alg: 'Algorithm used to sign the token',
  typ: 'Media type of the token (JWT, at+jwt for access tokens…)',
  cty: 'Content type of the payload (JWT when it is a nested token)',
  kid: 'Key ID: which key signed the token',
  jku: 'URL of the signer’s JWK set (do not trust it blindly)',
  jwk: 'The public key embedded in the header (do not trust it blindly)',
  x5u: 'URL of the signer’s certificate chain',
  x5c: 'The signer’s certificate chain',
  x5t: 'SHA-1 thumbprint of the signer’s certificate',
  'x5t#S256': 'SHA-256 thumbprint of the signer’s certificate',
  crit: 'Extensions the receiver must understand',
  b64: 'Whether the payload is Base64URL-encoded (RFC 7797)',
};
