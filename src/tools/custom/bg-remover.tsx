/** Removes the background of a photo with an AI model running on this computer. */
import { useState } from 'preact/hooks';
import { saveFile } from '../../platform';
import { runJob } from '../../platform/ai';
import { replaceExtension } from '../../ui/canvas';
import { ImageDrop, type LoadedImage } from '../../ui/ImageDrop';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { BatchButton, BeforeAfter, chosenModel, imageBytes, JobStatus, ModelGate, ModelPicker, useBlobUrl, useJob, useModels, useOriginalUrl } from './_ai';
import { Segmented, usePersistentState } from './_shared';

type Mode = 'cutout' | 'mask' | 'colour' | 'blur';

interface Settings {
  readonly model: string;
  readonly mode: Mode;
  readonly colour: string;
  readonly strength: number;
  readonly edges: 'soft' | 'hard';
  readonly crop: boolean;
}

const read = (s: Values | undefined): Settings => ({
  model: typeof s?.model === 'string' ? s.model : '',
  mode: (['cutout', 'mask', 'colour', 'blur'] as const).find((m) => m === s?.mode) ?? 'cutout',
  colour: typeof s?.colour === 'string' && /^#[0-9a-f]{6}$/i.test(s.colour) ? s.colour : '#ffffff',
  strength: typeof s?.strength === 'number' ? s.strength : 1,
  edges: s?.edges === 'hard' ? 'hard' : 'soft',
  crop: s?.crop === true,
});

function BackgroundRemover({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({ ...s }));
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [result, setResult] = useState<{ bytes: Uint8Array; device?: string; width: number; height: number } | null>(null);
  const { status } = useModels();
  const [job, run, stop] = useJob();
  const original = useOriginalUrl(image);
  const after = useBlobUrl(result?.bytes ?? null);
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  const request = () =>
    ({
      op: 'background',
      model: chosenModel(status, 'background', settings.model),
      options: { mode: settings.mode, colour: settings.colour, strength: settings.strength, edges: settings.edges, crop: settings.crop },
    }) as const;
  const go = () =>
    void run(async () => {
      if (!image) return;
      const out = await runJob<{ width: number; height: number }>(request(), await imageBytes(image));
      setResult({ bytes: out.bytes, device: out.header.device, width: out.header.width, height: out.header.height });
    });

  return (
    <ModelGate kinds={['background']} what="Background removal">
      <div data-testid="tool" class="tool ai-tool">
        <div class="ai-controls">
          <ModelPicker kind="background" value={chosenModel(status, 'background', settings.model)} onChange={(model) => set({ model })} />
          <div class="control">
            <span class="control-label">Result</span>
            <Segmented
              label="Result"
              small={false}
              value={settings.mode}
              onChange={(mode) => set({ mode })}
              choices={[
                { value: 'cutout', label: 'Transparent' },
                { value: 'colour', label: 'Colour' },
                { value: 'blur', label: 'Blurred' },
                { value: 'mask', label: 'Mask' },
              ]}
            />
          </div>
          {settings.mode === 'colour' && (
            <div class="control">
              <label class="control-label" for="bg-colour">
                Background colour
              </label>
              <input id="bg-colour" type="color" value={settings.colour} onInput={(e) => set({ colour: e.currentTarget.value })} />
            </div>
          )}
          {settings.mode === 'blur' && (
            <div class="control">
              <label class="control-label" for="bg-strength">
                Blur strength
              </label>
              <input id="bg-strength" type="range" min={0.25} max={3} step={0.25} value={settings.strength} onInput={(e) => set({ strength: Number(e.currentTarget.value) })} />
            </div>
          )}
          <div class="control">
            <span class="control-label">Edges</span>
            <Segmented
              label="Edges"
              small={false}
              value={settings.edges}
              onChange={(edges) => set({ edges })}
              choices={[
                { value: 'soft', label: 'Soft' },
                { value: 'hard', label: 'Hard' },
              ]}
            />
          </div>
          <label class="toggle" for="bg-crop">
            <input id="bg-crop" type="checkbox" role="switch" aria-checked={settings.crop} checked={settings.crop} onChange={(e) => set({ crop: e.currentTarget.checked })} />
            <span class="toggle-track" aria-hidden="true" />
            <span class="toggle-text">Crop to the subject</span>
          </label>
          <div class="button-row">
            <button type="button" class="button button-primary" disabled={!image || job.running} onClick={go} data-testid="ai-run">
              Remove background
            </button>
            <button
              type="button"
              class="button"
              disabled={!result}
              onClick={() =>
                attempt(async () => {
                  if (!result || !image) return;
                  const saved = await saveFile(replaceExtension(image.name, settings.mode === 'mask' ? 'mask.png' : 'png'), result.bytes, 'image/png');
                  if (saved.saved) notify(`Saved to ${saved.location}`);
                })
              }
            >
              Save PNG
            </button>
          </div>
          <div class="button-row">
            <BatchButton
              label="Remove from many pictures…"
              disabled={job.running}
              run={run}
              process={async (picture) => (await runJob(request(), await imageBytes(picture))).bytes}
              rename={(name) => replaceExtension(name, settings.mode === 'mask' ? 'mask.png' : 'png')}
              zipName="without-background.zip"
            />
          </div>
          <JobStatus job={job} onStop={stop} idle={result ? `${result.width} × ${result.height} px${result.device ? `, ${result.device}` : ''}` : undefined} />
        </div>
        <div class="ai-work">
          <ImageDrop
            image={image}
            onImage={(img) => {
              setImage(img);
              setResult(null);
            }}
          />
          <BeforeAfter before={original} after={after} checker={settings.mode === 'cutout'} afterLabel="Without background" />
        </div>
      </div>
    </ModelGate>
  );
}

export default defineCustomTool(BackgroundRemover);
