import { afterEach, describe, expect, it } from 'vitest';
import { checkForUpdates, compareVersions, newestRelease, parseVersion, RELEASES_PAGE } from '../../src/app/updates';
import { type HttpRequest, type HttpResponse, type NetTransport, setNetTransport } from '../../src/platform/net';

function answer(status: number, json: unknown): HttpResponse {
  const body = Buffer.from(JSON.stringify(json)).toString('base64');
  return {
    url: 'https://api.github.com/',
    status,
    reason: status === 200 ? 'OK' : 'Forbidden',
    version: 'HTTP/2.0',
    headers: [['content-type', 'application/json; charset=utf-8']],
    body,
    bodySize: body.length,
    truncated: false,
    remoteAddr: null,
    headersMs: 1,
    elapsedMs: 2,
    peerCertificate: null,
  };
}

function fake(response: HttpResponse, seen: HttpRequest[] = []): NetTransport {
  const unused = () => Promise.reject(new Error('not used'));
  return {
    http: (request) => {
      seen.push(request);
      return Promise.resolve(response);
    },
    tls: unused,
    dns: unused,
    whois: unused,
    probe: unused,
  };
}

const RELEASES = [
  { tag_name: 'models-v1', html_url: `${RELEASES_PAGE}/tag/models-v1`, published_at: '2026-11-20T10:00:00Z' },
  { tag_name: 'v4.0.0', draft: true },
  { tag_name: 'v3.9.0-beta.1', prerelease: true },
  { tag_name: 'v3.2.0', html_url: `${RELEASES_PAGE}/tag/v3.2.0`, published_at: '2026-12-01T08:30:00Z' },
  { tag_name: 'v3.1.0', html_url: `${RELEASES_PAGE}/tag/v3.1.0`, published_at: '2026-11-18T08:30:00Z' },
];

afterEach(() => setNetTransport(null));

describe('version numbers', () => {
  it('parses plain and v-prefixed versions with optional pre-release labels', () => {
    expect(parseVersion('v3.10.2')).toEqual([3, 10, 2, null]);
    expect(parseVersion('3.1.0-beta.2')).toEqual([3, 1, 0, 'beta.2']);
    expect(parseVersion('3.1')).toBeNull();
    expect(parseVersion('models-v1')).toBeNull();
  });

  it('compares numerically, with pre-releases before their release', () => {
    expect(compareVersions('3.10.0', '3.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v3.1.0', '3.1.0')).toBe(0);
    expect(compareVersions('3.1.0-beta.10', '3.1.0-beta.9')).toBeGreaterThan(0);
    expect(compareVersions('3.1.0-rc.1', '3.1.0')).toBeLessThan(0);
    expect(() => compareVersions('3.1.0', 'latest')).toThrow(/not a version/);
  });
});

describe('the newest release', () => {
  it('skips drafts, pre-releases and the model mirror', () => {
    expect(newestRelease(RELEASES)).toEqual({ version: '3.2.0', tag: 'v3.2.0', url: `${RELEASES_PAGE}/tag/v3.2.0`, published: '2026-12-01' });
    expect(newestRelease([])).toBeNull();
  });

  it('never links outside the project', () => {
    expect(newestRelease([{ tag_name: 'v9.0.0', html_url: 'https://evil.example/download' }])?.url).toBe(RELEASES_PAGE);
    expect(() => newestRelease({ message: 'Not Found' })).toThrow(/unexpected answer/);
  });
});

describe('checking', () => {
  it('reports a newer release', async () => {
    const seen: HttpRequest[] = [];
    setNetTransport(fake(answer(200, RELEASES), seen));
    const result = await checkForUpdates('3.1.0');
    expect(result).toMatchObject({ current: '3.1.0', newer: true, latest: { version: '3.2.0', published: '2026-12-01' } });
    expect(seen[0]?.url).toBe('https://api.github.com/repos/asrivastava-curatorial-ws/benchtop/releases?per_page=30');
  });

  it('says when this is the newest version, or when nothing is published', async () => {
    setNetTransport(fake(answer(200, RELEASES)));
    expect((await checkForUpdates('3.2.0')).newer).toBe(false);
    setNetTransport(fake(answer(200, [])));
    expect(await checkForUpdates('3.1.0')).toEqual({ current: '3.1.0', latest: null, newer: false });
  });

  it('explains GitHub rate limits and other errors', async () => {
    setNetTransport(fake(answer(403, { message: 'API rate limit exceeded' })));
    await expect(checkForUpdates('3.1.0')).rejects.toThrow(/refused the request \(403 Forbidden\).*try again later/);
    setNetTransport(fake({ ...answer(200, []), body: Buffer.from('<html>').toString('base64') }));
    await expect(checkForUpdates('3.1.0')).rejects.toThrow(/not JSON/);
  });
});
