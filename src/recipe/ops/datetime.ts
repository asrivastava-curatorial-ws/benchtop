/** Date and time: parsing and formatting with Moment-style patterns, UNIX and Windows timestamps, deltas. */
import { timeZones, zonedToEpoch, zoneOffsetMinutes } from '../../lib/datetime';
import { bArg, bool, type Choice, defineOp, editable, nArg, num, OpError, type Operation, sArg, sel, str } from '../core';

const C = 'Date / Time' as const;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
const pad = (n: number, w = 2) => String(Math.abs(Math.trunc(n))).padStart(w, '0');
const TOKEN = /\[[^\]]*\]|YYYY|YY|MMMM|MMM|MM|Mo|M|DDDD|DDD|Do|DD|D|dddd|ddd|dd|d|HH|H|hh|h|kk|k|mm|m|ss|s|SSS|SS|S|A|a|ZZ|Z|z|X|x|WW|W|Q/g;

export const DATETIME_FORMATS: readonly Choice[] = [
  { label: 'Standard date and time', value: 'DD/MM/YYYY HH:mm:ss' },
  { label: 'American-style date and time', value: 'MM/DD/YYYY HH:mm:ss' },
  { label: 'International date and time', value: 'YYYY-MM-DD HH:mm:ss' },
  { label: 'Verbose date and time', value: 'dddd Do MMMM YYYY HH:mm:ss Z z' },
  { label: 'UNIX timestamp (seconds)', value: 'X' },
  { label: 'UNIX timestamp offset (milliseconds)', value: 'x' },
  { label: 'ISO 8601', value: 'YYYY-MM-DDTHH:mm:ssZ' },
  { label: 'User defined', value: '' },
];

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
  weekday: number;
  offset: number;
}

function partsIn(epoch: number, zone: string): Parts {
  const offset = zone === 'UTC' ? 0 : zoneOffsetMinutes(epoch, zone);
  const d = new Date(epoch + offset * 60000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(),
    weekday: d.getUTCDay(),
    offset,
  };
}

function isoWeek(p: Parts): number {
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - start) / 86400000 + 1) / 7);
}

function zoneAbbreviation(epoch: number, zone: string): string {
  if (zone === 'UTC') return 'UTC';
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(epoch)).find((p) => p.type === 'timeZoneName');
    return part?.value ?? zone;
  } catch {
    return zone;
  }
}

export function formatDate(epoch: number, pattern: string, zone: string): string {
  const p = partsIn(epoch, zone);
  const off = (sep: string) => `${p.offset < 0 ? '-' : '+'}${pad(Math.abs(p.offset) / 60)}${sep}${pad(Math.abs(p.offset) % 60)}`;
  const dayOfYear = Math.floor((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 1)) / 86400000) + 1;
  return pattern.replace(TOKEN, (token) => {
    switch (token) {
      case 'YYYY':
        return String(p.year);
      case 'YY':
        return pad(p.year % 100);
      case 'MMMM':
        return MONTHS[p.month - 1] as string;
      case 'MMM':
        return (MONTHS[p.month - 1] as string).slice(0, 3);
      case 'MM':
        return pad(p.month);
      case 'Mo':
        return ordinal(p.month);
      case 'M':
        return String(p.month);
      case 'DDDD':
        return pad(dayOfYear, 3);
      case 'DDD':
        return String(dayOfYear);
      case 'Do':
        return ordinal(p.day);
      case 'DD':
        return pad(p.day);
      case 'D':
        return String(p.day);
      case 'dddd':
        return DAYS[p.weekday] as string;
      case 'ddd':
        return (DAYS[p.weekday] as string).slice(0, 3);
      case 'dd':
        return (DAYS[p.weekday] as string).slice(0, 2);
      case 'd':
        return String(p.weekday);
      case 'HH':
        return pad(p.hour);
      case 'H':
        return String(p.hour);
      case 'hh':
        return pad(p.hour % 12 || 12);
      case 'h':
        return String(p.hour % 12 || 12);
      case 'kk':
        return pad(p.hour || 24);
      case 'k':
        return String(p.hour || 24);
      case 'mm':
        return pad(p.minute);
      case 'm':
        return String(p.minute);
      case 'ss':
        return pad(p.second);
      case 's':
        return String(p.second);
      case 'SSS':
        return pad(p.ms, 3);
      case 'SS':
        return pad(Math.floor(p.ms / 10));
      case 'S':
        return String(Math.floor(p.ms / 100));
      case 'A':
        return p.hour < 12 ? 'AM' : 'PM';
      case 'a':
        return p.hour < 12 ? 'am' : 'pm';
      case 'Z':
        return off(':');
      case 'ZZ':
        return off('');
      case 'z':
        return zoneAbbreviation(epoch, zone);
      case 'X':
        return String(Math.floor(epoch / 1000));
      case 'x':
        return String(epoch);
      case 'WW':
        return pad(isoWeek(p));
      case 'W':
        return String(isoWeek(p));
      case 'Q':
        return String(Math.ceil(p.month / 3));
      default:
        return token.slice(1, -1);
    }
  });
}

/** Parses `text` with a Moment-style pattern; times without an offset are read in `zone`. */
export function parseDate(text: string, pattern: string, zone: string): number {
  const input = text.trim();
  if (pattern === '' || pattern === 'Automatic') {
    const value = Date.parse(input);
    if (Number.isNaN(value)) throw new OpError(`"${input}" is not a recognisable date.`);
    return value;
  }
  const fields: string[] = [];
  let source = '';
  let last = 0;
  for (const match of pattern.matchAll(TOKEN)) {
    source += (pattern.slice(last, match.index) ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const token = match[0];
    last = (match.index ?? 0) + token.length;
    if (token.startsWith('[')) {
      source += token.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      continue;
    }
    fields.push(token);
    const group: Record<string, string> = {
      YYYY: '(-?\\d{4,6})',
      YY: '(\\d{2})',
      MMMM: `(${MONTHS.join('|')})`,
      MMM: `(${MONTHS.map((m) => m.slice(0, 3)).join('|')})`,
      MM: '(\\d{2})',
      M: '(\\d{1,2})',
      Mo: '(\\d{1,2})(?:st|nd|rd|th)',
      Do: '(\\d{1,2})(?:st|nd|rd|th)',
      DD: '(\\d{2})',
      D: '(\\d{1,2})',
      DDDD: '(\\d{3})',
      DDD: '(\\d{1,3})',
      dddd: `(${DAYS.join('|')})`,
      ddd: `(${DAYS.map((d) => d.slice(0, 3)).join('|')})`,
      dd: '([A-Za-z]{2})',
      d: '(\\d)',
      HH: '(\\d{2})',
      H: '(\\d{1,2})',
      hh: '(\\d{2})',
      h: '(\\d{1,2})',
      kk: '(\\d{2})',
      k: '(\\d{1,2})',
      mm: '(\\d{2})',
      m: '(\\d{1,2})',
      ss: '(\\d{2})',
      s: '(\\d{1,2})',
      SSS: '(\\d{3})',
      SS: '(\\d{2})',
      S: '(\\d)',
      A: '(AM|PM)',
      a: '(am|pm)',
      Z: '(Z|[+-]\\d{2}:?\\d{2})',
      ZZ: '(Z|[+-]\\d{2}:?\\d{2})',
      z: '([A-Za-z_/+-]+)',
      X: '(-?\\d+(?:\\.\\d+)?)',
      x: '(-?\\d+)',
      WW: '(\\d{2})',
      W: '(\\d{1,2})',
      Q: '([1-4])',
    };
    source += group[token] ?? '(.+?)';
  }
  source += pattern.slice(last).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${source}$`, 'i').exec(input);
  if (!match) throw new OpError(`"${input}" does not match the format "${pattern}".`);
  const v = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0, pm: null as boolean | null, offset: null as number | null, epoch: null as number | null };
  fields.forEach((token, i) => {
    const raw = match[i + 1] ?? '';
    const n = Number(raw);
    switch (token) {
      case 'YYYY':
        v.year = n;
        break;
      case 'YY':
        v.year = n + (n < 69 ? 2000 : 1900);
        break;
      case 'MMMM':
      case 'MMM':
        v.month = MONTHS.findIndex((m) => m.toLowerCase().startsWith(raw.toLowerCase())) + 1;
        break;
      case 'MM':
      case 'M':
      case 'Mo':
        v.month = Number.parseInt(raw, 10);
        break;
      case 'DD':
      case 'D':
      case 'Do':
        v.day = Number.parseInt(raw, 10);
        break;
      case 'HH':
      case 'H':
      case 'hh':
      case 'h':
      case 'kk':
      case 'k':
        v.hour = n % 24;
        break;
      case 'mm':
      case 'm':
        v.minute = n;
        break;
      case 'ss':
      case 's':
        v.second = n;
        break;
      case 'SSS':
        v.ms = n;
        break;
      case 'SS':
        v.ms = n * 10;
        break;
      case 'S':
        v.ms = n * 100;
        break;
      case 'A':
      case 'a':
        v.pm = raw.toLowerCase() === 'pm';
        break;
      case 'Z':
      case 'ZZ':
        v.offset = raw.toUpperCase() === 'Z' ? 0 : (raw[0] === '-' ? -1 : 1) * (Number(raw.slice(1, 3)) * 60 + Number(raw.slice(-2)));
        break;
      case 'X':
        v.epoch = Math.round(n * 1000);
        break;
      case 'x':
        v.epoch = n;
        break;
      default:
    }
  });
  if (v.epoch !== null) return v.epoch;
  if (v.pm !== null) v.hour = (v.hour % 12) + (v.pm ? 12 : 0);
  if (v.offset !== null) return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second, v.ms) - v.offset * 60000;
  if (zone === 'UTC') return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second, v.ms);
  return zonedToEpoch(zone, v.year, v.month, v.day, v.hour, v.minute, v.second, v.ms);
}

const ZONES = (() => {
  try {
    const list = timeZones();
    return ['UTC', ...list.filter((z) => z !== 'UTC')];
  } catch {
    return ['UTC'];
  }
})();

const UNITS = ['Seconds (s)', 'Milliseconds (ms)', 'Microseconds (μs)', 'Nanoseconds (ns)'];
const unitScale = (unit: string): bigint => (unit.startsWith('Milli') ? 1000n : unit.startsWith('Micro') ? 1_000_000n : unit.startsWith('Nano') ? 1_000_000_000n : 1n);

const formatArgs = (prefix = '') => [
  editable(`${prefix}builtin`, 'Built in formats', DATETIME_FORMATS),
  str(`${prefix}format`, 'Input format string', 'DD/MM/YYYY HH:mm:ss'),
  sel(`${prefix}zone`, 'Input timezone', ZONES, 'UTC'),
];

const inputFormat = (a: Record<string, unknown>) => String(a.format ?? '') || String(a.builtin ?? '');

const EPOCH_DIFF = 11644473600n;

export const datetimeOps: Operation[] = [
  defineOp({
    name: 'Parse DateTime',
    category: C,
    description: 'Reads a date in a given format and time zone and shows it in detail.',
    input: 'text',
    output: 'text',
    args: formatArgs(),
    run: (input, a) => {
      const zone = sArg(a, 'zone');
      const epoch = parseDate(input, inputFormat(a), zone);
      const p = partsIn(epoch, zone);
      const leap = (p.year % 4 === 0 && p.year % 100 !== 0) || p.year % 400 === 0;
      return [
        `Date: ${formatDate(epoch, 'dddd Do MMMM YYYY', zone)}`,
        `Time: ${formatDate(epoch, 'HH:mm:ss', zone)}`,
        `Period: ${p.hour < 12 ? 'AM' : 'PM'}`,
        `Timezone: ${zone}`,
        `UTC offset: ${formatDate(epoch, 'Z', zone)}`,
        '',
        `Daylight Saving Time: ${zone !== 'UTC' && zoneOffsetMinutes(epoch, zone) !== Math.min(zoneOffsetMinutes(Date.UTC(p.year, 0, 1), zone), zoneOffsetMinutes(Date.UTC(p.year, 6, 1), zone)) ? 'true' : 'false'}`,
        `Leap year: ${leap}`,
        `Days in this month: ${new Date(Date.UTC(p.year, p.month, 0)).getUTCDate()}`,
        '',
        `Day of year: ${formatDate(epoch, 'DDD', zone)}`,
        `Week number: ${formatDate(epoch, 'W', zone)}`,
        `Quarter: ${formatDate(epoch, 'Q', zone)}`,
        '',
        `UNIX timestamp: ${Math.floor(epoch / 1000)}`,
        `ISO 8601 (UTC): ${new Date(epoch).toISOString()}`,
      ].join('\n');
    },
  }),
  defineOp({
    name: 'Translate DateTime Format',
    category: C,
    description: 'Rewrites a date from one format and time zone into another.',
    input: 'text',
    output: 'text',
    args: [...formatArgs(), str('outFormat', 'Output format string', 'dddd Do MMMM YYYY HH:mm:ss Z z'), sel('outZone', 'Output timezone', ZONES, 'UTC')],
    run: (input, a) => formatDate(parseDate(input, inputFormat(a), sArg(a, 'zone')), sArg(a, 'outFormat'), sArg(a, 'outZone')),
  }),
  defineOp({
    name: 'From UNIX Timestamp',
    category: C,
    description: 'Turns a UNIX timestamp into a UTC date and time.',
    input: 'text',
    output: 'text',
    args: [sel('units', 'Units', UNITS)],
    magic: [
      { pattern: /^1?\d{9}$/, args: { units: 'Seconds (s)' } },
      { pattern: /^1?\d{12}$/, args: { units: 'Milliseconds (ms)' } },
    ],
    run: (input, a) => {
      const text = input.trim();
      if (!/^-?\d+(\.\d+)?$/.test(text)) throw new OpError('Enter a number.');
      const unit = sArg(a, 'units');
      const value = Number(text);
      const ms = unit.startsWith('Seconds') ? value * 1000 : unit.startsWith('Milli') ? value : unit.startsWith('Micro') ? value / 1000 : value / 1e6;
      if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) throw new OpError('The timestamp is out of range.');
      return `${formatDate(ms, unit.startsWith('Seconds') ? 'ddd D MMMM YYYY HH:mm:ss' : 'ddd D MMMM YYYY HH:mm:ss.SSS', 'UTC')} UTC`;
    },
  }),
  defineOp({
    name: 'To UNIX Timestamp',
    category: C,
    description: 'Turns a date into a UNIX timestamp.',
    input: 'text',
    output: 'text',
    args: [sel('units', 'Units', UNITS), bool('utc', 'Treat as UTC', true), bool('show', 'Show parsed datetime', true)],
    run: (input, a) => {
      let text = input.trim();
      if (bArg(a, 'utc') && !/(Z|[+-]\d{2}:?\d{2}|UTC|GMT)$/i.test(text))
        text = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : `${text} UTC`.replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?) UTC$/, '$1T$2Z');
      const ms = Date.parse(text);
      if (Number.isNaN(ms)) throw new OpError(`"${input.trim()}" is not a recognisable date.`);
      const unit = sArg(a, 'units');
      const value = unit.startsWith('Seconds') ? Math.floor(ms / 1000) : unit.startsWith('Milli') ? ms : unit.startsWith('Micro') ? ms * 1000 : BigInt(ms) * 1_000_000n;
      return bArg(a, 'show') ? `${value} (${formatDate(ms, 'ddd D MMMM YYYY HH:mm:ss', 'UTC')} UTC)` : String(value);
    },
  }),
  defineOp({
    name: 'Windows Filetime to UNIX Timestamp',
    category: C,
    description: 'Converts a Windows FILETIME (100 ns intervals since 1601) to a UNIX timestamp.',
    input: 'text',
    output: 'text',
    args: [sel('units', 'Output units', UNITS), sel('format', 'Input format', ['Decimal', 'Hex (big endian)', 'Hex (little endian)'])],
    run: (input, a) => {
      let text = input.trim();
      const format = sArg(a, 'format');
      if (format !== 'Decimal') {
        text = text.replace(/^0x/i, '').replace(/\s/g, '');
        if (format === 'Hex (little endian)') text = (text.match(/../g) ?? []).reverse().join('');
        text = BigInt(`0x${text}`).toString();
      }
      const ticks = BigInt(text);
      const ns = (ticks - EPOCH_DIFF * 10_000_000n) * 100n;
      const scale = unitScale(sArg(a, 'units'));
      return (ns / (1_000_000_000n / scale)).toString();
    },
  }),
  defineOp({
    name: 'UNIX Timestamp to Windows Filetime',
    category: C,
    description: 'Converts a UNIX timestamp to a Windows FILETIME.',
    input: 'text',
    output: 'text',
    args: [sel('units', 'Input units', UNITS), sel('format', 'Output format', ['Decimal', 'Hex (big endian)', 'Hex (little endian)'])],
    run: (input, a) => {
      const scale = unitScale(sArg(a, 'units'));
      const ns = (BigInt(input.trim().split('.')[0] ?? '0') * 1_000_000_000n) / scale;
      const ticks = ns / 100n + EPOCH_DIFF * 10_000_000n;
      const format = sArg(a, 'format');
      if (format === 'Decimal') return ticks.toString();
      const hexText = ticks.toString(16).padStart(16, '0');
      return format === 'Hex (little endian)' ? (hexText.match(/../g) ?? []).reverse().join('') : hexText;
    },
  }),
  defineOp({
    name: 'DateTime Delta',
    category: C,
    description: 'Adds or subtracts days, hours, minutes and seconds from a date.',
    input: 'text',
    output: 'text',
    args: [
      editable('builtin', 'Built in formats', DATETIME_FORMATS),
      str('format', 'Input format string', 'DD/MM/YYYY HH:mm:ss'),
      sel('op', 'Time Operation', ['Add', 'Subtract']),
      num('days', 'Days', 0),
      num('hours', 'Hours', 0),
      num('minutes', 'Minutes', 0),
      num('seconds', 'Seconds', 0),
    ],
    run: (input, a) => {
      const pattern = inputFormat(a);
      const epoch = parseDate(input, pattern, 'UTC');
      const delta = (nArg(a, 'days') * 86400 + nArg(a, 'hours') * 3600 + nArg(a, 'minutes') * 60 + nArg(a, 'seconds')) * 1000;
      return formatDate(epoch + (sArg(a, 'op') === 'Add' ? delta : -delta), pattern || 'YYYY-MM-DD HH:mm:ss', 'UTC');
    },
  }),
  defineOp({
    name: 'Extract dates',
    category: C,
    also: ['Extractors'],
    description: 'Finds dates written as yyyy-mm-dd, dd/mm/yyyy or mm/dd/yyyy.',
    input: 'text',
    output: 'text',
    args: [bool('total', 'Display total')],
    run: (input, a) => {
      const found =
        input.match(
          /(?:(?:19|20)\d\d[- /.](?:0[1-9]|1[012])[- /.](?:0[1-9]|[12][0-9]|3[01]))|(?:(?:0[1-9]|[12][0-9]|3[01])[- /.](?:0[1-9]|1[012])[- /.](?:19|20)\d\d)|(?:(?:0[1-9]|1[012])[- /.](?:0[1-9]|[12][0-9]|3[01])[- /.](?:19|20)\d\d)/g,
        ) ?? [];
      return (bArg(a, 'total') ? `Total found: ${found.length}\n\n` : '') + found.join('\n');
    },
  }),
  defineOp({
    name: 'Get Time',
    category: C,
    description: 'The current UNIX time.',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [sel('units', 'Granularity', UNITS)],
    run: (_input, a) => {
      const ms = Date.now();
      const unit = sArg(a, 'units');
      return unit.startsWith('Seconds') ? String(Math.floor(ms / 1000)) : unit.startsWith('Milli') ? String(ms) : unit.startsWith('Micro') ? String(ms * 1000) : (BigInt(ms) * 1_000_000n).toString();
    },
  }),
];
