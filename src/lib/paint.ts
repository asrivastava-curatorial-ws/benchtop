/**
 * Pixel operations for the Paint tool, on plain RGBA arrays so they run
 * without a canvas: flood fill with a tolerance, aliased lines and brush
 * stamps, rotation, flips, inversion, and BMP files.
 */

export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type Rgba = readonly [number, number, number, number];

/** The 28 colours of the classic Paint palette, two rows. */
export const PALETTE: readonly string[] = [
  '#000000',
  '#808080',
  '#800000',
  '#808000',
  '#008000',
  '#008080',
  '#000080',
  '#800080',
  '#808040',
  '#004040',
  '#0080ff',
  '#004080',
  '#8000ff',
  '#804000',
  '#ffffff',
  '#c0c0c0',
  '#ff0000',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#0000ff',
  '#ff00ff',
  '#ffff80',
  '#00ff80',
  '#80ffff',
  '#8080ff',
  '#ff0080',
  '#ff8040',
];

export function hexToRgba(hex: string, alpha = 255): Rgba {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0, alpha];
  const n = Number.parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export const rgbaToHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * Fills the area of like colour around (x, y): pixels whose channels each
 * differ from the starting pixel's by at most `tolerance` (0 to 255), joined
 * side to side.  Returns how many pixels were filled.
 */
export function floodFill(p: Pixels, x: number, y: number, colour: Rgba, tolerance = 0): number {
  const { width: w, height: h, data } = p;
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  const start = (y * w + x) * 4;
  const target = [data[start] as number, data[start + 1] as number, data[start + 2] as number, data[start + 3] as number];
  if (tolerance === 0 && target.every((v, i) => v === colour[i])) return 0;
  const seen = new Uint8Array(w * h);
  const like = (i: number) => {
    const o = i * 4;
    return (
      Math.abs((data[o] as number) - (target[0] as number)) <= tolerance &&
      Math.abs((data[o + 1] as number) - (target[1] as number)) <= tolerance &&
      Math.abs((data[o + 2] as number) - (target[2] as number)) <= tolerance &&
      Math.abs((data[o + 3] as number) - (target[3] as number)) <= tolerance
    );
  };
  let filled = 0;
  const stack: number[] = [x, y];
  while (stack.length) {
    const sy = stack.pop() as number;
    let sx = stack.pop() as number;
    let i = sy * w + sx;
    if (seen[i] || !like(i)) continue;
    // Run left to the start of the span, then fill rightwards, queueing the rows above and below.
    while (sx > 0 && !seen[i - 1] && like(i - 1)) {
      sx--;
      i--;
    }
    let up = false;
    let down = false;
    while (sx < w && !seen[i] && like(i)) {
      seen[i] = 1;
      const o = i * 4;
      data[o] = colour[0];
      data[o + 1] = colour[1];
      data[o + 2] = colour[2];
      data[o + 3] = colour[3];
      filled++;
      if (sy > 0) {
        const a = i - w;
        const ok = !seen[a] && like(a);
        if (ok && !up) stack.push(sx, sy - 1);
        up = ok;
      }
      if (sy < h - 1) {
        const b = i + w;
        const ok = !seen[b] && like(b);
        if (ok && !down) stack.push(sx, sy + 1);
        down = ok;
      }
      sx++;
      i++;
    }
  }
  return filled;
}

/** The pixels on a straight line from (x0, y0) to (x1, y1), ends included (Bresenham). */
export function linePixels(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 1_000_000; guard++) {
    plot(x, y);
    if (x === xe && y === ye) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Horizontal runs [dx0, dx1, dy] covering a filled disc of a diameter, around the origin. */
export function discSpans(diameter: number): [number, number, number][] {
  const d = Math.max(1, Math.round(diameter));
  const lo = -Math.floor(d / 2) || 0; // not −0
  const hi = lo + d - 1;
  // Even discs are centred between pixels.
  const c = d % 2 === 1 ? 0 : -0.5;
  const r2 = (d / 2) ** 2 + 0.25;
  const spans: [number, number, number][] = [];
  for (let y = lo; y <= hi; y++) {
    let left: number | null = null;
    let right = 0;
    for (let x = lo; x <= hi; x++) {
      if ((x - c) ** 2 + (y - c) ** 2 <= r2) {
        left ??= x;
        right = x;
      }
    }
    if (left !== null) spans.push([left, right, y]);
  }
  return spans;
}

export function rotate(p: Pixels, quarterTurns: number): Pixels {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
  const w = p.width;
  const h = p.height;
  const nw = turns % 2 ? h : w;
  const nh = turns % 2 ? w : h;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let tx: number;
      let ty: number;
      if (turns === 1) {
        tx = h - 1 - y;
        ty = x;
      } else if (turns === 2) {
        tx = w - 1 - x;
        ty = h - 1 - y;
      } else {
        tx = y;
        ty = w - 1 - x;
      }
      out.set(p.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (ty * nw + tx) * 4);
    }
  }
  return { width: nw, height: nh, data: out };
}

export function flip(p: Pixels, horizontal: boolean): Pixels {
  const { width: w, height: h } = p;
  const out = new Uint8ClampedArray(p.data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = (y * w + x) * 4;
      const to = horizontal ? (y * w + (w - 1 - x)) * 4 : ((h - 1 - y) * w + x) * 4;
      out.set(p.data.subarray(from, from + 4), to);
    }
  }
  return { width: w, height: h, data: out };
}

/** Inverts the colours, keeping transparency. */
export function invert(p: Pixels): Pixels {
  const out = new Uint8ClampedArray(p.data);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - (out[i] as number);
    out[i + 1] = 255 - (out[i + 1] as number);
    out[i + 2] = 255 - (out[i + 2] as number);
  }
  return { width: p.width, height: p.height, data: out };
}

/** A 24-bit BMP file; transparent pixels are laid on white, as Paint does. */
export function encodeBmp(p: Pixels): Uint8Array {
  const { width: w, height: h, data } = p;
  const stride = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + stride * h;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, w, true);
  view.setInt32(22, h, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, stride * h, true);
  // 2835 pixels a metre is 72 dots an inch.
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    const row = 54 + (h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = (data[i + 3] as number) / 255;
      const over = (v: number) => Math.round(v * a + 255 * (1 - a));
      bytes[row + x * 3] = over(data[i + 2] as number);
      bytes[row + x * 3 + 1] = over(data[i + 1] as number);
      bytes[row + x * 3 + 2] = over(data[i] as number);
    }
  }
  return bytes;
}
