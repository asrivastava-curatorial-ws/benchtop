import type { Calculator } from '../types';
import { choice, count, num, pct, plain } from './_helpers';

const dB = (key: string, label: string, example?: number) => plain(key, label, example, { signed: true });
const metres = (key: string, label: string, example?: number) => num(key, label, 'length', 'm', { example });

export const ACOUSTICS: readonly Calculator[] = [
  {
    id: 'decibel-sum',
    name: 'Adding two sound levels',
    category: 'acoustics',
    description: 'The combined level of two noise sources in decibels, or the level of one source from the total and the other.',
    keywords: ['decibel addition', 'add db', 'combine sound levels', 'noise sources', 'spl sum', 'background noise'],
    vars: [dB('L1', 'Level of source 1 (dB)', 85), dB('L2', 'Level of source 2 (dB)', 82), dB('L', 'Combined level (dB)')],
    eqs: ['L = 10 * log10(10^(L1 / 10) + 10^(L2 / 10))'],
    notes: 'Levels add as powers: two equal sources are 3 dB louder than one, and a source 10 dB quieter adds less than 0.5 dB. Leave source 2 empty to subtract background noise from a total.',
  },
  {
    id: 'decibel-identical',
    name: 'Identical sources together',
    category: 'acoustics',
    description: 'How loud several identical machines, fans or speakers are together.',
    keywords: ['identical sources', 'number of machines', 'db per doubling', 'speakers', 'fans'],
    vars: [dB('L1', 'Level of one source (dB)', 70), count('n', 'Number of sources', 4), dB('L', 'Level of all of them (dB)')],
    eqs: ['L = L1 + 10 * log10(n)'],
  },
  {
    id: 'sound-distance',
    name: 'Sound level at a distance',
    category: 'acoustics',
    description: 'How a sound level falls away from a point source (6 dB per doubling of distance) or a line source (3 dB).',
    keywords: ['inverse square', 'distance attenuation', 'noise at distance', 'spl distance', 'road noise', 'line source'],
    vars: [
      dB('L1', 'Level at the first distance (dB)', 90),
      metres('r1', 'First distance', 1),
      metres('r2', 'Second distance', 10),
      choice(
        'source',
        'Source',
        [
          ['Point source (a machine, a loudspeaker)', 20],
          ['Line source (a busy road, a long pipe)', 10],
        ],
        0,
      ),
      dB('L2', 'Level at the second distance (dB)'),
    ],
    eqs: ['L2 = L1 - source * log10(r2 / r1)'],
    notes: 'Free field with no reflections or air absorption; outdoors over long distances, ground and air add more loss.',
  },
  {
    id: 'sound-power-pressure',
    name: 'Sound power to sound pressure',
    category: 'acoustics',
    description: 'The sound pressure level at a distance from a source of known sound power level, such as a fan, compressor or generator.',
    keywords: ['sound power level', 'lw', 'lp', 'directivity', 'free field', 'generator noise', 'machine noise'],
    vars: [
      dB('Lw', 'Sound power level (dB re 1 pW)', 95),
      metres('r', 'Distance', 5),
      choice(
        'Q',
        'Where the source sits',
        [
          ['In free space', 1],
          ['On a floor or against a wall', 2],
          ['Where a floor meets a wall', 4],
          ['In a corner', 8],
        ],
        1,
      ),
      dB('Lp', 'Sound pressure level (dB re 20 µPa)'),
    ],
    eqs: ['Lp = Lw + 10 * log10(Q / (4 * pi * r^2))'],
    notes: 'Direct sound only. Indoors the reverberant field adds to this away from the source.',
  },
  {
    id: 'reverberation-time',
    name: 'Reverberation time (RT60)',
    category: 'acoustics',
    description: 'How long a room rings after a sound stops, from its volume, surface area and average absorption (Sabine or Eyring).',
    keywords: ['rt60', 'reverberation', 'sabine', 'eyring', 'room acoustics', 'absorption', 'echo', 'auditorium', 'classroom'],
    vars: [
      num('V', 'Room volume', 'volume', 'm³', { example: 300 }),
      num('S', 'Total surface area (walls, floor, ceiling)', 'area', 'm²', { example: 290 }),
      plain('alpha', 'Average absorption coefficient', 0.2, { help: 'From 0.02 for painted concrete to about 0.9 for acoustic panels; a furnished room is often 0.15 to 0.3.' }),
      choice(
        'formula',
        'Formula',
        [
          ['Sabine (lively rooms)', 0],
          ['Eyring (rooms with a lot of absorption)', 1],
        ],
        0,
      ),
      num('A', 'Absorption area', 'area', 'm²'),
      num('RT', 'Reverberation time', 'time', 's'),
    ],
    eqs: ['A = S * alpha', { when: { formula: 0 }, eq: 'RT = 0.161 * V / A' }, { when: { formula: 1 }, eq: 'RT = 0.161 * V / (-S * log(1 - alpha))' }],
    notes: 'Typical targets: 0.4 to 0.6 s for classrooms and offices, 0.8 to 1.2 s for lecture halls and theatres, 1.5 to 2 s for concert halls.',
  },
  {
    id: 'sound-wavelength',
    name: 'Wavelength of sound',
    category: 'acoustics',
    description: 'Speed of sound in air at a temperature and the wavelength of a frequency.',
    keywords: ['wavelength', 'speed of sound', 'frequency', 'quarter wave', 'acoustic panel thickness'],
    vars: [
      num('f', 'Frequency', 'frequency', 'Hz', { example: 1000 }),
      num('T', 'Air temperature', 'temperature', 'K', { show: '°C', example: 20 }),
      num('c', 'Speed of sound in air', 'speed', 'm/s'),
      num('lambda', 'Wavelength', 'length', 'm', { show: 'cm' }),
    ],
    eqs: ['c = 20.0468 * sqrt(T)', 'lambda = c / f'],
    notes: 'Dry air as an ideal gas (γ = 1.4). A porous absorber works well from about a quarter of the wavelength in thickness.',
  },
  {
    id: 'a-weighting',
    name: 'A and C frequency weighting',
    category: 'acoustics',
    description: 'The A-weighting and C-weighting corrections at a frequency (IEC 61672), to turn band levels into dB(A) or dB(C).',
    keywords: ['a weighting', 'dba', 'dbc', 'c weighting', 'iec 61672', 'octave band', 'frequency weighting'],
    vars: [num('f', 'Frequency', 'frequency', 'Hz', { example: 100 }), dB('A', 'A-weighting (dB)'), dB('C', 'C-weighting (dB)')],
    eqs: [
      'A = 20 * log10(12194^2 * f^4 / ((f^2 + 20.6^2) * sqrt((f^2 + 107.7^2) * (f^2 + 737.9^2)) * (f^2 + 12194^2))) + 2',
      'C = 20 * log10(12194^2 * f^2 / ((f^2 + 20.6^2) * (f^2 + 12194^2))) + 0.062',
    ],
    notes: 'Add the weighting to each octave or third-octave band level, then add the bands in powers (see “Adding two sound levels”).',
  },
  {
    id: 'noise-dose',
    name: 'Noise exposure and daily dose',
    category: 'acoustics',
    description: 'How long a worker may stay in a noise level each day, and the dose for the time actually spent.',
    keywords: ['noise dose', 'permissible exposure', 'occupational noise', 'hearing protection', 'osha', 'exchange rate', 'twa'],
    vars: [
      dB('L', 'Noise level (dB(A))', 95),
      choice(
        'rule',
        'Exposure rule',
        [
          ['85 dB(A) for 8 h, 3 dB exchange (EU, NIOSH, ISO 1999)', 0],
          ['90 dB(A) for 8 h, 5 dB exchange (OSHA)', 1],
        ],
        0,
      ),
      num('allowed', 'Allowed time per day', 'time', 's', { show: 'h' }),
      num('t', 'Time actually spent', 'time', 's', { show: 'h', example: 2 }),
      pct('dose', 'Daily noise dose'),
    ],
    eqs: [{ when: { rule: 0 }, eq: 'allowed = 8 * 3600 / 2^((L - 85) / 3)' }, { when: { rule: 1 }, eq: 'allowed = 8 * 3600 / 2^((L - 90) / 5)' }, 'dose = t / allowed'],
    notes: 'A dose above 100 % needs hearing protection or less time in the noise. Follow the limits your local regulation sets.',
  },
  {
    id: 'mass-law',
    name: 'Sound insulation of a wall (mass law)',
    category: 'acoustics',
    description: 'Approximate sound reduction of a single solid wall or panel from its surface mass and the frequency.',
    keywords: ['mass law', 'transmission loss', 'sound insulation', 'sound reduction index', 'wall', 'partition', 'soundproofing'],
    vars: [
      num('rho', 'Material density', 'density', 'kg/m³', { example: 2300, help: 'Concrete 2300, brick 1800, gypsum board 800, glass 2500, plywood 600 kg/m³.' }),
      num('t', 'Thickness', 'length', 'm', { show: 'mm', example: 100 }),
      num('f', 'Frequency', 'frequency', 'Hz', { example: 500 }),
      dB('TL', 'Sound reduction (dB)'),
    ],
    eqs: ['TL = 20 * log10(rho * t * f) - 47'],
    notes:
      'Field-incidence mass law for one solid leaf: each doubling of mass or frequency adds about 6 dB. Real walls fall short near their coincidence frequency and through gaps and flanking paths.',
  },
];
