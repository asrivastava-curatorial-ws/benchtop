/** Public-key operations: X.509, CSRs, PEM/JWK, RSA, ECDSA, SSH host keys and OIDs. */
import { type Certificate, decodeBlock, decodeOid, oidName, type PublicKeyInfo, parseCertificate, parseDer, readBlocks } from '../../lib/x509';
import { type Args, bArg, bool, bytesToLatin1, defineOp, hex, hexToBytes, OpError, type Operation, sArg, sel, toBytes, txt, utf8 } from '../core';
import { base64Decode, base64Encode } from './data-format';

const C = 'Public Key' as const;

const describeKey = (key: PublicKeyInfo) => `${key.algorithm}${key.curve ? ` ${key.curve}` : ''} ${key.bits} bits${key.exponent ? `, exponent ${key.exponent}` : ''}`;

function certificateText(cert: Certificate): string {
  return [
    `Version:          ${cert.version}`,
    `Serial number:    ${cert.serial}`,
    `Signature:        ${cert.signature}`,
    `Issuer:           ${cert.issuer}`,
    `Subject:          ${cert.subject}${cert.selfSigned ? ' (self-signed)' : ''}`,
    `Not before:       ${cert.notBefore.toISOString()}`,
    `Not after:        ${cert.notAfter.toISOString()}`,
    `Public key:       ${describeKey(cert.publicKey)}`,
    `SHA-256:          ${cert.sha256}`,
    `SHA-1:            ${cert.sha1}`,
    ...(cert.extensions.length ? ['Extensions:', ...cert.extensions.map((e) => `  ${e.name}${e.critical ? ' (critical)' : ''}: ${e.value}`)] : []),
  ].join('\n');
}

function derFrom(input: string, format: string): Uint8Array {
  const text = input.trim();
  switch (format) {
    case 'DER Hex':
      return hexToBytes(text);
    case 'Base64':
      return base64Decode(text, 'A-Za-z0-9+/=');
    case 'Raw':
      return toBytes(input);
    default: {
      const blocks = readBlocks(text, null);
      if (blocks.length === 0) throw new OpError('No PEM block was found.');
      return (blocks[0] as { der: Uint8Array }).der;
    }
  }
}

const pem = (label: string, der: Uint8Array) => `-----BEGIN ${label}-----\n${(base64Encode(der, 'A-Za-z0-9+/=').match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${label}-----`;

function spkiOf(certDer: Uint8Array): Uint8Array {
  const tbs = parseDer(certDer).children[0];
  if (!tbs) throw new OpError('This is not a certificate.');
  const offset = tbs.children[0]?.tag === 0xa0 ? 1 : 0;
  const spki = tbs.children[5 + offset];
  if (!spki) throw new OpError('The certificate has no public key.');
  return certDer.slice(spki.start, spki.start + spki.headerLength + spki.content.length);
}

function encodeOid(oid: string): Uint8Array {
  const parts = oid
    .trim()
    .split('.')
    .map((p) => BigInt(p));
  if (parts.length < 2) throw new OpError('An OID has at least two parts, such as 1.2.');
  const out: number[] = [];
  const push = (value: bigint) => {
    const bytes = [Number(value & 127n)];
    let v = value >> 7n;
    while (v > 0n) {
      bytes.unshift(Number((v & 127n) | 128n));
      v >>= 7n;
    }
    out.push(...bytes);
  };
  push((parts[0] as bigint) * 40n + (parts[1] as bigint));
  for (const part of parts.slice(2)) push(part);
  return Uint8Array.from(out);
}

/* --------------------------------------------------------------- RSA -- */

const bigFrom = (b64url: string): bigint => {
  const bytes = base64Decode(b64url, 'A-Za-z0-9\\-_');
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
};

function bigToBytes(n: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = n;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 255n);
    v >>= 8n;
  }
  return out;
}

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

interface RsaJwk {
  kty: string;
  n?: string;
  e?: string;
  d?: string;
}

async function rsaKey(text: string, wantPrivate: boolean): Promise<RsaJwk> {
  if (/ENCRYPTED/.test(text)) throw new OpError('Password-protected keys are not supported; decrypt the key first (openssl pkey).');
  const { readKey } = await import('../../lib/jws');
  const jwk = readKey(text) as RsaJwk;
  if (jwk.kty !== 'RSA') throw new OpError('This is not an RSA key.');
  if (wantPrivate && !jwk.d) throw new OpError('An RSA private key is needed.');
  return jwk;
}

const DIGESTS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

async function subtleRsa(jwk: RsaJwk, name: 'RSASSA-PKCS1-v1_5' | 'RSA-PSS' | 'RSA-OAEP', hash: string, usage: KeyUsage): Promise<CryptoKey> {
  const { alg: _alg, key_ops: _ops, ...clean } = jwk as RsaJwk & { alg?: unknown; key_ops?: unknown };
  const isPrivate = usage === 'sign' || usage === 'decrypt';
  const material = isPrivate ? clean : { kty: 'RSA', n: jwk.n, e: jwk.e };
  return crypto.subtle.importKey('jwk', material as JsonWebKey, { name, hash }, false, [usage]);
}

/* -------------------------------------------------------------- ECDSA -- */

function derToP1363(der: Uint8Array, size: number): Uint8Array {
  const root = parseDer(der);
  const [r, s] = root.children;
  if (!r || !s) throw new OpError('This is not an ASN.1 ECDSA signature.');
  const padTo = (v: Uint8Array) => {
    let x = v;
    while (x.length > size && x[0] === 0) x = x.slice(1);
    const out = new Uint8Array(size);
    out.set(x, size - x.length);
    return out;
  };
  return Uint8Array.from([...padTo(r.content), ...padTo(s.content)]);
}

function p1363ToDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  const int = (v: Uint8Array) => {
    let x = Array.from(v);
    while (x.length > 1 && x[0] === 0 && ((x[1] as number) & 0x80) === 0) x = x.slice(1);
    if ((x[0] as number) & 0x80) x.unshift(0);
    return [0x02, x.length, ...x];
  };
  const body = [...int(raw.slice(0, half)), ...int(raw.slice(half))];
  return Uint8Array.from(body.length < 128 ? [0x30, body.length, ...body] : [0x30, 0x81, body.length, ...body]);
}

function readSignature(input: string, format: string): { raw: Uint8Array | null; der: Uint8Array | null } {
  const text = input.trim();
  let kind = format;
  if (kind === 'Auto') {
    if (text.startsWith('{')) kind = 'Raw JSON';
    else if (/^30[0-9a-f]+$/i.test(text)) kind = 'ASN.1 HEX';
    else if (/^[0-9a-f]+$/i.test(text)) kind = 'P1363 HEX';
    else kind = 'JSON Web Signature';
  }
  if (kind === 'ASN.1 HEX') return { raw: null, der: hexToBytes(text) };
  if (kind === 'P1363 HEX') return { raw: hexToBytes(text), der: null };
  if (kind === 'JSON Web Signature') return { raw: base64Decode(text, 'A-Za-z0-9\\-_'), der: null };
  const json = JSON.parse(text) as { r?: string; s?: string };
  if (!json.r || !json.s) throw new OpError('Raw JSON signatures look like {"r": "…", "s": "…"} in hex.');
  const r = json.r.length % 2 ? `0${json.r}` : json.r;
  const s = json.s.length % 2 ? `0${json.s}` : json.s;
  const size = Math.max(r.length, s.length) / 2;
  return { raw: Uint8Array.from([...hexToBytes(r.padStart(size * 2, '0')), ...hexToBytes(s.padStart(size * 2, '0'))]), der: null };
}

function writeSignature(raw: Uint8Array, format: string): string {
  const half = raw.length / 2;
  switch (format) {
    case 'P1363 HEX':
      return hex(raw);
    case 'JSON Web Signature':
      return base64Encode(raw, 'A-Za-z0-9\\-_');
    case 'Raw JSON':
      return JSON.stringify({ r: hex(raw.slice(0, half)), s: hex(raw.slice(half)) });
    default:
      return hex(p1363ToDer(raw));
  }
}

const SIG_FORMATS = ['ASN.1 HEX', 'P1363 HEX', 'JSON Web Signature', 'Raw JSON'];
const CURVE_SIZE: Record<string, number> = { 'P-256': 32, 'P-384': 48, 'P-521': 66 };

async function ecKey(text: string, usage: KeyUsage): Promise<{ key: CryptoKey; curve: string }> {
  const { readKey } = await import('../../lib/jws');
  const jwk = readKey(text) as { kty: string; crv?: string; d?: string; x?: string; y?: string };
  if (jwk.kty !== 'EC' || !jwk.crv || !CURVE_SIZE[jwk.crv]) throw new OpError('An EC key on P-256, P-384 or P-521 is needed.');
  if (usage === 'sign' && !jwk.d) throw new OpError('An EC private key is needed.');
  const material = usage === 'sign' ? { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } : { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y };
  return { key: await crypto.subtle.importKey('jwk', material, { name: 'ECDSA', namedCurve: jwk.crv }, false, [usage]), curve: jwk.crv };
}

function messageBytes(text: string, format: string): Uint8Array {
  if (format === 'Hex') return hexToBytes(text);
  if (format === 'Base64') return base64Decode(text, 'A-Za-z0-9+/=');
  return toBytes(text);
}

/* -------------------------------------------------------------- SSH -- */

function readSshString(view: Uint8Array, at: number): [Uint8Array, number] {
  const length = (((view[at] as number) << 24) | ((view[at + 1] as number) << 16) | ((view[at + 2] as number) << 8) | (view[at + 3] as number)) >>> 0;
  if (at + 4 + length > view.length) throw new OpError('The key data ends early.');
  return [view.slice(at + 4, at + 4 + length), at + 4 + length];
}

async function parseSshKey(input: string, format: string): Promise<string> {
  const text = input.trim();
  let blob: Uint8Array;
  const parts = text.split(/\s+/);
  if (format === 'Hex' || (format === 'Auto' && /^[0-9a-f\s:,;]+$/i.test(text) && !/^[A-Za-z0-9+/=]+$/.test(text.replace(/\s/g, '')))) blob = hexToBytes(text);
  else blob = base64Decode(parts.length > 1 && /^(ssh-|ecdsa-|sk-)/.test(parts[0] ?? '') ? (parts[1] ?? '') : (parts[0] ?? ''), 'A-Za-z0-9+/=');
  const [typeBytes, afterType] = readSshString(blob, 0);
  const type = new TextDecoder().decode(typeBytes);
  const lines = [`Key type: ${type}`];
  let at = afterType;
  if (type === 'ssh-rsa') {
    const [e, next] = readSshString(blob, at);
    const [n] = readSshString(blob, next);
    const modulus = n[0] === 0 ? n.slice(1) : n;
    lines.push(`Key size: ${modulus.length * 8} bits`, `Exponent: 0x${hex(e)}`, `Modulus: 0x${hex(modulus)}`);
  } else if (type.startsWith('ecdsa-')) {
    const [curve, next] = readSshString(blob, at);
    const [point] = readSshString(blob, next);
    lines.push(`Curve: ${new TextDecoder().decode(curve)}`, `Point: 0x${hex(point)}`);
  } else if (type === 'ssh-ed25519' || type === 'ssh-dss') {
    while (at < blob.length) {
      const [field, next] = readSshString(blob, at);
      lines.push(`Value: 0x${hex(field)}`);
      at = next;
    }
  }
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const { md5 } = await import('@noble/hashes/legacy.js');
  lines.push(`SHA256 fingerprint: SHA256:${base64Encode(sha256(blob), 'A-Za-z0-9+/')}`, `MD5 fingerprint: ${hex(md5(blob), ':')}`);
  return lines.join('\n');
}

/* --------------------------------------------------------- operations -- */

const rsaPadding = (a: Args) => sArg(a, 'scheme');

export const publicKeyOps: Operation[] = [
  defineOp({
    name: 'Parse X.509 certificate',
    category: C,
    description: 'Shows the subject, issuer, validity, key, fingerprints and extensions of a certificate.',
    input: 'text',
    output: 'text',
    keywords: ['ssl', 'tls', 'pem', 'der'],
    args: [sel('format', 'Input format', ['PEM', 'DER Hex', 'Base64', 'Raw'])],
    run: (input, a) => certificateText(parseCertificate(derFrom(input, sArg(a, 'format')))),
  }),
  defineOp({
    name: 'Parse X.509 certificate bundles',
    category: C,
    description: 'Shows every certificate in a PEM bundle or chain.',
    input: 'text',
    output: 'text',
    run: (input) => {
      const blocks = readBlocks(input, null).filter((b) => /CERTIFICATE/.test(b.label));
      if (blocks.length === 0) throw new OpError('No certificates were found.');
      return blocks.map((block, i) => `Certificate ${i + 1}\n${certificateText(parseCertificate(block.der))}`).join('\n\n');
    },
  }),
  defineOp({
    name: 'Hex to Object Identifier',
    category: C,
    description: 'Decodes a DER-encoded OID (hex) to dotted notation.',
    input: 'text',
    output: 'text',
    run: (input) => {
      let bytes = hexToBytes(input);
      if (bytes[0] === 0x06 && bytes[1] === bytes.length - 2) bytes = bytes.slice(2);
      const oid = decodeOid(bytes);
      const name = oidName(oid);
      return name && name !== oid ? `${oid} (${name})` : oid;
    },
  }),
  defineOp({
    name: 'Object Identifier to Hex',
    category: C,
    description: 'Encodes a dotted OID as DER content bytes (hex).',
    input: 'text',
    output: 'text',
    run: (input) => hex(encodeOid(input)),
  }),
  defineOp({
    name: 'PEM to JWK',
    category: C,
    description: 'Converts a PEM public or private key (RSA, EC, Ed25519) to a JSON Web Key.',
    input: 'text',
    output: 'text',
    args: [bool('kid', 'Set key ID (kid) to RFC 7638 thumbprint')],
    run: async (input, a) => {
      const jws = await import('../../lib/jws');
      const blocks = [...input.matchAll(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g)].map((m) => m[0]);
      if (blocks.length === 0) throw new OpError('No PEM block was found.');
      const keys = blocks.map((block) => {
        const jwk = jws.pemToJwk(block);
        return bArg(a, 'kid') ? { ...jwk, kid: jws.thumbprint(jwk) } : jwk;
      });
      return JSON.stringify(keys.length === 1 ? keys[0] : { keys }, null, 4);
    },
  }),
  defineOp({
    name: 'JWK to PEM',
    category: C,
    description: 'Converts a JSON Web Key (or key set) to PEM.',
    input: 'text',
    output: 'text',
    run: async (input) => {
      const jws = await import('../../lib/jws');
      const parsed = JSON.parse(input) as { keys?: unknown[] };
      const keys = Array.isArray(parsed.keys) ? parsed.keys : [parsed];
      return keys.map((key) => jws.jwkToPem(key as never)).join('\n');
    },
  }),
  defineOp({
    name: 'Generate RSA Key Pair',
    category: C,
    description: 'Generates an RSA key pair.',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [sel('bits', 'RSA Key Length', ['1024', '2048', '4096'], '2048'), sel('format', 'Output Format', ['PEM', 'JSON', 'DER'])],
    run: async (_input, a) => {
      const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: Number(sArg(a, 'bits')), publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' }, true, [
        'sign',
        'verify',
      ])) as CryptoKeyPair;
      const format = sArg(a, 'format');
      if (format === 'JSON') return JSON.stringify({ privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey), publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) }, null, 4);
      const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
      const pub = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
      if (format === 'DER') return `Private key (PKCS #8): ${hex(priv)}\n\nPublic key (SPKI): ${hex(pub)}`;
      return `${pem('PRIVATE KEY', priv)}\n${pem('PUBLIC KEY', pub)}`;
    },
  }),
  defineOp({
    name: 'RSA Sign',
    category: C,
    description: 'Signs the input with an RSA private key (PKCS #1 v1.5). Outputs the raw signature.',
    input: 'text',
    output: 'bytes',
    args: [txt('key', 'RSA Private Key (PEM)', '-----BEGIN RSA PRIVATE KEY-----'), sel('digest', 'Message Digest Algorithm', DIGESTS, 'SHA-256')],
    run: async (input, a) => {
      const key = await subtleRsa(await rsaKey(sArg(a, 'key'), true), 'RSASSA-PKCS1-v1_5', sArg(a, 'digest'), 'sign');
      return new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, toBytes(input) as BufferSource));
    },
  }),
  defineOp({
    name: 'RSA Verify',
    category: C,
    description: 'Checks a raw RSA signature (the input) against a message and public key.',
    input: 'bytes',
    output: 'text',
    args: [
      txt('key', 'RSA Public Key (PEM)', '-----BEGIN PUBLIC KEY-----'),
      txt('message', 'Message', ''),
      sel('format', 'Message format', ['Raw', 'Hex', 'Base64']),
      sel('digest', 'Message Digest Algorithm', DIGESTS, 'SHA-256'),
    ],
    run: async (input, a) => {
      const key = await subtleRsa(await rsaKey(sArg(a, 'key'), false), 'RSASSA-PKCS1-v1_5', sArg(a, 'digest'), 'verify');
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, input as BufferSource, messageBytes(sArg(a, 'message'), sArg(a, 'format')) as BufferSource);
      if (!ok) throw new OpError('Verification failure: the signature does not match.');
      return 'Verified OK';
    },
  }),
  defineOp({
    name: 'RSA Encrypt',
    category: C,
    description: 'Encrypts with an RSA public key (OAEP, PKCS #1 v1.5 or raw).',
    input: 'text',
    output: 'bytes',
    volatile: true,
    args: [
      txt('key', 'RSA Public Key (PEM)', '-----BEGIN PUBLIC KEY-----'),
      sel('scheme', 'Encryption Scheme', ['RSA-OAEP', 'RSAES-PKCS1-V1_5', 'RAW']),
      sel('digest', 'Message Digest Algorithm', DIGESTS, 'SHA-1', { showIf: (a) => a.scheme === 'RSA-OAEP' }),
    ],
    run: async (input, a) => {
      const jwk = await rsaKey(sArg(a, 'key'), false);
      const data = toBytes(input);
      if (rsaPadding(a) === 'RSA-OAEP') {
        const key = await subtleRsa(jwk, 'RSA-OAEP', sArg(a, 'digest'), 'encrypt');
        return new Uint8Array(await crypto.subtle.encrypt('RSA-OAEP', key, data as BufferSource));
      }
      const n = bigFrom(jwk.n ?? '');
      const e = bigFrom(jwk.e ?? '');
      const size = Math.ceil(n.toString(16).length / 2);
      let block = data;
      if (rsaPadding(a) === 'RSAES-PKCS1-V1_5') {
        if (data.length > size - 11) throw new OpError(`The message is too long for this key (at most ${size - 11} bytes).`);
        const filler = Array.from(crypto.getRandomValues(new Uint8Array(size - 3 - data.length)), (b) => b || 1);
        block = Uint8Array.from([0, 2, ...filler, 0, ...data]);
      }
      let m = 0n;
      for (const b of block) m = (m << 8n) | BigInt(b);
      if (m >= n) throw new OpError('The message is too long for this key.');
      return bigToBytes(modPow(m, e, n), size);
    },
  }),
  defineOp({
    name: 'RSA Decrypt',
    category: C,
    description: 'Decrypts with an RSA private key (OAEP, PKCS #1 v1.5 or raw).',
    input: 'bytes',
    output: 'text',
    args: [
      txt('key', 'RSA Private Key (PEM)', '-----BEGIN RSA PRIVATE KEY-----'),
      sel('scheme', 'Encryption Scheme', ['RSA-OAEP', 'RSAES-PKCS1-V1_5', 'RAW']),
      sel('digest', 'Message Digest Algorithm', DIGESTS, 'SHA-1', { showIf: (a) => a.scheme === 'RSA-OAEP' }),
    ],
    run: async (input, a) => {
      const jwk = await rsaKey(sArg(a, 'key'), true);
      if (rsaPadding(a) === 'RSA-OAEP') {
        const key = await subtleRsa(jwk, 'RSA-OAEP', sArg(a, 'digest'), 'decrypt');
        try {
          return bytesToLatin1(new Uint8Array(await crypto.subtle.decrypt('RSA-OAEP', key, input as BufferSource)));
        } catch {
          throw new OpError('Decryption failed: wrong key or padding scheme.');
        }
      }
      const n = bigFrom(jwk.n ?? '');
      const d = bigFrom(jwk.d ?? '');
      let c = 0n;
      for (const b of input) c = (c << 8n) | BigInt(b);
      const size = Math.ceil(n.toString(16).length / 2);
      const block = bigToBytes(modPow(c, d, n), size);
      if (rsaPadding(a) === 'RAW') return bytesToLatin1(block);
      if (block[0] !== 0 || block[1] !== 2) throw new OpError('Decryption failed: the PKCS #1 v1.5 padding is wrong (wrong key?).');
      const zero = block.indexOf(0, 2);
      if (zero < 10) throw new OpError('Decryption failed: the PKCS #1 v1.5 padding is wrong.');
      return bytesToLatin1(block.slice(zero + 1));
    },
  }),
  defineOp({
    name: 'Generate ECDSA Key Pair',
    category: C,
    description: 'Generates an elliptic-curve key pair on P-256, P-384 or P-521.',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [sel('curve', 'Elliptic Curve', ['P-256', 'P-384', 'P-521']), sel('format', 'Output Format', ['PEM', 'DER', 'JWK'])],
    run: async (_input, a) => {
      const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: sArg(a, 'curve') }, true, ['sign', 'verify'])) as CryptoKeyPair;
      const format = sArg(a, 'format');
      if (format === 'JWK') return JSON.stringify({ privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey), publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) }, null, 4);
      const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
      const pub = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
      if (format === 'DER') return `Private key (PKCS #8): ${hex(priv)}\n\nPublic key (SPKI): ${hex(pub)}`;
      return `${pem('PRIVATE KEY', priv)}\n${pem('PUBLIC KEY', pub)}`;
    },
  }),
  defineOp({
    name: 'ECDSA Signature Conversion',
    category: C,
    description: 'Converts ECDSA signatures between ASN.1 DER, IEEE P1363, JWS and {r, s} JSON.',
    input: 'text',
    output: 'text',
    args: [sel('from', 'Input Format', ['Auto', ...SIG_FORMATS]), sel('to', 'Output Format', SIG_FORMATS)],
    run: (input, a) => {
      const sig = readSignature(input, sArg(a, 'from'));
      let raw = sig.raw;
      if (!raw && sig.der) {
        const root = parseDer(sig.der);
        const size = Math.max(...root.children.map((c) => c.content.length - (c.content[0] === 0 ? 1 : 0)));
        raw = derToP1363(sig.der, size);
      }
      return writeSignature(raw as Uint8Array, sArg(a, 'to'));
    },
  }),
  defineOp({
    name: 'ECDSA Sign',
    category: C,
    description: 'Signs the input with an EC private key.',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [
      txt('key', 'ECDSA Private Key (PEM)', '-----BEGIN EC PRIVATE KEY-----'),
      sel('digest', 'Message Digest Algorithm', ['SHA-256', 'SHA-384', 'SHA-512', 'SHA-1']),
      sel('format', 'Output Format', SIG_FORMATS),
    ],
    run: async (input, a) => {
      const { key } = await ecKey(sArg(a, 'key'), 'sign');
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: sArg(a, 'digest') }, key, toBytes(input) as BufferSource));
      return writeSignature(raw, sArg(a, 'format'));
    },
  }),
  defineOp({
    name: 'ECDSA Verify',
    category: C,
    description: 'Checks an ECDSA signature (the input) against a message and EC public key.',
    input: 'text',
    output: 'text',
    args: [
      sel('from', 'Input Format', ['Auto', ...SIG_FORMATS]),
      sel('digest', 'Message Digest Algorithm', ['SHA-256', 'SHA-384', 'SHA-512', 'SHA-1']),
      txt('key', 'ECDSA Public Key (PEM)', '-----BEGIN PUBLIC KEY-----'),
      txt('message', 'Message', ''),
      sel('format', 'Message format', ['Raw', 'Hex', 'Base64']),
    ],
    run: async (input, a) => {
      const { key, curve } = await ecKey(sArg(a, 'key'), 'verify');
      const sig = readSignature(input, sArg(a, 'from'));
      const raw = sig.raw ?? derToP1363(sig.der as Uint8Array, CURVE_SIZE[curve] ?? 32);
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: sArg(a, 'digest') }, key, raw as BufferSource, messageBytes(sArg(a, 'message'), sArg(a, 'format')) as BufferSource);
      if (!ok) throw new OpError('Verification failure: the signature does not match.');
      return 'Verified OK';
    },
  }),
  defineOp({
    name: 'Parse SSH Host Key',
    category: C,
    also: ['Networking'],
    description: 'Shows the type, size, values and fingerprints of an SSH public key.',
    input: 'text',
    output: 'text',
    args: [sel('format', 'Input Format', ['Auto', 'Base64', 'Hex'])],
    magic: [{ pattern: /^\s*([A-F\d]{2}[,;:]){15,}[A-F\d]{2}\s*$/i, args: { format: 'Hex' } }],
    run: (input, a) => parseSshKey(input, sArg(a, 'format')),
  }),
  defineOp({
    name: 'Parse CSR',
    category: C,
    description: 'Shows the subject, key and requested extensions of a certificate signing request.',
    input: 'text',
    output: 'text',
    args: [sel('format', 'Input format', ['PEM'])],
    run: (input) => {
      const block = readBlocks(input, null)[0];
      if (!block) throw new OpError('No PEM block was found.');
      const decoded = decodeBlock(block);
      if (decoded.kind !== 'request') throw new OpError('This is not a certificate signing request.');
      return [
        `Subject:    ${decoded.subject}`,
        `Public key: ${describeKey(decoded.publicKey)}`,
        `Signature:  ${decoded.signature}`,
        ...decoded.extensions.map((e) => `${e.name}${e.critical ? ' (critical)' : ''}: ${e.value}`),
      ].join('\n');
    },
  }),
  defineOp({
    name: 'Public Key from Certificate',
    category: C,
    description: 'Extracts the public key of a certificate as PEM.',
    input: 'text',
    output: 'text',
    run: (input) => {
      const blocks = readBlocks(input, null).filter((b) => /CERTIFICATE/.test(b.label));
      if (blocks.length === 0) throw new OpError('No certificate was found.');
      return blocks.map((block) => pem('PUBLIC KEY', spkiOf(block.der))).join('\n');
    },
  }),
  defineOp({
    name: 'Public Key from Private Key',
    category: C,
    description: 'Derives the public key (PEM) from an RSA, EC or Ed25519 private key.',
    input: 'text',
    output: 'text',
    run: async (input) => {
      const jws = await import('../../lib/jws');
      const jwk = jws.readKey(input);
      return jws.jwkToPem(jws.publicJwk(jwk), 'public');
    },
  }),
];

export { utf8 };
