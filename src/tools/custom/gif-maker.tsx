/** Animated GIFs from a set of pictures, encoded in the page with gifenc. */

import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { formatBytes } from '../../lib/bytes';
import { pickFiles, saveFile } from '../../platform';
import { context2d, createCanvas, loadImage } from '../../ui/canvas';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

interface Frame {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly file: File;
}

interface Settings {
  readonly width: number;
  readonly delay: number;
  readonly loop: 'forever' | 'once';
  readonly colours: number;
  readonly bounce: boolean;
  readonly background: string;
  readonly fit: 'contain' | 'cover';
}

const read = (s: Values | undefined): Settings => {
  const num = (k: string, d: number, min: number, max: number) => (typeof s?.[k] === 'number' && Number.isFinite(s[k]) ? Math.min(max, Math.max(min, s[k] as number)) : d);
  return {
    width: num('width', 480, 16, 1600),
    delay: num('delay', 500, 20, 10000),
    loop: s?.loop === 'once' ? 'once' : 'forever',
    colours: num('colours', 256, 2, 256),
    bounce: s?.bounce === true,
    background: typeof s?.background === 'string' ? s.background : '#ffffff',
    fit: s?.fit === 'cover' ? 'cover' : 'contain',
  };
};

let ids = 0;

export async function encodeGif(frames: readonly HTMLCanvasElement[], settings: Settings): Promise<Uint8Array> {
  const gif = GIFEncoder();
  const order = settings.bounce && frames.length > 2 ? [...frames, ...frames.slice(1, -1).reverse()] : frames;
  for (const [i, canvas] of order.entries()) {
    const { data } = context2d(canvas, true).getImageData(0, 0, canvas.width, canvas.height);
    const palette = quantize(data, settings.colours, { format: 'rgb444' });
    const index = applyPalette(data, palette, 'rgb444');
    gif.writeFrame(index, canvas.width, canvas.height, { palette, delay: settings.delay, repeat: i === 0 ? (settings.loop === 'forever' ? 0 : -1) : undefined });
    // Keep the page responsive on long animations.
    if (i % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  gif.finish();
  return gif.bytes();
}

function GifMaker({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({ ...s }));
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const [frames, setFrames] = useState<Frame[]>([]);
  const [result, setResult] = useState<{ url: string; bytes: Uint8Array; width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(frames);
  latest.current = frames;
  useEffect(
    () => () => {
      for (const f of latest.current) URL.revokeObjectURL(f.url);
    },
    [],
  );
  useEffect(() => () => (result ? URL.revokeObjectURL(result.url) : undefined), [result]);

  const add = (files: File[]) =>
    setFrames((list) => [...list, ...files.filter((f) => f.type.startsWith('image/')).map((file) => ({ id: `frame-${ids++}`, name: file.name, url: URL.createObjectURL(file), file }))]);
  const move = (index: number, by: number) =>
    setFrames((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  useIncomingFiles(add, (f) => f.type.startsWith('image/'));

  const build = () =>
    void attempt(async () => {
      if (frames.length < 2) return;
      setBusy(true);
      try {
        const pictures = [];
        for (const frame of frames) pictures.push(await loadImage(frame.file));
        const width = Math.round(settings.width);
        const height = Math.max(1, Math.round((width * pictures[0].height) / pictures[0].width));
        const canvases = pictures.map((picture) => {
          const canvas = createCanvas(width, height);
          const context = context2d(canvas, true);
          context.fillStyle = settings.background;
          context.fillRect(0, 0, width, height);
          const scale = settings.fit === 'cover' ? Math.max(width / picture.width, height / picture.height) : Math.min(width / picture.width, height / picture.height);
          const w = picture.width * scale;
          const h = picture.height * scale;
          context.imageSmoothingQuality = 'high';
          context.drawImage(picture, (width - w) / 2, (height - h) / 2, w, h);
          return canvas;
        });
        const bytes = await encodeGif(canvases, settings);
        setResult({ url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/gif' })), bytes, width, height });
      } finally {
        setBusy(false);
      }
    });

  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        <div class="control">
          <label class="control-label" for="gif-width">
            Width (px)
          </label>
          <input
            id="gif-width"
            class="input input-number"
            type="number"
            min={16}
            max={1600}
            value={settings.width}
            onInput={(e) => set({ width: Math.min(1600, Math.max(16, Number(e.currentTarget.value) || 480)) })}
          />
        </div>
        <div class="control">
          <label class="control-label" for="gif-delay">
            Time per picture ({(settings.delay / 1000).toFixed(2)} s)
          </label>
          <input id="gif-delay" type="range" min={20} max={3000} step={10} value={settings.delay} onInput={(e) => set({ delay: Number(e.currentTarget.value) })} />
        </div>
        <div class="control">
          <label class="control-label" for="gif-colours">
            Colours ({settings.colours})
          </label>
          <input id="gif-colours" type="range" min={2} max={256} value={settings.colours} onInput={(e) => set({ colours: Number(e.currentTarget.value) })} />
        </div>
        <div class="control">
          <label class="control-label" for="gif-fit">
            Pictures of other shapes
          </label>
          <select id="gif-fit" class="input" value={settings.fit} onChange={(e) => set({ fit: e.currentTarget.value as Settings['fit'] })}>
            <option value="contain">Fit inside, with a border</option>
            <option value="cover">Fill, cropping the edges</option>
          </select>
        </div>
        <div class="control">
          <label class="control-label" for="gif-bg">
            Border colour
          </label>
          <input id="gif-bg" type="color" value={settings.background} onInput={(e) => set({ background: e.currentTarget.value })} />
        </div>
        <label class="toggle" for="gif-loop">
          <input
            id="gif-loop"
            type="checkbox"
            role="switch"
            aria-checked={settings.loop === 'forever'}
            checked={settings.loop === 'forever'}
            onChange={(e) => set({ loop: e.currentTarget.checked ? 'forever' : 'once' })}
          />
          <span class="toggle-track" aria-hidden="true" />
          <span>Repeat forever</span>
        </label>
        <label class="toggle" for="gif-bounce">
          <input id="gif-bounce" type="checkbox" role="switch" aria-checked={settings.bounce} checked={settings.bounce} onChange={(e) => set({ bounce: e.currentTarget.checked })} />
          <span class="toggle-track" aria-hidden="true" />
          <span>Play forwards, then backwards</span>
        </label>
        <div class="button-row">
          <button type="button" class="button button-primary" disabled={frames.length < 2 || busy} onClick={build} data-testid="gif-build">
            {busy ? 'Making…' : 'Make GIF'}
          </button>
          <button
            type="button"
            class="button"
            disabled={!result}
            onClick={() =>
              attempt(async () => {
                if (!result) return;
                const saved = await saveFile('animation.gif', result.bytes, 'image/gif');
                if (saved.saved) notify(`Saved to ${saved.location}`);
              })
            }
          >
            Save GIF
          </button>
        </div>
        {result && (
          <p class="tone-muted pdf-note">
            {result.width} × {result.height} px, {formatBytes(result.bytes.length)}
          </p>
        )}
        <p class="tone-muted pdf-note">To make a GIF from a video clip, use the Video Toolkit.</p>
      </div>
      <div class="ai-work">
        {result && (
          <figure class="ai-figure">
            <figcaption>Result</figcaption>
            <div class="ai-stage">
              <img src={result.url} alt="The animated GIF" data-testid="gif-result" />
            </div>
          </figure>
        )}
        <button
          type="button"
          class={`dropzone${frames.length ? ' dropzone-compact' : ''}`}
          onClick={() => attempt(async () => add(await pickFiles('image/*')))}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length) {
              e.preventDefault();
              add(files);
            }
          }}
          data-testid="gif-drop"
        >
          <Icon name="image" size={frames.length ? 20 : 30} />
          <span class="dropzone-title">{frames.length ? 'Add more pictures' : 'Drop pictures here, or click to choose'}</span>
          {!frames.length && <span class="dropzone-hint">Each picture becomes a frame, in the order shown. The first picture sets the shape.</span>}
        </button>
        {frames.length > 0 && (
          <ol class="pdf-grid pdf-grid-small" aria-label="Frames">
            {frames.map((frame, i) => (
              <li key={frame.id} class="pdf-page">
                <div class="pdf-thumb">
                  <img src={frame.url} alt="" />
                </div>
                <div class="pdf-page-label">
                  {i + 1} <span class="tone-muted">{frame.name}</span>
                </div>
                <div class="pdf-page-actions">
                  <button type="button" class="icon-button" aria-label={`Move ${frame.name} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <Icon name="left" size={14} />
                  </button>
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={`Remove ${frame.name}`}
                    onClick={() => {
                      URL.revokeObjectURL(frame.url);
                      setFrames((list) => list.filter((f) => f.id !== frame.id));
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                  <button type="button" class="icon-button" aria-label={`Move ${frame.name} later`} disabled={i === frames.length - 1} onClick={() => move(i, 1)}>
                    <Icon name="right" size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export default defineCustomTool(GifMaker);
