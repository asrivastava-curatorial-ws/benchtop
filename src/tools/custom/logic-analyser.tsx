/**
 * Logic Analyser: digital captures as waveforms, with cursors and
 * measurements, and decoders for I²C, SPI and serial traffic.  Captures come
 * from files (VCD, sigrok sessions, tables), from a logic analyser on a
 * serial port that speaks SUMP (Benchtop's Logic Probe sketch makes an
 * Arduino Uno into one), or from the demo.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import {
  type Annotation,
  asText,
  BAUDS,
  type Capture,
  type Decoded,
  decodeI2c,
  decodeSpi,
  decodeUart,
  demoCapture,
  edgesUpTo,
  fromSamples,
  guessBaud,
  type Line,
  levelAt,
  lineOf,
  measure,
  type Packet,
  packetsCsv,
  readCsv,
  readSigrok,
  readVcd,
  writeVcd,
} from '../../lib/logic';
import { LOGIC_PROBE_HEX, LOGIC_PROBE_SKETCH } from '../../lib/logic-probe';
import { ByteQueue, SUMP_RATES, type SumpDevice, type SumpLink, sumpCapture, sumpIdentify } from '../../lib/sump';
import { isDesktop, pickFile, saveFile } from '../../platform';
import { arduinoUpload } from '../../platform/esp32';
import { openSerialLink, type PortInfo, serialPorts, serialSupport } from '../../platform/serial';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { clamp, usePersistentState } from './_shared';

/* ------------------------------------------------------- wording -- */

export function timeText(seconds: number): string {
  const size = Math.abs(seconds);
  if (size === 0) return '0 s';
  const [unit, scale] = size >= 1 ? ['s', 1] : size >= 1e-3 ? ['ms', 1e3] : size >= 1e-6 ? ['µs', 1e6] : ['ns', 1e9];
  return `${Number((seconds * scale).toPrecision(4))} ${unit}`;
}

export function rateText(hertz: number): string {
  const [unit, scale] = hertz >= 1e6 ? ['MHz', 1e-6] : hertz >= 1e3 ? ['kHz', 1e-3] : ['Hz', 1];
  return `${Number((hertz * scale).toPrecision(4))} ${unit}`;
}

/* ------------------------------------------------------ decoders -- */

type DecoderSetup =
  | { readonly id: string; readonly kind: 'i2c'; readonly scl: number; readonly sda: number }
  | {
      readonly id: string;
      readonly kind: 'spi';
      readonly clk: number;
      readonly mosi: number;
      readonly miso: number;
      readonly cs: number;
      readonly mode: 0 | 1 | 2 | 3;
      readonly bits: number;
      readonly msbFirst: boolean;
      readonly csActiveLow: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'uart';
      readonly rx: number;
      readonly baud: number;
      readonly bits: number;
      readonly parity: 'none' | 'even' | 'odd';
      readonly stop: 1 | 2;
      readonly inverted: boolean;
    };

const DECODER_NAMES = { i2c: 'I²C', spi: 'SPI', uart: 'Serial' } as const;

let made = 0;
const newId = () => `d${Date.now().toString(36)}${(made++).toString(36)}`;

/** A decoder set up from the lines' names where they say what they are. */
function newDecoder(kind: DecoderSetup['kind'], capture: Capture): DecoderSetup {
  const find = (pattern: RegExp, fallback: number) => {
    const at = capture.names.findIndex((name) => pattern.test(name));
    return at >= 0 ? at : fallback;
  };
  const last = capture.names.length - 1;
  if (kind === 'i2c') return { id: newId(), kind, scl: find(/scl|sck|clock/i, 0), sda: find(/sda|data/i, Math.min(1, last)) };
  if (kind === 'spi')
    return {
      id: newId(),
      kind,
      clk: find(/clk|sck|sclk/i, 0),
      mosi: find(/mosi|copi|sdo/i, Math.min(1, last)),
      miso: find(/miso|cipo|sdi/i, -1),
      cs: find(/^n?cs|^n?ss|select/i, -1),
      mode: 0,
      bits: 8,
      msbFirst: true,
      csActiveLow: true,
    };
  // A line named for what a device sends is the likeliest to carry text; then one named for what it receives.
  const rx = find(/(^|[^a-z])tx($|[^a-z])/i, find(/(^|[^a-z])rx($|[^a-z])|uart|serial/i, 0));
  return { id: newId(), kind, rx, baud: guessBaud(capture, rx) ?? 9600, bits: 8, parity: 'none', stop: 1, inverted: false };
}

function runDecoder(capture: Capture, setup: DecoderSetup): Decoded {
  const has = (line: number) => line >= 0 && line < capture.names.length;
  if (setup.kind === 'i2c') return has(setup.scl) && has(setup.sda) && setup.scl !== setup.sda ? decodeI2c(capture, setup) : { annotations: [], packets: [] };
  if (setup.kind === 'spi') return has(setup.clk) && (has(setup.mosi) || has(setup.miso)) ? decodeSpi(capture, setup) : { annotations: [], packets: [] };
  return has(setup.rx) ? decodeUart(capture, setup) : { annotations: [], packets: [] };
}

/* ------------------------------------------------------ the view -- */

interface View {
  /** Ticks at the left and right edges. */
  readonly from: number;
  readonly to: number;
}

const ROW = 30;
const LANE = 26;
const AXIS = 24;
const LABEL = 78;

const whole = (capture: Capture): View => ({ from: -capture.length * 0.01, to: capture.length * 1.01 });

function zoomed(view: View, factor: number, anchor: number, capture: Capture): View {
  const span = clamp((view.to - view.from) * factor, 8, capture.length * 1.02);
  const share = (anchor - view.from) / (view.to - view.from);
  let from = anchor - span * share;
  from = clamp(from, -capture.length * 0.01, capture.length * 1.01 - span);
  return { from, to: from + span };
}

/** A step for the time axis that reads well: 1, 2 or 5 times a power of ten. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  const digit = rough / power;
  return (digit <= 1 ? 1 : digit <= 2 ? 2 : digit <= 5 ? 5 : 10) * power;
}

interface Lane {
  readonly title: string;
  readonly annotations: readonly Annotation[];
}

interface Colours {
  text: string;
  muted: string;
  line: string;
  panel: string;
  band: string;
  wave: string;
  soft: string;
  mark: string;
  bad: string;
  badSoft: string;
  ok: string;
}

function coloursOf(element: Element): Colours {
  const style = getComputedStyle(element);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    text: get('--text', '#19222a'),
    muted: get('--muted', '#55626d'),
    line: get('--line', '#d8dee3'),
    panel: get('--panel', '#ffffff'),
    band: get('--panel-2', '#f6f8f9'),
    wave: get('--accent', '#17694e'),
    soft: get('--accent-soft', '#e1f0ea'),
    mark: get('--brass', '#b7861b'),
    bad: get('--bad', '#b3261e'),
    badSoft: get('--bad-soft', '#fbe9e7'),
    ok: get('--ok', '#17694e'),
  };
}

function Waves({
  capture,
  lines,
  shown,
  lanes,
  view,
  onView,
  cursors,
  onCursor,
  onHover,
}: {
  capture: Capture;
  lines: readonly Line[];
  shown: readonly number[];
  lanes: readonly Lane[];
  view: View;
  onView: (view: View) => void;
  cursors: { a: number | null; b: number | null };
  onCursor: (which: 'a' | 'b', at: number) => void;
  onHover: (at: number | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(900);
  const [theme, setTheme] = useState(0);
  const height = AXIS + shown.length * ROW + lanes.length * LANE + 4;
  const plot = Math.max(50, width - LABEL);
  const tickAt = (x: number) => view.from + ((x - LABEL) / plot) * (view.to - view.from);
  const xAt = (tick: number) => LABEL + ((tick - view.from) / (view.to - view.from)) * plot;

  useEffect(() => {
    const element = canvas.current?.parentElement;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(320, Math.floor(element.clientWidth))));
    observer.observe(element);
    // The colours follow the theme: drawn again when it changes.
    const themes = new MutationObserver(() => setTheme((n) => n + 1));
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      themes.disconnect();
    };
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const ratio = window.devicePixelRatio || 1;
    target.width = Math.round(width * ratio);
    target.height = Math.round(height * ratio);
    const ctx = target.getContext('2d');
    if (!ctx) return;
    const c = coloursOf(target);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = c.panel;
    ctx.fillRect(0, 0, width, height);
    ctx.font = '12px "Barlow", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const span = view.to - view.from;
    const perPixel = span / plot;

    // The time axis.
    const step = niceStep((span * capture.tick * 90) / plot);
    ctx.strokeStyle = c.line;
    ctx.fillStyle = c.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = Math.ceil((view.from * capture.tick) / step) * step; t <= view.to * capture.tick; t += step) {
      const x = Math.round(xAt(t / capture.tick)) + 0.5;
      if (x < LABEL) continue;
      ctx.moveTo(x, AXIS - 6);
      ctx.lineTo(x, height);
      ctx.fillText(timeText(Number(t.toPrecision(12))), x + 4, AXIS / 2);
    }
    ctx.stroke();

    // Each line: a band, its name, and its levels.
    for (const [row, channel] of shown.entries()) {
      const top = AXIS + row * ROW;
      if (row % 2 === 1) {
        ctx.fillStyle = c.band;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(0, top, width, ROW);
        ctx.globalAlpha = 1;
      }
      const line = lines[channel] as Line;
      const high = top + 7;
      const low = top + ROW - 7;
      ctx.save();
      ctx.beginPath();
      ctx.rect(LABEL, top, plot, ROW);
      ctx.clip();
      ctx.strokeStyle = c.wave;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const first = edgesUpTo(line, view.from);
      const lastEdge = edgesUpTo(line, view.to);
      if (lastEdge - first <= plot) {
        // Few enough edges to draw each one.
        let level = (line.first + first) & 1;
        let x = LABEL;
        ctx.moveTo(x, level ? high : low);
        for (let i = first; i < lastEdge; i++) {
          x = xAt(line.edges[i] as number);
          ctx.lineTo(x, level ? high : low);
          level ^= 1;
          ctx.lineTo(x, level ? high : low);
        }
        ctx.lineTo(width, level ? high : low);
        ctx.stroke();
      } else {
        // More edges than pixels: a column with an edge in it is drawn full height.
        let index = first;
        let level = (line.first + first) & 1;
        ctx.moveTo(LABEL, level ? high : low);
        for (let px = 0; px < plot; px++) {
          const end = view.from + (px + 1) * perPixel;
          const next = edgesUpTo(line, end);
          const x = LABEL + px + 0.5;
          if (next > index) {
            ctx.moveTo(x, high);
            ctx.lineTo(x, low);
            level = (line.first + next) & 1;
            index = next;
            ctx.moveTo(x, level ? high : low);
          } else ctx.lineTo(x + 0.5, level ? high : low);
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = c.text;
      ctx.fillText((capture.names[channel] ?? `D${channel}`).slice(0, 11), 6, top + ROW / 2);
    }

    // Decoded traffic, a lane for each decoder.
    for (const [index, lane] of lanes.entries()) {
      const top = AXIS + shown.length * ROW + index * LANE;
      ctx.fillStyle = c.muted;
      ctx.fillText(lane.title.slice(0, 11), 6, top + LANE / 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(LABEL, top, plot, LANE);
      ctx.clip();
      // The first annotation that reaches into the view, found by halving.
      let lo = 0;
      let hi = lane.annotations.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((lane.annotations[mid] as Annotation).to < view.from) lo = mid + 1;
        else hi = mid;
      }
      let drawn = 0;
      for (let i = lo; i < lane.annotations.length && drawn < 4000; i++) {
        const a = lane.annotations[i] as Annotation;
        if (a.from > view.to) break;
        drawn++;
        const x1 = xAt(a.from);
        const x2 = xAt(a.to);
        const point = a.kind === 'start' || a.kind === 'restart' || a.kind === 'stop' || a.kind === 'ack' || a.kind === 'nak';
        if (point) {
          ctx.fillStyle = a.kind === 'nak' ? c.bad : a.kind === 'ack' ? c.ok : c.mark;
          ctx.fillRect(Math.round(x1) - 1, top + 4, 2, LANE - 8);
          if (perPixel * 14 < ((lane.annotations[i + 1] as Annotation | undefined)?.from ?? Number.POSITIVE_INFINITY) - a.from) {
            ctx.fillText(a.text, x1 + 3, top + LANE / 2);
          }
          continue;
        }
        const w = Math.max(2, x2 - x1);
        ctx.fillStyle = a.kind === 'error' ? c.badSoft : a.kind === 'address' ? c.soft : c.band;
        ctx.strokeStyle = a.kind === 'error' ? c.bad : c.wave;
        ctx.lineWidth = 1;
        ctx.fillRect(x1, top + 3, w, LANE - 6);
        ctx.strokeRect(Math.round(x1) + 0.5, top + 3.5, Math.max(1, Math.round(w) - 1), LANE - 7);
        if (w > ctx.measureText(a.text).width + 6) {
          ctx.fillStyle = a.kind === 'error' ? c.bad : c.text;
          ctx.textAlign = 'center';
          ctx.fillText(a.text, x1 + w / 2, top + LANE / 2 + 0.5);
          ctx.textAlign = 'left';
        }
      }
      ctx.restore();
    }

    // The label column's edge, and the two cursors.
    ctx.strokeStyle = c.line;
    ctx.beginPath();
    ctx.moveTo(LABEL - 0.5, 0);
    ctx.lineTo(LABEL - 0.5, height);
    ctx.stroke();
    for (const [name, at] of [
      ['A', cursors.a],
      ['B', cursors.b],
    ] as const) {
      if (at === null || at < view.from || at > view.to) continue;
      const x = Math.round(xAt(at)) + 0.5;
      ctx.strokeStyle = c.mark;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(name === 'A' ? [] : [5, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.mark;
      ctx.fillRect(x - 7, 0, 14, 14);
      ctx.fillStyle = c.panel;
      ctx.textAlign = 'center';
      ctx.fillText(name, x, 7.5);
      ctx.textAlign = 'left';
    }
  }, [capture, lines, shown, lanes, view, cursors, width, height, theme]);

  /** The tick under a pointer, drawn to the nearest edge of the line it is on when one is close. */
  const snapped = (event: PointerEvent | MouseEvent) => {
    const box = (event.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let at = clamp(tickAt(x), 0, capture.length);
    const row = Math.floor((y - AXIS) / ROW);
    const line = row >= 0 && row < shown.length ? lines[shown[row] as number] : undefined;
    if (line?.edges.length) {
      const after = edgesUpTo(line, at);
      const near = [line.edges[after - 1], line.edges[after]].filter((edge): edge is number => edge !== undefined).sort((p, q) => Math.abs(p - at) - Math.abs(q - at))[0];
      if (near !== undefined && Math.abs(xAt(near) - x) <= 6) at = near;
    }
    return at;
  };

  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const span = view.to - view.from;
  const centre = (view.from + view.to) / 2;

  return (
    <div class="la-waves">
      <canvas
        ref={canvas}
        class="la-canvas"
        style={{ width: `${width}px`, height: `${height}px` }}
        role="img"
        aria-label={`Waveforms of ${shown.length} line${shown.length === 1 ? '' : 's'}, ${timeText(Math.max(0, view.from) * capture.tick)} to ${timeText(Math.min(capture.length, view.to) * capture.tick)}. Arrow keys move, plus and minus zoom, Home shows everything.`}
        tabIndex={0}
        data-testid="la-canvas"
        onWheel={(event) => {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          if (event.shiftKey) {
            const shift = (event.deltaY / plot) * span;
            const from = clamp(view.from + shift, -capture.length * 0.01, capture.length * 1.01 - span);
            onView({ from, to: from + span });
          } else onView(zoomed(view, event.deltaY > 0 ? 1.25 : 0.8, tickAt(Math.max(LABEL, event.clientX - box.left)), capture));
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, from: view.from, moved: false };
        }}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const held = drag.current;
          if (held && Math.abs(event.clientX - held.x) > 3) held.moved = true;
          if (held?.moved) {
            const from = clamp(held.from - ((event.clientX - held.x) / plot) * span, -capture.length * 0.01, capture.length * 1.01 - span);
            onView({ from, to: from + span });
          }
          onHover(event.clientX - box.left >= LABEL ? clamp(tickAt(event.clientX - box.left), 0, capture.length) : null);
        }}
        onPointerUp={(event) => {
          const held = drag.current;
          drag.current = null;
          if (held && !held.moved) onCursor(event.shiftKey ? 'b' : 'a', snapped(event));
        }}
        onPointerLeave={() => onHover(null)}
        onKeyDown={(event) => {
          const move = (share: number) => {
            const from = clamp(view.from + span * share, -capture.length * 0.01, capture.length * 1.01 - span);
            onView({ from, to: from + span });
          };
          if (event.key === 'ArrowLeft') move(-0.1);
          else if (event.key === 'ArrowRight') move(0.1);
          else if (event.key === '+' || event.key === '=') onView(zoomed(view, 0.5, centre, capture));
          else if (event.key === '-' || event.key === '_') onView(zoomed(view, 2, centre, capture));
          else if (event.key === 'Home' || event.key === '0') onView(whole(capture));
          else return;
          event.preventDefault();
        }}
      />
    </div>
  );
}

/* ------------------------------------------- capture from a device -- */

interface DeviceSettings {
  readonly baud: number;
  readonly rate: number;
  readonly samples: number;
}

const read = (v: Values | undefined): DeviceSettings => ({
  baud: typeof v?.baud === 'number' && v.baud >= 300 && v.baud <= 4_000_000 ? v.baud : 115200,
  rate: typeof v?.rate === 'number' && v.rate >= 1 ? v.rate : 1_000_000,
  samples: typeof v?.samples === 'number' ? clamp(Math.round(v.samples), 4, 262_144) : 1536,
});

const SIMULATED = 'simulated';

function DevicePanel({ settings, set, onCapture }: { settings: DeviceSettings; set: (patch: Partial<DeviceSettings>) => void; onCapture: (capture: Capture, source: string) => void }) {
  const support = serialSupport();
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [port, setPort] = useState(SIMULATED);
  const [device, setDevice] = useState<SumpDevice | null>(null);
  const [state, setState] = useState<'idle' | 'connecting' | 'ready' | 'waiting' | 'reading'>('idle');
  const [progress, setProgress] = useState(0);
  const [trigger, setTrigger] = useState<readonly ('any' | 'high' | 'low')[]>([]);
  const [log, setLog] = useState('');
  const [uploading, setUploading] = useState(false);
  const link = useRef<(SumpLink & { close: () => void | Promise<void> }) | null>(null);
  const stop = useRef(false);

  const refresh = () =>
    attempt(async () => {
      const found = await serialPorts();
      setPorts(found);
    });
  useEffect(() => {
    if (support === 'desktop') void serialPorts().then(setPorts, () => undefined);
    return () => {
      stop.current = true;
      void link.current?.close();
    };
  }, [support]);

  const disconnect = async () => {
    stop.current = true;
    await link.current?.close();
    link.current = null;
    setDevice(null);
    setState('idle');
  };

  const connect = () =>
    attempt(async () => {
      await disconnect();
      stop.current = false;
      setState('connecting');
      try {
        if (port === SIMULATED) {
          const { simulatedProbe } = await import('../../lib/logic-probe-sim');
          link.current = await simulatedProbe();
        } else {
          const incoming = new ByteQueue();
          const opened = await openSerialLink({ port, baud: settings.baud }, { onData: (bytes) => incoming.push(bytes), onClosed: () => void disconnect() });
          link.current = { incoming, write: opened.write, close: opened.close };
        }
        const found = await sumpIdentify(link.current, 6000, () => stop.current);
        setDevice(found);
        setTrigger(Array.from({ length: Math.min(found.probes || 8, 16) }, () => 'any' as const));
        if (found.maxRate && settings.rate > found.maxRate) set({ rate: found.maxRate });
        if (found.memory && settings.samples > found.memory) set({ samples: found.memory });
        setState('ready');
      } catch (error) {
        await disconnect();
        throw error;
      }
    });

  const probe = device?.name.startsWith('Benchtop Logic Probe') ?? false;
  const lineCount = Math.min(device?.probes || 8, 16);
  const capture = () =>
    attempt(async () => {
      if (!link.current || !device) return;
      stop.current = false;
      setState('waiting');
      setProgress(0);
      try {
        let mask = 0;
        let value = 0;
        for (const [i, want] of trigger.entries()) {
          if (want === 'any') continue;
          mask |= 1 << i;
          if (want === 'high') value |= 1 << i;
        }
        const taken = await sumpCapture(
          link.current,
          device,
          { rate: settings.rate, samples: settings.samples, lines: lineCount > 8 ? 16 : 8, triggerMask: mask, triggerValue: value },
          (now) => {
            if (now === 'waiting') return;
            setState('reading');
            setProgress(now);
          },
          () => stop.current,
        );
        const names = Array.from({ length: lineCount }, (_, i) => (probe ? `Pin ${8 + i}` : `D${i}`));
        onCapture(fromSamples(taken.samples, taken.rate, names), `${device.name}, ${rateText(taken.rate)}`);
      } finally {
        if (link.current) setState('ready');
      }
    });

  const upload = () =>
    attempt(async () => {
      setUploading(true);
      setLog('Uploading…');
      try {
        await disconnect();
        const result = await arduinoUpload({ fqbn: 'arduino:avr:uno', port, hex: LOGIC_PROBE_HEX });
        setLog(result.log.trim() || (result.ok ? 'Uploaded.' : 'The upload failed.'));
        if (result.ok) notify('The Logic Probe is on the board. Connect to it now.');
      } finally {
        setUploading(false);
      }
    });

  const rates = SUMP_RATES.filter((rate) => !device?.maxRate || rate <= device.maxRate);
  const length = settings.samples / settings.rate;
  const busy = state === 'connecting' || state === 'waiting' || state === 'reading';

  return (
    <div class="la-device" data-testid="la-device" data-state={state}>
      <div class="control-row">
        <label class="control">
          <span class="control-label">Device</span>
          <select class="select" value={port} disabled={state !== 'idle'} onChange={(e) => setPort(e.currentTarget.value)} data-testid="la-port">
            <option value={SIMULATED}>Simulated Logic Probe (an emulated Arduino Uno with the demo signals)</option>
            {support === 'desktop' &&
              ports.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.detail ? ` (${p.detail})` : ''}
                </option>
              ))}
            {support === 'web' && <option value="web">A serial port (the browser asks which)</option>}
          </select>
        </label>
        {port !== SIMULATED && (
          <label class="control">
            <span class="control-label">Speed (baud)</span>
            <select class="select" value={settings.baud} disabled={state !== 'idle'} onChange={(e) => set({ baud: Number(e.currentTarget.value) })}>
              {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 500000, 921600, 1000000, 2000000].map((baud) => (
                <option key={baud} value={baud}>
                  {baud}
                </option>
              ))}
            </select>
          </label>
        )}
        {support === 'desktop' && state === 'idle' && (
          <button type="button" class="button button-small button-quiet" onClick={refresh}>
            <Icon name="refresh" size={14} /> Look for ports
          </button>
        )}
        {state === 'idle' || state === 'connecting' ? (
          <button type="button" class="button button-small button-primary" disabled={state === 'connecting'} onClick={connect} data-testid="la-connect">
            {state === 'connecting' ? 'Looking for the device…' : 'Connect'}
          </button>
        ) : (
          <button type="button" class="button button-small" onClick={() => attempt(disconnect)} data-testid="la-disconnect">
            Disconnect
          </button>
        )}
      </div>
      {support === 'none' && <p class="control-help">A real device needs the Benchtop desktop app, or a Chromium browser (Chrome, Edge). The simulated probe works everywhere.</p>}

      {device && (
        <>
          <p class="la-found" data-testid="la-found">
            <strong>{device.name}</strong>
            {device.version ? ` ${device.version}` : ''}
            {device.probes ? `, ${device.probes} lines` : ''}
            {device.memory ? `, ${device.memory.toLocaleString()} samples` : ''}
            {device.maxRate ? `, up to ${rateText(device.maxRate)}` : ''}
          </p>
          {port === SIMULATED && (
            <p class="control-help">
              The simulated board has the demo’s I²C and SPI traffic on its pins 8 to 13 (I²C clock and data, then SPI clock, out, in and select). The traffic begins a moment after each capture is
              asked for, as if a button on the board were pressed.
            </p>
          )}
          <div class="control-row">
            <label class="control">
              <span class="control-label">Sample rate</span>
              <select class="select" value={settings.rate} disabled={busy} onChange={(e) => set({ rate: Number(e.currentTarget.value) })} data-testid="la-rate">
                {rates.map((rate) => (
                  <option key={rate} value={rate}>
                    {rateText(rate)}
                  </option>
                ))}
              </select>
            </label>
            <label class="control">
              <span class="control-label">Samples</span>
              <input
                class="input input-number"
                type="number"
                min={4}
                max={device.memory || 262_144}
                step={4}
                value={settings.samples}
                disabled={busy}
                onChange={(e) => set({ samples: clamp(Math.round(Number(e.currentTarget.value)) || 4, 4, device.memory || 262_144) })}
                data-testid="la-samples"
              />
            </label>
            <span class="tone-muted la-length">covers {timeText(length)}</span>
          </div>
          <fieldset class="la-trigger">
            <legend class="control-label">Start the capture when</legend>
            {trigger.slice(0, lineCount).map((want, i) => (
              <label key={i} class="la-trigger-line">
                <span>{probe ? `Pin ${8 + i}` : `D${i}`}</span>
                <select
                  class="select select-small"
                  value={want}
                  disabled={busy}
                  onChange={(e) => setTrigger(trigger.map((old, at) => (at === i ? (e.currentTarget.value as 'any' | 'high' | 'low') : old)))}
                  data-testid={`la-trigger-${i}`}
                >
                  <option value="any">any</option>
                  <option value="high">is high</option>
                  <option value="low">is low</option>
                </select>
              </label>
            ))}
          </fieldset>
          <div class="button-row">
            {busy ? (
              <button
                type="button"
                class="button button-small button-danger"
                onClick={() => {
                  stop.current = true;
                }}
                data-testid="la-stop"
              >
                Stop
              </button>
            ) : (
              <button type="button" class="button button-small button-primary" onClick={capture} data-testid="la-capture">
                <Icon name="play" size={14} /> Capture
              </button>
            )}
            <span class="tone-muted" role="status" data-testid="la-status">
              {state === 'waiting' ? 'Waiting for the trigger and the capture…' : state === 'reading' ? `Reading the samples: ${Math.round(progress * 100)} %` : ''}
            </span>
          </div>
        </>
      )}

      <details class="la-help">
        <summary>Make an Arduino Uno or Nano into a logic probe</summary>
        <p>
          The Logic Probe sketch reads pins 8 to 13 (six lines) up to 2 MHz, 1536 samples at a time, and answers at 115200 baud. Open it in the Arduino IDE and upload it, or upload the compiled
          program from here. Connect the board’s GND to the circuit’s ground, and measure 5 V or 3.3 V logic only.
        </p>
        <div class="button-row">
          <button
            type="button"
            class="button button-small"
            onClick={() => attempt(async () => void (await saveFile('logic-probe.ino', new TextEncoder().encode(LOGIC_PROBE_SKETCH), 'text/plain')))}
            data-testid="la-sketch"
          >
            <Icon name="save" size={14} /> The sketch (.ino)
          </button>
          <button type="button" class="button button-small" onClick={() => attempt(async () => void (await saveFile('logic-probe-uno.hex', new TextEncoder().encode(LOGIC_PROBE_HEX), 'text/plain')))}>
            <Icon name="save" size={14} /> Compiled for the Uno (.hex)
          </button>
          {isDesktop && (
            <button type="button" class="button button-small" disabled={uploading || port === SIMULATED || port === 'web' || state !== 'idle'} onClick={upload}>
              {uploading ? 'Uploading…' : 'Upload to the Uno on the chosen port'}
            </button>
          )}
        </div>
        {isDesktop && <p class="control-help">Uploading uses arduino-cli (or the one inside Arduino IDE 2) with the Arduino AVR boards installed.</p>}
        {log && <pre class="cs-log">{log}</pre>}
        <p class="control-help">Other analysers that speak SUMP work too: the Open Bench Logic Sniffer, the Bus Pirate, and SUMP firmware for Pico and ESP32 boards.</p>
      </details>
    </div>
  );
}

/* --------------------------------------------------------- the tool -- */

async function captureFrom(file: File, rate: number): Promise<{ capture: Capture; needsRate: boolean }> {
  if (file.size > 200 * 1024 * 1024) throw new Error(`${file.name} is larger than 200 MB.`);
  if (/\.sr$/i.test(file.name)) {
    const { unzipSync } = await import('fflate');
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (entry) => entry.name === 'metadata' || /^logic-\d+(-\d+)?$/.test(entry.name) });
    return { capture: readSigrok(files), needsRate: false };
  }
  const text = await file.text();
  if (/\.vcd$/i.test(file.name) || /\$enddefinitions\b/.test(text.slice(0, 20000))) return { capture: readVcd(text), needsRate: false };
  const capture = readCsv(text, rate);
  return { capture, needsRate: capture.rate !== undefined };
}

function LogicAnalyser({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<DeviceSettings>(toolId, read, (s): Values => ({ ...s }));
  const [capture, setCapture] = useState<Capture | null>(null);
  const [source, setSource] = useState('');
  const [view, setView] = useState<View>({ from: 0, to: 1 });
  const [cursors, setCursors] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [hover, setHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState<readonly number[]>([]);
  const [decoders, setDecoders] = useState<readonly DecoderSetup[]>([]);
  const [showDevice, setShowDevice] = useState(false);
  const [table, setTable] = useState<{ file: File; rate: number } | null>(null);

  const load = (next: Capture, from: string, withDecoders: readonly DecoderSetup['kind'][] = []) => {
    setCapture(next);
    setSource(from);
    setView(whole(next));
    setCursors({ a: null, b: null });
    setHidden([]);
    setDecoders(withDecoders.map((kind) => newDecoder(kind, next)));
  };

  const open = (file: File, rate = 1_000_000) =>
    attempt(async () => {
      const { capture: next, needsRate } = await captureFrom(file, rate);
      load(next, file.name);
      setTable(needsRate ? { file, rate } : null);
    });
  useIncomingFiles(
    (files) => {
      if (files[0]) void open(files[0]);
    },
    (file) => /\.(vcd|sr|csv|tsv|txt)$/i.test(file.name),
  );

  const lines = useMemo(() => (capture ? capture.names.map((_, i) => lineOf(capture, i)) : []), [capture]);
  const shown = useMemo(() => (capture ? capture.names.map((_, i) => i).filter((i) => !hidden.includes(i)) : []), [capture, hidden]);
  const decoded = useMemo(() => (capture ? decoders.map((setup) => ({ setup, result: runDecoder(capture, setup) })) : []), [capture, decoders]);
  const lanes = useMemo(() => decoded.map(({ setup, result }) => ({ title: DECODER_NAMES[setup.kind], annotations: result.annotations })), [decoded]);
  const rows = useMemo(
    () => decoded.flatMap(({ setup, result }) => result.packets.map((packet) => ({ decoder: DECODER_NAMES[setup.kind], packet }))).sort((p, q) => p.packet.from - q.packet.from),
    [decoded],
  );

  // What each line does between the cursors, or in view when there are not two.
  const range =
    capture && cursors.a !== null && cursors.b !== null
      ? { from: Math.min(cursors.a, cursors.b), to: Math.max(cursors.a, cursors.b) }
      : capture
        ? { from: Math.max(0, view.from), to: Math.min(capture.length, view.to) }
        : null;
  const measures = useMemo(
    () => (capture && range ? shown.map((i) => ({ channel: i, ...measure(lines[i] as Line, range.from, range.to, capture.tick) })) : []),
    [capture, lines, shown, range?.from, range?.to],
  );

  const rename = (channel: number, name: string) => capture && setCapture({ ...capture, names: capture.names.map((old, i) => (i === channel ? name : old)) });
  const patch = (id: string, change: Partial<DecoderSetup>) => setDecoders(decoders.map((d) => (d.id === id ? ({ ...d, ...change } as DecoderSetup) : d)));
  const lineChoice = (value: number, onChange: (line: number) => void, label: string, optional = false) => (
    <label class="control">
      <span class="control-label">{label}</span>
      <select class="select select-small" value={value} onChange={(e) => onChange(Number(e.currentTarget.value))}>
        {optional && <option value={-1}>not connected</option>}
        {capture?.names.map((name, i) => (
          <option key={i} value={i}>
            {name || `D${i}`}
          </option>
        ))}
      </select>
    </label>
  );

  const goTo = (packet: Packet) => {
    if (!capture) return;
    const span = Math.max(16, (packet.to - packet.from) * 1.6);
    const middle = (packet.from + packet.to) / 2;
    setView(zoomed({ from: middle - span / 2, to: middle + span / 2 }, 1, middle, capture));
    setCursors({ a: packet.from, b: packet.to });
  };

  const saveVcd = () =>
    attempt(async () => {
      if (!capture) return;
      const saved = await saveFile('capture.vcd', new TextEncoder().encode(writeVcd(capture, new Date().toISOString())), 'text/plain');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });
  const saveTable = () =>
    attempt(async () => {
      if (!capture || !rows.length) return;
      const saved = await saveFile('decoded.csv', new TextEncoder().encode(`\uFEFF${packetsCsv(capture, rows)}`), 'text/csv');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });

  const second = capture?.tick ?? 1;
  const delta = cursors.a !== null && cursors.b !== null ? Math.abs(cursors.b - cursors.a) * second : null;
  const bytesText = (list: readonly number[] | undefined) => (list ?? []).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

  return (
    <div data-testid="tool" class="tool la" data-state={capture ? 'done' : 'idle'}>
      <div class="button-row la-bar">
        <button
          type="button"
          class="button button-small button-primary"
          onClick={() =>
            attempt(async () => {
              const file = await pickFile('.vcd,.sr,.csv,.tsv,.txt');
              if (file) await open(file);
            })
          }
          data-testid="la-open"
        >
          <Icon name="open" size={15} /> Open a capture
        </button>
        <button type="button" class="button button-small" onClick={() => load(demoCapture(), 'Demo capture', ['i2c', 'spi', 'uart'])} data-testid="la-demo">
          <Icon name="sample" size={15} /> Demo
        </button>
        <button type="button" class="button button-small" aria-expanded={showDevice} onClick={() => setShowDevice(!showDevice)} data-testid="la-device-open">
          <Icon name="play" size={15} /> Capture from a device
        </button>
        {capture && (
          <span class="tone-muted" data-testid="la-info">
            {source} · {capture.names.length} line{capture.names.length === 1 ? '' : 's'} · {timeText(capture.length * capture.tick)}
            {capture.rate ? ` at ${rateText(capture.rate)}` : ''} · {(capture.times.length - 1).toLocaleString()} changes
          </span>
        )}
      </div>
      {table && (
        <div class="control-row la-rate">
          <label class="control">
            <span class="control-label">This table has no times: its rows were sampled at (Hz)</span>
            <input
              class="input input-number"
              type="number"
              min={1}
              max={1e9}
              value={table.rate}
              onChange={(e) => void open(table.file, clamp(Number(e.currentTarget.value) || 1, 1, 1e9))}
              data-testid="la-table-rate"
            />
          </label>
        </div>
      )}
      {showDevice && (
        <DevicePanel
          settings={settings}
          set={(change) => setSettings((s) => ({ ...s, ...change }))}
          onCapture={(next, from) => {
            load(next, from);
            notify('Captured.');
          }}
        />
      )}

      {capture ? (
        <>
          <div class="button-row la-zoom">
            <button type="button" class="button button-small" onClick={() => setView(zoomed(view, 0.5, (view.from + view.to) / 2, capture))} data-testid="la-zoom-in">
              <Icon name="plus" size={14} /> Zoom in
            </button>
            <button type="button" class="button button-small" onClick={() => setView(zoomed(view, 2, (view.from + view.to) / 2, capture))} data-testid="la-zoom-out">
              Zoom out
            </button>
            <button type="button" class="button button-small" onClick={() => setView(whole(capture))} data-testid="la-fit">
              Show all
            </button>
            <button type="button" class="button button-small button-quiet" disabled={cursors.a === null && cursors.b === null} onClick={() => setCursors({ a: null, b: null })}>
              Clear the cursors
            </button>
            <span class="la-readout" data-testid="la-readout">
              {hover !== null ? `Pointer ${timeText(hover * second)}` : 'Click sets cursor A, Shift and click sets B; the wheel zooms, dragging moves.'}
            </span>
          </div>
          <Waves
            capture={capture}
            lines={lines}
            shown={shown}
            lanes={lanes}
            view={view}
            onView={setView}
            cursors={cursors}
            onCursor={(which, at) => setCursors((old) => ({ ...old, [which]: at }))}
            onHover={setHover}
          />
          <p class="la-cursors" data-testid="la-cursors">
            {cursors.a !== null && <span>A {timeText(cursors.a * second)}</span>}
            {cursors.b !== null && <span>B {timeText(cursors.b * second)}</span>}
            {delta !== null && (
              <span>
                B − A {timeText(delta)}
                {delta > 0 ? ` (${rateText(1 / delta)})` : ''}
              </span>
            )}
            <span class="tone-muted">
              Showing {timeText(Math.max(0, view.from) * second)} to {timeText(Math.min(capture.length, view.to) * second)}
            </span>
          </p>

          <div class="la-panels">
            <div class="pp-panel">
              <span class="pane-title">Lines {cursors.a !== null && cursors.b !== null ? 'between the cursors' : 'in view'}</span>
              <div class="la-lines" data-testid="la-lines">
                <div class="la-line la-line-head" aria-hidden="true">
                  <span>Show</span>
                  <span>Name</span>
                  <span>Frequency</span>
                  <span>High</span>
                  <span>Edges</span>
                </div>
                {capture.names.map((name, i) => {
                  const m = measures.find((entry) => entry.channel === i);
                  return (
                    <div key={i} class="la-line" data-testid="la-line">
                      <input
                        type="checkbox"
                        checked={!hidden.includes(i)}
                        aria-label={`Show ${name || `line ${i}`}`}
                        onChange={(e) => setHidden(e.currentTarget.checked ? hidden.filter((h) => h !== i) : [...hidden, i])}
                      />
                      <input class="input" type="text" value={name} maxLength={24} aria-label={`Name of line ${i}`} onChange={(e) => rename(i, e.currentTarget.value)} />
                      <span>{m?.frequency ? rateText(m.frequency) : '—'}</span>
                      <span>
                        {m?.duty !== null && m?.duty !== undefined
                          ? `${Math.round(m.duty * 100)} %`
                          : m
                            ? levelAt(lines[i] as Line, range?.from ?? 0) && m.edges === 0
                              ? 'high'
                              : m.edges === 0
                                ? 'low'
                                : '—'
                            : ''}
                      </span>
                      <span>{m ? m.edges.toLocaleString() : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div class="pp-panel">
              <span class="pane-title">Decoders</span>
              {decoded.map(({ setup, result }) => (
                <div key={setup.id} class="la-decoder" data-testid="la-decoder">
                  <div class="la-decoder-head">
                    <strong>{DECODER_NAMES[setup.kind]}</strong>
                    <span class="tone-muted">
                      {result.packets.length} {setup.kind === 'i2c' ? 'transfer' : setup.kind === 'spi' ? 'frame' : 'run'}
                      {result.packets.length === 1 ? '' : 's'}
                    </span>
                    <button type="button" class="icon-button" aria-label={`Remove the ${DECODER_NAMES[setup.kind]} decoder`} onClick={() => setDecoders(decoders.filter((d) => d.id !== setup.id))}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  <div class="control-row">
                    {setup.kind === 'i2c' && (
                      <>
                        {lineChoice(setup.scl, (scl) => patch(setup.id, { scl }), 'Clock (SCL)')}
                        {lineChoice(setup.sda, (sda) => patch(setup.id, { sda }), 'Data (SDA)')}
                      </>
                    )}
                    {setup.kind === 'spi' && (
                      <>
                        {lineChoice(setup.clk, (clk) => patch(setup.id, { clk }), 'Clock')}
                        {lineChoice(setup.mosi, (mosi) => patch(setup.id, { mosi }), 'Out (MOSI)', true)}
                        {lineChoice(setup.miso, (miso) => patch(setup.id, { miso }), 'In (MISO)', true)}
                        {lineChoice(setup.cs, (cs) => patch(setup.id, { cs }), 'Select (CS)', true)}
                        <label class="control">
                          <span class="control-label">Mode</span>
                          <select class="select select-small" value={setup.mode} onChange={(e) => patch(setup.id, { mode: Number(e.currentTarget.value) as 0 | 1 | 2 | 3 })}>
                            <option value={0}>0 (idle low, read on rise)</option>
                            <option value={1}>1 (idle low, read on fall)</option>
                            <option value={2}>2 (idle high, read on fall)</option>
                            <option value={3}>3 (idle high, read on rise)</option>
                          </select>
                        </label>
                        <label class="control">
                          <span class="control-label">Bits</span>
                          <input
                            class="input input-number"
                            type="number"
                            min={4}
                            max={32}
                            value={setup.bits}
                            onChange={(e) => patch(setup.id, { bits: clamp(Math.round(Number(e.currentTarget.value)) || 8, 4, 32) })}
                          />
                        </label>
                        <label class="check">
                          <input type="checkbox" checked={setup.msbFirst} onChange={(e) => patch(setup.id, { msbFirst: e.currentTarget.checked })} />
                          Highest bit first
                        </label>
                        <label class="check">
                          <input type="checkbox" checked={setup.csActiveLow} onChange={(e) => patch(setup.id, { csActiveLow: e.currentTarget.checked })} />
                          Selected when low
                        </label>
                      </>
                    )}
                    {setup.kind === 'uart' && (
                      <>
                        {lineChoice(setup.rx, (rx) => patch(setup.id, { rx, baud: guessBaud(capture, rx) ?? setup.baud }), 'Line')}
                        <label class="control">
                          <span class="control-label">Speed (baud)</span>
                          <input
                            class="input input-number"
                            type="number"
                            min={50}
                            max={10_000_000}
                            list="la-bauds"
                            value={setup.baud}
                            onChange={(e) => patch(setup.id, { baud: clamp(Number(e.currentTarget.value) || 9600, 50, 10_000_000) })}
                            data-testid="la-baud"
                          />
                        </label>
                        <label class="control">
                          <span class="control-label">Bits</span>
                          <select class="select select-small" value={setup.bits} onChange={(e) => patch(setup.id, { bits: Number(e.currentTarget.value) })}>
                            {[5, 6, 7, 8, 9].map((bits) => (
                              <option key={bits} value={bits}>
                                {bits}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label class="control">
                          <span class="control-label">Parity</span>
                          <select class="select select-small" value={setup.parity} onChange={(e) => patch(setup.id, { parity: e.currentTarget.value as 'none' | 'even' | 'odd' })}>
                            <option value="none">none</option>
                            <option value="even">even</option>
                            <option value="odd">odd</option>
                          </select>
                        </label>
                        <label class="control">
                          <span class="control-label">Stop bits</span>
                          <select class="select select-small" value={setup.stop} onChange={(e) => patch(setup.id, { stop: Number(e.currentTarget.value) as 1 | 2 })}>
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                          </select>
                        </label>
                        <label class="check">
                          <input type="checkbox" checked={setup.inverted} onChange={(e) => patch(setup.id, { inverted: e.currentTarget.checked })} />
                          Idles low (inverted)
                        </label>
                      </>
                    )}
                  </div>
                </div>
              ))}
              <datalist id="la-bauds">
                {BAUDS.map((baud) => (
                  <option key={baud} value={baud} />
                ))}
              </datalist>
              <div class="button-row">
                {(['i2c', 'spi', 'uart'] as const).map((kind) => (
                  <button key={kind} type="button" class="button button-small" onClick={() => setDecoders([...decoders, newDecoder(kind, capture)])} data-testid={`la-add-${kind}`}>
                    <Icon name="plus" size={14} /> {DECODER_NAMES[kind]}
                  </button>
                ))}
              </div>
              <p class="control-help">A decoder reads its lines over the whole capture. For clean results the capture should take at least four samples to each bit.</p>
            </div>
          </div>

          <div class="pp-panel">
            <div class="la-table-head">
              <span class="pane-title">Decoded</span>
              <span class="tone-muted" data-testid="la-count">
                {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}
              </span>
              <div class="button-row">
                <button type="button" class="button button-small" disabled={!rows.length} onClick={saveTable} data-testid="la-save-table">
                  <Icon name="save" size={14} /> Table (CSV)
                </button>
                <button type="button" class="button button-small" onClick={saveVcd} data-testid="la-save-vcd">
                  <Icon name="save" size={14} /> Capture (VCD)
                </button>
              </div>
            </div>
            {rows.length > 0 ? (
              <div class="la-table-wrap" {...scrollRegion('Decoded traffic')}>
                <table class="ps-plans la-table" data-testid="la-table">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Decoder</th>
                      <th scope="col">What</th>
                      <th scope="col">Out (hex)</th>
                      <th scope="col">In (hex)</th>
                      <th scope="col">Text</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 500).map(({ decoder, packet }) => (
                      <tr key={`${decoder}-${packet.from}`} data-testid="la-row">
                        <td>
                          <button type="button" class="la-jump" onClick={() => goTo(packet)} title="Show this in the waveforms">
                            {timeText(packet.from * second)}
                          </button>
                        </td>
                        <td>{decoder}</td>
                        <td>{packet.title}</td>
                        <td class="la-bytes">{bytesText(packet.out)}</td>
                        <td class="la-bytes">{bytesText(packet.in)}</td>
                        <td class="la-bytes">{asText(packet.in?.length ? packet.in : packet.out)}</td>
                        <td>{packet.note ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p class="tone-muted">{decoders.length ? 'The decoders found nothing on their lines.' : 'Add a decoder to read I²C, SPI or serial traffic from the lines.'}</p>
            )}
            {rows.length > 500 && <p class="control-help">The first 500 rows are listed; the CSV file has all {rows.length.toLocaleString()}.</p>}
          </div>
        </>
      ) : (
        <p class="pp-empty" data-testid="la-empty">
          Open a capture (VCD from PulseView, GTKWave or a simulator; a sigrok session; a table of 0s and 1s), take one from a logic analyser on a serial port, or load the demo.
        </p>
      )}
    </div>
  );
}

export default defineCustomTool(LogicAnalyser);
