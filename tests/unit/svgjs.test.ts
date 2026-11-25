import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CODE_OFFSET, FRAME_POLICY, frameHtml, RUNNER } from '../../scripts/svgjs-frame.mjs';
import { EXAMPLES, readFrameMessage, standalonePage, svgSize, tidySvg } from '../../src/lib/svgjs';

const LIBRARY = readFileSync(new URL('../../node_modules/@svgdotjs/svg.js/dist/svg.min.js', import.meta.url), 'utf8');

describe('the SVG.js drawing frame', () => {
  it('is a page with the library inside it and nothing to load', () => {
    const html = frameHtml(LIBRARY);
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">`);
    expect(FRAME_POLICY).toContain("connect-src 'none'");
    expect(FRAME_POLICY).toContain("default-src 'none'");
    expect(html).toContain('@svgdotjs/svg.js v3');
    // Nothing is fetched: no script, style sheet or picture has an address.
    expect(html).not.toMatch(/<script[^>]+src=|<link\b|<img\b|@import/);
    // Nothing inside the scripts ends them early.
    expect(html.match(/<script>/g)).toHaveLength(2);
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(frameHtml('var a = "</script><script>alert(1)</script>";').match(/<\/script>/g)).toHaveLength(2);
  });

  it('has scripts that parse, and counts the lines its wrapper adds', () => {
    expect(() => new Function(RUNNER)).not.toThrow();
    for (const example of EXAMPLES) expect(() => new Function(example.code), example.name).not.toThrow();
    expect(new Set(EXAMPLES.map((example) => example.name)).size).toBe(EXAMPLES.length);
    // "new Function" puts two lines before the body: an error on the body's line 3 is reported on line 5.
    let line = 0;
    try {
      new Function('\n\nnull.x;\n//# sourceURL=drawing.js')();
    } catch (error) {
      line = Number(/drawing\.js:(\d+)/.exec(String((error as Error).stack))?.[1]);
    }
    expect(line - CODE_OFFSET).toBe(3);
  });

  it('reads what the frame says with suspicion', () => {
    expect(readFrameMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(readFrameMessage({ type: 'log', level: 'shout', text: 'hi' })).toEqual({ type: 'log', level: 'log', text: 'hi' });
    expect(readFrameMessage({ type: 'log', level: 'warn', text: 'x'.repeat(9000) })).toMatchObject({ level: 'warn', text: 'x'.repeat(4000) });
    expect(readFrameMessage({ type: 'error', text: 'Boom', line: 4.7 })).toEqual({ type: 'error', text: 'Boom', line: 4 });
    expect(readFrameMessage({ type: 'error', line: -3 })).toEqual({ type: 'error', text: 'Error', line: 0 });
    expect(readFrameMessage({ type: 'snapshot', id: 2, svg: '<svg/>' })).toEqual({ type: 'snapshot', id: 2, svg: '<svg/>' });
    expect(readFrameMessage({ type: 'snapshot', id: 'x', svg: '<svg/>' })).toBeNull();
    expect(readFrameMessage({ type: 'navigate', url: 'https://example.org' })).toBeNull();
    expect(readFrameMessage('ready')).toBeNull();
    expect(readFrameMessage(null)).toBeNull();
  });

  it('saves drawings without scripts and with their namespace', () => {
    const saved = tidySvg('<svg width="300" height="200" onload="steal()"><script>steal()</script><rect width="10" height="10" onclick="x()"/></svg>');
    expect(saved).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" ><rect width="10" height="10" /></svg>');
    expect(tidySvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"/>')).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"/>');
    expect(() => tidySvg('')).toThrow(/empty/);
    expect(() => tidySvg('<html></html>')).toThrow(/empty/);
    expect(svgSize('<svg width="300" height="200.5">')).toEqual({ width: 300, height: 200.5 });
    expect(svgSize('<svg viewBox="0 0 640 360" width="100%">')).toEqual({ width: 640, height: 360 });
    expect(svgSize('<svg>')).toBeNull();
  });

  it('writes a page that runs the code on its own', () => {
    const page = standalonePage('const draw2 = 1; // </script><!-- x\ndraw.rect(10, 10);', LIBRARY, {
      title: 'A <b>drawing</b>',
      width: 640.4,
      height: 360,
      background: 'red; } body { display: none',
      licence: 'MIT -- text',
    });
    expect(page).toContain('<title>A &lt;b&gt;drawing&lt;/b&gt;</title>');
    expect(page).toContain('window.width = 640;');
    expect(page).toContain('background: #ffffff;');
    expect(page).toContain('draw.rect(10, 10);');
    expect(page.match(/<\/script>/g)).toHaveLength(2);
    expect(page).toContain('MIT - - text');
    const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] as string);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});
