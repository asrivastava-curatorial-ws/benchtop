import { fromBase64, utf8Encode } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { ALGORITHM_NAMES, ALGORITHMS, type Algorithm, b64url, describeJwk, generateKey, type Jwk, jwkToPem, keyKind, readKey, signToken, thumbprint } from '../../lib/jws';
import { esc, heading, note, report } from '../../lib/net/report';
import { defineTextTool, type Values } from '../types';

const LIFETIMES: Record<string, number> = { '5m': 300, '1h': 3600, '1d': 86400, '7d': 604800, '30d': 2592000 };

const isHmac = (values: Values): boolean => String(values.algorithm).startsWith('HS');

/** Generated keys are kept until the algorithm changes or Regenerate is pressed, so typing does not replace them. */
const generated = new Map<string, Awaited<ReturnType<typeof generateKey>>>();

export default defineTextTool({
  input: {
    label: 'Payload (JSON)',
    language: 'json',
    sample: '{\n  "sub": "1234567890",\n  "name": "Ada Lovelace",\n  "admin": true\n}',
  },
  output: { label: 'Signed token' },
  options: [
    {
      key: 'algorithm',
      label: 'Algorithm',
      type: 'select',
      choices: ALGORITHMS.filter((alg) => alg !== 'none').map((alg) => ({ value: alg, label: `${alg}: ${ALGORITHM_NAMES[alg]}` })),
      default: 'HS256',
    },
    {
      key: 'keySource',
      label: 'Key',
      type: 'segmented',
      choices: [
        { value: 'mine', label: 'Use my key' },
        { value: 'generate', label: 'Generate one' },
      ],
      default: 'mine',
    },
    {
      key: 'secret',
      label: 'Secret or private key',
      type: 'text',
      default: '',
      secret: true,
      multiline: true,
      mono: true,
      wide: true,
      placeholder: 'HS256: a shared secret. Other algorithms: a private key as PEM or JWK.',
      showIf: (v) => v.keySource === 'mine',
    },
    { key: 'secretBase64', label: 'Secret is Base64 or Base64URL', type: 'toggle', default: false, showIf: (v) => v.keySource === 'mine' && isHmac(v) },
    {
      key: 'typ',
      label: 'Type (typ)',
      type: 'select',
      choices: [
        { value: 'JWT', label: 'JWT' },
        { value: 'at+jwt', label: 'at+jwt (OAuth access token)' },
        { value: 'none', label: 'Leave out' },
      ],
      default: 'JWT',
    },
    { key: 'kid', label: 'Key ID (kid)', type: 'text', default: '', mono: true, placeholder: 'Optional; "auto" uses the key’s thumbprint' },
    { key: 'addIat', label: 'Add "iat" (now)', type: 'toggle', default: false },
    {
      key: 'expiresIn',
      label: 'Add "exp"',
      type: 'select',
      choices: [
        { value: 'none', label: 'No' },
        { value: '5m', label: 'In 5 minutes' },
        { value: '1h', label: 'In 1 hour' },
        { value: '1d', label: 'In 1 day' },
        { value: '7d', label: 'In 7 days' },
        { value: '30d', label: 'In 30 days' },
      ],
      default: 'none',
    },
    { key: 'extraHeader', label: 'Extra header fields (JSON)', type: 'text', default: '', mono: true, wide: true, placeholder: '{"cty": "JWT"}' },
  ],
  async run(input, o, ctx) {
    const payload = parseJson(input);
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new ToolError('The payload must be a JSON object, for example {"sub": "123"}.');
    const algorithm = o.algorithm as Algorithm;
    const warnings: string[] = [];
    let key: Jwk | Uint8Array;
    let keyReport = '';
    if (o.keySource === 'generate') {
      const cacheKey = `${algorithm}:${ctx.nonce}`;
      let made = generated.get(cacheKey);
      if (!made) {
        made = await generateKey(algorithm);
        generated.clear();
        generated.set(cacheKey, made);
      }
      if (made instanceof Uint8Array) {
        key = made;
        keyReport = heading('Generated secret (Base64URL)') + `<pre>${esc(b64url(made))}</pre>` + note('Turn on "Secret is Base64 or Base64URL" in the decoder to verify with it.');
      } else {
        key = made.privateJwk;
        keyReport =
          heading('Public key (PEM)') +
          `<pre>${esc(jwkToPem(made.publicJwk))}</pre>` +
          heading('Public key (JWK)') +
          `<pre>${esc(JSON.stringify({ ...made.publicJwk, alg: algorithm, use: 'sig', kid: thumbprint(made.publicJwk) }, null, 2))}</pre>` +
          heading('Private key (PEM, PKCS #8)') +
          `<pre>${esc(jwkToPem(made.privateJwk, 'private'))}</pre>` +
          heading('Private key (JWK)') +
          `<pre>${esc(JSON.stringify(made.privateJwk, null, 2))}</pre>` +
          note('Generated on this computer for testing. Press Regenerate for a new pair; keys are not saved.');
      }
    } else {
      if (o.secret.trim() === '')
        throw new ToolError(
          keyKind(algorithm) === 'secret' ? 'Enter a secret to sign the token with, or choose Generate one.' : `Enter a private key for ${algorithm} (PEM or JWK), or choose Generate one.`,
        );
      if (keyKind(algorithm) === 'secret' && !o.secret.trim().startsWith('{')) {
        try {
          key = o.secretBase64 ? fromBase64(o.secret.trim()) : utf8Encode(o.secret);
        } catch {
          throw new ToolError('The secret is not valid Base64.');
        }
        const minimum = Number(algorithm.slice(2)) / 8;
        if (key.length < minimum) warnings.push(`The secret is ${key.length} bytes; RFC 7518 requires at least ${minimum} bytes for ${algorithm}.`);
      } else {
        key = readKey(o.secret);
      }
    }
    let extra: Record<string, unknown> = {};
    if (o.extraHeader.trim() !== '') {
      const parsed = parseJson(o.extraHeader);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ToolError('Extra header fields must be a JSON object.');
      extra = parsed as Record<string, unknown>;
    }
    const header: Record<string, unknown> = { ...extra, alg: algorithm };
    if (o.typ !== 'none') header.typ = o.typ;
    const kid = o.kid.trim();
    if (kid === 'auto' && !(key instanceof Uint8Array)) header.kid = thumbprint(key);
    else if (kid !== '' && kid !== 'auto') header.kid = kid;
    const claims: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
    const now = Math.floor(Date.now() / 1000);
    if (o.addIat) claims.iat = now;
    const lifetime = LIFETIMES[o.expiresIn];
    if (lifetime !== undefined) claims.exp = now + lifetime;
    const token = await signToken(header, claims, algorithm, key);
    return {
      output: token,
      fields: [
        { label: 'Header', value: JSON.stringify(header), mono: true },
        { label: 'Payload', value: JSON.stringify(claims), mono: true },
        { label: 'Signed with', value: key instanceof Uint8Array ? `${key.length}-byte secret` : describeJwk(key) },
        { label: 'Length', value: `${token.length} characters` },
      ],
      warnings: warnings.length > 0 ? warnings : undefined,
      preview: keyReport ? { kind: 'html', html: report(heading('Token'), `<pre class="wrap">${esc(token)}</pre>`, keyReport) } : undefined,
    };
  },
});
