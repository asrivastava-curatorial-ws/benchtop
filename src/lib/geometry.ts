/** Geometry shared by the visual generators: CSS gradient lines, 2D matrices, organic shapes. */
import { seededRandom } from './text';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Start and end of a CSS linear-gradient line in a box of the given size.
 * CSS measures the angle clockwise from "to top"; the line passes through the
 * centre and is long enough for the corners to receive the first/last colour.
 */
export function linearGradientLine(angleDeg: number, width: number, height: number): { start: Point; end: Point } {
  const angle = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return { start: { x: cx - dx * half, y: cy - dy * half }, end: { x: cx + dx * half, y: cy + dy * half } };
}

/** Radii of a CSS radial gradient with the default `farthest-corner` size. */
export function radialGradientRadii(cx: number, cy: number, width: number, height: number, circle: boolean): { rx: number; ry: number } {
  const sideX = Math.max(cx, width - cx);
  const sideY = Math.max(cy, height - cy);
  if (circle) {
    const r = Math.hypot(sideX, sideY);
    return { rx: r, ry: r };
  }
  // The farthest-corner ellipse keeps the aspect ratio of the farthest-side ellipse.
  return { rx: sideX * Math.SQRT2, ry: sideY * Math.SQRT2 };
}

/* ---------------------------------------------------------------- matrices -- */

/** A 2D affine transform in CSS `matrix(a, b, c, d, e, f)` order. */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `left` applied after `right`, i.e. the CSS list `left right`. */
export function multiply(left: Matrix, right: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

export const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const rotation = (degrees: number): Matrix => {
  const cos = Math.cos(radians(degrees));
  const sin = Math.sin(radians(degrees));
  return [cos, sin, -sin, cos, 0, 0];
};
export const scaling = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0];
export const skewing = (xDegrees: number, yDegrees: number): Matrix => [1, Math.tan(radians(yDegrees)), Math.tan(radians(xDegrees)), 1, 0, 0];

export function composeTransform(parts: { translateX: number; translateY: number; rotate: number; scaleX: number; scaleY: number; skewX: number; skewY: number }): Matrix {
  return [translation(parts.translateX, parts.translateY), rotation(parts.rotate), scaling(parts.scaleX, parts.scaleY), skewing(parts.skewX, parts.skewY)].reduce(multiply, IDENTITY);
}

export function formatMatrix(matrix: Matrix): string {
  const tidy = (value: number) => {
    const rounded = Math.round(value * 1e6) / 1e6;
    return Object.is(rounded, -0) ? '0' : String(rounded);
  };
  return `matrix(${matrix.map(tidy).join(', ')})`;
}

/* ------------------------------------------------------------------ shapes -- */

const round = (value: number): number => Math.round(value * 100) / 100;

/** A closed, smooth path through the points (Catmull-Rom converted to cubic Beziers). */
export function smoothClosedPath(points: readonly Point[]): string {
  const count = points.length;
  if (count < 3) return '';
  const at = (index: number): Point => points[((index % count) + count) % count] as Point;
  let d = `M${round(at(0).x)} ${round(at(0).y)}`;
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p2.x)} ${round(p2.y)}`;
  }
  return `${d}Z`;
}

/** An organic blob centred in a square of the given size. */
export function blobPath(seed: number, pointCount: number, randomness: number, size: number): string {
  const random = seededRandom(seed);
  const centre = size / 2;
  const outer = size * 0.46;
  const points: Point[] = [];
  for (let i = 0; i < pointCount; i++) {
    const angle = (i / pointCount) * Math.PI * 2 - Math.PI / 2;
    const radius = outer * (1 - randomness * 0.6 * random());
    points.push({ x: centre + Math.cos(angle) * radius, y: centre + Math.sin(angle) * radius });
  }
  return smoothClosedPath(points);
}

/** One wave layer: a filled area whose top edge undulates across the width. */
export function wavePath(seed: number, width: number, height: number, baseline: number, amplitude: number, segments: number, smooth: boolean): string {
  const random = seededRandom(seed);
  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    points.push({ x: (width * i) / segments, y: baseline + (random() * 2 - 1) * amplitude });
  }
  let d = `M0 ${round((points[0] as Point).y)}`;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1] as Point;
    const current = points[i] as Point;
    if (smooth) {
      const mid = (previous.x + current.x) / 2;
      d += `C${round(mid)} ${round(previous.y)} ${round(mid)} ${round(current.y)} ${round(current.x)} ${round(current.y)}`;
    } else {
      d += `L${round(current.x)} ${round(current.y)}`;
    }
  }
  return `${d}L${round(width)} ${round(height)}L0 ${round(height)}Z`;
}

/** Wedges of a sunburst: every other ray, as one path. */
export function sunburstPath(rays: number, cx: number, cy: number, radius: number, rotationDeg: number): string {
  const step = (Math.PI * 2) / rays;
  const offset = radians(rotationDeg) - Math.PI / 2;
  let d = '';
  for (let i = 0; i < rays; i += 2) {
    const a0 = offset + i * step;
    const a1 = a0 + step;
    d += `M${round(cx)} ${round(cy)}L${round(cx + Math.cos(a0) * radius)} ${round(cy + Math.sin(a0) * radius)}L${round(cx + Math.cos(a1) * radius)} ${round(cy + Math.sin(a1) * radius)}Z`;
  }
  return d;
}
