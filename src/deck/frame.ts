/**
 * The Slide Deck tool's preview: a page of its own (deck.html) shown in a
 * frame, so reveal.js runs as a full-page presentation, exactly as in a
 * saved deck, and its stylesheets cannot touch the app.  The tool drives it
 * through `window.benchtopDeck`, which is reachable because the page comes
 * from the app itself.
 */
import Reveal, { type RevealApi } from 'reveal.js';
import RevealMarkdown from 'reveal.js/plugin/markdown';
import { type DeckOptions, hasCode, NOTES_SEPARATOR, printPageSize, revealConfig, SEPARATOR, stripRemoteImports, VERTICAL_SEPARATOR } from '../lib/slides';
import { codeCss, revealCss, themeCss } from './assets';

export interface SlideInfo {
  readonly h: number;
  readonly v: number;
  /** 1-based position counting every slide, and the number of slides. */
  readonly index: number;
  readonly total: number;
  /** The speaker notes of the slide, as HTML (empty when there are none). */
  readonly notes: string;
}

export interface DeckFrameApi {
  render(markdown: string, options: DeckOptions, position?: { h: number; v: number }): Promise<void>;
  slideTo(h: number, v: number): void;
  focus(): void;
  /** The deck laid out one slide per page, as a page with no scripts, for printing. */
  snapshot(markdown: string, options: DeckOptions): Promise<{ html: string; width: number; height: number }>;
  onSlide: ((info: SlideInfo) => void) | null;
  onError: ((message: string) => void) | null;
}

declare global {
  interface Window {
    benchtopDeck?: DeckFrameApi;
  }
}

const style = (id: string) => {
  const element = document.createElement('style');
  element.id = id;
  document.head.append(element);
  return element;
};
const baseStyle = style('deck-base');
const themeStyle = style('deck-theme');
const codeStyle = style('deck-code');

let deck: RevealApi | null = null;
let generation = 0;
let highlight: Promise<typeof import('reveal.js/plugin/highlight')['default']> | null = null;

/** A fresh .reveal element: reveal.js keeps state on the old one. */
function freshRoot(): HTMLElement {
  for (const old of document.querySelectorAll('.reveal')) old.remove();
  const root = document.createElement('div');
  root.className = 'reveal';
  const slides = document.createElement('div');
  slides.className = 'slides';
  root.append(slides);
  document.body.prepend(root);
  return root;
}

function markdownSection(markdown: string): HTMLElement {
  const section = document.createElement('section');
  section.setAttribute('data-markdown', '');
  section.setAttribute('data-separator', SEPARATOR);
  section.setAttribute('data-separator-vertical', VERTICAL_SEPARATOR);
  section.setAttribute('data-separator-notes', NOTES_SEPARATOR);
  const template = document.createElement('textarea');
  template.setAttribute('data-template', '');
  template.textContent = markdown;
  section.append(template);
  return section;
}

function report(): void {
  if (!deck || !api.onSlide) return;
  const { h, v } = deck.getIndices();
  api.onSlide({ h, v, index: deck.getSlidePastCount() + 1, total: deck.getTotalSlides(), notes: deck.getSlideNotes() ?? '' });
}

async function build(markdown: string, options: DeckOptions, print: boolean): Promise<RevealApi | null> {
  const run = ++generation;
  const code = hasCode(markdown);
  if (code) highlight ??= import('reveal.js/plugin/highlight').then((m) => m.default);
  const [base, theme, codeTheme, highlighter] = await Promise.all([
    revealCss(),
    themeCss(options.theme),
    code ? codeCss(options.codeTheme) : Promise.resolve(''),
    code ? highlight : Promise.resolve(null),
  ]);
  if (run !== generation) return null;
  baseStyle.textContent = base;
  themeStyle.textContent = stripRemoteImports(theme);
  codeStyle.textContent = codeTheme;
  if (deck) {
    try {
      deck.destroy();
    } catch {
      // A deck that never finished starting has nothing to undo.
    }
    deck = null;
  }
  const root = freshRoot();
  (root.querySelector('.slides') as HTMLElement).append(markdownSection(markdown));
  const plugins = highlighter ? [RevealMarkdown, highlighter] : [RevealMarkdown];
  const created = new Reveal(root, { ...revealConfig(options, print), plugins });
  deck = created;
  await created.initialize();
  return run === generation ? created : null;
}

const api: DeckFrameApi = {
  onSlide: null,
  onError: null,
  async render(markdown, options, position) {
    const keep = position ?? (deck?.isReady() ? deck.getIndices() : { h: 0, v: 0 });
    try {
      const created = await build(markdown, options, false);
      if (!created) return;
      created.on('slidechanged', report);
      created.on('fragmentshown', report);
      created.slide(keep.h, keep.v);
      report();
    } catch (error) {
      api.onError?.(error instanceof Error ? error.message : String(error));
    }
  },
  slideTo(h, v) {
    if (!deck?.isReady()) return;
    const now = deck.getIndices();
    if (now.h !== h || now.v !== v) deck.slide(h, v);
  },
  focus() {
    window.focus();
    (document.querySelector('.reveal') as HTMLElement | null)?.focus();
  },
  async snapshot(markdown, options) {
    const ready = new Promise<void>((resolve) => document.addEventListener('pdf-ready', () => resolve(), { once: true, capture: true }));
    const created = await build(markdown, options, true);
    if (!created) throw new Error('The deck changed while it was being laid out.');
    await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 8000))]);
    await document.fonts?.ready;
    const copy = document.documentElement.cloneNode(true) as HTMLElement;
    for (const script of copy.querySelectorAll('script')) script.remove();
    return { html: `<!doctype html>\n${copy.outerHTML}`, ...printPageSize(options) };
  },
};

// The preview is for looking, not browsing: links in slides stay put.
document.addEventListener(
  'click',
  (event) => {
    const link = (event.target as Element | null)?.closest?.('a[href]');
    if (link && !(link.getAttribute('href') ?? '').startsWith('#')) event.preventDefault();
  },
  true,
);

window.benchtopDeck = api;
