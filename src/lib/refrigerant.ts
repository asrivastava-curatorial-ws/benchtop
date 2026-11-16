/** Saturation pressure and temperature lookups for the refrigerant curves in src/data/refrigerants.ts. */
import { type Ancillary, REFRIGERANTS, type Refrigerant } from '../data/refrigerants';

export { REFRIGERANTS, type Refrigerant };

/** Saturation pressure (Pa) at a temperature in kelvin. */
export function ancillaryPressure(a: Ancillary, kelvin: number): number {
  const theta = 1 - kelvin / a.tr;
  let sum = 0;
  for (let i = 0; i < a.n.length; i++) sum += (a.n[i] as number) * theta ** (a.t[i] as number);
  return a.pr * Math.exp((a.tr / kelvin) * sum);
}

export const refrigerant = (id: string): Refrigerant => REFRIGERANTS.find((r) => r.id === id) ?? (REFRIGERANTS[0] as Refrigerant);

/** Bubble-point (liquid) and dew-point (vapour) pressures in Pa at a temperature in °C. */
export function saturationPressures(r: Refrigerant, celsius: number): { bubble: number; dew: number } | undefined {
  const k = celsius + 273.15;
  if (k < r.tmin || k > r.tc) return undefined;
  const bubble = ancillaryPressure(r.bubble, Math.min(k, r.tc - 1e-6));
  return { bubble, dew: r.dew ? ancillaryPressure(r.dew, Math.min(k, r.tc - 1e-6)) : bubble };
}

/** Saturation temperature (°C) for an absolute pressure in Pa on the bubble or dew curve; undefined outside the curve. */
export function saturationTemperature(r: Refrigerant, pa: number, curve: 'bubble' | 'dew'): number | undefined {
  const a = curve === 'dew' && r.dew ? r.dew : r.bubble;
  const top = r.tc - 1e-6;
  if (!(pa > 0) || pa > ancillaryPressure(a, top) || pa < ancillaryPressure(a, r.tmin)) return undefined;
  let low = r.tmin;
  let high = top;
  const target = Math.log(pa);
  for (let i = 0; i < 70; i++) {
    const mid = (low + high) / 2;
    if (Math.log(ancillaryPressure(a, mid)) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2 - 273.15;
}

/** Pressure units for gauges, as Pa per unit. */
export const PRESSURE_UNITS: Record<string, { label: string; pa: number }> = {
  bar: { label: 'bar', pa: 1e5 },
  psi: { label: 'psi', pa: 6894.757 },
  kpa: { label: 'kPa', pa: 1e3 },
  mpa: { label: 'MPa', pa: 1e6 },
};
