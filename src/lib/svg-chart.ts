/**
 * Small, dependency-free SVG charts for query results and statistics: bar,
 * line, scatter, pie and histogram, with "nice" axis ticks and a legend.
 * Colours default to the Okabe–Ito palette, which stays distinct for the
 * common kinds of colour blindness.
 */
import { escapeXml } from './text';

export type ChartKind = 'bar' | 'line' | 'scatter' | 'pie';

export interface Series {
  readonly name: string;
  readonly values: readonly (number | null)[];
}

export interface ChartOptions {
  readonly kind: ChartKind;
  readonly title?: string;
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly width?: number;
  readonly height?: number;
  readonly colors?: readonly string[];
  readonly dark?: boolean;
}

export const CHART_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#000000'];

/** Round a span to 1, 2 or 5 × a power of ten, for axis steps. */
export function niceStep(span: number, ticks = 5): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const f = raw / power;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * power;
}

/** Axis bounds and tick values covering [min, max], including zero for bars. */
export function niceScale(min: number, max: number, includeZero: boolean): { lo: number; hi: number; ticks: number[] } {
  let lo = includeZero ? Math.min(0, min) : min;
  let hi = includeZero ? Math.max(0, max) : max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (lo === hi) {
    lo -= lo === 0 ? 1 : Math.abs(lo) * 0.1;
    hi += hi === 0 ? 1 : Math.abs(hi) * 0.1;
  }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { lo, hi, ticks };
}

export const formatTick = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}k`;
  return String(+v.toPrecision(6));
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function chartSvg(labels: readonly string[], series: readonly Series[], o: ChartOptions): string {
  const width = o.width ?? 760;
  const height = o.height ?? 420;
  const colors = o.colors?.length ? o.colors : CHART_COLORS;
  const ink = o.dark ? '#e6edf3' : '#1f2328';
  const muted = o.dark ? '#8b949e' : '#59636e';
  const grid = o.dark ? '#30363d' : '#d1d9e0';
  const bg = o.dark ? '#0d1117' : '#ffffff';
  const font = "font-family='system-ui, sans-serif'";
  const parts: string[] = [`<rect width='${width}' height='${height}' fill='${bg}'/>`];
  const titleH = o.title ? 34 : 12;
  if (o.title) parts.push(`<text x='${width / 2}' y='24' text-anchor='middle' ${font} font-size='16' font-weight='600' fill='${ink}'>${escapeXml(o.title)}</text>`);
  const legendNeeded = o.kind === 'pie' ? labels.length > 0 : series.length > 1;

  if (o.kind === 'pie') {
    const values = (series[0]?.values ?? []).map((v) => (v !== null && v > 0 ? v : 0));
    const total = values.reduce((s, v) => s + v, 0);
    const r = Math.min(width * 0.55, height - titleH - 24) / 2;
    const cx = r + 24;
    const cy = titleH + (height - titleH) / 2;
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      if (!total || !v) return;
      const sweep = (v / total) * Math.PI * 2;
      const end = angle + sweep;
      const color = colors[i % colors.length] as string;
      if (sweep >= Math.PI * 2 - 1e-9) parts.push(`<circle cx='${cx}' cy='${cy}' r='${r}' fill='${color}'/>`);
      else {
        const large = sweep > Math.PI ? 1 : 0;
        const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
        parts.push(
          `<path d='M${cx} ${cy}L${p(angle)}A${r} ${r} 0 ${large} 1 ${p(end)}Z' fill='${color}' stroke='${bg}' stroke-width='1.5'><title>${escapeXml(`${labels[i] ?? ''}: ${formatTick(v)} (${((v / total) * 100).toFixed(1)}%)`)}</title></path>`,
        );
      }
      angle = end;
    });
    const lx = cx + r + 32;
    labels.slice(0, 16).forEach((label, i) => {
      const y = titleH + 16 + i * 22;
      const share = total ? ` (${(((values[i] ?? 0) / total) * 100).toFixed(1)}%)` : '';
      parts.push(
        `<rect x='${lx}' y='${y - 10}' width='12' height='12' rx='2' fill='${colors[i % colors.length]}'/>`,
        `<text x='${lx + 18}' y='${y}' ${font} font-size='12.5' fill='${ink}'>${escapeXml(clip(label, 34) + share)}</text>`,
      );
    });
    return wrap(width, height, parts);
  }

  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const numericX = o.kind === 'scatter' ? labels.map(Number) : [];
  const scale = niceScale(Math.min(...all), Math.max(...all), o.kind === 'bar');
  const left = 64;
  const right = legendNeeded ? 150 : 20;
  const bottom = 58 + (o.xLabel ? 16 : 0);
  const top = titleH + 8;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const y = (v: number) => top + plotH - ((v - scale.lo) / (scale.hi - scale.lo)) * plotH;
  for (const t of scale.ticks) {
    parts.push(
      `<line x1='${left}' x2='${left + plotW}' y1='${y(t).toFixed(1)}' y2='${y(t).toFixed(1)}' stroke='${grid}' stroke-width='1'/>`,
      `<text x='${left - 8}' y='${(y(t) + 4).toFixed(1)}' text-anchor='end' ${font} font-size='11.5' fill='${muted}'>${formatTick(t)}</text>`,
    );
  }
  if (o.yLabel) parts.push(`<text transform='translate(16 ${top + plotH / 2}) rotate(-90)' text-anchor='middle' ${font} font-size='12' fill='${muted}'>${escapeXml(o.yLabel)}</text>`);
  if (o.xLabel) parts.push(`<text x='${left + plotW / 2}' y='${height - 10}' text-anchor='middle' ${font} font-size='12' fill='${muted}'>${escapeXml(o.xLabel)}</text>`);

  if (o.kind === 'scatter') {
    const xs = numericX.filter(Number.isFinite);
    const xScale = niceScale(Math.min(...xs), Math.max(...xs), false);
    const x = (v: number) => left + ((v - xScale.lo) / (xScale.hi - xScale.lo)) * plotW;
    for (const t of xScale.ticks) parts.push(`<text x='${x(t).toFixed(1)}' y='${top + plotH + 18}' text-anchor='middle' ${font} font-size='11.5' fill='${muted}'>${formatTick(t)}</text>`);
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const xv = numericX[i];
        if (v === null || xv === undefined || !Number.isFinite(xv) || !Number.isFinite(v)) return;
        parts.push(
          `<circle cx='${x(xv).toFixed(1)}' cy='${y(v).toFixed(1)}' r='3.5' fill='${colors[si % colors.length]}' fill-opacity='0.8'><title>${escapeXml(`${s.name}: (${formatTick(xv)}, ${formatTick(v)})`)}</title></circle>`,
        );
      });
    });
  } else {
    const n = Math.max(1, labels.length);
    const band = plotW / n;
    const every = Math.max(1, Math.ceil(n / Math.floor(plotW / 64)));
    labels.forEach((label, i) => {
      if (i % every) return;
      const cx = left + band * (i + 0.5);
      parts.push(
        `<text x='${cx.toFixed(1)}' y='${top + plotH + 18}' text-anchor='middle' ${font} font-size='11.5' fill='${muted}'>${escapeXml(clip(label, Math.max(4, Math.floor((band * every) / 7))))}</text>`,
      );
    });
    if (o.kind === 'bar') {
      const inner = band * 0.78;
      const w = inner / Math.max(1, series.length);
      series.forEach((s, si) => {
        s.values.forEach((v, i) => {
          if (v === null || !Number.isFinite(v)) return;
          const x0 = left + band * i + (band - inner) / 2 + w * si;
          const y0 = y(Math.max(0, v));
          const h = Math.abs(y(v) - y(0));
          parts.push(
            `<rect x='${x0.toFixed(1)}' y='${y0.toFixed(1)}' width='${Math.max(1, w - 1).toFixed(1)}' height='${Math.max(0.5, h).toFixed(1)}' fill='${colors[si % colors.length]}'><title>${escapeXml(`${labels[i] ?? ''} · ${s.name}: ${formatTick(v)}`)}</title></rect>`,
          );
        });
      });
    } else {
      series.forEach((s, si) => {
        let d = '';
        s.values.forEach((v, i) => {
          if (v === null || !Number.isFinite(v)) return;
          d += `${d ? 'L' : 'M'}${(left + band * (i + 0.5)).toFixed(1)} ${y(v).toFixed(1)}`;
        });
        parts.push(`<path d='${d}' fill='none' stroke='${colors[si % colors.length]}' stroke-width='2.2' stroke-linejoin='round'/>`);
        if (n <= 60)
          s.values.forEach((v, i) => {
            if (v !== null && Number.isFinite(v))
              parts.push(
                `<circle cx='${(left + band * (i + 0.5)).toFixed(1)}' cy='${y(v).toFixed(1)}' r='2.6' fill='${colors[si % colors.length]}'><title>${escapeXml(`${labels[i] ?? ''} · ${s.name}: ${formatTick(v)}`)}</title></circle>`,
              );
          });
      });
    }
  }
  parts.push(
    `<line x1='${left}' x2='${left}' y1='${top}' y2='${top + plotH}' stroke='${muted}'/>`,
    `<line x1='${left}' x2='${left + plotW}' y1='${y(Math.max(scale.lo, 0)).toFixed(1)}' y2='${y(Math.max(scale.lo, 0)).toFixed(1)}' stroke='${muted}'/>`,
  );
  if (legendNeeded) {
    const lx = left + plotW + 18;
    series.slice(0, 12).forEach((s, i) => {
      const ly = top + 12 + i * 22;
      parts.push(
        `<rect x='${lx}' y='${ly - 10}' width='12' height='12' rx='2' fill='${colors[i % colors.length]}'/>`,
        `<text x='${lx + 18}' y='${ly}' ${font} font-size='12.5' fill='${ink}'>${escapeXml(clip(s.name, 16))}</text>`,
      );
    });
  }
  return wrap(width, height, parts);
}

const wrap = (width: number, height: number, parts: string[]) => `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>${parts.join('')}</svg>`;

/** Equal-width bins for a histogram (Freedman–Diaconis width, between 5 and 60 bins). */
export function histogram(values: readonly number[], bins?: number): { edges: number[]; counts: number[] } {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return { edges: [], counts: [] };
  const min = v[0] as number;
  const max = v[v.length - 1] as number;
  if (min === max) return { edges: [min, max], counts: [v.length] };
  let n = bins;
  if (!n) {
    const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))] as number;
    const iqr = q(0.75) - q(0.25);
    const width = iqr > 0 ? (2 * iqr) / Math.cbrt(v.length) : (max - min) / Math.sqrt(v.length);
    n = Math.round((max - min) / width);
  }
  n = Math.max(5, Math.min(60, n || 10));
  const step = (max - min) / n;
  const edges = Array.from({ length: n + 1 }, (_, i) => min + step * i);
  const counts = new Array<number>(n).fill(0);
  for (const x of v) counts[Math.min(n - 1, Math.floor((x - min) / step))]++;
  return { edges, counts };
}
