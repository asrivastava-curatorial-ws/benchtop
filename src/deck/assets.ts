/**
 * reveal.js's stylesheets and scripts as text, loaded on demand: the preview
 * page puts them in <style> elements (so a print snapshot carries them), and
 * a saved deck carries them inline so it runs offline from a single file.
 * The paths point into the package because its export map leaves out the
 * browser builds (UMD) and some stylesheets.
 */
import type { CodeTheme, DeckAssets, DeckOptions, DeckTheme } from '../lib/slides';

const text = (load: Promise<{ default: string }>) => load.then((m) => m.default);

const THEME_CSS: Record<DeckTheme, () => Promise<string>> = {
  black: () => text(import('../../node_modules/reveal.js/dist/theme/black.css?raw')),
  white: () => text(import('../../node_modules/reveal.js/dist/theme/white.css?raw')),
  league: () => text(import('../../node_modules/reveal.js/dist/theme/league.css?raw')),
  beige: () => text(import('../../node_modules/reveal.js/dist/theme/beige.css?raw')),
  night: () => text(import('../../node_modules/reveal.js/dist/theme/night.css?raw')),
  serif: () => text(import('../../node_modules/reveal.js/dist/theme/serif.css?raw')),
  simple: () => text(import('../../node_modules/reveal.js/dist/theme/simple.css?raw')),
  solarized: () => text(import('../../node_modules/reveal.js/dist/theme/solarized.css?raw')),
  moon: () => text(import('../../node_modules/reveal.js/dist/theme/moon.css?raw')),
  dracula: () => text(import('../../node_modules/reveal.js/dist/theme/dracula.css?raw')),
  sky: () => text(import('../../node_modules/reveal.js/dist/theme/sky.css?raw')),
  blood: () => text(import('../../node_modules/reveal.js/dist/theme/blood.css?raw')),
  'black-contrast': () => text(import('../../node_modules/reveal.js/dist/theme/black-contrast.css?raw')),
  'white-contrast': () => text(import('../../node_modules/reveal.js/dist/theme/white-contrast.css?raw')),
};

const CODE_CSS: Record<CodeTheme, () => Promise<string>> = {
  monokai: () => text(import('../../node_modules/reveal.js/dist/plugin/highlight/monokai.css?raw')),
  zenburn: () => text(import('../../node_modules/reveal.js/dist/plugin/highlight/zenburn.css?raw')),
};

export const themeCss = (theme: DeckTheme) => THEME_CSS[theme]();
export const codeCss = (theme: CodeTheme) => CODE_CSS[theme]();
export const revealCss = () => text(import('../../node_modules/reveal.js/dist/reveal.css?raw'));

/** Everything a saved deck needs; code highlighting only when the deck has code. */
export async function deckAssets(options: DeckOptions, withCode: boolean): Promise<DeckAssets> {
  const [reveal, theme, revealJs, markdownJs, notesJs, code, highlightJs, revealLicence, markedLicence, highlightLicence] = await Promise.all([
    revealCss(),
    themeCss(options.theme),
    text(import('../../node_modules/reveal.js/dist/reveal.js?raw')),
    text(import('../../node_modules/reveal.js/dist/plugin/markdown.js?raw')),
    text(import('../../node_modules/reveal.js/dist/plugin/notes.js?raw')),
    withCode ? codeCss(options.codeTheme) : Promise.resolve(undefined),
    withCode ? text(import('../../node_modules/reveal.js/dist/plugin/highlight.js?raw')) : Promise.resolve(undefined),
    text(import('../../node_modules/reveal.js/LICENSE?raw')),
    text(import('../../node_modules/marked/LICENSE?raw')),
    withCode ? text(import('../../node_modules/highlight.js/LICENSE?raw')) : Promise.resolve(''),
  ]);
  const licences = [
    { name: 'reveal.js, with its Markdown, notes and code highlighting plugins (MIT)', text: revealLicence },
    { name: 'marked, inside the Markdown plugin (MIT)', text: markedLicence },
    ...(withCode ? [{ name: 'highlight.js, inside the code highlighting plugin (BSD-3-Clause)', text: highlightLicence }] : []),
  ];
  return { revealCss: reveal, themeCss: theme, revealJs, markdownJs, notesJs, codeCss: code, highlightJs, licences };
}
