import { generateKeyPair, KEY_KINDS, type KeyKind } from '../../lib/ssh-keys';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: false,
  output: { label: 'Keys' },
  options: [
    { key: 'kind', label: 'Key type', type: 'select', choices: KEY_KINDS, default: 'ed25519' },
    { key: 'comment', label: 'Comment', type: 'text', default: 'me@workstation', mono: true, help: 'Usually user@host; it helps you recognise the key later.' },
    {
      key: 'show',
      label: 'Show',
      type: 'segmented',
      choices: [
        { value: 'ssh', label: 'OpenSSH' },
        { value: 'pem', label: 'PEM (PKCS #8)' },
      ],
      default: 'ssh',
    },
  ],
  action: 'Generate',
  runOnEmpty: true,
  async run(_input, o) {
    const pair = await generateKeyPair(o.kind as KeyKind, o.comment);
    const output = o.show === 'pem' ? `${pair.pemPublic}\n${pair.pemPrivate}` : `${pair.sshPublic}\n\n${pair.sshPrivate}`;
    const file = o.kind === 'ed25519' ? 'id_ed25519' : o.kind.startsWith('ecdsa') ? 'id_ecdsa' : 'id_rsa';
    return {
      output,
      fields: [
        { label: 'Public key', value: pair.sshPublic, mono: true },
        { label: 'Fingerprint', value: pair.fingerprint, mono: true },
        { label: 'Size', value: `${pair.bits} bits` },
      ],
      warnings: ['The private key is not protected by a passphrase. After saving it, add one with: ssh-keygen -p -f ~/.ssh/' + file],
      info: `Save the private key as ~/.ssh/${file} (then chmod 600 it) and the public line as ~/.ssh/${file}.pub. Keys are generated on this computer and never stored by Benchtop.`,
      filename: file,
    };
  },
});
