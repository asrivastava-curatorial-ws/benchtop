/**
 * Karnaugh map solver: 2 to 6 variables, cells clicked through 0, 1 and
 * don't-care or filled from minterms or an expression; the exact minimal
 * sum-of-products and product-of-sums with their groups drawn on the map.
 */
import { useMemo } from 'preact/hooks';
import { type Cell, type Cover, cellOf, expressionText, type Form, gray, layout, minimise, mintermAt, mintermsOf, parseExpression, parseList, runs, termText } from '../../lib/kmap';
import { CHART_COLORS } from '../../lib/svg-chart';
import { copyText } from '../../platform';
import { notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

type Mode = 'map' | 'list' | 'expr';
type Style = 'math' | 'c' | 'verilog';

interface KState {
  readonly vars: number;
  readonly names: string;
  readonly cells: string;
  readonly mode: Mode;
  readonly ones: string;
  readonly dcs: string;
  readonly expr: string;
  readonly show: Form;
  readonly style: Style;
}

const DEFAULT_NAMES = 'A B C D E F';
const START = '0011' + '0101' + '1101' + '1x00';

const read = (v: Values | undefined): KState => {
  const vars = typeof v?.vars === 'number' && v.vars >= 2 && v.vars <= 6 ? v.vars : 4;
  const cells = typeof v?.cells === 'string' && /^[01x]*$/.test(v.cells) ? v.cells : START;
  return {
    vars,
    names: typeof v?.names === 'string' ? v.names : DEFAULT_NAMES,
    cells: cells.padEnd(1 << vars, '0').slice(0, 1 << vars),
    mode: v?.mode === 'list' || v?.mode === 'expr' ? v.mode : 'map',
    ones: typeof v?.ones === 'string' ? v.ones : '2, 3, 5, 7, 8, 9, 11, 12',
    dcs: typeof v?.dcs === 'string' ? v.dcs : '13',
    expr: typeof v?.expr === 'string' ? v.expr : "A'B'C + A'BD + AB'C' + ABC'D'",
    show: v?.show === 'pos' ? 'pos' : 'sop',
    style: v?.style === 'c' || v?.style === 'verilog' ? v.style : 'math',
  };
};
const write = (s: KState): Values => ({ ...s });

const toCells = (text: string): Cell[] => [...text].map((c) => (c === '1' ? 1 : c === 'x' ? 'x' : 0));
const cellChar = (c: Cell) => (c === 'x' ? 'x' : String(c));
const SIZE = 46;

function namesFor(text: string, vars: number): string[] {
  const given = text.split(/[\s,]+/).filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
  const fallback = DEFAULT_NAMES.split(' ');
  return Array.from({ length: vars }, (_, i) => given[i] ?? fallback[i] ?? `x${i}`);
}

/** The cells, from the chosen input, or the reason they could not be worked out. */
function cellsFrom(s: KState, names: readonly string[]): { cells: Cell[]; error?: string } {
  const n = 1 << s.vars;
  if (s.mode === 'map') return { cells: toCells(s.cells) };
  try {
    if (s.mode === 'list') {
      const ones = parseList(s.ones, s.vars);
      const dcs = parseList(s.dcs, s.vars);
      return { cells: Array.from({ length: n }, (_, m): Cell => (dcs.includes(m) ? 'x' : ones.includes(m) ? 1 : 0)) };
    }
    return { cells: parseExpression(s.expr, names).map((b): Cell => (b ? 1 : 0)) };
  } catch (error) {
    return { cells: Array.from({ length: n }, (): Cell => 0), error: error instanceof Error ? error.message : String(error) };
  }
}

function Karnaugh({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const set = (patch: Partial<KState>) => setState((p) => ({ ...p, ...patch }));
  const names = useMemo(() => namesFor(s.names, s.vars), [s.names, s.vars]);
  const { cells, error } = useMemo(() => cellsFrom(s, names), [s, names]);
  const result = useMemo(() => minimise(s.vars, cells), [s.vars, cells]);
  const cover: Cover = s.show === 'sop' ? result.sop : result.pos;
  const shape = layout(s.vars);
  const rows = 1 << shape.rowBits;
  const cols = 1 << shape.colBits;
  const maps = 1 << shape.mapBits;
  const rowNames = names.slice(shape.mapBits, shape.mapBits + shape.rowBits).join('');
  const colNames = names.slice(shape.mapBits + shape.rowBits).join('');
  const bits = (v: number, width: number) => v.toString(2).padStart(width, '0');

  const toggle = (m: number) => {
    const next = [...cells];
    const c = next[m];
    next[m] = c === 0 ? 1 : c === 1 ? 'x' : 0;
    set({ mode: 'map', cells: next.map(cellChar).join('') });
  };
  const fill = (c: Cell) => set({ mode: 'map', cells: cellChar(c).repeat(1 << s.vars) });
  const setVars = (vars: number) => {
    const text = cells.map(cellChar).join('');
    set({ vars, cells: text.padEnd(1 << vars, '0').slice(0, 1 << vars), mode: s.mode === 'expr' ? 'map' : s.mode });
  };

  const sop = expressionText(result.sop.terms, names, 'sop', s.style);
  const pos = expressionText(result.pos.terms, names, 'pos', s.style);
  const ones = cells.flatMap((c, m) => (c === 1 ? [m] : []));
  const dcs = cells.flatMap((c, m) => (c === 'x' ? [m] : []));
  const copy = (text: string) => void copyText(text).then(() => notify('Copied'));

  return (
    <section class="tool km-tool" data-testid="tool" data-state={error ? 'error' : 'done'}>
      <div class="km-controls">
        <Segmented label="Variables" value={String(s.vars)} choices={[2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} variables` }))} onChange={(v) => setVars(Number(v))} />
        <label class="km-names">
          Names
          <input class="input" value={s.names} spellcheck={false} onInput={(e) => set({ names: e.currentTarget.value })} aria-label="Variable names, most significant first" data-testid="km-names" />
        </label>
        <Segmented
          label="Enter the function as"
          value={s.mode}
          choices={[
            { value: 'map', label: 'Click the map' },
            { value: 'list', label: 'Minterms' },
            { value: 'expr', label: 'Expression' },
          ]}
          onChange={(mode) => set(mode === 'map' ? { mode, cells: cells.map(cellChar).join('') } : { mode })}
        />
      </div>
      {s.mode === 'list' && (
        <div class="km-inputs">
          <label>
            Minterms (outputs 1)
            <input class="input" value={s.ones} onInput={(e) => set({ ones: e.currentTarget.value })} placeholder="1, 3, 5-7" data-testid="km-ones" />
          </label>
          <label>
            Don’t cares
            <input class="input" value={s.dcs} onInput={(e) => set({ dcs: e.currentTarget.value })} placeholder="0, 2" data-testid="km-dcs" />
          </label>
        </div>
      )}
      {s.mode === 'expr' && (
        <div class="km-inputs">
          <label class="km-wide">
            Expression
            <input class="input" value={s.expr} spellcheck={false} onInput={(e) => set({ expr: e.currentTarget.value })} placeholder="A'B + AC" data-testid="km-expr" />
          </label>
          <p class="lab-note">NOT: A′, A', !A or ~A. AND: AB, A·B, A*B or A&amp;B. OR: + or |. XOR: ^ or ⊕.</p>
        </div>
      )}
      {error && (
        <p class="recipe-error" role="alert" data-testid="km-error">
          {error}
        </p>
      )}
      {s.mode === 'map' && (
        <div class="button-row">
          <button type="button" class="button button-small" onClick={() => fill(0)}>
            All 0
          </button>
          <button type="button" class="button button-small" onClick={() => fill(1)}>
            All 1
          </button>
          <span class="lab-note">Click a cell to change it: 0, 1, then X (don’t care).</span>
        </div>
      )}
      <div class="km-maps">
        {Array.from({ length: maps }, (_, map) => {
          const W = SIZE * (cols + 1) + 8;
          const H = SIZE * (rows + 1) + 8;
          return (
            <figure key={map} class="km-map">
              {maps > 1 && <figcaption>{`${names.slice(0, shape.mapBits).join('')} = ${bits(map, shape.mapBits)}`}</figcaption>}
              <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="group" aria-label={`Karnaugh map${maps > 1 ? ` ${map + 1}` : ''}`} data-testid={`km-map-${map}`}>
                <line class="km-corner" x1={0} y1={0} x2={SIZE} y2={SIZE} />
                <text class="km-head" x={SIZE - 4} y={14} text-anchor="end">
                  {colNames}
                </text>
                <text class="km-head" x={4} y={SIZE - 6}>
                  {rowNames}
                </text>
                {gray(shape.colBits).map((code, c) => (
                  <text key={`c${code}`} class="km-head" x={SIZE * (c + 1) + SIZE / 2} y={SIZE - 8} text-anchor="middle">
                    {bits(code, shape.colBits)}
                  </text>
                ))}
                {gray(shape.rowBits).map((code, r) => (
                  <text key={`r${code}`} class="km-head" x={SIZE - 8} y={SIZE * (r + 1) + SIZE / 2 + 4} text-anchor="end">
                    {bits(code, shape.rowBits)}
                  </text>
                ))}
                {Array.from({ length: rows * cols }, (_, i) => {
                  const r = Math.floor(i / cols);
                  const c = i % cols;
                  const m = mintermAt(s.vars, map, r, c);
                  const value = cells[m] ?? 0;
                  return (
                    <g
                      key={m}
                      class={`km-cell km-cell-${cellChar(value)}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggle(m)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle(m);
                        }
                      }}
                      data-testid={`km-cell-${m}`}
                    >
                      {/* The cell's name, read out and shown on hover; its visible text (the value, then the minterm) follows. */}
                      <title>{`Minterm ${m}: ${value === 'x' ? 'don’t care' : value}`}</title>
                      <rect x={SIZE * (c + 1)} y={SIZE * (r + 1)} width={SIZE} height={SIZE} />
                      <text class="km-value" x={SIZE * (c + 1) + SIZE / 2} y={SIZE * (r + 1) + SIZE / 2 + 6} text-anchor="middle">
                        {value === 'x' ? 'X' : value}
                      </text>
                      <text class="km-index" x={SIZE * (c + 1) + 4} y={SIZE * (r + 1) + 11}>
                        {m}
                      </text>
                    </g>
                  );
                })}
                {cover.terms.map((term, t) => {
                  const inMap = mintermsOf(term, s.vars)
                    .map((m) => cellOf(s.vars, m))
                    .filter((p) => p.map === map);
                  if (!inMap.length) return null;
                  const color = CHART_COLORS[t % CHART_COLORS.length];
                  const inset = 3 + (t % 4) * 2.5;
                  return runs(
                    inMap.map((p) => p.row),
                    rows,
                  ).flatMap(([r0, r1]) =>
                    runs(
                      inMap.map((p) => p.col),
                      cols,
                    ).map(([c0, c1]) => (
                      <rect
                        key={`${t}-${r0}-${c0}`}
                        class="km-group"
                        x={SIZE * (c0 + 1) + inset}
                        y={SIZE * (r0 + 1) + inset}
                        width={SIZE * (c1 - c0 + 1) - 2 * inset}
                        height={SIZE * (r1 - r0 + 1) - 2 * inset}
                        rx={12}
                        stroke={color}
                        fill={color}
                      />
                    )),
                  );
                })}
              </svg>
            </figure>
          );
        })}
      </div>
      <div class="km-results">
        <div class="button-row">
          <Segmented
            label="Groups to draw"
            value={s.show}
            choices={[
              { value: 'sop', label: 'Groups of 1s (SOP)' },
              { value: 'pos', label: 'Groups of 0s (POS)' },
            ]}
            onChange={(show) => set({ show })}
          />
          <Segmented
            label="Write for"
            value={s.style}
            choices={[
              { value: 'math', label: 'Maths' },
              { value: 'c', label: 'C' },
              { value: 'verilog', label: 'Verilog' },
            ]}
            onChange={(style) => set({ style })}
          />
        </div>
        <div class="km-answer">
          <span class="km-label">Minimal sum of products</span>
          <code data-testid="km-sop">F = {sop}</code>
          <button type="button" class="button button-small" onClick={() => copy(s.style === 'verilog' ? `assign F = ${sop};` : sop)}>
            Copy
          </button>
        </div>
        <div class="km-answer">
          <span class="km-label">Minimal product of sums</span>
          <code data-testid="km-pos">F = {pos}</code>
          <button type="button" class="button button-small" onClick={() => copy(s.style === 'verilog' ? `assign F = ${pos};` : pos)}>
            Copy
          </button>
        </div>
        <p class="lab-note" data-testid="km-summary">
          F = Σm({ones.join(', ') || '—'}){dcs.length ? ` + d(${dcs.join(', ')})` : ''}. {cover.primes.length} prime implicants, {cover.essential.length} essential.
          {cover.alternatives > 1 ? ` ${cover.alternatives} covers are equally small; this is one of them.` : ''}
          {cover.exact ? '' : ' The function is large, so the cover is a good one rather than a proven smallest.'}
        </p>
        <ul class="km-terms" data-testid="km-terms">
          {cover.terms.map((t, i) => (
            <li key={`${t.mask}:${t.value}`}>
              <i style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
              <code>{termText(t, names, s.show, 'math')}</code>
              <span class="tone-muted">
                {' '}
                covers {mintermsOf(t, s.vars).join(', ')}
                {cover.essential.includes(t) ? ' (essential)' : ''}
              </span>
            </li>
          ))}
        </ul>
        <details class="km-truth">
          <summary>Truth table</summary>
          <table class="lab-table">
            <thead>
              <tr>
                <th>m</th>
                {names.map((n) => (
                  <th key={n}>{n}</th>
                ))}
                <th>F</th>
              </tr>
            </thead>
            <tbody>
              {cells.map((c, m) => (
                <tr key={m}>
                  <td>{m}</td>
                  {[...bits(m, s.vars)].map((b, i) => (
                    <td key={i}>{b}</td>
                  ))}
                  <td>{c === 'x' ? 'X' : c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}

export default defineCustomTool(Karnaugh);
