/**
 * Pieces shared by the modules (displays, sensors, motors): the solver
 * elements that give them a supply, drive or read their pins, and a base
 * class for the device side that talks to boards (see bus.ts).
 */
import { type BoardPin, type Device, Drives, Links, type PinMode, type View, type Wiring } from './bus';
import type { Context, Element, Stamp } from './engine';

export type Props = Readonly<Record<string, number | string | boolean>>;

export const num = (props: Props, key: string, fallback: number) => {
  const v = props[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
export const str = (props: Props, key: string, fallback: string) => {
  const v = props[key];
  return typeof v === 'string' ? v : fallback;
};
export const bool = (props: Props, key: string, fallback: boolean) => {
  const v = props[key];
  return typeof v === 'boolean' ? v : fallback;
};

/** A device's I²C address, from its 'address' property ("0x3c" or a number). */
export const address = (props: Props, fallback: number) => {
  const v = props.address;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n > 0 && n < 128 ? n : fallback;
};

/**
 * What a module draws from its supply, as a resistor between its supply
 * terminal and ground; it also measures the supply, so a module that is not
 * wired to power stays dark.
 */
export class Supply implements Element {
  nodes = [0, 0];
  /** The supply across the module; not a number until the circuit has been solved once (then the module counts as powered). */
  volts = Number.NaN;
  constructor(public resistance: number) {}
  stamp(s: Stamp): void {
    s.conductance(this.nodes[0] as number, this.nodes[1] as number, 1 / this.resistance);
  }
  end(ctx: Context): void {
    this.volts = ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number);
  }
}

/**
 * A logic output of a module (a shift register's Q0, a sensor's OUT): driven
 * high to the module's supply or low to its ground through a small
 * resistance, or left floating.  Terminals: output, supply, ground.
 */
export class Output implements Element {
  nodes = [0, 0, 0];
  constructor(
    public level: () => boolean | null,
    public resistance = 50,
  ) {}
  stamp(s: Stamp, ctx: Context): void {
    const [out, supply, ground] = this.nodes as [number, number, number];
    const level = this.level();
    if (level === null) return;
    const g = 1 / this.resistance;
    s.conductance(out, ground, g);
    // Current into the output that holds it at the supply (taken from the last step).
    if (level) s.current(ground, out, g * (ctx.previous(supply) - ctx.previous(ground)));
  }
}

/** A high-impedance input that remembers its level, for modules clocked by the circuit rather than by a board. Terminals: input, supply, ground. */
export class Sense implements Element {
  nodes = [0, 0, 0];
  /** Called on a change of level, with the circuit time. */
  onChange: ((high: boolean, t: number) => void) | null = null;
  constructor(public high = false) {}
  stamp(s: Stamp): void {
    s.conductance(this.nodes[0] as number, this.nodes[2] as number, 1e-9);
  }
  end(ctx: Context): void {
    const [input, supply, ground] = this.nodes as [number, number, number];
    const v = ctx.v(input) - ctx.v(ground);
    const top = Math.max(1, ctx.v(supply) - ctx.v(ground));
    const high = this.high ? v > top * 0.4 : v > top * 0.6;
    if (high !== this.high) {
      this.high = high;
      this.onChange?.(high, ctx.t);
    }
  }
}

/** A resistance set from outside (light, temperature, position). */
export class Variable implements Element {
  nodes = [0, 0];
  constructor(public resistance: number) {}
  stamp(s: Stamp): void {
    s.conductance(this.nodes[0] as number, this.nodes[1] as number, 1 / Math.max(1e-3, this.resistance));
  }
}

/** Whether a board pin the firmware drives reads high (an input counts as low unless pulled up). */
export const pinHigh = (mode: PinMode) => mode === 'high' || mode === 'pullup';

/**
 * The device side of a module: holds its links to boards and the pins it
 * drives, and knows whether its supply is on.
 */
export abstract class Module implements Device {
  protected readonly links = new Links();
  protected readonly drives = new Drives(this);
  protected wiring: Wiring | null = null;
  /** The supply element of the current circuit (set each time the circuit is built). */
  supply: Supply | null = null;
  /** Below this supply the module does nothing. */
  protected minimumSupply = 2.5;
  constructor(protected props: Props) {}

  get powered(): boolean {
    const v = this.supply?.volts ?? Number.NaN;
    return Number.isNaN(v) || v >= this.minimumSupply;
  }

  link(wiring: Wiring): void {
    this.wiring = wiring;
    this.attach(wiring);
  }

  unlink(): void {
    this.links.release();
    this.drives.release();
    this.wiring = null;
  }

  configure(props: Props): void {
    this.props = props;
  }

  /** The board pin a terminal is wired to. */
  protected pin(terminal: number): BoardPin | null {
    return this.wiring?.pins[terminal] ?? null;
  }

  /** Watches a terminal's board pin; does nothing when it is not wired to a board. */
  protected watch(terminal: number, fn: (mode: PinMode, at: number, at2: BoardPin) => void): BoardPin | null {
    const at = this.pin(terminal);
    if (at) this.links.add(at.bus.watch(at.pin, (mode, cycle) => fn(mode, cycle, at)));
    return at;
  }

  /** The level the firmware gives a terminal's pin now (false when it is not wired to a board). */
  protected high(terminal: number): boolean {
    const at = this.pin(terminal);
    return at ? pinHigh(at.bus.mode(at.pin)) : false;
  }

  /** Seconds of firmware time on the board a terminal is wired to (0 when none). */
  protected seconds(at: BoardPin | null): number {
    return at ? at.bus.now() / at.bus.hz : 0;
  }

  /** Joined to a board's I²C bus: both terminals on that board's SDA and SCL pins. */
  protected i2cBus(sda: number, scl: number) {
    const a = this.pin(sda);
    const b = this.pin(scl);
    if (!a || !b || a.bus !== b.bus) return null;
    if (a.bus.i2cAt) return a.bus.i2cAt(a.pin, b.pin);
    if (!a.bus.i2c) return null;
    return a.pin === a.bus.i2c.sda && b.pin === a.bus.i2c.scl ? a.bus.i2c : null;
  }

  /** Joined to a board's SPI bus: data in on its MOSI pin and the clock on its SCK pin. */
  protected spiBus(mosi: number, sck: number) {
    const a = this.pin(mosi);
    const b = this.pin(sck);
    if (!a || !b || a.bus !== b.bus) return null;
    if (a.bus.spiAt) return a.bus.spiAt(a.pin, b.pin);
    if (!a.bus.spi) return null;
    return a.pin === a.bus.spi.mosi && b.pin === a.bus.spi.sck ? a.bus.spi : null;
  }

  /** Whether a terminal is wired straight to ground. */
  protected grounded(terminal: number): boolean {
    return this.wiring?.nodes[terminal] === 0;
  }

  /** Devices on the same connection as a terminal, with their terminal there. */
  protected peers(terminal: number): readonly (readonly [Device, number])[] {
    return this.wiring?.peers[terminal] ?? [];
  }

  protected abstract attach(wiring: Wiring): void;
  abstract view(): View;
}

/**
 * An I²C device that is a file of registers: the first byte written after
 * the address selects a register, later bytes write it and the ones after,
 * and reads come from the selected register onwards.
 */
export abstract class Registers extends Module {
  protected pointer = 0;
  private fresh = false;

  start(read: boolean): boolean {
    if (!this.powered) return false;
    if (!read) this.fresh = true;
    return true;
  }
  write(value: number): boolean {
    if (this.fresh) {
      this.pointer = value;
      this.fresh = false;
      return true;
    }
    this.store(this.pointer, value);
    this.pointer = this.next(this.pointer);
    return true;
  }
  read(): number {
    const value = this.load(this.pointer);
    this.pointer = this.next(this.pointer);
    return value & 0xff;
  }
  stop(): void {
    this.fresh = false;
  }
  protected next(register: number): number {
    return (register + 1) & 0xff;
  }
  protected abstract load(register: number): number;
  protected abstract store(register: number, value: number): void;
}

/** Turns the edges a board makes on a pin into pulses: calls back with the length of each high pulse, in seconds. */
export function pulses(onPulse: (seconds: number, endedAt: number) => void, hz: () => number) {
  let rose = -1;
  return (mode: PinMode, at: number) => {
    if (pinHigh(mode)) {
      if (rose < 0) rose = at;
    } else if (rose >= 0) {
      onPulse((at - rose) / hz(), at);
      rose = -1;
    }
  };
}
