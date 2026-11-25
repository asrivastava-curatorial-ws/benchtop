/**
 * The sketch and mind-map editor of note blocks: boxes, bubbles, diamonds,
 * clouds, sticky notes and text; arrows and lines that stick to the shapes they
 * join; a pen and an eraser; hand-drawn or clean lines; and mind-map keys —
 * Tab adds a branch, Enter a sibling, Tidy lays the map out.  Loaded the first
 * time a note shows a sketch.
 */
import type { ComponentChildren, JSX, SVGAttributes, TargetedKeyboardEvent, TargetedMouseEvent, TargetedPointerEvent, TargetedWheelEvent } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { safeName } from '../../lib/notes-format';
import { canvasMeasure, loadSketchFonts, sketchFontCss } from '../../lib/sketch-fonts';
import {
  addChild,
  addSibling,
  type Box,
  centerOf,
  clampHeight,
  type Dash,
  defaultSize,
  descendantsOf,
  duplicateItems,
  type End,
  edgeGeometry,
  FILLS,
  type FillStyle,
  fitNode,
  flowchartStarter,
  type Head,
  hitTest,
  INK,
  indexNodes,
  innerBox,
  isEmptyScene,
  isMapNode,
  itemBox,
  itemsInside,
  lineHeight,
  type Measure,
  makeEdge,
  makeNode,
  mindMapRoot,
  moveItems,
  neighbour,
  newSeed,
  nodeAt,
  type Point,
  type Route,
  removeItems,
  type Scene,
  SHAPE_LABEL,
  SHAPES,
  type Shape,
  type SketchEdge,
  type SketchNode,
  STROKES,
  type StrokePoint,
  sceneBounds,
  tidy,
  uid,
  updateEdge,
  updateNode,
  withDescendants,
  wrapText,
} from '../../lib/sketch-model';
import { fontFamily, labelText, outlinePath, PAPER, type RenderItem, renderScene, sceneSvg, type TextRun } from '../../lib/sketch-render';
import { saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { pngBytes } from './_draw';

type Tool = 'select' | 'hand' | 'rect' | 'ellipse' | 'diamond' | 'cloud' | 'sticky' | 'text' | 'arrow' | 'line' | 'pen' | 'eraser';
type Handle = 'nw' | 'ne' | 'sw' | 'se';

interface View {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

interface Style {
  readonly stroke: string;
  readonly fill: string;
  readonly fillStyle: FillStyle;
  readonly width: number;
  readonly dash: Dash;
  readonly font: number;
  readonly head: Head;
  readonly route: Route;
}

/** The last style picked, for the next sketch too. */
let lastStyle: Style = { stroke: INK, fill: 'none', fillStyle: 'hachure', width: 2, dash: 'solid', font: 20, head: 'end', route: 'straight' };

interface Editing {
  readonly kind: 'node' | 'edge';
  readonly id: string;
  /** The scene to go back to on undo. */
  readonly before: Scene;
  /** Made for this edit, so it goes again when left empty. */
  readonly fresh: boolean;
  readonly selectAll: boolean;
}

type Drag =
  | { readonly kind: 'pan'; readonly cx: number; readonly cy: number; readonly view: View }
  | { readonly kind: 'move'; readonly start: Point; readonly orig: Scene; readonly ids: ReadonlySet<string>; moved: boolean }
  | { readonly kind: 'resize'; readonly id: string; readonly handle: Handle; readonly orig: Scene; readonly box: Box }
  | { readonly kind: 'end'; readonly id: string; readonly which: 'from' | 'to'; readonly orig: Scene }
  | { readonly kind: 'marquee'; readonly start: Point; readonly keep: ReadonlySet<string> }
  | { readonly kind: 'create'; readonly shape: Shape; readonly start: Point; readonly orig: Scene; readonly id: string; readonly seed: number }
  | { readonly kind: 'edge'; readonly orig: Scene; readonly id: string; readonly from: End; readonly head: Head; readonly seed: number }
  | { readonly kind: 'pen'; readonly orig: Scene; readonly id: string; readonly points: StrokePoint[] }
  | { readonly kind: 'erase'; readonly orig: Scene; readonly removed: Set<string>; last: Point };

const SHAPE_TOOLS: Partial<Record<Tool, Shape>> = { rect: 'rect', ellipse: 'ellipse', diamond: 'diamond', cloud: 'cloud', sticky: 'sticky', text: 'text' };
const TOOL_KEYS: Readonly<Record<string, Tool>> = { v: 'select', h: 'hand', r: 'rect', o: 'ellipse', d: 'diamond', c: 'cloud', s: 'sticky', t: 'text', a: 'arrow', l: 'line', p: 'pen', e: 'eraser' };

const glyph = (children: ComponentChildren, width = 16, shown = width) => (
  <svg viewBox={`0 0 ${width} 16`} width={shown} height={(16 * shown) / width} fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const TOOLS: readonly { readonly id: Tool; readonly label: string; readonly key: string; readonly icon: JSX.Element }[] = [
  { id: 'select', label: 'Select and move', key: 'V', icon: glyph(<path d="M3.5 2.5l9 5.2-4 1.1 2.4 4.4-1.6.9-2.4-4.4-3.4 2.9z" />) },
  {
    id: 'hand',
    label: 'Pan (or hold Space)',
    key: 'H',
    icon: glyph(<path d="M8 1.8v12.4M1.8 8h12.4M8 1.8 6.3 3.5M8 1.8l1.7 1.7M8 14.2l-1.7-1.7M8 14.2l1.7-1.7M1.8 8l1.7-1.7M1.8 8l1.7 1.7M14.2 8l-1.7-1.7M14.2 8l-1.7 1.7" />),
  },
  { id: 'rect', label: 'Box', key: 'R', icon: glyph(<rect x="2.5" y="3.5" width="11" height="9" rx="0.6" />) },
  { id: 'ellipse', label: 'Bubble', key: 'O', icon: glyph(<ellipse cx="8" cy="8" rx="6" ry="4.6" />) },
  { id: 'diamond', label: 'Diamond', key: 'D', icon: glyph(<path d="M8 2.2 13.8 8 8 13.8 2.2 8z" />) },
  { id: 'cloud', label: 'Cloud', key: 'C', icon: glyph(<path d="M4.6 12.5a2.7 2.7 0 0 1-.3-5.4 3.7 3.7 0 0 1 7.1-1.2 3.3 3.3 0 0 1 .6 6.6z" />) },
  {
    id: 'sticky',
    label: 'Sticky note',
    key: 'S',
    icon: glyph(
      <>
        <path d="M2.5 2.5h11v7.5l-3.5 3.5h-7.5z" />
        <path d="M13.5 10h-3.5v3.5" />
      </>,
    ),
  },
  { id: 'text', label: 'Text', key: 'T', icon: glyph(<path d="M3 3.5h10M8 3.5v9.5M6.2 13h3.6" />) },
  { id: 'arrow', label: 'Arrow (drag from shape to shape)', key: 'A', icon: glyph(<path d="M2.8 13.2 13 3M7.5 3H13v5.5" />) },
  { id: 'line', label: 'Line', key: 'L', icon: glyph(<path d="M2.8 13.2 13.2 2.8" />) },
  { id: 'pen', label: 'Pen', key: 'P', icon: glyph(<path d="M10.8 2.7a1.5 1.5 0 0 1 2.1 2.1L5.5 12.2l-2.9.8.8-2.9z" />) },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: glyph(<path d="M6.2 13.5h7.3M3 10.3l6.6-6.6a1.2 1.2 0 0 1 1.7 0l2.2 2.2a1.2 1.2 0 0 1 0 1.7L8 13.5H6.2z" />) },
];

const round1 = (v: number) => Math.round(v * 10) / 10;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const penSize = (width: number) => (width <= 1 ? 3 : width <= 2 ? 5 : 9);
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

function boxBetween(a: Point, b: Point, square: boolean): Box {
  let w = b.x - a.x;
  let h = b.y - a.y;
  if (square) {
    const side = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * side;
    h = Math.sign(h || 1) * side;
  }
  return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h) };
}

function grow(b: Box, by: number): Box {
  return { x: b.x - by, y: b.y - by, w: b.w + 2 * by, h: b.h + 2 * by };
}

function handleAt(b: Box, p: Point, zoom: number): Handle | null {
  const r = 7 / zoom;
  const spots: [Handle, number, number][] = [
    ['nw', b.x, b.y],
    ['ne', b.x + b.w, b.y],
    ['sw', b.x, b.y + b.h],
    ['se', b.x + b.w, b.y + b.h],
  ];
  for (const [handle, x, y] of spots) if (Math.abs(p.x - x) <= r && Math.abs(p.y - y) <= r) return handle;
  return null;
}

function resized(b: Box, handle: Handle, p: Point): Box {
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  if (handle === 'nw' || handle === 'sw') x0 = Math.min(p.x, x1 - 12);
  else x1 = Math.max(p.x, x0 + 12);
  if (handle === 'nw' || handle === 'ne') y0 = Math.min(p.y, y1 - 12);
  else y1 = Math.max(p.y, y0 + 12);
  return { x: round1(x0), y: round1(y0), w: round1(x1 - x0), h: round1(y1 - y0) };
}

async function svgToPng(svg: string, scale = 2): Promise<Uint8Array> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The sketch could not be turned into a picture.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  await image.decode().catch(() => undefined);
  const w = image.naturalWidth || 300;
  const h = image.naturalHeight || 150;
  const factor = Math.min(scale, 8192 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * factor));
  canvas.height = Math.max(1, Math.round(h * factor));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The sketch could not be turned into a picture.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return pngBytes(canvas);
}

/* -------------------------------------------------------------- drawing -- */

function TextView({ text, hand }: { text: TextRun; hand: boolean }) {
  const b = text.backing;
  return (
    <>
      {b && <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill={PAPER} stroke="none" />}
      <text font-family={fontFamily(hand)} font-size={text.font} fill={text.color} stroke="none" text-anchor="middle" style={{ whiteSpace: 'pre' }}>
        {text.lines.map((line, i) => (
          <tspan key={i} x={text.x} y={text.ys[i]}>
            {line}
          </tspan>
        ))}
      </text>
    </>
  );
}

function ItemView({ item, hand, hideText }: { item: RenderItem; hand: boolean; hideText: boolean }) {
  return (
    <g transform={item.x || item.y ? `translate(${item.x} ${item.y})` : undefined} data-kind={item.kind} data-id={item.id}>
      {item.pieces.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} stroke-width={p.width} fill={p.fill} stroke-dasharray={p.dash} opacity={p.opacity} />
      ))}
      {item.text && !hideText && <TextView text={item.text} hand={hand} />}
    </g>
  );
}

/* --------------------------------------------------------------- panel -- */

function Row({ label, children, test }: { label: string; children: ComponentChildren; test?: string }) {
  return (
    <div class="sk-row" data-testid={test}>
      <span class="sk-row-label">{label}</span>
      <span class="sk-row-body">{children}</span>
    </div>
  );
}

function Swatches({ label, colors, value, onPick }: { label: string; colors: readonly string[]; value: string; onPick: (c: string) => void }) {
  return (
    <span class="sk-swatches" role="radiogroup" aria-label={label}>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          class={`sk-swatch${value === c ? ' is-on' : ''}${c === 'none' ? ' is-none' : ''}`}
          style={c === 'none' ? undefined : { background: c }}
          title={c === 'none' ? 'No fill' : c}
          aria-label={c === 'none' ? 'No fill' : c}
          onClick={() => onPick(c)}
        />
      ))}
    </span>
  );
}

function Options<T extends string | number>({ label, options, value, onPick }: { label: string; options: readonly (readonly [T, ComponentChildren, string])[]; value: T; onPick: (v: T) => void }) {
  return (
    <span class="sk-choices" role="radiogroup" aria-label={label}>
      {options.map(([v, face, name]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} class={`sk-choice${value === v ? ' is-on' : ''}`} title={name} aria-label={name} onClick={() => onPick(v)}>
          {face}
        </button>
      ))}
    </span>
  );
}

/** Whether the style panel is open, kept for every sketch. */
let panelOpen = true;

const line = (d: string, extra: SVGAttributes<SVGPathElement> = {}) => glyph(<path d={d} {...extra} />, 24, 20);

/* -------------------------------------------------------------- editor -- */

export interface SketchEditorProps {
  readonly scene: Scene;
  readonly update: (scene: Scene) => void;
  /** The block has focus: tools, the style panel and touch drawing are on. */
  readonly active: boolean;
  /** Names exported pictures. */
  readonly name: string;
}

export function SketchEditor({ scene: saved, update, active, name }: SketchEditorProps) {
  const [live, setLiveState] = useState<Scene | null>(null);
  const liveRef = useRef<Scene | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const scene = live ?? saved;
  const setLive = (next: Scene | null) => {
    liveRef.current = next;
    setLiveState(next);
  };
  const current = () => liveRef.current ?? savedRef.current;

  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [editing, setEditingState] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  const setEditing = (next: Editing | null) => {
    editingRef.current = next;
    setEditingState(next);
  };
  const [style, setStyle] = useState<Style>(lastStyle);
  const [measure, setMeasure] = useState<Measure>(() => canvasMeasure());
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [width, setWidth] = useState(640);
  const [open, setOpen] = useState(panelOpen);
  const showStyles = (show: boolean) => {
    panelOpen = show;
    setOpen(show);
  };
  const history = useRef<{ past: Scene[]; future: Scene[] }>({ past: [], future: [] });
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const stage = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fitted = useRef(false);
  const gridId = useMemo(() => `sk-grid-${uid()}`, []);

  useEffect(() => {
    let alive = true;
    void loadSketchFonts().then(() => {
      if (alive) setMeasure(() => canvasMeasure());
    });
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || 640));
    observer.observe(el);
    setWidth(el.clientWidth || 640);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        space.current = false;
        setPanning(false);
      }
    };
    const blur = () => {
      space.current = false;
      setPanning(false);
    };
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => {
      removeEventListener('keyup', up);
      removeEventListener('blur', blur);
    };
  }, []);

  const items = useMemo(() => renderScene(scene, measure), [scene, measure]);
  const nodeIndex = useMemo(() => indexNodes(scene), [scene]);
  const known = useMemo(() => new Set([...scene.nodes, ...scene.edges, ...scene.strokes].map((x) => x.id)), [scene]);
  const selected = useMemo(() => new Set([...selection].filter((id) => known.has(id))), [selection, known]);
  const single = selected.size === 1 ? [...selected][0] : undefined;
  const singleNode = single !== undefined ? nodeIndex.get(single) : undefined;
  const singleEdge = single !== undefined ? scene.edges.find((e) => e.id === single) : undefined;
  const hasMap = scene.nodes.some((n) => n.parent !== undefined);

  // A sketch that does not fit opens zoomed to show all of it.
  useEffect(() => {
    if (fitted.current || width < 50) return;
    fitted.current = true;
    const b = sceneBounds(saved);
    if (b && (b.x < 0 || b.y < 0 || b.x + b.w > width || b.y + b.h > saved.height)) fitView(saved);
  });

  const toScene = (e: { clientX: number; clientY: number }): Point => {
    const r = svg.current?.getBoundingClientRect();
    return { x: (e.clientX - (r?.left ?? 0)) / view.zoom + view.x, y: (e.clientY - (r?.top ?? 0)) / view.zoom + view.y };
  };

  const commit = (next: Scene, before: Scene) => {
    setLive(null);
    if (next === before) return;
    const h = history.current;
    h.past.push(before);
    if (h.past.length > 200) h.past.shift();
    h.future = [];
    savedRef.current = next;
    update(next);
  };

  const undo = () => {
    if (editingRef.current) finishEditing();
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(current());
    setLive(null);
    savedRef.current = prev;
    update(prev);
  };

  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(current());
    setLive(null);
    savedRef.current = next;
    update(next);
  };

  function fitView(s: Scene = current()) {
    const b = sceneBounds(s);
    if (!b) {
      setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const zoom = clamp(Math.min((width - 48) / Math.max(b.w, 1), (s.height - 48) / Math.max(b.h, 1), 1), MIN_ZOOM, MAX_ZOOM);
    setView({ zoom, x: b.x + b.w / 2 - width / 2 / zoom, y: b.y + b.h / 2 - s.height / 2 / zoom });
  }

  const zoomTo = (zoom: number, at: Point = { x: view.x + width / 2 / view.zoom, y: view.y + scene.height / 2 / view.zoom }) => {
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    setView({ zoom: z, x: at.x - ((at.x - view.x) * view.zoom) / z, y: at.y - ((at.y - view.y) * view.zoom) / z });
  };

  const centre = (): Point => ({ x: view.x + width / 2 / view.zoom, y: view.y + scene.height / 2 / view.zoom });

  const focusStage = () => stage.current?.focus({ preventScroll: true });

  /* ------------------------------------------------------------ text -- */

  const beginEdit = (next: Editing, withScene?: Scene) => {
    if (withScene) setLive(withScene);
    setEditing(next);
    setSelection(new Set([next.id]));
  };

  const finishEditing = (then?: 'child' | 'sibling') => {
    const ed = editingRef.current;
    if (!ed) return;
    setEditing(null);
    let next = current();
    let keep: string | null = ed.id;
    if (ed.kind === 'node') {
      const n = next.nodes.find((x) => x.id === ed.id);
      if (n && !n.text.trim() && ed.fresh) {
        next = ed.before;
        keep = null;
      } else if (n && !n.text.trim() && n.shape === 'text') {
        next = removeItems(next, new Set([n.id]));
        keep = null;
      } else if (n && isMapNode(next, n.id)) next = tidy(next, [n.id]);
    }
    commit(next, ed.before);
    setSelection(keep ? new Set([keep]) : new Set());
    focusStage();
    if (then && keep && ed.kind === 'node') addTopic(then, keep, next);
  };

  const changeText = (value: string) => {
    const ed = editingRef.current;
    if (!ed) return;
    const base = current();
    if (ed.kind === 'edge') setLive(updateEdge(base, ed.id, { label: value }));
    else setLive({ ...base, nodes: base.nodes.map((n) => (n.id === ed.id ? fitNode({ ...n, text: value }, base.hand, measure) : n)) });
  };

  const addTopic = (kind: 'child' | 'sibling', id: string, base: Scene) => {
    const made = kind === 'child' ? addChildTopic(base, id) : addSiblingTopic(base, id);
    if (!made) return;
    beginEdit({ kind: 'node', id: made.id, before: base, fresh: true, selectAll: false }, made.scene);
  };

  const addChildTopic = (base: Scene, id: string) => {
    const made = addChild(base, id, measure);
    return made.id ? made : null;
  };
  const addSiblingTopic = (base: Scene, id: string) => {
    const made = addSibling(base, id, measure);
    return made.id ? made : null;
  };

  useLayoutEffect(() => {
    const el = textarea.current;
    if (!editing || !el) return;
    el.focus({ preventScroll: true });
    if (editing.selectAll) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  /* ------------------------------------------------------- pointer -- */

  const start = (d: Drag, e: { currentTarget: EventTarget | null; pointerId: number }) => {
    drag.current = d;
    (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
  };

  const onPointerDown = (e: TargetedPointerEvent<SVGSVGElement>) => {
    if (editingRef.current) finishEditing();
    focusStage();
    if (e.button === 1 || tool === 'hand' || space.current) {
      e.preventDefault();
      setPanning(true);
      start({ kind: 'pan', cx: e.clientX, cy: e.clientY, view }, e);
      return;
    }
    if (e.button !== 0) return;
    const p = toScene(e);
    const base = current();
    const tolerance = 6 / view.zoom;
    const shape = SHAPE_TOOLS[tool];
    if (shape) {
      start({ kind: 'create', shape, start: p, orig: base, id: uid(), seed: newSeed() }, e);
      return;
    }
    if (tool === 'arrow' || tool === 'line') {
      const at = nodeAt(base, p, 2);
      const from: End = at ? { node: at.id, ...centerOf(at) } : { x: round1(p.x), y: round1(p.y) };
      start({ kind: 'edge', orig: base, id: uid(), from, head: tool === 'line' ? 'none' : style.head === 'none' ? 'end' : style.head, seed: newSeed() }, e);
      return;
    }
    if (tool === 'pen') {
      const id = uid();
      const points: StrokePoint[] = [[round1(p.x), round1(p.y), e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5]];
      start({ kind: 'pen', orig: base, id, points }, e);
      setLive({ ...base, strokes: [...base.strokes, { id, points: [...points], color: style.stroke, size: penSize(style.width) }] });
      return;
    }
    if (tool === 'eraser') {
      const d: Drag = { kind: 'erase', orig: base, removed: new Set(), last: p };
      start(d, e);
      eraseTo(d, p);
      return;
    }
    // Select: a handle of the one selected shape, an end of the one selected connector, an item, or empty paper.
    if (singleNode) {
      const handle = handleAt(grow(singleNode, 4 / view.zoom), p, view.zoom);
      if (handle) {
        start({ kind: 'resize', id: singleNode.id, handle, orig: base, box: singleNode }, e);
        return;
      }
    }
    if (singleEdge) {
      const g = edgeGeometry(singleEdge, indexNodes(base));
      const first = g.points[0];
      const last = g.points[g.points.length - 1];
      if (last && dist(p, last) <= 9 / view.zoom) {
        start({ kind: 'end', id: singleEdge.id, which: 'to', orig: base }, e);
        return;
      }
      if (first && dist(p, first) <= 9 / view.zoom) {
        start({ kind: 'end', id: singleEdge.id, which: 'from', orig: base }, e);
        return;
      }
    }
    const hit = hitTest(base, p, tolerance);
    if (hit) {
      if (e.shiftKey) {
        const next = new Set(selected);
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        setSelection(next);
        return;
      }
      const ids = selected.has(hit.id) ? selected : new Set([hit.id]);
      setSelection(ids);
      start({ kind: 'move', start: p, orig: base, ids: withDescendants(base, ids), moved: false }, e);
      return;
    }
    const keep = e.shiftKey ? selected : new Set<string>();
    setSelection(keep);
    start({ kind: 'marquee', start: p, keep }, e);
  };

  const eraseTo = (d: Extract<Drag, { kind: 'erase' }>, p: Point) => {
    const step = 4 / view.zoom;
    const steps = Math.max(1, Math.ceil(dist(d.last, p) / step));
    let rest = removeItems(d.orig, d.removed);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const q = { x: d.last.x + (p.x - d.last.x) * t, y: d.last.y + (p.y - d.last.y) * t };
      const hit = hitTest(rest, q, 4 / view.zoom);
      if (hit && !d.removed.has(hit.id)) {
        d.removed.add(hit.id);
        rest = removeItems(d.orig, d.removed);
      }
    }
    d.last = p;
    setLive(d.removed.size ? rest : null);
  };

  const onPointerMove = (e: TargetedPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toScene(e);
    switch (d.kind) {
      case 'pan':
        setView({ ...d.view, x: d.view.x - (e.clientX - d.cx) / d.view.zoom, y: d.view.y - (e.clientY - d.cy) / d.view.zoom });
        break;
      case 'move': {
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) * view.zoom < 3) return;
        d.moved = true;
        setLive(moveItems(d.orig, d.ids, round1(dx), round1(dy)));
        break;
      }
      case 'resize':
        setLive(updateNode(d.orig, d.id, { ...resized(d.box, d.handle, p), auto: false }));
        break;
      case 'end': {
        const edge = d.orig.edges.find((x) => x.id === d.id);
        if (!edge) return;
        const other = d.which === 'to' ? edge.from.node : edge.to.node;
        const at = nodeAt(d.orig, p, 2, other);
        setTarget(at?.id ?? null);
        const end: End = at ? { node: at.id, ...centerOf(at) } : { x: round1(p.x), y: round1(p.y) };
        setLive(updateEdge(d.orig, d.id, d.which === 'to' ? { to: end } : { from: end }));
        break;
      }
      case 'marquee': {
        const box = boxBetween(d.start, p, false);
        setMarquee(box);
        setSelection(new Set([...d.keep, ...itemsInside(current(), box)]));
        break;
      }
      case 'create': {
        if (d.shape === 'text') return;
        const box = boxBetween(d.start, p, e.shiftKey);
        setLive({ ...d.orig, nodes: [...d.orig.nodes, { ...makeNode(d.shape, box, style, d.id), seed: d.seed }] });
        break;
      }
      case 'edge': {
        const at = nodeAt(d.orig, p, 2, d.from.node);
        setTarget(at?.id ?? null);
        const to: End = at ? { node: at.id, ...centerOf(at) } : { x: round1(p.x), y: round1(p.y) };
        const edge = { ...makeEdge(d.from, to, { ...style, head: d.head }, d.id), seed: d.seed };
        setLive({ ...d.orig, edges: [...d.orig.edges, edge] });
        break;
      }
      case 'pen': {
        const events = e.getCoalescedEvents?.() ?? [];
        for (const ev of events.length ? events : [e]) {
          const q = toScene(ev);
          const last = d.points[d.points.length - 1];
          if (last && Math.hypot(q.x - last[0], q.y - last[1]) * view.zoom < 1) continue;
          d.points.push([round1(q.x), round1(q.y), ev.pointerType === 'pen' && ev.pressure > 0 ? Math.round(ev.pressure * 100) / 100 : 0.5]);
        }
        setLive({ ...d.orig, strokes: [...d.orig.strokes, { id: d.id, points: [...d.points], color: style.stroke, size: penSize(style.width) }] });
        break;
      }
      case 'erase':
        eraseTo(d, p);
        break;
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setTarget(null);
    setMarquee(null);
    setPanning(space.current);
    if (!d) return;
    const next = liveRef.current;
    switch (d.kind) {
      case 'move': {
        if (!d.moved || !next) {
          setLive(null);
          return;
        }
        const maps = [...d.ids].filter((id) => isMapNode(next, id));
        commit(maps.length ? tidy(next, maps) : next, d.orig);
        return;
      }
      case 'resize':
        if (next) commit(isMapNode(next, d.id) ? tidy(next, [d.id]) : next, d.orig);
        return;
      case 'end':
        if (next) commit(next, d.orig);
        return;
      case 'create': {
        let node = next?.nodes.find((n) => n.id === d.id);
        if (!node || (node.w < 10 && node.h < 10)) {
          const size = defaultSize(d.shape);
          node = { ...makeNode(d.shape, { x: d.start.x - size.w / 2, y: d.start.y - size.h / 2, ...size }, style, d.id), seed: d.seed };
        }
        const made = { ...d.orig, nodes: [...d.orig.nodes, node] };
        setTool('select');
        if (d.shape === 'text') beginEdit({ kind: 'node', id: node.id, before: d.orig, fresh: true, selectAll: false }, made);
        else {
          commit(made, d.orig);
          setSelection(new Set([node.id]));
        }
        return;
      }
      case 'edge': {
        const edge = next?.edges.find((x) => x.id === d.id);
        if (!next || !edge) {
          setLive(null);
          return;
        }
        const g = edgeGeometry(edge, indexNodes(next));
        const first = g.points[0];
        const last = g.points[g.points.length - 1];
        const joined = edge.from.node !== undefined && edge.to.node !== undefined;
        if (!joined && (!first || !last || dist(first, last) < 12)) {
          setLive(null);
          return;
        }
        commit(next, d.orig);
        setSelection(new Set([d.id]));
        setTool('select');
        return;
      }
      case 'pen':
        if (next) commit(next, d.orig);
        return;
      case 'erase':
        if (next && d.removed.size) commit(next, d.orig);
        else setLive(null);
        return;
      default:
        return;
    }
  };

  const onDoubleClick = (e: TargetedMouseEvent<SVGSVGElement>) => {
    if (tool !== 'select') return;
    const base = current();
    const p = toScene(e);
    const hit = hitTest(base, p, 6 / view.zoom);
    if (hit?.kind === 'node' || hit?.kind === 'edge') {
      beginEdit({ kind: hit.kind, id: hit.id, before: base, fresh: false, selectAll: false });
      return;
    }
    if (hit) return;
    const size = defaultSize('text');
    const node = makeNode('text', { x: p.x - size.w / 2, y: p.y - size.h / 2, ...size }, style);
    beginEdit({ kind: 'node', id: node.id, before: base, fresh: true, selectAll: false }, { ...base, nodes: [...base.nodes, node] });
  };

  const onWheel = (e: TargetedWheelEvent<SVGSVGElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomTo(view.zoom * Math.exp(-e.deltaY * 0.0025), toScene(e));
  };

  /* ---------------------------------------------------------- actions -- */

  const removeSelected = () => {
    if (!selected.size) return;
    const base = current();
    commit(removeItems(base, selected), base);
    setSelection(new Set());
  };

  const duplicate = () => {
    if (!selected.size) return;
    const base = current();
    const copy = duplicateItems(base, selected);
    commit(copy.scene, base);
    setSelection(copy.ids);
  };

  const restack = (front: boolean) => {
    const base = current();
    const pick = <T extends { id: string }>(list: readonly T[]) => {
      const chosen = list.filter((x) => selected.has(x.id));
      const others = list.filter((x) => !selected.has(x.id));
      return front ? [...others, ...chosen] : [...chosen, ...others];
    };
    commit({ ...base, nodes: pick(base.nodes), edges: pick(base.edges), strokes: pick(base.strokes) }, base);
  };

  const tidyMaps = () => {
    const base = current();
    const ids = [...selected].filter((id) => isMapNode(base, id));
    commit(tidy(base, ids.length ? ids : undefined), base);
  };

  const detach = (id: string) => {
    const base = current();
    const n = base.nodes.find((x) => x.id === id);
    if (n?.parent === undefined) return;
    const { parent, ...rest } = n;
    const next = { ...base, nodes: base.nodes.map((x) => (x.id === id ? rest : x)) };
    commit(tidy(next, [parent, id]), base);
  };

  const refit = (s: Scene): Scene => tidy({ ...s, nodes: s.nodes.map((n) => fitNode(n, s.hand, measure)) });

  const setLook = (hand: boolean) => {
    const base = current();
    if (base.hand !== hand) commit(refit({ ...base, hand }), base);
  };

  const chooseTool = (t: Tool) => {
    if (editingRef.current) finishEditing();
    setTool(t);
    if (t !== 'select') setSelection(new Set());
  };

  /** Picks a style: it applies to what is selected and to what is drawn next. */
  const apply = (patch: Partial<Style>) => {
    const nextStyle = { ...style, ...patch };
    setStyle(nextStyle);
    lastStyle = nextStyle;
    if (!selected.size) return;
    const base = current();
    const nodePatch: Partial<SketchNode> = {
      ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}),
      ...(patch.fill !== undefined ? { fill: patch.fill } : {}),
      ...(patch.fillStyle !== undefined ? { fillStyle: patch.fillStyle } : {}),
      ...(patch.width !== undefined ? { width: patch.width } : {}),
      ...(patch.dash !== undefined ? { dash: patch.dash } : {}),
      ...(patch.font !== undefined ? { font: patch.font } : {}),
    };
    const edgePatch: Partial<SketchEdge> = {
      ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}),
      ...(patch.width !== undefined ? { width: patch.width } : {}),
      ...(patch.dash !== undefined ? { dash: patch.dash } : {}),
      ...(patch.head !== undefined ? { head: patch.head } : {}),
      ...(patch.route !== undefined ? { route: patch.route } : {}),
      ...(patch.font !== undefined ? { font: Math.min(patch.font, 28) } : {}),
    };
    // A branch's colour runs down to every topic below it.
    const recolour = new Set(selected);
    if (patch.stroke !== undefined) for (const id of selected) for (const d of descendantsOf(base, id)) recolour.add(d);
    let next: Scene = {
      ...base,
      nodes: base.nodes.map((n) => {
        if (selected.has(n.id)) return patch.font !== undefined ? fitNode({ ...n, ...nodePatch }, base.hand, measure) : { ...n, ...nodePatch };
        return recolour.has(n.id) && patch.stroke !== undefined ? { ...n, stroke: patch.stroke } : n;
      }),
      edges: base.edges.map((e) => (selected.has(e.id) ? { ...e, ...edgePatch } : e)),
      strokes: base.strokes.map((s) =>
        selected.has(s.id) ? { ...s, ...(patch.stroke !== undefined ? { color: patch.stroke } : {}), ...(patch.width !== undefined ? { size: penSize(patch.width) } : {}) } : s,
      ),
    };
    if (patch.font !== undefined)
      next = tidy(
        next,
        [...selected].filter((id) => isMapNode(next, id)),
      );
    commit(next, base);
  };

  const startMindMap = () => {
    const base = current();
    const root = mindMapRoot(centre(), base.hand, measure);
    beginEdit({ kind: 'node', id: root.id, before: base, fresh: false, selectAll: true }, { ...base, nodes: [...base.nodes, root] });
  };

  const startFlowchart = () => {
    const base = current();
    const { nodes, edges } = flowchartStarter(centre(), base.hand, measure);
    const next = { ...base, nodes: [...base.nodes, ...nodes], edges: [...base.edges, ...edges] };
    commit(next, base);
    fitView(next);
  };

  const exportPicture = (kind: 'svg' | 'png') =>
    attempt(async () => {
      if (editingRef.current) finishEditing();
      const s = current();
      if (isEmptyScene(s)) {
        notify('Draw something first, then save it as a picture.');
        return;
      }
      const svgText = sceneSvg(s, { measure, fontCss: await sketchFontCss([s]), background: PAPER, title: name ? `${name} – sketch` : 'Sketch' });
      const base = `${safeName(name || 'sketch').replace(/\.+$/, '') || 'sketch'}${name ? ' sketch' : ''}`;
      const outcome = kind === 'svg' ? await saveFile(`${base}.svg`, svgText, 'image/svg+xml') : await saveFile(`${base}.png`, await svgToPng(svgText), 'image/png');
      if (outcome?.saved) notify(`Saved to ${outcome.location}`);
    });

  /* ------------------------------------------------------------ keys -- */

  const onKeyDown = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== stage.current) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const base = current();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && key === 'd') {
      e.preventDefault();
      duplicate();
      return;
    }
    if (mod && key === 'a') {
      e.preventDefault();
      setSelection(new Set(known));
      return;
    }
    if (mod && (key === '=' || key === '+')) {
      e.preventDefault();
      zoomTo(view.zoom * 1.25);
      return;
    }
    if (mod && key === '-') {
      e.preventDefault();
      zoomTo(view.zoom / 1.25);
      return;
    }
    if (mod && key === '0') {
      e.preventDefault();
      zoomTo(1);
      return;
    }
    if (mod || e.altKey) return;
    switch (e.key) {
      case 'Escape':
        if (drag.current) {
          drag.current = null;
          setLive(null);
          setMarquee(null);
        } else if (tool !== 'select') setTool('select');
        else setSelection(new Set());
        return;
      case 'Delete':
      case 'Backspace':
        if (selected.size) {
          e.preventDefault();
          removeSelected();
        }
        return;
      case 'Tab':
        if (singleNode) {
          e.preventDefault();
          addTopic('child', singleNode.id, base);
        }
        return;
      case 'Enter':
        if (singleNode) {
          e.preventDefault();
          if (singleNode.parent !== undefined) addTopic('sibling', singleNode.id, base);
          else beginEdit({ kind: 'node', id: singleNode.id, before: base, fresh: false, selectAll: false });
        } else if (singleEdge) {
          e.preventDefault();
          beginEdit({ kind: 'edge', id: singleEdge.id, before: base, fresh: false, selectAll: false });
        }
        return;
      case 'F2':
        if (singleNode || singleEdge) {
          e.preventDefault();
          beginEdit({ kind: singleNode ? 'node' : 'edge', id: single ?? '', before: base, fresh: false, selectAll: true });
        }
        return;
      case ' ':
        e.preventDefault();
        space.current = true;
        setPanning(true);
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!selected.size) return;
        e.preventDefault();
        const direction = e.key.slice(5).toLowerCase() as 'left' | 'right' | 'up' | 'down';
        if (singleNode && !e.shiftKey && isMapNode(base, singleNode.id)) {
          const to = neighbour(base, singleNode.id, direction);
          if (to) setSelection(new Set([to]));
          return;
        }
        const by = e.shiftKey ? 10 : 1;
        const dx = direction === 'left' ? -by : direction === 'right' ? by : 0;
        const dy = direction === 'up' ? -by : direction === 'down' ? by : 0;
        commit(moveItems(base, withDescendants(base, selected), dx, dy), base);
        return;
      }
    }
    if (e.key.length !== 1) return;
    // Typing over a topic or an empty shape writes in it; otherwise letters pick tools.
    if (singleNode && (!singleNode.text || isMapNode(base, singleNode.id))) {
      e.preventDefault();
      const next = { ...base, nodes: base.nodes.map((n) => (n.id === singleNode.id ? fitNode({ ...n, text: e.key }, base.hand, measure) : n)) };
      beginEdit({ kind: 'node', id: singleNode.id, before: base, fresh: false, selectAll: false }, next);
      return;
    }
    const pick = TOOL_KEYS[key];
    if (pick) {
      e.preventDefault();
      chooseTool(pick);
    }
  };

  /* ------------------------------------------------------- height grip -- */

  const onGripDown = (e: TargetedPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const from = current();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setLive({ ...from, height: clampHeight(from.height + ev.clientY - startY) });
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      const next = liveRef.current;
      setLive(null);
      if (next && next.height !== from.height) {
        savedRef.current = next;
        update(next);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  /* ---------------------------------------------------------- render -- */

  const keepFocus = (e: TargetedMouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest('button')) e.preventDefault();
  };

  const edited = editing ? (editing.kind === 'node' ? nodeIndex.get(editing.id) : undefined) : undefined;
  const editedEdge = editing?.kind === 'edge' ? scene.edges.find((x) => x.id === editing.id) : undefined;
  let editor: JSX.Element | null = null;
  if (editing && (edited || editedEdge)) {
    let box: Box;
    let font: number;
    let colour: string;
    let value: string;
    let lines: number;
    if (edited) {
      box = innerBox(edited);
      font = edited.font;
      colour = edited.stroke;
      value = edited.text;
      lines = wrapText(value, box.w, font, scene.hand, measure).length;
    } else {
      const e = editedEdge as SketchEdge;
      const g = edgeGeometry(e, nodeIndex);
      font = e.font;
      colour = e.stroke;
      value = e.label;
      const run = labelText({ ...e, label: value || ' ' }, g, scene.hand, measure);
      const w = Math.max(120, (run?.backing?.w ?? 0) + 24);
      lines = Math.max(1, run?.lines.length ?? 1);
      box = { x: g.mid.x - w / 2, y: g.mid.y - (lines * lineHeight(font)) / 2, w, h: lines * lineHeight(font) };
    }
    const lh = lineHeight(font) * view.zoom;
    const height = Math.max(box.h * view.zoom, lh);
    editor = (
      <textarea
        ref={textarea}
        class={`sk-edit${editedEdge ? ' is-label' : ''}`}
        style={{
          left: `${(box.x - view.x) * view.zoom}px`,
          top: `${(box.y - view.y) * view.zoom}px`,
          width: `${box.w * view.zoom}px`,
          height: `${height}px`,
          paddingTop: `${Math.max(0, (height - lines * lh) / 2)}px`,
          fontSize: `${font * view.zoom}px`,
          lineHeight: `${lh}px`,
          fontFamily: fontFamily(scene.hand),
          color: colour,
        }}
        value={value}
        spellcheck
        aria-label={edited ? 'Text in the shape' : 'Connector label'}
        data-testid="sk-edit"
        onInput={(e) => changeText(e.currentTarget.value)}
        onBlur={() => finishEditing()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
            e.preventDefault();
            finishEditing();
          } else if (e.key === 'Tab' && edited) {
            e.preventDefault();
            finishEditing('child');
          }
        }}
      />
    );
  }

  const shapeTool = SHAPE_TOOLS[tool];
  const kinds = new Set([...selected].map((id) => (nodeIndex.has(id) ? 'node' : scene.edges.some((e) => e.id === id) ? 'edge' : 'stroke')));
  if (!selected.size) {
    if (shapeTool) kinds.add('node');
    if (tool === 'arrow' || tool === 'line') kinds.add('edge');
    if (tool === 'pen') kinds.add('stroke');
  }
  const firstNode = scene.nodes.find((n) => selected.has(n.id));
  const firstEdge = scene.edges.find((e) => selected.has(e.id));
  const firstStroke = scene.strokes.find((s) => selected.has(s.id));
  const shown: Style = {
    ...style,
    ...(firstNode ? { stroke: firstNode.stroke, fill: firstNode.fill, fillStyle: firstNode.fillStyle, width: firstNode.width, dash: firstNode.dash, font: firstNode.font } : {}),
    ...(!firstNode && firstEdge ? { stroke: firstEdge.stroke, width: firstEdge.width, dash: firstEdge.dash, font: firstEdge.font } : {}),
    ...(firstEdge ? { head: firstEdge.head, route: firstEdge.route } : {}),
    ...(!firstNode && !firstEdge && firstStroke ? { stroke: firstStroke.color } : {}),
  };
  const fillable = kinds.has('node') && !(singleNode?.shape === 'text' || shapeTool === 'text');
  const showPanel = active && kinds.size > 0 && !editing;
  // The panel keeps out of the way of what is selected.
  const picked = [...selected].map((id) => itemBox(scene, id, nodeIndex)).filter((b): b is Box => b !== null);
  const pickedX = picked.length ? (Math.min(...picked.map((b) => b.x)) + Math.max(...picked.map((b) => b.x + b.w))) / 2 : view.x;
  const panelRight = picked.length > 0 && (pickedX - view.x) * view.zoom < width / 2;

  let hint = '';
  if (editing) hint = editing.kind === 'node' ? 'Enter: done · Shift+Enter: new line · Tab: done and add a branch' : 'Enter: done';
  else if (singleNode && isMapNode(scene, singleNode.id)) hint = 'Tab: add a branch · Enter: add a sibling · type to rename · arrows: move around the map';
  else if (singleNode) hint = 'Type or double-click to write · Tab: start a mind map from it · drag the corners to resize';
  else if (shapeTool === 'text') hint = 'Click where the text goes';
  else if (shapeTool) hint = 'Drag to draw, or click for the usual size · Shift: keep it square';
  else if (tool === 'arrow' || tool === 'line') hint = 'Drag from one shape to another: the ends stick to the shapes';
  else if (tool === 'pen') hint = 'Draw freehand; a stylus draws thicker where pressed harder';
  else if (tool === 'eraser') hint = 'Drag over anything to rub it out';

  const empty = isEmptyScene(scene) && !editing && !drag.current;
  const canUndo = history.current.past.length > 0;
  const canRedo = history.current.future.length > 0;
  const selectionBoxes = [...selected].map((id) => ({ id, box: itemBox(scene, id, nodeIndex) }));
  const marginBox = 4 / view.zoom;

  return (
    <div class={`sk${active ? ' is-active' : ''}`} data-testid="sk">
      <div class="sk-bar" role="toolbar" aria-label="Sketch tools" onMouseDown={keepFocus}>
        <span class="sk-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              class={`sk-tool${tool === t.id ? ' is-on' : ''}`}
              aria-pressed={tool === t.id}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              onClick={() => chooseTool(t.id)}
              data-testid={`sk-tool-${t.id}`}
            >
              {t.icon}
            </button>
          ))}
        </span>
        <span class="sk-actions">
          <span class="sk-look" role="group" aria-label="Look">
            <button type="button" class={`sk-choice${scene.hand ? ' is-on' : ''}`} aria-pressed={scene.hand} onClick={() => setLook(true)} data-testid="sk-hand">
              Hand-drawn
            </button>
            <button type="button" class={`sk-choice${scene.hand ? '' : ' is-on'}`} aria-pressed={!scene.hand} onClick={() => setLook(false)} data-testid="sk-clean">
              Clean
            </button>
          </span>
          <select
            class="sk-grid-pick"
            aria-label="Background"
            value={scene.grid}
            onChange={(e) => {
              const base = current();
              commit({ ...base, grid: e.currentTarget.value as Scene['grid'] }, base);
            }}
          >
            <option value="none">Plain</option>
            <option value="dots">Dots</option>
            <option value="lines">Squares</option>
          </select>
          <button type="button" class="icon-button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={undo} data-testid="sk-undo">
            <Icon name="rotate-left" size={15} />
          </button>
          <button type="button" class="icon-button" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!canRedo} onClick={redo}>
            <Icon name="rotate-right" size={15} />
          </button>
          <button type="button" class="button button-small" title="Save the sketch as an SVG picture" onClick={() => void exportPicture('svg')} data-testid="sk-svg">
            SVG
          </button>
          <button type="button" class="button button-small" title="Save the sketch as a PNG picture" onClick={() => void exportPicture('png')} data-testid="sk-png">
            PNG
          </button>
        </span>
      </div>
      <div
        ref={stage}
        class={`sk-stage${panning ? ' is-panning' : ''}`}
        style={{ height: `${scene.height}px` }}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the drawing takes keys (tools, Tab for a branch, Delete) like any editor
        tabIndex={0}
        role="application"
        aria-roledescription="sketch"
        aria-label="Sketch. Pick a tool, then draw. Tab adds a mind-map branch, Enter a sibling."
        onKeyDown={onKeyDown}
      >
        <div class="sk-paper">
          <svg
            ref={svg}
            class={`sk-canvas tool-${tool}`}
            aria-hidden="true"
            width="100%"
            height="100%"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDblClick={onDoubleClick}
            onWheel={onWheel}
            data-testid="sk-canvas"
          >
            <defs>
              <pattern id={gridId} width="20" height="20" patternUnits="userSpaceOnUse">
                {scene.grid === 'dots' ? <circle cx="1" cy="1" r="1.1" fill="#c3c8cd" /> : <path d="M20 0H0V20" fill="none" stroke="#e3e6e9" stroke-width="1" />}
              </pattern>
            </defs>
            <g transform={`scale(${view.zoom}) translate(${-view.x} ${-view.y})`}>
              {scene.grid !== 'none' && <rect x={view.x} y={view.y} width={width / view.zoom} height={scene.height / view.zoom} fill={`url(#${gridId})`} />}
              <g fill="none" stroke-linecap="round" stroke-linejoin="round">
                {items.map((item) => (
                  <ItemView key={item.id} item={item} hand={scene.hand} hideText={editing?.id === item.id} />
                ))}
              </g>
              {target &&
                (() => {
                  const n = nodeIndex.get(target);
                  return n ? <path class="sk-target" transform={`translate(${n.x - 5} ${n.y - 5})`} d={outlinePath(n.shape, n.w + 10, n.h + 10)} vector-effect="non-scaling-stroke" /> : null;
                })()}
              {selectionBoxes.map(({ id, box }) =>
                box ? (
                  <rect key={id} class="sk-selected" x={box.x - marginBox} y={box.y - marginBox} width={box.w + 2 * marginBox} height={box.h + 2 * marginBox} vector-effect="non-scaling-stroke" />
                ) : null,
              )}
              {singleNode &&
                !editing &&
                (() => {
                  const b = grow(singleNode, marginBox);
                  const s = 8 / view.zoom;
                  return [
                    [b.x, b.y],
                    [b.x + b.w, b.y],
                    [b.x, b.y + b.h],
                    [b.x + b.w, b.y + b.h],
                  ].map(([x = 0, y = 0], i) => <rect key={i} class="sk-handle" x={x - s / 2} y={y - s / 2} width={s} height={s} vector-effect="non-scaling-stroke" />);
                })()}
              {singleEdge &&
                (() => {
                  const g = edgeGeometry(singleEdge, nodeIndex);
                  const ends = [g.points[0], g.points[g.points.length - 1]];
                  return ends.map((p, i) => (p ? <circle key={i} class="sk-handle" cx={p.x} cy={p.y} r={5 / view.zoom} vector-effect="non-scaling-stroke" /> : null));
                })()}
              {marquee && <rect class="sk-marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} vector-effect="non-scaling-stroke" />}
            </g>
          </svg>
          {editor}
        </div>
        {empty && (
          <div class="sk-start" data-testid="sk-start">
            <p>Start a sketch</p>
            <div class="button-row">
              <button type="button" class="button button-primary" onClick={startMindMap} data-testid="sk-start-map">
                Mind map
              </button>
              <button type="button" class="button" onClick={startFlowchart} data-testid="sk-start-flow">
                Flowchart
              </button>
            </div>
            <p class="tone-muted">or pick a tool above and draw</p>
          </div>
        )}
        {showPanel && !open && (
          <button type="button" class={`sk-panel-open button button-small${panelRight ? ' is-right' : ''}`} onMouseDown={keepFocus} onClick={() => showStyles(true)} data-testid="sk-panel-open">
            Style
          </button>
        )}
        {showPanel && open && (
          <div class={`sk-panel${panelRight ? ' is-right' : ''}`} role="group" aria-label="Style" onMouseDown={keepFocus} data-testid="sk-panel">
            <button type="button" class="sk-panel-close" title="Hide the style panel" aria-label="Hide the style panel" onClick={() => showStyles(false)}>
              <Icon name="close" size={12} />
            </button>
            <Row label="Stroke">
              <Swatches label="Stroke colour" colors={STROKES} value={shown.stroke} onPick={(stroke) => apply({ stroke })} />
            </Row>
            {fillable && (
              <Row label="Fill">
                <Swatches label="Fill colour" colors={FILLS} value={shown.fill} onPick={(fill) => apply({ fill })} />
              </Row>
            )}
            {fillable && scene.hand && shown.fill !== 'none' && (
              <Row label="Filling">
                <Options<FillStyle>
                  label="Filling"
                  value={shown.fillStyle}
                  onPick={(fillStyle) => apply({ fillStyle })}
                  options={[
                    ['hachure', line('M3 13 9 3M8 13l6-10M13 13l6-10'), 'Hatched'],
                    ['cross-hatch', line('M3 13 9 3M8 13l6-10M13 13l6-10M3 3l6 10M8 3l6 10M13 3l6 10'), 'Cross-hatched'],
                    ['solid', glyph(<rect x="3" y="3" width="18" height="10" rx="1.5" fill="currentColor" />, 24, 20), 'Solid'],
                  ]}
                />
              </Row>
            )}
            <Row label="Line">
              <Options<number>
                label="Line width"
                value={shown.width}
                onPick={(w) => apply({ width: w })}
                options={[
                  [1, line('M3 8h18', { 'stroke-width': 1 }), 'Thin'],
                  [2, line('M3 8h18', { 'stroke-width': 2.2 }), 'Bold'],
                  [4, line('M3 8h18', { 'stroke-width': 4 }), 'Thick'],
                ]}
              />
              {(kinds.has('node') || kinds.has('edge')) && (
                <Options<Dash>
                  label="Dashes"
                  value={shown.dash}
                  onPick={(dash) => apply({ dash })}
                  options={[
                    ['solid', line('M3 8h18'), 'Solid line'],
                    ['dashed', line('M3 8h18', { 'stroke-dasharray': '4 3' }), 'Dashed line'],
                    ['dotted', line('M3 8h18', { 'stroke-dasharray': '0.1 3.5', 'stroke-width': 2 }), 'Dotted line'],
                  ]}
                />
              )}
            </Row>
            {(kinds.has('node') || kinds.has('edge')) && (
              <Row label="Text">
                <Options<number>
                  label="Text size"
                  value={shown.font}
                  onPick={(font) => apply({ font })}
                  options={[
                    [16, 'S', 'Small text'],
                    [20, 'M', 'Medium text'],
                    [28, 'L', 'Large text'],
                    [36, 'XL', 'Extra large text'],
                  ]}
                />
              </Row>
            )}
            {kinds.has('edge') && (
              <Row label="Arrow" test="sk-heads">
                <Options<Head>
                  label="Arrowheads"
                  value={shown.head}
                  onPick={(head) => apply({ head })}
                  options={[
                    ['none', line('M3 8h18'), 'No arrowheads'],
                    ['end', line('M3 8h18M16 4l5 4-5 4'), 'Arrowhead at the end'],
                    ['both', line('M3 8h18M16 4l5 4-5 4M8 4 3 8l5 4'), 'Arrowheads at both ends'],
                  ]}
                />
                <Options<Route>
                  label="Route"
                  value={shown.route}
                  onPick={(route) => apply({ route })}
                  options={[
                    ['straight', line('M3 13 21 3'), 'Straight'],
                    ['curved', line('M3 13Q6 2 21 3'), 'Curved'],
                    ['elbow', line('M3 13h9V3h9'), 'Elbow'],
                  ]}
                />
              </Row>
            )}
            {singleNode && (
              <Row label="Shape">
                <select
                  class="sk-shape-pick"
                  aria-label="Shape"
                  value={singleNode.shape}
                  data-testid="sk-shape"
                  onChange={(e) => {
                    const base = current();
                    const shape = e.currentTarget.value as Shape;
                    const n = base.nodes.find((x) => x.id === singleNode.id);
                    if (!n) return;
                    const fill = shape === 'sticky' && n.fill === 'none' ? '#ffec99' : n.fill;
                    const next = updateNode(base, n.id, fitNode({ ...n, shape, fill, ...(shape === 'sticky' ? { fillStyle: 'solid' as const } : {}) }, base.hand, measure));
                    commit(isMapNode(next, n.id) ? tidy(next, [n.id]) : next, base);
                  }}
                >
                  {SHAPES.map((x) => (
                    <option key={x} value={x}>
                      {SHAPE_LABEL[x]}
                    </option>
                  ))}
                </select>
              </Row>
            )}
            {singleNode && (
              <div class="sk-row-buttons">
                <button type="button" class="button button-small" onClick={() => addTopic('child', singleNode.id, current())} title="Add a branch (Tab)" data-testid="sk-add-branch">
                  + Branch
                </button>
                {singleNode.parent !== undefined && (
                  <button type="button" class="button button-small" onClick={() => addTopic('sibling', singleNode.id, current())} title="Add a sibling (Enter)">
                    + Sibling
                  </button>
                )}
                {singleNode.parent !== undefined && (
                  <button type="button" class="button button-small" onClick={() => detach(singleNode.id)} title="Take this topic and its branches out of the map">
                    Detach
                  </button>
                )}
              </div>
            )}
            {selected.size > 0 && (
              <div class="sk-row-buttons">
                <button type="button" class="button button-small" onClick={() => restack(true)} title="Bring to front">
                  Front
                </button>
                <button type="button" class="button button-small" onClick={() => restack(false)} title="Send to back">
                  Back
                </button>
                <button type="button" class="icon-button" onClick={duplicate} title="Duplicate (Ctrl+D)" aria-label="Duplicate">
                  <Icon name="copy" size={14} />
                </button>
                <button type="button" class="icon-button" onClick={removeSelected} title="Delete (Del)" aria-label="Delete" data-testid="sk-delete">
                  <Icon name="trash" size={14} />
                </button>
              </div>
            )}
          </div>
        )}
        <div class="sk-zoom" role="group" aria-label="Zoom" onMouseDown={keepFocus}>
          <button type="button" class="icon-button" title="Zoom out (Ctrl+−)" aria-label="Zoom out" onClick={() => zoomTo(view.zoom / 1.25)}>
            −
          </button>
          <button type="button" class="sk-zoom-level" title="Back to 100%" onClick={() => zoomTo(1)}>
            {Math.round(view.zoom * 100)}%
          </button>
          <button type="button" class="icon-button" title="Zoom in (Ctrl+=)" aria-label="Zoom in" onClick={() => zoomTo(view.zoom * 1.25)}>
            +
          </button>
          <button type="button" class="button button-small" title="Show the whole sketch" onClick={() => fitView()} data-testid="sk-fit">
            Fit
          </button>
          {hasMap && (
            <button type="button" class="button button-small" onClick={tidyMaps} title="Lay the mind maps out neatly" data-testid="sk-tidy">
              Tidy
            </button>
          )}
        </div>
        {active && hint && <p class="sk-hint">{hint}</p>}
        <div class="sk-grip" role="separator" aria-orientation="horizontal" aria-label="Drag to change the height of the drawing" title="Drag to change the height" onPointerDown={onGripDown} />
      </div>
      {scene.nodes.some((n) => n.text.trim()) && (
        <ul class="visually-hidden" aria-label="Words in the sketch">
          {scene.nodes
            .filter((n) => n.text.trim())
            .map((n) => (
              <li key={n.id}>{n.text}</li>
            ))}
        </ul>
      )}
    </div>
  );
}
