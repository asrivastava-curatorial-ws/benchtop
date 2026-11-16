import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

const GEOHASH = '0123456789bcdefghjkmnpqrstuvwxyz';
const PLUS = '23456789CFGHJMPQRVWX';

export function toGeohash({ lat, lon }: LatLon, precision = 10): string {
  let [latLo, latHi, lonLo, lonHi] = [-90, 90, -180, 180];
  let hash = '';
  let bits = 0;
  let value = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonLo + lonHi) / 2;
      value = value * 2 + (lon >= mid ? 1 : 0);
      if (lon >= mid) lonLo = mid;
      else lonHi = mid;
    } else {
      const mid = (latLo + latHi) / 2;
      value = value * 2 + (lat >= mid ? 1 : 0);
      if (lat >= mid) latLo = mid;
      else latHi = mid;
    }
    even = !even;
    if (++bits === 5) {
      hash += GEOHASH[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
}

export function fromGeohash(hash: string): LatLon {
  let [latLo, latHi, lonLo, lonHi] = [-90, 90, -180, 180];
  let even = true;
  for (const char of hash.toLowerCase()) {
    const index = GEOHASH.indexOf(char);
    if (index < 0) throw new ToolError(`"${char}" is not a geohash character.`);
    for (let bit = 4; bit >= 0; bit--) {
      const on = (index >> bit) & 1;
      if (even) [lonLo, lonHi] = on ? [(lonLo + lonHi) / 2, lonHi] : [lonLo, (lonLo + lonHi) / 2];
      else [latLo, latHi] = on ? [(latLo + latHi) / 2, latHi] : [latLo, (latLo + latHi) / 2];
      even = !even;
    }
  }
  return { lat: (latLo + latHi) / 2, lon: (lonLo + lonHi) / 2 };
}

/** Open Location Code (Plus Code), 10 digits plus an 11th for about 3 m precision. */
export function toPlusCode({ lat, lon }: LatLon, length = 11): string {
  let latitude = Math.min(89.9999999, Math.max(-90, lat)) + 90;
  let longitude = (((lon + 180) % 360) + 360) % 360;
  let code = '';
  let resolution = 20;
  for (let pair = 0; pair < 5; pair++) {
    const latDigit = Math.floor(latitude / resolution);
    const lonDigit = Math.floor(longitude / resolution);
    code += PLUS[latDigit] + PLUS[lonDigit];
    latitude -= latDigit * resolution;
    longitude -= lonDigit * resolution;
    resolution /= 20;
    if (pair === 3) code += '+';
  }
  if (length > 10) {
    const latStep = 0.000125 / 5;
    const lonStep = 0.000125 / 4;
    const row = Math.min(4, Math.floor(latitude / latStep));
    const column = Math.min(3, Math.floor(longitude / lonStep));
    code += PLUS[row * 4 + column];
  }
  return code;
}

/** WGS 84 to UTM (Karney–Krüger series to fourth order; sub-millimetre within the zone). */
export function toUtm({ lat, lon }: LatLon): { zone: number; band: string; easting: number; northing: number } {
  if (lat < -80 || lat > 84) throw new ToolError('UTM covers latitudes from 80°S to 84°N.');
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) zone = lon >= 0 && lon < 9 ? 31 : lon >= 9 && lon < 21 ? 33 : lon >= 21 && lon < 33 ? 35 : lon >= 33 && lon < 42 ? 37 : zone;
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const alpha = [(1 / 2) * n - (2 / 3) * n ** 2 + (5 / 16) * n ** 3, (13 / 48) * n ** 2 - (3 / 5) * n ** 3, (61 / 240) * n ** 3];
  const phi = (lat * Math.PI) / 180;
  const lambda = ((lon - (zone * 6 - 183)) * Math.PI) / 180;
  const e = Math.sqrt(f * (2 - f));
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lambda));
  const eta = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let x = eta;
  let y = xi;
  for (let j = 1; j <= 3; j++) {
    x += (alpha[j - 1] as number) * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    y += (alpha[j - 1] as number) * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  const easting = 500000 + k0 * A * x;
  const northing = (lat < 0 ? 10000000 : 0) + k0 * A * y;
  const band = 'CDEFGHJKLMNPQRSTUVWXX'[Math.floor((lat + 80) / 8)] ?? 'X';
  return { zone, band, easting, northing };
}

const toDms = (value: number, positive: string, negative: string): string => {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = Math.floor((abs - degrees) * 60);
  const seconds = (abs - degrees - minutes / 60) * 3600;
  return `${degrees}° ${minutes}′ ${seconds.toFixed(2)}″ ${value >= 0 ? positive : negative}`;
};
const toDdm = (value: number, positive: string, negative: string): string => {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  return `${degrees}° ${((abs - degrees) * 60).toFixed(4)}′ ${value >= 0 ? positive : negative}`;
};

/** Reads decimal degrees, degrees-minutes-seconds, degrees-decimal-minutes or a geohash. */
export function parseCoordinates(text: string): LatLon {
  const trimmed = text.trim();
  if (/^[0-9b-hjkmnp-z]{4,12}$/i.test(trimmed) && !/^\d+$/.test(trimmed)) return fromGeohash(trimmed);
  const upper = trimmed.toUpperCase().replace(/[°º˚′'″"]/g, ' ');
  const hemispheres = /^(.*?[NS])\s*[,;]?\s*(.*[EW])$/.exec(upper) ?? /^([NS].*?)\s*[,;]?\s*([EW].*)$/.exec(upper);
  const plain = trimmed.split(/\s*[,;]\s*|\s+/).filter(Boolean);
  const halves = hemispheres ? [hemispheres[1] as string, hemispheres[2] as string] : trimmed.includes(',') ? trimmed.split(',') : plain.length === 2 ? plain : null;
  const one = (piece: string, hemispheres: string): number => {
    const sign = /[SW]/.test(piece.toUpperCase()) || /^\s*-/.test(piece) ? -1 : 1;
    const numbers = (piece.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (numbers.length === 0) throw new ToolError(`Could not read "${piece.trim()}" as a ${hemispheres === 'NS' ? 'latitude' : 'longitude'}.`);
    const [d = 0, m = 0, s = 0] = numbers;
    return sign * (d + m / 60 + s / 3600);
  };
  if (halves?.length !== 2) throw new ToolError('Enter a latitude and longitude separated by a comma, for example 12.9716, 77.5946 or 12°58′17.8″N 77°35′40.6″E.');
  const lat = one(halves[0] as string, 'NS');
  const lon = one(halves[1] as string, 'EW');
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new ToolError('Latitude must be within ±90° and longitude within ±180°.');
  return { lat, lon };
}

const R = 6371008.8;
export function distance(a: LatLon, b: LatLon): { metres: number; bearing: number } {
  const [φ1, φ2] = [(a.lat * Math.PI) / 180, (b.lat * Math.PI) / 180];
  const Δφ = φ2 - φ1;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const metres = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  const bearing = ((Math.atan2(Math.sin(Δλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)) * 180) / Math.PI + 360) % 360;
  return { metres, bearing };
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'a', label: 'Position', type: 'text', default: '12.9716, 77.5946', mono: true, wide: true, placeholder: '12.9716, 77.5946  or  12°58′17.8″N 77°35′40.6″E  or a geohash' },
    { key: 'b', label: 'Second position (for distance)', type: 'text', default: '', mono: true, wide: true, placeholder: 'Optional' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    if (o.a.trim() === '') return {};
    const a = parseCoordinates(o.a);
    const utm = toUtm(a);
    const fields: Field[] = [
      { label: 'Decimal degrees', value: `${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}`, mono: true },
      { label: 'Degrees, minutes, seconds', value: `${toDms(a.lat, 'N', 'S')}  ${toDms(a.lon, 'E', 'W')}`, mono: true },
      { label: 'Degrees and decimal minutes', value: `${toDdm(a.lat, 'N', 'S')}  ${toDdm(a.lon, 'E', 'W')}`, mono: true },
      { label: 'UTM (WGS 84)', value: `${utm.zone}${utm.band} ${utm.easting.toFixed(0)} E ${utm.northing.toFixed(0)} N`, mono: true },
      { label: 'Geohash', value: toGeohash(a), mono: true },
      { label: 'Plus Code', value: toPlusCode(a), mono: true },
      { label: 'Map link', value: `geo:${a.lat.toFixed(6)},${a.lon.toFixed(6)}`, mono: true },
    ];
    if (o.b.trim() !== '') {
      const b = parseCoordinates(o.b);
      const { metres, bearing } = distance(a, b);
      fields.push(
        {
          label: 'Distance (great circle)',
          value: `${metres >= 1000 ? `${(metres / 1000).toFixed(3)} km` : `${metres.toFixed(1)} m`} (${(metres / 1609.344).toFixed(3)} mi, ${(metres / 1852).toFixed(3)} nmi)`,
          mono: true,
          tone: 'ok',
        },
        { label: 'Initial bearing', value: `${bearing.toFixed(1)}° (${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8]})`, mono: true },
      );
    }
    return { fields };
  },
});
