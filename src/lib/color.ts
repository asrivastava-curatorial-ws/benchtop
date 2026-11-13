/**
 * Colour helpers built on culori: parsing any CSS colour, conversion between
 * spaces, gamut checks, WCAG contrast and perceptual distance.
 */
import { clampChroma, converter, differenceEuclidean, displayable, formatHex, formatHex8, inGamut, interpolateWithPremultipliedAlpha, parse, wcagContrast } from 'culori';

// biome-ignore lint/suspicious/noExplicitAny: culori colour objects are loosely typed
type AnyColor = any;

type Convert = (color: AnyColor) => AnyColor;
const convertTo = (mode: string): Convert => converter(mode as never) as unknown as Convert;

const toRgb = convertTo('rgb');
const toHsl = convertTo('hsl');
const toHwb = convertTo('hwb');
const toOklch = convertTo('oklch');
const toOklab = convertTo('oklab');
const toLab = convertTo('lab');
const toLch = convertTo('lch');
const toP3 = convertTo('p3');
const hex = formatHex as (color: AnyColor) => string;
const hex8 = formatHex8 as (color: AnyColor) => string;
const inP3 = inGamut('p3');
const oklabDistance = differenceEuclidean('oklab');

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Oklch {
  l: number;
  c: number;
  h: number;
  alpha: number;
}

export function parseColor(input: string): AnyColor | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;
  // Accept bare hex such as "3b82f6".
  const candidate = /^[0-9a-fA-F]{3,8}$/.test(trimmed) && [3, 4, 6, 8].includes(trimmed.length) ? `#${trimmed}` : trimmed;
  return parse(candidate) ?? undefined;
}

export function isColor(input: string): boolean {
  return parseColor(input) !== undefined;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** 8-bit sRGB components (out-of-gamut colours are chroma-reduced first). */
export function toRgba(input: string, fallback: Rgba = { r: 0, g: 0, b: 0, a: 1 }): Rgba {
  const color = parseColor(input);
  if (!color) return fallback;
  const rgb = toRgb(displayable(color) ? color : clampChroma(color, 'oklch'));
  return {
    r: Math.round(clamp01(rgb.r) * 255),
    g: Math.round(clamp01(rgb.g) * 255),
    b: Math.round(clamp01(rgb.b) * 255),
    a: clamp01(color.alpha ?? 1),
  };
}

export function alphaOf(input: string): number {
  return clamp01(parseColor(input)?.alpha ?? 1);
}

const hex2 = (value: number): string => value.toString(16).padStart(2, '0');

export function rgbaToHex(color: Rgba, withAlpha = color.a < 1): string {
  const base = `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
  return withAlpha ? base + hex2(Math.round(color.a * 255)) : base;
}

/** `#rrggbb`, ignoring alpha. */
export function hexOf(input: string, fallback = '#000000'): string {
  const color = parseColor(input);
  return color ? rgbaToHex({ ...toRgba(input), a: 1 }) : fallback;
}

/** Returns the colour with a new alpha as `#rrggbb` or `#rrggbbaa`. */
export function withAlpha(input: string, alpha: number): string {
  return rgbaToHex({ ...toRgba(input), a: clamp01(alpha) });
}

export function trimNumber(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** Compact CSS for generated code: hex when opaque, `rgb(r g b / a)` otherwise. */
export function cssColor(input: string): string {
  const color = parseColor(input);
  if (!color) return input.trim();
  const rgba = toRgba(input);
  if (rgba.a >= 1) return rgbaToHex(rgba, false);
  return `rgb(${rgba.r} ${rgba.g} ${rgba.b} / ${trimNumber(rgba.a, 3)})`;
}

/** Legacy comma syntax, for targets that predate CSS Color 4 (Canvas strings, SVG, etc.). */
export function rgbaString(input: string): string {
  const rgba = toRgba(input);
  return rgba.a >= 1 ? `rgb(${rgba.r}, ${rgba.g}, ${rgba.b})` : `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${trimNumber(rgba.a, 3)})`;
}

export function toOklchValues(input: string): Oklch | undefined {
  const color = parseColor(input);
  if (!color) return undefined;
  const value = toOklch(color);
  return { l: value.l, c: value.c ?? 0, h: value.h ?? 0, alpha: value.alpha ?? 1 };
}

export function oklchToHex(l: number, c: number, h: number): string {
  return hex(clampChroma({ mode: 'oklch', l: clamp01(l), c: Math.max(0, c), h }, 'oklch'));
}

const alphaSuffix = (alpha: number | undefined): string => (alpha !== undefined && alpha < 1 ? ` / ${trimNumber(alpha, 3)}` : '');

export function formatOklch(color: AnyColor): string {
  const value = toOklch(color);
  return `oklch(${trimNumber(value.l * 100, 2)}% ${trimNumber(value.c ?? 0, 4)} ${trimNumber(value.h ?? 0, 2)}${alphaSuffix(value.alpha)})`;
}

export interface ColorFormats {
  readonly hex: string;
  readonly rgb: string;
  readonly hsl: string;
  readonly hwb: string;
  readonly oklch: string;
  readonly oklab: string;
  readonly lab: string;
  readonly lch: string;
  readonly p3: string;
  /** Inside the sRGB gamut (the hex value is exact, not an approximation). */
  readonly inSrgb: boolean;
  readonly inP3: boolean;
  readonly alpha: number;
}

/** Every common notation for a colour, using modern space-separated CSS syntax. */
export function describeColor(input: string): ColorFormats | undefined {
  const color = parseColor(input);
  if (!color) return undefined;
  const fits = displayable(color);
  const srgb = fits ? color : clampChroma(color, 'oklch');
  const rgb = toRgb(srgb);
  const hsl = toHsl(srgb);
  const hwb = toHwb(srgb);
  const oklab = toOklab(color);
  const lab = toLab(color);
  const lch = toLch(color);
  const p3 = toP3(color);
  const alpha = clamp01(color.alpha ?? 1);
  const a = alphaSuffix(alpha);
  const channel = (value: number) => Math.round(clamp01(value) * 255);
  return {
    hex: alpha < 1 ? hex8(srgb) : hex(srgb),
    rgb: `rgb(${channel(rgb.r)} ${channel(rgb.g)} ${channel(rgb.b)}${a})`,
    hsl: `hsl(${trimNumber(hsl.h ?? 0, 1)} ${trimNumber((hsl.s ?? 0) * 100, 1)}% ${trimNumber(hsl.l * 100, 1)}%${a})`,
    hwb: `hwb(${trimNumber(hwb.h ?? 0, 1)} ${trimNumber(hwb.w * 100, 1)}% ${trimNumber(hwb.b * 100, 1)}%${a})`,
    oklch: formatOklch(color),
    oklab: `oklab(${trimNumber(oklab.l * 100, 2)}% ${trimNumber(oklab.a, 4)} ${trimNumber(oklab.b, 4)}${a})`,
    lab: `lab(${trimNumber(lab.l, 2)}% ${trimNumber(lab.a, 2)} ${trimNumber(lab.b, 2)}${a})`,
    lch: `lch(${trimNumber(lch.l, 2)}% ${trimNumber(lch.c, 2)} ${trimNumber(lch.h ?? 0, 2)}${a})`,
    p3: `color(display-p3 ${trimNumber(p3.r, 4)} ${trimNumber(p3.g, 4)} ${trimNumber(p3.b, 4)}${a})`,
    inSrgb: fits,
    inP3: inP3(color),
    alpha,
  };
}

/** WCAG 2.x contrast ratio (1-21).  Alpha is ignored: composite first if needed. */
export function contrastRatio(a: string, b: string): number {
  const first = parseColor(a);
  const second = parseColor(b);
  if (!first || !second) return 1;
  return wcagContrast(first, second);
}

/** Flattens a translucent colour over an opaque background. */
export function compositeOver(foreground: string, background: string): string {
  const fg = toRgba(foreground);
  const bg = toRgba(background, { r: 255, g: 255, b: 255, a: 1 });
  const mix = (top: number, bottom: number) => Math.round(top * fg.a + bottom * (1 - fg.a));
  return rgbaToHex({ r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 });
}

/** Perceptual distance in OKLab (0 = identical, ~1 = black vs white). */
export function colorDistance(a: string, b: string): number {
  const first = parseColor(a);
  const second = parseColor(b);
  if (!first || !second) return Number.POSITIVE_INFINITY;
  return oklabDistance(first, second);
}

/** Black or white, whichever is more legible on the given background. */
export function readableOn(background: string): string {
  return contrastRatio('#ffffff', background) >= contrastRatio('#000000', background) ? '#ffffff' : '#000000';
}

/**
 * Moves a colour's OKLCH lightness (keeping hue and chroma where the gamut
 * allows) until it reaches the target contrast against `against`.
 * Returns `undefined` when even black/white cannot reach the target.
 */
export function adjustForContrast(color: string, against: string, target: number): string | undefined {
  const start = toOklchValues(color);
  if (!start) return undefined;
  if (contrastRatio(color, against) >= target) return hexOf(color);
  let best: string | undefined;
  let bestShift = Number.POSITIVE_INFINITY;
  for (const direction of [-1, 1]) {
    let low = 0;
    let high = direction < 0 ? start.l : 1 - start.l;
    const extreme = oklchToHex(start.l + direction * high, start.c, start.h);
    if (contrastRatio(extreme, against) < target) continue;
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      const candidate = oklchToHex(start.l + direction * mid, start.c, start.h);
      if (contrastRatio(candidate, against) >= target) high = mid;
      else low = mid;
    }
    if (high < bestShift) {
      bestShift = high;
      best = oklchToHex(start.l + direction * high, start.c, start.h);
    }
  }
  return best;
}

export type MixSpace = 'srgb' | 'oklab' | 'oklch';

/**
 * The colour a CSS gradient shows at `t` between two stops: blended in the
 * given space with premultiplied alpha and the shorter hue arc, then clipped
 * to sRGB.  Used to make Canvas, SVG and PNG output match the CSS.
 */
export function gradientMix(a: string, b: string, t: number, space: MixSpace): string {
  const first = parseColor(a);
  const second = parseColor(b);
  if (!first || !second) return a;
  const mixed = interpolateWithPremultipliedAlpha([first, second], space === 'srgb' ? 'rgb' : space)(clamp01(t));
  const rgb = toRgb(mixed);
  const channel = (value: number) => Math.round(clamp01(value ?? 0) * 255);
  const alpha = clamp01(rgb.alpha ?? 1);
  return alpha >= 1 ? `rgb(${channel(rgb.r)}, ${channel(rgb.g)}, ${channel(rgb.b)})` : `rgba(${channel(rgb.r)}, ${channel(rgb.g)}, ${channel(rgb.b)}, ${trimNumber(alpha, 3)})`;
}
