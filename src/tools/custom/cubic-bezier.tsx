/** Cubic Bezier easing editor with live comparison and exports for several platforms. */
import { useRef, useState } from 'preact/hooks';
import { trimNumber } from '../../lib/color';
import { CodeOutput } from '../../ui/CodeOutput';
import { Icon } from '../../ui/icons';
import { defineCustomTool, type Values } from '../types';
import { clamp, nudge, startDrag, usePersistentState } from './_shared';

export type Curve = readonly [number, number, number, number];

export const EASING_PRESETS: Record<string, Curve> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'In sine': [0.12, 0, 0.39, 0],
  'Out sine': [0.61, 1, 0.88, 1],
  'In cubic': [0.32, 0, 0.67, 0],
  'Out cubic': [0.33, 1, 0.68, 1],
  'In-out cubic': [0.65, 0, 0.35, 1],
  'Out quint': [0.22, 1, 0.36, 1],
  'Out expo': [0.16, 1, 0.3, 1],
  'In-out expo': [0.87, 0, 0.13, 1],
  'In back': [0.36, 0, 0.66, -0.56],
  'Out back': [0.34, 1.56, 0.64, 1],
  'In-out back': [0.68, -0.6, 0.32, 1.6],
};

/** Progress of a CSS cubic-bezier timing function at time t (Newton iterations with a bisection fallback). */
export function evaluate(curve: Curve, t: number): number {
  const [x1, y1, x2, y2] = curve;
  const bezier = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  const slope = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;
  let s = t;
  for (let i = 0; i < 8; i++) {
    const error = bezier(x1, x2, s) - t;
    if (Math.abs(error) < 1e-7) return bezier(y1, y2, s);
    const d = slope(x1, x2, s);
    if (Math.abs(d) < 1e-6) break;
    s -= error / d;
  }
  let low = 0;
  let high = 1;
  s = t;
  for (let i = 0; i < 40; i++) {
    const x = bezier(x1, x2, s);
    if (Math.abs(x - t) < 1e-7) break;
    if (x < t) low = s;
    else high = s;
    s = (low + high) / 2;
  }
  return bezier(y1, y2, s);
}

const n = (value: number) => trimNumber(value, 3);
export const cssCurve = (c: Curve) => `cubic-bezier(${c.map(n).join(', ')})`;

export function exports(curve: Curve, durationMs: number) {
  const [x1, y1, x2, y2] = curve.map(n) as [string, string, string, string];
  const css = cssCurve(curve);
  return [
    { label: 'CSS', language: 'css' as const, code: `.element {\n  transition: transform ${durationMs}ms ${css};\n  /* or */\n  animation-timing-function: ${css};\n}\n` },
    { label: 'Tailwind', language: 'html' as const, code: `<div class="transition duration-${durationMs} ease-[cubic-bezier(${x1},${y1},${x2},${y2})]"></div>\n` },
    {
      label: 'Web Animations',
      language: 'javascript' as const,
      code: `element.animate(\n  [{ transform: 'translateX(0)' }, { transform: 'translateX(200px)' }],\n  { duration: ${durationMs}, easing: '${css}' },\n);\n`,
    },
    {
      label: 'Motion (React)',
      language: 'jsx' as const,
      code: `<motion.div animate={{ x: 200 }} transition={{ duration: ${trimNumber(durationMs / 1000, 3)}, ease: [${x1}, ${y1}, ${x2}, ${y2}] }} />\n`,
    },
    { label: 'SwiftUI', language: 'text' as const, code: `withAnimation(.timingCurve(${x1}, ${y1}, ${x2}, ${y2}, duration: ${trimNumber(durationMs / 1000, 3)})) {\n    offset = 200\n}\n` },
    {
      label: 'Android',
      language: 'text' as const,
      code: `// Kotlin\nval interpolator = PathInterpolator(${x1}f, ${y1}f, ${x2}f, ${y2}f)\n\n// Jetpack Compose\nval easing = CubicBezierEasing(${x1}f, ${y1}f, ${x2}f, ${y2}f)\n`,
    },
    { label: 'Flutter', language: 'text' as const, code: `const curve = Cubic(${x1}, ${y1}, ${x2}, ${y2});\n` },
  ];
}

/** The plot shows time 0-1 across and progress from MIN_Y to MAX_Y, so overshooting handles stay visible. */
const PLOT = 200;
const MIN_Y = -0.6;
const MAX_Y = 1.6;
const LEFT = 64;
const W = LEFT + PLOT + 24;
const TOP = (MAX_Y - 1) * PLOT + 14;
const H = TOP + PLOT + -MIN_Y * PLOT + 26;
const X = (x: number) => LEFT + x * PLOT;
const Y = (y: number) => TOP + (1 - y) * PLOT;

interface State {
  readonly curve: Curve;
  readonly duration: number;
  readonly compare: string;
}

function readState(stored: Values | undefined): State {
  const curve =
    Array.isArray(stored?.curve) && (stored.curve as unknown[]).length === 4 && (stored.curve as unknown[]).every((v) => typeof v === 'number' && Number.isFinite(v))
      ? (stored.curve as unknown as Curve)
      : (EASING_PRESETS['Out back'] as Curve);
  return {
    curve: [clamp(curve[0], 0, 1), clamp(curve[1], MIN_Y, MAX_Y), clamp(curve[2], 0, 1), clamp(curve[3], MIN_Y, MAX_Y)],
    duration: typeof stored?.duration === 'number' ? clamp(stored.duration, 100, 5000) : 800,
    compare: typeof stored?.compare === 'string' && stored.compare in EASING_PRESETS ? stored.compare : 'ease',
  };
}

function CubicBezier({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState<State>(toolId, readState, (s) => ({ ...s, curve: [...s.curve] }));
  const [run, setRun] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const { curve } = state;

  const setPoint = (which: 0 | 1, x: number, y: number) =>
    setState((previous) => {
      const next = [...previous.curve] as [number, number, number, number];
      next[which * 2] = Math.round(clamp(x, 0, 1) * 100) / 100;
      next[which * 2 + 1] = Math.round(clamp(y, MIN_Y, MAX_Y) * 100) / 100;
      return { ...previous, curve: next };
    });

  const drag = (which: 0 | 1) => (event: PointerEvent) => {
    const element = svg.current;
    if (!element) return;
    startDrag(event, element as unknown as HTMLElement, (fx, fy) => {
      const x = (fx * W - LEFT) / PLOT;
      const y = 1 - (fy * H - TOP) / PLOT;
      setPoint(which, x, y);
    });
  };

  const keys = (which: 0 | 1) => (event: KeyboardEvent) => {
    const step = nudge(event);
    if (!step) return;
    event.preventDefault();
    setPoint(which, (curve[which * 2] as number) + step.dx / 100, (curve[which * 2 + 1] as number) - step.dy / 100);
  };

  const setNumber = (index: number, text: string) => {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    setState((previous) => {
      const next = [...previous.curve] as [number, number, number, number];
      next[index] = index % 2 === 0 ? clamp(value, 0, 1) : clamp(value, MIN_Y, MAX_Y);
      return { ...previous, curve: next };
    });
  };

  const path = `M${X(0)} ${Y(0)} C${X(curve[0])} ${Y(curve[1])} ${X(curve[2])} ${Y(curve[3])} ${X(1)} ${Y(1)}`;
  const compareCurve = EASING_PRESETS[state.compare] as Curve;
  const css = cssCurve(curve);

  return (
    <section class="tool layout-form" data-testid="tool" data-state="done">
      <aside class="tool-side">
        <div class="tool-options">
          <div class="presets" role="group" aria-label="Presets">
            {Object.entries(EASING_PRESETS).map(([name, preset]) => (
              <button key={name} type="button" class={`chip${preset.every((v, i) => v === curve[i]) ? ' is-active' : ''}`} onClick={() => setState((previous) => ({ ...previous, curve: preset }))}>
                {name}
              </button>
            ))}
          </div>
          <div class="bezier-numbers">
            {(['x1', 'y1', 'x2', 'y2'] as const).map((label, index) => (
              <label key={label} class="control">
                <span class="control-label">{label}</span>
                <input
                  class="input input-mono"
                  type="number"
                  step={0.01}
                  min={index % 2 === 0 ? 0 : MIN_Y}
                  max={index % 2 === 0 ? 1 : MAX_Y}
                  value={curve[index]}
                  onInput={(event) => setNumber(index, event.currentTarget.value)}
                />
              </label>
            ))}
          </div>
          <label class="control">
            <span class="control-label">Preview duration: {state.duration} ms</span>
            <input
              type="range"
              class="range"
              min={100}
              max={3000}
              step={50}
              value={state.duration}
              onInput={(event) => setState((previous) => ({ ...previous, duration: Number(event.currentTarget.value) }))}
            />
          </label>
          <label class="control">
            <span class="control-label">Compare with</span>
            <select class="input" value={state.compare} onChange={(event) => setState((previous) => ({ ...previous, compare: event.currentTarget.value }))}>
              {Object.keys(EASING_PRESETS).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </aside>
      <div class="tool-main">
        <div class="bezier-layout">
          <svg ref={svg} class="bezier-graph" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Easing curve ${css}`}>
            <rect x={X(0)} y={Y(1)} width={PLOT} height={PLOT} class="bezier-box" />
            <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} class="bezier-diagonal" />
            <path d={`M${X(0)} ${Y(0)} C${X(compareCurve[0])} ${Y(compareCurve[1])} ${X(compareCurve[2])} ${Y(compareCurve[3])} ${X(1)} ${Y(1)}`} class="bezier-compare" />
            <line x1={X(0)} y1={Y(0)} x2={X(curve[0])} y2={Y(curve[1])} class="bezier-arm" />
            <line x1={X(1)} y1={Y(1)} x2={X(curve[2])} y2={Y(curve[3])} class="bezier-arm" />
            <path d={path} class="bezier-curve" />
            <text x={X(0)} y={Y(0) + 18} class="bezier-label">
              time
            </text>
            <text x={X(0) - 8} y={Y(1)} class="bezier-label" text-anchor="end">
              progress
            </text>
            {([0, 1] as const).map((which) => (
              <circle
                key={which}
                cx={X(curve[which * 2] as number)}
                cy={Y(curve[which * 2 + 1] as number)}
                r={9}
                class={`bezier-handle bezier-handle-${which + 1}`}
                tabIndex={0}
                role="slider"
                aria-label={`Control point ${which + 1}, time`}
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={curve[which * 2] as number}
                aria-valuetext={`${n(curve[which * 2] as number)}, ${n(curve[which * 2 + 1] as number)}`}
                onPointerDown={drag(which)}
                onKeyDown={keys(which)}
              />
            ))}
          </svg>
          <div class="bezier-demo">
            <div class="bezier-demo-head">
              <code>{css}</code>
              <button type="button" class="button button-small" onClick={() => setRun(run + 1)}>
                <Icon name="play" size={14} />
                Play
              </button>
            </div>
            {[
              { label: 'Your curve', timing: css, tone: 'accent' },
              { label: state.compare, timing: cssCurve(compareCurve), tone: 'muted' },
              { label: 'linear', timing: 'linear', tone: 'muted' },
            ].map((lane) => (
              <div key={`${lane.label}-${run}`} class="bezier-lane">
                <span class="bezier-lane-label">{lane.label}</span>
                <div class="bezier-track">
                  <span class={`bezier-ball bezier-ball-${lane.tone}`} style={`animation: bezier-move ${state.duration}ms ${lane.timing} 300ms both;`} />
                </div>
              </div>
            ))}
            <p class="control-help">Values outside 0 to 1 on the progress axis overshoot and bounce back.</p>
          </div>
        </div>
        <CodeOutput outputs={exports(curve, state.duration)} baseName="easing" />
      </div>
    </section>
  );
}

export default defineCustomTool(CubicBezier);
