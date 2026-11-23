/**
 * Slide Deck: presentations in Markdown with reveal.js.  The editor sits
 * beside a live preview (reveal.js itself, in a frame of its own), the slide
 * under the cursor follows along, and the deck saves as one HTML file that
 * presents offline, as Markdown, or as a PDF with one slide per page.
 */
import { EditorView } from '@codemirror/view';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DeckFrameApi, SlideInfo } from '../../deck/frame';
import { extractMath, type MathRenderer } from '../../lib/markdown-doc';
import {
  CODE_THEMES,
  countSlides,
  type DeckOptions,
  type DeckSize,
  deckHtml,
  deckTitle,
  hasCode,
  readDeckFile,
  readOptions,
  SAMPLE_DECK,
  SIZES,
  slideAt,
  THEME_LABELS,
  THEMES,
  TRANSITIONS,
} from '../../lib/slides';
import { htmlToPdf, isDesktop, pickFiles, saveFile } from '../../platform';
import { CodeEditor } from '../../ui/CodeEditor';
import { dataUrlChips, insertText, prefixLines, wrapSelection } from '../../ui/editor-extras';
import { Icon } from '../../ui/icons';
import { printDocument } from '../../ui/print';
import { sanitizeHtml } from '../../ui/sanitize';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';
import { loadTex } from './doc-tools';

interface DeckState {
  readonly markdown: string;
  readonly options: DeckOptions;
}

/** Bigger decks (pictures add up) are not kept between sessions; they belong in a file. */
const MAX_DRAFT = 200_000;

const readDeck = (v: Values | undefined): DeckState => ({
  markdown: typeof v?.markdown === 'string' ? v.markdown : SAMPLE_DECK,
  options: readOptions(v?.options),
});
const writeDeck = (s: DeckState): Values => ({ markdown: s.markdown.length > MAX_DRAFT ? '' : s.markdown, options: s.options });

const TRANSITION_LABELS: Record<(typeof TRANSITIONS)[number], string> = { slide: 'Slide', fade: 'Fade', convex: 'Convex', concave: 'Concave', zoom: 'Zoom', none: 'None' };

interface Action {
  readonly label: string;
  readonly title: string;
  readonly run: (view: EditorView) => void;
}

const ACTIONS: readonly Action[] = [
  { label: 'New slide', title: 'Start a new slide (--- on its own line)', run: (v) => insertText(v, '\n\n---\n\n## ') },
  { label: 'Slide below', title: 'Add a slide below this one (-- on its own line)', run: (v) => insertText(v, '\n\n--\n\n## ') },
  { label: 'Notes', title: 'Speaker notes for this slide (shown only to you)', run: (v) => insertText(v, '\n\nNote: ') },
  { label: 'Step', title: 'Show this line one step at a time (a fragment)', run: (v) => insertText(v, ' <!-- .element: class="fragment" -->') },
  { label: 'B', title: 'Bold', run: (v) => wrapSelection(v, '**', '**', 'bold text') },
  { label: 'I', title: 'Italic', run: (v) => wrapSelection(v, '_', '_', 'italic text') },
  { label: '•', title: 'Bulleted list', run: (v) => prefixLines(v, '- ') },
  { label: '{ }', title: 'Code block', run: (v) => wrapSelection(v, '\n```js\n', '\n```\n', 'code') },
  { label: '√x', title: 'Maths in the line ($…$)', run: (v) => wrapSelection(v, '$', '$', 'E = mc^2') },
  { label: 'Background', title: 'Background colour for this slide', run: (v) => insertText(v, '\n<!-- .slide: data-background-color="#0d1117" -->\n') },
];

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The tooltip is the spoken name when it contains the visible text (or the button shows only a symbol). */
const spokenName = (label: string, title: string) => {
  const visible = words(label);
  return !visible || words(title).includes(visible) ? title : undefined;
};

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'slides';
const safeName = (text: string) =>
  text
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'slides';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Maths drawn as inline SVG sized in em, so it scales with the slide's text
 * and takes the theme's colour (an SVG in an <img> would always be black).
 */
function withMath(markdown: string, render: MathRenderer | undefined): string {
  if (!render || !markdown.includes('$')) return markdown;
  const { text, math } = extractMath(markdown);
  return text.replace(/M(\d+)/g, (_, i: string) => {
    const item = math[Number(i)];
    if (!item) return '';
    const r = render(item.tex, item.display) as ReturnType<MathRenderer> & { width?: number; height?: number };
    if (r.error) return `<code title="${r.error.replace(/"/g, '&quot;')}">${item.tex.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`;
    const em = (px: number | undefined) => `${((px ?? 0) / 24).toFixed(3)}em`;
    const svg = r.svg
      .replace(/ width="[\d.]+"/, ` width="${em(r.width)}"`)
      .replace(/ height="[\d.]+"/, ` height="${em(r.height)}"`)
      .replace('<svg', item.display ? '<svg style="display:block;margin:0.3em auto"' : `<svg style="vertical-align:-${em(r.depth)}"`)
      .replace(/\n/g, ' ');
    return item.display ? `<div class="math-display">${svg}</div>` : svg;
  });
}

const sizeLabel = (size: DeckSize) => `${size} (${SIZES[size][0]} × ${SIZES[size][1]})`;

function SlideDeck({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readDeck, writeDeck);
  const [name, setName] = useState('');
  const [slide, setSlide] = useState<SlideInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mathReady, setMathReady] = useState(0);
  const view = useRef<EditorView | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const api = useRef<DeckFrameApi | null>(null);
  const math = useRef<MathRenderer | undefined>(undefined);
  const follow = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;

  // MathJax loads the first time a $ appears.
  useEffect(() => {
    if (math.current || !state.markdown.includes('$')) return;
    let live = true;
    void loadTex().then(({ texToSvg }) => {
      if (!live) return;
      const cache = new Map<string, ReturnType<MathRenderer>>();
      math.current = (tex, display) => {
        const key = `${display ? 'D' : 'I'}${tex}`;
        let r = cache.get(key);
        if (!r) {
          r = texToSvg(tex, { display, scale: 24 });
          if (cache.size > 500) cache.clear();
          cache.set(key, r);
        }
        return r;
      };
      setMathReady((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [state.markdown.includes('$')]);

  const prepared = useMemo(() => withMath(state.markdown, math.current), [state.markdown, mathReady]);

  const connect = () => {
    const target = frame.current?.contentWindow?.benchtopDeck;
    if (!target) return;
    api.current = target;
    target.onSlide = (info) => {
      setSlide(info);
      setProblem(null);
    };
    target.onError = (message) => setProblem(message);
    void target.render(withMath(stateRef.current.markdown, math.current), stateRef.current.options);
  };

  // The preview follows the text after a short pause in typing.
  useEffect(() => {
    const target = api.current;
    if (!target) return;
    const timer = setTimeout(() => void target.render(prepared, state.options), 350);
    return () => clearTimeout(timer);
  }, [prepared, state.options]);

  const cursorSync = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet || !follow.current) return;
        const { h, v } = slideAt(update.state.doc.toString(), update.state.selection.main.head);
        api.current?.slideTo(h, v);
      }),
    [],
  );
  const extensions = useMemo(() => [dataUrlChips, cursorSync], [cursorSync]);

  const setOption = <K extends keyof DeckOptions>(key: K, value: DeckOptions[K]) => setState((s) => ({ ...s, options: { ...s.options, [key]: value } }));

  const openFile = async (file: File) => {
    if (/^image\//.test(file.type)) return embedPictures([file]);
    const { markdown, options } = readDeckFile(await file.text(), file.name);
    setState((s) => ({ markdown, options: options ?? s.options }));
    setName(file.name);
    notify(`Opened ${file.name}`);
  };

  const embedPictures = async (files: File[]) => {
    const parts: string[] = [];
    for (const file of files) {
      if (!/^image\//.test(file.type) && !/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file.name)) continue;
      if (file.size > 8 * 1024 * 1024) {
        notify(`${file.name} is larger than 8 MB; make it smaller first (Image Resizer) so the deck stays quick to edit.`, 'error');
        continue;
      }
      parts.push(`![${file.name.replace(/\.[^.]+$/, '')}](${await readAsDataUrl(file)})`);
    }
    if (!parts.length) return;
    const text = `\n${parts.join('\n\n')}\n`;
    if (view.current) insertText(view.current, text);
    else setState((s) => ({ ...s, markdown: s.markdown + text }));
  };

  const baseName = () => (name ? stem(name) : safeName(deckTitle(state.markdown)));

  const exportHtml = () =>
    attempt(async () => {
      setBusy('html');
      try {
        const { deckAssets } = await import('../../deck/assets');
        // The Markdown as written (maths as TeX) travels in the file too, so it opens again for editing.
        const page = deckHtml(prepared, state.options, await deckAssets(state.options, hasCode(state.markdown)), deckTitle(state.markdown), state.markdown);
        const outcome = await saveFile(`${baseName()}.html`, page, 'text/html');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      } finally {
        setBusy(null);
      }
    });

  const exportMarkdown = () =>
    attempt(async () => {
      const outcome = await saveFile(`${baseName()}.md`, state.markdown, 'text/markdown');
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });

  const exportPdf = () =>
    attempt(async () => {
      setBusy('pdf');
      const printer = document.createElement('iframe');
      try {
        // A second, hidden preview lays the deck out one slide per page.
        printer.title = 'Print layout';
        printer.setAttribute('aria-hidden', 'true');
        printer.tabIndex = -1;
        // In view but transparent: browsers slow down animation frames in frames out of view, and reveal.js lays out pages on them.
        printer.style.cssText = 'position:fixed;left:0;top:0;width:1400px;height:900px;border:0;opacity:0;pointer-events:none;z-index:-1';
        const loaded = new Promise<void>((resolve) => printer.addEventListener('load', () => resolve(), { once: true }));
        printer.src = './deck.html';
        document.body.append(printer);
        await loaded;
        const printApi = printer.contentWindow?.benchtopDeck;
        if (!printApi) throw new Error('The print layout could not start.');
        const { html, width, height } = await printApi.snapshot(prepared, state.options);
        if (!isDesktop) {
          printDocument(html);
          return;
        }
        const outcome = await saveFile(`${baseName()}.pdf`, await htmlToPdf(html, { paper: `${width}x${height}px` }), 'application/pdf');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      } finally {
        printer.remove();
        setBusy(null);
      }
    });

  const present = () =>
    attempt(async () => {
      const target = frame.current;
      if (!target) return;
      if (!target.requestFullscreen) throw new Error('Full screen is not available here; save the deck as HTML and open it in a browser to present.');
      await target.requestFullscreen();
      api.current?.focus();
    });

  const total = useMemo(() => countSlides(state.markdown), [state.markdown]);
  const [width, height] = SIZES[state.options.size];
  const notes = useMemo(() => (slide?.notes ? sanitizeHtml(slide.notes) : ''), [slide?.notes]);

  return (
    <section class="tool deck-tool" data-testid="tool" data-state={slide ? 'done' : 'idle'}>
      <div class="button-row deck-files">
        <button
          type="button"
          class="button button-small"
          onClick={() =>
            attempt(async () => {
              const [file] = await pickFiles('.md,.markdown,.txt,.html,.htm,text/markdown,text/html');
              if (file) await openFile(file);
            })
          }
          data-testid="deck-open"
        >
          <Icon name="open" size={15} /> Open
        </button>
        <button
          type="button"
          class="button button-small button-quiet"
          onClick={() => {
            setState((s) => ({ ...s, markdown: SAMPLE_DECK }));
            setName('');
          }}
        >
          <Icon name="sample" size={15} /> Sample
        </button>
        <button
          type="button"
          class="button button-small button-quiet"
          onClick={() => {
            setState((s) => ({ ...s, markdown: '# Title\n\n---\n\n## ' }));
            setName('');
          }}
        >
          <Icon name="plus" size={15} /> New
        </button>
        <span class="deck-export" role="group" aria-label="Save">
          <span class="control-label">Save as</span>
          <button type="button" class="button button-small" disabled={busy !== null} onClick={exportHtml} data-testid="deck-html">
            Presentation (HTML)
          </button>
          <button type="button" class="button button-small" disabled={busy !== null} onClick={exportPdf} data-testid="deck-pdf">
            PDF
          </button>
          <button type="button" class="button button-small" disabled={busy !== null} onClick={exportMarkdown} data-testid="deck-md">
            Markdown
          </button>
          <button type="button" class="button button-small button-primary" onClick={present} data-testid="deck-present">
            <Icon name="play" size={14} /> Present
          </button>
        </span>
      </div>
      <div class="deck-options" role="group" aria-label="Deck settings">
        <label class="deck-option">
          <span class="control-label">Theme</span>
          <select class="select select-small" value={state.options.theme} onChange={(e) => setOption('theme', readOptions({ theme: e.currentTarget.value }).theme)} data-testid="deck-theme">
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {THEME_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label class="deck-option">
          <span class="control-label">Transition</span>
          <select class="select select-small" value={state.options.transition} onChange={(e) => setOption('transition', readOptions({ transition: e.currentTarget.value }).transition)}>
            {TRANSITIONS.map((t) => (
              <option key={t} value={t}>
                {TRANSITION_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label class="deck-option">
          <span class="control-label">Size</span>
          <select class="select select-small" value={state.options.size} onChange={(e) => setOption('size', readOptions({ size: e.currentTarget.value }).size)}>
            {(Object.keys(SIZES) as DeckSize[]).map((s) => (
              <option key={s} value={s}>
                {sizeLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label class="deck-option">
          <span class="control-label">Code colours</span>
          <select class="select select-small" value={state.options.codeTheme} onChange={(e) => setOption('codeTheme', readOptions({ codeTheme: e.currentTarget.value }).codeTheme)}>
            {CODE_THEMES.map((t) => (
              <option key={t} value={t}>
                {t === 'monokai' ? 'Monokai' : 'Zenburn'}
              </option>
            ))}
          </select>
        </label>
        <label class="deck-option">
          <span class="control-label">Advance every</span>
          <input
            type="number"
            class="input input-number deck-seconds"
            min={0}
            max={600}
            value={state.options.autoSlide}
            onChange={(e) => setOption('autoSlide', readOptions({ autoSlide: Number(e.currentTarget.value) }).autoSlide)}
            aria-describedby="deck-seconds-help"
          />
          <span id="deck-seconds-help" class="tone-muted">
            s (0 = by hand)
          </span>
        </label>
        {(
          [
            ['slideNumber', 'Slide numbers'],
            ['progress', 'Progress bar'],
            ['controls', 'Arrows'],
            ['center', 'Centre vertically'],
            ['loop', 'Loop'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} class="check">
            <input type="checkbox" checked={state.options[key]} onChange={(e) => setOption(key, e.currentTarget.checked)} /> {label}
          </label>
        ))}
      </div>
      <div class="pane-header deck-toolbar" role="toolbar" aria-label="Insert">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            class="button button-small md-tool-button"
            title={a.title}
            aria-label={spokenName(a.label, a.title)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => view.current && a.run(view.current)}
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          class="button button-small md-tool-button"
          title="Insert pictures (they are embedded in the deck)"
          onClick={() => attempt(async () => embedPictures(await pickFiles('image/*')))}
        >
          <Icon name="image" size={14} /> Picture
        </button>
        <label class="check deck-follow">
          <input
            type="checkbox"
            defaultChecked
            onChange={(e) => {
              follow.current = e.currentTarget.checked;
            }}
          />{' '}
          Preview follows the cursor
        </label>
      </div>
      <div class="deck-layout">
        <div
          class="pane deck-editor"
          onPasteCapture={(e) => {
            const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
            if (files.length) {
              e.preventDefault();
              void attempt(() => embedPictures(files));
            }
          }}
          onDropCapture={(e) => {
            const files = [...(e.dataTransfer?.files ?? [])];
            if (files.some((f) => f.type.startsWith('image/'))) {
              e.preventDefault();
              e.stopPropagation();
              void attempt(() => embedPictures(files));
            } else if (files[0]) {
              e.preventDefault();
              e.stopPropagation();
              void attempt(() => openFile(files[0] as File));
            }
          }}
        >
          <div class="pane-body">
            <CodeEditor
              value={state.markdown}
              onChange={(markdown) => setState((s) => ({ ...s, markdown }))}
              language="markdown"
              wrap
              label="Slides in Markdown"
              testId="deck-editor"
              viewRef={view}
              extensions={extensions}
              placeholder="Write slides in Markdown, with --- on its own line between slides"
            />
          </div>
        </div>
        <div class="deck-side">
          <div class="deck-stage" style={{ aspectRatio: `${width} / ${height}` }}>
            <iframe ref={frame} src="./deck.html" title="Slide preview" class="deck-frame" allow="fullscreen" onLoad={connect} data-testid="deck-frame" />
          </div>
          <div class="deck-status tone-muted" aria-live="polite" data-testid="deck-status">
            {problem ? (
              <span class="tone-error">{problem}</span>
            ) : slide ? (
              <>
                Slide {slide.index} of {slide.total}
              </>
            ) : (
              <>
                {total} {total === 1 ? 'slide' : 'slides'}
              </>
            )}
            {busy && <span> · Saving {busy.toUpperCase()}…</span>}
            {state.markdown.length > MAX_DRAFT && <span> · Too large to keep between sessions; save it as a file.</span>}
          </div>
          <div class="deck-notes" data-testid="deck-notes">
            <span class="control-label">Speaker notes</span>
            {notes ? <div class="prose deck-notes-text" dangerouslySetInnerHTML={{ __html: notes }} /> : <p class="tone-muted">This slide has no notes. Start a line with “Note:” to add some.</p>}
          </div>
          <p class="control-help">
            Click the preview and use the arrow keys, Space, O for an overview or F for full screen. The saved HTML file presents in any browser, offline; press S there for the speaker view with notes
            and a timer.
          </p>
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(SlideDeck);
