import { describe, expect, it } from 'vitest';
import { blend, distanceForAngle, footLamberts, lensHeightRange, nativeImageFor, parseAspect, pixelAcuityDistance, sizeFrom } from '../../src/lib/projection';
import blendTool from '../../src/tools/text/projector-blend';
import projector from '../../src/tools/text/projector-calculator';
import screenSize from '../../src/tools/text/screen-size';
import { field, run } from './helpers';

describe('projection geometry', () => {
  it('sizes a 100-inch 16:9 screen', () => {
    const size = sizeFrom('diagonal', 2.54, 16 / 9);
    expect(size.width).toBeCloseTo(2.2138, 3);
    expect(size.height).toBeCloseTo(1.2453, 3);
  });

  it('parses aspect ratios', () => {
    expect(parseAspect('16:9')).toBeCloseTo(1.7778, 4);
    expect(parseAspect('2.39:1')).toBeCloseTo(2.39);
    expect(parseAspect('1.85')).toBeCloseTo(1.85);
    expect(Number.isNaN(parseAspect('wide'))).toBe(true);
  });

  it('fits a scope screen with the projector width and a 4:3 screen with its height', () => {
    const scope = sizeFrom('width', 3, 2.39);
    expect(nativeImageFor(scope, 2.39, 16 / 9).width).toBeCloseTo(3);
    const square = sizeFrom('height', 1.5, 4 / 3);
    expect(nativeImageFor(square, 4 / 3, 16 / 9).height).toBeCloseTo(1.5);
  });

  it('places the lens for shift and fixed offset', () => {
    expect(lensHeightRange(1, 0, 0, 0)).toEqual({ min: 0.5, max: 0.5 });
    expect(lensHeightRange(1, 0, 0, 50)).toEqual({ min: 0, max: 0 });
    const shift = lensHeightRange(1, 60, 60, 0);
    expect(shift.min).toBeCloseTo(-0.1);
    expect(shift.max).toBeCloseTo(1.1);
  });

  it('computes luminance, viewing angles and pixel acuity', () => {
    const area = sizeFrom('diagonal', 2.54, 16 / 9);
    expect(footLamberts(2000, area.width * area.height, 1)).toBeCloseTo(67.4, 1);
    expect(distanceForAngle(2, 30)).toBeCloseTo(3.732, 3);
    expect(pixelAcuityDistance(1.08, 1080)).toBeCloseTo(3.438, 2);
  });

  it('adds up an edge-blended canvas', () => {
    const result = blend({ columns: 3, rows: 1, overlapX: 0.15, overlapY: 0, pixelsX: 1920, pixelsY: 1200 });
    expect(result.canvasPixelsX).toBe(3 * 1920 - 2 * 288);
    expect(result.canvasPixelsY).toBe(1200);
  });
});

describe('projection tools', () => {
  it('reports throw range, fit, brightness and seating', async () => {
    const result = await run(projector, '', { unit: 'm', size: 2.54, throwMin: 1.36, throwMax: 2.18, distance: 3.5 });
    expect(field(result, 'Range')).toMatch(/^3\.01 m .* to 4\.83 m/);
    expect(field(result, 'At your distance')).toMatch(/^Fits/);
    expect(field(result, 'Luminance')).toMatch(/fL/);
    expect(result.preview?.kind).toBe('svg');
    const far = await run(projector, '', { unit: 'm', size: 2.54, distance: 9 });
    expect(field(far, 'At your distance')).toMatch(/^Does not fit/);
  });

  it('compares screen shapes at constant height', async () => {
    const result = await run(screenSize, '', { unit: 'in', size: 100, keep: 'height' });
    expect(field(result, 'Width')).toMatch(/^87\.2 in/);
    expect(field(result, '2.39:1')).toMatch(/^127″ diagonal, 117.2 in/);
  });

  it('plans a blend', async () => {
    const result = await run(blendTool, '', { columns: 3, rows: 1, resolution: '1920x1200', overlapX: 15 });
    expect(field(result, 'Resolution')).toBe('5184 × 1200 px');
  });
});
