import { describe, expect, it } from 'vitest';
import { parseJsonLossless, writeJson } from '../../src/lib/json';
import cssFormatter from '../../src/tools/text/css-formatter';
import htmlFormatter from '../../src/tools/text/html-formatter';
import jsFormatter from '../../src/tools/text/js-formatter';
import jsMinifier from '../../src/tools/text/js-minifier';
import jsonFormatter from '../../src/tools/text/json-formatter';
import svgMinifier, { SVG_SAMPLE } from '../../src/tools/text/svg-minifier';
import xmlFormatter from '../../src/tools/text/xml-formatter';
import { out, run } from './helpers';

describe('JSON formatter', () => {
  it('formats, minifies and sorts keys', async () => {
    const input = '{"b":[1,2,{"d":null}],"a":"x","c":{}, "e":[]}';
    expect(await out(jsonFormatter, input)).toBe('{\n  "b": [\n    1,\n    2,\n    {\n      "d": null\n    }\n  ],\n  "a": "x",\n  "c": {},\n  "e": []\n}');
    expect(await out(jsonFormatter, input, { indent: 'tab' })).toContain('\n\t"b": [\n\t\t1,');
    expect(await out(jsonFormatter, ' { "b" : 1 ,\n "a" : [ true , false ] } ', { mode: 'minify' })).toBe('{"b":1,"a":[true,false]}');
    expect(await out(jsonFormatter, '{"b":{"z":1,"y":2},"a":[{"k":1,"j":2}]}', { mode: 'minify', sortKeys: true })).toBe('{"a":[{"j":2,"k":1}],"b":{"y":2,"z":1}}');
  });

  it('never alters numbers or string escapes', async () => {
    const input = '{"big":12345678901234567890,"precise":0.1000000000000000055511151231257827,"exp":1E+2,"neg":-0,"s":"\\u00e9\\n\\/"}';
    expect(await out(jsonFormatter, input, { mode: 'minify' })).toBe(input);
    const formatted = await out(jsonFormatter, input);
    expect(formatted).toContain('"big": 12345678901234567890,');
    expect(formatted).toContain('"exp": 1E+2,');
    expect(formatted).toContain('"s": "\\u00e9\\n\\/"');
  });

  it('agrees with JSON.parse on valid documents', () => {
    const samples = ['null', 'true', '0', '-1.5e-3', '""', '"a\\"b"', '[]', '{}', '[[],{}]', ' [1 , 2]\n', '{"a":{"b":[1,"2",null,false]}}'];
    for (const sample of samples) {
      expect(JSON.parse(writeJson(parseJsonLossless(sample).root, { indent: '' }))).toEqual(JSON.parse(sample));
      expect(JSON.parse(writeJson(parseJsonLossless(sample).root, { indent: '  ' }))).toEqual(JSON.parse(sample));
    }
  });

  it.each([
    ['{"a":1,}', /Trailing comma before "}" at line 1, column 8/],
    ['[1,2,]', /Trailing comma before "]" at line 1, column 6/],
    ['{"a":1\n "b":2}', /Expected "," or "}" but found '"' at line 2, column 2/],
    ["{'a':1}", /Expected a double-quoted property name but found "'" at line 1, column 2/],
    ['{"a":01}', /leading zeros at line 1, column 6/],
    ['{"a":.5}', /Unexpected "\." at line 1, column 6/],
    ['["abc', /Unterminated string at line 1, column 2/],
    ['["a\tb"]', /Unescaped control character/],
    ['["\\x41"]', /Invalid escape sequence \\x/],
    ['{"a":tru}', /Unexpected "t" at line 1, column 6/],
    ['{"a":1} x', /Unexpected "x" after the end of the JSON value at line 1, column 9/],
    ['', /Input is empty/],
    ['{"a":', /Unexpected end of input/],
    ['[1 2]', /Expected "," or "]" but found "2" at line 1, column 4/],
    ['{"a" 1}', /Expected ":" after property name/],
    ['NaN', /Unexpected "N"/],
    ['[1.]', /digit must follow the decimal point/],
    ['[1e]', /digit must follow the exponent/],
    ["'x'", /Strings must use double quotes/],
  ])('rejects %j', async (input, pattern) => {
    await expect(run(jsonFormatter, input)).rejects.toThrow(pattern);
    expect(() => JSON.parse(input)).toThrow();
  });

  it('reports the line and column on the error object', async () => {
    await expect(run(jsonFormatter, '{\n  "a": 1,\n  "b": oops\n}')).rejects.toMatchObject({ line: 3, column: 8 });
  });

  it('warns about duplicate keys and survives deep nesting', async () => {
    expect((await run(jsonFormatter, '{"a":1,"b":{"a":2},"a":3}')).warnings?.[0]).toMatch(/Duplicate keys.*"a"/);
    expect((await run(jsonFormatter, '{"a":1,"b":{"a":2}}')).warnings).toBeUndefined();
    const deep = `${'['.repeat(1500)}${']'.repeat(1500)}`;
    expect(await out(jsonFormatter, deep, { mode: 'minify' })).toBe(deep);
    await expect(run(jsonFormatter, `${'['.repeat(3000)}${']'.repeat(3000)}`)).rejects.toThrow(/deeper than 2000 levels/);
  });
});

describe('HTML formatter', () => {
  const messy = '<div><p>Hello <b>world</b></p><pre>  keep\n   this </pre><script>var a=1;if(a){b()}</script><style>a{color:red}</style></div>';

  it('indents markup and leaves pre/script/style alone by default', async () => {
    const output = await out(htmlFormatter, messy);
    expect(output).toContain('<div>\n  <p>Hello <b>world</b></p>\n  <pre>  keep\n   this </pre>');
    expect(output).toContain('<script>var a=1;if(a){b()}</script>');
    expect(output).toContain('<style>a{color:red}</style>');
    expect(output.endsWith('</div>\n')).toBe(true);
  });

  it('can also format inline scripts and styles, with tabs', async () => {
    const output = await out(htmlFormatter, messy, { inline: 'process', indent: 'tab' });
    expect(output).toContain('\t<script>\n\t\tvar a = 1;\n\t\tif (a) {\n\t\t\tb()\n\t\t}\n\t</script>');
    expect(output).toContain('\t<style>\n\t\ta {\n\t\t\tcolor: red\n\t\t}\n\t</style>');
  });

  const list = '<!-- note -->\n<ul>\n  <li> One </li>\n  <li>Two   <b>bold</b>  </li>\n</ul>\n<pre>  keep\n   this </pre>';

  it('minifies at three levels of whitespace removal', async () => {
    expect(await out(htmlFormatter, list, { mode: 'minify' })).toBe('<ul> <li> One </li> <li>Two <b>bold</b> </li> </ul> <pre>  keep\n   this </pre>');
    expect(await out(htmlFormatter, list, { mode: 'minify', whitespace: 'smart' })).toBe('<ul><li>One</li><li>Two <b>bold</b></li></ul><pre>  keep\n   this </pre>');
    expect(await out(htmlFormatter, list, { mode: 'minify', whitespace: 'aggressive' })).toBe('<ul><li>One</li><li>Two<b>bold</b></li></ul><pre>  keep\n   this </pre>');
    // Inline elements keep the single space that separates them when rendered.
    expect(await out(htmlFormatter, '<div>\n  <span>a</span>\n  <span>b</span>\n</div>', { mode: 'minify', whitespace: 'smart' })).toBe('<div><span>a</span> <span>b</span></div>');
  });

  it('keeps or removes comments, never conditional or /*! ones', async () => {
    expect(await out(htmlFormatter, list, { mode: 'minify', comments: false })).toMatch(/^<!-- note --> <ul>/);
    expect(await out(htmlFormatter, 'a <!-- c --> b <!--[if IE]> x <![endif]--> c <!--! keep --> d', { mode: 'minify' })).toBe('a b <!--[if IE]> x <![endif]--> c <!--! keep --> d');
  });

  it('never rewrites attribute values, entities or non-breaking spaces', async () => {
    const source =
      '<!DOCTYPE html>\n<HTML>\n<Body  CLASS="a  b"   data-x = \'1  2\'   hidden >\n<p>one\n<p>two   three&nbsp; &amp;  x\u00a0 y</p >\n<br />\n<img src=a.png alt="x  y" / >\n</Body>\n</HTML>\n';
    expect(await out(htmlFormatter, source, { mode: 'minify', whitespace: 'smart' })).toBe(
      '<!DOCTYPE html><HTML><Body CLASS="a  b" data-x = \'1  2\' hidden><p>one<p>two three&nbsp; &amp; x\u00a0 y</p><br /><img src=a.png alt="x  y" /></Body></HTML>',
    );
    expect(await out(htmlFormatter, '<a href="x">y</a\n>  <i>z</i>', { mode: 'minify' })).toBe('<a href="x">y</a> <i>z</i>');
    expect(await out(htmlFormatter, '  plain   text  only  ', { mode: 'minify' })).toBe('plain text only');
  });

  it('leaves raw-text elements alone unless asked to process them', async () => {
    const source = '<style>\n a { color : red ; }\n</style><script>\n var answer = 40 + 2 ;\n</script>';
    expect(await out(htmlFormatter, source, { mode: 'minify' })).toBe(source);
    expect(await out(htmlFormatter, source, { mode: 'minify', inline: 'process' })).toBe('<style>a{color:red}</style><script>var answer=42;</script>');
    expect(await out(htmlFormatter, '<pre>\n a <b> b </b>\n</pre>\n<p> x </p>', { mode: 'minify', whitespace: 'aggressive' })).toBe('<pre>\n a <b> b </b>\n</pre><p>x</p>');
  });

  it('handles JSON, templates and broken scripts safely', async () => {
    const source =
      '<textarea>  a\n  b </textarea><title>  T  </title><script type="application/ld+json">\n{ "a" : [1, 2] , "b":"</x>" }\n</script>' +
      '<script type="text/template"> <b>  x </b> </script><script>if (a < b) { foo( ) }</script><script>var x = ;</script>';
    const result = await run(htmlFormatter, source, { mode: 'minify', inline: 'process' });
    expect(result.output).toBe(
      '<textarea>  a\n  b </textarea><title>  T  </title><script type="application/ld+json">{"a":[1,2],"b":"\\u003c/x>"}</script>' +
        '<script type="text/template"> <b>  x </b> </script><script>a<b&&foo();</script><script>var x = ;</script>',
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toMatch(/inline <script> could not be parsed/);
  });
});

describe('CSS formatter', () => {
  it('formats CSS, SCSS and Less with Prettier', async () => {
    expect(await out(cssFormatter, 'a{color:red;background:#FFF}@media (min-width:1px){b{margin:0}}')).toBe(
      'a {\n  color: red;\n  background: #fff;\n}\n@media (min-width: 1px) {\n  b {\n    margin: 0;\n  }\n}\n',
    );
    expect(await out(cssFormatter, '$c:red;.a{.b{color:$c}&:hover{x:y}}', { syntax: 'scss', indent: '4' })).toBe(
      '$c: red;\n.a {\n    .b {\n        color: $c;\n    }\n    &:hover {\n        x: y;\n    }\n}\n',
    );
    expect(await out(cssFormatter, '@c:red;.a{color:@c;.mixin()}', { syntax: 'less', indent: 'tab' })).toBe('@c: red;\n.a {\n\tcolor: @c;\n\t.mixin();\n}\n');
  });

  it('reports syntax errors with a position', async () => {
    await expect(run(cssFormatter, 'a { color: red;\n  b {')).rejects.toMatchObject({ line: 2 });
  });

  it('minifies with csso', async () => {
    const source = '/*! keep */\n/* drop */\n.a { color: #ff0000; margin: 0px 0px 0px 0px; }\n.b { color: #ff0000; }\n';
    const merged = await out(cssFormatter, source, { mode: 'minify' });
    expect(merged.startsWith('/*! keep */\n')).toBe(true);
    expect(merged).toContain('.a,.b{color:red}');
    expect(merged).toContain('.a{margin:0}');
    expect(merged).not.toContain('drop');
    expect(await out(cssFormatter, source, { mode: 'minify', comments: 'none', restructure: false })).toBe('.a{color:red;margin:0 0 0 0}.b{color:red}');
  });
});

describe('JavaScript formatter and minifier', () => {
  it('formats JavaScript, JSX and TypeScript', async () => {
    expect(await out(jsFormatter, 'const a={b:1,c:[1,2]};function f(x){return x?<p className="a">{x}</p>:null}')).toBe(
      'const a = { b: 1, c: [1, 2] };\nfunction f(x) {\n  return x ? <p className="a">{x}</p> : null;\n}\n',
    );
    expect(
      await out(jsFormatter, 'interface A{b:string;c?:number}\nconst f=<T,>(x:T):T=>x', {
        language: 'typescript',
        semi: false,
        singleQuote: true,
        indent: '4',
      }),
    ).toBe('interface A {\n    b: string\n    c?: number\n}\nconst f = <T,>(x: T): T => x\n');
    const result = await run(jsFormatter, 'let x: number = 1', { language: 'typescript' });
    expect(result.language).toBe('typescript');
  });

  it('reports syntax errors with a position', async () => {
    await expect(run(jsFormatter, 'const a = {\n  b: 1,\n  c: \n};\nfoo(')).rejects.toMatchObject({ line: 4 });
    await expect(run(jsFormatter, 'let x: number = 1')).rejects.toThrow();
  });

  it('minifies with Terser', async () => {
    const source = '/*! @license MIT */\n// note\nfunction add(first, second) { return first + second; }\nif (false) { dead(); }\nconsole.log(add(1, 2));';
    const result = await run(jsMinifier, source);
    expect(result.output).toMatch(/^\/\*! @license MIT \*\/\nfunction add\((\w),(\w)\)\{return \1\+\2\}console\.log\(add\(1,2\)\);$/);
    expect(result.info).toMatch(/smaller/);
    expect(await out(jsMinifier, source, { comments: 'none', toplevel: true })).toBe('console.log(1+2);');
    expect(await out(jsMinifier, 'function add(first, second) { return first + second; }', { mangle: false, compress: false })).toBe('function add(first,second){return first+second}');
    expect(await out(jsMinifier, 'export const a = 1; const unused = 2;', { module: true })).toBe('export const a=1;');
  });

  it('explains where the JavaScript is broken', async () => {
    await expect(run(jsMinifier, 'let a = 1;\nlet b = ;')).rejects.toMatchObject({ line: 2, column: 9 });
  });
});

describe('XML formatter', () => {
  const xml = '<?xml version="1.0"?><root a="1"><!-- c --><item>text</item><empty/><d><![CDATA[<raw> & stuff]]></d><n><m>1</m></n></root>';

  it('formats while preserving comments, CDATA and declarations', async () => {
    expect(await out(xmlFormatter, xml)).toBe(
      '<?xml version="1.0"?>\n<root a="1">\n  <!-- c -->\n  <item>text</item>\n  <empty/>\n  <d><![CDATA[<raw> & stuff]]></d>\n  <n>\n    <m>1</m>\n  </n>\n</root>',
    );
    expect(await out(xmlFormatter, '<a><b>1</b></a>', { indent: 'tab', collapse: false })).toBe('<a>\n\t<b>\n\t\t1\n\t</b>\n</a>');
  });

  it('minifies and can strip comments', async () => {
    const pretty = await out(xmlFormatter, xml);
    expect(await out(xmlFormatter, pretty, { mode: 'minify' })).toBe(xml);
    expect(await out(xmlFormatter, pretty, { mode: 'minify', comments: true })).toBe(xml.replace('<!-- c -->', ''));
  });

  it('rejects XML that is not well-formed, with a position', async () => {
    await expect(run(xmlFormatter, '<a>\n  <b>\n</a>')).rejects.toMatchObject({ line: 3 });
    await expect(run(xmlFormatter, '<a><b></a></b>')).rejects.toThrow(/line 1/);
    await expect(run(xmlFormatter, '<a attr=1></a>')).rejects.toThrow();
    await expect(run(xmlFormatter, '<a></a><b></b>')).rejects.toThrow();
    await expect(run(xmlFormatter, 'just text')).rejects.toThrow();
    await expect(run(xmlFormatter, '   ')).rejects.toThrow(/empty/);
  });
});

describe('SVG minifier', () => {
  it('shrinks SVG without changing what it draws', async () => {
    const result = await run(svgMinifier, SVG_SAMPLE);
    const output = result.output ?? '';
    expect(output.length).toBeLessThan(SVG_SAMPLE.length * 0.6);
    expect(output).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(output).toContain('viewBox="0 0 120 120"');
    expect(output).not.toContain('<!--');
    expect(output).not.toContain('<metadata');
    expect(output).not.toContain('gradient-fill');
    expect(output).toContain('<circle cx="60" cy="60" r="44"');
    expect(result.preview).toMatchObject({ kind: 'svg', svg: output });
  });

  it('honours options', async () => {
    expect(await out(svgMinifier, SVG_SAMPLE, { keepIds: true })).toContain('gradient-fill');
    const noDimensions = await out(svgMinifier, SVG_SAMPLE, { dimensions: true });
    expect(noDimensions).not.toMatch(/<svg[^>]* width=/);
    expect(noDimensions).toContain('viewBox="0 0 120 120"');
    expect(await out(svgMinifier, SVG_SAMPLE, { pretty: true })).toContain('\n  <');
    expect(await out(svgMinifier, '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1.23456 2.34567L3.45678 4.56789"/></svg>', { precision: 1 })).toContain('1.2 2.3');
  });

  it('reports parse errors', async () => {
    await expect(run(svgMinifier, '<svg><g></svg>')).rejects.toThrow(/line 1/);
  });
});
