/**
 * Instrument panels: dials, bars, read-outs, lamps and trends that show the
 * values a device sends over a serial port, and buttons, switches and sliders
 * that send it commands.  This module holds a panel's description, the sums
 * behind its widgets, and a pretend device to try a panel on.
 */

export type WidgetKind = 'gauge' | 'bar' | 'number' | 'lamp' | 'trend' | 'button' | 'switch' | 'slider';

export const WIDGET_NAMES: Record<WidgetKind, string> = {
  gauge: 'Dial',
  bar: 'Bar',
  number: 'Read-out',
  lamp: 'Lamp',
  trend: 'Trend',
  button: 'Button',
  switch: 'Switch',
  slider: 'Slider',
};

export const isControl = (kind: WidgetKind) => kind === 'button' || kind === 'switch' || kind === 'slider';

export interface Widget {
  readonly id: string;
  readonly kind: WidgetKind;
  readonly title: string;
  /** The name of the value shown, as the device sends it ("temp" in "temp:23.4"). */
  readonly channel: string;
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly decimals: number;
  /** A lamp is lit from this value up; a dial and a bar mark it as their limit.  NaN for none. */
  readonly limit: number;
  /** What a control sends: `{value}` stands for a slider's value. A switch sends this when turned on ... */
  readonly command: string;
  /** ... and this when turned off. */
  readonly commandOff: string;
  readonly step: number;
}

export interface PanelDoc {
  readonly kind: 'benchtop-panel';
  readonly version: 1;
  readonly title: string;
  readonly baud: number;
  readonly widgets: readonly Widget[];
}

let made = 0;
export const widgetId = () => `w${Date.now().toString(36)}${(made++).toString(36)}`;

export function newWidget(kind: WidgetKind, channel = ''): Widget {
  return {
    id: widgetId(),
    kind,
    title: isControl(kind) ? WIDGET_NAMES[kind] : channel || WIDGET_NAMES[kind],
    channel,
    min: 0,
    max: kind === 'slider' ? 255 : 100,
    unit: '',
    decimals: kind === 'slider' ? 0 : 1,
    limit: kind === 'lamp' ? 1 : Number.NaN,
    command: kind === 'button' ? 'PING' : kind === 'switch' ? 'LED 1' : kind === 'slider' ? 'PWM {value}' : '',
    commandOff: kind === 'switch' ? 'LED 0' : '',
    step: 1,
  };
}

const KINDS = Object.keys(WIDGET_NAMES) as WidgetKind[];
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const short = (value: unknown, limit: number) => (typeof value === 'string' ? value.slice(0, limit) : '');

/** A panel from what was stored or opened; anything that is not one comes back as null. */
export function readPanel(value: unknown): PanelDoc | null {
  if (!value || typeof value !== 'object') return null;
  const doc = value as Record<string, unknown>;
  if (doc.kind !== 'benchtop-panel' || !Array.isArray(doc.widgets)) return null;
  const widgets: Widget[] = [];
  for (const raw of doc.widgets.slice(0, 60)) {
    if (!raw || typeof raw !== 'object') continue;
    const w = raw as Record<string, unknown>;
    if (!KINDS.includes(w.kind as WidgetKind)) continue;
    const min = finite(w.min, 0);
    const max = finite(w.max, 100);
    widgets.push({
      id: typeof w.id === 'string' && w.id && !widgets.some((other) => other.id === w.id) ? w.id.slice(0, 40) : widgetId(),
      kind: w.kind as WidgetKind,
      title: short(w.title, 60),
      channel: short(w.channel, 60),
      // A range given the wrong way round is turned; one with no width is given some.
      min: Math.min(min, max),
      max: max === min ? min + 1 : Math.max(min, max),
      unit: short(w.unit, 12),
      decimals: Math.max(0, Math.min(6, Math.round(finite(w.decimals, 1)))),
      limit: typeof w.limit === 'number' ? w.limit : Number.NaN,
      command: short(w.command, 200),
      commandOff: short(w.commandOff, 200),
      step: Math.max(1e-6, finite(w.step, 1)),
    });
  }
  return { kind: 'benchtop-panel', version: 1, title: short(doc.title, 80) || 'Panel', baud: Math.max(300, Math.min(4_000_000, Math.round(finite(doc.baud, 115200)))), widgets };
}

/** NaN cannot be written as JSON: a missing limit is left out of the file. */
export const panelFile = (doc: PanelDoc): string => JSON.stringify({ ...doc, widgets: doc.widgets.map((w) => (Number.isNaN(w.limit) ? { ...w, limit: null } : w)) }, null, 2);

/** How far along its range a value is, 0 to 1. */
export const fraction = (widget: Pick<Widget, 'min' | 'max'>, value: number) => Math.max(0, Math.min(1, (value - widget.min) / (widget.max - widget.min)));

export function valueText(widget: Pick<Widget, 'decimals' | 'unit'>, value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(widget.decimals)}${widget.unit ? ` ${widget.unit}` : ''}`;
}

/** The text a control sends, without its line ending. */
export function commandFor(widget: Widget, value: number | boolean): string {
  if (widget.kind === 'switch') return value ? widget.command : widget.commandOff;
  if (widget.kind === 'slider') return widget.command.replaceAll('{value}', String(typeof value === 'number' ? Number(value.toFixed(6)) : value ? 1 : 0));
  return widget.command;
}

/** The latest value of every name a device has sent, and what the trends need of the past. */
export class Readings {
  readonly latest = new Map<string, number>();
  private readonly past = new Map<string, number[]>();
  count = 0;

  constructor(readonly keep = 240) {}

  add(values: readonly (readonly [string, number])[]): void {
    this.count++;
    for (const [name, value] of values) {
      this.latest.set(name, value);
      let list = this.past.get(name);
      if (!list) {
        list = [];
        this.past.set(name, list);
      }
      list.push(value);
      if (list.length > this.keep) list.splice(0, list.length - this.keep);
    }
  }

  history(name: string): readonly number[] {
    return this.past.get(name) ?? [];
  }

  get names(): string[] {
    return [...this.latest.keys()];
  }
}

/** A trend's points for a drawing `width` by `height`, with the range they span. */
export function trendPath(values: readonly number[], width: number, height: number): { path: string; low: number; high: number } {
  if (!values.length) return { path: '', low: 0, high: 0 };
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (high - low < 1e-9) {
    low -= 0.5;
    high += 0.5;
  }
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const path = values.map((value, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - ((value - low) / (high - low)) * height).toFixed(1)}`).join(' ');
  return { path, low, high };
}

/* ---------------------------------------------------------- demo -- */

/** A panel for the pretend device: a small climate box with a fan and a lamp. */
export function samplePanel(): PanelDoc {
  const w = (kind: WidgetKind, patch: Partial<Widget>): Widget => ({ ...newWidget(kind, patch.channel ?? ''), ...patch });
  return {
    kind: 'benchtop-panel',
    version: 1,
    title: 'Climate box',
    baud: 115200,
    widgets: [
      w('gauge', { title: 'Temperature', channel: 'temp', min: 0, max: 50, unit: '°C', limit: 30 }),
      w('bar', { title: 'Humidity', channel: 'humidity', min: 0, max: 100, unit: '%', decimals: 0 }),
      w('number', { title: 'Light', channel: 'light', min: 0, max: 1023, unit: '', decimals: 0 }),
      w('trend', { title: 'Temperature, last minute', channel: 'temp', unit: '°C' }),
      w('lamp', { title: 'Fan running', channel: 'fan', limit: 1 }),
      w('slider', { title: 'Fan speed', command: 'FAN {value}', min: 0, max: 255, step: 5 }),
      w('switch', { title: 'Lamp', command: 'LED 1', commandOff: 'LED 0' }),
      w('button', { title: 'Reset the box', command: 'RESET' }),
    ],
  };
}

/**
 * A pretend device: a warm box whose fan cools it.  It prints a line of readings when asked
 * for one and takes the sample panel's commands.
 */
export class DemoDevice {
  private temp = 31;
  private fan = 0;
  private led = 0;
  private time = 0;

  /** Moves the pretend world on by `seconds` and gives the line the device prints. */
  line(seconds: number): string {
    this.time += seconds;
    // The box warms towards 34 °C by itself (more with the lamp on) and the fan pulls it towards 22 °C.
    const target = 34 + this.led * 3 - (this.fan / 255) * (12 + this.led * 3);
    this.temp += (target - this.temp) * Math.min(1, seconds / 6);
    const humidity = 48 + 6 * Math.sin(this.time / 9) - (this.fan / 255) * 8;
    const light = this.led ? 880 + 20 * Math.sin(this.time * 1.7) : 210 + 30 * Math.sin(this.time / 4);
    return `temp:${this.temp.toFixed(2)},humidity:${humidity.toFixed(1)},light:${Math.round(light)},fan:${this.fan},led:${this.led}`;
  }

  /** Takes a command; gives the device's answer, if it has one. */
  receive(command: string): string {
    const [word, argument] = command.trim().split(/\s+/);
    const number = Number(argument);
    if (word === 'FAN' && Number.isFinite(number)) this.fan = Math.max(0, Math.min(255, Math.round(number)));
    else if (word === 'LED' && Number.isFinite(number)) this.led = number ? 1 : 0;
    else if (word === 'RESET') {
      this.temp = 31;
      this.fan = 0;
      this.led = 0;
      return '# reset';
    } else return `# unknown command: ${command.trim().slice(0, 40)}`;
    return '';
  }
}

/** A sketch for an Arduino that a panel like the sample works with: readings out, commands in. */
export const PANEL_SKETCH = `// Readings for Benchtop's Instrument Panel, and its commands.
// It prints a line like  light:512,volts:2.50,led:0  five times a second,
// and takes the lines  LED 1 , LED 0  and  PWM 128  (pin 9).

int led = 0;
char line[24];
int length = 0;
unsigned long last = 0;

void command() {
  // The number after the first space.
  int value = 0;
  int at = 0;
  while (at < length && line[at] != ' ') at++;
  for (at++; at < length && line[at] >= '0' && line[at] <= '9'; at++) value = value * 10 + (line[at] - '0');
  if (line[0] == 'L') {
    led = value ? 1 : 0;
    digitalWrite(LED_BUILTIN, led ? HIGH : LOW);
  } else if (line[0] == 'P') {
    analogWrite(9, constrain(value, 0, 255));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(9, OUTPUT);
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\\n') {
      command();
      length = 0;
    } else if (c != '\\r' && length < 23) {
      line[length++] = c;
    }
  }
  if (millis() - last >= 200) {
    last = millis();
    Serial.print("light:");
    Serial.print(analogRead(A0));
    Serial.print(",volts:");
    Serial.print(analogRead(A1) * 5.0 / 1023.0);
    Serial.print(",led:");
    Serial.println(led);
  }
}
`;
