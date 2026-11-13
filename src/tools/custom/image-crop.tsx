/** Crop an image freely or to a fixed aspect ratio. */
import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import { context2d, createCanvas, downscale } from '../../ui/canvas';
import { ExportBar } from '../../ui/ExportBar';
import { ImageDrop, type LoadedImage } from '../../ui/ImageDrop';
import { CanvasView } from '../../ui/ImageToolView';
import { defineCustomTool } from '../types';
import { clamp, Segmented, startDrag } from './_shared';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const RATIOS: { value: string; label: string; ratio: number | null }[] = [
  { value: 'free', label: 'Free', ratio: null },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '3:2', label: '3:2', ratio: 3 / 2 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: '4:5', label: '4:5', ratio: 4 / 5 },
];

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Applies a drag to a crop rectangle, keeping it inside the image and, optionally, at a fixed ratio. */
export function dragRect(start: Rect, handle: Handle, dx: number, dy: number, bounds: { width: number; height: number }, ratio: number | null, minSize = 8): Rect {
  if (handle === 'move') {
    return { ...start, x: clamp(start.x + dx, 0, bounds.width - start.w), y: clamp(start.y + dy, 0, bounds.height - start.h) };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minSize);
  if (handle.includes('e')) right = clamp(right + dx, left + minSize, bounds.width);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minSize);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minSize, bounds.height);
  let w = right - left;
  let h = bottom - top;
  if (ratio) {
    // The dragged edge leads; the other dimension follows, then everything is fitted back inside the image.
    if (handle === 'n' || handle === 's') w = h * ratio;
    else h = w / ratio;
    const maxW = handle.includes('w') ? right : bounds.width - left;
    const maxH = handle.includes('n') ? bottom : bounds.height - top;
    const scale = Math.min(1, maxW / w, maxH / h);
    w *= scale;
    h *= scale;
    if (handle.includes('w')) left = right - w;
    if (handle.includes('n')) top = bottom - h;
    if (handle === 'n' || handle === 's') left = clamp(start.x + (start.w - w) / 2, 0, bounds.width - w);
    if (handle === 'e' || handle === 'w') top = clamp(start.y + (start.h - h) / 2, 0, bounds.height - h);
  }
  return { x: left, y: top, w, h };
}

/** The largest centred rectangle with the given ratio. */
export function fitRatio(width: number, height: number, ratio: number | null): Rect {
  if (!ratio) return { x: 0, y: 0, w: width, h: height };
  const w = Math.min(width, height * ratio);
  const h = w / ratio;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function ImageCrop() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [ratioKey, setRatioKey] = useState('free');
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const frame = useRef<HTMLDivElement>(null);
  const proxy = useMemo(() => (image ? downscale(image.canvas, 1400) : null), [image]);
  const ratio = RATIOS.find((item) => item.value === ratioKey)?.ratio ?? null;
  const width = image?.canvas.width ?? 0;
  const height = image?.canvas.height ?? 0;

  const take = (loaded: LoadedImage | null) => {
    setImage(loaded);
    if (loaded) {
      const fitted = fitRatio(loaded.canvas.width, loaded.canvas.height, ratio);
      // Start with a margin so the handles are easy to find.
      setRect(ratio ? fitted : { x: fitted.w * 0.1, y: fitted.h * 0.1, w: fitted.w * 0.8, h: fitted.h * 0.8 });
    }
  };

  const chooseRatio = (key: string) => {
    setRatioKey(key);
    const next = RATIOS.find((item) => item.value === key)?.ratio ?? null;
    if (image && next) {
      // Keep the centre and as much of the current area as the new ratio allows.
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      let w = Math.max(rect.w, rect.h * next);
      let h = w / next;
      const scale = Math.min(1, width / w, height / h);
      w *= scale;
      h *= scale;
      setRect({ x: clamp(cx - w / 2, 0, width - w), y: clamp(cy - h / 2, 0, height - h), w, h });
    }
  };

  const begin = (handle: Handle) => (event: PointerEvent) => {
    event.stopPropagation();
    const surface = frame.current;
    if (!surface || !image) return;
    const start = rect;
    const origin = surface.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    startDrag(event, surface, (_fx, _fy, e) => {
      const dx = ((e.clientX - startX) / origin.width) * width;
      const dy = ((e.clientY - startY) / origin.height) * height;
      setRect(dragRect(start, handle, dx, dy, { width, height }, ratio));
    });
  };

  const setField = (key: keyof Rect, text: string) => {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    setRect((current) => {
      const next = { ...current, [key]: value };
      const w = clamp(next.w, 1, width);
      const h = ratio ? w / ratio : clamp(next.h, 1, height);
      return { x: clamp(next.x, 0, width - w), y: clamp(next.y, 0, height - Math.min(h, height)), w, h: Math.min(h, height) };
    });
  };

  const rounded = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.max(1, Math.round(rect.w)), h: Math.max(1, Math.round(rect.h)) };

  const render = useCallback(() => {
    if (!image) throw new Error('Open an image first.');
    const canvas = createCanvas(rounded.w, rounded.h);
    context2d(canvas).drawImage(image.canvas, rounded.x, rounded.y, rounded.w, rounded.h, 0, 0, rounded.w, rounded.h);
    return canvas;
  }, [image, rounded.x, rounded.y, rounded.w, rounded.h]);

  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  return (
    <section class="tool tool-image layout-form" data-testid="tool" data-state={image ? 'done' : 'idle'}>
      <aside class="tool-side">
        <div class="tool-options">
          <div class="control">
            <span class="control-label">Aspect ratio</span>
            <Segmented label="Aspect ratio" value={ratioKey} onChange={chooseRatio} choices={RATIOS} />
          </div>
          {image && (
            <div class="crop-fields">
              {(['x', 'y', 'w', 'h'] as const).map((key) => (
                <label key={key} class="control">
                  <span class="control-label">{key === 'w' ? 'Width' : key === 'h' ? 'Height' : key.toUpperCase()}</span>
                  <input
                    class="input input-number"
                    type="number"
                    min={0}
                    step={1}
                    value={rounded[key]}
                    disabled={key === 'h' && ratio !== null}
                    onChange={(event) => setField(key, event.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
          )}
          {image && (
            <div class="button-row">
              <button type="button" class="button button-small" onClick={() => setRect(fitRatio(width, height, ratio))}>
                Select all
              </button>
            </div>
          )}
        </div>
        {image && (
          <ExportBar
            render={render}
            revision={`${rounded.x},${rounded.y},${rounded.w},${rounded.h}`}
            pixels={rounded.w * rounded.h}
            baseName={image.name.replace(/(\.[^.]+)?$/, '-cropped$1')}
            originalSize={image.size}
            label="Save cropped image"
          />
        )}
      </aside>
      <div class="tool-main">
        <ImageDrop image={image} onImage={take} />
        {image && proxy && (
          <div class="crop-stage">
            <div class="crop-frame" ref={frame} style={`aspect-ratio: ${width} / ${height};`}>
              <CanvasView canvas={proxy.canvas} checker />
              <div
                class="crop-shade"
                style={`clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${pct(rect.x, width)} ${pct(rect.y, height)}, ${pct(rect.x, width)} ${pct(rect.y + rect.h, height)}, ${pct(rect.x + rect.w, width)} ${pct(rect.y + rect.h, height)}, ${pct(rect.x + rect.w, width)} ${pct(rect.y, height)}, ${pct(rect.x, width)} ${pct(rect.y, height)});`}
              />
              <div
                class="crop-box"
                style={`left: ${pct(rect.x, width)}; top: ${pct(rect.y, height)}; width: ${pct(rect.w, width)}; height: ${pct(rect.h, height)};`}
                onPointerDown={begin('move')}
                data-testid="crop-box"
              >
                <span class="crop-thirds" aria-hidden="true" />
                {HANDLES.map((handle) => (
                  <span key={handle} class={`crop-handle crop-handle-${handle}`} onPointerDown={begin(handle)} aria-hidden="true" />
                ))}
              </div>
            </div>
            <p class="status status-info">
              Selection {rounded.w} × {rounded.h} px. Drag inside to move it, or drag the edges and corners.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default defineCustomTool(ImageCrop);
