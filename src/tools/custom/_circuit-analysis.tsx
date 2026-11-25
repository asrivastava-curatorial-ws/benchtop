/**
 * The Circuit Simulator's analysis panel: DC operating point, DC sweep,
 * time-domain runs and frequency response, with parameter stepping,
 * stacked plots sharing two draggable cursors, measurements, a spectrum of
 * time-domain results, and CSV and picture export.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type AnalysisKind,
  type AnalysisResult,
  type AnalysisSettings,
  formatValue,
  frequencyStats,
  magnitudeDb,
  type OperatingPoint,
  operatingPointCsv,
  partNames,
  runAnalysis,
  type Signal,
  type Sweep,
  signalLabel,
  signalsFor,
  spectrum,
  sweepCsv,
  type Trace,
  timeStats,
  unwrappedPhase,
  valueAt,
} from '../../lib/circuit/analysis';
import type { CircuitDoc, PlacedPart } from '../../lib/circuit/netlist';
import { PART_BY_TYPE, type PropDef } from '../../lib/circuit/parts';
import { formatSi, minus, parseSi } from '../../lib/si';
import { CHART_COLORS, niceScale } from '../../lib/svg-chart';
import { saveFile } from '../../platform';
import { attempt, notify } from '../../ui/toast';
import { Segmented } from './_shared';

/* ---------------------------------------------------------------- settings -- */

const KINDS: readonly { value: AnalysisKind; label: string }[] = [
  { value: 'op', label: 'Operating point' },
  { value: 'dc', label: 'DC sweep' },
  { value: 'tran', label: 'Time domain' },
  { value: 'ac', label: 'Frequency response' },
];

const SOURCE_TYPES = new Set(['battery', 'ac-source', 'rail', 'current-source']);

const numberProps = (part: PlacedPart): PropDef[] => PART_BY_TYPE.get(part.type)?.props.filter((p) => p.kind === 'number') ?? [];

/** Settings for a circuit that has none: plot its probes (or its first two-terminal part), sweep its first source. */
export function defaultAnalysis(doc: CircuitDoc): AnalysisSettings {
  const probes = doc.parts.filter((p) => p.type === 'probe');
  const outputs: Signal[] = probes.length
    ? probes.map((p) => ({ kind: 'v', part: p.id }))
    : doc.parts
        .filter((p) => ['resistor', 'capacitor', 'inductor', 'diode', 'led'].includes(p.type))
        .slice(0, 1)
        .map((p) => ({ kind: 'v', part: p.id }));
  const source = doc.parts.find((p) => p.type === 'ac-source') ?? doc.parts.find((p) => SOURCE_TYPES.has(p.type));
  const firstValue = doc.parts.find((p) => numberProps(p).length);
  const sweepProp = source && source.type !== 'ac-source' ? (numberProps(source)[0]?.key ?? 'v') : firstValue ? (numberProps(firstValue)[0]?.key ?? '') : '';
  const sweepPart = source && source.type !== 'ac-source' ? source : firstValue;
  const sweepValue = sweepPart && typeof sweepPart.props[sweepProp] === 'number' ? (sweepPart.props[sweepProp] as number) : 1;
  return {
    kind: 'op',
    outputs,
    ...(sweepPart ? { dc: { part: sweepPart.id, prop: sweepProp, from: 0, to: sweepValue > 0 ? sweepValue * 2 : 10, points: 51 } } : {}),
    tran: { stop: Math.max(doc.dt * 2000, 0.001), step: 0 },
    ...(source ? { ac: { source: source.id, from: 1, to: 1e6, perDecade: 20 } } : {}),
  };
}

/** A small number box with SI prefixes, committing on Enter or leaving the box. */
function SiBox({ label, value, unit, onChange, min, width = 7 }: { label: string; value: number; unit: string; onChange: (v: number) => void; min?: number; width?: number }) {
  const shown = unit ? formatSi(value, unit, 4) : String(Number(value.toPrecision(6)));
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(shown);
    setBad(false);
  }, [shown]);
  const commit = () => {
    const v = parseSi(text, unit);
    if (v === null || (min !== undefined && v < min)) {
      setBad(true);
      return;
    }
    setBad(false);
    if (v !== value) onChange(v);
  };
  return (
    <label class="control control-inline">
      <span class="control-label">{label}</span>
      <input
        class={`input cs-an-num${bad ? ' is-invalid' : ''}`}
        style={{ width: `${width + 2}ch` }}
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        aria-invalid={bad}
        spellcheck={false}
      />
    </label>
  );
}

function PartSelect({
  label,
  doc,
  value,
  names,
  filter,
  onChange,
}: {
  label: string;
  doc: CircuitDoc;
  value: string;
  names: Map<string, string>;
  filter: (p: PlacedPart) => boolean;
  onChange: (id: string) => void;
}) {
  const parts = doc.parts.filter(filter);
  return (
    <label class="control control-inline">
      <span class="control-label">{label}</span>
      <select class="select" value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {!parts.some((p) => p.id === value) && <option value="">Choose…</option>}
        {parts.map((p) => (
          <option key={p.id} value={p.id}>
            {names.get(p.id)} ({PART_BY_TYPE.get(p.type)?.name})
          </option>
        ))}
      </select>
    </label>
  );
}

function PropSelect({ part, value, onChange }: { part: PlacedPart | undefined; value: string; onChange: (key: string, def: PropDef) => void }) {
  const props = part ? numberProps(part) : [];
  return (
    <label class="control control-inline">
      <span class="control-label">Value</span>
      <select
        class="select"
        value={value}
        onChange={(e) => {
          const def = props.find((p) => p.key === e.currentTarget.value);
          if (def) onChange(def.key, def);
        }}
      >
        {!props.some((p) => p.key === value) && <option value="">Choose…</option>}
        {props.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Values such as "1k 2.2k 4.7k" or "1k, 10k". */
function parseList(text: string, unit: string): number[] | null {
  const parts = text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const values = parts.map((t) => parseSi(t, unit));
  return values.length && values.every((v): v is number => v !== null) ? values.slice(0, 20) : null;
}

function SteppingEditor({ doc, names, settings, onChange }: { doc: CircuitDoc; names: Map<string, string>; settings: AnalysisSettings; onChange: (s: AnalysisSettings) => void }) {
  const stepping = settings.stepping;
  const part = doc.parts.find((p) => p.id === stepping?.part);
  const unit = part ? (numberProps(part).find((p) => p.key === stepping?.prop)?.unit ?? '') : '';
  const listText = stepping ? stepping.values.map((v) => formatSi(v, unit, 4)).join(', ') : '';
  const [text, setText] = useState(listText);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(listText), [listText]);
  const withoutStepping = (): AnalysisSettings => {
    const { stepping: _, ...rest } = settings;
    return rest;
  };
  return (
    <div class="cs-an-row">
      <label class="check">
        <input
          type="checkbox"
          checked={!!stepping}
          onChange={(e) => {
            if (!e.currentTarget.checked) return onChange(withoutStepping());
            const first = doc.parts.find((p) => p.type === 'resistor') ?? doc.parts.find((p) => numberProps(p).length);
            const def = first ? numberProps(first)[0] : undefined;
            if (!first || !def) return notify('Add a part with a value to step.');
            const base = typeof first.props[def.key] === 'number' ? (first.props[def.key] as number) : 1;
            onChange({ ...settings, stepping: { part: first.id, prop: def.key, values: [base / 2, base, base * 2] } });
          }}
        />
        <span>Step a value</span>
      </label>
      {stepping && (
        <>
          <PartSelect
            label="Part"
            doc={doc}
            names={names}
            value={stepping.part}
            filter={(p) => numberProps(p).length > 0}
            onChange={(id) => {
              const p = doc.parts.find((x) => x.id === id);
              const def = p ? numberProps(p)[0] : undefined;
              if (p && def) {
                const base = typeof p.props[def.key] === 'number' ? (p.props[def.key] as number) : 1;
                onChange({ ...settings, stepping: { part: id, prop: def.key, values: [base / 2, base, base * 2] } });
              }
            }}
          />
          <PropSelect part={part} value={stepping.prop} onChange={(key) => onChange({ ...settings, stepping: { ...stepping, prop: key } })} />
          <label class="control control-inline">
            <span class="control-label">Values</span>
            <input
              class={`input${bad ? ' is-invalid' : ''}`}
              value={text}
              style={{ width: '22ch' }}
              onInput={(e) => setText(e.currentTarget.value)}
              onBlur={() => {
                const values = parseList(text, unit);
                setBad(!values);
                if (values) onChange({ ...settings, stepping: { ...stepping, values } });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              placeholder="1k, 2.2k, 4.7k"
              aria-invalid={bad}
              spellcheck={false}
            />
          </label>
        </>
      )}
    </div>
  );
}

function OutputsEditor({
  doc,
  names,
  settings,
  selected,
  onChange,
}: {
  doc: CircuitDoc;
  names: Map<string, string>;
  settings: AnalysisSettings;
  selected: PlacedPart | null;
  onChange: (s: AnalysisSettings) => void;
}) {
  const key = (s: Signal) => `${s.kind}|${s.part}|${s.terminal ?? ''}`;
  const chosen = new Set(settings.outputs.map(key));
  const add = (s: Signal) => {
    if (chosen.has(key(s))) return;
    onChange({ ...settings, outputs: [...settings.outputs, s].slice(0, 24) });
  };
  const options = doc.parts.flatMap((p) => signalsFor(p).map((s) => ({ part: p, signal: s })));
  const selectedSignals = selected ? signalsFor(selected).filter((s) => !chosen.has(key(s))) : [];
  return (
    <div class="cs-an-row">
      <span class="control-label">Plot</span>
      {settings.outputs.map((s) => (
        <span key={key(s)} class="cs-an-chip">
          {signalLabel(s, doc, names)}
          <button type="button" aria-label={`Stop plotting ${signalLabel(s, doc, names)}`} onClick={() => onChange({ ...settings, outputs: settings.outputs.filter((o) => key(o) !== key(s)) })}>
            ×
          </button>
        </span>
      ))}
      <select
        class="select"
        value=""
        aria-label="Add a voltage, current or power to plot"
        onChange={(e) => {
          const option = options[Number(e.currentTarget.value)];
          if (option) add(option.signal);
          e.currentTarget.value = '';
        }}
        data-testid="cs-an-add"
      >
        <option value="">Add…</option>
        {doc.parts.map((p) => {
          const own = options.map((o, i) => [o, i] as const).filter(([o]) => o.part.id === p.id && !chosen.has(key(o.signal)));
          if (!own.length) return null;
          return (
            <optgroup key={p.id} label={`${names.get(p.id)} (${PART_BY_TYPE.get(p.type)?.name})`}>
              {own.map(([o, i]) => (
                <option key={i} value={String(i)}>
                  {signalLabel(o.signal, doc, names)} — {o.signal.kind === 'v' ? 'voltage' : o.signal.kind === 'i' ? 'current' : 'power'}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      {selected && selectedSignals.length > 0 && (
        <button type="button" class="button button-small" onClick={() => onChange({ ...settings, outputs: [...settings.outputs, ...selectedSignals.slice(0, 2)].slice(0, 24) })}>
          Add {names.get(selected.id)}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- plots -- */

const PALETTE = CHART_COLORS.slice(0, 6);
const DASHES = ['', '6 4', '2 3'];
const colourOf = (i: number) => PALETTE[i % PALETTE.length] as string;
const dashOf = (i: number) => DASHES[Math.floor(i / PALETTE.length) % DASHES.length] as string;

interface Series {
  readonly index: number;
  readonly label: string;
  readonly y: Float64Array;
}

interface Panel {
  readonly title: string;
  readonly format: (v: number) => string;
  readonly series: readonly Series[];
  /** Fixed tick step (degrees for phase). */
  readonly step?: number;
}

const W = 820;
const LEFT = 70;
const RIGHT = 14;
const PANEL_H = 160;
const TITLE_H = 20;
const AXIS_H = 26;
/** Room above the panels for the cursor letters. */
const CURSOR_H = 14;

function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    const v = 10 ** e;
    if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
  }
  if (out.length < 3)
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
      for (const m of [2, 5]) {
        const v = m * 10 ** e;
        if (v >= lo && v <= hi) out.push(v);
      }
  return out.sort((a, b) => a - b);
}

function Plot({
  x,
  logX,
  xFormat,
  panels,
  cursors,
  onCursors,
  svgRef,
  label,
}: {
  x: Float64Array;
  logX: boolean;
  xFormat: (v: number) => string;
  panels: readonly Panel[];
  cursors: [number, number];
  onCursors: (c: [number, number]) => void;
  svgRef: { current: SVGSVGElement | null };
  label: string;
}) {
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  for (const v of x)
    if (Number.isFinite(v) && (!logX || v > 0)) {
      x0 = Math.min(x0, v);
      x1 = Math.max(x1, v);
    }
  if (!(x1 > x0)) {
    x0 = Number.isFinite(x0) ? x0 - 1 : 0;
    x1 = x0 + 2;
  }
  const plotW = W - LEFT - RIGHT;
  const sx = (v: number) => LEFT + (logX ? Math.log(v / x0) / Math.log(x1 / x0) : (v - x0) / (x1 - x0)) * plotW;
  const fromPx = (px: number) => {
    const f = Math.min(1, Math.max(0, (px - LEFT) / plotW));
    return logX ? x0 * (x1 / x0) ** f : x0 + (x1 - x0) * f;
  };
  const xTicks = logX ? logTicks(x0, x1) : niceScale(x0, x1, false).ticks.filter((t) => t >= x0 - 1e-12 * Math.abs(x1) && t <= x1 + 1e-12 * Math.abs(x1));
  const height = CURSOR_H + panels.length * (PANEL_H + TITLE_H) + AXIS_H;
  const dragging = useRef<0 | 1 | null>(null);
  const toData = (e: PointerEvent) => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return fromPx(((e.clientX - r.left) / r.width) * W);
  };
  const onDown = (e: PointerEvent) => {
    const v = toData(e);
    if (v === null) return;
    const d0 = Math.abs(sx(v) - sx(cursors[0]));
    const d1 = Math.abs(sx(v) - sx(cursors[1]));
    dragging.current = d0 <= d1 ? 0 : 1;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onCursors(dragging.current === 0 ? [v, cursors[1]] : [cursors[0], v]);
  };
  const onMove = (e: PointerEvent) => {
    if (dragging.current === null) return;
    const v = toData(e);
    if (v === null) return;
    onCursors(dragging.current === 0 ? [v, cursors[1]] : [cursors[0], v]);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const k = e.shiftKey ? 1 : 0;
    const px = sx(cursors[k]) + (e.key === 'ArrowRight' ? 1 : -1) * (e.altKey ? 1 : 8);
    const v = fromPx(px);
    onCursors(k === 0 ? [v, cursors[1]] : [cursors[0], v]);
  };
  return (
    <svg
      ref={svgRef}
      class="cs-an-plot"
      viewBox={`0 0 ${W} ${height}`}
      role="img"
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the cursors move with the arrow keys
      tabIndex={0}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => {
        dragging.current = null;
      }}
      onKeyDown={onKey}
    >
      {panels.map((panel, pi) => {
        const top = CURSOR_H + pi * (PANEL_H + TITLE_H) + TITLE_H;
        let lo = Number.POSITIVE_INFINITY;
        let hi = Number.NEGATIVE_INFINITY;
        for (const s of panel.series)
          for (const v of s.y)
            if (Number.isFinite(v)) {
              lo = Math.min(lo, v);
              hi = Math.max(hi, v);
            }
        if (!Number.isFinite(lo)) {
          lo = 0;
          hi = 1;
        }
        let ticks: number[];
        let ylo: number;
        let yhi: number;
        if (panel.step) {
          ylo = Math.floor(lo / panel.step) * panel.step;
          yhi = Math.ceil(hi / panel.step) * panel.step;
          if (yhi === ylo) yhi = ylo + panel.step;
          ticks = [];
          for (let t = ylo; t <= yhi + 1e-9; t += panel.step) ticks.push(t);
          while (ticks.length > 7) ticks = ticks.filter((_, i) => i % 2 === 0);
        } else {
          // A trace that dips a hair below zero (numerical noise) should not add a whole step of axis.
          const span = hi - lo;
          if (lo < 0 && -lo < span * 0.02) lo = 0;
          if (hi > 0 && hi < span * 0.02) hi = 0;
          const scale = niceScale(lo, hi, false);
          ylo = scale.lo;
          yhi = scale.hi;
          ticks = scale.ticks;
        }
        const sy = (v: number) => top + PANEL_H - ((v - ylo) / (yhi - ylo || 1)) * PANEL_H;
        return (
          <g key={panel.title}>
            <text x={LEFT} y={top - 6} class="cs-an-title">
              {panel.title}
            </text>
            <rect x={LEFT} y={top} width={plotW} height={PANEL_H} class="cs-an-frame" />
            {ticks.map((t) => (
              <g key={`y${t}`}>
                <line x1={LEFT} x2={LEFT + plotW} y1={sy(t)} y2={sy(t)} class={Math.abs(t) < 1e-15 ? 'cs-an-zero' : 'cs-an-grid'} />
                <text x={LEFT - 6} y={sy(t)} text-anchor="end" dominant-baseline="middle" class="cs-an-tick">
                  {panel.format(t)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <line key={`x${t}`} x1={sx(t)} x2={sx(t)} y1={top} y2={top + PANEL_H} class="cs-an-grid" />
            ))}
            {panel.series.map((s) => {
              const runs: string[] = [];
              let current: string[] = [];
              for (let i = 0; i < s.y.length; i++) {
                const xv = x[i] as number;
                const yv = s.y[i] as number;
                if (!Number.isFinite(yv) || !Number.isFinite(xv) || (logX && xv <= 0)) {
                  if (current.length > 1) runs.push(current.join(' '));
                  current = [];
                  continue;
                }
                current.push(`${sx(xv).toFixed(1)},${sy(Math.max(ylo, Math.min(yhi, yv))).toFixed(1)}`);
              }
              if (current.length > 1) runs.push(current.join(' '));
              return runs.map((points, k) => (
                <polyline key={`${s.index}-${k}`} points={points} fill="none" stroke={colourOf(s.index)} stroke-dasharray={dashOf(s.index) || undefined} stroke-width={2} stroke-linejoin="round" />
              ));
            })}
            {cursors.map((c, k) => (
              <line key={`c${k}`} x1={sx(c)} x2={sx(c)} y1={top} y2={top + PANEL_H} class={`cs-an-cursor cs-an-cursor-${k ? 'b' : 'a'}`} />
            ))}
          </g>
        );
      })}
      {xTicks.map((t) => (
        <text key={`xl${t}`} x={sx(t)} y={height - 8} text-anchor="middle" class="cs-an-tick">
          {xFormat(t)}
        </text>
      ))}
      {cursors.map((c, k) => (
        <text key={`cl${k}`} x={sx(c)} y={11} text-anchor="middle" class="cs-an-cursor-label">
          {k ? 'B' : 'A'}
        </text>
      ))}
    </svg>
  );
}

/* --------------------------------------------------------------- results -- */

function Legend({ traces }: { traces: readonly { index: number; label: string }[] }) {
  if (traces.length < 2) return null;
  return (
    <div class="cs-an-legend">
      {traces.map((t) => (
        <span key={t.index} class="cs-readout">
          <svg width="18" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="18" y2="4" stroke={colourOf(t.index)} stroke-width="2.5" stroke-dasharray={dashOf(t.index) || undefined} />
          </svg>
          {t.label}
        </span>
      ))}
    </div>
  );
}

const fmt = (v: number, unit: string) => minus(formatValue(v, unit, 4));
/** Fixed decimals without a negative zero. */
const fixed = (v: number, digits: number) => minus((Number(v.toFixed(digits)) || 0).toFixed(digits));
const fmtDb = (v: number) => (Number.isFinite(v) ? `${fixed(v, 2)} dB` : '—');
const fmtDeg = (v: number) => (Number.isFinite(v) ? `${fixed(v, 1)}°` : '—');

function SweepView({ sweep, title }: { sweep: Sweep; title: string }) {
  const [view, setView] = useState<'wave' | 'spectrum'>('wave');
  const first = sweep.x[0] ?? 0;
  const last = sweep.x[sweep.x.length - 1] ?? 1;
  const at = (f: number) => (sweep.logX && first > 0 ? first * (last / first) ** f : first + (last - first) * f);
  const [cursors, setCursors] = useState<[number, number]>([at(0.25), at(0.75)]);
  useEffect(() => setCursors([at(0.25), at(0.75)]), [sweep]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const ac = sweep.kind === 'ac';
  const traces = sweep.traces.map((t, index) => ({ ...t, index }));
  const units = [...new Set(traces.map((t) => t.unit))];
  const quantity = (unit: string) => (unit === 'V' ? 'Voltage' : unit === 'A' ? 'Current' : 'Power');

  // Spectrum of time-domain results between the cursors (or the second half of the run).
  const spectra = useMemo(() => {
    if (sweep.kind !== 'tran' || view !== 'spectrum') return null;
    let [a, b] = [Math.min(...cursors), Math.max(...cursors)];
    if (b - a < (last - first) * 0.05) [a, b] = [first + (last - first) / 2, last];
    return traces.map((t) => ({ trace: t, s: spectrum(sweep.x, t.values, a, b), from: a, to: b }));
  }, [sweep, view, cursors]);

  let panels: Panel[];
  let x = sweep.x;
  let logX = sweep.logX;
  let xFormat = (v: number) => minus(formatSi(v, sweep.xUnit, 3));
  if (spectra) {
    const top = Math.max(...spectra.map((sp) => sp.s.fundamental * 12));
    const keep = spectra[0]?.s.frequency.findIndex((f) => f > top) ?? -1;
    const n = keep > 0 ? keep : (spectra[0]?.s.frequency.length ?? 0);
    x = (spectra[0]?.s.frequency ?? new Float64Array(0)).slice(0, n);
    logX = false;
    xFormat = (v) => formatSi(v, 'Hz', 3);
    panels = units.map((u) => ({
      title: `Spectrum, dB relative to 1 ${u} peak`,
      format: (v: number) => minus(v.toFixed(0)),
      step: 20,
      series: spectra
        .filter((sp) => sp.trace.unit === u)
        .map((sp) => ({ index: sp.trace.index, label: sp.trace.label, y: Float64Array.from(sp.s.amplitude.slice(0, n), (a) => Math.max(-140, 20 * Math.log10(a))) })),
    }));
  } else if (ac) {
    panels = [
      ...units.map((u) => ({
        title: u === 'V' ? 'Gain, dB' : u === 'A' ? 'Current for 1 V in, dB relative to 1 A' : `${quantity(u)}, dB`,
        format: (v: number) => minus(v.toFixed(Math.abs(v) < 10 && v !== 0 ? 1 : 0)),
        series: traces.filter((t) => t.unit === u).map((t) => ({ index: t.index, label: t.label, y: Float64Array.from(t.values, (r, i) => magnitudeDb(r, t.imag?.[i] as number)) })),
      })),
      {
        title: 'Phase, degrees',
        format: (v: number) => `${minus(v.toFixed(0))}°`,
        step: 45,
        series: traces.map((t) => ({ index: t.index, label: t.label, y: unwrappedPhase(t.values, t.imag as Float64Array) })),
      },
    ];
  } else {
    panels = units.map((u) => ({
      title: `${quantity(u)}, ${u}`,
      format: (v: number) => minus(formatSi(v, u, 3)),
      series: traces.filter((t) => t.unit === u).map((t) => ({ index: t.index, label: t.label, y: t.values })),
    }));
  }

  const savePicture = () =>
    attempt(async () => {
      const el = svgRef.current;
      if (!el) return;
      const clone = el.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(W));
      clone.removeAttribute('class');
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = PLOT_STYLE;
      clone.insertBefore(style, clone.firstChild);
      const outcome = await saveFile(`${title}-${sweep.kind}.svg`, new XMLSerializer().serializeToString(clone), 'image/svg+xml');
      if (outcome.saved) notify(`Saved ${outcome.location}.`);
    });

  const [ca, cb] = cursors;
  const xUnit = spectra ? 'Hz' : sweep.xUnit;
  const valueText = (t: Trace & { index: number }, c: number): string => {
    if (spectra) {
      const sp = spectra.find((s) => s.trace.index === t.index);
      return sp ? `${minus((20 * Math.log10(Math.max(1e-12, valueAt(sp.s.frequency, sp.s.amplitude, c)))).toFixed(1))} dB` : '—';
    }
    if (t.imag) {
      const re = valueAt(sweep.x, t.values, c, true);
      const im = valueAt(sweep.x, t.imag, c, true);
      return `${fmtDb(magnitudeDb(re, im))}, ${fmtDeg(valueAt(sweep.x, unwrappedPhase(t.values, t.imag), c, true))}`;
    }
    return fmt(valueAt(sweep.x, t.values, c, sweep.logX), t.unit);
  };
  const delta = (t: Trace & { index: number }): string => {
    if (spectra) return '';
    if (t.imag) {
      const g = (c: number) => magnitudeDb(valueAt(sweep.x, t.values, c, true), valueAt(sweep.x, t.imag as Float64Array, c, true));
      return fmtDb(g(cb) - g(ca));
    }
    return fmt(valueAt(sweep.x, t.values, cb, sweep.logX) - valueAt(sweep.x, t.values, ca, sweep.logX), t.unit);
  };
  const dx = cb - ca;

  return (
    <div class="cs-an-results" data-testid="cs-an-results">
      <div class="button-row">
        {sweep.kind === 'tran' && (
          <Segmented
            label="Show"
            value={view}
            onChange={setView}
            choices={[
              { value: 'wave', label: 'Waveforms' },
              { value: 'spectrum', label: 'Spectrum' },
            ]}
          />
        )}
        <button type="button" class="button button-small" onClick={() => attempt(async () => void (await saveFile(`${title}-${sweep.kind}.csv`, sweepCsv(sweep), 'text/csv')))} data-testid="cs-an-csv">
          Save CSV
        </button>
        <button type="button" class="button button-small" onClick={savePicture}>
          Save picture
        </button>
        <span class="tone-muted cs-an-hint">Drag on the plot to move cursors A and B (arrow keys move A, with Shift B).</span>
      </div>
      <Legend traces={traces} />
      <Plot
        x={x}
        logX={logX}
        xFormat={xFormat}
        panels={panels}
        cursors={cursors}
        onCursors={setCursors}
        svgRef={svgRef}
        label={`${KINDS.find((k) => k.value === sweep.kind)?.label} results: ${traces.map((t) => t.label).join(', ')}`}
      />
      <div class="cs-an-wrap">
        <table class="data-table cs-an-table" data-testid="cs-an-cursors">
          <thead>
            <tr>
              <th scope="col">Trace</th>
              <th scope="col">A at {minus(formatSi(ca, xUnit, 4))}</th>
              <th scope="col">B at {minus(formatSi(cb, xUnit, 4))}</th>
              {!spectra && (
                <th scope="col">B − A{sweep.logX ? '' : ` (${minus(formatSi(dx, xUnit, 4))}${sweep.kind === 'tran' && dx !== 0 ? `, 1/Δt = ${formatSi(Math.abs(1 / dx), 'Hz', 4)}` : ''})`}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {traces.map((t) => (
              <tr key={t.index}>
                <th scope="row">
                  <span class="cs-swatch" style={{ background: colourOf(t.index) }} /> {t.label}
                </th>
                <td>{valueText(t, ca)}</td>
                <td>{valueText(t, cb)}</td>
                {!spectra && <td>{delta(t)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details class="cs-an-measure" open>
        <summary>Measurements</summary>
        <div class="cs-an-wrap">
          <Measurements sweep={sweep} traces={traces} spectra={spectra} />
        </div>
      </details>
    </div>
  );
}

function Measurements({
  sweep,
  traces,
  spectra,
}: {
  sweep: Sweep;
  traces: readonly (Trace & { index: number })[];
  spectra: readonly { trace: Trace & { index: number }; s: ReturnType<typeof spectrum>; from: number; to: number }[] | null;
}) {
  if (spectra)
    return (
      <table class="data-table cs-an-table">
        <thead>
          <tr>
            <th scope="col">Trace</th>
            <th scope="col">Fundamental</th>
            <th scope="col">Its amplitude</th>
            <th scope="col">Distortion (THD)</th>
            <th scope="col">Window</th>
          </tr>
        </thead>
        <tbody>
          {spectra.map(({ trace, s, from, to }) => {
            const k = s.frequency.findIndex((f) => f >= s.fundamental);
            return (
              <tr key={trace.index}>
                <th scope="row">{trace.label}</th>
                <td>{formatSi(s.fundamental, 'Hz', 4)}</td>
                <td>{fmt(s.amplitude[k] ?? Number.NaN, trace.unit)} peak</td>
                <td>{Number.isFinite(s.thd) ? `${(s.thd * 100).toFixed(2)} %` : '—'}</td>
                <td>
                  {formatSi(from, 's', 3)} to {formatSi(to, 's', 3)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  if (sweep.kind === 'ac')
    return (
      <table class="data-table cs-an-table" data-testid="cs-an-measurements">
        <thead>
          <tr>
            <th scope="col">Trace</th>
            <th scope="col">Gain at {formatSi(sweep.x[0] ?? 0, 'Hz', 3)}</th>
            <th scope="col">Peak</th>
            <th scope="col">−3 dB points</th>
            <th scope="col">0 dB crossing</th>
            <th scope="col">Phase margin</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((t) => {
            const st = frequencyStats(sweep.x, t.values, t.imag as Float64Array);
            const corners = [st.lowerCorner, st.upperCorner].filter(Number.isFinite).map((f) => formatSi(f, 'Hz', 4));
            return (
              <tr key={t.index}>
                <th scope="row">{t.label}</th>
                <td>{fmtDb(st.lowGain)}</td>
                <td>
                  {fmtDb(st.peakGain)} at {formatSi(st.peakFrequency, 'Hz', 3)}
                </td>
                <td>{corners.length ? corners.join(' and ') : 'beyond the range'}</td>
                <td>{Number.isFinite(st.unityGain) ? formatSi(st.unityGain, 'Hz', 4) : '—'}</td>
                <td>{Number.isFinite(st.phaseAtUnity) ? fmtDeg(180 + (((st.phaseAtUnity % 360) - 360) % 360)) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  return (
    <table class="data-table cs-an-table" data-testid="cs-an-measurements">
      <thead>
        <tr>
          <th scope="col">Trace</th>
          <th scope="col">Minimum</th>
          <th scope="col">Maximum</th>
          <th scope="col">Peak to peak</th>
          {sweep.kind === 'tran' && (
            <>
              <th scope="col">Average</th>
              <th scope="col">RMS</th>
              <th scope="col">Frequency</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {traces.map((t) => {
          const st = timeStats(sweep.x, t.values);
          return (
            <tr key={t.index}>
              <th scope="row">{t.label}</th>
              <td>{fmt(st.min, t.unit)}</td>
              <td>{fmt(st.max, t.unit)}</td>
              <td>{fmt(st.max - st.min, t.unit)}</td>
              {sweep.kind === 'tran' && (
                <>
                  <td>{fmt(st.average, t.unit)}</td>
                  <td>{fmt(st.rms, t.unit)}</td>
                  <td>{Number.isFinite(st.frequency) ? formatSi(st.frequency, 'Hz', 4) : '—'}</td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OperatingPointView({ op, doc, title, onShow, shown }: { op: OperatingPoint; doc: CircuitDoc; title: string; onShow: (on: boolean) => void; shown: boolean }) {
  const names = partNames(doc);
  const rows: ComponentChildren[] = [];
  for (const part of doc.parts) {
    const r = op.parts.get(part.id);
    const def = PART_BY_TYPE.get(part.type);
    if (!r || !def || def.ground) continue;
    def.terminals.forEach((t, k) => {
      if (!Number.isFinite(r.volts[k] as number)) return;
      rows.push(
        <tr key={`${part.id}-${k}`}>
          {k === 0 && (
            <th scope="row" rowSpan={def.terminals.filter((_, j) => Number.isFinite(r.volts[j] as number)).length}>
              {names.get(part.id)}
              <span class="tone-muted"> {def.name}</span>
            </th>
          )}
          <td>{t.name}</td>
          <td>{fmt(r.volts[k] as number, 'V')}</td>
          <td>{Number.isFinite(r.currents[k] as number) ? fmt(r.currents[k] as number, 'A') : '—'}</td>
          {k === 0 && <td rowSpan={def.terminals.filter((_, j) => Number.isFinite(r.volts[j] as number)).length}>{fmt(r.power, 'W')}</td>}
        </tr>,
      );
    });
  }
  return (
    <div class="cs-an-results" data-testid="cs-an-results">
      <div class="button-row">
        <label class="check">
          <input type="checkbox" checked={shown} onChange={(e) => onShow(e.currentTarget.checked)} data-testid="cs-an-show" />
          <span>Show voltages and currents on the drawing</span>
        </label>
        <button type="button" class="button button-small" onClick={() => attempt(async () => void (await saveFile(`${title}-operating-point.csv`, operatingPointCsv(op, doc), 'text/csv')))}>
          Save CSV
        </button>
      </div>
      <div class="cs-an-wrap cs-an-op">
        <table class="data-table cs-an-table" data-testid="cs-an-op">
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col">Terminal</th>
              <th scope="col">Voltage</th>
              <th scope="col">Current in</th>
              <th scope="col">Power taken</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
      <p class="control-help">Currents are positive flowing into the terminal; a negative power means the part delivers power.</p>
    </div>
  );
}

/* ----------------------------------------------------------------- panel -- */

export function AnalysisPanel({
  doc,
  selected,
  onSettings,
  onOperatingPoint,
}: {
  doc: CircuitDoc;
  selected: PlacedPart | null;
  onSettings: (settings: AnalysisSettings) => void;
  /** The operating point to label on the drawing, or null. */
  onOperatingPoint: (op: OperatingPoint | null) => void;
}) {
  const fallback = useMemo(() => defaultAnalysis(doc), [doc.parts]);
  const saved = doc.analysis;
  // Saved settings, with defaults for the analyses they do not set up yet.
  const settings: AnalysisSettings = saved
    ? {
        ...saved,
        ...(saved.dc || !fallback.dc ? {} : { dc: fallback.dc }),
        ...(saved.tran || !fallback.tran ? {} : { tran: fallback.tran }),
        ...(saved.ac || !fallback.ac ? {} : { ac: fallback.ac }),
      }
    : fallback;
  const names = useMemo(() => partNames(doc), [doc.parts]);
  const [result, setResult] = useState<{ result: AnalysisResult; parts: CircuitDoc['parts']; wires: CircuitDoc['wires']; doc: CircuitDoc } | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [showOp, setShowOp] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const set = (next: AnalysisSettings) => onSettings(next);
  const title = (doc.title || 'circuit').replace(/[^\w\- ]+/g, '').trim() || 'circuit';

  // Results of another circuit (a new example, or parts taken away) are dropped; edits leave them marked out of date.
  const stale = result && (result.parts !== doc.parts || result.wires !== doc.wires);
  useEffect(() => {
    if (result && !result.parts.every((p) => doc.parts.find((q) => q.id === p.id)?.type === p.type)) {
      setResult(null);
      setError('');
    }
  }, [doc.parts]);
  useEffect(() => {
    onOperatingPoint(result?.result.kind === 'op' && showOp && !stale ? result.result : null);
  }, [result, showOp, stale]);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError('');
    setProgress(0);
    const snapshot = doc;
    try {
      const r = await runAnalysis(snapshot, settings, { signal: controller.signal, onProgress: (f) => setProgress(f) });
      if (!controller.signal.aborted) setResult({ result: r, parts: snapshot.parts, wires: snapshot.wires, doc: snapshot });
    } catch (e) {
      if (!controller.signal.aborted || !(e instanceof Error && e.message === 'Stopped.')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setProgress(null);
      }
    }
  };

  const sweepPart = doc.parts.find((p) => p.id === settings.dc?.part);
  const sweepDef = sweepPart ? numberProps(sweepPart).find((p) => p.key === settings.dc?.prop) : undefined;
  const sweepUnit = sweepDef?.unit ?? '';

  return (
    <div class="cs-analysis" data-testid="cs-analysis">
      <div class="cs-an-row">
        <Segmented label="Analysis" value={settings.kind} onChange={(kind) => set({ ...settings, kind })} choices={KINDS} />
        {progress === null ? (
          <button type="button" class="button button-primary button-small" onClick={() => void run()} data-testid="cs-an-run">
            Run analysis
          </button>
        ) : (
          <>
            <button type="button" class="button button-small button-danger" onClick={() => abort.current?.abort()}>
              Stop
            </button>
            <progress max={1} value={progress} aria-label="Analysis progress" />
          </>
        )}
      </div>

      {settings.kind === 'dc' && (
        <div class="cs-an-row">
          <PartSelect
            label="Sweep"
            doc={doc}
            names={names}
            value={settings.dc?.part ?? ''}
            filter={(p) => numberProps(p).length > 0}
            onChange={(id) => {
              const p = doc.parts.find((x) => x.id === id);
              const def = p ? numberProps(p)[0] : undefined;
              if (!p || !def) return;
              const base = typeof p.props[def.key] === 'number' ? (p.props[def.key] as number) : 1;
              set({ ...settings, dc: { part: id, prop: def.key, from: 0, to: base > 0 ? base * 2 : 10, points: settings.dc?.points ?? 51 } });
            }}
          />
          <PropSelect part={sweepPart} value={settings.dc?.prop ?? ''} onChange={(key) => settings.dc && set({ ...settings, dc: { ...settings.dc, prop: key } })} />
          {settings.dc && (
            <>
              <SiBox label="From" value={settings.dc.from} unit={sweepUnit} onChange={(from) => set({ ...settings, dc: { ...(settings.dc as NonNullable<AnalysisSettings['dc']>), from } })} />
              <SiBox label="To" value={settings.dc.to} unit={sweepUnit} onChange={(to) => set({ ...settings, dc: { ...(settings.dc as NonNullable<AnalysisSettings['dc']>), to } })} />
              <SiBox
                label="Points"
                value={settings.dc.points}
                unit=""
                min={2}
                width={4}
                onChange={(points) => set({ ...settings, dc: { ...(settings.dc as NonNullable<AnalysisSettings['dc']>), points: Math.round(points) } })}
              />
              <label class="check">
                <input
                  type="checkbox"
                  checked={settings.dc.log === true}
                  onChange={(e) => set({ ...settings, dc: { ...(settings.dc as NonNullable<AnalysisSettings['dc']>), log: e.currentTarget.checked } })}
                />
                <span>Logarithmic</span>
              </label>
            </>
          )}
        </div>
      )}

      {settings.kind === 'tran' && (
        <div class="cs-an-row">
          <SiBox label="Run for" value={settings.tran?.stop ?? 0.01} unit="s" min={1e-9} onChange={(stop) => set({ ...settings, tran: { step: 0, ...settings.tran, stop } })} />
          <SiBox
            label="Time step"
            value={settings.tran?.step || doc.dt}
            unit="s"
            min={1e-9}
            onChange={(step) => set({ ...settings, tran: { stop: settings.tran?.stop ?? 0.01, ...settings.tran, step } })}
          />
          <label class="check">
            <input
              type="checkbox"
              checked={settings.tran?.fromZero === true}
              onChange={(e) => set({ ...settings, tran: { stop: settings.tran?.stop ?? 0.01, step: settings.tran?.step ?? 0, fromZero: e.currentTarget.checked } })}
            />
            <span>Start from zero (skip the operating point)</span>
          </label>
        </div>
      )}

      {settings.kind === 'ac' && (
        <div class="cs-an-row">
          <PartSelect
            label="Input"
            doc={doc}
            names={names}
            value={settings.ac?.source ?? ''}
            filter={(p) => SOURCE_TYPES.has(p.type)}
            onChange={(source) => set({ ...settings, ac: { from: 1, to: 1e6, perDecade: 20, ...settings.ac, source } })}
          />
          {settings.ac && (
            <>
              <SiBox label="From" value={settings.ac.from} unit="Hz" min={1e-6} onChange={(from) => set({ ...settings, ac: { ...(settings.ac as NonNullable<AnalysisSettings['ac']>), from } })} />
              <SiBox label="To" value={settings.ac.to} unit="Hz" min={1e-6} onChange={(to) => set({ ...settings, ac: { ...(settings.ac as NonNullable<AnalysisSettings['ac']>), to } })} />
              <SiBox
                label="Points per decade"
                value={settings.ac.perDecade}
                unit=""
                min={1}
                width={4}
                onChange={(perDecade) => set({ ...settings, ac: { ...(settings.ac as NonNullable<AnalysisSettings['ac']>), perDecade: Math.round(perDecade) } })}
              />
            </>
          )}
          <span class="tone-muted cs-an-hint">The input is 1 V (or 1 A) at every frequency, so a voltage plotted is the gain.</span>
        </div>
      )}

      {settings.kind !== 'op' && (
        <>
          <OutputsEditor doc={doc} names={names} settings={settings} selected={selected} onChange={set} />
          <SteppingEditor doc={doc} names={names} settings={settings} onChange={set} />
        </>
      )}

      {error && (
        <p class="cs-warning" role="alert" data-testid="cs-an-error">
          {error}
        </p>
      )}
      {stale && <p class="tone-muted">The circuit has changed since this run; run it again to update.</p>}
      {result && 'warnings' in result.result && result.result.warnings.length > 0 && (
        <ul class="cs-problems">
          {result.result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {result?.result.kind === 'op' ? (
        <OperatingPointView op={result.result} doc={result.doc} title={title} shown={showOp} onShow={setShowOp} />
      ) : result ? (
        <SweepView sweep={result.result as Sweep} title={title} />
      ) : (
        !error && <p class="tone-muted">{HINTS[settings.kind]}</p>
      )}
    </div>
  );
}

const HINTS: Readonly<Record<AnalysisKind, string>> = {
  op: 'Finds the DC voltage at every node and the current and power of every part, with capacitors open and inductors shorted, and labels them on the drawing.',
  dc: 'Changes one part value in steps (a supply voltage, a resistance) and plots the DC results against it: transfer curves and characteristics.',
  tran: 'Runs the circuit through time from its operating point and plots what you choose, with measurements and a spectrum.',
  ac: 'Small-signal frequency response about the operating point: gain and phase of what you choose for a 1 V input, as a Bode plot.',
};

/** Colours for a saved plot, which has no access to the app's theme. */
const PLOT_STYLE = `
svg { background: #ffffff; font-family: "JetBrains Mono", monospace; }
.cs-an-title { fill: #1f2328; font-size: 12px; font-weight: 600; }
.cs-an-tick { fill: #57606a; font-size: 11px; }
.cs-an-frame { fill: #ffffff; stroke: #d0d7de; }
.cs-an-grid { stroke: #eaeef2; } .cs-an-zero { stroke: #8c959f; }
.cs-an-cursor { stroke: #57606a; stroke-dasharray: 4 3; } .cs-an-cursor-label { fill: #57606a; font-size: 11px; }
`;
