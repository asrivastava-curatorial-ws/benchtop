import { ToolError } from '../../lib/errors';
import { cleanName, txtValue } from '../../lib/net/dns';
import {
  COMMON_SELECTORS,
  dkimFindings,
  dmarcFindings,
  expandSpf,
  type Finding,
  parseSpf,
  parseStsPolicy,
  QUALIFIER_MEANING,
  type SpfNode,
  spfFindings,
  stsMatches,
  tagList,
} from '../../lib/net/email';
import { bodyText } from '../../lib/net/http';
import { esc, type FieldTone, heading, html, note, pill, report, table } from '../../lib/net/report';
import { type DnsRecord, mapLimit, NetError, type NetTransport, net, settle } from '../../platform/net';
import { defineTextTool, type Field } from '../types';

const findingsHtml = (findings: readonly Finding[]): string => findings.map((finding) => note(finding.text, finding.tone === 'muted' ? 'muted' : finding.tone)).join('');

const worst = (findings: readonly Finding[]): FieldTone => (findings.some((f) => f.tone === 'bad') ? 'bad' : findings.some((f) => f.tone === 'warn') ? 'warn' : 'ok');

function spfTree(node: SpfNode, depth = 0): string {
  const label = `${'— '.repeat(depth)}${node.domain}`;
  const own = node.record
    ? parseSpf(node.record)
        .terms.map((term) => `${term.qualifier === '+' ? '' : term.qualifier}${term.mechanism}${term.value ? `:${term.value}` : ''}`)
        .join(' ')
    : (node.error ?? '');
  return `<tr><td><code>${esc(label)}</code></td><td>${node.lookups}</td><td><code>${esc(own)}</code></td></tr>${node.children.map((child) => spfTree(child, depth + 1)).join('')}`;
}

export default defineTextTool({
  input: false,
  output: { label: 'Records' },
  options: [
    { key: 'domain', label: 'Domain', type: 'text', default: '', placeholder: 'example.org', mono: true, wide: true },
    {
      key: 'selectors',
      label: 'DKIM selectors',
      type: 'text',
      default: COMMON_SELECTORS.join(', '),
      mono: true,
      wide: true,
      help: 'DKIM keys live at <selector>._domainkey.<domain>, and the selector cannot be discovered. Find yours in the DKIM-Signature header (s=) of a message you sent.',
    },
    {
      key: 'server',
      label: 'Ask',
      type: 'select',
      choices: [
        { value: '1.1.1.1', label: 'Cloudflare (1.1.1.1)' },
        { value: '8.8.8.8', label: 'Google (8.8.8.8)' },
        { value: '9.9.9.9', label: 'Quad9 (9.9.9.9)' },
        { value: 'system', label: 'This computer’s resolver' },
      ],
      default: '1.1.1.1',
    },
  ],
  live: false,
  action: 'Check',
  mainThread: true,
  async run(_input, o) {
    const transport: NetTransport = net();
    const domain = cleanName(o.domain);
    if (domain === '') throw new ToolError('Enter a domain name.');
    const timeoutMs = 6000;
    const raw: string[] = [];
    const query = async (name: string, type: string): Promise<DnsRecord[]> => {
      const answer = await transport.dns({ name, recordType: type, server: o.server, timeoutMs });
      if (answer.rcode !== 0 && answer.rcode !== 3) throw new NetError('dns', `${name} ${type}: the resolver answered ${answer.rcodeText}.`);
      const records = answer.answers.filter((record) => record.recordType === type);
      for (const record of records) raw.push(`${record.name}\t${record.ttl}\tIN\t${record.recordType}\t${record.data}`);
      return records;
    };
    const txt = async (name: string) => (await query(name, 'TXT')).map((record) => txtValue(record.data));

    const [mx, spf, dmarc, sts, tlsrpt, bimi] = await Promise.all([
      settle(query(domain, 'MX')),
      expandSpf(domain, txt),
      settle(txt(`_dmarc.${domain}`)),
      settle(txt(`_mta-sts.${domain}`)),
      settle(txt(`_smtp._tls.${domain}`)),
      settle(txt(`default._bimi.${domain}`)),
    ]);
    const selectors = [
      ...new Set(
        o.selectors
          .split(/[\s,]+/)
          .map((selector) => selector.trim())
          .filter(Boolean),
      ),
    ].slice(0, 40);
    const dkim = (
      await mapLimit(selectors, 8, async (selector) => {
        const found = await settle(txt(`${selector}._domainkey.${domain}`));
        const record = found.ok ? found.value.find((text) => /(^|;)\s*(v=DKIM1|k=|p=)/i.test(text)) : undefined;
        return record ? { selector, record } : null;
      })
    ).filter((item): item is { selector: string; record: string } => item !== null);

    const fields: Field[] = [];
    const sections: string[] = [];

    // MX
    const mxRecords = mx.ok
      ? mx.value.map((record) => ({ priority: Number(record.data.split(/\s+/)[0]), host: (record.data.split(/\s+/)[1] ?? '').replace(/\.$/, '') })).sort((a, b) => a.priority - b.priority)
      : [];
    const nullMx = mxRecords.length === 1 && mxRecords[0]?.host === '';
    const mxFindings: Finding[] = !mx.ok
      ? [{ tone: 'bad', text: mx.error }]
      : nullMx
        ? [{ tone: 'muted', text: 'Null MX ("0 ."): this domain accepts no mail.' }]
        : mxRecords.length === 0
          ? [{ tone: 'warn', text: 'No MX records: mail is delivered to the domain’s A record, if any.' }]
          : [{ tone: 'ok', text: `${mxRecords.length} mail server${mxRecords.length === 1 ? '' : 's'}.` }];
    fields.push({
      label: 'Mail servers (MX)',
      value: nullMx ? 'Accepts no mail' : mxRecords.map((record) => `${record.priority} ${record.host}`).join(', ') || 'None',
      tone: worst(mxFindings) === 'bad' ? 'bad' : mxRecords.length > 0 ? 'ok' : 'warn',
      mono: true,
    });
    sections.push(
      heading('MX'),
      findingsHtml(mxFindings),
      mxRecords.length > 0 && !nullMx
        ? table(
            ['Priority', 'Mail server'],
            mxRecords.map((record) => [record.priority, html(`<code>${esc(record.host)}</code>`)]),
            { numeric: [0] },
          )
        : '',
    );

    // SPF
    const spfResult = spfFindings(spf);
    fields.push({
      label: 'SPF',
      value: spf.record
        ? `${spf.lookups}/10 lookups, ${parseSpf(spf.record).terms.find((term) => term.mechanism === 'all') ? QUALIFIER_MEANING[parseSpf(spf.record).terms.find((term) => term.mechanism === 'all')?.qualifier ?? '?'] : 'no all'} for others`
        : 'Missing',
      tone: worst(spfResult),
    });
    sections.push(
      heading('SPF'),
      findingsHtml(spfResult),
      spf.record
        ? `<p><code>${esc(spf.record)}</code></p><div class="report-scroll"><table class="report-table"><thead><tr><th>Record</th><th>Lookups</th><th>Terms</th></tr></thead><tbody>${spfTree(spf)}</tbody></table></div>`
        : '',
    );

    // DMARC
    const dmarcRecord = dmarc.ok ? dmarc.value.find((text) => /^v=DMARC1/i.test(text)) : undefined;
    const dmarcResult = dmarc.ok ? dmarcFindings(dmarcRecord) : [{ tone: 'bad' as const, text: dmarc.error }];
    fields.push({ label: 'DMARC', value: dmarcRecord ? `p=${tagList(dmarcRecord).get('p') ?? '?'}` : 'Missing', tone: worst(dmarcResult) });
    sections.push(heading('DMARC'), findingsHtml(dmarcResult), dmarcRecord ? `<p><code>${esc(dmarcRecord)}</code></p>` : '');

    // DKIM
    const dkimResult = dkim.flatMap(({ selector, record }) => dkimFindings(selector, record));
    fields.push({
      label: 'DKIM',
      value: dkim.length > 0 ? `${dkim.map((item) => item.selector).join(', ')}` : `None of ${selectors.length} selectors found`,
      tone: dkim.length > 0 ? worst(dkimResult) : 'warn',
    });
    sections.push(
      heading('DKIM'),
      dkim.length > 0
        ? findingsHtml(dkimResult)
        : note(`No key at any of the ${selectors.length} selectors tried. This does not prove there is none: add your selector (s= in a DKIM-Signature header).`, 'warn'),
    );

    // MTA-STS
    const stsRecord = sts.ok ? sts.value.find((text) => /^v=STSv1/i.test(text)) : undefined;
    if (stsRecord) {
      const policy = await settle(transport.http({ url: `https://mta-sts.${domain}/.well-known/mta-sts.txt`, timeoutMs: 10_000 }));
      if (policy.ok && policy.value.status === 200) {
        const parsed = parseStsPolicy(bodyText(policy.value));
        const uncovered = mxRecords.filter((record) => record.host !== '' && !parsed.mx.some((pattern) => stsMatches(pattern, record.host)));
        const stsFindings: Finding[] = [
          {
            tone: parsed.mode === 'enforce' ? 'ok' : parsed.mode === 'testing' ? 'warn' : 'bad',
            text: `Mode: ${parsed.mode ?? 'missing'}${parsed.mode === 'testing' ? ' (failures are reported, not enforced)' : ''}.`,
          },
          ...uncovered.map((record): Finding => ({ tone: 'bad', text: `The policy does not list the MX host ${record.host}, so senders enforcing it cannot deliver there.` })),
        ];
        fields.push({ label: 'MTA-STS', value: `${parsed.mode ?? '?'} mode`, tone: worst(stsFindings) });
        sections.push(heading('MTA-STS'), findingsHtml(stsFindings), `<p><code>${esc(stsRecord)}</code></p><pre>${esc(bodyText(policy.value).trim())}</pre>`);
      } else {
        fields.push({ label: 'MTA-STS', value: 'Record found, policy file missing', tone: 'bad' });
        sections.push(
          heading('MTA-STS'),
          note(`The TXT record exists but https://mta-sts.${domain}/.well-known/mta-sts.txt could not be fetched${policy.ok ? ` (HTTP ${policy.value.status})` : `: ${policy.error}`}.`, 'bad'),
        );
      }
    } else {
      fields.push({ label: 'MTA-STS', value: 'Not set up', tone: 'muted' });
      sections.push(heading('MTA-STS'), note('Not set up. MTA-STS makes sending servers insist on encrypted, verified connections to your MX hosts.', 'muted'));
    }

    // TLS-RPT and BIMI
    const tlsRecord = tlsrpt.ok ? tlsrpt.value.find((text) => /^v=TLSRPTv1/i.test(text)) : undefined;
    fields.push({ label: 'TLS reporting', value: tlsRecord ? (tagList(tlsRecord).get('rua') ?? 'record found') : 'Not set up', tone: tlsRecord ? 'ok' : 'muted', mono: Boolean(tlsRecord) });
    const bimiRecord = bimi.ok ? bimi.value.find((text) => /^v=BIMI1/i.test(text)) : undefined;
    fields.push({ label: 'BIMI logo', value: bimiRecord ? (tagList(bimiRecord).get('l') ?? 'record found') : 'Not set up', tone: bimiRecord ? 'ok' : 'muted', mono: Boolean(bimiRecord) });
    sections.push(
      heading('TLS-RPT and BIMI'),
      tlsRecord ? `<p><code>${esc(tlsRecord)}</code></p>` : note('No TLS-RPT record.', 'muted'),
      bimiRecord ? `<p><code>${esc(bimiRecord)}</code></p>` : note('No BIMI record.', 'muted'),
    );

    const scoreParts = [worst(mxFindings), worst(spfResult), worst(dmarcResult)];
    const overall = scoreParts.includes('bad') ? 'bad' : scoreParts.includes('warn') ? 'warn' : 'ok';
    return {
      fields: [
        {
          label: 'Overall',
          value: overall === 'ok' ? 'SPF, DMARC and MX look right' : overall === 'warn' ? 'Works, with gaps worth fixing' : 'Problems that let others spoof this domain or lose mail',
          tone: overall,
        },
        ...fields,
      ],
      output: raw.join('\n'),
      filename: `${domain}-mail-records.txt`,
      preview: { kind: 'html', html: report(...sections, `<p>${pill('Checked', 'muted')} ${esc(domain)} via ${esc(o.server)}</p>`) },
    };
  },
});
