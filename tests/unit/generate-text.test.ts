import { describe, expect, it } from 'vitest';
import { contrastRatio, describeColor, hexOf, parseColor, toRgba } from '../../src/lib/color';
import { analyzeSelector, cssToTailwind, mediaVariants, splitTop } from '../../src/lib/css-to-tailwind';
import { generateShades } from '../../src/lib/shades';
import barcode, { gs1CheckDigit } from '../../src/tools/text/barcode';
import cacCalculator from '../../src/tools/text/cac-calculator';
import caseConverter from '../../src/tools/text/case-converter';
import colorConverter, { nearestTailwind, tailwindPalette } from '../../src/tools/text/color-converter';
import colorShades from '../../src/tools/text/color-shades';
import contrastChecker from '../../src/tools/text/contrast-checker';
import cron from '../../src/tools/text/cron';
import cssToTailwindTool from '../../src/tools/text/css-to-tailwind';
import dedupeLines from '../../src/tools/text/dedupe-lines';
import diff from '../../src/tools/text/diff';
import emailLink, { buildMailto } from '../../src/tools/text/email-link';
import llmsTxt from '../../src/tools/text/llms-txt';
import paymentFee, { chargeFor, feeOn } from '../../src/tools/text/payment-fee';
import randomWords from '../../src/tools/text/random-words';
import removeLineBreaks from '../../src/tools/text/remove-line-breaks';
import robotsTxt from '../../src/tools/text/robots-txt';
import shadcnTheme from '../../src/tools/text/shadcn-theme';
import textReverser from '../../src/tools/text/text-reverser';
import uuid, { inspectUuid } from '../../src/tools/text/uuid';
import { field, out, run } from './helpers';

describe('UUID', () => {
  it('generates valid UUIDs of each version', async () => {
    for (const [version, digit] of [
      ['v4', '4'],
      ['v7', '7'],
      ['v1', '1'],
      ['v6', '6'],
    ] as const) {
      const lines = (await out(uuid, '', { version, count: 50 })).split('\n');
      expect(lines).toHaveLength(50);
      expect(new Set(lines).size).toBe(50);
      for (const line of lines) expect(line).toMatch(new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-${digit}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`));
    }
    expect(await out(uuid, '', { version: 'nil', count: 1 })).toBe('00000000-0000-0000-0000-000000000000');
    expect(await out(uuid, '', { version: 'max', count: 1 })).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
  });

  it('formats output and keeps v7 sortable', async () => {
    expect(await out(uuid, '', { count: 1, uppercase: true, hyphens: false, braces: true })).toMatch(/^\{[0-9A-F]{32}\}$/);
    const sorted = (await out(uuid, '', { version: 'v7', count: 200 })).split('\n');
    expect([...sorted].sort()).toEqual(sorted);
  });

  it('decodes timestamps, variants and versions', () => {
    // RFC 9562 appendix A test vectors
    expect(inspectUuid('C232AB00-9414-11EC-B3C8-9F6BDECED846')).toEqual({
      canonical: 'c232ab00-9414-11ec-b3c8-9f6bdeced846',
      version: 1,
      variant: 'RFC 9562 / RFC 4122',
      timestampMs: Date.UTC(2022, 1, 22, 19, 22, 22),
      clockSequence: 0x33c8,
      node: '9f:6b:de:ce:d8:46',
    });
    expect(inspectUuid('1EC9414C-232A-6B00-B3C8-9F6BDECED846').timestampMs).toBe(Date.UTC(2022, 1, 22, 19, 22, 22));
    expect(inspectUuid('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')).toMatchObject({ version: 7, timestampMs: Date.UTC(2022, 1, 22, 19, 22, 22) });
    expect(inspectUuid('{919108f7-52d1-4320-9bac-f847db4148a8}')).toMatchObject({ version: 4, variant: 'RFC 9562 / RFC 4122' });
    expect(inspectUuid('urn:uuid:00000000-0000-0000-0000-000000000000').variant).toBe('Nil UUID');
    expect(inspectUuid('ffffffffffffffffffffffffffffffff').variant).toBe('Max UUID');
    expect(inspectUuid('00000000-0000-0000-c000-000000000046').variant).toBe('Microsoft (reserved)');
    expect(() => inspectUuid('not-a-uuid')).toThrow(/is not a UUID/);
  });

  it('shows the inspection in the tool', async () => {
    const result = await run(uuid, '', { inspect: '017F22E2-79B0-7CC3-98C4-DC0C0C07398F' });
    expect(field(result, 'Version')).toBe('7 — time-ordered (Unix milliseconds + random)');
    expect(field(result, 'Timestamp')).toMatch(/^2022-02-22T19:22:22.000Z {2}\(.* ago\)$/);
    await expect(run(uuid, '', { inspect: 'zzz' })).rejects.toThrow(/not a UUID/);
  });
});

describe('Random words', () => {
  it('honours count, length, case and separators', async () => {
    const words = (await out(randomWords, '', { count: 40, min: 4, max: 6 })).split('\n');
    expect(words).toHaveLength(40);
    for (const word of words) expect(word).toMatch(/^[a-z]{4,6}$/);
    expect(await out(randomWords, '', { count: 3, case: 'upper', separator: 'hyphen' })).toMatch(/^[A-Z]+-[A-Z]+-[A-Z]+$/);
    expect(await out(randomWords, '', { count: 2, case: 'title', separator: 'none' })).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
    for (const word of (await out(randomWords, '', { count: 20, starts: 'th' })).split('\n')) expect(word.startsWith('th')).toBe(true);
    const unique = (await out(randomWords, '', { count: 300, unique: true })).split('\n');
    expect(new Set(unique).size).toBe(300);
    expect((await run(randomWords, '', { count: 4, separator: 'hyphen' })).info).toMatch(/about \d+ bits of entropy/);
  });

  it('explains impossible requests', async () => {
    await expect(run(randomWords, '', { starts: 'zzzz' })).rejects.toThrow(/No words match/);
    await expect(run(randomWords, '', { count: 2000, unique: true, min: 3, max: 3 })).rejects.toThrow(/Only \d+ different words/);
  });
});

describe('Barcodes', () => {
  it('computes GS1 check digits', () => {
    expect(gs1CheckDigit('590123412345')).toBe(7);
    expect(gs1CheckDigit('03600029145')).toBe(2);
    expect(gs1CheckDigit('9638507')).toBe(4);
    expect(gs1CheckDigit('1540014128876')).toBe(3);
    expect(gs1CheckDigit('400638133393')).toBe(1);
  });

  it('renders every symbology as SVG', async () => {
    for (const [type, value] of [
      ['code128', 'BENCHTOP-2026'],
      ['ean13', '590123412345'],
      ['ean13', '5901234123457'],
      ['ean8', '9638507'],
      ['upca', '036000291452'],
      ['code39', 'CODE-39 OK'],
      ['itf14', '15400141288763'],
      ['qrcode', 'https://example.org/?q=ünïcode'],
      ['datamatrix', 'DM-123'],
    ] as const) {
      const result = await run(barcode, '', { type, value });
      expect(result.output).toMatch(/^<svg width="\d+" height="\d+" viewBox="0 0 \d+ \d+" xmlns="http:\/\/www.w3.org\/2000\/svg">/);
      expect(result.preview).toMatchObject({ kind: 'svg', svg: result.output });
      expect(result.filename).toBe(`${type}.svg`);
    }
  });

  it('reports check digits and rejects invalid data clearly', async () => {
    expect(field(await run(barcode, '', { type: 'ean13', value: '590123412345' }), 'Check digit')).toBe('7  → full number 5901234123457');
    expect(field(await run(barcode, '', { type: 'ean13', value: '5901234123457' }), 'Check digit')).toBe('7 is correct');
    await expect(run(barcode, '', { type: 'ean13', value: '5901234123458' })).rejects.toThrow(/last digit should be 7, not 8/);
    await expect(run(barcode, '', { type: 'ean13', value: '12345' })).rejects.toThrow(/EAN-13 must be 12 or 13 digits/);
    await expect(run(barcode, '', { type: 'code39', value: 'lowercase' })).rejects.toThrow(/Code 39 must contain only/);
    await expect(run(barcode, '', { type: 'code128', value: '' })).rejects.toThrow(/Enter the data/);
    await expect(run(barcode, '', { foreground: 'nope' })).rejects.toThrow(/valid CSS colours/);
  });

  it('applies colours and transparency', async () => {
    const coloured = await out(barcode, '', { foreground: '#ff0000', background: '#00ff00' });
    expect(coloured).toMatch(/#ff0000/i);
    expect(coloured).toMatch(/#00ff00/i);
    const transparent = await run(barcode, '', { transparent: true, background: '#00ff00' });
    expect(transparent.output).not.toMatch(/#00ff00/i);
    expect(transparent.preview).toMatchObject({ checker: true });
  });
});

describe('Cron', () => {
  it('explains an expression and lists upcoming runs in a time zone', async () => {
    const result = await run(cron, '', { expression: '30 2 * * 1-5', zone: 'Asia/Kolkata', count: '5' });
    expect(field(result, 'Meaning')).toBe('At 02:30, Monday through Friday');
    expect(field(result, 'Minute')).toBe('30');
    expect(field(result, 'Day of week')).toBe('1-5');
    const lines = (result.output ?? '').split('\n');
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line).toMatch(/^\d{4}-\d{2}-\d{2} 02:30:00 {2}(Mon|Tue|Wed|Thu|Fri) {2}UTC\+05:30 {2}\(in .+\)$/);
    expect(result.info).toBe('Times shown in Asia/Kolkata');
  });

  it('supports shortcuts, 12-hour wording and strict validation', async () => {
    expect(field(await run(cron, '', { expression: '@daily', zone: 'UTC' }), 'Meaning')).toBe('At 00:00');
    expect(field(await run(cron, '', { expression: '0 14 * * *', zone: 'UTC', clock24: false }), 'Meaning')).toBe('At 02:00 PM');
    expect(field(await run(cron, '', { expression: ' */5   *  * * * ', zone: 'UTC' }), 'Meaning')).toBe('Every 5 minutes');
    await expect(run(cron, '', { expression: '* * * *' })).rejects.toThrow(/has 5 fields.*this one has 4/);
    await expect(run(cron, '', { expression: '0 0 * * * *' })).rejects.toThrow(/Quartz/);
    await expect(run(cron, '', { expression: '60 * * * *' })).rejects.toThrow(/Invalid cron expression/);
    await expect(run(cron, '', { expression: '@fortnightly' })).rejects.toThrow(/Unknown shortcut/);
    await expect(run(cron, '', { expression: '' })).rejects.toThrow(/Enter a cron expression/);
  });
});

describe('robots.txt, llms.txt and email links', () => {
  it('builds robots.txt for each policy', async () => {
    expect(await out(robotsTxt, '', { policy: 'allow', sitemaps: '' })).toBe('User-agent: *\nDisallow:\n');
    expect(await out(robotsTxt, '', { policy: 'block', sitemaps: '' })).toBe('User-agent: *\nDisallow: /\n');
    const custom = await run(robotsTxt, '', {
      disallow: '/admin/\nprivate',
      allow: '/admin/help/',
      crawlDelay: 5,
      blockAi: true,
      aiBots: 'GPTBot\nCCBot\n',
      rules: [{ agent: 'Googlebot-Image', disallow: '/photos/', allow: '' }],
      sitemaps: 'https://example.org/sitemap.xml\nsitemap2.xml',
    });
    expect(custom.output).toBe(
      'User-agent: *\nAllow: /admin/help/\nDisallow: /admin/\nDisallow: private\nCrawl-delay: 5\n\n' +
        'User-agent: Googlebot-Image\nDisallow: /photos/\n\n' +
        '# AI crawlers\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\n' +
        'Sitemap: https://example.org/sitemap.xml\nSitemap: sitemap2.xml\n',
    );
    expect(custom.warnings).toHaveLength(3);
    expect(custom.warnings?.join(' ')).toMatch(/"private" should start with "\/"/);
    expect(custom.warnings?.join(' ')).toMatch(/must be an absolute URL/);
    expect((await run(robotsTxt, '', {})).output).toContain('Disallow: /*?sessionid=');
  });

  it('builds llms.txt from links and sitemaps, and validates files', async () => {
    const built = await run(llmsTxt, 'Optional | Changelog | https://e.org/log\nDocs | Start | https://e.org/start | Begin here\n# comment\nDocs | API | https://e.org/api', {
      title: 'Proj',
      summary: 'A summary\nover two lines.',
      details: 'Some notes.',
    });
    expect(built.output).toBe(
      '# Proj\n\n> A summary over two lines.\n\nSome notes.\n\n## Docs\n\n- [Start](https://e.org/start): Begin here\n- [API](https://e.org/api)\n\n## Optional\n\n- [Changelog](https://e.org/log)\n',
    );
    expect(built.warnings).toEqual([]);
    expect(built.info).toBe('3 links in 2 section(s)');
    await expect(run(llmsTxt, 'just one cell')).rejects.toThrow(/Line 1: expected "Section \| Title \| URL/);

    const sitemap =
      '<?xml version="1.0"?><urlset><url><loc>https://e.org/</loc></url><url><loc> https://e.org/docs/getting-started.html </loc></url><url><loc>https://e.org/docs/api?a=1&amp;b=2</loc></url><url><loc>https://e.org/about</loc></url><url><loc>https://e.org/sitemap-2.xml</loc></url></urlset>';
    const fromSitemap = await out(llmsTxt, sitemap, { mode: 'sitemap', title: 'Site', summary: 'S', details: '' });
    expect(fromSitemap).toBe(
      '# Site\n\n> S\n\n## Pages\n\n- [Home](https://e.org/)\n- [About](https://e.org/about)\n\n## Docs\n\n- [Getting started](https://e.org/docs/getting-started.html)\n- [Api](https://e.org/docs/api?a=1&b=2)\n',
    );
    await expect(run(llmsTxt, '<urlset></urlset>', { mode: 'sitemap' })).rejects.toThrow(/No <loc> entries/);

    const valid = await run(llmsTxt, built.output ?? '', { mode: 'validate' });
    expect(field(valid, 'Result')).toBe('Valid llms.txt structure');
    expect(field(valid, 'Links')).toBe('3');
    const broken = await run(llmsTxt, 'Title\n\n## Docs\n- Start https://e.org\n- [Rel](/rel)\n### Deep\n# Second\n', { mode: 'validate' });
    expect(field(broken, 'Result')).toMatch(/issues found/);
    const problems = (broken.warnings ?? []).join('\n');
    expect(problems).toMatch(/must start with an H1/);
    expect(problems).toMatch(/Line 4: list items should look like/);
    expect(problems).toMatch(/Line 5: "\/rel" should be an absolute URL/);
    expect(problems).toMatch(/Line 6: use H2/);
    expect(problems).toMatch(/No summary found/);
  });

  it('builds mailto links per RFC 6068', async () => {
    expect(buildMailto(['a@x.org'], {})).toBe('mailto:a@x.org');
    expect(buildMailto(['a@x.org', 'b+tag@x.org'], { cc: ['c@x.org'], subject: 'Hi & bye?', body: 'Line 1\nLine 2 100%' })).toBe(
      'mailto:a@x.org,b%2Btag@x.org?cc=c@x.org&subject=Hi%20%26%20bye%3F&body=Line%201%0D%0ALine%202%20100%25',
    );
    const html = await run(emailLink, '', { to: 'a@x.org', subject: 'Q', body: '', label: 'Write <us>' });
    expect(html.output).toBe('<a href="mailto:a@x.org?subject=Q">Write &lt;us&gt;</a>');
    expect(field(html, 'mailto URL')).toBe('mailto:a@x.org?subject=Q');
    expect(await out(emailLink, '', { to: 'a@x.org', subject: '', body: '', label: 'x', format: 'url' })).toBe('mailto:a@x.org');
    expect(await out(emailLink, '', { to: 'a@x.org', subject: '', body: '', label: 'a [b]', format: 'markdown' })).toBe('[a \\[b\\]](mailto:a@x.org)');
  });

  it('obfuscates addresses and flags bad input', async () => {
    const obfuscated = await out(emailLink, '', { to: 'a@x.org', subject: '', body: '', label: 'a@x.org', format: 'entities' });
    expect(obfuscated).not.toContain('a@x.org');
    expect(obfuscated).toMatch(/^<a href="(&#x?[0-9a-f]+;)+">(&#x?[0-9a-f]+;)+<\/a>$/);
    const decoded = obfuscated
      .replace(/&#x([0-9a-f]+);/g, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)));
    expect(decoded).toBe('<a href="mailto:a@x.org">a@x.org</a>');
    const script = await run(emailLink, '', { to: 'ada@x.org, bob@x.org', subject: 'S', body: '', label: 'Mail', format: 'script' });
    expect(script.output).toContain('data-mail-user="ada" data-mail-domain="x.org" data-mail-rest=",bob@x.org?subject=S"');
    expect(script.output).not.toContain('ada@x.org');
    expect(script.warnings?.[0]).toMatch(/first recipient only/);
    expect((await run(emailLink, '', { to: 'not-an-address' })).warnings?.[0]).toMatch(/do not look like email addresses: not-an-address/);
    await expect(run(emailLink, '', { to: ' ' })).rejects.toThrow(/at least one recipient/);
  });
});

describe('Text utilities', () => {
  it('converts between naming conventions line by line', async () => {
    const input = 'the quick brown fox\nXMLHttpRequest and parseURL\nuser_first_name\nsome-kebab.value';
    const convert = (style: string) => out(caseConverter, input, { style });
    expect(await convert('camel')).toBe('theQuickBrownFox\nxmlHttpRequestAndParseUrl\nuserFirstName\nsomeKebabValue');
    expect(await convert('pascal')).toBe('TheQuickBrownFox\nXmlHttpRequestAndParseUrl\nUserFirstName\nSomeKebabValue');
    expect(await convert('snake')).toBe('the_quick_brown_fox\nxml_http_request_and_parse_url\nuser_first_name\nsome_kebab_value');
    expect(await convert('constant')).toBe('THE_QUICK_BROWN_FOX\nXML_HTTP_REQUEST_AND_PARSE_URL\nUSER_FIRST_NAME\nSOME_KEBAB_VALUE');
    expect(await convert('kebab')).toBe('the-quick-brown-fox\nxml-http-request-and-parse-url\nuser-first-name\nsome-kebab-value');
    expect(await convert('train')).toBe('The-Quick-Brown-Fox\nXml-Http-Request-And-Parse-Url\nUser-First-Name\nSome-Kebab-Value');
    expect(await convert('dot')).toMatch(/^the\.quick\.brown\.fox\n/);
    expect(await convert('path')).toMatch(/^the\/quick\/brown\/fox\n/);
    expect(await convert('cobol')).toMatch(/^THE-QUICK-BROWN-FOX\n/);
  });

  it('handles prose cases and non-ASCII letters', async () => {
    expect(await out(caseConverter, 'a tale of two cities and the war of the worlds', { style: 'title' })).toBe('A Tale of Two Cities and the War of the Worlds');
    expect(await out(caseConverter, 'what is it for', { style: 'title' })).toBe('What Is It For');
    expect(await out(caseConverter, 'hELLO wORLD. this is FINE! ok?  yes', { style: 'sentence' })).toBe('Hello world. This is fine! Ok?  Yes');
    expect(await out(caseConverter, 'Hello World', { style: 'alternating' })).toBe('hElLo WoRlD');
    expect(await out(caseConverter, 'Hello World', { style: 'inverse' })).toBe('hELLO wORLD');
    expect(await out(caseConverter, 'école supérieure über', { style: 'pascal' })).toBe('ÉcoleSupérieureÜber');
    expect(await out(caseConverter, 'version2Update 3d model', { style: 'snake' })).toBe('version2_update_3d_model');
    expect(await out(caseConverter, 'Straße', { style: 'upper' })).toBe('STRASSE');
  });

  it('removes duplicate lines with every keep mode', async () => {
    const input = 'b\na\nB\na\n\n c \nc\n\nd';
    expect(await out(dedupeLines, input)).toBe('b\na\nB\n\n c \nc\nd');
    expect(await out(dedupeLines, input, { ignoreCase: true, trim: true, dropEmpty: true })).toBe('b\na\n c \nd');
    expect(await out(dedupeLines, input, { keep: 'last', ignoreCase: true })).toBe('B\na\n c \nc\n\nd');
    expect(await out(dedupeLines, input, { keep: 'unique' })).toBe('b\nB\n c \nc\nd');
    expect(await out(dedupeLines, input, { keep: 'duplicates' })).toBe('a\n');
    expect(await out(dedupeLines, 'b10\nb2\na\nb2', { sort: 'asc' })).toBe('a\nb2\nb10');
    expect(await out(dedupeLines, 'b\na\nc', { sort: 'desc' })).toBe('c\nb\na');
    expect((await run(dedupeLines, 'a\na\nb')).info).toBe('3 lines in, 2 lines out (1 line removed)');
    expect(await out(dedupeLines, 'a\r\na\r\nb')).toBe('a\nb');
  });

  it('removes line breaks in each mode', async () => {
    const input = 'one\ntwo  two\r\n\r\n\nthree\nfour\n';
    expect(await out(removeLineBreaks, input)).toBe('one two two\n\nthree four');
    expect(await out(removeLineBreaks, input, { mode: 'space' })).toBe('one two two three four');
    expect(await out(removeLineBreaks, 'a\nb\nc', { mode: 'remove' })).toBe('abc');
    expect(await out(removeLineBreaks, 'a\nb\nc', { mode: 'custom', replacement: ', ' })).toBe('a, b, c');
    expect(await out(removeLineBreaks, 'a  b\nc', { mode: 'space', collapse: false })).toBe('a  b c');
    expect(await out(removeLineBreaks, 'infor-\nmation and a well-\nKnown name', { mode: 'space', dehyphenate: true })).toBe('information and a well- Known name');
    expect((await run(removeLineBreaks, 'a\nb\n\nc')).info).toBe('1 line break removed');
  });

  it('reverses text without breaking emoji or accents', async () => {
    expect(await out(textReverser, 'Hello, World!')).toBe('!dlroW ,olleH');
    expect(await out(textReverser, 'ab\ncd')).toBe('ba\ndc');
    expect(await out(textReverser, 'ab\ncd', { perLine: false })).toBe('dc\nba');
    expect(await out(textReverser, 'a👋🏽b éx 🇮🇳')).toBe('🇮🇳 xé b👋🏽a');
    expect(await out(textReverser, 'one two  three', { mode: 'words' })).toBe('three  two one');
    expect(await out(textReverser, 'one two\nthree four', { mode: 'words', perLine: false })).toBe('four three\ntwo one');
    expect(await out(textReverser, 'one two  three', { mode: 'each' })).toBe('eno owt  eerht');
    expect(await out(textReverser, 'a\nb\nc', { mode: 'lines' })).toBe('c\nb\na');
  });
});

describe('Diff', () => {
  const before = 'one\ntwo\nthree\nfour\n';
  const after = 'one\n2\nthree\nfour\nfive\n';

  it('builds line rows with numbers and intra-line highlights', async () => {
    const result = await run(diff, before, {}, { input2: after });
    expect(result.info).toBe('2 lines added, 1 removed');
    if (result.preview?.kind !== 'diff') throw new Error('expected a diff preview');
    expect(result.preview.rows.map((row) => `${row.type}:${row.left ?? '-'}:${row.right ?? '-'}:${row.text}`)).toEqual([
      'same:1:1:one',
      'del:2:-:two',
      'add:-:2:2',
      'same:3:3:three',
      'same:4:4:four',
      'add:-:5:five',
    ]);
    expect(result.output).toContain('--- original');
    expect(result.output).toContain('+++ changed');
    expect(result.output).toContain('-two\n+2\n');
    expect(result.output).toContain('+five');
    expect(result.filename).toBe('changes.patch');
  });

  it('highlights the words that changed inside a line', async () => {
    const result = await run(diff, 'const total = price * quantity;\n', {}, { input2: 'const total = price * amount;\n' });
    if (result.preview?.kind !== 'diff') throw new Error('expected a diff preview');
    const [removed, added] = result.preview.rows;
    expect(removed).toMatchObject({ type: 'del', text: 'const total = price * quantity;' });
    expect(removed?.spans?.map(([start, end]) => removed.text.slice(start, end))).toEqual(['quantity']);
    expect(added?.spans?.map(([start, end]) => added.text.slice(start, end))).toEqual(['amount']);
  });

  it('respects the comparison options and shows original text', async () => {
    const result = await run(diff, 'Hello\n  indented\n', { ignoreCase: true, ignoreWhitespace: true }, { input2: 'HELLO\nindented\n' });
    expect(result.info).toBe('No differences with the current options');
    if (result.preview?.kind !== 'diff') throw new Error('expected a diff preview');
    expect(result.preview.rows.map((row) => row.type)).toEqual(['same', 'same']);
    expect(result.preview.rows[0]?.text).toBe('HELLO');
    expect((await run(diff, 'same\n', {}, { input2: 'same' })).info).toBe('The texts are identical');
    expect((await run(diff, 'a\r\nb\r\n', {}, { input2: 'a\nb\n' })).info).toBe('The texts are identical');
    expect((await run(diff, '', {}, { input2: '' })).info).toBe('The texts are identical');
    expect((await run(diff, '', {}, { input2: 'new\n' })).info).toBe('1 line added, 0 removed');
  });

  it('offers word and character views as inline markup', async () => {
    const words = await run(diff, 'the quick <b> fox', { mode: 'words' }, { input2: 'the slow <b> fox' });
    expect(words.preview).toEqual({ kind: 'html', html: '<pre class="inline-diff">the <del>quick</del><ins>slow</ins> &lt;b&gt; fox</pre>' });
    expect(words.info).toBe('1 word run added, 1 removed');
    const chars = await run(diff, 'cat', { mode: 'chars' }, { input2: 'cut' });
    expect(chars.preview).toEqual({ kind: 'html', html: '<pre class="inline-diff">c<del>a</del><ins>u</ins>t</pre>' });
    expect((await run(diff, 'ABC', { mode: 'chars', ignoreCase: true }, { input2: 'abc' })).info).toBe('The texts are identical');
  });
});

describe('Colour', () => {
  it('parses every common notation', () => {
    expect(toRgba('#3b82f6')).toEqual({ r: 59, g: 130, b: 246, a: 1 });
    expect(toRgba('3b82f6')).toEqual({ r: 59, g: 130, b: 246, a: 1 });
    expect(toRgba('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(toRgba('rgb(59 130 246 / 50%)')).toEqual({ r: 59, g: 130, b: 246, a: 0.5 });
    expect(toRgba('rgba(59, 130, 246, 0.25)')).toEqual({ r: 59, g: 130, b: 246, a: 0.25 });
    expect(toRgba('hsl(0 100% 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(toRgba('rebeccapurple')).toEqual({ r: 102, g: 51, b: 153, a: 1 });
    expect(hexOf('oklch(62.8% 0.2577 29.23)')).toBe('#ff0000');
    expect(hexOf('transparent')).toBe('#000000');
    expect(parseColor('nope')).toBeUndefined();
    expect(parseColor('')).toBeUndefined();
    expect(parseColor('12345')).toBeUndefined();
  });

  it('describes a colour in every space', () => {
    expect(describeColor('#ff0000')).toMatchObject({
      hex: '#ff0000',
      rgb: 'rgb(255 0 0)',
      hsl: 'hsl(0 100% 50%)',
      hwb: 'hwb(0 0% 0%)',
      oklch: 'oklch(62.8% 0.2577 29.23)',
      inSrgb: true,
      inP3: true,
      alpha: 1,
    });
    expect(describeColor('#ffffff')).toMatchObject({ oklch: 'oklch(100% 0 0)', lab: 'lab(100% 0 0)' });
    expect(describeColor('rgb(0 128 0 / 0.5)')).toMatchObject({ hex: '#00800080', rgb: 'rgb(0 128 0 / 0.5)' });
    const wide = describeColor('oklch(70% 0.3 150)');
    expect(wide?.inSrgb).toBe(false);
    expect(wide?.oklch).toBe('oklch(70% 0.3 150)');
    expect(wide?.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(describeColor('color(display-p3 1 0 0)')).toMatchObject({ inSrgb: false, inP3: true });
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.478, 2);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('converts a colour in the tool and finds the nearest Tailwind colour', async () => {
    const result = await run(colorConverter, '', { color: '#ef4444' });
    expect(field(result, 'HEX')).toBe('#ef4444');
    expect(field(result, 'RGB')).toBe('rgb(239 68 68)');
    expect(field(result, 'sRGB gamut')).toMatch(/^Inside sRGB/);
    expect(result.fields?.[0]?.swatch).toBe('#ef4444');
    expect(tailwindPalette().length).toBeGreaterThanOrEqual(22 * 11);
    const blue = tailwindPalette().find(([name]) => name === 'blue-500');
    expect(blue).toBeDefined();
    expect(nearestTailwind(blue?.[1] ?? '')).toMatchObject({ name: 'blue-500' });
    expect(nearestTailwind(blue?.[1] ?? '').distance).toBeLessThan(0.001);
    expect(field(await run(colorConverter, '', { color: 'oklch(70% 0.3 150)' }), 'sRGB gamut')).toMatch(/^Outside sRGB/);
    await expect(run(colorConverter, '', { color: 'blurple' })).rejects.toThrow(/not a colour/);
  });

  it('generates a monotonic shade scale that contains the input colour', () => {
    for (const base of ['#6366f1', '#ef4444', '#16a34a', '#fde68a', '#0f172a', '#808080', '#ffffff', '#000000']) {
      const shades = generateShades(base);
      expect(shades.map((shade) => shade.step)).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);
      expect(shades.filter((shade) => shade.base)).toHaveLength(1);
      expect(shades.find((shade) => shade.base)?.hex).toBe(hexOf(base));
      for (let i = 1; i < shades.length; i++) {
        expect((shades[i]?.l ?? 0) < (shades[i - 1]?.l ?? 0), `${base} step ${shades[i]?.step} must be darker`).toBe(true);
      }
      for (const shade of shades) expect(shade.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(shades[0]?.hex ?? '', shades[10]?.hex ?? '')).toBeGreaterThan(7);
    }
    expect(() => generateShades('nope')).toThrow(/not a colour/);
  });

  it('exports shades in every format', async () => {
    const css = await run(colorShades, '', { color: '#6366f1', name: 'Brand Colour' });
    expect(css.output).toMatch(/^:root \{\n {2}--brand-colour-50: #[0-9a-f]{6};\n/);
    expect(css.output).toMatch(/--brand-colour-\d+: #6366f1;/);
    expect(css.fields).toHaveLength(11);
    expect(css.fields?.find((item) => item.label.includes('your colour'))?.swatch).toBe('#6366f1');
    expect(await out(colorShades, '', { format: 'tailwind4', notation: 'oklch' })).toMatch(/^@theme \{\n {2}--color-brand-50: oklch\(\d+(\.\d)?% [\d.]+ [\d.]+\);/);
    const config = await run(colorShades, '', { format: 'tailwind3' });
    expect(config.output).toContain("brand: {\n          50: '#");
    expect(config.language).toBe('javascript');
    expect(await out(colorShades, '', { format: 'scss', notation: 'rgb' })).toMatch(/^\$brand: \(\n {2}50: rgb\(\d+ \d+ \d+\),/);
    const json = JSON.parse(await out(colorShades, '', { format: 'json' }));
    expect(Object.keys(json.brand)).toHaveLength(11);
    expect(Object.values(json.brand)).toContainEqual({ $type: 'color', $value: '#6366f1' });
    await expect(run(colorShades, '', { name: '  ' })).rejects.toThrow(/Give the scale a name/);
  });

  it('checks contrast and suggests passing colours', async () => {
    const pass = await run(contrastChecker, '', { foreground: '#000000', background: '#ffffff' });
    expect(field(pass, 'Contrast ratio')).toBe('21.00:1');
    expect(pass.fields?.filter((item) => item.tone === 'bad')).toHaveLength(0);
    expect(pass.fields).toHaveLength(6);
    const fail = await run(contrastChecker, '', { foreground: '#9ca3af', background: '#ffffff' });
    expect(field(fail, 'AA — normal text')).toBe('Fail (needs 4.5:1)');
    const aa = field(fail, 'Nearest text colour that passes AA');
    const aaa = field(fail, 'Nearest text colour that passes AAA');
    expect(contrastRatio(aa.slice(0, 7), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(aa.slice(0, 7), '#ffffff')).toBeLessThan(4.7);
    expect(contrastRatio(aaa.slice(0, 7), '#ffffff')).toBeGreaterThanOrEqual(7);
    expect(fail.preview?.kind).toBe('html');
    const translucent = await run(contrastChecker, '', { foreground: 'rgb(0 0 0 / 50%)', background: '#ffffff', sample: '<b>&' });
    expect(field(translucent, 'Contrast ratio')).toBe('3.95:1');
    expect(translucent.info).toMatch(/blends to #808080/);
    if (translucent.preview?.kind !== 'html') throw new Error('expected html');
    expect(translucent.preview.html).toContain('&lt;b&gt;&amp;');
    await expect(run(contrastChecker, '', { foreground: 'x' })).rejects.toThrow(/not a valid text colour/);
  });

  it('generates an accessible shadcn/ui theme', async () => {
    const result = await run(shadcnTheme, '', { color: '#2563eb' });
    const css = result.output ?? '';
    expect(css).toContain('@import "tailwindcss";');
    expect(css).toMatch(/:root \{\n {2}--radius: 0\.625rem;\n {2}--background: oklch\(1 0 0\);/);
    expect(css).toContain('.dark {\n  --background: oklch(0.145 ');
    expect(css).toContain('@theme inline {\n  --color-background: var(--background);');
    expect(css).toContain('--radius-xl: calc(var(--radius) + 4px);');
    for (const token of ['primary', 'primary-foreground', 'muted-foreground', 'destructive', 'border', 'ring', 'chart-5', 'sidebar-ring']) {
      expect(css.match(new RegExp(`--${token}: oklch\\(`, 'g'))).toHaveLength(2);
    }
    expect(result.fields).toHaveLength(6);
    expect(result.fields?.every((item) => item.tone === 'ok')).toBe(true);
    expect(result.preview?.kind).toBe('html');
  });

  it('keeps theme text readable for difficult primary colours', async () => {
    for (const color of ['#facc15', '#22c55e', '#f97316', '#000000', '#ffffff', '#808080', '#7c3aed']) {
      const result = await run(shadcnTheme, '', { color, tint: 'strong', radius: 0 });
      expect(
        result.fields?.every((item) => item.tone === 'ok'),
        `theme for ${color}`,
      ).toBe(true);
      expect(result.output).toContain('--radius: 0rem;');
    }
    await expect(run(shadcnTheme, '', { color: 'x' })).rejects.toThrow(/not a colour/);
  });
});

describe('CSS to Tailwind', () => {
  const classes = (css: string, options = { snapColors: false }) => cssToTailwind(css, options).groups;
  const one = (declaration: string) => classes(`.a { ${declaration} }`)[0]?.classes.join(' ');

  it('splits values at the top level only', () => {
    expect(splitTop('1px solid rgba(0, 0, 0, 0.5)')).toEqual(['1px', 'solid', 'rgba(0, 0, 0, 0.5)']);
    expect(splitTop('a, fn(b, c), "d, e"', ',')).toEqual(['a', 'fn(b, c)', '"d, e"']);
  });

  it.each([
    ['display: flex', 'flex'],
    ['display: none', 'hidden'],
    ['position: absolute; inset: 0', 'absolute inset-0'],
    ['margin: 0 auto', 'my-0 mx-auto'],
    ['margin: -8px', '-m-2'],
    ['padding: 4px 8px 12px 16px', 'pt-1 pr-2 pb-3 pl-4'],
    ['padding: 1rem', 'p-4'],
    ['padding: 13.5px', 'p-[13.5px]'],
    ['margin-top: 1px', 'mt-px'],
    ['width: 100%; height: 100vh', 'w-full h-screen'],
    ['width: 33.3333%', 'w-1/3'],
    ['max-width: none; min-width: min-content', 'max-w-none min-w-min'],
    ['gap: 8px 16px', 'gap-y-2 gap-x-4'],
    ['flex: 1 1 0%', 'flex-1'],
    ['flex-direction: column; justify-content: space-between; align-items: flex-start', 'flex-col justify-between items-start'],
    ['grid-template-columns: repeat(3, minmax(0, 1fr))', 'grid-cols-3'],
    ['grid-template-columns: 200px 1fr', 'grid-cols-[200px_1fr]'],
    ['grid-column: span 2 / span 2', 'col-span-2'],
    ['color: #fff', 'text-white'],
    ['color: var(--brand)', 'text-[color:var(--brand)]'],
    ['background-color: rgba(0, 0, 0, 0.5)', 'bg-black/50'],
    ['background-color: transparent', 'bg-transparent'],
    ['border: 1px solid #000', 'border border-black'],
    ['border: 2px dashed currentColor', 'border-2 border-dashed border-current'],
    ['border: none', 'border-none'],
    ['border-bottom: 4px solid #fff', 'border-b-4 border-b-white'],
    ['border-radius: 8px', 'rounded-lg'],
    ['border-radius: 9999px', 'rounded-full'],
    ['border-radius: 5px', 'rounded-[5px]'],
    ['border-radius: 4px 8px', 'rounded-[4px_8px]'],
    ['opacity: 0.5', 'opacity-50'],
    ['opacity: .333', 'opacity-[.333]'],
    ['z-index: 10', 'z-10'],
    ['z-index: -1', '-z-1'],
    ['font-size: 14px', 'text-[14px]'],
    ['font-size: 14px; line-height: 20px', 'text-sm leading-5'],
    ['font-weight: 700; font-style: italic', 'font-bold italic'],
    ['line-height: 1.5', 'leading-normal'],
    ['letter-spacing: -0.025em', 'tracking-tight'],
    ['text-align: center; text-transform: uppercase; text-decoration: underline', 'text-center uppercase underline'],
    ['white-space: nowrap; overflow: hidden; text-overflow: ellipsis', 'whitespace-nowrap overflow-hidden text-ellipsis'],
    ['cursor: pointer; user-select: none; pointer-events: none', 'cursor-pointer select-none pointer-events-none'],
    ['box-shadow: 0 1px 2px rgba(0,0,0,.05)', 'shadow-[0_1px_2px_rgba(0,0,0,.05)]'],
    ['transform: rotate(45deg)', 'rotate-45'],
    ['transform: translate(-50%, -50%)', '-translate-x-1/2 -translate-y-1/2'],
    ['transform: scale(1.05)', 'scale-105'],
    ['transform: rotate(45deg) scale(2)', '[transform:rotate(45deg)_scale(2)]'],
    ['transition-duration: .3s; transition-timing-function: ease-in-out', 'duration-300 ease-in-out'],
    ['aspect-ratio: 16 / 9', 'aspect-video'],
    ['object-fit: cover', 'object-cover'],
    ['--gap: 4px', '[--gap:4px]'],
    ['mask-type: luminance', '[mask-type:luminance]'],
    ['color: red !important', 'text-[red]!'],
    ['content: ""', 'content-[""]'],
    ['font-family: Inter, sans-serif', '[font-family:Inter,sans-serif]'],
    ['background-image: url("my_file.png")', 'bg-[url(my\\_file.png)]'],
  ])('%s -> %s', (declaration, expected) => {
    expect(one(declaration)).toBe(expected);
  });

  it('names palette colours exactly, or by proximity when asked', () => {
    const [name, hex] = tailwindPalette().find(([candidate]) => candidate === 'red-500') ?? ['', ''];
    expect(one(`color: ${hex}`)).toBe(`text-${name}`);
    expect(one('color: #ef4444')).toBe('text-[#ef4444]');
    expect(classes('.a { color: #ef4444 }', { snapColors: true })[0]?.classes).toEqual(['text-red-500']);
    expect(classes('.a { color: #00ff00 }', { snapColors: true })[0]?.classes).toEqual(['text-[#00ff00]']);
  });

  it('maps selectors and media queries to variants', () => {
    expect(analyzeSelector('.btn')).toEqual({ host: '.btn', variants: [] });
    expect(analyzeSelector('.btn:hover')).toEqual({ host: '.btn', variants: ['hover'] });
    expect(analyzeSelector('.btn:focus-visible::after')).toEqual({ host: '.btn', variants: ['focus-visible', 'after'] });
    expect(analyzeSelector('li:nth-child(odd)')).toEqual({ host: 'li', variants: ['odd'] });
    expect(analyzeSelector('.card > p')).toEqual({ host: '.card', variants: ['[&>p]'] });
    expect(analyzeSelector('.card .title:hover')).toEqual({ host: '.card', variants: ['[&_.title:hover]'] });
    expect(analyzeSelector('.btn.primary')).toEqual({ host: '.btn', variants: ['[&.primary]'] });
    expect(analyzeSelector('a:not(.x)')).toEqual({ host: 'a', variants: ['[&:not(.x)]'] });
    expect(mediaVariants('(min-width:768px)')).toEqual(['md']);
    expect(mediaVariants('screen and (min-width: 1024px)')).toEqual(['lg']);
    expect(mediaVariants('(min-width:900px)')).toEqual(['min-[900px]']);
    expect(mediaVariants('(max-width:639px)')).toEqual(['max-[639px]']);
    expect(mediaVariants('(width >= 48rem)')).toEqual(['md']);
    expect(mediaVariants('(prefers-color-scheme: dark)')).toEqual(['dark']);
    expect(mediaVariants('print')).toEqual(['print']);
    expect(mediaVariants('(min-width:640px) and (prefers-reduced-motion:reduce)')).toEqual(['sm', 'motion-reduce']);
    expect(mediaVariants('(max-width:500px),print')).toEqual(['[@media(max-width:500px),print]']);
  });

  it('groups a stylesheet by element and prefixes variants', async () => {
    const css = `.card { display: flex; padding: 1rem }
.card:hover { opacity: .9 }
.card > .title { font-weight: 600 }
@media (min-width: 768px) { .card { padding: 2rem } .card:hover { opacity: 1 } }
@supports (display: grid) { .grid { display: grid } }
.nest { color: #000; &:focus { color: #fff } }
@keyframes spin { to { transform: rotate(360deg) } }`;
    const result = await run(cssToTailwindTool, css);
    expect(result.output).toBe(
      '/* .card */\nflex p-4 hover:opacity-90 [&>.title]:font-semibold md:p-8 md:hover:opacity-100\n\n' + '/* .grid */\nsupports-[display:grid]:grid\n\n/* .nest */\ntext-black focus:text-white\n',
    );
    expect(result.warnings).toEqual(['Not convertible to utilities (keep these in your CSS): @keyframes spin']);
    expect(result.info).toBe('9 declarations → 3 selectors · 0 written as arbitrary values');
    expect(await out(cssToTailwindTool, '.a, .b { margin: 0 }', { format: 'apply' })).toBe('.a {\n  @apply m-0;\n}\n\n.b {\n  @apply m-0;\n}\n');
    expect(await out(cssToTailwindTool, '.a { content: "x" }', { format: 'html' })).toBe('<!-- .a -->\nclass="content-[\'x\']"\n');
    await expect(run(cssToTailwindTool, 'not css at all')).rejects.toThrow();
    await expect(run(cssToTailwindTool, '@keyframes x { to { opacity: 1 } }')).rejects.toThrow(/No CSS rules/);
  });
});

describe('Business calculators', () => {
  it('computes card fees and the charge needed for a target payout', async () => {
    expect(feeOn({ amount: 10000, percent: 2.9, fixed: 30 })).toBe(320);
    expect(chargeFor({ amount: 10000, percent: 2.9, fixed: 30 })).toBe(10330);
    for (const amount of [1, 50, 99, 1000, 12345, 999999]) {
      for (const [percent, fixed] of [
        [2.9, 30],
        [1.5, 0],
        [0, 25],
        [3.4, 35],
      ] as const) {
        const charge = chargeFor({ amount, percent, fixed });
        expect(charge - feeOn({ amount: charge, percent, fixed })).toBeGreaterThanOrEqual(amount);
        expect(charge - 1 - feeOn({ amount: charge - 1, percent, fixed })).toBeLessThan(amount);
      }
    }
    const result = await run(paymentFee, '', { amount: 100 });
    expect(field(result, 'Processing fee')).toBe('3.20');
    expect(field(result, 'Charge the customer')).toBe('103.30');
    expect(field(result, 'Effective rate')).toBe('3.20%');
    expect(result.fields?.filter((item) => item.label === 'You receive').map((item) => item.value)).toEqual(['96.80', '100.00']);
    expect(field(await run(paymentFee, '', { amount: 100, surcharge: 1.5 }), 'Processing fee')).toBe('4.70');
  });

  it('computes CAC, payback and LTV:CAC', async () => {
    const result = await run(cacCalculator, '', { marketing: 20000, sales: 15000, overhead: 10000, customers: 90, revenue: 120, margin: 80, churn: 3 });
    expect(field(result, 'Fully loaded CAC')).toBe('500.00');
    expect(field(result, 'Paid-only CAC')).toBe('222.22');
    expect(field(result, 'CAC payback period')).toMatch(/^5\.2 months/);
    expect(field(result, 'Lifetime value')).toBe('3,200.00');
    expect(field(result, 'LTV : CAC')).toMatch(/^6\.40 : 1/);
    const weak = await run(cacCalculator, '', { marketing: 90000, sales: 0, overhead: 0, customers: 90, revenue: 50, margin: 50, churn: 10 });
    expect(weak.fields?.find((item) => item.label === 'LTV : CAC')?.tone).toBe('bad');
    expect(weak.fields?.find((item) => item.label === 'CAC payback period')?.tone).toBe('bad');
    expect(field(await run(cacCalculator, '', { churn: 0 }), 'LTV : CAC')).toMatch(/Enter a churn rate/);
    await expect(run(cacCalculator, '', { customers: 0 })).rejects.toThrow(/more than zero/);
  });
});
