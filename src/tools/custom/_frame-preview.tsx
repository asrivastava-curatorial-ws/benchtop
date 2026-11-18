/**
 * Previews for the video toolkit: the first and last frame of a trim, and the
 * crop rectangle drawn over a frame (drag on the picture to draw a new one).
 * Frames come from FFmpeg through the desktop shell.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../../lib/errors';
import { type MediaInfo, videoFrame } from '../../platform/convert';
import { clock } from './_convert';

/** "1:05.5", "65.5" or "1:01:05" as seconds; null when it cannot be read. */
export function toSeconds(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parts = trimmed.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(?:\.\d+)?$/.test(p))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** A frame at `seconds`, fetched after the value has settled for a moment. */
function useFrame(token: string, seconds: number | null): { url: string | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; error: string | null; loading: boolean }>({ url: null, error: null, loading: false });
  useEffect(() => {
    if (seconds === null) {
      setState({ url: null, error: null, loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      videoFrame(token, seconds).then(
        (url) => live && setState({ url, error: null, loading: false }),
        (error: unknown) => live && setState({ url: null, error: errorMessage(error), loading: false }),
      );
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [token, seconds]);
  return state;
}

function Frame({ label, token, seconds }: { label: string; token: string; seconds: number | null }) {
  const frame = useFrame(token, seconds);
  return (
    <figure class="frame-preview">
      <div class={`frame-preview-stage${frame.loading ? ' is-loading' : ''}`}>
        {frame.url ? <img src={frame.url} alt={`${label} frame`} /> : <span class="frame-preview-note">{frame.error ?? (seconds === null ? 'Enter a time' : 'Loading…')}</span>}
      </div>
      <figcaption>
        {label} {seconds === null ? '' : clock(seconds)}
      </figcaption>
    </figure>
  );
}

export function TrimPreview({ token, info, start, end }: { token: string; info: MediaInfo | undefined; start: string; end: string }) {
  const from = toSeconds(start) ?? 0;
  const duration = info?.duration ?? null;
  // The last kept frame: just before the end time, or near the end of the video.
  const endAt = toSeconds(end);
  const last = endAt !== null ? Math.max(from, endAt - 0.05) : duration !== null ? Math.max(from, duration - 0.1) : null;
  const length = (endAt ?? duration ?? from) - from;
  return (
    <section class="frame-previews" aria-label="Trim preview" data-testid="trim-preview">
      <div class="frame-preview-row">
        <Frame label="First frame" token={token} seconds={from} />
        <Frame label="Last frame" token={token} seconds={last} />
      </div>
      <p class="control-hint">{length > 0 ? `Keeps ${clock(length)}${duration ? ` of ${clock(duration)}` : ''}.` : 'The end must come after the start.'}</p>
    </section>
  );
}

export interface CropBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const even = (n: number) => Math.max(0, Math.round(n / 2) * 2);

export function CropPreview({ token, info, box, onChange }: { token: string; info: MediaInfo | undefined; box: CropBox; onChange: (box: CropBox) => void }) {
  const width = info?.width ?? 0;
  const height = info?.height ?? 0;
  const at = info?.duration ? Math.min(info.duration * 0.1, 5) : 0;
  const frame = useFrame(token, width ? at : null);
  const stage = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<CropBox | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const toVideo = (event: PointerEvent): { x: number; y: number } => {
    const rect = (stage.current as HTMLDivElement).getBoundingClientRect();
    return {
      x: Math.min(width, Math.max(0, ((event.clientX - rect.left) / rect.width) * width)),
      y: Math.min(height, Math.max(0, ((event.clientY - rect.top) / rect.height) * height)),
    };
  };
  const span = (a: { x: number; y: number }, b: { x: number; y: number }): CropBox => {
    const x = even(Math.min(a.x, b.x));
    const y = even(Math.min(a.y, b.y));
    return { x, y, w: Math.max(2, Math.min(width - x, even(Math.abs(a.x - b.x)))), h: Math.max(2, Math.min(height - y, even(Math.abs(a.y - b.y)))) };
  };

  const shown = drag ?? box;
  const outside = shown.x + shown.w > width || shown.y + shown.h > height;
  const pct = (value: number, of: number) => `${(100 * value) / of}%`;
  if (!width || !height) return <p class="control-hint">The crop preview appears once the video’s size is known.</p>;
  return (
    <section class="frame-previews" aria-label="Crop preview" data-testid="crop-preview">
      <div
        ref={stage}
        class="vcrop-stage"
        style={{ aspectRatio: `${width} / ${height}` }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          origin.current = toVideo(e);
          setDrag(span(origin.current, origin.current));
        }}
        onPointerMove={(e) => origin.current && setDrag(span(origin.current, toVideo(e)))}
        onPointerUp={(e) => {
          if (origin.current) {
            const next = span(origin.current, toVideo(e));
            if (next.w >= 8 && next.h >= 8) onChange(next);
          }
          origin.current = null;
          setDrag(null);
        }}
      >
        {frame.url ? <img src={frame.url} alt="Frame to crop" draggable={false} /> : <span class="frame-preview-note">{frame.error ?? 'Loading…'}</span>}
        <div
          class={`vcrop-box${outside ? ' is-outside' : ''}`}
          style={{ left: pct(shown.x, width), top: pct(shown.y, height), width: pct(Math.min(shown.w, width - shown.x), width), height: pct(Math.min(shown.h, height - shown.y), height) }}
        />
      </div>
      <p class="control-hint">
        {outside ? `The rectangle goes past the edge of the ${width}×${height} picture.` : `Keeps ${shown.w}×${shown.h} of ${width}×${height}.`} Drag on the picture to draw a new rectangle.
      </p>
    </section>
  );
}
