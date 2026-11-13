import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { buildUrl, parseUrl, type UrlSpec } from '../../lib/web';
import { defineTextTool, type Field } from '../types';

export default defineTextTool({
  input: { label: 'Input', sample: 'https://ada:secret@tickets.example.org:8443/shows/planetarium%20show/2026?date=2026-11-14&seats=2&seats=3&lang=kn#book' },
  output: { label: 'Output', language: 'json' },
  options: [
    {
      key: 'mode',
      label: 'Direction',
      type: 'segmented',
      choices: [
        { value: 'parse', label: 'Parse a URL' },
        { value: 'build', label: 'Build from JSON' },
      ],
      default: 'parse',
    },
  ],
  swap: (v) => ({ mode: v.mode === 'parse' ? 'build' : 'parse' }),
  run(input, o) {
    if (o.mode === 'build') {
      const spec = parseJson(input) as UrlSpec;
      if (!spec || typeof spec !== 'object') throw new ToolError('Describe the URL as a JSON object with at least "hostname".');
      return { output: `${buildUrl(spec)}\n`, language: 'text' };
    }
    const url = parseUrl(input);
    const fields: Field[] = [
      { label: 'Scheme', value: url.protocol, mono: true },
      { label: 'Host', value: url.hostname, mono: true },
      { label: 'Port', value: url.port || `(default for ${url.protocol})`, mono: true },
      { label: 'Path', value: url.pathname, mono: true },
      { label: 'Query', value: url.search || '(none)', mono: true },
      { label: 'Fragment', value: url.hash || '(none)', mono: true },
      { label: 'Origin', value: url.origin, mono: true },
    ];
    if (url.username)
      fields.splice(1, 0, { label: 'User', value: url.username, mono: true }, { label: 'Password', value: url.password ? '••••••' : '(none)', tone: url.password ? 'warn' : undefined });
    const query: Record<string, string | string[]> = {};
    for (const [key, value] of url.query) {
      const existing = query[key];
      query[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
    }
    const spec = {
      protocol: url.protocol,
      ...(url.username ? { username: url.username } : {}),
      ...(url.password ? { password: url.password } : {}),
      hostname: url.hostname,
      ...(url.port ? { port: url.port } : {}),
      path: url.pathSegments,
      query,
      ...(url.hash ? { hash: url.hash.slice(1) } : {}),
    };
    const warnings = url.password ? ['This URL contains a password. Avoid sharing it.'] : [];
    return { output: `${JSON.stringify(spec, null, 2)}\n`, language: 'json', fields, warnings, info: 'Edit the JSON and press Swap to build a new URL from it.' };
  },
});
