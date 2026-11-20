/**
 * Beam calculator: any span on pinned, roller and fixed supports with point
 * loads, uniform and varying loads and moments; reactions, shear, moment,
 * deflection and bending stress, with diagrams.
 */
import { useMemo } from 'preact/hooks';
import { analyseBeam, type BeamResult, type Load, type Support, type SupportKind } from '../../lib/beam/beam';
import { SHAPES, type ShapeId } from '../../lib/beam/sections';
import { copyText } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { figure, readNumber, SECTION_MATERIALS, sectionFromInputs } from './_sections';
import { usePersistentState } from './_shared';

type LoadKind = 'point' | 'udl' | 'varying' | 'moment';

interface SupportRow {
  readonly kind: SupportKind;
  readonly x: string;
}

interface LoadRow {
  readonly kind: LoadKind;
  readonly x: string;
  readonly x2: string;
  readonly w: string;
  readonly w2: string;
}

type SectionMode = 'manual' | ShapeId;

interface Saved {
  readonly length: string;
  readonly supports: readonly SupportRow[];
  readonly loads: readonly LoadRow[];
  readonly material: string;
  /** GPa */
  readonly E: string;
  readonly section: SectionMode;
  /** Manual section: I in cm⁴ and the smaller elastic modulus in cm³. */
  readonly I: string;
  readonly S: string;
  readonly dims: Readonly<Record<string, string>>;
  readonly selfWeight: boolean;
}

const PRESETS: readonly { readonly id: string; readonly name: string; readonly make: (L: number) => SupportRow[] }[] = [
  { id: 'simple', name: 'Simply supported', make: (L) => [pin(0), roller(L)] },
  { id: 'cantilever', name: 'Cantilever (fixed at the left)', make: () => [{ kind: 'fixed', x: '0' }] },
  { id: 'cantilever-right', name: 'Cantilever (fixed at the right)', make: (L) => [{ kind: 'fixed', x: String(L) }] },
  {
    id: 'fixed',
    name: 'Fixed at both ends',
    make: (L) => [
      { kind: 'fixed', x: '0' },
      { kind: 'fixed', x: String(L) },
    ],
  },
  { id: 'propped', name: 'Propped cantilever', make: (L) => [{ kind: 'fixed', x: '0' }, roller(L)] },
  { id: 'overhang', name: 'Overhang at both ends', make: (L) => [pin(round(L * 0.15)), roller(round(L * 0.85))] },
  { id: 'two-span', name: 'Continuous, two equal spans', make: (L) => [pin(0), roller(round(L / 2)), roller(L)] },
  { id: 'three-span', name: 'Continuous, three equal spans', make: (L) => [pin(0), roller(round(L / 3)), roller(round((2 * L) / 3)), roller(L)] },
];

function pin(x: number): SupportRow {
  return { kind: 'pin', x: String(x) };
}
function roller(x: number): SupportRow {
  return { kind: 'roller', x: String(x) };
}
function round(x: number): number {
  return Number(x.toPrecision(6));
}

const LOAD_KINDS: readonly { readonly value: LoadKind; readonly label: string }[] = [
  { value: 'point', label: 'Point load' },
  { value: 'udl', label: 'Uniform load' },
  { value: 'varying', label: 'Varying load' },
  { value: 'moment', label: 'Moment' },
];

const SUPPORT_KINDS: readonly { readonly value: SupportKind; readonly label: string }[] = [
  { value: 'pin', label: 'Pinned' },
  { value: 'roller', label: 'Roller' },
  { value: 'fixed', label: 'Fixed' },
];

const shapeExamples = (shape: ShapeId) => Object.fromEntries((SHAPES.find((s) => s.id === shape)?.dims ?? []).map((d) => [d.key, String(d.example)]));

const INITIAL: Saved = {
  length: '6',
  supports: [pin(0), roller(6)],
  loads: [
    { kind: 'udl', x: '0', x2: '6', w: '10', w2: '10' },
    { kind: 'point', x: '2', x2: '', w: '20', w2: '' },
  ],
  material: 'steel',
  E: '200',
  section: 'ibeam',
  I: '5066',
  S: '405',
  dims: shapeExamples('ibeam'),
  selfWeight: false,
};

const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value.slice(0, 24) : fallback);

function readSaved(stored: Values | undefined): Saved {
  if (!stored) return INITIAL;
  const supports = Array.isArray(stored.supports)
    ? (stored.supports as unknown[]).slice(0, 12).flatMap((row) => {
        const r = row as Record<string, unknown>;
        const kind = SUPPORT_KINDS.find((k) => k.value === r?.kind)?.value;
        return kind ? [{ kind, x: str(r.x, '0') }] : [];
      })
    : INITIAL.supports;
  const loads = Array.isArray(stored.loads)
    ? (stored.loads as unknown[]).slice(0, 24).flatMap((row) => {
        const r = row as Record<string, unknown>;
        const kind = LOAD_KINDS.find((k) => k.value === r?.kind)?.value;
        return kind ? [{ kind, x: str(r.x, '0'), x2: str(r.x2, ''), w: str(r.w, '0'), w2: str(r.w2, '') }] : [];
      })
    : INITIAL.loads;
  const section: SectionMode = stored.section === 'manual' ? 'manual' : (SHAPES.find((s) => s.id === stored.section)?.id ?? INITIAL.section);
  const dims: Record<string, string> = section === 'manual' ? {} : shapeExamples(section);
  if (stored.dims && typeof stored.dims === 'object')
    for (const [key, value] of Object.entries(stored.dims as Record<string, unknown>)) if (key in dims && typeof value === 'string') dims[key] = value.slice(0, 20);
  return {
    length: str(stored.length, INITIAL.length),
    supports,
    loads,
    material: SECTION_MATERIALS.some((m) => m.id === stored.material) || stored.material === 'custom' ? (stored.material as string) : INITIAL.material,
    E: str(stored.E, INITIAL.E),
    section,
    I: str(stored.I, INITIAL.I),
    S: str(stored.S, INITIAL.S),
    dims,
    selfWeight: stored.selfWeight === true,
  };
}

interface Analysis {
  readonly result: BeamResult;
  readonly length: number;
  readonly supports: readonly Support[];
  readonly loads: readonly Load[];
  /** m⁴ and m³ (S is the smaller of the two fibres); null when not known. */
  readonly I: number;
  readonly S: number | null;
  readonly selfWeight: number;
}

function analyse(saved: Saved): Analysis | { readonly error: string } {
  const L = readNumber(saved.length);
  if (L === null || L <= 0) return { error: 'Type the beam length in metres.' };
  const E = readNumber(saved.E);
  if (E === null || E <= 0) return { error: 'Type the elastic modulus E in GPa.' };
  let I: number;
  let S: number | null = null;
  let mass = 0;
  if (saved.section === 'manual') {
    const i = readNumber(saved.I);
    if (i === null || i <= 0) return { error: 'Type the second moment of area I in cm⁴.' };
    I = i * 1e-8;
    const s = readNumber(saved.S);
    S = s !== null && s > 0 ? s * 1e-6 : null;
  } else {
    const section = sectionFromInputs(saved.section, saved.dims);
    if ('error' in section) return section;
    I = section.Ix * 1e-12;
    S = Math.min(section.SxTop, section.SxBottom) * 1e-9;
    const material = SECTION_MATERIALS.find((m) => m.id === saved.material);
    mass = material ? section.area * 1e-6 * material.density : 0;
  }
  const supports: Support[] = [];
  for (const row of saved.supports) {
    const x = readNumber(row.x);
    if (x === null) return { error: 'Every support needs a position in metres.' };
    supports.push({ kind: row.kind, x });
  }
  const loads: Load[] = [];
  for (const row of saved.loads) {
    const x = readNumber(row.x);
    const w = readNumber(row.w);
    if (x === null || w === null) return { error: 'Every load needs a position and a size.' };
    if (row.kind === 'point') loads.push({ kind: 'point', x, P: w * 1000 });
    else if (row.kind === 'moment') loads.push({ kind: 'moment', x, M: w * 1000 });
    else {
      const x2 = readNumber(row.x2);
      const w2 = row.kind === 'udl' ? w : readNumber(row.w2);
      if (x2 === null || w2 === null) return { error: 'Distributed loads need a start, an end and their sizes.' };
      loads.push({ kind: 'distributed', x1: Math.min(x, x2), x2: Math.max(x, x2), w1: (x <= x2 ? w : w2) * 1000, w2: (x <= x2 ? w2 : w) * 1000 });
    }
  }
  const selfWeight = saved.selfWeight && mass > 0 ? mass * 9.80665 : 0;
  if (selfWeight > 0) loads.push({ kind: 'distributed', x1: 0, x2: L, w1: selfWeight, w2: selfWeight });
  try {
    const result = analyseBeam({ length: L, EI: E * 1e9 * I, supports, loads });
    return { result, length: L, supports, loads, I, S, selfWeight };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const kN = (newtons: number, digits = 4) => figure(newtons / 1000, digits);
const metres = (x: number) => figure(x, 4);

function BeamCalculator({ toolId }: { toolId: string }) {
  const [saved, setSaved] = usePersistentState(toolId, readSaved, (s: Saved): Values => ({ ...s }));
  const analysis = useMemo(() => analyse(saved), [saved]);
  const shape = saved.section === 'manual' ? null : SHAPES.find((s) => s.id === saved.section);

  const setSupport = (i: number, next: Partial<SupportRow>) => setSaved((s) => ({ ...s, supports: s.supports.map((row, j) => (j === i ? { ...row, ...next } : row)) }));
  const setLoad = (i: number, next: Partial<LoadRow>) => setSaved((s) => ({ ...s, loads: s.loads.map((row, j) => (j === i ? { ...row, ...next } : row)) }));
  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    const L = readNumber(saved.length) ?? 6;
    if (preset) setSaved((s) => ({ ...s, supports: preset.make(L) }));
  };

  const ok = !('error' in analysis);
  const summary = ok ? summaryRows(analysis) : [];

  return (
    <section class="tool bm-tool" data-testid="tool" data-state={ok ? 'done' : 'idle'}>
      <div class="bm-grid">
        <div class="bm-inputs">
          <fieldset class="bm-group">
            <legend>Beam</legend>
            <div class="bm-row">
              <label class="control">
                <span class="control-label">Length (m)</span>
                <input class="input bm-num" type="text" inputMode="decimal" value={saved.length} onInput={(e) => setSaved((s) => ({ ...s, length: e.currentTarget.value }))} data-testid="bm-length" />
              </label>
              <label class="control bm-grow">
                <span class="control-label">Supports</span>
                <select class="input" value="" onChange={(e) => applyPreset(e.currentTarget.value)} data-testid="bm-preset">
                  <option value="" disabled>
                    Set supports for…
                  </option>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ul class="bm-list" aria-label="Supports">
              {saved.supports.map((row, i) => (
                <li key={`support-${i}`} class="bm-item">
                  <select class="input" aria-label={`Support ${i + 1} type`} value={row.kind} onChange={(e) => setSupport(i, { kind: e.currentTarget.value as SupportKind })}>
                    {SUPPORT_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <label class="bm-inline">
                    <span>at</span>
                    <input
                      class="input bm-num"
                      type="text"
                      inputMode="decimal"
                      aria-label={`Support ${i + 1} position in metres`}
                      value={row.x}
                      onInput={(e) => setSupport(i, { x: e.currentTarget.value })}
                    />
                    <span>m</span>
                  </label>
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={`Remove support ${i + 1}`}
                    title="Remove"
                    onClick={() => setSaved((s) => ({ ...s, supports: s.supports.filter((_, j) => j !== i) }))}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" class="button button-small button-quiet" onClick={() => setSaved((s) => ({ ...s, supports: [...s.supports, roller(readNumber(s.length) ?? 0)] }))}>
              <Icon name="plus" size={14} /> Add support
            </button>
          </fieldset>

          <fieldset class="bm-group">
            <legend>Loads</legend>
            <p class="bm-help">Forces in kN pointing down, distributed loads in kN/m, moments in kN·m clockwise; positions in m from the left end.</p>
            <ul class="bm-list" aria-label="Loads" data-testid="bm-loads">
              {saved.loads.map((row, i) => (
                <li key={`load-${i}`} class="bm-item bm-load">
                  <select
                    class="input"
                    aria-label={`Load ${i + 1} type`}
                    value={row.kind}
                    onChange={(e) => setLoad(i, { kind: e.currentTarget.value as LoadKind, x2: row.x2 || saved.length, w2: row.w2 || row.w })}
                  >
                    {LOAD_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <label class="bm-inline">
                    <span>{row.kind === 'point' || row.kind === 'moment' ? 'at' : 'from'}</span>
                    <input class="input bm-num" type="text" inputMode="decimal" aria-label={`Load ${i + 1} position`} value={row.x} onInput={(e) => setLoad(i, { x: e.currentTarget.value })} />
                  </label>
                  {(row.kind === 'udl' || row.kind === 'varying') && (
                    <label class="bm-inline">
                      <span>to</span>
                      <input class="input bm-num" type="text" inputMode="decimal" aria-label={`Load ${i + 1} end`} value={row.x2} onInput={(e) => setLoad(i, { x2: e.currentTarget.value })} />
                    </label>
                  )}
                  <label class="bm-inline">
                    <span>{row.kind === 'varying' ? 'from' : ''}</span>
                    <input class="input bm-num" type="text" inputMode="decimal" aria-label={`Load ${i + 1} size`} value={row.w} onInput={(e) => setLoad(i, { w: e.currentTarget.value })} />
                  </label>
                  {row.kind === 'varying' && (
                    <label class="bm-inline">
                      <span>to</span>
                      <input
                        class="input bm-num"
                        type="text"
                        inputMode="decimal"
                        aria-label={`Load ${i + 1} size at the end`}
                        value={row.w2}
                        onInput={(e) => setLoad(i, { w2: e.currentTarget.value })}
                      />
                    </label>
                  )}
                  <span class="bm-unit">{row.kind === 'point' ? 'kN' : row.kind === 'moment' ? 'kN·m' : 'kN/m'}</span>
                  <button type="button" class="icon-button" aria-label={`Remove load ${i + 1}`} title="Remove" onClick={() => setSaved((s) => ({ ...s, loads: s.loads.filter((_, j) => j !== i) }))}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <div class="button-row">
              {LOAD_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  class="button button-small button-quiet"
                  onClick={() => setSaved((s) => ({ ...s, loads: [...s.loads, { kind: k.value, x: '0', x2: s.length, w: k.value === 'moment' ? '5' : '10', w2: k.value === 'varying' ? '0' : '' }] }))}
                >
                  <Icon name="plus" size={14} /> {k.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset class="bm-group">
            <legend>Section and material</legend>
            <div class="bm-row">
              <label class="control bm-grow">
                <span class="control-label">Material</span>
                <select
                  class="input"
                  value={saved.material}
                  onChange={(e) => {
                    const material = SECTION_MATERIALS.find((m) => m.id === e.currentTarget.value);
                    setSaved((s) => ({ ...s, material: e.currentTarget.value, E: material ? String(material.E) : s.E }));
                  }}
                >
                  {SECTION_MATERIALS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                  <option value="custom">Other (type E)</option>
                </select>
              </label>
              <label class="control">
                <span class="control-label">E (GPa)</span>
                <input
                  class="input bm-num"
                  type="text"
                  inputMode="decimal"
                  value={saved.E}
                  onInput={(e) => setSaved((s) => ({ ...s, E: e.currentTarget.value, material: 'custom' }))}
                  data-testid="bm-E"
                />
              </label>
            </div>
            <label class="control">
              <span class="control-label">Section</span>
              <select
                class="input"
                value={saved.section}
                onChange={(e) => {
                  const section = e.currentTarget.value as SectionMode;
                  setSaved((s) => ({ ...s, section, dims: section === 'manual' ? s.dims : shapeExamples(section) }));
                }}
                data-testid="bm-section"
              >
                <option value="manual">Type I and the section modulus</option>
                {SHAPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div class="bm-row bm-wrap">
              {shape
                ? shape.dims.map((dim) => (
                    <label class="control" key={dim.key}>
                      <span class="control-label">{dim.label} (mm)</span>
                      <input
                        class="input bm-num"
                        type="text"
                        inputMode="decimal"
                        value={saved.dims[dim.key] ?? ''}
                        onInput={(e) => setSaved((s) => ({ ...s, dims: { ...s.dims, [dim.key]: e.currentTarget.value } }))}
                      />
                    </label>
                  ))
                : [
                    <label class="control" key="I">
                      <span class="control-label">I (cm⁴)</span>
                      <input class="input bm-num" type="text" inputMode="decimal" value={saved.I} onInput={(e) => setSaved((s) => ({ ...s, I: e.currentTarget.value }))} data-testid="bm-I" />
                    </label>,
                    <label class="control" key="S">
                      <span class="control-label">Section modulus (cm³, optional)</span>
                      <input class="input bm-num" type="text" inputMode="decimal" value={saved.S} onInput={(e) => setSaved((s) => ({ ...s, S: e.currentTarget.value }))} />
                    </label>,
                  ]}
            </div>
            {shape && (
              <label class="toggle">
                <input type="checkbox" checked={saved.selfWeight} onChange={(e) => setSaved((s) => ({ ...s, selfWeight: e.currentTarget.checked }))} data-testid="bm-self-weight" />
                <span class="toggle-track" aria-hidden="true" />
                Add the beam’s own weight
              </label>
            )}
          </fieldset>
        </div>

        <div class="bm-output">
          {!ok ? (
            <p class="st-error" role="status" data-testid="bm-error">
              <Icon name="alert" size={16} /> {analysis.error}
            </p>
          ) : (
            <>
              <BeamDiagrams analysis={analysis} />
              <div class="st-result-head">
                <h2>Results</h2>
                <button
                  type="button"
                  class="button button-small"
                  onClick={() =>
                    attempt(async () => {
                      await copyText(summary.map((r) => `${r.label}\t${r.value}`).join('\n'));
                      notify('Copied the results');
                    })
                  }
                >
                  <Icon name="copy" size={14} /> Copy
                </button>
              </div>
              <div class="ref-table-wrap" {...scrollRegion('Beam results')}>
                <table class="ref-table bm-table" data-testid="bm-results">
                  <tbody>
                    {summary.map((row) => (
                      <tr key={row.label}>
                        <th scope="row">{row.label}</th>
                        <td class="st-num">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p class="st-note">
                Linear elastic Euler–Bernoulli beam, no shear deformation. Check deflection against your code’s limit (often span/250 to span/360) and the stress against the material’s allowable or
                design strength.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function summaryRows(a: Analysis): { label: string; value: string }[] {
  const { result } = a;
  const rows = a.supports.length
    ? result.reactions.map((r, i) => ({
        label: `Reaction ${i + 1} (${r.kind === 'fixed' ? 'fixed' : r.kind === 'pin' ? 'pinned' : 'roller'} at ${metres(r.x)} m)`,
        value: `${kN(r.force)} kN up${r.kind === 'fixed' ? `, ${kN(Math.abs(r.moment))} kN·m ${r.moment >= 0 ? 'anticlockwise' : 'clockwise'}` : ''}`,
      }))
    : [];
  // Moments within rounding noise of zero count as none.
  const noise = 1e-7 * Math.max(Math.abs(result.maxMoment.value), Math.abs(result.minMoment.value), 1e-9);
  rows.push(
    { label: 'Largest shear force', value: `${kN(Math.abs(result.maxShear.value))} kN at ${metres(result.maxShear.x)} m` },
    { label: 'Largest sagging moment', value: result.maxMoment.value > noise ? `${kN(result.maxMoment.value)} kN·m at ${metres(result.maxMoment.x)} m` : 'none' },
    { label: 'Largest hogging moment', value: result.minMoment.value < -noise ? `${kN(-result.minMoment.value)} kN·m at ${metres(result.minMoment.x)} m` : 'none' },
    {
      label: 'Largest deflection',
      value: `${figure(Math.abs(result.maxDeflection.value) * 1000, 4)} mm ${result.maxDeflection.value <= 0 ? 'down' : 'up'} at ${metres(result.maxDeflection.x)} m (length/${figure(a.length / Math.max(Math.abs(result.maxDeflection.value), 1e-15), 3)})`,
    },
  );
  if (a.S !== null) {
    const moment = Math.max(Math.abs(result.maxMoment.value), Math.abs(result.minMoment.value));
    rows.push({ label: 'Largest bending stress (M / S)', value: `${figure(moment / a.S / 1e6, 4)} MPa` });
  }
  rows.push({ label: 'Second moment of area used', value: `${figure(a.I * 1e8, 5)} cm⁴` });
  if (a.selfWeight > 0) rows.push({ label: 'Own weight included', value: `${figure(a.selfWeight / 1000, 4)} kN/m` });
  return rows;
}

/* ------------------------------------------------------------- diagrams -- */

const WIDTH = 640;
const MARGIN = 56;

function BeamDiagrams({ analysis }: { analysis: Analysis }) {
  const { result, length } = analysis;
  const px = (x: number) => MARGIN + ((WIDTH - 2 * MARGIN) * x) / length;
  return (
    <div class="bm-diagrams" data-testid="bm-diagrams">
      <BeamSketch analysis={analysis} px={px} />
      <Plot title="Shear force" unit="kN" xs={result.x} values={result.shear.map((v) => v / 1000)} px={px} tone="shear" />
      <Plot title="Bending moment" unit="kN·m" xs={result.x} values={result.moment.map((v) => v / 1000)} px={px} tone="moment" />
      <Plot title="Deflection" unit="mm" xs={result.x} values={result.deflection.map((v) => v * 1000)} px={px} tone="deflection" />
    </div>
  );
}

function BeamSketch({ analysis, px }: { analysis: Analysis; px: (x: number) => number }) {
  const y = 62;
  const loads = analysis.loads.filter(
    (l) => !(l.kind === 'distributed' && analysis.selfWeight > 0 && l.w1 === analysis.selfWeight && l.w2 === analysis.selfWeight && l.x1 === 0 && l.x2 === analysis.length),
  );
  const peak = Math.max(1, ...loads.map((l) => (l.kind === 'distributed' ? Math.max(Math.abs(l.w1), Math.abs(l.w2)) : 0)));
  return (
    <svg class="bm-svg" viewBox={`0 0 ${WIDTH} 104`} role="img" aria-label="Beam with its supports and loads">
      <line class="bm-beam" x1={px(0)} x2={px(analysis.length)} y1={y} y2={y} />
      {loads.map((load, i) => {
        if (load.kind === 'point') {
          const up = load.P < 0;
          return (
            <g key={`l${i}`} class="bm-load-mark">
              <line x1={px(load.x)} x2={px(load.x)} y1={up ? y + 4 : 14} y2={up ? 46 + y - 14 : y - 4} />
              <path
                d={up ? `M ${px(load.x) - 4} ${y + 10} L ${px(load.x)} ${y + 3} L ${px(load.x) + 4} ${y + 10}` : `M ${px(load.x) - 4} ${y - 10} L ${px(load.x)} ${y - 3} L ${px(load.x) + 4} ${y - 10}`}
              />
              <text x={px(load.x) + 5} y={up ? y + 30 : 16} class="bm-text">
                {kN(Math.abs(load.P), 3)} kN
              </text>
            </g>
          );
        }
        if (load.kind === 'moment') {
          const cx = px(load.x);
          return (
            <g key={`l${i}`} class="bm-load-mark">
              <path d={`M ${cx - 10} ${y - 8} A 12 12 0 1 1 ${cx + 10} ${y - 8}`} fill="none" />
              <path d={load.M >= 0 ? `M ${cx + 6} ${y - 12} L ${cx + 10} ${y - 8} L ${cx + 13} ${y - 13}` : `M ${cx - 6} ${y - 12} L ${cx - 10} ${y - 8} L ${cx - 13} ${y - 13}`} />
              <text x={cx + 14} y={y - 22} class="bm-text">
                {kN(Math.abs(load.M), 3)} kN·m
              </text>
            </g>
          );
        }
        const h1 = 6 + (26 * Math.abs(load.w1)) / peak;
        const h2 = 6 + (26 * Math.abs(load.w2)) / peak;
        return (
          <g key={`l${i}`} class="bm-load-mark">
            <path class="bm-spread" d={`M ${px(load.x1)} ${y - 3} L ${px(load.x1)} ${y - 3 - h1} L ${px(load.x2)} ${y - 3 - h2} L ${px(load.x2)} ${y - 3} Z`} />
            <text x={px(load.x1) + 3} y={y - 7 - Math.max(h1, h2)} class="bm-text">
              {load.w1 === load.w2 ? `${kN(load.w1, 3)} kN/m` : `${kN(load.w1, 3)} to ${kN(load.w2, 3)} kN/m`}
            </text>
          </g>
        );
      })}
      {analysis.supports.map((s, i) => {
        const x = px(s.x);
        if (s.kind === 'fixed') {
          const side = s.x <= analysis.length / 2 ? -1 : 1;
          return (
            <g key={`s${i}`} class="bm-support">
              <line x1={x} x2={x} y1={y - 16} y2={y + 16} />
              {[-12, -4, 4, 12].map((d) => (
                <line key={d} x1={x} x2={x + side * 7} y1={y + d} y2={y + d + 6} />
              ))}
            </g>
          );
        }
        return (
          <g key={`s${i}`} class="bm-support">
            <path d={`M ${x} ${y + 2} L ${x - 8} ${y + 16} L ${x + 8} ${y + 16} Z`} />
            {s.kind === 'roller' && <line x1={x - 10} x2={x + 10} y1={y + 21} y2={y + 21} />}
          </g>
        );
      })}
      <text x={px(0)} y={100} class="bm-text" text-anchor="middle">
        0
      </text>
      <text x={px(analysis.length)} y={100} class="bm-text" text-anchor="middle">
        {metres(analysis.length)} m
      </text>
    </svg>
  );
}

function Plot({ title, unit, xs, values, px, tone }: { title: string; unit: string; xs: readonly number[]; values: readonly number[]; px: (x: number) => number; tone: string }) {
  const height = 132;
  const top = 32;
  const bottom = height - 14;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(Math.abs(max), Math.abs(min), 1e-12);
  const hi = Math.max(max, 0);
  const lo = Math.min(min, 0);
  const range = hi - lo || span;
  const py = (v: number) => top + ((hi - v) / range) * (bottom - top);
  const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${px(x).toFixed(2)} ${py(values[i] as number).toFixed(2)}`).join(' ');
  const area = `${line} L ${px(xs[xs.length - 1] as number).toFixed(2)} ${py(0).toFixed(2)} L ${px(xs[0] as number).toFixed(2)} ${py(0).toFixed(2)} Z`;
  const iMax = values.indexOf(max);
  const iMin = values.indexOf(min);
  const label = (i: number, v: number, above: boolean) => (
    <text x={Math.min(Math.max(px(xs[i] as number), MARGIN), WIDTH - MARGIN)} y={above ? py(v) - 5 : py(v) + 13} class="bm-text bm-value" text-anchor="middle">
      {figure(v, 4)}
    </text>
  );
  return (
    <svg class={`bm-svg bm-plot bm-${tone}`} viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={`${title} diagram, from ${figure(min, 4)} to ${figure(max, 4)} ${unit}`}>
      <text x={4} y={12} class="bm-title">
        {title} ({unit})
      </text>
      <path class="bm-area" d={area} />
      <path class="bm-curve" d={line} />
      <line class="bm-zero" x1={px(0)} x2={px(xs[xs.length - 1] as number)} y1={py(0)} y2={py(0)} />
      {Math.abs(max) > span * 1e-6 && max > 0 && label(iMax, max, true)}
      {Math.abs(min) > span * 1e-6 && min < 0 && label(iMin, min, false)}
    </svg>
  );
}

export default defineCustomTool(BeamCalculator);
