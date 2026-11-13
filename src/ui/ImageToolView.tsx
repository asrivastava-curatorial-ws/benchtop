/**
 * The generic screen for image tools.  The preview is computed on a reduced
 * copy so sliders stay responsive; the full-resolution image is only processed
 * when measuring or saving.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../lib/errors';
import type { ImageRender, ImageToolSpec, ToolEntry, Values } from '../tools/types';
import { ControlsForm } from './Controls';
import { downscale } from './canvas';
import { ExportBar } from './ExportBar';
import { useToolValues } from './hooks';
import { ImageDrop, type LoadedImage } from './ImageDrop';
import { Icon } from './icons';

const PREVIEW_EDGE = 1400;

/** Shows a canvas produced elsewhere inside the component tree. */
export function CanvasView({ canvas, label, checker = true }: { canvas: HTMLCanvasElement; label?: string; checker?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current?.replaceChildren(canvas);
  }, [canvas]);
  return (
    <figure class="canvas-view">
      <div ref={host} class={`canvas-frame${checker ? ' checker' : ''}`} />
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: the view accepts every image tool
export function ImageToolView({ entry, spec }: { entry: ToolEntry; spec: ImageToolSpec<any> }) {
  const [values, patchValues, resetValues] = useToolValues(entry.id, spec.controls);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [rendered, setRendered] = useState<{ result: ImageRender } | { error: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const sequence = useRef(0);

  const proxy = useMemo(() => (image ? downscale(image.canvas, PREVIEW_EDGE) : null), [image]);

  useEffect(() => {
    if (!proxy) {
      setRendered(null);
      return;
    }
    const token = ++sequence.current;
    // One frame of delay batches rapid slider movement.
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(() => spec.process(proxy.canvas, values, { scale: proxy.scale }))
        .then(
          (result) => {
            if (sequence.current === token) setRendered({ result });
          },
          (error: unknown) => {
            if (sequence.current === token) setRendered({ error: errorMessage(error) });
          },
        );
    }, 16);
    return () => clearTimeout(timer);
  }, [proxy, values, spec]);

  const latest = useRef<Values>(values);
  latest.current = values;
  const renderFull = useCallback(async (): Promise<HTMLCanvasElement> => {
    if (!image) throw new Error('Open an image first.');
    const result = await spec.process(image.canvas, latest.current, { scale: 1 });
    const output = result.outputs[Math.min(selected, result.outputs.length - 1)];
    if (!output) throw new Error('This tool produced no image.');
    return output.canvas;
  }, [image, spec, selected]);

  const outputs = rendered && 'result' in rendered ? rendered.result.outputs : [];
  const current = outputs[Math.min(selected, outputs.length - 1)];
  const state = !image ? 'idle' : rendered === null ? 'busy' : 'error' in rendered ? 'error' : 'done';

  return (
    <section class="tool tool-image layout-form" data-testid="tool" data-state={state}>
      <aside class="tool-side">
        <div class="tool-options">
          {spec.presets && spec.presets.length > 0 && (
            <div class="presets" role="group" aria-label="Presets">
              {spec.presets.map((preset) => (
                <button key={preset.name} type="button" class="chip" onClick={() => patchValues(preset.values)}>
                  {preset.name}
                </button>
              ))}
            </div>
          )}
          {spec.controls.length > 0 && <ControlsForm defs={spec.controls} values={values} onChange={patchValues} layout="panel" idPrefix={entry.id} />}
          {spec.controls.length > 0 && (
            <div class="tool-options-actions">
              <button type="button" class="button button-quiet" onClick={resetValues}>
                Reset options
              </button>
            </div>
          )}
        </div>
        {image && current && (
          <ExportBar
            render={renderFull}
            revision={`${JSON.stringify(values)}|${selected}`}
            pixels={image.canvas.width * image.canvas.height}
            baseName={outputs.length > 1 && current.label ? `${image.name.replace(/\.[^.]+$/, '')}-${current.label.toLowerCase().replace(/\s+/g, '-')}` : image.name}
            formats={spec.formats}
            originalSize={image.size}
            label={outputs.length > 1 ? `Save "${current.label ?? 'image'}"` : 'Save image'}
          />
        )}
      </aside>
      <div class="tool-main">
        <ImageDrop image={image} onImage={setImage} />
        {rendered && 'error' in rendered && (
          <p class="status status-error" role="alert">
            <Icon name="alert" size={15} />
            <span>{rendered.error}</span>
          </p>
        )}
        {rendered && 'result' in rendered && (
          <>
            <div class={`image-results${outputs.length > 1 ? ' image-results-grid' : ''}`} data-testid="image-results">
              {spec.showSource !== false && outputs.length === 1 && proxy && <CanvasView canvas={proxy.canvas} label="Original" />}
              {outputs.map((output, index) =>
                outputs.length > 1 ? (
                  <button
                    key={output.label ?? index}
                    type="button"
                    class={`image-choice${index === selected ? ' is-active' : ''}`}
                    aria-pressed={index === selected}
                    onClick={() => setSelected(index)}
                  >
                    <CanvasView canvas={output.canvas} label={output.label} />
                  </button>
                ) : (
                  <CanvasView key={output.label ?? index} canvas={output.canvas} label={output.label ?? 'Result'} />
                ),
              )}
            </div>
            {rendered.result.info && <p class="status status-info">{rendered.result.info}</p>}
            {proxy && proxy.scale < 1 && <p class="status status-info">Preview shown at {Math.round(proxy.scale * 100)}% size. Saving uses the full resolution.</p>}
          </>
        )}
      </div>
    </section>
  );
}
