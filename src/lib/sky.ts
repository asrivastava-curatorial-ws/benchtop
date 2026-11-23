/**
 * Sky helpers on top of astronomy-engine: sunrise, sunset, twilight, the
 * Moon's phase and rise and set, the Sun's path, seasons, and placing stars
 * and planets on a chart of the sky for a place and time.
 */
import * as Astronomy from 'astronomy-engine';

export interface Place {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly zone: string;
}

export const PLACES: readonly Place[] = [
  { name: 'Bengaluru', lat: 12.9716, lon: 77.5946, zone: 'Asia/Kolkata' },
  { name: 'Chennai', lat: 13.0827, lon: 80.2707, zone: 'Asia/Kolkata' },
  { name: 'Delhi', lat: 28.6139, lon: 77.209, zone: 'Asia/Kolkata' },
  { name: 'Guwahati', lat: 26.1445, lon: 91.7362, zone: 'Asia/Kolkata' },
  { name: 'Hyderabad', lat: 17.385, lon: 78.4867, zone: 'Asia/Kolkata' },
  { name: 'Kolkata', lat: 22.5726, lon: 88.3639, zone: 'Asia/Kolkata' },
  { name: 'Leh', lat: 34.1526, lon: 77.5771, zone: 'Asia/Kolkata' },
  { name: 'Mumbai', lat: 19.076, lon: 72.8777, zone: 'Asia/Kolkata' },
  { name: 'Port Blair', lat: 11.6234, lon: 92.7265, zone: 'Asia/Kolkata' },
  { name: 'Thiruvananthapuram', lat: 8.5241, lon: 76.9366, zone: 'Asia/Kolkata' },
  { name: 'Colombo', lat: 6.9271, lon: 79.8612, zone: 'Asia/Colombo' },
  { name: 'Dhaka', lat: 23.8103, lon: 90.4125, zone: 'Asia/Dhaka' },
  { name: 'Kathmandu', lat: 27.7172, lon: 85.324, zone: 'Asia/Kathmandu' },
  { name: 'Dubai', lat: 25.2048, lon: 55.2708, zone: 'Asia/Dubai' },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198, zone: 'Asia/Singapore' },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503, zone: 'Asia/Tokyo' },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093, zone: 'Australia/Sydney' },
  { name: 'Nairobi', lat: -1.2921, lon: 36.8219, zone: 'Africa/Nairobi' },
  { name: 'Cape Town', lat: -33.9249, lon: 18.4241, zone: 'Africa/Johannesburg' },
  { name: 'London', lat: 51.5074, lon: -0.1278, zone: 'Europe/London' },
  { name: 'Paris', lat: 48.8566, lon: 2.3522, zone: 'Europe/Paris' },
  { name: 'Reykjavík', lat: 64.1466, lon: -21.9426, zone: 'Atlantic/Reykjavik' },
  { name: 'New York', lat: 40.7128, lon: -74.006, zone: 'America/New_York' },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437, zone: 'America/Los_Angeles' },
  { name: 'São Paulo', lat: -23.5505, lon: -46.6333, zone: 'America/Sao_Paulo' },
  { name: 'Tromsø', lat: 69.6492, lon: 18.9553, zone: 'Europe/Oslo' },
];

/* -------------------------------------------------------------- time zones -- */

function zoneParts(instant: number, zone: string): number[] {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')];
}

/** The zone's offset from UTC at an instant, in minutes. */
export function zoneOffset(instant: number, zone: string): number {
  const [y, mo, d, h, mi, s] = zoneParts(instant, zone) as [number, number, number, number, number, number];
  return Math.round((Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(instant / 1000) * 1000) / 60000);
}

/** The instant of a wall-clock time ("2026-11-23T19:30") in a zone. */
export function zonedToUtc(local: string, zone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(local);
  if (!m) return new Date(Number.NaN);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  let instant = guess - zoneOffset(guess, zone) * 60000;
  // A second pass settles times near a daylight-saving change.
  instant = guess - zoneOffset(instant, zone) * 60000;
  return new Date(instant);
}

/** "2026-11-23T19:30" for an instant in a zone. */
export function utcToZoned(date: Date, zone: string): string {
  const [y, mo, d, h, mi] = zoneParts(date.getTime(), zone);
  const p = (n: number | undefined) => String(n ?? 0).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}`;
}

export function formatTime(date: Date | null, zone: string, seconds = false): string {
  if (!date) return '–';
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' }).format(date);
}

export function formatDate(date: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' }).format(date);
}

/* ------------------------------------------------------------- sun and moon -- */

const observerOf = (p: { lat: number; lon: number }) => new Astronomy.Observer(p.lat, p.lon, 0);

export interface SunMoonDay {
  readonly sunrise: Date | null;
  readonly sunset: Date | null;
  readonly noon: Date;
  readonly noonAltitude: number;
  /** Minutes of daylight (sunrise to sunset), or 0/1440 for polar night and day. */
  readonly daylight: number;
  readonly polar: 'day' | 'night' | null;
  readonly civil: readonly [Date | null, Date | null];
  readonly nautical: readonly [Date | null, Date | null];
  readonly astronomical: readonly [Date | null, Date | null];
  /** Sun between −4° and 6°: morning end and evening start of the golden hour. */
  readonly golden: readonly [Date | null, Date | null];
  readonly moonrise: Date | null;
  readonly moonset: Date | null;
  readonly moon: MoonFacts;
}

export interface MoonFacts {
  /** 0 new, 90 first quarter, 180 full, 270 last quarter. */
  readonly angle: number;
  readonly illuminated: number;
  readonly name: string;
  /** Days since the last new moon. */
  readonly age: number;
}

export function moonFacts(date: Date): MoonFacts {
  const angle = Astronomy.MoonPhase(date);
  const illuminated = Astronomy.Illumination(Astronomy.Body.Moon, date).phase_fraction;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  const name = names[Math.round(angle / 45) % 8] as string;
  return { angle, illuminated, name, age: (angle / 360) * 29.530588 };
}

/** Sun and Moon events for the local calendar day `ymd` ("2026-11-23") in `zone`. */
export function sunMoonDay(place: { lat: number; lon: number }, ymd: string, zone: string): SunMoonDay {
  const observer = observerOf(place);
  const start = zonedToUtc(`${ymd}T00:00`, zone);
  const end = zonedToUtc(`${ymd}T23:59`, zone);
  const within = (t: Astronomy.AstroTime | null) => (t && t.date.getTime() <= end.getTime() + 60000 ? t.date : null);
  const rise = (body: Astronomy.Body) => within(Astronomy.SearchRiseSet(body, observer, +1, start, 1));
  const set = (body: Astronomy.Body) => within(Astronomy.SearchRiseSet(body, observer, -1, start, 1));
  const altitude = (direction: 1 | -1, degrees: number) => within(Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, direction, start, 1, degrees));
  const transit = Astronomy.SearchHourAngle(Astronomy.Body.Sun, observer, 0, start);
  const noon = transit.time.date;
  const noonAltitude = transit.hor.altitude;
  const sunrise = rise(Astronomy.Body.Sun);
  const sunset = set(Astronomy.Body.Sun);
  let polar: SunMoonDay['polar'] = null;
  if (!sunrise && !sunset) polar = noonAltitude > 0 ? 'day' : 'night';
  const daylight =
    sunrise && sunset
      ? (sunset.getTime() - sunrise.getTime()) / 60000
      : polar === 'day'
        ? 1440
        : polar === 'night'
          ? 0
          : sunrise
            ? (end.getTime() - sunrise.getTime()) / 60000
            : sunset
              ? (sunset.getTime() - start.getTime()) / 60000
              : 0;
  return {
    sunrise,
    sunset,
    noon,
    noonAltitude,
    daylight,
    polar,
    civil: [altitude(1, -6), altitude(-1, -6)],
    nautical: [altitude(1, -12), altitude(-1, -12)],
    astronomical: [altitude(1, -18), altitude(-1, -18)],
    golden: [altitude(1, 6), altitude(-1, 6)],
    moonrise: rise(Astronomy.Body.Moon),
    moonset: set(Astronomy.Body.Moon),
    moon: moonFacts(noon),
  };
}

export interface SkyPosition {
  readonly altitude: number;
  readonly azimuth: number;
}

export function sunPosition(place: { lat: number; lon: number }, date: Date): SkyPosition {
  const observer = observerOf(place);
  const eq = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
  const hor = Astronomy.Horizon(date, observer, eq.ra, eq.dec, 'normal');
  return { altitude: hor.altitude, azimuth: hor.azimuth };
}

/** The Sun's altitude and azimuth through a local day, every `stepMinutes`. */
export function sunPath(place: { lat: number; lon: number }, ymd: string, zone: string, stepMinutes = 10): { t: Date; altitude: number; azimuth: number }[] {
  const start = zonedToUtc(`${ymd}T00:00`, zone).getTime();
  const out: { t: Date; altitude: number; azimuth: number }[] = [];
  for (let m = 0; m <= 1440; m += stepMinutes) {
    const t = new Date(start + m * 60000);
    out.push({ t, ...sunPosition(place, t) });
  }
  return out;
}

export interface Quarter {
  readonly name: string;
  readonly date: Date;
}

export function nextQuarters(from: Date, count = 4): Quarter[] {
  const names = ['New moon', 'First quarter', 'Full moon', 'Last quarter'];
  const out: Quarter[] = [];
  let q = Astronomy.SearchMoonQuarter(from);
  for (let i = 0; i < count; i++) {
    out.push({ name: names[q.quarter] as string, date: q.time.date });
    q = Astronomy.NextMoonQuarter(q);
  }
  return out;
}

export function seasons(year: number): Quarter[] {
  const s = Astronomy.Seasons(year);
  return [
    { name: 'March equinox', date: s.mar_equinox.date },
    { name: 'June solstice', date: s.jun_solstice.date },
    { name: 'September equinox', date: s.sep_equinox.date },
    { name: 'December solstice', date: s.dec_solstice.date },
  ];
}

/** Sunrise and sunset for every day of a year, as CSV. */
export function yearCsv(place: { lat: number; lon: number }, year: number, zone: string): string {
  const rows = ['date,sunrise,solar noon,sunset,daylight (h:mm),civil dawn,civil dusk,moon phase'];
  const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
  for (let d = 0; d < days; d++) {
    const ymd = new Date(Date.UTC(year, 0, 1 + d)).toISOString().slice(0, 10);
    const day = sunMoonDay(place, ymd, zone);
    const hm = `${Math.floor(day.daylight / 60)}:${String(Math.round(day.daylight % 60)).padStart(2, '0')}`;
    rows.push(
      [ymd, formatTime(day.sunrise, zone), formatTime(day.noon, zone), formatTime(day.sunset, zone), hm, formatTime(day.civil[0], zone), formatTime(day.civil[1], zone), day.moon.name].join(','),
    );
  }
  return `${rows.join('\n')}\n`;
}

/* ------------------------------------------------------------- star chart -- */

export interface SkyData {
  readonly stars: readonly (readonly [number, number, number, number, number])[];
  readonly names: Readonly<Record<string, readonly [string, string]>>;
  readonly lines: Readonly<Record<string, readonly (readonly (readonly [number, number])[])[]>>;
  readonly constellations: readonly (readonly [string, string, number, number, number])[];
  readonly messier: readonly (readonly [string, number, number, number, string, string])[];
}

let skyData: Promise<SkyData> | null = null;

export function loadSky(): Promise<SkyData> {
  skyData ??= fetch(new URL('sky.json', document.baseURI))
    .then((r) => {
      if (!r.ok) throw new Error('The star data could not be loaded.');
      return r.json() as Promise<SkyData>;
    })
    .catch((error: unknown) => {
      skyData = null;
      throw error;
    });
  return skyData;
}

export function setSkyData(data: SkyData): void {
  skyData = Promise.resolve(data);
}

/** Converts J2000 right ascension and declination (degrees) to altitude and azimuth with a prepared rotation. */
export function horizontal(rot: Astronomy.RotationMatrix, raDeg: number, decDeg: number): SkyPosition {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  const r = rot.rot;
  const hx = (r[0]?.[0] ?? 0) * x + (r[1]?.[0] ?? 0) * y + (r[2]?.[0] ?? 0) * z;
  const hy = (r[0]?.[1] ?? 0) * x + (r[1]?.[1] ?? 0) * y + (r[2]?.[1] ?? 0) * z;
  const hz = (r[0]?.[2] ?? 0) * x + (r[1]?.[2] ?? 0) * y + (r[2]?.[2] ?? 0) * z;
  const altitude = (Math.asin(Math.max(-1, Math.min(1, hz))) * 180) / Math.PI;
  let azimuth = (Math.atan2(-hy, hx) * 180) / Math.PI;
  if (azimuth < 0) azimuth += 360;
  return { altitude, azimuth };
}

export function skyRotation(place: { lat: number; lon: number }, date: Date): Astronomy.RotationMatrix {
  return Astronomy.Rotation_EQJ_HOR(date, observerOf(place));
}

export interface Planet {
  readonly name: string;
  readonly altitude: number;
  readonly azimuth: number;
  readonly magnitude: number | null;
  readonly ra: number;
  readonly dec: number;
}

const PLANETS: readonly [Astronomy.Body, string][] = [
  [Astronomy.Body.Sun, 'Sun'],
  [Astronomy.Body.Moon, 'Moon'],
  [Astronomy.Body.Mercury, 'Mercury'],
  [Astronomy.Body.Venus, 'Venus'],
  [Astronomy.Body.Mars, 'Mars'],
  [Astronomy.Body.Jupiter, 'Jupiter'],
  [Astronomy.Body.Saturn, 'Saturn'],
  [Astronomy.Body.Uranus, 'Uranus'],
  [Astronomy.Body.Neptune, 'Neptune'],
];

export function planets(place: { lat: number; lon: number }, date: Date): Planet[] {
  const observer = observerOf(place);
  return PLANETS.map(([body, name]) => {
    const eq = Astronomy.Equator(body, date, observer, true, true);
    const hor = Astronomy.Horizon(date, observer, eq.ra, eq.dec, 'normal');
    let magnitude: number | null = null;
    try {
      magnitude = Astronomy.Illumination(body, date).mag;
    } catch {
      magnitude = null;
    }
    return { name, altitude: hor.altitude, azimuth: hor.azimuth, magnitude, ra: eq.ra * 15, dec: eq.dec };
  });
}

/** Star colour from its B−V index (approximate blackbody tint). */
export function starColour(bv: number): string {
  const stops: [number, [number, number, number]][] = [
    [-0.4, [155, 176, 255]],
    [0, [202, 215, 255]],
    [0.4, [248, 247, 255]],
    [0.6, [255, 244, 234]],
    [0.8, [255, 232, 196]],
    [1.2, [255, 204, 143]],
    [2, [255, 168, 96]],
  ];
  const v = Math.max(-0.4, Math.min(2, bv));
  for (let i = 1; i < stops.length; i++) {
    const [b1, c1] = stops[i] as [number, [number, number, number]];
    const [b0, c0] = stops[i - 1] as [number, [number, number, number]];
    if (v <= b1) {
      const t = (v - b0) / (b1 - b0);
      return `rgb(${c0.map((x, k) => Math.round(x + ((c1[k] as number) - x) * t)).join(' ')})`;
    }
  }
  return 'rgb(255 168 96)';
}

/** The constellation (IAU abbreviation and name) containing a J2000 position. */
export function constellationAt(raDeg: number, decDeg: number): { symbol: string; name: string } {
  const c = Astronomy.Constellation(raDeg / 15, decDeg);
  return { symbol: c.symbol, name: c.name };
}

/** The ecliptic as J2000 RA/Dec points, for drawing. */
export function eclipticPoints(steps = 72): [number, number][] {
  const e = (23.4392911 * Math.PI) / 180;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const l = (i / steps) * 2 * Math.PI;
    const ra = Math.atan2(Math.sin(l) * Math.cos(e), Math.cos(l));
    const dec = Math.asin(Math.sin(e) * Math.sin(l));
    return [(((ra * 180) / Math.PI + 360) % 360) as number, (dec * 180) / Math.PI];
  });
}
