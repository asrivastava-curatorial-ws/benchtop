/**
 * Colour names: the 148 CSS named colours and the 949 names from the xkcd
 * colour survey (CC0, via the xkcd-colors package), with nearest-name search
 * by CIEDE2000 difference.
 */
import { colorsNamed, differenceCiede2000, formatHex, parse } from 'culori';

export interface NamedColour {
  readonly name: string;
  readonly hex: string;
  readonly list: 'css' | 'xkcd';
}

let cache: NamedColour[] | null = null;

export async function allNames(): Promise<NamedColour[]> {
  if (cache) return cache;
  const css = Object.entries(colorsNamed as Record<string, number>).map(([name, value]) => ({ name, hex: `#${value.toString(16).padStart(6, '0')}`, list: 'css' as const }));
  const mod = (await import('xkcd-colors')) as unknown as { colors?: { name: string; hex: string }[]; default?: { colors: { name: string; hex: string }[] } };
  const xkcd = (mod.colors ?? mod.default?.colors ?? []).map((c) => ({ name: c.name, hex: c.hex.toLowerCase(), list: 'xkcd' as const }));
  cache = [...css, ...xkcd];
  return cache;
}

const de = differenceCiede2000();

export function nearestNames(hex: string, names: readonly NamedColour[], count: number, list: 'css' | 'xkcd' | 'both'): { colour: NamedColour; delta: number }[] {
  const target = parse(hex);
  if (!target) return [];
  return names
    .filter((n) => list === 'both' || n.list === list)
    .map((colour) => ({ colour, delta: de(target, parse(colour.hex) as never) }))
    .sort((a, b) => a.delta - b.delta)
    .slice(0, count);
}

export const normaliseHex = (input: string): string | null => {
  const c = parse(input.trim());
  return c ? (formatHex(c) as string) : null;
};
