/**
 * A serial port as a simple link: bytes in, bytes out.  The desktop app uses
 * the operating system's ports (serial.rs); a Chromium browser uses Web Serial.
 * The Serial Monitor has its own, older copy of this; newer tools share this one.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isDesktop } from './index';

export interface PortInfo {
  readonly name: string;
  readonly kind: string;
  readonly detail: string;
}

export interface SerialOptions {
  /** The port's name on the desktop; ignored in a browser, which asks the user. */
  readonly port: string;
  readonly baud: number;
  readonly dataBits?: number;
  readonly parity?: 'none' | 'even' | 'odd';
  readonly stopBits?: number;
}

export interface SerialLink {
  readonly write: (bytes: Uint8Array) => Promise<void>;
  readonly close: () => Promise<void>;
}

interface WebSerialPort {
  open(options: { baudRate: number; dataBits: number; parity: string; stopBits: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

const webSerial = (): { requestPort(): Promise<WebSerialPort> } | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator as unknown as { serial?: { requestPort(): Promise<WebSerialPort> } }).serial;

/** `desktop`, `web` (the browser asks which port), or `none`. */
export const serialSupport = (): 'desktop' | 'web' | 'none' => (isDesktop ? 'desktop' : webSerial() ? 'web' : 'none');

export const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 500000, 921600, 1000000, 2000000];

export async function serialPorts(): Promise<PortInfo[]> {
  return isDesktop ? invoke<PortInfo[]>('serial_ports') : [];
}

export async function openSerialLink(options: SerialOptions, handlers: { onData: (bytes: Uint8Array) => void; onClosed: (reason: string) => void }): Promise<SerialLink> {
  const dataBits = options.dataBits ?? 8;
  const parity = options.parity ?? 'none';
  const stopBits = options.stopBits ?? 1;
  if (isDesktop) {
    const port = options.port;
    if (!port) throw new Error('Choose a port first.');
    let open = true;
    const offData = await listen<{ port: string; bytes: number[] }>('serial-data', (event) => {
      if (open && event.payload.port === port) handlers.onData(Uint8Array.from(event.payload.bytes));
    });
    const offClosed = await listen<{ port: string; error: string }>('serial-closed', (event) => {
      if (!open || event.payload.port !== port) return;
      open = false;
      offData();
      offClosed();
      handlers.onClosed(event.payload.error || 'The port was closed.');
    });
    try {
      await invoke('serial_open', { request: { port, baud: options.baud, dataBits, parity, stopBits, flow: 'none' } });
    } catch (error) {
      offData();
      offClosed();
      throw error;
    }
    return {
      write: (bytes) => invoke('serial_write', { port, bytes: [...bytes] }),
      close: async () => {
        if (!open) return;
        open = false;
        offData();
        offClosed();
        await invoke('serial_close', { port });
      },
    };
  }
  const serial = webSerial();
  if (!serial) throw new Error('Serial ports need the Benchtop desktop app, or a Chromium browser (Chrome, Edge).');
  const port = await serial.requestPort();
  await port.open({ baudRate: options.baud, dataBits, parity, stopBits });
  let open = true;
  const reader = port.readable?.getReader();
  void (async () => {
    try {
      while (open && reader) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) handlers.onData(value);
      }
    } catch (error) {
      if (open) handlers.onClosed(error instanceof Error ? error.message : String(error));
    }
  })();
  return {
    write: async (bytes) => {
      const writer = port.writable?.getWriter();
      if (!writer) throw new Error('The port cannot be written to.');
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
    },
    close: async () => {
      if (!open) return;
      open = false;
      await reader?.cancel().catch(() => undefined);
      await port.close().catch(() => undefined);
    },
  };
}

/** Cuts a stream of bytes into text lines (any of LF, CR LF, CR). */
export class LineSplitter {
  private partial = '';
  private readonly decoder = new TextDecoder();

  feed(bytes: Uint8Array): string[] {
    this.partial += this.decoder.decode(bytes, { stream: true });
    const lines = this.partial.split(/\r\n|\n|\r/);
    this.partial = lines.pop() ?? '';
    // A device that never ends its lines must not fill the memory.
    if (this.partial.length > 65536) this.partial = '';
    return lines;
  }
}
