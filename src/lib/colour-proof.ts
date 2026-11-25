/**
 * Colour for print: turning screen colours into the four inks of a press with
 * an ICC profile, and showing on screen what the press will make of them (a
 * soft proof).  The arithmetic is Little CMS's (lcms-wasm); this module holds
 * the profiles and transforms, and the plain sums on pixels: ink totals,
 * plates, and which colours the press cannot reach.
 */
import {
  BYTES_SH,
  CHANNELS_SH,
  COLORSPACE_SH,
  cmsFLAGS_BLACKPOINTCOMPENSATION,
  cmsFLAGS_HIGHRESPRECALC,
  cmsInfoCopyright,
  cmsInfoDescription,
  INTENT_ABSOLUTE_COLORIMETRIC,
  INTENT_PERCEPTUAL,
  INTENT_RELATIVE_COLORIMETRIC,
  INTENT_SATURATION,
  instantiate,
  type Lcms,
  PT_Lab,
  TYPE_CMYK_8,
  TYPE_RGB_8,
} from 'lcms-wasm';

export type Intent = 'perceptual' | 'relative' | 'saturation' | 'absolute';

export const INTENT_NAMES: Record<Intent, string> = {
  perceptual: 'Perceptual',
  relative: 'Relative colorimetric',
  saturation: 'Saturation',
  absolute: 'Absolute colorimetric',
};

const INTENTS: Record<Intent, number> = {
  perceptual: INTENT_PERCEPTUAL,
  relative: INTENT_RELATIVE_COLORIMETRIC,
  saturation: INTENT_SATURATION,
  absolute: INTENT_ABSOLUTE_COLORIMETRIC,
};

/**
 * L*a*b* as 16-bit numbers, which the library works out four times as fast as floating point
 * (and, with its finer table, to within a fifth of a unit of it).  Its "double" format does not
 * survive the trip from WebAssembly.
 */
const TYPE_LAB_16 = COLORSPACE_SH(PT_Lab) | CHANNELS_SH(3) | BYTES_SH(2);

/** The 16-bit encoding as plain L*a*b*: lightness 0 to 100, a and b about -128 to 128. */
function labFrom16(raw: Uint16Array): Float32Array {
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    out[i] = ((raw[i] as number) * 100) / 65535;
    out[i + 1] = (raw[i + 1] as number) / 257 - 128;
    out[i + 2] = (raw[i + 2] as number) / 257 - 128;
  }
  return out;
}

export interface ProfileInfo {
  readonly name: string;
  readonly copyright: string;
  /** "CMYK", "RGB", "GRAY" and so on. */
  readonly space: string;
  /** printer ("prtr"), display ("mntr"), scanner ("scnr"), or another class. */
  readonly kind: string;
  /** The profile holds tables from colour to inks: it can be printed to, not only read from. */
  readonly output: boolean;
  readonly version: string;
  readonly size: number;
}

const tag = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
const long = (bytes: Uint8Array, offset: number) => (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0;

/**
 * What a profile file says about itself, read from its header and its list of tags
 * (no colour engine needed).  Throws when the file is not an ICC profile.
 */
export function readProfileHeader(bytes: Uint8Array): Pick<ProfileInfo, 'space' | 'kind' | 'output' | 'version' | 'size'> {
  if (bytes.length < 132 || tag(bytes, 36) !== 'acsp') throw new Error('This is not an ICC profile.');
  const size = long(bytes, 0);
  if (size > bytes.length) throw new Error('This profile is cut short: part of the file is missing.');
  const count = long(bytes, 128);
  if (count > 1000 || 132 + count * 12 > bytes.length) throw new Error('This profile is damaged.');
  const tags = new Set<string>();
  for (let i = 0; i < count; i++) tags.add(tag(bytes, 132 + i * 12));
  return {
    space: tag(bytes, 16).trim(),
    kind: tag(bytes, 12),
    // From colour to device: a table for one of the intents (B2A), which printer profiles carry.
    output: tags.has('B2A0') || tags.has('B2A1') || tags.has('B2A2'),
    version: `${bytes[8] ?? 0}.${(bytes[9] ?? 0) >> 4}`,
    size,
  };
}

export interface Proofer {
  readonly info: ProfileInfo;
  /** Screen colours (sRGB, three bytes a pixel) to inks (four bytes a pixel: cyan, magenta, yellow, black; 255 is solid). */
  separate(rgb: Uint8Array): Uint8Array;
  /**
   * The inks that print nearest each screen colour, whatever intent was chosen (relative colorimetric,
   * shadows not rescaled).  A colour whose nearest print is still far from it is one the press cannot reach.
   */
  nearest(rgb: Uint8Array): Uint8Array;
  /** Inks to the screen colours nearest what they print; with `paper`, the paper's own tint shows too. */
  show(cmyk: Uint8Array, paper?: boolean): Uint8Array;
  /** L*a*b* of screen colours, and of printed inks: three floats a pixel. */
  labOfScreen(rgb: Uint8Array): Float32Array;
  labOfPrint(cmyk: Uint8Array): Float32Array;
  close(): void;
}

export interface ColourEngine {
  /** Makes what is needed to separate to, and to proof, one profile with one intent. */
  proofer(profile: Uint8Array, intent: Intent, blackPoint: boolean): Proofer;
  describe(profile: Uint8Array): ProfileInfo;
}

/**
 * Starts the colour engine.  `locate` gives the address of the engine's WebAssembly file
 * where a bundler has moved it; without it the file beside the library is used (Node).
 */
export async function colourEngine(locate?: string): Promise<ColourEngine> {
  const lcms: Lcms = await instantiate(locate ? { locateFile: () => locate } : undefined);
  const open = (bytes: Uint8Array): number => {
    readProfileHeader(bytes);
    const handle = lcms.cmsOpenProfileFromMem(bytes, bytes.byteLength);
    if (!handle) throw new Error('The colour engine could not read this profile.');
    return handle;
  };
  const infoOf = (bytes: Uint8Array, handle: number): ProfileInfo => ({
    ...readProfileHeader(bytes),
    name: lcms.cmsGetProfileInfoASCII(handle, cmsInfoDescription, 'en', 'US').trim() || 'Unnamed profile',
    copyright: lcms.cmsGetProfileInfoASCII(handle, cmsInfoCopyright, 'en', 'US').trim(),
  });
  const transform = (from: number, fromType: number, to: number, toType: number, intent: number, flags: number, what: string): number => {
    const made = lcms.cmsCreateTransform(from, fromType, to, toType, intent, flags);
    if (!made) throw new Error(`This profile cannot be used ${what}.`);
    return made;
  };
  return {
    describe(bytes) {
      const handle = open(bytes);
      try {
        return infoOf(bytes, handle);
      } finally {
        lcms.cmsCloseProfile(handle);
      }
    },
    proofer(bytes, intent, blackPoint) {
      const press = open(bytes);
      const info = infoOf(bytes, press);
      if (info.space !== 'CMYK') {
        lcms.cmsCloseProfile(press);
        throw new Error(`This profile is for ${info.space} colours, not CMYK; choose a CMYK profile for a press or a printer.`);
      }
      if (!info.output) {
        lcms.cmsCloseProfile(press);
        throw new Error('This CMYK profile can only be read from (it says what inks look like), not printed to: it lacks the tables from colour to inks.');
      }
      const screen = lcms.cmsCreate_sRGBProfile();
      const lab = lcms.cmsCreateLab4Profile(null);
      const made: number[] = [];
      const make = (...args: Parameters<typeof transform>) => {
        const one = transform(...args);
        made.push(one);
        return one;
      };
      // Black point compensation belongs to relative colorimetric; the other intents carry their own handling of black.
      const flags = blackPoint && intent === 'relative' ? cmsFLAGS_BLACKPOINTCOMPENSATION : 0;
      try {
        const toInk = make(screen, TYPE_RGB_8, press, TYPE_CMYK_8, INTENTS[intent], flags, 'to print to');
        const toNearest = intent === 'relative' && flags === 0 ? toInk : make(screen, TYPE_RGB_8, press, TYPE_CMYK_8, INTENT_RELATIVE_COLORIMETRIC, 0, 'to print to');
        // On screen: the print's colours as they are, with white as the screen's white ...
        const toScreen = make(press, TYPE_CMYK_8, screen, TYPE_RGB_8, INTENT_RELATIVE_COLORIMETRIC, 0, 'to show its print on screen');
        // ... or with the paper's own colour as well.
        const toScreenOnPaper = make(press, TYPE_CMYK_8, screen, TYPE_RGB_8, INTENT_ABSOLUTE_COLORIMETRIC, 0, 'to show its print on screen');
        const screenLab = make(screen, TYPE_RGB_8, lab, TYPE_LAB_16, INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_HIGHRESPRECALC, 'to measure colours');
        const printLab = make(press, TYPE_CMYK_8, lab, TYPE_LAB_16, INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_HIGHRESPRECALC, 'to measure its print');
        return {
          info,
          separate: (rgb) => lcms.cmsDoTransform(toInk, rgb, rgb.length / 3) as Uint8Array,
          nearest: (rgb) => lcms.cmsDoTransform(toNearest, rgb, rgb.length / 3) as Uint8Array,
          show: (cmyk, paper = false) => lcms.cmsDoTransform(paper ? toScreenOnPaper : toScreen, cmyk, cmyk.length / 4) as Uint8Array,
          labOfScreen: (rgb) => labFrom16(lcms.cmsDoTransform(screenLab, rgb, rgb.length / 3) as Uint16Array),
          labOfPrint: (cmyk) => labFrom16(lcms.cmsDoTransform(printLab, cmyk, cmyk.length / 4) as Uint16Array),
          close() {
            for (const one of made) lcms.cmsDeleteTransform(one);
            for (const profile of [press, screen, lab]) lcms.cmsCloseProfile(profile);
          },
        };
      } catch (error) {
        for (const one of made) lcms.cmsDeleteTransform(one);
        for (const profile of [press, screen, lab]) lcms.cmsCloseProfile(profile);
        throw error;
      }
    },
  };
}

/* ----------------------------------------------------- pixels -- */

/** A picture as a canvas gives it (RGBA) as plain RGB on white paper: what is see-through shows the paper. */
export function onWhite(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
    const alpha = (rgba[i + 3] as number) / 255;
    out[o] = Math.round((rgba[i] as number) * alpha + 255 * (1 - alpha));
    out[o + 1] = Math.round((rgba[i + 1] as number) * alpha + 255 * (1 - alpha));
    out[o + 2] = Math.round((rgba[i + 2] as number) * alpha + 255 * (1 - alpha));
  }
  return out;
}

/** RGB to the RGBA a canvas takes. */
export function toRgba(rgb: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray((rgb.length / 3) * 4);
  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
    out[o] = rgb[i] as number;
    out[o + 1] = rgb[i + 1] as number;
    out[o + 2] = rgb[i + 2] as number;
    out[o + 3] = 255;
  }
  return out;
}

/**
 * A long run of pixels through a transform in pieces, with a pause between them so that the
 * page stays alive and `onProgress` can say how far it has got (0 to 1).
 */
export async function inPieces(
  input: Uint8Array,
  perPixelIn: number,
  perPixelOut: number,
  transform: (piece: Uint8Array) => Uint8Array,
  onProgress?: (done: number) => void,
  piece = 262_144,
): Promise<Uint8Array> {
  const pixels = input.length / perPixelIn;
  const out = new Uint8Array(pixels * perPixelOut);
  for (let at = 0; at < pixels; at += piece) {
    const end = Math.min(pixels, at + piece);
    out.set(transform(input.subarray(at * perPixelIn, end * perPixelIn)), at * perPixelOut);
    onProgress?.(end / pixels);
    if (end < pixels) await new Promise((done) => setTimeout(done, 0));
  }
  return out;
}

export interface InkStats {
  /** The most ink at any pixel, in per cent of one solid (400 is all four solid). */
  readonly most: number;
  /** The share of pixels above the limit, 0 to 1. */
  readonly over: number;
  /** Mean coverage of each ink over the picture, in per cent: what the job will use of each. */
  readonly mean: readonly [number, number, number, number];
  readonly meanTotal: number;
}

export function inkStats(cmyk: Uint8Array, limit = 300): InkStats {
  const sums = [0, 0, 0, 0];
  let most = 0;
  let over = 0;
  const threshold = (limit / 100) * 255;
  const pixels = cmyk.length / 4;
  for (let i = 0; i < cmyk.length; i += 4) {
    const c = cmyk[i] as number;
    const m = cmyk[i + 1] as number;
    const y = cmyk[i + 2] as number;
    const k = cmyk[i + 3] as number;
    sums[0] = (sums[0] as number) + c;
    sums[1] = (sums[1] as number) + m;
    sums[2] = (sums[2] as number) + y;
    sums[3] = (sums[3] as number) + k;
    const total = c + m + y + k;
    if (total > most) most = total;
    // (Half a step of rounding in each of four inks is not "over".)
    if (total > threshold + 2) over++;
  }
  const mean = sums.map((sum) => (pixels ? sum / pixels / 2.55 : 0)) as [number, number, number, number];
  return { most: most / 2.55, over: pixels ? over / pixels : 0, mean, meanTotal: mean[0] + mean[1] + mean[2] + mean[3] };
}

/** One ink as its plate: dark where there is ink, as a canvas's RGBA. */
export function plateOf(cmyk: Uint8Array, ink: 0 | 1 | 2 | 3): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cmyk.length);
  for (let i = 0; i < cmyk.length; i += 4) {
    const grey = 255 - (cmyk[i + ink] as number);
    out[i] = grey;
    out[i + 1] = grey;
    out[i + 2] = grey;
    out[i + 3] = 255;
  }
  return out;
}

/**
 * Total ink as a picture: paper white where there is none, through one hue getting darker to
 * the limit, and a second hue above it, so that "too much" is not a matter of telling shades apart.
 */
export function coverageMap(cmyk: Uint8Array, limit = 300): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cmyk.length);
  const full = (limit / 100) * 255;
  for (let i = 0; i < cmyk.length; i += 4) {
    const total = (cmyk[i] as number) + (cmyk[i + 1] as number) + (cmyk[i + 2] as number) + (cmyk[i + 3] as number);
    if (total > full + 2) {
      // Over the limit: a strong red.
      out[i] = 208;
      out[i + 1] = 59;
      out[i + 2] = 59;
    } else {
      // Within it: white to a deep blue.
      const t = Math.min(1, total / full);
      out[i] = Math.round(255 - t * (255 - 13));
      out[i + 1] = Math.round(255 - t * (255 - 54));
      out[i + 2] = Math.round(255 - t * (255 - 107));
    }
    out[i + 3] = 255;
  }
  return out;
}

export interface GamutCheck {
  /** How far each pixel's print is from its screen colour (ΔE, 1976). */
  readonly distance: Float32Array;
  readonly mean: number;
  readonly worst: number;
  /** The share of pixels further off than the tolerance, 0 to 1. */
  readonly outside: number;
}

/** Compares what was asked for with what prints, both as L*a*b*. */
export function gamutCheck(asked: Float32Array, printed: Float32Array, tolerance = 3): GamutCheck {
  const pixels = asked.length / 3;
  const distance = new Float32Array(pixels);
  let sum = 0;
  let worst = 0;
  let outside = 0;
  for (let p = 0, i = 0; p < pixels; p++, i += 3) {
    const d = Math.hypot((asked[i] as number) - (printed[i] as number), (asked[i + 1] as number) - (printed[i + 1] as number), (asked[i + 2] as number) - (printed[i + 2] as number));
    distance[p] = d;
    sum += d;
    if (d > worst) worst = d;
    if (d > tolerance) outside++;
  }
  return { distance, mean: pixels ? sum / pixels : 0, worst, outside: pixels ? outside / pixels : 0 };
}

/** The share of distances over a tolerance, 0 to 1. */
export function shareOver(distance: Float32Array, tolerance: number): number {
  let over = 0;
  for (let p = 0; p < distance.length; p++) if ((distance[p] as number) > tolerance) over++;
  return distance.length ? over / distance.length : 0;
}

/** The proof with the colours the press cannot reach painted over, as a canvas's RGBA. */
export function markOutside(proofRgb: Uint8Array, distance: Float32Array, tolerance = 3): Uint8ClampedArray {
  const out = toRgba(proofRgb);
  for (let p = 0, o = 0; p < distance.length; p++, o += 4) {
    if ((distance[p] as number) > tolerance) {
      // A magenta that is rare in pictures, mixed with the picture so that its shapes still show.
      out[o] = Math.round((out[o] as number) * 0.25 + 255 * 0.75);
      out[o + 1] = Math.round((out[o + 1] as number) * 0.25);
      out[o + 2] = Math.round((out[o + 2] as number) * 0.25 + 200 * 0.75);
    }
  }
  return out;
}
