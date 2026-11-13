/** The generic screen for visual generators: controls on the left, live preview and code on the right. */
import { useMemo, useState } from 'preact/hooks';
import { errorMessage } from '../lib/errors';
import type { ToolEntry, VisualRender, VisualToolSpec } from '../tools/types';
import { CodeOutput } from './CodeOutput';
import { ControlsForm } from './Controls';
import { useToolValues } from './hooks';
import { Icon } from './icons';

type Backdrop = 'light' | 'dark' | 'grid';

// biome-ignore lint/suspicious/noExplicitAny: the view accepts every visual tool
export function VisualToolView({ entry, spec }: { entry: ToolEntry; spec: VisualToolSpec<any> }) {
  const [values, patchValues, resetValues] = useToolValues(entry.id, spec.controls);
  const [backdrop, setBackdrop] = useState<Backdrop>('light');
  const [replay, setReplay] = useState(0);

  const rendered = useMemo<{ value: VisualRender } | { error: string }>(() => {
    try {
      return { value: spec.render(values) };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [spec, values]);

  return (
    <section class="tool tool-visual layout-form" data-testid="tool" data-state={'error' in rendered ? 'error' : 'done'}>
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
          <ControlsForm defs={spec.controls} values={values} onChange={patchValues} layout="panel" idPrefix={entry.id} />
          <div class="tool-options-actions">
            {spec.randomize && (
              <button type="button" class="button button-primary" data-testid="randomize" onClick={() => patchValues(spec.randomize?.(values) ?? {})}>
                <Icon name="dice" size={14} />
                Randomise
              </button>
            )}
            <button type="button" class="button button-quiet" onClick={resetValues}>
              Reset options
            </button>
          </div>
        </div>
      </aside>
      <div class="tool-main">
        <div class="stage-bar">
          <span class="pane-title">Preview</span>
          <div class="segmented segmented-small" role="radiogroup" aria-label="Preview backdrop">
            {(['light', 'dark', 'grid'] as const).map((option) => (
              <button key={option} type="button" role="radio" aria-checked={backdrop === option} class={backdrop === option ? 'is-active' : ''} onClick={() => setBackdrop(option)}>
                {option === 'grid' ? 'Transparent' : option === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
          <button type="button" class="button button-small" onClick={() => setReplay(replay + 1)} title="Restart animations in the preview">
            <Icon name="refresh" size={14} />
            Replay
          </button>
        </div>
        {'error' in rendered ? (
          <p class="status status-error" role="alert">
            <Icon name="alert" size={15} />
            <span>{rendered.error}</span>
          </p>
        ) : (
          <>
            <div class={`stage stage-${backdrop}`} data-testid="stage">
              {rendered.value.css && <style>{rendered.value.css}</style>}
              <div class="pv" key={replay}>
                {rendered.value.preview}
              </div>
            </div>
            {rendered.value.note && <p class="status status-info">{rendered.value.note}</p>}
            <CodeOutput outputs={rendered.value.outputs} downloads={rendered.value.downloads} baseName={entry.id} />
          </>
        )}
      </div>
    </section>
  );
}
