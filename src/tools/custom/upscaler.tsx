/** Enlarges a picture with a Real-ESRGAN model running on this computer. */
import { useState } from 'preact/hooks';
import { saveFile } from '../../platform';
import { runJob } from '../../platform/ai';
import { replaceExtension } from '../../ui/canvas';
import { ImageDrop, type LoadedImage } from '../../ui/ImageDrop';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { BatchButton, BeforeAfter, chosenModel, imageBytes, JobStatus, ModelGate, ModelPicker, useBlobUrl, useJob, useModels, useOriginalUrl } from './_ai';
import { Segmented, usePersistentState } from './_shared';

interface Settings {
  readonly model: string;
  readonly scale: '2' | '3' | '4';
}

const read = (s: Values | undefined): Settings => ({
  model: typeof s?.model === 'string' ? s.model : '',
  scale: s?.scale === '2' || s?.scale === '3' ? s.scale : '4',
});

const MAX_OUTPUT = 120_000_000;

function Upscaler({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({ ...s }));
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [result, setResult] = useState<{ bytes: Uint8Array; width: number; height: number; device?: string } | null>(null);
  const { status } = useModels();
  const [job, run, stop] = useJob();
  const original = useOriginalUrl(image);
  const after = useBlobUrl(result?.bytes ?? null);
  const scale = Number(settings.scale);
  const tooBig = image ? image.canvas.width * image.canvas.height * scale * scale > MAX_OUTPUT : false;

  const request = () => ({ op: 'upscale', model: chosenModel(status, 'upscale', settings.model), options: { scale } }) as const;
  const go = () =>
    void run(async () => {
      if (!image) return;
      const out = await runJob<{ width: number; height: number }>(request(), await imageBytes(image));
      setResult({ bytes: out.bytes, width: out.header.width, height: out.header.height, device: out.header.device });
    });

  return (
    <ModelGate kinds={['upscale']} what="Upscaling">
      <div data-testid="tool" class="tool ai-tool">
        <div class="ai-controls">
          <ModelPicker kind="upscale" value={chosenModel(status, 'upscale', settings.model)} onChange={(model) => setSettings((s) => ({ ...s, model }))} />
          <div class="control">
            <span class="control-label">Enlarge</span>
            <Segmented
              label="Enlarge"
              small={false}
              value={settings.scale}
              onChange={(value) => setSettings((s) => ({ ...s, scale: value }))}
              choices={[
                { value: '2', label: '2×' },
                { value: '3', label: '3×' },
                { value: '4', label: '4×' },
              ]}
            />
          </div>
          {image && (
            <p class={tooBig ? 'tone-bad' : 'tone-muted'}>
              {image.canvas.width} × {image.canvas.height} px becomes {image.canvas.width * scale} × {image.canvas.height * scale} px.
              {tooBig ? ' That is more than 120 megapixels; choose a smaller factor or crop first.' : ''}
            </p>
          )}
          <div class="button-row">
            <button type="button" class="button button-primary" disabled={!image || job.running || tooBig} onClick={go} data-testid="ai-run">
              Upscale
            </button>
            <button
              type="button"
              class="button"
              disabled={!result}
              onClick={() =>
                attempt(async () => {
                  if (!result || !image) return;
                  const saved = await saveFile(replaceExtension(image.name, `${settings.scale}x.png`), result.bytes, 'image/png');
                  if (saved.saved) notify(`Saved to ${saved.location}`);
                })
              }
            >
              Save PNG
            </button>
          </div>
          <div class="button-row">
            <BatchButton
              label="Enlarge many pictures…"
              disabled={job.running}
              run={run}
              process={async (picture) => (await runJob(request(), await imageBytes(picture))).bytes}
              rename={(name) => replaceExtension(name, `${settings.scale}x.png`)}
              zipName={`enlarged-${settings.scale}x.zip`}
            />
          </div>
          <JobStatus
            job={job}
            onStop={stop}
            idle={result ? `${result.width} × ${result.height} px${result.device ? `, ${result.device}` : ''}` : 'Large pictures are processed in tiles; this can take a minute on the processor.'}
          />
        </div>
        <div class="ai-work">
          <ImageDrop
            image={image}
            onImage={(img) => {
              setImage(img);
              setResult(null);
            }}
          />
          <BeforeAfter before={original} after={after} afterLabel={`Upscaled ${settings.scale}×`} />
        </div>
      </div>
    </ModelGate>
  );
}

export default defineCustomTool(Upscaler);
