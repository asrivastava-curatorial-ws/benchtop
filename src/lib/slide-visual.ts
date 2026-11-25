/**
 * Slides designed by hand for the Slide Deck tool: text boxes, pictures and
 * shapes placed freely on the slide.  A designed slide is kept in the deck's
 * Markdown as one block of HTML (reveal.js shows HTML in Markdown as it is),
 * so the Markdown editor, the preview and every export treat it like any
 * other slide, and a deck can mix written and designed slides.
 */
import { SEPARATOR, VERTICAL_SEPARATOR } from './slides';

export type ElementKind = 'text' | 'image' | 'shape';
export type ShapeKind = 'rect' | 'ellipse' | 'line';

export interface SlideElement {
  readonly id: string;
  readonly kind: ElementKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Degrees, clockwise. */
  readonly rotate: number;
  /** 0 to 1. */
  readonly opacity: number;
  /* text */
  readonly text?: string;
  readonly size?: number;
  /** Empty for the theme's own text colour. */
  readonly color?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly align?: 'left' | 'center' | 'right';
  readonly valign?: 'top' | 'middle' | 'bottom';
  readonly font?: 'theme' | 'sans' | 'serif' | 'mono';
  /* text boxes and shapes */
  readonly fill?: string;
  readonly radius?: number;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  /* shapes */
  readonly shape?: ShapeKind;
  /* pictures */
  readonly src?: string;
  readonly fit?: 'contain' | 'cover';
  readonly alt?: string;
}

export interface VisualSlide {
  readonly elements: readonly SlideElement[];
  /** Empty for the theme's background. */
  readonly background: string;
  readonly notes: string;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

let serial = 0;
export const newId = (): string => {
  serial += 1;
  return `e${Date.now().toString(36)}${serial.toString(36)}`;
};

const COLOUR = /^#[0-9a-f]{3,8}$/i;
const colour = (value: unknown, fallback = ''): string => (typeof value === 'string' && COLOUR.test(value) ? value.toLowerCase() : fallback);
const number = (value: unknown, fallback: number, min: number, max: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback);
const round = (value: number) => Math.round(value * 10) / 10;

/** An element as it was stored, checked: decks come from files. */
export function readElement(raw: unknown): SlideElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const kind: ElementKind | null = e.kind === 'image' || e.kind === 'shape' ? e.kind : e.kind === 'text' ? 'text' : null;
  if (!kind) return null;
  const base = {
    id: typeof e.id === 'string' && /^[\w-]{1,40}$/.test(e.id) ? e.id : newId(),
    kind,
    x: number(e.x, 0, -20000, 20000),
    y: number(e.y, 0, -20000, 20000),
    w: number(e.w, 200, 1, 20000),
    h: number(e.h, 100, 1, 20000),
    rotate: number(e.rotate, 0, -360, 360),
    opacity: number(e.opacity, 1, 0, 1),
  };
  if (kind === 'text') {
    return {
      ...base,
      text: typeof e.text === 'string' ? e.text.slice(0, 5000) : '',
      size: number(e.size, 40, 6, 600),
      color: colour(e.color),
      bold: e.bold === true,
      italic: e.italic === true,
      align: e.align === 'left' || e.align === 'right' ? e.align : 'center',
      valign: e.valign === 'top' || e.valign === 'bottom' ? e.valign : 'middle',
      font: e.font === 'sans' || e.font === 'serif' || e.font === 'mono' ? e.font : 'theme',
      fill: colour(e.fill),
      radius: number(e.radius, 0, 0, 2000),
    };
  }
  if (kind === 'shape') {
    return {
      ...base,
      shape: e.shape === 'ellipse' || e.shape === 'line' ? e.shape : 'rect',
      fill: colour(e.fill, e.shape === 'line' ? '' : '#1f6feb'),
      stroke: colour(e.stroke, e.shape === 'line' ? '#8b949e' : ''),
      strokeWidth: number(e.strokeWidth, e.shape === 'line' ? 6 : 0, 0, 200),
      radius: number(e.radius, 0, 0, 2000),
    };
  }
  const src = typeof e.src === 'string' && /^data:image\/(png|jpeg|gif|webp|svg\+xml|avif);/i.test(e.src) ? e.src : '';
  return { ...base, src, fit: e.fit === 'cover' ? 'cover' : 'contain', alt: typeof e.alt === 'string' ? e.alt.slice(0, 300) : '', radius: number(e.radius, 0, 0, 2000) };
}

const FONTS = { sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, Menlo, Consolas, monospace' } as const;

/** The CSS that places and paints an element on its slide. */
export function elementStyle(e: SlideElement): string {
  const css: string[] = ['position:absolute', `left:${round(e.x)}px`, `top:${round(e.y)}px`, `width:${round(e.w)}px`, `height:${round(e.h)}px`, 'box-sizing:border-box', 'margin:0'];
  if (e.rotate) css.push(`transform:rotate(${round(e.rotate)}deg)`);
  if (e.opacity < 1) css.push(`opacity:${Math.round(e.opacity * 100) / 100}`);
  if (e.kind === 'text') {
    css.push('display:flex', 'flex-direction:column', `justify-content:${e.valign === 'top' ? 'flex-start' : e.valign === 'bottom' ? 'flex-end' : 'center'}`);
    css.push(
      `text-align:${e.align ?? 'center'}`,
      `font-size:${round(e.size ?? 40)}px`,
      `font-weight:${e.bold ? 700 : 400}`,
      `font-style:${e.italic ? 'italic' : 'normal'}`,
      'line-height:1.2',
      'white-space:pre-wrap',
      'text-transform:none',
      'letter-spacing:normal',
    );
    if (e.color) css.push(`color:${e.color}`);
    if (e.font && e.font !== 'theme') css.push(`font-family:${FONTS[e.font]}`);
    if (e.fill) css.push(`background:${e.fill}`, 'padding:0 0.4em');
    if (e.radius) css.push(`border-radius:${round(e.radius)}px`);
  } else if (e.kind === 'shape') {
    if (e.shape === 'line') {
      // A line runs along the middle of its box.
      css.push(`background:linear-gradient(${e.stroke || '#8b949e'},${e.stroke || '#8b949e'}) center / 100% ${round(Math.max(1, e.strokeWidth ?? 6))}px no-repeat`);
    } else {
      if (e.fill) css.push(`background:${e.fill}`);
      if (e.stroke && (e.strokeWidth ?? 0) > 0) css.push(`border:${round(e.strokeWidth ?? 0)}px solid ${e.stroke}`);
      css.push(e.shape === 'ellipse' ? 'border-radius:50%' : `border-radius:${round(e.radius ?? 0)}px`);
    }
  } else {
    css.push(`object-fit:${e.fit ?? 'contain'}`, 'max-width:none', 'max-height:none', 'border:0', 'box-shadow:none', 'background:none');
    if (e.radius) css.push(`border-radius:${round(e.radius)}px`);
  }
  return css.join(';');
}

const toHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fromHtml = (text: string) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const OPEN = '<div class="bt-visual"';

/** The slide's elements as the block of HTML kept in the deck: one line an element, and no empty line (which would end the block in Markdown). */
export function visualHtml(slide: VisualSlide, size: Size): string {
  const lines = slide.elements.map((e) => {
    const { src, ...kept } = e;
    const data = toHtml(JSON.stringify(kept));
    const style = toHtml(elementStyle(e));
    if (e.kind === 'image') return `<img class="bt-el" data-v="${data}" style="${style}" alt="${toHtml(e.alt ?? '')}" src="${toHtml(src ?? '')}">`;
    const inner = e.kind === 'text' ? toHtml(e.text ?? '').replace(/\r?\n/g, '<br>') : '';
    return `<div class="bt-el" data-v="${data}" style="${style}">${inner}</div>`;
  });
  // As tall and wide as the slide: reveal.js then centres nothing, and the block covers the slide exactly.
  return [`${OPEN} style="position:relative;width:${size.width}px;height:${size.height}px;margin:0;text-align:left">`, ...lines, '</div>'].join('\n');
}

const BACKGROUND = /^<!--\s*\.slide:\s*data-background-color="(#[0-9a-fA-F]{3,8})"\s*-->\s*$/m;
const NOTES = /^Note:\s?/m;

/** A designed slide as it is written into the deck: its background, its block, then its speaker notes. */
export function visualSource(slide: VisualSlide, size: Size): string {
  const parts: string[] = [];
  if (slide.background) parts.push(`<!-- .slide: data-background-color="${slide.background}" -->`);
  parts.push(visualHtml(slide, size));
  if (slide.notes.trim()) parts.push(`\nNote: ${slide.notes.trim()}`);
  return parts.join('\n');
}

/** Reads a slide's Markdown as a designed slide, or null when it is a written one. */
export function readVisual(source: string): VisualSlide | null {
  const start = source.indexOf(OPEN);
  if (start < 0) return null;
  const end = source.indexOf('\n</div>', start);
  if (end < 0) return null;
  const before = source.slice(0, start);
  const after = source.slice(end + '\n</div>'.length);
  const background = BACKGROUND.exec(before)?.[1]?.toLowerCase() ?? '';
  // Anything else written on the slide means it is not purely a designed one.
  if (before.replace(BACKGROUND, '').trim()) return null;
  const note = NOTES.exec(after);
  if (after.slice(0, note ? note.index : undefined).trim()) return null;
  const notes = note ? after.slice(note.index + note[0].length).trim() : '';
  const elements: SlideElement[] = [];
  for (const line of source.slice(start, end).split('\n').slice(1)) {
    const data = /\sdata-v="([^"]*)"/.exec(line)?.[1];
    if (data === undefined) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(fromHtml(data));
    } catch {
      continue;
    }
    const src = /\ssrc="([^"]*)"/.exec(line)?.[1];
    const element = readElement(src === undefined ? raw : { ...(raw as object), src: fromHtml(src) });
    if (element) elements.push(element);
  }
  return { elements, background, notes };
}

/* ------------------------------------------------------- the deck -- */

const SPLIT = new RegExp(`${SEPARATOR}|${VERTICAL_SEPARATOR}`, 'g');

export interface DeckParts {
  /** The Markdown of every slide, in order. */
  readonly slides: string[];
  /** What stands between slide n and slide n + 1: "---" for a new column, "--" for a slide below. */
  readonly joins: ('---' | '--')[];
}

export function splitDeck(markdown: string): DeckParts {
  const slides: string[] = [];
  const joins: ('---' | '--')[] = [];
  let start = 0;
  for (const match of markdown.matchAll(SPLIT)) {
    slides.push(markdown.slice(start, match.index));
    joins.push(match[0].trim() === '---' ? '---' : '--');
    start = (match.index ?? 0) + match[0].length;
  }
  slides.push(markdown.slice(start));
  return { slides, joins };
}

export function joinDeck(parts: DeckParts): string {
  let out = '';
  parts.slides.forEach((slide, index) => {
    out += slide.replace(/^\n+|\n+$/g, '');
    const join = parts.joins[index];
    if (index < parts.slides.length - 1) out += `\n\n${join ?? '---'}\n\n`;
  });
  return `${out}\n`;
}

/** Where slide `index` is shown: its column and its place in the column. */
export function positionOf(parts: DeckParts, index: number): { h: number; v: number } {
  let h = 0;
  let v = 0;
  for (let i = 0; i < index && i < parts.joins.length; i++) {
    if (parts.joins[i] === '---') {
      h += 1;
      v = 0;
    } else v += 1;
  }
  return { h, v };
}

export const replaceSlide = (markdown: string, index: number, source: string): string => {
  const parts = splitDeck(markdown);
  if (index < 0 || index >= parts.slides.length) return markdown;
  parts.slides[index] = source;
  return joinDeck(parts);
};

export function insertSlide(markdown: string, after: number, source: string): string {
  const parts = splitDeck(markdown);
  const at = Math.min(Math.max(after + 1, 0), parts.slides.length);
  parts.slides.splice(at, 0, source);
  parts.joins.splice(Math.max(0, at - 1), 0, '---');
  return joinDeck(parts);
}

export function removeSlide(markdown: string, index: number): string {
  const parts = splitDeck(markdown);
  if (parts.slides.length <= 1 || index < 0 || index >= parts.slides.length) return markdown;
  parts.slides.splice(index, 1);
  // The join before a removed slide goes with it; a slide that led a column hands the column to the next one.
  const gone = index === 0 ? 0 : index - 1;
  const [taken] = parts.joins.splice(gone, 1);
  if (index > 0 && taken === '---' && parts.joins[gone] === '--') parts.joins[gone] = '---';
  return joinDeck(parts);
}

export function moveSlide(markdown: string, index: number, step: number): string {
  const parts = splitDeck(markdown);
  const to = index + step;
  if (index < 0 || to < 0 || index >= parts.slides.length || to >= parts.slides.length) return markdown;
  const [moved] = parts.slides.splice(index, 1);
  parts.slides.splice(to, 0, moved as string);
  return joinDeck(parts);
}

/** What a slide is called in the list of slides: its heading, its first words, or what kind of slide it is. */
export function slideTitle(source: string): string {
  const visual = readVisual(source);
  if (visual) {
    const texts = visual.elements.filter((e) => e.kind === 'text' && (e.text ?? '').trim());
    const biggest = texts.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0];
    return biggest?.text?.trim().split('\n')[0]?.slice(0, 60) || (visual.elements.some((e) => e.kind === 'image') ? 'Picture' : 'Empty slide');
  }
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(source);
  const line =
    heading?.[1] ??
    source
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('<!--') && !l.startsWith('Note:')) ??
    '';
  return (
    line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, 'Picture')
      .replace(/[*_`[\]#>]/g, '')
      .trim()
      .slice(0, 60) || 'Empty slide'
  );
}

/* -------------------------------------------------- new slides -- */

export type Layout = 'blank' | 'title' | 'content' | 'two' | 'picture';
export const LAYOUTS: readonly (readonly [Layout, string])[] = [
  ['title', 'Title'],
  ['content', 'Title and text'],
  ['two', 'Two columns'],
  ['picture', 'Picture and caption'],
  ['blank', 'Blank'],
];

const textBox = (x: number, y: number, w: number, h: number, text: string, size: number, more: Partial<SlideElement> = {}): SlideElement =>
  readElement({ kind: 'text', id: newId(), x, y, w, h, text, size, ...more }) as SlideElement;

/** A new slide laid out for its size, with words to replace. */
export function layoutSlide(layout: Layout, size: Size): VisualSlide {
  const { width: w, height: h } = size;
  const m = Math.round(w * 0.07);
  const title = Math.round(h * 0.095);
  const body = Math.round(h * 0.05);
  const elements: SlideElement[] = [];
  if (layout === 'title') {
    elements.push(textBox(m, h * 0.3, w - 2 * m, h * 0.22, 'Title', Math.round(h * 0.13), { bold: true }));
    elements.push(textBox(m, h * 0.55, w - 2 * m, h * 0.12, 'Subtitle', body));
  } else if (layout === 'content') {
    elements.push(textBox(m, h * 0.07, w - 2 * m, h * 0.16, 'Title', title, { bold: true, align: 'left' }));
    elements.push(textBox(m, h * 0.27, w - 2 * m, h * 0.6, '• First point\n• Second point\n• Third point', body, { align: 'left', valign: 'top' }));
  } else if (layout === 'two') {
    const column = (w - 3 * m) / 2;
    elements.push(textBox(m, h * 0.07, w - 2 * m, h * 0.16, 'Title', title, { bold: true, align: 'left' }));
    elements.push(textBox(m, h * 0.27, column, h * 0.6, 'Left column', body, { align: 'left', valign: 'top' }));
    elements.push(textBox(2 * m + column, h * 0.27, column, h * 0.6, 'Right column', body, { align: 'left', valign: 'top' }));
  } else if (layout === 'picture') {
    elements.push(readElement({ kind: 'shape', id: newId(), shape: 'rect', x: m, y: h * 0.08, w: w - 2 * m, h: h * 0.68, fill: '#30363d', radius: 12 }) as SlideElement);
    elements.push(textBox(m, h * 0.8, w - 2 * m, h * 0.12, 'Caption: drop a picture on the slide', body));
  }
  return { elements, background: '', notes: '' };
}

/**
 * A written slide as a designed one, as far as plain text goes: its heading becomes the
 * title box, its text a body box, and embedded pictures picture boxes.
 */
export function fromMarkdown(source: string, size: Size): VisualSlide {
  const { width: w, height: h } = size;
  const m = Math.round(w * 0.07);
  const note = NOTES.exec(source);
  const notes = note ? source.slice(note.index + note[0].length).trim() : '';
  const background = BACKGROUND.exec(source)?.[1]?.toLowerCase() ?? '';
  const lines = source
    .slice(0, note ? note.index : undefined)
    .split('\n')
    .filter((line) => !line.trim().startsWith('<!--'));
  const elements: SlideElement[] = [];
  const pictures: string[] = [];
  let heading = '';
  const text: string[] = [];
  for (const line of lines) {
    const found = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (found && !heading) {
      heading = found[1] as string;
      continue;
    }
    let rest = line.replace(/!\[[^\]]*\]\((data:image\/[^)\s]+)\)/g, (_, src: string) => {
      pictures.push(src);
      return '';
    });
    rest = rest
      .replace(/^(\s*)[-*+]\s+/, '$1• ')
      .replace(/^#{1,6}\s+/, '')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s*<!--.*?-->\s*/g, '');
    text.push(rest);
  }
  const body = text
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const clean = (value: string) => value.replace(/[*_`]/g, '');
  if (heading) elements.push(textBox(m, h * 0.07, w - 2 * m, h * 0.16, clean(heading), Math.round(h * 0.095), { bold: true, align: body || pictures.length ? 'left' : 'center' }));
  const top = heading ? h * 0.27 : h * 0.1;
  const room = h * 0.92 - top;
  const share = pictures.length && body ? 0.5 : 1;
  if (body) elements.push(textBox(m, top, (w - 2 * m) * share - (pictures.length ? m / 2 : 0), room, body, Math.round(h * 0.05), { align: 'left', valign: 'top' }));
  pictures.forEach((src, index) => {
    const left = body ? m + (w - 2 * m) * 0.5 + m / 2 : m;
    const wide = body ? (w - 2 * m) * 0.5 - m / 2 : w - 2 * m;
    const each = room / pictures.length;
    const made = readElement({ kind: 'image', id: newId(), src, x: left, y: top + index * each, w: wide, h: each - 8 });
    if (made) elements.push(made);
  });
  return { elements, background, notes };
}

/* ------------------------------------------------- snapping -- */

export interface Guide {
  readonly axis: 'x' | 'y';
  readonly at: number;
}

/**
 * Moves a box the last few pixels so that an edge or its middle lines up with the slide's
 * edges and middle, or with another element.  Returns the box's new corner and the lines it met.
 */
export function snapMove(
  box: { x: number; y: number; w: number; h: number },
  others: readonly { x: number; y: number; w: number; h: number }[],
  size: Size,
  reach: number,
): { x: number; y: number; guides: Guide[] } {
  const xs = [0, size.width / 2, size.width];
  const ys = [0, size.height / 2, size.height];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const nearest = (start: number, length: number, lines: number[]) => {
    let best: { shift: number; at: number } | null = null;
    for (const line of lines) {
      for (const part of [0, length / 2, length]) {
        const shift = line - (start + part);
        if (Math.abs(shift) <= reach && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, at: line };
      }
    }
    return best;
  };
  const sx = nearest(box.x, box.w, xs);
  const sy = nearest(box.y, box.h, ys);
  const guides: Guide[] = [];
  if (sx) guides.push({ axis: 'x', at: sx.at });
  if (sy) guides.push({ axis: 'y', at: sy.at });
  return { x: box.x + (sx?.shift ?? 0), y: box.y + (sy?.shift ?? 0), guides };
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** A box after one of its handles is dragged by (dx, dy); it never gets smaller than `least`, and Shift keeps its shape. */
export function resizeBox(box: { x: number; y: number; w: number; h: number }, handle: Handle, dx: number, dy: number, keepShape: boolean, least = 8): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = box;
  if (handle.includes('e')) w = Math.max(least, box.w + dx);
  if (handle.includes('s')) h = Math.max(least, box.h + dy);
  if (handle.includes('w')) {
    w = Math.max(least, box.w - dx);
    x = box.x + box.w - w;
  }
  if (handle.includes('n')) {
    h = Math.max(least, box.h - dy);
    y = box.y + box.h - h;
  }
  if (keepShape && handle.length === 2 && box.w > 0 && box.h > 0) {
    const ratio = box.w / box.h;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    if (handle.includes('w')) x = box.x + box.w - w;
    if (handle.includes('n')) y = box.y + box.h - h;
  }
  return { x, y, w, h };
}
