/**
 * The calculator library: about 170 calculators in 14 categories.  Every
 * field can be typed or left empty; empty fields are worked out from the rest,
 * so each calculator also runs backwards (the rate from an EMI, the height
 * from a BMI).  The most recently typed values win when they disagree.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { clearQuery, toolLink, useRoute } from '../../app/router';
import { bandOf, choiceValue, defaultUnit, formatNumber, fromFormula, shownUnit, toFormula } from '../../calc/engine';
import { CALC_OPEN_EVENT, takePendingCalculator } from '../../calc/launch';
import { CALCULATORS, calculatorsIn, findCalculator } from '../../calc/library';
import { type CalcRow, calcPdf, decodeState, encodeState, type SavedState, summarise } from '../../calc/report';
import { loadMath, type Solution, solve } from '../../calc/solver';
import { CALC_CATEGORIES, type CalcCategory, type Calculator, type ChoiceVar, isChoice, type NumberVar } from '../../calc/types';
import { unitsOf } from '../../calc/units';
import { copyText, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

type MathJs = Awaited<ReturnType<typeof loadMath>>;

interface CalcState {
  /** Raw text typed per variable. */
  readonly typed: Readonly<Record<string, string>>;
  /** Order of edits, oldest first, for deciding which typed value gives way. */
  readonly order: readonly string[];
  readonly units: Readonly<Record<string, string>>;
  readonly choices: Readonly<Record<string, number>>;
}

/** A calculation kept for later: what was set, and a line describing it. */
interface Kept {
  readonly at: number;
  readonly state: SavedState;
  readonly summary: string;
}

interface Settings {
  readonly selected: Readonly<Record<string, string>>;
  readonly states: Readonly<Record<string, CalcState>>;
  readonly currency: string;
  /** Kept calculations per calculator, newest first. */
  readonly history: Readonly<Record<string, readonly Kept[]>>;
}

const MAX_KEPT = 20;

const CURRENCIES = ['₹', '$', '€', '£', '¥', ''] as const;

function defaultCurrency(): string {
  const locale = typeof navigator === 'undefined' ? '' : navigator.language;
  const region = locale.split('-')[1]?.toUpperCase() ?? '';
  if (region === 'IN') return '₹';
  if (region === 'GB') return '£';
  if (region === 'JP' || region === 'CN') return '¥';
  if (['DE', 'FR', 'ES', 'IT', 'NL', 'IE', 'AT', 'BE', 'FI', 'PT', 'GR'].includes(region)) return '€';
  return locale.startsWith('en-IN') ? '₹' : '$';
}

const read = (s: Values | undefined): Settings => ({
  selected: s?.selected && typeof s.selected === 'object' ? (s.selected as Record<string, string>) : {},
  states: s?.states && typeof s.states === 'object' ? (s.states as Record<string, CalcState>) : {},
  currency: typeof s?.currency === 'string' && (CURRENCIES as readonly string[]).includes(s.currency) ? s.currency : defaultCurrency(),
  history: s?.history && typeof s.history === 'object' ? (s.history as Record<string, Kept[]>) : {},
});

/** A saved or shared state as the calculator's own, typed values in the order given. */
const restore = (saved: SavedState): CalcState => ({ typed: { ...saved.typed }, order: Object.keys(saved.typed), units: { ...saved.units }, choices: { ...saved.choices } });

function initialState(calc: Calculator): CalcState {
  const typed: Record<string, string> = {};
  const choices: Record<string, number> = {};
  for (const v of calc.vars) {
    if (isChoice(v)) choices[v.key] = v.example ?? 0;
    else if (v.example !== undefined && !v.result) typed[v.key] = String(v.example);
  }
  return { typed, order: Object.keys(typed), units: {}, choices };
}

/** Reads "1,00,000", "1e6", "−3" and clock times such as "5:30" or "1:02:03". */
export function parseInput(text: string): number | null {
  const clean = text.replace(/[\s,_]/g, '').replace(/[−–]/g, '-');
  if (clean === '' || clean === '-' || clean === '.') return null;
  if (/^-?\d+(\.\d+)?(:\d{1,2}(\.\d+)?){1,2}$/.test(clean)) {
    const negative = clean.startsWith('-');
    const parts = clean.replace('-', '').split(':').map(Number);
    const value = parts.reduce((sum, part, i) => sum + part / 60 ** i, 0);
    return negative ? -value : value;
  }
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/** "1:05:30" for times and paces shown in hours or minutes, as a second reading. */
function clockText(v: NumberVar, unitId: string, value: number): string | null {
  if (!Number.isFinite(value) || value <= 0 || !(v.dim === 'time' || v.dim === 'pace')) return null;
  const minutes = unitId === 'h' ? value * 60 : unitId === 'min' || unitId === 'min/km' || unitId === 'min/mi' ? value : null;
  if (minutes === null || minutes >= 60 * 1000) return null;
  const total = Math.round(minutes * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const text = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return v.dim === 'pace' ? `${text} per ${unitId.split('/')[1]}` : text;
}

interface Outcome {
  readonly solution: Solution | null;
  /** Typed keys that were set aside because newer values contradicted them. */
  readonly dropped: readonly string[];
  readonly invalid: readonly string[];
}

function compute(math: MathJs, calc: Calculator, state: CalcState): Outcome {
  const choices: Record<string, number> = {};
  for (const v of calc.vars) if (isChoice(v)) choices[v.key] = choiceValue(v, state.choices[v.key]);
  const given: Record<string, number> = {};
  const invalid: string[] = [];
  for (const v of calc.vars) {
    if (isChoice(v) || v.result) continue;
    const text = state.typed[v.key];
    if (text === undefined || text.trim() === '') continue;
    const value = parseInput(text);
    if (value === null || (!v.signed && value < 0)) {
      invalid.push(v.key);
      continue;
    }
    given[v.key] = toFormula(v, value, shownUnit(v, state.units[v.key]));
  }
  const guesses: Record<string, number> = {};
  for (const v of calc.vars) if (!isChoice(v) && v.example !== undefined) guesses[v.key] = toFormula(v, v.example, defaultUnit(v));
  let solution = solve(math, calc, given, choices, guesses);
  // Too many values that disagree: let the oldest typed ones give way.
  const dropped: string[] = [];
  const order = [...state.order.filter((key) => key in given), ...Object.keys(given).filter((key) => !state.order.includes(key))];
  while (solution.conflicts.length && order.length) {
    const victim = order.shift() as string;
    dropped.push(victim);
    delete given[victim];
    solution = solve(math, calc, given, choices, guesses);
  }
  return { solution, dropped, invalid };
}

function NumberField({
  v,
  state,
  outcome,
  currency,
  onType,
  onUnit,
}: {
  v: NumberVar;
  state: CalcState;
  outcome: Outcome;
  currency: string;
  onType: (key: string, text: string) => void;
  onUnit: (key: string, unit: string, converted: string | null) => void;
}) {
  const unit = shownUnit(v, state.units[v.key]);
  const units = unitsOf(v.dim);
  const solution = outcome.solution;
  const typedText = state.typed[v.key] ?? '';
  const isTyped = typedText.trim() !== '' && !outcome.dropped.includes(v.key) && !v.result;
  const value = solution?.values[v.key];
  const shown = value !== undefined ? fromFormula(v, value, unit) : undefined;
  const computed = !isTyped && shown !== undefined;
  const band = value !== undefined ? bandOf(v, value) : null;
  const clock = shown !== undefined ? clockText(v, unit.id, shown) : null;
  const id = `calc-${v.key}`;
  const invalid = outcome.invalid.includes(v.key);
  return (
    <div class={`calc-field${computed ? ' is-computed' : ''}${invalid ? ' is-invalid' : ''}`} data-testid={`calc-field-${v.key}`}>
      <label for={id} class="calc-label">
        {v.label}
      </label>
      <div class="calc-input-row">
        {v.dim === 'money' && currency && <span class="calc-currency">{currency}</span>}
        <input
          id={id}
          class="input calc-input"
          inputMode="decimal"
          autocomplete="off"
          spellcheck={false}
          value={isTyped ? typedText : computed ? formatNumber(shown) : ''}
          placeholder={v.result ? 'Calculated' : 'Enter or leave empty'}
          readOnly={v.result}
          aria-invalid={invalid}
          onInput={(e) => onType(v.key, e.currentTarget.value)}
          onFocus={(e) => {
            if (computed) e.currentTarget.select();
          }}
        />
        {units.length > 1 ? (
          <select
            class="input calc-unit"
            aria-label={`${v.label} unit`}
            value={unit.id}
            onChange={(e) => {
              const next = units.find((u) => u.id === e.currentTarget.value);
              if (!next) return;
              // Keep the same quantity when switching units of a typed value.
              const typedValue = isTyped ? parseInput(typedText) : null;
              const converted = typedValue !== null ? formatNumber(fromFormula(v, toFormula(v, typedValue, unit), next)).replace(/,/g, '') : null;
              onUnit(v.key, next.id, converted);
            }}
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        ) : unit.label ? (
          <span class="calc-unit-label">{unit.label}</span>
        ) : null}
      </div>
      {(band || clock || (v.help && !computed)) && (
        <div class="calc-note">
          {band && <span class="calc-band">{band}</span>}
          {clock && <span class="tone-muted">{clock}</span>}
          {v.help && !computed && <span class="tone-muted">{v.help}</span>}
        </div>
      )}
    </div>
  );
}

function ChoiceField({ v, state, onChoice }: { v: ChoiceVar; state: CalcState; onChoice: (key: string, index: number) => void }) {
  const index = state.choices[v.key] ?? v.example ?? 0;
  const id = `calc-${v.key}`;
  if (v.choices.length <= 3 && v.choices.every((c) => c.label.length <= 18)) {
    return (
      <div class="calc-field">
        <span class="calc-label" id={`${id}-label`}>
          {v.label}
        </span>
        <div class="segmented" role="radiogroup" aria-labelledby={`${id}-label`}>
          {v.choices.map((c, i) => (
            <button key={c.label} type="button" role="radio" aria-checked={i === index} class={i === index ? 'is-active' : ''} onClick={() => onChoice(v.key, i)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div class="calc-field">
      <label for={id} class="calc-label">
        {v.label}
      </label>
      <select id={id} class="input" value={index} onChange={(e) => onChoice(v.key, Number(e.currentTarget.value))}>
        {v.choices.map((c, i) => (
          <option key={c.label} value={i}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CalculatorView({
  calc,
  state,
  setState,
  currency,
  math,
  kept,
  onKeep,
  onForget,
}: {
  calc: Calculator;
  state: CalcState;
  setState: (next: CalcState) => void;
  currency: string;
  math: MathJs;
  kept: readonly Kept[];
  onKeep: (entry: Kept) => void;
  onForget: (at: number) => void;
}) {
  const outcome = useMemo(() => compute(math, calc, state), [math, calc, state]);
  const solution = outcome.solution;
  const active = solution?.active ?? new Set(calc.vars.map((v) => v.key));
  const shownVars = calc.vars.filter((v) => isChoice(v) || active.has(v.key));
  const missing = solution?.missing.filter((key) => !(calc.vars.find((v) => v.key === key) as NumberVar | undefined)?.result) ?? [];

  const type = (key: string, text: string) => {
    const typed = { ...state.typed, [key]: text };
    if (text.trim() === '') delete typed[key];
    setState({ ...state, typed, order: [...state.order.filter((k) => k !== key), ...(text.trim() ? [key] : [])] });
  };
  // Set aside values that newer ones contradicted, so the fields show what was calculated.
  useEffect(() => {
    if (!outcome.dropped.length) return;
    const typed = { ...state.typed };
    for (const key of outcome.dropped) delete typed[key];
    setState({ ...state, typed, order: state.order.filter((k) => !outcome.dropped.includes(k)) });
  }, [outcome.dropped.join('|')]);

  /** The values on screen, typed or worked out, in the calculator's order. */
  const rows = (): CalcRow[] => {
    const out: CalcRow[] = [];
    for (const v of shownVars) {
      if (isChoice(v)) {
        out.push({ label: v.label, value: v.choices[state.choices[v.key] ?? v.example ?? 0]?.label ?? '', typed: true });
        continue;
      }
      const value = solution?.values[v.key];
      if (value === undefined) continue;
      const unit = shownUnit(v, state.units[v.key]);
      const band = bandOf(v, value);
      const typed = state.typed[v.key] !== undefined && state.typed[v.key]?.trim() !== '';
      out.push({
        label: v.label,
        value: `${v.dim === 'money' ? currency : ''}${formatNumber(fromFormula(v, value, unit))}${unit.label && v.dim !== 'money' ? ` ${unit.label}` : ''}${band ? ` (${band})` : ''}`,
        typed,
      });
    }
    return out;
  };
  const saved = (): SavedState => ({ typed: state.typed, units: state.units, choices: state.choices });
  /** Copying, sharing or saving a result also keeps it in the history. */
  const keep = () => onKeep({ at: Date.now(), state: saved(), summary: summarise(rows()) });

  const copyResults = () =>
    attempt(async () => {
      await copyText([calc.name, ...rows().map((r) => `${r.label}: ${r.value}`)].join('\n'));
      keep();
      notify('Copied');
    });
  const copyLink = () =>
    attempt(async () => {
      await copyText(toolLink(`calc-${calc.category}`, { calc: calc.id, s: encodeState(saved()) }));
      keep();
      notify('Link copied. Open it in Benchtop’s search (Ctrl K), or with: benchtop open "<link>"');
    });
  const savePdf = () =>
    attempt(async () => {
      const formula = calc.eqs.map((eq) => (typeof eq === 'string' ? eq : eq.eq));
      const bytes = await calcPdf({ title: calc.name, description: calc.description, rows: rows(), formula, notes: calc.notes, when: new Date() });
      const result = await saveFile(`${calc.id}.pdf`, bytes, 'application/pdf');
      if (result.saved) {
        keep();
        notify(`Saved to ${result.location}`);
      }
    });

  return (
    <article class="calc-card" data-testid="calc-card">
      <header class="calc-head">
        <div>
          <h2>{calc.name}</h2>
          <p>{calc.description}</p>
        </div>
        <div class="button-row">
          <button type="button" class="button button-small" onClick={copyResults}>
            <Icon name="copy" size={14} /> Copy
          </button>
          <button type="button" class="button button-small" onClick={copyLink} title="Copy a link that opens this calculator with these values" data-testid="calc-link">
            <Icon name="share" size={14} /> Link
          </button>
          <button type="button" class="button button-small" onClick={savePdf} title="Save the values, formula and notes as a PDF" data-testid="calc-pdf">
            <Icon name="save" size={14} /> PDF
          </button>
          <button type="button" class="button button-small" onClick={() => keep()} title="Keep these values in the history below" data-testid="calc-keep">
            <Icon name="star" size={14} /> Keep
          </button>
          <button type="button" class="button button-small button-quiet" onClick={() => setState({ typed: {}, order: [], units: state.units, choices: state.choices })}>
            Clear
          </button>
          <button type="button" class="button button-small button-quiet" onClick={() => setState(initialState(calc))}>
            Example
          </button>
        </div>
      </header>
      <div class="calc-fields">
        {shownVars.map((v) =>
          isChoice(v) ? (
            <ChoiceField key={v.key} v={v} state={state} onChoice={(key, index) => setState({ ...state, choices: { ...state.choices, [key]: index } })} />
          ) : (
            <NumberField
              key={v.key}
              v={v}
              state={state}
              outcome={outcome}
              currency={currency}
              onType={type}
              onUnit={(key, unit, converted) => {
                const typed = converted !== null ? { ...state.typed, [key]: converted } : state.typed;
                setState({ ...state, typed, units: { ...state.units, [key]: unit } });
              }}
            />
          ),
        )}
      </div>
      <p class="calc-status" aria-live="polite" data-testid="calc-status">
        {outcome.invalid.length
          ? 'Some values are not numbers this calculator can use.'
          : missing.length
            ? `Enter ${missing.length === 1 ? 'one more value' : `${missing.length} more values`}, or change which ones are empty, to calculate the rest.`
            : 'Type in any field; the empty ones are worked out from the rest.'}
      </p>
      <details class="calc-formula">
        <summary>Formula</summary>
        <ul>
          {calc.eqs.map((eq) => {
            const text = typeof eq === 'string' ? eq : eq.eq;
            const when = typeof eq === 'string' ? null : eq.when;
            return (
              <li key={text}>
                <code class="mono">{text}</code>
                {when && (
                  <span class="tone-muted">
                    {' '}
                    when{' '}
                    {Object.entries(when)
                      .map(([key, value]) => {
                        const v = calc.vars.find((x) => x.key === key) as ChoiceVar | undefined;
                        return `${v?.label.toLowerCase() ?? key} is ${v?.choices.find((c) => c.value === value)?.label.toLowerCase() ?? value}`;
                      })
                      .join(' and ')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <p class="tone-muted">
          {calc.vars
            .filter((v) => !isChoice(v))
            .map((v) => `${v.key}: ${v.label.toLowerCase()} (${(v as NumberVar).unit === 'money' ? 'amount' : (v as NumberVar).unit === '×' ? 'fraction' : (v as NumberVar).unit || 'number'})`)
            .join('; ')}
          .
        </p>
      </details>
      {calc.notes && <p class="calc-notes">{calc.notes}</p>}
      {kept.length > 0 && (
        <section class="calc-history" aria-label="Kept calculations" data-testid="calc-history">
          <h3>Kept calculations</h3>
          <ol>
            {kept.map((entry) => (
              <li key={entry.at}>
                <button type="button" class="calc-history-entry" onClick={() => setState(restore(entry.state))} title="Put these values back">
                  <span>{entry.summary || 'No values'}</span>
                  <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
                </button>
                <button type="button" class="icon-button" aria-label="Forget this calculation" title="Forget" onClick={() => onForget(entry.at)}>
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}

function CalcLibrary({ toolId }: { toolId: string }) {
  const category = (CALC_CATEGORIES.find((c) => `calc-${c.id}` === toolId)?.id ?? 'finance') as CalcCategory;
  const [settings, setSettings] = usePersistentState<Settings>('calc-library', read, (s) => ({ ...s }) as unknown as Values);
  const [query, setQuery] = useState('');
  const [math, setMath] = useState<MathJs | null>(null);
  const [error, setError] = useState('');
  const list = useMemo(() => calculatorsIn(category), [category]);
  const selectedId = settings.selected[category];
  const calc = findCalculator(selectedId ?? '') ?? list[0];

  useEffect(() => {
    loadMath().then(setMath, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const select = (id: string) => {
    const target = findCalculator(id);
    if (!target) return;
    setSettings((s) => ({ ...s, selected: { ...s.selected, [target.category]: id } }));
    setQuery('');
  };

  // A shared link: #/tool/calc-…?calc=<id>&s=<values>.
  const route = useRoute();
  const applied = useRef('');
  useEffect(() => {
    const query = route.page === 'tool' ? route.query : undefined;
    if (!query || query === applied.current) return;
    applied.current = query;
    const params = new URLSearchParams(query);
    const target = findCalculator(params.get('calc') ?? '');
    const shared = decodeState(params.get('s') ?? '');
    if (target) {
      select(target.id);
      if (shared) setSettings((s) => ({ ...s, states: { ...s.states, [target.id]: restore(shared) } }));
      else if (params.has('s')) notify('The link’s values could not be read; the calculator opened without them.', 'error');
    } else notify('That link names a calculator this version does not have.', 'error');
    clearQuery(toolId);
  }, [route]);

  // Opened from the app's search or command palette.
  useEffect(() => {
    const take = () => {
      const id = takePendingCalculator();
      if (id) select(id);
    };
    take();
    window.addEventListener(CALC_OPEN_EVENT, take);
    return () => window.removeEventListener(CALC_OPEN_EVENT, take);
  }, []);

  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return CALCULATORS.filter((c) => `${c.name} ${c.description} ${(c.keywords ?? []).join(' ')}`.toLowerCase().includes(needle)).slice(0, 60);
  }, [query]);

  const state = settings.states[calc.id] ?? initialState(calc);
  const categoryInfo = CALC_CATEGORIES.find((c) => c.id === category);

  return (
    <div data-testid="tool" class="tool calc-tool">
      <nav class="calc-nav" aria-label={`${categoryInfo?.name ?? ''} calculators`}>
        <input
          class="input"
          type="search"
          placeholder="Search all calculators"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          aria-label="Search all calculators"
          data-testid="calc-search"
        />
        <ul class="calc-list">
          {(hits ?? list).map((c) => (
            <li key={c.id}>
              <button type="button" class={c.id === calc.id ? 'is-active' : ''} aria-current={c.id === calc.id ? 'true' : undefined} onClick={() => select(c.id)}>
                <span>{c.name}</span>
                {hits && c.category !== category && <span class="calc-list-category">{CALC_CATEGORIES.find((x) => x.id === c.category)?.name}</span>}
              </button>
            </li>
          ))}
          {hits && hits.length === 0 && <li class="tone-muted calc-empty">No calculator matches.</li>}
        </ul>
        <label class="calc-currency-pick">
          <span>Currency</span>
          <select class="input" value={settings.currency} onChange={(e) => setSettings((s) => ({ ...s, currency: e.currentTarget.value }))}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c || 'None'}
              </option>
            ))}
          </select>
        </label>
      </nav>
      {error ? (
        <p class="recipe-error">{error}</p>
      ) : math ? (
        <CalculatorView
          key={calc.id}
          calc={calc}
          state={state}
          math={math}
          currency={settings.currency}
          setState={(next) => setSettings((s) => ({ ...s, states: { ...s.states, [calc.id]: next } }))}
          kept={settings.history[calc.id] ?? []}
          onKeep={(entry) =>
            setSettings((s) => {
              const list = s.history[calc.id] ?? [];
              // The same values kept twice in a row become one entry, moved to the top.
              const rest = list.filter((k) => JSON.stringify(k.state) !== JSON.stringify(entry.state));
              return { ...s, history: { ...s.history, [calc.id]: [entry, ...rest].slice(0, MAX_KEPT) } };
            })
          }
          onForget={(at) => setSettings((s) => ({ ...s, history: { ...s.history, [calc.id]: (s.history[calc.id] ?? []).filter((k) => k.at !== at) } }))}
        />
      ) : (
        <p class="tool-loading">Loading…</p>
      )}
    </div>
  );
}

export default defineCustomTool(CalcLibrary);
