/**
 * Shared parts of the simulation labs: an animation clock, sliders with
 * number boxes, read-outs, run controls and a small line plot.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CHART_COLORS, niceStep } from '../../lib/svg-chart';

/** Okabe–Ito colours, safe for colour-blind readers, in a fixed order. */
export const LAB_COLORS = CHART_COLORS.slice(0, 6);

/** Calls `step` with the seconds since the last frame (at most 1/20 s) while `running`. */
export function useClock(running: boolean, step: (dt: number) => void): void {
  const latest = useRef(step);
  latest.current = step;
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      latest.current(dt);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);
}

const SUPERSCRIPT: Readonly<Record<string, string>> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** A number shown with sensible precision: 3 significant figures by default, powers of ten when very large or small. */
export function fmt(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? '—' : value > 0 ? '∞' : '−∞';
  if (value === 0) return '0';
  const a = Math.abs(value);
  if (a >= 1e6 || a < 1e-3) {
    const [mantissa = '', exponent = ''] = value.toExponential(Math.max(0, digits - 1)).split('e');
    return `${mantissa.replace('-', '−')} × 10${[...exponent.replace('+', '')].map((c) => SUPERSCRIPT[c] ?? c).join('')}`;
  }
  return String(Number(value.toPrecision(digits))).replace('-', '−');
}

/**
 * A number box that keeps what is being typed until Enter or leaving the box,
 * so a picture re-drawn every frame cannot wipe a half-typed number.
 */
export function NumberBox({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  label,
  test,
  className = 'input lab-slider-num',
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  test?: string;
  className?: string;
}) {
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
  const shown = String(Number(value.toFixed(decimals)));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <input
      type="number"
      class={className}
      min={min}
      max={max}
      step={step}
      value={draft ?? shown}
      aria-label={label}
      data-testid={test}
      onFocus={() => setDraft(shown)}
      onInput={(e) => {
        const text = e.currentTarget.value;
        setDraft(text);
        const v = Number(text);
        if (text.trim() !== '' && Number.isFinite(v) && v >= min && v <= max) onChange(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit(e.currentTarget.value);
          setDraft(null);
        }
      }}
      onBlur={(e) => {
        commit(e.currentTarget.value);
        setDraft(null);
      }}
    />
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit,
  onChange,
  test,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  test?: string;
}) {
  return (
    <div class="lab-slider">
      <span class="lab-slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onInput={(e) => onChange(Number(e.currentTarget.value))} />
      <NumberBox value={value} min={min} max={max} step={step} onChange={onChange} label={`${label}${unit ? ` (${unit})` : ''}`} test={test} />
      <span class="lab-unit">{unit ?? ''}</span>
    </div>
  );
}

export function Readouts({ items, test }: { items: readonly (readonly [string, ComponentChildren])[]; test?: string }) {
  return (
    <dl class="lab-readouts" data-testid={test}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RunControls({ running, onToggle, onReset, time, test = 'lab' }: { running: boolean; onToggle: () => void; onReset: () => void; time?: number; test?: string }) {
  return (
    <div class="button-row lab-run">
      <button type="button" class="button button-primary button-small" onClick={onToggle} data-testid={`${test}-run`}>
        {running ? 'Pause' : 'Run'}
      </button>
      <button type="button" class="button button-small" onClick={onReset} data-testid={`${test}-reset`}>
        Reset
      </button>
      {time !== undefined && <span class="tone-muted lab-time">t = {time.toFixed(2)} s</span>}
    </div>
  );
}

export interface Series {
  readonly name: string;
  readonly points: readonly (readonly [number, number])[];
  readonly color?: string;
  readonly dashed?: boolean;
}

function ticks(lo: number, hi: number, count: number): number[] {
  const step = niceStep(hi - lo, count);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

const tickText = (v: number) => {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1).replace('-', '−');
  return String(Number(v.toPrecision(4))).replace('-', '−');
};

/** A line plot of one or more series, sharing one pair of axes. */
export function Plot({
  series,
  xLabel,
  yLabel,
  height = 190,
  xRange,
  yRange,
  marker,
  test,
  title,
  points,
}: {
  series: readonly Series[];
  xLabel: string;
  yLabel: string;
  height?: number;
  xRange?: readonly [number, number];
  yRange?: readonly [number, number];
  /** An x value to mark with a vertical line (the current time, say). */
  marker?: number;
  test?: string;
  title?: string;
  /** Dots, labelled or not; `live` dots are drawn larger (a moving marker). */
  points?: readonly { readonly x: number; readonly y: number; readonly label?: string; readonly live?: boolean }[];
}) {
  const W = 520;
  const H = height;
  const L = 50;
  const R = 12;
  const T = 10;
  const B = 32;
  const all = series.flatMap((s) => s.points).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  let [x0, x1] = xRange ?? [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  let [y0, y1] = yRange ?? [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  if (!all.length || !Number.isFinite(x0) || !Number.isFinite(x1)) [x0, x1] = [0, 1];
  if (!all.length || !Number.isFinite(y0) || !Number.isFinite(y1)) [y0, y1] = [0, 1];
  if (x1 - x0 < 1e-12) [x0, x1] = [x0 - 1, x1 + 1];
  if (y1 - y0 < 1e-12) [y0, y1] = [y0 - 1, y1 + 1];
  if (!yRange) {
    const pad = (y1 - y0) * 0.06;
    y0 -= pad;
    y1 += pad;
  }
  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const xt = ticks(x0, x1, 6);
  const yt = ticks(y0, y1, 4);
  const path = (s: Series) => {
    let d = '';
    let pen = false;
    for (const [x, y] of s.points) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || y < y0 - (y1 - y0) * 4 || y > y1 + (y1 - y0) * 4) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(Math.min(y1 + (y1 - y0), Math.max(y0 - (y1 - y0), y))).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  return (
    <figure class="lab-plot" data-testid={test}>
      {title && <figcaption>{title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title ?? yLabel} against ${xLabel}`}>
        <defs>
          <clipPath id={`lab-clip-${test ?? 'plot'}`}>
            <rect x={L} y={T} width={W - L - R} height={H - T - B} />
          </clipPath>
        </defs>
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line class="lab-grid" x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} />
            <text class="lab-tick" x={L - 6} y={sy(v) + 4} text-anchor="end">
              {tickText(v)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <g key={`x${v}`}>
            <line class="lab-grid" x1={sx(v)} x2={sx(v)} y1={T} y2={H - B} />
            <text class="lab-tick" x={sx(v)} y={H - B + 14} text-anchor="middle">
              {tickText(v)}
            </text>
          </g>
        ))}
        {y0 < 0 && y1 > 0 && <line class="lab-axis" x1={L} x2={W - R} y1={sy(0)} y2={sy(0)} />}
        <line class="lab-axis" x1={L} x2={L} y1={T} y2={H - B} />
        <g clip-path={`url(#lab-clip-${test ?? 'plot'})`}>
          {series.map((s, i) => (
            <path key={s.name} d={path(s)} fill="none" stroke={s.color ?? LAB_COLORS[i % LAB_COLORS.length]} stroke-width="2" stroke-dasharray={s.dashed ? '6 4' : undefined} stroke-linejoin="round" />
          ))}
          {marker !== undefined && marker >= x0 && marker <= x1 && <line class="lab-marker" x1={sx(marker)} x2={sx(marker)} y1={T} y2={H - B} />}
        </g>
        {points?.map((p) =>
          Number.isFinite(p.x) && Number.isFinite(p.y) ? (
            <g key={`${p.label ?? ''}${p.x},${p.y}`} class={p.live ? 'lab-dot is-live' : 'lab-dot'}>
              <circle cx={sx(p.x)} cy={sy(p.y)} r={p.live ? 6 : 3.5} />
              {p.label && (
                <text x={sx(p.x) + 6} y={sy(p.y) - 6}>
                  {p.label}
                </text>
              )}
            </g>
          ) : null,
        )}
        <text class="lab-axis-label" x={(L + W - R) / 2} y={H - 3} text-anchor="middle">
          {xLabel}
        </text>
        <text class="lab-axis-label" x={12} y={(T + H - B) / 2} text-anchor="middle" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>
          {yLabel}
        </text>
      </svg>
      {series.length > 1 && (
        <div class="lab-legend">
          {series.map((s, i) => (
            <span key={s.name}>
              <i style={{ background: s.color ?? LAB_COLORS[i % LAB_COLORS.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}

/** Rows of numbers as CSV text. */
export function csv(header: readonly string[], rows: readonly (readonly (number | string)[])[]): string {
  const cell = (v: number | string) => (typeof v === 'number' ? String(Number(v.toPrecision(10))) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `${[header, ...rows].map((r) => r.map(cell).join(',')).join('\n')}\n`;
}

/** A wrapping row of choices for picking an experiment. */
export function LabTabs<T extends string>({
  value,
  choices,
  onChange,
  label,
}: {
  value: T;
  choices: readonly { readonly value: T; readonly label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div class="lab-tabs" role="radiogroup" aria-label={label}>
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={c.value === value}
          class={c.value === value ? 'is-active' : ''}
          onClick={() => onChange(c.value)}
          data-testid={`lab-tab-${c.value}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** An arrow from (x1, y1) to (x2, y2) in the colour given (or the text colour). */
export function Arrow({
  x1,
  y1,
  x2,
  y2,
  color,
  width = 2,
  head = 9,
  dashed,
  test,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  width?: number;
  head?: number;
  dashed?: boolean;
  test?: string;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!(len > 0.5)) return null;
  const ux = dx / len;
  const uy = dy / len;
  const h = Math.min(head, len * 0.6);
  const bx = x2 - ux * h;
  const by = y2 - uy * h;
  const px = -uy * h * 0.45;
  const py = ux * h * 0.45;
  return (
    <g class="lab-arrow" style={color ? { color } : undefined} data-testid={test}>
      <line x1={x1} y1={y1} x2={bx} y2={by} stroke-width={width} stroke-dasharray={dashed ? `${3 * width} ${2 * width}` : undefined} />
      <path d={`M${x2} ${y2}L${bx + px} ${by + py}L${bx - px} ${by - py}Z`} />
    </g>
  );
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Stored values laid over the defaults: a stored entry is kept only when it
 * has the same type as the default (numbers must be finite), nested objects
 * are merged the same way, and arrays are taken as they are (check them
 * yourself).
 */
export function mergeStored<T extends Record<string, unknown>>(defaults: T, stored: unknown): T {
  if (!isPlain(stored)) return defaults;
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, d] of Object.entries(defaults)) {
    const s = stored[key];
    if (typeof d === 'number') {
      if (typeof s === 'number' && Number.isFinite(s)) out[key] = s;
    } else if (typeof d === 'string' || typeof d === 'boolean') {
      if (typeof s === typeof d) out[key] = s;
    } else if (Array.isArray(d)) {
      if (Array.isArray(s)) out[key] = s;
    } else if (isPlain(d)) out[key] = mergeStored(d, s);
  }
  return out as T;
}
