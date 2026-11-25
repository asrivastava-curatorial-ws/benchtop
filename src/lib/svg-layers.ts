/**
 * Splits an SVG drawing into layers that can be animated one by one: every
 * top-level element becomes a small SVG of its own, with the definitions and
 * styles it needs.  Wrappers that hold the whole drawing are looked through.
 */
import { applyEdits, attr, parseXml, readSvg, svgIntrinsicSize, type XmlElement } from './xml-scan';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SvgLayer {
  readonly name: string;
  /** The elements of this layer, with the wrappers they sit in. */
  readonly body: string;
}

export interface SvgLayers {
  /** The drawing's own coordinates. */
  readonly view: Box;
  readonly layers: SvgLayer[];
  /** Attributes of the <svg> start tag other than its size. */
  readonly rootAttrs: string;
  /** Definitions and styles every layer carries. */
  readonly shared: string;
}

export const MAX_LAYERS = 60;

const DRAWN = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use', 'svg', 'a', 'switch', 'foreignObject']);
const SHARED = new Set(['defs', 'style', 'linearGradient', 'radialGradient', 'pattern', 'clipPath', 'mask', 'filter', 'marker', 'symbol']);
const local = (name: string) => name.replace(/^svg:/, '');
const elements = (parent: XmlElement) => parent.children.filter((node): node is XmlElement => node.type === 'element');
const hidden = (el: XmlElement) => attr(el, 'display') === 'none' || /(?:^|;)\s*display\s*:\s*none/.test(attr(el, 'style') ?? '');
const drawn = (parent: XmlElement) => elements(parent).filter((el) => DRAWN.has(local(el.name)) && !hidden(el));

/** Scripts and event handlers are taken out: the layers are only ever shown as pictures. */
export function withoutScripts(source: string): string {
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (el: XmlElement) => {
    if (local(el.name).toLowerCase() === 'script') {
      edits.push({ start: el.start, end: el.end, text: '' });
      return;
    }
    for (const a of el.attrs) {
      // Browsers skip spaces and control characters inside the word.
      const squeezed = [...a.value].filter((c) => c.charCodeAt(0) > 32).join('');
      const link = /(?:^|:)href$/i.test(a.name) && /^javascript:/i.test(squeezed);
      if (/^on/i.test(a.name) || link) edits.push({ start: a.start, end: a.end, text: '' });
    }
    for (const child of elements(el)) visit(child);
  };
  for (const node of parseXml(source)) if (node.type === 'element') visit(node);
  return edits.length ? applyEdits(source, edits) : source;
}

function idsIn(el: XmlElement, into: Set<string>): Set<string> {
  const id = attr(el, 'id');
  if (id) into.add(id);
  for (const child of elements(el)) idsIn(child, into);
  return into;
}

function refsIn(text: string): Set<string> {
  const refs = new Set<string>();
  for (const match of text.matchAll(/href\s*=\s*["']#([^"']+)["']|url\(\s*["']?#([^"')\s]+)["']?\s*\)/g)) refs.add((match[1] ?? match[2]) as string);
  return refs;
}

function nameOf(el: XmlElement, index: number): string {
  const title = elements(el).find((child) => local(child.name) === 'title');
  const text = title?.children.find((node) => node.type === 'text');
  const name = attr(el, 'inkscape:label') ?? attr(el, 'data-name') ?? (text?.type === 'text' ? text.value.trim() : '') ?? '';
  return (name || attr(el, 'id') || `${local(el.name)} ${index + 1}`).replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function splitSvg(input: string): SvgLayers {
  const source = withoutScripts(input);
  const info = readSvg(source);
  const size = svgIntrinsicSize(info);
  const view = info.viewBox ? { x: info.viewBox[0], y: info.viewBox[1], width: info.viewBox[2], height: info.viewBox[3] } : { x: 0, y: 0, width: size.width, height: size.height };
  if (!(view.width > 0 && view.height > 0)) throw new Error('This SVG has no size.');
  const raw = (el: XmlElement) => source.slice(el.start, el.end);
  const keep = info.root.attrs.filter((a) => !['width', 'height', 'viewBox', 'x', 'y', 'preserveAspectRatio'].includes(a.name));
  let rootAttrs = keep.map((a) => source.slice(a.start, a.end)).join(' ');
  if (!keep.some((a) => a.name === 'xmlns')) rootAttrs = `xmlns="http://www.w3.org/2000/svg" ${rootAttrs}`.trim();

  // A group that wraps the whole drawing is not a layer: its members are.
  const wrappers: XmlElement[] = [];
  let holder = info.root;
  for (let depth = 0; depth < 6; depth++) {
    const inside = drawn(holder);
    const only = inside[0];
    if (inside.length !== 1 || !only || local(only.name) !== 'g' || drawn(only).length === 0) break;
    wrappers.push(only);
    holder = only;
  }
  const sharedOf = (parent: XmlElement) =>
    elements(parent)
      .filter((el) => SHARED.has(local(el.name)))
      .map(raw)
      .join('');
  const open = wrappers.map((el) => source.slice(el.start, el.openEnd) + sharedOf(el)).join('');
  const close = wrappers.map((el) => `</${el.name}>`).join('');

  const parts = drawn(holder);
  if (parts.length === 0) throw new Error('This SVG has nothing to draw.');
  // Something one layer points at (a <use>, a clip path) may live in another: it comes along, unseen.
  const owners = new Map<string, number>();
  parts.forEach((el, index) => {
    for (const id of idsIn(el, new Set())) owners.set(id, index);
  });
  const bodyOf = (index: number): string => {
    const el = parts[index] as XmlElement;
    const needed = new Set<number>();
    const queue = [index];
    for (let step = 0; step < 40 && queue.length; step++) {
      const at = queue.shift() as number;
      for (const ref of refsIn(raw(parts[at] as XmlElement))) {
        const owner = owners.get(ref);
        if (owner !== undefined && owner !== index && !needed.has(owner)) {
          needed.add(owner);
          queue.push(owner);
        }
      }
    }
    const borrowed = needed.size ? `<defs>${[...needed].map((n) => raw(parts[n] as XmlElement)).join('')}</defs>` : '';
    return borrowed + raw(el);
  };
  // More parts than layers: neighbours share a layer.
  const per = Math.ceil(parts.length / MAX_LAYERS);
  const layers: SvgLayer[] = [];
  for (let start = 0; start < parts.length; start += per) {
    const first = parts[start] as XmlElement;
    let body = '';
    for (let index = start; index < Math.min(parts.length, start + per); index++) body += bodyOf(index);
    layers.push({ name: nameOf(first, start) + (per > 1 ? ' …' : ''), body: open + body + close });
  }
  return { view, layers, rootAttrs, shared: sharedOf(info.root) };
}

const n = (value: number) => String(Math.round(value * 1000) / 1000);

/** One layer as an SVG document of its own, showing `box` of the drawing (all of it by default). */
export function layerSvg(split: SvgLayers, index: number, box: Box = split.view): string {
  const layer = split.layers[index];
  if (!layer) throw new Error('No such layer.');
  return `<svg ${split.rootAttrs} viewBox="${n(box.x)} ${n(box.y)} ${n(box.width)} ${n(box.height)}" width="${n(box.width)}" height="${n(box.height)}">${split.shared}${layer.body}</svg>`;
}

/** An SVG document as a data URL for a picture. */
export function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/**
 * The part of a picture that is not see-through, from its pixels (RGBA):
 * a box in pixels with a pixel to spare on each side, or null when nothing is drawn.
 */
export function inkBox(data: Uint8ClampedArray | Uint8Array, width: number, height: number): Box | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if ((data[row + x * 4 + 3] as number) > 2) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const x0 = Math.max(0, left - 1);
  const y0 = Math.max(0, top - 1);
  return { x: x0, y: y0, width: Math.min(width, right + 2) - x0, height: Math.min(height, bottom + 2) - y0 };
}

export interface PlacedLayer {
  readonly name: string;
  /** The layer as a picture (data URL). */
  readonly picture: string;
  /** Centre and size on the stage, measured from the middle of the drawing. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How much a drawing is scaled to sit well on a stage: as it is when it fits, smaller when too big, larger when tiny. */
export function stageScale(view: Box, stage: { width: number; height: number }): number {
  const fit = Math.min(stage.width / view.width, stage.height / view.height);
  if (fit < 1) return fit;
  if (view.width < stage.width / 4 && view.height < stage.height / 4) return fit / 2;
  return 1;
}

/** Layers with their measured boxes (in the drawing's coordinates) as pictures placed around the drawing's middle. */
export function placeLayers(split: SvgLayers, boxes: readonly (Box | null)[], scale: number): PlacedLayer[] {
  const cx = split.view.x + split.view.width / 2;
  const cy = split.view.y + split.view.height / 2;
  const placed: PlacedLayer[] = [];
  split.layers.forEach((layer, index) => {
    const box = boxes[index];
    if (!box || !(box.width > 0 && box.height > 0)) return;
    placed.push({
      name: layer.name,
      picture: svgDataUrl(layerSvg(split, index, box)),
      x: Math.round((box.x + box.width / 2 - cx) * scale * 100) / 100,
      y: Math.round((box.y + box.height / 2 - cy) * scale * 100) / 100,
      width: Math.round(box.width * scale * 100) / 100,
      height: Math.round(box.height * scale * 100) / 100,
    });
  });
  return placed;
}
