import { describe, expect, it } from 'vitest';
import { fromBase64, fromHex, toBase64, toHex } from '../../src/lib/bytes';
import { signJwt } from '../../src/lib/jwt';
import asciiText from '../../src/tools/text/ascii-text';
import base32 from '../../src/tools/text/base32';
import base58 from '../../src/tools/text/base58';
import base62 from '../../src/tools/text/base62';
import base64 from '../../src/tools/text/base64';
import binaryText from '../../src/tools/text/binary-text';
import hexText from '../../src/tools/text/hex-text';
import htmlEntities from '../../src/tools/text/html-entities';
import imageToBase64 from '../../src/tools/text/image-to-base64';
import jwtDecoder from '../../src/tools/text/jwt-decoder';
import jwtEncoder from '../../src/tools/text/jwt-encoder';
import morse from '../../src/tools/text/morse-code';
import rot13 from '../../src/tools/text/rot13';
import urlEncode from '../../src/tools/text/url-encode';
import utf8Bytes from '../../src/tools/text/utf8-bytes';
import { bytesOf, field, fileOf, out, run } from './helpers';

// RFC 4648 section 10 test vectors
const RFC4648: [string, string, string, string][] = [
  ['', '', '', ''],
  ['f', 'Zg==', 'MY======', 'CO======'],
  ['fo', 'Zm8=', 'MZXQ====', 'CPNG===='],
  ['foo', 'Zm9v', 'MZXW6===', 'CPNMU==='],
  ['foob', 'Zm9vYg==', 'MZXW6YQ=', 'CPNMUOG='],
  ['fooba', 'Zm9vYmE=', 'MZXW6YTB', 'CPNMUOJ1'],
  ['foobar', 'Zm9vYmFy', 'MZXW6YTBOI======', 'CPNMUOJ1E8======'],
];

describe('Base64', () => {
  it.each(RFC4648)('RFC 4648 vector %j', async (plain, b64) => {
    expect(await out(base64, plain)).toBe(b64);
    expect(await out(base64, b64, { mode: 'decode' })).toBe(plain);
  });

  it('handles Unicode, URL-safe alphabet and padding options', async () => {
    expect(await out(base64, '✓ café')).toBe('4pyTIGNhZsOp');
    expect(await out(base64, 'ÿþ?>', { variant: 'url' })).toBe('w7_Dvj8-');
    expect(await out(base64, 'f', { padding: false })).toBe('Zg');
    expect(await out(base64, 'Zg', { mode: 'decode' })).toBe('f');
    expect(await out(base64, 'w7_Dvj8-', { mode: 'decode' })).toBe('ÿþ?>');
  });

  it('wraps lines and builds data URIs', async () => {
    const wrapped = await out(base64, 'x'.repeat(100), { wrap: '76' });
    expect(wrapped.split('\n').map((line) => line.length)).toEqual([76, 60]);
    expect(await out(base64, 'hi', { dataUri: true })).toBe('data:text/plain;charset=utf-8;base64,aGk=');
    const file = fileOf('a.png', Uint8Array.from([0x89, 0x50]), 'image/png');
    expect(await out(base64, '', { dataUri: true }, { file })).toBe('data:image/png;base64,iVA=');
  });

  it('decodes data URIs and tolerates whitespace', async () => {
    expect(await out(base64, 'data:text/plain;base64,aGk=', { mode: 'decode' })).toBe('hi');
    expect(await out(base64, 'data:text/plain,hello%20there', { mode: 'decode' })).toBe('hello there');
    expect(await out(base64, ' aG\nk= \n', { mode: 'decode' })).toBe('hi');
  });

  it('returns binary payloads instead of mangling them', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const result = await run(base64, toBase64(png), { mode: 'decode' });
    expect(result.binary?.mime).toBe('image/png');
    expect(result.binary?.name).toBe('decoded.png');
    expect(Array.from(result.binary?.bytes ?? [])).toEqual(Array.from(png));
    expect(result.preview?.kind).toBe('image');
    expect(result.output).toContain('89 50 4e 47');
  });

  it('rejects malformed input with a precise message', async () => {
    await expect(run(base64, 'aGk$', { mode: 'decode' })).rejects.toThrow(/unexpected character "\$" at position 4/);
    await expect(run(base64, 'aGk=x', { mode: 'decode' })).rejects.toThrow(/unexpected character "="/);
    await expect(run(base64, 'aGkxx', { mode: 'decode' })).rejects.toThrow(/length is not possible/);
  });

  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(fromBase64(toBase64(all)))).toEqual(Array.from(all));
    expect(Array.from(fromBase64(toBase64(all, { urlSafe: true, pad: false })))).toEqual(Array.from(all));
  });
});

describe('Base32', () => {
  it.each(RFC4648)('RFC 4648 vector %j', async (plain, _b64, b32, b32hex) => {
    expect(await out(base32, plain)).toBe(b32);
    expect(await out(base32, b32, { mode: 'decode' })).toBe(plain);
    expect(await out(base32, plain, { variant: 'hex' })).toBe(b32hex);
    expect(await out(base32, b32hex, { mode: 'decode', variant: 'hex' })).toBe(plain);
  });

  it('accepts lowercase and unpadded input', async () => {
    expect(await out(base32, 'mzxw6ytboi', { mode: 'decode' })).toBe('foobar');
    expect(await out(base32, 'foobar', { padding: false, lowercase: true })).toBe('mzxw6ytboi');
  });

  it('rejects invalid characters and impossible lengths', async () => {
    await expect(run(base32, 'MZXW1', { mode: 'decode' })).rejects.toThrow(/unexpected character "1"/);
    await expect(run(base32, 'M', { mode: 'decode' })).rejects.toThrow(/length is not possible/);
  });
});

describe('Base58 / Base62', () => {
  it('matches the Bitcoin reference vectors', async () => {
    expect(await out(base58, 'Hello World!')).toBe('2NEpo7TZRRrLZSi2U');
    expect(await out(base58, '2NEpo7TZRRrLZSi2U', { mode: 'decode' })).toBe('Hello World!');
    expect(await out(base58, '0000287fb4cd', { data: 'hex' })).toBe('11233QC4');
    expect(await out(base58, '11233QC4', { mode: 'decode', data: 'hex' })).toBe('0000287fb4cd');
    expect(await out(base58, 'The quick brown fox jumps over the lazy dog.')).toBe('USm3fpXnKG5EUBx2ndxBDMPVciP5hGey2Jh4NDv6gmeo1LkMeiKrLJUUBk6Z');
  });

  it('rejects characters outside the alphabet', async () => {
    await expect(run(base58, '0OIl', { mode: 'decode' })).rejects.toThrow(/Invalid Base58/);
  });

  it('agrees with big-integer arithmetic for Base62', async () => {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const reference = (bytes: Uint8Array): string => {
      let zeros = 0;
      while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
      let value = 0n;
      for (const byte of bytes) value = value * 256n + BigInt(byte);
      let text = '';
      while (value > 0n) {
        text = alphabet[Number(value % 62n)] + text;
        value /= 62n;
      }
      return '0'.repeat(zeros) + text;
    };
    for (const sample of ['Hello World!', 'a', 'caf\u00e9 \u2713', 'The quick brown fox jumps over the lazy dog']) {
      const encoded = await out(base62, sample);
      expect(encoded).toBe(reference(bytesOf(sample)));
      expect(await out(base62, encoded, { mode: 'decode' })).toBe(sample);
    }
    // 0xff = 4 * 62 + 7; leading zero bytes survive as leading "0" characters.
    expect(await out(base62, 'ff', { data: 'hex' })).toBe('47');
    expect(await out(base62, '0000ff', { data: 'hex' })).toBe('0047');
    expect(await out(base62, '0047', { mode: 'decode', data: 'hex' })).toBe('0000ff');
    // 0x3d = 61 is the last digit: "z" in one alphabet and "Z" in the other.
    expect(await out(base62, '3d', { data: 'hex' })).toBe('z');
    expect(await out(base62, '3d', { data: 'hex', alphabet: 'lower' })).toBe('Z');
    expect(await out(base62, 'Z', { mode: 'decode', data: 'hex', alphabet: 'lower' })).toBe('3d');
  });
});

describe('Hex', () => {
  it('encodes in every notation', async () => {
    expect(await out(hexText, 'Hi!')).toBe('48 69 21');
    expect(await out(hexText, 'Hi!', { style: 'none', upper: true })).toBe('486921');
    expect(await out(hexText, 'ÿ', { style: 'colon', upper: true })).toBe('C3:BF');
    expect(await out(hexText, 'Hi', { style: 'comma' })).toBe('0x48, 0x69');
    expect(await out(hexText, 'Hi', { style: 'escape' })).toBe('\\x48\\x69');
    expect(await out(hexText, 'Hi', { style: 'percent' })).toBe('%48%69');
  });

  it('decodes common delimiters automatically', async () => {
    for (const input of ['486921', '48 69 21', '48:69:21', '0x48, 0x69, 0x21', '\\x48\\x69\\x21', '%48%69%21', '48-69-21', '48\n69\n21']) {
      expect(await out(hexText, input, { mode: 'decode' })).toBe('Hi!');
    }
    expect(await out(hexText, 'a b c', { mode: 'decode' })).toBe('\n\u000b\f');
  });

  it('reports bad digits and odd lengths', async () => {
    await expect(run(hexText, '48 6g', { mode: 'decode' })).rejects.toThrow(/"g" is not a hexadecimal digit/);
    await expect(run(hexText, '486', { mode: 'decode' })).rejects.toThrow(/odd number of digits/);
    expect(toHex(fromHex('00ff7f80'))).toBe('00ff7f80');
  });
});

describe('URL encoding', () => {
  it('encodes values, whole URLs and form data differently', async () => {
    const text = 'a b&c=d/e?f#g+h';
    expect(await out(urlEncode, text)).toBe('a%20b%26c%3Dd%2Fe%3Ff%23g%2Bh');
    expect(await out(urlEncode, text, { scope: 'uri' })).toBe('a%20b&c=d/e?f#g+h');
    expect(await out(urlEncode, text, { scope: 'form' })).toBe('a+b%26c%3Dd%2Fe%3Ff%23g%2Bh');
    expect(await out(urlEncode, "it's (ok)!*")).toBe('it%27s%20%28ok%29%21%2A');
    expect(await out(urlEncode, 'café ✓')).toBe('caf%C3%A9%20%E2%9C%93');
  });

  it('decodes and explains malformed escapes', async () => {
    expect(await out(urlEncode, 'caf%C3%A9%20%E2%9C%93', { mode: 'decode' })).toBe('café ✓');
    expect(await out(urlEncode, 'a+b%2Bc', { mode: 'decode', scope: 'form' })).toBe('a b+c');
    expect(await out(urlEncode, 'a+b', { mode: 'decode' })).toBe('a+b');
    await expect(run(urlEncode, '100%', { mode: 'decode' })).rejects.toThrow(/Malformed percent-escape at position 4/);
    await expect(run(urlEncode, '%E2%9C', { mode: 'decode' })).rejects.toThrow(/valid UTF-8/);
  });
});

describe('HTML entities', () => {
  it('encodes with the chosen scope and style', async () => {
    const text = '<a href="x">© & —</a>';
    expect(await out(htmlEntities, text)).toBe('&lt;a href=&quot;x&quot;&gt;&copy; &amp; &mdash;&lt;/a&gt;');
    expect(await out(htmlEntities, text, { scope: 'special' })).toBe('&lt;a href=&quot;x&quot;&gt;© &amp; —&lt;/a&gt;');
    expect(await out(htmlEntities, '©<', { style: 'decimal' })).toBe('&#169;&#60;');
    expect(await out(htmlEntities, '©<', { style: 'hex' })).toBe('&#xA9;&#x3C;');
    expect(await out(htmlEntities, 'ab', { scope: 'all', style: 'decimal' })).toBe('&#97;&#98;');
  });

  it('decodes named, decimal and hex references', async () => {
    expect(await out(htmlEntities, '&lt;p&gt;&copy; &#169; &#xA9; &amp;amp; &hellip; &#128640;', { mode: 'decode' })).toBe('<p>© © © &amp; … 🚀');
  });
});

describe('ASCII / binary / UTF-8', () => {
  it('converts text to code points and back', async () => {
    expect(await out(asciiText, 'Hi!')).toBe('72 105 33');
    expect(await out(asciiText, 'Hi!', { base: 'octal', separator: 'comma' })).toBe('110, 151, 41');
    expect(await out(asciiText, 'Hi!', { base: 'hex' })).toBe('48 69 21');
    expect(await out(asciiText, '72, 105 33', { mode: 'decode' })).toBe('Hi!');
    expect(await out(asciiText, '110 151 41', { mode: 'decode', base: 'octal' })).toBe('Hi!');
    expect(await out(asciiText, '0x48 69', { mode: 'decode', base: 'hex' })).toBe('Hi');
    expect((await run(asciiText, 'café')).warnings?.[0]).toMatch(/1 character outside ASCII/);
    await expect(run(asciiText, '72 9x', { mode: 'decode' })).rejects.toThrow(/"9x" is not a valid decimal code/);
    await expect(run(asciiText, '89', { mode: 'decode', base: 'octal' })).rejects.toThrow(/not a valid octal/);
  });

  it('translates binary both ways', async () => {
    expect(await out(binaryText, 'Hi')).toBe('01001000 01101001');
    expect(await out(binaryText, 'Hi', { separator: '' })).toBe('0100100001101001');
    expect(await out(binaryText, '01001000 01101001', { mode: 'decode' })).toBe('Hi');
    expect(await out(binaryText, '0100100001101001', { mode: 'decode' })).toBe('Hi');
    expect(await out(binaryText, '11100010 10011100 10010011', { mode: 'decode' })).toBe('✓');
    expect(await out(binaryText, 'A', { breakdown: true })).toContain('01000001   65  41   A');
    await expect(run(binaryText, '0100100', { mode: 'decode' })).rejects.toThrow(/7 bits/);
    await expect(run(binaryText, '01002000', { mode: 'decode' })).rejects.toThrow(/"2" is not a binary digit/);
  });

  it('shows UTF-8 bytes in each format and decodes them strictly', async () => {
    expect(await out(utf8Bytes, '✓')).toBe('e2 9c 93');
    expect(await out(utf8Bytes, '✓', { format: 'percent' })).toBe('%E2%9C%93');
    expect(await out(utf8Bytes, '✓', { format: 'decimal' })).toBe('226 156 147');
    expect(await out(utf8Bytes, '✓', { format: 'binary' })).toBe('11100010 10011100 10010011');
    expect(await out(utf8Bytes, '%E2%9C%93 ok', { mode: 'decode', format: 'percent' })).toBe('✓ ok');
    expect(await out(utf8Bytes, 'e2 9c 93', { mode: 'decode' })).toBe('✓');
    expect(await out(utf8Bytes, '240 159 154 128', { mode: 'decode', format: 'decimal' })).toBe('🚀');
    const result = await run(utf8Bytes, '🚀');
    expect(result.fields?.[0]?.label).toBe('U+1F680  🚀');
    expect(result.fields?.[0]?.value).toBe('f0 9f 9a 80  (4 bytes)');
    await expect(run(utf8Bytes, 'e2 9c', { mode: 'decode' })).rejects.toThrow(/not valid UTF-8/);
    await expect(run(utf8Bytes, '300', { mode: 'decode', format: 'decimal' })).rejects.toThrow(/not a byte value/);
    await expect(run(utf8Bytes, '%E2%9', { mode: 'decode', format: 'percent' })).rejects.toThrow(/Malformed percent-escape/);
  });
});

describe('Morse and ROT', () => {
  it('translates Morse code in both directions', async () => {
    expect(await out(morse, 'SOS')).toBe('... --- ...');
    expect(await out(morse, 'Hello World')).toBe('.... . .-.. .-.. --- / .-- --- .-. .-.. -..');
    expect(await out(morse, '.... . .-.. .-.. --- / .-- --- .-. .-.. -..', { mode: 'decode' })).toBe('HELLO WORLD');
    expect(await out(morse, '··· ——— ···', { mode: 'decode' })).toBe('SOS');
    expect(await out(morse, 'a@b.c 1+1=2')).toBe('.- .--.-. -... .-.-.- -.-. / .---- .-.-. .---- -...- ..---');
    const unknown = await run(morse, 'a#b');
    expect(unknown.output).toBe('.- ? -...');
    expect(unknown.warnings?.[0]).toContain('#');
    expect((await run(morse, '.- ......... -', { mode: 'decode' })).output).toBe('A\uFFFDT');
  });

  it('applies ROT variants that are their own inverse', async () => {
    expect(await out(rot13, 'Hello, World!')).toBe('Uryyb, Jbeyq!');
    expect(await out(rot13, 'Uryyb, Jbeyq!')).toBe('Hello, World!');
    expect(await out(rot13, 'Call 0123456789', { variant: 'rot5' })).toBe('Call 5678901234');
    expect(await out(rot13, 'Hello 2026', { variant: 'rot18' })).toBe('Uryyb 7571');
    expect(await out(rot13, 'Hello, World!', { variant: 'rot47' })).toBe('w6==@[ (@C=5P');
    expect(await out(rot13, 'w6==@[ (@C=5P', { variant: 'rot47' })).toBe('Hello, World!');
    expect(await out(rot13, 'xyz ABC', { variant: 'caesar', shift: 3 })).toBe('abc DEF');
    expect(await out(rot13, 'abc DEF', { variant: 'caesar', shift: -3 })).toBe('xyz ABC');
    expect(await out(rot13, 'été 🚀')).toBe('égé 🚀');
  });
});

describe('JWT', () => {
  // The canonical example token from jwt.io, signed with "your-256-bit-secret".
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  it('decodes header, payload and time claims', async () => {
    const result = await run(jwtDecoder, token);
    expect(JSON.parse(result.output ?? '')).toEqual({
      header: { alg: 'HS256', typ: 'JWT' },
      payload: { sub: '1234567890', name: 'John Doe', iat: 1516239022 },
    });
    expect(field(result, 'Algorithm')).toBe('HS256');
    expect(field(result, 'Subject')).toBe('1234567890');
    expect(field(result, 'Issued at')).toContain('2018-01-18T01:30:22.000Z');
    expect(field(result, 'Signature')).toMatch(/Not verified/);
  });

  it('verifies HMAC signatures', async () => {
    expect(field(await run(jwtDecoder, token, { secret: 'your-256-bit-secret' }), 'Signature')).toBe('Valid for this secret');
    expect(field(await run(jwtDecoder, token, { secret: 'wrong' }), 'Signature')).toBe('INVALID for this secret');
    expect(field(await run(jwtDecoder, `Bearer ${token}`, { secret: 'your-256-bit-secret' }), 'Signature')).toBe('Valid for this secret');
  });

  it('flags expiry, unsigned tokens and malformed input', async () => {
    const expired = signJwt({ alg: 'HS256', typ: 'JWT' }, { exp: 1000000000 }, bytesOf('k'), 'HS256');
    const expiredResult = await run(jwtDecoder, expired);
    expect(field(expiredResult, 'Expires')).toMatch(/2001-09-09T01:46:40.000Z {2}\(expired .* ago\)/);
    expect(expiredResult.fields?.find((f) => f.label.startsWith('Expires'))?.tone).toBe('bad');
    const future = signJwt({ alg: 'HS256', typ: 'JWT' }, { exp: 4102444800, nbf: 4102444700 }, bytesOf('k'), 'HS256');
    const futureResult = await run(jwtDecoder, future);
    expect(field(futureResult, 'Expires')).toMatch(/valid, expires in/);
    expect(field(futureResult, 'Not before')).toMatch(/not valid yet/);
    const none = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.';
    expect(field(await run(jwtDecoder, none), 'Signature')).toMatch(/Unsigned token/);
    await expect(run(jwtDecoder, 'abc.def')).rejects.toThrow(/three dot-separated parts.*has 2/);
    await expect(run(jwtDecoder, 'a.b.c.d.e')).rejects.toThrow(/encrypted token/);
    await expect(run(jwtDecoder, '!!!.e30.x')).rejects.toThrow(/header is not valid Base64URL/);
    await expect(run(jwtDecoder, 'bm90anNvbg.e30.x')).rejects.toThrow(/header is not valid JSON/);
  });

  it('signs tokens that match the reference implementation', async () => {
    const result = await run(jwtEncoder, '{"sub":"1234567890","name":"John Doe","iat":1516239022}', {
      secret: 'your-256-bit-secret',
    });
    expect(result.output).toBe(token);
    expect(result.warnings?.[0]).toMatch(/19 bytes; RFC 7518 requires at least 32 bytes/);
    expect((await run(jwtEncoder, '{}', { secret: 'x'.repeat(32) })).warnings).toBeUndefined();
    const hs512 = await run(jwtEncoder, '{"a":1}', { secret: 'short', algorithm: 'HS512', extraHeader: '{"kid":"k1"}' });
    expect(hs512.warnings?.[0]).toMatch(/requires at least 64 bytes/);
    const decoded = await run(jwtDecoder, hs512.output ?? '', { secret: 'short' });
    expect(JSON.parse(decoded.output ?? '').header).toEqual({ kid: 'k1', alg: 'HS512', typ: 'JWT' });
    expect(field(decoded, 'Signature')).toBe('Valid for this secret');
  });

  it('adds iat/exp and validates its inputs', async () => {
    const before = Math.floor(Date.now() / 1000);
    const result = await run(jwtEncoder, '{}', { secret: 's', addIat: true, expiresIn: '1h' });
    const payload = JSON.parse((await run(jwtDecoder, result.output ?? '')).output ?? '').payload;
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.exp - payload.iat).toBe(3600);
    await expect(run(jwtEncoder, '{}', {})).rejects.toThrow(/Enter a secret/);
    await expect(run(jwtEncoder, '[1]', { secret: 's' })).rejects.toThrow(/must be a JSON object/);
    await expect(run(jwtEncoder, '{bad', { secret: 's' })).rejects.toThrow(/line 1, column 2/);
    await expect(run(jwtEncoder, '{}', { secret: '***', secretBase64: true })).rejects.toThrow(/secret is not valid Base64/);
  });
});

describe('Image to Base64', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const file = fileOf('my "logo".png', png, 'image/png');

  it('produces every output flavour', async () => {
    const b64 = toBase64(png);
    expect(await out(imageToBase64, '', {}, { file })).toBe(`data:image/png;base64,${b64}`);
    expect(await out(imageToBase64, '', { format: 'raw' }, { file })).toBe(b64);
    expect(await out(imageToBase64, '', { format: 'css' }, { file })).toBe(`background-image: url("data:image/png;base64,${b64}");`);
    expect(await out(imageToBase64, '', { format: 'html' }, { file })).toBe(`<img src="data:image/png;base64,${b64}" alt="my &quot;logo&quot;">`);
    expect(await out(imageToBase64, '', { format: 'markdown' }, { file })).toBe(`![my "logo"](data:image/png;base64,${b64})`);
  });

  it('sniffs the real type and refuses non-images', async () => {
    const mislabelled = fileOf('photo.bin', png, 'application/octet-stream');
    expect(await out(imageToBase64, '', {}, { file: mislabelled })).toMatch(/^data:image\/png;base64,/);
    await expect(run(imageToBase64, '', {}, { file: fileOf('a.txt', bytesOf('hello'), 'text/plain') })).rejects.toThrow(/does not look like an image/);
    await expect(run(imageToBase64, '')).rejects.toThrow(/Open or drop an image/);
  });
});
