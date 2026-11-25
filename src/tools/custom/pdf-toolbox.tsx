/**
 * PDF Toolbox: the jobs PDF suites such as Stirling PDF do, in the page —
 * bookmarks, attachments, form fields, overlays, stamps of pictures and QR
 * codes, colours, blank pages, page size, auto-rotation, clean-up
 * (annotations, signatures, scripts, metadata), flattening, unlocking
 * fields, repair, a report of everything in a file, JavaScript, an
 * accessibility check, pulling out pictures and scanned photos, a file name
 * from the title, and an RFC 3161 timestamp from a timestamp server.
 */
import { zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { useEffect, useState } from 'preact/hooks';
import { fromBase64, toBase64 } from '../../lib/bytes';
import { loadPdf, parsePages } from '../../lib/pdf-edit';
import { type ExtractedImage, extractImages, findBlankPages, guessTitle, pagesWithText, type Recolour, rasterise, splitPhotos, uprightRotations } from '../../lib/pdf-raster';
import { isSigned } from '../../lib/pdf-sign';
import {
  type Attachment,
  accessibility,
  addField,
  type Check,
  type FieldInfo,
  findJavaScript,
  flattenForm,
  insertBlankPages,
  insertTimestamp,
  listAttachments,
  listFields,
  type NewFieldKind,
  type OutlineItem,
  onePage,
  overlay,
  PAPER,
  prepareTimestamp,
  readOutline,
  removeAnnotations,
  removeAttachments,
  removeField,
  removeSignatures,
  report,
  resizePages,
  type Script,
  sanitise,
  setFieldFlags,
  timestampRequest,
  timestampToken,
  unlockFields,
  writeOutline,
} from '../../lib/pdf-toolbox';
import { pickFiles, saveFile } from '../../platform';
import { net } from '../../platform/net';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { FileBar, FileDrop, type PdfFile, readPdf, save, stem, useSinglePdf, useThumbnails } from './_pdf';

type OpId =
  | 'bookmarks'
  | 'attachments'
  | 'fields'
  | 'overlay'
  | 'stamp'
  | 'colours'
  | 'blank-add'
  | 'blank-remove'
  | 'one-page'
  | 'page-size'
  | 'auto-rotate'
  | 'annotations'
  | 'signatures'
  | 'sanitise'
  | 'flatten'
  | 'unlock'
  | 'repair'
  | 'report'
  | 'javascript'
  | 'accessibility'
  | 'images'
  | 'photos'
  | 'rename'
  | 'timestamp';

const GROUPS: readonly { readonly name: string; readonly ops: readonly { readonly id: OpId; readonly label: string; readonly hint: string }[] }[] = [
  {
    name: 'Edit',
    ops: [
      { id: 'bookmarks', label: 'Bookmarks', hint: 'Edit the table of contents shown beside the pages.' },
      { id: 'attachments', label: 'Attached files', hint: 'See, save, add and remove files carried inside the PDF.' },
      { id: 'fields', label: 'Form fields', hint: 'Add, describe, lock and delete fillable fields.' },
      { id: 'overlay', label: 'Overlay another PDF', hint: 'Lay a letterhead, form or watermark PDF over or under every page.' },
      { id: 'stamp', label: 'Picture or QR code', hint: 'Place a logo, photo or QR code on the pages.' },
      { id: 'colours', label: 'Colours', hint: 'Grey, inverted, more contrast, black and white, or one colour swapped for another.' },
    ],
  },
  {
    name: 'Pages',
    ops: [
      { id: 'blank-add', label: 'Insert blank pages', hint: 'Add empty pages after chosen pages, for notes or double-sided printing.' },
      { id: 'blank-remove', label: 'Remove blank pages', hint: 'Find and delete pages with next to no ink, as left by scanners.' },
      { id: 'one-page', label: 'One long page', hint: 'Put every page on one tall (or wide) page.' },
      { id: 'page-size', label: 'Page size and scale', hint: 'Redraw pages on another paper size, fitted and centred, or scaled.' },
      { id: 'auto-rotate', label: 'Turn pages upright', hint: 'Turn pages whose text runs sideways or upside down.' },
    ],
  },
  {
    name: 'Clean up',
    ops: [
      { id: 'annotations', label: 'Remove comments and links', hint: 'Take out annotations: highlights, notes, drawings, links.' },
      { id: 'signatures', label: 'Remove signatures', hint: 'Clear digital signatures (to edit a signed copy).' },
      { id: 'sanitise', label: 'Sanitise', hint: 'Take out scripts, attached files, metadata and outside links.' },
      { id: 'flatten', label: 'Flatten', hint: 'Make form answers part of the page, or the whole page a picture.' },
      { id: 'unlock', label: 'Unlock form fields', hint: 'Let read-only fields be filled in again.' },
      { id: 'repair', label: 'Repair', hint: 'Rewrite a damaged PDF from what can be read of it.' },
    ],
  },
  {
    name: 'Look inside',
    ops: [
      { id: 'report', label: 'Everything in this PDF', hint: 'Pages, fonts, pictures, fields, attachments, scripts and more.' },
      { id: 'javascript', label: 'JavaScript', hint: 'Show every script in the file and when it runs.' },
      { id: 'accessibility', label: 'Accessibility check', hint: 'Tags, language, title, fonts, picture descriptions, bookmarks.' },
    ],
  },
  {
    name: 'Take out',
    ops: [
      { id: 'images', label: 'Pictures', hint: 'Save every picture in the PDF as PNG files.' },
      { id: 'photos', label: 'Photos from a scan', hint: 'Cut several photos scanned on one page into separate pictures.' },
      { id: 'rename', label: 'Name from the title', hint: 'Save with a file name taken from the title on page 1.' },
    ],
  },
  {
    name: 'Sign',
    ops: [{ id: 'timestamp', label: 'Timestamp (RFC 3161)', hint: 'Have a timestamp server certify when the PDF existed. Desktop app, online.' }],
  },
];

interface Result {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly note: string;
}

type Panel = { file: PdfFile; done: (bytes: Uint8Array, suffix: string, note: string) => void; busy: (text: string | null) => void };

const mm = (pt: number) => (pt / 72) * 25.4;
const pt = (millimetres: number) => (millimetres / 25.4) * 72;

async function finished(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}

function RunButton({ label, onClick, disabled, test }: { label: string; onClick: () => void; disabled?: boolean; test?: string }) {
  return (
    <button type="button" class="button button-primary" onClick={onClick} disabled={disabled} data-testid={test ?? 'tb-run'}>
      {label}
    </button>
  );
}

/* ------------------------------------------------------------ bookmarks -- */

interface Row {
  readonly title: string;
  readonly page: number;
  readonly level: number;
}

const flatten = (items: readonly OutlineItem[], level = 0): Row[] => items.flatMap((i) => [{ title: i.title, page: i.page, level }, ...flatten(i.children, level + 1)]);
function nest(rows: readonly Row[]): OutlineItem[] {
  const root: { children: OutlineItem[] } = { children: [] };
  const stack: { level: number; node: { children: OutlineItem[] } }[] = [{ level: -1, node: root }];
  for (const r of rows) {
    while ((stack[stack.length - 1]?.level ?? -1) >= r.level) stack.pop();
    const item = { title: r.title, page: r.page, children: [] as OutlineItem[] };
    (stack[stack.length - 1]?.node ?? root).children.push(item);
    stack.push({ level: r.level, node: item });
  }
  return root.children;
}

function BookmarksPanel({ file, done }: Panel) {
  const [rows, setRows] = useState<Row[]>(() => flatten(readOutline(file.doc)));
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: number) =>
    setRows((r) => {
      const next = [...r];
      const [item] = next.splice(i, 1);
      if (item) next.splice(Math.max(0, Math.min(next.length, i + by)), 0, item);
      return next;
    });
  return (
    <div class="tb-panel">
      {rows.length === 0 && <p class="tone-muted">This PDF has no bookmarks yet.</p>}
      <ol class="tb-bookmarks" data-testid="tb-bookmarks">
        {rows.map((r, i) => (
          <li key={i} style={{ paddingLeft: `${r.level * 22}px` }}>
            <input class="input" value={r.title} aria-label={`Bookmark ${i + 1} title`} onInput={(e) => set(i, { title: e.currentTarget.value })} data-testid={`tb-bm-title-${i}`} />
            <label class="tb-inline">
              page
              <input
                type="number"
                class="input input-number"
                min={1}
                max={file.pages}
                value={r.page || 1}
                onChange={(e) => set(i, { page: Math.min(file.pages, Math.max(1, Number(e.currentTarget.value) || 1)) })}
              />
            </label>
            <span class="tb-mini" role="group" aria-label="Arrange">
              <button type="button" class="button button-small button-quiet" title="Less indented" onClick={() => set(i, { level: Math.max(0, r.level - 1) })} disabled={r.level === 0}>
                ←
              </button>
              <button
                type="button"
                class="button button-small button-quiet"
                title="More indented"
                onClick={() => set(i, { level: Math.min((rows[i - 1]?.level ?? -1) + 1, r.level + 1) })}
                disabled={i === 0}
              >
                →
              </button>
              <button type="button" class="button button-small button-quiet" title="Up" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button type="button" class="button button-small button-quiet" title="Down" onClick={() => move(i, 1)} disabled={i === rows.length - 1}>
                ↓
              </button>
              <button type="button" class="button button-small button-quiet" title="Delete" onClick={() => setRows((rr) => rr.filter((_, j) => j !== i))}>
                ×
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div class="button-row">
        <button
          type="button"
          class="button button-small"
          onClick={() => setRows((r) => [...r, { title: `Bookmark ${r.length + 1}`, page: Math.min(file.pages, (r[r.length - 1]?.page ?? 0) + 1), level: 0 }])}
          data-testid="tb-bm-add"
        >
          Add a bookmark
        </button>
        <button type="button" class="button button-small" onClick={() => setRows(Array.from({ length: file.pages }, (_, i) => ({ title: `Page ${i + 1}`, page: i + 1, level: 0 })))}>
          One for each page
        </button>
        <button type="button" class="button button-small button-quiet" onClick={() => setRows([])}>
          Clear all
        </button>
      </div>
      <RunButton
        label="Save the bookmarks"
        onClick={() =>
          attempt(async () => {
            const doc = await loadPdf(file.bytes);
            writeOutline(doc, nest(rows));
            done(await finished(doc), 'bookmarks', rows.length ? `${rows.length} bookmarks written; viewers open with the bookmarks panel showing.` : 'Bookmarks removed.');
          })
        }
      />
    </div>
  );
}

/* ---------------------------------------------------------- attachments -- */

function AttachmentsPanel({ file, done }: Panel) {
  const [list, setList] = useState<Attachment[]>(() => listAttachments(file.doc));
  const [added, setAdded] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const shown = list.filter((a) => !removed.includes(a.name));
  useEffect(() => setList(listAttachments(file.doc)), [file]);
  return (
    <div class="tb-panel">
      <table class="lab-table" data-testid="tb-attachments">
        <thead>
          <tr>
            <th>File</th>
            <th>Size</th>
            <th>Where</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((a) => (
            <tr key={a.name}>
              <td>{a.name}</td>
              <td>{(a.size / 1024).toFixed(1)} KB</td>
              <td>{a.where === 'document' ? 'the document' : `page ${a.where}`}</td>
              <td class="tb-actions">
                <button
                  type="button"
                  class="button button-small"
                  onClick={() =>
                    attempt(async () => {
                      await saveFile(a.name, a.bytes);
                    })
                  }
                >
                  Save
                </button>
                {a.where === 'document' && (
                  <button type="button" class="button button-small button-quiet" onClick={() => setRemoved((r) => [...r, a.name])}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
          {added.map((f) => (
            <tr key={`new-${f.name}`}>
              <td>{f.name}</td>
              <td>{(f.size / 1024).toFixed(1)} KB</td>
              <td>to be added</td>
              <td>
                <button type="button" class="button button-small button-quiet" onClick={() => setAdded((x) => x.filter((y) => y !== f))}>
                  Drop
                </button>
              </td>
            </tr>
          ))}
          {!shown.length && !added.length && (
            <tr>
              <td colSpan={4} class="tone-muted">
                No attached files.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div class="button-row">
        <button type="button" class="button button-small" onClick={() => attempt(async () => setAdded([...added, ...(await pickFiles(''))]))} data-testid="tb-attach-add">
          Add files…
        </button>
      </div>
      <RunButton
        label="Save the PDF"
        disabled={!added.length && !removed.length}
        onClick={() =>
          attempt(async () => {
            const doc = await loadPdf(file.bytes);
            if (removed.length) removeAttachments(doc, removed);
            for (const f of added) await doc.attach(new Uint8Array(await f.arrayBuffer()), f.name, { mimeType: f.type || 'application/octet-stream', creationDate: new Date(f.lastModified) });
            done(await finished(doc), 'attachments', `${added.length} added, ${removed.length} removed.`);
          })
        }
      />
    </div>
  );
}

/* ----------------------------------------------------------- form fields -- */

function FieldsPanel({ file, done }: Panel) {
  const [fields, setFields] = useState<FieldInfo[]>(() => listFields(file.doc));
  const [work, setWork] = useState<PDFDocument | null>(null);
  const [kind, setKind] = useState<NewFieldKind>('text');
  const [name, setName] = useState('');
  const [page, setPage] = useState(1);
  const [box, setBox] = useState({ left: 20, top: 30, width: 70, height: 9 });
  const [options, setOptions] = useState('Yes, No');
  const [tooltip, setTooltip] = useState('');
  const doc = async () => {
    if (work) return work;
    const d = await loadPdf(file.bytes);
    setWork(d);
    return d;
  };
  const refresh = (d: PDFDocument) => setFields(listFields(d));
  const height = file.doc.getPage(Math.min(file.pages, page) - 1).getHeight();
  return (
    <div class="tb-panel">
      <table class="lab-table tb-fields" data-testid="tb-fields">
        <thead>
          <tr>
            <th>Field</th>
            <th>Kind</th>
            <th>Page</th>
            <th>Description</th>
            <th>Required</th>
            <th>Read-only</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.name}>
              <td>{f.name}</td>
              <td>{f.kind}</td>
              <td>{f.page || '—'}</td>
              <td>
                <input
                  class="input"
                  value={f.tooltip}
                  aria-label={`Description of ${f.name}`}
                  onChange={(e) =>
                    attempt(async () => {
                      const d = await doc();
                      setFieldFlags(d, f.name, { tooltip: e.currentTarget.value });
                      refresh(d);
                    })
                  }
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={f.required}
                  aria-label={`${f.name} required`}
                  onChange={(e) =>
                    attempt(async () => {
                      const d = await doc();
                      setFieldFlags(d, f.name, { required: e.currentTarget.checked });
                      refresh(d);
                    })
                  }
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={f.readOnly}
                  aria-label={`${f.name} read-only`}
                  onChange={(e) =>
                    attempt(async () => {
                      const d = await doc();
                      setFieldFlags(d, f.name, { readOnly: e.currentTarget.checked });
                      refresh(d);
                    })
                  }
                />
              </td>
              <td>
                <button
                  type="button"
                  class="button button-small button-quiet"
                  onClick={() =>
                    attempt(async () => {
                      const d = await doc();
                      removeField(d, f.name);
                      refresh(d);
                    })
                  }
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {!fields.length && (
            <tr>
              <td colSpan={7} class="tone-muted">
                No form fields.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <fieldset class="tb-fieldset">
        <legend>Add a field</legend>
        <div class="tb-grid">
          <label>
            Kind
            <select class="select" value={kind} onChange={(e) => setKind(e.currentTarget.value as NewFieldKind)} data-testid="tb-field-kind">
              <option value="text">Text, one line</option>
              <option value="multiline">Text, several lines</option>
              <option value="checkbox">Tick box</option>
              <option value="dropdown">Drop-down list</option>
              <option value="signature">Signature</option>
            </select>
          </label>
          <label>
            Name
            <input class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="e.g. visitor_name" data-testid="tb-field-name" />
          </label>
          <label>
            Page
            <input type="number" class="input input-number" min={1} max={file.pages} value={page} onChange={(e) => setPage(Math.min(file.pages, Math.max(1, Number(e.currentTarget.value) || 1)))} />
          </label>
          {(['left', 'top', 'width', 'height'] as const).map((k) => (
            <label key={k}>
              {k === 'left' ? 'From the left (mm)' : k === 'top' ? 'From the top (mm)' : k === 'width' ? 'Width (mm)' : 'Height (mm)'}
              <input type="number" class="input input-number" min={0} step={0.5} value={box[k]} onChange={(e) => setBox((b) => ({ ...b, [k]: Math.max(0, Number(e.currentTarget.value) || 0) }))} />
            </label>
          ))}
          {kind === 'dropdown' && (
            <label>
              Choices (comma-separated)
              <input class="input" value={options} onInput={(e) => setOptions(e.currentTarget.value)} />
            </label>
          )}
          <label>
            Description for screen readers
            <input class="input" value={tooltip} onInput={(e) => setTooltip(e.currentTarget.value)} />
          </label>
        </div>
        <button
          type="button"
          class="button button-small"
          data-testid="tb-field-add"
          onClick={() =>
            attempt(async () => {
              const d = await doc();
              addField(d, {
                kind,
                name: name.trim(),
                page,
                x: pt(box.left),
                y: height - pt(box.top) - pt(box.height),
                width: pt(box.width),
                height: pt(box.height),
                options: options
                  .split(',')
                  .map((o) => o.trim())
                  .filter(Boolean),
                tooltip,
              });
              refresh(d);
              setName('');
            })
          }
        >
          Add the field
        </button>
      </fieldset>
      <RunButton
        label="Save the PDF"
        disabled={!work}
        onClick={() =>
          attempt(async () => {
            if (work) done(await finished(work), 'fields', `${fields.length} form field${fields.length === 1 ? '' : 's'}.`);
          })
        }
      />
    </div>
  );
}

/* ---------------------------------------------------------- overlay, stamp -- */

function OverlayPanel({ file, done }: Panel) {
  const [other, setOther] = useState<PdfFile | null>(null);
  const [mode, setMode] = useState<'over' | 'under'>('under');
  const [pattern, setPattern] = useState<'first' | 'repeat' | 'match'>('first');
  const [opacity, setOpacity] = useState(100);
  return (
    <div class="tb-panel">
      {other ? (
        <FileBar file={other} onReplace={() => setOther(null)} onClear={() => setOther(null)} />
      ) : (
        <FileDrop
          accept=".pdf,application/pdf"
          multiple={false}
          compact
          title="Choose the PDF to lay on the pages"
          onFiles={(f) => attempt(async () => f[0] && setOther(await readPdf(f[0])))}
          testId="tb-overlay-file"
        />
      )}
      <div class="tb-grid">
        <label>
          Put it
          <select class="select" value={mode} onChange={(e) => setMode(e.currentTarget.value as 'over' | 'under')}>
            <option value="under">Under each page (letterhead, background)</option>
            <option value="over">Over each page (stamp, watermark)</option>
          </select>
        </label>
        <label>
          Pages of it
          <select class="select" value={pattern} onChange={(e) => setPattern(e.currentTarget.value as 'first' | 'repeat' | 'match')}>
            <option value="first">Its first page on every page</option>
            <option value="repeat">Its pages in turn, repeating</option>
            <option value="match">Page for page (then none)</option>
          </select>
        </label>
        <label>
          Opacity (%)
          <input type="number" class="input input-number" min={5} max={100} value={opacity} onChange={(e) => setOpacity(Math.min(100, Math.max(5, Number(e.currentTarget.value) || 100)))} />
        </label>
      </div>
      <RunButton
        label="Overlay"
        disabled={!other}
        onClick={() =>
          attempt(async () => {
            if (!other) return;
            const doc = await loadPdf(file.bytes);
            await overlay(doc, await loadPdf(other.bytes), mode, pattern, opacity / 100);
            done(await finished(doc), 'overlaid', `${other.name} laid ${mode} the pages.`);
          })
        }
      />
    </div>
  );
}

const SPOTS = ['top-left', 'top', 'top-right', 'left', 'centre', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
type Spot = (typeof SPOTS)[number];

async function qrPng(text: string): Promise<Uint8Array> {
  const { toSVG } = await import('bwip-js/generic');
  const svg = toSVG({ bcid: 'qrcode', text, scale: 4, paddingwidth: 2, paddingheight: 2, backgroundcolor: 'FFFFFF' } as Parameters<typeof toSVG>[0]);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The QR code could not be drawn.'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No drawing surface.');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, 600, 600);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The QR code could not be drawn.');
  return new Uint8Array(await blob.arrayBuffer());
}

function StampPanel({ file, done }: Panel) {
  const [source, setSource] = useState<'picture' | 'qr'>('qr');
  const [picture, setPicture] = useState<File | null>(null);
  const [text, setText] = useState('https://');
  const [spot, setSpot] = useState<Spot>('bottom-right');
  const [width, setWidth] = useState(25);
  const [margin, setMargin] = useState(10);
  const [opacity, setOpacity] = useState(100);
  const [pages, setPages] = useState('all');
  return (
    <div class="tb-panel">
      <div class="button-row">
        <label class="check">
          <input type="radio" name="tb-stamp" checked={source === 'qr'} onChange={() => setSource('qr')} /> QR code
        </label>
        <label class="check">
          <input type="radio" name="tb-stamp" checked={source === 'picture'} onChange={() => setSource('picture')} /> Picture (PNG or JPEG)
        </label>
      </div>
      {source === 'qr' ? (
        <label class="tb-wide">
          Text or link in the QR code
          <input class="input" value={text} onInput={(e) => setText(e.currentTarget.value)} data-testid="tb-qr-text" />
        </label>
      ) : (
        <button type="button" class="button button-small" onClick={() => attempt(async () => setPicture((await pickFiles('image/png,image/jpeg'))[0] ?? null))}>
          {picture ? picture.name : 'Choose a picture…'}
        </button>
      )}
      <div class="tb-grid">
        <label>
          Where
          <select class="select" value={spot} onChange={(e) => setSpot(e.currentTarget.value as Spot)}>
            {SPOTS.map((s) => (
              <option key={s} value={s}>
                {s.replace('-', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Width (mm)
          <input type="number" class="input input-number" min={3} max={500} value={width} onChange={(e) => setWidth(Math.max(3, Number(e.currentTarget.value) || 25))} />
        </label>
        <label>
          From the edge (mm)
          <input type="number" class="input input-number" min={0} max={200} value={margin} onChange={(e) => setMargin(Math.max(0, Number(e.currentTarget.value) || 0))} />
        </label>
        <label>
          Opacity (%)
          <input type="number" class="input input-number" min={5} max={100} value={opacity} onChange={(e) => setOpacity(Math.min(100, Math.max(5, Number(e.currentTarget.value) || 100)))} />
        </label>
        <label>
          Pages
          <input class="input" value={pages} onInput={(e) => setPages(e.currentTarget.value)} placeholder="all, or 1-3, 5" />
        </label>
      </div>
      <RunButton
        label="Place it"
        disabled={source === 'picture' ? !picture : !text.trim()}
        onClick={() =>
          attempt(async () => {
            const doc = await loadPdf(file.bytes);
            const bytes = source === 'qr' ? await qrPng(text.trim()) : new Uint8Array(await (picture as File).arrayBuffer());
            const image = source === 'picture' && /jpe?g$/i.test(picture?.name ?? '') ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
            const list = pages.trim().toLowerCase() === 'all' || !pages.trim() ? doc.getPages().map((_, i) => i + 1) : parsePages(pages, doc.getPageCount());
            for (const n of list) {
              const page = doc.getPage(n - 1);
              const { width: pw, height: ph } = page.getSize();
              const w = pt(width);
              const h = (w * image.height) / image.width;
              const m = pt(margin);
              const col = spot.endsWith('left') || spot === 'left' ? 0 : spot.endsWith('right') || spot === 'right' ? 2 : 1;
              const row = spot.startsWith('top') ? 0 : spot.startsWith('bottom') ? 2 : 1;
              const x = col === 0 ? m : col === 2 ? pw - m - w : (pw - w) / 2;
              const y = row === 0 ? ph - m - h : row === 2 ? m : (ph - h) / 2;
              page.drawImage(image, { x, y, width: w, height: h, opacity: opacity / 100 });
            }
            done(await finished(doc), source === 'qr' ? 'QR code' : 'stamped', `Placed on ${list.length} page${list.length === 1 ? '' : 's'}.`);
          })
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------- colours -- */

function ColoursPanel({ file, done, busy }: Panel) {
  const [kind, setKind] = useState<Recolour['kind']>('grayscale');
  const [amount, setAmount] = useState(1.6);
  const [threshold, setThreshold] = useState(150);
  const [from, setFrom] = useState('#ff0000');
  const [to, setTo] = useState('#000000');
  const [tolerance, setTolerance] = useState(60);
  const [dpi, setDpi] = useState(150);
  const recipe = (): Recolour =>
    kind === 'contrast'
      ? { kind, amount }
      : kind === 'blackwhite'
        ? { kind, threshold }
        : kind === 'replace'
          ? { kind, from, to, tolerance }
          : kind === 'invert'
            ? { kind }
            : kind === 'none'
              ? { kind }
              : { kind: 'grayscale' };
  return (
    <div class="tb-panel">
      <div class="tb-grid">
        <label>
          Change
          <select class="select" value={kind} onChange={(e) => setKind(e.currentTarget.value as Recolour['kind'])} data-testid="tb-colour-kind">
            <option value="grayscale">Shades of grey</option>
            <option value="invert">Invert (light on dark)</option>
            <option value="contrast">More contrast</option>
            <option value="blackwhite">Black and white only</option>
            <option value="replace">Swap one colour for another</option>
          </select>
        </label>
        {kind === 'contrast' && (
          <label>
            Contrast (×)
            <input type="number" class="input input-number" min={1} max={4} step={0.1} value={amount} onChange={(e) => setAmount(Number(e.currentTarget.value) || 1.6)} />
          </label>
        )}
        {kind === 'blackwhite' && (
          <label>
            Lighter than this goes white (0–255)
            <input type="number" class="input input-number" min={1} max={254} value={threshold} onChange={(e) => setThreshold(Number(e.currentTarget.value) || 150)} />
          </label>
        )}
        {kind === 'replace' && (
          <>
            <label>
              Colour
              <input type="color" value={from} onInput={(e) => setFrom(e.currentTarget.value)} />
            </label>
            <label>
              Becomes
              <input type="color" value={to} onInput={(e) => setTo(e.currentTarget.value)} />
            </label>
            <label>
              Tolerance
              <input type="number" class="input input-number" min={0} max={441} value={tolerance} onChange={(e) => setTolerance(Number(e.currentTarget.value) || 0)} />
            </label>
          </>
        )}
        <label>
          Resolution (dpi)
          <input type="number" class="input input-number" min={50} max={600} step={10} value={dpi} onChange={(e) => setDpi(Math.min(600, Math.max(50, Number(e.currentTarget.value) || 150)))} />
        </label>
      </div>
      <p class="control-help">
        The pages are redrawn as pictures, so their text can no longer be selected or searched. To turn a PDF grey and keep its text, use PDF Passwords and Compression → Shades of grey (desktop app).
      </p>
      <RunButton
        label="Change the colours"
        onClick={() =>
          attempt(async () => {
            const out = await rasterise(file.bytes, recipe(), dpi, (n, of) => busy(`Page ${n} of ${of}…`));
            busy(null);
            done(out, kind === 'grayscale' ? 'grey' : kind, 'Pages redrawn as pictures.');
          }).finally(() => busy(null))
        }
      />
    </div>
  );
}

/* --------------------------------------------------------------- pages -- */

function BlankAddPanel({ file, done }: Panel) {
  const [after, setAfter] = useState('every');
  const [count, setCount] = useState(1);
  return (
    <div class="tb-panel">
      <div class="tb-grid">
        <label>
          After pages
          <input class="input" value={after} onInput={(e) => setAfter(e.currentTarget.value)} placeholder="every, 0 (before the first), 2, 5" data-testid="tb-blank-after" />
        </label>
        <label>
          Blank pages each time
          <input type="number" class="input input-number" min={1} max={20} value={count} onChange={(e) => setCount(Math.min(20, Math.max(1, Number(e.currentTarget.value) || 1)))} />
        </label>
      </div>
      <RunButton
        label="Insert"
        onClick={() =>
          attempt(async () => {
            const doc = await loadPdf(file.bytes);
            const text = after.trim().toLowerCase();
            const list =
              text === 'every'
                ? doc.getPages().map((_, i) => i + 1)
                : text.split(/[\s,;]+/).some((x) => x === '0')
                  ? [0, ...parsePages(text.replace(/\b0\b/, ''), file.pages)]
                  : parsePages(text, file.pages);
            const n = insertBlankPages(doc, list, count);
            done(await finished(doc), 'with blank pages', `${n} blank page${n === 1 ? '' : 's'} inserted.`);
          })
        }
      />
    </div>
  );
}

function BlankRemovePanel({ file, done, busy }: Panel) {
  const [ink, setInk] = useState(0.2);
  const [keepText, setKeepText] = useState(true);
  const [found, setFound] = useState<number[] | null>(null);
  const thumbs = useThumbnails(found?.length ? file : null, 110, 400);
  return (
    <div class="tb-panel">
      <label class="tb-wide">
        A page is blank with less ink than (% of the page)
        <input type="number" class="input input-number" min={0} max={5} step={0.05} value={ink} onChange={(e) => setInk(Math.max(0, Number(e.currentTarget.value) || 0))} />
      </label>
      <label class="check">
        <input type="checkbox" checked={keepText} onChange={(e) => setKeepText(e.currentTarget.checked)} /> Keep pages with any text, however little
      </label>
      <div class="button-row">
        <button
          type="button"
          class="button"
          data-testid="tb-blank-find"
          onClick={() =>
            attempt(async () => {
              busy('Looking at each page…');
              setFound(await findBlankPages(file.bytes, { maxInk: ink / 100, keepText }));
            }).finally(() => busy(null))
          }
        >
          Find blank pages
        </button>
      </div>
      {found && (
        <>
          <p data-testid="tb-blank-found">{found.length ? `Blank: page${found.length === 1 ? '' : 's'} ${found.join(', ')}.` : 'No blank pages found.'}</p>
          <div class="tb-thumbs">{found.map((n) => (thumbs[n - 1] ? <img key={n} src={thumbs[n - 1]} alt={`Page ${n}`} /> : null))}</div>
          <RunButton
            label={`Remove ${found.length} page${found.length === 1 ? '' : 's'}`}
            disabled={!found.length || found.length === file.pages}
            onClick={() =>
              attempt(async () => {
                const doc = await loadPdf(file.bytes);
                for (const n of [...found].sort((a, b) => b - a)) doc.removePage(n - 1);
                done(await finished(doc), 'no blanks', `Removed page${found.length === 1 ? '' : 's'} ${found.join(', ')}.`);
              })
            }
          />
        </>
      )}
    </div>
  );
}

function OnePagePanel({ file, done }: Panel) {
  const [direction, setDirection] = useState<'down' | 'across'>('down');
  const [gap, setGap] = useState(0);
  return (
    <div class="tb-panel">
      <div class="tb-grid">
        <label>
          Pages run
          <select class="select" value={direction} onChange={(e) => setDirection(e.currentTarget.value as 'down' | 'across')}>
            <option value="down">Down (one tall page)</option>
            <option value="across">Across (one wide page)</option>
          </select>
        </label>
        <label>
          Gap between pages (mm)
          <input type="number" class="input input-number" min={0} max={100} value={gap} onChange={(e) => setGap(Math.max(0, Number(e.currentTarget.value) || 0))} />
        </label>
      </div>
      <RunButton
        label="Make one page"
        onClick={() =>
          attempt(async () => {
            const target = await PDFDocument.create();
            await onePage(await loadPdf(file.bytes), target, direction, pt(gap));
            const s = target.getPage(0).getSize();
            done(await finished(target), 'one page', `One page of ${Math.round(mm(s.width))} × ${Math.round(mm(s.height))} mm.`);
          })
        }
      />
    </div>
  );
}

function PageSizePanel({ file, done }: Panel) {
  const [paper, setPaper] = useState<keyof typeof PAPER | 'same'>('A4');
  const [orientation, setOrientation] = useState<'keep' | 'portrait' | 'landscape'>('keep');
  const [mode, setMode] = useState<'fit' | 'percent'>('fit');
  const [percent, setPercent] = useState(100);
  return (
    <div class="tb-panel">
      <div class="tb-grid">
        <label>
          Paper
          <select class="select" value={paper} onChange={(e) => setPaper(e.currentTarget.value as keyof typeof PAPER | 'same')} data-testid="tb-paper">
            <option value="same">Same as now</option>
            {(Object.keys(PAPER) as (keyof typeof PAPER)[]).map((k) => (
              <option key={k} value={k}>
                {k} ({Math.round(mm(PAPER[k][0]))} × {Math.round(mm(PAPER[k][1]))} mm)
              </option>
            ))}
          </select>
        </label>
        <label>
          Orientation
          <select class="select" value={orientation} onChange={(e) => setOrientation(e.currentTarget.value as 'keep' | 'portrait' | 'landscape')}>
            <option value="keep">As each page is</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <label>
          Content
          <select class="select" value={mode} onChange={(e) => setMode(e.currentTarget.value as 'fit' | 'percent')}>
            <option value="fit">Fitted to the paper</option>
            <option value="percent">Scaled by a percentage</option>
          </select>
        </label>
        {mode === 'percent' && (
          <label>
            Scale (%)
            <input type="number" class="input input-number" min={5} max={400} value={percent} onChange={(e) => setPercent(Math.min(400, Math.max(5, Number(e.currentTarget.value) || 100)))} />
          </label>
        )}
      </div>
      <p class="control-help">Pages are redrawn on new paper, so links and form fields on them are not kept.</p>
      <RunButton
        label="Resize"
        onClick={() =>
          attempt(async () => {
            const target = await PDFDocument.create();
            await resizePages(await loadPdf(file.bytes), target, paper === 'same' ? null : PAPER[paper], orientation, mode === 'percent' ? percent : null);
            done(await finished(target), paper === 'same' ? `${percent}%` : paper, 'Pages redrawn on the new paper.');
          })
        }
      />
    </div>
  );
}

function AutoRotatePanel({ file, done, busy }: Panel) {
  const [found, setFound] = useState<(number | null)[] | null>(null);
  const now = file.doc.getPages().map((p) => p.getRotation().angle);
  const changes = found ? found.map((a, i) => (a === null ? null : ((a % 360) + 360) % 360 !== (((now[i] ?? 0) % 360) + 360) % 360 ? a : null)) : [];
  const count = changes.filter((c) => c !== null).length;
  return (
    <div class="tb-panel">
      <p class="control-help">Each page is turned so that most of its text reads upright. Pages with no text (scans before OCR) are left as they are.</p>
      <button
        type="button"
        class="button"
        onClick={() =>
          attempt(async () => {
            busy('Reading the text…');
            setFound(await uprightRotations(file.bytes));
          }).finally(() => busy(null))
        }
        data-testid="tb-rotate-find"
      >
        Check the pages
      </button>
      {found && (
        <>
          <p data-testid="tb-rotate-found">
            {count
              ? `${count} page${count === 1 ? '' : 's'} to turn: ${changes
                  .map((c, i) => (c === null ? '' : `${i + 1} (to ${c}°)`))
                  .filter(Boolean)
                  .join(', ')}.`
              : 'Every page with text already reads upright.'}
          </p>
          <RunButton
            label="Turn them"
            disabled={!count}
            onClick={() =>
              attempt(async () => {
                const doc = await loadPdf(file.bytes);
                const { degrees } = await import('pdf-lib');
                changes.forEach((c, i) => {
                  if (c !== null) doc.getPage(i).setRotation(degrees(c));
                });
                done(await finished(doc), 'upright', `${count} page${count === 1 ? '' : 's'} turned.`);
              })
            }
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- clean up -- */

function AnnotationsPanel({ file, done }: Panel) {
  const [notes, setNotes] = useState(true);
  const [links, setLinks] = useState(true);
  const [fields, setFields] = useState(false);
  const NOTE_KINDS = new Set([
    'Text',
    'Highlight',
    'Underline',
    'StrikeOut',
    'Squiggly',
    'Ink',
    'FreeText',
    'Square',
    'Circle',
    'Line',
    'Polygon',
    'PolyLine',
    'Stamp',
    'Caret',
    'Popup',
    'FileAttachment',
    'Sound',
    'Redact',
  ]);
  return (
    <div class="tb-panel">
      <label class="check">
        <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.currentTarget.checked)} /> Comments, highlights, drawings and stamps
      </label>
      <label class="check">
        <input type="checkbox" checked={links} onChange={(e) => setLinks(e.currentTarget.checked)} /> Links
      </label>
      <label class="check">
        <input type="checkbox" checked={fields} onChange={(e) => setFields(e.currentTarget.checked)} /> Form fields (their boxes; answers are lost)
      </label>
      <RunButton
        label="Remove"
        disabled={!notes && !links && !fields}
        onClick={() =>
          attempt(async () => {
            const doc = await loadPdf(file.bytes);
            const n = removeAnnotations(doc, (s) => (notes && NOTE_KINDS.has(s)) || (links && s === 'Link') || (fields && s === 'Widget'));
            done(await finished(doc), 'clean', `${n} annotation${n === 1 ? '' : 's'} removed.`);
          })
        }
      />
    </div>
  );
}

function SignaturesPanel({ file, done }: Panel) {
  const [drop, setDrop] = useState(false);
  return (
    <div class="tb-panel">
      <p class="control-help">The copy is no longer signed: use it for editing, not as the signed document.</p>
      <label class="check">
        <input type="checkbox" checked={drop} onChange={(e) => setDrop(e.currentTarget.checked)} /> Remove the empty signature fields too
      </label>
      <RunButton
        label="Remove signatures"
        onClick={() =>
          attempt(async () => {
            const doc = await loadPdf(file.bytes);
            const n = removeSignatures(doc, drop);
            done(await finished(doc), 'unsigned', `${n} signature${n === 1 ? '' : 's'} removed.`);
          })
        }
      />
    </div>
  );
}

function SanitisePanel({ file, done }: Panel) {
  const [o, setO] = useState({ javascript: true, embedded: true, metadata: false, links: false });
  const box = (key: keyof typeof o, label: string) => (
    <label class="check">
      <input type="checkbox" checked={o[key]} onChange={(e) => setO((x) => ({ ...x, [key]: e.currentTarget.checked }))} /> {label}
    </label>
  );
  return (
    <div class="tb-panel">
      {box('javascript', 'Scripts, and actions that launch programs or send data')}
      {box('embedded', 'Attached files')}
      {box('metadata', 'Metadata: title, author, dates, editing history')}
      {box('links', 'Links to web pages and other files')}
      <RunButton
        label="Sanitise"
        disabled={!Object.values(o).some(Boolean)}
        onClick={() =>
          attempt(async () => {
            const doc = await loadPdf(file.bytes);
            const done_ = sanitise(doc, o);
            done(await finished(doc), 'sanitised', `${done_.join('; ')}.`);
          })
        }
      />
    </div>
  );
}

function FlattenPanel({ file, done, busy }: Panel) {
  const [mode, setMode] = useState<'forms' | 'all'>('forms');
  const [dpi, setDpi] = useState(150);
  return (
    <div class="tb-panel">
      <label class="check">
        <input type="radio" name="tb-flatten" checked={mode === 'forms'} onChange={() => setMode('forms')} /> Form answers only (text stays text)
      </label>
      <label class="check">
        <input type="radio" name="tb-flatten" checked={mode === 'all'} onChange={() => setMode('all')} /> Everything: each page becomes a picture
      </label>
      {mode === 'all' && (
        <label class="tb-wide">
          Resolution (dpi)
          <input type="number" class="input input-number" min={50} max={600} value={dpi} onChange={(e) => setDpi(Math.min(600, Math.max(50, Number(e.currentTarget.value) || 150)))} />
        </label>
      )}
      <RunButton
        label="Flatten"
        onClick={() =>
          attempt(async () => {
            if (mode === 'all') {
              const out = await rasterise(file.bytes, { kind: 'none' }, dpi, (n, of) => busy(`Page ${n} of ${of}…`));
              done(out, 'flat', 'Every page is now a picture.');
              return;
            }
            const doc = await loadPdf(file.bytes);
            const n = flattenForm(doc);
            done(await finished(doc), 'flat', n ? `${n} field${n === 1 ? '' : 's'} flattened.` : 'There were no form fields.');
          }).finally(() => busy(null))
        }
      />
    </div>
  );
}

function UnlockPanel({ file, done }: Panel) {
  return (
    <div class="tb-panel">
      <RunButton
        label="Unlock the fields"
        onClick={() =>
          attempt(async () => {
            const doc = await loadPdf(file.bytes);
            const n = unlockFields(doc);
            done(await finished(doc), 'unlocked', n ? `${n} read-only field${n === 1 ? '' : 's'} can be filled in again.` : 'No field was read-only.');
          })
        }
      />
    </div>
  );
}

function RepairPanel({ file, done }: Panel) {
  return (
    <div class="tb-panel">
      <p class="control-help">
        The PDF is read as far as it can be and written out afresh, with a new index of its objects. For badly damaged files, PDF Passwords and Compression → Repair uses qpdf (desktop app).
      </p>
      <RunButton
        label="Repair"
        onClick={() =>
          attempt(async () => {
            const doc = await PDFDocument.load(file.bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
            done(await doc.save({ useObjectStreams: false }), 'repaired', `${doc.getPageCount()} pages written out afresh.`);
          })
        }
      />
    </div>
  );
}

/* ----------------------------------------------------------- look inside -- */

function ReportPanel({ file }: Panel) {
  const [data] = useState(() => report(file.doc, file.bytes));
  const json = JSON.stringify(data, null, 2);
  return (
    <div class="tb-panel">
      <div class="button-row">
        <button type="button" class="button button-small" onClick={() => attempt(() => save(`${stem(file.name)} (report).json`, new TextEncoder().encode(json), 'application/json'))}>
          Save as JSON
        </button>
      </div>
      <pre class="tb-report" data-testid="tb-report">
        {json}
      </pre>
    </div>
  );
}

function JavaScriptPanel({ file }: Panel) {
  const [scripts] = useState<Script[]>(() => findJavaScript(file.doc));
  return (
    <div class="tb-panel" data-testid="tb-scripts">
      {scripts.length === 0 ? (
        <p>No JavaScript in this PDF.</p>
      ) : (
        scripts.map((s, i) => (
          <div key={i} class="tb-script">
            <strong>{s.where}</strong>
            <pre>{s.code}</pre>
          </div>
        ))
      )}
      {scripts.length > 0 && <p class="control-help">Sanitise removes them.</p>}
    </div>
  );
}

function AccessibilityPanel({ file, busy }: Panel) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  useEffect(() => {
    void attempt(async () => {
      busy('Checking…');
      const text = await pagesWithText(file.bytes).catch(() => undefined);
      setChecks(accessibility(file.doc, text));
    }).finally(() => busy(null));
  }, [file]);
  return (
    <div class="tb-panel">
      {checks && (
        <ul class="tb-checks" data-testid="tb-checks">
          {checks.map((c) => (
            <li key={c.id} class={`is-${c.result}`}>
              <span class="tb-check-mark">{c.result === 'pass' ? '✓' : c.result === 'warn' ? '!' : '✗'}</span>
              <strong>{c.label}</strong>
              <span>{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {checks && <p class="control-help">These are the checks a program can make; reading order, colour contrast and how clear the wording is still need a person.</p>}
    </div>
  );
}

/* -------------------------------------------------------------- take out -- */

function PicturesPanel({ file, busy, photos }: Panel & { photos: boolean }) {
  const [found, setFound] = useState<ExtractedImage[] | null>(null);
  const urls = (found ?? []).slice(0, 60).map((i) => URL.createObjectURL(new Blob([i.png as BlobPart], { type: 'image/png' })));
  useEffect(
    () => () => {
      for (const u of urls) URL.revokeObjectURL(u);
    },
    [found],
  );
  return (
    <div class="tb-panel">
      {photos && <p class="control-help">For scans with several photos laid on the glass: each is cut out along its edges. Works best with space between the photos and a plain background.</p>}
      <button
        type="button"
        class="button"
        data-testid="tb-images-find"
        onClick={() =>
          attempt(async () => {
            const step = (n: number, of: number) => busy(`Page ${n} of ${of}…`);
            setFound(photos ? await splitPhotos(file.bytes, 150, step) : await extractImages(file.bytes, 16, step));
          }).finally(() => busy(null))
        }
      >
        {photos ? 'Find the photos' : 'Find the pictures'}
      </button>
      {found && (
        <>
          <p data-testid="tb-images-found">{found.length ? `${found.length} found.` : 'None found.'}</p>
          <div class="tb-thumbs">
            {urls.map((u, i) => (
              <img key={u} src={u} alt={`Found on page ${found[i]?.page ?? ''}, number ${i + 1}`} />
            ))}
          </div>
          <RunButton
            label="Save them as a ZIP"
            disabled={!found.length}
            onClick={() =>
              attempt(async () => {
                const files: Record<string, Uint8Array> = {};
                for (const i of found) files[`page-${i.page}-${photos ? 'photo' : 'picture'}-${i.index}.png`] = i.png;
                await save(`${stem(file.name)} (${photos ? 'photos' : 'pictures'}).zip`, zipSync(files, { level: 0 }), 'application/zip');
              })
            }
          />
        </>
      )}
    </div>
  );
}

function RenamePanel({ file, busy }: Panel) {
  const [name, setName] = useState('');
  useEffect(() => {
    void attempt(async () => {
      busy('Reading page 1…');
      setName((await guessTitle(file.bytes)) || stem(file.name));
    }).finally(() => busy(null));
  }, [file]);
  return (
    <div class="tb-panel">
      <label class="tb-wide">
        File name
        <input class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} data-testid="tb-rename" />
      </label>
      <RunButton label="Save with this name" disabled={!name.trim()} onClick={() => attempt(() => save(`${name.trim()}.pdf`, file.bytes))} />
    </div>
  );
}

/* ------------------------------------------------------------- timestamp -- */

const SERVERS = ['https://freetsa.org/tsr', 'http://timestamp.digicert.com', 'http://timestamp.sectigo.com', 'http://ts.ssl.com'];

function TimestampPanel({ file, done, busy }: Panel) {
  const [url, setUrl] = useState(SERVERS[0] ?? '');
  return (
    <div class="tb-panel">
      <p class="control-help">
        A timestamp server signs a fingerprint of the PDF with the current time, proving the file existed then and has not changed since. Only the fingerprint is sent, never the PDF. This needs the
        desktop app with “Allow online checks” on.
      </p>
      <label class="tb-wide">
        Timestamp server
        <input class="input" list="tb-tsa" value={url} onInput={(e) => setUrl(e.currentTarget.value)} />
        <datalist id="tb-tsa">
          {SERVERS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <RunButton
        label="Timestamp"
        disabled={!/^https?:\/\//.test(url.trim())}
        onClick={() =>
          attempt(async () => {
            if (isSigned(file.bytes)) throw new Error('This PDF is already signed; timestamping it here would break that signature.');
            const transport = net();
            busy('Preparing…');
            const doc = await loadPdf(file.bytes);
            const { pdf, signed, contentsAt } = await prepareTimestamp(doc);
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', signed as BufferSource));
            const request = timestampRequest(digest, crypto.getRandomValues(new Uint8Array(8)));
            busy(`Asking ${new URL(url.trim()).host}…`);
            const response = await transport.http({
              url: url.trim(),
              method: 'POST',
              headers: [
                ['Content-Type', 'application/timestamp-query'],
                ['Accept', 'application/timestamp-reply'],
              ],
              bodyBase64: toBase64(request),
              timeoutMs: 30_000,
            });
            if (response.status !== 200) throw new Error(`The timestamp server answered ${response.status} ${response.reason}.`);
            const token = timestampToken(fromBase64(response.body));
            done(insertTimestamp(pdf, contentsAt, token), 'timestamped', `Timestamped by ${new URL(url.trim()).host}. Check it with PDF Signature Checker or a PDF reader.`);
          }).finally(() => busy(null))
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ tool -- */

function PdfToolbox(_: { toolId: string }) {
  const [file, take, clear, loading] = useSinglePdf();
  const [op, setOp] = useState<OpId>('bookmarks');
  const [result, setResult] = useState<Result | null>(null);
  const [busyText, setBusy] = useState<string | null>(null);
  useEffect(() => setResult(null), [file, op]);
  const meta = GROUPS.flatMap((g) => g.ops).find((o) => o.id === op);
  const panel = file
    ? {
        file,
        busy: setBusy,
        done: (bytes: Uint8Array, suffix: string, note: string) => {
          setBusy(null);
          setResult({ bytes, name: `${stem(file.name)} (${suffix}).pdf`, note });
          notify(note);
        },
      }
    : null;
  return (
    <section class="tool tb-tool" data-testid="tool" data-state={result ? 'done' : file ? 'ready' : 'idle'}>
      {file ? (
        <FileBar file={file} onReplace={() => attempt(async () => take(await pickFiles('.pdf,application/pdf')))} onClear={clear} />
      ) : (
        <FileDrop
          accept=".pdf,application/pdf"
          multiple={false}
          onFiles={take}
          title={loading ? 'Opening…' : 'Choose or drop a PDF'}
          hint="Nothing leaves this computer (except a fingerprint, for timestamps)."
          testId="tb-drop"
        />
      )}
      <div class="tb-layout">
        <nav class="tb-menu" aria-label="Operations">
          {GROUPS.map((g) => (
            <div key={g.name}>
              <h3>{g.name}</h3>
              {g.ops.map((o) => (
                <button key={o.id} type="button" class={o.id === op ? 'is-active' : ''} aria-current={o.id === op ? 'true' : undefined} onClick={() => setOp(o.id)} data-testid={`tb-op-${o.id}`}>
                  {o.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div class="tb-main">
          <h2 class="tb-title">{meta?.label}</h2>
          <p class="tone-muted tb-hint">{meta?.hint}</p>
          {!panel ? (
            <p class="tone-muted">Choose a PDF first.</p>
          ) : (
            <div key={`${file?.id}-${op}`}>
              {op === 'bookmarks' && <BookmarksPanel {...panel} />}
              {op === 'attachments' && <AttachmentsPanel {...panel} />}
              {op === 'fields' && <FieldsPanel {...panel} />}
              {op === 'overlay' && <OverlayPanel {...panel} />}
              {op === 'stamp' && <StampPanel {...panel} />}
              {op === 'colours' && <ColoursPanel {...panel} />}
              {op === 'blank-add' && <BlankAddPanel {...panel} />}
              {op === 'blank-remove' && <BlankRemovePanel {...panel} />}
              {op === 'one-page' && <OnePagePanel {...panel} />}
              {op === 'page-size' && <PageSizePanel {...panel} />}
              {op === 'auto-rotate' && <AutoRotatePanel {...panel} />}
              {op === 'annotations' && <AnnotationsPanel {...panel} />}
              {op === 'signatures' && <SignaturesPanel {...panel} />}
              {op === 'sanitise' && <SanitisePanel {...panel} />}
              {op === 'flatten' && <FlattenPanel {...panel} />}
              {op === 'unlock' && <UnlockPanel {...panel} />}
              {op === 'repair' && <RepairPanel {...panel} />}
              {op === 'report' && <ReportPanel {...panel} />}
              {op === 'javascript' && <JavaScriptPanel {...panel} />}
              {op === 'accessibility' && <AccessibilityPanel {...panel} />}
              {op === 'images' && <PicturesPanel {...panel} photos={false} />}
              {op === 'photos' && <PicturesPanel {...panel} photos />}
              {op === 'rename' && <RenamePanel {...panel} />}
              {op === 'timestamp' && <TimestampPanel {...panel} />}
            </div>
          )}
          {busyText && (
            <p class="tone-muted" role="status" data-testid="tb-busy">
              {busyText}
            </p>
          )}
          {result && (
            <div class="tb-result" data-testid="tb-result">
              <Icon name="check" size={16} />
              <span>{result.note}</span>
              <button type="button" class="button button-primary button-small" onClick={() => attempt(() => save(result.name, result.bytes))} data-testid="tb-save">
                Save {result.name}
              </button>
              <button
                type="button"
                class="button button-small"
                onClick={() => attempt(async () => take([new File([result.bytes as BlobPart], result.name, { type: 'application/pdf' })]))}
                title="Open the result here, to do more to it"
              >
                Keep working on it
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(PdfToolbox);
