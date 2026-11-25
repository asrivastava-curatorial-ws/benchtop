/**
 * Microcontroller boards in the circuit: the Arduino Uno, Nano and Mega and
 * the ATtiny85 (emulated here with avr8js, see avr.ts), the Raspberry Pi
 * Pico (rp2040js, see rp2040.ts) and the ESP32 DevKit (run by an emulator
 * helper in the desktop app).  A board element drives the
 * circuit from the pins the firmware sets as outputs and feeds input levels
 * and analog voltages back.
 */

import type { PinBus, PinMode } from './bus';
import type { Context, Element, Stamp } from './engine';

export type { PinMode } from './bus';

export interface PinSpec {
  readonly name: string;
  /** For AVR boards: port letter and bit.  For the ESP32: GPIO number. */
  readonly port?: string;
  readonly bit?: number;
  readonly gpio?: number;
  /** ADC channel when the pin can read voltages. */
  readonly adc?: number;
}

export type BoardKind = 'uno' | 'nano' | 'mega' | 'attiny85' | 'pico' | 'esp32';

export interface BoardSpec {
  readonly kind: BoardKind;
  readonly name: string;
  readonly chip: 'atmega328p' | 'atmega2560' | 'attiny85' | 'rp2040' | 'esp32';
  readonly logicHigh: number;
  /** Output resistance of a pin, ohms. */
  readonly outputResistance: number;
  readonly pullUp: number;
  /** Pins driven by firmware, in terminal order after the power terminals.  For Arduino boards a pin's index is its Arduino pin number. */
  readonly pins: readonly PinSpec[];
  /** Names of the power terminals: ground first, then the supplies the board puts out. */
  readonly power: readonly string[];
  /** The supplies' voltages, in the order of their terminals. */
  readonly supplies: readonly number[];
  /** Pins of the I²C and SPI controllers and of the serial port. */
  readonly i2c?: { readonly sda: number; readonly scl: number };
  readonly spi?: { readonly mosi: number; readonly miso: number; readonly sck: number; readonly ss: number };
  readonly serial?: { readonly rx: number; readonly tx: number };
  /** A serial output the firmware makes by software (boards without a serial port), read at this speed. */
  readonly softSerial?: { readonly tx: number; readonly baud: number };
  /** The pin of the LED on the board. */
  readonly led?: number;
}

const portPins = (port: string, bits: readonly number[], first: number, prefix = 'D') => bits.map((bit, i) => ({ name: `${prefix}${first + i}`, port, bit }));

const UNO_PINS: PinSpec[] = [
  ...portPins('D', [0, 1, 2, 3, 4, 5, 6, 7], 0),
  ...portPins('B', [0, 1, 2, 3, 4, 5], 8),
  ...Array.from({ length: 6 }, (_, i) => ({ name: `A${i}`, port: 'C', bit: i, adc: i })),
];

const ARDUINO = { logicHigh: 5, outputResistance: 25, pullUp: 35_000, power: ['GND', '5V', '3.3V'], supplies: [5, 3.3] } as const;

export const UNO: BoardSpec = {
  ...ARDUINO,
  kind: 'uno',
  name: 'Arduino Uno',
  chip: 'atmega328p',
  pins: UNO_PINS,
  i2c: { sda: 18, scl: 19 },
  spi: { mosi: 11, miso: 12, sck: 13, ss: 10 },
  serial: { rx: 0, tx: 1 },
  led: 13,
};

/** The Nano: the Uno's chip, with two more pins (A6 and A7) that can only read voltages. */
export const NANO: BoardSpec = {
  ...UNO,
  kind: 'nano',
  name: 'Arduino Nano',
  pins: [...UNO_PINS, { name: 'A6', adc: 6 }, { name: 'A7', adc: 7 }],
};

/** Arduino Mega 2560 pins 0 to 69 (A0 to A15 are 54 to 69): port and bit of each. */
const MEGA_DIGITAL: readonly (readonly [string, number])[] = [
  ['E', 0],
  ['E', 1],
  ['E', 4],
  ['E', 5],
  ['G', 5],
  ['E', 3],
  ['H', 3],
  ['H', 4],
  ['H', 5],
  ['H', 6],
  ['B', 4],
  ['B', 5],
  ['B', 6],
  ['B', 7],
  ['J', 1],
  ['J', 0],
  ['H', 1],
  ['H', 0],
  ['D', 3],
  ['D', 2],
  ['D', 1],
  ['D', 0],
  ['A', 0],
  ['A', 1],
  ['A', 2],
  ['A', 3],
  ['A', 4],
  ['A', 5],
  ['A', 6],
  ['A', 7],
  ['C', 7],
  ['C', 6],
  ['C', 5],
  ['C', 4],
  ['C', 3],
  ['C', 2],
  ['C', 1],
  ['C', 0],
  ['D', 7],
  ['G', 2],
  ['G', 1],
  ['G', 0],
  ['L', 7],
  ['L', 6],
  ['L', 5],
  ['L', 4],
  ['L', 3],
  ['L', 2],
  ['L', 1],
  ['L', 0],
  ['B', 3],
  ['B', 2],
  ['B', 1],
  ['B', 0],
];

export const MEGA: BoardSpec = {
  ...ARDUINO,
  kind: 'mega',
  name: 'Arduino Mega 2560',
  chip: 'atmega2560',
  pins: [...MEGA_DIGITAL.map(([port, bit], i) => ({ name: `D${i}`, port, bit })), ...Array.from({ length: 16 }, (_, i) => ({ name: `A${i}`, port: i < 8 ? 'F' : 'K', bit: i % 8, adc: i }))],
  i2c: { sda: 20, scl: 21 },
  spi: { mosi: 51, miso: 50, sck: 52, ss: 53 },
  serial: { rx: 0, tx: 1 },
  led: 13,
};

/**
 * An ATtiny85 on a small USB board (Digispark style): pins PB0 to PB5 are
 * Arduino pins 0 to 5; PB5 is also the reset pin.  It has no serial port.
 */
export const ATTINY85: BoardSpec = {
  kind: 'attiny85',
  name: 'ATtiny85',
  chip: 'attiny85',
  logicHigh: 5,
  outputResistance: 30,
  pullUp: 35_000,
  pins: [
    { name: 'PB0', port: 'B', bit: 0 },
    { name: 'PB1', port: 'B', bit: 1 },
    { name: 'PB2', port: 'B', bit: 2, adc: 1 },
    { name: 'PB3', port: 'B', bit: 3, adc: 3 },
    { name: 'PB4', port: 'B', bit: 4, adc: 2 },
    { name: 'PB5', port: 'B', bit: 5, adc: 0 },
  ],
  power: ['GND', '5V'],
  supplies: [5],
  softSerial: { tx: 0, baud: 9600 },
  led: 1,
};

/**
 * The Raspberry Pi Pico: GP0 to GP22 and GP26 to GP28 on its edge (GP25 is
 * the LED on the board); A0 to A2 are GP26 to GP28.  Board pin i is GPi up
 * to GP22, then GP26 to GP28.
 */
export const PICO: BoardSpec = {
  kind: 'pico',
  name: 'Raspberry Pi Pico',
  chip: 'rp2040',
  logicHigh: 3.3,
  outputResistance: 40,
  pullUp: 50_000,
  pins: [...Array.from({ length: 23 }, (_, i) => ({ name: `GP${i}`, gpio: i })), ...[26, 27, 28].map((gpio, k) => ({ name: `GP${gpio}`, gpio, adc: k }))],
  power: ['GND', 'VBUS', '3V3'],
  supplies: [5, 3.3],
  serial: { tx: 0, rx: 1 },
};

/** ESP32 DevKit pins that are safe to use as GPIO (ADC1 channels where available). */
const ESP32_GPIO: [number, number?][] = [[2], [4], [5], [12], [13], [14], [15], [16], [17], [18], [19], [21], [22], [23], [25], [26], [27], [32, 4], [33, 5], [34, 6], [35, 7], [36, 0], [39, 3]];

export const ESP32: BoardSpec = {
  kind: 'esp32',
  name: 'ESP32 DevKit',
  chip: 'esp32',
  logicHigh: 3.3,
  outputResistance: 40,
  pullUp: 45_000,
  pins: ESP32_GPIO.map(([gpio, adc]) => ({ name: `GPIO${gpio}`, gpio, ...(adc !== undefined ? { adc } : {}) })),
  power: ['GND', '5V', '3V3'],
  supplies: [5, 3.3],
  led: 0,
};

/** Board specifications by part type. */
export const BOARD_SPECS: ReadonlyMap<string, BoardSpec> = new Map([
  ['arduino-uno', UNO],
  ['arduino-nano', NANO],
  ['arduino-mega', MEGA],
  ['attiny85', ATTINY85],
  ['pi-pico', PICO],
  ['esp32', ESP32],
]);

export const isBoard = (type: string) => BOARD_SPECS.has(type);

/** What a board element asks of the running firmware. */
export interface PinDriver {
  mode(pin: number): PinMode;
  /** For pins in 'pwm' mode: the fraction of the time the pin is high. */
  duty?(pin: number): number;
  setInput(pin: number, high: boolean): void;
  setAnalog(pin: number, volts: number): void;
  /** The LED on the board, where it is not on one of the board's pins (the Pico's GP25). */
  readonly boardLed?: boolean;
}

/** Steps in one period of the PWM the circuit draws for 'pwm' pins (hardware PWM the emulator reports as a duty). */
const PWM_STEPS = 20;

/**
 * The board in the circuit.  Terminals: GND, the supplies, then the pins in
 * BoardSpec order.
 */
export class BoardElement implements Element {
  nodes: number[];
  readonly sources: number;
  sourceBase?: number;
  /** Pin voltages from the last step, for display. */
  readonly volts: Float64Array;
  private readonly levels: boolean[];
  /** Index of the first pin among the terminals. */
  private readonly base: number;
  constructor(
    public spec: BoardSpec,
    public driver: PinDriver | null,
  ) {
    this.base = spec.power.length;
    this.sources = spec.supplies.length;
    this.nodes = Array.from({ length: this.base + spec.pins.length }, () => 0);
    this.volts = new Float64Array(spec.pins.length);
    this.levels = spec.pins.map(() => false);
  }
  /** Whether a pin drives high at this step (PWM pins follow their duty over PWM_STEPS steps). */
  private drivesHigh(pin: number, mode: PinMode, ctx: Context): boolean {
    if (mode !== 'pwm') return mode === 'high';
    const duty = this.driver?.duty?.(pin) ?? 0;
    const step = Math.round(ctx.t / ctx.dt);
    return step % PWM_STEPS < duty * PWM_STEPS;
  }
  stamp(s: Stamp, ctx: Context): void {
    const gnd = this.nodes[0] as number;
    this.spec.supplies.forEach((volts, k) => {
      s.source(this, k, this.nodes[1 + k] as number, gnd, volts);
    });
    if (!this.driver) return;
    const g = 1 / this.spec.outputResistance;
    for (let i = 0; i < this.spec.pins.length; i++) {
      const node = this.nodes[this.base + i] as number;
      if (node < 0) continue;
      const mode = this.driver.mode(i);
      switch (mode) {
        case 'high':
        case 'low':
        case 'pwm':
          s.conductance(node, gnd, g);
          if (this.drivesHigh(i, mode, ctx)) s.current(gnd, node, g * this.spec.logicHigh);
          break;
        case 'pullup':
          s.conductance(node, gnd, 1 / this.spec.pullUp);
          s.current(gnd, node, this.spec.logicHigh / this.spec.pullUp);
          break;
        case 'pulldown':
          s.conductance(node, gnd, 1 / this.spec.pullUp);
          break;
        default:
          break;
      }
    }
  }
  end(ctx: Context): void {
    const ground = ctx.v(this.nodes[0] as number);
    const high = this.spec.logicHigh;
    for (let i = 0; i < this.spec.pins.length; i++) {
      const node = this.nodes[this.base + i] as number;
      let v: number;
      if (node < 0) {
        // Nothing is connected: the pin sits at its own output or pull-up level.
        const mode = this.driver?.mode(i) ?? 'input';
        v = mode === 'pullup' || this.drivesHigh(i, mode, ctx) ? high : 0;
      } else v = ctx.v(node) - ground;
      this.volts[i] = v;
      // Schmitt-trigger inputs: switch at 60 % going up and 40 % going down.
      const level = this.levels[i] ? v > high * 0.4 : v > high * 0.6;
      if (level !== this.levels[i]) {
        this.levels[i] = level;
        this.driver?.setInput(i, level);
      }
      if (this.spec.pins[i]?.adc !== undefined) this.driver?.setAnalog(i, Math.max(0, Math.min(high, v)));
    }
  }
}

/* ------------------------------------------------------------ processors -- */

export interface Mcu extends PinDriver {
  readonly kind: 'avr' | 'rp2040' | 'esp32';
  /** Seconds of firmware time so far. */
  readonly seconds: number;
  /** Runs the firmware up to this circuit time (boards emulated in another process run on their own clock). */
  runUntil(seconds: number): void;
  serialSend(text: string): void;
  onSerial: ((text: string) => void) | null;
  /** Set once the firmware has stopped, with the reason. */
  readonly halted: string;
  /** Sends queued messages to firmware running elsewhere (once per frame). */
  flush?(): void;
  stop(): void;
  /** The processor as the modules wired to it see it (boards emulated in this process). */
  readonly bus?: PinBus;
}
