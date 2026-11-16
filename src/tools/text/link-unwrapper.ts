import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

interface Unwrapped {
  readonly service: string;
  readonly target: string;
}

const param = (url: URL, ...names: string[]): string | null => {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value) return value;
  }
  return null;
};

/** Proofpoint URL Defense v2 encodes the target with - for % and _ for /. */
function proofpointV2(encoded: string): string {
  return decodeURIComponent(encoded.replace(/-/g, '%').replace(/_/g, '/'));
}

/** Proofpoint v3: /v3/__URL__;!!token — the URL with * runs replaced from a byte table, simplified to the visible URL. */
function proofpointV3(path: string): string {
  const match = /\/v3\/__(.+?)__;/.exec(path);
  if (!match) throw new ToolError('This Proofpoint v3 link is incomplete.');
  return (match[1] as string).replace(/\*+/g, '');
}

/** One layer of redirect wrapping, or null when the URL is not a known wrapper. */
export function unwrapOnce(text: string): Unwrapped | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host.endsWith('safelinks.protection.outlook.com') || host.endsWith('safelinks.protection.office365.us')) return { service: 'Microsoft Defender Safe Links', target: param(url, 'url') ?? '' };
  if (host.startsWith('urldefense.')) {
    if (url.pathname.startsWith('/v3/')) return { service: 'Proofpoint URL Defense v3', target: proofpointV3(url.pathname + url.search) };
    const u = param(url, 'u');
    if (u) return { service: 'Proofpoint URL Defense v2', target: proofpointV2(u) };
  }
  if ((host === 'www.google.com' || host === 'google.com' || /^www\.google\.[a-z.]+$/.test(host)) && url.pathname === '/url')
    return { service: 'Google redirect', target: param(url, 'q', 'url') ?? '' };
  if (host === 'l.facebook.com' || host === 'lm.facebook.com' || host === 'l.messenger.com' || host === 'l.instagram.com')
    return { service: 'Facebook / Instagram link shim', target: param(url, 'u') ?? '' };
  if (host === 'www.youtube.com' && url.pathname === '/redirect') return { service: 'YouTube redirect', target: param(url, 'q') ?? '' };
  if (host === 'www.linkedin.com' && url.pathname.startsWith('/redir/')) return { service: 'LinkedIn redirect', target: param(url, 'url') ?? '' };
  if (host === 'slack-redir.net') return { service: 'Slack redirect', target: param(url, 'url') ?? '' };
  if (host === 'out.reddit.com') return { service: 'Reddit redirect', target: param(url, 'url') ?? '' };
  if (host === 'steamcommunity.com' && url.pathname.startsWith('/linkfilter')) return { service: 'Steam link filter', target: param(url, 'url', 'u') ?? '' };
  if (host === 'away.vk.com') return { service: 'VK redirect', target: param(url, 'to') ?? '' };
  if (host.endsWith('protect-links.mimecast.com') || host.endsWith('mimecastprotect.com')) return { service: 'Mimecast (target is held by Mimecast and cannot be read offline)', target: '' };
  if (host === 't.co' || host === 'bit.ly' || host === 'tinyurl.com' || host === 'lnkd.in' || host === 'ow.ly' || host === 'goo.gl')
    return { service: `Link shortener (${host}); the target is only known to its server`, target: '' };
  for (const name of ['url', 'u', 'target', 'dest', 'destination', 'redirect', 'redirect_uri', 'redirect_url', 'continue', 'next', 'to', 'link']) {
    const value = url.searchParams.get(name);
    if (value && /^https?:\/\//i.test(value)) return { service: `Redirect parameter "${name}"`, target: value };
  }
  return null;
}

const TRACKING = /^(utm_\w+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|yclid|ref_src|si|spm|vero_\w+|oly_\w+|mkt_tok)$/i;

export function stripTracking(text: string): { url: string; removed: string[] } {
  try {
    const url = new URL(text);
    const removed = [...url.searchParams.keys()].filter((key) => TRACKING.test(key));
    for (const key of removed) url.searchParams.delete(key);
    return { url: url.toString(), removed };
  } catch {
    return { url: text, removed: [] };
  }
}

export default defineTextTool({
  input: {
    label: 'Links',
    placeholder: 'Paste wrapped links, one per line',
    sample: 'https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.example.org%2Freport%3Futm_source%3Dnewsletter&data=05%7C01&reserved=0',
  },
  output: { label: 'Real addresses' },
  options: [{ key: 'tracking', label: 'Remove tracking parameters', type: 'toggle', default: true, help: 'utm_*, fbclid, gclid, msclkid and similar.' }],
  run(input, o) {
    const fields: Field[] = [];
    const lines = input.split(/\r?\n/).filter((line) => line.trim() !== '');
    const output = lines.map((line) => {
      let current = line.trim();
      const layers: string[] = [];
      for (let depth = 0; depth < 6; depth++) {
        const unwrapped = unwrapOnce(current);
        if (!unwrapped) break;
        layers.push(unwrapped.service);
        if (unwrapped.target === '') break;
        current = unwrapped.target;
      }
      let removed: string[] = [];
      if (o.tracking) ({ url: current, removed } = stripTracking(current));
      if (lines.length === 1) {
        fields.push({ label: 'Wrapped by', value: layers.length > 0 ? layers.join(' → ') : 'Not a known redirect wrapper', tone: layers.length > 0 ? 'ok' : 'muted' });
        if (removed.length > 0) fields.push({ label: 'Tracking removed', value: removed.join(', '), mono: true });
      }
      return current;
    });
    return { output: output.join('\n'), fields };
  },
});
