/** Paint over something in a photo and the MI-GAN model fills it in from its surroundings. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { saveFile } from '../../platform';
import { runJob } from '../../platform/ai';
import { replaceExtension } from '../../ui/canvas';
import { ImageDrop, type LoadedImage, loadImageFile } from '../../ui/ImageDrop';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { imageBytes, JobStatus, ModelGate, useJob, useOriginalUrl } from './_ai';

function ObjectEraser(_props: { toolId: string }) {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [history, setHistory] = useState<LoadedImage[]>([]);
  const [brush, setBrush] = useState(40);
  const [painted, setPainted] = useState(false);
  const [job, run, stop] = useJob();
  const url = useOriginalUrl(image);
  const mask = useRef<HTMLCanvasElement>(null);
  const painting = useRef<{ x: number; y: number } | null>(null);

  // A fresh, empty mask for every new picture.
  useEffect(() => {
    const canvas = mask.current;
    if (!canvas || !image) return;
    canvas.width = image.canvas.width;
    canvas.height = image.canvas.height;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setPainted(false);
  }, [image]);

  const point = (event: PointerEvent) => {
    const canvas = mask.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height, scale: canvas.width / rect.width };
  };

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }, scale: number) => {
    const ctx = mask.current?.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = 'rgba(255, 64, 64, 0.55)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brush * scale;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
    setPainted(true);
  };

  const maskPng = async (): Promise<Uint8Array> => {
    const source = mask.current;
    if (!source) throw new Error('Nothing is painted.');
    const out = document.createElement('canvas');
    out.width = source.width;
    out.height = source.height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('Could not create a drawing surface.');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, out.width, out.height);
    // White wherever paint was laid down: that is what gets erased.
    const paint = source.getContext('2d')?.getImageData(0, 0, source.width, source.height);
    if (!paint) throw new Error('Nothing is painted.');
    const white = ctx.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < paint.data.length; i += 4) {
      if ((paint.data[i + 3] ?? 0) > 0) {
        white.data[i] = 255;
        white.data[i + 1] = 255;
        white.data[i + 2] = 255;
      }
    }
    ctx.putImageData(white, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not prepare the mask.');
    return new Uint8Array(await blob.arrayBuffer());
  };

  const erase = () =>
    void run(async () => {
      if (!image) return;
      const out = await runJob({ op: 'erase' }, await imageBytes(image), await maskPng());
      const next = await loadImageFile(new Blob([out.bytes as BlobPart], { type: 'image/png' }), image.name);
      setHistory((h) => [...h, image]);
      setImage({ ...next, name: image.name });
    });

  return (
    <ModelGate kinds={['eraser']} what="The object eraser">
      <div data-testid="tool" class="tool ai-tool">
        <div class="ai-controls">
          <p class="tone-muted">Paint over what should disappear: people in the background, wires, blemishes, text. Then press Erase. Repeat as often as needed.</p>
          <div class="control">
            <label class="control-label" for="eraser-brush">
              Brush: {brush} px
            </label>
            <input id="eraser-brush" type="range" min={5} max={200} step={5} value={brush} onInput={(e) => setBrush(Number(e.currentTarget.value))} />
          </div>
          <div class="button-row">
            <button type="button" class="button button-primary" disabled={!image || !painted || job.running} onClick={erase} data-testid="ai-run">
              Erase
            </button>
            <button
              type="button"
              class="button"
              disabled={!painted}
              onClick={() => {
                const canvas = mask.current;
                canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
                setPainted(false);
              }}
            >
              Clear paint
            </button>
            <button
              type="button"
              class="button"
              disabled={history.length === 0 || job.running}
              onClick={() => {
                const previous = history[history.length - 1];
                if (previous) {
                  setHistory((h) => h.slice(0, -1));
                  setImage(previous);
                }
              }}
            >
              Undo erase
            </button>
            <button
              type="button"
              class="button"
              disabled={!image || history.length === 0}
              onClick={() =>
                attempt(async () => {
                  if (!image) return;
                  const blob = await new Promise<Blob | null>((resolve) => image.canvas.toBlob(resolve, 'image/png'));
                  if (!blob) return;
                  const saved = await saveFile(replaceExtension(image.name, 'erased.png'), new Uint8Array(await blob.arrayBuffer()), 'image/png');
                  if (saved.saved) notify(`Saved to ${saved.location}`);
                })
              }
            >
              Save PNG
            </button>
          </div>
          <JobStatus job={job} onStop={stop} />
        </div>
        <div class="ai-work">
          <ImageDrop
            image={image}
            onImage={(img) => {
              setImage(img);
              setHistory([]);
            }}
          />
          {url && (
            <div class="ai-paint" data-testid="ai-result">
              <img src={url} alt="The scene to clean up; paint over what should go" draggable={false} />
              <canvas
                ref={mask}
                class="ai-mask"
                style={{ cursor: 'crosshair' }}
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
                  const p = point(e);
                  if (p) {
                    painting.current = p;
                    stroke(p, p, p.scale);
                  }
                }}
                onPointerMove={(e) => {
                  const p = point(e);
                  if (p && painting.current) {
                    stroke(painting.current, p, p.scale);
                    painting.current = p;
                  }
                }}
                onPointerUp={() => {
                  painting.current = null;
                }}
              />
            </div>
          )}
        </div>
      </div>
    </ModelGate>
  );
}

export default defineCustomTool(ObjectEraser);
