import Papa from 'papaparse';
import { ToolError } from '../../lib/errors';
import { escapeXml } from '../../lib/text';
import { defineTextTool } from '../types';

const PALETTES: Record<string, string[]> = {
  github: ['#2f81f7', '#3fb950', '#d29922', '#db61a2', '#a371f7', '#39c5cf', '#f85149', '#8b949e'],
  okabe: ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00', '#f0e442', '#000000'],
  mono: ['#1f6feb', '#388bfd', '#58a6ff', '#79c0ff', '#a5d6ff', '#cae8ff', '#0d419d', '#0c2d6b'],
};

const nice = (max: number): number => {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const scaled = max / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
};

const format = (value: number): string => (Math.abs(value) >= 1e6 ? `${+(value / 1e6).toFixed(1)}M` : Math.abs(value) >= 1e4 ? `${+(value / 1e3).toFixed(1)}k` : String(+value.toFixed(2)));

export default defineTextTool({
  input: {
    label: 'Data (CSV)',
    placeholder: 'First column: labels. Other columns: one series each.',
    sample: 'Month,Visitors,School groups\nJan,12400,180\nFeb,13900,210\nMar,15800,260\nApr,11200,120\nMay,16900,90\nJun,14100,60',
  },
  output: { label: 'SVG', language: 'xml' },
  options: [
    {
      key: 'type',
      label: 'Chart',
      type: 'select',
      choices: [
        { value: 'bar', label: 'Bars' },
        { value: 'line', label: 'Lines' },
        { value: 'area', label: 'Area' },
        { value: 'pie', label: 'Pie' },
        { value: 'doughnut', label: 'Doughnut' },
        { value: 'scatter', label: 'Scatter' },
      ],
      default: 'bar',
    },
    { key: 'title', label: 'Title', type: 'text', default: 'Visitors by month' },
    {
      key: 'palette',
      label: 'Colours',
      type: 'select',
      choices: [
        { value: 'github', label: 'GitHub' },
        { value: 'okabe', label: 'Colour-blind safe (Okabe–Ito)' },
        { value: 'mono', label: 'Shades of blue' },
      ],
      default: 'github',
    },
    {
      key: 'theme',
      label: 'Background',
      type: 'segmented',
      choices: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'none', label: 'Transparent' },
      ],
      default: 'light',
    },
    { key: 'width', label: 'Width', type: 'number', default: 720, min: 200, max: 4000, step: 20, unit: 'px' },
    { key: 'height', label: 'Height', type: 'number', default: 400, min: 150, max: 3000, step: 20, unit: 'px' },
    { key: 'values', label: 'Show values', type: 'toggle', default: false },
  ],
  run(input, o) {
    if (input.trim() === '') return '';
    const parsed = Papa.parse<string[]>(input.trim(), { skipEmptyLines: true });
    const [header, ...rows] = parsed.data;
    if (!header || rows.length === 0) throw new ToolError('Enter a header row and at least one data row.');
    const labels = rows.map((row) => row[0] ?? '');
    const series = header.slice(1).map((name, column) => ({ name, values: rows.map((row) => Number((row[column + 1] ?? '').replace(/[,\s₹$€£%]/g, ''))) }));
    if (series.length === 0 || series.some((item) => item.values.some((value) => !Number.isFinite(value)))) throw new ToolError('Every column after the first must contain numbers.');
    const colors = PALETTES[o.palette] ?? (PALETTES.github as string[]);
    const dark = o.theme === 'dark';
    const ink = dark ? '#c9d1d9' : '#24292f';
    const faint = dark ? '#30363d' : '#d0d7de';
    const W = o.width;
    const H = o.height;
    const font = 'font-family="system-ui, sans-serif"';
    const parts: string[] = [];
    if (o.theme !== 'none') parts.push(`<rect width="${W}" height="${H}" fill="${dark ? '#0d1117' : '#ffffff'}"/>`);
    const top = o.title ? 44 : 16;
    if (o.title) parts.push(`<text x="${W / 2}" y="28" text-anchor="middle" ${font} font-size="17" font-weight="600" fill="${ink}">${escapeXml(o.title)}</text>`);
    const legend = series.length > 1 || o.type === 'pie' || o.type === 'doughnut';
    const legendItems = o.type === 'pie' || o.type === 'doughnut' ? labels : series.map((item) => item.name);
    const legendHeight = legend ? 26 : 0;
    if (legend) {
      let x = 16;
      legendItems.forEach((name, index) => {
        parts.push(
          `<rect x="${x}" y="${H - 20}" width="11" height="11" rx="2" fill="${colors[index % colors.length]}"/><text x="${x + 16}" y="${H - 10}" ${font} font-size="12" fill="${ink}">${escapeXml(name)}</text>`,
        );
        x += 28 + name.length * 7;
      });
    }
    if (o.type === 'pie' || o.type === 'doughnut') {
      const values = (series[0] as (typeof series)[number]).values;
      const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
      if (total <= 0) throw new ToolError('A pie chart needs positive values.');
      const cx = W / 2;
      const cy = top + (H - top - legendHeight) / 2;
      const r = Math.min(W, H - top - legendHeight) / 2 - 12;
      let angle = -Math.PI / 2;
      values.forEach((value, index) => {
        const sweep = (Math.max(0, value) / total) * Math.PI * 2;
        const [x1, y1, x2, y2] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle), cx + r * Math.cos(angle + sweep), cy + r * Math.sin(angle + sweep)];
        parts.push(
          sweep >= Math.PI * 2 - 1e-9
            ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colors[0]}"/>`
            : `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${colors[index % colors.length]}" stroke="${dark ? '#0d1117' : '#ffffff'}" stroke-width="2"/>`,
        );
        if (o.values || sweep > 0.35) {
          const mid = angle + sweep / 2;
          parts.push(
            `<text x="${(cx + r * 0.68 * Math.cos(mid)).toFixed(1)}" y="${(cy + r * 0.68 * Math.sin(mid) + 4).toFixed(1)}" text-anchor="middle" ${font} font-size="12" fill="#ffffff">${Math.round((value / total) * 100)}%</text>`,
          );
        }
        angle += sweep;
      });
      if (o.type === 'doughnut')
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="${(r * 0.55).toFixed(1)}" fill="${o.theme === 'none' ? '#ffffff' : dark ? '#0d1117' : '#ffffff'}"/><text x="${cx}" y="${cy + 6}" text-anchor="middle" ${font} font-size="18" font-weight="600" fill="${ink}">${format(total)}</text>`,
        );
    } else {
      const left = 56;
      const right = 16;
      const bottom = 32 + legendHeight;
      const plotW = W - left - right;
      const plotH = H - top - bottom;
      const all = series.flatMap((item) => item.values);
      const max = nice(Math.max(0, ...all));
      const min = Math.min(0, ...all) < 0 ? -nice(-Math.min(...all)) : 0;
      const y = (value: number) => top + plotH - ((value - min) / (max - min)) * plotH;
      for (let tick = 0; tick <= 5; tick++) {
        const value = min + ((max - min) * tick) / 5;
        parts.push(
          `<line x1="${left}" x2="${W - right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" stroke="${faint}"/><text x="${left - 8}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end" ${font} font-size="11" fill="${ink}">${format(value)}</text>`,
        );
      }
      const step = plotW / labels.length;
      for (const [index, label] of labels.entries()) {
        parts.push(`<text x="${(left + step * (index + 0.5)).toFixed(1)}" y="${top + plotH + 18}" text-anchor="middle" ${font} font-size="11" fill="${ink}">${escapeXml(label)}</text>`);
      }
      series.forEach((item, s) => {
        const color = colors[s % colors.length];
        if (o.type === 'bar') {
          const group = step * 0.75;
          const width = group / series.length;
          item.values.forEach((value, index) => {
            const x = left + step * index + (step - group) / 2 + width * s;
            const [y0, y1] = [y(Math.max(0, value)), y(Math.min(0, value))];
            parts.push(`<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${Math.max(1, width - 2).toFixed(1)}" height="${Math.max(0, y1 - y0).toFixed(1)}" rx="2" fill="${color}"/>`);
            if (o.values) parts.push(`<text x="${(x + width / 2).toFixed(1)}" y="${(y0 - 4).toFixed(1)}" text-anchor="middle" ${font} font-size="10" fill="${ink}">${format(value)}</text>`);
          });
        } else {
          const points = item.values.map((value, index) => [left + step * (index + 0.5), y(value)] as const);
          if (o.type === 'area')
            parts.push(
              `<path d="M${points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' L')} L${(points[points.length - 1]?.[0] ?? 0).toFixed(1)},${y(Math.max(min, 0)).toFixed(1)} L${(points[0]?.[0] ?? 0).toFixed(1)},${y(Math.max(min, 0)).toFixed(1)} Z" fill="${color}" fill-opacity="0.25"/>`,
            );
          if (o.type !== 'scatter')
            parts.push(`<polyline points="${points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`);
          for (const [index, [px, py]] of points.entries()) {
            parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${o.type === 'scatter' ? 5 : 3.5}" fill="${color}"/>`);
            if (o.values) parts.push(`<text x="${px.toFixed(1)}" y="${(py - 9).toFixed(1)}" text-anchor="middle" ${font} font-size="10" fill="${ink}">${format(item.values[index] ?? 0)}</text>`);
          }
        }
      });
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
    return { output: svg, preview: { kind: 'svg', svg, checker: o.theme === 'none' }, filename: 'chart.svg', info: `${series.length} series, ${labels.length} points` };
  },
});
