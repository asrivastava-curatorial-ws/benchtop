/**
 * Drawing helpers shared by the circuit simulator's part drawings: grid
 * units of GRID pixels, lines, paths and text, and pictures of displays.
 */
import type { ComponentChildren } from 'preact';
import { isScreen, type Screen, type View } from '../../lib/circuit/bus';
import type { PlacedPart } from '../../lib/circuit/netlist';
import { PART_BY_TYPE } from '../../lib/circuit/parts';

export const GRID = 20;
export const g = (v: number) => v * GRID;

export type Live = View | null;

export const L = ({ x1, y1, x2, y2, w = 1.6 }: { x1: number; y1: number; x2: number; y2: number; w?: number }) => (
  <line x1={g(x1)} y1={g(y1)} x2={g(x2)} y2={g(y2)} stroke="currentColor" stroke-width={w} stroke-linecap="round" />
);
export const P = ({ d, fill = 'none', w = 1.6, cls }: { d: string; fill?: string; w?: number; cls?: string }) => (
  <path d={d} fill={fill} stroke="currentColor" stroke-width={w} stroke-linejoin="round" stroke-linecap="round" class={cls} />
);
export const T = ({
  x,
  y,
  children,
  size = 10,
  anchor = 'middle',
  cls = 'cs-text',
}: {
  x: number;
  y: number;
  children: ComponentChildren;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  cls?: string;
}) => (
  <text x={g(x)} y={g(y)} font-size={size} text-anchor={anchor} dominant-baseline="middle" class={cls}>
    {children}
  </text>
);

/** "M x y L x y …" with grid units. */
export const path = (points: readonly (readonly [number, number])[]) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${g(x)} ${g(y)}`).join(' ');

export const num = (live: Live, key: string) => (typeof live?.[key] === 'number' ? (live[key] as number) : 0);
export const flag = (live: Live, key: string) => live?.[key] === true;

export function box(x0: number, y0: number, x1: number, y1: number, cls = 'cs-fill') {
  return <rect x={g(x0)} y={g(y0)} width={g(x1 - x0)} height={g(y1 - y0)} rx={3} stroke="currentColor" stroke-width={1.6} class={cls} />;
}

/** Pin leads and labels for block parts. */
export function pins(part: PlacedPart, inside: number, outsideRight: number) {
  const def = PART_BY_TYPE.get(part.type);
  return def?.terminals.map((t) => {
    const right = t.x >= outsideRight;
    const top = t.y < 0;
    const bottom = def.box[3] <= t.y;
    if (top || bottom)
      return (
        <g key={t.name}>
          <L x1={t.x} y1={t.y} x2={t.x} y2={top ? 0 : t.y - 1} />
          <T x={t.x} y={top ? 0.55 : t.y - 1.5} size={8}>
            {t.name}
          </T>
        </g>
      );
    return (
      <g key={t.name}>
        <L x1={t.x} y1={t.y} x2={right ? t.x - 1 : t.x + inside} y2={t.y} />
        <T x={right ? t.x - 1.2 : t.x + inside + 0.2} y={t.y} size={8} anchor={right ? 'end' : 'start'}>
          {t.name}
        </T>
      </g>
    );
  });
}

/** A list of numbers from a live reading. */
export const list = (live: Live, key: string): readonly number[] => {
  const v = live?.[key];
  return Array.isArray(v) ? (v as readonly number[]) : [];
};

export const screenOf = (live: Live): Screen | null => {
  const v = live?.screen;
  return isScreen(v) ? v : null;
};

interface Encoded {
  version: number;
  url: string;
  at: number;
  canvas: HTMLCanvasElement;
  small: HTMLCanvasElement;
}

const encoded = new WeakMap<Screen, Encoded>();

/**
 * A display's picture as an image URL, scaled up by whole pixels so it stays
 * crisp.  Large pictures that change all the time are encoded at most 20
 * times a second.
 */
export function screenUrl(screen: Screen, scale: number): string {
  if (typeof document === 'undefined') return '';
  let e = encoded.get(screen);
  const now = performance.now();
  if (e && e.version === screen.version) return e.url;
  if (e && screen.width * screen.height > 20_000 && now - e.at < 50) return e.url;
  if (!e) {
    const canvas = document.createElement('canvas');
    canvas.width = screen.width * scale;
    canvas.height = screen.height * scale;
    const small = document.createElement('canvas');
    small.width = screen.width;
    small.height = screen.height;
    e = { version: -1, url: '', at: 0, canvas, small };
    encoded.set(screen, e);
  }
  const small = e.small.getContext('2d');
  const big = e.canvas.getContext('2d');
  if (!small || !big) return '';
  small.putImageData(new ImageData(new Uint8ClampedArray(screen.rgba), screen.width, screen.height), 0, 0);
  big.imageSmoothingEnabled = false;
  big.drawImage(e.small, 0, 0, e.canvas.width, e.canvas.height);
  e.url = e.canvas.toDataURL('image/png');
  e.version = screen.version;
  e.at = now;
  return e.url;
}

/** A display's picture in a rectangle (grid units). */
export function ScreenImage({ screen, x, y, w, h, scale = 1 }: { screen: Screen | null; x: number; y: number; w: number; h: number; scale?: number }): ComponentChildren {
  if (!screen) return <rect x={g(x)} y={g(y)} width={g(w)} height={g(h)} fill="#07090c" />;
  return <image href={screenUrl(screen, scale)} x={g(x)} y={g(y)} width={g(w)} height={g(h)} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} />;
}
