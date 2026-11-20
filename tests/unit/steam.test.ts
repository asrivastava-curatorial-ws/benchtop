import { describe, expect, it } from 'vitest';
import {
  b23Pressure,
  b23Temperature,
  conductivity,
  mixture,
  region1,
  region2,
  region3,
  region5,
  saturationAtP,
  saturationAtT,
  saturationPressure,
  saturationTemperature,
  statePH,
  statePS,
  stateTP,
  surfaceTension,
  viscosity,
} from '../../src/lib/steam/if97';

/** Relative agreement to the 9 significant digits the release prints. */
const near = (actual: number, expected: number, digits = 8) => expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(10 ** -digits);

describe('IAPWS-IF97 verification values (R7-97(2012))', () => {
  it('region 1 (Table 5)', () => {
    const rows = [
      [3, 300, 0.100215168e-2, 0.115331273e3, 0.112324818e3, 0.392294792, 0.417301218e1, 0.150773921e4],
      [80, 300, 0.971180894e-3, 0.184142828e3, 0.106448356e3, 0.368563852, 0.401008987e1, 0.163469054e4],
      [3, 500, 0.1202418e-2, 0.975542239e3, 0.971934985e3, 0.258041912e1, 0.465580682e1, 0.124071337e4],
    ] as const;
    for (const [p, T, v, h, u, s, cp, w] of rows) {
      const state = region1(p, T);
      near(state.v, v, 7);
      near(state.h, h);
      near(state.u, u);
      near(state.s, s);
      near(state.cp, cp);
      near(state.w, w);
    }
  });

  it('region 2 (Table 15)', () => {
    const rows = [
      [0.0035, 300, 0.394913866e2, 0.254991145e4, 0.24116916e4, 0.852238967e1, 0.191300162e1, 0.427920172e3],
      [0.0035, 700, 0.923015898e2, 0.333568375e4, 0.301262819e4, 0.101749996e2, 0.208141274e1, 0.644289068e3],
      [30, 700, 0.542946619e-2, 0.263149474e4, 0.246861076e4, 0.517540298e1, 0.103505092e2, 0.480386523e3],
    ] as const;
    for (const [p, T, v, h, u, s, cp, w] of rows) {
      const state = region2(p, T);
      near(state.v, v);
      near(state.h, h);
      near(state.u, u);
      near(state.s, s);
      near(state.cp, cp);
      near(state.w, w);
    }
  });

  it('region 3 (Table 33)', () => {
    const rows = [
      [500, 650, 0.255837018e2, 0.186343019e4, 0.181226279e4, 0.405427273e1, 0.138935717e2, 0.502005554e3],
      [200, 650, 0.222930643e2, 0.237512401e4, 0.226365868e4, 0.485438792e1, 0.446579342e2, 0.383444594e3],
      [500, 750, 0.783095639e2, 0.225868845e4, 0.210206932e4, 0.446971906e1, 0.634165359e1, 0.760696041e3],
    ] as const;
    for (const [rho, T, p, h, u, s, cp, w] of rows) {
      const state = region3(rho, T);
      near(state.p, p);
      near(state.h, h);
      near(state.u, u);
      near(state.s, s);
      near(state.cp, cp);
      near(state.w, w);
    }
  });

  it('region 4 and the region 2–3 boundary (Tables 35 and 36)', () => {
    near(saturationPressure(300), 0.353658941e-2);
    near(saturationPressure(500), 0.263889776e1);
    near(saturationPressure(600), 0.123443146e2);
    near(saturationTemperature(0.1), 0.372755919e3);
    near(saturationTemperature(1), 0.453035632e3);
    near(saturationTemperature(10), 0.584149488e3);
    near(b23Pressure(0.62315e3), 0.165291643e2);
    near(b23Temperature(0.165291643e2), 0.62315e3);
  });

  it('region 5 (Table 42)', () => {
    const rows = [
      [0.5, 1500, 0.13845509e1, 0.521976855e4, 0.45274931e4, 0.965408875e1, 0.261609445e1, 0.91706869e3],
      [30, 1500, 0.230761299e-1, 0.516723514e4, 0.447495124e4, 0.772970133e1, 0.272724317e1, 0.928548002e3],
      [30, 2000, 0.311385219e-1, 0.657122604e4, 0.563707038e4, 0.853640523e1, 0.288569882e1, 0.106736948e4],
    ] as const;
    for (const [p, T, v, h, u, s, cp, w] of rows) {
      const state = region5(p, T);
      near(state.v, v);
      near(state.h, h);
      near(state.u, u);
      near(state.s, s);
      near(state.cp, cp);
      near(state.w, w);
    }
  });
});

describe('states from pressure and temperature, enthalpy or entropy', () => {
  it('picks the region and solves region 3 for density', () => {
    expect(stateTP(0.101325, 373.15 - 1).region).toBe(1);
    expect(stateTP(0.101325, 373.15 + 1).region).toBe(2);
    expect(stateTP(25.583702, 650).region).toBe(3);
    near(stateTP(25.5837018, 650).rho, 500, 7);
    near(stateTP(22.2930643, 650).rho, 200, 6);
    near(stateTP(78.3095639, 750).rho, 500, 7);
    expect(stateTP(10, 1200).region).toBe(5);
    expect(() => stateTP(120, 400)).toThrow(RangeError);
    expect(() => stateTP(60, 1200)).toThrow(RangeError);
  });

  it('inverts enthalpy and entropy, including wet steam', () => {
    for (const [p, T] of [
      [3, 300],
      [0.0035, 700],
      [30, 700],
      [25.5837018, 650],
      [0.5, 1500],
      [20, 640],
    ] as const) {
      const state = stateTP(p, T);
      near(statePH(p, state.h).T, T, 9);
      near(statePS(p, state.s).T, T, 9);
    }
    const sat = saturationAtP(1);
    const wet = statePH(1, sat.liquid.h + 0.4 * (sat.vapour.h - sat.liquid.h));
    expect(wet.region).toBe(4);
    near(wet.x ?? 0, 0.4, 10);
    near(wet.T, 453.035632, 8);
    near(mixture(sat, 0.4).s, wet.s, 10);
  });

  it('gives saturated liquid and vapour, also near the critical point', () => {
    const boiling = saturationAtP(0.101325);
    near(boiling.T, 373.124, 5);
    near(boiling.liquid.h, 419.1, 3);
    near(boiling.vapour.h, 2675.6, 4);
    const hot = saturationAtT(640);
    expect(hot.liquid.region).toBe(3);
    expect(hot.liquid.rho).toBeGreaterThan(hot.vapour.rho);
    near(hot.liquid.p, hot.p, 9);
    near(hot.vapour.p, hot.p, 9);
  });
});

describe('transport properties', () => {
  it('viscosity matches IAPWS 2008 Table 4', () => {
    const rows = [
      [298.15, 998, 889.7351],
      [298.15, 1200, 1437.649467],
      [373.15, 1000, 307.883622],
      [433.15, 1, 14.538324],
      [433.15, 1000, 217.685358],
      [873.15, 1, 32.619287],
      [873.15, 100, 35.802262],
      [873.15, 600, 77.430195],
      [1173.15, 1, 44.217245],
      [1173.15, 100, 47.640433],
      [1173.15, 400, 64.154608],
    ] as const;
    for (const [T, rho, mu] of rows) near(viscosity(rho, T) * 1e6, mu, 7);
  });

  it('thermal conductivity and surface tension are close to reference values', () => {
    // Liquid water at 25 °C and 1 atm: about 0.6065 W/(m·K); steam at 1 bar and 200 °C: about 0.0334 W/(m·K).
    expect(conductivity(stateTP(0.101325, 298.15))).toBeCloseTo(0.6065, 3);
    expect(conductivity(stateTP(0.1, 473.15))).toBeCloseTo(0.0334, 3);
    // Surface tension: 71.97 mN/m at 25 °C, 58.91 mN/m at 100 °C.
    expect(surfaceTension(298.15) * 1000).toBeCloseTo(71.97, 2);
    expect(surfaceTension(373.15) * 1000).toBeCloseTo(58.91, 2);
  });
});
