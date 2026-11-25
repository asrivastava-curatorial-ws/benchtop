/**
 * Sketches and mind maps inside notes: the scene, its geometry and the
 * mind-map operations.  Pure — no DOM and no drawing library — so the note
 * format can read, check and search sketches anywhere.
 *
 * A scene holds shapes ("nodes": boxes, bubbles, diamonds, clouds, sticky
 * notes and free text), connectors ("edges", which stick to the shapes they
 * join) and freehand pen strokes.  A node with a `parent` belongs to a mind
 * map: its branch is drawn from the parent, and Tidy lays the map out.
 */

export type Shape = 'rect' | 'rounded' | 'ellipse' | 'diamond' | 'cloud' | 'sticky' | 'text';
export type FillStyle = 'hachure' | 'cross-hatch' | 'solid';
export type Dash = 'solid' | 'dashed' | 'dotted';
export type Head = 'none' | 'end' | 'both';
export type Route = 'straight' | 'curved' | 'elbow';
export type Grid = 'none' | 'dots' | 'lines';

export const SHAPES: readonly Shape[] = ['rect', 'rounded', 'ellipse', 'diamond', 'cloud', 'sticky', 'text'];
export const SHAPE_LABEL: Readonly<Record<Shape, string>> = {
  rect: 'Box',
  rounded: 'Rounded box',
  ellipse: 'Bubble',
  diamond: 'Diamond',
  cloud: 'Cloud',
  sticky: 'Sticky note',
  text: 'Text',
};
const FILL_STYLES: readonly FillStyle[] = ['hachure', 'cross-hatch', 'solid'];
const DASHES: readonly Dash[] = ['solid', 'dashed', 'dotted'];
const HEADS: readonly Head[] = ['none', 'end', 'both'];
const ROUTES: readonly Route[] = ['straight', 'curved', 'elbow'];
const GRIDS: readonly Grid[] = ['none', 'dots', 'lines'];

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface SketchNode extends Box {
  readonly id: string;
  readonly shape: Shape;
  readonly text: string;
  /** Outline and text colour. */
  readonly stroke: string;
  /** 'none' or a colour. */
  readonly fill: string;
  readonly fillStyle: FillStyle;
  readonly width: number;
  readonly dash: Dash;
  /** Text size in pixels. */
  readonly font: number;
  /** Keeps the hand-drawn wobble the same from one drawing to the next. */
  readonly seed: number;
  /** The size follows the text (free text and mind-map topics). */
  readonly auto: boolean;
  /** The node this one branches from, in a mind map. */
  readonly parent?: string;
}

export interface End {
  /** The node this end sticks to; x and y are then only a fallback. */
  readonly node?: string;
  readonly x: number;
  readonly y: number;
}

export interface SketchEdge {
  readonly id: string;
  readonly from: End;
  readonly to: End;
  readonly stroke: string;
  readonly width: number;
  readonly dash: Dash;
  readonly head: Head;
  readonly route: Route;
  readonly label: string;
  readonly font: number;
  readonly seed: number;
}

export type StrokePoint = readonly [x: number, y: number, pressure: number];

export interface SketchStroke {
  readonly id: string;
  readonly points: readonly StrokePoint[];
  readonly color: string;
  readonly size: number;
}

export interface Scene {
  readonly version: 1;
  readonly nodes: readonly SketchNode[];
  readonly edges: readonly SketchEdge[];
  readonly strokes: readonly SketchStroke[];
  /** Hand-drawn (true) or clean lines. */
  readonly hand: boolean;
  /** Height of the drawing area in the note, in pixels. */
  readonly height: number;
  readonly grid: Grid;
}

/* ------------------------------------------------------------ palette -- */

export const INK = '#1e1e1e';
export const STROKES = [INK, '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#6741d9', '#0c8599', '#868e96'] as const;
export const FILLS = ['none', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#d0bfff', '#99e9f2', '#e9ecef', '#ffffff'] as const;
/** Main-branch colours of a mind map, each with the light fill of its topic. */
export const BRANCHES: readonly (readonly [stroke: string, fill: string])[] = [
  ['#e03131', '#ffc9c9'],
  ['#1971c2', '#a5d8ff'],
  ['#2f9e44', '#b2f2bb'],
  ['#f08c00', '#ffec99'],
  ['#6741d9', '#d0bfff'],
  ['#0c8599', '#99e9f2'],
];
export const STICKY = '#ffec99';
export const WIDTHS = [1, 2, 4] as const;
export const FONT_SIZES = [16, 20, 28, 36] as const;

export const DEFAULT_HEIGHT = 460;
export const MIN_HEIGHT = 200;
export const MAX_HEIGHT = 1600;
/** Space between a connector's end and the outline it sticks to. */
export const GAP = 6;
export const MAP_GAP_X = 56;
export const MAP_GAP_Y = 16;
/** Widest a self-sizing node grows before its text wraps. */
export const AUTO_WIDTH = 260;

export const lineHeight = (font: number): number => Math.round(font * 1.3);

/** Width of one line of text, in pixels.  The editor measures with the real font. */
export type Measure = (text: string, font: number, hand: boolean) => number;
/** A rough guess of text width, for when no font is at hand (tests, workers). */
export const estimate: Measure = (text, font) => [...text].length * font * 0.52;

export function emptyScene(): Scene {
  return { version: 1, nodes: [], edges: [], strokes: [], hand: true, height: DEFAULT_HEIGHT, grid: 'none' };
}

export const isEmptyScene = (scene: Scene): boolean => !scene.nodes.length && !scene.edges.length && !scene.strokes.length;

export function uid(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('');
}

export const newSeed = (): number => Math.floor(Math.random() * 2 ** 31);

/* ------------------------------------------------------------- reading -- */

const COLOR = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const color = (v: unknown, fallback: string): string => (typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : fallback);
const fillColor = (v: unknown): string => (v === 'none' ? 'none' : color(v, 'none'));
const num = (v: unknown, fallback: number, min = -1e6, max = 1e6): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => options.find((o) => o === v) ?? fallback;
const text = (v: unknown, max = 10_000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const ID = /^[\w-]{1,64}$/;

function readEnd(v: unknown): End {
  if (!isObj(v)) return { x: 0, y: 0 };
  const x = num(v.x, 0);
  const y = num(v.y, 0);
  return typeof v.node === 'string' && ID.test(v.node) ? { node: v.node, x, y } : { x, y };
}

/** A scene from stored JSON, with anything unknown or malformed dropped. */
export function readScene(v: unknown): Scene {
  if (!isObj(v)) return emptyScene();
  const seen = new Set<string>();
  const ownId = (raw: unknown): string => {
    let id = typeof raw === 'string' && ID.test(raw) ? raw : uid();
    while (seen.has(id)) id = uid();
    seen.add(id);
    return id;
  };
  const nodes: SketchNode[] = (Array.isArray(v.nodes) ? v.nodes : [])
    .filter(isObj)
    .slice(0, 2000)
    .map((n) => {
      const shape = pick(n.shape, SHAPES, 'rect');
      const node: SketchNode = {
        id: ownId(n.id),
        shape,
        x: num(n.x, 0),
        y: num(n.y, 0),
        w: num(n.w, 120, 4, 1e5),
        h: num(n.h, 60, 4, 1e5),
        text: text(n.text),
        stroke: color(n.stroke, INK),
        fill: fillColor(n.fill),
        fillStyle: pick(n.fillStyle, FILL_STYLES, 'hachure'),
        width: num(n.width, 2, 0.5, 12),
        dash: pick(n.dash, DASHES, 'solid'),
        font: num(n.font, 20, 8, 120),
        seed: Math.round(num(n.seed, 1, 0, 2 ** 31)),
        auto: n.auto === true,
      };
      return typeof n.parent === 'string' && ID.test(n.parent) ? { ...node, parent: n.parent } : node;
    });
  // Parents must exist, and a map must not loop back on itself.
  const parentOf = new Map<string, string | undefined>(nodes.map((n) => [n.id, n.parent]));
  for (const n of nodes) if (n.parent !== undefined && (n.parent === n.id || !parentOf.has(n.parent))) parentOf.set(n.id, undefined);
  for (const n of nodes) {
    const walked = new Set<string>([n.id]);
    let p = parentOf.get(n.id);
    while (p !== undefined) {
      if (p === n.id) {
        parentOf.set(n.id, undefined);
        break;
      }
      if (walked.has(p)) break;
      walked.add(p);
      p = parentOf.get(p);
    }
  }
  const tidyNodes = nodes.map((n) => {
    const parent = parentOf.get(n.id);
    if (parent === n.parent) return n;
    const { parent: _dropped, ...rest } = n;
    return parent ? { ...rest, parent } : rest;
  });
  const nodeIds = new Set(tidyNodes.map((n) => n.id));
  const end = (e: End): End => (e.node !== undefined && !nodeIds.has(e.node) ? { x: e.x, y: e.y } : e);
  const edges: SketchEdge[] = (Array.isArray(v.edges) ? v.edges : [])
    .filter(isObj)
    .slice(0, 4000)
    .map((e) => ({
      id: ownId(e.id),
      from: end(readEnd(e.from)),
      to: end(readEnd(e.to)),
      stroke: color(e.stroke, INK),
      width: num(e.width, 2, 0.5, 12),
      dash: pick(e.dash, DASHES, 'solid'),
      head: pick(e.head, HEADS, 'end'),
      route: pick(e.route, ROUTES, 'straight'),
      label: text(e.label, 1000),
      font: num(e.font, 16, 8, 120),
      seed: Math.round(num(e.seed, 1, 0, 2 ** 31)),
    }));
  const strokes: SketchStroke[] = (Array.isArray(v.strokes) ? v.strokes : [])
    .filter(isObj)
    .slice(0, 2000)
    .map((s) => ({
      id: ownId(s.id),
      points: (Array.isArray(s.points) ? s.points : [])
        .slice(0, 5000)
        .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
        .map((p): StrokePoint => [num(p[0], 0), num(p[1], 0), num(p[2], 0.5, 0, 1)]),
      color: color(s.color, INK),
      size: num(s.size, 4, 0.5, 64),
    }))
    .filter((s) => s.points.length > 0);
  return {
    version: 1,
    nodes: tidyNodes,
    edges,
    strokes,
    hand: v.hand !== false,
    height: Math.round(num(v.height, DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT)),
    grid: pick(v.grid, GRIDS, 'none'),
  };
}

/** Every word in a scene, for search: topics first, then connector labels. */
export function sceneText(scene: Scene): string {
  return [...scene.nodes.map((n) => n.text), ...scene.edges.map((e) => e.label)]
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n');
}

/* ------------------------------------------------------------ geometry -- */

export const centerOf = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const round = (v: number): number => Math.round(v * 10) / 10;

/** Where the line from a node's centre towards `toward` leaves its outline, `gap` further out. */
export function outlinePoint(n: SketchNode, toward: Point, gap = 0): Point {
  const c = centerOf(n);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return c;
  const hw = Math.max(n.w / 2, 1e-3);
  const hh = Math.max(n.h / 2, 1e-3);
  let t: number;
  if (n.shape === 'ellipse' || n.shape === 'cloud') t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (n.shape === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx), dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy));
  const out = t + gap / len;
  return { x: c.x + dx * out, y: c.y + dy * out };
}

type Side = 'left' | 'right' | 'top' | 'bottom';
function sidePoint(n: Box, side: Side, gap: number): Point {
  const c = centerOf(n);
  if (side === 'left') return { x: n.x - gap, y: c.y };
  if (side === 'right') return { x: n.x + n.w + gap, y: c.y };
  if (side === 'top') return { x: c.x, y: n.y - gap };
  return { x: c.x, y: n.y + n.h + gap };
}

export interface EdgeGeometry {
  readonly route: Route;
  /** Straight: start and end.  Curved: start, control point, end.  Elbow: four corners. */
  readonly points: readonly Point[];
  /** Where the label sits. */
  readonly mid: Point;
  /** Unit vectors along the line at each end, pointing out of it (for arrowheads). */
  readonly startDir: Point;
  readonly endDir: Point;
}

const unit = (from: Point, to: Point): Point => {
  const len = dist(from, to);
  return len < 1e-6 ? { x: 1, y: 0 } : { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
};

export type NodeIndex = ReadonlyMap<string, SketchNode>;
export const indexNodes = (scene: Scene): Map<string, SketchNode> => new Map(scene.nodes.map((n) => [n.id, n]));

export function edgeGeometry(e: SketchEdge, nodes: NodeIndex): EdgeGeometry {
  const a0 = e.from.node !== undefined ? nodes.get(e.from.node) : undefined;
  let b0 = e.to.node !== undefined ? nodes.get(e.to.node) : undefined;
  if (a0 && b0 === a0) b0 = undefined;
  const pa = a0 ? centerOf(a0) : { x: e.from.x, y: e.from.y };
  const pb = b0 ? centerOf(b0) : { x: e.to.x, y: e.to.y };
  if (e.route === 'elbow') {
    const horizontal = Math.abs(pb.x - pa.x) >= Math.abs(pb.y - pa.y);
    const a = a0 ? sidePoint(a0, horizontal ? (pb.x >= pa.x ? 'right' : 'left') : pb.y >= pa.y ? 'bottom' : 'top', GAP) : pa;
    const b = b0 ? sidePoint(b0, horizontal ? (pa.x > pb.x ? 'right' : 'left') : pa.y > pb.y ? 'bottom' : 'top', GAP) : pb;
    const points = horizontal ? [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b] : [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b];
    const [, p1, p2] = points as [Point, Point, Point, Point];
    return { route: 'elbow', points, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, startDir: unit(p1, a), endDir: unit(p2, b) };
  }
  if (e.route === 'curved') {
    const len = dist(pa, pb);
    const bend = Math.min(len * 0.25, 160);
    const n = len < 1e-6 ? { x: 0, y: 0 } : { x: -(pb.y - pa.y) / len, y: (pb.x - pa.x) / len };
    const c = { x: (pa.x + pb.x) / 2 + n.x * bend, y: (pa.y + pb.y) / 2 + n.y * bend };
    const a = a0 ? outlinePoint(a0, c, GAP) : pa;
    const b = b0 ? outlinePoint(b0, c, GAP) : pb;
    const mid = { x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y };
    return { route: 'curved', points: [a, c, b], mid, startDir: unit(c, a), endDir: unit(c, b) };
  }
  const a = a0 ? outlinePoint(a0, pb, GAP) : pa;
  const b = b0 ? outlinePoint(b0, pa, GAP) : pb;
  return { route: 'straight', points: [a, b], mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, startDir: unit(b, a), endDir: unit(a, b) };
}

/** The connector as a polyline (curves sampled), for hit tests and bounds. */
export function edgePolyline(g: EdgeGeometry): Point[] {
  if (g.route !== 'curved') return [...g.points];
  const [a, c, b] = g.points as [Point, Point, Point];
  const out: Point[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
  }
  return out;
}

export interface BranchGeometry {
  readonly a: Point;
  readonly c1: Point;
  readonly c2: Point;
  readonly b: Point;
}

/** The curve of a mind-map branch, from the parent's outline to the near side of the child. */
export function branchGeometry(child: SketchNode, parent: SketchNode): BranchGeometry {
  const right = centerOf(child).x >= centerOf(parent).x;
  const b = sidePoint(child, right ? 'left' : 'right', 0);
  const a = outlinePoint(parent, b, 0);
  const mx = (a.x + b.x) / 2;
  return { a, c1: { x: mx, y: a.y }, c2: { x: mx, y: b.y }, b };
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function polylineDistance(p: Point, points: readonly Point[]): number {
  if (points.length === 1 && points[0]) return dist(p, points[0]);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) best = Math.min(best, segmentDistance(p, a, b));
  }
  return best;
}

/** Whether `p` falls on a node, `tolerance` pixels around its outline included. */
export function nodeContains(n: SketchNode, p: Point, tolerance = 0): boolean {
  const c = centerOf(n);
  const hw = n.w / 2 + tolerance;
  const hh = n.h / 2 + tolerance;
  const dx = Math.abs(p.x - c.x);
  const dy = Math.abs(p.y - c.y);
  if (n.shape === 'ellipse' || n.shape === 'cloud') return (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh) <= 1;
  if (n.shape === 'diamond') return dx / hw + dy / hh <= 1;
  return dx <= hw && dy <= hh;
}

const strokePoints = (s: SketchStroke): Point[] => s.points.map(([x, y]) => ({ x, y }));

export type HitKind = 'node' | 'edge' | 'stroke';
export interface Hit {
  readonly kind: HitKind;
  readonly id: string;
}

/** The item under `p`, topmost first: pen strokes, then connectors, then shapes. */
export function hitTest(scene: Scene, p: Point, tolerance: number): Hit | null {
  for (let i = scene.strokes.length - 1; i >= 0; i--) {
    const s = scene.strokes[i];
    if (s && polylineDistance(p, strokePoints(s)) <= s.size / 2 + tolerance) return { kind: 'stroke', id: s.id };
  }
  const nodes = indexNodes(scene);
  for (let i = scene.edges.length - 1; i >= 0; i--) {
    const e = scene.edges[i];
    if (!e) continue;
    const g = edgeGeometry(e, nodes);
    if (polylineDistance(p, edgePolyline(g)) <= e.width / 2 + tolerance) return { kind: 'edge', id: e.id };
  }
  const node = nodeAt(scene, p, tolerance);
  return node ? { kind: 'node', id: node.id } : null;
}

/** The topmost node under `p`, leaving out `except`. */
export function nodeAt(scene: Scene, p: Point, tolerance = 0, except?: string): SketchNode | undefined {
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    const n = scene.nodes[i];
    if (n && n.id !== except && nodeContains(n, p, tolerance)) return n;
  }
  return undefined;
}

function boxOf(points: readonly Point[], pad = 0): Box | null {
  if (!points.length) return null;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

const corners = (b: Box): Point[] => [
  { x: b.x, y: b.y },
  { x: b.x + b.w, y: b.y + b.h },
];

/** The box around one item. */
export function itemBox(scene: Scene, id: string, nodes: NodeIndex = indexNodes(scene)): Box | null {
  const n = nodes.get(id);
  if (n) return { x: n.x, y: n.y, w: n.w, h: n.h };
  const e = scene.edges.find((x) => x.id === id);
  if (e) return boxOf(edgePolyline(edgeGeometry(e, nodes)), e.width);
  const s = scene.strokes.find((x) => x.id === id);
  return s ? boxOf(strokePoints(s), s.size / 2) : null;
}

/** The box around everything in the scene, or null when it is empty. */
export function sceneBounds(scene: Scene): Box | null {
  const nodes = indexNodes(scene);
  const points: Point[] = [];
  for (const n of scene.nodes) points.push(...corners(n));
  for (const e of scene.edges) {
    const b = itemBox(scene, e.id, nodes);
    if (b) points.push(...corners(b));
    if (e.label.trim()) {
      const g = edgeGeometry(e, nodes);
      points.push({ x: g.mid.x - e.font * 2, y: g.mid.y - e.font }, { x: g.mid.x + e.font * 2, y: g.mid.y + e.font });
    }
  }
  for (const s of scene.strokes) {
    const b = boxOf(strokePoints(s), s.size / 2);
    if (b) points.push(...corners(b));
  }
  return boxOf(points);
}

/** Items lying wholly inside `box`. */
export function itemsInside(scene: Scene, box: Box): Set<string> {
  const nodes = indexNodes(scene);
  const inside = (b: Box | null) => b !== null && b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h;
  const ids = new Set<string>();
  for (const item of [...scene.nodes, ...scene.edges, ...scene.strokes]) if (inside(itemBox(scene, item.id, nodes))) ids.add(item.id);
  return ids;
}

/* --------------------------------------------------------------- text -- */

/** The share of a node's box its text may use, across and down. */
const INNER: Readonly<Record<Shape, readonly [number, number]>> = {
  rect: [1, 1],
  rounded: [1, 1],
  sticky: [1, 1],
  text: [1, 1],
  ellipse: [0.72, 0.72],
  cloud: [0.64, 0.6],
  diamond: [0.52, 0.52],
};
const padding = (shape: Shape): readonly [number, number] => (shape === 'text' ? [4, 2] : [12, 8]);

/** Where a node's text goes. */
export function innerBox(n: SketchNode): Box {
  const [fx, fy] = INNER[n.shape];
  const [px, py] = padding(n.shape);
  const w = n.w * fx;
  const h = n.h * fy;
  return { x: n.x + (n.w - w) / 2 + px, y: n.y + (n.h - h) / 2 + py, w: Math.max(1, w - 2 * px), h: Math.max(1, h - 2 * py) };
}

/** Breaks text into lines no wider than `maxWidth`; words longer than that are split. */
export function wrapText(value: string, maxWidth: number, font: number, hand: boolean, measure: Measure): string[] {
  const limit = Math.max(maxWidth, font);
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const token of paragraph.match(/\S+\s*|\s+/g) ?? []) {
      if (measure((line + token).trimEnd(), font, hand) <= limit) {
        line += token;
        continue;
      }
      if (line) lines.push(line.trimEnd());
      let rest = [...token];
      // A word wider than the box goes over several lines.
      while (rest.length > 1 && measure(rest.join('').trimEnd(), font, hand) > limit) {
        let lo = 1;
        let hi = rest.length - 1;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (measure(rest.slice(0, mid).join(''), font, hand) <= limit) lo = mid;
          else hi = mid - 1;
        }
        lines.push(rest.slice(0, lo).join(''));
        rest = rest.slice(lo);
      }
      line = rest.join('');
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** A node resized to its text: self-sizing nodes fit it both ways; others only grow taller. */
export function fitNode(n: SketchNode, hand: boolean, measure: Measure): SketchNode {
  const [fx, fy] = INNER[n.shape];
  const [px, py] = padding(n.shape);
  const lh = lineHeight(n.font);
  if (n.auto) {
    const lines = wrapText(n.text, AUTO_WIDTH, n.font, hand, measure);
    const textWidth = Math.max(n.font * (n.shape === 'text' ? 1 : 3), ...lines.map((l) => measure(l, n.font, hand)));
    const w = Math.ceil((textWidth + 2 * px + 2) / fx);
    const h = Math.ceil((lines.length * lh + 2 * py) / fy);
    return w === n.w && h === n.h ? n : { ...n, x: round(n.x + (n.w - w) / 2), y: round(n.y + (n.h - h) / 2), w, h };
  }
  const lines = wrapText(n.text, innerBox(n).w, n.font, hand, measure);
  const h = Math.ceil((lines.length * lh + 2 * py) / fy);
  return h > n.h ? { ...n, h } : n;
}

/* ---------------------------------------------------------- mind maps -- */

/** Children of every node, in the order they appear. */
export function childIndex(scene: Scene): Map<string, SketchNode[]> {
  const index = new Map<string, SketchNode[]>();
  for (const n of scene.nodes) {
    if (n.parent === undefined) continue;
    const list = index.get(n.parent);
    if (list) list.push(n);
    else index.set(n.parent, [n]);
  }
  return index;
}

export const childrenOf = (scene: Scene, id: string): SketchNode[] => scene.nodes.filter((n) => n.parent === id);

export function descendantsOf(scene: Scene, id: string): Set<string> {
  const kids = childIndex(scene);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const next = stack.pop();
    for (const k of (next !== undefined && kids.get(next)) || []) {
      if (out.has(k.id) || k.id === id) continue;
      out.add(k.id);
      stack.push(k.id);
    }
  }
  return out;
}

/** The ids given, with every node below them in their maps. */
export function withDescendants(scene: Scene, ids: Iterable<string>): Set<string> {
  const out = new Set<string>(ids);
  for (const id of [...out]) for (const d of descendantsOf(scene, id)) out.add(d);
  return out;
}

export function rootOf(scene: Scene, id: string): SketchNode | undefined {
  const nodes = indexNodes(scene);
  let n = nodes.get(id);
  const seen = new Set<string>();
  while (n?.parent !== undefined && !seen.has(n.id)) {
    seen.add(n.id);
    const up = nodes.get(n.parent);
    if (!up) break;
    n = up;
  }
  return n;
}

export function depthOf(scene: Scene, id: string): number {
  const nodes = indexNodes(scene);
  let depth = 0;
  let n = nodes.get(id);
  while (n?.parent !== undefined && depth < 1000) {
    n = nodes.get(n.parent);
    depth++;
  }
  return depth;
}

/** Whether the node is part of a mind map (it has a parent or children). */
export const isMapNode = (scene: Scene, id: string): boolean => scene.nodes.some((n) => n.parent === id || (n.id === id && n.parent !== undefined));

/** Which side of its map a node grows towards: 1 right, -1 left. */
function sideOf(n: SketchNode, nodes: NodeIndex): 1 | -1 {
  let child = n;
  let parent = n.parent !== undefined ? nodes.get(n.parent) : undefined;
  if (!parent) return 1;
  // The side is set by the main branch the node hangs from.
  let guard = 0;
  while (parent.parent !== undefined && guard++ < 1000) {
    const up = nodes.get(parent.parent);
    if (!up) break;
    child = parent;
    parent = up;
  }
  return centerOf(child).x >= centerOf(parent).x ? 1 : -1;
}

/** Lays a map out from its root: branches left and right, each subtree stacked without overlaps. */
export function layoutTree(scene: Scene, rootId: string): Scene {
  const nodes = indexNodes(scene);
  const root = nodes.get(rootId);
  if (!root) return scene;
  const kids = childIndex(scene);
  // Siblings keep the order they are drawn in, top to bottom.
  const sorted = (list: readonly SketchNode[]) => [...list].sort((a, b) => centerOf(a).y - centerOf(b).y);
  const heights = new Map<string, number>();
  const measureTree = (n: SketchNode, depth: number): number => {
    const list = depth < 200 ? (kids.get(n.id) ?? []) : [];
    const total = list.reduce((sum, k) => sum + measureTree(k, depth + 1), 0) + MAP_GAP_Y * Math.max(0, list.length - 1);
    const h = Math.max(n.h, total);
    heights.set(n.id, h);
    return h;
  };
  measureTree(root, 0);
  const placed = new Map<string, Point>();
  const place = (list: readonly SketchNode[], side: 1 | -1, parent: Box, depth: number) => {
    if (depth > 200) return;
    const ordered = sorted(list);
    const total = ordered.reduce((sum, k) => sum + (heights.get(k.id) ?? k.h), 0) + MAP_GAP_Y * Math.max(0, ordered.length - 1);
    let top = parent.y + parent.h / 2 - total / 2;
    for (const k of ordered) {
      const sub = heights.get(k.id) ?? k.h;
      const x = side > 0 ? parent.x + parent.w + MAP_GAP_X : parent.x - MAP_GAP_X - k.w;
      const y = top + sub / 2 - k.h / 2;
      placed.set(k.id, { x: round(x), y: round(y) });
      place(kids.get(k.id) ?? [], side, { x, y, w: k.w, h: k.h }, depth + 1);
      top += sub + MAP_GAP_Y;
    }
  };
  const rc = centerOf(root);
  const first = kids.get(root.id) ?? [];
  place(
    first.filter((k) => centerOf(k).x >= rc.x),
    1,
    root,
    0,
  );
  place(
    first.filter((k) => centerOf(k).x < rc.x),
    -1,
    root,
    0,
  );
  if (!placed.size) return scene;
  return {
    ...scene,
    nodes: scene.nodes.map((n) => {
      const p = placed.get(n.id);
      return p && (p.x !== n.x || p.y !== n.y) ? { ...n, x: p.x, y: p.y } : n;
    }),
  };
}

/** Lays out the maps the given nodes belong to (every map when none are given). */
export function tidy(scene: Scene, ids?: Iterable<string>): Scene {
  const kids = childIndex(scene);
  let roots: string[];
  if (ids) {
    roots = [...new Set([...ids].map((id) => rootOf(scene, id)?.id).filter((id): id is string => id !== undefined))];
  } else roots = scene.nodes.filter((n) => n.parent === undefined && kids.has(n.id)).map((n) => n.id);
  return roots.reduce((s, id) => layoutTree(s, id), scene);
}

function topicStyle(depth: number, branch: readonly [string, string]): Pick<SketchNode, 'shape' | 'stroke' | 'fill' | 'fillStyle' | 'width' | 'dash' | 'font'> {
  return depth <= 1
    ? { shape: 'rounded', stroke: branch[0], fill: branch[1], fillStyle: 'solid', width: 2, dash: 'solid', font: 20 }
    : { shape: 'rounded', stroke: branch[0], fill: 'none', fillStyle: 'solid', width: 1, dash: 'solid', font: 16 };
}

/** Adds an empty topic under `parentId` and tidies the map.  Returns the new scene and topic id. */
export function addChild(scene: Scene, parentId: string, measure: Measure): { scene: Scene; id: string } {
  const nodes = indexNodes(scene);
  const parent = nodes.get(parentId);
  if (!parent) return { scene, id: '' };
  const kids = childrenOf(scene, parentId);
  const depth = depthOf(scene, parentId) + 1;
  let side: 1 | -1;
  let branch: readonly [string, string];
  if (parent.parent === undefined) {
    const right = kids.filter((k) => centerOf(k).x >= centerOf(parent).x).length;
    side = right <= kids.length - right ? 1 : -1;
    const used = new Set(kids.map((k) => k.stroke));
    branch = BRANCHES.find(([s]) => !used.has(s)) ?? BRANCHES[kids.length % BRANCHES.length] ?? [INK, 'none'];
  } else {
    side = sideOf(parent, nodes);
    branch = [parent.stroke, parent.fill];
  }
  const sameSide = kids.filter((k) => (centerOf(k).x >= centerOf(parent).x ? 1 : -1) === side);
  const lowest = sameSide.reduce((y, k) => Math.max(y, k.y + k.h), Number.NEGATIVE_INFINITY);
  const base: SketchNode = {
    id: uid(),
    ...topicStyle(depth, branch),
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    text: '',
    seed: newSeed(),
    auto: true,
    parent: parentId,
  };
  const sized = fitNode(base, scene.hand, measure);
  const x = side > 0 ? parent.x + parent.w + MAP_GAP_X : parent.x - MAP_GAP_X - sized.w;
  const y = Number.isFinite(lowest) ? lowest + MAP_GAP_Y : parent.y + parent.h / 2 - sized.h / 2;
  const child = { ...sized, x, y };
  const next = { ...scene, nodes: [...scene.nodes, child] };
  return { scene: layoutTree(next, rootOf(next, parentId)?.id ?? parentId), id: child.id };
}

/** Adds an empty topic just below `id`, under the same parent, and tidies the map. */
export function addSibling(scene: Scene, id: string, measure: Measure): { scene: Scene; id: string } {
  const n = scene.nodes.find((x) => x.id === id);
  if (n?.parent === undefined) return { scene, id: '' };
  const sized = fitNode({ ...n, id: uid(), text: '', seed: newSeed(), auto: true }, scene.hand, measure);
  const c = centerOf(n);
  // Just below this topic, so it lands right after it when the map is tidied.
  const sibling = { ...sized, x: c.x - sized.w / 2, y: c.y + 0.05 - sized.h / 2 };
  const at = scene.nodes.indexOf(n) + 1;
  const next = { ...scene, nodes: [...scene.nodes.slice(0, at), sibling, ...scene.nodes.slice(at)] };
  return { scene: layoutTree(next, rootOf(next, id)?.id ?? id), id: sibling.id };
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/** The topic to move to from `id` with an arrow key: parent, nearest child, or the sibling above or below. */
export function neighbour(scene: Scene, id: string, direction: Direction): string | undefined {
  const nodes = indexNodes(scene);
  const n = nodes.get(id);
  if (!n) return undefined;
  const c = centerOf(n);
  const nearest = (list: readonly SketchNode[]) => [...list].sort((a, b) => Math.abs(centerOf(a).y - c.y) - Math.abs(centerOf(b).y - c.y))[0]?.id;
  const kids = childrenOf(scene, id);
  if (direction === 'left' || direction === 'right') {
    const want = direction === 'right' ? 1 : -1;
    if (n.parent === undefined) return nearest(kids.filter((k) => (centerOf(k).x >= c.x ? 1 : -1) === want));
    const side = sideOf(n, nodes);
    return side === want ? nearest(kids) : n.parent;
  }
  if (n.parent === undefined) return undefined;
  const parent = nodes.get(n.parent);
  if (!parent) return undefined;
  const side = (k: SketchNode) => (centerOf(k).x >= centerOf(parent).x ? 1 : -1);
  const row = childrenOf(scene, n.parent)
    .filter((k) => side(k) === side(n))
    .sort((a, b) => centerOf(a).y - centerOf(b).y);
  const at = row.findIndex((k) => k.id === id);
  return row[direction === 'up' ? at - 1 : at + 1]?.id;
}

/* ------------------------------------------------------------- editing -- */

export function moveItems(scene: Scene, ids: ReadonlySet<string>, dx: number, dy: number): Scene {
  if (!ids.size || (dx === 0 && dy === 0)) return scene;
  const shift = (e: End): End => (e.node === undefined ? { x: round(e.x + dx), y: round(e.y + dy) } : e);
  return {
    ...scene,
    nodes: scene.nodes.map((n) => (ids.has(n.id) ? { ...n, x: round(n.x + dx), y: round(n.y + dy) } : n)),
    edges: scene.edges.map((e) => (ids.has(e.id) ? { ...e, from: shift(e.from), to: shift(e.to) } : e)),
    strokes: scene.strokes.map((s) => (ids.has(s.id) ? { ...s, points: s.points.map(([x, y, p]): StrokePoint => [round(x + dx), round(y + dy), p]) } : s)),
  };
}

/** Removes items; a mind-map topic takes its branches with it, and a shape its connectors. */
export function removeItems(scene: Scene, ids: ReadonlySet<string>): Scene {
  if (!ids.size) return scene;
  const gone = withDescendants(
    scene,
    scene.nodes.filter((n) => ids.has(n.id)).map((n) => n.id),
  );
  const attached = (e: End) => e.node !== undefined && gone.has(e.node);
  return {
    ...scene,
    nodes: scene.nodes.filter((n) => !gone.has(n.id)),
    edges: scene.edges.filter((e) => !ids.has(e.id) && !attached(e.from) && !attached(e.to)),
    strokes: scene.strokes.filter((s) => !ids.has(s.id)),
  };
}

export function updateNode(scene: Scene, id: string, patch: Partial<Omit<SketchNode, 'id'>>): Scene {
  return { ...scene, nodes: scene.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export function updateEdge(scene: Scene, id: string, patch: Partial<Omit<SketchEdge, 'id'>>): Scene {
  return { ...scene, edges: scene.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

/** Copies of the items, offset a little; connectors come along when both their shapes do. */
export function duplicateItems(scene: Scene, ids: ReadonlySet<string>, offset = 20): { scene: Scene; ids: Set<string> } {
  const map = new Map<string, string>();
  const nodes = scene.nodes.filter((n) => ids.has(n.id));
  for (const n of nodes) map.set(n.id, uid());
  const copies: SketchNode[] = nodes.map((n) => {
    const { parent, ...rest } = n;
    const copy = { ...rest, id: map.get(n.id) ?? uid(), x: n.x + offset, y: n.y + offset, seed: newSeed() };
    const newParent = parent !== undefined ? map.get(parent) : undefined;
    return newParent ? { ...copy, parent: newParent } : copy;
  });
  const end = (e: End): End | null => {
    if (e.node === undefined) return { x: e.x + offset, y: e.y + offset };
    const id = map.get(e.node);
    return id ? { node: id, x: e.x + offset, y: e.y + offset } : null;
  };
  const edges: SketchEdge[] = [];
  for (const e of scene.edges) {
    const from = end(e.from);
    const to = end(e.to);
    const bothCopied = e.from.node !== undefined && e.to.node !== undefined && from && to;
    if ((ids.has(e.id) || bothCopied) && from && to) {
      const id = uid();
      map.set(e.id, id);
      edges.push({ ...e, id, from, to, seed: newSeed() });
    }
  }
  const strokes = scene.strokes
    .filter((s) => ids.has(s.id))
    .map((s) => {
      const id = uid();
      map.set(s.id, id);
      return { ...s, id, points: s.points.map(([x, y, p]): StrokePoint => [x + offset, y + offset, p]) };
    });
  return {
    scene: { ...scene, nodes: [...scene.nodes, ...copies], edges: [...scene.edges, ...edges], strokes: [...scene.strokes, ...strokes] },
    ids: new Set([...copies.map((n) => n.id), ...edges.map((e) => e.id), ...strokes.map((s) => s.id)]),
  };
}

/* ----------------------------------------------------------- starters -- */

interface NodeStyle {
  readonly stroke?: string;
  readonly fill?: string;
  readonly fillStyle?: FillStyle;
  readonly width?: number;
  readonly dash?: Dash;
  readonly font?: number;
}

/** A new node of `shape` filling `box`. */
export function makeNode(shape: Shape, box: Box, style: NodeStyle = {}, id = uid()): SketchNode {
  const sticky = shape === 'sticky';
  return {
    id,
    shape,
    x: round(box.x),
    y: round(box.y),
    w: round(Math.max(box.w, 4)),
    h: round(Math.max(box.h, 4)),
    text: '',
    stroke: style.stroke ?? INK,
    fill: sticky ? (style.fill && style.fill !== 'none' ? style.fill : STICKY) : (style.fill ?? 'none'),
    fillStyle: sticky ? 'solid' : (style.fillStyle ?? 'hachure'),
    width: sticky ? 1 : (style.width ?? 2),
    dash: style.dash ?? 'solid',
    font: style.font ?? 20,
    seed: newSeed(),
    auto: shape === 'text',
  };
}

/** The size a shape gets from a click without a drag. */
export function defaultSize(shape: Shape): { w: number; h: number } {
  if (shape === 'text') return { w: 40, h: 34 };
  if (shape === 'sticky') return { w: 160, h: 140 };
  if (shape === 'diamond') return { w: 150, h: 100 };
  if (shape === 'cloud') return { w: 180, h: 110 };
  if (shape === 'ellipse') return { w: 150, h: 90 };
  return { w: 160, h: 80 };
}

export function makeEdge(from: End, to: End, style: { stroke?: string; width?: number; dash?: Dash; head?: Head; route?: Route; font?: number } = {}, id = uid()): SketchEdge {
  return {
    id,
    from,
    to,
    stroke: style.stroke ?? INK,
    width: style.width ?? 2,
    dash: style.dash ?? 'solid',
    head: style.head ?? 'end',
    route: style.route ?? 'straight',
    label: '',
    font: Math.min(style.font ?? 16, 20),
    seed: newSeed(),
  };
}

/** A mind map's central topic, centred on `at`. */
export function mindMapRoot(at: Point, hand: boolean, measure: Measure, text = 'Main idea'): SketchNode {
  const root = fitNode({ ...makeNode('ellipse', { x: at.x, y: at.y, w: 0, h: 0 }, { stroke: INK, fill: '#ffec99', fillStyle: 'solid', width: 2, font: 28 }), text, auto: true }, hand, measure);
  return { ...root, x: round(at.x - root.w / 2), y: round(at.y - root.h / 2) };
}

/** A small flowchart to start from: start, a step, a decision with yes and no, and the end. */
export function flowchartStarter(at: Point, hand: boolean, measure: Measure): { nodes: SketchNode[]; edges: SketchEdge[] } {
  const top = at.y - 204;
  const node = (shape: Shape, text: string, x: number, y: number, w: number, h: number, fill: string) =>
    fitNode({ ...makeNode(shape, { x: at.x + x, y: top + y, w, h }, { fill, fillStyle: hand ? 'hachure' : 'solid' }), text }, hand, measure);
  const start = node('ellipse', 'Start', -65, 0, 130, 52, '#b2f2bb');
  const step = node('rounded', 'Do the step', -85, 94, 170, 58, 'none');
  const check = node('diamond', 'Done?', -80, 196, 160, 96, '#ffec99');
  const end = node('ellipse', 'End', -65, 356, 130, 52, '#ffc9c9');
  const redo = node('rounded', 'Fix it', 150, 214, 130, 60, 'none');
  const link = (a: SketchNode, b: SketchNode, label = '', route: Route = 'straight') => ({
    ...makeEdge({ node: a.id, ...centerOf(a) }, { node: b.id, ...centerOf(b) }, { route }),
    label,
  });
  return {
    nodes: [start, step, check, end, redo],
    edges: [link(start, step), link(step, check), link(check, end, 'yes'), link(check, redo, 'no'), link(redo, step, '', 'curved')],
  };
}

/** Clamps the drawing area's height to what a note allows. */
export const clampHeight = (h: number): number => Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h)));
