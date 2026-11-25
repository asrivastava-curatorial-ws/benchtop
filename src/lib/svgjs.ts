/**
 * The SVG.js editor: what its drawing frame says (checked, since the code in
 * the frame is not trusted), saved drawings, the page that runs a drawing on
 * its own, and the examples.  The frame's own page is written at build time
 * by scripts/svgjs-frame.mjs.
 */
import { withoutScripts } from './svg-layers';

const inline = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

export type FrameMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'done' }
  | { readonly type: 'log'; readonly level: 'log' | 'info' | 'warn' | 'error'; readonly text: string }
  | { readonly type: 'error'; readonly text: string; readonly line: number }
  | { readonly type: 'snapshot'; readonly id: number; readonly svg: string };

/** What the frame said, checked: the code in it is not trusted to keep to the format. */
export function readFrameMessage(data: unknown): FrameMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  const text = typeof m.text === 'string' ? m.text.slice(0, 4000) : '';
  switch (m.type) {
    case 'ready':
    case 'done':
      return { type: m.type };
    case 'log':
      return { type: 'log', level: m.level === 'info' || m.level === 'warn' || m.level === 'error' ? m.level : 'log', text };
    case 'error':
      return { type: 'error', text: text || 'Error', line: typeof m.line === 'number' && Number.isFinite(m.line) && m.line > 0 ? Math.floor(m.line) : 0 };
    case 'snapshot':
      return typeof m.id === 'number' && typeof m.svg === 'string' && m.svg.length <= 20_000_000 ? { type: 'snapshot', id: m.id, svg: m.svg } : null;
    default:
      return null;
  }
}

/** A drawing as a file: scripts and event handlers taken out, and the namespace it needs to open on its own. */
export function tidySvg(markup: string): string {
  let svg = markup.trim();
  if (!/^<svg[\s>]/.test(svg)) throw new Error('The drawing is empty.');
  try {
    svg = withoutScripts(svg);
  } catch {
    /* Markup the reader cannot follow is saved as the browser wrote it. */
  }
  if (!/^<svg[^>]*\sxmlns=/.test(svg)) svg = svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

/** The size written on a drawing's <svg> element, when it has one. */
export function svgSize(markup: string): { width: number; height: number } | null {
  const tag = /^<svg[^>]*>/.exec(markup.trim())?.[0] ?? '';
  const width = Number(/\swidth="([\d.]+)(?:px)?"/.exec(tag)?.[1]);
  const height = Number(/\sheight="([\d.]+)(?:px)?"/.exec(tag)?.[1]);
  if (width > 0 && height > 0) return { width, height };
  const box = /\sviewBox="([^"]+)"/
    .exec(tag)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  return box && box.length === 4 && (box[2] as number) > 0 && (box[3] as number) > 0 ? { width: box[2] as number, height: box[3] as number } : null;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A web page that runs the code on its own, with SVG.js inside it: nothing else is needed to open it. */
export function standalonePage(code: string, library: string, options: { title: string; width: number; height: number; background: string; licence?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Benchtop SVG.js Editor">
<title>${escapeHtml(options.title)}</title>
<style>
html, body { margin: 0; min-height: 100%; background: ${/^#[0-9a-f]{3,8}$/i.test(options.background) ? options.background : '#ffffff'}; }
body { display: grid; place-items: center; min-height: 100vh; }
#drawing > svg { display: block; max-width: 100vw; max-height: 100vh; width: auto; height: auto; }
</style>
</head>
<body>
<div id="drawing"></div>
<script>${inline(library)}</script>
<script>
window.width = ${Math.round(options.width)};
window.height = ${Math.round(options.height)};
window.draw = SVG().addTo('#drawing').size(width, height).viewbox(0, 0, width, height);
(function () {
${inline(code)}
})();
</script>
</body>
</html>
${options.licence ? `<!--\nSVG.js (MIT), https://svgjs.dev/\n\n${options.licence.replace(/--/g, '- -')}\n-->\n` : ''}`;
}

export interface Example {
  readonly name: string;
  readonly code: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    name: 'Shapes and text',
    code: `// "draw" is an SVG.js drawing of the size set above; "width" and "height" are its size.
draw.rect(width, height).fill('#0d1117');
draw.circle(180).center(width / 2, height / 2).fill('#f0883e');
draw.rect(130, 130).move(70, 70).radius(18).fill('#1f6feb').opacity(0.9);
draw.polygon('0,90 55,0 110,90').move(width - 190, height - 170).fill('#3fb950');
draw.line(50, height - 50, width - 50, height - 50).stroke({ color: '#8b949e', width: 4, linecap: 'round' });
draw.text('SVG.js').font({ family: 'sans-serif', size: 44, weight: 700 }).fill('#f0f6fc').move(70, height - 130);
`,
  },
  {
    name: 'Gradients and patterns',
    code: `const sky = draw.gradient('linear', function (add) {
  add.stop(0, '#1f6feb');
  add.stop(1, '#a5d6ff');
}).from(0, 0).to(0, 1);
draw.rect(width, height).fill(sky);

const sun = draw.gradient('radial', function (add) {
  add.stop(0, '#fff7c2');
  add.stop(1, '#f0c050');
});
draw.circle(130).center(width * 0.75, height * 0.3).fill(sun);

const dots = draw.pattern(26, 26, function (add) {
  add.rect(26, 26).fill('#238636');
  add.circle(7).center(13, 13).fill('#3fb950');
});
draw.path('M0 ' + height + ' Q ' + width * 0.3 + ' ' + height * 0.45 + ' ' + width * 0.62 + ' ' + height + ' Z').fill(dots);
`,
  },
  {
    name: 'Animation',
    code: `draw.rect(width, height).fill('#0d1117');

// Back and forth for ever, easing in and out.
const ball = draw.circle(64).center(90, height / 2).fill('#f85149');
ball.animate(1500).ease('<>').center(width - 90, height / 2).loop(true, true);

// A full turn every three seconds.
const box = draw.rect(90, 90).center(width / 2, height * 0.28).fill('#58a6ff');
box.animate(3000).ease('-').rotate(360).loop();

// One after another: a delay for each bar.
for (let i = 0; i < 6; i++) {
  const bar = draw.rect(40, 10).move(width / 2 - 165 + i * 58, height - 60).fill('#3fb950');
  bar.animate(700, i * 120).ease('<>').size(40, 120).dy(-110).loop(true, true);
}
`,
  },
  {
    name: 'Click to turn',
    code: `draw.rect(width, height).fill('#161b22');
draw.text('Click a tile').font({ family: 'sans-serif', size: 24 }).fill('#c9d1d9').move(40, 36);

const colours = ['#f85149', '#f0883e', '#3fb950', '#58a6ff', '#bc8cff'];
colours.forEach(function (colour, i) {
  const tile = draw.rect(100, 100).radius(14).move(40 + i * 124, height / 2 - 50).fill(colour);
  tile.css('cursor', 'pointer');
  tile.click(function () {
    this.animate(300).rotate(90);
    console.log('Tile ' + (i + 1) + ' turned');
  });
});
`,
  },
  {
    name: 'Bar chart from data',
    code: `const data = [['Mon', 32], ['Tue', 45], ['Wed', 28], ['Thu', 60], ['Fri', 52]];
const most = Math.max.apply(null, data.map(function (d) { return d[1]; }));
const left = 60, bottom = height - 60, step = (width - left - 30) / data.length;

draw.rect(width, height).fill('#ffffff');
data.forEach(function (d, i) {
  const tall = (d[1] / most) * (bottom - 60);
  const x = left + i * step;
  const bar = draw.rect(step - 18, 1).move(x, bottom - 1).fill('#1f6feb');
  bar.animate(600, i * 120).size(step - 18, tall).move(x, bottom - tall);
  draw.text(d[0]).font({ family: 'sans-serif', size: 16 }).fill('#24292f').center(x + (step - 18) / 2, bottom + 24);
  draw.text(String(d[1])).font({ family: 'sans-serif', size: 14 }).fill('#57606a').center(x + (step - 18) / 2, bottom - tall - 16);
});
draw.line(left - 12, bottom, width - 20, bottom).stroke({ color: '#24292f', width: 2 });
`,
  },
  {
    name: 'Along a path',
    code: `draw.rect(width, height).fill('#0d1117');
const d = 'M60 ' + height * 0.7 + ' C ' + width * 0.25 + ' 40, ' + width * 0.45 + ' 40, ' + width * 0.55 + ' ' + height * 0.5 + ' S ' + width * 0.85 + ' ' + height + ', ' + (width - 60) + ' ' + height * 0.3;
const route = draw.path(d).fill('none').stroke({ color: '#30363d', width: 8, linecap: 'round' });
const length = route.length();

// The same path again, drawn in as its dashes slide.
const tracer = draw.path(d).fill('none').stroke({ color: '#3fb950', width: 8, linecap: 'round', dasharray: length, dashoffset: length });
tracer.animate(2600).ease('<>').attr({ 'stroke-dashoffset': 0 }).loop(true, true);

// A dot that rides along it.
const dot = draw.circle(26).fill('#f0c050');
dot.animate(2600).ease('<>').during(function (position) {
  const place = route.pointAt(position * length);
  dot.center(place.x, place.y);
}).loop(true, true);
`,
  },
];
