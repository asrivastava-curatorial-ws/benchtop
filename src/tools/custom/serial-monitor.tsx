/**
 * Serial Monitor and Serial Plotter: talk to Arduino, ESP32, GPS modules, PLCs
 * and other devices on a serial port, as text or hex, with timestamps and the
 * DTR and RTS lines, or plot the numbers they print (Arduino Serial Plotter
 * format).  The desktop app uses the operating system's serial ports; in a
 * Chromium browser the Web Serial API is used instead.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../../lib/errors';
import { PlotBuffer } from '../../lib/plotter';
import { CHART_COLORS, niceScale } from '../../lib/svg-chart';
import { isDesktop, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

interface PortInfo {
  readonly name: string;
  readonly kind: string;
  readonly detail: string;
}

interface Settings {
  readonly port: string;
  readonly baud: number;
  readonly dataBits: number;
  readonly parity: 'none' | 'even' | 'odd';
  readonly stopBits: number;
  readonly ending: 'none' | 'lf' | 'cr' | 'crlf';
  readonly view: 'text' | 'hex' | 'plot';
  readonly stamps: boolean;
}

const BAUDS = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 500000, 921600, 1000000, 2000000];
const ENDINGS = { none: '', lf: '\n', cr: '\r', crlf: '\r\n' } as const;

const readFor =
  (toolId: string) =>
  (s: Values | undefined): Settings => ({
    port: typeof s?.port === 'string' ? s.port : '',
    baud: typeof s?.baud === 'number' ? s.baud : 115200,
    dataBits: typeof s?.dataBits === 'number' ? s.dataBits : 8,
    parity: (['none', 'even', 'odd'] as const).find((p) => p === s?.parity) ?? 'none',
    stopBits: s?.stopBits === 2 ? 2 : 1,
    ending: (['none', 'lf', 'cr', 'crlf'] as const).find((p) => p === s?.ending) ?? 'lf',
    view: s?.view === 'hex' ? 'hex' : s?.view === 'plot' || (s?.view === undefined && toolId === 'serial-plotter') ? 'plot' : 'text',
    stamps: s?.stamps === true,
  });

interface Chunk {
  readonly at: number;
  readonly bytes: Uint8Array;
  readonly sent: boolean;
}

/** A port reached through the browser's Web Serial API (Chrome, Edge). */
interface WebSerialPort {
  open(options: { baudRate: number; dataBits: number; parity: string; stopBits: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
}

const webSerial = (): { requestPort(): Promise<WebSerialPort> } | undefined => (navigator as unknown as { serial?: { requestPort(): Promise<WebSerialPort> } }).serial;

const MAX_LOG = 2_000_000;

function SerialMonitor({ toolId }: { toolId: string }) {
  const [s, set] = usePersistentState<Settings>(toolId, readFor(toolId), (v) => ({ ...v }));
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<Chunk[]>([]);
  const [input, setInput] = useState('');
  const [hexInput, setHexInput] = useState(false);
  const [dtr, setDtr] = useState(true);
  const [rts, setRts] = useState(true);
  const web = useRef<{ port: WebSerialPort; reader?: ReadableStreamDefaultReader<Uint8Array> } | null>(null);
  const screen = useRef<HTMLPreElement>(null);
  const available = isDesktop || Boolean(webSerial());

  const plot = useRef(new PlotBuffer(2000));
  const [plotVersion, setPlotVersion] = useState(0);
  const plotFrame = useRef(0);

  const add = (bytes: Uint8Array, sent: boolean) => {
    if (!sent && plot.current.feed(bytes) > 0 && !plotFrame.current) {
      // Redraw at most once a frame, however fast the lines arrive.
      plotFrame.current = requestAnimationFrame(() => {
        plotFrame.current = 0;
        setPlotVersion((v) => v + 1);
      });
    }
    addToLog(bytes, sent);
  };

  const addToLog = (bytes: Uint8Array, sent: boolean) =>
    setLog((list) => {
      const next = [...list, { at: Date.now(), bytes, sent }];
      let size = next.reduce((n, c) => n + c.bytes.length, 0);
      while (size > MAX_LOG && next.length > 1) size -= (next.shift() as Chunk).bytes.length;
      return next;
    });

  const refresh = () =>
    attempt(async () => {
      if (!isDesktop) return;
      const list = await invoke<PortInfo[]>('serial_ports');
      setPorts(list);
      if (!s.port && list[0]) set((v) => ({ ...v, port: list[0]?.name ?? '' }));
    });

  useEffect(() => {
    refresh();
    if (!isDesktop) return;
    const offData = listen<{ port: string; bytes: number[] }>('serial-data', (event) => add(Uint8Array.from(event.payload.bytes), false));
    const offClosed = listen<{ port: string; error: string }>('serial-closed', (event) => {
      setOpen(false);
      notify(`The port closed: ${event.payload.error}`, 'error');
    });
    return () => {
      void offData.then((f) => f());
      void offClosed.then((f) => f());
      if (s.port) void invoke('serial_close', { port: s.port }).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const el = screen.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [log]);

  const connect = () =>
    attempt(async () => {
      if (isDesktop) {
        await invoke('serial_open', { request: { port: s.port, baud: s.baud, dataBits: s.dataBits, parity: s.parity, stopBits: s.stopBits, flow: 'none' } });
        setOpen(true);
        return;
      }
      const serial = webSerial();
      if (!serial) return;
      const port = await serial.requestPort();
      await port.open({ baudRate: s.baud, dataBits: s.dataBits, parity: s.parity, stopBits: s.stopBits });
      web.current = { port };
      setOpen(true);
      void (async () => {
        while (port.readable && web.current?.port === port) {
          const reader = port.readable.getReader();
          web.current.reader = reader;
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) add(value, false);
            }
          } catch (error) {
            notify(errorMessage(error), 'error');
          } finally {
            reader.releaseLock();
          }
          if (!web.current) break;
        }
      })();
    });

  const disconnect = () =>
    attempt(async () => {
      if (isDesktop) await invoke('serial_close', { port: s.port });
      else if (web.current) {
        const { port, reader } = web.current;
        web.current = null;
        await reader?.cancel().catch(() => undefined);
        await port.close();
      }
      setOpen(false);
    });

  const send = () =>
    attempt(async () => {
      let bytes: Uint8Array;
      if (hexInput) {
        const clean = input.replace(/0x|[\s,]/gi, '');
        if (!/^([0-9a-f]{2})*$/i.test(clean)) throw new Error('Enter whole hex bytes, such as "AA 01 FF".');
        bytes = Uint8Array.from(clean.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
      } else bytes = new TextEncoder().encode(input + ENDINGS[s.ending]);
      if (isDesktop) await invoke('serial_write', { port: s.port, bytes: [...bytes] });
      else {
        const writer = web.current?.port.writable?.getWriter();
        if (!writer) throw new Error('The port is not open.');
        await writer.write(bytes);
        writer.releaseLock();
      }
      add(bytes, true);
      setInput('');
    });

  const signals = (next: { dtr?: boolean; rts?: boolean }) =>
    attempt(async () => {
      if (next.dtr !== undefined) setDtr(next.dtr);
      if (next.rts !== undefined) setRts(next.rts);
      if (!open) return;
      if (isDesktop) await invoke('serial_signals', { port: s.port, dtr: next.dtr ?? null, rts: next.rts ?? null });
      else await web.current?.port.setSignals({ dataTerminalReady: next.dtr, requestToSend: next.rts });
    });

  const decoder = new TextDecoder();
  const render = () =>
    log
      .map((chunk) => {
        const body = s.view === 'hex' ? `${Array.from(chunk.bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')}\n` : decoder.decode(chunk.bytes, { stream: !chunk.sent });
        const stamp = s.stamps ? `[${new Date(chunk.at).toISOString().slice(11, 23)}] ` : '';
        return chunk.sent ? `${stamp}» ${s.view === 'hex' ? body : `${body.replace(/\r?\n$/, '')}\n`}` : `${s.stamps && s.view === 'hex' ? stamp : ''}${body}`;
      })
      .join('');

  if (!available)
    return (
      <div data-testid="tool" class="tool">
        <div class="ai-gate" data-testid="serial-gate">
          <h2>The Serial Monitor needs the desktop app or a Chromium browser</h2>
          <p>Serial ports are reached through the Benchtop desktop app, or through Web Serial in Chrome and Edge. This browser offers neither.</p>
        </div>
      </div>
    );

  return (
    <div data-testid="tool" class="tool serial-tool">
      <div class="control-row">
        {isDesktop && (
          <label class="control">
            <span class="control-label">Port</span>
            <select class="input" value={s.port} disabled={open} onChange={(e) => set((v) => ({ ...v, port: e.currentTarget.value }))}>
              {ports.length === 0 && <option value="">No ports found</option>}
              {ports.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.detail ? ` — ${p.detail}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {isDesktop && (
          <button type="button" class="button" disabled={open} onClick={refresh}>
            Refresh
          </button>
        )}
        <label class="control">
          <span class="control-label">Speed (baud)</span>
          <select class="input" value={s.baud} disabled={open} onChange={(e) => set((v) => ({ ...v, baud: Number(e.currentTarget.value) }))}>
            {BAUDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label class="control">
          <span class="control-label">Format</span>
          <select
            class="input"
            value={`${s.dataBits}${s.parity[0]?.toUpperCase()}${s.stopBits}`}
            disabled={open}
            onChange={(e) => {
              const [bits, parity, stop] = [...e.currentTarget.value];
              set((v) => ({ ...v, dataBits: Number(bits), parity: parity === 'E' ? 'even' : parity === 'O' ? 'odd' : 'none', stopBits: Number(stop) }));
            }}
          >
            {['8N1', '8E1', '8O1', '8N2', '7E1', '7O1', '7N1'].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        {open ? (
          <button type="button" class="button" onClick={disconnect} data-testid="serial-close">
            Disconnect
          </button>
        ) : (
          <button type="button" class="button button-primary" disabled={isDesktop && !s.port} onClick={connect} data-testid="serial-open">
            Connect
          </button>
        )}
        <label class="check">
          <input type="checkbox" checked={dtr} onChange={(e) => signals({ dtr: e.currentTarget.checked })} /> DTR
        </label>
        <label class="check">
          <input type="checkbox" checked={rts} onChange={(e) => signals({ rts: e.currentTarget.checked })} /> RTS
        </label>
      </div>
      <div class="control-row">
        <Segmented
          label="Show as"
          value={s.view}
          onChange={(view) => set((v) => ({ ...v, view }))}
          choices={[
            { value: 'text', label: 'Text' },
            { value: 'hex', label: 'Hex' },
            { value: 'plot', label: 'Plot' },
          ]}
        />
        {s.view !== 'plot' && (
          <label class="check">
            <input type="checkbox" checked={s.stamps} onChange={(e) => set((v) => ({ ...v, stamps: e.currentTarget.checked }))} /> Timestamps
          </label>
        )}
        {s.view !== 'plot' && (
          <>
            <button type="button" class="button button-small" onClick={() => setLog([])}>
              Clear
            </button>
            <button
              type="button"
              class="button button-small"
              disabled={!log.length}
              onClick={() => attempt(async () => void (await saveFile(`serial-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`, render(), 'text/plain')))}
            >
              Save the log
            </button>
          </>
        )}
        <span class="tone-muted">{log.filter((c) => !c.sent).reduce((n, c) => n + c.bytes.length, 0)} bytes received</span>
      </div>
      {s.view === 'plot' ? (
        <PlotView
          buffer={plot.current}
          version={plotVersion}
          onDemo={() => {
            const start = plot.current.total;
            for (let i = 0; i < 400; i++) {
              const t = (start + i) / 25;
              plot.current.line(`sine:${(Math.sin(t) * 512 + 512).toFixed(1)} cosine:${(Math.cos(t * 0.5) * 300 + 512).toFixed(1)} noise:${(Math.random() * 120 + 100).toFixed(1)}`);
            }
            setPlotVersion((v) => v + 1);
          }}
          onClear={() => {
            plot.current.clear();
            setPlotVersion((v) => v + 1);
          }}
        />
      ) : (
        <pre class="serial-screen" {...scrollRegion('Received data')} ref={screen} data-testid="serial-screen" aria-live="polite">
          {render()}
        </pre>
      )}
      <form
        class="control-row serial-send"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input class="input" aria-label="Send" placeholder={hexInput ? 'AA 01 FF' : 'Text to send'} value={input} onInput={(e) => setInput(e.currentTarget.value)} disabled={!open} />
        <select class="input" aria-label="Line ending" value={s.ending} onChange={(e) => set((v) => ({ ...v, ending: e.currentTarget.value as Settings['ending'] }))} disabled={hexInput}>
          <option value="none">No line ending</option>
          <option value="lf">Newline (LF)</option>
          <option value="cr">Carriage return (CR)</option>
          <option value="crlf">CR + LF</option>
        </select>
        <label class="check">
          <input type="checkbox" checked={hexInput} onChange={(e) => setHexInput(e.currentTarget.checked)} /> Hex
        </label>
        <button type="submit" class="button button-primary" disabled={!open}>
          Send
        </button>
      </form>
    </div>
  );
}

const WINDOWS = [200, 500, 1000, 2000, 5000];

/** A live line chart of the numbers on the port, drawn on a canvas. */
function PlotView({ buffer, version, onDemo, onClear }: { buffer: PlotBuffer; version: number; onDemo: () => void; onClear: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [paused, setPaused] = useState(false);
  const [windowSize, setWindowSize] = useState(500);
  const [fixed, setFixed] = useState<{ min: string; max: string }>({ min: '', max: '' });
  const [frozen, setFrozen] = useState(0);
  const shown = paused ? frozen : version;

  useEffect(() => {
    if (buffer.capacity < windowSize) buffer.capacity = Math.max(2000, windowSize);
  }, [windowSize]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = el.clientWidth;
      const height = el.clientHeight;
      el.width = Math.round(width * ratio);
      el.height = Math.round(height * ratio);
      const g = el.getContext('2d');
      if (!g) return;
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      const style = getComputedStyle(el);
      const ink = style.getPropertyValue('--muted').trim() || '#666';
      const grid = style.getPropertyValue('--line').trim() || '#ddd';
      g.clearRect(0, 0, width, height);
      const series = buffer.series().filter((sr) => !hidden.has(sr.name));
      const count = Math.min(windowSize, buffer.length);
      const left = 56;
      const right = 10;
      const top = 10;
      const bottom = 22;
      const visible = series.map((sr) => sr.values.slice(Math.max(0, sr.values.length - count)));
      const finite = visible.flat().filter(Number.isFinite);
      const fMin = Number.parseFloat(fixed.min);
      const fMax = Number.parseFloat(fixed.max);
      const lo = Number.isFinite(fMin) ? fMin : finite.length ? Math.min(...finite) : 0;
      const hi = Number.isFinite(fMax) ? fMax : finite.length ? Math.max(...finite) : 1;
      const scale = niceScale(lo, hi, false);
      const yMin = Number.isFinite(fMin) ? fMin : scale.lo;
      const yMax = Number.isFinite(fMax) ? fMax : scale.hi;
      const py = (v: number) => top + (1 - (v - yMin) / (yMax - yMin || 1)) * (height - top - bottom);
      const px = (i: number) => left + (i / Math.max(1, windowSize - 1)) * (width - left - right);
      g.font = '11px system-ui, sans-serif';
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.lineWidth = 1;
      for (const t of scale.ticks) {
        if (t < yMin || t > yMax) continue;
        g.strokeStyle = grid;
        g.beginPath();
        g.moveTo(left, py(t));
        g.lineTo(width - right, py(t));
        g.stroke();
        g.fillStyle = ink;
        g.fillText(String(Number(t.toPrecision(6))), left - 6, py(t));
      }
      g.textAlign = 'center';
      g.textBaseline = 'top';
      const first = buffer.total - count;
      for (let i = 0; i <= 4; i++) {
        const at = Math.round((i / 4) * (windowSize - 1));
        g.fillText(String(Math.max(0, first + at - (windowSize - count))), px(at), height - bottom + 6);
      }
      visible.forEach((values, k) => {
        const index = buffer.series().findIndex((sr) => sr.name === series[k]?.name);
        g.strokeStyle = CHART_COLORS[index % CHART_COLORS.length] ?? '#0072B2';
        g.lineWidth = 1.6;
        g.beginPath();
        let pen = false;
        const offset = windowSize - values.length;
        values.forEach((v, i) => {
          if (!Number.isFinite(v)) {
            pen = false;
            return;
          }
          const x = px(offset + i);
          const y = py(Math.min(yMax, Math.max(yMin, v)));
          if (pen) g.lineTo(x, y);
          else g.moveTo(x, y);
          pen = true;
        });
        g.stroke();
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown, hidden, windowSize, fixed]);

  const all = buffer.series();
  return (
    <div class="plot-view" data-testid="serial-plot">
      <div class="control-row">
        <label class="control control-inline">
          <span class="control-label">Show the last</span>
          <select class="input" value={windowSize} onChange={(e) => setWindowSize(Number(e.currentTarget.value))}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w} points
              </option>
            ))}
          </select>
        </label>
        <label class="control control-inline">
          <span class="control-label">Y from</span>
          <input class="input input-narrow" placeholder="auto" value={fixed.min} onInput={(e) => setFixed((f) => ({ ...f, min: e.currentTarget.value }))} />
        </label>
        <label class="control control-inline">
          <span class="control-label">to</span>
          <input class="input input-narrow" placeholder="auto" value={fixed.max} onInput={(e) => setFixed((f) => ({ ...f, max: e.currentTarget.value }))} />
        </label>
        <button
          type="button"
          class="button button-small"
          aria-pressed={paused}
          onClick={() => {
            setFrozen(version);
            setPaused((p) => !p);
          }}
          data-testid="plot-pause"
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" class="button button-small" onClick={onClear}>
          Clear
        </button>
        <button
          type="button"
          class="button button-small"
          disabled={buffer.length === 0}
          onClick={() =>
            attempt(async () => {
              const outcome = await saveFile(`plot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, buffer.csv(), 'text/csv');
              if (outcome.saved) notify(`Saved to ${outcome.location}`);
            })
          }
        >
          Save as CSV
        </button>
        <button type="button" class="button button-small button-quiet" onClick={onDemo} data-testid="plot-demo">
          Try with sample data
        </button>
      </div>
      <canvas ref={canvas} class="plot-canvas" role="img" aria-label="Plot of the values received" />
      {all.length === 0 ? (
        <p class="control-help">
          Print numbers from the device, one reading per line: <code>Serial.println(value);</code>, several separated by spaces or commas, or named as <code>temp:21.5,humidity:40</code>. A line of
          words names the columns.
        </p>
      ) : (
        <ul class="plot-legend" data-testid="plot-legend">
          {all.map((sr, i) => (
            <li key={sr.name}>
              <label class="check">
                <input
                  type="checkbox"
                  checked={!hidden.has(sr.name)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setHidden((h) => {
                      const next = new Set(h);
                      if (on) next.delete(sr.name);
                      else next.add(sr.name);
                      return next;
                    });
                  }}
                />
                <span class="plot-swatch" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                {sr.name}
                <span class="plot-latest">{buffer.latest(sr.name) ?? ''}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default defineCustomTool(SerialMonitor);
