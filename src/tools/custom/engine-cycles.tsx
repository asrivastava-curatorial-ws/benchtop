/**
 * Engine and power cycles: Otto, Diesel, dual, Brayton (with real
 * compressor, turbine and regenerator), Carnot, Stirling and the Rankine
 * steam cycle.  States, work and heat of each process, efficiency, mean
 * effective pressure and power, with P–v and T–s diagrams that animate.
 */
import { useMemo, useState } from 'preact/hooks';
import { type CycleInputs, type CycleKind, type CycleResult, type CycleState, runCycle, steamDome } from '../../lib/cycles';
import { saveFile } from '../../platform';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { csv, fmt, LAB_COLORS, Plot, Readouts, type Series, Slider, useClock } from './_lab';
import { Segmented, usePersistentState } from './_shared';

const KINDS: readonly { value: CycleKind; label: string; blurb: string }[] = [
  { value: 'otto', label: 'Otto', blurb: 'Petrol (spark-ignition) engines: heat added at constant volume.' },
  { value: 'diesel', label: 'Diesel', blurb: 'Compression-ignition engines: heat added at constant pressure.' },
  { value: 'dual', label: 'Dual', blurb: 'Fast diesel engines: part of the heat at constant volume, the rest at constant pressure.' },
  { value: 'brayton', label: 'Brayton', blurb: 'Gas turbines and jet engines: compressor, combustion chamber, turbine.' },
  { value: 'carnot', label: 'Carnot', blurb: 'The ideal limit: two isotherms and two adiabats.' },
  { value: 'stirling', label: 'Stirling', blurb: 'Hot-air engines: two isotherms and two constant-volume steps with a regenerator.' },
  { value: 'rankine', label: 'Rankine', blurb: 'Steam power plants: feed pump, boiler, turbine, condenser (IAPWS-IF97 water).' },
];
const PISTON: ReadonlySet<CycleKind> = new Set(['otto', 'diesel', 'dual', 'carnot', 'stirling']);

interface EState extends Omit<CycleInputs, 'p1' | 'T1' | 'qIn' | 'Tmax' | 'pBoiler' | 'pCondenser' | 'Tsteam'> {
  readonly kind: CycleKind;
  /** Shown units: kPa, °C, kJ/kg, MPa */
  readonly p1k: number;
  readonly t1c: number;
  readonly qInK: number;
  readonly tMaxC: number;
  readonly pBoilerM: number;
  readonly pCondK: number;
  readonly tSteamC: number;
  readonly litres: number;
  readonly rpm: number;
  readonly strokes: 2 | 4;
  readonly flow: number;
}

const DEFAULTS: EState = {
  kind: 'otto',
  gamma: 1.4,
  R: 287,
  p1k: 100,
  t1c: 27,
  r: 9,
  qInK: 1800,
  rc: 2,
  rp: 1.5,
  pr: 12,
  tMaxC: 1100,
  etaC: 0.86,
  etaT: 0.89,
  etaP: 0.85,
  regen: 0,
  pBoilerM: 10,
  pCondK: 10,
  tSteamC: 540,
  litres: 1.5,
  rpm: 3000,
  strokes: 4,
  flow: 20,
};

const read = (v: Values | undefined): EState => {
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const stored = v?.[key];
    if (typeof value === 'number' && typeof stored === 'number' && Number.isFinite(stored)) out[key] = stored;
  }
  if (KINDS.some((k) => k.value === v?.kind)) out.kind = v?.kind;
  if (v?.strokes === 2) out.strokes = 2;
  return out as unknown as EState;
};
const write = (s: EState): Values => ({ ...s });

const inputs = (s: EState): CycleInputs => ({
  gamma: s.gamma,
  R: s.R,
  p1: s.p1k * 1000,
  T1: s.t1c + 273.15,
  r: s.r,
  qIn: s.qInK * 1000,
  rc: s.rc,
  rp: s.rp,
  pr: s.pr,
  Tmax: s.tMaxC + 273.15,
  etaC: s.etaC,
  etaT: s.etaT,
  etaP: s.etaP,
  regen: s.regen,
  pBoiler: s.pBoilerM * 1e6,
  pCondenser: s.pCondK * 1000,
  Tsteam: s.tSteamC + 273.15,
});

function Piston({ v, vMin, vMax }: { v: number; vMin: number; vMax: number }) {
  // The piston sits at the top at the smallest volume; the clearance volume is the gap above it.
  const H = 150;
  const top = 18;
  const bore = 70;
  const height = 110 * (v / vMax);
  const crown = top + height;
  return (
    <svg class="lab-scene ec-piston" viewBox={`0 0 140 ${H + 30}`} role="img" aria-label="Cylinder and piston">
      <rect class="ec-gas" x={35} y={top} width={bore} height={height} />
      <path class="ec-wall" d={`M35 ${top - 6}V${top + 125}M${35 + bore} ${top - 6}V${top + 125}M30 ${top}H${40 + bore}`} />
      <rect class="ec-crown" x={37} y={crown} width={bore - 4} height={22} rx={2} />
      <line class="ec-rod" x1={70} y1={crown + 22} x2={70} y2={H + 24} />
      <text class="lab-tick" x={70} y={H + 28} text-anchor="middle">
        {v <= vMin * 1.02 ? 'top dead centre' : ''}
      </text>
    </svg>
  );
}

function EngineCycles({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const set = (patch: Partial<EState>) => setState((p) => ({ ...p, ...patch }));
  const [running, setRunning] = useState(true);
  const [phase, setPhase] = useState(0);
  useClock(running, (dt) => setPhase((p) => (p + dt / 4) % 1));

  const result = useMemo((): CycleResult | { error: string } => {
    try {
      return runCycle(s.kind, inputs(s));
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [s]);
  const dome = useMemo(() => (s.kind === 'rankine' ? steamDome() : null), [s.kind]);
  const info = KINDS.find((k) => k.value === s.kind);
  const piston = PISTON.has(s.kind);
  const gasCycle = s.kind !== 'rankine';

  if ('error' in result)
    return (
      <section class="tool lab-tool" data-testid="tool" data-state="error">
        <p class="recipe-error">{result.error}</p>
      </section>
    );

  const path = result.processes.flatMap((p) => p.path);
  const at = path[Math.min(path.length - 1, Math.floor(phase * path.length))];
  const vs = result.states.map((x) => x.v);
  const vMin = Math.min(...vs);
  const vMax = Math.max(...vs);
  const processSeries = (x: (pt: readonly [number, number, number, number]) => number, y: (pt: readonly [number, number, number, number]) => number): Series[] =>
    result.processes.map((p, i) => ({ name: p.label, points: p.path.map((pt) => [x(pt), y(pt)] as const), color: LAB_COLORS[i % LAB_COLORS.length] }));
  const pv = processSeries(
    (pt) => pt[0],
    (pt) => pt[1] / 1000,
  );
  const ts = processSeries(
    (pt) => pt[3] / 1000,
    (pt) => pt[2],
  );
  const domeSeries: Series[] = dome
    ? [
        { name: 'Saturated liquid', points: dome.liquid.map(([x, y]) => [x / 1000, y] as const), color: '#888888', dashed: true },
        { name: 'Saturated vapour', points: dome.vapour.map(([x, y]) => [x / 1000, y] as const), color: '#888888', dashed: true },
      ]
    : [];
  const stateDots = (x: (st: CycleState) => number, y: (st: CycleState) => number) => result.states.map((st) => ({ x: x(st), y: y(st), label: st.name }));

  // Mass per cycle from the swept volume, for engine power.
  const swept = s.litres / 1000;
  const v1 = result.states[0]?.v ?? 1;
  const massPerCycle = piston ? swept / (v1 - vMin) : 0;
  const cyclesPerSecond = (s.rpm / 60) * (s.strokes === 4 ? 0.5 : 1);
  const power = piston ? result.wNet * massPerCycle * cyclesPerSecond : result.wNet * s.flow;
  const pMax = Math.max(...result.states.map((x) => x.p));
  const tMax = Math.max(...result.states.map((x) => x.T));

  const exportCsv = () =>
    attempt(async () => {
      const text = csv(
        ['state', 'p (kPa)', 'v (m3/kg)', 'T (K)', 's (kJ/kg K)', ...(s.kind === 'rankine' ? ['h (kJ/kg)', 'quality'] : [])],
        result.states.map((st) => [st.name, st.p / 1000, st.v, st.T, st.s / 1000, ...(s.kind === 'rankine' ? [(st.h ?? 0) / 1000, st.x ?? ''] : [])]),
      );
      const out = await saveFile(`${s.kind}-cycle.csv`, text, 'text/csv');
      if (out.saved) notify(`Saved to ${out.location}`);
    });

  return (
    <section class="tool lab-tool" data-testid="tool" data-state="done">
      <Segmented label="Cycle" value={s.kind} choices={KINDS} onChange={(kind) => set({ kind })} small={false} />
      <p class="lab-note">{info?.blurb}</p>
      <div class="lab-layout">
        <div class="lab-controls">
          {gasCycle && (
            <>
              <h3>Working gas</h3>
              <Slider label="γ (cp/cv)" value={s.gamma} min={1.1} max={1.67} step={0.01} onChange={(gamma) => set({ gamma })} />
              <Slider label="Start pressure" value={s.p1k} min={20} max={500} step={1} unit="kPa" onChange={(p1k) => set({ p1k })} />
              <Slider label={s.kind === 'carnot' || s.kind === 'stirling' ? 'Cold side' : 'Start temperature'} value={s.t1c} min={-40} max={200} step={1} unit="°C" onChange={(t1c) => set({ t1c })} />
            </>
          )}
          <h3>Cycle</h3>
          {(s.kind === 'otto' || s.kind === 'diesel' || s.kind === 'dual') && <Slider label="Compression ratio" value={s.r} min={3} max={25} step={0.1} onChange={(r) => set({ r })} test="ec-r" />}
          {s.kind === 'otto' && <Slider label="Heat added" value={s.qInK} min={200} max={3500} step={10} unit="kJ/kg" onChange={(qInK) => set({ qInK })} />}
          {(s.kind === 'diesel' || s.kind === 'dual') && <Slider label="Cut-off ratio" value={s.rc} min={1} max={4} step={0.01} onChange={(rc) => set({ rc })} />}
          {s.kind === 'dual' && <Slider label="Pressure ratio (constant volume)" value={s.rp} min={1} max={3} step={0.01} onChange={(rp) => set({ rp })} />}
          {s.kind === 'brayton' && (
            <>
              <Slider label="Pressure ratio" value={s.pr} min={2} max={45} step={0.1} onChange={(pr) => set({ pr })} test="ec-pr" />
              <Slider label="Turbine inlet" value={s.tMaxC} min={400} max={1700} step={5} unit="°C" onChange={(tMaxC) => set({ tMaxC })} />
              <Slider label="Compressor efficiency" value={s.etaC * 100} min={50} max={100} step={0.5} unit="%" onChange={(v) => set({ etaC: v / 100 })} />
              <Slider label="Turbine efficiency" value={s.etaT * 100} min={50} max={100} step={0.5} unit="%" onChange={(v) => set({ etaT: v / 100 })} />
              <Slider label="Regenerator" value={s.regen * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set({ regen: v / 100 })} />
            </>
          )}
          {(s.kind === 'carnot' || s.kind === 'stirling') && (
            <>
              <Slider label="Hot side" value={s.tMaxC} min={50} max={1500} step={5} unit="°C" onChange={(tMaxC) => set({ tMaxC })} />
              <Slider label={s.kind === 'carnot' ? 'Isothermal expansion ratio' : 'Compression ratio'} value={s.r} min={1.1} max={8} step={0.1} onChange={(r) => set({ r })} />
            </>
          )}
          {s.kind === 'stirling' && <Slider label="Regenerator" value={s.regen * 100} min={0} max={100} step={1} unit="%" onChange={(v) => set({ regen: v / 100 })} />}
          {s.kind === 'rankine' && (
            <>
              <Slider label="Boiler pressure" value={s.pBoilerM} min={0.5} max={20} step={0.1} unit="MPa" onChange={(pBoilerM) => set({ pBoilerM })} test="ec-boiler" />
              <Slider label="Condenser pressure" value={s.pCondK} min={4} max={100} step={0.5} unit="kPa" onChange={(pCondK) => set({ pCondK })} />
              <Slider label="Steam temperature" value={s.tSteamC} min={150} max={650} step={5} unit="°C" onChange={(tSteamC) => set({ tSteamC })} />
              <Slider label="Turbine efficiency" value={s.etaT * 100} min={50} max={100} step={0.5} unit="%" onChange={(v) => set({ etaT: v / 100 })} />
              <Slider label="Pump efficiency" value={s.etaP * 100} min={50} max={100} step={0.5} unit="%" onChange={(v) => set({ etaP: v / 100 })} />
            </>
          )}
          <h3>{piston ? 'Engine' : 'Plant'}</h3>
          {piston ? (
            <>
              <Slider label="Swept volume" value={s.litres} min={0.05} max={15} step={0.05} unit="L" onChange={(litres) => set({ litres })} />
              <Slider label="Speed" value={s.rpm} min={100} max={8000} step={50} unit="rpm" onChange={(rpm) => set({ rpm })} />
              <Segmented
                label="Strokes per cycle"
                value={String(s.strokes)}
                choices={[
                  { value: '4', label: 'Four-stroke' },
                  { value: '2', label: 'Two-stroke' },
                ]}
                onChange={(v) => set({ strokes: v === '2' ? 2 : 4 })}
              />
            </>
          ) : (
            <Slider label="Mass flow" value={s.flow} min={0.1} max={600} step={0.1} unit="kg/s" onChange={(flow) => set({ flow })} />
          )}
          <div class="button-row">
            <button type="button" class="button button-small" onClick={() => setRunning((r) => !r)}>
              {running ? 'Stop the animation' : 'Animate'}
            </button>
            <button type="button" class="button button-small" onClick={() => void exportCsv()}>
              States as CSV
            </button>
          </div>
        </div>
        <div class="lab-stage">
          <Readouts
            test="ec-results"
            items={[
              ['Thermal efficiency', `${(result.efficiency * 100).toFixed(2)} %`],
              ['Carnot limit', `${(result.carnot * 100).toFixed(2)} %`],
              ['Net work', `${fmt(result.wNet / 1000, 4)} kJ/kg`],
              ['Heat in', `${fmt(result.qIn / 1000, 4)} kJ/kg`],
              ['Heat out', `${fmt(result.qOut / 1000, 4)} kJ/kg`],
              ...(result.mep !== undefined ? ([['Mean effective pressure', `${fmt(result.mep / 1000, 4)} kPa`]] as const) : []),
              ...(result.backWork !== undefined ? ([['Back work ratio', `${(result.backWork * 100).toFixed(1)} %`]] as const) : []),
              ['Highest temperature', `${fmt(tMax, 4)} K (${fmt(tMax - 273.15, 4)} °C)`],
              ['Highest pressure', `${fmt(pMax / 1e6, 4)} MPa`],
              ['Power', `${fmt(power / 1000, 4)} kW`],
            ]}
          />
          {result.notes.map((n) => (
            <p key={n} class="lab-note">
              {n}
            </p>
          ))}
          <div class="ec-diagrams">
            {s.kind !== 'rankine' && (
              <Plot
                title="Pressure–volume"
                test="ec-pv"
                series={pv}
                xLabel="v (m³/kg)"
                yLabel="p (kPa)"
                points={[
                  ...stateDots(
                    (st) => st.v,
                    (st) => st.p / 1000,
                  ),
                  ...(at ? [{ x: at[0], y: at[1] / 1000, live: true }] : []),
                ]}
              />
            )}
            <Plot
              title="Temperature–entropy"
              test="ec-ts"
              series={[...domeSeries, ...ts]}
              xLabel="s (kJ/kg·K)"
              yLabel="T (K)"
              points={[
                ...stateDots(
                  (st) => st.s / 1000,
                  (st) => st.T,
                ),
                ...(at ? [{ x: at[3] / 1000, y: at[2], live: true }] : []),
              ]}
            />
            {piston && at && <Piston v={at[0]} vMin={vMin} vMax={vMax} />}
          </div>
          <table class="lab-table" data-testid="ec-states">
            <thead>
              <tr>
                <th>State</th>
                <th>p (kPa)</th>
                <th>v (m³/kg)</th>
                <th>T (°C)</th>
                <th>s (kJ/kg·K)</th>
                {s.kind === 'rankine' && <th>h (kJ/kg)</th>}
                {s.kind === 'rankine' && <th>Quality</th>}
              </tr>
            </thead>
            <tbody>
              {result.states.map((st) => (
                <tr key={st.name}>
                  <td>{st.name}</td>
                  <td>{fmt(st.p / 1000, 5)}</td>
                  <td>{fmt(st.v, 4)}</td>
                  <td>{fmt(st.T - 273.15, 5)}</td>
                  <td>{fmt(st.s / 1000, 4)}</td>
                  {s.kind === 'rankine' && <td>{fmt((st.h ?? 0) / 1000, 5)}</td>}
                  {s.kind === 'rankine' && <td>{st.x === undefined ? '—' : st.x >= 1 ? 'dry' : st.x.toFixed(3)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <table class="lab-table">
            <thead>
              <tr>
                <th>Process</th>
                <th>States</th>
                <th>Heat in (kJ/kg)</th>
                <th>Work out (kJ/kg)</th>
              </tr>
            </thead>
            <tbody>
              {result.processes.map((p) => (
                <tr key={p.label}>
                  <td>{p.label}</td>
                  <td>
                    {result.states[p.from]?.name} → {result.states[p.to]?.name}
                  </td>
                  <td>{fmt(p.heat / 1000, 4)}</td>
                  <td>{fmt(p.work / 1000, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(EngineCycles);
