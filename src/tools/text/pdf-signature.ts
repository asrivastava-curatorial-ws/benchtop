import { ToolError } from '../../lib/errors';
import { daysUntil, esc, formatDate, heading, html, note, pairs, pill, report, table } from '../../lib/net/report';
import { commonName } from '../../lib/net/tls';
import { checkPdfSignatures } from '../../lib/pdf-signature';
import { defineTextTool, type Field } from '../types';

export default defineTextTool({
  input: { label: 'PDF file', binary: true, accept: '.pdf,application/pdf', placeholder: 'Open or drop a signed PDF' },
  output: false,
  options: [],
  async run(_input, _o, ctx) {
    if (!ctx.file) return {};
    const signatures = await checkPdfSignatures(ctx.file.bytes);
    if (signatures.length === 0) return { fields: [{ label: 'Signatures', value: 'None: this PDF is not digitally signed', tone: 'muted' }] };
    const fields: Field[] = [{ label: 'Signatures', value: String(signatures.length) }];
    const sections = signatures.map((signature) => {
      const good = signature.integrity === true && signature.signatureValid === true;
      const verdict = good ? 'Valid' : signature.integrity === false || signature.signatureValid === false ? 'Invalid' : 'Not fully checked';
      const tone = good ? 'ok' : verdict === 'Invalid' ? 'bad' : 'warn';
      const who = signature.signer ? commonName(signature.signer.subject) : (signature.name ?? 'Unknown signer');
      fields.push({ label: `${signature.isTimestamp ? 'Timestamp' : 'Signature'} ${signature.index}`, value: `${verdict}: ${who}`, tone });
      const certRows = signature.chain.map((cert) => [
        commonName(cert.subject),
        commonName(cert.issuer),
        html(pill(cert.notAfter.toISOString().slice(0, 10), daysUntil(cert.notAfter) < 0 ? 'bad' : 'ok')),
      ]);
      return (
        heading(`${signature.isTimestamp ? 'Document timestamp' : 'Signature'} ${signature.index}: ${verdict}`) +
        pairs([
          ['Signed by', who],
          ['Name in the signature', signature.name],
          ['Signed at', signature.signingTime ? formatDate(signature.signingTime) : undefined],
          ['Reason', signature.reason],
          ['Location', signature.location],
          [
            'Document unchanged since signing',
            html(
              pill(
                signature.integrity === null ? 'Not checked' : signature.integrity ? 'Yes' : 'NO: the signed bytes were altered',
                signature.integrity === null ? 'warn' : signature.integrity ? 'ok' : 'bad',
              ),
            ),
          ],
          [
            'Signature matches the signer’s key',
            html(
              pill(signature.signatureValid === null ? 'Not checked' : signature.signatureValid ? 'Yes' : 'NO', signature.signatureValid === null ? 'warn' : signature.signatureValid ? 'ok' : 'bad'),
            ),
          ],
          ['Covers the whole file', signature.coversWholeFile ? 'Yes' : 'No: content was added after this signature (an incremental update, such as a later signature or form filling)'],
          ['Format', signature.subFilter],
          ['Digest', signature.digestAlgorithm],
          ['Byte range', html(`<code>${esc(signature.byteRange.join(' '))}</code>`)],
        ]) +
        signature.problems.map((problem) => note(problem, 'warn')).join('') +
        (certRows.length > 0 ? table(['Certificate', 'Issued by', 'Valid until'], certRows) : '')
      );
    });
    return {
      fields,
      preview: {
        kind: 'html',
        html: report(
          ...sections,
          note('Whether the signer’s certificate authority is trusted (for example a CCA India licensed CA or Adobe AATL) is not checked here; open the file in a PDF reader for that.'),
        ),
      },
      info: `${ctx.file.name}`,
    };
  },
});
export { ToolError };
