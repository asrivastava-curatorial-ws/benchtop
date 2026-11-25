/**
 * Data logging: reading numbers out of the lines a sensor or instrument prints,
 * keeping them with the time they arrived, calibrating, summarising, and
 * writing tables for CSV, SQLite and Parquet.
 */

export type LineFormat = 'auto' | 'numbers' | 'pairs' | 'json';

export type LineResult =
  | { readonly kind: 'values'; readonly values: [string, number][]; readonly units: Record<string, string> }
  | { readonly kind: 'header'; readonly names: string[] }
  | { readonly kind: 'skip' };

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
const PAIR = /([\p{L}_][\p{L}\p{M}\p{N}_ .\-/%°()[\]]*?)\s*[:=]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)([^\s,;|]*)/gu;

function flatten(value: unknown, prefix: string, out: [string, number][]): void {
  if (typeof value === 'number' && Number.isFinite(value)) out.push([prefix, value]);
  else if (typeof value === 'boolean') out.push([prefix, value ? 1 : 0]);
  else if (Array.isArray(value)) for (const [index, item] of value.entries()) flatten(item, prefix ? `${prefix}.${index}` : String(index), out);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, out);
}

/** Reads one line at a time; a line of names (a CSV header) names the columns that follow. */
export class LineParser {
  names: string[] = [];

  constructor(public format: LineFormat = 'auto') {}

  parse(raw: string): LineResult {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) return { kind: 'skip' };
    const format = this.format === 'auto' ? (line.startsWith('{') ? 'json' : /[\p{L}_][^,;|]*?[:=]\s*[-+.]?\d/u.test(line) ? 'pairs' : 'numbers') : this.format;
    if (format === 'json') {
      try {
        const values: [string, number][] = [];
        flatten(JSON.parse(line), '', values);
        return values.length ? { kind: 'values', values, units: {} } : { kind: 'skip' };
      } catch {
        return { kind: 'skip' };
      }
    }
    if (format === 'pairs') {
      const values: [string, number][] = [];
      const units: Record<string, string> = {};
      for (const match of line.matchAll(PAIR)) {
        const name = (match[1] as string).trim();
        values.push([name, Number(match[2])]);
        if (match[3]) units[name] = match[3];
      }
      return values.length ? { kind: 'values', values, units } : { kind: 'skip' };
    }
    const tokens = line.split(/[\s,;|]+/).filter(Boolean);
    const values: [string, number][] = [];
    const units: Record<string, string> = {};
    tokens.forEach((token, index) => {
      const number = NUMBER.exec(token);
      if (!number) return;
      const rest = token.slice(number[0].length);
      // "12:30:05" and "2026-11-23" are clock readings of the device, not measurements.
      if (/^[:-]\d/.test(rest)) return;
      const name = this.names[index] ?? `ch${index + 1}`;
      values.push([name, Number(number[0])]);
      if (rest) units[name] = rest;
    });
    if (values.length) return { kind: 'values', values, units };
    // A header is a list of names with commas, semicolons or tabs between them (or one name); a sentence is not.
    const listed = tokens.length === 1 || /[,;\t|]/.test(line);
    if (listed && tokens.length && tokens.every((token) => /^[\p{L}_][\p{L}\p{M}\p{N}_.\-()%°/[\]]*$/u.test(token))) {
      this.names = tokens;
      return { kind: 'header', names: tokens };
    }
    return { kind: 'skip' };
  }
}

export interface ChannelSetup {
  /** The name the device uses. */
  readonly name: string;
  /** The name shown and written to files. */
  readonly label: string;
  readonly unit: string;
  /** Shown value = raw × scale + offset. */
  readonly scale: number;
  readonly offset: number;
  readonly visible: boolean;
}

export const defaultSetup = (name: string, unit = ''): ChannelSetup => ({ name, label: name, unit, scale: 1, offset: 0, visible: true });

export interface Marker {
  readonly time: number;
  readonly text: string;
}

/** The readings of one recording: a time for every row, a number (or NaN) for every channel. */
export class Recording {
  readonly times: number[] = [];
  readonly channels: string[] = [];
  readonly markers: Marker[] = [];
  private readonly data = new Map<string, number[]>();

  constructor(
    readonly start = Date.now(),
    readonly limit = 2_000_000,
  ) {}

  get length(): number {
    return this.times.length;
  }

  /** Adds a row; false when the recording is full. */
  add(time: number, values: Iterable<readonly [string, number]>): boolean {
    if (this.times.length >= this.limit) return false;
    const row = this.times.length;
    this.times.push(time);
    for (const [name, value] of values) {
      let column = this.data.get(name);
      if (!column) {
        column = new Array<number>(row).fill(Number.NaN);
        this.data.set(name, column);
        this.channels.push(name);
      }
      column[row] = value;
    }
    for (const column of this.data.values()) if (column.length <= row) column.push(Number.NaN);
    return true;
  }

  column(name: string): readonly number[] {
    return this.data.get(name) ?? [];
  }
}

export interface Summary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  /** Sample standard deviation. */
  readonly sd: number;
  readonly last: number;
}

export function summarise(values: readonly number[], scale = 1, offset = 0): Summary {
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  let mean = 0;
  let spread = 0;
  let last = Number.NaN;
  for (const raw of values) {
    if (Number.isNaN(raw)) continue;
    const value = raw * scale + offset;
    count += 1;
    if (value < min) min = value;
    if (value > max) max = value;
    // Welford's running mean and variance.
    const delta = value - mean;
    mean += delta / count;
    spread += delta * (value - mean);
    last = value;
  }
  if (!count) return { count: 0, min: Number.NaN, max: Number.NaN, mean: Number.NaN, sd: Number.NaN, last };
  return { count, min, max, mean, sd: count > 1 ? Math.sqrt(spread / (count - 1)) : 0, last };
}

/** Averages readings over fixed intervals: one row per interval, stamped with the interval's end. */
export class Averager {
  private sums = new Map<string, { sum: number; count: number }>();
  private end = 0;

  constructor(readonly interval: number) {}

  /** Feeds a reading; returns the finished rows (none, or one per interval that ended). */
  push(time: number, values: Iterable<readonly [string, number]>): { time: number; values: [string, number][] }[] {
    if (this.interval <= 0) return [{ time, values: [...values].map(([name, value]) => [name, value]) }];
    const done: { time: number; values: [string, number][] }[] = [];
    if (this.end === 0) this.end = time + this.interval;
    while (time >= this.end) {
      if (this.sums.size) done.push({ time: this.end, values: [...this.sums].map(([name, s]) => [name, s.sum / s.count]) });
      this.sums = new Map();
      this.end += this.interval;
    }
    for (const [name, value] of values) {
      const entry = this.sums.get(name) ?? { sum: 0, count: 0 };
      entry.sum += value;
      entry.count += 1;
      this.sums.set(name, entry);
    }
    return done;
  }

  /** What is left of the interval in progress. */
  flush(time: number): { time: number; values: [string, number][] } | null {
    if (this.interval <= 0 || !this.sums.size) return null;
    const row = { time, values: [...this.sums].map(([name, s]): [string, number] => [name, s.sum / s.count]) };
    this.sums = new Map();
    this.end = 0;
    return row;
  }
}

/** 2026-11-23T21:45:10.123+05:30: local time with its offset, so it is unambiguous anywhere. */
export function isoLocal(time: number, offsetMinutes = -new Date(time).getTimezoneOffset()): string {
  const shifted = new Date(time + offsetMinutes * 60_000).toISOString().slice(0, 23);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${shifted}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export interface Table {
  /** Milliseconds since 1970, and seconds since the recording began. */
  readonly times: readonly number[];
  readonly elapsed: number[];
  readonly columns: { readonly id: string; readonly label: string; readonly unit: string; readonly setup: ChannelSetup; readonly values: (number | null)[] }[];
  /** For each row, the notes made since the row before. */
  readonly notes: string[];
  readonly markers: readonly Marker[];
}

/** A name usable as a column in a database: letters, digits and underscores, unique. */
function identifier(label: string, used: Set<string>): string {
  const base =
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'channel';
  let id = /^\d/.test(base) ? `c_${base}` : base;
  if (['time', 'time_ms', 'elapsed_s', 'note'].includes(id)) id = `${id}_value`;
  let candidate = id;
  for (let n = 2; used.has(candidate); n++) candidate = `${id}_${n}`;
  used.add(candidate);
  return candidate;
}

/** The recording as a table of calibrated values. */
export function tableOf(recording: Recording, setups: readonly ChannelSetup[]): Table {
  const used = new Set<string>();
  const columns = recording.channels.map((name) => {
    const setup = setups.find((s) => s.name === name) ?? defaultSetup(name);
    const raw = recording.column(name);
    return {
      id: identifier(setup.label || name, used),
      label: setup.label || name,
      unit: setup.unit,
      setup,
      values: raw.map((value) => (Number.isNaN(value) ? null : value * setup.scale + setup.offset)),
    };
  });
  const notes = recording.times.map(() => '');
  for (const marker of recording.markers) {
    let row = recording.times.findIndex((time) => time >= marker.time);
    if (row < 0) row = recording.times.length - 1;
    if (row >= 0) notes[row] = notes[row] ? `${notes[row]}; ${marker.text}` : marker.text;
  }
  return { times: recording.times, elapsed: recording.times.map((time) => (time - recording.start) / 1000), columns, notes, markers: recording.markers };
}

const cell = (text: string) => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
const figure = (value: number | null) => (value === null ? '' : String(Math.round(value * 1e9) / 1e9));

export function toCsv(table: Table, offsetMinutes?: number): string {
  const hasNotes = table.notes.some(Boolean);
  const header = ['time', 'elapsed_s', ...table.columns.map((c) => cell(c.unit ? `${c.label} (${c.unit})` : c.label)), ...(hasNotes ? ['note'] : [])];
  const lines = [header.join(',')];
  table.times.forEach((time, row) => {
    lines.push(
      [isoLocal(time, offsetMinutes), (table.elapsed[row] as number).toFixed(3), ...table.columns.map((c) => figure(c.values[row] ?? null)), ...(hasNotes ? [cell(table.notes[row] ?? '')] : [])].join(
        ',',
      ),
    );
  });
  return `${lines.join('\r\n')}\r\n`;
}

/** SQL that builds the tables of a recording; the rows are added by the caller with bound values. */
export function sqliteSchema(table: Table): string {
  return [
    `CREATE TABLE readings (time_ms INTEGER NOT NULL, time TEXT NOT NULL, elapsed_s REAL NOT NULL${table.columns.map((c) => `, "${c.id}" REAL`).join('')}, note TEXT);`,
    'CREATE TABLE channels (column_name TEXT PRIMARY KEY, label TEXT, unit TEXT, device_name TEXT, scale REAL, offset REAL);',
    'CREATE TABLE markers (time_ms INTEGER NOT NULL, time TEXT NOT NULL, text TEXT NOT NULL);',
    'CREATE INDEX readings_time ON readings (time_ms);',
  ].join('\n');
}

/** A made-up weather sensor for trying the logger out: the same reading for the same moment. */
export function demoReading(seconds: number): [string, number][] {
  const wobble = (period: number, phase: number) => Math.sin((seconds / period) * Math.PI * 2 + phase);
  const noise = (seed: number) => {
    const x = Math.sin(seconds * 12.9898 + seed * 78.233) * 43758.5453;
    return (x - Math.floor(x) - 0.5) * 2;
  };
  return [
    ['temperature', Math.round((24 + 3 * wobble(60, 0) + 0.15 * noise(1)) * 100) / 100],
    ['humidity', Math.round((52 - 8 * wobble(60, 0.6) + 0.5 * noise(2)) * 10) / 10],
    ['pressure', Math.round((1008 + 2 * wobble(180, 1.2) + 0.1 * noise(3)) * 100) / 100],
  ];
}

export const DEMO_UNITS: Readonly<Record<string, string>> = { temperature: '°C', humidity: '%', pressure: 'hPa' };
