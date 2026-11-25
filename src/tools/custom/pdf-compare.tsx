/**
 * PDF Compare: two versions of a PDF side by side.  The words that were
 * removed and added are marked on the pages and listed with the words around
 * them, and a difference picture shows every page's changed pixels.  Both
 * versions can be saved with the changes marked as highlights, and the
 * changes as a Markdown report.
 */
import { PDFDocument } from 'pdf-lib';
import { useMemo, useState } from 'preact/hooks';
import { type Annotation, mergeLines, newAnnotationId, saveAnnotations } from '../../lib/pdf-annotate';
import { type Change, changesOf, compareText, pixelDiff, type Segment, type Word, wordsOf } from '../../lib/pdf-diff';
import { pageText } from '../../lib/pdf-page-text';
import type { Box } from '../../lib/pdf-redact';
import { openPdf, type PdfDocument, renderPage } from '../../lib/pdf-render';
import { saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { FileBar, FileDrop, type PdfFile, readPdf, save, stem } from './_pdf';
import { Segmented, usePersistentState } from './_shared';

const TOOL_ID = 'pdf-compare';
/** Pages compared as pictures, at most. */
const MAX_PAGES = 300;

type View = 'pages' | 'text';
type Detail = 'normal' | 'fine';
type Strictness = 'strict' | 'normal' | 'loose';

interface Settings {
  readonly view: View;
  readonly detail: Detail;
  readonly strictness: Strictness;
  readonly onlyChanged: boolean;
}

const SCALES: Record<Detail, number> = { normal: 1.25, fine: 2 };
const TOLERANCES: Record<Strictness, number> = { strict: 24, normal: 48, loose: 96 };

const readSettings = (v: Values | undefined): Settings => ({
  view: v?.view === 'text' ? 'text' : 'pages',
  detail: v?.detail === 'fine' ? 'fine' : 'normal',
  strictness: v?.strictness === 'strict' || v?.strictness === 'loose' ? v.strictness : 'normal',
  onlyChanged: v?.onlyChanged !== false,
});

interface Size {
  readonly width: number;
  readonly height: number;
}

interface PageResult {
  readonly n: number;
  readonly a: string | null;
  readonly b: string | null;
  readonly diff: string | null;
  readonly sizeA: Size | null;
  readonly sizeB: Size | null;
  /** Share of the picture that changed. */
  readonly share: number;
}

interface Result {
  readonly key: string;
  readonly pages: readonly PageResult[];
  readonly segments: readonly Segment[];
  readonly changes: readonly Change[];
  readonly removed: number;
  readonly added: number;
  readonly pagesA: number;
  readonly pagesB: number;
  readonly pictured: number;
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

async function readWords(doc: PdfDocument, progress: (n: number) => void): Promise<Word[]> {
  const words: Word[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    progress(n);
    words.push(...wordsOf((await pageText(doc, n)).items, n));
  }
  return words;
}

async function pictureOf(doc: PdfDocument, n: number, scale: number): Promise<{ url: string; data: ImageData; size: Size }> {
  const canvas = await renderPage(doc, n, scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a drawing surface.');
  const page = await doc.getPage(n);
  const view = page.getViewport({ scale: 1 });
  return { url: canvas.toDataURL('image/jpeg', 0.85), data: context.getImageData(0, 0, canvas.width, canvas.height), size: { width: view.width, height: view.height } };
}

function differencePicture(a: ImageData | null, b: ImageData | null, tolerance: number): { url: string; share: number } {
  const blank = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) };
  const d = pixelDiff(a ?? blank, b ?? blank, tolerance);
  const canvas = document.createElement('canvas');
  canvas.width = d.width;
  canvas.height = d.height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(d.data), d.width, d.height), 0, 0);
  return { url: canvas.toDataURL('image/png'), share: d.changed / Math.max(1, d.width * d.height) };
}

/** Boxes of the given words on each page. */
function boxesByPage(words: readonly Word[]): Map<number, Box[]> {
  const out = new Map<number, Box[]>();
  for (const w of words) out.set(w.page, [...(out.get(w.page) ?? []), w.box]);
  return out;
}

function Shot({ url, size, boxes, tone, label }: { url: string | null; size: Size | null; boxes: readonly Box[]; tone: 'removed' | 'added'; label: string }) {
  if (!url || !size) return <div class="cmp-missing">No such page</div>;
  return (
    <div class="cmp-shot">
      <img src={url} alt={label} />
      {boxes.length > 0 && (
        <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
          {boxes.map((b, i) => (
            <rect key={i} x={b.x - 1} y={b.y - 1} width={b.w + 2} height={b.h + 2} class={`cmp-mark is-${tone}`} />
          ))}
        </svg>
      )}
    </div>
  );
}

function PdfCompare() {
  const [settings, setSettings] = usePersistentState(TOOL_ID, readSettings, (s) => ({ ...s }));
  const [a, setA] = useState<PdfFile | null>(null);
  const [b, setB] = useState<PdfFile | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const key = a && b ? `${a.id}|${b.id}|${settings.detail}|${settings.strictness}` : '';
  const current = result && result.key === key ? result : null;

  const take = (which: 'a' | 'b') => (files: File[]) =>
    attempt(async () => {
      const first = files[0];
      if (!first) return;
      const file = await readPdf(first);
      if (which === 'a') setA(file);
      else setB(file);
    });

  const run = () =>
    attempt(async () => {
      if (!a || !b) return;
      const [da, db] = await Promise.all([openPdf(a.bytes), openPdf(b.bytes)]);
      try {
        const aWords = await readWords(da.doc, (n) => setBusy(`Reading the words of the original, page ${n} of ${da.doc.numPages}…`));
        const bWords = await readWords(db.doc, (n) => setBusy(`Reading the words of the changed version, page ${n} of ${db.doc.numPages}…`));
        setBusy('Comparing the words…');
        await new Promise((resolve) => setTimeout(resolve, 0));
        const segments = compareText(aWords, bWords);
        const changes = changesOf(segments);
        const scale = SCALES[settings.detail];
        const tolerance = TOLERANCES[settings.strictness];
        const total = Math.max(da.doc.numPages, db.doc.numPages);
        const pictured = Math.min(total, MAX_PAGES);
        const pages: PageResult[] = [];
        for (let n = 1; n <= pictured; n++) {
          setBusy(`Comparing the pictures of page ${n} of ${pictured}…`);
          const pa = n <= da.doc.numPages ? await pictureOf(da.doc, n, scale) : null;
          const pb = n <= db.doc.numPages ? await pictureOf(db.doc, n, scale) : null;
          const d = differencePicture(pa?.data ?? null, pb?.data ?? null, tolerance);
          pages.push({ n, a: pa?.url ?? null, b: pb?.url ?? null, diff: d.url, sizeA: pa?.size ?? null, sizeB: pb?.size ?? null, share: pa && pb ? d.share : 1 });
        }
        const removed = segments.reduce((sum, s) => sum + (s.op === 'removed' ? s.a.length : 0), 0);
        const added = segments.reduce((sum, s) => sum + (s.op === 'added' ? s.b.length : 0), 0);
        setResult({ key, pages, segments, changes, removed, added, pagesA: da.doc.numPages, pagesB: db.doc.numPages, pictured });
      } finally {
        setBusy(null);
        await Promise.all([da.close(), db.close()]);
      }
    });

  const marks = useMemo(() => {
    const removed = current?.segments.flatMap((s) => (s.op === 'removed' ? s.a : [])) ?? [];
    const added = current?.segments.flatMap((s) => (s.op === 'added' ? s.b : [])) ?? [];
    return { removed: boxesByPage(removed), added: boxesByPage(added) };
  }, [current]);

  /** A copy of one version with its changed words highlighted. */
  const saveMarked = (which: 'a' | 'b') =>
    attempt(async () => {
      const file = which === 'a' ? a : b;
      if (!file || !current) return;
      const doc = await PDFDocument.load(file.bytes, { ignoreEncryption: true, updateMetadata: false });
      const made: Annotation[] = [];
      for (const change of current.changes) {
        const words = which === 'a' ? change.removed : change.added;
        for (const page of new Set(words.map((w) => w.page))) {
          const onPage = words.filter((w) => w.page === page);
          made.push({
            id: newAnnotationId(),
            kind: 'highlight',
            page,
            color: which === 'a' ? '#d55e00' : '#56b4e9',
            opacity: 1,
            text: onPage.map((w) => w.text).join(' '),
            boxes: mergeLines(onPage.map((w) => w.box)),
            comment:
              which === 'a'
                ? `Removed${change.added.length ? `; now “${change.added.map((w) => w.text).join(' ')}”` : ''}`
                : `Added${change.removed.length ? `; was “${change.removed.map((w) => w.text).join(' ')}”` : ''}`,
            author: 'PDF Compare',
            modified: new Date().toISOString(),
          });
        }
      }
      if (!made.length) {
        notify(which === 'a' ? 'Nothing was removed, so there is nothing to mark.' : 'Nothing was added, so there is nothing to mark.');
        return;
      }
      await saveAnnotations(doc, { write: made, remove: [], flatten: false });
      await save(`${stem(file.name)} (${which === 'a' ? 'removals' : 'additions'} marked).pdf`, await doc.save());
    });

  const saveReport = () =>
    attempt(async () => {
      if (!a || !b || !current) return;
      const lines = [
        `# ${a.name} compared with ${b.name}`,
        '',
        `- ${plural(current.removed, 'word')} removed, ${plural(current.added, 'word')} added, in ${plural(current.changes.length, 'place')}.`,
        `- Pages: ${current.pagesA} in the original, ${current.pagesB} in the changed version.`,
        `- Pages whose pictures differ: ${
          current.pages
            .filter((p) => p.share > 0)
            .map((p) => p.n)
            .join(', ') || 'none'
        }.`,
        '',
        '## Changes',
        '',
      ];
      current.changes.forEach((c, i) => {
        lines.push(
          `${i + 1}. Page ${c.pageA} → page ${c.pageB}: …${c.before} ${c.removed.length ? `~~${c.removed.map((w) => w.text).join(' ')}~~ ` : ''}${c.added.length ? `**${c.added.map((w) => w.text).join(' ')}** ` : ''}${c.after}…`,
        );
      });
      if (!current.changes.length) lines.push('The words are the same.');
      const done = await saveFile(`${stem(b.name)} changes.md`, new TextEncoder().encode(`${lines.join('\n')}\n`), 'text/markdown');
      if (done.saved) notify(`Saved to ${done.location}`);
    });

  const shown = current ? current.pages.filter((p) => !settings.onlyChanged || p.share > 0 || marks.removed.has(p.n) || marks.added.has(p.n)) : [];
  const differing = current ? current.pages.filter((p) => p.share > 0).length : 0;

  return (
    <section class="tool cmp-tool" data-testid="tool" data-state={busy ? 'busy' : current ? 'done' : a && b ? 'ready' : 'idle'}>
      <div class="cmp-files">
        {(['a', 'b'] as const).map((which) => {
          const file = which === 'a' ? a : b;
          const label = which === 'a' ? 'Original' : 'Changed version';
          return (
            <div key={which} class="cmp-file">
              <h3>{label}</h3>
              {file ? (
                <FileBar file={file} onReplace={() => (which === 'a' ? setA(null) : setB(null))} onClear={() => (which === 'a' ? setA(null) : setB(null))} />
              ) : (
                <FileDrop accept=".pdf,application/pdf" multiple={false} compact onFiles={take(which)} title={`Choose or drop the ${label.toLowerCase()}`} testId={`cmp-drop-${which}`} />
              )}
            </div>
          );
        })}
      </div>
      <div class="cmp-options">
        <Segmented
          label="Detail"
          value={settings.detail}
          choices={[
            { value: 'normal', label: 'Normal detail' },
            { value: 'fine', label: 'Fine detail' },
          ]}
          onChange={(detail) => setSettings((s) => ({ ...s, detail }))}
        />
        <label class="cmp-inline">
          Differences in the pictures
          <select class="input input-small" value={settings.strictness} onChange={(e) => setSettings((s) => ({ ...s, strictness: e.currentTarget.value as Strictness }))}>
            <option value="strict">Show the faintest</option>
            <option value="normal">Ignore faint ones</option>
            <option value="loose">Only clear ones</option>
          </select>
        </label>
        <button
          type="button"
          class="button button-small"
          disabled={!a || !b}
          onClick={() => {
            setA(b);
            setB(a);
          }}
          title="Swap the two files"
        >
          Swap
        </button>
        <button type="button" class="button button-primary" data-testid="cmp-run" disabled={!a || !b || !!busy} onClick={run}>
          Compare
        </button>
      </div>
      {busy && (
        <p class="tone-muted" role="status" data-testid="cmp-busy">
          {busy}
        </p>
      )}
      {current && (
        <>
          <div class="cmp-summary" data-testid="cmp-summary">
            <p>
              <strong>{current.changes.length ? plural(current.changes.length, 'change') : 'The words are the same'}</strong>
              {current.changes.length > 0 && (
                <>
                  : <span class="cmp-chip is-removed">{plural(current.removed, 'word')} removed</span> <span class="cmp-chip is-added">{plural(current.added, 'word')} added</span>
                </>
              )}
              . {differing ? `${plural(differing, 'page')} of ${current.pictured} look different.` : 'The pages look the same.'}
              {current.pagesA !== current.pagesB && ` The original has ${plural(current.pagesA, 'page')}, the changed version ${current.pagesB}.`}
              {current.pictured < Math.max(current.pagesA, current.pagesB) && ` Pictures are compared for the first ${MAX_PAGES} pages.`}
            </p>
            <div class="button-row">
              <button type="button" class="button button-small" data-testid="cmp-save-report" onClick={saveReport}>
                Save the changes (Markdown)
              </button>
              <button type="button" class="button button-small" data-testid="cmp-save-a" disabled={!current.removed} onClick={() => saveMarked('a')}>
                Save the original, removals marked
              </button>
              <button type="button" class="button button-small" data-testid="cmp-save-b" disabled={!current.added} onClick={() => saveMarked('b')}>
                Save the changed version, additions marked
              </button>
            </div>
          </div>
          <div class="cmp-bar">
            <Segmented
              label="Show"
              value={settings.view}
              choices={[
                { value: 'pages', label: 'Pages' },
                { value: 'text', label: 'Word changes' },
              ]}
              onChange={(view) => setSettings((s) => ({ ...s, view }))}
            />
            {settings.view === 'pages' && (
              <label class="check">
                <input type="checkbox" checked={settings.onlyChanged} data-testid="cmp-only-changed" onChange={(e) => setSettings((s) => ({ ...s, onlyChanged: e.currentTarget.checked }))} /> Only
                pages that changed
              </label>
            )}
            <span class="cmp-key">
              <span class="cmp-chip is-removed">Removed</span> <span class="cmp-chip is-added">Added</span> <span class="cmp-chip is-recoloured">Colour changed</span>
            </span>
          </div>
          {settings.view === 'pages' ? (
            <div class="cmp-pages" data-testid="cmp-pages">
              {shown.length ? (
                shown.map((p) => (
                  <section key={p.n} class="cmp-page" data-testid={`cmp-page-${p.n}`}>
                    <h3>
                      Page {p.n}{' '}
                      <span class="tone-muted">
                        {p.share > 0 ? `${p.share < 0.001 ? 'under 0.1' : (p.share * 100).toFixed(1)}% of the picture changed` : 'same picture'}
                        {(marks.removed.get(p.n)?.length ?? 0) + (marks.added.get(p.n)?.length ?? 0) > 0 &&
                          `; ${plural(marks.removed.get(p.n)?.length ?? 0, 'word')} removed, ${marks.added.get(p.n)?.length ?? 0} added`}
                      </span>
                    </h3>
                    <div class="cmp-row">
                      <figure>
                        <Shot url={p.a} size={p.sizeA} boxes={marks.removed.get(p.n) ?? []} tone="removed" label={`Original, page ${p.n}`} />
                        <figcaption>Original</figcaption>
                      </figure>
                      <figure>
                        <Shot url={p.b} size={p.sizeB} boxes={marks.added.get(p.n) ?? []} tone="added" label={`Changed version, page ${p.n}`} />
                        <figcaption>Changed version</figcaption>
                      </figure>
                      <figure>
                        <div class="cmp-shot">{p.diff && <img src={p.diff} alt={`Difference, page ${p.n}`} />}</div>
                        <figcaption>Difference</figcaption>
                      </figure>
                    </div>
                  </section>
                ))
              ) : (
                <p class="tone-muted">No page changed.</p>
              )}
            </div>
          ) : (
            <ol class="cmp-changes" data-testid="cmp-changes">
              {current.changes.map((c, i) => (
                <li key={i}>
                  <span class="tone-muted cmp-where">{c.pageA === c.pageB ? `Page ${c.pageA}` : `Page ${c.pageA} → ${c.pageB}`}</span>
                  <span>
                    {c.before && <span class="tone-muted">…{c.before} </span>}
                    {c.removed.length > 0 && <del class="cmp-del">{c.removed.map((w) => w.text).join(' ')}</del>}
                    {c.removed.length > 0 && c.added.length > 0 && ' '}
                    {c.added.length > 0 && <ins class="cmp-ins">{c.added.map((w) => w.text).join(' ')}</ins>}
                    {c.after && <span class="tone-muted"> {c.after}…</span>}
                  </span>
                </li>
              ))}
              {!current.changes.length && (
                <li>
                  <Icon name="check" size={14} /> The words are the same.
                </li>
              )}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

export default defineCustomTool(PdfCompare);
