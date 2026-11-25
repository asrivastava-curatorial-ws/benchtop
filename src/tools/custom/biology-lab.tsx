/**
 * Biology lab: population growth (exponential, logistic, harvested),
 * predator and prey cycles, epidemics with vaccination, enzyme kinetics with
 * inhibitors and Lineweaver–Burk plots, a Hodgkin–Huxley neuron, and
 * diffusion and osmosis across a membrane.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { enzyme, epidemic, exponential, finalSize, type Inhibition, integrate, lineweaverBurk, logistic, lotkaVolterra, neuron, osmoticPressure, stimulusAt } from '../../lib/biology';
import { defineCustomTool, type Values } from '../types';
import { fmt, LAB_COLORS, LabTabs, mergeStored, NumberBox, Plot, Readouts, Slider, useClock } from './_lab';
import { Segmented, usePersistentState } from './_shared';

type Tab = 'growth' | 'predator' | 'epidemic' | 'enzyme' | 'neuron' | 'diffusion';
const TABS: readonly { readonly value: Tab; readonly label: string }[] = [
  { value: 'growth', label: 'Population growth' },
  { value: 'predator', label: 'Predator and prey' },
  { value: 'epidemic', label: 'Epidemics' },
  { value: 'enzyme', label: 'Enzymes' },
  { value: 'neuron', label: 'Neuron' },
  { value: 'diffusion', label: 'Diffusion and osmosis' },
];

const DEFAULTS = {
  tab: 'growth' as Tab,
  growth: { n0: 10, r: 0.5, k: 1000, years: 30, harvest: 0 },
  predator: { alpha: 1, beta: 0.1, delta: 0.075, gamma: 1.5, x0: 10, y0: 5, k: 0, years: 40 },
  epidemic: { seir: false, population: 1000000, r0: 2.5, infectious: 7, latent: 5, vaccinated: 0, seed: 10, days: 365 },
  enzyme: { vmax: 10, km: 5, mode: 'competitive' as Inhibition, i: 5, ki: 2, data: '1 1.8\n2 3.1\n5 5.2\n10 6.6\n20 8.1\n40 8.9' },
  neuron: { current: 10, start: 5, width: 40, every: 0, duration: 60, gates: false },
  diffusion: { left: 160, right: 20, open: 40, cLeft: 0.3, cRight: 0.1, factor: 1, celsius: 25 },
};
type State = typeof DEFAULTS;
type Part<K extends keyof State> = { s: State[K]; set: (patch: Partial<State[K]>) => void };

const read = (v: Values | undefined): State => {
  const s = mergeStored(DEFAULTS, v);
  const tab = TABS.find((t) => t.value === s.tab)?.value ?? 'growth';
  const mode = (['none', 'competitive', 'noncompetitive', 'uncompetitive'] as const).find((m) => m === s.enzyme.mode) ?? 'competitive';
  return { ...s, tab, enzyme: { ...s.enzyme, mode } };
};
const write = (s: State): Values => JSON.parse(JSON.stringify(s)) as Values;

const series = (t: readonly number[], v: readonly number[]) => t.map((x, i) => [x, v[i] ?? Number.NaN] as const);

/* ------------------------------------------------------------- growth -- */

function GrowthLab({ s, set }: Part<'growth'>) {
  const n = 300;
  const t = Array.from({ length: n + 1 }, (_, i) => (i / n) * s.years);
  const logi = t.map((x) => logistic(s.n0, s.r, s.k, x, s.harvest));
  const expo = t.map((x) => exponential(s.n0, s.r, x));
  const rr = s.r - s.harvest;
  const ceiling = rr > 0 ? s.k * (1 - s.harvest / s.r) : 0;
  const half = rr > 0 && s.n0 < ceiling / 2 ? Math.log((ceiling - s.n0) / s.n0) / rr : Number.NaN;
  const rate = Array.from({ length: 201 }, (_, i) => {
    const N = (i / 200) * s.k * 1.05;
    return [N, s.r * N * (1 - N / s.k) - s.harvest * N] as const;
  });
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Starting number" value={s.n0} min={1} max={1000} step={1} onChange={(n0) => set({ n0 })} />
        <Slider label="Growth rate r" value={s.r} min={0.01} max={3} step={0.01} unit="/yr" onChange={(r) => set({ r, harvest: Math.min(s.harvest, r * 1.5) })} test="gr-r" />
        <Slider label="Carrying capacity K" value={s.k} min={10} max={100000} step={10} onChange={(k) => set({ k })} />
        <Slider label="Harvest" value={s.harvest} min={0} max={3} step={0.01} unit="/yr" onChange={(harvest) => set({ harvest })} test="gr-harvest" />
        <Slider label="Years shown" value={s.years} min={1} max={200} step={1} onChange={(years) => set({ years })} />
        <p class="lab-note">Harvest takes that fraction of the population each year. Taking r ÷ 2 keeps the population at K ÷ 2, where it grows fastest: the maximum sustainable yield.</p>
      </div>
      <div class="lab-stage">
        <div class="lab-plots">
          <Plot
            title="Population over time"
            test="gr-plot"
            series={[
              { name: 'logistic', points: series(t, logi) },
              { name: 'exponential', points: series(t, expo), dashed: true },
            ]}
            xLabel="years"
            yLabel="population"
            xRange={[0, s.years]}
            yRange={[0, Math.max(s.k, ...logi) * 1.15]}
          />
          <Plot
            title="Growth rate against population"
            series={[{ name: 'growth per year', points: rate }]}
            xLabel="population"
            yLabel="per year"
            points={ceiling > 0 ? [{ x: ceiling, y: 0, label: 'settles', live: true }] : []}
          />
        </div>
        <Readouts
          test="gr-results"
          items={[
            ['Doubling time while small', `${fmt(Math.LN2 / Math.max(rr, 1e-9), 4)} years`],
            ['Settles at', rr > 0 ? fmt(ceiling, 5) : 'zero: the harvest is faster than it can grow'],
            ['Reaches half of that after', Number.isFinite(half) ? `${fmt(half, 4)} years` : '—'],
            ['Harvest each year once settled', fmt(s.harvest * ceiling, 4)],
            ['Most it can yield for ever', `${fmt((s.r * s.k) / 4, 4)} a year (harvest r ÷ 2 = ${fmt(s.r / 2, 3)})`],
          ]}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------- predator, prey -- */

function PredatorLab({ s, set }: Part<'predator'>) {
  const p = { alpha: s.alpha, beta: s.beta, delta: s.delta, gamma: s.gamma, k: s.k > 0 ? s.k : Number.POSITIVE_INFINITY };
  const run = useMemo(() => integrate(lotkaVolterra(p), [s.x0, s.y0], s.years, 0.005, 1200), [s.alpha, s.beta, s.delta, s.gamma, s.x0, s.y0, s.k, s.years]);
  const prey = run.y.map((v) => v[0] ?? 0);
  const pred = run.y.map((v) => v[1] ?? 0);
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <h3>Prey (rabbits)</h3>
        <Slider label="Birth rate α" value={s.alpha} min={0.1} max={3} step={0.01} onChange={(alpha) => set({ alpha })} />
        <Slider label="Eaten at rate β" value={s.beta} min={0.005} max={0.5} step={0.005} onChange={(beta) => set({ beta })} />
        <Slider label="Starting number" value={s.x0} min={1} max={200} step={1} onChange={(x0) => set({ x0 })} test="pp-x0" />
        <Slider label="Carrying capacity (0: none)" value={s.k} min={0} max={500} step={5} onChange={(k) => set({ k })} />
        <h3>Predators (foxes)</h3>
        <Slider label="Gain per prey δ" value={s.delta} min={0.005} max={0.5} step={0.005} onChange={(delta) => set({ delta })} />
        <Slider label="Death rate γ" value={s.gamma} min={0.1} max={3} step={0.01} onChange={(gamma) => set({ gamma })} />
        <Slider label="Starting number" value={s.y0} min={1} max={100} step={1} onChange={(y0) => set({ y0 })} />
        <Slider label="Years" value={s.years} min={5} max={200} step={1} onChange={(years) => set({ years })} />
      </div>
      <div class="lab-stage">
        <div class="lab-plots">
          <Plot
            title="Numbers over time"
            test="pp-plot"
            series={[
              { name: 'prey', points: series(run.t, prey) },
              { name: 'predators', points: series(run.t, pred) },
            ]}
            xLabel="years"
            yLabel="number"
            xRange={[0, s.years]}
          />
          <Plot
            title="Predators against prey (each loop is one cycle)"
            series={[{ name: 'cycle', points: prey.map((x, i) => [x, pred[i] ?? 0] as const) }]}
            xLabel="prey"
            yLabel="predators"
            points={[{ x: s.gamma / s.delta, y: (s.alpha / s.beta) * (s.k > 0 ? 1 - s.gamma / s.delta / s.k : 1), label: 'balance' }]}
          />
        </div>
        <Readouts
          test="pp-results"
          items={[
            ['Balance point', `${fmt(s.gamma / s.delta, 4)} prey, ${fmt((s.alpha / s.beta) * (s.k > 0 ? 1 - s.gamma / s.delta / s.k : 1), 4)} predators`],
            ['Cycle length (small swings)', `${fmt((2 * Math.PI) / Math.sqrt(s.alpha * s.gamma), 4)} years`],
            ['Prey range', `${fmt(Math.min(...prey), 3)} to ${fmt(Math.max(...prey), 4)}`],
            ['Predator range', `${fmt(Math.min(...pred), 3)} to ${fmt(Math.max(...pred), 4)}`],
          ]}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ epidemics -- */

function EpidemicLab({ s, set }: Part<'epidemic'>) {
  const run = useMemo(
    () => epidemic({ population: s.population, r0: s.r0, infectious: s.infectious, latent: s.seir ? s.latent : 0, vaccinated: s.vaccinated / 100, seed: s.seed, days: s.days }),
    [s.population, s.r0, s.infectious, s.latent, s.seir, s.vaccinated, s.seed, s.days],
  );
  const pct = (v: readonly number[]) =>
    series(
      run.t,
      v.map((x) => (100 * x) / s.population),
    );
  const herd = s.r0 > 1 ? 1 - 1 / s.r0 : 0;
  const reff = s.r0 * (1 - s.vaccinated / 100);
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Segmented
          label="Model"
          value={s.seir ? 'seir' : 'sir'}
          choices={[
            { value: 'sir', label: 'SIR' },
            { value: 'seir', label: 'SEIR (with incubation)' },
          ]}
          onChange={(v) => set({ seir: v === 'seir' })}
        />
        <div class="ms-field">
          People
          <NumberBox value={s.population} min={100} max={1e10} step={1} label="Population" onChange={(population) => set({ population })} />
          <span />
        </div>
        <Slider label="R₀" value={s.r0} min={0.5} max={18} step={0.1} onChange={(r0) => set({ r0 })} test="ep-r0" />
        <Slider label="Infectious for" value={s.infectious} min={1} max={30} step={0.5} unit="days" onChange={(infectious) => set({ infectious })} />
        {s.seir && <Slider label="Incubation" value={s.latent} min={0.5} max={21} step={0.5} unit="days" onChange={(latent) => set({ latent })} />}
        <Slider label="Vaccinated" value={s.vaccinated} min={0} max={100} step={1} unit="%" onChange={(vaccinated) => set({ vaccinated })} test="ep-vacc" />
        <Slider label="Infected at the start" value={s.seed} min={1} max={1000} step={1} onChange={(seed) => set({ seed })} />
        <Slider label="Days shown" value={s.days} min={30} max={1000} step={5} onChange={(days) => set({ days })} />
        <p class="lab-note">A teaching model: everyone mixes evenly, nobody is born or dies, and immunity lasts.</p>
      </div>
      <div class="lab-stage">
        <div class="lab-plots">
          <Plot
            title="Share of the population"
            test="ep-plot"
            series={[
              { name: 'susceptible', points: pct(run.s), color: LAB_COLORS[0] },
              ...(s.seir ? [{ name: 'exposed', points: pct(run.e), color: LAB_COLORS[1] }] : []),
              { name: 'infectious', points: pct(run.i), color: LAB_COLORS[5] },
              { name: 'recovered or immune', points: pct(run.r), color: LAB_COLORS[2] },
            ]}
            xLabel="days"
            yLabel="% of people"
            xRange={[0, s.days]}
            yRange={[0, 100]}
          />
        </div>
        <Readouts
          test="ep-results"
          items={[
            ['Herd immunity threshold 1 − 1/R₀', `${fmt(herd * 100, 4)} %`],
            ['R at the start (after vaccination)', fmt(reff, 4)],
            [
              'Peak',
              run.peak > s.seed + 1e-6 ? `${fmt((100 * run.peak) / s.population, 4)} % infectious at once, on day ${fmt(run.peakDay, 4)}` : 'no outbreak: each case infects fewer than one other',
            ],
            ['Infected in all', `${fmt((100 * run.total) / s.population, 4)} % of people`],
            ['Final-size formula (no vaccination)', `${fmt(finalSize(s.r0) * 100, 4)} %`],
          ]}
        />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- enzymes -- */

const MODE_NAMES: Readonly<Record<Inhibition, string>> = {
  none: 'No inhibitor',
  competitive: 'Competitive (raises Km)',
  noncompetitive: 'Non-competitive (lowers Vmax)',
  uncompetitive: 'Uncompetitive (lowers both)',
};

function EnzymeLab({ s, set }: Part<'enzyme'>) {
  const top = s.km * 10;
  const with_ = enzyme(1, s.vmax, s.km, s.mode, s.i, s.ki);
  const curve = (vmax: number, km: number) => Array.from({ length: 201 }, (_, k) => [(k / 200) * top, (vmax * ((k / 200) * top)) / (km + (k / 200) * top)] as const);
  const data = s.data
    .split('\n')
    .map((line) =>
      line
        .trim()
        .split(/[\s,;]+/)
        .map(Number),
    )
    .filter((p): p is [number, number] => p.length >= 2 && p.every((x) => Number.isFinite(x)) && (p[0] ?? 0) > 0 && (p[1] ?? 0) > 0)
    .map(([a, b]) => [a, b] as const);
  const fit = lineweaverBurk(data);
  const lbLine = (vmax: number, km: number) => {
    const x0 = -1.2 / Math.min(km, s.km, fit?.km ?? km);
    const x1 = Math.max(2 / km, ...data.map((p) => 1 / p[0]));
    return [
      [x0, (km / vmax) * x0 + 1 / vmax],
      [x1, (km / vmax) * x1 + 1 / vmax],
    ] as const;
  };
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Vmax" value={s.vmax} min={0.1} max={100} step={0.1} onChange={(vmax) => set({ vmax })} />
        <Slider label="Km" value={s.km} min={0.1} max={100} step={0.1} unit="mM" onChange={(km) => set({ km })} />
        <h3>Inhibitor</h3>
        <select class="input" aria-label="Inhibitor" value={s.mode} onChange={(e) => set({ mode: e.currentTarget.value as Inhibition })} data-testid="en-mode">
          {(Object.keys(MODE_NAMES) as Inhibition[]).map((m) => (
            <option key={m} value={m}>
              {MODE_NAMES[m]}
            </option>
          ))}
        </select>
        {s.mode !== 'none' && (
          <>
            <Slider label="Inhibitor [I]" value={s.i} min={0} max={50} step={0.1} unit="mM" onChange={(i) => set({ i })} test="en-i" />
            <Slider label="Ki" value={s.ki} min={0.1} max={50} step={0.1} unit="mM" onChange={(ki) => set({ ki })} />
          </>
        )}
        <label class="dna-input">
          Your measurements: [S] and rate, one pair a line
          <textarea class="input" rows={6} value={s.data} onInput={(e) => set({ data: e.currentTarget.value })} spellcheck={false} data-testid="en-data" />
        </label>
      </div>
      <div class="lab-stage">
        <div class="lab-plots">
          <Plot
            title="Rate against substrate (Michaelis–Menten)"
            test="en-plot"
            series={[{ name: 'no inhibitor', points: curve(s.vmax, s.km), dashed: true }, ...(s.mode !== 'none' ? [{ name: 'with inhibitor', points: curve(with_.vmax, with_.km) }] : [])]}
            xLabel="[S] (mM)"
            yLabel="rate"
            xRange={[0, top]}
            points={data.map(([x, y]) => ({ x, y }))}
          />
          <Plot
            title="Lineweaver–Burk: 1/rate against 1/[S]"
            series={[
              { name: 'no inhibitor', points: lbLine(s.vmax, s.km), dashed: true },
              ...(s.mode !== 'none' ? [{ name: 'with inhibitor', points: lbLine(with_.vmax, with_.km) }] : []),
              ...(fit ? [{ name: 'fit to your data', points: lbLine(fit.vmax, fit.km), color: 'var(--muted)' }] : []),
            ]}
            xLabel="1/[S]"
            yLabel="1/rate"
            points={data.map(([x, y]) => ({ x: 1 / x, y: 1 / y }))}
          />
        </div>
        <Readouts
          test="en-results"
          items={[
            ['Apparent Vmax', fmt(with_.vmax, 4)],
            ['Apparent Km', `${fmt(with_.km, 4)} mM`],
            ['Rate at [S] = Km', fmt((with_.vmax * s.km) / (with_.km + s.km), 4)],
            ['Fit to your data', fit ? `Vmax ${fmt(fit.vmax, 4)}, Km ${fmt(fit.km, 4)} mM (r² = ${fmt(fit.r2, 4)})` : 'enter at least two pairs'],
          ]}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- neuron -- */

function NeuronLab({ s, set }: Part<'neuron'>) {
  const stim = { current: s.current, start: s.start, width: s.width, every: s.every };
  const run = useMemo(() => neuron(stim, s.duration), [s.current, s.start, s.width, s.every, s.duration]);
  const rate = run.spikes.length >= 2 ? 1000 / (((run.spikes.at(-1) ?? 0) - (run.spikes[0] ?? 0)) / (run.spikes.length - 1)) : Number.NaN;
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Stimulus current" value={s.current} min={0} max={50} step={0.1} unit="µA/cm²" onChange={(current) => set({ current })} test="nr-current" />
        <Slider label="Starts at" value={s.start} min={0} max={100} step={0.5} unit="ms" onChange={(start) => set({ start })} />
        <Slider label="Pulse length" value={s.width} min={0.1} max={200} step={0.1} unit="ms" onChange={(width) => set({ width })} test="nr-width" />
        <Slider label="Repeat every (0: once)" value={s.every} min={0} max={50} step={0.5} unit="ms" onChange={(every) => set({ every })} />
        <Slider label="Time shown" value={s.duration} min={10} max={300} step={5} unit="ms" onChange={(duration) => set({ duration })} />
        <label class="ms-check">
          <input type="checkbox" checked={s.gates} onChange={(e) => set({ gates: e.currentTarget.checked })} /> Show the ion-channel gates
        </label>
        <p class="lab-note">The Hodgkin–Huxley model of the squid giant axon (1952). Try a brief strong pulse, then a weak one; or a steady current for a train of spikes.</p>
      </div>
      <div class="lab-stage">
        <div class="lab-plots">
          <Plot title="Membrane potential" test="nr-plot" series={[{ name: 'V', points: series(run.t, run.v) }]} xLabel="time (ms)" yLabel="mV" xRange={[0, s.duration]} yRange={[-90, 60]} />
          <Plot
            title="Stimulus"
            series={[
              {
                name: 'current',
                points: series(
                  run.t,
                  run.t.map((t) => stimulusAt(stim, t)),
                ),
                color: LAB_COLORS[1],
              },
            ]}
            xLabel="time (ms)"
            yLabel="µA/cm²"
            xRange={[0, s.duration]}
            height={120}
          />
          {s.gates && (
            <Plot
              title="Gates: m and h open and close sodium channels, n potassium"
              series={[
                { name: 'm', points: series(run.t, run.m) },
                { name: 'h', points: series(run.t, run.h) },
                { name: 'n', points: series(run.t, run.n) },
              ]}
              xLabel="time (ms)"
              yLabel="open fraction"
              xRange={[0, s.duration]}
              yRange={[0, 1]}
            />
          )}
        </div>
        <Readouts
          test="nr-results"
          items={[
            ['Action potentials', String(run.spikes.length)],
            ['Firing rate', Number.isFinite(rate) ? `${fmt(rate, 4)} per second` : '—'],
            ['Highest potential', `${fmt(Math.max(...run.v), 4)} mV`],
            ['Resting potential', '−65 mV'],
          ]}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------- diffusion and osmosis -- */

const BOX_W = 600;
const BOX_H = 280;

function DiffusionLab({ s, set }: Part<'diffusion'>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const parts = useRef<{ x: Float64Array; y: Float64Array } | null>(null);
  const history = useRef<[number, number, number][]>([]);
  const clock = useRef(0);
  const [, tick] = useState(0);
  const [running, setRunning] = useState(true);
  const reset = () => {
    const n = s.left + s.right;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < n; i++) {
      x[i] = i < s.left ? 6 + rand() * (BOX_W / 2 - 14) : BOX_W / 2 + 8 + rand() * (BOX_W / 2 - 14);
      y[i] = 6 + rand() * (BOX_H - 12);
    }
    parts.current = { x, y };
    history.current = [[0, s.left, s.right]];
    clock.current = 0;
    tick((k) => k + 1);
  };
  useEffect(reset, [s.left, s.right]);
  const draw = () => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    const p = parts.current;
    if (!el || !ctx || !p) return;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.fillStyle = '#0072B2';
    for (let i = 0; i < p.x.length; i++) {
      ctx.beginPath();
      ctx.arc(p.x[i] ?? 0, p.y[i] ?? 0, 3.2, 0, 2 * Math.PI);
      ctx.fill();
    }
  };
  useClock(running, (dt) => {
    const p = parts.current;
    if (!p) return;
    const step = 80 * Math.sqrt(Math.min(dt, 0.05));
    const mid = BOX_W / 2;
    for (let i = 0; i < p.x.length; i++) {
      const ox = p.x[i] ?? 0;
      let nx = ox + (Math.random() - 0.5) * 2 * step;
      let ny = (p.y[i] ?? 0) + (Math.random() - 0.5) * 2 * step;
      // The membrane lets a particle through only where there is a pore.
      if ((ox - mid) * (nx - mid) < 0 && Math.random() * 100 >= s.open) nx = ox;
      nx = Math.min(BOX_W - 4, Math.max(4, nx));
      ny = Math.min(BOX_H - 4, Math.max(4, ny));
      p.x[i] = nx;
      p.y[i] = ny;
    }
    clock.current += dt;
    let left = 0;
    for (let i = 0; i < p.x.length; i++) if ((p.x[i] ?? 0) < mid) left++;
    const h = history.current;
    if (!h.length || clock.current - (h[h.length - 1]?.[0] ?? 0) >= 0.25) history.current = [...h.slice(-400), [clock.current, left, p.x.length - left]];
    draw();
    tick((k) => k + 1);
  });
  useEffect(draw);
  const last = history.current[history.current.length - 1] ?? [0, s.left, s.right];
  const kelvin = s.celsius + 273.15;
  const dPi = osmoticPressure(Math.abs(s.cLeft - s.cRight), s.factor, kelvin);
  const height = dPi / (1000 * 9.80665);
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <h3>Diffusion</h3>
        <Slider label="Particles on the left" value={s.left} min={0} max={400} step={1} onChange={(left) => set({ left })} />
        <Slider label="Particles on the right" value={s.right} min={0} max={400} step={1} onChange={(right) => set({ right })} />
        <Slider label="Membrane openness" value={s.open} min={0} max={100} step={1} unit="%" onChange={(open) => set({ open })} test="df-open" />
        <div class="button-row">
          <button type="button" class="button button-primary button-small" onClick={() => setRunning((r) => !r)}>
            {running ? 'Pause' : 'Run'}
          </button>
          <button type="button" class="button button-small" onClick={reset}>
            Start again
          </button>
        </div>
        <h3>Osmosis across a membrane only water crosses</h3>
        <Slider label="Left solution" value={s.cLeft} min={0} max={3} step={0.01} unit="mol/L" onChange={(cLeft) => set({ cLeft })} />
        <Slider label="Right solution" value={s.cRight} min={0} max={3} step={0.01} unit="mol/L" onChange={(cRight) => set({ cRight })} />
        <Segmented
          label="Solute"
          value={String(s.factor) as '1' | '2' | '3'}
          choices={[
            { value: '1', label: 'Sugar (i = 1)' },
            { value: '2', label: 'Salt, NaCl (2)' },
            { value: '3', label: 'CaCl₂ (3)' },
          ]}
          onChange={(v) => set({ factor: Number(v) })}
        />
        <Slider label="Temperature" value={s.celsius} min={0} max={60} step={1} unit="°C" onChange={(celsius) => set({ celsius })} />
      </div>
      <div class="lab-stage">
        <div class="df-box">
          <canvas ref={canvas} width={BOX_W} height={BOX_H} class="df-canvas" data-testid="df-canvas" />
          <div class="df-membrane" style={{ opacity: 0.35 + (0.65 * (100 - s.open)) / 100 }} />
        </div>
        <div class="lab-plots">
          <Plot
            title="Particles on each side"
            test="df-plot"
            series={[
              { name: 'left', points: history.current.map(([t, l]) => [t, l] as const) },
              { name: 'right', points: history.current.map(([t, , r]) => [t, r] as const) },
            ]}
            xLabel="time (s)"
            yLabel="particles"
          />
        </div>
        <Readouts
          test="df-results"
          items={[
            ['Now', `${last[1]} on the left, ${last[2]} on the right`],
            ['Evens out at', `${fmt((s.left + s.right) / 2, 4)} each side`],
            ['Osmotic pressure difference (π = iMRT)', `${fmt(dPi / 1000, 4)} kPa`],
            ['Water column it can hold up', `${fmt(height, 4)} m`],
            ['Water moves', s.cLeft === s.cRight ? 'both ways equally (isotonic)' : `into the ${s.cLeft > s.cRight ? 'left' : 'right'} side, where the solution is stronger`],
          ]}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tool -- */

function BiologyLab({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const part =
    <K extends Exclude<keyof State, 'tab'>>(key: K) =>
    (patch: Partial<State[K]>) =>
      setState((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  return (
    <section class="tool lab-tool" data-testid="tool" data-state="done">
      <LabTabs label="Topic" value={s.tab} choices={TABS} onChange={(tab) => setState((p) => ({ ...p, tab }))} />
      {s.tab === 'growth' && <GrowthLab s={s.growth} set={part('growth')} />}
      {s.tab === 'predator' && <PredatorLab s={s.predator} set={part('predator')} />}
      {s.tab === 'epidemic' && <EpidemicLab s={s.epidemic} set={part('epidemic')} />}
      {s.tab === 'enzyme' && <EnzymeLab s={s.enzyme} set={part('enzyme')} />}
      {s.tab === 'neuron' && <NeuronLab s={s.neuron} set={part('neuron')} />}
      {s.tab === 'diffusion' && <DiffusionLab s={s.diffusion} set={part('diffusion')} />}
    </section>
  );
}

export default defineCustomTool(BiologyLab);
