/**
 * Sealed frames for the D3.js and anime.js editors, as for the SVG.js
 * editor: a page holding the library and a small runner that takes code from
 * the editor, runs it, and reports console output, errors and the finished
 * SVG back.  The build writes the pages (public/d3/frame.html and
 * public/anime/frame.html); this module also writes the pages that run a
 * piece of code on its own, and holds the examples.
 */

export type FrameKind = 'd3' | 'anime';

/** What a frame's page may load: nothing from anywhere, only what is written into it. */
export const FRAME_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** Lines "new Function" puts before the first line of the code it runs. */
export const CODE_OFFSET = 2;

/** A data file handed to D3 code: its name and its text. */
export interface DataFile {
  readonly name: string;
  readonly text: string;
}

/**
 * What runs before the code, per library: `host` is the empty drawing area and
 * `job` the run message (width, height, files).  D3 gets `svg` (an SVG of the
 * set size), `data` (the first data file, parsed) and `files` (all of them),
 * and d3.csv/tsv/json/text read the data files instead of the network.
 * anime.js gets `stage` (the drawing area) and all of anime.js's functions.
 */
const PRELUDE: Readonly<Record<FrameKind, string>> = {
  d3: `
    var raw = {};
    (job.files || []).forEach(function (f) { raw[f.name] = f.text; });
    var parse = function (name, text) {
      var lower = name.toLowerCase();
      if (/\\.(geo|topo)?json$/.test(lower)) return JSON.parse(text);
      if (/\\.tsv$/.test(lower)) return d3.tsvParse(text, d3.autoType);
      if (/\\.csv$/.test(lower)) return d3.csvParse(text, d3.autoType);
      return text;
    };
    var lookup = function (name) {
      var key = String(name).split('/').pop();
      return Object.prototype.hasOwnProperty.call(raw, key) ? Promise.resolve(raw[key]) : Promise.reject(new Error('There is no data file called ' + key + ': add it under Data files.'));
    };
    d3.csv = function (name, row) { return lookup(name).then(function (t) { return d3.csvParse(t, row); }); };
    d3.tsv = function (name, row) { return lookup(name).then(function (t) { return d3.tsvParse(t, row); }); };
    d3.json = function (name) { return lookup(name).then(function (t) { return JSON.parse(t); }); };
    d3.text = function (name) { return lookup(name); };
    window.files = {};
    Object.keys(raw).forEach(function (name) { try { window.files[name] = parse(name, raw[name]); } catch (error) { console.warn(name + ': ' + error.message); } });
    window.data = (job.files || []).length ? window.files[job.files[0].name] : [];
    window.width = job.width;
    window.height = job.height;
    window.svg = d3.select(host).append('svg').attr('xmlns', 'http://www.w3.org/2000/svg').attr('width', job.width).attr('height', job.height).attr('viewBox', [0, 0, job.width, job.height].join(' '));
  `,
  anime: `
    Object.keys(anime).forEach(function (name) { if (!(name in window) || name === 'svg') window[name] = anime[name]; });
    window.width = job.width;
    window.height = job.height;
    host.style.width = job.width + 'px';
    host.style.height = job.height + 'px';
    // The stage keeps its size and is scaled to fit the frame.
    var fit = function () {
      var k = Math.min(innerWidth / job.width, innerHeight / job.height) || 1;
      host.style.transformOrigin = '0 0';
      host.style.transform = k < 1 ? 'scale(' + k + ')' : '';
    };
    if (!window.__fitting) { window.__fitting = true; addEventListener('resize', function () { fit(); }); }
    fit();
    window.stage = host;
  `,
};

/** The runner: console and errors back to the editor, the code run on request, snapshots of the drawing. */
export function runner(kind: FrameKind): string {
  return `(function () {
  var post = function (message) { parent.postMessage(message, '*'); };
  var show = function (value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return String(value.stack || value);
    try { var json = JSON.stringify(value); return json === undefined ? String(value) : json; } catch (error) { return String(value); }
  };
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    console[level] = function () { post({ type: 'log', level: level === 'debug' ? 'log' : level, text: Array.prototype.map.call(arguments, show).join(' ').slice(0, 4000) }); };
  });
  var lineOf = function (error) {
    var found = /code\\.js:(\\d+)/.exec(String(error && error.stack || ''));
    return found ? Math.max(0, Number(found[1]) - ${CODE_OFFSET}) : 0;
  };
  addEventListener('error', function (event) { post({ type: 'error', text: String(event.message || 'Error'), line: event.error ? lineOf(event.error) : 0 }); });
  addEventListener('unhandledrejection', function (event) { post({ type: 'error', text: 'Unhandled promise rejection: ' + show(event.reason && event.reason.message || event.reason), line: lineOf(event.reason) }); });
  addEventListener('message', function (event) {
    var job = event.data;
    if (event.source !== parent || !job) return;
    var host = document.getElementById('drawing');
    if (job.type === 'run') {
      try {
        host.innerHTML = '';
        ${PRELUDE[kind]}
        new Function(job.code + '\\n//# sourceURL=code.js')();
        post({ type: 'done' });
      } catch (error) {
        post({ type: 'error', text: String(error && error.message || error), line: lineOf(error) });
      }
    } else if (job.type === 'snapshot') {
      var svg = host.querySelector('svg'), markup = '';
      if (svg) markup = new XMLSerializer().serializeToString(svg);
      post({ type: 'snapshot', id: job.id, svg: markup });
    }
  });
  post({ type: 'ready' });
})();`;
}

const inline = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const LIBRARY_NAME: Readonly<Record<FrameKind, string>> = { d3: 'D3.js', anime: 'anime.js' };

/** The frame's whole page, with the library written into it. */
export function codeFrameHtml(kind: FrameKind, library: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">
<meta name="referrer" content="no-referrer">
<title>${LIBRARY_NAME[kind]} drawing</title>
<style>
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; font-family: system-ui, sans-serif; }
#drawing { position: relative; line-height: normal; overflow: hidden; }
#drawing > svg { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<div id="drawing"></div>
<script>${inline(library)}</script>
<script>${inline(runner(kind))}</script>
</body>
</html>
`;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A web page that runs the code on its own, library and data files inside it. */
export function standaloneCodePage(
  kind: FrameKind,
  code: string,
  library: string,
  options: { title: string; width: number; height: number; background: string; files?: readonly DataFile[]; licence?: string },
): string {
  const job = { type: 'run', width: Math.round(options.width), height: Math.round(options.height), files: options.files ?? [] };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Benchtop ${LIBRARY_NAME[kind]} Editor">
<title>${escapeHtml(options.title)}</title>
<style>
html, body { margin: 0; min-height: 100%; background: ${/^#[0-9a-f]{3,8}$/i.test(options.background) ? options.background : '#ffffff'}; font-family: system-ui, sans-serif; }
body { display: grid; place-items: center; min-height: 100vh; }
#drawing { position: relative; overflow: hidden; }
#drawing > svg { display: block; max-width: 100vw; max-height: 100vh; height: auto; }
</style>
</head>
<body>
<div id="drawing"></div>
<script>${inline(library)}</script>
<script>
(function () {
  var job = ${inline(JSON.stringify(job))};
  var host = document.getElementById('drawing');
  ${inline(PRELUDE[kind])}
})();
(function () {
${inline(code)}
})();
</script>
</body>
</html>
${options.licence ? `<!--\n${LIBRARY_NAME[kind]}\n\n${options.licence.replace(/--/g, '- -')}\n-->\n` : ''}`;
}

/** Data files: kept small, since they are stored with the tool and sent to the frame on every run. */
export const DATA_LIMIT = 2_000_000;

export function checkDataFile(name: string, text: string): string | null {
  if (!/\.(csv|tsv|json|geojson|topojson|txt)$/i.test(name)) return 'Data files must be CSV, TSV, JSON or text.';
  if (text.length > DATA_LIMIT) return `${name} is larger than 2 MB.`;
  return null;
}

/* ------------------------------------------------------------ examples -- */

export interface Example {
  readonly name: string;
  readonly code: string;
}

export const D3_FILES: readonly DataFile[] = [
  {
    name: 'fruit.csv',
    text: 'fruit,sold\nMango,62\nBanana,85\nGuava,38\nPapaya,27\nJackfruit,19\nPomegranate,44\n',
  },
  {
    name: 'rainfall.csv',
    text: `month,mm\n${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => `${m},${[3, 7, 17, 48, 118, 106, 108, 141, 195, 162, 64, 16][i]}`).join('\n')}\n`,
  },
  {
    name: 'network.json',
    text: JSON.stringify({
      nodes: ['Museum', 'Workshop', 'Gallery', 'Library', 'Store', 'Lab', 'Theatre', 'Café'].map((id, i) => ({ id, group: i % 3 })),
      links: [
        ['Museum', 'Workshop'],
        ['Museum', 'Gallery'],
        ['Museum', 'Library'],
        ['Workshop', 'Store'],
        ['Workshop', 'Lab'],
        ['Gallery', 'Theatre'],
        ['Gallery', 'Café'],
        ['Library', 'Lab'],
        ['Theatre', 'Café'],
      ].map(([source, target]) => ({ source, target })),
    }),
  },
];

export const D3_EXAMPLES: readonly Example[] = [
  {
    name: 'Bar chart from a CSV file',
    code: `// "data" is the first data file, already parsed; "svg" is an SVG of the size set above.
const margin = { top: 24, right: 20, bottom: 40, left: 52 };
const x = d3.scaleBand().domain(data.map((d) => d.fruit)).range([margin.left, width - margin.right]).padding(0.2);
const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d.sold)]).nice().range([height - margin.bottom, margin.top]);

svg.append('g').selectAll('rect').data(data).join('rect')
  .attr('x', (d) => x(d.fruit)).attr('width', x.bandwidth())
  .attr('y', y(0)).attr('height', 0).attr('fill', '#0072b2')
  .transition().duration(800).delay((d, i) => i * 80)
  .attr('y', (d) => y(d.sold)).attr('height', (d) => y(0) - y(d.sold));

svg.append('g').attr('transform', 'translate(0,' + (height - margin.bottom) + ')').call(d3.axisBottom(x));
svg.append('g').attr('transform', 'translate(' + margin.left + ',0)').call(d3.axisLeft(y));
`,
  },
  {
    name: 'Line chart with d3.csv',
    code: `// d3.csv reads one of the data files (there is no network here).
d3.csv('rainfall.csv', d3.autoType).then((rows) => {
  const margin = { top: 20, right: 24, bottom: 36, left: 52 };
  const x = d3.scalePoint().domain(rows.map((d) => d.month)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.mm)]).nice().range([height - margin.bottom, margin.top]);
  const line = d3.line().x((d) => x(d.month)).y((d) => y(d.mm)).curve(d3.curveMonotoneX);
  const area = d3.area().x((d) => x(d.month)).y0(y(0)).y1((d) => y(d.mm)).curve(d3.curveMonotoneX);

  svg.append('path').datum(rows).attr('d', area).attr('fill', '#56b4e9').attr('opacity', 0.35);
  const path = svg.append('path').datum(rows).attr('d', line).attr('fill', 'none').attr('stroke', '#0072b2').attr('stroke-width', 3);
  const length = path.node().getTotalLength();
  path.attr('stroke-dasharray', length).attr('stroke-dashoffset', length).transition().duration(1500).attr('stroke-dashoffset', 0);

  svg.append('g').attr('transform', 'translate(0,' + (height - margin.bottom) + ')').call(d3.axisBottom(x));
  svg.append('g').attr('transform', 'translate(' + margin.left + ',0)').call(d3.axisLeft(y).ticks(5));
  svg.append('text').attr('x', margin.left).attr('y', 14).text('Rainfall (mm)').attr('font-size', 13);
});
`,
  },
  {
    name: 'Force-directed network',
    code: `const graph = files['network.json'];
const nodes = graph.nodes.map((d) => ({ ...d }));
const links = graph.links.map((d) => ({ ...d }));
const colour = d3.scaleOrdinal(['#0072b2', '#e69f00', '#009e73']);

const link = svg.append('g').attr('stroke', '#999').selectAll('line').data(links).join('line').attr('stroke-width', 2);
const node = svg.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'grab');
node.append('circle').attr('r', 14).attr('fill', (d) => colour(d.group)).attr('stroke', '#fff').attr('stroke-width', 2);
node.append('text').text((d) => d.id).attr('x', 18).attr('y', 4).attr('font-size', 13);

const sim = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id((d) => d.id).distance(90))
  .force('charge', d3.forceManyBody().strength(-260))
  .force('centre', d3.forceCenter(width / 2, height / 2))
  .on('tick', () => {
    link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
    node.attr('transform', (d) => 'translate(' + d.x + ',' + d.y + ')');
  });

node.call(d3.drag()
  .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
  .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
  .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
`,
  },
  {
    name: 'Donut chart',
    code: `const radius = Math.min(width, height) / 2 - 20;
const pie = d3.pie().value((d) => d.sold).sort(null);
const arc = d3.arc().innerRadius(radius * 0.55).outerRadius(radius);
const colour = d3.scaleOrdinal(['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00']);
const g = svg.append('g').attr('transform', 'translate(' + width / 2 + ',' + height / 2 + ')');

g.selectAll('path').data(pie(data)).join('path')
  .attr('fill', (d) => colour(d.data.fruit)).attr('stroke', '#fff').attr('stroke-width', 2)
  .transition().duration(900)
  .attrTween('d', (d) => { const i = d3.interpolate({ startAngle: d.startAngle, endAngle: d.startAngle }, d); return (t) => arc(i(t)); });

g.selectAll('text').data(pie(data)).join('text')
  .attr('transform', (d) => 'translate(' + arc.centroid(d) + ')')
  .attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', '#fff')
  .text((d) => d.data.fruit);
`,
  },
  {
    name: 'Enter, update and exit',
    code: `// New random data every second: bars come in, change and leave with transitions.
const x = d3.scaleBand().range([40, width - 40]).padding(0.15);
const y = d3.scaleLinear().domain([0, 100]).range([height - 40, 30]);
const g = svg.append('g');

function update() {
  const n = 4 + Math.floor(Math.random() * 6);
  const values = d3.range(n).map((i) => ({ key: 'k' + i, v: 10 + Math.random() * 90 }));
  x.domain(values.map((d) => d.key));
  g.selectAll('rect').data(values, (d) => d.key).join(
    (enter) => enter.append('rect').attr('x', (d) => x(d.key)).attr('y', y(0)).attr('height', 0).attr('fill', '#009e73'),
    (change) => change,
    (exit) => exit.transition().duration(500).attr('y', y(0)).attr('height', 0).remove(),
  ).transition().duration(700)
    .attr('x', (d) => x(d.key)).attr('width', x.bandwidth())
    .attr('y', (d) => y(d.v)).attr('height', (d) => y(0) - y(d.v));
}
update();
d3.interval(update, 1500);
`,
  },
  {
    name: 'Tree of a hierarchy',
    code: `const root = d3.hierarchy({
  name: 'Museum', children: [
    { name: 'Galleries', children: [{ name: 'Science' }, { name: 'Industry' }, { name: 'Space' }] },
    { name: 'Workshops', children: [{ name: 'Wood' }, { name: 'Metal' }] },
    { name: 'Outreach', children: [{ name: 'Schools' }, { name: 'Mobile van' }, { name: 'Online' }] },
  ],
});
d3.tree().size([height - 60, width - 200])(root);
const g = svg.append('g').attr('transform', 'translate(80,30)');
g.selectAll('path').data(root.links()).join('path')
  .attr('fill', 'none').attr('stroke', '#999').attr('stroke-width', 1.5)
  .attr('d', d3.linkHorizontal().x((d) => d.y).y((d) => d.x));
const node = g.selectAll('g').data(root.descendants()).join('g').attr('transform', (d) => 'translate(' + d.y + ',' + d.x + ')');
node.append('circle').attr('r', 6).attr('fill', (d) => (d.children ? '#0072b2' : '#e69f00'));
node.append('text').text((d) => d.data.name).attr('x', (d) => (d.children ? -10 : 10)).attr('dy', 4)
  .attr('text-anchor', (d) => (d.children ? 'end' : 'start')).attr('font-size', 13);
`,
  },
];

export const ANIME_EXAMPLES: readonly Example[] = [
  {
    name: 'Staggered grid',
    code: `// "stage" is the drawing area; every anime.js function (animate, stagger, createTimeline…) is ready to use.
const cols = 12, rows = 7, gap = 6;
const size = Math.min((width - gap * (cols + 1)) / cols, (height - gap * (rows + 1)) / rows);
for (let i = 0; i < cols * rows; i++) {
  const dot = document.createElement('div');
  dot.className = 'dot';
  Object.assign(dot.style, {
    position: 'absolute', width: size + 'px', height: size + 'px', borderRadius: '50%', background: '#0072b2',
    left: gap + (i % cols) * (size + gap) + 'px', top: gap + Math.floor(i / cols) * (size + gap) + 'px',
  });
  stage.append(dot);
}
animate('.dot', {
  scale: [{ to: 0.2, ease: 'outSine', duration: 500 }, { to: 1, ease: 'inOutQuad', duration: 1100 }],
  backgroundColor: [{ to: '#e69f00' }, { to: '#0072b2' }],
  delay: stagger(90, { grid: [cols, rows], from: 'center' }),
  loop: true,
});
`,
  },
  {
    name: 'Drawing a line',
    code: `stage.innerHTML = '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">' +
  '<path class="line" fill="none" stroke="#009e73" stroke-width="6" stroke-linecap="round" d="M40 ' + height * 0.7 + ' C ' + width * 0.25 + ' 20, ' + width * 0.45 + ' 20, ' + width * 0.55 + ' ' + height * 0.5 + ' S ' + width * 0.85 + ' ' + height + ', ' + (width - 40) + ' ' + height * 0.3 + '"/>' +
  '</svg>';
animate(svg.createDrawable('.line'), {
  draw: ['0 0', '0 1', '1 1'],
  ease: 'inOutQuad',
  duration: 2400,
  loop: true,
});
`,
  },
  {
    name: 'Timeline',
    code: `const colours = ['#0072b2', '#e69f00', '#009e73', '#cc79a7'];
colours.forEach((colour, i) => {
  const box = document.createElement('div');
  box.className = 'box box' + i;
  Object.assign(box.style, { position: 'absolute', left: '40px', top: 40 + i * 70 + 'px', width: '56px', height: '56px', borderRadius: '10px', background: colour });
  stage.append(box);
});
createTimeline({ loop: true, alternate: true, defaults: { duration: 700, ease: 'outExpo' } })
  .add('.box0', { x: width - 140 })
  .add('.box1', { x: width - 140, rotate: 180 }, '-=400')
  .add('.box2', { x: width - 140, scale: 1.4 }, '-=400')
  .add('.box3', { x: width - 140, borderRadius: '50%' }, '-=400');
`,
  },
  {
    name: 'Along a path',
    code: `stage.innerHTML = '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">' +
  '<path id="route" fill="none" stroke="#999" stroke-width="2" stroke-dasharray="6 6" d="M80 ' + height / 2 + ' C 80 40, ' + (width - 80) + ' 40, ' + (width - 80) + ' ' + height / 2 + ' S 80 ' + (height - 40) + ', 80 ' + height / 2 + '"/>' +
  '<rect id="car" x="-18" y="-10" width="36" height="20" rx="6" fill="#d55e00"/>' +
  '</svg>';
animate('#car', {
  ease: 'linear',
  duration: 5000,
  loop: true,
  ...svg.createMotionPath('#route'),
});
`,
  },
  {
    name: 'Letters that bounce',
    code: `const title = document.createElement('h1');
title.textContent = 'Science is fun';
Object.assign(title.style, { position: 'absolute', inset: '0', margin: 'auto', height: 'fit-content', textAlign: 'center', font: '700 64px system-ui, sans-serif', color: '#0072b2' });
stage.append(title);
const { chars } = splitText(title, { chars: true });
animate(chars, {
  y: [{ to: '-2.5rem', ease: 'outExpo', duration: 600 }, { to: 0, ease: 'outBounce', duration: 800, delay: 100 }],
  rotate: { from: '-1turn', delay: 0 },
  delay: stagger(50),
  ease: 'inOutCirc',
  loopDelay: 1000,
  loop: true,
});
`,
  },
  {
    name: 'Springs and clicks',
    code: `const ball = document.createElement('div');
Object.assign(ball.style, { position: 'absolute', width: '70px', height: '70px', borderRadius: '50%', background: '#cc79a7', left: width / 2 - 35 + 'px', top: height / 2 - 35 + 'px', cursor: 'pointer' });
stage.append(ball);
const hint = document.createElement('p');
hint.textContent = 'Click anywhere';
Object.assign(hint.style, { position: 'absolute', left: '16px', top: '4px', color: '#666' });
stage.append(hint);
stage.addEventListener('click', (event) => {
  // The stage may be shown smaller than its size: turn the click into stage units.
  const box = stage.getBoundingClientRect();
  const px = ((event.clientX - box.left) * width) / box.width;
  const py = ((event.clientY - box.top) * height) / box.height;
  animate(ball, { x: px - width / 2, y: py - height / 2, ease: createSpring({ stiffness: 120, damping: 9 }) });
  console.log('To ' + Math.round(px) + ', ' + Math.round(py));
});
`,
  },
];
