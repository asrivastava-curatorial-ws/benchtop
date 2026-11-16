import { gzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toBase64, utf8Encode } from '../../src/lib/bytes';
import { cleanName, matchesExpected, reverseName, txtValue } from '../../src/lib/net/dns';
import { dkimKeyBits, dmarcFindings, expandSpf, parseSpf, spfFindings, stsMatches } from '../../src/lib/net/email';
import { securityHeaderChecks } from '../../src/lib/net/http';
import { coversHost, nameMatches } from '../../src/lib/net/tls';
import { normalizeStatus, parseWhoisDate, parseWhoisText, registrableDomain, statusMeaning } from '../../src/lib/net/whois';
import type { DnsRecord, DnsRequest, DnsResponse, HttpRequest, HttpResponse, NetTransport, TlsResponse, WhoisRequest } from '../../src/platform/net';
import { NetError, net, networkStatus, setNetTransport } from '../../src/platform/net';
import dnsLookup from '../../src/tools/text/dns-lookup';
import dnsPropagation from '../../src/tools/text/dns-propagation';
import domainWhois from '../../src/tools/text/domain-whois';
import emailHeaders, { decodeWords, parseHeaders, receivedHops } from '../../src/tools/text/email-headers';
import emailSecurity from '../../src/tools/text/email-security';
import linkChecker, { extractLinks } from '../../src/tools/text/link-checker';
import { parsePorts } from '../../src/tools/text/port-checker';
import sslChecker from '../../src/tools/text/ssl-checker';
import websiteStatus from '../../src/tools/text/website-status';
import { field, run } from './helpers';

/* A self-signed P-256 certificate for www.test.example and test.example, valid 2026-11-16 to 2036-11-13. */
const TEST_CERT =
  'MIIB1zCCAXygAwIBAgICEjQwCgYIKoZIzj0EAwIwNDEZMBcGA1UEAwwQd3d3LnRlc3QuZXhhbXBsZTEXMBUGA1UECgwOQmVuY2h0b3AgVGVzdHMwHhcNMjYxMTE2MDcwNDUyWhcNMzYxMTEzMDcwNDUyWjA0MRkwFwYDVQQDDBB3d3cudGVzdC5leGFtcGxlMRcwFQYDVQQKDA5CZW5jaHRvcCBUZXN0czBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABAj5JQcRBB+sUWN+gp9sgsWo3IX7Vu+va5fU9DprEuwzlQuIGTy+KDUQwQUyA0ah/78Bo2YP9INODg6L2a6onpajfjB8MB0GA1UdDgQWBBRFW/6nhoe14UQxZKbPdIcl50JBrDAfBgNVHSMEGDAWgBRFW/6nhoe14UQxZKbPdIcl50JBrDAPBgNVHRMBAf8EBTADAQH/MCkGA1UdEQQiMCCCEHd3dy50ZXN0LmV4YW1wbGWCDHRlc3QuZXhhbXBsZTAKBggqhkjOPQQDAgNJADBGAiEAw3RlatXjmZffy1cvJn5U6ow4s38N4wUdXSjGvt4jbOECIQDGjQk8OQTX4zv8yLZeSQWU1C5jFHxLFibR9Z9EuI1Q5Q==';

function httpResponse(url: string, status: number, headers: [string, string][], body: Uint8Array | string = '', extra: Partial<HttpResponse> = {}): HttpResponse {
  const bytes = typeof body === 'string' ? utf8Encode(body) : body;
  return {
    url,
    status,
    reason: status === 200 ? 'OK' : status === 301 ? 'Moved Permanently' : '',
    version: 'HTTP/2',
    headers,
    body: toBase64(bytes),
    bodySize: bytes.length,
    truncated: false,
    remoteAddr: '192.0.2.10:443',
    headersMs: 40,
    elapsedMs: 55,
    peerCertificate: null,
    ...extra,
  };
}

function dnsResponse(answers: DnsRecord[], rcode = 0): DnsResponse {
  return {
    server: '1.1.1.1:53',
    transport: 'udp',
    rcode,
    rcodeText: rcode === 0 ? 'No Error' : 'Non-Existent Domain',
    flags: { aa: false, tc: false, rd: true, ra: true, ad: false, cd: false },
    answers,
    authority: [],
    additional: [],
    size: 80,
    elapsedMs: 12,
  };
}

const rr = (name: string, recordType: string, data: string, ttl = 300): DnsRecord => ({ name, recordType, class: 'IN', ttl, data });

/** A fake network: unanswered calls fail like an unreachable host. */
function fake(parts: Partial<NetTransport>): NetTransport {
  const unreachable = async () => {
    throw new NetError('connect', 'unreachable in tests');
  };
  return { http: unreachable, tls: unreachable, dns: unreachable, whois: unreachable, probe: unreachable, ...parts };
}

afterEach(() => setNetTransport(null));

describe('network availability', () => {
  it('explains that online checks need the desktop app', () => {
    const status = networkStatus();
    expect(status.ok).toBe(false);
    expect(() => net()).toThrow(/desktop app/);
  });
});

describe('DNS helpers', () => {
  it('builds reverse names', () => {
    expect(reverseName('192.0.2.10')).toBe('10.2.0.192.in-addr.arpa.');
    expect(reverseName('2001:db8::1')).toBe('1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa.');
    expect(reverseName('example.org')).toBeNull();
  });

  it('cleans typed names', () => {
    expect(cleanName(' https://Example.ORG:8443/path?q=1 ')).toBe('example.org');
    expect(cleanName('münchen.de')).toBe('xn--mnchen-3ya.de');
    expect(cleanName('[2001:db8::1]')).toBe('2001:db8::1');
  });

  it('joins TXT strings without spaces', () => {
    expect(txtValue('"v=spf1 include:_spf.example.org" " -all"')).toBe('v=spf1 include:_spf.example.org -all');
    expect(txtValue('"say \\"hi\\""')).toBe('say "hi"');
  });

  it('matches expected values', () => {
    expect(matchesExpected(['192.0.2.1'], '192.0.2.1', 'exact')).toBe(true);
    expect(matchesExpected(['mail.example.org'], 'Mail.Example.org.', 'exact')).toBe(true);
    expect(matchesExpected(['v=spf1 -all'], 'spf1', 'contains')).toBe(true);
    expect(matchesExpected(['192.0.2.7'], '^192\\.0\\.2\\.\\d+$', 'regex')).toBe(true);
    expect(matchesExpected(['192.0.2.7'], '198.51.100.1', 'exact')).toBe(false);
  });
});

describe('WHOIS and RDAP parsing', () => {
  it('reads the many date formats registries use', () => {
    expect(parseWhoisDate('2030-08-13T04:00:00Z')?.toISOString()).toBe('2030-08-13T04:00:00.000Z');
    expect(parseWhoisDate('2030-08-13 04:00:00+05:30')?.toISOString()).toBe('2030-08-12T22:30:00.000Z');
    expect(parseWhoisDate('13-Aug-2030')?.toISOString().slice(0, 10)).toBe('2030-08-13');
    expect(parseWhoisDate('2030.08.13')?.toISOString().slice(0, 10)).toBe('2030-08-13');
    expect(parseWhoisDate('13.08.2030')?.toISOString().slice(0, 10)).toBe('2030-08-13');
  });

  it('extracts the common fields from WHOIS text', () => {
    const text = `Domain Name: EXAMPLE.ORG\nRegistrar: Example Registrar, Inc.\nRegistrar IANA ID: 9999\nRegistrar WHOIS Server: whois.registrar.example\nCreation Date: 1995-08-31T04:00:00Z\nRegistry Expiry Date: 2030-08-30T04:00:00Z\nDomain Status: clientTransferProhibited https://icann.org/epp#clientTransferProhibited\nName Server: A.IANA-SERVERS.NET\nName Server: B.IANA-SERVERS.NET\nDNSSEC: signedDelegation\n>>> Last update of WHOIS database: 2026-11-16 <<<`;
    const r = parseWhoisText(text, 'whois.pir.org', 'example.org');
    expect(r.registered).toBe(true);
    expect(r.registrar).toBe('Example Registrar, Inc.');
    expect(r.expires?.toISOString().slice(0, 10)).toBe('2030-08-30');
    expect(r.created?.getUTCFullYear()).toBe(1995);
    expect(r.nameServers).toEqual(['a.iana-servers.net', 'b.iana-servers.net']);
    expect(r.statuses).toEqual(['clientTransferProhibited']);
    expect(r.dnssec).toBe(true);
    expect(r.registrarServer).toBe('whois.registrar.example');
  });

  it('recognises unregistered domains', () => {
    expect(parseWhoisText('No match for "NOPE-EXAMPLE-12345.COM".', 'whois.verisign-grs.com', 'nope-example-12345.com').registered).toBe(false);
  });

  it('explains status codes in either spelling', () => {
    expect(normalizeStatus('clientTransferProhibited https://icann.org/epp#clientTransferProhibited')).toBe('client transfer prohibited');
    expect(statusMeaning('server hold')).toMatch(/does not resolve/);
    expect(statusMeaning('redemptionPeriod')).toMatch(/restore/);
  });

  it('finds the registrable domain', () => {
    expect(registrableDomain('www.example.org')).toBe('example.org');
    expect(registrableDomain('shop.example.co.in')).toBe('example.co.in');
    expect(registrableDomain('vitm.gov.in')).toBe('vitm.gov.in');
  });
});

describe('certificate names', () => {
  it('applies wildcard rules', () => {
    expect(nameMatches('*.example.org', 'www.example.org')).toBe(true);
    expect(nameMatches('*.example.org', 'example.org')).toBe(false);
    expect(nameMatches('*.example.org', 'a.b.example.org')).toBe(false);
    expect(nameMatches('Example.org.', 'example.org')).toBe(true);
  });
});

describe('mail records', () => {
  it('counts SPF lookups through includes', async () => {
    const records: Record<string, string[]> = {
      'example.org': ['v=spf1 include:_spf.a.example mx ip4:192.0.2.0/24 ~all'],
      '_spf.a.example': ['v=spf1 include:_spf.b.example a -all'],
      '_spf.b.example': ['v=spf1 ip4:198.51.100.0/24 -all'],
    };
    const tree = await expandSpf('example.org', async (name) => records[name] ?? []);
    expect(tree.lookups).toBe(4);
    const findings = spfFindings(tree);
    expect(findings.some((f) => /4 of 10/.test(f.text))).toBe(true);
    expect(findings.some((f) => /~all/.test(f.text))).toBe(true);
  });

  it('flags more than ten lookups and +all', async () => {
    const records: Record<string, string[]> = { 'big.example': [`v=spf1 ${Array.from({ length: 11 }, (_, i) => `a:h${i}.example`).join(' ')} +all`] };
    const findings = spfFindings(await expandSpf('big.example', async (name) => records[name] ?? []));
    expect(findings.some((f) => f.tone === 'bad' && /more than the limit/.test(f.text))).toBe(true);
    expect(findings.some((f) => f.tone === 'bad' && /\+all/.test(f.text))).toBe(true);
  });

  it('parses SPF terms and qualifiers', () => {
    const spf = parseSpf('v=spf1 -ip4:192.0.2.1 ?a/24 redirect=_spf.example.org');
    expect(spf.terms.map((t) => `${t.qualifier}${t.mechanism}`)).toEqual(['-ip4', '?a']);
    expect(spf.redirect).toBe('_spf.example.org');
  });

  it('grades DMARC policies', () => {
    expect(dmarcFindings(undefined)[0]?.tone).toBe('bad');
    expect(dmarcFindings('v=DMARC1; p=none').some((f) => f.tone === 'warn')).toBe(true);
    expect(dmarcFindings('v=DMARC1; p=reject; rua=mailto:d@example.org')[0]?.tone).toBe('ok');
  });

  it('measures DKIM RSA keys', () => {
    // A 1024-bit RSA SubjectPublicKeyInfo.
    const key =
      'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDnEXTWaSI5nD4kClYhNDrYb//dyKxNxfzLGVa25C2xckOjhYfobyBZpC/dGsqBd4nX2LHEvaUI5wXbfJB+bi7k6E9eDyhEwJnr0uiTLgqOJ+qFXMFWkalbOA1X/ZogZjXc9QYSRw3LnKga7XIVqfjsjx7gjQSx9kl8uZ6ACxsdxQIDAQAB';
    expect(dkimKeyBits(key)).toBe(1024);
  });

  it('matches MTA-STS patterns', () => {
    expect(stsMatches('*.mail.example', 'mx1.mail.example')).toBe(true);
    expect(stsMatches('*.mail.example', 'a.b.mail.example')).toBe(false);
    expect(stsMatches('mx.example', 'MX.example.')).toBe(true);
  });
});

describe('security headers', () => {
  it('grades a well-configured response', () => {
    const response = httpResponse('https://example.org/', 200, [
      ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
      ['content-security-policy', "default-src 'self'; frame-ancestors 'none'"],
      ['x-content-type-options', 'nosniff'],
      ['referrer-policy', 'strict-origin-when-cross-origin'],
      ['permissions-policy', 'camera=()'],
    ]);
    expect(securityHeaderChecks(response, true).grade).toBe('A+');
    expect(securityHeaderChecks(httpResponse('https://example.org/', 200, []), true).grade).toBe('F');
  });
});

describe('Website Status', () => {
  beforeEach(() => {
    setNetTransport(
      fake({
        async http(request: HttpRequest) {
          if (request.url === 'https://example.org/') return httpResponse(request.url, 301, [['location', 'https://www.example.org/']]);
          if (request.url === 'https://www.example.org/') {
            return httpResponse(
              request.url,
              200,
              [
                ['content-type', 'text/html; charset=utf-8'],
                ['content-encoding', 'gzip'],
                ['server', 'nginx'],
              ],
              gzipSync(utf8Encode('<html><head><title>Example &amp; Co</title></head></html>')),
              { peerCertificate: TEST_CERT },
            );
          }
          throw new NetError('dns', 'The name nowhere.invalid could not be found (DNS lookup failed).');
        },
      }),
    );
  });

  it('follows redirects and reports the final page', async () => {
    const result = await run(websiteStatus, 'example.org');
    expect(field(result, 'Result')).toMatch(/^Up/);
    expect(field(result, 'Redirects')).toBe('1');
    expect(field(result, 'Page title')).toBe('Example & Co');
    expect(field(result, 'Compression')).toBe('gzip');
    expect(field(result, 'Certificate expires')).toMatch(/2036-11-13/);
    expect(result.output).toContain('location: https://www.example.org/');
  });

  it('summarises several addresses, including ones that are down', async () => {
    const result = await run(websiteStatus, 'example.org\nnowhere.invalid');
    expect(field(result, 'Up')).toBe('1 of 2');
    expect(result.preview?.kind === 'html' && result.preview.html).toContain('Down');
    expect(result.output?.split('\n')).toHaveLength(3);
  });
});

describe('SSL Certificate Checker', () => {
  it('reports dates, names and trust for a host', async () => {
    const tls: TlsResponse = {
      address: '192.0.2.10:443',
      proxy: null,
      protocol: 'TLS 1.3',
      cipher: 'TLS13_AES_128_GCM_SHA256',
      alpn: 'h2',
      chain: [TEST_CERT],
      trusted: false,
      trustError: 'invalid peer certificate: UnknownIssuer',
      ocspStapled: false,
      elapsedMs: 30,
    };
    setNetTransport(fake({ tls: async (request) => (request.version === '1.2' ? Promise.reject(new NetError('tls', 'protocol version')) : tls) }));
    const result = await run(sslChecker, 'https://test.example/');
    expect(field(result, 'Result')).toMatch(/Not trusted/);
    expect(field(result, 'Expires')).toMatch(/^2036-11-13/);
    expect(field(result, 'Covers this host')).toBe('Yes');
    expect(field(result, 'TLS 1.3')).toBe('Supported');
    expect(field(result, 'TLS 1.2')).toBe('Not supported');
    expect(result.output).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(result.preview?.kind === 'html' && result.preview.html).toMatch(/self-signed/);
  });

  it('covers the names in the certificate', async () => {
    const { decodeChain } = await import('../../src/lib/net/tls');
    const [entry] = decodeChain([TEST_CERT]);
    expect(entry && coversHost(entry.cert, 'test.example')).toBe(true);
    expect(entry && coversHost(entry.cert, 'other.example')).toBe(false);
  });
});

describe('Domain WHOIS and Expiry', () => {
  it('reads RDAP records', async () => {
    setNetTransport(
      fake({
        async http(request) {
          if (request.url === 'https://data.iana.org/rdap/dns.json') return httpResponse(request.url, 200, [], JSON.stringify({ services: [[['org'], ['https://rdap.example-registry.org/']]] }));
          if (request.url === 'https://rdap.example-registry.org/domain/example.org') {
            return httpResponse(
              request.url,
              200,
              [],
              JSON.stringify({
                ldhName: 'EXAMPLE.ORG',
                status: ['client transfer prohibited'],
                events: [
                  { eventAction: 'registration', eventDate: '1995-08-31T04:00:00Z' },
                  { eventAction: 'expiration', eventDate: '2031-08-30T04:00:00Z' },
                ],
                nameservers: [{ ldhName: 'A.IANA-SERVERS.NET' }],
                secureDNS: { delegationSigned: true },
                entities: [{ roles: ['registrar'], publicIds: [{ type: 'IANA Registrar ID', identifier: '376' }], vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar']]] }],
              }),
            );
          }
          throw new NetError('http', `unexpected ${request.url}`);
        },
      }),
    );
    const result = await run(domainWhois, 'https://www.example.org/');
    expect(field(result, 'Domain')).toBe('example.org');
    expect(field(result, 'Expires')).toMatch(/^2031-08-30/);
    expect(field(result, 'Registrar')).toBe('Example Registrar (IANA 376)');
    expect(field(result, 'DNSSEC')).toBe('Signed');
    expect(field(result, 'Source')).toMatch(/^RDAP/);
  });

  it('falls back to WHOIS through the IANA referral', async () => {
    const asked: WhoisRequest[] = [];
    setNetTransport(
      fake({
        http: async (request) => httpResponse(request.url, 200, [], JSON.stringify({ services: [] })),
        async whois(request) {
          asked.push(request);
          if (request.server === 'whois.iana.org') return { server: request.server, text: 'domain: IN\nrefer: whois.registry.in\n', truncated: false, elapsedMs: 5 };
          return {
            server: request.server,
            text: 'Domain Name: example.in\nRegistrar: Example Registrar\nRegistry Expiry Date: 2027-01-15T00:00:00Z\nName Server: ns1.example.in\n',
            truncated: false,
            elapsedMs: 5,
          };
        },
      }),
    );
    const result = await run(domainWhois, 'example.in');
    expect(asked.map((r) => r.server)).toEqual(['whois.iana.org', 'whois.registry.in']);
    expect(field(result, 'Expires')).toMatch(/^2027-01-15/);
    expect(field(result, 'Source')).toMatch(/^WHOIS/);
  });
});

describe('DNS Lookup and Propagation', () => {
  it('prints dig-style output and a table', async () => {
    const requests: DnsRequest[] = [];
    setNetTransport(
      fake({
        async dns(request) {
          requests.push(request);
          return dnsResponse(request.recordType === 'MX' ? [rr('example.org.', 'MX', '10 mail.example.org.')] : []);
        },
      }),
    );
    const result = await run(dnsLookup, '', { name: 'example.org', type: 'MX' });
    expect(requests[0]).toMatchObject({ name: 'example.org', recordType: 'MX', server: '1.1.1.1' });
    expect(field(result, 'Answers')).toBe('1');
    expect(result.output).toContain(';; ANSWER SECTION:');
    expect(result.output).toContain('10 mail.example.org.');
  });

  it('turns an IP address into a PTR query', async () => {
    const requests: DnsRequest[] = [];
    setNetTransport(
      fake({
        async dns(request) {
          requests.push(request);
          return dnsResponse([rr(request.name, 'PTR', 'host.example.org.')]);
        },
      }),
    );
    await run(dnsLookup, '', { name: '192.0.2.10' });
    expect(requests.map((r) => `${r.name} ${r.recordType}`)).toEqual(['10.2.0.192.in-addr.arpa. PTR']);
  });

  it('compares resolvers against the expected value', async () => {
    setNetTransport(
      fake({
        async dns(request) {
          if (request.server === '8.8.8.8') return dnsResponse([rr('example.org.', 'A', '192.0.2.99')]);
          if (request.server === '1.1.1.1') throw new NetError('timeout', 'no answer');
          return dnsResponse([rr('example.org.', 'A', '192.0.2.1')]);
        },
      }),
    );
    const result = await run(dnsPropagation, '', { name: 'example.org', type: 'A', expected: '192.0.2.1' });
    expect(field(result, 'Answered')).toMatch(/^39 of 40/);
    expect(field(result, 'Match the expected value')).toBe('38 of 39');
    expect(result.preview?.kind === 'html' && result.preview.html).toContain('data:image/svg+xml;base64,');
  });
});

describe('Email DNS Check', () => {
  it('combines MX, SPF, DMARC and DKIM', async () => {
    const txt: Record<string, string> = {
      'example.org': '"v=spf1 mx -all"',
      '_dmarc.example.org': '"v=DMARC1; p=quarantine; rua=mailto:dmarc@example.org"',
      'google._domainkey.example.org':
        '"v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDnEXTWaSI5nD4kClYhNDrYb//dyKxNxfzLGVa25C2xckOjhYfobyBZpC/dGsqBd4nX2LHEvaUI5wXbfJB+bi7k6E9eDyhEwJnr0uiTLgqOJ+qFXMFWkalbOA1X/ZogZjXc9QYSRw3LnKga7XIVqfjsjx7gjQSx9kl8uZ6ACxsdxQIDAQAB"',
    };
    setNetTransport(
      fake({
        async dns(request) {
          if (request.recordType === 'MX') return dnsResponse([rr('example.org.', 'MX', '10 mx.example.org.')]);
          const value = txt[request.name];
          return value ? dnsResponse([rr(`${request.name}.`, 'TXT', value)]) : dnsResponse([], 3);
        },
      }),
    );
    const result = await run(emailSecurity, '', { domain: 'example.org' });
    expect(field(result, 'Overall')).toMatch(/look right/);
    expect(field(result, 'SPF')).toBe('1/10 lookups, fail for others');
    expect(field(result, 'DMARC')).toBe('p=quarantine');
    expect(field(result, 'DKIM')).toBe('google');
    expect(field(result, 'MTA-STS')).toBe('Not set up');
  });
});

describe('ports, links and headers', () => {
  it('parses port lists and ranges', () => {
    expect(parsePorts('22, 80-82 443')).toEqual([22, 80, 81, 82, 443]);
    expect(() => parsePorts('70000')).toThrow(/not a port/);
    expect(() => parsePorts('1-5000')).toThrow(/at most/);
  });

  it('extracts and resolves links', () => {
    const links = extractLinks(
      '<base href="https://example.org/docs/"><a href="a.html">A <b>page</b></a><a href="#top">top</a><a href="mailto:x@example.org">m</a><img src="/logo.png"><link rel="stylesheet" href="s.css">',
      'https://example.org/',
      true,
    );
    expect(links.map((link) => link.url)).toEqual(['https://example.org/docs/a.html', 'https://example.org/logo.png', 'https://example.org/docs/s.css']);
    expect(links[0]?.text).toBe('A page');
    expect(extractLinks('<a href="/x">x</a><img src="/y.png">', 'https://example.org/', false)).toHaveLength(1);
  });

  it('checks the links on a page', async () => {
    setNetTransport(
      fake({
        async http(request) {
          if (request.url === 'https://example.org/') return httpResponse(request.url, 200, [['content-type', 'text/html']], '<a href="/ok">ok</a><a href="/gone">gone</a>');
          if (request.url === 'https://example.org/gone') return httpResponse(request.url, 404, []);
          return httpResponse(request.url, 200, []);
        },
      }),
    );
    const result = await run(linkChecker, '', { url: 'example.org' });
    expect(field(result, 'Broken or unreachable')).toBe('1');
    expect(result.output?.split('\n')[1]).toMatch(/^Broken\t404/);
  });

  it('analyses message headers', async () => {
    const headers = [
      'Received: from mx.example.net (mx.example.net [192.0.2.5]) by inbox.example.org with ESMTPS id abc; Mon, 16 Nov 2026 10:00:30 +0000',
      'Received: from sender.example.com (sender.example.com [198.51.100.7])',
      '\tby mx.example.net with ESMTP id def; Mon, 16 Nov 2026 10:00:00 +0000',
      'Authentication-Results: inbox.example.org; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com',
      'From: =?UTF-8?B?w4lsaXNl?= <elise@example.com>',
      'Subject: =?utf-8?Q?Caf=C3=A9_menu?=',
      'Return-Path: <bounce@example.com>',
    ].join('\n');
    expect(parseHeaders(headers)).toHaveLength(6);
    expect(decodeWords('=?utf-8?Q?Caf=C3=A9_menu?=')).toBe('Café menu');
    const hops = receivedHops(parseHeaders(headers));
    expect(hops[0]?.from).toMatch(/^sender\.example\.com/);
    const result = await run(emailHeaders, headers);
    expect(field(result, 'From')).toBe('Élise <elise@example.com>');
    expect(field(result, 'Hops')).toBe('2');
    expect(field(result, 'Delivery time')).toBe('30.0 s');
    expect(field(result, 'DKIM')).toBe('pass');
  });
});
