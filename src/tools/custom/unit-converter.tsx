/**
 * Unit converter for every trade and science: pick a quantity, type in either
 * box, and see the value in every unit of that quantity.  A question box reads
 * "5 bigha (UP) in acres" style requests.
 */
import { useMemo, useState } from 'preact/hooks';
import {
  convertValue,
  defaultPair,
  findCategory,
  findUnit,
  formatValue,
  GROUPS,
  type Grouping,
  parseQuery,
  plainValue,
  readNumber,
  type SearchHit,
  searchUnits,
  UNIT_CATEGORIES,
  type UnitCategory,
  type UnitDef,
  unitRatio,
} from '../../lib/units';
import { copyText } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { type SegmentChoice, Segmented, usePersistentState } from './_shared';

type Side = 'from' | 'to';

interface State {
  readonly category: string;
  readonly from: string;
  readonly to: string;
  /** What the person typed, and in which box. */
  readonly text: string;
  readonly side: Side;
  readonly digits: number;
  readonly grouping: Grouping;
  /** The last two units used in each quantity, so coming back to one restores them. */
  readonly pairs: Readonly<Record<string, readonly [string, string]>>;
}

const DIGITS = [3, 4, 5, 6, 7, 8, 9, 10, 12, 15] as const;

const GROUPINGS: readonly SegmentChoice<Grouping>[] = [
  { value: 'international', label: '1,234,567' },
  { value: 'indian', label: '12,34,567' },
  { value: 'none', label: '1234567' },
];

const TOTAL_UNITS = UNIT_CATEGORIES.reduce((sum, category) => sum + category.units.length, 0);

function initialState(): State {
  const category = findCategory('length') as UnitCategory;
  const [from, to] = defaultPair(category);
  return { category: category.id, from: from.id, to: to.id, text: '1', side: 'from', digits: 8, grouping: 'international', pairs: {} };
}

function readState(stored: Values | undefined): State {
  const state = initialState();
  if (!stored) return state;
  const pairs: Record<string, readonly [string, string]> = {};
  if (stored.pairs && typeof stored.pairs === 'object') {
    for (const [id, pair] of Object.entries(stored.pairs as Record<string, unknown>)) {
      const category = findCategory(id);
      if (category && Array.isArray(pair) && pair.length === 2 && pair.every((unit) => typeof unit === 'string' && findUnit(category, unit))) pairs[id] = [pair[0], pair[1]];
    }
  }
  const category = typeof stored.category === 'string' ? findCategory(stored.category) : undefined;
  const from = category && typeof stored.from === 'string' ? findUnit(category, stored.from) : undefined;
  const to = category && typeof stored.to === 'string' ? findUnit(category, stored.to) : undefined;
  const digits = DIGITS.find((d) => d === stored.digits) ?? state.digits;
  const grouping = GROUPINGS.find((g) => g.value === stored.grouping)?.value ?? state.grouping;
  const text = typeof stored.text === 'string' ? stored.text.slice(0, 80) : state.text;
  const side: Side = stored.side === 'to' ? 'to' : 'from';
  if (!category || !from || !to) return { ...state, digits, grouping, pairs };
  return { category: category.id, from: from.id, to: to.id, text, side, digits, grouping, pairs };
}

const writeState = (state: State): Values => ({ ...state });

/** Move to a quantity, on the units asked for or the ones used there last. */
function enter(state: State, category: UnitCategory, wanted: { from?: UnitDef; to?: UnitDef } = {}): State {
  const remembered = state.pairs[category.id];
  const [first, second] = defaultPair(category);
  const pick = (id: string | undefined) => (id ? findUnit(category, id) : undefined);
  const from = wanted.from ?? pick(remembered?.[0]) ?? first;
  let to = wanted.to ?? pick(remembered?.[1]) ?? second;
  if (to === from && !wanted.to) to = from === first ? second : first;
  return { ...state, category: category.id, from: from.id, to: to.id, side: 'from', pairs: { ...state.pairs, [category.id]: [from.id, to.id] } };
}

/** "square foot (ft²)", but just "acre" or "bigha (Uttar Pradesh, 27,000 ft²)" when the symbol only repeats a word of the name. */
function optionLabel(unit: UnitDef): string {
  const word = /^[a-z]{3,}/i.exec(unit.symbol)?.[0]?.toLowerCase();
  return word &&
    unit.name
      .toLowerCase()
      .split(/[^a-z]+/)
      .includes(word)
    ? unit.name
    : `${unit.name} (${unit.symbol})`;
}

/** "5 bigha (UP)", "1,234.5 ft²": a value with its unit's symbol. */
const amount = (value: number, unit: UnitDef, digits: number, grouping: Grouping) => `${formatValue(value, digits, grouping)} ${unit.symbol}`;

function UnitConverter({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readState, writeState);
  const [search, setSearch] = useState('');
  const [question, setQuestion] = useState('');
  const [filter, setFilter] = useState('');

  const category = findCategory(state.category) as UnitCategory;
  const from = findUnit(category, state.from) as UnitDef;
  const to = findUnit(category, state.to) as UnitDef;
  const { digits, grouping } = state;

  const typed = readNumber(state.text);
  const fromValue = typed === null ? null : state.side === 'from' ? typed : convertValue(typed, to, from);
  const toValue = typed === null ? null : state.side === 'to' ? typed : convertValue(typed, from, to);
  const shown = (side: Side, value: number | null) => (state.side === side ? state.text : value === null ? '' : plainValue(value, digits));
  const ratio = unitRatio(from, to);

  const hits = useMemo(() => (search.trim() ? searchUnits(search, 60) : null), [search]);

  const answer = useMemo(() => {
    if (!question.trim()) return null;
    const parsed = parseQuery(question);
    if ('error' in parsed) return parsed;
    const [first, second] = defaultPair(parsed.category);
    const target = parsed.to ?? (second !== parsed.from ? second : first);
    return { ...parsed, to: target, result: convertValue(parsed.value, parsed.from, target) };
  }, [question]);

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return category.units.filter((unit) => !needle || [unit.name, unit.symbol, unit.note ?? '', ...(unit.aliases ?? [])].some((text) => text.toLowerCase().includes(needle)));
  }, [category, filter]);

  const copy = (text: string, what = text) =>
    attempt(async () => {
      await copyText(text);
      notify(`Copied ${what}`);
    });

  const setUnit = (side: Side, unit: UnitDef) =>
    setState((s) => {
      const next = side === 'from' ? { from: unit.id, to: s.to } : { from: s.from, to: unit.id };
      return { ...s, ...next, pairs: { ...s.pairs, [s.category]: [next.from, next.to] } };
    });

  const swap = () =>
    setState((s) => ({
      ...s,
      from: s.to,
      to: s.from,
      // The number on the left stays on the left.
      text: s.side === 'from' ? s.text : fromValue === null ? s.text : plainValue(fromValue, s.digits),
      side: 'from',
      pairs: { ...s.pairs, [s.category]: [s.to, s.from] },
    }));

  const openHit = (hit: SearchHit) => setState((s) => enter(s, hit.category, hit.unit ? { from: hit.unit } : {}));

  const applyQuestion = () => {
    if (!answer || 'error' in answer) return;
    setState((s) => ({ ...enter(s, answer.category, { from: answer.from, to: answer.to }), text: String(answer.value), side: 'from' }));
    setFilter('');
  };

  const line = fromValue === null || toValue === null ? '' : `${amount(fromValue, from, digits, grouping)} = ${amount(toValue, to, digits, grouping)}`;
  const notes = [from, to].filter((unit, i, list) => unit.note && list.indexOf(unit) === i);

  const copyTable = () => {
    if (fromValue === null) return;
    const lines = ['Unit\tSymbol\tValue', ...rows.map((unit) => `${unit.name}\t${unit.symbol}\t${plainValue(convertValue(fromValue, from, unit), digits)}`)];
    copy(lines.join('\n'), `${rows.length} rows`);
  };

  return (
    <section class="tool uc-tool" data-testid="tool" data-state={typed === null && state.text.trim() ? 'idle' : 'done'}>
      <nav class="uc-nav" aria-label="Quantities">
        <input
          class="input"
          type="search"
          placeholder="Find a quantity or unit"
          aria-label="Find a quantity or unit"
          value={search}
          onInput={(e) => setSearch(e.currentTarget.value)}
          data-testid="uc-search"
        />
        <ul class="uc-list" data-testid="uc-list">
          {hits
            ? hits.map((hit) => (
                <li key={`${hit.category.id}/${hit.unit?.id ?? ''}`}>
                  <button type="button" class={hit.category === category && (!hit.unit || hit.unit === from) ? 'is-active' : ''} onClick={() => openHit(hit)}>
                    <span>{hit.unit ? hit.unit.name : hit.category.name}</span>
                    <span class="uc-hit-meta">{hit.unit ? `${hit.unit.symbol} in ${hit.category.name}` : (GROUPS.find((g) => g.id === hit.category.group)?.name ?? '')}</span>
                  </button>
                </li>
              ))
            : GROUPS.map((group) => (
                <li key={group.id}>
                  <span class="uc-group" id={`uc-group-${group.id}`}>
                    {group.name}
                  </span>
                  <ul aria-labelledby={`uc-group-${group.id}`}>
                    {UNIT_CATEGORIES.filter((c) => c.group === group.id).map((c) => (
                      <li key={c.id}>
                        <button type="button" class={c === category ? 'is-active' : ''} aria-current={c === category ? 'true' : undefined} onClick={() => setState((s) => enter(s, c))}>
                          {c.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          {hits && hits.length === 0 && <li class="tone-muted uc-empty">Nothing matches “{search.trim()}”.</li>}
        </ul>
        <p class="uc-count">
          {UNIT_CATEGORIES.length} quantities, {TOTAL_UNITS.toLocaleString('en-US')} units
        </p>
      </nav>

      <div class="uc-main">
        <div class="uc-ask">
          <label class="control-label" for="uc-question">
            Ask
          </label>
          <div class="uc-ask-row">
            <input
              id="uc-question"
              class="input"
              type="text"
              spellcheck={false}
              autocomplete="off"
              placeholder="5 bigha (UP) in acres"
              value={question}
              onInput={(e) => setQuestion(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyQuestion();
              }}
              data-testid="uc-ask"
            />
            <button type="button" class="button" disabled={!answer || 'error' in answer} onClick={applyQuestion} data-testid="uc-ask-open">
              Open below
            </button>
          </div>
          <p class="uc-ask-answer" aria-live="polite" data-testid="uc-ask-answer">
            {!answer ? (
              <span class="tone-muted">Type a number and units, such as “98.6 F in C”, “2 lakh sq ft to acres”, “5.4 mmol/L glucose in mg/dL” or “12 psi”.</span>
            ) : 'error' in answer ? (
              <span class="tone-muted">{answer.error}</span>
            ) : (
              <>
                <span>{amount(answer.value, answer.from, digits, grouping)} =</span> <strong>{amount(answer.result, answer.to, digits, grouping)}</strong>{' '}
                <span class="uc-ask-kind">{answer.category.name}</span>
              </>
            )}
          </p>
        </div>

        <article class="uc-card" aria-labelledby="uc-title">
          <header class="uc-head">
            <h2 id="uc-title">{category.name}</h2>
            <p>{category.description}</p>
          </header>

          <div class="uc-convert">
            <div class="uc-side">
              <label class="control-label" for="uc-from-value">
                From
              </label>
              <input
                id="uc-from-value"
                class={`input uc-value${state.side === 'from' && typed === null && state.text.trim() ? ' is-invalid' : ''}`}
                type="text"
                inputMode="decimal"
                spellcheck={false}
                autocomplete="off"
                value={shown('from', fromValue)}
                onInput={(e) => setState((s) => ({ ...s, text: e.currentTarget.value, side: 'from' }))}
                data-testid="uc-from-value"
              />
              <select class="input" aria-label="From unit" value={from.id} onChange={(e) => setUnit('from', findUnit(category, e.currentTarget.value) as UnitDef)} data-testid="uc-from-unit">
                {category.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {optionLabel(unit)}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" class="icon-button uc-swap" aria-label="Swap units" title="Swap units" onClick={swap} data-testid="uc-swap">
              <Icon name="swap" />
            </button>
            <div class="uc-side">
              <label class="control-label" for="uc-to-value">
                To
              </label>
              <input
                id="uc-to-value"
                class={`input uc-value${state.side === 'to' && typed === null && state.text.trim() ? ' is-invalid' : ''}`}
                type="text"
                inputMode="decimal"
                spellcheck={false}
                autocomplete="off"
                value={shown('to', toValue)}
                onInput={(e) => setState((s) => ({ ...s, text: e.currentTarget.value, side: 'to' }))}
                data-testid="uc-to-value"
              />
              <select class="input" aria-label="To unit" value={to.id} onChange={(e) => setUnit('to', findUnit(category, e.currentTarget.value) as UnitDef)} data-testid="uc-to-unit">
                {category.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {optionLabel(unit)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div class="uc-result-row">
            <output class="uc-result" for="uc-from-value uc-to-value" data-testid="uc-result">
              {line || (state.text.trim() ? 'Type a number such as 12.5, 1,00,000, 3 1/2 or 6.02e23.' : 'Type a number in either box.')}
            </output>
            <div class="button-row">
              <button type="button" class="button button-small" disabled={toValue === null} onClick={() => toValue !== null && copy(plainValue(toValue, digits))} data-testid="uc-copy">
                <Icon name="copy" size={14} /> Copy value
              </button>
              <button type="button" class="button button-small button-quiet" disabled={!line} onClick={() => copy(line)}>
                Copy line
              </button>
            </div>
          </div>

          {ratio !== null && from !== to && (
            <p class="uc-ratio" data-testid="uc-ratio">
              <span>
                1 {from.symbol} = {formatValue(ratio, digits, grouping)} {to.symbol}
              </span>
              <span>
                1 {to.symbol} = {formatValue(1 / ratio, digits, grouping)} {from.symbol}
              </span>
            </p>
          )}

          {(notes.length > 0 || category.note) && (
            <div class="uc-notes">
              {notes.map((unit) => (
                <p key={unit.id}>
                  <strong>{unit.name}:</strong> {unit.note}
                </p>
              ))}
              {category.note && <p>{category.note}</p>}
            </div>
          )}

          <div class="uc-options">
            <label class="control">
              <span class="control-label">Significant figures</span>
              <select class="input" value={String(digits)} onChange={(e) => setState((s) => ({ ...s, digits: Number(e.currentTarget.value) }))} data-testid="uc-digits">
                {DIGITS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <div class="control">
              <span class="control-label">Digit grouping</span>
              <Segmented label="Digit grouping" value={grouping} choices={GROUPINGS} onChange={(value) => setState((s) => ({ ...s, grouping: value }))} />
            </div>
          </div>
        </article>

        <section class="uc-all" aria-labelledby="uc-all-title">
          <header class="uc-all-head">
            <h3 id="uc-all-title">{fromValue === null ? `Every unit of ${category.name.toLowerCase()}` : `${amount(fromValue, from, digits, grouping)} in every unit`}</h3>
            <input class="input" type="search" placeholder="Filter units" aria-label="Filter units" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} data-testid="uc-filter" />
            <button
              type="button"
              class="button button-small button-quiet"
              disabled={fromValue === null || rows.length === 0}
              onClick={copyTable}
              title="Copy the table as tab-separated text for a spreadsheet"
            >
              Copy table
            </button>
          </header>
          <div class="ref-table-wrap uc-table-wrap" {...scrollRegion(`${category.name} units`)}>
            <table class="ref-table uc-table" data-testid="uc-table">
              <thead>
                <tr>
                  <th scope="col">Unit</th>
                  <th scope="col">Symbol</th>
                  <th scope="col" class="uc-num">
                    Value
                  </th>
                  <th scope="col">
                    <span class="visually-hidden">Copy</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((unit) => {
                  const value = fromValue === null ? null : convertValue(fromValue, from, unit);
                  return (
                    <tr key={unit.id} class={unit === to ? 'is-to' : unit === from ? 'is-from' : undefined}>
                      <th scope="row">
                        <button type="button" class="uc-pick" onClick={() => setUnit('to', unit)} title="Convert to this unit">
                          {unit.name}
                        </button>
                        {unit.note && <span class="uc-row-note">{unit.note}</span>}
                      </th>
                      <td class="mono">{unit.symbol}</td>
                      <td class="uc-num">{value === null ? '' : formatValue(value, digits, grouping)}</td>
                      <td>
                        <button
                          type="button"
                          class="icon-button"
                          aria-label={`Copy value in ${unit.name}`}
                          title="Copy"
                          disabled={value === null || !Number.isFinite(value)}
                          onClick={() => value !== null && copy(plainValue(value, digits))}
                        >
                          <Icon name="copy" size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p class="control-help ref-empty">
                No unit of {category.name.toLowerCase()} matches “{filter.trim()}”.
              </p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

export default defineCustomTool(UnitConverter);
