import { describe, expect, it } from 'vitest';
import {
  alignMoves,
  arcToCubics,
  boundsOf,
  boxToBox,
  deleteNode,
  ellipsePath,
  emptyDrawing,
  exportDxf,
  exportSvg,
  flatten,
  importSvg,
  makeLayer,
  makeShape,
  moveHandle,
  moveNode,
  nearestOn,
  parsePathData,
  pathData,
  readColour,
  readTransform,
  rectPath,
  rotation,
  setNodeKind,
  snapBox,
  splitSegment,
  transformPaths,
} from '../../src/lib/vector';

const close = (a: number, b: number, tolerance = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tolerance);

describe('path data', () => {
  it('reads every command, relative or not, into cubic nodes', () => {
    const [path] = parsePathData('M10 10 h20 v20 l-20 0 z');
    expect(path?.closed).toBe(true);
    expect(path?.nodes.map((n) => [n.x, n.y])).toEqual([
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ]);
    expect(pathData(parsePathData('M10 10 h20 v20 l-20 0 z'))).toBe('M10 10L30 10L30 30L10 30Z');
    expect(pathData(parsePathData('M0,0 C10,0 20,10 20,20 S30,40 40,40'))).toBe('M0 0C10 0 20 10 20 20C20 30 30 40 40 40');
    expect(pathData(parsePathData('M0 0 Q30 0 30 30 T60 60'))).toBe('M0 0C20 0 30 10 30 30C30 50 40 60 60 60');
    expect(pathData(parsePathData('m1 1 2 2 3 3'))).toBe('M1 1L3 3L6 6');
    expect(pathData(parsePathData('M0 0L5 5M10 10L20 20'))).toBe('M0 0L5 5M10 10L20 20');
    expect(pathData(parsePathData('M1.5.5-2-3e1'))).toBe('M1.5 0.5L-2 -30');
    expect(parsePathData('')).toEqual([]);
    expect(() => parsePathData('L1 1 X')).toThrow();
    expect(() => parsePathData('M0 0 Z 5 5')).toThrow();
  });

  it('turns arcs into curves that stay on the ellipse', () => {
    const pieces = arcToCubics(10, 0, 10, 10, 0, false, true, 0, 10);
    expect(pieces).toHaveLength(1);
    const [path] = parsePathData('M10 0A10 10 0 0 1 0 10');
    const middle = flatten(path as never, 0.001).map(([x, y]) => Math.hypot(x, y));
    for (const radius of middle) close(radius, 10, 0.01);
    // Flags written without spaces, and a full circle in two arcs.
    const circle = parsePathData('M10 0a10 10 0 1110-10a10 10 0 11-10 10z');
    expect(circle).toHaveLength(1);
    const box = boundsOf(parsePathData('M-10 0A10 10 0 0 1 10 0A10 10 0 0 1 -10 0Z'));
    close(box?.y ?? 0, -10, 0.01);
    close(box?.h ?? 0, 20, 0.02);
  });

  it('closes on the first node when a curve ends there', () => {
    const [path] = parsePathData(pathData([ellipsePath(50, 50, 20, 10)]));
    expect(path?.nodes).toHaveLength(4);
    expect(path?.nodes.every((n) => n.smooth)).toBe(true);
    expect(boundsOf([path as never])).toEqual({ x: 30, y: 40, w: 40, h: 20 });
  });
});

describe('geometry', () => {
  it('finds exact bounds and flattens within a tolerance', () => {
    const ellipse = ellipsePath(0, 0, 100, 50);
    const points = flatten(ellipse, 0.05);
    expect(points.length).toBeGreaterThan(30);
    for (const [x, y] of points) expect(Math.abs((x / 100) ** 2 + (y / 50) ** 2 - 1)).toBeLessThan(0.002);
    expect(flatten(rectPath(0, 0, 10, 5))).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ]);
  });

  it('transforms, and maps one box to another', () => {
    const turned = transformPaths([rectPath(0, 0, 10, 20)], rotation(90, 0, 0));
    const box = boundsOf(turned);
    close(box?.x ?? 0, -20);
    close(box?.w ?? 0, 20);
    close(box?.h ?? 0, 10);
    const moved = transformPaths([ellipsePath(5, 5, 5, 5)], boxToBox({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 50, w: 40, h: 20 }));
    expect(boundsOf(moved)).toEqual({ x: 100, y: 50, w: 40, h: 20 });
  });

  it('splits a curve without changing its shape, and finds the nearest place', () => {
    const ellipse = ellipsePath(0, 0, 100, 50);
    const split = splitSegment(ellipse, 0, 0.5);
    expect(split.nodes).toHaveLength(5);
    const added = split.nodes[1];
    close((added?.x ?? 0) ** 2 / 10000 + (added?.y ?? 0) ** 2 / 2500, 1, 0.001);
    for (const [x, y] of flatten(split, 0.05)) expect(Math.abs((x / 100) ** 2 + (y / 50) ** 2 - 1)).toBeLessThan(0.002);
    const near = nearestOn(rectPath(0, 0, 100, 100), 50, -8);
    expect(near?.index).toBe(0);
    close(near?.t ?? 0, 0.5, 0.001);
    close(near?.distance ?? 0, 8, 0.001);
    expect(splitSegment(rectPath(0, 0, 10, 10), 3, 0.5).nodes[4]).toEqual({ x: 0, y: 5, smooth: false });
  });

  it('edits nodes: move, handles, kind, delete', () => {
    const ellipse = ellipsePath(0, 0, 10, 10);
    const moved = moveNode(ellipse, 0, 20, 5);
    expect(moved.nodes[0]?.hin?.[0]).toBe(20);
    close(moved.nodes[0]?.hout?.[1] ?? 0, 5 + 5.522847498, 1e-6);
    // A smooth node's other handle turns to stay in line, keeping its length.
    const pulled = moveHandle(ellipse, 0, 'hout', 10, 20);
    const node = pulled.nodes[0];
    close(node?.hin?.[0] ?? 0, 10);
    close(node?.hin?.[1] ?? 0, -5.522847498, 1e-6);
    const cornered = setNodeKind(ellipse, 0, 'corner');
    expect(cornered.nodes[0]).toEqual({ x: 10, y: 0, smooth: false });
    const smoothed = setNodeKind(rectPath(0, 0, 30, 30), 1, 'smooth');
    expect(smoothed.nodes[1]?.smooth).toBe(true);
    close(smoothed.nodes[1]?.hin?.[0] ?? 0, 30 - 10 / Math.SQRT2, 1e-6);
    expect(deleteNode(rectPath(0, 0, 10, 10), 0)?.nodes).toHaveLength(3);
    expect(
      deleteNode(
        {
          closed: false,
          nodes: [
            { x: 0, y: 0, smooth: false },
            { x: 1, y: 1, smooth: false },
          ],
        },
        0,
      ),
    ).toBeNull();
  });
});

describe('alignment and snapping', () => {
  const boxes = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 30, y: 5, w: 20, h: 10 },
    { x: 90, y: 40, w: 10, h: 10 },
  ];
  const frame = { x: 0, y: 0, w: 200, h: 100 };

  it('aligns several shapes to the box around them, one shape to the page', () => {
    expect(alignMoves(boxes, 'left', frame).map((m) => m.dx)).toEqual([0, -30, -90]);
    expect(alignMoves(boxes, 'bottom', frame).map((m) => m.dy)).toEqual([40, 35, 0]);
    expect(alignMoves(boxes, 'hcentre', frame).map((m) => m.dx)).toEqual([45, 10, -45]);
    expect(alignMoves([boxes[0] as never], 'hcentre', frame)).toEqual([{ dx: 95, dy: 0 }]);
    expect(alignMoves([boxes[0] as never], 'bottom', frame)).toEqual([{ dx: 0, dy: 90 }]);
  });

  it('spreads shapes with equal gaps', () => {
    // 100 wide in all, 40 taken: gaps of 30.
    expect(alignMoves(boxes, 'hspace', frame).map((m) => m.dx)).toEqual([0, 10, 0]);
    expect(alignMoves(boxes.slice(0, 2), 'hspace', frame)).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
  });

  it('snaps to edges and centres of other shapes before the grid', () => {
    const others = [{ x: 100, y: 100, w: 50, h: 50 }];
    const options = { threshold: 5, grid: 10, objects: true };
    const edge = snapBox({ x: 47, y: 12, w: 50, h: 20 }, others, options);
    expect(edge.dx).toBe(3); // the right edge meets x = 100
    expect(edge.guides).toContainEqual({ x: 100 });
    expect(edge.dy).toBe(-2); // nothing near: the top goes to the grid
    const centre = snapBox({ x: 111, y: 300, w: 30, h: 10 }, others, options);
    expect(centre.dx).toBe(-1); // centres in line at x = 125
    expect(snapBox({ x: 47, y: 12, w: 50, h: 20 }, others, { ...options, objects: false }).dx).toBe(3);
    expect(snapBox({ x: 44, y: 12, w: 50, h: 20 }, others, { threshold: 5, grid: 0, objects: false })).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});

describe('SVG and DXF files', () => {
  const svg = `<?xml version="1.0"?>
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100mm" height="50mm" viewBox="0 0 200 100">
      <defs><linearGradient id="g"/></defs>
      <g inkscape:label="Outline" inkscape:groupmode="layer" fill="none" stroke="#f00" stroke-width="2">
        <rect x="10" y="10" width="40" height="20"/>
        <g transform="translate(100 0) scale(2)"><circle cx="10" cy="10" r="5" style="fill: rgb(0, 128, 255); stroke: none"/></g>
      </g>
      <g id="hidden" style="display:none"><polygon points="0,0 10,0 10,10"/></g>
      <path d="M0 0L200 100" stroke="blue" fill="url(#g)"/>
      <text x="5" y="5">Label</text>
    </svg>`;

  it('reads layers, shapes, styles, transforms and real sizes', () => {
    const { drawing, notes } = importSvg(svg);
    expect([drawing.width, drawing.height, drawing.unit]).toEqual([100, 50, 'mm']);
    expect(drawing.layers.map((l) => [l.name, l.visible, l.shapes.length])).toEqual([
      ['Outline', true, 2],
      ['hidden', false, 1],
      ['Layer 3', true, 1],
    ]);
    const [rect, circle] = drawing.layers[0]?.shapes ?? [];
    // The view box is 200 wide for 100 mm: everything is halved.
    expect(boundsOf(rect?.paths ?? [])).toEqual({ x: 5, y: 5, w: 20, h: 10 });
    expect([rect?.fill, rect?.stroke, rect?.strokeWidth]).toEqual(['none', '#ff0000', 1]);
    const box = boundsOf(circle?.paths ?? []);
    close(box?.x ?? 0, 55, 1e-6);
    close(box?.w ?? 0, 10, 1e-6);
    expect([circle?.fill, circle?.stroke]).toEqual(['#0080ff', 'none']);
    expect(drawing.layers[2]?.shapes[0]?.fill).toBe('#808080');
    expect(notes.join(' ')).toContain('Gradients');
    expect(notes.join(' ')).toContain('1 element that is not a shape was left out');
    expect(() => importSvg('<html/>')).toThrow('not an SVG');
  });

  it('writes SVG that reads back the same', () => {
    const { drawing } = importSvg(svg);
    const written = exportSvg(drawing);
    expect(written).toContain('width="100mm"');
    expect(written).toContain('inkscape:label="Outline"');
    expect(written).toContain('style="display:none"');
    const again = importSvg(written).drawing;
    expect(again.layers.map((l) => l.shapes.map((s) => pathData(s.paths)))).toEqual(drawing.layers.map((l) => l.shapes.map((s) => pathData(s.paths))));
    expect(again.layers.map((l) => [l.name, l.visible])).toEqual(drawing.layers.map((l) => [l.name, l.visible]));
    expect(again.layers[0]?.shapes[0]?.strokeWidth).toBe(1);
  });

  it('reads colours and transform lists', () => {
    expect(readColour('#abc')).toBe('#aabbcc');
    expect(readColour('RGB(255, 0, 50%)')).toBe('#ff0080');
    expect(readColour('none')).toBe('none');
    expect(readColour('Teal')).toBe('#008080');
    expect(readColour('url(#g)')).toBeNull();
    expect(readTransform('translate(10, 20) scale(2)')).toEqual([2, 0, 0, 2, 10, 20]);
    const turn = readTransform('rotate(90 10 10)');
    close(turn[4], 20);
    close(turn[5], 0);
  });

  it('writes a DXF with layers, polylines in millimetres and y pointing up', () => {
    const drawing = {
      ...emptyDrawing(100, 50, 'mm'),
      layers: [
        makeLayer('Cut lines', [makeShape('square', [rectPath(10, 10, 20, 20)])]),
        { ...makeLayer('Notes ünïcode'), visible: false },
        makeLayer('Cut lines', [
          makeShape('line', [
            {
              closed: false,
              nodes: [
                { x: 0, y: 0, smooth: false },
                { x: 100, y: 50, smooth: false },
              ],
            },
          ]),
        ]),
      ],
    };
    const dxf = exportDxf(drawing, { tolerance: 0.05, scale: 1, hiddenLayers: false });
    const pairs = dxf.trim().split('\n');
    expect(pairs.length % 2).toBe(0);
    expect(pairs.slice(-2)).toEqual(['0', 'EOF']);
    expect(dxf).toContain('AC1009');
    expect(dxf).toContain('\n2\nCUT_LINES\n');
    expect(dxf).toContain('\n2\nCUT_LINES_2\n');
    expect(dxf).not.toContain('NOTES');
    expect(dxf.match(/\n0\nPOLYLINE\n/g)).toHaveLength(2);
    expect(dxf.match(/\n0\nVERTEX\n/g)).toHaveLength(6);
    // The square's first corner (10, 10) from the top is at y = 40 from the bottom; it is closed.
    expect(dxf).toContain('POLYLINE\n8\nCUT_LINES\n66\n1\n70\n1\n0\nVERTEX\n8\nCUT_LINES\n10\n10\n20\n40\n30\n0.0');
    expect(exportDxf(drawing, { tolerance: 0.05, scale: 25.4 / 96, hiddenLayers: true })).toContain('NOTES_UNICODE');
    const curved = exportDxf({ ...emptyDrawing(100, 100, 'mm'), layers: [makeLayer('C', [makeShape('circle', [ellipsePath(50, 50, 40, 40)])])] }, { tolerance: 0.01, scale: 1, hiddenLayers: false });
    expect((curved.match(/VERTEX/g) ?? []).length).toBeGreaterThan(60);
  });
});
