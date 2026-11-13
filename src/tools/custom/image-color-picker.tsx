/** Pick exact colours from an image and extract its dominant palette. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { describeColor, readableOn, rgbaToHex } from '../../lib/color';
import { extractPalette } from '../../lib/pixels';
import { copyText } from '../../platform';
import { CodeOutput } from '../../ui/CodeOutput';
import { context2d, downscale } from '../../ui/canvas';
import { ImageDrop, type LoadedImage } from '../../ui/ImageDrop';
import { CanvasView } from '../../ui/ImageToolView';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';

interface Picked {
  readonly hex: string;
  readonly x: number;
  readonly y: number;
}

const LOUPE = 11;

export function paletteExports(colours: readonly string[]) {
  const names = colours.map((_, i) => `color-${i + 1}`);
  return [
    { label: 'CSS variables', language: 'css' as const, code: `:root {\n${colours.map((hex, i) => `  --${names[i]}: ${hex};`).join('\n')}\n}\n` },
    { label: 'Tailwind v4', language: 'css' as const, code: `@theme {\n${colours.map((hex, i) => `  --color-palette-${i + 1}: ${hex};`).join('\n')}\n}\n` },
    { label: 'JSON', language: 'json' as const, code: `${JSON.stringify(colours, null, 2)}\n` },
    { label: 'List', language: 'text' as const, code: `${colours.join('\n')}\n` },
  ];
}

function ImageColorPicker() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [hover, setHover] = useState<Picked | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [count, setCount] = useState(8);
  const loupe = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const proxy = useMemo(() => (image ? downscale(image.canvas, 1400) : null), [image]);
  const reader = useMemo(() => (image ? context2d(image.canvas, true) : null), [image]);

  const palette = useMemo(() => {
    if (!proxy) return [];
    const data = context2d(proxy.canvas, true).getImageData(0, 0, proxy.canvas.width, proxy.canvas.height).data;
    return extractPalette(data, count).map((colour) => ({ hex: rgbaToHex({ r: colour.r, g: colour.g, b: colour.b, a: 1 }, false), share: colour.share }));
  }, [proxy, count]);

  const at = (event: PointerEvent): Picked | null => {
    if (!image || !reader || !frame.current) return null;
    const rect = frame.current.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * image.canvas.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * image.canvas.height);
    if (x < 0 || y < 0 || x >= image.canvas.width || y >= image.canvas.height) return null;
    const [r, g, b] = reader.getImageData(x, y, 1, 1).data;
    return { hex: rgbaToHex({ r: r as number, g: g as number, b: b as number, a: 1 }, false), x, y };
  };

  useEffect(() => {
    const canvas = loupe.current;
    if (!canvas || !image || !hover) return;
    const context = context2d(canvas);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const half = Math.floor(LOUPE / 2);
    context.drawImage(image.canvas, hover.x - half, hover.y - half, LOUPE, LOUPE, 0, 0, canvas.width, canvas.height);
    const cell = canvas.width / LOUPE;
    context.strokeStyle = readableOn(hover.hex);
    context.lineWidth = 2;
    context.strokeRect(half * cell, half * cell, cell, cell);
  }, [hover, image]);

  const copy = (text: string) =>
    attempt(async () => {
      await copyText(text);
      notify(`Copied ${text}`);
    });

  const formats = (hex: string) => {
    const info = describeColor(hex);
    return info ? [info.hex, info.rgb, info.hsl, info.oklch] : [hex];
  };

  return (
    <section class="tool tool-image layout-form" data-testid="tool" data-state={image ? 'done' : 'idle'}>
      <aside class="tool-side">
        <div class="tool-options">
          <div class="picker-loupe">
            <canvas ref={loupe} width={132} height={132} class="checker" role="img" aria-label="Magnified view around the pointer" />
            <div>
              <div class="pane-title">{hover ? hover.hex : 'Point at the image'}</div>
              {hover && (
                <div class="pane-meta">
                  x {hover.x}, y {hover.y}
                </div>
              )}
              <p class="control-help">Click to keep a colour.</p>
            </div>
          </div>
          <div class="picked-list" data-testid="picked">
            {picked.length === 0 && <p class="control-help">Colours you pick appear here.</p>}
            {picked.map((colour, index) => (
              <div key={`${colour.hex}-${index}`} class="picked">
                <span class="swatch swatch-large" style={`background: ${colour.hex};`} />
                <div class="picked-formats">
                  {formats(colour.hex).map((text) => (
                    <button key={text} type="button" class="link-button" onClick={() => copy(text)} title="Copy">
                      {text}
                    </button>
                  ))}
                </div>
                <button type="button" class="icon-button" aria-label={`Remove ${colour.hex}`} onClick={() => setPicked(picked.filter((_, i) => i !== index))}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
          </div>
          {picked.length > 0 && (
            <button type="button" class="button button-small button-quiet" onClick={() => setPicked([])}>
              Clear picked colours
            </button>
          )}
        </div>
      </aside>
      <div class="tool-main">
        <ImageDrop
          image={image}
          onImage={(loaded) => {
            setImage(loaded);
            setHover(null);
          }}
        />
        {image && proxy && (
          <>
            <div class="picker-stage">
              <div
                class="picker-frame"
                ref={frame}
                style={`aspect-ratio: ${image.canvas.width} / ${image.canvas.height};`}
                onPointerMove={(event) => setHover(at(event))}
                onPointerLeave={() => setHover(null)}
                onClick={(event) => {
                  const colour = at(event as unknown as PointerEvent);
                  if (colour) setPicked((list) => [colour, ...list].slice(0, 24));
                }}
                data-testid="picker-frame"
              >
                <CanvasView canvas={proxy.canvas} checker />
              </div>
            </div>
            <div class="pane palette-pane">
              <div class="pane-header">
                <span class="pane-title">Palette</span>
                <label class="pane-meta palette-count">
                  Colours
                  <input type="range" class="range" min={2} max={16} value={count} onInput={(event) => setCount(Number(event.currentTarget.value))} aria-label="Number of palette colours" />
                  {count}
                </label>
              </div>
              <div class="palette" data-testid="palette">
                {palette.map((colour) => (
                  <button
                    key={colour.hex}
                    type="button"
                    class="palette-swatch"
                    style={`background: ${colour.hex}; color: ${readableOn(colour.hex)}; flex-grow: ${Math.max(colour.share, 0.04)};`}
                    title={`${colour.hex}, ${(colour.share * 100).toFixed(1)}% of the image`}
                    onClick={() => copy(colour.hex)}
                  >
                    <span>{colour.hex}</span>
                    <small>{(colour.share * 100).toFixed(0)}%</small>
                  </button>
                ))}
              </div>
            </div>
            <CodeOutput outputs={paletteExports(palette.map((colour) => colour.hex))} baseName="palette" />
          </>
        )}
      </div>
    </section>
  );
}

export default defineCustomTool(ImageColorPicker);
