import { all, create } from 'mathjs';
import nerdamer from 'nerdamer-prime';
import { describe, expect, it } from 'vitest';
import { Calculus, graphSvg, nerdamerCas, numericLimit, recognise, showNumber } from '../../src/lib/calculus';

const math = create(all, { number: 'number' });
const calc = new Calculus(math, nerdamerCas(nerdamer));
const at = (expression: string, x: number) => Number(calc.parse(expression).evaluate({ x }));

describe('closed forms', () => {
  it('recognises fractions and multiples of constants', () => {
    expect(recognise(0.5)?.text).toBe('1/2');
    expect(recognise(Math.PI / 2)?.text).toBe('π/2');
    expect(recognise(Math.SQRT2 / 2)?.text).toBe('√2/2');
    expect(recognise(Math.sqrt(Math.PI))?.text).toBe('√π');
    expect(recognise(0.123456789)).toBeNull();
    expect(showNumber(Infinity).text).toBe('∞');
    expect(showNumber(1.23456789012345e-7).tex).toContain('10^{-7}');
  });
});

describe('reading expressions', () => {
  it('reads a lone letter before a bracket as a product, and ln, π and ∞', () => {
    expect(calc.parse('x(x+1)').evaluate({ x: 2 })).toBe(6);
    expect(calc.parse('y (1 - y)').evaluate({ y: 0.5 })).toBe(0.25);
    expect(calc.parse('pi(2)').evaluate({})).toBeCloseTo(2 * Math.PI, 12);
    expect(calc.parse('ln(e^2)').evaluate({})).toBeCloseTo(2, 12);
    expect(calc.parse('log(8, 2)').evaluate({})).toBeCloseTo(3, 12);
    expect(calc.value('∞')).toBe(Infinity);
    expect(() => calc.parse('x^^2')).toThrow('could not be read');
  });
});

describe('derivatives', () => {
  it('works the product, chain and quotient rules, with steps', () => {
    const product = calc.derivative('x^2*sin(x)');
    expect(product.steps.some((s) => s.rule.startsWith('Product rule'))).toBe(true);
    for (const x of [0.3, 1.7]) expect(at(product.expression as string, x)).toBeCloseTo(2 * x * Math.sin(x) + x * x * Math.cos(x), 10);
    const chain = calc.derivative('sin(x^2)');
    expect(chain.steps.some((s) => s.rule.includes('chain rule'))).toBe(true);
    // The denominator stays the square of the original one.
    const quotient = calc.derivative('(x^2+1)/(x-1)');
    expect(quotient.tex).toContain('\\left( x-1\\right)}^{2}');
    expect(at(quotient.expression as string, 3)).toBeCloseTo((9 - 6 - 1) / 4, 12);
  });

  it('takes higher derivatives and constants', () => {
    expect(at(calc.derivative('e^(3x)', 'x', 2).expression as string, 0.5)).toBeCloseTo(9 * Math.exp(1.5), 9);
    expect(calc.derivative('5').text).toBe('0');
    expect(at(calc.derivative('x^x').expression as string, 2)).toBeCloseTo(4 * (Math.log(2) + 1), 10);
  });
});

describe('integrals', () => {
  // Each must be found with worked steps, not handed to the algebra system.
  const worked = [
    'x^3 - 2x + 5',
    '3*cos(2*x)',
    'x*e^x',
    'ln(x)',
    '2x*cos(x^2)',
    'x/(x^2+1)',
    'ln(x)/x',
    '1/(x^2+4x+13)',
    '(3x+2)/(x^2+3x+2)',
    'x^2*sin(x)',
    'e^(2x)*cos(3x)',
    'e^(-x)*sin(2x)',
    '1/sqrt(1-x^2)',
    'sec(x)^2',
    'atan(x)',
    '1/(1+x^2)',
    '5/(2x+1)',
    'x^2*e^(-x)',
  ];
  it.each(worked)('∫ %s dx, with steps and checked', (integrand) => {
    const r = calc.integral(integrand);
    expect(r.ok).toBe(true);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.steps.some((s) => s.rule.includes('computer algebra'))).toBe(false);
    // F′ = f at a few points, by a central difference.
    const F = r.expression as string;
    for (const x of [0.4, 0.9]) {
      const h = 1e-5;
      expect((at(F, x + h) - at(F, x - h)) / (2 * h)).toBeCloseTo(at(integrand, x), 5);
    }
  });

  it('works definite and improper integrals out exactly', () => {
    expect(calc.integral('sin(x)', 'x', ['0', 'pi']).value).toBeCloseTo(2, 12);
    expect(calc.integral('x^2', 'x', ['0', '1']).text).toBe('1/3');
    expect(calc.integral('e^(-x)', 'x', ['0', 'inf']).text).toBe('1');
    expect(calc.integral('e^(-x^2)', 'x', ['-inf', 'inf']).text).toBe('√π');
    expect(calc.integral('1/sqrt(x)', 'x', ['0', '1']).text).toBe('2');
  });

  it('splits at poles inside the range and tests improper integrals for convergence', () => {
    expect(calc.integral('1/x^2', 'x', ['-1', '1']).text).toBe('diverges');
    expect(calc.integral('1/x', 'x', ['-1', '1']).text).toBe('diverges');
    expect(calc.integral('tan(x)', 'x', ['0', 'pi']).text).toBe('diverges');
    expect(calc.integral('1/x', 'x', ['1', 'inf']).text).toBe('diverges');
    expect(calc.integral('sin(x)', 'x', ['0', 'inf']).ok).toBe(false);
    expect(calc.integral('1/sqrt(abs(x))', 'x', ['-1', '1']).value).toBeCloseTo(4, 5);
    expect(calc.integral('1/x^2', 'x', ['1', 'inf']).text).toBe('1');
    expect(calc.integral('ln(x)', 'x', ['0', '1']).text).toBe('-1');
    expect(calc.integral('1/(1+x^2)', 'x', ['-inf', 'inf']).text).toBe('π');
    expect(calc.integral('x', 'x', ['2', '0']).text).toBe('-2');
    expect(calc.integral('sin(x)/x', 'x', ['0', '1']).value).toBeCloseTo(0.946083070367183, 10);
  });

  it('says when an integral diverges or has no elementary antiderivative', () => {
    expect(calc.integral('1/x', 'x', ['0', '1']).ok).toBe(false);
    const gauss = calc.integral('e^(-x^2)', 'x', ['0', '1']);
    expect(gauss.value).toBeCloseTo(0.746824132812427, 10);
  });
});

describe('limits', () => {
  const cases: [string, string, 'both' | 'left' | 'right', string][] = [
    ['sin(x)/x', '0', 'both', '1'],
    ['(x^2-1)/(x-1)', '1', 'both', '2'],
    ['(1-cos(x))/x^2', '0', 'both', '1/2'],
    ['x*ln(x)', '0', 'right', '0'],
    ['(1+1/x)^x', 'inf', 'both', 'e'],
    ['(3x^2+1)/(2x^2-5)', 'inf', 'both', '3/2'],
    ['1/x', '0', 'right', '∞'],
    ['1/ln(x)', '0', 'right', '0'],
    ['x^x', '0', 'right', '1'],
  ];
  it.each(cases)('lim %s at %s (%s) = %s', (f, a, side, want) => {
    const r = calc.limit(f, 'x', a, side);
    expect(r.ok).toBe(true);
    expect(r.text).toBe(want);
    expect(r.steps.length).toBeGreaterThan(0);
  });

  it('reports one-sided limits that differ, and oscillation', () => {
    expect(calc.limit('1/x', 'x', '0').text).toBe('does not exist');
    expect(calc.limit('sin(1/x)', 'x', '0').ok).toBe(false);
  });

  it('finds numeric limits through rounding noise', () => {
    expect(numericLimit((x) => (1 - Math.cos(x)) / (x * x), 0, 1)).toBeCloseTo(0.5, 6);
    expect(numericLimit((x) => (Math.exp(x) - 1 - x) / (x * x), 0, -1)).toBeCloseTo(0.5, 4);
    expect(numericLimit(Math.log, 0, 1)).toBe(-Infinity);
    expect(numericLimit((x) => x * Math.sin(1 / x), 0, 1)).toBe(0);
    expect(numericLimit(Math.sin, Infinity, -1)).toBeNaN();
    expect(numericLimit((x) => (1 + 1 / x) ** x, Infinity, -1)).toBeCloseTo(Math.E, 6);
  });
});

describe('series, analysis and equations', () => {
  it('gives Taylor polynomials with exact coefficients', () => {
    expect(calc.taylor('e^x', 'x', '0', 5).tex).toContain('\\frac{1}{120}');
    expect(calc.taylor('sin(x)', 'x', '0', 7).tex).toContain('\\frac{1}{5040}');
    expect(calc.taylor('ln(x)', 'x', '1', 3).ok).toBe(true);
  });

  it('finds extrema and inflection points', () => {
    const a = calc.analyse('x^3-3x', 'x', '-3', '3');
    const max = a.critical.find((c) => c.kind === 'maximum');
    const min = a.critical.find((c) => c.kind === 'minimum');
    expect(max?.x).toBeCloseTo(-1, 8);
    expect(max?.y).toBeCloseTo(2, 8);
    expect(min?.x).toBeCloseTo(1, 8);
    expect(a.inflections[0]?.x).toBeCloseTo(0, 8);
  });

  it('gives tangent lines', () => {
    const t = calc.tangent('x^2', 'x', '3');
    expect(t.ok).toBe(true);
    expect(at(t.expression as string, 0)).toBeCloseTo(-9, 12);
    expect(at(t.expression as string, 1)).toBeCloseTo(-3, 12);
  });

  it('solves linear ODEs exactly and others numerically', () => {
    const harmonic = calc.linearOde(1, 0, 1, 0, 1, 0);
    for (const x of [0.5, 2]) expect(at(harmonic.expression as string, x)).toBeCloseTo(Math.cos(x), 10);
    const real = calc.linearOde(1, -3, 2, 0, 1, 0);
    expect(at(real.expression as string, 1)).toBeCloseTo(2 * Math.E - Math.E ** 2, 9);
    const repeated = calc.linearOde(1, 2, 1, 0, 1, 0);
    expect(at(repeated.expression as string, 1)).toBeCloseTo(2 / Math.E, 9);
    const growth = calc.ode('y', 1, 0, 1, 0, 1, 200);
    expect(growth.y.at(-1)).toBeCloseTo(Math.E, 8);
    const logistic = calc.ode('y (1 - y)', 1, 0, 0.05, 0, 1, 100);
    expect(logistic.y.at(-1)).toBeCloseTo(1 / (1 + 19 * Math.exp(-1)), 8);
    expect(calc.ode("2 (1 - y^2) y' - y", 2, 0, 0.5, 0, 1, 100).y).toHaveLength(101);
  });

  it('sums Riemann rectangles and compares them with the integral', () => {
    expect(calc.riemann('x^2', 'x', '0', '1', 4, 'left').sum).toBeCloseTo(0.21875, 12);
    expect(calc.riemann('x^2', 'x', '0', '1', 4, 'right').sum).toBeCloseTo(0.46875, 12);
    const simpson = calc.riemann('x^2', 'x', '0', '1', 4, 'simpson');
    expect(simpson.sum).toBeCloseTo(1 / 3, 12);
    expect(simpson.exact).toBeCloseTo(1 / 3, 12);
  });

  it('draws graphs', () => {
    const svg = graphSvg({
      from: -2,
      to: 2,
      lines: [
        { label: 'f', f: (x) => x * x },
        { label: 'tangent', f: (x) => 2 * x - 1, dashed: true },
      ],
      points: [{ x: 1, y: 1, label: 'P' }],
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('tangent');
  });
});
