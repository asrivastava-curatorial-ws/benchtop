import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

type Unit = readonly [id: string, label: string, factor: number] | readonly [id: string, label: string, toBase: (value: number) => number, fromBase: (value: number) => number];

/** Each category: units with their size in the category's base unit (first entry). */
export const CATEGORIES: Record<string, { label: string; units: readonly Unit[] }> = {
  length: {
    label: 'Length',
    units: [
      ['m', 'metre', 1],
      ['km', 'kilometre', 1000],
      ['cm', 'centimetre', 0.01],
      ['mm', 'millimetre', 0.001],
      ['um', 'micrometre', 1e-6],
      ['nm', 'nanometre', 1e-9],
      ['in', 'inch', 0.0254],
      ['ft', 'foot', 0.3048],
      ['yd', 'yard', 0.9144],
      ['mi', 'mile', 1609.344],
      ['nmi', 'nautical mile', 1852],
      ['mil', 'thou (mil)', 2.54e-5],
      ['au', 'astronomical unit', 149597870700],
      ['ly', 'light year', 9460730472580800],
      ['pc', 'parsec', 3.085677581491367e16],
    ],
  },
  area: {
    label: 'Area',
    units: [
      ['m2', 'square metre', 1],
      ['km2', 'square kilometre', 1e6],
      ['cm2', 'square centimetre', 1e-4],
      ['mm2', 'square millimetre', 1e-6],
      ['ha', 'hectare', 1e4],
      ['acre', 'acre', 4046.8564224],
      ['ft2', 'square foot', 0.09290304],
      ['in2', 'square inch', 0.00064516],
      ['yd2', 'square yard', 0.83612736],
      ['mi2', 'square mile', 2589988.110336],
      ['cent', 'cent (South India)', 40.468564224],
      ['guntha', 'guntha', 101.17141056],
      ['bigha', 'bigha (Assam/Bengal, varies)', 1337.8],
      ['kcmil', 'kcmil (cable)', 5.067074790975e-7],
    ],
  },
  volume: {
    label: 'Volume',
    units: [
      ['m3', 'cubic metre', 1],
      ['l', 'litre', 0.001],
      ['ml', 'millilitre', 1e-6],
      ['cm3', 'cubic centimetre', 1e-6],
      ['ft3', 'cubic foot', 0.028316846592],
      ['in3', 'cubic inch', 1.6387064e-5],
      ['galUS', 'US gallon', 0.003785411784],
      ['galUK', 'imperial gallon', 0.00454609],
      ['qtUS', 'US quart', 0.000946352946],
      ['ptUS', 'US pint', 0.000473176473],
      ['cup', 'US cup', 0.0002365882365],
      ['flozUS', 'US fluid ounce', 2.95735295625e-5],
      ['tbsp', 'tablespoon', 1.478676478125e-5],
      ['tsp', 'teaspoon', 4.92892159375e-6],
      ['bbl', 'oil barrel', 0.158987294928],
    ],
  },
  mass: {
    label: 'Mass',
    units: [
      ['kg', 'kilogram', 1],
      ['g', 'gram', 0.001],
      ['mg', 'milligram', 1e-6],
      ['t', 'tonne', 1000],
      ['lb', 'pound', 0.45359237],
      ['oz', 'ounce', 0.028349523125],
      ['st', 'stone', 6.35029318],
      ['tonUS', 'short ton', 907.18474],
      ['tonUK', 'long ton', 1016.0469088],
      ['ct', 'carat', 0.0002],
      ['tola', 'tola', 0.0116638038],
      ['quintal', 'quintal', 100],
      ['gr', 'grain', 6.479891e-5],
    ],
  },
  temperature: {
    label: 'Temperature',
    units: [
      ['C', '°C (Celsius)', (v) => v, (v) => v],
      ['F', '°F (Fahrenheit)', (v) => ((v - 32) * 5) / 9, (v) => (v * 9) / 5 + 32],
      ['K', 'K (kelvin)', (v) => v - 273.15, (v) => v + 273.15],
      ['R', '°R (Rankine)', (v) => ((v - 491.67) * 5) / 9, (v) => ((v + 273.15) * 9) / 5],
    ],
  },
  speed: {
    label: 'Speed',
    units: [
      ['m/s', 'metre per second', 1],
      ['km/h', 'kilometre per hour', 1 / 3.6],
      ['mph', 'mile per hour', 0.44704],
      ['kn', 'knot', 1852 / 3600],
      ['ft/s', 'foot per second', 0.3048],
      ['ft/min', 'foot per minute', 0.00508],
      ['mach', 'Mach (sea level)', 340.29],
      ['c', 'speed of light', 299792458],
    ],
  },
  pressure: {
    label: 'Pressure',
    units: [
      ['Pa', 'pascal', 1],
      ['kPa', 'kilopascal', 1000],
      ['MPa', 'megapascal', 1e6],
      ['bar', 'bar', 1e5],
      ['mbar', 'millibar', 100],
      ['psi', 'psi', 6894.757293168],
      ['atm', 'atmosphere', 101325],
      ['mmHg', 'mmHg (torr)', 133.322387415],
      ['inHg', 'inch of mercury', 3386.389],
      ['inH2O', 'inch of water', 249.08891],
      ['mmH2O', 'mm of water', 9.80665],
      ['mH2O', 'metre of water (head)', 9806.65],
      ['kgf/cm2', 'kgf/cm²', 98066.5],
    ],
  },
  energy: {
    label: 'Energy',
    units: [
      ['J', 'joule', 1],
      ['kJ', 'kilojoule', 1000],
      ['MJ', 'megajoule', 1e6],
      ['Wh', 'watt hour', 3600],
      ['kWh', 'kilowatt hour (unit)', 3.6e6],
      ['cal', 'calorie', 4.184],
      ['kcal', 'kilocalorie', 4184],
      ['BTU', 'BTU', 1055.05585262],
      ['therm', 'therm', 105505585.262],
      ['eV', 'electronvolt', 1.602176634e-19],
      ['ftlbf', 'foot-pound', 1.3558179483314],
      ['toe', 'tonne of oil equivalent', 41.868e9],
    ],
  },
  power: {
    label: 'Power',
    units: [
      ['W', 'watt', 1],
      ['kW', 'kilowatt', 1000],
      ['MW', 'megawatt', 1e6],
      ['hp', 'horsepower (mechanical)', 745.6998715822702],
      ['PS', 'metric horsepower (PS)', 735.49875],
      ['hpE', 'electrical horsepower', 746],
      ['BTU/h', 'BTU per hour', 0.29307107017],
      ['TR', 'ton of refrigeration', 3516.8528420667],
      ['kcal/h', 'kilocalorie per hour', 1.1622222222],
      ['ftlbf/s', 'foot-pound per second', 1.3558179483314],
    ],
  },
  force: {
    label: 'Force',
    units: [
      ['N', 'newton', 1],
      ['kN', 'kilonewton', 1000],
      ['kgf', 'kilogram-force', 9.80665],
      ['lbf', 'pound-force', 4.4482216152605],
      ['dyn', 'dyne', 1e-5],
      ['tf', 'tonne-force', 9806.65],
    ],
  },
  torque: {
    label: 'Torque',
    units: [
      ['Nm', 'newton metre', 1],
      ['kNm', 'kilonewton metre', 1000],
      ['kgfm', 'kgf·m', 9.80665],
      ['lbfft', 'pound-foot', 1.3558179483314],
      ['lbfin', 'pound-inch', 0.1129848290276167],
      ['ozfin', 'ounce-inch', 0.00706155181422604],
    ],
  },
  flow: {
    label: 'Flow rate',
    units: [
      ['m3/h', 'm³ per hour', 1],
      ['m3/s', 'm³ per second', 3600],
      ['l/s', 'litre per second', 3.6],
      ['l/min', 'litre per minute', 0.06],
      ['cfm', 'cubic foot per minute', 1.6990107955],
      ['gpmUS', 'US gallon per minute', 0.2271247068],
      ['gpmUK', 'imperial gallon per minute', 0.2727654],
      ['bbl/d', 'barrel per day', 0.006624470622],
    ],
  },
  data: {
    label: 'Data size',
    units: [
      ['B', 'byte', 1],
      ['kB', 'kilobyte (1000)', 1e3],
      ['MB', 'megabyte', 1e6],
      ['GB', 'gigabyte', 1e9],
      ['TB', 'terabyte', 1e12],
      ['PB', 'petabyte', 1e15],
      ['KiB', 'kibibyte (1024)', 1024],
      ['MiB', 'mebibyte', 1048576],
      ['GiB', 'gibibyte', 1073741824],
      ['TiB', 'tebibyte', 1099511627776],
      ['bit', 'bit', 0.125],
      ['kbit', 'kilobit', 125],
      ['Mbit', 'megabit', 125000],
      ['Gbit', 'gigabit', 1.25e8],
    ],
  },
  datarate: {
    label: 'Data rate',
    units: [
      ['bit/s', 'bit per second', 1],
      ['kbit/s', 'kilobit per second', 1e3],
      ['Mbit/s', 'megabit per second', 1e6],
      ['Gbit/s', 'gigabit per second', 1e9],
      ['B/s', 'byte per second', 8],
      ['kB/s', 'kilobyte per second', 8e3],
      ['MB/s', 'megabyte per second', 8e6],
      ['GB/s', 'gigabyte per second', 8e9],
      ['MiB/s', 'mebibyte per second', 8388608],
    ],
  },
  time: {
    label: 'Time',
    units: [
      ['s', 'second', 1],
      ['ms', 'millisecond', 0.001],
      ['us', 'microsecond', 1e-6],
      ['ns', 'nanosecond', 1e-9],
      ['min', 'minute', 60],
      ['h', 'hour', 3600],
      ['d', 'day', 86400],
      ['wk', 'week', 604800],
      ['mo', 'month (average)', 2629746],
      ['yr', 'year (365.2425 d)', 31556952],
    ],
  },
  angle: {
    label: 'Angle',
    units: [
      ['deg', 'degree', 1],
      ['rad', 'radian', 180 / Math.PI],
      ['grad', 'gradian', 0.9],
      ['arcmin', 'arcminute', 1 / 60],
      ['arcsec', 'arcsecond', 1 / 3600],
      ['turn', 'turn', 360],
      ['mil', 'NATO mil', 360 / 6400],
    ],
  },
  frequency: {
    label: 'Frequency',
    units: [
      ['Hz', 'hertz', 1],
      ['kHz', 'kilohertz', 1e3],
      ['MHz', 'megahertz', 1e6],
      ['GHz', 'gigahertz', 1e9],
      ['rpm', 'revolution per minute', 1 / 60],
      ['rad/s', 'radian per second', 1 / (2 * Math.PI)],
    ],
  },
  density: {
    label: 'Density',
    units: [
      ['kg/m3', 'kg per m³', 1],
      ['g/cm3', 'g per cm³', 1000],
      ['g/l', 'g per litre', 1],
      ['lb/ft3', 'lb per ft³', 16.01846337],
      ['lb/galUS', 'lb per US gallon', 119.8264273],
    ],
  },
  fuel: {
    label: 'Fuel economy',
    units: [
      ['km/l', 'kilometre per litre', (v) => v, (v) => v],
      ['l/100km', 'litre per 100 km', (v) => 100 / v, (v) => 100 / v],
      ['mpgUS', 'mile per US gallon', (v) => v * 0.425143707, (v) => v / 0.425143707],
      ['mpgUK', 'mile per imperial gallon', (v) => v * 0.354006189, (v) => v / 0.354006189],
    ],
  },
  illuminance: {
    label: 'Illuminance (light falling on a surface)',
    units: [
      ['lx', 'lux', 1],
      ['fc', 'foot-candle', 10.763910417],
      ['ph', 'phot', 10000],
    ],
  },
  luminance: {
    label: 'Luminance (brightness of a screen)',
    units: [
      ['nit', 'nit (cd/m²)', 1],
      ['fL', 'foot-lambert', 3.4262590996],
      ['sb', 'stilb', 10000],
      ['L', 'lambert', 3183.0988618],
    ],
  },
  radiation: {
    label: 'Radiation dose',
    units: [
      ['Sv', 'sievert', 1],
      ['mSv', 'millisievert', 1e-3],
      ['uSv', 'microsievert', 1e-6],
      ['rem', 'rem', 0.01],
      ['mrem', 'millirem', 1e-5],
    ],
  },
};

const toBase = (unit: Unit, value: number): number => (typeof unit[2] === 'number' ? value * unit[2] : unit[2](value));
const fromBase = (unit: Unit, value: number): number => (typeof unit[2] === 'number' ? value / unit[2] : (unit[3] as (v: number) => number)(value));

export function convert(category: string, value: number, from: string, to: string): number {
  const units = CATEGORIES[category]?.units ?? [];
  const source = units.find((unit) => unit[0] === from);
  const target = units.find((unit) => unit[0] === to);
  if (!source || !target) throw new ToolError(`Unknown unit ${!source ? from : to}.`);
  return fromBase(target, toBase(source, value));
}

export const formatNumber = (value: number, digits: number): string => {
  if (!Number.isFinite(value)) return '—';
  if (value !== 0 && (Math.abs(value) >= 1e15 || Math.abs(value) < 1e-6)) return value.toExponential(digits - 1).replace(/\.?0+e/, 'e');
  return Number(value.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 12 });
};

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'category', label: 'Quantity', type: 'select', choices: Object.entries(CATEGORIES).map(([value, { label }]) => ({ value, label })), default: 'length' },
    { key: 'value', label: 'Value', type: 'number', default: 1, step: 0.001 },
    // One unit list per quantity; only the one for the chosen quantity is shown.
    ...Object.entries(CATEGORIES).map(([key, { units }]) => ({
      key: `from_${key}`,
      label: 'From',
      type: 'select' as const,
      choices: units.map((unit) => ({ value: unit[0], label: `${unit[1]} (${unit[0]})` })),
      default: units[0]?.[0] ?? '',
      showIf: (v: Record<string, unknown>) => v.category === key,
    })),
    { key: 'digits', label: 'Significant digits', type: 'number', default: 8, min: 2, max: 15, step: 1 },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const category = CATEGORIES[o.category] ?? (CATEGORIES.length as (typeof CATEGORIES)[string]);
    const chosen = (o as Record<string, unknown>)[`from_${o.category}`];
    const from = category.units.find((unit) => unit[0] === chosen) ?? (category.units[0] as Unit);
    const base = toBase(from, o.value);
    const fields: Field[] = category.units.map((unit) => ({
      label: `${unit[1]} (${unit[0]})`,
      value: formatNumber(fromBase(unit, base), o.digits),
      mono: true,
      tone: unit === from ? 'ok' : undefined,
    }));
    return { fields, info: `${formatNumber(o.value, o.digits)} ${from[1]} in every ${category.label.toLowerCase()} unit.` };
  },
});
