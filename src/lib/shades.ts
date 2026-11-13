/**
 * Builds an eleven-step tint/shade scale (50 ... 950) from one colour.
 *
 * The scale is laid out in OKLCH, where equal lightness steps look equal,
 * the hue stays constant and chroma tapers towards the light and dark ends.
 * The step closest in lightness to the input is pinned to the exact input
 * colour, so the brand colour always appears unchanged in its own scale.
 */
import { oklchToHex, toOklchValues, trimNumber } from './color';
import { ToolError } from './errors';

export const SHADE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** Target lightness of each step for a "typical" colour. */
const LIGHTNESS = [0.975, 0.94, 0.885, 0.815, 0.725, 0.635, 0.55, 0.47, 0.395, 0.33, 0.24];
/** Relative chroma of each step: strongest in the middle, soft at the ends. */
const CHROMA = [0.12, 0.25, 0.45, 0.68, 0.88, 1, 0.98, 0.88, 0.75, 0.62, 0.42];

export interface Shade {
  readonly step: number;
  readonly hex: string;
  readonly l: number;
  readonly c: number;
  readonly h: number;
  /** This step is the input colour itself. */
  readonly base: boolean;
}

export function generateShades(color: string): Shade[] {
  const base = toOklchValues(color);
  if (!base) throw new ToolError(`"${color}" is not a colour. Try a hex value such as #3b82f6, or rgb(), hsl() or oklch().`);
  let anchor = 0;
  for (let i = 1; i < LIGHTNESS.length; i++) {
    if (Math.abs((LIGHTNESS[i] as number) - base.l) < Math.abs((LIGHTNESS[anchor] as number) - base.l)) anchor = i;
  }
  const shift = base.l - (LIGHTNESS[anchor] as number);
  const last = LIGHTNESS.length - 1;
  return SHADE_STEPS.map((step, index) => {
    // The lightness correction fades out linearly towards both ends of the scale.
    const weight = index === anchor ? 1 : index < anchor ? index / Math.max(1, anchor) : (last - index) / Math.max(1, last - anchor);
    const l = Math.min(0.995, Math.max(0.05, (LIGHTNESS[index] as number) + shift * weight));
    const c = index === anchor ? base.c : Math.min(0.37, (base.c * (CHROMA[index] as number)) / (CHROMA[anchor] as number));
    const hex = index === anchor ? oklchToHex(base.l, base.c, base.h) : oklchToHex(l, c, base.h);
    return { step, hex, l: index === anchor ? base.l : l, c, h: base.h, base: index === anchor };
  });
}

export const shadeOklch = (shade: Shade): string => `oklch(${trimNumber(shade.l * 100, 1)}% ${trimNumber(shade.c, 3)} ${trimNumber(shade.h, 1)})`;
