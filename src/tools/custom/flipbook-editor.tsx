/**
 * Flipbook Editor: page-turn publications, in the manner of FlipHTML5 and
 * Heyzine, made from PDFs, pictures and blank pages, with hotspots (links,
 * pages, video and sound, notes), contents, hard covers, one or two pages at
 * a time, right-to-left reading, a background, a page-turn sound and a kiosk
 * mode.  Saved as a .flipbook project and exported as one HTML file that
 * works offline.
 */

import pageFlipSource from 'page-flip/dist/js/page-flip.browser.js?raw';
import { PageFlip } from 'page-flip/dist/js/page-flip.module.js';
import pageFlipLicence from 'page-flip/LICENSE?raw';
import { PDFDocument } from 'pdf-lib';
import type { TargetedPointerEvent } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type Asset,
  type Book,
  type BookPage,
  type BookSettings,
  blankPage,
  emptyBook,
  exportHtml,
  type Hotspot,
  isSafeLink,
  newId,
  normaliseBook,
  openProject,
  runtimeData,
  saveProject,
} from '../../lib/flipbook';
import type { FlipAction } from '../../lib/flipbook-runtime';
import { describeAction, mountFlipbook } from '../../lib/flipbook-runtime.js';
import runtimeSource from '../../lib/flipbook-runtime.js?raw';
import { pageText } from '../../lib/pdf-page-text';
import { joinItems } from '../../lib/pdf-redact';
import { openPdf, renderPage } from '../../lib/pdf-render';
import { type OutlineItem, readOutline } from '../../lib/pdf-toolbox';
import { openLink, pickFiles } from '../../platform';
import { encodeCanvas, loadImage } from '../../ui/canvas';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { save } from './_pdf';
import { Segmented } from './_shared';

type Panel = 'page' | 'book' | 'contents';
type Busy = (text: string | null) => void;

const WEB_PICTURES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml']);
const ACTIONS: readonly { kind: FlipAction['kind']; label: string }[] = [
  { kind: 'note', label: 'Show a note' },
  { kind: 'link', label: 'Open a web page' },
  { kind: 'page', label: 'Go to a page' },
  { kind: 'video', label: 'Play a video' },
  { kind: 'audio', label: 'Play a sound' },
];

const slug = (title: string) =>
  title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'flipbook';

const flatten = (items: readonly OutlineItem[]): { title: string; page: number }[] =>
  items.flatMap((item) => [...(item.page > 0 ? [{ title: item.title, page: item.page }] : []), ...flatten(item.children)]);

/** A PDF's pages as pictures (about 1600 pixels tall) with their words, and its outline. */
async function pagesFromPdf(file: File, busy: Busy) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { doc, close } = await openPdf(bytes);
  try {
    const pages: { page: BookPage; asset: [string, Asset] }[] = [];
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    const stem = file.name.replace(/\.[^.]+$/, '');
    for (let n = 1; n <= doc.numPages; n++) {
      busy(`Drawing page ${n} of ${doc.numPages} of ${file.name}…`);
      const view = (await doc.getPage(n)).getViewport({ scale: 1 });
      const canvas = await renderPage(doc, n, Math.min(4, 1600 / Math.max(1, view.height)));
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
      if (!blob) throw new Error(`Page ${n} could not be drawn.`);
      const id = newId('a');
      let text = '';
      try {
        text = joinItems((await pageText(doc, n)).items).text;
      } catch {
        // A page without readable text.
      }
      pages.push({
        page: { id: newId('p'), image: id, color: '#ffffff', text, hotspots: [] },
        asset: [id, { name: `${stem}-${n}.jpg`, type: 'image/jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) }],
      });
    }
    let outline: { title: string; page: number }[] = [];
    try {
      outline = flatten(readOutline(await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })));
    } catch {
      // No outline.
    }
    return { pages, outline, width: Math.round(first.width), height: Math.round(first.height) };
  } finally {
    await close();
  }
}

/** Pictures as pages; formats web pages cannot show (HEIC, TIFF, BMP) become JPEG. */
async function pagesFromPictures(files: File[], busy: Busy) {
  const pages: { page: BookPage; asset: [string, Asset] }[] = [];
  let size: { width: number; height: number } | null = null;
  for (const [i, file] of files.entries()) {
    busy(`Adding picture ${i + 1} of ${files.length}…`);
    const canvas = await loadImage(file);
    size ??= { width: canvas.width, height: canvas.height };
    let bytes = new Uint8Array(await file.arrayBuffer());
    let type = file.type;
    if (!WEB_PICTURES.has(type)) {
      bytes = new Uint8Array(await (await encodeCanvas(canvas, { format: 'jpeg', quality: 88, matte: '#ffffff' })).arrayBuffer());
      type = 'image/jpeg';
    }
    const id = newId('a');
    pages.push({ page: { id: newId('p'), image: id, color: '#ffffff', text: '', hotspots: [] }, asset: [id, { name: file.name, type, bytes }] });
  }
  return { pages, size };
}

function useAssetUrls(book: Book): (id: string) => string {
  const cache = useRef(new Map<string, { asset: Asset; url: string }>());
  useEffect(() => {
    // URLs of assets the book no longer has are let go.
    for (const [id, entry] of cache.current) {
      if (book.assets[id] !== entry.asset) {
        URL.revokeObjectURL(entry.url);
        cache.current.delete(id);
      }
    }
  }, [book.assets]);
  useEffect(
    () => () => {
      for (const entry of cache.current.values()) URL.revokeObjectURL(entry.url);
      cache.current.clear();
    },
    [],
  );
  return (id: string) => {
    const asset = book.assets[id];
    if (!asset) return '';
    const known = cache.current.get(id);
    if (known && known.asset === asset) return known.url;
    const url = URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: asset.type }));
    cache.current.set(id, { asset, url });
    return url;
  };
}

function Preview({ book, url, onClose }: { book: Book; url: (id: string) => string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const controller = mountFlipbook(host.current, runtimeData(book, url), {
      PageFlip,
      openLink: (link) => void openLink(link).catch((error) => notify(error instanceof Error ? error.message : String(error), 'error')),
    });
    host.current.focus();
    return () => controller.destroy();
  }, [book]);
  return (
    <div class="fbe-preview" data-testid="fbe-preview" role="dialog" aria-modal="true" aria-label={`Preview of ${book.title}`}>
      <div class="fbe-preview-bar">
        <strong>Preview: {book.title}</strong>
        <button type="button" class="button button-small" onClick={onClose} data-testid="fbe-preview-close">
          Close the preview
        </button>
      </div>
      <div class="fbe-preview-book" ref={host} />
    </div>
  );
}

function FlipbookEditor() {
  const [book, setBook] = useState<Book>(emptyBook);
  const [selected, setSelected] = useState(0);
  const [hotspotId, setHotspotId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [panel, setPanel] = useState<Panel>('page');
  const [preview, setPreview] = useState(false);
  const [busyText, setBusyText] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ kind: 'draw' | 'move' | 'size'; from: [number, number]; spot?: Hotspot } | null>(null);
  const url = useAssetUrls(book);

  const page = book.pages[selected] ?? null;
  const hotspot = page?.hotspots.find((h) => h.id === hotspotId) ?? null;
  const ratio = book.width / book.height;

  const change = (next: (b: Book) => Book) => setBook((b) => next(b));
  const setSettings = (patch: Partial<BookSettings>) => change((b) => ({ ...b, settings: { ...b.settings, ...patch } }));
  const updatePage = (index: number, patch: (p: BookPage) => BookPage) => change((b) => ({ ...b, pages: b.pages.map((p, i) => (i === index ? patch(p) : p)) }));
  const updateHotspot = (id: string, patch: (h: Hotspot) => Hotspot) => updatePage(selected, (p) => ({ ...p, hotspots: p.hotspots.map((h) => (h.id === id ? patch(h) : h)) }));

  const busy: Busy = setBusyText;
  const run = (job: () => Promise<void>) =>
    attempt(async () => {
      try {
        await job();
      } finally {
        setBusyText(null);
      }
    });

  /** Puts new pages after the chosen one (or at the end) and adds their pictures. */
  const insert = (made: { page: BookPage; asset?: [string, Asset] }[], size?: { width: number; height: number } | null, outline?: { title: string; page: number }[]) => {
    if (!made.length) return;
    change((b) => {
      const at = b.pages.length ? Math.min(b.pages.length, selected + 1) : 0;
      const pages = [...b.pages.slice(0, at), ...made.map((m) => m.page), ...b.pages.slice(at)];
      const assets = { ...b.assets };
      for (const m of made) if (m.asset) assets[m.asset[0]] = m.asset[1];
      // Contents after the new pages move with them; a PDF's outline comes in with it.
      const shifted = b.contents.map((c) => (c.page > at ? { ...c, page: c.page + made.length } : c));
      const added = (outline ?? []).map((c) => ({ title: c.title, page: c.page + at }));
      const first = !b.pages.length && size;
      return { ...b, pages, assets, contents: [...shifted, ...added], ...(first ? { width: size.width, height: size.height } : {}) };
    });
    setSelected((s) => (book.pages.length ? Math.min(book.pages.length, s + 1) : 0));
    setHotspotId(null);
  };

  const addPdf = () =>
    run(async () => {
      const files = await pickFiles('.pdf,application/pdf');
      // Several PDFs go in one after another, in the order chosen.
      const pages: { page: BookPage; asset: [string, Asset] }[] = [];
      const outline: { title: string; page: number }[] = [];
      let size: { width: number; height: number } | null = null;
      for (const file of files) {
        const made = await pagesFromPdf(file, busy);
        size ??= { width: made.width, height: made.height };
        outline.push(...made.outline.map((c) => ({ ...c, page: c.page + pages.length })));
        pages.push(...made.pages);
      }
      insert(pages, size, outline);
    });

  const addPictures = () =>
    run(async () => {
      const files = await pickFiles('image/*,.heic,.heif');
      if (!files.length) return;
      const { pages, size } = await pagesFromPictures(files, busy);
      insert(pages, size);
    });

  const movePage = (from: number, to: number) => {
    if (to < 0 || to >= book.pages.length) return;
    change((b) => {
      const pages = [...b.pages];
      const [moved] = pages.splice(from, 1);
      if (moved) pages.splice(to, 0, moved);
      return { ...b, pages };
    });
    setSelected(to);
  };

  const removePage = (index: number) => {
    change((b) => {
      const pages = b.pages.filter((_, i) => i !== index);
      const contents = b.contents.filter((c) => c.page !== index + 1).map((c) => (c.page > index + 1 ? { ...c, page: c.page - 1 } : c));
      return { ...b, pages, contents };
    });
    setSelected((s) => Math.max(0, Math.min(s, book.pages.length - 2)));
    setHotspotId(null);
  };

  const duplicatePage = (index: number) => {
    const source = book.pages[index];
    if (!source) return;
    insert([{ page: { ...source, id: newId('p'), hotspots: source.hotspots.map((h) => ({ ...h, id: newId('h') })) } }]);
  };

  const chooseMedia = (kind: 'video' | 'audio') =>
    run(async () => {
      const [file] = await pickFiles(kind === 'video' ? 'video/*' : 'audio/*');
      if (!file || !hotspot) return;
      if (file.size > 200 * 1024 * 1024) throw new Error('That file is over 200 MB; exported flipbooks carry their media inside, so keep it small.');
      const type = file.type || (kind === 'video' ? 'video/mp4' : 'audio/mpeg');
      if (!type.startsWith(`${kind}/`)) throw new Error(`That is not ${kind === 'video' ? 'a video' : 'a sound'} file.`);
      const id = newId('m');
      const bytes = new Uint8Array(await file.arrayBuffer());
      change((b) => ({ ...b, assets: { ...b.assets, [id]: { name: file.name, type, bytes } } }));
      updateHotspot(hotspot.id, (h) => ({ ...h, action: { kind, media: id, title: file.name.replace(/\.[^.]+$/, '') } }));
    });

  const setAction = (h: Hotspot, kind: FlipAction['kind']) => {
    if (h.action.kind === kind) return;
    const action: FlipAction | null =
      kind === 'note' ? { kind, title: h.label || 'Note', text: '' } : kind === 'link' ? { kind, url: 'https://' } : kind === 'page' ? { kind, page: Math.min(book.pages.length, selected + 2) } : null;
    if (action) updateHotspot(h.id, (old) => ({ ...old, action }));
    else chooseMedia(kind as 'video' | 'audio');
  };

  // ------------------------------------------------------------ hotspots on the page

  const fractionOf = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r?.width || !r.height) return [0, 0];
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const onDown = (e: TargetedPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !page) return;
    const at = fractionOf(e);
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-spot]');
    const spot = target ? page.hotspots.find((h) => h.id === target.dataset.spot) : undefined;
    if (spot && !drawing) {
      setHotspotId(spot.id);
      setPanel('page');
      dragging.current = { kind: (e.target as HTMLElement).classList.contains('fbe-handle') ? 'size' : 'move', from: at, spot };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (!drawing) {
      setHotspotId(null);
      return;
    }
    dragging.current = { kind: 'draw', from: at };
    setDraft({ x: at[0], y: at[1], w: 0, h: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: TargetedPointerEvent<HTMLDivElement>) => {
    const d = dragging.current;
    if (!d) return;
    const [x, y] = fractionOf(e);
    if (d.kind === 'draw') {
      setDraft({ x: Math.min(x, d.from[0]), y: Math.min(y, d.from[1]), w: Math.abs(x - d.from[0]), h: Math.abs(y - d.from[1]) });
      return;
    }
    const spot = d.spot;
    if (!spot) return;
    const dx = x - d.from[0];
    const dy = y - d.from[1];
    if (d.kind === 'move') updateHotspot(spot.id, (h) => ({ ...h, x: Math.min(1 - h.w, Math.max(0, spot.x + dx)), y: Math.min(1 - h.h, Math.max(0, spot.y + dy)) }));
    else updateHotspot(spot.id, (h) => ({ ...h, w: Math.min(1 - h.x, Math.max(0.02, spot.w + dx)), h: Math.min(1 - h.y, Math.max(0.02, spot.h + dy)) }));
  };

  const onUp = () => {
    const d = dragging.current;
    dragging.current = null;
    if (d?.kind !== 'draw' || !draft) return;
    setDraft(null);
    // A click without a drag makes a box of a sensible size.
    const box = draft.w < 0.01 || draft.h < 0.01 ? { x: Math.min(0.8, draft.x), y: Math.min(0.9, draft.y), w: 0.2, h: 0.1 } : draft;
    const made: Hotspot = { id: newId('h'), ...box, label: '', action: { kind: 'note', title: 'Note', text: '' } };
    updatePage(selected, (p) => ({ ...p, hotspots: [...p.hotspots, made] }));
    setHotspotId(made.id);
    setDrawing(false);
    setPanel('page');
  };

  // ------------------------------------------------------------ files

  const cleaned = () => normaliseBook({ ...book }, book.assets);

  const saveBook = () => run(async () => save(`${slug(book.title)}.flipbook`, saveProject(cleaned()), 'application/zip'));
  const exportBook = () =>
    run(async () => {
      if (!book.pages.length) throw new Error('Add some pages first.');
      busy('Putting the flipbook into one HTML file…');
      const html = exportHtml(cleaned(), runtimeSource, pageFlipSource, pageFlipLicence);
      await save(`${slug(book.title)}.html`, new TextEncoder().encode(html), 'text/html');
    });
  const openBook = () =>
    run(async () => {
      const [file] = await pickFiles('.flipbook,application/zip');
      if (!file) return;
      const opened = openProject(new Uint8Array(await file.arrayBuffer()));
      setBook(opened);
      setSelected(0);
      setHotspotId(null);
      notify(`Opened ${file.name}: ${opened.pages.length} page${opened.pages.length === 1 ? '' : 's'}.`);
    });

  // What the preview shows: the book as it will be saved, made again only when the book changes.
  const previewBook = useMemo(() => (preview ? cleaned() : null), [preview, book]);

  const assetsSize = useMemo(() => Object.values(book.assets).reduce((sum, a) => sum + a.bytes.length, 0), [book.assets]);

  const thumb = (p: BookPage) => (p.image ? <img src={url(p.image)} alt="" loading="lazy" /> : <span class="fbe-blank" style={{ background: p.color }} />);

  return (
    <section class="tool fbe-tool" data-testid="tool" data-pages={book.pages.length} data-state={busyText ? 'busy' : 'ready'}>
      <div class="fbe-bar">
        <input
          type="text"
          class="input fbe-title"
          value={book.title}
          maxLength={200}
          data-testid="fbe-title"
          aria-label="Title of the flipbook"
          onInput={(e) => change((b) => ({ ...b, title: e.currentTarget.value }))}
        />
        <button
          type="button"
          class="button button-small"
          onClick={() => {
            setBook(emptyBook());
            setSelected(0);
            setHotspotId(null);
          }}
        >
          New
        </button>
        <button type="button" class="button button-small" onClick={openBook} data-testid="fbe-open">
          Open…
        </button>
        <button type="button" class="button button-small" onClick={saveBook} disabled={!book.pages.length} data-testid="fbe-save">
          Save project
        </button>
        <button type="button" class="button button-small" onClick={exportBook} disabled={!book.pages.length} data-testid="fbe-export">
          Export HTML
        </button>
        <button type="button" class="button button-primary button-small" onClick={() => setPreview(true)} disabled={!book.pages.length} data-testid="fbe-preview-open">
          <Icon name="play" size={14} /> Preview
        </button>
        <span class="tone-muted fbe-size">{(assetsSize / 1e6).toFixed(1)} MB</span>
      </div>
      {busyText && (
        <p class="tone-muted" role="status" data-testid="fbe-busy">
          {busyText}
        </p>
      )}
      <div class="fbe-layout" inert={!!previewBook}>
        <aside class="fbe-pages" aria-label="Pages">
          <div class="fbe-add">
            <button type="button" class="button button-small" onClick={addPdf} data-testid="fbe-add-pdf">
              Add PDF
            </button>
            <button type="button" class="button button-small" onClick={addPictures} data-testid="fbe-add-pictures">
              Add pictures
            </button>
            <button type="button" class="button button-small" onClick={() => insert([{ page: blankPage() }])} data-testid="fbe-add-blank">
              Add blank page
            </button>
          </div>
          {book.pages.length ? (
            <ol class="fbe-page-list">
              {book.pages.map((p, i) => (
                <li key={p.id} class={i === selected ? 'is-selected' : ''}>
                  <button
                    type="button"
                    class="fbe-page-pick"
                    aria-current={i === selected}
                    aria-label={`Page ${i + 1}${p.hotspots.length ? `, ${p.hotspots.length} hotspot${p.hotspots.length === 1 ? '' : 's'}` : ''}`}
                    onClick={() => {
                      setSelected(i);
                      setHotspotId(null);
                    }}
                    data-testid={`fbe-page-${i + 1}`}
                  >
                    <span class="fbe-thumb" style={{ aspectRatio: `${ratio}` }}>
                      {thumb(p)}
                    </span>
                    <span class="fbe-number">{i + 1}</span>
                  </button>
                  <span class="fbe-page-tools">
                    <button type="button" class="button button-small" aria-label={`Move page ${i + 1} up`} disabled={i === 0} onClick={() => movePage(i, i - 1)}>
                      <Icon name="up" size={13} />
                    </button>
                    <button type="button" class="button button-small" aria-label={`Move page ${i + 1} down`} disabled={i === book.pages.length - 1} onClick={() => movePage(i, i + 1)}>
                      <Icon name="down" size={13} />
                    </button>
                    <button type="button" class="button button-small" aria-label={`Copy page ${i + 1}`} onClick={() => duplicatePage(i)}>
                      <Icon name="copy" size={13} />
                    </button>
                    <button type="button" class="button button-small button-quiet" aria-label={`Delete page ${i + 1}`} onClick={() => removePage(i)} data-testid={`fbe-delete-${i + 1}`}>
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p class="tone-muted">Add a PDF, pictures or blank pages to start.</p>
          )}
        </aside>
        <div class="fbe-main">
          {page ? (
            <>
              <div class="fbe-canvas-bar">
                <span>
                  Page {selected + 1} of {book.pages.length}
                </span>
                <button type="button" class={`button button-small ${drawing ? 'button-primary' : ''}`} aria-pressed={drawing} onClick={() => setDrawing((d) => !d)} data-testid="fbe-draw">
                  {drawing ? 'Drag on the page to place it' : 'Add a hotspot'}
                </button>
              </div>
              <div class="fbe-stage">
                <div
                  ref={canvasRef}
                  class={`fbe-canvas ${drawing ? 'is-drawing' : ''}`}
                  style={{ aspectRatio: `${ratio}`, background: page.color }}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={() => {
                    dragging.current = null;
                    setDraft(null);
                  }}
                  data-testid="fbe-canvas"
                >
                  {page.image && <img src={url(page.image)} alt={`Page ${selected + 1}`} draggable={false} />}
                  {page.hotspots.map((h) => (
                    <div
                      key={h.id}
                      class={`fbe-spot ${h.id === hotspotId ? 'is-selected' : ''}`}
                      data-spot={h.id}
                      title={h.label || describeAction(h.action)}
                      style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, width: `${h.w * 100}%`, height: `${h.h * 100}%` }}
                    >
                      <span class="fbe-spot-label">{h.label || describeAction(h.action)}</span>
                      {h.id === hotspotId && <span class="fbe-handle" />}
                    </div>
                  ))}
                  {draft && <div class="fbe-spot is-draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />}
                </div>
              </div>
            </>
          ) : (
            <div class="fbe-empty">
              <p>
                A flipbook turns its pages like paper. Start from a PDF, from pictures (photos, scans, slides) or from blank pages, then add hotspots that open links, play video or sound, or show
                notes.
              </p>
            </div>
          )}
        </div>
        <aside class="fbe-side">
          <Segmented
            label="Settings"
            value={panel}
            choices={[
              { value: 'page', label: 'Page' },
              { value: 'book', label: 'Book' },
              { value: 'contents', label: 'Contents' },
            ]}
            onChange={setPanel}
          />
          {panel === 'page' &&
            (page ? (
              <div class="fbe-form" data-testid="fbe-page-panel">
                <label class="fbe-field">
                  <span>{page.image ? 'Colour around the picture' : 'Page colour'}</span>
                  <input type="color" value={page.color} onInput={(e) => updatePage(selected, (p) => ({ ...p, color: e.currentTarget.value }))} />
                </label>
                <label class="fbe-field fbe-wide">
                  <span>Words on this page, for search</span>
                  <textarea class="input" rows={3} value={page.text} onInput={(e) => updatePage(selected, (p) => ({ ...p, text: e.currentTarget.value }))} />
                </label>
                <h3>Hotspots</h3>
                {page.hotspots.length ? (
                  <ul class="fbe-spots" data-testid="fbe-spots">
                    {page.hotspots.map((h) => (
                      <li key={h.id}>
                        <button type="button" class={`fbe-spot-pick ${h.id === hotspotId ? 'is-selected' : ''}`} onClick={() => setHotspotId(h.id)}>
                          {h.label || describeAction(h.action)}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p class="tone-muted">None yet. Press “Add a hotspot” and drag a box on the page.</p>
                )}
                {hotspot && (
                  <div class="fbe-spot-form" data-testid="fbe-spot-form">
                    <label class="fbe-field fbe-wide">
                      <span>Name (read out by screen readers)</span>
                      <input
                        type="text"
                        class="input"
                        value={hotspot.label}
                        maxLength={200}
                        onInput={(e) => updateHotspot(hotspot.id, (h) => ({ ...h, label: e.currentTarget.value }))}
                        data-testid="fbe-spot-label"
                      />
                    </label>
                    <label class="fbe-field fbe-wide">
                      <span>When pressed</span>
                      <select class="input" value={hotspot.action.kind} onChange={(e) => setAction(hotspot, e.currentTarget.value as FlipAction['kind'])} data-testid="fbe-spot-kind">
                        {ACTIONS.map((a) => (
                          <option key={a.kind} value={a.kind}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {hotspot.action.kind === 'note' && (
                      <>
                        <label class="fbe-field fbe-wide">
                          <span>Note title</span>
                          <input
                            type="text"
                            class="input"
                            value={hotspot.action.title}
                            onInput={(e) => updateHotspot(hotspot.id, (h) => (h.action.kind === 'note' ? { ...h, action: { ...h.action, title: e.currentTarget.value } } : h))}
                            data-testid="fbe-note-title"
                          />
                        </label>
                        <label class="fbe-field fbe-wide">
                          <span>Note</span>
                          <textarea
                            class="input"
                            rows={4}
                            value={hotspot.action.text}
                            onInput={(e) => updateHotspot(hotspot.id, (h) => (h.action.kind === 'note' ? { ...h, action: { ...h.action, text: e.currentTarget.value } } : h))}
                            data-testid="fbe-note-text"
                          />
                        </label>
                      </>
                    )}
                    {hotspot.action.kind === 'link' && (
                      <label class="fbe-field fbe-wide">
                        <span>Web address</span>
                        <input
                          type="url"
                          class="input"
                          value={hotspot.action.url}
                          onInput={(e) => updateHotspot(hotspot.id, (h) => ({ ...h, action: { kind: 'link', url: e.currentTarget.value } }))}
                          data-testid="fbe-link"
                        />
                        {!isSafeLink(hotspot.action.url) && <span class="tone-bad">Use a web address (https://…) or an e-mail link (mailto:…); others are left out.</span>}
                      </label>
                    )}
                    {hotspot.action.kind === 'page' && (
                      <label class="fbe-field">
                        <span>Page</span>
                        <input
                          type="number"
                          class="input input-number"
                          min={1}
                          max={book.pages.length}
                          value={hotspot.action.page}
                          onInput={(e) => updateHotspot(hotspot.id, (h) => ({ ...h, action: { kind: 'page', page: Math.max(1, Math.min(book.pages.length, Number(e.currentTarget.value) || 1)) } }))}
                        />
                      </label>
                    )}
                    {(hotspot.action.kind === 'video' || hotspot.action.kind === 'audio') && (
                      <div class="fbe-field fbe-wide">
                        <span>{book.assets[hotspot.action.media]?.name ?? 'No file'}</span>
                        <button type="button" class="button button-small" onClick={() => chooseMedia(hotspot.action.kind as 'video' | 'audio')}>
                          Choose another file
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      class="button button-small button-quiet"
                      onClick={() => {
                        updatePage(selected, (p) => ({ ...p, hotspots: p.hotspots.filter((h) => h.id !== hotspot.id) }));
                        setHotspotId(null);
                      }}
                      data-testid="fbe-spot-delete"
                    >
                      <Icon name="trash" size={13} /> Delete the hotspot
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p class="tone-muted">No page chosen.</p>
            ))}
          {panel === 'book' && (
            <div class="fbe-form" data-testid="fbe-book-panel">
              <span class="fbe-field fbe-wide">
                <span>Pages</span>
                <Segmented
                  label="Pages"
                  value={book.settings.spread}
                  choices={[
                    { value: 'double', label: 'Two side by side' },
                    { value: 'single', label: 'One at a time' },
                  ]}
                  onChange={(spread) => setSettings({ spread })}
                />
              </span>
              {(
                [
                  ['cover', 'Start with a cover (the first page alone)'],
                  ['hardCovers', 'Hard covers (first and last pages stay stiff)'],
                  ['rtl', 'Right to left (Arabic, Hebrew, Urdu, manga)'],
                  ['sound', 'Page-turn sound'],
                  ['pageNumbers', 'Page numbers on the pages'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} class="check fbe-wide">
                  <input type="checkbox" checked={book.settings[key]} onChange={(e) => setSettings({ [key]: e.currentTarget.checked })} data-testid={`fbe-${key}`} /> {label}
                </label>
              ))}
              <label class="fbe-field">
                <span>Background colour</span>
                <input type="color" value={book.settings.background} onInput={(e) => setSettings({ background: e.currentTarget.value })} />
              </label>
              <div class="fbe-field">
                <span>Background picture</span>
                <span class="button-row">
                  <button
                    type="button"
                    class="button button-small"
                    onClick={() =>
                      run(async () => {
                        const [file] = await pickFiles('image/*');
                        if (!file) return;
                        const { pages } = await pagesFromPictures([file], busy);
                        const asset = pages[0]?.asset;
                        if (!asset) return;
                        change((b) => ({ ...b, assets: { ...b.assets, [asset[0]]: asset[1] }, settings: { ...b.settings, backgroundImage: asset[0] } }));
                      })
                    }
                  >
                    Choose
                  </button>
                  {book.settings.backgroundImage && (
                    <button type="button" class="button button-small button-quiet" onClick={() => setSettings({ backgroundImage: null })}>
                      Remove
                    </button>
                  )}
                </span>
              </div>
              <label class="fbe-field">
                <span>Turning speed (ms)</span>
                <input
                  type="number"
                  class="input input-number"
                  min={200}
                  max={3000}
                  step={100}
                  value={book.settings.flipTime}
                  onInput={(e) => setSettings({ flipTime: Math.max(200, Math.min(3000, Number(e.currentTarget.value) || 800)) })}
                />
              </label>
              <h3 class="fbe-wide">Kiosk</h3>
              <label class="fbe-field">
                <span>Turn a page every (s, 0: never)</span>
                <input
                  type="number"
                  class="input input-number"
                  min={0}
                  max={3600}
                  value={book.settings.autoFlip}
                  onInput={(e) => setSettings({ autoFlip: Math.max(0, Math.min(3600, Math.round(Number(e.currentTarget.value) || 0))) })}
                  data-testid="fbe-autoflip"
                />
              </label>
              <label class="fbe-field">
                <span>Back to the cover after idle (s, 0: never)</span>
                <input
                  type="number"
                  class="input input-number"
                  min={0}
                  max={86400}
                  value={book.settings.idleReset}
                  onInput={(e) => setSettings({ idleReset: Math.max(0, Math.min(86400, Math.round(Number(e.currentTarget.value) || 0))) })}
                />
              </label>
            </div>
          )}
          {panel === 'contents' && (
            <div class="fbe-form" data-testid="fbe-contents">
              {book.contents.length ? (
                <ol class="fbe-contents">
                  {book.contents.map((c, i) => (
                    <li key={i}>
                      <input
                        type="text"
                        class="input"
                        aria-label={`Title of entry ${i + 1}`}
                        value={c.title}
                        onInput={(e) => change((b) => ({ ...b, contents: b.contents.map((x, j) => (j === i ? { ...x, title: e.currentTarget.value } : x)) }))}
                      />
                      <input
                        type="number"
                        class="input input-number"
                        aria-label={`Page of entry ${i + 1}`}
                        min={1}
                        max={Math.max(1, book.pages.length)}
                        value={c.page}
                        onInput={(e) => change((b) => ({ ...b, contents: b.contents.map((x, j) => (j === i ? { ...x, page: Math.max(1, Number(e.currentTarget.value) || 1) } : x)) }))}
                      />
                      <button
                        type="button"
                        class="button button-small button-quiet"
                        aria-label={`Delete entry ${i + 1}`}
                        onClick={() => change((b) => ({ ...b, contents: b.contents.filter((_, j) => j !== i) }))}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p class="tone-muted">No contents yet. A PDF brings its bookmarks with it.</p>
              )}
              <button
                type="button"
                class="button button-small"
                disabled={!book.pages.length}
                onClick={() => change((b) => ({ ...b, contents: [...b.contents, { title: `Page ${selected + 1}`, page: selected + 1 }] }))}
                data-testid="fbe-contents-add"
              >
                Add this page
              </button>
            </div>
          )}
        </aside>
      </div>
      {previewBook && <Preview book={previewBook} url={url} onClose={() => setPreview(false)} />}
    </section>
  );
}

export default defineCustomTool(FlipbookEditor);
