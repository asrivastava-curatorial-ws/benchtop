/** Favicons: multi-size .ico files, PNG icons, a web manifest and the HTML that links them. */
import { zipSync } from 'fflate';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { toRgba } from '../../lib/color';
import { encodeIco } from '../../lib/ico';
import { replaceColor } from '../../lib/pixels';
import { escapeXml } from '../../lib/text';
import { saveFile } from '../../platform';
import { CodeOutput } from '../../ui/CodeOutput';
import { ControlsForm } from '../../ui/Controls';
import { context2d, createCanvas, downscale, encodeCanvas } from '../../ui/canvas';
import { useToolValues } from '../../ui/hooks';
import { ImageDrop, type LoadedImage } from '../../ui/ImageDrop';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { canvasFrom, readPixels } from '../image/_shared';
import { defineCustomTool, type OptionDef, type Values } from '../types';
import { Segmented } from './_shared';

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;
const isText = (v: Values) => v.mode === 'text';
const isImage = (v: Values) => v.mode === 'image';

const DEFS: readonly OptionDef[] = [
  // Chosen with the buttons above the form; listed here so it is validated and remembered.
  { key: 'mode', label: 'Source', type: 'segmented', choices: ['text', 'image'], default: 'text', showIf: () => false },
  { key: 'text', label: 'Letters or emoji', type: 'text', default: 'B', showIf: isText },
  {
    key: 'font',
    label: 'Font',
    type: 'select',
    choices: [
      { value: 'sans', label: 'Sans-serif' },
      { value: 'serif', label: 'Serif' },
      { value: 'mono', label: 'Monospace' },
    ],
    default: 'sans',
    showIf: isText,
  },
  { key: 'weight', label: 'Weight', type: 'select', choices: ['400', '600', '700', '800', '900'], default: '800', showIf: isText },
  { key: 'textSize', label: 'Text size', type: 'range', min: 30, max: 100, step: 1, unit: '%', default: 72, showIf: isText },
  { key: 'textColor', label: 'Text colour', type: 'color', default: '#ffffff', showIf: isText },
  { key: 'background', label: 'Background', type: 'color', alpha: true, default: '#17694e', help: 'Make it fully transparent with the opacity slider for no background.' },
  { key: 'shape', label: 'Shape', type: 'segmented', choices: ['square', 'rounded', 'circle'], default: 'rounded' },
  { key: 'radius', label: 'Corner radius', type: 'range', min: 0, max: 50, step: 1, unit: '%', default: 22, showIf: (v: Values) => v.shape === 'rounded' },
  { key: 'padding', label: 'Padding', type: 'range', min: 0, max: 30, step: 1, unit: '%', default: 10 },
  { key: 'heading-transparency', label: 'Transparency', type: 'heading', showIf: isImage },
  { key: 'knockout', label: 'Make one colour transparent', type: 'toggle', default: false, showIf: isImage, help: 'For images with a solid background, such as a white box around a logo.' },
  { key: 'knockoutColor', label: 'Colour to remove', type: 'color', default: '#ffffff', showIf: (v: Values) => isImage(v) && v.knockout === true },
  { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 60, step: 1, unit: '%', default: 10, showIf: (v: Values) => isImage(v) && v.knockout === true },
  { key: 'heading-ico', label: 'Sizes inside the .ico', type: 'heading' },
  ...ICO_SIZES.map((size) => ({ key: `s${size}`, label: `${size} × ${size}`, type: 'toggle', default: size === 16 || size === 32 || size === 48 }) as OptionDef),
  { key: 'pngOnly', label: 'Store sizes as PNG', type: 'toggle', default: false, help: 'Smaller files, but software older than Windows Vista cannot read them. 256 px is always PNG.' },
  { key: 'heading-app', label: 'Web app manifest', type: 'heading' },
  { key: 'appName', label: 'App name', type: 'text', default: 'My site' },
  { key: 'themeColor', label: 'Theme colour', type: 'color', default: '#17694e' },
];

const FONTS: Record<string, string> = {
  sans: 'system-ui, "Segoe UI", Roboto, Ubuntu, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "Cascadia Code", Menlo, monospace',
};

function shapePath(context: CanvasRenderingContext2D, size: number, shape: string, radius: number): void {
  context.beginPath();
  if (shape === 'circle') context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  else if (shape === 'rounded') context.roundRect(0, 0, size, size, (radius / 100) * size);
  else context.rect(0, 0, size, size);
}

/** Halves the image repeatedly before the final resize: much cleaner than one big jump. */
function resample(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  let current = source;
  while (current.width / 2 >= width && current.height / 2 >= height) {
    const half = createCanvas(Math.max(1, Math.floor(current.width / 2)), Math.max(1, Math.floor(current.height / 2)));
    const context = context2d(half);
    context.imageSmoothingQuality = 'high';
    context.drawImage(current, 0, 0, half.width, half.height);
    current = half;
  }
  const out = createCanvas(width, height);
  const context = context2d(out);
  context.imageSmoothingQuality = 'high';
  context.drawImage(current, 0, 0, width, height);
  return out;
}

export function renderIcon(size: number, v: Values, source: HTMLCanvasElement | null, opaque = false): HTMLCanvasElement {
  const canvas = createCanvas(size, size);
  const context = context2d(canvas);
  if (opaque) {
    // Apple touch icons must not be transparent.
    const bg = toRgba(String(v.background));
    context.fillStyle = bg.a > 0 ? `rgb(${bg.r} ${bg.g} ${bg.b})` : '#ffffff';
    context.fillRect(0, 0, size, size);
  }
  shapePath(context, size, String(v.shape), Number(v.radius));
  context.fillStyle = String(v.background);
  context.fill();
  context.save();
  shapePath(context, size, String(v.shape), Number(v.radius));
  context.clip();
  const inset = (Number(v.padding) / 100) * size;
  const box = size - inset * 2;
  if (v.mode === 'text') {
    const text = String(v.text).trim() || '?';
    const fontSize = (Number(v.textSize) / 100) * box;
    context.font = `${v.weight} ${fontSize}px ${FONTS[String(v.font)] ?? FONTS.sans}`;
    context.fillStyle = String(v.textColor);
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    const metrics = context.measureText(text);
    const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.72;
    const descent = metrics.actualBoundingBoxDescent || 0;
    const scale = Math.min(1, box / Math.max(1, metrics.width));
    context.translate(size / 2, size / 2 + ((ascent - descent) / 2) * scale);
    context.scale(scale, scale);
    context.fillText(text, 0, 0);
  } else if (source) {
    const fit = Math.min(box / source.width, box / source.height);
    const w = Math.max(1, Math.round(source.width * fit));
    const h = Math.max(1, Math.round(source.height * fit));
    context.drawImage(resample(source, w, h), Math.round((size - w) / 2), Math.round((size - h) / 2));
  }
  context.restore();
  return canvas;
}

export function svgFavicon(v: Values): string {
  const bg = toRgba(String(v.background));
  const fill = bg.a > 0 ? ` fill="rgb(${bg.r} ${bg.g} ${bg.b})"${bg.a < 1 ? ` fill-opacity="${bg.a.toFixed(3)}"` : ''}` : ' fill="none"';
  const shape = v.shape === 'circle' ? `<circle cx="50" cy="50" r="50"${fill}/>` : `<rect width="100" height="100"${v.shape === 'rounded' ? ` rx="${v.radius}"` : ''}${fill}/>`;
  const size = (Number(v.textSize) / 100) * (100 - Number(v.padding) * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${shape}<text x="50" y="50" dy=".35em" text-anchor="middle" font-family='${FONTS[String(v.font)] ?? FONTS.sans}' font-weight="${v.weight}" font-size="${size.toFixed(1)}" fill="${escapeXml(String(v.textColor))}">${escapeXml(String(v.text).trim() || '?')}</text></svg>\n`;
}

async function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Uint8Array(await (await encodeCanvas(canvas, { format: 'png', quality: 100 })).arrayBuffer());
}

export function htmlTags(v: Values): string {
  return [
    '<link rel="icon" href="/favicon.ico" sizes="any">',
    ...(v.mode === 'text' ? ['<link rel="icon" href="/favicon.svg" type="image/svg+xml">'] : []),
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    `<meta name="theme-color" content="${escapeXml(String(v.themeColor))}">`,
  ].join('\n');
}

export function manifest(v: Values): string {
  const name = String(v.appName).trim() || 'My site';
  const bg = toRgba(String(v.background));
  return `${JSON.stringify(
    {
      name,
      short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
      icons: [
        { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: String(v.themeColor),
      background_color: bg.a > 0 ? `#${[bg.r, bg.g, bg.b].map((c) => c.toString(16).padStart(2, '0')).join('')}` : '#ffffff',
      display: 'standalone',
    },
    null,
    2,
  )}\n`;
}

function Favicon({ toolId }: { toolId: string }) {
  const [values, patch, reset] = useToolValues(toolId, DEFS);
  const mode: 'image' | 'text' = values.mode === 'image' ? 'image' : 'text';
  const [image, setImage] = useState<LoadedImage | null>(null);
  const v = values;
  const previews = useRef<HTMLDivElement>(null);

  const prepared = useMemo(() => {
    if (!image) return null;
    const small = downscale(image.canvas, 1024).canvas;
    if (!v.knockout) return small;
    const { pixels } = replaceColor(readPixels(small), { from: toRgba(String(v.knockoutColor)), to: { r: 0, g: 0, b: 0, a: 0 }, tolerance: Number(v.tolerance), feather: 4, swap: false });
    return canvasFrom(pixels, small.width, small.height);
  }, [image, v.knockout, v.knockoutColor, v.tolerance]);

  const source = mode === 'image' ? prepared : null;
  const ready = mode === 'text' || source !== null;
  const icoSizes = ICO_SIZES.filter((size) => v[`s${size}`] === true);

  useEffect(() => {
    const host = previews.current;
    if (!host || !ready) return;
    const items = [16, 32, 48, 64, 180].map((size) => {
      const figure = document.createElement('figure');
      figure.className = 'favicon-preview';
      const canvas = renderIcon(size * 2, v, source);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      const caption = document.createElement('figcaption');
      caption.textContent = `${size} px`;
      figure.append(canvas, caption);
      return figure;
    });
    host.replaceChildren(...items);
  }, [v, source, ready]);

  const tabIcon = useMemo(() => (ready ? renderIcon(32, v, source).toDataURL('image/png') : ''), [v, source, ready]);

  const saveIco = () =>
    attempt(async () => {
      if (icoSizes.length === 0) throw new Error('Turn on at least one size for the .ico file.');
      const images = await Promise.all(
        icoSizes.map(async (size) => {
          const canvas = renderIcon(size, v, source);
          return { size, rgba: context2d(canvas, true).getImageData(0, 0, size, size).data, png: await pngBytes(canvas) };
        }),
      );
      const saved = await saveFile('favicon.ico', encodeIco(images, { pngOnly: v.pngOnly === true }), 'image/x-icon');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });

  const saveZip = () =>
    attempt(async () => {
      const files: Record<string, Uint8Array> = {};
      const sizes = icoSizes.length > 0 ? icoSizes : [16, 32, 48];
      const icoImages = await Promise.all(
        sizes.map(async (size) => {
          const canvas = renderIcon(size, v, source);
          return { size, rgba: context2d(canvas, true).getImageData(0, 0, size, size).data, png: await pngBytes(canvas) };
        }),
      );
      files['favicon.ico'] = encodeIco(icoImages, { pngOnly: v.pngOnly === true });
      files['favicon-16x16.png'] = await pngBytes(renderIcon(16, v, source));
      files['favicon-32x32.png'] = await pngBytes(renderIcon(32, v, source));
      files['apple-touch-icon.png'] = await pngBytes(renderIcon(180, v, source, true));
      files['android-chrome-192x192.png'] = await pngBytes(renderIcon(192, v, source));
      files['android-chrome-512x512.png'] = await pngBytes(renderIcon(512, v, source));
      const encoder = new TextEncoder();
      files['site.webmanifest'] = encoder.encode(manifest(v));
      files['favicon-tags.html'] = encoder.encode(`${htmlTags(v)}\n`);
      if (mode === 'text') files['favicon.svg'] = encoder.encode(svgFavicon(v));
      const saved = await saveFile('favicons.zip', zipSync(files, { level: 6 }), 'application/zip');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });

  return (
    <section class="tool layout-form" data-testid="tool" data-state={ready ? 'done' : 'idle'}>
      <aside class="tool-side">
        <div class="tool-options">
          <Segmented
            label="Source"
            small={false}
            value={mode}
            onChange={(next) => patch({ mode: next })}
            choices={[
              { value: 'text', label: 'Letters or emoji' },
              { value: 'image', label: 'Image' },
            ]}
          />
          <ControlsForm defs={DEFS} values={v} onChange={patch} layout="panel" idPrefix="favicon" />
          <div class="tool-options-actions">
            <button type="button" class="button button-quiet" onClick={reset}>
              Reset options
            </button>
          </div>
        </div>
      </aside>
      <div class="tool-main">
        {mode === 'image' && <ImageDrop image={image} onImage={setImage} hint="PNG, SVG, JPEG, WebP or ICO. Square images with some empty space work best." />}
        {ready && (
          <>
            <div class="pane favicon-pane">
              <div class="pane-header">
                <span class="pane-title">Preview</span>
                <div class="pane-actions">
                  <button type="button" class="button button-small button-primary" onClick={saveIco} data-testid="save-ico">
                    <Icon name="save" size={14} />
                    favicon.ico
                  </button>
                  <button type="button" class="button button-small" onClick={saveZip}>
                    <Icon name="save" size={14} />
                    All icons (.zip)
                  </button>
                </div>
              </div>
              <div class="favicon-body">
                <div class="favicon-tab" aria-hidden="true">
                  <img src={tabIcon} alt="" width={16} height={16} />
                  <span>{String(v.appName).trim() || 'My site'}</span>
                  <Icon name="close" size={12} />
                </div>
                <div class="favicon-strips">
                  <div class="favicon-strip favicon-strip-light" ref={previews} data-testid="favicon-previews" />
                </div>
                <p class="control-help">The .ico will contain: {icoSizes.length > 0 ? icoSizes.map((size) => `${size}`).join(', ') : 'no sizes'} px.</p>
              </div>
            </div>
            <CodeOutput
              baseName="favicon"
              outputs={[
                { label: 'HTML', language: 'html', code: `${htmlTags(v)}\n` },
                { label: 'site.webmanifest', language: 'json', code: manifest(v), filename: 'site.webmanifest' },
                ...(mode === 'text' ? [{ label: 'favicon.svg', language: 'xml' as const, code: svgFavicon(v), filename: 'favicon.svg' }] : []),
              ]}
            />
          </>
        )}
      </div>
    </section>
  );
}

export default defineCustomTool(Favicon);
