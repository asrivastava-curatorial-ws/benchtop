/**
 * Draws sketch scenes: hand-drawn lines with Rough.js or clean ones, and pen
 * strokes with perfect-freehand.  The editor and the exports share these
 * pieces, so a saved or exported sketch looks like the one on screen.
 */
import getStroke from 'perfect-freehand';
import type { Drawable, Options } from 'roughjs/bin/core';
import { RoughGenerator } from 'roughjs/bin/generator';
import {
  type Box,
  branchGeometry,
  type Dash,
  type EdgeGeometry,
  edgeGeometry,
  type FillStyle,
  indexNodes,
  innerBox,
  lineHeight,
  type Measure,
  type Point,
  type Scene,
  type Shape,
  type SketchEdge,
  type SketchNode,
  type SketchStroke,
  sceneBounds,
  wrapText,
} from './sketch-model';
import { escapeHtml } from './text';

export const HAND_FONT = "Kalam, 'Segoe Print', 'Comic Sans MS', cursive";
export const CLEAN_FONT = "Barlow, 'Segoe UI', system-ui, sans-serif";
export const fontFamily = (hand: boolean): string => (hand ? HAND_FONT : CLEAN_FONT);
/** The paper colour, behind connector labels and in exported pictures. */
export const PAPER = '#ffffff';

/** One SVG path of a drawing. */
export interface Piece {
  readonly d: string;
  readonly stroke: string;
  readonly width: number;
  readonly fill: string;
  readonly dash?: string;
  readonly opacity?: number;
}

export interface TextRun {
  readonly lines: readonly string[];
  /** Centre of the lines, across. */
  readonly x: number;
  /** Baseline of each line. */
  readonly ys: readonly number[];
  readonly font: number;
  readonly color: string;
  /** A box in the paper colour behind the text (connector labels). */
  readonly backing?: Box;
}

export interface RenderItem {
  readonly kind: 'branch' | 'node' | 'edge' | 'stroke';
  readonly id: string;
  /** Where the pieces are moved to: nodes are drawn at the origin, everything else in place. */
  readonly x: number;
  readonly y: number;
  readonly pieces: readonly Piece[];
  readonly text?: TextRun;
}

const rough = new RoughGenerator();
const f = (v: number): string => String(Math.round(v * 100) / 100);

const dashArray = (dash: Dash, width: number): string | undefined => {
  if (dash === 'dashed') return `${f(4 + width * 3)} ${f(4 + width * 3)}`;
  if (dash === 'dotted') return `0.1 ${f(3 + width * 2.5)}`;
  return undefined;
};

function roughOptions(seed: number, stroke: string, width: number, fill: string, fillStyle: FillStyle, dash: Dash): Options {
  return {
    seed: seed % 2 ** 31 || 1,
    stroke,
    strokeWidth: width,
    roughness: 1,
    bowing: 1,
    disableMultiStroke: dash !== 'solid',
    ...(fill !== 'none' ? { fill, fillStyle, hachureGap: Math.max(4, width * 4), fillWeight: Math.max(0.5, width / 2) } : {}),
  };
}

function piecesOf(drawable: Drawable, dash?: string): Piece[] {
  const o = drawable.options;
  return drawable.sets.map((set): Piece => {
    const d = rough.opsToPath(set, 2);
    if (set.type === 'fillPath') return { d, stroke: 'none', width: 0, fill: o.fill ?? 'none' };
    if (set.type === 'fillSketch') return { d, stroke: o.fill ?? 'none', width: o.fillWeight < 0 ? o.strokeWidth / 2 : o.fillWeight, fill: 'none' };
    return dash ? { d, stroke: o.stroke, width: o.strokeWidth, fill: 'none', dash } : { d, stroke: o.stroke, width: o.strokeWidth, fill: 'none' };
  });
}

function bounded<K, V>(cache: Map<K, V>, limit: number, key: K, make: () => V): V {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = make();
  if (cache.size >= limit) cache.clear();
  cache.set(key, value);
  return value;
}

/* -------------------------------------------------------------- shapes -- */

function roundedPath(w: number, h: number): string {
  const r = Math.min(16, w / 4, h / 4);
  return `M${f(r)} 0H${f(w - r)}Q${f(w)} 0 ${f(w)} ${f(r)}V${f(h - r)}Q${f(w)} ${f(h)} ${f(w - r)} ${f(h)}H${f(r)}Q0 ${f(h)} 0 ${f(h - r)}V${f(r)}Q0 0 ${f(r)} 0Z`;
}

/** A cloud: bumps around an ellipse, all inside the w × h box. */
function cloudPath(w: number, h: number): string {
  const n = Math.max(7, Math.min(14, Math.round((Math.PI * (w + h)) / 2 / 55)));
  const cx = w / 2;
  const cy = h / 2;
  const half = Math.PI / n;
  const rx = (w / 2) * 0.8;
  const ry = (h / 2) * 0.78;
  // Control points far enough out that each bump just touches the box.
  const kx = w - rx * Math.cos(half);
  const ky = h - ry * Math.cos(half);
  const at = (i: number) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  };
  let d = `M${f(at(0).x)} ${f(at(0).y)}`;
  for (let i = 0; i < n; i++) {
    const mid = (2 * Math.PI * (i + 0.5)) / n - Math.PI / 2;
    const next = at(i + 1);
    d += `Q${f(cx + kx * Math.cos(mid))} ${f(cy + ky * Math.sin(mid))} ${f(next.x)} ${f(next.y)}`;
  }
  return `${d}Z`;
}

/** The outline of a shape as a path, drawn at the origin. */
export function outlinePath(shape: Shape, w: number, h: number): string {
  switch (shape) {
    case 'rounded':
      return roundedPath(w, h);
    case 'ellipse':
      return `M0 ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 0 ${f(h / 2)}Z`;
    case 'diamond':
      return `M${f(w / 2)} 0L${f(w)} ${f(h / 2)}L${f(w / 2)} ${f(h)}L0 ${f(h / 2)}Z`;
    case 'cloud':
      return cloudPath(w, h);
    default:
      return `M0 0H${f(w)}V${f(h)}H0Z`;
  }
}

const nodeCache = new Map<string, readonly Piece[]>();

/** The pieces of a node's shape, drawn at the origin. */
export function nodePieces(n: SketchNode, hand: boolean): readonly Piece[] {
  const key = `${hand ? 'h' : 'c'}|${n.shape}|${n.w}|${n.h}|${n.stroke}|${n.fill}|${n.fillStyle}|${n.width}|${n.dash}|${n.seed}`;
  return bounded(nodeCache, 4000, key, () => makeNodePieces(n, hand));
}

function makeNodePieces(n: SketchNode, hand: boolean): Piece[] {
  const { w, h } = n;
  const dash = dashArray(n.dash, n.width);
  const withDash = (p: Piece): Piece => (dash ? { ...p, dash } : p);
  if (n.shape === 'text') return [];
  if (n.shape === 'sticky') {
    const fold = Math.min(18, w / 5, h / 5);
    const body = `M0 0H${f(w)}V${f(h - fold)}L${f(w - fold)} ${f(h)}H0Z`;
    const crease = `M${f(w)} ${f(h - fold)}L${f(w - fold)} ${f(h - fold)}L${f(w - fold)} ${f(h)}`;
    const shadow: Piece = { d: `M3 5H${f(w + 3)}V${f(h - fold + 5)}L${f(w - fold + 3)} ${f(h + 5)}H3Z`, stroke: 'none', width: 0, fill: '#000000', opacity: 0.08 };
    if (!hand) return [shadow, withDash({ d: body, stroke: n.stroke, width: n.width, fill: n.fill }), withDash({ d: crease, stroke: n.stroke, width: n.width, fill: 'none' })];
    const o = roughOptions(n.seed, n.stroke, n.width, n.fill, 'solid', n.dash);
    return [shadow, ...piecesOf(rough.path(body, o), dash), ...piecesOf(rough.path(crease, { ...o, fill: undefined }), dash)];
  }
  if (!hand) return [withDash({ d: outlinePath(n.shape, w, h), stroke: n.stroke, width: n.width, fill: n.fill })];
  const o = roughOptions(n.seed, n.stroke, n.width, n.fill, n.fillStyle, n.dash);
  switch (n.shape) {
    case 'rect':
      return piecesOf(rough.rectangle(0, 0, w, h, o), dash);
    case 'ellipse':
      return piecesOf(rough.ellipse(w / 2, h / 2, w, h, o), dash);
    case 'diamond':
      return piecesOf(
        rough.polygon(
          [
            [w / 2, 0],
            [w, h / 2],
            [w / 2, h],
            [0, h / 2],
          ],
          o,
        ),
        dash,
      );
    default:
      return piecesOf(rough.path(outlinePath(n.shape, w, h), o), dash);
  }
}

/* -------------------------------------------------------- connectors -- */

function arrowHead(tip: Point, dir: Point, size: number): Point[] {
  const back = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
  const spread = size * 0.45;
  return [{ x: back.x - dir.y * spread, y: back.y + dir.x * spread }, tip, { x: back.x + dir.y * spread, y: back.y - dir.x * spread }];
}

const pathThrough = (points: readonly Point[]): string => `M${points.map((p) => `${f(p.x)} ${f(p.y)}`).join('L')}`;
const pairs = (points: readonly Point[]): [number, number][] => points.map((p) => [p.x, p.y]);

const edgeCache = new Map<string, readonly Piece[]>();

export function edgePieces(e: SketchEdge, g: EdgeGeometry, hand: boolean): readonly Piece[] {
  const key = `${hand ? 'h' : 'c'}|${g.route}|${g.points.map((p) => `${f(p.x)},${f(p.y)}`).join(';')}|${e.stroke}|${e.width}|${e.dash}|${e.head}|${e.seed}`;
  return bounded(edgeCache, 600, key, () => makeEdgePieces(e, g, hand));
}

function makeEdgePieces(e: SketchEdge, g: EdgeGeometry, hand: boolean): Piece[] {
  const first = g.points[0];
  const last = g.points[g.points.length - 1];
  if (!first || !last) return [];
  const dash = dashArray(e.dash, e.width);
  const size = 10 + e.width * 2.5;
  const heads: Point[][] = [];
  if (e.head !== 'none') heads.push(arrowHead(last, g.endDir, size));
  if (e.head === 'both') heads.push(arrowHead(first, g.startDir, size));
  const control = g.points[1];
  const line = g.route === 'curved' && control ? `M${f(first.x)} ${f(first.y)}Q${f(control.x)} ${f(control.y)} ${f(last.x)} ${f(last.y)}` : pathThrough(g.points);
  if (!hand) {
    const body: Piece = dash ? { d: line, stroke: e.stroke, width: e.width, fill: 'none', dash } : { d: line, stroke: e.stroke, width: e.width, fill: 'none' };
    return [body, ...heads.map((hd): Piece => ({ d: pathThrough(hd), stroke: e.stroke, width: e.width, fill: 'none' }))];
  }
  const o: Options = { seed: e.seed % 2 ** 31 || 1, stroke: e.stroke, strokeWidth: e.width, roughness: 1, bowing: 1, disableMultiStroke: dash !== undefined };
  const body = g.route === 'straight' ? rough.line(first.x, first.y, last.x, last.y, o) : g.route === 'elbow' ? rough.linearPath(pairs(g.points), o) : rough.path(line, o);
  return [...piecesOf(body, dash), ...heads.flatMap((hd, i) => piecesOf(rough.linearPath(pairs(hd), { ...o, seed: (o.seed ?? 1) + i + 1, disableMultiStroke: false, roughness: 0.7 })))];
}

/** A mind-map branch from `parent` to `child`, in the child's colour. */
export function branchPieces(child: SketchNode, parent: SketchNode, hand: boolean): readonly Piece[] {
  const g = branchGeometry(child, parent);
  const d = `M${f(g.a.x)} ${f(g.a.y)}C${f(g.c1.x)} ${f(g.c1.y)} ${f(g.c2.x)} ${f(g.c2.y)} ${f(g.b.x)} ${f(g.b.y)}`;
  const width = child.width + (parent.parent === undefined ? 1 : 0.5);
  if (!hand) return [{ d, stroke: child.stroke, width, fill: 'none' }];
  return bounded(edgeCache, 600, `b|${d}|${child.stroke}|${width}|${child.seed}`, () =>
    piecesOf(rough.path(d, { seed: child.seed % 2 ** 31 || 1, stroke: child.stroke, strokeWidth: width, roughness: 0.8, bowing: 0.5 })),
  );
}

/* ------------------------------------------------------------ strokes -- */

const strokeCache = new WeakMap<SketchStroke, string>();

/** The filled outline of a pen stroke, thicker where the pen pressed harder. */
export function strokeOutline(s: SketchStroke): string {
  const hit = strokeCache.get(s);
  if (hit !== undefined) return hit;
  const pressure = s.points.some(([, , p]) => p !== 0.5 && p !== 0);
  const outline = getStroke(
    s.points.map(([x, y, p]) => [x, y, p]),
    { size: s.size, thinning: 0.55, smoothing: 0.5, streamline: 0.45, simulatePressure: !pressure, last: true },
  );
  const d = outlineToPath(outline);
  strokeCache.set(s, d);
  return d;
}

function outlineToPath(points: readonly (readonly number[])[]): string {
  const p = (i: number) => points[i] ?? [0, 0];
  const x = (i: number) => p(i)[0] ?? 0;
  const y = (i: number) => p(i)[1] ?? 0;
  if (points.length < 4) return points.length ? `M${f(x(0) - 1)} ${f(y(0))}a1 1 0 1 0 2 0a1 1 0 1 0 -2 0Z` : '';
  let d = `M${f(x(0))} ${f(y(0))}Q${f(x(1))} ${f(y(1))} ${f((x(1) + x(2)) / 2)} ${f((y(1) + y(2)) / 2)}T`;
  for (let i = 2; i < points.length - 1; i++) d += `${f((x(i) + x(i + 1)) / 2)} ${f((y(i) + y(i + 1)) / 2)} `;
  return `${d}Z`;
}

/* --------------------------------------------------------------- text -- */

function nodeText(n: SketchNode, hand: boolean, measure: Measure): TextRun | undefined {
  if (!n.text.trim()) return undefined;
  const box = innerBox(n);
  const lines = wrapText(n.text, box.w, n.font, hand, measure);
  const lh = lineHeight(n.font);
  const top = box.y + box.h / 2 - (lines.length * lh) / 2 - n.y;
  return { lines, x: box.x + box.w / 2 - n.x, ys: lines.map((_, i) => top + lh * i + lh / 2 + n.font * 0.35), font: n.font, color: n.stroke };
}

export function labelText(e: SketchEdge, g: EdgeGeometry, hand: boolean, measure: Measure): TextRun | undefined {
  if (!e.label.trim()) return undefined;
  const lines = wrapText(e.label, 220, e.font, hand, measure);
  const lh = lineHeight(e.font);
  const width = Math.max(...lines.map((l) => measure(l, e.font, hand)));
  const top = g.mid.y - (lines.length * lh) / 2;
  return {
    lines,
    x: g.mid.x,
    ys: lines.map((_, i) => top + lh * i + lh / 2 + e.font * 0.35),
    font: e.font,
    color: e.stroke,
    backing: { x: g.mid.x - width / 2 - 5, y: top, w: width + 10, h: lines.length * lh },
  };
}

/* -------------------------------------------------------------- scene -- */

/** Everything to draw, bottom to top: branches, shapes, connectors, pen strokes. */
export function renderScene(scene: Scene, measure: Measure): RenderItem[] {
  const nodes = indexNodes(scene);
  const items: RenderItem[] = [];
  for (const n of scene.nodes) {
    const parent = n.parent !== undefined ? nodes.get(n.parent) : undefined;
    if (parent) items.push({ kind: 'branch', id: `${n.id}:branch`, x: 0, y: 0, pieces: branchPieces(n, parent, scene.hand) });
  }
  for (const n of scene.nodes) {
    const text = nodeText(n, scene.hand, measure);
    items.push(text ? { kind: 'node', id: n.id, x: n.x, y: n.y, pieces: nodePieces(n, scene.hand), text } : { kind: 'node', id: n.id, x: n.x, y: n.y, pieces: nodePieces(n, scene.hand) });
  }
  for (const e of scene.edges) {
    const g = edgeGeometry(e, nodes);
    const text = labelText(e, g, scene.hand, measure);
    const pieces = edgePieces(e, g, scene.hand);
    items.push(text ? { kind: 'edge', id: e.id, x: 0, y: 0, pieces, text } : { kind: 'edge', id: e.id, x: 0, y: 0, pieces });
  }
  for (const s of scene.strokes) items.push({ kind: 'stroke', id: s.id, x: 0, y: 0, pieces: [{ d: strokeOutline(s), stroke: 'none', width: 0, fill: s.color }] });
  return items;
}

const attr = (v: string): string => escapeHtml(v);

function pieceSvg(p: Piece): string {
  return `<path d="${attr(p.d)}" stroke="${attr(p.stroke)}" stroke-width="${f(p.width)}" fill="${attr(p.fill)}"${p.dash ? ` stroke-dasharray="${attr(p.dash)}"` : ''}${p.opacity !== undefined ? ` opacity="${f(p.opacity)}"` : ''}/>`;
}

function textSvg(t: TextRun, hand: boolean): string {
  const b = t.backing;
  const backing = b ? `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" rx="4" fill="${PAPER}" stroke="none"/>` : '';
  const spans = t.lines.map((line, i) => `<tspan x="${f(t.x)}" y="${f(t.ys[i] ?? 0)}">${escapeHtml(line)}</tspan>`).join('');
  return `${backing}<text font-family="${attr(fontFamily(hand))}" font-size="${f(t.font)}" fill="${attr(t.color)}" stroke="none" text-anchor="middle" xml:space="preserve">${spans}</text>`;
}

export function itemSvg(item: RenderItem, hand: boolean): string {
  const body = item.pieces.map(pieceSvg).join('') + (item.text ? textSvg(item.text, hand) : '');
  return item.x || item.y ? `<g transform="translate(${f(item.x)} ${f(item.y)})">${body}</g>` : body;
}

export interface SvgOptions {
  readonly measure: Measure;
  /** @font-face rules to carry inside the picture, for a file that stands alone. */
  readonly fontCss?: string;
  /** Paper colour behind the drawing; none when left out. */
  readonly background?: string;
  readonly padding?: number;
  /** Read out by screen readers. */
  readonly title?: string;
}

/** The area an exported picture covers. */
export function exportBox(scene: Scene, padding = 24): Box {
  const b = sceneBounds(scene) ?? { x: 0, y: 0, w: 320, h: 160 };
  const x = Math.floor(b.x - padding);
  const y = Math.floor(b.y - padding);
  return { x, y, w: Math.ceil(b.x + b.w + padding) - x, h: Math.ceil(b.y + b.h + padding) - y };
}

/** The scene as an SVG picture. */
export function sceneSvg(scene: Scene, o: SvgOptions): string {
  const box = exportBox(scene, o.padding);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" width="${box.w}" height="${box.h}" role="img"${o.title ? ` aria-label="${attr(o.title)}"` : ''}>`,
  ];
  if (o.title) parts.push(`<title>${escapeHtml(o.title)}</title>`);
  if (o.fontCss) parts.push(`<style><![CDATA[${o.fontCss.replace(/]]>/g, '')}]]></style>`);
  if (o.background) parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${attr(o.background)}"/>`);
  parts.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  for (const item of renderScene(scene, o.measure)) parts.push(itemSvg(item, scene.hand));
  parts.push('</g></svg>');
  return parts.join('');
}
