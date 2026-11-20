/**
 * Cross-section properties of common structural shapes: area, centroid,
 * second moments, elastic and plastic section moduli, radii of gyration,
 * principal axes and the torsion constant.  Lengths in mm.
 *
 * Shapes are built from rectangles (or circles), so the results are exact for
 * sharp corners; rolled sections with root radii differ by a few per cent.
 */

export type ShapeId = 'rectangle' | 'box' | 'circle' | 'tube' | 'ibeam' | 'channel' | 'angle' | 'tee';

export interface ShapeSpec {
  readonly id: ShapeId;
  readonly name: string;
  /** Dimension keys with labels, in the order they are asked for. */
  readonly dims: readonly { readonly key: string; readonly label: string; readonly example: number }[];
}

export const SHAPES: readonly ShapeSpec[] = [
  {
    id: 'rectangle',
    name: 'Rectangle (solid bar, timber)',
    dims: [
      { key: 'b', label: 'Width b', example: 100 },
      { key: 'h', label: 'Depth h', example: 200 },
    ],
  },
  {
    id: 'box',
    name: 'Box / rectangular hollow section',
    dims: [
      { key: 'b', label: 'Width B', example: 100 },
      { key: 'h', label: 'Depth H', example: 200 },
      { key: 't', label: 'Wall t', example: 6 },
    ],
  },
  { id: 'circle', name: 'Round bar', dims: [{ key: 'd', label: 'Diameter d', example: 50 }] },
  {
    id: 'tube',
    name: 'Tube / pipe (circular hollow section)',
    dims: [
      { key: 'd', label: 'Outside diameter D', example: 114.3 },
      { key: 't', label: 'Wall t', example: 4.5 },
    ],
  },
  {
    id: 'ibeam',
    name: 'I-beam (equal flanges)',
    dims: [
      { key: 'b', label: 'Flange width b', example: 125 },
      { key: 'h', label: 'Overall depth h', example: 250 },
      { key: 'tf', label: 'Flange thickness tf', example: 12.5 },
      { key: 'tw', label: 'Web thickness tw', example: 6.9 },
    ],
  },
  {
    id: 'channel',
    name: 'Channel (C-section)',
    dims: [
      { key: 'b', label: 'Flange width b', example: 75 },
      { key: 'h', label: 'Overall depth h', example: 200 },
      { key: 'tf', label: 'Flange thickness tf', example: 11.4 },
      { key: 'tw', label: 'Web thickness tw', example: 6.1 },
    ],
  },
  {
    id: 'angle',
    name: 'Angle (L-section)',
    dims: [
      { key: 'b', label: 'Horizontal leg b', example: 75 },
      { key: 'h', label: 'Vertical leg h', example: 75 },
      { key: 't', label: 'Thickness t', example: 8 },
    ],
  },
  {
    id: 'tee',
    name: 'T-section',
    dims: [
      { key: 'b', label: 'Flange width b', example: 150 },
      { key: 'h', label: 'Overall depth h', example: 150 },
      { key: 'tf', label: 'Flange thickness tf', example: 12 },
      { key: 'tw', label: 'Stem thickness tw', example: 10 },
    ],
  },
];

/** An axis-aligned rectangle: lower-left corner, width and height. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface SectionProperties {
  /** mm² */
  readonly area: number;
  /** Centroid from the left and bottom edges of the bounding box, mm. */
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
  /** Second moments about centroidal axes parallel to the edges, mm⁴. */
  readonly Ix: number;
  readonly Iy: number;
  readonly Ixy: number;
  /** Principal second moments (I1 ≥ I2), mm⁴, and the angle of axis 1 from x, degrees. */
  readonly I1: number;
  readonly I2: number;
  readonly angle: number;
  /** Elastic section moduli to the extreme fibres, mm³. */
  readonly SxTop: number;
  readonly SxBottom: number;
  readonly SyLeft: number;
  readonly SyRight: number;
  /** Plastic section moduli, mm³. */
  readonly Zx: number;
  readonly Zy: number;
  readonly rx: number;
  readonly ry: number;
  readonly r2: number;
  /** St Venant torsion constant, mm⁴ (thin-wall approximations for open and box shapes). */
  readonly J: number;
  /** Outside surface per unit length, mm (for painting and fire protection). */
  readonly perimeter: number;
  /** For drawing: the rectangles, or circles as [outer, inner] diameters. */
  readonly rects: readonly Rect[];
  readonly circle?: { readonly d: number; readonly inner: number };
}

export class SectionError extends RangeError {}

/** Roark: torsion constant of a solid rectangle with long side a and short side b. */
function rectangleTorsion(a0: number, b0: number): number {
  const a = Math.max(a0, b0);
  const b = Math.min(a0, b0);
  return a * b ** 3 * (1 / 3 - 0.21 * (b / a) * (1 - b ** 4 / (12 * a ** 4)));
}

/** Area of the rectangles below the line y = level (or left of x = level). */
function areaBelow(rects: readonly Rect[], level: number, axis: 'x' | 'y'): number {
  let sum = 0;
  for (const r of rects) {
    const [start, size, other] = axis === 'y' ? [r.y, r.h, r.w] : [r.x, r.w, r.h];
    sum += other * Math.min(Math.max(level - start, 0), size);
  }
  return sum;
}

/** Plastic modulus about the axis where the areas on both sides are equal. */
function plasticModulus(rects: readonly Rect[], total: number, axis: 'x' | 'y'): number {
  const starts = rects.map((r) => (axis === 'y' ? r.y : r.x));
  const ends = rects.map((r) => (axis === 'y' ? r.y + r.h : r.x + r.w));
  let lo = Math.min(...starts);
  let hi = Math.max(...ends);
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (areaBelow(rects, mid, axis) < total / 2) lo = mid;
    else hi = mid;
  }
  const level = (lo + hi) / 2;
  let Z = 0;
  for (const r of rects) {
    const [start, size, other] = axis === 'y' ? [r.y, r.h, r.w] : [r.x, r.w, r.h];
    const end = start + size;
    const below = Math.min(Math.max(level - start, 0), size);
    const above = size - below;
    // First moments of the parts below and above the plastic neutral axis.
    if (below > 0) Z += other * below * (level - (start + below / 2));
    if (above > 0) Z += other * above * (end - above / 2 - level);
  }
  return Z;
}

function fromRects(rects: readonly Rect[], J: number, perimeter: number): SectionProperties {
  const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
  const cx = rects.reduce((sum, r) => sum + r.w * r.h * (r.x + r.w / 2), 0) / area;
  const cy = rects.reduce((sum, r) => sum + r.w * r.h * (r.y + r.h / 2), 0) / area;
  let Ix = 0;
  let Iy = 0;
  let Ixy = 0;
  for (const r of rects) {
    const a = r.w * r.h;
    const dx = r.x + r.w / 2 - cx;
    const dy = r.y + r.h / 2 - cy;
    Ix += (r.w * r.h ** 3) / 12 + a * dy * dy;
    Iy += (r.h * r.w ** 3) / 12 + a * dx * dx;
    Ixy += a * dx * dy;
  }
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return finish({
    area,
    cx: cx - minX,
    cy: cy - minY,
    width: maxX - minX,
    height: maxY - minY,
    Ix,
    Iy,
    Ixy,
    J,
    perimeter,
    Zx: plasticModulus(rects, area, 'y'),
    Zy: plasticModulus(rects, area, 'x'),
    rects,
  });
}

function finish(p: {
  area: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
  Ix: number;
  Iy: number;
  Ixy: number;
  J: number;
  perimeter: number;
  Zx: number;
  Zy: number;
  rects: readonly Rect[];
  circle?: { d: number; inner: number };
}): SectionProperties {
  const mean = (p.Ix + p.Iy) / 2;
  const radius = Math.hypot((p.Ix - p.Iy) / 2, p.Ixy);
  const I1 = mean + radius;
  const I2 = mean - radius;
  // Axis 1 (major) direction, measured anticlockwise from x.
  const angle = Math.abs(p.Ixy) < 1e-9 * (p.Ix + p.Iy) ? (p.Ix >= p.Iy ? 0 : 90) : (Math.atan2(-2 * p.Ixy, p.Ix - p.Iy) * 90) / Math.PI;
  return {
    ...p,
    I1,
    I2,
    angle,
    SxTop: p.Ix / (p.height - p.cy),
    SxBottom: p.Ix / p.cy,
    SyLeft: p.Iy / p.cx,
    SyRight: p.Iy / (p.width - p.cx),
    rx: Math.sqrt(p.Ix / p.area),
    ry: Math.sqrt(p.Iy / p.area),
    r2: Math.sqrt(I2 / p.area),
  };
}

const positive = (values: Readonly<Record<string, number>>, keys: readonly string[]) => {
  for (const key of keys) {
    const v = values[key];
    if (!(typeof v === 'number' && Number.isFinite(v) && v > 0)) throw new SectionError(`Dimension ${key} must be a number above zero.`);
  }
};

/** Properties of a shape from its dimensions in mm. */
export function sectionProperties(shape: ShapeId, d: Readonly<Record<string, number>>): SectionProperties {
  const spec = SHAPES.find((s) => s.id === shape);
  if (!spec) throw new SectionError('Unknown shape.');
  positive(
    d,
    spec.dims.map((x) => x.key),
  );
  const b = d.b ?? 0;
  const h = d.h ?? 0;
  const t = d.t ?? 0;
  const tf = d.tf ?? 0;
  const tw = d.tw ?? 0;
  switch (shape) {
    case 'rectangle':
      return fromRects([{ x: 0, y: 0, w: b, h }], rectangleTorsion(b, h), 2 * (b + h));
    case 'box': {
      if (2 * t >= Math.min(b, h)) throw new SectionError('The wall is too thick for that width and depth.');
      const rects = [
        { x: 0, y: 0, w: b, h: t },
        { x: 0, y: h - t, w: b, h: t },
        { x: 0, y: t, w: t, h: h - 2 * t },
        { x: b - t, y: t, w: t, h: h - 2 * t },
      ];
      // Bredt's formula on the wall's centre line.
      const enclosed = (b - t) * (h - t);
      return fromRects(rects, (4 * enclosed * enclosed * t) / (2 * (b - t + (h - t))), 2 * (b + h));
    }
    case 'circle':
    case 'tube': {
      const D = d.d ?? 0;
      const inner = shape === 'tube' ? D - 2 * t : 0;
      if (shape === 'tube' && inner <= 0) throw new SectionError('The wall is too thick for that diameter.');
      const area = (Math.PI * (D * D - inner * inner)) / 4;
      const I = (Math.PI * (D ** 4 - inner ** 4)) / 64;
      const Z = (D ** 3 - inner ** 3) / 6;
      return finish({ area, cx: D / 2, cy: D / 2, width: D, height: D, Ix: I, Iy: I, Ixy: 0, J: 2 * I, perimeter: Math.PI * D, Zx: Z, Zy: Z, rects: [], circle: { d: D, inner } });
    }
    case 'ibeam': {
      if (2 * tf >= h || tw >= b) throw new SectionError('The flanges or the web are too thick for that size.');
      const rects = [
        { x: 0, y: 0, w: b, h: tf },
        { x: 0, y: h - tf, w: b, h: tf },
        { x: (b - tw) / 2, y: tf, w: tw, h: h - 2 * tf },
      ];
      const J = 2 * rectangleTorsion(b, tf) + rectangleTorsion(h - 2 * tf, tw);
      return fromRects(rects, J, 4 * b + 2 * h - 2 * tw);
    }
    case 'channel': {
      if (2 * tf >= h || tw >= b) throw new SectionError('The flanges or the web are too thick for that size.');
      const rects = [
        { x: 0, y: 0, w: b, h: tf },
        { x: 0, y: h - tf, w: b, h: tf },
        { x: 0, y: tf, w: tw, h: h - 2 * tf },
      ];
      const J = 2 * rectangleTorsion(b, tf) + rectangleTorsion(h - 2 * tf, tw);
      return fromRects(rects, J, 4 * b + 2 * h - 2 * tw);
    }
    case 'angle': {
      if (t >= Math.min(b, h)) throw new SectionError('The thickness must be less than both legs.');
      const rects = [
        { x: 0, y: 0, w: b, h: t },
        { x: 0, y: t, w: t, h: h - t },
      ];
      const J = rectangleTorsion(b, t) + rectangleTorsion(h - t, t);
      return fromRects(rects, J, 2 * (b + h));
    }
    case 'tee': {
      if (tf >= h || tw >= b) throw new SectionError('The flange or the stem is too thick for that size.');
      const rects = [
        { x: 0, y: h - tf, w: b, h: tf },
        { x: (b - tw) / 2, y: 0, w: tw, h: h - tf },
      ];
      const J = rectangleTorsion(b, tf) + rectangleTorsion(h - tf, tw);
      return fromRects(rects, J, 2 * (b + h));
    }
  }
}
