/** HTML and CSS playground with Bootstrap 5 available offline and a resizable preview. */
import { sha384 } from '@noble/hashes/sha2.js';
import bootstrapCssRaw from 'bootstrap/dist/css/bootstrap.min.css?raw';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { toBase64, utf8Encode } from '../../lib/bytes';
import { copyText, saveFile } from '../../platform';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { FRAME_WIDTHS, type FrameWidth, PreviewFrame, Segmented, usePersistentState } from './_shared';

const BOOTSTRAP_VERSION = '5.3.9';
const BOOTSTRAP_CSS = bootstrapCssRaw.replace(/\/\*# sourceMappingURL=[^*]*\*\/\s*$/, '');
let integrity: string | undefined;
/** Subresource-integrity hash of the exact file published on npm (and served unchanged by jsDelivr). */
const bootstrapIntegrity = () => {
  integrity ??= `sha384-${toBase64(sha384(utf8Encode(bootstrapCssRaw)))}`;
  return integrity;
};

export const TEMPLATES: Record<string, { html: string; css: string }> = {
  'Bootstrap page': {
    html: `<nav class="navbar navbar-expand bg-body-tertiary border-bottom">
  <div class="container">
    <a class="navbar-brand" href="#">Field Notes</a>
    <ul class="navbar-nav ms-auto">
      <li class="nav-item"><a class="nav-link active" href="#">Home</a></li>
      <li class="nav-item"><a class="nav-link" href="#">Archive</a></li>
    </ul>
  </div>
</nav>

<main class="container py-5">
  <h1 class="display-6 fw-semibold">Notes from the workshop</h1>
  <p class="lead text-body-secondary">Edit the HTML and CSS on the left; the preview updates as you type.</p>
  <div class="row g-3 mt-2">
    <div class="col-md-4"><div class="card h-100"><div class="card-body"><h2 class="h5">Prototype</h2><p class="card-text">A first build of the light sensor.</p><a href="#" class="btn btn-primary btn-sm">Open</a></div></div></div>
    <div class="col-md-4"><div class="card h-100"><div class="card-body"><h2 class="h5">Testing</h2><p class="card-text">Readings across a day.</p><a href="#" class="btn btn-outline-primary btn-sm">Open</a></div></div></div>
    <div class="col-md-4"><div class="card h-100"><div class="card-body"><h2 class="h5">Install</h2><p class="card-text">Mounting it in the gallery.</p><span class="badge text-bg-success">Done</span></div></div></div>
  </div>
</main>`,
    css: `.navbar-brand {
  letter-spacing: 0.02em;
}

.card {
  transition: transform 0.15s ease;
}

.card:hover {
  transform: translateY(-2px);
}`,
  },
  'Sign-in form': {
    html: `<main class="d-flex align-items-center justify-content-center min-vh-100 bg-body-tertiary">
  <form class="card card-body shadow-sm signin">
    <h1 class="h4 mb-3">Sign in</h1>
    <div class="form-floating mb-2">
      <input type="email" class="form-control" id="email" placeholder="name@example.org">
      <label for="email">Email address</label>
    </div>
    <div class="form-floating mb-3">
      <input type="password" class="form-control" id="password" placeholder="Password">
      <label for="password">Password</label>
    </div>
    <div class="form-check mb-3">
      <input class="form-check-input" type="checkbox" id="remember">
      <label class="form-check-label" for="remember">Remember me</label>
    </div>
    <button class="btn btn-primary w-100" type="button">Sign in</button>
  </form>
</main>`,
    css: `.signin {
  width: min(100% - 2rem, 360px);
}`,
  },
  'Pricing cards': {
    html: `<div class="container py-5">
  <h1 class="text-center h3 mb-4">Plans</h1>
  <div class="row row-cols-1 row-cols-md-3 g-4 text-center">
    <div class="col"><div class="card h-100"><div class="card-header">Basic</div><div class="card-body"><p class="price">₹0</p><ul class="list-unstyled"><li>1 project</li><li>Community help</li></ul><button class="btn btn-outline-primary w-100" type="button">Start</button></div></div></div>
    <div class="col"><div class="card h-100 border-primary"><div class="card-header text-bg-primary">Team</div><div class="card-body"><p class="price">₹900</p><ul class="list-unstyled"><li>10 projects</li><li>Email help</li></ul><button class="btn btn-primary w-100" type="button">Choose</button></div></div></div>
    <div class="col"><div class="card h-100"><div class="card-header">Museum</div><div class="card-body"><p class="price">Ask us</p><ul class="list-unstyled"><li>Unlimited</li><li>On-site training</li></ul><button class="btn btn-outline-primary w-100" type="button">Contact</button></div></div></div>
  </div>
</div>`,
    css: `.price {
  font-size: 2rem;
  font-weight: 600;
}`,
  },
  Blank: { html: '<h1>Hello</h1>\n<p>Start writing HTML here.</p>', css: 'body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n}' },
};

interface Options {
  readonly bootstrap: boolean;
  readonly mode: 'light' | 'dark';
  readonly width: FrameWidth;
}

const isFullDocument = (html: string) => /<html[\s>]|<!doctype/i.test(html);

export function buildDocument(html: string, css: string, options: { bootstrap: boolean; mode: 'light' | 'dark' }, link: 'inline' | 'cdn'): string {
  const bootstrap = !options.bootstrap
    ? ''
    : link === 'inline'
      ? `<style>${BOOTSTRAP_CSS}</style>`
      : `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@${BOOTSTRAP_VERSION}/dist/css/bootstrap.min.css" integrity="${bootstrapIntegrity()}" crossorigin="anonymous">`;
  const own = css.trim() ? `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>` : '';
  const head = `${bootstrap}\n${own}`;
  if (isFullDocument(html)) {
    // Put the stylesheets at the start of the author's <head> so their own styles still win.
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => `${match}\n${head}`);
    return html.replace(/<html[^>]*>/i, (match) => `${match}\n<head>${head}</head>`);
  }
  return `<!doctype html>\n<html lang="en"${options.bootstrap ? ` data-bs-theme="${options.mode}"` : ''}>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Playground</title>\n${head}\n</head>\n<body>\n${html}\n</body>\n</html>\n`;
}

const session = { html: TEMPLATES['Bootstrap page']?.html ?? '', css: TEMPLATES['Bootstrap page']?.css ?? '' };

function HtmlPlayground({ toolId }: { toolId: string }) {
  const [options, setOptions] = usePersistentState<Options>(
    toolId,
    (stored: Values | undefined) => ({
      bootstrap: stored?.bootstrap !== false,
      mode: stored?.mode === 'dark' ? 'dark' : 'light',
      width: (['full', '992', '768', '390'] as const).includes(stored?.width as FrameWidth) ? (stored?.width as FrameWidth) : 'full',
    }),
    (o) => ({ ...o }),
  );
  // What you type stays in memory for this session only, like every other tool.
  const [html, setHtml] = useState(session.html);
  const [css, setCss] = useState(session.css);
  const [shown, setShown] = useState({ html, css });

  useEffect(() => {
    session.html = html;
    session.css = css;
    const timer = setTimeout(() => setShown({ html, css }), 250);
    return () => clearTimeout(timer);
  }, [html, css]);

  const preview = useMemo(() => buildDocument(shown.html, shown.css, options, 'inline'), [shown, options]);
  const scripts = /<script[\s>]/i.test(html);

  const save = (link: 'inline' | 'cdn') =>
    attempt(async () => {
      const saved = await saveFile(link === 'inline' ? 'page.html' : 'page-cdn.html', buildDocument(html, css, options, link), 'text/html;charset=utf-8');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });

  return (
    <section class="tool tool-playground" data-testid="tool" data-state="done">
      <div class="tool-options playground-toolbar">
        <label class="control">
          <span class="control-label">Start from</span>
          <select
            class="input"
            onChange={(event) => {
              const template = TEMPLATES[event.currentTarget.value];
              if (template) {
                setHtml(template.html);
                setCss(template.css);
              }
              event.currentTarget.value = '';
            }}
          >
            <option value="">Choose a template…</option>
            {Object.keys(TEMPLATES).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label class="toggle" for="pg-bootstrap">
          <input
            id="pg-bootstrap"
            type="checkbox"
            role="switch"
            aria-checked={options.bootstrap}
            checked={options.bootstrap}
            onChange={(event) => setOptions((previous) => ({ ...previous, bootstrap: event.currentTarget.checked }))}
          />
          <span class="toggle-track" aria-hidden="true" />
          <span>Bootstrap {BOOTSTRAP_VERSION}</span>
        </label>
        {options.bootstrap && (
          <Segmented
            label="Colour mode"
            value={options.mode}
            onChange={(mode) => setOptions((previous) => ({ ...previous, mode }))}
            choices={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        )}
        <Segmented label="Preview width" value={options.width} onChange={(width) => setOptions((previous) => ({ ...previous, width }))} choices={FRAME_WIDTHS} />
        <div class="tool-options-actions">
          <button
            type="button"
            class="button button-small"
            onClick={() =>
              attempt(async () => {
                await copyText(buildDocument(html, css, options, 'cdn'));
                notify('Copied the page');
              })
            }
          >
            <Icon name="copy" size={14} />
            Copy page
          </button>
          <button type="button" class="button button-small" onClick={() => save('cdn')} title="Links Bootstrap from the jsDelivr CDN, with an integrity hash">
            <Icon name="save" size={14} />
            Save (CDN link)
          </button>
          <button type="button" class="button button-small button-primary" onClick={() => save('inline')} title="Includes Bootstrap's CSS in the file, so it works offline">
            <Icon name="save" size={14} />
            Save (self-contained)
          </button>
        </div>
      </div>
      <div class="tool-work playground-editors">
        <div class="pane">
          <div class="pane-header">
            <span class="pane-title">HTML</span>
          </div>
          <div class="pane-body">
            <CodeEditor value={html} onChange={setHtml} language="html" label="HTML" testId="input-editor" />
          </div>
        </div>
        <div class="pane">
          <div class="pane-header">
            <span class="pane-title">CSS</span>
          </div>
          <div class="pane-body">
            <CodeEditor value={css} onChange={setCss} language="css" label="CSS" testId="input2-editor" />
          </div>
        </div>
      </div>
      {scripts && <p class="status status-warn">Scripts do not run in the preview. Bootstrap's styles work; its interactive parts (dropdowns, modals) need its JavaScript in your real page.</p>}
      <PreviewFrame html={preview} width={options.width} title="Playground preview" />
    </section>
  );
}

export default defineCustomTool(HtmlPlayground);
