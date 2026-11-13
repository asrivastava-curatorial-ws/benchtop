import { type AesFormat, aesDecrypt, aesEncrypt } from '../../lib/aes';
import { formatBytes, utf8Decode, utf8Encode } from '../../lib/bytes';
import { defineTextTool, type Values } from '../types';
import { decodedResult, MODE, swapMode } from './_shared';

const isOpenSsl = (v: Values): boolean => v.format === 'openssl';

export default defineTextTool({
  input: { label: 'Input', sample: 'Attack at dawn — or maybe after coffee.', binary: true, placeholder: 'Text or file to encrypt, or encrypted Base64 to decrypt' },
  output: { label: 'Output' },
  options: [
    {
      ...MODE,
      choices: [
        { value: 'encode', label: 'Encrypt' },
        { value: 'decode', label: 'Decrypt' },
      ],
    },
    { key: 'password', label: 'Password', type: 'text', default: '', secret: true, wide: true },
    {
      key: 'format',
      label: 'Format',
      type: 'select',
      choices: [
        { value: 'gcm', label: 'AES-256-GCM (authenticated, recommended)' },
        { value: 'openssl', label: 'OpenSSL compatible (AES-256-CBC)' },
      ],
      default: 'gcm',
    },
    {
      key: 'iterations',
      label: 'PBKDF2 iterations',
      type: 'number',
      default: 600000,
      min: 1,
      max: 10000000,
      step: 1000,
      showIf: (v: Values) => v.mode === 'encode' || isOpenSsl(v),
      help: 'Higher is slower to brute-force. The GCM format stores this number; for OpenSSL you must pass the same -iter.',
    },
  ],
  live: false,
  action: 'Run',
  swap: swapMode,
  async run(input, o, ctx) {
    const format = o.format as AesFormat;
    const command = `openssl enc ${o.mode === 'encode' ? '' : '-d '}-aes-256-cbc -pbkdf2 -md sha256 -iter ${o.iterations} -salt -a`;
    if (o.mode === 'encode') {
      const data = ctx.file ? ctx.file.bytes : utf8Encode(input);
      const output = await aesEncrypt(data, o.password, format, o.iterations);
      return {
        output,
        info: `Encrypted ${formatBytes(data.length)} with ${format === 'gcm' ? 'AES-256-GCM' : 'AES-256-CBC'} · key from PBKDF2-HMAC-SHA256 × ${o.iterations.toLocaleString('en-US')}`,
        fields: format === 'openssl' ? [{ label: 'Decrypt with OpenSSL', value: command.replace('enc ', 'enc -d '), mono: true }] : [],
        warnings: format === 'openssl' ? ['AES-CBC does not detect tampering. Prefer the GCM format unless you need OpenSSL compatibility.'] : undefined,
        filename: 'encrypted.txt',
      };
    }
    const text = ctx.file ? utf8Decode(ctx.file.bytes) : input;
    const plain = await aesDecrypt(text, o.password, format, o.iterations);
    return decodedResult(plain);
  },
});
