import { fromBase64, utf8Encode } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { ALGORITHM_NAMES, CLAIMS, describeJwk, HEADER_PARAMETERS, isAlgorithm, type Jwk, keyKind, parseToken, readKey, verifyBytes } from '../../lib/jws';
import { relativeTime } from '../../lib/jwt';
import { esc, heading, html, report, table } from '../../lib/net/report';
import { getJson } from '../../lib/net/whois';
import { net, networkStatus } from '../../platform/net';
import { defineTextTool, type Field } from '../types';

// {"alg":"HS256","typ":"JWT"} . {"sub":"1234567890","name":"Ada Lovelace","iat":1516239022,"exp":4102444800} signed with "benchtop"
const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjo0MTAyNDQ0ODAwfQ.ManHBJWIWxsOdEbNkWi4ch6pBEvoA1k3N1YcQokhnW4';

const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat', 'auth_time', 'updated_at']);

function claimValue(name: string, value: unknown): string {
  if (TIME_CLAIMS.has(name) && typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 8.64e12) {
    return `${value} (${new Date(value * 1000).toISOString().replace('.000Z', 'Z')}, ${relativeTime(value * 1000, Date.now())})`;
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function claimsTable(entries: Record<string, unknown>, meanings: Record<string, string>): string {
  return table(
    ['Name', 'Value', 'Meaning'],
    Object.entries(entries).map(([name, value]) => [html(`<code>${esc(name)}</code>`), html(`<code>${esc(claimValue(name, value))}</code>`), meanings[name] ?? '']),
  );
}

/** OpenID Connect discovery: issuer → jwks_uri → key set. */
async function issuerKeys(issuer: string): Promise<string> {
  const transport = net();
  const base = issuer.replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new ToolError('The issuer (iss) is not an https:// address, so its keys cannot be fetched.');
  const discovery = await getJson(transport, `${base}/.well-known/openid-configuration`);
  const jwksUri = (discovery.json as { jwks_uri?: unknown } | null)?.jwks_uri;
  if (discovery.status !== 200 || typeof jwksUri !== 'string') throw new ToolError(`${base} publishes no OpenID configuration (HTTP ${discovery.status}).`);
  const keys = await getJson(transport, jwksUri);
  if (keys.status !== 200 || keys.json === null) throw new ToolError(`The key set at ${jwksUri} could not be read (HTTP ${keys.status}).`);
  return keys.text;
}

export default defineTextTool({
  input: { label: 'JSON Web Token', sample: SAMPLE, placeholder: 'Paste a JWT (header.payload.signature)' },
  output: { label: 'Decoded', language: 'json' },
  options: [
    {
      key: 'secret',
      label: 'Secret or public key',
      type: 'text',
      default: '',
      secret: true,
      multiline: true,
      mono: true,
      wide: true,
      placeholder: 'HS256: the shared secret. RS, PS, ES and EdDSA: a public key or certificate (PEM), a JWK or a JWK set.',
    },
    { key: 'secretBase64', label: 'Secret is Base64 or Base64URL', type: 'toggle', default: false },
    {
      key: 'fetchKeys',
      label: 'Fetch the issuer’s public keys',
      type: 'toggle',
      default: false,
      help: 'OpenID Connect: reads iss/.well-known/openid-configuration and its key set. Desktop app only; uses the network.',
    },
  ],
  mainThread: true,
  async run(input, o) {
    const token = parseToken(input);
    const { header, payload } = token;
    const now = Date.now();
    const fields: Field[] = [];
    const warnings: string[] = [];
    const alg = header.alg;
    fields.push({
      label: 'Algorithm (alg)',
      value: isAlgorithm(alg) ? `${alg}: ${ALGORITHM_NAMES[alg]}` : String(alg ?? '(missing)'),
      tone: alg === 'none' ? 'bad' : isAlgorithm(alg) ? undefined : 'warn',
    });
    if (header.typ !== undefined) fields.push({ label: 'Type (typ)', value: String(header.typ) });
    if (header.kid !== undefined) fields.push({ label: 'Key ID (kid)', value: String(header.kid), mono: true });

    const claims = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    if (claims) {
      for (const [claim, label] of [
        ['iss', 'Issuer (iss)'],
        ['sub', 'Subject (sub)'],
        ['aud', 'Audience (aud)'],
        ['jti', 'Token ID (jti)'],
      ] as const) {
        if (claims[claim] !== undefined) fields.push({ label, value: typeof claims[claim] === 'string' ? (claims[claim] as string) : JSON.stringify(claims[claim]) });
      }
      for (const [claim, label] of [
        ['iat', 'Issued at (iat)'],
        ['nbf', 'Not before (nbf)'],
        ['exp', 'Expires (exp)'],
      ] as const) {
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
        } else if (claim === 'iat' && ms > now + 60_000) {
          tone = 'warn';
          note = `in the future: ${note}`;
        }
        fields.push({ label, value: `${new Date(ms).toISOString()}  (${note})`, tone });
      }
      if (claims.exp === undefined) warnings.push('The token has no expiry (exp), so it stays valid until the key changes.');
    }
    for (const risky of ['jku', 'x5u', 'jwk']) {
      if (header[risky] !== undefined)
        warnings.push(`The header carries "${risky}". A receiver must never take the verification key from the token itself without checking it against keys it already trusts.`);
    }
    if (Array.isArray(header.crit)) warnings.push(`The header marks ${header.crit.join(', ')} as critical: receivers that do not understand them must reject the token.`);

    let keyText = o.secret.trim();
    let keySource = '';
    if (keyText === '' && o.fetchKeys && alg !== 'none' && !String(alg).startsWith('HS')) {
      const status = networkStatus();
      if (!status.ok) throw new ToolError(status.reason);
      if (typeof claims?.iss !== 'string') throw new ToolError('The token has no issuer (iss), so its keys cannot be found.');
      keyText = await issuerKeys(claims.iss);
      keySource = ` (key set from ${claims.iss})`;
    }

    if (alg === 'none') {
      fields.push({ label: 'Signature', value: 'Unsigned token (alg "none"): never trust its contents', tone: 'bad' });
    } else if (!isAlgorithm(alg)) {
      fields.push({ label: 'Signature', value: `The algorithm "${String(alg)}" is not one this tool can check`, tone: 'warn' });
    } else if (keyText === '') {
      fields.push({
        label: 'Signature',
        value: keyKind(alg) === 'secret' ? 'Not verified: enter the shared secret to check it' : 'Not verified: enter the public key (PEM, JWK or JWK set) to check it',
        tone: 'muted',
      });
    } else {
      let key: Jwk | Uint8Array;
      if (keyKind(alg) === 'secret') {
        if (keyText.startsWith('{')) key = readKey(keyText, header);
        else {
          if (/-----BEGIN/.test(keyText)) warnings.push('An HS token checked with a PEM key as its secret: this is the classic algorithm-confusion attack. Real HS tokens use a random shared secret.');
          try {
            key = o.secretBase64 ? fromBase64(keyText) : utf8Encode(o.secret);
          } catch {
            throw new ToolError('The secret is not valid Base64.');
          }
          const minimum = Number(String(alg).slice(2)) / 8;
          if (key.length < minimum) warnings.push(`The secret is ${key.length} bytes; RFC 7518 requires at least ${minimum} bytes for ${String(alg)}, and short secrets can be brute-forced.`);
        }
      } else {
        key = readKey(keyText, header);
        fields.push({ label: 'Key', value: `${describeJwk(key)}${key.kid ? `, kid ${key.kid}` : ''}${keySource}` });
      }
      const valid = await verifyBytes(alg, key, utf8Encode(token.signingInput), token.signature);
      const what = key instanceof Uint8Array || key.kty === 'oct' ? 'secret' : 'key';
      fields.push(valid ? { label: 'Signature', value: `Valid for this ${what}`, tone: 'ok' } : { label: 'Signature', value: `INVALID for this ${what}`, tone: 'bad' });
    }

    return {
      output: JSON.stringify({ header, payload }, null, 2),
      fields,
      warnings: warnings.length > 0 ? warnings : undefined,
      preview: {
        kind: 'html',
        html: report(heading('Header'), claimsTable(header, HEADER_PARAMETERS), heading('Payload'), claims ? claimsTable(claims, CLAIMS) : `<pre>${esc(token.payloadText)}</pre>`),
      },
    };
  },
});
