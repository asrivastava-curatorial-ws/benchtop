/**
 * Pieces shared by the step-by-step solvers (calculus, chemistry): typeset
 * maths with a cache, a graph with a pointer read-out, the list of worked
 * steps, a results table, and the solution saved as a page of its own.
 */
import { useMemo, useState } from 'preact/hooks';
import type { GraphOptions } from '../../lib/calculus';
import { escapeXml } from '../../lib/text';
import { scrollRegion } from '../../ui/a11y';

export interface Drawn {
  readonly svg: string;
  readonly depth: number;
  readonly error: boolean;
}
export type Render = (latex: string, display?: boolean) => Drawn;

type TexToSvg = typeof import('../../lib/tex')['texToSvg'];

/** A renderer with its own cache of formulas already drawn. */
export function makeRender(texToSvg: TexToSvg): Render {
  const drawn = new Map<string, Drawn>();
  return (latex, display = false) => {
    const key = `${display ? 'D' : 'i'}${latex}`;
    let out = drawn.get(key);
    if (!out) {
      const r = texToSvg(display ? latex : `\\displaystyle ${latex}`, { display, scale: display ? 19 : 16 });
      out = r.error ? { svg: escapeXml(latex), depth: 0, error: true } : { svg: r.svg, depth: r.depth, error: false };
      if (drawn.size > 2000) drawn.clear();
      drawn.set(key, out);
    }
    return out;
  };
}

export function Tex({ render, latex, display = false }: { render: Render; latex: string; display?: boolean }) {
  const r = render(latex, display);
  if (r.error) return <code class="cx-tex-error">{latex}</code>;
  return <span class={display ? 'cx-tex cx-tex-display' : 'cx-tex'} style={display ? undefined : { verticalAlign: `-${r.depth}px` }} dangerouslySetInnerHTML={{ __html: r.svg }} />;
}

export const fmt = (x: number) => (Number.isFinite(x) ? String(Number(x.toPrecision(8))) : Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞');

export interface GraphKit {
  readonly graphSvg: (o: GraphOptions) => string;
  readonly GRAPH_FRAME: { readonly width: number; readonly left: number; readonly right: number };
  readonly GRAPH_COLORS: readonly string[];
}

/** A line graph with a read-out of every line at the pointer. */
export function SolverGraph({ kit, options, test = 'cx-graph' }: { kit: GraphKit; options: GraphOptions; test?: string }) {
  const svg = useMemo(() => kit.graphSvg(options), [kit, options]);
  const [hover, setHover] = useState<{ x: number; left: number; top: number } | null>(null);
  const frame = kit.GRAPH_FRAME;
  const move = (event: PointerEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * frame.width;
    if (px < frame.left || px > frame.width - frame.right) {
      setHover(null);
      return;
    }
    const x = options.from + ((px - frame.left) / (frame.width - frame.left - frame.right)) * (options.to - options.from);
    setHover({ x, left: event.clientX - box.left, top: event.clientY - box.top });
  };
  return (
    <div class="cx-graph-wrap" onPointerMove={move} onPointerLeave={() => setHover(null)} data-testid={test}>
      <div class="cx-graph-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      {hover && (
        <div class="cx-tip" style={{ left: `${hover.left + 14}px`, top: `${Math.max(0, hover.top - 10)}px` }} role="status">
          <div class="cx-tip-x">
            {options.variable ?? 'x'} = {fmt(hover.x)}
          </div>
          {options.lines.map((line, k) => (
            <div key={line.label} class="cx-tip-row">
              <span class="cx-swatch" style={{ background: kit.GRAPH_COLORS[k % kit.GRAPH_COLORS.length] }} />
              <span class="cx-tip-label">{line.label}</span>
              <span class="cx-tip-value">{fmt(line.f(hover.x))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface SolverStep {
  readonly rule: string;
  readonly tex: string;
}

export function StepsList({ render, steps }: { render: Render; steps: readonly SolverStep[] }) {
  if (!steps.length) return null;
  return (
    <div class="cx-steps-wrap">
      <h3 class="cx-h">Steps</h3>
      <ol class="cx-steps" data-testid="cx-steps">
        {steps.map((st, i) => (
          <li key={i}>
            <div class="cx-rule">{st.rule}</div>
            {st.tex && (
              <div class="cx-step-math" {...scrollRegion(st.rule)}>
                <Tex render={render} latex={st.tex} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface SolverTable {
  readonly head: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export function ResultTable({ table, label, test = 'cx-table' }: { table: SolverTable; label: string; test?: string }) {
  return (
    <div class="cx-scroll" {...scrollRegion(label)}>
      <table class="data-table cx-table" data-testid={test}>
        <thead>
          <tr>
            {table.head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A solution as a page of its own: maths as inline SVG, no scripts. */
export function solutionHtml(o: {
  readonly title: string;
  readonly question?: string;
  readonly answerTex?: string;
  readonly notes?: readonly string[];
  readonly steps?: readonly SolverStep[];
  readonly table?: SolverTable;
  readonly graph?: string;
  readonly render: Render;
  readonly tool: string;
}): string {
  const math = (latex: string, display = false) => {
    const r = o.render(latex, display);
    return r.error ? `<code>${escapeXml(latex)}</code>` : display ? `<div class="m">${r.svg}</div>` : `<span style="vertical-align:-${r.depth}px">${r.svg}</span>`;
  };
  const parts: string[] = [`<h1>${escapeXml(o.title)}</h1>`];
  if (o.question) parts.push(`<p class="q">${escapeXml(o.question)}</p>`);
  if (o.answerTex) parts.push(math(o.answerTex, true));
  for (const n of o.notes ?? []) if (n) parts.push(`<p class="note">${escapeXml(n)}</p>`);
  if (o.table)
    parts.push(
      `<table><thead><tr>${o.table.head.map((h) => `<th>${escapeXml(h)}</th>`).join('')}</tr></thead><tbody>${o.table.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeXml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
    );
  if (o.steps?.length) parts.push(`<h2>Steps</h2><ol>${o.steps.map((st) => `<li><div class="rule">${escapeXml(st.rule)}</div>${st.tex ? math(st.tex) : ''}</li>`).join('')}</ol>`);
  if (o.graph) parts.push(`<figure>${o.graph}</figure>`);
  const css =
    'body{font:15px/1.5 system-ui,sans-serif;color:#19222a;max-width:820px;margin:32px auto;padding:0 20px}h1{font-size:22px;margin:0 0 8px}h2{font-size:16px;margin:24px 0 8px}code{font:13px ui-monospace,monospace;background:#f1f3f5;padding:1px 4px;border-radius:3px}.m{margin:14px 0;overflow-x:auto}.note{color:#55626d}ol{padding-left:22px}li{margin:0 0 12px}.rule{color:#55626d;font-size:13.5px;margin-bottom:2px}li svg{max-width:100%}table{border-collapse:collapse;margin:12px 0}th,td{border:1px solid #d8dee3;padding:4px 10px;text-align:right;font-variant-numeric:tabular-nums}th{background:#f6f8f9}td:first-child{text-align:left}figure{margin:20px 0}figure svg{width:100%;height:auto}.cx-bg{fill:#fff}.cx-grid{stroke:#e6eaed;stroke-width:1}.cx-axis{stroke:#9aa5ae;stroke-width:1}.cx-tick,.cx-label{fill:#55626d}.cx-area{fill:#0072B2;fill-opacity:.14}.cx-rect{fill:#E69F00;fill-opacity:.22;stroke:#E69F00;stroke-width:1}.cx-point{fill:#19222a;stroke:#fff;stroke-width:2}@media print{body{margin:0}}';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeXml(o.title)}</title><style>${css}</style></head><body>${parts.join('\n')}<p class="note">Made with Benchtop’s ${escapeXml(o.tool)}.</p></body></html>`;
}

/** A labelled text box for a solver's inputs. */
export function SolverField({
  label,
  value,
  onInput,
  test,
  wide,
  hint,
  mono = true,
}: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  test?: string;
  wide?: boolean;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <label class={`cx-field${wide ? ' cx-wide' : ''}`}>
      <span class="control-label">{label}</span>
      <input
        class={`input${mono ? ' cx-input' : ''}`}
        value={value}
        spellcheck={false}
        autocomplete="off"
        onInput={(ev) => onInput(ev.currentTarget.value)}
        data-testid={test}
        title={hint}
        placeholder={hint}
      />
    </label>
  );
}
