import { fromBase64, toBase64, utf8Decode, utf8Encode } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: false,
  output: { label: 'Header' },
  options: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'segmented',
      choices: [
        { value: 'make', label: 'Create' },
        { value: 'read', label: 'Decode' },
      ],
      default: 'make',
    },
    { key: 'user', label: 'Username', type: 'text', default: 'admin', showIf: (v) => v.mode === 'make' },
    { key: 'password', label: 'Password', type: 'text', default: '', secret: true, showIf: (v) => v.mode === 'make' },
    { key: 'header', label: 'Authorization header', type: 'text', default: '', mono: true, wide: true, placeholder: 'Basic YWRtaW46c2VjcmV0', showIf: (v) => v.mode === 'read' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    if (o.mode === 'read') {
      const value = o.header
        .trim()
        .replace(/^authorization:\s*/i, '')
        .replace(/^basic\s+/i, '');
      if (value === '') return '';
      let decoded: string;
      try {
        decoded = utf8Decode(fromBase64(value));
      } catch {
        throw new ToolError('That is not valid Base64.');
      }
      const colon = decoded.indexOf(':');
      if (colon < 0) throw new ToolError('The decoded value has no ":" between username and password.');
      return {
        output: decoded,
        fields: [
          { label: 'Username', value: decoded.slice(0, colon), mono: true },
          { label: 'Password', value: decoded.slice(colon + 1), mono: true },
        ],
      };
    }
    if (o.user.includes(':')) throw new ToolError('A username cannot contain ":" in Basic authentication (RFC 7617).');
    const token = toBase64(utf8Encode(`${o.user}:${o.password}`));
    const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
    return {
      output: `Authorization: Basic ${token}`,
      fields: [
        { label: 'Token', value: token, mono: true },
        { label: 'curl', value: `curl -u ${quote(`${o.user}:${o.password}`)} https://example.org/`, mono: true },
        { label: 'fetch', value: `headers: { Authorization: 'Basic ${token}' }`, mono: true },
      ],
      warnings: ['Basic authentication only encodes the password; send it over HTTPS only.'],
    };
  },
});
