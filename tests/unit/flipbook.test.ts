import { describe, expect, it } from 'vitest';
import { type Book, blankPage, emptyBook, exportHtml, normaliseBook, openProject, runtimeData, saveProject, unusedAssets } from '../../src/lib/flipbook';
import { describeAction, findText, spreadOf } from '../../src/lib/flipbook-runtime.js';

const png = (n: number) => ({ name: `page${n}.png`, type: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, n]) });

function sampleBook(): Book {
  return {
    ...emptyBook(),
    title: 'Museum guide </script> & more',
    pages: [
      { id: 'cover', image: 'a1', color: '#ffffff', text: 'Welcome to the museum', hotspots: [] },
      {
        id: 'p2',
        image: 'a2',
        color: '#ffffff',
        text: 'The steam engine gallery',
        hotspots: [
          { id: 'h1', x: 0.1, y: 0.2, w: 0.3, h: 0.1, label: 'About the engine', action: { kind: 'note', title: 'Engine', text: 'Built in 1902.' } },
          { id: 'h2', x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: '', action: { kind: 'video', media: 'v1', title: 'Running' } },
        ],
      },
      blankPage('#fff4d6'),
    ],
    contents: [{ title: 'Engines', page: 2 }],
    assets: { a1: png(1), a2: png(2), v1: { name: 'run.mp4', type: 'video/mp4', bytes: new Uint8Array([0, 0, 0, 24]) }, old: png(9) },
  };
}

describe('flipbooks', () => {
  it('keep only sensible values when read', () => {
    const book = normaliseBook(
      {
        title: 42,
        width: -5,
        pages: [
          {
            id: '../bad',
            image: 'missing',
            color: 'red',
            hotspots: [
              { x: 0.9, y: 0.9, w: 0.5, h: 0.5, action: { kind: 'link', url: 'javascript:alert(1)' } },
              { x: 0.9, y: 0.9, w: 0.5, h: 0.5, action: { kind: 'link', url: 'https://example.org/a' } },
              { x: 0, y: 0, w: 0.1, h: 0.1, action: { kind: 'page', page: 99 } },
              { x: 0, y: 0, w: 0.1, h: 0.1, action: { kind: 'video', media: 'nope' } },
            ],
          },
        ],
        contents: [
          { title: '  ', page: 1 },
          { title: 'Start', page: 7 },
        ],
        settings: { spread: 'sideways', autoFlip: -3, flipTime: 99999, background: '#ABCDEF' },
      },
      {},
    );
    expect(book.title).toBe('Untitled flipbook');
    expect(book.width).toBe(50);
    const [page] = book.pages;
    expect(page?.id).not.toBe('../bad');
    expect(page?.image).toBeNull();
    expect(page?.color).toBe('#ffffff');
    expect(page?.hotspots.map((h) => h.action)).toEqual([
      { kind: 'link', url: 'https://example.org/a' },
      { kind: 'page', page: 1 },
    ]);
    // A hotspot stays on its page.
    expect(page?.hotspots[0]?.w).toBeCloseTo(0.1, 6);
    expect(book.contents).toEqual([{ title: 'Start', page: 1 }]);
    expect(book.settings).toMatchObject({ spread: 'double', autoFlip: 0, flipTime: 3000, background: '#abcdef', hardCovers: true });
  });

  it('save to a project file and open again, without unused assets', () => {
    const book = sampleBook();
    expect(unusedAssets(book)).toEqual(['old']);
    const again = openProject(saveProject(book));
    expect(again.title).toBe(book.title);
    expect(again.pages.map((p) => p.id)).toEqual(['cover', 'p2', book.pages[2]?.id]);
    expect(again.pages[1]?.hotspots).toEqual(book.pages[1]?.hotspots);
    expect(Object.keys(again.assets).sort()).toEqual(['a1', 'a2', 'v1']);
    expect([...(again.assets.a2?.bytes ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47, 2]);
    expect(again.contents).toEqual(book.contents);
    expect(() => openProject(new Uint8Array([1, 2, 3]))).toThrow(/not a flipbook/);
  });

  it('give the reader its data with asset addresses', () => {
    const data = runtimeData(sampleBook(), (id) => `blob:${id}`);
    expect(data.pages.map((p) => p.src)).toEqual(['blob:a1', 'blob:a2', null]);
    expect(data.pages[2]?.color).toBe('#fff4d6');
    expect(data.media).toEqual({ v1: { url: 'blob:v1', type: 'video/mp4' } });
  });

  it('export as one HTML file that loads nothing from the network', () => {
    const html = exportHtml(sampleBook(), 'export function mountFlipbook() {}', 'window.St = { PageFlip: function () {} };', 'MIT License\nCopyright (c) 2020 Nodlik');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('<title>Museum guide &lt;/script&gt; &amp; more</title>');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('data:video/mp4;base64,');
    expect(html).toContain('Copyright (c) 2020 Nodlik');
    // The data cannot close its script element early.
    const data = /<script type="application\/json" id="book-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(data).not.toContain('</');
    expect(JSON.parse(data).title).toBe('Museum guide </script> & more');
    expect(html.match(/https?:\/\//g) ?? []).toEqual([]);
  });

  it('pair pages like a book and find words', () => {
    // With a cover: 0 | 1-2 | 3-4 …; without: 0-1 | 2-3 …; one at a time when narrow.
    expect([0, 1, 2, 3, 4].map((i) => spreadOf(i, 5, true, true))).toEqual([[0], [1, 2], [1, 2], [3, 4], [3, 4]]);
    expect([0, 1, 4].map((i) => spreadOf(i, 5, false, true))).toEqual([[0, 1], [0, 1], [4]]);
    expect(spreadOf(3, 5, true, false)).toEqual([3]);
    expect(spreadOf(0, 0, true, true)).toEqual([]);
    const found = findText(['The Steam engine', 'nothing here', 'another STEAM boiler'], 'steam');
    expect(found.map((f) => [f.page, f.match])).toEqual([
      [0, 'Steam'],
      [2, 'STEAM'],
    ]);
    expect(findText(['x'], '  ')).toEqual([]);
    expect(describeAction({ kind: 'page', page: 4 })).toBe('Go to page 4');
  });
});
