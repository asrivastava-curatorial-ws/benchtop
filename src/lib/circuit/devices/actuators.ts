/**
 * Modules that move or switch: hobby servos (pulse width to angle), the
 * 74HC595 shift register and 4×4 matrix keypads.  The circuit-only modules
 * (stepper driver, rotary encoder, PIR, light and temperature sensors) are
 * solver elements, at the end of this file.
 */
import type { PinMode, SpiTarget, View, Wiring } from '../bus';
import type { Context, Element, Stamp } from '../engine';
import { Module, pinHigh, type Sense } from '../modules';

/* -------------------------------------------------------------- servo -- */

export const SERVO_TERMINALS = ['GND', 'V+', 'SIG'] as const;

/** Pulse widths for 0° and 180° (as the Arduino Servo library uses). */
const SERVO_MIN = 544e-6;
const SERVO_MAX = 2400e-6;
/** How fast the horn turns, degrees a second (an SG90 takes 0.1 s for 60°). */
const SERVO_SPEED = 600;

/** A hobby servo: the length of each pulse on SIG (every 20 ms) sets the angle. */
export class Servo extends Module {
  target = 90;
  private from = 90;
  private since = 0;
  private clock: Wiring['pins'][number] = null;
  /** The signal as the circuit sees it, when no board drives it. */
  sense: Sense | null = null;
  private senseRose = -1;
  private lastT = 0;
  pulse = 0;

  protected attach(): void {
    let rose = -1;
    this.clock = this.watch(2, (mode, at, pin) => {
      if (pinHigh(mode)) {
        if (rose < 0) rose = at;
      } else if (rose >= 0) {
        this.width((at - rose) / pin.bus.hz, at / pin.bus.hz);
        rose = -1;
      }
    });
    if (!this.clock && this.sense) {
      // From the circuit, each pulse is measured at the next rising edge, with the period: a
      // board that reports PWM as a duty (the ESP32's LEDC) is drawn at a faster period, so then
      // the duty is taken for a 50 Hz servo frame.
      let lastRise = -1;
      let high = 0;
      this.sense.onChange = (isHigh, t) => {
        this.lastT = t;
        if (isHigh) {
          if (lastRise >= 0 && high > 0) {
            const period = t - lastRise;
            this.width(period >= 0.01 && period <= 0.03 ? high : (high / period) * 0.02, t);
          }
          lastRise = t;
          this.senseRose = t;
        } else if (this.senseRose >= 0) {
          high = t - this.senseRose;
          this.senseRose = -1;
        }
      };
    }
  }

  private now(): number {
    return this.clock ? this.seconds(this.clock) : this.lastT;
  }

  private width(seconds: number, at: number): void {
    if (!this.powered || seconds < 300e-6 || seconds > 3000e-6) return;
    this.pulse = seconds;
    const angle = Math.max(0, Math.min(180, ((seconds - SERVO_MIN) / (SERVO_MAX - SERVO_MIN)) * 180));
    if (Math.abs(angle - this.target) < 0.05) return;
    this.from = this.angleAt(at);
    this.since = at;
    this.target = angle;
  }

  /** Where the horn is: turning from where it was towards the target at the servo's speed. */
  angleAt(t: number): number {
    const travel = Math.max(0, t - this.since) * SERVO_SPEED;
    const gap = this.target - this.from;
    return Math.abs(gap) <= travel ? this.target : this.from + Math.sign(gap) * travel;
  }

  view(): View {
    return { powered: this.powered, angle: this.angleAt(this.now()), target: this.target, pulse: this.pulse };
  }
}

/* ------------------------------------------------------------ 74HC595 -- */

/** Terminals of the 74HC595 symbol: inputs, outputs Q0–Q7 and Q7′ (serial out), power. */
export const SHIFT_TERMINALS = ['DS', 'SHCP', 'STCP', 'MR', 'OE', 'Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q7S', 'VCC', 'GND'] as const;
const DS = 0;
const SHCP = 1;
const STCP = 2;
const MR = 3;
const OE = 4;
const Q7S = 13;

/**
 * A 74HC595: on each rising SHCP the register shifts (DS in at Q0, Q7 out at
 * Q7′); a rising STCP copies it to the outputs; MR low clears the register;
 * OE high lets the outputs float.  It follows a board's pins (bit by bit or
 * on its SPI bus), or the circuit when a clock or gates drive it.  A 595
 * whose DS is another one's Q7′ moves with that one.
 */
export class ShiftRegister extends Module implements SpiTarget {
  register = 0;
  latched = 0;
  private downstream: ShiftRegister[] = [];
  private chained = false;
  /** The inputs as the circuit sees them (set by the part each build). */
  senses: Sense[] = [];

  protected attach(wiring: Wiring): void {
    this.downstream = [];
    for (const [device, terminal] of wiring.peers[Q7S] ?? []) if (device instanceof ShiftRegister && terminal === DS && device !== this) this.downstream.push(device);
    this.chained = (wiring.peers[DS] ?? []).some(([device, terminal]) => device instanceof ShiftRegister && terminal === Q7S);
    const spi = this.spiBus(DS, SHCP);
    if (spi) this.links.add(spi.attach(null, this));
    const edge = (terminal: number, rising: () => void) => {
      let last: PinMode = 'low';
      const watched = this.watch(terminal, (mode) => {
        const up = !pinHigh(last) && pinHigh(mode);
        last = mode;
        if (up) rising();
      });
      const sense = this.senses[terminal];
      if (!watched && sense)
        sense.onChange = (high) => {
          if (high) rising();
        };
      else if (sense) sense.onChange = null;
    };
    if (!this.chained) edge(SHCP, () => this.shift(this.level(DS) ? 1 : 0));
    else if (this.senses[SHCP]) (this.senses[SHCP] as Sense).onChange = null;
    edge(STCP, () => {
      if (this.powered) this.latched = this.register;
    });
    const mr = this.watch(MR, (mode) => {
      if (!pinHigh(mode)) this.register = 0;
    });
    if (!mr && this.senses[MR])
      (this.senses[MR] as Sense).onChange = (high) => {
        if (!high) this.register = 0;
      };
  }

  /** An input's level: from the board pin, else from the circuit. */
  private level(terminal: number): boolean {
    const at = this.pin(terminal);
    if (at) return pinHigh(at.bus.mode(at.pin));
    return this.senses[terminal]?.high ?? false;
  }

  /** One clock: the bit falling off Q7 goes on to any 595 chained after this one. */
  shift(bit: number): void {
    if (!this.powered) return;
    if (!this.level(MR)) {
      this.register = 0;
      return;
    }
    const out = (this.register >> 7) & 1;
    this.register = ((this.register << 1) | bit) & 0xff;
    for (const next of this.downstream) next.shift(out);
  }

  transfer(value: number): number {
    for (let i = 7; i >= 0; i--) this.shift((value >> i) & 1);
    return 0xff;
  }

  /** Output Q0–Q7 (0–7) or Q7′ (8): high, low, or floating while OE is high. */
  output(index: number): boolean | null {
    if (!this.powered) return null;
    if (index === 8) return ((this.register >> 7) & 1) === 1;
    if (this.level(OE)) return null;
    return ((this.latched >> index) & 1) === 1;
  }

  view(): View {
    return { powered: this.powered, outputs: Array.from({ length: 8 }, (_, i) => (this.output(i) ? 1 : 0)) };
  }
}

/* ------------------------------------------------------------- keypad -- */

export const KEYPAD_TERMINALS = ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'] as const;
export const KEYPAD_KEYS = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'] as const;

/**
 * A 4×4 membrane keypad: a pressed key joins its row and column.  The
 * firmware scans by driving one line low and reading the others, faster
 * than the circuit's time step, so the keypad answers on the board's pins
 * at once; the circuit also sees the closed key.
 */
export class Keypad extends Module {
  readonly pressed = new Set<number>();

  protected attach(): void {
    for (let line = 0; line < 8; line++) this.watch(line, () => this.resolve());
    this.resolve();
  }

  press(key: number): void {
    this.pressed.add(key);
    this.resolve();
  }

  release(key?: number): void {
    if (key === undefined) this.pressed.clear();
    else this.pressed.delete(key);
    this.resolve();
  }

  /** Lines joined through pressed keys share a level: low if any of them is driven low, else high if any is driven high. */
  private resolve(): void {
    const group = Array.from({ length: 8 }, (_, i) => i);
    const find = (i: number): number => {
      let root = i;
      while (group[root] !== root) root = group[root] as number;
      return root;
    };
    for (const key of this.pressed) group[find(Math.floor(key / 4))] = find(4 + (key % 4));
    const levels = new Map<number, boolean | null>();
    for (let line = 0; line < 8; line++) {
      const at = this.pin(line);
      if (!at) continue;
      const mode = at.bus.mode(at.pin);
      const root = find(line);
      const was = levels.get(root) ?? null;
      if (mode === 'low') levels.set(root, false);
      else if (mode === 'high' && was !== false) levels.set(root, true);
      else if (!levels.has(root)) levels.set(root, null);
    }
    for (let line = 0; line < 8; line++) {
      const at = this.pin(line);
      if (!at) continue;
      const root = find(line);
      const joined = group.some((_, other) => other !== line && find(other) === root);
      this.drives.set(at, joined ? (levels.get(root) ?? null) : null);
    }
  }

  view(): View {
    return { powered: true, pressed: [...this.pressed] };
  }

  // A keypad needs no supply.
  override get powered(): boolean {
    return true;
  }
}

/* ------------------------------------------------ circuit-only modules -- */

/**
 * A 28BYJ-48 stepper motor on a ULN2003 driver board: each input high
 * energises a coil (IN1 to IN4 at quarter turns of the electrical cycle);
 * the rotor follows the coils, and 2048 full steps turn the output shaft
 * once.  Terminals: IN1–IN4, +, −.
 */
export class Stepper implements Element {
  nodes = [0, 0, 0, 0, 0, 0];
  /** Electrical angle turned so far, degrees. */
  electrical = 0;
  coils = [false, false, false, false];
  private last: number | null = null;
  steps = 0;
  stamp(s: Stamp): void {
    const ground = this.nodes[5] as number;
    for (let i = 0; i < 4; i++) s.conductance(this.nodes[i] as number, ground, 1 / 10_000);
    // The motor's coils draw from the + terminal while energised.
    const on = this.coils.filter(Boolean).length;
    if (on) s.conductance(this.nodes[4] as number, ground, on / 60);
  }
  end(ctx: Context): void {
    const ground = ctx.v(this.nodes[5] as number);
    const supply = ctx.v(this.nodes[4] as number) - ground;
    this.coils = [0, 1, 2, 3].map((i) => ctx.v(this.nodes[i] as number) - ground > 2);
    if (supply < 3) return;
    let x = 0;
    let y = 0;
    this.coils.forEach((on, i) => {
      if (!on) return;
      x += Math.cos((i * Math.PI) / 2);
      y += Math.sin((i * Math.PI) / 2);
    });
    if (Math.hypot(x, y) < 0.5) return;
    const angle = (Math.atan2(y, x) * 180) / Math.PI;
    if (this.last !== null) {
      const delta = ((angle - this.last + 540) % 360) - 180;
      if (Math.abs(delta) <= 135) {
        this.electrical += delta;
        if (Math.abs(delta) > 1) this.steps += Math.round(delta / 90);
      }
    }
    this.last = angle;
  }
  /** The output shaft's angle, degrees (four full steps make one electrical turn). */
  get shaft(): number {
    return this.electrical / 512;
  }
}

/**
 * A KY-040 rotary encoder: CLK and DT have pull-ups to + on the module and
 * close to ground as the knob turns (CLK first when turning clockwise, a
 * millisecond between changes); SW closes to ground while the knob is
 * pressed.  Terminals: CLK, DT, SW, +, GND.
 */
export class Encoder implements Element {
  nodes = [0, 0, 0, 0, 0];
  /** Contacts closed (low): CLK, DT, SW. */
  private closed = [false, false, false];
  private queue: { at: number; clk: boolean; dt: boolean }[] = [];
  private t = 0;
  position = 0;
  turn(clockwise: boolean): void {
    const start = Math.max(this.t, this.queue.at(-1)?.at ?? 0) + 0.001;
    const order: [boolean, boolean][] = clockwise
      ? [
          [true, false],
          [true, true],
          [false, true],
          [false, false],
        ]
      : [
          [false, true],
          [true, true],
          [true, false],
          [false, false],
        ];
    order.forEach(([clk, dt], i) => {
      this.queue.push({ at: start + i * 0.001, clk, dt });
    });
    this.position += clockwise ? 1 : -1;
  }
  press(down: boolean): void {
    this.closed[2] = down;
  }
  get pressed(): boolean {
    return this.closed[2] === true;
  }
  begin(ctx: Context): void {
    this.t = ctx.t;
    while (this.queue.length && (this.queue[0]?.at ?? 0) <= ctx.t) {
      const next = this.queue.shift() as { clk: boolean; dt: boolean };
      this.closed[0] = next.clk;
      this.closed[1] = next.dt;
    }
  }
  stamp(s: Stamp): void {
    const [clk, dt, sw, plus, ground] = this.nodes as [number, number, number, number, number];
    [clk, dt].forEach((node, i) => {
      s.conductance(node, plus, 1 / 10_000);
      if (this.closed[i]) s.conductance(node, ground, 100);
    });
    if (this.closed[2]) s.conductance(sw, ground, 100);
    else s.conductance(sw, ground, 1e-9);
  }
}

/** A PIR motion sensor (HC-SR501): OUT goes high while there is motion and for the hold time after. Terminals: VCC, OUT, GND. */
export class Pir implements Element {
  nodes = [0, 0, 0];
  motion = false;
  private until = -1;
  private t = 0;
  high = false;
  constructor(public hold: number) {}
  begin(ctx: Context): void {
    this.t = ctx.t;
    if (this.motion) this.until = ctx.t + this.hold;
    const supply = ctx.previous(this.nodes[0] as number) - ctx.previous(this.nodes[2] as number);
    this.high = supply > 4 && (this.motion || ctx.t < this.until);
  }
  stamp(s: Stamp): void {
    const [vcc, out, ground] = this.nodes as [number, number, number];
    s.conductance(vcc, ground, 1 / 50_000);
    const g = 1 / 100;
    s.conductance(out, ground, g);
    // The output is 3.3 V when high.
    if (this.high) s.current(ground, out, g * 3.3);
  }
  get remaining(): number {
    return Math.max(0, this.until - this.t);
  }
}

/** A light-dependent resistor: R = RL10 × (10 lux / light)^γ (RL10 = 50 kΩ, γ = 0.7 for a GL5528-type cell). */
export const ldrResistance = (lux: number, rl10 = 50_000, gamma = 0.7) => rl10 * (10 / Math.max(0.01, lux)) ** gamma;

/** An NTC thermistor: R = R25 × e^(B (1/T − 1/298.15 K)). */
export const ntcResistance = (celsius: number, r25 = 10_000, beta = 3950) => r25 * Math.exp(beta * (1 / (celsius + 273.15) - 1 / 298.15));
