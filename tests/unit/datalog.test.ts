import { describe, expect, it } from 'vitest';
import { Averager, defaultSetup, demoReading, isoLocal, LineParser, Recording, sqliteSchema, summarise, tableOf, toCsv } from '../../src/lib/datalog';
import { LineSplitter } from '../../src/platform/serial';

const values = (parser: LineParser, line: string) => {
  const result = parser.parse(line);
  return result.kind === 'values' ? result.values : result.kind;
};

describe('reading lines from a device', () => {
  it('reads plain numbers, named by a header line when there is one', () => {
    const parser = new LineParser();
    expect(values(parser, '23.5, 48.1\t1013')).toEqual([
      ['ch1', 23.5],
      ['ch2', 48.1],
      ['ch3', 1013],
    ]);
    expect(parser.parse('temp,hum,press')).toEqual({ kind: 'header', names: ['temp', 'hum', 'press'] });
    expect(values(parser, '-1.5e1;.5;7')).toEqual([
      ['temp', -15],
      ['hum', 0.5],
      ['press', 7],
    ]);
    expect(values(parser, '')).toBe('skip');
    expect(values(parser, '# a comment')).toBe('skip');
    expect(values(parser, 'ERROR: sensor not found')).toBe('skip');
  });

  it('keeps units and leaves out the clock of the device', () => {
    const parser = new LineParser('numbers');
    const result = parser.parse('12:30:05 23.5C 48% 2026-11-23');
    expect(result).toEqual({
      kind: 'values',
      values: [
        ['ch2', 23.5],
        ['ch3', 48],
      ],
      units: { ch2: 'C', ch3: '%' },
    });
  });

  it('reads name and value pairs in the common spellings', () => {
    const parser = new LineParser();
    expect(parser.parse('T=23.5C, H=48%')).toEqual({
      kind: 'values',
      values: [
        ['T', 23.5],
        ['H', 48],
      ],
      units: { T: 'C', H: '%' },
    });
    expect(values(parser, 'temp: 23.5 hum: 48 press:1013.2')).toEqual([
      ['temp', 23.5],
      ['hum', 48],
      ['press', 1013.2],
    ]);
    expect(values(parser, 'Soil moisture = 41.2 | Battery (V) = 3.71')).toEqual([
      ['Soil moisture', 41.2],
      ['Battery (V)', 3.71],
    ]);
    expect(values(parser, 'तापमान: 31.5')).toEqual([['तापमान', 31.5]]);
  });

  it('reads JSON lines, nested values included', () => {
    const parser = new LineParser();
    expect(values(parser, '{"temp":23.5,"ok":true,"gps":{"lat":12.97,"sats":[7,8]},"id":"x"}')).toEqual([
      ['temp', 23.5],
      ['ok', 1],
      ['gps.lat', 12.97],
      ['gps.sats.0', 7],
      ['gps.sats.1', 8],
    ]);
    expect(values(parser, '{"broken":')).toBe('skip');
    expect(values(new LineParser('json'), '23.5')).toEqual([['', 23.5]]);
  });

  it('cuts bytes into lines whatever the line ends', () => {
    const splitter = new LineSplitter();
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(splitter.feed(bytes('a=1\r\nb='))).toEqual(['a=1']);
    expect(splitter.feed(bytes('2\nc=3\rd'))).toEqual(['b=2', 'c=3']);
    expect(splitter.feed(bytes('=4\n'))).toEqual(['d=4']);
    // A character cut in two by the port arrives whole.
    const degree = bytes('t=1°\n');
    expect([...splitter.feed(degree.slice(0, 4)), ...splitter.feed(degree.slice(4))]).toEqual(['t=1°']);
  });
});

describe('recording', () => {
  it('keeps rows aligned when channels come and go', () => {
    const recording = new Recording(1000);
    recording.add(1000, [['a', 1]]);
    recording.add(2000, [
      ['a', 2],
      ['b', 20],
    ]);
    recording.add(3000, [['b', 30]]);
    expect(recording.channels).toEqual(['a', 'b']);
    expect(recording.column('a')).toEqual([1, 2, Number.NaN]);
    expect(recording.column('b')).toEqual([Number.NaN, 20, 30]);
    const full = new Recording(0, 2);
    expect([full.add(1, []), full.add(2, []), full.add(3, [])]).toEqual([true, true, false]);
  });

  it('summarises with calibration applied', () => {
    const summary = summarise([2, 4, 4, 4, 5, 5, 7, 9, Number.NaN]);
    expect(summary).toMatchObject({ count: 8, min: 2, max: 9, mean: 5, last: 9 });
    expect(summary.sd).toBeCloseTo(2.13809, 5);
    expect(summarise([10, 20], 0.5, 1)).toMatchObject({ min: 6, max: 11, mean: 8.5 });
    expect(summarise([]).count).toBe(0);
  });

  it('averages over intervals', () => {
    const averager = new Averager(1000);
    expect(averager.push(0, [['t', 10]])).toEqual([]);
    expect(averager.push(400, [['t', 20]])).toEqual([]);
    expect(
      averager.push(1000, [
        ['t', 30],
        ['h', 5],
      ]),
    ).toEqual([{ time: 1000, values: [['t', 15]] }]);
    // A gap of several intervals gives no empty rows.
    expect(averager.push(3500, [['t', 40]])).toEqual([
      {
        time: 2000,
        values: [
          ['t', 30],
          ['h', 5],
        ],
      },
    ]);
    expect(averager.flush(3600)).toEqual({ time: 3600, values: [['t', 40]] });
    expect(averager.flush(3700)).toBeNull();
    expect(new Averager(0).push(5, [['t', 1]])).toEqual([{ time: 5, values: [['t', 1]] }]);
  });

  it('writes local time with its offset', () => {
    const time = Date.UTC(2026, 10, 23, 16, 15, 10, 123);
    expect(isoLocal(time, 330)).toBe('2026-11-23T21:45:10.123+05:30');
    expect(isoLocal(time, -480)).toBe('2026-11-23T08:15:10.123-08:00');
    expect(isoLocal(time, 0)).toBe('2026-11-23T16:15:10.123+00:00');
  });

  it('builds a table with calibrated values, safe column names and notes on the right rows', () => {
    const start = Date.UTC(2026, 10, 23, 10, 0, 0);
    const recording = new Recording(start);
    recording.add(start, [
      ['T', 20],
      ['2nd sensor', 1],
    ]);
    recording.add(start + 1500, [['T', 22]]);
    recording.add(start + 3000, [
      ['T', 24],
      ['2nd sensor', 3],
    ]);
    recording.markers.push({ time: start + 1000, text: 'lamp on' }, { time: start + 9000, text: 'end, "quoted"' });
    const table = tableOf(recording, [{ ...defaultSetup('T', 'raw'), label: 'Temperature', unit: '°C', scale: 2, offset: -10 }]);
    expect(table.columns.map((c) => [c.id, c.label, c.unit, c.values])).toEqual([
      ['temperature', 'Temperature', '°C', [30, 34, 38]],
      ['c_2nd_sensor', '2nd sensor', '', [1, null, 3]],
    ]);
    expect(table.elapsed).toEqual([0, 1.5, 3]);
    expect(table.notes).toEqual(['', 'lamp on', 'end, "quoted"']);
    expect(toCsv(table, 330)).toBe(
      [
        'time,elapsed_s,Temperature (°C),2nd sensor,note',
        '2026-11-23T15:30:00.000+05:30,0.000,30,1,',
        '2026-11-23T15:30:01.500+05:30,1.500,34,,lamp on',
        '2026-11-23T15:30:03.000+05:30,3.000,38,3,"end, ""quoted"""',
        '',
      ].join('\r\n'),
    );
    expect(sqliteSchema(table)).toContain('"temperature" REAL, "c_2nd_sensor" REAL, note TEXT');
    const clash = new Recording(0);
    clash.add(0, [
      ['time', 1],
      ['Time', 2],
      ['a b', 3],
      ['a-b', 4],
    ]);
    expect(tableOf(clash, []).columns.map((c) => c.id)).toEqual(['time_value', 'time_value_2', 'a_b', 'a_b_2']);
  });

  it('has a demo sensor that gives the same reading for the same moment', () => {
    expect(demoReading(12.5)).toEqual(demoReading(12.5));
    const [temperature, humidity, pressure] = demoReading(30).map(([, value]) => value) as [number, number, number];
    expect(temperature).toBeGreaterThan(20);
    expect(temperature).toBeLessThan(28);
    expect(humidity).toBeGreaterThan(40);
    expect(pressure).toBeGreaterThan(1000);
  });
});
