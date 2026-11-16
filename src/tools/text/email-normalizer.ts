import { defineTextTool } from '../types';

const GMAIL = new Set(['gmail.com', 'googlemail.com']);
const PLUS_PROVIDERS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'fastmail.com', 'proton.me', 'protonmail.com', 'yahoo.com']);

/** The canonical mailbox an address delivers to: lower case, sub-address tags and Gmail dots removed. */
export function normalizeEmail(address: string, options: { plus: boolean; dots: boolean; anyDomain: boolean }): string {
  const trimmed = address.trim().replace(/^mailto:/i, '');
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1).toLowerCase();
  if (domain === 'googlemail.com') domain = 'gmail.com';
  const separator = domain.startsWith('yahoo.') ? '-' : '+';
  if (options.plus && (options.anyDomain || PLUS_PROVIDERS.has(domain))) local = local.split(separator)[0] ?? local;
  if (options.dots && GMAIL.has(domain)) local = local.replace(/\./g, '');
  return `${local.toLowerCase()}@${domain}`;
}

export default defineTextTool({
  input: { label: 'Email addresses', sample: 'John.Smith+newsletter@Gmail.com\njane.doe+work@outlook.com\nops-alerts@example.org' },
  output: { label: 'Normalised' },
  options: [
    { key: 'plus', label: 'Remove +tags', type: 'toggle', default: true },
    { key: 'dots', label: 'Remove dots in Gmail addresses', type: 'toggle', default: true },
    { key: 'anyDomain', label: 'Remove +tags for every domain', type: 'toggle', default: false, help: 'Most providers support +tags, but some company servers treat + as part of the name.' },
    { key: 'dedupe', label: 'Remove duplicates', type: 'toggle', default: true },
  ],
  run(input, o) {
    const lines = input
      .split(/[\r\n,;]+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const normalised = lines.map((line) => normalizeEmail(line, o));
    const unique = o.dedupe ? [...new Set(normalised)] : normalised;
    return { output: unique.join('\n'), info: `${lines.length} addresses, ${new Set(normalised).size} distinct mailboxes` };
  },
});
