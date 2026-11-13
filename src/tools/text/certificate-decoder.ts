import { relativeTime } from '../../lib/jwt';
import { decodeBlock, describeKey, readBlocks } from '../../lib/x509';
import { defineTextTool, type Field } from '../types';

/** A self-signed sample (EC P-256) made for this app; its private key was discarded. */
const SAMPLE = `-----BEGIN CERTIFICATE-----
MIIClTCCAjugAwIBAgIUIJbPU2dv+NyIn6A2P6WoMz14qVowCgYIKoZIzj0EAwIw
bTELMAkGA1UEBhMCSU4xEjAQBgNVBAgMCUthcm5hdGFrYTESMBAGA1UEBwwJQmVu
Z2FsdXJ1MRgwFgYDVQQKDA9CZW5jaHRvcCBTYW1wbGUxHDAaBgNVBAMME3RpY2tl
dHMuZXhhbXBsZS5vcmcwHhcNMjYxMTEzMDcyODExWhcNMzYxMTEwMDcyODExWjBt
MQswCQYDVQQGEwJJTjESMBAGA1UECAwJS2FybmF0YWthMRIwEAYDVQQHDAlCZW5n
YWx1cnUxGDAWBgNVBAoMD0JlbmNodG9wIFNhbXBsZTEcMBoGA1UEAwwTdGlja2V0
cy5leGFtcGxlLm9yZzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABCxpYOtZf+RL
b4xMdgJHFlWi2HLev41xSYpXhX2TjHK1toqmu8l9n5r1ztr/fP9Ube76JpPrhs+Q
BgjoK+OCrP+jgbgwgbUwHQYDVR0OBBYEFOJuF444KHi8gD/4iv2ebCimyy3LMB8G
A1UdIwQYMBaAFOJuF444KHi8gD/4iv2ebCimyy3LMA8GA1UdEwEB/wQFMAMBAf8w
PQYDVR0RBDYwNIITdGlja2V0cy5leGFtcGxlLm9yZ4IXd3d3LnRpY2tldHMuZXhh
bXBsZS5vcmeHBMAAAgowDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUF
BwMBMAoGCCqGSM49BAMCA0gAMEUCID9URs3mbk2yfQKxd+IBwZY9LdGKyiWKixqS
pwyh4FyzAiEAkm17Rbvx60tCHic2UNdhrJZkQPoewO4dsoVkY5tpLJ4=
-----END CERTIFICATE-----
`;

export default defineTextTool({
  input: { label: 'Certificate, request or key (PEM or DER)', sample: SAMPLE, placeholder: '-----BEGIN CERTIFICATE-----', accept: '.pem,.crt,.cer,.der,.csr,.key,.pub', binary: true },
  output: { label: 'Details' },
  options: [],
  run(input, _o, ctx) {
    const blocks = readBlocks(input, ctx.file?.bytes ?? null);
    const now = Date.now();
    const fields: Field[] = [];
    const warnings: string[] = [];
    const sections = blocks.map((block, index) => {
      const decoded = decodeBlock(block);
      const title = blocks.length > 1 ? `#${index + 1} ` : '';
      if (decoded.kind === 'certificate') {
        const expired = decoded.notAfter.getTime() < now;
        const future = decoded.notBefore.getTime() > now;
        if (index === 0) {
          fields.push(
            { label: 'Subject', value: decoded.subject },
            { label: 'Issuer', value: decoded.selfSigned ? `${decoded.issuer} (self-signed)` : decoded.issuer },
            {
              label: 'Valid until',
              value: `${decoded.notAfter.toISOString().replace('.000Z', 'Z')} (${relativeTime(decoded.notAfter.getTime(), now)})`,
              tone: expired ? 'bad' : decoded.notAfter.getTime() - now < 30 * 86400000 ? 'warn' : 'ok',
            },
            { label: 'Key', value: describeKey(decoded.publicKey) },
          );
          const san = decoded.extensions.find((extension) => extension.name === 'Subject alternative names');
          if (san) fields.push({ label: 'Names', value: san.value });
        }
        if (expired) warnings.push(`${title}This certificate expired ${relativeTime(decoded.notAfter.getTime(), now)}.`);
        if (future) warnings.push(`${title}This certificate is not valid until ${decoded.notBefore.toISOString()}.`);
        if (/SHA-1|MD5/.test(decoded.signature)) warnings.push(`${title}Signed with ${decoded.signature}, which browsers no longer accept.`);
        if (decoded.publicKey.algorithm === 'RSA' && decoded.publicKey.bits < 2048) warnings.push(`${title}RSA keys shorter than 2048 bits are considered weak.`);
        return [
          `${title}Certificate (version ${decoded.version})`,
          `  Subject:      ${decoded.subject}`,
          `  Issuer:       ${decoded.issuer}`,
          `  Serial:       ${decoded.serial}`,
          `  Valid from:   ${decoded.notBefore.toISOString()}`,
          `  Valid until:  ${decoded.notAfter.toISOString()}`,
          `  Public key:   ${describeKey(decoded.publicKey)}`,
          `  Signature:    ${decoded.signature}`,
          `  SHA-256:      ${decoded.sha256}`,
          `  SHA-1:        ${decoded.sha1}`,
          ...(decoded.extensions.length > 0 ? ['  Extensions:', ...decoded.extensions.map((extension) => `    ${extension.name}${extension.critical ? ' (critical)' : ''}: ${extension.value}`)] : []),
        ].join('\n');
      }
      if (decoded.kind === 'request') {
        if (index === 0) fields.push({ label: 'Request for', value: decoded.subject }, { label: 'Key', value: describeKey(decoded.publicKey) });
        return [
          `${title}Certificate signing request`,
          `  Subject:    ${decoded.subject}`,
          `  Public key: ${describeKey(decoded.publicKey)}`,
          `  Signature:  ${decoded.signature}`,
          ...decoded.extensions.map((extension) => `  ${extension.name}: ${extension.value}`),
        ].join('\n');
      }
      if (decoded.kind === 'public key' || decoded.kind === 'private key') {
        if (index === 0) fields.push({ label: 'Contents', value: `${decoded.description} ${decoded.kind} (${decoded.format})` });
        if (decoded.kind === 'private key') warnings.push(`${title}This is a private key. Keep it secret; it is only read on this computer.`);
        return `${title}${decoded.kind === 'private key' ? 'Private' : 'Public'} key: ${decoded.description} (${decoded.format})`;
      }
      if (decoded.kind === 'encrypted') return `${title}Encrypted private key: the contents cannot be shown without the password.`;
      return `${title}"${'label' in decoded ? decoded.label : 'Unknown'}" block: this tool reads certificates, certificate requests and keys.`;
    });
    if (blocks.length > 1) fields.unshift({ label: 'Blocks', value: `${blocks.length} (a certificate chain or bundle)` });
    return { output: `${sections.join('\n\n')}\n`, fields, warnings };
  },
});
