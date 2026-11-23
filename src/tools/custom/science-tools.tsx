/**
 * Periodic Table (colour by category, state at a temperature or any
 * property; element details with shells and isotopes) and Molar Mass
 * Calculator.
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { CATEGORIES, type Category, ELEMENTS, type Element, molarMass, phaseAt, shells } from '../../lib/elements';
import { minus } from '../../lib/si';
import { copyText } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

type ColourBy = 'category' | 'state' | 'electronegativity' | 'radius' | 'ionisation' | 'density' | 'melting' | 'boiling' | 'discovered' | 'mass';

const PROPERTIES: Record<Exclude<ColourBy, 'category' | 'state'>, { label: string; unit: string; value: (e: Element) => number | null; log?: boolean }> = {
  electronegativity: { label: 'Electronegativity', unit: '(Pauling)', value: (e) => e.electronegativity },
  radius: { label: 'Atomic radius', unit: 'pm', value: (e) => e.radius },
  ionisation: { label: 'Ionisation energy', unit: 'eV', value: (e) => e.ionisation },
  density: { label: 'Density', unit: 'g/cm³', value: (e) => e.density, log: true },
  melting: { label: 'Melting point', unit: 'K', value: (e) => e.melting },
  boiling: { label: 'Boiling point', unit: 'K', value: (e) => e.boiling },
  discovered: { label: 'Year discovered', unit: '', value: (e) => (/^\d{4}$/.test(e.discovered) ? Number(e.discovered) : null) },
  mass: { label: 'Atomic mass', unit: 'u', value: (e) => e.mass },
};

/** Viridis, a colour scale that reads in order for most kinds of colour blindness. */
const VIRIDIS = ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'];

function heat(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const a = VIRIDIS[i] as string;
  const b = VIRIDIS[i + 1] as string;
  const mix = (k: number) => Math.round(Number.parseInt(a.slice(k, k + 2), 16) * (1 - f) + Number.parseInt(b.slice(k, k + 2), 16) * f);
  return `rgb(${mix(1)} ${mix(3)} ${mix(5)})`;
}

const CATEGORY_CLASS: Record<Category, string> = {
  'Alkali metal': 'pt-alkali',
  'Alkaline earth metal': 'pt-alkaline',
  'Transition metal': 'pt-transition',
  'Post-transition metal': 'pt-post',
  Metalloid: 'pt-metalloid',
  Nonmetal: 'pt-nonmetal',
  Halogen: 'pt-halogen',
  'Noble gas': 'pt-noble',
  Lanthanide: 'pt-lanthanide',
  Actinide: 'pt-actinide',
};

const PHASE_CLASS = { solid: 'pt-solid', liquid: 'pt-liquid', gas: 'pt-gas', unknown: 'pt-unknown' } as const;

interface TableState {
  readonly colour: ColourBy;
  readonly kelvin: number;
  readonly picked: number;
}
const readTable = (v: Values | undefined): TableState => ({
  colour: typeof v?.colour === 'string' && (v.colour === 'category' || v.colour === 'state' || v.colour in PROPERTIES) ? (v.colour as ColourBy) : 'category',
  kelvin: typeof v?.kelvin === 'number' ? v.kelvin : 298,
  picked: typeof v?.picked === 'number' ? v.picked : 6,
});

const PHASE_NAMES = { solid: 'Solid', liquid: 'Liquid', gas: 'Gas', unknown: 'Not known' } as const;

/** "[He]2s2 2p2" with the electron counts raised. */
function Configuration({ text }: { text: string }) {
  if (!text) return <>–</>;
  const parts = text.split(/(\d[spdfg]\d+)/).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^(\d[spdfg])(\d+)$/.exec(p);
        return m ? (
          <span key={i}>
            {m[1]}
            <sup>{m[2]}</sup>
          </span>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </>
  );
}

const fmt = (n: number | null, digits = 4) => (n === null ? '–' : minus(Number(n.toPrecision(digits))));
const celsius = (k: number | null) => (k === null ? '' : ` (${minus((k - 273.15).toFixed(1))} °C)`);

function BohrModel({ element }: { element: Element }) {
  const counts = shells(element);
  const size = 200;
  const centre = size / 2;
  const step = (centre - 22) / Math.max(1, counts.length);
  return (
    <svg class="pt-bohr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Electron shells of ${element.name}: ${counts.join(', ')}`}>
      <circle cx={centre} cy={centre} r={14} class="pt-nucleus" />
      <text x={centre} y={centre + 4} text-anchor="middle" class="pt-nucleus-text">
        {element.symbol}
      </text>
      {counts.map((n, k) => {
        const r = 14 + step * (k + 1);
        return (
          <g key={k}>
            <circle cx={centre} cy={centre} r={r} class="pt-shell" />
            {Array.from({ length: n }, (_, i) => {
              const a = (i / n) * 2 * Math.PI - Math.PI / 2;
              return <circle key={i} cx={centre + r * Math.cos(a)} cy={centre + r * Math.sin(a)} r={n > 18 ? 2 : 2.8} class="pt-electron" />;
            })}
          </g>
        );
      })}
    </svg>
  );
}

function ElementDetail({ element, kelvin }: { element: Element; kelvin: number }) {
  const rows: [string, ComponentChildren][] = [
    ['Atomic number', String(element.number)],
    ['Atomic mass', `${element.mass} u`],
    ['Category', element.category],
    ['Group, period, block', `${element.group ?? (element.category === 'Lanthanide' || element.category === 'Actinide' ? '3' : '–')}, ${element.period}, ${element.block}`],
    ['State at 25 °C', { s: 'Solid', l: 'Liquid', g: 'Gas', 's?': 'Solid (predicted)', 'g?': 'Gas (predicted)' }[element.state] ?? 'Not known'],
    [`At ${kelvin} K${celsius(kelvin)}`, PHASE_NAMES[phaseAt(element, kelvin)]],
    ['Electron configuration', <Configuration key="c" text={element.configuration} />],
    ['Electrons per shell', shells(element).join(', ')],
    ['Electronegativity', fmt(element.electronegativity)],
    ['Atomic radius', element.radius === null ? '–' : `${element.radius} pm`],
    ['First ionisation energy', element.ionisation === null ? '–' : `${element.ionisation} eV`],
    ['Electron affinity', element.affinity === null ? '–' : `${element.affinity} eV`],
    ['Oxidation states', element.oxidation || '–'],
    ['Melting point', element.melting === null ? '–' : `${element.melting} K${celsius(element.melting)}`],
    ['Boiling point', element.boiling === null ? '–' : `${element.boiling} K${celsius(element.boiling)}`],
    ['Density', element.density === null ? '–' : `${fmt(element.density)} g/cm³`],
    ['Discovered', element.discovered || '–'],
  ];
  return (
    <aside class="pt-detail" data-testid="pt-detail">
      <div class="pt-detail-head">
        <div class={`pt-big ${CATEGORY_CLASS[element.category]}`}>
          <span class="pt-big-number">{element.number}</span>
          <span class="pt-big-symbol">{element.symbol}</span>
        </div>
        <div>
          <h3>{element.name}</h3>
          <p class="tone-muted">{element.category}</p>
        </div>
        <BohrModel element={element} />
      </div>
      <dl class="pt-facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {element.isotopes.length > 0 && (
        <table class="data-table pt-isotopes">
          <caption>Stable isotopes in nature</caption>
          <thead>
            <tr>
              <th>Isotope</th>
              <th class="num">Abundance</th>
            </tr>
          </thead>
          <tbody>
            {element.isotopes.map(([a, abundance]) => (
              <tr key={a}>
                <td>
                  <sup>{a}</sup>
                  {element.symbol}
                </td>
                <td class="num">{(abundance * 100).toPrecision(4)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p class="control-help">Data from PubChem (US National Library of Medicine); isotopes from IUPAC tables via cheminfo.</p>
    </aside>
  );
}

function PeriodicTable({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readTable, (s) => ({ ...s }));
  const [query, setQuery] = useState('');
  const element = ELEMENTS.find((e) => e.number === state.picked) ?? (ELEMENTS[0] as Element);
  const q = query.trim().toLowerCase();
  const matches = (e: Element) => !q || e.symbol.toLowerCase() === q || e.name.toLowerCase().includes(q) || String(e.number) === q;
  const property = state.colour in PROPERTIES ? PROPERTIES[state.colour as keyof typeof PROPERTIES] : null;
  const range = useMemo(() => {
    if (!property) return null;
    const values = ELEMENTS.map(property.value).filter((v): v is number => v !== null && v > 0);
    const t = (v: number) => (property.log ? Math.log10(v) : v);
    return { min: Math.min(...values), max: Math.max(...values), t };
  }, [property]);

  const cellStyle = (e: Element): Record<string, string> | undefined => {
    if (!property || !range) return undefined;
    const v = property.value(e);
    if (v === null || v <= 0) return undefined;
    const t = (range.t(v) - range.t(range.min)) / (range.t(range.max) - range.t(range.min) || 1);
    return { background: heat(t), color: t > 0.6 ? '#111' : '#fff', borderColor: 'transparent' };
  };
  const cellClass = (e: Element) => {
    if (property) return property.value(e) === null ? 'pt-none' : 'pt-heat';
    if (state.colour === 'state') return PHASE_CLASS[phaseAt(e, state.kelvin)];
    return CATEGORY_CLASS[e.category];
  };
  const pick = (n: number) => setState((s) => ({ ...s, picked: n }));

  return (
    <section class="tool pt-tool" data-testid="tool" data-state="done">
      <div class="button-row">
        <label class="control control-inline">
          <span class="control-label">Find</span>
          <input
            class="input"
            value={query}
            placeholder="Name, symbol or number"
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const hit = ELEMENTS.find(matches);
                if (hit) pick(hit.number);
              }
            }}
            data-testid="pt-find"
          />
        </label>
        <label class="control control-inline">
          <span class="control-label">Colour by</span>
          <select class="select" value={state.colour} onChange={(e) => setState((s) => ({ ...s, colour: e.currentTarget.value as ColourBy }))} data-testid="pt-colour">
            <option value="category">Category</option>
            <option value="state">State at a temperature</option>
            {Object.entries(PROPERTIES).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {state.colour === 'state' && (
          <label class="control control-inline pt-temperature">
            <span class="control-label">
              {state.kelvin} K = {minus((state.kelvin - 273.15).toFixed(0))} °C
            </span>
            <input
              type="range"
              min={0}
              max={6000}
              step={1}
              value={state.kelvin}
              onInput={(e) => setState((s) => ({ ...s, kelvin: Number(e.currentTarget.value) }))}
              data-testid="pt-kelvin"
              aria-label="Temperature in kelvin"
            />
          </label>
        )}
      </div>
      <div class="pt-layout">
        <div class="pt-grid" role="group" aria-label="Periodic table" data-testid="pt-grid">
          {ELEMENTS.map((e) => (
            <button
              key={e.number}
              type="button"
              class={`pt-cell ${cellClass(e)}${e.number === element.number ? ' is-active' : ''}${matches(e) ? '' : ' is-dim'}`}
              style={{ gridRow: e.row, gridColumn: e.column, ...cellStyle(e) }}
              onClick={() => pick(e.number)}
              aria-pressed={e.number === element.number}
              title={`${e.name}, ${e.mass} u`}
            >
              <span class="pt-number">{e.number}</span>
              <span class="pt-symbol">{e.symbol}</span>
              <span class="pt-name">{e.name}</span>
            </button>
          ))}
          <span class="pt-marker" style={{ gridRow: 6, gridColumn: 3 }}>
            57–71
          </span>
          <span class="pt-marker" style={{ gridRow: 7, gridColumn: 3 }}>
            89–103
          </span>
          <div class="pt-legend" style={{ gridRow: '1 / span 3', gridColumn: '3 / span 10' }} data-testid="pt-legend">
            {property && range ? (
              <>
                <span>
                  {property.label} {property.unit}
                  {property.log ? ', log scale' : ''}
                </span>
                <span class="pt-scale">
                  <span>{fmt(range.min, 3)}</span>
                  <span class="pt-gradient" style={{ background: `linear-gradient(to right, ${VIRIDIS.join(', ')})` }} />
                  <span>{fmt(range.max, 3)}</span>
                </span>
                <span class="tone-muted">Grey: no data.</span>
              </>
            ) : state.colour === 'state' ? (
              <span class="pt-keys">
                <span class="pt-key pt-solid">Solid</span>
                <span class="pt-key pt-liquid">Liquid</span>
                <span class="pt-key pt-gas">Gas</span>
                <span class="pt-key pt-unknown">Not known</span>
              </span>
            ) : (
              <span class="pt-keys">
                {CATEGORIES.map((c) => (
                  <span key={c} class={`pt-key ${CATEGORY_CLASS[c]}`}>
                    {c}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
        <ElementDetail element={element} kelvin={state.kelvin} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- molar mass -- */

const EXAMPLES = ['H2O', 'NaCl', 'C6H12O6', 'Ca(OH)2', 'CuSO4·5H2O', 'K4[Fe(CN)6]', 'C8H10N4O2'];

function MolarMass({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(
    toolId,
    (v) => ({ formula: typeof v?.formula === 'string' ? v.formula : 'CuSO4·5H2O', grams: typeof v?.grams === 'string' ? v.grams : '10' }),
    (s) => ({ ...s }),
  );
  const result = useMemo(() => {
    try {
      return { value: molarMass(state.formula), error: null };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [state.formula]);
  const grams = Number(state.grams);
  const r = result.value;
  return (
    <section class="tool mm-tool-chem" data-testid="tool" data-state={r ? 'done' : 'idle'}>
      <div class="button-row">
        <label class="control control-inline">
          <span class="control-label">Formula</span>
          <input class="input mmc-formula" value={state.formula} spellcheck={false} onInput={(e) => setState((s) => ({ ...s, formula: e.currentTarget.value }))} data-testid="mmc-formula" />
        </label>
        <label class="control control-inline">
          <span class="control-label">Amount (g)</span>
          <input class="input input-narrow" value={state.grams} onInput={(e) => setState((s) => ({ ...s, grams: e.currentTarget.value }))} />
        </label>
      </div>
      <p class="control-help">
        Examples:{' '}
        {EXAMPLES.map((f, i) => (
          <span key={f}>
            {i > 0 && ', '}
            <button type="button" class="link-button" onClick={() => setState((s) => ({ ...s, formula: f }))}>
              {f}
            </button>
          </span>
        ))}
        . Write hydrates with a dot (CuSO4·5H2O or CuSO4.5H2O).
      </p>
      {result.error && <p class="recipe-error">{result.error}</p>}
      {r && (
        <>
          <p class="mmc-result" data-testid="mmc-result">
            <span class="mmc-formula-pretty">{r.pretty}</span>
            <strong>{r.mass.toFixed(3)} g/mol</strong>
            <button
              type="button"
              class="button button-small button-quiet"
              onClick={() =>
                attempt(async () => {
                  await copyText(r.mass.toFixed(4));
                  notify('Copied');
                })
              }
            >
              <Icon name="copy" size={12} /> Copy
            </button>
          </p>
          {Number.isFinite(grams) && grams > 0 && (
            <p class="control-help">
              {grams} g is {(grams / r.mass).toPrecision(4)} mol, or {((grams / r.mass) * 6.02214076e23).toPrecision(4)} formula units.
            </p>
          )}
          <table class="data-table mmc-table" data-testid="mmc-table">
            <thead>
              <tr>
                <th>Element</th>
                <th class="num">Atoms</th>
                <th class="num">Mass (g/mol)</th>
                <th class="num">By mass</th>
                <th aria-label="Share" />
              </tr>
            </thead>
            <tbody>
              {r.composition.map((c) => (
                <tr key={c.symbol}>
                  <td>
                    <strong>{c.symbol}</strong> {c.name}
                  </td>
                  <td class="num">{Number(c.count.toPrecision(6))}</td>
                  <td class="num">{c.mass.toFixed(3)}</td>
                  <td class="num">{c.percent.toFixed(2)} %</td>
                  <td class="mmc-bar-cell">
                    <span class="mmc-bar" style={{ width: `${c.percent}%` }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function ScienceTools({ toolId }: { toolId: string }) {
  if (toolId === 'molar-mass') return <MolarMass toolId={toolId} />;
  return <PeriodicTable toolId={toolId} />;
}

export default defineCustomTool(ScienceTools);
