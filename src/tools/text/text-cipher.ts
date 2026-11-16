import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

type Cipher = 'AES' | 'TripleDES' | 'Rabbit' | 'RC4';

const LOADERS: Record<Cipher, () => Promise<{ encrypt: (message: string, key: string) => { toString(): string }; decrypt: (cipher: string, key: string) => { toString(encoder: unknown): string } }>> =
  {
    AES: () => import('crypto-js/aes').then((module) => module.default),
    TripleDES: () => import('crypto-js/tripledes').then((module) => module.default),
    Rabbit: () => import('crypto-js/rabbit').then((module) => module.default),
    RC4: () => import('crypto-js/rc4').then((module) => module.default),
  };

export default defineTextTool({
  input: { label: 'Text', sample: 'Meet at the planetarium at 6 pm.' },
  output: { label: 'Result' },
  options: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'segmented',
      choices: [
        { value: 'encrypt', label: 'Encrypt' },
        { value: 'decrypt', label: 'Decrypt' },
      ],
      default: 'encrypt',
    },
    {
      key: 'cipher',
      label: 'Cipher',
      type: 'select',
      choices: [
        { value: 'AES', label: 'AES-256-CBC' },
        { value: 'TripleDES', label: 'Triple DES (legacy)' },
        { value: 'Rabbit', label: 'Rabbit (legacy)' },
        { value: 'RC4', label: 'RC4 (broken, for old data only)' },
      ],
      default: 'AES',
    },
    { key: 'passphrase', label: 'Passphrase', type: 'text', default: '', secret: true },
  ],
  swap: (v) => ({ mode: v.mode === 'encrypt' ? 'decrypt' : 'encrypt' }),
  async run(input, o) {
    if (input === '') return '';
    if (o.passphrase === '') throw new ToolError('Enter a passphrase.');
    const cipher = await LOADERS[o.cipher as Cipher]();
    const warnings = o.cipher === 'AES' ? [] : [`${o.cipher} is kept for reading old data. Use AES for anything new.`];
    warnings.push('Compatible with CryptoJS and "openssl enc -md md5" (salted, key from the passphrase with MD5); for new work the AES Encryption tool’s PBKDF2 mode is stronger.');
    if (o.mode === 'encrypt') return { output: cipher.encrypt(input, o.passphrase).toString(), warnings };
    const { default: Utf8 } = await import('crypto-js/enc-utf8');
    let text = '';
    try {
      text = cipher.decrypt(input.trim(), o.passphrase).toString(Utf8);
    } catch {
      text = '';
    }
    if (text === '') throw new ToolError('Decryption failed: wrong passphrase, wrong cipher, or the text is not CryptoJS/OpenSSL output (it usually starts with U2FsdGVkX1).');
    return { output: text, warnings };
  },
});
