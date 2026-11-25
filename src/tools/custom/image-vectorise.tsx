/** Traces a picture into an SVG with ImageTracer (public domain), in the page. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { PRESETS, type TraceSettings, traceToSvg } from '../../lib/trace';
import { copyText, saveFile } from '../../platform';
import { replaceExtension } from '../../ui/canvas';
import { ImageDrop, type LoadedImage } from '../../ui/ImageDrop';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

type Settings = TraceSettings;

const read = (s: Values | undefined): Settings => {
  const preset = (['logo', 'artwork', 'poster', 'lineart'] as const).find((p) => p === s?.preset) ?? 'logo';
  const num = (k: keyof Settings, d: number, min: number, max: number) => (typeof s?.[k] === 'number' && Number.isFinite(s[k]) ? Math.min(max, Math.max(min, s[k] as number)) : d);
  const base = PRESETS[preset];
  return {
    preset,
    colours: num('colours', base.colours, 2, 64),
    detail: num('detail', base.detail, 0.1, 8),
    speckles: num('speckles', base.speckles, 0, 128),
    smooth: num('smooth', base.smooth, 0, 5),
  };
};

function Vectorise({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({ ...s }));
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = useMemo(() => (svg ? URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) : null), [svg]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  useEffect(() => {
    if (!image) {
      setSvg(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      traceToSvg(image.canvas, settings)
        .then((result) => {
          if (!cancelled) setSvg(result);
        })
        .catch((error) => notify(error instanceof Error ? error.message : String(error), 'error'))
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [image, settings]);

  const paths = svg ? (svg.match(/<path/g) ?? []).length : 0;
  const slider = (key: 'colours' | 'detail' | 'speckles' | 'smooth', label: string, min: number, max: number, step: number, hint: string) => (
    <div class="control">
      <label class="control-label" for={`vec-${key}`}>
        {label} ({settings[key]})
      </label>
      <input id={`vec-${key}`} type="range" min={min} max={max} step={step} value={settings[key]} onInput={(e) => setSettings((s) => ({ ...s, [key]: Number(e.currentTarget.value) }))} />
      <span class="control-hint tone-muted">{hint}</span>
    </div>
  );
  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        <div class="control">
          <span class="control-label">Picture type</span>
          <Segmented
            label="Picture type"
            small={false}
            value={settings.preset}
            onChange={(preset) => setSettings({ preset, ...PRESETS[preset] })}
            choices={[
              { value: 'logo', label: 'Logo' },
              { value: 'artwork', label: 'Artwork' },
              { value: 'poster', label: 'Poster' },
              { value: 'lineart', label: 'Line art' },
            ]}
          />
        </div>
        {slider('colours', 'Colours', 2, 64, 1, 'Each colour becomes a layer of shapes.')}
        {slider('detail', 'Curve tolerance', 0.1, 8, 0.1, 'Lower follows edges more closely, with more points.')}
        {slider('speckles', 'Ignore specks smaller than', 0, 128, 1, 'In pixels; raises to drop noise.')}
        {slider('smooth', 'Smooth before tracing', 0, 5, 1, 'Helps with photos and scans.')}
        <div class="button-row">
          <button
            type="button"
            class="button button-primary"
            disabled={!svg || busy}
            onClick={() =>
              attempt(async () => {
                if (!svg || !image) return;
                const saved = await saveFile(replaceExtension(image.name, 'svg'), svg, 'image/svg+xml');
                if (saved.saved) notify(`Saved to ${saved.location}`);
              })
            }
            data-testid="vec-save"
          >
            Save SVG
          </button>
          <button
            type="button"
            class="button"
            disabled={!svg}
            onClick={() =>
              attempt(async () => {
                if (svg) await copyText(svg);
                notify('Copied');
              })
            }
          >
            Copy SVG code
          </button>
        </div>
        {svg && (
          <p class="tone-muted pdf-note" data-testid="vec-stats">
            {paths} shapes, {formatBytes(new Blob([svg]).size)}
            {busy ? ', updating…' : ''}
          </p>
        )}
      </div>
      <div class="ai-work">
        <ImageDrop image={image} onImage={setImage} hint="Flat logos, icons and drawings trace best. Photos become posterised artwork." />
        {image && (
          <div class="ai-compare">
            <figure class="ai-figure">
              <figcaption>Original</figcaption>
              <div class="ai-stage">
                <img src={image.canvas.toDataURL()} alt="" />
              </div>
            </figure>
            <figure class="ai-figure">
              <figcaption>SVG{busy ? ' (tracing…)' : ''}</figcaption>
              <div class="ai-stage checker">{url ? <img src={url} alt="Traced SVG" data-testid="vec-result" /> : <span class="spinner" aria-hidden="true" />}</div>
            </figure>
          </div>
        )}
      </div>
    </div>
  );
}

export default defineCustomTool(Vectorise);
