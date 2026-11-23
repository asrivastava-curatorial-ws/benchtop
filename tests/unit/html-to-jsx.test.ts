import { describe, expect, it } from 'vitest';
import { htmlToJsx } from '../../src/lib/html-to-jsx';
import tool from '../../src/tools/text/html-to-jsx';

const jsx = (html: string, options = {}) => htmlToJsx(html, options).code.trim();

describe('HTML to JSX', () => {
  it('renames attributes and turns styles into objects', () => {
    expect(jsx('<label class="x" for="q" tabindex="1">Q</label>')).toBe('<label className="x" htmlFor="q" tabIndex="1">Q</label>');
    expect(jsx('<div style="background-color: #fff; --accent: red; -webkit-transition: all 1s; -ms-flex: 1; opacity: .5; background: url(\'a;b.png\')"></div>')).toBe(
      "<div style={{ backgroundColor: '#fff', '--accent': 'red', WebkitTransition: 'all 1s', msFlex: 1, opacity: .5, background: 'url(\\'a;b.png\\')' }} />",
    );
    expect(jsx('<input disabled readonly maxlength="4" data-id="7" aria-label="Code">')).toBe('<input disabled readOnly maxLength="4" data-id="7" aria-label="Code" />');
  });

  it('keeps the spaces the browser would show and escapes braces', () => {
    expect(jsx('<b>a</b> <i>b</i>')).toBe('<>\n  <b>a</b> <i>b</i>\n</>');
    expect(jsx('<p>Price {50} &amp; more&nbsp;today</p>')).toBe("<p>Price {'{'}50{'}'} &amp; more&nbsp;today</p>");
    const long = jsx(`<p>Start <a href="/x">${'link text '.repeat(10).trim()}</a> end</p>`);
    expect(long).toContain("Start{' '}\n");
    expect(long).toContain("</a>{' '}\n");
    expect(jsx('<pre>  a\n    b</pre>')).toBe('<pre>{"  a\\n    b"}</pre>');
  });

  it('camel-cases SVG attributes and keeps SVG tag case', () => {
    expect(jsx('<svg viewBox="0 0 1 1"><linearGradient id="g"><stop stop-color="red"/></linearGradient><use xlink:href="#a"/></svg>')).toBe(
      '<svg viewBox="0 0 1 1">\n  <linearGradient id="g"><stop stopColor="red" /></linearGradient>\n  <use xlinkHref="#a" />\n</svg>',
    );
  });

  it('gives form fields default values and moves selected to the select', () => {
    expect(jsx('<input type="checkbox" checked value="a&quot;b">')).toBe('<input type="checkbox" defaultChecked defaultValue={"a\\"b"} />');
    expect(jsx('<select><option>1</option><option selected>2</option></select>')).toBe('<select defaultValue="2">\n  <option>1</option>\n  <option>2</option>\n</select>');
    expect(jsx('<textarea>Hi\nthere</textarea>')).toBe('<textarea defaultValue={"Hi\\nthere"} />');
    expect(jsx('<input value="x">', { uncontrolled: false })).toBe('<input value="x" />');
  });

  it('wraps comments, scripts and handlers and warns about them', () => {
    const result = htmlToJsx('<div onclick="go(1)"><!-- a */ b --><script>run()</script></div>');
    expect(result.code).toContain('onClick={(event) => { go(1); }}');
    expect(result.code).toContain('{/* a * / b */}');
    expect(result.code).toContain('dangerouslySetInnerHTML={{ __html: "run()" }}');
    expect(result.warnings).toHaveLength(2);
  });

  it('converts the body of a whole page into a named component', () => {
    const code = htmlToJsx('<!DOCTYPE html><html><head><title>T</title></head><body><main><h1>Hi</h1></main></body></html>', { component: 'gallery card' }).code;
    expect(code).toBe('export default function GalleryCard() {\n  return (\n    <main><h1>Hi</h1></main>\n  );\n}\n');
  });

  it('runs as a tool with its sample', async () => {
    const result = await tool.run(tool.input ? (tool.input.sample ?? '') : '', { component: true, name: 'GalleryCard', uncontrolled: true, indent: '2' }, { input2: '', file: null, nonce: 0 });
    if (typeof result === 'string') throw new Error('expected a result object');
    expect(result.output).toContain('export default function GalleryCard()');
    expect(result.output).toContain('<select name="slot" defaultValue="14:00">');
    expect(result.output).toContain('strokeLinecap="round"');
    expect(result.filename).toBe('GalleryCard.jsx');
  });
});
