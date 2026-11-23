/**
 * The icon files each mobile platform asks for, and the text files that go
 * with them.  Sizes follow the Android, Apple, KaiOS and web manifest guides.
 */

export interface DensityBucket {
  readonly name: string;
  readonly scale: number;
}

/** Android density buckets (1 dp = scale px). */
export const ANDROID_DENSITIES: readonly DensityBucket[] = [
  { name: 'mdpi', scale: 1 },
  { name: 'hdpi', scale: 1.5 },
  { name: 'xhdpi', scale: 2 },
  { name: 'xxhdpi', scale: 3 },
  { name: 'xxxhdpi', scale: 4 },
];

/** Legacy launcher icons are 48 dp; adaptive icon layers are 108 dp with a 66 dp safe zone. */
export const LEGACY_DP = 48;
export const ADAPTIVE_DP = 108;
export const SAFE_ZONE_DP = 66;
/** Status-bar (notification) icons are 24 dp, drawn inside a 20 dp live area. */
export const NOTIFICATION_DP = 24;

export const androidPx = (dp: number, bucket: DensityBucket) => Math.round(dp * bucket.scale);

/** KaiOS: 56 and 112 for the KaiStore and launcher, 84 for the JioStore. */
export const KAIOS_SIZES = [56, 84, 112] as const;

/** Web app manifest and Apple touch icons. */
export const WEB_SIZES = [192, 512] as const;
export const APPLE_TOUCH = 180;

export const IOS_SIZE = 1024;
export const PLAY_STORE_SIZE = 512;

/** An Android resource name: lower case letters, digits and underscores, starting with a letter. */
export function resourceName(text: string, fallback = 'ic_launcher'): string {
  const name = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!name) return fallback;
  return /^[a-z]/.test(name) ? name : `ic_${name}`;
}

export function adaptiveIconXml(name: string, background: 'color' | 'mipmap'): string {
  const bg = background === 'color' ? `@color/${name}_background` : `@mipmap/${name}_background`;
  return `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="${bg}" />
    <foreground android:drawable="@mipmap/${name}_foreground" />
    <monochrome android:drawable="@mipmap/${name}_monochrome" />
</adaptive-icon>
`;
}

export function backgroundColorXml(name: string, hex: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="${name}_background">${hex.toUpperCase()}</color>
</resources>
`;
}

/** Xcode 16 single-size app icon with dark and tinted appearances. */
export function iosContentsJson(file: string, dark: string | null, tinted: string | null): string {
  const images: Record<string, unknown>[] = [{ filename: file, idiom: 'universal', platform: 'ios', size: '1024x1024' }];
  if (dark) images.push({ appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: dark, idiom: 'universal', platform: 'ios', size: '1024x1024' });
  if (tinted) images.push({ appearances: [{ appearance: 'luminosity', value: 'tinted' }], filename: tinted, idiom: 'universal', platform: 'ios', size: '1024x1024' });
  return `${JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2)}\n`;
}

export function webManifestIcons(prefix: string): string {
  const icons = [
    { src: `${prefix}icon-192.png`, sizes: '192x192', type: 'image/png' },
    { src: `${prefix}icon-512.png`, sizes: '512x512', type: 'image/png' },
    { src: `${prefix}icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  return `${JSON.stringify({ icons }, null, 2)}\n`;
}

export function kaiosIconsJson(): string {
  return `${JSON.stringify({ icons: { 56: '/icons/icon-56.png', 112: '/icons/icon-112.png' } }, null, 2)}\n`;
}
