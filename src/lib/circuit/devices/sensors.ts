/**
 * Sensor modules: DHT22 and DHT11 (one-wire timing protocol), the BME280
 * weather sensor and MPU6050 motion sensor (I²C registers), DS1307 and
 * DS3231 clocks (I²C) and the HC-SR04 ultrasonic distance sensor (echo
 * pulse).  Their readings are set in the editor while the circuit runs.
 */
import type { BoardPin, I2cTarget, PinMode, View } from '../bus';
import { address, Module, num, type Props, pinHigh, Registers, str } from '../modules';

/* ---------------------------------------------------------------- DHT -- */

export const DHT_TERMINALS = ['VCC', 'DATA', 'GND'] as const;

/** The 40 bits a DHT sensor sends: humidity, temperature, checksum. */
export function dhtBytes(model: string, humidity: number, temperature: number): number[] {
  let bytes: number[];
  if (model === 'dht11') {
    const h = Math.round(Math.min(95, Math.max(5, humidity)));
    const t = Math.min(60, Math.max(0, temperature));
    const whole = Math.floor(t);
    bytes = [h, 0, whole, Math.round((t - whole) * 10) % 10];
  } else {
    const h = Math.round(Math.min(100, Math.max(0, humidity)) * 10);
    const t = Math.round(Math.min(80, Math.max(-40, temperature)) * 10);
    const tw = t < 0 ? 0x8000 | -t : t;
    bytes = [h >> 8, h & 0xff, tw >> 8, tw & 0xff];
  }
  return [...bytes, bytes.reduce((a, b) => a + b, 0) & 0xff];
}

/**
 * A DHT22 (or DHT11) module.  The board pulls DATA low to ask (at least 1 ms
 * for the DHT22, 18 ms for the DHT11) and lets go; the sensor answers with
 * 80 µs low, 80 µs high, then each bit as 50 µs low and a high of 26 µs (0)
 * or 70 µs (1).  The module's pull-up holds the line high otherwise.
 */
export class Dht extends Module {
  private lowSince = -1;
  private busy = false;
  private cancel: (() => void)[] = [];
  reads = 0;

  protected attach(): void {
    const data = this.watch(1, (mode, at, pin) => this.changed(mode, at, pin));
    if (data) this.drives.set(data, true);
  }

  override unlink(): void {
    for (const c of this.cancel.splice(0)) c();
    this.busy = false;
    super.unlink();
  }

  /** The board's request: DATA held low long enough, then let go (or driven high) — the sensor answers from that edge. */
  private changed(mode: PinMode, at: number, pin: BoardPin): void {
    if (mode === 'low') {
      if (this.lowSince < 0) this.lowSince = at;
      return;
    }
    const since = this.lowSince;
    this.lowSince = -1;
    if (since < 0 || this.busy || !this.powered) return;
    const model = str(this.props, 'model', 'dht22');
    const held = (at - since) / pin.bus.hz;
    if (held < (model === 'dht11' ? 0.015 : 0.0008)) return;
    this.answer(pin, model);
  }

  private answer(at: BoardPin, model: string): void {
    this.busy = true;
    this.reads++;
    const us = at.bus.hz / 1e6;
    const edges: [number, boolean][] = [];
    let t = 30;
    const step = (level: boolean, length: number) => {
      edges.push([t, level]);
      t += length;
    };
    step(false, 80);
    step(true, 80);
    for (const byte of dhtBytes(model, num(this.props, 'humidity', 50), num(this.props, 'temperature', 24))) {
      for (let bit = 7; bit >= 0; bit--) {
        step(false, 50);
        step(true, (byte >> bit) & 1 ? 70 : 26);
      }
    }
    step(false, 50);
    edges.push([t, true]);
    for (const [when, level] of edges) {
      this.cancel.push(
        at.bus.after(when * us, () => {
          this.drives.set(at, level);
          if (when === t) {
            this.busy = false;
            this.cancel = [];
          }
        }),
      );
    }
  }

  view(): View {
    return { powered: this.powered, reads: this.reads };
  }
}

/* ------------------------------------------------------------- BME280 -- */

export const BME_TERMINALS = ['VIN', 'GND', 'SCL', 'SDA'] as const;

/** Calibration words of the simulated BME280 (typical values from a real sensor). */
const BME_CAL = {
  T1: 27504,
  T2: 26435,
  T3: -1000,
  P1: 36477,
  P2: -10685,
  P3: 3024,
  P4: 2855,
  P5: 140,
  P6: -7,
  P7: 15500,
  P8: -14600,
  P9: 6000,
  H1: 75,
  H2: 362,
  H3: 0,
  H4: 313,
  H5: 50,
  H6: 30,
};

/** The datasheet's floating-point compensation (section 8.1), used to find the raw readings that give the wanted values. */
const bmeTemperature = (adc: number): { t: number; fine: number } => {
  const c = BME_CAL;
  const var1 = (adc / 16384 - c.T1 / 1024) * c.T2;
  const var2 = (adc / 131072 - c.T1 / 8192) * (adc / 131072 - c.T1 / 8192) * c.T3;
  const fine = var1 + var2;
  return { t: fine / 5120, fine };
};

const bmePressure = (adc: number, fine: number): number => {
  const c = BME_CAL;
  let var1 = fine / 2 - 64000;
  let var2 = (var1 * var1 * c.P6) / 32768;
  var2 = var2 + var1 * c.P5 * 2;
  var2 = var2 / 4 + c.P4 * 65536;
  var1 = ((c.P3 * var1 * var1) / 524288 + c.P2 * var1) / 524288;
  var1 = (1 + var1 / 32768) * c.P1;
  if (var1 === 0) return 0;
  let p = 1048576 - adc;
  p = ((p - var2 / 4096) * 6250) / var1;
  var1 = (c.P9 * p * p) / 2147483648;
  var2 = (p * c.P8) / 32768;
  return (p + (var1 + var2 + c.P7) / 16) / 100;
};

const bmeHumidity = (adc: number, fine: number): number => {
  const c = BME_CAL;
  let h = fine - 76800;
  h = (adc - (c.H4 * 64 + (c.H5 / 16384) * h)) * ((c.H2 / 65536) * (1 + (c.H6 / 67108864) * h * (1 + (c.H3 / 67108864) * h)));
  h = h * (1 - (c.H1 * h) / 524288);
  return Math.min(100, Math.max(0, h));
};

/** The input of a monotonic function that gives `wanted`, by halving the range. */
function invert(f: (x: number) => number, wanted: number, lo: number, hi: number): number {
  const rising = f(hi) > f(lo);
  for (let i = 0; i < 40 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (f(mid) < wanted === rising) lo = mid;
    else hi = mid;
  }
  return Math.abs(f(lo) - wanted) <= Math.abs(f(hi) - wanted) ? lo : hi;
}

/** Raw 20-bit temperature and pressure and 16-bit humidity readings for the wanted values. */
export function bmeRaw(temperature: number, pressure: number, humidity: number): { t: number; p: number; h: number } {
  const t = invert((x) => bmeTemperature(x).t, temperature, 0, 0xfffff);
  const { fine } = bmeTemperature(t);
  const p = invert((x) => bmePressure(x, fine), pressure, 0, 0xfffff);
  const h = invert((x) => bmeHumidity(x, fine), humidity, 0, 0xffff);
  return { t, p, h };
}

export { bmeHumidity, bmePressure, bmeTemperature };

/** A BME280 temperature, humidity and pressure sensor on I²C. */
export class Bme280 extends Registers implements I2cTarget {
  private readonly regs = new Uint8Array(256);
  private cached = '';

  constructor(props: Props) {
    super(props);
    this.calibrate();
  }

  get address(): number {
    return address(this.props, 0x76);
  }

  private calibrate(): void {
    const r = this.regs;
    const c = BME_CAL;
    const word = (at: number, v: number) => {
      const u = v & 0xffff;
      r[at] = u & 0xff;
      r[at + 1] = u >> 8;
    };
    [c.T1, c.T2, c.T3, c.P1, c.P2, c.P3, c.P4, c.P5, c.P6, c.P7, c.P8, c.P9].forEach((v, i) => {
      word(0x88 + 2 * i, v);
    });
    r[0xa1] = c.H1;
    word(0xe1, c.H2);
    r[0xe3] = c.H3;
    r[0xe4] = (c.H4 >> 4) & 0xff;
    r[0xe5] = (c.H4 & 0x0f) | ((c.H5 & 0x0f) << 4);
    r[0xe6] = (c.H5 >> 4) & 0xff;
    r[0xe7] = c.H6 & 0xff;
    r[0xd0] = 0x60;
  }

  protected attach(): void {
    const bus = this.i2cBus(3, 2);
    if (bus) this.links.add(bus.attach(this.address, this));
  }

  /** Puts the live readings into the data registers (only when they changed). */
  private measure(): void {
    const t = num(this.props, 'temperature', 24);
    const p = num(this.props, 'pressure', 1013.25);
    const h = num(this.props, 'humidity', 50);
    const key = `${t},${p},${h}`;
    if (key === this.cached) return;
    this.cached = key;
    const raw = bmeRaw(t, p, h);
    const r = this.regs;
    r[0xf7] = (raw.p >> 12) & 0xff;
    r[0xf8] = (raw.p >> 4) & 0xff;
    r[0xf9] = (raw.p & 0x0f) << 4;
    r[0xfa] = (raw.t >> 12) & 0xff;
    r[0xfb] = (raw.t >> 4) & 0xff;
    r[0xfc] = (raw.t & 0x0f) << 4;
    r[0xfd] = raw.h >> 8;
    r[0xfe] = raw.h & 0xff;
  }

  protected load(register: number): number {
    if (register >= 0xf7) this.measure();
    if (register === 0xf3) return 0;
    return this.regs[register] as number;
  }

  protected store(register: number, value: number): void {
    if (register === 0xe0) {
      if (value === 0xb6) {
        this.regs[0xf2] = 0;
        this.regs[0xf4] = 0;
        this.regs[0xf5] = 0;
      }
      return;
    }
    if (register === 0xf2 || register === 0xf4 || register === 0xf5) this.regs[register] = value;
  }

  view(): View {
    return { powered: this.powered };
  }
}

/* ------------------------------------------------------------ MPU6050 -- */

export const MPU_TERMINALS = ['VCC', 'GND', 'SCL', 'SDA'] as const;

/** An MPU6050 accelerometer and gyroscope on I²C (registers as in the register map, revision 4.2). */
export class Mpu6050 extends Registers implements I2cTarget {
  private readonly regs = new Uint8Array(128);

  constructor(props: Props) {
    super(props);
    this.regs[0x6b] = 0x40;
    this.regs[0x75] = 0x68;
  }

  get address(): number {
    return address(this.props, 0x68);
  }

  protected attach(): void {
    const bus = this.i2cBus(3, 2);
    if (bus) this.links.add(bus.attach(this.address, this));
  }

  private word(value: number): [number, number] {
    const v = Math.max(-32768, Math.min(32767, Math.round(value))) & 0xffff;
    return [v >> 8, v & 0xff];
  }

  protected load(register: number): number {
    const r = this.regs;
    if (register === 0x3a) return 0x01;
    if (register >= 0x3b && register <= 0x48) {
      const asleep = ((r[0x6b] as number) & 0x40) !== 0;
      const accel = 16384 / 2 ** (((r[0x1c] as number) >> 3) & 3);
      const gyro = 131 / 2 ** (((r[0x1b] as number) >> 3) & 3);
      const p = this.props;
      const values = [
        num(p, 'ax', 0) * accel,
        num(p, 'ay', 0) * accel,
        num(p, 'az', 1) * accel,
        (num(p, 'temperature', 24) - 36.53) * 340,
        num(p, 'gx', 0) * gyro,
        num(p, 'gy', 0) * gyro,
        num(p, 'gz', 0) * gyro,
      ];
      const i = register - 0x3b;
      if (asleep) return 0;
      return this.word(values[i >> 1] ?? 0)[i & 1] as number;
    }
    return r[register & 0x7f] as number;
  }

  protected store(register: number, value: number): void {
    if (register === 0x6b && value & 0x80) {
      // Device reset.
      this.regs.fill(0);
      this.regs[0x6b] = 0x40;
      this.regs[0x75] = 0x68;
      return;
    }
    if (register !== 0x75 && register < 0x80) this.regs[register] = value;
  }

  view(): View {
    return { powered: this.powered, awake: ((this.regs[0x6b] as number) & 0x40) === 0 };
  }
}

/* ------------------------------------------------------------- clocks -- */

export const RTC_TERMINALS = ['GND', 'VCC', 'SDA', 'SCL'] as const;

const bcd = (v: number) => ((Math.floor(v / 10) << 4) | (v % 10)) & 0xff;
const fromBcd = (v: number) => (v >> 4) * 10 + (v & 0x0f);

/**
 * A DS1307 or DS3231 real-time clock on I²C (address 0x68).  It starts at
 * the computer's local time and runs with the simulation; the firmware can
 * set it.  The DS3231 also reports a temperature.
 */
export class Rtc extends Registers implements I2cTarget {
  private readonly ram = new Uint8Array(64);
  /** Local time in milliseconds at `since` seconds of firmware time. */
  private base = 0;
  private since = 0;
  private halted = false;
  private clock: BoardPin | null = null;

  constructor(props: Props, now: Date = new Date()) {
    super(props);
    this.base = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
  }

  get address(): number {
    return 0x68;
  }

  private get ds3231(): boolean {
    return str(this.props, 'chip', 'ds1307') === 'ds3231';
  }

  protected attach(): void {
    const bus = this.i2cBus(2, 3);
    if (!bus) return;
    const was = this.clock ? this.now() : this.base;
    this.clock = this.pin(2);
    this.base = was;
    this.since = this.seconds(this.clock);
    this.links.add(bus.attach(this.address, this));
  }

  /** The clock's time, as milliseconds of a UTC date holding the local time. */
  now(): number {
    return this.halted ? this.base : this.base + Math.floor((this.seconds(this.clock) - this.since) * 1000);
  }

  protected override next(register: number): number {
    return (register + 1) & (this.ds3231 ? 0x1f : 0x3f);
  }

  protected load(register: number): number {
    const d = new Date(this.now());
    switch (register) {
      case 0:
        return bcd(d.getUTCSeconds()) | (this.halted && !this.ds3231 ? 0x80 : 0);
      case 1:
        return bcd(d.getUTCMinutes());
      case 2:
        return bcd(d.getUTCHours());
      case 3:
        return d.getUTCDay() + 1;
      case 4:
        return bcd(d.getUTCDate());
      case 5:
        return bcd(d.getUTCMonth() + 1) | (d.getUTCFullYear() >= 2100 ? 0x80 : 0);
      case 6:
        return bcd(d.getUTCFullYear() % 100);
    }
    if (this.ds3231) {
      const t = num(this.props, 'temperature', 25);
      if (register === 0x11) return Math.floor(t) & 0xff;
      if (register === 0x12) return Math.round((t - Math.floor(t)) * 4) << 6;
      if (register === 0x0f) return (this.ram[0x0f] as number) & 0x7f;
    }
    return this.ram[register] as number;
  }

  protected store(register: number, value: number): void {
    if (register > 6) {
      this.ram[register & 63] = value;
      return;
    }
    const d = new Date(this.now());
    const parts = [d.getUTCSeconds(), d.getUTCMinutes(), d.getUTCHours(), d.getUTCDay(), d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear() % 100];
    if (register === 0) {
      this.halted = !this.ds3231 && (value & 0x80) !== 0;
      parts[0] = fromBcd(value & 0x7f);
    } else if (register === 2) {
      // 12-hour writes (bit 6) are kept as 24-hour time.
      parts[2] = value & 0x40 ? (fromBcd(value & 0x1f) % 12) + (value & 0x20 ? 12 : 0) : fromBcd(value & 0x3f);
    } else if (register === 5) parts[5] = fromBcd(value & 0x1f);
    else if (register !== 3) parts[register] = fromBcd(value);
    const [s = 0, m = 0, h = 0, , date = 1, month = 1, year = 0] = parts;
    this.base = Date.UTC(2000 + year, month - 1, date, h, m, s);
    this.since = this.seconds(this.clock);
  }

  view(): View {
    const d = new Date(this.now());
    const two = (n: number) => String(n).padStart(2, '0');
    return { powered: this.powered, time: `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}` };
  }
}

/* ------------------------------------------------------------ HC-SR04 -- */

export const SONAR_TERMINALS = ['VCC', 'TRIG', 'ECHO', 'GND'] as const;

/**
 * An HC-SR04 ultrasonic sensor: a pulse of 10 µs on TRIG sends a burst; ECHO
 * then goes high for the time sound takes there and back (343 m/s), or for
 * 38 ms when nothing is in range (2 cm to 4 m).
 */
export class Ultrasonic extends Module {
  private rose = -1;
  private busy = false;
  private cancel: (() => void)[] = [];
  pings = 0;

  protected attach(): void {
    const echo = this.pin(2);
    if (echo) this.drives.set(echo, false);
    this.watch(1, (mode, at, pin) => {
      if (pinHigh(mode)) {
        if (this.rose < 0) this.rose = at;
        return;
      }
      const rose = this.rose;
      this.rose = -1;
      if (rose < 0 || this.busy || !this.powered || !echo) return;
      if ((at - rose) / pin.bus.hz < 8e-6) return;
      this.ping(echo);
    });
  }

  override unlink(): void {
    for (const c of this.cancel.splice(0)) c();
    this.busy = false;
    super.unlink();
  }

  private ping(echo: BoardPin): void {
    this.busy = true;
    this.pings++;
    const hz = echo.bus.hz;
    const metres = num(this.props, 'distance', 100) / 100;
    const inRange = metres >= 0.02 && metres <= 4;
    const length = inRange ? (2 * metres) / 343 : 0.038;
    // The burst of eight 40 kHz cycles comes first.
    const start = 250e-6 * hz;
    this.cancel = [
      echo.bus.after(start, () => this.drives.set(echo, true)),
      echo.bus.after(start + length * hz, () => {
        this.drives.set(echo, false);
        this.busy = false;
        this.cancel = [];
      }),
    ];
  }

  view(): View {
    return { powered: this.powered, pings: this.pings };
  }
}
