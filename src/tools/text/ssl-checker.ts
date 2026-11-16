import { daysUntil, esc, expiryTone, formatDate, formatDay, formatMs, heading, html, note, pairs, pill, relativeDays, report, table } from '../../lib/net/report';
import { type ChainEntry, certificateNames, chainFindings, commonName, coversHost, decodeChain, organization, toPem, validationLevel } from '../../lib/net/tls';
import { describeKey } from '../../lib/x509';
import { mapLimit, net, settle, type TlsResponse } from '../../platform/net';
import { defineTextTool, type Field } from '../types';
import { hostAndPort, TIMEOUT, targetLines } from './_online';

interface Checked {
  readonly target: string;
  readonly host: string;
  readonly port: number;
  readonly tls?: TlsResponse;
  readonly chain?: ChainEntry[];
  readonly error?: string;
  readonly versions?: { readonly tls13: boolean | null; readonly tls12: boolean | null };
}

const cipherName = (raw: string): string => raw.replace(/^TLS13_/, 'TLS_').replace(/^TLS_ECDHE_/, 'ECDHE-');

export default defineTextTool({
  input: { label: 'Hosts', placeholder: 'One per line: example.org, mail.example.org:993 or https://…', sample: 'example.org\nwww.wikipedia.org' },
  output: { label: 'Certificates (PEM)' },
  options: [
    { key: 'port', label: 'Port', type: 'number', default: 443, min: 1, max: 65535, step: 1, help: 'Used when a line has no port.' },
    { key: 'versions', label: 'Test TLS 1.2 and 1.3 separately', type: 'toggle', default: true },
    { key: 'warn', label: 'Warn when fewer days remain than', type: 'number', default: 30, min: 1, max: 365, step: 1, unit: 'days' },
    TIMEOUT,
  ],
  live: false,
  action: 'Check',
  mainThread: true,
  async run(input, o) {
    const transport = net();
    const targets = targetLines(input);
    const checked = await mapLimit(targets, 6, async (target): Promise<Checked> => {
      const { host, port } = hostAndPort(target, o.port);
      const handshake = await settle(transport.tls({ host, port, timeoutMs: o.timeout * 1000 }));
      if (!handshake.ok) return { target, host, port, error: handshake.error };
      let versions: Checked['versions'];
      if (o.versions && targets.length <= 10) {
        const [v13, v12] = await Promise.all(['1.3', '1.2'].map((version) => settle(transport.tls({ host, port, version: version as '1.2' | '1.3', timeoutMs: o.timeout * 1000 }))));
        const outcome = (result: typeof v13) => (result?.ok ? true : result?.kind === 'tls' ? false : null);
        versions = { tls13: outcome(v13), tls12: outcome(v12) };
      }
      let chain: ChainEntry[] | undefined;
      try {
        chain = decodeChain(handshake.value.chain);
      } catch {
        return { target, host, port, tls: handshake.value, error: 'The certificate could not be read.' };
      }
      return { target, host, port, tls: handshake.value, chain, versions };
    });

    if (checked.length === 1) {
      const item = checked[0] as Checked;
      if (!item.tls || !item.chain || item.chain.length === 0) {
        return {
          fields: [{ label: 'Result', value: item.error ?? 'No certificate', tone: 'bad' }],
          preview: { kind: 'html', html: report(note(item.error ?? 'The server sent no certificate.', 'bad')) },
        };
      }
      const leaf = (item.chain[0] as ChainEntry).cert;
      const days = daysUntil(leaf.notAfter);
      const findings = chainFindings(item.chain, item.host);
      const trusted = item.tls.trusted;
      const ok = trusted && findings.every((finding) => finding.tone !== 'bad');
      const fields: Field[] = [
        { label: 'Result', value: ok ? 'Valid and trusted' : trusted ? 'Trusted, with problems' : `Not trusted: ${item.tls.trustError ?? 'unknown reason'}`, tone: ok ? 'ok' : 'bad' },
        { label: 'Expires', value: `${formatDay(leaf.notAfter)} (${relativeDays(days)})`, tone: expiryTone(days, o.warn) },
        { label: 'Issued', value: formatDay(leaf.notBefore) },
        { label: 'Common name', value: commonName(leaf.subject), mono: true },
        { label: 'Covers this host', value: coversHost(leaf, item.host) ? 'Yes' : 'No', tone: coversHost(leaf, item.host) ? 'ok' : 'bad' },
        { label: 'Issuer', value: `${commonName(leaf.issuer)}${organization(leaf.issuer) ? ` (${organization(leaf.issuer)})` : ''}` },
        { label: 'Validation', value: validationLevel(leaf) ?? 'Not stated' },
        { label: 'Key', value: describeKey(leaf.publicKey) },
        { label: 'Signature', value: leaf.signature },
        { label: 'Protocol', value: item.tls.protocol, mono: true, tone: item.tls.protocol === 'TLS 1.3' || item.tls.protocol === 'TLS 1.2' ? 'ok' : 'bad' },
        { label: 'Cipher', value: cipherName(item.tls.cipher), mono: true },
        { label: 'ALPN', value: item.tls.alpn ?? 'none (HTTP/1.1 only)', mono: true },
        { label: 'OCSP stapling', value: item.tls.ocspStapled ? 'Yes' : 'No', tone: item.tls.ocspStapled ? 'ok' : 'muted' },
        { label: 'Server address', value: item.tls.address, mono: true },
        { label: 'Handshake', value: formatMs(item.tls.elapsedMs), mono: true },
        { label: 'SHA-256 fingerprint', value: leaf.sha256, mono: true },
      ];
      if (item.versions) {
        const label = (value: boolean | null) => (value === null ? 'Could not test' : value ? 'Supported' : 'Not supported');
        fields.push(
          { label: 'TLS 1.3', value: label(item.versions.tls13), tone: item.versions.tls13 ? 'ok' : 'warn' },
          { label: 'TLS 1.2', value: label(item.versions.tls12), tone: item.versions.tls12 === false && !item.versions.tls13 ? 'bad' : item.versions.tls12 ? 'ok' : 'muted' },
        );
      }
      const names = certificateNames(leaf);
      const parts = [
        findings.length > 0 ? heading('Findings') + findings.map((finding) => note(finding.text, finding.tone)).join('') : note('No problems found.', 'ok'),
        !trusted ? note(`This computer does not trust the chain: ${item.tls.trustError ?? 'unknown reason'}.`, 'bad') : '',
        item.tls.proxy ? note(`Connected through the proxy ${item.tls.proxy}; if it inspects TLS, the chain below is the proxy’s.`, 'warn') : '',
        heading(`Names covered (${names.length})`),
        `<p>${names.map((name) => `<code>${esc(name)}</code>`).join(' ')}</p>`,
        heading('Chain sent by the server'),
        table(
          ['#', 'Subject', 'Issuer', 'Valid until', 'Key', 'Signature'],
          item.chain.map((entry, index) => [
            index + 1,
            commonName(entry.cert.subject),
            commonName(entry.cert.issuer),
            html(pill(formatDay(entry.cert.notAfter), expiryTone(daysUntil(entry.cert.notAfter), o.warn))),
            describeKey(entry.cert.publicKey),
            entry.cert.signature,
          ]),
          { numeric: [0] },
        ),
        heading('Server certificate'),
        pairs([
          ['Subject', leaf.subject],
          ['Issuer', leaf.issuer],
          ['Serial number', html(`<code>${esc(leaf.serial)}</code>`)],
          ['Valid from', formatDate(leaf.notBefore)],
          ['Valid until', formatDate(leaf.notAfter)],
          ['SHA-1 fingerprint', html(`<code>${esc(leaf.sha1)}</code>`)],
          ...leaf.extensions.map((extension): [string, string] => [extension.name + (extension.critical ? ' (critical)' : ''), extension.value]),
        ]),
      ];
      return {
        fields,
        output: item.chain.map((entry) => toPem(entry.der)).join(''),
        filename: `${item.host}-chain.pem`,
        language: 'text',
        preview: { kind: 'html', html: report(...parts) },
        info: `Checked ${item.host}:${item.port} from this computer.`,
      };
    }

    const rows = checked.map((item) => {
      const leaf = item.chain?.[0]?.cert;
      if (!item.tls || !leaf) return [html(`<code>${esc(item.target)}</code>`), html(pill('Failed', 'bad')), item.error ?? '', '', '', ''];
      const days = daysUntil(leaf.notAfter);
      const findings = chainFindings(item.chain ?? [], item.host);
      const healthy = item.tls.trusted && findings.every((finding) => finding.tone !== 'bad');
      return [
        html(`<code>${esc(`${item.host}:${item.port}`)}</code>`),
        html(pill(healthy ? 'Valid' : item.tls.trusted ? 'Problems' : 'Not trusted', healthy ? 'ok' : 'bad')),
        formatDay(leaf.notAfter),
        html(pill(relativeDays(days), expiryTone(days, o.warn))),
        commonName(leaf.issuer),
        item.tls.protocol,
      ];
    });
    const soonest = checked.flatMap((item) => (item.chain?.[0] ? [{ host: item.host, days: daysUntil(item.chain[0].cert.notAfter) }] : [])).sort((a, b) => a.days - b.days)[0];
    return {
      fields: [
        { label: 'Checked', value: String(checked.length) },
        { label: 'Failed', value: String(checked.filter((item) => !item.tls).length), tone: checked.some((item) => !item.tls) ? 'bad' : 'ok' },
        ...(soonest ? [{ label: 'Expires first', value: `${soonest.host} (${relativeDays(soonest.days)})`, tone: expiryTone(soonest.days, o.warn) } as Field] : []),
      ],
      output: [
        'host\tport\texpires\tdays_left\tissuer\ttrusted\tprotocol',
        ...checked.map((item) =>
          [
            item.host,
            item.port,
            item.chain?.[0] ? formatDay(item.chain[0].cert.notAfter) : '',
            item.chain?.[0] ? daysUntil(item.chain[0].cert.notAfter) : '',
            item.chain?.[0] ? commonName(item.chain[0].cert.issuer) : (item.error ?? ''),
            item.tls?.trusted ?? '',
            item.tls?.protocol ?? '',
          ].join('\t'),
        ),
      ].join('\n'),
      filename: 'certificates.tsv',
      preview: { kind: 'html', html: report(table(['Host', 'Result', 'Expires', 'Days left', 'Issuer', 'Protocol'], rows)) },
      info: `Checked from this computer at ${new Date().toLocaleTimeString()}.`,
    };
  },
});
