/**
 * Flipbook Reader: PDFs and flipbook projects as books whose pages turn like
 * paper, with contents, page pictures, search, zoom, full screen and the
 * keyboard.  Pages of a PDF are drawn with PDF.js as they come near.
 */
import { PageFlip } from 'page-flip/dist/js/page-flip.module.js';
import { PDFDocument } from 'pdf-lib';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type Book, openProject, runtimeData } from '../../lib/flipbook';
import { type FlipBookData, mountFlipbook } from '../../lib/flipbook-runtime.js';
import { pageText } from '../../lib/pdf-page-text';
import { joinItems } from '../../lib/pdf-redact';
import { openPdf, type PdfDocument, renderPage } from '../../lib/pdf-render';
import { type OutlineItem, readOutline } from '../../lib/pdf-toolbox';
import { openLink, pickFiles } from '../../platform';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { FileDrop } from './_pdf';

const ACCEPT = '.pdf,.flipbook,application/pdf';

interface Opened {
  readonly name: string;
  readonly data: FlipBookData;
  readonly loadPage?: (index: number) => Promise<string | null>;
  readonly close: () => void;
}

const flatten = (items: readonly OutlineItem[]): { title: string; page: number }[] =>
  items.flatMap((item) => [...(item.page > 0 ? [{ title: item.title, page: item.page }] : []), ...flatten(item.children)]);

/** A PDF as a flipbook: pages drawn as they are needed, text read in the background for search. */
async function openPdfBook(name: string, bytes: Uint8Array): Promise<Opened> {
  const { doc, close } = await openPdf(bytes);
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  let contents: { title: string; page: number }[] = [];
  try {
    contents = flatten(readOutline(await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })));
  } catch {
    // No outline to show.
  }
  const urls: string[] = [];
  let closed = false;
  const data: FlipBookData = {
    title: name.replace(/\.pdf$/i, ''),
    width: first.width,
    height: first.height,
    pages: Array.from({ length: doc.numPages }, () => ({ src: null, text: '' })),
    contents,
    settings: { spread: 'double', cover: true, hardCovers: false, sound: true, background: '#2b3036' },
  };
  const loadPage = async (index: number): Promise<string | null> => {
    if (closed) return null;
    const page = await doc.getPage(index + 1);
    const view = page.getViewport({ scale: 1 });
    // About 1600 pixels tall, enough for zooming in a little.
    const canvas = await renderPage(doc, index + 1, Math.min(4, 1600 / Math.max(1, view.height)));
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob || closed) return null;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };
  void readTexts(doc, data, () => closed);
  return {
    name,
    data,
    loadPage,
    close: () => {
      closed = true;
      for (const url of urls) URL.revokeObjectURL(url);
      void close();
    },
  };
}

async function readTexts(doc: PdfDocument, data: FlipBookData, closed: () => boolean): Promise<void> {
  for (let n = 1; n <= doc.numPages && !closed(); n++) {
    try {
      const page = data.pages[n - 1];
      if (page) page.text = joinItems((await pageText(doc, n)).items).text;
    } catch {
      // A page without readable text.
    }
  }
}

function openBook(name: string, book: Book): Opened {
  const urls = new Map<string, string>();
  const url = (id: string) => {
    let made = urls.get(id);
    const asset = book.assets[id];
    if (!made && asset) {
      made = URL.createObjectURL(new Blob([asset.bytes as BlobPart], { type: asset.type }));
      urls.set(id, made);
    }
    return made ?? '';
  };
  return {
    name,
    data: runtimeData(book, url),
    close: () => {
      for (const made of urls.values()) URL.revokeObjectURL(made);
    },
  };
}

function FlipbookReader() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  const take = (files: File[]) =>
    attempt(async () => {
      const file = files[0];
      if (!file) return;
      setBusy(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
        const next = isPdf ? await openPdfBook(file.name, bytes) : openBook(file.name, openProject(bytes));
        // The one before is closed by the effect below.
        setOpened(next);
      } finally {
        setBusy(false);
      }
    });

  useEffect(() => () => opened?.close(), [opened]);

  useEffect(() => {
    const root = host.current;
    if (!root || !opened) return;
    const controller = mountFlipbook(root, opened.data, {
      PageFlip,
      loadPage: opened.loadPage,
      openLink: (url) => void openLink(url).catch((error) => notify(error instanceof Error ? error.message : String(error), 'error')),
    });
    root.focus();
    return () => controller.destroy();
  }, [opened]);

  return (
    <section class="tool fbr-tool" data-testid="tool" data-state={busy ? 'loading' : opened ? 'ready' : 'idle'}>
      {opened ? (
        <div class="fbr-head">
          <strong class="fbr-name">{opened.name}</strong>
          <span class="tone-muted">
            {opened.data.pages.length} page{opened.data.pages.length === 1 ? '' : 's'}
          </span>
          <button type="button" class="button button-small" onClick={() => attempt(async () => take(await pickFiles(ACCEPT)))}>
            Open another
          </button>
          <button type="button" class="button button-small button-quiet" onClick={() => setOpened(null)}>
            Close
          </button>
        </div>
      ) : (
        <FileDrop
          accept={ACCEPT}
          multiple={false}
          onFiles={(files) => void take(files)}
          title={busy ? 'Opening…' : 'Choose or drop a PDF or a flipbook'}
          hint="Pages turn like paper. Flipbooks are made in the Flipbook Editor. Nothing leaves this computer."
          testId="fbr-drop"
        />
      )}
      {opened && <div class="fbr-host" ref={host} data-testid="fbr-book" />}
    </section>
  );
}

export default defineCustomTool(FlipbookReader);
