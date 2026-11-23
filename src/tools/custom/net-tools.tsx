/**
 * Mock API Server (with a webhook catcher), WebSocket and SSE Client, and
 * gRPC Client.  The servers and connections run in the desktop app.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { routesFromOpenApi } from '../../lib/openapi-mock';
import { copyText, isDesktop } from '../../platform';
import {
  type GrpcDescribed,
  type GrpcResult,
  type GrpcTarget,
  grpcCall,
  grpcCompile,
  grpcReflect,
  type MockRoute,
  onServerRequest,
  onWsEvent,
  type ServeRequest,
  type ServeStarted,
  sseClose,
  sseConnect,
  startServer,
  stopServer,
  type WsEvent,
  wsClose,
  wsConnect,
  wsSend,
} from '../../platform/devnet';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { MultiDrop } from './_files';
import { Segmented, usePersistentState } from './_shared';

const DesktopNote = ({ what }: { what: string }) => (isDesktop ? null : <p class="recipe-error">{what} runs in the desktop app; in a browser it cannot open network connections.</p>);
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { hour12: false }) + `.${String(ms % 1000).padStart(3, '0')}`;

function HeaderRows({ rows, onChange, label }: { rows: readonly (readonly [string, string])[]; onChange: (rows: [string, string][]) => void; label: string }) {
  const list: [string, string][] = rows.length ? rows.map(([k, v]) => [k, v]) : [['', '']];
  const set = (i: number, k: 0 | 1, v: string) => {
    const next = list.map((r) => [...r] as [string, string]);
    (next[i] as [string, string])[k] = v;
    if (i === next.length - 1 && v) next.push(['', '']);
    onChange(next.filter(([a, b], j) => a || b || j === next.length - 1));
  };
  return (
    <div class="ng-headers" role="group" aria-label={label}>
      {list.map(([k, v], i) => (
        <div key={i} class="ng-header-row">
          <input class="input" placeholder="Name" aria-label={`${label} ${i + 1} name`} value={k} onInput={(e) => set(i, 0, e.currentTarget.value)} />
          <input class="input" placeholder="Value" aria-label={`${label} ${i + 1} value`} value={v} onInput={(e) => set(i, 1, e.currentTarget.value)} />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- Mock API Server -- */

const SAMPLE_ROUTES: MockRoute[] = [
  {
    method: 'GET',
    path: '/api/shows',
    status: 200,
    headers: [],
    delayMs: 0,
    body: '[\n  { "id": 1, "title": "Journey to the Stars", "time": "11:30", "seatsLeft": 42 },\n  { "id": 2, "title": "Living Planet", "time": "14:00", "seatsLeft": 8 }\n]',
  },
  { method: 'GET', path: '/api/shows/:id', status: 200, headers: [], delayMs: 0, body: '{ "id": {{params.id}}, "title": "Show {{params.id}}", "checkedAt": "{{now}}" }' },
  {
    method: 'POST',
    path: '/api/bookings',
    status: 201,
    headers: [['Location', '/api/bookings/{{uuid}}']],
    delayMs: 300,
    body: '{ "booking": "{{uuid}}", "show": {{body.show}}, "seats": {{body.seats}} }',
  },
  { method: 'ANY', path: '/api/payments/*', status: 503, headers: [], delayMs: 0, body: '{ "error": "Payment gateway is down for maintenance" }' },
];

interface MockState {
  readonly routes: readonly MockRoute[];
  readonly port: number;
  readonly lan: boolean;
  readonly cors: boolean;
  readonly mode: 'mock' | 'webhook';
  readonly reply: string;
  readonly replyStatus: number;
}

const readMock = (v: Values | undefined): MockState => {
  let routes = SAMPLE_ROUTES;
  if (typeof v?.routes === 'string') {
    try {
      const parsed = JSON.parse(v.routes) as MockRoute[];
      if (Array.isArray(parsed)) routes = parsed;
    } catch {
      // keep the sample
    }
  }
  return {
    routes,
    port: typeof v?.port === 'number' ? v.port : 3001,
    lan: v?.lan === true,
    cors: v?.cors !== false,
    mode: v?.mode === 'webhook' ? 'webhook' : 'mock',
    reply: typeof v?.reply === 'string' ? v.reply : '{ "received": true }',
    replyStatus: typeof v?.replyStatus === 'number' ? v.replyStatus : 200,
  };
};
const writeMock = (s: MockState): Values => ({ ...s, routes: JSON.stringify(s.routes) });

function MockServer({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readMock, writeMock);
  const [running, setRunning] = useState<ServeStarted | null>(null);
  const [log, setLog] = useState<ServeRequest[]>([]);
  const [open, setOpen] = useState(0);
  const [picked, setPicked] = useState<ServeRequest | null>(null);
  const id = `mock-${toolId}`;
  const set = <K extends keyof MockState>(k: K, v: MockState[K]) => setState((s) => ({ ...s, [k]: v }));
  const setRoute = (i: number, patch: Partial<MockRoute>) =>
    set(
      'routes',
      state.routes.map((r, k) => (k === i ? { ...r, ...patch } : r)),
    );

  useEffect(() => {
    const off = onServerRequest((r) => {
      if (r.id === id) setLog((l) => [r, ...l].slice(0, 500));
    });
    return () => {
      void off.then((stop) => stop());
      void stopServer(id);
    };
  }, []);

  const start = () =>
    attempt(async () => {
      const started = await startServer(id, {
        kind: state.mode,
        lan: state.lan,
        port: state.port,
        cors: state.cors,
        routes: state.mode === 'webhook' ? [{ method: 'ANY', path: '*', status: state.replyStatus, headers: [], body: state.reply, delayMs: 0 }] : state.routes,
      });
      setRunning(started);
      notify(`Listening on ${started.urls[0]}`);
    });
  const stop = () =>
    attempt(async () => {
      await stopServer(id);
      setRunning(null);
    });
  // Changes to the routes take effect at once when the server is running.
  useEffect(() => {
    if (running) void start();
  }, [state.routes, state.reply, state.replyStatus]);

  const route = state.routes[open];

  return (
    <section class="tool ng-tool" data-testid="tool" data-state={running ? 'done' : 'idle'}>
      <DesktopNote what="The mock server" />
      <div class="button-row">
        <Segmented
          label="Mode"
          value={state.mode}
          onChange={(m) => set('mode', m)}
          choices={[
            { value: 'mock', label: 'Mock an API' },
            { value: 'webhook', label: 'Catch webhooks' },
          ]}
        />
        <label class="control control-inline">
          <span class="control-label">Port</span>
          <input class="input input-narrow" type="number" min={0} max={65535} value={state.port} onInput={(e) => set('port', Math.min(65535, Math.max(0, Number(e.currentTarget.value) || 0)))} />
        </label>
        <label class="check">
          <input type="checkbox" checked={state.cors} onChange={(e) => set('cors', e.currentTarget.checked)} /> Allow any website (CORS)
        </label>
        <label class="check">
          <input type="checkbox" checked={state.lan} onChange={(e) => set('lan', e.currentTarget.checked)} /> Reachable from other devices on the network
        </label>
        {running ? (
          <button type="button" class="button button-danger" onClick={stop} data-testid="mock-stop">
            Stop
          </button>
        ) : (
          <button type="button" class="button button-primary" disabled={!isDesktop} onClick={start} data-testid="mock-start">
            <Icon name="play" size={14} /> Start
          </button>
        )}
      </div>
      {running && (
        <p class="ng-running">
          Listening on{' '}
          {running.urls.map((u) => (
            <code key={u} class="ng-url">
              {u}
            </code>
          ))}{' '}
          <button
            type="button"
            class="button button-small button-quiet"
            onClick={() =>
              attempt(async () => {
                await copyText(running.urls[0] ?? '');
                notify('Address copied');
              })
            }
          >
            <Icon name="copy" size={12} /> Copy
          </button>
        </p>
      )}
      {state.mode === 'mock' ? (
        <div class="ng-mock">
          <aside class="ng-routes">
            <div class="button-row">
              <button
                type="button"
                class="button button-small"
                onClick={() => {
                  set('routes', [...state.routes, { method: 'GET', path: '/api/new', status: 200, headers: [], body: '{ }', delayMs: 0 }]);
                  setOpen(state.routes.length);
                }}
              >
                + Route
              </button>
              <MultiDrop
                icon="file"
                compact
                accept=".json,.yaml,.yml"
                title="From OpenAPI"
                onFiles={(f) =>
                  f[0] &&
                  void attempt(async () => {
                    const routes = routesFromOpenApi(await (f[0] as File).text());
                    set('routes', routes);
                    setOpen(0);
                    notify(`${routes.length} routes made from the OpenAPI document`);
                  })
                }
              />
            </div>
            <ul class="ng-route-list" data-testid="mock-routes">
              {state.routes.map((r, i) => (
                <li key={`${i}-${r.method}-${r.path}`}>
                  <button type="button" class={`ng-route${i === open ? ' is-active' : ''}`} aria-pressed={i === open} onClick={() => setOpen(i)}>
                    <span class={`ng-method ng-${r.method.toLowerCase()}`}>{r.method}</span> {r.path} <span class="tone-muted">{r.status}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p class="control-help">
              Routes are tried from the top. <code>:name</code> matches one part of the path, <code>*</code> the rest.
            </p>
          </aside>
          {route && (
            <div class="ng-route-edit">
              <div class="ng-route-line">
                <select class="select" aria-label="Method" value={route.method} onChange={(e) => setRoute(open, { method: e.currentTarget.value })}>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <input class="input ng-path" aria-label="Path" value={route.path} onInput={(e) => setRoute(open, { path: e.currentTarget.value })} />
                <input class="input input-narrow" type="number" aria-label="Status" value={route.status} onInput={(e) => setRoute(open, { status: Number(e.currentTarget.value) || 200 })} />
                <input
                  class="input input-narrow"
                  type="number"
                  min={0}
                  aria-label="Delay in milliseconds"
                  title="Delay (ms)"
                  value={route.delayMs}
                  onInput={(e) => setRoute(open, { delayMs: Math.max(0, Number(e.currentTarget.value) || 0) })}
                />
                <button
                  type="button"
                  class="icon-button"
                  aria-label="Delete route"
                  onClick={() => {
                    set(
                      'routes',
                      state.routes.filter((_, k) => k !== open),
                    );
                    setOpen(Math.max(0, open - 1));
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <div class="pane ng-body">
                <div class="pane-header">
                  <span class="pane-title">Response body</span>
                  <span class="pane-meta">{'{{params.id}} {{query.page}} {{body.field}} {{headers.x-name}} {{now}} {{uuid}} {{random:1:100}}'}</span>
                </div>
                <div class="pane-body">
                  <CodeEditor value={route.body} onChange={(body) => setRoute(open, { body })} language="json" label="Response body" />
                </div>
              </div>
              <span class="control-label">Response headers</span>
              <HeaderRows label="Response header" rows={route.headers} onChange={(headers) => setRoute(open, { headers })} />
            </div>
          )}
        </div>
      ) : (
        <div class="ng-webhook">
          <p class="control-help">Point a service's webhook at the address above (with "Reachable from other devices" on, or through a tunnel). Every request it sends is shown in full below.</p>
          <div class="button-row">
            <label class="control control-inline">
              <span class="control-label">Answer with status</span>
              <input class="input input-narrow" type="number" value={state.replyStatus} onInput={(e) => set('replyStatus', Number(e.currentTarget.value) || 200)} />
            </label>
            <label class="control ng-reply">
              <span class="control-label">and body</span>
              <input class="input" value={state.reply} onInput={(e) => set('reply', e.currentTarget.value)} />
            </label>
          </div>
        </div>
      )}
      <div class="ng-log-wrap">
        <div class="button-row">
          <strong>Requests</strong>
          <span class="tone-muted">{log.length}</span>
          <button
            type="button"
            class="button button-small button-quiet"
            onClick={() => {
              setLog([]);
              setPicked(null);
            }}
          >
            Clear
          </button>
        </div>
        <div class="ng-log" {...scrollRegion('Requests')} data-testid="mock-log">
          {log.length === 0 && <p class="tone-muted">Requests appear here as they arrive.</p>}
          {log.map((r, i) => (
            <button key={`${r.path}-${i}`} type="button" class={`ng-log-row${picked === r ? ' is-active' : ''}`} onClick={() => setPicked(r)}>
              <span class={`ng-method ng-${r.method.toLowerCase()}`}>{r.method}</span>
              <span class="ng-log-path">{r.path}</span>
              <span class={r.status >= 400 ? 'ng-bad' : 'ng-good'}>{r.status}</span>
              <span class="tone-muted">{r.ms} ms</span>
              <span class="tone-muted">{r.from}</span>
            </button>
          ))}
        </div>
        {picked?.headers && (
          <div class="ng-detail" data-testid="mock-detail">
            <table class="data-table">
              <tbody>
                {picked.headers.map(([k, v]) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <pre>{prettyJson(picked.body ?? '')}</pre>
          </div>
        )}
      </div>
    </section>
  );
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/* --------------------------------------------------- WebSocket and SSE -- */

interface WsState {
  readonly url: string;
  readonly kind: 'ws' | 'sse';
  readonly protocols: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly insecure: boolean;
  readonly message: string;
  readonly saved: readonly string[];
}

const readWs = (v: Values | undefined): WsState => ({
  url: typeof v?.url === 'string' ? v.url : 'wss://echo.websocket.org',
  kind: v?.kind === 'sse' ? 'sse' : 'ws',
  protocols: typeof v?.protocols === 'string' ? v.protocols : '',
  headers: Array.isArray(v?.headers) ? (v.headers as [string, string][]) : [],
  insecure: v?.insecure === true,
  message: typeof v?.message === 'string' ? v.message : '{ "type": "hello" }',
  saved: Array.isArray(v?.saved) ? (v.saved as string[]) : [],
});
const writeWs = (s: WsState): Values => ({ ...s, headers: s.headers.map((h) => [...h]), saved: [...s.saved] });

type Line = { readonly dir: 'in' | 'out' | 'info'; readonly text: string; readonly at: number; readonly label?: string };

function SocketClient({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readWs, writeWs);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [filter, setFilter] = useState('');
  const id = `ws-${toolId}`;
  const set = <K extends keyof WsState>(k: K, v: WsState[K]) => setState((s) => ({ ...s, [k]: v }));
  const add = (line: Line) => setLines((l) => [...l, line].slice(-2000));

  useEffect(() => {
    const off = onWsEvent((e: WsEvent) => {
      if (e.id !== id) return;
      if (e.kind === 'text') add({ dir: 'in', text: e.data, at: e.at });
      else if (e.kind === 'binary') add({ dir: 'in', text: `(binary, ${e.size} bytes) ${e.data.slice(0, 120)}`, at: e.at });
      else if (e.kind === 'sse') add({ dir: 'in', text: e.data, at: e.at, label: e.event === 'message' ? undefined : e.event });
      else if (e.kind === 'close') add({ dir: 'info', text: `Closed by the server ${e.data}`, at: e.at });
      else if (e.kind === 'error') add({ dir: 'info', text: `Error: ${e.data}`, at: e.at });
      else if (e.kind === 'ended') setConnected(false);
    });
    return () => {
      void off.then((stop) => stop());
      void wsClose(id);
      void sseClose(id);
    };
  }, []);

  const connect = () =>
    attempt(async () => {
      setBusy(true);
      try {
        const headers = state.headers.filter(([k]) => k.trim());
        if (state.kind === 'ws') {
          const r = await wsConnect(
            id,
            state.url,
            headers,
            state.protocols
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean),
            state.insecure,
          );
          add({ dir: 'info', text: `Connected (HTTP ${r.status}${r.protocol ? `, protocol ${r.protocol}` : ''})`, at: Date.now() });
        } else {
          const status = await sseConnect(id, state.url, headers);
          add({ dir: 'info', text: `Listening for events (HTTP ${status})`, at: Date.now() });
        }
        setConnected(true);
      } finally {
        setBusy(false);
      }
    });
  const disconnect = () =>
    attempt(async () => {
      if (state.kind === 'ws') await wsClose(id);
      else await sseClose(id);
      setConnected(false);
      add({ dir: 'info', text: 'Disconnected', at: Date.now() });
    });
  const send = (text = state.message) =>
    attempt(async () => {
      await wsSend(id, { text });
      add({ dir: 'out', text, at: Date.now() });
    });

  const shown = filter ? lines.filter((l) => l.text.toLowerCase().includes(filter.toLowerCase())) : lines;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <section class="tool ng-tool" data-testid="tool" data-state={connected ? 'done' : 'idle'}>
      <DesktopNote what="This client" />
      <div class="button-row ng-connect">
        <Segmented
          label="Kind"
          value={state.kind}
          onChange={(k) => set('kind', k)}
          choices={[
            { value: 'ws', label: 'WebSocket' },
            { value: 'sse', label: 'Server-sent events' },
          ]}
        />
        <input
          class="input ng-address"
          aria-label="Address"
          value={state.url}
          placeholder={state.kind === 'ws' ? 'wss://…' : 'https://…/events'}
          onInput={(e) => set('url', e.currentTarget.value)}
          data-testid="ws-url"
        />
        {connected ? (
          <button type="button" class="button button-danger" onClick={disconnect}>
            Disconnect
          </button>
        ) : (
          <button type="button" class="button button-primary" disabled={!isDesktop || busy} onClick={connect} data-testid="ws-connect">
            Connect
          </button>
        )}
      </div>
      <details class="ng-options">
        <summary>Headers{state.kind === 'ws' ? ', subprotocols and certificates' : ''}</summary>
        <HeaderRows label="Header" rows={state.headers} onChange={(h) => set('headers', h)} />
        {state.kind === 'ws' && (
          <>
            <label class="control">
              <span class="control-label">Subprotocols (comma-separated)</span>
              <input class="input" value={state.protocols} onInput={(e) => set('protocols', e.currentTarget.value)} />
            </label>
            <label class="check">
              <input type="checkbox" checked={state.insecure} onChange={(e) => set('insecure', e.currentTarget.checked)} /> Accept any certificate (test servers only)
            </label>
          </>
        )}
      </details>
      <div class="ng-socket">
        <div class="ng-messages-wrap">
          <div class="button-row">
            <strong>Messages</strong>
            <span class="tone-muted">{lines.length}</span>
            <input class="input ng-filter" type="search" placeholder="Filter" aria-label="Filter messages" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
            <button type="button" class="button button-small button-quiet" onClick={() => setLines([])}>
              Clear
            </button>
          </div>
          <div ref={logRef} class="ng-messages" {...scrollRegion('Messages')} data-testid="ws-messages">
            {shown.map((l, i) => (
              <div key={i} class={`ng-msg ng-${l.dir}`}>
                <span class="ng-time">{clock(l.at)}</span>
                <span class="ng-dir">{l.dir === 'in' ? '↓' : l.dir === 'out' ? '↑' : '•'}</span>
                {l.label && <span class="ng-label">{l.label}</span>}
                <pre>{l.dir === 'info' ? l.text : prettyJson(l.text)}</pre>
              </div>
            ))}
          </div>
        </div>
        {state.kind === 'ws' && (
          <div class="ng-compose">
            <div class="pane">
              <div class="pane-header">
                <span class="pane-title">Message</span>
                <span class="pane-meta">Ctrl+Enter sends</span>
              </div>
              <div
                class="pane-body"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && connected) {
                    e.preventDefault();
                    send();
                  }
                }}
              >
                <CodeEditor value={state.message} onChange={(m) => set('message', m)} language="json" label="Message" />
              </div>
            </div>
            <div class="button-row">
              <button type="button" class="button button-primary" disabled={!connected} onClick={() => send()}>
                Send
              </button>
              <button type="button" class="button" disabled={!state.message.trim() || state.saved.includes(state.message)} onClick={() => set('saved', [state.message, ...state.saved].slice(0, 20))}>
                Keep for later
              </button>
            </div>
            {state.saved.length > 0 && (
              <ul class="ng-saved">
                {state.saved.map((m) => (
                  <li key={m}>
                    <button type="button" class="link-button" onClick={() => set('message', m)} title="Put in the editor">
                      {m.slice(0, 60)}
                    </button>
                    <button type="button" class="icon-button" aria-label="Send" disabled={!connected} onClick={() => send(m)}>
                      <Icon name="play" size={12} />
                    </button>
                    <button
                      type="button"
                      class="icon-button"
                      aria-label="Forget"
                      onClick={() =>
                        set(
                          'saved',
                          state.saved.filter((x) => x !== m),
                        )
                      }
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- gRPC Client -- */

interface GrpcState {
  readonly address: string;
  readonly tls: boolean;
  readonly insecure: boolean;
  readonly metadata: readonly (readonly [string, string])[];
  readonly deadline: number;
}

const readGrpc = (v: Values | undefined): GrpcState => ({
  address: typeof v?.address === 'string' ? v.address : 'localhost:50051',
  tls: v?.tls === true,
  insecure: v?.insecure === true,
  metadata: Array.isArray(v?.metadata) ? (v.metadata as [string, string][]) : [],
  deadline: typeof v?.deadline === 'number' ? v.deadline : 30,
});
const writeGrpc = (s: GrpcState): Values => ({ ...s, metadata: s.metadata.map((m) => [...m]) });

function GrpcClient({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readGrpc, writeGrpc);
  const [described, setDescribed] = useState<GrpcDescribed | null>(null);
  const [protoNames, setProtoNames] = useState<string[]>([]);
  const [chosen, setChosen] = useState<{ service: string; method: string } | null>(null);
  const [requests, setRequests] = useState<Record<string, string>>({});
  const [result, setResult] = useState<GrpcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof GrpcState>(k: K, v: GrpcState[K]) => setState((s) => ({ ...s, [k]: v }));
  const target = (): GrpcTarget => ({ address: state.address, tls: state.tls, insecure: state.insecure, metadata: state.metadata.filter(([k]) => k.trim()), deadlineMs: state.deadline * 1000 });
  const method = useMemo(() => described?.services.find((s) => s.name === chosen?.service)?.methods.find((m) => m.name === chosen?.method) ?? null, [described, chosen]);
  const key = chosen ? `${chosen.service}/${chosen.method}` : '';
  const request = requests[key] ?? method?.template ?? '{}';

  const loaded = (d: GrpcDescribed) => {
    setDescribed(d);
    const first = d.services[0];
    const m = first?.methods[0];
    setChosen(first && m ? { service: first.name, method: m.name } : null);
    setResult(null);
  };

  const call = () =>
    attempt(async () => {
      if (!described || !chosen) return;
      setBusy(true);
      try {
        setResult(await grpcCall(described.pool, chosen.service, chosen.method, method?.clientStreaming && !request.trim().startsWith('[') ? `[${request}]` : request, target()));
      } finally {
        setBusy(false);
      }
    });

  return (
    <section class="tool ng-tool" data-testid="tool" data-state={result ? 'done' : 'idle'}>
      <DesktopNote what="The gRPC client" />
      <div class="button-row ng-connect">
        <input class="input ng-address" aria-label="Server" placeholder="host:port" value={state.address} onInput={(e) => set('address', e.currentTarget.value)} data-testid="grpc-address" />
        <label class="check">
          <input type="checkbox" checked={state.tls} onChange={(e) => set('tls', e.currentTarget.checked)} /> TLS
        </label>
        <button type="button" class="button" disabled={!isDesktop || busy} onClick={() => attempt(async () => loaded(await grpcReflect(target())))} data-testid="grpc-reflect">
          Ask the server (reflection)
        </button>
        <MultiDrop
          icon="file"
          compact
          accept=".proto"
          title="Load .proto files"
          testId="grpc-protos"
          onFiles={(files) =>
            void attempt(async () => {
              const sources = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
              setProtoNames(sources.map((s) => s.name));
              loaded(await grpcCompile(sources));
            })
          }
        />
      </div>
      <details class="ng-options">
        <summary>Metadata, deadline and certificates</summary>
        <HeaderRows label="Metadata" rows={state.metadata} onChange={(m) => set('metadata', m)} />
        <label class="control control-inline">
          <span class="control-label">Deadline</span>
          <input class="input input-narrow" type="number" min={1} value={state.deadline} onInput={(e) => set('deadline', Math.max(1, Number(e.currentTarget.value) || 30))} />
          <span class="tone-muted">seconds</span>
        </label>
        <label class="check">
          <input type="checkbox" checked={state.insecure} onChange={(e) => set('insecure', e.currentTarget.checked)} /> Accept any certificate (test servers only)
        </label>
      </details>
      {described ? (
        <div class="ng-grpc">
          <aside class="ng-services" data-testid="grpc-services">
            {protoNames.length > 0 && <p class="tone-muted">From {protoNames.join(', ')}</p>}
            {described.services.map((s) => (
              <div key={s.name}>
                <strong class="ng-service">{s.name}</strong>
                <ul>
                  {s.methods.map((m) => (
                    <li key={m.name}>
                      <button
                        type="button"
                        class={`ng-route${chosen?.service === s.name && chosen.method === m.name ? ' is-active' : ''}`}
                        onClick={() => {
                          setChosen({ service: s.name, method: m.name });
                          setResult(null);
                        }}
                      >
                        {m.name}
                        {(m.clientStreaming || m.serverStreaming) && (
                          <span class="tone-muted"> · {m.clientStreaming && m.serverStreaming ? 'bidi stream' : m.clientStreaming ? 'client stream' : 'server stream'}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </aside>
          <div class="ng-call">
            {method && (
              <>
                <p class="tone-muted">
                  {method.input} → {method.output}
                  {method.clientStreaming && ' · send several messages as a JSON array'}
                </p>
                <div class="pane ng-body">
                  <div class="pane-body">
                    <CodeEditor value={request} onChange={(text) => setRequests((r) => ({ ...r, [key]: text }))} language="json" label="Request" testId="grpc-request" />
                  </div>
                </div>
                <div class="button-row">
                  <button type="button" class="button button-primary" disabled={busy} onClick={call} data-testid="grpc-call">
                    <Icon name="play" size={14} /> {busy ? 'Calling…' : 'Call'}
                  </button>
                  <button type="button" class="button button-quiet" onClick={() => setRequests((r) => ({ ...r, [key]: method.template }))}>
                    Reset the request
                  </button>
                </div>
              </>
            )}
            {result && (
              <div class="ng-result" data-testid="grpc-result">
                <p>
                  <strong class={result.code === 0 ? 'ng-good' : 'ng-bad'}>
                    {result.code} {result.status}
                  </strong>{' '}
                  {result.message} <span class="tone-muted">· {result.ms} ms</span>
                </p>
                {result.responses.map((r, i) => (
                  <pre key={i}>{JSON.stringify(r, null, 2)}</pre>
                ))}
                <details>
                  <summary>Headers and trailers</summary>
                  <table class="data-table">
                    <tbody>
                      {[...result.headers, ...result.trailers].map(([k, v], i) => (
                        <tr key={`${k}-${i}`}>
                          <th>{k}</th>
                          <td>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p class="tone-muted">Load the service's .proto files (imports among them and Google's well-known types are found), or ask a server that has gRPC reflection turned on.</p>
      )}
    </section>
  );
}

function NetTools({ toolId }: { toolId: string }) {
  if (toolId === 'websocket-client') return <SocketClient toolId={toolId} />;
  if (toolId === 'grpc-client') return <GrpcClient toolId={toolId} />;
  return <MockServer toolId={toolId} />;
}

export default defineCustomTool(NetTools);
