import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromHex } from '../../src/lib/bytes';
import { chmodSymbolic, fromMode, markdownTable, octal, parseDotenv, parsePermissions, stringifyDotenv, symbolic, toMode } from '../../src/lib/devops';
import { composeDocument, dockerRunToCompose } from '../../src/lib/docker-compose';
import { buildGitignore } from '../../src/lib/gitignore';
import { imageKind, readWebpMetadata, stripMetadata } from '../../src/lib/metadata';
import { entropyBits, generatePassphrase, generatePassword, passwordPoolSize } from '../../src/lib/password';
import { findMatches, highlightMatches, replaceMatches } from '../../src/lib/regex';
import { layoutSprite, spriteCss } from '../../src/lib/sprite';
import { ed25519FromSeed, fingerprintOfLine, generateKeyPair, type KeyKind } from '../../src/lib/ssh-keys';
import { type EscapeTarget, escapeString, unescapeString } from '../../src/lib/string-escape';
import { classify, formatIPv4, formatIPv6, hostRange, parseAddress, parseCidr, subdivide } from '../../src/lib/subnet';
import { buildOtpAuthUri, decodeSecret, hotp, parseOtpAuthUri, totp, verifyTotp } from '../../src/lib/totp';
import { cleanText, describeChar, inspectText } from '../../src/lib/unicode';
import { apacheConfig, buildUrl, headersFor, nginxConfig, parseUrl, type SecurityOptions, type ServerOptions, securityHeaders } from '../../src/lib/web';
import { lorem, slugify, sortLines, textStats } from '../../src/lib/words';
import { decodeBlock, readBlocks } from '../../src/lib/x509';

const has = (command: string, args: string[] = ['-V']) => {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const OPENSSL = has('openssl', ['version']);
const SSH_KEYGEN =
  has('ssh-keygen', ['-?']) ||
  (() => {
    try {
      execFileSync('which', ['ssh-keygen'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
const PILLOW = has('python3', ['-I', '-c', 'import PIL']);
const temp = () => mkdtempSync(join(tmpdir(), 'benchtop-'));

describe('regular expressions', () => {
  it('lists matches with numbered and named groups', () => {
    const result = findMatches('(?<year>\\d{4})-(\\d{2})', 'g', 'From 2024-05 to 2026-11.');
    expect(result.matches.map((m) => m.text)).toEqual(['2024-05', '2026-11']);
    expect(result.matches[1]?.named.year).toBe('2026');
    expect(result.matches[1]?.groups).toEqual(['2026', '11']);
    expect(result.groupCount).toBe(2);
    expect(result.groupNames).toEqual(['year']);
  });

  it('stops after the first match without g, survives empty matches and caps the list', () => {
    expect(findMatches('a', '', 'aaa').matches).toHaveLength(1);
    expect(findMatches('x*', 'g', 'ab').matches).toHaveLength(3);
    const capped = findMatches('.', 'g', 'abcdef', 4);
    expect(capped.matches).toHaveLength(4);
    expect(capped.truncated).toBe(true);
  });

  it('highlights safely and replaces', () => {
    expect(highlightMatches('<b>&', findMatches('b', 'g', '<b>&').matches)).toBe('&lt;<mark title="Match 1">b</mark>&gt;&amp;');
    expect(replaceMatches('(\\w+)@(\\w+)', 'g', 'ada@home bob@work', '$2:$1')).toBe('home:ada work:bob');
  });

  it('explains bad patterns and flags', () => {
    expect(() => findMatches('(', '', 'x')).toThrow(/not valid/);
    expect(() => findMatches('a', 'gq', 'x')).toThrow(/Unknown flag/);
    expect(() => findMatches('a', 'gg', 'x')).toThrow(/only be used once/);
  });
});

describe('subnets', () => {
  it('describes an IPv4 network', () => {
    const net = parseCidr('192.168.1.10/24');
    expect(formatIPv4(net.network)).toBe('192.168.1.0');
    expect(formatIPv4(net.last)).toBe('192.168.1.255');
    expect(formatIPv4(net.mask)).toBe('255.255.255.0');
    const hosts = hostRange(net);
    expect([formatIPv4(hosts.first), formatIPv4(hosts.last), hosts.count]).toEqual(['192.168.1.1', '192.168.1.254', 254n]);
    expect(hostRange(parseCidr('10.0.0.0/31')).count).toBe(2n);
    expect(parseCidr('10.1.2.3 255.255.240.0').prefix).toBe(20);
    expect(() => parseCidr('10.0.0.0 255.0.255.0')).toThrow(/contiguous/);
    expect(classify(4, parseAddress('172.20.1.1').value)).toBe('Private (RFC 1918)');
    expect(classify(4, parseAddress('8.8.8.8').value)).toBe('Public');
  });

  it('handles IPv6 text forms like RFC 5952', () => {
    expect(formatIPv6(parseAddress('2001:db8:0:0:1:0:0:1').value)).toBe('2001:db8::1:0:0:1');
    expect(formatIPv6(parseAddress('2001:DB8:0:0:0:0:2:1').value)).toBe('2001:db8::2:1');
    expect(formatIPv6(parseAddress('::ffff:192.0.2.1').value)).toBe('::ffff:c000:201');
    expect(formatIPv6(parseAddress('fe80::1%eth0').value)).toBe('fe80::1');
    const net = parseCidr('2001:db8:abcd:12::1/48');
    expect(formatIPv6(net.network)).toBe('2001:db8:abcd::');
    expect(net.size).toBe(2n ** 80n);
    expect(() => parseAddress('2001:db8::1::2')).toThrow(/not an IPv4 or IPv6/);
    expect(() => parseAddress('256.1.1.1')).toThrow();
  });

  it('splits networks', () => {
    const { subnets, total } = subdivide(parseCidr('10.0.0.0/24'), 26);
    expect(total).toBe(4n);
    expect(subnets.map(formatIPv4)).toEqual(['10.0.0.0', '10.0.0.64', '10.0.0.128', '10.0.0.192']);
  });
});

describe('string escaping', () => {
  const text = 'Line "one"\nTab\there \\ café € 😀';
  for (const target of ['json', 'javascript', 'java', 'csharp', 'c', 'python', 'shell', 'powershell', 'sql', 'csv', 'regex'] as EscapeTarget[]) {
    it(`round-trips ${target}`, () => {
      expect(unescapeString(escapeString(text, target), target)).toBe(text);
    });
  }
  it('produces the expected literals', () => {
    expect(escapeString('a"b\n', 'json')).toBe('a\\"b\\n');
    expect(escapeString('€', 'c')).toBe('\\xe2\\x82\\xac');
    expect(escapeString('éa', 'c')).toBe('\\xc3\\xa9""a');
    expect(escapeString("it's", 'shell')).toBe(`'it'"'"'s'`);
    expect(escapeString("it's", 'sql')).toBe("'it''s'");
    expect(escapeString('a,b', 'csv')).toBe('"a,b"');
    expect(escapeString('1+1=2?', 'regex')).toBe('1\\+1=2\\?');
    expect(unescapeString('\\u{1F600}\\x41\\101', 'javascript')).toBe('😀AA');
  });
});

describe('one-time passwords', () => {
  const ascii = (text: string) => new TextEncoder().encode(text);
  it('matches the HOTP vectors of RFC 4226', () => {
    const codes = Array.from({ length: 10 }, (_, i) => hotp(ascii('12345678901234567890'), BigInt(i)));
    expect(codes).toEqual(['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']);
  });

  it('matches the TOTP vectors of RFC 6238', () => {
    const seeds = { SHA1: '12345678901234567890', SHA256: '12345678901234567890123456789012', SHA512: '1234567890123456789012345678901234567890123456789012345678901234' } as const;
    const vectors: [number, string, string, string][] = [
      [59, '94287082', '46119246', '90693936'],
      [1111111109, '07081804', '68084774', '25091201'],
      [1111111111, '14050471', '67062674', '99943326'],
      [1234567890, '89005924', '91819424', '93441116'],
      [2000000000, '69279037', '90698825', '38618901'],
      [20000000000, '65353130', '77737706', '47863826'],
    ];
    for (const [time, s1, s256, s512] of vectors) {
      expect(totp(ascii(seeds.SHA1), time * 1000, { digits: 8 })).toBe(s1);
      expect(totp(ascii(seeds.SHA256), time * 1000, { digits: 8, algorithm: 'SHA256' })).toBe(s256);
      expect(totp(ascii(seeds.SHA512), time * 1000, { digits: 8, algorithm: 'SHA512' })).toBe(s512);
    }
  });

  it('verifies codes within the window and handles secrets and links', () => {
    const key = decodeSecret('jbsw y3dp ehpk 3pxp');
    const now = 1_700_000_000_000;
    expect(verifyTotp(key, totp(key, now - 30_000), now)).toBe(-1);
    expect(verifyTotp(key, '000000', now, { window: 0 })).toBeNull();
    const uri = buildOtpAuthUri({ issuer: 'VITM Lab', account: 'ada@example.org', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 });
    expect(uri).toBe('otpauth://totp/VITM%20Lab:ada%40example.org?secret=JBSWY3DPEHPK3PXP&issuer=VITM+Lab');
    expect(parseOtpAuthUri(uri)).toEqual({ issuer: 'VITM Lab', account: 'ada@example.org', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 });
    expect(() => decodeSecret('not base32!')).toThrow(/Base32/);
  });
});

describe('passwords', () => {
  it('uses every chosen kind of character', () => {
    for (let i = 0; i < 50; i++) {
      const value = generatePassword({ length: 12, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: true });
      expect(value).toHaveLength(12);
      expect(value).toMatch(/[a-z]/);
      expect(value).toMatch(/[A-Z]/);
      expect(value).toMatch(/\d/);
      expect(value).not.toMatch(/[0Oo1lI|`'"]/);
    }
    expect(passwordPoolSize({ length: 8, lower: true, upper: false, digits: true, symbols: false, avoidAmbiguous: false })).toBe(36);
    expect(entropyBits(64, 16)).toBe(96);
    expect(() => generatePassword({ length: 8, lower: false, upper: false, digits: false, symbols: false, avoidAmbiguous: false })).toThrow(/at least one/);
    expect(generatePassphrase(['alpha', 'beta', 'gamma'], 4, '-', true, true).split('-')).toHaveLength(5);
  });
});

describe('text utilities', () => {
  it('counts', () => {
    const stats = textStats('Hello world. Hello again!\n\nNew paragraph here.');
    expect(stats).toMatchObject({ words: 7, sentences: 3, paragraphs: 2, lines: 3 });
    expect(stats.topWords[0]).toEqual(['hello', 2]);
    expect(textStats('👍🏽 ok').characters).toBe(4);
  });

  it('slugifies', () => {
    const options = { separator: '-', lowercase: true, maxLength: 0, keepUnicode: false };
    expect(slugify('  Héllo Wörld & Co. — 2026!  ', options)).toBe('hello-world-and-co-2026');
    expect(slugify('Straße Øresund', options)).toBe('strasse-oresund');
    expect(slugify('विज्ञान संग्रहालय', { ...options, keepUnicode: true })).toBe('विज्ञान-संग्रहालय');
    expect(slugify('Café Noël', { ...options, keepUnicode: true })).toBe('café-noël');
    expect(slugify('one two three four', { ...options, maxLength: 12 })).toBe('one-two');
  });

  it('writes placeholder text', () => {
    expect(lorem({ unit: 'words', count: 5, classicStart: true, html: false, seed: 1 })).toBe('Lorem ipsum dolor sit amet.\n');
    const sentences = lorem({ unit: 'sentences', count: 3, classicStart: true, html: false, seed: 2 });
    expect(sentences.startsWith('Lorem ipsum dolor sit amet, consectetur adipiscing elit.')).toBe(true);
    expect(sentences.match(/\./g)).toHaveLength(3);
    expect(lorem({ unit: 'paragraphs', count: 2, classicStart: false, html: true, seed: 3 }).match(/<p>/g)).toHaveLength(2);
  });

  it('sorts lines', () => {
    const base = { descending: false, caseSensitive: false, unique: false, trim: false, removeEmpty: false };
    expect(sortLines('item10\nitem2\nItem1\n', { ...base, mode: 'natural' })).toBe('Item1\nitem2\nitem10\n');
    expect(sortLines('b 10\na 9\nc 100', { ...base, mode: 'numeric', descending: true })).toBe('c 100\nb 10\na 9\n');
    expect(sortLines('b\nA\na\n\nb', { ...base, mode: 'alpha', unique: true, removeEmpty: true })).toBe('A\nb\n');
    expect(sortLines('ccc\na\nbb', { ...base, mode: 'length' })).toBe('a\nbb\nccc\n');
  });
});

describe('Unicode inspection', () => {
  it('finds hidden and bidirectional characters and mixed scripts', () => {
    const report = inspectText('pay\u200Bpal \u202Eabc раураl');
    expect(report.invisible.map((c) => c.hex)).toEqual(['U+200B', 'U+202E']);
    expect(report.bidi.map((c) => c.name)).toEqual(['RIGHT-TO-LEFT OVERRIDE']);
    expect(report.scripts).toEqual(['Latin', 'Cyrillic']);
    expect(describeChar('é')).toMatchObject({ category: 'Lowercase letter', script: 'Latin', utf8: 'C3 A9', hex: 'U+00E9' });
    expect(describeChar('😀')).toMatchObject({ utf16: 'D83D DE00', categoryCode: 'So' });
  });

  it('cleans text', () => {
    expect(cleanText('a\u200Bb\u00A0c\u200Dd', 'NFC', false)).toBe('ab cd');
    expect(cleanText('👨\u200D💻', 'NFC', true)).toBe('👨\u200D💻');
    expect(cleanText('ﬁ', 'NFKC', false)).toBe('fi');
  });
});

describe('DevOps helpers', () => {
  it('converts permissions', () => {
    const p = parsePermissions('755');
    expect([symbolic(p), chmodSymbolic(p), octal(toMode(p))]).toEqual(['rwxr-xr-x', 'u=rwx,g=rx,o=rx', '755']);
    expect(symbolic(fromMode(0o4755))).toBe('rwsr-xr-x');
    expect(symbolic(fromMode(0o1777))).toBe('rwxrwxrwt');
    expect(symbolic(fromMode(0o2644))).toBe('rw-r-Sr--');
    expect(octal(toMode(parsePermissions('-rw-r--r--')))).toBe('644');
    expect(octal(toMode(parsePermissions('drwxrwsr-t')))).toBe('3775');
    expect(() => parsePermissions('999')).toThrow(/not a mode/);
  });

  it('reads and writes .env files', () => {
    const { values, duplicates } = parseDotenv('# comment\nexport A=1\nB = "two words" # note\nC=\'single $raw\'\nD="line1\\nline2"\nE="multi\nline"\nF=plain # trailing\nA=again\n');
    expect(values).toEqual({ A: 'again', B: 'two words', C: 'single $raw', D: 'line1\nline2', E: 'multi\nline', F: 'plain' });
    expect(duplicates).toEqual(['A']);
    expect(parseDotenv(stringifyDotenv(values)).values).toEqual(values);
    expect(stringifyDotenv({ PORT: 8080, NAME: 'a b', EMPTY: '' })).toBe('PORT=8080\nNAME="a b"\nEMPTY=\n');
    expect(() => parseDotenv('NOT VALID')).toThrow(/Line 1/);
  });

  it('builds Markdown tables', () => {
    expect(
      markdownTable(
        [
          ['Name', 'Note'],
          ['a|b', 'x'],
        ],
        'left',
        true,
      ),
    ).toBe('| Name | Note |\n| :--- | :--- |\n| a\\|b | x    |\n');
    expect(markdownTable([['A', 'B'], ['1']], 'center', false)).toBe('| A | B |\n| :-: | :-: |\n| 1 |  |\n');
  });

  it('converts docker run to Compose', () => {
    const result = dockerRunToCompose(
      `docker run -d --name web -p 8080:80 -p 443:443 -v data:/var/lib/data -v ./site:/usr/share/nginx/html:ro -e TZ=Asia/Kolkata --env-file .env --restart unless-stopped --network backend --cpu-shares 512 --mount type=bind,source=/srv/conf,target=/etc/app,readonly -it nginx:1.27 nginx -g "daemon off;"`,
    );
    expect(result.name).toBe('web');
    expect(result.service).toEqual({
      image: 'nginx:1.27',
      container_name: 'web',
      restart: 'unless-stopped',
      command: ['nginx', '-g', 'daemon off;'],
      ports: ['8080:80', '443:443'],
      volumes: ['data:/var/lib/data', './site:/usr/share/nginx/html:ro', '/srv/conf:/etc/app:ro'],
      environment: ['TZ=Asia/Kolkata'],
      env_file: ['.env'],
      networks: ['backend'],
      stdin_open: true,
      tty: true,
    });
    expect(result.warnings).toEqual(['--cpu-shares was not converted; check the Compose reference for an equivalent.']);
    expect(composeDocument([result])).toEqual({ services: { web: result.service }, volumes: { data: {} }, networks: { backend: { external: true } } });
    expect(dockerRunToCompose('docker run --network=host -p8000:8000 -eA=1 python:3').service).toMatchObject({ image: 'python:3', network_mode: 'host', ports: ['8000:8000'], environment: ['A=1'] });
    expect(() => dockerRunToCompose('docker ps')).toThrow(/docker run/);
  });

  it('combines .gitignore templates without duplicates', () => {
    const text = buildGitignore(['node', 'secrets', 'linux'], 'uploads/\n.env');
    expect(text.match(/^\.env$/gm)).toHaveLength(1);
    expect(text).toContain('# Node.js\nnode_modules/');
    expect(text).toContain('# Project\nuploads/');
  });
});

describe('web helpers', () => {
  it('parses and builds URLs', () => {
    const parts = parseUrl('https://user:p%40ss@example.org:8443/a%20b/c?x=1&x=2&y=#top');
    expect(parts).toMatchObject({ protocol: 'https', username: 'user', password: 'p@ss', hostname: 'example.org', port: '8443', hash: '#top', pathSegments: ['a b', 'c'] });
    expect(parts.query).toEqual([
      ['x', '1'],
      ['x', '2'],
      ['y', ''],
    ]);
    expect(parseUrl('example.org/x').hostname).toBe('example.org');
    expect(buildUrl({ hostname: 'example.org', path: ['a b', 'c'], query: { q: 'tea & cake', tag: ['a', 'b'] }, hash: 'top' })).toBe('https://example.org/a%20b/c?q=tea+%26+cake&tag=a&tag=b#top');
    expect(() => parseUrl('not a url')).toThrow(/not a URL/);
  });

  it('writes security headers and warns about weak choices', () => {
    const options: SecurityOptions = {
      csp: true,
      cspDefault: 'self',
      cspScripts: 'self unsafe-inline',
      cspStyles: 'self',
      cspImages: 'self data:',
      cspConnect: 'self',
      cspFonts: 'self',
      cspFrames: '',
      upgradeInsecure: true,
      reportOnly: false,
      hsts: true,
      hstsPreload: false,
      frame: 'DENY',
      referrer: 'strict-origin-when-cross-origin',
      nosniff: true,
      permissions: false,
      isolation: false,
    };
    const { headers, warnings } = securityHeaders(options);
    expect(headers[0]).toEqual([
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
    ]);
    expect(warnings[0]).toMatch(/unsafe-inline/);
    expect(headersFor('nginx', [['X-Frame-Options', 'DENY']])).toBe('add_header X-Frame-Options "DENY" always;\n');
  });

  it('writes server configuration', () => {
    const options: ServerOptions = {
      kind: 'spa',
      domain: 'museum.example',
      root: '/var/www/app',
      upstream: '',
      https: true,
      redirectWww: true,
      compression: true,
      caching: true,
      websockets: false,
      maxBody: 10,
    };
    const nginx = nginxConfig(options);
    expect(nginx).toContain('try_files $uri $uri/ /index.html;');
    expect(nginx).toContain('return 301 https://museum.example$request_uri;');
    expect(nginx.match(/server \{/g)).toHaveLength(3);
    expect(nginxConfig({ ...options, kind: 'proxy', upstream: 'http://127.0.0.1:8000', websockets: true })).toContain('proxy_set_header Upgrade $http_upgrade;');
    expect(apacheConfig({ ...options, kind: 'proxy', upstream: 'http://127.0.0.1:8000' })).toMatch(/^# Enable the modules this needs: sudo a2enmod headers ssl proxy proxy_http deflate\n/);
  });
});

describe('sprite sheets', () => {
  it('lays out images and writes CSS', () => {
    const layout = layoutSprite(
      [
        { name: 'Home Icon.png', width: 32, height: 32 },
        { name: 'search.png', width: 24, height: 32 },
        { name: 'home icon.svg', width: 16, height: 16 },
      ],
      'horizontal',
      4,
    );
    expect(layout).toMatchObject({ width: 80, height: 32 });
    expect(layout.items.map((item) => [item.className, item.x])).toEqual([
      ['home-icon', 0],
      ['search', 36],
      ['home-icon-2', 64],
    ]);
    expect(spriteCss(layout, 'sprite.png', 'icon', 2)).toContain('.icon-search {\n  width: 12px;\n  height: 16px;\n  background-position: -18px 0;\n}');
    expect(
      layoutSprite(
        [
          { name: 'a', width: 10, height: 10 },
          { name: 'b', width: 10, height: 10 },
          { name: 'c', width: 10, height: 10 },
        ],
        'grid',
        0,
      ),
    ).toMatchObject({ width: 20, height: 20 });
  });
});

describe('certificates and keys', () => {
  it.runIf(OPENSSL)('decodes certificates exactly as OpenSSL reads them', () => {
    const dir = temp();
    const cases = [
      ['rsa', ['-newkey', 'rsa:2048'], 'RSA 2048-bit (exponent 65537)', 'SHA-256 with RSA'],
      ['ec', ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256'], 'EC P-256', 'ECDSA with SHA-256'],
      ['ed', ['-newkey', 'ed25519'], 'Ed25519', 'Ed25519'],
    ] as const;
    for (const [name, keyArgs, keyText, signature] of cases) {
      const cert = join(dir, `${name}.pem`);
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          ...keyArgs,
          '-nodes',
          '-keyout',
          join(dir, `${name}.key`),
          '-out',
          cert,
          '-days',
          '30',
          '-subj',
          '/C=IN/O=Benchtop Test/CN=example.org',
          '-addext',
          'subjectAltName=DNS:example.org,DNS:*.example.org,IP:192.0.2.1,IP:2001:db8::1,email:ops@example.org',
          '-addext',
          'extendedKeyUsage=serverAuth',
        ],
        { stdio: 'ignore' },
      );
      const pem = readFileSync(cert, 'utf8');
      const decoded = decodeBlock(readBlocks(pem, null)[0] as never);
      if (decoded.kind !== 'certificate') throw new Error('not decoded as a certificate');
      const fingerprint = execFileSync('openssl', ['x509', '-in', cert, '-noout', '-fingerprint', '-sha256'], { encoding: 'utf8' }).trim().split('=')[1];
      const serial = execFileSync('openssl', ['x509', '-in', cert, '-noout', '-serial'], { encoding: 'utf8' }).trim().split('=')[1] as string;
      const end = execFileSync('openssl', ['x509', '-in', cert, '-noout', '-enddate'], { encoding: 'utf8' }).trim().split('=')[1] as string;
      expect(decoded.sha256).toBe(fingerprint);
      expect(decoded.serial.replace(/:/g, '')).toBe(serial);
      expect(decoded.notAfter.getTime()).toBe(new Date(end).getTime());
      expect(decoded.subject).toBe('C=IN, O=Benchtop Test, CN=example.org');
      expect(decoded.selfSigned).toBe(true);
      expect(decoded.signature).toBe(signature);
      expect(
        `${decoded.publicKey.algorithm === 'RSA' ? `RSA ${decoded.publicKey.bits}-bit (exponent ${decoded.publicKey.exponent})` : decoded.publicKey.algorithm === 'EC' ? `EC ${decoded.publicKey.curve}` : decoded.publicKey.algorithm}`,
      ).toBe(keyText);
      const san = decoded.extensions.find((extension) => extension.name === 'Subject alternative names');
      expect(san?.value).toBe('DNS:example.org, DNS:*.example.org, IP:192.0.2.1, IP:2001:db8::1, email:ops@example.org');
      expect(decoded.extensions.find((extension) => extension.name === 'Extended key usage')?.value).toBe('TLS server authentication');
      expect(decoded.extensions.find((extension) => extension.name === 'Basic constraints')?.value).toBe('CA: yes');
      // The private key file is described too.
      const key = decodeBlock(readBlocks(readFileSync(join(dir, `${name}.key`), 'utf8'), null)[0] as never);
      expect(key).toMatchObject({ kind: 'private key', format: 'PKCS #8' });
    }
    const csr = join(dir, 'req.csr');
    execFileSync(
      'openssl',
      ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'req.key'), '-out', csr, '-subj', '/CN=api.example.org', '-addext', 'subjectAltName=DNS:api.example.org'],
      { stdio: 'ignore' },
    );
    const request = decodeBlock(readBlocks(readFileSync(csr, 'utf8'), null)[0] as never);
    expect(request).toMatchObject({ kind: 'request', subject: 'CN=api.example.org' });
    if (request.kind === 'request') expect(request.extensions[0]?.value).toBe('DNS:api.example.org');
    // DER input works as well.
    const der = execFileSync('openssl', ['x509', '-in', join(dir, 'rsa.pem'), '-outform', 'DER']);
    expect(decodeBlock(readBlocks('', new Uint8Array(der))[0] as never).kind).toBe('certificate');
  });

  it('derives Ed25519 keys as in RFC 8032', () => {
    const pair = ed25519FromSeed(fromHex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'), 'test');
    expect(pair.pemPublic).toContain('MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=');
    expect(pair.sshPublic).toBe('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINdamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea test');
    expect(fingerprintOfLine(pair.sshPublic).fingerprint).toBe(pair.fingerprint);
  });

  it.runIf(SSH_KEYGEN)(
    'writes keys that ssh-keygen and OpenSSL accept',
    async () => {
      const dir = temp();
      for (const kind of ['ed25519', 'ecdsa-p256', 'ecdsa-p521', 'rsa-2048'] as KeyKind[]) {
        const pair = await generateKeyPair(kind, `benchtop-${kind}`);
        const path = join(dir, `id_${kind}`);
        writeFileSync(path, pair.sshPrivate);
        chmodSync(path, 0o600);
        const derived = execFileSync('ssh-keygen', ['-y', '-f', path], { encoding: 'utf8' }).trim();
        expect(derived.split(' ').slice(0, 2).join(' ')).toBe(pair.sshPublic.split(' ').slice(0, 2).join(' '));
        writeFileSync(`${path}.pub`, `${pair.sshPublic}\n`);
        const listing = execFileSync('ssh-keygen', ['-l', '-E', 'sha256', '-f', `${path}.pub`], { encoding: 'utf8' });
        expect(listing).toContain(pair.fingerprint);
        expect(listing).toContain(`benchtop-${kind}`);
        if (OPENSSL) {
          writeFileSync(`${path}.pem`, pair.pemPrivate);
          const publicFromPrivate = execFileSync('openssl', ['pkey', '-in', `${path}.pem`, '-pubout'], { encoding: 'utf8' });
          expect(publicFromPrivate).toBe(pair.pemPublic);
        }
      }
    },
    60_000,
  );
});

describe('image metadata', () => {
  it('recognises formats', () => {
    expect(imageKind(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('jpeg');
    expect(imageKind(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(() => stripMetadata(new Uint8Array([1, 2, 3, 4]), { keepColorProfile: true, keepOrientation: true })).toThrow(/JPEG, PNG and WebP/);
  });

  it.runIf(PILLOW)('removes EXIF, GPS, comments and text chunks without touching the pixels', () => {
    const dir = temp();
    const script = [
      'import sys',
      'from PIL import Image, PngImagePlugin',
      'd = sys.argv[1]',
      'im = Image.new("RGB", (64, 40), (23, 105, 78))',
      'exif = Image.Exif()',
      'exif[0x0112] = 6',
      'exif[0x010F] = "TestCam"',
      'im.save(d + "/a.jpg", exif=exif, comment=b"secret note")',
      'info = PngImagePlugin.PngInfo()',
      'info.add_text("Author", "Ada")',
      'im.save(d + "/a.png", pnginfo=info, exif=exif)',
      'im.save(d + "/a.webp", exif=exif, lossless=True)',
    ].join('\n');
    execFileSync('python3', ['-I', '-c', script, dir]);
    for (const name of ['a.jpg', 'a.png', 'a.webp']) {
      const source = new Uint8Array(readFileSync(join(dir, name)));
      const result = stripMetadata(source, { keepColorProfile: true, keepOrientation: true });
      expect(result.removed).toContain('EXIF');
      writeFileSync(join(dir, `clean-${name}`), result.bytes);
    }
    const check = [
      'import sys, json',
      'from PIL import Image',
      'd = sys.argv[1]',
      'out = {}',
      'for name in ["clean-a.jpg", "clean-a.png", "clean-a.webp"]:',
      '    im = Image.open(d + "/" + name)',
      '    im.load()',
      '    exif = dict(im.getexif())',
      '    out[name] = {"size": im.size, "exif": {str(k): str(v) for k, v in exif.items()}, "text": dict(getattr(im, "text", {}) or {}), "comment": str(im.info.get("comment", ""))}',
      'print(json.dumps(out))',
    ].join('\n');
    const report = JSON.parse(execFileSync('python3', ['-I', '-c', check, dir], { encoding: 'utf8' }));
    expect(report['clean-a.jpg']).toEqual({ size: [64, 40], exif: { '274': '6' }, text: {}, comment: '' });
    expect(report['clean-a.png']).toEqual({ size: [64, 40], exif: { '274': '6' }, text: {}, comment: '' });
    expect(report['clean-a.webp']).toEqual({ size: [64, 40], exif: {}, text: {}, comment: '' });
    const webp = readWebpMetadata(new Uint8Array(readFileSync(join(dir, 'a.webp'))));
    expect(['MM', 'II']).toContain(String.fromCharCode(...(webp.exif ?? new Uint8Array()).subarray(0, 2)));
    expect(readWebpMetadata(new Uint8Array(readFileSync(join(dir, 'clean-a.webp')))).exif).toBeNull();
    const pngPlain = stripMetadata(new Uint8Array(readFileSync(join(dir, 'a.png'))), { keepColorProfile: true, keepOrientation: false });
    expect(pngPlain.orientation).toBe(6);
    expect(String.fromCharCode(...pngPlain.bytes)).not.toContain('eXIf');
    const plain = stripMetadata(new Uint8Array(readFileSync(join(dir, 'a.jpg'))), { keepColorProfile: true, keepOrientation: false });
    expect(plain.orientation).toBe(6);
    expect(plain.removed).toEqual(expect.arrayContaining(['EXIF', 'Comment']));
  });
});
