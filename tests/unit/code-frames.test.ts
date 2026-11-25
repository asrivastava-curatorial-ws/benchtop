import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRAME_POLICY as SVGJS_POLICY } from '../../scripts/svgjs-frame.mjs';
import { ANIME_EXAMPLES, checkDataFile, codeFrameHtml, D3_EXAMPLES, D3_FILES, FRAME_POLICY, runner, standaloneCodePage } from '../../src/lib/code-frames';

const D3 = readFileSync(new URL('../../node_modules/d3/dist/d3.min.js', import.meta.url), 'utf8');

describe('the D3.js and anime.js frames', () => {
  it('are pages with the library inside and nothing to load', () => {
    expect(FRAME_POLICY).toBe(SVGJS_POLICY);
    for (const kind of ['d3', 'anime'] as const) {
      const html = codeFrameHtml(kind, kind === 'd3' ? D3 : 'var anime = {};');
      expect(html).toContain(`content="${FRAME_POLICY}"`);
      expect(html).not.toMatch(/<script[^>]+src=|<link\b|<img\b|@import/);
      expect(html.match(/<\/script>/g)).toHaveLength(2);
      expect(() => new Function(runner(kind))).not.toThrow();
    }
    expect(codeFrameHtml('d3', 'var a = "</script><script>alert(1)</script>";').match(/<\/script>/g)).toHaveLength(2);
  });

  it('has examples that parse and sample data that reads', () => {
    for (const example of [...D3_EXAMPLES, ...ANIME_EXAMPLES]) expect(() => new Function(example.code), example.name).not.toThrow();
    expect(new Set(D3_EXAMPLES.map((e) => e.name)).size).toBe(D3_EXAMPLES.length);
    expect(D3_FILES.map((f) => f.name)).toEqual(['fruit.csv', 'rainfall.csv', 'network.json']);
    const network = JSON.parse(D3_FILES[2]?.text ?? '{}') as { nodes: { id: string }[]; links: { source: string; target: string }[] };
    const ids = new Set(network.nodes.map((n) => n.id));
    for (const l of network.links) expect(ids.has(l.source) && ids.has(l.target)).toBe(true);
  });

  it('checks data files', () => {
    expect(checkDataFile('a.csv', 'x')).toBeNull();
    expect(checkDataFile('a.geojson', '{}')).toBeNull();
    expect(checkDataFile('a.exe', 'x')).toMatch(/CSV, TSV, JSON/);
    expect(checkDataFile('big.csv', 'x'.repeat(2_000_001))).toMatch(/2 MB/);
  });

  it('writes pages that run on their own, data inside', () => {
    const page = standaloneCodePage('d3', 'svg.append("rect"); // </script>', 'var d3 = {};', {
      title: 'A <chart>',
      width: 640.6,
      height: 400,
      background: 'url(x)',
      files: [{ name: 'a.csv', text: 'x\n1\n</script>' }],
      licence: 'ISC -- text',
    });
    expect(page).toContain('<title>A &lt;chart&gt;</title>');
    expect(page).toContain('"width":641');
    expect(page).toContain('background: #ffffff;');
    expect(page).toContain('ISC - - text');
    expect(page.match(/<\/script>/g)).toHaveLength(2);
    const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] as string);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});
