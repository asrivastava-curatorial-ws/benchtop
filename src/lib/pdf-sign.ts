/**
 * Signing PDFs: a visible signature (a drawn, typed or scanned picture) and a
 * digital signature (PKCS #7 / CMS, detached, SHA-256) with the key and
 * certificate from a .p12 / .pfx file, which readers such as Adobe Acrobat and
 * the PDF Signature Checker verify.  A self-signed certificate can be made here
 * for internal use; documents for outside parties need one from a certifying
 * authority.  node-forge does the PKCS #12 and CMS work; nothing leaves this
 * computer.
 */
import forge from 'node-forge';
import { degrees, type PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, rgb } from 'pdf-lib';
import { ToolError } from './errors';
import { loadPdf, viewToPage } from './pdf-edit';
import { drawText, finishFonts, fontsFor, textWidth } from './pdf-text';

/** Bytes reserved for the signature: enough for a 4096-bit key and a chain of several certificates. */
const RESERVED = 16384;
const PLACEHOLDER = '**********';

export interface CertificateSummary {
  readonly subject: string;
  readonly commonName: string;
  readonly issuer: string;
  readonly validFrom: Date;
  readonly validTo: Date;
  readonly keyBits: number;
  readonly selfSigned: boolean;
  readonly serial: string;
}

export interface Signer {
  readonly key: forge.pki.rsa.PrivateKey;
  readonly certificate: forge.pki.Certificate;
  readonly chain: readonly forge.pki.Certificate[];
  readonly summary: CertificateSummary;
}

const toBinary = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
};

const fromBinary = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

/** An attribute's text (node-forge encodes and decodes UTF8String values itself). */
const attributeText = (attribute: forge.pki.CertificateField | null | undefined): string => String(attribute?.value ?? '');

const nameOf = (attributes: forge.pki.CertificateField[]): string =>
  attributes
    .map((a) => `${a.shortName ?? a.name ?? a.type}=${attributeText(a)}`)
    .reverse()
    .join(', ');

function summarise(certificate: forge.pki.Certificate): CertificateSummary {
  const key = certificate.publicKey as forge.pki.rsa.PublicKey;
  return {
    subject: nameOf(certificate.subject.attributes),
    commonName: attributeText(certificate.subject.getField('CN') ?? certificate.subject.getField('O')) || 'Unknown signer',
    issuer: nameOf(certificate.issuer.attributes),
    validFrom: certificate.validity.notBefore,
    validTo: certificate.validity.notAfter,
    keyBits: key.n?.bitLength() ?? 0,
    selfSigned: certificate.isIssuer(certificate),
    serial: certificate.serialNumber,
  };
}

/** Opens a .p12 / .pfx file: the private key, its certificate and any chain. */
export function readP12(bytes: Uint8Array, password: string): Signer {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(toBinary(bytes))), false, password);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password|MAC/i.test(message)) throw new ToolError('The password for this certificate file is wrong.');
    if (/OID is not RSA|Cannot read encrypted private key|Unsupported/i.test(message))
      throw new ToolError('This certificate uses an elliptic-curve key or an unusual encryption; only RSA keys can sign here.');
    throw new ToolError(`This is not a readable .p12 / .pfx certificate file (${message}).`);
  }
  const keys = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const key = keys.find((bag) => bag.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new ToolError('This certificate file holds no private key (or the key is not RSA), so it cannot sign.');
  const certificates = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((bag) => bag.cert).filter((cert): cert is forge.pki.Certificate => Boolean(cert));
  const own = certificates.find((cert) => {
    const pub = cert.publicKey as forge.pki.rsa.PublicKey;
    return pub.n?.equals(key.n) && pub.e.equals(key.e);
  });
  if (!own) throw new ToolError('The certificate for this private key is missing from the file.');
  return { key, certificate: own, chain: certificates.filter((cert) => cert !== own), summary: summarise(own) };
}

export interface SelfSignedOptions {
  readonly name: string;
  readonly email?: string;
  readonly organisation?: string;
  readonly country?: string;
  readonly years: number;
  readonly password: string;
}

/** A new RSA-2048 key and self-signed signing certificate, as a .p12 file (3DES, for every reader). */
export async function createSelfSigned(options: SelfSignedOptions): Promise<{ p12: Uint8Array; signer: Signer }> {
  if (!options.name.trim()) throw new ToolError('Enter the name to show as the signer.');
  if (options.password.length < 4) throw new ToolError('Choose a password of at least 4 characters to protect the certificate file.');
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const key = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(toBinary(pkcs8)))) as forge.pki.rsa.PrivateKey;
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  const serial = crypto.getRandomValues(new Uint8Array(16));
  serial[0] = (serial[0] as number) & 0x7f;
  certificate.serialNumber = Array.from(serial, (b) => b.toString(16).padStart(2, '0')).join('');
  const now = new Date();
  certificate.validity.notBefore = new Date(now.getTime() - 60_000);
  certificate.validity.notAfter = new Date(now.getTime() + Math.max(1, Math.min(30, options.years)) * 365.25 * 86_400_000);
  // Names go in as UTF8String so Hindi and other scripts survive (PrintableString is ASCII only).
  const utf8 = (value: string) => ({ value: value.trim(), valueTagClass: forge.asn1.Type.UTF8 as never });
  const attributes: forge.pki.CertificateField[] = [{ name: 'commonName', ...utf8(options.name) }];
  if (options.organisation?.trim()) attributes.push({ name: 'organizationName', ...utf8(options.organisation) });
  if (options.country?.trim()) attributes.push({ name: 'countryName', value: options.country.trim().toUpperCase().slice(0, 2) });
  if (options.email?.trim()) attributes.push({ name: 'emailAddress', value: options.email.trim() });
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'extKeyUsage', emailProtection: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  certificate.sign(key, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(key, [certificate], options.password, { algorithm: '3des', friendlyName: options.name.trim() });
  return { p12: fromBinary(forge.asn1.toDer(asn1).getBytes()), signer: { key, certificate, chain: [], summary: summarise(certificate) } };
}

/** Where the visible signature goes, in PDF points from the bottom-left of the page as shown. */
export interface Placement {
  /** 1-based. */
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SignOptions {
  /** A transparent PNG of the handwritten or typed signature, or a scanned one. */
  readonly picture?: Uint8Array;
  readonly placement?: Placement;
  /** Digital signature; without it only the picture is added. */
  readonly signer?: Signer;
  readonly reason?: string;
  readonly location?: string;
  readonly contact?: string;
  /** Print "Digitally signed by … / Date: …" beside the picture. */
  readonly details?: boolean;
}

/** Whether the PDF already holds a digital signature (signing again here would break it). */
export function isSigned(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes);
  return /\/ByteRange\s*\[/.test(text) && /\/Type\s*\/Sig\b/.test(text);
}

const stamp = (date: Date): string => {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${offset >= 0 ? '+' : '-'}${pad(Math.trunc(offset / 60))}'${pad(offset % 60)}'`;
};

/** The box in the page's own coordinates (pages may carry a /Rotate). */
function boxOnPage(doc: PDFDocument, place: Placement) {
  const page = doc.getPage(place.page - 1);
  const view = viewToPage(page);
  const corners = [view.map(place.x, place.y), view.map(place.x + place.width, place.y), view.map(place.x, place.y + place.height), view.map(place.x + place.width, place.y + place.height)];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return { page, view, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

async function drawAppearance(doc: PDFDocument, options: SignOptions, when: Date): Promise<void> {
  const place = options.placement;
  if (!place) return;
  const { page, view } = boxOnPage(doc, place);
  const lines: string[] = [];
  if (options.signer && options.details !== false) {
    lines.push(`Digitally signed by ${options.signer.summary.commonName}`, `Date: ${stamp(when)}`);
    if (options.reason) lines.push(`Reason: ${options.reason}`);
    if (options.location) lines.push(`Location: ${options.location}`);
  }
  // With details, the picture takes the left part of the box and the text the rest.
  const pictureWidth = options.picture ? (lines.length ? place.width * 0.45 : place.width) : 0;
  if (options.picture) {
    const image = await doc.embedPng(options.picture);
    const scale = Math.min(pictureWidth / image.width, place.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    const [x, y] = view.map(place.x + (pictureWidth - w) / 2, place.y + (place.height - h) / 2);
    page.drawImage(image, { x, y, width: w, height: h, rotate: degrees(view.turn) });
  }
  if (lines.length) {
    const { regular } = await fontsFor(doc, lines);
    const left = place.x + (pictureWidth ? pictureWidth + 6 : 0);
    const room = place.x + place.width - left;
    const widest = Math.max(...lines.map((line) => textWidth(regular, line, 1)));
    const size = Math.max(4, Math.min(10, room / widest, place.height / (lines.length * 1.3)));
    lines.forEach((line, i) => {
      const [x, y] = view.map(left, place.y + place.height - size * (1.2 + i * 1.3));
      drawText(page, regular, line, { x, y, size, color: rgb(0.1, 0.1, 0.1), angle: view.turn });
    });
  }
}

/** Adds the visible signature and, with a signer, the digital signature.  Returns the new PDF. */
export async function signPdf(input: Uint8Array, options: SignOptions): Promise<Uint8Array> {
  if (!options.picture && !options.signer) throw new ToolError('Add a signature picture or choose a certificate.');
  if (options.signer && isSigned(input)) throw new ToolError('This PDF is already digitally signed; signing it again here would invalidate that signature.');
  const doc = await loadPdf(input);
  const when = new Date();
  await drawAppearance(doc, options, when);
  if (!options.signer) {
    await finishFonts(doc);
    return doc.save({ useObjectStreams: true });
  }
  const signer = options.signer;
  if (signer.summary.validTo < when) throw new ToolError(`The certificate expired on ${signer.summary.validTo.toLocaleDateString()}.`);
  const context = doc.context;
  const text = (value: string) => PDFHexString.fromText(value);
  const signature = context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, PDFName.of(PLACEHOLDER), PDFName.of(PLACEHOLDER), PDFName.of(PLACEHOLDER)],
    Contents: PDFHexString.of('0'.repeat(RESERVED * 2)),
    M: PDFString.fromDate(when),
    Name: text(signer.summary.commonName),
    ...(options.reason ? { Reason: text(options.reason) } : {}),
    ...(options.location ? { Location: text(options.location) } : {}),
    ...(options.contact ? { ContactInfo: text(options.contact) } : {}),
    Prop_Build: { App: { Name: PDFName.of('Benchtop') } },
  });
  const place = options.placement;
  const box = place ? boxOnPage(doc, place) : null;
  const page = box?.page ?? doc.getPage(0);
  const rect = box?.rect ?? [0, 0, 0, 0];
  const appearance = context.formXObject([], { BBox: [0, 0, place?.width ?? 0, place?.height ?? 0], Resources: {} });
  const fieldCount = doc.catalog.getOrCreateAcroForm().getAllFields().length;
  const widget = context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: rect,
    V: context.register(signature),
    T: PDFString.of(`Signature${fieldCount + 1}`),
    F: 4,
    P: page.ref,
    AP: { N: context.register(appearance) },
  });
  const widgetRef = context.register(widget);
  page.node.addAnnot(widgetRef);
  const form = doc.catalog.getOrCreateAcroForm();
  form.addField(widgetRef);
  form.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  await finishFonts(doc);
  // No object streams: the signature dictionary must stay readable where it is written.
  const pdf = await doc.save({ useObjectStreams: false });
  return insertSignature(pdf, signer);
}

/** Fills in the byte range and the CMS signature of a saved PDF with one signature placeholder. */
export function insertSignature(pdf: Uint8Array, signer: Signer): Uint8Array {
  const latin = new TextDecoder('latin1').decode(pdf);
  const rangeAt = latin.indexOf(`/ByteRange [ 0 /${PLACEHOLDER} /${PLACEHOLDER} /${PLACEHOLDER} ]`);
  const zeros = `<${'0'.repeat(RESERVED * 2)}>`;
  const contentsAt = latin.indexOf(zeros);
  if (rangeAt < 0 || contentsAt < 0) throw new ToolError('Could not prepare the signature space in this PDF.');
  const start = contentsAt;
  const end = contentsAt + zeros.length;
  const range = [0, start, end, pdf.length - end];
  const placeholder = `/ByteRange [ 0 /${PLACEHOLDER} /${PLACEHOLDER} /${PLACEHOLDER} ]`;
  const filled = `/ByteRange [ ${range.join(' ')} ]`.padEnd(placeholder.length, ' ');
  if (filled.length > placeholder.length) throw new ToolError('This PDF is too large to sign.');
  const out = pdf.slice();
  out.set(new TextEncoder().encode(filled), rangeAt);
  const signed = new Uint8Array(start + (out.length - end));
  signed.set(out.subarray(0, start), 0);
  signed.set(out.subarray(end), start);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(toBinary(signed));
  p7.addCertificate(signer.certificate);
  for (const cert of signer.chain) p7.addCertificate(cert);
  p7.addSigner({
    key: signer.key,
    certificate: signer.certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as never },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const hex = Array.from(der, (ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  if (hex.length > RESERVED * 2) throw new ToolError('The certificate chain is too long to fit in the signature space.');
  out.set(new TextEncoder().encode(`<${hex.padEnd(RESERVED * 2, '0')}>`), start);
  return out;
}
