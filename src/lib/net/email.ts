/**
 * Mail authentication records: SPF (RFC 7208), DMARC (RFC 7489), DKIM keys
 * (RFC 6376), MTA-STS (RFC 8461), TLS-RPT (RFC 8460) and BIMI.
 */
import { fromBase64 } from '../bytes';
import { parseDer } from '../x509';

export interface Finding {
  readonly tone: 'ok' | 'warn' | 'bad' | 'muted';
  readonly text: string;
}

/** Tag-value lists such as "v=DMARC1; p=reject; rua=mailto:…". */
export function tagList(text: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const part of text.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    tags.set(part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim());
  }
  return tags;
}

/* ------------------------------------------------------------------- SPF -- */

export interface SpfTerm {
  readonly qualifier: '+' | '-' | '~' | '?';
  readonly mechanism: string;
  readonly value: string;
  /** Counts toward the limit of 10 DNS lookups. */
  readonly lookup: boolean;
}

export interface SpfRecord {
  readonly terms: readonly SpfTerm[];
  readonly redirect?: string;
  readonly unknown: readonly string[];
}

const LOOKUP_MECHANISMS = new Set(['include', 'a', 'mx', 'ptr', 'exists']);

export function parseSpf(record: string): SpfRecord {
  const terms: SpfTerm[] = [];
  const unknown: string[] = [];
  let redirect: string | undefined;
  for (const token of record.trim().split(/\s+/).slice(1)) {
    if (token === '') continue;
    const modifier = /^([a-z][a-z0-9_.-]*)=(.*)$/i.exec(token);
    if (modifier) {
      if ((modifier[1] as string).toLowerCase() === 'redirect') redirect = modifier[2];
      continue;
    }
    const match = /^([+\-~?]?)([a-z0-9]+)(?:[:/](.*))?$/i.exec(token);
    if (!match) {
      unknown.push(token);
      continue;
    }
    const mechanism = (match[2] as string).toLowerCase();
    if (!['all', 'include', 'a', 'mx', 'ptr', 'ip4', 'ip6', 'exists'].includes(mechanism)) {
      unknown.push(token);
      continue;
    }
    const value = token.includes(':') ? token.slice(token.indexOf(':') + 1) : token.includes('/') ? token.slice(token.indexOf('/')) : '';
    terms.push({ qualifier: ((match[1] as string) || '+') as SpfTerm['qualifier'], mechanism, value, lookup: LOOKUP_MECHANISMS.has(mechanism) });
  }
  return { terms, redirect, unknown };
}

export const QUALIFIER_MEANING: Record<SpfTerm['qualifier'], string> = {
  '+': 'pass',
  '-': 'fail',
  '~': 'soft fail',
  '?': 'neutral',
};

/** One SPF record and the records it pulls in, with the running lookup count. */
export interface SpfNode {
  readonly domain: string;
  readonly record?: string;
  readonly error?: string;
  readonly children: SpfNode[];
  readonly lookups: number;
}

export type TxtFetcher = (name: string) => Promise<string[]>;

/** Follows include: and redirect= like a receiving server, counting DNS lookups (the limit is 10). */
export async function expandSpf(domain: string, fetchTxt: TxtFetcher, depth = 0, seen = new Set<string>()): Promise<SpfNode> {
  if (seen.has(domain)) return { domain, error: 'Loop: this record was already included.', children: [], lookups: 0 };
  seen.add(domain);
  if (depth > 10) return { domain, error: 'Too deeply nested.', children: [], lookups: 0 };
  let records: string[];
  try {
    records = (await fetchTxt(domain)).filter((text) => /^v=spf1(\s|$)/i.test(text));
  } catch (error) {
    return { domain, error: error instanceof Error ? error.message : String(error), children: [], lookups: 0 };
  }
  if (records.length === 0) return { domain, error: 'No SPF record.', children: [], lookups: 0 };
  if (records.length > 1) return { domain, record: records.join('\n'), error: 'More than one SPF record: receivers treat this as a permanent error.', children: [], lookups: 0 };
  const record = records[0] as string;
  const parsed = parseSpf(record);
  const children: SpfNode[] = [];
  let lookups = parsed.terms.filter((term) => term.lookup).length + (parsed.redirect ? 1 : 0);
  for (const term of parsed.terms) {
    if (term.mechanism !== 'include' || term.value === '' || term.value.includes('%{')) continue;
    const child = await expandSpf(term.value, fetchTxt, depth + 1, seen);
    children.push(child);
    lookups += child.lookups;
  }
  if (parsed.redirect && !parsed.terms.some((term) => term.mechanism === 'all') && !parsed.redirect.includes('%{')) {
    const child = await expandSpf(parsed.redirect, fetchTxt, depth + 1, seen);
    children.push(child);
    lookups += child.lookups;
  }
  return { domain, record, children, lookups };
}

export function spfFindings(root: SpfNode): Finding[] {
  const findings: Finding[] = [];
  if (!root.record) return [{ tone: 'bad', text: root.error ?? 'No SPF record: anyone can send mail that claims to come from this domain.' }];
  if (root.error) findings.push({ tone: 'bad', text: root.error });
  const parsed = parseSpf(root.record);
  const all = parsed.terms.find((term) => term.mechanism === 'all');
  if (!all && !parsed.redirect) findings.push({ tone: 'warn', text: 'No "all" term at the end: mail from other servers gets a neutral result.' });
  else if (all?.qualifier === '+') findings.push({ tone: 'bad', text: '"+all" lets every server on the internet send as this domain.' });
  else if (all?.qualifier === '?') findings.push({ tone: 'warn', text: '"?all" is neutral: it does not protect the domain.' });
  else if (all?.qualifier === '~') findings.push({ tone: 'ok', text: '"~all" (soft fail) marks mail from other servers as suspicious.' });
  else if (all?.qualifier === '-') findings.push({ tone: 'ok', text: '"-all" rejects mail from servers not listed.' });
  if (parsed.terms.some((term) => term.mechanism === 'ptr')) findings.push({ tone: 'warn', text: 'The "ptr" mechanism is deprecated (RFC 7208) and slow.' });
  if (parsed.unknown.length > 0) findings.push({ tone: 'bad', text: `Not understood: ${parsed.unknown.join(' ')}` });
  if (root.lookups > 10) findings.push({ tone: 'bad', text: `${root.lookups} DNS lookups: more than the limit of 10, so SPF fails with a permanent error.` });
  else findings.push({ tone: root.lookups >= 9 ? 'warn' : 'ok', text: `${root.lookups} of 10 allowed DNS lookups used.` });
  const broken = (node: SpfNode): SpfNode[] => node.children.flatMap((child) => (child.error ? [child, ...broken(child)] : broken(child)));
  for (const child of broken(root)) findings.push({ tone: 'bad', text: `Included ${child.domain}: ${child.error}` });
  if (root.record.length > 450) findings.push({ tone: 'warn', text: 'The record is long; split very long records into strings under 255 characters.' });
  return findings;
}

/* ----------------------------------------------------------------- DMARC -- */

export function dmarcFindings(record: string | undefined): Finding[] {
  if (record === undefined) return [{ tone: 'bad', text: 'No DMARC record: receivers get no policy for mail that fails SPF and DKIM, and you get no reports.' }];
  const tags = tagList(record);
  const findings: Finding[] = [];
  const policy = tags.get('p')?.toLowerCase();
  if (policy === 'reject') findings.push({ tone: 'ok', text: 'Policy "reject": failing mail is refused.' });
  else if (policy === 'quarantine') findings.push({ tone: 'ok', text: 'Policy "quarantine": failing mail goes to spam.' });
  else if (policy === 'none') findings.push({ tone: 'warn', text: 'Policy "none": monitoring only, failing mail is still delivered.' });
  else findings.push({ tone: 'bad', text: 'The required p= tag is missing or invalid.' });
  const pct = Number(tags.get('pct') ?? 100);
  if (pct < 100) findings.push({ tone: 'warn', text: `The policy applies to only ${pct}% of failing mail.` });
  const sp = tags.get('sp');
  if (sp) findings.push({ tone: sp === 'none' && policy !== 'none' ? 'warn' : 'muted', text: `Subdomain policy: ${sp}.` });
  if (!tags.has('rua')) findings.push({ tone: 'warn', text: 'No rua= address, so you receive no aggregate reports.' });
  else findings.push({ tone: 'ok', text: `Aggregate reports go to ${tags.get('rua')}.` });
  if (tags.get('adkim') === 's' || tags.get('aspf') === 's')
    findings.push({ tone: 'muted', text: `Strict alignment for ${[tags.get('adkim') === 's' && 'DKIM', tags.get('aspf') === 's' && 'SPF'].filter(Boolean).join(' and ')}.` });
  return findings;
}

/* ------------------------------------------------------------------ DKIM -- */

export const COMMON_SELECTORS = [
  'default',
  'google',
  'selector1',
  'selector2',
  'k1',
  'k2',
  's1',
  's2',
  'dkim',
  'mail',
  'smtp',
  'mx',
  'zoho',
  'zmail',
  'mandrill',
  'mxvault',
  'everlytickey1',
  'sig1',
  'protonmail',
  'fm1',
  'fm2',
  'fm3',
  'resend',
  'pm',
  'amazonses',
];

/** Key size in bits of a DKIM p= value (SubjectPublicKeyInfo, or a bare PKCS #1 RSA key). */
export function dkimKeyBits(p: string, keyType = 'rsa'): number | undefined {
  if (p === '') return undefined;
  try {
    const der = fromBase64(p.replace(/\s+/g, ''));
    if (keyType === 'ed25519') return der.length * 8;
    let node = parseDer(der);
    if (node.children.length === 2 && node.children[1]?.tag === 0x03) node = parseDer(node.children[1].content.subarray(1));
    const modulus = node.children[0]?.content;
    if (!modulus) return undefined;
    let i = 0;
    while (i < modulus.length && modulus[i] === 0) i++;
    return (modulus.length - i - 1) * 8 + (32 - Math.clz32(modulus[i] as number));
  } catch {
    return undefined;
  }
}

export function dkimFindings(selector: string, record: string): Finding[] {
  const tags = tagList(record);
  const keyType = tags.get('k')?.toLowerCase() ?? 'rsa';
  const p = tags.get('p') ?? '';
  if (p === '') return [{ tone: 'warn', text: `${selector}: the key is empty, which means it has been revoked.` }];
  const bits = dkimKeyBits(p, keyType);
  if (keyType === 'ed25519') return [{ tone: 'ok', text: `${selector}: Ed25519 key.` }];
  if (bits === undefined) return [{ tone: 'bad', text: `${selector}: the key could not be read.` }];
  if (bits < 1024) return [{ tone: 'bad', text: `${selector}: RSA ${bits}-bit key, too short to be trusted.` }];
  if (bits < 2048) return [{ tone: 'warn', text: `${selector}: RSA ${bits}-bit key; 2048 bits is recommended.` }];
  return [{ tone: 'ok', text: `${selector}: RSA ${bits}-bit key${tags.get('t')?.includes('y') ? ' (test mode)' : ''}.` }];
}

/* ----------------------------------------------------- MTA-STS and others -- */

export function parseStsPolicy(text: string): { mode?: string; mx: string[]; maxAge?: number; version?: string } {
  const result: { mode?: string; mx: string[]; maxAge?: number; version?: string } = { mx: [] };
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === 'mode') result.mode = value;
    else if (key === 'mx') result.mx.push(value);
    else if (key === 'max_age') result.maxAge = Number(value);
    else if (key === 'version') result.version = value;
  }
  return result;
}

/** Whether `host` is matched by an MTA-STS mx pattern ("mail.example.org" or "*.example.org"). */
export const stsMatches = (pattern: string, host: string): boolean => {
  const p = pattern.toLowerCase().replace(/\.$/, '');
  const h = host.toLowerCase().replace(/\.$/, '');
  return p.startsWith('*.') ? h.endsWith(p.slice(1)) && !h.slice(0, -p.length + 1).includes('.') : p === h;
};
