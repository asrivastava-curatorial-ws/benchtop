/**
 * Tests for the libraries and tools added in 3.3: mobile design, print and
 * PDF, images, audio and video, calculators, colour, text and shorthand.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { bharatiBraille, brailleSvg, cell, dotsOf, englishBraille, toBrailleAscii } from '../../src/lib/braille';
import { guessPhones, pronounce } from '../../src/lib/cmudict';
import { allNames, nearestNames, normaliseHex } from '../../src/lib/colour-names';
import { bayer, diffuse, homography, naturalSize, project, warpPerspective } from '../../src/lib/dither';
import { bookletSides, impose, nupSides, zineSides } from '../../src/lib/imposition';
import { type AppInfo, checkApp, manifestWebapp, manifestWebmanifest } from '../../src/lib/kaios-manifest';
import { androidColorsXml, buildTheme, composeColorKt, contrastRatio, cssVariables, customKey, flutterColorScheme, parseHex } from '../../src/lib/material-theme';
import { type Patches, readNinePatch, scaleRanges, writeNinePatch } from '../../src/lib/nine-patch';
import { PALETTES, paletteExports } from '../../src/lib/palettes';
import { findPaper, fitsOn, inUnit, PAPERS, sheetMass } from '../../src/lib/paper';
import { boxMargins, contentMargins, cropPages } from '../../src/lib/pdf-crop';
import { toIpa, toShavian } from '../../src/lib/phonetics';
import { buildOutline, renderPage, unitsFromPhones } from '../../src/lib/pitman';
import { formatComplex, polynomialRoots } from '../../src/lib/poly-roots';
import { OPS, placements, scanStructure } from '../../src/lib/preflight';
import { aspectRatio, bucketFor, convertLength, guessScale, metrics, widthClass } from '../../src/lib/screens';
import { adjust, checkCues, detectFormat, formatTime, parseSubtitles, parseTime, wrapText, writeSubtitles } from '../../src/lib/subtitles';
import { UTILITIES, UTILITY_GROUPS } from '../../src/lib/tailwind-classes';
import { evaluate, fromFrames, rateOf, readValue, toFrames } from '../../src/lib/timecode';
import { blockOf, encodings, parseCodePoint } from '../../src/lib/unicode-blocks';
import { kotlinName, parseAndroidColor, parseVectorDrawable, toCompose, toSvg } from '../../src/lib/vector-drawable';
import algebra from '../../src/tools/text/algebra';
import braille from '../../src/tools/text/braille';
import colourNames from '../../src/tools/text/colour-names';
import paperSizes from '../../src/tools/text/paper-sizes';
import phonetic from '../../src/tools/text/phonetic';
import pitman from '../../src/tools/text/pitman';
import screenDensity from '../../src/tools/text/screen-density';
import subtitles from '../../src/tools/text/subtitles';
import timecode from '../../src/tools/text/timecode';
import vectorDrawable from '../../src/tools/text/vector-drawable';
import { out, run } from './helpers';

/* ------------------------------------------------------------------ mobile -- */

describe('Material theme', () => {
  const theme = buildTheme('#6750A4', 'tonalSpot', 0, '2021');

  it('matches Material Theme Builder for the baseline seed', () => {
    expect(theme.light.primary).toBe('#65558F');
    expect(theme.light.onPrimary).toBe('#FFFFFF');
    expect(theme.dark.primary).toBe('#CFBDFE');
    expect(theme.palettes.primary[100]).toBe('#FFFFFF');
    expect(theme.palettes.primary[0]).toBe('#000000');
  });

  it('keeps text readable on its colours', () => {
    for (const scheme of [theme.light, theme.dark]) {
      expect(contrastRatio(scheme.onPrimary, scheme.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(scheme.onSurface, scheme.surface)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(scheme.onPrimaryContainer, scheme.primaryContainer)).toBeGreaterThanOrEqual(4.5);
    }
    const high = buildTheme('#6750A4', 'tonalSpot', 1, '2021');
    expect(contrastRatio(high.light.onSurfaceVariant, high.light.surface)).toBeGreaterThan(contrastRatio(theme.light.onSurfaceVariant, theme.light.surface));
  });

  it('adds four roles per custom colour and writes them for every platform', () => {
    const t = buildTheme('#0B57D0', 'tonalSpot', 0, '2021', {}, [{ name: 'Gallery green', hex: '#2E7D32', blend: true }]);
    expect(t.custom).toHaveLength(1);
    expect(t.custom[0]?.key).toBe('galleryGreen');
    expect(customKey('2 Brand blue', 0)).toMatch(/^[a-z][A-Za-z0-9]*$/);
    expect(androidColorsXml(t)).toContain('<color name="md_theme_light_primary">');
    expect(androidColorsXml(t)).toMatch(/<color name="md_custom_dark_gallery_green_container">#[0-9A-F]{6}<\/color>/);
    expect(composeColorKt(t, 'org.vitm.guide.ui.theme')).toContain('package org.vitm.guide.ui.theme');
    expect(flutterColorScheme(t)).toContain('ColorScheme(');
    expect(cssVariables(t)).toContain('--md-sys-color-primary:');
  });

  it('reads colours people paste', () => {
    expect(parseHex('#abc')).toBe(0xffaabbcc);
    expect(parseHex('6750A4')).toBe(0xff6750a4);
    expect(parseHex('purple-ish')).toBeNull();
  });
});

describe('Vector drawables', () => {
  const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24" android:tint="?attr/colorControlNormal">
    <group android:pivotX="12" android:pivotY="12" android:rotation="90">
      <path android:fillColor="#FF0B57D0" android:pathData="M12,2L22,22L2,22Z"/>
    </group>
    <path android:strokeColor="#80000000" android:strokeWidth="2" android:pathData="M4,12h16"/>
  </vector>`;

  it('reads a drawable and draws it as SVG', () => {
    const { drawable, warnings } = parseVectorDrawable(xml);
    expect(drawable.width).toBe(24);
    expect(drawable.viewportHeight).toBe(24);
    expect(drawable.children).toHaveLength(2);
    const svg = toSvg(drawable, warnings);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('M12,2L22,22L2,22Z');
    expect(svg).toMatch(/rotate\(90\)/);
    expect(svg).toMatch(/#0b57d0/i);
  });

  it('writes Compose ImageVector code', () => {
    const { drawable } = parseVectorDrawable(xml);
    const kt = toCompose(drawable, kotlinName('ic gallery map'), 'org.vitm.icons');
    expect(kotlinName('ic gallery map')).toBe('IcGalleryMap');
    expect(kt).toContain('package org.vitm.icons');
    expect(kt).toContain('ImageVector.Builder(');
    expect(kt).toContain('addPath(');
  });

  it('reads every Android colour form', () => {
    expect(parseAndroidColor('#F00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseAndroidColor('#80FF0000')?.a).toBeCloseTo(128 / 255, 3);
    expect(parseAndroidColor('@color/brand')).toBeNull();
  });

  it('converts SVG to a vector drawable and back through the tool', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M2 2h20v20H2z" fill="#0B57D0"/></svg>';
    const vd = await out(vectorDrawable, svg, { to: 'vd' });
    expect(vd).toContain('<vector');
    expect(vd).toContain('android:pathData=');
    const back = await out(vectorDrawable, vd, { to: 'svg' });
    expect(back).toContain('<svg');
    expect(back).toMatch(/#0b57d0/i);
  });
});

describe('Nine-patch', () => {
  // A 4 × 3 picture with stretch columns 1–2 and row 1, content 1–3 × 0–2.
  const patches: Patches = { stretchX: [[1, 3]], stretchY: [[1, 2]], contentX: [[1, 4]], contentY: [[0, 3]] };
  const inner = new Uint8ClampedArray(4 * 3 * 4).fill(200);

  it('writes the guides and reads them back', () => {
    const full = writeNinePatch(inner, 4, 3, patches);
    expect(full.length).toBe(6 * 5 * 4);
    const read = readNinePatch(full, 6, 5);
    expect(read.width).toBe(4);
    expect(read.height).toBe(3);
    expect(read.patches).toEqual(patches);
    expect(read.warnings).toEqual([]);
    expect([...read.inner]).toEqual([...inner]);
  });

  it('warns about grey border pixels and missing guides', () => {
    const full = writeNinePatch(inner, 4, 3, { stretchX: [], stretchY: [], contentX: [], contentY: [] });
    full.set([128, 128, 128, 255], 2 * 4);
    const read = readNinePatch(full, 6, 5);
    expect(read.warnings.join(' ')).toMatch(/neither clear nor pure black/);
    expect(read.warnings.join(' ')).toMatch(/No stretch guide/);
  });

  it('scales guides with the picture and keeps them at least a pixel wide', () => {
    expect(scaleRanges([[10, 20]], 40, 20)).toEqual([[5, 10]]);
    const tiny = scaleRanges([[10, 11]], 40, 10);
    expect((tiny[0]?.[1] ?? 0) - (tiny[0]?.[0] ?? 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('Screens', () => {
  it('works out density, size classes and buckets', () => {
    const m = metrics(1080, 2400, 6.4, 2.625);
    expect(m.ppi).toBeCloseTo(411.2, 1);
    expect(m.layoutWidth).toBeCloseTo(411.43, 2);
    expect(m.dpi).toBe(420);
    expect(m.aspect).toBe('20:9');
    expect(widthClass(m.layoutWidth)).toBe('Compact');
    expect(widthClass(700)).toBe('Medium');
    expect(widthClass(1000)).toBe('Expanded');
    expect(bucketFor(420).name).toBe('xxhdpi');
    expect(bucketFor(160).name).toBe('mdpi');
    expect(guessScale(460)).toBe(3);
    expect(aspectRatio(1536, 2048)).toBe('4:3');
  });

  it('converts lengths between units on a screen', () => {
    const m = metrics(1080, 2400, 6.4, 2.625);
    const one = convertLength(48, 'unit', m);
    expect(one.px).toBeCloseTo(126, 6);
    expect(one.mm).toBeCloseTo((126 / m.ppi) * 25.4, 6);
    expect(convertLength(1, 'in', m).px).toBeCloseTo(m.ppi, 6);
  });

  it('answers in the tool', async () => {
    const result = await run(screenDensity, '');
    expect(result.output ?? '').not.toBe('');
  });
});

describe('KaiOS manifest', () => {
  const app: AppInfo = {
    name: 'Museum Guide',
    shortName: 'Guide',
    subtitle: 'Galleries and shows',
    description: 'Gallery maps and show times for the museum.',
    version: '1.0.0',
    id: 'org.example.guide',
    type: 'privileged',
    origin: 'app://guide.example.org',
    launchPath: '/index.html',
    developer: 'Example Museum',
    developerUrl: 'https://example.org',
    category: 'utilities',
    defaultLocale: 'en-US',
    locales: [{ locale: 'hi-IN', name: 'संग्रहालय गाइड', subtitle: '', description: '' }],
    orientation: 'portrait',
    themeColor: '#0d1117',
    backgroundColor: '#0d1117',
    fullscreen: false,
    overlapStatusBar: true,
    cursor: false,
    permissions: [{ name: 'device-storage:sdcard', description: 'Save maps for offline use', access: 'readwrite' }],
    iconPath: '/icons',
  };

  it('accepts a valid app and lists problems in an invalid one', () => {
    expect(checkApp(app)).toEqual([]);
    const bad = checkApp({ ...app, shortName: 'Museum Guide App', version: '1.0', type: 'web' });
    expect(bad.join(' ')).toMatch(/12 characters/);
    expect(bad.join(' ')).toMatch(/three numbers/);
    expect(bad.join(' ')).toMatch(/needs a privileged app/);
  });

  it('writes both manifest formats', () => {
    const v2 = JSON.parse(manifestWebapp(app));
    expect(v2.launch_path).toBe('/index.html');
    expect(v2.type).toBe('privileged');
    expect(v2.permissions['device-storage:sdcard'].access).toBe('readwrite');
    expect(v2.locales['hi-IN'].name).toBe('संग्रहालय गाइड');
    const v3 = JSON.parse(manifestWebmanifest(app));
    expect(v3.short_name).toBe('Guide');
    expect(v3.start_url).toBe('/index.html');
    expect(v3.b2g_features.origin).toBe('app://guide.example.org');
    expect(v3.b2g_features.permissions['device-storage:sdcard']).toBeTruthy();
    expect(Array.isArray(v3.icons)).toBe(true);
  });
});

/* ------------------------------------------------------------ print and PDF -- */

describe('Paper sizes', () => {
  it('knows ISO, press and Indian sizes', () => {
    expect(findPaper('a4')).toMatchObject({ width: 210, height: 297 });
    expect(findPaper('sra3')).toMatchObject({ width: 320, height: 450 });
    expect(findPaper('demy')?.width).toBeCloseTo(17.5 * 25.4, 6);
    expect(new Set(PAPERS.map((p) => p.id)).size).toBe(PAPERS.length);
  });

  it('converts units, counts pieces per sheet and weighs sheets', () => {
    expect(inUnit(25.4, 'in')).toBe(1);
    expect(inUnit(210, 'pt')).toBeCloseTo(595.28, 2);
    expect(inUnit(25.4, 'px', 300)).toBeCloseTo(300, 6);
    expect(fitsOn({ width: 210, height: 297 }, { width: 320, height: 450 })).toBe(2);
    expect(fitsOn({ width: 148, height: 210 }, { width: 210, height: 297 })).toBe(2);
    expect(fitsOn({ width: 90, height: 55 }, { width: 210, height: 297 }, 0)).toBe(10);
    expect(sheetMass({ width: 210, height: 297 }, 80)).toBeCloseTo(4.99, 2);
  });

  it('answers in the tool', async () => {
    const result = await run(paperSizes, '');
    expect(result.output ?? '').toContain('A4');
    expect(result.fields?.find((f) => f.label === 'Aspect ratio')?.value).toBe('1:√2 (1.4143)');
    const letter = await run(paperSizes, '', { paper: 'letter' });
    expect(letter.fields?.find((f) => f.label === 'Aspect ratio')?.value).toBe('17:22 (1.2941)');
  });
});

describe('Imposition', () => {
  const pagesOf = (sides: ReturnType<typeof bookletSides>) => sides.map((s) => [...s.slots].sort((a, b) => a.row - b.row || a.col - b.col).map((x) => x.page));

  it('orders an eight-page booklet for saddle stitching', () => {
    expect(pagesOf(bookletSides(8))).toEqual([
      [7, 0],
      [1, 6],
      [5, 2],
      [3, 4],
    ]);
  });

  it('pads a booklet with blank pages', () => {
    const sides = pagesOf(bookletSides(6));
    expect(sides).toHaveLength(4);
    expect(sides[0]).toEqual([null, 0]);
    expect(sides.flat().filter((p) => p === null)).toHaveLength(2);
  });

  it('splits long books into signatures', () => {
    const sides = bookletSides(16, 8);
    expect(sides).toHaveLength(8);
    expect(pagesOf(sides)[4]).toEqual([15, 8]);
  });

  it('lays out the one-sheet zine and cut-and-stack n-up', () => {
    const zine = pagesOf(zineSides(8));
    expect(zine[0]).toEqual([4, 3, 2, 1, 5, 6, 7, 0]);
    expect(zineSides(8)[0]?.slots.filter((s) => s.rotate === 180)).toHaveLength(4);
    expect(pagesOf(nupSides(8, 2, 1, true))).toEqual([
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ]);
    expect(pagesOf(nupSides(5, 2, 2, false))).toEqual([
      [0, 1, 2, 3],
      [4, null, null, null],
    ]);
  });

  it('imposes a real PDF onto sheets', async () => {
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    // Page 8 is left without a content stream, as some programs write blank pages.
    for (let i = 0; i < 8; i++) {
      const page = source.addPage([419.53, 595.28]);
      if (i < 7) page.drawText(`Page ${i + 1}`, { font, x: 40, y: 40 });
    }
    const result = await impose(source, {
      layout: 'booklet',
      sheet: null,
      orientation: 'auto',
      cols: 2,
      rows: 1,
      margin: 0,
      gutter: 0,
      signature: 0,
      creep: 0,
      cutStack: false,
      marks: false,
      fit: 'fit',
    });
    expect(result.sheets).toBe(2);
    expect(result.sides).toBe(4);
    expect(result.blanks).toBe(0);
    expect(result.sheetSize.width).toBeCloseTo(839.06, 1);
    const done = await PDFDocument.load(result.bytes);
    expect(done.getPageCount()).toBe(4);
  });
});

describe('Preflight', () => {
  it('measures the resolution of placed pictures through nested transforms', () => {
    const fn = [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.save, OPS.transform, OPS.transform, OPS.paintImageXObject, OPS.restore];
    const args = [null, [100, 0, 0, 50, 10, 20], ['img1', 300, 150], null, null, [2, 0, 0, 2, 0, 0], [72, 0, 0, 72, 0, 0], ['img2', 600, 600], null];
    const found = placements(3, fn, args);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ page: 3, width: 100, height: 50 });
    expect(found[0]?.dpi).toBeCloseTo(216, 6);
    expect(found[1]?.width).toBe(144);
    expect(found[1]?.dpi).toBeCloseTo(300, 6);
  });

  it('finds fonts that are not embedded and missing bleed', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    page.drawText('Engine Hall', { font: await doc.embedFont(StandardFonts.Helvetica), x: 50, y: 700 });
    const bytes = await doc.save();
    const facts = scanStructure(await PDFDocument.load(bytes), bytes);
    expect(facts.pages).toHaveLength(1);
    expect(facts.pages[0]?.bleedAmount).toBeNull();
    expect(facts.fonts.some((f) => /Helvetica/.test(f.name) && !f.embedded)).toBe(true);
    expect(facts.hasForms).toBe(false);
  });
});

describe('PDF crop', () => {
  it('turns on-screen margins into margins of a rotated page', () => {
    const visual = { top: 1, right: 2, bottom: 3, left: 4 };
    expect(boxMargins(visual, 0)).toEqual(visual);
    expect(boxMargins(visual, 90)).toEqual({ left: 1, top: 2, right: 3, bottom: 4 });
    expect(boxMargins(visual, 180)).toEqual({ top: 3, bottom: 1, left: 2, right: 4 });
    expect(boxMargins(visual, -90)).toEqual({ right: 1, bottom: 2, left: 3, top: 4 });
  });

  it('crops boxes and can make the crop permanent', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    doc.addPage([600, 800]);
    cropPages(doc, [1], () => ({ top: 10, right: 20, bottom: 30, left: 40 }), false);
    cropPages(doc, [2], () => ({ top: 100, right: 100, bottom: 100, left: 100 }), true);
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 40, y: 30, width: 540, height: 760 });
    expect(doc.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 600, height: 800 });
    expect(doc.getPage(1).getMediaBox()).toEqual({ x: 100, y: 100, width: 400, height: 600 });
    expect(() => cropPages(doc, [1], () => ({ top: 500, right: 0, bottom: 500, left: 0 }), false)).toThrow(/larger than page 1/);
  });

  it('finds the inked area of a rendered page', () => {
    const w = 10;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 2; y <= 5; y++) for (let x = 3; x <= 6; x++) data.set([0, 0, 0, 255], (y * w + x) * 4);
    expect(contentMargins(data, w, h)).toEqual({ top: 2, right: 3, bottom: 2, left: 3 });
    expect(contentMargins(new Uint8ClampedArray(w * h * 4).fill(255), w, h)).toBeNull();
  });
});

describe('Unicode blocks', () => {
  it('names blocks and reads code points', () => {
    expect(blockOf(0x0915)?.name).toBe('Devanagari');
    expect(parseCodePoint('U+20B9')).toBe(0x20b9);
    expect(parseCodePoint('₹')).toBe(0x20b9);
    expect(parseCodePoint('0x41')).toBe(0x41);
    const enc = encodings(0x20b9);
    expect(enc.find((e) => e.label.startsWith('UTF-8'))?.value).toBe('E2 82 B9');
    expect(encodings(0x1f600).find((e) => e.label === 'UTF-16')?.value).toBe('D83D DE00');
  });
});

/* ------------------------------------------------------------------ Pitman -- */

describe('Pitman shorthand', () => {
  const o = { unit: 40, vowels: true, circleS: true, ingDot: true };
  const outline = (phones: string) => buildOutline(unitsFromPhones(phones.split(' ')), o);

  it('maps dictionary sounds to Pitman vowels', () => {
    expect(unitsFromPhones(['F', 'AA1', 'DH', 'ER0'])).toEqual([
      { kind: 'C', c: 'F' },
      { kind: 'V', v: 'o' },
      { kind: 'C', c: 'DH' },
      { kind: 'V', v: 'e' },
      { kind: 'C', c: 'R' },
    ]);
    expect(unitsFromPhones(['K', 'AA1', 'R'])[1]).toEqual({ kind: 'V', v: 'ah' });
    expect(unitsFromPhones(['F', 'Y', 'UW1'])).toEqual([
      { kind: 'C', c: 'F' },
      { kind: 'V', v: 'EW' },
    ]);
  });

  it('writes words in the position of their first vowel', () => {
    expect(outline('P AA1').position).toBe(1);
    expect(outline('P EY1').position).toBe(2);
    expect(outline('T IY1').position).toBe(3);
  });

  it('uses circle S only where no vowel touches the S', () => {
    expect(outline('K AE1 P S').spelling).toBe('Kay · Pee · circle S');
    expect(outline('S OW1 P').spelling).toBe('circle S · Pee');
    expect(outline('AH1 S K').spelling).toBe('Ess · Kay');
    expect(outline('B IH1 Z IY0').spelling).toBe('Bee · Zee');
  });

  it('chooses Ray or Ar and the ing dot', () => {
    expect(outline('R EY1 T').spelling).toBe('Ray · Tee');
    expect(outline('AO1 R').spelling).toBe('Ar');
    expect(outline('P L EY1 IH0 NG').spelling).toBe('Pee · Lay · ing dot');
  });

  it('lays out a page of outlines', () => {
    const page = renderPage(
      [
        { text: 'pay', units: unitsFromPhones(['P', 'EY1']), guessed: false },
        { text: '25', units: null, guessed: false },
      ],
      { ...o, width: 600, lines: true, labels: true, ink: '#000', paper: '#fff' },
    );
    expect(page.svg.startsWith('<svg')).toBe(true);
    expect(page.outlines).toHaveLength(1);
    expect(page.svg).toContain('25');
  });

  it('guesses the sounds of words that are not in the dictionary', async () => {
    expect(guessPhones('vitm').length).toBeGreaterThan(0);
    const known = await pronounce('museum');
    expect(known.guessed).toBe(false);
    expect(known.phones.join(' ')).toMatch(/^M Y UW0 Z IY1 AH0 M$/);
    const made = await pronounce('zorblat');
    expect(made.guessed).toBe(true);
  });

  it('writes a page through the tool', async () => {
    const result = await run(pitman, 'Welcome to the museum.');
    expect(result.preview?.kind).toBe('svg');
  });
});

/* ------------------------------------------------------------------ images -- */

describe('Dithering and perspective', () => {
  it('builds Bayer matrices with every threshold once', () => {
    const m = bayer(2);
    expect(m).toHaveLength(4);
    expect(new Set(m.flat()).size).toBe(16);
    expect(
      bayer(3)
        .flat()
        .sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  it('dithers to the palette colours only', () => {
    const w = 16;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([i * 4, i * 4, i * 4, 255], i * 4);
    diffuse(
      data,
      w,
      h,
      [
        [0, 0, 0],
        [255, 255, 255],
      ],
      'floyd',
    );
    for (let i = 0; i < data.length; i += 4) expect([0, 255]).toContain(data[i]);
    const white = data.filter((_, i) => i % 4 === 0 && data[i] === 255).length;
    expect(white).toBeGreaterThan(10);
    expect(white).toBeLessThan(54);
  });

  it('maps corners exactly and straightens a picture', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const skew = [
      { x: 2, y: 1 },
      { x: 12, y: 0 },
      { x: 11, y: 9 },
      { x: 0, y: 11 },
    ];
    const m = homography(square, skew);
    for (let k = 0; k < 4; k++) {
      const p = project(m, square[k] as { x: number; y: number });
      expect(p.x).toBeCloseTo((skew[k] as { x: number }).x, 9);
      expect(p.y).toBeCloseTo((skew[k] as { y: number }).y, 9);
    }
    const src = new Uint8ClampedArray(4 * 4 * 4).map((_, i) => (i % 4 === 3 ? 255 : i * 3));
    const same = warpPerspective(
      src,
      4,
      4,
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
      4,
      4,
    );
    expect([...same]).toEqual([...src]);
    expect(naturalSize(skew)).toEqual({ width: 11, height: 10 });
  });
});

/* ------------------------------------------------------------ audio, video -- */

describe('Subtitles', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,500\nWelcome to the\n<i>Engine Hall</i>\n\n2\n00:00:03,400 --> 00:00:05,000\nMind the steps.\n';

  it('reads and writes SRT, WebVTT and SBV', () => {
    const { cues, format } = parseSubtitles(srt);
    expect(format).toBe('srt');
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1000, end: 3500 });
    const vtt = writeSubtitles(cues, 'vtt');
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:01.000 --> 00:00:03.500');
    expect(detectFormat(vtt)).toBe('vtt');
    expect(parseSubtitles(vtt).cues).toEqual(cues);
    expect(writeSubtitles(cues, 'sbv')).toContain('0:00:01.000,0:00:03.500');
    expect(parseTime('01:02:03,004')).toBe(3723004);
    expect(formatTime(3723004, 'srt')).toBe('01:02:03,004');
  });

  it('shifts, retimes and tidies cues', () => {
    const { cues } = parseSubtitles(srt);
    const moved = adjust(cues, { shift: -1500, factor: 1, minGap: 0, minDuration: 0, wrap: 0, stripTags: true });
    expect(moved[0]).toMatchObject({ start: 0, end: 2000 });
    expect(moved[0]?.text).toBe('Welcome to the\nEngine Hall');
    const gapped = adjust(cues, { shift: 0, factor: 1, minGap: 100, minDuration: 0, wrap: 0, stripTags: false });
    expect(gapped[0]?.end).toBe(3300);
    const pal = adjust(cues, { shift: 0, factor: 25 / 24, minGap: 0, minDuration: 0, wrap: 0, stripTags: false });
    expect(pal[1]?.end).toBeCloseTo(5208.33, 1);
  });

  it('wraps lines and flags fast or overlapping cues', () => {
    expect(wrapText('The steam engine in this hall pumped water out of the Kolar gold mines', 42).split('\n')).toHaveLength(2);
    const checks = checkCues(parseSubtitles(srt).cues);
    expect(checks[0]?.overlaps).toBe(true);
    expect(checks[1]?.overlaps).toBe(false);
  });

  it('converts through the tool', async () => {
    const vtt = await out(subtitles, srt, { to: 'vtt' });
    expect(vtt.startsWith('WEBVTT')).toBe(true);
  });
});

describe('Timecode', () => {
  const df = rateOf('29.97df');

  it('counts drop-frame timecode the SMPTE way', () => {
    expect(toFrames('00:01:00;02', df)).toBe(1800);
    expect(fromFrames(1800, df)).toBe('00:01:00;02');
    expect(fromFrames(1799, df)).toBe('00:00:59;29');
    expect(toFrames('00:10:00;00', df)).toBe(17982);
    expect(fromFrames(17982, df)).toBe('00:10:00;00');
    expect(toFrames('01:00:00;00', df)).toBe(107892);
    for (const n of [0, 1, 1798, 1801, 17981, 17983, 54000, 107891]) expect(toFrames(fromFrames(n, df), df)).toBe(n);
  });

  it('adds timecodes and durations', () => {
    const pal = rateOf('25');
    expect(fromFrames(evaluate('01:00:00:00 + 00:00:10:12', pal), pal)).toBe('01:00:10:12');
    expect(readValue('250f', pal)).toBe(250);
    expect(readValue('1m30s', pal)).toBe(2250);
    expect(fromFrames(evaluate('00:00:10:00 * 3', pal), pal)).toBe('00:00:30:00');
    expect(() => toFrames('00:00:00:25', pal)).toThrow(/only 25 a second/);
  });

  it('answers in the tool', async () => {
    const result = await run(timecode, '01:00:00:00 + 00:00:10:12');
    expect(result.output ?? '').toContain('01:00:10');
  });
});

/* ------------------------------------------------------ calculators, text -- */

describe('Polynomial roots', () => {
  const show = (coeffs: number[]) => polynomialRoots(coeffs).map((z) => formatComplex(z));

  it('finds real, repeated and complex roots', () => {
    expect(show([-6, 11, -6, 1])).toEqual(['1', '2', '3']);
    expect(show([1, 0, 1])).toEqual(['-i', 'i']);
    expect(show([4, 0, 1])).toEqual(['-2i', '2i']);
    expect(show([0, 0, 1])).toEqual(['0', '0']);
    expect(show([1, -2, 1])).toEqual(['1', '1']);
    expect(show([-1, 3, -3, 1])).toEqual(['1', '1', '1']);
    expect(show([12, -8, -1, 1])).toEqual(['-3', '2', '2']);
    expect(show([1, 0, 2, 0, 1])).toEqual(['-i', '-i', 'i', 'i']);
    expect(show([-0.001, 0.03, -0.3, 1])).toEqual(['0.1', '0.1', '0.1']);
    // Close but different roots stay apart.
    expect(show([1.0001, -2.0001, 1])).toEqual(['1', '1.0001']);
    expect(show([-2, 0, 1]).map(Number)).toEqual([-Math.SQRT2, Math.SQRT2].map((v) => Number(v.toPrecision(10))));
  });

  it('solves equations through the tool', async () => {
    expect(await out(algebra, 'x^3 - 6x^2 + 11x - 6')).toBe('x1 = 1\nx2 = 2\nx3 = 3');
    expect(await out(algebra, '2t^2 = 8', { variable: 't' })).toBe('t1 = -2\nt2 = 2');
    expect(await out(algebra, 'x^2 + 2x + 5 = 0')).toBe('x1 = -1 - 2i\nx2 = -1 + 2i');
    expect(await out(algebra, 'x^3 + 2x', { op: 'derivative' })).toBe('3 * x ^ 2 + 2');
    expect(await out(algebra, '(x + 1)^2', { op: 'expand' })).toBe('x ^ 2 + 2 * x + 1');
    expect(await out(algebra, 'x^2 + 1', { op: 'evaluate', at: 3 })).toBe('10');
  });
});

describe('Braille', () => {
  it('writes English uncontracted braille with capitals and numbers', () => {
    expect(englishBraille('Hello')).toBe('⠠⠓⠑⠇⠇⠕');
    expect(englishBraille('VITM')).toBe('⠠⠠⠧⠊⠞⠍');
    expect(englishBraille('10')).toBe('⠼⠁⠚');
    expect(cell('134')).toBe('⠍');
    expect(dotsOf('⠍')).toEqual([1, 3, 4]);
  });

  it('writes Hindi in Bharati Braille', () => {
    expect(bharatiBraille('कि')).toBe('⠅⠊');
    expect(bharatiBraille('क्ष')).toBe('⠟');
    expect(bharatiBraille('ज्ञान')).toBe('⠱⠜⠝');
    expect(bharatiBraille('२५')).toBe('⠼⠃⠑');
    expect(bharatiBraille('ड़')).toBe(`⠐${bharatiBraille('ड')}`);
  });

  it('turns braille into Braille ASCII for embossers', () => {
    expect(toBrailleAscii('⠠⠓⠑⠇⠇⠕')).toBe(',HELLO');
    expect(toBrailleAscii('⠼⠁⠚')).toBe('#AJ');
    expect(toBrailleAscii('⠀⠿')).toBe(' =');
  });

  it('draws signs to scale', async () => {
    const svg = brailleSvg('⠁⠃');
    expect(svg).toContain('mm');
    expect((svg.match(/<circle/g) ?? []).length).toBe(3);
    const result = await run(braille, 'Exit', { as: 'ascii' });
    expect(result.output).toBe(',EXIT');
  });
});

describe('Phonetic spelling', () => {
  it('writes IPA with stress before the syllable', () => {
    expect(toIpa(['M', 'Y', 'UW0', 'Z', 'IY1', 'AH0', 'M'])).toBe('mjuˈziəm');
    expect(toIpa(['IH0', 'K', 'S', 'P', 'L', 'EY1', 'N'])).toBe('ɪkˈspleɪn');
    expect(toIpa(['HH', 'AH0', 'L', 'OW1'], false)).toBe('həloʊ');
  });

  it('writes Shavian', () => {
    const shaw = toShavian('museum', ['M', 'Y', 'UW0', 'Z', 'IY1', 'AH0', 'M']);
    expect([...shaw].every((ch) => (ch.codePointAt(0) ?? 0) >= 0x10450 && (ch.codePointAt(0) ?? 0) <= 0x1047f)).toBe(true);
    expect(toShavian('the', ['DH', 'AH0'])).toBe('𐑞');
  });

  it('transcribes through the tool', async () => {
    expect(await out(phonetic, 'museum')).toContain('ˈziəm');
  });
});

describe('Colour names', () => {
  it('names colours from CSS and the xkcd survey', async () => {
    const names = await allNames();
    expect(names.filter((n) => n.list === 'css').length).toBeGreaterThanOrEqual(148);
    expect(names.filter((n) => n.list === 'xkcd').length).toBe(949);
    expect(nearestNames('#ff0000', names, 1, 'css')[0]?.colour.name).toBe('red');
    expect(nearestNames('#ff0000', names, 1, 'css')[0]?.delta).toBe(0);
    expect(nearestNames('#7f5e00', names, 1, 'xkcd')[0]?.colour.list).toBe('xkcd');
    expect(normaliseHex('rebeccapurple')).toBe('#663399');
    expect(normaliseHex('rgb(255 0 0)')).toBe('#ff0000');
    expect(normaliseHex('not a colour')).toBeNull();
  });

  it('answers in the tool', async () => {
    expect(await out(colourNames, '#663399')).toMatch(/rebeccapurple/);
  });
});

describe('Palettes', () => {
  it('lists palettes with sources, licences and valid colours', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
    for (const p of PALETTES) {
      expect(p.source, p.id).not.toBe('');
      expect(p.licence, p.id).not.toBe('');
      for (const [, hex] of p.colors) expect(hex, `${p.id} ${hex}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(PALETTES.find((p) => p.id === 'okabe-ito')?.colors).toHaveLength(8);
  });

  it('exports CSS, Sass, JSON and GIMP palettes', () => {
    const p = PALETTES.find((x) => x.id === 'okabe-ito');
    if (!p) throw new Error('missing');
    const e = paletteExports(p);
    expect(e.css).toContain('--okabe-ito-sky-blue: #56b4e9;');
    expect(e.scss).toContain('$okabe-ito-orange: #e69f00;');
    expect(JSON.parse(e.json).colors.Orange).toBe('#e69f00');
    expect(e.gpl.split('\n')[0]).toBe('GIMP Palette');
    expect(e.gpl).toContain('230 159   0\tOrange');
  });
});

describe('Tailwind utilities', () => {
  it('covers the v4 defaults without duplicates', () => {
    expect(UTILITIES.length).toBeGreaterThan(1000);
    expect(new Set(UTILITIES.map((u) => u.cls)).size).toBe(UTILITIES.length);
    expect(UTILITY_GROUPS).toContain('Layout');
    expect(UTILITIES.find((u) => u.cls === 'rounded-lg')?.css).toBe('border-radius: 0.5rem;');
    expect(UTILITIES.find((u) => u.cls === 'p-4')?.css).toMatch(/var\(--spacing\) \* 4/);
    expect(UTILITIES.find((u) => u.cls === 'hidden')?.css).toBe('display: none;');
  });
});
