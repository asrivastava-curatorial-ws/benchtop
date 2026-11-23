/**
 * Web Page to PDF: paste web addresses, get PDFs made by the browser that is
 * already installed (desktop app).  The same engine saves pages into notes.
 */
import { zipSync } from 'fflate';
import { useEffect, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { errorMessage } from '../../lib/errors';
import { isDesktop, type PdfEngine, pdfEngine, saveFile, urlToPdf, type WebPdf } from '../../platform';
import { pickFolder, revealResult } from '../../platform/convert';
import { copyWebsite, type MirrorProgress, type MirrorScope, type MirrorSummary, onCopyProgress, stopCopy } from '../../platform/mirror';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

export const PAPERS = ['A4', 'Letter', 'A3', 'A5', 'Legal'] as const;

interface PdfState {
  readonly urls: string;
  readonly paper: (typeof PAPERS)[number];
  readonly landscape: boolean;
  readonly background: boolean;
  readonly wait: number;
}

const readPdf = (v: Values | undefined): PdfState => ({
  urls: typeof v?.urls === 'string' ? v.urls : '',
  paper: PAPERS.includes(v?.paper as never) ? (v?.paper as PdfState['paper']) : 'A4',
  landscape: v?.landscape === true,
  background: v?.background !== false,
  wait: typeof v?.wait === 'number' && v.wait >= 0 && v.wait <= 30 ? v.wait : 0,
});
const writePdf = (s: PdfState): Values => ({ ...s });

/** A file name from a page's title, or its address when it has none. */
export function pdfName(page: Pick<WebPdf, 'title' | 'url'>): string {
  let base = page.title.trim();
  if (!base) {
    try {
      const u = new URL(page.url);
      base = `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.replace(/\/+$/, '');
    } catch {
      base = 'page';
    }
  }
  const cleaned = [...base].map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? ' ' : ch)).join('');
  return `${cleaned.replace(/\s+/g, ' ').trim().slice(0, 90) || 'page'}.pdf`;
}

type Job = { readonly url: string; readonly status: 'waiting' | 'working' | 'done' | 'failed'; readonly result?: WebPdf; readonly error?: string };

export function useEngine(): PdfEngine | null {
  const [engine, setEngine] = useState<PdfEngine | null>(null);
  useEffect(() => {
    let live = true;
    pdfEngine()
      .then((e) => live && setEngine(e))
      .catch(() => live && setEngine({ kind: 'none', name: '', path: null }));
    return () => {
      live = false;
    };
  }, []);
  return engine;
}

export function engineNote(engine: PdfEngine | null): string {
  if (!isDesktop) return 'Saving web pages as PDF needs the desktop app: it uses the browser installed on the computer.';
  if (!engine) return 'Looking for a browser…';
  if (engine.kind === 'chromium') return `Pages are opened by ${engine.name} in the background, with a fresh private profile (no cookies or history), and printed to PDF.`;
  if (engine.kind === 'webview') return `No Chrome, Edge, Chromium or Brave was found, so ${engine.name} prints the pages. Installing Chromium gives better results (page outlines, backgrounds).`;
  return 'Install Google Chrome, Microsoft Edge, Chromium or Brave to save web pages as PDF.';
}

function WebToPdf({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readPdf, writePdf);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const engine = useEngine();
  const urls = state.urls
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
  const ready = isDesktop && engine !== null && engine.kind !== 'none' && urls.length > 0 && !busy;

  const run = () =>
    attempt(async () => {
      setBusy(true);
      const list: Job[] = urls.map((url) => ({ url, status: 'waiting' }));
      setJobs(list);
      const done: WebPdf[] = [];
      try {
        for (let i = 0; i < list.length; i++) {
          setJobs((js) => js.map((j, k) => (k === i ? { ...j, status: 'working' } : j)));
          try {
            const result = await urlToPdf(list[i]?.url as string, { paper: state.paper, landscape: state.landscape, background: state.background, waitMs: state.wait * 1000 });
            done.push(result);
            setJobs((js) => js.map((j, k) => (k === i ? { ...j, status: 'done', result } : j)));
          } catch (e) {
            setJobs((js) => js.map((j, k) => (k === i ? { ...j, status: 'failed', error: errorMessage(e) } : j)));
          }
        }
        if (done.length === 1) {
          const page = done[0] as WebPdf;
          const outcome = await saveFile(pdfName(page), page.pdf, 'application/pdf');
          if (outcome.saved) notify(`Saved to ${outcome.location}`);
        } else if (done.length > 1) {
          const files: Record<string, Uint8Array> = {};
          for (const page of done) {
            let name = pdfName(page);
            for (let n = 2; files[name]; n++) name = pdfName(page).replace(/\.pdf$/, ` (${n}).pdf`);
            files[name] = page.pdf;
          }
          const outcome = await saveFile('web-pages.zip', zipSync(files, { level: 0 }), 'application/zip');
          if (outcome.saved) notify(`Saved ${done.length} PDFs to ${outcome.location}`);
        }
      } finally {
        setBusy(false);
      }
    });

  return (
    <section class="tool wp-tool" data-testid="tool" data-state={busy ? 'busy' : jobs.some((j) => j.status === 'done') ? 'done' : 'idle'}>
      <label class="control">
        <span class="control-label">Web addresses (one per line)</span>
        <textarea
          class="input wp-urls"
          rows={4}
          value={state.urls}
          placeholder="https://www.vismuseum.gov.in/"
          spellcheck={false}
          onInput={(e) => setState((s) => ({ ...s, urls: e.currentTarget.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ready) {
              e.preventDefault();
              run();
            }
          }}
          data-testid="wp-urls"
        />
      </label>
      <div class="button-row wp-options">
        <label class="control control-inline">
          <span class="control-label">Paper</span>
          <select class="select" value={state.paper} onChange={(e) => setState((s) => ({ ...s, paper: e.currentTarget.value as PdfState['paper'] }))}>
            {PAPERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <Segmented
          label="Orientation"
          value={state.landscape ? 'landscape' : 'portrait'}
          onChange={(v) => setState((s) => ({ ...s, landscape: v === 'landscape' }))}
          choices={[
            { value: 'portrait', label: 'Portrait' },
            { value: 'landscape', label: 'Landscape' },
          ]}
        />
        <label class="check">
          <input type="checkbox" checked={state.background} onChange={(e) => setState((s) => ({ ...s, background: e.currentTarget.checked }))} /> Background colours and pictures
        </label>
        <label class="control control-inline">
          <span class="control-label">Then wait</span>
          <input
            class="input input-narrow"
            type="number"
            min={0}
            max={30}
            value={state.wait}
            onInput={(e) => setState((s) => ({ ...s, wait: Math.min(30, Math.max(0, Number(e.currentTarget.value) || 0)) }))}
          />
          <span class="tone-muted">seconds</span>
        </label>
      </div>
      <div class="button-row">
        <button type="button" class="button button-primary" disabled={!ready} onClick={run} data-testid="wp-save">
          <Icon name="save" size={15} /> {busy ? 'Saving…' : urls.length > 1 ? `Save ${urls.length} PDFs (ZIP)` : 'Save PDF'}
        </button>
        <span class="control-help" data-testid="wp-engine">
          {engineNote(engine)}
        </span>
      </div>
      {jobs.length > 0 && (
        <ul class="wp-jobs" data-testid="wp-jobs">
          {jobs.map((j) => (
            <li key={j.url} class={`wp-job is-${j.status}`}>
              <span class="wp-status">{{ waiting: 'Waiting', working: 'Opening…', done: 'Done', failed: 'Failed' }[j.status]}</span>
              <span class="wp-url">{j.result?.title || j.url}</span>
              {j.result && <span class="tone-muted">{formatBytes(j.result.pdf.length)}</span>}
              {j.error && <span class="wp-error">{j.error}</span>}
            </li>
          ))}
        </ul>
      )}
      <p class="control-help">
        Pages are scrolled through before printing so pictures that load late appear. Sites that need a login, or show a cookie banner, print as an anonymous visitor sees them.
      </p>
    </section>
  );
}

/* ------------------------------------------------------ Website Copier -- */

interface CopyState {
  readonly url: string;
  readonly depth: number;
  readonly scope: MirrorScope;
  readonly maxPages: number;
  readonly maxMegabytes: number;
  readonly outsideAssets: boolean;
  readonly robots: boolean;
  readonly delayMs: number;
  readonly exclude: string;
}

const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && v >= min && v <= max ? v : fallback);
const readCopy = (v: Values | undefined): CopyState => ({
  url: typeof v?.url === 'string' ? v.url : '',
  depth: num(v?.depth, 0, 20, 3),
  scope: v?.scope === 'domain' || v?.scope === 'folder' ? v.scope : 'host',
  maxPages: num(v?.maxPages, 1, 100_000, 300),
  maxMegabytes: num(v?.maxMegabytes, 1, 100_000, 500),
  outsideAssets: v?.outsideAssets !== false,
  robots: v?.robots !== false,
  delayMs: num(v?.delayMs, 0, 10_000, 250),
  exclude: typeof v?.exclude === 'string' ? v.exclude : '',
});
const writeCopy = (s: CopyState): Values => ({ ...s });

function WebsiteCopier({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readCopy, writeCopy);
  const [folder, setFolder] = useState<{ token: string; path: string } | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [progress, setProgress] = useState<MirrorProgress | null>(null);
  const [summary, setSummary] = useState<MirrorSummary | null>(null);
  const set = <K extends keyof CopyState>(key: K, value: CopyState[K]) => setState((s) => ({ ...s, [key]: value }));

  useEffect(() => {
    const off = onCopyProgress((p) => setProgress(p));
    return () => void off.then((stop) => stop());
  }, []);

  const start = () =>
    attempt(async () => {
      if (!folder) throw new Error('Choose a folder for the copy first.');
      const id = `copy-${Date.now()}`;
      setJob(id);
      setSummary(null);
      setProgress(null);
      try {
        const result = await copyWebsite(id, {
          url: state.url,
          folder: folder.token,
          depth: state.depth,
          scope: state.scope,
          maxPages: state.maxPages,
          maxMegabytes: state.maxMegabytes,
          outsideAssets: state.outsideAssets,
          robots: state.robots,
          delayMs: state.delayMs,
          exclude: state.exclude
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean),
        });
        setSummary(result);
        notify(`Copied ${result.pages} ${result.pages === 1 ? 'page' : 'pages'} and ${result.files} other files`);
      } finally {
        setJob(null);
      }
    });

  const busy = job !== null;
  return (
    <section class="tool wc-tool" data-testid="tool" data-state={busy ? 'busy' : summary ? 'done' : 'idle'}>
      {!isDesktop && <p class="recipe-error">Copying websites needs the desktop app: it downloads the pages over the network.</p>}
      <div class="wc-grid">
        <label class="control wc-url">
          <span class="control-label">Website address</span>
          <input class="input" type="url" value={state.url} placeholder="https://www.example.org/" spellcheck={false} onInput={(e) => set('url', e.currentTarget.value)} data-testid="wc-url" />
        </label>
        <div class="control">
          <span class="control-label">Save the copy in</span>
          <div class="button-row">
            <button type="button" class="button" disabled={!isDesktop || busy} onClick={() => attempt(async () => setFolder(await pickFolder()))} data-testid="wc-folder">
              <Icon name="open" size={14} /> Choose folder…
            </button>
            <span class="tone-muted wc-path">{folder?.path ?? 'No folder chosen'}</span>
          </div>
        </div>
        <label class="control">
          <span class="control-label">Follow links</span>
          <select class="select" value={state.scope} onChange={(e) => set('scope', e.currentTarget.value as MirrorScope)}>
            <option value="host">On this site only</option>
            <option value="domain">On this site and its subdomains</option>
            <option value="folder">In this folder of the site only</option>
          </select>
        </label>
        <label class="control">
          <span class="control-label">Link depth</span>
          <input class="input" type="number" min={0} max={20} value={state.depth} onInput={(e) => set('depth', Math.min(20, Math.max(0, Math.round(Number(e.currentTarget.value) || 0))))} />
          <span class="control-help">0 copies only the page itself; 1 adds the pages it links to, and so on.</span>
        </label>
        <label class="control">
          <span class="control-label">At most (pages)</span>
          <input class="input" type="number" min={1} value={state.maxPages} onInput={(e) => set('maxPages', Math.max(1, Math.round(Number(e.currentTarget.value) || 1)))} />
        </label>
        <label class="control">
          <span class="control-label">At most (MB in all)</span>
          <input class="input" type="number" min={1} value={state.maxMegabytes} onInput={(e) => set('maxMegabytes', Math.max(1, Math.round(Number(e.currentTarget.value) || 1)))} />
        </label>
        <label class="control">
          <span class="control-label">Pause between requests (ms)</span>
          <input class="input" type="number" min={0} max={10000} step={50} value={state.delayMs} onInput={(e) => set('delayMs', Math.min(10_000, Math.max(0, Number(e.currentTarget.value) || 0)))} />
        </label>
        <label class="control wc-exclude">
          <span class="control-label">Leave out addresses containing (one per line)</span>
          <textarea class="input" rows={2} value={state.exclude} placeholder={'/login\n/cart'} onInput={(e) => set('exclude', e.currentTarget.value)} />
        </label>
      </div>
      <div class="button-row">
        <label class="check">
          <input type="checkbox" checked={state.outsideAssets} onChange={(e) => set('outsideAssets', e.currentTarget.checked)} /> Also copy pictures, styles and scripts the pages load from other sites
        </label>
        <label class="check">
          <input type="checkbox" checked={state.robots} onChange={(e) => set('robots', e.currentTarget.checked)} /> Follow the site's robots.txt
        </label>
      </div>
      <div class="button-row">
        {busy ? (
          <button type="button" class="button button-danger" onClick={() => job && void stopCopy(job)} data-testid="wc-stop">
            Stop
          </button>
        ) : (
          <button type="button" class="button button-primary" disabled={!isDesktop || !state.url.trim() || !folder} onClick={start} data-testid="wc-start">
            <Icon name="play" size={14} /> Copy the website
          </button>
        )}
        {progress && (busy || !summary) && (
          <span class="tone-muted wc-progress" aria-live="polite">
            {progress.pages} pages · {progress.files} files · {formatBytes(progress.bytes)} · {progress.queued} waiting{progress.failed ? ` · ${progress.failed} failed` : ''}
          </span>
        )}
      </div>
      {summary && (
        <div class="wc-summary" data-testid="wc-summary">
          <p>
            <strong>
              {summary.pages} {summary.pages === 1 ? 'page' : 'pages'} and {summary.files} other files ({formatBytes(summary.bytes)})
            </strong>{' '}
            copied. Open <code>{summary.start}</code> in the folder to browse the copy.
            {summary.skipped > 0 && ` ${summary.skipped} more links were past the page limit.`} {summary.stopped}
          </p>
          <button type="button" class="button" onClick={() => attempt(() => revealResult(summary.token))}>
            <Icon name="open" size={14} /> Show in folder
          </button>
          {summary.failed.length > 0 && (
            <details>
              <summary>{summary.failed.length} addresses could not be copied</summary>
              <ul class="wc-failed">
                {summary.failed.map(([url, error]) => (
                  <li key={url}>
                    <code>{url}</code> — {error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <p class="control-help">
        Copy only sites you may copy, such as your own or openly licensed ones. The copier waits between requests, follows robots.txt and stops at the limits you set; pages that build themselves with
        scripts may need their scripts to work offline.
      </p>
    </section>
  );
}

function WebTools({ toolId }: { toolId: string }) {
  if (toolId === 'website-copier') return <WebsiteCopier toolId={toolId} />;
  return <WebToPdf toolId={toolId} />;
}

export default defineCustomTool(WebTools);
