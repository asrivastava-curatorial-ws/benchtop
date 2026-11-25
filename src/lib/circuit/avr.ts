/**
 * AVR microcontrollers emulated with avr8js: the ATmega328P of the Arduino
 * Uno and Nano, the ATmega2560 of the Arduino Mega and the ATtiny85.  The
 * processor runs the firmware instruction by instruction; its pins meet the
 * circuit through the board element, and modules wired to it (displays,
 * sensors, motors) hear and answer it through the PinBus interface, on its
 * pins and its I²C and SPI buses, to the processor cycle.
 */
import type { ADCMuxConfiguration, AVRADC, AVRIOPort, AVRPortConfig, AVRSPI, AVRTimerConfig, AVRTWI, AVRUSART, CPU } from 'avr8js';
import { type Capture, CaptureBuilder } from '../logic';
import { type BoardSpec, type Mcu, UNO } from './boards';
import type { I2cTarget, PinBus, PinMode, SpiTarget } from './bus';
import { parseIntelHex } from './firmware-files';

type Avr = typeof import('avr8js');

export type AvrChip = 'atmega328p' | 'atmega2560' | 'attiny85';

/** Flash size of each chip, bytes. */
export const FLASH_SIZE: Readonly<Record<AvrChip, number>> = { atmega328p: 0x8000, atmega2560: 0x40000, attiny85: 0x2000 };

export const isAvrChip = (chip: string): chip is AvrChip => chip in FLASH_SIZE;

interface Chip {
  readonly cpu: CPU;
  /** Ports by letter, with the address of each one's PIN register. */
  readonly ports: ReadonlyMap<string, { readonly port: AVRIOPort; readonly pin: number }>;
  readonly usart: AVRUSART | null;
  readonly adc: AVRADC;
  readonly twi: AVRTWI | null;
  readonly spi: AVRSPI | null;
  readonly hz: number;
}

function atmega328p(avr: Avr, program: Uint16Array): Chip {
  const hz = 16e6;
  const cpu = new avr.CPU(program);
  new avr.AVRTimer(cpu, avr.timer0Config);
  new avr.AVRTimer(cpu, avr.timer1Config);
  new avr.AVRTimer(cpu, avr.timer2Config);
  const ports = new Map(
    [
      ['B', avr.portBConfig],
      ['C', avr.portCConfig],
      ['D', avr.portDConfig],
    ].map(([name, config]) => [name as string, { port: new avr.AVRIOPort(cpu, config as AVRPortConfig), pin: (config as AVRPortConfig).PIN }] as const),
  );
  const usart = new avr.AVRUSART(cpu, avr.usart0Config, hz);
  const adc = new avr.AVRADC(cpu, avr.adcConfig);
  const twi = new avr.AVRTWI(cpu, avr.twiConfig, hz);
  const spi = new avr.AVRSPI(cpu, avr.spiConfig, hz);
  new avr.AVRClock(cpu, hz, avr.clockConfig);
  new avr.AVREEPROM(cpu, new avr.EEPROMMemoryBackend(1024));
  return { cpu, ports, usart, adc, twi, spi, hz };
}

/** A port with no interrupts: PIN, DDR and PORT are consecutive registers. */
const plainPort = (pin: number): AVRPortConfig => ({ PIN: pin, DDR: pin + 1, PORT: pin + 2, externalInterrupts: [] });

function atmega2560(avr: Avr, program: Uint16Array): Chip {
  const hz = 16e6;
  // 8 KB of SRAM from 0x200: 0x2100 bytes above the 0x100 of registers.
  const cpu = new avr.CPU(program, 0x2100);
  const PORT = { B: 0x25, D: 0x2b, E: 0x2e, G: 0x34, H: 0x102, L: 0x10b };
  const sixteen = { TOV: 1, OCFA: 2, OCFB: 4, OCFC: 8, TOIE: 1, OCIEA: 2, OCIEB: 4, OCIEC: 8 };
  /** A 16-bit timer: registers from `base`, vectors from `vector` (capture, A, B, C, overflow), compare outputs on one port. */
  const timer16 = (base: number, timsk: number, tifr: number, vector: number, port: number, pins: readonly [number, number, number], clockPort: number, clockPin: number): AVRTimerConfig => ({
    ...avr.timer1Config,
    ...sixteen,
    TCCRA: base,
    TCCRB: base + 1,
    TCCRC: base + 2,
    TCNT: base + 4,
    ICR: base + 6,
    OCRA: base + 8,
    OCRB: base + 10,
    OCRC: base + 12,
    TIMSK: timsk,
    TIFR: tifr,
    captureInterrupt: vector,
    compAInterrupt: vector + 2,
    compBInterrupt: vector + 4,
    compCInterrupt: vector + 6,
    ovfInterrupt: vector + 8,
    compPortA: port,
    compPinA: pins[0],
    compPortB: port,
    compPinB: pins[1],
    compPortC: port,
    compPinC: pins[2],
    externalClockPort: clockPort,
    externalClockPin: clockPin,
  });
  new avr.AVRTimer(cpu, {
    ...avr.timer0Config,
    compAInterrupt: 0x2a,
    compBInterrupt: 0x2c,
    ovfInterrupt: 0x2e,
    compPortA: PORT.B,
    compPinA: 7,
    compPortB: PORT.G,
    compPinB: 5,
    externalClockPort: PORT.D,
    externalClockPin: 7,
  });
  new avr.AVRTimer(cpu, timer16(0x80, 0x6f, 0x36, 0x20, PORT.B, [5, 6, 7], PORT.D, 6));
  new avr.AVRTimer(cpu, { ...avr.timer2Config, compAInterrupt: 0x1a, compBInterrupt: 0x1c, ovfInterrupt: 0x1e, compPortA: PORT.B, compPinA: 4, compPortB: PORT.H, compPinB: 6 });
  new avr.AVRTimer(cpu, timer16(0x90, 0x71, 0x38, 0x3e, PORT.E, [3, 4, 5], PORT.E, 6));
  new avr.AVRTimer(cpu, timer16(0xa0, 0x72, 0x39, 0x52, PORT.H, [3, 4, 5], PORT.H, 7));
  new avr.AVRTimer(cpu, timer16(0x120, 0x73, 0x3a, 0x5c, PORT.L, [3, 4, 5], PORT.L, 2));
  const ext = (index: number, eicr: number, iscOffset: number, vector: number) => ({ EICR: eicr, EIMSK: 0x3d, EIFR: 0x3c, index, iscOffset, interrupt: vector });
  const pinChange = (PCIE: number, PCMSK: number, vector: number, mask: number, offset: number) => ({ PCIE, PCICR: 0x68, PCIFR: 0x3b, PCMSK, pinChangeInterrupt: vector, mask, offset });
  const configs: [string, AVRPortConfig][] = [
    ['A', plainPort(0x20)],
    ['B', { ...plainPort(0x23), pinChange: pinChange(0, 0x6b, 0x12, 0xff, 0) }],
    ['C', plainPort(0x26)],
    ['D', { ...plainPort(0x29), externalInterrupts: [ext(0, 0x69, 0, 0x02), ext(1, 0x69, 2, 0x04), ext(2, 0x69, 4, 0x06), ext(3, 0x69, 6, 0x08)] }],
    [
      'E',
      {
        ...plainPort(0x2c),
        pinChange: pinChange(1, 0x6c, 0x14, 0x01, 0),
        externalInterrupts: [null, null, null, null, ext(4, 0x6a, 0, 0x0a), ext(5, 0x6a, 2, 0x0c), ext(6, 0x6a, 4, 0x0e), ext(7, 0x6a, 6, 0x10)],
      },
    ],
    ['F', plainPort(0x2f)],
    ['G', plainPort(0x32)],
    ['H', plainPort(0x100)],
    ['J', { ...plainPort(0x103), pinChange: pinChange(1, 0x6c, 0x14, 0x7f, 1) }],
    ['K', { ...plainPort(0x106), pinChange: pinChange(2, 0x6d, 0x16, 0xff, 0) }],
    ['L', plainPort(0x109)],
  ];
  const ports = new Map(configs.map(([name, config]) => [name, { port: new avr.AVRIOPort(cpu, config), pin: config.PIN }] as const));
  const usartAt = (base: number, vector: number) => ({
    rxCompleteInterrupt: vector,
    dataRegisterEmptyInterrupt: vector + 2,
    txCompleteInterrupt: vector + 4,
    UCSRA: base,
    UCSRB: base + 1,
    UCSRC: base + 2,
    UBRRL: base + 4,
    UBRRH: base + 5,
    UDR: base + 6,
  });
  const usart = new avr.AVRUSART(cpu, usartAt(0xc0, 0x32), hz);
  // Serial1 to Serial3 work, but nothing listens to them.
  new avr.AVRUSART(cpu, usartAt(0xc8, 0x48), hz);
  new avr.AVRUSART(cpu, usartAt(0xd0, 0x66), hz);
  new avr.AVRUSART(cpu, usartAt(0x130, 0x6c), hz);
  const channels: ADCMuxConfiguration = {
    30: { type: avr.ADCMuxInputType.Constant, voltage: 1.1 },
    31: { type: avr.ADCMuxInputType.Constant, voltage: 0 },
  };
  for (let i = 0; i < 8; i++) {
    channels[i] = { type: avr.ADCMuxInputType.SingleEnded, channel: i };
    channels[0x20 + i] = { type: avr.ADCMuxInputType.SingleEnded, channel: 8 + i };
  }
  const { ADCReference } = avr;
  const adc = new avr.AVRADC(cpu, {
    ...avr.adcConfig,
    adcInterrupt: 0x3a,
    numChannels: 16,
    muxInputMask: 0x3f,
    muxChannels: channels,
    adcReferences: [ADCReference.AREF, ADCReference.AVCC, ADCReference.Internal1V1, ADCReference.Internal2V56],
  });
  const twi = new avr.AVRTWI(cpu, { ...avr.twiConfig, twiInterrupt: 0x4e }, hz);
  const spi = new avr.AVRSPI(cpu, { ...avr.spiConfig, spiInterrupt: 0x30 }, hz);
  new avr.AVRClock(cpu, hz, avr.clockConfig);
  new avr.AVREEPROM(cpu, new avr.EEPROMMemoryBackend(4096), { ...avr.eepromConfig, eepromReadyInterrupt: 0x3c });
  return { cpu, ports, usart, adc, twi, spi, hz };
}

function attiny85(avr: Avr, program: Uint16Array): Chip {
  const hz = 8e6;
  // 512 bytes of SRAM from 0x60.
  const cpu = new avr.CPU(program, 0x160);
  // Timer 0 first: timer 1 chains onto the TIFR and TIMSK registers the two share.
  new avr.AVRTimer(cpu, {
    ...avr.timer0Config,
    TOV: 0x02,
    OCFA: 0x10,
    OCFB: 0x08,
    TOIE: 0x02,
    OCIEA: 0x10,
    OCIEB: 0x08,
    compAInterrupt: 0x0a,
    compBInterrupt: 0x0b,
    ovfInterrupt: 0x05,
    TIFR: 0x58,
    TIMSK: 0x59,
    OCRA: 0x49,
    OCRB: 0x48,
    TCNT: 0x52,
    TCCRA: 0x4a,
    TCCRB: 0x53,
    compPortA: 0x38,
    compPinA: 0,
    compPortB: 0x38,
    compPinB: 1,
    externalClockPort: 0x38,
    externalClockPin: 2,
  });
  new avr.ATtinyTimer1(cpu, avr.attinyTimer1Config);
  const portB = new avr.AVRIOPort(cpu, {
    ...plainPort(0x36),
    pinChange: { PCIE: 5, PCICR: 0x5b, PCIFR: 0x5a, PCMSK: 0x35, pinChangeInterrupt: 0x02, mask: 0x3f, offset: 0 },
    externalInterrupts: [null, null, { EICR: 0x55, EIMSK: 0x5b, EIFR: 0x5a, index: 6, iscOffset: 0, interrupt: 0x01 }],
  });
  const { ADCMuxInputType: T, ADCReference: R } = avr;
  const adc = new avr.AVRADC(cpu, {
    ADMUX: 0x27,
    ADCSRA: 0x26,
    ADCSRB: 0x23,
    ADCL: 0x24,
    ADCH: 0x25,
    DIDR0: 0x34,
    adcInterrupt: 0x08,
    numChannels: 4,
    muxInputMask: 0x0f,
    muxChannels: {
      0: { type: T.SingleEnded, channel: 0 },
      1: { type: T.SingleEnded, channel: 1 },
      2: { type: T.SingleEnded, channel: 2 },
      3: { type: T.SingleEnded, channel: 3 },
      12: { type: T.Constant, voltage: 1.1 },
      13: { type: T.Constant, voltage: 0 },
      15: { type: T.Temperature },
    },
    adcReferences: [R.AVCC, R.AREF, R.Internal1V1, R.Internal2V56],
  });
  // The universal serial interface, for two- and three-wire firmware (its pins are PB0 and PB2).
  new avr.AVRUSI(cpu, portB, 0x36, 0, 2);
  new avr.AVRClock(cpu, hz, { CLKPR: 0x46 });
  new avr.AVREEPROM(cpu, new avr.EEPROMMemoryBackend(512), { ...avr.eepromConfig, eepromReadyInterrupt: 0x06, EECR: 0x3c, EEDR: 0x3d, EEARL: 0x3e, EEARH: 0x3f });
  return { cpu, ports: new Map([['B', { port: portB, pin: 0x36 }]]), usart: null, adc, twi: null, spi: null, hz };
}

const CHIPS: Readonly<Record<AvrChip, (avr: Avr, program: Uint16Array) => Chip>> = { atmega328p, atmega2560, attiny85 };

interface Recording {
  readonly start: number;
  readonly until: number;
  readonly builder: CaptureBuilder;
  readonly done: (capture: Capture) => void;
  /** PIN registers of the recorded pins' ports, and where each recorded pin is. */
  readonly registers: readonly number[];
  readonly bits: readonly (readonly [register: number, bit: number])[];
  /** Which recorded line is the serial TX pin (−1 for none). */
  readonly tx: number;
  key: number;
  last: number;
  changes: number;
}

/** An AVR board's processor: runs the firmware, drives the board's pins and serves the modules wired to it. */
export class AvrMcu implements Mcu, PinBus {
  /** The Uno's clock (16 MHz). */
  static readonly FREQUENCY = 16e6;
  readonly kind = 'avr';
  readonly hz: number;
  onSerial: ((text: string) => void) | null = null;
  halted = '';
  readonly i2c: PinBus['i2c'];
  readonly spi: PinBus['spi'];
  private readonly cpu: CPU;
  private readonly chip: Chip;
  private readonly avr: Avr;
  private readonly pending: number[] = [];
  private textBuffer = '';
  /** Per board pin: its port and bit (null for pins that are only analog inputs). */
  private readonly where: ({ readonly port: AVRIOPort; readonly name: string; readonly bit: number; readonly register: number } | null)[];
  /** Per board pin: the level the circuit gives it, and levels devices hold it at. */
  private readonly fromCircuit: boolean[];
  private readonly held: (Map<object, boolean> | null)[];
  private readonly watchers: (Set<(mode: PinMode, at: number) => void> | null)[];
  private readonly lastMode: PinMode[];
  /** Watched pins on each port. */
  private readonly watched = new Map<string, number[]>();
  private readonly i2cTargets = new Map<number, I2cTarget[]>();
  private readonly spiTargets: { readonly cs: number | null; readonly target: SpiTarget }[] = [];
  private recording: Recording | null = null;

  private constructor(
    avr: Avr,
    readonly spec: BoardSpec,
    program: Uint16Array,
  ) {
    this.avr = avr;
    const chip = CHIPS[spec.chip as AvrChip](avr, program);
    this.chip = chip;
    this.cpu = chip.cpu;
    this.hz = chip.hz;
    this.where = spec.pins.map((p) => {
      const found = p.port ? chip.ports.get(p.port) : undefined;
      return found && p.port && p.bit !== undefined ? { port: found.port, name: p.port, bit: p.bit, register: found.pin } : null;
    });
    this.fromCircuit = spec.pins.map(() => false);
    this.held = spec.pins.map(() => null);
    this.watchers = spec.pins.map(() => null);
    this.lastMode = spec.pins.map(() => 'input');
    for (const [name, { port }] of chip.ports) port.addListener(() => this.portChanged(name));
    if (chip.usart) {
      const usart = chip.usart;
      usart.onByteTransmit = (value: number) => {
        this.textBuffer += String.fromCharCode(value);
        this.recordSerial(value);
      };
    }
    this.i2c = chip.twi && spec.i2c ? this.setUpI2c(chip.twi, spec.i2c) : null;
    this.spi = chip.spi && spec.spi ? this.setUpSpi(chip.spi, spec.spi) : null;
    if (spec.softSerial) this.setUpSoftSerial(spec.softSerial.tx, spec.softSerial.baud);
  }

  /* ----------------------------------------------- serial by software -- */

  /** Frame being received on a software serial pin: when its start bit began, and the line's changes since. */
  private soft: { readonly bit: number; start: number; edges: [number, boolean][]; level: boolean } | null = null;

  /**
   * Reads what the firmware sends by software on a pin (8 data bits, no
   * parity, one stop bit), from the pin's changes; frames whose stop bit is
   * not high (an LED blinking on the pin, say) are dropped.
   */
  private setUpSoftSerial(tx: number, baud: number): void {
    const soft = { bit: this.hz / baud, start: -1, edges: [] as [number, boolean][], level: true };
    this.soft = soft;
    this.watch(tx, (mode, at) => {
      const high = mode === 'high' || mode === 'pullup';
      if (soft.start >= 0 && at >= soft.start + 9.5 * soft.bit) this.finishSoftFrame();
      if (soft.start < 0) {
        if (!high && soft.level) {
          soft.start = at;
          soft.edges = [];
        }
      } else soft.edges.push([at, high]);
      soft.level = high;
    });
  }

  private finishSoftFrame(): void {
    const soft = this.soft;
    if (!soft || soft.start < 0) return;
    const levelAt = (t: number) => {
      let level = false;
      for (const [at, high] of soft.edges) {
        if (at > t) break;
        level = high;
      }
      return level;
    };
    let value = 0;
    for (let i = 0; i < 8; i++) if (levelAt(soft.start + (1.5 + i) * soft.bit)) value |= 1 << i;
    const framed = levelAt(soft.start + 9.5 * soft.bit);
    soft.start = -1;
    soft.edges = [];
    if (framed) this.textBuffer += String.fromCharCode(value);
  }

  /** Loads Intel HEX for the board's chip. */
  static async fromHex(hex: string, spec: BoardSpec = UNO): Promise<AvrMcu> {
    if (!isAvrChip(spec.chip)) throw new Error(`The ${spec.name} is not an AVR board.`);
    const avr = await import('avr8js');
    const bytes = parseIntelHex(hex, FLASH_SIZE[spec.chip]);
    return new AvrMcu(avr, spec, new Uint16Array(bytes.buffer));
  }

  get bus(): PinBus {
    return this;
  }

  get seconds(): number {
    return this.cpu.cycles / this.hz;
  }

  now(): number {
    return this.cpu.cycles;
  }

  /* ---------------------------------------------------------- devices -- */

  private setUpI2c(twi: AVRTWI, pins: { readonly sda: number; readonly scl: number }): PinBus['i2c'] {
    let current: I2cTarget | null = null;
    // Each byte takes nine clock periods of the bus (eight bits and the acknowledge).
    const bit = () => Math.max(1, Math.round(this.hz / twi.sclFrequency));
    const later = (fn: () => void, bits: number) => this.cpu.addClockEvent(fn, bits * bit());
    twi.eventHandler = {
      start: () => later(() => twi.completeStart(), 1),
      stop: () => {
        current?.stop();
        current = null;
        later(() => twi.completeStop(), 1);
      },
      connectToSlave: (address, write) => {
        const target = this.i2cTargets.get(address)?.[0] ?? null;
        if (current && current !== target) current.stop();
        const ack = target ? target.start(!write) : false;
        current = ack ? target : null;
        later(() => twi.completeConnect(ack), 9);
      },
      writeByte: (value) => {
        const ack = current ? current.write(value & 0xff) : false;
        later(() => twi.completeWrite(ack), 9);
      },
      readByte: (more) => {
        const value = current ? current.read(more) & 0xff : 0xff;
        later(() => twi.completeRead(value), 9);
      },
    };
    return {
      sda: pins.sda,
      scl: pins.scl,
      attach: (address, target) => {
        const list = this.i2cTargets.get(address) ?? [];
        list.push(target);
        this.i2cTargets.set(address, list);
        return () => {
          const at = list.indexOf(target);
          if (at >= 0) list.splice(at, 1);
          if (!list.length) this.i2cTargets.delete(address);
        };
      },
    };
  }

  /** I²C addresses more than one device answers at (they would garble each other). */
  i2cClashes(): number[] {
    return [...this.i2cTargets].filter(([, list]) => list.length > 1).map(([address]) => address);
  }

  private setUpSpi(spi: AVRSPI, pins: { readonly mosi: number; readonly miso: number; readonly sck: number }): PinBus['spi'] {
    spi.onByte = (value) => {
      let reply = 0xff;
      for (const { cs, target } of this.spiTargets) {
        if (cs !== null && this.mode(cs) !== 'low') continue;
        reply &= target.transfer(value);
      }
      this.cpu.addClockEvent(() => spi.completeTransfer(reply & 0xff), spi.transferCycles);
    };
    return {
      mosi: pins.mosi,
      miso: pins.miso,
      sck: pins.sck,
      attach: (cs, target) => {
        const entry = { cs, target };
        this.spiTargets.push(entry);
        return () => {
          const at = this.spiTargets.indexOf(entry);
          if (at >= 0) this.spiTargets.splice(at, 1);
        };
      },
    };
  }

  watch(pin: number, fn: (mode: PinMode, at: number) => void): () => void {
    const where = this.where[pin];
    if (!where) return () => undefined;
    let set = this.watchers[pin];
    if (!set) {
      set = new Set();
      this.watchers[pin] = set;
      this.lastMode[pin] = this.mode(pin);
      const list = this.watched.get(where.name) ?? [];
      list.push(pin);
      this.watched.set(where.name, list);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size) return;
      this.watchers[pin] = null;
      const list = this.watched.get(where.name) ?? [];
      const at = list.indexOf(pin);
      if (at >= 0) list.splice(at, 1);
    };
  }

  private portChanged(name: string): void {
    const pins = this.watched.get(name);
    if (!pins?.length) return;
    for (const pin of pins) {
      const mode = this.mode(pin);
      if (mode === this.lastMode[pin]) continue;
      this.lastMode[pin] = mode;
      const at = this.cpu.cycles;
      for (const fn of this.watchers[pin] ?? []) fn(mode, at);
    }
  }

  set(pin: number, owner: object, level: boolean | null): void {
    let map = this.held[pin];
    if (level === null) map?.delete(owner);
    else {
      if (!map) {
        map = new Map();
        this.held[pin] = map;
      }
      map.set(owner, level);
    }
    this.apply(pin);
  }

  /** What the firmware reads: a device holding the pin low wins, then one holding it high, then the circuit. */
  private apply(pin: number): void {
    const where = this.where[pin];
    if (!where) return;
    let level = this.fromCircuit[pin] as boolean;
    const map = this.held[pin];
    if (map?.size) {
      level = true;
      for (const v of map.values()) {
        if (!v) {
          level = false;
          break;
        }
      }
    }
    where.port.setPin(where.bit, level);
  }

  /** The level a device holds the pin at, if any (for drawing the pin's voltage). */
  heldLevel(pin: number): boolean | null {
    const map = this.held[pin];
    if (!map?.size) return null;
    for (const v of map.values()) if (!v) return false;
    return true;
  }

  after(cycles: number, fn: () => void): () => void {
    const callback = () => fn();
    this.cpu.addClockEvent(callback, Math.round(cycles));
    return () => {
      this.cpu.clearClockEvent(callback);
    };
  }

  /* ------------------------------------------------------- the circuit -- */

  mode(index: number): PinMode {
    const p = this.where[index];
    if (!p) return 'input';
    const state = p.port.pinState(p.bit);
    const { PinState } = this.avr;
    return state === PinState.High ? 'high' : state === PinState.Low ? 'low' : state === PinState.InputPullUp ? 'pullup' : 'input';
  }

  setInput(index: number, high: boolean): void {
    this.fromCircuit[index] = high;
    if (!this.held[index]?.size) this.where[index]?.port.setPin(this.where[index].bit, high);
  }

  setAnalog(index: number, volts: number): void {
    const channel = this.spec.pins[index]?.adc;
    if (channel !== undefined) this.chip.adc.channelValues[channel] = volts;
  }

  serialSend(text: string): void {
    for (const ch of new TextEncoder().encode(text)) this.pending.push(ch);
  }

  /* --------------------------------------------------------- recording -- */

  /** The pins a recording covers: digital pins 0 to 13 (all six of an ATtiny85's). */
  recordedPins(): number[] {
    return this.spec.pins
      .map((_, i) => i)
      .filter((i) => this.where[i])
      .slice(0, 14);
  }

  private pinWord(bits: Recording['bits']): number {
    let word = 0;
    for (let i = 0; i < bits.length; i++) {
      const [register, bit] = bits[i] as readonly [number, number];
      word |= (((this.cpu.data[register] as number) >> bit) & 1) << i;
    }
    return word;
  }

  /** The recorded ports' PIN registers as one number, to notice cheaply when anything changed. */
  private portKey(registers: readonly number[]): number {
    let key = 0;
    for (const register of registers) key = key * 256 + (this.cpu.data[register] as number);
    return key;
  }

  /**
   * Records the levels of pins 0 to 13 for some firmware time from now on, to the processor
   * cycle; `done` gets the capture when that time has passed.  What the sketch prints is
   * drawn on the TX pin as the serial port would send it, which the emulator itself does not do.
   */
  record(seconds: number, done: (capture: Capture) => void): void {
    const pins = this.recordedPins();
    const { tx, rx } = this.spec.serial ?? {};
    const names = pins.map((pin) => {
      const name = this.spec.pins[pin]?.name ?? `D${pin}`;
      return pin === rx ? `${name}/RX` : pin === tx ? `${name}/TX` : name;
    });
    const bits = pins.map((pin) => [this.where[pin]?.register ?? 0, this.where[pin]?.bit ?? 0] as const);
    const registers = [...new Set(bits.map(([register]) => register))];
    const txLine = tx === undefined ? -1 : pins.indexOf(tx);
    // The serial line rests high.
    const first = this.pinWord(bits) | (txLine >= 0 ? 1 << txLine : 0);
    const start = this.cpu.cycles;
    this.recording = {
      start,
      until: start + Math.round(seconds * this.hz),
      builder: new CaptureBuilder(
        1 / this.hz,
        names,
        names.map((_, i) => (first >> i) & 1),
      ),
      done,
      registers,
      bits,
      tx: txLine,
      key: this.portKey(registers),
      last: first,
      changes: 0,
    };
  }

  /** A byte the sketch sends, as the levels of the serial line: a start bit, eight bits from the lowest up, a stop bit. */
  private recordSerial(value: number): void {
    const recording = this.recording;
    if (!recording || recording.tx < 0 || !this.chip.usart) return;
    const bit = this.hz / this.chip.usart.baudRate;
    const at = this.cpu.cycles - recording.start;
    const line = recording.tx;
    recording.builder.set(line, 0, at);
    for (let i = 0; i < 8; i++) recording.builder.set(line, (value >> i) & 1, at + (i + 1) * bit);
    recording.builder.set(line, 1, at + 9 * bit);
  }

  /* ------------------------------------------------------------ running -- */

  runUntil(seconds: number): void {
    const target = seconds * this.hz;
    const { avrInstruction } = this.avr;
    const cpu = this.cpu;
    const usart = this.chip.usart;
    if (usart && this.pending.length && !usart.rxBusy) usart.writeByte(this.pending.shift() as number);
    const recording = this.recording;
    if (recording) {
      // While recording, the pins are looked at after every instruction.  The TX pin is left to recordSerial.
      const stop = Math.min(target, recording.until);
      const txMask = recording.tx >= 0 ? 1 << recording.tx : 0;
      while (cpu.cycles < stop) {
        avrInstruction(cpu);
        cpu.tick();
        const key = this.portKey(recording.registers);
        if (key === recording.key) continue;
        recording.key = key;
        const now = (this.pinWord(recording.bits) & ~txMask) | (recording.last & txMask);
        if (now !== recording.last && recording.changes < 2_000_000) {
          const changed = now ^ recording.last;
          for (let i = 0; i < recording.bits.length; i++) if ((changed >> i) & 1) recording.builder.set(i, (now >> i) & 1, cpu.cycles - recording.start);
          recording.last = now;
          recording.changes++;
        }
      }
      if (cpu.cycles >= recording.until) {
        this.recording = null;
        recording.done(recording.builder.build(recording.until - recording.start, this.hz));
      }
    }
    while (cpu.cycles < target) {
      avrInstruction(cpu);
      cpu.tick();
    }
    if (this.soft && this.soft.start >= 0 && cpu.cycles >= this.soft.start + 10 * this.soft.bit) this.finishSoftFrame();
    if (this.textBuffer && this.onSerial) {
      this.onSerial(this.textBuffer);
      this.textBuffer = '';
    }
  }

  stop(): void {
    this.halted = 'stopped';
  }
}

/** The name the Uno's processor had before the other AVR boards came. */
export { AvrMcu as UnoMcu };
