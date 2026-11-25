/**
 * Calcpad Worksheet: write engineering calculations as plain text (headings,
 * notes, formulas with units) and read them back as a typeset report, every
 * formula shown with its values put in and its result.  Input boxes in the
 * report make a worksheet a form that others can fill in.
 */
import { StreamLanguage } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import type { MathJsInstance } from 'mathjs';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Block, CALCPAD_EXAMPLES, calculate, DEFAULT_SETTINGS, inlineHtml, type Mode, type RenderedTex, type Report, reportHtml, reportTitle, setInput } from '../../lib/calcpad';
import { htmlToPdf, isDesktop, pickFile, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { printDocument } from '../../ui/print';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

type Layout = 'split' | 'report';

interface WorksheetState {
  readonly source: string;
  readonly decimals: number;
  readonly degrees: boolean;
  readonly mode: Mode;
  readonly layout: Layout;
}

const FIRST = CALCPAD_EXAMPLES[0]?.source ?? '';
const read = (v: Values | undefined): WorksheetState => ({
  source: typeof v?.source === 'string' ? v.source : FIRST,
  decimals: typeof v?.decimals === 'number' && Number.isInteger(v.decimals) && v.decimals >= 0 && v.decimals <= 15 ? v.decimals : DEFAULT_SETTINGS.decimals,
  degrees: v?.degrees !== false,
  mode: v?.mode === 'noc' || v?.mode === 'val' ? v.mode : 'equ',
  layout: v?.layout === 'report' ? 'report' : 'split',
});
const write = (s: WorksheetState): Values => ({ source: s.source.length > 500_000 ? '' : s.source, decimals: s.decimals, degrees: s.degrees, mode: s.mode, layout: s.layout });

/* ------------------------------------------------------------- loading -- */

let mathModule: Promise<MathJsInstance> | null = null;
const loadMath = () => {
  mathModule ??= import('mathjs').then(({ all, create }) => create(all, { number: 'number' }));
  return mathModule;
};
let texModule: Promise<typeof import('../../lib/tex')> | null = null;
const loadTex = () => {
  texModule ??= import('../../lib/tex');
  return texModule;
};

type TexToSvg = typeof import('../../lib/tex')['texToSvg'];

/** Formulas already drawn, so a recalculation redraws only what changed. */
const drawn = new Map<string, RenderedTex>();
function draw(texToSvg: TexToSvg, latex: string): RenderedTex {
  let out = drawn.get(latex);
  if (!out) {
    const r = texToSvg(`\\displaystyle ${latex}`, { display: false, scale: 17 });
    out = r.error ? { svg: `<span class="cp-tex-error">${inlineHtml(latex)}</span>`, depth: 0 } : { svg: r.svg, depth: r.depth };
    if (drawn.size > 4000) drawn.clear();
    drawn.set(latex, out);
  }
  return out;
}

/* ------------------------------------------------------------ highlighting -- */

const calcpadLanguage = StreamLanguage.define<{ line: boolean }>({
  name: 'calcpad',
  startState: () => ({ line: true }),
  token(stream) {
    if (stream.sol()) {
      stream.eatSpace();
      const c = stream.peek();
      if (c === '"') {
        stream.skipToEnd();
        return 'heading';
      }
      if (c === "'") {
        stream.skipToEnd();
        return 'comment';
      }
      if (c === '#') {
        stream.skipToEnd();
        return 'keyword';
      }
    }
    if (stream.peek() === "'") {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^\$[A-Za-z]+/)) return 'keyword';
    if (stream.match(/^\?(\{[^}]*\})?/)) return 'atom';
    if (stream.match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i)) return 'number';
    if (stream.match(/^[\p{L}_][\p{L}\p{N}_]*(?=\s*\()/u)) return 'labelName';
    if (stream.match(/^\|\s*[\p{L}][\p{L}\p{N}^*/ .]*$/u)) return 'unit';
    stream.next();
    return null;
  },
});

/* ------------------------------------------------------------- the tool -- */

const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'equ', label: 'Formulas and values' },
  { value: 'noc', label: 'Formulas and results' },
  { value: 'val', label: 'Results only' },
];

function Tex({ latex, render }: { latex: string; render: (tex: string) => RenderedTex }) {
  const r = render(latex);
  return <span class="cp-tex" style={{ verticalAlign: `-${r.depth}px` }} dangerouslySetInnerHTML={{ __html: r.svg }} />;
}

function Calcpad({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, read, write);
  const [math, setMath] = useState<MathJsInstance | null>(null);
  const [texToSvg, setTexToSvg] = useState<TexToSvg | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [took, setTook] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const view = useRef<EditorView | null>(null);
  const first = useRef(true);

  useEffect(() => {
    void Promise.all([loadMath(), loadTex()]).then(
      ([m, t]) => {
        setMath(() => m);
        setTexToSvg(() => t.texToSvg);
      },
      (error: unknown) => setFailed(error instanceof Error ? error.message : String(error)),
    );
  }, []);

  // Recalculate a moment after typing stops.
  useEffect(() => {
    if (!math) return;
    const timer = setTimeout(
      () => {
        const start = performance.now();
        const r = calculate(math, state.source, { decimals: state.decimals, degrees: state.degrees, mode: state.mode });
        setTook(performance.now() - start);
        setReport(r);
      },
      first.current ? 0 : 350,
    );
    first.current = false;
    return () => clearTimeout(timer);
  }, [math, state.source, state.decimals, state.degrees, state.mode]);

  const render = useMemo(() => (texToSvg ? (latex: string) => draw(texToSvg, latex) : null), [texToSvg]);
  const errors = useMemo(() => (report?.blocks ?? []).filter((b): b is Extract<Block, { kind: 'error' }> => b.kind === 'error'), [report]);

  /** Puts the cursor on a line of the worksheet. */
  const goTo = (line: number) => {
    const editor = view.current;
    if (!editor || state.layout === 'report' || line < 1 || line > editor.state.doc.lines) return;
    const at = editor.state.doc.line(line).from;
    editor.dispatch({ selection: { anchor: at }, scrollIntoView: true });
    editor.focus();
  };

  const setField = <K extends keyof WorksheetState>(key: K, value: WorksheetState[K]) => setState((s) => ({ ...s, [key]: value }));

  const open = () =>
    attempt(async () => {
      const file = await pickFile('.cpd,.txt,text/plain');
      if (!file) return;
      if (file.size > 2_000_000) throw new Error(`"${file.name}" is too large for a worksheet (the limit is 2 MB).`);
      const text = await file.text();
      setState((s) => ({ ...s, source: text.replace(/\r\n?/g, '\n') }));
      notify(`Opened ${file.name}`);
    });

  const baseName = () =>
    (report ? reportTitle(report.blocks) : 'Worksheet')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 80) || 'Worksheet';

  const save = (kind: 'cpd' | 'html' | 'pdf') =>
    attempt(async () => {
      if (kind === 'cpd') {
        const outcome = await saveFile(`${baseName()}.cpd`, state.source.endsWith('\n') ? state.source : `${state.source}\n`, 'text/plain');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
        return;
      }
      if (!report || !render) throw new Error('The worksheet is still being calculated.');
      const html = reportHtml(report.blocks, render, reportTitle(report.blocks));
      if (kind === 'html') {
        const outcome = await saveFile(`${baseName()}.html`, html, 'text/html');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      } else if (!isDesktop) printDocument(html);
      else {
        const outcome = await saveFile(`${baseName()}.pdf`, await htmlToPdf(html), 'application/pdf');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      }
    });

  const changeInput = (line: number, value: string) => setState((s) => ({ ...s, source: setInput(s.source, line, value) }));

  let headings = 0;
  const blockView = (b: Block, index: number) => {
    const key = `${index}:${b.kind}:${b.line}`;
    if (!render) return null;
    switch (b.kind) {
      case 'heading': {
        const Heading = headings++ === 0 ? 'h2' : 'h3';
        return <Heading key={key} class="cp-heading" dangerouslySetInnerHTML={{ __html: inlineHtml(b.text) }} />;
      }
      case 'text':
        return <p key={key} class="cp-text" dangerouslySetInnerHTML={{ __html: inlineHtml(b.text) }} />;
      case 'math':
        return (
          <div key={key} class="cp-eq" role="img" aria-label={b.source} title={state.layout === 'split' ? `Line ${b.line}: click to edit` : undefined} onClick={() => goTo(b.line)}>
            <Tex latex={b.tex} render={render} />
            {b.note && <span class="cp-note" dangerouslySetInnerHTML={{ __html: inlineHtml(b.note) }} />}
            {b.warning && (
              <span class="cp-warning">
                <Icon name="alert" size={13} /> {b.warning}
              </span>
            )}
          </div>
        );
      case 'input':
        return (
          <div key={key} class="cp-eq cp-input">
            <Tex latex={b.label} render={render} />
            <input
              class="cp-box"
              value={b.value}
              size={Math.max(4, Math.min(16, b.value.length + 1))}
              aria-label={`${b.source.split('=')[0]?.trim() ?? 'Value'}${b.note ? ` (${b.note})` : ''}`}
              spellcheck={false}
              onInput={(e) => changeInput(b.line, e.currentTarget.value)}
              data-testid="cp-input"
            />
            {b.unit && <Tex latex={b.unit} render={render} />}
            {b.note && <span class="cp-note" dangerouslySetInnerHTML={{ __html: inlineHtml(b.note) }} />}
          </div>
        );
      case 'plot':
        return <figure key={key} class="cp-figure" dangerouslySetInnerHTML={{ __html: b.svg }} />;
      default:
        return (
          <div key={key} class="cp-error" role="alert">
            <button type="button" class="button button-quiet button-small" onClick={() => goTo(b.line)} disabled={b.line < 1 || state.layout === 'report'}>
              Line {b.line}
            </button>
            <span>{b.message}</span>
            {b.source.trim() && <code>{b.source.trim()}</code>}
          </div>
        );
    }
  };

  return (
    <section class={`tool cp-tool cp-${state.layout}`} data-testid="tool" data-state={report ? 'done' : 'idle'}>
      <div class="button-row cp-bar">
        <label class="cp-field">
          <span class="control-label">Example</span>
          <select
            class="select select-small"
            value=""
            data-testid="cp-example"
            onChange={(e) => {
              const example = CALCPAD_EXAMPLES.find((x) => x.id === e.currentTarget.value);
              e.currentTarget.value = '';
              if (example) setField('source', example.source);
            }}
          >
            <option value="">Open an example…</option>
            {CALCPAD_EXAMPLES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        </label>
        <label class="cp-field">
          <span class="control-label">Show</span>
          <select class="select select-small" value={state.mode} onChange={(e) => setField('mode', e.currentTarget.value as Mode)} data-testid="cp-mode">
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label class="cp-field">
          <span class="control-label">Decimals</span>
          <input
            type="number"
            class="input input-number"
            min={0}
            max={15}
            value={state.decimals}
            onChange={(e) => {
              const n = Math.round(Number(e.currentTarget.value));
              if (Number.isFinite(n)) setField('decimals', Math.min(15, Math.max(0, n)));
            }}
            data-testid="cp-decimals"
          />
        </label>
        <label class="cp-field">
          <span class="control-label">Angles</span>
          <select class="select select-small" value={state.degrees ? 'deg' : 'rad'} onChange={(e) => setField('degrees', e.currentTarget.value === 'deg')}>
            <option value="deg">Degrees</option>
            <option value="rad">Radians</option>
          </select>
        </label>
        <Segmented
          label="Layout"
          value={state.layout}
          onChange={(layout) => setField('layout', layout)}
          choices={[
            { value: 'split', label: 'Worksheet and report' },
            { value: 'report', label: 'Report only' },
          ]}
        />
        <span class="cp-files" role="group" aria-label="Files">
          <button type="button" class="button button-small" onClick={open} data-testid="cp-open">
            <Icon name="open" size={13} /> Open…
          </button>
          <button type="button" class="button button-small" onClick={() => save('cpd')} title="The worksheet as text (.cpd, as Calcpad saves)" data-testid="cp-save">
            Save worksheet
          </button>
          <button type="button" class="button button-small" onClick={() => save('html')} disabled={!report} data-testid="cp-save-html">
            Save report
          </button>
          <button type="button" class="button button-small" onClick={() => save('pdf')} disabled={!report} data-testid="cp-pdf">
            {isDesktop ? 'Save PDF' : 'Print'}
          </button>
        </span>
      </div>

      <div class="cp-main">
        {state.layout === 'split' && (
          <div class="cp-code">
            <CodeEditor
              value={state.source}
              onChange={(source) => setField('source', source)}
              label="Worksheet"
              extensions={[calcpadLanguage]}
              errorLine={errors[0]?.line}
              viewRef={view}
              testId="cp-editor"
            />
          </div>
        )}
        <div class="cp-side">
          <article class="cp-paper" {...scrollRegion('Report')} data-testid="cp-report" aria-busy={!report}>
            {failed ? (
              <p class="tone-error">The calculator could not be loaded: {failed}</p>
            ) : !report || !render ? (
              <p class="tone-muted">Calculating…</p>
            ) : report.blocks.length === 0 ? (
              <p class="cp-empty">Write a formula on the left, such as “a = 3 m” on one line and “A = a^2” on the next.</p>
            ) : (
              report.blocks.map(blockView)
            )}
          </article>
          <p class={`cp-status ${errors.length ? 'tone-error' : 'tone-muted'}`} role="status" data-testid="cp-status">
            {!report
              ? 'Loading the calculator…'
              : errors.length
                ? `${errors.length} ${errors.length === 1 ? 'problem' : 'problems'}; the rest was calculated.`
                : `Calculated in ${took < 1 ? '<1' : Math.round(took)} ms.`}
          </p>
          {report && report.values.size > 0 && (
            <details class="cp-values">
              <summary>Values at the end of the worksheet ({report.values.size})</summary>
              <table class="data-table cp-values-table">
                <tbody>
                  {[...report.values].map(([name, value]) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      <td>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      </div>

      <details class="cp-help">
        <summary>How to write a worksheet</summary>
        <dl>
          <dt>
            <code>"Heading</code> and <code>'Text</code>
          </dt>
          <dd>A line starting with " is a heading, with ' a paragraph. After a formula, ' starts a note. Notes may use &lt;b&gt;, &lt;i&gt;, &lt;sub&gt;, &lt;sup&gt; and &lt;br&gt;.</dd>
          <dt>
            <code>F = m_1*a</code>
          </dt>
          <dd>Defines a variable. _ starts a subscript, Greek letters can be typed (δ) or spelt (delta). Units follow numbers: 12 kN/m, 8360 cm^4, 72 km/h, 25 degC.</dd>
          <dt>
            <code>
              L = ?{'{'}6{'}'} m
            </code>
          </dt>
          <dd>An input box in the report holding 6; typing there changes the worksheet.</dd>
          <dt>
            <code>f(x; y) = x^2 + y</code>
          </dt>
          <dd>A function. Arguments and vector elements are separated by ;, matrix rows by |, as in [1; 2 | 3; 4].</dd>
          <dt>
            <code>δ|mm</code>
          </dt>
          <dd>Shows a result in the units you choose.</dd>
          <dt>
            <code>#if</code> … <code>#else if</code> … <code>#else</code> … <code>#end if</code>, <code>#for i = 1 : 5</code>, <code>#repeat 3</code>, <code>#while</code> … <code>#loop</code>,{' '}
            <code>#break</code>
          </dt>
          <dd>Conditions and loops.</dd>
          <dt>
            <code>#equ</code>, <code>#noc</code>, <code>#val</code>, <code>#hide</code>, <code>#show</code>, <code>#round 2</code>, <code>#deg</code>, <code>#rad</code>
          </dt>
          <dd>From that line on: show formulas with values, formulas and results, or results only; hide or show lines; round; angles in degrees or radians.</dd>
          <dt>
            <code>
              $Root{'{'}f(x) = 0 @ x = 1 : 3{'}'}
            </code>
          </dt>
          <dd>
            Solvers: $Root (or $Find), $Sup and $Inf (largest and smallest value), $Area (integral), $Slope (derivative at a point), $Sum, $Product and $Repeat over whole numbers. $Plot{'{'}f(x) &
            g(x) @ x = 0 : 10{'}'}
            draws lines; $Map{'{'}f(x; y) @ x = 0 : 1 & y = 0 : 1{'}'} a colour map. Plots use SI values.
          </dd>
        </dl>
        <p class="control-help">
          A variable hides a unit of the same name from then on (m, s, g, t, h, A, V, L…), and the report warns where that changes a number. Worksheets are saved as plain text with the .cpd extension
          that Calcpad uses; Calcpad’s own .cpd files open here when they keep to the syntax above.
        </p>
      </details>
    </section>
  );
}

export default defineCustomTool(Calcpad);
