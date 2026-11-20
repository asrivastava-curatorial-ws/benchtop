import { describe, expect, it } from 'vitest';
import { AWG, awgDiameter, CONDUCTORS, findSize, METRIC, massPerKm, nearest, resistancePerKm, SWG } from '../../src/lib/wire-gauge';

const copper = CONDUCTORS[0] as (typeof CONDUCTORS)[number];

describe('wire gauges', () => {
  it('follows the AWG definition', () => {
    expect(awgDiameter(36)).toBeCloseTo(0.127, 12);
    expect(awgDiameter(-3)).toBeCloseTo(0.46 * 25.4, 10);
    expect(awgDiameter(12)).toBeCloseTo(2.0525, 3);
    expect(AWG).toHaveLength(44);
    expect(AWG[0]?.name).toBe('4/0');
    expect(AWG[3]?.name).toBe('1/0');
  });

  it('has the BS 3737 SWG table', () => {
    expect(SWG).toHaveLength(57);
    expect(findSize('swg', '18')?.diameter).toBeCloseTo(1.2192, 9);
    expect(findSize('swg', '7/0')?.diameter).toBeCloseTo(12.7, 9);
    expect(findSize('swg', '50')?.diameter).toBeCloseTo(0.0254, 9);
  });

  it('reads sizes as people write them', () => {
    expect(findSize('awg', 'AWG 12')?.name).toBe('12');
    expect(findSize('awg', '0000')?.name).toBe('4/0');
    expect(findSize('awg', '0')?.name).toBe('1/0');
    expect(findSize('metric', '2.5 mm²')?.area).toBe(2.5);
    expect(findSize('metric', '3')).toBeNull();
  });

  it('gives resistance, mass and the closest sizes', () => {
    const awg12 = findSize('awg', '12');
    expect(resistancePerKm(awg12?.area ?? 0, copper)).toBeCloseTo(5.211, 2);
    expect(resistancePerKm(2.5, copper, 70)).toBeCloseTo((1000 / 58 / 2.5) * (1 + 0.00393 * 50), 9);
    expect(massPerKm(1, copper)).toBeCloseTo(8.89, 9);
    expect(nearest('metric', awg12?.area ?? 0).closest.name).toBe('4 mm²');
    expect(nearest('awg', 2.5).closest.name).toBe('13');
    expect(nearest('awg', 2.5).larger?.name).toBe('13');
    expect(METRIC.every((m, i) => i === 0 || m.area > (METRIC[i - 1]?.area ?? 0))).toBe(true);
  });
});
