/** OpenAPI viewer, HAR viewer and hex viewer: offline readers for files developers are often sent. */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { formatBytes } from '../../lib/bytes';
import { type ApiDocument, apiMarkdown, findAll, type HarEntry, inspect, parseHar, parseHexPattern, parseOpenApi } from '../../lib/dev-formats';
import { errorMessage } from '../../lib/errors';
import { copyText, pickFile, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

const SAMPLE_API = `openapi: 3.0.3
info:
  title: Museum bookings
  version: 1.2.0
  description: Shows, seats and bookings for a science centre.
servers:
  - url: https://api.example.org/v1
paths:
  /shows:
    get:
      tags: [shows]
      summary: List today's shows
      parameters:
        - name: date
          in: query
          schema: { type: string, format: date }
      responses:
        '200':
          description: The shows
          content:
            application/json:
              schema: { type: array, items: { $ref: '#/components/schemas/Show' } }
  /bookings:
    post:
      tags: [bookings]
      summary: Book seats
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Booking' }
      responses:
        '201': { description: Booked }
        '409': { description: Not enough seats }
components:
  schemas:
    Show:
      type: object
      required: [id, title]
      properties:
        id: { type: integer }
        title: { type: string }
        starts: { type: string, format: date-time }
    Booking:
      type: object
      required: [show, seats]
      properties:
        show: { type: integer }
        seats: { type: integer, description: Number of seats }
`;

/* ------------------------------------------------------------ OpenAPI -- */

function OpenApiViewer({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState<{ source: string }>(
    toolId,
    (s: Values | undefined) => ({ source: typeof s?.source === 'string' ? s.source : SAMPLE_API }),
    (s) => ({ ...s }),
  );
  const [filter, setFilter] = useState('');
  const parsed = useMemo((): { api?: ApiDocument; error?: string } => {
    try {
      return { api: parseOpenApi(state.source) };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  }, [state.source]);
  const api = parsed.api;
  useIncomingFiles((files) => attempt(async () => setState({ source: await (files[0] as File).text() })));
  const shown = api?.operations.filter((op) => `${op.method} ${op.path} ${op.summary} ${op.tags.join(' ')}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  return (
    <div data-testid="tool" class="tool split-tool">
      <div class="pane">
        <div class="pane-header">
          <h2 class="pane-title">OpenAPI or Swagger (YAML or JSON)</h2>
          <div class="pane-actions">
            <button
              type="button"
              class="button button-small"
              onClick={() =>
                attempt(async () => {
                  const file = await pickFile('.yaml,.yml,.json');
                  if (file) setState({ source: await file.text() });
                })
              }
            >
              Open
            </button>
          </div>
        </div>
        <div class="pane-body">
          <CodeEditor value={state.source} onChange={(source) => setState({ source })} language="yaml" label="API description" testId="openapi-source" />
        </div>
      </div>
      <div class="pane">
        <div class="pane-header">
          <h2 class="pane-title">{api ? `${api.title} ${api.version}` : 'API'}</h2>
          <div class="pane-actions">
            <input class="input" type="search" placeholder="Filter" aria-label="Filter operations" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
            <button
              type="button"
              class="button button-small"
              disabled={!api}
              onClick={() =>
                attempt(async () => {
                  if (api) await saveFile(`${api.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'api'}.md`, apiMarkdown(api), 'text/markdown');
                })
              }
            >
              Markdown
            </button>
          </div>
        </div>
        <div class="pane-body api-doc" data-testid="openapi-view" {...scrollRegion('API reference')}>
          {parsed.error && <p class="recipe-error">{parsed.error}</p>}
          {api && (
            <>
              <p class="tone-muted">
                {api.spec}
                {api.servers.length ? ` · ${api.servers.join(', ')}` : ''}
              </p>
              {api.description && <p>{api.description}</p>}
              {shown.map((op) => (
                <details key={`${op.method} ${op.path}`} class={`api-op${op.deprecated ? ' is-deprecated' : ''}`}>
                  <summary>
                    <span class={`api-method method-${op.method.toLowerCase()}`}>{op.method}</span>
                    <code>{op.path}</code>
                    <span class="tone-muted">{op.summary}</span>
                  </summary>
                  {op.description && op.description !== op.summary && <p>{op.description}</p>}
                  {op.security.length > 0 && <p class="tone-muted">Security: {op.security.join(', ')}</p>}
                  {op.parameters.length > 0 && (
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Parameter</th>
                          <th>In</th>
                          <th>Type</th>
                          <th>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {op.parameters.map((p) => (
                          <tr key={`${p.in}-${p.name}`}>
                            <td>
                              <code>{p.name}</code>
                              {p.required ? ' *' : ''}
                            </td>
                            <td>{p.in}</td>
                            <td>{p.type}</td>
                            <td>{p.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {op.body && (
                    <p>
                      Body ({op.body.types.join(', ')}){op.body.required ? ', required' : ''}: <code>{op.body.schema || 'any'}</code>
                    </p>
                  )}
                  <ul class="api-responses">
                    {op.responses.map((r) => (
                      <li key={r.code}>
                        <strong>{r.code}</strong> {r.description} {r.schema && <code>{r.schema}</code>}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
              {api.schemas.length > 0 && <h3>Schemas</h3>}
              {api.schemas.map((s) => (
                <details key={s.name} class="api-op">
                  <summary>
                    <code>{s.name}</code> <span class="tone-muted">{s.summary}</span>
                  </summary>
                  <ul class="api-responses">
                    {s.properties.map((p) => (
                      <li key={p.name}>
                        <code>{p.name}</code>
                        {p.required ? ' *' : ''} {p.type} <span class="tone-muted">{p.description}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- HAR -- */

const KINDS: readonly (HarEntry['kind'] | 'all')[] = ['all', 'document', 'xhr', 'script', 'style', 'image', 'font', 'media', 'other'];

function HarViewer() {
  const [har, setHar] = useState<ReturnType<typeof parseHar> | null>(null);
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all');
  const [chosen, setChosen] = useState<HarEntry | null>(null);
  const open = (file: File | null | undefined) => {
    if (!file) return;
    attempt(async () => {
      setHar(parseHar(await file.text()));
      setName(file.name);
      setChosen(null);
    });
  };
  useIncomingFiles((files) => open(files[0]));
  const rows = har?.entries.filter((e) => (kind === 'all' || e.kind === kind) && e.url.toLowerCase().includes(filter.toLowerCase())) ?? [];
  const span = Math.max(1, har?.total ?? 1);
  return (
    <div data-testid="tool" class="tool har-tool">
      <div class="button-row">
        <button type="button" class="button button-primary" data-testid="har-open" onClick={() => attempt(async () => open(await pickFile('.har,application/json')))}>
          Open a HAR file
        </button>
        {har && (
          <span class="tone-muted">
            {name}: {har.entries.length} requests, {formatBytes(har.bytes)}, {Math.round(har.total)} ms{har.creator ? `, from ${har.creator}` : ''}
          </span>
        )}
      </div>
      {!har && <p class="tone-muted">Save a HAR from your browser’s developer tools (Network → Export HAR) and open it here. It stays on this computer.</p>}
      {har && (
        <>
          <div class="button-row">
            <input class="input" type="search" placeholder="Filter by URL" aria-label="Filter by URL" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
            <Segmented label="Type" value={kind} onChange={setKind} choices={KINDS.map((k) => ({ value: k, label: k === 'xhr' ? 'Fetch/XHR' : k[0]?.toUpperCase() + k.slice(1) }))} />
          </div>
          <div class="har-table-wrap" {...scrollRegion('Requests')}>
            <table class="data-table har-table" data-testid="har-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Status</th>
                  <th>URL</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Time</th>
                  <th class="har-waterfall-head">Waterfall</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.index}
                    class={`${chosen?.index === e.index ? 'is-selected' : ''}${e.status >= 400 || e.status === 0 ? ' is-error' : ''}`}
                    onClick={() => setChosen(e)}
                    tabIndex={0}
                    onKeyDown={(k) => k.key === 'Enter' && setChosen(e)}
                  >
                    <td>{e.method}</td>
                    <td>{e.status || 'failed'}</td>
                    <td class="har-url" title={e.url}>
                      {e.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                    </td>
                    <td>{e.mime || e.kind}</td>
                    <td>{formatBytes(Math.max(0, e.size))}</td>
                    <td>{Math.round(e.time)} ms</td>
                    <td class="har-waterfall">
                      <span style={{ left: `${(e.start / span) * 100}%`, width: `${Math.max(0.4, (e.time / span) * 100)}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {chosen && (
            <div class="har-detail" data-testid="har-detail">
              <h3>
                {chosen.method} {chosen.url}
              </h3>
              <p class="tone-muted">
                {chosen.status} {chosen.statusText} ·{' '}
                {Object.entries(chosen.timings)
                  .map(([k, v]) => `${k} ${Math.round(v)} ms`)
                  .join(', ')}
              </p>
              <div class="har-columns">
                <section>
                  <h4>Request headers</h4>
                  <dl>
                    {chosen.requestHeaders.map((h, i) => (
                      <div key={i}>
                        <dt>{h.name}</dt>
                        <dd>{h.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {chosen.requestBody && <pre class="har-body">{chosen.requestBody.slice(0, 20000)}</pre>}
                </section>
                <section>
                  <h4>Response headers</h4>
                  <dl>
                    {chosen.responseHeaders.map((h, i) => (
                      <div key={i}>
                        <dt>{h.name}</dt>
                        <dd>{h.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {chosen.responseBody && (
                    <>
                      <pre class="har-body">
                        {chosen.responseEncoding === 'base64' ? `(${formatBytes(Math.floor((chosen.responseBody.length * 3) / 4))} of base64 data)` : chosen.responseBody.slice(0, 20000)}
                      </pre>
                      <button
                        type="button"
                        class="button button-small"
                        onClick={() =>
                          attempt(async () => {
                            const bytes = chosen.responseEncoding === 'base64' ? Uint8Array.from(atob(chosen.responseBody), (c) => c.charCodeAt(0)) : new TextEncoder().encode(chosen.responseBody);
                            const file = chosen.url.split(/[?#]/)[0]?.split('/').pop() || 'response';
                            await saveFile(file, bytes, chosen.mime || 'application/octet-stream');
                          })
                        }
                      >
                        Save the response body
                      </button>
                    </>
                  )}
                </section>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- hex -- */

const ROW = 16;
const ROW_HEIGHT = 22;
const MAX_HEX = 512 * 1024 * 1024;

function HexViewer() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [little, setLittle] = useState(true);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'hex' | 'text'>('text');
  const [hits, setHits] = useState<number[]>([]);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(480);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [file]);
  const open = (picked: File | null | undefined) => {
    if (!picked) return;
    attempt(async () => {
      if (picked.size > MAX_HEX) throw new Error('Files up to 512 MB can be opened here.');
      setFile({ name: picked.name, bytes: new Uint8Array(await picked.arrayBuffer()) });
      setCursor(0);
      setHits([]);
    });
  };
  useIncomingFiles((files) => open(files[0]));
  const goTo = (offset: number) => {
    if (!file) return;
    const clamped = Math.max(0, Math.min(file.bytes.length - 1, offset));
    setCursor(clamped);
    const row = Math.floor(clamped / ROW);
    const el = scroller.current;
    if (el && (row * ROW_HEIGHT < el.scrollTop || row * ROW_HEIGHT > el.scrollTop + el.clientHeight - ROW_HEIGHT * 2)) el.scrollTop = Math.max(0, row * ROW_HEIGHT - el.clientHeight / 3);
  };
  const search = () =>
    attempt(async () => {
      if (!file) return;
      const needle = mode === 'hex' ? parseHexPattern(query) : new TextEncoder().encode(query);
      const found = findAll(file.bytes, needle);
      setHits(found);
      if (found.length) goTo(found.find((o) => o > cursor) ?? (found[0] as number));
      else notify('Not found.');
    });
  const rows = file ? Math.ceil(file.bytes.length / ROW) : 0;
  const first = Math.floor(top / ROW_HEIGHT);
  const count = Math.ceil(height / ROW_HEIGHT) + 2;
  const marked = new Set(hits);
  const needleLength = mode === 'hex' ? Math.max(1, query.replace(/0x|[\s,:-]/gi, '').length / 2) : Math.max(1, new TextEncoder().encode(query).length);
  const inHit = (offset: number) => {
    for (let k = 0; k < needleLength; k++) if (marked.has(offset - k)) return true;
    return false;
  };
  return (
    <div data-testid="tool" class="tool hex-tool">
      <div class="button-row">
        <button type="button" class="button button-primary" data-testid="hex-open" onClick={() => attempt(async () => open(await pickFile()))}>
          Open a file
        </button>
        {file && (
          <>
            <span class="tone-muted">
              {file.name}, {formatBytes(file.bytes.length)}
            </span>
            <form
              class="button-row"
              onSubmit={(e) => {
                e.preventDefault();
                const raw = (new FormData(e.currentTarget).get('offset') as string).trim();
                goTo(raw.toLowerCase().startsWith('0x') ? Number.parseInt(raw, 16) : Number(raw));
              }}
            >
              <input class="input hex-offset" name="offset" placeholder="Offset (0x1F0 or 496)" aria-label="Go to offset" />
              <button type="submit" class="button">
                Go
              </button>
            </form>
            <Segmented
              label="Search for"
              value={mode}
              onChange={setMode}
              choices={[
                { value: 'text', label: 'Text' },
                { value: 'hex', label: 'Hex' },
              ]}
            />
            <form
              class="button-row"
              onSubmit={(e) => {
                e.preventDefault();
                search();
              }}
            >
              <input class="input" aria-label="Search" placeholder={mode === 'hex' ? 'DE AD BE EF' : 'Text'} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
              <button type="submit" class="button" data-testid="hex-search">
                Find
              </button>
            </form>
            {hits.length > 0 && <span class="tone-muted">{hits.length === 1000 ? '1000+' : hits.length} found</span>}
          </>
        )}
      </div>
      {file && (
        <div class="hex-layout">
          <div class="hex-scroll" {...scrollRegion('Bytes')} ref={scroller} onScroll={(e) => setTop(e.currentTarget.scrollTop)} data-testid="hex-rows">
            <div style={{ height: `${rows * ROW_HEIGHT}px`, position: 'relative' }}>
              {Array.from({ length: Math.min(count, rows - first) }, (_, i) => {
                const row = first + i;
                const offset = row * ROW;
                const slice = file.bytes.subarray(offset, offset + ROW);
                return (
                  <div key={row} class="hex-row" style={{ top: `${row * ROW_HEIGHT}px` }}>
                    <span class="hex-addr">{offset.toString(16).padStart(8, '0')}</span>
                    <span class="hex-bytes">
                      {Array.from(slice, (b, j) => (
                        <button key={j} type="button" class={`${offset + j === cursor ? 'is-cursor' : ''}${inHit(offset + j) ? ' is-hit' : ''}`} onClick={() => setCursor(offset + j)}>
                          {b.toString(16).padStart(2, '0')}
                        </button>
                      ))}
                    </span>
                    <span class="hex-ascii">{Array.from(slice, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <aside class="hex-inspector" data-testid="hex-inspector">
            <h3>
              Offset {cursor} (0x{cursor.toString(16).toUpperCase()})
            </h3>
            <Segmented
              label="Byte order"
              value={little ? 'le' : 'be'}
              onChange={(v) => setLittle(v === 'le')}
              choices={[
                { value: 'le', label: 'Little-endian' },
                { value: 'be', label: 'Big-endian' },
              ]}
            />
            <dl>
              {inspect(file.bytes, cursor, little).map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              class="button button-small"
              onClick={() =>
                attempt(async () => {
                  await copyText(Array.from(file.bytes.subarray(cursor, cursor + 64), (b) => b.toString(16).padStart(2, '0')).join(' '));
                  notify('Copied 64 bytes as hex.');
                })
              }
            >
              Copy 64 bytes as hex
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}

function DevViewers({ toolId }: { toolId: string }) {
  if (toolId === 'har-viewer') return <HarViewer />;
  if (toolId === 'hex-viewer') return <HexViewer />;
  return <OpenApiViewer toolId={toolId} />;
}

export default defineCustomTool(DevViewers);
