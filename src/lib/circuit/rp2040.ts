/**
 * The Raspberry Pi Pico's RP2040, emulated with rp2040js: core 0 runs the
 * firmware from the boot ROM on, its GPIO pins meet the circuit through the
 * board element, and modules wired to it are served on its two I²C and two
 * SPI controllers (on whichever pins the controllers can use), through the
 * same PinBus interface as the AVR boards.  The serial monitor reads UART0
 * and, for firmware built with the Pico SDK (Arduino-Pico, MicroPython), the
 * USB serial port.
 */
import type { RP2040, USBCDC } from 'rp2040js';
import type { BoardSpec, Mcu } from './boards';
import type { I2cTarget, PinBus, PinMode, SpiTarget } from './bus';
import { BOOTROM_B1 } from './pico-bootrom';

type Rp = typeof import('rp2040js');
type SimulationClock = InstanceType<Rp['Simulator']>['clock'];

/** The clock the firmware's cycles are counted at (the Pico SDK's default clk_sys). */
export const PICO_HZ = 125e6;

const FLASH_START = 0x10000000;
const FLASH_SIZE = 16 * 1024 * 1024;
/** UF2 blocks for the RP2040 carry this family ID. */
const RP2040_FAMILY = 0xe48bff56;

function base64Bytes(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Writes `data` into a growing flash image at `offset` from the start of flash. */
function place(image: { bytes: Uint8Array; length: number }, offset: number, data: Uint8Array): void {
  if (offset < 0 || offset + data.length > FLASH_SIZE) throw new Error('The firmware does not fit the 16 MB of flash an RP2040 can address.');
  const end = offset + data.length;
  if (end > image.bytes.length) {
    const grown = new Uint8Array(Math.min(FLASH_SIZE, Math.max(end, image.bytes.length * 2))).fill(0xff);
    grown.set(image.bytes.subarray(0, image.length));
    image.bytes = grown;
  }
  image.bytes.set(data, offset);
  image.length = Math.max(image.length, end);
}

/**
 * The flash contents (from 0x10000000) of a Pico firmware file: UF2 (what
 * the Arduino IDE, the Pico SDK and MicroPython's downloads give), ELF, or
 * a raw binary image.
 */
export function picoFlashImage(file: Uint8Array): Uint8Array {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const image = { bytes: new Uint8Array(0x10000).fill(0xff), length: 0 };
  if (file.length >= 512 && view.getUint32(0, true) === 0x0a324655 && view.getUint32(4, true) === 0x9e5d5157) {
    let blocks = 0;
    for (let at = 0; at + 512 <= file.length; at += 512) {
      if (view.getUint32(at, true) !== 0x0a324655 || view.getUint32(at + 4, true) !== 0x9e5d5157 || view.getUint32(at + 508, true) !== 0x0ab16f30) continue;
      const flags = view.getUint32(at + 8, true);
      const address = view.getUint32(at + 12, true);
      const size = view.getUint32(at + 16, true);
      const family = view.getUint32(at + 28, true);
      // Skip blocks marked "not main flash" and those for other chips.
      if (flags & 1) continue;
      if (flags & 0x2000 && family !== RP2040_FAMILY) continue;
      if (size > 476 || address < FLASH_START) continue;
      place(image, address - FLASH_START, file.subarray(at + 32, at + 32 + size));
      blocks++;
    }
    if (!blocks) throw new Error('This UF2 file has no blocks for the RP2040 (it may be for another chip, such as the RP2350 of the Pico 2).');
    return image.bytes.slice(0, image.length);
  }
  if (file.length >= 52 && view.getUint32(0, false) === 0x7f454c46) {
    if (file[4] !== 1 || file[5] !== 1) throw new Error('Only 32-bit little-endian ELF files (ARM) can run on the Pico.');
    const phoff = view.getUint32(28, true);
    const phentsize = view.getUint16(42, true);
    const phnum = view.getUint16(44, true);
    let loaded = 0;
    for (let i = 0; i < phnum; i++) {
      const at = phoff + i * phentsize;
      if (view.getUint32(at, true) !== 1) continue; // PT_LOAD
      const offset = view.getUint32(at + 4, true);
      const paddr = view.getUint32(at + 12, true);
      const filesz = view.getUint32(at + 16, true);
      if (!filesz || paddr < FLASH_START || paddr >= FLASH_START + FLASH_SIZE) continue;
      place(image, paddr - FLASH_START, file.subarray(offset, offset + filesz));
      loaded++;
    }
    if (!loaded) throw new Error('This ELF file has nothing to load into flash: is it built for the Raspberry Pi Pico?');
    return image.bytes.slice(0, image.length);
  }
  if (file.length < 256 || file.length > FLASH_SIZE) throw new Error('This does not look like Pico firmware: open a .uf2, .elf or .bin file.');
  return file.slice();
}

const MODES: readonly PinMode[] = ['low', 'high', 'input', 'pullup', 'pulldown', 'input'];

/** Which I²C controller can use a pin, and as which line (−1 for none): SDA on even pins, SCL on odd; I2C0 where pin % 4 < 2. */
const i2cOf = (gpio: number) => (gpio < 0 || gpio > 29 ? -1 : gpio % 4 < 2 ? 0 : 1);
/** The SPI controller (and line) a pin serves: RX, CSn, SCK, TX repeat every four pins, SPI0 on 0–7 and 16–23, SPI1 on 8–15 and 24–29. */
const spiOf = (gpio: number) => (gpio < 0 || gpio > 29 ? -1 : (gpio >> 3) & 1);
const spiLine = (gpio: number) => (['miso', 'cs', 'sck', 'mosi'] as const)[gpio % 4];

interface Held {
  readonly owners: Map<object, boolean>;
}

export class PicoMcu implements Mcu, PinBus {
  readonly kind = 'rp2040';
  readonly hz = PICO_HZ;
  onSerial: ((text: string) => void) | null = null;
  halted = '';
  readonly i2c = null;
  readonly spi = null;
  readonly mcu: RP2040;
  private readonly clock: SimulationClock;
  private readonly cdc: USBCDC;
  private cdcReady = false;
  private text = '';
  private readonly pendingUart: number[] = [];
  /** Board pin index → GPIO number, and back. */
  private readonly gpioOf: readonly number[];
  private readonly pinOf = new Map<number, number>();
  private readonly fromCircuit: boolean[];
  private readonly held: (Held | null)[];
  private readonly watchers: (Set<(mode: PinMode, at: number) => void> | null)[];
  private readonly lastMode: PinMode[];
  private readonly i2cTargets: Map<number, I2cTarget[]>[] = [new Map(), new Map()];
  private readonly spiTargets: { readonly cs: number | null; readonly target: SpiTarget }[][] = [[], []];
  private readonly picoI2c: NonNullable<PinBus['i2c']>[] = [];
  private readonly picoSpi: NonNullable<PinBus['spi']>[] = [];

  private constructor(
    rp: Rp,
    readonly spec: BoardSpec,
    image: Uint8Array,
  ) {
    // The simulator brings the clock; it is driven from runUntil, never from its own loop.
    const simulator = new rp.Simulator();
    const clock = simulator.clock;
    const mcu = simulator.rp2040;
    mcu.logger = new rp.ConsoleLogger(rp.LogLevel.Error);
    const rom = base64Bytes(BOOTROM_B1);
    mcu.loadBootrom(new Uint32Array(rom.buffer, rom.byteOffset, rom.byteLength / 4));
    mcu.flash.set(image.subarray(0, Math.min(image.length, mcu.flash.length)));
    // Like rp2040js's own runner: start at the second stage boot loader in flash (the boot ROM's
    // own flash boot is not emulated in full).  Its return address is 0, so it enters the program
    // through the vector table at 0x10000100; the boot ROM stays for the routines firmware calls.
    mcu.core.PC = FLASH_START;
    this.mcu = mcu;
    this.clock = clock;
    this.gpioOf = spec.pins.map((p) => p.gpio ?? -1);
    this.gpioOf.forEach((gpio, pin) => {
      if (gpio >= 0) this.pinOf.set(gpio, pin);
    });
    this.fromCircuit = spec.pins.map(() => false);
    this.held = spec.pins.map(() => null);
    this.watchers = spec.pins.map(() => null);
    this.lastMode = spec.pins.map(() => 'input');
    mcu.gpio.forEach((pin, gpio) => {
      pin.addListener(() => this.gpioChanged(gpio));
    });
    for (const uart of mcu.uart)
      uart.onByte = (value) => {
        this.text += String.fromCharCode(value);
      };
    const cdc = new rp.USBCDC(mcu.usbCtrl);
    cdc.onDeviceConnected = () => {
      this.cdcReady = true;
      // A fresh line shows MicroPython's prompt.
      cdc.sendSerialByte(13);
      cdc.sendSerialByte(10);
    };
    cdc.onSerialData = (bytes) => {
      this.text += new TextDecoder().decode(bytes);
    };
    this.cdc = cdc;
    for (const k of [0, 1]) {
      this.picoI2c.push(this.setUpI2c(rp, k));
      this.picoSpi.push(this.setUpSpi(k));
    }
  }

  /** Starts a Pico with firmware: a flash image from 0x10000000 (see picoFlashImage). */
  static async load(image: Uint8Array, spec: BoardSpec): Promise<PicoMcu> {
    const rp = await import('rp2040js');
    return new PicoMcu(rp, spec, image);
  }

  get bus(): PinBus {
    return this;
  }

  get seconds(): number {
    return this.clock.nanos / 1e9;
  }

  now(): number {
    return (this.clock.nanos * PICO_HZ) / 1e9;
  }

  after(cycles: number, fn: () => void): () => void {
    const alarm = this.clock.createAlarm(fn);
    alarm.schedule(Math.max(1, (cycles * 1e9) / PICO_HZ));
    return () => alarm.cancel();
  }

  /* ---------------------------------------------------------- devices -- */

  private setUpI2c(rp: Rp, k: number): NonNullable<PinBus['i2c']> {
    const i2c = this.mcu.i2c[k] as RP2040['i2c'][number];
    const targets = this.i2cTargets[k] as Map<number, I2cTarget[]>;
    let current: I2cTarget | null = null;
    // A bit at the bus's clock (400 kHz unless the firmware set it).
    const bit = () => {
      const period = i2c.sclLowPeriod + i2c.sclHighPeriod;
      return period > 0 ? period : PICO_HZ / 400_000;
    };
    i2c.onStart = () => {
      this.after(bit(), () => i2c.completeStart());
    };
    i2c.onConnect = (address, mode) => {
      const target = targets.get(address)?.[0] ?? null;
      if (current && current !== target) current.stop();
      const ack = target ? target.start(mode === rp.I2CMode.Read) : false;
      current = ack ? target : null;
      this.after(9 * bit(), () => i2c.completeConnect(ack));
    };
    i2c.onWriteByte = (value) => {
      const ack = current ? current.write(value & 0xff) : false;
      this.after(9 * bit(), () => i2c.completeWrite(ack));
    };
    i2c.onReadByte = (more) => {
      const value = current ? current.read(more) & 0xff : 0xff;
      this.after(9 * bit(), () => i2c.completeRead(value));
    };
    i2c.onStop = () => {
      current?.stop();
      current = null;
      this.after(bit(), () => i2c.completeStop());
    };
    return {
      sda: -1,
      scl: -1,
      attach: (address, target) => {
        const list = targets.get(address) ?? [];
        list.push(target);
        targets.set(address, list);
        return () => {
          const at = list.indexOf(target);
          if (at >= 0) list.splice(at, 1);
          if (!list.length) targets.delete(address);
        };
      },
    };
  }

  private setUpSpi(k: number): NonNullable<PinBus['spi']> {
    const spi = this.mcu.spi[k] as RP2040['spi'][number];
    const targets = this.spiTargets[k] as { readonly cs: number | null; readonly target: SpiTarget }[];
    spi.onTransmit = (value) => {
      let reply = 0xff;
      for (const { cs, target } of targets) {
        if (cs !== null && this.mode(cs) !== 'low') continue;
        reply &= target.transfer(value & 0xff);
      }
      const hz = spi.clockFrequency || 1e6;
      this.after(Math.max(1, (spi.dataBits * PICO_HZ) / hz), () => spi.completeTransmit(reply & 0xff));
    };
    return {
      mosi: -1,
      miso: -1,
      sck: -1,
      attach: (cs, target) => {
        const entry = { cs, target };
        targets.push(entry);
        return () => {
          const at = targets.indexOf(entry);
          if (at >= 0) targets.splice(at, 1);
        };
      },
    };
  }

  /** The I²C controller whose SDA and SCL these board pins can be. */
  i2cAt(sda: number, scl: number): PinBus['i2c'] {
    const a = this.gpioOf[sda] ?? -1;
    const b = this.gpioOf[scl] ?? -1;
    const k = i2cOf(a);
    if (k < 0 || k !== i2cOf(b) || a % 2 !== 0 || b % 2 !== 1) return null;
    return this.picoI2c[k] ?? null;
  }

  /** The SPI controller whose TX (MOSI) and SCK these board pins can be. */
  spiAt(mosi: number, sck: number): PinBus['spi'] {
    const a = this.gpioOf[mosi] ?? -1;
    const b = this.gpioOf[sck] ?? -1;
    const k = spiOf(a);
    if (k < 0 || k !== spiOf(b) || spiLine(a) !== 'mosi' || spiLine(b) !== 'sck') return null;
    return this.picoSpi[k] ?? null;
  }

  /** I²C addresses more than one device answers at, on either controller. */
  i2cClashes(): number[] {
    return this.i2cTargets.flatMap((map) => [...map].filter(([, list]) => list.length > 1).map(([address]) => address));
  }

  /* ------------------------------------------------------------- pins -- */

  private gpioChanged(gpio: number): void {
    const pin = this.pinOf.get(gpio);
    if (pin === undefined) return;
    const fns = this.watchers[pin];
    if (!fns?.size) return;
    const mode = this.mode(pin);
    if (mode === this.lastMode[pin]) return;
    this.lastMode[pin] = mode;
    const at = this.now();
    for (const fn of fns) fn(mode, at);
  }

  watch(pin: number, fn: (mode: PinMode, at: number) => void): () => void {
    if ((this.gpioOf[pin] ?? -1) < 0) return () => undefined;
    let set = this.watchers[pin];
    if (!set) {
      set = new Set();
      this.watchers[pin] = set;
      this.lastMode[pin] = this.mode(pin);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.watchers[pin] = null;
    };
  }

  set(pin: number, owner: object, level: boolean | null): void {
    let held = this.held[pin];
    if (level === null) held?.owners.delete(owner);
    else {
      if (!held) {
        held = { owners: new Map() };
        this.held[pin] = held;
      }
      held.owners.set(owner, level);
    }
    this.apply(pin);
  }

  /** What the firmware reads: a device holding the pin low wins, then one holding it high, then the circuit. */
  private apply(pin: number): void {
    const gpio = this.gpioOf[pin] ?? -1;
    if (gpio < 0) return;
    let level = this.fromCircuit[pin] as boolean;
    const owners = this.held[pin]?.owners;
    if (owners?.size) {
      level = true;
      for (const v of owners.values())
        if (!v) {
          level = false;
          break;
        }
    }
    this.mcu.gpio[gpio]?.setInputValue(level);
  }

  heldLevel(pin: number): boolean | null {
    const owners = this.held[pin]?.owners;
    if (!owners?.size) return null;
    for (const v of owners.values()) if (!v) return false;
    return true;
  }

  mode(pin: number): PinMode {
    const gpio = this.gpioOf[pin] ?? -1;
    const state = gpio >= 0 ? this.mcu.gpio[gpio]?.value : undefined;
    return state === undefined ? 'input' : (MODES[state] ?? 'input');
  }

  /** Whether the LED on GP25 is lit. */
  get boardLed(): boolean {
    return this.mcu.gpio[25]?.value === 1;
  }

  setInput(pin: number, high: boolean): void {
    this.fromCircuit[pin] = high;
    if (!this.held[pin]?.owners.size) {
      const gpio = this.gpioOf[pin] ?? -1;
      if (gpio >= 0) this.mcu.gpio[gpio]?.setInputValue(high);
    }
  }

  setAnalog(pin: number, volts: number): void {
    const channel = this.spec.pins[pin]?.adc;
    if (channel === undefined) return;
    this.mcu.adc.channelValues[channel] = Math.max(0, Math.min(4095, Math.round((volts / 3.3) * 4095)));
  }

  /** Text for the program: over USB once the firmware has its USB serial port up, else into UART0. */
  serialSend(text: string): void {
    const bytes = new TextEncoder().encode(text);
    if (this.cdcReady) for (const b of bytes) this.cdc.sendSerialByte(b);
    else this.pendingUart.push(...bytes);
  }

  /** Whether the firmware has a USB serial port (MicroPython, Arduino-Pico). */
  get usbSerial(): boolean {
    return this.cdcReady;
  }

  /**
   * Runs a MicroPython program: interrupts what is running, then pastes the
   * code in paste mode and runs it (Ctrl-C, Ctrl-E, the code, Ctrl-D).
   */
  runPython(code: string): void {
    const body = code.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    this.serialSend(`\x03\x03\x05${body.replace(/\n/g, '\r')}\r\x04`);
  }

  /** A MicroPython program to run once the firmware's prompt (>>>) first appears. */
  private autorunCode: string | null = null;
  private heard = '';

  autorun(code: string): void {
    this.autorunCode = code;
  }

  /* ---------------------------------------------------------- running -- */

  runUntil(seconds: number): void {
    const target = seconds * 1e9;
    const { mcu, clock } = this;
    const core = mcu.core;
    const uart = mcu.uart[0];
    if (uart && this.pendingUart.length) for (let i = 0; i < 8 && this.pendingUart.length; i++) uart.feedByte(this.pendingUart.shift() as number);
    const cycleNanos = 1e9 / mcu.clkSys;
    while (clock.nanos < target) {
      if (core.waiting) {
        const next = clock.nanosToNextAlarm;
        clock.tick(next > 0 ? Math.min(next, target - clock.nanos) : target - clock.nanos);
      } else clock.tick(core.executeInstruction() * cycleNanos);
    }
    if (this.autorunCode !== null && this.text) {
      this.heard = (this.heard + this.text).slice(-200);
      if (this.heard.includes('>>> ')) {
        this.runPython(this.autorunCode);
        this.autorunCode = null;
      }
    }
    if (this.text && this.onSerial) {
      this.onSerial(this.text);
      this.text = '';
    }
  }

  stop(): void {
    this.halted = 'stopped';
  }
}
