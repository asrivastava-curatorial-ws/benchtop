/**
 * CyberChef's four charts (Scatter, Series, Heatmap, Hex Density), drawn as
 * SVG here instead of with D3: the same arguments, data rules, bins, scales,
 * axis ticks (D3's tick algorithm and number format) and tooltips.  The
 * output is the SVG markup; the preview shows the picture.
 */
import { converter, interpolate, parse } from 'culori';
import { bArg, bool, defineOp, nArg, num, OpError, type Operation, type OpResult, sArg, sel, str } from '../core';

const C = 'Multimedia' as const;
const RECORD = ['Line feed', 'CRLF'];
const FIELD = ['Space', 'Comma', 'Semi-colon', 'Colon', 'Tab'];
const CHARS: Record<string, string> = { 'Line feed': '\n', CRLF: '\r\n', Space: ' ', Comma: ',', 'Semi-colon': ';', Colon: ':', Tab: '\t' };

export const esc = (text: unknown): string => String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);

/* ---------------------------------------------------------------- data --- */

function rows(input: string, a: Record<string, unknown>, length: number, headings: boolean): { headings?: string[]; values: string[][] } {
  const record = CHARS[String(a.record)] ?? '\n';
  const field = CHARS[String(a.field)] ?? ' ';
  let head: string[] | undefined;
  const values: string[][] = [];
  input.split(record).forEach((row, index) => {
    // A trailing line break leaves an empty row, which CyberChef rejects; it is skipped here.
    if (row === '' && index > 0) return;
    const cells = row.split(field);
    if (cells.length !== length) throw new OpError(`Each row must have length ${length}.`);
    if (headings && index === 0) head = cells;
    else values.push(cells);
  });
  if (values.length === 0) throw new OpError('There are no values to plot.');
  return { headings: head, values };
}

function numbers(cells: string[]): [number, number] {
  const x = Number.parseFloat(cells[0] as string);
  const y = Number.parseFloat(cells[1] as string);
  if (Number.isNaN(x) || Number.isNaN(y)) throw new OpError('Values must be numbers in base 10.');
  return [x, y];
}

const extent = (list: number[]): [number, number] => [Math.min(...list), Math.max(...list)];

/* ------------------------------------------------------- scales & ticks --- */
// D3's linear scale, tick algorithm (d3-array ticks) and default tick format (",.Nf").

const E10 = Math.sqrt(50);
const E5 = Math.sqrt(10);
const E2 = Math.sqrt(2);

function tickSpec(start: number, stop: number, count: number): [number, number, number] {
  const step = (stop - start) / Math.max(0, count);
  const power = Math.floor(Math.log10(step));
  const error = step / 10 ** power;
  const factor = error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1;
  let i1: number;
  let i2: number;
  let inc: number;
  if (power < 0) {
    inc = 10 ** -power / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = 10 ** power * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && 0.5 <= count && count < 2) return tickSpec(start, stop, count * 2);
  return [i1, i2, inc];
}

export function ticks(start: number, stop: number, count = 10): number[] {
  if (!(count > 0)) return [];
  if (start === stop) return [start];
  const reverse = stop < start;
  const [i1, i2, inc] = reverse ? tickSpec(stop, start, count) : tickSpec(start, stop, count);
  if (!(i2 >= i1)) return [];
  const n = i2 - i1 + 1;
  const out: number[] = [];
  for (let i = 0; i < n; ++i) {
    const k = reverse ? i2 - i : i1 + i;
    out.push(inc < 0 ? k / -inc : k * inc);
  }
  return out;
}

function tickStep(start: number, stop: number, count: number): number {
  const reverse = stop < start;
  const inc = reverse ? tickSpec(stop, start, count)[2] : tickSpec(start, stop, count)[2];
  return (reverse ? -1 : 1) * (inc < 0 ? 1 / -inc : inc);
}

/** D3's default tick label: fixed decimals for the step, thousands commas, a true minus sign. */
export function tickFormat(start: number, stop: number, count = 10): (value: number) => string {
  const step = Math.abs(tickStep(start, stop, count));
  const precision = step > 0 && Number.isFinite(step) ? Math.max(0, -Math.floor(Math.log10(step) + 1e-12)) : 0;
  return (value: number) => {
    const negative = value < 0 && Number(value.toFixed(precision)) !== 0;
    const [whole = '0', fraction] = Math.abs(value).toFixed(precision).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${negative ? '−' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
  };
}

interface Scale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
}

function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const scale = ((value: number) => r0 + (span ? (value - d0) / span : 0.5) * (r1 - r0)) as Scale;
  scale.domain = domain;
  scale.range = range;
  return scale;
}

const round = (n: number): string => String(Math.round(n * 1000) / 1000);

/** D3's axis markup (left, bottom or top), with outer ticks of the given size. */
function axis(orient: 'left' | 'bottom' | 'top', scale: Scale | { positions: [string, number][]; range: [number, number] }, outer = 6, count = 10): string {
  const vertical = orient === 'left';
  const k = orient === 'left' || orient === 'top' ? -1 : 1;
  const offset = 0.5;
  let items: [string, number][];
  let range: [number, number];
  if ('positions' in scale) {
    items = scale.positions;
    range = scale.range;
  } else {
    const [d0, d1] = scale.domain;
    const format = tickFormat(d0, d1, count);
    items = ticks(d0, d1, count).map((t) => [format(t), scale(t)]);
    range = scale.range;
  }
  const r0 = range[0] + offset;
  const r1 = range[1] + offset;
  const domain = vertical
    ? outer
      ? `M${round(k * outer)},${r0}H${offset}V${r1}H${round(k * outer)}`
      : `M${offset},${r0}V${r1}`
    : outer
      ? `M${r0},${round(k * outer)}V${offset}H${r1}V${round(k * outer)}`
      : `M${r0},${offset}H${r1}`;
  const tick = ([label, at]: [string, number]) => {
    const pos = round(at + offset);
    if (vertical) return `<g class="tick" opacity="1" transform="translate(0,${pos})"><line stroke="currentColor" x2="-6"></line><text fill="currentColor" x="-9" dy="0.32em">${esc(label)}</text></g>`;
    return `<g class="tick" opacity="1" transform="translate(${pos},0)"><line stroke="currentColor" y2="${k * 6}"></line><text fill="currentColor" y="${k * 9}" dy="${orient === 'top' ? '0em' : '0.71em'}">${esc(label)}</text></g>`;
  };
  return `<g fill="none" font-size="10" font-family="sans-serif" text-anchor="${vertical ? 'end' : 'middle'}" class="axis axis--${vertical ? 'y' : 'x'}"><path class="domain" stroke="currentColor" d="${domain}"></path>${items.map(tick).join('')}</g>`;
}

/* -------------------------------------------------------------- colour --- */

const toRgb = converter('rgb');

/** D3's interpolateLab between two CSS colours, as "rgb(r, g, b)". */
function labScale(min: string, max: string, maxCount: number): (count: number) => string {
  const from = parse(min) ?? parse('white');
  const to = parse(max) ?? parse('black');
  const mix = interpolate([from as never, to as never], 'lab');
  return (count: number) => {
    const c = toRgb(mix(maxCount ? count / maxCount : 0));
    const ch = (v: number | undefined) => Math.max(0, Math.min(255, Math.round((v ?? 0) * 255)));
    return `rgb(${ch(c?.r)}, ${ch(c?.g)}, ${ch(c?.b)})`;
  };
}

/* -------------------------------------------------------------- charts --- */

const DIMENSION = 500;
const MARGIN = { top: 10, right: 0, bottom: 40, left: 50 };

function frame(width: number, height: number, body: string, xLabel: string, yLabel: string): string {
  return (
    `<svg width="100%" height="100%" viewBox="0 0 ${DIMENSION} ${DIMENSION}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${DIMENSION}" height="${DIMENSION}" fill="white"></rect>` +
    `<g transform="translate(${MARGIN.left},${MARGIN.top})">${body}</g>` +
    `<text transform="rotate(-90)" y="0" x="${-(MARGIN.top + height / 2)}" dy="1em" style="text-anchor: middle;" font-family="sans-serif" font-size="12">${esc(yLabel)}</text>` +
    `<text x="${MARGIN.left + width / 2}" y="${DIMENSION - 4}" style="text-anchor: middle;" font-family="sans-serif" font-size="12">${esc(xLabel)}</text></svg>`
  );
}

const result = (svg: string): OpResult => ({ value: svg, preview: { kind: 'svg', svg } });

function scatter(input: string, a: Record<string, unknown>): OpResult {
  const headings = a.headings === true;
  const colourColumn = a.colourColumn === true;
  const { headings: head, values } = rows(input, a, colourColumn ? 3 : 2, headings);
  const points = values.map((cells) => [...numbers(cells), cells[2] ?? ''] as const);
  const xLabel = head ? (head[0] as string) : String(a.xLabel ?? '');
  const yLabel = head ? (head[1] as string) : String(a.yLabel ?? '');
  const width = DIMENSION - MARGIN.left - MARGIN.right;
  const height = DIMENSION - MARGIN.top - MARGIN.bottom;
  const [x0, x1] = extent(points.map((p) => p[0]));
  const [y0, y1] = extent(points.map((p) => p[1]));
  const x = linear([x0 - 0.1 * (x1 - x0), x1 + 0.1 * (x1 - x0)], [0, width]);
  const y = linear([y0 - 0.1 * (y1 - y0), y1 + 0.1 * (y1 - y0)], [height, 0]);
  const radius = Number(a.radius);
  const fill = String(a.colour ?? 'black');
  const circles = points
    .map(
      ([px, py, colour]) =>
        `<circle cx="${round(x(px))}" cy="${round(y(py))}" r="${esc(radius)}" fill="${esc(colourColumn ? colour : fill)}" stroke="rgba(0, 0, 0, 0.5)" stroke-width="0.5"><title>X: ${esc(px)}\nY: ${esc(py)}\n</title></circle>`,
    )
    .join('');
  const body =
    `<clipPath id="clip"><rect width="${width}" height="${height}"></rect></clipPath><g class="points" clip-path="url(#clip)">${circles}</g>` +
    axis('left', y, -width) +
    `<g transform="translate(0,${height})">${axis('bottom', x, -height)}</g>`;
  return result(frame(width, height, body, xLabel, yLabel));
}

function heatmap(input: string, a: Record<string, unknown>): OpResult {
  const vBins = Number(a.vBins);
  const hBins = Number(a.hBins);
  if (vBins <= 0) throw new OpError('Number of vertical bins must be greater than 0');
  if (hBins <= 0) throw new OpError('Number of horizontal bins must be greater than 0');
  const { headings: head, values } = rows(input, a, 2, a.headings === true);
  const points = values.map(numbers);
  const xLabel = head ? (head[0] as string) : String(a.xLabel ?? '');
  const yLabel = head ? (head[1] as string) : String(a.yLabel ?? '');
  const width = DIMENSION - MARGIN.left - MARGIN.right;
  const height = DIMENSION - MARGIN.top - MARGIN.bottom;
  const [x0, x1] = extent(points.map((p) => p[0]));
  const [y0, y1] = extent(points.map((p) => p[1]));
  if (x0 === x1) throw new OpError('Cannot pack points. There is no difference between the minimum and maximum X coordinate.');
  if (y0 === y1) throw new OpError('Cannot pack points. There is no difference between the minimum and maximum Y coordinate.');
  const bins: number[][] = Array.from({ length: vBins }, () => new Array<number>(hBins).fill(0));
  const epsilon = 0.000000001;
  for (const [px, py] of points) {
    const row = Math.floor(vBins * ((py - y0) / (y1 + epsilon - y0)));
    const col = Math.floor(hBins * ((px - x0) / (x1 + epsilon - x0)));
    (bins[row] as number[])[col] = ((bins[row] as number[])[col] as number) + 1;
  }
  const maxCount = Math.max(...bins.map((row) => Math.max(...row)));
  const colour = labScale(String(a.minColour), String(a.maxColour), maxCount);
  const binWidth = width / hBins;
  const binHeight = height / vBins;
  const edges = a.edges === true;
  let cells = '';
  bins.forEach((row, r) => {
    cells += '<g>';
    row.forEach((count, c) => {
      cells += `<rect x="${round(binWidth * c)}" y="${round(height - binHeight * (r + 1))}" width="${round(binWidth)}" height="${round(binHeight)}" fill="${colour(count)}" stroke="${edges ? 'rgba(0, 0, 0, 0.5)' : 'none'}" stroke-width="${edges ? '0.5' : 'none'}"><title>Count: ${count}\nPercentage: ${((100 * count) / points.length).toFixed(2)}%\n</title></rect>`;
    });
    cells += '</g>';
  });
  const body =
    `<clipPath id="clip"><rect width="${width}" height="${height}"></rect></clipPath><g class="bins" clip-path="url(#clip)">${cells}</g>` +
    axis('left', linear([y0, y1], [height, 0]), -width) +
    `<g transform="translate(0,${height})">${axis('bottom', linear([x0, x1], [0, width]), -height)}</g>`;
  return result(frame(width, height, body, xLabel, yLabel));
}

/** d3-hexbin's binning of points into hexagons of the given radius (in data units). */
function hexbin(points: [number, number][], radius: number): { x: number; y: number; points: [number, number][] }[] {
  const dx = radius * 2 * Math.sin(Math.PI / 3);
  const dy = radius * 1.5;
  const byId = new Map<string, { x: number; y: number; points: [number, number][] }>();
  const bins: { x: number; y: number; points: [number, number][] }[] = [];
  for (const point of points) {
    let py = point[1] / dy;
    let pj = Math.round(py);
    const px = point[0] / dx - (pj & 1) / 2;
    let pi = Math.round(px);
    const py1 = py - pj;
    if (Math.abs(py1) * 3 > 1) {
      const px1 = px - pi;
      const pi2 = pi + (px < pi ? -1 : 1) / 2;
      const pj2 = pj + (py < pj ? -1 : 1);
      const px2 = px - pi2;
      const py2 = py - pj2;
      if (px1 * px1 + py1 * py1 > px2 * px2 + py2 * py2) {
        pi = pi2 + (pj & 1 ? 1 : -1) / 2;
        pj = pj2;
      }
    }
    py = pj;
    const id = `${pi}-${pj}`;
    let bin = byId.get(id);
    if (!bin) {
      bin = { x: (pi + (pj & 1) / 2) * dx, y: py * dy, points: [] };
      byId.set(id, bin);
      bins.push(bin);
    }
    bin.points.push(point);
  }
  return bins;
}

/** d3-hexbin's hexagon path, relative to the current point. */
function hexagon(radius: number): string {
  let x0 = 0;
  let y0 = 0;
  const steps = [0, 1, 2, 3, 4, 5].map((i) => {
    const angle = (i * Math.PI) / 3;
    const x1 = Math.sin(angle) * radius;
    const y1 = -Math.cos(angle) * radius;
    const d = `${round(x1 - x0)},${round(y1 - y0)}`;
    x0 = x1;
    y0 = y1;
    return d;
  });
  return `m${steps.join('l')}z`;
}

function hexDensity(input: string, a: Record<string, unknown>): OpResult {
  const packRadius = Number(a.packRadius);
  const drawRadius = Number(a.drawRadius);
  if (!(packRadius > 0)) throw new OpError('Pack radius must be greater than 0');
  const { headings: head, values } = rows(input, a, 2, a.headings === true);
  const points = values.map(numbers);
  const xLabel = head ? (head[0] as string) : String(a.xLabel ?? '');
  const yLabel = head ? (head[1] as string) : String(a.yLabel ?? '');
  const width = DIMENSION - MARGIN.left - MARGIN.right;
  const height = DIMENSION - MARGIN.top - MARGIN.bottom;
  const bins = hexbin(points, packRadius);
  const maxCount = Math.max(...bins.map((b) => b.points.length));
  const xExtent = extent(bins.map((b) => b.x));
  const yExtent = extent(bins.map((b) => b.y));
  const x = linear([xExtent[0] - 2 * packRadius, xExtent[1] + 3 * packRadius], [0, width]);
  const y = linear([yExtent[0] - 2 * packRadius, yExtent[1] + 2 * packRadius], [height, 0]);
  const colour = labScale(String(a.minColour), String(a.maxColour), maxCount);
  const edges = a.edges === true;
  const shape = hexagon(drawRadius);
  const stroke = `stroke="${edges ? 'black' : 'none'}" stroke-width="${edges ? '0.5' : 'none'}"`;
  let empty = '';
  if (a.empty === true) {
    const centerToEdge = Math.cos((2 * Math.PI) / 12) * packRadius;
    const edgeLength = Math.sin((2 * Math.PI) / 12) * packRadius;
    let indent = false;
    for (let cy = yExtent[0]; cy <= yExtent[1] + packRadius; cy += edgeLength + packRadius) {
      for (let cx0 = xExtent[0]; cx0 <= xExtent[1] + packRadius; cx0 += 2 * centerToEdge) {
        if (indent && cx0 >= xExtent[1]) break;
        const cx = indent ? cx0 + centerToEdge : cx0;
        empty += `<path d="M${round(x(cx))},${round(y(cy))} ${shape}" fill="${colour(0)}" ${stroke}><title>Count: 0\nPercentage: 0.00%\nCenter: ${cx.toFixed(2)}, ${cy.toFixed(2)}\n</title></path>`;
      }
      indent = !indent;
    }
    empty = `<g class="empty-hexagon">${empty}</g>`;
  }
  const hexes = bins
    .map((b) => {
      const xs = b.points.map((p) => p[0]);
      const ys = b.points.map((p) => p[1]);
      const tip = `Count: ${b.points.length}\nPercentage: ${((100 * b.points.length) / points.length).toFixed(2)}%\nCenter: ${b.x.toFixed(2)}, ${b.y.toFixed(2)}\nMin X: ${Math.min(...xs).toFixed(2)}\nMax X: ${Math.max(...xs).toFixed(2)}\nMin Y: ${Math.min(...ys).toFixed(2)}\nMax Y: ${Math.max(...ys).toFixed(2)}`;
      return `<path d="M${round(x(b.x))},${round(y(b.y))} ${shape}" fill="${colour(b.points.length)}" ${stroke}><title>${tip}</title></path>`;
    })
    .join('');
  const body =
    `<clipPath id="clip"><rect width="${width}" height="${height}"></rect></clipPath>${empty}<g class="hexagon" clip-path="url(#clip)">${hexes}</g>` +
    axis('left', y, -width) +
    `<g transform="translate(0,${height})">${axis('bottom', x, -height)}</g>`;
  return result(frame(width, height, body, xLabel, yLabel));
}

function series(input: string, a: Record<string, unknown>): OpResult {
  const { values } = rows(input, a, 3, false);
  const xValues: string[] = [];
  const seen = new Set<string>();
  const data = new Map<string, Map<string, number>>();
  for (const [name = '', xv = '', raw = ''] of values) {
    const v = Number.parseFloat(raw);
    if (Number.isNaN(v)) throw new OpError('Values must be numbers in base 10.');
    if (!seen.has(xv)) {
      seen.add(xv);
      xValues.push(xv);
    }
    if (!data.has(name)) data.set(name, new Map());
    (data.get(name) as Map<string, number>).set(xv, v);
  }
  const colours = String(a.colours ?? '')
    .split(',')
    .map((c) => c.trim() || 'black');
  const radius = Number(a.radius);
  const svgWidth = 500;
  const padding = 20;
  const xAxisHeight = 50;
  const labelWidth = 50;
  const seriesHeight = 100;
  const seriesWidth = svgWidth - labelWidth - padding;
  const allHeight = data.size * (padding + seriesHeight);
  const svgHeight = allHeight + xAxisHeight + padding;
  // d3.scalePoint: evenly spaced, a single value in the middle.
  const step = xValues.length > 1 ? seriesWidth / (xValues.length - 1) : seriesWidth;
  const xAt = new Map(xValues.map((v, i) => [v, xValues.length > 1 ? i * step : seriesWidth / 2]));
  const tickIndexes = new Set([0, Math.round(xValues.length / 2), xValues.length - 1]);
  const xAxis = axis('top', { positions: xValues.filter((_, i) => tickIndexes.has(i)).map((v) => [v, xAt.get(v) as number]), range: [0, seriesWidth] });
  const tooltip = new Map(
    xValues.map((xv) => [
      xv,
      [...data]
        .filter(([, s]) => s.has(xv))
        .map(([name, s]) => `${name}: ${s.get(xv)}`)
        .join('\n'),
    ]),
  );
  const tip = (xv: string) => esc(`${xv}\n--\n${tooltip.get(xv)}\n`.replace(/\s{2,}/g, '\n'));
  const areaWidth = seriesWidth / xValues.length;
  let chart = `<g>${xValues.map((xv) => `<rect x="${round((xAt.get(xv) as number) - areaWidth / 2)}" y="0" width="${round(areaWidth)}" height="${allHeight}" stroke="none" fill="transparent"><title>${tip(xv)}</title></rect>`).join('')}</g>`;
  let yAxes = '';
  [...data].forEach(([name, s], index) => {
    const colour = esc(colours[index % colours.length]);
    const top = seriesHeight * index + padding * (index + 1);
    const y = linear(extent([...s.values()]), [seriesHeight, 0]);
    let path = '';
    xValues.forEach((xv, i) => {
      const next = xValues[i + 1];
      if (next === undefined || !s.has(xv) || !s.has(next)) return;
      path += `M ${round(xAt.get(xv) as number)} ${round(y(s.get(xv) as number))} L ${round(xAt.get(next) as number)} ${round(y(s.get(next) as number))} z `;
    });
    const dots = xValues
      .filter((xv) => s.has(xv))
      .map((xv) => `<circle cx="${round(xAt.get(xv) as number)}" cy="${round(y(s.get(xv) as number))}" r="${esc(radius)}" fill="${colour}"><title>${tip(xv)}</title></circle>`)
      .join('');
    chart += `<g transform="translate(0, ${top})"><path d="${path}" fill="none" stroke="${colour}" stroke-width="1"></path>${dots}</g>`;
    yAxes += `<g transform="translate(${labelWidth - padding}, ${top})">${axis('left', y, 6, 5)}</g>`;
    yAxes += `<g transform="translate(0, ${seriesHeight / 2 + top})"><text style="text-anchor: middle;" transform="rotate(-90)" font-family="sans-serif" font-size="12" dy="1em">${esc(name)}</text></g>`;
  });
  const svg =
    `<svg width="100%" height="100%" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${svgWidth}" height="${svgHeight}" fill="white"></rect>` +
    `<g transform="translate(${labelWidth}, ${xAxisHeight})">${xAxis}</g>` +
    `<text x="${svgWidth / 2}" y="${xAxisHeight / 2}" style="text-anchor: middle;" font-family="sans-serif" font-size="12">${esc(a.xLabel ?? '')}</text>` +
    `<g transform="translate(${labelWidth}, ${xAxisHeight})">${chart}</g>` +
    `<g transform="translate(0, ${xAxisHeight})">${yAxes}</g></svg>`;
  return result(svg);
}

const DELIMS = [sel('record', 'Record delimiter', RECORD), sel('field', 'Field delimiter', FIELD)];
const read = (a: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, a[k]]));

export const chartOps: Operation[] = [
  defineOp({
    name: 'Scatter chart',
    category: C,
    description: 'Plots X Y pairs (one per line) as a scatter chart. A third column can give each point’s colour.',
    input: 'text',
    output: 'text',
    keywords: ['plot', 'graph', 'svg'],
    args: [
      ...DELIMS,
      bool('headings', 'Use column headers as labels', true),
      str('xLabel', 'X label'),
      str('yLabel', 'Y label'),
      str('colour', 'Colour', 'black'),
      num('radius', 'Point radius', 10, { min: 0 }),
      bool('colourColumn', 'Use colour from third column'),
    ],
    run: (input, a) =>
      scatter(input, { ...read(a, ['record', 'field', 'xLabel', 'yLabel', 'colour']), headings: bArg(a, 'headings'), radius: nArg(a, 'radius'), colourColumn: bArg(a, 'colourColumn') }),
  }),
  defineOp({
    name: 'Series chart',
    category: C,
    description: 'Plots rows of "series, X, value" as one line chart per series, sharing the X axis.',
    input: 'text',
    output: 'text',
    keywords: ['plot', 'graph', 'line', 'svg', 'time series'],
    args: [...DELIMS, str('xLabel', 'X label'), num('radius', 'Point radius', 1, { min: 0 }), str('colours', 'Series colours', 'mediumseagreen, dodgerblue, tomato')],
    run: (input, a) => series(input, { ...read(a, ['record', 'field', 'colours']), xLabel: sArg(a, 'xLabel'), radius: nArg(a, 'radius') }),
  }),
  defineOp({
    name: 'Heatmap chart',
    category: C,
    description: 'Counts X Y pairs in a grid of bins and shades each bin by how many points fall in it.',
    input: 'text',
    output: 'text',
    keywords: ['plot', 'graph', 'density', 'svg'],
    args: [
      ...DELIMS,
      num('vBins', 'Number of vertical bins', 25, { min: 1 }),
      num('hBins', 'Number of horizontal bins', 25, { min: 1 }),
      bool('headings', 'Use column headers as labels', true),
      str('xLabel', 'X label'),
      str('yLabel', 'Y label'),
      bool('edges', 'Draw bin edges'),
      str('minColour', 'Min colour value', 'white'),
      str('maxColour', 'Max colour value', 'black'),
    ],
    run: (input, a) =>
      heatmap(input, {
        ...read(a, ['record', 'field', 'xLabel', 'yLabel', 'minColour', 'maxColour']),
        vBins: nArg(a, 'vBins'),
        hBins: nArg(a, 'hBins'),
        headings: bArg(a, 'headings'),
        edges: bArg(a, 'edges'),
      }),
  }),
  defineOp({
    name: 'Hex Density chart',
    category: C,
    description: 'Groups X Y pairs into hexagonal bins (the pack radius is in data units) and shades each by how many points it holds.',
    input: 'text',
    output: 'text',
    keywords: ['plot', 'graph', 'hexbin', 'density', 'svg'],
    args: [
      ...DELIMS,
      num('packRadius', 'Pack radius', 25, { min: 0 }),
      num('drawRadius', 'Draw radius', 15, { min: 0 }),
      bool('headings', 'Use column headers as labels', true),
      str('xLabel', 'X label'),
      str('yLabel', 'Y label'),
      bool('edges', 'Draw hexagon edges'),
      str('minColour', 'Min colour value', 'white'),
      str('maxColour', 'Max colour value', 'black'),
      bool('empty', 'Draw empty hexagons within data boundaries'),
    ],
    run: (input, a) =>
      hexDensity(input, {
        ...read(a, ['record', 'field', 'xLabel', 'yLabel', 'minColour', 'maxColour']),
        packRadius: nArg(a, 'packRadius'),
        drawRadius: nArg(a, 'drawRadius'),
        headings: bArg(a, 'headings'),
        edges: bArg(a, 'edges'),
        empty: bArg(a, 'empty'),
      }),
  }),
];
