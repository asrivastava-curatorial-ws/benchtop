/**
 * Genetics lab: Punnett squares for one to three genes (with incomplete
 * dominance, codominance, ABO blood groups and X-linked genes), populations
 * evolving by selection and drift with a Hardy–Weinberg test, DNA read into
 * protein with mutations, and chi-square tests of breeding results.
 */
import { useMemo } from 'preact/hooks';
import {
  alleleText,
  aminoName,
  cellPhenotype,
  chiSquare,
  chiSquareP,
  cleanDna,
  complement,
  cross,
  type Gene,
  type GeneKind,
  genotypeText,
  hardyWeinberg,
  lnGamma,
  type Mutation,
  mutate,
  mutationEffect,
  ratio,
  simulate,
  transcribe,
  translate,
} from '../../lib/genetics';
import { defineCustomTool, type Values } from '../types';
import { fmt, LAB_COLORS, LabTabs, mergeStored, NumberBox, Plot, Readouts, Slider } from './_lab';
import { Segmented, usePersistentState } from './_shared';

type Tab = 'punnett' | 'population' | 'protein' | 'chisquare';
const TABS: readonly { readonly value: Tab; readonly label: string }[] = [
  { value: 'punnett', label: 'Punnett squares' },
  { value: 'population', label: 'Populations' },
  { value: 'protein', label: 'DNA to protein' },
  { value: 'chisquare', label: 'Chi-square test' },
];

interface Row {
  readonly name: string;
  readonly observed: number;
  readonly expected: number;
}

const PRESETS: Readonly<Record<string, readonly Gene[]>> = {
  'One gene: Aa × Aa': [{ kind: 'complete', letter: 'A', mother: ['D', 'r'], father: ['D', 'r'] }],
  'Test cross: Aa × aa': [{ kind: 'complete', letter: 'A', mother: ['D', 'r'], father: ['r', 'r'] }],
  'Two genes: AaBb × AaBb': [
    { kind: 'complete', letter: 'A', mother: ['D', 'r'], father: ['D', 'r'] },
    { kind: 'complete', letter: 'B', mother: ['D', 'r'], father: ['D', 'r'] },
  ],
  'Three genes: AaBbCc × AaBbCc': [
    { kind: 'complete', letter: 'A', mother: ['D', 'r'], father: ['D', 'r'] },
    { kind: 'complete', letter: 'B', mother: ['D', 'r'], father: ['D', 'r'] },
    { kind: 'complete', letter: 'C', mother: ['D', 'r'], father: ['D', 'r'] },
  ],
  'Incomplete dominance (red × white snapdragons, F2)': [{ kind: 'incomplete', letter: 'R', mother: ['D', 'r'], father: ['D', 'r'] }],
  'Codominance (roan cattle)': [{ kind: 'codominant', letter: 'C', mother: ['D', 'r'], father: ['D', 'r'] }],
  'Blood groups: A (Iᴬi) × B (Iᴮi)': [{ kind: 'abo', letter: 'I', mother: ['A', 'O'], father: ['B', 'O'] }],
  'Colour blindness: carrier mother × unaffected father': [{ kind: 'xlinked', letter: 'B', mother: ['D', 'r'], father: ['D', 'Y'] }],
};

const CHI_PRESETS: Readonly<Record<string, readonly Row[]>> = {
  'Mendel: round and wrinkled peas (3 : 1)': [
    { name: 'round', observed: 5474, expected: 3 },
    { name: 'wrinkled', observed: 1850, expected: 1 },
  ],
  'Mendel: two genes (9 : 3 : 3 : 1)': [
    { name: 'round yellow', observed: 315, expected: 9 },
    { name: 'round green', observed: 108, expected: 3 },
    { name: 'wrinkled yellow', observed: 101, expected: 3 },
    { name: 'wrinkled green', observed: 32, expected: 1 },
  ],
  'Test cross (1 : 1 : 1 : 1)': [
    { name: 'AB', observed: 52, expected: 1 },
    { name: 'Ab', observed: 46, expected: 1 },
    { name: 'aB', observed: 38, expected: 1 },
    { name: 'ab', observed: 64, expected: 1 },
  ],
};

const DEFAULTS = {
  tab: 'punnett' as Tab,
  punnett: { genes: PRESETS['Two genes: AaBb × AaBb'] ?? [] },
  population: { p0: 0.5, size: 100, generations: 200, wAA: 1, wAa: 1, waa: 1, mutation: 0, runs: 5, seed: 1, aa: 360, ab: 480, bb: 160 },
  protein: { dna: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG', kind: 'substitute' as Mutation['kind'] | 'none', at: 6, base: 'A' },
  chisquare: { rows: CHI_PRESETS['Mendel: two genes (9 : 3 : 3 : 1)'] ?? [] },
};
type State = typeof DEFAULTS;
type Part<K extends keyof State> = { s: State[K]; set: (patch: Partial<State[K]>) => void };

const KINDS: readonly GeneKind[] = ['complete', 'incomplete', 'codominant', 'abo', 'xlinked'];
const readGene = (g: unknown): Gene | null => {
  if (typeof g !== 'object' || g === null) return null;
  const o = g as Record<string, unknown>;
  const kind = KINDS.find((k) => k === o.kind);
  const pair = (v: unknown) => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string' && /^[DrABOY]$/.test(x)) ? ([v[0], v[1]] as [string, string]) : null);
  const mother = pair(o.mother);
  const father = pair(o.father);
  return kind && mother && father && typeof o.letter === 'string' ? { kind, letter: o.letter.slice(0, 1) || 'A', mother, father } : null;
};
const read = (v: Values | undefined): State => {
  const s = mergeStored(DEFAULTS, v);
  const genes = (Array.isArray(s.punnett.genes) ? s.punnett.genes : [])
    .map(readGene)
    .filter((g): g is Gene => g !== null)
    .slice(0, 3);
  const rows = (Array.isArray(s.chisquare.rows) ? s.chisquare.rows : [])
    .filter((r): r is Row => typeof r === 'object' && r !== null && typeof r.name === 'string' && Number.isFinite(r.observed) && Number.isFinite(r.expected))
    .slice(0, 10);
  const tab = TABS.find((t) => t.value === s.tab)?.value ?? 'punnett';
  const kind = (['substitute', 'insert', 'delete', 'none'] as const).find((k) => k === s.protein.kind) ?? 'substitute';
  return { ...s, tab, punnett: { genes: genes.length ? genes : DEFAULTS.punnett.genes }, protein: { ...s.protein, kind }, chisquare: { rows: rows.length >= 2 ? rows : DEFAULTS.chisquare.rows } };
};
const write = (s: State): Values => JSON.parse(JSON.stringify(s)) as Values;

/* -------------------------------------------------------------- Punnett -- */

/** Genotype choices for a parent, by gene kind. */
function choices(kind: GeneKind, parent: 'mother' | 'father'): [string, string][] {
  if (kind === 'abo')
    return [
      ['A', 'A'],
      ['A', 'O'],
      ['B', 'B'],
      ['B', 'O'],
      ['A', 'B'],
      ['O', 'O'],
    ];
  if (kind === 'xlinked' && parent === 'father')
    return [
      ['D', 'Y'],
      ['r', 'Y'],
    ];
  return [
    ['D', 'D'],
    ['D', 'r'],
    ['r', 'r'],
  ];
}

const KIND_NAMES: Readonly<Record<GeneKind, string>> = {
  complete: 'Dominant and recessive',
  incomplete: 'Incomplete dominance',
  codominant: 'Codominance',
  abo: 'ABO blood group',
  xlinked: 'X-linked (sex-linked)',
};

const TINTS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#999999'];

function PunnettLab({ s, set }: Part<'punnett'>) {
  const genes = s.genes;
  const result = useMemo(() => cross(genes), [genes]);
  const colourOf = new Map(result.phenotypes.map((p, i) => [p.text, TINTS[i % TINTS.length] ?? '#999']));
  const setGene = (i: number, patch: Partial<Gene>) => set({ genes: genes.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  const letterFor = (kind: GeneKind, i: number) => (kind === 'abo' ? 'I' : kind === 'xlinked' ? 'B' : ('ABC'[i] ?? 'A'));
  const gameteLabel = (gamete: readonly string[]) => gamete.map((a, k) => (genes[k] ? alleleText(genes[k], a) : '')).join('');
  const pct = (n: number) => `${fmt((100 * n) / result.total, 4)} %`;
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <select
          class="input"
          aria-label="Start from a cross"
          value=""
          data-testid="pn-preset"
          onChange={(e) => {
            const preset = PRESETS[e.currentTarget.value];
            if (preset) set({ genes: preset });
          }}
        >
          <option value="">Start from…</option>
          {Object.keys(PRESETS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {genes.map((g, i) => (
          <div key={i} class="pn-gene" data-testid={`pn-gene-${i}`}>
            <h3>Gene {i + 1}</h3>
            <select
              class="input"
              aria-label={`Gene ${i + 1} inheritance`}
              value={g.kind}
              onChange={(e) => {
                const kind = e.currentTarget.value as GeneKind;
                const [m] = choices(kind, 'mother').slice(1);
                const [f] = choices(kind, 'father').slice(kind === 'xlinked' ? 0 : 1);
                setGene(i, { kind, letter: letterFor(kind, i), mother: m ?? ['D', 'r'], father: f ?? ['D', 'r'] });
              }}
            >
              {KINDS.filter((k) => k === g.kind || !((k === 'abo' || k === 'xlinked') && genes.some((x) => x.kind === k))).map((k) => (
                <option key={k} value={k}>
                  {KIND_NAMES[k]}
                </option>
              ))}
            </select>
            <div class="pn-parents">
              {(['mother', 'father'] as const).map((parent) => (
                <label key={parent}>
                  {parent === 'mother' ? 'Mother' : 'Father'}
                  <select
                    class="input"
                    value={g[parent].join('')}
                    data-testid={`pn-${parent}-${i}`}
                    onChange={(e) => {
                      const pick = choices(g.kind, parent).find((c) => c.join('') === e.currentTarget.value);
                      if (pick) setGene(i, { [parent]: pick } as Partial<Gene>);
                    }}
                  >
                    {choices(g.kind, parent).map((c) => (
                      <option key={c.join('')} value={c.join('')}>
                        {genotypeText(g, c[0], c[1])}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {genes.length > 1 && (
              <button type="button" class="button button-small" onClick={() => set({ genes: genes.filter((_, j) => j !== i) })}>
                Remove this gene
              </button>
            )}
          </div>
        ))}
        {genes.length < 3 && (
          <button
            type="button"
            class="button button-small"
            onClick={() => set({ genes: [...genes, { kind: 'complete', letter: letterFor('complete', genes.length), mother: ['D', 'r'], father: ['D', 'r'] }] })}
            data-testid="pn-add"
          >
            Add a gene
          </button>
        )}
      </div>
      <div class="lab-stage">
        <div class="pn-wrap">
          <table class={`pn-grid${result.total > 16 ? ' is-big' : ''}`} data-testid="pn-grid">
            <thead>
              <tr>
                <th class="pn-corner">♀ \ ♂</th>
                {result.sperm.map((g, j) => (
                  <th key={j}>{gameteLabel(g)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.eggs.map((egg, i) => (
                <tr key={i}>
                  <th>{gameteLabel(egg)}</th>
                  {result.cells[i]?.map((pairs, j) => {
                    const ph = cellPhenotype(genes, pairs);
                    return (
                      <td key={j} style={{ '--pn-tint': colourOf.get(ph) ?? '#999' }} title={ph}>
                        {genes.map((gene, k) => genotypeText(gene, pairs[k]?.[0] ?? '', pairs[k]?.[1] ?? '')).join('')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <table class="lab-table pn-key" data-testid="pn-phenotypes">
          <thead>
            <tr>
              <th>Phenotype</th>
              <th>Squares</th>
              <th>Chance</th>
            </tr>
          </thead>
          <tbody>
            {result.phenotypes.map((p) => (
              <tr key={p.text}>
                <td>
                  <i class="pn-swatch" style={{ background: colourOf.get(p.text) }} />
                  {p.text}
                </td>
                <td>
                  {p.count} of {result.total}
                </td>
                <td>{pct(p.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Readouts
          test="pn-results"
          items={[
            ['Phenotype ratio', ratio(result.phenotypes.map((p) => p.count))],
            ['Genotype ratio', ratio(result.genotypes.map((g) => g.count))],
            ['Genotypes', result.genotypes.map((g) => `${g.text} ${g.count}/${result.total}`).join(', ')],
          ]}
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- populations -- */

function PopulationLab({ s, set }: Part<'population'>) {
  const lines = useMemo(
    () => simulate({ p0: s.p0, size: s.size, generations: s.generations, fitness: [s.wAA, s.wAa, s.waa], mutation: s.mutation, runs: s.runs, seed: s.seed }),
    [s.p0, s.size, s.generations, s.wAA, s.wAa, s.waa, s.mutation, s.runs, s.seed],
  );
  const finals = lines.map((l) => l.at(-1) ?? 0);
  const fixed = finals.filter((p) => p >= 1).length;
  const lost = finals.filter((p) => p <= 0).length;
  const hw = hardyWeinberg(s.aa, s.ab, s.bb);
  const q0 = 1 - s.p0;
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Start frequency of A" value={s.p0} min={0} max={1} step={0.01} onChange={(p0) => set({ p0 })} test="pop-p0" />
        <Slider label="Population size" value={s.size} min={2} max={10000} step={1} onChange={(size) => set({ size })} test="pop-size" />
        <Slider label="Generations" value={s.generations} min={10} max={1000} step={10} onChange={(generations) => set({ generations })} />
        <Slider label="Runs" value={s.runs} min={1} max={6} step={1} onChange={(runs) => set({ runs })} />
        <h3>Fitness (chance of breeding)</h3>
        <Slider label="AA" value={s.wAA} min={0} max={1} step={0.01} onChange={(wAA) => set({ wAA })} />
        <Slider label="Aa" value={s.wAa} min={0} max={1} step={0.01} onChange={(wAa) => set({ wAa })} />
        <Slider label="aa" value={s.waa} min={0} max={1} step={0.01} onChange={(waa) => set({ waa })} test="pop-waa" />
        <Slider label="Mutation rate" value={s.mutation} min={0} max={0.01} step={0.0001} onChange={(mutation) => set({ mutation })} />
        <div class="button-row">
          <button type="button" class="button button-primary button-small" onClick={() => set({ seed: s.seed + 1 })} data-testid="pop-again">
            Run again
          </button>
        </div>
      </div>
      <div class="lab-stage">
        <div class="lab-plots">
          <Plot
            title="Frequency of allele A"
            test="pop-plot"
            series={lines.map((l, i) => ({ name: `run ${i + 1}`, points: l.map((p, g) => [g, p] as const), color: LAB_COLORS[i % LAB_COLORS.length] }))}
            xLabel="generation"
            yLabel="frequency of A"
            yRange={[0, 1]}
            xRange={[0, s.generations]}
          />
        </div>
        <Readouts
          test="pop-results"
          items={[
            ['Hardy–Weinberg at the start', `AA ${fmt(s.p0 * s.p0, 3)}, Aa ${fmt(2 * s.p0 * q0, 3)}, aa ${fmt(q0 * q0, 3)}`],
            ['After the last generation', `A fixed in ${fixed}, lost in ${lost}, still mixed in ${lines.length - fixed - lost} of ${lines.length} runs`],
            ['Average final frequency of A', fmt(finals.reduce((a, b) => a + b, 0) / Math.max(1, finals.length), 3)],
          ]}
        />
        <div class="lab-controls pop-hw">
          <h3>Do these counts fit Hardy–Weinberg?</h3>
          <div class="pop-counts">
            {(
              [
                ['AA', 'aa', s.aa],
                ['Aa', 'ab', s.ab],
                ['aa', 'bb', s.bb],
              ] as const
            ).map(([label, key, value]) => (
              <div key={key} class="ms-field">
                {label}
                <NumberBox value={value} min={0} max={1e7} step={1} label={`Number with ${label}`} onChange={(v) => set({ [key]: v } as Partial<State['population']>)} test={`hw-${key}`} />
                <span />
              </div>
            ))}
          </div>
          <Readouts
            test="hw-results"
            items={[
              ['Allele frequencies', `p = ${fmt(hw.p, 4)}, q = ${fmt(hw.q, 4)}`],
              ['Expected', hw.expected.map((e) => fmt(e, 4)).join(', ')],
              ['χ² (1 degree of freedom)', `${fmt(hw.chi2, 4)}, p = ${fmt(hw.pValue, 3)}`],
              ['Verdict', hw.pValue < 0.05 ? 'does not fit (p < 0.05): something besides random mating is at work' : 'fits Hardy–Weinberg (p ≥ 0.05)'],
            ]}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- DNA to protein -- */

function ProteinLab({ s, set }: Part<'protein'>) {
  const dna = cleanDna(s.dna);
  const mutation: Mutation | null = s.kind === 'none' ? null : s.kind === 'delete' ? { kind: 'delete', at: s.at - 1 } : { kind: s.kind, at: s.at - 1, base: s.base };
  const mutant = mutation ? mutate(dna, mutation) : dna;
  const before = translate(dna);
  const after = translate(mutant);
  const gc = dna.length ? ([...dna].filter((b) => b === 'G' || b === 'C').length / dna.length) * 100 : 0;
  const strand = (seq: string, mark: number | null, label: string, test?: string) => (
    <div class="dna-row" data-testid={test}>
      <span class="dna-label">{label}</span>
      <code>
        {[...seq].map((b, i) => (
          <span key={i} class={`dna-b dna-${b}${i === mark ? ' is-mark' : ''}${i % 3 === (before.start >= 0 ? before.start % 3 : 0) && i > 0 ? ' is-codon' : ''}`}>
            {b}
          </span>
        ))}
      </code>
    </div>
  );
  const protein = (t: ReturnType<typeof translate>, other: ReturnType<typeof translate> | null, test: string) => (
    <div class="dna-protein" data-testid={test}>
      {t.codons.map((c, i) => {
        const aa = t.protein[i];
        const changed = other && other.protein[i] !== aa;
        return (
          <span key={i} class={`dna-aa${aa === undefined ? ' is-stop' : ''}${changed ? ' is-changed' : ''}`}>
            <small>{c}</small>
            {aa === undefined ? 'Stop' : aminoName(aa)}
          </span>
        );
      })}
    </div>
  );
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <label class="dna-input">
          DNA (coding strand, 5′ → 3′)
          <textarea class="input" rows={4} value={s.dna} onInput={(e) => set({ dna: e.currentTarget.value })} spellcheck={false} data-testid="dna-input" />
        </label>
        <h3>Mutation</h3>
        <Segmented
          label="Mutation"
          value={s.kind}
          choices={[
            { value: 'none', label: 'None' },
            { value: 'substitute', label: 'Swap a base' },
            { value: 'insert', label: 'Insert' },
            { value: 'delete', label: 'Delete' },
          ]}
          onChange={(kind) => set({ kind })}
        />
        {s.kind !== 'none' && (
          <>
            <div class="ms-field">
              At base
              <NumberBox value={s.at} min={1} max={Math.max(1, dna.length)} step={1} label="Base number" test="dna-at" onChange={(at) => set({ at })} />
              <span />
            </div>
            {s.kind !== 'delete' && <Segmented label="New base" value={s.base} choices={['A', 'C', 'G', 'T'].map((b) => ({ value: b, label: b }))} onChange={(base) => set({ base })} />}
          </>
        )}
      </div>
      <div class="lab-stage">
        <div class="dna-block">
          {strand(dna, null, 'Coding', 'dna-coding')}
          {strand(complement(dna), null, 'Template')}
          {strand(transcribe(dna), null, 'mRNA')}
        </div>
        {before.start < 0 ? <p class="lab-note">No start codon (ATG) in this DNA, so nothing is translated.</p> : protein(before, mutation ? after : null, 'dna-protein')}
        {mutation && (
          <>
            <h3 class="dna-heading">After the mutation</h3>
            <div class="dna-block">{strand(mutant, mutation.kind === 'delete' ? null : mutation.at, 'Coding')}</div>
            {after.start < 0 ? <p class="lab-note">The start codon is gone.</p> : protein(after, before, 'dna-mutant')}
          </>
        )}
        <Readouts
          test="dna-results"
          items={[
            ['Protein', before.protein ? `${before.protein} (${before.protein.length} amino acids)` : '—'],
            ['GC content', `${fmt(gc, 3)} %`],
            ['Ends', before.stopped ? 'at a stop codon' : 'without a stop codon (the DNA runs out)'],
            ...(mutation ? ([['The mutation', mutationEffect(before, after, mutation)]] as [string, string][]) : []),
            ...(mutation ? ([['Mutant protein', after.protein ? `${after.protein} (${after.protein.length})` : '—']] as [string, string][]) : []),
          ]}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ chi-square -- */

function ChiLab({ s, set }: Part<'chisquare'>) {
  const rows = s.rows;
  const res = chiSquare(
    rows.map((r) => r.observed),
    rows.map((r) => r.expected),
  );
  // The value that p = 0.05 sits at, by bisection.
  let lo = 0;
  let hi = 200;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (chiSquareP(m, res.df) > 0.05) lo = m;
    else hi = m;
  }
  const critical = (lo + hi) / 2;
  const k = res.df;
  const pdf = (x: number) => (x <= 0 ? (k === 2 ? 0.5 : 0) : Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.log(2) - lnGamma(k / 2)));
  const top = Math.max(critical * 1.6, res.chi2 * 1.2, 4);
  const curve = Array.from({ length: 301 }, (_, i) => [(i / 300) * top, Math.min(pdf((i / 300) * top), 1)] as const);
  const setRow = (i: number, patch: Partial<Row>) => set({ rows: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <select
          class="input"
          aria-label="Start from"
          value=""
          data-testid="chi-preset"
          onChange={(e) => {
            const preset = CHI_PRESETS[e.currentTarget.value];
            if (preset) set({ rows: preset });
          }}
        >
          <option value="">Start from…</option>
          {Object.keys(CHI_PRESETS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <table class="lab-table chi-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Counted</th>
              <th>Ratio</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input class="input chi-name" value={r.name} aria-label={`Group ${i + 1} name`} onInput={(e) => setRow(i, { name: e.currentTarget.value })} />
                </td>
                <td>
                  <NumberBox
                    className="input chi-num"
                    value={r.observed}
                    min={0}
                    max={1e9}
                    step={1}
                    label={`Group ${i + 1} count`}
                    onChange={(observed) => setRow(i, { observed })}
                    test={`chi-obs-${i}`}
                  />
                </td>
                <td>
                  <NumberBox className="input chi-num" value={r.expected} min={0} max={1e6} step={0.01} label={`Group ${i + 1} expected ratio`} onChange={(expected) => setRow(i, { expected })} />
                </td>
                <td>
                  {rows.length > 2 && (
                    <button type="button" class="button button-small" aria-label={`Remove group ${i + 1}`} onClick={() => set({ rows: rows.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length < 10 && (
          <button type="button" class="button button-small" onClick={() => set({ rows: [...rows, { name: `group ${rows.length + 1}`, observed: 10, expected: 1 }] })}>
            Add a group
          </button>
        )}
      </div>
      <div class="lab-stage">
        <table class="lab-table" data-testid="chi-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Counted (O)</th>
              <th>Expected (E)</th>
              <th>(O − E)² ÷ E</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const e = res.expected[i] ?? 0;
              return (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{fmt(r.observed, 6)}</td>
                  <td>{fmt(e, 5)}</td>
                  <td>{e > 0 ? fmt((r.observed - e) ** 2 / e, 4) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Readouts
          test="chi-results"
          items={[
            ['χ²', fmt(res.chi2, 4)],
            ['Degrees of freedom', String(res.df)],
            ['p-value', fmt(res.p, 4)],
            ['Critical value at 5 %', fmt(critical, 4)],
            ['Verdict', res.p < 0.05 ? 'the counts differ from the ratio by more than chance usually gives (p < 0.05)' : 'the counts fit the ratio: the differences could well be chance'],
          ]}
        />
        <div class="lab-plots">
          <Plot
            title={`Chi-square distribution, ${res.df} degree${res.df === 1 ? '' : 's'} of freedom`}
            test="chi-plot"
            series={[{ name: 'chance', points: curve }]}
            xLabel="χ²"
            yLabel="probability density"
            xRange={[0, top]}
            marker={critical}
            points={[{ x: res.chi2, y: Math.min(pdf(res.chi2), 1), label: 'yours', live: true }]}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tool -- */

function GeneticsLab({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const part =
    <K extends Exclude<keyof State, 'tab'>>(key: K) =>
    (patch: Partial<State[K]>) =>
      setState((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  return (
    <section class="tool lab-tool" data-testid="tool" data-state="done">
      <LabTabs label="Topic" value={s.tab} choices={TABS} onChange={(tab) => setState((p) => ({ ...p, tab }))} />
      {s.tab === 'punnett' && <PunnettLab s={s.punnett} set={part('punnett')} />}
      {s.tab === 'population' && <PopulationLab s={s.population} set={part('population')} />}
      {s.tab === 'protein' && <ProteinLab s={s.protein} set={part('protein')} />}
      {s.tab === 'chisquare' && <ChiLab s={s.chisquare} set={part('chisquare')} />}
    </section>
  );
}

export default defineCustomTool(GeneticsLab);
