/**
 * Jyotisha calculations for a birth chart (kundli) and the panchang:
 * sidereal positions of the nine grahas and the ascendant, signs,
 * nakshatras and padas, divisional charts, tithi, yoga, karana and vara,
 * the lunar month and samvat years, Vimshottari dashas, and Ashtakoota
 * matching of two charts.
 *
 * Positions come from astronomy-engine (VSOP87 and the ELP Moon, accurate
 * to well under an arcminute).  The zodiac is sidereal with the Lahiri
 * (Chitrapaksha) ayanamsa as Indian panchangs use it: 23°15′00.658″ on
 * 21 March 1956, carried by the IAU 2006 general precession, plus nutation.
 * With it the Sun's sankrantis fall within a minute of the published ones.
 * The interpretation of a chart is a matter of tradition; the tables used
 * for matching (Vashya, Yoni, Gana) are the classical ones, which vary a
 * little between regions.
 */
import * as Astronomy from 'astronomy-engine';

const DEG = Math.PI / 180;
const norm = (x: number) => ((x % 360) + 360) % 360;
/** −180 to 180. */
const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;

/* ---------------------------------------------------------------- names -- */

export type Lang = 'en' | 'hi';

export const GRAHAS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn', 'rahu', 'ketu'] as const;
export type Graha = (typeof GRAHAS)[number];

const GRAHA_NAMES: Record<Lang, Record<Graha, readonly [string, string]>> = {
  en: {
    sun: ['Sun', 'Su'],
    moon: ['Moon', 'Mo'],
    mars: ['Mars', 'Ma'],
    mercury: ['Mercury', 'Me'],
    jupiter: ['Jupiter', 'Ju'],
    venus: ['Venus', 'Ve'],
    saturn: ['Saturn', 'Sa'],
    rahu: ['Rahu', 'Ra'],
    ketu: ['Ketu', 'Ke'],
  },
  hi: { sun: ['सूर्य', 'सू'], moon: ['चंद्र', 'चं'], mars: ['मंगल', 'मं'], mercury: ['बुध', 'बु'], jupiter: ['गुरु', 'गु'], venus: ['शुक्र', 'शु'], saturn: ['शनि', 'श'], rahu: ['राहु', 'रा'], ketu: ['केतु', 'के'] },
};
export const grahaName = (g: Graha, lang: Lang = 'en', short = false) => GRAHA_NAMES[lang][g][short ? 1 : 0];
export const lagnaName = (lang: Lang = 'en', short = false) => (lang === 'hi' ? (short ? 'ल' : 'लग्न') : short ? 'As' : 'Ascendant');

const SIGNS: Record<Lang, readonly string[]> = {
  en: [
    'Mesha (Aries)',
    'Vrishabha (Taurus)',
    'Mithuna (Gemini)',
    'Karka (Cancer)',
    'Simha (Leo)',
    'Kanya (Virgo)',
    'Tula (Libra)',
    'Vrishchika (Scorpio)',
    'Dhanu (Sagittarius)',
    'Makara (Capricorn)',
    'Kumbha (Aquarius)',
    'Meena (Pisces)',
  ],
  hi: ['मेष', 'वृषभ', 'मिथुन', 'कर्क', 'सिंह', 'कन्या', 'तुला', 'वृश्चिक', 'धनु', 'मकर', 'कुंभ', 'मीन'],
};
export const signName = (sign: number, lang: Lang = 'en') => SIGNS[lang][((sign % 12) + 12) % 12] as string;
export const SIGN_LORDS: readonly Graha[] = ['mars', 'venus', 'mercury', 'moon', 'sun', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'saturn', 'jupiter'];

const NAKSHATRAS: Record<Lang, readonly string[]> = {
  en: [
    'Ashwini',
    'Bharani',
    'Krittika',
    'Rohini',
    'Mrigashira',
    'Ardra',
    'Punarvasu',
    'Pushya',
    'Ashlesha',
    'Magha',
    'Purva Phalguni',
    'Uttara Phalguni',
    'Hasta',
    'Chitra',
    'Swati',
    'Vishakha',
    'Anuradha',
    'Jyeshtha',
    'Mula',
    'Purva Ashadha',
    'Uttara Ashadha',
    'Shravana',
    'Dhanishta',
    'Shatabhisha',
    'Purva Bhadrapada',
    'Uttara Bhadrapada',
    'Revati',
  ],
  hi: [
    'अश्विनी',
    'भरणी',
    'कृत्तिका',
    'रोहिणी',
    'मृगशिरा',
    'आर्द्रा',
    'पुनर्वसु',
    'पुष्य',
    'आश्लेषा',
    'मघा',
    'पूर्वा फाल्गुनी',
    'उत्तरा फाल्गुनी',
    'हस्त',
    'चित्रा',
    'स्वाति',
    'विशाखा',
    'अनुराधा',
    'ज्येष्ठा',
    'मूल',
    'पूर्वाषाढ़ा',
    'उत्तराषाढ़ा',
    'श्रवण',
    'धनिष्ठा',
    'शतभिषा',
    'पूर्वा भाद्रपद',
    'उत्तरा भाद्रपद',
    'रेवती',
  ],
};
export const nakshatraName = (n: number, lang: Lang = 'en') => NAKSHATRAS[lang][n] as string;

/** Vimshottari order, from Ashwini's lord. */
export const DASHA_LORDS: readonly Graha[] = ['ketu', 'venus', 'sun', 'moon', 'mars', 'rahu', 'jupiter', 'saturn', 'mercury'];
export const DASHA_YEARS: Readonly<Record<Graha, number>> = { ketu: 7, venus: 20, sun: 6, moon: 10, mars: 7, rahu: 18, jupiter: 16, saturn: 19, mercury: 17 };
export const nakshatraLord = (n: number): Graha => DASHA_LORDS[n % 9] as Graha;

const TITHIS: Record<Lang, readonly string[]> = {
  en: ['Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami', 'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami', 'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi', 'Purnima', 'Amavasya'],
  hi: ['प्रतिपदा', 'द्वितीया', 'तृतीया', 'चतुर्थी', 'पंचमी', 'षष्ठी', 'सप्तमी', 'अष्टमी', 'नवमी', 'दशमी', 'एकादशी', 'द्वादशी', 'त्रयोदशी', 'चतुर्दशी', 'पूर्णिमा', 'अमावस्या'],
};
/** Tithi 0 to 29: 0–14 bright half (Shukla), 15–29 dark half (Krishna). */
export function tithiName(t: number, lang: Lang = 'en'): string {
  const names = TITHIS[lang];
  const paksha = t < 15 ? (lang === 'hi' ? 'शुक्ल' : 'Shukla') : lang === 'hi' ? 'कृष्ण' : 'Krishna';
  const day = t % 15;
  const name = t === 14 ? names[14] : t === 29 ? names[15] : names[day];
  return `${paksha} ${name}`;
}

const YOGAS = [
  'Vishkambha',
  'Priti',
  'Ayushman',
  'Saubhagya',
  'Shobhana',
  'Atiganda',
  'Sukarma',
  'Dhriti',
  'Shula',
  'Ganda',
  'Vriddhi',
  'Dhruva',
  'Vyaghata',
  'Harshana',
  'Vajra',
  'Siddhi',
  'Vyatipata',
  'Variyana',
  'Parigha',
  'Shiva',
  'Siddha',
  'Sadhya',
  'Shubha',
  'Shukla',
  'Brahma',
  'Indra',
  'Vaidhriti',
];
const YOGAS_HI = [
  'विष्कम्भ',
  'प्रीति',
  'आयुष्मान',
  'सौभाग्य',
  'शोभन',
  'अतिगण्ड',
  'सुकर्मा',
  'धृति',
  'शूल',
  'गण्ड',
  'वृद्धि',
  'ध्रुव',
  'व्याघात',
  'हर्षण',
  'वज्र',
  'सिद्धि',
  'व्यतीपात',
  'वरीयान',
  'परिघ',
  'शिव',
  'सिद्ध',
  'साध्य',
  'शुभ',
  'शुक्ल',
  'ब्रह्म',
  'इन्द्र',
  'वैधृति',
];
export const yogaName = (y: number, lang: Lang = 'en') => (lang === 'hi' ? YOGAS_HI[y] : YOGAS[y]) as string;

const KARANAS_MOVABLE = ['Bava', 'Balava', 'Kaulava', 'Taitila', 'Gara', 'Vanija', 'Vishti'];
const KARANAS_MOVABLE_HI = ['बव', 'बालव', 'कौलव', 'तैतिल', 'गर', 'वणिज', 'विष्टि'];
/** Karana 0 to 59 (half-tithis from the new moon). */
export function karanaName(k: number, lang: Lang = 'en'): string {
  if (k === 0) return lang === 'hi' ? 'किंस्तुघ्न' : 'Kimstughna';
  if (k >= 57) return (lang === 'hi' ? ['शकुनि', 'चतुष्पद', 'नाग'] : ['Shakuni', 'Chatushpada', 'Naga'])[k - 57] as string;
  return (lang === 'hi' ? KARANAS_MOVABLE_HI : KARANAS_MOVABLE)[(k - 1) % 7] as string;
}

const VARAS: Record<Lang, readonly string[]> = {
  en: ['Ravivara (Sunday)', 'Somavara (Monday)', 'Mangalavara (Tuesday)', 'Budhavara (Wednesday)', 'Guruvara (Thursday)', 'Shukravara (Friday)', 'Shanivara (Saturday)'],
  hi: ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'],
};
export const varaName = (v: number, lang: Lang = 'en') => VARAS[lang][v] as string;

const MONTHS: Record<Lang, readonly string[]> = {
  en: ['Chaitra', 'Vaishakha', 'Jyeshtha', 'Ashadha', 'Shravana', 'Bhadrapada', 'Ashwin', 'Kartika', 'Margashirsha', 'Pausha', 'Magha', 'Phalguna'],
  hi: ['चैत्र', 'वैशाख', 'ज्येष्ठ', 'आषाढ़', 'श्रावण', 'भाद्रपद', 'आश्विन', 'कार्तिक', 'मार्गशीर्ष', 'पौष', 'माघ', 'फाल्गुन'],
};
export const monthName = (m: number, lang: Lang = 'en') => MONTHS[lang][((m % 12) + 12) % 12] as string;

/* ------------------------------------------------------------- the frame -- */

const LAHIRI_EPOCH = (2435553.5 - 2451545.0) / 36525;
const LAHIRI_1956 = 23.250182778;
/** General precession in longitude since J2000, degrees (IAU 2006, Capitaine et al.). */
const precession = (T: number) => (5028.796195 * T + 1.1054348 * T ** 2 + 0.00007964 * T ** 3 - 0.000023857 * T ** 4 - 0.0000000383 * T ** 5) / 3600;

export type Zodiac = 'lahiri' | 'tropical';

/** The ayanamsa at a time, degrees: mean (precession only) and true (with nutation in longitude). */
export function ayanamsa(time: Astronomy.FlexibleDateTime, zodiac: Zodiac = 'lahiri'): { mean: number; true: number } {
  if (zodiac === 'tropical') return { mean: 0, true: 0 };
  const t = Astronomy.MakeTime(time);
  const mean = LAHIRI_1956 + precession(t.tt / 36525) - precession(LAHIRI_EPOCH);
  return { mean, true: mean + Astronomy.e_tilt(t).dpsi / 3600 };
}

/* --------------------------------------------------------------- the chart -- */

export type NodeKind = 'mean' | 'true';

export interface Position {
  /** Sidereal longitude, 0 to 360. */
  readonly longitude: number;
  readonly latitude: number;
  /** Degrees a day; negative when retrograde. */
  readonly speed: number;
  readonly retrograde: boolean;
  readonly sign: number;
  /** Degrees within the sign. */
  readonly degree: number;
  readonly nakshatra: number;
  readonly pada: number;
  /** Whole-sign house from the ascendant, 1 to 12 (the ascendant itself is in house 1). */
  readonly house: number;
}

export interface GrahaPosition extends Position {
  readonly graha: Graha;
  readonly dignity: 'exalted' | 'debilitated' | 'own' | null;
}

export interface Chart {
  readonly instant: Date;
  readonly lat: number;
  readonly lon: number;
  readonly zodiac: Zodiac;
  readonly ayanamsa: number;
  readonly lagna: Position;
  /** The midheaven (10th-house cusp), sidereal. */
  readonly mc: number;
  readonly grahas: readonly GrahaPosition[];
}

const BODY: Partial<Record<Graha, Astronomy.Body>> = {
  sun: Astronomy.Body.Sun,
  moon: Astronomy.Body.Moon,
  mars: Astronomy.Body.Mars,
  mercury: Astronomy.Body.Mercury,
  jupiter: Astronomy.Body.Jupiter,
  venus: Astronomy.Body.Venus,
  saturn: Astronomy.Body.Saturn,
};

/** Apparent tropical ecliptic longitude and latitude of date (true equinox). */
function tropical(body: Astronomy.Body, time: Astronomy.AstroTime): { lon: number; lat: number } {
  const e = Astronomy.Ecliptic(Astronomy.GeoVector(body, time, true));
  return { lon: e.elon, lat: e.elat };
}

/** The Moon's mean ascending node (Meeus 47.7), tropical of the mean equinox of date. */
function meanNode(time: Astronomy.AstroTime): number {
  const T = time.tt / 36525;
  return norm(125.0445479 - 1934.1362891 * T + 0.0020754 * T ** 2 + T ** 3 / 467441 - T ** 4 / 60616000);
}

/** The Moon's true (osculating) node from its orbit's angular momentum, tropical of date. */
function trueNode(time: Astronomy.AstroTime): number {
  const dt = 1 / 24;
  const at = (d: number) => Astronomy.Ecliptic(Astronomy.GeoMoon(time.AddDays(d))).vec;
  const r = at(0);
  const a = at(-dt);
  const b = at(dt);
  const v = { x: (b.x - a.x) / (2 * dt), y: (b.y - a.y) / (2 * dt), z: (b.z - a.z) / (2 * dt) };
  const hx = r.y * v.z - r.z * v.y;
  const hy = r.z * v.x - r.x * v.z;
  return norm(Math.atan2(hx, -hy) / DEG);
}

const EXALTED: Partial<Record<Graha, number>> = { sun: 0, moon: 1, mars: 9, mercury: 5, jupiter: 3, venus: 11, saturn: 6 };
const OWN: Partial<Record<Graha, readonly number[]>> = { sun: [4], moon: [3], mars: [0, 7], mercury: [2, 5], jupiter: [8, 11], venus: [1, 6], saturn: [9, 10] };

function dignity(g: Graha, sign: number): GrahaPosition['dignity'] {
  const ex = EXALTED[g];
  if (ex === undefined) return null;
  if (sign === ex) return 'exalted';
  if (sign === (ex + 6) % 12) return 'debilitated';
  return OWN[g]?.includes(sign) ? 'own' : null;
}

const NAK = 360 / 27;

function position(longitude: number, latitude: number, speed: number, lagnaSign: number): Position {
  const lon = norm(longitude);
  const sign = Math.floor(lon / 30) % 12;
  const nakshatra = Math.floor(lon / NAK) % 27;
  return {
    longitude: lon,
    latitude,
    speed,
    retrograde: speed < 0,
    sign,
    degree: lon - sign * 30,
    nakshatra,
    pada: (Math.floor(lon / (NAK / 4)) % 4) + 1,
    house: ((sign - lagnaSign + 12) % 12) + 1,
  };
}

export interface ChartOptions {
  readonly zodiac?: Zodiac;
  readonly node?: NodeKind;
}

/** The ascendant and midheaven, tropical (true equinox), for a time and place. */
export function angles(time: Astronomy.AstroTime, lat: number, lon: number): { asc: number; mc: number } {
  const eps = Astronomy.e_tilt(time).tobl * DEG;
  const ramc = norm(Astronomy.SiderealTime(time) * 15 + lon) * DEG;
  const phi = Math.max(-89.9, Math.min(89.9, lat)) * DEG;
  const asc = norm(Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))) / DEG);
  const mc = norm(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(eps)) / DEG);
  return { asc, mc };
}

export function chart(instant: Date, lat: number, lon: number, o: ChartOptions = {}): Chart {
  if (Number.isNaN(instant.getTime())) throw new Error('The date and time are not valid.');
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) throw new Error('Latitude must be −90 to 90 and longitude −180 to 180.');
  const zodiac = o.zodiac ?? 'lahiri';
  const time = Astronomy.MakeTime(instant);
  const ayan = ayanamsa(time, zodiac);
  const { asc, mc } = angles(time, lat, lon);
  const lagnaLon = norm(asc - ayan.true);
  const lagnaSign = Math.floor(lagnaLon / 30);
  const lagna = position(lagnaLon, 0, 0, lagnaSign);
  const grahas: GrahaPosition[] = [];
  const half = 0.25;
  for (const g of GRAHAS) {
    let lonT: number;
    let latT = 0;
    let speed: number;
    if (g === 'rahu' || g === 'ketu') {
      if ((o.node ?? 'mean') === 'mean') {
        lonT = meanNode(time) - ayan.mean;
        speed = wrap(meanNode(time.AddDays(half)) - meanNode(time.AddDays(-half))) / (2 * half);
      } else {
        lonT = trueNode(time) - ayan.true;
        speed = wrap(trueNode(time.AddDays(half)) - trueNode(time.AddDays(-half))) / (2 * half);
      }
      if (g === 'ketu') lonT += 180;
    } else {
      const body = BODY[g] as Astronomy.Body;
      const now = tropical(body, time);
      lonT = now.lon - ayan.true;
      latT = now.lat;
      speed = wrap(tropical(body, time.AddDays(half)).lon - tropical(body, time.AddDays(-half)).lon) / (2 * half);
    }
    const p = position(lonT, latT, speed, lagnaSign);
    grahas.push({ ...p, graha: g, dignity: dignity(g, p.sign) });
  }
  return { instant, lat, lon, zodiac, ayanamsa: ayan.true, lagna, mc: norm(mc - ayan.true), grahas };
}

/* ------------------------------------------------------- divisional charts -- */

export const VARGAS = [1, 2, 3, 7, 9, 10, 12] as const;
export type Varga = (typeof VARGAS)[number];
export const VARGA_NAMES: Readonly<Record<Varga, string>> = { 1: 'Rasi (D1)', 2: 'Hora (D2)', 3: 'Drekkana (D3)', 7: 'Saptamsa (D7)', 9: 'Navamsa (D9)', 10: 'Dasamsa (D10)', 12: 'Dwadasamsa (D12)' };

/** The sign a sidereal longitude falls in, in a divisional chart (Parashara's rules). */
export function vargaSign(longitude: number, d: Varga): number {
  const lon = norm(longitude);
  const sign = Math.floor(lon / 30) % 12;
  const deg = lon - sign * 30;
  const odd = sign % 2 === 0; // Mesha, Mithuna … are the odd signs
  switch (d) {
    case 1:
      return sign;
    case 2:
      return deg < 15 === odd ? 4 : 3; // Simha or Karka
    case 3:
      return (sign + 4 * Math.floor(deg / 10)) % 12;
    case 7:
      return ((odd ? sign : sign + 6) + Math.floor(deg / (30 / 7))) % 12;
    case 9:
      return Math.floor((lon * 9) / 30) % 12;
    case 10:
      return ((odd ? sign : sign + 8) + Math.floor(deg / 3)) % 12;
    default:
      return (sign + Math.floor(deg / 2.5)) % 12;
  }
}

/** Signs of the ascendant and each graha in a divisional chart. */
export function varga(c: Chart, d: Varga): { lagna: number; grahas: { graha: Graha; sign: number; retrograde: boolean }[] } {
  return { lagna: vargaSign(c.lagna.longitude, d), grahas: c.grahas.map((g) => ({ graha: g.graha, sign: vargaSign(g.longitude, d), retrograde: g.retrograde })) };
}

/* --------------------------------------------------------------- panchang -- */

export interface Element {
  readonly index: number;
  readonly name: string;
  /** When it ends (null if not found within two days). */
  readonly ends: Date | null;
}

export interface Panchang {
  readonly tithi: Element;
  readonly nakshatra: Element;
  readonly yoga: Element;
  readonly karana: Element;
  readonly vara: number;
  /** Before the day's sunrise, the Hindu day (and its vara) is still the previous one. */
  readonly beforeSunrise: boolean;
  readonly paksha: 'shukla' | 'krishna';
  readonly sunrise: Date | null;
  readonly sunset: Date | null;
  readonly moonrise: Date | null;
  readonly moonset: Date | null;
  /** Amanta month (from new moon), purnimanta month (from full moon), whether the month is adhika. */
  readonly amanta: number;
  readonly purnimanta: number;
  readonly adhika: boolean;
  readonly vikramSamvat: number;
  readonly shakaSamvat: number;
  readonly sunSign: number;
  readonly moonSign: number;
}

const elongation = (time: Astronomy.AstroTime) => norm(tropical(Astronomy.Body.Moon, time).lon - tropical(Astronomy.Body.Sun, time).lon);
const moonSidereal = (time: Astronomy.AstroTime) => norm(tropical(Astronomy.Body.Moon, time).lon - ayanamsa(time).true);
const sunSidereal = (time: Astronomy.AstroTime) => norm(tropical(Astronomy.Body.Sun, time).lon - ayanamsa(time).true);
const yogaAngle = (time: Astronomy.AstroTime) => norm(moonSidereal(time) + sunSidereal(time));

/** When a steadily growing angle next reaches `target`, searched in steps then halved to a few seconds. */
function whenReaches(angle: (t: Astronomy.AstroTime) => number, target: number, from: Astronomy.AstroTime, stepDays = 1 / 12, limitDays = 2.5): Date | null {
  const gap = (t: Astronomy.AstroTime) => wrap(angle(t) - target);
  let a = from;
  let ga = gap(a);
  for (let d = stepDays; d <= limitDays + 1e-9; d += stepDays) {
    const b = from.AddDays(d);
    const gb = gap(b);
    if (ga < 0 && gb >= 0 && gb - ga < 90) {
      let lo = a.ut;
      let hi = b.ut;
      for (let i = 0; i < 30 && hi - lo > 2 / 86400; i++) {
        const mid = (lo + hi) / 2;
        if (gap(Astronomy.MakeTime(mid)) < 0) lo = mid;
        else hi = mid;
      }
      return Astronomy.MakeTime(hi).date;
    }
    a = b;
    ga = gb;
  }
  return null;
}

/** The local calendar date of an instant in a time zone, and the UTC instant of its midnight. */
function localMidnight(instant: Date, zone: string): { y: number; m: number; d: number; weekday: number; midnight: Date } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hourCycle: 'h23' }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  // Midnight in the zone: start from UTC midnight and correct by the zone's offset.
  const guess = Date.UTC(y, m - 1, d);
  const offset = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(new Date(t));
    const g = (type: string) => Number(p.find((x) => x.type === type)?.value ?? 0);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - t;
  };
  let midnight = guess - offset(guess);
  midnight = guess - offset(midnight);
  return { y, m, d, weekday, midnight: new Date(midnight) };
}

/** Panchang elements at an instant for a place, with the day's sunrise and sunset. */
export function panchang(instant: Date, lat: number, lon: number, zone: string, lang: Lang = 'en'): Panchang {
  const time = Astronomy.MakeTime(instant);
  const observer = new Astronomy.Observer(lat, lon, 0);
  const local = localMidnight(instant, zone);
  const day = Astronomy.MakeTime(local.midnight);
  const event = (body: Astronomy.Body, direction: 1 | -1) => Astronomy.SearchRiseSet(body, observer, direction, day, 1)?.date ?? null;
  const sunrise = event(Astronomy.Body.Sun, 1);
  const sunset = event(Astronomy.Body.Sun, -1);
  // The Hindu day runs from sunrise to sunrise.
  const vara = sunrise && instant.getTime() < sunrise.getTime() ? (local.weekday + 6) % 7 : local.weekday;

  const el = elongation(time);
  const t = Math.floor(el / 12) % 30;
  const k = Math.floor(el / 6) % 60;
  const moon = moonSidereal(time);
  const n = Math.floor(moon / NAK) % 27;
  const y = Math.floor(yogaAngle(time) / NAK) % 27;

  // The lunar month: named from the Sun's sign at the new moon that began it.
  const lastNew = Astronomy.SearchMoonPhase(0, time.AddDays(-31), 31.5);
  const nextNew = Astronomy.SearchMoonPhase(0, time, 31);
  const signAt = (at: Astronomy.AstroTime | null) => (at ? Math.floor(sunSidereal(at) / 30) % 12 : 0);
  let startNew = lastNew;
  // SearchMoonPhase from 31 days back finds the first new moon after that; step on to the latest before now.
  while (startNew) {
    const after = Astronomy.SearchMoonPhase(0, startNew.AddDays(1), 31);
    if (!after || after.ut > time.ut) break;
    startNew = after;
  }
  const startSign = signAt(startNew);
  const endSign = signAt(nextNew);
  const adhika = startSign === endSign;
  const amanta = (startSign + 1) % 12;
  const purnimanta = t >= 15 ? (amanta + 1) % 12 : amanta;

  // Samvat years change at the new moon that begins Chaitra (an adhika Chaitra, when there is one).
  const previousNew = (at: Astronomy.AstroTime) => Astronomy.SearchMoonPhase(0, at.AddDays(-32), 30);
  const monthAt = (at: Astronomy.AstroTime) => (signAt(at) + 1) % 12;
  let yearStart = startNew;
  for (let i = 0; i < 14 && yearStart; i++) {
    if (monthAt(yearStart) === 0) {
      const before = previousNew(yearStart);
      if (before && monthAt(before) === 0) yearStart = before;
      break;
    }
    yearStart = previousNew(yearStart);
  }
  // The year of that new moon, counted in Indian time.
  const startYear = yearStart ? new Date(yearStart.date.getTime() + 5.5 * 3600e3).getUTCFullYear() : instant.getUTCFullYear();

  return {
    tithi: { index: t, name: tithiName(t, lang), ends: whenReaches(elongation, ((t + 1) % 30) * 12, time) },
    nakshatra: { index: n, name: nakshatraName(n, lang), ends: whenReaches(moonSidereal, ((n + 1) % 27) * NAK, time) },
    yoga: { index: y, name: yogaName(y, lang), ends: whenReaches(yogaAngle, ((y + 1) % 27) * NAK, time) },
    karana: { index: k, name: karanaName(k, lang), ends: whenReaches(elongation, ((k + 1) % 60) * 6, time, 1 / 24, 1.5) },
    vara,
    beforeSunrise: vara !== local.weekday,
    paksha: t < 15 ? 'shukla' : 'krishna',
    sunrise,
    sunset,
    moonrise: event(Astronomy.Body.Moon, 1),
    moonset: event(Astronomy.Body.Moon, -1),
    amanta,
    purnimanta,
    adhika,
    vikramSamvat: startYear + 57,
    shakaSamvat: startYear - 78,
    sunSign: Math.floor(sunSidereal(time) / 30) % 12,
    moonSign: Math.floor(moon / 30) % 12,
  };
}

/* ------------------------------------------------------------------ dashas -- */

/** Days in a dasha year: the tropical year, as most current software uses. */
export const DASHA_YEAR_DAYS = 365.2425;

export interface Period {
  readonly lord: Graha;
  readonly start: Date;
  readonly end: Date;
}

export interface Mahadasha extends Period {
  readonly antardashas: readonly Period[];
}

/** Vimshottari mahadashas (with antardashas) for 120 years from the one running at birth. */
export function vimshottari(moonLongitude: number, birth: Date): { balance: number; dashas: Mahadasha[] } {
  const lon = norm(moonLongitude);
  const n = Math.floor(lon / NAK);
  const elapsed = (lon - n * NAK) / NAK;
  const first = n % 9;
  const yearMs = DASHA_YEAR_DAYS * 86400e3;
  const firstYears = DASHA_YEARS[DASHA_LORDS[first] as Graha];
  let start = birth.getTime() - elapsed * firstYears * yearMs;
  const dashas: Mahadasha[] = [];
  for (let i = 0; i < 9; i++) {
    const lord = DASHA_LORDS[(first + i) % 9] as Graha;
    const years = DASHA_YEARS[lord];
    const end = start + years * yearMs;
    const antardashas: Period[] = [];
    let a = start;
    for (let j = 0; j < 9; j++) {
      const sub = DASHA_LORDS[(first + i + j) % 9] as Graha;
      const length = ((years * DASHA_YEARS[sub]) / 120) * yearMs;
      antardashas.push({ lord: sub, start: new Date(a), end: new Date(a + length) });
      a += length;
    }
    dashas.push({ lord, start: new Date(start), end: new Date(end), antardashas });
    start = end;
  }
  return { balance: (1 - elapsed) * firstYears, dashas };
}

/** The mahadasha and antardasha running at an instant. */
export function runningDasha(dashas: readonly Mahadasha[], at: Date): { maha: Mahadasha; antar: Period } | null {
  const t = at.getTime();
  const maha = dashas.find((d) => d.start.getTime() <= t && t < d.end.getTime());
  const antar = maha?.antardashas.find((d) => d.start.getTime() <= t && t < d.end.getTime());
  return maha && antar ? { maha, antar } : null;
}

/* ---------------------------------------------------------------- matching -- */

/** By nakshatra: gana (0 Deva, 1 Manushya, 2 Rakshasa), yoni animal, nadi (0 Aadi, 1 Madhya, 2 Antya). */
const GANA = [0, 1, 2, 1, 0, 1, 0, 0, 2, 2, 1, 1, 0, 2, 0, 2, 0, 2, 2, 1, 1, 0, 2, 2, 1, 1, 0];
const NADI = [0, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1, 0, 0, 1, 2];
export const YONI_ANIMALS = ['Horse', 'Elephant', 'Sheep', 'Serpent', 'Dog', 'Cat', 'Rat', 'Cow', 'Buffalo', 'Tiger', 'Deer', 'Monkey', 'Mongoose', 'Lion'];
const YONI = [0, 1, 2, 3, 3, 4, 5, 2, 5, 6, 6, 7, 8, 9, 8, 9, 10, 10, 4, 11, 12, 11, 13, 0, 13, 7, 1];
/** Points between yonis: same 4, friends 3, neutral 2, unfriendly 1, sworn enemies 0. */
export const YONI_POINTS: readonly (readonly number[])[] = [
  [4, 2, 2, 3, 2, 2, 2, 1, 0, 1, 3, 3, 2, 1],
  [2, 4, 3, 3, 2, 2, 2, 2, 3, 1, 2, 3, 2, 0],
  [2, 3, 4, 2, 1, 2, 1, 3, 3, 1, 2, 0, 3, 1],
  [3, 3, 2, 4, 2, 1, 1, 1, 1, 2, 2, 2, 0, 2],
  [2, 2, 1, 2, 4, 2, 1, 2, 2, 1, 0, 2, 1, 1],
  [2, 2, 2, 1, 2, 4, 0, 2, 2, 1, 3, 3, 2, 1],
  [2, 2, 1, 1, 1, 0, 4, 2, 2, 2, 2, 2, 1, 2],
  [1, 2, 3, 1, 2, 2, 2, 4, 3, 0, 3, 2, 2, 1],
  [0, 3, 3, 1, 2, 2, 2, 3, 4, 1, 2, 2, 2, 1],
  [1, 1, 1, 2, 1, 1, 2, 0, 1, 4, 1, 1, 2, 1],
  [3, 2, 2, 2, 0, 3, 2, 3, 2, 1, 4, 2, 2, 1],
  [3, 3, 0, 2, 2, 3, 2, 2, 2, 1, 2, 4, 3, 2],
  [2, 2, 3, 0, 1, 2, 1, 2, 2, 2, 2, 3, 4, 2],
  [1, 0, 1, 2, 1, 1, 2, 1, 1, 1, 1, 2, 2, 4],
];
const GANA_NAMES = ['Deva', 'Manushya', 'Rakshasa'];
const NADI_NAMES = ['Aadi', 'Madhya', 'Antya'];
/** Bride's gana (rows) against the groom's (columns). */
const GANA_POINTS = [
  [6, 6, 0],
  [5, 6, 0],
  [1, 0, 6],
];
/** Varna by sign: 3 Brahmin, 2 Kshatriya, 1 Vaishya, 0 Shudra. */
const VARNA = [2, 1, 0, 3, 2, 1, 0, 3, 2, 1, 0, 3];
const VARNA_NAMES = ['Shudra', 'Vaishya', 'Kshatriya', 'Brahmin'];
const VASHYA_NAMES = ['Chatushpada', 'Nara', 'Jalachara', 'Vanachara', 'Keeta'];
/** Bride's vashya (rows) against the groom's (columns). */
const VASHYA_POINTS = [
  [2, 1, 1, 0, 1],
  [1, 2, 0.5, 0, 1],
  [1, 0.5, 2, 1, 1],
  [0, 0, 1, 2, 0],
  [1, 0, 1, 0, 2],
];
function vashya(longitude: number): number {
  const lon = norm(longitude);
  const sign = Math.floor(lon / 30);
  const firstHalf = lon - sign * 30 < 15;
  return [0, 0, 1, 2, 3, 1, 1, 4, firstHalf ? 1 : 0, firstHalf ? 0 : 2, 1, 2][sign] as number;
}
/** Natural friendship: 1 friend, 0 neutral, −1 enemy (row's view of the column). */
const FRIENDSHIP: Partial<Record<Graha, Partial<Record<Graha, number>>>> = {
  sun: { moon: 1, mars: 1, jupiter: 1, mercury: 0, venus: -1, saturn: -1 },
  moon: { sun: 1, mercury: 1, mars: 0, jupiter: 0, venus: 0, saturn: 0 },
  mars: { sun: 1, moon: 1, jupiter: 1, venus: 0, saturn: 0, mercury: -1 },
  mercury: { sun: 1, venus: 1, mars: 0, jupiter: 0, saturn: 0, moon: -1 },
  jupiter: { sun: 1, moon: 1, mars: 1, saturn: 0, mercury: -1, venus: -1 },
  venus: { mercury: 1, saturn: 1, mars: 0, jupiter: 0, sun: -1, moon: -1 },
  saturn: { mercury: 1, venus: 1, jupiter: 0, sun: -1, moon: -1, mars: -1 },
};
function maitri(a: Graha, b: Graha): number {
  if (a === b) return 5;
  const ab = FRIENDSHIP[a]?.[b] ?? 0;
  const ba = FRIENDSHIP[b]?.[a] ?? 0;
  const pair = [ab, ba].sort().join(',');
  return ({ '1,1': 5, '0,1': 4, '0,0': 3, '-1,1': 1, '-1,0': 0.5, '-1,-1': 0 } as Record<string, number>)[pair] ?? 0;
}

export interface Koota {
  readonly name: string;
  readonly points: number;
  readonly max: number;
  readonly bride: string;
  readonly groom: string;
}

export interface Matching {
  readonly kootas: readonly Koota[];
  readonly total: number;
  readonly nadiDosha: boolean;
  readonly bhakootDosha: boolean;
}

/** Ashtakoota (36-point) matching from the bride's and groom's sidereal Moon longitudes. */
export function gunaMilan(brideMoon: number, groomMoon: number): Matching {
  const b = norm(brideMoon);
  const g = norm(groomMoon);
  const bs = Math.floor(b / 30);
  const gs = Math.floor(g / 30);
  const bn = Math.floor(b / NAK) % 27;
  const gn = Math.floor(g / NAK) % 27;
  const varna = (VARNA[gs] as number) >= (VARNA[bs] as number) ? 1 : 0;
  const bv = vashya(b);
  const gv = vashya(g);
  const vashyaPoints = (VASHYA_POINTS[bv] as number[])[gv] as number;
  const taraOf = (from: number, to: number) => (((to - from + 27) % 27) + 1) % 9;
  const good = (r: number) => ![3, 5, 7].includes(r);
  const tara = (good(taraOf(bn, gn)) ? 1.5 : 0) + (good(taraOf(gn, bn)) ? 1.5 : 0);
  const by = YONI[bn] as number;
  const gy = YONI[gn] as number;
  const yoni = (YONI_POINTS[by] as number[])[gy] as number;
  const bl = SIGN_LORDS[bs] as Graha;
  const gl = SIGN_LORDS[gs] as Graha;
  const graha = maitri(bl, gl);
  const bg = GANA[bn] as number;
  const gg = GANA[gn] as number;
  const gana = (GANA_POINTS[bg] as number[])[gg] as number;
  const distance = ((gs - bs + 12) % 12) + 1;
  const bhakootDosha = [2, 12, 5, 9, 6, 8].includes(distance);
  const bhakoot = bhakootDosha ? 0 : 7;
  const nadiDosha = NADI[bn] === NADI[gn];
  const nadi = nadiDosha ? 0 : 8;
  const kootas: Koota[] = [
    { name: 'Varna', points: varna, max: 1, bride: VARNA_NAMES[VARNA[bs] as number] as string, groom: VARNA_NAMES[VARNA[gs] as number] as string },
    { name: 'Vashya', points: vashyaPoints, max: 2, bride: VASHYA_NAMES[bv] as string, groom: VASHYA_NAMES[gv] as string },
    { name: 'Tara', points: tara, max: 3, bride: nakshatraName(bn), groom: nakshatraName(gn) },
    { name: 'Yoni', points: yoni, max: 4, bride: YONI_ANIMALS[by] as string, groom: YONI_ANIMALS[gy] as string },
    { name: 'Graha Maitri', points: graha, max: 5, bride: grahaName(bl), groom: grahaName(gl) },
    { name: 'Gana', points: gana, max: 6, bride: GANA_NAMES[bg] as string, groom: GANA_NAMES[gg] as string },
    { name: 'Bhakoot', points: bhakoot, max: 7, bride: signName(bs), groom: signName(gs) },
    { name: 'Nadi', points: nadi, max: 8, bride: NADI_NAMES[NADI[bn] as number] as string, groom: NADI_NAMES[NADI[gn] as number] as string },
  ];
  return { kootas, total: kootas.reduce((s, k) => s + k.points, 0), nadiDosha, bhakootDosha };
}

/** Houses (from the ascendant and from the Moon) of Mars, and whether the common rule calls the chart Manglik. */
export function manglik(c: Chart): { fromLagna: number; fromMoon: number; manglik: boolean } {
  const mars = c.grahas.find((g) => g.graha === 'mars') as GrahaPosition;
  const moon = c.grahas.find((g) => g.graha === 'moon') as GrahaPosition;
  const fromMoon = ((mars.sign - moon.sign + 12) % 12) + 1;
  const houses = [1, 2, 4, 7, 8, 12];
  return { fromLagna: mars.house, fromMoon, manglik: houses.includes(mars.house) || houses.includes(fromMoon) };
}

/* -------------------------------------------------------------- formatting -- */

/** 23°15′42″ within a sign (or of a full longitude). */
export function dms(degrees: number): string {
  let total = Math.round(Math.abs(degrees) * 3600);
  const d = Math.floor(total / 3600);
  total -= d * 3600;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${degrees < 0 ? '−' : ''}${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″`;
}

/* ------------------------------------------------------------------ places -- */

export interface BirthPlace {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly zone: string;
}

const IN = 'Asia/Kolkata';
/** Indian cities (beyond the sky tools' list), for choosing a birthplace offline. */
export const INDIAN_PLACES: readonly BirthPlace[] = [
  ['Agartala', 23.8315, 91.2868],
  ['Agra', 27.1767, 78.0081],
  ['Ahmedabad', 23.0225, 72.5714],
  ['Aizawl', 23.7271, 92.7176],
  ['Ajmer', 26.4499, 74.6399],
  ['Aligarh', 27.8974, 78.088],
  ['Alwar', 27.553, 76.6346],
  ['Amritsar', 31.634, 74.8723],
  ['Asansol', 23.6739, 86.9524],
  ['Ayodhya', 26.7922, 82.1998],
  ['Ballari', 15.1394, 76.9214],
  ['Bareilly', 28.367, 79.4304],
  ['Belagavi', 15.8497, 74.4977],
  ['Bhagalpur', 25.2425, 86.9842],
  ['Bhopal', 23.2599, 77.4126],
  ['Bhubaneswar', 20.2961, 85.8245],
  ['Bikaner', 28.0229, 73.3119],
  ['Bilaspur', 22.0797, 82.1409],
  ['Chandigarh', 30.7333, 76.7794],
  ['Chhatrapati Sambhajinagar (Aurangabad)', 19.8762, 75.3433],
  ['Coimbatore', 11.0168, 76.9558],
  ['Cuttack', 20.4625, 85.883],
  ['Darjeeling', 27.041, 88.2663],
  ['Davanagere', 14.4644, 75.9218],
  ['Dehradun', 30.3165, 78.0322],
  ['Dhanbad', 23.7957, 86.4304],
  ['Dibrugarh', 27.4728, 94.912],
  ['Durgapur', 23.5204, 87.3119],
  ['Faridabad', 28.4089, 77.3178],
  ['Gangtok', 27.3389, 88.6065],
  ['Gaya', 24.7914, 85.0002],
  ['Ghaziabad', 28.6692, 77.4538],
  ['Gorakhpur', 26.7606, 83.3732],
  ['Guntur', 16.3067, 80.4365],
  ['Gurugram', 28.4595, 77.0266],
  ['Gwalior', 26.2183, 78.1828],
  ['Haridwar', 29.9457, 78.1642],
  ['Hisar', 29.1492, 75.7217],
  ['Hubballi', 15.3647, 75.124],
  ['Imphal', 24.817, 93.9368],
  ['Indore', 22.7196, 75.8577],
  ['Itanagar', 27.0844, 93.6053],
  ['Jabalpur', 23.1815, 79.9864],
  ['Jaipur', 26.9124, 75.7873],
  ['Jalandhar', 31.326, 75.5762],
  ['Jammu', 32.7266, 74.857],
  ['Jamshedpur', 22.8046, 86.2029],
  ['Jhansi', 25.4484, 78.5685],
  ['Jodhpur', 26.2389, 73.0243],
  ['Kalaburagi', 17.3297, 76.8343],
  ['Kanpur', 26.4499, 80.3319],
  ['Kochi', 9.9312, 76.2673],
  ['Kohima', 25.6751, 94.1086],
  ['Kolhapur', 16.705, 74.2433],
  ['Kollam', 8.8932, 76.6141],
  ['Kota', 25.2138, 75.8648],
  ['Kozhikode', 11.2588, 75.7804],
  ['Kurnool', 15.8281, 78.0373],
  ['Kurukshetra', 29.9695, 76.8783],
  ['Lucknow', 26.8467, 80.9462],
  ['Ludhiana', 30.901, 75.8573],
  ['Madurai', 9.9252, 78.1198],
  ['Mangaluru', 12.9141, 74.856],
  ['Mathura', 27.4924, 77.6737],
  ['Meerut', 28.9845, 77.7064],
  ['Moradabad', 28.8386, 78.7733],
  ['Muzaffarpur', 26.1209, 85.3647],
  ['Mysuru', 12.2958, 76.6394],
  ['Nagpur', 21.1458, 79.0882],
  ['Nainital', 29.3803, 79.4636],
  ['Nanded', 19.1383, 77.321],
  ['Nashik', 19.9975, 73.7898],
  ['Nellore', 14.4426, 79.9865],
  ['Noida', 28.5355, 77.391],
  ['Panaji', 15.4909, 73.8278],
  ['Panipat', 29.3909, 76.9635],
  ['Patiala', 30.3398, 76.3869],
  ['Patna', 25.5941, 85.1376],
  ['Prayagraj', 25.4358, 81.8463],
  ['Puducherry', 11.9416, 79.8083],
  ['Pune', 18.5204, 73.8567],
  ['Puri', 19.8135, 85.8312],
  ['Raipur', 21.2514, 81.6296],
  ['Rajkot', 22.3039, 70.8022],
  ['Ranchi', 23.3441, 85.3096],
  ['Rewa', 24.5373, 81.3042],
  ['Rishikesh', 30.0869, 78.2676],
  ['Rohtak', 28.8955, 76.6066],
  ['Sagar', 23.8388, 78.7378],
  ['Salem', 11.6643, 78.146],
  ['Shillong', 25.5788, 91.8933],
  ['Shimla', 31.1048, 77.1734],
  ['Shivamogga', 13.9299, 75.5681],
  ['Siliguri', 26.7271, 88.3953],
  ['Silchar', 24.8333, 92.7789],
  ['Solapur', 17.6599, 75.9064],
  ['Srinagar', 34.0837, 74.7973],
  ['Surat', 21.1702, 72.8311],
  ['Thanjavur', 10.787, 79.1378],
  ['Thrissur', 10.5276, 76.2144],
  ['Tiruchirappalli', 10.7905, 78.7047],
  ['Tirupati', 13.6288, 79.4192],
  ['Tumakuru', 13.3379, 77.1173],
  ['Udaipur', 24.5854, 73.7125],
  ['Udupi', 13.3409, 74.7421],
  ['Ujjain', 23.1765, 75.7885],
  ['Vadodara', 22.3072, 73.1812],
  ['Varanasi', 25.3176, 82.9739],
  ['Vellore', 12.9165, 79.1325],
  ['Vijayapura', 16.8302, 75.71],
  ['Vijayawada', 16.5062, 80.648],
  ['Visakhapatnam', 17.6868, 83.2185],
  ['Warangal', 17.9689, 79.5941],
].map(([name, lat, lon]) => ({ name: name as string, lat: lat as number, lon: lon as number, zone: IN }));
