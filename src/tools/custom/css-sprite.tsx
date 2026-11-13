/** Combines icons into one sprite sheet and writes the CSS that shows each of them. */
import { useMemo, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { errorMessage } from '../../lib/errors';
import { layoutSprite, type SpriteDirection, spriteCss, spriteHtml } from '../../lib/sprite';
import { pickFiles } from '../../platform';
import { CodeOutput } from '../../ui/CodeOutput';
import { context2d, createCanvas, loadImage } from '../../ui/canvas';
import { ExportBar } from '../../ui/ExportBar';
import { CanvasView } from '../../ui/ImageToolView';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

interface Item {
  readonly id: number;
  readonly name: string;
  readonly canvas: HTMLCanvasElement;
  readonly size: number;
}

interface Settings {
  readonly direction: SpriteDirection;
  readonly padding: number;
  readonly prefix: string;
  readonly scale: 1 | 2;
  readonly url: string;
}

const MAX_ITEMS = 400;
let nextId = 1;

function readSettings(stored: Values | undefined): Settings {
  const direction = stored?.direction === 'horizontal' || stored?.direction === 'grid' ? stored.direction : 'vertical';
  const padding = typeof stored?.padding === 'number' && stored.padding >= 0 && stored.padding <= 64 ? Math.round(stored.padding) : 2;
  const prefix = typeof stored?.prefix === 'string' && /^[A-Za-z_][\w-]*$/.test(stored.prefix) ? stored.prefix : 'icon';
  return { direction, padding, prefix, scale: stored?.scale === 2 ? 2 : 1, url: typeof stored?.url === 'string' && stored.url.trim() !== '' ? stored.url : 'sprite.png' };
}

function CssSprite({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, readSettings, (s) => ({ ...s }));
  const [items, setItems] = useState<readonly Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const prefixValid = /^[A-Za-z_][\w-]*$/.test(settings.prefix);
  const prefix = prefixValid ? settings.prefix : 'icon';

  const add = (files: readonly File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/') || /\.(svg|png|jpe?g|gif|webp|avif|ico|bmp)$/i.test(file.name));
    if (images.length === 0) return;
    setLoading(true);
    void attempt(async () => {
      const loaded: Item[] = [];
      const failed: string[] = [];
      for (const file of images.slice(0, MAX_ITEMS - items.length)) {
        try {
          loaded.push({ id: nextId++, name: file.name, canvas: await loadImage(file), size: file.size });
        } catch {
          failed.push(file.name);
        }
      }
      setItems((previous) => [...previous, ...loaded].slice(0, MAX_ITEMS));
      if (failed.length > 0) notify(`Could not read ${failed.join(', ')}`, 'error');
      if (images.length > MAX_ITEMS - items.length) notify(`A sprite holds at most ${MAX_ITEMS} images.`, 'error');
    }).finally(() => setLoading(false));
  };

  const built = useMemo(() => {
    if (items.length === 0) return null;
    try {
      const layout = layoutSprite(
        items.map((item) => ({ name: item.name, width: item.canvas.width, height: item.canvas.height })),
        settings.direction,
        settings.padding,
      );
      if (layout.width > 16384 || layout.height > 16384) return { error: `The sheet would be ${layout.width} × ${layout.height} px, larger than images can be. Use the grid layout or fewer images.` };
      const sheet = createCanvas(layout.width, layout.height);
      const context = context2d(sheet);
      layout.items.forEach((placed, index) => {
        const source = items[index];
        if (source) context.drawImage(source.canvas, placed.x, placed.y);
      });
      return { layout, sheet };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [items, settings.direction, settings.padding]);

  const dropHandlers = {
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        setDragging(true);
      }
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent) => {
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) {
        event.preventDefault();
        add(files);
      }
    },
  };
  const choose = () => attempt(async () => add(await pickFiles('image/*,.svg,.ico')));
  const state = items.length === 0 ? 'idle' : built && 'error' in built ? 'error' : 'done';

  return (
    <section class="tool tool-image layout-form" data-testid="tool" data-state={state}>
      <aside class="tool-side">
        <div class="tool-options">
          <div class="control">
            <span class="control-label">Layout</span>
            <Segmented
              label="Layout"
              value={settings.direction}
              onChange={(direction) => setSettings((s) => ({ ...s, direction }))}
              choices={[
                { value: 'vertical', label: 'Column' },
                { value: 'horizontal', label: 'Row' },
                { value: 'grid', label: 'Grid' },
              ]}
            />
          </div>
          <label class="control">
            <span class="control-label">Space between images: {settings.padding} px</span>
            <input type="range" class="range" min={0} max={32} value={settings.padding} onInput={(event) => setSettings((s) => ({ ...s, padding: Number(event.currentTarget.value) }))} />
          </label>
          <label class="control">
            <span class="control-label">Class prefix</span>
            <input
              class={`input input-mono${prefixValid ? '' : ' is-invalid'}`}
              value={settings.prefix}
              onInput={(event) => setSettings((s) => ({ ...s, prefix: event.currentTarget.value.trim() }))}
              data-testid="sprite-prefix"
            />
            {!prefixValid && <span class="control-help tone-bad">Start with a letter; use letters, digits, - and _.</span>}
          </label>
          <label class="control">
            <span class="control-label">Sheet URL in the CSS</span>
            <input class="input input-mono" value={settings.url} onInput={(event) => setSettings((s) => ({ ...s, url: event.currentTarget.value }))} />
          </label>
          <div class="control">
            <span class="control-label">Artwork drawn at</span>
            <Segmented
              label="Pixel density"
              value={String(settings.scale) as '1' | '2'}
              onChange={(scale) => setSettings((s) => ({ ...s, scale: scale === '2' ? 2 : 1 }))}
              choices={[
                { value: '1', label: '1× (actual size)' },
                { value: '2', label: '2× (retina)' },
              ]}
            />
            <p class="control-help">At 2× each image is shown at half its pixel size, so it stays sharp on high-density screens.</p>
          </div>
          {items.length > 0 && (
            <div class="sprite-list" data-testid="sprite-list">
              <div class="pane-title">
                {items.length} image{items.length === 1 ? '' : 's'}, {formatBytes(items.reduce((sum, item) => sum + item.size, 0))}
              </div>
              <ul>
                {items.map((item, index) => (
                  <li key={item.id}>
                    <span class="sprite-name" title={item.name}>
                      .{prefix}-{built && !('error' in built) ? built.layout.items[index]?.className : ''}
                    </span>
                    <span class="sprite-dim">
                      {item.canvas.width}×{item.canvas.height}
                    </span>
                    <button type="button" class="icon-button" aria-label={`Remove ${item.name}`} onClick={() => setItems(items.filter((other) => other.id !== item.id))}>
                      <Icon name="close" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" class="button button-small button-quiet" onClick={() => setItems([])}>
                Remove all
              </button>
            </div>
          )}
        </div>
      </aside>
      <div class="tool-main">
        <button type="button" class={`dropzone dropzone-compact${dragging ? ' is-dragging' : ''}`} onClick={choose} {...dropHandlers} data-testid="dropzone" disabled={loading}>
          <Icon name="plus" size={22} />
          <span class="dropzone-title">{loading ? 'Reading images…' : items.length === 0 ? 'Drop icons here, or click to choose several' : 'Add more images'}</span>
          <span class="dropzone-hint">PNG, SVG, WebP, JPEG and GIF (first frame). Images are placed in the order they are added.</span>
        </button>
        {built && 'error' in built && <p class="control-help tone-bad">{built.error}</p>}
        {built && !('error' in built) && (
          <>
            <div class="pane sprite-preview">
              <div class="pane-header">
                <span class="pane-title">Sprite sheet</span>
                <span class="pane-meta">
                  {built.layout.width} × {built.layout.height} px
                </span>
              </div>
              <div class="sprite-stage">
                <CanvasView canvas={built.sheet} checker />
              </div>
            </div>
            <ExportBar
              render={() => built.sheet}
              revision={built.sheet}
              pixels={built.sheet.width * built.sheet.height}
              baseName={settings.url.split('/').pop() || 'sprite.png'}
              formats={['png', 'webp', 'avif']}
              label="Save sheet"
            />
            <CodeOutput
              baseName="sprite"
              outputs={[
                { label: 'CSS', language: 'css', code: spriteCss(built.layout, settings.url, prefix, settings.scale) },
                { label: 'HTML', language: 'html', code: spriteHtml(built.layout, prefix) },
              ]}
            />
          </>
        )}
      </div>
    </section>
  );
}

export default defineCustomTool(CssSprite);
