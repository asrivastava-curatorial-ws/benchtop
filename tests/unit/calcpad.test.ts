import { all, create } from 'mathjs';
import { describe, expect, it } from 'vitest';
import { type Block, CALCPAD_EXAMPLES, calculate, findRoot, formatNumber, integrate, normalise, type Report, setInput, slope, symbolTex, unitTex } from '../../src/lib/calcpad';
import { texToSvg } from '../../src/lib/tex';

const math = create(all, { number: 'number' });
const run = (source: string): Report => calculate(math, source);
const maths = (r: Report) => r.blocks.filter((b): b is Extract<Block, { kind: 'math' }> => b.kind === 'math');
const errorsOf = (r: Report) => r.blocks.filter((b): b is Extract<Block, { kind: 'error' }> => b.kind === 'error');

describe('calcpad numerics', () => {
  it('finds roots, areas and slopes', () => {
    expect(findRoot((x) => x ** 3 - 2 * x - 5, 2, 3)).toBeCloseTo(2.0945514815, 9);
    expect(integrate((x) => x ** 3 - 2 * x - 5, 0, 3)).toBeCloseTo(-3.75, 10);
    expect(integrate(Math.sin, 0, Math.PI)).toBeCloseTo(2, 10);
    expect(integrate((x) => 1 / Math.sqrt(x + 1e-12), 0, 1)).toBeCloseTo(2, 4);
    expect(slope((x) => x * x, 3)).toBeCloseTo(6, 8);
    expect(() => findRoot((x) => x * x + 1, -1, 1)).toThrow(/No root/);
  });

  it('rounds numbers as Calcpad shows them', () => {
    expect(formatNumber(36, 3)).toBe('36');
    expect(formatNumber(12.111244, 3)).toBe('12.111');
    expect(formatNumber(0.0012345, 3)).toBe('0.00123');
    expect(formatNumber(1.5e-7, 3)).toBe('1.5\\times 10^{-7}');
    expect(formatNumber(2.5e9, 2)).toBe('2.5\\times 10^{9}');
    expect(formatNumber(-0.0000001, 3)).toBe('-1\\times 10^{-7}');
    expect(formatNumber(0, 3)).toBe('0');
  });

  it('typesets names and units', () => {
    expect(symbolTex('x_1')).toBe('x_{1}');
    expect(symbolTex('M_max')).toBe('M_{\\mathrm{max}}');
    expect(symbolTex('δ_max')).toBe('\\delta_{\\mathrm{max}}');
    expect(symbolTex('alpha')).toBe('\\alpha');
    expect(symbolTex('Area')).toBe('\\mathit{Area}');
    expect(unitTex('kN m / s^2')).toBe('\\mathrm{kN\\cdot m/s^{2}}');
    expect(unitTex('kohm')).toBe('\\mathrm{k\\Omega}');
    expect(unitTex('uF')).toBe('\\mathrm{\\mu F}');
  });

  it("reads Calcpad's spellings", () => {
    expect(normalise('a ≤ b · c')).toBe('a <= b * c');
    expect(normalise('f(x; y)')).toBe('f(x, y)');
    expect(normalise('[1; 2 | 3; 4]')).toBe('[1, 2 ; 3, 4]');
    expect(normalise('√2 + √(x)')).toBe('sqrt(2) + sqrt(x)');
  });
});

describe('calcpad worksheets', () => {
  it('shows formulas, the values put in, and results with units', () => {
    const r = run('L = 6 m\nq = 12 kN/m\nR = q*L/2\nM = q*L^2/8\nM|kN*m');
    expect(r.errors).toBe(0);
    const [length, load, reaction, moment] = maths(r).map((b) => b.tex);
    expect(length).toBe('L = 6\\ \\mathrm{m}');
    expect(load).toBe('q = 12\\ \\mathrm{kN/m}');
    expect(reaction).toBe('R = \\frac{ q\\cdot L}{2} = \\frac{ \\left(12\\ \\mathrm{kN/m}\\right)\\cdot \\left(6\\ \\mathrm{m}\\right)}{2} = 36\\ \\mathrm{kN}');
    // A moment stays in kN·m rather than becoming kJ.
    expect(moment).toMatch(/= 54\\ \\mathrm\{kN\\cdot m\}$/);
    expect(r.values.get('R')).toBe('36 kN');
  });

  it('names derived units where they are simpler, and cancels like units', () => {
    const r = run('V = 7 V\nI = 20 mA\nR_1 = V/I\nP = I^2*R_1\nv = 72 km/h\nt = 15 min\nd = v*t\nσ = 2 kN/(40 cm^2)\nx = (5 mm)/(2 m)');
    expect(r.errors).toBe(0);
    const t = maths(r).map((b) => b.tex);
    expect(t[2]).toMatch(/= 350\\ \\mathrm\{\\Omega\}$/);
    expect(t[3]).toMatch(/= 0\.14\\ \\mathrm\{W\}$/);
    expect(t[5]).toBe('t = 15\\ \\mathrm{min}');
    expect(t[6]).toMatch(/= 18\\ \\mathrm\{km\}$/);
    expect(t[7]).toMatch(/= 500\\ \\mathrm\{kPa\}$/);
    expect(t[8]).toMatch(/= 0\.0025$/);
  });

  it('converts results with |units', () => {
    const r = run('δ = 0.0121112 m\nδ|mm\nT = 25 degC\nT|degF');
    expect(maths(r)[1]?.tex).toBe('\\delta = 12.111\\ \\mathrm{mm}');
    expect(maths(r)[3]?.tex).toBe('T = 77\\ \\mathrm{°F}');
  });

  it('runs the solvers, with units where the range has them', () => {
    const r = run(
      'f(x) = x^3 - 2*x - 5\nx_1 = $Root{f(x) = 0 @ x = 2 : 3}\nA = $Area{f(x) @ x = 0 : 3}\ny = $Sup{sin(x) @ x = 0 : 180}\nk = $Slope{x^2 @ x = 3}\nS = $Sum{1/n^2 @ n = 1 : 10000}\nP = $Product{k @ k = 1 : 5}\nW = $Area{2 kN @ s = 0 m : 3 m}',
    );
    expect(r.errors).toBe(0);
    expect(r.values.get('x_1')).toBe('2.095');
    expect(r.values.get('A')).toBe('-3.75');
    expect(r.values.get('y')).toBe('1');
    expect(r.values.get('k')).toBe('6');
    expect(Number(r.values.get('S'))).toBeCloseTo(1.645, 3);
    expect(r.values.get('P')).toBe('120');
    expect(r.values.get('W')).toBe('6 kN m');
    expect(maths(r)[0]?.tex).toBe('f{\\left(x\\right)} = { x}^{3}-2\\cdot x-5');
    expect(maths(r)[1]?.tex).toContain('\\mathrm{Root}\\left\\{f{\\left( x\\right)} = 0;\\ x = 2 \\ldots 3\\right\\}');
  });

  it('follows #if, #for, #repeat, #while and #break', () => {
    const r = run(
      [
        'a = 3',
        '#if a > 5',
        "'big",
        '#else if a > 2',
        "'middle",
        '#else',
        "'small",
        '#end if',
        's = 0',
        '#for i = 1 : 10',
        's = s + i',
        '#loop',
        'n = 0',
        '#while n < 100',
        'n = n + 7',
        '#if n > 30',
        '#break',
        '#end if',
        '#loop',
        'c = 0',
        '#repeat 4',
        'c = c + 1',
        '#loop',
      ].join('\n'),
    );
    expect(r.errors).toBe(0);
    expect(r.blocks.filter((b) => b.kind === 'text').map((b) => (b as { text: string }).text)).toEqual(['middle']);
    expect(r.values.get('s')).toBe('55');
    expect(r.values.get('n')).toBe('35');
    expect(r.values.get('c')).toBe('4');
  });

  it('obeys #val, #noc, #round, #hide and #rad', () => {
    const r = run('a = 2\nb = 3\n#noc\nc = a*b\n#val\nd = a + b\n#equ\n#round 1\ne = 1/3\n#hide\nf = 5\n#show\n#rad\ng = sin(pi/2)\n#deg\nh = cos(60)');
    const t = maths(r).map((b) => b.tex);
    expect(t).toContain('c = a\\cdot b = 6');
    expect(t).toContain('d = 5');
    expect(t).toContain('e = \\frac{1}{3} = 0.3');
    expect(t.some((x) => x.startsWith('f'))).toBe(false);
    expect(r.values.get('f')).toBe('5');
    expect(r.values.get('g')).toBe('1');
    expect(r.values.get('h')).toBe('0.5');
  });

  it('reports errors by line and carries on', () => {
    const r = run('a = 1\nb = c + 1\nd = a + 1\n#if a\n#loop');
    const errors = errorsOf(r);
    expect(errors[0]).toMatchObject({ line: 2, message: 'c is not defined above this line' });
    expect(r.values.get('d')).toBe('2');
    expect(errors.at(-1)?.message).toMatch(/#loop without/);
    expect(errorsOf(run('#if 1\na = 1'))[0]).toMatchObject({ line: 1, message: '#if without #end if' });
    expect(errorsOf(run('#hide\n#while 1\nx = 1\n#loop'))[0]?.message).toMatch(/200,000 steps/);
    expect(errorsOf(run('#while 1\nx = 1\n#loop'))[0]?.message).toMatch(/longer than 4000 lines/);
    expect(errorsOf(run('#bogus'))[0]?.message).toBe('There is no #bogus');
  });

  it('warns when a variable hides a unit that is then used as one', () => {
    const r = run('m = 5 kg\na = 2 m/s^2');
    expect(maths(r)[1]?.warning).toMatch(/variable m, not the unit/);
  });

  it('makes input boxes and writes new values back into the source', () => {
    const source = "L = ?{6} m 'span\nw = ? kN\nx = L*2";
    const r = run(source);
    expect(r.blocks[0]).toMatchObject({ kind: 'input', label: 'L =', value: '6', unit: '\\mathrm{m}', note: 'span', line: 1 });
    expect(errorsOf(r)[0]).toMatchObject({ line: 2, message: 'Enter a value for w' });
    expect(r.values.get('x')).toBe('12 m');
    const changed = setInput(source, 2, '3.5}');
    expect(changed.split('\n')[1]).toBe('w = ?{3.5} kN');
    expect(setInput(changed, 1, '8').split('\n')[0]).toBe("L = ?{8} m 'span");
    expect(run(setInput(changed, 1, '8')).values.get('x')).toBe('16 m');
  });

  it('draws plots and maps', () => {
    const r = run('f(x) = x^2\n$Plot{f(x) & 2*x @ x = -1 : 2}\n$Map{x*y @ x = 0 : 1 & y = 0 : 1}');
    const plots = r.blocks.filter((b) => b.kind === 'plot') as { svg: string }[];
    expect(plots).toHaveLength(2);
    expect(plots[0]?.svg).toMatch(/^<svg[^>]+role="img"/);
    expect(plots[0]?.svg.match(/<path /g)).toHaveLength(2);
    expect(plots[1]?.svg).toContain('href="data:image/png;base64,iVBORw0KGgo');
    // A plot that cannot be drawn says why rather than showing empty axes.
    const failed = errorsOf(run('L = 6 m\nM(x) = x*(L - x)\n$Plot{M(x) @ x = 0 : 6}'));
    expect(failed[0]).toMatchObject({ line: 3 });
    expect(failed[0]?.message).toMatch(/^M\(x\) has no value anywhere from 0 to 6: .*give the range units/);
  });

  it('handles matrices in Calcpad notation', () => {
    const r = run('K = [4; -2 | -2; 4]\nu = [1; 2]\nK*u\ndet(K)');
    expect(r.errors).toBe(0);
    expect(maths(r)[0]?.tex).toBe('K = \\begin{bmatrix}4 & -2 \\\\ -2 & 4\\end{bmatrix}');
    expect(maths(r)[2]?.tex).toMatch(/= \\begin\{bmatrix\}0 \\\\ 6\\end\{bmatrix\}$/);
    expect(maths(r)[3]?.tex).toMatch(/= 12$/);
  });

  it('runs every example without errors, and MathJax reads every formula', () => {
    for (const example of CALCPAD_EXAMPLES) {
      const r = run(example.source);
      expect(r.errors, example.title).toBe(0);
      for (const b of r.blocks) {
        const tex = b.kind === 'math' ? b.tex : b.kind === 'input' ? `${b.label} ${b.unit}` : null;
        if (tex === null) continue;
        expect(texToSvg(`\\displaystyle ${tex}`, { display: false }).error, `${example.title}: ${tex}`).toBeNull();
      }
    }
  });
});
