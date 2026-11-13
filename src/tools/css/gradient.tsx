import { gradientMix, type MixSpace, rgbaString, toRgba, trimNumber } from '../../lib/color';
import { linearGradientLine, radialGradientRadii } from '../../lib/geometry';
import { seededRandom } from '../../lib/text';
import { defineVisualTool, type Values } from '../types';
import { arbitrary, canvasPngDownload, color, css, js, rule, svgDownload, text, xml } from './_shared';

const STOP_ITEM = [
  { key: 'color', label: 'Colour', type: 'color', alpha: true, default: '#4f46e5' },
  { key: 'position', label: 'Position', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 0 },
] as const;

const controls = [
  { key: 'type', label: 'Type', type: 'segmented', choices: ['linear', 'radial', 'conic'], default: 'linear' },
  { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 360, step: 1, unit: '°', default: 135, showIf: (v: Values) => v.type !== 'radial' },
  { key: 'shape', label: 'Shape', type: 'segmented', choices: ['ellipse', 'circle'], default: 'ellipse', showIf: (v: Values) => v.type === 'radial' },
  { key: 'x', label: 'Centre X', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50, showIf: (v: Values) => v.type !== 'linear' },
  { key: 'y', label: 'Centre Y', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50, showIf: (v: Values) => v.type !== 'linear' },
  { key: 'repeating', label: 'Repeating', type: 'toggle', default: false },
  {
    key: 'space',
    label: 'Blend colours in',
    type: 'select',
    choices: [
      { value: 'srgb', label: 'sRGB (classic)' },
      { value: 'oklab', label: 'OKLab (even, no grey middle)' },
      { value: 'oklch', label: 'OKLCH (vivid, follows hue)' },
    ],
    default: 'srgb',
    help: 'Only CSS output uses this; SVG, Canvas and app code blend in sRGB.',
  },
  {
    key: 'stops',
    label: 'Colour stops',
    type: 'list',
    item: STOP_ITEM,
    min: 2,
    max: 12,
    itemLabel: 'Stop',
    default: [
      { color: '#4f46e5', position: 0 },
      { color: '#ec4899', position: 55 },
      { color: '#f59e0b', position: 100 },
    ],
  },
  { key: 'width', label: 'Image width', type: 'number', min: 1, max: 8192, step: 1, unit: 'px', default: 1600 },
  { key: 'height', label: 'Image height', type: 'number', min: 1, max: 8192, step: 1, unit: 'px', default: 900 },
] as const;

interface Stop {
  readonly color: string;
  readonly position: number;
}

interface Gradient {
  readonly type: string;
  readonly angle: number;
  readonly shape: string;
  readonly x: number;
  readonly y: number;
  readonly repeating: boolean;
  readonly space: string;
  readonly stops: readonly Stop[];
}

const sorted = (stops: readonly Stop[]): Stop[] => [...stops].sort((a, b) => a.position - b.position);

export function gradientCss(g: Gradient): string {
  const stops = sorted(g.stops)
    .map((stop) => `${color(stop.color)} ${trimNumber(stop.position, 2)}%`)
    .join(', ');
  const space = g.space === 'srgb' ? '' : ` in ${g.space}`;
  const at = `at ${trimNumber(g.x, 2)}% ${trimNumber(g.y, 2)}%`;
  const prefix = g.repeating ? 'repeating-' : '';
  if (g.type === 'radial') return `${prefix}radial-gradient(${g.shape} ${at}${space}, ${stops})`;
  if (g.type === 'conic') return `${prefix}conic-gradient(from ${trimNumber(g.angle, 2)}deg ${at}${space}, ${stops})`;
  return `${prefix}linear-gradient(${trimNumber(g.angle, 2)}deg${space}, ${stops})`;
}

/** Intermediate stops per segment when blending outside sRGB; enough that the steps are invisible. */
const MIX_STEPS = 16;

/**
 * Offsets in 0-1 and the share of the gradient line they cover (for repeating
 * gradients).  Canvas and SVG only blend in sRGB, so for OKLab and OKLCH the
 * blend is sampled into extra stops to match what CSS draws.
 */
export function normalised(g: Gradient, expand = true): { stops: { color: string; offset: number }[]; span: number } {
  const list = sorted(g.stops);
  const span = g.repeating ? Math.max(0.01, (list.at(-1)?.position ?? 100) / 100) : 1;
  const stops: { color: string; offset: number }[] = [];
  list.forEach((stop, index) => {
    const previous = list[index - 1];
    if (expand && previous && g.space !== 'srgb' && stop.position > previous.position) {
      for (let step = 1; step < MIX_STEPS; step++) {
        const t = step / MIX_STEPS;
        stops.push({ color: gradientMix(previous.color, stop.color, t, g.space as MixSpace), offset: (previous.position + (stop.position - previous.position) * t) / 100 / span });
      }
    }
    stops.push({ color: stop.color, offset: stop.position / 100 / span });
  });
  return { stops, span };
}

function drawGradient(g: Gradient, context: CanvasRenderingContext2D, width: number, height: number): void {
  const { stops, span } = normalised(g);
  const add = (gradient: CanvasGradient, offset = 0, scale = 1) => {
    for (const stop of stops) gradient.addColorStop(Math.min(1, Math.max(0, offset + stop.offset * scale)), rgbaString(stop.color));
  };
  const cx = (g.x / 100) * width;
  const cy = (g.y / 100) * height;
  if (g.type === 'linear') {
    const { start, end } = linearGradientLine(g.angle, width, height);
    if (!g.repeating) {
      const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
      add(gradient);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      return;
    }
    // Canvas has no repeating gradients: draw each repetition as its own band.
    const dx = (end.x - start.x) * span;
    const dy = (end.y - start.y) * span;
    const repeats = Math.ceil(1 / span);
    for (let i = 0; i < repeats; i++) {
      const gradient = context.createLinearGradient(start.x + dx * i, start.y + dy * i, start.x + dx * (i + 1), start.y + dy * (i + 1));
      add(gradient);
      context.save();
      context.beginPath();
      const length = Math.hypot(dx, dy) || 1;
      const nx = dx / length;
      const ny = dy / length;
      const big = width + height;
      const ax = start.x + dx * i;
      const ay = start.y + dy * i;
      context.moveTo(ax - ny * big, ay + nx * big);
      context.lineTo(ax + ny * big, ay - nx * big);
      context.lineTo(ax + dx + ny * big, ay + dy - nx * big);
      context.lineTo(ax + dx - ny * big, ay + dy + nx * big);
      context.closePath();
      context.clip();
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.restore();
    }
    return;
  }
  if (g.type === 'radial') {
    const { rx, ry } = radialGradientRadii(cx, cy, width, height, g.shape === 'circle');
    context.save();
    context.translate(cx, cy);
    context.scale(1, ry / rx);
    const reach = Math.hypot(width, height) * (rx / Math.min(rx, ry)) * 2;
    if (!g.repeating) {
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, rx);
      add(gradient);
      context.fillStyle = gradient;
      context.fillRect(-reach, -reach, reach * 2, reach * 2);
    } else {
      const ring = rx * span;
      for (let r = Math.ceil(reach / ring); r >= 0; r--) {
        const gradient = context.createRadialGradient(0, 0, ring * r, 0, 0, ring * (r + 1));
        add(gradient);
        context.beginPath();
        context.arc(0, 0, ring * (r + 1), 0, Math.PI * 2);
        context.fillStyle = gradient;
        context.fill();
      }
    }
    context.restore();
    return;
  }
  const start = ((g.angle - 90) * Math.PI) / 180;
  if (!g.repeating) {
    const gradient = context.createConicGradient(start, cx, cy);
    add(gradient);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    return;
  }
  const sweep = Math.PI * 2 * span;
  const reach = Math.hypot(width, height);
  for (let i = 0; i * span < 1; i++) {
    const from = start + sweep * i;
    const gradient = context.createConicGradient(from, cx, cy);
    add(gradient, 0, span);
    context.save();
    context.beginPath();
    context.moveTo(cx, cy);
    context.arc(cx, cy, reach, from, from + sweep);
    context.closePath();
    context.clip();
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
}

function svgCode(g: Gradient, width: number, height: number): string | null {
  if (g.type === 'conic') return null;
  const { stops, span } = normalised(g);
  const stopTags = stops
    .map((stop) => {
      const rgba = toRgba(stop.color);
      const opacity = rgba.a < 1 ? ` stop-opacity="${trimNumber(rgba.a, 3)}"` : '';
      return `    <stop offset="${trimNumber(stop.offset, 4)}" stop-color="rgb(${rgba.r}, ${rgba.g}, ${rgba.b})"${opacity}/>`;
    })
    .join('\n');
  const spread = g.repeating ? ' spreadMethod="repeat"' : '';
  let definition: string;
  if (g.type === 'linear') {
    const { start, end } = linearGradientLine(g.angle, width, height);
    const x2 = start.x + (end.x - start.x) * span;
    const y2 = start.y + (end.y - start.y) * span;
    definition = `  <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${trimNumber(start.x, 2)}" y1="${trimNumber(start.y, 2)}" x2="${trimNumber(x2, 2)}" y2="${trimNumber(y2, 2)}"${spread}>\n${stopTags}\n  </linearGradient>`;
  } else {
    const cx = (g.x / 100) * width;
    const cy = (g.y / 100) * height;
    const { rx, ry } = radialGradientRadii(cx, cy, width, height, g.shape === 'circle');
    const transform =
      rx !== ry ? ` gradientTransform="translate(${trimNumber(cx, 2)} ${trimNumber(cy, 2)}) scale(1 ${trimNumber(ry / rx, 5)}) translate(${trimNumber(-cx, 2)} ${trimNumber(-cy, 2)})"` : '';
    definition = `  <radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${trimNumber(cx, 2)}" cy="${trimNumber(cy, 2)}" r="${trimNumber(rx * span, 2)}"${transform}${spread}>\n${stopTags}\n  </radialGradient>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <defs>\n${definition}\n  </defs>\n  <rect width="100%" height="100%" fill="url(#g)"/>\n</svg>\n`;
}

function canvasCode(g: Gradient, width: number, height: number): string {
  const { stops } = normalised(g);
  const lines = stops.map((stop) => `gradient.addColorStop(${trimNumber(stop.offset, 4)}, '${rgbaString(stop.color)}');`).join('\n');
  const cx = trimNumber((g.x / 100) * width, 2);
  const cy = trimNumber((g.y / 100) * height, 2);
  let create: string;
  if (g.type === 'linear') {
    const { start, end } = linearGradientLine(g.angle, width, height);
    create = `const gradient = ctx.createLinearGradient(${trimNumber(start.x, 2)}, ${trimNumber(start.y, 2)}, ${trimNumber(end.x, 2)}, ${trimNumber(end.y, 2)});`;
  } else if (g.type === 'radial') {
    const { rx } = radialGradientRadii((g.x / 100) * width, (g.y / 100) * height, width, height, g.shape === 'circle');
    create = `const gradient = ctx.createRadialGradient(${cx}, ${cy}, 0, ${cx}, ${cy}, ${trimNumber(rx, 2)});`;
  } else {
    create = `const gradient = ctx.createConicGradient(${trimNumber(((g.angle - 90) * Math.PI) / 180, 5)}, ${cx}, ${cy});`;
  }
  const note = `${g.repeating ? '// Canvas gradients do not repeat; this draws a single repetition.\n' : ''}${g.space !== 'srgb' ? `// The extra stops reproduce the ${g.space === 'oklch' ? 'OKLCH' : 'OKLab'} blend, since Canvas blends in sRGB.\n` : ''}`;
  const ellipse = g.type === 'radial' && g.shape === 'ellipse' ? '// For an ellipse, scale the context vertically before filling.\n' : '';
  return `${note}${ellipse}const canvas = document.querySelector('canvas');\ncanvas.width = ${width};\ncanvas.height = ${height};\nconst ctx = canvas.getContext('2d');\n${create}\n${lines}\nctx.fillStyle = gradient;\nctx.fillRect(0, 0, canvas.width, canvas.height);\n`;
}

function swiftColor(input: string): string {
  const c = toRgba(input);
  const f = (value: number) => trimNumber(value / 255, 3);
  return `Color(red: ${f(c.r)}, green: ${f(c.g)}, blue: ${f(c.b)}${c.a < 1 ? `, opacity: ${trimNumber(c.a, 3)}` : ''})`;
}

function swiftCode(g: Gradient, width: number, height: number): string {
  const { stops } = normalised(g, false);
  const list = stops.map((stop) => `        .init(color: ${swiftColor(stop.color)}, location: ${trimNumber(stop.offset, 4)})`).join(',\n');
  const center = `UnitPoint(x: ${trimNumber(g.x / 100, 3)}, y: ${trimNumber(g.y / 100, 3)})`;
  let body: string;
  if (g.type === 'linear') {
    const { start, end } = linearGradientLine(g.angle, width, height);
    body = `LinearGradient(\n    stops: [\n${list}\n    ],\n    startPoint: UnitPoint(x: ${trimNumber(start.x / width, 3)}, y: ${trimNumber(start.y / height, 3)}),\n    endPoint: UnitPoint(x: ${trimNumber(end.x / width, 3)}, y: ${trimNumber(end.y / height, 3)})\n)`;
  } else if (g.type === 'radial') {
    const { rx } = radialGradientRadii((g.x / 100) * width, (g.y / 100) * height, width, height, g.shape === 'circle');
    body = `RadialGradient(\n    stops: [\n${list}\n    ],\n    center: ${center},\n    startRadius: 0,\n    endRadius: ${trimNumber(rx, 1)}\n)`;
  } else {
    body = `AngularGradient(\n    stops: [\n${list}\n    ],\n    center: ${center},\n    angle: .degrees(${trimNumber(g.angle - 90, 2)})\n)`;
  }
  return `// SwiftUI, sized for a ${width} × ${height} view\nlet gradient = ${body}\n`;
}

function androidColor(input: string): string {
  const c = toRgba(input);
  const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(c.a * 255)}${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

function androidCode(g: Gradient, width: number, height: number): string {
  const list = sorted(g.stops);
  const first = list[0] as Stop;
  const last = list.at(-1) as Stop;
  const middle = list.length > 2 ? list[Math.floor(list.length / 2)] : undefined;
  const colours = [`android:startColor="${androidColor(first.color)}"`, middle ? `android:centerColor="${androidColor(middle.color)}"` : '', `android:endColor="${androidColor(last.color)}"`].filter(
    Boolean,
  );
  const notes: string[] = [];
  if (list.length > 3) notes.push('Shape drawables support up to three colours (start, centre, end); the other stops were left out.');
  if (g.repeating) notes.push('Shape drawables cannot repeat a gradient.');
  let attributes: string[];
  if (g.type === 'linear') {
    // Android measures counter-clockwise from "left to right"; CSS measures clockwise from "to top".
    const raw = (((90 - g.angle) % 360) + 360) % 360;
    const angle = (Math.round(raw / 45) * 45) % 360;
    if (angle !== raw) notes.push(`The angle was rounded to ${angle}°, because shape gradients only accept multiples of 45°.`);
    attributes = ['android:type="linear"', `android:angle="${angle}"`];
  } else if (g.type === 'radial') {
    const { rx } = radialGradientRadii((g.x / 100) * width, (g.y / 100) * height, width, height, true);
    attributes = ['android:type="radial"', `android:centerX="${trimNumber(g.x / 100, 3)}"`, `android:centerY="${trimNumber(g.y / 100, 3)}"`, `android:gradientRadius="${Math.round(rx)}dp"`];
    if (g.shape === 'ellipse') notes.push('Radial shape gradients are always circular.');
  } else {
    attributes = ['android:type="sweep"', `android:centerX="${trimNumber(g.x / 100, 3)}"`, `android:centerY="${trimNumber(g.y / 100, 3)}"`];
    notes.push("Sweep gradients always start at the 3 o'clock position; rotate the view to change the start angle.");
  }
  const comments = notes.map((note) => `<!-- ${note} -->\n`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n${comments}<shape xmlns:android="http://schemas.android.com/apk/res/android"\n    android:shape="rectangle">\n    <gradient\n        ${[...attributes, ...colours].join('\n        ')} />\n</shape>\n`;
}

export default defineVisualTool({
  controls,
  presets: [
    {
      name: 'Sunset',
      values: {
        type: 'linear',
        angle: 160,
        space: 'oklab',
        repeating: false,
        stops: [
          { color: '#2b1055', position: 0 },
          { color: '#d53a9d', position: 50 },
          { color: '#ffb36b', position: 100 },
        ],
      },
    },
    {
      name: 'Lagoon',
      values: {
        type: 'radial',
        shape: 'ellipse',
        x: 30,
        y: 20,
        space: 'oklch',
        repeating: false,
        stops: [
          { color: '#a7f3d0', position: 0 },
          { color: '#0e7490', position: 60 },
          { color: '#082f49', position: 100 },
        ],
      },
    },
    {
      name: 'Colour wheel',
      values: {
        type: 'conic',
        angle: 0,
        x: 50,
        y: 50,
        space: 'oklch',
        repeating: false,
        stops: [
          { color: '#ff0000', position: 0 },
          { color: '#00ff00', position: 33 },
          { color: '#0000ff', position: 66 },
          { color: '#ff0000', position: 100 },
        ],
      },
    },
    {
      name: 'Stripes',
      values: {
        type: 'linear',
        angle: 45,
        space: 'srgb',
        repeating: true,
        stops: [
          { color: '#111827', position: 0 },
          { color: '#111827', position: 5 },
          { color: '#facc15', position: 5 },
          { color: '#facc15', position: 10 },
        ],
      },
    },
  ],
  randomize(values) {
    const random = seededRandom(Math.floor(Math.random() * 2 ** 31));
    const count = 2 + Math.floor(random() * 3);
    const hue = random() * 360;
    const stops = Array.from({ length: count }, (_, index) => ({
      color: `oklch(${trimNumber(0.55 + random() * 0.3, 3)} ${trimNumber(0.12 + random() * 0.12, 3)} ${trimNumber((hue + index * (60 + random() * 80)) % 360, 1)})`,
      position: Math.round((index / (count - 1)) * 100),
    }));
    return { angle: Math.round(random() * 360), stops, x: values.type === 'linear' ? values.x : Math.round(random() * 100), y: values.type === 'linear' ? values.y : Math.round(random() * 100) };
  },
  render(v) {
    const g: Gradient = { ...v, stops: v.stops as readonly Stop[] };
    const value = gradientCss(g);
    const width = Math.max(1, Math.round(v.width));
    const height = Math.max(1, Math.round(v.height));
    const svg = svgCode(g, width, height);
    const outputs = [
      css(rule('.gradient', [['background', value]])),
      { label: 'Tailwind', language: 'html' as const, code: `<div class="bg-${arbitrary(value)}"></div>\n` },
      svg ? xml(svg, 'SVG', 'gradient.svg') : text('SVG has no conic gradients. Use the CSS, Canvas or PNG output instead.\n', 'SVG'),
      js(canvasCode(g, width, height), 'Canvas'),
      text(swiftCode(g, width, height), 'SwiftUI', 'Gradient.swift'),
      xml(androidCode(g, width, height), 'Android', 'gradient.xml'),
    ];
    return {
      preview: <div class="pv-fill" style={`background: ${value}; aspect-ratio: ${width} / ${height};`} data-testid="gradient-preview" />,
      css: '.pv-fill { width: min(100%, 560px); max-height: 100%; border-radius: 6px; }',
      outputs,
      downloads: [
        canvasPngDownload((context, w, h) => drawGradient(g, context, w, h), width, height, 'gradient.png', `PNG ${width} × ${height}`),
        ...(svg ? [svgDownload(() => svg, 'gradient.svg')] : []),
      ],
    };
  },
});
