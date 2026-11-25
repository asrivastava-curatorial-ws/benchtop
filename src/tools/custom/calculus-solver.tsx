/**
 * Calculus Solver: derivatives, integrals, limits, Taylor series, extrema,
 * tangent lines, differential equations and Riemann sums.  Each answer comes
 * with the worked steps a textbook would show, a graph and a check: the
 * derivative of an integral is compared with the integrand, a limit with
 * values close to the point, a definite integral with numerical integration.
 */
import type { MathJsInstance } from 'mathjs';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Analysis, Answer, Calculus, GraphLine, GraphOptions, RiemannKind, RiemannSum } from '../../lib/calculus';
import { copyText, htmlToPdf, isDesktop, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { printDocument } from '../../ui/print';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';
import { SolverField as Field, fmt, makeRender, type Render, ResultTable, SolverGraph, StepsList, solutionHtml, Tex } from './_solver';

type Mode = 'derivative' | 'integral' | 'limit' | 'series' | 'extrema' | 'tangent' | 'ode' | 'riemann';
type Side = 'both' | 'left' | 'right';
type OdeKind = 'linear' | 'first' | 'second';

interface SolverState {
  readonly mode: Mode;
  readonly expr: string;
  readonly variable: string;
  readonly order: number;
  readonly terms: number;
  readonly definite: boolean;
  readonly a: string;
  readonly b: string;
  readonly point: string;
  readonly side: Side;
  readonly from: string;
  readonly to: string;
  readonly odeKind: OdeKind;
  readonly ca: string;
  readonly cb: string;
  readonly cc: string;
  readonly rhs: string;
  readonly x0: string;
  readonly y0: string;
  readonly yp0: string;
  readonly x1: string;
  readonly n: number;
  readonly rule: RiemannKind;
}

const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'derivative', label: 'Derivative' },
  { value: 'integral', label: 'Integral' },
  { value: 'limit', label: 'Limit' },
  { value: 'series', label: 'Taylor series' },
  { value: 'extrema', label: 'Extrema' },
  { value: 'tangent', label: 'Tangent' },
  { value: 'ode', label: 'Differential equation' },
  { value: 'riemann', label: 'Riemann sums' },
];

const RULES: readonly { value: RiemannKind; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'midpoint', label: 'Midpoint' },
  { value: 'trapezoid', label: 'Trapezoid' },
  { value: 'simpson', label: 'Simpson' },
];

const DEFAULTS: SolverState = {
  mode: 'derivative',
  expr: 'x^2 sin(x)',
  variable: 'x',
  order: 1,
  terms: 6,
  definite: false,
  a: '0',
  b: 'pi',
  point: '0',
  side: 'both',
  from: '-5',
  to: '5',
  odeKind: 'linear',
  ca: '1',
  cb: '0',
  cc: '1',
  rhs: 'x - y',
  x0: '0',
  y0: '1',
  yp0: '0',
  x1: '10',
  n: 8,
  rule: 'midpoint',
};

/** Ready-made problems for each kind, filling in the fields they need. */
const EXAMPLES: Record<Mode, readonly { label: string; set: Partial<SolverState> }[]> = {
  derivative: [
    { label: 'Product rule: x² sin x', set: { expr: 'x^2 sin(x)', order: 1 } },
    { label: 'Chain rule: sin(x²)', set: { expr: 'sin(x^2)', order: 1 } },
    { label: 'Quotient rule: (x² + 1)/(x − 1)', set: { expr: '(x^2 + 1)/(x - 1)', order: 1 } },
    { label: 'Logarithmic: xˣ', set: { expr: 'x^x', order: 1 } },
    { label: 'Second derivative: e^(3x) cos x', set: { expr: 'e^(3x) cos(x)', order: 2 } },
    { label: 'Inverse trig: arctan(2x)', set: { expr: 'atan(2x)', order: 1 } },
  ],
  integral: [
    { label: 'By parts: x eˣ', set: { expr: 'x e^x', definite: false } },
    { label: 'Substitution: 2x cos(x²)', set: { expr: '2x cos(x^2)', definite: false } },
    { label: 'Partial fractions: (3x + 2)/(x² + 3x + 2)', set: { expr: '(3x + 2)/(x^2 + 3x + 2)', definite: false } },
    { label: 'Completing the square: 1/(x² + 4x + 13)', set: { expr: '1/(x^2 + 4x + 13)', definite: false } },
    { label: 'By parts twice: e^(2x) cos(3x)', set: { expr: 'e^(2x) cos(3x)', definite: false } },
    { label: 'Area under sin x from 0 to π', set: { expr: 'sin(x)', definite: true, a: '0', b: 'pi' } },
    { label: 'Gaussian over the real line', set: { expr: 'e^(-x^2)', definite: true, a: '-inf', b: 'inf' } },
    { label: 'Improper: 1/√x from 0 to 1', set: { expr: '1/sqrt(x)', definite: true, a: '0', b: '1' } },
    { label: 'Divergent: 1/x² from −1 to 1', set: { expr: '1/x^2', definite: true, a: '-1', b: '1' } },
  ],
  limit: [
    { label: 'sin x / x at 0', set: { expr: 'sin(x)/x', point: '0', side: 'both' } },
    { label: '(1 − cos x)/x² at 0', set: { expr: '(1 - cos(x))/x^2', point: '0', side: 'both' } },
    { label: '(1 + 1/x)ˣ at ∞', set: { expr: '(1 + 1/x)^x', point: 'inf', side: 'both' } },
    { label: 'x ln x at 0⁺', set: { expr: 'x ln(x)', point: '0', side: 'right' } },
    { label: '1/x at 0 (one-sided limits differ)', set: { expr: '1/x', point: '0', side: 'both' } },
    { label: '(3x² + 1)/(2x² − 5) at ∞', set: { expr: '(3x^2 + 1)/(2x^2 - 5)', point: 'inf', side: 'both' } },
  ],
  series: [
    { label: 'eˣ at 0', set: { expr: 'e^x', point: '0', terms: 6 } },
    { label: 'sin x at 0', set: { expr: 'sin(x)', point: '0', terms: 7 } },
    { label: 'ln x at 1', set: { expr: 'ln(x)', point: '1', terms: 5 } },
    { label: '1/(1 − x) at 0', set: { expr: '1/(1 - x)', point: '0', terms: 6 } },
    { label: '√x at 4', set: { expr: 'sqrt(x)', point: '4', terms: 4 } },
  ],
  extrema: [
    { label: 'Cubic: x³ − 3x', set: { expr: 'x^3 - 3x', from: '-3', to: '3' } },
    { label: 'Quartic: x⁴ − 4x²', set: { expr: 'x^4 - 4x^2', from: '-3', to: '3' } },
    { label: 'x e^(−x)', set: { expr: 'x e^(-x)', from: '-1', to: '6' } },
    { label: 'sin x + cos x', set: { expr: 'sin(x) + cos(x)', from: '0', to: '2pi' } },
  ],
  tangent: [
    { label: 'x² at 3', set: { expr: 'x^2', point: '3' } },
    { label: 'sin x at π/4', set: { expr: 'sin(x)', point: 'pi/4' } },
    { label: 'ln x at e', set: { expr: 'ln(x)', point: 'e' } },
    { label: '√x at 4', set: { expr: 'sqrt(x)', point: '4' } },
  ],
  ode: [
    { label: 'Oscillator: y″ + y = 0', set: { odeKind: 'linear', ca: '1', cb: '0', cc: '1', x0: '0', y0: '1', yp0: '0', x1: '10' } },
    { label: 'Damped: y″ + 0.4y′ + 4y = 0', set: { odeKind: 'linear', ca: '1', cb: '0.4', cc: '4', x0: '0', y0: '1', yp0: '0', x1: '15' } },
    { label: 'Two real roots: y″ − 3y′ + 2y = 0', set: { odeKind: 'linear', ca: '1', cb: '-3', cc: '2', x0: '0', y0: '1', yp0: '0', x1: '2' } },
    { label: 'Decay: y′ + 2y = 0', set: { odeKind: 'linear', ca: '0', cb: '1', cc: '2', x0: '0', y0: '5', yp0: '0', x1: '4' } },
    { label: 'Logistic: y′ = y(1 − y)', set: { odeKind: 'first', rhs: 'y (1 - y)', x0: '0', y0: '0.05', x1: '12' } },
    { label: 'y′ = x − y', set: { odeKind: 'first', rhs: 'x - y', x0: '0', y0: '1', x1: '6' } },
    { label: 'Pendulum: y″ = −9.81 sin y', set: { odeKind: 'second', rhs: '-9.81 sin(y)', x0: '0', y0: '2.5', yp0: '0', x1: '6' } },
    { label: 'Van der Pol: y″ = 2(1 − y²)y′ − y', set: { odeKind: 'second', rhs: "2 (1 - y^2) y' - y", x0: '0', y0: '0.5', yp0: '0', x1: '30' } },
  ],
  riemann: [
    { label: 'x² on [0, 1]', set: { expr: 'x^2', a: '0', b: '1', n: 8 } },
    { label: 'sin x on [0, π]', set: { expr: 'sin(x)', a: '0', b: 'pi', n: 6 } },
    { label: '1/x on [1, 4]', set: { expr: '1/x', a: '1', b: '4', n: 10 } },
    { label: 'e^(−x²) on [−2, 2]', set: { expr: 'e^(-x^2)', a: '-2', b: '2', n: 12 } },
  ],
};

const text = (v: unknown, fallback: string, max = 400) => (typeof v === 'string' && v.length <= max ? v : fallback);
const whole = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
const read = (v: Values | undefined): SolverState => ({
  mode: MODES.some((m) => m.value === v?.mode) ? (v?.mode as Mode) : DEFAULTS.mode,
  expr: text(v?.expr, DEFAULTS.expr, 2000),
  variable: typeof v?.variable === 'string' && /^[a-zA-Z]$/.test(v.variable) ? v.variable : 'x',
  order: whole(v?.order, 1, 1, 6),
  terms: whole(v?.terms, 6, 1, 12),
  definite: v?.definite === true,
  a: text(v?.a, DEFAULTS.a, 60),
  b: text(v?.b, DEFAULTS.b, 60),
  point: text(v?.point, DEFAULTS.point, 60),
  side: v?.side === 'left' || v?.side === 'right' ? v.side : 'both',
  from: text(v?.from, DEFAULTS.from, 60),
  to: text(v?.to, DEFAULTS.to, 60),
  odeKind: v?.odeKind === 'first' || v?.odeKind === 'second' ? v.odeKind : 'linear',
  ca: text(v?.ca, DEFAULTS.ca, 30),
  cb: text(v?.cb, DEFAULTS.cb, 30),
  cc: text(v?.cc, DEFAULTS.cc, 30),
  rhs: text(v?.rhs, DEFAULTS.rhs, 400),
  x0: text(v?.x0, DEFAULTS.x0, 30),
  y0: text(v?.y0, DEFAULTS.y0, 30),
  yp0: text(v?.yp0, DEFAULTS.yp0, 30),
  x1: text(v?.x1, DEFAULTS.x1, 30),
  n: whole(v?.n, 8, 1, 200),
  rule: RULES.some((r) => r.value === v?.rule) ? (v?.rule as RiemannKind) : 'midpoint',
});
const write = (s: SolverState): Values => ({ ...s });

/* ------------------------------------------------------------- loading -- */

interface Engine {
  readonly calc: Calculus;
  readonly math: MathJsInstance;
  readonly lib: typeof import('../../lib/calculus');
  readonly render: Render;
}

let engine: Promise<Engine> | null = null;
const loadEngine = () => {
  engine ??= Promise.all([import('mathjs'), import('nerdamer-prime'), import('../../lib/calculus'), import('../../lib/tex')]).then(([mathjs, nerdamer, lib, tex]) => {
    const math = mathjs.create(mathjs.all, { number: 'number' });
    const cas = lib.nerdamerCas((nerdamer as unknown as { default: unknown }).default ?? nerdamer);
    return { calc: new lib.Calculus(math, cas), math, lib, render: makeRender(tex.texToSvg) };
  });
  return engine;
};

/* -------------------------------------------------------------- solving -- */

interface Solution {
  readonly title: string;
  readonly answer: Answer | null;
  readonly graph: GraphOptions | null;
  readonly analysis?: Analysis;
  readonly riemann?: RiemannSum;
  readonly table?: { readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] };
}

function compileFn(e: Engine, expression: string, v: string): (x: number) => number {
  const c = e.calc.parse(expression).compile();
  return (x: number) => {
    try {
      const y = Number(c.evaluate({ [v]: x }));
      return Number.isFinite(y) ? y : Number.NaN;
    } catch {
      return Number.NaN;
    }
  };
}

/** A window around a point, or between two values; infinite ends get a finite stand-in. */
function windowAround(centre: number, half = 4): [number, number] {
  if (centre === Infinity) return [0, 40];
  if (centre === -Infinity) return [-40, 0];
  return [centre - half, centre + half];
}

function solve(e: Engine, s: SolverState): Solution {
  const { calc } = e;
  const v = s.variable;
  const f = s.mode === 'ode' ? null : compileFn(e, s.expr, v);
  const fLine = (label = `f(${v})`): GraphLine => ({ label, f: f ?? (() => Number.NaN) });
  switch (s.mode) {
    case 'derivative': {
      const answer = calc.derivative(s.expr, v, s.order);
      const d = answer.expression ? compileFn(e, answer.expression, v) : null;
      const label = s.order === 1 ? `f′(${v})` : `f${'′'.repeat(Math.min(s.order, 3))}${s.order > 3 ? `⁽${s.order}⁾` : ''}(${v})`;
      return {
        title: s.order === 1 ? 'Derivative' : `Derivative of order ${s.order}`,
        answer,
        graph: { from: -5, to: 5, variable: v, lines: d ? [fLine(), { label, f: d, dashed: true }] : [fLine()] },
      };
    }
    case 'integral': {
      const answer = calc.integral(s.expr, v, s.definite ? [s.a, s.b] : undefined);
      if (!s.definite) {
        const F = answer.expression ? compileFn(e, answer.expression, v) : null;
        return { title: 'Indefinite integral', answer, graph: { from: -5, to: 5, variable: v, lines: F ? [fLine(), { label: `F(${v}), with C = 0`, f: F, dashed: true }] : [fLine()] } };
      }
      const a = calc.value(s.a);
      const b = calc.value(s.b);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const span = Number.isFinite(lo) && Number.isFinite(hi) ? hi - lo : 10;
      const from = Number.isFinite(lo) ? lo - span * 0.25 : Number.isFinite(hi) ? hi - 12 : -6;
      const to = Number.isFinite(hi) ? hi + span * 0.25 : Number.isFinite(lo) ? lo + 12 : 6;
      const area: [number, number] = [Number.isFinite(lo) ? lo : from, Number.isFinite(hi) ? hi : to];
      return { title: 'Definite integral', answer, graph: { from, to, variable: v, lines: [fLine()], area } };
    }
    case 'limit': {
      const answer = calc.limit(s.expr, v, s.point, s.side);
      const a = calc.value(s.point);
      const [from, to] = windowAround(a, 3);
      const points = Number.isFinite(a) && answer.value !== undefined && Number.isFinite(answer.value) ? [{ x: a, y: answer.value, label: `limit ${fmt(answer.value)}` }] : [];
      return { title: 'Limit', answer, graph: { from, to, variable: v, lines: [fLine()], points } };
    }
    case 'series': {
      const answer = calc.taylor(s.expr, v, s.point, s.terms);
      const a = calc.value(s.point);
      const p = answer.expression ? compileFn(e, answer.expression, v) : null;
      const [from, to] = windowAround(a, 3);
      return {
        title: 'Taylor series',
        answer,
        graph: {
          from,
          to,
          variable: v,
          lines: p ? [fLine(), { label: `Taylor polynomial, order ${s.terms}`, f: p, dashed: true }] : [fLine()],
          points: [{ x: a, y: f ? f(a) : Number.NaN, label: 'centre' }],
        },
      };
    }
    case 'extrema': {
      const analysis = calc.analyse(s.expr, v, s.from, s.to);
      const from = calc.value(s.from);
      const to = calc.value(s.to);
      const d1 = compileFn(e, analysis.derivative, v);
      const points = [
        ...analysis.critical.map((c) => ({ x: c.x, y: c.y, label: c.kind === 'maximum' ? 'max' : c.kind === 'minimum' ? 'min' : 'flat' })),
        ...analysis.inflections.map((p) => ({ x: p.x, y: p.y, label: 'inflection' })),
      ];
      const rows: string[][] = [
        ...analysis.critical.map((c) => [c.kind === 'maximum' ? 'Local maximum' : c.kind === 'minimum' ? 'Local minimum' : 'Stationary (neither)', fmt(c.x), fmt(c.y)]),
        ...analysis.inflections.map((p) => ['Inflection point', fmt(p.x), fmt(p.y)]),
        ['Highest on the range', fmt(analysis.highest.x), fmt(analysis.highest.y)],
        ['Lowest on the range', fmt(analysis.lowest.x), fmt(analysis.lowest.y)],
      ];
      return {
        title: 'Extrema and inflection points',
        answer: null,
        analysis,
        table: { head: ['Point', v, `f(${v})`], rows },
        graph: { from, to, variable: v, lines: [fLine(), { label: `f′(${v})`, f: d1, dashed: true }], points },
      };
    }
    case 'tangent': {
      const answer = calc.tangent(s.expr, v, s.point);
      const a = calc.value(s.point);
      const line = answer.expression ? compileFn(e, answer.expression, v) : null;
      return {
        title: 'Tangent line',
        answer,
        graph: {
          from: a - 4,
          to: a + 4,
          variable: v,
          lines: line ? [fLine(), { label: 'tangent', f: line, dashed: true }] : [fLine()],
          points: [{ x: a, y: f ? f(a) : Number.NaN, label: 'point of contact' }],
        },
      };
    }
    case 'ode': {
      const x0 = calc.value(s.x0);
      const x1 = calc.value(s.x1);
      const y0 = calc.value(s.y0);
      const yp0 = s.odeKind === 'first' ? 0 : calc.value(s.yp0);
      if (!Number.isFinite(x0) || !Number.isFinite(x1) || x0 === x1) throw new Error('Give a finite start and end for x.');
      if (s.odeKind === 'linear') {
        const answer = calc.linearOde(calc.value(s.ca), calc.value(s.cb), calc.value(s.cc), x0, y0, yp0);
        const y = answer.expression ? compileFn(e, answer.expression, 'x') : null;
        return { title: 'Linear differential equation', answer, graph: y ? { from: Math.min(x0, x1), to: Math.max(x0, x1), variable: 'x', lines: [{ label: 'y(x)', f: y }] } : null };
      }
      const order = s.odeKind === 'first' ? 1 : 2;
      const sol = calc.ode(s.rhs, order, x0, y0, yp0, x1, 2000);
      const last = sol.x.length - 1;
      const at = (x: number) => {
        // Linear interpolation between the solver's steps.
        const t = ((x - x0) / (x1 - x0)) * (sol.x.length - 1);
        const i = Math.floor(t);
        if (i < 0 || i >= last) return i === last ? (sol.y[last] as number) : Number.NaN;
        const w = t - i;
        return (sol.y[i] as number) * (1 - w) + (sol.y[i + 1] as number) * w;
      };
      const atSlope = (x: number) => {
        const t = ((x - x0) / (x1 - x0)) * (sol.x.length - 1);
        const i = Math.floor(t);
        if (i < 0 || i >= last) return Number.NaN;
        const w = t - i;
        return (sol.yp[i] as number) * (1 - w) + (sol.yp[i + 1] as number) * w;
      };
      const eq = order === 1 ? `y' = ${s.rhs}` : `y'' = ${s.rhs}`;
      const stoppedEarly = sol.x.length < 2001;
      const rows = Array.from({ length: 11 }, (_, k) => {
        const x = x0 + ((x1 - x0) * k) / 10;
        return [fmt(x), fmt(at(x)), fmt(atSlope(x))];
      });
      const answer: Answer = {
        ok: true,
        tex: `y(${fmt(sol.x[last] as number)}) \\approx ${fmt(sol.y[last] as number)}`,
        text: fmt(sol.y[last] as number),
        steps: [
          {
            rule: 'The equation',
            tex: e.calc
              .tex(e.calc.parse(s.rhs.replace(/y''/g, 'ypp').replace(/y'/g, 'yp')))
              .replace(/\bypp\b/g, "y''")
              .replace(/\byp\b/g, "y'")
              .replace(/^/, order === 1 ? "y' = " : "y'' = "),
          },
          {
            rule: `Classical Runge–Kutta (RK4), ${sol.x.length - 1} steps of h = ${fmt((x1 - x0) / 2000)}`,
            tex: order === 1 ? 'y_{n+1} = y_n + \\tfrac{h}{6}(k_1 + 2k_2 + 2k_3 + k_4)' : "\\text{as a system: } y' = p,\\quad p' = f(x, y, p)",
          },
        ],
        check: stoppedEarly ? 'The solution grew without bound, so the solver stopped early.' : 'Numerical solution; halving the step changes the end value by less than the digits shown.',
        note: eq,
      };
      return {
        title: order === 1 ? 'First-order equation, solved numerically' : 'Second-order equation, solved numerically',
        answer,
        table: { head: ['x', 'y', order === 1 ? 'y′ = f(x, y)' : 'y′'], rows },
        graph: {
          from: Math.min(x0, x1),
          to: Math.max(x0, x1),
          variable: 'x',
          lines: [
            { label: 'y(x)', f: at },
            { label: 'y′(x)', f: atSlope, dashed: true },
          ],
        },
      };
    }
    case 'riemann': {
      const r = calc.riemann(s.expr, v, s.a, s.b, s.n, s.rule);
      const a = calc.value(s.a);
      const b = calc.value(s.b);
      const span = Math.abs(b - a);
      const name = RULES.find((k) => k.value === s.rule)?.label ?? s.rule;
      const answer: Answer = {
        ok: true,
        tex: `${s.rule === 'simpson' ? 'S' : s.rule === 'trapezoid' ? 'T' : 'R'}_{${s.n}} = ${fmt(r.sum)}`,
        text: fmt(r.sum),
        value: r.sum,
        steps: [
          { rule: `Width of each of the ${s.n} strips`, tex: `\\Delta ${v} = \\frac{b - a}{n} = ${fmt((b - a) / s.n)}` },
          {
            rule: `${name} rule`,
            tex:
              s.rule === 'trapezoid'
                ? `T_n = \\Delta ${v}\\left(\\tfrac{f(x_0)}{2} + f(x_1) + \\dots + \\tfrac{f(x_n)}{2}\\right)`
                : s.rule === 'simpson'
                  ? `S_n = \\sum \\tfrac{\\Delta ${v}}{6}\\left(f(x_{i}) + 4 f(m_i) + f(x_{i+1})\\right)`
                  : `R_n = \\Delta ${v} \\sum_{i} f(${s.rule === 'left' ? 'x_{i}' : s.rule === 'right' ? 'x_{i+1}' : 'm_i'})`,
          },
          {
            rule: 'Compared with the integral',
            tex: `\\int_{${e.calc.tex(e.calc.parse(s.a))}}^{${e.calc.tex(e.calc.parse(s.b))}} f\\,d${v} \\approx ${fmt(r.exact)},\\quad \\text{error } ${fmt(r.error)}`,
          },
        ],
        check: 'The integral is found by adaptive Gauss–Kronrod quadrature.',
      };
      const rectangles = s.rule === 'left' || s.rule === 'right' || s.rule === 'midpoint' || s.rule === 'trapezoid' ? r.pieces : [];
      return {
        title: 'Riemann sums',
        answer,
        riemann: r,
        graph: {
          from: Math.min(a, b) - span * 0.1,
          to: Math.max(a, b) + span * 0.1,
          variable: v,
          lines: [fLine()],
          rectangles,
          ...(s.rule === 'simpson' ? { area: [Math.min(a, b), Math.max(a, b)] as [number, number] } : {}),
        },
      };
    }
  }
}

/* ---------------------------------------------------------------- the tool -- */

function CalculusSolver({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, read, write);
  const [e, setEngine] = useState<Engine | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [result, setResult] = useState<{ solution: Solution | null; error: string | null }>({ solution: null, error: null });
  const [busy, setBusy] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    void loadEngine().then(
      (loaded) => setEngine(() => loaded),
      (error: unknown) => setFailed(error instanceof Error ? error.message : String(error)),
    );
  }, []);

  // Solve a moment after typing stops.
  useEffect(() => {
    if (!e) return;
    setBusy(true);
    const timer = setTimeout(
      () => {
        try {
          setResult({ solution: solve(e, state), error: null });
        } catch (error) {
          setResult({ solution: null, error: error instanceof Error ? error.message : String(error) });
        }
        setBusy(false);
      },
      first.current ? 0 : 350,
    );
    first.current = false;
    return () => clearTimeout(timer);
  }, [e, state]);

  const set = <K extends keyof SolverState>(key: K, value: SolverState[K]) => setState((s) => ({ ...s, [key]: value }));
  const sol = result.solution;
  const answer = sol?.answer ?? null;

  const save = (kind: 'html' | 'pdf') =>
    attempt(async () => {
      if (!e || !sol) throw new Error('There is no answer to save yet.');
      const html = solutionHtml({
        title: sol.title,
        question: state.mode === 'ode' ? undefined : `f(${state.variable}) = ${state.expr}`,
        answerTex: sol.answer?.tex,
        notes: [sol.answer?.note ?? '', sol.answer?.check ?? ''],
        steps: sol.answer?.steps,
        table: sol.table,
        graph: sol.graph ? e.lib.graphSvg(sol.graph) : undefined,
        render: e.render,
        tool: 'Calculus Solver',
      });
      const name = `${sol.title.replace(/[^\w ]+/g, '').trim() || 'Calculus'}`;
      if (kind === 'html') {
        const outcome = await saveFile(`${name}.html`, html, 'text/html');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      } else if (!isDesktop) printDocument(html);
      else {
        const outcome = await saveFile(`${name}.pdf`, await htmlToPdf(html), 'application/pdf');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      }
    });

  const usesExpression = state.mode !== 'ode';
  return (
    <section class="tool cx-tool" data-testid="tool" data-state={busy ? 'busy' : sol ? 'done' : 'idle'}>
      <div class="button-row cx-bar">
        <Segmented label="What to work out" value={state.mode} onChange={(mode) => set('mode', mode)} choices={MODES} />
      </div>

      <div class="cx-inputs" data-testid="cx-inputs">
        {usesExpression && (
          <Field label={`f(${state.variable}) =`} value={state.expr} onInput={(v) => set('expr', v)} test="cx-expr" wide hint="For example x^2 sin(x), e^(-x), ln(x), sqrt(x), atan(x), pi" />
        )}
        {usesExpression && (
          <label class="cx-field cx-narrow">
            <span class="control-label">Variable</span>
            <input
              class="input cx-input"
              value={state.variable}
              maxLength={1}
              onInput={(ev) => /^[a-zA-Z]?$/.test(ev.currentTarget.value) && ev.currentTarget.value && set('variable', ev.currentTarget.value)}
              data-testid="cx-variable"
            />
          </label>
        )}
        {state.mode === 'derivative' && (
          <label class="cx-field cx-narrow">
            <span class="control-label">Order</span>
            <select class="select" value={String(state.order)} onChange={(ev) => set('order', Number(ev.currentTarget.value))} data-testid="cx-order">
              {[1, 2, 3, 4, 5, 6].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        )}
        {state.mode === 'integral' && (
          <>
            <Segmented
              label="Kind of integral"
              value={state.definite ? 'definite' : 'indefinite'}
              onChange={(k) => set('definite', k === 'definite')}
              choices={[
                { value: 'indefinite', label: 'Indefinite' },
                { value: 'definite', label: 'Definite' },
              ]}
            />
            {state.definite && <Field label="From" value={state.a} onInput={(v) => set('a', v)} test="cx-a" hint="A number, pi, e, or inf" />}
            {state.definite && <Field label="To" value={state.b} onInput={(v) => set('b', v)} test="cx-b" hint="A number, pi, e, or inf" />}
          </>
        )}
        {state.mode === 'limit' && (
          <>
            <Field label={`${state.variable} approaches`} value={state.point} onInput={(v) => set('point', v)} test="cx-point" hint="A number, or inf or -inf" />
            <Segmented
              label="From which side"
              value={state.side}
              onChange={(side) => set('side', side)}
              choices={[
                { value: 'both', label: 'Both sides' },
                { value: 'left', label: 'From the left' },
                { value: 'right', label: 'From the right' },
              ]}
            />
          </>
        )}
        {state.mode === 'series' && (
          <>
            <Field label="Around" value={state.point} onInput={(v) => set('point', v)} test="cx-point" />
            <label class="cx-field cx-narrow">
              <span class="control-label">Order</span>
              <select class="select" value={String(state.terms)} onChange={(ev) => set('terms', Number(ev.currentTarget.value))} data-testid="cx-terms">
                {Array.from({ length: 12 }, (_, k) => k + 1).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {state.mode === 'extrema' && (
          <>
            <Field label="From" value={state.from} onInput={(v) => set('from', v)} test="cx-from" />
            <Field label="To" value={state.to} onInput={(v) => set('to', v)} test="cx-to" />
          </>
        )}
        {state.mode === 'tangent' && <Field label={`At ${state.variable} =`} value={state.point} onInput={(v) => set('point', v)} test="cx-point" />}
        {state.mode === 'ode' && (
          <>
            <Segmented
              label="Kind of equation"
              value={state.odeKind}
              onChange={(k) => set('odeKind', k)}
              choices={[
                { value: 'linear', label: 'a y″ + b y′ + c y = 0 (exact)' },
                { value: 'first', label: 'y′ = f(x, y)' },
                { value: 'second', label: 'y″ = f(x, y, y′)' },
              ]}
            />
            {state.odeKind === 'linear' ? (
              <>
                <Field label="a" value={state.ca} onInput={(v) => set('ca', v)} test="cx-ca" />
                <Field label="b" value={state.cb} onInput={(v) => set('cb', v)} test="cx-cb" />
                <Field label="c" value={state.cc} onInput={(v) => set('cc', v)} test="cx-cc" />
              </>
            ) : (
              <Field label={state.odeKind === 'first' ? 'y′ =' : 'y″ ='} value={state.rhs} onInput={(v) => set('rhs', v)} test="cx-rhs" wide hint="Use x, y and (for second order) y'" />
            )}
            <Field label="x₀" value={state.x0} onInput={(v) => set('x0', v)} test="cx-x0" />
            <Field label="y(x₀)" value={state.y0} onInput={(v) => set('y0', v)} test="cx-y0" />
            {state.odeKind !== 'first' && <Field label="y′(x₀)" value={state.yp0} onInput={(v) => set('yp0', v)} test="cx-yp0" />}
            <Field label="Up to x =" value={state.x1} onInput={(v) => set('x1', v)} test="cx-x1" />
          </>
        )}
        {state.mode === 'riemann' && (
          <>
            <Field label="From" value={state.a} onInput={(v) => set('a', v)} test="cx-a" />
            <Field label="To" value={state.b} onInput={(v) => set('b', v)} test="cx-b" />
            <label class="cx-field cx-narrow">
              <span class="control-label">Strips</span>
              <input
                class="input input-number cx-input"
                type="number"
                min={1}
                max={200}
                value={state.n}
                onInput={(ev) =>
                  Number.isInteger(Number(ev.currentTarget.value)) && Number(ev.currentTarget.value) >= 1 && Number(ev.currentTarget.value) <= 200 && set('n', Number(ev.currentTarget.value))
                }
                data-testid="cx-n"
              />
            </label>
            <Segmented label="Rule" value={state.rule} onChange={(r) => set('rule', r)} choices={RULES} />
          </>
        )}
        <label class="cx-field">
          <span class="control-label">Examples</span>
          <select
            class="select"
            value=""
            data-testid="cx-example"
            onChange={(ev) => {
              const pick = EXAMPLES[state.mode][Number(ev.currentTarget.value)];
              if (pick) setState((s) => ({ ...s, ...pick.set }));
              ev.currentTarget.value = '';
            }}
          >
            <option value="">Choose an example…</option>
            {EXAMPLES[state.mode].map((x, i) => (
              <option key={x.label} value={i}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {failed && <p class="tone-bad">The solver could not load: {failed}</p>}
      {!e && !failed && <p class="tone-muted">Loading the solver…</p>}
      {result.error && (
        <p class="cx-error" role="alert" data-testid="cx-error">
          <Icon name="alert" /> {result.error}
        </p>
      )}

      {e && sol && (
        <div class="cx-out">
          <div class="cx-result" data-testid="cx-result">
            <h2 class="cx-title">{sol.title}</h2>
            {answer && (
              <>
                <div class="cx-answer" data-testid="cx-answer" data-ok={answer.ok ? 'yes' : 'no'} {...scrollRegion('Answer')}>
                  <Tex render={e.render} latex={answer.ok ? answer.tex : answer.text ? `${answer.tex}\\ \\text{${answer.text}}` : answer.tex} display />
                </div>
                {answer.note && <p class="cx-note">{answer.note}</p>}
                {answer.check && (
                  <p class={answer.ok ? 'cx-check' : 'cx-note'} data-testid="cx-check">
                    {answer.ok ? '✓ ' : ''}
                    {answer.check}
                  </p>
                )}
              </>
            )}
            <div class="button-row cx-actions">
              {answer && (
                <button type="button" class="button button-small" onClick={() => attempt(async () => copyText(answer.tex).then(() => notify('LaTeX copied')))} data-testid="cx-copy-tex">
                  <Icon name="copy" /> Copy LaTeX
                </button>
              )}
              {answer?.expression && (
                <button type="button" class="button button-small" onClick={() => attempt(async () => copyText(answer.expression ?? '').then(() => notify('Expression copied')))}>
                  <Icon name="copy" /> Copy as text
                </button>
              )}
              <button type="button" class="button button-small" onClick={() => save('html')} data-testid="cx-save-html">
                Save as web page
              </button>
              <button type="button" class="button button-small" onClick={() => save('pdf')}>
                {isDesktop ? 'Save as PDF' : 'Print or PDF'}
              </button>
            </div>
            {sol.table && <ResultTable table={sol.table} label={sol.title} />}
            {sol.analysis && (
              <div class="cx-intervals">
                <p>
                  <Tex render={e.render} latex={`f'(${state.variable}) = ${sol.analysis.derivativeTex},\\qquad f''(${state.variable}) = ${sol.analysis.secondTex}`} />
                </p>
                <p class="tone-muted">
                  Rising on {sol.analysis.rising.length ? sol.analysis.rising.map(([p, q]) => `(${fmt(p)}, ${fmt(q)})`).join(', ') : 'no interval'}; falling on{' '}
                  {sol.analysis.falling.length ? sol.analysis.falling.map(([p, q]) => `(${fmt(p)}, ${fmt(q)})`).join(', ') : 'no interval'}.
                </p>
              </div>
            )}
            {sol.riemann && (
              <p class="tone-muted" data-testid="cx-riemann">
                Sum {fmt(sol.riemann.sum)}; integral {fmt(sol.riemann.exact)}; error {fmt(sol.riemann.error)} (
                {fmt((100 * Math.abs(sol.riemann.error)) / Math.max(1e-300, Math.abs(sol.riemann.exact)))} %).
              </p>
            )}
          </div>
          {sol.graph && <SolverGraph kit={e.lib} options={sol.graph} />}
          {answer && <StepsList render={e.render} steps={answer.steps} />}
        </div>
      )}
      <details class="cx-help">
        <summary>How to type maths</summary>
        <p>
          Powers with <code>^</code> (<code>x^2</code>, <code>e^(-x)</code>), roots with <code>sqrt(x)</code>, logarithms with <code>ln(x)</code> or <code>log(x, 10)</code>, and the trigonometric and
          hyperbolic functions by name (<code>sin</code>, <code>atan</code>, <code>cosh</code>). Multiplication can be written <code>2x</code> or <code>2*x</code>; <code>pi</code>, <code>e</code> and{' '}
          <code>inf</code> are understood.
        </p>
      </details>
    </section>
  );
}

export default defineCustomTool(CalculusSolver);
