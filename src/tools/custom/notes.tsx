/**
 * Notes: rich text, Markdown with maths, code, checklists, links with saved
 * PDF copies of the page, sketches and mind maps, and any files (pictures,
 * video, audio, PDFs, 3D models, documents).  Pasting, dropping or importing a file stores a copy in
 * the note, so the note stays whole when the original goes.  Notes are kept
 * in the app and travel as .bnote files.
 */
import DOMPurify from 'dompurify';
import type { ComponentChildren, InputHTMLAttributes } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../../lib/errors';
import { renderMarkdown } from '../../lib/markdown-doc';
import {
  type Attachment,
  type Block,
  type BlockType,
  emptyNote,
  type FileKind,
  fileKind,
  formatSize,
  mimeOf,
  type Note,
  newId,
  noteHtml,
  noteMarkdownZip,
  noteText,
  noteTitle,
  packNote,
  pruneAttachments,
  type SketchExport,
  safeName,
  sha256Hex,
  unpackNote,
} from '../../lib/notes-format';
import { collectFiles, deleteNote, getFile, listNotes, noteFiles, putFile, saveNote, storageUse, takeWantedNote } from '../../lib/notes-store';
import { openPdf, renderPage } from '../../lib/pdf-render';
import { emptyScene, type Scene } from '../../lib/sketch-model';
import { escapeHtml } from '../../lib/text';
import { htmlToPdf, isDesktop, openLink, readLocalFile, saveFile, urlToPdf } from '../../platform';
import { Icon } from '../../ui/icons';
import { type ModelScene, mountModel } from '../../ui/model-view';
import { printDocument } from '../../ui/print';
import { sanitizeHtml } from '../../ui/sanitize';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';
import { loadTex } from './doc-tools';

const MAX_FILE = 1024 * 1024 * 1024;

/* ------------------------------------------------------------ sanitising -- */

const purifier = DOMPurify(window);
purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof Element && node.hasAttribute('href') && !/^(https?:|mailto:)/i.test(node.getAttribute('href') ?? '')) node.removeAttribute('href');
});

/** Rich text kept in notes: structure and emphasis, links; no styles, scripts or remote pictures. */
export function cleanNoteHtml(html: string): string {
  return purifier.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'div',
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'strike',
      'del',
      'code',
      'pre',
      'a',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'blockquote',
      'sub',
      'sup',
      'mark',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'hr',
    ],
    ALLOWED_ATTR: ['href'],
    ALLOW_DATA_ATTR: false,
  });
}

/* ----------------------------------------------------------- file cache -- */

const urls = new Map<string, string>();

/** An object URL for a stored file, made once per session. */
function useFileUrl(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (id ? (urls.get(id) ?? null) : null));
  useEffect(() => {
    if (!id) return;
    const known = urls.get(id);
    if (known) {
      setUrl(known);
      return;
    }
    let live = true;
    void getFile(id).then((blob) => {
      if (!blob || !live) return;
      const made = URL.createObjectURL(blob);
      urls.set(id, made);
      setUrl(made);
    });
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}

async function fileBytes(id: string): Promise<Uint8Array> {
  const blob = await getFile(id);
  if (!blob) throw new Error('This file is missing from the note storage.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Stores a copy of a file and describes it. */
async function storeFile(file: Blob, name: string): Promise<Attachment> {
  if (file.size > MAX_FILE) throw new Error(`${name} is larger than 1 GB, too large to keep in a note.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const attachment: Attachment = { id: await sha256Hex(bytes), name: safeName(name), type: mimeOf(name, file.type), size: bytes.length };
  await putFile(attachment, new Blob([bytes as BlobPart], { type: attachment.type }));
  return attachment;
}

/** Files and folders from a drop, folders walked through. */
async function droppedFiles(data: DataTransfer): Promise<File[]> {
  const entries = [...data.items].map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null)).filter((e): e is FileSystemEntry => !!e);
  if (!entries.some((e) => e.isDirectory)) return [...data.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch.sort((a, b) => a.name.localeCompare(b.name))) if (!child.name.startsWith('.')) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}

/** Files copied in a file manager arrive as file:// addresses; the desktop app reads them. */
async function filesFromUriList(text: string): Promise<File[]> {
  if (!isDesktop) return [];
  const paths = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('file://'));
  const out: File[] = [];
  for (const uri of paths) {
    const path = decodeURIComponent(new URL(uri).pathname).replace(/^\/([A-Za-z]:)/, '$1');
    const { name, bytes } = await readLocalFile(path);
    out.push(new File([bytes as BlobPart], name, { type: mimeOf(name) }));
  }
  return out;
}

/** A ref that moves focus to its element once, when it appears. */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

function FocusedInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const ref = useFocusOnMount<HTMLInputElement>();
  return <input ref={ref} {...props} />;
}

/* ----------------------------------------------------------------- state -- */

interface UiState {
  readonly current: string;
}
const readUi = (v: Values | undefined): UiState => ({ current: typeof v?.current === 'string' ? v.current : '' });
const writeUi = (s: UiState): Values => ({ ...s });

const BLOCK_LABEL: Record<BlockType, string> = { text: 'Text', markdown: 'Markdown', code: 'Code', checklist: 'Checklist', divider: 'Divider', link: 'Link', file: 'File', sketch: 'Sketch' };

function newBlock(type: Exclude<BlockType, 'file'>): Block {
  const id = newId();
  switch (type) {
    case 'text':
      return { id, type, html: '' };
    case 'markdown':
      return { id, type, source: '' };
    case 'code':
      return { id, type, source: '', language: 'text' };
    case 'checklist':
      return { id, type, items: [{ text: '', done: false }] };
    case 'divider':
      return { id, type };
    case 'link':
      return { id, type, url: '', title: '', note: '' };
    case 'sketch':
      return { id, type, scene: emptyScene() };
  }
}

const relativeTime = (iso: string) => {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days < 1) return then.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if (days < 7) return then.toLocaleDateString('en-IN', { weekday: 'short' });
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
};

/* ------------------------------------------------------------------ tool -- */

function Notes({ toolId }: { toolId: string }) {
  const [ui, setUi] = usePersistentState(toolId, readUi, writeUi);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error'>('saved');
  const [storeError, setStoreError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<Note | null>(null);

  // Load the library; start with a note when it is empty.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        let list = await listNotes();
        if (!list.length) {
          const first = emptyNote('');
          await saveNote(first);
          list = [first];
        }
        if (!live) return;
        setNotes(list);
        // A note asked for by another tool (a search result) comes first.
        const wanted = takeWantedNote();
        const asked = wanted ? list.find((n) => n.id === wanted) : undefined;
        if (asked) setUi({ current: asked.id });
        setNote(asked ?? list.find((n) => n.id === ui.current) ?? (list[0] as Note));
        void collectFiles().catch(() => {});
      } catch (e) {
        if (live) setStoreError(errorMessage(e));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const flush = async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const current = latest.current;
    if (!current) return;
    try {
      await saveNote(current);
      setSaved('saved');
    } catch (e) {
      setSaved('error');
      notify(errorMessage(e), 'error');
    }
  };

  // Save shortly after the last change, and when leaving.
  useEffect(
    () => () => {
      if (timer.current !== undefined) void flush();
    },
    [],
  );

  const change = (update: (n: Note) => Note) => {
    setNote((n) => {
      if (!n) return n;
      const next = { ...update(n), modified: new Date().toISOString() };
      latest.current = next;
      setNotes((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? list);
      return next;
    });
    setSaved('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 400);
  };

  const open = async (target: Note) => {
    if (timer.current !== undefined) await flush();
    latest.current = null;
    setNote(target);
    setUi({ current: target.id });
  };

  const create = async (from?: Note) => {
    const fresh = from ?? emptyNote('');
    await saveNote(fresh);
    setNotes((list) => [fresh, ...(list ?? [])]);
    await open(fresh);
  };

  const remove = async (target: Note) => {
    await deleteNote(target.id);
    const rest = (notes ?? []).filter((n) => n.id !== target.id);
    if (!rest.length) {
      await create();
      setNotes((list) => list?.filter((n) => n.id !== target.id) ?? list);
      return;
    }
    setNotes(rest);
    if (note?.id === target.id) await open(rest[0] as Note);
  };

  const importNotes = async (files: File[]) => {
    for (const file of files) {
      const { note: imported, files: bytes } = unpackNote(new Uint8Array(await file.arrayBuffer()));
      for (const a of imported.attachments) {
        const data = bytes.get(a.id);
        if (data) await putFile(a, new Blob([data as BlobPart], { type: a.type }));
      }
      // A copy keeps its own identity if the same note is already here.
      const exists = notes?.some((n) => n.id === imported.id);
      await create(exists ? { ...imported, id: newId() } : imported);
    }
    notify(files.length === 1 ? 'Note opened' : `${files.length} notes opened`);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = notes ?? [];
    return q ? list.filter((n) => noteText(n).toLowerCase().includes(q)) : list;
  }, [notes, query]);

  if (storeError)
    return (
      <section class="tool" data-testid="tool" data-state="error">
        <p class="recipe-error" role="alert">
          {storeError}
        </p>
      </section>
    );

  return (
    <section class="tool nt-tool" data-testid="tool" data-state={note ? 'done' : 'idle'}>
      <div class="nt-layout">
        <aside class="nt-list" aria-label="Notes">
          <div class="nt-list-top">
            <button type="button" class="button button-primary" onClick={() => void attempt(() => create())} data-testid="nt-new">
              <Icon name="plus" size={15} /> New note
            </button>
            <label class="button button-quiet nt-import" title="Open .bnote files">
              <Icon name="open" size={14} /> Open
              <input
                type="file"
                accept=".bnote,application/vnd.benchtop.note+zip"
                multiple
                hidden
                data-testid="nt-import"
                onChange={(e) => {
                  const files = [...(e.currentTarget.files ?? [])];
                  e.currentTarget.value = '';
                  void attempt(() => importNotes(files));
                }}
              />
            </label>
          </div>
          <input class="input" type="search" placeholder="Search notes" aria-label="Search notes" value={query} onInput={(e) => setQuery(e.currentTarget.value)} data-testid="nt-search" />
          <ul class="nt-items" data-testid="nt-items">
            {visible.map((n) => (
              <li key={n.id}>
                <button type="button" class={`nt-item${n.id === note?.id ? ' is-active' : ''}`} aria-current={n.id === note?.id ? 'true' : undefined} onClick={() => void attempt(() => open(n))}>
                  <span class="nt-item-title">
                    {n.pinned && (
                      <span class="nt-pin" title="Pinned">
                        📌{' '}
                      </span>
                    )}
                    {noteTitle(n)}
                  </span>
                  <span class="nt-item-meta">
                    {relativeTime(n.modified)}
                    {n.attachments.length > 0 && ` · ${n.attachments.length} ${n.attachments.length === 1 ? 'file' : 'files'}`}
                  </span>
                </button>
              </li>
            ))}
            {notes && visible.length === 0 && <li class="tone-muted nt-empty">No note contains “{query}”.</li>}
          </ul>
          <StorageNote />
        </aside>
        {note ? <NoteEditor key={note.id} note={note} change={change} saved={saved} onDelete={() => void attempt(() => remove(note))} /> : <p class="tone-muted">Loading notes…</p>}
      </div>
    </section>
  );
}

function StorageNote() {
  const [use, setUse] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => {
    void storageUse().then(setUse);
  }, []);
  if (!use) return null;
  return <p class="nt-storage tone-muted">Notes are kept on this computer ({formatSize(use.used)} used). Export a note as a .bnote file to share or back it up.</p>;
}

/* --------------------------------------------------------------- editor -- */

interface EditorProps {
  readonly note: Note;
  readonly change: (update: (n: Note) => Note) => void;
  readonly saved: 'saved' | 'saving' | 'error';
  readonly onDelete: () => void;
}

function NoteEditor({ note, change, saved, onDelete }: EditorProps) {
  const [active, setActive] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(0);
  const [deleted, setDeleted] = useState<{ block: Block; index: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const setBlocks = (update: (blocks: readonly Block[]) => readonly Block[]) => change((n) => ({ ...n, blocks: update(n.blocks) }));
  const updateBlock = (id: string, patch: Partial<Block>) => setBlocks((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)));
  const insertAfter = (after: string | null, blocks: Block[]) => {
    const last = blocks[blocks.length - 1];
    if (last) setActive(last.id);
    setBlocks((bs) => {
      const i = after ? bs.findIndex((b) => b.id === after) : -1;
      const at = i < 0 ? bs.length : i + 1;
      // An empty text block at the insertion point is replaced rather than left behind.
      const prev = bs[at - 1];
      if (prev && prev.type === 'text' && !prev.html.replace(/<br\s*\/?>|&nbsp;|\s/g, '') && after === prev.id) return [...bs.slice(0, at - 1), ...blocks, ...bs.slice(at)];
      return [...bs.slice(0, at), ...blocks, ...bs.slice(at)];
    });
  };
  const removeBlock = (id: string) => {
    const index = note.blocks.findIndex((b) => b.id === id);
    const block = note.blocks[index];
    if (!block) return;
    setDeleted({ block, index });
    setBlocks((bs) => (bs.length === 1 ? [newBlock('text')] : bs.filter((b) => b.id !== id)));
  };
  const moveBlock = (id: string, by: number) =>
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j] as Block, next[i] as Block];
      return next;
    });

  useEffect(() => {
    if (!deleted) return;
    const t = setTimeout(() => setDeleted(null), 12_000);
    return () => clearTimeout(t);
  }, [deleted]);

  /** Copies files into the note as blocks after `after` (the block being edited, or the end). */
  const addFiles = async (files: File[], after: string | null = active) => {
    if (!files.length) return;
    setAdding((n) => n + files.length);
    const blocks: Block[] = [];
    const attachments: Attachment[] = [];
    try {
      for (const file of files) {
        try {
          const a = await storeFile(file, file.name || `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.${file.type.split('/')[1] ?? 'bin'}`);
          attachments.push(a);
          blocks.push({ id: newId(), type: 'file', file: a.id, caption: '' });
        } catch (e) {
          notify(errorMessage(e), 'error');
        } finally {
          setAdding((n) => n - 1);
        }
      }
    } finally {
      if (blocks.length) {
        change((n) => ({ ...n, attachments: [...n.attachments, ...attachments.filter((a) => !n.attachments.some((x) => x.id === a.id))] }));
        insertAfter(after, blocks);
      }
    }
  };

  // Pasting files (pictures, videos, documents copied anywhere) adds them to the note.
  const onPaste = (event: ClipboardEvent) => {
    const data = event.clipboardData;
    if (!data) return;
    const files = [...data.files];
    if (files.length) {
      event.preventDefault();
      event.stopPropagation();
      void attempt(() => addFiles(files));
      return;
    }
    const uris = data.getData('text/uri-list');
    if (uris.includes('file://') && isDesktop) {
      event.preventDefault();
      event.stopPropagation();
      void attempt(async () => addFiles(await filesFromUriList(uris)));
      return;
    }
    const target = event.target as HTMLElement;
    const textBlock = target.closest?.('.nt-text');
    if (!textBlock) return;
    const plain = data.getData('text/plain').trim();
    const blockId = textBlock.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? null;
    // A web address pasted on an empty line becomes a link card.
    if (/^https?:\/\/\S+$/i.test(plain) && !textBlock.textContent?.trim() && blockId) {
      event.preventDefault();
      setBlocks((bs) => bs.map((b) => (b.id === blockId ? { id: b.id, type: 'link', url: plain, title: '', note: '' } : b)));
      return;
    }
    const html = data.getData('text/html');
    if (html) {
      event.preventDefault();
      document.execCommand('insertHTML', false, cleanNoteHtml(html));
    }
  };

  const onDrop = (event: DragEvent) => {
    setDragging(false);
    const data = event.dataTransfer;
    if (!data?.types.includes('Files')) return;
    event.preventDefault();
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-block-id]');
    const after = target?.dataset.blockId ?? null;
    void attempt(async () => addFiles(await droppedFiles(data), after));
  };

  const saveWebPage = async (url: string, into?: string) => {
    const page = await urlToPdf(url);
    const a = await storeFile(new Blob([page.pdf as BlobPart], { type: 'application/pdf' }), `${safeName(page.title || new URL(page.url).hostname)}.pdf`);
    change((n) => ({ ...n, attachments: [...n.attachments.filter((x) => x.id !== a.id), a] }));
    const savedAt = new Date().toISOString();
    if (into) updateBlock(into, { snapshot: a.id, savedAt, title: page.title } as Partial<Block>);
    else insertAfter(active, [{ id: newId(), type: 'link', url: page.url, title: page.title, note: '', snapshot: a.id, savedAt }]);
    notify('Page saved into the note');
  };

  const exportAs = (format: 'bnote' | 'html' | 'md' | 'pdf') =>
    attempt(async () => {
      const files = await noteFiles(note);
      const tidy = { ...note, attachments: pruneAttachments(note) };
      const base = safeName(noteTitle(note)).replace(/\.+$/, '') || 'note';
      const markdown = await markdownRenderer();
      const sketch = await sketchExport(tidy);
      let outcome: Awaited<ReturnType<typeof saveFile>> | null = null;
      if (format === 'bnote') outcome = await saveFile(`${base}.bnote`, packNote(tidy, files, cleanNoteHtml, sketch), 'application/vnd.benchtop.note+zip');
      else if (format === 'md') {
        const { default: Turndown } = await import('turndown');
        const { gfm } = await import('turndown-plugin-gfm');
        const turndown = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' }).use(gfm);
        outcome = await saveFile(
          `${base}.zip`,
          noteMarkdownZip(tidy, files, (html) => turndown.turndown(cleanNoteHtml(html)), sketch?.file),
          'application/zip',
        );
      } else {
        const dataUrl = (a: Attachment) => {
          const bytes = files.get(a.id) ?? new Uint8Array();
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return `data:${a.type};base64,${btoa(binary)}`;
        };
        const html = noteHtml(tidy, dataUrl, cleanNoteHtml, markdown, sketch);
        if (format === 'html') outcome = await saveFile(`${base}.html`, html, 'text/html');
        else if (!isDesktop) printDocument(html);
        else outcome = await saveFile(`${base}.pdf`, await htmlToPdf(html), 'application/pdf');
      }
      if (outcome?.saved) notify(`Saved to ${outcome.location}`);
    });

  const totalSize = note.attachments.reduce((sum, a) => sum + a.size, 0);

  return (
    <div
      class={`nt-editor${dragging ? ' is-dragging' : ''}`}
      onPasteCapture={onPaste}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      data-testid="nt-editor"
    >
      <div class="nt-head">
        <input
          class="nt-title"
          value={note.title}
          placeholder={noteTitle({ ...note, title: '' }) === 'Untitled note' ? 'Title' : noteTitle({ ...note, title: '' })}
          aria-label="Title"
          onInput={(e) => change((n) => ({ ...n, title: e.currentTarget.value }))}
          data-testid="nt-title"
        />
        <span class="nt-saved tone-muted" aria-live="polite" data-testid="nt-saved">
          {saved === 'saving' ? 'Saving…' : saved === 'error' ? 'Not saved' : 'Saved'}
          {adding > 0 && ` · adding ${adding} ${adding === 1 ? 'file' : 'files'}…`}
        </span>
        <button
          type="button"
          class={`icon-button${note.pinned ? ' is-on' : ''}`}
          aria-pressed={note.pinned}
          title={note.pinned ? 'Unpin' : 'Pin to the top of the list'}
          onClick={() => change((n) => ({ ...n, pinned: !n.pinned }))}
        >
          📌
        </button>
        <select
          class="select select-small"
          aria-label="Export"
          value=""
          data-testid="nt-export"
          onChange={(e) => {
            const v = e.currentTarget.value as 'bnote' | 'html' | 'md' | 'pdf' | '';
            e.currentTarget.value = '';
            if (v) exportAs(v);
          }}
        >
          <option value="">Export…</option>
          <option value="bnote">Benchtop note (.bnote)</option>
          <option value="html">Web page (.html)</option>
          <option value="md">Markdown and files (.zip)</option>
          <option value="pdf">PDF</option>
        </select>
        {confirmDelete ? (
          <span class="nt-confirm" role="group" aria-label="Delete this note?">
            Delete this note?
            <button type="button" class="button button-small button-danger" onClick={onDelete} data-testid="nt-delete-yes">
              Delete
            </button>
            <button type="button" class="button button-small" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" class="icon-button" title="Delete note" aria-label="Delete note" onClick={() => setConfirmDelete(true)} data-testid="nt-delete">
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
      <Toolbar onAdd={(type) => insertAfter(active, [newBlock(type)])} onFiles={() => filesInput.current?.click()} onFolder={() => folderInput.current?.click()} onWebPage={() => setWebUrl('')} />
      <input
        ref={filesInput}
        type="file"
        multiple
        hidden
        data-testid="nt-files"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          void attempt(() => addFiles(files));
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        {...{ webkitdirectory: '' }}
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])].filter((f) => !f.name.startsWith('.')).sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
          e.currentTarget.value = '';
          void attempt(() => addFiles(files));
        }}
      />
      {webUrl !== null && (
        <form
          class="nt-web button-row"
          onSubmit={(e) => {
            e.preventDefault();
            const url = webUrl.trim();
            setWebUrl(null);
            if (url) void attempt(() => saveWebPage(url));
          }}
        >
          <FocusedInput class="input" type="url" placeholder="https://…" aria-label="Web address to save into the note" value={webUrl} onInput={(e) => setWebUrl(e.currentTarget.value)} />
          <button type="submit" class="button button-primary" disabled={!isDesktop}>
            Save page as PDF
          </button>
          <button type="button" class="button" onClick={() => setWebUrl(null)}>
            Cancel
          </button>
          {!isDesktop && <span class="control-help">Saving web pages needs the desktop app.</span>}
        </form>
      )}
      {deleted && (
        <p class="nt-undo" role="status">
          {BLOCK_LABEL[deleted.block.type]} block deleted.
          <button
            type="button"
            class="link-button"
            onClick={() => {
              const { block, index } = deleted;
              setBlocks((bs) => [...bs.slice(0, index), block, ...bs.slice(index)]);
              setDeleted(null);
            }}
          >
            Undo
          </button>
        </p>
      )}
      <div class="nt-blocks" data-testid="nt-blocks">
        {note.blocks.map((block, i) => (
          <BlockFrame
            key={block.id}
            block={block}
            first={i === 0}
            last={i === note.blocks.length - 1}
            active={active === block.id}
            onFocus={() => setActive(block.id)}
            onMove={(by) => moveBlock(block.id, by)}
            onRemove={() => removeBlock(block.id)}
          >
            <BlockView
              block={block}
              note={note}
              active={active === block.id}
              update={(patch) => updateBlock(block.id, patch)}
              onAfter={(type) => insertAfter(block.id, [newBlock(type)])}
              saveWebPage={(url) => attempt(() => saveWebPage(url, block.id))}
            />
          </BlockFrame>
        ))}
        <button type="button" class="nt-append" onClick={() => insertAfter(null, [newBlock('text')])}>
          Click to add text, or paste or drop pictures, videos and other files anywhere in the note.
        </button>
      </div>
      <p class="nt-foot tone-muted">
        {note.attachments.length} {note.attachments.length === 1 ? 'file' : 'files'} kept in this note ({formatSize(totalSize)}) · created{' '}
        {new Date(note.created).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- toolbar -- */

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function Toolbar({ onAdd, onFiles, onFolder, onWebPage }: { onAdd: (type: Exclude<BlockType, 'file'>) => void; onFiles: () => void; onFolder: () => void; onWebPage: () => void }) {
  const [linking, setLinking] = useState<{ range: Range; url: string } | null>(null);
  const keep = (e: MouseEvent) => e.preventDefault();
  const format: [string, string, () => void][] = [
    ['B', 'Bold (Ctrl+B)', () => exec('bold')],
    ['I', 'Italic (Ctrl+I)', () => exec('italic')],
    ['U', 'Underline (Ctrl+U)', () => exec('underline')],
    ['S', 'Strikethrough', () => exec('strikeThrough')],
    [
      '</>',
      'Code',
      () => {
        const text = window.getSelection()?.toString() ?? '';
        exec('insertHTML', `<code>${escapeHtml(text || 'code')}</code>`);
      },
    ],
    ['H1', 'Heading 1', () => exec('formatBlock', 'h1')],
    ['H2', 'Heading 2', () => exec('formatBlock', 'h2')],
    ['H3', 'Heading 3', () => exec('formatBlock', 'h3')],
    ['¶', 'Paragraph', () => exec('formatBlock', 'p')],
    ['•', 'Bulleted list', () => exec('insertUnorderedList')],
    ['1.', 'Numbered list', () => exec('insertOrderedList')],
    ['❝', 'Quote', () => exec('formatBlock', 'blockquote')],
    ['⌫', 'Clear formatting', () => exec('removeFormat')],
  ];
  return (
    <div class="nt-toolbar" role="toolbar" aria-label="Formatting and insert">
      <span class="nt-group" role="group" aria-label="Text formatting">
        {format.map(([label, title, run]) => (
          <button
            key={title}
            type="button"
            class="button button-small nt-fmt"
            title={title}
            aria-label={label.length === 1 && !/[A-Z]/.test(label) ? title : /^[A-Z]$/.test(label) ? title : undefined}
            onMouseDown={keep}
            onClick={run}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          class="button button-small nt-fmt"
          title="Link"
          onMouseDown={keep}
          onClick={() => {
            const selection = window.getSelection();
            if (selection?.rangeCount && selection.anchorNode && (selection.anchorNode as HTMLElement).parentElement?.closest('.nt-text'))
              setLinking({ range: selection.getRangeAt(0).cloneRange(), url: 'https://' });
            else notify('Select some text in a text block first.');
          }}
        >
          Link
        </button>
      </span>
      {linking && (
        <form
          class="nt-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(linking.range);
            if (/^(https?:|mailto:)/i.test(linking.url)) exec('createLink', linking.url);
            setLinking(null);
          }}
        >
          <FocusedInput class="input" value={linking.url} aria-label="Link address" onInput={(e) => setLinking({ ...linking, url: e.currentTarget.value })} />
          <button type="submit" class="button button-small">
            Add link
          </button>
        </form>
      )}
      <span class="nt-group" role="group" aria-label="Insert">
        <button type="button" class="button button-small" onClick={() => onAdd('text')}>
          + Text
        </button>
        <button type="button" class="button button-small" onClick={() => onAdd('checklist')} data-testid="nt-add-checklist">
          + Checklist
        </button>
        <button type="button" class="button button-small" onClick={() => onAdd('sketch')} title="Shapes, arrows, freehand drawing and mind maps" data-testid="nt-add-sketch">
          + Sketch
        </button>
        <button type="button" class="button button-small" onClick={() => onAdd('markdown')} data-testid="nt-add-markdown">
          + Markdown
        </button>
        <button type="button" class="button button-small" onClick={() => onAdd('code')}>
          + Code
        </button>
        <button type="button" class="button button-small" onClick={() => onAdd('link')}>
          + Link
        </button>
        <button type="button" class="button button-small" onClick={() => onAdd('divider')}>
          + Divider
        </button>
        <button type="button" class="button button-small" onClick={onFiles} data-testid="nt-add-files">
          <Icon name="image" size={13} /> Files…
        </button>
        <button type="button" class="button button-small" onClick={onFolder} title="Add every file in a folder">
          <Icon name="open" size={13} /> Folder…
        </button>
        <button type="button" class="button button-small" onClick={onWebPage} title="Save a web page into the note as a PDF">
          Web page…
        </button>
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- blocks -- */

interface FrameProps {
  readonly block: Block;
  readonly first: boolean;
  readonly last: boolean;
  readonly active: boolean;
  readonly onFocus: () => void;
  readonly onMove: (by: number) => void;
  readonly onRemove: () => void;
  readonly children: ComponentChildren;
}

function BlockFrame({ block, first, last, active, onFocus, onMove, onRemove, children }: FrameProps) {
  return (
    <div class={`nt-block nt-block-${block.type}${active ? ' is-active' : ''}`} data-block-id={block.id} onFocusCapture={onFocus} onPointerDown={onFocus}>
      <div class="nt-block-tools" role="group" aria-label={`${BLOCK_LABEL[block.type]} block`}>
        <button type="button" class="icon-button" title="Move up" aria-label="Move block up" disabled={first} onClick={() => onMove(-1)}>
          <Icon name="up" size={13} />
        </button>
        <button type="button" class="icon-button" title="Move down" aria-label="Move block down" disabled={last} onClick={() => onMove(1)}>
          <Icon name="down" size={13} />
        </button>
        <button type="button" class="icon-button" title="Delete block" aria-label="Delete block" onClick={onRemove}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div class="nt-block-body">{children}</div>
    </div>
  );
}

interface BlockProps {
  readonly block: Block;
  readonly note: Note;
  readonly active: boolean;
  readonly update: (patch: Partial<Block>) => void;
  readonly onAfter: (type: Exclude<BlockType, 'file'>) => void;
  readonly saveWebPage: (url: string) => void;
}

function BlockView(props: BlockProps) {
  const { block } = props;
  switch (block.type) {
    case 'text':
      return <TextBlock html={block.html} update={(html) => props.update({ html })} />;
    case 'markdown':
      return <MarkdownBlock source={block.source} update={(source) => props.update({ source })} />;
    case 'code':
      return <CodeBlock source={block.source} language={block.language} update={props.update} />;
    case 'checklist':
      return <ChecklistBlock items={block.items} update={(items) => props.update({ items })} />;
    case 'divider':
      return <hr class="nt-divider" />;
    case 'link':
      return <LinkBlock block={block} note={props.note} update={props.update} saveWebPage={props.saveWebPage} />;
    case 'file': {
      const attachment = props.note.attachments.find((a) => a.id === block.file);
      return attachment ? <FileBlock attachment={attachment} caption={block.caption} width={block.width} update={props.update} /> : <p class="recipe-error">This file is missing from the note.</p>;
    }
    case 'sketch':
      return <SketchBlock scene={block.scene} update={(scene) => props.update({ scene })} active={props.active} name={noteTitle(props.note)} />;
  }
}

let sketchEditor: Promise<typeof import('./_sketch')> | null = null;

/** A sketch or mind map; the editor loads the first time a note shows one. */
function SketchBlock(props: { scene: Scene; update: (scene: Scene) => void; active: boolean; name: string }) {
  const [editor, setEditor] = useState<typeof import('./_sketch') | null>(null);
  useEffect(() => {
    let alive = true;
    sketchEditor ??= import('./_sketch');
    sketchEditor.then(
      (module) => {
        if (alive) setEditor(module);
      },
      (error: unknown) => {
        sketchEditor = null;
        if (alive) notify(errorMessage(error), 'error');
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  if (!editor) return <div class="sk-loading" style={{ height: `${props.scene.height + 42}px` }} aria-busy="true" />;
  return <editor.SketchEditor scene={props.scene} update={props.update} active={props.active} name={props.name} />;
}

/** Draws a note's sketches for an export; the drawing code and fonts load only for notes that have sketches. */
async function sketchExport(note: Note): Promise<SketchExport | undefined> {
  const scenes = note.blocks.flatMap((b) => (b.type === 'sketch' ? [b.scene] : []));
  if (!scenes.length) return undefined;
  const [{ PAPER, sceneSvg }, fonts] = await Promise.all([import('../../lib/sketch-render'), import('../../lib/sketch-fonts')]);
  await fonts.loadSketchFonts();
  const measure = fonts.canvasMeasure();
  const css = await fonts.sketchFontCss(scenes);
  return {
    css,
    svg: (scene) => sceneSvg(scene, { measure, background: PAPER, title: 'Sketch' }),
    file: (scene) => sceneSvg(scene, { measure, background: PAPER, title: 'Sketch', fontCss: css }),
  };
}

function TextBlock({ html, update }: { html: string; update: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== html && document.activeElement !== el) el.innerHTML = html;
  }, [html]);
  return (
    <div
      ref={ref}
      class="nt-text prose"
      contentEditable
      tabIndex={0}
      role="textbox"
      aria-multiline="true"
      aria-label="Text"
      data-placeholder="Write here, or paste pictures, videos and files"
      onInput={(e) => update((e.currentTarget as HTMLDivElement).innerHTML)}
      onClick={(e) => {
        const link = (e.target as HTMLElement).closest('a');
        if (link && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void attempt(() => openLink(link.getAttribute('href') ?? ''));
        }
      }}
      data-testid="nt-text"
    />
  );
}

let markdownRendering: Promise<(md: string) => string> | null = null;
/** Markdown to HTML with maths, MathJax loading on first use. */
function markdownRenderer(): Promise<(md: string) => string> {
  markdownRendering ??= loadTex().then(
    ({ texToSvg }) =>
      (md: string) =>
        renderMarkdown(md, (tex, display) => {
          const r = texToSvg(tex, { display, scale: 17 });
          return { svg: r.svg, error: r.error, depth: r.depth };
        }),
  );
  return markdownRendering;
}

function MarkdownBlock({ source, update }: { source: string; update: (source: string) => void }) {
  const [editing, setEditing] = useState(!source);
  const [html, setHtml] = useState('');
  useEffect(() => {
    if (editing) return;
    let live = true;
    void (source.includes('$') ? markdownRenderer() : Promise.resolve((md: string) => renderMarkdown(md))).then((render) => live && setHtml(sanitizeHtml(render(source))));
    return () => {
      live = false;
    };
  }, [source, editing]);
  if (editing)
    return (
      <div class="nt-md">
        <AutoTextArea
          value={source}
          onInput={update}
          label="Markdown"
          placeholder="**Markdown** with $maths$, tables and lists"
          onBlur={() => source && setEditing(false)}
          focusOnMount
          testId="nt-markdown"
        />
        <span class="control-help">Markdown block · click outside to see it formatted</span>
      </div>
    );
  return (
    <div class="nt-md-view" onDblClick={() => setEditing(true)}>
      <div class="prose" data-testid="nt-markdown-view" dangerouslySetInnerHTML={{ __html: html }} />
      <button type="button" class="link-button nt-md-edit" onClick={() => setEditing(true)}>
        Edit Markdown
      </button>
    </div>
  );
}

function CodeBlock({ source, language, update }: { source: string; language: string; update: (patch: Partial<Block>) => void }) {
  return (
    <div class="nt-code">
      <select class="select select-small" aria-label="Language" value={language} onChange={(e) => update({ language: e.currentTarget.value })}>
        {['text', 'python', 'javascript', 'typescript', 'c', 'cpp', 'arduino', 'rust', 'java', 'html', 'css', 'sql', 'json', 'yaml', 'bash', 'powershell'].map((l) => (
          <option key={l} value={l}>
            {l === 'text' ? 'Plain text' : l}
          </option>
        ))}
      </select>
      <AutoTextArea value={source} onInput={(v) => update({ source: v })} label="Code" placeholder="Code" mono />
    </div>
  );
}

function AutoTextArea({
  value,
  onInput,
  label,
  placeholder,
  mono,
  onBlur,
  focusOnMount,
  testId,
}: {
  value: string;
  onInput: (v: string) => void;
  label: string;
  placeholder?: string;
  mono?: boolean;
  onBlur?: () => void;
  focusOnMount?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(60, el.scrollHeight + 2)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      class={`input nt-area${mono ? ' is-mono' : ''}`}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      spellcheck={!mono}
      onInput={(e) => onInput(e.currentTarget.value)}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (mono && e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: s, selectionEnd: t } = el;
          onInput(`${el.value.slice(0, s)}  ${el.value.slice(t)}`);
          requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
        }
      }}
      data-testid={testId}
    />
  );
}

function ChecklistBlock({ items, update }: { items: readonly { text: string; done: boolean }[]; update: (items: { text: string; done: boolean }[]) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focus, setFocus] = useState<number | null>(null);
  // Focus moves in the same task as the render, so the next keystroke lands in the new item.
  useLayoutEffect(() => {
    if (focus !== null) refs.current[focus]?.focus();
  }, [focus, items.length]);
  const done = items.filter((i) => i.done).length;
  return (
    <div class="nt-checklist">
      {items.map((item, i) => (
        <div key={i} class={`nt-check${item.done ? ' is-done' : ''}`}>
          <input
            type="checkbox"
            checked={item.done}
            aria-label={`Done: ${item.text || 'item'}`}
            onChange={(e) => update(items.map((x, k) => (k === i ? { ...x, done: e.currentTarget.checked } : x)))}
          />
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            class="nt-check-text"
            value={item.text}
            placeholder="To do"
            aria-label="Checklist item"
            onInput={(e) => update(items.map((x, k) => (k === i ? { ...x, text: e.currentTarget.value } : x)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                update([...items.slice(0, i + 1), { text: '', done: false }, ...items.slice(i + 1)]);
                setFocus(i + 1);
              } else if (e.key === 'Backspace' && !item.text && items.length > 1) {
                e.preventDefault();
                update(items.filter((_, k) => k !== i));
                setFocus(Math.max(0, i - 1));
              }
            }}
            data-testid="nt-check-text"
          />
        </div>
      ))}
      {items.length > 1 && (
        <span class="control-help">
          {done} of {items.length} done · Enter adds an item
        </span>
      )}
    </div>
  );
}

function LinkBlock({ block, note, update, saveWebPage }: { block: Extract<Block, { type: 'link' }>; note: Note; update: (patch: Partial<Block>) => void; saveWebPage: (url: string) => void }) {
  const snapshot = block.snapshot ? note.attachments.find((a) => a.id === block.snapshot) : undefined;
  const [busy, setBusy] = useState(false);
  const valid = /^https?:\/\/\S+$/i.test(block.url.trim());
  return (
    <div class="nt-link">
      <div class="nt-link-fields">
        <input class="input nt-link-title" value={block.title} placeholder="Title" aria-label="Link title" onInput={(e) => update({ title: e.currentTarget.value })} />
        <input
          class="input nt-link-url"
          type="url"
          value={block.url}
          placeholder="https://…"
          aria-label="Web address"
          onInput={(e) => update({ url: e.currentTarget.value })}
          data-testid="nt-link-url"
        />
        <input class="input" value={block.note} placeholder="Why it matters (optional)" aria-label="Note about the link" onInput={(e) => update({ note: e.currentTarget.value })} />
      </div>
      <div class="button-row">
        <button
          type="button"
          class="button button-small"
          disabled={!valid || !isDesktop}
          onClick={() => attempt(() => openLink(block.url.trim()))}
          title={isDesktop ? 'Open in the web browser' : 'Opening links needs the desktop app'}
        >
          Open
        </button>
        <button
          type="button"
          class="button button-small"
          disabled={!valid || !isDesktop || busy}
          title={isDesktop ? 'Keep a PDF copy of the page in this note' : 'Saving pages needs the desktop app'}
          onClick={async () => {
            setBusy(true);
            try {
              await saveWebPage(block.url.trim());
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving the page…' : snapshot ? 'Save the page again' : 'Save the page as PDF'}
        </button>
        {snapshot && block.savedAt && (
          <span class="tone-muted">Copy saved {new Date(block.savedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        )}
      </div>
      {snapshot && <PdfView attachment={snapshot} />}
    </div>
  );
}

/* ---------------------------------------------------------------- files -- */

function FileBlock({ attachment, caption, width, update }: { attachment: Attachment; caption: string; width?: number; update: (patch: Partial<Block>) => void }) {
  const kind = fileKind(attachment);
  const saveCopy = () =>
    attempt(async () => {
      const outcome = await saveFile(attachment.name, await fileBytes(attachment.id), attachment.type);
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });
  return (
    <figure class={`nt-file nt-file-${kind}`} data-testid={`nt-file-${kind}`}>
      <FilePreview attachment={attachment} kind={kind} width={width} />
      <div class="nt-file-bar">
        <span class="nt-file-name" title={attachment.name}>
          {attachment.name}
        </span>
        <span class="tone-muted">{formatSize(attachment.size)}</span>
        {kind === 'image' && (
          <span class="nt-sizes" role="group" aria-label="Picture width">
            {[33, 50, 75, 100].map((w) => (
              <button
                key={w}
                type="button"
                class={`button button-small${(width ?? 100) === w ? ' is-on' : ''}`}
                aria-pressed={(width ?? 100) === w}
                onClick={() => update({ width: w } as Partial<Block>)}
              >
                {w === 100 ? 'Full' : `${w}%`}
              </button>
            ))}
          </span>
        )}
        <button type="button" class="button button-small button-quiet" onClick={saveCopy}>
          <Icon name="save" size={13} /> Save a copy
        </button>
      </div>
      <input
        class="nt-caption"
        value={caption}
        placeholder="Add a caption"
        aria-label={`Caption for ${attachment.name}`}
        onInput={(e) => update({ caption: e.currentTarget.value } as Partial<Block>)}
      />
    </figure>
  );
}

function FilePreview({ attachment, kind, width }: { attachment: Attachment; kind: FileKind; width?: number }) {
  const url = useFileUrl(kind === 'image' || kind === 'video' || kind === 'audio' ? attachment.id : undefined);
  if (kind === 'image') return url ? <img src={url} alt={attachment.name} style={width ? { width: `${width}%` } : undefined} loading="lazy" /> : <div class="nt-file-wait" />;
  if (kind === 'video')
    return url ? (
      // biome-ignore lint/a11y/useMediaCaption: captions come with the user's own videos, when they have them
      <video src={url} controls preload="metadata" />
    ) : (
      <div class="nt-file-wait" />
    );
  if (kind === 'audio')
    return url ? (
      // biome-ignore lint/a11y/useMediaCaption: captions come with the user's own recordings, when they have them
      <audio src={url} controls preload="metadata" />
    ) : (
      <div class="nt-file-wait" />
    );
  if (kind === 'pdf') return <PdfView attachment={attachment} />;
  if (kind === 'model') return <ModelView attachment={attachment} />;
  if (kind === 'text') return <TextFileView attachment={attachment} />;
  return (
    <div class="nt-file-card">
      <Icon name="file" size={28} />
      <span>{attachment.type === 'application/octet-stream' ? 'File' : attachment.type}</span>
    </div>
  );
}

function PdfView({ attachment }: { attachment: Attachment }) {
  const [state, setState] = useState<{ pages: number; page: number; image: string | null; error?: string }>({ pages: 0, page: 1, image: null });
  const host = useRef<HTMLDivElement>(null);
  const doc = useRef<Awaited<ReturnType<typeof openPdf>> | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        doc.current = await openPdf(await fileBytes(attachment.id));
        if (live) setState((s) => ({ ...s, pages: doc.current?.doc.numPages ?? 0 }));
      } catch (e) {
        if (live) setState((s) => ({ ...s, error: errorMessage(e) }));
      }
    })();
    return () => {
      live = false;
      void doc.current?.close();
    };
  }, [attachment.id]);
  useEffect(() => {
    const d = doc.current;
    if (!d || !state.pages) return;
    let live = true;
    void (async () => {
      const width = Math.min(1600, (host.current?.clientWidth || 700) * Math.min(2, window.devicePixelRatio || 1));
      const page = await d.doc.getPage(state.page);
      const scale = width / page.getViewport({ scale: 1 }).width;
      const canvas = await renderPage(d.doc, state.page, scale);
      if (live) setState((s) => ({ ...s, image: canvas.toDataURL('image/png') }));
    })().catch((e) => live && setState((s) => ({ ...s, error: errorMessage(e) })));
    return () => {
      live = false;
    };
  }, [state.pages, state.page]);
  if (state.error) return <p class="recipe-error">{state.error}</p>;
  return (
    <div class="nt-pdf" ref={host}>
      {state.image ? <img src={state.image} alt={`Page ${state.page} of ${attachment.name}`} /> : <div class="nt-file-wait" />}
      {state.pages > 1 && (
        <div class="nt-pdf-nav">
          <button type="button" class="icon-button" aria-label="Previous page" disabled={state.page <= 1} onClick={() => setState((s) => ({ ...s, page: s.page - 1 }))}>
            <Icon name="left" size={15} />
          </button>
          <span>
            Page {state.page} of {state.pages}
          </span>
          <button type="button" class="icon-button" aria-label="Next page" disabled={state.page >= state.pages} onClick={() => setState((s) => ({ ...s, page: s.page + 1 }))}>
            <Icon name="right" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function ModelView({ attachment }: { attachment: Attachment }) {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState('');
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!show || !host.current) return;
    let scene: ModelScene | null = null;
    let live = true;
    void (async () => {
      try {
        const made = await mountModel(host.current as HTMLDivElement, (await fileBytes(attachment.id)).buffer as ArrayBuffer, attachment.name, { height: 380 });
        if (!live) made.dispose();
        else {
          scene = made;
          setInfo(made.info);
        }
      } catch (e) {
        if (live) setInfo(errorMessage(e));
      }
    })();
    return () => {
      live = false;
      scene?.dispose();
    };
  }, [show, attachment.id]);
  if (!show)
    return (
      <button type="button" class="nt-file-card nt-model-open" onClick={() => setShow(true)}>
        <Icon name="eye" size={26} />
        <span>Show the 3D model</span>
      </button>
    );
  return (
    <div class="nt-model">
      <div ref={host} class="nt-model-stage" role="img" aria-label="3D view: drag to turn, scroll to zoom" />
      {info && <span class="tone-muted">{info}</span>}
    </div>
  );
}

function TextFileView({ attachment }: { attachment: Attachment }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void fileBytes(attachment.id).then((bytes) => {
      if (!live) return;
      const head = new TextDecoder().decode(bytes.subarray(0, 64 * 1024));
      setText(bytes.length > 64 * 1024 ? `${head}\n…` : head);
    });
    return () => {
      live = false;
    };
  }, [attachment.id]);
  return <pre class="nt-textfile">{text ?? ''}</pre>;
}

export default defineCustomTool(Notes);
