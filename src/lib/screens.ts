/**
 * Screen metrics for app and web design: pixel density, physical size, layout
 * units (Android dp, Apple points, CSS pixels) and Material window classes.
 */

export type Platform = 'android' | 'ios' | 'kaios' | 'web';

export interface Screen {
  readonly id: string;
  readonly label: string;
  readonly platform: Platform;
  /** Portrait pixels. */
  readonly width: number;
  readonly height: number;
  readonly diagonal: number;
  /** Pixels per layout unit (dp, pt or CSS px). */
  readonly scale: number;
}

/** Sizes from Apple's and Google's specifications; Android scales are the shipped default density ÷ 160. */
export const SCREENS: readonly Screen[] = [
  { id: 'iphone-promax', label: 'iPhone 17 Pro Max, 16 Pro Max', platform: 'ios', width: 1320, height: 2868, diagonal: 6.9, scale: 3 },
  { id: 'iphone-air', label: 'iPhone Air', platform: 'ios', width: 1260, height: 2736, diagonal: 6.5, scale: 3 },
  { id: 'iphone-pro', label: 'iPhone 17, 17 Pro, 16 Pro', platform: 'ios', width: 1206, height: 2622, diagonal: 6.3, scale: 3 },
  { id: 'iphone-16', label: 'iPhone 16, 15, 15 Pro, 14 Pro', platform: 'ios', width: 1179, height: 2556, diagonal: 6.1, scale: 3 },
  { id: 'iphone-plus', label: 'iPhone 16 Plus, 15 Plus, 15 Pro Max', platform: 'ios', width: 1290, height: 2796, diagonal: 6.7, scale: 3 },
  { id: 'iphone-16e', label: 'iPhone 16e, 14, 13, 12', platform: 'ios', width: 1170, height: 2532, diagonal: 6.1, scale: 3 },
  { id: 'iphone-se', label: 'iPhone SE (2nd and 3rd gen), 8', platform: 'ios', width: 750, height: 1334, diagonal: 4.7, scale: 2 },
  { id: 'ipad-pro-13', label: 'iPad Pro 13-inch (M4, M5)', platform: 'ios', width: 2064, height: 2752, diagonal: 13, scale: 2 },
  { id: 'ipad-pro-11', label: 'iPad Pro 11-inch (M4, M5)', platform: 'ios', width: 1668, height: 2420, diagonal: 11.1, scale: 2 },
  { id: 'ipad-air-11', label: 'iPad Air 11-inch, iPad (10th gen, A16)', platform: 'ios', width: 1640, height: 2360, diagonal: 10.9, scale: 2 },
  { id: 'ipad-mini', label: 'iPad mini (6th gen, A17 Pro)', platform: 'ios', width: 1488, height: 2266, diagonal: 8.3, scale: 2 },
  { id: 'pixel-9', label: 'Google Pixel 9', platform: 'android', width: 1080, height: 2424, diagonal: 6.3, scale: 2.625 },
  { id: 'pixel-8', label: 'Google Pixel 8, 7', platform: 'android', width: 1080, height: 2400, diagonal: 6.2, scale: 2.625 },
  { id: 'android-fhd', label: 'Android phone, 1080 × 2400 at xxhdpi', platform: 'android', width: 1080, height: 2400, diagonal: 6.5, scale: 3 },
  { id: 'android-hd', label: 'Android phone, 720 × 1600 at xhdpi', platform: 'android', width: 720, height: 1600, diagonal: 6.5, scale: 2 },
  { id: 'pixel-tablet', label: 'Google Pixel Tablet', platform: 'android', width: 1600, height: 2560, diagonal: 10.95, scale: 2 },
  { id: 'android-tv', label: 'Android TV, 1080p', platform: 'android', width: 1080, height: 1920, diagonal: 55, scale: 2 },
  { id: 'kaios-24', label: 'KaiOS phone, 2.4-inch (JioPhone)', platform: 'kaios', width: 240, height: 320, diagonal: 2.4, scale: 1 },
  { id: 'kaios-28', label: 'KaiOS flip phone, 2.8-inch', platform: 'kaios', width: 240, height: 320, diagonal: 2.8, scale: 1 },
  { id: 'laptop-fhd', label: 'Laptop, 15.6-inch 1080p at 125%', platform: 'web', width: 1080, height: 1920, diagonal: 15.6, scale: 1.25 },
  { id: 'monitor-4k', label: 'Monitor, 27-inch 4K at 150%', platform: 'web', width: 2160, height: 3840, diagonal: 27, scale: 1.5 },
];

export const ANDROID_BUCKETS = [
  { name: 'ldpi', dpi: 120 },
  { name: 'mdpi', dpi: 160 },
  { name: 'tvdpi', dpi: 213 },
  { name: 'hdpi', dpi: 240 },
  { name: 'xhdpi', dpi: 320 },
  { name: 'xxhdpi', dpi: 480 },
  { name: 'xxxhdpi', dpi: 640 },
] as const;

/** The bucket Android loads bitmaps from: the nearest, preferring the larger on a tie. */
export function bucketFor(dpi: number): (typeof ANDROID_BUCKETS)[number] {
  let best: (typeof ANDROID_BUCKETS)[number] = ANDROID_BUCKETS[0];
  for (const b of ANDROID_BUCKETS) if (Math.abs(b.dpi - dpi) <= Math.abs(best.dpi - dpi)) best = b;
  return best;
}

/** Common scale factors, for guessing one from pixel density. */
export const SCALES = [1, 1.5, 2, 2.625, 3, 3.5, 4] as const;

export function guessScale(ppi: number): number {
  // Phones put about 160 px/in of density into each dp step; laptops and TVs sit further away.
  const raw = ppi / 160;
  let best: number = SCALES[0];
  for (const s of SCALES) if (Math.abs(s - raw) < Math.abs(best - raw)) best = s;
  return best;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Long side to short side: 20:9, 19.5:9, 4:3. */
export function aspectRatio(width: number, height: number): string {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (!short) return '—';
  const g = gcd(Math.round(long), Math.round(short));
  const a = Math.round(long) / g;
  const b = Math.round(short) / g;
  if (a <= 32 && b <= 32) return `${a}:${b}`;
  const ninths = (long / short) * 9;
  return `${Math.round(ninths * 10) / 10}:9`;
}

export type SizeClass = 'Compact' | 'Medium' | 'Expanded' | 'Large' | 'Extra-large';

/** Material 3 window size classes. */
export function widthClass(dp: number): SizeClass {
  if (dp < 600) return 'Compact';
  if (dp < 840) return 'Medium';
  if (dp < 1200) return 'Expanded';
  if (dp < 1600) return 'Large';
  return 'Extra-large';
}

export function heightClass(dp: number): 'Compact' | 'Medium' | 'Expanded' {
  if (dp < 480) return 'Compact';
  if (dp < 900) return 'Medium';
  return 'Expanded';
}

export interface Metrics {
  readonly width: number;
  readonly height: number;
  readonly ppi: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly scale: number;
  readonly dpi: number;
  readonly layoutWidth: number;
  readonly layoutHeight: number;
  readonly smallestWidth: number;
  readonly aspect: string;
  /** Physical size of one layout unit. */
  readonly unitMm: number;
}

export function metrics(width: number, height: number, diagonal: number, scale: number): Metrics {
  if (!(width > 0 && height > 0)) throw new RangeError('Width and height must be above zero.');
  if (!(diagonal > 0)) throw new RangeError('The diagonal must be above zero.');
  if (!(scale > 0)) throw new RangeError('The scale must be above zero.');
  const ppi = Math.hypot(width, height) / diagonal;
  return {
    width,
    height,
    ppi,
    widthMm: (width / ppi) * 25.4,
    heightMm: (height / ppi) * 25.4,
    scale,
    dpi: scale * 160,
    layoutWidth: width / scale,
    layoutHeight: height / scale,
    smallestWidth: Math.min(width, height) / scale,
    aspect: aspectRatio(width, height),
    unitMm: (scale / ppi) * 25.4,
  };
}

/** A length in every unit for a screen. */
export function convertLength(value: number, unit: 'unit' | 'px' | 'mm' | 'in' | 'pt', m: Metrics): { unit: number; px: number; mm: number; in: number; pt: number } {
  const px = unit === 'px' ? value : unit === 'unit' ? value * m.scale : unit === 'mm' ? (value / 25.4) * m.ppi : unit === 'in' ? value * m.ppi : (value / 72) * m.ppi;
  return { unit: px / m.scale, px, mm: (px / m.ppi) * 25.4, in: px / m.ppi, pt: (px / m.ppi) * 72 };
}

export const UNIT_NAMES: Record<Platform, string> = { android: 'dp', ios: 'pt', kaios: 'CSS px', web: 'CSS px' };
