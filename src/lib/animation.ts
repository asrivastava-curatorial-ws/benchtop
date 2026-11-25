/**
 * Motion design for the Animation Studio, in Theatre.js's own terms: a
 * project holds a sheet ("Scene") of objects whose props are either static
 * or sequenced with keyframes, stored exactly as Theatre.js stores a
 * project's state, so @theatre/core plays the result as it is.
 *
 * The editor draws frames with the functions below, which repeat what
 * @theatre/core does to find a value between keyframes (the same bezier
 * solver, number blending and OKLab colour blending; Apache-2.0, from
 * github.com/theatre-js/theatre).  The test suite checks them against
 * @theatre/core itself.  Playback in the editor and in saved pages runs on
 * @theatre/core.
 */

import { licenceComment } from './slides';
import { flatten, parsePathData } from './vector';

/* ----------------------------------------------------------- the model -- */

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export type ShapeKind = 'box' | 'ellipse' | 'text' | 'picture' | 'group' | 'clip';

export const SHAPE_LABELS: Record<ShapeKind, string> = { box: 'Box', ellipse: 'Ellipse', text: 'Text', picture: 'Picture', group: 'Group', clip: 'Clip' };

export type PropKey = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'scale' | 'opacity' | 'radius' | 'fontSize' | 'fill' | 'progress';

export interface PropSpec {
  readonly key: PropKey;
  readonly label: string;
  readonly type: 'number' | 'rgba';
  readonly step?: number;
  readonly range?: readonly [number, number];
  /** Shapes the prop means something for (all of them when absent). */
  readonly only?: readonly ShapeKind[];
}

/** Every object has the same props, so its Theatre.js configuration never depends on the shape. */
export const PROPS: readonly PropSpec[] = [
  { key: 'x', label: 'X', type: 'number', step: 1 },
  { key: 'y', label: 'Y', type: 'number', step: 1 },
  { key: 'width', label: 'Width', type: 'number', step: 1, only: ['box', 'ellipse', 'text', 'picture', 'clip'] },
  { key: 'height', label: 'Height', type: 'number', step: 1, only: ['box', 'ellipse', 'text', 'picture', 'clip'] },
  { key: 'rotation', label: 'Rotation (°)', type: 'number', step: 1 },
  { key: 'scale', label: 'Scale', type: 'number', step: 0.05 },
  { key: 'opacity', label: 'Opacity', type: 'number', step: 0.05, range: [0, 1] },
  { key: 'radius', label: 'Corner radius', type: 'number', step: 1, only: ['box', 'picture'] },
  { key: 'fontSize', label: 'Text size', type: 'number', step: 1, only: ['text'] },
  { key: 'fill', label: 'Colour', type: 'rgba', only: ['box', 'ellipse', 'text'] },
  // How far along its motion path an object is; it only matters for objects that have a path.
  { key: 'progress', label: 'Along the path', type: 'number', step: 0.01, range: [0, 1] },
];

export const propSpec = (key: string) => PROPS.find((p) => p.key === key);

export type PropValue = number | Rgba;
export type PropValues = Record<PropKey, PropValue> & { fill: Rgba };

export interface AnimObject {
  /** The object's key in Theatre.js, also its name in the editor. */
  readonly key: string;
  readonly kind: ShapeKind;
  /** What a text object says (not animated). */
  readonly text?: string;
  /** A picture object's image, as a data URL. */
  readonly picture?: string;
  /** A motion path (SVG path data, in the coordinates of the stage or of its group): the object sits on it at `progress`. */
  readonly path?: string;
  /** With a path: turn to face the way the path runs. */
  readonly follow?: boolean;
  /** The group this object is in; its position is then measured from the group's centre. */
  readonly parent?: string;
  /** A clip plays a nested animation (`AnimProject.clips`): which one, when it starts, how fast, and whether it repeats. */
  readonly clip?: string;
  readonly start?: number;
  readonly speed?: number;
  readonly loop?: boolean;
}

export interface Soundtrack {
  readonly name: string;
  /** The audio file as a data URL. */
  readonly src: string;
}

export interface Stage {
  readonly width: number;
  readonly height: number;
  readonly background: string;
}

export interface Keyframe {
  readonly id: string;
  readonly position: number;
  readonly value: PropValue;
  readonly handles: readonly [number, number, number, number];
  readonly connectedRight: boolean;
  readonly type?: 'bezier' | 'hold';
}

export interface Track {
  readonly type: 'BasicKeyframedTrack';
  readonly __debugName?: string;
  readonly keyframes: readonly Keyframe[];
}

export interface SequenceState {
  readonly type: 'PositionalSequence';
  readonly length: number;
  readonly subUnitsPerUnit: number;
  readonly tracksByObject: Record<string, { readonly trackIdByPropPath: Record<string, string>; readonly trackData: Record<string, Track> }>;
}

export interface SheetState {
  readonly staticOverrides: { readonly byObject: Record<string, Record<string, unknown>> };
  readonly sequence?: SequenceState;
}

/** A project's state as @theatre/core reads it (`getProject(id, { state })`). */
export interface TheatreState {
  readonly sheetsById: Record<string, SheetState>;
  readonly definitionVersion: string;
  readonly revisionHistory: readonly string[];
}

export interface AnimProject {
  readonly name: string;
  readonly sheet: string;
  readonly stage: Stage;
  readonly objects: readonly AnimObject[];
  readonly state: TheatreState;
  /** Nested animations that clip objects play, by id. */
  readonly clips?: Readonly<Record<string, AnimProject>>;
  readonly audio?: Soundtrack;
}

export const DEFINITION_VERSION = '0.4.0';

/* -------------------------------------------------------------- colour -- */

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

export function hexToRgba(hex: string, alpha = 1): Rgba {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0, a: alpha };
  let h = m[1] as string;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: alpha };
}

export const rgbaToHex = (c: Rgba) =>
  `#${[c.r, c.g, c.b]
    .map((v) =>
      Math.round(clamp01(v) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

export const rgbaCss = (c: Rgba) => `rgba(${Math.round(clamp01(c.r) * 255)}, ${Math.round(clamp01(c.g) * 255)}, ${Math.round(clamp01(c.b) * 255)}, ${Number(clamp01(c.a).toFixed(4))})`;

function srgbToLinear(c: Rgba): Rgba {
  const expand = (x: number) => (x >= 0.04045 ? ((x + 0.055) / (1 + 0.055)) ** 2.4 : x / 12.92);
  return { r: expand(c.r), g: expand(c.g), b: expand(c.b), a: c.a };
}

function linearToSrgb(c: Rgba): Rgba {
  const compress = (x: number) => (x >= 0.0031308 ? 1.055 * x ** (1.0 / 2.4) - 0.055 : 12.92 * x);
  return { r: clamp01(compress(c.r)), g: clamp01(compress(c.g)), b: clamp01(compress(c.b)), a: clamp01(c.a) };
}

function linearToOklab(c: Rgba) {
  const l = Math.cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
  const m = Math.cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
  const s = Math.cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha: c.a,
  };
}

function oklabToLinear(lab: { L: number; a: number; b: number; alpha: number }): Rgba {
  const l = (lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;
  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    a: lab.alpha,
  };
}

/** Colours blend in OKLab, as Theatre.js does, so the middle of a fade stays bright. */
export function blendRgba(left: Rgba, right: Rgba, p: number): Rgba {
  const a = linearToOklab(srgbToLinear(left));
  const b = linearToOklab(srgbToLinear(right));
  return linearToSrgb(oklabToLinear({ L: (1 - p) * a.L + p * b.L, a: (1 - p) * a.a + p * b.a, b: (1 - p) * a.b + p * b.b, alpha: (1 - p) * a.alpha + p * b.alpha }));
}

/* ------------------------------------------------------------- easing -- */

/** The cubic bezier solver Theatre.js uses (timing-function's UnitBezier). */
export class UnitBezier {
  private readonly cx: number;
  private readonly bx: number;
  private readonly ax: number;
  private readonly cy: number;
  private readonly by: number;
  private readonly ay: number;

  constructor(p1x: number, p1y: number, p2x: number, p2y: number) {
    this.cx = 3.0 * p1x;
    this.bx = 3.0 * (p2x - p1x) - this.cx;
    this.ax = 1.0 - this.cx - this.bx;
    this.cy = 3.0 * p1y;
    this.by = 3.0 * (p2y - p1y) - this.cy;
    this.ay = 1.0 - this.cy - this.by;
  }

  private sampleX(t: number) {
    return ((this.ax * t + this.bx) * t + this.cx) * t;
  }

  private sampleY(t: number) {
    return ((this.ay * t + this.by) * t + this.cy) * t;
  }

  private slopeX(t: number) {
    return (3.0 * this.ax * t + 2.0 * this.bx) * t + this.cx;
  }

  private solveX(x: number, epsilon: number): number {
    let t2 = x;
    for (let i = 0; i < 8; i++) {
      const x2 = this.sampleX(t2) - x;
      if (Math.abs(x2) < epsilon) return t2;
      const d2 = this.slopeX(t2);
      if (Math.abs(d2) < epsilon) break;
      t2 -= x2 / d2;
    }
    let t0 = 0.0;
    let t1 = 1.0;
    t2 = x;
    if (t2 < t0) return t0;
    if (t2 > t1) return t1;
    while (t0 < t1) {
      const x2 = this.sampleX(t2);
      if (Math.abs(x2 - x) < epsilon) return t2;
      if (x > x2) t0 = t2;
      else t1 = t2;
      t2 = (t1 - t0) * 0.5 + t0;
    }
    return t2;
  }

  solveSimple(x: number): number {
    return this.sampleY(this.solveX(x, 1e-6));
  }
}

export type Curve = readonly [number, number, number, number];

/** Easing between two keyframes, offered in the editor. */
export const EASINGS: Readonly<Record<string, Curve>> = {
  Linear: [0, 0, 1, 1],
  Smooth: [0.5, 0, 0.5, 1],
  Ease: [0.25, 0.1, 0.25, 1],
  'Ease in': [0.42, 0, 1, 1],
  'Ease out': [0, 0, 0.58, 1],
  'Ease in-out': [0.42, 0, 0.58, 1],
  'Back out': [0.34, 1.56, 0.64, 1],
  'Back in': [0.36, 0, 0.66, -0.56],
  Snappy: [0.2, 0.9, 0.1, 1],
};

/** Theatre.js's handles for a new keyframe: a smooth start and end. */
export const DEFAULT_HANDLES: readonly [number, number, number, number] = [0.5, 1, 0.5, 0];

/* ------------------------------------------------------------- values -- */

export const DEFAULTS: Record<ShapeKind, PropValues> = {
  box: { x: 640, y: 360, width: 200, height: 200, rotation: 0, scale: 1, opacity: 1, radius: 16, fontSize: 48, fill: hexToRgba('#2f81f7'), progress: 0 },
  ellipse: { x: 640, y: 360, width: 200, height: 200, rotation: 0, scale: 1, opacity: 1, radius: 0, fontSize: 48, fill: hexToRgba('#f78166'), progress: 0 },
  text: { x: 640, y: 360, width: 640, height: 120, rotation: 0, scale: 1, opacity: 1, radius: 0, fontSize: 72, fill: hexToRgba('#f0f6fc'), progress: 0 },
  picture: { x: 640, y: 360, width: 320, height: 240, rotation: 0, scale: 1, opacity: 1, radius: 0, fontSize: 48, fill: hexToRgba('#ffffff'), progress: 0 },
  group: { x: 640, y: 360, width: 0, height: 0, rotation: 0, scale: 1, opacity: 1, radius: 0, fontSize: 48, fill: hexToRgba('#ffffff'), progress: 0 },
  clip: { x: 640, y: 360, width: 480, height: 270, rotation: 0, scale: 1, opacity: 1, radius: 0, fontSize: 48, fill: hexToRgba('#ffffff'), progress: 0 },
};

function sanitize(spec: PropSpec, value: unknown): PropValue | undefined {
  if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return spec.range ? Math.min(Math.max(value, spec.range[0]), spec.range[1]) : value;
  }
  if (!value || typeof value !== 'object') return undefined;
  const c = value as Record<string, unknown>;
  for (const k of ['r', 'g', 'b', 'a']) if (typeof c[k] !== 'number') return undefined;
  return { r: clamp01(c.r as number), g: clamp01(c.g as number), b: clamp01(c.b as number), a: clamp01(c.a as number) };
}

const interpolate = (spec: PropSpec, left: PropValue, right: PropValue, p: number): PropValue =>
  spec.type === 'number' ? (left as number) + p * ((right as number) - (left as number)) : blendRgba(left as Rgba, right as Rgba, p);

interface Triple {
  readonly left: unknown;
  readonly right?: unknown;
  readonly progression: number;
}

function between(left: Keyframe, right: Keyframe, t: number): Triple {
  if (!left.connectedRight) return { left: left.value, progression: 0 };
  const local = (t - left.position) / (right.position - left.position);
  if (!left.type || left.type === 'bezier') {
    const solver = new UnitBezier(left.handles[2], left.handles[3], right.handles[0], right.handles[1]);
    return { left: left.value, right: right.value, progression: solver.solveSimple(local) };
  }
  return { left: left.value, right: right.value, progression: Math.floor(local) };
}

/** Where a sorted track stands at time `t`: the same walk as @theatre/core's. */
export function tripleAt(keyframes: readonly Keyframe[], t: number): Triple | undefined {
  if (keyframes.length === 0) return undefined;
  let i = 0;
  for (;;) {
    const current = keyframes[i] as Keyframe;
    const last = i === keyframes.length - 1;
    if (t < current.position) return i === 0 ? { left: current.value, progression: 0 } : undefined;
    if (current.position === t) return last ? { left: current.value, progression: 0 } : between(current, keyframes[i + 1] as Keyframe, t);
    if (last) return { left: current.value, progression: 0 };
    if ((keyframes[i + 1] as Keyframe).position <= t) {
      i++;
      continue;
    }
    return between(current, keyframes[i + 1] as Keyframe, t);
  }
}

export const pathKey = (prop: string) => JSON.stringify([prop]);

export function trackOf(project: AnimProject, key: string, prop: string): Track | undefined {
  const objectTracks = project.state.sheetsById[project.sheet]?.sequence?.tracksByObject[key];
  const id = objectTracks?.trackIdByPropPath[pathKey(prop)];
  return id ? objectTracks?.trackData[id] : undefined;
}

export const objectOf = (project: AnimProject, key: string) => project.objects.find((o) => o.key === key);

/** Every prop of an object at time `t`. */
export function valuesAt(project: AnimProject, key: string, t: number): PropValues {
  const kind = objectOf(project, key)?.kind ?? 'box';
  const statics = project.state.sheetsById[project.sheet]?.staticOverrides.byObject[key] ?? {};
  const out = { ...DEFAULTS[kind] } as Record<PropKey, PropValue>;
  for (const spec of PROPS) {
    const fallback = DEFAULTS[kind][spec.key];
    let value = sanitize(spec, statics[spec.key]) ?? fallback;
    const track = trackOf(project, key, spec.key);
    const triple = track ? tripleAt(track.keyframes, t) : undefined;
    if (triple) {
      const left = sanitize(spec, triple.left) ?? fallback;
      value = triple.right === undefined ? left : interpolate(spec, left, sanitize(spec, triple.right) ?? fallback, triple.progression);
    }
    out[spec.key] = value;
  }
  return out as PropValues;
}

/* ------------------------------------------------------------ editing -- */

let counter = 0;
const newId = () => {
  counter = (counter + 1) % 1_000_000;
  const random = typeof crypto !== 'undefined' && 'getRandomValues' in crypto ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 2 ** 32);
  return `${(random ?? 0).toString(36)}${counter.toString(36)}`.slice(0, 10).padEnd(10, '0');
};

export const sequenceOf = (project: AnimProject): SequenceState =>
  project.state.sheetsById[project.sheet]?.sequence ?? { type: 'PositionalSequence', length: 5, subUnitsPerUnit: 30, tracksByObject: {} };

/** Snaps a time to the sequence's frame grid. */
export function snap(project: AnimProject, t: number): number {
  const fps = sequenceOf(project).subUnitsPerUnit || 30;
  return Math.max(0, Math.round(t * fps) / fps);
}

function withSheet(project: AnimProject, change: (sheet: SheetState) => SheetState): AnimProject {
  const sheet = project.state.sheetsById[project.sheet] ?? { staticOverrides: { byObject: {} } };
  return { ...project, state: { ...project.state, sheetsById: { ...project.state.sheetsById, [project.sheet]: change(sheet) } } };
}

function withSequence(project: AnimProject, change: (sequence: SequenceState) => SequenceState): AnimProject {
  const sequence = sequenceOf(project);
  return withSheet(project, (sheet) => ({ ...sheet, sequence: change(sequence) }));
}

function withTrack(project: AnimProject, key: string, prop: string, change: (track: Track | undefined) => Track | undefined): AnimProject {
  return withSequence(project, (sequence) => {
    const objectTracks = sequence.tracksByObject[key] ?? { trackIdByPropPath: {}, trackData: {} };
    const path = pathKey(prop);
    const id = objectTracks.trackIdByPropPath[path];
    const next = change(id ? objectTracks.trackData[id] : undefined);
    const trackIdByPropPath = { ...objectTracks.trackIdByPropPath };
    const trackData = { ...objectTracks.trackData };
    if (next) {
      const trackId = id ?? newId();
      trackIdByPropPath[path] = trackId;
      trackData[trackId] = next;
    } else if (id) {
      delete trackIdByPropPath[path];
      delete trackData[id];
    }
    const tracksByObject = { ...sequence.tracksByObject };
    if (Object.keys(trackIdByPropPath).length) tracksByObject[key] = { trackIdByPropPath, trackData };
    else delete tracksByObject[key];
    return { ...sequence, tracksByObject };
  });
}

/** Sets the value a prop has when it is not animated. */
export function setStatic(project: AnimProject, key: string, prop: PropKey, value: PropValue): AnimProject {
  return withSheet(project, (sheet) => ({
    ...sheet,
    staticOverrides: { byObject: { ...sheet.staticOverrides.byObject, [key]: { ...(sheet.staticOverrides.byObject[key] ?? {}), [prop]: value } } },
  }));
}

const SAME = 1e-6;

/**
 * Sets a prop's value at time `t`: a keyframe there when the prop is
 * animated (added or updated), otherwise its static value.
 */
export function setValueAt(project: AnimProject, key: string, prop: PropKey, t: number, value: PropValue): AnimProject {
  const track = trackOf(project, key, prop);
  if (!track) return setStatic(project, key, prop, value);
  return setKeyframe(project, key, prop, t, value);
}

/** Adds a keyframe at `t` (or changes the one there). */
export function setKeyframe(project: AnimProject, key: string, prop: PropKey, t: number, value: PropValue): AnimProject {
  const position = snap(project, t);
  return withTrack(project, key, prop, (track) => {
    const keyframes = [...(track?.keyframes ?? [])];
    const at = keyframes.findIndex((k) => Math.abs(k.position - position) < SAME);
    if (at >= 0) keyframes[at] = { ...(keyframes[at] as Keyframe), value };
    else keyframes.push({ id: newId(), position, value, handles: [...DEFAULT_HANDLES], connectedRight: true, type: 'bezier' });
    keyframes.sort((a, b) => a.position - b.position);
    return { type: 'BasicKeyframedTrack', __debugName: track?.__debugName ?? `${key}:${pathKey(prop)}`, keyframes };
  });
}

/** Starts animating a prop, with a first keyframe at `t` holding its current value. */
export function animate(project: AnimProject, key: string, prop: PropKey, t: number): AnimProject {
  if (trackOf(project, key, prop)) return project;
  const value = valuesAt(project, key, t)[prop];
  return setKeyframe(project, key, prop, t, value);
}

/** Stops animating a prop; it keeps the value it had at `t`. */
export function stopAnimating(project: AnimProject, key: string, prop: PropKey, t: number): AnimProject {
  const value = valuesAt(project, key, t)[prop];
  return setStatic(
    withTrack(project, key, prop, () => undefined),
    key,
    prop,
    value,
  );
}

export function keyframeAt(project: AnimProject, key: string, prop: string, t: number): Keyframe | undefined {
  const position = snap(project, t);
  return trackOf(project, key, prop)?.keyframes.find((k) => Math.abs(k.position - position) < SAME);
}

/** Removes a keyframe; removing the last one turns the prop static at that keyframe's value. */
export function removeKeyframe(project: AnimProject, key: string, prop: PropKey, id: string): AnimProject {
  const track = trackOf(project, key, prop);
  const gone = track?.keyframes.find((k) => k.id === id);
  if (!track || !gone) return project;
  if (track.keyframes.length === 1)
    return setStatic(
      withTrack(project, key, prop, () => undefined),
      key,
      prop,
      gone.value,
    );
  return withTrack(project, key, prop, (t) => (t ? { ...t, keyframes: t.keyframes.filter((k) => k.id !== id) } : t));
}

/** Moves a keyframe in time; it stays put if another keyframe holds the new time. */
export function moveKeyframe(project: AnimProject, key: string, prop: PropKey, id: string, t: number): AnimProject {
  const position = snap(project, t);
  return withTrack(project, key, prop, (track) => {
    if (!track) return track;
    if (track.keyframes.some((k) => k.id !== id && Math.abs(k.position - position) < SAME)) return track;
    const keyframes = track.keyframes.map((k) => (k.id === id ? { ...k, position } : k)).sort((a, b) => a.position - b.position);
    return { ...track, keyframes };
  });
}

export type Easing = Curve | 'hold';

/** The easing from a keyframe to the next one. */
export function setEasing(project: AnimProject, key: string, prop: PropKey, id: string, easing: Easing): AnimProject {
  return withTrack(project, key, prop, (track) => {
    if (!track) return track;
    const at = track.keyframes.findIndex((k) => k.id === id);
    if (at < 0) return track;
    const keyframes = [...track.keyframes];
    const start = keyframes[at] as Keyframe;
    if (easing === 'hold') {
      keyframes[at] = { ...start, type: 'hold', connectedRight: true };
      return { ...track, keyframes };
    }
    keyframes[at] = { ...start, type: 'bezier', connectedRight: true, handles: [start.handles[0], start.handles[1], easing[0], easing[1]] };
    const next = keyframes[at + 1];
    if (next) keyframes[at + 1] = { ...next, handles: [easing[2], easing[3], next.handles[2], next.handles[3]] };
    return { ...track, keyframes };
  });
}

/** The easing leaving a keyframe, by preset name when it matches one. */
export function easingOf(project: AnimProject, key: string, prop: string, id: string): string {
  const keyframes = trackOf(project, key, prop)?.keyframes ?? [];
  const at = keyframes.findIndex((k) => k.id === id);
  const start = keyframes[at];
  const next = keyframes[at + 1];
  if (!start || !next) return '';
  if (!start.connectedRight || start.type === 'hold') return 'Hold';
  const curve = [start.handles[2], start.handles[3], next.handles[0], next.handles[1]];
  const name = Object.entries(EASINGS).find(([, c]) => c.every((v, i) => Math.abs(v - (curve[i] as number)) < 1e-4))?.[0];
  return name ?? 'Custom';
}

export function setLength(project: AnimProject, seconds: number): AnimProject {
  const length = Math.min(600, Math.max(0.1, Math.round(seconds * 100) / 100));
  return withSequence(project, (s) => ({ ...s, length }));
}

export function setFps(project: AnimProject, fps: number): AnimProject {
  const subUnitsPerUnit = Math.min(120, Math.max(1, Math.round(fps)));
  return withSequence(project, (s) => ({ ...s, subUnitsPerUnit }));
}

/** A name Theatre.js accepts for an object: 3 to 32 characters, no spaces at the ends. */
export function cleanName(name: string): string {
  const clean = name
    .replace(/[^\p{L}\p{N} _-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
    .trim();
  return clean.length >= 3 ? clean : `${clean || 'Object'} 1`.slice(0, 32);
}

export function uniqueName(project: AnimProject, wanted: string, except?: string): string {
  const base = cleanName(wanted);
  const taken = new Set(project.objects.map((o) => o.key).filter((k) => k !== except));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base.slice(0, 28)} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function addObject(project: AnimProject, kind: ShapeKind, extra: Partial<AnimObject> = {}): { project: AnimProject; key: string } {
  const key = uniqueName(project, extra.key ?? SHAPE_LABELS[kind]);
  const object: AnimObject = { kind, ...extra, key };
  let next: AnimProject = { ...project, objects: [...project.objects, object] };
  const values = DEFAULTS[kind];
  const stage = project.stage;
  for (const spec of PROPS) {
    const value = spec.key === 'x' ? stage.width / 2 : spec.key === 'y' ? stage.height / 2 : values[spec.key];
    next = setStatic(next, key, spec.key, value);
  }
  return { project: next, key };
}

export function removeObject(input: AnimProject, key: string): AnimProject {
  // What was inside a removed group stays where it is on the stage.
  let project = input;
  for (const child of input.objects.filter((o) => o.parent === key)) project = setParent(project, child.key, objectOf(input, key)?.parent);
  const next = withSheet({ ...project, objects: project.objects.filter((o) => o.key !== key) }, (sheet) => {
    const byObject = { ...sheet.staticOverrides.byObject };
    delete byObject[key];
    const sequence = sheet.sequence ? { ...sheet.sequence, tracksByObject: { ...sheet.sequence.tracksByObject } } : undefined;
    if (sequence) delete sequence.tracksByObject[key];
    return { ...sheet, staticOverrides: { byObject }, ...(sequence ? { sequence } : {}) };
  });
  return next;
}

export function renameObject(project: AnimProject, key: string, wanted: string): AnimProject {
  const name = uniqueName(project, wanted, key);
  if (name === key) return project;
  return withSheet({ ...project, objects: project.objects.map((o) => (o.key === key ? { ...o, key: name } : o.parent === key ? { ...o, parent: name } : o)) }, (sheet) => {
    const byObject = { ...sheet.staticOverrides.byObject };
    if (byObject[key]) {
      byObject[name] = byObject[key] as Record<string, unknown>;
      delete byObject[key];
    }
    let sequence = sheet.sequence;
    if (sequence?.tracksByObject[key]) {
      const tracksByObject = { ...sequence.tracksByObject };
      const moved = tracksByObject[key] as SequenceState['tracksByObject'][string];
      const trackData = Object.fromEntries(Object.entries(moved.trackData).map(([id, track]) => [id, { ...track, __debugName: track.__debugName?.replace(key, name) }]));
      tracksByObject[name] = { ...moved, trackData };
      delete tracksByObject[key];
      sequence = { ...sequence, tracksByObject };
    }
    return { ...sheet, staticOverrides: { byObject }, ...(sequence ? { sequence } : {}) };
  });
}

export function updateObject(project: AnimProject, key: string, change: Partial<Omit<AnimObject, 'key' | 'kind'>>): AnimProject {
  return { ...project, objects: project.objects.map((o) => (o.key === key ? { ...o, ...change } : o)) };
}

/** Moves an object up or down the drawing order (later objects are drawn on top). */
export function reorderObject(project: AnimProject, key: string, step: number): AnimProject {
  const objects = [...project.objects];
  const at = objects.findIndex((o) => o.key === key);
  const moved = objects[at];
  const way = Math.sign(step);
  if (!moved || way === 0) return project;
  // The order among an object's own siblings is what shows: members of other groups are stepped over.
  let to = at + way;
  while (objects[to] && objects[to]?.parent !== moved.parent) to += way;
  const other = objects[to];
  if (!other) return project;
  objects[at] = other;
  objects[to] = moved;
  return { ...project, objects };
}

/** Every keyframe time in the project, for jumping between them. */
export function keyframeTimes(project: AnimProject): number[] {
  const times = new Set<number>();
  for (const objectTracks of Object.values(sequenceOf(project).tracksByObject)) for (const track of Object.values(objectTracks.trackData)) for (const k of track.keyframes) times.add(k.position);
  return [...times].sort((a, b) => a - b);
}

/* -------------------------------------------------------------- files -- */

export function emptyProject(name = 'Benchtop animation'): AnimProject {
  return {
    name,
    sheet: 'Scene',
    stage: { width: 1280, height: 720, background: '#0d1117' },
    objects: [],
    state: {
      sheetsById: { Scene: { staticOverrides: { byObject: {} }, sequence: { type: 'PositionalSequence', length: 4, subUnitsPerUnit: 30, tracksByObject: {} } } },
      definitionVersion: DEFINITION_VERSION,
      revisionHistory: [],
    },
  };
}

const FILE_KIND = 'benchtop-animation';

/** The editor's own file: the Theatre.js state plus what Theatre.js does not keep (shapes, text, pictures, stage). */
export function projectFile(project: AnimProject): string {
  return `${JSON.stringify(projectData(project), null, 2)}\n`;
}

function projectData(project: AnimProject): Record<string, unknown> {
  return {
    kind: FILE_KIND,
    version: 1,
    name: project.name,
    sheet: project.sheet,
    stage: project.stage,
    objects: project.objects,
    state: project.state,
    ...(project.clips && Object.keys(project.clips).length ? { clips: Object.fromEntries(Object.entries(project.clips).map(([id, clip]) => [id, projectData(clip)])) } : {}),
    ...(project.audio ? { audio: project.audio } : {}),
  };
}

/** The Theatre.js project state on its own, for `getProject(name, { state })`. */
export function theatreStateFile(project: AnimProject): string {
  return `${JSON.stringify(project.state, null, 2)}\n`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const KINDS: readonly ShapeKind[] = ['box', 'ellipse', 'text', 'picture', 'group', 'clip'];

function readState(raw: unknown): TheatreState {
  if (!isRecord(raw) || !isRecord(raw.sheetsById)) throw new Error('This is not a Theatre.js project: it has no "sheetsById".');
  if (raw.definitionVersion !== DEFINITION_VERSION)
    throw new Error(`This Theatre.js state is version ${String(raw.definitionVersion)}; version ${DEFINITION_VERSION} is supported (Theatre.js 0.4 to 0.7).`);
  const sheetsById: Record<string, SheetState> = {};
  for (const [id, sheet] of Object.entries(raw.sheetsById)) {
    if (!isRecord(sheet)) continue;
    const byObject = isRecord(sheet.staticOverrides) && isRecord(sheet.staticOverrides.byObject) ? (sheet.staticOverrides.byObject as Record<string, Record<string, unknown>>) : {};
    const seq = isRecord(sheet.sequence) ? sheet.sequence : null;
    const tracksByObject: SequenceState['tracksByObject'] = {};
    if (seq && isRecord(seq.tracksByObject)) {
      for (const [key, value] of Object.entries(seq.tracksByObject)) {
        if (!isRecord(value) || !isRecord(value.trackIdByPropPath) || !isRecord(value.trackData)) continue;
        const trackData: Record<string, Track> = {};
        for (const [trackId, track] of Object.entries(value.trackData)) {
          if (!isRecord(track) || !Array.isArray(track.keyframes)) continue;
          const keyframes = track.keyframes
            .filter((k): k is Record<string, unknown> => isRecord(k) && typeof k.position === 'number' && Number.isFinite(k.position))
            .map((k) => ({
              id: typeof k.id === 'string' ? k.id : newId(),
              position: k.position as number,
              value: k.value as PropValue,
              handles: (Array.isArray(k.handles) && k.handles.length === 4 && k.handles.every((h) => typeof h === 'number') ? k.handles : [...DEFAULT_HANDLES]) as [number, number, number, number],
              connectedRight: k.connectedRight !== false,
              ...(k.type === 'hold' || k.type === 'bezier' ? { type: k.type as 'hold' | 'bezier' } : {}),
            }))
            .sort((a, b) => a.position - b.position);
          trackData[trackId] = { type: 'BasicKeyframedTrack', ...(typeof track.__debugName === 'string' ? { __debugName: track.__debugName } : {}), keyframes };
        }
        tracksByObject[key] = { trackIdByPropPath: value.trackIdByPropPath as Record<string, string>, trackData };
      }
    }
    sheetsById[id] = {
      staticOverrides: { byObject },
      ...(seq
        ? {
            sequence: {
              type: 'PositionalSequence',
              length: typeof seq.length === 'number' && seq.length > 0 ? seq.length : 5,
              subUnitsPerUnit: typeof seq.subUnitsPerUnit === 'number' && seq.subUnitsPerUnit > 0 ? seq.subUnitsPerUnit : 30,
              tracksByObject,
            },
          }
        : {}),
    };
  }
  return {
    sheetsById,
    definitionVersion: DEFINITION_VERSION,
    revisionHistory: Array.isArray(raw.revisionHistory) ? raw.revisionHistory.filter((r): r is string => typeof r === 'string').slice(0, 50) : [],
  };
}

/**
 * Opens the editor's own file, or a bare Theatre.js state (from
 * `studio.createContentOfSaveFile()`), whose objects become boxes: the state
 * says how props move, not what the objects look like.
 */
export function readProjectFile(text: string): AnimProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not JSON. Open an animation saved by Benchtop or a Theatre.js state file.');
  }
  return readProjectData(raw, 0);
}

function readProjectData(raw: unknown, depth: number): AnimProject {
  if (!isRecord(raw)) throw new Error('This file does not hold an animation.');
  const own = raw.kind === FILE_KIND;
  const state = readState(own ? raw.state : raw);
  const sheetIds = Object.keys(state.sheetsById);
  const sheet = own && typeof raw.sheet === 'string' && state.sheetsById[raw.sheet] ? raw.sheet : (sheetIds[0] ?? 'Scene');
  if (!state.sheetsById[sheet]) (state.sheetsById as Record<string, SheetState>)[sheet] = { staticOverrides: { byObject: {} } };
  const stageRaw = own && isRecord(raw.stage) ? raw.stage : {};
  const stage: Stage = {
    width: typeof stageRaw.width === 'number' && stageRaw.width >= 16 && stageRaw.width <= 7680 ? stageRaw.width : 1280,
    height: typeof stageRaw.height === 'number' && stageRaw.height >= 16 && stageRaw.height <= 4320 ? stageRaw.height : 720,
    background: typeof stageRaw.background === 'string' && /^#[0-9a-f]{6}$/i.test(stageRaw.background) ? stageRaw.background : '#0d1117',
  };
  const sheetState = state.sheetsById[sheet] as SheetState;
  const listed = own && Array.isArray(raw.objects) ? raw.objects.filter(isRecord) : [];
  const objects: AnimObject[] = [];
  const seen = new Set<string>();
  for (const o of listed) {
    if (typeof o.key !== 'string' || seen.has(o.key)) continue;
    seen.add(o.key);
    const kind = KINDS.includes(o.kind as ShapeKind) ? (o.kind as ShapeKind) : 'box';
    objects.push({
      key: o.key,
      kind,
      ...(typeof o.text === 'string' ? { text: o.text.slice(0, 2000) } : {}),
      ...(typeof o.picture === 'string' && o.picture.startsWith('data:image/') ? { picture: o.picture } : {}),
      ...(typeof o.path === 'string' && o.path.length <= 20_000 && pathTable(o.path).total > 0 ? { path: o.path } : {}),
      ...(o.follow === true ? { follow: true } : {}),
      ...(typeof o.parent === 'string' ? { parent: o.parent } : {}),
      ...(typeof o.clip === 'string' ? { clip: o.clip } : {}),
      ...(typeof o.start === 'number' && Number.isFinite(o.start) ? { start: o.start } : {}),
      ...(typeof o.speed === 'number' && Number.isFinite(o.speed) && o.speed > 0 ? { speed: o.speed } : {}),
      ...(o.loop === true ? { loop: true } : {}),
    });
  }
  // Only groups hold other objects, and never in a circle.
  for (const [index, o] of objects.entries()) {
    const chain = new Set([o.key]);
    let up = o.parent;
    let sound = true;
    while (up !== undefined) {
      const parent = objects.find((candidate) => candidate.key === up);
      if (parent?.kind !== 'group' || chain.has(up)) {
        sound = false;
        break;
      }
      chain.add(up);
      up = parent.parent;
    }
    if (!sound) {
      const { parent: _dropped, ...rest } = o;
      objects[index] = rest;
    }
  }
  const clips: Record<string, AnimProject> = {};
  if (own && depth === 0 && isRecord(raw.clips)) {
    for (const [id, clip] of Object.entries(raw.clips)) {
      try {
        clips[id] = readProjectData(clip, depth + 1);
      } catch {
        /* A clip that cannot be read is left out; its object shows as empty. */
      }
    }
  }
  const audioRaw = own && isRecord(raw.audio) ? raw.audio : null;
  const audio =
    audioRaw && typeof audioRaw.src === 'string' && /^data:audio\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,/i.test(audioRaw.src.slice(0, 120))
      ? { name: typeof audioRaw.name === 'string' ? audioRaw.name.slice(0, 120) : 'Soundtrack', src: audioRaw.src }
      : undefined;
  // Objects the state mentions but the file does not describe.
  for (const key of [...Object.keys(sheetState.staticOverrides.byObject), ...Object.keys(sheetState.sequence?.tracksByObject ?? {})]) {
    if (seen.has(key)) continue;
    seen.add(key);
    objects.push({ key, kind: 'box' });
  }
  return {
    name: own && typeof raw.name === 'string' && raw.name.trim().length >= 3 ? raw.name.trim().slice(0, 32) : 'Benchtop animation',
    sheet,
    stage,
    objects,
    state,
    ...(Object.keys(clips).length ? { clips } : {}),
    ...(audio ? { audio } : {}),
  };
}

/* ------------------------------------------- paths, groups and clips -- */

export interface PathTable {
  /** x and y of the points along the path. */
  readonly points: number[];
  /** Distance from the start to each point. */
  readonly lengths: number[];
  readonly total: number;
}

const tables = new Map<string, PathTable>();

/** A motion path as a run of short straight pieces with their lengths (kept for the next frame). */
export function pathTable(d: string): PathTable {
  const known = tables.get(d);
  if (known) return known;
  const points: number[] = [];
  const lengths: number[] = [];
  let total = 0;
  try {
    for (const path of parsePathData(d)) {
      const line = flatten(path, 0.25);
      if (path.closed && line[0]) line.push(line[0]);
      line.forEach(([x, y], index) => {
        const px = points[points.length - 2];
        const py = points[points.length - 1];
        // A jump to a new sub-path adds no distance.
        if (px !== undefined && py !== undefined && index > 0) total += Math.hypot(x - px, y - py);
        points.push(x, y);
        lengths.push(total);
      });
    }
  } catch {
    /* Path data that cannot be read gives an empty table: the object stays where it is. */
  }
  const table = { points, lengths, total };
  if (tables.size > 200) tables.clear();
  tables.set(d, table);
  return table;
}

/** The place `progress` (0 to 1) along a path, and the direction of travel there in degrees. */
export function pointOnPath(table: PathTable, progress: number): { x: number; y: number; angle: number } | null {
  const count = table.lengths.length;
  if (count === 0) return null;
  if (count === 1 || table.total <= 0) return { x: table.points[0] as number, y: table.points[1] as number, angle: 0 };
  const wanted = clamp01(progress) * table.total;
  let low = 0;
  let high = count - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((table.lengths[middle] as number) <= wanted) low = middle;
    else high = middle;
  }
  const span = (table.lengths[high] as number) - (table.lengths[low] as number);
  const part = span > 0 ? (wanted - (table.lengths[low] as number)) / span : 0;
  const ax = table.points[low * 2] as number;
  const ay = table.points[low * 2 + 1] as number;
  const bx = table.points[high * 2] as number;
  const by = table.points[high * 2 + 1] as number;
  return { x: ax + (bx - ax) * part, y: ay + (by - ay) * part, angle: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI };
}

/** An object's values with its motion path applied: the path gives the position, and the direction when it follows. */
export function onPath(object: Pick<AnimObject, 'path' | 'follow'> | undefined, values: PropValues): PropValues {
  if (!object?.path) return values;
  const place = pointOnPath(pathTable(object.path), values.progress as number);
  if (!place) return values;
  return { ...values, x: place.x, y: place.y, rotation: (values.rotation as number) + (object.follow ? place.angle : 0) };
}

/** Ready-made motion paths, sized to a stage. */
export function presetPath(kind: 'line' | 'arc' | 'circle' | 'wave' | 'eight', width: number, height: number): string {
  const n = (value: number) => String(Math.round(value));
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.35;
  switch (kind) {
    case 'line':
      return `M${n(width * 0.15)} ${n(cy)}L${n(width * 0.85)} ${n(cy)}`;
    case 'arc':
      return `M${n(width * 0.15)} ${n(height * 0.75)}Q${n(cx)} ${n(height * 0.05)} ${n(width * 0.85)} ${n(height * 0.75)}`;
    case 'circle':
      return `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx + r)} ${n(cy)}`;
    case 'wave': {
      const step = (width * 0.7) / 4;
      const x0 = width * 0.15;
      return `M${n(x0)} ${n(cy)}Q${n(x0 + step / 2)} ${n(cy - r)} ${n(x0 + step)} ${n(cy)}T${n(x0 + step * 2)} ${n(cy)}T${n(x0 + step * 3)} ${n(cy)}T${n(x0 + step * 4)} ${n(cy)}`;
    }
    default:
      return `M${n(cx)} ${n(cy)}C${n(cx + r * 1.6)} ${n(cy - r * 1.2)} ${n(cx + r * 1.6)} ${n(cy + r * 1.2)} ${n(cx)} ${n(cy)}C${n(cx - r * 1.6)} ${n(cy - r * 1.2)} ${n(cx - r * 1.6)} ${n(cy + r * 1.2)} ${n(cx)} ${n(cy)}`;
  }
}

/** A smooth path through clicked points (Catmull-Rom, written as cubic curves). */
export function smoothPath(points: readonly (readonly [number, number])[]): string {
  const n = (value: number) => String(Math.round(value * 10) / 10);
  const first = points[0];
  if (!first) return '';
  let d = `M${n(first[0])} ${n(first[1])}`;
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = points[Math.max(0, i - 1)] as readonly [number, number];
    const p1 = points[i] as readonly [number, number];
    const p2 = points[i + 1] as readonly [number, number];
    const p3 = points[Math.min(points.length - 1, i + 2)] as readonly [number, number];
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}

/** The objects directly inside a group, or at the top when `parent` is undefined, in drawing order. */
export const childrenOf = (project: AnimProject, parent: string | undefined): AnimObject[] => project.objects.filter((o) => o.parent === parent);

/** Where a group's centre is on the stage when nothing is animated, through the groups it is in. */
function restOrigin(project: AnimProject, key: string | undefined): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const seen = new Set<string>();
  for (let at = key; at !== undefined && !seen.has(at); at = objectOf(project, at)?.parent) {
    seen.add(at);
    const values = valuesAt(project, at, 0);
    x += values.x as number;
    y += values.y as number;
  }
  return { x, y };
}

function shiftProp(project: AnimProject, key: string, prop: 'x' | 'y', by: number): AnimProject {
  if (by === 0) return project;
  return withSheet(project, (sheet) => {
    const statics = sheet.staticOverrides.byObject[key] ?? {};
    const current = typeof statics[prop] === 'number' ? (statics[prop] as number) : (DEFAULTS[objectOf(project, key)?.kind ?? 'box'][prop] as number);
    const byObject = { ...sheet.staticOverrides.byObject, [key]: { ...statics, [prop]: current + by } };
    let sequence = sheet.sequence;
    const tracks = sequence?.tracksByObject[key];
    const id = tracks?.trackIdByPropPath[pathKey(prop)];
    const track = id && tracks ? tracks.trackData[id] : undefined;
    if (sequence && tracks && id && track) {
      const moved = { ...track, keyframes: track.keyframes.map((k) => (typeof k.value === 'number' ? { ...k, value: k.value + by } : k)) };
      sequence = { ...sequence, tracksByObject: { ...sequence.tracksByObject, [key]: { ...tracks, trackData: { ...tracks.trackData, [id]: moved } } } };
    }
    return { ...sheet, staticOverrides: { byObject }, ...(sequence ? { sequence } : {}) };
  });
}

/**
 * Puts an object into a group (or takes it out, with `parent` undefined).  It stays where it
 * is on the stage: its position, keyframes and motion path are re-measured from the group's centre.
 */
export function setParent(project: AnimProject, key: string, parent: string | undefined): AnimProject {
  const object = objectOf(project, key);
  if (!object || object.parent === parent || parent === key) return project;
  if (parent !== undefined) {
    if (objectOf(project, parent)?.kind !== 'group') return project;
    // A group cannot go inside itself, however deep.
    for (let at: string | undefined = parent; at !== undefined; at = objectOf(project, at)?.parent) if (at === key) return project;
  }
  const from = restOrigin(project, object.parent);
  const to = restOrigin(project, parent);
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  let next = shiftProp(shiftProp(project, key, 'x', dx), key, 'y', dy);
  next = {
    ...next,
    objects: next.objects.map((o) => {
      if (o.key !== key) return o;
      const { parent: _old, ...rest } = o;
      const moved = o.path && (dx !== 0 || dy !== 0) ? { ...rest, path: shiftPath(o.path, dx, dy) } : rest;
      return parent === undefined ? moved : { ...moved, parent };
    }),
  };
  return next;
}

/** Everything inside a group, however deep. */
export function descendantsOf(project: AnimProject, key: string): AnimObject[] {
  const found: AnimObject[] = [];
  const visit = (parent: string, depth: number) => {
    if (depth > 32) return;
    for (const child of childrenOf(project, parent)) {
      found.push(child);
      visit(child.key, depth + 1);
    }
  };
  visit(key, 0);
  return found;
}

/** Removes an object and, for a group, everything inside it. */
export function removeTree(project: AnimProject, key: string): AnimProject {
  let next = project;
  // Innermost first, so nothing is moved out of a group that is about to go.
  for (const child of descendantsOf(project, key).reverse()) next = removeObject(next, child.key);
  return pruneClips(removeObject(next, key));
}

/** Takes an object off its motion path: it returns to its own position. */
export function clearPath(project: AnimProject, key: string): AnimProject {
  const object = objectOf(project, key);
  if (!object?.path) return project;
  const next = trackOf(project, key, 'progress') ? stopAnimating(project, key, 'progress', 0) : project;
  return {
    ...next,
    objects: next.objects.map((o) => {
      if (o.key !== key) return o;
      const { path: _path, follow: _follow, ...rest } = o;
      return rest;
    }),
  };
}

/**
 * A place on the stage as the same place measured inside a group (which may be moved,
 * turned or scaled, and may sit in other groups), at time `t`.  With `offset` false it
 * converts a movement instead of a place.
 */
export function localPoint(project: AnimProject, parent: string | undefined, x: number, y: number, t: number, offset = true): { x: number; y: number } {
  const chain: AnimObject[] = [];
  const seen = new Set<string>();
  for (let at = parent; at !== undefined && !seen.has(at); at = objectOf(project, at)?.parent) {
    seen.add(at);
    const group = objectOf(project, at);
    if (group) chain.unshift(group);
  }
  let px = x;
  let py = y;
  // Outermost group first: each one undoes its own move, turn and scale.
  for (const group of chain) {
    const v = onPath(group, valuesAt(project, group.key, t));
    const angle = (-(v.rotation as number) * Math.PI) / 180;
    const scale = (v.scale as number) || 1;
    const dx = px - (offset ? (v.x as number) : 0);
    const dy = py - (offset ? (v.y as number) : 0);
    px = (dx * Math.cos(angle) - dy * Math.sin(angle)) / scale;
    py = (dx * Math.sin(angle) + dy * Math.cos(angle)) / scale;
  }
  return { x: px, y: py };
}

/** Path data moved by (dx, dy). */
export function shiftPath(d: string, dx: number, dy: number): string {
  const n = (value: number) => String(Math.round(value * 100) / 100);
  let out = '';
  try {
    for (const path of parsePathData(d)) {
      path.nodes.forEach((node, index) => {
        const previous = path.nodes[index - 1];
        if (index === 0) out += `M${n(node.x + dx)} ${n(node.y + dy)}`;
        else if (previous?.hout || node.hin) {
          const c1 = previous?.hout ?? [previous?.x ?? node.x, previous?.y ?? node.y];
          const c2 = node.hin ?? [node.x, node.y];
          out += `C${n(c1[0] + dx)} ${n(c1[1] + dy)} ${n(c2[0] + dx)} ${n(c2[1] + dy)} ${n(node.x + dx)} ${n(node.y + dy)}`;
        } else out += `L${n(node.x + dx)} ${n(node.y + dy)}`;
      });
      if (path.closed) {
        const first = path.nodes[0];
        const last = path.nodes[path.nodes.length - 1];
        if (first && last && (last.hout || first.hin)) {
          const c1 = last.hout ?? [last.x, last.y];
          const c2 = first.hin ?? [first.x, first.y];
          out += `C${n(c1[0] + dx)} ${n(c1[1] + dy)} ${n(c2[0] + dx)} ${n(c2[1] + dy)} ${n(first.x + dx)} ${n(first.y + dy)}`;
        }
        out += 'Z';
      }
    }
  } catch {
    return d;
  }
  return out;
}

/** The time inside a clip's own animation when the main timeline is at `t`. */
export function clipTime(object: Pick<AnimObject, 'start' | 'speed' | 'loop'>, t: number, length: number): number {
  const local = (t - (object.start ?? 0)) * (object.speed ?? 1);
  if (length <= 0) return 0;
  if (object.loop) return local < 0 ? 0 : local % length;
  return Math.min(Math.max(local, 0), length);
}

/** A project as it is kept inside another one: a clip cannot hold clips of its own, nor a soundtrack. */
export function asClip(project: AnimProject): AnimProject {
  const { clips: _nested, audio: _sound, ...plain } = project;
  let inner: AnimProject = plain;
  for (const o of plain.objects) if (o.kind === 'clip') inner = removeObject(inner, o.key);
  return inner;
}

/**
 * The box that holds everything in a group, in the group's own coordinates
 * (turns of the members are not counted), or null for an empty group.
 */
export function groupBounds(project: AnimProject, key: string, t: number, depth = 0): { x: number; y: number; width: number; height: number } | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const child of childrenOf(project, key)) {
    const v = onPath(child, valuesAt(project, child.key, t));
    const scale = Math.abs(v.scale as number);
    const x = v.x as number;
    const y = v.y as number;
    let box: { x: number; y: number; width: number; height: number } | null;
    if (child.kind === 'group') {
      const inner = depth < 16 ? groupBounds(project, child.key, t, depth + 1) : null;
      box = inner && { x: x + inner.x * scale, y: y + inner.y * scale, width: inner.width * scale, height: inner.height * scale };
    } else {
      const width = Math.max(0, v.width as number) * scale;
      const height = Math.max(0, v.height as number) * scale;
      box = { x: x - width / 2, y: y - height / 2, width, height };
    }
    if (!box) continue;
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return right >= left ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

/** Adds another animation as a clip: it is kept inside this project and played by a clip object. */
export function addClip(project: AnimProject, clip: AnimProject, wanted: string): { project: AnimProject; key: string } {
  let id = cleanName(wanted) || 'Clip';
  for (let n = 2; project.clips?.[id]; n++) id = `${cleanName(wanted) || 'Clip'} ${n}`;
  const inner = asClip(clip);
  const added = addObject({ ...project, clips: { ...project.clips, [id]: inner } }, 'clip', { key: wanted, clip: id });
  const fit = Math.min(1, (project.stage.width * 0.6) / inner.stage.width, (project.stage.height * 0.6) / inner.stage.height);
  let next = setStatic(added.project, added.key, 'width', Math.round(inner.stage.width * fit));
  next = setStatic(next, added.key, 'height', Math.round(inner.stage.height * fit));
  return { project: next, key: added.key };
}

/** Clips nobody plays any more are dropped from the project. */
export function pruneClips(project: AnimProject): AnimProject {
  if (!project.clips) return project;
  const used = new Set(project.objects.map((o) => o.clip).filter(Boolean));
  const kept = Object.fromEntries(Object.entries(project.clips).filter(([id]) => used.has(id)));
  if (Object.keys(kept).length === Object.keys(project.clips).length) return project;
  const { clips: _all, ...rest } = project;
  return Object.keys(kept).length ? { ...rest, clips: kept } : rest;
}

/* ------------------------------------------------------------ drawing -- */

/** CSS for an object with the given values, on a stage measured in pixels. */
export function objectStyle(kind: ShapeKind, v: PropValues): Record<string, string> {
  const width = Math.max(0, v.width as number);
  const height = Math.max(0, v.height as number);
  const style: Record<string, string> = {
    left: `${(v.x as number) - width / 2}px`,
    top: `${(v.y as number) - height / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
    transform: `rotate(${v.rotation as number}deg) scale(${v.scale as number})`,
    opacity: String(v.opacity),
  };
  if (kind === 'box' || kind === 'ellipse') style.background = rgbaCss(v.fill);
  if (kind === 'box' || kind === 'picture') style.borderRadius = `${Math.max(0, v.radius as number)}px`;
  if (kind === 'ellipse') style.borderRadius = '50%';
  if (kind === 'text') {
    style.color = rgbaCss(v.fill);
    style.fontSize = `${Math.max(1, v.fontSize as number)}px`;
  }
  return style;
}

/**
 * The same drawing as objectStyle, as plain JavaScript for a saved page
 * (which carries no build of this app).  Kept in step by a test.
 */
export const RUNTIME_STYLE = `function objectStyle(kind, v) {
  var c = function (n) { return Math.min(Math.max(n, 0), 1); };
  var css = function (f) { return 'rgba(' + Math.round(c(f.r) * 255) + ', ' + Math.round(c(f.g) * 255) + ', ' + Math.round(c(f.b) * 255) + ', ' + Number(c(f.a).toFixed(4)) + ')'; };
  var width = Math.max(0, v.width), height = Math.max(0, v.height);
  var style = { left: (v.x - width / 2) + 'px', top: (v.y - height / 2) + 'px', width: width + 'px', height: height + 'px', transform: 'rotate(' + v.rotation + 'deg) scale(' + v.scale + ')', opacity: String(v.opacity) };
  if (kind === 'box' || kind === 'ellipse') style.background = css(v.fill);
  if (kind === 'box' || kind === 'picture') style.borderRadius = Math.max(0, v.radius) + 'px';
  if (kind === 'ellipse') style.borderRadius = '50%';
  if (kind === 'text') { style.color = css(v.fill); style.fontSize = Math.max(1, v.fontSize) + 'px'; }
  return style;
}`;

/**
 * Motion paths and clip timing for a saved page, the same arithmetic as pointOnPath and clipTime.
 * Kept in step by a test.
 */
export const RUNTIME_MOTION = `function pointOnPath(table, progress) {
  var count = table.lengths.length;
  if (count === 0) return null;
  if (count === 1 || table.total <= 0) return { x: table.points[0], y: table.points[1], angle: 0 };
  var wanted = Math.min(Math.max(progress, 0), 1) * table.total, low = 0, high = count - 1;
  while (high - low > 1) { var middle = (low + high) >> 1; if (table.lengths[middle] <= wanted) low = middle; else high = middle; }
  var span = table.lengths[high] - table.lengths[low], part = span > 0 ? (wanted - table.lengths[low]) / span : 0;
  var ax = table.points[low * 2], ay = table.points[low * 2 + 1], bx = table.points[high * 2], by = table.points[high * 2 + 1];
  return { x: ax + (bx - ax) * part, y: ay + (by - ay) * part, angle: Math.atan2(by - ay, bx - ax) * 180 / Math.PI };
}
function clipTime(o, t, length) {
  var local = (t - (o.start || 0)) * (o.speed || 1);
  if (length <= 0) return 0;
  if (o.loop) return local < 0 ? 0 : local % length;
  return Math.min(Math.max(local, 0), length);
}`;

/** The part of @theatre/core's `types` the configuration uses. */
export interface PropTypes {
  number(value: number, options?: { range?: [number, number] }): unknown;
  rgba(value: { r: number; g: number; b: number; a: number }): unknown;
}

/** An object's Theatre.js configuration: every prop with its default. */
export function coreConfig(kind: ShapeKind, types: PropTypes): Record<string, unknown> {
  const d = DEFAULTS[kind];
  const f = d.fill;
  return {
    x: d.x,
    y: d.y,
    width: d.width,
    height: d.height,
    rotation: d.rotation,
    scale: d.scale,
    opacity: types.number(d.opacity as number, { range: [0, 1] }),
    radius: d.radius,
    fontSize: d.fontSize,
    fill: types.rgba({ r: f.r, g: f.g, b: f.b, a: f.a }),
    progress: types.number(d.progress as number, { range: [0, 1] }),
  };
}

/** Theatre.js object configuration, as JavaScript (for the saved page and the code sample). */
export function configSource(kind: ShapeKind, types = 'types'): string {
  const d = DEFAULTS[kind];
  const f = d.fill;
  return `{ x: ${d.x}, y: ${d.y}, width: ${d.width}, height: ${d.height}, rotation: ${d.rotation}, scale: ${d.scale}, opacity: ${types}.number(${d.opacity}, { range: [0, 1] }), radius: ${d.radius}, fontSize: ${d.fontSize}, fill: ${types}.rgba({ r: ${f.r}, g: ${f.g}, b: ${f.b}, a: ${f.a} }), progress: ${types}.number(${d.progress}, { range: [0, 1] }) }`;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inlineScript = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1');

export interface PageOptions {
  readonly loop: boolean;
}

/**
 * A web page that plays the animation with @theatre/core (inlined, with
 * @theatre/dataverse, behind a small CommonJS loader), scaled to fit the
 * window.  Click to pause and resume.
 */
/** lodash's notice: @theatre/core carries parts of lodash-es. */
export const LODASH_NOTICE = `The MIT License

Copyright OpenJS Foundation and other contributors <https://openjsf.org/>

Based on Underscore.js, copyright Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

/** What the saved page needs to know about an object: its shape, its place in a group, its path as a table. */
function pageObjects(project: AnimProject): Record<string, unknown>[] {
  return project.objects.map((o) => {
    const table = o.path ? pathTable(o.path) : null;
    return {
      key: o.key,
      kind: o.kind,
      text: o.text ?? '',
      picture: o.picture ?? '',
      ...(o.parent ? { parent: o.parent } : {}),
      ...(table?.lengths.length
        ? { table: { points: table.points.map((v) => Math.round(v * 100) / 100), lengths: table.lengths.map((v) => Math.round(v * 100) / 100), total: table.total }, follow: o.follow === true }
        : {}),
      ...(o.kind === 'clip' ? { clip: o.clip ?? '', start: o.start ?? 0, speed: o.speed ?? 1, loop: o.loop === true } : {}),
    };
  });
}

export function animationHtml(project: AnimProject, code: { core: string; dataverse: string; licence?: string }, options: PageOptions): string {
  const { stage } = project;
  const objects = pageObjects(project);
  const clips = Object.fromEntries(
    Object.entries(project.clips ?? {})
      .filter(([id]) => project.objects.some((o) => o.clip === id))
      .map(([id, clip]) => [id, { name: clip.name, sheet: clip.sheet, stage: clip.stage, objects: pageObjects(clip), state: clip.state }]),
  );
  const data = JSON.stringify({ name: project.name, sheet: project.sheet, objects, clips, audio: project.audio?.src ?? '', state: project.state, loop: options.loop }).replace(/</g, '\\u003c');
  const configs = `{ ${KINDS.map((k) => `${k}: function (types) { return ${configSource(k)}; }`).join(', ')} }`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Benchtop Animation Studio (Theatre.js)">
<title>${escapeHtml(project.name)}</title>
<style>
html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
#stage { position: absolute; left: 0; top: 0; width: ${stage.width}px; height: ${stage.height}px; background: ${stage.background}; overflow: hidden; transform-origin: 0 0; }
.obj { position: absolute; box-sizing: border-box; transform-origin: 50% 50%; }
.obj.text { display: flex; align-items: center; justify-content: center; text-align: center; white-space: pre-wrap; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-weight: 600; line-height: 1.15; }
.obj.picture { background-size: cover; background-position: center; background-repeat: no-repeat; }
.obj.clip { overflow: hidden; }
.obj.clip > .inner { position: absolute; left: 50%; top: 50%; transform-origin: 0 0; }
#start { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; border: 0; background: rgba(0, 0, 0, 0.55); color: #fff; font: 600 20px system-ui, sans-serif; cursor: pointer; }
</style>
</head>
<body>
<div id="stage" role="img" aria-label="${escapeHtml(project.name)}"></div>
<script type="application/json" id="animation">${data}</script>
<script>
(function () {
  var process = { env: { NODE_ENV: 'production' } };
  var definitions = {
    '@theatre/dataverse': function (module, exports, require) {
${inlineScript(code.dataverse)}
    },
    '@theatre/core': function (module, exports, require) {
${inlineScript(code.core)}
    }
  };
  var cache = {};
  function load(name) {
    if (cache[name]) return cache[name].exports;
    var module = { exports: {} };
    cache[name] = module;
    if (definitions[name]) definitions[name](module, module.exports, load);
    return module.exports;
  }
  window.Theatre = load('@theatre/core');
})();
</script>
<script>
(function () {
  ${RUNTIME_STYLE}
  ${RUNTIME_MOTION}
  var data = JSON.parse(document.getElementById('animation').textContent);
  var configs = ${configs};
  var stage = document.getElementById('stage');
  var Theatre = window.Theatre;
  var project = Theatre.getProject(data.name, { state: data.state });
  var sheet = project.sheet(data.sheet);
  var ready = [project.ready];
  // Builds the objects of one animation inside a container; groups hold their members, clips play an animation of their own.
  function build(container, objects, ownSheet, position) {
    var elements = {};
    objects.forEach(function (o) {
      var el = document.createElement('div');
      el.className = 'obj ' + o.kind;
      if (o.kind === 'text') el.textContent = o.text;
      if (o.kind === 'picture' && o.picture) el.style.backgroundImage = 'url("' + o.picture + '")';
      elements[o.key] = el;
    });
    objects.forEach(function (o) {
      var el = elements[o.key];
      (o.parent && elements[o.parent] ? elements[o.parent] : container).appendChild(el);
      var inner = null, clip = o.kind === 'clip' ? data.clips[o.clip] : null;
      if (clip) {
        inner = document.createElement('div');
        inner.className = 'inner';
        inner.style.width = clip.stage.width + 'px';
        inner.style.height = clip.stage.height + 'px';
        el.appendChild(inner);
        var child = Theatre.getProject(data.name + ' / ' + o.key, { state: clip.state });
        var childSheet = child.sheet(clip.sheet);
        ready.push(child.ready);
        build(inner, clip.objects, childSheet, null);
        var sync = function (t) { childSheet.sequence.position = clipTime(o, t, Theatre.val(childSheet.sequence.pointer.length)); };
        if (position) { Theatre.onChange(position, sync); child.ready.then(function () { sync(Theatre.val(position)); }); }
      }
      var object = ownSheet.object(o.key, configs[o.kind](Theatre.types));
      object.onValuesChange(function (values) {
        var v = values;
        if (o.table) {
          var place = pointOnPath(o.table, values.progress);
          if (place) { v = Object.assign({}, values, { x: place.x, y: place.y, rotation: values.rotation + (o.follow ? place.angle : 0) }); }
        }
        var style = objectStyle(o.kind, v);
        for (var name in style) el.style[name] = style[name];
        if (inner && clip) {
          var scale = Math.min(Math.max(0, v.width) / clip.stage.width, Math.max(0, v.height) / clip.stage.height);
          inner.style.transform = 'scale(' + scale + ') translate(-50%, -50%)';
        }
      });
    });
  }
  build(stage, data.objects, sheet, sheet.sequence.pointer.position);
  function fit() {
    var scale = Math.min(window.innerWidth / ${stage.width}, window.innerHeight / ${stage.height});
    stage.style.transform = 'translate(' + (window.innerWidth - ${stage.width} * scale) / 2 + 'px, ' + (window.innerHeight - ${stage.height} * scale) / 2 + 'px) scale(' + scale + ')';
  }
  window.addEventListener('resize', fit);
  fit();
  var playing = false, voiced = false;
  function play() {
    playing = true;
    // With sound, Theatre.js plays a sequence a thousand times at most.
    sheet.sequence.play({ iterationCount: data.loop ? (voiced ? 1000 : Infinity) : 1 }).then(function (done) { if (done) playing = false; });
  }
  document.addEventListener('click', function () {
    if (playing) { sheet.sequence.pause(); playing = false; }
    else { if (!data.loop && Math.abs(sheet.sequence.position - Theatre.val(sheet.sequence.pointer.length)) < 1e-6) sheet.sequence.position = 0; play(); }
  });
  Promise.all(ready).then(function () {
    var Context = window.AudioContext || window.webkitAudioContext;
    if (!data.audio || !Context) { play(); return; }
    // Sound needs a click first; Theatre.js then starts the sound and the picture together, on every loop.
    var start = document.createElement('button');
    start.id = 'start';
    start.type = 'button';
    start.textContent = 'Play with sound';
    document.body.appendChild(start);
    start.addEventListener('click', function (event) {
      event.stopPropagation();
      start.remove();
      var context = new Context();
      var binary = atob(data.audio.slice(data.audio.indexOf(',') + 1)), bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      new Promise(function (resolve, reject) { var decoding = context.decodeAudioData(bytes.buffer, resolve, reject); if (decoding && decoding.catch) decoding.catch(reject); }).then(function (sound) {
        var wanted = Math.ceil(Theatre.val(sheet.sequence.pointer.length) * sound.sampleRate);
        if (sound.length < wanted) {
          // Silence after a short sound, so that a loop starts the sound again with the picture.
          var padded = context.createBuffer(sound.numberOfChannels, wanted, sound.sampleRate);
          for (var c = 0; c < sound.numberOfChannels; c++) padded.getChannelData(c).set(sound.getChannelData(c));
          sound = padded;
        }
        return sheet.sequence.attachAudio({ source: sound, audioContext: context });
      }).then(function () { voiced = true; play(); }, function () { play(); });
    });
  });
})();
</script>
</body>
</html>
${
  code.licence
    ? licenceComment([
        { name: '@theatre/core and @theatre/dataverse, Theatre.js (Apache-2.0), https://github.com/theatre-js/theatre', text: code.licence },
        { name: 'lodash-es, inside @theatre/core (MIT)', text: LODASH_NOTICE },
      ])
    : ''
}`;
}

/** How to play a saved state with @theatre/core in your own page. */
export function codeSample(project: AnimProject): string {
  const objects = project.objects.map(
    (o) =>
      `const ${o.key
        .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
        .replace(/^[^A-Za-z_]/, '_$&')
        .replace(/^./, (c) => c.toLowerCase())} = sheet.object(${JSON.stringify(o.key)}, ${configSource(o.kind)});`,
  );
  return `import { getProject, types } from '@theatre/core';
import state from './${project.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'animation'}.theatre.json';

const project = getProject(${JSON.stringify(project.name)}, { state });
const sheet = project.sheet(${JSON.stringify(project.sheet)});
${objects.join('\n')}

// Each object reports its values as the sequence plays; apply them to your elements, e.g.:
// box.onValuesChange((v) => { element.style.transform = \`translate(\${v.x}px, \${v.y}px) rotate(\${v.rotation}deg)\`; });

project.ready.then(() => sheet.sequence.play({ iterationCount: Infinity }));
`;
}

/* ------------------------------------------------------------- sample -- */

export function sampleProject(): AnimProject {
  let p = emptyProject('Bouncing logo');
  p = setLength(p, 3);
  // Drawn in this order: the card, the title on it, and the ball over both.
  p = addObject(p, 'box', { key: 'Card' }).project;
  p = addObject(p, 'text', { key: 'Title', text: 'Hello, motion' }).project;
  p = addObject(p, 'ellipse', { key: 'Ball' }).project;
  p = setStatic(p, 'Card', 'width', 520);
  p = setStatic(p, 'Card', 'height', 150);
  p = setStatic(p, 'Card', 'y', 540);
  p = setStatic(p, 'Card', 'fill', hexToRgba('#161b22'));
  p = setStatic(p, 'Title', 'y', 540);
  p = setStatic(p, 'Title', 'fontSize', 64);
  p = setStatic(p, 'Ball', 'width', 140);
  p = setStatic(p, 'Ball', 'height', 140);
  // The card and title rise into place; the ball drops in and bounces.
  for (const key of ['Card', 'Title']) {
    p = setKeyframe(p, key, 'opacity', 0, 0);
    p = setKeyframe(p, key, 'opacity', 0.8, 1);
    p = setKeyframe(p, key, 'y', 0, 640);
    p = setKeyframe(p, key, 'y', 0.8, 540);
    const first = trackOf(p, key, 'y')?.keyframes[0];
    if (first) p = setEasing(p, key, 'y', first.id, EASINGS['Back out'] as Curve);
  }
  p = setKeyframe(p, 'Ball', 'y', 0, -100);
  p = setKeyframe(p, 'Ball', 'y', 1.2, 300);
  p = setKeyframe(p, 'Ball', 'y', 1.6, 200);
  p = setKeyframe(p, 'Ball', 'y', 2, 300);
  const drops = trackOf(p, 'Ball', 'y')?.keyframes ?? [];
  if (drops[0]) p = setEasing(p, 'Ball', 'y', drops[0].id, EASINGS['Ease in'] as Curve);
  if (drops[1]) p = setEasing(p, 'Ball', 'y', drops[1].id, EASINGS['Ease out'] as Curve);
  if (drops[2]) p = setEasing(p, 'Ball', 'y', drops[2].id, EASINGS['Ease in'] as Curve);
  p = setKeyframe(p, 'Ball', 'fill', 0, hexToRgba('#f78166'));
  p = setKeyframe(p, 'Ball', 'fill', 2, hexToRgba('#3fb950'));
  p = setKeyframe(p, 'Ball', 'rotation', 0, 0);
  p = setKeyframe(p, 'Ball', 'rotation', 3, 360);
  return p;
}
