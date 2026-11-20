/**
 * Wire sizes: American Wire Gauge (by its defining formula), the British
 * Standard Wire Gauge (BS 3737:1964 table) and IEC 60228 metric sizes,
 * with resistance and mass of solid round copper or aluminium conductors.
 */

export type GaugeSystem = 'awg' | 'swg' | 'metric';

export interface WireSize {
  readonly system: GaugeSystem;
  /** "4/0", "12", "2.5 mm²". */
  readonly name: string;
  /** Sort key: AWG and SWG numbers (4/0 = −3), metric area. */
  readonly order: number;
  /** Diameter of a solid round conductor, mm. */
  readonly diameter: number;
  /** Cross-section, mm². */
  readonly area: number;
}

const INCH = 25.4;

/** AWG n (4/0 = −3 … 40): d = 0.005 in × 92^((36 − n) / 39). */
export function awgDiameter(n: number): number {
  return 0.005 * 92 ** ((36 - n) / 39) * INCH;
}

const awgName = (n: number) => (n <= 0 ? `${1 - n}/0` : String(n));

export const AWG: readonly WireSize[] = Array.from({ length: 44 }, (_, i) => {
  const n = i - 3;
  const diameter = awgDiameter(n);
  return { system: 'awg', name: awgName(n), order: n, diameter, area: (Math.PI * diameter * diameter) / 4 };
});

/** BS 3737:1964 diameters in inches, from 7/0 to 50. */
const SWG_INCHES: readonly (readonly [string, number])[] = [
  ['7/0', 0.5],
  ['6/0', 0.464],
  ['5/0', 0.432],
  ['4/0', 0.4],
  ['3/0', 0.372],
  ['2/0', 0.348],
  ['1/0', 0.324],
  ['1', 0.3],
  ['2', 0.276],
  ['3', 0.252],
  ['4', 0.232],
  ['5', 0.212],
  ['6', 0.192],
  ['7', 0.176],
  ['8', 0.16],
  ['9', 0.144],
  ['10', 0.128],
  ['11', 0.116],
  ['12', 0.104],
  ['13', 0.092],
  ['14', 0.08],
  ['15', 0.072],
  ['16', 0.064],
  ['17', 0.056],
  ['18', 0.048],
  ['19', 0.04],
  ['20', 0.036],
  ['21', 0.032],
  ['22', 0.028],
  ['23', 0.024],
  ['24', 0.022],
  ['25', 0.02],
  ['26', 0.018],
  ['27', 0.0164],
  ['28', 0.0148],
  ['29', 0.0136],
  ['30', 0.0124],
  ['31', 0.0116],
  ['32', 0.0108],
  ['33', 0.01],
  ['34', 0.0092],
  ['35', 0.0084],
  ['36', 0.0076],
  ['37', 0.0068],
  ['38', 0.006],
  ['39', 0.0052],
  ['40', 0.0048],
  ['41', 0.0044],
  ['42', 0.004],
  ['43', 0.0036],
  ['44', 0.0032],
  ['45', 0.0028],
  ['46', 0.0024],
  ['47', 0.002],
  ['48', 0.0016],
  ['49', 0.0012],
  ['50', 0.001],
];

export const SWG: readonly WireSize[] = SWG_INCHES.map(([name, inches], i) => {
  const diameter = inches * INCH;
  return { system: 'swg', name, order: i - 6, diameter, area: (Math.PI * diameter * diameter) / 4 };
});

/** IEC 60228 nominal cross-sections, mm². */
const METRIC_AREAS = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000] as const;

export const METRIC: readonly WireSize[] = METRIC_AREAS.map((area) => ({ system: 'metric', name: `${area} mm²`, order: area, diameter: Math.sqrt((4 * area) / Math.PI), area }));

export const SIZES: Readonly<Record<GaugeSystem, readonly WireSize[]>> = { awg: AWG, swg: SWG, metric: METRIC };

export interface Conductor {
  readonly id: string;
  readonly name: string;
  /** Resistivity at 20 °C, Ω·mm²/m. */
  readonly resistivity: number;
  /** Temperature coefficient of resistance at 20 °C, 1/K. */
  readonly alpha: number;
  /** kg/m³ */
  readonly density: number;
}

export const CONDUCTORS: readonly Conductor[] = [
  { id: 'copper', name: 'Copper (annealed, IACS)', resistivity: 1 / 58, alpha: 0.00393, density: 8890 },
  { id: 'tinned', name: 'Tinned copper', resistivity: 0.01759, alpha: 0.00393, density: 8890 },
  { id: 'aluminium', name: 'Aluminium (EC grade)', resistivity: 0.028264, alpha: 0.00403, density: 2703 },
  { id: 'steel', name: 'Galvanised steel', resistivity: 0.138, alpha: 0.0045, density: 7850 },
];

/** Ω per km of a solid round conductor of this area (mm²) at a temperature (°C). */
export const resistancePerKm = (area: number, conductor: Conductor, celsius = 20) => ((conductor.resistivity * 1000) / area) * (1 + conductor.alpha * (celsius - 20));

/** kg per km. */
export const massPerKm = (area: number, conductor: Conductor) => area * conductor.density * 1e-3;

/** The size in each system closest by cross-section (on a log scale), with the next larger one. */
export function nearest(system: GaugeSystem, area: number): { readonly closest: WireSize; readonly larger: WireSize | null } {
  const sizes = SIZES[system];
  let closest = sizes[0] as WireSize;
  for (const size of sizes) if (Math.abs(Math.log(size.area / area)) < Math.abs(Math.log(closest.area / area))) closest = size;
  const larger = [...sizes].sort((a, b) => a.area - b.area).find((s) => s.area >= area * (1 - 1e-9)) ?? null;
  return { closest, larger };
}

/** Reads "12", "AWG 12", "4/0", "0000", "2.5", "18 swg". */
export function findSize(system: GaugeSystem, text: string): WireSize | null {
  const cleaned = text
    .toLowerCase()
    .replace(/awg|swg|mm²|mm2|sq\.?\s*mm|gauge|ga\b|#/g, '')
    .trim();
  if (!cleaned) return null;
  if (system === 'metric') {
    const area = Number(cleaned);
    return METRIC.find((s) => Math.abs(s.area - area) < 1e-9) ?? null;
  }
  const zeros = /^0+$/.test(cleaned) && cleaned.length > 1 ? `${cleaned.length}/0` : cleaned === '0' ? '1/0' : cleaned;
  return SIZES[system].find((s) => s.name === zeros) ?? null;
}
