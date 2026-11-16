/**
 * Certificate checks for the SSL tools: names, dates, chain order and key strength.
 */
import { fromBase64, toBase64, wrapLines } from '../bytes';
import { type Certificate, parseCertificate } from '../x509';

export interface ChainEntry {
  readonly der: Uint8Array;
  readonly cert: Certificate;
}

export function decodeChain(chain: readonly string[]): ChainEntry[] {
  return chain.map((b64) => {
    const der = fromBase64(b64);
    return { der, cert: parseCertificate(der) };
  });
}

export const toPem = (der: Uint8Array): string => `-----BEGIN CERTIFICATE-----\n${wrapLines(toBase64(der), 64)}\n-----END CERTIFICATE-----\n`;

/** The DNS names and IP addresses a certificate covers (its SANs, or the CN when there are none). */
export function certificateNames(cert: Certificate): string[] {
  const san = cert.extensions.find((extension) => extension.oid === '2.5.29.17');
  if (san) {
    return san.value
      .split(/,\s*/)
      .filter((item) => item.startsWith('DNS:') || item.startsWith('IP:'))
      .map((item) => item.slice(item.indexOf(':') + 1).toLowerCase());
  }
  const cn = /(?:^|,\s*)CN=([^,]+)/.exec(cert.subject)?.[1];
  return cn ? [cn.toLowerCase()] : [];
}

/** Whether `host` matches a certificate name, with RFC 6125 wildcard rules (one left-most label). */
export function nameMatches(pattern: string, host: string): boolean {
  const p = pattern.toLowerCase().replace(/\.$/, '');
  const h = host.toLowerCase().replace(/\.$/, '');
  if (p === h) return true;
  if (!p.startsWith('*.')) return false;
  const suffix = p.slice(1);
  if (!h.endsWith(suffix)) return false;
  const label = h.slice(0, -suffix.length);
  return label.length > 0 && !label.includes('.');
}

export const coversHost = (cert: Certificate, host: string): boolean => certificateNames(cert).some((name) => nameMatches(name, host));

export const commonName = (dn: string): string => /(?:^|,\s*)CN=([^,]+)/.exec(dn)?.[1] ?? /(?:^|,\s*)O=([^,]+)/.exec(dn)?.[1] ?? dn;

export const organization = (dn: string): string | undefined => /(?:^|,\s*)O=([^,]+)/.exec(dn)?.[1];

/** Domain validated, organisation validated or extended validation, from the policy OIDs. */
export function validationLevel(cert: Certificate): string | undefined {
  const policies = cert.extensions.find((extension) => extension.oid === '2.5.29.32')?.value ?? '';
  if (/2\.23\.140\.1\.1|extended validation/i.test(policies)) return 'Extended validation (EV)';
  if (/2\.23\.140\.1\.2\.2|organization validated/i.test(policies)) return 'Organisation validated (OV)';
  if (/2\.23\.140\.1\.2\.1|domain validated/i.test(policies)) return 'Domain validated (DV)';
  if (/2\.23\.140\.1\.2\.3|individual validated/i.test(policies)) return 'Individual validated (IV)';
  return undefined;
}

export interface Finding {
  readonly tone: 'ok' | 'warn' | 'bad';
  readonly text: string;
}

/** Problems a browser would show, or that are worth fixing, for this chain and host. */
export function chainFindings(chain: readonly ChainEntry[], host: string, now = Date.now()): Finding[] {
  const findings: Finding[] = [];
  const leaf = chain[0]?.cert;
  if (!leaf) return [{ tone: 'bad', text: 'The server sent no certificate.' }];
  if (leaf.notAfter.getTime() < now) findings.push({ tone: 'bad', text: `The certificate expired on ${leaf.notAfter.toISOString().slice(0, 10)}.` });
  else if (leaf.notBefore.getTime() > now) findings.push({ tone: 'bad', text: `The certificate is not valid until ${leaf.notBefore.toISOString().slice(0, 10)}.` });
  if (!coversHost(leaf, host)) findings.push({ tone: 'bad', text: `The certificate does not cover ${host}. It is for ${certificateNames(leaf).slice(0, 6).join(', ') || 'no names'}.` });
  if (leaf.selfSigned) findings.push({ tone: 'bad', text: 'The certificate is self-signed.' });
  const lifetime = (leaf.notAfter.getTime() - leaf.notBefore.getTime()) / 86_400_000;
  if (lifetime > 398 && !leaf.selfSigned) findings.push({ tone: 'warn', text: `Valid for ${Math.round(lifetime)} days; browsers reject public certificates valid for more than 398 days.` });
  if (leaf.publicKey.algorithm === 'RSA' && leaf.publicKey.bits < 2048) findings.push({ tone: 'bad', text: `The RSA key is only ${leaf.publicKey.bits} bits (2048 is the minimum).` });
  if (/sha-?1|md5/i.test(leaf.signature)) findings.push({ tone: 'bad', text: `Signed with ${leaf.signature}, which browsers no longer accept.` });
  for (let i = 0; i + 1 < chain.length; i++) {
    const cert = (chain[i] as ChainEntry).cert;
    const next = (chain[i + 1] as ChainEntry).cert;
    if (cert.issuer !== next.subject)
      findings.push({ tone: 'warn', text: `Certificate ${i + 2} in the chain did not issue certificate ${i + 1}; the server sends them out of order or sends an extra one.` });
  }
  const last = chain[chain.length - 1]?.cert;
  if (chain.length === 1 && !leaf.selfSigned) findings.push({ tone: 'warn', text: 'Only the server certificate was sent. Some clients cannot build the chain without the intermediate certificate.' });
  if (last?.selfSigned && chain.length > 1) findings.push({ tone: 'warn', text: 'The server also sends the root certificate, which only wastes bytes.' });
  for (const [index, entry] of chain.slice(1).entries()) {
    if (entry.cert.notAfter.getTime() < now) findings.push({ tone: 'bad', text: `Chain certificate ${index + 2} (${commonName(entry.cert.subject)}) has expired.` });
  }
  return findings;
}
