/**
 * Markdown Editor (live preview with maths, export to HTML, PDF, Word and
 * EPUB) and Equation Editor (LaTeX to SVG, PNG and MathML with MathJax).
 */

import type { EditorView } from '@codemirror/view';
import { keymap } from '@codemirror/view';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../../lib/errors';
import { type DocxImage, documentTitle, type MathRenderer, outline, renderMarkdown, standaloneHtml, toDocx, toEpub } from '../../lib/markdown-doc';
import type { TexResult } from '../../lib/tex';
import { copyText, htmlToPdf, isDesktop, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { dataUrlChips, goToLine, insertText, prefixLines, wrapSelection } from '../../ui/editor-extras';
import { Icon } from '../../ui/icons';
import { PreviewView } from '../../ui/Preview';
import { printDocument } from '../../ui/print';
import { sanitizeHtml } from '../../ui/sanitize';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { MultiDrop } from './_files';
import { Segmented, usePersistentState } from './_shared';

/* ------------------------------------------------------------- shared -- */

let texModule: Promise<typeof import('../../lib/tex')> | null = null;
/** MathJax is large, so it loads the first time a document or equation needs it. */
export const loadTex = () => {
  texModule ??= import('../../lib/tex');
  return texModule;
};

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

/** Task-list checkboxes in the preview get a name from their item, for screen readers. */
function labelTasks(markup: string): string {
  if (!markup.includes('checkbox')) return markup;
  const doc = new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html');
  for (const box of doc.querySelectorAll('li > input[type="checkbox"]')) {
    const text = (box.parentElement?.textContent ?? '').trim().slice(0, 160);
    box.setAttribute('aria-label', `${box.hasAttribute('checked') ? 'Done' : 'To do'}: ${text || 'task'}`);
  }
  return doc.body.innerHTML;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'document';
const safeName = (text: string) =>
  text
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'document';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/** A picture (data URL) as PNG/JPEG/GIF bytes with its size, for Word; other formats are drawn to PNG. */
export async function loadDocxImage(src: string): Promise<DocxImage | null> {
  if (!src.startsWith('data:image/')) return null;
  const mime = src.slice(5, src.indexOf(';'));
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const width = image.naturalWidth || 300;
  const height = image.naturalHeight || 150;
  const direct: Record<string, DocxImage['type']> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' };
  const type = direct[mime];
  if (type) {
    const b64 = src.slice(src.indexOf(',') + 1);
    return { data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), type, width, height };
  }
  // SVG (maths), WebP and AVIF: drawn at twice the size so they stay sharp when printed.
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * 2);
  canvas.height = Math.ceil(height * 2);
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return { data: new Uint8Array(await blob.arrayBuffer()), type: 'png', width, height };
}

/* ---------------------------------------------------- Markdown Editor -- */

const SAMPLE = `# Engine Hall visitor guide

Welcome to the **Engine Hall**. This guide is written in _Markdown_: the preview on the right updates as you type, and the document can be saved as a web page, PDF, Word file or e-book.

## What to see

1. The beam engine of 1905, restored in the museum workshop
2. A cut-away diesel engine that turns slowly every half hour
3. The Stirling engine that runs on the warmth of a hand

> Ask the gallery explainer to start the steam model. It runs at 11:00 and 15:00.

## How efficient is a heat engine?

No engine can beat the Carnot limit, where $T_c$ and $T_h$ are the cold and hot temperatures in kelvin:

$$
\\eta = 1 - \\frac{T_c}{T_h}
$$

| Engine | Typical efficiency | On display |
|:-------|-------------------:|:----------:|
| Steam (1905) | 8 % | Yes |
| Petrol | 25–30 % | Yes |
| Diesel | 35–45 % | Yes |

## Checklist for school visits

- [x] Book the slot two weeks ahead
- [x] Send the worksheet to the teachers
- [ ] Arrange the demonstration

Water boils at \`100 °C\` at sea level, and the code below works out a steam engine's power:

\`\`\`python
def power(force_newtons, speed_m_per_s):
    return force_newtons * speed_m_per_s
\`\`\`

More about the museum at [vismuseum.gov.in](https://www.vismuseum.gov.in/).
`;

type MdView = 'split' | 'edit' | 'preview';
type Paper = 'A4' | 'Letter';
type Format = 'html' | 'pdf' | 'docx' | 'epub';

interface MdState {
  readonly doc: string;
  readonly view: MdView;
  readonly outline: boolean;
  readonly paper: Paper;
}

const MAX_DRAFT = 200_000;

const readMd = (v: Values | undefined): MdState => ({
  doc: typeof v?.doc === 'string' ? v.doc : SAMPLE,
  view: v?.view === 'edit' || v?.view === 'preview' ? v.view : 'split',
  outline: v?.outline === true,
  paper: v?.paper === 'Letter' ? 'Letter' : 'A4',
});
// Very long documents (big embedded pictures) are not kept between sessions; save them as files.
const writeMd = (s: MdState): Values => ({ doc: s.doc.length > MAX_DRAFT ? '' : s.doc, view: s.view, outline: s.outline, paper: s.paper });

interface Action {
  readonly label: string;
  readonly title: string;
  readonly run: (view: EditorView) => void;
}

const TABLE = '\n| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| Text     | Text     | Text     |\n';

const ACTIONS: readonly Action[] = [
  { label: 'B', title: 'Bold (Ctrl+B)', run: (v) => wrapSelection(v, '**', '**', 'bold text') },
  { label: 'I', title: 'Italic (Ctrl+I)', run: (v) => wrapSelection(v, '_', '_', 'italic text') },
  { label: 'S', title: 'Strikethrough', run: (v) => wrapSelection(v, '~~', '~~', 'struck text') },
  { label: 'H1', title: 'Heading 1', run: (v) => prefixLines(v, '# ') },
  { label: 'H2', title: 'Heading 2', run: (v) => prefixLines(v, '## ') },
  { label: 'H3', title: 'Heading 3', run: (v) => prefixLines(v, '### ') },
  { label: '•', title: 'Bulleted list', run: (v) => prefixLines(v, '- ') },
  { label: '1.', title: 'Numbered list', run: (v) => prefixLines(v, (i) => `${i + 1}. `) },
  { label: '☐', title: 'Task list', run: (v) => prefixLines(v, '- [ ] ') },
  { label: '❝', title: 'Quote', run: (v) => prefixLines(v, '> ') },
  { label: '</>', title: 'Code', run: (v) => wrapSelection(v, '`', '`', 'code') },
  { label: '{ }', title: 'Code block', run: (v) => wrapSelection(v, '\n```\n', '\n```\n', 'code') },
  { label: 'Link', title: 'Link (Ctrl+K)', run: (v) => wrapSelection(v, '[', '](https://)', 'link text') },
  { label: 'Table', title: 'Insert a table', run: (v) => insertText(v, TABLE) },
  { label: '√x', title: 'Maths in the line ($…$)', run: (v) => wrapSelection(v, '$', '$', 'E = mc^2') },
  { label: '∑', title: 'Maths on its own line ($$…$$)', run: (v) => wrapSelection(v, '\n$$\n', '\n$$\n', '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}') },
  { label: '―', title: 'Horizontal line', run: (v) => insertText(v, '\n\n---\n\n') },
];

const formatWith = (view: EditorView, before: string, after: string, placeholder: string) => {
  wrapSelection(view, before, after, placeholder);
  return true;
};

const markdownKeys = keymap.of([
  { key: 'Mod-b', run: (v) => formatWith(v, '**', '**', 'bold text') },
  { key: 'Mod-i', run: (v) => formatWith(v, '_', '_', 'italic text') },
  { key: 'Mod-k', run: (v) => formatWith(v, '[', '](https://)', 'link text') },
]);

/** Long embedded pictures show as chips; Ctrl+B, Ctrl+I and Ctrl+K format. */
const MARKDOWN_EXTRAS = [dataUrlChips, markdownKeys];

function MarkdownEditor({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readMd, writeMd);
  const [name, setName] = useState('');
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState<Format | null>(null);
  const view = useRef<EditorView | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const math = useRef<MathRenderer | undefined>(undefined);
  const imageInput = useRef<HTMLInputElement>(null);

  // Rendering waits for a pause in typing; maths loads MathJax the first time a $ appears.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        if (!math.current && state.doc.includes('$')) {
          const { texToSvg } = await loadTex();
          const cache = new Map<string, ReturnType<MathRenderer>>();
          math.current = (tex, display) => {
            const key = `${display ? 'D' : 'I'}${tex}`;
            let r = cache.get(key);
            if (!r) {
              const out = texToSvg(tex, { display, scale: 17 });
              r = { svg: out.svg, error: out.error, depth: out.depth };
              if (cache.size > 500) cache.clear();
              cache.set(key, r);
            }
            return r;
          };
        }
        if (!cancelled) setHtml(renderMarkdown(state.doc, math.current));
      },
      html ? 150 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.doc]);

  const safe = useMemo(() => labelTasks(sanitizeHtml(html)), [html]);
  const headings = useMemo(() => outline(state.doc), [state.doc]);
  const stats = useMemo(() => {
    const plain = state.doc.replace(/data:[^)\s]+/g, '').replace(/[#>*_`~[\]()|-]/g, ' ');
    const count = (plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;
    return { words: count, minutes: Math.max(1, Math.round(count / 220)) };
  }, [state.doc]);

  const openFile = async (file: File) => {
    if (/^image\//.test(file.type)) return embedPictures([file]);
    const text = await file.text();
    setState((s) => ({ ...s, doc: text }));
    setName(file.name);
  };

  const embedPictures = async (files: File[]) => {
    const editor = view.current;
    const parts: string[] = [];
    for (const file of files) {
      if (!/^image\//.test(file.type) && !/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file.name)) continue;
      if (file.size > 8 * 1024 * 1024) {
        notify(`${file.name} is larger than 8 MB; make it smaller first (Image Resizer) so the document stays quick to edit.`, 'error');
        continue;
      }
      parts.push(`![${file.name.replace(/\.[^.]+$/, '')}](${await readAsDataUrl(file)})`);
    }
    if (!parts.length) return;
    const text = `\n${parts.join('\n\n')}\n`;
    if (editor) insertText(editor, text);
    else setState((s) => ({ ...s, doc: s.doc + text }));
  };

  const baseName = () => (name ? stem(name) : safeName(documentTitle(state.doc)));

  const exportAs = (format: Format) =>
    attempt(async () => {
      setBusy(format);
      try {
        const title = documentTitle(state.doc);
        const { texToSvg } = state.doc.includes('$') ? await loadTex() : { texToSvg: null };
        // Exports draw maths a little larger than the screen, for print.
        const render: MathRenderer | undefined = texToSvg
          ? (tex, display) => {
              const r = texToSvg(tex, { display, scale: 18 });
              return { svg: r.svg, error: r.error, depth: r.depth };
            }
          : undefined;
        let outcome: Awaited<ReturnType<typeof saveFile>>;
        if (format === 'html') {
          outcome = await saveFile(`${baseName()}.html`, standaloneHtml(title, renderMarkdown(state.doc, render)), 'text/html');
        } else if (format === 'docx') {
          outcome = await saveFile(`${baseName()}.docx`, await toDocx(state.doc, loadDocxImage, render, { title }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        } else if (format === 'epub') {
          outcome = await saveFile(`${baseName()}.epub`, toEpub(state.doc, render, { title }), 'application/epub+zip');
        } else {
          const page = standaloneHtml(title, renderMarkdown(state.doc, render)).replace('</style>', `@page { size: ${state.paper}; margin: 18mm 16mm; }\n</style>`);
          if (!isDesktop) {
            printDocument(page);
            return;
          }
          outcome = await saveFile(`${baseName()}.pdf`, await htmlToPdf(page, { paper: state.paper }), 'application/pdf');
        }
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      } finally {
        setBusy(null);
      }
    });

  const saveMarkdown = () =>
    attempt(async () => {
      const outcome = await saveFile(name && /\.(md|markdown|txt)$/i.test(name) ? name : `${baseName()}.md`, state.doc, 'text/markdown;charset=utf-8');
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });

  // The preview follows the editor's scroll position.
  const onEditorScroll = (event: Event) => {
    const source = event.target as HTMLElement;
    const target = previewRef.current;
    if (!target || !source.classList?.contains('cm-scroller')) return;
    const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
    target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
  };

  const showEditor = state.view !== 'preview';
  const showPreview = state.view !== 'edit';

  return (
    <section class="tool md-tool" data-testid="tool" data-state={html ? 'done' : 'idle'}>
      <div class="button-row md-files">
        <MultiDrop
          icon="file"
          compact
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          onFiles={(f) => f[0] && void attempt(() => openFile(f[0] as File))}
          title="Open Markdown"
          testId="md-open"
        />
        <button type="button" class="button" onClick={saveMarkdown} data-testid="md-save">
          <Icon name="save" size={15} /> Save .md
        </button>
        <button
          type="button"
          class="button button-quiet"
          onClick={() => {
            setState((s) => ({ ...s, doc: SAMPLE }));
            setName('');
          }}
          data-testid="md-sample"
        >
          <Icon name="sample" size={15} /> Sample
        </button>
        <span class="md-export" role="group" aria-label="Export">
          <span class="control-label">Export</span>
          <button type="button" class="button button-small" disabled={busy !== null} onClick={() => exportAs('html')} data-testid="md-html">
            Web page
          </button>
          <button type="button" class="button button-small" disabled={busy !== null} onClick={() => exportAs('pdf')} data-testid="md-pdf">
            PDF
          </button>
          <select
            class="select select-small"
            aria-label="Paper size for PDF"
            value={state.paper}
            onChange={(e) => setState((s) => ({ ...s, paper: e.currentTarget.value === 'Letter' ? 'Letter' : 'A4' }))}
          >
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
          </select>
          <button type="button" class="button button-small" disabled={busy !== null} onClick={() => exportAs('docx')} data-testid="md-docx">
            Word
          </button>
          <button type="button" class="button button-small" disabled={busy !== null} onClick={() => exportAs('epub')} data-testid="md-epub">
            EPUB
          </button>
          <button
            type="button"
            class="button button-small button-quiet"
            onClick={() =>
              attempt(async () => {
                await copyText(html);
                notify('HTML copied');
              })
            }
          >
            <Icon name="copy" size={13} /> Copy HTML
          </button>
        </span>
      </div>
      <div class="pane-header md-toolbar" role="toolbar" aria-label="Formatting">
        {ACTIONS.map((a) => (
          <button
            key={a.title}
            type="button"
            class="button button-small md-tool-button"
            title={a.title}
            aria-label={spokenName(a.label, a.title)}
            disabled={!showEditor}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => view.current && a.run(view.current)}
          >
            {a.label}
          </button>
        ))}
        <button type="button" class="button button-small md-tool-button" title="Insert pictures (they are embedded in the document)" disabled={!showEditor} onClick={() => imageInput.current?.click()}>
          <Icon name="image" size={14} /> Picture
        </button>
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          data-testid="md-picture"
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = '';
            void attempt(() => embedPictures(files));
          }}
        />
        <span class="md-toolbar-end">
          <button type="button" class={`button button-small${state.outline ? ' is-active' : ''}`} aria-pressed={state.outline} onClick={() => setState((s) => ({ ...s, outline: !s.outline }))}>
            Outline
          </button>
          <Segmented
            label="Layout"
            value={state.view}
            onChange={(v) => setState((s) => ({ ...s, view: v }))}
            choices={[
              { value: 'edit', label: 'Write' },
              { value: 'split', label: 'Both' },
              { value: 'preview', label: 'Preview' },
            ]}
          />
        </span>
      </div>
      <div class={`md-layout md-view-${state.view}${state.outline ? ' md-with-outline' : ''}`}>
        {state.outline && (
          <nav class="md-outline" aria-label="Outline" data-testid="md-outline">
            {headings.length === 0 && <p class="tone-muted">Headings (lines starting with #) appear here.</p>}
            <ul>
              {headings.map((h) => (
                <li key={`${h.line}`} style={{ paddingLeft: `${(h.depth - 1) * 12}px` }}>
                  <button type="button" class="link-button" onClick={() => view.current && goToLine(view.current, h.line)}>
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {showEditor && (
          <div
            class="pane md-editor"
            onScrollCapture={onEditorScroll}
            // Capture phase, so pictures are embedded before the editor pastes text for them.
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
            onKeyDown={(e) => {
              if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveMarkdown();
              }
            }}
          >
            <div class="pane-body">
              <CodeEditor
                value={state.doc}
                onChange={(doc) => setState((s) => ({ ...s, doc }))}
                language="markdown"
                wrap
                label="Markdown"
                testId="md-editor"
                viewRef={view}
                extensions={MARKDOWN_EXTRAS}
                placeholder="Write Markdown here…"
              />
            </div>
          </div>
        )}
        {showPreview && <div ref={previewRef} class="preview-html prose md-preview" data-testid="md-preview" {...scrollRegion('Preview')} dangerouslySetInnerHTML={{ __html: safe }} />}
      </div>
      <div class="md-status tone-muted" aria-live="polite" data-testid="md-status">
        {stats.words.toLocaleString()} {stats.words === 1 ? 'word' : 'words'} · about {stats.minutes} min to read · {headings.length} {headings.length === 1 ? 'heading' : 'headings'}
        {busy && <span> · Exporting {busy.toUpperCase()}…</span>}
        {state.doc.length > MAX_DRAFT && <span> · Too large to keep between sessions; save it as a file.</span>}
      </div>
    </section>
  );
}

/* ---------------------------------------------------- Equation Editor -- */

interface Snippet {
  readonly label: string;
  readonly tex: string;
  readonly title?: string;
}

const s = (label: string, tex: string, title?: string): Snippet => ({ label, tex, title });

/** `|` marks where the cursor goes after inserting. */
const PALETTE: readonly { readonly name: string; readonly items: readonly Snippet[] }[] = [
  {
    name: 'Structures',
    items: [
      s('a⁄b', '\\frac{|}{}', 'Fraction'),
      s('√x', '\\sqrt{|}', 'Square root'),
      s('ⁿ√x', '\\sqrt[n]{|}', 'nth root'),
      s('x²', '^{|}', 'Power'),
      s('xᵢ', '_{|}', 'Subscript'),
      s('∑', '\\sum_{i=1}^{n} |', 'Sum'),
      s('∏', '\\prod_{i=1}^{n} |', 'Product'),
      s('∫', '\\int_{a}^{b} | \\, dx', 'Integral'),
      s('∬', '\\iint_{D} | \\, dA', 'Double integral'),
      s('∮', '\\oint_{C} | \\, d\\ell', 'Contour integral'),
      s('lim', '\\lim_{x \\to \\infty} |', 'Limit'),
      s('d/dx', '\\frac{d}{dx}|', 'Derivative'),
      s('∂/∂x', '\\frac{\\partial |}{\\partial x}', 'Partial derivative'),
      s('(ⁿₖ)', '\\binom{n}{k}|', 'Binomial'),
      s('[▦]', '\\begin{bmatrix} | & 0 \\\\ 0 & 1 \\end{bmatrix}', 'Matrix'),
      s('|▦|', '\\begin{vmatrix} | & b \\\\ c & d \\end{vmatrix}', 'Determinant'),
      s('{ cases', 'f(x) = \\begin{cases} | & x \\ge 0 \\\\ -x & x < 0 \\end{cases}', 'Cases'),
      s('( )', '\\left( | \\right)', 'Brackets that grow'),
      s('x̄', '\\overline{|}', 'Bar'),
      s('v⃗', '\\vec{|}', 'Vector'),
      s('x̂', '\\hat{|}', 'Hat'),
      s('ẋ', '\\dot{|}', 'Dot'),
      s('ẍ', '\\ddot{|}', 'Double dot'),
      s('x̃', '\\tilde{|}', 'Tilde'),
      s('⏟', '\\underbrace{|}_{\\text{note}}', 'Underbrace'),
      s('text', '\\text{|}', 'Text'),
      s('≡ align', '\\begin{aligned} a &= | \\\\ &= c \\end{aligned}', 'Aligned lines'),
    ],
  },
  {
    name: 'Greek',
    items: [
      ...'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi chi psi omega'
        .split(' ')
        .map((g, i) => s('αβγδεζηθικλμνξπρστυφχψω'[i] as string, `\\${g}`, g)),
      ...'Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' ').map((g, i) => s('ΓΔΘΛΞΠΣΦΨΩ'[i] as string, `\\${g}`, `capital ${g.toLowerCase()}`)),
      s('ϵ', '\\varepsilon', 'varepsilon'),
      s('ϑ', '\\vartheta', 'vartheta'),
      s('φ', '\\varphi', 'varphi'),
    ],
  },
  {
    name: 'Operators',
    items: [
      s('±', '\\pm'),
      s('∓', '\\mp'),
      s('×', '\\times'),
      s('÷', '\\div'),
      s('·', '\\cdot'),
      s('∘', '\\circ'),
      s('⊕', '\\oplus'),
      s('⊗', '\\otimes'),
      s('∇', '\\nabla'),
      s('∂', '\\partial'),
      s('∞', '\\infty'),
      s('ℏ', '\\hbar'),
      s('∠', '\\angle'),
      s('°', '^{\\circ}', 'Degrees'),
      s('′', "'", 'Prime'),
      s('…', '\\ldots'),
      s('⋯', '\\cdots'),
      s('sin', '\\sin'),
      s('cos', '\\cos'),
      s('tan', '\\tan'),
      s('log', '\\log'),
      s('ln', '\\ln'),
      s('exp', '\\exp'),
    ],
  },
  {
    name: 'Relations',
    items: [
      s('≠', '\\neq'),
      s('≈', '\\approx'),
      s('≡', '\\equiv'),
      s('∝', '\\propto'),
      s('≤', '\\leq'),
      s('≥', '\\geq'),
      s('≪', '\\ll'),
      s('≫', '\\gg'),
      s('∼', '\\sim'),
      s('≅', '\\cong'),
      s('∈', '\\in'),
      s('∉', '\\notin'),
      s('⊂', '\\subset'),
      s('⊆', '\\subseteq'),
      s('∪', '\\cup'),
      s('∩', '\\cap'),
      s('∅', '\\emptyset'),
      s('∀', '\\forall'),
      s('∃', '\\exists'),
      s('¬', '\\neg'),
      s('∧', '\\wedge'),
      s('∨', '\\vee'),
      s('ℝ', '\\mathbb{R}'),
      s('ℕ', '\\mathbb{N}'),
      s('ℤ', '\\mathbb{Z}'),
      s('ℂ', '\\mathbb{C}'),
    ],
  },
  {
    name: 'Arrows',
    items: [
      s('→', '\\to'),
      s('←', '\\leftarrow'),
      s('↔', '\\leftrightarrow'),
      s('⇒', '\\Rightarrow'),
      s('⇐', '\\Leftarrow'),
      s('⇔', '\\Leftrightarrow'),
      s('↦', '\\mapsto'),
      s('↑', '\\uparrow'),
      s('↓', '\\downarrow'),
      s('⇌', '\\rightleftharpoons'),
      s('⟶', '\\longrightarrow'),
      s('→ˣ', '\\xrightarrow{|}', 'Arrow with text'),
    ],
  },
  {
    name: 'Chemistry',
    items: [
      s('H₂O', '\\ce{H2O|}', 'Formula'),
      s('A→B', '\\ce{A + B -> C|}', 'Reaction'),
      s('A⇌B', '\\ce{A <=> B|}', 'Equilibrium'),
      s('¹⁴C', '\\ce{^{14}_{6}C|}', 'Isotope'),
      s('SO₄²⁻', '\\ce{SO4^2-|}', 'Ion'),
      s('↑ gas', '\\ce{CO2 ^|}', 'Gas given off'),
      s('Δ', '\\ce{CaCO3 ->[\\Delta] CaO + CO2|}', 'Heating'),
      s('9.81 m/s²', '\\pu{9.81 m/s^2|}', 'Quantity with units'),
    ],
  },
];

const FORMULAS: readonly { readonly name: string; readonly tex: string }[] = [
  { name: 'Quadratic formula', tex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
  { name: "Euler's identity", tex: 'e^{i\\pi} + 1 = 0' },
  { name: 'Pythagoras', tex: 'a^2 + b^2 = c^2' },
  { name: 'Mass–energy', tex: 'E = mc^2' },
  { name: "Newton's second law", tex: '\\vec{F} = m\\vec{a} = \\frac{d\\vec{p}}{dt}' },
  { name: "Ohm's law and power", tex: 'V = IR, \\qquad P = VI = I^2 R' },
  { name: 'Ideal gas law', tex: 'PV = nRT' },
  { name: "Bernoulli's equation", tex: 'P + \\tfrac{1}{2}\\rho v^2 + \\rho g h = \\text{constant}' },
  { name: "Coulomb's law", tex: 'F = \\frac{1}{4\\pi\\varepsilon_0}\\frac{q_1 q_2}{r^2}' },
  { name: 'Planck relation', tex: 'E = h\\nu = \\frac{hc}{\\lambda}' },
  { name: "Snell's law", tex: 'n_1 \\sin\\theta_1 = n_2 \\sin\\theta_2' },
  {
    name: "Maxwell's equations",
    tex: '\\begin{aligned}\n\\nabla \\cdot \\vec{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\\n\\nabla \\cdot \\vec{B} &= 0 \\\\\n\\nabla \\times \\vec{E} &= -\\frac{\\partial \\vec{B}}{\\partial t} \\\\\n\\nabla \\times \\vec{B} &= \\mu_0 \\vec{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\vec{E}}{\\partial t}\n\\end{aligned}',
  },
  { name: 'Schrödinger equation', tex: 'i\\hbar \\frac{\\partial}{\\partial t}\\Psi(\\mathbf{r},t) = \\left[-\\frac{\\hbar^2}{2m}\\nabla^2 + V(\\mathbf{r},t)\\right]\\Psi(\\mathbf{r},t)' },
  { name: 'Normal distribution', tex: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{1}{2}\\left(\\frac{x-\\mu}{\\sigma}\\right)^2}' },
  { name: 'Fourier transform', tex: '\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x)\\, e^{-2\\pi i x \\xi}\\, dx' },
  { name: 'Photosynthesis', tex: '\\ce{6CO2 + 6H2O ->[\\text{light}] C6H12O6 + 6O2}' },
  { name: 'Carnot efficiency', tex: '\\eta = 1 - \\frac{T_c}{T_h}' },
];

interface EqState {
  readonly tex: string;
  readonly display: boolean;
  readonly size: number;
  readonly color: string;
  readonly background: 'none' | 'white';
  readonly margin: number;
}

const readEq = (v: Values | undefined): EqState => ({
  tex: typeof v?.tex === 'string' ? v.tex : 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
  display: v?.display !== false,
  size: typeof v?.size === 'number' && v.size >= 8 && v.size <= 200 ? v.size : 32,
  color: typeof v?.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : '#000000',
  background: v?.background === 'white' ? 'white' : 'none',
  margin: typeof v?.margin === 'number' && v.margin >= 0 && v.margin <= 100 ? v.margin : 4,
});
const writeEq = (st: EqState): Values => ({ ...st });

/** Adds a margin (and a background) around a MathJax SVG sized in pixels. */
export function frameSvg(svg: string, margin: number, background: string | null): string {
  const view = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
  const width = Number(/width="([\d.]+)"/.exec(svg)?.[1]);
  const height = Number(/height="([\d.]+)"/.exec(svg)?.[1]);
  if (!view || !width || !height) return svg;
  const [x, y, w, h] = view.slice(1).map(Number) as [number, number, number, number];
  const unit = w / width; // viewBox units per pixel
  const m = margin * unit;
  const box = `${x - m} ${y - m} ${w + 2 * m} ${h + 2 * m}`;
  let out = svg
    .replace(/viewBox="[^"]+"/, `viewBox="${box}"`)
    .replace(/width="[\d.]+"/, `width="${(width + 2 * margin).toFixed(2)}"`)
    .replace(/height="[\d.]+"/, `height="${(height + 2 * margin).toFixed(2)}"`);
  if (background) out = out.replace(/(<svg[^>]*>)/, `$1<rect x="${x - m}" y="${y - m}" width="${w + 2 * m}" height="${h + 2 * m}" fill="${background}"/>`);
  return out;
}

function EquationEditor({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readEq, writeEq);
  const [result, setResult] = useState<TexResult | null>(null);
  const [group, setGroup] = useState(0);
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadTex().then(({ texToSvg }) => {
      if (cancelled) return;
      try {
        setResult(texToSvg(state.tex.trim() || '\\square', { display: state.display, scale: state.size, color: state.color }));
      } catch (e) {
        setResult({ svg: '', mathml: '', error: errorMessage(e), width: 0, height: 0, depth: 0 });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [state.tex, state.display, state.size, state.color]);

  const svg = useMemo(() => (result && !result.error ? frameSvg(result.svg, state.margin, state.background === 'white' ? '#ffffff' : null) : ''), [result, state.margin, state.background]);

  const insert = (snippet: string) => {
    const editor = view.current;
    if (!editor) {
      setState((st) => ({ ...st, tex: st.tex + snippet.replace('|', '') }));
      return;
    }
    const at = snippet.indexOf('|');
    insertText(editor, snippet.replace('|', ''), at < 0 ? undefined : at);
  };

  const copy = (text: string, what: string) =>
    attempt(async () => {
      await copyText(text);
      notify(`${what} copied`);
    });

  const palette = PALETTE[group] ?? PALETTE[0];

  return (
    <section class="tool eq-tool" data-testid="tool" data-state={svg ? 'done' : 'idle'}>
      <div class="eq-layout">
        <div class="eq-input">
          <div class="pane eq-editor">
            <div class="pane-header">
              <span class="pane-title">LaTeX</span>
              <select
                class="select select-small"
                aria-label="Insert a well-known formula"
                value=""
                data-testid="eq-formulas"
                onChange={(e) => {
                  const f = FORMULAS[Number(e.currentTarget.value)];
                  if (f) setState((st) => ({ ...st, tex: f.tex }));
                }}
              >
                <option value="">Formulas…</option>
                {FORMULAS.map((f, i) => (
                  <option key={f.name} value={i}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div class="pane-body">
              <CodeEditor value={state.tex} onChange={(tex) => setState((st) => ({ ...st, tex }))} wrap label="LaTeX" testId="eq-tex" viewRef={view} placeholder="\frac{a}{b}" />
            </div>
          </div>
          <div class="eq-palette">
            <div class="eq-tabs" role="tablist" aria-label="Symbols">
              {PALETTE.map((p, i) => (
                <button key={p.name} type="button" role="tab" aria-selected={i === group} class={`eq-tab${i === group ? ' is-active' : ''}`} onClick={() => setGroup(i)}>
                  {p.name}
                </button>
              ))}
            </div>
            <div class="eq-symbols" role="tabpanel" aria-label={palette?.name}>
              {palette?.items.map((item) => (
                <button
                  key={item.tex}
                  type="button"
                  class="eq-symbol"
                  title={`${item.title ? `${item.title}: ` : ''}${item.tex.replace('|', '')}`}
                  // The symbol first, then its name, so speech matches what is on the button.
                  aria-label={item.title ? `${item.label}, ${item.title}` : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(item.tex)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div class="eq-output">
          <div class="button-row eq-options">
            <Segmented
              label="Style"
              value={state.display ? 'display' : 'inline'}
              onChange={(v) => setState((st) => ({ ...st, display: v === 'display' }))}
              choices={[
                { value: 'display', label: 'Display' },
                { value: 'inline', label: 'Inline' },
              ]}
            />
            <label class="control control-inline">
              <span class="control-label">Size</span>
              <input
                type="number"
                class="input input-narrow"
                min={8}
                max={200}
                value={state.size}
                onInput={(e) => setState((st) => ({ ...st, size: Math.min(200, Math.max(8, Number(e.currentTarget.value) || 32)) }))}
              />
              <span class="tone-muted">px</span>
            </label>
            <label class="control control-inline">
              <span class="control-label">Colour</span>
              <input type="color" value={state.color} onInput={(e) => setState((st) => ({ ...st, color: e.currentTarget.value }))} />
            </label>
            <label class="control control-inline">
              <span class="control-label">Margin</span>
              <input
                type="number"
                class="input input-narrow"
                min={0}
                max={100}
                value={state.margin}
                onInput={(e) => setState((st) => ({ ...st, margin: Math.min(100, Math.max(0, Number(e.currentTarget.value) || 0)) }))}
              />
            </label>
            <label class="check">
              <input type="checkbox" checked={state.background === 'white'} onChange={(e) => setState((st) => ({ ...st, background: e.currentTarget.checked ? 'white' : 'none' }))} /> White background
            </label>
          </div>
          {result?.error && (
            <p class="recipe-error" role="alert" data-testid="eq-error">
              {result.error}
            </p>
          )}
          {svg && (
            <div class="eq-preview" data-testid="eq-preview">
              <PreviewView preview={{ kind: 'svg', svg, checker: state.background === 'none' }} name="equation" />
            </div>
          )}
          <div class="button-row">
            <button
              type="button"
              class="button"
              disabled={!svg}
              data-testid="eq-save-svg"
              onClick={() =>
                attempt(async () => {
                  const outcome = await saveFile('equation.svg', svg, 'image/svg+xml');
                  if (outcome.saved) notify(`Saved to ${outcome.location}`);
                })
              }
            >
              <Icon name="save" size={15} /> Save SVG
            </button>
            <button type="button" class="button button-quiet" disabled={!svg} onClick={() => copy(svg, 'SVG')}>
              <Icon name="copy" size={14} /> Copy SVG
            </button>
            <button type="button" class="button button-quiet" disabled={!result || !!result.error} onClick={() => result && copy(result.mathml, 'MathML')} data-testid="eq-mathml">
              Copy MathML
            </button>
            <button type="button" class="button button-quiet" onClick={() => copy(state.display ? `$$\n${state.tex}\n$$` : `$${state.tex}$`, 'LaTeX for Markdown')}>
              Copy for Markdown
            </button>
          </div>
          <p class="control-help">
            MathJax draws standard LaTeX maths with the AMS, physics, mhchem (chemistry), cancel and colour packages. The SVG keeps its letters as shapes, so it looks the same in any program.
          </p>
        </div>
      </div>
    </section>
  );
}

function DocTools({ toolId }: { toolId: string }) {
  if (toolId === 'equation-editor') return <EquationEditor toolId={toolId} />;
  return <MarkdownEditor toolId={toolId} />;
}

export default defineCustomTool(DocTools);
