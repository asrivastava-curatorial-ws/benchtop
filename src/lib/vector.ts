/**
 * The drawing model of the Vector Editor: layers of shapes, every shape a set of
 * Bézier paths.  Reading and writing SVG path data, geometry (bounds, flattening,
 * splitting), transforms, alignment, snapping, and SVG and DXF files.
 */
import { attr, parseXml, rootElement, type XmlElement } from './xml-scan';

export type Pt = readonly [number, number];

export interface PathNode {
  readonly x: number;
  readonly y: number;
  /** Control points of the curve coming in and going out, as absolute positions. */
  readonly hin?: Pt;
  readonly hout?: Pt;
  /** A smooth node keeps its two handles in one line. */
  readonly smooth: boolean;
}

export interface SubPath {
  readonly nodes: readonly PathNode[];
  readonly closed: boolean;
}

export interface Shape {
  readonly id: string;
  readonly name: string;
  readonly paths: readonly SubPath[];
  /** `none` or a #rrggbb colour. */
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly evenOdd: boolean;
}

export interface Layer {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly shapes: readonly Shape[];
}

export interface Drawing {
  readonly width: number;
  readonly height: number;
  readonly unit: 'px' | 'mm';
  readonly layers: readonly Layer[];
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

let counter = 0;
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

const round = (value: number, digits = 3): number => {
  const scale = 10 ** digits;
  const rounded = Math.round(value * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/* ------------------------------------------------------------- path data -- */

function isSmooth(node: { x: number; y: number; hin?: Pt; hout?: Pt }): boolean {
  if (!node.hin || !node.hout) return false;
  const ax = node.x - node.hin[0];
  const ay = node.y - node.hin[1];
  const bx = node.hout[0] - node.x;
  const by = node.hout[1] - node.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return false;
  return Math.abs(ax * by - ay * bx) / (la * lb) < 0.02 && ax * bx + ay * by > 0;
}

type Cubic = [number, number, number, number, number, number];

/** An elliptical arc as cubic curves (each at most a quarter turn). */
export function arcToCubics(x1: number, y1: number, rxIn: number, ryIn: number, degrees: number, large: boolean, sweep: boolean, x2: number, y2: number): Cubic[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < 1e-12 || ry < 1e-12 || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (degrees * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / length)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const start = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  else if (sweep && delta < 0) delta += Math.PI * 2;
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / pieces;
  const t = (4 / 3) * Math.tan(step / 4);
  const place = (u: number, v: number): [number, number] => [cx + rx * u * cos - ry * v * sin, cy + rx * u * sin + ry * v * cos];
  const out: Cubic[] = [];
  for (let i = 0; i < pieces; i++) {
    const a1 = start + i * step;
    const a2 = a1 + step;
    const c1 = place(Math.cos(a1) - t * Math.sin(a1), Math.sin(a1) + t * Math.cos(a1));
    const c2 = place(Math.cos(a2) + t * Math.sin(a2), Math.sin(a2) - t * Math.cos(a2));
    const end = i === pieces - 1 ? ([x2, y2] as [number, number]) : place(Math.cos(a2), Math.sin(a2));
    out.push([c1[0], c1[1], c2[0], c2[1], end[0], end[1]]);
  }
  return out;
}

type Draft = { x: number; y: number; hin?: Pt; hout?: Pt };

/** SVG path data as sub-paths of nodes; arcs and quadratic curves become cubic curves. */
export function parsePathData(d: string): SubPath[] {
  const paths: SubPath[] = [];
  let nodes: Draft[] = [];
  let at = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastControl: Pt | null = null;
  let lastKind = '';
  const skip = () => {
    while (at < d.length && /[\s,]/.test(d[at] as string)) at++;
  };
  const number = (): number => {
    skip();
    const match = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(d.slice(at, at + 40));
    if (!match) throw new Error(`The path data is not valid near position ${at}.`);
    at += match[0].length;
    return Number(match[0]);
  };
  const flag = (): boolean => {
    skip();
    const char = d[at];
    if (char !== '0' && char !== '1') throw new Error(`The path data is not valid near position ${at}.`);
    at++;
    return char === '1';
  };
  const finish = (closed: boolean) => {
    if (nodes.length) {
      const first = nodes[0] as Draft;
      const last = nodes[nodes.length - 1] as Draft;
      // A closing curve that ends on the first node hands its handle to that node.
      if (closed && nodes.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) {
        first.hin = last.hin;
        nodes.pop();
      }
      paths.push({ nodes: nodes.map((n) => ({ ...n, smooth: isSmooth(n) })), closed });
    }
    nodes = [];
  };
  const begin = () => {
    if (!nodes.length) nodes.push({ x: cx, y: cy });
  };
  const curve = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => {
    begin();
    const previous = nodes[nodes.length - 1] as Draft;
    if (c1x !== previous.x || c1y !== previous.y) previous.hout = [c1x, c1y];
    nodes.push(c2x !== x || c2y !== y ? { x, y, hin: [c2x, c2y] } : { x, y });
    cx = x;
    cy = y;
  };
  let command = '';
  for (;;) {
    skip();
    if (at >= d.length) break;
    const char = d[at] as string;
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(char)) {
      command = char;
      at++;
    } else if (!command) throw new Error('The path data does not start with a move.');
    else if (command === 'Z' || command === 'z') throw new Error(`The path data is not valid near position ${at}.`);
    else if (command === 'M') command = 'L';
    else if (command === 'm') command = 'l';
    const relative = command === command.toLowerCase();
    const ox = relative ? cx : 0;
    const oy = relative ? cy : 0;
    switch (command.toUpperCase()) {
      case 'M': {
        finish(false);
        cx = number() + ox;
        cy = number() + oy;
        sx = cx;
        sy = cy;
        nodes.push({ x: cx, y: cy });
        break;
      }
      case 'L': {
        begin();
        cx = number() + ox;
        cy = number() + oy;
        nodes.push({ x: cx, y: cy });
        break;
      }
      case 'H': {
        begin();
        cx = number() + ox;
        nodes.push({ x: cx, y: cy });
        break;
      }
      case 'V': {
        begin();
        cy = number() + oy;
        nodes.push({ x: cx, y: cy });
        break;
      }
      case 'C': {
        const c1x = number() + ox;
        const c1y = number() + oy;
        const c2x = number() + ox;
        const c2y = number() + oy;
        curve(c1x, c1y, c2x, c2y, number() + ox, number() + oy);
        lastControl = [c2x, c2y];
        break;
      }
      case 'S': {
        const c1: Pt = lastControl && (lastKind === 'C' || lastKind === 'S') ? [2 * cx - lastControl[0], 2 * cy - lastControl[1]] : [cx, cy];
        const c2x = number() + ox;
        const c2y = number() + oy;
        curve(c1[0], c1[1], c2x, c2y, number() + ox, number() + oy);
        lastControl = [c2x, c2y];
        break;
      }
      case 'Q':
      case 'T': {
        let qx: number;
        let qy: number;
        if (command.toUpperCase() === 'Q') {
          qx = number() + ox;
          qy = number() + oy;
        } else {
          const reflect: Pt = lastControl && (lastKind === 'Q' || lastKind === 'T') ? [2 * cx - lastControl[0], 2 * cy - lastControl[1]] : [cx, cy];
          qx = reflect[0];
          qy = reflect[1];
        }
        const x = number() + ox;
        const y = number() + oy;
        curve(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
        lastControl = [qx, qy];
        break;
      }
      case 'A': {
        const rx = number();
        const ry = number();
        const rotation = number();
        const large = flag();
        const sweep = flag();
        const x = number() + ox;
        const y = number() + oy;
        for (const piece of arcToCubics(cx, cy, rx, ry, rotation, large, sweep, x, y)) curve(...piece);
        break;
      }
      default: {
        finish(true);
        cx = sx;
        cy = sy;
      }
    }
    lastKind = command.toUpperCase();
  }
  finish(false);
  return paths;
}

export interface Segment {
  readonly p0: Pt;
  readonly c1: Pt;
  readonly c2: Pt;
  readonly p3: Pt;
  readonly line: boolean;
  /** Index of the node the segment starts from. */
  readonly index: number;
}

/** The pieces between the nodes of a sub-path, the closing piece included. */
export function segmentsOf(path: SubPath): Segment[] {
  const out: Segment[] = [];
  const count = path.nodes.length;
  const last = path.closed ? count : count - 1;
  for (let i = 0; i < last; i++) {
    const a = path.nodes[i] as PathNode;
    const b = path.nodes[(i + 1) % count] as PathNode;
    if (count === 1) break;
    out.push({ p0: [a.x, a.y], c1: a.hout ?? [a.x, a.y], c2: b.hin ?? [b.x, b.y], p3: [b.x, b.y], line: !a.hout && !b.hin, index: i });
  }
  return out;
}

/** Path data for a shape's sub-paths (absolute M, L, C and Z). */
export function pathData(paths: readonly SubPath[], digits = 3): string {
  const n = (value: number) => String(round(value, digits));
  const parts: string[] = [];
  for (const path of paths) {
    const first = path.nodes[0];
    if (!first) continue;
    parts.push(`M${n(first.x)} ${n(first.y)}`);
    const segments = segmentsOf(path);
    segments.forEach((segment, index) => {
      const closing = path.closed && index === segments.length - 1;
      if (segment.line) {
        if (!closing) parts.push(`L${n(segment.p3[0])} ${n(segment.p3[1])}`);
      } else parts.push(`C${n(segment.c1[0])} ${n(segment.c1[1])} ${n(segment.c2[0])} ${n(segment.c2[1])} ${n(segment.p3[0])} ${n(segment.p3[1])}`);
    });
    if (path.closed) parts.push('Z');
  }
  return parts.join('');
}

/* -------------------------------------------------------------- geometry -- */

const mix = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function pointOn(segment: Segment, t: number): Pt {
  if (segment.line) return mix(segment.p0, segment.p3, t);
  const a = mix(segment.p0, segment.c1, t);
  const b = mix(segment.c1, segment.c2, t);
  const c = mix(segment.c2, segment.p3, t);
  return mix(mix(a, b, t), mix(b, c, t), t);
}

/** A sub-path as a polyline that stays within `tolerance` of the curves. */
export function flatten(path: SubPath, tolerance = 0.1): Pt[] {
  const first = path.nodes[0];
  if (!first) return [];
  const out: Pt[] = [[first.x, first.y]];
  const curve = (p0: Pt, c1: Pt, c2: Pt, p3: Pt, depth: number) => {
    const dx = p3[0] - p0[0];
    const dy = p3[1] - p0[1];
    const length = Math.hypot(dx, dy) || 1;
    const d1 = Math.abs((c1[0] - p0[0]) * dy - (c1[1] - p0[1]) * dx) / length;
    const d2 = Math.abs((c2[0] - p0[0]) * dy - (c2[1] - p0[1]) * dx) / length;
    // Handles that reach beyond the chord (a loop or cusp) also need splitting.
    const beyond = Math.hypot(c1[0] - p0[0], c1[1] - p0[1]) + Math.hypot(c2[0] - p3[0], c2[1] - p3[1]) > length * 1.5;
    if (depth >= 14 || (Math.max(d1, d2) <= tolerance && !(beyond && depth < 3))) {
      out.push(p3);
      return;
    }
    const a = mix(p0, c1, 0.5);
    const b = mix(c1, c2, 0.5);
    const c = mix(c2, p3, 0.5);
    const ab = mix(a, b, 0.5);
    const bc = mix(b, c, 0.5);
    const middle = mix(ab, bc, 0.5);
    curve(p0, a, ab, middle, depth + 1);
    curve(middle, bc, c, p3, depth + 1);
  };
  for (const segment of segmentsOf(path)) {
    if (segment.line) out.push(segment.p3);
    else curve(segment.p0, segment.c1, segment.c2, segment.p3, 0);
  }
  if (path.closed && out.length > 1) out.pop();
  return out;
}

/** The exact box around some sub-paths (curve extremes included), or null when there is nothing. */
export function boundsOf(paths: readonly SubPath[]): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (p: Pt) => {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  };
  for (const path of paths) {
    for (const node of path.nodes) take([node.x, node.y]);
    for (const segment of segmentsOf(path)) {
      if (segment.line) continue;
      for (const axis of [0, 1] as const) {
        const p0 = segment.p0[axis];
        const c1 = segment.c1[axis];
        const c2 = segment.c2[axis];
        const p3 = segment.p3[axis];
        const a = -p0 + 3 * c1 - 3 * c2 + p3;
        const b = 2 * (p0 - 2 * c1 + c2);
        const c = c1 - p0;
        const roots: number[] = [];
        if (Math.abs(a) < 1e-12) {
          if (Math.abs(b) > 1e-12) roots.push(-c / b);
        } else {
          const disc = b * b - 4 * a * c;
          if (disc >= 0) roots.push((-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a));
        }
        for (const t of roots) if (t > 0 && t < 1) take(pointOn(segment, t));
      }
    }
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export const shapeBounds = (shape: Shape): Box => boundsOf(shape.paths) ?? { x: 0, y: 0, w: 0, h: 0 };

export function unionBox(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

export function transformPaths(paths: readonly SubPath[], m: Matrix): SubPath[] {
  return paths.map((path) => ({
    closed: path.closed,
    nodes: path.nodes.map((node) => {
      const [x, y] = apply(m, node.x, node.y);
      return { x, y, smooth: node.smooth, ...(node.hin ? { hin: apply(m, node.hin[0], node.hin[1]) } : {}), ...(node.hout ? { hout: apply(m, node.hout[0], node.hout[1]) } : {}) };
    }),
  }));
}

export const translation = (dx: number, dy: number): Matrix => [1, 0, 0, 1, dx, dy];
export const scaling = (sx: number, sy: number, ox = 0, oy = 0): Matrix => [sx, 0, 0, sy, ox - sx * ox, oy - sy * oy];
export function rotation(degrees: number, ox = 0, oy = 0): Matrix {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [cos, sin, -sin, cos, ox - cos * ox + sin * oy, oy - sin * ox - cos * oy];
}

/** The matrix that takes box `from` to box `to` (zero-size sides keep their scale). */
export function boxToBox(from: Box, to: Box): Matrix {
  const sx = from.w > 1e-9 ? to.w / from.w : 1;
  const sy = from.h > 1e-9 ? to.h / from.h : 1;
  return [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy];
}

/** Splits the segment that starts at node `index` at `t`, adding a node there. */
export function splitSegment(path: SubPath, index: number, t: number): SubPath {
  const segment = segmentsOf(path).find((s) => s.index === index);
  if (!segment) return path;
  const nodes = path.nodes.map((n) => ({ ...n }));
  const a = nodes[index] as PathNode;
  const bIndex = (index + 1) % nodes.length;
  const b = nodes[bIndex] as PathNode;
  let added: PathNode;
  if (segment.line) {
    const [x, y] = mix(segment.p0, segment.p3, t);
    added = { x, y, smooth: false };
  } else {
    const p01 = mix(segment.p0, segment.c1, t);
    const p12 = mix(segment.c1, segment.c2, t);
    const p23 = mix(segment.c2, segment.p3, t);
    const p012 = mix(p01, p12, t);
    const p123 = mix(p12, p23, t);
    const middle = mix(p012, p123, t);
    nodes[index] = { ...a, hout: p01 };
    nodes[bIndex] = { ...b, hin: p23 };
    added = { x: middle[0], y: middle[1], hin: p012, hout: p123, smooth: true };
  }
  nodes.splice(index + 1, 0, added);
  return { ...path, nodes };
}

/** The place on a sub-path nearest to a point. */
export function nearestOn(path: SubPath, x: number, y: number): { index: number; t: number; distance: number; point: Pt } | null {
  let best: { index: number; t: number; distance: number; point: Pt } | null = null;
  for (const segment of segmentsOf(path)) {
    const measure = (t: number) => {
      const p = pointOn(segment, t);
      return { t, distance: Math.hypot(p[0] - x, p[1] - y), point: p };
    };
    let near = measure(0);
    for (let i = 1; i <= 24; i++) {
      const next = measure(i / 24);
      if (next.distance < near.distance) near = next;
    }
    let low = Math.max(0, near.t - 1 / 24);
    let high = Math.min(1, near.t + 1 / 24);
    for (let i = 0; i < 20; i++) {
      const a = low + (high - low) / 3;
      const b = high - (high - low) / 3;
      if (measure(a).distance < measure(b).distance) high = b;
      else low = a;
    }
    const found = measure((low + high) / 2);
    if (!best || found.distance < best.distance) best = { index: segment.index, ...found };
  }
  return best;
}

/** Removes a node; a sub-path with too few nodes left is dropped (null). */
export function deleteNode(path: SubPath, index: number): SubPath | null {
  const nodes = path.nodes.filter((_, i) => i !== index);
  if (nodes.length < 2) return null;
  return { closed: path.closed && nodes.length > 2, nodes };
}

/** Moves a node together with its handles. */
export function moveNode(path: SubPath, index: number, x: number, y: number): SubPath {
  return {
    ...path,
    nodes: path.nodes.map((node, i) => {
      if (i !== index) return node;
      const dx = x - node.x;
      const dy = y - node.y;
      return { ...node, x, y, ...(node.hin ? { hin: [node.hin[0] + dx, node.hin[1] + dy] as Pt } : {}), ...(node.hout ? { hout: [node.hout[0] + dx, node.hout[1] + dy] as Pt } : {}) };
    }),
  };
}

/** Moves one handle; on a smooth node the other handle turns with it and keeps its length. */
export function moveHandle(path: SubPath, index: number, which: 'hin' | 'hout', x: number, y: number): SubPath {
  return {
    ...path,
    nodes: path.nodes.map((node, i) => {
      if (i !== index) return node;
      const other = which === 'hin' ? 'hout' : 'hin';
      const next: PathNode = { ...node, [which]: [x, y] as Pt };
      const opposite = node[other];
      if (node.smooth && opposite) {
        const length = Math.hypot(opposite[0] - node.x, opposite[1] - node.y);
        const dx = node.x - x;
        const dy = node.y - y;
        const reach = Math.hypot(dx, dy);
        if (reach > 1e-9) return { ...next, [other]: [node.x + (dx / reach) * length, node.y + (dy / reach) * length] as Pt };
      }
      return next;
    }),
  };
}

/** Makes a node a corner (handles dropped) or smooth (handles a third of the way to its neighbours). */
export function setNodeKind(path: SubPath, index: number, kind: 'corner' | 'smooth'): SubPath {
  const count = path.nodes.length;
  return {
    ...path,
    nodes: path.nodes.map((node, i) => {
      if (i !== index) return node;
      if (kind === 'corner') return { x: node.x, y: node.y, smooth: false };
      const before = path.nodes[(i - 1 + count) % count] as PathNode;
      const after = path.nodes[(i + 1) % count] as PathNode;
      const hasBefore = path.closed || i > 0;
      const hasAfter = path.closed || i < count - 1;
      const from = hasBefore ? before : node;
      const to = hasAfter ? after : node;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const reachIn = hasBefore ? Math.hypot(node.x - before.x, node.y - before.y) / 3 : 0;
      const reachOut = hasAfter ? Math.hypot(after.x - node.x, after.y - node.y) / 3 : 0;
      return {
        x: node.x,
        y: node.y,
        smooth: true,
        ...(hasBefore ? { hin: [node.x - (dx / length) * reachIn, node.y - (dy / length) * reachIn] as Pt } : {}),
        ...(hasAfter ? { hout: [node.x + (dx / length) * reachOut, node.y + (dy / length) * reachOut] as Pt } : {}),
      };
    }),
  };
}

/* ---------------------------------------------------------------- shapes -- */

const corner = (x: number, y: number): PathNode => ({ x, y, smooth: false });

export const rectPath = (x: number, y: number, w: number, h: number): SubPath => ({ closed: true, nodes: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)] });

const KAPPA = 0.5522847498307936;

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): SubPath {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    nodes: [
      { x: cx + rx, y: cy, hin: [cx + rx, cy - ky], hout: [cx + rx, cy + ky], smooth: true },
      { x: cx, y: cy + ry, hin: [cx + kx, cy + ry], hout: [cx - kx, cy + ry], smooth: true },
      { x: cx - rx, y: cy, hin: [cx - rx, cy + ky], hout: [cx - rx, cy - ky], smooth: true },
      { x: cx, y: cy - ry, hin: [cx - kx, cy - ry], hout: [cx + kx, cy - ry], smooth: true },
    ],
  };
}

export const polyPath = (points: readonly Pt[], closed: boolean): SubPath => ({ closed, nodes: points.map(([x, y]) => corner(x, y)) });

export function makeShape(name: string, paths: readonly SubPath[], style: Partial<Pick<Shape, 'fill' | 'stroke' | 'strokeWidth' | 'opacity' | 'evenOdd'>> = {}): Shape {
  return {
    id: newId('shape'),
    name,
    paths,
    fill: style.fill ?? '#4c9f84',
    stroke: style.stroke ?? '#19222a',
    strokeWidth: style.strokeWidth ?? 1,
    opacity: style.opacity ?? 1,
    evenOdd: style.evenOdd ?? false,
  };
}

export const makeLayer = (name: string, shapes: readonly Shape[] = []): Layer => ({ id: newId('layer'), name, visible: true, locked: false, shapes });

export const emptyDrawing = (width = 800, height = 600, unit: 'px' | 'mm' = 'px'): Drawing => ({ width, height, unit, layers: [makeLayer('Layer 1')] });

/* ------------------------------------------------- alignment and snapping -- */

export type AlignMode = 'left' | 'hcentre' | 'right' | 'top' | 'vcentre' | 'bottom' | 'hspace' | 'vspace';

/** How far each box has to move.  One box is aligned to `frame`; several to the box around them. */
export function alignMoves(boxes: readonly Box[], mode: AlignMode, frame: Box): { dx: number; dy: number }[] {
  const target = boxes.length > 1 ? (unionBox(boxes) as Box) : frame;
  if (mode === 'hspace' || mode === 'vspace') {
    if (boxes.length < 3) return boxes.map(() => ({ dx: 0, dy: 0 }));
    const horizontal = mode === 'hspace';
    const order = boxes.map((box, index) => ({ box, index })).sort((a, b) => (horizontal ? a.box.x - b.box.x : a.box.y - b.box.y));
    const sizes = order.reduce((sum, { box }) => sum + (horizontal ? box.w : box.h), 0);
    const gap = ((horizontal ? target.w : target.h) - sizes) / (order.length - 1);
    const moves = boxes.map(() => ({ dx: 0, dy: 0 }));
    let at = horizontal ? target.x : target.y;
    for (const { box, index } of order) {
      if (horizontal) moves[index] = { dx: at - box.x, dy: 0 };
      else moves[index] = { dx: 0, dy: at - box.y };
      at += (horizontal ? box.w : box.h) + gap;
    }
    return moves;
  }
  return boxes.map((box) => {
    switch (mode) {
      case 'left':
        return { dx: target.x - box.x, dy: 0 };
      case 'hcentre':
        return { dx: target.x + target.w / 2 - (box.x + box.w / 2), dy: 0 };
      case 'right':
        return { dx: target.x + target.w - (box.x + box.w), dy: 0 };
      case 'top':
        return { dx: 0, dy: target.y - box.y };
      case 'vcentre':
        return { dx: 0, dy: target.y + target.h / 2 - (box.y + box.h / 2) };
      default:
        return { dx: 0, dy: target.y + target.h - (box.y + box.h) };
    }
  });
}

export interface Snap {
  readonly dx: number;
  readonly dy: number;
  /** Guide lines to show: a vertical line at `x` or a horizontal one at `y`. */
  readonly guides: { readonly x?: number; readonly y?: number }[];
}

/**
 * Nudges a moving box so that one of its edges or its centre meets an edge or centre of
 * another box (or of the page); failing that, its top left corner meets the grid.
 */
export function snapBox(box: Box, others: readonly Box[], options: { readonly threshold: number; readonly grid: number; readonly objects: boolean }): Snap {
  const guides: { x?: number; y?: number }[] = [];
  const along = (start: number, size: number, targets: number[], grid: number): { delta: number; guide?: number } => {
    let best: { delta: number; guide?: number } | null = null;
    if (options.objects) {
      for (const mine of [start, start + size / 2, start + size]) {
        for (const target of targets) {
          const delta = target - mine;
          if (Math.abs(delta) <= options.threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, guide: target };
        }
      }
    }
    if (best) return best;
    if (grid > 0) {
      const delta = Math.round(start / grid) * grid - start;
      if (Math.abs(delta) <= options.threshold) return { delta };
    }
    return { delta: 0 };
  };
  const xs = others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w]);
  const ys = others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h]);
  const sx = along(box.x, box.w, xs, options.grid);
  const sy = along(box.y, box.h, ys, options.grid);
  if (sx.guide !== undefined) guides.push({ x: sx.guide });
  if (sy.guide !== undefined) guides.push({ y: sy.guide });
  return { dx: sx.delta, dy: sy.delta, guides };
}

/* ------------------------------------------------------------------- SVG -- */

const NAMED: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  navy: '#000080',
  purple: '#800080',
  teal: '#008080',
  orange: '#ffa500',
  brown: '#a52a2a',
  pink: '#ffc0cb',
  currentcolor: '#000000',
};

/** A colour as #rrggbb, `none`, or null when it is not a plain colour (a gradient, a pattern). */
export function readColour(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (text === 'none' || text === 'transparent') return 'none';
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  if (/^#[0-9a-f]{8}$/.test(text)) return text.slice(0, 7);
  const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/.exec(text);
  if (rgb) {
    const channel = (part: string) => Math.min(255, Math.max(0, Math.round(part.endsWith('%') ? (Number.parseFloat(part) * 255) / 100 : Number(part))));
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((part) =>
        channel(part as string)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  }
  return NAMED[text] ?? null;
}

/** An SVG transform list as one matrix. */
export function readTransform(value: string | undefined): Matrix {
  let m: Matrix = IDENTITY;
  for (const part of (value ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const n = (part[2] as string)
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const v = (i: number, fallback = 0) => (Number.isFinite(n[i]) ? (n[i] as number) : fallback);
    let next: Matrix = IDENTITY;
    switch (part[1]) {
      case 'matrix':
        next = [v(0, 1), v(1), v(2), v(3, 1), v(4), v(5)];
        break;
      case 'translate':
        next = translation(v(0), v(1));
        break;
      case 'scale':
        next = [v(0, 1), 0, 0, n.length > 1 ? v(1, 1) : v(0, 1), 0, 0];
        break;
      case 'rotate':
        next = rotation(v(0), v(1), v(2));
        break;
      case 'skewX':
        next = [1, 0, Math.tan((v(0) * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        next = [1, Math.tan((v(0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = multiply(m, next);
  }
  return m;
}

interface Style {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  evenOdd: boolean;
  hidden: boolean;
}

const MM_PER: Readonly<Record<string, number>> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6 };

function styleOf(element: XmlElement, parent: Style, notes: Set<string>): Style {
  const declared = new Map<string, string>();
  for (const a of element.attrs) declared.set(a.name, a.value);
  for (const rule of (attr(element, 'style') ?? '').split(';')) {
    const [key, ...rest] = rule.split(':');
    if (key && rest.length) declared.set(key.trim(), rest.join(':').trim());
  }
  const colour = (key: string, inherited: string) => {
    const value = declared.get(key);
    if (value === undefined) return inherited;
    const read = readColour(value);
    if (read === null) notes.add('Gradients and patterns were replaced by grey.');
    return read ?? '#808080';
  };
  const number = (key: string, inherited: number) => {
    const value = Number.parseFloat(declared.get(key) ?? '');
    return Number.isFinite(value) ? value : inherited;
  };
  return {
    fill: colour('fill', parent.fill),
    stroke: colour('stroke', parent.stroke),
    strokeWidth: number('stroke-width', parent.strokeWidth),
    opacity: parent.opacity * number('opacity', 1),
    evenOdd: (declared.get('fill-rule') ?? (parent.evenOdd ? 'evenodd' : 'nonzero')) === 'evenodd',
    hidden: parent.hidden || declared.get('display') === 'none' || declared.get('visibility') === 'hidden',
  };
}

const num = (element: XmlElement, name: string, fallback = 0): number => {
  const value = Number.parseFloat(attr(element, name) ?? '');
  return Number.isFinite(value) ? value : fallback;
};

function elementPaths(element: XmlElement): SubPath[] | null {
  switch (element.name) {
    case 'path':
      return parsePathData(attr(element, 'd') ?? '');
    case 'rect': {
      const x = num(element, 'x');
      const y = num(element, 'y');
      const w = num(element, 'width');
      const h = num(element, 'height');
      let rx = num(element, 'rx', Number.NaN);
      let ry = num(element, 'ry', Number.NaN);
      if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
      if (Number.isNaN(ry)) ry = rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (w <= 0 || h <= 0) return [];
      if (rx <= 0 || ry <= 0) return [rectPath(x, y, w, h)];
      return parsePathData(
        `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
      );
    }
    case 'circle': {
      const r = num(element, 'r');
      return r > 0 ? [ellipsePath(num(element, 'cx'), num(element, 'cy'), r, r)] : [];
    }
    case 'ellipse': {
      const rx = num(element, 'rx');
      const ry = num(element, 'ry');
      return rx > 0 && ry > 0 ? [ellipsePath(num(element, 'cx'), num(element, 'cy'), rx, ry)] : [];
    }
    case 'line':
      return [polyPath([[num(element, 'x1'), num(element, 'y1')] as Pt, [num(element, 'x2'), num(element, 'y2')] as Pt], false)];
    case 'polyline':
    case 'polygon': {
      const values = (attr(element, 'points') ?? '')
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      const points: Pt[] = [];
      for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i] as number, values[i + 1] as number]);
      return points.length > 1 ? [polyPath(points, element.name === 'polygon')] : [];
    }
    default:
      return null;
  }
}

/** Reads an SVG file: top-level groups become layers, every basic shape a path. */
export function importSvg(source: string): { drawing: Drawing; notes: string[] } {
  const root = rootElement(parseXml(source));
  if (!root) throw new Error('This is not an SVG file.');
  if (root.name !== 'svg') throw new Error('This is not an SVG file.');
  const notes = new Set<string>();
  const box = (attr(root, 'viewBox') ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const length = (name: string): { value: number; unit: string } | null => {
    const match = /^([\d.]+)\s*([a-z%]*)$/i.exec((attr(root, name) ?? '').trim());
    return match ? { value: Number(match[1]), unit: (match[2] ?? '').toLowerCase() } : null;
  };
  const w = length('width');
  const h = length('height');
  const physical = w && h && MM_PER[w.unit] && MM_PER[h.unit];
  const hasBox = box.length === 4 && (box[2] as number) > 0 && (box[3] as number) > 0;
  let width = hasBox ? (box[2] as number) : (w?.value ?? 800);
  let height = hasBox ? (box[3] as number) : (h?.value ?? 600);
  let base: Matrix = hasBox ? translation(-(box[0] as number), -(box[1] as number)) : IDENTITY;
  let unit: 'px' | 'mm' = 'px';
  if (physical && w && h) {
    // Sizes given in real units: the drawing is kept in millimetres.
    const mmW = w.value * (MM_PER[w.unit] as number);
    const mmH = h.value * (MM_PER[h.unit] as number);
    base = multiply([mmW / width, 0, 0, mmH / height, 0, 0], base);
    width = mmW;
    height = mmH;
    unit = 'mm';
  }
  const layers: Layer[] = [];
  let loose: Shape[] = [];
  let skipped = 0;
  const flush = () => {
    if (loose.length) layers.push(makeLayer(`Layer ${layers.length + 1}`, loose));
    loose = [];
  };
  const walk = (element: XmlElement, matrix: Matrix, style: Style, into: Shape[]) => {
    for (const child of element.children) {
      if (child.type !== 'element') continue;
      if (
        ['defs', 'metadata', 'title', 'desc', 'style', 'clipPath', 'mask', 'symbol', 'linearGradient', 'radialGradient', 'pattern', 'marker', 'filter'].includes(child.name) ||
        child.name.includes(':')
      )
        continue;
      const own = styleOf(child, style, notes);
      const m = multiply(matrix, readTransform(attr(child, 'transform')));
      if (child.name === 'g' || child.name === 'a' || child.name === 'svg') {
        walk(child, m, own, into);
        continue;
      }
      let paths: SubPath[] | null;
      try {
        paths = elementPaths(child);
      } catch {
        paths = [];
        notes.add('A path with unreadable data was left out.');
      }
      if (paths === null) {
        skipped += 1;
        continue;
      }
      if (!paths.length || own.hidden) continue;
      const stretch = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      into.push({
        id: newId('shape'),
        name: attr(child, 'inkscape:label') ?? attr(child, 'id') ?? child.name,
        paths: transformPaths(paths, m),
        fill: own.fill,
        stroke: own.stroke,
        strokeWidth: round(own.strokeWidth * stretch),
        opacity: own.opacity,
        evenOdd: own.evenOdd,
      });
    }
  };
  const initial: Style = { fill: '#000000', stroke: 'none', strokeWidth: 1, opacity: 1, evenOdd: false, hidden: false };
  const top = styleOf(root, initial, notes);
  for (const child of root.children) {
    if (child.type !== 'element') continue;
    if (child.name === 'g') {
      flush();
      const style = styleOf(child, { ...top, hidden: false }, notes);
      const shapes: Shape[] = [];
      walk(child, multiply(base, readTransform(attr(child, 'transform'))), { ...style, hidden: false }, shapes);
      layers.push({ ...makeLayer(attr(child, 'inkscape:label') ?? attr(child, 'id') ?? `Layer ${layers.length + 1}`, shapes), visible: !style.hidden });
    } else walk({ ...root, children: [child] }, base, top, loose);
  }
  flush();
  if (skipped) notes.add(`${skipped} ${skipped === 1 ? 'element that is not a shape was' : 'elements that are not shapes were'} left out (text, pictures, clones).`);
  if (!layers.length) layers.push(makeLayer('Layer 1'));
  return { drawing: { width: round(width), height: round(height), unit, layers }, notes: [...notes] };
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The drawing as an SVG file; layers are groups that Inkscape also shows as layers. */
export function exportSvg(drawing: Drawing): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${round(drawing.width)}${drawing.unit === 'mm' ? 'mm' : ''}" height="${round(drawing.height)}${drawing.unit === 'mm' ? 'mm' : ''}" viewBox="0 0 ${round(drawing.width)} ${round(drawing.height)}">`,
  ];
  drawing.layers.forEach((layer, index) => {
    lines.push(`  <g id="layer${index + 1}" inkscape:groupmode="layer" inkscape:label="${escapeXml(layer.name)}"${layer.visible ? '' : ' style="display:none"'}>`);
    for (const shape of layer.shapes) {
      const extras = [
        shape.opacity < 1 ? ` opacity="${round(shape.opacity)}"` : '',
        shape.evenOdd ? ' fill-rule="evenodd"' : '',
        shape.stroke !== 'none' ? ` stroke-width="${round(shape.strokeWidth)}"` : '',
      ].join('');
      lines.push(`    <path id="${escapeXml(shape.id)}" inkscape:label="${escapeXml(shape.name)}" d="${pathData(shape.paths)}" fill="${shape.fill}" stroke="${shape.stroke}"${extras}/>`);
    }
    lines.push('  </g>');
  });
  lines.push('</svg>', '');
  return lines.join('\n');
}

/* ------------------------------------------------------------------- DXF -- */

export interface DxfOptions {
  /** How far a straight piece may be from the curve it stands for, in drawing units. */
  readonly tolerance: number;
  /** Millimetres per drawing unit (1 for a drawing in mm; 25.4/96 for CSS pixels). */
  readonly scale: number;
  readonly hiddenLayers: boolean;
}

const dxfName = (name: string, used: Set<string>): string => {
  const base = (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'LAYER'
  )
    .slice(0, 31)
    .toUpperCase();
  let candidate = base;
  for (let n = 2; used.has(candidate); n++) candidate = `${base.slice(0, 28)}_${n}`;
  used.add(candidate);
  return candidate;
};

/**
 * An ASCII DXF (the R12 form every CAD and CAM program reads): one layer per drawing layer,
 * every path a polyline in millimetres, with y pointing up as CAD expects.
 */
export function exportDxf(drawing: Drawing, options: DxfOptions): string {
  const used = new Set<string>();
  const layers = drawing.layers.filter((layer) => layer.visible || options.hiddenLayers).map((layer) => ({ layer, name: dxfName(layer.name, used) }));
  const n = (value: number) => String(round(value, 4));
  const out: (string | number)[] = [];
  const pair = (code: number, value: string | number) => out.push(code, value);
  const height = drawing.height * options.scale;
  pair(0, 'SECTION');
  pair(2, 'HEADER');
  pair(9, '$ACADVER');
  pair(1, 'AC1009');
  pair(9, '$INSUNITS');
  pair(70, 4);
  pair(9, '$EXTMIN');
  pair(10, '0');
  pair(20, '0');
  pair(9, '$EXTMAX');
  pair(10, n(drawing.width * options.scale));
  pair(20, n(height));
  pair(0, 'ENDSEC');
  pair(0, 'SECTION');
  pair(2, 'TABLES');
  pair(0, 'TABLE');
  pair(2, 'LTYPE');
  pair(70, 1);
  pair(0, 'LTYPE');
  pair(2, 'CONTINUOUS');
  pair(70, 0);
  pair(3, 'Solid line');
  pair(72, 65);
  pair(73, 0);
  pair(40, '0.0');
  pair(0, 'ENDTAB');
  pair(0, 'TABLE');
  pair(2, 'LAYER');
  pair(70, layers.length);
  for (const { name } of layers) {
    pair(0, 'LAYER');
    pair(2, name);
    pair(70, 0);
    pair(62, 7);
    pair(6, 'CONTINUOUS');
  }
  pair(0, 'ENDTAB');
  pair(0, 'ENDSEC');
  pair(0, 'SECTION');
  pair(2, 'ENTITIES');
  for (const { layer, name } of layers) {
    for (const shape of layer.shapes) {
      for (const path of shape.paths) {
        const points = flatten(path, options.tolerance);
        if (points.length < 2) continue;
        pair(0, 'POLYLINE');
        pair(8, name);
        pair(66, 1);
        pair(70, path.closed ? 1 : 0);
        for (const [x, y] of points) {
          pair(0, 'VERTEX');
          pair(8, name);
          pair(10, n(x * options.scale));
          pair(20, n(height - y * options.scale));
          pair(30, '0.0');
        }
        pair(0, 'SEQEND');
        pair(8, name);
      }
    }
  }
  pair(0, 'ENDSEC');
  pair(0, 'EOF');
  return `${out.join('\n')}\n`;
}
