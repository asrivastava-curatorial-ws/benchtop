/**
 * Projection geometry and brightness: throw distance, image size, lens shift,
 * screen luminance and viewing distance.  Lengths are in metres throughout.
 */

export type LengthUnit = 'm' | 'cm' | 'mm' | 'ft' | 'in';

export const METRES_PER: Record<LengthUnit, number> = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };

export const toMetres = (value: number, unit: LengthUnit): number => value * METRES_PER[unit];
export const fromMetres = (metres: number, unit: LengthUnit): number => metres / METRES_PER[unit];

/** "3.05 m (10 ft 0 in)": the length in the chosen unit, plus feet and inches or metres for the other system. */
export function formatLength(metres: number, unit: LengthUnit): string {
  const main = `${round(fromMetres(metres, unit), unit === 'mm' ? 0 : unit === 'm' || unit === 'ft' ? 2 : 1)} ${unit}`;
  if (unit === 'ft' || unit === 'in') return `${main} (${round(metres, 2)} m)`;
  return `${main} (${feetInches(metres)})`;
}

export function feetInches(metres: number): string {
  const totalInches = metres / 0.0254;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round(totalInches - feet * 12);
  if (inches === 12) {
    feet++;
    inches = 0;
  }
  return `${feet} ft ${inches} in`;
}

export const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Parses "16:9", "2.35:1", "1.78" or "4/3" into width ÷ height. */
export function parseAspect(text: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:[:/x×]\s*(\d+(?:\.\d+)?))?\s*$/i.exec(text);
  if (!match) return Number.NaN;
  const width = Number(match[1]);
  const height = match[2] === undefined ? 1 : Number(match[2]);
  return height > 0 ? width / height : Number.NaN;
}

export interface Size {
  readonly width: number;
  readonly height: number;
  readonly diagonal: number;
}

export function sizeFrom(kind: 'diagonal' | 'width' | 'height', value: number, aspect: number): Size {
  const width = kind === 'width' ? value : kind === 'height' ? value * aspect : value * (aspect / Math.hypot(aspect, 1));
  const height = width / aspect;
  return { width, height, diagonal: Math.hypot(width, height) };
}

/**
 * The full native image the projector throws when it fills `screen` (an image of
 * `screenAspect`): wider screens fill the projector's width, narrower ones its height.
 */
export function nativeImageFor(screen: Size, screenAspect: number, nativeAspect: number): Size {
  if (screenAspect >= nativeAspect) return sizeFrom('width', screen.width, nativeAspect);
  return sizeFrom('height', screen.height, nativeAspect);
}

export interface ThrowRange {
  readonly min: number;
  readonly max: number;
}

/** Distance from lens to screen for an image `width` wide: throw ratio × width. */
export const throwDistance = (width: number, ratio: ThrowRange): ThrowRange => ({ min: width * ratio.min, max: width * ratio.max });

/** Image width a lens of `ratio` makes at `distance`. */
export const imageWidthAt = (distance: number, ratio: ThrowRange): ThrowRange => ({ min: distance / ratio.max, max: distance / ratio.min });

/**
 * Where the lens centre can sit vertically, relative to the bottom of the native image.
 * `shiftUp`/`shiftDown` are the projector's lens shift in % of image height; `offset` is the
 * fixed offset for projectors without shift: the image centre's height above the lens, in % of image height.
 */
export function lensHeightRange(imageHeight: number, shiftUp: number, shiftDown: number, offset: number): ThrowRange {
  const centre = imageHeight / 2 - (offset / 100) * imageHeight;
  return { min: centre - (shiftUp / 100) * imageHeight, max: centre + (shiftDown / 100) * imageHeight };
}

/* ------------------------------------------------------------ brightness -- */

export const SQ_FT_PER_SQ_M = 10.7639;
export const NITS_PER_FL = 3.42626;

/** Screen luminance in foot-lamberts from lumens on the screen, the image area (m²) and the screen gain. */
export const footLamberts = (lumens: number, areaSquareMetres: number, gain: number): number => (lumens * gain) / (areaSquareMetres * SQ_FT_PER_SQ_M);

export interface BrightnessAdvice {
  readonly tone: 'ok' | 'warn' | 'bad';
  readonly text: string;
}

/** Plain-language advice for a luminance, by room lighting.  Targets follow SMPTE and common home-cinema practice. */
export function brightnessAdvice(fl: number, room: 'dark' | 'dim' | 'lit' | 'bright'): BrightnessAdvice {
  const targets = { dark: [14, 16, 30], dim: [20, 25, 45], lit: [30, 40, 70], bright: [45, 60, 120] } as const;
  const [low, good, high] = targets[room];
  if (fl < low) return { tone: 'bad', text: `Too dim for this room: aim for at least ${good} fL (${Math.round(good * NITS_PER_FL)} nits).` };
  if (fl < good) return { tone: 'warn', text: `Usable but dim: ${good} fL (${Math.round(good * NITS_PER_FL)} nits) or more looks better here.` };
  if (fl > high * 1.6 && room === 'dark') return { tone: 'warn', text: 'Very bright for a dark room; use eco mode or a lower-gain screen to reduce eye strain.' };
  return { tone: 'ok', text: room === 'dark' ? 'Right for a dark room (SMPTE recommends 16 fL for cinema).' : 'Bright enough for this room.' };
}

/* -------------------------------------------------------- viewing distance -- */

/** Distance at which an image `width` wide fills `angle` degrees of the horizontal field of view. */
export const distanceForAngle = (width: number, angle: number): number => width / (2 * Math.tan(((angle / 2) * Math.PI) / 180));

/** Farthest distance at which single pixels are still visible with 20/20 vision (one arcminute per pixel). */
export const pixelAcuityDistance = (imageHeight: number, verticalPixels: number): number => imageHeight / verticalPixels / Math.tan(Math.PI / 10800);

/* ------------------------------------------------------------ edge blend -- */

export interface BlendLayout {
  readonly columns: number;
  readonly rows: number;
  /** Overlap between neighbours, as a fraction of one projector's image width/height. */
  readonly overlapX: number;
  readonly overlapY: number;
  readonly pixelsX: number;
  readonly pixelsY: number;
}

export interface BlendResult {
  readonly canvasPixelsX: number;
  readonly canvasPixelsY: number;
  readonly overlapPixelsX: number;
  readonly overlapPixelsY: number;
  /** Canvas size in units of one projector image. */
  readonly widthFactor: number;
  readonly heightFactor: number;
}

/** Total canvas of a grid of projectors whose neighbours overlap for edge blending. */
export function blend(layout: BlendLayout): BlendResult {
  const overlapPixelsX = Math.round(layout.pixelsX * layout.overlapX);
  const overlapPixelsY = Math.round(layout.pixelsY * layout.overlapY);
  return {
    canvasPixelsX: layout.columns * layout.pixelsX - (layout.columns - 1) * overlapPixelsX,
    canvasPixelsY: layout.rows * layout.pixelsY - (layout.rows - 1) * overlapPixelsY,
    overlapPixelsX,
    overlapPixelsY,
    widthFactor: layout.columns - (layout.columns - 1) * layout.overlapX,
    heightFactor: layout.rows - (layout.rows - 1) * layout.overlapY,
  };
}

export const RESOLUTIONS: Record<string, readonly [number, number]> = {
  '1280x720': [1280, 720],
  '1280x800': [1280, 800],
  '1920x1080': [1920, 1080],
  '1920x1200': [1920, 1200],
  '2560x1600': [2560, 1600],
  '3840x2160': [3840, 2160],
  '4096x2160': [4096, 2160],
  '5120x3200': [5120, 3200],
};
