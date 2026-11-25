/**
 * Calculus with worked steps: derivatives (any order, partial), integrals
 * (indefinite and definite), limits, Taylor series, critical and
 * inflection points, tangent lines, differential equations and Riemann
 * sums.  The steps come from rules applied to mathjs expression trees, the
 * way a textbook works; when the rules run out, a computer algebra system
 * (nerdamer) may supply the answer without steps.  Every answer is checked
 * numerically before it is shown.
 */
import type { MathJsInstance, MathNode } from 'mathjs';
import { polynomialRoots } from './poly-roots';
import { CHART_COLORS, niceScale } from './svg-chart';
import { escapeXml } from './text';

export interface Step {
  /** What was done, in words. */
  readonly rule: string;
  /** The working, as TeX. */
  readonly tex: string;
}

export interface Answer {
  readonly ok: boolean;
  /** The answer, as TeX. */
  readonly tex: string;
  readonly text: string;
  readonly steps: readonly Step[];
  /** How the answer was checked. */
  readonly check: string;
  /** The answer as a number, when it is one. */
  readonly value?: number;
  /** The answer as an expression of the variable (derivative, antiderivative, polynomial). */
  readonly expression?: string;
  readonly note?: string;
}

/** A computer algebra system to fall back on (nerdamer); every method returns null when it cannot help. */
export interface Cas {
  integrate(expression: string, variable: string): { text: string; tex: string } | null;
  partfrac(expression: string, variable: string): string | null;
}

/** Adapts nerdamer (nerdamer-prime) to the fallback interface; its console chatter is silenced. */
export function nerdamerCas(nerdamer: unknown): Cas {
  const n = nerdamer as {
    (text: string): { toString(): string; toTeX(): string };
    integrate(text: string, v: string): { toString(): string; toTeX(): string };
  };
  const quiet = <T>(run: () => T): T | null => {
    const log = console.log;
    const warn = console.warn;
    console.log = () => undefined;
    console.warn = () => undefined;
    try {
      return run();
    } catch {
      return null;
    } finally {
      console.log = log;
      console.warn = warn;
    }
  };
  return {
    integrate: (expression, variable) =>
      quiet(() => {
        const r = n.integrate(expression, variable);
        const text = r.toString();
        return /integrate\(/.test(text) ? null : { text, tex: r.toTeX() };
      }),
    partfrac: (expression, variable) =>
      quiet(() => {
        const text = n(`partfrac(${expression}, ${variable})`).toString();
        return /partfrac\(/.test(text) ? null : text;
      }),
  };
}

/** Close to a simple closed form?  Integers, fractions, and fractions of π, e, square roots and logarithms. */
export function recognise(x: number): { tex: string; text: string } | null {
  if (!Number.isFinite(x)) return null;
  if (Math.abs(x) < 1e-13) return { tex: '0', text: '0' };
  const frac = (v: number, maxDen = 1000): [number, number] | null => {
    // Continued fractions: the simplest fraction within a part in 10¹¹.
    let h0 = 1;
    let h1 = 0;
    let k0 = 0;
    let k1 = 1;
    let b = v;
    for (let i = 0; i < 30; i++) {
      const a = Math.floor(b);
      [h0, h1] = [a * h0 + h1, h0];
      [k0, k1] = [a * k0 + k1, k0];
      if (k0 > maxDen) return null;
      if (Math.abs(v - h0 / k0) <= 1e-11 * Math.max(1, Math.abs(v))) return [h0, k0];
      const r = b - a;
      if (r < 1e-15) break;
      b = 1 / r;
    }
    return null;
  };
  const show = (p: number, q: number, factor: string, factorText: string): { tex: string; text: string } => {
    const sign = p < 0 ? '-' : '';
    const ap = Math.abs(p);
    if (q === 1) return { tex: `${sign}${ap === 1 && factor ? '' : ap}${factor}`, text: `${sign}${ap === 1 && factorText ? '' : ap}${factorText}` };
    return { tex: `${sign}\\frac{${ap === 1 && factor ? '' : ap}${factor || ''}}{${q}}`, text: `${sign}${ap === 1 && factorText ? '' : ap}${factorText}/${q}` };
  };
  const plain = frac(x);
  if (plain) return show(plain[0], plain[1], '', '');
  const forms: [number, string, string][] = [
    [Math.PI, '\\pi', 'π'],
    [Math.E, 'e', 'e'],
    [Math.SQRT2, '\\sqrt{2}', '√2'],
    [Math.sqrt(3), '\\sqrt{3}', '√3'],
    [Math.sqrt(5), '\\sqrt{5}', '√5'],
    [Math.sqrt(Math.PI), '\\sqrt{\\pi}', '√π'],
    [Math.LN2, '\\ln 2', 'ln 2'],
    [Math.log(3), '\\ln 3', 'ln 3'],
    [Math.PI ** 2, '\\pi^{2}', 'π²'],
    [1 / Math.PI, '\\frac{1}{\\pi}', '1/π'],
  ];
  for (const [value, tex, text] of forms) {
    const f = frac(x / value, 100);
    if (f) return show(f[0], f[1], tex, text);
  }
  return null;
}

/** A number for display: a closed form if there is one, else 10 significant digits. */
export function showNumber(x: number): { tex: string; text: string } {
  const r = recognise(x);
  if (r) return r;
  if (!Number.isFinite(x)) return Number.isNaN(x) ? { tex: '\\text{undefined}', text: 'undefined' } : x > 0 ? { tex: '\\infty', text: '∞' } : { tex: '-\\infty', text: '−∞' };
  const t = Number(x.toPrecision(10)).toString();
  const m = /^(-?[\d.]+)e([+-]\d+)$/.exec(t);
  return m ? { tex: `${m[1]}\\times 10^{${Number(m[2])}}`, text: t } : { tex: t, text: t };
}

/* ------------------------------------------------------------- the engine -- */

type Builder = (ds: MathNode[]) => MathNode;

export class Calculus {
  constructor(
    private readonly math: MathJsInstance,
    private readonly cas: Cas | null = null,
  ) {}

  /* -------------------------------------------------------------- reading -- */

  /** Reads an expression: ln is log, ** is ^, π and ∞ and the Unicode operators are allowed. */
  parse(text: string): MathNode {
    const clean = text
      .replace(/\*\*/g, '^')
      .replace(/π/g, 'pi')
      .replace(/∞/g, 'Infinity')
      .replace(/[·×]/g, '*')
      .replace(/÷/g, '/')
      .replace(/[−–]/g, '-')
      .replace(/√\s*\(/g, 'sqrt(')
      .replace(/\bln\s*\(/g, 'log(')
      .replace(/\barc(sin|cos|tan)\s*\(/g, 'a$1(')
      .replace(/\binf(inity)?\b/gi, 'Infinity')
      // x(x + 1) and y (1 − y) are products, not calls: a lone letter (or pi) before a bracket multiplies.
      .replace(/(^|[^A-Za-z0-9_.])([A-Za-z]|pi|yp|ypp)\s*\(/g, '$1$2*(');
    if (!clean.trim()) throw new Error('Type an expression, such as x^2 sin(x).');
    try {
      return this.math.parse(clean);
    } catch (e) {
      throw new Error(`The expression could not be read: ${e instanceof Error ? e.message.replace(/\s*\(char \d+\)$/, '') : String(e)}`);
    }
  }

  value(text: string): number {
    const v = Number(this.parse(text).evaluate({}));
    if (Number.isNaN(v)) throw new Error(`“${text}” is not a number.`);
    return v;
  }

  tex(node: MathNode, v?: string): string {
    const math = this.math;
    return (
      node
        .toTex({
          parenthesis: 'auto',
          implicit: 'hide',
          handler: (n: MathNode, options: object) => {
            if (math.isFunctionNode(n)) {
              const f = n as unknown as { fn: { name: string }; args: MathNode[] };
              if (f.fn.name === '__D') return `\\frac{d}{d${v ?? 'x'}}\\left[${(f.args[0] as MathNode).toTex(options)}\\right]`;
              if (f.fn.name === '__I') return `\\int ${(f.args[0] as MathNode).toTex(options)}\\,d${v ?? 'x'}`;
              if (f.fn.name === 'log' && f.args.length === 1) return `\\ln\\left(${(f.args[0] as MathNode).toTex(options)}\\right)`;
              if (f.fn.name === 'abs') return `\\left|${(f.args[0] as MathNode).toTex(options)}\\right|`;
            }
            if (math.isSymbolNode(n) && (n as unknown as { name: string }).name === 'Infinity') return '\\infty';
            // −x²·e^(−x) needs no brackets: −(ab) reads the same as (−a)b.
            if (math.isOperatorNode(n) && (n as unknown as { fn: string }).fn === 'unaryMinus') {
              const inner = this.strip((n as unknown as { args: MathNode[] }).args[0] as MathNode);
              if (math.isOperatorNode(inner) && ['multiply', 'divide'].includes((inner as unknown as { fn: string }).fn)) return `-${inner.toTex(options)}`;
            }
            return undefined;
          },
        })
        .replace(/~/g, ' ')
        // 2x, x·sin x and 2(x + 1) as written by hand: no dot before a letter, a command or a bracket.
        .replace(/\\cdot\s*(?=(?:\{\s*)*(?:[a-zA-Z]|\\(?!cdot)))/g, ' ')
    );
  }

  depends(node: MathNode, v: string): boolean {
    return node.filter((n: MathNode, path: string) => this.math.isSymbolNode(n) && path !== 'fn' && (n as unknown as { name: string }).name === v).length > 0;
  }

  private strip(node: MathNode): MathNode {
    let n = node;
    while (this.math.isParenthesisNode(n)) n = (n as unknown as { content: MathNode }).content;
    return n;
  }

  /* ------------------------------------------------------------- building -- */

  private num(n: number): MathNode {
    return n < 0 ? new this.math.OperatorNode('-', 'unaryMinus', [new this.math.ConstantNode(-n)]) : new this.math.ConstantNode(n);
  }
  private sym(name: string): MathNode {
    return new this.math.SymbolNode(name);
  }
  private isNum(n: MathNode, value: number): boolean {
    const s = this.strip(n);
    if (this.math.isConstantNode(s)) return (s as unknown as { value: unknown }).value === value;
    return false;
  }
  private add(a: MathNode, b: MathNode): MathNode {
    if (this.isNum(a, 0)) return b;
    if (this.isNum(b, 0)) return a;
    return new this.math.OperatorNode('+', 'add', [a, b]);
  }
  private sub(a: MathNode, b: MathNode): MathNode {
    if (this.isNum(b, 0)) return a;
    if (this.isNum(a, 0)) return this.neg(b);
    return new this.math.OperatorNode('-', 'subtract', [a, b]);
  }
  private mul(a: MathNode, b: MathNode): MathNode {
    if (this.isNum(a, 0) || this.isNum(b, 0)) return this.num(0);
    if (this.isNum(a, 1)) return b;
    if (this.isNum(b, 1)) return a;
    const negative = (n: MathNode) => this.math.isOperatorNode(n) && (n as unknown as { fn: string }).fn === 'unaryMinus';
    return new this.math.OperatorNode('*', 'multiply', [a, negative(b) ? this.paren(b) : b]);
  }
  private div(a: MathNode, b: MathNode): MathNode {
    if (this.isNum(b, 1)) return a;
    return new this.math.OperatorNode('/', 'divide', [a, b]);
  }
  private pow(a: MathNode, b: MathNode): MathNode {
    if (this.isNum(b, 1)) return a;
    if (this.isNum(b, 0)) return this.num(1);
    return new this.math.OperatorNode('^', 'pow', [a, b]);
  }
  private neg(a: MathNode): MathNode {
    if (this.isNum(a, 0)) return a;
    return new this.math.OperatorNode('-', 'unaryMinus', [a]);
  }
  private fn(name: string, ...args: MathNode[]): MathNode {
    return new this.math.FunctionNode(name, args);
  }
  private paren(a: MathNode): MathNode {
    return new this.math.ParenthesisNode(a);
  }

  simplify(node: MathNode): MathNode {
    try {
      // mathjs's own rules, and square roots squared (valid wherever the root is real).
      const rules = [...(this.math.simplify as unknown as { rules: unknown[] }).rules, 'sqrt(n)^2 -> n', 'sqrt(n) * sqrt(n) -> n', 'n / sqrt(n) -> sqrt(n)'];
      return this.math.simplify(node, rules as Parameters<MathJsInstance['simplify']>[1]);
    } catch {
      try {
        return this.math.simplify(node);
      } catch {
        return node;
      }
    }
  }

  /** The simplest-reading form: mathjs's simplification, or one fraction for rational expressions. */
  tidy(node: MathNode): MathNode {
    const simple = this.simplify(node);
    const divides = (n: MathNode) => n.filter((m: MathNode) => this.math.isOperatorNode(m) && (m as unknown as { fn: string }).fn === 'divide').length;
    let best = simple;
    if (divides(simple) > 1) {
      // mathjs's rationalize declines some of simplify's own output, so the original goes in too.
      for (const n of [node, simple]) {
        try {
          const rational = this.math.rationalize(n);
          if (divides(rational) <= 1 && rational.toString().length < Math.min(best.toString().length * 1.6, best === simple ? Infinity : best.toString().length)) best = rational;
        } catch {
          // Not rational.
        }
      }
    }
    return this.clean(best);
  }

  /** Constants in front, and minus signs out of products and fractions: 3·sin(2x)/2, not sin(2x)·3/2. */
  private clean(node: MathNode): MathNode {
    const math = this.math;
    const numeric = (n: MathNode): number | null => {
      const s = this.strip(n);
      if (math.isConstantNode(s) && typeof (s as unknown as { value: unknown }).value === 'number') return (s as unknown as { value: number }).value;
      if (math.isOperatorNode(s) && (s as unknown as { fn: string }).fn === 'unaryMinus') {
        const inner = numeric((s as unknown as { args: MathNode[] }).args[0] as MathNode);
        return inner === null ? null : -inner;
      }
      return null;
    };
    const walk = (n: MathNode): MathNode => {
      const m = n.map((child: MathNode) => walk(child));
      if (!math.isOperatorNode(m)) return m;
      const op = m as unknown as { fn: string; args: MathNode[] };
      if (op.fn === 'multiply' && op.args.length === 2) {
        // Factors in the order a hand would write them: numbers, powers of letters, exponentials, functions, brackets.
        const flat: MathNode[] = [];
        const gather = (n: MathNode) => {
          if (math.isOperatorNode(n) && (n as unknown as { fn: string }).fn === 'multiply' && (n as unknown as { args: MathNode[] }).args.length === 2)
            for (const f of (n as unknown as { args: MathNode[] }).args) gather(f);
          else flat.push(n);
        };
        gather(m);
        const rank = (n0: MathNode): number => {
          const n = this.strip(n0);
          if (numeric(n) !== null) return 0;
          if (math.isSymbolNode(n)) return ['pi', 'e'].includes((n as unknown as { name: string }).name) ? 0.5 : 1;
          if (math.isOperatorNode(n) && (n as unknown as { fn: string }).fn === 'pow') {
            const [base, exp] = (n as unknown as { args: MathNode[] }).args.map((x) => this.strip(x)) as [MathNode, MathNode];
            if (math.isSymbolNode(base)) {
              if ((base as unknown as { name: string }).name === 'e') return 2.5;
              return numeric(exp) !== null ? 1 : 2;
            }
            return math.isFunctionNode(base) ? 3 : 4;
          }
          if (math.isFunctionNode(n)) return (n as unknown as { fn: { name: string } }).fn.name === 'exp' ? 2.5 : 3;
          return 4;
        };
        const sorted = [...flat].sort((x, y) => rank(x) - rank(y));
        let ordered: MathNode = m;
        if (sorted.some((f, i) => f !== flat[i])) {
          ordered = sorted[0] as MathNode;
          for (const f of sorted.slice(1)) ordered = new math.OperatorNode('*', 'multiply', [ordered, f]);
        }
        let [a, b] = (ordered as unknown as { args: MathNode[] }).args as [MathNode, MathNode];
        if (numeric(b) !== null && numeric(a) === null) [a, b] = [b, a];
        const c = numeric(a);
        if (c !== null && c < 0) {
          const rest = c === -1 ? b : new math.OperatorNode('*', 'multiply', [new math.ConstantNode(-c), b]);
          return new math.OperatorNode('-', 'unaryMinus', [rest]);
        }
        // x²·(−e^(−x)) reads −x²·e^(−x); (−x² − 2)·e^(−x) reads −(x² + 2)·e^(−x).
        const negated = (n: MathNode): MathNode | null => {
          const t = this.strip(n);
          if (!math.isOperatorNode(t)) return null;
          const o = t as unknown as { fn: string; args: MathNode[] };
          if (o.fn === 'unaryMinus') return o.args[0] as MathNode;
          if (o.fn === 'subtract') {
            const first = this.strip(o.args[0] as MathNode);
            if (math.isOperatorNode(first) && (first as unknown as { fn: string }).fn === 'unaryMinus')
              return new math.ParenthesisNode(new math.OperatorNode('+', 'add', [(first as unknown as { args: MathNode[] }).args[0] as MathNode, o.args[1] as MathNode]));
          }
          return null;
        };
        if (c === null) {
          const nb = negated(b);
          if (nb) return new math.OperatorNode('-', 'unaryMinus', [new math.OperatorNode('*', 'multiply', [a, nb])]);
          const na = negated(a);
          if (na) return new math.OperatorNode('-', 'unaryMinus', [new math.OperatorNode('*', 'multiply', [na, b])]);
        }
        return a === (ordered as unknown as { args: MathNode[] }).args[0] ? ordered : new math.OperatorNode('*', 'multiply', [a, b]);
      }
      if ((op.fn === 'add' || op.fn === 'subtract') && op.args.length === 2) {
        const [p, q] = op.args as [MathNode, MathNode];
        const sq = this.strip(q);
        if (math.isOperatorNode(sq) && (sq as unknown as { fn: string }).fn === 'unaryMinus') {
          const inner = (sq as unknown as { args: MathNode[] }).args[0] as MathNode;
          return op.fn === 'add' ? new math.OperatorNode('-', 'subtract', [p, inner]) : new math.OperatorNode('+', 'add', [p, inner]);
        }
        return m;
      }
      if (op.fn === 'divide') {
        const [p, q] = op.args as [MathNode, MathNode];
        const sp = this.strip(p);
        if (math.isOperatorNode(sp) && (sp as unknown as { fn: string }).fn === 'unaryMinus')
          return new math.OperatorNode('-', 'unaryMinus', [new math.OperatorNode('/', 'divide', [(sp as unknown as { args: MathNode[] }).args[0] as MathNode, q])]);
      }
      return m;
    };
    try {
      return walk(node);
    } catch {
      return node;
    }
  }

  /** 1/e^w and p/e^w become e^(−w) and p·e^(−w), which the integral table knows. */
  private normaliseExp(node: MathNode): MathNode {
    const math = this.math;
    const isE = (n: MathNode) => math.isSymbolNode(n) && (n as unknown as { name: string }).name === 'e';
    return node.transform((n: MathNode) => {
      if (!math.isOperatorNode(n) || (n as unknown as { fn: string }).fn !== 'divide') return n;
      const [p, q0] = (n as unknown as { args: MathNode[] }).args as [MathNode, MathNode];
      const q = this.strip(q0);
      let flipped: MathNode | null = null;
      if (math.isOperatorNode(q) && (q as unknown as { fn: string }).fn === 'pow' && isE(this.strip((q as unknown as { args: MathNode[] }).args[0] as MathNode)))
        flipped = this.pow(this.sym('e'), this.paren(this.simplify(this.neg(this.paren((q as unknown as { args: MathNode[] }).args[1] as MathNode)))));
      else if (math.isFunctionNode(q) && (q as unknown as { fn: { name: string } }).fn.name === 'exp')
        flipped = this.pow(this.sym('e'), this.paren(this.simplify(this.neg(this.paren((q as unknown as { args: MathNode[] }).args[0] as MathNode)))));
      if (!flipped) return n;
      return this.isNum(p, 1) ? flipped : this.mul(p, flipped);
    });
  }

  /** Whether two expressions agree at sample points where both are real numbers. */
  agree(a: MathNode, b: MathNode, v: string, points = [0.37, 1.21, 2.53, -0.73, -1.91, 3.7, 0.11]): boolean {
    let compared = 0;
    const fa = a.compile();
    const fb = b.compile();
    for (const x of points) {
      let ya: number;
      let yb: number;
      try {
        ya = Number(fa.evaluate({ [v]: x }));
        yb = Number(fb.evaluate({ [v]: x }));
      } catch {
        continue;
      }
      if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue;
      if (Math.abs(ya - yb) > 1e-7 * Math.max(1, Math.abs(ya), Math.abs(yb))) return false;
      compared++;
    }
    return compared >= 2;
  }

  /* ---------------------------------------------------------- derivatives -- */

  private D(node: MathNode): MathNode {
    return this.fn('__D', node);
  }

  /** Differentiates with steps: each rule is written out with the derivatives still to take, then those are taken. */
  private d(node0: MathNode, v: string, steps: Step[]): MathNode {
    const math = this.math;
    const node = this.strip(node0);
    if (!this.depends(node, v)) return this.num(0);
    if (math.isSymbolNode(node)) return this.num(1);
    const rule = (name: string, children: MathNode[], build: Builder): MathNode => {
      if (steps.length < 80) steps.push({ rule: name, tex: `${this.tex(this.D(node), v)} = ${this.tex(build(children.map((c) => this.D(c))), v)}` });
      return build(children.map((c) => this.d(c, v, steps)));
    };
    const isVar = (u: MathNode) => math.isSymbolNode(this.strip(u)) && (this.strip(u) as unknown as { name: string }).name === v;
    /** Chain rule: f′(u)·u′, or just f′(x) when u is the variable. */
    const chain = (name: string, u: MathNode, outer: MathNode): MathNode =>
      isVar(u) ? rule(name, [], () => outer) : rule(`${name} with the chain rule`, [u], ([du]) => this.mul(outer, this.paren(du as MathNode)));
    if (math.isOperatorNode(node)) {
      const op = node as unknown as { fn: string; args: MathNode[] };
      const [a, b] = op.args as [MathNode, MathNode];
      switch (op.fn) {
        case 'unaryMinus':
          return rule('Constant multiple rule', [a], ([da]) => this.neg(this.paren(da as MathNode)));
        case 'unaryPlus':
          return this.d(a, v, steps);
        case 'add':
          return rule('Sum rule', [a, b], ([da, db]) => this.add(da as MathNode, db as MathNode));
        case 'subtract':
          return rule('Difference rule', [a, b], ([da, db]) => this.sub(da as MathNode, this.paren(db as MathNode)));
        case 'multiply':
          if (!this.depends(a, v)) return rule('Constant multiple rule', [b], ([db]) => this.mul(a, this.paren(db as MathNode)));
          if (!this.depends(b, v)) return rule('Constant multiple rule', [a], ([da]) => this.mul(b, this.paren(da as MathNode)));
          return rule('Product rule', [a, b], ([da, db]) => this.add(this.mul(this.paren(da as MathNode), b), this.mul(a, this.paren(db as MathNode))));
        case 'divide':
          if (!this.depends(b, v)) return rule('Constant multiple rule', [a], ([da]) => this.div(this.paren(da as MathNode), b));
          if (!this.depends(a, v)) return rule('Reciprocal rule', [b], ([db]) => this.neg(this.div(this.mul(a, this.paren(db as MathNode)), this.pow(this.paren(b), this.num(2)))));
          return rule('Quotient rule', [a, b], ([da, db]) =>
            this.div(this.sub(this.mul(this.paren(da as MathNode), b), this.mul(a, this.paren(db as MathNode))), this.pow(this.paren(b), this.num(2))),
          );
        case 'pow': {
          if (!this.depends(b, v)) {
            const n = this.simplify(this.sub(b, this.num(1)));
            return chain('Power rule', a, this.mul(b, this.pow(this.paren(a), n)));
          }
          if (!this.depends(a, v)) {
            const isE = math.isSymbolNode(this.strip(a)) && (this.strip(a) as unknown as { name: string }).name === 'e';
            return chain(isE ? 'Exponential rule' : 'Exponential rule (base a: aᵘ ln a)', b, isE ? node : this.mul(node, this.fn('log', a)));
          }
          // u^w = e^(w ln u): logarithmic differentiation.
          return rule('Logarithmic differentiation', [a, b], ([da, db]) =>
            this.mul(node, this.paren(this.add(this.mul(this.paren(db as MathNode), this.fn('log', a)), this.div(this.mul(b, this.paren(da as MathNode)), a)))),
          );
        }
        default:
          break;
      }
    }
    if (math.isFunctionNode(node)) {
      const f = node as unknown as { fn: { name: string }; args: MathNode[] };
      const name = f.fn.name;
      const u = f.args[0] as MathNode;
      const two = this.num(2);
      const one = this.num(1);
      if (f.args.length === 1) {
        switch (name) {
          case 'sin':
            return chain('Derivative of sine', u, this.fn('cos', u));
          case 'cos':
            return chain('Derivative of cosine', u, this.neg(this.fn('sin', u)));
          case 'tan':
            return chain('Derivative of tangent', u, this.pow(this.fn('sec', u), two));
          case 'sec':
            return chain('Derivative of secant', u, this.mul(this.fn('sec', u), this.fn('tan', u)));
          case 'csc':
            return chain('Derivative of cosecant', u, this.neg(this.mul(this.fn('csc', u), this.fn('cot', u))));
          case 'cot':
            return chain('Derivative of cotangent', u, this.neg(this.pow(this.fn('csc', u), two)));
          case 'asin':
            return chain('Derivative of arcsine', u, this.div(one, this.fn('sqrt', this.sub(one, this.pow(this.paren(u), two)))));
          case 'acos':
            return chain('Derivative of arccosine', u, this.neg(this.div(one, this.fn('sqrt', this.sub(one, this.pow(this.paren(u), two))))));
          case 'atan':
            return chain('Derivative of arctangent', u, this.div(one, this.add(one, this.pow(this.paren(u), two))));
          case 'sinh':
            return chain('Derivative of sinh', u, this.fn('cosh', u));
          case 'cosh':
            return chain('Derivative of cosh', u, this.fn('sinh', u));
          case 'tanh':
            return chain('Derivative of tanh', u, this.sub(one, this.pow(this.fn('tanh', u), two)));
          case 'exp':
            return chain('Exponential rule', u, node);
          case 'log':
            return chain('Derivative of the natural logarithm', u, this.div(one, u));
          case 'log10':
            return chain('Derivative of the logarithm', u, this.div(one, this.mul(u, this.fn('log', this.num(10)))));
          case 'log2':
            return chain('Derivative of the logarithm', u, this.div(one, this.mul(u, this.fn('log', two))));
          case 'sqrt':
            return chain('Derivative of the square root', u, this.div(one, this.mul(two, node)));
          case 'cbrt':
            return chain('Derivative of the cube root', u, this.div(one, this.mul(this.num(3), this.pow(node, two))));
          case 'abs':
            return chain('Derivative of the absolute value', u, this.div(u, node));
          default:
            break;
        }
      } else if (name === 'log' && f.args.length === 2 && !this.depends(f.args[1] as MathNode, v)) {
        return chain('Derivative of the logarithm', u, this.div(one, this.mul(u, this.fn('log', f.args[1] as MathNode))));
      }
    }
    // Anything else: mathjs's own rules, without a step of our own.
    const done = this.math.derivative(node, v, { simplify: false });
    steps.push({ rule: 'Derivative', tex: `${this.tex(this.D(node), v)} = ${this.tex(done, v)}` });
    return done;
  }

  derivative(expression: string, v = 'x', order = 1): Answer {
    const f = this.parse(expression);
    if (!this.depends(f, v))
      return {
        ok: true,
        tex: '0',
        text: '0',
        steps: [{ rule: 'Constant rule', tex: `\\frac{d}{d${v}}\\left[${this.tex(f, v)}\\right] = 0` }],
        check: `${this.tex(f, v)} does not depend on ${v}.`,
        expression: '0',
      };
    const steps: Step[] = [];
    let current = f;
    for (let k = 1; k <= order; k++) {
      const own: Step[] = [];
      const raw = this.d(current, v, own);
      const simple = this.tidy(raw);
      const reference = this.math.derivative(current, v);
      const ours = this.agree(simple, reference, v);
      const result = this.squareDenominator(ours ? simple : reference, current, v);
      if (order > 1) steps.push({ rule: k === 1 ? 'First derivative' : `Derivative number ${k}`, tex: `\\frac{d}{d${v}}\\left[${this.tex(current, v)}\\right]` });
      if (ours) steps.push(...own);
      steps.push({ rule: 'Simplify', tex: `${k === 1 ? `f'(${v})` : `f^{(${k})}(${v})`} = ${this.tex(result, v)}` });
      current = result;
    }
    const symbol = order === 1 ? `f'(${v})` : `f^{(${order})}(${v})`;
    return {
      ok: true,
      tex: `${symbol} = ${this.tex(current, v)}`,
      text: current.toString(),
      steps,
      check: 'Checked against mathjs’s own differentiation at sample points.',
      expression: current.toString(),
    };
  }

  /** (x² − 2x − 1)/(x² − 2x + 1) reads (x² − 2x − 1)/(x − 1)² when the bottom is the square of the original's. */
  private squareDenominator(result: MathNode, original: MathNode, v: string): MathNode {
    const math = this.math;
    const fnOf = (n: MathNode) => (math.isOperatorNode(n) ? (n as unknown as { fn: string }).fn : '');
    const o = this.strip(original);
    let r = this.strip(result);
    const negative = fnOf(r) === 'unaryMinus';
    if (negative) r = this.strip((r as unknown as { args: MathNode[] }).args[0] as MathNode);
    if (fnOf(o) !== 'divide' || fnOf(r) !== 'divide') return result;
    const q = this.strip((o as unknown as { args: MathNode[] }).args[1] as MathNode);
    if (!this.depends(q, v)) return result;
    const [top, bottom] = (r as unknown as { args: MathNode[] }).args as [MathNode, MathNode];
    const square = this.pow(this.paren(q), this.num(2));
    if (this.strip(bottom).equals(square) || !this.agree(bottom, square, v)) return result;
    const shown = this.div(top, square);
    return negative ? this.neg(shown) : shown;
  }

  /* ------------------------------------------------------------ integrals -- */

  private I(node: MathNode): MathNode {
    return this.fn('__I', node);
  }

  /** a and b when u = a·v + b with a ≠ 0 constant, else null. */
  private linear(u0: MathNode, v: string): { a: MathNode; b: MathNode } | null {
    const u = this.strip(u0);
    if (!this.depends(u, v)) return null;
    let a: MathNode;
    try {
      a = this.math.derivative(u, v);
    } catch {
      return null;
    }
    if (this.depends(a, v) || this.isNum(a, 0)) return null;
    const b = this.simplify(this.sub(u, this.mul(a, this.sym(v))));
    if (this.depends(b, v)) return null;
    return { a, b };
  }

  /** Splits a product into the factors that do not depend on v and those that do. */
  private factors(node: MathNode, v: string): { constant: MathNode[]; varying: MathNode[] } {
    const out = { constant: [] as MathNode[], varying: [] as MathNode[] };
    const walk = (n0: MathNode) => {
      const n = this.strip(n0);
      if (this.math.isOperatorNode(n) && (n as unknown as { fn: string }).fn === 'multiply') {
        for (const a of (n as unknown as { args: MathNode[] }).args) walk(a);
      } else if (this.math.isOperatorNode(n) && (n as unknown as { fn: string }).fn === 'unaryMinus' && this.depends(n, v)) {
        out.constant.push(this.num(-1));
        walk((n as unknown as { args: MathNode[] }).args[0] as MathNode);
      } else if (this.math.isOperatorNode(n) && (n as unknown as { fn: string }).fn === 'divide' && !this.depends((n as unknown as { args: MathNode[] }).args[1] as MathNode, v)) {
        const [p, q] = (n as unknown as { args: MathNode[] }).args as [MathNode, MathNode];
        out.constant.push(this.div(this.num(1), q));
        walk(p);
      } else (this.depends(n, v) ? out.varying : out.constant).push(n);
    };
    walk(node);
    return out;
  }

  private product(nodes: readonly MathNode[]): MathNode {
    return nodes.reduce((acc, n) => this.mul(acc, n), this.num(1) as MathNode);
  }

  /** Integrates with steps; null when no rule applies. */
  private int(node0: MathNode, v: string, steps: Step[], depth: number): MathNode | null {
    if (depth > 9 || steps.length > 120) return null;
    const math = this.math;
    const node = this.strip(this.normaliseExp(node0));
    const x = this.sym(v);
    const say = (rule: string, result: MathNode, working?: string) => {
      steps.push({ rule, tex: `${this.tex(this.I(node), v)} = ${working ?? this.tex(result, v)}` });
      return result;
    };
    if (!this.depends(node, v)) return say('Integral of a constant', this.mul(node, x));
    if (math.isSymbolNode(node)) return say('Power rule', this.div(this.pow(x, this.num(2)), this.num(2)));
    const op = math.isOperatorNode(node) ? (node as unknown as { fn: string; args: MathNode[] }) : null;
    if (op && (op.fn === 'add' || op.fn === 'subtract')) {
      const [a, b] = op.args as [MathNode, MathNode];
      steps.push({ rule: op.fn === 'add' ? 'Sum rule' : 'Difference rule', tex: `${this.tex(this.I(node), v)} = ${this.tex(this.I(a), v)} ${op.fn === 'add' ? '+' : '-'} ${this.tex(this.I(b), v)}` });
      const ia = this.int(a, v, steps, depth + 1);
      const ib = ia ? this.int(b, v, steps, depth + 1) : null;
      if (!ia || !ib) return null;
      return op.fn === 'add' ? this.add(ia, ib) : this.sub(ia, this.paren(ib));
    }
    if (op && op.fn === 'unaryMinus') {
      const inner = this.int(op.args[0] as MathNode, v, steps, depth + 1);
      return inner ? this.neg(this.paren(inner)) : null;
    }
    // Constant multiples come outside.
    const { constant, varying } = this.factors(node, v);
    if (constant.length && varying.length) {
      const c = this.simplify(this.product(constant));
      const rest = this.product(varying);
      steps.push({ rule: 'Constant multiple rule', tex: `${this.tex(this.I(node), v)} = ${this.tex(c, v)}\\int ${this.tex(rest, v)}\\,d${v}` });
      const inner = this.int(rest, v, steps, depth + 1);
      return inner ? this.mul(c, this.paren(inner)) : null;
    }
    const table = this.table(node, v);
    if (table) return say(table.rule, table.result);
    const quadratic = this.quadratic(node, v, steps);
    if (quadratic) return quadratic;
    const sub = depth < 6 ? this.substitution(node, v, steps, depth) : null;
    if (sub) return sub;
    const parts = depth < 6 ? this.byParts(node, v, steps, depth) : null;
    if (parts) return parts;
    const fractions = depth < 4 ? this.partialFractions(node, v, steps, depth) : null;
    if (fractions) return fractions;
    // Products and powers that expand into sums (polynomials, (1 + x)²): expand and try again.
    if (depth < 3) {
      try {
        const expanded = this.simplify(this.math.parse(this.math.rationalize(node, {}, false).toString()));
        if (!expanded.equals(node) && this.math.isOperatorNode(expanded) && ['add', 'subtract'].includes((expanded as unknown as { fn: string }).fn)) {
          steps.push({ rule: 'Expand', tex: `${this.tex(node, v)} = ${this.tex(expanded, v)}` });
          return this.int(expanded, v, steps, depth + 1);
        }
      } catch {
        // Not a rational expression.
      }
    }
    return null;
  }

  /** The table of integrals, for functions of a linear argument u = a·x + b (dividing by a). */
  private table(node: MathNode, v: string): { rule: string; result: MathNode } | null {
    const math = this.math;
    const one = this.num(1);
    const two = this.num(2);
    const over = (u: MathNode, result: MathNode, name: string) => {
      const lin = this.linear(u, v);
      if (!lin) return null;
      const a = this.simplify(lin.a);
      const scaled = this.isNum(a, 1)
        ? result
        : this.math.isOperatorNode(a) && (a as unknown as { fn: string }).fn === 'unaryMinus' && this.isNum((a as unknown as { args: MathNode[] }).args[0] as MathNode, 1)
          ? this.neg(this.paren(result))
          : this.div(result, this.paren(lin.a));
      const isVar = math.isSymbolNode(this.strip(u));
      return { rule: isVar ? name : `${name}, dividing by the inner derivative ${lin.a.toString()}`, result: scaled };
    };
    const op = math.isOperatorNode(node) ? (node as unknown as { fn: string; args: MathNode[] }) : null;
    const fnode = math.isFunctionNode(node) ? (node as unknown as { fn: { name: string }; args: MathNode[] }) : null;
    // Powers of a linear expression, and 1/u.
    if (op && op.fn === 'pow') {
      const [base, exp] = op.args as [MathNode, MathNode];
      if (!this.depends(exp, v) && this.linear(base, v)) {
        const n = Number(this.simplify(exp).evaluate({}));
        if (n === -1) return over(base, this.fn('log', this.fn('abs', base)), 'Integral of 1/u');
        const n1 = this.simplify(this.add(exp, one));
        return over(base, this.div(this.pow(this.paren(base), n1), n1), 'Power rule');
      }
      if (!this.depends(base, v)) {
        const isE = math.isSymbolNode(this.strip(base)) && (this.strip(base) as unknown as { name: string }).name === 'e';
        return over(exp, isE ? node : this.div(node, this.fn('log', base)), 'Exponential rule');
      }
      // sec², csc², sinh² … are handled below as functions squared.
      if (this.isNum(exp, 2) && math.isFunctionNode(this.strip(base))) {
        const g = this.strip(base) as unknown as { fn: { name: string }; args: MathNode[] };
        const u = g.args[0] as MathNode;
        if (g.fn.name === 'sec') return over(u, this.fn('tan', u), 'Integral of sec²');
        if (g.fn.name === 'csc') return over(u, this.neg(this.fn('cot', u)), 'Integral of csc²');
      }
      return null;
    }
    if (op && op.fn === 'divide') {
      const [p, q] = op.args as [MathNode, MathNode];
      if (!this.depends(p, v)) {
        // c / u, c / u^n, c / (1 + u²), c / sqrt(1 − u²)
        const qs = this.strip(q);
        const lin = this.linear(qs, v);
        if (lin) return over(qs, this.mul(p, this.fn('log', this.fn('abs', qs))), 'Integral of 1/u');
        if (math.isOperatorNode(qs) && (qs as unknown as { fn: string }).fn === 'pow') {
          const [base, exp] = (qs as unknown as { args: MathNode[] }).args as [MathNode, MathNode];
          if (!this.depends(exp, v)) return this.table(this.mul(p, this.pow(this.paren(base), this.simplify(this.neg(exp)))), v);
        }
        if (math.isFunctionNode(qs) && (qs as unknown as { fn: { name: string } }).fn.name === 'sqrt') {
          const inner = (qs as unknown as { args: MathNode[] }).args[0] as MathNode;
          const lin2 = this.linear(inner, v);
          if (lin2) return over(inner, this.mul(this.mul(two, p), this.fn('sqrt', inner)), 'Power rule');
          // 1/sqrt(1 − u²) → asin(u)
          const u2 = this.squaredOf(this.simplify(this.sub(one, inner)), v);
          if (u2) return over(u2, this.mul(p, this.fn('asin', u2)), 'Integral of 1/√(1 − u²)');
        }
        // 1/(1 + u²) → atan(u)
        const u = this.squaredOf(this.simplify(this.sub(qs, one)), v);
        if (u) return over(u, this.mul(p, this.fn('atan', u)), 'Integral of 1/(1 + u²)');
      }
      return null;
    }
    if (op && op.fn === 'multiply') {
      // sec·tan, csc·cot
      const [a, b] = op.args.map((n) => this.strip(n)) as [MathNode, MathNode];
      const name = (n: MathNode) => (math.isFunctionNode(n) ? (n as unknown as { fn: { name: string } }).fn.name : '');
      const arg = (n: MathNode) => (n as unknown as { args: MathNode[] }).args[0] as MathNode;
      const pair = [name(a), name(b)].sort().join(',');
      if (pair === 'sec,tan' && arg(a).equals(arg(b))) return over(arg(a), this.fn('sec', arg(a)), 'Integral of sec·tan');
      if (pair === 'cot,csc' && arg(a).equals(arg(b))) return over(arg(a), this.neg(this.fn('csc', arg(a))), 'Integral of csc·cot');
      const cyclic = this.expTrig(a, b, v) ?? this.expTrig(b, a, v);
      if (cyclic) return cyclic;
      return null;
    }
    if (fnode && fnode.args.length === 1) {
      const u = fnode.args[0] as MathNode;
      switch (fnode.fn.name) {
        case 'sin':
          return over(u, this.neg(this.fn('cos', u)), 'Integral of sine');
        case 'cos':
          return over(u, this.fn('sin', u), 'Integral of cosine');
        case 'tan':
          return over(u, this.neg(this.fn('log', this.fn('abs', this.fn('cos', u)))), 'Integral of tangent');
        case 'cot':
          return over(u, this.fn('log', this.fn('abs', this.fn('sin', u))), 'Integral of cotangent');
        case 'sec':
          return over(u, this.fn('log', this.fn('abs', this.add(this.fn('sec', u), this.fn('tan', u)))), 'Integral of secant');
        case 'csc':
          return over(u, this.neg(this.fn('log', this.fn('abs', this.add(this.fn('csc', u), this.fn('cot', u))))), 'Integral of cosecant');
        case 'sinh':
          return over(u, this.fn('cosh', u), 'Integral of sinh');
        case 'cosh':
          return over(u, this.fn('sinh', u), 'Integral of cosh');
        case 'exp':
          return over(u, node, 'Exponential rule');
        case 'sqrt':
          return over(u, this.div(this.mul(two, this.pow(this.paren(u), this.div(this.num(3), two))), this.num(3)), 'Power rule');
        case 'log':
          return over(u, this.sub(this.mul(u, this.fn('log', u)), u), 'Integral of ln u (by parts: u ln u − u)');
        default:
          return null;
      }
    }
    return null;
  }

  /**
   * e^(αx+p)·cos(βx+q) and e^(αx+p)·sin(βx+q): integrating by parts twice brings
   * the same integral back, so I(1 + α²/β²) is known and I follows.
   */
  private expTrig(e0: MathNode, t0: MathNode, v: string): { rule: string; result: MathNode } | null {
    const math = this.math;
    const e = this.strip(e0);
    const t = this.strip(t0);
    let u: MathNode | null = null;
    if (math.isOperatorNode(e) && (e as unknown as { fn: string }).fn === 'pow') {
      const [base, exp] = (e as unknown as { args: MathNode[] }).args as [MathNode, MathNode];
      if (math.isSymbolNode(this.strip(base)) && (this.strip(base) as unknown as { name: string }).name === 'e') u = exp;
    } else if (math.isFunctionNode(e) && (e as unknown as { fn: { name: string } }).fn.name === 'exp') u = (e as unknown as { args: MathNode[] }).args[0] as MathNode;
    if (!u || !math.isFunctionNode(t)) return null;
    const name = (t as unknown as { fn: { name: string } }).fn.name;
    if (name !== 'sin' && name !== 'cos') return null;
    const w = (t as unknown as { args: MathNode[] }).args[0] as MathNode;
    const lu = this.linear(u, v);
    const lw = this.linear(w, v);
    if (!lu || !lw) return null;
    const al = this.simplify(lu.a);
    const be = this.simplify(lw.a);
    const eu = this.pow(this.sym('e'), this.paren(u));
    const cosw = this.fn('cos', w);
    const sinw = this.fn('sin', w);
    const top = name === 'cos' ? this.add(this.mul(al, cosw), this.mul(be, sinw)) : this.sub(this.mul(al, sinw), this.mul(be, cosw));
    const bottom = this.simplify(this.add(this.pow(this.paren(al), this.num(2)), this.pow(this.paren(be), this.num(2))));
    const result = this.div(this.mul(eu, this.paren(top)), this.paren(bottom));
    const formula = name === 'cos' ? 'α·cos w + β·sin w' : 'α·sin w − β·cos w';
    return { rule: `By parts twice the same integral comes back; solving for it gives e^u·(${formula})/(α² + β²), with α = ${al.toString()} and β = ${be.toString()}`, result };
  }

  /** u when node is u² with u linear in v (for atan and asin forms). */
  private squaredOf(node: MathNode, v: string): MathNode | null {
    const n = this.strip(node);
    if (this.math.isOperatorNode(n) && (n as unknown as { fn: string }).fn === 'pow') {
      const [b, e] = (n as unknown as { args: MathNode[] }).args as [MathNode, MathNode];
      if (this.isNum(e, 2) && this.linear(b, v)) return this.strip(b);
    }
    return null;
  }

  /** (B·x + C)/(x² + p·x + q) with no real roots: a logarithm and an arctangent, by completing the square. */
  private quadratic(node: MathNode, v: string, steps: Step[]): MathNode | null {
    let r: { numerator: MathNode; denominator: MathNode; coefficients?: number[] };
    try {
      r = this.math.rationalize(node, {}, true) as unknown as typeof r;
    } catch {
      return null;
    }
    const den = this.polyCoefficients(r.denominator, v);
    const num = this.polyCoefficients(r.numerator, v);
    if (!den || !num || den.length !== 3 || num.length > 2) return null;
    const [q0, p0, a2] = den as [number, number, number];
    const [C0 = 0, B0 = 0] = num;
    const p = p0 / a2;
    const q = q0 / a2;
    const B = B0 / a2;
    const C = C0 / a2;
    const k2 = q - (p * p) / 4;
    if (!(k2 > 1e-12)) return null;
    const k = Math.sqrt(k2);
    const x = this.sym(v);
    const show = (n: number) =>
      this.math.parse(
        showNumber(n)
          .text.replace(/π/g, 'pi')
          .replace(/√(\d+)/g, 'sqrt($1)')
          .replace(/−/g, '-'),
      );
    const quad = this.math.parse(`${v}^2 + ${p} * ${v} + ${q}`);
    const shifted = this.simplify(this.add(x, show(p / 2)));
    const logPart = this.mul(show(B / 2), this.fn('log', this.simplify(quad)));
    const atanPart = this.mul(show((C - (B * p) / 2) / k), this.fn('atan', this.div(this.paren(shifted), show(k))));
    if (p !== 0) steps.push({ rule: 'Complete the square', tex: `${this.tex(this.simplify(quad), v)} = \\left(${this.tex(shifted, v)}\\right)^{2} + ${showNumber(k2).tex}` });
    const hasAtan = Math.abs(C - (B * p) / 2) > 1e-12;
    const result = this.add(B === 0 ? this.num(0) : logPart, hasAtan ? atanPart : this.num(0));
    const rule =
      B === 0
        ? 'An arctangent: ∫ du/(u² + k²) = (1/k)·atan(u/k)'
        : hasAtan
          ? 'A logarithm and an arctangent: split off the derivative of the denominator'
          : 'A logarithm: the top is a multiple of the derivative of the bottom';
    steps.push({ rule, tex: `${this.tex(this.I(node), v)} = ${this.tex(result, v)}` });
    return result;
  }

  /** Coefficients (constant term first) of a polynomial in v with numeric coefficients, else null. */
  private polyCoefficients(node: MathNode, v: string): number[] | null {
    try {
      const r = this.math.rationalize(node, {}, true) as unknown as { coefficients: number[]; variables: string[]; denominator: MathNode | null };
      if (r.denominator && this.depends(r.denominator, v)) return null;
      if (r.variables.length > 1 || (r.variables.length === 1 && r.variables[0] !== v)) return null;
      if (r.variables.length === 0) return [Number(node.evaluate({}))];
      return r.coefficients;
    } catch {
      return null;
    }
  }

  /** u-substitution: an inner expression u whose derivative divides out, leaving a function of u alone. */
  private substitution(node: MathNode, v: string, steps: Step[], depth: number): MathNode | null {
    const math = this.math;
    const seen = new Set<string>();
    const candidates: MathNode[] = [];
    node.traverse((n: MathNode, path: string) => {
      if (path === 'fn') return;
      const s = this.strip(n);
      if (s === node || !this.depends(s, v) || math.isSymbolNode(s) || math.isConstantNode(s)) return;
      const key = s.toString();
      if (seen.has(key)) return;
      seen.add(key);
      if (this.linear(s, v)) return;
      candidates.push(s);
    });
    candidates.sort((a, b) => b.toString().length - a.toString().length);
    const uName = ['u', 'w', 't', 's'].find((name) => name !== v && !this.depends(node, name)) ?? '__u';
    const u = this.sym(uName);
    for (const g of candidates.slice(0, 12)) {
      let dg: MathNode;
      try {
        dg = this.math.derivative(g, v);
      } catch {
        continue;
      }
      if (this.isNum(dg, 0)) continue;
      const q = this.simplify(this.div(node, this.paren(dg)));
      const gs = this.simplify(g);
      const swap = (n: MathNode) => n.transform((m: MathNode) => (m.equals(g) || m.equals(gs) ? u : m));
      let inU = swap(q);
      if (this.depends(inU, v)) {
        // ln u and e^u sometimes reappear simplified differently: try once more on the unsimplified quotient.
        inU = swap(this.div(node, this.paren(dg)));
        if (this.depends(inU, v)) inU = this.simplify(inU);
        if (this.depends(inU, v)) continue;
      }
      inU = this.simplify(inU);
      const inner: Step[] = [];
      const F = this.int(inU, uName, inner, depth + 1);
      if (!F) continue;
      const back = F.transform((m: MathNode) => (math.isSymbolNode(m) && (m as unknown as { name: string }).name === uName ? this.paren(g) : m));
      const un = uName === '__u' ? 'u' : uName;
      steps.push({
        rule: 'Substitution',
        tex: `${un} = ${this.tex(g, v)},\\quad d${un} = ${this.tex(this.simplify(dg), v)}\\,d${v},\\quad ${this.tex(this.I(node), v)} = \\int ${this.tex(inU, uName)}\\,d${un}`,
      });
      steps.push(...inner);
      steps.push({ rule: 'Substitute back', tex: `${un} = ${this.tex(g, v)}:\\quad ${this.tex(this.I(node), v)} = ${this.tex(back, v)}` });
      return back;
    }
    return null;
  }

  /** Integration by parts, choosing u by LIATE: logarithms, inverse trigonometry, algebra, trigonometry, exponentials. */
  private byParts(node: MathNode, v: string, steps: Step[], depth: number): MathNode | null {
    const math = this.math;
    const parts = this.factors(node, v).varying;
    const rank = (n: MathNode): number => {
      const s = this.strip(n);
      if (math.isFunctionNode(s)) {
        const name = (s as unknown as { fn: { name: string } }).fn.name;
        if (name === 'log' || name === 'log10') return 0;
        if (['asin', 'acos', 'atan'].includes(name)) return 1;
        if (['sin', 'cos', 'sinh', 'cosh'].includes(name)) return 3;
        if (name === 'exp') return 4;
        if (name === 'sqrt') return 2;
        return 9;
      }
      if (math.isOperatorNode(s) && (s as unknown as { fn: string }).fn === 'pow') {
        const [b, e] = (s as unknown as { args: MathNode[] }).args as [MathNode, MathNode];
        if (!this.depends(b, v)) return 4;
        if (!this.depends(e, v)) return 2;
      }
      if (math.isSymbolNode(s)) return 2;
      return 9;
    };
    let factorsList = parts;
    if (factorsList.length === 1) {
      const only = this.strip(factorsList[0] as MathNode);
      // A lone logarithm or inverse function: u = it, dv = dx.
      if (rank(only) <= 1) factorsList = [only, this.num(1)];
      else return null;
    }
    if (factorsList.length !== 2) return null;
    const sorted = [...factorsList].sort((a, b) => rank(a) - rank(b));
    const [uPart, dvPart] = sorted as [MathNode, MathNode];
    const lone = this.isNum(dvPart, 1);
    if (rank(uPart) > 2 || (rank(dvPart) === 9 && !lone)) return null;
    const vSteps: Step[] = [];
    const V = this.int(dvPart, v, vSteps, depth + 2);
    if (!V) return null;
    let du: MathNode;
    try {
      du = this.math.derivative(uPart, v);
    } catch {
      return null;
    }
    const Vs = this.normaliseExp(this.simplify(V));
    const rest = this.normaliseExp(this.simplify(this.mul(Vs, this.paren(du))));
    steps.push({
      rule: 'Integration by parts: ∫u dv = uv − ∫v du',
      tex: `u = ${this.tex(uPart, v)},\\; dv = ${this.isNum(dvPart, 1) ? '' : this.tex(dvPart, v)}\\,d${v},\\; du = ${this.isNum(this.simplify(du), 1) ? '' : this.tex(this.simplify(du), v)}\\,d${v},\\; v = ${this.tex(Vs, v)}`,
    });
    const uv = this.clean(this.mul(uPart, this.paren(Vs)));
    const restShown = this.clean(rest);
    const flipped = math.isOperatorNode(restShown) && (restShown as unknown as { fn: string }).fn === 'unaryMinus';
    const restTex = this.tex(flipped ? ((restShown as unknown as { args: MathNode[] }).args[0] as MathNode) : restShown, v);
    steps.push({ rule: 'By parts', tex: `${this.tex(this.I(node), v)} = ${this.tex(uv, v)} ${flipped ? '+' : '-'} \\int ${restTex}\\,d${v}` });
    const R = this.int(rest, v, steps, depth + 1);
    if (!R) return null;
    return this.sub(uv, this.paren(R));
  }

  /** Rational functions: partial fractions from the algebra system, then term by term. */
  private partialFractions(node: MathNode, v: string, steps: Step[], depth: number): MathNode | null {
    if (!this.cas) return null;
    let r: { numerator: MathNode; denominator: MathNode | null };
    try {
      r = this.math.rationalize(node, {}, true) as unknown as typeof r;
    } catch {
      return null;
    }
    if (!r.denominator || !this.depends(r.denominator, v)) return null;
    const split = this.cas.partfrac(node.toString(), v);
    if (!split) return null;
    let parsed: MathNode;
    try {
      parsed = this.parse(split);
    } catch {
      return null;
    }
    if (!this.agree(parsed, node, v)) return null;
    const sum = this.simplify(parsed);
    if (sum.equals(node) || !(this.math.isOperatorNode(sum) && ['add', 'subtract'].includes((sum as unknown as { fn: string }).fn))) return null;
    steps.push({ rule: 'Partial fractions', tex: `${this.tex(node, v)} = ${this.tex(sum, v)}` });
    return this.int(sum, v, steps, depth + 1);
  }

  /** Numerical ∫ from a to b, either bound infinite: Gauss–Kronrod, or tanh-sinh where the integrand is infinite at an end. */
  numericIntegral(f: (x: number) => number, a: number, b: number): number {
    if (a === b) return 0;
    if (a > b) return -this.numericIntegral(f, b, a);
    if (!Number.isFinite(a) && !Number.isFinite(b)) return this.numericIntegral(f, -Infinity, 0) + this.numericIntegral(f, 0, Infinity);
    if (!Number.isFinite(b)) return tanhSinh((t) => (t >= 1 ? 0 : f(a + t / (1 - t)) / (1 - t) ** 2), 0, 1);
    if (!Number.isFinite(a)) return tanhSinh((t) => (t >= 1 ? 0 : f(b - t / (1 - t)) / (1 - t) ** 2), 0, 1);
    const ends = [f(a), f(b)];
    return ends.every(Number.isFinite) ? gk(f, a, b) : tanhSinh(f, a, b);
  }

  integral(expression: string, v = 'x', bounds?: readonly [string, string]): Answer {
    const f = this.parse(expression);
    const compiled = f.compile();
    const at = (x: number) => {
      try {
        return Number(compiled.evaluate({ [v]: x }));
      } catch {
        return Number.NaN;
      }
    };
    const steps: Step[] = [];
    let F = this.int(f, v, steps, 0);
    let viaCas = false;
    let casTex = '';
    if (F) {
      F = this.clean(this.normaliseExp(this.tidy(F)));
      if (!this.checkAntiderivative(F, f, v)) {
        F = null;
        steps.length = 0;
      }
    }
    if (!F && this.cas) {
      const r = this.cas.integrate(f.toString(), v);
      if (r) {
        try {
          const parsed = this.parse(r.text);
          if (this.checkAntiderivative(parsed, f, v)) {
            F = parsed;
            viaCas = true;
          }
        } catch {
          // Special functions mathjs does not know (Si, Ci, Ei): show the algebra system's answer unchecked.
          casTex = r.tex;
        }
      }
    }
    const integrand = this.tex(f, v);
    if (!bounds) {
      if (F) {
        if (viaCas) steps.push({ rule: 'Found by the computer algebra system (nerdamer); no worked steps', tex: `\\int ${integrand}\\,d${v} = ${this.tex(F, v)} + C` });
        return {
          ok: true,
          tex: `\\int ${integrand}\\,d${v} = ${this.tex(F, v)} + C`,
          text: `${F.toString()} + C`,
          steps,
          check: 'Checked: the derivative of the answer equals the integrand at sample points.',
          expression: F.toString(),
        };
      }
      if (casTex)
        return {
          ok: true,
          tex: `\\int ${integrand}\\,d${v} = ${casTex} + C`,
          text: casTex,
          steps: [],
          check: 'From the computer algebra system; it uses special functions that could not be checked here.',
          note: 'Si, Ci and Ei are the sine, cosine and exponential integrals.',
        };
      return {
        ok: false,
        tex: `\\int ${integrand}\\,d${v}`,
        text: '',
        steps: [],
        check: '',
        note: 'No antiderivative in elementary functions was found. A definite integral can still be worked out numerically: give limits.',
      };
    }
    const a = this.value(bounds[0]);
    const b = this.value(bounds[1]);
    if (Number.isNaN(a) || Number.isNaN(b)) throw new Error('The limits must be numbers (pi, e and inf are allowed).');
    const limitTex = (t: string) => this.tex(this.parse(t));
    const boundsTex = `\\int_{${limitTex(bounds[0])}}^{${limitTex(bounds[1])}} ${integrand}\\,d${v}`;
    if (a === b) return { ok: true, tex: `${boundsTex} = 0`, text: '0', value: 0, steps: [{ rule: 'The limits are equal', tex: `${boundsTex} = 0` }], check: 'An integral over no width is 0.' };
    const sign = a < b ? 1 : -1;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    // Where the integrand blows up inside the range, the integral splits there into improper pieces.
    const poles = findPoles(at, lo, hi);
    const cuts = [lo, ...poles, hi];
    const troubled = (x: number) => !Number.isFinite(x) || poles.includes(x) || !Number.isFinite(at(x));
    const improper = cuts.some(troubled);
    const fmt = (x: number) => showNumber(x).tex;
    if (poles.length)
      steps.push({
        rule: `The integrand is infinite inside the range, at ${v} = ${poles.map((x) => showNumber(x).text).join(', ')}: split the integral there`,
        tex: poles.map((x) => `${v} = ${fmt(x)}`).join(',\\quad '),
      });
    // Numerically, piece by piece: improper ends as limits of proper integrals.
    let numeric = 0;
    let numericState: 'ok' | 'infinite' | 'unsettled' = 'ok';
    for (let i = 0; i + 1 < cuts.length; i++) {
      const p = cuts[i] as number;
      const q = cuts[i + 1] as number;
      const piece = improperPiece(at, p, q, troubled(p), troubled(q));
      if (Number.isNaN(piece)) numericState = numericState === 'infinite' ? 'infinite' : 'unsettled';
      else if (!Number.isFinite(piece)) numericState = 'infinite';
      else numeric += piece;
    }
    // Exactly, from the antiderivative: F's values, or its limits at improper ends.
    let exact: number | null = null;
    let exactState: 'ok' | 'infinite' | 'unsettled' | 'none' = F ? 'ok' : 'none';
    if (F) {
      const Fc = F.compile();
      const Fat = (x: number) => {
        try {
          return Number(Fc.evaluate({ [v]: x }));
        } catch {
          return Number.NaN;
        }
      };
      const endValue = (x: number, inward: 1 | -1, bad: boolean) => {
        const direct = Number.isFinite(x) ? Fat(x) : Number.NaN;
        return !bad && Number.isFinite(direct) ? direct : numericLimit(Fat, x, inward);
      };
      let total = 0;
      const shown: string[] = [];
      for (let i = 0; i + 1 < cuts.length && exactState === 'ok'; i++) {
        const p = cuts[i] as number;
        const q = cuts[i + 1] as number;
        const Fq = endValue(q, -1, troubled(q));
        const Fp = endValue(p, 1, troubled(p));
        if (Number.isNaN(Fq) || Number.isNaN(Fp)) exactState = 'unsettled';
        else if (!Number.isFinite(Fq) || !Number.isFinite(Fp)) exactState = 'infinite';
        else total += Fq - Fp;
        if (troubled(p) || troubled(q)) shown.push(`\\lim F \\text{ at } ${fmt(q)}^{-} = ${fmt(Fq)},\\quad \\lim F \\text{ at } ${fmt(p)}^{+} = ${fmt(Fp)}`);
      }
      if (improper && shown.length) steps.push({ rule: 'An improper integral: take the antiderivative’s limits at the troubled ends', tex: shown.join('\\\\') });
      if (exactState === 'ok') exact = sign * total;
    }
    if (exactState === 'infinite' || (exactState !== 'ok' && numericState === 'infinite')) {
      steps.push({ rule: 'A limit is infinite', tex: `\\text{so } ${boundsTex} \\text{ diverges}` });
      return {
        ok: false,
        tex: boundsTex,
        text: 'diverges',
        steps,
        check: exactState === 'infinite' ? 'The antiderivative grows without bound at a troubled point.' : 'The partial integrals grow without bound.',
        note: 'The integral diverges: it grows without bound.',
      };
    }
    if (exactState === 'unsettled' && numericState !== 'ok') {
      return {
        ok: false,
        tex: boundsTex,
        text: 'does not converge',
        steps,
        check: 'The antiderivative has no limit at a troubled end (it oscillates).',
        note: 'The integral does not converge: its partial values keep oscillating.',
      };
    }
    const numericValue = sign * numeric;
    const tolerance = improper ? 1e-4 : 1e-6;
    if (exact !== null && (numericState !== 'ok' || Math.abs(exact - numericValue) <= tolerance * Math.max(1, Math.abs(exact)))) {
      const shownValue = showNumber(exact);
      const Ftex = F ? this.tex(F, v) : '';
      if (!improper)
        steps.push({ rule: 'Fundamental theorem of calculus: F(b) − F(a)', tex: `${boundsTex} = \\Big[${Ftex}\\Big]_{${limitTex(bounds[0])}}^{${limitTex(bounds[1])}} = ${shownValue.tex}` });
      else steps.push({ rule: 'Add up the pieces: F at the ends, or its limits there', tex: `${boundsTex} = ${shownValue.tex}` });
      return {
        ok: true,
        tex: `${boundsTex} = ${shownValue.tex}`,
        text: shownValue.text,
        value: exact,
        steps,
        check:
          numericState === 'ok' ? `Checked against numerical integration: ${Number(numericValue.toPrecision(10))}.` : 'The numerical check could not settle; the answer rests on the antiderivative.',
        ...(F ? { expression: F.toString() } : {}),
      };
    }
    if (numericState === 'infinite')
      return { ok: false, tex: boundsTex, text: 'diverges', steps, check: 'The partial integrals grow without bound.', note: 'The integral diverges: it grows without bound.' };
    if (numericState === 'unsettled')
      return { ok: false, tex: boundsTex, text: '', steps, check: '', note: 'The integral could not be settled numerically: it may oscillate, or converge too slowly to tell.' };
    const shownValue = showNumber(Number(numericValue.toPrecision(12)));
    return {
      ok: true,
      tex: `${boundsTex} \\approx ${shownValue.tex}`,
      text: shownValue.text,
      value: numericValue,
      steps,
      check: improper
        ? 'Worked out numerically as limits of proper integrals (adaptive Gauss–Kronrod).'
        : exact !== null
          ? 'The antiderivative and the numerical value disagree here (a jump in the antiderivative?), so the numerical value is given.'
          : 'Worked out numerically (adaptive Gauss–Kronrod).',
      ...(F ? { expression: F.toString() } : {}),
    };
  }

  private checkAntiderivative(F: MathNode, f: MathNode, v: string): boolean {
    try {
      return this.agree(this.math.derivative(F, v), f, v);
    } catch {
      // Functions mathjs cannot differentiate (erf): compare a central difference instead.
      const Fc = F.compile();
      const fc = f.compile();
      let ok = 0;
      for (const x of [0.4, 1.3, 2.2, -0.6]) {
        const h = 1e-5;
        try {
          const slope = (Number(Fc.evaluate({ [v]: x + h })) - Number(Fc.evaluate({ [v]: x - h }))) / (2 * h);
          const y = Number(fc.evaluate({ [v]: x }));
          if (!Number.isFinite(slope) || !Number.isFinite(y)) continue;
          if (Math.abs(slope - y) > 1e-5 * Math.max(1, Math.abs(y))) return false;
          ok++;
        } catch {}
      }
      return ok >= 2;
    }
  }

  /* --------------------------------------------------------------- limits -- */

  limit(expression: string, v = 'x', atText = '0', side: 'both' | 'left' | 'right' = 'both'): Answer {
    const f = this.parse(expression);
    const a = this.value(atText);
    if (Number.isNaN(a)) throw new Error('The point must be a number, or inf or -inf.');
    const aTex = a === Infinity ? '\\infty' : a === -Infinity ? '-\\infty' : this.tex(this.parse(atText));
    const toward = `${v} \\to ${aTex}${Number.isFinite(a) && side === 'left' ? '^{-}' : Number.isFinite(a) && side === 'right' ? '^{+}' : ''}`;
    const head = `\\lim_{${toward}} ${this.tex(f, v)}`;
    const fx = f.compile();
    const at = (x: number) => {
      try {
        return Number(fx.evaluate({ [v]: x }));
      } catch {
        return Number.NaN;
      }
    };
    const fromLeft = Number.isFinite(a) ? numericLimit(at, a, -1) : a > 0 ? numericLimit(at, Infinity, -1) : Number.NaN;
    const fromRight = Number.isFinite(a) ? numericLimit(at, a, 1) : a < 0 ? numericLimit(at, -Infinity, 1) : Number.NaN;
    const numeric = !Number.isFinite(a) ? (a > 0 ? fromLeft : fromRight) : side === 'left' ? fromLeft : side === 'right' ? fromRight : close(fromLeft, fromRight) ? fromRight : Number.NaN;
    const steps: Step[] = [];
    if (side === 'both' && Number.isFinite(a) && !Number.isNaN(fromLeft) && !Number.isNaN(fromRight) && !close(fromLeft, fromRight)) {
      steps.push({ rule: 'The one-sided limits differ', tex: `\\lim_{${v} \\to ${aTex}^{-}} = ${showNumber(fromLeft).tex},\\quad \\lim_{${v} \\to ${aTex}^{+}} = ${showNumber(fromRight).tex}` });
      return { ok: true, tex: `${head}\\ \\text{does not exist}`, text: 'does not exist', steps, check: 'The values approached from the left and from the right differ.' };
    }
    const sides: (1 | -1)[] = !Number.isFinite(a) ? [a > 0 ? -1 : 1] : side === 'left' ? [-1] : side === 'right' ? [1] : [-1, 1];
    const symbolic = this.lhopital(f, v, a, sides, aTex, steps, 0);
    if (symbolic !== null && (Number.isNaN(numeric) || close(symbolic, numeric))) {
      const shown = showNumber(symbolic);
      return {
        ok: true,
        tex: `${head} = ${shown.tex}`,
        text: shown.text,
        value: symbolic,
        steps,
        check: Number.isNaN(numeric) ? 'The values near the point do not settle numerically; the answer rests on the steps.' : 'Agrees with the values of the function close to the point.',
      };
    }
    if (!Number.isNaN(numeric)) {
      const shown = Number.isFinite(numeric) ? showNumber(Number(numeric.toPrecision(6))) : showNumber(numeric);
      const exact = !Number.isFinite(numeric);
      return {
        ok: true,
        tex: `${head} ${exact ? '=' : '\\approx'} ${shown.tex}`,
        text: shown.text,
        value: numeric,
        steps: [],
        check: 'Found numerically from values ever closer to the point; no worked steps.',
      };
    }
    return { ok: false, tex: head, text: '', steps, check: '', note: 'The values do not settle near the point: the limit may not exist (as sin(1/x) at 0 oscillates).' };
  }

  /**
   * Substitution, then L’Hôpital’s rule for 0/0 and ∞/∞; 0·∞ rewritten as a
   * quotient; 1^∞, 0⁰ and ∞⁰ through the exponential.  The form is read by
   * evaluating at the point itself in IEEE arithmetic (ln 0 = −∞, 1/∞ = 0),
   * checked against values just beside it.
   */
  private lhopital(f0: MathNode, v: string, a: number, sides: readonly (1 | -1)[], aTex: string, steps: Step[], depth: number): number | null {
    if (depth > 7) return null;
    const f = this.strip(f0);
    const math = this.math;
    const evalAt = (n: MathNode, x: number) => {
      try {
        return Number(n.compile().evaluate({ [v]: x }));
      } catch {
        return Number.NaN;
      }
    };
    /** The value at the point, if the function is continuous there from the sides that matter. */
    const near = (n: MathNode): number => {
      const exact = evalAt(n, a);
      if (Number.isNaN(exact)) return Number.NaN;
      if (!Number.isFinite(a)) return exact === 0 ? 0 : exact;
      let result = exact;
      for (const s of sides) {
        const beside = evalAt(n, a + s * 1e-7);
        if (Number.isFinite(exact)) {
          const gap = Math.abs(beside - exact);
          if (gap <= 1e-3 * Math.max(1, Math.abs(exact))) continue;
          // A slow approach (1/ln x at 0): nearer still than further out, and already close.
          const further = evalAt(n, a + s * 1e-4);
          if (gap < Math.abs(further - exact) && gap < 0.1 * Math.max(1, Math.abs(exact))) continue;
          return Number.NaN;
        }
        // Infinite at the point: the values beside it must grow towards it (slowly, for a logarithm).
        const further = evalAt(n, a + s * 1e-4);
        if (!(Number.isFinite(beside) && Number.isFinite(further) && Math.abs(beside) > Math.abs(further) && Math.sign(beside) === Math.sign(further))) return Number.NaN;
        // 1/x at 0 is +∞ in IEEE arithmetic from either side; the side's own sign decides.
        result = Math.sign(beside) * Infinity;
      }
      return result === 0 ? 0 : result;
    };
    const tone = (x: number) => (Number.isNaN(x) ? 3 : x === 0 ? 0 : Number.isFinite(x) ? 1 : 2);
    const direct = near(f);
    if (tone(direct) === 1 || tone(direct) === 0) {
      steps.push({ rule: Number.isFinite(a) ? 'Direct substitution' : 'Let the variable grow without bound', tex: `\\lim_{${v} \\to ${aTex}} ${this.tex(f, v)} = ${showNumber(direct).tex}` });
      return direct;
    }
    if (tone(direct) === 2) {
      steps.push({ rule: 'The function grows without bound', tex: `\\lim_{${v} \\to ${aTex}} ${this.tex(f, v)} = ${direct > 0 ? '\\infty' : '-\\infty'}` });
      return direct;
    }
    const op = math.isOperatorNode(f) ? (f as unknown as { fn: string; args: MathNode[] }) : null;
    if (op && op.fn === 'divide') {
      const [p, q] = op.args as [MathNode, MathNode];
      const lp = near(p);
      const lq = near(q);
      if ((tone(lp) === 0 && tone(lq) === 0) || (tone(lp) === 2 && tone(lq) === 2)) {
        let dp: MathNode;
        let dq: MathNode;
        try {
          dp = this.simplify(this.math.derivative(p, v));
          dq = this.simplify(this.math.derivative(q, v));
        } catch {
          return null;
        }
        const raw = this.div(this.paren(dp), this.paren(dq));
        const tidied = this.tidy(raw);
        const divides = (n: MathNode) => n.filter((m: MathNode) => math.isOperatorNode(m) && (m as unknown as { fn: string }).fn === 'divide').length;
        // The tidied quotient only when it is simpler: sin(x)/(2x), not (sin(x)/2)/x.
        const simpler = divides(tidied) <= divides(raw) && tidied.toString().length < this.div(dp, dq).toString().length;
        const next = simpler ? tidied : raw;
        steps.push({
          rule: `L’Hôpital’s rule: the form is ${tone(lp) === 0 ? '0/0' : '∞/∞'}, so differentiate the top and the bottom`,
          tex: `\\lim_{${v} \\to ${aTex}} ${this.tex(f, v)} = \\lim_{${v} \\to ${aTex}} \\frac{${this.tex(dp, v)}}{${this.tex(dq, v)}}${simpler ? ` = \\lim_{${v} \\to ${aTex}} ${this.tex(next, v)}` : ''}`,
        });
        return this.lhopital(next, v, a, sides, aTex, steps, depth + 1);
      }
      if (tone(lp) === 1 && tone(lq) === 2) {
        steps.push({ rule: 'A finite number over one growing without bound', tex: `\\lim_{${v} \\to ${aTex}} ${this.tex(f, v)} = 0` });
        return 0;
      }
    }
    if (op && op.fn === 'unaryMinus') {
      const inner = this.lhopital(op.args[0] as MathNode, v, a, sides, aTex, steps, depth + 1);
      return inner === null ? null : inner === 0 ? 0 : -inner;
    }
    if (op && op.fn === 'multiply') {
      const [p, q] = op.args as [MathNode, MathNode];
      const lp = near(p);
      const lq = near(q);
      // A factor with a limit times one without a plain value: the limit of the product of the limits.
      if (tone(lp) === 1 && tone(lq) === 3) {
        const inner = this.lhopital(q, v, a, sides, aTex, steps, depth + 1);
        if (inner !== null && (Number.isFinite(inner) || lp !== 0)) {
          const value = lp * inner;
          steps.push({
            rule: 'The limit of a product is the product of the limits',
            tex: `\\lim_{${v} \\to ${aTex}} ${this.tex(f, v)} = ${showNumber(lp).tex} \\cdot ${showNumber(inner).tex} = ${showNumber(value).tex}`,
          });
          return value;
        }
      }
      if (tone(lq) === 1 && tone(lp) === 3) {
        const inner = this.lhopital(p, v, a, sides, aTex, steps, depth + 1);
        if (inner !== null && (Number.isFinite(inner) || lq !== 0)) {
          const value = lq * inner;
          steps.push({
            rule: 'The limit of a product is the product of the limits',
            tex: `\\lim_{${v} \\to ${aTex}} ${this.tex(f, v)} = ${showNumber(inner).tex} \\cdot ${showNumber(lq).tex} = ${showNumber(value).tex}`,
          });
          return value;
        }
      }
      if ((tone(lp) === 0 && tone(lq) === 2) || (tone(lp) === 2 && tone(lq) === 0)) {
        const [zero, inf] = tone(lp) === 0 ? [p, q] : [q, p];
        // A logarithm stays on top, where differentiating removes it: x ln x = ln x / (1/x).
        const logarithmic = inf.filter((m: MathNode) => math.isFunctionNode(m) && ['log', 'log10', 'log2'].includes((m as unknown as { fn: { name: string } }).fn.name)).length > 0;
        const rewritten = logarithmic ? this.div(this.paren(inf), this.paren(this.div(this.num(1), this.paren(zero)))) : this.div(this.paren(zero), this.paren(this.div(this.num(1), this.paren(inf))));
        steps.push({ rule: 'The form 0·∞: write it as a quotient', tex: `${this.tex(f, v)} = ${this.tex(rewritten, v)}` });
        return this.lhopital(rewritten, v, a, sides, aTex, steps, depth + 1);
      }
    }
    if (op && op.fn === 'pow' && this.depends(op.args[1] as MathNode, v)) {
      // 1^∞, 0⁰ and ∞⁰: b^g = e^(g·ln b), and g·ln b = ln b / (1/g).
      const [b, g] = op.args as [MathNode, MathNode];
      const exponent = this.div(this.fn('log', b), this.paren(this.div(this.num(1), this.paren(g))));
      steps.push({ rule: 'The form 1^∞ (or 0⁰, ∞⁰): write the power as an exponential', tex: `${this.tex(f, v)} = e^{${this.tex(this.mul(this.paren(g), this.fn('log', b)), v)}}` });
      const inner = this.lhopital(exponent, v, a, sides, aTex, steps, depth + 1);
      if (inner === null) return null;
      const result = Math.exp(inner);
      steps.push({ rule: 'Take the exponential of that limit', tex: `\\lim_{${v} \\to ${aTex}} ${this.tex(f, v)} = e^{${showNumber(inner).tex}} = ${showNumber(result).tex}` });
      return result;
    }
    // A sum of terms that each have a finite limit.
    if (op && (op.fn === 'add' || op.fn === 'subtract')) {
      const parts = op.args.map((n) => this.lhopital(n, v, a, sides, aTex, [], depth + 1));
      if (parts.every((x) => x !== null && Number.isFinite(x))) {
        const [x, y] = parts as [number, number];
        const value = op.fn === 'add' ? x + y : x - y;
        steps.push({ rule: 'The limit of a sum is the sum of the limits', tex: `\\lim_{${v} \\to ${aTex}} ${this.tex(f, v)} = ${showNumber(value).tex}` });
        return value;
      }
    }
    return null;
  }

  /* --------------------------------------------------------------- series -- */

  taylor(expression: string, v = 'x', atText = '0', order = 5): Answer {
    const f = this.parse(expression);
    const a = this.value(atText);
    if (!Number.isFinite(a)) throw new Error('A Taylor series needs a finite point.');
    const n = Math.max(1, Math.min(15, Math.round(order)));
    const steps: Step[] = [];
    let current = f;
    const terms: string[] = [];
    const parts: string[] = [];
    let factorial = 1;
    const aShown = showNumber(a);
    const shift = a === 0 ? v : `(${v} - (${a}))`;
    const shiftTex = a === 0 ? v : `\\left(${v} ${a < 0 ? '+' : '-'} ${showNumber(Math.abs(a)).tex}\\right)`;
    for (let k = 0; k <= n; k++) {
      if (k > 0) {
        current = this.simplify(this.math.derivative(current, v));
        factorial *= k;
      }
      const value = Number(current.compile().evaluate({ [v]: a }));
      if (!Number.isFinite(value)) throw new Error(`The function or its derivative number ${k} is not finite at ${atText}: there is no Taylor series there.`);
      steps.push({ rule: k === 0 ? 'The value at the point' : `Derivative number ${k}`, tex: `f${k === 0 ? '' : k <= 3 ? "'".repeat(k) : `^{(${k})}`}(${aShown.tex}) = ${showNumber(value).tex}` });
      if (Math.abs(value) < 1e-13) continue;
      // The coefficient f⁽ᵏ⁾(a)/k! as an exact fraction when the derivative's value is one.
      const coefficient = value / factorial;
      const asFraction = (() => {
        const r = recognise(value);
        const m = r ? /^(-?)(?:\\frac\{(\d+)\}\{(\d+)\}|(\d+))$/.exec(r.tex) : null;
        if (!m) return null;
        let p = Number(m[2] ?? m[4]);
        let q = Number(m[3] ?? 1) * factorial;
        const g = gcd(p, q);
        p /= g;
        q /= g;
        return { negative: m[1] === '-', p, q };
      })();
      const absTex = asFraction ? (asFraction.q === 1 ? String(asFraction.p) : `\\frac{${asFraction.p}}{${asFraction.q}}`) : showNumber(Math.abs(coefficient)).tex;
      const negative = asFraction ? asFraction.negative : coefficient < 0;
      const power = k === 0 ? '' : k === 1 ? shiftTex : `${shiftTex}^{${k}}`;
      const sign = terms.length === 0 ? (negative ? '-' : '') : negative ? ' - ' : ' + ';
      terms.push(`${sign}${k > 0 && absTex === '1' ? '' : absTex}${power}`);
      parts.push(`(${coefficient}) * ${shift}^${k}`);
    }
    const polynomial = parts.length ? parts.join(' + ') : '0';
    const tex = `${this.tex(f, v)} = ${terms.join('') || '0'} + O\\left(${shiftTex}^{${n + 1}}\\right)`;
    return { ok: true, tex, text: polynomial, steps, check: 'Each coefficient is f⁽ᵏ⁾(a)/k!, with the derivatives from mathjs.', expression: polynomial };
  }

  /* -------------------------------------------------------- shape of a graph -- */

  analyse(expression: string, v = 'x', fromText = '-10', toText = '10'): Analysis {
    const f = this.parse(expression);
    const lo = this.value(fromText);
    const hi = this.value(toText);
    if (!(lo < hi)) throw new Error('The range must run from a smaller to a larger number.');
    const d1 = this.simplify(this.math.derivative(f, v));
    const d2 = this.simplify(this.math.derivative(d1, v));
    const fn = (n: MathNode) => {
      const c = n.compile();
      return (x: number) => {
        try {
          return Number(c.evaluate({ [v]: x }));
        } catch {
          return Number.NaN;
        }
      };
    };
    const F = fn(f);
    const F1 = fn(d1);
    const F2 = fn(d2);
    const zeros = (node: MathNode, g: (x: number) => number): number[] => {
      const coeffs = this.polyCoefficients(node, v);
      if (coeffs && coeffs.length > 1) {
        return polynomialRoots(coeffs)
          .filter((z) => Math.abs(z.im) < 1e-9 * Math.max(1, Math.abs(z.re)))
          .map((z) => z.re)
          .filter((x) => x >= lo - 1e-12 && x <= hi + 1e-12)
          .sort((p, q) => p - q);
      }
      const found: number[] = [];
      const n = 4000;
      let x0 = lo;
      let y0 = g(lo);
      for (let i = 1; i <= n; i++) {
        const x1 = lo + ((hi - lo) * i) / n;
        const y1 = g(x1);
        if (Number.isFinite(y0) && Number.isFinite(y1)) {
          if (y0 === 0) found.push(x0);
          else if (y0 * y1 < 0) {
            // A sign change with a finite jump is a zero; a jump to large values is a pole.
            const r = bisect(g, x0, x1);
            if (Math.abs(g(r)) < 1e-6 * Math.max(1, Math.abs(y0), Math.abs(y1))) found.push(r);
          }
        }
        x0 = x1;
        y0 = y1;
      }
      return [...new Set(found.map((x) => Number(x.toPrecision(12))))];
    };
    const critical = zeros(d1, F1).map((x) => {
      const curvature = F2(x);
      let kind: CriticalPoint['kind'] = curvature < -1e-9 ? 'maximum' : curvature > 1e-9 ? 'minimum' : 'flat';
      if (kind === 'flat') {
        const h = Math.max(1e-4, Math.abs(x) * 1e-4);
        const l = F1(x - h);
        const r = F1(x + h);
        kind = l > 0 && r < 0 ? 'maximum' : l < 0 && r > 0 ? 'minimum' : 'flat';
      }
      return { x, y: F(x), kind };
    });
    const inflections = zeros(d2, F2)
      .filter((x) => {
        const h = Math.max(1e-4, Math.abs(x) * 1e-4);
        return Math.sign(F2(x - h)) !== Math.sign(F2(x + h));
      })
      .map((x) => ({ x, y: F(x) }));
    // Where the function rises and falls: the sign of f′ between the critical points.
    const cuts = [lo, ...critical.map((c) => c.x).filter((x) => x > lo && x < hi), hi];
    const rising: [number, number][] = [];
    const falling: [number, number][] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const p = cuts[i] as number;
      const q = cuts[i + 1] as number;
      const slope = F1((p + q) / 2);
      if (!Number.isFinite(slope)) continue;
      (slope > 0 ? rising : falling).push([p, q]);
    }
    let best = { x: lo, y: F(lo) };
    let worst = { x: lo, y: F(lo) };
    for (let i = 0; i <= 2000; i++) {
      const x = lo + ((hi - lo) * i) / 2000;
      const y = F(x);
      if (!Number.isFinite(y)) continue;
      if (!Number.isFinite(best.y) || y > best.y) best = { x, y };
      if (!Number.isFinite(worst.y) || y < worst.y) worst = { x, y };
    }
    for (const c of critical) {
      if (Number.isFinite(c.y) && c.y >= best.y) best = { x: c.x, y: c.y };
      if (Number.isFinite(c.y) && c.y <= worst.y) worst = { x: c.x, y: c.y };
    }
    return { derivative: d1.toString(), derivativeTex: this.tex(d1, v), second: d2.toString(), secondTex: this.tex(d2, v), critical, inflections, rising, falling, highest: best, lowest: worst };
  }

  tangent(expression: string, v = 'x', atText = '1'): Answer {
    const f = this.parse(expression);
    const a = this.value(atText);
    const y0 = Number(f.compile().evaluate({ [v]: a }));
    const d1 = this.math.derivative(f, v);
    const m = Number(d1.compile().evaluate({ [v]: a }));
    if (!Number.isFinite(y0) || !Number.isFinite(m)) throw new Error('The function or its slope is not finite at that point.');
    const steps: Step[] = [
      { rule: 'The point', tex: `f(${showNumber(a).tex}) = ${showNumber(y0).tex}` },
      { rule: 'The slope is the derivative there', tex: `f'(${v}) = ${this.tex(this.simplify(d1), v)},\\quad f'(${showNumber(a).tex}) = ${showNumber(m).tex}` },
    ];
    const b = y0 - m * a;
    const line = `${showNumber(m).tex === '0' ? '' : `${showNumber(m).tex === '1' ? '' : showNumber(m).tex === '-1' ? '-' : showNumber(m).tex}${v}`}${b === 0 && m !== 0 ? '' : `${b < 0 ? ' - ' : m === 0 ? '' : ' + '}${showNumber(Math.abs(b)).tex}`}`;
    steps.push({ rule: 'Point–slope form: y − y₀ = m(x − x₀)', tex: `y = ${line}` });
    let normal = '';
    if (Math.abs(m) > 1e-14) {
      const nm = -1 / m;
      const nb = y0 - nm * a;
      normal = `y = ${showNumber(nm).tex}${v} ${nb < 0 ? '-' : '+'} ${showNumber(Math.abs(nb)).tex}`;
      steps.push({ rule: 'The normal is perpendicular: slope −1/m', tex: normal });
    }
    return { ok: true, tex: `y = ${line}`, text: `${m} * ${v} + ${b}`, value: m, steps, check: 'From mathjs’s derivative.', expression: `${m} * ${v} + ${b}` };
  }

  /* -------------------------------------------------- differential equations -- */

  /**
   * y′ = f(x, y) or y″ = f(x, y, y′) (y′ written yp) by the classical
   * fourth-order Runge–Kutta method.
   */
  ode(rhs: string, order: 1 | 2, x0: number, y0: number, yp0: number, x1: number, n = 1000): { x: number[]; y: number[]; yp: number[] } {
    const g = this.parse(rhs.replace(/y''/g, 'ypp').replace(/y'/g, 'yp')).compile();
    const f = (x: number, y: number, yp: number) => Number(g.evaluate({ x, y, yp }));
    const steps = Math.max(10, Math.min(20000, Math.round(n)));
    const h = (x1 - x0) / steps;
    const xs = [x0];
    const ys = [y0];
    const yps = [order === 2 ? yp0 : f(x0, y0, 0)];
    let x = x0;
    let y = y0;
    let p = yp0;
    for (let i = 0; i < steps; i++) {
      if (order === 1) {
        const k1 = f(x, y, 0);
        const k2 = f(x + h / 2, y + (h * k1) / 2, 0);
        const k3 = f(x + h / 2, y + (h * k2) / 2, 0);
        const k4 = f(x + h, y + h * k3, 0);
        y += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      } else {
        const a1 = p;
        const b1 = f(x, y, p);
        const a2 = p + (h * b1) / 2;
        const b2 = f(x + h / 2, y + (h * a1) / 2, p + (h * b1) / 2);
        const a3 = p + (h * b2) / 2;
        const b3 = f(x + h / 2, y + (h * a2) / 2, p + (h * b2) / 2);
        const a4 = p + h * b3;
        const b4 = f(x + h, y + h * a3, p + h * b3);
        y += (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
        p += (h / 6) * (b1 + 2 * b2 + 2 * b3 + b4);
      }
      x = x0 + h * (i + 1);
      if (!Number.isFinite(y) || Math.abs(y) > 1e15) break;
      xs.push(x);
      ys.push(y);
      yps.push(order === 2 ? p : f(x, y, 0));
    }
    return { x: xs, y: ys, yp: yps };
  }

  /** a·y″ + b·y′ + c·y = 0 (a = 0 for first order) with y(x₀) and y′(x₀): the exact solution. */
  linearOde(a: number, b: number, c: number, x0: number, y0: number, yp0: number): Answer {
    const steps: Step[] = [];
    const n = (z: number) => showNumber(z).tex;
    const X = x0 === 0 ? 'x' : `\\left(x ${x0 < 0 ? '+' : '-'} ${n(Math.abs(x0))}\\right)`;
    const Xt = x0 === 0 ? 'x' : `(x - (${x0}))`;
    /** c·e^{r X}, leaving out what is 1 or 0. */
    const expTerm = (coef: number, r: number) => {
      if (coef === 0) return '';
      const e = r === 0 ? '' : `e^{${r === 1 ? '' : r === -1 ? '-' : n(r)}${X}}`;
      const c = coef === 1 && e ? '' : coef === -1 && e ? '-' : n(coef);
      return `${c}${e}`;
    };
    const join = (terms: string[]) => terms.filter(Boolean).reduce((acc, t) => (acc ? (t.startsWith('-') ? `${acc} - ${t.slice(1)}` : `${acc} + ${t}`) : t), '') || '0';
    const poly = (coeffs: [number, string][]) => join(coeffs.map(([k, t]) => (k === 0 ? '' : `${k === 1 && t ? '' : k === -1 && t ? '-' : n(k)}${t}`)));
    if (a === 0) {
      if (b === 0) throw new Error('With a = 0 and b = 0 there is no equation.');
      const k = -c / b;
      steps.push({
        rule: 'Separate the variables',
        tex: `${poly([
          [b, "y'"],
          [c, 'y'],
        ])} = 0 \\;\\Rightarrow\\; \\frac{y'}{y} = ${n(k)}`,
      });
      steps.push({ rule: 'Integrate both sides: ln y = kx + C', tex: `y = C\\,e^{${n(k)}${X}}` });
      steps.push({ rule: 'The initial condition gives C', tex: `C = y(${n(x0)}) = ${n(y0)}` });
      return { ok: true, tex: `y = ${expTerm(y0, k) || '0'}`, text: `${y0} * e^(${k} * ${Xt})`, steps, check: 'Exact.', expression: `${y0} * e^(${k} * ${Xt})` };
    }
    const disc = b * b - 4 * a * c;
    steps.push({
      rule: 'Try y = e^{rx}: the characteristic equation',
      tex: `${poly([
        [a, 'r^{2}'],
        [b, 'r'],
        [c, ''],
      ])} = 0,\\quad \\Delta = b^{2} - 4ac = ${n(disc)}`,
    });
    let tex: string;
    let text: string;
    if (disc > 1e-12) {
      const r1 = (-b + Math.sqrt(disc)) / (2 * a);
      const r2 = (-b - Math.sqrt(disc)) / (2 * a);
      const c2 = (r1 * y0 - yp0) / (r1 - r2);
      const c1 = y0 - c2;
      steps.push({ rule: 'Two real roots', tex: `r_1 = ${n(r1)},\\; r_2 = ${n(r2)},\\quad y = C_1 e^{r_1 ${X}} + C_2 e^{r_2 ${X}}` });
      steps.push({ rule: 'The initial conditions: C₁ + C₂ = y₀ and r₁C₁ + r₂C₂ = y′₀', tex: `C_1 = ${n(c1)},\\; C_2 = ${n(c2)}` });
      tex = `y = ${join([expTerm(c1, r1), expTerm(c2, r2)])}`;
      text = `${c1} * e^(${r1} * ${Xt}) + ${c2} * e^(${r2} * ${Xt})`;
    } else if (disc < -1e-12) {
      const alpha = -b / (2 * a);
      const beta = Math.sqrt(-disc) / (2 * a);
      const c1 = y0;
      const c2 = (yp0 - alpha * y0) / beta;
      const bx = `${beta === 1 ? '' : n(beta)}${X}`;
      steps.push({ rule: 'Complex roots α ± βi', tex: `\\alpha = ${n(alpha)},\\; \\beta = ${n(beta)},\\quad y = e^{\\alpha ${X}}\\left(C_1\\cos \\beta ${X} + C_2 \\sin \\beta ${X}\\right)` });
      steps.push({ rule: 'The initial conditions: C₁ = y₀ and αC₁ + βC₂ = y′₀', tex: `C_1 = ${n(c1)},\\; C_2 = ${n(c2)}` });
      const inside = join([c1 === 0 ? '' : `${c1 === 1 ? '' : c1 === -1 ? '-' : n(c1)}\\cos(${bx})`, c2 === 0 ? '' : `${c2 === 1 ? '' : c2 === -1 ? '-' : n(c2)}\\sin(${bx})`]);
      tex = alpha === 0 ? `y = ${inside}` : `y = e^{${n(alpha)}${X}}\\left(${inside}\\right)`;
      text = `e^(${alpha} * ${Xt}) * (${c1} * cos(${beta} * ${Xt}) + ${c2} * sin(${beta} * ${Xt}))`;
    } else {
      const r = -b / (2 * a);
      const c1 = y0;
      const c2 = yp0 - r * y0;
      steps.push({ rule: 'A repeated root', tex: `r = ${n(r)},\\quad y = (C_1 + C_2 ${X})\\,e^{r ${X}}` });
      steps.push({ rule: 'The initial conditions: C₁ = y₀ and C₂ + rC₁ = y′₀', tex: `C_1 = ${n(c1)},\\; C_2 = ${n(c2)}` });
      const lin = join([c1 === 0 ? '' : n(c1), c2 === 0 ? '' : `${c2 === 1 ? '' : c2 === -1 ? '-' : n(c2)}${X}`]);
      tex = r === 0 ? `y = ${lin}` : `y = \\left(${lin}\\right)e^{${r === 1 ? '' : r === -1 ? '-' : n(r)}${X}}`;
      text = `(${c1} + ${c2} * ${Xt}) * e^(${r} * ${Xt})`;
    }
    return { ok: true, tex, text, steps, check: 'Exact; the graph compares it with a numerical solution.', expression: text };
  }

  /* -------------------------------------------------------- Riemann sums -- */

  riemann(expression: string, v: string, aText: string, bText: string, n: number, kind: RiemannKind): RiemannSum {
    const f = this.parse(expression).compile();
    const at = (x: number) => Number(f.evaluate({ [v]: x }));
    const a = this.value(aText);
    const b = this.value(bText);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) throw new Error('Give two different, finite limits.');
    const count = Math.max(1, Math.min(1000, Math.round(n)));
    const h = (b - a) / count;
    const pieces: { x0: number; x1: number; y0: number; y1: number }[] = [];
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const x0 = a + i * h;
      const x1 = x0 + h;
      if (kind === 'trapezoid') {
        const y0 = at(x0);
        const y1 = at(x1);
        sum += ((y0 + y1) / 2) * h;
        pieces.push({ x0, x1, y0, y1 });
      } else if (kind === 'simpson') {
        const ym = at((x0 + x1) / 2);
        const y0 = at(x0);
        const y1 = at(x1);
        sum += ((y0 + 4 * ym + y1) / 6) * h;
        pieces.push({ x0, x1, y0, y1 });
      } else {
        const y = at(kind === 'left' ? x0 : kind === 'right' ? x1 : (x0 + x1) / 2);
        sum += y * h;
        pieces.push({ x0, x1, y0: y, y1: y });
      }
    }
    const exact = this.numericIntegral(at, a, b);
    return { sum, exact, error: sum - exact, pieces };
  }
}

export interface CriticalPoint {
  readonly x: number;
  readonly y: number;
  readonly kind: 'maximum' | 'minimum' | 'flat';
}

export interface Analysis {
  readonly derivative: string;
  readonly derivativeTex: string;
  readonly second: string;
  readonly secondTex: string;
  readonly critical: readonly CriticalPoint[];
  readonly inflections: readonly { x: number; y: number }[];
  readonly rising: readonly [number, number][];
  readonly falling: readonly [number, number][];
  readonly highest: { x: number; y: number };
  readonly lowest: { x: number; y: number };
}

export type RiemannKind = 'left' | 'right' | 'midpoint' | 'trapezoid' | 'simpson';

export interface RiemannSum {
  readonly sum: number;
  readonly exact: number;
  readonly error: number;
  readonly pieces: readonly { x0: number; x1: number; y0: number; y1: number }[];
}

/* ------------------------------------------------------------------ numerics -- */

const close = (x: number, y: number) => (x === y ? true : Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-4 * Math.max(1, Math.abs(x), Math.abs(y)));

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/**
 * The limit of f at a from one side (s = 1 from above, −1 from below; a may
 * be ±∞) from values ever closer: NaN when they do not settle.  Rounding
 * swamps differences like 1 − cos x close to the point, so the best value is
 * the one where neighbouring values agree most closely, after a run of ever
 * smaller changes.
 */
export function numericLimit(f: (x: number) => number, a: number, s: 1 | -1): number {
  const scale = Number.isFinite(a) ? Math.max(1, Math.abs(a)) : 1;
  const xs = Number.isFinite(a) ? [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8].map((h) => a + s * h * scale) : [1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8].map((X) => (a > 0 ? X : -X));
  const all = xs.map((x) => {
    try {
      return f(x);
    } catch {
      return Number.NaN;
    }
  });
  const stop = all.findIndex((y) => !Number.isFinite(y));
  const ys = stop < 0 ? all : all.slice(0, stop);
  const beyond = stop < 0 ? null : (all[stop] as number);
  const m = ys.length;
  // Overflowing after growing: infinite.
  if (beyond !== null && Math.abs(beyond) === Infinity && m >= 2) {
    const [p, q] = ys.slice(-2) as [number, number];
    if (Math.abs(q) > Math.abs(p) && Math.sign(q) === Math.sign(beyond)) return beyond;
  }
  if (m < 4) return Number.NaN;
  const last = ys.slice(-4) as [number, number, number, number];
  const [w, p, q, r] = last;
  // Growing without bound: fast (1/x), or by steady steps (ln x).
  const grows = (x: number, y: number) => Math.abs(y) > Math.abs(x) && Math.sign(x) === Math.sign(y);
  if (grows(w, p) && grows(p, q) && grows(q, r)) {
    if (Math.abs(r) > 1e3 && Math.abs(r) > 1.5 * Math.abs(q) && Math.abs(q) > 1.5 * Math.abs(p)) return Math.sign(r) * Infinity;
    const [d0, d1, d2] = [Math.abs(p - w), Math.abs(q - p), Math.abs(r - q)];
    const steady = (x: number, y: number) => y >= 0.8 * x && y <= 1.25 * x;
    if (steady(d0, d1) && steady(d1, d2) && d2 > 1e-3 * Math.abs(r)) return Math.sign(r) * Infinity;
  }
  // Shrinking to zero: halving or better each step (x ln x, √x), or already far below where it started (x sin(1/x)).
  const early = Math.max(...ys.slice(0, Math.ceil(m / 2)).map(Math.abs));
  const halving = [w, p, q, r].every((y, i, l) => i === 0 || Math.abs(y) <= Math.abs(l[i - 1] as number) / 2);
  if ((halving && Math.abs(r) < 1e-3 * early) || (Math.max(Math.abs(p), Math.abs(q), Math.abs(r)) < 1e-6 && Math.abs(r) < 1e-3 * early)) return 0;
  // Settling: the smallest change between neighbours, after changes that kept shrinking.
  const d = ys.slice(1).map((y, i) => Math.abs(y - (ys[i] as number)));
  let k = 0;
  for (let i = 1; i < d.length; i++) if ((d[i] as number) < (d[k] as number)) k = i;
  const y = ys[k + 1] as number;
  const size = Math.max(1, Math.abs(y));
  const dk = d[k] as number;
  // Changes that kept shrinking up to the best value: not a chance near-repeat.
  for (let i = Math.max(0, k - 2); i < k; i++) if (!((d[i] as number) > (d[i + 1] as number))) return Number.NaN;
  // A geometric run (each change a steady fraction of the one before) can be extrapolated from further out.
  const ratio = (i: number) => (d[i] as number) / (d[i - 1] as number);
  const geometric = k >= 2 && ratio(k) <= 0.5 && ratio(k - 1) <= 0.5 && ratio(k) <= 3 * ratio(k - 1) && ratio(k - 1) <= 3 * ratio(k);
  if (dk > (geometric ? 1e-3 : 1e-6) * size) return Number.NaN;
  if (k >= 1) {
    // One Aitken step removes the leading error term.
    const step = y - (ys[k] as number);
    const before = (ys[k] as number) - (ys[k - 1] as number);
    const rho = before === 0 ? 0 : step / before;
    if (Math.abs(rho) <= 0.5) return y + (step * rho) / (1 - rho);
  }
  return y;
}

/**
 * Points inside (lo, hi) where f blows up: where it is not a number, where it
 * jumps from large and positive to large and negative (an odd pole, found by
 * bisecting 1/f), or where |f| peaks far above its usual size (an even pole).
 */
export function findPoles(f: (x: number) => number, lo: number, hi: number): number[] {
  const n = 4000;
  // An infinite range is sampled through x = tan θ.
  const map = (t: number) =>
    Number.isFinite(lo) && Number.isFinite(hi)
      ? lo + (hi - lo) * t
      : Math.tan(Math.atan(Number.isFinite(lo) ? lo : -Infinity) + (Math.atan(Number.isFinite(hi) ? hi : Infinity) - Math.atan(Number.isFinite(lo) ? lo : -Infinity)) * t);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < n; i++) {
    const x = map(i / n);
    xs.push(x);
    ys.push(f(x));
  }
  const sizes = ys
    .filter(Number.isFinite)
    .map(Math.abs)
    .sort((p, q) => p - q);
  const typical = sizes.length ? (sizes[Math.floor(sizes.length / 2)] as number) : 1;
  const huge = 1e4 * Math.max(typical, 1e-9);
  const found: number[] = [];
  const add = (x: number) => {
    if (x > lo && x < hi && !found.some((y) => Math.abs(y - x) <= 1e-9 * Math.max(1, Math.abs(x)))) found.push(x);
  };
  for (let i = 0; i < ys.length; i++) {
    const x = xs[i] as number;
    const y = ys[i] as number;
    if (!Number.isFinite(y)) {
      // Not a number inside: a pole when the values beside it are large, else a gap (sin(x)/x at 0) that does no harm.
      const h = 1e-7 * Math.max(1, Math.abs(x));
      if (Math.abs(f(x - h)) > huge || Math.abs(f(x + h)) > huge || !Number.isNaN(y)) add(x);
      continue;
    }
    const next = ys[i + 1];
    if (next !== undefined && Number.isFinite(next) && Math.sign(next) !== Math.sign(y) && Math.min(Math.abs(y), Math.abs(next)) > huge / 100) {
      const c = bisect((t) => 1 / f(t), x, xs[i + 1] as number);
      const h = 1e-9 * Math.max(1, Math.abs(c));
      if (!(Math.abs(f(c - h)) < huge && Math.abs(f(c + h)) < huge)) add(c);
      continue;
    }
    const before = ys[i - 1];
    if (before !== undefined && next !== undefined && Math.abs(y) > huge && Math.abs(y) >= Math.abs(before) && Math.abs(y) >= Math.abs(next)) {
      // Narrow down the peak by golden-section search on |f|.
      let p = xs[i - 1] as number;
      let q = xs[i + 1] as number;
      const g = (Math.sqrt(5) - 1) / 2;
      for (let k = 0; k < 120 && q - p > 1e-14 * Math.max(1, Math.abs(p)); k++) {
        const m1 = q - g * (q - p);
        const m2 = p + g * (q - p);
        const f1 = Math.abs(f(m1));
        const f2 = Math.abs(f(m2));
        if (!Number.isFinite(f1)) {
          p = q = m1;
          break;
        }
        if (!Number.isFinite(f2)) {
          p = q = m2;
          break;
        }
        if (f1 > f2) q = m2;
        else p = m1;
      }
      const c = (p + q) / 2;
      // A pole keeps growing as the peak is approached; a tall smooth bump does not.
      const h = 1e-6 * Math.max(1, Math.abs(c));
      if (!Number.isFinite(f(c)) || Math.abs(f(c + h / 100)) > 50 * Math.abs(f(c + h))) add(c);
    }
  }
  return found.sort((p, q) => p - q);
}

/** ∫ from p to q, with limits of proper integrals at the ends marked bad: ±∞ when it diverges, NaN when it does not settle. */
function improperPiece(f: (x: number) => number, p: number, q: number, pBad: boolean, qBad: boolean): number {
  const safe = (x: number) => {
    const y = f(x);
    return Number.isFinite(y) ? y : 0;
  };
  if (!pBad && !qBad) return gk(safe, p, q, true);
  if (pBad && qBad) {
    const m = Number.isFinite(p) && Number.isFinite(q) ? (p + q) / 2 : Number.isFinite(p) ? p + 1 : Number.isFinite(q) ? q - 1 : 0;
    return improperPiece(f, p, m, true, false) + improperPiece(f, m, q, false, true);
  }
  // Integrals out to ever nearer (or further) points, each one adding the stretch since the last.
  const growing = (from: number, toward: (s: number) => number) => {
    let reached = from;
    let sum = 0;
    return (s: number) => {
      const to = toward(s);
      if (Number.isNaN(sum)) return sum;
      sum += to > reached ? gk(safe, reached, to, true, 60_000) : -gk(safe, to, reached, true, 60_000);
      reached = to;
      return sum;
    };
  };
  if (qBad) {
    const G = growing(p, (s) => s);
    return Number.isFinite(q) ? numericLimit(G, q, -1) : numericLimit((s) => G(p + s), Infinity, -1);
  }
  const H = growing(q, (s) => s);
  // ∫ from t to q = −(∫ from q to t).
  return Number.isFinite(p) ? -numericLimit(H, p, 1) : -numericLimit((s) => H(q - s), Infinity, -1);
}

/** Tanh-sinh (double exponential) quadrature on [a, b]: copes with integrands infinite at either end. */
function tanhSinh(f: (x: number) => number, a: number, b: number): number {
  const half = (b - a) / 2;
  let previous = Number.NaN;
  for (let level = 3; level <= 9; level++) {
    const h = 2 ** -level;
    let sum = 0;
    for (let k = -Math.ceil(4 / h); k <= Math.ceil(4 / h); k++) {
      const t = k * h;
      const u = (Math.PI / 2) * Math.sinh(t);
      // Distance from the nearer end, computed without cancellation.
      const gap = (2 * half) / (1 + Math.exp(2 * Math.abs(u)));
      if (gap <= 0) continue;
      const x = t >= 0 ? b - gap : a + gap;
      const w = (half * (Math.PI / 2) * Math.cosh(t)) / Math.cosh(u) ** 2;
      if (!(w > 0)) continue;
      const y = f(x);
      if (Number.isFinite(y)) sum += w * y;
    }
    const value = sum * h;
    if (Math.abs(value - previous) <= 1e-12 * Math.max(1, Math.abs(value))) return value;
    previous = value;
  }
  return previous;
}

function bisect(f: (x: number) => number, a0: number, b0: number): number {
  let a = a0;
  let b = b0;
  let fa = f(a);
  for (let i = 0; i < 100 && b - a > 1e-14 * Math.max(1, Math.abs(a)); i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm === 0) return m;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return (a + b) / 2;
}

const KX = [0.991455371120813, 0.949107912342759, 0.864864423359769, 0.741531185599394, 0.58608723546769, 0.405845151377397, 0.207784955007898, 0];
const KW = [0.02293532201052922, 0.063092092629979, 0.10479001032225, 0.140653259715525, 0.169004726639267, 0.190350578064785, 0.204432940075298, 0.209482141084728];
const GW = [0.12948496616887, 0.279705391489277, 0.381830050505119, 0.417959183673469];

/**
 * Globally adaptive Gauss–Kronrod (7–15) on a finite interval: the piece with
 * the largest error estimate is halved until the total error is small.
 * Endpoints are never evaluated, so endpoint singularities are tolerated.
 * Strict mode returns NaN when the budget runs out before the error is small.
 */
function gk(f: (x: number) => number, a: number, b: number, strict = false, budget = 200_000): number {
  if (a === b) return 0;
  const segment = (lo: number, hi: number): [number, number] => {
    const c = (lo + hi) / 2;
    const h = (hi - lo) / 2;
    let k = 0;
    let g = 0;
    for (let i = 0; i < 8; i++) {
      const x = KX[i] as number;
      const w = KW[i] as number;
      const v = x === 0 ? f(c) : f(c - h * x) + f(c + h * x);
      k += w * v;
      if (x === 0) g += (GW[3] as number) * v;
      else if (i % 2 === 1) g += (GW[(i - 1) / 2] as number) * v;
    }
    return [k * h, Math.abs((k - g) * h)];
  };
  // A binary max-heap of pieces by error.
  const heap: { lo: number; hi: number; value: number; error: number }[] = [];
  const push = (item: { lo: number; hi: number; value: number; error: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((heap[parent] as typeof item).error >= item.error) break;
      heap[i] = heap[parent] as typeof item;
      i = parent;
    }
    heap[i] = item;
  };
  const pop = () => {
    const top = heap[0] as (typeof heap)[number];
    const last = heap.pop() as (typeof heap)[number];
    if (heap.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        const at = (j: number) => (j === i ? last.error : (heap[j] as (typeof heap)[number]).error);
        if (l < heap.length && at(l) > at(m)) m = l;
        if (r < heap.length && at(r) > at(m)) m = r;
        if (m === i) break;
        heap[i] = heap[m] as (typeof heap)[number];
        i = m;
      }
      heap[i] = last;
    }
    return top;
  };
  const [v0, e0] = segment(a, b);
  if (!Number.isFinite(v0)) return Number.NaN;
  push({ lo: a, hi: b, value: v0, error: e0 });
  let total = v0;
  let error = e0;
  let evaluations = 15;
  while (error > Math.max(1e-11 * Math.abs(total), 1e-300) && evaluations < budget) {
    const worst = pop();
    const mid = (worst.lo + worst.hi) / 2;
    if (!(mid > worst.lo && mid < worst.hi)) {
      // Too narrow to split in floating point: keep it as it is.
      push({ ...worst, error: 0 });
      error -= worst.error;
      continue;
    }
    const [lv, le] = segment(worst.lo, mid);
    const [rv, re] = segment(mid, worst.hi);
    evaluations += 30;
    if (!Number.isFinite(lv) || !Number.isFinite(rv)) return Number.NaN;
    total += lv + rv - worst.value;
    error += le + re - worst.error;
    push({ lo: worst.lo, hi: mid, value: lv, error: le });
    push({ lo: mid, hi: worst.hi, value: rv, error: re });
  }
  if (strict && error > 1e-7 * Math.max(1, Math.abs(total))) return Number.NaN;
  // Re-add the pieces to shed the rounding of the running sum.
  return heap.reduce((sum, piece) => sum + piece.value, 0);
}

/* ---------------------------------------------------------------- the graph -- */

export interface GraphLine {
  readonly label: string;
  readonly f: (x: number) => number;
  readonly dashed?: boolean;
}

export interface GraphOptions {
  readonly from: number;
  readonly to: number;
  readonly lines: readonly GraphLine[];
  /** Shade the area under the first line between these. */
  readonly area?: readonly [number, number];
  readonly rectangles?: readonly { x0: number; x1: number; y0: number; y1: number }[];
  readonly points?: readonly { x: number; y: number; label: string }[];
  readonly variable?: string;
}

/** One-axis line graph with the Okabe–Ito colours in order, a legend for two or more lines. */
/** The graph's size and margins in SVG units, for pointer read-outs over it. */
export const GRAPH_FRAME = { width: 640, height: 360, left: 52, right: 14, top: 14, bottom: 34 } as const;
export const GRAPH_COLORS = CHART_COLORS;

export function graphSvg(o: GraphOptions): string {
  const W = GRAPH_FRAME.width;
  const H = GRAPH_FRAME.height;
  const L = GRAPH_FRAME.left;
  const R = GRAPH_FRAME.right;
  const T = GRAPH_FRAME.top;
  const B = GRAPH_FRAME.bottom;
  const N = 600;
  const xs = Array.from({ length: N + 1 }, (_, i) => o.from + ((o.to - o.from) * i) / N);
  const series = o.lines.map((line) => xs.map((x) => line.f(x)));
  const values = series.flat().filter(Number.isFinite);
  for (const p of o.points ?? []) if (Number.isFinite(p.y)) values.push(p.y);
  for (const r of o.rectangles ?? []) values.push(r.y0, r.y1);
  values.push(0);
  // Clip extreme values (poles) to the middle 98% so the shape stays readable.
  const sorted = [...values].sort((p, q) => p - q);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] as number;
  const y0 = sorted.length > 50 ? pick(0.01) : (sorted[0] ?? -1);
  const y1 = sorted.length > 50 ? pick(0.99) : (sorted[sorted.length - 1] ?? 1);
  const scale = niceScale(y0, y1, false);
  const xScale = niceScale(o.from, o.to, false);
  const sx = (x: number) => L + ((x - o.from) / (o.to - o.from)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - scale.lo) / (scale.hi - scale.lo || 1)) * (H - T - B);
  const tick = (v: number) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1) : String(Number(v.toPrecision(6))));
  const font = 'font-family="system-ui, sans-serif"';
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="cx-graph" role="img" aria-label="${escapeXml(`Graph of ${o.lines.map((l) => l.label).join(', ')}`)}">`,
  ];
  out.push(`<rect width="${W}" height="${H}" class="cx-bg"/>`);
  for (const t of scale.ticks) {
    out.push(`<line x1="${L}" x2="${W - R}" y1="${sy(t).toFixed(1)}" y2="${sy(t).toFixed(1)}" class="${t === 0 ? 'cx-axis' : 'cx-grid'}"/>`);
    out.push(`<text x="${L - 6}" y="${(sy(t) + 4).toFixed(1)}" text-anchor="end" font-size="11" class="cx-tick" ${font}>${tick(t)}</text>`);
  }
  for (const t of xScale.ticks) {
    if (t < o.from || t > o.to) continue;
    out.push(`<line x1="${sx(t).toFixed(1)}" x2="${sx(t).toFixed(1)}" y1="${T}" y2="${H - B}" class="${t === 0 ? 'cx-axis' : 'cx-grid'}"/>`);
    out.push(`<text x="${sx(t).toFixed(1)}" y="${H - B + 15}" text-anchor="middle" font-size="11" class="cx-tick" ${font}>${tick(t)}</text>`);
  }
  out.push(`<text x="${(L + W - R) / 2}" y="${H - 5}" text-anchor="middle" font-size="12" font-style="italic" class="cx-tick" ${font}>${escapeXml(o.variable ?? 'x')}</text>`);
  const clampY = (y: number) => Math.min(H - B + 40, Math.max(T - 40, sy(y)));
  const first = o.lines[0];
  if (o.area && first) {
    const [a, b] = o.area;
    const pts: string[] = [`${sx(a).toFixed(1)},${sy(0).toFixed(1)}`];
    for (let i = 0; i <= 200; i++) {
      const x = a + ((b - a) * i) / 200;
      const y = first.f(x);
      if (Number.isFinite(y)) pts.push(`${sx(x).toFixed(1)},${clampY(y).toFixed(1)}`);
    }
    pts.push(`${sx(b).toFixed(1)},${sy(0).toFixed(1)}`);
    out.push(`<polygon points="${pts.join(' ')}" class="cx-area"/>`);
  }
  for (const r of o.rectangles ?? []) {
    const top = `${sx(r.x0).toFixed(1)},${clampY(r.y0).toFixed(1)} ${sx(r.x1).toFixed(1)},${clampY(r.y1).toFixed(1)}`;
    out.push(`<polygon points="${sx(r.x0).toFixed(1)},${sy(0).toFixed(1)} ${top} ${sx(r.x1).toFixed(1)},${sy(0).toFixed(1)}" class="cx-rect"/>`);
  }
  series.forEach((ys, k) => {
    let d = '';
    let pen = false;
    let last = Number.NaN;
    ys.forEach((y, i) => {
      // Break the line at poles: a jump across most of the plot.
      if (!Number.isFinite(y) || (Number.isFinite(last) && Math.abs(sy(y) - sy(last)) > H * 1.5)) {
        pen = false;
        last = y;
        if (!Number.isFinite(y)) return;
      }
      d += `${pen ? 'L' : 'M'}${sx(xs[i] as number).toFixed(1)} ${clampY(y).toFixed(1)}`;
      pen = true;
      last = y;
    });
    out.push(`<path d="${d}" fill="none" stroke="${CHART_COLORS[k % 6]}" stroke-width="2" stroke-linejoin="round"${o.lines[k]?.dashed ? ' stroke-dasharray="6 4"' : ''}/>`);
  });
  for (const p of o.points ?? []) {
    if (!Number.isFinite(p.y) || p.x < o.from || p.x > o.to) continue;
    out.push(`<circle cx="${sx(p.x).toFixed(1)}" cy="${clampY(p.y).toFixed(1)}" r="4.5" class="cx-point"/>`);
    // Labels near the right edge sit to the left of their point.
    const right = sx(p.x) > W - R - 70;
    if (p.label)
      out.push(
        `<text x="${(sx(p.x) + (right ? -7 : 7)).toFixed(1)}" y="${(clampY(p.y) - 7).toFixed(1)}" font-size="11" class="cx-label"${right ? ' text-anchor="end"' : ''} ${font}>${escapeXml(p.label)}</text>`,
      );
  }
  if (o.lines.length > 1) {
    o.lines.forEach((line, k) => {
      const y = T + 12 + k * 16;
      out.push(`<line x1="${L + 10}" x2="${L + 30}" y1="${y - 4}" y2="${y - 4}" stroke="${CHART_COLORS[k % 6]}" stroke-width="2"${line.dashed ? ' stroke-dasharray="6 4"' : ''}/>`);
      out.push(`<text x="${L + 36}" y="${y}" font-size="11.5" class="cx-label" ${font}>${escapeXml(line.label)}</text>`);
    });
  }
  out.push('</svg>');
  return out.join('');
}
