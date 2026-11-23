/**
 * App Icon Maker: one picture or a few letters become every launcher icon a
 * mobile app needs: Android adaptive layers, legacy and round icons, themed
 * (monochrome) and notification icons; the iOS icon with dark and tinted
 * variants; KaiOS icons; web manifest icons; and the store icons.
 */
import { zipSync } from 'fflate';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ADAPTIVE_DP,
  ANDROID_DENSITIES,
  APPLE_TOUCH,
  adaptiveIconXml,
  androidPx,
  backgroundColorXml,
  IOS_SIZE,
  iosContentsJson,
  KAIOS_SIZES,
  kaiosIconsJson,
  LEGACY_DP,
  NOTIFICATION_DP,
  PLAY_STORE_SIZE,
  resourceName,
  SAFE_ZONE_DP,
  webManifestIcons,
} from '../../lib/app-icon-sizes';
import { saveFile } from '../../platform';
import { context2d, createCanvas } from '../../ui/canvas';
import { ImageDrop, type LoadedImage } from '../../ui/ImageDrop';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { drawContain, type Fill, fitText, greyscale, imageElement, type MaskShape, paintFill, pngBytes, shapePath, silhouette, trimTransparent } from './_draw';
import { type SegmentChoice, Segmented, usePersistentState } from './_shared';

type Source = 'text' | 'image';
type Platform = 'android' | 'ios' | 'kaios' | 'web' | 'notification';

interface Design {
  readonly source: Source;
  readonly text: string;
  readonly textColor: string;
  readonly font: 'sans' | 'serif' | 'mono';
  readonly fill: 'solid' | 'gradient';
  readonly color1: string;
  readonly color2: string;
  readonly angle: number;
  /** Artwork size as a percentage of the 66 dp safe zone. */
  readonly scale: number;
  readonly trim: boolean;
  readonly shape: 'circle' | 'rounded';
  readonly name: string;
  readonly platforms: readonly Platform[];
}

const INITIAL: Design = {
  source: 'text',
  text: 'Bt',
  textColor: '#ffffff',
  font: 'sans',
  fill: 'gradient',
  color1: '#0b6e4f',
  color2: '#14a06f',
  angle: 135,
  scale: 70,
  trim: true,
  shape: 'rounded',
  name: 'ic_launcher',
  platforms: ['android', 'ios', 'kaios', 'web', 'notification'],
};

const PLATFORMS: readonly { readonly id: Platform; readonly label: string }[] = [
  { id: 'android', label: 'Android (adaptive, legacy, round, Play Store)' },
  { id: 'ios', label: 'iOS and iPadOS (with dark and tinted)' },
  { id: 'kaios', label: 'KaiOS (56, 84 and 112 px)' },
  { id: 'web', label: 'Web app manifest and Apple touch icon' },
  { id: 'notification', label: 'Android notification icons' },
];

const FAMILIES: Record<Design['font'], string> = {
  sans: '"Barlow", "Benchtop Sans", system-ui, sans-serif',
  serif: 'Georgia, "Noto Serif", "Benchtop Sans", serif',
  mono: '"JetBrains Mono Variable", ui-monospace, monospace',
};

const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

function readDesign(stored: Values | undefined): Design {
  if (!stored) return INITIAL;
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const platforms = Array.isArray(stored.platforms) ? (stored.platforms as unknown[]).filter((p): p is Platform => PLATFORMS.some((x) => x.id === p)) : INITIAL.platforms;
  return {
    source: pick(stored.source, ['text', 'image'], INITIAL.source),
    text: typeof stored.text === 'string' ? stored.text.slice(0, 4) : INITIAL.text,
    textColor: isHex(stored.textColor) ? stored.textColor : INITIAL.textColor,
    font: pick(stored.font, ['sans', 'serif', 'mono'], INITIAL.font),
    fill: pick(stored.fill, ['solid', 'gradient'], INITIAL.fill),
    color1: isHex(stored.color1) ? stored.color1 : INITIAL.color1,
    color2: isHex(stored.color2) ? stored.color2 : INITIAL.color2,
    angle: typeof stored.angle === 'number' && Number.isFinite(stored.angle) ? stored.angle : INITIAL.angle,
    scale: typeof stored.scale === 'number' && stored.scale >= 30 && stored.scale <= 140 ? stored.scale : INITIAL.scale,
    trim: stored.trim !== false,
    shape: pick(stored.shape, ['circle', 'rounded'], INITIAL.shape),
    name: typeof stored.name === 'string' ? stored.name.slice(0, 40) : INITIAL.name,
    platforms,
  };
}

/* ---------------------------------------------------------------- drawing -- */

/** The artwork as a transparent picture, at most `edge` pixels on its long side. */
async function makeArt(design: Design, image: LoadedImage | null, edge = 1024): Promise<HTMLCanvasElement | null> {
  if (design.source === 'image') {
    if (!image) return null;
    const isSvg = image.type === 'image/svg+xml' || /\.svg$/i.test(image.name);
    const source = isSvg ? await imageElement(image.file) : image.canvas;
    const w = source instanceof HTMLImageElement ? source.naturalWidth || 512 : source.width;
    const h = source instanceof HTMLImageElement ? source.naturalHeight || 512 : source.height;
    const scale = isSvg ? edge / Math.max(w, h) : Math.min(1, edge / Math.max(w, h));
    const canvas = createCanvas(w * scale, h * scale);
    drawContain(context2d(canvas), source, 0, 0, canvas.width, canvas.height);
    return design.trim ? trimTransparent(canvas) : canvas;
  }
  const text = design.text.trim() || 'A';
  const canvas = createCanvas(edge, edge);
  const context = context2d(canvas);
  const family = FAMILIES[design.font];
  try {
    await document.fonts.load(`700 64px ${family}`, text);
  } catch {
    // A fallback font still draws.
  }
  const size = fitText(context, text, family, 700, edge * 0.96, edge * 0.8);
  context.font = `700 ${size}px ${family}`;
  context.fillStyle = design.textColor;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  const m = context.measureText(text);
  const ascent = m.actualBoundingBoxAscent || size * 0.72;
  const descent = m.actualBoundingBoxDescent || 0;
  context.fillText(text, edge / 2, edge / 2 + (ascent - descent) / 2);
  return trimTransparent(canvas);
}

type Kind = 'foreground' | 'background' | 'monochrome' | 'full' | 'legacy' | 'round' | 'kaios' | 'notification' | 'web' | 'dark' | 'tinted';

const fillOf = (design: Design): Fill => ({ kind: design.fill, color1: design.color1, color2: design.color2, angle: design.angle });

/** Draws the artwork centred in a square box `box` pixels wide. */
function placeArt(context: CanvasRenderingContext2D, art: HTMLCanvasElement | null, cx: number, cy: number, box: number): void {
  if (!art || box <= 0) return;
  drawContain(context, art, cx - box / 2, cy - box / 2, box, box);
}

function render(design: Design, art: HTMLCanvasElement | null, kind: Kind, size: number): HTMLCanvasElement {
  const canvas = createCanvas(size, size);
  const context = context2d(canvas);
  const fill = fillOf(design);
  // The artwork's share of a 108 dp adaptive layer, and of the part of an icon people see
  // (launchers show the middle 72 dp of the layers; stores and iOS show the whole square).
  const share = (SAFE_ZONE_DP / ADAPTIVE_DP) * (design.scale / 100);
  const visible = (SAFE_ZONE_DP / 72) * (design.scale / 100);
  const c = size / 2;
  switch (kind) {
    case 'foreground':
      placeArt(context, art, c, c, size * share);
      break;
    case 'background':
      paintFill(context, fill, 0, 0, size, size);
      break;
    case 'monochrome':
    case 'notification': {
      const layer = render(design, art, 'foreground', size);
      if (kind === 'monochrome') return silhouette(layer, '#ffffff');
      // Notification icons fill the 20 dp live area of the 24 dp square.
      const notice = createCanvas(size, size);
      if (art) placeArt(context2d(notice), silhouette(art, '#ffffff'), c, c, (size * 20) / NOTIFICATION_DP);
      return notice;
    }
    case 'full':
    case 'web':
    case 'dark':
    case 'tinted': {
      if (kind === 'web') {
        shapePath(context, 'rounded', 0, 0, size);
        context.clip();
      }
      if (kind === 'tinted') {
        context.fillStyle = '#000000';
        context.fillRect(0, 0, size, size);
        if (art) placeArt(context, greyscale(art), c, c, size * visible);
        break;
      }
      if (kind !== 'dark') paintFill(context, fill, 0, 0, size, size);
      placeArt(context, art, c, c, size * visible);
      break;
    }
    case 'legacy':
    case 'round':
    case 'kaios': {
      // Legacy icons sit in a 44 dp shape inside 48 dp; KaiOS asks for about 20% space around and a soft shadow.
      const side = kind === 'kaios' ? size * 0.8 : (size * 44) / LEGACY_DP;
      const offset = (size - side) / 2;
      const shape: MaskShape = kind === 'round' ? 'circle' : design.shape === 'circle' ? 'circle' : 'rounded';
      context.save();
      context.shadowColor = 'rgba(0, 0, 0, 0.3)';
      context.shadowBlur = size * 0.04;
      context.shadowOffsetY = size * 0.02;
      shapePath(context, shape, offset, offset, side);
      context.fillStyle = design.color1;
      context.fill();
      context.restore();
      context.save();
      shapePath(context, shape, offset, offset, side);
      context.clip();
      paintFill(context, fill, offset, offset, side, side);
      placeArt(context, art, c, c, side * visible);
      context.restore();
      break;
    }
  }
  return canvas;
}

/** An adaptive icon as a launcher would show it: background and foreground, cut to a shape. */
function masked(design: Design, art: HTMLCanvasElement | null, shape: MaskShape, size: number, themed?: { readonly bg: string; readonly fg: string }): HTMLCanvasElement {
  // The visible part is the middle 72 dp of the 108 dp layers.
  const layer = Math.round((size * ADAPTIVE_DP) / 72);
  const inset = (layer - size) / 2;
  const canvas = createCanvas(size, size);
  const context = context2d(canvas);
  shapePath(context, shape, 0, 0, size);
  context.clip();
  if (themed) {
    context.fillStyle = themed.bg;
    context.fillRect(0, 0, size, size);
    context.drawImage(silhouette(render(design, art, 'foreground', layer), themed.fg), -inset, -inset);
  } else {
    context.drawImage(render(design, art, 'background', layer), -inset, -inset);
    context.drawImage(render(design, art, 'foreground', layer), -inset, -inset);
  }
  return canvas;
}

/** How iOS shows a tinted icon: the grey artwork multiplied by the chosen tint. */
function tint(canvas: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const out = createCanvas(canvas.width, canvas.height);
  const context = context2d(out);
  context.drawImage(canvas, 0, 0);
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = color;
  context.fillRect(0, 0, out.width, out.height);
  return out;
}

/** A copy cut to a shape, optionally over a backdrop (for previews). */
function clipTo(canvas: HTMLCanvasElement, shape: MaskShape, backdrop?: readonly [string, string]): HTMLCanvasElement {
  const out = createCanvas(canvas.width, canvas.height);
  const context = context2d(out);
  shapePath(context, shape, 0, 0, out.width);
  context.clip();
  if (backdrop) paintFill(context, { kind: 'gradient', color1: backdrop[0], color2: backdrop[1], angle: 90 }, 0, 0, out.width, out.height);
  context.drawImage(canvas, 0, 0);
  return out;
}

/* ---------------------------------------------------------------- the ZIP -- */

async function buildZip(design: Design, art: HTMLCanvasElement | null): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const text = (value: string) => new TextEncoder().encode(value);
  const name = resourceName(design.name);
  const on = (p: Platform) => design.platforms.includes(p);
  const readme: string[] = ['Icons made with Benchtop’s App Icon Maker.', ''];

  if (on('android')) {
    const solid = design.fill === 'solid';
    files[`android/res/mipmap-anydpi-v26/${name}.xml`] = text(adaptiveIconXml(name, solid ? 'color' : 'mipmap'));
    files[`android/res/mipmap-anydpi-v26/${name}_round.xml`] = text(adaptiveIconXml(name, solid ? 'color' : 'mipmap'));
    if (solid) files[`android/res/values/${name}_background.xml`] = text(backgroundColorXml(name, design.color1));
    for (const d of ANDROID_DENSITIES) {
      const dir = `android/res/mipmap-${d.name}`;
      files[`${dir}/${name}.png`] = await pngBytes(render(design, art, 'legacy', androidPx(LEGACY_DP, d)));
      files[`${dir}/${name}_round.png`] = await pngBytes(render(design, art, 'round', androidPx(LEGACY_DP, d)));
      files[`${dir}/${name}_foreground.png`] = await pngBytes(render(design, art, 'foreground', androidPx(ADAPTIVE_DP, d)));
      files[`${dir}/${name}_monochrome.png`] = await pngBytes(render(design, art, 'monochrome', androidPx(ADAPTIVE_DP, d)));
      if (!solid) files[`${dir}/${name}_background.png`] = await pngBytes(render(design, art, 'background', androidPx(ADAPTIVE_DP, d)));
    }
    files['android/play_store_512.png'] = await pngBytes(render(design, art, 'full', PLAY_STORE_SIZE));
    readme.push(
      'android/res: copy the folders into app/src/main/res. The manifest uses android:icon="@mipmap/' + name + '" and android:roundIcon="@mipmap/' + name + '_round".',
      'android/play_store_512.png: the Play Console store-listing icon (Google Play adds the rounded corners).',
      '',
    );
  }
  if (on('notification')) {
    const stat = `ic_stat_${name.replace(/^ic_/, '')}`;
    for (const d of ANDROID_DENSITIES) files[`android/res/drawable-${d.name}/${stat}.png`] = await pngBytes(render(design, art, 'notification', androidPx(NOTIFICATION_DP, d)));
    readme.push(`android/res/drawable-*/${stat}.png: white status-bar icons for NotificationCompat.Builder.setSmallIcon(R.drawable.${stat}).`, '');
  }
  if (on('ios')) {
    const dir = 'ios/AppIcon.appiconset';
    files[`${dir}/AppIcon-1024.png`] = await pngBytes(render(design, art, 'full', IOS_SIZE));
    files[`${dir}/AppIcon-1024-dark.png`] = await pngBytes(render(design, art, 'dark', IOS_SIZE));
    files[`${dir}/AppIcon-1024-tinted.png`] = await pngBytes(render(design, art, 'tinted', IOS_SIZE));
    files[`${dir}/Contents.json`] = text(iosContentsJson('AppIcon-1024.png', 'AppIcon-1024-dark.png', 'AppIcon-1024-tinted.png'));
    files['ios/icon-composer/foreground.png'] = await pngBytes(render(design, art, 'foreground', IOS_SIZE));
    files['ios/icon-composer/background.png'] = await pngBytes(render(design, art, 'background', IOS_SIZE));
    readme.push(
      'ios/AppIcon.appiconset: replace the AppIcon set in Assets.xcassets (Xcode 16 or later; one 1024 px icon with dark and tinted appearances).',
      'ios/icon-composer: the foreground and background as separate layers, ready to import into Apple’s Icon Composer for a Liquid Glass icon.',
      '',
    );
  }
  if (on('kaios')) {
    for (const size of KAIOS_SIZES) files[`kaios/icons/icon-${size}.png`] = await pngBytes(render(design, art, 'kaios', size));
    files['kaios/manifest-icons.json'] = text(kaiosIconsJson());
    readme.push('kaios/icons: 56 and 112 px for the KaiStore and launcher, 84 px for the JioStore; add them to manifest.webapp as in manifest-icons.json.', '');
  }
  if (on('web')) {
    for (const size of [192, 512]) files[`web/icon-${size}.png`] = await pngBytes(render(design, art, 'web', size));
    files['web/icon-maskable-512.png'] = await pngBytes(render(design, art, 'full', 512));
    files['web/apple-touch-icon.png'] = await pngBytes(render(design, art, 'full', APPLE_TOUCH));
    files['web/manifest-icons.json'] = text(webManifestIcons('/'));
    readme.push('web: icons for manifest.webmanifest (see manifest-icons.json) and <link rel="apple-touch-icon" href="/apple-touch-icon.png">.', '');
  }
  files['README.txt'] = text(`${readme.join('\n')}\n`);
  return zipSync(files, { level: 6 });
}

/* -------------------------------------------------------------------- UI -- */

function Preview({ canvas, label, size, dark }: { canvas: HTMLCanvasElement; label: string; size: number; dark?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    target.width = canvas.width;
    target.height = canvas.height;
    const context = target.getContext('2d');
    context?.clearRect(0, 0, target.width, target.height);
    context?.drawImage(canvas, 0, 0);
  }, [canvas]);
  return (
    <figure class={`icon-preview${dark ? ' is-dark' : ''}`}>
      <canvas ref={ref} style={{ width: `${size}px`, height: `${size}px` }} role="img" aria-label={label} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

const SOURCES: readonly SegmentChoice<Source>[] = [
  { value: 'text', label: 'Letters' },
  { value: 'image', label: 'Picture' },
];
const FILLS: readonly SegmentChoice<Design['fill']>[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
];
const SHAPES: readonly SegmentChoice<Design['shape']>[] = [
  { value: 'rounded', label: 'Rounded square' },
  { value: 'circle', label: 'Circle' },
];

function AppIcons({ toolId }: { toolId: string }) {
  const [design, setDesign] = usePersistentState(toolId, readDesign, (d: Design): Values => ({ ...d }));
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [art, setArt] = useState<HTMLCanvasElement | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Design>) => setDesign((d) => ({ ...d, ...patch }));

  useEffect(() => {
    let live = true;
    makeArt(design, image).then(
      (canvas) => {
        if (live) setArt(canvas);
      },
      () => {
        if (live) setArt(null);
      },
    );
    return () => {
      live = false;
    };
  }, [design.source, design.text, design.textColor, design.font, design.trim, image]);

  const ratio = Math.min(2, Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  const previews = useMemo(() => {
    const px = (n: number) => Math.round(n * ratio);
    return {
      android: (['circle', 'squircle', 'rounded', 'teardrop'] as const).map((shape) => ({ shape, canvas: masked(design, art, shape, px(64)) })),
      themed: masked(design, art, 'circle', px(64), { bg: '#d7e8cd', fg: '#233428' }),
      themedDark: masked(design, art, 'circle', px(64), { bg: '#2d3b31', fg: '#bfe0c3' }),
      ios: clipTo(render(design, art, 'full', px(64)), 'squircle'),
      iosDark: clipTo(render(design, art, 'dark', px(64)), 'squircle', ['#3a3a3c', '#111113']),
      iosTinted: clipTo(tint(render(design, art, 'tinted', px(64)), '#ffb340'), 'squircle'),
      kaios56: render(design, art, 'kaios', 56),
      kaios112: render(design, art, 'kaios', px(112)),
      notification: render(design, art, 'notification', px(24)),
      play: clipTo(render(design, art, 'full', px(96)), 'rounded'),
    };
  }, [design, art, ratio]);

  const save = () =>
    attempt(async () => {
      if (design.source === 'image' && !art) throw new Error('Choose a picture first, or switch to letters.');
      if (design.platforms.length === 0) throw new Error('Choose at least one platform.');
      setBusy(true);
      try {
        const zip = await buildZip(design, art);
        const result = await saveFile(`${resourceName(design.name)}-icons.zip`, zip, 'application/zip');
        if (result.saved) notify(`Saved to ${result.location}`);
      } finally {
        setBusy(false);
      }
    });

  return (
    <section class="tool icon-tool" data-testid="tool" data-state={design.source === 'image' && !art ? 'idle' : 'done'}>
      <div class="icon-grid">
        <div class="icon-controls">
          <div class="control">
            <span class="control-label">Artwork</span>
            <Segmented label="Artwork" value={design.source} choices={SOURCES} onChange={(source) => set({ source })} />
          </div>
          {design.source === 'image' ? (
            <>
              <ImageDrop image={image} onImage={setImage} hint="PNG with transparency or SVG work best. Nothing leaves this computer." />
              <label class="toggle">
                <input type="checkbox" checked={design.trim} onChange={(e) => set({ trim: e.currentTarget.checked })} />
                <span class="toggle-track" aria-hidden="true" />
                Trim empty edges
              </label>
            </>
          ) : (
            <div class="icon-row">
              <label class="control">
                <span class="control-label">Letters or emoji</span>
                <input class="input icon-text" type="text" maxLength={4} value={design.text} onInput={(e) => set({ text: e.currentTarget.value })} data-testid="icon-text" />
              </label>
              <label class="control">
                <span class="control-label">Colour</span>
                <input class="color-swatch" type="color" value={design.textColor} onInput={(e) => set({ textColor: e.currentTarget.value })} />
              </label>
              <label class="control">
                <span class="control-label">Typeface</span>
                <select class="input" value={design.font} onChange={(e) => set({ font: e.currentTarget.value as Design['font'] })}>
                  <option value="sans">Sans</option>
                  <option value="serif">Serif</option>
                  <option value="mono">Monospace</option>
                </select>
              </label>
            </div>
          )}
          <div class="icon-row">
            <div class="control">
              <span class="control-label">Background</span>
              <Segmented label="Background" value={design.fill} choices={FILLS} onChange={(fill) => set({ fill })} />
            </div>
            <label class="control">
              <span class="control-label">{design.fill === 'gradient' ? 'From' : 'Colour'}</span>
              <input class="color-swatch" type="color" value={design.color1} onInput={(e) => set({ color1: e.currentTarget.value })} data-testid="icon-color" />
            </label>
            {design.fill === 'gradient' && (
              <>
                <label class="control">
                  <span class="control-label">To</span>
                  <input class="color-swatch" type="color" value={design.color2} onInput={(e) => set({ color2: e.currentTarget.value })} />
                </label>
                <label class="control">
                  <span class="control-label">Angle {design.angle}°</span>
                  <input class="range" type="range" min={0} max={360} step={15} value={design.angle} onInput={(e) => set({ angle: Number(e.currentTarget.value) })} />
                </label>
              </>
            )}
          </div>
          <label class="control">
            <span class="control-label">Artwork size: {design.scale}% of the safe zone</span>
            <input class="range" type="range" min={30} max={140} step={5} value={design.scale} onInput={(e) => set({ scale: Number(e.currentTarget.value) })} data-testid="icon-scale" />
            <span class="control-help">Above 100% the edges can be cut off by round launcher masks.</span>
          </label>
          <div class="icon-row">
            <div class="control">
              <span class="control-label">Shape for legacy and KaiOS icons</span>
              <Segmented label="Shape for legacy and KaiOS icons" value={design.shape} choices={SHAPES} onChange={(shape) => set({ shape })} />
            </div>
            <label class="control">
              <span class="control-label">Android resource name</span>
              <input class="input" type="text" value={design.name} onInput={(e) => set({ name: e.currentTarget.value })} />
            </label>
          </div>
          <fieldset class="icon-platforms">
            <legend>Include</legend>
            {PLATFORMS.map((p) => (
              <label class="toggle" key={p.id}>
                <input
                  type="checkbox"
                  checked={design.platforms.includes(p.id)}
                  onChange={(e) => set({ platforms: e.currentTarget.checked ? [...design.platforms, p.id] : design.platforms.filter((x) => x !== p.id) })}
                />
                <span class="toggle-track" aria-hidden="true" />
                {p.label}
              </label>
            ))}
          </fieldset>
          <div class="button-row">
            <button type="button" class="button button-primary" onClick={save} disabled={busy} data-testid="icon-save">
              <Icon name="save" size={16} /> {busy ? 'Making icons…' : 'Save all icons (ZIP)'}
            </button>
          </div>
        </div>

        <div class="icon-previews" data-testid="icon-previews">
          <h3>Android launchers</h3>
          <div class="icon-wall android-wall">
            {previews.android.map((p) => (
              <Preview key={p.shape} canvas={p.canvas} label={p.shape === 'rounded' ? 'Rounded square' : p.shape[0]?.toUpperCase() + p.shape.slice(1)} size={64} />
            ))}
            <Preview canvas={previews.themed} label="Themed" size={64} />
            <Preview canvas={previews.themedDark} label="Themed, dark" size={64} dark />
          </div>
          <h3>iPhone and iPad</h3>
          <div class="icon-wall ios-wall">
            <Preview canvas={previews.ios} label="Default" size={64} />
            <Preview canvas={previews.iosDark} label="Dark" size={64} dark />
            <Preview canvas={previews.iosTinted} label="Tinted" size={64} dark />
          </div>
          <p class="control-help">iOS 26 adds Liquid Glass light, dark, clear and tinted looks; the ZIP also holds the layers for Apple’s Icon Composer.</p>
          <h3>KaiOS and notifications</h3>
          <div class="icon-wall kaios-wall">
            <Preview canvas={previews.kaios56} label="KaiOS 56 px" size={56} dark />
            <Preview canvas={previews.kaios112} label="KaiOS 112 px" size={112} dark />
            <Preview canvas={previews.notification} label="Status bar" size={24} dark />
            <Preview canvas={previews.play} label="Play Store" size={96} />
          </div>
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(AppIcons);
