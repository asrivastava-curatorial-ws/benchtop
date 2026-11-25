import { describe, expect, it } from 'vitest';
import { LineParser } from '../../src/lib/datalog';
import { commandFor, DemoDevice, fraction, newWidget, PANEL_SKETCH, panelFile, Readings, readPanel, samplePanel, trendPath, valueText } from '../../src/lib/panel';

describe('an instrument panel', () => {
  it('is saved as a file and read back the same, with what does not belong left out', () => {
    const doc = samplePanel();
    const back = readPanel(JSON.parse(panelFile(doc)));
    expect(back?.title).toBe('Climate box');
    expect(back?.widgets.map((w) => [w.kind, w.title, w.channel])).toEqual(doc.widgets.map((w) => [w.kind, w.title, w.channel]));
    // A limit that is not set survives the trip through JSON, which has no "not a number".
    expect(Number.isNaN(back?.widgets[1]?.limit)).toBe(true);
    expect(back?.widgets[0]?.limit).toBe(30);
    expect(readPanel({ kind: 'something-else', widgets: [] })).toBeNull();
    expect(readPanel(null)).toBeNull();
    const odd = readPanel({
      kind: 'benchtop-panel',
      title: 7,
      baud: 12,
      widgets: [{ kind: 'gauge', min: 10, max: 5, decimals: 99, title: 'x'.repeat(200) }, { kind: 'rocket' }, 'nonsense', { kind: 'button', command: 'GO' }],
    });
    expect(odd?.title).toBe('Panel');
    expect(odd?.baud).toBe(300);
    expect(odd?.widgets).toHaveLength(2);
    // A range the wrong way round is put right, and numbers are kept within reason.
    expect(odd?.widgets[0]).toMatchObject({ min: 5, max: 10, decimals: 6 });
    expect(odd?.widgets[0]?.title).toHaveLength(60);
    expect(odd?.widgets[0]?.id).not.toBe(odd?.widgets[1]?.id);
  });

  it('places values on their range and words them', () => {
    const dial = { ...newWidget('gauge', 'temp'), min: -20, max: 60, unit: '°C', decimals: 1 };
    expect(fraction(dial, 20)).toBe(0.5);
    expect(fraction(dial, -50)).toBe(0);
    expect(fraction(dial, 99)).toBe(1);
    expect(valueText(dial, 23.456)).toBe('23.5 °C');
    expect(valueText({ decimals: 0, unit: '' }, 7.6)).toBe('8');
    expect(valueText(dial, undefined)).toBe('—');
  });

  it('builds what its controls send', () => {
    expect(commandFor({ ...newWidget('slider'), command: 'PWM {value}' }, 128)).toBe('PWM 128');
    expect(commandFor({ ...newWidget('slider'), command: 'SET {value} {value}' }, 0.1 + 0.2)).toBe('SET 0.3 0.3');
    const lamp = { ...newWidget('switch'), command: 'LED 1', commandOff: 'LED 0' };
    expect(commandFor(lamp, true)).toBe('LED 1');
    expect(commandFor(lamp, false)).toBe('LED 0');
    expect(commandFor({ ...newWidget('button'), command: 'RESET' }, true)).toBe('RESET');
  });

  it('keeps the latest readings and a short past for trends', () => {
    const readings = new Readings(3);
    readings.add([['a', 1]]);
    readings.add([
      ['a', 2],
      ['b', 10],
    ]);
    readings.add([['a', 3]]);
    readings.add([['a', 4]]);
    expect(readings.latest.get('a')).toBe(4);
    expect(readings.latest.get('b')).toBe(10);
    expect(readings.history('a')).toEqual([2, 3, 4]);
    expect(readings.history('nothing')).toEqual([]);
    expect(readings.names).toEqual(['a', 'b']);
    expect(readings.count).toBe(4);
    expect(trendPath([2, 3, 4], 200, 60)).toEqual({ path: 'M0.0,60.0 L100.0,30.0 L200.0,0.0', low: 2, high: 4 });
    // A flat line is drawn through the middle; no readings, no line.
    expect(trendPath([5, 5], 200, 60).path).toBe('M0.0,30.0 L200.0,30.0');
    expect(trendPath([], 200, 60).path).toBe('');
  });

  it('has a pretend device that answers the sample panel', () => {
    const device = new DemoDevice();
    const parser = new LineParser('auto');
    const first = parser.parse(device.line(0));
    expect(first.kind).toBe('values');
    if (first.kind !== 'values') return;
    expect(first.values.map(([name]) => name)).toEqual(['temp', 'humidity', 'light', 'fan', 'led']);
    // Every value the sample panel shows is one the device sends.
    const names = new Set(first.values.map(([name]) => name));
    for (const widget of samplePanel().widgets) if (widget.channel) expect(names.has(widget.channel), widget.channel).toBe(true);
    const tempAfter = (seconds: number) => {
      const read = parser.parse(device.line(seconds));
      return read.kind === 'values' ? (read.values[0]?.[1] ?? Number.NaN) : Number.NaN;
    };
    // Left alone the box warms; with the fan at full it cools well below where it began.
    const warm = tempAfter(60);
    expect(warm).toBeGreaterThan(33);
    expect(device.receive('FAN 255')).toBe('');
    const cool = tempAfter(60);
    expect(cool).toBeLessThan(24);
    expect(device.line(0)).toContain('fan:255');
    device.receive('LED 1');
    expect(device.line(0)).toContain('led:1');
    expect(device.receive('RESET')).toBe('# reset');
    expect(device.line(0)).toContain('fan:0,led:0');
    expect(device.receive('DANCE now')).toBe('# unknown command: DANCE now');
    // An answer that is not a reading is not taken for one.
    expect(parser.parse('# reset').kind).toBe('skip');
  });

  it('ships an example sketch that prints what the panel reads', () => {
    expect(PANEL_SKETCH).toContain('Serial.begin(115200)');
    // The line the sketch prints, as an Arduino Uno running it was seen to send it.
    const read = new LineParser('auto').parse('light:512,volts:1.25,led:1');
    expect(read).toMatchObject({
      kind: 'values',
      values: [
        ['light', 512],
        ['volts', 1.25],
        ['led', 1],
      ],
    });
  });
});
