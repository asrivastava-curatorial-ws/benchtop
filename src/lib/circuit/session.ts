/**
 * A running circuit: the solver, the boards' firmware and the oscilloscope,
 * advanced frame by frame against the clock.  Kept apart from the editor so
 * tests can run circuits without a page.
 */
import { AvrMcu, isAvrChip } from './avr';
import { AVR_EXAMPLES } from './avr-examples';
import { BOARD_SPECS, BoardElement, type Mcu } from './boards';
import type { BoardPin, Device } from './bus';
import { Probe } from './elements';
import type { EspMcu } from './esp32';
import { ESP32_DEMO } from './esp32-demo';
import { type Built, build, type CircuitDoc, type DeviceStore, type FirmwareRef } from './netlist';
import type { Props } from './parts';
import { PICO_EXAMPLES } from './pico-examples';
import { PicoMcu } from './rp2040';

/** Pico firmware opened from files in this session, by name (too large to keep in the circuit). */
export const picoImages = new Map<string, Uint8Array>();

function base64Bytes(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export const TRACE_COUNT = 4;
const SCOPE_POINTS = 1200;

/** A probe's recent readings, oldest first, in a ring. */
export class Trace {
  readonly t = new Float64Array(SCOPE_POINTS * 2);
  readonly v = new Float32Array(SCOPE_POINTS * 2);
  head = 0;
  count = 0;
  active = false;
  push(t: number, v: number): void {
    this.t[this.head] = t;
    this.v[this.head] = v;
    this.head = (this.head + 1) % this.t.length;
    this.count = Math.min(this.count + 1, this.t.length);
  }
  clear(): void {
    this.head = 0;
    this.count = 0;
  }
  /** Readings at or after `from`, oldest first. */
  since(from: number): { t: number[]; v: number[] } {
    const t: number[] = [];
    const v: number[] = [];
    const n = this.t.length;
    for (let i = 0; i < this.count; i++) {
      const k = (this.head - this.count + i + n) % n;
      const time = this.t[k] as number;
      if (time >= from) {
        t.push(time);
        v.push(this.v[k] as number);
      }
    }
    return { t, v };
  }
}

export class Scope {
  /** Seconds across the screen. */
  window = 0.02;
  readonly traces: Trace[] = Array.from({ length: TRACE_COUNT }, () => new Trace());
  private next = 0;
  sample(t: number, readings: readonly (number | null)[]): void {
    if (t < this.next) return;
    this.next = t + this.window / SCOPE_POINTS;
    readings.forEach((v, i) => {
      const trace = this.traces[i];
      if (!trace) return;
      trace.active = v !== null;
      if (v !== null) trace.push(t, v);
    });
  }
  reset(): void {
    this.next = 0;
    for (const trace of this.traces) trace.clear();
  }
}

/** Starts an ESP32 board's firmware in the emulator (provided by the desktop app). */
export type EspLauncher = (partId: string, firmware: FirmwareRef) => Promise<EspMcu>;

export interface SessionOptions {
  readonly launchEsp?: EspLauncher;
  readonly onSerial?: (partId: string, text: string) => void;
  /** Called when a board's program cannot start, with the reason. */
  readonly onBoardProblem?: (partId: string, message: string) => void;
}

/** The program a board starts with when none is chosen. */
export const DEFAULT_FIRMWARE: Readonly<Record<string, FirmwareRef>> = {
  'arduino-uno': { kind: 'example', id: 'blink' },
  'arduino-nano': { kind: 'example', id: 'blink' },
  'arduino-mega': { kind: 'example', id: 'mega-blink' },
  attiny85: { kind: 'example', id: 'tiny-blink' },
  'pi-pico': { kind: 'example', id: 'pico-blink' },
  esp32: { kind: 'esp32-demo' },
};

/** The examples built for a board's chip. */
export const examplesFor = (type: string): readonly { readonly id: string; readonly sketch: string }[] => {
  const chip = BOARD_SPECS.get(type)?.chip;
  if (chip === 'rp2040') return PICO_EXAMPLES;
  return AVR_EXAMPLES.filter((e) => e.chip === chip);
};

export function firmwareFor(doc: CircuitDoc, partId: string, type: string): FirmwareRef | null {
  return doc.firmware?.[partId] ?? DEFAULT_FIRMWARE[type] ?? null;
}

/** A short key: the same key means the same program, so a running board keeps going across edits. */
export function firmwareKey(ref: FirmwareRef | null): string {
  if (!ref) return '';
  switch (ref.kind) {
    case 'example':
      return `example:${ref.id}`;
    case 'hex':
      return `hex:${ref.name}:${ref.hex.length}:${ref.hex.slice(-64)}`;
    case 'esp32-demo':
      return 'esp32-demo';
    case 'esp32-image':
      return `esp32-image:${ref.name}`;
    case 'pico-image':
      return `pico-image:${ref.name}`;
  }
}

export function firmwareName(ref: FirmwareRef | null): string {
  if (!ref) return 'No program';
  switch (ref.kind) {
    case 'example':
      return `Example: ${ref.id}`;
    case 'hex':
      return ref.name;
    case 'esp32-demo':
      return ESP32_DEMO.name;
    case 'esp32-image':
    case 'pico-image':
      return ref.name;
  }
}

function boardOf(built: Built, partId: string): BoardElement | null {
  const element = built.runtimes.get(partId)?.elements[0];
  return element instanceof BoardElement ? element : null;
}

interface Running {
  readonly key: string;
  readonly mcu: Mcu;
}

export class Session {
  built: Built;
  doc: CircuitDoc;
  readonly scope = new Scope();
  /** Simulated seconds per real second achieved lately. */
  ratio = 1;
  /** Why the solver stopped, if it did. */
  failure = '';
  private readonly boards = new Map<string, Running>();
  private readonly starting = new Map<string, string>();
  /** Modules' devices, kept while the circuit is edited. */
  private readonly devices: DeviceStore = new Map();
  private carry = 0;
  private disposed = false;

  constructor(
    doc: CircuitDoc,
    private readonly options: SessionOptions = {},
  ) {
    this.doc = doc;
    this.built = build(doc, this.devices);
    this.startBoards();
    this.linkDevices();
  }

  get time(): number {
    return this.built.circuit.t;
  }

  /** True when a board runs on its own clock (the ESP32), so the circuit must keep real time. */
  get realTime(): boolean {
    for (const { mcu } of this.boards.values()) if (mcu.kind === 'esp32') return true;
    return this.doc.parts.some((p) => p.type === 'esp32');
  }

  /** Boards whose firmware is still loading. */
  get loading(): number {
    return this.starting.size;
  }

  mcu(partId: string): Mcu | null {
    return this.boards.get(partId)?.mcu ?? null;
  }

  /** Applies an edited circuit, keeping voltages and running boards where the layout allows. */
  update(doc: CircuitDoc): void {
    const old = this.built;
    this.doc = doc;
    this.built = build(doc, this.devices);
    const circuit = this.built.circuit;
    circuit.t = old.circuit.t;
    if (circuit.x.length === old.circuit.x.length && circuit.nodeCount === old.circuit.nodeCount) circuit.x.set(old.circuit.x);
    this.startBoards();
    this.linkDevices();
  }

  /**
   * Joins each module to the board pins and other modules its terminals
   * touch.  Called after every rebuild and whenever a board starts or stops.
   */
  private linkDevices(): void {
    const built = this.built;
    const pinAt = new Map<number, BoardPin>();
    for (const part of this.doc.parts) {
      const spec = BOARD_SPECS.get(part.type);
      const bus = this.boards.get(part.id)?.mcu.bus;
      if (!spec || !bus) continue;
      const nodes = built.connectivity.partNodes.get(part.id) ?? [];
      spec.pins.forEach((_, pin) => {
        const node = nodes[spec.power.length + pin] ?? -1;
        if (node > 0 && !pinAt.has(node)) pinAt.set(node, { bus, pin });
      });
    }
    const devices: { device: Device; nodes: readonly number[] }[] = [];
    const at = new Map<number, [Device, number][]>();
    for (const part of this.doc.parts) {
      const device = built.runtimes.get(part.id)?.device;
      if (!device) continue;
      const nodes = built.connectivity.partNodes.get(part.id) ?? [];
      devices.push({ device, nodes });
      nodes.forEach((node, terminal) => {
        if (node <= 0) return;
        const list = at.get(node) ?? [];
        list.push([device, terminal]);
        at.set(node, list);
      });
    }
    for (const { device } of devices) device.unlink();
    for (const { device, nodes } of devices)
      device.link({
        nodes,
        pins: nodes.map((node) => (node > 0 ? (pinAt.get(node) ?? null) : null)),
        peers: nodes.map((node) => (node > 0 ? (at.get(node) ?? []).filter(([other]) => other !== device) : [])),
      });
  }

  private startBoards(): void {
    const present = new Set<string>();
    for (const part of this.doc.parts) {
      if (!BOARD_SPECS.has(part.type)) continue;
      present.add(part.id);
      const ref = firmwareFor(this.doc, part.id, part.type);
      const key = firmwareKey(ref);
      const running = this.boards.get(part.id);
      const board = boardOf(this.built, part.id);
      if (running && running.key === key) {
        if (board) board.driver = running.mcu;
        continue;
      }
      if (running) {
        running.mcu.stop();
        this.boards.delete(part.id);
      }
      if (!ref || this.starting.get(part.id) === key) continue;
      this.starting.set(part.id, key);
      void this.launch(part.id, part.type, ref)
        .then((mcu) => {
          if (this.disposed || this.starting.get(part.id) !== key) {
            mcu.stop();
            return;
          }
          this.starting.delete(part.id);
          mcu.onSerial = (text) => this.options.onSerial?.(part.id, text);
          this.boards.set(part.id, { key, mcu });
          const current = boardOf(this.built, part.id);
          if (current) current.driver = mcu;
          this.linkDevices();
        })
        .catch((error: unknown) => {
          if (this.starting.get(part.id) === key) this.starting.delete(part.id);
          this.options.onBoardProblem?.(part.id, error instanceof Error ? error.message : String(error));
        });
    }
    for (const [id, running] of this.boards) {
      if (!present.has(id)) {
        running.mcu.stop();
        this.boards.delete(id);
      }
    }
    for (const id of this.starting.keys()) if (!present.has(id)) this.starting.delete(id);
  }

  private async launch(partId: string, type: string, ref: FirmwareRef): Promise<Mcu> {
    const spec = BOARD_SPECS.get(type);
    if (spec?.chip === 'rp2040') {
      let image: Uint8Array | undefined;
      if (ref.kind === 'example') {
        const example = PICO_EXAMPLES.find((e) => e.id === ref.id);
        image = example ? base64Bytes(example.image) : undefined;
      } else if (ref.kind === 'pico-image') {
        image = picoImages.get(ref.name);
        if (!image) throw new Error(`Open ${ref.name} on the board (select it, then Open .uf2…): firmware files are not kept in the circuit.`);
      }
      if (!image) throw new Error('This program is not for the Raspberry Pi Pico.');
      const mcu = await PicoMcu.load(image, spec);
      if (ref.kind === 'pico-image' && ref.python) mcu.autorun(ref.python);
      return mcu;
    }
    if (spec && isAvrChip(spec.chip)) {
      let hex: string | undefined;
      if (ref.kind === 'example') hex = AVR_EXAMPLES.find((e) => e.id === ref.id && e.chip === spec.chip)?.hex;
      else if (ref.kind === 'hex') hex = ref.hex;
      if (!hex) throw new Error(`This program is not for the ${spec.name}.`);
      return AvrMcu.fromHex(hex, spec);
    }
    if (ref.kind !== 'esp32-demo' && ref.kind !== 'esp32-image') throw new Error('This program is not for the ESP32.');
    if (!this.options.launchEsp) throw new Error('ESP32 boards run in the desktop app.');
    return this.options.launchEsp(partId, ref);
  }

  /**
   * Runs the circuit for `wallSeconds` of real time at `speed`, giving up
   * after `budgetMs` of computing; returns the simulated seconds covered.
   */
  advance(wallSeconds: number, speed: number, budgetMs = 14): number {
    if (this.failure) return 0;
    const circuit = this.built.circuit;
    const effective = this.realTime ? 1 : speed;
    const wanted = Math.min(wallSeconds, 0.1) * effective;
    this.carry += wanted / circuit.dt;
    const steps = Math.floor(this.carry);
    this.carry -= steps;
    const started = performance.now();
    const probes = this.probes();
    const readings: (number | null)[] = Array.from({ length: probes.length }, () => null);
    const mcus = [...this.boards.values()].map((b) => b.mcu);
    let done = 0;
    for (; done < steps; done++) {
      for (const mcu of mcus) mcu.runUntil(circuit.t + circuit.dt);
      const result = circuit.step();
      if (!result.ok) {
        this.failure = circuit.trouble;
        break;
      }
      for (let i = 0; i < probes.length; i++) {
        const p = probes[i];
        readings[i] = p ? p.reading : null;
      }
      this.scope.sample(circuit.t, readings);
      if ((done & 31) === 31 && performance.now() - started > budgetMs) {
        done++;
        break;
      }
    }
    if (done < steps) this.carry = 0;
    for (const mcu of mcus) mcu.flush?.();
    const covered = done * circuit.dt;
    if (wallSeconds > 0) this.ratio = this.ratio * 0.8 + (covered / Math.min(wallSeconds, 0.1)) * 0.2;
    return covered;
  }

  /** The probe element for each scope trace (null where no probe has that trace). */
  private probes(): (Probe | null)[] {
    const result: (Probe | null)[] = Array.from({ length: 4 }, () => null);
    for (const part of this.doc.parts) {
      if (part.type !== 'probe') continue;
      const index = Number(part.props.trace ?? '1') - 1;
      const element = this.built.runtimes.get(part.id)?.elements[0];
      if (element instanceof Probe && index >= 0 && index < result.length && !result[index]) result[index] = element;
    }
    return result;
  }

  interact(partId: string, action: 'toggle' | 'press' | 'release', at?: readonly [number, number]): void {
    this.built.runtimes.get(partId)?.interact?.(action, at);
  }

  adjust(partId: string, value: number): void {
    this.built.runtimes.get(partId)?.adjust?.(value);
  }

  /** Live properties of a part changed (sensor readings): applied without rebuilding. */
  setLive(partId: string, props: Props): void {
    this.built.runtimes.get(partId)?.live?.(props);
  }

  /** I²C addresses where two devices on one board would answer together. */
  clashes(): { partId: string; address: number }[] {
    const list: { partId: string; address: number }[] = [];
    for (const [partId, { mcu }] of this.boards) if (mcu instanceof AvrMcu) for (const address of mcu.i2cClashes()) list.push({ partId, address });
    return list;
  }

  serialSend(partId: string, text: string): void {
    this.boards.get(partId)?.mcu.serialSend(text);
  }

  /** Board problems: halted firmware. */
  halted(): { partId: string; reason: string }[] {
    const list: { partId: string; reason: string }[] = [];
    for (const [partId, { mcu }] of this.boards) if (mcu.halted && mcu.halted !== 'stopped') list.push({ partId, reason: mcu.halted });
    return list;
  }

  dispose(): void {
    this.disposed = true;
    for (const { mcu } of this.boards.values()) mcu.stop();
    this.boards.clear();
    this.starting.clear();
    for (const { device } of this.devices.values()) device.unlink();
    this.devices.clear();
  }
}
