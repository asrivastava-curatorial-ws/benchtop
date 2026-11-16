import { randomBytes, toBase64, toHex, utf8Encode } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

export default defineTextTool({
  input: false,
  output: { label: 'Hash' },
  options: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'segmented',
      choices: [
        { value: 'hash', label: 'Hash' },
        { value: 'verify', label: 'Verify' },
      ],
      default: 'hash',
    },
    {
      key: 'algorithm',
      label: 'Algorithm',
      type: 'select',
      choices: [
        { value: 'argon2id', label: 'Argon2id (recommended)' },
        { value: 'bcrypt', label: 'bcrypt' },
        { value: 'scrypt', label: 'scrypt' },
        { value: 'pbkdf2', label: 'PBKDF2-HMAC-SHA256' },
      ],
      default: 'argon2id',
    },
    { key: 'password', label: 'Password', type: 'text', default: '', secret: true },
    { key: 'hash', label: 'Stored hash', type: 'text', default: '', mono: true, wide: true, showIf: (v) => v.mode === 'verify' },
    { key: 'cost', label: 'bcrypt cost', type: 'number', default: 12, min: 4, max: 16, step: 1, showIf: (v) => v.mode === 'hash' && v.algorithm === 'bcrypt' },
    {
      key: 'memory',
      label: 'Argon2 memory',
      type: 'number',
      default: 19456,
      min: 1024,
      max: 1048576,
      step: 1024,
      unit: 'KiB',
      showIf: (v) => v.mode === 'hash' && v.algorithm === 'argon2id',
      help: 'OWASP minimum: 19 MiB with 2 passes.',
    },
    { key: 'passes', label: 'Argon2 passes', type: 'number', default: 2, min: 1, max: 20, step: 1, showIf: (v) => v.mode === 'hash' && v.algorithm === 'argon2id' },
    { key: 'scryptN', label: 'scrypt N', type: 'select', choices: ['16384', '32768', '65536', '131072'], default: '131072', showIf: (v) => v.mode === 'hash' && v.algorithm === 'scrypt' },
    { key: 'iterations', label: 'PBKDF2 iterations', type: 'number', default: 600000, min: 1000, max: 10000000, step: 1000, showIf: (v) => v.mode === 'hash' && v.algorithm === 'pbkdf2' },
  ],
  live: false,
  action: 'Run',
  async run(_input, o) {
    if (o.password === '') throw new ToolError('Enter a password.');
    const wasm = await import('hash-wasm');
    const started = performance.now();
    if (o.mode === 'verify') {
      const stored = o.hash.trim();
      let ok: boolean;
      if (/^\$2[aby]?\$/.test(stored)) ok = await wasm.bcryptVerify({ password: o.password, hash: stored });
      else if (stored.startsWith('$argon2')) ok = await wasm.argon2Verify({ password: o.password, hash: stored });
      else if (stored.startsWith('$scrypt$') || stored.startsWith('$pbkdf2-sha256$')) {
        const [, kind, params, saltB64, hashB64] = stored.split('$');
        const salt = Uint8Array.from(atob(saltB64 ?? ''), (char) => char.charCodeAt(0));
        const expected = hashB64 ?? '';
        const values = Object.fromEntries((params ?? '').split(',').map((pair) => pair.split('=')));
        const derived =
          kind === 'scrypt'
            ? await wasm.scrypt({
                password: o.password,
                salt,
                costFactor: Number(values.ln ? 2 ** Number(values.ln) : values.N),
                blockSize: Number(values.r ?? 8),
                parallelism: Number(values.p ?? 1),
                hashLength: 32,
                outputType: 'binary',
              })
            : await wasm.pbkdf2({ password: o.password, salt, iterations: Number(values.i), hashLength: 32, hashFunction: wasm.createSHA256(), outputType: 'binary' });
        ok = toBase64(derived).replace(/=+$/, '') === expected.replace(/=+$/, '');
      } else throw new ToolError('Paste a bcrypt ($2b$…), Argon2 ($argon2id$…), $scrypt$ or $pbkdf2-sha256$ hash.');
      return {
        fields: [
          { label: 'Result', value: ok ? 'The password matches' : 'The password does NOT match', tone: ok ? 'ok' : 'bad' },
          { label: 'Time', value: `${Math.round(performance.now() - started)} ms` },
        ],
      };
    }
    const salt = randomBytes(16);
    let hash: string;
    const fields: Field[] = [];
    switch (o.algorithm) {
      case 'bcrypt':
        if (utf8Encode(o.password).length > 72) fields.push({ label: 'Note', value: 'bcrypt only uses the first 72 bytes of a password.', tone: 'warn' });
        hash = await wasm.bcrypt({ password: o.password, salt, costFactor: o.cost, outputType: 'encoded' });
        break;
      case 'scrypt': {
        const n = Number(o.scryptN);
        const derived = await wasm.scrypt({ password: o.password, salt, costFactor: n, blockSize: 8, parallelism: 1, hashLength: 32, outputType: 'binary' });
        hash = `$scrypt$ln=${Math.log2(n)},r=8,p=1$${toBase64(salt).replace(/=+$/, '')}$${toBase64(derived).replace(/=+$/, '')}`;
        break;
      }
      case 'pbkdf2': {
        const derived = await wasm.pbkdf2({ password: o.password, salt, iterations: o.iterations, hashLength: 32, hashFunction: wasm.createSHA256(), outputType: 'binary' });
        hash = `$pbkdf2-sha256$i=${o.iterations}$${toBase64(salt).replace(/=+$/, '')}$${toBase64(derived).replace(/=+$/, '')}`;
        fields.push({ label: 'Derived key (hex)', value: toHex(derived), mono: true });
        break;
      }
      default:
        hash = await wasm.argon2id({ password: o.password, salt, parallelism: 1, iterations: o.passes, memorySize: o.memory, hashLength: 32, outputType: 'encoded' });
    }
    fields.unshift({ label: 'Time to compute', value: `${Math.round(performance.now() - started)} ms`, tone: 'muted' });
    return { output: hash, fields, info: 'A new random salt is used every time, so the hash changes on each run; Verify checks a password against any of them.' };
  },
});
