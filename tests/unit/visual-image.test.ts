import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { blobPath, composeTransform, formatMatrix, linearGradientLine, radialGradientRadii, smoothClosedPath, sunburstPath, wavePath } from '../../src/lib/geometry';
import { encodeIco, parseIco } from '../../src/lib/ico';
import { applyFilters, blur, extractPalette, fadeAlpha, NEUTRAL_FILTER, replaceColor, simulateDeficiency } from '../../src/lib/pixels';
import { radiusValue } from '../../src/tools/css/border-radius';
import { shadowValue } from '../../src/tools/css/box-shadow';
import { filterList } from '../../src/tools/css/filter';
import { gradientCss } from '../../src/tools/css/gradient';
import { parseAreas } from '../../src/tools/css/grid';
import { transformList } from '../../src/tools/css/transform';
import { defaultsOf } from '../../src/tools/options';
import { TOOLS } from '../../src/tools/registry';
import type { VisualToolSpec } from '../../src/tools/types';

const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

function image(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(fill(x, y), (y * width + x) * 4);
  return data;
}

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

describe('geometry', () => {
  it('places CSS linear-gradient lines like the specification', () => {
    const right = linearGradientLine(90, 200, 100);
    close(right.start.x, 0);
    close(right.start.y, 50);
    close(right.end.x, 200);
    const down = linearGradientLine(180, 200, 100);
    close(down.start.y, 0);
    close(down.end.y, 100);
    // 45deg in a square: the line runs corner to corner.
    const diagonal = linearGradientLine(45, 100, 100);
    close(diagonal.start.x, 0);
    close(diagonal.start.y, 100);
    close(diagonal.end.x, 100);
    close(diagonal.end.y, 0);
  });

  it('sizes radial gradients to the farthest corner', () => {
    expect(radialGradientRadii(50, 50, 100, 100, true).rx).toBeCloseTo(Math.hypot(50, 50));
    const ellipse = radialGradientRadii(0, 0, 200, 100, false);
    close(ellipse.rx, 200 * Math.SQRT2);
    close(ellipse.ry, 100 * Math.SQRT2);
  });

  it('composes transforms in CSS order', () => {
    expect(formatMatrix(composeTransform({ translateX: 0, translateY: 0, rotate: 90, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 }))).toBe('matrix(0, 1, -1, 0, 0, 0)');
    expect(formatMatrix(composeTransform({ translateX: 10, translateY: 20, rotate: 0, scaleX: 2, scaleY: 3, skewX: 0, skewY: 0 }))).toBe('matrix(2, 0, 0, 3, 10, 20)');
    expect(formatMatrix(composeTransform({ translateX: 0, translateY: 0, rotate: 0, scaleX: 1, scaleY: 1, skewX: 45, skewY: 0 }))).toBe('matrix(1, 0, 1, 1, 0, 0)');
  });

  it('builds closed, deterministic shapes', () => {
    expect(blobPath(7, 6, 0.5, 400)).toBe(blobPath(7, 6, 0.5, 400));
    expect(blobPath(7, 6, 0.5, 400)).not.toBe(blobPath(8, 6, 0.5, 400));
    expect(blobPath(7, 6, 0.5, 400)).toMatch(/^M[\d.]+ [\d.]+(C[\d. -]+){6}Z$/);
    expect(smoothClosedPath([{ x: 0, y: 0 }])).toBe('');
    expect(wavePath(1, 100, 50, 25, 10, 4, false)).toMatch(/^M0 [\d.]+(L[\d.]+ [\d.]+){4}L100 50L0 50Z$/);
    expect(sunburstPath(8, 50, 50, 100, 0).match(/M/g)).toHaveLength(4);
  });
});

describe('pixel operations', () => {
  const rgb = image(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [128, 128, 128, 255]));

  it('keeps neutral greys neutral in every deficiency simulation', () => {
    for (const kind of ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'] as const) {
      const out = simulateDeficiency(rgb, kind);
      const grey = pixel(out, 2, 1, 0);
      for (const channel of grey.slice(0, 3)) expect(Math.abs(channel - 128)).toBeLessThanOrEqual(1);
      expect(grey[3]).toBe(255);
    }
    const red = simulateDeficiency(rgb, 'protanopia');
    // Without red cones, pure red loses most of its brightness and turns olive.
    expect(pixel(red, 2, 0, 0)[0]).toBeLessThan(140);
    expect(pixel(simulateDeficiency(rgb, 'achromatopsia'), 2, 0, 0).slice(0, 3)).toEqual([127, 127, 127]);
  });

  it('matches the CSS filter maths', () => {
    expect(Array.from(applyFilters(rgb, NEUTRAL_FILTER))).toEqual(Array.from(rgb));
    // grayscale(100%) of red uses the 0.213 luminance weight from the Filter Effects spec.
    expect(pixel(applyFilters(rgb, { ...NEUTRAL_FILTER, grayscale: 100 }), 2, 0, 0)).toEqual([54, 54, 54, 255]);
    expect(pixel(applyFilters(rgb, { ...NEUTRAL_FILTER, invert: 100 }), 2, 0, 0)).toEqual([0, 255, 255, 255]);
    expect(pixel(applyFilters(rgb, { ...NEUTRAL_FILTER, brightness: 50 }), 2, 1, 0)).toEqual([64, 64, 64, 255]);
    expect(pixel(applyFilters(rgb, { ...NEUTRAL_FILTER, contrast: 0 }), 2, 0, 0).slice(0, 3)).toEqual([128, 128, 128]);
    const hue = pixel(applyFilters(rgb, { ...NEUTRAL_FILTER, hue: 120 }), 2, 0, 0);
    expect(hue[1]).toBeGreaterThan(hue[0] as number);
  });

  it('blurs without bleeding colour from transparent pixels', () => {
    const flat = image(9, 9, () => [10, 200, 30, 255]);
    expect(Array.from(blur(flat, 9, 9, 3))).toEqual(Array.from(flat));
    const dot = image(9, 9, (x, y) => (x === 4 && y === 4 ? [255, 0, 0, 255] : [0, 0, 255, 0]));
    const out = blur(dot, 9, 9, 2);
    const near = pixel(out, 9, 5, 4);
    expect(near[3]).toBeGreaterThan(0);
    expect(near[2]).toBe(0);
    expect(near[0]).toBe(255);
  });

  it('replaces colours with tolerance, soft edges and swapping', () => {
    const source = image(
      4,
      1,
      (x) =>
        [
          [255, 255, 255, 255],
          [250, 250, 250, 255],
          [200, 200, 200, 255],
          [0, 0, 0, 255],
        ][x] as [number, number, number, number],
    );
    const exact = replaceColor(source, { from: { r: 255, g: 255, b: 255, a: 1 }, to: { r: 0, g: 0, b: 0, a: 0 }, tolerance: 0, feather: 0, swap: false });
    expect(exact.changed).toBe(1);
    expect(pixel(exact.pixels, 4, 0, 0)[3]).toBe(0);
    expect(pixel(exact.pixels, 4, 1, 0)[3]).toBe(255);
    const soft = replaceColor(source, { from: { r: 255, g: 255, b: 255, a: 1 }, to: { r: 255, g: 0, b: 0, a: 1 }, tolerance: 2, feather: 20, swap: false });
    expect(pixel(soft.pixels, 4, 1, 0)).toEqual([255, 0, 0, 255]);
    const partial = pixel(soft.pixels, 4, 2, 0);
    expect(partial[1]).toBeGreaterThan(0);
    expect(partial[1]).toBeLessThan(200);
    const swap = replaceColor(source, { from: { r: 255, g: 255, b: 255, a: 1 }, to: { r: 0, g: 0, b: 0, a: 1 }, tolerance: 0, feather: 0, swap: true });
    expect(pixel(swap.pixels, 4, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(swap.pixels, 4, 3, 0)).toEqual([255, 255, 255, 255]);
  });

  it('fades alpha evenly, along a line and from a point', () => {
    const opaque = image(10, 10, () => [0, 0, 0, 255]);
    expect(pixel(fadeAlpha(opaque, 10, 10, { kind: 'solid', from: 50, to: 0, angle: 0, centerX: 50, centerY: 50, start: 0, end: 100 }), 10, 3, 3)[3]).toBe(128);
    const down = fadeAlpha(opaque, 10, 10, { kind: 'linear', from: 100, to: 0, angle: 180, centerX: 50, centerY: 50, start: 0, end: 100 });
    expect(pixel(down, 10, 5, 0)[3]).toBeGreaterThan(230);
    expect(pixel(down, 10, 5, 9)[3]).toBeLessThan(25);
    const ring = fadeAlpha(opaque, 10, 10, { kind: 'radial', from: 100, to: 0, angle: 0, centerX: 50, centerY: 50, start: 0, end: 100 });
    expect(pixel(ring, 10, 5, 5)[3]).toBeGreaterThan(pixel(ring, 10, 0, 0)[3] as number);
  });

  it('extracts dominant colours', () => {
    const halves = image(10, 10, (x) => (x < 7 ? [200, 30, 30, 255] : [20, 20, 220, 255]));
    const palette = extractPalette(halves, 4);
    expect(palette[0]).toMatchObject({ r: 200, g: 30, b: 30 });
    expect(palette[0]?.share).toBeCloseTo(0.7);
    expect(palette.some((colour) => colour.b === 220)).toBe(true);
    expect(
      extractPalette(
        image(2, 2, () => [0, 0, 0, 0]),
        4,
      ),
    ).toEqual([]);
  });
});

/** A minimal valid RGBA PNG, so the ICO test does not depend on a canvas. */
function png(size: number, rgba: Uint8Array): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, size);
  hv.setUint32(4, size);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const total = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    total.set(part, offset);
    offset += part.length;
  }
  return total;
}

describe('ICO files', () => {
  const icon = (size: number) => {
    const rgba = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) rgba.set(i % 3 === 0 ? [0, 0, 0, 0] : [23, 105, 78, 255], i * 4);
    return { size, rgba, png: png(size, rgba) };
  };

  it('writes a directory with BMP and PNG entries and reads it back', () => {
    const bytes = encodeIco([icon(32), icon(16), icon(256)]);
    expect(Array.from(bytes.slice(0, 6))).toEqual([0, 0, 1, 0, 3, 0]);
    const entries = parseIco(bytes);
    expect(entries.map((entry) => [entry.width, entry.png])).toEqual([
      [16, false],
      [32, false],
      [256, true],
    ]);
    const bmp = new DataView(entries[0]?.data.buffer as ArrayBuffer, entries[0]?.data.byteOffset);
    expect(bmp.getInt32(4, true)).toBe(16);
    expect(bmp.getInt32(8, true)).toBe(32);
    expect(bmp.getUint16(14, true)).toBe(32);
    expect(parseIco(encodeIco([icon(16)], { pngOnly: true }))[0]?.png).toBe(true);
  });

  it('rejects bad input', () => {
    expect(() => encodeIco([])).toThrow(/at least one/);
    expect(() => encodeIco([{ size: 300, rgba: new Uint8Array(300 * 300 * 4), png: new Uint8Array() }])).toThrow(/between 1 and 256/);
    expect(() => parseIco(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow(/not an .ico/);
  });

  let pillow = false;
  try {
    execFileSync('python3', ['-I', '-c', 'import PIL'], { stdio: 'ignore' });
    pillow = true;
  } catch {
    pillow = false;
  }

  it.runIf(pillow)('produces files that Pillow decodes with the right pixels', () => {
    const dir = mkdtempSync(join(tmpdir(), 'benchtop-ico-'));
    const path = join(dir, 'test.ico');
    writeFileSync(path, encodeIco([icon(16), icon(48), icon(256)]));
    const script = [
      'import sys',
      'from PIL import Image',
      'im = Image.open(sys.argv[1])',
      'sizes = sorted(im.info["sizes"])',
      'out = []',
      'for s in sizes:',
      '    im.size = s',
      '    im.load()',
      '    rgba = im.convert("RGBA")',
      '    out.append("%dx%d:%s:%s" % (s[0], s[1], rgba.getpixel((0, 0)), rgba.getpixel((1, 0))))',
      'print(";".join(out))',
    ].join('\n');
    const result = execFileSync('python3', ['-I', '-c', script, path], { encoding: 'utf8' }).trim();
    expect(result).toBe('16x16:(0, 0, 0, 0):(23, 105, 78, 255);48x48:(0, 0, 0, 0):(23, 105, 78, 255);256x256:(0, 0, 0, 0):(23, 105, 78, 255)');
  });
});

describe('visual generators', () => {
  it('writes standard CSS values', () => {
    expect(
      gradientCss({
        type: 'linear',
        angle: 90,
        shape: 'ellipse',
        x: 50,
        y: 50,
        repeating: false,
        space: 'srgb',
        stops: [
          { color: '#ff0000', position: 100 },
          { color: 'blue', position: 0 },
        ],
      }),
    ).toBe('linear-gradient(90deg, #0000ff 0%, #ff0000 100%)');
    expect(
      gradientCss({
        type: 'radial',
        angle: 0,
        shape: 'circle',
        x: 25,
        y: 75,
        repeating: true,
        space: 'oklch',
        stops: [
          { color: '#000', position: 0 },
          { color: '#fff', position: 10 },
        ],
      }),
    ).toBe('repeating-radial-gradient(circle at 25% 75% in oklch, #000000 0%, #ffffff 10%)');
    expect(
      gradientCss({
        type: 'conic',
        angle: 45,
        shape: 'ellipse',
        x: 50,
        y: 50,
        repeating: false,
        space: 'srgb',
        stops: [
          { color: '#000', position: 0 },
          { color: '#00000080', position: 100 },
        ],
      }),
    ).toBe('conic-gradient(from 45deg at 50% 50%, #000000 0%, rgb(0 0 0 / 0.502) 100%)');
    expect(
      shadowValue([
        { x: 0, y: 4, blur: 8, spread: -2, color: '#0000001a', inset: false },
        { x: 1, y: 1, blur: 0, spread: 0, color: '#fff', inset: true },
      ]),
    ).toBe('0 4px 8px -2px rgb(0 0 0 / 0.102), inset 1px 1px 0 0 #ffffff');
    expect(radiusValue({ mode: 'corners', unit: 'px', tl: 4, tr: 8, br: 4, bl: 8 })).toBe('4px 8px');
    expect(radiusValue({ mode: 'simple', unit: '%', all: 50 })).toBe('50%');
    expect(radiusValue({ mode: 'blob', h1: 30, h3: 60, v1: 40, v2: 70 })).toBe('30% 70% 60% 40% / 40% 70% 30% 60%');
    expect(transformList({ translateX: 10, translateY: 0, rotate: 45, scaleX: 2, scaleY: 2, skewX: 0, skewY: 0 })).toBe('translate(10px, 0) rotate(45deg) scale(2)');
    expect(transformList({ translateX: 0, translateY: 0, rotate: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 })).toBe('none');
    expect(
      filterList({ blur: 2, brightness: 120, contrast: 100, saturate: 100, grayscale: 0, sepia: 30, hue: 0, invert: 0, opacity: 100, shadow: false, shadowColor: '#000', shadowBlur: 0, shadowY: 0 }),
    ).toEqual({ css: 'blur(2px) brightness(120%) sepia(30%)', tailwind: ['blur-[2px]', 'brightness-[1.2]', 'sepia-[30%]'] });
  });

  it('validates grid areas', () => {
    expect(parseAreas('a a b\nc c b').names).toEqual(['a', 'b', 'c']);
    expect(() => parseAreas('a a\nb')).toThrow(/Row 2 has 1 cells/);
    expect(() => parseAreas('a b\nb a')).toThrow(/not a rectangle/);
    expect(() => parseAreas('a 1x')).toThrow(/not a valid area name/);
    expect(parseAreas('". hdr"\n". main"').names).toEqual(['hdr', 'main']);
  });

  const visuals = TOOLS.filter((tool) => tool.kind === 'visual');

  it('has a module for every visual tool in the registry', () => {
    expect(visuals.length).toBeGreaterThanOrEqual(19);
  });

  for (const entry of visuals) {
    it(`renders "${entry.name}" with its defaults, presets and random values`, async () => {
      const spec = (await entry.load()).default as VisualToolSpec;
      expect(spec.kind).toBe('visual');
      const defaults = defaultsOf(spec.controls);
      const variants = [defaults, ...(spec.presets ?? []).map((preset) => ({ ...defaults, ...preset.values }))];
      if (spec.randomize) variants.push({ ...defaults, ...spec.randomize(defaults as never) });
      for (const values of variants) {
        const result = spec.render(values as never);
        expect(result.outputs.length).toBeGreaterThan(0);
        for (const output of result.outputs) {
          expect(output.code.trim().length).toBeGreaterThan(0);
          expect(output.code).not.toMatch(/undefined|NaN|\[object Object\]/);
        }
      }
    });
  }
});
