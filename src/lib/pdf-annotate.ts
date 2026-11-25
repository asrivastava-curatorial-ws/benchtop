/**
 * Annotations added while reading a PDF: highlights, underlines and strike-outs
 * on text, notes, text boxes, pen strokes, rectangles, ellipses, lines and
 * arrows.  Geometry is kept in view space (points, origin at the top left of
 * the page as it is shown, rotation applied) and turned into PDF user space
 * when saved.  Every annotation gets an appearance stream, so viewers draw it
 * the same way, or is drawn into the page itself (flattened).  Annotations of
 * these kinds that are already in a file are read back for editing.
 */
import { PDFArray, PDFDict, type PDFDocument, type PDFFont, PDFHexString, PDFName, PDFNumber, type PDFObject, type PDFPage, PDFRef, PDFString } from 'pdf-lib';
import { type Box, type Joined, joinItems, rangeBoxes, type TextItem } from './pdf-redact';
import { finishFonts, fontsFor, textOperators, textWidth } from './pdf-text';

export type Point = readonly [number, number];
export type Rotation = 0 | 90 | 180 | 270;

export interface PageGeometry {
  /** The shown part of the page in user space, [x0, y0, x1, y1]: the crop box within the media box. */
  readonly view: readonly [number, number, number, number];
  readonly rotate: Rotation;
}

/** The page as PDF.js shows it. */
export function geometryOf(page: PDFPage): PageGeometry {
  const box = (r: { x: number; y: number; width: number; height: number }) =>
    [Math.min(r.x, r.x + r.width), Math.min(r.y, r.y + r.height), Math.max(r.x, r.x + r.width), Math.max(r.y, r.y + r.height)] as const;
  const media = box(page.getMediaBox());
  const crop = box(page.getCropBox());
  const inner = [Math.max(media[0], crop[0]), Math.max(media[1], crop[1]), Math.min(media[2], crop[2]), Math.min(media[3], crop[3])] as const;
  const view = inner[2] > inner[0] && inner[3] > inner[1] ? inner : media;
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  return { view, rotate: (angle % 90 === 0 ? angle : 0) as Rotation };
}

export function viewSize(g: PageGeometry): { width: number; height: number } {
  const w = g.view[2] - g.view[0];
  const h = g.view[3] - g.view[1];
  return g.rotate % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

/** A point of the shown page in PDF user space. */
export function toPdf(g: PageGeometry, [x, y]: Point): [number, number] {
  const [x0, y0, x1, y1] = g.view;
  if (g.rotate === 90) return [y + x0, x + y0];
  if (g.rotate === 180) return [x1 - x, y + y0];
  if (g.rotate === 270) return [x1 - y, y1 - x];
  return [x + x0, y1 - y];
}

/** A point in PDF user space on the shown page. */
export function toView(g: PageGeometry, [x, y]: Point): [number, number] {
  const [x0, y0, x1, y1] = g.view;
  if (g.rotate === 90) return [y - y0, x - x0];
  if (g.rotate === 180) return [x1 - x, y - y0];
  if (g.rotate === 270) return [y1 - y, x1 - x];
  return [x - x0, y1 - y];
}

export type MarkupKind = 'highlight' | 'underline' | 'strike';
export type AnnotationKind = MarkupKind | 'note' | 'text' | 'ink' | 'rect' | 'ellipse' | 'line' | 'arrow';

/** An annotation's object in the opened file. */
export interface Source {
  readonly num: number;
  readonly gen: number;
}

interface Common {
  readonly id: string;
  /** Page, from 1. */
  readonly page: number;
  /** #rrggbb */
  readonly color: string;
  /** 0–1 */
  readonly opacity: number;
  /** The comment that goes with it (a note's words). */
  readonly comment: string;
  readonly author: string;
  /** When it last changed, ISO 8601 (empty when unknown). */
  readonly modified: string;
  /** Where it is in the opened file; saving changes it there. */
  readonly source?: Source;
}

export interface MarkupAnnotation extends Common {
  readonly kind: MarkupKind;
  /** One box per line or piece of text, in view space. */
  readonly boxes: readonly Box[];
  /** The text it marks. */
  readonly text: string;
}

export interface NoteAnnotation extends Common {
  readonly kind: 'note';
  /** Top left of the note's icon. */
  readonly at: Point;
}

export interface TextAnnotation extends Common {
  readonly kind: 'text';
  readonly box: Box;
  readonly text: string;
  readonly size: number;
}

export interface InkAnnotation extends Common {
  readonly kind: 'ink';
  readonly strokes: readonly (readonly Point[])[];
  readonly width: number;
}

export interface ShapeAnnotation extends Common {
  readonly kind: 'rect' | 'ellipse';
  readonly box: Box;
  readonly width: number;
  /** Fill colour, or null for none. */
  readonly fill: string | null;
}

export interface LineAnnotation extends Common {
  readonly kind: 'line' | 'arrow';
  readonly from: Point;
  readonly to: Point;
  readonly width: number;
}

export type Annotation = MarkupAnnotation | NoteAnnotation | TextAnnotation | InkAnnotation | ShapeAnnotation | LineAnnotation;

export const KIND_LABELS: Record<AnnotationKind, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strike: 'Strike-out',
  note: 'Note',
  text: 'Text box',
  ink: 'Pen',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
};

/** Size of a note's icon, in points. */
export const NOTE_SIZE = 20;
/** Space between a text box's edge and its words. */
export const TEXT_PAD = 3;
/** Line height of text boxes, as a multiple of the font size. */
export const TEXT_LEADING = 1.2;

let counter = 0;
export const newAnnotationId = (): string => `bt-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

// ---------------------------------------------------------------- colours, dates

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? Number.parseInt(m[1] as string, 16) : 0;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function rgbToHex(rgb: readonly number[]): string {
  const part = (v: number | undefined) =>
    Math.round(Math.min(1, Math.max(0, v ?? 0)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

/** A colour array from a PDF (grey, RGB or CMYK) as #rrggbb, or null when there is none. */
function colourOf(values: readonly number[]): string | null {
  if (values.length === 1) return rgbToHex([values[0] ?? 0, values[0] ?? 0, values[0] ?? 0]);
  if (values.length === 3) return rgbToHex(values);
  if (values.length === 4) {
    const [c = 0, m = 0, y = 0, k = 0] = values;
    return rgbToHex([(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]);
  }
  return null;
}

/** ISO 8601 → D:YYYYMMDDHHmmSSZ (UTC). */
export function pdfDate(iso: string): string {
  const d = iso ? new Date(iso) : new Date();
  const at = Number.isNaN(d.getTime()) ? new Date() : d;
  const two = (n: number) => String(n).padStart(2, '0');
  return `D:${at.getUTCFullYear()}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}Z`;
}

/** D:YYYYMMDDHHmmSS+HH'mm' (any tail may be missing) → ISO 8601, or '' when it is not a date. */
export function parsePdfDate(text: string): string {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(text.trim());
  if (!m) return '';
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', sign, oh = '00', om = '00'] = m;
  const offset = sign === '+' || sign === '-' ? `${sign}${oh}:${om}` : 'Z';
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

// ---------------------------------------------------------------- text selection

/** A place between two characters of a page's text: before character `char` of item `item`. */
export interface Caret {
  readonly item: number;
  readonly char: number;
}

function fractionOf(item: TextItem, char: number): number {
  const length = Math.max(1, item.text.length);
  if (item.whole) return char <= 0 ? 0 : 1;
  return item.cuts?.[char] ?? char / length;
}

/** The caret nearest a point: inside the piece of text under it, or at the near end of the closest one. */
export function caretAt(items: readonly TextItem[], [x, y]: Point, slop = 2): Caret | null {
  let index = -1;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as TextItem;
    if (!item.text) continue;
    const dx = Math.max(item.x - x, 0, x - (item.x + item.w));
    const dy = Math.max(item.y - y, 0, y - (item.y + item.h));
    // Being on the same line matters more than being near along it; inside, the smallest piece wins.
    const score = dx <= slop && dy <= slop ? -1 / Math.max(1, item.w * item.h) : dy * 4 + dx;
    if (score < best) {
      best = score;
      index = i;
    }
  }
  const item = items[index];
  if (!item) return null;
  // Turned text is chosen whole: the near half of it along its length gives its start.
  if (item.whole) {
    const along = item.h > item.w ? (y - item.y) / Math.max(1, item.h) : (x - item.x) / Math.max(1, item.w);
    return { item: index, char: along < 0.5 ? 0 : item.text.length };
  }
  const f = item.w > 0 ? (x - item.x) / item.w : 0;
  if (f <= 0) return { item: index, char: 0 };
  if (f >= 1) return { item: index, char: item.text.length };
  let char = 0;
  for (let i = 0; i < item.text.length; i++) {
    const mid = (fractionOf(item, i) + fractionOf(item, i + 1)) / 2;
    if (f > mid) char = i + 1;
  }
  return { item: index, char };
}

/** Where a caret falls in the page's joined text. */
function placeOf(joined: Joined, caret: Caret): number {
  let last = -1;
  for (let i = 0; i < joined.item.length; i++) {
    if (joined.item[i] !== caret.item) continue;
    if (joined.at[i] === caret.char) return i;
    last = i;
  }
  return last + 1;
}

/** Joins boxes that sit on one line and touch, so a highlight reads as one band per line. */
export function mergeLines(boxes: readonly Box[]): Box[] {
  const sorted = [...boxes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  const out: Box[] = [];
  for (const box of sorted) {
    const last = out[out.length - 1];
    // Runs of turned text (tall and thin) sit side by side without being one line.
    const tall = (b: Box) => b.h > b.w * 3 && b.h > 40;
    if (last && !tall(last) && !tall(box)) {
      const overlap = Math.min(last.y + last.h, box.y + box.h) - Math.max(last.y, box.y);
      const gap = box.x - (last.x + last.w);
      if (overlap > Math.min(last.h, box.h) * 0.5 && gap < Math.max(last.h, box.h) * 0.8 && gap > -Math.max(last.w, box.w)) {
        const x = Math.min(last.x, box.x);
        const y = Math.min(last.y, box.y);
        out[out.length - 1] = { x, y, w: Math.max(last.x + last.w, box.x + box.w) - x, h: Math.max(last.y + last.h, box.y + box.h) - y };
        continue;
      }
    }
    out.push(box);
  }
  return out;
}

/** The text between two carets (in either order) and the boxes that cover it, one per line. */
export function selectText(items: readonly TextItem[], a: Caret, b: Caret, pad = 0.5): { text: string; boxes: Box[] } {
  const joined = joinItems(items);
  const p = placeOf(joined, a);
  const q = placeOf(joined, b);
  const start = Math.min(p, q);
  const end = Math.max(p, q);
  if (end <= start) return { text: '', boxes: [] };
  return { text: joined.text.slice(start, end).trim(), boxes: mergeLines(rangeBoxes(items, joined, start, end, pad)) };
}

// ---------------------------------------------------------------- geometry of annotations

const union = (boxes: readonly Box[]): Box => {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

const pointsBox = (points: readonly Point[], margin = 0): Box => {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs) - margin;
  const y0 = Math.min(...ys) - margin;
  return { x: x0, y: y0, w: Math.max(...xs) + margin - x0, h: Math.max(...ys) + margin - y0 };
};

/** A box with positive width and height from two corners. */
export const boxBetween = (a: Point, b: Point): Box => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) });

const ARROW_ANGLE = (25 * Math.PI) / 180;
const arrowLength = (width: number) => Math.max(7, width * 4);

/** The two ends of an arrow's head at `to`. */
export function arrowHead(from: Point, to: Point, width: number): [Point, Point] {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const length = arrowLength(width);
  const end = (turn: number): Point => [to[0] - length * Math.cos(angle + turn), to[1] - length * Math.sin(angle + turn)];
  return [end(ARROW_ANGLE), end(-ARROW_ANGLE)];
}

/** The area an annotation covers on the shown page. */
export function boundsOf(a: Annotation): Box {
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strike':
      return union(a.boxes);
    case 'note':
      return { x: a.at[0], y: a.at[1], w: NOTE_SIZE, h: NOTE_SIZE };
    case 'text':
    case 'rect':
    case 'ellipse':
      return a.box;
    case 'ink':
      return pointsBox(a.strokes.flat(), a.width / 2);
    default:
      return pointsBox(a.kind === 'arrow' ? [a.from, a.to, ...arrowHead(a.from, a.to, a.width)] : [a.from, a.to], a.width / 2);
  }
}

const inside = (b: Box, [x, y]: Point, slop = 0) => x >= b.x - slop && x <= b.x + b.w + slop && y >= b.y - slop && y <= b.y + b.h + slop;

function segmentDistance([x, y]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** Whether a point is on an annotation (on the outline of an unfilled shape). */
export function hits(a: Annotation, p: Point, slop = 3): boolean {
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strike':
      return a.boxes.some((b) => inside(b, p, 1));
    case 'note':
    case 'text':
      return inside(boundsOf(a), p, slop);
    case 'rect': {
      if (!inside(a.box, p, slop + a.width / 2)) return false;
      if (a.fill) return true;
      const { x, y, w, h } = a.box;
      const edge = Math.min(Math.abs(p[0] - x), Math.abs(p[0] - (x + w)), Math.abs(p[1] - y), Math.abs(p[1] - (y + h)));
      return edge <= slop + a.width / 2;
    }
    case 'ellipse': {
      const rx = a.box.w / 2;
      const ry = a.box.h / 2;
      if (rx <= 0 || ry <= 0) return false;
      const d = Math.hypot((p[0] - (a.box.x + rx)) / rx, (p[1] - (a.box.y + ry)) / ry);
      return a.fill ? d <= 1 + slop / Math.min(rx, ry) : Math.abs(d - 1) * Math.min(rx, ry) <= slop + a.width / 2;
    }
    case 'ink':
      return a.strokes.some((stroke) => stroke.some((point, i) => segmentDistance(p, stroke[i - 1] ?? point, point) <= slop + a.width / 2));
    default:
      return segmentDistance(p, a.from, a.to) <= slop + a.width / 2;
  }
}

const shift = (p: Point, dx: number, dy: number): Point => [p[0] + dx, p[1] + dy];
const shiftBox = (b: Box, dx: number, dy: number): Box => ({ ...b, x: b.x + dx, y: b.y + dy });

/** Whether an annotation can be dragged to another place (text markings stay with their text). */
export const movable = (a: Annotation): boolean => a.kind !== 'highlight' && a.kind !== 'underline' && a.kind !== 'strike';

/** Whether an annotation has a box that can be resized. */
export const resizable = (a: Annotation): a is TextAnnotation | ShapeAnnotation => a.kind === 'text' || a.kind === 'rect' || a.kind === 'ellipse';

export function moveBy(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.kind) {
    case 'note':
      return { ...a, at: shift(a.at, dx, dy) };
    case 'text':
    case 'rect':
    case 'ellipse':
      return { ...a, box: shiftBox(a.box, dx, dy) };
    case 'ink':
      return { ...a, strokes: a.strokes.map((s) => s.map((p) => shift(p, dx, dy))) };
    case 'line':
    case 'arrow':
      return { ...a, from: shift(a.from, dx, dy), to: shift(a.to, dx, dy) };
    default:
      return a;
  }
}

/** Lines of a text box's words that fit `width`, measured with `measure` (width of a string at size 1). */
export function wrapText(text: string, width: number, size: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  const room = Math.max(size, width);
  const fits = (s: string) => measure(s) * size <= room;
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = '';
    for (const word of paragraph.split(/(?<=\s)/)) {
      if (!line || fits(line + word)) line += word;
      else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
      // A word too long for a line on its own is broken between characters.
      while (!fits(line.trimEnd()) && [...line.trimEnd()].length > 1) {
        const chars = [...line];
        let cut = chars.length - 1;
        while (cut > 1 && !fits(chars.slice(0, cut).join(''))) cut--;
        lines.push(chars.slice(0, cut).join(''));
        line = chars.slice(cut).join('');
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** The height a text box needs for its words. */
export const textHeight = (lines: number, size: number): number => Math.max(1, lines) * size * TEXT_LEADING + TEXT_PAD * 2;

// ---------------------------------------------------------------- appearance streams

const num = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

interface Built {
  /** Content stream, in PDF user space. */
  readonly content: string;
  readonly bbox: readonly [number, number, number, number];
  readonly blend: boolean;
  readonly font?: PDFFont;
}

class Pen {
  readonly parts: string[] = [];
  readonly points: [number, number][] = [];
  constructor(readonly g: PageGeometry) {}
  private at(p: Point): string {
    const q = toPdf(this.g, p);
    this.points.push(q);
    return `${num(q[0])} ${num(q[1])}`;
  }
  move(p: Point) {
    this.parts.push(`${this.at(p)} m`);
  }
  line(p: Point) {
    this.parts.push(`${this.at(p)} l`);
  }
  curve(a: Point, b: Point, c: Point) {
    this.parts.push(`${this.at(a)} ${this.at(b)} ${this.at(c)} c`);
  }
  box(b: Box) {
    this.move([b.x, b.y]);
    this.line([b.x + b.w, b.y]);
    this.line([b.x + b.w, b.y + b.h]);
    this.line([b.x, b.y + b.h]);
    this.parts.push('h');
  }
  ellipse(b: Box) {
    const k = 0.5522847498;
    const rx = b.w / 2;
    const ry = b.h / 2;
    const cx = b.x + rx;
    const cy = b.y + ry;
    this.move([cx + rx, cy]);
    this.curve([cx + rx, cy + k * ry], [cx + k * rx, cy + ry], [cx, cy + ry]);
    this.curve([cx - k * rx, cy + ry], [cx - rx, cy + k * ry], [cx - rx, cy]);
    this.curve([cx - rx, cy - k * ry], [cx - k * rx, cy - ry], [cx, cy - ry]);
    this.curve([cx + k * rx, cy - ry], [cx + rx, cy - k * ry], [cx + rx, cy]);
    this.parts.push('h');
  }
  raw(op: string) {
    this.parts.push(op);
  }
  bbox(margin: number): [number, number, number, number] {
    if (!this.points.length) return [0, 0, 0, 0];
    const xs = this.points.map((p) => p[0]);
    const ys = this.points.map((p) => p[1]);
    return [Math.min(...xs) - margin, Math.min(...ys) - margin, Math.max(...xs) + margin, Math.max(...ys) + margin];
  }
}

const colourOps = (hex: string, op: 'rg' | 'RG') => `${hexToRgb(hex).map(num).join(' ')} ${op}`;

/**
 * Where a note is anchored: viewers keep notes upright and unscaled ("NoRotate"), hanging
 * from the top left corner of their box in user space, so that corner is where it is put.
 */
function noteAnchor(g: PageGeometry, at: Point): PageGeometry {
  const [ax, ay] = toPdf(g, at);
  return { view: [ax - at[0], 0, 0, ay + at[1]], rotate: 0 };
}

/** The appearance of one annotation, drawn in user space (`flat`: drawn into the page itself). */
function appearance(a: Annotation, g: PageGeometry, font: PDFFont | undefined, flat: boolean): Built {
  const pen = new Pen(a.kind === 'note' && !flat ? noteAnchor(g, a.at) : g);
  const alpha = a.opacity < 1 ? '/GS0 gs ' : '';
  switch (a.kind) {
    case 'highlight': {
      pen.raw(`${alpha}${colourOps(a.color, 'rg')}`);
      for (const b of a.boxes) pen.box(b);
      pen.raw('f');
      return { content: pen.parts.join('\n'), bbox: pen.bbox(0), blend: true };
    }
    case 'underline':
    case 'strike': {
      const height = Math.max(...a.boxes.map((b) => b.h), 1);
      pen.raw(`${alpha}${colourOps(a.color, 'RG')} ${num(Math.max(0.6, height * 0.07))} w 0 J`);
      for (const b of a.boxes) {
        const y = b.y + b.h * (a.kind === 'underline' ? 0.86 : 0.56);
        pen.move([b.x, y]);
        pen.line([b.x + b.w, y]);
      }
      pen.raw('S');
      // The box is made from the text boxes so that the marked text sits inside it.
      const all = new Pen(g);
      for (const b of a.boxes) all.box(b);
      return { content: pen.parts.join('\n'), bbox: all.bbox(1), blend: false };
    }
    case 'note': {
      const [x, y] = a.at;
      const s = NOTE_SIZE;
      pen.raw(`${alpha}${colourOps(a.color, 'rg')} 0.25 0.25 0.25 RG 0.8 w 1 j`);
      pen.move([x + 1, y + 1]);
      pen.line([x + s - 1, y + 1]);
      pen.line([x + s - 1, y + s * 0.72]);
      pen.line([x + s * 0.5, y + s * 0.72]);
      pen.line([x + s * 0.25, y + s - 1]);
      pen.line([x + s * 0.3, y + s * 0.72]);
      pen.line([x + 1, y + s * 0.72]);
      pen.raw('h B');
      for (const row of [0.22, 0.38, 0.54]) {
        pen.move([x + s * 0.22, y + s * row]);
        pen.line([x + s * 0.78, y + s * row]);
      }
      pen.raw('S');
      // The icon's frame is its box, so that it is read back where it was put.
      const frame = new Pen(flat ? g : noteAnchor(g, a.at));
      frame.box({ x, y, w: s, h: s });
      return { content: pen.parts.join('\n'), bbox: frame.bbox(0), blend: false };
    }
    case 'text': {
      const size = a.size;
      const lines = font ? wrapText(a.text, a.box.w - TEXT_PAD * 2, size, (s) => textWidth(font, s, 1)) : [];
      const box = { ...a.box, h: Math.max(a.box.h, textHeight(lines.length, size)) };
      const frame = new Pen(g);
      frame.box(box);
      const ops: string[] = [`${alpha}${colourOps(a.color, 'rg')}`];
      if (font) {
        lines.forEach((line, i) => {
          if (!line) return;
          const origin = toPdf(g, [box.x + TEXT_PAD, box.y + TEXT_PAD + size * (0.85 + i * TEXT_LEADING)]);
          ops.push(...textOperators(font, 'F0', line, { x: origin[0], y: origin[1], size, angle: g.rotate }).map((op) => op.toString()));
        });
      }
      return { content: ops.join('\n'), bbox: frame.bbox(0), blend: false, font };
    }
    case 'ink': {
      pen.raw(`${alpha}${colourOps(a.color, 'RG')} ${num(a.width)} w 1 J 1 j`);
      for (const stroke of a.strokes) {
        const [first, ...rest] = stroke;
        if (!first) continue;
        pen.move(first);
        if (!rest.length) pen.line(first);
        for (const p of rest) pen.line(p);
      }
      pen.raw('S');
      return { content: pen.parts.join('\n'), bbox: pen.bbox(a.width / 2 + 1), blend: false };
    }
    case 'rect':
    case 'ellipse': {
      pen.raw(`${alpha}${colourOps(a.color, 'RG')} ${num(a.width)} w${a.fill ? ` ${colourOps(a.fill, 'rg')}` : ''}`);
      if (a.kind === 'rect') pen.box(a.box);
      else pen.ellipse(a.box);
      pen.raw(a.fill ? (a.width > 0 ? 'B' : 'f') : 'S');
      // Half the line outside the shape, as the format expects of squares and circles.
      return { content: pen.parts.join('\n'), bbox: pen.bbox(a.width / 2), blend: false };
    }
    default: {
      pen.raw(`${alpha}${colourOps(a.color, 'RG')} ${num(a.width)} w 1 J 1 j`);
      pen.move(a.from);
      pen.line(a.to);
      if (a.kind === 'arrow') {
        const [left, right] = arrowHead(a.from, a.to, a.width);
        pen.move(left);
        pen.line(a.to);
        pen.line(right);
      }
      pen.raw('S');
      return { content: pen.parts.join('\n'), bbox: pen.bbox(a.width / 2 + 1), blend: false };
    }
  }
}

// ---------------------------------------------------------------- reading and writing

const N = PDFName.of;
const SUBTYPES: Record<AnnotationKind, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strike: 'StrikeOut',
  note: 'Text',
  text: 'FreeText',
  ink: 'Ink',
  rect: 'Square',
  ellipse: 'Circle',
  line: 'Line',
  arrow: 'Line',
};

const keyOf = (s: Source) => `${s.num} ${s.gen}`;

function numbers(doc: PDFDocument, value: PDFObject | undefined): number[] {
  const array = value instanceof PDFRef ? doc.context.lookup(value) : value;
  if (!(array instanceof PDFArray)) return [];
  return array.asArray().map((v) => {
    const n = v instanceof PDFRef ? doc.context.lookup(v) : v;
    return n instanceof PDFNumber ? n.asNumber() : Number.NaN;
  });
}

function textOf(doc: PDFDocument, value: PDFObject | undefined): string {
  const v = value instanceof PDFRef ? doc.context.lookup(value) : value;
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '';
}

function nameOf(dict: PDFDict, key: string): string {
  const v = dict.get(N(key));
  return v instanceof PDFName ? v.decodeText() : '';
}

const quads = (values: readonly number[]): Point[][] => {
  const out: Point[][] = [];
  for (let i = 0; i + 7 < values.length; i += 8) {
    const q = values.slice(i, i + 8);
    out.push([
      [q[0] ?? 0, q[1] ?? 0],
      [q[2] ?? 0, q[3] ?? 0],
      [q[4] ?? 0, q[5] ?? 0],
      [q[6] ?? 0, q[7] ?? 0],
    ]);
  }
  return out;
};

/** Text-markup, note, text box, pen, shape and line annotations already in the file, ready to edit. */
export function readAnnotations(doc: PDFDocument): Annotation[] {
  const out: Annotation[] = [];
  doc.getPages().forEach((page, index) => {
    const g = geometryOf(page);
    const annots = page.node.Annots();
    if (!annots) return;
    for (const entry of annots.asArray()) {
      if (!(entry instanceof PDFRef)) continue;
      const dict = doc.context.lookup(entry);
      if (!(dict instanceof PDFDict)) continue;
      const flags = dict.get(N('F'));
      if (flags instanceof PDFNumber && flags.asNumber() & 2) continue;
      const subtype = nameOf(dict, 'Subtype');
      const rect = numbers(doc, dict.get(N('Rect')));
      const corners = rect.length === 4 ? [toView(g, [rect[0] ?? 0, rect[1] ?? 0]), toView(g, [rect[2] ?? 0, rect[3] ?? 0])] : null;
      const rectBox = corners ? boxBetween(corners[0] as Point, corners[1] as Point) : null;
      const opacityValue = dict.get(N('CA'));
      const common = {
        id: textOf(doc, dict.get(N('NM'))) || `file-${entry.objectNumber}-${entry.generationNumber}`,
        page: index + 1,
        color: colourOf(numbers(doc, dict.get(N('C')))) ?? '#ffd400',
        opacity: opacityValue instanceof PDFNumber ? Math.min(1, Math.max(0, opacityValue.asNumber())) : 1,
        comment: textOf(doc, dict.get(N('Contents'))),
        author: textOf(doc, dict.get(N('T'))),
        modified: parsePdfDate(textOf(doc, dict.get(N('M')))),
        source: { num: entry.objectNumber, gen: entry.generationNumber },
      };
      const bs = dict.get(N('BS'));
      const bsDict = bs instanceof PDFRef ? doc.context.lookup(bs) : bs;
      const widthValue = bsDict instanceof PDFDict ? bsDict.get(N('W')) : undefined;
      const width = widthValue instanceof PDFNumber ? widthValue.asNumber() : 1;
      if (subtype === 'Highlight' || subtype === 'Underline' || subtype === 'StrikeOut' || subtype === 'Squiggly') {
        const boxes = quads(numbers(doc, dict.get(N('QuadPoints')))).map((q) => pointsBox(q.map((p) => toView(g, p))));
        if (!boxes.length && rectBox) boxes.push(rectBox);
        if (!boxes.length) continue;
        out.push({ ...common, kind: subtype === 'Highlight' ? 'highlight' : subtype === 'StrikeOut' ? 'strike' : 'underline', boxes, text: '' });
      } else if (subtype === 'Text' && rect.length === 4) {
        out.push({ ...common, kind: 'note', at: toView(g, [Math.min(rect[0] ?? 0, rect[2] ?? 0), Math.max(rect[1] ?? 0, rect[3] ?? 0)]) });
      } else if (subtype === 'FreeText' && rectBox) {
        const da = textOf(doc, dict.get(N('DA')));
        const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1]) || 12;
        const rgb = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
        const grey = /([\d.]+)\s+g(?:\s|$)/.exec(da);
        const color = rgb ? rgbToHex([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]) : grey ? rgbToHex([Number(grey[1]), Number(grey[1]), Number(grey[1])]) : '#000000';
        out.push({ ...common, kind: 'text', box: rectBox, text: common.comment, comment: '', size, color });
      } else if (subtype === 'Ink') {
        const list = dict.get(N('InkList'));
        const listArray = list instanceof PDFRef ? doc.context.lookup(list) : list;
        if (!(listArray instanceof PDFArray)) continue;
        const strokes = listArray.asArray().map((stroke) => {
          const values = numbers(doc, stroke);
          const points: Point[] = [];
          for (let i = 0; i + 1 < values.length; i += 2) points.push(toView(g, [values[i] ?? 0, values[i + 1] ?? 0]));
          return points;
        });
        out.push({ ...common, kind: 'ink', strokes, width });
      } else if ((subtype === 'Square' || subtype === 'Circle') && rectBox) {
        const half = width / 2;
        const box = { x: rectBox.x + half, y: rectBox.y + half, w: Math.max(0, rectBox.w - width), h: Math.max(0, rectBox.h - width) };
        out.push({ ...common, kind: subtype === 'Square' ? 'rect' : 'ellipse', box, width, fill: colourOf(numbers(doc, dict.get(N('IC')))) });
      } else if (subtype === 'Line') {
        const l = numbers(doc, dict.get(N('L')));
        if (l.length !== 4) continue;
        const ends = dict.get(N('LE'));
        const endsArray = ends instanceof PDFRef ? doc.context.lookup(ends) : ends;
        const last = endsArray instanceof PDFArray ? endsArray.get(1) : undefined;
        const arrow = last instanceof PDFName && /Arrow/.test(last.decodeText());
        out.push({ ...common, kind: arrow ? 'arrow' : 'line', from: toView(g, [l[0] ?? 0, l[1] ?? 0]), to: toView(g, [l[2] ?? 0, l[3] ?? 0]), width });
      }
    }
  });
  return out;
}

/** Takes annotations (and their pop-ups) out of their pages. */
export function removeAnnotations(doc: PDFDocument, sources: readonly Source[]): number {
  const gone = new Set(sources.map(keyOf));
  if (!gone.size) return 0;
  let removed = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const keep: PDFObject[] = [];
    for (const entry of annots.asArray()) {
      const dict = entry instanceof PDFRef ? doc.context.lookup(entry) : entry;
      const parent = dict instanceof PDFDict ? dict.get(N('Parent')) : undefined;
      const own = entry instanceof PDFRef && gone.has(`${entry.objectNumber} ${entry.generationNumber}`);
      const popup = parent instanceof PDFRef && gone.has(`${parent.objectNumber} ${parent.generationNumber}`);
      if (own || popup) {
        if (own) removed++;
        continue;
      }
      keep.push(entry);
    }
    if (keep.length !== annots.size()) page.node.set(N('Annots'), doc.context.obj(keep));
  }
  return removed;
}

export interface SaveChanges {
  /** New annotations, and changed ones (those with a `source`). */
  readonly write: readonly Annotation[];
  /** Annotations from the file to take out. */
  readonly remove: readonly Source[];
  /** Draw `write` into the pages instead of adding annotations (their sources are taken out). */
  readonly flatten: boolean;
}

function writeFields(doc: PDFDocument, dict: PDFDict, page: PDFPage, a: Annotation, g: PageGeometry, ap: PDFRef, bbox: readonly number[]): void {
  const set = (key: string, value: PDFObject) => dict.set(N(key), value);
  const rgb = hexToRgb(a.color);
  set('Type', N('Annot'));
  set('Subtype', N(SUBTYPES[a.kind]));
  set('Rect', doc.context.obj(bbox.map((v) => Math.round(v * 1000) / 1000)));
  set('P', page.ref);
  set('NM', PDFHexString.fromText(a.id));
  set('M', PDFString.of(pdfDate(a.modified)));
  set('F', PDFNumber.of(4));
  set('AP', doc.context.obj({ N: ap }));
  dict.delete(N('AS'));
  if (a.author) set('T', PDFHexString.fromText(a.author));
  if (a.opacity < 1) set('CA', PDFNumber.of(Math.round(a.opacity * 1000) / 1000));
  else dict.delete(N('CA'));
  if (!dict.has(N('CreationDate'))) set('CreationDate', PDFString.of(pdfDate(a.modified)));
  const contents = a.kind === 'text' ? a.text : a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strike' ? a.comment || a.text : a.comment;
  if (contents) set('Contents', PDFHexString.fromText(contents));
  else dict.delete(N('Contents'));
  const border = (width: number) => set('BS', doc.context.obj({ Type: 'Border', W: Math.round(width * 1000) / 1000, S: 'S' }));
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strike': {
      const values: number[] = [];
      for (const b of a.boxes) {
        for (const corner of [
          [b.x, b.y],
          [b.x + b.w, b.y],
          [b.x, b.y + b.h],
          [b.x + b.w, b.y + b.h],
        ] as const)
          values.push(...toPdf(g, corner).map((v) => Math.round(v * 1000) / 1000));
      }
      set('QuadPoints', doc.context.obj(values));
      set('C', doc.context.obj(rgb));
      break;
    }
    case 'note':
      // Print, NoZoom and NoRotate: how viewers treat notes anyway.
      set('F', PDFNumber.of(28));
      set('Name', N('Comment'));
      set('C', doc.context.obj(rgb));
      set('Open', doc.context.obj(false));
      break;
    case 'text': {
      const colour = rgb.map((v) => Math.round(v * 1000) / 1000).join(' ');
      set('DA', PDFString.of(`/Helv ${a.size} Tf ${colour} rg`));
      set('DS', PDFString.of(`font: Helvetica,sans-serif ${a.size}pt; text-align:left; color:${a.color}`));
      dict.delete(N('RC'));
      dict.delete(N('C'));
      if (g.rotate) set('Rotate', PDFNumber.of(g.rotate));
      else dict.delete(N('Rotate'));
      border(0);
      break;
    }
    case 'ink': {
      const list = a.strokes.map((stroke) => stroke.flatMap((p) => toPdf(g, p).map((v) => Math.round(v * 1000) / 1000)));
      set('InkList', doc.context.obj(list));
      set('C', doc.context.obj(rgb));
      border(a.width);
      break;
    }
    case 'rect':
    case 'ellipse':
      set('C', doc.context.obj(rgb));
      if (a.fill) set('IC', doc.context.obj(hexToRgb(a.fill)));
      else dict.delete(N('IC'));
      border(a.width);
      break;
    default: {
      const ends = [...toPdf(g, a.from), ...toPdf(g, a.to)].map((v) => Math.round(v * 1000) / 1000);
      set('L', doc.context.obj(ends));
      set('LE', doc.context.obj([N('None'), N(a.kind === 'arrow' ? 'OpenArrow' : 'None')]));
      set('C', doc.context.obj(rgb));
      border(a.width);
    }
  }
}

/** Saves changes to annotations into `doc`: adds new ones, rewrites changed ones, takes out removed ones, or flattens. */
export async function saveAnnotations(doc: PDFDocument, changes: SaveChanges): Promise<void> {
  const pages = doc.getPages();
  const flattened = changes.flatten ? changes.write.flatMap((a) => (a.source ? [a.source] : [])) : [];
  removeAnnotations(doc, [...changes.remove, ...flattened]);
  const gone = new Set([...changes.remove, ...flattened].map(keyOf));
  const texts = changes.write.flatMap((a) => (a.kind === 'text' ? [a.text] : []));
  const font = texts.length ? (await fontsFor(doc, texts)).regular : undefined;
  const drawn = new Map<PDFPage, PDFName[]>();
  for (const a of changes.write) {
    const page = pages[a.page - 1];
    if (!page) continue;
    const g = geometryOf(page);
    const built = appearance(a, g, font, changes.flatten);
    const resources: { ExtGState?: { GS0: { [key: string]: string | number } }; Font?: { F0: PDFRef } } = {};
    if (a.opacity < 1 || built.blend) {
      const state: { [key: string]: string | number } = { Type: 'ExtGState' };
      if (a.opacity < 1) {
        state.CA = Math.round(a.opacity * 1000) / 1000;
        state.ca = Math.round(a.opacity * 1000) / 1000;
      }
      if (built.blend) state.BM = 'Multiply';
      resources.ExtGState = { GS0: state };
    }
    if (built.font) resources.Font = { F0: built.font.ref };
    const content = built.blend && a.opacity >= 1 ? `/GS0 gs\n${built.content}` : built.content;
    const bbox = built.bbox.map((v) => Math.round(v * 1000) / 1000);
    const stream = doc.context.flateStream(content, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: bbox, Matrix: [1, 0, 0, 1, 0, 0], Resources: resources });
    const ap = doc.context.register(stream);
    if (changes.flatten) {
      const keys = drawn.get(page) ?? [];
      keys.push(page.node.newXObject('BtAnnot', ap));
      drawn.set(page, keys);
      continue;
    }
    const existing = a.source && !gone.has(keyOf(a.source)) ? doc.context.lookup(PDFRef.of(a.source.num, a.source.gen)) : undefined;
    if (existing instanceof PDFDict) {
      writeFields(doc, existing, page, a, g, ap, bbox);
      continue;
    }
    const dict = doc.context.obj({});
    writeFields(doc, dict, page, a, g, ap, bbox);
    page.node.addAnnot(doc.context.register(dict));
  }
  for (const [page, keys] of drawn) {
    // The page's own drawing is closed off first, so a transform it leaves behind cannot move ours.
    page.node.normalize();
    const contents = page.node.Contents();
    if (contents instanceof PDFArray && contents.size() > 0) page.node.wrapContentStreams(doc.context.register(doc.context.stream('q\n')), doc.context.register(doc.context.stream('\nQ\n')));
    const content = keys.map((key) => `q ${key.toString()} Do Q`).join('\n');
    page.node.addContentStream(doc.context.register(doc.context.flateStream(content)));
  }
  await finishFonts(doc);
}

/** A plain-text summary of the comments, page by page, in Markdown. */
export function commentsMarkdown(annotations: readonly Annotation[], title: string): string {
  const lines = [`# Comments on ${title}`, ''];
  const pages = [...new Set(annotations.map((a) => a.page))].sort((a, b) => a - b);
  for (const page of pages) {
    lines.push(`## Page ${page}`, '');
    const onPage = annotations.filter((a) => a.page === page).sort((a, b) => boundsOf(a).y - boundsOf(b).y || boundsOf(a).x - boundsOf(b).x);
    for (const a of onPage) {
      const marked = a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strike' ? a.text : a.kind === 'text' ? a.text : '';
      const parts = [`**${KIND_LABELS[a.kind]}**`];
      if (marked) parts.push(`“${marked.replace(/\s+/g, ' ')}”`);
      if (a.comment && a.comment !== marked) parts.push(a.comment.replace(/\s+/g, ' '));
      const by = [a.author, a.modified ? a.modified.slice(0, 10) : ''].filter(Boolean).join(', ');
      lines.push(`- ${parts.join(' — ')}${by ? ` (${by})` : ''}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
