/**
 * Data Logger: records what a sensor or instrument sends over a serial or USB
 * port, each reading with its time, shows it as it comes in, and saves it as
 * CSV, SQLite or Parquet.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Averager, type ChannelSetup, DEMO_UNITS, defaultSetup, demoReading, type LineFormat, LineParser, Recording, sqliteSchema, summarise, tableOf, toCsv } from '../../lib/datalog';
import { CHART_COLORS, formatTick, niceScale, niceStep } from '../../lib/svg-chart';
import { saveFile } from '../../platform';
import { BAUD_RATES, LineSplitter, openSerialLink, type PortInfo, type SerialLink, serialPorts, serialSupport } from '../../platform/serial';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { CommitInput, usePersistentState } from './_shared';

interface Settings {
  readonly source: 'demo' | 'serial';
  readonly port: string;
  readonly baud: number;
  readonly format: LineFormat;
  /** Milliseconds each saved row covers; 0 saves every reading. */
  readonly interval: number;
  readonly poll: string;
  readonly pollEvery: number;
  readonly window: number;
  readonly overlay: boolean;
  readonly setups: readonly ChannelSetup[];
}

const INTERVALS: readonly { ms: number; label: string }[] = [
  { ms: 0, label: 'every reading' },
  { ms: 1000, label: 'one row a second (average)' },
  { ms: 10_000, label: 'one row every 10 seconds (average)' },
  { ms: 60_000, label: 'one row a minute (average)' },
  { ms: 600_000, label: 'one row every 10 minutes (average)' },
];

const WINDOWS: readonly { seconds: number; label: string }[] = [
  { seconds: 30, label: 'the last 30 seconds' },
  { seconds: 120, label: 'the last 2 minutes' },
  { seconds: 600, label: 'the last 10 minutes' },
  { seconds: 3600, label: 'the last hour' },
  { seconds: 0, label: 'everything' },
];

const FORMATS: readonly { id: LineFormat; label: string }[] = [
  { id: 'auto', label: 'Work it out' },
  { id: 'numbers', label: 'Numbers: 23.5, 48.1' },
  { id: 'pairs', label: 'Names and values: T=23.5 H=48' },
  { id: 'json', label: 'JSON: {"T": 23.5}' },
];

const PREVIEW_ROWS = 4000;

function readSettings(stored: Values | undefined): Settings {
  const setups = Array.isArray(stored?.setups) ? (stored.setups as unknown[]) : [];
  return {
    source: stored?.source === 'serial' && serialSupport() !== 'none' ? 'serial' : serialSupport() === 'none' || stored?.source === 'demo' ? 'demo' : 'serial',
    port: typeof stored?.port === 'string' ? stored.port : '',
    baud: typeof stored?.baud === 'number' ? stored.baud : 9600,
    format: FORMATS.find((f) => f.id === stored?.format)?.id ?? 'auto',
    interval: INTERVALS.find((i) => i.ms === stored?.interval)?.ms ?? 0,
    poll: typeof stored?.poll === 'string' ? stored.poll : '',
    pollEvery: typeof stored?.pollEvery === 'number' && stored.pollEvery >= 0.1 ? stored.pollEvery : 1,
    window: WINDOWS.find((w) => w.seconds === stored?.window)?.seconds ?? 120,
    overlay: stored?.overlay === true,
    setups: setups
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null && typeof (s as { name?: unknown }).name === 'string')
      .map((s) => ({
        name: String(s.name),
        label: typeof s.label === 'string' ? s.label : String(s.name),
        unit: typeof s.unit === 'string' ? s.unit : '',
        scale: typeof s.scale === 'number' && Number.isFinite(s.scale) ? s.scale : 1,
        offset: typeof s.offset === 'number' && Number.isFinite(s.offset) ? s.offset : 0,
        visible: s.visible !== false,
      })),
  };
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Draws the channels over time: one strip each, or all on one scale. */
function draw(canvas: HTMLCanvasElement, recording: Recording, setups: readonly ChannelSetup[], windowSeconds: number, overlay: boolean): void {
  const shown = recording.channels.map((name) => setups.find((s) => s.name === name) ?? defaultSetup(name)).filter((s) => s.visible);
  const width = canvas.clientWidth || 800;
  const strip = overlay ? 300 : 120;
  const height = Math.max(160, (overlay ? strip : strip * Math.max(1, shown.length)) + 28);
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.height = `${height}px`;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  const style = getComputedStyle(canvas);
  const ink = style.color || '#19222a';
  const faint = style.getPropertyValue('--line').trim() || '#d8dee3';
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.font = '11px system-ui, sans-serif';
  const left = 58;
  const right = 10;
  const plotWidth = width - left - right;
  const times = recording.times;
  if (!times.length || !shown.length) {
    context.fillStyle = ink;
    context.fillText(shown.length ? 'Waiting for readings…' : 'No channel is ticked to show.', left, 40);
    return;
  }
  const end = times[times.length - 1] as number;
  const begin = windowSeconds > 0 ? Math.max(times[0] as number, end - windowSeconds * 1000) : (times[0] as number);
  const span = Math.max(1, end - begin);
  let first = 0;
  while (first < times.length && (times[first] as number) < begin) first++;
  const x = (time: number) => left + ((time - begin) / span) * plotWidth;

  const series = shown.map((setup) => {
    const raw = recording.column(setup.name);
    let low = Infinity;
    let high = -Infinity;
    for (let i = first; i < raw.length; i++) {
      const value = (raw[i] as number) * setup.scale + setup.offset;
      if (Number.isNaN(value)) continue;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    return { setup, raw, low, high };
  });
  const allLow = Math.min(...series.map((s) => s.low));
  const allHigh = Math.max(...series.map((s) => s.high));

  series.forEach((entry, index) => {
    const top = overlay ? 8 : index * strip + 8;
    const plotHeight = strip - 20;
    const low = overlay ? allLow : entry.low;
    const high = overlay ? allHigh : entry.high;
    if (low === Infinity) return;
    const pad = high === low ? Math.max(1e-9, Math.abs(high) * 0.05 || 0.5) : 0;
    const scale = niceScale(low - pad, high + pad, false);
    const y = (value: number) => top + plotHeight - ((value - scale.lo) / (scale.hi - scale.lo || 1)) * plotHeight;
    if (!overlay || index === 0) {
      context.strokeStyle = faint;
      context.fillStyle = ink;
      context.lineWidth = 1;
      context.textAlign = 'right';
      context.textBaseline = 'middle';
      for (const tick of scale.ticks) {
        context.beginPath();
        context.moveTo(left, Math.round(y(tick)) + 0.5);
        context.lineTo(width - right, Math.round(y(tick)) + 0.5);
        context.stroke();
        context.fillText(formatTick(tick), left - 6, y(tick));
      }
    }
    const colour = CHART_COLORS[recording.channels.indexOf(entry.setup.name) % CHART_COLORS.length] as string;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillStyle = colour;
    const title = `${entry.setup.label || entry.setup.name}${entry.setup.unit ? ` (${entry.setup.unit})` : ''}`;
    context.fillText(title, left + 6 + (overlay ? index * 150 : 0), top);
    context.strokeStyle = colour;
    context.lineWidth = 1.5;
    context.beginPath();
    let pen = false;
    // More readings than pixels: one vertical stroke from the least to the greatest per pixel.
    const dense = times.length - first > plotWidth * 3;
    let column = -1;
    let least = 0;
    let most = 0;
    for (let i = first; i < times.length; i++) {
      const value = (entry.raw[i] as number) * entry.setup.scale + entry.setup.offset;
      if (Number.isNaN(value)) {
        pen = false;
        continue;
      }
      const px = x(times[i] as number);
      const py = y(value);
      if (dense) {
        const here = Math.round(px);
        if (here !== column) {
          if (column >= 0) {
            context.lineTo(column, least);
            context.lineTo(column, most);
          }
          column = here;
          least = py;
          most = py;
          if (!pen) context.moveTo(here, py);
          pen = true;
        } else {
          least = Math.max(least, py);
          most = Math.min(most, py);
        }
      } else if (pen) context.lineTo(px, py);
      else {
        context.moveTo(px, py);
        pen = true;
      }
    }
    if (dense && column >= 0) {
      context.lineTo(column, least);
      context.lineTo(column, most);
    }
    context.stroke();
  });

  // The time axis: time since the recording began.
  const base = height - 22;
  context.strokeStyle = faint;
  context.fillStyle = ink;
  context.textAlign = 'center';
  context.textBaseline = 'top';
  const step = niceStep(span / 1000, Math.max(2, Math.floor(plotWidth / 90))) * 1000;
  const origin = recording.start;
  for (let tick = Math.ceil((begin - origin) / step) * step + origin; tick <= end; tick += step) {
    const px = Math.round(x(tick)) + 0.5;
    context.beginPath();
    context.moveTo(px, base);
    context.lineTo(px, base + 4);
    context.stroke();
    context.fillText(clock((tick - origin) / 1000), px, base + 6);
  }
  for (const marker of recording.markers) {
    if (marker.time < begin || marker.time > end) continue;
    const px = Math.round(x(marker.time)) + 0.5;
    context.strokeStyle = '#d0461f';
    context.setLineDash([4, 3]);
    context.beginPath();
    context.moveTo(px, 4);
    context.lineTo(px, base);
    context.stroke();
    context.setLineDash([]);
  }
}

function Component({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, readSettings, (value) => ({ ...value, setups: value.setups.map((s) => ({ ...s })) }) as unknown as Values);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [recordingOn, setRecordingOn] = useState(false);
  const [, setTick] = useState(0);
  const [note, setNote] = useState('');
  const [fileName, setFileName] = useState('readings');
  const support = serialSupport();

  const link = useRef<SerialLink | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const parser = useRef(new LineParser(settings.format));
  const splitter = useRef(new LineSplitter());
  const preview = useRef(new Recording());
  const kept = useRef<Recording | null>(null);
  const averager = useRef(new Averager(settings.interval));
  const on = useRef(false);
  const stats = useRef({ lines: 0, unread: 0, last: '', stamps: [] as number[] });
  const live = useRef(settings);
  live.current = settings;
  const canvas = useRef<HTMLCanvasElement>(null);

  const patch = (change: Partial<Settings>) => {
    // Kept current at once: several readings can arrive before the next drawing.
    live.current = { ...live.current, ...change };
    setSettings(live.current);
  };

  const reading = (time: number, values: [string, number][], units: Record<string, string>) => {
    // A channel seen for the first time gets a row in the table, with the unit the device sent.
    const known = live.current.setups;
    const fresh = values.filter(([name]) => !known.some((s) => s.name === name));
    if (fresh.length || values.some(([name]) => units[name] && known.find((s) => s.name === name)?.unit === '')) {
      patch({
        setups: [...known.map((s) => (s.unit === '' && units[s.name] ? { ...s, unit: units[s.name] as string } : s)), ...fresh.map(([name]) => defaultSetup(name, units[name] ?? ''))],
      });
    }
    if (preview.current.length >= PREVIEW_ROWS) {
      const old = preview.current;
      const next = new Recording(old.start);
      for (let row = PREVIEW_ROWS / 2; row < old.length; row++) {
        next.add(
          old.times[row] as number,
          old.channels.map((name): [string, number] => [name, old.column(name)[row] as number]).filter(([, value]) => !Number.isNaN(value)),
        );
      }
      preview.current = next;
    }
    preview.current.add(time, values);
    if (on.current && kept.current) {
      for (const row of averager.current.push(time, values)) {
        if (!kept.current.add(row.time, row.values)) {
          on.current = false;
          setRecordingOn(false);
          notify('The recording is full (2 million rows) and has stopped. Save it, then start a new one.', 'error');
          break;
        }
      }
    }
  };

  const feedLine = (line: string, time = Date.now()) => {
    const result = parser.current.parse(line);
    const s = stats.current;
    s.lines += 1;
    s.last = line;
    if (result.kind === 'values') {
      s.stamps.push(time);
      if (s.stamps.length > 50) s.stamps.shift();
      reading(time, result.values, result.units);
    } else if (result.kind === 'skip' && line.trim()) s.unread += 1;
  };

  const disconnect = async () => {
    for (const timer of timers.current) clearInterval(timer);
    timers.current = [];
    const open = link.current;
    link.current = null;
    setConnected(false);
    await open?.close().catch(() => undefined);
  };
  useEffect(() => () => void disconnect(), []);

  const connect = () =>
    attempt(async () => {
      parser.current = new LineParser(settings.format);
      splitter.current = new LineSplitter();
      stats.current = { lines: 0, unread: 0, last: '', stamps: [] };
      preview.current = new Recording();
      if (settings.source === 'demo') {
        const began = Date.now();
        timers.current.push(
          setInterval(() => {
            const now = Date.now();
            feedLine(
              demoReading((now - began) / 1000)
                .map(([name, value]) => `${name}=${value}${DEMO_UNITS[name] ?? ''}`)
                .join(', '),
              now,
            );
          }, 100),
        );
      } else {
        link.current = await openSerialLink(
          { port: settings.port, baud: settings.baud },
          {
            onData: (bytes) => {
              const now = Date.now();
              for (const line of splitter.current.feed(bytes)) feedLine(line, now);
            },
            onClosed: (reason) => {
              void disconnect();
              notify(reason, 'error');
            },
          },
        );
        const command = settings.poll.trim();
        if (command) {
          const send = () => void link.current?.write(new TextEncoder().encode(`${command.replace(/\\r/g, '\r').replace(/\\n/g, '\n')}${/\\[rn]$/.test(command) ? '' : '\n'}`)).catch(() => undefined);
          send();
          timers.current.push(setInterval(send, Math.max(100, settings.pollEvery * 1000)));
        }
      }
      // The picture and the figures are refreshed a few times a second, however fast readings arrive.
      timers.current.push(setInterval(() => setTick((n) => n + 1), 250));
      setConnected(true);
    });

  const record = () => {
    if (recordingOn) {
      const rest = averager.current.flush(Date.now());
      if (rest && kept.current) kept.current.add(rest.time, rest.values);
      on.current = false;
      setRecordingOn(false);
      return;
    }
    kept.current = new Recording(Date.now());
    averager.current = new Averager(settings.interval);
    on.current = true;
    setRecordingOn(true);
  };

  const shown = kept.current ?? preview.current;
  useEffect(() => {
    if (canvas.current) draw(canvas.current, shown, settings.setups, settings.window, settings.overlay);
  });

  useEffect(() => {
    if (support === 'desktop') void attempt(async () => setPorts(await serialPorts()));
  }, []);

  const table = () => {
    const recording = kept.current;
    if (!recording?.length) throw new Error('There is no recording to save yet. Press Record first.');
    return tableOf(recording, settings.setups);
  };
  const stem = fileName.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'readings';
  const saved = async (name: string, data: string | Uint8Array, mime: string) => {
    const result = await saveFile(name, data, mime);
    if (result.saved) notify(`Saved to ${result.location}`);
  };
  const saveSqlite = () =>
    attempt(async () => {
      const data = table();
      const initSqlJs = (await import('sql.js')).default as unknown as (config: object) => Promise<import('sql.js').SqlJsStatic>;
      const wasmUrl = (await import('sql.js/dist/sql-wasm-browser.wasm?url')).default;
      const SQL = await initSqlJs({ locateFile: () => wasmUrl });
      const db = new SQL.Database();
      try {
        db.run(sqliteSchema(data));
        db.run('BEGIN');
        const insert = db.prepare(`INSERT INTO readings VALUES (?, ?, ?${data.columns.map(() => ', ?').join('')}, ?)`);
        const zone = -new Date().getTimezoneOffset();
        const iso = (time: number) => new Date(time + zone * 60_000).toISOString().slice(0, 23);
        data.times.forEach((time, row) => {
          insert.run([time, iso(time), data.elapsed[row] as number, ...data.columns.map((c) => c.values[row] ?? null), data.notes[row] || null]);
        });
        insert.free();
        for (const column of data.columns) db.run('INSERT INTO channels VALUES (?, ?, ?, ?, ?, ?)', [column.id, column.label, column.unit, column.setup.name, column.setup.scale, column.setup.offset]);
        for (const marker of data.markers) db.run('INSERT INTO markers VALUES (?, ?, ?)', [marker.time, iso(marker.time), marker.text]);
        db.run('COMMIT');
        await saved(`${stem}.sqlite`, db.export(), 'application/vnd.sqlite3');
      } finally {
        db.close();
      }
    });
  const saveParquet = () =>
    attempt(async () => {
      const data = table();
      const { parquetWriteBuffer } = await import('hyparquet-writer');
      const columnData = [
        { name: 'time', data: data.times.map((time) => new Date(time)), type: 'TIMESTAMP' as const },
        { name: 'elapsed_s', data: data.elapsed, type: 'DOUBLE' as const },
        ...data.columns.map((column) => ({ name: column.id, data: column.values, type: 'DOUBLE' as const })),
        ...(data.notes.some(Boolean) ? [{ name: 'note', data: data.notes.map((text) => text || null), type: 'STRING' as const }] : []),
      ];
      await saved(`${stem}.parquet`, new Uint8Array(parquetWriteBuffer({ columnData })), 'application/vnd.apache.parquet');
    });

  const stamps = stats.current.stamps;
  const rate = stamps.length > 1 ? ((stamps.length - 1) * 1000) / Math.max(1, (stamps[stamps.length - 1] as number) - (stamps[0] as number)) : 0;
  const recording = kept.current;
  // From the settings as last changed, not as last drawn: two fields committed before the next render (a scale,
  // then an offset) must not undo each other.
  const setup = (name: string, change: Partial<ChannelSetup>) => patch({ setups: live.current.setups.map((s) => (s.name === name ? { ...s, ...change } : s)) });
  const figure = (value: number) => (Number.isNaN(value) ? '' : formatTick(Math.round(value * 1e6) / 1e6));

  return (
    <section class="tool dl" data-testid="tool" data-state={recordingOn ? 'recording' : recording?.length ? 'done' : 'idle'}>
      <div class="dl-bar">
        <label class="dl-field">
          <span class="control-label">Read from</span>
          <select class="input" value={settings.source} disabled={connected} onChange={(e) => patch({ source: e.currentTarget.value as 'demo' | 'serial' })} data-testid="dl-source">
            {support !== 'none' && <option value="serial">A serial or USB port</option>}
            <option value="demo">A made-up weather sensor (to try it out)</option>
          </select>
        </label>
        {settings.source === 'serial' && (
          <>
            {support === 'desktop' && (
              <label class="dl-field">
                <span class="control-label">
                  Port{' '}
                  <button type="button" class="link-button" onClick={() => attempt(async () => setPorts(await serialPorts()))}>
                    Look again
                  </button>
                </span>
                <select class="input" value={settings.port} disabled={connected} onChange={(e) => patch({ port: e.currentTarget.value })}>
                  <option value="">Choose…</option>
                  {ports.map((port) => (
                    <option key={port.name} value={port.name}>
                      {port.name}
                      {port.detail ? ` (${port.detail})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label class="dl-field">
              <span class="control-label">Speed (baud)</span>
              <select class="input" value={settings.baud} disabled={connected} onChange={(e) => patch({ baud: Number(e.currentTarget.value) })}>
                {BAUD_RATES.map((baud) => (
                  <option key={baud} value={baud}>
                    {baud}
                  </option>
                ))}
              </select>
            </label>
            <label class="dl-field">
              <span class="control-label">Ask the device (optional)</span>
              <input class="input" type="text" value={settings.poll} disabled={connected} placeholder="for example  MEAS?" onInput={(e) => patch({ poll: e.currentTarget.value })} spellcheck={false} />
            </label>
            <label class="dl-field dl-narrow">
              <span class="control-label">every (seconds)</span>
              <input
                class="input"
                type="number"
                min={0.1}
                step="any"
                value={settings.pollEvery}
                disabled={connected}
                onChange={(e) => patch({ pollEvery: Math.max(0.1, Number(e.currentTarget.value) || 1) })}
              />
            </label>
          </>
        )}
        <label class="dl-field">
          <span class="control-label">Lines look like</span>
          <select class="input" value={settings.format} disabled={connected} onChange={(e) => patch({ format: e.currentTarget.value as LineFormat })}>
            {FORMATS.map((format) => (
              <option key={format.id} value={format.id}>
                {format.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" class={`button${connected ? '' : ' button-primary'}`} onClick={() => (connected ? void disconnect() : void connect())} data-testid="dl-connect">
          {connected ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      <div class="dl-bar">
        <button type="button" class={`button${recordingOn ? ' dl-stop' : ' button-primary'}`} disabled={!connected && !recordingOn} onClick={record} data-testid="dl-record">
          <Icon name={recordingOn ? 'pause' : 'play'} size={14} /> {recordingOn ? 'Stop recording' : recording?.length ? 'Record again (starts afresh)' : 'Record'}
        </button>
        <label class="dl-field">
          <span class="control-label">Save</span>
          <select class="input" value={settings.interval} disabled={recordingOn} onChange={(e) => patch({ interval: Number(e.currentTarget.value) })}>
            {INTERVALS.map((interval) => (
              <option key={interval.ms} value={interval.ms}>
                {interval.label}
              </option>
            ))}
          </select>
        </label>
        <span class="dl-status" data-testid="dl-status" role="status">
          {recording
            ? `${recording.length.toLocaleString()} rows recorded in ${clock(((recording.times[recording.length - 1] ?? recording.start) - recording.start) / 1000)}`
            : connected
              ? 'Showing readings; nothing is recorded yet'
              : 'Not connected'}
          {connected && rate > 0 ? `, ${rate >= 10 ? Math.round(rate) : rate.toFixed(1)} readings a second` : ''}
          {stats.current.unread > 0 ? `, ${stats.current.unread.toLocaleString()} lines without numbers` : ''}
        </span>
      </div>

      <div class="dl-chart">
        <div class="dl-bar">
          <label class="dl-field">
            <span class="control-label">Show</span>
            <select class="input" value={settings.window} onChange={(e) => patch({ window: Number(e.currentTarget.value) })}>
              {WINDOWS.map((w) => (
                <option key={w.seconds} value={w.seconds}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <label class="dl-check">
            <input type="checkbox" checked={settings.overlay} onChange={(e) => patch({ overlay: e.currentTarget.checked })} />
            <span>All channels on one scale</span>
          </label>
          {recordingOn && (
            <>
              <label class="dl-field dl-grow">
                <span class="control-label">Note what happens (kept with its time)</span>
                <input class="input" type="text" value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="lamp switched on" data-testid="dl-marker" />
              </label>
              <button
                type="button"
                class="button button-small"
                disabled={!note.trim()}
                onClick={() => {
                  kept.current?.markers.push({ time: Date.now(), text: note.trim() });
                  setNote('');
                }}
                data-testid="dl-mark"
              >
                Add the note
              </button>
            </>
          )}
        </div>
        <canvas ref={canvas} class="dl-canvas" role="img" aria-label="The readings over time; the figures are in the table below" data-testid="dl-chart" />
      </div>

      <div class="dl-table-wrap">
        <table class="data-table dl-channels" data-testid="dl-channels">
          <thead>
            <tr>
              <th>Show</th>
              <th>From the device</th>
              <th>Name</th>
              <th>Unit</th>
              <th title="Shown value = reading × scale + offset">× scale</th>
              <th>+ offset</th>
              <th>Now</th>
              <th>Least</th>
              <th>Greatest</th>
              <th>Mean</th>
              <th>Spread (s.d.)</th>
            </tr>
          </thead>
          <tbody>
            {shown.channels.map((name, index) => {
              const s = settings.setups.find((entry) => entry.name === name) ?? defaultSetup(name);
              const summary = summarise(shown.column(name), s.scale, s.offset);
              return (
                <tr key={name}>
                  <td>
                    <input type="checkbox" checked={s.visible} onChange={(e) => setup(name, { visible: e.currentTarget.checked })} aria-label={`Show ${s.label || name}`} />
                  </td>
                  <td>
                    <span class="dl-swatch" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} /> {name}
                  </td>
                  <td>
                    <CommitInput class="input" type="text" value={s.label} aria-label={`Name for ${name}`} onCommit={(text) => setup(name, { label: text || name })} />
                  </td>
                  <td>
                    <CommitInput class="input dl-unit" type="text" value={s.unit} aria-label={`Unit of ${name}`} onCommit={(text) => setup(name, { unit: text })} />
                  </td>
                  <td>
                    <CommitInput
                      class="input dl-num"
                      type="number"
                      value={s.scale}
                      aria-label={`Scale for ${name}`}
                      onCommit={(text) => setup(name, { scale: text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : 1 })}
                    />
                  </td>
                  <td>
                    <CommitInput class="input dl-num" type="number" value={s.offset} aria-label={`Offset for ${name}`} onCommit={(text) => setup(name, { offset: Number(text) || 0 })} />
                  </td>
                  <td>
                    <strong>{figure(summary.last)}</strong>
                  </td>
                  <td>{figure(summary.min)}</td>
                  <td>{figure(summary.max)}</td>
                  <td>{figure(summary.mean)}</td>
                  <td>{figure(summary.sd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.channels.length && <p class="tone-muted">Channels appear here when the first reading arrives.</p>}
      </div>

      <div class="dl-bar">
        <label class="dl-field">
          <span class="control-label">File name</span>
          <input class="input" type="text" value={fileName} onInput={(e) => setFileName(e.currentTarget.value)} spellcheck={false} />
        </label>
        <button type="button" class="button" disabled={!recording?.length} onClick={() => attempt(async () => saved(`${stem}.csv`, toCsv(table()), 'text/csv'))} data-testid="dl-csv">
          <Icon name="save" size={14} /> CSV
        </button>
        <button type="button" class="button" disabled={!recording?.length} onClick={() => void saveSqlite()} data-testid="dl-sqlite">
          <Icon name="save" size={14} /> SQLite
        </button>
        <button type="button" class="button" disabled={!recording?.length} onClick={() => void saveParquet()} data-testid="dl-parquet">
          <Icon name="save" size={14} /> Parquet
        </button>
        <span class="tone-muted dl-raw" data-testid="dl-raw">
          {stats.current.last ? `Last line: ${stats.current.last.slice(0, 120)}` : ''}
        </span>
      </div>
      <p class="tone-muted dl-note">
        Every row carries the computer's time when the reading arrived (to the millisecond, with the time zone) and the seconds since recording began. The recording stays in memory until you save it:
        save long runs from time to time. Averaged rows hold the mean of the readings in each interval.
      </p>
    </section>
  );
}

export default defineCustomTool(Component);
