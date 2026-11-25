import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeHeif, isHeif } from '../../src/lib/heic';

// A 64 × 48 frame of FFmpeg's testsrc2 pattern, encoded with x265 and wrapped in a minimal HEIF container.
const tiny = new Uint8Array(readFileSync(new URL('../fixtures/tiny.heic', import.meta.url)));

describe('HEIC pictures', () => {
  it('recognises HEIF files by their brands', () => {
    expect(isHeif(tiny)).toBe(true);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    expect(isHeif(png)).toBe(false);
    const mp4 = new Uint8Array([0, 0, 0, 24, ...[...'ftypisom'].map((c) => c.charCodeAt(0)), 0, 0, 2, 0, ...[...'isomiso2'].map((c) => c.charCodeAt(0))]);
    expect(isHeif(mp4)).toBe(false);
  });

  it('decodes the main picture', async () => {
    const picture = await decodeHeif(tiny);
    expect([picture.width, picture.height]).toEqual([64, 48]);
    const at = (x: number, y: number) => [...picture.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
    // Colours of the pattern (from the PNG the frame was encoded from), give or take the compression.
    for (const [x, y, rgb] of [
      [5, 5, [30, 0, 62]],
      [40, 30, [0, 0, 62]],
      [60, 40, [0, 255, 255]],
    ] as const) {
      const [r, g, b, a] = at(x, y);
      expect(Math.abs((r ?? 0) - rgb[0]) + Math.abs((g ?? 0) - rgb[1]) + Math.abs((b ?? 0) - rgb[2])).toBeLessThan(90);
      expect(a).toBe(255);
    }
    await expect(decodeHeif(new Uint8Array(64))).rejects.toThrow();
  });
});
