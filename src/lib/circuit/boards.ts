/**
 * Microcontroller boards in the circuit: the Arduino Uno (ATmega328P,
 * emulated with avr8js) and the ESP32 DevKit (run by an emulator helper in
 * the desktop app).  A board element drives the circuit from the pins the
 * firmware sets as outputs and feeds input levels and analog voltages back.
 */
import type { Context, Element, Stamp } from './engine';
import { parseIntelHex } from './firmware-files';

export type PinMode = 'low' | 'high' | 'input' | 'pullup' | 'pulldown' | 'pwm';

export interface PinSpec {
  readonly name: string;
  /** For the Uno: port letter and bit.  For the ESP32: GPIO number. */
  readonly port?: 'B' | 'C' | 'D';
  readonly bit?: number;
  readonly gpio?: number;
  /** ADC channel when the pin can read voltages. */
  readonly adc?: number;
}

export interface BoardSpec {
  readonly kind: 'uno' | 'esp32';
  readonly logicHigh: number;
  /** Output resistance of a pin, ohms. */
  readonly outputResistance: number;
  readonly pullUp: number;
  /** Pins driven by firmware, in terminal order after GND, the high rail and the low rail. */
  readonly pins: readonly PinSpec[];
  /** Names of the power terminals: ground, the main supply, the second supply. */
  readonly power: readonly [string, string, string];
  readonly supplies: readonly [number, number];
}

const UNO_PINS: PinSpec[] = [
  ...Array.from({ length: 8 }, (_, i) => ({ name: `D${i}`, port: 'D' as const, bit: i })),
  ...Array.from({ length: 6 }, (_, i) => ({ name: `D${i + 8}`, port: 'B' as const, bit: i })),
  ...Array.from({ length: 6 }, (_, i) => ({ name: `A${i}`, port: 'C' as const, bit: i, adc: i })),
];

export const UNO: BoardSpec = { kind: 'uno', logicHigh: 5, outputResistance: 25, pullUp: 35_000, pins: UNO_PINS, power: ['GND', '5V', '3.3V'], supplies: [5, 3.3] };

/** ESP32 DevKit pins that are safe to use as GPIO (ADC1 channels where available). */
const ESP32_GPIO: [number, number?][] = [[2], [4], [5], [12], [13], [14], [15], [16], [17], [18], [19], [21], [22], [23], [25], [26], [27], [32, 4], [33, 5], [34, 6], [35, 7], [36, 0], [39, 3]];

export const ESP32: BoardSpec = {
  kind: 'esp32',
  logicHigh: 3.3,
  outputResistance: 40,
  pullUp: 45_000,
  pins: ESP32_GPIO.map(([gpio, adc]) => ({ name: `GPIO${gpio}`, gpio, ...(adc !== undefined ? { adc } : {}) })),
  power: ['GND', '5V', '3V3'],
  supplies: [5, 3.3],
};

/** What a board element asks of the running firmware. */
export interface PinDriver {
  mode(pin: number): PinMode;
  /** For pins in 'pwm' mode: the fraction of the time the pin is high. */
  duty?(pin: number): number;
  setInput(pin: number, high: boolean): void;
  setAnalog(pin: number, volts: number): void;
}

/** Steps in one period of the PWM the circuit draws for 'pwm' pins (hardware PWM the emulator reports as a duty). */
const PWM_STEPS = 20;

/**
 * The board in the circuit.  Terminals: GND, high supply, low supply, then
 * the pins in BoardSpec order.
 */
export class BoardElement implements Element {
  nodes: number[];
  readonly sources = 2;
  sourceBase?: number;
  /** Pin voltages from the last step, for display. */
  readonly volts: Float64Array;
  private readonly levels: boolean[];
  constructor(
    public spec: BoardSpec,
    public driver: PinDriver | null,
  ) {
    this.nodes = Array.from({ length: 3 + spec.pins.length }, () => 0);
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
    const [gnd, hi, lo] = this.nodes as [number, number, number];
    s.source(this, 0, hi, gnd, this.spec.supplies[0]);
    s.source(this, 1, lo, gnd, this.spec.supplies[1]);
    if (!this.driver) return;
    const g = 1 / this.spec.outputResistance;
    for (let i = 0; i < this.spec.pins.length; i++) {
      const node = this.nodes[3 + i] as number;
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
      const node = this.nodes[3 + i] as number;
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

/* ------------------------------------------------------------ Arduino Uno -- */

type Avr = typeof import('avr8js');

export interface Mcu extends PinDriver {
  readonly kind: 'uno' | 'esp32';
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
}

/** The ATmega328P of an Arduino Uno at 16 MHz. */
export class UnoMcu implements Mcu {
  static readonly FREQUENCY = 16e6;
  private readonly cpu: InstanceType<Avr['CPU']>;
  private readonly ports: Record<'B' | 'C' | 'D', InstanceType<Avr['AVRIOPort']>>;
  private readonly usart: InstanceType<Avr['AVRUSART']>;
  private readonly adc: InstanceType<Avr['AVRADC']>;
  private readonly avr: Avr;
  private readonly pending: number[] = [];
  private textBuffer = '';
  onSerial: ((text: string) => void) | null = null;
  halted = '';
  readonly kind = 'uno';

  private constructor(avr: Avr, program: Uint16Array) {
    this.avr = avr;
    const cpu = new avr.CPU(program);
    this.cpu = cpu;
    new avr.AVRTimer(cpu, avr.timer0Config);
    new avr.AVRTimer(cpu, avr.timer1Config);
    new avr.AVRTimer(cpu, avr.timer2Config);
    this.ports = { B: new avr.AVRIOPort(cpu, avr.portBConfig), C: new avr.AVRIOPort(cpu, avr.portCConfig), D: new avr.AVRIOPort(cpu, avr.portDConfig) };
    this.usart = new avr.AVRUSART(cpu, avr.usart0Config, UnoMcu.FREQUENCY);
    this.usart.onByteTransmit = (value: number) => {
      this.textBuffer += String.fromCharCode(value);
    };
    this.adc = new avr.AVRADC(cpu, avr.adcConfig);
    new avr.AVRClock(cpu, UnoMcu.FREQUENCY, avr.clockConfig);
    new avr.AVREEPROM(cpu, new avr.EEPROMMemoryBackend(1024));
  }

  /** Loads Intel HEX for the ATmega328P (32 KB of flash). */
  static async fromHex(hex: string): Promise<UnoMcu> {
    const avr = await import('avr8js');
    const bytes = parseIntelHex(hex, 0x8000);
    return new UnoMcu(avr, new Uint16Array(bytes.buffer));
  }

  get seconds(): number {
    return this.cpu.cycles / UnoMcu.FREQUENCY;
  }

  runUntil(seconds: number): void {
    const target = seconds * UnoMcu.FREQUENCY;
    const { avrInstruction } = this.avr;
    const cpu = this.cpu;
    if (this.pending.length && !this.usart.rxBusy) this.usart.writeByte(this.pending.shift() as number);
    while (cpu.cycles < target) {
      avrInstruction(cpu);
      cpu.tick();
    }
    if (this.textBuffer && this.onSerial) {
      this.onSerial(this.textBuffer);
      this.textBuffer = '';
    }
  }

  private pin(index: number): { port: InstanceType<Avr['AVRIOPort']>; bit: number } | null {
    const spec = UNO.pins[index];
    if (!spec?.port || spec.bit === undefined) return null;
    return { port: this.ports[spec.port], bit: spec.bit };
  }

  mode(index: number): PinMode {
    const p = this.pin(index);
    if (!p) return 'input';
    const state = p.port.pinState(p.bit);
    const { PinState } = this.avr;
    return state === PinState.High ? 'high' : state === PinState.Low ? 'low' : state === PinState.InputPullUp ? 'pullup' : 'input';
  }

  setInput(index: number, high: boolean): void {
    const p = this.pin(index);
    p?.port.setPin(p.bit, high);
  }

  setAnalog(index: number, volts: number): void {
    const channel = UNO.pins[index]?.adc;
    if (channel !== undefined) this.adc.channelValues[channel] = volts;
  }

  serialSend(text: string): void {
    for (const ch of new TextEncoder().encode(text)) this.pending.push(ch);
  }

  stop(): void {
    this.halted = 'stopped';
  }
}
