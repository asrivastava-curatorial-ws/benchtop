/**
 * Nine-patch Maker: mark the stretching and content areas of a picture and
 * save an Android .9.png for every density, or CSS border-image settings.
 */
import { zipSync } from 'fflate';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ANDROID_DENSITIES, resourceName } from '../../lib/app-icon-sizes';
import { borderImageCss, cleanRanges, contentBox, layoutAxis, type Patches, type Range, readNinePatch, scalePatches, segments, writeNinePatch } from '../../lib/nine-patch';
import { saveFile } from '../../platform';
import { CodeOutput } from '../../ui/CodeOutput';
import { context2d, createCanvas } from '../../ui/canvas';
import { ImageDrop, type LoadedImage } from '../../ui/ImageDrop';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { pngBytes } from './_draw';
import { usePersistentState } from './_shared';

interface Settings {
  readonly name: string;
  readonly density: string;
  readonly sameContent: boolean;
}

const INITIAL: Settings = { name: 'bubble', density: 'xhdpi', sameContent: true };

function readSettings(stored: Values | undefined): Settings {
  if (!stored) return INITIAL;
  return {
    name: typeof stored.name === 'string' ? stored.name.slice(0, 60) : INITIAL.name,
    density: ANDROID_DENSITIES.some((d) => d.name === stored.density) ? (stored.density as string) : INITIAL.density,
    sameContent: stored.sameContent !== false,
  };
}

interface Work {
  readonly canvas: HTMLCanvasElement;
  readonly name: string;
  readonly patches: Patches;
  readonly warnings: string[];
}

const third = (size: number): Range => {
  const a = Math.floor(size / 3);
  return [a, Math.max(a + 1, Math.ceil((size * 2) / 3))];
};

function fromImage(image: LoadedImage): Work {
  const { canvas, name } = image;
  if (/\.9\.png$/i.test(name)) {
    const data = context2d(canvas, true).getImageData(0, 0, canvas.width, canvas.height).data;
    const read = readNinePatch(data, canvas.width, canvas.height);
    const inner = createCanvas(read.width, read.height);
    context2d(inner).putImageData(new ImageData(read.inner, read.width, read.height), 0, 0);
    return { canvas: inner, name, patches: read.patches, warnings: read.warnings };
  }
  return { canvas, name, patches: { stretchX: [third(canvas.width)], stretchY: [third(canvas.height)], contentX: [], contentY: [] }, warnings: [] };
}

/** Draws the picture stretched to w × h with nine-slice rules. */
function drawStretched(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, p: Patches, x: number, y: number, w: number, h: number) {
  const cols = segments(src.width, p.stretchX);
  const rows = segments(src.height, p.stretchY);
  const cw = layoutAxis(cols, w);
  const rh = layoutAxis(rows, h);
  let dy = y;
  for (const [j, row] of rows.entries()) {
    const th = rh[j] as number;
    let dx = x;
    for (const [i, col] of cols.entries()) {
      const tw = cw[i] as number;
      if (tw > 0 && th > 0) ctx.drawImage(src, col.from, row.from, col.size, row.size, dx, dy, tw, th);
      dx += tw;
    }
    dy += th;
  }
}

function ninePatchBytes(src: HTMLCanvasElement, p: Patches): Promise<Uint8Array> {
  const data = context2d(src, true).getImageData(0, 0, src.width, src.height).data;
  const out = writeNinePatch(data, src.width, src.height, p);
  const canvas = createCanvas(src.width + 2, src.height + 2);
  context2d(canvas).putImageData(new ImageData(out, src.width + 2, src.height + 2), 0, 0);
  return pngBytes(canvas);
}

function resized(src: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  if (factor === 1) return src;
  const canvas = createCanvas(Math.max(1, Math.round(src.width * factor)), Math.max(1, Math.round(src.height * factor)));
  const ctx = context2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/* ----------------------------------------------------------------- editor -- */

type Guide = { axis: 'x' | 'y'; list: 'stretchX' | 'stretchY' | 'contentX' | 'contentY'; index: number; end: 0 | 1 };
const MARGIN = 16;

function Editor({ work, patches, onChange, showContent }: { work: Work; patches: Patches; onChange: (p: Patches) => void; showContent: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Guide | null>(null);
  const { width: w, height: h } = work.canvas;
  const raw = Math.min(16, 560 / w, 440 / h);
  const zoom = raw >= 1 ? Math.floor(raw) : raw;
  const cw = Math.round(w * zoom) + MARGIN * 2;
  const ch = Math.round(h * zoom) + MARGIN * 2;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cw * ratio);
    canvas.height = Math.round(ch * ratio);
    const ctx = context2d(canvas);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    // Checkerboard under the picture shows transparency.
    const iw = w * zoom;
    const ih = h * zoom;
    const cell = 8;
    for (let yy = 0; yy < ih; yy += cell)
      for (let xx = 0; xx < iw; xx += cell) {
        ctx.fillStyle = ((xx + yy) / cell) % 2 === 0 ? '#ffffff' : '#e3e7ea';
        ctx.fillRect(MARGIN + xx, MARGIN + yy, Math.min(cell, iw - xx), Math.min(cell, ih - yy));
      }
    ctx.imageSmoothingEnabled = zoom < 1;
    ctx.drawImage(work.canvas, MARGIN, MARGIN, iw, ih);

    const sx = cleanRanges(patches.stretchX, w);
    const sy = cleanRanges(patches.stretchY, h);
    ctx.fillStyle = 'rgb(23 105 78 / 0.22)';
    for (const [a, b] of sx) ctx.fillRect(MARGIN + a * zoom, MARGIN, (b - a) * zoom, ih);
    for (const [a, b] of sy) ctx.fillRect(MARGIN, MARGIN + a * zoom, iw, (b - a) * zoom);
    // Guide marks in the margin, like the border pixels of the file.
    ctx.fillStyle = '#111';
    for (const [a, b] of sx) ctx.fillRect(MARGIN + a * zoom, MARGIN - 7, (b - a) * zoom, 5);
    for (const [a, b] of sy) ctx.fillRect(MARGIN - 7, MARGIN + a * zoom, 5, (b - a) * zoom);
    const cx = cleanRanges(showContent ? patches.contentX : sx, w);
    const cy = cleanRanges(showContent ? patches.contentY : sy, h);
    ctx.fillStyle = showContent ? '#1f5fbf' : '#8a96a0';
    for (const [a, b] of cx) ctx.fillRect(MARGIN + a * zoom, MARGIN + ih + 2, (b - a) * zoom, 5);
    for (const [a, b] of cy) ctx.fillRect(MARGIN + iw + 2, MARGIN + a * zoom, 5, (b - a) * zoom);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.strokeStyle = '#17694e';
    ctx.beginPath();
    for (const [a, b] of sx)
      for (const v of [a, b]) {
        ctx.moveTo(MARGIN + v * zoom, 2);
        ctx.lineTo(MARGIN + v * zoom, MARGIN + ih);
      }
    for (const [a, b] of sy)
      for (const v of [a, b]) {
        ctx.moveTo(2, MARGIN + v * zoom);
        ctx.lineTo(MARGIN + iw, MARGIN + v * zoom);
      }
    ctx.stroke();
    if (showContent) {
      ctx.strokeStyle = '#1f5fbf';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (const [a, b] of cx)
        for (const v of [a, b]) {
          ctx.moveTo(MARGIN + v * zoom, MARGIN);
          ctx.lineTo(MARGIN + v * zoom, ch - 2);
        }
      for (const [a, b] of cy)
        for (const v of [a, b]) {
          ctx.moveTo(MARGIN, MARGIN + v * zoom);
          ctx.lineTo(cw - 2, MARGIN + v * zoom);
        }
      ctx.stroke();
    }
  }, [work, patches, zoom, cw, ch, showContent, w, h]);

  const guides = (): Guide[] => {
    const out: Guide[] = [];
    const add = (list: Guide['list'], axis: Guide['axis']) => {
      for (let index = 0; index < patches[list].length; index++) out.push({ axis, list, index, end: 0 }, { axis, list, index, end: 1 });
    };
    add('stretchX', 'x');
    add('stretchY', 'y');
    if (showContent) {
      add('contentX', 'x');
      add('contentY', 'y');
    }
    return out;
  };

  const point = (e: PointerEvent) => {
    const box = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * cw, y: ((e.clientY - box.top) / box.height) * ch };
  };

  const onDown = (e: PointerEvent) => {
    const { x, y } = point(e);
    let best: Guide | null = null;
    let bestDist = 8;
    for (const g of guides()) {
      const value = (patches[g.list][g.index] as Range)[g.end];
      const at = MARGIN + value * zoom;
      const dist = Math.abs((g.axis === 'x' ? x : y) - at);
      // Content guides are grabbed near the bottom or right margin, stretch guides elsewhere.
      const nearContent = g.axis === 'x' ? y > MARGIN + h * zoom : x > MARGIN + w * zoom;
      const isContent = g.list.startsWith('content');
      const penalty = showContent && isContent !== nearContent ? 4 : 0;
      if (dist + penalty < bestDist) {
        best = g;
        bestDist = dist + penalty;
      }
    }
    if (best) {
      drag.current = best;
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    }
  };

  const onMove = (e: PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const { x, y } = point(e);
    const size = g.axis === 'x' ? w : h;
    const value = Math.max(0, Math.min(size, Math.round(((g.axis === 'x' ? x : y) - MARGIN) / zoom)));
    const list = patches[g.list].map((r, i) => (i === g.index ? ((g.end === 0 ? [Math.min(value, r[1] - 1), r[1]] : [r[0], Math.max(value, r[0] + 1)]) as Range) : r));
    onChange({ ...patches, [g.list]: list });
  };

  return (
    <canvas
      ref={ref}
      class="np-editor"
      style={{ width: `${cw}px`, height: `${ch}px` }}
      role="img"
      aria-label={`Picture with guides, ${w} × ${h} pixels. Drag the green lines to change what stretches.`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      data-testid="np-editor"
    />
  );
}

function Stretched({ work, patches, width, height, label }: { work: Work; patches: Patches; width: number; height: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const display = Math.min(1, 300 / width, 220 / height);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const ctx = context2d(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStretched(ctx, work.canvas, patches, 0, 0, canvas.width, canvas.height);
    const box = contentBox(work.canvas.width, work.canvas.height, patches, canvas.width, canvas.height);
    ctx.fillStyle = 'rgb(31 95 191 / 0.16)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = 'rgb(31 95 191 / 0.8)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = Math.max(1, 1 / display);
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.w - 1), Math.max(0, box.h - 1));
  }, [work, patches, width, height, display]);
  return (
    <figure class="np-sample">
      <canvas
        ref={ref}
        style={{ width: `${Math.round(width * display)}px`, height: `${Math.round(height * display)}px` }}
        role="img"
        aria-label={`${label}: ${Math.round(width)} × ${Math.round(height)} pixels`}
      />
      <figcaption>
        {label}, {Math.round(width)} × {Math.round(height)}
      </figcaption>
    </figure>
  );
}

function RangeRows({ label, ranges, size, onChange, min = 1, testId }: { label: string; ranges: readonly Range[]; size: number; onChange: (r: Range[]) => void; min?: number; testId?: string }) {
  return (
    <fieldset class="np-ranges">
      <legend>{label}</legend>
      {ranges.map((r, i) => (
        <div class="np-range" key={`${label}-${i}`}>
          <label>
            From
            <input
              class="input input-mono"
              type="number"
              min={0}
              max={size - 1}
              value={r[0]}
              onInput={(e) => onChange(ranges.map((x, j) => (j === i ? ([Number(e.currentTarget.value), x[1]] as Range) : x)))}
              data-testid={testId ? `${testId}-from-${i}` : undefined}
            />
          </label>
          <label>
            to
            <input
              class="input input-mono"
              type="number"
              min={1}
              max={size}
              value={r[1]}
              onInput={(e) => onChange(ranges.map((x, j) => (j === i ? ([x[0], Number(e.currentTarget.value)] as Range) : x)))}
            />
          </label>
          <span class="np-px">px</span>
          {ranges.length > min && (
            <button type="button" class="icon-button" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(ranges.filter((_, j) => j !== i))}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      ))}
      {ranges.length < 4 && (
        <button
          type="button"
          class="button button-small button-quiet"
          onClick={() => {
            const last = ranges[ranges.length - 1];
            const start = last ? Math.min(size - 1, last[1] + 1) : Math.floor(size / 3);
            onChange([...ranges, [start, Math.min(size, start + Math.max(1, Math.floor(size / 10)))]]);
          }}
        >
          <Icon name="plus" size={14} /> Add a region
        </button>
      )}
    </fieldset>
  );
}

function NinePatch({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState(toolId, readSettings, (s: Settings): Values => ({ ...s }));
  const [work, setWork] = useState<Work | null>(null);
  const [patches, setPatches] = useState<Patches | null>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  const onImage = (loaded: LoadedImage | null) => {
    setImage(loaded);
    if (!loaded) {
      setWork(null);
      setPatches(null);
      return;
    }
    void attempt(async () => {
      const next = fromImage(loaded);
      setWork(next);
      setPatches(next.patches);
      if (next.patches.contentX.length || next.patches.contentY.length) set({ sameContent: false });
      const base = loaded.name.replace(/(\.9)?\.[a-z0-9]+$/i, '');
      if (base) set({ name: resourceName(base, settings.name) });
    });
  };

  const effective = useMemo<Patches | null>(() => (patches && settings.sameContent ? { ...patches, contentX: [], contentY: [] } : patches), [patches, settings.sameContent]);
  const density = ANDROID_DENSITIES.find((d) => d.name === settings.density) ?? (ANDROID_DENSITIES[2] as (typeof ANDROID_DENSITIES)[number]);
  const name = resourceName(settings.name, 'nine_patch');

  const css = useMemo(() => (work && effective ? borderImageCss(`${name}.png`, work.canvas.width, work.canvas.height, effective, density.scale) : ''), [work, effective, name, density.scale]);

  const saveOne = () =>
    attempt(async () => {
      if (!work || !effective) throw new Error('Choose a picture first.');
      const outcome = await saveFile(`${name}.9.png`, await ninePatchBytes(work.canvas, effective), 'image/png');
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });

  const saveAll = () =>
    attempt(async () => {
      if (!work || !effective) throw new Error('Choose a picture first.');
      const files: Record<string, Uint8Array> = {};
      for (const d of ANDROID_DENSITIES) {
        if (d.scale > density.scale) continue;
        const scaled = resized(work.canvas, d.scale / density.scale);
        const p = scalePatches(effective, work.canvas, scaled);
        files[`drawable-${d.name}/${name}.9.png`] = await ninePatchBytes(scaled, p);
      }
      const outcome = await saveFile(`${name}-nine-patch.zip`, zipSync(files, { level: 0 }), 'application/zip');
      if (outcome.saved) notify(`Saved ${Object.keys(files).length} densities to ${outcome.location}`);
    });

  const w = work?.canvas.width ?? 0;
  const h = work?.canvas.height ?? 0;

  return (
    <section class="tool np-tool" data-testid="tool" data-state={work ? 'done' : 'idle'}>
      <div class="np-grid">
        <div class="np-controls">
          <ImageDrop image={image} onImage={onImage} accept="image/png,image/webp,image/jpeg,.9.png" hint="A PNG, or an existing .9.png to edit its guides. Nothing leaves this computer." />
          {work && patches && effective && (
            <>
              <RangeRows label="Stretches across" ranges={patches.stretchX} size={w} onChange={(r) => setPatches({ ...patches, stretchX: r })} testId="np-sx" />
              <RangeRows label="Stretches down" ranges={patches.stretchY} size={h} onChange={(r) => setPatches({ ...patches, stretchY: r })} />
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={settings.sameContent}
                  onChange={(e) => {
                    const same = e.currentTarget.checked;
                    set({ sameContent: same });
                    if (!same && !patches.contentX.length)
                      setPatches({ ...patches, contentX: [...cleanRanges(patches.stretchX, w).slice(0, 1)], contentY: [...cleanRanges(patches.stretchY, h).slice(0, 1)] });
                  }}
                />
                <span class="toggle-track" aria-hidden="true" />
                Content area is the stretch area
              </label>
              {!settings.sameContent && (
                <>
                  <RangeRows label="Content across" ranges={patches.contentX.slice(0, 1)} size={w} min={1} onChange={(r) => setPatches({ ...patches, contentX: r.slice(0, 1) })} />
                  <RangeRows label="Content down" ranges={patches.contentY.slice(0, 1)} size={h} min={1} onChange={(r) => setPatches({ ...patches, contentY: r.slice(0, 1) })} />
                </>
              )}
              <div class="icon-row">
                <label class="control">
                  <span class="control-label">Resource name</span>
                  <input class="input input-mono" type="text" value={settings.name} onInput={(e) => set({ name: e.currentTarget.value })} />
                </label>
                <label class="control">
                  <span class="control-label">This picture is for</span>
                  <select class="input" value={settings.density} onChange={(e) => set({ density: e.currentTarget.value })}>
                    {ANDROID_DENSITIES.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name} ({d.scale}×)
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div class="button-row">
                <button type="button" class="button button-primary" onClick={saveOne} data-testid="np-save">
                  <Icon name="save" size={16} /> Save {name}.9.png
                </button>
                <button type="button" class="button" onClick={saveAll} data-testid="np-save-all">
                  <Icon name="save" size={16} /> Save smaller densities (ZIP)
                </button>
              </div>
              <p class="control-help">The ZIP has drawable folders from mdpi up to {density.name}. Larger densities would only be blurry; start from your largest picture.</p>
            </>
          )}
        </div>
        <div class="np-work">
          {work && patches && effective ? (
            <>
              {work.warnings.length > 0 && (
                <ul class="np-warnings">
                  {work.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              <div class="np-editor-wrap">
                <Editor work={work} patches={patches} onChange={setPatches} showContent={!settings.sameContent} />
              </div>
              <p class="control-help">Green: stretches. Blue, dashed: where text and other content go. Drag the lines, or type exact pixels.</p>
              <div class="np-samples" data-testid="np-samples">
                <Stretched work={work} patches={effective} width={w} height={h} label="As drawn" />
                <Stretched work={work} patches={effective} width={w * 2.4} height={h} label="Wider" />
                <Stretched work={work} patches={effective} width={w * 1.2} height={h * 2.2} label="Taller" />
              </div>
              <CodeOutput outputs={[{ label: 'CSS border-image', language: 'css', code: css, filename: `${name}.css` }]} baseName={name} />
            </>
          ) : (
            <p class="np-empty">Choose a picture of a button, bubble or panel. You then mark the parts that may stretch; corners and edges keep their shape.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(NinePatch);
