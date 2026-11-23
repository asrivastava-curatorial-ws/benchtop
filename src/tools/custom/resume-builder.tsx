/**
 * Resume Builder: fill in sections, pick a template, and save a PDF.  The
 * résumé stays in Reactive Resume's own format, so files move between this
 * tool and Reactive Resume (rxresu.me) both ways; JSON Resume files open and
 * save too.  The page preview is the same HTML that becomes the PDF.
 */

import barlow400i from '@fontsource/barlow/files/barlow-latin-400-italic.woff2?inline';
import barlow400 from '@fontsource/barlow/files/barlow-latin-400-normal.woff2?inline';
import barlow600 from '@fontsource/barlow/files/barlow-latin-600-normal.woff2?inline';
import barlow700 from '@fontsource/barlow/files/barlow-latin-700-normal.woff2?inline';
import barlowSemi600 from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal.woff2?inline';
import barlowSemi700 from '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-700-normal.woff2?inline';
import monoItalic from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-italic.woff2?inline';
import mono from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?inline';
import DOMPurify from 'dompurify';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type CustomSection,
  emptyResume,
  FIELDS,
  type FontFace,
  hexOf,
  type Item,
  isSectionType,
  itemLabel,
  newId,
  newItem,
  normalise,
  PAGE_MM,
  pageFormat,
  type Resume,
  readResumeFile,
  resumeFile,
  resumeHtml,
  rgbaOf,
  SECTION_LABELS,
  SECTION_TYPES,
  type Section,
  type SectionType,
  sampleResume,
  TEMPLATE_INFO,
  TEMPLATES,
  type TemplateId,
  templateOf,
  toJsonResume,
  type Website,
} from '../../lib/resume';
import { htmlToPdf, isDesktop, pickFiles, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { printDocument } from '../../ui/print';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

/* ---------------------------------------------------------- rich text -- */

const purifier = DOMPurify(window);

/** Rich text keeps paragraphs, lists, emphasis and web, mail and phone links; nothing else. */
export const cleanRich = (html: string): string =>
  purifier.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'code', 'ul', 'ol', 'li', 'a'],
    ALLOWED_ATTR: ['href'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
  });

function RichText({ value, onChange, label }: { value: string; onChange: (html: string) => void; label: string }) {
  const area = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const saved = useRef<Range | null>(null);
  const [linking, setLinking] = useState(false);
  const [address, setAddress] = useState('https://');
  useEffect(() => {
    if (area.current && value !== last.current) {
      area.current.innerHTML = cleanRich(value);
      last.current = value;
    }
  }, [value]);
  const emit = () => {
    if (!area.current) return;
    const html = cleanRich(area.current.innerHTML);
    last.current = html;
    onChange(html);
  };
  const run = (command: string, arg?: string) => {
    area.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };
  const tools: [string, string, () => void][] = [
    ['B', 'Bold', () => run('bold')],
    ['I', 'Italic', () => run('italic')],
    ['U', 'Underline', () => run('underline')],
    ['•', 'Bulleted list', () => run('insertUnorderedList')],
    ['1.', 'Numbered list', () => run('insertOrderedList')],
    [
      'Link',
      'Link the selected text',
      () => {
        // The address box takes the focus, so the selection is kept to be put back.
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        saved.current = range && area.current?.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
        setAddress('https://');
        setLinking(true);
      },
    ],
    ['Clear', 'Remove formatting', () => run('removeFormat')],
  ];
  const applyLink = () => {
    const raw = address.trim();
    const url = /^(https?:\/\/|mailto:|tel:)/i.test(raw) ? raw : /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(raw) ? `mailto:${raw}` : '';
    setLinking(false);
    if (!url || !saved.current) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(saved.current);
    run('createLink', url);
  };
  return (
    <div class="rx-rich">
      <div class="rx-rich-tools" role="toolbar" aria-label={`${label} formatting`}>
        {tools.map(([text, title, act]) => (
          <button
            key={title}
            type="button"
            class="button button-small md-tool-button"
            title={title}
            aria-label={text.length < 3 ? title : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={act}
          >
            {text}
          </button>
        ))}
        {linking && (
          <span class="rx-link-box">
            <input
              class="input"
              type="url"
              value={address}
              aria-label="Link address"
              ref={(el) => el?.focus()}
              onInput={(e) => setAddress(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                } else if (e.key === 'Escape') setLinking(false);
              }}
            />
            <button type="button" class="button button-small" onClick={applyLink}>
              Link
            </button>
          </span>
        )}
      </div>
      <div
        ref={area}
        class="rx-rich-area prose"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        tabIndex={0}
        onInput={emit}
        onPaste={(e) => {
          e.preventDefault();
          const html = e.clipboardData?.getData('text/html');
          const text = e.clipboardData?.getData('text/plain') ?? '';
          if (html) document.execCommand('insertHTML', false, cleanRich(html));
          else document.execCommand('insertText', false, text);
          emit();
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------- fonts -- */

const FONT_FACES: Record<string, readonly FontFace[]> = {
  Barlow: [
    { family: 'Barlow', weight: '400', style: 'normal', src: barlow400 },
    { family: 'Barlow', weight: '400', style: 'italic', src: barlow400i },
    { family: 'Barlow', weight: '600', style: 'normal', src: barlow600 },
    { family: 'Barlow', weight: '700', style: 'normal', src: barlow700 },
  ],
  'Barlow Semi Condensed': [
    { family: 'Barlow Semi Condensed', weight: '600', style: 'normal', src: barlowSemi600 },
    { family: 'Barlow Semi Condensed', weight: '700', style: 'normal', src: barlowSemi700 },
  ],
  'JetBrains Mono': [
    { family: 'JetBrains Mono', weight: '100 800', style: 'normal', src: mono },
    { family: 'JetBrains Mono', weight: '100 800', style: 'italic', src: monoItalic },
  ],
};

/** Fonts offered in the editor; the first three travel inside the PDF, the rest come from the computer. */
const FONT_CHOICES = ['Barlow', 'Barlow Semi Condensed', 'JetBrains Mono', 'Georgia', 'Times New Roman', 'Arial'];

const facesFor = (resume: Resume) => {
  const families = new Set([resume.metadata.typography.body.fontFamily, resume.metadata.typography.heading.fontFamily]);
  return [...families].flatMap((f) => FONT_FACES[f] ?? []);
};

/* -------------------------------------------------------------- state -- */

interface BuilderState {
  readonly resume: Resume;
  readonly panel: 'content' | 'design' | 'layout';
}

/** Big photos make big files; drafts over this size are not kept between sessions. */
const MAX_DRAFT = 600_000;

const readBuilder = (v: Values | undefined): BuilderState => {
  let resume = sampleResume();
  if (typeof v?.resume === 'string' && v.resume) {
    try {
      resume = normalise(JSON.parse(v.resume));
    } catch {
      resume = sampleResume();
    }
  }
  return { resume, panel: v?.panel === 'design' || v?.panel === 'layout' ? v.panel : 'content' };
};
const writeBuilder = (s: BuilderState): Values => {
  const text = JSON.stringify(s.resume);
  return { resume: text.length > MAX_DRAFT ? '' : text, panel: s.panel };
};

/** Shrinks a photo to at most 600 pixels across, as JPEG (or PNG when it has transparency). */
async function photoDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read the picture.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86);
}

const safeName = (text: string) =>
  text
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'resume';

/* ------------------------------------------------------------ editors -- */

/** A labelled form control; `children` is always the control itself. */
function Field({ label, children, wide }: { label: string; children: ComponentChildren; wide?: boolean }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control arrives as children
    <label class={`rx-field${wide ? ' rx-wide' : ''}`}>
      <span class="control-label">{label}</span>
      {children}
    </label>
  );
}

function ItemFields({ type, item, onChange }: { type: SectionType; item: Item; onChange: (item: Item) => void }) {
  const set = (key: string, value: unknown) => onChange({ ...item, [key]: value });
  return (
    <div class="rx-grid">
      {FIELDS[type].map((field) => {
        const value = item[field.key];
        if (field.kind === 'rich') {
          return (
            <div key={field.key} class="rx-field rx-wide">
              <span class="control-label">{field.label}</span>
              <RichText value={typeof value === 'string' ? value : ''} onChange={(html) => set(field.key, html)} label={`${field.label} of ${itemLabel(type, item)}`} />
            </div>
          );
        }
        if (field.kind === 'website') {
          const site = (value as Website | undefined) ?? { url: '', label: '' };
          return (
            <div key={field.key} class="rx-pair rx-wide">
              <Field label="Link (web address)">
                <input class="input" type="url" value={site.url} placeholder="https://" onInput={(e) => set(field.key, { ...site, url: e.currentTarget.value })} />
              </Field>
              <Field label="Link text (optional)">
                <input class="input" value={site.label} onInput={(e) => set(field.key, { ...site, label: e.currentTarget.value })} />
              </Field>
            </div>
          );
        }
        if (field.kind === 'level') {
          return (
            <Field key={field.key} label={`${field.label} (0 hides it)`}>
              <input
                class="input input-number"
                type="number"
                min={0}
                max={5}
                value={typeof value === 'number' ? value : 0}
                onInput={(e) => set(field.key, Math.min(5, Math.max(0, Math.round(Number(e.currentTarget.value) || 0))))}
              />
            </Field>
          );
        }
        if (field.kind === 'keywords') {
          return (
            <Field key={field.key} label={`${field.label} (comma between them)`} wide>
              <input
                class="input"
                value={Array.isArray(value) ? value.join(', ') : ''}
                onChange={(e) =>
                  set(
                    field.key,
                    e.currentTarget.value
                      .split(',')
                      .map((k) => k.trim())
                      .filter(Boolean),
                  )
                }
              />
            </Field>
          );
        }
        return (
          <Field key={field.key} label={field.label}>
            <input class="input" value={typeof value === 'string' ? value : ''} placeholder={field.placeholder} onInput={(e) => set(field.key, e.currentTarget.value)} />
          </Field>
        );
      })}
    </div>
  );
}

function SectionEditor({ id, type, section, onChange, onRemove }: { id: string; type: SectionType; section: Section; onChange: (s: Section) => void; onRemove?: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const move = (index: number, step: number) => {
    const items = [...section.items];
    const to = index + step;
    if (to < 0 || to >= items.length) return;
    const [moved] = items.splice(index, 1);
    items.splice(to, 0, moved as Item);
    onChange({ ...section, items });
  };
  const title = section.title || (onRemove ? 'Custom section' : SECTION_LABELS[type]);
  return (
    <details class="rx-section" data-testid={`rx-section-${id}`}>
      <summary>
        <span class="rx-section-title">{title}</span>
        <span class="tone-muted">
          {section.items.length} {section.items.length === 1 ? 'entry' : 'entries'}
          {section.hidden ? ', hidden' : ''}
        </span>
      </summary>
      <div class="rx-section-body">
        <div class="rx-grid">
          <Field label="Heading">
            <input class="input" value={section.title} placeholder={onRemove ? 'Custom section' : SECTION_LABELS[type]} onInput={(e) => onChange({ ...section, title: e.currentTarget.value })} />
          </Field>
          <Field label="Columns">
            <select class="select" value={String(section.columns)} onChange={(e) => onChange({ ...section, columns: Number(e.currentTarget.value) })}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <label class="check">
            <input type="checkbox" checked={!section.hidden} onChange={(e) => onChange({ ...section, hidden: !e.currentTarget.checked })} /> Show on the page
          </label>
          <label class="check">
            <input type="checkbox" checked={!!section.startOnNewPage} onChange={(e) => onChange({ ...section, startOnNewPage: e.currentTarget.checked })} /> Start on a new page
          </label>
        </div>
        <ol class="rx-items">
          {section.items.map((item, index) => (
            <li key={item.id} class={item.hidden ? 'is-hidden' : ''}>
              <div class="rx-item-head">
                <button type="button" class="link-button rx-item-name" aria-expanded={open === item.id} onClick={() => setOpen(open === item.id ? null : item.id)}>
                  {itemLabel(type, item)}
                </button>
                <span class="rx-item-actions">
                  <button type="button" class="button button-small button-quiet" title="Move up" aria-label={`Move ${itemLabel(type, item)} up`} onClick={() => move(index, -1)}>
                    <Icon name="up" size={13} />
                  </button>
                  <button type="button" class="button button-small button-quiet" title="Move down" aria-label={`Move ${itemLabel(type, item)} down`} onClick={() => move(index, 1)}>
                    <Icon name="down" size={13} />
                  </button>
                  <button
                    type="button"
                    class="button button-small button-quiet"
                    title={item.hidden ? 'Show' : 'Hide'}
                    aria-label={`${item.hidden ? 'Show' : 'Hide'} ${itemLabel(type, item)}`}
                    onClick={() => onChange({ ...section, items: section.items.map((x) => (x.id === item.id ? { ...x, hidden: !x.hidden } : x)) })}
                  >
                    <Icon name="eye" size={13} />
                  </button>
                  <button
                    type="button"
                    class="button button-small button-quiet"
                    title="Delete"
                    aria-label={`Delete ${itemLabel(type, item)}`}
                    onClick={() => onChange({ ...section, items: section.items.filter((x) => x.id !== item.id) })}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              </div>
              {open === item.id && <ItemFields type={type} item={item} onChange={(next) => onChange({ ...section, items: section.items.map((x) => (x.id === item.id ? next : x)) })} />}
            </li>
          ))}
        </ol>
        <div class="button-row">
          <button
            type="button"
            class="button button-small"
            data-testid={`rx-add-${id}`}
            onClick={() => {
              const item = newItem(type);
              onChange({ ...section, items: [...section.items, item] });
              setOpen(item.id);
            }}
          >
            <Icon name="plus" size={13} /> Add an entry
          </button>
          {onRemove && (
            <button type="button" class="button button-small button-quiet" onClick={onRemove}>
              <Icon name="trash" size={13} /> Remove this section
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------- the tool -- */

function ResumeBuilder({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readBuilder, writeBuilder);
  const resume = state.resume;
  const [busy, setBusy] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const [width, setWidth] = useState(600);
  const frameBox = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const change = (next: (r: Resume) => Resume) => setState((s) => ({ ...s, resume: next(s.resume) }));
  const template = templateOf(resume);
  const format = pageFormat(resume);
  const [pageW, pageH] = PAGE_MM[format];
  const html = useMemo(() => resumeHtml(resume, { clean: cleanRich, fonts: facesFor(resume) }), [resume]);
  const [shown, setShown] = useState(html);

  // The preview catches up after a short pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => setShown(html), 250);
    return () => clearTimeout(timer);
  }, [html]);

  useEffect(() => {
    const box = frameBox.current;
    if (!box) return;
    const measure = () => setWidth(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  /** Page width in CSS pixels (96 per inch), and the printable height of one page. */
  const pagePx = (pageW / 25.4) * 96;
  const usable = ((pageH / 25.4) * 72 - resume.metadata.page.marginY * 2) * (96 / 72);
  const scale = width / pagePx;

  const marginPx = resume.metadata.page.marginY * (96 / 72);
  const measurePages = () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    const count = () => setPages(Math.max(1, Math.ceil((doc.body.offsetHeight - 2 * marginPx - 2) / usable)));
    count();
    // Embedded fonts finish loading after the page itself; measure again then.
    void doc.fonts?.ready.then(count);
  };

  const setBasics = (key: keyof Resume['basics'], value: unknown) => change((r) => ({ ...r, basics: { ...r.basics, [key]: value } }));
  const setMeta = (next: (m: Resume['metadata']) => Resume['metadata']) => change((r) => ({ ...r, metadata: next(r.metadata) }));

  const open = () =>
    attempt(async () => {
      const [file] = await pickFiles('.json,application/json');
      if (!file) return;
      const { resume: next, format: kind } = readResumeFile(await file.text());
      setState((s) => ({ ...s, resume: next }));
      notify(`Opened ${file.name} (${kind})`);
    });

  const baseName = () => safeName(resume.basics.name ? `${resume.basics.name} résumé` : 'resume');

  const save = (kind: 'pdf' | 'reactive' | 'jsonresume' | 'html') =>
    attempt(async () => {
      setBusy(kind);
      try {
        let outcome: Awaited<ReturnType<typeof saveFile>>;
        if (kind === 'reactive') outcome = await saveFile(`${baseName()}.json`, resumeFile(resume), 'application/json');
        else if (kind === 'jsonresume') outcome = await saveFile(`${baseName()}.resume.json`, `${JSON.stringify(toJsonResume(resume), null, 2)}\n`, 'application/json');
        else if (kind === 'html') outcome = await saveFile(`${baseName()}.html`, html, 'text/html');
        else {
          if (!isDesktop) {
            printDocument(html);
            return;
          }
          outcome = await saveFile(`${baseName()}.pdf`, await htmlToPdf(html, { paper: format === 'letter' ? 'Letter' : 'A4' }), 'application/pdf');
        }
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      } finally {
        setBusy(null);
      }
    });

  const setPhoto = () =>
    attempt(async () => {
      const [file] = await pickFiles('image/*');
      if (!file) return;
      const url = await photoDataUrl(file);
      change((r) => ({ ...r, picture: { ...r.picture, url, hidden: false } }));
    });

  /* ----------------------------------------------------------- layout -- */

  const page = resume.metadata.layout.pages[0] ?? { fullWidth: false, main: [], sidebar: [] };
  const allIds = ['summary', ...SECTION_TYPES, ...resume.customSections.map((c) => c.id)];
  const placed = new Set(resume.metadata.layout.pages.flatMap((p) => [...p.main, ...p.sidebar]));
  const missing = allIds.filter((id) => !placed.has(id));
  const nameOf = (id: string) => {
    if (id === 'summary') return resume.summary.title || SECTION_LABELS.summary;
    if (isSectionType(id)) return resume.sections[id].title || SECTION_LABELS[id];
    return resume.customSections.find((c) => c.id === id)?.title || 'Custom section';
  };
  const setPage = (next: typeof page) => setMeta((m) => ({ ...m, layout: { ...m.layout, pages: [next, ...m.layout.pages.slice(1)] } }));
  const moveIn = (column: 'main' | 'sidebar', index: number, step: number) => {
    const list = [...page[column]];
    const to = index + step;
    if (to < 0 || to >= list.length) return;
    const [moved] = list.splice(index, 1);
    list.splice(to, 0, moved as string);
    setPage({ ...page, [column]: list });
  };
  const switchColumn = (column: 'main' | 'sidebar', index: number) => {
    const other = column === 'main' ? 'sidebar' : 'main';
    const id = page[column][index] as string;
    setPage({ ...page, [column]: page[column].filter((_, i) => i !== index), [other]: [...page[other], id] });
  };

  const customEditor = (c: CustomSection) => {
    const type = isSectionType(c.type) ? c.type : 'projects';
    return (
      <SectionEditor
        key={c.id}
        id={c.id}
        type={type}
        section={c}
        onChange={(next) => change((r) => ({ ...r, customSections: r.customSections.map((x) => (x.id === c.id ? { ...(next as CustomSection), id: c.id, type: c.type } : x)) }))}
        onRemove={() =>
          change((r) => ({
            ...r,
            customSections: r.customSections.filter((x) => x.id !== c.id),
            metadata: {
              ...r.metadata,
              layout: { ...r.metadata.layout, pages: r.metadata.layout.pages.map((p) => ({ ...p, main: p.main.filter((id) => id !== c.id), sidebar: p.sidebar.filter((id) => id !== c.id) })) },
            },
          }))
        }
      />
    );
  };

  const [customType, setCustomType] = useState<SectionType>('projects');

  return (
    <section class="tool rx-tool" data-testid="tool" data-state="done">
      <div class="button-row rx-files">
        <button type="button" class="button button-small" onClick={open} data-testid="rx-open">
          <Icon name="open" size={15} /> Open
        </button>
        <button type="button" class="button button-small button-quiet" onClick={() => setState((s) => ({ ...s, resume: sampleResume() }))}>
          <Icon name="sample" size={15} /> Sample
        </button>
        <button type="button" class="button button-small button-quiet" onClick={() => setState((s) => ({ ...s, resume: { ...emptyResume(), benchtop: { template } } }))}>
          <Icon name="plus" size={15} /> New
        </button>
        <span class="rx-save" role="group" aria-label="Save">
          <span class="control-label">Save as</span>
          <button type="button" class="button button-small button-primary" disabled={busy !== null} onClick={() => save('pdf')} data-testid="rx-pdf">
            PDF
          </button>
          <button type="button" class="button button-small" disabled={busy !== null} onClick={() => save('reactive')} data-testid="rx-reactive">
            Reactive Resume
          </button>
          <button type="button" class="button button-small" disabled={busy !== null} onClick={() => save('jsonresume')} data-testid="rx-jsonresume">
            JSON Resume
          </button>
          <button type="button" class="button button-small" disabled={busy !== null} onClick={() => save('html')} data-testid="rx-html">
            Web page
          </button>
        </span>
      </div>

      <div class="rx-layout">
        <div class="rx-editor">
          <Segmented
            label="Editor"
            value={state.panel}
            onChange={(panel) => setState((s) => ({ ...s, panel }))}
            choices={[
              { value: 'content', label: 'Content' },
              { value: 'design', label: 'Design' },
              { value: 'layout', label: 'Layout' },
            ]}
          />

          {state.panel === 'content' && (
            <div class="rx-panel">
              <details class="rx-section" open>
                <summary>
                  <span class="rx-section-title">About you</span>
                </summary>
                <div class="rx-section-body">
                  <div class="rx-grid">
                    <Field label="Full name">
                      <input class="input" value={resume.basics.name} onInput={(e) => setBasics('name', e.currentTarget.value)} data-testid="rx-name" />
                    </Field>
                    <Field label="Headline">
                      <input class="input" value={resume.basics.headline} placeholder="What you do, in a few words" onInput={(e) => setBasics('headline', e.currentTarget.value)} />
                    </Field>
                    <Field label="E-mail">
                      <input class="input" type="email" value={resume.basics.email} onInput={(e) => setBasics('email', e.currentTarget.value)} />
                    </Field>
                    <Field label="Phone">
                      <input class="input" type="tel" value={resume.basics.phone} onInput={(e) => setBasics('phone', e.currentTarget.value)} />
                    </Field>
                    <Field label="Location">
                      <input class="input" value={resume.basics.location} onInput={(e) => setBasics('location', e.currentTarget.value)} />
                    </Field>
                    <Field label="Website">
                      <input
                        class="input"
                        type="url"
                        value={resume.basics.website.url}
                        placeholder="https://"
                        onInput={(e) => setBasics('website', { ...resume.basics.website, url: e.currentTarget.value })}
                      />
                    </Field>
                  </div>
                  <div class="rx-photo">
                    {resume.picture.url ? <img src={resume.picture.url} alt="Your portrait" /> : <span class="tone-muted">No photo</span>}
                    <button type="button" class="button button-small" onClick={setPhoto}>
                      <Icon name="image" size={13} /> {resume.picture.url ? 'Change photo' : 'Add a photo'}
                    </button>
                    {resume.picture.url && (
                      <>
                        <label class="check">
                          <input type="checkbox" checked={!resume.picture.hidden} onChange={(e) => change((r) => ({ ...r, picture: { ...r.picture, hidden: !e.currentTarget.checked } }))} /> Show
                        </label>
                        <button type="button" class="button button-small button-quiet" onClick={() => change((r) => ({ ...r, picture: { ...r.picture, url: '' } }))}>
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </details>
              <details class="rx-section" data-testid="rx-section-summary">
                <summary>
                  <span class="rx-section-title">{resume.summary.title || SECTION_LABELS.summary}</span>
                  <span class="tone-muted">{resume.summary.hidden ? 'hidden' : ''}</span>
                </summary>
                <div class="rx-section-body">
                  <div class="rx-grid">
                    <Field label="Heading">
                      <input
                        class="input"
                        value={resume.summary.title}
                        placeholder={SECTION_LABELS.summary}
                        onInput={(e) => change((r) => ({ ...r, summary: { ...r.summary, title: e.currentTarget.value } }))}
                      />
                    </Field>
                    <label class="check">
                      <input type="checkbox" checked={!resume.summary.hidden} onChange={(e) => change((r) => ({ ...r, summary: { ...r.summary, hidden: !e.currentTarget.checked } }))} /> Show on the
                      page
                    </label>
                  </div>
                  <RichText value={resume.summary.content} onChange={(content) => change((r) => ({ ...r, summary: { ...r.summary, content } }))} label="Summary" />
                </div>
              </details>
              {SECTION_TYPES.map((type) => (
                <SectionEditor key={type} id={type} type={type} section={resume.sections[type]} onChange={(next) => change((r) => ({ ...r, sections: { ...r.sections, [type]: next } }))} />
              ))}
              {resume.customSections.map(customEditor)}
              <div class="rx-add-custom">
                <span class="control-label">New section with entries like</span>
                <select
                  class="select select-small"
                  value={customType}
                  onChange={(e) => setCustomType(isSectionType(e.currentTarget.value) ? e.currentTarget.value : 'projects')}
                  aria-label="Kind of entries"
                >
                  {SECTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {SECTION_LABELS[type]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  class="button button-small"
                  onClick={() => {
                    const id = newId();
                    change((r) => ({
                      ...r,
                      customSections: [
                        ...r.customSections,
                        { title: 'New section', icon: '', columns: 1, hidden: false, showHeading: true, keepTogether: false, startOnNewPage: false, items: [], id, type: customType },
                      ],
                      metadata: { ...r.metadata, layout: { ...r.metadata.layout, pages: r.metadata.layout.pages.map((p, i) => (i === 0 ? { ...p, main: [...p.main, id] } : p)) } },
                    }));
                  }}
                >
                  <Icon name="plus" size={13} /> Add section
                </button>
              </div>
            </div>
          )}

          {state.panel === 'design' && (
            <div class="rx-panel">
              <div class="rx-templates" role="radiogroup" aria-label="Template">
                {TEMPLATES.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={id === template}
                    class={`rx-template${id === template ? ' is-active' : ''}`}
                    onClick={() => change((r) => ({ ...r, benchtop: { template: id as TemplateId } }))}
                    data-testid={`rx-template-${id}`}
                  >
                    <span class={`rx-thumb rx-thumb-${id}`} aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <strong>{TEMPLATE_INFO[id].name}</strong>
                    <span class="tone-muted">{TEMPLATE_INFO[id].about}</span>
                  </button>
                ))}
              </div>
              <div class="rx-grid">
                <Field label="Accent colour">
                  <input
                    type="color"
                    class="rx-colour"
                    value={hexOf(resume.metadata.design.colors.primary)}
                    onInput={(e) => setMeta((m) => ({ ...m, design: { ...m.design, colors: { ...m.design.colors, primary: rgbaOf(e.currentTarget.value) } } }))}
                  />
                </Field>
                <Field label="Text colour">
                  <input
                    type="color"
                    class="rx-colour"
                    value={hexOf(resume.metadata.design.colors.text)}
                    onInput={(e) => setMeta((m) => ({ ...m, design: { ...m.design, colors: { ...m.design.colors, text: rgbaOf(e.currentTarget.value) } } }))}
                  />
                </Field>
                {(['body', 'heading'] as const).map((part) => (
                  <Field key={part} label={part === 'body' ? 'Text font' : 'Heading font'}>
                    <select
                      class="select"
                      value={resume.metadata.typography[part].fontFamily}
                      onChange={(e) => setMeta((m) => ({ ...m, typography: { ...m.typography, [part]: { ...m.typography[part], fontFamily: e.currentTarget.value } } }))}
                    >
                      {[...new Set([...FONT_CHOICES, resume.metadata.typography[part].fontFamily])].map((f) => (
                        <option key={f} value={f}>
                          {f}
                          {FONT_FACES[f] ? '' : FONT_CHOICES.includes(f) ? ' (from this computer)' : ' (if installed)'}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
                <Field label="Text size (pt)">
                  <input
                    class="input input-number"
                    type="number"
                    min={6}
                    max={16}
                    step={0.5}
                    value={resume.metadata.typography.body.fontSize}
                    onChange={(e) =>
                      setMeta((m) => ({ ...m, typography: { ...m.typography, body: { ...m.typography.body, fontSize: Math.min(16, Math.max(6, Number(e.currentTarget.value) || 10)) } } }))
                    }
                  />
                </Field>
                <Field label="Heading size (pt)">
                  <input
                    class="input input-number"
                    type="number"
                    min={8}
                    max={24}
                    step={0.5}
                    value={resume.metadata.typography.heading.fontSize}
                    onChange={(e) =>
                      setMeta((m) => ({ ...m, typography: { ...m.typography, heading: { ...m.typography.heading, fontSize: Math.min(24, Math.max(8, Number(e.currentTarget.value) || 14)) } } }))
                    }
                  />
                </Field>
                <Field label="Line spacing">
                  <input
                    class="input input-number"
                    type="number"
                    min={1}
                    max={2.2}
                    step={0.05}
                    value={resume.metadata.typography.body.lineHeight}
                    onChange={(e) =>
                      setMeta((m) => ({ ...m, typography: { ...m.typography, body: { ...m.typography.body, lineHeight: Math.min(2.2, Math.max(1, Number(e.currentTarget.value) || 1.45)) } } }))
                    }
                  />
                </Field>
                <Field label="Paper">
                  <select
                    class="select"
                    value={format}
                    onChange={(e) => setMeta((m) => ({ ...m, page: { ...m.page, format: e.currentTarget.value === 'letter' ? 'letter' : 'a4' } }))}
                    data-testid="rx-paper"
                  >
                    <option value="a4">A4</option>
                    <option value="letter">US Letter</option>
                  </select>
                </Field>
                <Field label="Side margins (pt)">
                  <input
                    class="input input-number"
                    type="number"
                    min={0}
                    max={72}
                    value={resume.metadata.page.marginX}
                    onChange={(e) => setMeta((m) => ({ ...m, page: { ...m.page, marginX: Math.min(72, Math.max(0, Number(e.currentTarget.value) || 0)) } }))}
                  />
                </Field>
                <Field label="Top and bottom margins (pt)">
                  <input
                    class="input input-number"
                    type="number"
                    min={0}
                    max={72}
                    value={resume.metadata.page.marginY}
                    onChange={(e) => setMeta((m) => ({ ...m, page: { ...m.page, marginY: Math.min(72, Math.max(0, Number(e.currentTarget.value) || 0)) } }))}
                  />
                </Field>
                <Field label="Space between entries (pt)">
                  <input
                    class="input input-number"
                    type="number"
                    min={0}
                    max={30}
                    value={resume.metadata.page.gapY}
                    onChange={(e) => setMeta((m) => ({ ...m, page: { ...m.page, gapY: Math.min(30, Math.max(0, Number(e.currentTarget.value) || 0)) } }))}
                  />
                </Field>
                <Field label="Photo size (pt)">
                  <input
                    class="input input-number"
                    type="number"
                    min={32}
                    max={200}
                    value={resume.picture.size}
                    onChange={(e) => change((r) => ({ ...r, picture: { ...r.picture, size: Math.min(200, Math.max(32, Number(e.currentTarget.value) || 80)) } }))}
                  />
                </Field>
                <Field label="Photo corners (pt, large = round)">
                  <input
                    class="input input-number"
                    type="number"
                    min={0}
                    max={100}
                    value={resume.picture.borderRadius}
                    onChange={(e) => change((r) => ({ ...r, picture: { ...r.picture, borderRadius: Math.min(100, Math.max(0, Number(e.currentTarget.value) || 0)) } }))}
                  />
                </Field>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={!resume.metadata.page.hideLinkUnderline}
                    onChange={(e) => setMeta((m) => ({ ...m, page: { ...m.page, hideLinkUnderline: !e.currentTarget.checked } }))}
                  />{' '}
                  Underline links
                </label>
              </div>
              <p class="control-help">Barlow and JetBrains Mono travel inside the PDF; other fonts come from this computer. Reactive Resume's own fonts are used when they are installed here.</p>
            </div>
          )}

          {state.panel === 'layout' && (
            <div class="rx-panel">
              <p class="control-help">
                {TEMPLATE_INFO[template].columns === 2 ? 'This template puts the side column next to the main one.' : 'This template has one column: the side column follows the main one.'} Sections
                without entries are left out.
              </p>
              <label class="check">
                <input type="checkbox" checked={page.fullWidth} onChange={(e) => setPage({ ...page, fullWidth: e.currentTarget.checked })} /> One column on this template too
              </label>
              <Field label={`Side column width: ${resume.metadata.layout.sidebarWidth}%`}>
                <input
                  type="range"
                  min={20}
                  max={45}
                  value={resume.metadata.layout.sidebarWidth}
                  onInput={(e) => setMeta((m) => ({ ...m, layout: { ...m.layout, sidebarWidth: Number(e.currentTarget.value) } }))}
                />
              </Field>
              <div class="rx-columns">
                {(['main', 'sidebar'] as const).map((column) => (
                  <div key={column} class="rx-column" data-testid={`rx-layout-${column}`}>
                    <span class="pane-title">{column === 'main' ? 'Main column' : 'Side column'}</span>
                    <ol>
                      {page[column].map((id, index) => (
                        <li key={id}>
                          <span>{nameOf(id)}</span>
                          <span class="rx-item-actions">
                            <button type="button" class="button button-small button-quiet" aria-label={`Move ${nameOf(id)} up`} onClick={() => moveIn(column, index, -1)}>
                              <Icon name="up" size={13} />
                            </button>
                            <button type="button" class="button button-small button-quiet" aria-label={`Move ${nameOf(id)} down`} onClick={() => moveIn(column, index, 1)}>
                              <Icon name="down" size={13} />
                            </button>
                            <button
                              type="button"
                              class="button button-small button-quiet"
                              aria-label={`Move ${nameOf(id)} to the ${column === 'main' ? 'side' : 'main'} column`}
                              onClick={() => switchColumn(column, index)}
                            >
                              <Icon name={column === 'main' ? 'right' : 'left'} size={13} />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
              {missing.length > 0 && (
                <div class="rx-missing">
                  <span class="control-label">Not on the page</span>
                  {missing.map((id) => (
                    <button key={id} type="button" class="button button-small" onClick={() => setPage({ ...page, main: [...page.main, id] })}>
                      <Icon name="plus" size={13} /> {nameOf(id)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div class="rx-preview">
          <div class="rx-paper-box" ref={frameBox} style={{ height: `${(pages * usable + marginPx * 2) * scale}px` }}>
            <iframe
              ref={frame}
              title="Page preview"
              class="rx-frame"
              sandbox="allow-same-origin"
              srcdoc={`${shown.replace('</style>', `body{padding:${resume.metadata.page.marginY}pt ${resume.metadata.page.marginX}pt;}html{overflow:hidden;}</style>`)}`}
              style={{ width: `${pagePx}px`, height: `${Math.ceil(pages * usable + marginPx * 2)}px`, transform: `scale(${scale})` }}
              onLoad={measurePages}
              data-testid="rx-frame"
            />
            {Array.from({ length: pages - 1 }, (_, i) => (
              <span key={i} class="rx-break" style={{ top: `${((i + 1) * usable + marginPx) * scale}px` }} aria-hidden="true" />
            ))}
          </div>
          <p class="tone-muted rx-pages" data-testid="rx-pages" aria-live="polite">
            About {pages} {pages === 1 ? 'page' : 'pages'} on {format === 'letter' ? 'US Letter' : 'A4'}; dashed lines mark page breaks.
            {busy && ` Saving ${busy === 'pdf' ? 'PDF' : 'file'}…`}
          </p>
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(ResumeBuilder);
