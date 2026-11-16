/** Pieces shared by the tools in the "Online checks" category. */
import { ToolError } from '../../lib/errors';
import { cleanName } from '../../lib/net/dns';

export const MAX_TARGETS = 50;

/** Non-empty, de-duplicated lines (comments starting with # are ignored). */
export function targetLines(input: string, limit = MAX_TARGETS): string[] {
  const lines = [
    ...new Set(
      input
        .split(/\r?\n|,/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#')),
    ),
  ];
  if (lines.length === 0) throw new ToolError('Enter at least one address.');
  if (lines.length > limit) throw new ToolError(`Check at most ${limit} addresses at a time (you entered ${lines.length}).`);
  return lines;
}

/** host and port from "host", "host:port", "[v6]:port" or a URL. */
export function hostAndPort(text: string, defaultPort: number): { host: string; port: number } {
  const trimmed = text.trim();
  let port = defaultPort;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const schemePort: Record<string, number> = { 'https:': 443, 'http:': 80, 'ldaps:': 636, 'ftps:': 990, 'imaps:': 993, 'pop3s:': 995, 'smtps:': 465 };
      return { host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port ? Number(url.port) : (schemePort[url.protocol] ?? defaultPort) };
    }
  } catch {
    // fall through to manual parsing
  }
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(trimmed);
  if (bracketed) return { host: bracketed[1] as string, port: bracketed[2] ? Number(bracketed[2]) : port };
  const colon = trimmed.lastIndexOf(':');
  if (colon > 0 && trimmed.indexOf(':') === colon && /^\d+$/.test(trimmed.slice(colon + 1))) {
    port = Number(trimmed.slice(colon + 1));
    return { host: cleanName(trimmed.slice(0, colon)), port };
  }
  return { host: cleanName(trimmed), port };
}

export const TIMEOUT = {
  key: 'timeout',
  label: 'Give up after',
  type: 'number',
  default: 15,
  min: 2,
  max: 60,
  step: 1,
  unit: 's',
} as const;
