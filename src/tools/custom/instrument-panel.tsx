/**
 * Instrument Panel: dials, bars, read-outs, lamps and trends for the values
 * a board prints on its serial port, and buttons, switches and sliders that
 * send it commands.  A panel is laid out once and saved; a pretend device
 * lets it be tried without a board.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LineParser } from '../../lib/datalog';
import {
  commandFor,
  DemoDevice,
  fraction,
  isControl,
  newWidget,
  PANEL_SKETCH,
  type PanelDoc,
  panelFile,
  Readings,
  readPanel,
  samplePanel,
  trendPath,
  valueText,
  WIDGET_NAMES,
  type Widget,
  type WidgetKind,
} from '../../lib/panel';
import { pickFile, readTextFile, saveFile } from '../../platform';
import { openSerialLink, type PortInfo, type SerialLink, serialPorts, serialSupport } from '../../platform/serial';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { CommitInput, clamp, Sure, usePersistentState } from './_shared';

const DEMO = 'demo';

/**
 * What arrives from the device, and who wants to hear of it.  Each widget listens for itself,
 * so that a reading redraws the widgets and nothing else: a field being typed in is left alone.
 */
class Hub {
  readings = new Readings();
  log: string[] = [];
  private readonly listeners = new Set<() => void>();

  listen(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  tell(): void {
    for (const listener of this.listeners) listener();
  }

  note(line: string): void {
    this.log = [...this.log.slice(-11), line];
  }
}

/** Redraws the component whenever the hub has news. */
function useHub(hub: Hub): void {
  const [, redraw] = useState(0);
  useEffect(() => hub.listen(() => redraw((n) => n + 1)), [hub]);
}

/* ------------------------------------------------------- widgets -- */

/** A point on a dial: 0 is the start of its sweep at the lower left, 1 its end at the lower right. */
function onDial(cx: number, cy: number, radius: number, share: number): [number, number] {
  const angle = ((-210 + share * 240) * Math.PI) / 180;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function dialArc(cx: number, cy: number, radius: number, from: number, to: number): string {
  const [x1, y1] = onDial(cx, cy, radius, from);
  const [x2, y2] = onDial(cx, cy, radius, to);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${radius} ${radius} 0 ${(to - from) * 240 > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function Display({ widget, hub }: { widget: Widget; hub: Hub }) {
  useHub(hub);
  const value = hub.readings.latest.get(widget.channel);
  const history = hub.readings.history(widget.channel);
  const known = value !== undefined && Number.isFinite(value);
  const share = known ? fraction(widget, value) : 0;
  const limited = !Number.isNaN(widget.limit);
  const over = known && limited && value >= widget.limit;
  const text = valueText(widget, value);
  const label = `${widget.title}: ${known ? text : 'no value yet'}${over && widget.kind !== 'lamp' ? ', at or over its limit' : ''}`;
  if (widget.kind === 'gauge') {
    const [nx, ny] = onDial(100, 96, 62, share);
    return (
      <svg class="ip-dial" viewBox="0 0 200 150" role="img" aria-label={`${label}, on a dial from ${widget.min} to ${widget.max}`}>
        <path class="ip-track" d={dialArc(100, 96, 74, 0, 1)} />
        {limited && widget.limit > widget.min && widget.limit < widget.max && <path class="ip-limit" d={dialArc(100, 96, 74, fraction(widget, widget.limit), 1)} />}
        {known && share > 0 && <path class={`ip-fill${over ? ' is-over' : ''}`} d={dialArc(100, 96, 74, 0, share)} />}
        {known && <line class="ip-needle" x1={100} y1={96} x2={nx} y2={ny} />}
        <circle class="ip-hub" cx={100} cy={96} r={5} />
        <text class="ip-value" x={100} y={134} text-anchor="middle">
          {text}
        </text>
        <text class="ip-end" x={34} y={146} text-anchor="middle">
          {widget.min}
        </text>
        <text class="ip-end" x={166} y={146} text-anchor="middle">
          {widget.max}
        </text>
      </svg>
    );
  }
  if (widget.kind === 'bar') {
    return (
      <div class="ip-meter" role="img" aria-label={`${label}, on a bar from ${widget.min} to ${widget.max}`}>
        <span class="ip-big">{text}</span>
        <span class="ip-bar-track">
          <span class={`ip-bar-fill${over ? ' is-over' : ''}`} style={{ width: `${share * 100}%` }} />
          {limited && widget.limit > widget.min && widget.limit < widget.max && <span class="ip-bar-limit" style={{ left: `${fraction(widget, widget.limit) * 100}%` }} />}
        </span>
        <span class="ip-ends">
          <span>{widget.min}</span>
          <span>{widget.max}</span>
        </span>
      </div>
    );
  }
  if (widget.kind === 'lamp') {
    const lit = known && value >= (limited ? widget.limit : 1);
    return (
      <div class="ip-lamp" role="img" aria-label={`${widget.title}: ${known ? (lit ? 'on' : 'off') : 'no value yet'}`}>
        <span class={`ip-bulb${lit ? ' is-lit' : ''}`} aria-hidden="true" />
        <span class="ip-big">{known ? (lit ? 'On' : 'Off') : '—'}</span>
      </div>
    );
  }
  if (widget.kind === 'trend') {
    const { path, low, high } = trendPath(history, 200, 60);
    return (
      <div class="ip-trend" role="img" aria-label={`${label}; over the last ${history.length} readings between ${low.toFixed(widget.decimals)} and ${high.toFixed(widget.decimals)}`}>
        <svg viewBox="0 -2 200 64" preserveAspectRatio="none" aria-hidden="true">
          {path && <path class="ip-trend-line" d={path} />}
        </svg>
        <span class="ip-ends">
          <span>{history.length ? `${low.toFixed(widget.decimals)} to ${high.toFixed(widget.decimals)}` : 'waiting for readings'}</span>
          <span class="ip-now">{text}</span>
        </span>
      </div>
    );
  }
  return (
    <div class="ip-number" role="img" aria-label={label}>
      <span class={`ip-huge${over ? ' is-over' : ''}`}>{known ? value.toFixed(widget.decimals) : '—'}</span>
      {widget.unit && <span class="ip-unit">{widget.unit}</span>}
      {over && <span class="ip-over-note">at or over {widget.limit}</span>}
    </div>
  );
}

function Control({ widget, send, live }: { widget: Widget; send: (text: string) => void; live: boolean }) {
  const [on, setOn] = useState(false);
  const [level, setLevel] = useState(widget.min);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  if (widget.kind === 'button')
    return (
      <button type="button" class="button ip-push" disabled={!live} onClick={() => send(commandFor(widget, true))}>
        {widget.title || 'Send'}
      </button>
    );
  if (widget.kind === 'switch')
    return (
      <label class="ip-switch">
        <input
          type="checkbox"
          role="switch"
          aria-checked={on}
          aria-label={widget.title || 'Switch'}
          checked={on}
          disabled={!live}
          onChange={(e) => {
            setOn(e.currentTarget.checked);
            send(commandFor(widget, e.currentTarget.checked));
          }}
        />
        <span>{on ? 'On' : 'Off'}</span>
      </label>
    );
  return (
    <label class="ip-slider">
      <input
        type="range"
        min={widget.min}
        max={widget.max}
        step={widget.step}
        value={level}
        disabled={!live}
        aria-label={widget.title || 'Slider'}
        onInput={(e) => {
          const next = Number(e.currentTarget.value);
          setLevel(next);
          // A slider being dragged sends its value when it rests a moment, not at every step.
          clearTimeout(timer.current);
          timer.current = setTimeout(() => send(commandFor(widget, next)), 120);
        }}
      />
      <span class="ip-big">{valueText(widget, level)}</span>
    </label>
  );
}

/* ----------------------------------------------------- the editor -- */

function Editor({ widget, names, change, remove, move }: { widget: Widget; names: readonly string[]; change: (patch: Partial<Widget>) => void; remove: () => void; move: (by: number) => void }) {
  const control = isControl(widget.kind);
  const number = (label: string, key: 'min' | 'max' | 'limit' | 'decimals' | 'step', step = 1) => (
    <label class="control">
      <span class="control-label">{label}</span>
      <CommitInput
        class="input input-number"
        type="number"
        step={step}
        value={Number.isNaN(widget[key]) ? '' : widget[key]}
        onCommit={(typed) => {
          const text = typed.trim();
          change({ [key]: text === '' ? Number.NaN : Number(text) });
        }}
      />
    </label>
  );
  return (
    <div class="ip-edit">
      <div class="control-row">
        <label class="control">
          <span class="control-label">Title</span>
          <input class="input" type="text" value={widget.title} maxLength={60} onInput={(e) => change({ title: e.currentTarget.value })} />
        </label>
        <label class="control">
          <span class="control-label">Kind</span>
          <select class="select" value={widget.kind} onChange={(e) => change({ kind: e.currentTarget.value as WidgetKind })}>
            {(Object.keys(WIDGET_NAMES) as WidgetKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {WIDGET_NAMES[kind]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!control && (
        <label class="control">
          <span class="control-label">Value shown (its name as the device sends it)</span>
          <input class="input" type="text" value={widget.channel} maxLength={60} list={`ip-names-${widget.id}`} onInput={(e) => change({ channel: e.currentTarget.value.trim() })} />
          <datalist id={`ip-names-${widget.id}`}>
            {names.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
      )}
      {widget.kind !== 'button' && widget.kind !== 'switch' && widget.kind !== 'lamp' && (
        <div class="control-row">
          {widget.kind !== 'number' && widget.kind !== 'trend' && number('From', 'min')}
          {widget.kind !== 'number' && widget.kind !== 'trend' && number('To', 'max')}
          {widget.kind === 'slider' ? number('Step', 'step') : number('Decimals', 'decimals')}
          <label class="control">
            <span class="control-label">Unit</span>
            <input class="input input-number" type="text" value={widget.unit} maxLength={12} onInput={(e) => change({ unit: e.currentTarget.value })} />
          </label>
        </div>
      )}
      {!control && widget.kind !== 'trend' && <div class="control-row">{number(widget.kind === 'lamp' ? 'Lit from' : 'Limit (blank for none)', 'limit')}</div>}
      {control && (
        <label class="control">
          <span class="control-label">{widget.kind === 'switch' ? 'Sends when turned on' : widget.kind === 'slider' ? 'Sends ({value} is the slider’s value)' : 'Sends'}</span>
          <input class="input" type="text" value={widget.command} maxLength={200} onInput={(e) => change({ command: e.currentTarget.value })} />
        </label>
      )}
      {widget.kind === 'switch' && (
        <label class="control">
          <span class="control-label">Sends when turned off</span>
          <input class="input" type="text" value={widget.commandOff} maxLength={200} onInput={(e) => change({ commandOff: e.currentTarget.value })} />
        </label>
      )}
      <div class="button-row">
        <button type="button" class="icon-button" aria-label={`Move ${widget.title || 'this'} earlier`} onClick={() => move(-1)}>
          <Icon name="left" size={15} />
        </button>
        <button type="button" class="icon-button" aria-label={`Move ${widget.title || 'this'} later`} onClick={() => move(1)}>
          <Icon name="right" size={15} />
        </button>
        <button type="button" class="button button-small button-quiet" onClick={remove}>
          <Icon name="trash" size={14} /> Remove
        </button>
      </div>
    </div>
  );
}

function Messages({ hub, live }: { hub: Hub; live: boolean }) {
  useHub(hub);
  return (
    <div class="pp-panel ip-log">
      <span class="pane-title">Messages</span>
      <p class="tone-muted" data-testid="ip-status">
        {live ? `${hub.readings.count.toLocaleString()} lines of readings so far` : 'Not connected.'}
      </p>
      {hub.log.length > 0 && (
        <pre class="ip-lines" data-testid="ip-log">
          {hub.log.join('\n')}
        </pre>
      )}
    </div>
  );
}

/* --------------------------------------------------------- the tool -- */

interface Stored {
  readonly doc: PanelDoc;
  readonly port: string;
}

const read = (v: Values | undefined): Stored => ({ doc: readPanel(v?.doc) ?? samplePanel(), port: typeof v?.port === 'string' ? v.port : DEMO });

function InstrumentPanel({ toolId }: { toolId: string }) {
  const [stored, setStored] = usePersistentState<Stored>(toolId, read, (s): Values => ({ doc: JSON.parse(panelFile(s.doc)), port: s.port }));
  const { doc, port } = stored;
  const setDoc = (next: PanelDoc) => setStored((s) => ({ ...s, doc: next }));
  const support = serialSupport();
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [live, setLive] = useState(false);
  const [editing, setEditing] = useState(false);
  const hub = useRef(new Hub()).current;
  // The names the device sends: the only thing about its readings that the whole panel needs to know.
  const [names, setNames] = useState<readonly string[]>([]);
  const link = useRef<{ send: (text: string) => void; close: () => void } | null>(null);

  useEffect(() => {
    if (support === 'desktop') void serialPorts().then(setPorts, () => undefined);
    return () => link.current?.close();
  }, [support]);

  /** Lines from the device: readings update the widgets, anything else is only logged. */
  const takeLines = (lines: readonly string[], parser: LineParser) => {
    const before = hub.readings.latest.size;
    for (const line of lines) {
      const result = parser.parse(line);
      if (result.kind === 'values') hub.readings.add(result.values);
      else if (line.trim()) hub.note(`← ${line.trim().slice(0, 120)}`);
    }
    if (hub.readings.latest.size !== before) setNames(hub.readings.names);
    hub.tell();
  };

  const disconnect = () => {
    link.current?.close();
    link.current = null;
    setLive(false);
  };

  const connect = () =>
    attempt(async () => {
      disconnect();
      hub.readings = new Readings();
      hub.log = [];
      setNames([]);
      const parser = new LineParser('auto');
      if (port === DEMO) {
        const device = new DemoDevice();
        const timer = setInterval(() => takeLines([device.line(0.25)], parser), 250);
        link.current = {
          send: (text) => {
            const answer = device.receive(text);
            if (answer) takeLines([answer], parser);
          },
          close: () => clearInterval(timer),
        };
        takeLines([device.line(0)], parser);
      } else {
        let rest = '';
        const decoder = new TextDecoder();
        const opened: SerialLink = await openSerialLink(
          { port, baud: doc.baud },
          {
            onData: (bytes) => {
              const parts = (rest + decoder.decode(bytes, { stream: true })).split(/\r?\n/);
              rest = (parts.pop() ?? '').slice(-2000);
              if (parts.length) takeLines(parts, parser);
            },
            onClosed: (reason) => {
              link.current = null;
              setLive(false);
              notify(reason, 'error');
            },
          },
        );
        link.current = { send: (text) => void opened.write(new TextEncoder().encode(`${text}\n`)).catch((error) => notify(String(error), 'error')), close: () => void opened.close() };
      }
      setLive(true);
    });

  const send = (text: string) => {
    if (!link.current || !text) return;
    hub.note(`→ ${text}`);
    hub.tell();
    link.current.send(text);
  };

  const change = (id: string, patch: Partial<Widget>) => setDoc({ ...doc, widgets: doc.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const move = (id: string, by: number) => {
    const at = doc.widgets.findIndex((w) => w.id === id);
    const to = clamp(at + by, 0, doc.widgets.length - 1);
    if (at < 0 || at === to) return;
    const list = [...doc.widgets];
    const [taken] = list.splice(at, 1);
    list.splice(to, 0, taken as Widget);
    setDoc({ ...doc, widgets: list });
  };
  // Values the device sends that no widget shows yet.
  const unused = useMemo(() => names.filter((name) => !doc.widgets.some((w) => !isControl(w.kind) && w.channel === name)), [names, doc.widgets]);

  const openFile = () =>
    attempt(async () => {
      const file = await pickFile('.json,application/json');
      if (!file) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readTextFile(file));
      } catch {
        throw new Error('This file is not a panel: it is not JSON.');
      }
      const next = readPanel(parsed);
      if (!next) throw new Error('This file is not a Benchtop instrument panel.');
      setDoc(next);
      notify(`Opened ${next.title}.`);
    });

  return (
    <div data-testid="tool" class="tool ip" data-state={live ? 'running' : 'idle'}>
      <div class="control-row ip-bar">
        <label class="control ip-title">
          <span class="control-label">Panel</span>
          <input class="input" type="text" value={doc.title} maxLength={80} onInput={(e) => setDoc({ ...doc, title: e.currentTarget.value })} data-testid="ip-title" />
        </label>
        <label class="control">
          <span class="control-label">Device</span>
          <select class="select" value={port} disabled={live} onChange={(e) => setStored((s) => ({ ...s, port: e.currentTarget.value }))} data-testid="ip-port">
            <option value={DEMO}>Pretend device (a climate box)</option>
            {support === 'desktop' &&
              ports.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.detail ? ` (${p.detail})` : ''}
                </option>
              ))}
            {support === 'web' && <option value="web">A serial port (the browser asks which)</option>}
            {port !== DEMO && port !== 'web' && !ports.some((p) => p.name === port) && <option value={port}>{port} (not connected)</option>}
          </select>
        </label>
        {port !== DEMO && (
          <label class="control">
            <span class="control-label">Speed (baud)</span>
            <select class="select" value={doc.baud} disabled={live} onChange={(e) => setDoc({ ...doc, baud: Number(e.currentTarget.value) })}>
              {[9600, 19200, 38400, 57600, 115200, 230400, 250000, 500000, 1000000].map((baud) => (
                <option key={baud} value={baud}>
                  {baud}
                </option>
              ))}
            </select>
          </label>
        )}
        {live ? (
          <button type="button" class="button button-small" onClick={disconnect} data-testid="ip-disconnect">
            <Icon name="pause" size={14} /> Disconnect
          </button>
        ) : (
          <button type="button" class="button button-small button-primary" onClick={connect} data-testid="ip-connect">
            <Icon name="play" size={14} /> Connect
          </button>
        )}
        <button type="button" class="button button-small" aria-pressed={editing} onClick={() => setEditing(!editing)} data-testid="ip-edit">
          <Icon name="settings" size={14} /> {editing ? 'Done' : 'Edit the panel'}
        </button>
        <button type="button" class="button button-small button-quiet" onClick={openFile} data-testid="ip-open">
          <Icon name="open" size={14} /> Open
        </button>
        <button
          type="button"
          class="button button-small button-quiet"
          onClick={() =>
            attempt(async () => void (await saveFile(`${doc.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'panel'}.panel.json`, new TextEncoder().encode(panelFile(doc)), 'application/json')))
          }
          data-testid="ip-save"
        >
          <Icon name="save" size={14} /> Save
        </button>
      </div>
      {support === 'none' && port !== DEMO && <p class="control-help">A real device needs the Benchtop desktop app, or a Chromium browser (Chrome, Edge).</p>}

      {doc.widgets.length ? (
        <div class="ip-grid" data-testid="ip-grid">
          {doc.widgets.map((widget) => (
            <section key={widget.id} class={`ip-card ip-${widget.kind}-card`} data-testid="ip-widget" data-kind={widget.kind}>
              {widget.kind !== 'button' && <h3 class="ip-name">{widget.title || WIDGET_NAMES[widget.kind]}</h3>}
              {isControl(widget.kind) ? <Control widget={widget} send={send} live={live} /> : <Display widget={widget} hub={hub} />}
              {editing && (
                <Editor
                  widget={widget}
                  names={names}
                  change={(patch) => change(widget.id, patch)}
                  remove={() => setDoc({ ...doc, widgets: doc.widgets.filter((w) => w.id !== widget.id) })}
                  move={(by) => move(widget.id, by)}
                />
              )}
            </section>
          ))}
        </div>
      ) : (
        <p class="pp-empty">This panel is empty. Edit it to add dials, read-outs and controls, or load the sample.</p>
      )}

      {editing && (
        <div class="pp-panel ip-add" data-testid="ip-add">
          <span class="pane-title">Add to the panel</span>
          <div class="button-row">
            {(Object.keys(WIDGET_NAMES) as WidgetKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                class="button button-small"
                onClick={() => setDoc({ ...doc, widgets: [...doc.widgets, newWidget(kind, isControl(kind) ? '' : (unused[0] ?? ''))].slice(0, 60) })}
                data-testid={`ip-add-${kind}`}
              >
                <Icon name="plus" size={14} /> {WIDGET_NAMES[kind]}
              </button>
            ))}
          </div>
          {unused.length > 0 && <p class="control-help">The device also sends: {unused.join(', ')}.</p>}
          <div class="button-row">
            <Sure class="button button-small button-quiet" sure="Replace this panel with the sample?" onConfirm={() => setDoc(samplePanel())} testId="ip-sample">
              Load the sample panel
            </Sure>
            <Sure class="button button-small button-quiet" sure="Remove every widget?" onConfirm={() => setDoc({ ...doc, title: 'Panel', widgets: [] })} testId="ip-clear">
              Start an empty panel
            </Sure>
          </div>
        </div>
      )}

      <div class="ip-foot">
        <Messages hub={hub} live={live} />
        <details class="pp-panel ip-help">
          <summary>What the device should send</summary>
          <p>
            A line of text for each set of readings, with names: <code>temp:23.4,humidity:51</code> or <code>temp=23.4 humidity=51</code>, JSON such as <code>{'{"temp":23.4}'}</code>, or bare numbers
            (<code>23.4,51</code>, which get the names ch1, ch2). Controls send a line of text ending in a new line.
          </p>
          <div class="button-row">
            <button
              type="button"
              class="button button-small"
              onClick={() => attempt(async () => void (await saveFile('panel-example.ino', new TextEncoder().encode(PANEL_SKETCH), 'text/plain')))}
              data-testid="ip-sketch"
            >
              <Icon name="save" size={14} /> An example sketch for Arduino (.ino)
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}

export default defineCustomTool(InstrumentPanel);
