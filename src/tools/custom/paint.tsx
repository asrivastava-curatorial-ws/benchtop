/**
 * Paint: a pixel editor in the manner of the classic Windows Paint.
 * Pencil, brush, eraser, airbrush, fill with a tolerance, colour picker,
 * text, lines and shapes, and a rectangular selection that moves, copies,
 * cuts, pastes and crops; primary and secondary colours (left and right
 * button); resize, canvas size, rotate, flip and invert; 30 steps of undo;
 * zoom to 800% with a pixel grid; open any picture and save PNG, JPEG,
 * WebP or BMP.
 */
import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { discSpans, encodeBmp, flip, floodFill, hexToRgba, invert, linePixels, PALETTE, type Pixels, rgbaToHex, rotate } from '../../lib/paint';
import { pickFile, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

type Tool = 'select' | 'pencil' | 'brush' | 'eraser' | 'airbrush' | 'fill' | 'picker' | 'text' | 'line' | 'rect' | 'ellipse' | 'rounded';
type ShapeStyle = 'outline' | 'fill' | 'both';

interface PaintSettings {
  readonly tool: Tool;
  readonly primary: string;
  readonly secondary: string;
  readonly size: number;
  readonly style: ShapeStyle;
  readonly tolerance: number;
  readonly zoom: number;
  readonly grid: boolean;
  readonly font: string;
  readonly fontSize: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly opaqueText: boolean;
}

const TOOLS: readonly { id: Tool; name: string; key: string; draw: JSX.Element }[] = [
  { id: 'select', name: 'Select', key: 's', draw: <rect x="2.5" y="3.5" width="11" height="9" fill="none" stroke="currentColor" stroke-dasharray="2 1.5" /> },
  { id: 'pencil', name: 'Pencil', key: 'p', draw: <path d="M3 13l1-3 7-7 2 2-7 7-3 1z" fill="none" stroke="currentColor" stroke-linejoin="round" /> },
  { id: 'brush', name: 'Brush', key: 'b', draw: <path d="M10 2l4 4-5 5-2-2zM6 10l2 2c-1 2-3 2-5 2 1-1 1-3 3-4z" fill="currentColor" /> },
  { id: 'eraser', name: 'Eraser', key: 'e', draw: <path d="M2 10l6-6 6 6-3 3H5zM5 13h9" fill="none" stroke="currentColor" stroke-linejoin="round" /> },
  { id: 'airbrush', name: 'Airbrush', key: 'a', draw: <path d="M4 7h5v7H4zM6 7V5h1v2M10 4l2-1M10 6h3M10 8l2 1" fill="none" stroke="currentColor" /> },
  { id: 'fill', name: 'Fill', key: 'f', draw: <path d="M7 2l5 5-5 5-5-5zM13 9c1 2 1 3 0 4-1 0-1-2 0-4z" fill="none" stroke="currentColor" stroke-linejoin="round" /> },
  { id: 'picker', name: 'Colour picker', key: 'i', draw: <path d="M11 2l3 3-2 2-3-3zM9 4l-6 6v3h3l6-6" fill="none" stroke="currentColor" stroke-linejoin="round" /> },
  {
    id: 'text',
    name: 'Text',
    key: 't',
    draw: (
      <text x="8" y="13" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">
        A
      </text>
    ),
  },
  { id: 'line', name: 'Line', key: 'l', draw: <path d="M3 13L13 3" stroke="currentColor" stroke-width="1.5" /> },
  { id: 'rect', name: 'Rectangle', key: 'r', draw: <rect x="2.5" y="4.5" width="11" height="8" fill="none" stroke="currentColor" /> },
  { id: 'ellipse', name: 'Ellipse', key: 'o', draw: <ellipse cx="8" cy="8.5" rx="5.5" ry="4.5" fill="none" stroke="currentColor" /> },
  { id: 'rounded', name: 'Rounded rectangle', key: 'u', draw: <rect x="2.5" y="4.5" width="11" height="8" rx="3" fill="none" stroke="currentColor" /> },
];

const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8];
const FONTS = ['sans-serif', 'serif', 'monospace', 'cursive', 'JetBrains Mono', 'Noto Sans Devanagari'];
const MAX_SIDE = 8192;
const HISTORY = 30;
const HISTORY_BYTES = 512 * 1024 * 1024;

const read = (v: Values | undefined): PaintSettings => ({
  tool: TOOLS.some((t) => t.id === v?.tool) ? (v?.tool as Tool) : 'pencil',
  primary: typeof v?.primary === 'string' && /^#[0-9a-f]{6}$/i.test(v.primary) ? v.primary : '#000000',
  secondary: typeof v?.secondary === 'string' && /^#[0-9a-f]{6}$/i.test(v.secondary) ? v.secondary : '#ffffff',
  size: typeof v?.size === 'number' && v.size >= 1 && v.size <= 100 ? Math.round(v.size) : 3,
  style: v?.style === 'fill' || v?.style === 'both' ? v.style : 'outline',
  tolerance: typeof v?.tolerance === 'number' && v.tolerance >= 0 && v.tolerance <= 255 ? v.tolerance : 24,
  zoom: ZOOMS.includes(Number(v?.zoom)) ? Number(v?.zoom) : 1,
  grid: v?.grid === true,
  font: typeof v?.font === 'string' && FONTS.includes(v.font) ? v.font : 'sans-serif',
  fontSize: typeof v?.fontSize === 'number' && v.fontSize >= 6 && v.fontSize <= 300 ? v.fontSize : 24,
  bold: v?.bold === true,
  italic: v?.italic === true,
  opaqueText: v?.opaqueText === true,
});
const write = (s: PaintSettings): Values => ({ ...s }) as unknown as Values;

/** The picture stays while Benchtop is open, across tools. */
let kept: { width: number; height: number; data: Uint8ClampedArray } | null = null;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Floating {
  readonly canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

interface TextBox {
  readonly x: number;
  readonly y: number;
  readonly value: string;
}

const normRect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 });

function Paint({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState(toolId, read, write);
  const set = <K extends keyof PaintSettings>(key: K, value: PaintSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const doc = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: kept?.width ?? 800, height: kept?.height ?? 560 });
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [textBox, setTextBox] = useState<TextBox | null>(null);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const [dialog, setDialog] = useState<'resize' | 'canvas' | 'new' | null>(null);
  const undo = useRef<ImageData[]>([]);
  const redo = useRef<ImageData[]>([]);
  const floating = useRef<Floating | null>(null);
  const clipboard = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ button: number; x0: number; y0: number; x: number; y: number; mode: 'draw' | 'shape' | 'select' | 'move'; ox: number; oy: number } | null>(null);
  const spray = useRef(0);
  const previousTool = useRef<Tool>('pencil');
  const latest = useRef(settings);
  latest.current = settings;

  const ctx = () => doc.current?.getContext('2d', { willReadFrequently: true }) ?? null;
  const octx = () => overlay.current?.getContext('2d') ?? null;

  // First picture: the kept one, or white.
  useEffect(() => {
    const c = ctx();
    if (!c || !doc.current) return;
    // The canvases' pixel sizes are set here and by the image commands only: setting a
    // canvas's width, even to the same value, wipes it, so they are not render props.
    doc.current.width = size.width;
    doc.current.height = size.height;
    if (overlay.current) {
      overlay.current.width = size.width;
      overlay.current.height = size.height;
    }
    if (kept && kept.width === size.width && kept.height === size.height) c.putImageData(new ImageData(new Uint8ClampedArray(kept.data), kept.width, kept.height), 0, 0);
    else {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, size.width, size.height);
    }
  }, []);

  const keep = () => {
    const c = ctx();
    if (!c || !doc.current) return;
    kept = { width: doc.current.width, height: doc.current.height, data: c.getImageData(0, 0, doc.current.width, doc.current.height).data };
  };
  useEffect(() => keep, []);

  /** Saves the picture for undo before a change. */
  const remember = () => {
    const c = ctx();
    if (!c || !doc.current) return;
    undo.current.push(c.getImageData(0, 0, doc.current.width, doc.current.height));
    const bytes = doc.current.width * doc.current.height * 4;
    const depth = Math.max(2, Math.min(HISTORY, Math.floor(HISTORY_BYTES / Math.max(1, bytes))));
    while (undo.current.length > depth) undo.current.shift();
    redo.current = [];
    setCounts({ undo: undo.current.length, redo: 0 });
  };

  const restore = (img: ImageData) => {
    if (!doc.current || !overlay.current) return;
    doc.current.width = img.width;
    doc.current.height = img.height;
    overlay.current.width = img.width;
    overlay.current.height = img.height;
    ctx()?.putImageData(img, 0, 0);
    setSize({ width: img.width, height: img.height });
    keep();
  };

  const step = (back: boolean) => {
    commitFloating();
    const c = ctx();
    if (!c || !doc.current) return;
    const from = back ? undo.current : redo.current;
    const to = back ? redo.current : undo.current;
    const img = from.pop();
    if (!img) return;
    to.push(c.getImageData(0, 0, doc.current.width, doc.current.height));
    restore(img);
    setSelection(null);
    setCounts({ undo: undo.current.length, redo: redo.current.length });
  };

  /* ------------------------------------------------------------ drawing -- */

  const colourFor = (button: number, swap = false) => {
    const s = latest.current;
    return (button === 2) !== swap ? s.secondary : s.primary;
  };

  const stamp = (c: CanvasRenderingContext2D, x: number, y: number, diameter: number) => {
    for (const [a, b, dy] of discSpans(diameter)) c.fillRect(x + a, y + dy, b - a + 1, 1);
  };

  const paintSegment = (x0: number, y0: number, x1: number, y1: number, button: number) => {
    const c = ctx();
    if (!c) return;
    const s = latest.current;
    if (s.tool === 'pencil') {
      c.fillStyle = colourFor(button);
      linePixels(x0, y0, x1, y1, (x, y) => c.fillRect(x, y, 1, 1));
    } else if (s.tool === 'brush') {
      c.fillStyle = colourFor(button);
      linePixels(x0, y0, x1, y1, (x, y) => stamp(c, x, y, s.size));
    } else if (s.tool === 'eraser') {
      c.fillStyle = colourFor(button, true);
      const side = Math.max(2, s.size * 2);
      linePixels(x0, y0, x1, y1, (x, y) => c.fillRect(x - Math.floor(side / 2), y - Math.floor(side / 2), side, side));
    }
  };

  const sprayAt = (x: number, y: number, button: number) => {
    const c = ctx();
    if (!c) return;
    const s = latest.current;
    const r = Math.max(4, s.size * 3);
    c.fillStyle = colourFor(button);
    for (let i = 0; i < Math.max(6, r); i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      c.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), 1, 1);
    }
  };

  /** A shape from (x0, y0) to (x1, y1) on a context; Shift makes squares, circles and 45° lines. */
  const shape = (c: CanvasRenderingContext2D, tool: Tool, x0: number, y0: number, x1i: number, y1i: number, button: number, shift: boolean) => {
    const s = latest.current;
    let x1 = x1i;
    let y1 = y1i;
    if (shift) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (tool === 'line') {
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const length = Math.hypot(dx, dy);
        x1 = Math.round(x0 + Math.cos(angle) * length);
        y1 = Math.round(y0 + Math.sin(angle) * length);
      } else {
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        x1 = x0 + Math.sign(dx || 1) * side;
        y1 = y0 + Math.sign(dy || 1) * side;
      }
    }
    const stroke = colourFor(button);
    const fill = colourFor(button, true);
    c.lineWidth = s.size;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = stroke;
    c.fillStyle = fill;
    if (tool === 'line') {
      if (s.size === 1) {
        c.fillStyle = stroke;
        linePixels(x0, y0, x1, y1, (x, y) => c.fillRect(x, y, 1, 1));
      } else {
        c.beginPath();
        c.moveTo(x0 + 0.5, y0 + 0.5);
        c.lineTo(x1 + 0.5, y1 + 0.5);
        c.stroke();
      }
      return;
    }
    const r = normRect(x0, y0, x1, y1);
    // Strokes sit inside the drawn box, as in Paint.
    const inset = s.style === 'fill' ? 0 : s.size / 2;
    const x = r.x + inset;
    const y = r.y + inset;
    const w = Math.max(0, r.w - inset * 2);
    const h = Math.max(0, r.h - inset * 2);
    c.beginPath();
    if (tool === 'rect') c.rect(x, y, w, h);
    else if (tool === 'rounded') c.roundRect(x, y, w, h, Math.min(w, h, Math.max(8, s.size * 4)) / 2);
    else c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (s.style !== 'outline') c.fill();
    if (s.style !== 'fill') c.stroke();
  };

  /* -------------------------------------------------------- selections -- */

  const drawOverlay = useCallback(() => {
    const o = octx();
    if (!o || !overlay.current) return;
    o.clearRect(0, 0, overlay.current.width, overlay.current.height);
    const f = floating.current;
    if (f) o.drawImage(f.canvas, f.x, f.y);
  }, []);

  function commitFloating() {
    const f = floating.current;
    if (!f) return;
    ctx()?.drawImage(f.canvas, f.x, f.y);
    floating.current = null;
    drawOverlay();
    keep();
  }

  /** Lifts the selected pixels into a floating layer, leaving the secondary colour behind. */
  const lift = (r: Rect) => {
    const c = ctx();
    if (!c || floating.current) return;
    remember();
    const piece = document.createElement('canvas');
    piece.width = r.w;
    piece.height = r.h;
    piece.getContext('2d')?.putImageData(c.getImageData(r.x, r.y, r.w, r.h), 0, 0);
    c.fillStyle = latest.current.secondary;
    c.fillRect(r.x, r.y, r.w, r.h);
    floating.current = { canvas: piece, x: r.x, y: r.y };
    drawOverlay();
  };

  const selectionCanvas = (): HTMLCanvasElement | null => {
    if (floating.current) return floating.current.canvas;
    const c = ctx();
    if (!c || !selection) return null;
    const piece = document.createElement('canvas');
    piece.width = selection.w;
    piece.height = selection.h;
    piece.getContext('2d')?.putImageData(c.getImageData(selection.x, selection.y, selection.w, selection.h), 0, 0);
    return piece;
  };

  const copy = async () => {
    const piece = selectionCanvas() ?? doc.current;
    if (!piece) return;
    const own = document.createElement('canvas');
    own.width = piece.width;
    own.height = piece.height;
    own.getContext('2d')?.drawImage(piece, 0, 0);
    clipboard.current = own;
    try {
      const blob = await new Promise<Blob | null>((resolve) => own.toBlob(resolve, 'image/png'));
      if (blob && 'ClipboardItem' in window) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      // The system clipboard may refuse; Paint's own clipboard still holds the copy.
    }
  };

  const erase = () => {
    const c = ctx();
    if (floating.current) {
      floating.current = null;
      drawOverlay();
    } else if (c && selection) {
      remember();
      c.fillStyle = latest.current.secondary;
      c.fillRect(selection.x, selection.y, selection.w, selection.h);
    }
    setSelection(null);
    keep();
  };

  /** Puts a picture in as a floating selection at the top left of the view. */
  const pasteCanvas = (piece: HTMLCanvasElement) => {
    commitFloating();
    remember();
    const view = stage.current;
    const z = latest.current.zoom;
    const x = view ? Math.floor(view.scrollLeft / z) : 0;
    const y = view ? Math.floor(view.scrollTop / z) : 0;
    // A picture bigger than the canvas makes the canvas bigger, as in Paint.
    if (doc.current && (piece.width + x > doc.current.width || piece.height + y > doc.current.height)) {
      resizeCanvas(Math.max(doc.current.width, piece.width + x), Math.max(doc.current.height, piece.height + y), false);
    }
    floating.current = { canvas: piece, x, y };
    setSelection({ x, y, w: piece.width, h: piece.height });
    set('tool', 'select');
    drawOverlay();
  };

  const imageToCanvas = async (blob: Blob): Promise<HTMLCanvasElement> => {
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width > MAX_SIDE || bitmap.height > MAX_SIDE) throw new Error(`The picture is larger than ${MAX_SIDE} × ${MAX_SIDE} pixels.`);
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return c;
  };

  const crop = () => {
    const piece = selectionCanvas();
    if (!piece) return;
    floating.current = null;
    remember();
    const c = ctx();
    if (!c || !doc.current || !overlay.current) return;
    doc.current.width = piece.width;
    doc.current.height = piece.height;
    overlay.current.width = piece.width;
    overlay.current.height = piece.height;
    c.drawImage(piece, 0, 0);
    setSize({ width: piece.width, height: piece.height });
    setSelection(null);
    drawOverlay();
    keep();
  };

  /* ------------------------------------------------------ image changes -- */

  const pixels = (): Pixels | null => {
    const c = ctx();
    if (!c || !doc.current) return null;
    const img = c.getImageData(0, 0, doc.current.width, doc.current.height);
    return { width: img.width, height: img.height, data: img.data };
  };

  const apply = (change: (p: Pixels) => Pixels) => {
    commitFloating();
    const p = pixels();
    if (!p) return;
    remember();
    const out = change(p);
    restore(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height));
    setSelection(null);
  };

  function resizeCanvas(width: number, height: number, record = true) {
    const c = ctx();
    if (!c || !doc.current || !overlay.current) return;
    if (record) remember();
    const old = c.getImageData(0, 0, doc.current.width, doc.current.height);
    doc.current.width = width;
    doc.current.height = height;
    overlay.current.width = width;
    overlay.current.height = height;
    c.fillStyle = latest.current.secondary;
    c.fillRect(0, 0, width, height);
    c.putImageData(old, 0, 0);
    setSize({ width, height });
    drawOverlay();
    keep();
  }

  const stretch = (width: number, height: number) => {
    commitFloating();
    if (!doc.current || !overlay.current) return;
    remember();
    const copyOf = document.createElement('canvas');
    copyOf.width = doc.current.width;
    copyOf.height = doc.current.height;
    copyOf.getContext('2d')?.drawImage(doc.current, 0, 0);
    doc.current.width = width;
    doc.current.height = height;
    overlay.current.width = width;
    overlay.current.height = height;
    const c = ctx();
    if (!c) return;
    c.imageSmoothingQuality = 'high';
    c.drawImage(copyOf, 0, 0, width, height);
    setSize({ width, height });
    setSelection(null);
    keep();
  };

  const newPicture = (width: number, height: number) => {
    commitFloating();
    remember();
    resizeCanvas(width, height, false);
    const c = ctx();
    if (!c) return;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, width, height);
    setSelection(null);
    keep();
  };

  /* ---------------------------------------------------------- pointers -- */

  const at = (e: PointerEvent) => {
    const rect = overlay.current?.getBoundingClientRect();
    const z = latest.current.zoom;
    if (!rect) return { x: 0, y: 0 };
    return { x: Math.floor((e.clientX - rect.left) / z), y: Math.floor((e.clientY - rect.top) / z) };
  };

  const inside = (r: Rect | null, x: number, y: number) => r !== null && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

  const commitText = () => {
    if (!textBox) return;
    const s = latest.current;
    const c = ctx();
    if (c && textBox.value.trim()) {
      remember();
      c.font = `${s.italic ? 'italic ' : ''}${s.bold ? '700 ' : ''}${s.fontSize}px ${s.font}`;
      c.textBaseline = 'top';
      const lines = textBox.value.split('\n');
      const lineHeight = Math.round(s.fontSize * 1.25);
      if (s.opaqueText) {
        const width = Math.max(...lines.map((l) => c.measureText(l).width));
        c.fillStyle = s.secondary;
        c.fillRect(textBox.x, textBox.y, Math.ceil(width) + 2, lineHeight * lines.length);
      }
      c.fillStyle = s.primary;
      lines.forEach((l, i) => {
        c.fillText(l, textBox.x + 1, textBox.y + i * lineHeight + Math.round(s.fontSize * 0.1));
      });
      keep();
    }
    setTextBox(null);
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const s = latest.current;
    const { x, y } = at(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (s.tool !== 'text' && textBox) commitText();
    if (s.tool !== 'select') {
      commitFloating();
      setSelection(null);
    }
    switch (s.tool) {
      case 'pencil':
      case 'brush':
      case 'eraser':
        remember();
        paintSegment(x, y, x, y, e.button);
        drag.current = { button: e.button, x0: x, y0: y, x, y, mode: 'draw', ox: 0, oy: 0 };
        break;
      case 'airbrush':
        remember();
        sprayAt(x, y, e.button);
        drag.current = { button: e.button, x0: x, y0: y, x, y, mode: 'draw', ox: 0, oy: 0 };
        spray.current = window.setInterval(() => {
          const d = drag.current;
          if (d) sprayAt(d.x, d.y, d.button);
        }, 40);
        break;
      case 'fill': {
        const p = pixels();
        if (!p) break;
        remember();
        const [r, g, b] = hexToRgba(colourFor(e.button));
        if (floodFill(p, x, y, [r, g, b, 255], s.tolerance) > 0) ctx()?.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
        else {
          undo.current.pop();
          setCounts({ undo: undo.current.length, redo: redo.current.length });
        }
        keep();
        break;
      }
      case 'picker': {
        const c = ctx();
        if (!c || !doc.current || x < 0 || y < 0 || x >= doc.current.width || y >= doc.current.height) break;
        const [r, g, b] = c.getImageData(x, y, 1, 1).data;
        set(e.button === 2 ? 'secondary' : 'primary', rgbaToHex(r ?? 0, g ?? 0, b ?? 0));
        set('tool', previousTool.current === 'picker' ? 'pencil' : previousTool.current);
        break;
      }
      case 'text':
        if (textBox) commitText();
        else setTextBox({ x, y, value: '' });
        break;
      case 'select':
        if (inside(selection, x, y)) {
          if (!floating.current && selection) lift(selection);
          const f = floating.current as Floating | null;
          drag.current = { button: e.button, x0: x, y0: y, x, y, mode: 'move', ox: f?.x ?? 0, oy: f?.y ?? 0 };
        } else {
          commitFloating();
          setSelection(null);
          drag.current = { button: e.button, x0: x, y0: y, x, y, mode: 'select', ox: 0, oy: 0 };
        }
        break;
      default:
        drag.current = { button: e.button, x0: x, y0: y, x, y, mode: 'shape', ox: 0, oy: 0 };
    }
  };

  const onMove = (e: PointerEvent) => {
    const { x, y } = at(e);
    setPointer({ x, y });
    const d = drag.current;
    if (!d) return;
    const s = latest.current;
    if (d.mode === 'draw') {
      if (s.tool !== 'airbrush') paintSegment(d.x, d.y, x, y, d.button);
      d.x = x;
      d.y = y;
    } else if (d.mode === 'shape') {
      d.x = x;
      d.y = y;
      const o = octx();
      if (!o || !overlay.current) return;
      o.clearRect(0, 0, overlay.current.width, overlay.current.height);
      shape(o, s.tool, d.x0, d.y0, x, y, d.button, e.shiftKey);
    } else if (d.mode === 'select') {
      d.x = x;
      d.y = y;
      const w = size.width;
      const h = size.height;
      const cx = (v: number, max: number) => Math.min(Math.max(v, 0), max - 1);
      setSelection(normRect(cx(d.x0, w), cx(d.y0, h), cx(x, w), cx(y, h)));
    } else {
      const f = floating.current;
      if (!f) return;
      f.x = d.ox + (x - d.x0);
      f.y = d.oy + (y - d.y0);
      setSelection({ x: f.x, y: f.y, w: f.canvas.width, h: f.canvas.height });
      drawOverlay();
    }
  };

  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    window.clearInterval(spray.current);
    if (!d) return;
    if (d.mode === 'shape') {
      const o = octx();
      if (o && overlay.current) o.clearRect(0, 0, overlay.current.width, overlay.current.height);
      const c = ctx();
      if (c) {
        remember();
        shape(c, latest.current.tool, d.x0, d.y0, d.x, d.y, d.button, e.shiftKey);
      }
      drawOverlay();
    } else if (d.mode === 'select' && d.x === d.x0 && d.y === d.y0) setSelection(null);
    keep();
  };

  /* ---------------------------------------------------------- keyboard -- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (!stage.current?.closest('.pa-tool')?.isConnected) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        step(!e.shiftKey);
      } else if (mod && key === 'y') {
        e.preventDefault();
        step(false);
      } else if (mod && key === 'a') {
        e.preventDefault();
        commitFloating();
        set('tool', 'select');
        setSelection({ x: 0, y: 0, w: size.width, h: size.height });
      } else if (mod && (key === 'c' || key === 'x')) {
        e.preventDefault();
        void copy().then(() => {
          if (key === 'x') erase();
        });
      } else if (mod && key === 'v') {
        // The paste event below brings the system clipboard; Paint's own copy is the fallback.
        if (clipboard.current && !navigator.clipboard?.read) {
          e.preventDefault();
          const piece = document.createElement('canvas');
          piece.width = clipboard.current.width;
          piece.height = clipboard.current.height;
          piece.getContext('2d')?.drawImage(clipboard.current, 0, 0);
          pasteCanvas(piece);
        }
      } else if (key === 'delete' && (selection || floating.current)) {
        e.preventDefault();
        erase();
      } else if (key === 'escape') {
        commitFloating();
        setSelection(null);
      } else if (!mod && !e.altKey) {
        const tool = TOOLS.find((t) => t.key === key);
        if (tool) {
          commitFloating();
          set('tool', tool.id);
        }
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void attempt(async () => pasteCanvas(await imageToCanvas(file)));
      } else if (clipboard.current) {
        e.preventDefault();
        const piece = document.createElement('canvas');
        piece.width = clipboard.current.width;
        piece.height = clipboard.current.height;
        piece.getContext('2d')?.drawImage(clipboard.current, 0, 0);
        pasteCanvas(piece);
      }
    };
    addEventListener('keydown', onKey);
    addEventListener('paste', onPaste);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('paste', onPaste);
    };
  });

  /* -------------------------------------------------------------- files -- */

  const open = () =>
    attempt(async () => {
      const file = await pickFile('image/*,.bmp,.ico');
      if (!file) return;
      const piece = await imageToCanvas(file);
      commitFloating();
      remember();
      resizeCanvas(piece.width, piece.height, false);
      ctx()?.drawImage(piece, 0, 0);
      setSelection(null);
      keep();
      notify(`Opened ${file.name}`);
    });

  const save = (format: 'png' | 'jpeg' | 'webp' | 'bmp') =>
    attempt(async () => {
      commitFloating();
      const canvas = doc.current;
      if (!canvas) return;
      let data: Blob | Uint8Array;
      if (format === 'bmp') {
        const p = pixels();
        if (!p) return;
        data = encodeBmp(p);
      } else {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, `image/${format}`, 0.92));
        if (!blob) throw new Error('The picture could not be encoded.');
        data = blob;
      }
      const outcome = await saveFile(`picture.${format === 'jpeg' ? 'jpg' : format}`, data, format === 'bmp' ? 'image/bmp' : `image/${format}`);
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });

  /* ------------------------------------------------------------- render -- */

  const z = settings.zoom;
  const cursor = settings.tool === 'text' ? 'text' : settings.tool === 'select' ? (inside(selection, pointer?.x ?? -1, pointer?.y ?? -1) ? 'move' : 'crosshair') : 'crosshair';
  const tool = TOOLS.find((t) => t.id === settings.tool);

  return (
    <section class="tool pa-tool" data-testid="tool" data-state={counts.undo > 0 ? 'done' : 'idle'}>
      <div class="pa-ribbon">
        <div class="pa-group" role="group" aria-label="File">
          <button type="button" class="button button-small" onClick={() => setDialog('new')} data-testid="pa-new">
            New
          </button>
          <button type="button" class="button button-small" onClick={open} data-testid="pa-open">
            <Icon name="open" size={13} /> Open…
          </button>
          <span class="pa-save">
            <span class="control-label">Save as</span>
            {(['png', 'jpeg', 'webp', 'bmp'] as const).map((f) => (
              <button key={f} type="button" class="button button-small" onClick={() => save(f)} data-testid={`pa-save-${f}`}>
                {f === 'jpeg' ? 'JPEG' : f.toUpperCase()}
              </button>
            ))}
          </span>
        </div>
        <div class="pa-group" role="group" aria-label="Edit">
          <button type="button" class="button button-small" onClick={() => step(true)} disabled={counts.undo === 0} title="Undo (Ctrl+Z)" data-testid="pa-undo">
            Undo
          </button>
          <button type="button" class="button button-small" onClick={() => step(false)} disabled={counts.redo === 0} title="Redo (Ctrl+Y)">
            Redo
          </button>
          <button type="button" class="button button-small" onClick={() => void copy()} title="Copy the selection, or the whole picture (Ctrl+C)">
            Copy
          </button>
          <button type="button" class="button button-small" onClick={crop} disabled={!selection} data-testid="pa-crop">
            Crop
          </button>
        </div>
        <div class="pa-group" role="group" aria-label="Image">
          <button type="button" class="button button-small" onClick={() => setDialog('resize')}>
            Resize…
          </button>
          <button type="button" class="button button-small" onClick={() => setDialog('canvas')}>
            Canvas size…
          </button>
          <button type="button" class="button button-small" onClick={() => apply((p) => rotate(p, 1))} title="Rotate right 90°" data-testid="pa-rotate">
            <Icon name="rotate-right" size={13} />
          </button>
          <button type="button" class="button button-small" onClick={() => apply((p) => rotate(p, 3))} title="Rotate left 90°">
            <Icon name="rotate-left" size={13} />
          </button>
          <button type="button" class="button button-small" onClick={() => apply((p) => flip(p, true))} title="Flip horizontally">
            Flip ↔
          </button>
          <button type="button" class="button button-small" onClick={() => apply((p) => flip(p, false))} title="Flip vertically">
            Flip ↕
          </button>
          <button type="button" class="button button-small" onClick={() => apply(invert)} data-testid="pa-invert">
            Invert
          </button>
        </div>
        <div class="pa-group" role="group" aria-label="View">
          <label class="pa-field">
            <span class="control-label">Zoom</span>
            <select class="select select-small" value={String(z)} onChange={(e) => set('zoom', Number(e.currentTarget.value))} data-testid="pa-zoom">
              {ZOOMS.map((v) => (
                <option key={v} value={v}>
                  {v * 100}%
                </option>
              ))}
            </select>
          </label>
          <label class="check">
            <input type="checkbox" checked={settings.grid} onChange={(e) => set('grid', e.currentTarget.checked)} /> Grid
          </label>
        </div>
      </div>

      <div class="pa-main">
        <div class="pa-tools" role="toolbar" aria-label="Tools" aria-orientation="vertical">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              class={`pa-tool-button${settings.tool === t.id ? ' is-active' : ''}`}
              aria-pressed={settings.tool === t.id}
              title={`${t.name} (${t.key.toUpperCase()})`}
              aria-label={t.name}
              onClick={() => {
                commitFloating();
                if (textBox) commitText();
                if (t.id === 'picker') previousTool.current = settings.tool;
                set('tool', t.id);
              }}
              data-testid={`pa-tool-${t.id}`}
            >
              <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
                {t.draw}
              </svg>
            </button>
          ))}
        </div>

        <div
          class="pa-stage"
          ref={stage}
          role="region"
          aria-label="Picture (scroll with the arrow keys when it is larger than the window)"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable from the keyboard
          tabIndex={0}
        >
          <div class="pa-paper" style={{ width: `${size.width * z}px`, height: `${size.height * z}px` }}>
            <canvas ref={doc} class="pa-canvas" style={{ width: `${size.width * z}px`, height: `${size.height * z}px` }} data-testid="pa-canvas" />
            <canvas
              ref={overlay}
              class="pa-canvas pa-overlay"
              style={{ width: `${size.width * z}px`, height: `${size.height * z}px`, cursor }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={() => setPointer(null)}
              onContextMenu={(e) => e.preventDefault()}
              data-testid="pa-surface"
            />
            {settings.grid && z >= 4 && <div class="pa-grid" style={{ backgroundSize: `${z}px ${z}px` }} />}
            {selection && (
              <div
                class="pa-selection"
                style={{ left: `${selection.x * z}px`, top: `${selection.y * z}px`, width: `${selection.w * z}px`, height: `${selection.h * z}px` }}
                data-testid="pa-selection"
              />
            )}
            {textBox && (
              <textarea
                class="pa-textbox"
                style={{
                  left: `${textBox.x * z}px`,
                  top: `${textBox.y * z}px`,
                  font: `${settings.italic ? 'italic ' : ''}${settings.bold ? '700 ' : ''}${settings.fontSize * z}px/${1.25} ${settings.font}`,
                  color: settings.primary,
                  background: settings.opaqueText ? settings.secondary : 'transparent',
                }}
                value={textBox.value}
                // biome-ignore lint/a11y/noAutofocus: the box appears where the user clicked to type.
                autoFocus
                aria-label="Text to place"
                onInput={(e) => setTextBox({ ...textBox, value: e.currentTarget.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setTextBox(null);
                  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitText();
                }}
                data-testid="pa-text"
              />
            )}
          </div>
        </div>

        <div class="pa-options">
          <span class="control-label">{tool?.name}</span>
          {(settings.tool === 'brush' ||
            settings.tool === 'eraser' ||
            settings.tool === 'airbrush' ||
            settings.tool === 'line' ||
            settings.tool === 'rect' ||
            settings.tool === 'ellipse' ||
            settings.tool === 'rounded') && (
            <label class="pa-field">
              <span class="control-label">Size: {settings.size}px</span>
              <input type="range" min={1} max={50} value={settings.size} onInput={(e) => set('size', Number(e.currentTarget.value))} data-testid="pa-size" />
            </label>
          )}
          {(settings.tool === 'rect' || settings.tool === 'ellipse' || settings.tool === 'rounded') && (
            <label class="pa-field">
              <span class="control-label">Shape</span>
              <select class="select select-small" value={settings.style} onChange={(e) => set('style', e.currentTarget.value as ShapeStyle)} data-testid="pa-style">
                <option value="outline">Outline (primary colour)</option>
                <option value="fill">Fill (secondary colour)</option>
                <option value="both">Outline and fill</option>
              </select>
            </label>
          )}
          {settings.tool === 'fill' && (
            <label class="pa-field">
              <span class="control-label">Tolerance: {settings.tolerance}</span>
              <input type="range" min={0} max={128} value={settings.tolerance} onInput={(e) => set('tolerance', Number(e.currentTarget.value))} />
            </label>
          )}
          {settings.tool === 'text' && (
            <>
              <label class="pa-field">
                <span class="control-label">Font</span>
                <select class="select select-small" value={settings.font} onChange={(e) => set('font', e.currentTarget.value)}>
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label class="pa-field">
                <span class="control-label">Size (px)</span>
                <input
                  type="number"
                  class="input input-number"
                  min={6}
                  max={300}
                  value={settings.fontSize}
                  onChange={(e) => set('fontSize', Math.min(300, Math.max(6, Number(e.currentTarget.value) || 24)))}
                />
              </label>
              <label class="check">
                <input type="checkbox" checked={settings.bold} onChange={(e) => set('bold', e.currentTarget.checked)} /> Bold
              </label>
              <label class="check">
                <input type="checkbox" checked={settings.italic} onChange={(e) => set('italic', e.currentTarget.checked)} /> Italic
              </label>
              <label class="check">
                <input type="checkbox" checked={settings.opaqueText} onChange={(e) => set('opaqueText', e.currentTarget.checked)} /> Background in the secondary colour
              </label>
              {textBox && (
                <button type="button" class="button button-small button-primary" onClick={commitText} data-testid="pa-text-done">
                  Place text
                </button>
              )}
            </>
          )}
          {settings.tool === 'select' && (
            <p class="pa-hint">Drag to select; drag inside to move. Ctrl+C, Ctrl+X, Ctrl+V and Delete work on the selection; paste brings in pictures from other programs.</p>
          )}
          {settings.tool === 'picker' && <p class="pa-hint">Click for the primary colour, right-click for the secondary.</p>}
        </div>
      </div>

      <div class="pa-colours">
        <div class="pa-current" role="group" aria-label="Current colours">
          <label class="pa-swatch pa-primary" style={{ background: settings.primary }} title="Primary colour (left button)">
            <input type="color" value={settings.primary} onInput={(e) => set('primary', e.currentTarget.value)} aria-label="Primary colour" data-testid="pa-primary" />
          </label>
          <label class="pa-swatch pa-secondary" style={{ background: settings.secondary }} title="Secondary colour (right button)">
            <input type="color" value={settings.secondary} onInput={(e) => set('secondary', e.currentTarget.value)} aria-label="Secondary colour" data-testid="pa-secondary" />
          </label>
          <button type="button" class="button button-small button-quiet pa-swap" onClick={() => setSettings((s) => ({ ...s, primary: s.secondary, secondary: s.primary }))} title="Swap the colours">
            ⇄
          </button>
        </div>
        <div class="pa-palette" role="group" aria-label="Palette: click for the primary colour, right-click for the secondary">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              class="pa-chip"
              style={{ background: c }}
              title={c}
              aria-label={c}
              onClick={() => set('primary', c)}
              onContextMenu={(e) => {
                e.preventDefault();
                set('secondary', c);
              }}
            />
          ))}
        </div>
        <p class="pa-status" role="status" data-testid="pa-status">
          {pointer ? `${pointer.x}, ${pointer.y} px` : ''}
          {selection ? `  Selection ${selection.w} × ${selection.h}` : ''}
          {`  Picture ${size.width} × ${size.height}`}
        </p>
      </div>

      {dialog && (
        <SizeDialog
          kind={dialog}
          width={size.width}
          height={size.height}
          onCancel={() => setDialog(null)}
          onDone={(w, h) => {
            setDialog(null);
            if (dialog === 'resize') stretch(w, h);
            else if (dialog === 'canvas') {
              commitFloating();
              resizeCanvas(w, h);
            } else newPicture(w, h);
          }}
        />
      )}
    </section>
  );
}

function SizeDialog({ kind, width, height, onCancel, onDone }: { kind: 'resize' | 'canvas' | 'new'; width: number; height: number; onCancel: () => void; onDone: (w: number, h: number) => void }) {
  const [w, setW] = useState(String(kind === 'new' ? 800 : width));
  const [h, setH] = useState(String(kind === 'new' ? 560 : height));
  const [keepRatio, setKeepRatio] = useState(kind === 'resize');
  const [percent, setPercent] = useState('100');
  const valid = (v: string) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= MAX_SIDE ? n : null;
  };
  const title = kind === 'resize' ? 'Resize the picture' : kind === 'canvas' ? 'Canvas size' : 'New picture';
  return (
    <div class="pa-dialog" role="dialog" aria-modal="true" aria-label={title} data-testid="pa-dialog">
      <form
        class="pa-dialog-box"
        onSubmit={(e) => {
          e.preventDefault();
          const a = valid(w);
          const b = valid(h);
          if (a && b) onDone(a, b);
        }}
      >
        <h3>{title}</h3>
        {kind === 'resize' && (
          <label class="pa-field">
            <span class="control-label">Percentage</span>
            <input
              class="input input-number"
              type="number"
              min={1}
              max={1000}
              value={percent}
              onInput={(e) => {
                const p = Number(e.currentTarget.value);
                setPercent(e.currentTarget.value);
                if (p > 0) {
                  setW(String(Math.max(1, Math.round((width * p) / 100))));
                  setH(String(Math.max(1, Math.round((height * p) / 100))));
                }
              }}
            />
          </label>
        )}
        <label class="pa-field">
          <span class="control-label">Width (px)</span>
          <input
            class="input input-number"
            type="number"
            min={1}
            max={MAX_SIDE}
            value={w}
            onInput={(e) => {
              setW(e.currentTarget.value);
              const n = Number(e.currentTarget.value);
              if (keepRatio && n > 0) setH(String(Math.max(1, Math.round((n * height) / width))));
            }}
            data-testid="pa-dialog-width"
          />
        </label>
        <label class="pa-field">
          <span class="control-label">Height (px)</span>
          <input
            class="input input-number"
            type="number"
            min={1}
            max={MAX_SIDE}
            value={h}
            onInput={(e) => {
              setH(e.currentTarget.value);
              const n = Number(e.currentTarget.value);
              if (keepRatio && n > 0) setW(String(Math.max(1, Math.round((n * width) / height))));
            }}
            data-testid="pa-dialog-height"
          />
        </label>
        {kind !== 'new' && (
          <label class="check">
            <input type="checkbox" checked={keepRatio} onChange={(e) => setKeepRatio(e.currentTarget.checked)} /> Keep the proportions
          </label>
        )}
        <p class="pa-hint">
          {kind === 'canvas'
            ? 'The picture keeps its place at the top left; new space takes the secondary colour.'
            : kind === 'resize'
              ? 'The picture is stretched to the new size.'
              : 'A white picture of this size.'}
        </p>
        <div class="button-row">
          <button type="submit" class="button button-small button-primary" disabled={!valid(w) || !valid(h)} data-testid="pa-dialog-ok">
            {kind === 'new' ? 'Create' : 'Apply'}
          </button>
          <button type="button" class="button button-small" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export default defineCustomTool(Paint);
