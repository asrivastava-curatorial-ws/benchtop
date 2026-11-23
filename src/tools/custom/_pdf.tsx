/** Shared pieces for the PDF tools: reading files, drop areas, page pictures. */
import type { PDFDocument } from 'pdf-lib';
import { useEffect, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { formatBytes } from '../../lib/bytes';
import { ENCRYPTED_MESSAGE, loadPdf } from '../../lib/pdf-edit';
import { openPdf, renderPage } from '../../lib/pdf-render';
import { pickFiles, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';

export const MAX_PDF = 300 * 1024 * 1024;

export interface PdfFile {
  readonly id: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly doc: PDFDocument;
  readonly pages: number;
}

let ids = 0;

export async function readPdf(file: File): Promise<PdfFile> {
  if (file.size > MAX_PDF) throw new Error(`${file.name} is larger than 300 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = await loadPdf(bytes);
    return { id: `pdf-${ids++}`, name: file.name, bytes, doc, pages: doc.getPageCount() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message === ENCRYPTED_MESSAGE ? `${file.name}: ${message}` : message);
  }
}

export const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'document';

export async function save(name: string, bytes: Uint8Array, mime = 'application/pdf') {
  const saved = await saveFile(name, bytes, mime);
  if (saved.saved) notify(`Saved to ${saved.location}`);
}

/** A drop area that also opens the file picker. */
export function FileDrop({
  accept,
  multiple,
  onFiles,
  title,
  hint,
  compact = false,
  testId,
}: {
  accept: string;
  multiple: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint?: string;
  compact?: boolean;
  testId?: string;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <button
      type="button"
      class={`dropzone${compact ? ' dropzone-compact' : ''}${dragging ? ' is-dragging' : ''}`}
      data-testid={testId}
      onClick={() =>
        attempt(async () => {
          const files = await pickFiles(accept);
          if (files.length) onFiles(multiple ? files : files.slice(0, 1));
        })
      }
      onDragOver={(event) => {
        if (event.dataTransfer?.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        setDragging(false);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length) {
          event.preventDefault();
          onFiles(multiple ? files : files.slice(0, 1));
        }
      }}
    >
      <Icon name="file" size={compact ? 20 : 30} />
      <span class="dropzone-title">{title}</span>
      {hint && <span class="dropzone-hint">{hint}</span>}
    </button>
  );
}

/** Page pictures for a PDF, drawn one after another so the first appear quickly. */
export function useThumbnails(file: Pick<PdfFile, 'bytes' | 'pages'> | null, width = 150, limit = 400): readonly string[] {
  const [thumbs, setThumbs] = useState<string[]>([]);
  useEffect(() => {
    setThumbs([]);
    if (!file) return;
    let cancelled = false;
    let close: (() => Promise<void>) | null = null;
    void (async () => {
      try {
        const opened = await openPdf(file.bytes);
        close = opened.close;
        const count = Math.min(file.pages, limit);
        for (let n = 1; n <= count && !cancelled; n++) {
          const page = await opened.doc.getPage(n);
          const scale = width / page.getViewport({ scale: 1 }).width;
          const canvas = await renderPage(opened.doc, n, scale);
          if (cancelled) break;
          const url = canvas.toDataURL('image/jpeg', 0.72);
          setThumbs((list) => {
            const next = [...list];
            next[n - 1] = url;
            return next;
          });
        }
      } catch {
        // Thumbnails are a convenience; the tools still work without them.
      }
    })();
    return () => {
      cancelled = true;
      void close?.();
    };
  }, [file, width, limit]);
  return thumbs;
}

export function FileBar({ file, onReplace, onClear }: { file: PdfFile; onReplace: () => void; onClear: () => void }) {
  return (
    <div class="image-source">
      <Icon name="file" size={18} />
      <div class="image-source-text">
        <div class="file-name">{file.name}</div>
        <div class="file-meta">
          {file.pages} page{file.pages === 1 ? '' : 's'}, {formatBytes(file.bytes.length)}
        </div>
      </div>
      <button type="button" class="button button-small" onClick={onReplace}>
        Replace
      </button>
      <button type="button" class="button button-small button-quiet" onClick={onClear}>
        Remove
      </button>
    </div>
  );
}

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export function useSinglePdf(): [PdfFile | null, (files: File[]) => void, () => void, boolean] {
  const [file, setFile] = useState<PdfFile | null>(null);
  const [loading, setLoading] = useState(false);
  const take = (files: File[]) => {
    const first = files[0];
    if (!first) return;
    setLoading(true);
    void attempt(async () => setFile(await readPdf(first))).finally(() => setLoading(false));
  };
  useIncomingFiles(take, isPdf);
  return [file, take, () => setFile(null), loading];
}
