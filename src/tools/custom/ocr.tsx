/** Reads text from pictures and scanned PDFs with Tesseract (English and Hindi), offline, and can make a searchable PDF. */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { formatBytes } from '../../lib/bytes';
import { errorMessage } from '../../lib/errors';
import { type OcrLanguage, ocrWorker, onOcrProgress } from '../../lib/ocr-engine';
import { openPdf, renderPage } from '../../lib/pdf-render';
import { copyText, pickFiles, saveFile } from '../../platform';
import { CodeEditor } from '../../ui/CodeEditor';
import { loadImage, replaceExtension } from '../../ui/canvas';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

type Layout = 'auto' | 'block' | 'column' | 'sparse' | 'line';
const PSM: Record<Layout, string> = { auto: '3', block: '6', column: '4', sparse: '11', line: '7' };

interface Settings {
  readonly layout: Layout;
  readonly searchablePdf: boolean;
  readonly dpi: number;
  readonly language: OcrLanguage;
}

const read = (s: Values | undefined): Settings => ({
  layout: (['auto', 'block', 'column', 'sparse', 'line'] as const).find((l) => l === s?.layout) ?? 'auto',
  searchablePdf: s?.searchablePdf === true,
  dpi: typeof s?.dpi === 'number' ? s.dpi : 200,
  language: (['eng', 'hin', 'eng+hin'] as const).find((l) => l === s?.language) ?? 'eng',
});

interface Source {
  readonly name: string;
  readonly kind: 'image' | 'pdf';
  readonly file: File;
}

function Ocr({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({ ...s }));
  const [sources, setSources] = useState<Source[]>([]);
  const [text, setText] = useState('');
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [state, setState] = useState<{ step: string; fraction: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const cancelled = useRef(false);

  const add = (files: File[]) => {
    const accepted = files.filter((f) => f.type.startsWith('image/') || /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (accepted.length < files.length) notify('Only pictures and PDF files can be read.', 'error');
    setSources((list) => [...list, ...accepted.map((file) => ({ name: file.name, kind: /\.pdf$/i.test(file.name) || file.type === 'application/pdf' ? ('pdf' as const) : ('image' as const), file }))]);
  };
  useIncomingFiles(add);
  // A screenshot on the clipboard (Print Screen, Win+Shift+S, Shift+Ctrl+PrtSc) is read straight from a paste.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, [contenteditable="true"], .cm-editor')) return;
      const images = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (images.length === 0) return;
      event.preventDefault();
      const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
      add(images.map((file, i) => new File([file], `screenshot-${stamp}${images.length > 1 ? `-${i + 1}` : ''}.png`, { type: file.type })));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const go = async () => {
    cancelled.current = false;
    setText('');
    setPdf(null);
    const pages: { label: string; canvas: HTMLCanvasElement }[] = [];
    const out: string[] = [];
    const pdfPages: Uint8Array[] = [];
    try {
      setState({ step: 'Starting the OCR engine', fraction: 0 });
      const worker = await ocrWorker(settings.language);
      await worker.setParameters({ tessedit_pageseg_mode: PSM[settings.layout] as never, preserve_interword_spaces: '1' });
      for (const source of sources) {
        if (source.kind === 'image') pages.push({ label: source.name, canvas: await loadImage(source.file) });
        else {
          const { doc, close } = await openPdf(new Uint8Array(await source.file.arrayBuffer()));
          for (let n = 1; n <= doc.numPages; n++) {
            if (cancelled.current) break;
            setState({ step: `Rendering ${source.name}, page ${n} of ${doc.numPages}`, fraction: 0 });
            pages.push({ label: `${source.name}, page ${n}`, canvas: await renderPage(doc, n, settings.dpi / 72) });
          }
          await close();
        }
      }
      for (const [i, page] of pages.entries()) {
        if (cancelled.current) break;
        onOcrProgress((status, progress) => setState({ step: `${page.label}: ${status}`, fraction: (i + progress) / pages.length }));
        const result = await worker.recognize(page.canvas, {}, { text: true, pdf: settings.searchablePdf });
        out.push(pages.length > 1 ? `--- ${page.label} ---\n${result.data.text.trim()}` : result.data.text.trim());
        setText(out.join('\n\n'));
        if (settings.searchablePdf && result.data.pdf) pdfPages.push(Uint8Array.from(result.data.pdf));
      }
      if (pdfPages.length) {
        const { PDFDocument } = await import('pdf-lib');
        const merged = await PDFDocument.create();
        for (const bytes of pdfPages) {
          const doc = await PDFDocument.load(bytes);
          for (const p of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(p);
        }
        setPdf(await merged.save());
      }
      if (cancelled.current) notify('Stopped.');
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      onOcrProgress(() => undefined);
      setState(null);
    }
  };

  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        <div class="control">
          <span class="control-label">Page layout</span>
          <Segmented
            label="Page layout"
            small={false}
            value={settings.layout}
            onChange={(layout) => setSettings((s) => ({ ...s, layout }))}
            choices={[
              { value: 'auto', label: 'Auto' },
              { value: 'column', label: 'Column' },
              { value: 'block', label: 'Block' },
              { value: 'sparse', label: 'Scattered' },
              { value: 'line', label: 'One line' },
            ]}
          />
        </div>
        <div class="control">
          <span class="control-label">Language</span>
          <Segmented
            label="Language"
            small={false}
            value={settings.language}
            onChange={(language) => setSettings((s) => ({ ...s, language }))}
            choices={[
              { value: 'eng', label: 'English' },
              { value: 'hin', label: 'हिन्दी Hindi' },
              { value: 'eng+hin', label: 'Both' },
            ]}
          />
        </div>
        <div class="control">
          <label class="control-label" for="ocr-dpi">
            PDF pages rendered at {settings.dpi} dpi
          </label>
          <input id="ocr-dpi" type="range" min={100} max={400} step={50} value={settings.dpi} onInput={(e) => setSettings((s) => ({ ...s, dpi: Number(e.currentTarget.value) }))} />
        </div>
        <label class="toggle" for="ocr-pdf">
          <input
            id="ocr-pdf"
            type="checkbox"
            role="switch"
            aria-checked={settings.searchablePdf}
            checked={settings.searchablePdf}
            onChange={(e) => setSettings((s) => ({ ...s, searchablePdf: e.currentTarget.checked }))}
          />
          <span class="toggle-track" aria-hidden="true" />
          <span class="toggle-text">Also make a searchable PDF</span>
        </label>
        <div class="button-row">
          <button type="button" class="button button-primary" disabled={sources.length === 0 || state !== null} onClick={() => void go()} data-testid="ocr-run">
            Read text
          </button>
          {state && (
            <button type="button" class="button" onClick={() => (cancelled.current = true)}>
              Stop
            </button>
          )}
        </div>
        {state && (
          <div class="ai-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.fraction * 100)}>
            <div class="ai-progress-bar" style={{ width: `${state.fraction * 100}%` }} />
            <span>{state.step}</span>
          </div>
        )}
        <p class="tone-muted">English and Hindi (Devanagari) text, recognised by Tesseract on this computer. Choose Both for pages that mix the two. Clear, straight scans at 200–300 dpi work best.</p>
      </div>
      <div class="ai-work">
        <div
          class={`dropzone dropzone-compact${dragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes('Files')) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            setDragging(false);
            if (e.dataTransfer?.files.length) {
              e.preventDefault();
              add(Array.from(e.dataTransfer.files));
            }
          }}
        >
          <button type="button" class="button" onClick={() => attempt(async () => add(await pickFiles('image/*,.pdf,application/pdf')))}>
            Add pictures or PDFs
          </button>
          <span class="dropzone-hint">or drop them here, or paste a screenshot (Ctrl+V)</span>
        </div>
        {sources.length > 0 && (
          <ul class="file-list" data-testid="ocr-files">
            {sources.map((s, i) => (
              <li key={`${s.name}-${i}`}>
                <Icon name={s.kind === 'pdf' ? 'file' : 'image'} size={15} />
                <span>{s.name}</span>
                <span class="tone-muted">{formatBytes(s.file.size)}</span>
                <button type="button" class="icon-button" aria-label={`Remove ${s.name}`} onClick={() => setSources((list) => list.filter((_, j) => j !== i))}>
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div class="pane ai-text">
          <div class="pane-header">
            <h2 class="pane-title">Text</h2>
            <span class="pane-meta">{text ? `${text.length} characters` : ''}</span>
            <div class="pane-actions">
              <button
                type="button"
                class="icon-button"
                aria-label="Copy the text"
                title="Copy"
                disabled={!text}
                onClick={() =>
                  attempt(async () => {
                    await copyText(text);
                    notify('Copied.');
                  })
                }
              >
                <Icon name="copy" size={16} />
              </button>
              <button
                type="button"
                class="button button-small"
                disabled={!text}
                onClick={() =>
                  attempt(async () => {
                    const saved = await saveFile(replaceExtension(sources[0]?.name ?? 'ocr', 'txt'), text, 'text/plain');
                    if (saved.saved) notify(`Saved to ${saved.location}`);
                  })
                }
              >
                Save text
              </button>
              <button
                type="button"
                class="button button-small"
                disabled={!pdf}
                onClick={() =>
                  attempt(async () => {
                    if (!pdf) return;
                    const saved = await saveFile(replaceExtension(sources[0]?.name ?? 'ocr', 'searchable.pdf'), pdf, 'application/pdf');
                    if (saved.saved) notify(`Saved to ${saved.location}`);
                  })
                }
              >
                Save PDF
              </button>
            </div>
          </div>
          <div class="pane-body">
            <CodeEditor value={text} readOnly wrap label="Recognised text" testId="ocr-output" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default defineCustomTool(Ocr);
