import Papa from 'papaparse';
import { ToolError } from '../../lib/errors';
import { describe, linearRegression, oneWayAnova, pairedTTest, pearson, significance, spearman, welchTTest } from '../../lib/statistics';
import { chartSvg, histogram } from '../../lib/svg-chart';
import { defineTextTool, type Field } from '../types';

const SAMPLE = `gallery,visit_minutes,age,exhibits_seen
Engine Hall,34,12,9
Engine Hall,41,15,11
Engine Hall,28,9,7
Engine Hall,52,41,14
Space Gallery,47,13,12
Space Gallery,63,16,15
Space Gallery,55,38,13
Space Gallery,71,44,17
Electrotechnic,25,11,6
Electrotechnic,38,35,9
Electrotechnic,31,14,8
Electrotechnic,44,47,10`;

const n = (x: number, d = 4) => (Number.isFinite(x) ? String(Number(x.toPrecision(d))) : '—');

export default defineTextTool({
  input: { label: 'CSV with a header row', language: 'text', sample: SAMPLE, accept: '.csv,.tsv,.txt' },
  output: { label: 'Report' },
  options: [
    {
      key: 'analysis',
      label: 'Analysis',
      type: 'select',
      choices: [
        { value: 'describe', label: 'Describe every number column' },
        { value: 'correlation', label: 'Correlation between all number columns' },
        { value: 'regression', label: 'Linear regression of Y on X' },
        { value: 'ttest', label: 'Compare two groups (Welch t-test)' },
        { value: 'paired', label: 'Paired t-test (X before, Y after)' },
        { value: 'anova', label: 'Compare several groups (one-way ANOVA)' },
      ],
      default: 'describe',
    },
    {
      key: 'x',
      label: 'X column',
      type: 'text',
      default: '',
      mono: true,
      help: 'Name or number of the column; empty uses the first number column.',
      showIf: (v) => v.analysis !== 'describe' && v.analysis !== 'correlation',
    },
    { key: 'y', label: 'Y column', type: 'text', default: '', mono: true, showIf: (v) => v.analysis === 'regression' || v.analysis === 'paired' },
    { key: 'group', label: 'Group column', type: 'text', default: '', mono: true, help: 'Empty uses the first text column.', showIf: (v) => v.analysis === 'ttest' || v.analysis === 'anova' },
  ],
  run(input, o) {
    if (!input.trim()) return { output: '' };
    const parsed = Papa.parse<string[]>(input.trim(), { skipEmptyLines: 'greedy' });
    const [header, ...rows] = parsed.data;
    if (!header?.length || !rows.length) throw new ToolError('Paste a CSV with a header row and at least one row of data.');
    const width = header.length;
    const column = (i: number) =>
      rows.map((r) => {
        const t = (r[i] ?? '').trim().replace(/,(?=\d{3}\b)/g, '');
        const v = t === '' ? Number.NaN : Number(t);
        return Number.isFinite(v) ? v : null;
      });
    const numeric = header.map((_, i) => column(i).filter((v) => v !== null).length >= Math.max(1, rows.filter((r) => (r[i] ?? '').trim() !== '').length * 0.8));
    const pick = (name: string, fallback: (i: number) => boolean, what: string): number => {
      const t = name.trim();
      if (t) {
        const byName = header.findIndex((h) => h.trim().toLowerCase() === t.toLowerCase());
        if (byName >= 0) return byName;
        const byNumber = Number(t) - 1;
        if (Number.isInteger(byNumber) && byNumber >= 0 && byNumber < width) return byNumber;
        throw new ToolError(`There is no column "${t}". Columns: ${header.join(', ')}.`);
      }
      const found = header.findIndex((_, i) => fallback(i));
      if (found < 0) throw new ToolError(`No ${what} column was found.`);
      return found;
    };
    const numberCols = header.map((h, i) => ({ h, i })).filter(({ i }) => numeric[i]);
    const fields: Field[] = [];
    let report = '';
    let svg: string | undefined;

    if (o.analysis === 'describe') {
      const lines: string[] = [];
      for (const { h, i } of numberCols) {
        const d = describe(column(i));
        lines.push(
          `${h}\n  n ${d.n}${d.missing ? ` (${d.missing} missing)` : ''}   mean ${n(d.mean)}   median ${n(d.median)}   sd ${n(d.sd)}   se ${n(d.se)}`,
          `  min ${n(d.min)}   Q1 ${n(d.q1)}   Q3 ${n(d.q3)}   max ${n(d.max)}   IQR ${n(d.iqr)}   sum ${n(d.sum, 8)}`,
          `  skewness ${n(d.skewness)}   excess kurtosis ${n(d.kurtosis)}   CV ${n(d.cv * 100)}%${
            d.modes.length
              ? `   mode ${d.modes
                  .slice(0, 5)
                  .map((m) => n(m))
                  .join(', ')}`
              : ''
          }`,
        );
      }
      if (!lines.length) throw new ToolError('No column holds numbers.');
      report = lines.join('\n\n');
      const first = numberCols[0];
      if (first) {
        const values = column(first.i).filter((v): v is number => v !== null);
        const d = describe(values);
        fields.push(
          { label: `${first.h}: mean`, value: n(d.mean), mono: true },
          { label: `${first.h}: sd`, value: n(d.sd), mono: true },
          { label: `${first.h}: median`, value: n(d.median), mono: true },
        );
        const h = histogram(values);
        svg = chartSvg(
          h.counts.map((_, k) => `${n(h.edges[k] as number, 3)}–${n(h.edges[k + 1] as number, 3)}`),
          [{ name: 'count', values: h.counts }],
          { kind: 'bar', title: `Distribution of ${first.h}`, yLabel: 'count' },
        );
      }
    } else if (o.analysis === 'correlation') {
      if (numberCols.length < 2) throw new ToolError('Correlation needs at least two number columns.');
      const pad = Math.max(...numberCols.map((c) => c.h.length), 6);
      const lines = [`${''.padEnd(pad)}  ${numberCols.map((c) => c.h.slice(0, 10).padStart(10)).join(' ')}`];
      for (const a of numberCols) lines.push(`${a.h.padEnd(pad)}  ${numberCols.map((b) => n(pearson(column(a.i), column(b.i)).r, 3).padStart(10)).join(' ')}`);
      const pairsText: string[] = [];
      for (let p = 0; p < numberCols.length; p++)
        for (let q = p + 1; q < numberCols.length; q++) {
          const a = numberCols[p] as { h: string; i: number };
          const b = numberCols[q] as { h: string; i: number };
          const r = pearson(column(a.i), column(b.i));
          const s = spearman(column(a.i), column(b.i));
          pairsText.push(`${a.h} ~ ${b.h}: Pearson r ${n(r.r, 3)} (${significance(r.p)}), Spearman ρ ${n(s.rho, 3)}, n ${r.n}`);
        }
      report = `Pearson correlation matrix\n\n${lines.join('\n')}\n\n${pairsText.join('\n')}`;
    } else if (o.analysis === 'regression') {
      const xi = pick(o.x, (i) => numeric[i] === true, 'number');
      const yi = pick(o.y, (i) => numeric[i] === true && i !== xi, 'second number');
      const r = linearRegression(column(xi), column(yi));
      report = [
        `${header[yi]} = ${n(r.intercept, 6)} + ${n(r.slope, 6)} × ${header[xi]}`,
        '',
        `slope ${n(r.slope, 6)} (standard error ${n(r.slopeSe)}, t ${n(r.t)}, ${significance(r.p)})`,
        `intercept ${n(r.intercept, 6)} (standard error ${n(r.interceptSe)})`,
        `R² ${n(r.r2)}   residual standard error ${n(r.residualSe)}   n ${r.n}`,
      ].join('\n');
      fields.push(
        { label: 'Slope', value: n(r.slope, 6), mono: true },
        { label: 'Intercept', value: n(r.intercept, 6), mono: true },
        { label: 'R²', value: n(r.r2), mono: true },
        { label: 'p (slope)', value: n(r.p, 3), mono: true },
      );
      const xs = column(xi);
      const ys = column(yi);
      const keep = xs.map((x, k) => x !== null && ys[k] !== null);
      svg = chartSvg(
        xs.filter((_, k) => keep[k]).map(String),
        [
          { name: header[yi] ?? 'y', values: ys.filter((_, k) => keep[k]) },
          { name: 'fitted line', values: xs.filter((_, k) => keep[k]).map((x) => r.intercept + r.slope * (x as number)) },
        ],
        { kind: 'scatter', title: `${header[yi]} against ${header[xi]}`, xLabel: header[xi], yLabel: header[yi] },
      );
    } else if (o.analysis === 'paired') {
      const xi = pick(o.x, (i) => numeric[i] === true, 'number');
      const yi = pick(o.y, (i) => numeric[i] === true && i !== xi, 'second number');
      const t = pairedTTest(column(xi), column(yi));
      report = `Paired t-test: ${header[xi]} − ${header[yi]}\n\nmean difference ${n(t.difference)} (95% interval ${n(t.low)} to ${n(t.high)})\nt ${n(t.t)}, ${n(t.df, 3)} degrees of freedom, ${significance(t.p)}`;
      fields.push({ label: 'Mean difference', value: n(t.difference), mono: true }, { label: 't', value: n(t.t), mono: true }, { label: 'p', value: n(t.p, 3), mono: true });
    } else {
      const gi = pick(o.group, (i) => numeric[i] === false, 'text');
      const vi = pick(o.x, (i) => numeric[i] === true && i !== gi, 'number');
      const groups = new Map<string, number[]>();
      rows.forEach((r) => {
        const g = (r[gi] ?? '').trim();
        const v = column(vi)[rows.indexOf(r)];
        if (g && v !== null && v !== undefined) groups.set(g, [...(groups.get(g) ?? []), v]);
      });
      if (o.analysis === 'ttest') {
        if (groups.size !== 2) throw new ToolError(`A t-test compares two groups; ${header[gi]} has ${groups.size}. Use one-way ANOVA for more.`);
        const [[a, av], [b, bv]] = [...groups] as [[string, number[]], [string, number[]]];
        const t = welchTTest(av, bv);
        report = `Welch's t-test: ${header[vi]} in ${a} vs ${b}\n\n${a}: mean ${n(describe(av).mean)}, n ${av.length}\n${b}: mean ${n(describe(bv).mean)}, n ${bv.length}\n\ndifference ${n(t.difference)} (95% interval ${n(t.low)} to ${n(t.high)})\nt ${n(t.t)}, ${n(t.df, 3)} degrees of freedom, ${significance(t.p)}`;
        fields.push({ label: 'Difference', value: n(t.difference), mono: true }, { label: 't', value: n(t.t), mono: true }, { label: 'p', value: n(t.p, 3), mono: true });
      } else {
        if (groups.size < 2) throw new ToolError(`ANOVA needs at least two groups in ${header[gi]}.`);
        const r = oneWayAnova(groups);
        report = `One-way ANOVA: ${header[vi]} by ${header[gi]}\n\n${r.groups.map((g) => `${g.name}: mean ${n(g.mean)}, sd ${n(g.sd)}, n ${g.n}`).join('\n')}\n\nF(${r.dfBetween}, ${r.dfWithin}) = ${n(r.f)}, ${significance(r.p)}\nη² ${n(r.etaSquared, 3)} (share of the variation explained by ${header[gi]})`;
        fields.push({ label: 'F', value: n(r.f), mono: true }, { label: 'p', value: n(r.p, 3), mono: true }, { label: 'η²', value: n(r.etaSquared, 3), mono: true });
      }
      svg = chartSvg([...groups.keys()], [{ name: `mean ${header[vi]}`, values: [...groups.values()].map((v) => describe(v).mean) }], {
        kind: 'bar',
        title: `Mean ${header[vi]} by ${header[gi]}`,
        yLabel: header[vi],
      });
    }
    return { output: `${report}\n`, fields, preview: svg ? { kind: 'svg', svg } : undefined, info: `${rows.length} rows, ${width} columns; ${numberCols.length} hold numbers.` };
  },
});
