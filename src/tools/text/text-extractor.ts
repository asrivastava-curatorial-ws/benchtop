import { defineTextTool, type Field } from '../types';

export const PATTERNS: Record<string, { label: string; pattern: RegExp }> = {
  email: { label: 'Email addresses', pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  url: { label: 'Web addresses', pattern: /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi },
  domain: { label: 'Domain names', pattern: /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|in|gov|edu|io|dev|co|uk|de|info|app|ai|me|us|ca|au|jp|fr|nl|eu)\b/gi },
  ipv4: { label: 'IPv4 addresses', pattern: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g },
  ipv6: { label: 'IPv6 addresses', pattern: /\b(?:[0-9a-f]{1,4}:){2,7}(?::|[0-9a-f]{1,4})\b|::(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4}\b/gi },
  phone: { label: 'Phone numbers', pattern: /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,5}\)[\s-]?)?\d{2,5}[\s-]?\d{3,5}[\s-]?\d{3,5}\b/g },
  hashtag: { label: 'Hashtags', pattern: /(?<![\w#])#[\p{L}\p{N}_]+/gu },
  mention: { label: 'Mentions', pattern: /(?<![\w@])@[\w.]{2,}/g },
  number: { label: 'Numbers', pattern: /-?\b\d[\d,]*(?:\.\d+)?\b/g },
  date: { label: 'Dates', pattern: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\b/gi },
  colour: { label: 'Hex colours', pattern: /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi },
  uuid: { label: 'UUIDs', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  pin: { label: 'Indian PIN codes', pattern: /\b[1-9]\d{2}\s?\d{3}\b/g },
  money: { label: 'Amounts of money', pattern: /(?:₹|Rs\.?|INR|\$|USD|€|£)\s?\d[\d,]*(?:\.\d{1,2})?/gi },
};

export default defineTextTool({
  input: {
    label: 'Text',
    sample: 'Write to visits@example.org or call +1 202-555-0143. Docs: https://example.org/guide, mirror 192.0.2.44.\nTickets ₹ 120 from 2026-11-20. #ScienceDay @examplemuseum',
  },
  output: { label: 'Found' },
  options: [
    { key: 'kind', label: 'Find', type: 'select', choices: [...Object.entries(PATTERNS).map(([value, { label }]) => ({ value, label })), { value: 'all', label: 'Everything above' }], default: 'all' },
    { key: 'unique', label: 'Remove duplicates', type: 'toggle', default: true },
    { key: 'sort', label: 'Sort', type: 'toggle', default: false },
  ],
  run(input, o) {
    const kinds = o.kind === 'all' ? Object.keys(PATTERNS) : [o.kind];
    const fields: Field[] = [];
    const sections: string[] = [];
    for (const kind of kinds) {
      const entry = PATTERNS[kind];
      if (!entry) continue;
      let found = [...input.matchAll(entry.pattern)].map((match) => match[0].trim());
      if (kind === 'phone') found = found.filter((value) => value.replace(/\D/g, '').length >= 8);
      if (o.unique) found = [...new Set(found)];
      if (o.sort) found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (found.length === 0) continue;
      fields.push({ label: entry.label, value: String(found.length) });
      sections.push(o.kind === 'all' ? `# ${entry.label}\n${found.join('\n')}` : found.join('\n'));
    }
    return { output: sections.join('\n\n'), fields, info: fields.length === 0 ? 'Nothing found.' : undefined };
  },
});
