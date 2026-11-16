/**
 * Digital signatures in PDF files (ISO 32000 with PKCS #7 / CMS, PAdES):
 * finds each signature, checks that the signed bytes are unchanged, and checks
 * the signature itself with the signer's certificate.  Trust in the signer's
 * certificate authority is not judged here: that needs the reader's trust list.
 */
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { concatBytes, toHex } from './bytes';
import { ToolError } from './errors';
import { type Certificate, type Der, decodeOid, parseCertificate, parseDer } from './x509';

const DIGESTS: Record<string, { name: string; hash: (data: Uint8Array) => Uint8Array; webcrypto: string }> = {
  '1.3.14.3.2.26': { name: 'SHA-1', hash: sha1, webcrypto: 'SHA-1' },
  '2.16.840.1.101.3.4.2.1': { name: 'SHA-256', hash: sha256, webcrypto: 'SHA-256' },
  '2.16.840.1.101.3.4.2.2': { name: 'SHA-384', hash: sha384, webcrypto: 'SHA-384' },
  '2.16.840.1.101.3.4.2.3': { name: 'SHA-512', hash: sha512, webcrypto: 'SHA-512' },
};

export interface PdfSignature {
  readonly index: number;
  readonly byteRange: readonly [number, number, number, number];
  readonly subFilter?: string;
  readonly name?: string;
  readonly reason?: string;
  readonly location?: string;
  readonly signingTime?: Date;
  readonly digestAlgorithm?: string;
  /** The signed bytes hash to the value in the signature. */
  readonly integrity: boolean | null;
  /** The signature verifies with the signer's public key. */
  readonly signatureValid: boolean | null;
  readonly signer?: Certificate;
  readonly chain: readonly Certificate[];
  /** The signature covers the file up to its end (nothing appended later). */
  readonly coversWholeFile: boolean;
  readonly isTimestamp: boolean;
  readonly problems: readonly string[];
}

const latin1 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
};

/** A PDF text string: PDFDocEncoding (≈ Latin-1) or UTF-16BE with a byte-order mark; escapes resolved. */
function pdfString(raw: string): string {
  const unescaped = raw.replace(
    /\\([nrtbf()\\]|[0-7]{1,3})/g,
    (_, code: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[code] ?? String.fromCharCode(Number.parseInt(code, 8)),
  );
  if (unescaped.startsWith('þÿ')) {
    let out = '';
    for (let i = 2; i + 1 < unescaped.length; i += 2) out += String.fromCharCode((unescaped.charCodeAt(i) << 8) | unescaped.charCodeAt(i + 1));
    return out;
  }
  return unescaped;
}

/** D:20240314093000+05'30' → Date. */
export function pdfDate(text: string): Date | undefined {
  const match = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?/.exec(text);
  if (!match) return undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', zone, zh = '00', zm = '00'] = match;
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (zone === '+' || zone === '-') ms -= (zone === '+' ? 1 : -1) * (Number(zh) * 60 + Number(zm)) * 60_000;
  return new Date(ms);
}

const raw = (bytes: Uint8Array, node: Der): Uint8Array => bytes.subarray(node.start, node.start + node.headerLength + node.content.length);

const child = (node: Der | undefined, index: number): Der => {
  const found = node?.children[index];
  if (!found) throw new ToolError('The signature data is not a CMS structure this tool recognises.');
  return found;
};

/** ECDSA signatures in CMS are DER SEQUENCE { r, s }; Web Crypto wants r‖s padded to the curve size. */
function derToRaw(signature: Uint8Array, size: number): Uint8Array {
  const sequence = parseDer(signature);
  const part = (node: Der) => {
    let value = node.content;
    while (value.length > size && value[0] === 0) value = value.subarray(1);
    const out = new Uint8Array(size);
    out.set(value, size - value.length);
    return out;
  };
  return concatBytes(part(child(sequence, 0)), part(child(sequence, 1)));
}

async function verifyWithCertificate(certDer: Uint8Array, signatureAlgorithm: string, digest: string, data: Uint8Array, signature: Uint8Array): Promise<boolean | null> {
  const root = parseDer(certDer);
  const tbs = child(root, 0);
  const spkiNode = child(tbs, tbs.children[0]?.tag === 0xa0 ? 6 : 5);
  const spki = raw(certDer, spkiNode);
  const keyType = decodeOid(child(child(spkiNode, 0), 0).content);
  const hash = DIGESTS[digest]?.webcrypto;
  if (!hash) return null;
  try {
    if (keyType === '1.2.840.113549.1.1.1') {
      if (signatureAlgorithm === '1.2.840.113549.1.1.10') return null; // RSA-PSS parameters are not read here
      const key = await crypto.subtle.importKey('spki', spki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature as BufferSource, data as BufferSource);
    }
    if (keyType === '1.2.840.10045.2.1') {
      const curveOid = decodeOid(child(child(spkiNode, 0), 1).content);
      const curve = { '1.2.840.10045.3.1.7': 'P-256', '1.3.132.0.34': 'P-384', '1.3.132.0.35': 'P-521' }[curveOid];
      if (!curve) return null;
      const size = { 'P-256': 32, 'P-384': 48, 'P-521': 66 }[curve] as number;
      const key = await crypto.subtle.importKey('spki', spki as BufferSource, { name: 'ECDSA', namedCurve: curve }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'ECDSA', hash }, key, derToRaw(signature, size) as BufferSource, data as BufferSource);
    }
  } catch {
    return false;
  }
  return null;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((value, index) => value === b[index]);

/** Every signature in a PDF, checked. */
export async function checkPdfSignatures(pdf: Uint8Array): Promise<PdfSignature[]> {
  if (latin1(pdf.subarray(0, 1024)).indexOf('%PDF-') < 0) throw new ToolError('This is not a PDF file.');
  const text = latin1(pdf);
  const results: PdfSignature[] = [];
  const pattern = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const seen = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const range = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] as const;
    const key = range.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const [a, b, c, d] = range;
    const problems: string[] = [];
    if (a + b > c || c + d > pdf.length) {
      results.push({
        index: results.length + 1,
        byteRange: range,
        integrity: false,
        signatureValid: null,
        chain: [],
        coversWholeFile: false,
        isTimestamp: false,
        problems: ['The byte range points outside the file: the file is truncated or damaged.'],
      });
      continue;
    }
    const contentsText = text.slice(a + b, c).replace(/[<>\s]/g, '');
    const window = text.slice(Math.max(0, (match.index ?? 0) - 6000), a + b) + text.slice(c, c + 6000);
    const value = (name: string) => {
      const found = new RegExp(`/${name}\\s*\\(((?:[^()\\\\]|\\\\.|\\([^()]*\\))*)\\)`).exec(window)?.[1];
      return found === undefined ? undefined : pdfString(found);
    };
    const subFilter = /\/SubFilter\s*\/([\w.]+)/.exec(window)?.[1];
    const isTimestamp = subFilter === 'ETSI.RFC3161';
    const signedData = concatBytes(pdf.subarray(a, a + b), pdf.subarray(c, c + d));
    let der: Uint8Array;
    try {
      der = Uint8Array.from(contentsText.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
    } catch {
      der = new Uint8Array();
    }
    const base = {
      index: results.length + 1,
      byteRange: range,
      subFilter,
      name: value('Name'),
      reason: value('Reason'),
      location: value('Location'),
      coversWholeFile: c + d === pdf.length || /^\s*$/.test(text.slice(c + d)) || /^\s*%%EOF\s*$/.test(text.slice(c + d)),
      isTimestamp,
    };
    try {
      const contentInfo = parseDer(der);
      if (decodeOid(child(contentInfo, 0).content) !== '1.2.840.113549.1.7.2') throw new ToolError('The signature is not CMS SignedData.');
      const signed = child(child(contentInfo, 1), 0);
      const certificatesNode = signed.children.find((node) => node.tag === 0xa0);
      const certificates = (certificatesNode?.children ?? []).filter((node) => node.tag === 0x30).map((node) => ({ der: raw(der, node).slice(), cert: parseCertificate(raw(der, node).slice()) }));
      const signerInfos = signed.children[signed.children.length - 1] as Der;
      const signer = child(signerInfos, 0);
      const sid = child(signer, 1);
      const digestOid = decodeOid(child(child(signer, 2), 0).content);
      const digest = DIGESTS[digestOid];
      const signedAttrs = signer.children.find((node) => node.tag === 0xa0);
      const signatureAlgorithmNode = child(signer, signedAttrs ? 4 : 3);
      const signatureNode = child(signer, signedAttrs ? 5 : 4);
      const signatureAlgorithm = decodeOid(child(signatureAlgorithmNode, 0).content);

      // Which certificate signed: by issuer and serial number, or by subject key identifier.
      let signerCert = certificates[0];
      if (sid.tag === 0x30) {
        const serial = toHex(child(sid, 1).content).replace(/^00/, '').toUpperCase();
        signerCert = certificates.find((entry) => entry.cert.serial.replace(/:/g, '').replace(/^00/, '') === serial) ?? signerCert;
      }

      let integrity: boolean | null = null;
      let signingTime: Date | undefined = value('M') ? pdfDate(value('M') as string) : undefined;
      let toVerify = signedData;
      if (digest) {
        const computed = digest.hash(signedData);
        if (signedAttrs) {
          let messageDigest: Uint8Array | undefined;
          for (const attribute of signedAttrs.children) {
            const type = decodeOid(child(attribute, 0).content);
            const first = child(child(attribute, 1), 0);
            if (type === '1.2.840.113549.1.9.4') messageDigest = first.content;
            if (type === '1.2.840.113549.1.9.5') {
              const time = new TextDecoder().decode(first.content);
              const iso = first.tag === 0x17 ? `${Number(time.slice(0, 2)) < 50 ? '20' : '19'}${time}` : time;
              signingTime = new Date(`${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6, 8)}T${iso.slice(8, 10)}:${iso.slice(10, 12)}:${iso.slice(12, 14)}Z`);
            }
          }
          integrity = messageDigest ? sameBytes(messageDigest, computed) : null;
          const attributes = raw(der, signedAttrs).slice();
          attributes[0] = 0x31; // signed over as a SET OF, not the [0] tag used inside SignerInfo
          toVerify = attributes;
        } else {
          problems.push('The signature has no signed attributes, so the document hash could not be compared directly.');
        }
      } else problems.push(`The digest algorithm ${digestOid} is not supported here.`);
      const signatureValid = signerCert && digest ? await verifyWithCertificate(signerCert.der, signatureAlgorithm, digestOid, toVerify, signatureNode.content) : null;
      if (!signerCert) problems.push('The signer’s certificate is not embedded in the signature.');
      results.push({ ...base, signingTime, digestAlgorithm: digest?.name, integrity, signatureValid, signer: signerCert?.cert, chain: certificates.map((entry) => entry.cert), problems });
    } catch (error) {
      results.push({ ...base, integrity: null, signatureValid: null, chain: [], problems: [error instanceof Error ? error.message : String(error)] });
    }
  }
  return results;
}
