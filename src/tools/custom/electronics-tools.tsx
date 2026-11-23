/**
 * Electronics design tools: Filter Designer (analog op-amp stages, LC
 * ladders, digital IIR and FIR filters with response plots and code) and
 * Smith Chart (reflection, VSWR, lines and L matching networks).
 */
import { useMemo, useState } from 'preact/hooks';
import {
  analogFilter,
  analogResponse,
  analogStep,
  type Biquad,
  biquadResponseAt,
  crossings,
  evaluate,
  type Family,
  type FilterKind,
  type FilterSpec,
  type FirWindow,
  firCode,
  firResponse,
  firResponseAt,
  firTaps,
  iirCode,
  iirResponse,
  iirSections,
  kaiserTaps,
  ladder,
  logSpace,
  minimumOrder,
  opAmpStages,
  type ResponsePoint,
  runBiquads,
  type Series,
  type Stage,
  sections,
} from '../../lib/filters';
import { formatSi, minus, parseSi } from '../../lib/si';
import { alongLine, type Complex, elementPath, fromVswr, gammaOf, linePath, lMatches, loadFacts, type Match, quarterWave } from '../../lib/smith';
import { niceScale } from '../../lib/svg-chart';
import { copyText, saveFile } from '../../platform';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Capacitor, Dot, Ground, Inductor, Label, OpAmp, Resistor, Schematic, Terminal, Wire } from './_schematic';
import { Segmented, usePersistentState } from './_shared';

/* ---------------------------------------------------------------- plots -- */

const PLOT_W = 720;
const PLOT_H = 280;
const M = { left: 52, right: 14, top: 12, bottom: 34 };

const decadeTicks = (lo: number, hi: number): number[] => {
  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 2, 5]) if (m * 10 ** e >= lo * 0.999 && m * 10 ** e <= hi * 1.001) ticks.push(m * 10 ** e);
  return ticks;
};

interface PlotLine {
  readonly name: string;
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly className: string;
}

/** A line plot with a logarithmic or linear x axis. */
function Plot({
  lines,
  logX,
  xLabel,
  yLabel,
  yRange,
  marksX = [],
  marksY = [],
  formatX,
}: {
  lines: readonly PlotLine[];
  logX: boolean;
  xLabel: string;
  yLabel: string;
  yRange?: readonly [number, number];
  marksX?: readonly number[];
  marksY?: readonly number[];
  formatX: (v: number) => string;
}) {
  const xsAll = lines.flatMap((l) => l.xs);
  const ysAll = lines.flatMap((l) => l.ys).filter(Number.isFinite);
  if (xsAll.length === 0 || ysAll.length === 0) return null;
  const xMin = Math.min(...xsAll);
  const xMax = Math.max(...xsAll);
  const scaleY = yRange ? niceScale(yRange[0], yRange[1], false) : niceScale(Math.min(...ysAll), Math.max(...ysAll), false);
  const iw = PLOT_W - M.left - M.right;
  const ih = PLOT_H - M.top - M.bottom;
  const px = (v: number) => M.left + (logX ? (Math.log10(v) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin)) : (v - xMin) / (xMax - xMin || 1)) * iw;
  const py = (v: number) => M.top + (1 - (Math.min(scaleY.hi, Math.max(scaleY.lo, v)) - scaleY.lo) / (scaleY.hi - scaleY.lo || 1)) * ih;
  const xTicks = logX ? decadeTicks(xMin, xMax) : niceScale(xMin, xMax, false).ticks.filter((t) => t >= xMin && t <= xMax);
  return (
    <svg class="flt-plot" viewBox={`0 0 ${PLOT_W} ${PLOT_H}`} role="img" aria-label={`${yLabel} against ${xLabel}`}>
      {scaleY.ticks.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.left} x2={PLOT_W - M.right} y1={py(t)} y2={py(t)} class="flt-grid" />
          <text x={M.left - 6} y={py(t) + 4} text-anchor="end" class="flt-tick">
            {Math.abs(t) < (scaleY.hi - scaleY.lo) * 1e-9 ? '0' : minus(Number(t.toPrecision(6)))}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line x1={px(t)} x2={px(t)} y1={M.top} y2={PLOT_H - M.bottom} class="flt-grid" />
          <text x={px(t)} y={PLOT_H - M.bottom + 15} text-anchor="middle" class="flt-tick">
            {formatX(t)}
          </text>
        </g>
      ))}
      {marksY
        .filter((v) => v >= scaleY.lo && v <= scaleY.hi)
        .map((v) => (
          <line key={`my${v}`} x1={M.left} x2={PLOT_W - M.right} y1={py(v)} y2={py(v)} class="flt-mark" />
        ))}
      {marksX
        .filter((v) => v >= xMin && v <= xMax)
        .map((v) => (
          <line key={`mx${v}`} x1={px(v)} x2={px(v)} y1={M.top} y2={PLOT_H - M.bottom} class="flt-mark" />
        ))}
      {lines.map((l) => (
        <polyline
          key={l.name}
          class={l.className}
          fill="none"
          points={l.xs
            .map((x, i) => [x, l.ys[i] as number] as const)
            .filter(([, y]) => Number.isFinite(y))
            .map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`)
            .join(' ')}
        />
      ))}
      <text x={M.left + iw / 2} y={PLOT_H - 4} text-anchor="middle" class="flt-axis">
        {xLabel}
      </text>
      <text x={12} y={M.top + ih / 2} text-anchor="middle" class="flt-axis" transform={`rotate(-90 12 ${M.top + ih / 2})`}>
        {yLabel}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------- filter designer -- */

type Build = 'active' | 'lc' | 'iir' | 'fir';
type View = 'magnitude' | 'phase' | 'step';

interface FilterState {
  readonly kind: FilterKind;
  readonly family: Family;
  readonly order: number;
  readonly ripple: number;
  readonly f1: string;
  readonly f2: string;
  readonly build: Build;
  readonly baseC: string;
  readonly series: Series;
  readonly r0: string;
  readonly start: 'shunt' | 'series';
  readonly fs: string;
  readonly taps: number;
  readonly window: FirWindow;
  readonly kaiserDb: number;
  readonly view: View;
  readonly code: 'c' | 'python';
  readonly stopF: string;
  readonly stopDb: number;
}

const FILTER_DEFAULTS: FilterState = {
  kind: 'lowpass',
  family: 'butterworth',
  order: 4,
  ripple: 1,
  f1: '1k',
  f2: '2k',
  build: 'active',
  baseC: '10n',
  series: 'E24',
  r0: '50',
  start: 'shunt',
  fs: '48k',
  taps: 101,
  window: 'hamming',
  kaiserDb: 60,
  view: 'magnitude',
  code: 'c',
  stopF: '4k',
  stopDb: 40,
};

const readFilter = (v: Values | undefined): FilterState => {
  const out: Record<string, unknown> = { ...FILTER_DEFAULTS };
  if (v) for (const key of Object.keys(FILTER_DEFAULTS)) if (typeof v[key] === typeof (FILTER_DEFAULTS as unknown as Record<string, unknown>)[key]) out[key] = v[key];
  return out as unknown as FilterState;
};

const KIND_NAMES: Record<FilterKind, string> = { lowpass: 'low-pass', highpass: 'high-pass', bandpass: 'band-pass', bandstop: 'band-stop' };
const FAMILY_NAMES: Record<Family, string> = { butterworth: 'Butterworth', chebyshev: 'Chebyshev', bessel: 'Bessel' };

interface Design {
  readonly spec: FilterSpec;
  readonly response: ResponsePoint[];
  readonly step: { t: number[]; y: number[] } | null;
  readonly stages: Stage[];
  readonly sections: ReturnType<typeof sections>;
  readonly ladder: ReturnType<typeof ladder>;
  readonly biquads: Biquad[] | null;
  readonly taps: number[] | null;
  readonly sampleRate: number | null;
  readonly code: string | null;
  readonly title: string;
  /** Gain in dB at a frequency, from the transfer function itself. */
  readonly gainAt: (f: number) => number;
}

function design(s: FilterState): Design {
  const f1 = parseSi(s.f1, 'Hz');
  const f2 = parseSi(s.f2, 'Hz');
  const band = s.kind === 'bandpass' || s.kind === 'bandstop';
  if (!(f1 && f1 > 0)) throw new Error(band ? 'Enter the lower edge frequency, such as 300 or 1.5k.' : 'Enter the cutoff frequency, such as 1k or 2.5 kHz.');
  if (band && !(f2 && f2 > f1)) throw new Error('The upper edge must be above the lower edge.');
  const spec: FilterSpec = { kind: s.kind, family: s.family, order: s.order, rippleDb: s.ripple, f1, f2: band ? (f2 as number) : f1 };
  const title = `${s.order}${ordinal(s.order)}-order ${FAMILY_NAMES[s.family]} ${KIND_NAMES[s.kind]}, ${band ? `${formatSi(f1, 'Hz')} to ${formatSi(spec.f2, 'Hz')}` : formatSi(f1, 'Hz')}`;
  const digital = s.build === 'iir' || s.build === 'fir';
  const sampleRate = digital ? parseSi(s.fs, 'Hz') : null;
  if (digital && !(sampleRate && sampleRate > 2 * (band ? spec.f2 : f1))) throw new Error('The sample rate must be more than twice the highest frequency of the filter.');
  const lo = band ? Math.sqrt(f1 * spec.f2) / 30 : f1 / 100;
  const hi = digital ? (sampleRate as number) / 2 : band ? Math.sqrt(f1 * spec.f2) * 30 : f1 * 100;
  const freqs = logSpace(Math.max(lo, digital ? (sampleRate as number) / 20000 : 0), hi * (digital ? 0.9999 : 1), 500);
  const list = sections(spec);
  if (s.build === 'fir') {
    const taps = firTaps(s.kind, f1, spec.f2, sampleRate as number, s.taps, s.window, s.kaiserDb);
    const step = (() => {
      let acc = 0;
      const y = taps.map((h) => {
        acc += h;
        return acc;
      });
      return { t: y.map((_, i) => i / (sampleRate as number)), y };
    })();
    const firTitle = `${taps.length}-tap FIR ${KIND_NAMES[s.kind]} (${s.window} window), ${band ? `${formatSi(f1, 'Hz')} to ${formatSi(spec.f2, 'Hz')}` : formatSi(f1, 'Hz')}`;
    return {
      spec,
      response: firResponse(taps, sampleRate as number, freqs),
      step,
      stages: [],
      sections: list,
      ladder: null,
      biquads: null,
      taps,
      sampleRate,
      code: firCode(taps, s.code, sampleRate as number, firTitle),
      title: firTitle,
      gainAt: (f) => decibels(firResponseAt(taps, (2 * Math.PI * f) / (sampleRate as number))),
    };
  }
  if (s.build === 'iir') {
    const biquads = iirSections(spec, sampleRate as number);
    const count = Math.min(20000, Math.ceil(((sampleRate as number) * (band ? 20 : 8)) / f1));
    const y = runBiquads(
      biquads,
      Array.from({ length: count }, () => 1),
    );
    return {
      spec,
      response: iirResponse(biquads, sampleRate as number, freqs),
      step: { t: y.map((_, i) => i / (sampleRate as number)), y },
      stages: [],
      sections: list,
      ladder: null,
      biquads,
      taps: null,
      sampleRate,
      code: iirCode(biquads, s.code, sampleRate as number, title),
      title,
      gainAt: (f) => decibels(biquadResponseAt(biquads, (2 * Math.PI * f) / (sampleRate as number))),
    };
  }
  const zpk = analogFilter(spec);
  const baseC = parseSi(s.baseC, 'F');
  const r0 = parseSi(s.r0, 'Ω');
  return {
    spec,
    response: analogResponse(zpk, freqs),
    step: analogStep(spec),
    stages: baseC && baseC > 0 ? opAmpStages(list, baseC, s.series) : [],
    sections: list,
    ladder: r0 && r0 > 0 ? ladder(spec, r0, s.start) : null,
    biquads: null,
    taps: null,
    sampleRate: null,
    code: null,
    title,
    gainAt: (f) => decibels(evaluate(zpk, { re: 0, im: 2 * Math.PI * f })),
  };
}

const decibels = (h: { re: number; im: number }) => 20 * Math.log10(Math.max(Math.hypot(h.re, h.im), 1e-15));

/** Crossings of `level`, found on the plotted points and refined on the transfer function. */
function exactCrossings(d: Design, level: number): number[] {
  return crossings(d.response, level).map((guess) => {
    let lo = guess / 1.05;
    let hi = guess * 1.05;
    const rising = d.gainAt(hi) > d.gainAt(lo);
    for (let i = 0; i < 60; i++) {
      const mid = Math.sqrt(lo * hi);
      if (d.gainAt(mid) > level === rising) hi = mid;
      else lo = mid;
    }
    return Math.sqrt(lo * hi);
  });
}

const ordinal = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

function Facts({ d }: { d: Design }) {
  const { spec, response } = d;
  const edges = exactCrossings(d, -3.0103);
  const rows: [string, string][] = [];
  if (edges.length) rows.push(['−3 dB at', edges.map((f) => formatSi(f, 'Hz', 4)).join(' and ')]);
  const probes =
    spec.kind === 'lowpass'
      ? [2, 10].map((k) => [spec.f1 * k, k === 2 ? 'an octave above' : 'a decade above'] as const)
      : spec.kind === 'highpass'
        ? [0.5, 0.1].map((k) => [spec.f1 * k, k === 0.5 ? 'an octave below' : 'a decade below'] as const)
        : spec.kind === 'bandpass'
          ? ([
              [spec.f1 / 2, 'an octave below the band'],
              [spec.f2 * 2, 'an octave above the band'],
            ] as const)
          : ([[Math.sqrt(spec.f1 * spec.f2), 'at the centre']] as const);
  const fMin = response[0]?.f ?? 0;
  const fMax = response[response.length - 1]?.f ?? 0;
  for (const [f, words] of probes) if (f >= fMin && f <= fMax) rows.push([`${formatSi(f, 'Hz')} (${words})`, `${minus(d.gainAt(f).toFixed(1))} dB`]);
  if (d.step && (spec.kind === 'lowpass' || spec.kind === 'bandstop')) {
    const final = d.step.y[d.step.y.length - 1] ?? 1;
    const peak = Math.max(...d.step.y);
    if (final > 0) rows.push(['Step overshoot', `${Math.max(0, (peak / final - 1) * 100).toFixed(1)} %`]);
  }
  return (
    <dl class="flt-facts" data-testid="flt-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const ohms = (v: number) => formatSi(v, 'Ω');
const farads = (v: number) => formatSi(v, 'F');
const henries = (v: number) => formatSi(v, 'H');
const partValue = (name: string, v: number) => (name.startsWith('R') ? ohms(v) : farads(v));

function StageSchematic({ stage }: { stage: Stage }) {
  const p = stage.parts;
  const v = (k: string) => (p[k] === undefined ? '' : partValue(k, p[k] as number));
  if (stage.section.order === 1) {
    const lowpass = stage.section.type !== 'highpass';
    return (
      <Schematic width={330} height={130} label={`First-order ${lowpass ? 'low-pass' : 'high-pass'} RC stage with a buffer`}>
        <Terminal x={24} y={50} label="in" />
        <Wire d="M27 50h13" />
        {lowpass ? <Resistor x={40} y={50} name="R1" value={v('R1')} /> : <Capacitor x={40} y={50} name="C1" value={v('C1')} />}
        <Wire d="M80 50h110" />
        <Dot x={110} y={50} />
        {lowpass ? <Capacitor x={110} y={50} vertical name="C1" value={v('C1')} /> : <Resistor x={110} y={50} vertical name="R1" value={v('R1')} />}
        <Ground x={110} y={90} />
        <OpAmp x={190} y={50} />
        <Wire d="M240 60h50M265 60v45h-85v-35h10" />
        <Dot x={265} y={60} />
        <Terminal x={293} y={60} label="out" end />
      </Schematic>
    );
  }
  if (stage.circuit === 'Multiple feedback') {
    return (
      <Schematic width={380} height={150} label="Multiple-feedback band-pass stage">
        <Terminal x={24} y={80} label="in" />
        <Wire d="M27 80h13" />
        <Resistor x={40} y={80} name="R1" value={v('R1')} />
        <Wire d="M80 80h60" />
        <Dot x={110} y={80} />
        <Resistor x={110} y={80} vertical name="R3" value={v('R3')} />
        <Ground x={110} y={120} />
        <Capacitor x={140} y={80} name="C2" value={v('C2')} />
        <Wire d="M180 80h40" />
        <Dot x={200} y={80} />
        <Wire d="M110 80v-15" />
        <Capacitor x={110} y={25} vertical name="C1" value={v('C1')} />
        <Wire d="M110 25h210v65" />
        <Wire d="M200 80v-30h20" />
        <Resistor x={220} y={50} name="R2" value={v('R2')} />
        <Wire d="M260 50h40v40" />
        <OpAmp x={220} y={80} swap />
        <Wire d="M220 100h-8v18" />
        <Ground x={212} y={118} />
        <Wire d="M270 90h70" />
        <Dot x={300} y={90} />
        <Dot x={320} y={90} />
        <Terminal x={343} y={90} label="out" end />
      </Schematic>
    );
  }
  const lowpass = stage.section.type === 'lowpass';
  return (
    <Schematic width={400} height={160} label={`Unity-gain Sallen-Key ${lowpass ? 'low-pass' : 'high-pass'} stage`}>
      <Terminal x={24} y={80} label="in" />
      <Wire d="M27 80h13" />
      {lowpass ? <Resistor x={40} y={80} name="R1" value={v('R1')} /> : <Capacitor x={40} y={80} name="C1" value={v('C1')} />}
      <Wire d="M80 80h50" />
      <Dot x={110} y={80} />
      {lowpass ? <Resistor x={130} y={80} name="R2" value={v('R2')} /> : <Capacitor x={130} y={80} name="C2" value={v('C2')} />}
      <Wire d="M170 80h90" />
      <Dot x={200} y={80} />
      {lowpass ? <Capacitor x={200} y={80} vertical name="C2" value={v('C2')} /> : <Resistor x={200} y={80} vertical name="R2" value={v('R2')} />}
      <Ground x={200} y={120} />
      <Wire d="M110 80v-20" />
      {lowpass ? <Capacitor x={110} y={20} vertical name="C1" value={v('C1')} /> : <Resistor x={110} y={20} vertical name="R1" value={v('R1')} />}
      <Wire d="M110 20h220v70" />
      <OpAmp x={260} y={80} />
      <Wire d="M310 90h50M330 90v50h-80v-40h10" />
      <Dot x={330} y={90} />
      <Terminal x={363} y={90} label="out" end />
    </Schematic>
  );
}

function LadderSchematic({ d, r0 }: { d: Design; r0: number }) {
  if (!d.ladder) return null;
  const parts = d.ladder.parts;
  const width = 150 + parts.reduce((w, p) => w + (p.role === 'series' ? 60 : 70), 0) + 90;
  let x = 90;
  const items = parts.map((p) => {
    const value = p.kind === 'L' ? henries(p.value) : farads(p.value);
    if (p.role === 'series') {
      const at = x;
      x += 60;
      return (
        <g key={p.name}>
          {p.kind === 'L' ? <Inductor x={at + 10} y={50} name={p.name} value={value} flip /> : <Capacitor x={at + 10} y={50} name={p.name} value={value} flip />}
          <Wire d={`M${at} 50h10M${at + 50} 50h10`} />
        </g>
      );
    }
    const at = x + 25;
    x += 70;
    return (
      <g key={p.name}>
        <Wire d={`M${at - 25} 50h70`} />
        <Dot x={at} y={50} />
        {p.kind === 'L' ? <Inductor x={at} y={50} vertical name={p.name} value={value} /> : <Capacitor x={at} y={50} vertical name={p.name} value={value} />}
        <Ground x={at} y={90} />
      </g>
    );
  });
  return (
    <Schematic width={width} height={130} label="LC ladder">
      <Terminal x={24} y={50} label="in" />
      <Wire d="M27 50h23" />
      <Resistor x={50} y={50} name="Rs" value={ohms(r0)} flip />
      {items}
      <Wire d={`M${x} 50h40`} />
      <Dot x={x + 20} y={50} />
      <Resistor x={x + 20} y={50} vertical name="RL" value={ohms(d.ladder.load)} />
      <Ground x={x + 20} y={90} />
      <Terminal x={x + 43} y={50} label="out" end />
    </Schematic>
  );
}

function FilterDesigner({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readFilter, (s) => ({ ...s }));
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) => setState((s) => ({ ...s, [k]: v }));
  const result = useMemo(() => {
    try {
      return { design: design(state), error: null };
    } catch (error) {
      return { design: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [state]);
  const d = result.design;
  const band = state.kind === 'bandpass' || state.kind === 'bandstop';
  const digital = state.build === 'iir' || state.build === 'fir';
  const foundOrder = useMemo(() => {
    const f1 = parseSi(state.f1, 'Hz');
    const f2 = parseSi(state.f2, 'Hz');
    const stop = parseSi(state.stopF, 'Hz');
    if (!(f1 && stop)) return null;
    return minimumOrder({ kind: state.kind, family: state.family, rippleDb: state.ripple, f1, f2: band ? (f2 ?? f1) : f1 }, stop, state.stopDb);
  }, [state.f1, state.f2, state.stopF, state.stopDb, state.kind, state.family, state.ripple]);
  const suggestedTaps = useMemo(() => {
    const fs = parseSi(state.fs, 'Hz');
    const f1 = parseSi(state.f1, 'Hz');
    const stop = parseSi(state.stopF, 'Hz');
    if (!(fs && f1 && stop)) return null;
    const edge = band ? Math.min(Math.abs(stop - f1), Math.abs(stop - (parseSi(state.f2, 'Hz') ?? f1))) : Math.abs(stop - f1);
    return edge > 0 ? kaiserTaps(state.kaiserDb, edge, fs) : null;
  }, [state.fs, state.f1, state.f2, state.stopF, state.kaiserDb, band]);

  const r0 = parseSi(state.r0, 'Ω') ?? 50;
  const view = state.view;
  const plot =
    d &&
    (view === 'step' && d.step ? (
      <Plot lines={[{ name: 'step', xs: d.step.t, ys: d.step.y, className: 'flt-line' }]} logX={false} xLabel="Time" yLabel="Step output" marksY={[1, 0]} formatX={(t) => formatSi(t, 's', 3)} />
    ) : (
      <Plot
        lines={[{ name: 'response', xs: d.response.map((p) => p.f), ys: d.response.map((p) => (view === 'phase' ? p.phase : p.db)), className: 'flt-line' }]}
        logX
        xLabel={d.sampleRate ? `Frequency (sample rate ${formatSi(d.sampleRate, 'Hz')})` : 'Frequency'}
        yLabel={view === 'phase' ? 'Phase (degrees)' : 'Gain (dB)'}
        yRange={view === 'phase' ? undefined : [Math.max(-120, Math.min(...d.response.map((p) => p.db))), Math.max(0, ...d.response.map((p) => (p.db > 0.5 ? p.db : 0)))]}
        marksY={view === 'phase' ? [] : [-3.0103]}
        marksX={band ? [d.spec.f1, d.spec.f2] : [d.spec.f1]}
        formatX={(f) => formatSi(f, 'Hz', 3)}
      />
    ));

  const partsList = () => {
    if (!d) return '';
    if (state.build === 'lc' && d.ladder)
      return [d.title, `Source ${ohms(r0)}`, ...d.ladder.parts.map((p) => `${p.name} (${p.role}) ${p.kind === 'L' ? henries(p.value) : farads(p.value)}`), `Load ${ohms(d.ladder.load)}`].join('\n');
    return [
      d.title,
      ...d.stages.map(
        (st, i) =>
          `Stage ${i + 1} ${st.circuit}: ${Object.entries(st.parts)
            .map(([k, v]) => `${k} ${partValue(k, v)}`)
            .join(', ')}`,
      ),
    ].join('\n');
  };

  return (
    <section class="tool flt-tool" data-testid="tool" data-state={d ? 'done' : 'idle'}>
      <div class="flt-layout">
        <div class="flt-controls">
          <Segmented
            label="Kind of filter"
            value={state.kind}
            onChange={(k) => set('kind', k)}
            choices={[
              { value: 'lowpass', label: 'Low-pass' },
              { value: 'highpass', label: 'High-pass' },
              { value: 'bandpass', label: 'Band-pass' },
              { value: 'bandstop', label: 'Band-stop' },
            ]}
          />
          <Segmented
            label="Response"
            value={state.family}
            onChange={(k) => set('family', k)}
            choices={[
              { value: 'butterworth', label: 'Butterworth' },
              { value: 'chebyshev', label: 'Chebyshev' },
              { value: 'bessel', label: 'Bessel' },
            ]}
          />
          <p class="control-help">
            {state.family === 'butterworth'
              ? 'Flattest passband; the usual choice.'
              : state.family === 'chebyshev'
                ? 'Steeper roll-off for the same order, with ripple in the passband.'
                : 'Gentle roll-off but almost no overshoot or ringing: best for pulses and audio crossovers that keep wave shapes.'}
          </p>
          <div class="flt-row">
            <label class="control">
              <span class="control-label">{band ? 'Lower edge' : 'Cutoff'}</span>
              <input class="input" value={state.f1} onInput={(e) => set('f1', e.currentTarget.value)} data-testid="flt-f1" spellcheck={false} />
            </label>
            {band && (
              <label class="control">
                <span class="control-label">Upper edge</span>
                <input class="input" value={state.f2} onInput={(e) => set('f2', e.currentTarget.value)} data-testid="flt-f2" spellcheck={false} />
              </label>
            )}
            <label class="control">
              <span class="control-label">Order</span>
              <input
                class="input input-narrow"
                type="number"
                min={1}
                max={12}
                value={state.order}
                onInput={(e) => set('order', Math.max(1, Math.min(12, Number(e.currentTarget.value) || 1)))}
                data-testid="flt-order"
              />
            </label>
            {state.family === 'chebyshev' && (
              <label class="control">
                <span class="control-label">Ripple (dB)</span>
                <input
                  class="input input-narrow"
                  type="number"
                  min={0.01}
                  max={6}
                  step={0.1}
                  value={state.ripple}
                  onInput={(e) => set('ripple', Math.max(0.01, Number(e.currentTarget.value) || 0.5))}
                />
              </label>
            )}
          </div>
          <p class="control-help">
            Frequencies in Hz; 1k, 2.5 kHz and 1M work. {state.family === 'chebyshev' ? 'For Chebyshev filters the cutoff is the edge of the ripple band.' : 'The cutoff is the −3 dB point.'}
          </p>
          <details class="flt-finder">
            <summary>Find the lowest order for a stopband</summary>
            <div class="flt-row">
              <label class="control">
                <span class="control-label">Stopband frequency</span>
                <input class="input" value={state.stopF} onInput={(e) => set('stopF', e.currentTarget.value)} spellcheck={false} />
              </label>
              <label class="control">
                <span class="control-label">Attenuation (dB)</span>
                <input class="input input-narrow" type="number" min={3} max={150} value={state.stopDb} onInput={(e) => set('stopDb', Number(e.currentTarget.value) || 40)} />
              </label>
            </div>
            <p class="control-help" data-testid="flt-found">
              {foundOrder ? (
                <>
                  Order {foundOrder} is enough.{' '}
                  {foundOrder !== state.order && (
                    <button type="button" class="link-button" onClick={() => set('order', foundOrder)}>
                      Use order {foundOrder}
                    </button>
                  )}
                </>
              ) : (
                'The stopband must lie outside the passband, and orders above 12 are not offered.'
              )}
            </p>
          </details>
          <span class="control-label">Build it as</span>
          <Segmented
            label="Build it as"
            value={state.build}
            onChange={(b) => set('build', b)}
            choices={[
              { value: 'active', label: 'Op-amp stages' },
              { value: 'lc', label: 'LC ladder' },
              { value: 'iir', label: 'Digital IIR' },
              { value: 'fir', label: 'Digital FIR' },
            ]}
          />
          {state.build === 'active' && (
            <div class="flt-row">
              <label class="control">
                <span class="control-label">Capacitor to start from</span>
                <input class="input" value={state.baseC} onInput={(e) => set('baseC', e.currentTarget.value)} spellcheck={false} />
              </label>
              <label class="control">
                <span class="control-label">Round parts to</span>
                <select class="select" value={state.series} onChange={(e) => set('series', e.currentTarget.value as Series)}>
                  <option value="E12">E12 (10 %)</option>
                  <option value="E24">E24 (5 %)</option>
                  <option value="E96">E96 (1 %)</option>
                  <option value="exact">Exact values</option>
                </select>
              </label>
            </div>
          )}
          {state.build === 'lc' && (
            <div class="flt-row">
              <label class="control">
                <span class="control-label">Source and load (Ω)</span>
                <input class="input" value={state.r0} onInput={(e) => set('r0', e.currentTarget.value)} spellcheck={false} />
              </label>
              <label class="control">
                <span class="control-label">First element</span>
                <select class="select" value={state.start} onChange={(e) => set('start', e.currentTarget.value as 'shunt' | 'series')}>
                  <option value="shunt">Across the line (Π)</option>
                  <option value="series">In the line (T)</option>
                </select>
              </label>
            </div>
          )}
          {digital && (
            <div class="flt-row">
              <label class="control">
                <span class="control-label">Sample rate</span>
                <input class="input" value={state.fs} onInput={(e) => set('fs', e.currentTarget.value)} data-testid="flt-fs" spellcheck={false} />
              </label>
              {state.build === 'fir' && (
                <>
                  <label class="control">
                    <span class="control-label">Taps</span>
                    <input
                      class="input input-narrow"
                      type="number"
                      min={3}
                      max={4001}
                      step={2}
                      value={state.taps}
                      onInput={(e) => set('taps', Math.max(3, Math.min(4001, Number(e.currentTarget.value) || 101)))}
                    />
                  </label>
                  <label class="control">
                    <span class="control-label">Window</span>
                    <select class="select" value={state.window} onChange={(e) => set('window', e.currentTarget.value as FirWindow)}>
                      <option value="hamming">Hamming</option>
                      <option value="hann">Hann</option>
                      <option value="blackman">Blackman</option>
                      <option value="kaiser">Kaiser</option>
                    </select>
                  </label>
                  {state.window === 'kaiser' && (
                    <label class="control">
                      <span class="control-label">Stopband (dB)</span>
                      <input class="input input-narrow" type="number" min={21} max={140} value={state.kaiserDb} onInput={(e) => set('kaiserDb', Number(e.currentTarget.value) || 60)} />
                    </label>
                  )}
                </>
              )}
            </div>
          )}
          {state.build === 'fir' && suggestedTaps && (
            <p class="control-help">
              For {state.kaiserDb} dB by {state.stopF} Hz a Kaiser window needs about {suggestedTaps} taps.{' '}
              {suggestedTaps !== state.taps && (
                <button type="button" class="link-button" onClick={() => setState((s) => ({ ...s, taps: suggestedTaps, window: 'kaiser' }))}>
                  Use {suggestedTaps}
                </button>
              )}
            </p>
          )}
        </div>
        <div class="flt-results">
          {result.error && <p class="recipe-error">{result.error}</p>}
          {d && (
            <>
              <div class="button-row">
                <strong class="flt-title" data-testid="flt-title">
                  {d.title}
                </strong>
                <Segmented
                  label="Plot"
                  value={view}
                  onChange={(v) => set('view', v)}
                  choices={[
                    { value: 'magnitude', label: 'Gain' },
                    { value: 'phase', label: 'Phase' },
                    { value: 'step', label: 'Step response' },
                  ]}
                />
              </div>
              <div class="flt-plot-wrap" data-testid="flt-plot">
                {plot}
              </div>
              <Facts d={d} />
              {state.build === 'active' && (
                <div class="flt-stages" data-testid="flt-stages">
                  {d.stages.map((st, i) => (
                    <div key={`${i}-${st.section.f0}`} class="flt-stage">
                      <div class="flt-stage-head">
                        <strong>
                          Stage {i + 1}: {st.circuit}
                        </strong>
                        <span class="tone-muted">
                          f₀ {formatSi(st.section.f0, 'Hz', 4)}
                          {st.section.order === 2 ? `, Q ${st.section.q.toFixed(3)}` : ''}
                          {state.series !== 'exact' && `; with these parts ${formatSi(st.actualF0, 'Hz', 4)}${st.section.order === 2 ? `, Q ${st.actualQ.toFixed(3)}` : ''}`}
                          {Math.abs(st.gain - 1) > 0.01 ? `; gain ${st.gain.toFixed(2)} (inverting)` : ''}
                        </span>
                      </div>
                      <StageSchematic stage={st} />
                    </div>
                  ))}
                  {d.sections.some((s) => s.type === 'notch') && (
                    <div class="flt-stage">
                      <p>Band-stop filters need notch stages; build each with a twin-T or Fliege notch circuit:</p>
                      <ul>
                        {d.sections.map((s, i) => (
                          <li key={i}>
                            Stage {i + 1}:{' '}
                            {s.order === 2 ? `poles at ${formatSi(s.f0, 'Hz', 4)}, Q ${s.q.toFixed(3)}, notch at ${formatSi(s.fz ?? s.f0, 'Hz', 4)}` : `first-order at ${formatSi(s.f0, 'Hz', 4)}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p class="control-help">
                    Use op-amps with a gain–bandwidth at least 100 × f₀ × Q of the hardest stage, and 1 % film capacitors (C0G/NP0 for small values). Order the stages as shown, lowest Q first.
                  </p>
                </div>
              )}
              {state.build === 'lc' && (
                <div class="flt-stages" data-testid="flt-ladder">
                  {d.ladder ? (
                    <>
                      <LadderSchematic d={d} r0={r0} />
                      {Math.abs(d.ladder.load - r0) > r0 * 0.001 && (
                        <p class="control-help">
                          Even-order Chebyshev ladders need a load of {ohms(d.ladder.load)}, not {ohms(r0)}.
                        </p>
                      )}
                    </>
                  ) : (
                    <p class="recipe-error">LC ladders are offered for Butterworth and Chebyshev low-pass and high-pass filters.</p>
                  )}
                </div>
              )}
              {d.biquads && (
                <table class="data-table flt-coeffs" data-testid="flt-coeffs">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>b0</th>
                      <th>b1</th>
                      <th>b2</th>
                      <th>a1</th>
                      <th>a2</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.biquads.map((q, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        {[q.b[0], q.b[1], q.b[2], q.a[1], q.a[2]].map((v, k) => (
                          <td key={k} class="num">
                            {Number(v.toPrecision(10))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {d.code && (
                <div class="pane flt-code">
                  <div class="pane-header">
                    <Segmented
                      label="Language"
                      value={state.code}
                      onChange={(v) => set('code', v)}
                      choices={[
                        { value: 'c', label: 'C / Arduino' },
                        { value: 'python', label: 'Python (SciPy)' },
                      ]}
                    />
                    <span class="pane-actions">
                      <button
                        type="button"
                        class="button button-small button-quiet"
                        onClick={() =>
                          attempt(async () => {
                            await copyText(d.code ?? '');
                            notify('Code copied');
                          })
                        }
                      >
                        <Icon name="copy" size={12} /> Copy
                      </button>
                      <button
                        type="button"
                        class="button button-small button-quiet"
                        onClick={() =>
                          attempt(async () => {
                            const outcome = await saveFile(state.code === 'c' ? 'filter.h' : 'filter.py', d.code ?? '', 'text/plain');
                            if (outcome.saved) notify(`Saved to ${outcome.location}`);
                          })
                        }
                      >
                        <Icon name="save" size={12} /> Save
                      </button>
                    </span>
                  </div>
                  <div class="pane-body">
                    <CodeEditor value={d.code} readOnly language={state.code === 'c' ? 'cpp' : 'python'} label="Filter code" />
                  </div>
                </div>
              )}
              {(state.build === 'active' || state.build === 'lc') && (
                <div class="button-row">
                  <button
                    type="button"
                    class="button button-small"
                    onClick={() =>
                      attempt(async () => {
                        await copyText(partsList());
                        notify('Parts list copied');
                      })
                    }
                  >
                    <Icon name="copy" size={12} /> Copy the parts list
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- Smith chart -- */

interface SmithState {
  readonly input: 'impedance' | 'vswr';
  readonly r: string;
  readonly x: string;
  readonly vswr: string;
  readonly angle: string;
  readonly z0: string;
  readonly frequency: string;
  readonly line: string;
}

const SMITH_DEFAULTS: SmithState = { input: 'impedance', r: '25', x: '-30', vswr: '2', angle: '45', z0: '50', frequency: '100M', line: '0.1' };
const readSmith = (v: Values | undefined): SmithState => {
  const out: Record<string, unknown> = { ...SMITH_DEFAULTS };
  if (v) for (const key of Object.keys(SMITH_DEFAULTS)) if (typeof v[key] === 'string') out[key] = v[key];
  return out as unknown as SmithState;
};

const SIZE = 420;
const R = 190;
const CX = SIZE / 2;
const CY = SIZE / 2;
const gx = (g: Complex) => CX + g.re * R;
const gy = (g: Complex) => CY - g.im * R;
const pathOf = (points: readonly Complex[]) => points.map((g, i) => `${i ? 'L' : 'M'}${gx(g).toFixed(1)} ${gy(g).toFixed(1)}`).join('');

function SmithGrid({ admittance }: { admittance: boolean }) {
  const rs = [0.2, 0.5, 1, 2, 5];
  const xs = [0.2, 0.5, 1, 2, 5];
  const flip = admittance ? `rotate(180 ${CX} ${CY})` : undefined;
  return (
    <g class={admittance ? 'smith-grid smith-admittance' : 'smith-grid'} transform={flip} clip-path="url(#smith-clip)">
      {rs.map((r) => (
        <circle key={`r${r}`} cx={CX + (r / (1 + r)) * R} cy={CY} r={R / (1 + r)} />
      ))}
      {xs.flatMap((x) => [<circle key={`x${x}`} cx={CX + R} cy={CY - R / x} r={R / x} />, <circle key={`-x${x}`} cx={CX + R} cy={CY + R / x} r={R / x} />])}
      <line x1={CX - R} x2={CX + R} y1={CY} y2={CY} />
    </g>
  );
}

function SmithLabels() {
  return (
    <g class="smith-labels">
      {[0.2, 0.5, 1, 2, 5].map((r) => (
        <text key={`r${r}`} x={CX + ((r - 1) / (r + 1)) * R + 2} y={CY - 3}>
          {r}
        </text>
      ))}
      {[0.2, 0.5, 1, 2, 5].flatMap((x) => {
        const top = gammaOf({ re: 0, im: x }, 1);
        const bottom = gammaOf({ re: 0, im: -x }, 1);
        return [
          <text key={`x${x}`} x={gx(top) + (top.re > 0 ? 4 : -4)} y={gy(top) - 4} text-anchor={top.re > 0 ? 'start' : 'end'}>
            +j{x}
          </text>,
          <text key={`-x${x}`} x={gx(bottom) + (bottom.re > 0 ? 4 : -4)} y={gy(bottom) + 12} text-anchor={bottom.re > 0 ? 'start' : 'end'}>
            −j{x}
          </text>,
        ];
      })}
    </g>
  );
}

const fmtZ = (z: Complex) => `${Number(z.re.toPrecision(4))} ${z.im < 0 ? '−' : '+'} j${Number(Math.abs(z.im).toPrecision(4))} Ω`;

function describeMatch(m: Match): string {
  return m.parts.map((p) => `${p.where === 'series' ? 'series' : 'shunt'} ${p.kind === 'L' ? `${formatSi(p.value, 'H')} inductor` : `${formatSi(p.value, 'F')} capacitor`}`).join(', then ');
}

function SmithChart({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readSmith, (s) => ({ ...s }));
  const [picked, setPicked] = useState(0);
  const [showAdmittance, setShowAdmittance] = useState(false);
  const set = <K extends keyof SmithState>(k: K, v: SmithState[K]) => setState((s) => ({ ...s, [k]: v }));
  const z0 = parseSi(state.z0, 'Ω') ?? 50;
  const frequency = parseSi(state.frequency, 'Hz') ?? 1e8;
  const lineLength = Number(state.line) || 0;
  const load: Complex | null = useMemo(() => {
    if (state.input === 'vswr') {
      const vswr = Number(state.vswr);
      const angle = Number(state.angle);
      return vswr >= 1 && Number.isFinite(angle) ? fromVswr(vswr, angle, z0) : null;
    }
    const r = parseSi(state.r, 'Ω');
    const x = parseSi(state.x, 'Ω') ?? (state.x.trim() === '' ? 0 : null);
    return r !== null && r >= 0 && x !== null ? { re: r, im: x } : null;
  }, [state, z0]);
  const facts = load && z0 > 0 ? loadFacts(load, z0) : null;
  const matches = load && frequency > 0 ? lMatches(load, z0, frequency) : [];
  const match = matches[Math.min(picked, matches.length - 1)] ?? null;
  const afterLine = load && lineLength ? alongLine(load, z0, lineLength) : null;

  return (
    <section class="tool smith-tool" data-testid="tool" data-state={facts ? 'done' : 'idle'}>
      <div class="smith-layout">
        <div class="smith-controls">
          <Segmented
            label="Load given as"
            value={state.input}
            onChange={(v) => set('input', v)}
            choices={[
              { value: 'impedance', label: 'Impedance' },
              { value: 'vswr', label: 'VSWR and angle' },
            ]}
          />
          {state.input === 'impedance' ? (
            <div class="flt-row">
              <label class="control">
                <span class="control-label">Resistance R (Ω)</span>
                <input class="input" value={state.r} onInput={(e) => set('r', e.currentTarget.value)} data-testid="smith-r" spellcheck={false} />
              </label>
              <label class="control">
                <span class="control-label">Reactance X (Ω)</span>
                <input class="input" value={state.x} onInput={(e) => set('x', e.currentTarget.value)} data-testid="smith-x" spellcheck={false} />
              </label>
            </div>
          ) : (
            <div class="flt-row">
              <label class="control">
                <span class="control-label">VSWR</span>
                <input class="input" value={state.vswr} onInput={(e) => set('vswr', e.currentTarget.value)} spellcheck={false} />
              </label>
              <label class="control">
                <span class="control-label">Angle of Γ (°)</span>
                <input class="input" value={state.angle} onInput={(e) => set('angle', e.currentTarget.value)} spellcheck={false} />
              </label>
            </div>
          )}
          <div class="flt-row">
            <label class="control">
              <span class="control-label">Line impedance Z₀ (Ω)</span>
              <input class="input" value={state.z0} onInput={(e) => set('z0', e.currentTarget.value)} spellcheck={false} />
            </label>
            <label class="control">
              <span class="control-label">Frequency</span>
              <input class="input" value={state.frequency} onInput={(e) => set('frequency', e.currentTarget.value)} spellcheck={false} />
            </label>
          </div>
          {facts ? (
            <dl class="flt-facts smith-facts" data-testid="smith-facts">
              <div>
                <dt>Load</dt>
                <dd>{load ? fmtZ(load) : ''}</dd>
              </div>
              <div>
                <dt>Normalised</dt>
                <dd>{load ? `${Number((load.re / z0).toPrecision(4))} ${load.im < 0 ? '−' : '+'} j${Number(Math.abs(load.im / z0).toPrecision(4))}` : ''}</dd>
              </div>
              <div>
                <dt>Reflection Γ</dt>
                <dd>
                  {facts.magnitude.toFixed(4)} ∠ {minus(facts.angle.toFixed(1))}°
                </dd>
              </div>
              <div>
                <dt>VSWR</dt>
                <dd>{Number.isFinite(facts.vswr) ? facts.vswr.toFixed(3) : '∞'}</dd>
              </div>
              <div>
                <dt>Return loss</dt>
                <dd>{Number.isFinite(facts.returnLoss) ? `${facts.returnLoss.toFixed(2)} dB` : '∞ (perfect match)'}</dd>
              </div>
              <div>
                <dt>Mismatch loss</dt>
                <dd>
                  {Number.isFinite(facts.mismatchLoss) ? `${facts.mismatchLoss.toFixed(3)} dB` : '∞'} ({(facts.reflected * 100).toFixed(1)} % of the power reflected)
                </dd>
              </div>
              <div>
                <dt>Admittance</dt>
                <dd>
                  {formatSi(facts.admittance.re, 'S', 4)} {facts.admittance.im < 0 ? '−' : '+'} j{formatSi(Math.abs(facts.admittance.im), 'S', 4)}
                </dd>
              </div>
              {load && load.im === 0 && load.re > 0 && (
                <div>
                  <dt>Quarter-wave transformer</dt>
                  <dd>{ohms(quarterWave(load.re, z0))} line, λ/4 long</dd>
                </div>
              )}
            </dl>
          ) : (
            <p class="recipe-error">Enter a load with a resistance of 0 or more, or a VSWR of 1 or more.</p>
          )}
          <label class="control">
            <span class="control-label">Line between load and source (wavelengths)</span>
            <input class="input input-narrow" value={state.line} onInput={(e) => set('line', e.currentTarget.value)} spellcheck={false} />
          </label>
          {afterLine && (
            <p class="control-help" data-testid="smith-line">
              After {lineLength} λ of {ohms(z0)} line the load looks like {fmtZ(afterLine)}.
            </p>
          )}
        </div>
        <div class="smith-chart-wrap">
          <svg class="smith-chart" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Smith chart" data-testid="smith-chart">
            <defs>
              <clipPath id="smith-clip">
                <circle cx={CX} cy={CY} r={R} />
              </clipPath>
            </defs>
            <circle cx={CX} cy={CY} r={R} class="smith-edge" />
            {showAdmittance && <SmithGrid admittance />}
            <SmithGrid admittance={false} />
            <SmithLabels />
            {facts && <circle cx={CX} cy={CY} r={facts.magnitude * R} class="smith-vswr" />}
            {load && lineLength !== 0 && <path d={pathOf(linePath(load, z0, lineLength))} class="smith-line" />}
            {load && match && (
              <>
                <path d={pathOf(elementPath(load, match.parts[0], z0))} class="smith-step" />
                <path d={pathOf(elementPath(match.middle, match.parts[1], z0))} class="smith-step" />
                <circle cx={gx(gammaOf(match.middle, z0))} cy={gy(gammaOf(match.middle, z0))} r={3.5} class="smith-mid" />
              </>
            )}
            {afterLine && <circle cx={gx(gammaOf(afterLine, z0))} cy={gy(gammaOf(afterLine, z0))} r={4} class="smith-after" />}
            {facts && <circle cx={gx(facts.gamma)} cy={gy(facts.gamma)} r={5} class="smith-load" />}
            <circle cx={CX} cy={CY} r={2.5} class="smith-centre" />
          </svg>
          <label class="check">
            <input type="checkbox" checked={showAdmittance} onChange={(e) => setShowAdmittance(e.currentTarget.checked)} /> Show the admittance grid
          </label>
          <p class="control-help">
            <span class="smith-key smith-key-load" /> load <span class="smith-key smith-key-vswr" /> constant VSWR <span class="smith-key smith-key-step" /> matching path
            {lineLength !== 0 && (
              <>
                {' '}
                <span class="smith-key smith-key-line" /> line
              </>
            )}
          </p>
        </div>
      </div>
      {load && facts && (
        <div class="smith-matches" data-testid="smith-matches">
          <h3>Matching networks for {formatSi(frequency, 'Hz')}</h3>
          {facts.magnitude < 1e-6 ? (
            <p>The load already matches the line.</p>
          ) : matches.length === 0 ? (
            <p class="recipe-error">No two-element network can match a load without resistance.</p>
          ) : (
            <ul class="smith-match-list">
              {matches.map((m, i) => (
                <li key={describeMatch(m)}>
                  <button type="button" class={`smith-match${i === picked ? ' is-active' : ''}`} aria-pressed={i === picked} onClick={() => setPicked(i)}>
                    <MatchSchematic m={m} z0={z0} />
                    <span>From the load: {describeMatch(m)}.</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function MatchSchematic({ m, z0 }: { m: Match; z0: number }) {
  // Drawn source on the left, load on the right: the element at the load is on the right.
  const [atLoad, atSource] = m.parts;
  const part = (p: typeof atLoad, x: number) => {
    const value = p.kind === 'L' ? henries(p.value) : farads(p.value);
    const name = p.kind;
    if (p.where === 'series') return p.kind === 'L' ? <Inductor x={x} y={30} name={name} value={value} /> : <Capacitor x={x} y={30} name={name} value={value} />;
    return (
      <>
        <Wire d={`M${x} 30h40`} />
        <Dot x={x + 20} y={30} />
        {p.kind === 'L' ? <Inductor x={x + 20} y={30} vertical name={name} value={value} /> : <Capacitor x={x + 20} y={30} vertical name={name} value={value} />}
        <Ground x={x + 20} y={70} />
      </>
    );
  };
  return (
    <Schematic width={250} height={100} label="Matching network">
      <Terminal x={14} y={30} label="" />
      <Label x={14} y={56}>
        {`${Number(z0.toPrecision(4))} Ω`}
      </Label>
      <Wire d="M17 30h33" />
      {part(atSource, 50)}
      <Wire d="M90 30h30" />
      {part(atLoad, 120)}
      <Wire d="M160 30h40" />
      <Label x={226} y={34}>
        load
      </Label>
      <rect x={200} y={22} width={14} height={16} fill="none" stroke="currentColor" stroke-width={1.4} />
    </Schematic>
  );
}

function ElectronicsTools({ toolId }: { toolId: string }) {
  if (toolId === 'smith-chart') return <SmithChart toolId={toolId} />;
  return <FilterDesigner toolId={toolId} />;
}

export default defineCustomTool(ElectronicsTools);
