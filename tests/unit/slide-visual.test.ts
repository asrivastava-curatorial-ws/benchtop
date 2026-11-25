import { describe, expect, it } from 'vitest';
import {
  elementStyle,
  fromMarkdown,
  insertSlide,
  joinDeck,
  layoutSlide,
  moveSlide,
  positionOf,
  readElement,
  readVisual,
  removeSlide,
  replaceSlide,
  resizeBox,
  type SlideElement,
  slideTitle,
  snapMove,
  splitDeck,
  visualHtml,
  visualSource,
} from '../../src/lib/slide-visual';
import { countSlides, splitSlides } from '../../src/lib/slides';

const SIZE = { width: 1280, height: 720 };
const text = (more: Record<string, unknown> = {}) => readElement({ kind: 'text', id: 't1', x: 100, y: 80, w: 600, h: 120, text: 'Hello', size: 64, ...more }) as SlideElement;

describe('designed slides', () => {
  it('keeps a slide in the deck as one block of HTML, and reads it back', () => {
    const slide = {
      background: '#0d1117',
      notes: 'Say hello.\nThen wait.',
      elements: [
        text({ text: 'Tea & <b>cake</b>\nat "four"', bold: true, color: '#F0F6FC', align: 'left' }),
        readElement({ kind: 'shape', id: 's1', shape: 'ellipse', x: 900, y: 400, w: 200, h: 200, fill: '#1f6feb', opacity: 0.5, rotate: 15 }) as SlideElement,
        readElement({ kind: 'image', id: 'p1', x: 10, y: 20, w: 300, h: 200, src: 'data:image/png;base64,AAAA', alt: 'A "kettle"', fit: 'cover' }) as SlideElement,
      ],
    };
    const source = visualSource(slide, SIZE);
    expect(source.startsWith('<!-- .slide: data-background-color="#0d1117" -->\n<div class="bt-visual" style="position:relative;width:1280px;height:720px;margin:0;text-align:left">\n')).toBe(true);
    // No empty line inside the block: Markdown would end the HTML there.
    expect(visualHtml(slide, SIZE)).not.toMatch(/\n\s*\n/);
    expect(source).toContain('>Tea &amp; &lt;b&gt;cake&lt;/b&gt;<br>at &quot;four&quot;</div>');
    expect(source).toContain('alt="A &quot;kettle&quot;" src="data:image/png;base64,AAAA">');
    expect(source.endsWith('\n\nNote: Say hello.\nThen wait.')).toBe(true);
    // The picture's bytes are written once, not again inside the element's data.
    expect(source.match(/AAAA/g)).toHaveLength(1);
    const again = readVisual(source);
    expect(again).toEqual(slide);
    // As one slide among written ones, it is still found, and the deck's slides are counted as before.
    const deck = `# Start\n\n---\n\n${source}\n\n---\n\n## End\n`;
    expect(countSlides(deck)).toBe(3);
    expect(readVisual(splitSlides(deck)[1]?.[0] ?? '')).toEqual(slide);
    expect(readVisual('# A written slide')).toBeNull();
    // A block with other writing beside it is left to the Markdown editor.
    expect(readVisual(`Some words\n\n${visualHtml(slide, SIZE)}`)).toBeNull();
    expect(readVisual(`${visualHtml(slide, SIZE)}\n\nMore words`)).toBeNull();
  });

  it('checks what it reads from a deck file', () => {
    expect(readElement({ kind: 'video' })).toBeNull();
    expect(readElement(null)).toBeNull();
    const odd = readElement({ kind: 'text', x: 'left', w: -5, size: 9000, color: 'red; background:url(https://example.org/x)', opacity: 7, text: 12, align: 'justify' });
    expect(odd).toMatchObject({ x: 0, w: 1, size: 600, color: '', opacity: 1, text: '', align: 'center', valign: 'middle', font: 'theme' });
    expect(readElement({ kind: 'image', src: 'https://example.org/track.png' })?.src).toBe('');
    expect(readElement({ kind: 'image', src: 'javascript:alert(1)' })?.src).toBe('');
    expect(readElement({ kind: 'image', src: 'data:image/svg+xml;base64,PHN2Zy8+' })?.src).toBe('data:image/svg+xml;base64,PHN2Zy8+');
    // Markup in a hand-edited data attribute cannot break out of the element.
    const hostile =
      '<div class="bt-visual" style="x">\n<div class="bt-el" data-v="{&quot;kind&quot;:&quot;text&quot;,&quot;text&quot;:&quot;&lt;img src=x onerror=alert(1)&gt;&quot;}" style="x">ignored</div>\n</div>';
    const read = readVisual(hostile);
    expect(read?.elements[0]?.text).toBe('<img src=x onerror=alert(1)>');
    expect(visualHtml(read ?? { elements: [], background: '', notes: '' }, SIZE)).toContain('&lt;img src=x onerror=alert(1)&gt;</div>');
  });

  it('writes the CSS for each kind of element', () => {
    expect(elementStyle(text())).toBe(
      'position:absolute;left:100px;top:80px;width:600px;height:120px;box-sizing:border-box;margin:0;display:flex;flex-direction:column;justify-content:center;text-align:center;font-size:64px;font-weight:400;font-style:normal;line-height:1.2;white-space:pre-wrap;text-transform:none;letter-spacing:normal',
    );
    const styled = elementStyle(text({ color: '#ffffff', font: 'mono', fill: '#000000', radius: 8, valign: 'bottom', rotate: -10, opacity: 0.25, italic: true }));
    expect(styled).toContain('transform:rotate(-10deg);opacity:0.25');
    expect(styled).toContain('justify-content:flex-end');
    expect(styled).toContain('color:#ffffff;font-family:ui-monospace, Menlo, Consolas, monospace;background:#000000;padding:0 0.4em;border-radius:8px');
    expect(elementStyle(readElement({ kind: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#ff0000', stroke: '#000000', strokeWidth: 2, radius: 4 }) as SlideElement)).toContain(
      'background:#ff0000;border:2px solid #000000;border-radius:4px',
    );
    expect(elementStyle(readElement({ kind: 'shape', shape: 'line', x: 0, y: 0, w: 100, h: 20 }) as SlideElement)).toContain('background:linear-gradient(#8b949e,#8b949e) center / 100% 6px no-repeat');
    expect(elementStyle(readElement({ kind: 'image', x: 0, y: 0, w: 10, h: 10 }) as SlideElement)).toContain('object-fit:contain;max-width:none;max-height:none;border:0;box-shadow:none');
  });

  it('adds, removes, moves and replaces slides, keeping columns', () => {
    const deck = '# One\n\n---\n\n## Two\n\n--\n\n## Two b\n\n---\n\n## Three\n';
    const parts = splitDeck(deck);
    expect(parts.slides.map((s) => s.trim())).toEqual(['# One', '## Two', '## Two b', '## Three']);
    expect(parts.joins).toEqual(['---', '--', '---']);
    expect(joinDeck(parts)).toBe(deck);
    expect([0, 1, 2, 3].map((i) => positionOf(parts, i))).toEqual([
      { h: 0, v: 0 },
      { h: 1, v: 0 },
      { h: 1, v: 1 },
      { h: 2, v: 0 },
    ]);
    expect(replaceSlide(deck, 2, '## Changed')).toBe('# One\n\n---\n\n## Two\n\n--\n\n## Changed\n\n---\n\n## Three\n');
    expect(insertSlide(deck, 0, '## New')).toBe('# One\n\n---\n\n## New\n\n---\n\n## Two\n\n--\n\n## Two b\n\n---\n\n## Three\n');
    expect(insertSlide(deck, 3, '## Last')).toBe(`${deck.trimEnd()}\n\n---\n\n## Last\n`);
    // Removing the head of a column hands the column to the slide below it.
    expect(removeSlide(deck, 1)).toBe('# One\n\n---\n\n## Two b\n\n---\n\n## Three\n');
    expect(removeSlide(deck, 2)).toBe('# One\n\n---\n\n## Two\n\n---\n\n## Three\n');
    expect(removeSlide(deck, 0)).toBe('## Two\n\n--\n\n## Two b\n\n---\n\n## Three\n');
    expect(removeSlide('# Only\n', 0)).toBe('# Only\n');
    expect(moveSlide(deck, 3, -1)).toBe('# One\n\n---\n\n## Two\n\n--\n\n## Three\n\n---\n\n## Two b\n');
    expect(moveSlide(deck, 0, -1)).toBe(deck);
    for (const changed of [insertSlide(deck, 1, 'x'), removeSlide(deck, 3), moveSlide(deck, 1, 1)]) expect(joinDeck(splitDeck(changed))).toBe(changed);
  });

  it('names slides for the list', () => {
    expect(slideTitle('<!-- .slide: data-background-color="#000" -->\n## The *long* road\n\ntext')).toBe('The long road');
    expect(slideTitle('![a kettle](data:image/png;base64,AAAA)')).toBe('Picture');
    expect(slideTitle('\n\n')).toBe('Empty slide');
    const slide = { background: '', notes: '', elements: [text({ text: 'small print', size: 20 }), text({ id: 't2', text: 'Big idea\nsecond line', size: 90 })] };
    expect(slideTitle(visualSource(slide, SIZE))).toBe('Big idea');
    expect(slideTitle(visualSource({ ...slide, elements: [] }, SIZE))).toBe('Empty slide');
  });

  it('lays out new slides inside the slide, whatever its size', () => {
    for (const size of [SIZE, { width: 1024, height: 768 }]) {
      for (const layout of ['title', 'content', 'two', 'picture', 'blank'] as const) {
        const slide = layoutSlide(layout, size);
        for (const e of slide.elements) {
          expect(e.x).toBeGreaterThanOrEqual(0);
          expect(e.y).toBeGreaterThanOrEqual(0);
          expect(e.x + e.w).toBeLessThanOrEqual(size.width);
          expect(e.y + e.h).toBeLessThanOrEqual(size.height);
        }
        expect(readVisual(visualSource(slide, size))).toEqual(slide);
      }
    }
    expect(layoutSlide('blank', SIZE).elements).toEqual([]);
    expect(layoutSlide('two', SIZE).elements).toHaveLength(3);
  });

  it('turns a written slide into boxes of plain text', () => {
    const made = fromMarkdown('<!-- .slide: data-background-color="#102030" -->\n## Why **tea**?\n\n- It is *warm*\n- It is `cheap`\n\n![pot](data:image/png;base64,AAAA)\n\nNote: Smile.', SIZE);
    expect(made.background).toBe('#102030');
    expect(made.notes).toBe('Smile.');
    expect(made.elements.map((e) => [e.kind, e.text ?? e.src])).toEqual([
      ['text', 'Why tea?'],
      ['text', '• It is warm\n• It is cheap'],
      ['image', 'data:image/png;base64,AAAA'],
    ]);
    // Text and picture share the width; nothing leaves the slide.
    const [, body, picture] = made.elements;
    expect((body?.x ?? 0) + (body?.w ?? 0)).toBeLessThan(picture?.x ?? 0);
    expect((picture?.x ?? 0) + (picture?.w ?? 0)).toBeLessThanOrEqual(1280);
    expect(fromMarkdown('# Only a title', SIZE).elements[0]).toMatchObject({ text: 'Only a title', align: 'center' });
  });

  it('snaps a moved box to the slide and to other boxes, and resizes from any handle', () => {
    const other = [{ x: 200, y: 300, w: 100, h: 50 }];
    // The middle of the box is 4 px left of the slide's middle: it is pulled onto it.
    expect(snapMove({ x: 536, y: 100, w: 200, h: 40 }, other, SIZE, 6)).toEqual({ x: 540, y: 100, guides: [{ axis: 'x', at: 640 }] });
    // Its top comes within reach of the other box's bottom edge.
    expect(snapMove({ x: 700, y: 353, w: 200, h: 40 }, other, SIZE, 6)).toEqual({ x: 700, y: 350, guides: [{ axis: 'y', at: 350 }] });
    expect(snapMove({ x: 417, y: 133, w: 200, h: 40 }, other, SIZE, 6).guides).toEqual([]);
    const box = { x: 100, y: 100, w: 200, h: 100 };
    expect(resizeBox(box, 'se', 50, 20, false)).toEqual({ x: 100, y: 100, w: 250, h: 120 });
    expect(resizeBox(box, 'nw', 50, 20, false)).toEqual({ x: 150, y: 120, w: 150, h: 80 });
    expect(resizeBox(box, 'w', 500, 0, false)).toEqual({ x: 292, y: 100, w: 8, h: 100 });
    // With Shift a corner keeps the box's shape (2 : 1 here), anchored at the opposite corner.
    expect(resizeBox(box, 'se', 100, 10, true)).toEqual({ x: 100, y: 100, w: 220, h: 110 });
    expect(resizeBox(box, 'nw', -100, -10, true)).toEqual({ x: 80, y: 90, w: 220, h: 110 });
    expect(resizeBox(box, 'n', 0, -40, true)).toEqual({ x: 100, y: 60, w: 200, h: 140 });
  });
});
