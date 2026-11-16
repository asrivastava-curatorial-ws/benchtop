/**
 * HTTP helpers for the online checks: following redirects hop by hop, reading
 * bodies, page titles and grading security headers.
 */
import { gunzipSync, inflateSync, unzlibSync } from 'fflate';
import type { HttpRequest, HttpResponse, NetTransport } from '../../platform/net';
import { NetError } from '../../platform/net';
import { fromBase64, utf8Decode } from '../bytes';

export const BROWSER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

export interface Hop {
  readonly url: string;
  readonly response: HttpResponse;
}

export interface Chain {
  readonly hops: readonly Hop[];
  readonly final: HttpResponse;
  /** Set when the chain stopped early (a loop or too many redirects). */
  readonly problem?: string;
}

export const header = (response: HttpResponse, name: string): string | undefined => response.headers.find(([key]) => key === name.toLowerCase())?.[1];

export const headerAll = (response: HttpResponse, name: string): string[] => response.headers.filter(([key]) => key === name.toLowerCase()).map(([, value]) => value);

export const isRedirect = (status: number): boolean => [301, 302, 303, 307, 308].includes(status);

/** Adds https:// when no scheme was typed. */
export function normalizeUrl(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    // Normalises the host (lower case, Punycode) and adds the "/" path, as the request will.
    return new URL(candidate).toString();
  } catch {
    return candidate;
  }
}

/** Makes the request and follows redirects itself, so every hop can be reported. */
export async function followRedirects(transport: NetTransport, request: HttpRequest, maxRedirects = 10): Promise<Chain> {
  const hops: Hop[] = [];
  const seen = new Set<string>();
  let current: HttpRequest = request;
  for (;;) {
    const response = await transport.http(current);
    hops.push({ url: current.url, response });
    const location = header(response, 'location');
    if (!isRedirect(response.status) || location === undefined) return { hops, final: response };
    let next: string;
    try {
      next = new URL(location, current.url).toString();
    } catch {
      return { hops, final: response, problem: `The redirect target "${location}" is not a valid address.` };
    }
    if (!/^https?:/i.test(next)) return { hops, final: response, problem: `The redirect goes to "${next}", which is not a web address.` };
    if (seen.has(next) || next === current.url) return { hops, final: response, problem: 'The redirects loop back to an address already visited.' };
    if (hops.length > maxRedirects) return { hops, final: response, problem: `Stopped after ${maxRedirects} redirects.` };
    seen.add(current.url);
    // 303 always becomes GET; 301/302 turn POST into GET, as browsers do.
    const method = response.status === 303 || ((response.status === 301 || response.status === 302) && (current.method ?? 'GET').toUpperCase() === 'POST') ? 'GET' : current.method;
    current = { ...current, url: next, method, body: method === current.method ? current.body : undefined };
  }
}

/** The body bytes, decompressed when the server used gzip or deflate. */
export function bodyBytes(response: HttpResponse): Uint8Array {
  const raw = fromBase64(response.body);
  const encoding = (header(response, 'content-encoding') ?? '').toLowerCase();
  try {
    if (encoding.includes('gzip')) return gunzipSync(raw);
    if (encoding.includes('deflate')) {
      try {
        return unzlibSync(raw);
      } catch {
        return inflateSync(raw);
      }
    }
  } catch {
    // A truncated body cannot be inflated; show what arrived.
  }
  return raw;
}

const CHARSET = /charset\s*=\s*["']?([\w-]+)/i;

/** The body as text, using the charset from the headers or a <meta> tag. */
export function bodyText(response: HttpResponse): string {
  const bytes = bodyBytes(response);
  let charset = CHARSET.exec(header(response, 'content-type') ?? '')?.[1];
  if (charset === undefined) {
    const head = utf8Decode(bytes.subarray(0, 2048));
    charset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return utf8Decode(bytes);
  }
}

export function pageTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return undefined;
  const text = (match[1] as string)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? undefined : text.slice(0, 200);
}

export type Verdict = 'up' | 'redirect' | 'client-error' | 'server-error' | 'down';

/** How a final status should be read: 2xx up, 4xx (except 401/403) client error, 5xx down-ish. */
export function verdict(status: number): Verdict {
  if (status >= 200 && status < 300) return 'up';
  if (status >= 300 && status < 400) return 'redirect';
  if (status === 401 || status === 403 || status === 429) return 'up';
  if (status >= 400 && status < 500) return 'client-error';
  return 'server-error';
}

export function describeStatus(status: number, reason: string): string {
  const meanings: Record<number, string> = {
    200: 'The page loaded normally.',
    204: 'The server answered with no content.',
    301: 'Moved permanently.',
    302: 'Found (temporary redirect).',
    304: 'Not modified.',
    400: 'The server rejected the request as malformed.',
    401: 'The site is up but needs a login.',
    403: 'The site is up but refused access (often a firewall or bot filter).',
    404: 'The server is up but this page does not exist.',
    405: 'The server does not allow this method for this address.',
    410: 'The page was removed permanently.',
    429: 'The site is up but is rate-limiting requests.',
    500: 'The server hit an internal error.',
    502: 'A proxy or gateway in front of the site got a bad answer from it.',
    503: 'The service is unavailable (overloaded or under maintenance).',
    504: 'A proxy or gateway timed out waiting for the site.',
    520: 'Cloudflare got an unexpected answer from the origin server.',
    521: 'Cloudflare could not connect: the origin server is down.',
    522: 'Cloudflare timed out connecting to the origin server.',
    523: 'Cloudflare could not reach the origin server.',
    524: 'The origin server took too long to respond to Cloudflare.',
    525: 'The TLS handshake between Cloudflare and the origin failed.',
    526: 'The origin server’s certificate is invalid (Cloudflare).',
  };
  return meanings[status] ?? `${status} ${reason}`.trim();
}

/** Plain-words explanation for a failed request. */
export function describeFailure(error: unknown): string {
  if (error instanceof NetError) {
    switch (error.kind) {
      case 'dns':
        return `Down: ${error.message} The domain may have expired or its DNS may be misconfigured.`;
      case 'refused':
        return `Down: ${error.message} Nothing is listening on that port.`;
      case 'timeout':
        return `Down or very slow: ${error.message}`;
      case 'tls':
        return `The secure connection failed: ${error.message}`;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------ security headers -- */

export interface HeaderCheck {
  readonly name: string;
  readonly present: boolean;
  readonly value?: string;
  readonly tone: 'ok' | 'warn' | 'bad' | 'muted';
  readonly advice: string;
}

/** Checks the response headers browsers use for protection, much like securityheaders.com. */
export function securityHeaderChecks(response: HttpResponse, https: boolean): { checks: HeaderCheck[]; grade: string } {
  const get = (name: string) => header(response, name);
  const checks: HeaderCheck[] = [];
  const hsts = get('strict-transport-security');
  const maxAge = Number(/max-age\s*=\s*"?(\d+)/i.exec(hsts ?? '')?.[1] ?? 0);
  checks.push({
    name: 'Strict-Transport-Security',
    present: hsts !== undefined,
    value: hsts,
    tone: !https ? 'muted' : hsts === undefined ? 'bad' : maxAge < 15_552_000 ? 'warn' : 'ok',
    advice: !https
      ? 'Only sent over HTTPS.'
      : hsts === undefined
        ? 'Missing: browsers may still try plain HTTP first.'
        : maxAge < 15_552_000
          ? 'max-age is under 180 days.'
          : `max-age ${Math.round(maxAge / 86400)} days${/includesubdomains/i.test(hsts) ? ', includes subdomains' : ''}${/preload/i.test(hsts) ? ', preload' : ''}.`,
  });
  const csp = get('content-security-policy');
  checks.push({
    name: 'Content-Security-Policy',
    present: csp !== undefined,
    value: csp,
    tone: csp === undefined ? 'bad' : /'unsafe-inline'|'unsafe-eval'|\*/.test(csp) && !/'nonce-|'strict-dynamic'/.test(csp) ? 'warn' : 'ok',
    advice:
      csp === undefined
        ? 'Missing: the strongest defence against cross-site scripting.'
        : /'unsafe-inline'|'unsafe-eval'/.test(csp)
          ? 'Allows inline or eval’d scripts, which weakens it.'
          : 'Present.',
  });
  const xcto = get('x-content-type-options');
  checks.push({
    name: 'X-Content-Type-Options',
    present: xcto !== undefined,
    value: xcto,
    tone: xcto?.toLowerCase() === 'nosniff' ? 'ok' : 'bad',
    advice: xcto?.toLowerCase() === 'nosniff' ? 'nosniff: browsers will not guess content types.' : 'Should be "nosniff".',
  });
  const xfo = get('x-frame-options');
  const frameAncestors = /frame-ancestors/i.test(csp ?? '');
  checks.push({
    name: 'X-Frame-Options',
    present: xfo !== undefined || frameAncestors,
    value: xfo ?? (frameAncestors ? '(CSP frame-ancestors)' : undefined),
    tone: xfo !== undefined || frameAncestors ? 'ok' : 'bad',
    advice: xfo !== undefined || frameAncestors ? 'Framing is restricted (protects against clickjacking).' : 'Missing: other sites can embed this page in a frame.',
  });
  const referrer = get('referrer-policy');
  checks.push({
    name: 'Referrer-Policy',
    present: referrer !== undefined,
    value: referrer,
    tone: referrer === undefined ? 'warn' : /unsafe-url/i.test(referrer) ? 'warn' : 'ok',
    advice: referrer === undefined ? 'Missing: browsers use their default (usually strict-origin-when-cross-origin).' : 'Present.',
  });
  const permissions = get('permissions-policy');
  checks.push({
    name: 'Permissions-Policy',
    present: permissions !== undefined,
    value: permissions,
    tone: permissions === undefined ? 'warn' : 'ok',
    advice: permissions === undefined ? 'Missing: limits which browser features (camera, location…) the page may use.' : 'Present.',
  });
  for (const leak of ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version']) {
    const value = get(leak);
    if (value !== undefined && /\d/.test(value)) {
      checks.push({ name: leak.replace(/(^|-)\w/g, (m) => m.toUpperCase()), present: true, value, tone: 'warn', advice: 'Reveals software versions, which helps attackers pick exploits.' });
    }
  }
  const scored = checks.slice(0, 6).filter((check) => check.tone !== 'muted');
  const score = scored.reduce((sum, check) => sum + (check.tone === 'ok' ? 1 : check.tone === 'warn' ? 0.5 : 0), 0) / Math.max(1, scored.length);
  const grade = score >= 0.99 ? 'A+' : score >= 0.85 ? 'A' : score >= 0.7 ? 'B' : score >= 0.55 ? 'C' : score >= 0.4 ? 'D' : score >= 0.2 ? 'E' : 'F';
  return { checks, grade };
}

/** Reads "Name: value" lines typed by the user. */
export function parseHeaderLines(text: string): [string, string][] {
  const headers: [string, string][] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) throw new NetError('invalid', `"${trimmed}" is not a header. Write one per line as Name: value.`);
    headers.push([trimmed.slice(0, colon).trim(), trimmed.slice(colon + 1).trim()]);
  }
  return headers;
}
