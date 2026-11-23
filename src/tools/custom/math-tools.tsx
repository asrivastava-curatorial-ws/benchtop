/**
 * Scientific Calculator (keypad, degrees or radians, memory, history) and
 * Graphing Calculator (plot several functions, pan, zoom, trace, roots).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { saveFile } from '../../platform';
import { context2d } from '../../ui/canvas';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

type MathJs = import('mathjs').MathJsInstance;
let engines: Promise<{ rad: MathJs; deg: MathJs }> | null = null;

/** Two math.js instances: one with trigonometry in radians, one in degrees. */
function loadEngines() {
  engines ??= import('mathjs').then(({ all, create }) => {
    const rad = create(all, { number: 'number' });
    const deg = create(all, { number: 'number' });
    const k = Math.PI / 180;
    deg.import(
      {
        sin: (x: number) => Math.sin(x * k),
        cos: (x: number) => Math.cos(x * k),
        tan: (x: number) => Math.tan(x * k),
        asin: (x: number) => Math.asin(x) / k,
        acos: (x: number) => Math.acos(x) / k,
        atan: (x: number) => Math.atan(x) / k,
      },
      { override: true },
    );
    return { rad, deg };
  });
  return engines;
}

/** Writes the calculator's symbols as math.js understands them. */
export function normaliseExpression(text: string): string {
  return text
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√\(/g, 'sqrt(')
    .replace(/∛\(/g, 'cbrt(')
    .replace(/(\d)\s*E\s*([+-]?\d)/g, '$1e$2')
    .replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
}

/* ------------------------------------------------------------ scientific -- */

interface CalcPrefs {
  readonly angle: 'deg' | 'rad';
  readonly memory: number;
  readonly history: readonly { readonly expr: string; readonly result: string }[];
}

const KEYS: readonly (readonly [label: string, insert: string, kind?: 'fn' | 'op' | 'num' | 'eq' | 'act'])[] = [
  ['sin', 'sin(', 'fn'],
  ['cos', 'cos(', 'fn'],
  ['tan', 'tan(', 'fn'],
  ['π', 'π', 'fn'],
  ['e', 'e', 'fn'],
  ['(', '(', 'op'],
  [')', ')', 'op'],
  ['asin', 'asin(', 'fn'],
  ['acos', 'acos(', 'fn'],
  ['atan', 'atan(', 'fn'],
  ['x²', '^2', 'fn'],
  ['xʸ', '^', 'fn'],
  ['√', '√(', 'fn'],
  ['∛', '∛(', 'fn'],
  ['ln', 'log(', 'fn'],
  ['log', 'log10(', 'fn'],
  ['10ˣ', '10^', 'fn'],
  ['eˣ', 'exp(', 'fn'],
  ['n!', '!', 'fn'],
  ['1/x', '1/', 'fn'],
  ['|x|', 'abs(', 'fn'],
  ['7', '7', 'num'],
  ['8', '8', 'num'],
  ['9', '9', 'num'],
  ['÷', '÷', 'op'],
  ['C', 'clear', 'act'],
  ['⌫', 'back', 'act'],
  ['%', '%', 'op'],
  ['4', '4', 'num'],
  ['5', '5', 'num'],
  ['6', '6', 'num'],
  ['×', '×', 'op'],
  ['MC', 'mc', 'act'],
  ['MR', 'mr', 'act'],
  ['M+', 'm+', 'act'],
  ['1', '1', 'num'],
  ['2', '2', 'num'],
  ['3', '3', 'num'],
  ['−', '−', 'op'],
  ['M−', 'm-', 'act'],
  ['Ans', 'Ans', 'fn'],
  ['EE', 'E', 'fn'],
  ['0', '0', 'num'],
  ['.', '.', 'num'],
  ['±', 'neg', 'act'],
  ['+', '+', 'op'],
  ['=', '=', 'eq'],
];

function Scientific({ toolId }: { toolId: string }) {
  const [prefs, setPrefs] = usePersistentState(
    toolId,
    (s: Values | undefined): CalcPrefs => ({
      angle: s?.angle === 'rad' ? 'rad' : 'deg',
      memory: typeof s?.memory === 'number' ? s.memory : 0,
      history: Array.isArray(s?.history) ? (s.history as CalcPrefs['history']).slice(0, 30) : [],
    }),
    (p: CalcPrefs): Values => ({ ...p }),
  );
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState('0');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const ans = prefs.history[0]?.result ?? '0';

  const compute = async (text: string): Promise<number> => {
    const { rad, deg } = await loadEngines();
    const engine = prefs.angle === 'deg' ? deg : rad;
    const value = engine.evaluate(normaliseExpression(text).replace(/\bAns\b/g, `(${ans})`));
    if (typeof value !== 'number') throw new Error('The answer is not a single number.');
    return value;
  };
  const show = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(14))) : String(v));

  const equals = () =>
    void (async () => {
      if (!expr.trim()) return;
      try {
        const v = await compute(expr);
        const text = show(v);
        setResult(text);
        setError('');
        setPrefs((p) => ({ ...p, history: [{ expr, result: text }, ...p.history].slice(0, 30) }));
        setExpr(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

  // A live answer while typing.
  useEffect(() => {
    let live = true;
    if (!expr.trim()) {
      setError('');
      return;
    }
    void compute(expr).then(
      (v) => {
        if (!live) return;
        setResult(show(v));
        setError('');
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [expr, prefs.angle]);

  const press = (insert: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? expr.length;
    const end = el?.selectionEnd ?? expr.length;
    const put = (text: string, caret = start + text.length) => {
      setExpr(expr.slice(0, start) + text + expr.slice(end));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(caret, caret);
      });
    };
    switch (insert) {
      case 'clear':
        setExpr('');
        setResult('0');
        setError('');
        return;
      case 'back':
        if (start === end && start > 0) {
          setExpr(expr.slice(0, start - 1) + expr.slice(end));
          requestAnimationFrame(() => el?.setSelectionRange(start - 1, start - 1));
        } else put('');
        return;
      case 'neg':
        setExpr(expr.startsWith('-(') && expr.endsWith(')') ? expr.slice(2, -1) : `-(${expr || '0'})`);
        return;
      case 'mc':
        setPrefs((p) => ({ ...p, memory: 0 }));
        return;
      case 'mr':
        put(String(prefs.memory));
        return;
      case 'm+':
      case 'm-':
        void compute(expr || result).then(
          (v) => setPrefs((p) => ({ ...p, memory: p.memory + (insert === 'm+' ? v : -v) })),
          (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
        );
        return;
      case '=':
        equals();
        return;
      default:
        put(insert);
    }
  };

  return (
    <section class="tool sci-tool" data-testid="tool" data-state="done">
      <div class="sci-body">
        <div class="sci-calc">
          <div class="sci-display">
            <div class="sci-flags">
              <button
                type="button"
                class={`sci-flag${prefs.angle === 'deg' ? ' is-on' : ''}`}
                onClick={() => setPrefs((p) => ({ ...p, angle: p.angle === 'deg' ? 'rad' : 'deg' }))}
                aria-label={`${prefs.angle === 'deg' ? 'DEG' : 'RAD'}: angles in ${prefs.angle === 'deg' ? 'degrees' : 'radians'}, press for ${prefs.angle === 'deg' ? 'radians' : 'degrees'}`}
                data-testid="sci-angle"
              >
                {prefs.angle === 'deg' ? 'DEG' : 'RAD'}
              </button>
              {prefs.memory !== 0 && <span class="sci-flag is-on">M = {show(prefs.memory)}</span>}
            </div>
            <input
              ref={input}
              class="sci-input"
              value={expr}
              onInput={(e) => setExpr(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  equals();
                } else if (e.key === 'Escape') press('clear');
              }}
              aria-label="Expression"
              spellcheck={false}
              autocomplete="off"
              placeholder="0"
              data-testid="sci-input"
            />
            <output class={`sci-result${error ? ' is-error' : ''}`} data-testid="sci-result" aria-live="polite">
              {error || `= ${result}`}
            </output>
          </div>
          <div class="sci-keys">
            {KEYS.map(([label, insert, kind]) => (
              <button key={label} type="button" class={`sci-key is-${kind ?? 'num'}`} onClick={() => press(insert)} aria-label={label === '⌫' ? 'Delete' : label}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <aside class="sci-history" aria-label="History">
          <h3>History</h3>
          {prefs.history.length === 0 && <p class="control-help">Results appear here. Click one to use it again.</p>}
          <ol>
            {prefs.history.map((h, i) => (
              <li key={`${i}-${h.expr}`}>
                <button type="button" onClick={() => setExpr(h.expr)} title="Use this expression">
                  <span>{h.expr}</span>
                  <strong>= {h.result}</strong>
                </button>
              </li>
            ))}
          </ol>
          {prefs.history.length > 0 && (
            <button type="button" class="button button-small button-quiet" onClick={() => setPrefs((p) => ({ ...p, history: [] }))}>
              Clear history
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- graphing -- */

interface Fn {
  readonly expr: string;
  readonly color: string;
  readonly on: boolean;
}
interface View {
  readonly cx: number;
  readonly cy: number;
  /** Pixels per unit. */
  readonly scale: number;
}

const COLOURS = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf'];

const niceStep = (pixelsPerUnit: number) => {
  const raw = 80 / pixelsPerUnit;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
};

function Graphing({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(
    toolId,
    (s: Values | undefined) => ({
      fns:
        Array.isArray(s?.fns) && (s.fns as Fn[]).length
          ? (s.fns as Fn[]).slice(0, 6)
          : [
              { expr: 'sin(x)', color: COLOURS[0] as string, on: true },
              { expr: 'x^2/4 - 1', color: COLOURS[1] as string, on: true },
            ],
      angle: s?.angle === 'deg' ? 'deg' : 'rad',
    }),
    (p: { fns: Fn[]; angle: string }): Values => ({ ...p }),
  );
  const [view, setView] = useState<View>({ cx: 0, cy: 0, scale: 60 });
  const [trace, setTrace] = useState<{ x: number; px: number } | null>(null);
  const [compiled, setCompiled] = useState<({ f: (x: number) => number } | { error: string } | null)[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 800, h: 520 });
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  useEffect(() => {
    let live = true;
    void loadEngines().then(({ rad, deg }) => {
      if (!live) return;
      const engine = state.angle === 'deg' ? deg : rad;
      setCompiled(
        state.fns.map((fn) => {
          if (!fn.expr.trim()) return null;
          try {
            const code = engine.compile(normaliseExpression(fn.expr.replace(/^\s*y\s*=\s*/, '')));
            const f = (x: number) => {
              const v = code.evaluate({ x });
              return typeof v === 'number' ? v : Number.NaN;
            };
            f(0.5);
            return { f };
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
    });
    return () => {
      live = false;
    };
  }, [state.fns, state.angle]);

  const toScreen = (x: number, y: number) => ({ px: size.current.w / 2 + (x - view.cx) * view.scale, py: size.current.h / 2 - (y - view.cy) * view.scale });
  const toWorld = (px: number, py: number) => ({ x: view.cx + (px - size.current.w / 2) / view.scale, y: view.cy - (py - size.current.h / 2) / view.scale });

  /** Real roots of each function in view, by sign changes and bisection. */
  const roots = useMemo(() => {
    const out: { i: number; x: number }[] = [];
    const left = view.cx - size.current.w / 2 / view.scale;
    const right = view.cx + size.current.w / 2 / view.scale;
    compiled.forEach((c, i) => {
      if (!c || 'error' in c || !state.fns[i]?.on) return;
      const n = 800;
      let px = left;
      let py = c.f(px);
      for (let k = 1; k <= n; k++) {
        const x = left + ((right - left) * k) / n;
        const y = c.f(x);
        if (Number.isFinite(py) && Number.isFinite(y) && py * y <= 0 && Math.abs(py - y) < 1e3) {
          let a = px;
          let b = x;
          for (let t = 0; t < 60; t++) {
            const m = (a + b) / 2;
            if (c.f(a) * c.f(m) <= 0) b = m;
            else a = m;
          }
          const found = (a + b) / 2;
          // Bisection lands within rounding of zero rather than on it; show 0, not 1e-21.
          const root = Math.abs(found) < (right - left) * 1e-12 ? 0 : found;
          if (Math.abs(c.f(root)) < 1e-6 && !out.some((r) => r.i === i && Math.abs(r.x - root) < 1e-6)) out.push({ i, x: root });
        }
        px = x;
        py = y;
      }
    });
    return out.slice(0, 40);
  }, [compiled, view, state.fns]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = el.clientWidth || 800;
    const h = el.clientHeight || 520;
    size.current = { w, h };
    el.width = Math.round(w * ratio);
    el.height = Math.round(h * ratio);
    const ctx = context2d(el);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const step = niceStep(view.scale);
    const tl = toWorld(0, 0);
    const br = toWorld(w, h);
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#5f6b75';
    for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
      const { px } = toScreen(x, 0);
      ctx.strokeStyle = Math.abs(x) < step / 2 ? '#5f6b75' : '#e3e7ea';
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
      if (Math.abs(x) > step / 2) ctx.fillText(String(Number(x.toPrecision(6))), px + 3, Math.min(h - 4, Math.max(12, toScreen(0, 0).py + 13)));
    }
    for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) {
      const { py } = toScreen(0, y);
      ctx.strokeStyle = Math.abs(y) < step / 2 ? '#5f6b75' : '#e3e7ea';
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
      if (Math.abs(y) > step / 2) ctx.fillText(String(Number(y.toPrecision(6))), Math.min(w - 40, Math.max(3, toScreen(0, 0).px + 4)), py - 3);
    }
    compiled.forEach((c, i) => {
      const fn = state.fns[i];
      if (!c || 'error' in c || !fn?.on) return;
      ctx.strokeStyle = fn.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let pen = false;
      let lastPy = 0;
      for (let px = 0; px <= w; px += 0.5) {
        const { x } = toWorld(px, 0);
        const y = c.f(x);
        const { py } = toScreen(x, y);
        if (!Number.isFinite(py) || Math.abs(py - lastPy) > h * 2) {
          pen = false;
          lastPy = Number.isFinite(py) ? py : lastPy;
          continue;
        }
        if (pen) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        pen = true;
        lastPy = py;
      }
      ctx.stroke();
    });
    ctx.fillStyle = '#111';
    for (const r of roots) {
      const { px, py } = toScreen(r.x, 0);
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (trace) {
      ctx.strokeStyle = 'rgb(0 0 0 / 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(trace.px, 0);
      ctx.lineTo(trace.px, h);
      ctx.stroke();
      ctx.setLineDash([]);
      compiled.forEach((c, i) => {
        const fn = state.fns[i];
        if (!c || 'error' in c || !fn?.on) return;
        const y = c.f(trace.x);
        if (!Number.isFinite(y)) return;
        const { py } = toScreen(trace.x, y);
        ctx.fillStyle = fn.color;
        ctx.beginPath();
        ctx.arc(trace.px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }, [compiled, view, trace, roots, state.fns]);

  const setFn = (i: number, patch: Partial<Fn>) => setState((s) => ({ ...s, fns: s.fns.map((f, k) => (k === i ? { ...f, ...patch } : f)) }));
  const zoom = (k: number) => setView((v) => ({ ...v, scale: Math.min(20000, Math.max(0.5, v.scale * k)) }));
  const traced = trace
    ? compiled.map((c, i) => {
        const fn = state.fns[i];
        if (!c || 'error' in c || !fn?.on) return null;
        const y = c.f(trace.x);
        return { color: fn.color, label: fn.expr, y };
      })
    : [];

  return (
    <section class="tool gr-tool" data-testid="tool" data-state="done">
      <div class="gr-body">
        <div class="gr-side">
          {state.fns.map((fn, i) => {
            const c = compiled[i];
            return (
              <div class="gr-fn" key={`fn-${i}`}>
                <input type="checkbox" checked={fn.on} onChange={(e) => setFn(i, { on: e.currentTarget.checked })} aria-label={`Show function ${i + 1}`} />
                <input class="color-swatch" type="color" value={fn.color} onInput={(e) => setFn(i, { color: e.currentTarget.value })} aria-label={`Colour of function ${i + 1}`} />
                <span class="gr-y">y =</span>
                <input
                  class={`input input-mono${c && 'error' in c ? ' is-invalid' : ''}`}
                  value={fn.expr}
                  onInput={(e) => setFn(i, { expr: e.currentTarget.value })}
                  aria-label={`Function ${i + 1}`}
                  spellcheck={false}
                  data-testid={`gr-fn-${i}`}
                />
                <button type="button" class="icon-button" aria-label={`Remove function ${i + 1}`} onClick={() => setState((s) => ({ ...s, fns: s.fns.filter((_, k) => k !== i) }))}>
                  <Icon name="close" size={14} />
                </button>
                {c && 'error' in c && <span class="recipe-error gr-error">{c.error}</span>}
              </div>
            );
          })}
          <div class="button-row">
            {state.fns.length < 6 && (
              <button
                type="button"
                class="button button-small"
                onClick={() => setState((s) => ({ ...s, fns: [...s.fns, { expr: '', color: COLOURS[s.fns.length % COLOURS.length] as string, on: true }] }))}
              >
                <Icon name="plus" size={14} /> Add a function
              </button>
            )}
            <button type="button" class="button button-small button-quiet" onClick={() => setState((s) => ({ ...s, angle: s.angle === 'deg' ? 'rad' : 'deg' }))}>
              Angles: {state.angle === 'deg' ? 'degrees' : 'radians'}
            </button>
          </div>
          <p class="control-help">Use x, and functions such as sin, sqrt, abs, log, exp. Drag to move, scroll or use the buttons to zoom.</p>
          {roots.length > 0 && (
            <div class="gr-roots" data-testid="gr-roots">
              <h3>Where they cross y = 0</h3>
              <ul>
                {roots.map((r, k) => (
                  <li key={k}>
                    <span class="gr-dot" style={{ background: state.fns[r.i]?.color }} /> x = {Number(r.x.toPrecision(10))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div class="gr-plot">
          <div class="gr-toolbar">
            <button type="button" class="icon-button" aria-label="Zoom in" onClick={() => zoom(1.5)}>
              <Icon name="plus" size={16} />
            </button>
            <button type="button" class="button button-small button-quiet" aria-label="Zoom out" onClick={() => zoom(1 / 1.5)}>
              −
            </button>
            <button type="button" class="button button-small button-quiet" onClick={() => setView({ cx: 0, cy: 0, scale: 60 })}>
              Reset view
            </button>
            <button
              type="button"
              class="button button-small"
              onClick={() =>
                attempt(async () => {
                  const el = canvas.current;
                  if (!el) return;
                  const blob = await new Promise<Blob | null>((res) => el.toBlob(res, 'image/png'));
                  if (!blob) throw new Error('Could not make the picture.');
                  const saved = await saveFile('graph.png', blob, 'image/png');
                  if (saved.saved) notify(`Saved to ${saved.location}`);
                })
              }
            >
              <Icon name="save" size={14} /> PNG
            </button>
            {trace && (
              <span class="gr-trace" data-testid="gr-trace">
                x = {Number(trace.x.toPrecision(6))}
                {traced.map((t, k) =>
                  t && Number.isFinite(t.y) ? (
                    <span key={k} style={{ color: t.color }}>
                      {' '}
                      · y = {Number(t.y.toPrecision(6))}
                    </span>
                  ) : null,
                )}
              </span>
            )}
          </div>
          <canvas
            ref={canvas}
            class="gr-canvas"
            role="img"
            aria-label={`Graph of ${state.fns
              .filter((f) => f.on && f.expr)
              .map((f) => `y = ${f.expr}`)
              .join(', ')}`}
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY, view };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const px = e.clientX - box.left;
              if (drag.current) {
                const d = drag.current;
                setView({ ...d.view, cx: d.view.cx - (e.clientX - d.x) / d.view.scale, cy: d.view.cy + (e.clientY - d.y) / d.view.scale });
              }
              setTrace({ x: toWorld(px, 0).x, px });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerLeave={() => setTrace(null)}
            onWheel={(e) => {
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              const before = toWorld(e.clientX - box.left, e.clientY - box.top);
              const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
              setView((v) => {
                const scale = Math.min(20000, Math.max(0.5, v.scale * k));
                // Keep the point under the pointer still.
                return { scale, cx: before.x - (e.clientX - box.left - size.current.w / 2) / scale, cy: before.y + (e.clientY - box.top - size.current.h / 2) / scale };
              });
            }}
            data-testid="gr-canvas"
          />
        </div>
      </div>
    </section>
  );
}

function MathTools({ toolId }: { toolId: string }) {
  return toolId === 'graphing-calculator' ? <Graphing toolId={toolId} /> : <Scientific toolId={toolId} />;
}

export default defineCustomTool(MathTools);
