import { degrees, type PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, type PDFRef } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  type Annotation,
  caretAt,
  commentsMarkdown,
  geometryOf,
  hits,
  moveBy,
  type PageGeometry,
  parsePdfDate,
  pdfDate,
  readAnnotations,
  removeAnnotations,
  saveAnnotations,
  selectText,
  toPdf,
  toView,
  viewSize,
  wrapText,
} from '../../src/lib/pdf-annotate';
import type { TextItem } from '../../src/lib/pdf-redact';

const common = { opacity: 1, comment: '', author: 'Reader', modified: '2026-11-25T10:00:00.000Z' };

async function twoPages(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  doc.addPage([600, 800]).setRotation(degrees(90));
  return doc;
}

const close = (a: readonly number[], b: readonly number[], digits = 2) => {
  a.forEach((v, i) => {
    expect(v).toBeCloseTo(b[i] as number, digits);
  });
};

describe('PDF annotations', () => {
  it('maps the shown page to user space and back for every rotation', () => {
    for (const rotate of [0, 90, 180, 270] as const) {
      const g: PageGeometry = { view: [10, 20, 610, 820], rotate };
      const size = viewSize(g);
      expect(size).toEqual(rotate % 180 ? { width: 800, height: 600 } : { width: 600, height: 800 });
      for (const p of [
        [0, 0],
        [size.width, size.height],
        [123.5, 45.25],
      ] as const) {
        close(toView(g, toPdf(g, p)), p, 6);
      }
    }
    // Unrotated: the top left of the view is the top left of the crop box.
    expect(toPdf({ view: [10, 20, 610, 820], rotate: 0 }, [0, 0])).toEqual([10, 820]);
    // Turned a quarter clockwise: the top left of the view is the bottom left of the page.
    expect(toPdf({ view: [10, 20, 610, 820], rotate: 90 }, [0, 0])).toEqual([10, 20]);
  });

  it('reads the shown part of a page like PDF.js', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(50, 60, 400, 500);
    page.setRotation(degrees(-90));
    expect(geometryOf(page)).toEqual({ view: [50, 60, 450, 560], rotate: 270 });
  });

  it('selects text between two carets, one band per line', () => {
    const items: TextItem[] = [
      { text: 'Hello ', x: 10, y: 10, w: 40, h: 12 },
      { text: 'world', x: 50, y: 10, w: 40, h: 12 },
      { text: 'Second line', x: 10, y: 30, w: 80, h: 12 },
    ];
    const a = caretAt(items, [12, 15]);
    const b = caretAt(items, [70, 15]);
    expect(a).toEqual({ item: 0, char: 0 });
    expect(b).toEqual({ item: 1, char: 2 });
    const one = selectText(items, a as never, b as never);
    expect(one.text).toBe('Hello wo');
    expect(one.boxes).toHaveLength(1);
    // Backwards and across lines; a point off to the right lands at the end of the line.
    const two = selectText(items, caretAt(items, [56, 36]) as never, caretAt(items, [200, 14]) as never);
    expect(two.text).toBe('Second');
    const three = selectText(items, caretAt(items, [30, 14]) as never, caretAt(items, [56, 36]) as never);
    expect(three.text).toBe('lo world Second');
    expect(three.boxes).toHaveLength(2);
    expect(caretAt([], [0, 0])).toBeNull();
  });

  it('wraps the words of a text box', () => {
    const mono = (s: string) => [...s].length * 0.5;
    expect(wrapText('The quick brown fox', 50, 10, mono)).toEqual(['The quick', 'brown fox']);
    expect(wrapText('abcdefghijklmnopqrstuvwxyz', 50, 10, mono)).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxyz']);
    expect(wrapText('One\n\nTwo', 50, 10, mono)).toEqual(['One', '', 'Two']);
  });

  it('saves every kind with an appearance and reads it back', async () => {
    const doc = await twoPages();
    const written: Annotation[] = [
      { ...common, id: 'h1', page: 1, kind: 'highlight', color: '#ffd400', boxes: [{ x: 50, y: 100, w: 200, h: 14 }], text: 'marked words', comment: 'Check this' },
      { ...common, id: 'u1', page: 1, kind: 'underline', color: '#0072b2', boxes: [{ x: 50, y: 140, w: 120, h: 14 }], text: 'under' },
      { ...common, id: 'n1', page: 2, kind: 'note', color: '#ffd400', at: [100, 50], comment: 'A note on a turned page' },
      { ...common, id: 't1', page: 2, kind: 'text', color: '#d55e00', box: { x: 200, y: 300, w: 160, h: 40 }, text: 'Typed on the page', size: 12 },
      {
        ...common,
        id: 'i1',
        page: 1,
        kind: 'ink',
        color: '#009e73',
        width: 2,
        strokes: [
          [
            [10, 10],
            [20, 30],
            [40, 35],
          ],
        ],
      },
      { ...common, id: 'r1', page: 1, kind: 'rect', color: '#cc79a7', width: 2, fill: null, box: { x: 300, y: 400, w: 100, h: 50 } },
      { ...common, id: 'e1', page: 2, kind: 'ellipse', color: '#56b4e9', width: 1, fill: '#ffffff', box: { x: 400, y: 100, w: 80, h: 40 } },
      { ...common, id: 'a1', page: 2, kind: 'arrow', color: '#000000', width: 1.5, from: [50, 500], to: [250, 450] },
    ];
    await saveAnnotations(doc, { write: written, remove: [], flatten: false });
    const saved = await PDFDocument.load(await doc.save());
    const first = saved.getPage(0).node.Annots() as PDFArray;
    expect(first.size()).toBe(4);
    const highlight = saved.context.lookup(first.get(0) as PDFRef) as PDFDict;
    expect(highlight.get(PDFName.of('Subtype'))).toEqual(PDFName.of('Highlight'));
    const ap = (highlight.get(PDFName.of('AP')) as PDFDict).get(PDFName.of('N'));
    expect(saved.context.lookup(ap as PDFRef)).toBeInstanceOf(PDFRawStream);
    const back = readAnnotations(saved);
    expect(back.map((a) => a.kind).sort()).toEqual(written.map((a) => a.kind).sort());
    const byId = new Map(back.map((a) => [a.id, a]));
    const h = byId.get('h1');
    expect(h?.kind === 'highlight' && h.boxes[0]).toEqual({ x: 50, y: 100, w: 200, h: 14 });
    expect(h?.comment).toBe('Check this');
    expect(h?.author).toBe('Reader');
    expect(h?.modified).toBe('2026-11-25T10:00:00.000Z');
    const n = byId.get('n1');
    expect(n?.kind === 'note' && n.at).toEqual([100, 50]);
    // A note hangs upright from the top left corner of its box in user space.
    const noteDict = (saved.getPage(1).node.Annots() as PDFArray)
      .asArray()
      .map((ref) => saved.context.lookup(ref as PDFRef) as PDFDict)
      .find((d) => d.get(PDFName.of('Subtype')) === PDFName.of('Text'));
    expect(String(noteDict?.get(PDFName.of('Rect')))).toBe('[ 50 80 70 100 ]');
    expect(String(noteDict?.get(PDFName.of('F')))).toBe('28');
    const t = byId.get('t1');
    expect(t?.kind === 'text' && [t.text, t.size, t.color, t.box.x, t.box.y]).toEqual(['Typed on the page', 12, '#d55e00', 200, 300]);
    const r = byId.get('r1');
    expect(r?.kind === 'rect' && r.box).toEqual({ x: 300, y: 400, w: 100, h: 50 });
    const e = byId.get('e1');
    expect(e?.kind === 'ellipse' && [e.fill, e.width]).toEqual(['#ffffff', 1]);
    const i = byId.get('i1');
    expect(i?.kind === 'ink' && i.strokes[0]?.[1]).toEqual([20, 30]);
    const arrow = byId.get('a1');
    expect(arrow?.kind === 'arrow' && [arrow.from, arrow.to]).toEqual([
      [50, 500],
      [250, 450],
    ]);
    // On the turned page the text box is drawn turned back, so it reads upright.
    const free = (saved.getPage(1).node.Annots() as PDFArray).asArray().map((ref) => saved.context.lookup(ref as PDFRef) as PDFDict);
    const box = free.find((d) => d.get(PDFName.of('Subtype')) === PDFName.of('FreeText'));
    expect(String(box?.get(PDFName.of('Rotate')))).toBe('90');
  });

  it('rewrites a changed annotation in place and removes others with their pop-ups', async () => {
    const doc = await twoPages();
    await saveAnnotations(doc, {
      write: [
        { ...common, id: 'r1', page: 1, kind: 'rect', color: '#000000', width: 1, fill: null, box: { x: 10, y: 10, w: 50, h: 50 } },
        { ...common, id: 'n1', page: 1, kind: 'note', color: '#ffd400', at: [100, 100], comment: 'Note' },
      ],
      remove: [],
      flatten: false,
    });
    const annots = doc.getPage(0).node.Annots() as PDFArray;
    const noteRef = annots.get(1) as PDFRef;
    const popup = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Popup', Parent: noteRef, Rect: [0, 0, 10, 10] }));
    annots.push(popup);
    const [rect, note] = readAnnotations(doc);
    expect(rect?.source).toBeDefined();
    const moved = moveBy({ ...(rect as Annotation), color: '#ff0000' }, 5, 5);
    await saveAnnotations(doc, { write: [moved], remove: note?.source ? [note.source] : [], flatten: false });
    const after = doc.getPage(0).node.Annots() as PDFArray;
    expect(after.size()).toBe(1);
    const again = readAnnotations(doc);
    expect(again).toHaveLength(1);
    expect(again[0]?.source).toEqual(rect?.source);
    expect(again[0]?.color).toBe('#ff0000');
    expect(again[0]?.kind === 'rect' && again[0].box.x).toBe(15);
    expect(removeAnnotations(doc, [])).toBe(0);
  });

  it('flattens annotations into the page', async () => {
    const doc = await twoPages();
    await saveAnnotations(doc, { write: [{ ...common, id: 'n', page: 1, kind: 'note', color: '#ffd400', at: [10, 10], comment: 'x' }], remove: [], flatten: false });
    const [note] = readAnnotations(doc);
    await saveAnnotations(doc, { write: [note as Annotation, { ...common, id: 'l', page: 1, kind: 'line', color: '#000000', width: 1, from: [0, 0], to: [50, 50] }], remove: [], flatten: true });
    const page = doc.getPage(0);
    expect(page.node.Annots()?.size() ?? 0).toBe(0);
    const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
    expect(xobjects?.keys()).toHaveLength(2);
    const reloaded = await PDFDocument.load(await doc.save());
    expect(readAnnotations(reloaded)).toHaveLength(0);
  });

  it('finds annotations under the pointer and moves the ones that can move', () => {
    const rect: Annotation = { ...common, id: 'r', page: 1, kind: 'rect', color: '#000000', width: 2, fill: null, box: { x: 10, y: 10, w: 100, h: 50 } };
    expect(hits(rect, [10, 30])).toBe(true);
    expect(hits(rect, [60, 35])).toBe(false);
    expect(hits({ ...rect, fill: '#ffffff' }, [60, 35])).toBe(true);
    const line: Annotation = { ...common, id: 'l', page: 1, kind: 'line', color: '#000000', width: 1, from: [0, 0], to: [100, 100] };
    expect(hits(line, [50, 51])).toBe(true);
    expect(hits(line, [50, 70])).toBe(false);
    const mark: Annotation = { ...common, id: 'h', page: 1, kind: 'highlight', color: '#ffd400', boxes: [{ x: 0, y: 0, w: 10, h: 10 }], text: '' };
    expect(moveBy(mark, 5, 5)).toBe(mark);
  });

  it('writes and reads PDF dates and sums up comments', () => {
    expect(pdfDate('2026-11-25T10:20:30.000Z')).toBe('D:20261125102030Z');
    expect(parsePdfDate("D:20261125152030+05'30'")).toBe('2026-11-25T09:50:30.000Z');
    expect(parsePdfDate('D:2026')).toBe('2026-01-01T00:00:00.000Z');
    expect(parsePdfDate('yesterday')).toBe('');
    const md = commentsMarkdown(
      [
        { ...common, id: 'h', page: 2, kind: 'highlight', color: '#ffd400', boxes: [{ x: 0, y: 0, w: 10, h: 10 }], text: 'key  point', comment: 'Agree' },
        { ...common, id: 'n', page: 1, kind: 'note', color: '#ffd400', at: [0, 0], comment: 'Start here' },
      ],
      'report.pdf',
    );
    expect(md).toBe('# Comments on report.pdf\n\n## Page 1\n\n- **Note** — Start here (Reader, 2026-11-25)\n\n## Page 2\n\n- **Highlight** — “key point” — Agree (Reader, 2026-11-25)\n');
  });
});
