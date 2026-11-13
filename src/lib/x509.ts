/**
 * Reads X.509 certificates, certificate requests and keys (PEM or DER)
 * with a small DER parser.  Nothing is verified cryptographically: this
 * describes what a file contains.
 */
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromBase64, toHex } from './bytes';
import { ToolError } from './errors';
import { formatIPv6 } from './subnet';

/* -------------------------------------------------------------------- DER -- */

export interface Der {
  readonly tag: number;
  readonly constructed: boolean;
  readonly tagClass: number;
  readonly tagNumber: number;
  readonly start: number;
  readonly headerLength: number;
  readonly content: Uint8Array;
  readonly children: readonly Der[];
}

export function parseDer(bytes: Uint8Array, offset = 0, end = bytes.length, depth = 0): Der {
  if (depth > 40) throw new ToolError('The data is nested too deeply to be a certificate.');
  if (offset + 2 > end) throw new ToolError('The data ends in the middle of a value.');
  const tag = bytes[offset] as number;
  if ((tag & 0x1f) === 0x1f) throw new ToolError('High tag numbers are not used in certificates.');
  let length = bytes[offset + 1] as number;
  let header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0) throw new ToolError('Indefinite lengths are not allowed in DER.');
    if (count > 4) throw new ToolError('A value is too large to be part of a certificate.');
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + (bytes[offset + 2 + i] as number);
    header += count;
  }
  const contentStart = offset + header;
  if (contentStart + length > end) throw new ToolError('The data is truncated: a value is longer than the data that contains it.');
  const content = bytes.subarray(contentStart, contentStart + length);
  const constructed = (tag & 0x20) !== 0;
  const children: Der[] = [];
  if (constructed) {
    let position = contentStart;
    while (position < contentStart + length) {
      const child = parseDer(bytes, position, contentStart + length, depth + 1);
      children.push(child);
      position = child.start + child.headerLength + child.content.length;
    }
  }
  return { tag, constructed, tagClass: tag >> 6, tagNumber: tag & 0x1f, start: offset, headerLength: header, content, children };
}

const child = (node: Der | undefined, index: number): Der => {
  const found = node?.children[index];
  if (!found) throw new ToolError('This is not a structure this tool recognises.');
  return found;
};

export function decodeOid(content: Uint8Array): string {
  const parts: number[] = [];
  let value = 0;
  for (const byte of content) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      if (parts.length === 0) parts.push(value < 80 ? Math.floor(value / 40) : 2, value < 80 ? value % 40 : value - 80);
      else parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

const decodeString = (node: Der): string => {
  if (node.tag === 0x1e) {
    // BMPString: UTF-16 big-endian.
    let text = '';
    for (let i = 0; i + 1 < node.content.length; i += 2) text += String.fromCharCode(((node.content[i] as number) << 8) | (node.content[i + 1] as number));
    return text;
  }
  return new TextDecoder().decode(node.content);
};

function decodeTime(node: Der): Date {
  const text = new TextDecoder().decode(node.content);
  const match = node.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(text) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/.exec(text);
  if (!match) throw new ToolError(`"${text}" is not a valid certificate time.`);
  let year = Number(match[1]);
  if (node.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)));
}

/* ------------------------------------------------------------------- OIDs -- */

const OIDS: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'street',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'title',
  '2.5.4.17': 'postalCode',
  '2.5.4.42': 'GN',
  '2.5.4.97': 'organizationIdentifier',
  '0.9.2342.19200300.100.1.1': 'UID',
  '0.9.2342.19200300.100.1.25': 'DC',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.113549.1.1.4': 'MD5 with RSA',
  '1.2.840.113549.1.1.5': 'SHA-1 with RSA',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.113549.1.1.11': 'SHA-256 with RSA',
  '1.2.840.113549.1.1.12': 'SHA-384 with RSA',
  '1.2.840.113549.1.1.13': 'SHA-512 with RSA',
  '1.2.840.10045.2.1': 'EC',
  '1.2.840.10045.4.1': 'ECDSA with SHA-1',
  '1.2.840.10045.4.3.2': 'ECDSA with SHA-256',
  '1.2.840.10045.4.3.3': 'ECDSA with SHA-384',
  '1.2.840.10045.4.3.4': 'ECDSA with SHA-512',
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
  '1.3.132.0.10': 'secp256k1',
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '1.2.840.10040.4.1': 'DSA',
  '1.3.6.1.5.5.7.3.1': 'TLS server authentication',
  '1.3.6.1.5.5.7.3.2': 'TLS client authentication',
  '1.3.6.1.5.5.7.3.3': 'Code signing',
  '1.3.6.1.5.5.7.3.4': 'Email protection',
  '1.3.6.1.5.5.7.3.8': 'Time stamping',
  '1.3.6.1.5.5.7.3.9': 'OCSP signing',
  '2.5.29.37.0': 'Any purpose',
  '2.23.140.1.2.1': 'Domain validated (DV)',
  '2.23.140.1.2.2': 'Organisation validated (OV)',
  '2.23.140.1.2.3': 'Individual validated (IV)',
  '2.23.140.1.1': 'Extended validation (EV)',
  '1.3.6.1.5.5.7.48.1': 'OCSP',
  '1.3.6.1.5.5.7.48.2': 'CA issuers',
};

const EXTENSION_NAMES: Record<string, string> = {
  '2.5.29.14': 'Subject key identifier',
  '2.5.29.15': 'Key usage',
  '2.5.29.17': 'Subject alternative names',
  '2.5.29.19': 'Basic constraints',
  '2.5.29.31': 'CRL distribution points',
  '2.5.29.32': 'Certificate policies',
  '2.5.29.35': 'Authority key identifier',
  '2.5.29.37': 'Extended key usage',
  '1.3.6.1.5.5.7.1.1': 'Authority information access',
  '1.3.6.1.4.1.11129.2.4.2': 'Signed certificate timestamps',
};

export const oidName = (oid: string): string => OIDS[oid] ?? oid;

/* ------------------------------------------------------------- structures -- */

function decodeName(node: Der): string {
  return node.children
    .flatMap((set) => set.children)
    .map((pair) => {
      const type = oidName(decodeOid(child(pair, 0).content));
      const value = decodeString(child(pair, 1)).replace(/([,+"\\<>;])/g, '\\$1');
      return `${type}=${value}`;
    })
    .join(', ');
}

export interface PublicKeyInfo {
  readonly algorithm: string;
  readonly bits: number;
  readonly curve?: string;
  readonly exponent?: number;
}

function bitLength(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length && bytes[i] === 0) i++;
  if (i === bytes.length) return 0;
  return (bytes.length - i - 1) * 8 + (32 - Math.clz32(bytes[i] as number));
}

function decodePublicKey(spki: Der): PublicKeyInfo {
  const algorithm = child(spki, 0);
  const oid = decodeOid(child(algorithm, 0).content);
  const name = oidName(oid);
  const keyBits = child(spki, 1).content.subarray(1);
  if (name === 'RSA') {
    const key = parseDer(keyBits);
    const exponentBytes = child(key, 1).content;
    let exponent = 0;
    for (const byte of exponentBytes) exponent = exponent * 256 + byte;
    return { algorithm: 'RSA', bits: bitLength(child(key, 0).content), exponent };
  }
  if (name === 'EC') {
    const curve = oidName(decodeOid(child(algorithm, 1).content));
    const bits = { 'P-256': 256, 'P-384': 384, 'P-521': 521, secp256k1: 256 }[curve] ?? (keyBits.length - 1) * 4;
    return { algorithm: 'EC', bits, curve };
  }
  if (name === 'Ed25519' || name === 'X25519') return { algorithm: name, bits: 256 };
  if (name === 'Ed448' || name === 'X448') return { algorithm: name, bits: name === 'Ed448' ? 456 : 448 };
  return { algorithm: name, bits: keyBits.length * 8 };
}

const describeKey = (key: PublicKeyInfo): string => (key.algorithm === 'RSA' ? `RSA ${key.bits}-bit (exponent ${key.exponent})` : key.algorithm === 'EC' ? `EC ${key.curve}` : key.algorithm);

function generalNames(node: Der): string[] {
  return node.children.map((name) => {
    switch (name.tag) {
      case 0x82:
        return `DNS:${new TextDecoder().decode(name.content)}`;
      case 0x81:
        return `email:${new TextDecoder().decode(name.content)}`;
      case 0x86:
        return `URI:${new TextDecoder().decode(name.content)}`;
      case 0x87: {
        const bytes = [...name.content];
        if (bytes.length === 4) return `IP:${bytes.join('.')}`;
        if (bytes.length === 16) return `IP:${formatIPv6(bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n))}`;
        return `IP:${toHex(name.content)}`;
      }
      case 0xa4:
        return `DirName:${decodeName(child(name, 0))}`;
      default:
        return `other name (tag ${name.tag.toString(16)})`;
    }
  });
}

const KEY_USAGE = ['Digital signature', 'Non-repudiation', 'Key encipherment', 'Data encipherment', 'Key agreement', 'Certificate signing', 'CRL signing', 'Encipher only', 'Decipher only'];

function collectUris(node: Der, out: string[]): string[] {
  if (node.tag === 0x86) out.push(new TextDecoder().decode(node.content));
  for (const item of node.children) collectUris(item, out);
  return out;
}

export interface Extension {
  readonly oid: string;
  readonly name: string;
  readonly critical: boolean;
  readonly value: string;
}

function decodeExtension(node: Der): Extension {
  const oid = decodeOid(child(node, 0).content);
  const critical = node.children.length === 3 && child(node, 1).tag === 0x01 && child(node, 1).content[0] !== 0;
  const raw = child(node, node.children.length - 1).content;
  let value: string;
  try {
    const inner = parseDer(raw);
    switch (oid) {
      case '2.5.29.17':
        value = generalNames(inner).join(', ');
        break;
      case '2.5.29.15': {
        const unused = inner.content[0] as number;
        const bits: string[] = [];
        for (let i = 0; i < (inner.content.length - 1) * 8 - unused; i++) if (((inner.content[1 + (i >> 3)] as number) >> (7 - (i & 7))) & 1) bits.push(KEY_USAGE[i] ?? `bit ${i}`);
        value = bits.join(', ');
        break;
      }
      case '2.5.29.37':
        value = inner.children.map((item) => oidName(decodeOid(item.content))).join(', ');
        break;
      case '2.5.29.19': {
        const ca = inner.children[0]?.tag === 0x01 && inner.children[0].content[0] !== 0;
        const pathLength = inner.children.find((item) => item.tag === 0x02);
        value = `CA: ${ca ? 'yes' : 'no'}${pathLength ? `, path length ${pathLength.content.reduce((n, b) => n * 256 + b, 0)}` : ''}`;
        break;
      }
      case '2.5.29.14':
        value = toHex(inner.content, { separator: ':', upper: true });
        break;
      case '2.5.29.35': {
        const id = inner.children.find((item) => item.tag === 0x80);
        value = id ? toHex(id.content, { separator: ':', upper: true }) : '(no key identifier)';
        break;
      }
      case '1.3.6.1.5.5.7.1.1':
        value = inner.children.map((access) => `${oidName(decodeOid(child(access, 0).content))}: ${generalNames({ ...access, children: [child(access, 1)] }).join('')}`).join(', ');
        break;
      case '2.5.29.31':
        value = collectUris(inner, []).join(', ');
        break;
      case '2.5.29.32':
        value = inner.children.map((policy) => oidName(decodeOid(child(policy, 0).content))).join(', ');
        break;
      default:
        value = `${raw.length} bytes`;
    }
  } catch {
    value = `${raw.length} bytes`;
  }
  return { oid, name: EXTENSION_NAMES[oid] ?? oid, critical, value };
}

export interface Certificate {
  readonly kind: 'certificate';
  readonly version: number;
  readonly serial: string;
  readonly subject: string;
  readonly issuer: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly publicKey: PublicKeyInfo;
  readonly signature: string;
  readonly extensions: readonly Extension[];
  readonly selfSigned: boolean;
  readonly sha256: string;
  readonly sha1: string;
}

export function parseCertificate(der: Uint8Array): Certificate {
  const root = parseDer(der);
  const tbs = child(root, 0);
  let index = 0;
  let version = 1;
  if (child(tbs, 0).tag === 0xa0) {
    version = (child(child(tbs, 0), 0).content[0] as number) + 1;
    index = 1;
  }
  const serialBytes = child(tbs, index).content;
  const serial = toHex(serialBytes[0] === 0 && serialBytes.length > 1 ? serialBytes.subarray(1) : serialBytes, { separator: ':', upper: true });
  const issuer = decodeName(child(tbs, index + 2));
  const validity = child(tbs, index + 3);
  const subject = decodeName(child(tbs, index + 4));
  const publicKey = decodePublicKey(child(tbs, index + 5));
  const extensionsNode = tbs.children.find((item) => item.tag === 0xa3);
  const extensions = extensionsNode ? child(extensionsNode, 0).children.map(decodeExtension) : [];
  return {
    kind: 'certificate',
    version,
    serial,
    subject,
    issuer,
    notBefore: decodeTime(child(validity, 0)),
    notAfter: decodeTime(child(validity, 1)),
    publicKey,
    signature: oidName(decodeOid(child(child(root, 1), 0).content)),
    extensions,
    selfSigned: subject === issuer,
    sha256: toHex(sha256(der), { separator: ':', upper: true }),
    sha1: toHex(sha1(der), { separator: ':', upper: true }),
  };
}

export interface CertificateRequest {
  readonly kind: 'request';
  readonly subject: string;
  readonly publicKey: PublicKeyInfo;
  readonly signature: string;
  readonly extensions: readonly Extension[];
}

export function parseRequest(der: Uint8Array): CertificateRequest {
  const root = parseDer(der);
  const info = child(root, 0);
  const attributes = info.children.find((item) => item.tag === 0xa0);
  const extensions: Extension[] = [];
  for (const attribute of attributes?.children ?? []) {
    if (decodeOid(child(attribute, 0).content) === '1.2.840.113549.1.9.14') extensions.push(...child(child(attribute, 1), 0).children.map(decodeExtension));
  }
  return { kind: 'request', subject: decodeName(child(info, 1)), publicKey: decodePublicKey(child(info, 2)), signature: oidName(decodeOid(child(child(root, 1), 0).content)), extensions };
}

export interface KeyFile {
  readonly kind: 'public key' | 'private key';
  readonly format: string;
  readonly description: string;
}

function describePrivateKey(label: string, der: Uint8Array): KeyFile {
  const root = parseDer(der);
  if (label === 'RSA PRIVATE KEY') return { kind: 'private key', format: 'PKCS #1', description: `RSA ${bitLength(child(root, 1).content)}-bit` };
  if (label === 'EC PRIVATE KEY') {
    const params = root.children.find((item) => item.tag === 0xa0);
    return { kind: 'private key', format: 'SEC 1', description: `EC ${params ? oidName(decodeOid(child(params, 0).content)) : ''}`.trim() };
  }
  // PKCS #8: version, algorithm, key.
  const algorithm = child(root, 1);
  const name = oidName(decodeOid(child(algorithm, 0).content));
  if (name === 'RSA') return { kind: 'private key', format: 'PKCS #8', description: `RSA ${bitLength(child(parseDer(child(root, 2).content), 1).content)}-bit` };
  if (name === 'EC') return { kind: 'private key', format: 'PKCS #8', description: `EC ${oidName(decodeOid(child(algorithm, 1).content))}` };
  return { kind: 'private key', format: 'PKCS #8', description: name };
}

export type Decoded = Certificate | CertificateRequest | KeyFile | { kind: 'encrypted'; label: string } | { kind: 'other'; label: string };

export interface PemBlock {
  readonly label: string;
  readonly der: Uint8Array;
}

/** Finds PEM blocks; if there are none, treats the input as Base64 or raw DER. */
export function readBlocks(text: string, bytes: Uint8Array | null): PemBlock[] {
  if (bytes && bytes[0] === 0x30) return [{ label: 'DER', der: bytes }];
  const source = bytes ? new TextDecoder().decode(bytes) : text;
  const blocks: PemBlock[] = [];
  for (const match of source.matchAll(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g)) {
    const body = (match[2] as string).replace(/^[A-Za-z-]+:.*$/gm, '').replace(/\s+/g, '');
    blocks.push({ label: match[1] as string, der: fromBase64(body) });
  }
  if (blocks.length > 0) return blocks;
  const compact = source.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=_-]+$/.test(compact) && compact.length > 40) return [{ label: 'DER', der: fromBase64(compact) }];
  throw new ToolError('Paste a PEM file (-----BEGIN CERTIFICATE----- ...) or open a .crt, .cer, .pem, .der or .csr file.');
}

export function decodeBlock(block: PemBlock): Decoded {
  switch (block.label) {
    case 'CERTIFICATE':
    case 'TRUSTED CERTIFICATE':
      return parseCertificate(block.der);
    case 'CERTIFICATE REQUEST':
    case 'NEW CERTIFICATE REQUEST':
      return parseRequest(block.der);
    case 'PUBLIC KEY':
      return { kind: 'public key', format: 'SubjectPublicKeyInfo', description: describeKey(decodePublicKey(parseDer(block.der))) };
    case 'RSA PUBLIC KEY':
      return { kind: 'public key', format: 'PKCS #1', description: `RSA ${bitLength(child(parseDer(block.der), 0).content)}-bit` };
    case 'PRIVATE KEY':
    case 'RSA PRIVATE KEY':
    case 'EC PRIVATE KEY':
      return describePrivateKey(block.label, block.der);
    case 'ENCRYPTED PRIVATE KEY':
      return { kind: 'encrypted', label: block.label };
    case 'DER': {
      // Unlabelled DER: try a certificate first, then a request.
      try {
        return parseCertificate(block.der);
      } catch {
        return parseRequest(block.der);
      }
    }
    default:
      return { kind: 'other', label: block.label };
  }
}

export { describeKey };
