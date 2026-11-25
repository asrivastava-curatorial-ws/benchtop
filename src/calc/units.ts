/**
 * Units for the calculator library.  Each dimension has a base unit; a unit
 * converts to the base by `value * factor + offset`, or by `factor / value`
 * for reciprocal units (fuel economy).
 */

export interface Unit {
  readonly id: string;
  readonly label: string;
  readonly factor: number;
  readonly offset?: number;
  readonly reciprocal?: boolean;
}

const u = (id: string, factor: number, label = id, offset?: number): Unit => ({ id, label, factor, offset });

export const DIMENSIONS = {
  none: [u('', 1)],
  ratio: [u('%', 0.01), u('×', 1, 'fraction'), u('‰', 0.001)],
  money: [u('money', 1, '')],
  count: [u('', 1)],
  length: [u('m', 1), u('km', 1000), u('cm', 0.01), u('mm', 0.001), u('µm', 1e-6), u('nm', 1e-9), u('in', 0.0254), u('ft', 0.3048), u('yd', 0.9144), u('mi', 1609.344), u('nmi', 1852)],
  area: [u('m²', 1), u('km²', 1e6), u('cm²', 1e-4), u('mm²', 1e-6), u('ha', 1e4), u('acre', 4046.8564224), u('ft²', 0.09290304), u('in²', 0.00064516), u('yd²', 0.83612736), u('mi²', 2589988.110336)],
  volume: [
    u('m³', 1),
    u('L', 1e-3),
    u('mL', 1e-6),
    u('cm³', 1e-6),
    u('gal', 3.785411784e-3, 'US gal'),
    u('impgal', 4.54609e-3, 'UK gal'),
    u('qt', 9.46352946e-4, 'US qt'),
    u('cup', 2.365882365e-4, 'US cup'),
    u('floz', 2.95735295625e-5, 'US fl oz'),
    u('tbsp', 1.478676478125e-5),
    u('tsp', 4.92892159375e-6),
    u('ft³', 0.028316846592),
    u('in³', 1.6387064e-5),
    u('yd³', 0.764554857984),
  ],
  mass: [u('kg', 1), u('g', 1e-3), u('mg', 1e-6), u('µg', 1e-9), u('t', 1000), u('quintal', 100), u('lb', 0.45359237), u('oz', 0.028349523125), u('st', 6.35029318)],
  time: [u('s', 1), u('ms', 1e-3), u('min', 60), u('h', 3600), u('d', 86400, 'days'), u('wk', 604800, 'weeks'), u('mo', 2629746, 'months'), u('yr', 31556952, 'years')],
  speed: [u('m/s', 1), u('km/h', 1 / 3.6), u('mph', 0.44704), u('kn', 1852 / 3600), u('ft/s', 0.3048), u('m/min', 1 / 60), u('mm/min', 1 / 60000)],
  pace: [u('s/m', 1), u('min/km', 0.06), u('min/mi', 60 / 1609.344), u('s/100m', 0.01)],
  acceleration: [u('m/s²', 1), u('g₀', 9.80665, 'g'), u('ft/s²', 0.3048)],
  force: [u('N', 1), u('kN', 1000), u('lbf', 4.4482216152605), u('kgf', 9.80665)],
  energy: [u('J', 1), u('kJ', 1000), u('MJ', 1e6), u('cal', 4.184), u('kcal', 4184), u('Wh', 3600), u('kWh', 3.6e6), u('BTU', 1055.05585262), u('eV', 1.602176634e-19)],
  power: [u('W', 1), u('mW', 1e-3), u('kW', 1000), u('MW', 1e6), u('hp', 745.69987158227), u('BTU/h', 0.29307107017)],
  pressure: [u('Pa', 1), u('kPa', 1000), u('MPa', 1e6), u('GPa', 1e9), u('bar', 1e5), u('mbar', 100), u('atm', 101325), u('psi', 6894.757293168), u('mmHg', 133.322387415), u('inHg', 3386.389)],
  temperature: [u('K', 1), u('°C', 1, '°C', 273.15), u('°F', 5 / 9, '°F', (459.67 * 5) / 9)],
  tempdiff: [u('K', 1, 'K'), u('°Cd', 1, '°C'), u('°Fd', 5 / 9, '°F')],
  density: [u('kg/m³', 1), u('g/cm³', 1000), u('g/mL', 1000), u('kg/L', 1000), u('lb/ft³', 16.01846337)],
  angle: [u('rad', 1), u('°', Math.PI / 180)],
  frequency: [u('Hz', 1), u('kHz', 1e3), u('MHz', 1e6), u('GHz', 1e9), u('rpm', 1 / 60), u('bpm', 1 / 60)],
  data: [u('B', 1), u('kB', 1e3), u('MB', 1e6), u('GB', 1e9), u('TB', 1e12), u('KiB', 1024), u('MiB', 1048576), u('GiB', 1073741824), u('bit', 1 / 8)],
  datarate: [u('bit/s', 1), u('kbit/s', 1e3), u('Mbit/s', 1e6), u('Gbit/s', 1e9), u('B/s', 8), u('kB/s', 8e3), u('MB/s', 8e6)],
  current: [u('A', 1), u('mA', 1e-3), u('µA', 1e-6), u('kA', 1e3)],
  voltage: [u('V', 1), u('mV', 1e-3), u('kV', 1e3)],
  resistance: [u('Ω', 1), u('mΩ', 1e-3), u('kΩ', 1e3), u('MΩ', 1e6)],
  charge: [u('C', 1), u('mAh', 3.6), u('Ah', 3600)],
  amount: [u('mol', 1), u('mmol', 1e-3), u('µmol', 1e-6)],
  molarity: [u('mol/L', 1), u('mmol/L', 1e-3), u('µmol/L', 1e-6), u('nmol/L', 1e-9)],
  molarmass: [u('g/mol', 1), u('kg/mol', 1000)],
  massconc: [u('mg/L', 1), u('g/L', 1000), u('µg/mL', 1), u('ng/µL', 1), u('mg/mL', 1000)],
  fuel: [
    { id: 'L/100km', label: 'L/100 km', factor: 1 },
    { id: 'km/L', label: 'km/L', factor: 100, reciprocal: true },
    { id: 'mpg', label: 'mpg (US)', factor: 235.214583, reciprocal: true },
    { id: 'mpgimp', label: 'mpg (UK)', factor: 282.480936, reciprocal: true },
  ],
  flow: [u('m³/s', 1), u('L/s', 1e-3), u('L/min', 1e-3 / 60), u('L/h', 1e-3 / 3600), u('m³/h', 1 / 3600), u('gpm', 3.785411784e-3 / 60, 'US gal/min'), u('cm³/min', 1e-6 / 60)],
  specificheat: [u('J/(kg·K)', 1), u('kJ/(kg·K)', 1000), u('cal/(g·°C)', 4184)],
  pixeldensity: [u('ppi', 1, 'px/in'), u('ppcm', 2.54, 'px/cm')],
  capacitance: [u('F', 1), u('mF', 1e-3), u('µF', 1e-6), u('nF', 1e-9), u('pF', 1e-12)],
  inductance: [u('H', 1), u('mH', 1e-3), u('µH', 1e-6), u('nH', 1e-9)],
  torque: [u('N·m', 1), u('kN·m', 1000), u('N·mm', 1e-3), u('kgf·m', 9.80665), u('lbf·ft', 1.3558179483314), u('lbf·in', 0.1129848290276)],
  /** Force per length: spring rates and loads spread along a beam. */
  linearforce: [u('N/m', 1), u('N/mm', 1000), u('kN/m', 1000), u('lbf/in', 175.12683524647636), u('lbf/ft', 14.593902937206364)],
  /** Second moment of area, for beam bending. */
  inertia: [u('m⁴', 1), u('cm⁴', 1e-8), u('mm⁴', 1e-12), u('in⁴', 4.162314256e-7)],
  viscosity: [u('Pa·s', 1), u('mPa·s', 1e-3), u('cP', 1e-3), u('P', 0.1)],
  /** Thermal conductivity of materials and insulation. */
  conductivity: [u('W/(m·K)', 1), u('mW/(m·K)', 1e-3), u('BTU/(h·ft·°F)', 1.730734666), u('kcal/(h·m·°C)', 1.163)],
  /** Heat transfer coefficients and U-values. */
  htc: [u('W/(m²·K)', 1), u('BTU/(h·ft²·°F)', 5.678263341), u('kcal/(h·m²·°C)', 1.163)],
  /** Heat flow per length of pipe or cable. */
  linearpower: [u('W/m', 1), u('kW/m', 1000), u('BTU/(h·ft)', 0.9615170684), u('kcal/(h·m)', 1.163)],
  /** Energy per mass: calorific values. */
  specificenergy: [u('J/kg', 1), u('kJ/kg', 1000), u('MJ/kg', 1e6), u('kcal/kg', 4186.8), u('BTU/lb', 2326), u('kWh/kg', 3.6e6)],
  /** Thermal expansion coefficients. */
  expansion: [u('1/K', 1), u('ppm/K', 1e-6, 'ppm/K (µm/m·K)'), u('1/°F', 1.8), u('ppm/°F', 1.8e-6)],
} as const satisfies Record<string, readonly Unit[]>;

export type Dimension = keyof typeof DIMENSIONS;

export function unitsOf(dim: Dimension): readonly Unit[] {
  return DIMENSIONS[dim];
}

export function findUnit(dim: Dimension, id: string): Unit {
  const unit = DIMENSIONS[dim].find((x) => x.id === id);
  if (!unit) throw new Error(`Unknown unit "${id}" for ${dim}`);
  return unit;
}

export function toBase(value: number, unit: Unit): number {
  return unit.reciprocal ? unit.factor / value : value * unit.factor + (unit.offset ?? 0);
}

export function fromBase(value: number, unit: Unit): number {
  return unit.reciprocal ? unit.factor / value : (value - (unit.offset ?? 0)) / unit.factor;
}

/** Converts between two units of the same dimension. */
export function convert(value: number, from: Unit, to: Unit): number {
  return from === to ? value : fromBase(toBase(value, from), to);
}
