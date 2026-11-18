/** Finds faces (YuNet) and blurs, pixelates or covers them; boxes can be removed or drawn by hand. */
import { useRef, useState } from 'preact/hooks';
import { saveFile } from '../../platform';
import { runJob } from '../../platform/ai';
import { replaceExtension } from '../../ui/canvas';
import { ImageDrop, type LoadedImage } from '../../ui/ImageDrop';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { BatchButton, imageBytes, JobStatus, ModelGate, useBlobUrl, useJob, useOriginalUrl } from './_ai';
import { Segmented, usePersistentState } from './_shared';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly score?: number;
  readonly off?: boolean;
}

interface Settings {
  readonly effect: 'blur' | 'pixelate' | 'fill';
  readonly padding: number;
  readonly colour: string;
  readonly thorough: boolean;
  readonly threshold: number;
}

const read = (s: Values | undefined): Settings => ({
  effect: s?.effect === 'pixelate' || s?.effect === 'fill' ? s.effect : 'blur',
  padding: typeof s?.padding === 'number' ? s.padding : 0.15,
  colour: typeof s?.colour === 'string' ? s.colour : '#000000',
  thorough: s?.thorough !== false,
  threshold: typeof s?.threshold === 'number' ? s.threshold : 0.6,
});

function FaceBlur({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({ ...s }));
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [result, setResult] = useState<Uint8Array | null>(null);
  const [drawing, setDrawing] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [job, run, stop] = useJob();
  const original = useOriginalUrl(image);
  const after = useBlobUrl(result);
  const stage = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const options = { effect: settings.effect, padding: settings.padding, colour: settings.colour, thorough: settings.thorough, threshold: settings.threshold };

  const detect = () =>
    void run(async () => {
      if (!image) return;
      const out = await runJob<{ faces: Box[] }>({ op: 'faces', options }, await imageBytes(image));
      setBoxes(out.header.faces);
      setResult(out.bytes);
      if (out.header.faces.length === 0) notify('No faces were found. Draw boxes over anything to hide, then press Apply.');
    });

  const apply = () =>
    void run(async () => {
      if (!image || !boxes) return;
      const active = boxes.filter((b) => !b.off).map(({ x, y, w, h }) => ({ x, y, w, h }));
      const out = await runJob({ op: 'faces', options: { ...options, boxes: active } }, await imageBytes(image));
      setResult(out.bytes);
    });

  const toImage = (event: MouseEvent) => {
    const rect = stage.current?.querySelector('img')?.getBoundingClientRect();
    if (!rect || !image) return null;
    return { x: ((event.clientX - rect.left) / rect.width) * image.canvas.width, y: ((event.clientY - rect.top) / rect.height) * image.canvas.height };
  };

  const width = image?.canvas.width ?? 1;
  const height = image?.canvas.height ?? 1;

  return (
    <ModelGate kinds={['faces']} what="Face blurring">
      <div data-testid="tool" class="tool ai-tool">
        <div class="ai-controls">
          <div class="control">
            <span class="control-label">Hide faces with</span>
            <Segmented
              label="Effect"
              small={false}
              value={settings.effect}
              onChange={(effect) => set({ effect })}
              choices={[
                { value: 'blur', label: 'Blur' },
                { value: 'pixelate', label: 'Pixels' },
                { value: 'fill', label: 'Solid' },
              ]}
            />
          </div>
          {settings.effect === 'fill' && (
            <div class="control">
              <label class="control-label" for="face-colour">
                Colour
              </label>
              <input id="face-colour" type="color" value={settings.colour} onInput={(e) => set({ colour: e.currentTarget.value })} />
            </div>
          )}
          <div class="control">
            <label class="control-label" for="face-padding">
              Extra margin: {Math.round(settings.padding * 100)}%
            </label>
            <input id="face-padding" type="range" min={0} max={0.6} step={0.05} value={settings.padding} onInput={(e) => set({ padding: Number(e.currentTarget.value) })} />
          </div>
          <div class="control">
            <label class="control-label" for="face-threshold">
              Sensitivity: {Math.round((1 - settings.threshold) * 100)}%
            </label>
            <input id="face-threshold" type="range" min={0.3} max={0.9} step={0.05} value={1.2 - settings.threshold} onInput={(e) => set({ threshold: 1.2 - Number(e.currentTarget.value) })} />
          </div>
          <label class="toggle" for="face-thorough">
            <input id="face-thorough" type="checkbox" role="switch" aria-checked={settings.thorough} checked={settings.thorough} onChange={(e) => set({ thorough: e.currentTarget.checked })} />
            <span class="toggle-track" aria-hidden="true" />
            <span class="toggle-text">Look for small faces in crowds</span>
          </label>
          <div class="button-row">
            <button type="button" class="button button-primary" disabled={!image || job.running} onClick={detect} data-testid="ai-run">
              Find faces
            </button>
            <button type="button" class="button" disabled={!boxes || job.running} onClick={apply}>
              Apply
            </button>
            <button
              type="button"
              class="button"
              disabled={!result}
              onClick={() =>
                attempt(async () => {
                  if (!result || !image) return;
                  const saved = await saveFile(replaceExtension(image.name, 'blurred.png'), result, 'image/png');
                  if (saved.saved) notify(`Saved to ${saved.location}`);
                })
              }
            >
              Save PNG
            </button>
          </div>
          <div class="button-row">
            <BatchButton
              label="Blur faces in many pictures…"
              disabled={job.running}
              run={run}
              process={async (picture) => (await runJob({ op: 'faces', options }, await imageBytes(picture))).bytes}
              rename={(name) => replaceExtension(name, 'blurred.png')}
              zipName="faces-blurred.zip"
            />
          </div>
          <JobStatus
            job={job}
            onStop={stop}
            idle={boxes ? `${boxes.filter((b) => !b.off).length} of ${boxes.length} boxes will be hidden. Click a box to keep that face; drag on the picture to add a box.` : undefined}
          />
        </div>
        <div class="ai-work">
          <ImageDrop
            image={image}
            onImage={(img) => {
              setImage(img);
              setBoxes(null);
              setResult(null);
            }}
          />
          <div class="ai-compare">
            <figure class="ai-figure">
              <figcaption>Faces found {boxes ? `(${boxes.length})` : ''}</figcaption>
              <div
                class="ai-stage ai-boxes"
                ref={stage}
                onMouseDown={(e) => {
                  if (!boxes || (e.target as HTMLElement).classList.contains('ai-box')) return;
                  const p = toImage(e);
                  if (p) setDrawing({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
                }}
                onMouseMove={(e) => {
                  if (!drawing) return;
                  const p = toImage(e);
                  if (p) setDrawing({ ...drawing, x1: p.x, y1: p.y });
                }}
                onMouseUp={() => {
                  if (drawing && Math.abs(drawing.x1 - drawing.x0) > 4 && Math.abs(drawing.y1 - drawing.y0) > 4) {
                    const box = { x: Math.min(drawing.x0, drawing.x1), y: Math.min(drawing.y0, drawing.y1), w: Math.abs(drawing.x1 - drawing.x0), h: Math.abs(drawing.y1 - drawing.y0) };
                    setBoxes((list) => [...(list ?? []), box]);
                  }
                  setDrawing(null);
                }}
              >
                {original && (
                  <div class="ai-box-frame">
                    <img src={original} alt="Original" draggable={false} />
                    {(boxes ?? []).map((b, i) => (
                      <button
                        key={`${b.x}-${b.y}-${i}`}
                        type="button"
                        class={`ai-box${b.off ? ' is-off' : ''}`}
                        style={{ left: `${(b.x / width) * 100}%`, top: `${(b.y / height) * 100}%`, width: `${(b.w / width) * 100}%`, height: `${(b.h / height) * 100}%` }}
                        aria-label={b.off ? 'Hide this face' : 'Keep this face'}
                        title={b.off ? 'This face stays visible. Click to hide it.' : 'Click to keep this face visible'}
                        onClick={() => setBoxes((list) => (list ?? []).map((x, j) => (j === i ? { ...x, off: !x.off } : x)))}
                      />
                    ))}
                    {drawing && (
                      <span
                        class="ai-box is-drawing"
                        style={{
                          left: `${(Math.min(drawing.x0, drawing.x1) / width) * 100}%`,
                          top: `${(Math.min(drawing.y0, drawing.y1) / height) * 100}%`,
                          width: `${(Math.abs(drawing.x1 - drawing.x0) / width) * 100}%`,
                          height: `${(Math.abs(drawing.y1 - drawing.y0) / height) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            </figure>
            <figure class="ai-figure">
              <figcaption>Result</figcaption>
              <div class="ai-stage" data-testid="ai-result">
                {after ? <img src={after} alt="Faces hidden" /> : <span class="tone-muted">Press Find faces.</span>}
              </div>
            </figure>
          </div>
        </div>
      </div>
    </ModelGate>
  );
}

export default defineCustomTool(FaceBlur);
