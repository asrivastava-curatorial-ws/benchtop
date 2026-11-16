/** Fluid mechanics helpers for the mechanical and HVAC calculators (SI units). */

export const G = 9.80665;
export const P_ATM = 101325;

/** Water density (kg/m³) and dynamic viscosity (Pa·s) by temperature, interpolated from standard tables. */
const WATER: readonly [number, number, number][] = [
  [0, 999.8, 1.792e-3],
  [10, 999.7, 1.307e-3],
  [20, 998.2, 1.002e-3],
  [30, 995.7, 0.798e-3],
  [40, 992.2, 0.653e-3],
  [50, 988.0, 0.547e-3],
  [60, 983.2, 0.467e-3],
  [70, 977.8, 0.404e-3],
  [80, 971.8, 0.355e-3],
  [90, 965.3, 0.315e-3],
  [100, 958.4, 0.282e-3],
];

export function water(celsius: number): { density: number; viscosity: number } {
  const t = Math.min(100, Math.max(0, celsius));
  const index = Math.min(WATER.length - 2, Math.floor(t / 10));
  const [t0, d0, v0] = WATER[index] as [number, number, number];
  const [t1, d1, v1] = WATER[index + 1] as [number, number, number];
  const f = (t - t0) / (t1 - t0);
  return { density: d0 + (d1 - d0) * f, viscosity: v0 + (v1 - v0) * f };
}

/** Water vapour pressure (Pa) from the Antoine equation, 1–100 °C. */
export const waterVapourPressure = (celsius: number): number => 133.322 * 10 ** (8.07131 - 1730.63 / (233.426 + celsius));

/** Darcy friction factor: 64/Re when laminar, Swamee–Jain otherwise. */
export function frictionFactor(reynolds: number, roughness: number, diameter: number): number {
  if (reynolds < 2300) return 64 / Math.max(reynolds, 1e-9);
  return 0.25 / Math.log10(roughness / (3.7 * diameter) + 5.74 / reynolds ** 0.9) ** 2;
}

/** Absolute roughness in metres for common pipe materials. */
export const ROUGHNESS: Record<string, { label: string; metres: number }> = {
  pvc: { label: 'PVC, CPVC, HDPE', metres: 0.0015e-3 },
  copper: { label: 'Copper, stainless', metres: 0.0015e-3 },
  steel: { label: 'Commercial steel', metres: 0.045e-3 },
  galvanised: { label: 'Galvanised iron', metres: 0.15e-3 },
  cast: { label: 'Cast iron', metres: 0.26e-3 },
  ductile: { label: 'Ductile iron, cement lined', metres: 0.03e-3 },
  concrete: { label: 'Concrete', metres: 1e-3 },
  duct: { label: 'Galvanised sheet duct', metres: 0.09e-3 },
};

export interface PipeFlow {
  readonly velocity: number;
  readonly reynolds: number;
  readonly friction: number;
  /** Pressure drop in Pa. */
  readonly pressureDrop: number;
  /** Head loss in metres of the fluid. */
  readonly headLoss: number;
}

/** Darcy–Weisbach for a circular pipe: flow m³/s, diameter and length m, minor loss coefficients summed in `k`. */
export function pipeFlow(flow: number, diameter: number, length: number, density: number, viscosity: number, roughness: number, k = 0): PipeFlow {
  const area = (Math.PI * diameter * diameter) / 4;
  const velocity = flow / area;
  const reynolds = (density * velocity * diameter) / viscosity;
  const friction = frictionFactor(reynolds, roughness, diameter);
  const dynamic = (density * velocity * velocity) / 2;
  const pressureDrop = (friction * (length / diameter) + k) * dynamic;
  return { velocity, reynolds, friction, pressureDrop, headLoss: pressureDrop / (density * G) };
}

/** Saturation vapour pressure over water (Pa), Magnus form (Sonntag 1990 constants). */
export const saturationPressure = (celsius: number): number => 611.2 * Math.exp((17.62 * celsius) / (243.12 + celsius));

/** Dew point (°C) from partial vapour pressure in Pa, inverse Magnus. */
export function dewPointFromPressure(pv: number): number {
  const gamma = Math.log(pv / 611.2);
  return (243.12 * gamma) / (17.62 - gamma);
}
