/**
 * Diagram editors with a live preview: Mermaid (flowcharts, sequence, Gantt,
 * class, state, ER, mind maps…), Graphviz DOT, and ER diagrams drawn from SQL
 * CREATE TABLE statements.  Everything renders on this computer; exports are
 * SVG or PNG.
 */

import DOMPurify from 'dompurify';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { errorMessage } from '../../lib/errors';
import { parseTables, toMermaid } from '../../lib/sql-er';
import { copyText, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { rasterizeSvg } from '../../ui/canvas';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

type Engine = 'mermaid' | 'graphviz' | 'sql';

const SAMPLES: Record<Engine, string> = {
  mermaid: `flowchart LR
  visitor([Visitor]) --> ticket{Has a ticket?}
  ticket -- yes --> gallery[Science gallery]
  ticket -- no --> counter[Ticket counter] --> gallery
  gallery --> show[[Planetarium show]]
  gallery --> exit((Exit))`,
  graphviz: `digraph pipeline {
  rankdir=LR;
  node [shape=box, style="rounded,filled", fillcolor="#e8f4ee", fontname="Helvetica"];
  source -> build -> test -> package;
  test -> report [style=dashed];
  package -> { deb msi dmg };
}`,
  sql: `CREATE TABLE visitors (
  id INTEGER PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(200) UNIQUE
);

CREATE TABLE shows (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TIMESTAMP NOT NULL
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  visitor_id INTEGER NOT NULL REFERENCES visitors(id),
  show_id INTEGER NOT NULL,
  seats SMALLINT DEFAULT 1,
  FOREIGN KEY (show_id) REFERENCES shows(id)
);`,
};

const ENGINE_OF: Record<string, Engine> = { 'mermaid-editor': 'mermaid', 'graphviz-viewer': 'graphviz', 'sql-er-diagram': 'sql' };

let mermaidLoaded: Promise<typeof import('mermaid').default> | null = null;
let renders = 0;

async function renderMermaid(source: string, dark: boolean): Promise<string> {
  mermaidLoaded ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidLoaded;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: 'system-ui, sans-serif',
    // The dark theme's grey label boxes leave edge labels short of 4.5:1 contrast.
    themeVariables: dark ? { edgeLabelBackground: '#2d333b' } : {},
  });
  const { svg } = await mermaid.render(`benchtop-mermaid-${renders++}`, source);
  return svg;
}

let graphvizLoaded: Promise<{ dot: (source: string) => string }> | null = null;

async function renderGraphviz(source: string): Promise<string> {
  graphvizLoaded ??= import('@hpcc-js/wasm-graphviz').then((m) => m.Graphviz.load());
  graphvizLoaded.catch(() => {
    graphvizLoaded = null;
  });
  return (await graphvizLoaded).dot(source);
}

const clean = (svg: string) =>
  DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['foreignObject'], HTML_INTEGRATION_POINTS: { foreignobject: true } } as never) as unknown as string;

/** Width and height of an SVG from its viewBox (or attributes). */
function sizeOf(svg: string): [number, number] {
  const box = /viewBox="[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(svg);
  if (box) return [Number(box[1]), Number(box[2])];
  const w = /width="([\d.]+)/.exec(svg);
  const h = /height="([\d.]+)/.exec(svg);
  return [Number(w?.[1] ?? 800), Number(h?.[1] ?? 600)];
}

function Diagrams({ toolId }: { toolId: string }) {
  const engine = ENGINE_OF[toolId] ?? 'mermaid';
  const [state, setState] = usePersistentState<{ source: string }>(
    toolId,
    (s: Values | undefined) => ({ source: typeof s?.source === 'string' ? s.source : SAMPLES[engine] }),
    (s) => ({ ...s }),
  );
  useIncomingFiles((files) => attempt(async () => setState({ source: await (files[0] as File).text() })));
  const [svg, setSvg] = useState('');
  const [mermaidSource, setMermaidSource] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const ticket = useRef(0);

  useEffect(() => {
    const mine = ++ticket.current;
    const timer = window.setTimeout(async () => {
      try {
        const dark = document.documentElement.dataset.theme === 'dark';
        let out: string;
        if (engine === 'graphviz') out = await renderGraphviz(state.source);
        else {
          let text = state.source;
          if (engine === 'sql') {
            const tables = parseTables(state.source);
            if (!tables.length) throw new Error('No CREATE TABLE statements found.');
            text = toMermaid(tables);
            setMermaidSource(text);
          }
          out = await renderMermaid(text, dark);
        }
        if (mine === ticket.current) {
          setSvg(clean(out));
          setError('');
        }
      } catch (e) {
        if (mine === ticket.current) setError(errorMessage(e).replace(/^Error:\s*/, ''));
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [state.source, engine]);

  const base = engine === 'graphviz' ? 'graph' : engine === 'sql' ? 'er-diagram' : 'diagram';
  const savePng = () =>
    attempt(async () => {
      const [w, h] = sizeOf(svg);
      const scale = Math.min(4, 4000 / Math.max(w, h));
      const canvas = await rasterizeSvg(svg, Math.round(w * scale), Math.round(h * scale), '#ffffff');
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not draw the picture.');
      const saved = await saveFile(`${base}.png`, blob, 'image/png');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });
  return (
    <div data-testid="tool" class="tool split-tool diagram-tool">
      <div class="pane">
        <div class="pane-header">
          <h2 class="pane-title">{engine === 'graphviz' ? 'DOT source' : engine === 'sql' ? 'SQL (CREATE TABLE)' : 'Mermaid source'}</h2>
          <div class="pane-actions">
            <button type="button" class="button button-small button-quiet" onClick={() => setState({ source: SAMPLES[engine] })}>
              Example
            </button>
          </div>
        </div>
        <div class="pane-body">
          <CodeEditor value={state.source} onChange={(source) => setState({ source })} language="text" label="Diagram source" testId="diagram-source" />
        </div>
        {engine === 'sql' && mermaidSource && (
          <div class="pane-footer button-row">
            <button
              type="button"
              class="button button-small"
              onClick={() =>
                attempt(async () => {
                  await copyText(mermaidSource);
                  notify('Copied the Mermaid erDiagram.');
                })
              }
            >
              Copy as Mermaid
            </button>
          </div>
        )}
      </div>
      <div class="pane">
        <div class="pane-header">
          <h2 class="pane-title">Preview</h2>
          <div class="pane-actions">
            <button type="button" class="icon-button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}>
              <Icon name="down" size={16} />
            </button>
            <span class="tone-muted">{Math.round(zoom * 100)}%</span>
            <button type="button" class="icon-button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(6, z * 1.25))}>
              <Icon name="up" size={16} />
            </button>
            <button type="button" class="button button-small" disabled={!svg} onClick={() => attempt(async () => void (await saveFile(`${base}.svg`, svg, 'image/svg+xml')))}>
              SVG
            </button>
            <button type="button" class="button button-small" disabled={!svg} onClick={savePng} data-testid="diagram-png">
              PNG
            </button>
          </div>
        </div>
        <div class="pane-body diagram-preview" {...scrollRegion('Diagram')}>
          {error && (
            <p class="recipe-error" role="alert">
              {error}
            </p>
          )}
          <div class="diagram-canvas" data-testid="diagram-preview" style={{ transform: `scale(${zoom})` }} dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>
    </div>
  );
}

export default defineCustomTool(Diagrams);
