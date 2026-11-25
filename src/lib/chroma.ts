/**
 * Green-screen keying: which pixels are the backdrop colour, how see-through
 * they become, and how the backdrop's tint is taken off the subject.  The
 * arithmetic is FFmpeg's (its chromakey and despill filters), so the preview
 * drawn here and a video FFmpeg exports agree.
 */

export type Rgb = readonly [number, number, number];
export type Matrix = 'bt601' | 'bt709';

export interface KeySettings {
  /** The backdrop colour to remove. */
  readonly key: Rgb;
  /** How far from the key colour a pixel may be and still count as backdrop (0 to 1). */
  readonly similarity: number;
  /** The width of the soft edge between backdrop and subject (0 for a hard edge). */
  readonly blend: number;
  /** How strongly the backdrop's tint is removed from the subject (0 for not at all). */
  readonly spill: number;
}

export interface Frame {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

const LUMA: Record<Matrix, readonly [number, number, number]> = { bt601: [0.299, 0.587, 0.114], bt709: [0.2126, 0.7152, 0.0722] };

/** The two colour-difference values of a colour, each from -127.5 to 127.5. */
export function chromaOf(r: number, g: number, b: number, matrix: Matrix = 'bt601'): [number, number] {
  const [kr, kg, kb] = LUMA[matrix];
  const y = kr * r + kg * g + kb * b;
  return [(b - y) / (2 - 2 * kb), (r - y) / (2 - 2 * kr)];
}

const DISTANCE = 255 * Math.SQRT2;

/**
 * How solid every pixel is (0 see-through, 255 solid): the distance of its colour from the key
 * colour, averaged over the pixel and its eight neighbours as FFmpeg does, against the tolerance.
 * (Only the outermost line of pixels can differ from FFmpeg, which treats the frame's edge unevenly.)
 */
export function alphaMap(frame: Frame, settings: KeySettings, matrix: Matrix = 'bt601'): Uint8ClampedArray {
  const { data, width, height } = frame;
  const [keyB, keyR] = chromaOf(settings.key[0], settings.key[1], settings.key[2], matrix);
  const [kr, kg, kb] = LUMA[matrix];
  const sb = 1 / (2 - 2 * kb);
  const sr = 1 / (2 - 2 * kr);
  const count = width * height;
  const far = new Float32Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    const r = data[p] as number;
    const g = data[p + 1] as number;
    const b = data[p + 2] as number;
    const y = kr * r + kg * g + kb * b;
    const db = (b - y) * sb - keyB;
    const dr = (r - y) * sr - keyR;
    far[i] = Math.sqrt(db * db + dr * dr) / DISTANCE;
  }
  // Rows first, then columns; at the edge of the picture the edge pixel stands in for what lies beyond.
  const rows = new Float32Array(count);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) rows[row + x] = (far[row + (x > 0 ? x - 1 : x)] as number) + (far[row + x] as number) + (far[row + (x < width - 1 ? x + 1 : x)] as number);
  }
  const alpha = new Uint8ClampedArray(count);
  const { similarity, blend } = settings;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const mean = ((rows[(y > 0 ? row - width : row) + x] as number) + (rows[row + x] as number) + (rows[(y < height - 1 ? row + width : row) + x] as number)) / 9;
      alpha[row + x] = blend > 0.0001 ? Math.min(Math.max((mean - similarity) / blend, 0), 1) * 255 : mean > similarity ? 255 : 0;
    }
  }
  return alpha;
}

/** Green backdrops leave a green tint, blue ones a blue tint. */
export const spillType = (key: Rgb): 'green' | 'blue' => (key[2] > key[1] ? 'blue' : 'green');

/** Takes the backdrop's tint off the colours, in place: what is more green (or blue) than the other two channels allow is removed. */
export function despill(data: Uint8ClampedArray, type: 'green' | 'blue', strength: number): void {
  if (strength <= 0) return;
  const main = type === 'green' ? 1 : 2;
  const other = type === 'green' ? 2 : 1;
  for (let p = 0; p < data.length; p += 4) {
    const tint = (data[p + main] as number) - ((data[p] as number) * 0.5 + (data[p + other] as number) * 0.5);
    if (tint > 0) data[p + main] = (data[p + main] as number) - tint * strength;
  }
}

/** A frame with its backdrop removed: a new picture whose see-through parts are where the key colour was. */
export function keyFrame(frame: Frame, settings: KeySettings, matrix: Matrix = 'bt601'): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frame.data);
  const alpha = alphaMap(frame, settings, matrix);
  despill(out, spillType(settings.key), settings.spill);
  for (let i = 0, p = 3; i < alpha.length; i++, p += 4) out[p] = ((alpha[i] as number) * (out[p] as number)) / 255;
  return out;
}

/** The matte as a picture: white where the subject stays, black where the backdrop goes. */
export function matteFrame(frame: Frame, settings: KeySettings, matrix: Matrix = 'bt601'): Uint8ClampedArray {
  const alpha = alphaMap(frame, settings, matrix);
  const out = new Uint8ClampedArray(frame.data.length);
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    out[p] = out[p + 1] = out[p + 2] = alpha[i] as number;
    out[p + 3] = 255;
  }
  return out;
}

/**
 * A guess at the backdrop colour from the edges of the picture, where the backdrop usually shows:
 * the average of the strongly green (or blue) pixels there, whichever there are more of.
 */
export function guessKey(frame: Frame): Rgb {
  const { data, width, height } = frame;
  const margin = Math.max(1, Math.round(Math.min(width, height) * 0.05));
  const sums = { green: [0, 0, 0, 0], blue: [0, 0, 0, 0] };
  const step = Math.max(1, Math.floor(Math.max(width, height) / 400));
  for (let y = 0; y < height; y += step) {
    const edgeRow = y < margin || y >= height - margin;
    for (let x = 0; x < width; x += edgeRow ? step : Math.max(step, width - 2 * margin)) {
      if (!edgeRow && x >= margin && x < width - margin) continue;
      const p = (y * width + x) * 4;
      const r = data[p] as number;
      const g = data[p + 1] as number;
      const b = data[p + 2] as number;
      const sum = g > b ? sums.green : sums.blue;
      const lead = Math.max(g, b) - Math.max(r, Math.min(g, b));
      if (lead < 40) continue;
      sum[0] = (sum[0] as number) + r;
      sum[1] = (sum[1] as number) + g;
      sum[2] = (sum[2] as number) + b;
      sum[3] = (sum[3] as number) + 1;
    }
  }
  const best = (sums.green[3] as number) >= (sums.blue[3] as number) ? sums.green : sums.blue;
  const n = best[3] as number;
  return n > 0 ? [Math.round((best[0] as number) / n), Math.round((best[1] as number) / n), Math.round((best[2] as number) / n)] : [0, 177, 64];
}

export const hexOf = (rgb: Rgb): string =>
  `#${rgb
    .map((v) =>
      Math.round(Math.min(Math.max(v, 0), 255))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

export function rgbOf(hex: string): Rgb | null {
  const found = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!found) return null;
  const n = Number.parseInt(found[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface SourceColour {
  /** How the video's colours are stored. */
  readonly matrix: Matrix;
  /** Whether its values use the whole range (0-255) or the broadcast range (16-240), as most video does. */
  readonly full: boolean;
}

/** What FFprobe's report says about how a video stores its colours. */
export function sourceColour(stream: { pix_fmt?: unknown; color_space?: unknown; color_range?: unknown } | undefined): SourceColour {
  const format = typeof stream?.pix_fmt === 'string' ? stream.pix_fmt : '';
  // Pictures in red, green and blue are turned into broadcast-range video before FFmpeg keys them.
  if (/^(rgb|bgr|gbr|argb|abgr|pal|gray|ya|mono)/.test(format)) return { matrix: 'bt601', full: false };
  return { matrix: stream?.color_space === 'bt709' ? 'bt709' : 'bt601', full: stream?.color_range === 'pc' || format.startsWith('yuvj') };
}

/**
 * The settings to hand FFmpeg so that it removes what the preview removes.  FFmpeg compares the
 * video's stored colour values with a key colour it converts in its own way (full range, BT.601):
 * the key colour and the tolerances are restated in those terms.
 */
export function ffmpegKey(settings: KeySettings, source: SourceColour): { key: string; similarity: number; blend: number; spill: number; spillType: 'green' | 'blue' } {
  const squeeze = source.full ? 1 : 224 / 255;
  const [cb, cr] = chromaOf(settings.key[0], settings.key[1], settings.key[2], source.matrix);
  const b = cb * squeeze;
  const r = cr * squeeze;
  // A colour with that colour difference in FFmpeg's reckoning, as near the key's brightness as red, green and blue allow.
  const offsets = [1.402 * r, -0.344136 * b - 0.714136 * r, 1.772 * b];
  const low = Math.max(...offsets.map((offset) => -offset));
  const high = Math.min(...offsets.map((offset) => 255 - offset));
  const wanted = 0.299 * settings.key[0] + 0.587 * settings.key[1] + 0.114 * settings.key[2];
  const y = low <= high ? Math.min(Math.max(wanted, low), high) : (low + high) / 2;
  return {
    key: hexOf([y + (offsets[0] as number), y + (offsets[1] as number), y + (offsets[2] as number)]),
    similarity: Math.max(0.00001, settings.similarity * squeeze),
    blend: settings.blend * squeeze,
    spill: settings.spill,
    spillType: spillType(settings.key),
  };
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where a background of one size is drawn in a frame of another: filling it, fitting inside it, or stretched. */
export function fitRect(sourceWidth: number, sourceHeight: number, width: number, height: number, mode: 'cover' | 'contain' | 'stretch'): Rect {
  if (mode === 'stretch' || !(sourceWidth > 0 && sourceHeight > 0)) return { x: 0, y: 0, width, height };
  const scale = mode === 'cover' ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/** Where the subject sits in the frame: scaled about the middle, then moved by a share of the frame (as FFmpeg's overlay is told). */
export function subjectRect(width: number, height: number, scale: number, dx: number, dy: number): Rect {
  const unscaled = Math.abs(scale - 1) <= 0.001;
  const w = unscaled ? width : Math.max(2, Math.trunc((width * scale) / 2) * 2);
  const h = unscaled ? height : Math.max(2, Math.trunc((height * scale) / 2) * 2);
  return { x: (width - w) / 2 + dx * width, y: (height - h) / 2 + dy * height, width: w, height: h };
}
