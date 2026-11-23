/**
 * Android VectorDrawable XML: a reader, and writers for SVG and for Jetpack
 * Compose ImageVector code.  The SVG to VectorDrawable direction is done by
 * svg2vectordrawable; this module covers everything that starts from a
 * VectorDrawable.
 */
import { DOMParser } from '@xmldom/xmldom';
import { ToolError } from './errors';

const ANDROID = 'http://schemas.android.com/apk/res/android';
const AAPT = 'http://schemas.android.com/aapt';

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0 to 1. */
  readonly a: number;
}

export interface Stop {
  readonly offset: number;
  readonly color: Rgba;
}

export type Paint =
  | { readonly kind: 'solid'; readonly color: Rgba }
  | {
      readonly kind: 'linear';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly stops: readonly Stop[];
      readonly tile: 'clamp' | 'repeat' | 'mirror';
    }
  | { readonly kind: 'radial'; readonly cx: number; readonly cy: number; readonly r: number; readonly stops: readonly Stop[]; readonly tile: 'clamp' | 'repeat' | 'mirror' }
  | { readonly kind: 'sweep'; readonly cx: number; readonly cy: number; readonly stops: readonly Stop[] };

export interface VdPath {
  readonly kind: 'path';
  readonly name: string;
  readonly d: string;
  readonly fill: Paint | null;
  readonly fillAlpha: number;
  readonly stroke: Paint | null;
  readonly strokeAlpha: number;
  readonly strokeWidth: number;
  readonly cap: 'butt' | 'round' | 'square';
  readonly join: 'miter' | 'round' | 'bevel';
  readonly miter: number;
  readonly evenOdd: boolean;
  readonly trimStart: number;
  readonly trimEnd: number;
  readonly trimOffset: number;
}

export interface VdClip {
  readonly kind: 'clip';
  readonly name: string;
  readonly d: string;
}

export interface VdGroup {
  readonly kind: 'group';
  readonly name: string;
  readonly rotation: number;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly translateX: number;
  readonly translateY: number;
  readonly children: readonly VdNode[];
}

export type VdNode = VdPath | VdClip | VdGroup;

export interface VectorDrawable {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly unit: string;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly alpha: number;
  readonly tint: string;
  readonly autoMirrored: boolean;
  readonly children: readonly VdNode[];
}

export interface ParseResult {
  readonly drawable: VectorDrawable;
  readonly warnings: string[];
}

/* ---------------------------------------------------------------- colours -- */

/** #RGB, #ARGB, #RRGGBB and #AARRGGBB, as Android writes them. */
export function parseAndroidColor(text: string): Rgba | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(text.trim());
  if (!m) return null;
  let hex = m[1] as string;
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
  if (hex.length === 6) hex = `ff${hex}`;
  if (hex.length !== 8) return null;
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  return { a: n(0) / 255, r: n(2), g: n(4), b: n(6) };
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
export const rgbHex = (c: Rgba) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
export const argbHex = (c: Rgba) => `${hex2(c.a * 255)}${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;

/* ---------------------------------------------------------------- reading -- */

function withNamespaces(xml: string): string {
  // Snippets copied out of a project often lose the namespace declarations.
  return xml.replace(/<vector\b([^>]*)>/, (whole, attrs: string) => {
    let extra = '';
    if (!/xmlns:android=/.test(attrs) && /android:/.test(xml)) extra += ` xmlns:android="${ANDROID}"`;
    if (!/xmlns:aapt=/.test(attrs) && /aapt:/.test(xml)) extra += ` xmlns:aapt="${AAPT}"`;
    return extra ? `<vector${extra}${attrs}>` : whole;
  });
}

type El = Element;

const children = (el: El): El[] => {
  const out: El[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as El);
  return out;
};

const local = (el: El) => el.localName ?? el.nodeName.replace(/^.*:/, '');

function attr(el: El, name: string): string | null {
  const v = el.getAttributeNS(ANDROID, name);
  if (v !== null && v !== '') return v;
  const q = el.getAttribute(`android:${name}`);
  return q === null || q === '' ? null : q;
}

function num(el: El, name: string, fallback: number, warnings: string[]): number {
  const raw = attr(el, name);
  if (raw === null) return fallback;
  const value = Number.parseFloat(raw);
  if (Number.isFinite(value)) return value;
  warnings.push(`${name}="${raw}" is a resource or not a number; ${fallback} was used.`);
  return fallback;
}

function dimension(raw: string | null, fallback: number): { value: number; unit: string } {
  if (raw === null) return { value: fallback, unit: 'dp' };
  const m = /^\s*(-?[\d.]+)\s*([a-z]*)\s*$/i.exec(raw);
  if (!m) return { value: fallback, unit: 'dp' };
  return { value: Number.parseFloat(m[1] as string), unit: (m[2] as string) || 'dp' };
}

function readColor(raw: string | null, what: string, warnings: string[]): Rgba | null {
  if (raw === null) return null;
  const color = parseAndroidColor(raw);
  if (color) return color;
  warnings.push(`${what} "${raw}" refers to a resource or theme attribute; black is used in its place.`);
  return { r: 0, g: 0, b: 0, a: 1 };
}

function readGradient(el: El, warnings: string[]): Paint {
  const type = attr(el, 'type') ?? 'linear';
  const tileRaw = attr(el, 'tileMode') ?? 'clamp';
  const tile = tileRaw === 'repeat' || tileRaw === 'mirror' ? tileRaw : 'clamp';
  let stops: Stop[] = children(el)
    .filter((c) => local(c) === 'item')
    .map((item) => ({ offset: num(item, 'offset', 0, warnings), color: readColor(attr(item, 'color'), 'Gradient colour', warnings) ?? { r: 0, g: 0, b: 0, a: 1 } }));
  if (!stops.length) {
    const start = readColor(attr(el, 'startColor'), 'Gradient start colour', warnings);
    const center = readColor(attr(el, 'centerColor'), 'Gradient centre colour', warnings);
    const end = readColor(attr(el, 'endColor'), 'Gradient end colour', warnings);
    stops = [start && { offset: 0, color: start }, center && { offset: 0.5, color: center }, end && { offset: 1, color: end }].filter((s): s is Stop => !!s);
  }
  if (type === 'radial') return { kind: 'radial', cx: num(el, 'centerX', 0, warnings), cy: num(el, 'centerY', 0, warnings), r: num(el, 'gradientRadius', 0, warnings), stops, tile };
  if (type === 'sweep') return { kind: 'sweep', cx: num(el, 'centerX', 0, warnings), cy: num(el, 'centerY', 0, warnings), stops };
  return { kind: 'linear', x1: num(el, 'startX', 0, warnings), y1: num(el, 'startY', 0, warnings), x2: num(el, 'endX', 0, warnings), y2: num(el, 'endY', 0, warnings), stops, tile };
}

function readPaint(el: El, name: 'fillColor' | 'strokeColor', warnings: string[]): Paint | null {
  // <aapt:attr name="android:fillColor"><gradient .../></aapt:attr>
  for (const child of children(el)) {
    if (local(child) !== 'attr' || child.getAttribute('name') !== `android:${name}`) continue;
    const gradient = children(child).find((c) => local(c) === 'gradient');
    if (gradient) return readGradient(gradient, warnings);
  }
  const color = readColor(attr(el, name), name === 'fillColor' ? 'Fill colour' : 'Stroke colour', warnings);
  return color ? { kind: 'solid', color } : null;
}

function readNodes(el: El, warnings: string[]): VdNode[] {
  const out: VdNode[] = [];
  for (const child of children(el)) {
    const tag = local(child);
    if (tag === 'path') {
      const d = attr(child, 'pathData');
      if (!d) {
        warnings.push('A <path> without android:pathData was skipped.');
        continue;
      }
      const cap = attr(child, 'strokeLineCap');
      const join = attr(child, 'strokeLineJoin');
      out.push({
        kind: 'path',
        name: attr(child, 'name') ?? '',
        d: d.trim(),
        fill: readPaint(child, 'fillColor', warnings),
        fillAlpha: num(child, 'fillAlpha', 1, warnings),
        stroke: readPaint(child, 'strokeColor', warnings),
        strokeAlpha: num(child, 'strokeAlpha', 1, warnings),
        strokeWidth: num(child, 'strokeWidth', 0, warnings),
        cap: cap === 'round' || cap === 'square' ? cap : 'butt',
        join: join === 'round' || join === 'bevel' ? join : 'miter',
        miter: num(child, 'strokeMiterLimit', 4, warnings),
        evenOdd: attr(child, 'fillType') === 'evenOdd',
        trimStart: num(child, 'trimPathStart', 0, warnings),
        trimEnd: num(child, 'trimPathEnd', 1, warnings),
        trimOffset: num(child, 'trimPathOffset', 0, warnings),
      });
    } else if (tag === 'group') {
      out.push({
        kind: 'group',
        name: attr(child, 'name') ?? '',
        rotation: num(child, 'rotation', 0, warnings),
        pivotX: num(child, 'pivotX', 0, warnings),
        pivotY: num(child, 'pivotY', 0, warnings),
        scaleX: num(child, 'scaleX', 1, warnings),
        scaleY: num(child, 'scaleY', 1, warnings),
        translateX: num(child, 'translateX', 0, warnings),
        translateY: num(child, 'translateY', 0, warnings),
        children: readNodes(child, warnings),
      });
    } else if (tag === 'clip-path') {
      const d = attr(child, 'pathData');
      if (d) out.push({ kind: 'clip', name: attr(child, 'name') ?? '', d: d.trim() });
    } else if (tag !== 'attr') {
      warnings.push(`<${child.nodeName}> is not part of a VectorDrawable and was skipped.`);
    }
  }
  return out;
}

export function parseVectorDrawable(xml: string): ParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let doc: Document;
  try {
    doc = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') errors.push(message);
      },
    }).parseFromString(withNamespaces(xml), 'text/xml') as unknown as Document;
  } catch (error) {
    throw new ToolError(`This is not well-formed XML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = doc.documentElement;
  if (errors.length || !root) throw new ToolError(`This is not well-formed XML: ${errors[0] ?? 'no root element'}`);
  if (local(root as El) !== 'vector') throw new ToolError(`Expected a <vector> root element, found <${root.nodeName}>.`);
  const el = root as El;
  const w = dimension(attr(el, 'width'), 24);
  const h = dimension(attr(el, 'height'), 24);
  const viewportWidth = num(el, 'viewportWidth', w.value, warnings);
  const viewportHeight = num(el, 'viewportHeight', h.value, warnings);
  if (!(viewportWidth > 0 && viewportHeight > 0)) throw new ToolError('android:viewportWidth and android:viewportHeight must be above zero.');
  return {
    drawable: {
      name: attr(el, 'name') ?? '',
      width: w.value,
      height: h.value,
      unit: w.unit,
      viewportWidth,
      viewportHeight,
      alpha: num(el, 'alpha', 1, warnings),
      tint: attr(el, 'tint') ?? '',
      autoMirrored: attr(el, 'autoMirrored') === 'true',
      children: readNodes(el, warnings),
    },
    warnings,
  };
}

/* ---------------------------------------------------------------- counting -- */

export function countNodes(nodes: readonly VdNode[]): { paths: number; groups: number; clips: number; gradients: number } {
  const total = { paths: 0, groups: 0, clips: 0, gradients: 0 };
  const walk = (list: readonly VdNode[]) => {
    for (const n of list) {
      if (n.kind === 'path') {
        total.paths++;
        if (n.fill && n.fill.kind !== 'solid') total.gradients++;
        if (n.stroke && n.stroke.kind !== 'solid') total.gradients++;
      } else if (n.kind === 'clip') total.clips++;
      else {
        total.groups++;
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return total;
}

/* ------------------------------------------------------------------- SVG -- */

const fmt = (n: number) => {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Android applies a group's scale, then rotation, then translation, all about the pivot. */
function groupTransform(g: VdGroup): string {
  const parts: string[] = [];
  const tx = g.translateX + g.pivotX;
  const ty = g.translateY + g.pivotY;
  if (tx || ty) parts.push(`translate(${fmt(tx)} ${fmt(ty)})`);
  if (g.rotation) parts.push(`rotate(${fmt(g.rotation)})`);
  if (g.scaleX !== 1 || g.scaleY !== 1) parts.push(`scale(${fmt(g.scaleX)} ${fmt(g.scaleY)})`);
  if (g.pivotX || g.pivotY) parts.push(`translate(${fmt(-g.pivotX)} ${fmt(-g.pivotY)})`);
  return parts.join(' ');
}

export function toSvg(drawable: VectorDrawable, warnings: string[] = []): string {
  const defs: string[] = [];
  let ids = 0;
  const id = (prefix: string) => `${prefix}${++ids}`;

  const paintAttr = (paint: Paint | null, alpha: number, prop: 'fill' | 'stroke'): string => {
    if (!paint) return ` ${prop}="none"`;
    const opacity = (a: number) => (a * alpha < 1 ? ` ${prop}-opacity="${fmt(a * alpha)}"` : '');
    if (paint.kind === 'solid') return ` ${prop}="${rgbHex(paint.color)}"${opacity(paint.color.a)}`;
    const stops = paint.stops.map((s) => `<stop offset="${fmt(s.offset)}" stop-color="${rgbHex(s.color)}"${s.color.a < 1 ? ` stop-opacity="${fmt(s.color.a)}"` : ''}/>`).join('');
    if (paint.kind === 'sweep') {
      warnings.push('SVG has no sweep gradient; its first colour is used instead.');
      const first = paint.stops[0]?.color ?? { r: 0, g: 0, b: 0, a: 1 };
      return ` ${prop}="${rgbHex(first)}"${opacity(first.a)}`;
    }
    const spread = paint.tile === 'repeat' ? ' spreadMethod="repeat"' : paint.tile === 'mirror' ? ' spreadMethod="reflect"' : '';
    const gid = id('g');
    if (paint.kind === 'linear')
      defs.push(
        `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${fmt(paint.x1)}" y1="${fmt(paint.y1)}" x2="${fmt(paint.x2)}" y2="${fmt(paint.y2)}"${spread}>${stops}</linearGradient>`,
      );
    else defs.push(`<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${fmt(paint.cx)}" cy="${fmt(paint.cy)}" r="${fmt(paint.r)}"${spread}>${stops}</radialGradient>`);
    return ` ${prop}="url(#${gid})"${alpha < 1 ? ` ${prop}-opacity="${fmt(alpha)}"` : ''}`;
  };

  const pathEl = (p: VdPath, indent: string): string => {
    let a = ` d="${esc(p.d)}"`;
    a += paintAttr(p.fill, p.fillAlpha, 'fill');
    if (p.evenOdd) a += ' fill-rule="evenodd"';
    if (p.stroke && p.strokeWidth > 0) {
      a += paintAttr(p.stroke, p.strokeAlpha, 'stroke');
      a += ` stroke-width="${fmt(p.strokeWidth)}"`;
      if (p.cap !== 'butt') a += ` stroke-linecap="${p.cap}"`;
      if (p.join !== 'miter') a += ` stroke-linejoin="${p.join}"`;
      if (p.join === 'miter' && p.miter !== 4) a += ` stroke-miterlimit="${fmt(p.miter)}"`;
      if (p.trimStart !== 0 || p.trimEnd !== 1 || p.trimOffset !== 0) {
        // Trimming shows the part of the path between start and end, shifted by offset.
        a += ` pathLength="1" stroke-dasharray="${fmt(Math.max(0, p.trimEnd - p.trimStart))} 1" stroke-dashoffset="${fmt(-(p.trimStart + p.trimOffset))}"`;
      }
    }
    if (p.name) a = ` id="${esc(p.name)}"${a}`;
    return `${indent}<path${a}/>`;
  };

  const nodes = (list: readonly VdNode[], indent: string): string[] => {
    const lines: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i] as VdNode;
      if (n.kind === 'clip') {
        // A clip path applies to everything after it in the same group.
        const cid = id('c');
        defs.push(`<clipPath id="${cid}"><path d="${esc(n.d)}"/></clipPath>`);
        lines.push(`${indent}<g clip-path="url(#${cid})">`, ...nodes(list.slice(i + 1), `${indent}  `), `${indent}</g>`);
        break;
      }
      if (n.kind === 'path') lines.push(pathEl(n, indent));
      else {
        const transform = groupTransform(n);
        const open = `${indent}<g${n.name ? ` id="${esc(n.name)}"` : ''}${transform ? ` transform="${transform}"` : ''}>`;
        lines.push(open, ...nodes(n.children, `${indent}  `), `${indent}</g>`);
      }
    }
    return lines;
  };

  let body = nodes(drawable.children, drawable.alpha < 1 ? '    ' : '  ');
  if (drawable.alpha < 1) body = [`  <g opacity="${fmt(drawable.alpha)}">`, ...body, '  </g>'];
  if (drawable.tint) {
    const tint = parseAndroidColor(drawable.tint);
    if (tint) {
      const fid = id('t');
      defs.push(`<filter id="${fid}"><feFlood flood-color="${rgbHex(tint)}"${tint.a < 1 ? ` flood-opacity="${fmt(tint.a)}"` : ''}/><feComposite in2="SourceGraphic" operator="in"/></filter>`);
      body = [`  <g filter="url(#${fid})">`, ...body.map((l) => `  ${l}`), '  </g>'];
    } else warnings.push(`The tint "${drawable.tint}" comes from the app theme, so the colours are shown untinted.`);
  }
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(drawable.width)}" height="${fmt(drawable.height)}" viewBox="0 0 ${fmt(drawable.viewportWidth)} ${fmt(drawable.viewportHeight)}">`;
  return [head, ...(defs.length ? ['  <defs>', ...defs.map((d) => `    ${d}`), '  </defs>'] : []), ...body, '</svg>', ''].join('\n');
}

/* --------------------------------------------------------------- Compose -- */

const kf = (n: number) => `${fmt(n)}f`;
const kColor = (c: Rgba) => `Color(0x${argbHex(c)})`;

function kBrush(paint: Paint): string {
  if (paint.kind === 'solid') return `SolidColor(${kColor(paint.color)})`;
  const stops = `colorStops = arrayOf(${paint.stops.map((s) => `${kf(s.offset)} to ${kColor(s.color)}`).join(', ')})`;
  const tile = 'tile' in paint && paint.tile !== 'clamp' ? `, tileMode = TileMode.${paint.tile === 'repeat' ? 'Repeated' : 'Mirror'}` : '';
  if (paint.kind === 'linear') return `Brush.linearGradient(${stops}, start = Offset(${kf(paint.x1)}, ${kf(paint.y1)}), end = Offset(${kf(paint.x2)}, ${kf(paint.y2)})${tile})`;
  if (paint.kind === 'radial') return `Brush.radialGradient(${stops}, center = Offset(${kf(paint.cx)}, ${kf(paint.cy)}), radius = ${kf(paint.r)}${tile})`;
  return `Brush.sweepGradient(${stops}, center = Offset(${kf(paint.cx)}, ${kf(paint.cy)}))`;
}

/** A Kotlin identifier in UpperCamelCase. */
export function kotlinName(text: string, fallback = 'AppIcon'): string {
  const words = text
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const name = words.map((w) => w[0]?.toUpperCase() + w.slice(1)).join('');
  if (!name) return fallback;
  return /^[0-9]/.test(name) ? `Icon${name}` : name;
}

export function toCompose(drawable: VectorDrawable, iconName: string, packageName = 'com.example.app.ui.icons'): string {
  const name = kotlinName(iconName);
  const backing = `_${name[0]?.toLowerCase()}${name.slice(1)}`;
  const imports = new Set(['androidx.compose.ui.graphics.vector.ImageVector', 'androidx.compose.ui.unit.dp', 'androidx.compose.ui.graphics.vector.addPathNodes']);

  const pathCode = (p: VdPath, indent: string): string[] => {
    const args: string[] = [`pathData = addPathNodes("${p.d.replace(/\s+/g, ' ')}")`];
    if (p.name) args.push(`name = "${p.name.replace(/["\\$]/g, '')}"`);
    if (p.evenOdd) {
      args.push('pathFillType = PathFillType.EvenOdd');
      imports.add('androidx.compose.ui.graphics.PathFillType');
    }
    const brushImports = (paint: Paint) => {
      if (paint.kind === 'solid') imports.add('androidx.compose.ui.graphics.SolidColor');
      else {
        imports.add('androidx.compose.ui.graphics.Brush');
        imports.add('androidx.compose.ui.geometry.Offset');
        if ('tile' in paint && paint.tile !== 'clamp') imports.add('androidx.compose.ui.graphics.TileMode');
      }
      imports.add('androidx.compose.ui.graphics.Color');
    };
    if (p.fill) {
      brushImports(p.fill);
      args.push(`fill = ${kBrush(p.fill)}`);
      if (p.fillAlpha !== 1) args.push(`fillAlpha = ${kf(p.fillAlpha)}`);
    }
    if (p.stroke && p.strokeWidth > 0) {
      brushImports(p.stroke);
      args.push(`stroke = ${kBrush(p.stroke)}`, `strokeLineWidth = ${kf(p.strokeWidth)}`);
      if (p.strokeAlpha !== 1) args.push(`strokeAlpha = ${kf(p.strokeAlpha)}`);
      if (p.cap !== 'butt') {
        args.push(`strokeLineCap = StrokeCap.${p.cap === 'round' ? 'Round' : 'Square'}`);
        imports.add('androidx.compose.ui.graphics.StrokeCap');
      }
      if (p.join !== 'miter') {
        args.push(`strokeLineJoin = StrokeJoin.${p.join === 'round' ? 'Round' : 'Bevel'}`);
        imports.add('androidx.compose.ui.graphics.StrokeJoin');
      }
      if (p.miter !== 4) args.push(`strokeLineMiter = ${kf(p.miter)}`);
    }
    if (p.trimStart !== 0) args.push(`trimPathStart = ${kf(p.trimStart)}`);
    if (p.trimEnd !== 1) args.push(`trimPathEnd = ${kf(p.trimEnd)}`);
    if (p.trimOffset !== 0) args.push(`trimPathOffset = ${kf(p.trimOffset)}`);
    return [`${indent}addPath(`, ...args.map((a) => `${indent}    ${a},`), `${indent})`];
  };

  const groupArgs = (g: VdGroup): string[] => {
    const args: string[] = [];
    if (g.name) args.push(`name = "${g.name.replace(/["\\$]/g, '')}"`);
    if (g.rotation) args.push(`rotate = ${kf(g.rotation)}`);
    if (g.pivotX) args.push(`pivotX = ${kf(g.pivotX)}`);
    if (g.pivotY) args.push(`pivotY = ${kf(g.pivotY)}`);
    if (g.scaleX !== 1) args.push(`scaleX = ${kf(g.scaleX)}`);
    if (g.scaleY !== 1) args.push(`scaleY = ${kf(g.scaleY)}`);
    if (g.translateX) args.push(`translationX = ${kf(g.translateX)}`);
    if (g.translateY) args.push(`translationY = ${kf(g.translateY)}`);
    return args;
  };

  const nodes = (list: readonly VdNode[], indent: string): string[] => {
    const lines: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i] as VdNode;
      if (n.kind === 'clip') {
        imports.add('androidx.compose.ui.graphics.vector.group');
        lines.push(`${indent}group(clipPathData = addPathNodes("${n.d.replace(/\s+/g, ' ')}")) {`, ...nodes(list.slice(i + 1), `${indent}    `), `${indent}}`);
        break;
      }
      if (n.kind === 'path') lines.push(...pathCode(n, indent));
      else {
        imports.add('androidx.compose.ui.graphics.vector.group');
        const args = groupArgs(n);
        lines.push(`${indent}group(${args.join(', ')}) {`, ...nodes(n.children, `${indent}    `), `${indent}}`);
      }
    }
    return lines;
  };

  const body = nodes(drawable.children, '            ');
  const builderArgs = [
    `name = "${name}"`,
    `defaultWidth = ${fmt(drawable.width)}.dp`,
    `defaultHeight = ${fmt(drawable.height)}.dp`,
    `viewportWidth = ${kf(drawable.viewportWidth)}`,
    `viewportHeight = ${kf(drawable.viewportHeight)}`,
  ];
  if (drawable.autoMirrored) builderArgs.push('autoMirror = true');
  const tint = parseAndroidColor(drawable.tint);
  if (tint) {
    builderArgs.push(`tintColor = ${kColor(tint)}`);
    imports.add('androidx.compose.ui.graphics.Color');
  }
  const alphaNote = drawable.alpha < 1 ? `\n// The drawable's android:alpha was ${fmt(drawable.alpha)}; apply it with Modifier.alpha(${kf(drawable.alpha)}).` : '';
  return `package ${packageName}

${[...imports]
  .sort()
  .map((i) => `import ${i}`)
  .join('\n')}
${alphaNote}
val ${name}: ImageVector
    get() {
        ${backing}?.let { return it }
        return ImageVector.Builder(
${builderArgs.map((a) => `            ${a},`).join('\n')}
        ).apply {
${body.join('\n')}
        }.build().also { ${backing} = it }
    }

private var ${backing}: ImageVector? = null
`;
}
