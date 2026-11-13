import { fromBase64, utf8Encode } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { decodeJwt, isHmacAlgorithm, relativeTime, verifyJwt } from '../../lib/jwt';
import { defineTextTool, type Field } from '../types';

// {"alg":"HS256","typ":"JWT"} . {"sub":"1234567890","name":"Ada Lovelace","iat":1516239022,"exp":4102444800} signed with "benchtop"
const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjo0MTAyNDQ0ODAwfQ.ManHBJWIWxsOdEbNkWi4ch6pBEvoA1k3N1YcQokhnW4';

const CLAIM_NAMES: Record<string, string> = {
  iss: 'Issuer (iss)',
  sub: 'Subject (sub)',
  aud: 'Audience (aud)',
  jti: 'Token ID (jti)',
};

export default defineTextTool({
  input: { label: 'JSON Web Token', sample: SAMPLE, placeholder: 'Paste a JWT (header.payload.signature)' },
  output: { label: 'Decoded', language: 'json' },
  options: [
    {
      key: 'secret',
      label: 'Secret (to verify HS256/384/512)',
      type: 'text',
      default: '',
      secret: true,
      wide: true,
      placeholder: 'optional',
    },
    { key: 'secretBase64', label: 'Secret is Base64', type: 'toggle', default: false },
  ],
  run(input, o) {
    const decoded = decodeJwt(input);
    const now = Date.now();
    const fields: Field[] = [];
    const header = decoded.header;
    const payload = decoded.payload;
    fields.push({ label: 'Algorithm (alg)', value: String(header.alg ?? '(missing)'), tone: header.alg === 'none' ? 'bad' : undefined });
    if (header.typ !== undefined) fields.push({ label: 'Type (typ)', value: String(header.typ) });
    if (header.kid !== undefined) fields.push({ label: 'Key ID (kid)', value: String(header.kid) });

    if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
      const claims = payload as Record<string, unknown>;
      for (const [claim, label] of Object.entries(CLAIM_NAMES)) {
        if (claims[claim] !== undefined) {
          const value = claims[claim];
          fields.push({ label, value: typeof value === 'string' ? value : JSON.stringify(value) });
        }
      }
      const timeClaims: [string, string][] = [
        ['iat', 'Issued at (iat)'],
        ['nbf', 'Not before (nbf)'],
        ['exp', 'Expires (exp)'],
      ];
      for (const [claim, label] of timeClaims) {
        const value = claims[claim];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 8.64e12) {
          fields.push({ label, value: `${JSON.stringify(value)} (not a valid NumericDate)`, tone: 'bad' });
          continue;
        }
        const ms = value * 1000;
        let tone: Field['tone'];
        let note = relativeTime(ms, now);
        if (claim === 'exp') {
          tone = ms <= now ? 'bad' : 'ok';
          note = ms <= now ? `expired ${note}` : `valid, expires ${note}`;
        } else if (claim === 'nbf' && ms > now) {
          tone = 'warn';
          note = `not valid yet, starts ${note}`;
        }
        fields.push({ label, value: `${new Date(ms).toISOString()}  (${note})`, tone });
      }
    }

    if (header.alg === 'none') {
      fields.push({ label: 'Signature', value: 'Unsigned token (alg "none") — never trust its contents', tone: 'bad' });
    } else if (o.secret !== '') {
      let key: Uint8Array;
      try {
        key = o.secretBase64 ? fromBase64(o.secret) : utf8Encode(o.secret);
      } catch {
        throw new ToolError('The secret is not valid Base64.');
      }
      const verdict = verifyJwt(decoded, key);
      fields.push(
        verdict === null
          ? { label: 'Signature', value: `Cannot be checked with a shared secret (${String(header.alg)} uses a key pair)`, tone: 'muted' }
          : verdict
            ? { label: 'Signature', value: 'Valid for this secret', tone: 'ok' }
            : { label: 'Signature', value: 'INVALID for this secret', tone: 'bad' },
      );
    } else {
      fields.push({
        label: 'Signature',
        value: isHmacAlgorithm(header.alg) ? 'Not verified — enter the secret to check it' : 'Not verified',
        tone: 'muted',
      });
    }

    return { output: JSON.stringify({ header, payload }, null, 2), fields };
  },
});
