import { fromBase64, utf8Encode } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { type HmacAlgorithm, signJwt } from '../../lib/jwt';
import { defineTextTool } from '../types';

const LIFETIMES: Record<string, number> = { '5m': 300, '1h': 3600, '1d': 86400, '7d': 604800, '30d': 2592000 };

export default defineTextTool({
  input: {
    label: 'Payload (JSON)',
    language: 'json',
    sample: '{\n  "sub": "1234567890",\n  "name": "Ada Lovelace",\n  "admin": true\n}',
  },
  output: { label: 'Signed token' },
  options: [
    { key: 'algorithm', label: 'Algorithm', type: 'select', choices: ['HS256', 'HS384', 'HS512'], default: 'HS256' },
    { key: 'secret', label: 'Secret', type: 'text', default: '', secret: true, wide: true, placeholder: 'required' },
    { key: 'secretBase64', label: 'Secret is Base64', type: 'toggle', default: false },
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
    {
      key: 'extraHeader',
      label: 'Extra header fields (JSON)',
      type: 'text',
      default: '',
      mono: true,
      wide: true,
      placeholder: '{"kid": "key-1"}',
    },
  ],
  run(input, o) {
    const payload = parseJson(input);
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ToolError('The payload must be a JSON object, for example {"sub": "123"}.');
    }
    if (o.secret === '') throw new ToolError('Enter a secret to sign the token with.');
    let key: Uint8Array;
    try {
      key = o.secretBase64 ? fromBase64(o.secret) : utf8Encode(o.secret);
    } catch {
      throw new ToolError('The secret is not valid Base64.');
    }
    let extra: Record<string, unknown> = {};
    if (o.extraHeader.trim() !== '') {
      const parsed = parseJson(o.extraHeader);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ToolError('Extra header fields must be a JSON object.');
      }
      extra = parsed as Record<string, unknown>;
    }
    const algorithm = o.algorithm as HmacAlgorithm;
    const header = { ...extra, alg: algorithm, typ: 'JWT' };
    const claims: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
    const now = Math.floor(Date.now() / 1000);
    if (o.addIat) claims.iat = now;
    const lifetime = LIFETIMES[o.expiresIn];
    if (lifetime !== undefined) claims.exp = now + lifetime;
    const minimum = { HS256: 32, HS384: 48, HS512: 64 }[algorithm];
    return {
      output: signJwt(header, claims, key, algorithm),
      fields: [
        { label: 'Header', value: JSON.stringify(header), mono: true },
        { label: 'Payload', value: JSON.stringify(claims), mono: true },
      ],
      warnings: key.length < minimum ? [`The secret is ${key.length} bytes; RFC 7518 requires at least ${minimum} bytes for ${algorithm}.`] : undefined,
    };
  },
});
