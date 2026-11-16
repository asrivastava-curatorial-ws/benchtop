import { describe, expect, it } from 'vitest';
import { curlToCode } from '../../src/lib/curl-code';
import { escapeString, unescapeString } from '../../src/lib/string-escape';
import basicAuth from '../../src/tools/text/basic-auth';
import bbcode from '../../src/tools/text/bbcode';
import benchmark from '../../src/tools/text/benchmark-stats';
import binaryCalculator from '../../src/tools/text/binary-calculator';
import cardValidator, { luhnCheckDigit, luhnValid } from '../../src/tools/text/card-validator';
import coordinates, { distance, fromGeohash, toGeohash, toUtm } from '../../src/tools/text/coordinates';
import curlTool from '../../src/tools/text/curl-to-fetch';
import dataConverter from '../../src/tools/text/data-converter';
import emailHeaders from '../../src/tools/text/email-headers';
import emailNormalizer from '../../src/tools/text/email-normalizer';
import iban, { checkDigitsFor, ibanRemainder } from '../../src/tools/text/iban';
import ipConverter from '../../src/tools/text/ip-converter';
import macAddress from '../../src/tools/text/mac-address';
import mathEvaluator from '../../src/tools/text/math-evaluator';
import nato from '../../src/tools/text/nato-alphabet';
import numeronym from '../../src/tools/text/numeronym';
import percentage from '../../src/tools/text/percentage-calculator';
import phone from '../../src/tools/text/phone-number';
import roman, { fromRoman, toRoman } from '../../src/tools/text/roman-numerals';
import tableConverter from '../../src/tools/text/table-converter';
import { inspectOtherId, ksuid, objectId, ulid } from '../../src/tools/text/uuid';
import { field, out, run } from './helpers';

const sampleOf = (spec: { input?: false | { sample?: string } }) => (spec.input ? (spec.input.sample ?? '') : '');

describe('it-tools additions', () => {
  it('converts Roman numerals both ways', async () => {
    expect(toRoman(3999)).toBe('MMMCMXCIX');
    expect(fromRoman('MCMXCIV')).toBe(1994);
    expect(await out(roman, sampleOf(roman))).toBe('MMXXVI\n1984\nXLIX');
  });

  it('spells, shortens and normalises', async () => {
    expect(await out(nato, 'VITM-2026')).toBe('Victor India Tango Mike Dash Two Zero Two Six');
    expect(await out(numeronym, sampleOf(numeronym))).toBe('i18n\nl10n\na11y\nK8s');
    expect(await out(emailNormalizer, sampleOf(emailNormalizer))).toBe('johnsmith@gmail.com\njane.doe@outlook.com\nops-alerts@example.org');
  });

  it('builds Basic authentication headers', async () => {
    const result = await run(basicAuth, '', { user: 'admin', password: 'secret' });
    expect(field(result, 'Token')).toBe('YWRtaW46c2VjcmV0');
    expect(result.output).toBe('Authorization: Basic YWRtaW46c2VjcmV0');
  });

  it('converts IPv4 addresses and inspects MAC addresses', async () => {
    const ip = await run(ipConverter, sampleOf(ipConverter));
    expect(field(ip, 'Decimal')).toBe('3232235786');
    expect(field(ip, 'Hexadecimal')).toBe('0xC0A8010A');
    expect(field(ip, 'Reverse DNS name')).toBe('10.1.168.192.in-addr.arpa');
    const mac = await run(macAddress, sampleOf(macAddress));
    expect(field(mac, 'IPv6 link-local (EUI-64)')).toBe('fe80::3e22:fbff:fe12:3456');
  });

  it('validates IBANs and card numbers', async () => {
    expect(ibanRemainder('GB82WEST12345698765432')).toBe(1);
    expect(checkDigitsFor('GB', 'WEST12345698765432')).toBe('82');
    expect(await out(iban, 'GB82 WEST 1234 5698 7654 33')).toMatch(/INVALID/);
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnCheckDigit('7992739871')).toBe(3);
    const cards = await out(cardValidator, sampleOf(cardValidator));
    expect(cards).toMatch(/^4242 4242 4242 4242\tvalid\tVisa$/m);
    expect(cards).toMatch(/4445\tINVALID/);
  });

  it('formats phone numbers and evaluates maths with units', async () => {
    expect(field(await run(phone, sampleOf(phone)), 'E.164')).toBe('+12025550143');
    const maths = await out(mathEvaluator, sampleOf(mathEvaluator));
    expect(maths).toContain('5 kW * 8 h to kWh = 40 kWh');
    expect(maths).toMatch(/\(88 mi\/h\) to N = 3\.0757874\d*e\+7 N/);
    expect(field(await run(percentage, ''), '15% of 240')).toBe('36');
  });

  it('decodes the time inside ULID, ObjectId and KSUID', () => {
    const at = Date.UTC(2026, 10, 16, 9, 30);
    expect(ulid(at)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(inspectOtherId(ulid(at))).toMatchObject({ kind: expect.stringMatching(/ULID/), timestampMs: at });
    expect(inspectOtherId(objectId(at))?.timestampMs).toBe(at);
    expect(inspectOtherId(ksuid(at))?.timestampMs).toBe(at);
  });

  it('summarises benchmark runs', async () => {
    expect(field(await run(benchmark, sampleOf(benchmark)), 'for loop')).toMatch(/fastest/);
  });

  it('analyses message headers', async () => {
    const result = await run(emailHeaders, sampleOf(emailHeaders));
    expect(field(result, 'Subject')).toBe('Gallery lighting – revised plan');
    expect(result.fields?.some((item) => item.value === 'pass' || item.value.startsWith('pass'))).toBe(true);
  });
});

describe('freecodeformat additions', () => {
  it('converts YAML to JSON and CSV to Markdown', async () => {
    const json = JSON.parse(await out(dataConverter, sampleOf(dataConverter)));
    expect(json).toMatchObject({ name: 'Benchtop', version: '2.0.0', author: { city: 'Bengaluru' } });
    expect((await out(tableConverter, sampleOf(tableConverter))).split('\n')[0]).toBe('| Gallery | Floor | Exhibits |');
  });

  it('turns BBCode into safe HTML', async () => {
    const html = await out(bbcode, sampleOf(bbcode));
    expect(html).toContain('<strong>Opening hours</strong>');
    expect(html).toContain('<a href="https://example.org/visit">the visit page</a>');
    expect(await out(bbcode, '[url=javascript:alert(1)]x[/url]')).not.toMatch(/href="javascript:/i);
  });

  it('converts coordinates between systems', async () => {
    expect(toGeohash({ lat: 57.64911, lon: 10.40744 }, 11)).toBe('u4pruydqqvj');
    const back = fromGeohash('u4pruydqqvj');
    expect(back.lat).toBeCloseTo(57.64911, 4);
    expect(back.lon).toBeCloseTo(10.40744, 4);
    expect(toUtm({ lat: 0, lon: 75 })).toMatchObject({ zone: 43, easting: 500000, northing: 0 });
    expect(distance({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 }).metres / 1000).toBeCloseTo(343.5, -1);
    const result = await run(coordinates, '');
    expect(field(result, 'UTM (WGS 84)')).toBe('43P 781481 E 1435426 N');
    expect(field(result, 'Degrees, minutes, seconds')).toBe('12° 58′ 17.76″ N  77° 35′ 40.56″ E');
  });
});

describe('converter extensions', () => {
  const JSON_POST = `curl -X POST 'https://api.example.org/v1/users?notify=true' -H 'Content-Type: application/json' -H 'Authorization: Bearer T' --max-time 10 -L -d '{"name": "Ada", "active": true, "tags": null}'`;
  const FORM = "curl -F 'a=1' -F 'f=@x.bin' https://x.test/upload";

  it('turns curl commands into Python, PHP and Go', () => {
    const python = curlToCode(JSON_POST, 'python').code;
    expect(python).toContain('response = requests.post(url, headers=headers, json=payload, timeout=10)');
    expect(python).toContain('"active": True,');
    expect(python).toContain('"tags": None,');
    const form = curlToCode(FORM, 'python').code;
    expect(form).toContain('"f": open("x.bin", "rb"),');
    expect(form).toContain('allow_redirects=False');
    const php = curlToCode(JSON_POST, 'php').code;
    expect(php).toContain("CURLOPT_CUSTOMREQUEST => 'POST',");
    expect(php).toContain('CURLOPT_FOLLOWLOCATION => true,');
    const go = curlToCode(JSON_POST, 'go').code;
    expect(go).toContain('strings.NewReader(`{"name": "Ada", "active": true, "tags": null}`)');
    expect(go).toContain('Timeout: 10000 * time.Millisecond,');
    expect(curlToCode(FORM, 'go').code).toContain('CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },');
  });

  it('turns curl commands into Java, C#, Rust and PowerShell', () => {
    const java = curlToCode(JSON_POST, 'java').code;
    expect(java).toContain('.followRedirects(HttpClient.Redirect.NORMAL)');
    expect(java).toContain('.method("POST", HttpRequest.BodyPublishers.ofString(');
    expect(curlToCode(FORM, 'java').warnings.join(' ')).toMatch(/multipart/);
    const csharp = curlToCode(JSON_POST, 'csharp').code;
    expect(csharp).toContain('new HttpRequestMessage(HttpMethod.Post, "https://api.example.org/v1/users?notify=true")');
    expect(csharp).toContain('Encoding.UTF8, "application/json");');
    expect(csharp).toContain('request.Headers.TryAddWithoutValidation("Authorization", "Bearer T");');
    const rust = curlToCode(JSON_POST, 'rust').code;
    expect(rust).toContain('.body(r#"{"name": "Ada", "active": true, "tags": null}"#)');
    expect(curlToCode(FORM, 'rust').code).toContain('.file("f", "x.bin")?');
    const powershell = curlToCode(JSON_POST, 'powershell').code;
    expect(powershell).toContain("-ContentType 'application/json'");
    expect(powershell).not.toContain('-MaximumRedirection 0');
    expect(curlToCode(`curl "https://x.test/it's"`, 'powershell').code).toContain("-Uri 'https://x.test/it''s'");
  });

  it('keeps JavaScript as the default output of the curl tool', async () => {
    expect((await run(curlTool, "curl -s https://x.test -H 'Accept: application/json'")).output).toContain('await fetch(');
    const go = await run(curlTool, 'curl https://x.test', { language: 'go' });
    expect(go.filename).toBe('main.go');
  });

  it('adds NAND, NOR and XNOR to the binary calculator', async () => {
    const bits = async (op: string) => field(await run(binaryCalculator, '', { a: '1100', b: '1010', op, base: '2', width: '8' }), 'Binary').replace(/\s/g, '');
    expect(await bits('nand')).toBe('11110111');
    expect(await bits('nor')).toBe('11110001');
    expect(await bits('xnor')).toBe('11111001');
  });

  it('escapes and unescapes XML', () => {
    expect(escapeString(`<a href="x">Tom & Jerry's</a>`, 'xml')).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;');
    expect(unescapeString('&lt;b&gt; &#169; &#x20AC; &amp;amp; &bogus; &#xFFFFFFF;', 'xml')).toBe('<b> © € &amp; &bogus; &#xFFFFFFF;');
  });
});
