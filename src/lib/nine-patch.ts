/**
 * Android nine-patch (.9.png) helpers: reading and writing the one-pixel
 * guide border, scaling between densities and nine-slice layout.
 *
 * Ranges are half-open [start, end) in pixels of the picture without its
 * border.  Black guides on the top and left mark what stretches; on the right
 * and bottom they mark where content goes.  Red guides on the bottom and right
 * are optical (layout) bounds, read but not written.
 */

export type Range = readonly [start: number, end: number];

export interface Patches {
  readonly stretchX: readonly Range[];
  readonly stretchY: readonly Range[];
  /** Empty means "the same as the stretch area", as Android treats a missing guide. */
  readonly contentX: readonly Range[];
  readonly contentY: readonly Range[];
}

export interface ReadResult {
  readonly width: number;
  readonly height: number;
  readonly patches: Patches;
  /** Pixels of the picture without the border. */
  readonly inner: Uint8ClampedArray<ArrayBuffer>;
  readonly warnings: string[];
}

const isBlack = (d: Uint8ClampedArray, i: number) => d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0 && d[i + 3] === 255;
const isRed = (d: Uint8ClampedArray, i: number) => d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 0 && d[i + 3] === 255;
const isClear = (d: Uint8ClampedArray, i: number) => d[i + 3] === 0;

/** Runs of `test` along a line of `count` pixels; `at(k)` gives the byte index of pixel k. */
function runs(count: number, at: (k: number) => number, data: Uint8ClampedArray, test: (d: Uint8ClampedArray, i: number) => boolean): Range[] {
  const out: Range[] = [];
  let start = -1;
  for (let k = 0; k <= count; k++) {
    const on = k < count && test(data, at(k));
    if (on && start < 0) start = k;
    else if (!on && start >= 0) {
      out.push([start, k]);
      start = -1;
    }
  }
  return out;
}

/** Reads a .9.png's pixels (border included). */
export function readNinePatch(data: Uint8ClampedArray, fullWidth: number, fullHeight: number): ReadResult {
  if (fullWidth < 3 || fullHeight < 3) throw new RangeError('A nine-patch is at least 3 × 3 pixels: the picture plus a one-pixel border.');
  const width = fullWidth - 2;
  const height = fullHeight - 2;
  const px = (x: number, y: number) => (y * fullWidth + x) * 4;
  const warnings: string[] = [];
  const top = (k: number) => px(k + 1, 0);
  const bottom = (k: number) => px(k + 1, fullHeight - 1);
  const left = (k: number) => px(0, k + 1);
  const right = (k: number) => px(fullWidth - 1, k + 1);

  let stray = 0;
  for (const [count, at, guides] of [
    [width, top, [isBlack]],
    [height, left, [isBlack]],
    [width, bottom, [isBlack, isRed]],
    [height, right, [isBlack, isRed]],
  ] as const) {
    for (let k = 0; k < count; k++) {
      const i = at(k);
      if (!isClear(data, i) && !guides.some((g) => g(data, i))) stray++;
    }
  }
  if (stray) warnings.push(`${stray} border pixel${stray === 1 ? ' is' : 's are'} neither clear nor pure black; Android’s build tools reject such files.`);
  for (const [x, y] of [
    [0, 0],
    [fullWidth - 1, 0],
    [0, fullHeight - 1],
    [fullWidth - 1, fullHeight - 1],
  ] as const)
    if (!isClear(data, px(x, y))) {
      warnings.push('The corner pixels of the border should be transparent.');
      break;
    }

  const patches: Patches = {
    stretchX: runs(width, top, data, isBlack),
    stretchY: runs(height, left, data, isBlack),
    contentX: runs(width, bottom, data, isBlack),
    contentY: runs(height, right, data, isBlack),
  };
  if (!patches.stretchX.length || !patches.stretchY.length) warnings.push('No stretch guide was found on the top or left edge, so this does not look like a nine-patch.');
  if (patches.contentX.length > 1 || patches.contentY.length > 1) warnings.push('The content guides should be one line each; only the first and last pixels count.');
  if (runs(width, bottom, data, isRed).length || runs(height, right, data, isRed).length) warnings.push('Red optical-bounds guides were found; they are dropped when you save.');

  const inner = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) inner.set(data.subarray(px(1, y + 1), px(1, y + 1) + width * 4), y * width * 4);
  return { width, height, patches, inner, warnings };
}

/** Clamps, sorts and merges ranges so they are valid for a picture of `size` pixels. */
export function cleanRanges(ranges: readonly Range[], size: number): Range[] {
  const sorted = ranges
    .map(([a, b]) => [Math.max(0, Math.min(size, Math.round(Math.min(a, b)))), Math.max(0, Math.min(size, Math.round(Math.max(a, b))))] as const)
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The picture with its guide border, as RGBA pixels of (width + 2) × (height + 2). */
export function writeNinePatch(inner: Uint8ClampedArray, width: number, height: number, patches: Patches): Uint8ClampedArray<ArrayBuffer> {
  const fw = width + 2;
  const fh = height + 2;
  const out = new Uint8ClampedArray(fw * fh * 4);
  for (let y = 0; y < height; y++) out.set(inner.subarray(y * width * 4, (y + 1) * width * 4), ((y + 1) * fw + 1) * 4);
  const black = (x: number, y: number) => out.set([0, 0, 0, 255], (y * fw + x) * 4);
  for (const [a, b] of cleanRanges(patches.stretchX, width)) for (let k = a; k < b; k++) black(k + 1, 0);
  for (const [a, b] of cleanRanges(patches.stretchY, height)) for (let k = a; k < b; k++) black(0, k + 1);
  const content = (ranges: readonly Range[], size: number): Range[] => {
    const clean = cleanRanges(ranges, size);
    // Android only reads the first and last pixel of a content guide.
    return clean.length ? [[clean[0]?.[0] as number, clean[clean.length - 1]?.[1] as number]] : [];
  };
  for (const [a, b] of content(patches.contentX, width)) for (let k = a; k < b; k++) black(k + 1, fh - 1);
  for (const [a, b] of content(patches.contentY, height)) for (let k = a; k < b; k++) black(fw - 1, k + 1);
  return out;
}

/** Scales ranges for a picture resized from `from` to `to` pixels, keeping each at least one pixel. */
export function scaleRanges(ranges: readonly Range[], from: number, to: number): Range[] {
  const f = to / from;
  return cleanRanges(
    ranges.map(([a, b]) => {
      let start = Math.round(a * f);
      let end = Math.round(b * f);
      if (end <= start) {
        end = Math.min(to, start + 1);
        start = end - 1;
      }
      return [start, end] as const;
    }),
    to,
  );
}

export function scalePatches(p: Patches, from: { width: number; height: number }, to: { width: number; height: number }): Patches {
  return {
    stretchX: scaleRanges(p.stretchX, from.width, to.width),
    stretchY: scaleRanges(p.stretchY, from.height, to.height),
    contentX: scaleRanges(p.contentX, from.width, to.width),
    contentY: scaleRanges(p.contentY, from.height, to.height),
  };
}

export interface Segment {
  readonly from: number;
  readonly size: number;
  readonly stretch: boolean;
}

/** Splits one axis into fixed and stretching segments. */
export function segments(size: number, stretch: readonly Range[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const [a, b] of cleanRanges(stretch, size)) {
    if (a > at) out.push({ from: at, size: a - at, stretch: false });
    out.push({ from: a, size: b - a, stretch: true });
    at = b;
  }
  if (at < size) out.push({ from: at, size: size - at, stretch: false });
  return out;
}

/**
 * Target sizes for each segment when the axis is drawn `target` pixels long.
 * Extra space is shared by the stretching segments in proportion to their
 * size; when there is too little room the fixed segments shrink evenly.
 */
export function layoutAxis(parts: readonly Segment[], target: number): number[] {
  const fixed = parts.reduce((t, s) => t + (s.stretch ? 0 : s.size), 0);
  const stretchy = parts.reduce((t, s) => t + (s.stretch ? s.size : 0), 0);
  if (target <= fixed || stretchy === 0) {
    const f = fixed ? Math.min(1, target / fixed) : 0;
    return parts.map((s) => (s.stretch ? 0 : s.size * f));
  }
  const extra = target - fixed;
  return parts.map((s) => (s.stretch ? (extra * s.size) / stretchy : s.size));
}

/** The content box for a nine-patch drawn at a size, in target pixels. */
export function contentBox(width: number, height: number, p: Patches, targetW: number, targetH: number): { x: number; y: number; w: number; h: number } {
  const map = (size: number, stretch: readonly Range[], content: readonly Range[], target: number) => {
    const area = cleanRanges(content.length ? content : stretch, size);
    const start = area[0]?.[0] ?? 0;
    const end = area[area.length - 1]?.[1] ?? size;
    const parts = segments(size, stretch);
    const sizes = layoutAxis(parts, target);
    const at = (pos: number) => {
      let out = 0;
      for (const [i, s] of parts.entries()) {
        const t = sizes[i] as number;
        if (pos >= s.from + s.size) out += t;
        else {
          out += ((pos - s.from) / s.size) * t;
          break;
        }
      }
      return out;
    };
    return [at(start), at(end)] as const;
  };
  const [x0, x1] = map(width, p.stretchX, p.contentX, targetW);
  const [y0, y1] = map(height, p.stretchY, p.contentY, targetH);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** CSS border-image slices from the outermost stretch guides. */
export function borderImageCss(fileName: string, width: number, height: number, p: Patches, scale = 1): string {
  const sx = cleanRanges(p.stretchX, width);
  const sy = cleanRanges(p.stretchY, height);
  const left = sx[0]?.[0] ?? 0;
  const right = width - (sx[sx.length - 1]?.[1] ?? width);
  const top = sy[0]?.[0] ?? 0;
  const bottom = height - (sy[sy.length - 1]?.[1] ?? height);
  const cx = cleanRanges(p.contentX.length ? p.contentX : p.stretchX, width);
  const cy = cleanRanges(p.contentY.length ? p.contentY : p.stretchY, height);
  const padLeft = cx[0]?.[0] ?? 0;
  const padRight = width - (cx[cx.length - 1]?.[1] ?? width);
  const padTop = cy[0]?.[0] ?? 0;
  const padBottom = height - (cy[cy.length - 1]?.[1] ?? height);
  const r = (n: number) => `${Math.round((n / scale) * 100) / 100}px`;
  return `.nine-patch {
  /* Slices are in image pixels; widths are in CSS pixels for a ${scale}× image. */
  border-style: solid;
  border-width: ${r(top)} ${r(right)} ${r(bottom)} ${r(left)};
  border-image: url("${fileName}") ${top} ${right} ${bottom} ${left} fill / ${r(top)} ${r(right)} ${r(bottom)} ${r(left)} stretch;
  /* The content area, from the guides on the right and bottom. */
  padding: ${r(Math.max(0, padTop - top))} ${r(Math.max(0, padRight - right))} ${r(Math.max(0, padBottom - bottom))} ${r(Math.max(0, padLeft - left))};
}
`;
}
