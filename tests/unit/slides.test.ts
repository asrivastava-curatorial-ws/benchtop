import { describe, expect, it } from 'vitest';
import {
  countSlides,
  DEFAULT_OPTIONS,
  deckHtml,
  deckTitle,
  licenceComment,
  printPageSize,
  readDeckFile,
  readOptions,
  revealConfig,
  slideAt,
  splitSlides,
  stripRemoteImports,
} from '../../src/lib/slides';

const ASSETS = {
  revealCss: '.reveal{}',
  themeCss: '@import url(https://fonts.googleapis.com/css?family=Lato);\n.reveal{font-family:Lato}',
  revealJs: 'var Reveal={initialize(){}};',
  markdownJs: 'var RevealMarkdown={};',
  notesJs: 'var RevealNotes={};',
};

describe('slide decks', () => {
  it('splits slides the way reveal.js does', () => {
    const md = '# One\n\n---\n\n## Two\n\n--\n\n## Two below\n\n---\n\n## Three';
    expect(splitSlides(md).map((stack) => stack.length)).toEqual([1, 2, 1]);
    expect(countSlides(md)).toBe(4);
    expect(slideAt(md, 0)).toEqual({ h: 0, v: 0 });
    expect(slideAt(md, md.indexOf('Two below'))).toEqual({ h: 1, v: 1 });
    expect(slideAt(md, md.indexOf('## Two\n'))).toEqual({ h: 1, v: 0 });
    expect(slideAt(md, md.length)).toEqual({ h: 2, v: 0 });
    // A rule needs a line of its own: these are not separators.
    expect(countSlides('a --- b\n----\nc')).toBe(1);
  });

  it('names a deck after its first heading', () => {
    expect(deckTitle('<!-- .slide: x -->\n# Making *things* move\n\n---\n')).toBe('Making things move');
    expect(deckTitle('Just text')).toBe('Just text');
    expect(deckTitle('')).toBe('Slides');
  });

  it('drops web-font imports and keeps embedded fonts', () => {
    const css = '@import url("https://fonts.googleapis.com/css?family=Lato");\n@import "//example.org/x.css";\n@font-face{src:url(data:font/woff;base64,AAAA)}';
    const out = stripRemoteImports(css);
    expect(out).not.toContain('googleapis');
    expect(out).not.toContain('example.org');
    expect(out).toContain('data:font/woff');
  });

  it('reads settings defensively', () => {
    expect(readOptions(null)).toEqual(DEFAULT_OPTIONS);
    const o = readOptions({ theme: 'moon', transition: 'spin', size: '4:3', autoSlide: 9999, loop: 'yes' });
    expect(o.theme).toBe('moon');
    expect(o.transition).toBe(DEFAULT_OPTIONS.transition);
    expect(o.size).toBe('4:3');
    expect(o.autoSlide).toBe(600);
    expect(o.loop).toBe(false);
    expect(revealConfig(o)).toMatchObject({ width: 1024, height: 768, autoSlide: 600_000, hash: false });
    expect(revealConfig(o, true)).toMatchObject({ view: 'print' });
    expect(printPageSize(DEFAULT_OPTIONS)).toEqual({ width: 1331, height: 748 });
  });

  it('saves a deck as one page and reads it back', () => {
    const md = '# Title & more\n\nA </textarea> and a </script>\n\n---\n\n![p](data:image/png;base64,AAAA)\n\n$E=mc^2$';
    const shown = md.replace('$E=mc^2$', '<svg>E</svg>');
    const html = deckHtml(shown, { ...DEFAULT_OPTIONS, theme: 'night' }, ASSETS, 'Title', md);
    expect(html).not.toContain('googleapis');
    expect(html).toContain('RevealMarkdown');
    expect(html).not.toContain('RevealHighlight');
    // The text area holds the deck as shown; only its own end tag may close it.
    expect(html.match(/<\/textarea>/g)).toHaveLength(1);
    expect(html).toContain('&lt;/textarea>');
    expect(html.match(/<\/script>/g)?.length).toBe(html.match(/<script/g)?.length);
    const back = readDeckFile(html, 'deck.html');
    expect(back.markdown).toBe(md);
    expect(back.options?.theme).toBe('night');
    // Without maths, the source is not stored twice.
    const plain = deckHtml('# Plain', DEFAULT_OPTIONS, ASSETS);
    expect(plain).not.toContain('"source"');
    expect(readDeckFile(plain).markdown).toBe('# Plain');
  });

  it('carries licence texts in a comment that cannot end early', () => {
    const comment = licenceComment([{ name: 'thing (MIT)', text: 'Copyright a --> b' }]);
    expect(comment.startsWith('<!--\n')).toBe(true);
    expect(comment.match(/-->/g)).toHaveLength(1);
    expect(comment).toContain('Copyright a - -> b');
    expect(licenceComment([])).toBe('');
    const html = deckHtml('# x', DEFAULT_OPTIONS, { ...ASSETS, licences: [{ name: 'reveal.js (MIT)', text: 'MIT' }] });
    expect(html.trimEnd().endsWith('-->')).toBe(true);
  });

  it('opens reveal.js pages written by hand, and plain Markdown', () => {
    const page =
      '<!doctype html><html><body><div class="reveal"><div class="slides"><section data-markdown>\n  <script type="text/template">\n    ## Hi\n\n    ---\n\n    ## There\n  </script>\n</section></div></div></body></html>';
    expect(readDeckFile(page).markdown).toBe('## Hi\n\n---\n\n## There');
    expect(readDeckFile('## A\r\n\r\n---\r\n\r\n## B', 'talk.md')).toEqual({ markdown: '## A\n\n---\n\n## B', options: null });
    expect(() => readDeckFile('<html><body>nothing</body></html>')).toThrow(/no Markdown slides/);
  });
});
