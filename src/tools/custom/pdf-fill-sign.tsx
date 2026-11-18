/**
 * PDF Form Filler and PDF Signer.  Filling: the fields of interactive forms, plus
 * text, ticks and dates placed anywhere on flat forms.  Signing: a drawn, typed
 * or scanned signature placed on the page, optionally with a digital signature
 * from a .p12 / .pfx certificate (or one made here).  Hindi and ₹ work in both.
 */

import { PDFDocument } from 'pdf-lib';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { formatBytes } from '../../lib/bytes';
import { errorMessage } from '../../lib/errors';
import { ENCRYPTED_MESSAGE } from '../../lib/pdf-edit';
import { dropXfa, type FormInfo, fillPdf, type Placed, readForm } from '../../lib/pdf-forms';
import { openPdf, renderPage } from '../../lib/pdf-render';
import { type CertificateSummary, createSelfSigned, isSigned, type Placement, readP12, type Signer, signPdf } from '../../lib/pdf-sign';
import { pickFile, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

interface OpenPdf {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly pages: number;
  readonly form: FormInfo;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'document';

async function readFile(file: File): Promise<OpenPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new Error(`${file.name} could not be read as a PDF: ${errorMessage(error)}`);
  }
  if (doc.isEncrypted) throw new Error(`${file.name}: ${ENCRYPTED_MESSAGE}`);
  return { name: file.name, bytes, pages: doc.getPageCount(), form: readForm(doc) };
}

function OpenBar({ file, onOpen, testId }: { file: OpenPdf | null; onOpen: (file: OpenPdf) => void; testId: string }) {
  const [dragging, setDragging] = useState(false);
  const open = (picked: File | null | undefined) => {
    if (picked) attempt(async () => onOpen(await readFile(picked)));
  };
  useIncomingFiles(
    (files) => open(files[0]),
    (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
  );
  return (
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
          open(e.dataTransfer.files[0]);
        }
      }}
    >
      <button type="button" class="button" data-testid={testId} onClick={() => attempt(async () => open(await pickFile('.pdf,application/pdf')))}>
        {file ? 'Open another PDF' : 'Open a PDF'}
      </button>
      <span class="dropzone-hint">{file ? `${file.name}, ${file.pages} page${file.pages === 1 ? '' : 's'}, ${formatBytes(file.bytes.length)}` : 'or drop it here'}</span>
    </div>
  );
}

interface View {
  readonly width: number;
  readonly height: number;
  readonly url: string;
}

/** One page as a picture, with an SVG layer in PDF points (origin bottom-left) for marks and clicks. */
function PageView({
  bytes,
  page,
  children,
  onPoint,
  onDrag,
  label,
}: {
  bytes: Uint8Array;
  page: number;
  children?: preact.ComponentChildren;
  onPoint?: (x: number, y: number) => void;
  onDrag?: (from: [number, number], to: [number, number], done: boolean) => void;
  label: string;
}) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const start = useRef<[number, number] | null>(null);
  useEffect(() => {
    let alive = true;
    setView(null);
    (async () => {
      const { doc, close } = await openPdf(bytes);
      try {
        const scale = 2;
        const canvas = await renderPage(doc, page, scale);
        if (alive) setView({ width: canvas.width / scale, height: canvas.height / scale, url: canvas.toDataURL('image/png') });
      } finally {
        await close();
      }
    })().catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [bytes, page]);
  const point = (event: PointerEvent): [number, number] => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || !view) return [0, 0];
    return [((event.clientX - box.left) / box.width) * view.width, view.height - ((event.clientY - box.top) / box.height) * view.height];
  };
  if (error) return <p class="recipe-error">{error}</p>;
  if (!view)
    return (
      <p class="tool-loading">
        <span class="spinner" aria-hidden="true" /> Drawing page {page}…
      </p>
    );
  return (
    <div class="pdf-page-view" data-testid="pdf-page-view">
      <img src={view.url} alt={`Page ${page}`} draggable={false} />
      <svg
        ref={svg}
        viewBox={`0 0 ${view.width} ${view.height}`}
        role="application"
        aria-label={label}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const p = point(e);
          start.current = p;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          onDrag?.(p, p, false);
        }}
        onPointerMove={(e) => {
          if (start.current) onDrag?.(start.current, point(e), false);
        }}
        onPointerUp={(e) => {
          const from = start.current;
          start.current = null;
          if (!from) return;
          const to = point(e);
          if (onDrag) onDrag(from, to, true);
          if (onPoint && Math.hypot(to[0] - from[0], to[1] - from[1]) < 4) onPoint(to[0], to[1]);
        }}
      >
        <g transform={`translate(0 ${view.height}) scale(1 -1)`}>{children}</g>
      </svg>
    </div>
  );
}

function PageStepper({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages < 2) return null;
  return (
    <div class="button-row pdf-pager">
      <button type="button" class="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <Icon name="left" size={16} />
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button type="button" class="icon-button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <Icon name="right" size={16} />
      </button>
    </div>
  );
}

/** Text drawn in the SVG layer (which is flipped so y grows upwards like PDF space). */
const MarkText = ({ x, y, size, colour, text }: { x: number; y: number; size: number; colour: string; text: string }) => (
  <g transform={`translate(${x} ${y}) scale(1 -1)`}>
    {text.split('\n').map((line, i) => (
      <text key={i} x={0} y={i * size * 1.2} font-size={size} fill={colour} class="pdf-mark-text">
        {line || ' '}
      </text>
    ))}
  </g>
);

/* ------------------------------------------------------------ form filler -- */

interface FillSettings {
  readonly size: number;
  readonly colour: string;
  readonly flatten: boolean;
}

const readFill = (s: Values | undefined): FillSettings => ({
  size: typeof s?.size === 'number' ? s.size : 11,
  colour: typeof s?.colour === 'string' ? s.colour : '#000000',
  flatten: s?.flatten === true,
});

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

function FormFiller({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<FillSettings>(toolId, readFill, (s) => ({ ...s }));
  const [file, setFile] = useState<OpenPdf | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean | readonly string[]>>({});
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [page, setPage] = useState(1);
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const open = (opened: OpenPdf) => {
    setFile(opened);
    setPage(1);
    setPlaced([]);
    setValues(Object.fromEntries(opened.form.fields.map((f) => [f.name, f.value])));
  };
  const fields = file?.form.fields.filter((f) => f.kind !== 'signature' && f.kind !== 'button') ?? [];
  const save = () =>
    attempt(async () => {
      if (!file) return;
      setBusy(true);
      try {
        const bytes = await fillPdf(file.bytes, { values, placed, flatten: settings.flatten });
        const saved = await saveFile(`${stem(file.name)} (filled).pdf`, bytes, 'application/pdf');
        if (saved.saved) notify(`Saved to ${saved.location}`);
      } finally {
        setBusy(false);
      }
    });
  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        <OpenBar file={file} onOpen={open} testId="form-open" />
        {file?.form.xfa && (
          <div class="notice" role="note">
            <p>This is a dynamic (XFA) form. Most readers other than Adobe’s show its standard fields instead; switch to those to fill it here.</p>
            <button type="button" class="button button-small" onClick={() => attempt(async () => open(await readFile(new File([(await dropXfa(file.bytes)) as Uint8Array<ArrayBuffer>], file.name))))}>
              Use the standard fields
            </button>
          </div>
        )}
        {file && fields.length > 0 && (
          <fieldset class="form-fields" data-testid="form-fields">
            <legend>Form fields ({fields.length})</legend>
            {fields.map((field) => {
              const id = `field-${field.name.replace(/[^a-z0-9]/gi, '-')}`;
              const label = `${field.name}${field.required ? ' (required)' : ''}${field.page ? `, page ${field.page}` : ''}`;
              const value = values[field.name];
              if (field.kind === 'checkbox')
                return (
                  <label key={field.name} class="check" for={id}>
                    <input id={id} type="checkbox" disabled={field.readOnly} checked={value === true} onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.currentTarget.checked }))} />
                    {label}
                  </label>
                );
              if (field.kind === 'radio' || field.kind === 'dropdown' || field.kind === 'list')
                return (
                  <div key={field.name} class="control">
                    <label class="control-label" for={id}>
                      {label}
                    </label>
                    <select
                      id={id}
                      class="input"
                      disabled={field.readOnly}
                      value={Array.isArray(value) ? (value[0] ?? '') : String(value ?? '')}
                      onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.currentTarget.value }))}
                    >
                      <option value="">(none)</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              return (
                <div key={field.name} class="control">
                  <label class="control-label" for={id}>
                    {label}
                  </label>
                  {field.multiline ? (
                    <textarea id={id} class="input" rows={3} readOnly={field.readOnly} value={String(value ?? '')} onInput={(e) => setValues((v) => ({ ...v, [field.name]: e.currentTarget.value }))} />
                  ) : (
                    <input
                      id={id}
                      class="input"
                      maxLength={field.maxLength}
                      readOnly={field.readOnly}
                      value={String(value ?? '')}
                      onInput={(e) => setValues((v) => ({ ...v, [field.name]: e.currentTarget.value }))}
                    />
                  )}
                </div>
              );
            })}
          </fieldset>
        )}
        {file && (
          <fieldset class="form-fields">
            <legend>Text on the page</legend>
            <p class="tone-muted">{fields.length ? 'For boxes that are not form fields: ' : 'This PDF has no form fields. '}click the page where the text should start.</p>
            <div class="control">
              <label class="control-label" for="place-next">
                Text for the next click
              </label>
              <input id="place-next" class="input" placeholder="Type, or use a button below" value={next} onInput={(e) => setNext(e.currentTarget.value)} />
              <div class="button-row">
                <button type="button" class="button button-small" onClick={() => setNext('✓')}>
                  Tick ✓
                </button>
                <button type="button" class="button button-small" onClick={() => setNext('✗')}>
                  Cross ✗
                </button>
                <button type="button" class="button button-small" onClick={() => setNext(today())}>
                  Today’s date
                </button>
              </div>
            </div>
            <div class="control-row">
              <div class="control">
                <label class="control-label" for="place-size">
                  Size
                </label>
                <input id="place-size" class="input" type="number" min={5} max={72} value={settings.size} onInput={(e) => setSettings((s) => ({ ...s, size: Number(e.currentTarget.value) || 11 }))} />
              </div>
              <div class="control">
                <label class="control-label" for="place-colour">
                  Colour
                </label>
                <input id="place-colour" type="color" value={settings.colour} onInput={(e) => setSettings((s) => ({ ...s, colour: e.currentTarget.value }))} />
              </div>
            </div>
            {placed.length > 0 && (
              <ul class="placed-list" data-testid="placed-list">
                {placed.map((item, i) => (
                  <li key={i}>
                    <span class="tone-muted">p. {item.page}</span>
                    <textarea
                      class="input"
                      rows={1}
                      aria-label={`Text ${i + 1}`}
                      value={item.text}
                      onInput={(e) => {
                        const text = e.currentTarget.value;
                        setPlaced((list) => list.map((p, j) => (j === i ? { ...p, text } : p)));
                      }}
                    />
                    <button type="button" class="icon-button" aria-label={`Remove text ${i + 1}`} onClick={() => setPlaced((list) => list.filter((_, j) => j !== i))}>
                      <Icon name="close" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}
        {file && (
          <>
            <label class="toggle" for="fill-flatten">
              <input
                id="fill-flatten"
                type="checkbox"
                role="switch"
                aria-checked={settings.flatten}
                checked={settings.flatten}
                onChange={(e) => setSettings((s) => ({ ...s, flatten: e.currentTarget.checked }))}
              />
              <span class="toggle-track" aria-hidden="true" />
              <span class="toggle-text">Lock the answers (flatten the form)</span>
            </label>
            <button type="button" class="button button-primary" disabled={busy} onClick={save} data-testid="form-save">
              Save the filled PDF
            </button>
          </>
        )}
        {!file && <p class="tone-muted">Fill in forms (including Hindi answers and ₹ amounts) and write on scanned or printed-style forms. Nothing is uploaded.</p>}
      </div>
      <div class="ai-work">
        {file && (
          <>
            <PageStepper page={page} pages={file.pages} onPage={setPage} />
            <PageView
              bytes={file.bytes}
              page={page}
              label="Page: click to place text"
              onPoint={(x, y) => setPlaced((list) => [...list, { page, x, y, text: next || 'Text', size: settings.size, colour: settings.colour }])}
            >
              {placed
                .filter((item) => item.page === page)
                .map((item, i) => (
                  <MarkText key={i} x={item.x} y={item.y} size={item.size} colour={item.colour} text={item.text} />
                ))}
            </PageView>
          </>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- signer -- */

type Source = 'draw' | 'type' | 'picture';

interface SignSettings {
  readonly source: Source;
  readonly ink: string;
  readonly typed: string;
  readonly reason: string;
  readonly location: string;
  readonly details: boolean;
}

const readSign = (s: Values | undefined): SignSettings => ({
  source: (['draw', 'type', 'picture'] as const).find((v) => v === s?.source) ?? 'draw',
  ink: typeof s?.ink === 'string' ? s.ink : '#1a3a8f',
  typed: typeof s?.typed === 'string' ? s.typed : '',
  reason: typeof s?.reason === 'string' ? s.reason : '',
  location: typeof s?.location === 'string' ? s.location : '',
  details: s?.details !== false,
});

/** Crops a canvas to its inked pixels and returns a transparent PNG (or null when blank). */
async function cropToInk(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if ((data[(y * width + x) * 4 + 3] as number) > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const pad = 6;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1 + pad * 2;
  out.height = y1 - y0 + 1 + pad * 2;
  out.getContext('2d')?.drawImage(canvas, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

function SignaturePad({ ink, onChange }: { ink: string; onChange: (png: Uint8Array | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);
  const at = (e: PointerEvent): [number, number] => {
    const c = canvas.current as HTMLCanvasElement;
    const box = c.getBoundingClientRect();
    return [((e.clientX - box.left) / box.width) * c.width, ((e.clientY - box.top) / box.height) * c.height];
  };
  const finish = () => {
    last.current = null;
    if (canvas.current) void cropToInk(canvas.current).then(onChange);
  };
  return (
    <div class="sign-pad">
      <canvas
        ref={canvas}
        width={720}
        height={240}
        aria-label="Signature pad: draw with the mouse, a pen or a finger"
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          last.current = at(e);
        }}
        onPointerMove={(e) => {
          const ctx = canvas.current?.getContext('2d');
          if (!last.current || !ctx) return;
          const p = at(e);
          ctx.strokeStyle = ink;
          ctx.lineWidth = 2 + (e.pressure > 0 && e.pointerType === 'pen' ? e.pressure * 3 : 1.5);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(...last.current);
          ctx.lineTo(...p);
          ctx.stroke();
          last.current = p;
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <button
        type="button"
        class="button button-small"
        onClick={() => {
          const c = canvas.current;
          c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
          onChange(null);
        }}
      >
        Clear
      </button>
    </div>
  );
}

async function typedSignature(name: string, ink: string): Promise<Uint8Array | null> {
  if (!name.trim()) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 260;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = ink;
  ctx.font = 'italic 110px "Segoe Script", "Brush Script MT", "Lucida Handwriting", "Z003", cursive';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.trim(), 20, 130, 1160);
  return cropToInk(canvas);
}

/** A scanned signature: white turned transparent so it sits on the page like ink. */
async function pictureSignature(file: File): Promise<Uint8Array | null> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1600 / bitmap.width);
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const light = ((d[i] as number) + (d[i + 1] as number) + (d[i + 2] as number)) / 3;
    if (light > 200) d[i + 3] = Math.round(Math.max(0, (255 - light) * 4.5));
  }
  ctx.putImageData(image, 0, 0);
  return cropToInk(canvas);
}

const pngUrl = (png: Uint8Array) => URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));

function CertificatePanel({ signer, onSigner }: { signer: Signer | null; onSigner: (signer: Signer | null) => void }) {
  const [p12, setP12] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState('');
  const [making, setMaking] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', organisation: '', country: 'IN', years: 3, password: '' });
  const summary: CertificateSummary | undefined = signer?.summary;
  return (
    <div class="cert-panel" data-testid="cert-panel">
      {summary ? (
        <div class="cert-summary" data-testid="cert-summary">
          <p>
            <strong>{summary.commonName}</strong>
            {summary.selfSigned ? ' (self-signed)' : ''}
          </p>
          <p class="tone-muted">
            Issued by {summary.issuer || 'unknown'}; valid {summary.validFrom.toLocaleDateString()} to {summary.validTo.toLocaleDateString()}; RSA {summary.keyBits}-bit.
          </p>
          <button type="button" class="button button-small" onClick={() => onSigner(null)}>
            Use another certificate
          </button>
        </div>
      ) : making ? (
        <div class="cert-make">
          {(
            [
              ['name', 'Name to show as the signer'],
              ['email', 'Email (optional)'],
              ['organisation', 'Organisation (optional)'],
              ['country', 'Country code'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} class="control">
              <label class="control-label" for={`cert-${key}`}>
                {label}
              </label>
              <input id={`cert-${key}`} class="input" value={draft[key]} onInput={(e) => setDraft((d) => ({ ...d, [key]: e.currentTarget.value }))} />
            </div>
          ))}
          <div class="control-row">
            <div class="control">
              <label class="control-label" for="cert-years">
                Valid for (years)
              </label>
              <input id="cert-years" class="input" type="number" min={1} max={30} value={draft.years} onInput={(e) => setDraft((d) => ({ ...d, years: Number(e.currentTarget.value) || 3 }))} />
            </div>
            <div class="control">
              <label class="control-label" for="cert-password">
                Password for the file
              </label>
              <input
                id="cert-password"
                class="input"
                type="password"
                autoComplete="new-password"
                value={draft.password}
                onInput={(e) => setDraft((d) => ({ ...d, password: e.currentTarget.value }))}
              />
            </div>
          </div>
          <div class="button-row">
            <button
              type="button"
              class="button button-primary"
              data-testid="cert-create"
              onClick={() =>
                attempt(async () => {
                  const made = await createSelfSigned(draft);
                  onSigner(made.signer);
                  setMaking(false);
                  const saved = await saveFile(`${draft.name.trim() || 'signature'}.p12`, made.p12, 'application/x-pkcs12');
                  notify(saved.saved ? `Certificate saved to ${saved.location}. Keep it and its password safe.` : 'The certificate was made but not saved; it works until you close this tool.');
                })
              }
            >
              Make the certificate
            </button>
            <button type="button" class="button button-quiet" onClick={() => setMaking(false)}>
              Cancel
            </button>
          </div>
          <p class="tone-muted">
            A self-signed certificate proves the file was not changed after signing, but readers cannot tell who made it. For documents to outside parties, use a certificate from a certifying
            authority.
          </p>
        </div>
      ) : (
        <div class="cert-open">
          <div class="button-row">
            <button
              type="button"
              class="button"
              onClick={() =>
                attempt(async () => {
                  const file = await pickFile('.p12,.pfx,application/x-pkcs12');
                  if (file) setP12({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
                })
              }
            >
              {p12 ? p12.name : 'Choose a .p12 or .pfx file'}
            </button>
            <button type="button" class="button button-quiet" onClick={() => setMaking(true)}>
              Make a certificate
            </button>
          </div>
          {p12 && (
            <form
              class="control-row"
              onSubmit={(e) => {
                e.preventDefault();
                attempt(async () => onSigner(readP12(p12.bytes, password)));
              }}
            >
              <div class="control">
                <label class="control-label" for="p12-password">
                  Certificate password
                </label>
                <input id="p12-password" class="input" type="password" autoComplete="current-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
              </div>
              <button type="submit" class="button">
                Open
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function PdfSigner({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<SignSettings>(toolId, readSign, (s) => ({ ...s }));
  const [file, setFile] = useState<OpenPdf | null>(null);
  const [page, setPage] = useState(1);
  const [picture, setPicture] = useState<Uint8Array | null>(null);
  const [box, setBox] = useState<Placement | null>(null);
  const [digital, setDigital] = useState(false);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [busy, setBusy] = useState(false);
  const url = useMemo(() => (picture ? pngUrl(picture) : ''), [picture]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    if (settings.source === 'type') void typedSignature(settings.typed, settings.ink).then(setPicture);
  }, [settings.source, settings.typed, settings.ink]);
  const open = (opened: OpenPdf) => {
    setFile(opened);
    setPage(opened.pages);
    setBox(null);
  };
  const placement: Placement | null = box ?? (file ? { page, x: 360, y: 60, width: 190, height: 64 } : null);
  const signed = file ? isSigned(file.bytes) : false;
  const save = () =>
    attempt(async () => {
      if (!file || !placement) return;
      if (digital && !signer) throw new Error('Open or make a certificate first, or turn off the digital signature.');
      setBusy(true);
      try {
        const bytes = await signPdf(file.bytes, {
          picture: picture ?? undefined,
          placement: picture || digital ? { ...placement, page } : undefined,
          signer: digital ? (signer ?? undefined) : undefined,
          reason: settings.reason || undefined,
          location: settings.location || undefined,
          details: settings.details,
        });
        const saved = await saveFile(`${stem(file.name)} (signed).pdf`, bytes, 'application/pdf');
        if (saved.saved) notify(`Saved to ${saved.location}`);
      } finally {
        setBusy(false);
      }
    });
  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        <OpenBar file={file} onOpen={open} testId="sign-open" />
        {signed && <p class="notice">This PDF already carries a digital signature. A picture can still be added, but adding another digital signature here would break the first one.</p>}
        <div class="control">
          <span class="control-label">Signature</span>
          <Segmented
            label="Signature"
            small={false}
            value={settings.source}
            onChange={(source) => {
              setPicture(null);
              setSettings((s) => ({ ...s, source }));
            }}
            choices={[
              { value: 'draw', label: 'Draw' },
              { value: 'type', label: 'Type' },
              { value: 'picture', label: 'Picture' },
            ]}
          />
        </div>
        {settings.source === 'draw' && <SignaturePad ink={settings.ink} onChange={setPicture} />}
        {settings.source === 'type' && (
          <div class="control">
            <label class="control-label" for="sign-typed">
              Your name
            </label>
            <input id="sign-typed" class="input" value={settings.typed} onInput={(e) => setSettings((s) => ({ ...s, typed: e.currentTarget.value }))} />
          </div>
        )}
        {settings.source === 'picture' && (
          <button type="button" class="button" onClick={() => attempt(async () => setPicture(await pictureSignature((await pickFile('image/*')) ?? new File([], 'none'))))}>
            Choose a scanned signature
          </button>
        )}
        <div class="control-row">
          <div class="control">
            <label class="control-label" for="sign-ink">
              Ink
            </label>
            <input id="sign-ink" type="color" value={settings.ink} onInput={(e) => setSettings((s) => ({ ...s, ink: e.currentTarget.value }))} />
          </div>
          {url && <img class="sign-preview" src={url} alt="Your signature" />}
        </div>
        <label class="toggle" for="sign-digital">
          <input id="sign-digital" type="checkbox" role="switch" aria-checked={digital} checked={digital} onChange={(e) => setDigital(e.currentTarget.checked)} />
          <span class="toggle-track" aria-hidden="true" />
          <span class="toggle-text">Also sign digitally with a certificate</span>
        </label>
        {digital && (
          <>
            <CertificatePanel signer={signer} onSigner={setSigner} />
            <div class="control">
              <label class="control-label" for="sign-reason">
                Reason (optional)
              </label>
              <input id="sign-reason" class="input" placeholder="Approved" value={settings.reason} onInput={(e) => setSettings((s) => ({ ...s, reason: e.currentTarget.value }))} />
            </div>
            <div class="control">
              <label class="control-label" for="sign-location">
                Place (optional)
              </label>
              <input id="sign-location" class="input" placeholder="Bengaluru" value={settings.location} onInput={(e) => setSettings((s) => ({ ...s, location: e.currentTarget.value }))} />
            </div>
            <label class="check" for="sign-details">
              <input id="sign-details" type="checkbox" checked={settings.details} onChange={(e) => setSettings((s) => ({ ...s, details: e.currentTarget.checked }))} />
              Print the signer’s name and the date beside the signature
            </label>
          </>
        )}
        <button type="button" class="button button-primary" disabled={!file || busy || (!picture && !digital)} onClick={save} data-testid="sign-save">
          {digital ? 'Sign and save' : 'Add the signature and save'}
        </button>
        <p class="tone-muted">Drag on the page to place the signature box. The digital signature uses SHA-256 and works in Adobe Acrobat and other readers.</p>
      </div>
      <div class="ai-work">
        {file && placement && (
          <>
            <PageStepper
              page={page}
              pages={file.pages}
              onPage={(p) => {
                setPage(p);
                setBox(null);
              }}
            />
            <PageView
              bytes={file.bytes}
              page={page}
              label="Page: drag to place the signature"
              onDrag={(from, to, done) => {
                const width = Math.abs(to[0] - from[0]);
                const height = Math.abs(to[1] - from[1]);
                if (done && width < 8 && height < 8) {
                  setBox({ page, x: from[0] - 95, y: from[1] - 32, width: 190, height: 64 });
                  return;
                }
                if (width >= 8 || height >= 8) setBox({ page, x: Math.min(from[0], to[0]), y: Math.min(from[1], to[1]), width: Math.max(width, 20), height: Math.max(height, 12) });
              }}
            >
              <rect class="sign-box" x={placement.x} y={placement.y} width={placement.width} height={placement.height} />
              {url && (
                <g transform={`translate(${placement.x} ${placement.y + placement.height}) scale(1 -1)`}>
                  <image href={url} x={0} y={0} width={digital && settings.details ? placement.width * 0.45 : placement.width} height={placement.height} preserveAspectRatio="xMidYMid meet" />
                </g>
              )}
            </PageView>
          </>
        )}
      </div>
    </div>
  );
}

function FillSign({ toolId }: { toolId: string }) {
  return toolId === 'pdf-sign' ? <PdfSigner toolId={toolId} /> : <FormFiller toolId={toolId} />;
}

export default defineCustomTool(FillSign);
