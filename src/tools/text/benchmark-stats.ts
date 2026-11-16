import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

export interface Stats {
  readonly n: number;
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly sd: number;
  readonly p95: number;
}

export function stats(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const quantile = (q: number) => {
    const position = (n - 1) * q;
    const low = Math.floor(position);
    return (sorted[low] as number) + ((sorted[Math.min(n - 1, low + 1)] as number) - (sorted[low] as number)) * (position - low);
  };
  const sd = n > 1 ? Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, median: quantile(0.5), min: sorted[0] as number, max: sorted[n - 1] as number, sd, p95: quantile(0.95) };
}

const num = (value: number) => Number(value.toPrecision(5)).toString();

export default defineTextTool({
  input: {
    label: 'Measurements',
    placeholder: 'One suite per line: name: 12.1, 11.8, 12.4 …',
    sample: 'array.map: 12.1, 11.8, 12.4, 12.0, 13.9\nfor loop: 8.2, 8.0, 8.4, 7.9, 8.1\nforEach: 10.4, 10.9, 10.2, 11.1, 10.5',
  },
  output: { label: 'Markdown table', language: 'markdown' },
  options: [{ key: 'unit', label: 'Unit', type: 'text', default: 'ms' }],
  run(input, o) {
    const suites = input
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line, index) => {
        const colon = line.indexOf(':');
        const name = colon > 0 ? line.slice(0, colon).trim() : `Suite ${index + 1}`;
        const values = (colon > 0 ? line.slice(colon + 1) : line)
          .split(/[\s,;]+/)
          .filter(Boolean)
          .map(Number);
        if (values.length === 0 || values.some((value) => !Number.isFinite(value))) throw new ToolError(`Line ${index + 1} needs numbers separated by commas or spaces.`, { line: index + 1 });
        return { name, ...stats(values) };
      });
    if (suites.length === 0) return '';
    const best = Math.min(...suites.map((suite) => suite.mean));
    const rows = [...suites].sort((a, b) => a.mean - b.mean);
    const header = `| Suite | Mean (${o.unit}) | Median | ± SD | Min | Max | p95 | Runs | vs fastest |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|`;
    const body = rows.map(
      (suite) =>
        `| ${suite.name} | ${num(suite.mean)} | ${num(suite.median)} | ${num(suite.sd)} (${((suite.sd / suite.mean) * 100).toFixed(1)}%) | ${num(suite.min)} | ${num(suite.max)} | ${num(suite.p95)} | ${suite.n} | ${suite.mean === best ? 'fastest' : `×${(suite.mean / best).toFixed(2)}`} |`,
    );
    const fields: Field[] = rows.map((suite) => ({
      label: suite.name,
      value: `${num(suite.mean)} ${o.unit} ± ${num(suite.sd)}${suite.mean === best ? ' (fastest)' : `, ${(suite.mean / best).toFixed(2)}× slower`}`,
      mono: true,
      tone: suite.mean === best ? 'ok' : undefined,
    }));
    return { output: `${header}\n${body.join('\n')}\n`, fields };
  },
});
