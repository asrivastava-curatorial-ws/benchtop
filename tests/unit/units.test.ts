import { describe, expect, it } from 'vitest';
import {
  convertValue,
  defaultPair,
  findCategory,
  findUnit,
  formatValue,
  fromBase,
  GROUPS,
  matchUnit,
  PAIR_IDS,
  parseQuery,
  readNumber,
  searchUnits,
  toBase,
  UNIT_CATEGORIES,
  type UnitDef,
  unitRatio,
} from '../../src/lib/units';

const unit = (category: string, id: string): UnitDef => {
  const found = findCategory(category);
  const u = found && findUnit(found, id);
  if (!u) throw new Error(`no ${id} in ${category}`);
  return u;
};
const convert = (category: string, value: number, from: string, to: string) => convertValue(value, unit(category, from), unit(category, to));

describe('the unit catalogue', () => {
  it('covers every group with well-formed categories', () => {
    expect(UNIT_CATEGORIES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(UNIT_CATEGORIES.map((c) => c.id)).size).toBe(UNIT_CATEGORIES.length);
    for (const group of GROUPS)
      expect(
        UNIT_CATEGORIES.some((c) => c.group === group.id),
        group.id,
      ).toBe(true);
    const total = UNIT_CATEGORIES.reduce((n, c) => n + c.units.length, 0);
    expect(total).toBeGreaterThan(1000);
    for (const category of UNIT_CATEGORIES) {
      const ids = category.units.map((u) => u.id);
      expect(new Set(ids).size, `${category.id} has duplicate ids`).toBe(ids.length);
      const symbols = category.units.map((u) => u.symbol);
      expect(new Set(symbols).size, `${category.id} has duplicate symbols`).toBe(symbols.length);
      const base = category.units[0] as UnitDef;
      expect(base.factor === 1 && !base.offset && !base.reciprocal && !base.toBase, `${category.id} starts with its base unit`).toBe(true);
      for (const u of category.units) {
        expect(u.name.length, `${category.id}/${u.id} name`).toBeGreaterThan(0);
        expect(u.toBase ? Boolean(u.fromBase) : Number.isFinite(u.factor) && u.factor !== 0, `${category.id}/${u.id} factor`).toBe(true);
      }
    }
  });

  it('round-trips every unit', () => {
    for (const category of UNIT_CATEGORIES) {
      for (const u of category.units) {
        // Function units (slopes, decibels, hydrometer scales) are checked inside their usual range.
        for (const value of u.toBase ? [0.37, 1.2] : [0.37, 3, 42.5]) {
          const back = fromBase(u, toBase(u, value));
          expect(back, `${category.id}/${u.id}`).toBeCloseTo(value, 9);
        }
      }
    }
  });
});

describe('conversion factors', () => {
  it('matches the exact definitions (NIST SP 811 and international agreements)', () => {
    expect(convert('length', 1, 'mi', 'km')).toBe(1.609344);
    expect(convert('length', 1, 'nmi', 'm')).toBe(1852);
    expect(convert('length', 1, 'ftUS', 'm')).toBeCloseTo(0.3048006096012192, 15);
    expect(convert('area', 1, 'acre', 'm2')).toBeCloseTo(4046.8564224, 9);
    expect(convert('area', 1, 'acreUS', 'm2')).toBeCloseTo(4046.872609874252, 6);
    expect(convert('volume', 1, 'gal', 'L')).toBeCloseTo(3.785411784, 12);
    expect(convert('volume', 1, 'galImp', 'L')).toBeCloseTo(4.54609, 12);
    expect(convert('volume', 1, 'bbl', 'L')).toBeCloseTo(158.987294928, 9);
    expect(convert('volume', 1, 'bu', 'L')).toBeCloseTo(35.23907016688, 9);
    expect(convert('volume', 1, 'acft', 'm3')).toBeCloseTo(1233.48183754752, 8);
    expect(convert('mass', 1, 'lb', 'kg')).toBe(0.45359237);
    expect(convert('mass', 1, 'ozt', 'g')).toBeCloseTo(31.1034768, 10);
    expect(convert('mass', 1, 'slug', 'kg')).toBeCloseTo(14.593902937206, 9);
    expect(convert('force', 1, 'lbf', 'N')).toBeCloseTo(4.4482216152605, 12);
    expect(convert('pressure', 1, 'psi', 'Pa')).toBeCloseTo(6894.757293168, 8);
    expect(convert('pressure', 1, 'atm', 'Torr')).toBeCloseTo(760, 10);
    expect(convert('pressure', 1, 'inH2O', 'Pa')).toBeCloseTo(249.08891, 5);
    expect(convert('energy', 1, 'BTU', 'J')).toBeCloseTo(1055.05585262, 8);
    expect(convert('energy', 1, 'BTUth', 'J')).toBeCloseTo(1054.35026448889, 8);
    expect(convert('energy', 1, 'thermUS', 'J')).toBe(105480400);
    expect(convert('energy', 1, 'kWh', 'J')).toBe(3.6e6);
    expect(convert('energy', 1, 'hph', 'J')).toBeCloseTo(2684519.537696173, 6);
    expect(convert('power', 1, 'hp', 'W')).toBeCloseTo(745.6998715822702, 10);
    expect(convert('power', 1, 'PS', 'W')).toBeCloseTo(735.49875, 10);
    expect(convert('power', 1, 'TR', 'kW')).toBeCloseTo(3.516852842067, 10);
    expect(convert('power', 1, 'BTU/h', 'W')).toBeCloseTo(0.2930710701722, 12);
    expect(convert('torque', 1, 'lbfft', 'Nm')).toBeCloseTo(1.3558179483314, 13);
    expect(convert('viscosity', 1, 'reyn', 'Pas')).toBeCloseTo(6894.757293168, 8);
    expect(convert('htc', 1, 'BTU/hft2F', 'W/m2K')).toBeCloseTo(5.678263340863, 9);
    expect(convert('conductivity', 1, 'BTU/hftF', 'W/mK')).toBeCloseTo(1.730734666371, 9);
    expect(convert('rvalue', 1, 'Rus', 'm2K/W')).toBeCloseTo(0.1761101836, 8);
    expect(convert('specificheat', 1, 'BTU/lbF', 'J/kgK')).toBeCloseTo(4186.8, 9);
    expect(convert('specificenergy', 1, 'BTU/lb', 'kJ/kg')).toBeCloseTo(2.326, 12);
    expect(convert('luminance', 1, 'fL', 'cd/m2')).toBeCloseTo(3.4262590996, 9);
    expect(convert('illuminance', 1, 'fc', 'lx')).toBeCloseTo(10.763910417, 8);
    expect(convert('hfield', 1, 'Oe', 'A/m')).toBeCloseTo(79.57747154595, 9);
    expect(convert('radioactivity', 1, 'Ci', 'GBq')).toBe(37);
    expect(convert('exposure', 1, 'R', 'C/kg')).toBe(2.58e-4);
    expect(convert('amount', 1, 'lbmol', 'mol')).toBeCloseTo(453.59237, 9);
    expect(convert('data', 1, 'GiB', 'B')).toBe(1073741824);
  });

  it('handles temperatures, reciprocal and logarithmic units', () => {
    expect(convert('temperature', 98.6, 'F', 'C')).toBeCloseTo(37, 12);
    expect(convert('temperature', -40, 'C', 'F')).toBeCloseTo(-40, 12);
    expect(convert('temperature', 0, 'C', 'K')).toBe(273.15);
    expect(convert('temperature', 100, 'C', 'R')).toBeCloseTo(671.67, 10);
    expect(convert('temperature', 4, 'gasmark', 'F')).toBeCloseTo(350, 10);
    expect(convert('tempdiff', 10, 'C', 'F')).toBeCloseTo(18, 12);
    expect(convert('fuel', 30, 'mpg', 'L/100km')).toBeCloseTo(7.84048611, 7);
    expect(convert('fuel', 20, 'km/L', 'L/100km')).toBe(5);
    expect(convert('fuel', 1, 'mpgImp', 'mpg')).toBeCloseTo(0.83267418, 7);
    expect(convert('spectrum', 500, 'wnm', 'THz')).toBeCloseTo(599.584916, 5);
    expect(convert('spectrum', 1, 'eV', 'wnm')).toBeCloseTo(1239.84198, 4);
    expect(convert('slope', 45, 'deg', '%')).toBeCloseTo(100, 10);
    expect(convert('slope', 12, 'oneIn', '%')).toBeCloseTo(8.3333333, 6);
    expect(convert('slope', 6, 'pitch', 'deg')).toBeCloseTo(26.565051, 5);
    expect(convert('power', 30, 'dBm', 'W')).toBeCloseTo(1, 12);
    expect(convert('soundpressure', 94, 'dBSPL', 'Pa')).toBeCloseTo(1.0024, 4);
    expect(convert('gravityscales', 10, 'API', 'SG')).toBeCloseTo(1, 12);
    expect(convert('gravityscales', 35, 'API', 'SG')).toBeCloseTo(0.8498498, 6);
    expect(convert('cooling', 3.5168528, 'COP', 'kW/TR')).toBeCloseTo(1, 6);
    expect(convert('cooling', 10, 'EER', 'COP')).toBeCloseTo(2.9307107, 6);
    expect(convert('evconsumption', 4, 'mi/kWh', 'Wh/km')).toBeCloseTo(155.342798, 5);
  });

  it('knows trade and regional units', () => {
    expect(convert('mass', 1, 'tola', 'g')).toBeCloseTo(11.6638038, 9);
    expect(convert('mass', 1, 'maund', 'kg')).toBeCloseTo(37.32417216, 8);
    expect(convert('mass', 96, 'ratti', 'tola')).toBeCloseTo(1, 12);
    expect(convert('landindia', 1, 'acre', 'guntha')).toBeCloseTo(40, 12);
    expect(convert('landindia', 1, 'acre', 'cent')).toBeCloseTo(100, 12);
    expect(convert('landindia', 1, 'acre', 'kanal')).toBeCloseTo(8, 12);
    expect(convert('landindia', 1, 'kanal', 'marla')).toBeCloseTo(20, 12);
    expect(convert('landindia', 1, 'bighaAS', 'kathaAS')).toBeCloseTo(5, 12);
    expect(convert('landindia', 1, 'kathaAS', 'lessa')).toBeCloseTo(20, 12);
    expect(convert('landindia', 1, 'bighaWB', 'kathaWB')).toBeCloseTo(20, 12);
    expect(convert('landindia', 1, 'acre', 'bighaRJp')).toBeCloseTo(1.6, 12);
    expect(convert('landindia', 1, 'ground', 'ft2')).toBeCloseTo(2400, 9);
    expect(convert('volume', 1, 'TMC', 'MCM')).toBeCloseTo(28.316846592, 9);
    expect(convert('volume', 1, 'brass', 'm3')).toBeCloseTo(2.8316846592, 12);
    expect(convert('flow', 1, 'ft3/s', 'm3/s')).toBeCloseTo(0.028316846592, 14);
    expect(convert('flow', 1, 'MLD', 'm3/h')).toBeCloseTo(41.6666667, 6);
    expect(convert('energy', 1, 'MU', 'kWh')).toBe(1e6);
    expect(convert('count', 1, 'crore', 'lakh')).toBe(100);
    expect(convert('count', 1, 'crore', 'million')).toBe(10);
    expect(convert('purity', 22, 'K', 'fineness')).toBeCloseTo(916.6666667, 6);
    expect(convert('oregrade', 1, 'oz/ton', 'g/t')).toBeCloseTo(34.2857143, 6);
    expect(convert('yarn', 30, 'Ne', 'tex')).toBeCloseTo(19.6847, 3);
    expect(convert('yarn', 9, 'den', 'tex')).toBeCloseTo(1, 12);
    expect(convert('yarn', 50, 'Nm', 'Ne')).toBeCloseTo(29.527, 2);
    expect(convert('paper', 20, 'bond', 'gsm')).toBeCloseTo(75.19, 1);
    expect(convert('paper', 80, 'text', 'gsm')).toBeCloseTo(118.4, 1);
    expect(convert('cropyield', 1, 'q/acre', 'kg/ha')).toBeCloseTo(247.105381, 5);
    expect(convert('cropyield', 1, 'buWheat', 'kg/ha')).toBeCloseTo(67.2511, 3);
    expect(convert('gasvolume', 1, 'Nm3', 'mol')).toBeCloseTo(44.615, 3);
    expect(convert('gasvolume', 1, 'Nm3', 'scf')).toBeCloseTo(37.326, 2);
    expect(convert('hardness', 1, 'dH', 'ppmCaCO3')).toBeCloseTo(17.848, 3);
    expect(convert('hardness', 1, 'gpg', 'ppmCaCO3')).toBeCloseTo(17.118, 3);
    expect(convert('glucose', 100, 'mg/dL', 'mmol/L')).toBeCloseTo(5.5507, 4);
    expect(convert('hba1c', 6.5, 'pct', 'ifcc')).toBeCloseTo(47.54, 2);
    expect(convert('hba1c', 7, 'pct', 'eagmg')).toBeCloseTo(154.2, 1);
    expect(convert('creatinine', 1, 'mg/dL', 'umol/L')).toBeCloseTo(88.4, 1);
    expect(convert('cholesterol', 200, 'mg/dL', 'mmol/L')).toBeCloseTo(5.17, 2);
  });
});

describe('reading questions', () => {
  const read = (text: string) => {
    const result = parseQuery(text);
    if ('error' in result) throw new Error(result.error);
    return { value: result.value, category: result.category.id, from: result.from.id, to: result.to?.id, answer: result.to ? convertValue(result.value, result.from, result.to) : undefined };
  };

  it('finds both units and the quantity they share', () => {
    expect(read('98.6 F to C')).toMatchObject({ category: 'temperature', from: 'F', to: 'C' });
    expect(read('98.6 F to C').answer).toBeCloseTo(37, 10);
    expect(read('5 kg to lb')).toMatchObject({ category: 'mass', from: 'kg', to: 'lb' });
    expect(read('5 kg to N')).toMatchObject({ category: 'force', from: 'kgf', to: 'N' });
    expect(read('10 in to cm')).toMatchObject({ category: 'length', from: 'in', to: 'cm' });
    expect(read('3 ft in m')).toMatchObject({ category: 'length', from: 'ft', to: 'm' });
    expect(read('2 bigha (AS) in acres')).toMatchObject({ category: 'landindia', from: 'bighaAS', to: 'acre' });
    expect(read('30 psi = bar').answer).toBeCloseTo(2.0684271879, 9);
    expect(read('1,00,000 sq ft to acres').value).toBe(100000);
    expect(read('3 1/2 cups to mL').answer).toBeCloseTo(828.0588, 3);
    expect(read('1/2 tsp in mL').value).toBe(0.5);
    expect(read('12 MW to hp')).toMatchObject({ category: 'power', from: 'MW', to: 'hp' });
    expect(read('5 mW to dBm').answer).toBeCloseTo(6.9897, 4);
    expect(read('2 tola to grams')).toMatchObject({ category: 'mass', from: 'tola', to: 'g' });
    expect(read('100 cusec to cumec').answer).toBeCloseTo(2.8316846592, 9);
    expect(read('12 psi')).toMatchObject({ category: 'pressure', from: 'psi', to: undefined });
    expect(read('6 µm to inches').answer).toBeCloseTo(0.00023622, 9);
    expect(read('20 metres per second in km/h').answer).toBeCloseTo(72, 10);
  });

  it('reads counting words, plurals and American spellings', () => {
    const lakh = parseQuery('2 lakh sq ft to acres');
    expect('error' in lakh ? lakh.error : convertValue(lakh.value, lakh.from, lakh.to as UnitDef)).toBeCloseTo(4.591368, 5);
    const gallons = parseQuery('3 million gallons in ML');
    expect('error' in gallons ? gallons.error : gallons.value).toBe(3e6);
    const count = parseQuery('5 lakh in million');
    expect('error' in count ? count.error : count.from.id).toBe('lakh');
    for (const [text, id] of [
      ['kilometers', 'km'],
      ['liters', 'L'],
      ['degrees celsius', 'C'],
      ['kilowatt hours', 'kWh'],
      ['sq. ft.', 'ft2'],
      ['guntas', 'guntha'],
      ['atmospheres', 'atm'],
    ] as const) {
      expect(matchUnit(text)[0]?.unit.id, text).toBe(id);
    }
  });

  it('uses a named quantity to choose between units that share a symbol', () => {
    const glucose = parseQuery('5.4 mmol/L glucose in mg/dL');
    expect('error' in glucose ? glucose.error : glucose.category.id).toBe('glucose');
    const cholesterol = parseQuery('200 mg/dL to mmol/L for cholesterol');
    expect('error' in cholesterol ? cholesterol.error : [cholesterol.category.id, convertValue(cholesterol.value, cholesterol.from, cholesterol.to as UnitDef)]).toEqual([
      'cholesterol',
      expect.closeTo(5.1726, 4),
    ]);
    const calcium = parseQuery('2.5 mmol/L of calcium');
    expect('error' in calcium ? calcium.error : calcium.category.id).toBe('calcium');
  });

  it('explains what it cannot read', () => {
    expect(parseQuery('kg to lb')).toEqual({ error: expect.stringMatching(/Start with a number/) });
    expect(parseQuery('5 florps to kg')).toEqual({ error: expect.stringMatching(/florps/) });
    expect(parseQuery('5 kg to metres')).toEqual({ error: expect.stringMatching(/measure different things/) });
  });

  it('matches symbols by case before names', () => {
    expect(matchUnit('MW')[0]?.unit.id).toBe('MW');
    expect(matchUnit('mW')[0]?.unit.id).toBe('mW');
    expect(matchUnit('nm')[0]?.unit.id).toBe('nm');
    expect(matchUnit('NM')[0]?.unit.id).toBe('nmi');
    expect(matchUnit('feet')[0]?.unit.id).toBe('ft');
    expect(matchUnit('square feet')[0]?.unit.id).toBe('ft2');
  });
});

describe('search', () => {
  it('finds units by symbol, name and purpose', () => {
    expect(searchUnits('bigha').filter((hit) => hit.unit).length).toBeGreaterThanOrEqual(8);
    expect(searchUnits('psi')[0]?.unit?.id).toBe('psi');
    expect(searchUnits('irrigation').some((hit) => hit.category.id === 'application' || hit.category.id === 'flow')).toBe(true);
    expect(searchUnits('yarn')[0]?.category.id).toBe('yarn');
    expect(searchUnits('')).toEqual([]);
  });
});

describe('formatting', () => {
  it('rounds to significant digits and groups in either style', () => {
    expect(formatValue(1234567.891, 6)).toBe('1,234,570');
    expect(formatValue(1234567.891, 6, 'indian')).toBe('12,34,570');
    expect(formatValue(0.000123456, 3)).toBe('0.000123');
    expect(formatValue(6.02214076e23, 5)).toBe('6.0221e23');
    expect(formatValue(1e-9, 4)).toBe('1e-9');
    expect(formatValue(Number.NaN, 4)).toBe('—');
    expect(formatValue(1234.5, 8, 'none')).toBe('1234.5');
  });
});

describe('the converter', () => {
  it('opens every quantity on two different, existing units', () => {
    for (const [id, [from, to]] of Object.entries(PAIR_IDS)) {
      const category = findCategory(id);
      expect(category, id).toBeDefined();
      if (!category) continue;
      expect(findUnit(category, from), `${id}/${from}`).toBeDefined();
      expect(findUnit(category, to), `${id}/${to}`).toBeDefined();
      expect(from, id).not.toBe(to);
    }
    for (const category of UNIT_CATEGORIES) {
      const [a, b] = defaultPair(category);
      expect(category.units.includes(a) && category.units.includes(b), category.id).toBe(true);
      expect(a, category.id).not.toBe(b);
    }
  });

  it('reads numbers the way people type them', () => {
    expect(readNumber('1,00,000')).toBe(100000);
    expect(readNumber(' 2_500 ')).toBe(2500);
    expect(readNumber('3 1/2')).toBe(3.5);
    expect(readNumber('1/4')).toBe(0.25);
    expect(readNumber('-40')).toBe(-40);
    expect(readNumber('6.02e23')).toBe(6.02e23);
    expect(readNumber('.5')).toBe(0.5);
    expect(readNumber('')).toBeNull();
    expect(readNumber('12 kg')).toBeNull();
    expect(readNumber('abc')).toBeNull();
  });

  it('gives a fixed ratio only between proportional units', () => {
    expect(unitRatio(unit('length', 'mi'), unit('length', 'km'))).toBe(1.609344);
    expect(unitRatio(unit('temperature', 'C'), unit('temperature', 'F'))).toBeNull();
    expect(unitRatio(unit('fuel', 'mpg'), unit('fuel', 'L/100km'))).toBeNull();
    expect(unitRatio(unit('soundpressure', 'dBSPL'), unit('soundpressure', 'Pa'))).toBeNull();
  });
});
