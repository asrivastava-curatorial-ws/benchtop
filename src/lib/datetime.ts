/** Time-zone aware date helpers built only on the platform's Intl data (no bundled tz database). */
import { ToolError } from './errors';

const FALLBACK_ZONES = [
  'UTC',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Kolkata',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Paris',
  'Pacific/Auckland',
];

let zoneCache: string[] | undefined;

export function timeZones(): string[] {
  if (zoneCache) return zoneCache;
  let zones: string[] = FALLBACK_ZONES;
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
    if (supported && supported.length > 0) zones = supported;
  } catch {
    // keep the fallback list
  }
  zoneCache = ['UTC', ...zones.filter((zone) => zone !== 'UTC')];
  return zoneCache;
}

export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(epochMs: number, zone: string): Record<string, number> {
  let formatter = formatters.get(zone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        era: 'short',
      });
    } catch {
      throw new ToolError(`Unknown time zone "${zone}".`);
    }
    formatters.set(zone, formatter);
  }
  const out: Record<string, number> = {};
  let bce = false;
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type === 'era') bce = part.value.startsWith('B');
    else if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  if (bce) out.year = 1 - (out.year ?? 1);
  return out;
}

function utcFromFields(year: number, month: number, day: number, hour: number, minute: number, second: number, ms = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, ms);
  return date.getTime();
}

/** Offset of `zone` from UTC, in minutes, at the given instant (east is positive). */
export function zoneOffsetMinutes(epochMs: number, zone: string): number {
  const whole = Math.floor(epochMs / 1000) * 1000;
  const p = partsIn(whole, zone);
  const asUtc = utcFromFields(p.year ?? 1970, p.month ?? 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  return Math.round((asUtc - whole) / 60000);
}

/** Converts a wall-clock time in `zone` to an instant.  Ambiguous times resolve to the earlier offset. */
export function zonedToEpoch(zone: string, year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  const wall = utcFromFields(year, month, day, hour, minute, second, ms);
  const first = wall - zoneOffsetMinutes(wall, zone) * 60000;
  const second2 = wall - zoneOffsetMinutes(first, zone) * 60000;
  return second2;
}

const pad = (value: number, length = 2): string => String(Math.abs(value)).padStart(length, '0');

export function formatOffset(minutes: number): string {
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface ZonedTime {
  /** ISO 8601 with numeric offset, e.g. 2026-11-13T06:32:00+05:30 */
  readonly iso: string;
  readonly date: string;
  readonly time: string;
  readonly offset: string;
  readonly weekday: string;
  readonly dayOfYear: number;
  readonly isoWeek: string;
}

export function formatInZone(epochMs: number, zone: string): ZonedTime {
  const p = partsIn(epochMs, zone);
  const year = p.year ?? 1970;
  const month = p.month ?? 1;
  const day = p.day ?? 1;
  const offsetMinutes = zoneOffsetMinutes(epochMs, zone);
  const fraction = ((epochMs % 1000) + 1000) % 1000;
  const yearText = year >= 0 && year <= 9999 ? pad(year, 4) : `${year < 0 ? '-' : '+'}${pad(year, 6)}`;
  const date = `${yearText}-${pad(month)}-${pad(day)}`;
  const time = `${pad(p.hour ?? 0)}:${pad(p.minute ?? 0)}:${pad(p.second ?? 0)}${fraction ? `.${pad(fraction, 3)}` : ''}`;
  const offset = formatOffset(offsetMinutes);
  const midnight = utcFromFields(year, month, day, 0, 0, 0);
  const weekdayIndex = new Date(midnight).getUTCDay();
  const dayOfYear = Math.round((midnight - utcFromFields(year, 1, 1, 0, 0, 0)) / 86400000) + 1;
  // ISO 8601 week: the week containing the year's first Thursday is week 1.
  const thursday = midnight + (3 - ((weekdayIndex + 6) % 7)) * 86400000;
  const weekYear = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - utcFromFields(weekYear, 1, 1, 0, 0, 0)) / 604800000) + 1;
  return {
    iso: `${date}T${time}${offsetMinutes === 0 ? 'Z' : offset}`,
    date,
    time,
    offset,
    weekday: WEEKDAYS[weekdayIndex] as string,
    dayOfYear,
    isoWeek: `${weekYear}-W${pad(week)}`,
  };
}

export interface ParsedInstant {
  readonly epochMs: number;
  /** How the input was understood, for display. */
  readonly interpretation: string;
}

/** Largest instant a JavaScript Date can represent. */
const MAX_MS = 8.64e15;

/**
 * Understands Unix timestamps (seconds, milliseconds, microseconds or
 * nanoseconds), ISO 8601 strings and "YYYY-MM-DD HH:mm:ss" wall-clock times,
 * which are read in the given zone.
 */
export function parseInstant(text: string, zone: string, unit: 'auto' | 's' | 'ms' | 'us' | 'ns', now: number): ParsedInstant {
  const input = text.trim();
  if (input === '' || input.toLowerCase() === 'now') return { epochMs: now, interpretation: 'the current time' };

  if (/^[+-]?\d+(\.\d+)?$/.test(input)) {
    const value = Number(input);
    const magnitude = Math.abs(value);
    const chosen = unit !== 'auto' ? unit : magnitude < 1e11 ? 's' : magnitude < 1e14 ? 'ms' : magnitude < 1e17 ? 'us' : 'ns';
    const factor = { s: 1000, ms: 1, us: 1e-3, ns: 1e-6 }[chosen];
    const epochMs = value * factor;
    if (!Number.isFinite(epochMs) || Math.abs(epochMs) > MAX_MS) throw new ToolError('That timestamp is outside the range of representable dates.');
    const names = { s: 'seconds', ms: 'milliseconds', us: 'microseconds', ns: 'nanoseconds' };
    return { epochMs: Math.round(epochMs), interpretation: `a Unix timestamp in ${names[chosen]}` };
  }

  const wall = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?$/.exec(input);
  if (wall) {
    const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = ''] = wall;
    const fields = [Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second)] as const;
    if (fields[1] < 1 || fields[1] > 12 || fields[2] < 1 || fields[2] > 31 || fields[3] > 23 || fields[4] > 59 || fields[5] > 59) {
      throw new ToolError(`"${input}" is not a valid date and time.`);
    }
    const ms = Number(fraction.padEnd(3, '0').slice(0, 3));
    const epochMs = zonedToEpoch(zone, ...fields, ms);
    const check = formatInZone(epochMs, zone);
    if (!check.date.endsWith(`-${pad(fields[1])}-${pad(fields[2])}`)) throw new ToolError(`"${input}" is not a real calendar date.`);
    return { epochMs, interpretation: `a wall-clock time in ${zone}` };
  }

  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) {
    throw new ToolError(`Could not understand "${input}". Use a Unix timestamp, an ISO 8601 date or YYYY-MM-DD HH:mm:ss.`);
  }
  const hasZone = /(Z|[+-]\d{2}:?\d{2}|\b(GMT|UTC)\b)\s*$/i.test(input);
  return { epochMs: parsed, interpretation: hasZone ? 'a date with an explicit UTC offset' : 'a date in the system time zone' };
}
