import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aesDecrypt, aesEncrypt } from '../../src/lib/aes';
import { fromBase64, toBase64, utf8Decode, utf8Encode } from '../../src/lib/bytes';
import { apr1, bcryptEntry, hashKind, shaEntry, verifyPassword } from '../../src/lib/htpasswd';
import aes from '../../src/tools/text/aes';
import hash, { crc32 } from '../../src/tools/text/hash';
import htpasswd from '../../src/tools/text/htpasswd';
import { bytesOf, field, fileOf, out, run } from './helpers';

const hasOpenSsl = spawnSync('openssl', ['version']).status === 0;

describe('Hash and HMAC', () => {
  const fox = 'The quick brown fox jumps over the lazy dog';

  it.each([
    ['md5', '', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['md5', fox, '9e107d9d372bb6826bd81d3542a419d6'],
    ['sha1', '', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['sha1', fox, '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12'],
    ['sha256', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['sha256', fox, 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
    ['sha512', fox, '07e547d9586f6a73f73fbac0435ed76951218fb7d0c8d788a309d785436bbb642e93a252a954f23912547d1e8a3b5ed6e1bfd7097821233fa0538f3db854fee6'],
    ['sha3-256', '', 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a'],
    ['crc32', fox, '414fa339'],
    ['crc32', '', '00000000'],
  ])('%s(%j) matches the published test vector', async (algorithm, input, expected) => {
    expect(await out(hash, input, { algorithm })).toBe(expected);
  });

  it('agrees with Node for every algorithm on arbitrary bytes', async () => {
    const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 31 + 7) % 256);
    const file = fileOf('blob.bin', bytes);
    for (const [algorithm, nodeName] of [
      ['md5', 'md5'],
      ['sha1', 'sha1'],
      ['sha224', 'sha224'],
      ['sha256', 'sha256'],
      ['sha384', 'sha384'],
      ['sha512', 'sha512'],
      ['sha3-256', 'sha3-256'],
      ['sha3-512', 'sha3-512'],
    ] as const) {
      expect(await out(hash, '', { algorithm }, { file })).toBe(createHash(nodeName).update(bytes).digest('hex'));
      expect(await out(hash, '', { algorithm, key: 's3crét' }, { file })).toBe(createHmac(nodeName, 's3crét').update(bytes).digest('hex'));
    }
    expect(crc32(utf8Encode('123456789'))).toBe(0xcbf43926);
  });

  it('supports output encodings and key encodings', async () => {
    expect(await out(hash, 'abc', { encoding: 'HEX' })).toBe('BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD');
    expect(await out(hash, 'abc', { encoding: 'base64' })).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    // RFC 4231 test case 1
    const rfc = await out(hash, 'Hi There', { key: '0b'.repeat(20), keyEncoding: 'hex' });
    expect(rfc).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    expect(await out(hash, 'Hi There', { key: toBase64(new Uint8Array(20).fill(0x0b)), keyEncoding: 'base64' })).toBe(rfc);
    await expect(run(hash, 'x', { key: 'zz', keyEncoding: 'hex' })).rejects.toThrow(/HMAC key/);
    await expect(run(hash, 'x', { key: 'k', algorithm: 'crc32' })).rejects.toThrow(/cannot be used for HMAC/);
  });

  it('lists every digest and verifies checksums', async () => {
    const all = await run(hash, 'abc', { algorithm: 'all' });
    expect(all.output?.split('\n')).toHaveLength(9);
    expect(all.output).toContain('MD5       900150983cd24fb0d6963f7d28e17f72');
    expect(all.output).toContain('CRC-32    352441c2');
    expect(field(await run(hash, 'abc', { expected: ' BA7816BF 8F01CFEA 414140DE 5DAE2223 B00361A3 96177A9C B410FF61 F20015AD ' }), 'Comparison')).toMatch(/^Match/);
    expect(field(await run(hash, 'abc', { expected: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }), 'Comparison')).toMatch(/^Match/);
    expect(field(await run(hash, 'abd', { expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }), 'Comparison')).toMatch(/^MISMATCH/);
    expect(field(await run(hash, 'abc', { algorithm: 'all', expected: '900150983cd24fb0d6963f7d28e17f72' }), 'Comparison')).toMatch(/^Match/);
    expect((await run(hash, 'abc', { algorithm: 'md5' })).warnings?.[0]).toMatch(/broken for security/);
    expect((await run(hash, 'abc', { algorithm: 'md5', key: 'k' })).warnings).toBeUndefined();
    expect((await run(hash, '', {}, { file: fileOf('a.bin', bytesOf('abc')) })).info).toBe('Digest of a.bin (3 B)');
  });
});

describe('AES', () => {
  const secret = 'correct horse battery staple';

  it('round-trips text and binary data in the GCM format', async () => {
    const text = 'Attack at dawn — 🚀';
    const sealed = await aesEncrypt(utf8Encode(text), secret, 'gcm', 1000);
    expect(utf8Decode(await aesDecrypt(sealed, secret, 'gcm', 1))).toBe(text);
    const blob = fromBase64(sealed);
    expect(utf8Decode(blob.subarray(0, 4))).toBe('BTA1');
    expect(new DataView(blob.buffer, blob.byteOffset + 4, 4).getUint32(0)).toBe(1000);
    expect(blob.length).toBe(4 + 4 + 16 + 12 + utf8Encode(text).length + 16);
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
    expect(Array.from(await aesDecrypt(await aesEncrypt(bytes, secret, 'gcm', 10), secret, 'gcm', 1))).toEqual(Array.from(bytes));
    expect(await aesEncrypt(utf8Encode(text), secret, 'gcm', 1000)).not.toBe(sealed);
  });

  it('detects wrong passwords, tampering and mixed-up formats', async () => {
    const sealed = await aesEncrypt(utf8Encode('hello'), secret, 'gcm', 100);
    await expect(aesDecrypt(sealed, 'wrong', 'gcm', 1)).rejects.toThrow(/password is wrong or the data has been altered/);
    const tampered = fromBase64(sealed);
    tampered[tampered.length - 20] = (tampered[tampered.length - 20] as number) ^ 1;
    await expect(aesDecrypt(toBase64(tampered), secret, 'gcm', 1)).rejects.toThrow(/altered/);
    await expect(aesDecrypt(sealed, secret, 'openssl', 100)).rejects.toThrow(/Switch the format/);
    const cbc = await aesEncrypt(utf8Encode('hello'), secret, 'openssl', 100);
    await expect(aesDecrypt(cbc, secret, 'gcm', 1)).rejects.toThrow(/OpenSSL output/);
    await expect(aesDecrypt('not base64!', secret, 'gcm', 1)).rejects.toThrow(/not valid Base64/);
    await expect(aesDecrypt('aGVsbG8=', secret, 'gcm', 1)).rejects.toThrow(/not data encrypted with/);
    await expect(aesEncrypt(utf8Encode('x'), '', 'gcm', 100)).rejects.toThrow(/Enter a password/);
    await expect(aesEncrypt(utf8Encode('x'), 'p', 'gcm', 0)).rejects.toThrow(/Iterations/);
  });

  it('round-trips the OpenSSL-compatible format', async () => {
    const sealed = await aesEncrypt(utf8Encode('hello openssl'), secret, 'openssl', 1234);
    expect(utf8Decode(fromBase64(sealed).subarray(0, 8))).toBe('Salted__');
    expect(sealed.split('\n').every((line) => line.length <= 64)).toBe(true);
    expect(utf8Decode(await aesDecrypt(sealed, secret, 'openssl', 1234))).toBe('hello openssl');
    await expect(aesDecrypt(sealed, secret, 'openssl', 1235)).rejects.toThrow(/Decryption failed|iteration/);
  });

  it.runIf(hasOpenSsl)('interoperates with the openssl command line in both directions', async () => {
    const plain = 'Interop check: éè ✓\n'.repeat(20);
    const base = ['enc', '-aes-256-cbc', '-pbkdf2', '-md', 'sha256', '-iter', '4321', '-salt', '-a', '-pass', `pass:${secret}`];
    const fromOpenSsl = execFileSync('openssl', base, { input: plain }).toString();
    expect(utf8Decode(await aesDecrypt(fromOpenSsl, secret, 'openssl', 4321))).toBe(plain);
    const ours = await aesEncrypt(utf8Encode(plain), secret, 'openssl', 4321);
    expect(execFileSync('openssl', [...base, '-d'], { input: `${ours}\n` }).toString()).toBe(plain);
  });

  it('works end to end through the tool', async () => {
    const encrypted = await run(aes, 'top secret', { password: secret, iterations: 500 });
    expect(encrypted.info).toMatch(/AES-256-GCM/);
    expect(await out(aes, encrypted.output ?? '', { mode: 'decode', password: secret })).toBe('top secret');
    const openssl = await run(aes, 'top secret', { password: secret, iterations: 500, format: 'openssl' });
    expect(field(openssl, 'Decrypt with OpenSSL')).toBe('openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 -iter 500 -salt -a');
    expect(openssl.warnings?.[0]).toMatch(/does not detect tampering/);
    const binary = await run(aes, '', { password: secret, iterations: 500 }, { file: fileOf('x.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9])) });
    const restored = await run(aes, binary.output ?? '', { mode: 'decode', password: secret });
    expect(restored.binary?.mime).toBe('image/png');
    expect(Array.from(restored.binary?.bytes ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
  });
});

describe('htpasswd', () => {
  it('computes APR1-MD5 exactly like Apache', () => {
    // Reference values produced by `openssl passwd -apr1 -salt <salt> <password>` and Apache `htpasswd -nbm`;
    // the second is the example from the Apache httpd documentation.
    expect(apr1('password', 'saltsalt')).toBe('$apr1$saltsalt$yAAkm4libquA.ZWLHbSBq/');
    expect(apr1('myPassword', 'r31.....')).toBe('$apr1$r31.....$HqJZimcKQFAMYayBlzkrA/');
    expect(apr1('password', '0zo05act')).toBe('$apr1$0zo05act$4OTi9KtwPqUI4ghStu45J/');
    expect(apr1('', 'abc')).toMatch(/^\$apr1\$abc\$[./A-Za-z0-9]{22}$/);
  });

  it.runIf(hasOpenSsl)('matches openssl passwd for assorted passwords and salts', () => {
    const cases: [string, string][] = [
      ['password', 'saltsalt'],
      ['', 'x'],
      ['a', 'ab'],
      ['pässwörd ✓', 'Zz09./aA'],
      ['x'.repeat(16), 'sixteen.'],
      ['y'.repeat(17), 'salt'],
      ['a much longer passphrase with spaces, that exceeds thirty-two bytes', 'q1w2e3r4'],
    ];
    for (const [password, salt] of cases) {
      const reference = execFileSync('openssl', ['passwd', '-apr1', '-salt', salt, '-stdin'], { input: `${password}\n` })
        .toString()
        .trim();
      expect(apr1(password, salt)).toBe(reference);
    }
  });

  it('creates and verifies bcrypt and {SHA} entries', () => {
    const entry = bcryptEntry('hunter2', 4);
    expect(entry).toMatch(/^\$2y\$04\$[./A-Za-z0-9]{53}$/);
    expect(hashKind(entry)).toBe('bcrypt');
    expect(verifyPassword('hunter2', entry)).toBe(true);
    expect(verifyPassword('hunter3', entry)).toBe(false);
    // Hashes generated by Apache 2.4 `htpasswd -nbB`.
    expect(verifyPassword('hunter2', '$2y$05$mCioFlaQpAIhkVpoqFLC7.xf31W1A2i2RA/bvQr0foxM7BM.CGYW.')).toBe(true);
    expect(verifyPassword('password', '$2y$10$m6BG7CVh5SqXmFZmEiCyWerUrujHv8B3spWlC5vIEyw3uCPPXDFla')).toBe(true);
    expect(verifyPassword('Password', '$2y$10$m6BG7CVh5SqXmFZmEiCyWerUrujHv8B3spWlC5vIEyw3uCPPXDFla')).toBe(false);
    expect(shaEntry('password')).toBe('{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=');
    expect(verifyPassword('password', '{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=')).toBe(true);
    expect(verifyPassword('password', '$apr1$0zo05act$4OTi9KtwPqUI4ghStu45J/')).toBe(true);
    expect(verifyPassword('Password', '$apr1$0zo05act$4OTi9KtwPqUI4ghStu45J/')).toBe(false);
    expect(verifyPassword('password', '$6$rounds=5000$salt$abc')).toBeNull();
  });

  it.runIf(spawnSync('htpasswd', ['-nbB', 'u', 'p']).status === 0)('produces hashes that Apache htpasswd itself accepts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'benchtop-htpasswd-'));
    try {
      for (const algorithm of ['bcrypt', 'apr1', 'sha1']) {
        const file = join(directory, `${algorithm}.htpasswd`);
        writeFileSync(file, `${await out(htpasswd, '', { username: 'alice', password: 's3cret! \u00fc', algorithm, cost: 5 })}\n`);
        expect(spawnSync('htpasswd', ['-vb', file, 'alice', 's3cret! \u00fc']).status).toBe(0);
        expect(spawnSync('htpasswd', ['-vb', file, 'alice', 'wrong']).status).not.toBe(0);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('builds complete lines and validates input', async () => {
    const result = await run(htpasswd, '', { username: 'alice', password: 's3cret', cost: 4 });
    expect(result.output).toMatch(/^alice:\$2y\$04\$/);
    expect(result.filename).toBe('.htpasswd');
    expect(await out(htpasswd, '', { username: 'bob', password: 'x', algorithm: 'apr1' })).toMatch(/^bob:\$apr1\$[./A-Za-z0-9]{8}\$[./A-Za-z0-9]{22}$/);
    const sha = await run(htpasswd, '', { username: 'bob', password: 'password', algorithm: 'sha1' });
    expect(sha.output).toBe('bob:{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=');
    expect(sha.warnings?.[0]).toMatch(/unsalted/);
    expect((await run(htpasswd, '', { username: 'a', password: 'x'.repeat(80), cost: 4 })).warnings?.[0]).toMatch(/72 bytes/);
    const verified = await run(htpasswd, '', { username: 'a', password: 'password', cost: 4, verify: 'old:$apr1$0zo05act$4OTi9KtwPqUI4ghStu45J/' });
    expect(field(verified, 'Existing entry')).toBe('The password matches this apr1 hash');
    expect(field(await run(htpasswd, '', { username: 'a', password: 'nope', cost: 4, verify: '{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=' }), 'Existing entry')).toMatch(/does NOT match/);
    expect(field(await run(htpasswd, '', { username: 'a', password: 'x', cost: 4, verify: 'u:plaintext' }), 'Existing entry')).toMatch(/Unrecognised/);
    await expect(run(htpasswd, '', { username: 'a:b', password: 'x' })).rejects.toThrow(/colon/);
    await expect(run(htpasswd, '', { username: ' ', password: 'x' })).rejects.toThrow(/Enter a username/);
    await expect(run(htpasswd, '', { username: 'a b', password: 'x' })).rejects.toThrow(/spaces/);
    await expect(run(htpasswd, '', { username: 'a', password: '' })).rejects.toThrow(/Enter a password/);
  });
});
