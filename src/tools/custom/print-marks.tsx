/**
 * Print Production Studio, marks: each page of a PDF on a larger page with
 * the printer's marks around it (crop marks at the trim, bleed marks,
 * registration targets, a colour bar and a line of information), and with
 * the trim and bleed boxes that a print shop's software reads.
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { openPdf, renderPage } from '../../lib/pdf-render';
import { addMarks, type MarkResult, PT, trimOf } from '../../lib/print-pdf';
import { pickFiles } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt } from '../../ui/toast';
import type { Values } from '../types';
import { FileBar, FileDrop, save, stem, useSinglePdf } from './_pdf';
import { clamp } from './_shared';

export interface MarkSettings {
  readonly bleedInPage: number;
  readonly bleed: number;
  readonly crop: boolean;
  readonly bleedMarks: boolean;
  readonly registration: boolean;
  readonly colourBar: boolean;
  readonly info: boolean;
}

const num = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback);
export const readMarks = (v: Values | undefined): MarkSettings => ({
  bleedInPage: num(v?.bleedInPage, 0, 0, 30),
  bleed: num(v?.bleed, 3, 0, 30),
  crop: v?.crop !== false,
  bleedMarks: v?.bleedMarks === true,
  registration: v?.registration !== false,
  colourBar: v?.colourBar !== false,
  info: v?.info !== false,
});

/** A leaflet to try the marks on: A5 with 3 mm of bleed all round, and a trim box that says so. */
async function sampleLeaflet(): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const plain = await doc.embedFont(StandardFonts.Helvetica);
  const bleed = 3 * PT;
  const w = 148 * PT;
  const h = 210 * PT;
  for (const [title, colour] of [
    ['Open day', rgb(0.05, 0.32, 0.55)],
    ['Programme', rgb(0.62, 0.2, 0.16)],
  ] as const) {
    const page = doc.addPage([w + 2 * bleed, h + 2 * bleed]);
    // The colour runs past the trim into the bleed, as artwork that prints to the edge must.
    page.drawRectangle({ x: 0, y: h * 0.55 + bleed, width: w + 2 * bleed, height: h * 0.45 + bleed, color: colour });
    page.drawRectangle({ x: 0, y: 0, width: w + 2 * bleed, height: 18 * PT + bleed, color: rgb(0.93, 0.74, 0.2) });
    page.drawText(title, { x: bleed + 14 * PT, y: bleed + h * 0.68, size: 34, font, color: rgb(1, 1, 1) });
    page.drawText('Saturday, 10 am to 5 pm', { x: bleed + 14 * PT, y: bleed + h * 0.62, size: 13, font: plain, color: rgb(1, 1, 1) });
    for (let line = 0; line < 9; line++)
      page.drawRectangle({ x: bleed + 14 * PT, y: bleed + h * 0.46 - line * 9 * PT, width: (line % 3 === 2 ? 70 : 118) * PT, height: 2.2 * PT, color: rgb(0.72, 0.74, 0.78) });
    page.node.set(doc.context.obj('TrimBox'), doc.context.obj([bleed, bleed, bleed + w, bleed + h]));
  }
  const bytes = await doc.save();
  return new File([bytes as Uint8Array<ArrayBuffer>], 'sample-leaflet.pdf', { type: 'application/pdf' });
}

const mmText = (value: number) => `${Math.round(value * 10) / 10}`;

export function MarksTab({ settings, set }: { settings: MarkSettings; set: (patch: Partial<MarkSettings>) => void }) {
  const [file, take, clear, loading] = useSinglePdf();
  const [result, setResult] = useState<MarkResult | null>(null);
  const [problem, setProblem] = useState('');
  const [picture, setPicture] = useState('');
  const [shown, setShown] = useState(1);

  /** What the file says about its first page: its trim, and whether the trim is the file's own. */
  const found = useMemo(() => {
    if (!file) return null;
    const { trim, media, own } = trimOf(file.doc.getPage(0), settings.bleedInPage);
    return { own, width: trim.width / PT, height: trim.height / PT, pageWidth: media.width / PT, pageHeight: media.height / PT };
  }, [file, settings.bleedInPage]);

  useEffect(() => {
    setResult(null);
    setProblem('');
    if (!file) return;
    let live = true;
    // A short wait, so that typing a number does not rebuild the PDF at every key.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const made = await addMarks(file.doc, { ...settings, name: file.name, date: new Date().toISOString().slice(0, 10) });
          if (live) setResult(made);
        } catch (error) {
          if (live) setProblem(error instanceof Error ? error.message : String(error));
        }
      })();
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [file, settings]);

  useEffect(() => {
    setShown(1);
  }, [file]);

  useEffect(() => {
    if (!result) return;
    let live = true;
    let close: (() => Promise<void>) | null = null;
    void (async () => {
      try {
        const opened = await openPdf(result.bytes);
        close = opened.close;
        const number = clamp(shown, 1, result.pages);
        const page = await opened.doc.getPage(number);
        const canvas = await renderPage(opened.doc, number, 900 / page.getViewport({ scale: 1 }).width);
        if (live) setPicture(canvas.toDataURL('image/png'));
      } catch {
        if (live) setPicture('');
      }
    })();
    return () => {
      live = false;
      void close?.();
    };
  }, [result, shown]);

  const short = result && settings.bleed > 0 && result.bleedFound < settings.bleed - 0.05;
  const check = (key: 'crop' | 'bleedMarks' | 'registration' | 'colourBar' | 'info', label: string) => (
    <label class="check">
      <input type="checkbox" checked={settings[key]} onChange={(e) => set({ [key]: e.currentTarget.checked })} data-testid={`pm-${key}`} />
      {label}
    </label>
  );

  return (
    <div class="pp-main" data-testid="pp-marks" data-state={result ? 'done' : file ? 'running' : 'idle'}>
      <div class="pp-stage">
        {file ? (
          <>
            <FileBar file={file} onReplace={() => attempt(async () => take(await pickFiles('.pdf,application/pdf')))} onClear={clear} />
            {problem ? (
              <p class="recipe-error" data-testid="pm-problem">
                {problem}
              </p>
            ) : picture && result ? (
              <>
                <img class="pp-page" src={picture} alt={`Page ${clamp(shown, 1, result.pages)} with its marks`} data-testid="pm-preview" />
                {result.pages > 1 && (
                  <div class="button-row pp-pager">
                    <button type="button" class="icon-button" aria-label="Previous page" disabled={shown <= 1} onClick={() => setShown((n) => Math.max(1, n - 1))}>
                      <Icon name="left" size={16} />
                    </button>
                    <span data-testid="pm-page">
                      Page {clamp(shown, 1, result.pages)} of {result.pages}
                    </span>
                    <button
                      type="button"
                      class="icon-button"
                      aria-label="Next page"
                      disabled={shown >= result.pages}
                      onClick={() => setShown((n) => Math.min(result.pages, n + 1))}
                      data-testid="pm-next"
                    >
                      <Icon name="right" size={16} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p class="tone-muted">Drawing the marks…</p>
            )}
          </>
        ) : (
          <>
            <FileDrop
              accept=".pdf,application/pdf"
              multiple={false}
              onFiles={take}
              title={loading ? 'Reading…' : 'Drop a PDF here, or click to choose'}
              hint="Each page comes back on a larger page with the marks a print shop cuts and checks by."
              testId="pm-drop"
            />
            <div class="button-row">
              <button type="button" class="button button-small button-quiet" onClick={() => attempt(async () => take([await sampleLeaflet()]))} data-testid="pm-sample">
                <Icon name="sample" size={15} /> Try a sample leaflet
              </button>
            </div>
          </>
        )}
      </div>

      <div class="pp-side">
        <div class="pp-panel">
          <span class="pane-title">Trim and bleed</span>
          {found && (
            <p class="control-help" data-testid="pm-found">
              {found.own
                ? `This PDF says where its pages are trimmed: ${mmText(found.width)} × ${mmText(found.height)} mm, on pages of ${mmText(found.pageWidth)} × ${mmText(found.pageHeight)} mm.`
                : `This PDF does not say where its pages are trimmed. With the bleed entered here, the finished size is ${mmText(found.width)} × ${mmText(found.height)} mm.`}
            </p>
          )}
          <div class="control-row">
            <label class={`control${found?.own ? ' is-off' : ''}`}>
              <span class="control-label">Bleed the pages already include (mm)</span>
              <input
                class="input input-number"
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={settings.bleedInPage}
                disabled={found?.own === true}
                onInput={(e) => set({ bleedInPage: clamp(Number(e.currentTarget.value) || 0, 0, 30) })}
                data-testid="pm-in-page"
              />
            </label>
            <label class="control">
              <span class="control-label">Bleed to keep (mm)</span>
              <input
                class="input input-number"
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={settings.bleed}
                onInput={(e) => set({ bleed: clamp(Number(e.currentTarget.value) || 0, 0, 30) })}
                data-testid="pm-bleed"
              />
            </label>
          </div>
          <p class="control-help">
            Bleed is the artwork that runs past the cut, so that no white edge shows when the knife lands a little off. Most printers ask for 3 mm; large formats often for 5 mm or more.
          </p>
        </div>

        <div class="pp-panel">
          <span class="pane-title">Marks</span>
          {check('crop', 'Crop marks (where to cut)')}
          {check('bleedMarks', 'Bleed marks (where the bleed ends)')}
          {check('registration', 'Registration targets (for lining up the plates)')}
          {check('colourBar', 'Colour bar (solids, overprints and tints to measure)')}
          {check('info', 'Information line (file, page, size, date)')}
          <p class="control-help">Crop marks, targets and the information line are drawn in the registration colour, which prints on every plate.</p>
        </div>

        <div class="pp-panel" data-testid="pm-summary">
          <span class="pane-title">Result</span>
          {result ? (
            <dl class="pp-facts">
              <div>
                <dt>Finished (trimmed) size</dt>
                <dd data-testid="pm-trim">
                  {mmText(result.trim.width)} × {mmText(result.trim.height)} mm
                </dd>
              </div>
              <div>
                <dt>Page with marks</dt>
                <dd data-testid="pm-sheet">
                  {mmText(result.sheet.width)} × {mmText(result.sheet.height)} mm
                </dd>
              </div>
              <div>
                <dt>Pages</dt>
                <dd>{result.pages}</dd>
              </div>
              <div>
                <dt>Size of the file</dt>
                <dd>{formatBytes(result.bytes.length)}</dd>
              </div>
            </dl>
          ) : (
            <p class="tone-muted">{file ? 'Working…' : 'Nothing yet.'}</p>
          )}
          {short && result && (
            <p class="pp-warning" data-testid="pm-short">
              <Icon name="alert" size={15} />
              <span>
                {result.bleedFound < 0.05
                  ? `The pages have no bleed, and ${mmText(settings.bleed)} mm is asked for: artwork that runs to the edge may show a white sliver after cutting. Extend it past the page edge in the program the PDF came from, and export with bleed.`
                  : `The pages have ${mmText(result.bleedFound)} mm of bleed, less than the ${mmText(settings.bleed)} mm asked for: the rest of the bleed area stays empty.`}
              </span>
            </p>
          )}
          <div class="button-row">
            <button
              type="button"
              class="button button-small button-primary"
              disabled={!result || !file}
              onClick={() =>
                attempt(async () => {
                  if (result && file) await save(`${stem(file.name)}-marks.pdf`, result.bytes);
                })
              }
              data-testid="pm-save"
            >
              <Icon name="save" size={14} /> Save the PDF with marks
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
