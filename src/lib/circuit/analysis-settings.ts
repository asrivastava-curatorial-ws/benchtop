/**
 * What an analysis is set to do, as kept in a circuit file: the kind of
 * analysis, the signals to plot, the sweep, run or frequency range, and an
 * optional part value to step.
 */

export type SignalKind = 'v' | 'i' | 'p';

/** Something to plot: a voltage, a current or a power, of a part. */
export interface Signal {
  readonly kind: SignalKind;
  readonly part: string;
  /** For 'v': the node at this terminal (otherwise across terminals 0 and 1, or at the probe).  For 'i': into this terminal. */
  readonly terminal?: number;
}

export interface DcSweepSettings {
  readonly part: string;
  readonly prop: string;
  readonly from: number;
  readonly to: number;
  readonly points: number;
  readonly log?: boolean;
}

export interface TransientSettings {
  /** Seconds to simulate. */
  readonly stop: number;
  /** Time step in seconds (0: the circuit's own). */
  readonly step: number;
  /** Start with every capacitor and inductor empty instead of from the operating point. */
  readonly fromZero?: boolean;
}

export interface AcSettings {
  /** The source whose small-signal value is 1 (volt or ampere). */
  readonly source: string;
  readonly from: number;
  readonly to: number;
  readonly perDecade: number;
}

export interface Stepping {
  readonly part: string;
  readonly prop: string;
  readonly values: readonly number[];
}

export type AnalysisKind = 'op' | 'dc' | 'tran' | 'ac';

export interface AnalysisSettings {
  readonly kind: AnalysisKind;
  readonly outputs: readonly Signal[];
  readonly dc?: DcSweepSettings;
  readonly tran?: TransientSettings;
  readonly ac?: AcSettings;
  readonly stepping?: Stepping;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;

function readSignal(v: unknown): Signal | null {
  if (!isRecord(v) || (v.kind !== 'v' && v.kind !== 'i' && v.kind !== 'p') || !text(v.part)) return null;
  return { kind: v.kind, part: v.part, ...(finite(v.terminal) && v.terminal >= 0 && v.terminal < 200 ? { terminal: Math.round(v.terminal) } : {}) };
}

/** Reads saved analysis settings, keeping what is valid. */
export function readAnalysis(v: unknown): AnalysisSettings | null {
  if (!isRecord(v) || (v.kind !== 'op' && v.kind !== 'dc' && v.kind !== 'tran' && v.kind !== 'ac')) return null;
  const outputs = Array.isArray(v.outputs)
    ? v.outputs
        .map(readSignal)
        .filter((s): s is Signal => s !== null)
        .slice(0, 24)
    : [];
  const out: { -readonly [K in keyof AnalysisSettings]: AnalysisSettings[K] } = { kind: v.kind, outputs };
  const dc = v.dc;
  if (isRecord(dc) && text(dc.part) && text(dc.prop) && finite(dc.from) && finite(dc.to) && finite(dc.points))
    out.dc = { part: dc.part, prop: dc.prop, from: dc.from, to: dc.to, points: Math.max(2, Math.min(10_000, Math.round(dc.points))), ...(dc.log === true ? { log: true } : {}) };
  const tran = v.tran;
  if (isRecord(tran) && finite(tran.stop) && tran.stop > 0 && finite(tran.step) && tran.step >= 0)
    out.tran = { stop: tran.stop, step: tran.step, ...(tran.fromZero === true ? { fromZero: true } : {}) };
  const ac = v.ac;
  if (isRecord(ac) && text(ac.source) && finite(ac.from) && ac.from > 0 && finite(ac.to) && ac.to > 0 && finite(ac.perDecade))
    out.ac = { source: ac.source, from: ac.from, to: ac.to, perDecade: Math.max(1, Math.min(1000, Math.round(ac.perDecade))) };
  const stepping = v.stepping;
  if (isRecord(stepping) && text(stepping.part) && text(stepping.prop) && Array.isArray(stepping.values)) {
    const values = stepping.values.filter(finite).slice(0, 20);
    if (values.length) out.stepping = { part: stepping.part, prop: stepping.prop, values };
  }
  return out;
}
