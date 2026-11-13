/** Clip-path editor: drag polygon points, or size circles, ellipses and insets. */
import { useRef, useState } from 'preact/hooks';
import { trimNumber } from '../../lib/color';
import { CodeOutput } from '../../ui/CodeOutput';
import { ControlsForm } from '../../ui/Controls';
import { Icon } from '../../ui/icons';
import { SAMPLE_SCENE, svgDataUri } from '../css/_shared';
import { defineCustomTool, type OptionDef, type Values } from '../types';
import { clamp, nudge, Segmented, startDrag, usePersistentState } from './_shared';

type Shape = 'polygon' | 'circle' | 'ellipse' | 'inset';
type Point = readonly [number, number];

export const POLYGONS: Record<string, readonly Point[]> = {
  Triangle: [
    [50, 0],
    [100, 100],
    [0, 100],
  ],
  Trapezoid: [
    [20, 0],
    [80, 0],
    [100, 100],
    [0, 100],
  ],
  Parallelogram: [
    [25, 0],
    [100, 0],
    [75, 100],
    [0, 100],
  ],
  Rhombus: [
    [50, 0],
    [100, 50],
    [50, 100],
    [0, 50],
  ],
  Pentagon: [
    [50, 0],
    [100, 38],
    [82, 100],
    [18, 100],
    [0, 38],
  ],
  Hexagon: [
    [25, 0],
    [75, 0],
    [100, 50],
    [75, 100],
    [25, 100],
    [0, 50],
  ],
  Octagon: [
    [30, 0],
    [70, 0],
    [100, 30],
    [100, 70],
    [70, 100],
    [30, 100],
    [0, 70],
    [0, 30],
  ],
  Star: [
    [50, 0],
    [61, 35],
    [98, 35],
    [68, 57],
    [79, 91],
    [50, 70],
    [21, 91],
    [32, 57],
    [2, 35],
    [39, 35],
  ],
  Arrow: [
    [0, 20],
    [60, 20],
    [60, 0],
    [100, 50],
    [60, 100],
    [60, 80],
    [0, 80],
  ],
  Chevron: [
    [75, 0],
    [100, 50],
    [75, 100],
    [0, 100],
    [25, 50],
    [0, 0],
  ],
  Message: [
    [0, 0],
    [100, 0],
    [100, 75],
    [75, 75],
    [75, 100],
    [50, 75],
    [0, 75],
  ],
  Plus: [
    [35, 0],
    [65, 0],
    [65, 35],
    [100, 35],
    [100, 65],
    [65, 65],
    [65, 100],
    [35, 100],
    [35, 65],
    [0, 65],
    [0, 35],
    [35, 35],
  ],
};

interface State {
  readonly shape: Shape;
  readonly points: readonly Point[];
  readonly values: Values;
  readonly snap: boolean;
  readonly backdrop: 'gradient' | 'scene';
}

const SHAPE_DEFS: Record<Exclude<Shape, 'polygon'>, readonly OptionDef[]> = {
  circle: [
    { key: 'r', label: 'Radius', type: 'range', min: 0, max: 75, step: 1, unit: '%', default: 45 },
    { key: 'cx', label: 'Centre X', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
    { key: 'cy', label: 'Centre Y', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
  ],
  ellipse: [
    { key: 'rx', label: 'Radius X', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 48 },
    { key: 'ry', label: 'Radius Y', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 32 },
    { key: 'cx', label: 'Centre X', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
    { key: 'cy', label: 'Centre Y', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
  ],
  inset: [
    { key: 't', label: 'Top', type: 'range', min: 0, max: 50, step: 1, unit: '%', default: 10 },
    { key: 'rt', label: 'Right', type: 'range', min: 0, max: 50, step: 1, unit: '%', default: 10 },
    { key: 'b', label: 'Bottom', type: 'range', min: 0, max: 50, step: 1, unit: '%', default: 10 },
    { key: 'l', label: 'Left', type: 'range', min: 0, max: 50, step: 1, unit: '%', default: 10 },
    { key: 'round', label: 'Corner radius', type: 'range', min: 0, max: 50, step: 1, unit: '%', default: 8 },
  ],
};

const DEFAULT_VALUES: Values = { r: 45, cx: 50, cy: 50, rx: 48, ry: 32, t: 10, rt: 10, b: 10, l: 10, round: 8 };
const DEFAULT_STATE: State = { shape: 'polygon', points: POLYGONS.Hexagon as Point[], values: DEFAULT_VALUES, snap: true, backdrop: 'scene' };

const pct = (value: number) => (value === 0 ? '0' : `${trimNumber(value, 2)}%`);

export function clipPathValue(state: Pick<State, 'shape' | 'points' | 'values'>): string {
  const n = (key: string) => Number(state.values[key] ?? DEFAULT_VALUES[key]);
  switch (state.shape) {
    case 'circle':
      return `circle(${pct(n('r'))} at ${pct(n('cx'))} ${pct(n('cy'))})`;
    case 'ellipse':
      return `ellipse(${pct(n('rx'))} ${pct(n('ry'))} at ${pct(n('cx'))} ${pct(n('cy'))})`;
    case 'inset':
      return `inset(${pct(n('t'))} ${pct(n('rt'))} ${pct(n('b'))} ${pct(n('l'))}${n('round') > 0 ? ` round ${pct(n('round'))}` : ''})`;
    default:
      return `polygon(${state.points.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(', ')})`;
  }
}

function readState(stored: Values | undefined): State {
  if (!stored) return DEFAULT_STATE;
  const shape = ['polygon', 'circle', 'ellipse', 'inset'].includes(String(stored.shape)) ? (stored.shape as Shape) : 'polygon';
  const points = Array.isArray(stored.points)
    ? (stored.points as unknown[])
        .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)))
        .map(([x, y]) => [clamp(x, 0, 100), clamp(y, 0, 100)] as Point)
    : [];
  const values: Values = { ...DEFAULT_VALUES };
  if (stored.values && typeof stored.values === 'object')
    for (const key of Object.keys(DEFAULT_VALUES)) if (typeof (stored.values as Values)[key] === 'number') values[key] = (stored.values as Values)[key];
  return { shape, points: points.length >= 3 ? points : DEFAULT_STATE.points, values, snap: stored.snap !== false, backdrop: stored.backdrop === 'gradient' ? 'gradient' : 'scene' };
}

function ClipPath({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState<State>(toolId, readState, (s) => ({ ...s }));
  const [selected, setSelected] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const value = clipPathValue(state);
  const round = (n: number) => (state.snap ? Math.round(n) : Math.round(n * 10) / 10);

  const movePoint = (index: number, x: number, y: number) =>
    setState((previous) => ({ ...previous, points: previous.points.map((point, i) => (i === index ? ([round(clamp(x, 0, 100)), round(clamp(y, 0, 100))] as Point) : point)) }));

  const addPoint = () =>
    setState((previous) => {
      const index = Math.min(selected, previous.points.length - 1);
      const a = previous.points[index] as Point;
      const b = previous.points[(index + 1) % previous.points.length] as Point;
      const points = [...previous.points];
      points.splice(index + 1, 0, [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)]);
      setSelected(index + 1);
      return { ...previous, points };
    });

  const removePoint = () =>
    setState((previous) => {
      if (previous.points.length <= 3) return previous;
      const points = previous.points.filter((_, i) => i !== selected);
      setSelected(Math.max(0, selected - 1));
      return { ...previous, points };
    });

  const background = state.backdrop === 'scene' ? `url("${svgDataUri(SAMPLE_SCENE)}") center / cover` : 'linear-gradient(135deg, #17694e, #c8962e)';
  const centre = state.shape === 'circle' || state.shape === 'ellipse' ? [Number(state.values.cx), Number(state.values.cy)] : null;

  return (
    <section class="tool layout-form" data-testid="tool" data-state="done">
      <aside class="tool-side">
        <div class="tool-options">
          <Segmented
            label="Shape"
            small={false}
            value={state.shape}
            onChange={(shape) => setState((previous) => ({ ...previous, shape }))}
            choices={[
              { value: 'polygon', label: 'Polygon' },
              { value: 'circle', label: 'Circle' },
              { value: 'ellipse', label: 'Ellipse' },
              { value: 'inset', label: 'Inset' },
            ]}
          />
          {state.shape === 'polygon' ? (
            <>
              <div class="presets" role="group" aria-label="Shapes">
                {Object.entries(POLYGONS).map(([name, points]) => (
                  <button key={name} type="button" class="chip" onClick={() => setState((previous) => ({ ...previous, points }))}>
                    {name}
                  </button>
                ))}
              </div>
              <p class="control-help">Drag the points on the shape. Select a point and use the arrow keys to nudge it (Shift for bigger steps).</p>
              <div class="button-row">
                <button type="button" class="button button-small" onClick={addPoint}>
                  <Icon name="plus" size={14} />
                  Add point after {selected + 1}
                </button>
                <button type="button" class="button button-small" onClick={removePoint} disabled={state.points.length <= 3}>
                  Remove point {selected + 1}
                </button>
              </div>
              <label class="toggle" for="clip-snap">
                <input
                  id="clip-snap"
                  type="checkbox"
                  role="switch"
                  aria-checked={state.snap}
                  checked={state.snap}
                  onChange={(event) => setState((previous) => ({ ...previous, snap: event.currentTarget.checked }))}
                />
                <span class="toggle-track" aria-hidden="true" />
                <span>Snap to whole percentages</span>
              </label>
            </>
          ) : (
            <ControlsForm
              defs={SHAPE_DEFS[state.shape]}
              values={state.values}
              onChange={(patch) => setState((previous) => ({ ...previous, values: { ...previous.values, ...patch } }))}
              layout="panel"
              idPrefix="clip"
            />
          )}
          <Segmented
            label="Fill"
            value={state.backdrop}
            onChange={(backdrop) => setState((previous) => ({ ...previous, backdrop }))}
            choices={[
              { value: 'scene', label: 'Picture' },
              { value: 'gradient', label: 'Gradient' },
            ]}
          />
        </div>
      </aside>
      <div class="tool-main">
        <div class="clip-stage" ref={stage} data-testid="clip-stage">
          <div class="clip-ghost" style={`background: ${background};`} />
          <div class="clip-shape" style={`background: ${background}; clip-path: ${value};`} />
          {state.shape === 'polygon' && (
            <svg class="clip-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polygon points={state.points.map(([x, y]) => `${x},${y}`).join(' ')} />
            </svg>
          )}
          {state.shape === 'polygon' &&
            state.points.map(([x, y], index) => (
              <button
                key={index}
                type="button"
                class={`handle${index === selected ? ' is-selected' : ''}`}
                style={`left: ${x}%; top: ${y}%;`}
                aria-label={`Point ${index + 1}: ${x}%, ${y}%`}
                onPointerDown={(event) => {
                  setSelected(index);
                  if (stage.current) startDrag(event, stage.current, (fx, fy) => movePoint(index, fx * 100, fy * 100));
                }}
                onFocus={() => setSelected(index)}
                onKeyDown={(event) => {
                  const step = nudge(event);
                  if (!step) return;
                  event.preventDefault();
                  movePoint(index, x + step.dx, y + step.dy);
                }}
              >
                <span>{index + 1}</span>
              </button>
            ))}
          {centre && (
            <button
              type="button"
              class="handle handle-centre"
              style={`left: ${centre[0]}%; top: ${centre[1]}%;`}
              aria-label="Centre"
              onPointerDown={(event) => {
                if (stage.current)
                  startDrag(event, stage.current, (fx, fy) =>
                    setState((previous) => ({ ...previous, values: { ...previous.values, cx: Math.round(clamp(fx * 100, 0, 100)), cy: Math.round(clamp(fy * 100, 0, 100)) } })),
                  );
              }}
              onKeyDown={(event) => {
                const step = nudge(event);
                if (!step) return;
                event.preventDefault();
                setState((previous) => ({
                  ...previous,
                  values: { ...previous.values, cx: clamp(Number(previous.values.cx) + step.dx, 0, 100), cy: clamp(Number(previous.values.cy) + step.dy, 0, 100) },
                }));
              }}
            />
          )}
        </div>
        <CodeOutput
          baseName="clip-path"
          outputs={[
            { label: 'CSS', language: 'css', code: `.shape {\n  clip-path: ${value};\n}\n` },
            { label: 'Tailwind', language: 'html', code: `<div class="[clip-path:${value.replace(/\s+/g, '_')}]"></div>\n` },
            { label: 'Value', language: 'text', code: `${value}\n` },
          ]}
        />
        <p class="status status-info">{state.shape === 'polygon' ? `${state.points.length} points. ` : ''}The faded copy shows the part that is clipped away.</p>
      </div>
    </section>
  );
}

export default defineCustomTool(ClipPath);
