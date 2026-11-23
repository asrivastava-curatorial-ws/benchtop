/**
 * Dithering, halftone screens and perspective correction on RGBA pixels.
 * Pure functions over Uint8ClampedArray so they can be tested without a DOM.
 */

export type Rgb = readonly [number, number, number];

export const PALETTES: Record<string, { label: string; colors: readonly Rgb[] }> = {
  bw: {
    label: 'Black and white',
    colors: [
      [0, 0, 0],
      [255, 255, 255],
    ],
  },
  gray4: {
    label: '4 greys',
    colors: [
      [0, 0, 0],
      [85, 85, 85],
      [170, 170, 170],
      [255, 255, 255],
    ],
  },
  gameboy: {
    label: 'Game Boy greens',
    colors: [
      [15, 56, 15],
      [48, 98, 48],
      [139, 172, 15],
      [155, 188, 15],
    ],
  },
  cga: {
    label: 'CGA (cyan, magenta, white)',
    colors: [
      [0, 0, 0],
      [85, 255, 255],
      [255, 85, 255],
      [255, 255, 255],
    ],
  },
  rgb8: {
    label: '8 colours',
    colors: [
      [0, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [0, 255, 255],
      [255, 0, 255],
      [255, 255, 255],
    ],
  },
  sepia: {
    label: 'Sepia print',
    colors: [
      [38, 26, 16],
      [112, 84, 56],
      [196, 170, 128],
      [246, 236, 214],
    ],
  },
  newspaper: {
    label: 'Newsprint',
    colors: [
      [30, 30, 32],
      [236, 232, 220],
    ],
  },
};

const nearest = (r: number, g: number, b: number, palette: readonly Rgb[]): Rgb => {
  let best = palette[0] as Rgb;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of palette) {
    // Weighted distance: the eye is most sensitive to green.
    const d = 0.3 * (r - c[0]) ** 2 + 0.59 * (g - c[1]) ** 2 + 0.11 * (b - c[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
};

const KERNELS: Record<'floyd' | 'atkinson' | 'stucki', { div: number; taps: readonly (readonly [number, number, number])[] }> = {
  floyd: {
    div: 16,
    taps: [
      [1, 0, 7],
      [-1, 1, 3],
      [0, 1, 5],
      [1, 1, 1],
    ],
  },
  // Atkinson spreads only 6/8 of the error, which keeps highlights and shadows clean (classic Macintosh look).
  atkinson: {
    div: 8,
    taps: [
      [1, 0, 1],
      [2, 0, 1],
      [-1, 1, 1],
      [0, 1, 1],
      [1, 1, 1],
      [0, 2, 1],
    ],
  },
  stucki: {
    div: 42,
    taps: [
      [1, 0, 8],
      [2, 0, 4],
      [-2, 1, 2],
      [-1, 1, 4],
      [0, 1, 8],
      [1, 1, 4],
      [2, 1, 2],
      [-2, 2, 1],
      [-1, 2, 2],
      [0, 2, 4],
      [1, 2, 2],
      [2, 2, 1],
    ],
  },
};

/** Error diffusion to a palette, in place; alpha is left alone. */
export function diffuse(data: Uint8ClampedArray, width: number, height: number, palette: readonly Rgb[], kernel: keyof typeof KERNELS, serpentine = true): void {
  const k = KERNELS[kernel];
  const buf = new Float32Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    buf[j] = data[i] as number;
    buf[j + 1] = data[i + 1] as number;
    buf[j + 2] = data[i + 2] as number;
  }
  for (let y = 0; y < height; y++) {
    const reverse = serpentine && y % 2 === 1;
    for (let n = 0; n < width; n++) {
      const x = reverse ? width - 1 - n : n;
      const j = (y * width + x) * 3;
      const r = buf[j] as number;
      const g = buf[j + 1] as number;
      const b = buf[j + 2] as number;
      const c = nearest(r, g, b, palette);
      const er = r - c[0];
      const eg = g - c[1];
      const eb = b - c[2];
      const i = (y * width + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      for (const [dx0, dy, w] of k.taps) {
        const dx = reverse ? -dx0 : dx0;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || xx >= width || yy >= height) continue;
        const t = (yy * width + xx) * 3;
        const f = w / k.div;
        buf[t] = (buf[t] as number) + er * f;
        buf[t + 1] = (buf[t + 1] as number) + eg * f;
        buf[t + 2] = (buf[t + 2] as number) + eb * f;
      }
    }
  }
}

/** Bayer threshold matrix of size 2^n, values 0..size²-1. */
export function bayer(n: number): number[][] {
  let m = [[0]];
  for (let k = 0; k < n; k++) {
    const s = m.length;
    const next: number[][] = Array.from({ length: s * 2 }, () => new Array<number>(s * 2).fill(0));
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const v = (m[y]?.[x] ?? 0) * 4;
        (next[y] as number[])[x] = v;
        (next[y] as number[])[x + s] = v + 2;
        (next[y + s] as number[])[x] = v + 3;
        (next[y + s] as number[])[x + s] = v + 1;
      }
    m = next;
  }
  return m;
}

/** Ordered (Bayer) dithering to a palette. */
export function ordered(data: Uint8ClampedArray, width: number, height: number, palette: readonly Rgb[], level: 1 | 2 | 3): void {
  const m = bayer(level);
  const size = m.length;
  // Spread roughly one palette step around each pixel.
  const spread = 255 / Math.max(1, Math.cbrt(palette.length) * 1.5);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const t = (((m[y % size] as number[])[x % size] as number) + 0.5) / (size * size) - 0.5;
      const i = (y * width + x) * 4;
      const c = nearest((data[i] as number) + t * spread, (data[i + 1] as number) + t * spread, (data[i + 2] as number) + t * spread, palette);
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
    }
}

export const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/* ------------------------------------------------------------ homography -- */

export type Point = { readonly x: number; readonly y: number };
type Matrix3 = [number, number, number, number, number, number, number, number, number];

/** Solves the 8×8 system for the projective map taking `from` corners to `to` corners. */
export function homography(from: readonly Point[], to: readonly Point[]): Matrix3 {
  const a: number[][] = [];
  const b: number[] = [];
  for (let k = 0; k < 4; k++) {
    const { x, y } = from[k] as Point;
    const { x: u, y: v } = to[k] as Point;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs((a[r] as number[])[c] as number) > Math.abs((a[p] as number[])[c] as number)) p = r;
    [a[c], a[p]] = [a[p] as number[], a[c] as number[]];
    [b[c], b[p]] = [b[p] as number, b[c] as number];
    const pivot = (a[c] as number[])[c] as number;
    if (Math.abs(pivot) < 1e-12) throw new RangeError('The corners are in a line; move them apart.');
    for (let r = c + 1; r < n; r++) {
      const f = ((a[r] as number[])[c] as number) / pivot;
      for (let k = c; k < n; k++) (a[r] as number[])[k] = ((a[r] as number[])[k] as number) - f * ((a[c] as number[])[k] as number);
      b[r] = (b[r] as number) - f * (b[c] as number);
    }
  }
  const h = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r] as number;
    for (let k = r + 1; k < n; k++) s -= ((a[r] as number[])[k] as number) * (h[k] as number);
    h[r] = s / ((a[r] as number[])[r] as number);
  }
  return [...(h as [number, number, number, number, number, number, number, number]), 1];
}

export function project(m: Matrix3, p: Point): Point {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
}

/**
 * Straightens the quadrilateral `corners` (top-left, top-right, bottom-right,
 * bottom-left, in source pixels) into a width × height rectangle.
 */
export function warpPerspective(src: Uint8ClampedArray, sw: number, sh: number, corners: readonly Point[], width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  const target = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const m = homography(target, corners);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = project(m, { x: x + 0.5, y: y + 0.5 });
      const fx = p.x - 0.5;
      const fy = p.y - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const o = (y * width + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const at = (xx: number, yy: number) => src[(Math.min(sh - 1, Math.max(0, yy)) * sw + Math.min(sw - 1, Math.max(0, xx))) * 4 + ch] as number;
        const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
        const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
        out[o + ch] = top * (1 - ty) + bottom * ty;
      }
    }
  return out;
}

/** A sensible output size for corners: the longer of each pair of opposite sides. */
export function naturalSize(c: readonly Point[]): { width: number; height: number } {
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const [tl, tr, br, bl] = c as [Point, Point, Point, Point];
  return { width: Math.round(Math.max(d(tl, tr), d(bl, br))), height: Math.round(Math.max(d(tl, bl), d(tr, br))) };
}
