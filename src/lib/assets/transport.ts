/**
 * Asset Finder's way onto the network: the connectors' requests, thumbnails
 * and previews all go through the desktop shell (the page itself can reach no
 * host), with "Allow online checks" deciding whether they may.
 */
import { net } from '../../platform/net';
import { fromBase64 } from '../bytes';
import type { Transport } from './runtime';

const CONNECTOR_BODY = 8 * 1024 * 1024;

/** The transport the connectors' requests use. */
export function assetTransport(): Transport {
  return {
    async request(r) {
      const response = await net().http({ url: r.url, method: r.method, headers: r.headers, ...(r.body !== undefined ? { body: r.body } : {}), timeoutMs: r.timeoutMs, maxBody: CONNECTOR_BODY });
      if (response.truncated) throw new Error('The answer was larger than 8 MB, the most a connector can read at once.');
      return { status: response.status, headers: response.headers, body: fromBase64(response.body) };
    },
  };
}

const local = (url: URL) => url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);

/** Fetches a picture or a short clip as bytes, following up to five https redirects. */
export async function fetchMedia(address: string, options: { maxBytes: number; accept: string; timeoutMs?: number }): Promise<{ bytes: Uint8Array; type: string }> {
  let url = new URL(address);
  for (let hop = 0; hop <= 5; hop++) {
    if (url.protocol !== 'https:' && !local(url)) throw new Error('Only https addresses are fetched.');
    const response = await net().http({ url: url.toString(), method: 'GET', headers: [['Accept', options.accept]], timeoutMs: options.timeoutMs ?? 20_000, maxBody: options.maxBytes });
    const location = response.headers.find(([k]) => k === 'location')?.[1];
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (response.status >= 400) throw new Error(`${url.host} answered ${response.status}.`);
    if (response.truncated) throw new Error(`Larger than ${Math.round(options.maxBytes / 1e6)} MB: download it to see it.`);
    const type = (response.headers.find(([k]) => k === 'content-type')?.[1] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    return { bytes: fromBase64(response.body), type };
  }
  throw new Error('Too many redirects.');
}

/** Sniffs a picture's type from its first bytes (servers do not always say). */
export function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

/** Thumbnails as blob URLs, a few at a time, the most recent few hundred kept. */
export class ThumbnailCache {
  private readonly kept = new Map<string, Promise<string | null>>();
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(
    private readonly limit = 300,
    private readonly parallel = 6,
    private readonly fetcher: typeof fetchMedia = fetchMedia,
  ) {}

  get(url: string): Promise<string | null> {
    const hit = this.kept.get(url);
    if (hit) {
      this.kept.delete(url);
      this.kept.set(url, hit);
      return hit;
    }
    const promise = this.load(url);
    this.kept.set(url, promise);
    while (this.kept.size > this.limit) {
      const [oldest, value] = this.kept.entries().next().value as [string, Promise<string | null>];
      this.kept.delete(oldest);
      void value.then((blob) => blob && URL.revokeObjectURL(blob));
    }
    return promise;
  }

  private async load(url: string): Promise<string | null> {
    if (this.active >= this.parallel) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      const { bytes, type } = await this.fetcher(url, { maxBytes: 3 * 1024 * 1024, accept: 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8', timeoutMs: 20_000 });
      const kind = type.startsWith('image/') ? type : sniffImage(bytes);
      if (!kind) return null;
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type: kind }));
    } catch {
      return null;
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  clear(): void {
    for (const value of this.kept.values()) void value.then((blob) => blob && URL.revokeObjectURL(blob));
    this.kept.clear();
  }
}
