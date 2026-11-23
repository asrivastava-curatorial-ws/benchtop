/**
 * Paper sizes: ISO 216 A and B, ISO 269 C envelopes, ISO 217 RA and SRA press
 * sheets, JIS B, North American, photo, card, and Indian trade sheets.
 * Dimensions are portrait, in millimetres.
 */

export type Series = 'iso-a' | 'iso-b' | 'iso-c' | 'sra' | 'jis' | 'us' | 'india' | 'photo' | 'card';

export interface Paper {
  readonly id: string;
  readonly name: string;
  readonly series: Series;
  readonly width: number;
  readonly height: number;
  readonly note?: string;
}

export const SERIES_NAMES: Record<Series, string> = {
  'iso-a': 'ISO A',
  'iso-b': 'ISO B',
  'iso-c': 'ISO C (envelopes)',
  sra: 'RA and SRA (press sheets)',
  jis: 'JIS B (Japan)',
  us: 'North American',
  india: 'Indian trade sizes',
  photo: 'Photo prints',
  card: 'Cards',
};

const IN = 25.4;
const mm = (id: string, name: string, series: Series, width: number, height: number, note?: string): Paper => ({ id, name, series, width, height, note });
const inch = (id: string, name: string, series: Series, width: number, height: number, note?: string): Paper => ({ id, name, series, width: width * IN, height: height * IN, note });

const A = [
  [841, 1189],
  [594, 841],
  [420, 594],
  [297, 420],
  [210, 297],
  [148, 210],
  [105, 148],
  [74, 105],
  [52, 74],
  [37, 52],
  [26, 37],
] as const;
const B = [
  [1000, 1414],
  [707, 1000],
  [500, 707],
  [353, 500],
  [250, 353],
  [176, 250],
  [125, 176],
  [88, 125],
  [62, 88],
  [44, 62],
  [31, 44],
] as const;
const C = [
  [917, 1297],
  [648, 917],
  [458, 648],
  [324, 458],
  [229, 324],
  [162, 229],
  [114, 162],
  [81, 114],
  [57, 81],
  [40, 57],
  [28, 40],
] as const;

export const PAPERS: readonly Paper[] = [
  ...A.map(([w, h], i) => mm(`a${i}`, `A${i}`, 'iso-a', w, h, i === 4 ? 'Office paper in most of the world, India included' : undefined)),
  ...B.map(([w, h], i) => mm(`b${i}`, `B${i}`, 'iso-b', w, h)),
  ...C.map(([w, h], i) => mm(`c${i}`, `C${i}`, 'iso-c', w, h, i === 4 ? 'Takes A4 flat' : i === 5 ? 'Takes A4 folded once' : i === 6 ? 'Takes A4 folded twice' : undefined)),
  mm('dl', 'DL', 'iso-c', 110, 220, 'Takes A4 folded in three'),
  mm('ra0', 'RA0', 'sra', 860, 1220),
  mm('ra1', 'RA1', 'sra', 610, 860),
  mm('ra2', 'RA2', 'sra', 430, 610),
  mm('ra3', 'RA3', 'sra', 305, 430),
  mm('ra4', 'RA4', 'sra', 215, 305),
  mm('sra0', 'SRA0', 'sra', 900, 1280),
  mm('sra1', 'SRA1', 'sra', 640, 900),
  mm('sra2', 'SRA2', 'sra', 450, 640),
  mm('sra3', 'SRA3', 'sra', 320, 450, 'Digital press sheet for A3 with bleed'),
  mm('sra4', 'SRA4', 'sra', 225, 320),
  mm('jis-b3', 'JIS B3', 'jis', 364, 515),
  mm('jis-b4', 'JIS B4', 'jis', 257, 364),
  mm('jis-b5', 'JIS B5', 'jis', 182, 257, 'Notebooks'),
  mm('jis-b6', 'JIS B6', 'jis', 128, 182),
  inch('letter', 'Letter', 'us', 8.5, 11),
  inch('legal', 'Legal', 'us', 8.5, 14),
  inch('tabloid', 'Tabloid (Ledger on its side)', 'us', 11, 17),
  inch('executive', 'Executive', 'us', 7.25, 10.5),
  inch('half-letter', 'Half Letter (Statement)', 'us', 5.5, 8.5),
  inch('junior-legal', 'Junior Legal', 'us', 5, 8),
  inch('ansi-c', 'ANSI C', 'us', 17, 22),
  inch('ansi-d', 'ANSI D', 'us', 22, 34),
  inch('ansi-e', 'ANSI E', 'us', 34, 44),
  inch('arch-a', 'Arch A', 'us', 9, 12),
  inch('arch-b', 'Arch B', 'us', 12, 18),
  inch('arch-c', 'Arch C', 'us', 18, 24),
  inch('arch-d', 'Arch D', 'us', 24, 36),
  inch('arch-e', 'Arch E', 'us', 36, 48),
  inch('fs', 'Foolscap (FS)', 'india', 8.5, 13.5, 'Still used by courts and government offices'),
  inch('crown', 'Crown', 'india', 15, 20, 'Press sheet'),
  inch('demy', 'Demy', 'india', 17.5, 22.5, 'Press sheet'),
  inch('royal', 'Royal', 'india', 20, 25, 'Press sheet'),
  inch('double-crown', 'Double Crown', 'india', 20, 30, 'Press sheet'),
  inch('double-demy', 'Double Demy', 'india', 22.5, 35, 'Press sheet'),
  inch('demy-quarter', '1/4 Demy (untrimmed)', 'india', 8.75, 11.25, 'Magazines and reports'),
  inch('demy-eighth', '1/8 Demy (untrimmed)', 'india', 5.625, 8.75, 'Books'),
  inch('crown-quarter', '1/4 Crown (untrimmed)', 'india', 7.5, 10),
  inch('crown-eighth', '1/8 Crown (untrimmed)', 'india', 5, 7.5, 'Books'),
  inch('photo-3r', '3R', 'photo', 3.5, 5),
  inch('photo-4r', '4R (4 × 6)', 'photo', 4, 6),
  inch('photo-5r', '5R (5 × 7)', 'photo', 5, 7),
  inch('photo-6r', '6R (6 × 8)', 'photo', 6, 8),
  inch('photo-8r', '8R (8 × 10)', 'photo', 8, 10),
  inch('photo-10r', '10R (10 × 12)', 'photo', 10, 12),
  inch('photo-12r', '12R (12 × 15)', 'photo', 12, 15),
  mm('id-1', 'ID-1 (bank and ID cards)', 'card', 53.98, 85.6, 'ISO/IEC 7810'),
  mm('card-eu', 'Business card (Europe)', 'card', 55, 85),
  inch('card-us', 'Business card (US, India)', 'card', 2, 3.5),
  mm('postcard', 'Postcard (A6)', 'card', 105, 148),
];

export const findPaper = (id: string) => PAPERS.find((p) => p.id === id);

export type Unit = 'mm' | 'cm' | 'in' | 'pt' | 'px';

export function inUnit(valueMm: number, unit: Unit, dpi = 300): number {
  switch (unit) {
    case 'cm':
      return valueMm / 10;
    case 'in':
      return valueMm / IN;
    case 'pt':
      return (valueMm / IN) * 72;
    case 'px':
      return (valueMm / IN) * dpi;
    default:
      return valueMm;
  }
}

/** How many pieces fit on a sheet in a plain grid, trying both ways round. */
export function fitsOn(piece: { width: number; height: number }, sheet: { width: number; height: number }, gap = 0): number {
  const grid = (pw: number, ph: number, sw: number, sh: number) => Math.floor((sw + gap) / (pw + gap)) * Math.floor((sh + gap) / (ph + gap));
  return Math.max(grid(piece.width, piece.height, sheet.width, sheet.height), grid(piece.height, piece.width, sheet.width, sheet.height));
}

/** Mass of one sheet in grams for a paper weight in g/m². */
export const sheetMass = (p: { width: number; height: number }, gsm: number) => ((p.width * p.height) / 1_000_000) * gsm;
