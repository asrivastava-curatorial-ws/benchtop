import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { type ColourEngine, colourEngine, coverageMap, gamutCheck, inkStats, inPieces, markOutside, onWhite, type Proofer, plateOf, readProfileHeader, toRgba } from '../../src/lib/colour-proof';
import { readTiff, writeTiff } from '../../src/lib/tiff';

const file = (name: string) => new Uint8Array(readFileSync(new URL(`../../public/icc/${name}`, import.meta.url)));
const PRESS = file('Benchtop-Coated-FOGRA39L.icc');
const ink = (bytes: ArrayLike<number>, at = 0) => [0, 1, 2, 3].map((d) => Math.round((bytes[at * 4 + d] as number) / 2.55));

describe('ICC profiles', () => {
  it('reads what a profile says about itself, and refuses what is not one', () => {
    expect(readProfileHeader(PRESS)).toEqual({ space: 'CMYK', kind: 'prtr', output: true, version: '2.4', size: PRESS.length });
    expect(readProfileHeader(file('sRGB-v4.icc'))).toMatchObject({ space: 'RGB', kind: 'mntr', output: false, version: '4.2' });
    // A CMYK profile that only says what inks look like.
    expect(readProfileHeader(file('CGATS001Compat-v2-micro.icc'))).toMatchObject({ space: 'CMYK', kind: 'scnr', output: false });
    expect(() => readProfileHeader(new Uint8Array(200))).toThrow(/not an ICC profile/);
    expect(() => readProfileHeader(PRESS.subarray(0, 5000))).toThrow(/cut short/);
  });
});

// Making the profile again takes about a minute, so it is asked for: BENCHTOP_PROFILE_TEST=1 pnpm test colour-proof
describe.runIf(process.env.BENCHTOP_PROFILE_TEST)('the press profile that ships with the app', () => {
  it('is exactly what scripts/make-cmyk-profile.mjs makes from the FOGRA39L data', async () => {
    const { makeProfile } = await import('../../scripts/make-cmyk-profile.mjs');
    const made = makeProfile();
    expect(made.bytes.length).toBe(PRESS.length);
    expect(Buffer.from(made.bytes).equals(Buffer.from(PRESS))).toBe(true);
  }, 600_000);
});

describe('the colour engine with the press profile that ships with the app', () => {
  let engine: ColourEngine;
  let relative: Proofer;
  let perceptual: Proofer;
  beforeAll(async () => {
    engine = await colourEngine();
    relative = engine.proofer(PRESS, 'relative', true);
    perceptual = engine.proofer(PRESS, 'perceptual', false);
  });

  it('names the profile, and says why another kind will not do', () => {
    expect(engine.describe(PRESS)).toMatchObject({ name: 'Benchtop Coated FOGRA39L (300%)', space: 'CMYK', output: true });
    expect(engine.describe(PRESS).copyright).toMatch(/CC0/);
    expect(() => engine.proofer(file('sRGB-v4.icc'), 'relative', true)).toThrow(/for RGB colours, not CMYK/);
    expect(() => engine.proofer(file('CGATS001Compat-v2-micro.icc'), 'relative', true)).toThrow(/only be read from/);
    expect(() => engine.proofer(new Uint8Array(300), 'relative', true)).toThrow(/not an ICC profile/);
  });

  it('separates screen colours into sensible inks', () => {
    const rgb = new Uint8Array([255, 255, 255, 0, 0, 0, 128, 128, 128, 255, 0, 0, 0, 0, 255, 224, 172, 150]);
    for (const proofer of [relative, perceptual]) {
      const cmyk = proofer.separate(rgb);
      expect(cmyk).toHaveLength(24);
      // White is bare paper; black is rich, with all the black ink and no more than 300 % in all.
      expect(ink(cmyk, 0)).toEqual([0, 0, 0, 0]);
      const black = ink(cmyk, 1);
      expect(black[3]).toBeGreaterThanOrEqual(95);
      expect(black.reduce((sum, v) => sum + v, 0)).toBeLessThanOrEqual(301);
      // A mid grey carries a little black and a touch more cyan than magenta and yellow, as neutral greys do.
      const grey = ink(cmyk, 2);
      expect(grey[0]).toBeGreaterThan(grey[1] as number);
      expect(Math.abs((grey[1] as number) - (grey[2] as number))).toBeLessThanOrEqual(4);
      expect(grey[3]).toBeGreaterThan(5);
      expect(grey[3]).toBeLessThan(30);
      // Red is magenta and yellow; blue is cyan with less magenta, and no black in either.
      expect(ink(cmyk, 3)[0]).toBeLessThanOrEqual(2);
      expect(ink(cmyk, 3)[1]).toBeGreaterThan(85);
      expect(ink(cmyk, 3)[2]).toBeGreaterThan(85);
      expect(ink(cmyk, 4)[0]).toBeGreaterThan(90);
      expect(ink(cmyk, 4)[2]).toBeLessThanOrEqual(3);
      // Skin has no black in it.
      expect(ink(cmyk, 5)[3]).toBe(0);
    }
  });

  it('keeps greys grey, lightness in order and ink within the limit across the whole screen gamut', () => {
    const greys = new Uint8Array(256 * 3).map((_, i) => Math.floor(i / 3));
    for (const proofer of [relative, perceptual]) {
      const lab = proofer.labOfPrint(proofer.separate(greys));
      let tint = 0;
      for (let i = 0; i < 256; i++) {
        tint = Math.max(tint, Math.hypot(lab[i * 3 + 1] as number, lab[i * 3 + 2] as number));
        if (i > 0) expect(lab[i * 3] as number, `grey ${i}`).toBeGreaterThanOrEqual((lab[(i - 1) * 3] as number) - 0.05);
      }
      expect(tint).toBeLessThan(0.8);
      const steps = 17;
      const cube = new Uint8Array(steps ** 3 * 3);
      let at = 0;
      for (let r = 0; r < steps; r++)
        for (let g = 0; g < steps; g++)
          for (let b = 0; b < steps; b++)
            cube.set(
              [r, g, b].map((v) => Math.round((v * 255) / (steps - 1))),
              at++ * 3,
            );
      const stats = inkStats(proofer.separate(cube), 300);
      expect(stats.most).toBeLessThanOrEqual(300.5);
      expect(stats.over).toBe(0);
    }
  });

  it('prints colours the press can reach as they are, and tells which it cannot', () => {
    // Soft colours come back the same; a screen's pure green and blue are beyond any press.
    const rgb = new Uint8Array([200, 180, 160, 120, 140, 110, 90, 100, 130, 0, 255, 0, 0, 0, 255]);
    const cmyk = relative.separate(rgb);
    const check = gamutCheck(relative.labOfScreen(rgb), relative.labOfPrint(cmyk), 3);
    expect([...check.distance].slice(0, 3).every((d) => d < 2.5)).toBe(true);
    expect(check.distance[3]).toBeGreaterThan(30);
    expect(check.distance[4]).toBeGreaterThan(30);
    expect(check.outside).toBeCloseTo(0.4);
    expect(check.worst).toBeGreaterThan(check.mean);
    // The proof on screen: near the original where it could be matched, duller where it could not.
    const proof = relative.show(cmyk);
    for (let i = 0; i < 9; i++) expect(Math.abs((proof[i] as number) - (rgb[i] as number)), `sample ${i}`).toBeLessThanOrEqual(8);
    expect(proof[9]).toBeGreaterThan(20);
    // With the paper showing, white is the paper's own slightly cool, darker white.
    const paper = relative.show(new Uint8Array(4), true);
    expect([...relative.show(new Uint8Array(4))]).toEqual([255, 255, 255]);
    expect(paper[0]).toBeLessThan(250);
    expect(paper[2]).toBeGreaterThan(paper[0] as number);
    // The colours out of reach are painted over.
    const marked = markOutside(proof, check.distance, 3);
    expect([...marked.subarray(0, 4)]).toEqual([proof[0], proof[1], proof[2], 255]);
    expect(marked[12]).toBeGreaterThan(190);
    expect(marked[13]).toBeLessThan(80);
  });

  it('judges reach by the nearest printable colour, whatever the conversion chosen', () => {
    // A dark brown the press prints as it is; a mid grey; black, darker than any ink on paper; a screen's pure green.
    const rgb = new Uint8Array([91, 58, 38, 128, 128, 128, 0, 0, 0, 0, 255, 0]);
    const screen = relative.labOfScreen(rgb);
    for (const proofer of [relative, perceptual]) {
      const reach = gamutCheck(screen, proofer.labOfPrint(proofer.nearest(rgb)), 3);
      expect(reach.distance[0], 'brown').toBeLessThan(3);
      expect(reach.distance[1], 'grey').toBeLessThan(3);
      expect(reach.distance[2], 'black').toBeGreaterThan(8);
      expect(reach.distance[3], 'green').toBeGreaterThan(30);
      expect(reach.outside).toBeCloseTo(0.5);
    }
    // The conversion itself lightens the brown a little to keep the shadows apart: a change, though the colour is in reach.
    const shift = gamutCheck(screen, relative.labOfPrint(relative.separate(rgb)), 3);
    expect(shift.distance[0]).toBeGreaterThan(gamutCheck(screen, relative.labOfPrint(relative.nearest(rgb)), 3).distance[0] as number);
  });

  it('sums up ink, draws plates and the coverage map, and works through a long run in pieces', async () => {
    const cmyk = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255, 128, 0, 0, 0, 255, 128, 128, 255]);
    const stats = inkStats(cmyk, 300);
    expect(stats.most).toBeCloseTo(400);
    expect(stats.over).toBe(0.25);
    expect(stats.mean.map((v) => Math.round(v))).toEqual([63, 38, 38, 50]);
    expect(Math.round(stats.meanTotal)).toBe(188);
    expect([...plateOf(cmyk, 0)].filter((_, i) => i % 4 === 0)).toEqual([255, 0, 127, 0]);
    const map = coverageMap(cmyk, 300);
    expect([...map.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...map.subarray(4, 8)]).toEqual([208, 59, 59, 255]);
    // Exactly at the limit is within it: the darkest blue.
    expect([...map.subarray(12, 16)]).toEqual([13, 54, 107, 255]);
    expect([...onWhite(new Uint8Array([0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 128]))]).toEqual([255, 255, 255, 10, 20, 30, 127, 127, 127]);
    expect([...toRgba(new Uint8Array([1, 2, 3]))]).toEqual([1, 2, 3, 255]);
    const rgb = new Uint8Array(3000).map((_, i) => (i * 37) % 256);
    const seen: number[] = [];
    const pieces = await inPieces(
      rgb,
      3,
      4,
      (piece) => relative.separate(piece),
      (done) => seen.push(done),
      300,
    );
    expect(pieces).toEqual(relative.separate(rgb));
    expect(seen).toHaveLength(4);
    expect(seen.at(-1)).toBe(1);
  });
});

describe('TIFF files', () => {
  it('writes CMYK with its profile and size, plain or packed, and reads it back', () => {
    const width = 300;
    const height = 700;
    const data = new Uint8Array(width * height * 4).map((_, i) => (i * 31 + (i >> 9)) % 256);
    for (const compress of [false, true]) {
      const bytes = writeTiff({ width, height, channels: 4, data, dpi: 300, profile: PRESS.subarray(0, 1001), compress });
      expect([...bytes.subarray(0, 4)]).toEqual([0x49, 0x49, 42, 0]);
      const back = readTiff(bytes);
      expect(back).toMatchObject({ width, height, channels: 4, dpi: 300, photometric: 5, inkSet: 1, compression: compress ? 8 : 1 });
      expect(back.data).toEqual(data);
      expect(back.profile).toEqual(PRESS.subarray(0, 1001));
      if (compress) expect(bytes.length).toBeLessThan(data.length);
      else expect(bytes.length).toBeGreaterThan(data.length);
    }
    // One strip, RGB, no profile.
    const small = readTiff(writeTiff({ width: 2, height: 1, channels: 3, data: new Uint8Array([1, 2, 3, 4, 5, 6]), dpi: 72 }));
    expect(small).toMatchObject({ width: 2, height: 1, channels: 3, dpi: 72, photometric: 2, inkSet: null, profile: null });
    expect([...small.data]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(() => writeTiff({ width: 2, height: 2, channels: 4, data: new Uint8Array(3) })).toThrow(/do not agree/);
    expect(() => readTiff(new Uint8Array(20))).toThrow(/not a little-endian TIFF/);
  });
});
