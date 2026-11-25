/**
 * The SVG.js editor's drawing frame: a page of its own that holds the SVG.js
 * library and runs the code typed into the editor.  It is shown in a
 * sandboxed frame, so the code has a real page to draw on (animation and
 * clicks work) but no way to reach the app, its storage or the network.
 * The build writes it to public/svgjs/frame.html.
 */

/** What the frame's page may load: nothing from anywhere, only what is written into it. */
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

/** Lines the frame puts before the first line of the code it runs (for error line numbers). */
export const CODE_OFFSET = 2;

/**
 * The script that runs in the frame beside SVG.js: it takes code from the
 * editor, runs it with `draw` (a drawing of the wanted size), and reports
 * console output, errors and the finished SVG back.
 */
export const RUNNER = `(function () {
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
    var found = /drawing\\.js:(\\d+)/.exec(String(error && error.stack || ''));
    if (found) return Math.max(0, Number(found[1]) - ${CODE_OFFSET});
    return error && typeof error.line === 'number' ? Math.max(0, error.line - ${CODE_OFFSET}) : 0;
  };
  addEventListener('error', function (event) { post({ type: 'error', text: String(event.message || 'Error'), line: event.error ? lineOf(event.error) : 0 }); });
  addEventListener('unhandledrejection', function (event) { post({ type: 'error', text: 'Unhandled promise rejection: ' + show(event.reason), line: lineOf(event.reason) }); });
  var drawing = function () {
    var all = document.querySelectorAll('svg');
    for (var i = 0; i < all.length; i++) if (all[i].childNodes.length && !all[i].closest('svg svg')) return all[i];
    return all[0] || null;
  };
  addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== parent || !data) return;
    if (data.type === 'run') {
      window.width = data.width;
      window.height = data.height;
      try {
        window.draw = SVG().addTo('#drawing').size(data.width, data.height).viewbox(0, 0, data.width, data.height);
        new Function(data.code + '\\n//# sourceURL=drawing.js')();
        post({ type: 'done' });
      } catch (error) {
        post({ type: 'error', text: String(error && error.message || error), line: lineOf(error) });
      }
    } else if (data.type === 'snapshot') {
      var svg = drawing(), markup = '';
      if (svg) { try { markup = SVG(svg).svg(); } catch (error) { markup = new XMLSerializer().serializeToString(svg); } }
      post({ type: 'snapshot', id: data.id, svg: markup, width: svg ? svg.getAttribute('width') : null, height: svg ? svg.getAttribute('height') : null });
    }
  });
  post({ type: 'ready' });
})();`;

/** @param {string} code */
const inline = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

/**
 * The frame's whole page, with the SVG.js library written into it.
 *
 * @param {string} library The SVG.js browser build.
 * @returns {string}
 */
export function frameHtml(library) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">
<meta name="referrer" content="no-referrer">
<title>SVG.js drawing</title>
<style>
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; font-family: system-ui, sans-serif; }
#drawing { line-height: 0; }
#drawing > svg { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<div id="drawing"></div>
<script>${inline(library)}</script>
<script>${inline(RUNNER)}</script>
</body>
</html>
`;
}
