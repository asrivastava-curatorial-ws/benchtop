import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalog, findOperation, OPERATIONS } from '../../src/recipe/catalog';
import { type Args, type Dish, defaultArgs, hex, hexToBytes, toBytes, toText } from '../../src/recipe/core';
import { bake, type Step } from '../../src/recipe/engine';
import { parseRecipe, toChefFormat, toCyberChefJson } from '../../src/recipe/format';
import { OPERATION_NAMES } from '../../src/recipe/names';
import { CRC_PRESETS, crcCompute } from '../../src/recipe/ops/hashing';

function step(name: string, args: Args = {}): Step {
  const op = findOperation(name);
  if (!op) throw new Error(`No operation ${name}`);
  return { op: op.id, args: { ...defaultArgs(op), ...args } };
}

async function run(input: Dish, ...steps: Step[]): Promise<Dish> {
  const outcome = await bake(input, steps, catalog);
  if (outcome.error) throw new Error(`step ${outcome.error.step}: ${outcome.error.message}`);
  return outcome.value;
}

/** What the output pane shows: text becomes bytes the CyberChef way, then UTF-8 when valid. */
const text = async (input: Dish, ...steps: Step[]) => toText(toBytes(await run(input, ...steps)));
const hexOut = async (input: Dish, ...steps: Step[]) => hex(toBytes(await run(input, ...steps)));

describe('recipe catalogue', () => {
  it('has unique ids and names, and every operation is in the search index', () => {
    const ids = OPERATIONS.map((op) => op.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(OPERATIONS.map((op) => op.name)).size).toBe(OPERATIONS.length);
    expect(OPERATION_NAMES.map(([id, name]) => `${id}:${name}`).sort()).toEqual(OPERATIONS.map((op) => `${op.id}:${op.name}`).sort());
    expect(OPERATIONS.length).toBeGreaterThan(300);
  });

  it('gives every argument a key unique within its operation', () => {
    for (const op of OPERATIONS) {
      const keys = op.args.map((a) => a.key);
      expect(new Set(keys).size, op.name).toBe(keys.length);
    }
  });
});

describe('data format', () => {
  it('encodes and decodes Base-N', async () => {
    expect(await text('SGVsbG8gV29ybGQ=', step('From Base64'))).toBe('Hello World');
    expect(await text('Hello', step('To Base64'))).toBe('SGVsbG8=');
    expect(await text('Hello', step('To Base64', { alphabet: 'A-Za-z0-9\\-_' }))).toBe('SGVsbG8');
    expect(await text('Hello', step('To Base32'))).toBe('JBSWY3DP');
    expect(await text('JBSWY3DP', step('From Base32'))).toBe('Hello');
    expect(await text('Hello World', step('To Base58'))).toBe('JxF12TrwUP45BMd');
    expect(await text('JxF12TrwUP45BMd', step('From Base58'))).toBe('Hello World');
    expect(await text('Hello', step('To Base85'))).toBe('87cURDZ');
    expect(await text('87cURDZ', step('From Base85'))).toBe('Hello');
    expect(await text('AB', step('To Base45'))).toBe('BB8');
    expect(await text('Hello!!', step('To Base45'))).toBe('%69 VD92EX0');
    expect(await text('%69 VD92EX0', step('From Base45'))).toBe('Hello!!');
    for (const name of ['Base62', 'Base92']) expect(await text('Benchtop 3 ✓', step(`To ${name}`), step(`From ${name}`))).toBe('Benchtop 3 ✓');
  });

  it('handles hex, binary, decimals and dumps', async () => {
    expect(await text('Hello', step('To Hex'))).toBe('48 65 6c 6c 6f');
    expect(await text('Hello', step('To Hex', { delimiter: '0x with comma' }))).toBe('0x48,0x65,0x6c,0x6c,0x6f');
    expect(await text('48656c6c6f', step('From Hex'))).toBe('Hello');
    expect(await text('\\x48\\x65', step('From Hex'))).toBe('He');
    expect(await text('A', step('To Binary'))).toBe('01000001');
    expect(await text('01000001 01000010', step('From Binary'))).toBe('AB');
    expect(await text('AB', step('To Charcode'))).toBe('41 42');
    expect(await text('Hi', step('To Decimal'))).toBe('72 105');
    expect(await text('72,105', step('From Decimal'))).toBe('Hi');
    expect(await text('Hi', step('To Octal'))).toBe('110 151');
    const dump = await text('Hello, hex dump!', step('To Hexdump'));
    expect(dump.startsWith('00000000  48 65 6c 6c 6f')).toBe(true);
    expect(await text(dump, step('From Hexdump'))).toBe('Hello, hex dump!');
    expect(await text('1234', step('To BCD'))).toBe('0001 0010 0011 0100');
    expect(await text('0001 0010 0011 0100', step('From BCD'))).toBe('1234');
    expect(await text('255', step('To Base', { radix: 16 }))).toBe('ff');
    expect(await text('ff', step('From Base', { radix: 16 }))).toBe('255');
  });

  it('handles text encodings, entities and Unicode', async () => {
    expect(await text('mañana', step('To Punycode'))).toBe('maana-pta');
    expect(await text('maana-pta', step('From Punycode'))).toBe('mañana');
    expect(await text('mañana.com', step('To Punycode', { idn: true }))).toBe('xn--maana-pta.com');
    expect(await text('a b&c', step('URL Encode', { all: true }))).toBe('a%20b%26c');
    expect(await text('a%20b%26c', step('URL Decode'))).toBe('a b&c');
    expect(await text('<a>', step('To HTML Entity'))).toBe('&lt;a&gt;');
    expect(await text('&lt;&#65;&#x42;', step('From HTML Entity'))).toBe('<AB');
    expect(await text('é', step('Escape Unicode Characters'))).toBe('\\u00E9');
    expect(await text('\\u00e9', step('Unescape Unicode Characters'))).toBe('é');
    expect(await text('“quoted” — dash…', step('Escape Smart Characters'))).toBe('"quoted" -- dash...');
    const qp = await text('Café = coffee', step('Encode text', { encoding: 'UTF-8 (65001)' }), step('To Quoted Printable'));
    expect(qp).toBe('Caf=C3=A9 =3D coffee');
    expect(await text(qp, step('From Quoted Printable'))).toBe('Café = coffee');
    expect(await hexOut('€', step('Encode text', { encoding: 'Windows-1252 Latin 1 (1252)' }))).toBe('80');
    expect(await hexOut('あ', step('Encode text', { encoding: 'Shift-JIS Japanese (932)' }))).toBe('82a0');
    expect(await text(hexToBytes('82a0'), step('Decode text', { encoding: 'Shift-JIS Japanese (932)' }))).toBe('あ');
    expect(await hexOut('A', step('Encode text', { encoding: 'IBM EBCDIC US-Canada (37)' }))).toBe('c1');
    expect(await text('=?UTF-8?B?Q2Fmw6k=?= au lait', step('MIME Decoding'))).toBe('Café au lait');
    expect(await text('HELLO', step('To Braille'), step('From Braille'))).toBe('HELLO');
    expect(await text('192.168.1.1', step('Change IP format', { to: 'Decimal' }))).toBe('3232235777');
    expect(await text('aGVsbG8', step('To Bech32', { input: 'Raw bytes', hrp: 'test' }), step('From Bech32', { format: 'Raw' }))).toBe('aGVsbG8');
    expect(await text('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', step('From Bech32'))).toBe('751e76e8199196d454941c45d1b3a323f1433bd6');
  });

  it('serialises structured data', async () => {
    const json = '{"a":[1,2,3],"b":"x","c":true,"d":null,"e":1.5}';
    expect(JSON.parse(await text(json, step('CBOR Encode'), step('CBOR Decode')))).toEqual(JSON.parse(json));
    expect(JSON.parse(await text(json, step('To MessagePack'), step('From MessagePack')))).toEqual(JSON.parse(json));
    expect(JSON.parse(await text('a,b\n1,2', step('CSV to JSON')))).toEqual([{ a: '1', b: '2' }]);
    expect(await text('{"a":1}', step('JSON to YAML'))).toBe('a: 1\n');
    expect(JSON.parse(await text(json, step('Rison Encode'), step('Rison Decode')))).toEqual(JSON.parse(json));
    expect(await text('{"a":1,"b":"x y"}', step('Rison Encode'))).toBe("(a:1,b:'x y')");
    expect(await hexOut(hexToBytes('11 22 00 33'), step('To COBS'))).toBe('03112202 33'.replace(' ', ''));
    expect(await hexOut(hexToBytes('11 22 00 33'), step('To COBS'), step('From COBS'))).toBe('11220033');
    expect(await text('300', step('VarInt Encode'), step('To Hex'))).toBe('ac 02');
  });
});

describe('encryption', () => {
  it('matches published AES, DES, Blowfish and RC4 vectors', async () => {
    expect(await text('00112233445566778899aabbccddeeff', step('AES Encrypt', { key: '000102030405060708090a0b0c0d0e0f', mode: 'ECB/NoPadding', input: 'Hex' }))).toBe(
      '69c4e0d86a7b0430d8cdb78070b4c55a',
    );
    expect((await text('0123456789ABCDEF', step('DES Encrypt', { key: '133457799BBCDFF1', mode: 'ECB', input: 'Hex' }))).slice(0, 16)).toBe('85e813540f0ab405');
    expect((await text('0000000000000000', step('Blowfish Encrypt', { key: '0000000000000000', mode: 'ECB', input: 'Hex' }))).slice(0, 16)).toBe('4ef997456198dd78');
    expect(await text('Plaintext', step('RC4', { key: 'Key', inFormat: 'Latin1', outFormat: 'Hex' }))).toBe('bbf316e8d940af0ad3');
  });

  it('round-trips the block and stream ciphers', async () => {
    const key = '000102030405060708090a0b0c0d0e0f';
    const iv = 'f0e0d0c0b0a090807060504030201000';
    for (const mode of ['CBC', 'CFB', 'OFB', 'CTR', 'ECB']) {
      const ct = await text('Benchtop recipe test', step('AES Encrypt', { key, iv, mode }));
      expect(await text(ct, step('AES Decrypt', { key, iv, mode }))).toBe('Benchtop recipe test');
    }
    const gcm = await text('secret', step('AES Encrypt', { key, iv: '000000000000000000000000', mode: 'GCM' }));
    const [ct, tagLine] = gcm.split('\n\nTag: ') as [string, string];
    expect(await text(ct, step('AES Decrypt', { key, iv: '000000000000000000000000', mode: 'GCM', tag: tagLine }))).toBe('secret');
    for (const [name, k, block] of [
      ['Triple DES', '000102030405060708090a0b0c0d0e0f1011121314151617', '0001020304050607'],
      ['Blowfish', '0011223344556677', '0001020304050607'],
      ['TEA', key, '0001020304050607'],
      ['XTEA', key, '0001020304050607'],
    ] as const) {
      for (const mode of ['CBC', 'CTR', 'ECB']) {
        const enc = await text('Round trip ✓', step(`${name} Encrypt`, { key: k, iv: block, mode }));
        expect(await text(enc, step(`${name} Decrypt`, { key: k, iv: block, mode })), `${name} ${mode}`).toBe('Round trip ✓');
      }
    }
    expect(await text('XXTEA works', step('XXTEA Encrypt', { key: 'sixteen byte key' }), step('XXTEA Decrypt', { key: 'sixteen byte key' }))).toMatch(/^XXTEA works\0*$/);
    const nonce = '000000000000004a00000000';
    const chacha = await text('Ladies and Gentlemen', step('ChaCha', { key: `${key}${key}`, nonce, input: 'Raw', output: 'Hex' }));
    expect(await text(chacha, step('ChaCha', { key: `${key}${key}`, nonce, input: 'Hex', output: 'Raw' }))).toBe('Ladies and Gentlemen');
    expect(await text('wrap me', step('CipherSaber2 Encrypt', { key: 'pw' }), step('CipherSaber2 Decrypt', { key: 'pw' }))).toBe('wrap me');
    const fernetKey = 'cw_0x689RpI-jtRR7oE8h_eQsKImvJapLeSbXpwF4e4=';
    expect(await text('fernet', step('Fernet Encrypt', { key: fernetKey }), step('Fernet Decrypt', { key: fernetKey }))).toBe('fernet');
  });

  it('implements the classical ciphers', async () => {
    expect(await text('Hello', step('ROT13'))).toBe('Uryyb');
    expect(await text('Hello', step('ROT47'))).toBe('w6==@');
    expect(await text('ATTACKATDAWN', step('Vigenère Encode', { key: 'LEMON' }))).toBe('LXFOPVEFRNHR');
    expect(await text('LXFOPVEFRNHR', step('Vigenère Decode', { key: 'LEMON' }))).toBe('ATTACKATDAWN');
    expect(await text('AFFINE', step('Affine Cipher Encode', { a: 5, b: 8 }))).toBe('IHHWVC');
    expect(await text('abc', step('Atbash Cipher'))).toBe('zyx');
    expect(await text('abc', step('A1Z26 Cipher Encode'))).toBe('1 2 3');
    expect(await text('1 2 3', step('A1Z26 Cipher Decode'))).toBe('abc');
    expect(await text('WEAREDISCOVEREDFLEEATONCE', step('Rail Fence Cipher Encode', { key: 3 }))).toBe('WECRLTEERDSOEEFEAOCAIVDEN');
    expect(await text('WECRLTEERDSOEEFEAOCAIVDEN', step('Rail Fence Cipher Decode', { key: 3 }))).toBe('WEAREDISCOVEREDFLEEATONCE');
    expect(await text('Flee at once', step('Bifid Cipher Encode', { keyword: 'Playfair' }), step('Bifid Cipher Decode', { keyword: 'Playfair' }))).toBe('Flee at once');
    expect(await text('SOS', step('To Morse Code'))).toBe('... --- ...');
    expect(await text('... --- ...', step('From Morse Code'))).toBe('SOS');
    expect(await text('AB', step('Bacon Cipher Encode', { translation: 'A/B' }))).toBe('AAAAA AAAAB');
    expect(await text('AAAAA AAAAB', step('Bacon Cipher Decode', { translation: 'A/B' }))).toBe('AB');
    expect(await text('HELLO', step('Substitute'))).toBe('EBIIL');
    expect(await text('hi', step('Cetacean Cipher Encode'), step('Cetacean Cipher Decode'))).toBe('hi');
    expect(await text('AAAAA', step('Enigma'))).toBe('BDZGO');
    expect(await text('BDZGO', step('Enigma'))).toBe('AAAAA');
    expect(await text('password1', step('Citrix CTX1 Encode'), step('Citrix CTX1 Decode'))).toBe('password1');
    const xor = await hexOut('Hello', step('XOR', { key: 'ff' }));
    expect(xor).toBe('b79a939390');
    expect(await text(hexToBytes(xor), step('XOR', { key: 'ff' }))).toBe('Hello');
  });

  it('derives keys and signs tokens', async () => {
    expect(await text('', step('Derive PBKDF2 key', { passphrase: 'password', size: 160, iterations: 1, hash: 'SHA1', salt: 'salt', 'salt.format': 'UTF8' }))).toBe(
      '0c60c80f961f0e71f3a9b524af6012062fe037a6',
    );
    expect(await text('', step('Derive EVP key', { passphrase: 'password', size: 128, hash: 'MD5' }))).toBe('5f4dcc3b5aa765d61d8327deb882cf99');
    expect(await text(hexToBytes('0b'.repeat(22)), step('Derive HKDF key', { salt: '000102030405060708090a0b0c', info: 'f0f1f2f3f4f5f6f7f8f9', hash: 'SHA256', length: 42 }))).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
    expect(await text('password', step('Scrypt', { salt: 'NaCl', 'salt.format': 'UTF8', n: 1024, r: 8, p: 16, length: 64 }))).toBe(
      'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
    );
    const token = await text('{"sub":"1"}', step('JWT Sign', { key: 'secret', algorithm: 'HS256' }));
    expect(await text(token, step('JWT Verify', { key: 'secret' }))).toContain('"sub": "1"');
    expect(await text(token, step('JWT Decode'))).toContain('"sub": "1"');
    expect(await text('00112233445566778899aabbccddeeff', step('AES Key Wrap', { kek: '000102030405060708090a0b0c0d0e0f' }))).toBe('1fa68b0a8112b447aef34bd8fb5a7b829d3e862371d2cfe5');
    expect(await text('1fa68b0a8112b447aef34bd8fb5a7b829d3e862371d2cfe5', step('AES Key Unwrap', { kek: '000102030405060708090a0b0c0d0e0f' }))).toBe('00112233445566778899aabbccddeeff');
    const cookie = await text('{"user":"ada"}', step('Flask Session Sign', { key: 'k' }));
    expect(await text(cookie, step('Flask Session Verify', { key: 'k', time: false }))).toContain('"user": "ada"');
    const bcrypt = await text('hunter2', step('Bcrypt', { rounds: 4 }));
    expect(await text('hunter2', step('Bcrypt compare', { hash: bcrypt }))).toBe('Match: hunter2');
    expect(await text(bcrypt, step('Bcrypt parse'))).toContain('Rounds: 4');
  });
});

describe('public key', () => {
  it('signs, verifies, encrypts and decrypts with generated keys', async () => {
    const pair = await text('', step('Generate RSA Key Pair', { bits: '1024' }));
    const [priv, pub] = pair.split(/\n(?=-----BEGIN PUBLIC KEY)/) as [string, string];
    const signature = await run('message', step('RSA Sign', { key: priv }));
    expect(await text(signature, step('RSA Verify', { key: pub, message: 'message' }))).toBe('Verified OK');
    for (const scheme of ['RSA-OAEP', 'RSAES-PKCS1-V1_5']) {
      expect(await text('secret', step('RSA Encrypt', { key: pub, scheme }), step('RSA Decrypt', { key: priv, scheme }))).toBe('secret');
    }
    const ec = await text('', step('Generate ECDSA Key Pair'));
    const [ecPriv, ecPub] = ec.split(/\n(?=-----BEGIN PUBLIC KEY)/) as [string, string];
    const sig = await text('hello', step('ECDSA Sign', { key: ecPriv }));
    expect(await text(sig, step('ECDSA Verify', { key: ecPub, message: 'hello' }))).toBe('Verified OK');
    const jws = await text(sig, step('ECDSA Signature Conversion', { to: 'JSON Web Signature' }));
    expect(await text(jws, step('ECDSA Signature Conversion', { to: 'ASN.1 HEX' }))).toBe(sig);
    expect(await text(ecPriv, step('Public Key from Private Key'))).toContain('BEGIN PUBLIC KEY');
    expect(JSON.parse(await text(ecPub, step('PEM to JWK'))).kty).toBe('EC');
  });

  it('converts object identifiers', async () => {
    expect(await text('1.2.840.113549.1.1.11', step('Object Identifier to Hex'))).toBe('2a864886f70d01010b');
    expect(await text('2a864886f70d01010b', step('Hex to Object Identifier'))).toContain('1.2.840.113549.1.1.11');
  });
});

describe('arithmetic, networking and utilities', () => {
  it('calculates', async () => {
    expect(await text('1\n2\n3', step('Sum'))).toBe('6');
    expect(await text('1\n2\n3\n4', step('Median'))).toBe('2.5');
    expect(await text('0.1\n0.2', step('Sum'))).toBe('0.3');
    expect(await text('', step('Modular Exponentiation', { base: '4', exponent: '13', modulus: '497' }))).toBe('445');
    expect(await text('', step('Modular Inverse', { a: '3', m: '11' }))).toBe('4');
    expect(await text('', step('Extended GCD', { a: '240', b: '46' }))).toContain('GCD = 2');
    expect(await hexOut('A', step('Rotate left'))).toBe('82');
    expect(await text('a,b,c\n\nb,c,d', step('Set Intersection'))).toBe('b,c');
    expect(await text('a,b', step('Power Set'))).toBe('\na\nb\na,b');
  });

  it('parses network data', async () => {
    expect(await text('192.168.0.0/30', step('Parse IP range', { info: false }))).toBe('192.168.0.0\n192.168.0.1\n192.168.0.2\n192.168.0.3');
    expect(await text('https://user:pw@example.com:8080/a/b?x=1#top', step('Parse URI'))).toContain('Port');
    expect(await text('https://evil.example.com/x', step('Defang URL'))).toBe('hxxps[://]evil[.]example[.]com/x');
    expect(await text('hxxps[://]evil[.]example[.]com/x', step('Fang URL'))).toBe('https://evil.example.com/x');
    expect(JSON.parse(await text(hexToBytes('089601'), step('Protobuf Decode')))).toEqual({ 1: 150 });
    expect(await text('ABC', step('Encode NetBIOS Name'), step('Decode NetBIOS Name'))).toMatch(/^ABC {13}$/);
    expect(await text('4500003c1c4640004006b1e6ac100a63ac100a0c', step('Parse IPv4 header'))).toContain('172.16.10.99');
    expect(await text('2001:db8::1', step('Parse IPv6 address'))).toContain('2001:0db8:0000:0000:0000:0000:0000:0001');
  });

  it('transforms text', async () => {
    expect(await text('b\na\nc', step('Sort'))).toBe('a\nb\nc');
    expect(await text('a\nb\na', step('Unique', { count: true }))).toBe('2 a\n1 b');
    expect(await text('foo bar', step('Find / Replace', { find: '(o+)', replace: '[$1]' }))).toBe('f[oo] bar');
    expect(await text('a1b22c333', step('Regular expression', { regex: '\\d+', output: 'List matches' }))).toBe('1\n22\n333');
    expect(await text('kitten\nsitting', step('Levenshtein Distance'))).toBe('3');
    expect(await text('karolin\n\nkathrin', step('Hamming Distance'))).toBe('3');
    expect(await text('1000', step('Convert distance'))).toBe('1');
    expect(await text('rwxr-xr-x', step('Parse UNIX file permissions'))).toContain('0755');
    expect(await text('a\tb"', step('Escape string', { quote: 'Double' }))).toBe('a\\tb\\"');
    expect(await text('a\\tb\\u0041\\x42', step('Unescape string'))).toBe('a\tbAB');
    expect(await text('a-e', step('Expand alphabet range'))).toBe('abcde');
    expect(await text('hello world', step('To Upper case', { scope: 'Word' }))).toBe('Hello World');
    expect(await text('helloWorld test', step('To Snake case'))).toBe('hello_world_test');
    expect(await text('a/b/c\na/d', step('File Tree'))).toBe('└── a\n    ├── b\n    │   └── c\n    └── d');
  });

  it('handles dates and times', async () => {
    expect(await text('0', step('From UNIX Timestamp'))).toBe('Thu 1 January 1970 00:00:00 UTC');
    expect(await text('2020-01-01T00:00:00Z', step('To UNIX Timestamp', { show: false }))).toBe('1577836800');
    expect(await text('01/02/2020 10:00:00', step('Translate DateTime Format', { outFormat: 'YYYY-MM-DD HH:mm', outZone: 'Asia/Kolkata' }))).toBe('2020-02-01 15:30');
    expect(await text('116444736000000000', step('Windows Filetime to UNIX Timestamp'))).toBe('0');
    expect(await text('0', step('UNIX Timestamp to Windows Filetime'))).toBe('116444736000000000');
  });

  it('extracts', async () => {
    expect(await text('ping 10.0.0.1 and 8.8.8.8', step('Extract IP addresses'))).toBe('10.0.0.1\n8.8.8.8');
    expect(await text('mail ada@example.org now', step('Extract email addresses'))).toBe('ada@example.org');
    expect(await text('see https://example.com/a?b=1.', step('Extract URLs'))).toBe('https://example.com/a?b=1');
    expect(await text(Uint8Array.from([0, 1, ...toBytes('hidden text'), 0, 2]), step('Strings'))).toBe('hidden text');
    expect(await text('<a><b>1</b><b>2</b></a>', step('XPath expression', { xpath: '/a/b/text()' }))).toBe('1\n2');
    expect(await text('{"a":{"b":[1,2]}}', step('JPath expression', { query: '$.a.b[*]' }))).toBe('1\n2');
    expect(await text('<p><b class="x">hi</b></p>', step('CSS selector', { selector: 'b.x' }))).toBe('<b class="x">hi</b>');
  });
});

describe('compression', () => {
  it('round-trips every compressor', async () => {
    const input = 'Benchtop '.repeat(50);
    for (const [c, d] of [
      ['Gzip', 'Gunzip'],
      ['Zlib Deflate', 'Zlib Inflate'],
      ['Raw Deflate', 'Raw Inflate'],
      ['LZ4 Compress', 'LZ4 Decompress'],
      ['LZString Compress', 'LZString Decompress'],
    ]) {
      expect(await text(input, step(c as string), step(d as string)), c).toBe(input);
    }
    const zipped = await bake(input, [step('Zip', { filename: 'a.txt' }), step('Unzip')], catalog);
    expect(zipped.preview?.kind).toBe('files');
    expect(toText(zipped.preview?.kind === 'files' ? (zipped.preview.files[0]?.bytes ?? '') : '')).toBe(input);
    const tarred = await bake(input, [step('Tar', { filename: 'b.txt' }), step('Untar')], catalog);
    expect(toText(await run(input, step('Tar'))).length).toBeGreaterThan(1024);
    expect(tarred.preview?.kind === 'files' && tarred.preview.files[0]?.name).toBe('b.txt');
  });

  it('decompresses bzip2 written by the reference implementation', async () => {
    const small = hexToBytes(
      '425a68393141592653599b118ac500000eff800010400060057fe0104004003ffffff0200048cc80f5000d346268c8d321a0c1e88f51a00c8d0d00036a25c48013025eb7a1c3735ab4544c8b9e863a00e33087d1c5ac45642c814af632f9bf0d3bef63398803b1833f10d30a750a8885dfaefc5dc914e142426c462b14',
    );
    expect(await text(small, step('Bzip2 Decompress'))).toBe('Hello, Benchtop! aaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb The quick brown fox jumps over the lazy dog. 1234567890\n');
    const big = new Uint8Array(readFileSync(new URL('../fixtures/recipe/sample.txt.bz2', import.meta.url)));
    const out = toBytes(await run(big, step('Bzip2 Decompress')));
    expect(createHash('sha256').update(out).digest('hex')).toBe('aecf233fe9d30dfb81ec7eb2c3bb80cb9e273f0589420270f116b5fec8c31d4a');
  });

  it('decompresses LZNT1', async () => {
    expect(await text(hexToBytes('05b0 08 616263 0320'), step('LZNT1 Decompress'))).toBe('abcabcabc');
  });
});

describe('hashing', () => {
  it('matches known digests', async () => {
    expect(await text('abc', step('MD5'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(await text('abc', step('MD4'))).toBe('a448017aaf21d8525fc10ae87aa6729d');
    expect(await text('abc', step('SHA0'))).toBe('0164b8a914cd2a5e74c4f7ff082c4d97f1edf880');
    expect(await text('abc', step('SHA1'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(await text('abc', step('SHA2', { size: '256' }))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await text('abc', step('SHA3', { size: '256' }))).toBe('3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532');
    expect(await text('', step('Keccak', { size: '256' }))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(await text('abc', step('RIPEMD'))).toBe('8eb208f7e05d987a9b044a8e98c6b087f15a0bfc');
    expect(await text('abc', step('SM3'))).toBe('66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0');
    expect(await text('abc', step('BLAKE2s', { size: '256' }))).toBe('508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982');
    expect(await text('abc', step('BLAKE3', { size: 32 }))).toBe('6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85');
    expect(await text('The quick brown fox jumps over the lazy dog', step('HMAC', { key: 'key', hash: 'SHA2-256' }))).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    expect(await text('', step('CMAC', { key: '2b7e151628aed2a6abf7158809cf4f3c' }))).toBe('bb1d6929e95937287fa37d129b756746');
    expect(await text('password', step('NT Hash'))).toBe('8846F7EAEE8FB117AD06BDD830B7586C');
    expect(await text('password', step('LM Hash'))).toBe('E52CAC67419A9A224A3B108F3FA6CB6D');
    expect(await text('hello', step('MurmurHash3'))).toBe('613153351');
    expect(await text('Wikipedia', step('Adler-32 Checksum'))).toBe('11e60398');
    expect(await text('abcde', step('Fletcher-16 Checksum'))).toBe('c8f0');
    expect(await text('7992739871', step('Luhn Checksum'))).toContain('Checkdigit: 3');
  });

  it('computes every CRC preset to its published check value', () => {
    const checks: Record<string, bigint> = {
      'CRC-8': 0xf4n,
      'CRC-8/CDMA2000': 0xdan,
      'CRC-8/DVB-S2': 0xbcn,
      'CRC-8/I-CODE': 0x7en,
      'CRC-8/MAXIM-DOW': 0xa1n,
      'CRC-8/ROHC': 0xd0n,
      'CRC-8/WCDMA': 0x25n,
      'CRC-16/ARC': 0xbb3dn,
      'CRC-16/BUYPASS': 0xfee8n,
      'CRC-16/CCITT-FALSE': 0x29b1n,
      'CRC-16/DNP': 0xea82n,
      'CRC-16/GENIBUS': 0xd64en,
      'CRC-16/KERMIT': 0x2189n,
      'CRC-16/MAXIM': 0x44c2n,
      'CRC-16/MODBUS': 0x4b37n,
      'CRC-16/USB': 0xb4c8n,
      'CRC-16/X-25': 0x906en,
      'CRC-16/XMODEM': 0x31c3n,
      'CRC-24/OPENPGP': 0x21cf02n,
      'CRC-32': 0xcbf43926n,
      'CRC-32/BZIP2': 0xfc891918n,
      'CRC-32C': 0xe3069283n,
      'CRC-32/JAMCRC': 0x340bc6d9n,
      'CRC-32/MPEG-2': 0x0376e6e7n,
      'CRC-32/POSIX': 0x765e7680n,
      'CRC-32Q': 0x3010bf7fn,
      'CRC-32/XFER': 0xbd0be338n,
      'CRC-64/ECMA-182': 0x6c40df5f0b497347n,
      'CRC-64/GO-ISO': 0xb90956c775a41001n,
      'CRC-64/WE': 0x62ec59e3f1a4f00an,
      'CRC-64/XZ': 0x995dc9bbdf1939fan,
    };
    const data = toBytes('123456789');
    for (const [name, spec] of Object.entries(CRC_PRESETS)) expect(crcCompute(data, spec), name).toBe(checks[name]);
  });
});

describe('code and other', () => {
  it('tidies code', async () => {
    expect(await text('{"b":1,"a":[1,2]}', step('JSON Beautify', { sort: true, indent: '  ' }))).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": 1\n}');
    expect(await text('{ "a" : 1 }', step('JSON Minify'))).toBe('{"a":1}');
    expect(await text('{"a":1}', step('Jq', { query: '.a' }))).toBe('1');
    expect(await text('{"a":[1,"x"],"b":true}', step('PHP Serialize'))).toBe('a:2:{s:1:"a";a:2:{i:0;i:1;i:1;s:1:"x";}s:1:"b";b:1;}');
    expect(JSON.parse(await text('a:2:{s:1:"a";a:2:{i:0;i:1;i:1;s:1:"x";}s:1:"b";b:1;}', step('PHP Deserialize')))).toEqual({ a: [1, 'x'], b: true });
    expect(await text('a { color : red ; }', step('CSS Minify'))).toBe('a{color:red}');
    expect(await text('function add(first, second) { return first + second; } console.log(add(1, 2));', step('JavaScript Minify'))).toContain('console.log');
  });

  it('analyses data', async () => {
    expect(await text('aaaa', step('Entropy'))).toContain('0.000000');
    expect(await text('', step('Generate De Bruijn Sequence', { k: 2, n: 3 }))).toBe('00010111');
    expect(await text('6ba7b810-9dad-11d1-80b4-00c04fd430c8', step('Analyse UUID'))).toContain('UUID version: 1');
    expect(await text('<p>A &amp; B</p>', step('HTML To Text'))).toBe('A & B');
    expect(Number(await text('51.5007, -0.1246, 40.6892, -74.0445', step('Haversine distance')))).toBeCloseTo(5574840, -3);
  });
});

describe('flow control and Magic', () => {
  it('forks, subsections, registers and jumps', async () => {
    expect(await text('a\nb', step('Fork'), step('To Upper case'), step('Merge'))).toBe('A\nB');
    expect(await text('ab12cd34', step('Subsection', { section: '\\d+' }), step('Reverse'), step('Merge'))).toBe('ab21cd43');
    expect(await text('a=b', step('Register', { extractor: '(\\w)=(\\w)' }), step('Find / Replace', { find: '$R0', 'find.format': 'Simple string', replace: 'X' }))).toBe('X=b');
    expect(await text('a', step('Label', { name: 'top' }), step('ROT13', { amount: 1 }), step('Jump', { label: 'top', max: 2 }))).toBe('d');
    expect(await text('a', step('ROT13', { amount: 1 }), step('Return'), step('ROT13', { amount: 1 }))).toBe('b');
  });

  it('stops at breakpoints and reports the failing step', async () => {
    const paused = await bake('abc', [step('To Upper case'), { ...step('Reverse'), breakpoint: true }], catalog);
    expect(paused.paused).toBe(1);
    expect(toText(paused.value)).toBe('ABC');
    const failed = await bake('not json', [step('To Upper case'), step('JSON Minify')], catalog);
    expect(failed.error?.step).toBe(1);
  });

  it('finds Base64 then gzip with Magic', async () => {
    const encoded = toText(await run('Magic should find this text, which reads like ordinary English prose.', step('Gzip'), step('To Base64')));
    const outcome = await bake(encoded, [step('Magic')], catalog);
    const best = outcome.suggestions?.[0];
    expect(best?.recipe.map((s) => s.op)).toEqual(['from-base64', 'gunzip']);
    expect(best?.preview).toContain('Magic should find this text');
  });
});

describe('recipe format', () => {
  it('reads CyberChef JSON, chef format and URLs, and writes them back', () => {
    const parsed = parseRecipe(
      '[{"op":"From Base64","args":["A-Za-z0-9+/=",true,false]},{"op":"XOR","args":[{"option":"Hex","string":"ff"},"Standard",false]},{"op":"Nonexistent","args":[]}]',
      findOperation,
    );
    expect(parsed.steps.map((s) => s.op)).toEqual(['from-base64', 'xor']);
    expect(parsed.steps[1]?.args.key).toBe('ff');
    expect(parsed.unknown).toEqual(['Nonexistent']);
    const chef = toChefFormat(parsed.steps, catalog.get);
    expect(chef).toBe("From_Base64('A-Za-z0-9+/=',true,false)XOR({'option':'Hex','string':'ff'},'Standard',false)");
    expect(parseRecipe(chef, findOperation).steps).toEqual(parsed.steps.map((s) => ({ ...s, disabled: undefined, breakpoint: undefined })));
    const url = parseRecipe('https://gchq.github.io/CyberChef/#recipe=To_Hex(%27Space%27,0)&input=SGk', findOperation);
    expect(url.steps[0]?.op).toBe('to-hex');
    expect(url.input).toBe('Hi');
    expect(JSON.parse(toCyberChefJson(parsed.steps, catalog.get))[0]).toEqual({ op: 'From Base64', args: ['A-Za-z0-9+/=', true, false] });
  });
});
