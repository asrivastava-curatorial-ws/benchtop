import { toBase64, utf8Encode } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { CONTINENTS, cleanName, formatTtl, type MatchMode, matchesExpected, PROPAGATION_RESOLVERS, type Resolver, rcodeName, recordValue, reverseName } from '../../lib/net/dns';
import { esc, formatMs, heading, html, note, pill, report, type Tone, table } from '../../lib/net/report';
import { WORLD_LAND } from '../../lib/net/world';
import { mapLimit, net, settle } from '../../platform/net';
import { defineTextTool, type Field } from '../types';

interface Row {
  readonly resolver: Resolver;
  readonly values: string[];
  readonly ttl?: number;
  readonly ms?: number;
  readonly rcode?: number;
  readonly error?: string;
  readonly state: 'match' | 'differs' | 'empty' | 'error' | 'answer';
}

const STATE: Record<Row['state'], [string, Tone, string]> = {
  match: ['Matches', 'ok', '#2da44e'],
  answer: ['Answered', 'ok', '#2da44e'],
  differs: ['Different', 'warn', '#d4a72c'],
  empty: ['No record', 'warn', '#d4a72c'],
  error: ['No answer', 'bad', '#cf222e'],
};

function map(rows: readonly Row[]): string {
  const dots = rows
    .map((row) => {
      const x = (row.resolver.lon + 180).toFixed(1);
      const y = (90 - row.resolver.lat).toFixed(1);
      return `<circle cx="${x}" cy="${y}" r="2.6" fill="${STATE[row.state][2]}" stroke="#ffffff" stroke-width="0.6"><title>${esc(`${row.resolver.city}: ${STATE[row.state][0]}`)}</title></circle>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 14 360 136" width="720" height="272"><path d="${WORLD_LAND}" fill="#8b949e" fill-opacity="0.35" stroke="#8b949e" stroke-opacity="0.5" stroke-width="0.25"/>${dots}</svg>`;
  return `<img class="report-map" alt="World map of resolver results" src="data:image/svg+xml;base64,${toBase64(utf8Encode(svg))}">`;
}

export default defineTextTool({
  input: false,
  output: { label: 'Table' },
  options: [
    { key: 'name', label: 'Name', type: 'text', default: '', placeholder: 'example.org', mono: true, wide: true },
    { key: 'type', label: 'Record type', type: 'select', choices: ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA', 'SRV', 'PTR', 'DS', 'HTTPS'], default: 'A' },
    { key: 'expected', label: 'Expected value', type: 'text', default: '', placeholder: 'Optional, for example 192.0.2.10', mono: true, help: 'Resolvers that return it are marked as matching.' },
    {
      key: 'match',
      label: 'Match',
      type: 'segmented',
      choices: [
        { value: 'exact', label: 'Exact' },
        { value: 'contains', label: 'Contains' },
        { value: 'regex', label: 'Pattern' },
      ],
      default: 'exact',
      showIf: (v) => String(v.expected).trim() !== '',
    },
    { key: 'timeout', label: 'Give up after', type: 'number', default: 4, min: 1, max: 15, step: 1, unit: 's' },
  ],
  live: false,
  action: 'Check',
  mainThread: true,
  async run(_input, o) {
    const transport = net();
    const typed = cleanName(o.name);
    if (typed === '') throw new ToolError('Enter a domain name.');
    const name = o.type === 'PTR' ? (reverseName(typed) ?? typed) : typed;
    const expected = o.expected.trim();
    const rows = await mapLimit(PROPAGATION_RESOLVERS, 20, async (resolver): Promise<Row> => {
      const result = await settle(transport.dns({ name, recordType: o.type, server: resolver.address, timeoutMs: o.timeout * 1000 }));
      if (!result.ok) return { resolver, values: [], error: result.error, state: 'error' };
      const answer = result.value;
      const records = answer.answers.filter((record) => record.recordType === o.type);
      const values = records.map(recordValue);
      if (answer.rcode !== 0 && answer.rcode !== 3) return { resolver, values, rcode: answer.rcode, ms: answer.elapsedMs, error: rcodeName(answer.rcode), state: 'error' };
      const state: Row['state'] = values.length === 0 ? 'empty' : expected === '' ? 'answer' : matchesExpected(values, expected, o.match as MatchMode) ? 'match' : 'differs';
      return { resolver, values, ttl: records[0]?.ttl, ms: answer.elapsedMs, rcode: answer.rcode, state };
    });

    const answered = rows.filter((row) => row.state !== 'error');
    const matching = rows.filter((row) => row.state === 'match');
    const distinct = new Map<string, number>();
    for (const row of answered) {
      const key = [...row.values].sort().join(' | ') || '(no record)';
      distinct.set(key, (distinct.get(key) ?? 0) + 1);
    }
    const [common] = [...distinct.entries()].sort((a, b) => b[1] - a[1]);
    const fields: Field[] = [
      { label: 'Answered', value: `${answered.length} of ${rows.length} resolvers`, tone: answered.length === rows.length ? 'ok' : answered.length > rows.length / 2 ? 'warn' : 'bad' },
      expected !== ''
        ? {
            label: 'Match the expected value',
            value: `${matching.length} of ${answered.length}`,
            tone: matching.length === answered.length && answered.length > 0 ? 'ok' : matching.length === 0 ? 'bad' : 'warn',
          }
        : { label: 'Different answers', value: String(distinct.size), tone: distinct.size <= 1 ? 'ok' : 'warn' },
      { label: 'Most common answer', value: common ? `${common[0]} (${common[1]} resolvers)` : '—', mono: true },
    ];
    if (expected === '' && distinct.size > 1) fields.push({ label: 'Note', value: 'Different answers are normal for names served from many locations (CDNs, geo-DNS).', tone: 'muted' });

    const groups = CONTINENTS.map((continent) => {
      const inContinent = rows.filter((row) => row.resolver.continent === continent);
      if (inContinent.length === 0) return '';
      return (
        heading(continent) +
        table(
          ['Location', 'Resolver', 'Result', 'Answer', 'TTL', 'Time'],
          inContinent.map((row) => [
            `${row.resolver.city}, ${row.resolver.country}`,
            html(
              `${esc(row.resolver.provider)} <code>${esc(row.resolver.address)}</code>${row.resolver.anycast ? ' <span class="pill pill-muted" title="Anycast: answers from the site nearest to you">anycast</span>' : ''}`,
            ),
            html(pill(STATE[row.state][0], STATE[row.state][1])),
            html(row.values.length > 0 ? row.values.map((value) => `<code>${esc(value)}</code>`).join('<br>') : esc(row.error ?? '')),
            row.ttl !== undefined ? formatTtl(row.ttl) : '',
            row.ms !== undefined ? formatMs(row.ms) : '',
          ]),
          { numeric: [4, 5] },
        )
      );
    }).join('');

    return {
      fields,
      output: [
        'location\tprovider\tresolver\tresult\tanswer\tttl\tms',
        ...rows.map((row) =>
          [
            `${row.resolver.city}, ${row.resolver.country}`,
            row.resolver.provider,
            row.resolver.address,
            STATE[row.state][0],
            row.values.join(' | ') || row.error || '',
            row.ttl ?? '',
            row.ms !== undefined ? Math.round(row.ms) : '',
          ].join('\t'),
        ),
      ].join('\n'),
      filename: `${name}-${o.type}-propagation.tsv`,
      preview: {
        kind: 'html',
        html: report(
          map(rows),
          note('Locations are approximate. Anycast resolvers answer from their site nearest to you, so they show your region’s view. Caches keep old answers until their TTL runs out.'),
          groups,
        ),
      },
      info: `${o.type} records for ${name} from ${rows.length} public resolvers.`,
    };
  },
});
