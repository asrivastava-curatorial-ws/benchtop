/**
 * Pure pixel operations on RGBA buffers (the layout of canvas ImageData).
 * Nothing here touches the DOM, so every function is unit-tested directly.
 */
import type { Rgba } from './color';

export type Pixels = Uint8ClampedArray;

/* ------------------------------------------------------------ colour math -- */

const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toSrgb8(linear: number): number {
  const c = linear <= 0 ? 0 : Math.min(linear, 1);
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
}

/**
 * Colour-vision-deficiency simulation matrices for linear RGB at full
 * severity, from Machado, Oliveira and Fernandes (2009).
 */
export const CVD_MATRICES = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
} as const;

export type Deficiency = keyof typeof CVD_MATRICES | 'achromatopsia';

/** Returns a copy of the pixels as seen with the given colour vision deficiency. */
export function simulateDeficiency(source: Pixels, kind: Deficiency): Pixels {
  const out = new Uint8ClampedArray(source.length);
  const m = kind === 'achromatopsia' ? null : CVD_MATRICES[kind];
  for (let i = 0; i < source.length; i += 4) {
    const r = TO_LINEAR[source[i] as number] as number;
    const g = TO_LINEAR[source[i + 1] as number] as number;
    const b = TO_LINEAR[source[i + 2] as number] as number;
    if (m === null) {
      const y = toSrgb8(0.2126 * r + 0.7152 * g + 0.0722 * b);
      out[i] = y;
      out[i + 1] = y;
      out[i + 2] = y;
    } else {
      out[i] = toSrgb8((m[0] as number) * r + (m[1] as number) * g + (m[2] as number) * b);
      out[i + 1] = toSrgb8((m[3] as number) * r + (m[4] as number) * g + (m[5] as number) * b);
      out[i + 2] = toSrgb8((m[6] as number) * r + (m[7] as number) * g + (m[8] as number) * b);
    }
    out[i + 3] = source[i + 3] as number;
  }
  return out;
}

/* ---------------------------------------------------------------- filters -- */

export interface FilterSettings {
  /** 100 = unchanged. */
  readonly brightness: number;
  readonly contrast: number;
  readonly saturation: number;
  /** 0-100. */
  readonly grayscale: number;
  readonly sepia: number;
  readonly invert: number;
  /** Degrees. */
  readonly hue: number;
}

export const NEUTRAL_FILTER: FilterSettings = { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, invert: 0, hue: 0 };

type Matrix3 = [number, number, number, number, number, number, number, number, number];

const multiply3 = (a: Matrix3, b: Matrix3): Matrix3 => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
  a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
  a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
  a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
  a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
  a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
  a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

/** The colour matrices defined by the CSS Filter Effects specification. */
function saturateMatrix(s: number): Matrix3 {
  return [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
}

function sepiaMatrix(amount: number): Matrix3 {
  const a = 1 - amount;
  return [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a, 0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a, 0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a];
}

function hueMatrix(degrees: number): Matrix3 {
  const cos = Math.cos((degrees * Math.PI) / 180);
  const sin = Math.sin((degrees * Math.PI) / 180);
  return [
    0.213 + cos * 0.787 - sin * 0.213,
    0.715 - cos * 0.715 - sin * 0.715,
    0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143,
    0.715 + cos * 0.285 + sin * 0.14,
    0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787,
    0.715 - cos * 0.715 + sin * 0.715,
    0.072 + cos * 0.928 + sin * 0.072,
  ];
}

/**
 * Applies colour adjustments in the same order and with the same maths as the
 * CSS filter list `brightness() contrast() saturate() grayscale() sepia()
 * hue-rotate() invert()`, so results match what a browser would show.
 */
export function applyFilters(source: Pixels, settings: FilterSettings): Pixels {
  const out = new Uint8ClampedArray(source.length);
  const brightness = settings.brightness / 100;
  const contrast = settings.contrast / 100;
  const invert = settings.invert / 100;
  let matrix: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (settings.saturation !== 100) matrix = multiply3(saturateMatrix(settings.saturation / 100), matrix);
  if (settings.grayscale > 0) matrix = multiply3(saturateMatrix(1 - settings.grayscale / 100), matrix);
  if (settings.sepia > 0) matrix = multiply3(sepiaMatrix(settings.sepia / 100), matrix);
  if (settings.hue % 360 !== 0) matrix = multiply3(hueMatrix(settings.hue), matrix);
  const identity = matrix[0] === 1 && matrix[4] === 1 && matrix[8] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 0 && matrix[5] === 0 && matrix[6] === 0 && matrix[7] === 0;

  // Brightness and contrast are per-channel, so they collapse into one lookup table.
  const tone = new Float32Array(256);
  for (let i = 0; i < 256; i++) tone[i] = Math.min(255, Math.max(0, (i * brightness - 127.5) * contrast + 127.5));

  for (let i = 0; i < source.length; i += 4) {
    let r = tone[source[i] as number] as number;
    let g = tone[source[i + 1] as number] as number;
    let b = tone[source[i + 2] as number] as number;
    if (!identity) {
      const nr = matrix[0] * r + matrix[1] * g + matrix[2] * b;
      const ng = matrix[3] * r + matrix[4] * g + matrix[5] * b;
      const nb = matrix[6] * r + matrix[7] * g + matrix[8] * b;
      r = nr < 0 ? 0 : Math.min(nr, 255);
      g = ng < 0 ? 0 : Math.min(ng, 255);
      b = nb < 0 ? 0 : Math.min(nb, 255);
    }
    if (invert > 0) {
      r += (255 - 2 * r) * invert;
      g += (255 - 2 * g) * invert;
      b += (255 - 2 * b) * invert;
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = source[i + 3] as number;
  }
  return out;
}

/** Box blur applied three times: a close, fast approximation of a Gaussian blur. */
export function blur(source: Pixels, width: number, height: number, radius: number): Pixels {
  const r = Math.round(radius);
  if (r < 1) return new Uint8ClampedArray(source);
  let current = new Float32Array(source.length);
  // Premultiply so that transparent pixels do not bleed their colour into neighbours.
  for (let i = 0; i < source.length; i += 4) {
    const alpha = (source[i + 3] as number) / 255;
    current[i] = (source[i] as number) * alpha;
    current[i + 1] = (source[i + 1] as number) * alpha;
    current[i + 2] = (source[i + 2] as number) * alpha;
    current[i + 3] = source[i + 3] as number;
  }
  let scratch = new Float32Array(source.length);
  const pass = (from: Float32Array, to: Float32Array, lineLength: number, lineCount: number, step: number, lineStep: number) => {
    const window = r * 2 + 1;
    for (let line = 0; line < lineCount; line++) {
      const base = line * lineStep;
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += from[base + Math.min(lineLength - 1, Math.max(0, k)) * step + channel] as number;
        for (let position = 0; position < lineLength; position++) {
          to[base + position * step + channel] = sum / window;
          const leaving = Math.max(0, position - r);
          const entering = Math.min(lineLength - 1, position + r + 1);
          sum += (from[base + entering * step + channel] as number) - (from[base + leaving * step + channel] as number);
        }
      }
    }
  };
  for (let iteration = 0; iteration < 3; iteration++) {
    pass(current, scratch, width, height, 4, width * 4);
    pass(scratch, current, height, width, width * 4, 4);
  }
  scratch = current;
  const out = new Uint8ClampedArray(source.length);
  for (let i = 0; i < out.length; i += 4) {
    const alpha = scratch[i + 3] as number;
    if (alpha > 0.5) {
      const scale = 255 / alpha;
      out[i] = (scratch[i] as number) * scale;
      out[i + 1] = (scratch[i + 1] as number) * scale;
      out[i + 2] = (scratch[i + 2] as number) * scale;
      out[i + 3] = alpha;
    }
  }
  current = scratch;
  return out;
}

/* ------------------------------------------------------- colour replacing -- */

export interface ReplaceOptions {
  readonly from: Rgba;
  /** Replacement colour; alpha 0 makes matching pixels transparent. */
  readonly to: Rgba;
  /** 0-100: how far (as a share of the maximum RGB distance) a pixel may be from `from`. */
  readonly tolerance: number;
  /** 0-100: width of the soft transition beyond the tolerance, to avoid jagged edges. */
  readonly feather: number;
  /** Also turn `to`-coloured pixels into `from` (a two-way swap). */
  readonly swap: boolean;
}

const MAX_DISTANCE = Math.sqrt(3 * 255 * 255);

function distance(data: Pixels, i: number, color: Rgba): number {
  const dr = (data[i] as number) - color.r;
  const dg = (data[i + 1] as number) - color.g;
  const db = (data[i + 2] as number) - color.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Replaces one colour by another; returns the new pixels and how many were affected. */
export function replaceColor(source: Pixels, options: ReplaceOptions): { pixels: Pixels; changed: number } {
  const out = new Uint8ClampedArray(source);
  const inner = (options.tolerance / 100) * MAX_DISTANCE;
  const outer = inner + (options.feather / 100) * MAX_DISTANCE;
  let changed = 0;
  const blend = (i: number, target: Rgba, amount: number) => {
    out[i] = (source[i] as number) + (target.r - (source[i] as number)) * amount;
    out[i + 1] = (source[i + 1] as number) + (target.g - (source[i + 1] as number)) * amount;
    out[i + 2] = (source[i + 2] as number) + (target.b - (source[i + 2] as number)) * amount;
    const alpha = source[i + 3] as number;
    out[i + 3] = alpha + (alpha * target.a - alpha) * amount;
    changed++;
  };
  const strength = (d: number): number => (d <= inner ? 1 : d < outer ? 1 - (d - inner) / (outer - inner) : 0);
  for (let i = 0; i < source.length; i += 4) {
    if (source[i + 3] === 0) continue;
    const toFrom = strength(distance(source, i, options.from));
    if (toFrom > 0) {
      blend(i, options.to, toFrom);
      continue;
    }
    if (options.swap) {
      const toTo = strength(distance(source, i, options.to));
      if (toTo > 0) blend(i, { ...options.from, a: 1 }, toTo);
    }
  }
  return { pixels: out, changed };
}

/* ------------------------------------------------------------------- fade -- */

export interface FadeOptions {
  readonly kind: 'solid' | 'linear' | 'radial';
  /** 0-100: opacity kept at the start of the fade (and everywhere, for `solid`). */
  readonly from: number;
  /** 0-100: opacity kept at the end of the fade. */
  readonly to: number;
  /** Degrees, CSS convention (0 = towards the top), for `linear`. */
  readonly angle: number;
  /** 0-100: centre of a radial fade, as a percentage of the image. */
  readonly centerX: number;
  readonly centerY: number;
  /** 0-100: where the fade begins and ends along its length. */
  readonly start: number;
  readonly end: number;
}

/** Multiplies the alpha channel by a constant or by a gradient. */
export function fadeAlpha(source: Pixels, width: number, height: number, options: FadeOptions): Pixels {
  const out = new Uint8ClampedArray(source);
  const from = options.from / 100;
  const to = options.to / 100;
  const begin = Math.min(options.start, options.end) / 100;
  const finish = Math.max(options.start, options.end) / 100;
  const span = Math.max(1e-6, finish - begin);
  const ramp = (t: number): number => {
    const k = t <= begin ? 0 : t >= finish ? 1 : (t - begin) / span;
    return from + (to - from) * k;
  };
  if (options.kind === 'solid') {
    for (let i = 3; i < out.length; i += 4) out[i] = (source[i] as number) * from;
    return out;
  }
  const angle = (options.angle * Math.PI) / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2 || 1;
  const cx = options.kind === 'radial' ? (options.centerX / 100) * width : width / 2;
  const cy = options.kind === 'radial' ? (options.centerY / 100) * height : height / 2;
  const reach = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) || 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const t = options.kind === 'radial' ? Math.hypot(px, py) / reach : ((px * dx + py * dy) / half + 1) / 2;
      const i = (y * width + x) * 4 + 3;
      out[i] = (source[i] as number) * ramp(t);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- palette -- */

export interface PaletteColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Share of the sampled pixels, 0-1. */
  readonly share: number;
}

/** Extracts dominant colours with median-cut quantisation. */
export function extractPalette(source: Pixels, count: number, maxSamples = 40000): PaletteColor[] {
  const total = source.length / 4;
  const stride = Math.max(1, Math.floor(total / maxSamples));
  const samples: number[] = [];
  for (let p = 0; p < total; p += stride) {
    const i = p * 4;
    if ((source[i + 3] as number) < 128) continue;
    samples.push(((source[i] as number) << 16) | ((source[i + 1] as number) << 8) | (source[i + 2] as number));
  }
  if (samples.length === 0) return [];
  type Box = number[];
  const boxes: Box[] = [samples];
  const range = (box: Box): { channel: number; size: number } => {
    let best = { channel: 0, size: -1 };
    for (let channel = 0; channel < 3; channel++) {
      const shift = 16 - channel * 8;
      let min = 255;
      let max = 0;
      for (const value of box) {
        const c = (value >> shift) & 255;
        if (c < min) min = c;
        if (c > max) max = c;
      }
      if (max - min > best.size) best = { channel, size: max - min };
    }
    return best;
  };
  while (boxes.length < count) {
    // Split the box with the widest colour spread, weighted by how many pixels it holds.
    let pick = -1;
    let score = 0;
    let pickRange = { channel: 0, size: 0 };
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      const r = range(box);
      const weight = r.size * Math.sqrt(box.length);
      if (weight > score) {
        score = weight;
        pick = index;
        pickRange = r;
      }
    });
    if (pick < 0 || pickRange.size === 0) break;
    const shift = 16 - pickRange.channel * 8;
    const box = (boxes[pick] as Box).sort((a, b) => ((a >> shift) & 255) - ((b >> shift) & 255));
    // Split near the median, but never between two pixels with the same value on this channel.
    const channelOf = (index: number) => ((box[index] as number) >> shift) & 255;
    let middle = box.length >> 1;
    let low = middle;
    let high = middle;
    while (low > 0 && channelOf(low - 1) === channelOf(low)) low--;
    while (high < box.length && channelOf(high - 1) === channelOf(high)) high++;
    middle = low > 0 && (middle - low <= high - middle || high >= box.length) ? low : high;
    if (middle <= 0 || middle >= box.length) break;
    boxes.splice(pick, 1, box.slice(0, middle), box.slice(middle));
  }
  const averaged = boxes
    .map((box) => {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const value of box) {
        r += (value >> 16) & 255;
        g += (value >> 8) & 255;
        b += value & 255;
      }
      return { r: Math.round(r / box.length), g: Math.round(g / box.length), b: Math.round(b / box.length), share: box.length / samples.length };
    })
    .sort((a, b) => b.share - a.share);
  // Merge near-identical colours so the palette shows distinct swatches.
  const merged: PaletteColor[] = [];
  for (const colour of averaged) {
    const twin = merged.findIndex((other) => Math.abs(other.r - colour.r) + Math.abs(other.g - colour.g) + Math.abs(other.b - colour.b) < 12);
    if (twin >= 0) {
      const other = merged[twin] as PaletteColor;
      merged[twin] = { ...other, share: other.share + colour.share };
    } else merged.push(colour);
  }
  return merged.sort((a, b) => b.share - a.share);
}
