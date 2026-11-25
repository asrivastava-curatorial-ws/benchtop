/**
 * PDF Studio: redaction that is checked afterwards, correcting what OCR read,
 * PDF/A for archives, and the same steps for many files at once.  Everything
 * runs here in the app with PDF.js, pdf-lib and Tesseract.
 */
import { zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { srgbProfile } from '../../lib/icc-srgb';
import type { OcrLanguage } from '../../lib/ocr-engine';
import { inspect } from '../../lib/pdf-archive';
import { hiddenText } from '../../lib/pdf-hidden-text';
import { pageText } from '../../lib/pdf-page-text';
import { type Box, boxFrom, type Check, findMatches, PATTERNS, type Query } from '../../lib/pdf-redact';
import { openPdf, type PdfDocument, renderPage } from '../../lib/pdf-render';
import { canvasBytes, type Marks, type OcrWord, recogniseWords, redactPdf, toPdfA, verifyRedaction, wordsText } from '../../lib/pdf-studio';
import { finishFonts, fontsFor } from '../../lib/pdf-text';
import { pickFile, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { FileBar, FileDrop, isPdf, type PdfFile, readPdf, save, stem, useSinglePdf } from './_pdf';
import { Segmented, usePersistentState } from './_shared';

type Tab = 'redact' | 'ocr' | 'archive' | 'batch';
type Busy = (step: string | null) => void;

const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'redact', label: 'Redact' },
  { value: 'ocr', label: 'Correct OCR' },
  { value: 'archive', label: 'PDF/A' },
  { value: 'batch', label: 'Many files' },
];

const LANGUAGES: readonly { id: OcrLanguage; label: string }[] = [
  { id: 'eng', label: 'English' },
  { id: 'hin', label: 'Hindi' },
  { id: 'eng+hin', label: 'English and Hindi' },
];

const DPIS = [100, 150, 200, 300];

function Checks({ checks, testId }: { checks: readonly Check[]; testId: string }) {
  const failed = checks.filter((check) => !check.ok).length;
  return (
    <div class="ps-checks" data-testid={testId} data-failed={failed}>
      <strong class={failed ? 'tone-bad' : 'tone-ok'}>{failed ? `${failed} ${failed === 1 ? 'check' : 'checks'} did not pass` : 'Every check passed'}</strong>
      <ul>
        {checks.map((check) => (
          <li key={check.id} class={check.ok ? 'is-ok' : 'is-bad'}>
            <Icon name={check.ok ? 'check' : 'alert'} size={14} />
            <span>
              {check.label}
              {check.detail && <span class="tone-muted"> {check.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Finder {
  readonly terms: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly patterns: readonly string[];
  readonly regex: string;
}

const EMPTY_FINDER: Finder = { terms: '', caseSensitive: false, wholeWord: false, patterns: [], regex: '' };

function queriesOf(finder: Finder): Query[] {
  const queries: Query[] = finder.terms
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ kind: 'text', text, caseSensitive: finder.caseSensitive, wholeWord: finder.wholeWord }));
  for (const id of finder.patterns) queries.push({ kind: 'pattern', id });
  if (finder.regex.trim()) queries.push({ kind: 'regex', source: finder.regex.trim(), caseSensitive: finder.caseSensitive });
  return queries;
}

function FinderForm({ value, onChange, prefix }: { value: Finder; onChange: (next: Finder) => void; prefix: string }) {
  return (
    <div class="ps-finder">
      <label class="ps-field">
        <span class="control-label">Words or names to remove, one per line</span>
        <textarea class="input" rows={3} value={value.terms} onInput={(e) => onChange({ ...value, terms: e.currentTarget.value })} spellcheck={false} data-testid={`${prefix}-terms`} />
      </label>
      <div class="ps-row">
        <label class="ps-check">
          <input type="checkbox" checked={value.wholeWord} onChange={(e) => onChange({ ...value, wholeWord: e.currentTarget.checked })} />
          <span>Whole words</span>
        </label>
        <label class="ps-check">
          <input type="checkbox" checked={value.caseSensitive} onChange={(e) => onChange({ ...value, caseSensitive: e.currentTarget.checked })} />
          <span>Match capitals</span>
        </label>
      </div>
      <fieldset class="ps-patterns">
        <legend class="control-label">Also find</legend>
        {PATTERNS.map((pattern) => (
          <label class="ps-check" key={pattern.id}>
            <input
              type="checkbox"
              checked={value.patterns.includes(pattern.id)}
              onChange={(e) => onChange({ ...value, patterns: e.currentTarget.checked ? [...value.patterns, pattern.id] : value.patterns.filter((id) => id !== pattern.id) })}
              data-testid={`${prefix}-pattern-${pattern.id}`}
            />
            <span>{pattern.label}</span>
          </label>
        ))}
      </fieldset>
      <label class="ps-field">
        <span class="control-label">A pattern of your own (regular expression)</span>
        <input class="input" type="text" value={value.regex} onInput={(e) => onChange({ ...value, regex: e.currentTarget.value })} spellcheck={false} placeholder="for example  VITM/\d{4}/\d+" />
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ redact -- */

interface Mark extends Box {
  readonly id: number;
  readonly source: string;
}

let markIds = 0;

function RedactTab({ busy, setBusy }: { busy: string | null; setBusy: Busy }) {
  const [file, take, clear] = useSinglePdf();
  const [view, setView] = useState<PdfDocument | null>(null);
  const [number, setNumber] = useState(1);
  const [shown, setShown] = useState<{ url: string; width: number; height: number } | null>(null);
  const [marks, setMarks] = useState<ReadonlyMap<number, readonly Mark[]>>(new Map());
  const [finder, setFinder] = useState<Finder>(EMPTY_FINDER);
  const [dpi, setDpi] = useState(150);
  const [fill, setFill] = useState<'black' | 'white'>('black');
  const [flattenAll, setFlattenAll] = useState(false);
  const [ocr, setOcr] = useState<OcrLanguage | ''>('');
  const [draft, setDraft] = useState<Box | null>(null);
  const [result, setResult] = useState<{ bytes: Uint8Array; checks: Check[] } | null>(null);
  const start = useRef<[number, number] | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMarks(new Map());
    setResult(null);
    setNumber(1);
    setView(null);
    if (!file) return;
    let live = true;
    let closer: (() => Promise<void>) | null = null;
    void attempt(async () => {
      const opened = await openPdf(file.bytes);
      closer = opened.close;
      if (live) setView(opened.doc);
      else await opened.close();
    });
    return () => {
      live = false;
      void closer?.();
    };
  }, [file]);

  useEffect(() => {
    setShown(null);
    if (!view) return;
    let live = true;
    void attempt(async () => {
      const first = await view.getPage(number);
      const natural = first.getViewport({ scale: 1 });
      const canvas = await renderPage(view, number, Math.min(2, 900 / natural.width));
      const url = canvas.toDataURL('image/png');
      canvas.width = 0;
      if (live) setShown({ url, width: natural.width, height: natural.height });
    });
    return () => {
      live = false;
    };
  }, [view, number]);

  const total = [...marks.values()].reduce((sum, list) => sum + list.length, 0);
  const pagesMarked = [...marks.entries()].filter(([, list]) => list.length).sort((a, b) => a[0] - b[0]);
  const here = marks.get(number) ?? [];

  const change = (next: ReadonlyMap<number, readonly Mark[]>) => {
    setMarks(next);
    setResult(null);
  };
  const add = (page: number, boxes: readonly Box[], source: string, into: Map<number, readonly Mark[]> = new Map(marks)) => {
    into.set(page, [...(into.get(page) ?? []), ...boxes.map((box) => ({ ...box, id: ++markIds, source }))]);
    return into;
  };
  const remove = (page: number, id: number) => {
    const next = new Map(marks);
    next.set(
      page,
      (next.get(page) ?? []).filter((mark) => mark.id !== id),
    );
    change(next);
  };

  const point = (event: PointerEvent): [number, number] => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || !shown) return [0, 0];
    return [((event.clientX - rect.left) / rect.width) * shown.width, ((event.clientY - rect.top) / rect.height) * shown.height];
  };

  const findAll = () =>
    attempt(async () => {
      if (!view) return;
      const queries = queriesOf(finder);
      if (!queries.length) throw new Error('Type the words to remove, or tick something to find.');
      setBusy('Looking through the pages');
      try {
        // Marks from an earlier search are replaced; marks drawn by hand stay.
        const next = new Map<number, readonly Mark[]>();
        for (const [page, list] of marks)
          next.set(
            page,
            list.filter((mark) => mark.source === 'drawn'),
          );
        let found = 0;
        for (let page = 1; page <= view.numPages; page++) {
          const matches = findMatches((await pageText(view, page)).items, queries);
          for (const match of matches) add(page, match.boxes, match.label, next);
          found += matches.length;
        }
        change(next);
        const first = [...next.entries()].filter(([, list]) => list.length).sort((a, b) => a[0] - b[0])[0];
        if (first) setNumber(first[0]);
        notify(found ? `${found.toLocaleString()} found and marked` : 'Nothing found. Scanned pages have no text to search: draw the marks by hand.');
      } finally {
        setBusy(null);
      }
    });

  const run = () =>
    attempt(async () => {
      if (!file) return;
      const plain: Marks = new Map([...marks.entries()].map(([page, list]) => [page, list.map(({ x, y, w, h }) => ({ x, y, w, h }))]));
      setBusy('Redacting');
      try {
        const bytes = await redactPdf(file.bytes, plain, { dpi, fill, flattenAll, ocr: ocr || null }, (step) => setBusy(`Redacting: ${step}`));
        setBusy('Checking the result');
        setResult({ bytes, checks: await verifyRedaction(bytes, plain, queriesOf(finder), fill) });
      } finally {
        setBusy(null);
      }
    });

  if (!file) return <FileDrop accept="application/pdf,.pdf" multiple={false} onFiles={take} title="Choose a PDF to redact" hint="or drop it here" testId="ps-drop" />;

  return (
    <div class="ps-split">
      <div class="ps-stage">
        <FileBar file={file} onReplace={() => void attempt(async () => take([(await pickFile('application/pdf,.pdf')) as File].filter(Boolean)))} onClear={clear} />
        <div class="ps-pager">
          <button type="button" class="icon-button" disabled={number <= 1} onClick={() => setNumber(number - 1)} aria-label="Previous page">
            <Icon name="left" size={16} />
          </button>
          <label>
            <span class="control-label">Page</span>
            <input class="input" type="number" min={1} max={file.pages} value={number} onChange={(e) => setNumber(Math.min(file.pages, Math.max(1, Math.round(Number(e.currentTarget.value)) || 1)))} />
          </label>
          <span class="tone-muted">of {file.pages}</span>
          <button type="button" class="icon-button" disabled={number >= file.pages} onClick={() => setNumber(number + 1)} aria-label="Next page">
            <Icon name="right" size={16} />
          </button>
          <span class="tone-muted">Drag on the page to mark an area. Select a mark and press Delete to remove it.</span>
        </div>
        <div class="ps-page">
          {shown ? (
            <div
              class="ps-surface"
              ref={surface}
              style={{ aspectRatio: `${shown.width} / ${shown.height}` }}
              onPointerDown={(e) => {
                if (e.button !== 0 || (e.target as HTMLElement).closest('.ps-mark')) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                start.current = point(e);
                setDraft({ x: start.current[0], y: start.current[1], w: 0, h: 0 });
              }}
              onPointerMove={(e) => {
                if (!start.current) return;
                const [x, y] = point(e);
                setDraft(boxFrom(start.current[0], start.current[1], x, y, shown.width, shown.height));
              }}
              onPointerUp={() => {
                if (start.current && draft && draft.w > 3 && draft.h > 3) change(add(number, [draft], 'drawn'));
                start.current = null;
                setDraft(null);
              }}
              data-testid="ps-page"
            >
              <img src={shown.url} alt={`Page ${number}`} draggable={false} />
              {[...here, ...(draft ? [{ ...draft, id: -1, source: 'drawn' }] : [])].map((mark, index) => (
                <button
                  type="button"
                  key={mark.id}
                  class={`ps-mark${fill === 'white' ? ' is-white' : ''}`}
                  style={{ left: `${(mark.x / shown.width) * 100}%`, top: `${(mark.y / shown.height) * 100}%`, width: `${(mark.w / shown.width) * 100}%`, height: `${(mark.h / shown.height) * 100}%` }}
                  aria-label={`Mark ${index + 1} on page ${number}${mark.source === 'drawn' ? '' : `, found for ${mark.source}`}. Press Delete to remove it.`}
                  onKeyDown={(e) => {
                    if (e.key === 'Delete' || e.key === 'Backspace') {
                      e.preventDefault();
                      remove(number, mark.id);
                    }
                  }}
                  data-testid="ps-mark"
                />
              ))}
            </div>
          ) : (
            <p class="tone-muted">Drawing the page…</p>
          )}
        </div>
      </div>
      <aside class="ps-panel">
        <FinderForm value={finder} onChange={setFinder} prefix="ps" />
        <button type="button" class="button" disabled={busy !== null || !view} onClick={() => void findAll()} data-testid="ps-find">
          <Icon name="search" size={14} /> Find and mark on every page
        </button>
        <div class="ps-marks" data-testid="ps-marks">
          <strong>
            {total.toLocaleString()} {total === 1 ? 'mark' : 'marks'} on {pagesMarked.length} {pagesMarked.length === 1 ? 'page' : 'pages'}
          </strong>
          <ul>
            {pagesMarked.map(([page, list]) => (
              <li key={page}>
                <button type="button" class="link-button" onClick={() => setNumber(page)}>
                  Page {page}
                </button>
                <span class="tone-muted">
                  {list.length} {list.length === 1 ? 'mark' : 'marks'}
                </span>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={`Remove the marks on page ${page}`}
                  onClick={() => {
                    const next = new Map(marks);
                    next.delete(page);
                    change(next);
                  }}
                >
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div class="ps-row">
          <label class="ps-field">
            <span class="control-label">Picture quality of redacted pages</span>
            <select class="input" value={dpi} onChange={(e) => setDpi(Number(e.currentTarget.value))}>
              {DPIS.map((value) => (
                <option key={value} value={value}>
                  {value} dpi
                </option>
              ))}
            </select>
          </label>
          <label class="ps-field">
            <span class="control-label">Marks are</span>
            <select class="input" value={fill} onChange={(e) => setFill(e.currentTarget.value as 'black' | 'white')}>
              <option value="black">Black</option>
              <option value="white">White</option>
            </select>
          </label>
        </div>
        <label class="ps-check">
          <input type="checkbox" checked={flattenAll} onChange={(e) => setFlattenAll(e.currentTarget.checked)} />
          <span>Turn every page into a picture, not only the marked ones</span>
        </label>
        <label class="ps-field">
          <span class="control-label">Make redacted pages searchable again</span>
          <select class="input" value={ocr} onChange={(e) => setOcr(e.currentTarget.value as OcrLanguage | '')}>
            <option value="">No</option>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                Read them with OCR: {l.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" class="button button-primary" disabled={busy !== null || (total === 0 && !flattenAll)} onClick={() => void run()} data-testid="ps-run">
          <Icon name="play" size={14} /> Redact and check
        </button>
        <p class="tone-muted ps-note">
          A marked page is rebuilt as a picture with the marks drawn in, so the words under them are no longer in the file. The result is a new document: bookmarks, attachments, scripts and the old
          document information are left behind.
        </p>
        {result && (
          <>
            <Checks checks={result.checks} testId="ps-checks" />
            <button type="button" class="button button-primary" onClick={() => attempt(() => save(`${stem(file.name)} (redacted).pdf`, result.bytes))} data-testid="ps-save">
              <Icon name="save" size={14} /> Save the redacted PDF ({formatBytes(result.bytes.length)})
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

/* --------------------------------------------------------------------- OCR -- */

interface OcrPage {
  readonly url: string;
  readonly jpeg: Uint8Array;
  /** Pixels, and how many of them make an inch. */
  readonly width: number;
  readonly height: number;
  readonly dpi: number;
  words: OcrWord[];
}

const MAX_OCR_PAGES = 40;

function OcrTab({ busy, setBusy }: { busy: string | null; setBusy: Busy }) {
  const [name, setName] = useState('');
  const [pages, setPages] = useState<OcrPage[]>([]);
  const [at, setAt] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [language, setLanguage] = useState<OcrLanguage>('eng');
  const [threshold, setThreshold] = useState(85);
  const [, redraw] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  // Page pictures are released when the scan is replaced or the tab is left.
  const held = useRef<OcrPage[]>([]);
  held.current = pages;
  const release = (list: readonly OcrPage[]) => {
    for (const page of list) URL.revokeObjectURL(page.url);
  };
  useEffect(() => () => release(held.current), []);

  const load = (files: File[]) =>
    attempt(async () => {
      const file = files[0];
      if (!file) return;
      setBusy('Opening');
      try {
        const next: OcrPage[] = [];
        const keep = async (canvas: HTMLCanvasElement, dpi: number) => {
          const jpeg = await canvasBytes(canvas, 'image/jpeg', 0.92);
          next.push({ url: URL.createObjectURL(new Blob([jpeg as BlobPart], { type: 'image/jpeg' })), jpeg, width: canvas.width, height: canvas.height, dpi, words: [] });
          canvas.width = 0;
        };
        if (isPdf(file)) {
          const { doc, close } = await openPdf(new Uint8Array(await file.arrayBuffer()));
          try {
            for (let number = 1; number <= Math.min(doc.numPages, MAX_OCR_PAGES); number++) await keep(await renderPage(doc, number, 2), 144);
            if (doc.numPages > MAX_OCR_PAGES) notify(`Only the first ${MAX_OCR_PAGES} pages are opened here. Split longer scans first.`);
          } finally {
            await close();
          }
        } else {
          const bitmap = await createImageBitmap(file);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Could not create a drawing surface.');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          await keep(canvas, 150);
        }
        release(pages);
        setPages(next);
        setName(file.name);
        setAt(0);
        setChosen(null);
      } finally {
        setBusy(null);
      }
    });

  const read = () =>
    attempt(async () => {
      try {
        for (const [index, page] of pages.entries()) {
          setBusy(`Reading page ${index + 1} of ${pages.length}`);
          const bitmap = await createImageBitmap(new Blob([page.jpeg as BlobPart], { type: 'image/jpeg' }));
          const canvas = document.createElement('canvas');
          canvas.width = page.width;
          canvas.height = page.height;
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
          bitmap.close();
          page.words = await recogniseWords(canvas, language);
          canvas.width = 0;
        }
        setPages([...pages]);
        setChosen(null);
      } finally {
        setBusy(null);
      }
    });

  const page = pages[at];
  const words = page?.words ?? [];
  const doubtful = (word: OcrWord) => !word.checked && word.confidence < threshold;
  const toCheck = words.map((word, index) => ({ word, index })).filter(({ word }) => doubtful(word));
  const allToCheck = pages.reduce((sum, p) => sum + p.words.filter(doubtful).length, 0);
  const word = chosen !== null ? words[chosen] : undefined;
  const hasWords = pages.some((p) => p.words.length);

  const choose = (index: number | null) => {
    setChosen(index);
    if (index !== null) setTimeout(() => field.current?.select(), 0);
  };
  const next = () => {
    const after = toCheck.find(({ index }) => chosen === null || index > chosen) ?? toCheck[0];
    choose(after && after.index !== chosen ? after.index : null);
  };

  const searchablePdf = async () => {
    const doc = await PDFDocument.create();
    const fonts = await fontsFor(
      doc,
      pages.flatMap((p) => p.words.map((w) => w.text)),
    );
    for (const p of pages) {
      const scale = 72 / p.dpi;
      const sheet = doc.addPage([p.width * scale, p.height * scale]);
      sheet.drawImage(await doc.embedJpg(p.jpeg), { x: 0, y: 0, width: p.width * scale, height: p.height * scale });
      hiddenText(
        sheet,
        fonts.regular,
        p.words.map((w) => ({ text: w.text, x: w.x * scale, y: w.y * scale, w: w.w * scale, h: w.h * scale })),
      );
    }
    await finishFonts(doc);
    return doc.save();
  };

  if (!pages.length)
    return (
      <FileDrop accept="application/pdf,.pdf,image/*" multiple={false} onFiles={(files) => void load(files)} title="Choose a scan: a PDF or a picture" hint="or drop it here" testId="ps-ocr-drop" />
    );

  return (
    <div class="ps-split">
      <div class="ps-stage">
        <div class="ps-pager">
          <strong>{name}</strong>
          {pages.length > 1 && (
            <>
              <button
                type="button"
                class="icon-button"
                disabled={at <= 0}
                onClick={() => {
                  setAt(at - 1);
                  setChosen(null);
                }}
                aria-label="Previous page"
              >
                <Icon name="left" size={16} />
              </button>
              <span>
                Page {at + 1} of {pages.length}
              </span>
              <button
                type="button"
                class="icon-button"
                disabled={at >= pages.length - 1}
                onClick={() => {
                  setAt(at + 1);
                  setChosen(null);
                }}
                aria-label="Next page"
              >
                <Icon name="right" size={16} />
              </button>
            </>
          )}
          <button
            type="button"
            class="button button-small button-quiet"
            onClick={() => {
              release(pages);
              setPages([]);
              setName('');
            }}
          >
            Remove
          </button>
        </div>
        {page && (
          <div class="ps-page">
            <div class="ps-surface" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
              <img src={page.url} alt={`Scan, page ${at + 1}`} draggable={false} />
              {words.map((w, index) => (
                <button
                  type="button"
                  key={index}
                  class={`ps-word${doubtful(w) ? ' is-doubt' : ''}${chosen === index ? ' is-chosen' : ''}`}
                  style={{ left: `${(w.x / page.width) * 100}%`, top: `${(w.y / page.height) * 100}%`, width: `${(w.w / page.width) * 100}%`, height: `${(w.h / page.height) * 100}%` }}
                  aria-label={`${w.text}, ${Math.round(w.confidence)} percent sure`}
                  title={`${w.text} (${Math.round(w.confidence)}%)`}
                  onClick={() => choose(index)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <aside class="ps-panel">
        <div class="ps-row">
          <label class="ps-field">
            <span class="control-label">Language</span>
            <select class="input" value={language} onChange={(e) => setLanguage(e.currentTarget.value as OcrLanguage)}>
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" class="button button-primary" disabled={busy !== null} onClick={() => void read()} data-testid="ps-ocr-run">
            <Icon name="play" size={14} /> Read the text
          </button>
        </div>
        {hasWords && (
          <>
            <label class="ps-field">
              <span class="control-label">Ask me about words Tesseract is less than {threshold}% sure of</span>
              <input type="range" min={30} max={99} value={threshold} onInput={(e) => setThreshold(Number(e.currentTarget.value))} />
            </label>
            <p class="ps-count" data-testid="ps-ocr-count" role="status">
              {words.length.toLocaleString()} words on this page, {toCheck.length.toLocaleString()} to check{pages.length > 1 ? ` (${allToCheck.toLocaleString()} in the whole scan)` : ''}
            </p>
            {word && page && chosen !== null ? (
              <div class="ps-editor">
                <div
                  class="ps-crop"
                  role="img"
                  aria-label="The word as it is in the scan"
                  style={{
                    backgroundImage: `url(${page.url})`,
                    backgroundSize: `${(page.width / Math.max(1, word.w + 16)) * 100}% auto`,
                    backgroundPosition: `${(Math.max(0, word.x - 8) / Math.max(1, page.width - word.w - 16)) * 100}% ${(Math.max(0, word.y - 6) / Math.max(1, page.height - word.h - 12)) * 100}%`,
                    aspectRatio: `${word.w + 16} / ${word.h + 12}`,
                  }}
                />
                <label class="ps-field">
                  <span class="control-label">It says ({Math.round(word.confidence)}% sure)</span>
                  <input
                    class="input"
                    type="text"
                    ref={field}
                    value={word.text}
                    spellcheck={false}
                    onInput={(e) => {
                      word.text = e.currentTarget.value;
                      redraw((n) => n + 1);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        word.checked = true;
                        next();
                      }
                    }}
                    data-testid="ps-ocr-word"
                  />
                </label>
                <div class="ps-row">
                  <button
                    type="button"
                    class="button button-small"
                    onClick={() => {
                      word.checked = true;
                      next();
                    }}
                    data-testid="ps-ocr-accept"
                  >
                    <Icon name="check" size={13} /> Right, next
                  </button>
                  <button
                    type="button"
                    class="button button-small"
                    onClick={() => {
                      page.words = page.words.filter((_, index) => index !== chosen);
                      setPages([...pages]);
                      setChosen(null);
                    }}
                  >
                    <Icon name="trash" size={13} /> Not a word, remove
                  </button>
                </div>
                <span class="tone-muted">Enter accepts and goes to the next word to check.</span>
              </div>
            ) : (
              <p class="tone-muted">Select a word on the page, or one from the list, to correct it.</p>
            )}
            <ul class="ps-doubts" data-testid="ps-ocr-list">
              {toCheck.slice(0, 200).map(({ word: w, index }) => (
                <li key={index}>
                  <button type="button" class={`link-button${chosen === index ? ' is-chosen' : ''}`} onClick={() => choose(index)}>
                    {w.text}
                  </button>
                  <span class="tone-muted">{Math.round(w.confidence)}%</span>
                </li>
              ))}
            </ul>
            <div class="ps-row">
              <button
                type="button"
                class="button"
                onClick={() =>
                  attempt(async () => {
                    const text = pages.map((p, index) => (pages.length > 1 ? `--- Page ${index + 1} ---\n${wordsText(p.words)}` : wordsText(p.words))).join('\n\n');
                    const saved = await saveFile(`${stem(name)}.txt`, text, 'text/plain');
                    if (saved.saved) notify(`Saved to ${saved.location}`);
                  })
                }
                data-testid="ps-ocr-text"
              >
                <Icon name="save" size={14} /> Save the text
              </button>
              <button type="button" class="button" disabled={busy !== null} onClick={() => attempt(async () => save(`${stem(name)} (searchable).pdf`, await searchablePdf()))} data-testid="ps-ocr-pdf">
                <Icon name="save" size={14} /> Save a searchable PDF
              </button>
            </div>
            <p class="tone-muted ps-note">The searchable PDF shows the scan and carries your corrected words as a hidden layer, each where it is on the page.</p>
          </>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------- PDF/A -- */

function ArchiveTab({ busy, setBusy }: { busy: string | null; setBusy: Busy }) {
  const [file, take, clear] = useSinglePdf();
  const [mode, setMode] = useState<'pictures' | 'kept'>('kept');
  const [dpi, setDpi] = useState(200);
  const [keepText, setKeepText] = useState(true);
  const [meta, setMeta] = useState({ title: '', author: '', subject: '', keywords: '', language: '' });
  const [result, setResult] = useState<{ bytes: Uint8Array; checks: Check[] } | null>(null);
  const found = useMemo(() => (file ? inspect(file.doc) : null), [file]);

  useEffect(() => {
    setResult(null);
    if (!file) return;
    setMeta({ title: file.doc.getTitle() ?? stem(file.name), author: file.doc.getAuthor() ?? '', subject: file.doc.getSubject() ?? '', keywords: file.doc.getKeywords() ?? '', language: '' });
    // Fonts that are not in the file cannot be added later: such a PDF conforms only as pictures.
    setMode(inspect(file.doc).fontsNotEmbedded.length ? 'pictures' : 'kept');
  }, [file]);

  if (!file || !found) return <FileDrop accept="application/pdf,.pdf" multiple={false} onFiles={take} title="Choose a PDF to make archivable" hint="or drop it here" testId="ps-a-drop" />;

  const run = () =>
    attempt(async () => {
      setBusy('Converting');
      try {
        setResult(await toPdfA(file.bytes, { mode, dpi, hiddenText: keepText, meta }, srgbProfile(), (step) => setBusy(`Converting: ${step}`)));
      } finally {
        setBusy(null);
      }
    });
  const text = (key: keyof typeof meta, label: string, hint = '') => (
    <label class="ps-field">
      <span class="control-label">{label}</span>
      <input
        class="input"
        type="text"
        value={meta[key]}
        placeholder={hint}
        onInput={(e) => {
          setMeta({ ...meta, [key]: e.currentTarget.value });
          setResult(null);
        }}
      />
    </label>
  );

  return (
    <div class="ps-form">
      <FileBar file={file} onReplace={() => void attempt(async () => take([(await pickFile('application/pdf,.pdf')) as File].filter(Boolean)))} onClear={clear} />
      <div class="ps-found" data-testid="ps-a-found">
        <strong>In this file</strong>
        <ul>
          <li class={found.fontsNotEmbedded.length ? 'is-bad' : 'is-ok'}>
            {found.fontsNotEmbedded.length
              ? `${found.fontsNotEmbedded.length} fonts are not embedded (${found.fontsNotEmbedded.slice(0, 5).join(', ')}): only “pictures” will conform`
              : 'Every font is embedded'}
          </li>
          <li class={found.scripts || found.attachments || found.hasXfa ? 'is-bad' : 'is-ok'}>
            {found.scripts || found.attachments || found.hasXfa
              ? `${[found.scripts ? `${found.scripts} scripts` : '', found.attachments ? `${found.attachments} attachments` : '', found.hasXfa ? 'an XFA form' : ''].filter(Boolean).join(', ')} will be removed`
              : 'No scripts or attachments'}
          </li>
        </ul>
      </div>
      <fieldset class="ps-modes">
        <legend class="control-label">How to convert</legend>
        <label class="ps-check">
          <input
            type="radio"
            name="ps-mode"
            checked={mode === 'kept'}
            onChange={() => {
              setMode('kept');
              setResult(null);
            }}
          />
          <span>
            <b>Keep the pages as they are.</b> Adds the PDF/A identification, colour profile and metadata; removes scripts and attachments. Small and sharp, for PDFs whose fonts are embedded.
          </span>
        </label>
        <label class="ps-check">
          <input
            type="radio"
            name="ps-mode"
            checked={mode === 'pictures'}
            onChange={() => {
              setMode('pictures');
              setResult(null);
            }}
            data-testid="ps-a-pictures"
          />
          <span>
            <b>Turn pages into pictures.</b> Works for any PDF, scans included; the file gets larger.
          </span>
        </label>
      </fieldset>
      {mode === 'pictures' && (
        <div class="ps-row">
          <label class="ps-field">
            <span class="control-label">Picture quality</span>
            <select
              class="input"
              value={dpi}
              onChange={(e) => {
                setDpi(Number(e.currentTarget.value));
                setResult(null);
              }}
            >
              {DPIS.map((value) => (
                <option key={value} value={value}>
                  {value} dpi
                </option>
              ))}
            </select>
          </label>
          <label class="ps-check">
            <input
              type="checkbox"
              checked={keepText}
              onChange={(e) => {
                setKeepText(e.currentTarget.checked);
                setResult(null);
              }}
            />
            <span>Keep the text selectable (hidden layer)</span>
          </label>
        </div>
      )}
      <div class="ps-grid">
        {text('title', 'Title')}
        {text('author', 'Author')}
        {text('subject', 'Subject')}
        {text('keywords', 'Keywords')}
        {text('language', 'Language', 'en-IN, hi-IN…')}
      </div>
      <button type="button" class="button button-primary" disabled={busy !== null} onClick={() => void run()} data-testid="ps-a-run">
        <Icon name="play" size={14} /> Make PDF/A-2b
      </button>
      {result && (
        <>
          <Checks checks={result.checks} testId="ps-a-checks" />
          <button type="button" class="button button-primary" onClick={() => attempt(() => save(`${stem(file.name)} (PDF-A).pdf`, result.bytes))} data-testid="ps-a-save">
            <Icon name="save" size={14} /> Save the PDF/A ({formatBytes(result.bytes.length)})
          </button>
        </>
      )}
      <p class="tone-muted ps-note">
        Benchtop writes the parts PDF/A-2b asks for and checks them in the saved file. It is not a certified validator: when an archive demands proof, run the result through veraPDF (free and open
        source).
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- batch -- */

interface BatchRow {
  readonly name: string;
  readonly pages: number;
  readonly notes: string[];
  readonly ok: boolean;
  readonly outputs: { name: string; bytes: Uint8Array }[];
}

function BatchTab({ busy, setBusy }: { busy: string | null; setBusy: Busy }) {
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [redact, setRedact] = useState(false);
  const [finder, setFinder] = useState<Finder>(EMPTY_FINDER);
  const [flatten, setFlatten] = useState(false);
  const [archive, setArchive] = useState<'off' | 'kept' | 'pictures'>('off');
  const [text, setText] = useState(false);
  const [dpi, setDpi] = useState(150);
  const [rows, setRows] = useState<BatchRow[] | null>(null);

  const add = (incoming: File[]) =>
    attempt(async () => {
      const read: PdfFile[] = [];
      for (const file of incoming.filter(isPdf)) read.push(await readPdf(file));
      setFiles([...files, ...read]);
      setRows(null);
    });

  const run = () =>
    attempt(async () => {
      const queries = redact ? queriesOf(finder) : [];
      if (redact && !queries.length) throw new Error('Type the words to remove, or tick something to find.');
      if (!redact && !flatten && archive === 'off' && !text) throw new Error('Tick at least one thing to do.');
      const done: BatchRow[] = [];
      try {
        for (const [index, file] of files.entries()) {
          const label = `File ${index + 1} of ${files.length}: ${file.name}`;
          setBusy(label);
          const notes: string[] = [];
          let ok = true;
          let bytes = file.bytes;
          let changed = false;
          try {
            if (redact || flatten) {
              const marks = new Map<number, Box[]>();
              let count = 0;
              if (redact) {
                const { doc, close } = await openPdf(bytes);
                try {
                  for (let page = 1; page <= doc.numPages; page++) {
                    const boxes = findMatches((await pageText(doc, page)).items, queries).flatMap((match) => match.boxes);
                    if (boxes.length) marks.set(page, boxes);
                    count += boxes.length;
                  }
                } finally {
                  await close();
                }
              }
              if (count || flatten) {
                bytes = await redactPdf(bytes, marks, { dpi, fill: 'black', flattenAll: flatten, ocr: null }, (step) => setBusy(`${label}, ${step}`));
                changed = true;
              }
              if (redact) {
                const failed = count ? (await verifyRedaction(bytes, marks, queries, 'black')).filter((check) => !check.ok) : [];
                notes.push(count ? `${count} redacted${failed.length ? `, ${failed.length} checks failed: ${failed.map((c) => c.label).join('; ')}` : ', checked'}` : 'nothing to redact');
                if (failed.length) ok = false;
              } else notes.push('flattened');
            }
            if (archive !== 'off') {
              const title = file.doc.getTitle() ?? stem(file.name);
              const made = await toPdfA(
                bytes,
                { mode: archive, dpi, hiddenText: true, meta: { title, author: file.doc.getAuthor() ?? '', subject: '', keywords: '', language: '' } },
                srgbProfile(),
                (step) => setBusy(`${label}, ${step}`),
              );
              const failed = made.checks.filter((check) => !check.ok);
              bytes = made.bytes;
              changed = true;
              notes.push(failed.length ? `PDF/A: ${failed.map((c) => c.label.toLowerCase()).join('; ')} failed` : 'PDF/A-2b');
              if (failed.length) ok = false;
            }
            const outputs: BatchRow['outputs'] = [];
            if (changed) outputs.push({ name: `${stem(file.name)}.pdf`, bytes });
            if (text) {
              const { doc, close } = await openPdf(bytes);
              try {
                const pages: string[] = [];
                for (let page = 1; page <= doc.numPages; page++) {
                  const items = (await pageText(doc, page)).items;
                  let body = '';
                  let last: (typeof items)[number] | null = null;
                  for (const item of items) {
                    if (last) body += Math.abs(item.y - last.y) > last.h * 0.5 ? '\n' : item.x - (last.x + last.w) > last.h * 0.25 ? ' ' : '';
                    body += item.text;
                    last = item;
                  }
                  pages.push(body.trim());
                }
                outputs.push({ name: `${stem(file.name)}.txt`, bytes: new TextEncoder().encode(pages.join('\n\n\f')) });
                notes.push('text saved');
              } finally {
                await close();
              }
            }
            done.push({ name: file.name, pages: file.pages, notes, ok, outputs });
          } catch (error) {
            done.push({ name: file.name, pages: file.pages, notes: [error instanceof Error ? error.message : String(error)], ok: false, outputs: [] });
          }
          setRows([...done]);
        }
      } finally {
        setBusy(null);
      }
    });

  const outputs = (rows ?? []).flatMap((row) => row.outputs);
  return (
    <div class="ps-form">
      <FileDrop
        accept="application/pdf,.pdf"
        multiple
        onFiles={(incoming) => void add(incoming)}
        title={files.length ? 'Add more PDFs' : 'Choose the PDFs'}
        hint="or drop them here"
        compact={files.length > 0}
        testId="ps-b-drop"
      />
      {files.length > 0 && (
        <>
          <p class="ps-count">
            {files.length} {files.length === 1 ? 'file' : 'files'}, {files.reduce((sum, f) => sum + f.pages, 0).toLocaleString()} pages{' '}
            <button
              type="button"
              class="link-button"
              onClick={() => {
                setFiles([]);
                setRows(null);
              }}
            >
              Remove all
            </button>
          </p>
          <fieldset class="ps-modes">
            <legend class="control-label">Do this to every file</legend>
            <label class="ps-check">
              <input type="checkbox" checked={redact} onChange={(e) => setRedact(e.currentTarget.checked)} data-testid="ps-b-redact" />
              <span>Redact words and patterns, then check the result</span>
            </label>
            {redact && <FinderForm value={finder} onChange={setFinder} prefix="ps-b" />}
            <label class="ps-check">
              <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.currentTarget.checked)} />
              <span>Turn every page into a picture (removes hidden text, layers and form fields)</span>
            </label>
            <label class="ps-field">
              <span class="control-label">Convert to PDF/A-2b</span>
              <select class="input" value={archive} onChange={(e) => setArchive(e.currentTarget.value as typeof archive)} data-testid="ps-b-archive">
                <option value="off">No</option>
                <option value="kept">Yes, keeping the pages as they are</option>
                <option value="pictures">Yes, turning pages into pictures</option>
              </select>
            </label>
            <label class="ps-check">
              <input type="checkbox" checked={text} onChange={(e) => setText(e.currentTarget.checked)} data-testid="ps-b-text" />
              <span>Save the text of each file as .txt</span>
            </label>
            <label class="ps-field">
              <span class="control-label">Quality of page pictures</span>
              <select class="input" value={dpi} onChange={(e) => setDpi(Number(e.currentTarget.value))}>
                {DPIS.map((value) => (
                  <option key={value} value={value}>
                    {value} dpi
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <button type="button" class="button button-primary" disabled={busy !== null} onClick={() => void run()} data-testid="ps-b-run">
            <Icon name="play" size={14} /> Run on {files.length} {files.length === 1 ? 'file' : 'files'}
          </button>
        </>
      )}
      {rows && (
        <>
          <table class="data-table" data-testid="ps-b-rows">
            <thead>
              <tr>
                <th>File</th>
                <th>Pages</th>
                <th>What happened</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.pages}</td>
                  <td class={row.ok ? '' : 'tone-bad'}>{row.notes.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {outputs.length > 0 && rows.length === files.length && (
            <button
              type="button"
              class="button button-primary"
              onClick={() =>
                attempt(async () => {
                  const entries: Record<string, Uint8Array> = {};
                  for (const output of outputs) {
                    let entry = output.name;
                    for (let n = 2; entries[entry]; n++) entry = output.name.replace(/(\.[^.]+)$/, ` (${n})$1`);
                    entries[entry] = output.bytes;
                  }
                  const saved = await saveFile('pdf-studio-results.zip', zipSync(entries, { level: 0 }), 'application/zip');
                  if (saved.saved) notify(`Saved to ${saved.location}`);
                })
              }
              data-testid="ps-b-save"
            >
              <Icon name="save" size={14} /> Save {outputs.length} {outputs.length === 1 ? 'result' : 'results'} as a ZIP
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Component({ toolId }: { toolId: string }) {
  const [tab, setTab] = usePersistentState<Tab>(
    toolId,
    (stored) => (TABS.some((t) => t.value === stored?.tab) ? (stored?.tab as Tab) : 'redact'),
    (value) => ({ tab: value }),
  );
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <section class="tool ps" data-testid="tool" data-state={busy ? 'busy' : 'idle'}>
      <div class="ps-head">
        <Segmented value={tab} choices={TABS} onChange={setTab} label="What to do" small={false} />
        {busy && (
          <span class="ps-busy" role="status" data-testid="ps-busy">
            {busy}…
          </span>
        )}
      </div>
      {tab === 'redact' && <RedactTab busy={busy} setBusy={setBusy} />}
      {tab === 'ocr' && <OcrTab busy={busy} setBusy={setBusy} />}
      {tab === 'archive' && <ArchiveTab busy={busy} setBusy={setBusy} />}
      {tab === 'batch' && <BatchTab busy={busy} setBusy={setBusy} />}
    </section>
  );
}

export default defineCustomTool(Component);
