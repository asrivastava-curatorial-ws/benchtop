/**
 * Picture tools that need more than one input or direct manipulation:
 * Image Stitcher (join pictures in a row, column or grid), Perspective Fix
 * (straighten a photographed page or poster from its four corners) and Paste
 * Image (save or convert whatever picture is on the clipboard).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { naturalSize, type Point, warpPerspective } from '../../lib/dither';
import { copyText, saveFile } from '../../platform';
import { context2d, createCanvas, encodeCanvas, loadImage } from '../../ui/canvas';
import { ExportBar } from '../../ui/ExportBar';
import { ImageDrop, type LoadedImage } from '../../ui/ImageDrop';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { isImageFile, MultiDrop } from './_files';
import { type SegmentChoice, Segmented, usePersistentState } from './_shared';

function CanvasShow({ canvas, label, max = 720, testId }: { canvas: HTMLCanvasElement; label: string; max?: number; testId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const k = Math.min(1, max / canvas.width, (max * 0.8) / canvas.height);
    target.width = Math.max(1, Math.round(canvas.width * k));
    target.height = Math.max(1, Math.round(canvas.height * k));
    const ctx = context2d(target);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, target.width, target.height);
  }, [canvas, max]);
  return <canvas ref={ref} class="ix-canvas" role="img" aria-label={label} data-testid={testId} />;
}

/* -------------------------------------------------------------- stitcher -- */

interface StitchPrefs {
  readonly layout: 'row' | 'column' | 'grid';
  readonly columns: number;
  readonly match: 'height' | 'width' | 'none';
  readonly gap: number;
  readonly padding: number;
  readonly background: string;
  readonly transparent: boolean;
}

const readStitch = (s: Values | undefined): StitchPrefs => ({
  layout: s?.layout === 'column' || s?.layout === 'grid' ? s.layout : 'row',
  columns: typeof s?.columns === 'number' && s.columns >= 1 && s.columns <= 12 ? s.columns : 2,
  match: s?.match === 'width' || s?.match === 'none' ? s.match : 'height',
  gap: typeof s?.gap === 'number' ? Math.max(0, Math.min(200, s.gap)) : 8,
  padding: typeof s?.padding === 'number' ? Math.max(0, Math.min(200, s.padding)) : 0,
  background: typeof s?.background === 'string' ? s.background : '#ffffff',
  transparent: s?.transparent === true,
});

interface Pic {
  readonly id: number;
  readonly name: string;
  readonly canvas: HTMLCanvasElement;
}

let picIds = 0;

export function stitch(pics: readonly HTMLCanvasElement[], p: StitchPrefs, limit = 16384): HTMLCanvasElement {
  if (!pics.length) return createCanvas(1, 1);
  const cols = p.layout === 'row' ? pics.length : p.layout === 'column' ? 1 : Math.min(p.columns, pics.length);
  const rows = Math.ceil(pics.length / cols);
  // Common height for rows, common width for columns and grids.
  const target = p.match === 'height' ? Math.min(...pics.map((c) => c.height)) : p.match === 'width' ? Math.min(...pics.map((c) => c.width)) : 0;
  const sized = pics.map((c) => {
    if (p.match === 'height') return { c, w: (c.width * target) / c.height, h: target };
    if (p.match === 'width') return { c, w: target, h: (c.height * target) / c.width };
    return { c, w: c.width, h: c.height };
  });
  const colWidths = Array.from({ length: cols }, (_, k) => Math.max(...sized.filter((_, i) => i % cols === k).map((s) => s.w)));
  const rowHeights = Array.from({ length: rows }, (_, r) => Math.max(...sized.slice(r * cols, r * cols + cols).map((s) => s.h)));
  const width = Math.round(colWidths.reduce((a, b) => a + b, 0) + (cols - 1) * p.gap + 2 * p.padding);
  const height = Math.round(rowHeights.reduce((a, b) => a + b, 0) + (rows - 1) * p.gap + 2 * p.padding);
  const k = Math.min(1, limit / width, limit / height);
  const out = createCanvas(Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k)));
  const ctx = context2d(out);
  ctx.imageSmoothingQuality = 'high';
  if (!p.transparent) {
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.scale(k, k);
  let y = p.padding;
  for (let r = 0; r < rows; r++) {
    let x = p.padding;
    for (let c = 0; c < cols; c++) {
      const s = sized[r * cols + c];
      if (s) ctx.drawImage(s.c, x + ((colWidths[c] as number) - s.w) / 2, y + ((rowHeights[r] as number) - s.h) / 2, s.w, s.h);
      x += (colWidths[c] as number) + p.gap;
    }
    y += (rowHeights[r] as number) + p.gap;
  }
  return out;
}

const LAYOUT_CHOICES: readonly SegmentChoice<StitchPrefs['layout']>[] = [
  { value: 'row', label: 'Side by side' },
  { value: 'column', label: 'One above another' },
  { value: 'grid', label: 'Grid' },
];

function Stitcher({ toolId }: { toolId: string }) {
  const [prefs, setPrefs] = usePersistentState(toolId, readStitch, (p: StitchPrefs): Values => ({ ...p }));
  const [pics, setPics] = useState<Pic[]>([]);
  const set = (patch: Partial<StitchPrefs>) => setPrefs((p) => ({ ...p, ...patch }));

  const add = (files: File[]) =>
    attempt(async () => {
      const loaded: Pic[] = [];
      for (const f of files.filter(isImageFile).slice(0, 40)) loaded.push({ id: picIds++, name: f.name, canvas: await loadImage(f) });
      if (!loaded.length) throw new Error('Choose PNG, JPEG, WebP or other pictures.');
      setPics((list) => [...list, ...loaded].slice(0, 40));
    });

  // Preview at reduced size; saving draws full size.
  const preview = useMemo(
    () =>
      pics.length
        ? stitch(
            pics.map((p) => p.canvas),
            prefs,
            1600,
          )
        : null,
    [pics, prefs],
  );
  const move = (i: number, by: number) =>
    setPics((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      if (item) next.splice(Math.max(0, Math.min(next.length, i + by)), 0, item);
      return next;
    });

  return (
    <section class="tool ix-tool" data-testid="tool" data-state={preview ? 'done' : 'idle'}>
      <div class="ix-grid">
        <div class="ix-controls">
          <MultiDrop
            onFiles={add}
            accept="image/*"
            title={pics.length ? 'Add more pictures' : 'Drop pictures here, or click to choose'}
            hint="Two or more. Nothing leaves this computer."
            compact={pics.length > 0}
            testId="stitch-drop"
            wants={isImageFile}
          />
          {pics.length > 0 && (
            <ol class="sg-list" aria-label="Pictures">
              {pics.map((p, i) => (
                <li key={p.id} class="sg-item">
                  <CanvasShow canvas={p.canvas} label="" max={44} />
                  <div class="sg-item-fields">
                    <span class="file-name">{p.name}</span>
                    <span class="control-help">
                      {p.canvas.width} × {p.canvas.height}
                    </span>
                  </div>
                  <div class="sg-item-actions">
                    <button type="button" class="icon-button" aria-label={`Move ${p.name} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <Icon name="up" size={14} />
                    </button>
                    <button type="button" class="icon-button" aria-label={`Move ${p.name} later`} disabled={i === pics.length - 1} onClick={() => move(i, 1)}>
                      <Icon name="down" size={14} />
                    </button>
                    <button type="button" class="icon-button" aria-label={`Remove ${p.name}`} onClick={() => setPics((list) => list.filter((x) => x.id !== p.id))}>
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div class="control">
            <span class="control-label">Layout</span>
            <Segmented label="Layout" value={prefs.layout} choices={LAYOUT_CHOICES} onChange={(layout) => set({ layout })} />
          </div>
          <div class="icon-row">
            {prefs.layout === 'grid' && (
              <label class="control">
                <span class="control-label">Columns</span>
                <input
                  class="input input-number"
                  type="number"
                  min={1}
                  max={12}
                  value={prefs.columns}
                  onInput={(e) => set({ columns: Math.max(1, Math.min(12, Number(e.currentTarget.value) || 1)) })}
                />
              </label>
            )}
            <label class="control">
              <span class="control-label">Make them the same</span>
              <select class="input" value={prefs.match} onChange={(e) => set({ match: e.currentTarget.value as StitchPrefs['match'] })}>
                <option value="height">Height</option>
                <option value="width">Width</option>
                <option value="none">Keep sizes</option>
              </select>
            </label>
          </div>
          <div class="icon-row">
            <label class="control">
              <span class="control-label">Gap {prefs.gap}px</span>
              <input class="range" type="range" min={0} max={120} value={prefs.gap} onInput={(e) => set({ gap: Number(e.currentTarget.value) })} />
            </label>
            <label class="control">
              <span class="control-label">Border {prefs.padding}px</span>
              <input class="range" type="range" min={0} max={120} value={prefs.padding} onInput={(e) => set({ padding: Number(e.currentTarget.value) })} />
            </label>
          </div>
          <div class="icon-row">
            <label class="control">
              <span class="control-label">Background</span>
              <input class="color-swatch" type="color" value={prefs.background} disabled={prefs.transparent} onInput={(e) => set({ background: e.currentTarget.value })} />
            </label>
            <label class="toggle">
              <input type="checkbox" checked={prefs.transparent} onChange={(e) => set({ transparent: e.currentTarget.checked })} />
              <span class="toggle-track" aria-hidden="true" />
              Transparent
            </label>
          </div>
          {preview && (
            <ExportBar
              render={() =>
                stitch(
                  pics.map((p) => p.canvas),
                  prefs,
                )
              }
              revision={`${JSON.stringify(prefs)}|${pics.map((p) => p.id).join(',')}`}
              pixels={preview.width * preview.height * 4}
              baseName="stitched.png"
              label="Save picture"
              from={toolId}
            />
          )}
        </div>
        <div class="ix-work" data-testid="stitch-result">
          {preview ? <CanvasShow canvas={preview} label={`Joined picture, ${pics.length} parts`} /> : <p class="np-empty">Add pictures to join them side by side, one above another, or in a grid.</p>}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ perspective -- */

const ASPECTS: Record<string, { label: string; ratio: number | null }> = {
  auto: { label: 'From the corners', ratio: null },
  a4: { label: 'A4 portrait', ratio: 210 / 297 },
  a4l: { label: 'A4 landscape', ratio: 297 / 210 },
  letter: { label: 'Letter portrait', ratio: 8.5 / 11 },
  square: { label: 'Square', ratio: 1 },
  card: { label: 'Business card', ratio: 85 / 55 },
  board: { label: '16 : 9 screen or board', ratio: 16 / 9 },
};

function Perspective({ toolId }: { toolId: string }) {
  const [prefs, setPrefs] = usePersistentState(
    toolId,
    (s: Values | undefined) => ({ aspect: typeof s?.aspect === 'string' && s.aspect in ASPECTS ? s.aspect : 'auto', enhance: s?.enhance === true }),
    (p: { aspect: string; enhance: boolean }): Values => ({ ...p }),
  );
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [corners, setCorners] = useState<Point[]>([]);
  const drag = useRef<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!image) return setCorners([]);
    const { width: w, height: h } = image.canvas;
    const m = Math.min(w, h) * 0.08;
    setCorners([
      { x: m, y: m },
      { x: w - m, y: m },
      { x: w - m, y: h - m },
      { x: m, y: h - m },
    ]);
  }, [image]);

  const size = useMemo(() => {
    if (corners.length !== 4) return null;
    const natural = naturalSize(corners);
    const ratio = ASPECTS[prefs.aspect]?.ratio;
    if (!ratio) return natural;
    // Keep about the same number of pixels, in the chosen shape.
    const area = natural.width * natural.height;
    const height = Math.round(Math.sqrt(area / ratio));
    return { width: Math.round(height * ratio), height };
  }, [corners, prefs.aspect]);

  const render = (limit: number) => {
    if (!image || !size || corners.length !== 4) throw new Error('Choose a picture first.');
    const k = Math.min(1, limit / Math.max(size.width, size.height));
    const w = Math.max(1, Math.round(size.width * k));
    const h = Math.max(1, Math.round(size.height * k));
    const src = context2d(image.canvas, true).getImageData(0, 0, image.canvas.width, image.canvas.height);
    const out = warpPerspective(src.data, src.width, src.height, corners, w, h);
    if (prefs.enhance) {
      // Whiten the paper: stretch each channel between its dark and light ends.
      for (let i = 0; i < out.length; i += 4) for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.max(0, ((out[i + c] as number) - 30) * (255 / 200)));
    }
    const canvas = createCanvas(w, h);
    context2d(canvas).putImageData(new ImageData(out, w, h), 0, 0);
    return canvas;
  };
  const preview = useMemo(() => {
    try {
      return image && size ? render(700) : null;
    } catch {
      return null;
    }
  }, [image, corners, size, prefs.enhance]);

  const point = (e: PointerEvent) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || !image) return null;
    return { x: ((e.clientX - box.left) / box.width) * image.canvas.width, y: ((e.clientY - box.top) / box.height) * image.canvas.height };
  };
  const onMove = (e: PointerEvent) => {
    if (drag.current === null || !image) return;
    const p = point(e);
    if (!p) return;
    const clamped = { x: Math.max(0, Math.min(image.canvas.width, p.x)), y: Math.max(0, Math.min(image.canvas.height, p.y)) };
    setCorners((list) => list.map((c, i) => (i === drag.current ? clamped : c)));
  };
  const nudge = (i: number, e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d || !image) return;
    e.preventDefault();
    setCorners((list) =>
      list.map((c, k) => (k === i ? { x: Math.max(0, Math.min(image.canvas.width, c.x + (d[0] as number))), y: Math.max(0, Math.min(image.canvas.height, c.y + (d[1] as number))) } : c)),
    );
  };
  const names = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];

  return (
    <section class="tool ix-tool" data-testid="tool" data-state={preview ? 'done' : 'idle'}>
      <div class="ix-grid">
        <div class="ix-controls">
          <ImageDrop image={image} onImage={setImage} hint="A photo of a page, poster, whiteboard or screen taken at an angle. Nothing leaves this computer." />
          <label class="control">
            <span class="control-label">Shape of the result</span>
            <select class="input" value={prefs.aspect} onChange={(e) => setPrefs((p) => ({ ...p, aspect: e.currentTarget.value }))}>
              {Object.entries(ASPECTS).map(([value, a]) => (
                <option key={value} value={value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label class="toggle">
            <input type="checkbox" checked={prefs.enhance} onChange={(e) => setPrefs((p) => ({ ...p, enhance: e.currentTarget.checked }))} />
            <span class="toggle-track" aria-hidden="true" />
            Brighten paper (for documents)
          </label>
          <p class="control-help">Drag the four corners onto the corners of the page; arrow keys move a selected corner (Shift for 10 px).</p>
          {preview && size && (
            <ExportBar
              render={() => render(16384)}
              revision={`${JSON.stringify(corners)}|${prefs.aspect}|${prefs.enhance}`}
              pixels={size.width * size.height}
              baseName={`${image?.name.replace(/\.[^.]+$/, '') ?? 'page'}-straight.png`}
              label="Save straightened picture"
              from={toolId}
            />
          )}
        </div>
        <div class="ix-work">
          {image && corners.length === 4 && (
            <div
              ref={stage}
              class="px-stage"
              style={{ aspectRatio: `${image.canvas.width} / ${image.canvas.height}` }}
              onPointerMove={onMove}
              onPointerUp={() => {
                drag.current = null;
              }}
            >
              <CanvasShow canvas={image.canvas} label="Photo" max={1400} />
              <svg class="px-overlay" viewBox={`0 0 ${image.canvas.width} ${image.canvas.height}`} preserveAspectRatio="none" aria-hidden="true">
                <polygon points={corners.map((c) => `${c.x},${c.y}`).join(' ')} />
              </svg>
              {corners.map((c, i) => (
                <button
                  key={names[i]}
                  type="button"
                  class="px-handle"
                  style={{ left: `${(c.x / image.canvas.width) * 100}%`, top: `${(c.y / image.canvas.height) * 100}%` }}
                  aria-label={`${names[i]} corner`}
                  onPointerDown={(e) => {
                    drag.current = i;
                    (e.currentTarget.parentElement as HTMLElement).setPointerCapture?.(e.pointerId);
                  }}
                  onKeyDown={(e) => nudge(i, e)}
                  data-testid={`px-corner-${i}`}
                />
              ))}
            </div>
          )}
          {preview && (
            <figure class="ix-result" data-testid="px-result">
              <CanvasShow canvas={preview} label="Straightened" />
              <figcaption>
                {size?.width} × {size?.height} px
              </figcaption>
            </figure>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ paste image -- */

function PasteImage({ toolId }: { toolId: string }) {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [busy, setBusy] = useState(false);

  const readClipboard = () =>
    attempt(async () => {
      setBusy(true);
      try {
        if (!navigator.clipboard?.read) throw new Error('This window cannot read the clipboard directly. Press Ctrl+V (⌘V on a Mac) instead.');
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            setImage({ canvas: await loadImage(blob), name: `pasted.${type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'}`, type, size: blob.size, file: blob });
            return;
          }
        }
        throw new Error('There is no picture on the clipboard. Copy one, or take a screenshot to the clipboard, then try again.');
      } finally {
        setBusy(false);
      }
    });

  const dataUrl = async () => {
    if (!image) return '';
    const blob = await encodeCanvas(image.canvas, { format: 'png', quality: 100 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(binary)}`;
  };

  return (
    <section class="tool ix-tool" data-testid="tool" data-state={image ? 'done' : 'idle'}>
      <div class="ix-grid">
        <div class="ix-controls">
          <button type="button" class="button button-primary" onClick={readClipboard} disabled={busy} data-testid="paste-read">
            <Icon name="paste" size={16} /> Paste from the clipboard
          </button>
          <p class="control-help">Or press Ctrl+V anywhere on this page, or drop a picture below.</p>
          <ImageDrop image={image} onImage={setImage} />
          {image && (
            <>
              <dl class="ix-facts" data-testid="paste-facts">
                <div>
                  <dt>Size</dt>
                  <dd>
                    {image.canvas.width} × {image.canvas.height} px
                  </dd>
                </div>
                <div>
                  <dt>Format on the clipboard</dt>
                  <dd>{image.type || 'unknown'}</dd>
                </div>
                <div>
                  <dt>Bytes</dt>
                  <dd>{formatBytes(image.size)}</dd>
                </div>
              </dl>
              <ExportBar render={() => image.canvas} revision={image} pixels={image.canvas.width * image.canvas.height} baseName={image.name} originalSize={image.size} from={toolId} />
              <div class="button-row">
                <button
                  type="button"
                  class="button button-small"
                  onClick={() =>
                    attempt(async () => {
                      await copyText(await dataUrl());
                      notify('Copied the data URL');
                    })
                  }
                >
                  <Icon name="copy" size={14} /> Copy as data URL
                </button>
                <button
                  type="button"
                  class="button button-small"
                  onClick={() =>
                    attempt(async () => {
                      const url = await dataUrl();
                      const saved = await saveFile('pasted-image.txt', url.replace(/^data:image\/png;base64,/, ''), 'text/plain');
                      if (saved.saved) notify(`Saved to ${saved.location}`);
                    })
                  }
                >
                  <Icon name="save" size={14} /> Save Base64 text
                </button>
              </div>
            </>
          )}
        </div>
        <div class="ix-work">
          {image ? (
            <CanvasShow canvas={image.canvas} label="Pasted picture" testId="paste-preview" />
          ) : (
            <p class="np-empty">Copy a picture or take a screenshot (Print Screen, or Shift+Windows+S on Windows), then paste it here to save it as a file.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ImageExtras({ toolId }: { toolId: string }) {
  if (toolId === 'perspective-fix') return <Perspective toolId={toolId} />;
  if (toolId === 'paste-image') return <PasteImage toolId={toolId} />;
  return <Stitcher toolId={toolId} />;
}

export default defineCustomTool(ImageExtras);
