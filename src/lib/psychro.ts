/**
 * Moist-air properties after the ASHRAE Handbook — Fundamentals (2017), chapter 1.
 * Temperatures in °C, pressures in Pa, humidity ratio in kg water per kg dry air.
 */

/** Standard atmospheric pressure at an altitude in metres (ASHRAE eq. 3). */
export const pressureAtAltitude = (metres: number): number => 101325 * (1 - 2.25577e-5 * metres) ** 5.2559;

/** Saturation pressure over ice (below 0 °C) or liquid water (Hyland–Wexler, ASHRAE eqs. 5 and 6). */
export function saturationPressure(celsius: number): number {
  const t = celsius + 273.15;
  if (celsius < 0) {
    return Math.exp(-5.6745359e3 / t + 6.3925247 - 9.677843e-3 * t + 6.2215701e-7 * t ** 2 + 2.0747825e-9 * t ** 3 - 9.484024e-13 * t ** 4 + 4.1635019 * Math.log(t));
  }
  return Math.exp(-5.8002206e3 / t + 1.3914993 - 4.8640239e-2 * t + 4.1764768e-5 * t ** 2 - 1.4452093e-8 * t ** 3 + 6.5459673 * Math.log(t));
}

export const humidityRatioFromPressure = (pw: number, p: number): number => (0.621945 * pw) / (p - pw);
export const vapourPressureFromRatio = (w: number, p: number): number => (p * w) / (0.621945 + w);

/** Moist-air enthalpy, kJ per kg dry air (ASHRAE eq. 32). */
export const enthalpy = (t: number, w: number): number => 1.006 * t + w * (2501 + 1.86 * t);

/** Dry-bulb temperature from enthalpy and humidity ratio. */
export const temperatureFromEnthalpy = (h: number, w: number): number => (h - 2501 * w) / (1.006 + 1.86 * w);

/** Specific volume, m³ per kg dry air (ASHRAE eq. 26). */
export const specificVolume = (t: number, w: number, p: number): number => (0.287042 * (t + 273.15) * (1 + 1.607858 * w)) / (p / 1000);

function bisect(f: (x: number) => number, low: number, high: number, iterations = 80): number {
  let a = low;
  let b = high;
  let fa = f(a);
  for (let i = 0; i < iterations; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = mid;
      fa = fm;
    } else {
      b = mid;
    }
  }
  return (a + b) / 2;
}

/** Dew (or frost) point for a water vapour partial pressure. */
export function dewPoint(pw: number): number {
  if (!(pw > 0)) return Number.NaN;
  return bisect((t) => saturationPressure(t) - pw, -100, 200);
}

/** Humidity ratio from dry bulb and wet bulb (ASHRAE eqs. 33 and 35). */
export function humidityRatioFromWetBulb(t: number, twb: number, p: number): number {
  const ws = humidityRatioFromPressure(saturationPressure(twb), p);
  if (twb >= 0) return ((2501 - 2.326 * twb) * ws - 1.006 * (t - twb)) / (2501 + 1.86 * t - 4.186 * twb);
  return ((2830 - 0.24 * twb) * ws - 1.006 * (t - twb)) / (2830 + 1.86 * t - 2.1 * twb);
}

/** Thermodynamic wet bulb for a dry bulb and humidity ratio. */
export function wetBulb(t: number, w: number, p: number): number {
  const low = Math.min(t, dewPoint(vapourPressureFromRatio(w, p))) - 1;
  return bisect((twb) => humidityRatioFromWetBulb(t, twb, p) - w, Math.max(-100, low), t);
}

export interface AirState {
  readonly dryBulb: number;
  readonly humidityRatio: number;
  readonly relativeHumidity: number;
  readonly dewPoint: number;
  readonly wetBulb: number;
  readonly enthalpy: number;
  readonly specificVolume: number;
  /** Moist-air density, kg/m³. */
  readonly density: number;
  readonly vapourPressure: number;
  readonly saturationPressure: number;
  /** Water vapour per volume, g/m³. */
  readonly absoluteHumidity: number;
}

export function airState(t: number, w: number, p: number): AirState {
  const pw = vapourPressureFromRatio(w, p);
  const pws = saturationPressure(t);
  const v = specificVolume(t, w, p);
  return {
    dryBulb: t,
    humidityRatio: w,
    relativeHumidity: (pw / pws) * 100,
    dewPoint: dewPoint(pw),
    wetBulb: wetBulb(t, w, p),
    enthalpy: enthalpy(t, w),
    specificVolume: v,
    density: (1 + w) / v,
    vapourPressure: pw,
    saturationPressure: pws,
    absoluteHumidity: (w / v) * 1000,
  };
}

/** Humidity ratio from dry bulb and relative humidity (%). */
export const humidityRatioFromRh = (t: number, rh: number, p: number): number => humidityRatioFromPressure((saturationPressure(t) * rh) / 100, p);

/** Adiabatic mixing of two streams by dry-air mass fraction of the second stream. */
export function mix(t1: number, w1: number, t2: number, w2: number, fraction2: number): { t: number; w: number } {
  const w = w1 * (1 - fraction2) + w2 * fraction2;
  const h = enthalpy(t1, w1) * (1 - fraction2) + enthalpy(t2, w2) * fraction2;
  return { t: temperatureFromEnthalpy(h, w), w };
}
