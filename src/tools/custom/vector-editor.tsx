/**
 * Vector Editor: draw and edit SVG shapes, move their nodes and handles,
 * combine shapes (Boolean operations), align and snap them, keep them on
 * layers, and save SVG or DXF.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type AlignMode,
  alignMoves,
  type Box,
  boxToBox,
  type Drawing,
  deleteNode,
  ellipsePath,
  emptyDrawing,
  exportDxf,
  exportSvg,
  importSvg,
  type Layer,
  type Matrix,
  makeLayer,
  makeShape,
  moveHandle,
  moveNode,
  nearestOn,
  newId,
  type PathNode,
  type Pt,
  pathData,
  polyPath,
  rectPath,
  rotation,
  type Shape,
  type SubPath,
  scaling,
  setNodeKind,
  shapeBounds,
  snapBox,
  splitSegment,
  transformPaths,
  translation,
  unionBox,
} from '../../lib/vector';
import { BOOLEAN_LABELS, type BooleanOp, booleanPaths } from '../../lib/vector-boolean';
import { pickFile, readTextFile, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { Segmented, usePersistentState } from './_shared';

type Tool = 'select' | 'node' | 'rect' | 'ellipse' | 'line' | 'pen';

const TOOLS: readonly { value: Tool; label: string; key: string }[] = [
  { value: 'select', label: 'Select', key: 'v' },
  { value: 'node', label: 'Nodes', key: 'n' },
  { value: 'rect', label: 'Rectangle', key: 'r' },
  { value: 'ellipse', label: 'Ellipse', key: 'e' },
  { value: 'line', label: 'Line', key: 'l' },
  { value: 'pen', label: 'Pen', key: 'p' },
];

const ALIGN: readonly { mode: AlignMode; label: string }[] = [
  { mode: 'left', label: 'Left' },
  { mode: 'hcentre', label: 'Centre' },
  { mode: 'right', label: 'Right' },
  { mode: 'top', label: 'Top' },
  { mode: 'vcentre', label: 'Middle' },
  { mode: 'bottom', label: 'Bottom' },
  { mode: 'hspace', label: 'Spread across' },
  { mode: 'vspace', label: 'Spread down' },
];

interface NodeRef {
  readonly path: number;
  readonly node: number;
}

type Gesture =
  | { readonly kind: 'move'; readonly start: Pt; readonly before: Drawing; readonly box: Box; moved: boolean }
  | { readonly kind: 'resize'; readonly handle: number; readonly before: Drawing; readonly box: Box }
  | { readonly kind: 'marquee'; readonly start: Pt; readonly now: Pt; readonly add: boolean }
  | { readonly kind: 'create'; readonly tool: 'rect' | 'ellipse' | 'line'; readonly start: Pt; readonly now: Pt }
  | { readonly kind: 'node'; readonly ref: NodeRef; readonly before: Drawing }
  | { readonly kind: 'handle'; readonly ref: NodeRef; readonly which: 'hin' | 'hout'; readonly before: Drawing }
  | { readonly kind: 'pan'; readonly start: Pt; readonly view: View }
  | { readonly kind: 'pen' };

interface View {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

const HANDLES: readonly Pt[] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
  [0, 0.5],
];

const shapesOf = (drawing: Drawing): Shape[] => drawing.layers.flatMap((layer) => layer.shapes);
const editable = (drawing: Drawing): Shape[] => drawing.layers.filter((layer) => layer.visible && !layer.locked).flatMap((layer) => layer.shapes);

function mapShapes(drawing: Drawing, ids: ReadonlySet<string>, change: (shape: Shape) => Shape | null): Drawing {
  return {
    ...drawing,
    layers: drawing.layers.map((layer) =>
      layer.locked || !layer.shapes.some((shape) => ids.has(shape.id))
        ? layer
        : { ...layer, shapes: layer.shapes.flatMap((shape) => (ids.has(shape.id) ? ((next) => (next ? [next] : []))(change(shape)) : [shape])) },
    ),
  };
}

const transformShapes = (drawing: Drawing, ids: ReadonlySet<string>, matrix: (shape: Shape) => Matrix): Drawing =>
  mapShapes(drawing, ids, (shape) => ({ ...shape, paths: transformPaths(shape.paths, matrix(shape)) }));

const fmt = (value: number) => String(Math.round(value * 100) / 100);

function Component({ toolId }: { toolId: string }) {
  const [stored, setStored] = usePersistentState<{ svg: string }>(
    toolId,
    (saved) => ({ svg: typeof saved?.svg === 'string' ? saved.svg : '' }),
    (value) => value,
  );
  const [drawing, setDrawingRaw] = useState<Drawing>(() => {
    try {
      if (stored.svg) return importSvg(stored.svg).drawing;
    } catch {
      /* A drawing that no longer reads starts empty. */
    }
    return emptyDrawing();
  });
  const [undo, setUndo] = useState<Drawing[]>([]);
  const [redo, setRedo] = useState<Drawing[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeLayer, setActiveLayer] = useState<string>(() => drawing.layers[drawing.layers.length - 1]?.id ?? '');
  const [tool, setTool] = useState<Tool>('select');
  const [nodeAt, setNodeAt] = useState<NodeRef | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: -40, y: -40 });
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [pen, setPen] = useState<PathNode[] | null>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }[]>([]);
  const [snapGrid, setSnapGrid] = useState(false);
  const [snapObjects, setSnapObjects] = useState(true);
  const [grid, setGrid] = useState(10);
  const [fill, setFill] = useState('#4c9f84');
  const [stroke, setStroke] = useState('#19222a');
  const svg = useRef<SVGSVGElement>(null);
  const host = useRef<HTMLDivElement>(null);

  // The drawing is kept as SVG with the tool's other settings (small drawings only).
  const persist = (next: Drawing) => {
    const text = exportSvg(next);
    setStored({ svg: text.length < 400_000 ? text : '' });
  };
  const show = (next: Drawing) => setDrawingRaw(next);
  const commit = (next: Drawing, before: Drawing = drawing) => {
    setUndo((list) => [...list.slice(-99), before]);
    setRedo([]);
    setDrawingRaw(next);
    persist(next);
  };

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ w: Math.max(200, element.clientWidth), h: Math.max(200, element.clientHeight) }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const showAll = (target: Drawing = drawing) => {
    const zoom = Math.min((size.w - 60) / target.width, (size.h - 60) / target.height, 8);
    setView({ zoom, x: -(size.w / zoom - target.width) / 2, y: -(size.h / zoom - target.height) / 2 });
  };
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && size.w !== 900) {
      fitted.current = true;
      showAll();
    }
  }, [size]);

  const chosen = useMemo(() => new Set(selected), [selected]);
  const all = useMemo(() => shapesOf(drawing), [drawing]);
  const picked = all.filter((shape) => chosen.has(shape.id));
  const box = unionBox(picked.map(shapeBounds));
  const page: Box = { x: 0, y: 0, w: drawing.width, h: drawing.height };
  const px = 1 / view.zoom;
  const target = picked[0];
  const layer = drawing.layers.find((l) => l.id === activeLayer) ?? drawing.layers[drawing.layers.length - 1];

  const point = (event: { clientX: number; clientY: number }): Pt => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return [view.x + (event.clientX - rect.left) / view.zoom, view.y + (event.clientY - rect.top) / view.zoom];
  };
  const toGrid = (p: Pt): Pt => (snapGrid && grid > 0 ? [Math.round(p[0] / grid) * grid, Math.round(p[1] / grid) * grid] : p);

  const addShape = (shape: Shape) => {
    if (!layer || layer.locked || !layer.visible) {
      notify('The active layer is locked or hidden. Choose another layer first.', 'error');
      return;
    }
    commit({ ...drawing, layers: drawing.layers.map((l) => (l.id === layer.id ? { ...l, shapes: [...l.shapes, shape] } : l)) });
    setSelected([shape.id]);
    setTool('select');
  };

  const finishPen = (closed: boolean) => {
    if (pen && pen.length > 1) addShape(makeShape('path', [{ nodes: pen, closed }], { fill: closed ? fill : 'none', stroke: stroke === 'none' ? '#19222a' : stroke }));
    setPen(null);
  };

  const editPath = (index: number, change: (path: SubPath) => SubPath | null, before: Drawing = drawing, record = true) => {
    if (!target) return;
    const next = mapShapes(before, new Set([target.id]), (shape) => {
      const paths = shape.paths.flatMap((path, i) => (i === index ? ((made) => (made ? [made] : []))(change(path)) : [path]));
      return paths.length ? { ...shape, paths } : null;
    });
    if (record) commit(next, before);
    else show(next);
  };

  /* ------------------------------------------------------------ pointer -- */

  const down = (event: PointerEvent) => {
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      setGesture({ kind: 'pan', start: [event.clientX, event.clientY], view });
      return;
    }
    if (event.button !== 0) return;
    host.current?.focus({ preventScroll: true });
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const p = point(event);
    const hit = event.target as SVGElement;
    const role = hit.dataset.role;
    if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
      setGesture({ kind: 'create', tool, start: toGrid(p), now: toGrid(p) });
      return;
    }
    if (tool === 'pen') {
      const first = pen?.[0];
      if (pen && first && pen.length > 1 && Math.hypot(first.x - p[0], first.y - p[1]) < 8 * px) {
        finishPen(true);
        return;
      }
      const [x, y] = toGrid(p);
      setPen([...(pen ?? []), { x, y, smooth: false }]);
      setGesture({ kind: 'pen' });
      return;
    }
    if (tool === 'node' && target) {
      if (role === 'node' || role === 'hin' || role === 'hout') {
        const ref = { path: Number(hit.dataset.path), node: Number(hit.dataset.node) };
        setNodeAt(ref);
        setGesture(role === 'node' ? { kind: 'node', ref, before: drawing } : { kind: 'handle', ref, which: role, before: drawing });
        return;
      }
    }
    if (tool === 'select' && role === 'resize' && box) {
      setGesture({ kind: 'resize', handle: Number(hit.dataset.handle), before: drawing, box });
      return;
    }
    const id = hit.dataset.id;
    if (id) {
      const next = event.shiftKey ? (chosen.has(id) ? selected.filter((s) => s !== id) : [...selected, id]) : chosen.has(id) ? selected : [id];
      setSelected(next);
      setNodeAt(null);
      const boxes = unionBox(all.filter((shape) => next.includes(shape.id)).map(shapeBounds));
      if (tool === 'select' && boxes) setGesture({ kind: 'move', start: p, before: drawing, box: boxes, moved: false });
      return;
    }
    if (tool === 'select') setGesture({ kind: 'marquee', start: p, now: p, add: event.shiftKey });
    else if (tool === 'node') setNodeAt(null);
  };

  const move = (event: PointerEvent) => {
    if (!gesture) return;
    const p = point(event);
    switch (gesture.kind) {
      case 'pan':
        setView({ ...gesture.view, x: gesture.view.x - (event.clientX - gesture.start[0]) / gesture.view.zoom, y: gesture.view.y - (event.clientY - gesture.start[1]) / gesture.view.zoom });
        break;
      case 'create':
      case 'marquee':
        setGesture({ ...gesture, now: gesture.kind === 'create' ? toGrid(p) : p });
        break;
      case 'move': {
        let dx = p[0] - gesture.start[0];
        let dy = p[1] - gesture.start[1];
        if (!gesture.moved && Math.hypot(dx, dy) < 3 * px) break;
        gesture.moved = true;
        const others = [
          ...editable(gesture.before)
            .filter((shape) => !chosen.has(shape.id))
            .map(shapeBounds),
          page,
        ];
        const snap = snapBox({ ...gesture.box, x: gesture.box.x + dx, y: gesture.box.y + dy }, others, { threshold: 6 * px, grid: snapGrid ? grid : 0, objects: snapObjects });
        dx += snap.dx;
        dy += snap.dy;
        setGuides(snap.guides);
        show(transformShapes(gesture.before, chosen, () => translation(dx, dy)));
        break;
      }
      case 'resize': {
        const [fx, fy] = HANDLES[gesture.handle] as Pt;
        const [gx, gy] = toGrid(p);
        const b = gesture.box;
        const left = fx === 0 ? Math.min(gx, b.x + b.w - 0.01) : b.x;
        const right = fx === 1 ? Math.max(gx, b.x + 0.01) : b.x + b.w;
        const top = fy === 0 ? Math.min(gy, b.y + b.h - 0.01) : b.y;
        const bottom = fy === 1 ? Math.max(gy, b.y + 0.01) : b.y + b.h;
        const m = boxToBox(b, { x: left, y: top, w: right - left, h: bottom - top });
        show(transformShapes(gesture.before, chosen, () => m));
        break;
      }
      case 'node': {
        const [x, y] = toGrid(p);
        editPath(gesture.ref.path, (path) => moveNode(path, gesture.ref.node, x, y), gesture.before, false);
        break;
      }
      case 'handle':
        editPath(gesture.ref.path, (path) => moveHandle(path, gesture.ref.node, gesture.which, p[0], p[1]), gesture.before, false);
        break;
      case 'pen': {
        // Dragging after a click pulls out the handles of the node just placed.
        if (!pen?.length) break;
        const last = pen[pen.length - 1] as PathNode;
        if (Math.hypot(p[0] - last.x, p[1] - last.y) < 3 * px) break;
        setPen([...pen.slice(0, -1), { x: last.x, y: last.y, hout: p, hin: [2 * last.x - p[0], 2 * last.y - p[1]], smooth: true }]);
        break;
      }
    }
  };

  const up = () => {
    const done = gesture;
    setGesture(null);
    setGuides([]);
    if (!done) return;
    if (done.kind === 'create') {
      const x = Math.min(done.start[0], done.now[0]);
      const y = Math.min(done.start[1], done.now[1]);
      const w = Math.abs(done.now[0] - done.start[0]);
      const h = Math.abs(done.now[1] - done.start[1]);
      if (done.tool === 'line') {
        if (Math.hypot(w, h) > 2 * px) addShape(makeShape('line', [polyPath([done.start, done.now], false)], { fill: 'none', stroke: stroke === 'none' ? '#19222a' : stroke }));
      } else if (w > 2 * px && h > 2 * px)
        addShape(makeShape(done.tool === 'rect' ? 'rectangle' : 'ellipse', [done.tool === 'rect' ? rectPath(x, y, w, h) : ellipsePath(x + w / 2, y + h / 2, w / 2, h / 2)], { fill, stroke }));
    } else if (done.kind === 'marquee') {
      const area: Box = { x: Math.min(done.start[0], done.now[0]), y: Math.min(done.start[1], done.now[1]), w: Math.abs(done.now[0] - done.start[0]), h: Math.abs(done.now[1] - done.start[1]) };
      const inside = editable(drawing)
        .filter((shape) => {
          const b = shapeBounds(shape);
          return area.w > 2 * px && b.x < area.x + area.w && area.x < b.x + b.w && b.y < area.y + area.h && area.y < b.y + b.h;
        })
        .map((shape) => shape.id);
      setSelected(done.add ? [...new Set([...selected, ...inside])] : inside);
    } else if (done.kind === 'move' || done.kind === 'resize' || done.kind === 'node' || done.kind === 'handle') {
      if (drawing !== done.before) commit(drawing, done.before);
    }
  };

  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const p = point(event);
    const zoom = Math.min(64, Math.max(0.05, view.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
    setView({ zoom, x: p[0] - (p[0] - view.x) * (view.zoom / zoom), y: p[1] - (p[1] - view.y) * (view.zoom / zoom) });
  };
  const zoomBy = (factor: number) => {
    const zoom = Math.min(64, Math.max(0.05, view.zoom * factor));
    const cx = view.x + size.w / view.zoom / 2;
    const cy = view.y + size.h / view.zoom / 2;
    setView({ zoom, x: cx - size.w / zoom / 2, y: cy - size.h / zoom / 2 });
  };

  /* ------------------------------------------------------------ actions -- */

  const remove = () => {
    if (!selected.length) return;
    commit(mapShapes(drawing, chosen, () => null));
    setSelected([]);
    setNodeAt(null);
  };
  const duplicate = () => {
    if (!picked.length) return;
    const copies = new Map<string, Shape>();
    const next = {
      ...drawing,
      layers: drawing.layers.map((l) => ({
        ...l,
        shapes: l.shapes.flatMap((shape) => {
          if (!chosen.has(shape.id) || l.locked) return [shape];
          const copy = { ...shape, id: newId('shape'), paths: transformPaths(shape.paths, translation(10, 10)) };
          copies.set(shape.id, copy);
          return [shape, copy];
        }),
      })),
    };
    commit(next);
    setSelected([...copies.values()].map((shape) => shape.id));
  };
  const nudge = (dx: number, dy: number) => commit(transformShapes(drawing, chosen, () => translation(dx, dy)));
  const style = (patch: Partial<Shape>) => commit(mapShapes(drawing, chosen, (shape) => ({ ...shape, ...patch })));
  const align = (mode: AlignMode) => {
    const moves = alignMoves(picked.map(shapeBounds), mode, page);
    const byId = new Map(picked.map((shape, index) => [shape.id, moves[index] as { dx: number; dy: number }]));
    commit(transformShapes(drawing, chosen, (shape) => translation(byId.get(shape.id)?.dx ?? 0, byId.get(shape.id)?.dy ?? 0)));
  };
  const turn = (matrix: (centre: Pt) => Matrix) => {
    if (box) commit(transformShapes(drawing, chosen, () => matrix([box.x + box.w / 2, box.y + box.h / 2])));
  };
  const setBox = (patch: Partial<Box>) => {
    if (!box) return;
    const next = { ...box, ...patch };
    if (next.w <= 0 || next.h <= 0 || ![next.x, next.y, next.w, next.h].every(Number.isFinite)) return;
    commit(transformShapes(drawing, chosen, () => boxToBox(box, next)));
  };
  const order = (how: 'front' | 'back' | 'up' | 'down') =>
    commit({
      ...drawing,
      layers: drawing.layers.map((l) => {
        if (l.locked || !l.shapes.some((shape) => chosen.has(shape.id))) return l;
        const mine = l.shapes.filter((shape) => chosen.has(shape.id));
        const rest = l.shapes.filter((shape) => !chosen.has(shape.id));
        if (how === 'front') return { ...l, shapes: [...rest, ...mine] };
        if (how === 'back') return { ...l, shapes: [...mine, ...rest] };
        const shapes = [...l.shapes];
        const indexes = shapes.map((shape, index) => (chosen.has(shape.id) ? index : -1)).filter((index) => index >= 0);
        for (const index of how === 'up' ? indexes.reverse() : indexes) {
          const other = how === 'up' ? index + 1 : index - 1;
          const neighbour = shapes[other];
          if (!neighbour || chosen.has(neighbour.id)) continue;
          shapes[other] = shapes[index] as Shape;
          shapes[index] = neighbour;
        }
        return { ...l, shapes };
      }),
    });
  const combine = (op: BooleanOp) =>
    attempt(async () => {
      const [lower, upper] = picked;
      if (!lower || !upper || picked.length !== 2) return;
      const paths = await booleanPaths(lower, upper, op);
      if (!paths.length) {
        notify('Nothing is left: the two shapes do not overlap that way.');
        return;
      }
      const made: Shape = { ...lower, paths, name: `${BOOLEAN_LABELS[op].toLowerCase()} of ${lower.name} and ${upper.name}`.slice(0, 60) };
      commit(mapShapes(drawing, chosen, (shape) => (shape.id === lower.id ? made : null)));
      setSelected([lower.id]);
      setNodeAt(null);
    });
  const editLayers = (change: (layers: Layer[]) => Layer[]) => commit({ ...drawing, layers: change([...drawing.layers]) });
  const stepBack = () => {
    const previous = undo[undo.length - 1];
    if (!previous) return;
    setUndo(undo.slice(0, -1));
    setRedo([...redo, drawing]);
    setDrawingRaw(previous);
    persist(previous);
  };
  const stepForward = () => {
    const next = redo[redo.length - 1];
    if (!next) return;
    setRedo(redo.slice(0, -1));
    setUndo([...undo, drawing]);
    setDrawingRaw(next);
    persist(next);
  };
  const open = () =>
    attempt(async () => {
      const file = await pickFile('image/svg+xml,.svg');
      if (!file) return;
      const { drawing: next, notes } = importSvg(await readTextFile(file));
      commit(next);
      setSelected([]);
      setNodeAt(null);
      setActiveLayer(next.layers[next.layers.length - 1]?.id ?? '');
      showAll(next);
      notify(notes.length ? `Opened. ${notes.join(' ')}` : `Opened ${file.name}`);
    });
  const save = (name: string, text: string, mime: string) =>
    attempt(async () => {
      const saved = await saveFile(name, text, mime);
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });

  const key = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input, select, textarea')) return;
    const mod = event.ctrlKey || event.metaKey;
    const lower = event.key.toLowerCase();
    const step = event.shiftKey ? 10 : 1;
    const arrows: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const arrow = arrows[event.key];
    if (arrow && selected.length) {
      if (tool === 'node' && nodeAt && target) {
        const node = target.paths[nodeAt.path]?.nodes[nodeAt.node];
        if (node) editPath(nodeAt.path, (path) => moveNode(path, nodeAt.node, node.x + arrow[0], node.y + arrow[1]));
      } else nudge(arrow[0], arrow[1]);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      if (tool === 'node' && nodeAt && target) {
        editPath(nodeAt.path, (path) => deleteNode(path, nodeAt.node));
        setNodeAt(null);
      } else remove();
    } else if (mod && lower === 'z') {
      if (event.shiftKey) stepForward();
      else stepBack();
    } else if (mod && lower === 'y') stepForward();
    else if (mod && lower === 'a') setSelected(editable(drawing).map((shape) => shape.id));
    else if (mod && lower === 'd') duplicate();
    else if (event.key === 'Escape') {
      setPen(null);
      setSelected([]);
      setNodeAt(null);
    } else if (event.key === 'Enter' && pen) finishPen(false);
    else if (!mod && TOOLS.some((t) => t.key === lower)) setTool((TOOLS.find((t) => t.key === lower) as (typeof TOOLS)[number]).value);
    else return;
    event.preventDefault();
  };

  const node = nodeAt && target ? target.paths[nodeAt.path]?.nodes[nodeAt.node] : undefined;
  const numberField = (label: string, value: number, apply: (next: number) => void, testId: string, min?: number) => (
    <label class="ve-num">
      <span class="control-label">{label}</span>
      <input class="input" type="number" step="any" min={min} value={fmt(value)} onChange={(e) => apply(Number(e.currentTarget.value))} data-testid={testId} />
    </label>
  );

  const draft =
    gesture?.kind === 'create'
      ? gesture.tool === 'line'
        ? `M${gesture.start[0]} ${gesture.start[1]}L${gesture.now[0]} ${gesture.now[1]}`
        : pathData([
            gesture.tool === 'rect'
              ? rectPath(
                  Math.min(gesture.start[0], gesture.now[0]),
                  Math.min(gesture.start[1], gesture.now[1]),
                  Math.abs(gesture.now[0] - gesture.start[0]),
                  Math.abs(gesture.now[1] - gesture.start[1]),
                )
              : ellipsePath(
                  (gesture.start[0] + gesture.now[0]) / 2,
                  (gesture.start[1] + gesture.now[1]) / 2,
                  Math.abs(gesture.now[0] - gesture.start[0]) / 2,
                  Math.abs(gesture.now[1] - gesture.start[1]) / 2,
                ),
          ])
      : pen
        ? pathData([{ nodes: pen, closed: false }])
        : '';

  return (
    <section class="tool ve" data-testid="tool" data-state={all.length ? 'done' : 'idle'} onKeyDown={key}>
      <div class="ve-bar">
        <button
          type="button"
          class="button button-small"
          onClick={() => {
            const next = emptyDrawing(drawing.width, drawing.height, drawing.unit);
            commit(next);
            setSelected([]);
            setActiveLayer(next.layers[0]?.id ?? '');
          }}
        >
          <Icon name="file" size={13} /> New
        </button>
        <button type="button" class="button button-small" onClick={() => void open()} data-testid="ve-open">
          <Icon name="open" size={13} /> Open SVG
        </button>
        <button type="button" class="button button-small" onClick={() => void save('drawing.svg', exportSvg(drawing), 'image/svg+xml')} data-testid="ve-save">
          <Icon name="save" size={13} /> Save SVG
        </button>
        <button
          type="button"
          class="button button-small"
          onClick={() =>
            void save('drawing.dxf', exportDxf(drawing, { tolerance: drawing.unit === 'mm' ? 0.02 : 0.08, scale: drawing.unit === 'mm' ? 1 : 25.4 / 96, hiddenLayers: false }), 'image/vnd.dxf')
          }
          data-testid="ve-dxf"
        >
          <Icon name="save" size={13} /> Export DXF
        </button>
        <button type="button" class="icon-button" disabled={!undo.length} onClick={stepBack} aria-label="Undo" title="Undo (Ctrl+Z)" data-testid="ve-undo">
          <Icon name="left" size={15} />
        </button>
        <button type="button" class="icon-button" disabled={!redo.length} onClick={stepForward} aria-label="Redo" title="Redo (Ctrl+Y)" data-testid="ve-redo">
          <Icon name="right" size={15} />
        </button>
        <Segmented
          value={tool}
          choices={TOOLS}
          onChange={(next) => {
            if (next !== 'pen') setPen(null);
            setTool(next);
          }}
          label="Tool"
        />
        <span class="ve-zoom">
          <button type="button" class="icon-button" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
            <Icon name="down" size={14} />
          </button>
          <button type="button" class="button button-small" onClick={() => showAll()} title="Show the whole page">
            {Math.round(view.zoom * 100)}%
          </button>
          <button type="button" class="icon-button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
            <Icon name="up" size={14} />
          </button>
        </span>
        <label class="ve-check">
          <input type="checkbox" checked={snapObjects} onChange={(e) => setSnapObjects(e.currentTarget.checked)} data-testid="ve-snap-objects" />
          <span>Snap to shapes</span>
        </label>
        <label class="ve-check">
          <input type="checkbox" checked={snapGrid} onChange={(e) => setSnapGrid(e.currentTarget.checked)} data-testid="ve-snap-grid" />
          <span>Snap to grid of</span>
        </label>
        <label class="ve-num ve-grid">
          <span class="visually-hidden">Grid spacing</span>
          <input class="input" type="number" min={0.1} step="any" value={grid} onChange={(e) => setGrid(Math.max(0.1, Number(e.currentTarget.value) || 10))} />
        </label>
      </div>

      <div class="ve-bar ve-context">
        <span class="ve-count" data-testid="ve-count" role="status">
          {picked.length ? `${picked.length} ${picked.length === 1 ? 'shape' : 'shapes'} selected` : `${all.length} ${all.length === 1 ? 'shape' : 'shapes'}`}
        </span>
        <span class="ve-group" role="group" aria-label="Combine two shapes">
          {(Object.keys(BOOLEAN_LABELS) as BooleanOp[]).map((op) => (
            <button
              type="button"
              class="button button-small"
              key={op}
              disabled={picked.length !== 2}
              onClick={() => void combine(op)}
              title={op === 'subtract' ? 'Cuts the upper shape out of the lower one' : undefined}
              data-testid={`ve-bool-${op}`}
            >
              {BOOLEAN_LABELS[op]}
            </button>
          ))}
        </span>
        <span class="ve-group" role="group" aria-label="Align">
          {ALIGN.map(({ mode, label }) => (
            <button
              type="button"
              class="button button-small"
              key={mode}
              disabled={!picked.length || ((mode === 'hspace' || mode === 'vspace') && picked.length < 3)}
              onClick={() => align(mode)}
              data-testid={`ve-align-${mode}`}
            >
              {label}
            </button>
          ))}
        </span>
        <span class="ve-group" role="group" aria-label="Arrange">
          <button type="button" class="button button-small" disabled={!picked.length} onClick={() => order('front')}>
            To front
          </button>
          <button type="button" class="button button-small" disabled={!picked.length} onClick={() => order('up')}>
            Forward
          </button>
          <button type="button" class="button button-small" disabled={!picked.length} onClick={() => order('down')}>
            Backward
          </button>
          <button type="button" class="button button-small" disabled={!picked.length} onClick={() => order('back')}>
            To back
          </button>
          <button type="button" class="button button-small" disabled={!picked.length} onClick={() => turn(([cx, cy]) => rotation(90, cx, cy))}>
            Turn 90°
          </button>
          <button type="button" class="button button-small" disabled={!picked.length} onClick={() => turn(([cx, cy]) => scaling(-1, 1, cx, cy))}>
            Flip
          </button>
          <button type="button" class="button button-small" disabled={!picked.length} onClick={duplicate} data-testid="ve-duplicate">
            Duplicate
          </button>
          <button type="button" class="button button-small" disabled={!picked.length} onClick={remove} data-testid="ve-delete">
            Delete
          </button>
        </span>
      </div>

      <div class="ve-main">
        <div
          class="ve-stage"
          ref={host}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the drawing takes keyboard commands (arrows, Delete, tool letters).
          tabIndex={0}
          role="application"
          aria-label="Drawing. Arrow keys move the selection, Delete removes it, V N R E L P choose a tool."
          onWheel={wheel}
          data-testid="ve-stage"
        >
          <svg
            ref={svg}
            class={`ve-canvas is-${tool}`}
            width={size.w}
            height={size.h}
            viewBox={`${view.x} ${view.y} ${size.w / view.zoom} ${size.h / view.zoom}`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onDblClick={(event) => {
              if (tool === 'pen') finishPen(false);
              else if (tool === 'node' && target) {
                const p = point(event);
                const near = target.paths.map((path, index) => ({ index, found: nearestOn(path, p[0], p[1]) })).sort((a, b) => (a.found?.distance ?? Infinity) - (b.found?.distance ?? Infinity))[0];
                if (near?.found && near.found.distance < 8 * px) editPath(near.index, (path) => splitSegment(path, near.found?.index ?? 0, near.found?.t ?? 0.5));
              }
            }}
            data-testid="ve-canvas"
            aria-hidden="true"
          >
            <rect x={0} y={0} width={drawing.width} height={drawing.height} class="ve-page" stroke-width={px} />
            {snapGrid && grid * view.zoom >= 5 && (
              <g class="ve-gridlines" stroke-width={px}>
                {Array.from({ length: Math.min(400, Math.floor(drawing.width / grid) + 1) }, (_, i) => (
                  <line key={`x${i}`} x1={i * grid} y1={0} x2={i * grid} y2={drawing.height} />
                ))}
                {Array.from({ length: Math.min(400, Math.floor(drawing.height / grid) + 1) }, (_, i) => (
                  <line key={`y${i}`} x1={0} y1={i * grid} x2={drawing.width} y2={i * grid} />
                ))}
              </g>
            )}
            {drawing.layers.map((l) =>
              l.visible ? (
                <g key={l.id} pointer-events={l.locked ? 'none' : undefined}>
                  {l.shapes.map((shape) => {
                    const d = pathData(shape.paths);
                    return (
                      <g key={shape.id}>
                        <path
                          d={d}
                          fill={shape.fill}
                          stroke={shape.stroke}
                          stroke-width={shape.strokeWidth}
                          opacity={shape.opacity}
                          fill-rule={shape.evenOdd ? 'evenodd' : 'nonzero'}
                          data-id={shape.id}
                        />
                        <path d={d} fill="none" stroke="transparent" stroke-width={Math.max(shape.strokeWidth, 10 * px)} pointer-events="stroke" data-id={shape.id} />
                      </g>
                    );
                  })}
                </g>
              ) : null,
            )}
            {draft && <path d={draft} class="ve-draft" stroke-width={1.5 * px} />}
            {pen?.map((n, index) => (
              <circle key={index} cx={n.x} cy={n.y} r={(index === 0 ? 5 : 3.5) * px} class="ve-node" stroke-width={px} />
            ))}
            {tool !== 'node' &&
              picked.map((shape) => {
                const b = shapeBounds(shape);
                return <rect key={shape.id} x={b.x} y={b.y} width={b.w} height={b.h} class="ve-outline" stroke-width={px} />;
              })}
            {tool === 'select' &&
              box &&
              HANDLES.map(([fx, fy], index) => (
                <rect
                  key={index}
                  x={box.x + box.w * fx - 4 * px}
                  y={box.y + box.h * fy - 4 * px}
                  width={8 * px}
                  height={8 * px}
                  class="ve-handle"
                  stroke-width={px}
                  data-role="resize"
                  data-handle={index}
                />
              ))}
            {tool === 'node' && target && (
              <g>
                <path d={pathData(target.paths)} class="ve-wire" stroke-width={px} />
                {node && nodeAt && (
                  <>
                    {node.hin && <line x1={node.x} y1={node.y} x2={node.hin[0]} y2={node.hin[1]} class="ve-arm" stroke-width={px} />}
                    {node.hout && <line x1={node.x} y1={node.y} x2={node.hout[0]} y2={node.hout[1]} class="ve-arm" stroke-width={px} />}
                    {node.hin && <circle cx={node.hin[0]} cy={node.hin[1]} r={3.5 * px} class="ve-grip" stroke-width={px} data-role="hin" data-path={nodeAt.path} data-node={nodeAt.node} />}
                    {node.hout && <circle cx={node.hout[0]} cy={node.hout[1]} r={3.5 * px} class="ve-grip" stroke-width={px} data-role="hout" data-path={nodeAt.path} data-node={nodeAt.node} />}
                  </>
                )}
                {target.paths.map((path, pathIndex) =>
                  path.nodes.map((n, nodeIndex) => (
                    <rect
                      key={`${pathIndex}-${nodeIndex}`}
                      x={n.x - 4 * px}
                      y={n.y - 4 * px}
                      width={8 * px}
                      height={8 * px}
                      class={`ve-node${nodeAt?.path === pathIndex && nodeAt.node === nodeIndex ? ' is-chosen' : ''}${n.smooth ? ' is-smooth' : ''}`}
                      rx={n.smooth ? 4 * px : 0}
                      stroke-width={px}
                      data-role="node"
                      data-path={pathIndex}
                      data-node={nodeIndex}
                    />
                  )),
                )}
              </g>
            )}
            {gesture?.kind === 'marquee' && (
              <rect
                x={Math.min(gesture.start[0], gesture.now[0])}
                y={Math.min(gesture.start[1], gesture.now[1])}
                width={Math.abs(gesture.now[0] - gesture.start[0])}
                height={Math.abs(gesture.now[1] - gesture.start[1])}
                class="ve-marquee"
                stroke-width={px}
              />
            )}
            {guides.map((guide) =>
              guide.x !== undefined ? (
                <line key={`gx${guide.x}`} x1={guide.x} y1={view.y} x2={guide.x} y2={view.y + size.h / view.zoom} class="ve-guide" stroke-width={px} />
              ) : (
                <line key={`gy${guide.y}`} x1={view.x} y1={guide.y} x2={view.x + size.w / view.zoom} y2={guide.y} class="ve-guide" stroke-width={px} />
              ),
            )}
          </svg>
        </div>

        <aside class="ve-side">
          <div class="ve-panel">
            <strong>Selection</strong>
            {box ? (
              <>
                <div class="ve-fields">
                  {numberField('X', box.x, (x) => setBox({ x }), 've-x')}
                  {numberField('Y', box.y, (y) => setBox({ y }), 've-y')}
                  {numberField('Width', box.w, (w) => setBox({ w }), 've-w', 0)}
                  {numberField('Height', box.h, (h) => setBox({ h }), 've-h', 0)}
                </div>
                {target && (
                  <>
                    <div class="ve-fields">
                      <label class="ve-num">
                        <span class="control-label">Fill</span>
                        <input
                          type="color"
                          value={target.fill === 'none' ? '#ffffff' : target.fill}
                          disabled={target.fill === 'none'}
                          onChange={(e) => {
                            setFill(e.currentTarget.value);
                            style({ fill: e.currentTarget.value });
                          }}
                          data-testid="ve-fill"
                        />
                      </label>
                      <label class="ve-check">
                        <input type="checkbox" checked={target.fill === 'none'} onChange={(e) => style({ fill: e.currentTarget.checked ? 'none' : fill })} data-testid="ve-nofill" />
                        <span>No fill</span>
                      </label>
                      <label class="ve-num">
                        <span class="control-label">Outline</span>
                        <input
                          type="color"
                          value={target.stroke === 'none' ? '#000000' : target.stroke}
                          disabled={target.stroke === 'none'}
                          onChange={(e) => {
                            setStroke(e.currentTarget.value);
                            style({ stroke: e.currentTarget.value });
                          }}
                        />
                      </label>
                      <label class="ve-check">
                        <input type="checkbox" checked={target.stroke === 'none'} onChange={(e) => style({ stroke: e.currentTarget.checked ? 'none' : stroke === 'none' ? '#19222a' : stroke })} />
                        <span>No outline</span>
                      </label>
                    </div>
                    <div class="ve-fields">
                      {numberField('Outline width', target.strokeWidth, (strokeWidth) => style({ strokeWidth: Math.max(0, strokeWidth) }), 've-stroke-width', 0)}
                      <label class="ve-num">
                        <span class="control-label">Opacity</span>
                        <input type="range" min={0} max={1} step={0.05} value={target.opacity} onChange={(e) => style({ opacity: Number(e.currentTarget.value) })} />
                      </label>
                    </div>
                  </>
                )}
              </>
            ) : (
              <p class="tone-muted">Nothing selected. Click a shape, or drag around several.</p>
            )}
          </div>

          {tool === 'node' && (
            <div class="ve-panel" data-testid="ve-node-panel">
              <strong>Nodes</strong>
              {target ? (
                <>
                  <p class="tone-muted">{target.paths.reduce((sum, path) => sum + path.nodes.length, 0)} nodes. Drag a node or its handles; double-click the outline to add a node.</p>
                  <div class="ve-nodes">
                    {target.paths.map((path, pathIndex) =>
                      path.nodes.map((_, nodeIndex) => (
                        <button
                          type="button"
                          key={`${pathIndex}-${nodeIndex}`}
                          class={`button button-small${nodeAt?.path === pathIndex && nodeAt.node === nodeIndex ? ' is-active' : ''}`}
                          aria-pressed={nodeAt?.path === pathIndex && nodeAt.node === nodeIndex}
                          onClick={() => setNodeAt({ path: pathIndex, node: nodeIndex })}
                          data-testid="ve-node-pick"
                        >
                          {target.paths.length > 1 ? `${pathIndex + 1}.` : ''}
                          {nodeIndex + 1}
                        </button>
                      )),
                    )}
                  </div>
                  {node && nodeAt && (
                    <>
                      <div class="ve-fields">
                        {numberField('Node X', node.x, (x) => editPath(nodeAt.path, (path) => moveNode(path, nodeAt.node, x, node.y)), 've-node-x')}
                        {numberField('Node Y', node.y, (y) => editPath(nodeAt.path, (path) => moveNode(path, nodeAt.node, node.x, y)), 've-node-y')}
                      </div>
                      <div class="ve-group">
                        <button type="button" class="button button-small" onClick={() => editPath(nodeAt.path, (path) => setNodeKind(path, nodeAt.node, 'corner'))} data-testid="ve-node-corner">
                          Corner
                        </button>
                        <button type="button" class="button button-small" onClick={() => editPath(nodeAt.path, (path) => setNodeKind(path, nodeAt.node, 'smooth'))} data-testid="ve-node-smooth">
                          Smooth
                        </button>
                        <button type="button" class="button button-small" onClick={() => editPath(nodeAt.path, (path) => splitSegment(path, nodeAt.node, 0.5))} data-testid="ve-node-add">
                          Add a node after
                        </button>
                        <button
                          type="button"
                          class="button button-small"
                          onClick={() => {
                            editPath(nodeAt.path, (path) => deleteNode(path, nodeAt.node));
                            setNodeAt(null);
                          }}
                          data-testid="ve-node-delete"
                        >
                          Delete node
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p class="tone-muted">Select one shape to edit its nodes.</p>
              )}
            </div>
          )}

          <div class="ve-panel" data-testid="ve-layers">
            <div class="ve-panel-head">
              <strong>Layers</strong>
              <button
                type="button"
                class="button button-small"
                onClick={() => {
                  const made = makeLayer(`Layer ${drawing.layers.length + 1}`);
                  editLayers((layers) => [...layers, made]);
                  setActiveLayer(made.id);
                }}
                data-testid="ve-add-layer"
              >
                <Icon name="plus" size={13} /> Layer
              </button>
            </div>
            <ul class="ve-layers">
              {[...drawing.layers].reverse().map((l) => {
                const index = drawing.layers.indexOf(l);
                const swap = (other: number) =>
                  editLayers((layers) => {
                    const neighbour = layers[other];
                    if (!neighbour) return layers;
                    layers[other] = l;
                    layers[index] = neighbour;
                    return layers;
                  });
                const patch = (change: Partial<Layer>) => editLayers((layers) => layers.map((item) => (item.id === l.id ? { ...item, ...change } : item)));
                return (
                  <li key={l.id} class={l.id === layer?.id ? 'is-active' : ''}>
                    <div class="ve-layer">
                      <input type="radio" name="ve-layer" checked={l.id === layer?.id} onChange={() => setActiveLayer(l.id)} aria-label={`Draw on ${l.name}`} />
                      <input class="input" type="text" value={l.name} aria-label="Layer name" onChange={(e) => patch({ name: e.currentTarget.value || l.name })} />
                      <label class="ve-check" title="Shown">
                        <input type="checkbox" checked={l.visible} onChange={(e) => patch({ visible: e.currentTarget.checked })} aria-label={`Show ${l.name}`} />
                        <Icon name="eye" size={13} />
                      </label>
                      <label class="ve-check" title="Locked">
                        <input type="checkbox" checked={l.locked} onChange={(e) => patch({ locked: e.currentTarget.checked })} aria-label={`Lock ${l.name}`} />
                        <span>Lock</span>
                      </label>
                      <button type="button" class="icon-button" disabled={index >= drawing.layers.length - 1} onClick={() => swap(index + 1)} aria-label={`Move ${l.name} up`}>
                        <Icon name="up" size={13} />
                      </button>
                      <button type="button" class="icon-button" disabled={index <= 0} onClick={() => swap(index - 1)} aria-label={`Move ${l.name} down`}>
                        <Icon name="down" size={13} />
                      </button>
                      <button
                        type="button"
                        class="icon-button"
                        disabled={drawing.layers.length < 2}
                        onClick={() => {
                          editLayers((layers) => layers.filter((item) => item.id !== l.id));
                          setSelected([]);
                        }}
                        aria-label={`Delete ${l.name}`}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                    {l.shapes.length > 0 && (
                      <div class="ve-shapes">
                        {[...l.shapes].reverse().map((shape) => (
                          <button
                            type="button"
                            key={shape.id}
                            class={`link-button${chosen.has(shape.id) ? ' is-chosen' : ''}`}
                            disabled={l.locked || !l.visible}
                            onClick={(e) => setSelected(e.shiftKey ? (chosen.has(shape.id) ? selected.filter((s) => s !== shape.id) : [...selected, shape.id]) : [shape.id])}
                            data-testid="ve-shape"
                          >
                            {shape.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              class="button button-small"
              disabled={!picked.length || !layer || layer.locked}
              onClick={() => {
                if (!layer) return;
                const moving = picked;
                commit({
                  ...drawing,
                  layers: drawing.layers.map((l) =>
                    l.id === layer.id ? { ...l, shapes: [...l.shapes.filter((s) => !chosen.has(s.id)), ...moving] } : { ...l, shapes: l.shapes.filter((s) => !chosen.has(s.id)) },
                  ),
                });
              }}
            >
              Move the selection to the active layer
            </button>
          </div>

          <div class="ve-panel">
            <strong>Page</strong>
            <div class="ve-fields">
              {numberField('Width', drawing.width, (width) => width > 0 && commit({ ...drawing, width }), 've-page-w', 1)}
              {numberField('Height', drawing.height, (height) => height > 0 && commit({ ...drawing, height }), 've-page-h', 1)}
              <label class="ve-num">
                <span class="control-label">Units</span>
                <select class="input" value={drawing.unit} onChange={(e) => commit({ ...drawing, unit: e.currentTarget.value as 'px' | 'mm' })}>
                  <option value="px">pixels</option>
                  <option value="mm">millimetres</option>
                </select>
              </label>
            </div>
            <p class="tone-muted">DXF is written in millimetres{drawing.unit === 'px' ? ' (96 pixels to the inch)' : ''}, curves as fine polylines, one DXF layer per layer.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default defineCustomTool(Component);
