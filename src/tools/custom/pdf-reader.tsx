/**
 * PDF Reader: read, search and annotate PDFs.  Pages are drawn with PDF.js as
 * they scroll into view.  Highlights, underlines, strike-outs, notes, text
 * boxes, pen strokes, rectangles, ellipses, lines and arrows are saved as real
 * PDF annotations (with appearances, so other viewers show them the same) or
 * drawn into the pages (flattened).  Annotations of these kinds already in the
 * file can be changed or removed.
 */
import { PDFDocument } from 'pdf-lib';
import type { ComponentChildren, TargetedKeyboardEvent, TargetedPointerEvent, TargetedWheelEvent } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type Annotation,
  type AnnotationKind,
  arrowHead,
  boundsOf,
  boxBetween,
  type Caret,
  caretAt,
  commentsMarkdown,
  geometryOf,
  hits,
  KIND_LABELS,
  type MarkupKind,
  mergeLines,
  movable,
  moveBy,
  NOTE_SIZE,
  newAnnotationId,
  type PageGeometry,
  type Point,
  type Rotation,
  readAnnotations,
  removeAnnotations,
  resizable,
  type ShapeAnnotation,
  type Source,
  saveAnnotations,
  selectText,
  TEXT_LEADING,
  TEXT_PAD,
  type TextAnnotation,
  textHeight,
  viewSize,
  wrapText,
} from '../../lib/pdf-annotate';
import { pageText } from '../../lib/pdf-page-text';
import { type Box, joinItems, queryRegex, rangeBoxes, type TextItem } from '../../lib/pdf-redact';
import { openPdf, type PdfDocument } from '../../lib/pdf-render';
import { type OutlineItem, readOutline } from '../../lib/pdf-toolbox';
import { copyText, pickFiles, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { FileBar, FileDrop, save, stem, useSinglePdf, useThumbnails } from './_pdf';
import { usePersistentState } from './_shared';

const TOOL_ID = 'pdf-reader';
/** Space between pages and around them, in screen pixels. */
const GAP = 14;
const PAD = 16;

type Tool = 'select' | AnnotationKind;
type Side = 'none' | 'pages' | 'contents' | 'comments' | 'search';
type Fit = 'width' | 'page' | 'custom';

interface Settings {
  readonly side: Side;
  readonly fit: Fit;
  readonly zoom: number;
  readonly colors: Readonly<Record<AnnotationKind, string>>;
  readonly width: number;
  readonly size: number;
  readonly author: string;
  readonly flatten: boolean;
}

const DEFAULT_COLORS: Record<AnnotationKind, string> = {
  highlight: '#ffd400',
  underline: '#0072b2',
  strike: '#d55e00',
  note: '#ffd400',
  text: '#d55e00',
  ink: '#d55e00',
  rect: '#0072b2',
  ellipse: '#009e73',
  line: '#000000',
  arrow: '#d55e00',
};
const SWATCHES = ['#ffd400', '#e69f00', '#d55e00', '#cc79a7', '#56b4e9', '#0072b2', '#009e73', '#000000'] as const;
const COLOUR_NAMES: Record<string, string> = {
  '#ffd400': 'Yellow',
  '#e69f00': 'Orange',
  '#d55e00': 'Vermilion',
  '#cc79a7': 'Pink',
  '#56b4e9': 'Sky blue',
  '#0072b2': 'Blue',
  '#009e73': 'Green',
  '#000000': 'Black',
};
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
const WIDTHS = [0.5, 1, 2, 3, 5, 8] as const;
const SIZES = [8, 10, 12, 14, 18, 24, 32] as const;
const SIDES: readonly Side[] = ['none', 'pages', 'contents', 'comments', 'search'];
const MARKUPS: readonly MarkupKind[] = ['highlight', 'underline', 'strike'];
const DRAWN: readonly AnnotationKind[] = ['ink', 'rect', 'ellipse', 'line', 'arrow'];

const TOOLS: readonly { tool: Tool; label: string; key: string }[] = [
  { tool: 'select', label: 'Select and move', key: 'V' },
  { tool: 'highlight', label: 'Highlight', key: 'H' },
  { tool: 'underline', label: 'Underline', key: 'U' },
  { tool: 'strike', label: 'Strike out', key: 'S' },
  { tool: 'note', label: 'Note', key: 'N' },
  { tool: 'text', label: 'Text box', key: 'T' },
  { tool: 'ink', label: 'Pen', key: 'P' },
  { tool: 'rect', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', label: 'Ellipse', key: 'E' },
  { tool: 'line', label: 'Line', key: 'L' },
  { tool: 'arrow', label: 'Arrow', key: 'A' },
];
const SHORTCUTS = new Map(TOOLS.map((t) => [t.key.toLowerCase(), t.tool]));

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isColour = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function readSettings(v: Values | undefined): Settings {
  const colors = { ...DEFAULT_COLORS };
  const stored = v?.colors;
  if (stored && typeof stored === 'object') {
    for (const kind of Object.keys(DEFAULT_COLORS) as AnnotationKind[]) {
      const c = (stored as Record<string, unknown>)[kind];
      if (isColour(c)) colors[kind] = c.toLowerCase();
    }
  }
  const number = (value: unknown, fallback: number, lo: number, hi: number) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback);
  return {
    side: SIDES.includes(v?.side as Side) ? (v?.side as Side) : 'pages',
    fit: v?.fit === 'page' || v?.fit === 'custom' ? v.fit : 'width',
    zoom: number(v?.zoom, 1, 0.25, 5),
    colors,
    width: number(v?.width, 2, 0.5, 12),
    size: number(v?.size, 12, 6, 72),
    author: typeof v?.author === 'string' ? v.author.slice(0, 80) : '',
    flatten: v?.flatten === true,
  };
}

let ruler: CanvasRenderingContext2D | null | undefined;
/** Width of `s` at size 1 in the font text boxes are shown with. */
function measure(s: string): number {
  if (ruler === undefined) ruler = document.createElement('canvas').getContext('2d');
  if (!ruler) return [...s].length * 0.5;
  ruler.font = '100px Helvetica, Arial, sans-serif';
  return ruler.measureText(s).width / 100;
}

function Glyph({ tool }: { tool: Tool }) {
  const paths: Record<Tool, ComponentChildren> = {
    select: <path d="M4 2.5v12l3.2-3 2.3 5 2-1-2.3-4.8h4.3z" fill="currentColor" stroke="none" />,
    highlight: (
      <>
        <rect x="2" y="12.5" width="14" height="4" rx="1" fill="currentColor" stroke="none" opacity="0.35" />
        <path d="M5 10.5 11.5 4l3 3L8 13.5H5z" />
      </>
    ),
    underline: <path d="M5 2.5v6a4 4 0 0 0 8 0v-6M4 15.5h10" />,
    strike: <path d="M12.5 5c-.8-1.3-2-2-3.6-2C6.6 3 5.2 4.2 5.2 5.8c0 3.7 7.6 2.4 7.6 6.2 0 1.8-1.6 3-3.8 3-1.7 0-3.1-.7-3.9-2M3 9h12" />,
    note: <path d="M3 3h12v9H8.5L5 15v-3H3z" />,
    text: <path d="M4 4h10M9 4v11M7 15h4" />,
    ink: <path d="M2 13c2.5-7 4.5-7.5 5.5-3s3 4.5 4 .5 2.5-5.5 4.5-3.5" />,
    rect: <rect x="3" y="4.5" width="12" height="9" rx="1" />,
    ellipse: <ellipse cx="9" cy="9" rx="6.5" ry="4.8" />,
    line: <path d="M3 15 15 3" />,
    arrow: <path d="M3 15 15 3M8.5 3H15v6.5" />,
  };
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {paths[tool]}
    </svg>
  );
}

interface Opened {
  readonly key: string;
  readonly pdf: PdfDocument;
  readonly pages: readonly PageGeometry[];
  readonly outline: readonly OutlineItem[];
  readonly imported: readonly Annotation[];
  /** pdf-lib can read the file, so annotations can be saved into it. */
  readonly editable: boolean;
}

interface History {
  readonly past: readonly (readonly Annotation[])[];
  readonly present: readonly Annotation[];
  readonly future: readonly (readonly Annotation[])[];
  /** Edits with the same key (typing, one drag) make one step. */
  readonly key: string | null;
}

const EMPTY_HISTORY: History = { past: [], present: [], future: [], key: null };

interface Found {
  readonly page: number;
  readonly boxes: readonly Box[];
  readonly text: string;
  readonly before: string;
  readonly after: string;
}

interface SearchState {
  readonly query: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  readonly found: readonly Found[];
  readonly searched: number;
  readonly done: boolean;
}

type Drag =
  | { readonly kind: 'text'; readonly page: number; readonly start: Caret | null; readonly from: Point }
  | { readonly kind: 'move'; readonly page: number; readonly id: string; readonly from: Point; readonly original: Annotation; readonly step: string }
  | { readonly kind: 'resize'; readonly page: number; readonly id: string; readonly from: Point; readonly original: TextAnnotation | ShapeAnnotation; readonly step: string }
  | { readonly kind: 'ink'; readonly page: number; readonly points: Point[] }
  | { readonly kind: 'box'; readonly page: number; readonly tool: 'rect' | 'ellipse' | 'text'; readonly from: Point; to: Point }
  | { readonly kind: 'line'; readonly page: number; readonly tool: 'line' | 'arrow'; readonly from: Point; to: Point };

interface Draft {
  readonly page: number;
  readonly boxes?: readonly Box[];
  readonly area?: boolean;
  readonly points?: readonly Point[];
  readonly box?: Box;
  readonly ellipse?: boolean;
  readonly from?: Point;
  readonly to?: Point;
  readonly arrow?: boolean;
}

interface Selection {
  readonly page: number;
  readonly text: string;
  readonly boxes: readonly Box[];
}

/** One page drawn at `zoom`, into a spare canvas first so the old picture stays until the new one is ready. */
function PageCanvas({ pdf, number, zoom, width, height }: { pdf: PdfDocument; number: number; zoom: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    const timer = setTimeout(async () => {
      try {
        const page = await pdf.getPage(number);
        if (cancelled) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        // At most about 16 million pixels a page.
        const scale = Math.min(zoom * ratio, Math.sqrt(16e6 / Math.max(1, width * height)));
        const viewport = page.getViewport({ scale });
        const spare = document.createElement('canvas');
        spare.width = Math.ceil(viewport.width);
        spare.height = Math.ceil(viewport.height);
        const context = spare.getContext('2d');
        if (!context) return;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, spare.width, spare.height);
        task = page.render({ canvasContext: context, viewport, canvas: spare });
        await task.promise;
        const canvas = ref.current;
        if (cancelled || !canvas) return;
        canvas.width = spare.width;
        canvas.height = spare.height;
        canvas.getContext('2d')?.drawImage(spare, 0, 0);
        canvas.dataset.drawn = String(zoom);
      } catch {
        // Cancelled, or a page PDF.js cannot draw: it stays blank.
      }
    }, 40);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [pdf, number, zoom, width, height]);
  return <canvas ref={ref} class="rd-canvas" style={{ width: `${width * zoom}px`, height: `${height * zoom}px` }} role="img" aria-label={`Page ${number}`} />;
}

/** How an annotation looks on the page (in page points). */
function AnnotationShape({ a, hidden }: { a: Annotation; hidden?: boolean }) {
  const common = { 'data-annotation': a.id, 'data-kind': a.kind, class: 'rd-annotation', style: { opacity: hidden ? 0 : a.opacity } };
  switch (a.kind) {
    case 'highlight':
      return (
        <g {...common} style={{ opacity: a.opacity, mixBlendMode: 'multiply' }}>
          {a.boxes.map((b, i) => (
            <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} style={{ fill: a.color }} />
          ))}
        </g>
      );
    case 'underline':
    case 'strike': {
      const height = Math.max(1, ...a.boxes.map((b) => b.h));
      return (
        <g {...common}>
          {a.boxes.map((b, i) => {
            const y = b.y + b.h * (a.kind === 'underline' ? 0.86 : 0.56);
            return <line key={i} x1={b.x} y1={y} x2={b.x + b.w} y2={y} style={{ stroke: a.color, strokeWidth: Math.max(0.6, height * 0.07) }} />;
          })}
          {a.boxes.map((b, i) => (
            <rect key={`h${i}`} x={b.x} y={b.y} width={b.w} height={b.h} class="rd-hit" />
          ))}
        </g>
      );
    }
    case 'note': {
      const [x, y] = a.at;
      const s = NOTE_SIZE;
      return (
        <g {...common}>
          <path
            d={`M${x + 1} ${y + 1}H${x + s - 1}V${y + s * 0.72}H${x + s * 0.5}L${x + s * 0.25} ${y + s - 1}L${x + s * 0.3} ${y + s * 0.72}H${x + 1}Z`}
            style={{ fill: a.color, stroke: '#404040', strokeWidth: 0.8, strokeLinejoin: 'round' }}
          />
          {[0.22, 0.38, 0.54].map((row) => (
            <line key={row} x1={x + s * 0.22} y1={y + s * row} x2={x + s * 0.78} y2={y + s * row} style={{ stroke: '#404040', strokeWidth: 0.8 }} />
          ))}
        </g>
      );
    }
    case 'text': {
      const lines = wrapText(a.text, a.box.w - TEXT_PAD * 2, a.size, measure);
      return (
        <g {...common}>
          <rect x={a.box.x} y={a.box.y} width={a.box.w} height={Math.max(a.box.h, textHeight(lines.length, a.size))} class="rd-hit" />
          <text class="rd-text" style={{ fill: a.color, fontSize: `${a.size}px` }}>
            {lines.map((line, i) => (
              <tspan key={i} x={a.box.x + TEXT_PAD} y={a.box.y + TEXT_PAD + a.size * (0.85 + i * TEXT_LEADING)}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      );
    }
    case 'ink':
      return (
        <g {...common}>
          {a.strokes.map((stroke, i) => (
            <polyline
              key={i}
              points={(stroke.length === 1 ? [stroke[0], stroke[0]] : stroke).map((p) => `${p?.[0]},${p?.[1]}`).join(' ')}
              class="rd-stroke"
              style={{ stroke: a.color, strokeWidth: a.width }}
            />
          ))}
        </g>
      );
    case 'rect':
      return (
        <g {...common}>
          <rect x={a.box.x} y={a.box.y} width={a.box.w} height={a.box.h} style={{ stroke: a.color, strokeWidth: a.width, fill: a.fill ?? 'none' }} />
        </g>
      );
    case 'ellipse':
      return (
        <g {...common}>
          <ellipse cx={a.box.x + a.box.w / 2} cy={a.box.y + a.box.h / 2} rx={a.box.w / 2} ry={a.box.h / 2} style={{ stroke: a.color, strokeWidth: a.width, fill: a.fill ?? 'none' }} />
        </g>
      );
    default: {
      const head = a.kind === 'arrow' ? arrowHead(a.from, a.to, a.width) : null;
      return (
        <g {...common}>
          <line x1={a.from[0]} y1={a.from[1]} x2={a.to[0]} y2={a.to[1]} class="rd-stroke" style={{ stroke: a.color, strokeWidth: a.width }} />
          {head && <polyline points={`${head[0][0]},${head[0][1]} ${a.to[0]},${a.to[1]} ${head[1][0]},${head[1][1]}`} class="rd-stroke" style={{ stroke: a.color, strokeWidth: a.width }} />}
        </g>
      );
    }
  }
}

function Outline({ items, go }: { items: readonly OutlineItem[]; go: (page: number) => void }) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>
          <button type="button" class="rd-link" disabled={!item.page} onClick={() => go(item.page)}>
            <span>{item.title || 'Untitled'}</span>
            {item.page > 0 && <span class="tone-muted">{item.page}</span>}
          </button>
          {item.children.length > 0 && <Outline items={item.children} go={go} />}
        </li>
      ))}
    </ul>
  );
}

function PdfReader() {
  const [settings, setSettings] = usePersistentState(TOOL_ID, readSettings, (s) => ({ ...s }));
  const [file, take, clear, loading] = useSinglePdf();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [opening, setOpening] = useState(false);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [saved, setSaved] = useState<readonly Annotation[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [range, setRange] = useState({ first: 0, last: 0 });
  const [current, setCurrent] = useState(1);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [frame, setFrame] = useState({ width: 800, height: 600 });
  const [search, setSearch] = useState<SearchState | null>(null);
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [hit, setHit] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [textReady, setTextReady] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const textEditRef = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<Drag | null>(null);
  const texts = useRef(new Map<number, TextItem[]>());
  const pending = useRef(new Map<number, Promise<TextItem[]>>());
  const searchRun = useRef(0);
  const steps = useRef(0);

  const annotations = history.present;
  const pages = opened?.pages ?? [];
  const sizes = useMemo(() => pages.map(viewSize), [pages]);
  const count = pages.length;

  // ------------------------------------------------------------ opening

  useEffect(() => {
    setOpened(null);
    setHistory(EMPTY_HISTORY);
    setSaved([]);
    setSelected(null);
    setEditing(null);
    setSelection(null);
    setSearch(null);
    setHit(0);
    setCurrent(1);
    texts.current = new Map();
    pending.current = new Map();
    if (!file) return;
    let cancelled = false;
    let close: (() => Promise<void>) | null = null;
    setOpening(true);
    void (async () => {
      try {
        let render = file.bytes;
        let geometry: PageGeometry[] | null = null;
        let outline: OutlineItem[] = [];
        let imported: Annotation[] = [];
        let editable = true;
        try {
          const lib = await PDFDocument.load(file.bytes, { ignoreEncryption: true, updateMetadata: false });
          geometry = lib.getPages().map(geometryOf);
          outline = readOutline(lib);
          imported = readAnnotations(lib);
          if (imported.length) {
            // PDF.js draws the page without them; they are drawn over it, where they can be changed.
            removeAnnotations(
              lib,
              imported.flatMap((a) => (a.source ? [a.source] : [])),
            );
            render = await lib.save({ useObjectStreams: false });
          }
        } catch {
          editable = false;
          imported = [];
        }
        const doc = await openPdf(render);
        close = doc.close;
        if (cancelled) return;
        if (!geometry || geometry.length !== doc.doc.numPages) {
          geometry = [];
          for (let n = 1; n <= doc.doc.numPages; n++) {
            const page = await doc.doc.getPage(n);
            const [x0 = 0, y0 = 0, x1 = 612, y1 = 792] = page.view;
            geometry.push({ view: [x0, y0, x1, y1], rotate: (((page.rotate % 360) + 360) % 360) as Rotation });
          }
        }
        if (cancelled) return;
        setOpened({ key: file.id, pdf: doc.doc, pages: geometry, outline, imported, editable });
        setHistory({ ...EMPTY_HISTORY, present: imported });
        setSaved(imported);
        if (!editable) notify('This PDF can be read but not changed here, so annotations cannot be saved into it.', 'error');
      } catch (error) {
        if (!cancelled) notify(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        if (!cancelled) setOpening(false);
      }
    })();
    return () => {
      cancelled = true;
      void close?.();
    };
  }, [file?.id]);

  // A text box opens for typing as soon as it is made.
  useEffect(() => {
    if (!editing) return;
    const box = textEditRef.current;
    box?.focus({ preventScroll: true });
    box?.setSelectionRange(box.value.length, box.value.length);
  }, [editing]);

  /** The words of a page with their places (loaded once). */
  const textOf = (n: number): Promise<TextItem[]> => {
    const known = texts.current.get(n);
    if (known) return Promise.resolve(known);
    let job = pending.current.get(n);
    if (!job && opened) {
      const pdf = opened.pdf;
      job = pageText(pdf, n)
        .then((t) => t.items)
        .catch(() => [] as TextItem[])
        .then((items) => {
          if (opened.pdf === pdf) {
            texts.current.set(n, items);
            setTextReady((v) => v + 1);
          }
          return items;
        });
      pending.current.set(n, job);
    }
    return job ?? Promise.resolve([]);
  };

  // ------------------------------------------------------------ layout and zoom

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const measureFrame = () => setFrame({ width: el.clientWidth, height: el.clientHeight });
    measureFrame();
    const observer = new ResizeObserver(measureFrame);
    observer.observe(el);
    return () => observer.disconnect();
  }, [opened?.key]);

  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);

  // Fitting goes by the usual page, so a few turned pages neither shrink the rest nor make the zoom jump.
  const typical = useMemo(() => [...sizes].sort((a, b) => a.width - b.width)[Math.floor(sizes.length / 2)] ?? { width: 612, height: 792 }, [sizes]);
  const fitWidth = clamp((frame.width - PAD * 2 - 4) / typical.width, 0.1, 5);
  const fitPage = clamp(Math.min((frame.width - PAD * 2 - 4) / typical.width, (frame.height - PAD * 2) / typical.height), 0.1, 5);
  const zoom = settings.fit === 'width' ? fitWidth : settings.fit === 'page' ? fitPage : settings.zoom;

  const layout = useMemo(() => {
    const tops: number[] = [];
    let y = PAD;
    for (const s of sizes) {
      tops.push(y);
      y += s.height * zoom + GAP;
    }
    return { tops, height: y - GAP + PAD, zoom };
  }, [sizes, zoom]);
  const previous = useRef(layout);

  const pageAt = (y: number, tops: readonly number[]): number => {
    let lo = 0;
    let hi = tops.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if ((tops[mid] ?? 0) <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const updateRange = () => {
    const el = viewRef.current;
    if (!el || !count) return;
    const top = el.scrollTop;
    const first = pageAt(top - el.clientHeight * 0.75, layout.tops);
    const last = pageAt(top + el.clientHeight * 1.75, layout.tops);
    setRange((r) => (r.first === first && r.last === last ? r : { first, last }));
    setCurrent(pageAt(top + el.clientHeight * 0.3, layout.tops) + 1);
  };

  // Keep the same place in view when the zoom changes.
  useLayoutEffect(() => {
    const el = viewRef.current;
    const before = previous.current;
    previous.current = layout;
    // At the very top it stays at the top; otherwise the middle of the view stays put.
    if (!el || before.zoom === layout.zoom || !before.tops.length || el.scrollTop === 0) {
      updateRange();
      return;
    }
    const middle = el.scrollTop + el.clientHeight / 2;
    const index = pageAt(middle, before.tops);
    const inside = (middle - (before.tops[index] ?? 0)) / before.zoom;
    el.scrollTop = (layout.tops[index] ?? 0) + inside * layout.zoom - el.clientHeight / 2;
    el.scrollLeft = ((el.scrollLeft + el.clientWidth / 2) * layout.zoom) / before.zoom - el.clientWidth / 2;
    updateRange();
  }, [layout]);

  useEffect(() => {
    for (let n = range.first + 1; n <= range.last + 1; n++) void textOf(n);
  }, [range, opened?.key]);

  const setZoom = (next: number) => setSettings((s) => ({ ...s, fit: 'custom', zoom: clamp(Math.round(next * 100) / 100, 0.25, 5) }));
  const zoomStep = (up: boolean) => {
    const steps = [...ZOOMS];
    const next = up ? (steps.find((z) => z > zoom + 0.001) ?? 5) : ([...steps].reverse().find((z) => z < zoom - 0.001) ?? 0.25);
    setZoom(next);
  };

  /** Scrolls a page (and a place on it) into view. */
  const goTo = (page: number, box?: Box) => {
    const el = viewRef.current;
    const n = clamp(Math.round(page), 1, Math.max(1, count));
    if (!el || !count) return;
    const top = layout.tops[n - 1] ?? 0;
    el.scrollTop = box ? top + box.y * zoom - el.clientHeight / 3 : top - PAD / 2;
    if (box) {
      const left = (el.scrollWidth - (sizes[n - 1]?.width ?? 0) * zoom) / 2;
      const x = left + box.x * zoom;
      if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - el.clientWidth / 3;
    }
    setCurrent(n);
    updateRange();
  };

  // ------------------------------------------------------------ editing

  const commit = (change: (list: readonly Annotation[]) => readonly Annotation[], key: string | null = null) =>
    setHistory((h) => {
      const next = change(h.present);
      if (next === h.present) return h;
      if (key && key === h.key) return { ...h, present: next };
      return { past: [...h.past.slice(-199), h.present], present: next, future: [], key };
    });
  const undo = () =>
    setHistory((h) => {
      const last = h.past[h.past.length - 1];
      return last ? { past: h.past.slice(0, -1), present: last, future: [h.present, ...h.future], key: null } : h;
    });
  const redo = () =>
    setHistory((h) => {
      const [next, ...rest] = h.future;
      return next ? { past: [...h.past, h.present], present: next, future: rest, key: null } : h;
    });
  const add = (...made: Annotation[]) => commit((list) => [...list, ...made]);
  const update = (id: string, change: (a: Annotation) => Annotation, key: string | null = null) =>
    commit((list) => {
      let changed = false;
      const next = list.map((a) => {
        if (a.id !== id) return a;
        const b = change(a);
        if (b === a) return a;
        changed = true;
        return { ...b, modified: new Date().toISOString() } as Annotation;
      });
      return changed ? next : list;
    }, key);
  const remove = (id: string) => {
    commit((list) => list.filter((a) => a.id !== id));
    if (selected === id) setSelected(null);
    if (editing === id) setEditing(null);
  };

  const base = (kind: AnnotationKind, page: number) => ({
    id: newAnnotationId(),
    page,
    color: settings.colors[kind],
    opacity: 1,
    comment: '',
    author: settings.author.trim(),
    modified: new Date().toISOString(),
  });
  const markup = (kind: MarkupKind, page: number, text: string, boxes: readonly Box[]): Annotation => ({ ...base(kind, page), kind, text, boxes });

  const selectedAnnotation = annotations.find((a) => a.id === selected) ?? null;
  const editingAnnotation = annotations.find((a) => a.id === editing && a.kind === 'text') as TextAnnotation | undefined;

  const pickColour = (colour: string) => {
    const kind = selectedAnnotation?.kind ?? (tool === 'select' ? null : tool);
    if (kind) setSettings((s) => ({ ...s, colors: { ...s.colors, [kind]: colour } }));
    if (selectedAnnotation) update(selectedAnnotation.id, (a) => ({ ...a, color: colour }));
  };

  const chooseTool = (next: Tool) => {
    setTool(next);
    setSelection(null);
    if (next !== 'select') setSelected(null);
  };

  // ------------------------------------------------------------ pointer

  const pointOf = (e: { clientX: number; clientY: number; currentTarget: Element }, n: number): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    const size = sizes[n - 1] ?? { width: 0, height: 0 };
    return [clamp((e.clientX - r.left) / zoom, 0, size.width), clamp((e.clientY - r.top) / zoom, 0, size.height)];
  };

  const toDraft = (d: Drag, p: Point, shift: boolean): Draft | null => {
    switch (d.kind) {
      case 'text': {
        const items = texts.current.get(d.page) ?? [];
        if (!d.start) return { page: d.page, boxes: [boxBetween(d.from, p)], area: true };
        const end = caretAt(items, p);
        return { page: d.page, boxes: end ? selectText(items, d.start, end).boxes : [] };
      }
      case 'ink':
        return { page: d.page, points: d.points };
      case 'box': {
        const to = shift && d.tool !== 'text' ? square(d.from, p) : p;
        return { page: d.page, box: boxBetween(d.from, to), ellipse: d.tool === 'ellipse' };
      }
      case 'line':
        return { page: d.page, from: d.from, to: shift ? snap(d.from, p) : p, arrow: d.tool === 'arrow' };
      default:
        return null;
    }
  };

  const onDown = (n: number, e: TargetedPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !opened) return;
    const p = pointOf(e, n);
    viewRef.current?.focus({ preventScroll: true });
    if (editing) setEditing(null);
    setSelection(null);
    const items = texts.current.get(n) ?? [];
    if (tool === 'select') {
      const mine = selectedAnnotation && selectedAnnotation.page === n ? selectedAnnotation : null;
      if (mine && resizable(mine)) {
        const b = boundsOf(mine);
        if (Math.hypot(p[0] - (b.x + b.w), p[1] - (b.y + b.h)) <= 7 / zoom) {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { kind: 'resize', page: n, id: mine.id, from: p, original: mine, step: `resize-${steps.current++}` };
          return;
        }
      }
      const found = [...annotations].reverse().find((a) => a.page === n && hits(a, p, 4 / zoom));
      if (found) {
        setSelected(found.id);
        if (movable(found)) {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { kind: 'move', page: n, id: found.id, from: p, original: found, step: `move-${steps.current++}` };
        }
        return;
      }
      setSelected(null);
      // Touch scrolls the page; a mouse or pen selects text.
      if (e.pointerType === 'touch') return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind: 'text', page: n, start: caretAt(items, p), from: p };
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    setSelected(null);
    if (tool === 'highlight' || tool === 'underline' || tool === 'strike') drag.current = { kind: 'text', page: n, start: caretAt(items, p), from: p };
    else if (tool === 'note') {
      const note: Annotation = {
        ...base('note', n),
        kind: 'note',
        at: [clamp(p[0] - NOTE_SIZE / 2, 0, (sizes[n - 1]?.width ?? 0) - NOTE_SIZE), clamp(p[1] - NOTE_SIZE / 2, 0, (sizes[n - 1]?.height ?? 0) - NOTE_SIZE)],
      };
      add(note);
      setSelected(note.id);
      setTool('select');
      setTimeout(() => commentRef.current?.focus(), 30);
      return;
    } else if (tool === 'ink') drag.current = { kind: 'ink', page: n, points: [p] };
    else if (tool === 'rect' || tool === 'ellipse' || tool === 'text') drag.current = { kind: 'box', page: n, tool, from: p, to: p };
    else drag.current = { kind: 'line', page: n, tool, from: p, to: p };
    setDraft(drag.current ? toDraft(drag.current, p, e.shiftKey) : null);
  };

  const onMove = (n: number, e: TargetedPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.page !== n) return;
    const p = pointOf(e, n);
    if (d.kind === 'move') {
      const dx = p[0] - d.from[0];
      const dy = p[1] - d.from[1];
      if (Math.hypot(dx, dy) * zoom < 2) return;
      update(d.id, () => moveBy(d.original, dx, dy), d.step);
      return;
    }
    if (d.kind === 'resize') {
      const b = d.original.box;
      const w = Math.max(8, b.w + p[0] - d.from[0]);
      const h = Math.max(8, b.h + p[1] - d.from[1]);
      update(d.id, () => ({ ...d.original, box: { ...b, w, h } }), d.step);
      return;
    }
    if (d.kind === 'ink') {
      const last = d.points[d.points.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) * zoom < 1.5) return;
      d.points.push(p);
    }
    if (d.kind === 'box' || d.kind === 'line') d.to = p;
    setDraft(toDraft(d, p, e.shiftKey));
  };

  const finish = (n: number, e: TargetedPointerEvent<SVGSVGElement>, cancelled = false) => {
    const d = drag.current;
    drag.current = null;
    setDraft(null);
    if (!d || d.page !== n || cancelled) return;
    const p = pointOf(e, n);
    const size = sizes[n - 1] ?? { width: 0, height: 0 };
    switch (d.kind) {
      case 'text': {
        const items = texts.current.get(n) ?? [];
        let found: { text: string; boxes: Box[] } | null = null;
        if (d.start) {
          const end = caretAt(items, p);
          if (end) found = selectText(items, d.start, end);
          if (found && !found.text) found = null;
        } else {
          const box = boxBetween(d.from, p);
          if (box.w > 3 && box.h > 3) found = { text: '', boxes: [box] };
        }
        if (!found?.boxes.length) return;
        if (tool === 'highlight' || tool === 'underline' || tool === 'strike') add(markup(tool, n, found.text, found.boxes));
        else if (found.text) setSelection({ page: n, ...found });
        return;
      }
      case 'ink':
        add({ ...base('ink', n), kind: 'ink', width: settings.width, strokes: [[...d.points]] });
        return;
      case 'box': {
        let box = boxBetween(d.from, e.shiftKey && d.tool !== 'text' ? square(d.from, p) : p);
        const small = box.w < 4 && box.h < 4;
        if (d.tool === 'text') {
          if (small) box = { x: d.from[0], y: d.from[1], w: Math.min(200, size.width - d.from[0]), h: textHeight(1, settings.size) };
          box = { ...box, w: Math.max(box.w, 40), h: Math.max(box.h, textHeight(1, settings.size)) };
          const made: Annotation = { ...base('text', n), kind: 'text', box, text: '', size: settings.size };
          add(made);
          setSelected(made.id);
          setEditing(made.id);
          setTool('select');
          return;
        }
        if (small) box = { x: d.from[0] - 40, y: d.from[1] - 25, w: 80, h: 50 };
        add({ ...base(d.tool, n), kind: d.tool, box, width: settings.width, fill: null });
        return;
      }
      case 'line': {
        let to = e.shiftKey ? snap(d.from, p) : p;
        if (Math.hypot(to[0] - d.from[0], to[1] - d.from[1]) < 4) to = [d.from[0] + 80, d.from[1]];
        add({ ...base(d.tool, n), kind: d.tool, from: d.from, to, width: settings.width });
        return;
      }
      default:
    }
  };

  // ------------------------------------------------------------ keys

  const onKey = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && key === 'y') redo();
    else if (mod && key === 'c' && selection) void attempt(() => copyText(selection.text).then(() => notify('Copied.')));
    else if (mod && (key === '=' || key === '+')) zoomStep(true);
    else if (mod && key === '-') zoomStep(false);
    else if (mod && key === '0') setSettings((s) => ({ ...s, fit: 'width' }));
    else if (mod || e.altKey) return;
    else if ((key === 'delete' || key === 'backspace') && selectedAnnotation) remove(selectedAnnotation.id);
    else if (key === 'escape') {
      if (drag.current) {
        drag.current = null;
        setDraft(null);
      } else if (selection) setSelection(null);
      else if (selected) setSelected(null);
      else setTool('select');
    } else if (key === 'home') goTo(1);
    else if (key === 'end') goTo(count);
    else if (SHORTCUTS.has(key)) chooseTool(SHORTCUTS.get(key) as Tool);
    else return;
    e.preventDefault();
  };

  const onWheel = (e: TargetedWheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  };

  // ------------------------------------------------------------ search

  const runSearch = async (text: string, caseSensitive: boolean, whole: boolean) => {
    const id = ++searchRun.current;
    const built = queryRegex({ kind: 'text', text, caseSensitive, wholeWord: whole });
    if (!built || !opened) {
      setSearch(null);
      return;
    }
    const found: Found[] = [];
    setHit(0);
    setSearch({ query: text, matchCase: caseSensitive, wholeWord: whole, found: [], searched: 0, done: false });
    let shown = false;
    for (let n = 1; n <= count; n++) {
      const items = await textOf(n);
      if (id !== searchRun.current) return;
      const joined = joinItems(items);
      for (const m of joined.text.matchAll(new RegExp(built.regex.source, built.regex.flags))) {
        if (!m[0].trim()) continue;
        const start = m.index;
        const end = start + m[0].length;
        found.push({
          page: n,
          boxes: mergeLines(rangeBoxes(items, joined, start, end, 1)),
          text: m[0],
          before: joined.text.slice(Math.max(0, start - 40), start),
          after: joined.text.slice(end, end + 40),
        });
      }
      if (!shown && found.length) {
        shown = true;
        const first = found[0] as Found;
        goTo(first.page, first.boxes[0]);
      }
      if (n % 8 === 0 || n === count) setSearch({ query: text, matchCase: caseSensitive, wholeWord: whole, found: [...found], searched: n, done: n === count });
    }
  };

  const showHit = (index: number) => {
    const list = search?.found ?? [];
    if (!list.length) return;
    const i = ((index % list.length) + list.length) % list.length;
    setHit(i);
    const f = list[i] as Found;
    goTo(f.page, f.boxes[0]);
  };

  const submitSearch = (back: boolean) => {
    const same = search && search.query === query && search.matchCase === matchCase && search.wholeWord === wholeWord;
    if (same) showHit(hit + (back ? -1 : 1));
    else void runSearch(query, matchCase, wholeWord);
  };

  const highlightAll = () => {
    const list = search?.found ?? [];
    if (!list.length) return;
    add(...list.map((f) => markup('highlight', f.page, f.text, f.boxes)));
    notify(`Highlighted ${list.length} match${list.length === 1 ? '' : 'es'}.`);
  };

  // ------------------------------------------------------------ saving

  const changes = () => {
    const imported = new Map((opened?.imported ?? []).map((a) => [a.id, a]));
    const present = new Set(annotations.map((a) => a.id));
    const remove: Source[] = (opened?.imported ?? []).filter((a) => !present.has(a.id) && a.source).map((a) => a.source as Source);
    const write = settings.flatten ? annotations : annotations.filter((a) => !a.source || imported.get(a.id) !== a);
    return { write, remove };
  };

  const saveAnnotated = () =>
    attempt(async () => {
      if (!file || !opened) return;
      if (!opened.editable) throw new Error('This PDF can be read but not changed here, so annotations cannot be saved into it.');
      const doc = await PDFDocument.load(file.bytes, { ignoreEncryption: true, updateMetadata: false });
      const { write, remove } = changes();
      await saveAnnotations(doc, { write, remove, flatten: settings.flatten });
      const bytes = await doc.save();
      await save(`${stem(file.name)} (${settings.flatten ? 'flattened' : 'annotated'}).pdf`, bytes);
      setSaved(annotations);
    });

  const saveComments = () =>
    attempt(async () => {
      if (!file) return;
      const text = commentsMarkdown(annotations, file.name);
      const done = await saveFile(`${stem(file.name)} comments.md`, new TextEncoder().encode(text), 'text/markdown');
      if (done.saved) notify(`Saved to ${done.location}`);
    });

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void rootRef.current?.requestFullscreen?.().catch(() => notify('Full screen is not available here.', 'error'));
  };

  const thumbs = useThumbnails(settings.side === 'pages' && file ? file : null, 110, 400);

  // ------------------------------------------------------------ drawing

  const sorted = useMemo(() => [...annotations].sort((a, b) => a.page - b.page || boundsOf(a).y - boundsOf(b).y || boundsOf(a).x - boundsOf(b).x), [annotations]);
  const unsaved = annotations !== saved;
  const activeKind: AnnotationKind | null = selectedAnnotation?.kind ?? (tool === 'select' ? null : tool);
  const activeColour = activeKind ? (selectedAnnotation?.color ?? settings.colors[activeKind]) : null;

  const renderPage = (n: number) => {
    const size = sizes[n - 1] ?? { width: 612, height: 792 };
    const near = n - 1 >= range.first && n - 1 <= range.last;
    const onPage = annotations.filter((a) => a.page === n);
    const found = (search?.found ?? []).map((f, i) => ({ f, i })).filter(({ f }) => f.page === n);
    const mine = selectedAnnotation?.page === n ? selectedAnnotation : null;
    const bounds = mine ? boundsOf(mine) : null;
    return (
      <div key={n} class="rd-page" style={{ width: `${size.width * zoom}px`, height: `${size.height * zoom}px` }} data-testid={`rd-page-${n}`} data-page={n}>
        {near && opened && <PageCanvas pdf={opened.pdf} number={n} zoom={zoom} width={size.width} height={size.height} />}
        {near && (
          <svg
            class={`rd-overlay is-${tool}`}
            width={size.width * zoom}
            height={size.height * zoom}
            viewBox={`0 0 ${size.width} ${size.height}`}
            data-testid={`rd-overlay-${n}`}
            onPointerDown={(e) => onDown(n, e)}
            onPointerMove={(e) => onMove(n, e)}
            onPointerUp={(e) => finish(n, e)}
            onPointerCancel={(e) => finish(n, e, true)}
            role="presentation"
          >
            {found.map(({ f, i }) =>
              f.boxes.map((b, j) => (
                <rect key={`${i}-${j}`} x={b.x} y={b.y} width={b.w} height={b.h} class={i === hit ? 'rd-found is-current' : 'rd-found'} data-testid={i === hit ? 'rd-hit-current' : undefined} />
              )),
            )}
            {onPage.map((a) => (
              <AnnotationShape key={a.id} a={a} hidden={a.id === editing} />
            ))}
            {selection?.page === n && selection.boxes.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} class="rd-selection" />)}
            {draft?.page === n && <DraftShape draft={draft} colour={activeColour ?? '#0072b2'} width={settings.width} />}
            {bounds && mine && (
              <g class="rd-chosen">
                <rect x={bounds.x - 2} y={bounds.y - 2} width={bounds.w + 4} height={bounds.h + 4} />
                {resizable(mine) && <circle cx={bounds.x + bounds.w} cy={bounds.y + bounds.h} r={4 / zoom} class="rd-handle" />}
              </g>
            )}
          </svg>
        )}
        {selection?.page === n && (
          <div class="rd-float" style={floatAt(selection.boxes[0], zoom, size)} data-testid="rd-selection-bar">
            <button type="button" class="button button-small" data-testid="rd-sel-copy" onClick={() => attempt(() => copyText(selection.text).then(() => notify('Copied.')))}>
              Copy
            </button>
            {MARKUPS.map((kind) => (
              <button
                key={kind}
                type="button"
                class="button button-small"
                data-testid={`rd-sel-${kind}`}
                onClick={() => {
                  add(markup(kind, n, selection.text, selection.boxes));
                  setSelection(null);
                }}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        )}
        {mine && bounds && !editing && tool === 'select' && !drag.current && (
          <div class="rd-popover" style={popoverAt(bounds, zoom, size)} data-testid="rd-popover" onPointerDown={(e) => e.stopPropagation()}>
            <div class="rd-popover-head">
              <strong>{KIND_LABELS[mine.kind]}</strong>
              {mine.author && <span class="tone-muted">{mine.author}</span>}
            </div>
            <Swatches value={mine.color} onPick={pickColour} />
            {(mine.kind === 'ink' || mine.kind === 'rect' || mine.kind === 'ellipse' || mine.kind === 'line' || mine.kind === 'arrow') && (
              <label class="rd-inline">
                Line
                <select class="input input-small" value={String(mine.width)} onChange={(e) => update(mine.id, (a) => ({ ...a, width: Number(e.currentTarget.value) }) as Annotation)}>
                  {[...new Set([...WIDTHS, mine.width])]
                    .sort((a, b) => a - b)
                    .map((w) => (
                      <option key={w} value={w}>
                        {w} pt
                      </option>
                    ))}
                </select>
              </label>
            )}
            {(mine.kind === 'rect' || mine.kind === 'ellipse') && (
              <label class="check">
                <input type="checkbox" checked={mine.fill !== null} onChange={(e) => update(mine.id, (a) => ({ ...a, fill: e.currentTarget.checked ? '#ffffff' : null }) as Annotation)} /> White fill
              </label>
            )}
            {mine.kind === 'highlight' && (
              <label class="rd-inline">
                Strength
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.1}
                  value={mine.opacity}
                  onInput={(e) => update(mine.id, (a) => ({ ...a, opacity: Number(e.currentTarget.value) }), `opacity-${mine.id}`)}
                />
              </label>
            )}
            {mine.kind === 'text' ? (
              <div class="rd-row">
                <label class="rd-inline">
                  Size
                  <select class="input input-small" value={String(mine.size)} onChange={(e) => update(mine.id, (a) => ({ ...a, size: Number(e.currentTarget.value) }) as Annotation)}>
                    {[...new Set([...SIZES, mine.size])]
                      .sort((a, b) => a - b)
                      .map((s) => (
                        <option key={s} value={s}>
                          {s} pt
                        </option>
                      ))}
                  </select>
                </label>
                <button type="button" class="button button-small" onClick={() => setEditing(mine.id)} data-testid="rd-edit-text">
                  Edit text
                </button>
              </div>
            ) : (
              <textarea
                ref={commentRef}
                class="input rd-comment"
                rows={3}
                placeholder={mine.kind === 'note' ? 'Write the note' : 'Add a comment'}
                value={mine.comment}
                data-testid="rd-popover-text"
                onInput={(e) => update(mine.id, (a) => ({ ...a, comment: e.currentTarget.value }), `comment-${mine.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSelected(null);
                    viewRef.current?.focus();
                  }
                }}
              />
            )}
            <div class="rd-row">
              <button type="button" class="button button-small button-quiet" data-testid="rd-delete" onClick={() => remove(mine.id)}>
                <Icon name="trash" size={14} /> Delete
              </button>
              <button type="button" class="button button-small" onClick={() => setSelected(null)}>
                Done
              </button>
            </div>
          </div>
        )}
        {editingAnnotation && editingAnnotation.page === n && (
          <textarea
            ref={textEditRef}
            class="rd-text-edit"
            data-testid="rd-text-edit"
            aria-label="Text on the page"
            value={editingAnnotation.text}
            style={{
              left: `${editingAnnotation.box.x * zoom}px`,
              top: `${editingAnnotation.box.y * zoom}px`,
              width: `${editingAnnotation.box.w * zoom}px`,
              height: `${Math.max(editingAnnotation.box.h, textHeight(wrapText(editingAnnotation.text, editingAnnotation.box.w - TEXT_PAD * 2, editingAnnotation.size, measure).length, editingAnnotation.size)) * zoom}px`,
              fontSize: `${editingAnnotation.size * zoom}px`,
              lineHeight: TEXT_LEADING,
              padding: `${TEXT_PAD * zoom}px`,
              color: editingAnnotation.color,
            }}
            onInput={(e) => {
              const text = e.currentTarget.value;
              update(
                editingAnnotation.id,
                (a) => {
                  if (a.kind !== 'text') return a;
                  const lines = wrapText(text, a.box.w - TEXT_PAD * 2, a.size, measure).length;
                  return { ...a, text, box: { ...a.box, h: Math.max(a.box.h, textHeight(lines, a.size)) } };
                },
                `text-${editingAnnotation.id}`,
              );
            }}
            onBlur={(e) => {
              const id = editingAnnotation.id;
              setEditing(null);
              if (!e.currentTarget.value.trim()) remove(id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.blur();
                viewRef.current?.focus();
              }
            }}
          />
        )}
      </div>
    );
  };

  const state = !file ? 'idle' : opening || loading || !opened ? 'loading' : 'ready';
  const side = settings.side;

  return (
    <section
      class="tool rd-tool"
      data-testid="tool"
      data-state={state}
      data-annotations={annotations.length}
      ref={rootRef}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && opened) {
          e.preventDefault();
          if (side !== 'search') setSettings((s) => ({ ...s, side: 'search' }));
          setTimeout(() => searchRef.current?.select(), 0);
        }
      }}
    >
      {file ? (
        <FileBar file={file} onReplace={() => attempt(async () => take(await pickFiles('.pdf,application/pdf')))} onClear={clear} />
      ) : (
        <FileDrop
          accept=".pdf,application/pdf"
          multiple={false}
          onFiles={take}
          title={loading ? 'Opening…' : 'Choose or drop a PDF to read'}
          hint="Read, search and annotate. Nothing leaves this computer."
          testId="rd-drop"
        />
      )}
      {file && (
        <div class={`rd ${side === 'none' ? 'is-wide' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}>
          <div class="rd-bar" role="toolbar" aria-label="Reading">
            <button
              type="button"
              class="button button-small"
              aria-pressed={side !== 'none'}
              title="Side panel"
              onClick={() => setSettings((s) => ({ ...s, side: s.side === 'none' ? 'pages' : 'none' }))}
            >
              <Icon name="menu" size={15} />
            </button>
            <div class="rd-group">
              <button type="button" class="button button-small" data-testid="rd-prev" aria-label="Previous page" disabled={current <= 1} onClick={() => goTo(current - 1)}>
                <Icon name="up" size={15} />
              </button>
              <input
                type="number"
                class="input input-small rd-page-input"
                min={1}
                max={Math.max(1, count)}
                value={pageDraft ?? String(current)}
                aria-label="Page"
                data-testid="rd-page-input"
                onInput={(e) => setPageDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  goTo(Number(e.currentTarget.value) || 1);
                  setPageDraft(null);
                }}
                onBlur={(e) => {
                  if (pageDraft !== null) goTo(Number(e.currentTarget.value) || current);
                  setPageDraft(null);
                }}
              />
              <span class="tone-muted" data-testid="rd-page-count">
                of {count}
              </span>
              <button type="button" class="button button-small" data-testid="rd-next" aria-label="Next page" disabled={current >= count} onClick={() => goTo(current + 1)}>
                <Icon name="down" size={15} />
              </button>
            </div>
            <div class="rd-group">
              <button type="button" class="button button-small" aria-label="Zoom out" data-testid="rd-zoom-out" onClick={() => zoomStep(false)}>
                −
              </button>
              <select
                class="input input-small"
                aria-label="Zoom"
                data-testid="rd-zoom"
                value={settings.fit === 'custom' ? String(settings.zoom) : settings.fit}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  if (v === 'width' || v === 'page') setSettings((s) => ({ ...s, fit: v }));
                  else setZoom(Number(v));
                }}
              >
                <option value="width">Fit width ({Math.round(fitWidth * 100)}%)</option>
                <option value="page">Whole page ({Math.round(fitPage * 100)}%)</option>
                {[...new Set([...ZOOMS, settings.zoom])]
                  .sort((a, b) => a - b)
                  .map((z) => (
                    <option key={z} value={String(z)}>
                      {Math.round(z * 100)}%
                    </option>
                  ))}
              </select>
              <button type="button" class="button button-small" aria-label="Zoom in" data-testid="rd-zoom-in" onClick={() => zoomStep(true)}>
                +
              </button>
            </div>
            <form
              class="rd-group rd-find"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(false);
              }}
            >
              <input
                ref={searchRef}
                type="search"
                class="input input-small"
                placeholder="Find in the PDF"
                aria-label="Find in the PDF"
                data-testid="rd-search"
                value={query}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    submitSearch(true);
                  }
                }}
              />
              <span class="tone-muted rd-count" data-testid="rd-search-count" aria-live="polite">
                {search ? (search.found.length ? `${hit + 1} of ${search.found.length}${search.done ? '' : '…'}` : search.done ? 'None' : '…') : ''}
              </span>
              <button type="button" class="button button-small" aria-label="Previous match" disabled={!search?.found.length} onClick={() => showHit(hit - 1)}>
                <Icon name="up" size={14} />
              </button>
              <button type="button" class="button button-small" aria-label="Next match" data-testid="rd-search-next" disabled={!search?.found.length} onClick={() => showHit(hit + 1)}>
                <Icon name="down" size={14} />
              </button>
            </form>
            <span class="rd-spacer" />
            <label class="check rd-flatten" title="Draw the annotations into the pages, so they can no longer be changed">
              <input type="checkbox" checked={settings.flatten} data-testid="rd-flatten" onChange={(e) => setSettings((s) => ({ ...s, flatten: e.currentTarget.checked }))} /> Flatten
            </label>
            <button type="button" class="button button-primary button-small" data-testid="rd-save" data-unsaved={unsaved} disabled={!opened} onClick={saveAnnotated}>
              <Icon name="save" size={14} /> Save{unsaved ? ' •' : ''}
            </button>
            <button type="button" class="button button-small" aria-label={fullscreen ? 'Leave full screen' : 'Full screen'} onClick={toggleFullscreen}>
              <Icon name={fullscreen ? 'close' : 'monitor'} size={15} />
            </button>
          </div>
          <div class="rd-bar rd-tools" role="toolbar" aria-label="Annotate">
            <div class="rd-group" role="radiogroup" aria-label="Tool">
              {TOOLS.map((t) => (
                <button
                  key={t.tool}
                  type="button"
                  role="radio"
                  aria-checked={tool === t.tool}
                  class={`rd-tool-button ${tool === t.tool ? 'is-active' : ''}`}
                  title={`${t.label} (${t.key})`}
                  aria-label={t.label}
                  data-testid={`rd-tool-${t.tool}`}
                  onClick={() => chooseTool(t.tool)}
                >
                  <Glyph tool={t.tool} />
                </button>
              ))}
            </div>
            {activeColour && <Swatches value={activeColour} onPick={pickColour} />}
            {(DRAWN as readonly Tool[]).includes(tool) && (
              <label class="rd-inline">
                Line
                <select class="input input-small" value={String(settings.width)} data-testid="rd-width" onChange={(e) => setSettings((s) => ({ ...s, width: Number(e.currentTarget.value) }))}>
                  {[...new Set([...WIDTHS, settings.width])]
                    .sort((a, b) => a - b)
                    .map((w) => (
                      <option key={w} value={w}>
                        {w} pt
                      </option>
                    ))}
                </select>
              </label>
            )}
            {tool === 'text' && (
              <label class="rd-inline">
                Size
                <select class="input input-small" value={String(settings.size)} onChange={(e) => setSettings((s) => ({ ...s, size: Number(e.currentTarget.value) }))}>
                  {[...new Set([...SIZES, settings.size])]
                    .sort((a, b) => a - b)
                    .map((s) => (
                      <option key={s} value={s}>
                        {s} pt
                      </option>
                    ))}
                </select>
              </label>
            )}
            <span class="rd-spacer" />
            <button type="button" class="button button-small" data-testid="rd-undo" disabled={!history.past.length} onClick={undo} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button type="button" class="button button-small" data-testid="rd-redo" disabled={!history.future.length} onClick={redo} title="Redo (Ctrl+Shift+Z)">
              Redo
            </button>
          </div>
          {side !== 'none' && (
            <aside class="rd-side">
              <div class="rd-tabs" role="tablist" aria-label="Side panel">
                {(
                  [
                    ['pages', 'Pages'],
                    ['contents', 'Contents'],
                    ['comments', `Comments (${annotations.length})`],
                    ['search', 'Search'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={side === value}
                    class={side === value ? 'is-active' : ''}
                    data-testid={`rd-side-${value}`}
                    onClick={() => setSettings((s) => ({ ...s, side: value }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div class="rd-side-body">
                {side === 'pages' && (
                  <div class="rd-thumbs" data-testid="rd-thumbs">
                    {Array.from({ length: count }, (_, i) => (
                      <button key={i} type="button" class={current === i + 1 ? 'is-active' : ''} onClick={() => goTo(i + 1)} aria-label={`Page ${i + 1}`}>
                        {thumbs[i] ? <img src={thumbs[i]} alt="" /> : <span class="rd-thumb-blank" style={{ aspectRatio: `${sizes[i]?.width ?? 1} / ${sizes[i]?.height ?? 1}` }} />}
                        <span>{i + 1}</span>
                      </button>
                    ))}
                  </div>
                )}
                {side === 'contents' && (
                  <div class="rd-outline" data-testid="rd-outline">
                    {opened?.outline.length ? (
                      <Outline items={opened.outline} go={(p) => goTo(p)} />
                    ) : (
                      <p class="tone-muted">This PDF has no table of contents. PDF Toolbox → Bookmarks can add one.</p>
                    )}
                  </div>
                )}
                {side === 'comments' && (
                  <div class="rd-comments" data-testid="rd-comments">
                    <label>
                      Your name on new comments
                      <input
                        type="text"
                        class="input input-small"
                        data-testid="rd-author"
                        value={settings.author}
                        maxLength={80}
                        onInput={(e) => setSettings((s) => ({ ...s, author: e.currentTarget.value }))}
                      />
                    </label>
                    {sorted.length ? (
                      <ul>
                        {sorted.map((a) => {
                          const words = a.kind === 'text' ? a.text : a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strike' ? a.text : '';
                          return (
                            <li key={a.id}>
                              <button
                                type="button"
                                class={`rd-comment-item ${selected === a.id ? 'is-active' : ''}`}
                                data-testid={`rd-comment-${a.kind}`}
                                onClick={() => {
                                  setTool('select');
                                  setSelected(a.id);
                                  goTo(a.page, boundsOf(a));
                                }}
                              >
                                <span class="rd-dot" style={{ background: a.color }} />
                                <span class="rd-comment-text">
                                  <strong>{KIND_LABELS[a.kind]}</strong> <span class="tone-muted">p. {a.page}</span>
                                  {words && <span class="rd-quote">{words}</span>}
                                  {a.comment && a.comment !== words && <span>{a.comment}</span>}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p class="tone-muted">No annotations yet. Pick a tool above, or select text and choose Highlight.</p>
                    )}
                    <button type="button" class="button button-small" disabled={!annotations.length} data-testid="rd-markdown" onClick={saveComments}>
                      Save comments as Markdown
                    </button>
                  </div>
                )}
                {side === 'search' && (
                  <div class="rd-results" data-testid="rd-results">
                    <label class="check">
                      <input
                        type="checkbox"
                        checked={matchCase}
                        onChange={(e) => {
                          setMatchCase(e.currentTarget.checked);
                          if (query.trim()) void runSearch(query, e.currentTarget.checked, wholeWord);
                        }}
                      />{' '}
                      Match case
                    </label>
                    <label class="check">
                      <input
                        type="checkbox"
                        checked={wholeWord}
                        onChange={(e) => {
                          setWholeWord(e.currentTarget.checked);
                          if (query.trim()) void runSearch(query, matchCase, e.currentTarget.checked);
                        }}
                      />{' '}
                      Whole words
                    </label>
                    {search && (
                      <>
                        <p class="tone-muted">
                          {search.found.length} match{search.found.length === 1 ? '' : 'es'} for “{search.query}”{search.done ? '' : ` (searched ${search.searched} of ${count} pages)`}
                        </p>
                        {search.found.length > 0 && (
                          <button type="button" class="button button-small" data-testid="rd-highlight-all" onClick={highlightAll}>
                            Highlight all {search.found.length}
                          </button>
                        )}
                        <ol>
                          {search.found.slice(0, 500).map((f, i) => (
                            <li key={i}>
                              <button type="button" class={`rd-result ${i === hit ? 'is-active' : ''}`} onClick={() => showHit(i)}>
                                <span class="tone-muted">p. {f.page}</span> …{f.before}
                                <mark>{f.text}</mark>
                                {f.after}…
                              </button>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                    {!search && <p class="tone-muted">Type in the box above and press Enter. Ctrl+F jumps there.</p>}
                  </div>
                )}
              </div>
            </aside>
          )}
          <div
            class="rd-view"
            ref={viewRef}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the pages take keys like any editor (V, H, U, S, N, T, P, R, E, L, A pick tools; Ctrl+Z undoes)
            tabIndex={0}
            role="application"
            aria-label={`Pages of ${file.name}`}
            data-testid="rd-view"
            data-tool={tool}
            data-page={current}
            data-zoom={Math.round(zoom * 100)}
            data-text-ready={textReady}
            onScroll={updateRange}
            onKeyDown={onKey}
            onWheel={onWheel}
          >
            {opened ? (
              <div class="rd-pages" style={{ minHeight: `${layout.height}px`, paddingTop: `${PAD}px`, paddingBottom: `${PAD}px` }}>
                {Array.from({ length: count }, (_, i) => renderPage(i + 1))}
              </div>
            ) : (
              <p class="tone-muted rd-wait">Opening…</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Swatches({ value, onPick }: { value: string; onPick: (colour: string) => void }) {
  return (
    <div class="rd-swatches" role="radiogroup" aria-label="Colour">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={COLOUR_NAMES[c] ?? c}
          title={COLOUR_NAMES[c] ?? c}
          class="rd-swatch"
          style={{ background: c }}
          data-testid={`rd-colour-${c.slice(1)}`}
          onClick={() => onPick(c)}
        />
      ))}
      <input type="color" class="rd-colour-input" aria-label="Other colour" value={value} onChange={(e) => onPick(e.currentTarget.value)} />
    </div>
  );
}

function DraftShape({ draft, colour, width }: { draft: Draft; colour: string; width: number }) {
  if (draft.boxes)
    return (
      <g class={draft.area ? 'rd-draft-area' : 'rd-selection'}>
        {draft.boxes.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} />
        ))}
      </g>
    );
  if (draft.points) return <polyline points={draft.points.map((p) => `${p[0]},${p[1]}`).join(' ')} class="rd-stroke" style={{ stroke: colour, strokeWidth: width }} />;
  if (draft.box) {
    const b = draft.box;
    return draft.ellipse ? (
      <ellipse cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} class="rd-draft" style={{ stroke: colour, strokeWidth: width }} />
    ) : (
      <rect x={b.x} y={b.y} width={b.w} height={b.h} class="rd-draft" style={{ stroke: colour, strokeWidth: width }} />
    );
  }
  if (draft.from && draft.to) {
    const head = draft.arrow ? arrowHead(draft.from, draft.to, width) : null;
    return (
      <g>
        <line x1={draft.from[0]} y1={draft.from[1]} x2={draft.to[0]} y2={draft.to[1]} class="rd-stroke" style={{ stroke: colour, strokeWidth: width }} />
        {head && <polyline points={`${head[0][0]},${head[0][1]} ${draft.to[0]},${draft.to[1]} ${head[1][0]},${head[1][1]}`} class="rd-stroke" style={{ stroke: colour, strokeWidth: width }} />}
      </g>
    );
  }
  return null;
}

/** The far corner of a square from `from` towards `p`. */
function square(from: Point, p: Point): Point {
  const side = Math.max(Math.abs(p[0] - from[0]), Math.abs(p[1] - from[1]));
  return [from[0] + Math.sign(p[0] - from[0] || 1) * side, from[1] + Math.sign(p[1] - from[1] || 1) * side];
}

/** `p` moved onto the nearest 45° direction from `from`. */
function snap(from: Point, p: Point): Point {
  const dx = p[0] - from[0];
  const dy = p[1] - from[1];
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return [from[0] + Math.cos(angle) * length, from[1] + Math.sin(angle) * length];
}

function floatAt(box: Box | undefined, zoom: number, size: { width: number; height: number }) {
  const b = box ?? { x: 0, y: 0, w: 0, h: 0 };
  const top = b.y * zoom - 40;
  return { left: `${clamp(b.x * zoom, 4, Math.max(4, size.width * zoom - 330))}px`, top: `${top < 4 ? (b.y + b.h) * zoom + 6 : top}px` };
}

function popoverAt(b: Box, zoom: number, size: { width: number; height: number }) {
  const width = 260;
  const left = clamp(b.x * zoom, 4, Math.max(4, size.width * zoom - width - 4));
  const below = (b.y + b.h) * zoom + 8;
  const fitsBelow = below + 230 < size.height * zoom;
  return { left: `${left}px`, width: `${width}px`, ...(fitsBelow ? { top: `${below}px` } : { bottom: `${size.height * zoom - b.y * zoom + 8}px` }) };
}

export default defineCustomTool(PdfReader);
