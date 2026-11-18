/**
 * CyberChef's two operations that use the network: HTTP request and DNS over
 * HTTPS.  The desktop shell makes the request (the web view itself has no
 * network access), only when "Allow online checks" is on in Settings.
 */
import { type Args, bArg, bool, defineOp, editable, OpError, type Operation, sArg, sel, str, txt, utf8 } from '../core';
import { callHost } from '../host';

const C = 'Networking' as const;

const METHODS = ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'CONNECT', 'TRACE', 'OPTIONS'];
const MODES = ['Cross-Origin Resource Sharing', 'No CORS (limited to HEAD, GET or POST)'];
const RECORD_TYPES = [
  'A',
  'AAAA',
  'ANAME',
  'CERT',
  'CNAME',
  'DNSKEY',
  'HTTPS',
  'IPSECKEY',
  'LOC',
  'MX',
  'NS',
  'OPENPGPKEY',
  'PTR',
  'RRSIG',
  'SIG',
  'SOA',
  'SPF',
  'SRV',
  'SSHFP',
  'TA',
  'TXT',
  'URI',
  'ANY',
];

/** "Name: value" lines; a value may itself contain colons. */
export function parseHeaders(text: string): [string, string][] {
  const headers: [string, string][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon <= 0) throw new OpError(`Could not parse header in line: ${line}`);
    headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return headers;
}

async function httpRequest(input: string, a: Args): Promise<Uint8Array | string> {
  const url = sArg(a, 'url').trim();
  if (url === '') return '';
  const method = sArg(a, 'method') || 'GET';
  const response = await callHost('fetch', {
    url,
    method,
    headers: parseHeaders(sArg(a, 'headers')),
    body: method === 'GET' || method === 'HEAD' ? undefined : input,
  }).catch((error: unknown) => {
    // The shell's messages already say what failed (no app, checks turned off, DNS, TLS, refused...).
    throw new OpError(error instanceof Error ? error.message : String(error));
  });
  if (!bArg(a, 'metadata')) return response.body;
  const headers = response.headers.map(([name, value]) => `    ${name}: ${value}\n`).join('');
  const head = utf8(`####\n  Status: ${response.status} ${response.reason}\n  Exposed headers:\n${headers}####\n\n`);
  const out = new Uint8Array(head.length + response.body.length);
  out.set(head);
  out.set(response.body, head.length);
  return out;
}

async function dnsOverHttps(input: string, a: Args): Promise<string> {
  let url: URL;
  try {
    url = new URL(sArg(a, 'resolver'));
  } catch (error) {
    throw new OpError(`${String(error)}\n\nThis error could be caused by an invalid Resolver URL.`);
  }
  url.search = new URLSearchParams({ name: input, type: sArg(a, 'type'), cd: String(bArg(a, 'cd')) }).toString();
  let data: { Answer?: { data: unknown }[] };
  try {
    const response = await callHost('fetch', { url: url.toString(), headers: [['accept', 'application/dns-json']] });
    data = JSON.parse(new TextDecoder().decode(response.body)) as typeof data;
  } catch (error) {
    throw new OpError(`Error making request to ${url.toString()}\n${error instanceof Error ? error.message : String(error)}`);
  }
  const result = bArg(a, 'answer') ? (data.Answer ?? []).map((record) => record.data) : data;
  return JSON.stringify(result, null, 4);
}

export const onlineOps: Operation[] = [
  defineOp({
    name: 'HTTP request',
    category: C,
    description:
      'Makes an HTTP request and returns the response body; the input is sent as the body for methods other than GET and HEAD. Redirects are followed and gzip or deflate bodies are decompressed. Needs the desktop app with "Allow online checks" turned on in Settings.',
    input: 'text',
    output: 'bytes',
    volatile: true,
    keywords: ['fetch', 'curl', 'web', 'api', 'get', 'post'],
    args: [
      sel('method', 'Method', METHODS),
      str('url', 'URL', '', { placeholder: 'https://example.com/' }),
      txt('headers', 'Headers', '', { help: 'One "Name: value" per line.' }),
      sel('mode', 'Mode', MODES, MODES[0], { help: 'Kept for CyberChef recipes; requests from the desktop app are not limited by CORS.' }),
      bool('metadata', 'Show response metadata'),
    ],
    run: httpRequest,
  }),
  defineOp({
    name: 'DNS over HTTPS',
    category: C,
    description:
      'Looks up a domain name with a DNS-over-HTTPS resolver that answers in JSON (Google and Cloudflare do), returning the full answer or just the record data. Needs the desktop app with "Allow online checks" turned on in Settings.',
    input: 'text',
    output: 'text',
    volatile: true,
    keywords: ['doh', 'dns', 'resolve', 'lookup'],
    args: [
      editable('resolver', 'Resolver', [
        { label: 'Google', value: 'https://dns.google.com/resolve' },
        { label: 'Cloudflare', value: 'https://cloudflare-dns.com/dns-query' },
      ]),
      sel('type', 'Request Type', RECORD_TYPES),
      bool('answer', 'Answer Data Only'),
      bool('cd', 'Disable DNSSEC validation'),
    ],
    run: dnsOverHttps,
  }),
];
