import { ToolError } from '../../lib/errors';
import { apr1, bcryptEntry, bcryptTruncates, hashKind, randomSalt, shaEntry, verifyPassword } from '../../lib/htpasswd';
import { defineTextTool, type Field, type Values } from '../types';

export default defineTextTool({
  input: false,
  output: { label: '.htpasswd line' },
  options: [
    { key: 'username', label: 'Username', type: 'text', default: 'admin', mono: true },
    { key: 'password', label: 'Password', type: 'text', default: '', secret: true, wide: true },
    {
      key: 'algorithm',
      label: 'Hash',
      type: 'select',
      choices: [
        { value: 'bcrypt', label: 'bcrypt (recommended)' },
        { value: 'apr1', label: 'APR1-MD5 (legacy default)' },
        { value: 'sha1', label: 'SHA-1 (insecure, legacy)' },
      ],
      default: 'bcrypt',
    },
    {
      key: 'cost',
      label: 'bcrypt cost',
      type: 'range',
      default: 10,
      min: 4,
      max: 14,
      step: 1,
      showIf: (v: Values) => v.algorithm === 'bcrypt',
      help: 'Each step doubles the work for an attacker (and for your server on every login).',
    },
    {
      key: 'verify',
      label: 'Check against an existing entry',
      type: 'text',
      default: '',
      mono: true,
      wide: true,
      placeholder: 'user:$2y$10$… (optional)',
    },
  ],
  live: false,
  action: 'Generate',
  run(_input, o) {
    const username = o.username.trim();
    if (username === '') throw new ToolError('Enter a username.');
    if (username.includes(':')) throw new ToolError('A username cannot contain a colon (:).');
    if (/\s/.test(username)) throw new ToolError('A username cannot contain spaces.');
    if (o.password === '') throw new ToolError('Enter a password.');

    const fields: Field[] = [];
    const existing = o.verify.trim();
    if (existing !== '') {
      const hash = existing.includes(':') && !existing.startsWith('$') && !existing.startsWith('{') ? existing.slice(existing.indexOf(':') + 1) : existing;
      const verdict = verifyPassword(o.password, hash.trim());
      fields.push(
        verdict === null
          ? { label: 'Existing entry', value: 'Unrecognised hash format (bcrypt, APR1 and {SHA} can be checked)', tone: 'warn' }
          : verdict
            ? { label: 'Existing entry', value: `The password matches this ${hashKind(hash.trim())} hash`, tone: 'ok' }
            : { label: 'Existing entry', value: 'The password does NOT match this hash', tone: 'bad' },
      );
    }

    const warnings: string[] = [];
    let hash: string;
    if (o.algorithm === 'apr1') {
      hash = apr1(o.password, randomSalt(8));
    } else if (o.algorithm === 'sha1') {
      hash = shaEntry(o.password);
      warnings.push('{SHA} hashes are unsalted and fast to crack. Use bcrypt unless an old system requires this.');
    } else {
      hash = bcryptEntry(o.password, o.cost);
      if (bcryptTruncates(o.password)) warnings.push('bcrypt only uses the first 72 bytes of a password; the rest is ignored.');
    }
    fields.push({ label: 'Apache', value: 'AuthUserFile /etc/apache2/.htpasswd', mono: true }, { label: 'nginx', value: 'auth_basic_user_file /etc/nginx/.htpasswd;', mono: true });
    return { output: `${username}:${hash}`, fields, warnings: warnings.length > 0 ? warnings : undefined, filename: '.htpasswd' };
  },
});
