/**
 * How modules in the circuit (displays, sensors, motors) talk to a board's
 * firmware.  Their protocols are far faster than the circuit solver's time
 * step, so a module is joined to the emulated processor directly: it hears
 * the pins the firmware changes, to the processor cycle, answers on the
 * pins the firmware reads, and sits on the board's I²C and SPI buses.
 */

/** What the firmware does with a pin. */
export type PinMode = 'low' | 'high' | 'input' | 'pullup' | 'pulldown' | 'pwm';

/** A device on an I²C bus, addressed by the controller. */
export interface I2cTarget {
  /** A transfer to this device starts (again, for a repeated start); false refuses it (no acknowledge). */
  start(read: boolean): boolean;
  /** A byte from the controller; false refuses it. */
  write(value: number): boolean;
  /** A byte for the controller; `more` is false for the last one it wants. */
  read(more: boolean): number;
  /** The transfer ends. */
  stop(): void;
}

/** A device on an SPI bus. */
export interface SpiTarget {
  /** One byte each way: the controller's byte in, the device's reply out. */
  transfer(value: number): number;
}

/** A board's processor, as the devices wired to it see it. */
export interface PinBus {
  /** Processor cycles per second: the times below are counted in cycles. */
  readonly hz: number;
  now(): number;
  /** What the firmware does with a pin at this moment. */
  mode(pin: number): PinMode;
  /** Calls `fn` whenever the firmware changes what it does with the pin, with the cycle it happened at. */
  watch(pin: number, fn: (mode: PinMode, at: number) => void): () => void;
  /**
   * A device drives a pin the firmware reads: true high, false low, null lets go.
   * Any device holding it low wins, then any holding it high, then the circuit.
   */
  set(pin: number, owner: object, level: boolean | null): void;
  /** Runs `fn` after so many processor cycles; returns a function that cancels it. */
  after(cycles: number, fn: () => void): () => void;
  /** The board's I²C controller and its pins (SDA, SCL), where it has one. */
  readonly i2c: { readonly sda: number; readonly scl: number; attach(address: number, target: I2cTarget): () => void } | null;
  /** The board's SPI controller and its pins, where it has one.  A device with no chip select (cs null) hears every byte. */
  readonly spi: { readonly mosi: number; readonly miso: number; readonly sck: number; attach(cs: number | null, target: SpiTarget): () => void } | null;
  /** Boards whose controllers can use several pins (the Pico): the I²C controller these SDA and SCL pins belong to. */
  i2cAt?(sda: number, scl: number): PinBus['i2c'];
  /** Likewise the SPI controller for these MOSI and SCK pins. */
  spiAt?(mosi: number, sck: number): PinBus['spi'];
}

/** A pin of a board that a device's terminal is wired to. */
export interface BoardPin {
  readonly bus: PinBus;
  readonly pin: number;
}

/** What each terminal of a device touches. */
export interface Wiring {
  /** Per terminal: its node in the circuit (0 is ground, −1 not connected). */
  readonly nodes: readonly number[];
  /** Per terminal: the board pin on the same connection, or null. */
  readonly pins: readonly (BoardPin | null)[];
  /** Per terminal: other devices' terminals on the same connection, as [device, terminal index]. */
  readonly peers: readonly (readonly (readonly [Device, number])[])[];
}

export type ViewValue = number | boolean | string | readonly number[] | Screen;
export type View = Readonly<Record<string, ViewValue>>;

/** A picture a display shows: drawn by the editor, kept here as plain pixels. */
export interface Screen {
  readonly width: number;
  readonly height: number;
  /** Changes whenever the picture does. */
  readonly version: number;
  /** RGBA, row by row. */
  readonly rgba: Uint8ClampedArray;
}

export function isScreen(v: unknown): v is Screen {
  return typeof v === 'object' && v !== null && 'rgba' in v && 'version' in v;
}

/**
 * A module joined to the boards.  The same device lives on while the circuit
 * is edited (a display keeps its picture), and is linked again whenever the
 * wiring or the running boards change.
 */
export interface Device {
  link(wiring: Wiring): void;
  /** Lets go of every board (before linking again, or when the part is removed). */
  unlink(): void;
  /** The part's properties changed. */
  configure(props: Readonly<Record<string, number | string | boolean>>): void;
  /** What the editor draws and lists. */
  view(): View;
}

/**
 * Bookkeeping for a device's links: everything attached is let go of
 * together.  Devices hold one of these and call `release()` in unlink.
 */
export class Links {
  private readonly undo: (() => void)[] = [];
  add(off: () => void): void {
    this.undo.push(off);
  }
  release(): void {
    for (const off of this.undo.splice(0)) off();
  }
}

/** Pins a device drives, let go of together on release. */
export class Drives {
  private readonly held: BoardPin[] = [];
  constructor(private readonly owner: object) {}
  set(at: BoardPin | null, level: boolean | null): void {
    if (!at) return;
    const i = this.held.findIndex((h) => h.bus === at.bus && h.pin === at.pin);
    if (level === null) {
      if (i >= 0) this.held.splice(i, 1);
    } else if (i < 0) this.held.push(at);
    at.bus.set(at.pin, this.owner, level);
  }
  release(): void {
    for (const at of this.held.splice(0)) at.bus.set(at.pin, this.owner, null);
  }
}

/** Whether a pin the firmware drives is high (an input reads as its pull-up). */
export const isHigh = (mode: PinMode) => mode === 'high' || mode === 'pullup';
