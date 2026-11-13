import { describe, expect, it } from 'vitest';
import { curlToFetch, parseCurl, tokenizeShell } from '../../src/lib/curl';
import { formatInZone, parseInstant, zonedToEpoch, zoneOffsetMinutes } from '../../src/lib/datetime';
import { amountToCheque, amountToWords, CURRENCIES, integerToWords, numberToOrdinal, numberToWords, parseNumber } from '../../src/lib/number-words';
import { formatWithPrettier } from '../../src/lib/prettier';
import { applyEdits, parseXml, readSvg, svgIntrinsicSize, svgLength } from '../../src/lib/xml-scan';
import androidPixels from '../../src/tools/text/android-pixel-calculator';
import baseConverter from '../../src/tools/text/base-converter';
import binaryCalculator from '../../src/tools/text/binary-calculator';
import csvToJson from '../../src/tools/text/csv-to-json';
import curlToFetchTool from '../../src/tools/text/curl-to-fetch';
import htmlToMarkdown from '../../src/tools/text/html-to-markdown';
import jsonToCsv from '../../src/tools/text/json-to-csv';
import jsonToTypescript from '../../src/tools/text/json-to-typescript';
import markdownToHtml from '../../src/tools/text/markdown-to-html';
import numberToWordsTool from '../../src/tools/text/number-to-words';
import pxRem from '../../src/tools/text/px-rem';
import svgBackgroundRemover from '../../src/tools/text/svg-background-remover';
import { SVG_SAMPLE } from '../../src/tools/text/svg-minifier';
import svgToReact from '../../src/tools/text/svg-to-react';
import svgViewer from '../../src/tools/text/svg-viewer';
import unixTimestamp from '../../src/tools/text/unix-timestamp';
import yamlJson from '../../src/tools/text/yaml-json';
import { field, out, run } from './helpers';

describe('CSV to JSON', () => {
  it('parses quoted, escaped and multi-line fields', async () => {
    const csv = 'id,name,note\n1,"Smith, Jane","said ""hi"""\n2,Bob,"line one\nline two"\n';
    expect(JSON.parse(await out(csvToJson, csv))).toEqual([
      { id: 1, name: 'Smith, Jane', note: 'said "hi"' },
      { id: 2, name: 'Bob', note: 'line one\nline two' },
    ]);
  });

  it('respects typing, header, trim and delimiter options', async () => {
    expect(JSON.parse(await out(csvToJson, 'a,b\n1,true\n', { typed: false }))).toEqual([{ a: '1', b: 'true' }]);
    expect(JSON.parse(await out(csvToJson, 'a,b\n1,2\n', { header: false }))).toEqual([
      ['a', 'b'],
      [1, 2],
    ]);
    expect(JSON.parse(await out(csvToJson, ' a , b \n x , y \n', { trim: true }))).toEqual([{ a: 'x', b: 'y' }]);
    expect(JSON.parse(await out(csvToJson, 'a;b\n1,5;2\n'))).toEqual([{ a: '1,5', b: 2 }]);
    expect(JSON.parse(await out(csvToJson, 'a\tb\n1\t2\n'))).toEqual([{ a: 1, b: 2 }]);
    expect(JSON.parse(await out(csvToJson, 'a|b\n1|2\n', { delimiter: '|' }))).toEqual([{ a: 1, b: 2 }]);
    expect(JSON.parse(await out(csvToJson, '\ufeffa,b\n1,2\n\n\n'))).toEqual([{ a: 1, b: 2 }]);
  });

  it('reports structure problems', async () => {
    const result = await run(csvToJson, 'a,b\n1,2,3\n4\n');
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings?.[0]).toMatch(/^Row 2: /);
    expect(result.info).toBe('2 rows \u00d7 2 columns \u00b7 comma-separated');
    await expect(run(csvToJson, 'a,b\n"unterminated,2\n')).rejects.toThrow(/Quote/i);
  });
});

describe('JSON to CSV', () => {
  it('flattens nested objects and unions the columns', async () => {
    const json = '[{"id":1,"a":{"b":{"c":"x"}},"tags":["p","q"]},{"id":2,"extra":true,"a":{"d":null}}]';
    expect(await out(jsonToCsv, json)).toBe('id,a.b.c,tags,extra,a.d\n1,x,p; q,,\n2,,,true,');
    expect(await out(jsonToCsv, json, { arrays: 'json' })).toContain('1,x,"[""p"",""q""]",,');
    expect(await out(jsonToCsv, json, { arrays: 'index' })).toBe('id,a.b.c,tags.0,tags.1,extra,a.d\n1,x,p,q,,\n2,,,,true,');
  });

  it('quotes only when needed and round-trips through the CSV parser', async () => {
    const rows = [
      { name: 'Smith, Jane', quote: 'said "hi"', multi: 'a\nb', plain: 'x', n: 1.5 },
      { name: ' padded ', quote: '', multi: '', plain: 'y', n: 0 },
    ];
    const csv = await out(jsonToCsv, JSON.stringify(rows));
    expect(csv.split('\n')[0]).toBe('name,quote,multi,plain,n');
    expect(csv).toContain('"Smith, Jane","said ""hi""","a\nb",x,1.5');
    // With type detection on, empty cells come back as null.
    expect(JSON.parse(await out(csvToJson, csv))).toEqual([rows[0], { ...rows[1], quote: null, multi: null }]);
    expect(JSON.parse(await out(csvToJson, csv, { typed: false }))).toEqual(rows.map((row) => ({ ...row, n: String(row.n) })));
  });

  it('handles other shapes and output options', async () => {
    expect(await out(jsonToCsv, '[[1,"a"],[2,"b,c"]]')).toBe('1,a\n2,"b,c"');
    expect(await out(jsonToCsv, '{"a":1,"b":{"c":2}}')).toBe('a,b.c\n1,2');
    expect(await out(jsonToCsv, '[1,"x",null]')).toBe('value\n1\nx\n');
    expect(await out(jsonToCsv, '[{"a":1,"b":2}]', { delimiter: ';', header: false })).toBe('1;2');
    expect(await out(jsonToCsv, '[{"a":1}]', { quoteAll: true })).toBe('"a"\n"1"');
    expect(await out(jsonToCsv, '[{"a":"=SUM(A1)","b":"-5"}]', { safe: true })).toBe('a,b\n"\'=SUM(A1)","\'-5"');
    expect(await out(jsonToCsv, '[{"a":1},{"a":2}]', { bom: true })).toBe('\ufeffa\r\n1\r\n2');
    await expect(run(jsonToCsv, '[]')).rejects.toThrow(/empty/);
    await expect(run(jsonToCsv, '[{"a":1},]')).rejects.toThrow(/Trailing comma/);
  });
});

describe('JSON to TypeScript', () => {
  it('infers interfaces, optional keys, unions and shared shapes', async () => {
    const json = JSON.stringify({
      id: 1,
      name: 'x',
      email: null,
      tags: ['a'],
      empty: [],
      mixed: [1, 'a', null],
      owner: { id: 1, name: 'o' },
      editor: { id: 2, name: 'e' },
      items: [
        { sku: 'a', price: 1, meta: { w: 1 } },
        { sku: 'b', price: null, extra: true },
      ],
      'weird-key': {},
    });
    expect(await out(jsonToTypescript, json)).toBe(
      [
        'export interface Root {',
        '  id: number;',
        '  name: string;',
        '  email: null;',
        '  tags: string[];',
        '  empty: unknown[];',
        '  mixed: (number | string | null)[];',
        '  owner: Owner;',
        '  editor: Owner;',
        '  items: Item[];',
        '  "weird-key": Record<string, unknown>;',
        '}',
        '',
        'export interface Owner {',
        '  id: number;',
        '  name: string;',
        '}',
        '',
        'export interface Item {',
        '  sku: string;',
        '  price: number | null;',
        '  meta?: Meta;',
        '  extra?: boolean;',
        '}',
        '',
        'export interface Meta {',
        '  w: number;',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('supports type aliases, option switches and non-object roots', async () => {
    expect(await out(jsonToTypescript, '{"a":1,"b":[{"c":null},{"c":"x"}]}', { style: 'type', exportTypes: false, nullAsOptional: true, indent: '4', rootName: 'api response' })).toBe(
      'type ApiResponse = {\n    a: number;\n    b: BItem[];\n};\n\ntype BItem = {\n    c?: string;\n};\n',
    );
    expect(await out(jsonToTypescript, '[{"a":1},{"a":2,"b":"x"}]')).toBe('export type Root = RootItem[];\n\nexport interface RootItem {\n  a: number;\n  b?: string;\n}\n');
    expect(await out(jsonToTypescript, '"text"')).toBe('export type Root = string;\n');
    expect(await out(jsonToTypescript, '[[1,2],[3]]')).toBe('export type Root = number[][];\n');
    expect(await out(jsonToTypescript, '{"categories":[{"n":1}],"boxes":[{"m":1}],"class":{"n":"s"},"data":[{"z":1}]}')).toContain(
      'categories: Category[];\n  boxes: Box[];\n  class: Class;\n  data: DataItem[];',
    );
  });

  it('emits TypeScript that actually parses', async () => {
    const tricky = '{"1st":1,"a b":{"$ok":true,"class":[{"x-y":1},{"x-y":"s","z":[[]]}]},"Root":{"Root":{"q":1}}}';
    const code = await out(jsonToTypescript, tricky);
    await expect(formatWithPrettier(code, 'typescript')).resolves.toContain('interface');
    expect(code).toContain('"1st": number;');
    expect(code).toContain('Root: Root2;');
  });
});

describe('YAML and JSON', () => {
  it('converts YAML to JSON using the 1.2 core schema', async () => {
    const yaml = 'a: 1\nb: [x, y]\nc:\n  d: true\n  e: ~\nf: "007"\ng: yes\nh: 0o17\ni: 1e3\nj: |\n  two\n  lines\n';
    expect(JSON.parse(await out(yamlJson, yaml))).toEqual({
      a: 1,
      b: ['x', 'y'],
      c: { d: true, e: null },
      f: '007',
      g: 'yes',
      h: 15,
      i: 1000,
      j: 'two\nlines\n',
    });
  });

  it('handles anchors, merge-free aliases and multiple documents', async () => {
    expect(JSON.parse(await out(yamlJson, 'base: &b {x: 1}\ncopy: *b\n'))).toEqual({ base: { x: 1 }, copy: { x: 1 } });
    const multi = await run(yamlJson, 'a: 1\n---\nb: 2\n');
    expect(JSON.parse(multi.output ?? '')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(multi.warnings?.[0]).toMatch(/2 YAML documents/);
  });

  it('reports YAML errors with a position', async () => {
    await expect(run(yamlJson, 'a: 1\nb: [1, 2\nc: 3\n')).rejects.toMatchObject({ line: expect.any(Number) });
    await expect(run(yamlJson, 'a: 1\n  b: 2\n')).rejects.toThrow();
    await expect(run(yamlJson, 'a: 1\na: 2\n')).rejects.toThrow(/unique/i);
  });

  it('converts JSON to YAML and round-trips', async () => {
    const value = { name: 'x', list: [1, 'two', { three: 3 }], nested: { flag: false, nothing: null, text: 'a: b', multi: 'l1\nl2\n' }, 'key with space': '007' };
    const yaml = await out(yamlJson, JSON.stringify(value), { mode: 'decode' });
    expect(yaml).toContain('name: x\nlist:\n  - 1\n  - two\n  - three: 3\n');
    expect(yaml).toContain('text: "a: b"');
    expect(yaml).toContain('key with space: "007"');
    expect(JSON.parse(await out(yamlJson, yaml))).toEqual(value);
    expect(await out(yamlJson, '{"a":{"b":1}}', { mode: 'decode', indent: '4' })).toBe('a:\n    b: 1\n');
    await expect(run(yamlJson, '{a:1}', { mode: 'decode' })).rejects.toThrow(/line 1, column 2/);
  });
});

describe('Markdown and HTML', () => {
  it('renders GitHub-flavoured Markdown', async () => {
    const result = await run(markdownToHtml, '# Title\n\nSome **bold** and `code`.\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~gone~~\n');
    const html = result.output ?? '';
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>Some <strong>bold</strong> and <code>code</code>.</p>');
    expect(html).toContain('<th align="center">b</th>');
    expect(html).toMatch(/<input checked="" disabled="" type="checkbox">/);
    expect(html).toContain('<del>gone</del>');
    expect(result.preview).toEqual({ kind: 'html', html });
  });

  it('honours options and can emit a full document', async () => {
    expect(await out(markdownToHtml, 'a\nb')).toBe('<p>a\nb</p>\n');
    expect(await out(markdownToHtml, 'a\nb', { breaks: true })).toBe('<p>a<br>b</p>\n');
    expect(await out(markdownToHtml, '~~x~~', { gfm: false })).toBe('<p>~~x~~</p>\n');
    const page = await out(markdownToHtml, '# Hi', { document: true, title: 'A <b> & c' });
    expect(page).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(page).toContain('<title>A &lt;b&gt; &amp; c</title>');
    expect(page).toContain('<body>\n<h1>Hi</h1>\n</body>');
  });

  it('converts HTML to Markdown', async () => {
    const html =
      '<h1>Title</h1><p>Some <strong>bold</strong>, <em>italic</em>, <del>gone</del> and <a href="https://example.org">a link</a>.</p>' +
      '<ul><li>one</li><li>two</li></ul><pre><code class="language-js">let a = 1;\n</code></pre>' +
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>' +
      '<script>alert(1)</script><style>p{}</style><blockquote>quoted</blockquote><hr><img src="a.png" alt="pic">';
    const markdown = await out(htmlToMarkdown, html);
    expect(markdown).toContain('# Title\n\nSome **bold**, _italic_, ~~gone~~ and [a link](https://example.org).');
    expect(markdown).toContain('\n- one\n- two\n');
    expect(markdown).toContain('```js\nlet a = 1;\n```');
    expect(markdown).toContain('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(markdown).toContain('> quoted');
    expect(markdown).toContain('---');
    expect(markdown).toContain('![pic](a.png)');
    expect(markdown).not.toContain('alert');
    expect(markdown).not.toContain('p{}');
  });

  it('writes tidy ordered and nested lists', async () => {
    const markdown = await out(htmlToMarkdown, '<ol start="3"><li>three<ul><li>nested a</li><li>nested b</li></ul></li><li>four</li></ol><p><s>old</s></p>');
    expect(markdown).toBe('3. three\n   - nested a\n   - nested b\n4. four\n\n~~old~~\n');
  });

  it('supports the alternative Markdown styles', async () => {
    const markdown = await out(htmlToMarkdown, '<h1>T</h1><h2>S</h2><ul><li>x</li></ul><p><em>i</em> <a href="/u">l</a></p><pre><code>c</code></pre>', {
      headings: 'setext',
      bullet: '*',
      emphasis: '*',
      links: 'referenced',
      code: 'indented',
    });
    expect(markdown).toContain('T\n=\n\nS\n-');
    expect(markdown).toContain('\n* x\n');
    expect(markdown).toContain('*i* [l][1]');
    expect(markdown).toContain('    c');
    expect(markdown).toContain('[1]: /u');
  });
});

describe('curl to fetch', () => {
  it('tokenizes like a POSIX shell', () => {
    expect(tokenizeShell(`curl 'a b' "c \\"d\\" $x" e\\ f $'g\\n\\x41\\'' ""`)).toEqual(['curl', 'a b', 'c "d" $x', 'e f', "g\nA'", '']);
    expect(tokenizeShell('curl a \\\n  b \\\r\n c')).toEqual(['curl', 'a', 'b', 'c']);
    expect(tokenizeShell("curl 'keep \\\n this' x")).toEqual(['curl', 'keep \\\n this', 'x']);
    expect(tokenizeShell('curl a ^\n b `\n c')).toEqual(['curl', 'a', 'b', 'c']);
    expect(tokenizeShell('curl http://x | jq . ')).toEqual(['curl', 'http://x']);
    expect(tokenizeShell('curl http://x 2>/dev/null')).toEqual(['curl', 'http://x']);
    expect(tokenizeShell('curl http://x > out.txt')).toEqual(['curl', 'http://x']);
    expect(tokenizeShell('curl http://x && echo done')).toEqual(['curl', 'http://x']);
    expect(tokenizeShell('curl http://x?a=1&b=2 # comment')).toEqual(['curl', 'http://x?a=1&b=2']);
    expect(() => tokenizeShell("curl 'oops")).toThrow(/Unterminated single quote/);
    expect(() => tokenizeShell('curl "oops')).toThrow(/Unterminated double quote/);
  });

  it('understands methods, headers and data', () => {
    const request = parseCurl(`curl -X PUT https://api.test/x -H 'Content-Type: application/json' -H 'X-A: 1' -H 'x-a: 2' -d '{"a":1}'`);
    expect(request).toMatchObject({ method: 'PUT', url: 'https://api.test/x', body: '{"a":1}' });
    expect(request.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['x-a', '2'],
    ]);
    expect(parseCurl('curl example.org').url).toBe('http://example.org');
    expect(parseCurl('curl example.org').method).toBe('GET');
    expect(parseCurl('curl -d a=1 -d b=2 https://x.test')).toMatchObject({ method: 'POST', body: 'a=1&b=2' });
    expect(parseCurl('curl -d a=1 https://x.test').headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']]);
    expect(parseCurl('curl -I https://x.test').method).toBe('HEAD');
    expect(parseCurl('curl -sSLXPOST https://x.test -m 2.5')).toMatchObject({ method: 'POST', followRedirects: true, timeoutSeconds: 2.5 });
    expect(parseCurl("curl -H'Accept: text/plain' https://x.test").headers).toEqual([['Accept', 'text/plain']]);
    expect(parseCurl('curl --url https://x.test --request delete').method).toBe('DELETE');
    expect(parseCurl('/usr/bin/curl https://x.test').url).toBe('https://x.test');
    expect(parseCurl('$ curl https://x.test').url).toBe('https://x.test');
  });

  it('handles auth, cookies, query data and JSON shortcuts', () => {
    expect(parseCurl('curl -u aladdin:opensesame https://x.test').headers).toEqual([['Authorization', 'Basic YWxhZGRpbjpvcGVuc2VzYW1l']]);
    expect(parseCurl('curl --oauth2-bearer tok https://x.test').headers).toEqual([['Authorization', 'Bearer tok']]);
    expect(parseCurl("curl -b 'a=1; b=2' -A UA -e https://ref.test -r 0-99 https://x.test").headers).toEqual([
      ['Cookie', 'a=1; b=2'],
      ['User-Agent', 'UA'],
      ['Referer', 'https://ref.test'],
      ['Range', 'bytes=0-99'],
    ]);
    const query = parseCurl("curl -G https://x.test/s?x=1 -d 'q=a b' --data-urlencode 'name=Jürgen & co'");
    expect(query).toMatchObject({ method: 'GET', url: 'https://x.test/s?x=1&q=a b&name=J%C3%BCrgen%20%26%20co' });
    expect(query.body).toBeUndefined();
    const json = parseCurl(`curl --json '{"a":1}' https://x.test`);
    expect(json.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
    ]);
    expect(json.method).toBe('POST');
    expect(parseCurl("curl --data-raw '@not-a-file' https://x.test").body).toBe('@not-a-file');
    expect(parseCurl('curl --data-binary @payload.bin https://x.test')).toMatchObject({ bodyFile: 'payload.bin', method: 'POST' });
    expect(parseCurl('curl -T file.txt https://x.test')).toMatchObject({ bodyFile: 'file.txt', method: 'PUT' });
    expect(parseCurl("curl -H 'Accept:' -H 'X-Empty;' https://x.test").headers).toEqual([['X-Empty', '']]);
  });

  it('parses multipart forms', () => {
    const request = parseCurl(`curl -F 'name=Ada' -F 'avatar=@me.png;type=image/png;filename="a.png"' --form-string 'raw=@literal' -H 'Content-Type: multipart/form-data' https://x.test`);
    expect(request.form).toEqual([
      { name: 'name', value: 'Ada', file: false, filename: undefined, type: undefined },
      { name: 'avatar', value: 'me.png', file: true, filename: 'a.png', type: 'image/png' },
      { name: 'raw', value: '@literal', file: false },
    ]);
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual([]);
    expect(request.warnings.join(' ')).toMatch(/multipart boundary/);
    expect(() => parseCurl('curl -F a=1 -d b=2 https://x.test')).toThrow(/both/);
  });

  it('warns about what fetch cannot do and rejects bad commands', () => {
    const warnings = parseCurl('curl -k -x http://proxy:8080 --retry 3 --bogus -o out.html https://a.test https://b.test').warnings.join('\n');
    expect(warnings).toMatch(/TLS certificate/);
    expect(warnings).toMatch(/no proxy option/);
    expect(warnings).toMatch(/does not retry/);
    expect(warnings).toMatch(/Unknown option --bogus/);
    expect(warnings).toMatch(/wrote the response to a file/);
    expect(warnings).toMatch(/2 URLs/);
    expect(() => parseCurl('wget https://x.test')).toThrow(/must start with "curl"/);
    expect(() => parseCurl('curl -H')).toThrow(/Option -H needs a value/);
    expect(() => parseCurl('curl -s')).toThrow(/no URL/);
    expect(() => parseCurl('  ')).toThrow(/Paste a curl command/);
  });

  it('generates code that parses and matches the request', async () => {
    const command = `curl -X POST 'https://api.test/v1/users?x=1' \\\n  -H 'Content-Type: application/json' \\\n  -H "Authorization: Bearer it's" -L -m 10 \\\n  -d '{"name": "Ada", "tags": ["a", "b"], "n": 1, "ok": true, "none": null, "o": {"k-1": "v"}}'`;
    const { code, warnings } = curlToFetch(command, { style: 'await', indent: '  ' });
    expect(warnings).toEqual([]);
    expect(code).toBe(
      [
        "const response = await fetch('https://api.test/v1/users?x=1', {",
        "  method: 'POST',",
        '  headers: {',
        "    'Content-Type': 'application/json',",
        "    Authorization: 'Bearer it\\'s',",
        '  },',
        '  body: JSON.stringify({',
        "    name: 'Ada',",
        '    tags: [',
        "      'a',",
        "      'b',",
        '    ],',
        '    n: 1,',
        '    ok: true,',
        '    none: null,',
        '    o: {',
        "      'k-1': 'v',",
        '    },',
        '  }),',
        '  signal: AbortSignal.timeout(10000),',
        '});',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: expected generated source code
        'if (!response.ok) throw new Error(`HTTP ${response.status}`);',
        'const data = await response.json();',
        'console.log(data);',
        '',
      ].join('\n'),
    );
    await expect(formatWithPrettier(`async function f() {\n${code}}`, 'babel')).resolves.toBeTruthy();
  });

  it('generates the promise style, forms and plain GETs', async () => {
    const simple = curlToFetch('curl https://x.test', { style: 'then', indent: '  ' });
    expect(simple.code).toContain("fetch('https://x.test')\n  .then((response) => {");
    expect(simple.code).toContain('return response.text();');
    expect(simple.warnings.join(' ')).toMatch(/does not follow redirects without -L/);
    await expect(formatWithPrettier(simple.code, 'babel')).resolves.toBeTruthy();

    const form = curlToFetch("curl -L -F 'a=1' -F 'f=@x.bin' https://x.test", { style: 'await', indent: '    ' });
    expect(form.code).toContain("const form = new FormData();\nform.append('a', '1');");
    expect(form.code).toContain("form.append('f', file);");
    expect(form.code).toContain("    method: 'POST',\n    body: form,");

    const text = await run(curlToFetchTool, "curl -L -d 'not json' -H 'Content-Type: application/json' https://x.test", { indent: '4' });
    expect(text.output).toContain("    body: 'not json',");
    expect(text.warnings).toBeUndefined();
    const head = await out(curlToFetchTool, 'curl -LI https://x.test');
    expect(head).toContain("method: 'HEAD'");
    expect(head).toContain('console.log(response.status, Object.fromEntries(response.headers));');
  });
});

describe('SVG tools', () => {
  it('scans XML with exact source positions', () => {
    const source = '<?xml version="1.0"?><!-- c --><a x="1 &amp; 2" y=\'q\'><b/>text &lt;<![CDATA[<raw>]]><c d="e"></c></a>';
    const nodes = parseXml(source);
    expect(nodes.map((node) => node.type)).toEqual(['pi', 'comment', 'element']);
    const root = nodes[2];
    if (root?.type !== 'element') throw new Error('expected element');
    expect(root.attrs.map((a) => [a.name, a.value, source.slice(a.start, a.end)])).toEqual([
      ['x', '1 & 2', 'x="1 &amp; 2"'],
      ['y', 'q', "y='q'"],
    ]);
    expect(source.slice(root.start, root.end)).toBe(source.slice(source.indexOf('<a ')));
    expect(root.children.map((child) => (child.type === 'text' ? `${child.cdata ? 'cdata' : 'text'}:${child.value}` : child.type === 'element' ? child.name : child.type))).toEqual([
      'b',
      'text:text <',
      'cdata:<raw>',
      'c',
    ]);
    const c = root.children[3];
    if (c?.type !== 'element') throw new Error('expected element');
    expect(source.slice(c.start, c.end)).toBe('<c d="e"></c>');
    expect(applyEdits(source, [{ start: c.start, end: c.end, text: '' }])).toBe(source.replace('<c d="e"></c>', ''));
  });

  it('rejects malformed XML with positions', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/Closing tag <\/a> does not match <b> \(line 1, column 7\)/);
    expect(() => parseXml('<a>\n<b>')).toThrow(/<b> is never closed \(line 2, column 1\)/);
    expect(() => parseXml('<a x=1/>')).toThrow(/must be quoted/);
    expect(() => parseXml('<a x/>')).toThrow(/has no value/);
    expect(() => parseXml('</a>')).toThrow(/no matching opening tag/);
    expect(() => parseXml('<a><!-- oops</a>')).toThrow(/Unterminated comment/);
    expect(() => parseXml('<a x="1></a>')).toThrow(/Unterminated/);
  });

  it('reads SVG dimensions', () => {
    expect(svgLength('10')).toBe(10);
    expect(svgLength('1in')).toBe(96);
    expect(svgLength('25.4mm')).toBeCloseTo(96, 6);
    expect(svgLength('72pt')).toBe(96);
    expect(svgLength('50%')).toBeUndefined();
    expect(svgLength('2em')).toBeUndefined();
    expect(svgIntrinsicSize(readSvg('<svg width="10" height="20"/>'))).toEqual({ width: 10, height: 20 });
    expect(svgIntrinsicSize(readSvg('<svg viewBox="0 0 40 20"/>'))).toEqual({ width: 40, height: 20 });
    expect(svgIntrinsicSize(readSvg('<svg width="100" viewBox="0 0 40 20"/>'))).toEqual({ width: 100, height: 50 });
    expect(svgIntrinsicSize(readSvg('<svg/>'))).toEqual({ width: 300, height: 150 });
    expect(() => readSvg('<html/>')).toThrow(/No <svg> root/);
  });

  it('describes an SVG in the viewer', async () => {
    const result = await run(svgViewer, SVG_SAMPLE);
    expect(field(result, 'Rendered size')).toBe('120 \u00d7 120 px');
    expect(field(result, 'viewBox')).toBe('0 0 120 120');
    expect(field(result, 'Elements')).toBe('11');
    expect(result.preview).toMatchObject({ kind: 'svg', svg: SVG_SAMPLE, checker: true });
    expect(result.output).toContain('\n  <defs>\n    <linearGradient');
    expect(result.warnings).toBeUndefined();
    const risky = await run(svgViewer, '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>1</script><image href="https://a.test/i.png"/></svg>');
    expect(risky.warnings).toHaveLength(2);
    expect(risky.fields?.find((f) => f.label === 'viewBox')?.tone).toBe('warn');
  });

  it('converts SVG to a React component that parses', async () => {
    const svg =
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="24" height="24" viewBox="0 0 24 24" class="icon" inkscape:version="1.0" onclick="x()">' +
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample deliberately contains template syntax
      '<!-- note --><metadata>m</metadata><style>.a{fill:red} .b::after{content:"`${x}`"}</style>' +
      '<g stroke-width="2" fill-rule="evenodd" style="fill: #ff0000; stroke-dasharray: 4 2; -webkit-filter: blur(1px); --gap: 2px" data-name="g1" aria-hidden="true">' +
      '<path d="M1 1L2 2" stroke="#000" fill="none" stroke-linecap="round"/><use xlink:href="#a"/><text x="1" y="2">Tom &amp; {Jerry} &lt;3</text></g></svg>';
    const tsx = await out(svgToReact, svg);
    expect(tsx).toContain("import { type SVGProps } from 'react';");
    expect(tsx).toContain('export default function Icon(props: SVGProps<SVGSVGElement>) {');
    expect(tsx).toContain('className="icon"');
    expect(tsx).toContain('xmlnsXlink="http://www.w3.org/1999/xlink"');
    expect(tsx).toContain('{...props}');
    expect(tsx).toContain("style={{ fill: '#ff0000', strokeDasharray: '4 2', WebkitFilter: 'blur(1px)', \"--gap\": '2px' }}");
    // Long tags are broken one attribute per line.
    expect(tsx).toContain('      <g\n        strokeWidth="2"\n        fillRule="evenodd"\n');
    expect(tsx).toContain('        data-name="g1"\n        aria-hidden="true"\n      >');
    expect(tsx).toContain('<path d="M1 1L2 2" stroke="#000" fill="none" strokeLinecap="round" />');
    expect(tsx).toContain('<use xlinkHref="#a" />');
    expect(tsx).toContain('<text x="1" y="2">{\'Tom & {Jerry} <3\'}</text>');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: expected generated source code
    expect(tsx).toContain('<style>{`.a{fill:red} .b::after{content:"\\`\\${x}\\`"}`}</style>');
    expect(tsx).not.toMatch(/inkscape|metadata|note|onclick/i);
    await expect(formatWithPrettier(tsx, 'typescript')).resolves.toBeTruthy();
  });

  it('applies the React conversion options', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><rect fill="#f00" stroke="none" style="stroke: blue; fill: url(#g)"/></svg>';
    const js = await out(svgToReact, svg, { typescript: false, name: 'Logo', exports: 'named', dimensions: 'remove', currentColor: true });
    expect(js).toContain('export function Logo(props) {');
    expect(js).not.toContain('import');
    expect(js).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" {...props}>');
    expect(js).toContain(`<rect fill="currentColor" stroke="none" style={{ stroke: 'currentColor', fill: 'url(#g)' }} />`);
    await expect(formatWithPrettier(js, 'babel')).resolves.toBeTruthy();
    const em = await out(svgToReact, svg, { dimensions: 'em', memo: true });
    expect(em).toContain('width="1em" height="1em" viewBox="0 0 24 12"');
    expect(em).toContain("import { memo, type SVGProps } from 'react';");
    expect(em).toContain('export default memo(Icon);');
    await expect(formatWithPrettier(em, 'typescript')).resolves.toBeTruthy();
    const namedMemo = await out(svgToReact, svg, { memo: true, exports: 'named' });
    await expect(formatWithPrettier(namedMemo, 'typescript')).resolves.toContain('export { MemoIcon as Icon }');
    await expect(run(svgToReact, svg, { name: 'bad name' })).rejects.toThrow(/capital letter/);
    await expect(run(svgToReact, '<div/>')).rejects.toThrow(/No <svg> root/);
  });

  it('removes SVG backgrounds by editing the markup only', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120" style="background-color: #eee; color: red">\n' +
      '  <defs><clipPath id="c"><rect width="200" height="120"/></clipPath></defs>\n' +
      '  <rect width="100%" height="100%" fill="#ffffff"/>\n' +
      '  <rect x="20" y="20" width="160" height="80" fill="#6366f1"/>\n' +
      '  <rect width="200" height="120" fill="#000" opacity=".1"/>\n' +
      '</svg>';
    const first = await run(svgBackgroundRemover, svg);
    expect(first.output).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120" style="color: red">\n' +
        '  <defs><clipPath id="c"><rect width="200" height="120"/></clipPath></defs>\n' +
        '  <rect x="20" y="20" width="160" height="80" fill="#6366f1"/>\n' +
        '  <rect width="200" height="120" fill="#000" opacity=".1"/>\n' +
        '</svg>',
    );
    expect(first.info).toMatch(/^Removed 1 rectangle and the background style on <svg>/);
    const all = await out(svgBackgroundRemover, svg, { match: 'all', rootStyle: false });
    expect(all).toContain('style="background-color: #eee; color: red"');
    expect(all).not.toContain('fill="#ffffff"');
    expect(all).not.toContain('opacity=".1"');
    expect(all).toContain('<clipPath id="c"><rect width="200" height="120"/></clipPath>');
    const black = await out(svgBackgroundRemover, svg, { match: 'color', color: '#000000', rootStyle: false });
    expect(black).toContain('fill="#ffffff"');
    expect(black).not.toContain('opacity=".1"');
  });

  it('finds backdrops in groups and refuses when there is none', async () => {
    const grouped = '<svg viewBox="0 0 10 10"><title>t</title><g id="bg"><rect x="0" y="0" width="10" height="10" style="fill:#fff"/></g><circle r="2"/></svg>';
    expect(await out(svgBackgroundRemover, grouped)).toBe('<svg viewBox="0 0 10 10"><title>t</title><g id="bg"></g><circle r="2"/></svg>');
    const noBackdrop = '<svg viewBox="0 0 10 10"><circle r="2"/><rect width="10" height="10"/></svg>';
    await expect(run(svgBackgroundRemover, noBackdrop)).rejects.toThrow(/No background was found/);
    expect(await out(svgBackgroundRemover, noBackdrop, { match: 'all' })).toBe('<svg viewBox="0 0 10 10"><circle r="2"/></svg>');
    await expect(run(svgBackgroundRemover, grouped, { match: 'color', color: '#ff0000' })).rejects.toThrow(/No full-size rectangle with that colour/);
    const transformed = '<svg viewBox="0 0 10 10"><rect width="10" height="10" transform="rotate(5)"/></svg>';
    await expect(run(svgBackgroundRemover, transformed)).rejects.toThrow(/No background/);
    const unfilled = '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="none" stroke="#000"/></svg>';
    await expect(run(svgBackgroundRemover, unfilled, { match: 'all' })).rejects.toThrow(/No background/);
  });
});

describe('Number to words', () => {
  const intl = { system: 'international', and: false } as const;

  it.each([
    [0n, 'zero'],
    [7n, 'seven'],
    [13n, 'thirteen'],
    [20n, 'twenty'],
    [21n, 'twenty-one'],
    [99n, 'ninety-nine'],
    [100n, 'one hundred'],
    [101n, 'one hundred one'],
    [110n, 'one hundred ten'],
    [999n, 'nine hundred ninety-nine'],
    [1000n, 'one thousand'],
    [1001n, 'one thousand one'],
    [12345n, 'twelve thousand three hundred forty-five'],
    [1000000n, 'one million'],
    [1000001n, 'one million one'],
    [1234567890n, 'one billion two hundred thirty-four million five hundred sixty-seven thousand eight hundred ninety'],
    [-42n, 'minus forty-two'],
    [10n ** 63n, 'one vigintillion'],
  ])('spells %s', (value, expected) => {
    expect(integerToWords(value, intl)).toBe(expected);
  });

  it('supports British "and" and the Indian system', () => {
    const british = { system: 'international', and: true } as const;
    expect(integerToWords(101n, british)).toBe('one hundred and one');
    expect(integerToWords(1001n, british)).toBe('one thousand and one');
    expect(integerToWords(1100n, british)).toBe('one thousand one hundred');
    expect(integerToWords(1234567n, british)).toBe('one million two hundred and thirty-four thousand five hundred and sixty-seven');
    expect(integerToWords(2000042n, british)).toBe('two million and forty-two');
    const indian = { system: 'indian', and: false } as const;
    expect(integerToWords(100000n, indian)).toBe('one lakh');
    expect(integerToWords(1234567n, indian)).toBe('twelve lakh thirty-four thousand five hundred sixty-seven');
    expect(integerToWords(10000000n, indian)).toBe('one crore');
    expect(integerToWords(123456789n, indian)).toBe('twelve crore thirty-four lakh fifty-six thousand seven hundred eighty-nine');
    expect(integerToWords(1000000000000n, indian)).toBe('one lakh crore');
    expect(integerToWords(99999n, indian)).toBe('ninety-nine thousand nine hundred ninety-nine');
    expect(() => integerToWords(10n ** 66n, intl)).toThrow(/too large/);
  });

  it('parses the number formats people actually type', () => {
    expect(parseNumber('1,234,567.890')).toEqual({ negative: false, integer: 1234567n, fraction: '890' });
    expect(parseNumber(' -12_000 ')).toEqual({ negative: true, integer: 12000n, fraction: '' });
    expect(parseNumber('.5')).toEqual({ negative: false, integer: 0n, fraction: '5' });
    expect(parseNumber('1.5e3')).toEqual({ negative: false, integer: 1500n, fraction: '' });
    expect(parseNumber('1.25e1')).toEqual({ negative: false, integer: 12n, fraction: '5' });
    expect(parseNumber('125e-2')).toEqual({ negative: false, integer: 1n, fraction: '25' });
    expect(parseNumber('5e-3')).toEqual({ negative: false, integer: 0n, fraction: '005' });
    expect(parseNumber('12345678901234567890123')).toEqual({ negative: false, integer: 12345678901234567890123n, fraction: '' });
    for (const bad of ['abc', '', '1.2.3', '--1', '1e', '.', '12 apples']) expect(() => parseNumber(bad)).toThrow(/not a number/);
  });

  it('writes decimals, ordinals and money', () => {
    expect(numberToWords('3.14', intl)).toBe('three point one four');
    expect(numberToWords('-0.05', intl)).toBe('minus zero point zero five');
    expect(numberToWords('-0', intl)).toBe('zero');
    expect(numberToOrdinal('1', intl)).toBe('first');
    expect(numberToOrdinal('2', intl)).toBe('second');
    expect(numberToOrdinal('3', intl)).toBe('third');
    expect(numberToOrdinal('12', intl)).toBe('twelfth');
    expect(numberToOrdinal('20', intl)).toBe('twentieth');
    expect(numberToOrdinal('21', intl)).toBe('twenty-first');
    expect(numberToOrdinal('100', intl)).toBe('one hundredth');
    expect(numberToOrdinal('1000000', intl)).toBe('one millionth');
    expect(numberToOrdinal('45.0', intl)).toBe('forty-fifth');
    expect(() => numberToOrdinal('1.5', intl)).toThrow(/no ordinal/);
    const usd = CURRENCIES.USD as NonNullable<(typeof CURRENCIES)[string]>;
    const inr = CURRENCIES.INR as NonNullable<(typeof CURRENCIES)[string]>;
    const gbp = CURRENCIES.GBP as NonNullable<(typeof CURRENCIES)[string]>;
    expect(amountToWords('1234.56', usd, intl)).toBe('one thousand two hundred thirty-four dollars and fifty-six cents');
    expect(amountToWords('1', usd, intl)).toBe('one dollar');
    expect(amountToWords('0.01', usd, intl)).toBe('one cent');
    expect(amountToWords('0.995', usd, intl)).toBe('one dollar');
    expect(amountToWords('2.005', usd, intl)).toBe('two dollars and one cent');
    expect(amountToWords('-3.5', usd, intl)).toBe('minus three dollars and fifty cents');
    expect(amountToWords('1.01', gbp, intl)).toBe('one pound and one penny');
    expect(amountToWords('150000.50', inr, { system: 'indian', and: false })).toBe('one lakh fifty thousand rupees and fifty paise');
    expect(amountToCheque('1234.5', usd, intl)).toBe('one thousand two hundred thirty-four and 50/100 dollars');
    expect(amountToCheque('0.07', usd, intl)).toBe('zero and 07/100 dollars');
    expect(() => amountToCheque('-1', usd, intl)).toThrow(/negative/);
  });

  it('converts line by line with capitalisation', async () => {
    expect(await out(numberToWordsTool, '42\n\n1,001')).toBe('Forty-two\n\nOne thousand one');
    expect(await out(numberToWordsTool, '101', { case: 'title', and: true })).toBe('One Hundred and One');
    expect(await out(numberToWordsTool, '7', { case: 'upper', mode: 'ordinal' })).toBe('SEVENTH');
    expect(await out(numberToWordsTool, '250000', { case: 'lower', system: 'indian', mode: 'currency', currency: 'INR' })).toBe('two lakh fifty thousand rupees');
    expect(await out(numberToWordsTool, '99.99', { mode: 'cheque' })).toBe('Ninety-nine and 99/100 dollars');
    await expect(run(numberToWordsTool, '1\nx\n3')).rejects.toThrow(/Line 2: "x" is not a number/);
    await expect(run(numberToWordsTool, 'x')).rejects.toThrow(/^"x" is not a number/);
  });
});

describe('Dates and time zones', () => {
  it('computes UTC offsets including daylight saving time', () => {
    expect(zoneOffsetMinutes(Date.UTC(2026, 10, 13), 'Asia/Kolkata')).toBe(330);
    expect(zoneOffsetMinutes(Date.UTC(2026, 0, 15), 'America/New_York')).toBe(-300);
    expect(zoneOffsetMinutes(Date.UTC(2026, 6, 15), 'America/New_York')).toBe(-240);
    expect(zoneOffsetMinutes(Date.UTC(2026, 6, 15), 'Asia/Kathmandu')).toBe(345);
    expect(zoneOffsetMinutes(Date.UTC(2026, 6, 15), 'UTC')).toBe(0);
    expect(() => zoneOffsetMinutes(0, 'Mars/Olympus')).toThrow(/Unknown time zone/);
  });

  it('converts wall-clock times to instants', () => {
    expect(zonedToEpoch('Asia/Kolkata', 2026, 11, 13, 6, 32, 0)).toBe(Date.UTC(2026, 10, 13, 1, 2, 0));
    expect(zonedToEpoch('UTC', 1970, 1, 1)).toBe(0);
    // US daylight saving time in 2026 starts on 8 March and ends on 1 November.
    expect(zonedToEpoch('America/New_York', 2026, 3, 8, 1, 59, 59)).toBe(Date.UTC(2026, 2, 8, 6, 59, 59));
    expect(zonedToEpoch('America/New_York', 2026, 3, 8, 3, 0, 0)).toBe(Date.UTC(2026, 2, 8, 7, 0, 0));
    expect(zonedToEpoch('America/New_York', 2026, 11, 1, 0, 30, 0)).toBe(Date.UTC(2026, 10, 1, 4, 30, 0));
    expect(zonedToEpoch('America/New_York', 2026, 11, 1, 3, 0, 0)).toBe(Date.UTC(2026, 10, 1, 8, 0, 0));
    expect(zonedToEpoch('Australia/Lord_Howe', 2026, 1, 1, 12, 0, 0)).toBe(Date.UTC(2026, 0, 1, 1, 0, 0));
  });

  it('formats instants in a zone with weekday, day of year and ISO week', () => {
    expect(formatInZone(Date.UTC(2026, 10, 13, 1, 2, 3), 'Asia/Kolkata')).toEqual({
      iso: '2026-11-13T06:32:03+05:30',
      date: '2026-11-13',
      time: '06:32:03',
      offset: '+05:30',
      weekday: 'Friday',
      dayOfYear: 317,
      isoWeek: '2026-W46',
    });
    expect(formatInZone(0, 'UTC').iso).toBe('1970-01-01T00:00:00Z');
    expect(formatInZone(1234, 'UTC').iso).toBe('1970-01-01T00:00:01.234Z');
    expect(formatInZone(Date.UTC(2021, 0, 3), 'UTC').isoWeek).toBe('2020-W53');
    expect(formatInZone(Date.UTC(2021, 0, 4), 'UTC').isoWeek).toBe('2021-W01');
    expect(formatInZone(Date.UTC(2024, 11, 30), 'UTC').isoWeek).toBe('2025-W01');
    expect(formatInZone(Date.UTC(2024, 11, 31), 'UTC').dayOfYear).toBe(366);
    expect(formatInZone(Date.UTC(2026, 0, 1, 2), 'America/Los_Angeles')).toMatchObject({ date: '2025-12-31', weekday: 'Wednesday', offset: '-08:00' });
    expect(formatInZone(-1, 'UTC').iso).toBe('1969-12-31T23:59:59.999Z');
  });

  it('understands timestamps in every unit and date strings', () => {
    const now = Date.UTC(2026, 10, 13);
    const parse = (text: string, zone = 'UTC', unit: 'auto' | 's' | 'ms' | 'us' | 'ns' = 'auto') => parseInstant(text, zone, unit, now).epochMs;
    expect(parse('')).toBe(now);
    expect(parse('now')).toBe(now);
    expect(parse('1700000000')).toBe(1700000000000);
    expect(parse('1700000000000')).toBe(1700000000000);
    expect(parse('1700000000000000')).toBe(1700000000000);
    expect(parse('1700000000000000000')).toBe(1700000000000);
    expect(parse('1700000000.5')).toBe(1700000000500);
    expect(parse('-86400')).toBe(-86400000);
    expect(parse('1700000000', 'UTC', 'ms')).toBe(1700000000);
    expect(parse('2026-11-13 06:32', 'Asia/Kolkata')).toBe(Date.UTC(2026, 10, 13, 1, 2));
    expect(parse('2026-11-13T06:32:10.5', 'Asia/Kolkata')).toBe(Date.UTC(2026, 10, 13, 1, 2, 10, 500));
    expect(parse('2026-11-13', 'Asia/Kolkata')).toBe(Date.UTC(2026, 10, 12, 18, 30));
    expect(parse('2026-11-13T01:02:00Z', 'Asia/Kolkata')).toBe(Date.UTC(2026, 10, 13, 1, 2));
    expect(parse('2026-11-13T06:32:00+05:30', 'America/New_York')).toBe(Date.UTC(2026, 10, 13, 1, 2));
    expect(parse('Fri, 13 Nov 2026 01:02:00 GMT')).toBe(Date.UTC(2026, 10, 13, 1, 2));
    expect(() => parse('2026-02-30')).toThrow(/not a real calendar date/);
    expect(() => parse('2026-13-01')).toThrow(/not a valid date/);
    expect(() => parse('2026-01-01 25:00')).toThrow(/not a valid date/);
    expect(() => parse('next tuesday-ish')).toThrow(/Could not understand/);
    expect(() => parse('9'.repeat(30))).toThrow(/outside the range/);
    expect(parseInstant('1700000000', 'UTC', 'auto', now).interpretation).toBe('a Unix timestamp in seconds');
  });

  it('presents a timestamp in the tool', async () => {
    const result = await run(unixTimestamp, '', { value: '1700000000', zone: 'Asia/Kolkata' });
    expect(field(result, 'Unix seconds')).toBe('1700000000');
    expect(field(result, 'Unix milliseconds')).toBe('1700000000000');
    expect(field(result, 'ISO 8601 (UTC)')).toBe('2023-11-14T22:13:20Z');
    expect(field(result, 'ISO 8601 (Asia/Kolkata)')).toBe('2023-11-15T03:43:20+05:30');
    expect(field(result, 'Date in Asia/Kolkata')).toBe('Wednesday, 2023-11-15 03:43:20 (UTC+05:30)');
    expect(field(result, 'RFC 2822')).toBe('Tue, 14 Nov 2023 22:13:20 GMT');
    expect(field(result, 'Relative')).toMatch(/ago$/);
    expect(field(result, 'Day of year')).toBe('319 / 2023-W46');
    const current = await run(unixTimestamp, '', {});
    expect(Math.abs(Number(field(current, 'Unix milliseconds')) - Date.now())).toBeLessThan(5000);
    await expect(run(unixTimestamp, '', { value: 'nope' })).rejects.toThrow(/Could not understand/);
  });
});

describe('Number bases and unit calculators', () => {
  it('converts between bases with arbitrary precision', async () => {
    const result = await run(baseConverter, '', { value: '255' });
    expect(field(result, 'Binary')).toBe('1111 1111');
    expect(field(result, 'Octal')).toBe('377');
    expect(field(result, 'Decimal')).toBe('255');
    expect(field(result, 'Hexadecimal')).toBe('ff');
    expect(field(result, 'Base 36')).toBe('73');
    expect(result.info).toMatch(/^8 bits/);
    expect(field(await run(baseConverter, '', { value: '0xDEAD_BEEF', from: '16', upper: true }), 'Decimal')).toBe('3,735,928,559');
    expect(field(await run(baseConverter, '', { value: '-1010', from: '2' }), 'Decimal')).toBe('-10');
    expect(field(await run(baseConverter, '', { value: 'zz', from: '36', grouped: false }), 'Binary')).toBe('10100001111');
    const huge = await run(baseConverter, '', { value: '123456789012345678901234567890', grouped: false });
    expect(field(huge, 'Hexadecimal')).toBe('18ee90ff6c373e0ee4e3f0ad2');
    expect(BigInt(`0x${field(huge, 'Hexadecimal')}`).toString()).toBe('123456789012345678901234567890');
    await expect(run(baseConverter, '', { value: '129', from: '8' })).rejects.toThrow(/"9" is not a digit in base 8 \(digits 0-7\)/);
    await expect(run(baseConverter, '', { value: 'g', from: '16' })).rejects.toThrow(/digits 0-9 and a-f/);
    await expect(run(baseConverter, '', { value: '  ' })).rejects.toThrow(/Enter a number/);
  });

  it('calculates in binary', async () => {
    const calc = async (values: Record<string, unknown>, label = 'Binary') => field(await run(binaryCalculator, '', values), label);
    expect(await calc({ a: '1011', b: '110' })).toBe('1 0001');
    expect(await calc({ a: '1011', b: '110' }, 'Decimal')).toBe('17');
    expect(await calc({ a: '1011', b: '110', op: 'sub' })).toBe('101');
    expect(await calc({ a: '1011', b: '110', op: 'mul' }, 'Decimal')).toBe('66');
    expect(await calc({ a: '1011', b: '110', op: 'div' }, 'Decimal')).toBe('1');
    expect(await calc({ a: '1011', b: '110', op: 'mod' }, 'Decimal')).toBe('5');
    expect(await calc({ a: '1100', b: '1010', op: 'and' })).toBe('1000');
    expect(await calc({ a: '1100', b: '1010', op: 'or' })).toBe('1110');
    expect(await calc({ a: '1100', b: '1010', op: 'xor' })).toBe('110');
    expect(await calc({ a: '1100', op: 'not' })).toBe('1111 0011');
    expect(await calc({ a: '1100', op: 'not', width: '16' }, 'Hexadecimal')).toBe('FFF3');
    expect(await calc({ a: '1', b: '100', op: 'shl' })).toBe('1 0000');
    expect(await calc({ a: '10000', b: '11', op: 'shr' })).toBe('10');
    expect(await calc({ a: '5', b: '7', op: 'sub', base: '10' }, "Two's complement")).toBe('1111 1110');
    expect(await calc({ a: 'ff', b: '1', base: '16' }, 'Hexadecimal')).toBe('100');
    expect((await run(binaryCalculator, '', { a: 'ff', b: '1', base: '16' })).warnings?.[0]).toMatch(/does not fit in 8 bits/);
    await expect(run(binaryCalculator, '', { a: '1', b: '0', op: 'div' })).rejects.toThrow(/Division by zero/);
    await expect(run(binaryCalculator, '', { a: '12', b: '1' })).rejects.toThrow(/"2" is not a digit in base 2/);
  });

  it('converts px and rem', async () => {
    const result = await run(pxRem, '', { value: '24' });
    expect(field(result, 'rem')).toBe('1.5rem');
    expect(field(result, 'Pixels')).toBe('24px');
    expect(field(result, 'Points')).toBe('18pt');
    expect(field(result, 'Tailwind spacing')).toMatch(/^6 /);
    expect(result.output).toContain('  16px  =  1rem');
    expect(field(await run(pxRem, '', { value: '1.5', direction: 'rem' }), 'Pixels')).toBe('24px');
    expect(field(await run(pxRem, '', { value: '2rem', direction: 'px', base: 10 }), 'Pixels')).toBe('20px');
    expect(field(await run(pxRem, '', { value: '10px', direction: 'rem', precision: 2 }), 'rem')).toBe('0.63rem');
    await expect(run(pxRem, '', { value: 'big' })).rejects.toThrow(/not a length/);
  });

  it('converts Android units', async () => {
    const result = await run(androidPixels, '', { value: 16, unit: 'dp', density: '320' });
    expect(field(result, 'px')).toBe('32 px');
    expect(field(result, 'dp')).toBe('16 dp');
    expect(field(result, 'in')).toBe('0.1 in');
    expect(field(result, 'mm')).toBe('2.54 mm');
    expect(field(result, 'pt')).toBe('7.2 pt');
    expect(result.output).toContain('xxhdpi   480 dpi  x3     48 px');
    expect(result.info).toBe('1 dp = 2 px at 320 dpi');
    expect(field(await run(androidPixels, '', { value: 48, unit: 'px', density: '480' }), 'dp')).toBe('16 dp');
    expect(field(await run(androidPixels, '', { value: 10, unit: 'sp', density: '160', fontScale: 1.5 }), 'px')).toBe('15 px');
    expect(field(await run(androidPixels, '', { value: 1, unit: 'in', density: 'custom', dpi: 420 }), 'px')).toBe('420 px');
  });
});
