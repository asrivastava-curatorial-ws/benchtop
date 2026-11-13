/**
 * Tool-level tests for the tools added in 1.1: each one is run exactly as the
 * app runs it (defaults merged with the options under test).
 */
import { describe, expect, it } from 'vitest';
import { describeQrContent, parseRecord } from '../../src/lib/qr-content';
import { escapeString } from '../../src/lib/string-escape';
import certificateDecoder from '../../src/tools/text/certificate-decoder';
import dockerCompose from '../../src/tools/text/docker-compose';
import envJson from '../../src/tools/text/env-json';
import gitignore from '../../src/tools/text/gitignore';
import graphqlFormatter, { minifyGraphql } from '../../src/tools/text/graphql-formatter';
import iniJson from '../../src/tools/text/ini-json';
import jsonQuery from '../../src/tools/text/json-query';
import jsonSchema from '../../src/tools/text/json-schema';
import loremIpsum from '../../src/tools/text/lorem-ipsum';
import markdownTable from '../../src/tools/text/markdown-table';
import passwordGenerator from '../../src/tools/text/password-generator';
import regexTester from '../../src/tools/text/regex-tester';
import securityHeaders from '../../src/tools/text/security-headers';
import semverTool from '../../src/tools/text/semver';
import serverConfig from '../../src/tools/text/server-config';
import slugifyTool from '../../src/tools/text/slugify';
import sortLines from '../../src/tools/text/sort-lines';
import sqlFormatter from '../../src/tools/text/sql-formatter';
import sshKeygen from '../../src/tools/text/ssh-keygen';
import stringEscape from '../../src/tools/text/string-escape';
import subnetCalculator from '../../src/tools/text/subnet-calculator';
import tomlJson from '../../src/tools/text/toml-json';
import unicodeInspector from '../../src/tools/text/unicode-inspector';
import urlParser from '../../src/tools/text/url-parser';
import userAgent from '../../src/tools/text/user-agent';
import wordCounter from '../../src/tools/text/word-counter';
import { field, out, run } from './helpers';

const sample = (spec: { input?: unknown }): string => (typeof spec.input === 'object' && spec.input !== null ? ((spec.input as { sample?: string }).sample ?? '') : '');

describe('formatters', () => {
  it('formats SQL in several dialects', async () => {
    const formatted = await out(sqlFormatter, sample(sqlFormatter));
    expect(formatted).toContain('SELECT\n  g.name,\n  count(e.id) AS exhibits,');
    expect(formatted).toContain('LEFT JOIN exhibits e ON e.gallery_id = g.id');
    expect(await out(sqlFormatter, 'SELECT TOP 5 [name] FROM dbo.t', { dialect: 'tsql', keywordCase: 'lower' })).toBe('select\n  top 5 [name]\nfrom\n  dbo.t\n');
    await expect(run(sqlFormatter, "select 'unterminated", { dialect: 'postgresql' })).rejects.toThrow();
  });

  it('minifies SQL without touching strings or quoted names', async () => {
    const input = 'select \'a,  b\' as x , "my  col" from t -- note\nwhere z = 1 /* block */ and y >= -1';
    expect(await out(sqlFormatter, input, { minify: true })).toBe('select \'a,  b\' as x,"my  col" from t where z=1 and y>=-1');
  });

  it('formats and minifies GraphQL', async () => {
    const formatted = await out(graphqlFormatter, 'query Q($id: ID!) { node(id: $id) { ... on Exhibit { title } } }');
    expect(formatted).toBe('query Q($id: ID!) {\n  node(id: $id) {\n    ... on Exhibit {\n      title\n    }\n  }\n}\n');
    expect(minifyGraphql('query {\n  a(b: "x  y", c: 2) # comment\n  {\n    d\n  }\n}')).toBe('query{a(b:"x  y" c:2){d}}');
    expect(minifyGraphql('"""\nKeep   this\n"""\ntype A { b: Int }')).toBe('"""\nKeep   this\n""" type A{b:Int}');
    await expect(run(graphqlFormatter, 'query { a ')).rejects.toThrow();
  });
});

describe('query and validate', () => {
  it('tests regular expressions and previews replacements', async () => {
    const result = await run(regexTester, sample(regexTester));
    expect(field(result, 'Matches')).toBe('2');
    expect(result.output).toContain('"ada@example.org"');
    expect(result.output).toContain('domain: "example.net"');
    expect(result.preview?.kind).toBe('html');
    expect(await out(regexTester, 'a1b22', { pattern: '\\d+', flags: 'g', view: 'replace', replacement: '<$&>' })).toBe('a<1>b<22>');
    await expect(run(regexTester, 'x', { pattern: '(' })).rejects.toThrow();
    await expect(run(regexTester, 'x', { pattern: 'x', flags: 'gg' })).rejects.toThrow();
  });

  it('queries JSON with JSONPath and jq', async () => {
    expect(JSON.parse(await out(jsonQuery, sample(jsonQuery)))).toEqual(['Steam engine', 'Rocket model']);
    expect(JSON.parse(await out(jsonQuery, sample(jsonQuery), { path: '$..exhibits[?(@.id > 1)].id' }))).toEqual([2, 3]);
    const jq = await out(jsonQuery, sample(jsonQuery), { engine: 'jq' });
    expect(JSON.parse(jq)).toEqual([
      { name: 'Engine Hall', count: 2 },
      { name: 'Space', count: 1 },
    ]);
    expect((await out(jsonQuery, '{"a":[1,2,3]}', { engine: 'jq', jq: '.a | add' })).trim()).toBe('6');
    await expect(run(jsonQuery, '{}', { engine: 'jq', jq: '.a |' })).rejects.toThrow();
  }, 30_000);

  it('validates JSON against a schema and reports only the specific errors', async () => {
    const result = await run(jsonSchema, sample(jsonSchema), {}, { input2: (jsonSchema as unknown as { input2: { sample: string } }).input2.sample });
    expect(field(result, 'Result')).toBe('3 problems');
    expect(result.output).toContain('/  Instance does not have required property "gallery".  (required)');
    expect(result.output).toContain('/tags  Duplicate items at indexes 0 and 1.  (uniqueItems)');
    expect(result.output).toContain('/dimensions/height  -3 is less than 0.  (exclusiveMinimum)');
    expect(result.output).not.toContain('does not match schema');
    const extra = await run(jsonSchema, '{"a":1,"b":2}', {}, { input2: '{"properties":{"a":{"type":"integer"}},"additionalProperties":false}' });
    expect(extra.output).toContain('Property "b" does not match additional properties schema');
    const ok = await run(jsonSchema, '{"a":1}', {}, { input2: '{"$schema":"http://json-schema.org/draft-07/schema#","type":"object"}' });
    expect(field(ok, 'Result')).toBe('Valid');
    expect(field(ok, 'Draft')).toBe('7');
  });
});

describe('config formats', () => {
  it('converts TOML and JSON both ways', async () => {
    const json = JSON.parse(await out(tomlJson, 'title = "x"\n[server]\nport = 8080\nhosts = ["a", "b"]\n'));
    expect(json).toEqual({ title: 'x', server: { port: 8080, hosts: ['a', 'b'] } });
    const toml = await out(tomlJson, JSON.stringify(json), { mode: 'decode' });
    expect(toml).toContain('[server]');
    expect(toml).toContain('port = 8080');
    expect(JSON.parse(await out(tomlJson, toml))).toEqual(json);
    await expect(run(tomlJson, 'a = ')).rejects.toThrow();
  });

  it('converts INI and JSON both ways', async () => {
    const json = JSON.parse(await out(iniJson, sample(iniJson)));
    expect(json.display.width).toBe(4096);
    expect(json.network.allowed).toEqual(['control-room', 'booth']);
    const ini = await out(iniJson, '{"name":"x","db":{"host":"localhost","port":5432}}', { mode: 'decode' });
    expect(ini).toContain('[db]');
    expect(ini).toMatch(/host ?= ?localhost/);
  });

  it('converts .env files and JSON both ways', async () => {
    const result = await run(envJson, sample(envJson));
    expect(result.info).toBe('5 variables');
    expect(JSON.parse(result.output ?? '').WELCOME_MESSAGE).toBe('Welcome!\nShows start every hour.');
    const env = await out(envJson, '{"A":"plain","B":"has space","C":"line\\nbreak","D":"say \\"hi\\""}', { mode: 'decode' });
    expect(env).toContain('A=plain');
    expect(env).toContain('B="has space"');
    expect(env).toContain('C="line\\nbreak"');
    expect(JSON.parse(await out(envJson, env))).toEqual({ A: 'plain', B: 'has space', C: 'line\nbreak', D: 'say "hi"' });
  });

  it('writes compose files from docker run commands', async () => {
    const yaml = await out(dockerCompose, sample(dockerCompose));
    expect(yaml).toContain('services:\n  kiosk-api:\n    image: ghcr.io/example/kiosk-api:2.4');
    expect(yaml).toContain('      - kiosk-data:/app/data');
    expect(yaml).toContain('volumes:\n  kiosk-data: {}');
  });

  it('builds .gitignore files', async () => {
    const text = await out(gitignore, 'uploads/');
    expect(text).toContain('node_modules/');
    expect(text).toContain('uploads/');
    expect(text).not.toContain('\r');
  });

  it('sorts versions and checks ranges', async () => {
    const result = await run(semverTool, sample(semverTool));
    expect(field(result, 'Highest match')).toBe('2.0.0');
    expect(result.output?.split('\n')[0]?.trim()).toBe('2.1.0');
  });
});

describe('escaping, web and network', () => {
  it('escapes strings for each language and back', async () => {
    expect(await out(stringEscape, 'say "hi"\n', { target: 'json' })).toBe('say \\"hi\\"\\n');
    expect(await out(stringEscape, "it's", { target: 'shell' })).toBe(`'it'"'"'s'`);
    expect(await out(stringEscape, "O'Brien", { target: 'sql' })).toBe("'O''Brien'");
    expect(await out(stringEscape, 'a,"b"', { target: 'csv' })).toBe('"a,""b"""');
    expect(await out(stringEscape, 'say \\"hi\\"\\n', { target: 'json', mode: 'decode' })).toBe('say "hi"\n');
    // Escaped patterns must stay valid with the Unicode flags, where "\-" outside a class is an error.
    const literal = 'a-b [c] (d)/e.f*';
    for (const flags of ['', 'u', 'v']) expect(new RegExp(`^${escapeString(literal, 'regex')}$`, flags).test(literal)).toBe(true);
  });

  it('parses URLs and builds them back', async () => {
    const result = await run(urlParser, sample(urlParser));
    expect(field(result, 'Host')).toBe('tickets.example.org');
    expect(result.warnings?.join(' ')).toMatch(/password/);
    const built = await out(urlParser, result.output ?? '', { mode: 'build' });
    expect(built.trim()).toBe('https://ada:secret@tickets.example.org:8443/shows/planetarium%20show/2026?date=2026-11-14&seats=2&seats=3&lang=kn#book');
  });

  it('calculates IPv4 and IPv6 subnets', async () => {
    const v4 = await run(subnetCalculator, '192.168.10.37/26');
    expect(field(v4, 'Network')).toBe('192.168.10.0/26');
    expect(field(v4, 'Broadcast')).toBe('192.168.10.63');
    expect(field(v4, 'Host count')).toBe('62');
    const split = await out(subnetCalculator, '10.0.0.0/24', { split: 26 });
    expect(split).toContain('10.0.0.192/26');
    const v6 = await run(subnetCalculator, '2001:db8:abcd:12::1/64');
    expect(field(v6, 'Network')).toBe('2001:db8:abcd:12::/64');
    await expect(run(subnetCalculator, '300.1.1.1/24')).rejects.toThrow();
  });

  it('identifies browsers from User-Agent strings', async () => {
    const result = await run(userAgent, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0');
    expect(field(result, 'Browser')).toBe('Firefox 133.0');
    expect(field(result, 'Engine')).toBe('Gecko');
    expect(field(result, 'Operating system')).toMatch(/^Windows/);
  });

  it('writes security headers and server configuration', async () => {
    const nginx = await out(securityHeaders, '');
    expect(nginx).toContain('add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;');
    expect(nginx).toContain("frame-ancestors 'none'");
    expect(await out(securityHeaders, '', { server: 'apache' })).toContain('Header always set X-Content-Type-Options "nosniff"');
    const caddy = await out(serverConfig, '', { server: 'caddy', kind: 'proxy' });
    expect(caddy).toContain('reverse_proxy');
    const apache = await out(serverConfig, '', { server: 'apache' });
    expect(apache).toContain('<VirtualHost *:443>');
  });
});

describe('keys and passwords', () => {
  it('generates passwords and passphrases', async () => {
    const result = await run(passwordGenerator, '', { length: 32, count: 3 });
    const lines = (result.output ?? '').trim().split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toHaveLength(32);
    expect(field(result, 'Strength')).toMatch(/bits of entropy/);
    const phrase = (await out(passwordGenerator, '', { kind: 'passphrase', words: 5, separator: '-', count: 1, number: false, capitalize: false })).trim();
    expect(phrase.split('-')).toHaveLength(5);
  });

  it('generates SSH keys', async () => {
    const ed = await run(sshKeygen, '', { kind: 'ed25519', comment: 'test@host' });
    expect(field(ed, 'Public key')).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5\S+ test@host$/);
    expect(ed.output).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
    const ec = await run(sshKeygen, '', { kind: 'ecdsa-p256', comment: '' });
    expect(field(ec, 'Public key')).toMatch(/^ecdsa-sha2-nistp256 /);
    expect(field(ec, 'Fingerprint')).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });

  it('decodes the sample certificate', async () => {
    const result = await run(certificateDecoder, sample(certificateDecoder));
    expect(field(result, 'Names')).toBe('DNS:tickets.example.org, DNS:www.tickets.example.org, IP:192.0.2.10');
    expect(field(result, 'Key')).toBe('EC P-256');
    expect(result.output).toContain('Extended key usage: TLS server authentication');
    expect(result.output).toContain('SHA-256:      70:D2:22:D2:DB:97:DD:4F');
  });
});

describe('text utilities', () => {
  it('counts words and sentences', async () => {
    const result = await run(wordCounter, 'One two three. Four!\n\nFive six?');
    expect(field(result, 'Words')).toBe('6');
    expect(field(result, 'Sentences')).toBe('3');
    expect(field(result, 'Paragraphs')).toBe('2');
  });

  it('makes slugs, sorts lines, writes tables and placeholder text', async () => {
    expect(await out(slugifyTool, sample(slugifyTool))).toBe(
      'visvesvaraya-industrial-and-technological-museum\nrene-magritte-ceci-n-est-pas-une-pipe\n10-tips-for-better-exhibit-labels-2026-edition\n',
    );
    expect(await out(sortLines, sample(sortLines), { mode: 'natural' })).toBe('engine hall\ngallery-1\nGallery-2\ngallery-10\nspace\nspace\n');
    expect(await out(sortLines, sample(sortLines), { mode: 'natural', unique: true })).toBe('engine hall\ngallery-1\nGallery-2\ngallery-10\nspace\n');
    expect(await out(markdownTable, 'a,b\n1,"x|y"')).toBe('| a   | b    |\n| --- | ---- |\n| 1   | x\\|y |\n');
    expect((await out(loremIpsum, '', { unit: 'words', count: 5, classicStart: true, html: false })).trim()).toBe('Lorem ipsum dolor sit amet.');
  });

  it('finds hidden characters and cleans them', async () => {
    const result = await run(unicodeInspector, sample(unicodeInspector));
    expect(field(result, 'Hidden characters')).toContain('U+202E RIGHT-TO-LEFT OVERRIDE');
    expect(result.warnings?.join(' ')).toMatch(/Trojan Source/);
    const cleaned = await out(unicodeInspector, 'pa\u200By\u202Epal\u00A0x', { mode: 'clean', form: 'NFKC', keepJoiners: false });
    expect(cleaned).toBe('paypal x');
  });
});

describe('QR content', () => {
  it('parses Wi-Fi records with escapes', () => {
    expect(parseRecord('T:WPA;S:My\\;Net;P:pa\\:ss;;')).toEqual([
      ['T', 'WPA'],
      ['S', 'My;Net'],
      ['P', 'pa:ss'],
    ]);
    const wifi = describeQrContent('WIFI:S:Benchtop Lab;T:WPA;P:correct horse;H:true;;');
    expect(wifi.kind).toBe('Wi-Fi network');
    expect(wifi.fields).toEqual([
      ['Network name (SSID)', 'Benchtop Lab'],
      ['Security', 'WPA/WPA2/WPA3 (password)'],
      ['Password', 'correct horse'],
      ['Hidden network', 'Yes'],
    ]);
  });

  it('recognises links, contacts, events and two-factor secrets', () => {
    const link = describeQrContent('http://192.168.1.1/admin');
    expect(link.kind).toBe('Web address');
    expect(link.warnings).toHaveLength(2);
    const card = describeQrContent('BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nTEL;TYPE=cell:+44 20 7946 0000\nEMAIL:ada@example.org\nEND:VCARD');
    expect(card.fields).toEqual([
      ['Name', 'Ada Lovelace'],
      ['Phone (cell)', '+44 20 7946 0000'],
      ['Email', 'ada@example.org'],
    ]);
    const event = describeQrContent('BEGIN:VEVENT\nSUMMARY:Sky show\nDTSTART:20261114T183000\nLOCATION:Planetarium\nEND:VEVENT');
    expect(event.fields).toEqual([
      ['Title', 'Sky show'],
      ['Starts', '2026-11-14 18:30:00'],
      ['Location', 'Planetarium'],
    ]);
    const otp = describeQrContent('otpauth://totp/Benchtop:ada?secret=JBSWY3DPEHPK3PXP&issuer=Benchtop');
    expect(otp.kind).toBe('Two-factor set-up link (TOTP)');
    expect(otp.fields.find(([label]) => label === 'Secret')?.[1]).toMatch(/^16 characters/);
    expect(describeQrContent('mailto:a@b.org?subject=Hi').fields).toEqual([
      ['To', 'a@b.org'],
      ['Subject', 'Hi'],
    ]);
    expect(describeQrContent('just words').kind).toBe('Text');
  });
});
