/** Runs a JavaScript regular expression and describes every match. */
import { ToolError } from './errors';
import { escapeHtml } from './text';

export interface RegexMatch {
  readonly index: number;
  readonly end: number;
  readonly text: string;
  /** Numbered groups, index 1 upwards; `undefined` for groups that did not take part. */
  readonly groups: readonly (string | undefined)[];
  readonly named: Readonly<Record<string, string | undefined>>;
}

export interface RegexResult {
  readonly matches: readonly RegexMatch[];
  /** True when the match limit was reached and the list is incomplete. */
  readonly truncated: boolean;
  readonly groupNames: readonly string[];
  readonly groupCount: number;
}

export const MATCH_LIMIT = 5000;
const VALID_FLAGS = /^[dgimsuvy]*$/;

export function compileRegex(pattern: string, flags: string): RegExp {
  if (!VALID_FLAGS.test(flags)) throw new ToolError(`Unknown flag in "${flags}". Use any of d, g, i, m, s, u, v and y.`);
  if (new Set(flags).size !== flags.length) throw new ToolError('Each flag can only be used once.');
  if (flags.includes('u') && flags.includes('v')) throw new ToolError('Use either the u flag or the v flag, not both.');
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new ToolError(`This pattern is not valid: ${(error as Error).message.replace(/^Invalid regular expression: /, '')}`);
  }
}

/** Finds all matches (or the first, without the g flag), never looping on empty matches. */
export function findMatches(pattern: string, flags: string, text: string, limit = MATCH_LIMIT): RegexResult {
  const global = flags.includes('g');
  const regex = compileRegex(pattern, global ? flags : `${flags}g`);
  const groupNames = [...pattern.matchAll(/\(\?<([A-Za-z_$][\w$]*)>/g)].map((match) => match[1] as string);
  const groupCount = Math.max(0, new RegExp(`${pattern}|`, flags.replace(/[gy]/g, '')).exec('')?.length ?? 1) - 1;
  const matches: RegexMatch[] = [];
  let truncated = false;
  for (const match of text.matchAll(regex)) {
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    const index = match.index ?? 0;
    matches.push({
      index,
      end: index + match[0].length,
      text: match[0],
      groups: match.slice(1),
      named: { ...(match.groups ?? {}) },
    });
    if (!global) break;
  }
  return { matches, truncated, groupNames, groupCount };
}

/** The text with every match wrapped in <mark>, escaped for HTML. */
export function highlightMatches(text: string, matches: readonly RegexMatch[]): string {
  let html = '';
  let position = 0;
  matches.forEach((match, number) => {
    html += escapeHtml(text.slice(position, match.index));
    html += match.text === '' ? `<mark class="empty" title="Empty match ${number + 1}"></mark>` : `<mark title="Match ${number + 1}">${escapeHtml(match.text)}</mark>`;
    position = match.end;
  });
  return `${html}${escapeHtml(text.slice(position))}`;
}

export function replaceMatches(pattern: string, flags: string, text: string, replacement: string): string {
  return text.replace(compileRegex(pattern, flags), replacement);
}

/** Escapes text so it matches literally inside a pattern. */
export const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
