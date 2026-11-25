/**
 * Fonts for sketches: Kalam for the hand-drawn look (it has Devanagari too),
 * Barlow for clean lines.  Text is measured with the real font, and exported
 * pictures carry the font files inside them so they look the same anywhere.
 */
import '@fontsource/kalam/400.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-ext-400.css';
import barlowLatin from '@fontsource/barlow/files/barlow-latin-400-normal.woff2?url';
import barlowLatinExt from '@fontsource/barlow/files/barlow-latin-ext-400-normal.woff2?url';
import kalamDevanagari from '@fontsource/kalam/files/kalam-devanagari-400-normal.woff2?url';
import kalamLatin from '@fontsource/kalam/files/kalam-latin-400-normal.woff2?url';
import kalamLatinExt from '@fontsource/kalam/files/kalam-latin-ext-400-normal.woff2?url';
import { estimate, type Measure, type Scene, sceneText } from './sketch-model';
import { CLEAN_FONT, HAND_FONT } from './sketch-render';

/** Waits until both sketch fonts can draw text (they load on first use). */
export async function loadSketchFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.allSettled([document.fonts.load('20px Kalam', 'Aa'), document.fonts.load('20px Kalam', 'अ'), document.fonts.load('20px Barlow', 'Aa')]);
}

/** Measures text with the sketch fonts, remembering what it has measured. */
export function canvasMeasure(): Measure {
  const context = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!context) return estimate;
  const known = new Map<string, number>();
  return (text, font, hand) => {
    const key = `${hand ? 'h' : 'c'}${font}|${text}`;
    let width = known.get(key);
    if (width === undefined) {
      context.font = `${font}px ${hand ? HAND_FONT : CLEAN_FONT}`;
      width = context.measureText(text).width;
      if (known.size > 20_000) known.clear();
      known.set(key, width);
    }
    return width;
  };
}

const LATIN_EXT = /[Ā-˿Ḁ-ỿⱠ-Ɀ꜠-ꟿ]/;
const DEVANAGARI = /[ऀ-ॿ᳐-᳿꣠-ꣿ]/;

const RANGES = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  latinExt: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  devanagari: 'U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF,U+11B00-11B09',
};

const files = new Map<string, Promise<string>>();

function dataUrl(url: string): Promise<string> {
  let pending = files.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not read a font (${r.status}).`);
        return r.arrayBuffer();
      })
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return `data:font/woff2;base64,${btoa(binary)}`;
      });
    pending.catch(() => files.delete(url));
    files.set(url, pending);
  }
  return pending;
}

/** @font-face rules, with the font files inside, for the text the scenes use. */
export async function sketchFontCss(scenes: readonly Scene[]): Promise<string> {
  const wanted: [family: string, url: string, range: string][] = [];
  const hand = scenes
    .filter((s) => s.hand)
    .map(sceneText)
    .join('\n');
  const clean = scenes
    .filter((s) => !s.hand)
    .map(sceneText)
    .join('\n');
  if (hand) {
    wanted.push(['Kalam', kalamLatin, RANGES.latin]);
    if (LATIN_EXT.test(hand)) wanted.push(['Kalam', kalamLatinExt, RANGES.latinExt]);
    if (DEVANAGARI.test(hand)) wanted.push(['Kalam', kalamDevanagari, RANGES.devanagari]);
  }
  if (clean) {
    wanted.push(['Barlow', barlowLatin, RANGES.latin]);
    if (LATIN_EXT.test(clean)) wanted.push(['Barlow', barlowLatinExt, RANGES.latinExt]);
  }
  const rules = await Promise.all(
    wanted.map(async ([family, url, range]) => `@font-face{font-family:'${family}';font-weight:400;font-style:normal;src:url(${await dataUrl(url)}) format('woff2');unicode-range:${range};}`),
  );
  return rules.join('\n');
}
