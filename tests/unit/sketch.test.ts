import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { emptyNote, type Note, noteHtml, noteMarkdownZip, noteText, packNote, readNote, type SketchExport } from '../../src/lib/notes-format';
import {
  addChild,
  addSibling,
  centerOf,
  childrenOf,
  duplicateItems,
  edgeGeometry,
  emptyScene,
  estimate,
  fitNode,
  flowchartStarter,
  GAP,
  hitTest,
  indexNodes,
  itemsInside,
  layoutTree,
  makeEdge,
  makeNode,
  mindMapRoot,
  moveItems,
  neighbour,
  outlinePoint,
  readScene,
  removeItems,
  type Scene,
  type SketchNode,
  sceneBounds,
  sceneText,
  tidy,
  wrapText,
} from '../../src/lib/sketch-model';
import { renderScene, sceneSvg } from '../../src/lib/sketch-render';

const overlaps = (a: SketchNode, b: SketchNode) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function mindMap(): { scene: Scene; root: string } {
  const root = mindMapRoot({ x: 400, y: 300 }, true, estimate, 'Museum visit');
  let scene: Scene = { ...emptyScene(), nodes: [root] };
  const names = ['Galleries', 'Science shows', 'Workshops', 'Cafe', 'Shop'];
  for (const name of names) {
    const made = addChild(scene, root.id, estimate);
    scene = { ...made.scene, nodes: made.scene.nodes.map((n) => (n.id === made.id ? fitNode({ ...n, text: name }, true, estimate) : n)) };
  }
  const galleries = scene.nodes.find((n) => n.text === 'Galleries');
  for (const name of ['Engines', 'Electricity', 'Space']) {
    const made = addChild(scene, galleries?.id ?? '', estimate);
    scene = { ...made.scene, nodes: made.scene.nodes.map((n) => (n.id === made.id ? fitNode({ ...n, text: name }, true, estimate) : n)) };
  }
  return { scene: tidy(scene), root: root.id };
}

describe('Sketch scenes', () => {
  it('reads stored scenes defensively', () => {
    const scene = readScene({
      nodes: [
        { id: 'a', shape: 'ellipse', x: 10, y: 20, w: 100, h: 50, text: 'Idea', stroke: 'red" onload="alert(1)', fill: '#FFC9C9', parent: 'b' },
        { id: 'b', shape: 'blob', x: 'x', text: 7, parent: 'a' },
        { id: 'a', shape: 'rect', x: 0, y: 0, w: 1e9, h: -4, parent: 'missing' },
      ],
      edges: [{ id: 'e1', from: { node: 'a', x: 0, y: 0 }, to: { node: 'zzz', x: 5, y: 6 }, head: 'sideways', label: 'goes to' }],
      strokes: [
        { id: 's', points: [[1, 2, 0.4], [3, 4], 'bad'], color: '#123' },
        { id: 't', points: [] },
      ],
      hand: false,
      height: 99_999,
      grid: 'hex',
    });
    expect(scene.nodes).toHaveLength(3);
    const [a, b, c] = scene.nodes as [SketchNode, SketchNode, SketchNode];
    expect(a.stroke).toBe('#1e1e1e');
    expect(a.fill).toBe('#ffc9c9');
    expect(b.shape).toBe('rect');
    expect(b.text).toBe('');
    // a and b were each other's parents: the loop is broken, one link kept.
    expect([a.parent, b.parent].filter(Boolean)).toHaveLength(1);
    expect(c.id).not.toBe('a');
    expect(c.parent).toBeUndefined();
    expect(c.w).toBe(1e5);
    expect(c.h).toBe(4);
    expect(scene.edges[0]?.from.node).toBe('a');
    expect(scene.edges[0]?.to).toEqual({ x: 5, y: 6 });
    expect(scene.edges[0]?.head).toBe('end');
    expect(scene.strokes).toHaveLength(1);
    expect(scene.strokes[0]?.points).toEqual([
      [1, 2, 0.4],
      [3, 4, 0.5],
    ]);
    expect(scene.hand).toBe(false);
    expect(scene.height).toBe(1600);
    expect(scene.grid).toBe('none');
    expect(readScene('nonsense')).toEqual(emptyScene());
    expect(sceneText(scene)).toBe('Idea\ngoes to');
  });

  it('finds where connectors meet outlines', () => {
    const box = makeNode('rect', { x: 0, y: 0, w: 100, h: 50 });
    expect(outlinePoint(box, { x: 500, y: 25 })).toEqual({ x: 100, y: 25 });
    expect(outlinePoint(box, { x: 50, y: -500 })).toEqual({ x: 50, y: 0 });
    const bubble = makeNode('ellipse', { x: 0, y: 0, w: 100, h: 50 });
    const p = outlinePoint(bubble, { x: 150, y: 75 });
    expect(((p.x - 50) / 50) ** 2 + ((p.y - 25) / 25) ** 2).toBeCloseTo(1, 6);
    const diamond = makeNode('diamond', { x: 0, y: 0, w: 100, h: 100 });
    const q = outlinePoint(diamond, { x: 200, y: 200 });
    expect(q.x).toBeCloseTo(75, 6);
    expect(q.y).toBeCloseTo(75, 6);

    const a = makeNode('rect', { x: 0, y: 0, w: 100, h: 60 });
    const b = makeNode('rect', { x: 300, y: 0, w: 100, h: 60 });
    const edge = makeEdge({ node: a.id, x: 0, y: 0 }, { node: b.id, x: 0, y: 0 });
    const nodes = indexNodes({ ...emptyScene(), nodes: [a, b] });
    const g = edgeGeometry(edge, nodes);
    expect(g.points).toEqual([
      { x: 100 + GAP, y: 30 },
      { x: 300 - GAP, y: 30 },
    ]);
    expect(g.endDir).toEqual({ x: 1, y: 0 });
    // Moving a shape drags the connector's end along.
    const moved = moveItems({ ...emptyScene(), nodes: [a, b], edges: [edge] }, new Set([b.id]), 0, 200);
    const g2 = edgeGeometry(edge, indexNodes(moved));
    expect(g2.points[1]?.y).toBeLessThan(200);
    expect(g2.points[1]?.y).toBeGreaterThan(30);

    const elbow = edgeGeometry({ ...edge, route: 'elbow' }, indexNodes({ ...emptyScene(), nodes: [a, { ...b, y: 200 }] }));
    expect(elbow.points).toHaveLength(4);
    for (let i = 1; i < elbow.points.length; i++) {
      const p0 = elbow.points[i - 1];
      const p1 = elbow.points[i];
      expect(p0 && p1 && (p0.x === p1.x || p0.y === p1.y)).toBe(true);
    }
  });

  it('builds and tidies mind maps without overlaps', () => {
    const { scene, root } = mindMap();
    expect(childrenOf(scene, root)).toHaveLength(5);
    const rootNode = scene.nodes.find((n) => n.id === root);
    const sides = childrenOf(scene, root).map((k) => Math.sign(centerOf(k).x - centerOf(rootNode ?? k).x));
    expect(sides.filter((s) => s > 0).length).toBe(3);
    expect(sides.filter((s) => s < 0).length).toBe(2);
    for (let i = 0; i < scene.nodes.length; i++)
      for (let j = i + 1; j < scene.nodes.length; j++) {
        const a = scene.nodes[i];
        const b = scene.nodes[j];
        if (a && b) expect(overlaps(a, b), `${a.text} / ${b.text}`).toBe(false);
      }
    // Every main branch gets its own colour; topics below share their branch's.
    const main = childrenOf(scene, root);
    expect(new Set(main.map((k) => k.stroke)).size).toBe(5);
    const galleries = main.find((k) => k.text === 'Galleries');
    for (const k of childrenOf(scene, galleries?.id ?? '')) expect(k.stroke).toBe(galleries?.stroke);
    // Children grow away from the root, on the side of their main branch.
    for (const k of childrenOf(scene, galleries?.id ?? '')) expect(Math.sign(centerOf(k).x - centerOf(galleries ?? k).x)).toBe(Math.sign(centerOf(galleries ?? k).x - centerOf(rootNode ?? k).x));
    // Tidying again changes nothing.
    expect(layoutTree(scene, root)).toEqual(scene);
  });

  it('adds siblings in place and moves around with arrow keys', () => {
    const { scene } = mindMap();
    const engines = scene.nodes.find((n) => n.text === 'Engines');
    const made = addSibling(scene, engines?.id ?? '', estimate);
    const kids = childrenOf(made.scene, engines?.parent ?? '').sort((a, b) => a.y - b.y);
    expect(kids.map((k) => k.text)).toEqual(['Engines', '', 'Electricity', 'Space']);
    expect(addSibling(scene, scene.nodes[0]?.id ?? '', estimate).id).toBe('');
    const galleries = scene.nodes.find((n) => n.text === 'Galleries');
    const electricity = scene.nodes.find((n) => n.text === 'Electricity');
    expect(neighbour(scene, electricity?.id ?? '', 'up')).toBe(engines?.id);
    expect(neighbour(scene, electricity?.id ?? '', 'left')).toBe(galleries?.id);
    expect(neighbour(scene, galleries?.id ?? '', 'right')).toBe(electricity?.id);
  });

  it('removes topics with their branches and the connectors on them', () => {
    const { scene } = mindMap();
    const galleries = scene.nodes.find((n) => n.text === 'Galleries');
    const cafe = scene.nodes.find((n) => n.text === 'Cafe');
    const engines = scene.nodes.find((n) => n.text === 'Engines');
    const link = makeEdge({ node: engines?.id ?? '', x: 0, y: 0 }, { node: cafe?.id ?? '', x: 0, y: 0 });
    const free = makeEdge({ x: 0, y: 0 }, { x: 50, y: 50 });
    const withEdges = { ...scene, edges: [link, free] };
    const after = removeItems(withEdges, new Set([galleries?.id ?? '']));
    expect(after.nodes.map((n) => n.text).sort()).toEqual(['Cafe', 'Museum visit', 'Science shows', 'Shop', 'Workshops']);
    expect(after.edges).toEqual([free]);
  });

  it('duplicates shapes with the connectors between them', () => {
    const a = makeNode('rect', { x: 0, y: 0, w: 80, h: 40 });
    const b = makeNode('ellipse', { x: 200, y: 0, w: 80, h: 40 });
    const c = makeNode('diamond', { x: 400, y: 0, w: 80, h: 40 });
    const ab = makeEdge({ node: a.id, x: 0, y: 0 }, { node: b.id, x: 0, y: 0 });
    const bc = makeEdge({ node: b.id, x: 0, y: 0 }, { node: c.id, x: 0, y: 0 });
    const scene = { ...emptyScene(), nodes: [a, b, c], edges: [ab, bc] };
    const copy = duplicateItems(scene, new Set([a.id, b.id]));
    expect(copy.scene.nodes).toHaveLength(5);
    expect(copy.scene.edges).toHaveLength(3);
    const added = copy.scene.edges[2];
    expect(added && copy.ids.has(added.from.node ?? '') && copy.ids.has(added.to.node ?? '')).toBe(true);
    expect(copy.ids.size).toBe(3);
  });

  it('hits, boxes and selects items', () => {
    const a = makeNode('ellipse', { x: 0, y: 0, w: 100, h: 60 });
    const scene: Scene = {
      ...emptyScene(),
      nodes: [a],
      strokes: [
        {
          id: 'pen',
          points: [
            [200, 200, 0.5],
            [260, 220, 0.5],
          ],
          color: '#1e1e1e',
          size: 4,
        },
      ],
    };
    expect(hitTest(scene, { x: 50, y: 30 }, 2)?.id).toBe(a.id);
    expect(hitTest(scene, { x: 2, y: 2 }, 2)).toBeNull();
    expect(hitTest(scene, { x: 230, y: 210 }, 2)?.kind).toBe('stroke');
    expect(sceneBounds(scene)).toEqual({ x: 0, y: 0, w: 262, h: 222 });
    expect([...itemsInside(scene, { x: -10, y: -10, w: 150, h: 100 })]).toEqual([a.id]);
  });

  it('wraps text and sizes nodes to it', () => {
    expect(wrapText('one two three', 60, 10, true, estimate)).toEqual(['one two', 'three']);
    expect(wrapText('a\n\nb', 100, 10, true, estimate)).toEqual(['a', '', 'b']);
    const long = wrapText('Supercalifragilistic', 52, 10, true, estimate);
    expect(long.length).toBeGreaterThan(1);
    expect(long.join('')).toBe('Supercalifragilistic');
    const topic = fitNode({ ...makeNode('rounded', { x: 0, y: 0, w: 10, h: 10 }), auto: true, text: 'A longer topic name' }, true, estimate);
    expect(topic.w).toBeGreaterThan(100);
    const fixed = fitNode({ ...makeNode('rect', { x: 0, y: 0, w: 100, h: 30 }), text: 'This text needs several lines in a narrow box' }, true, estimate);
    expect(fixed.w).toBe(100);
    expect(fixed.h).toBeGreaterThan(30);
  });

  it('draws the same picture every time, hand-drawn or clean', () => {
    const { nodes, edges } = flowchartStarter({ x: 300, y: 250 }, true, estimate);
    const scene: Scene = {
      ...emptyScene(),
      nodes: [...nodes, { ...makeNode('sticky', { x: 500, y: 50, w: 140, h: 120 }), text: '<b>Tom & Jerry</b>' }],
      edges,
      strokes: [
        {
          id: 'pen',
          points: [
            [10, 10, 0.5],
            [40, 30, 0.5],
            [80, 20, 0.5],
            [120, 60, 0.5],
          ],
          color: '#e03131',
          size: 5,
        },
      ],
    };
    const svg = sceneSvg(scene, { measure: estimate, background: '#ffffff', title: 'Plan' });
    expect(sceneSvg(scene, { measure: estimate, background: '#ffffff', title: 'Plan' })).toBe(svg);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('&lt;b&gt;Tom &amp;');
    expect(svg).toContain('Jerry&lt;/b&gt;');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('Done?');
    expect(svg).toContain('font-family="Kalam');
    const clean = sceneSvg({ ...scene, hand: false }, { measure: estimate, fontCss: '@font-face{font-family:x}' });
    expect(clean).toContain('font-family="Barlow');
    expect(clean).toContain('<style><![CDATA[@font-face{font-family:x}]]></style>');
    const items = renderScene(scene, estimate);
    expect(items.filter((i) => i.kind === 'edge')).toHaveLength(5);
    expect(items.find((i) => i.kind === 'edge' && i.text?.lines[0] === 'yes')?.text?.backing).toBeDefined();
    expect(items.find((i) => i.kind === 'stroke')?.pieces[0]?.d).toMatch(/^M[\d.-]+ [\d.-]+Q/);
  });
});

describe('Sketches in notes', () => {
  const sketchNote = (): Note => {
    const { scene } = mindMap();
    const note = emptyNote('Visit plan');
    return { ...note, blocks: [...note.blocks, { id: 'sketch-1', type: 'sketch', scene }] };
  };

  it('keeps sketches when a note is saved and read back, and finds their words', () => {
    const note = sketchNote();
    const back = readNote(JSON.parse(JSON.stringify(note)));
    expect(back.blocks[1]).toEqual(note.blocks[1]);
    expect(noteText(back)).toContain('Science shows');
    expect(noteText(back)).toContain('Electricity');
  });

  it('exports sketches as pictures, or as their words without the drawing code', () => {
    const note = sketchNote();
    const plain = noteHtml(note, () => '');
    expect(plain).toContain('<figure class="note-sketch"><ul><li>Museum visit</li>');
    const sketch: SketchExport = { css: '@font-face{font-family:Kalam}', svg: (s) => `<svg data-nodes="${s.nodes.length}"></svg>`, file: () => '<svg xmlns="http://www.w3.org/2000/svg"/>' };
    const drawn = noteHtml(
      note,
      () => '',
      (h) => h,
      undefined,
      sketch,
    );
    expect(drawn).toContain('<figure class="note-sketch"><svg data-nodes="9"></svg></figure>');
    expect(drawn).toContain('@font-face{font-family:Kalam}');
    const zip = unzipSync(noteMarkdownZip(note, new Map(), (h) => h, sketch.file));
    expect(Object.keys(zip)).toContain('sketches/sketch-1.svg');
    expect(strFromU8(zip['note.md'] ?? new Uint8Array())).toContain('![Sketch: Museum visit](sketches/sketch-1.svg)');
    const words = unzipSync(noteMarkdownZip(note, new Map(), (h) => h));
    expect(strFromU8(words['note.md'] ?? new Uint8Array())).toContain('- Workshops');
    const bnote = unzipSync(packNote(note, new Map(), (h) => h, sketch));
    expect(strFromU8(bnote['index.html'] ?? new Uint8Array())).toContain('data-nodes="9"');
  });
});
