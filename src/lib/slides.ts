/**
 * Slide decks for the Slide Deck tool: reveal.js presentations written in
 * Markdown, with --- on its own line between slides, -- for a slide below
 * the current one and "Note:" before speaker notes (reveal.js's own Markdown
 * conventions, so decks move freely between Benchtop and reveal.js).  A deck
 * is saved as one HTML file that carries reveal.js itself and runs offline.
 */

export const THEMES = ['black', 'white', 'league', 'beige', 'night', 'serif', 'simple', 'solarized', 'moon', 'dracula', 'sky', 'blood', 'black-contrast', 'white-contrast'] as const;
export type DeckTheme = (typeof THEMES)[number];

export const THEME_LABELS: Record<DeckTheme, string> = {
  black: 'Black',
  white: 'White',
  league: 'League',
  beige: 'Beige',
  night: 'Night',
  serif: 'Serif',
  simple: 'Simple',
  solarized: 'Solarized',
  moon: 'Moon',
  dracula: 'Dracula',
  sky: 'Sky',
  blood: 'Blood',
  'black-contrast': 'Black (high contrast)',
  'white-contrast': 'White (high contrast)',
};

export const TRANSITIONS = ['slide', 'fade', 'convex', 'concave', 'zoom', 'none'] as const;
export type DeckTransition = (typeof TRANSITIONS)[number];

/** Slide sizes in CSS pixels; reveal.js scales them to fit the screen. */
export const SIZES = { '16:9': [1280, 720], '4:3': [1024, 768], '16:10': [1280, 800] } as const;
export type DeckSize = keyof typeof SIZES;

export const CODE_THEMES = ['monokai', 'zenburn'] as const;
export type CodeTheme = (typeof CODE_THEMES)[number];

export interface DeckOptions {
  readonly theme: DeckTheme;
  readonly transition: DeckTransition;
  readonly size: DeckSize;
  readonly slideNumber: boolean;
  readonly progress: boolean;
  readonly controls: boolean;
  readonly center: boolean;
  readonly loop: boolean;
  /** Seconds per slide when presenting on its own; 0 waits for the presenter. */
  readonly autoSlide: number;
  readonly codeTheme: CodeTheme;
}

export const DEFAULT_OPTIONS: DeckOptions = {
  theme: 'black',
  transition: 'slide',
  size: '16:9',
  slideNumber: true,
  progress: true,
  controls: true,
  center: true,
  loop: false,
  autoSlide: 0,
  codeTheme: 'monokai',
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);
const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

/** Options from storage or a file, with anything unknown replaced by the default. */
export function readOptions(value: unknown): DeckOptions {
  const o = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const seconds = typeof o.autoSlide === 'number' && Number.isFinite(o.autoSlide) ? Math.min(600, Math.max(0, Math.round(o.autoSlide))) : 0;
  return {
    theme: pick(o.theme, THEMES, DEFAULT_OPTIONS.theme),
    transition: pick(o.transition, TRANSITIONS, DEFAULT_OPTIONS.transition),
    size: pick(o.size, Object.keys(SIZES) as DeckSize[], DEFAULT_OPTIONS.size),
    slideNumber: flag(o.slideNumber, DEFAULT_OPTIONS.slideNumber),
    progress: flag(o.progress, DEFAULT_OPTIONS.progress),
    controls: flag(o.controls, DEFAULT_OPTIONS.controls),
    center: flag(o.center, DEFAULT_OPTIONS.center),
    loop: flag(o.loop, DEFAULT_OPTIONS.loop),
    autoSlide: seconds,
    codeTheme: pick(o.codeTheme, CODE_THEMES, DEFAULT_OPTIONS.codeTheme),
  };
}

/* Separators, as regular expressions for reveal.js's Markdown plugin. */
export const SEPARATOR = '\\r?\\n---\\r?\\n';
export const VERTICAL_SEPARATOR = '\\r?\\n--\\r?\\n';
export const NOTES_SEPARATOR = '^Note:';

/** The reveal.js settings for a deck.  `print` lays every slide out as a page. */
export function revealConfig(options: DeckOptions, print = false): Record<string, unknown> {
  const [width, height] = SIZES[options.size];
  return {
    width,
    height,
    margin: 0.04,
    transition: options.transition,
    slideNumber: options.slideNumber ? 'c/t' : false,
    progress: options.progress,
    controls: options.controls,
    center: options.center,
    loop: options.loop,
    autoSlide: options.autoSlide > 0 ? options.autoSlide * 1000 : 0,
    hash: false,
    history: false,
    respondToHashChanges: false,
    ...(print ? { view: 'print', pdfSeparateFragments: false, showNotes: false } : {}),
  };
}

/** The size of each page when the deck is printed: the slide plus reveal.js's margin. */
export function printPageSize(options: DeckOptions): { width: number; height: number } {
  const [width, height] = SIZES[options.size];
  return { width: Math.floor(width * 1.04), height: Math.floor(height * 1.04) };
}

const SPLIT = new RegExp(`${SEPARATOR}|${VERTICAL_SEPARATOR}`, 'g');
const HORIZONTAL = new RegExp(`^${SEPARATOR}$`);

/** Slides as they will be shown: [horizontal index][vertical index] = Markdown. */
export function splitSlides(markdown: string): string[][] {
  const stacks: string[][] = [[]];
  let start = 0;
  for (const match of markdown.matchAll(SPLIT)) {
    (stacks[stacks.length - 1] as string[]).push(markdown.slice(start, match.index));
    if (HORIZONTAL.test(match[0])) stacks.push([]);
    start = (match.index ?? 0) + match[0].length;
  }
  (stacks[stacks.length - 1] as string[]).push(markdown.slice(start));
  return stacks;
}

/** The slide (horizontal and vertical index) that holds the character at `offset`. */
export function slideAt(markdown: string, offset: number): { h: number; v: number } {
  let h = 0;
  let v = 0;
  for (const match of markdown.matchAll(SPLIT)) {
    // A separator counts once the cursor is past its first line break.
    if ((match.index ?? 0) + 1 > offset) break;
    if (HORIZONTAL.test(match[0])) {
      h++;
      v = 0;
    } else v++;
  }
  return { h, v };
}

export function countSlides(markdown: string): number {
  return splitSlides(markdown).reduce((total, stack) => total + stack.length, 0);
}

/** The deck's title: its first heading, or the first line of text. */
export function deckTitle(markdown: string): string {
  const heading = /^#{1,3}\s+(.+?)\s*#*\s*$/m.exec(markdown);
  const text = heading?.[1] ?? markdown.split('\n').find((line) => line.trim() && !line.startsWith('<!--')) ?? '';
  return (
    text
      .replace(/[*_`[\]]/g, '')
      .replace(/<[^>]+>/g, '')
      .trim()
      .slice(0, 120) || 'Slides'
  );
}

/**
 * Stylesheets may import web fonts (several reveal.js themes load theirs from
 * Google Fonts).  Benchtop loads nothing from the network, so those imports
 * are dropped and the theme falls back to the fonts on the computer.
 */
export function stripRemoteImports(css: string): string {
  return css.replace(/@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\/[^;]*;\s*/gi, '');
}

/** Text for a <textarea>, whose content ends only at </textarea>. */
const textareaText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
/** Code for an inline <script>, which must not contain </script. */
const inlineScript = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1');
const attr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The licences of software a saved file carries, as an HTML comment. */
export function licenceComment(parts: readonly { readonly name: string; readonly text: string }[]): string {
  if (!parts.length) return '';
  const body = parts.map((p) => `${p.name}\n${'='.repeat(Math.min(72, p.name.length))}\n\n${p.text.trim()}`).join('\n\n\n');
  return `<!--\nThis file carries the following software, under these licences.\n\n${body.replace(/--!?>/g, '- ->')}\n-->\n`;
}

export interface DeckAssets {
  /** Licence texts of what the file carries. */
  readonly licences?: readonly { readonly name: string; readonly text: string }[];
  readonly revealCss: string;
  readonly themeCss: string;
  readonly codeCss?: string;
  readonly revealJs: string;
  readonly markdownJs: string;
  readonly highlightJs?: string;
  readonly notesJs?: string;
}

/** Whether a deck has fenced code, which needs the (large) highlighting plugin. */
export const hasCode = (markdown: string) => /^\s*(```|~~~)/m.test(markdown);

const FILE_MARK = 'benchtop-deck';

const PICTURE = /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const PICTURE_MARK = 'data:,benchtop-picture';

/**
 * A complete presentation in one HTML file: reveal.js, its Markdown, code
 * highlighting and speaker-notes plugins, the theme, and the deck's Markdown.
 * `shown` is the Markdown as presented (maths already drawn); when it differs
 * from `source`, the source travels too, with its pictures left out (they are
 * in `shown`, in the same order), so the file opens again for editing.
 */
export function deckHtml(shown: string, options: DeckOptions, assets: DeckAssets, title = deckTitle(shown), source = shown): string {
  const plugins = ['RevealMarkdown', assets.highlightJs ? 'RevealHighlight' : '', assets.notesJs ? 'RevealNotes' : ''].filter(Boolean);
  const config = { ...revealConfig(options), hash: true };
  const extra = source === shown ? {} : { source: source.replace(PICTURE, PICTURE_MARK) };
  const settings = JSON.stringify({ version: 1, options, ...extra }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Benchtop Slide Deck (reveal.js)">
<title>${attr(title)}</title>
<style>${assets.revealCss}</style>
<style>${stripRemoteImports(assets.themeCss)}</style>
${assets.codeCss ? `<style>${assets.codeCss}</style>\n` : ''}<script type="application/json" id="${FILE_MARK}">${settings}</script>
</head>
<body>
<div class="reveal"><div class="slides">
<section data-markdown data-separator="${attr(SEPARATOR)}" data-separator-vertical="${attr(VERTICAL_SEPARATOR)}" data-separator-notes="${attr(NOTES_SEPARATOR)}">
<textarea data-template>
${textareaText(shown)}
</textarea>
</section>
</div></div>
<script>${inlineScript(assets.revealJs)}</script>
<script>${inlineScript(assets.markdownJs)}</script>
${assets.highlightJs ? `<script>${inlineScript(assets.highlightJs)}</script>\n` : ''}${assets.notesJs ? `<script>${inlineScript(assets.notesJs)}</script>\n` : ''}<script>Reveal.initialize(Object.assign(${JSON.stringify(config)}, { plugins: [${plugins.join(', ')}] }));</script>
</body>
</html>
${licenceComment(assets.licences ?? [])}`;
}

/** Text from inside a <textarea>, entities decoded the way the browser does it. */
function decode(text: string): string {
  if (typeof document !== 'undefined') {
    // A textarea's content is plain text to the parser: nothing here becomes an element.
    const area = document.createElement('textarea');
    area.innerHTML = text;
    return area.value;
  }
  return text.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" })[name] ?? '');
}

/**
 * Reads a deck back: Markdown as it is, or the Markdown and settings inside
 * an HTML file this tool (or reveal.js with an inline Markdown section) made.
 */
export function readDeckFile(text: string, name = ''): { markdown: string; options: DeckOptions | null } {
  const isHtml = /\.html?$/i.test(name) || /^\s*<!doctype html|^\s*<html[\s>]/i.test(text);
  if (!isHtml) return { markdown: text.replace(/\r\n/g, '\n'), options: null };
  const template =
    /<section[^>]*\bdata-markdown\b[^>]*>\s*<(textarea|script)[^>]*\bdata-template\b[^>]*>([\s\S]*?)<\/\1>/i.exec(text) ??
    /<section[^>]*\bdata-markdown\b[^>]*>\s*<script[^>]*>([\s\S]*?)<\/script>/i.exec(text);
  if (!template) throw new Error('This page has no Markdown slides to open (a <section data-markdown> with the Markdown inside it).');
  const raw = template.length === 3 ? (template[2] as string) : (template[1] as string);
  const isTextarea = template.length === 3 && (template[1] as string).toLowerCase() === 'textarea';
  let markdown = (isTextarea ? decode(raw) : raw.replace(/__SCRIPT_END__/g, '</script>')).replace(/\r\n/g, '\n');
  markdown = markdown.replace(/^\n/, '').replace(/\n$/, '');
  // reveal.js removes the indentation shared by every line; so does this.
  const indents = markdown
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  const shared = indents.length ? Math.min(...indents) : 0;
  if (shared > 0) markdown = markdown.replace(new RegExp(`^[ \\t]{${shared}}`, 'gm'), '');
  markdown = markdown.replace(/\n[ \t]*$/, '');
  const settings = new RegExp(`<script[^>]*id="${FILE_MARK}"[^>]*>([\\s\\S]*?)</script>`, 'i').exec(text);
  let options: DeckOptions | null = null;
  if (settings) {
    try {
      const saved = JSON.parse(settings[1] as string) as { options?: unknown; source?: unknown };
      options = readOptions(saved.options);
      if (typeof saved.source === 'string') {
        const pictures = markdown.match(PICTURE) ?? [];
        const marks = saved.source.split(PICTURE_MARK).length - 1;
        if (marks === pictures.length) {
          let next = 0;
          markdown = saved.source.split(PICTURE_MARK).reduce((out, part, i) => (i === 0 ? part : out + (pictures[next++] as string) + part), '');
        }
      }
    } catch {
      options = null;
    }
  }
  return { markdown, options };
}

export const SAMPLE_DECK = `# Making things move

### A short talk, written in Markdown

Benchtop · reveal.js

Note: Welcome everyone. These notes show in the speaker view (press S in the saved file).

---

## Why slides in Markdown?

- Plain text you can keep in git
- One file to present, offline
- Code, maths and pictures welcome

---

## Fragments

Points can appear one at a time:

- First <!-- .element: class="fragment" -->
- Second <!-- .element: class="fragment" -->
- Third <!-- .element: class="fragment" -->

---

## Code

\`\`\`js [1|3-4]
const deck = new Reveal();
// Lines light up step by step
deck.initialize({ hash: true });
deck.on('slidechanged', (e) => console.log(e.indexh));
\`\`\`

---

## Maths

The energy of a photon is $E = h\\nu$, and

$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$

--

## A slide below

Press the down arrow to reach slides stacked under a topic.

---

<!-- .slide: data-background-color="#1f6feb" -->

## Thank you

Questions?
`;
