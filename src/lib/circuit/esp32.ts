/**
 * The ESP32 board's firmware runs in benchtop-esp32 (lcgamboa's QEMU with
 * Benchtop's line protocol, see esp32-helper/) in the desktop app.  EspMcu
 * turns the helper's messages into pin states for the circuit and sends it
 * input levels, ADC readings and serial text.  The helper runs in real time
 * on its own clock, so the circuit around an ESP32 runs at real speed.
 */
import { ESP32, type Mcu, type PinMode } from './boards';

/** How the board reaches the helper (the desktop bridge, or a fake in tests). */
export interface EspTransport {
  send(line: string): void;
  /** Sends what send() queued (called once per frame). */
  flush(): void;
  stop(): void;
}

const PIN_COUNT = ESP32.pins.length;

/** Kinds of ESP32 flash images Benchtop can boot. */
export type EspImageKind = 'merged' | 'app' | 'bootloader' | 'unknown';

/**
 * A merged image (bootloader at 0x1000, partition table at 0x8000, app at
 * 0x10000) boots as it is; Arduino IDE 2 saves one as sketch.ino.merged.bin
 * with Sketch → Export Compiled Binary.  A bare app image (sketch.ino.bin)
 * needs the bootloader and partition table too, so it is refused with advice.
 */
export function espImageKind(bytes: Uint8Array): EspImageKind {
  if (bytes.length > 0x8001 && bytes[0x1000] === 0xe9 && bytes[0x8000] === 0xaa && bytes[0x8001] === 0x50) return 'merged';
  if (bytes.length > 0 && bytes[0] === 0xe9) {
    // A 2nd-stage bootloader loads into IRAM at 0x4008xxxx or 0x4007xxxx; an app maps flash at 0x400Dxxxx / 0x3F4xxxxx.
    const entry = (bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8) | ((bytes[6] ?? 0) << 16) | ((bytes[7] ?? 0) << 24);
    return entry >>> 0 >= 0x40070000 && entry >>> 0 < 0x400a0000 ? 'bootloader' : 'app';
  }
  return 'unknown';
}

export const ESP_IMAGE_ADVICE: Readonly<Record<Exclude<EspImageKind, 'merged'>, string>> = {
  app: 'This is an application image without its bootloader and partition table. In Arduino IDE 2 use Sketch → Export Compiled Binary and choose the file ending in .merged.bin.',
  bootloader: 'This is a bootloader image on its own (it goes at offset 0x1000). Benchtop can boot it, but choose the .merged.bin file to run a whole sketch.',
  unknown: 'This does not look like an ESP32 flash image. Choose the .merged.bin file that Arduino IDE 2 or esptool merge_bin made.',
};

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export class EspMcu implements Mcu {
  readonly kind = 'esp32';
  onSerial: ((text: string) => void) | null = null;
  halted = '';
  /** Set when the helper reports the machine running. */
  ready = false;
  private readonly started = performance.now();
  private readonly output = new Uint8Array(PIN_COUNT);
  private readonly isOutput = new Uint8Array(PIN_COUNT);
  /** LEDC duty per pin, 0–1, or −1 when the pin is not PWM. */
  private readonly duties = new Float64Array(PIN_COUNT).fill(-1);
  private readonly inputs = new Int8Array(PIN_COUNT).fill(-1);
  private readonly analog = new Int16Array(8).fill(-1);
  private readonly analogSent = new Float64Array(8);
  private readonly decoder = new TextDecoder();
  private serialBytes: number[] = [];

  constructor(private readonly transport: EspTransport) {}

  /** Messages from the helper, one line each. */
  receive(lines: readonly string[]): void {
    for (const line of lines) {
      const kind = line[0];
      if (kind === 'U') {
        for (const part of line.slice(2).split(' ')) if (part) this.serialBytes.push(Number.parseInt(part, 16));
        continue;
      }
      if (kind === 'R') {
        this.ready = true;
        continue;
      }
      if (kind === 'X') {
        this.halted = line.slice(2) || 'The ESP32 emulator stopped.';
        continue;
      }
      const [, a, b] = line.split(' ');
      const pin = Number(a);
      const value = Number(b);
      if (!Number.isInteger(pin) || pin < 0 || pin >= PIN_COUNT || !Number.isFinite(value)) continue;
      if (kind === 'P') this.output[pin] = value ? 1 : 0;
      else if (kind === 'D') this.isOutput[pin] = value ? 1 : 0;
      else if (kind === 'W') this.duties[pin] = value < 0 ? -1 : Math.min(1, value / 1000);
    }
    if (this.serialBytes.length) {
      const text = this.decoder.decode(new Uint8Array(this.serialBytes), { stream: true });
      this.serialBytes = [];
      if (text) this.onSerial?.(text);
    }
  }

  get seconds(): number {
    return (performance.now() - this.started) / 1000;
  }

  /** The helper keeps its own time. */
  runUntil(): void {}

  mode(pin: number): PinMode {
    const duty = this.duties[pin] ?? -1;
    if (duty >= 0) return duty <= 0 ? 'low' : duty >= 1 ? 'high' : 'pwm';
    if (!this.isOutput[pin]) return 'input';
    return this.output[pin] ? 'high' : 'low';
  }

  duty(pin: number): number {
    return Math.max(0, this.duties[pin] ?? 0);
  }

  setInput(pin: number, high: boolean): void {
    if (this.isOutput[pin] || (this.duties[pin] ?? -1) >= 0) return;
    const level = high ? 1 : 0;
    if (this.inputs[pin] === level) return;
    this.inputs[pin] = level;
    this.transport.send(`I ${pin} ${level}`);
  }

  setAnalog(pin: number, volts: number): void {
    const channel = ESP32.pins[pin]?.adc;
    if (channel === undefined) return;
    const value = Math.round((Math.max(0, Math.min(3.3, volts)) / 3.3) * 4095);
    const last = this.analog[channel] ?? -1;
    const now = performance.now();
    // Small changes at most every 20 ms; jumps straight away.
    if (last >= 0 && (Math.abs(value - last) < 4 || (Math.abs(value - last) < 64 && now - (this.analogSent[channel] ?? 0) < 20))) return;
    this.analog[channel] = value;
    this.analogSent[channel] = now;
    this.transport.send(`A ${channel} ${value}`);
  }

  serialSend(text: string): void {
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i += 256) this.transport.send(`S ${hex(bytes.subarray(i, i + 256))}`);
  }

  flush(): void {
    this.transport.flush();
  }

  stop(): void {
    if (!this.halted) this.halted = 'stopped';
    this.transport.stop();
  }
}
