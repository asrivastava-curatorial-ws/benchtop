/**
 * Check for updates.  Only when the person presses the button: the desktop
 * shell asks GitHub for the project's list of releases (the same kind of
 * request the online checks make, so "Allow online checks" governs it too)
 * and the version numbers are compared here.  Nothing is downloaded or
 * installed, and nothing is checked in the background.
 */
import { ToolError } from '../lib/errors';
import { bodyText, followRedirects } from '../lib/net/http';
import { net } from '../platform/net';

export const REPOSITORY = 'asrivastava-curatorial-ws/benchtop';
export const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases`;
const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`;

export interface Release {
  readonly version: string;
  readonly tag: string;
  readonly url: string;
  /** Publication date, YYYY-MM-DD. */
  readonly published: string | null;
}

export interface UpdateCheck {
  readonly current: string;
  /** The newest app release, or null when the project has published none yet. */
  readonly latest: Release | null;
  readonly newer: boolean;
}

type Version = readonly [number, number, number, string | null];

/** "3.1.0", "v3.1.0" or "3.1.0-beta.2" as numbers plus the pre-release label; null for anything else. */
export function parseVersion(text: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null];
}

/** Negative when `a` is older than `b`, positive when newer, 0 when the same (a pre-release sorts before its release). */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new ToolError(`"${x ? b : a}" is not a version number.`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  if (x[3] === y[3]) return 0;
  if (x[3] === null) return 1;
  if (y[3] === null) return -1;
  return x[3].localeCompare(y[3], 'en', { numeric: true });
}

/**
 * The newest app release in GitHub's list.  Drafts, pre-releases and releases
 * whose tag is not a version (the AI model mirror, "models-v1") are skipped.
 */
export function newestRelease(list: unknown): Release | null {
  if (!Array.isArray(list)) throw new ToolError('GitHub sent an unexpected answer.');
  let best: Release | null = null;
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as { tag_name?: unknown; html_url?: unknown; published_at?: unknown; draft?: unknown; prerelease?: unknown };
    if (entry.draft === true || entry.prerelease === true || typeof entry.tag_name !== 'string') continue;
    const parsed = parseVersion(entry.tag_name);
    if (!parsed || parsed[3] !== null) continue;
    const version = parsed.slice(0, 3).join('.');
    if (best && compareVersions(version, best.version) <= 0) continue;
    const url = typeof entry.html_url === 'string' && entry.html_url.startsWith(`https://github.com/${REPOSITORY}/`) ? entry.html_url : RELEASES_PAGE;
    const published = typeof entry.published_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.published_at) ? entry.published_at.slice(0, 10) : null;
    best = { version, tag: entry.tag_name, url, published };
  }
  return best;
}

export async function checkForUpdates(current: string): Promise<UpdateCheck> {
  const { final } = await followRedirects(net(), {
    url: RELEASES_API,
    headers: [
      ['accept', 'application/vnd.github+json'],
      ['x-github-api-version', '2022-11-28'],
    ],
    timeoutMs: 20_000,
    maxBody: 4_000_000,
  });
  if (final.status === 403 || final.status === 429) {
    throw new ToolError(`GitHub refused the request (${final.status} ${final.reason}). It answers 60 such requests an hour from one network, so try again later.`);
  }
  if (final.status !== 200) throw new ToolError(`GitHub answered ${final.status} ${final.reason}.`);
  let list: unknown;
  try {
    list = JSON.parse(bodyText(final));
  } catch {
    throw new ToolError('GitHub sent an answer that is not JSON.');
  }
  const latest = newestRelease(list);
  return { current, latest, newer: latest !== null && compareVersions(latest.version, current) > 0 };
}
