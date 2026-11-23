/**
 * Store Graphics Maker: App Store and Google Play screenshots with a caption
 * and a plain phone frame, the Play feature graphic, and KaiStore assets.
 */
import { zipSync } from 'fflate';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { pickFile, saveFile } from '../../platform';
import { context2d, createCanvas, loadImage } from '../../ui/canvas';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { FONTS, fontFor, ready, wrap } from '../image/_text';
import { defineCustomTool, type Values } from '../types';
import { drawContain, drawCover, flatten, jpegBytes, paintFill, pngBytes, roundedRect } from './_draw';
import { isImageFile, MultiDrop } from './_files';
import { type SegmentChoice, Segmented, usePersistentState } from './_shared';

interface Target {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly layout: 'screenshot' | 'banner' | 'raw';
  readonly format: 'png' | 'jpeg';
  readonly note: string;
}

export const TARGETS: readonly Target[] = [
  {
    id: 'ios-69',
    label: 'App Store, iPhone 6.9″ (1320 × 2868)',
    width: 1320,
    height: 2868,
    layout: 'screenshot',
    format: 'png',
    note: 'The size App Store Connect asks for first; it scales these down for smaller iPhones.',
  },
  { id: 'ios-65', label: 'App Store, iPhone 6.5″ (1284 × 2778)', width: 1284, height: 2778, layout: 'screenshot', format: 'png', note: 'Use when you do not supply the 6.9″ set.' },
  { id: 'ipad-13', label: 'App Store, iPad 13″ (2064 × 2752)', width: 2064, height: 2752, layout: 'screenshot', format: 'png', note: 'Needed when the app runs on iPad.' },
  {
    id: 'play-phone',
    label: 'Google Play, phone (1080 × 1920)',
    width: 1080,
    height: 1920,
    layout: 'screenshot',
    format: 'png',
    note: 'Google Play needs at least two screenshots, without transparency.',
  },
  { id: 'play-tablet', label: 'Google Play, tablet (1440 × 2560)', width: 1440, height: 2560, layout: 'screenshot', format: 'png', note: 'For the 7″ and 10″ tablet slots.' },
  { id: 'play-feature', label: 'Google Play feature graphic (1024 × 500)', width: 1024, height: 500, layout: 'banner', format: 'png', note: 'Required to publish on Google Play.' },
  { id: 'kai-shot', label: 'KaiStore screenshot (240 × 320)', width: 240, height: 320, layout: 'raw', format: 'png', note: 'Up to five, the bare screen without notifications or frames.' },
  { id: 'kai-banner', label: 'KaiStore marketing banner (240 × 130)', width: 240, height: 130, layout: 'banner', format: 'jpeg', note: 'A JPEG under 100 KB; the same banner is used everywhere.' },
];

interface Shot {
  readonly id: number;
  readonly name: string;
  readonly canvas: HTMLCanvasElement;
  readonly url: string;
  readonly caption: string;
}

interface Design {
  readonly target: string;
  readonly fill: 'solid' | 'gradient';
  readonly color1: string;
  readonly color2: string;
  readonly angle: number;
  readonly textColor: string;
  readonly font: string;
  readonly captionSize: number;
  readonly position: 'top' | 'bottom';
  readonly frame: boolean;
  readonly frameColor: string;
  readonly cutout: boolean;
  readonly title: string;
  readonly tagline: string;
}

const INITIAL: Design = {
  target: 'ios-69',
  fill: 'gradient',
  color1: '#0b3d2e',
  color2: '#14a06f',
  angle: 90,
  textColor: '#ffffff',
  font: 'sans',
  captionSize: 100,
  position: 'top',
  frame: true,
  frameColor: '#111111',
  cutout: true,
  title: 'Benchtop',
  tagline: 'Every tool, on your own computer',
};

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function readDesign(stored: Values | undefined): Design {
  if (!stored) return INITIAL;
  return {
    target: TARGETS.some((t) => t.id === stored.target) ? (stored.target as string) : INITIAL.target,
    fill: stored.fill === 'solid' ? 'solid' : 'gradient',
    color1: isHex(stored.color1) ? stored.color1 : INITIAL.color1,
    color2: isHex(stored.color2) ? stored.color2 : INITIAL.color2,
    angle: typeof stored.angle === 'number' ? stored.angle : INITIAL.angle,
    textColor: isHex(stored.textColor) ? stored.textColor : INITIAL.textColor,
    font: FONTS.some((f) => f.value === stored.font) ? (stored.font as string) : INITIAL.font,
    captionSize: typeof stored.captionSize === 'number' ? Math.min(160, Math.max(50, stored.captionSize)) : INITIAL.captionSize,
    position: stored.position === 'bottom' ? 'bottom' : 'top',
    frame: stored.frame !== false,
    frameColor: isHex(stored.frameColor) ? stored.frameColor : INITIAL.frameColor,
    cutout: stored.cutout !== false,
    title: typeof stored.title === 'string' ? stored.title.slice(0, 80) : INITIAL.title,
    tagline: typeof stored.tagline === 'string' ? stored.tagline.slice(0, 120) : INITIAL.tagline,
  };
}

/** A plain, unbranded phone with the screenshot on its screen. */
function drawPhone(context: CanvasRenderingContext2D, screen: HTMLCanvasElement | null, x: number, y: number, w: number, h: number, design: Design): void {
  const bezel = design.frame ? w * 0.035 : 0;
  const radius = w * 0.13;
  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = w * 0.06;
  context.shadowOffsetY = w * 0.025;
  roundedRect(context, x, y, w, h, radius);
  context.fillStyle = design.frame ? design.frameColor : '#000000';
  context.fill();
  context.restore();
  const sx = x + bezel;
  const sy = y + bezel;
  const sw = w - bezel * 2;
  const sh = h - bezel * 2;
  context.save();
  roundedRect(context, sx, sy, sw, sh, Math.max(radius - bezel, 0));
  context.clip();
  context.fillStyle = '#ffffff';
  context.fillRect(sx, sy, sw, sh);
  if (screen) drawCover(context, screen, sx, sy, sw, sh, 0.5, 0);
  context.restore();
  if (design.frame && design.cutout) {
    const pillW = sw * 0.3;
    const pillH = sw * 0.085;
    roundedRect(context, x + (w - pillW) / 2, sy + sw * 0.03, pillW, pillH, pillH / 2);
    context.fillStyle = '#000000';
    context.fill();
  }
}

function drawCaption(context: CanvasRenderingContext2D, text: string, design: Design, cx: number, top: number, width: number, size: number): number {
  if (!text.trim()) return 0;
  context.font = fontFor(design.font, 700, size);
  context.fillStyle = design.textColor;
  context.textAlign = 'center';
  context.textBaseline = 'top';
  const lines = wrap(context, text, width).slice(0, 3);
  const lineHeight = size * 1.15;
  for (const [i, line] of lines.entries()) context.fillText(line, cx, top + i * lineHeight);
  return lines.length * lineHeight;
}

export function compose(target: Target, design: Design, shot: { canvas: HTMLCanvasElement | null; caption: string }, logo: HTMLCanvasElement | null): HTMLCanvasElement {
  const { width: W, height: H } = target;
  const canvas = createCanvas(W, H);
  const context = context2d(canvas);
  if (target.layout === 'raw') {
    context.fillStyle = '#000000';
    context.fillRect(0, 0, W, H);
    if (shot.canvas) drawCover(context, shot.canvas, 0, 0, W, H, 0.5, 0);
    return canvas;
  }
  paintFill(context, { kind: design.fill, color1: design.color1, color2: design.color2, angle: design.angle }, 0, 0, W, H);
  if (target.layout === 'banner') {
    const pad = H * 0.12;
    let textLeft = pad;
    if (logo) {
      const box = H * 0.42;
      drawContain(context, logo, pad, (H - box) / 2, box, box);
      textLeft = pad + box + pad * 0.7;
    }
    const phoneW = shot.canvas && target.width >= 600 ? W * 0.24 : 0;
    const textWidth = W - textLeft - pad - (phoneW ? phoneW + pad : 0);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = design.textColor;
    const titleSize = H * 0.2 * (design.captionSize / 100);
    context.font = fontFor(design.font, 700, titleSize);
    const titleLines = wrap(context, design.title, textWidth).slice(0, 2);
    const tagSize = titleSize * 0.45;
    const blockH = titleLines.length * titleSize * 1.05 + (design.tagline ? tagSize * 1.6 : 0);
    let y = (H - blockH) / 2 + titleSize * 0.85;
    for (const line of titleLines) {
      context.fillText(line, textLeft, y);
      y += titleSize * 1.05;
    }
    if (design.tagline) {
      context.font = fontFor(design.font, 700, tagSize);
      context.globalAlpha = 0.85;
      context.fillText(wrap(context, design.tagline, textWidth)[0] ?? '', textLeft, y + tagSize * 0.3);
      context.globalAlpha = 1;
    }
    if (phoneW && shot.canvas) {
      const phoneH = phoneW * 2.05;
      drawPhone(context, shot.canvas, W - pad - phoneW, H * 0.18, phoneW, phoneH, design);
    }
    return canvas;
  }
  // Screenshot: caption above or below a phone.
  const margin = W * 0.07;
  const size = W * 0.068 * (design.captionSize / 100);
  const captionTop = design.position === 'top' ? H * 0.045 : 0;
  let used = 0;
  if (design.position === 'top') used = drawCaption(context, shot.caption, design, W / 2, captionTop, W - margin * 2, size);
  const gap = H * 0.035;
  const room = design.position === 'top' ? H - (captionTop + used + gap) : H - (H * 0.045 + size * 2.4 + gap);
  const aspect = shot.canvas ? shot.canvas.height / shot.canvas.width : 2.17;
  let phoneW = W * 0.78;
  let phoneH = phoneW * aspect;
  const maxH = room - H * 0.02;
  if (design.position === 'top') {
    // Let the phone run off the bottom edge a little when it is tall.
    if (phoneH > maxH * 1.1) {
      phoneH = maxH * 1.1;
      phoneW = phoneH / aspect;
    }
    drawPhone(context, shot.canvas, (W - phoneW) / 2, captionTop + used + gap, phoneW, phoneH, design);
  } else {
    if (phoneH > maxH) {
      phoneH = maxH;
      phoneW = phoneH / aspect;
    }
    drawPhone(context, shot.canvas, (W - phoneW) / 2, H * 0.04, phoneW, phoneH, design);
    drawCaption(context, shot.caption, design, W / 2, H * 0.04 + phoneH + gap, W - margin * 2, size);
  }
  return canvas;
}

let nextId = 1;

function Thumb({ canvas, label }: { canvas: HTMLCanvasElement; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const scale = Math.min(1, 300 / canvas.height, 360 / canvas.width);
    target.width = Math.round(canvas.width * scale);
    target.height = Math.round(canvas.height * scale);
    const c = target.getContext('2d');
    if (!c) return;
    c.imageSmoothingQuality = 'high';
    c.drawImage(canvas, 0, 0, target.width, target.height);
  }, [canvas]);
  return <canvas ref={ref} class="sg-thumb" role="img" aria-label={label} />;
}

const FILLS: readonly SegmentChoice<Design['fill']>[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
];
const POSITIONS: readonly SegmentChoice<Design['position']>[] = [
  { value: 'top', label: 'Above' },
  { value: 'bottom', label: 'Below' },
];

function StoreGraphics({ toolId }: { toolId: string }) {
  const [design, setDesign] = usePersistentState(toolId, readDesign, (d: Design): Values => ({ ...d }));
  const [shots, setShots] = useState<Shot[]>([]);
  const [logo, setLogo] = useState<HTMLCanvasElement | null>(null);
  const [fontsReady, setFontsReady] = useState(0);
  const set = (patch: Partial<Design>) => setDesign((d) => ({ ...d, ...patch }));
  const target = TARGETS.find((t) => t.id === design.target) ?? (TARGETS[0] as Target);

  useEffect(() => {
    void ready(fontFor(design.font, 700, 40)).then(() => setFontsReady((n) => n + 1));
  }, [design.font]);
  const live = useRef(shots);
  live.current = shots;
  useEffect(
    () => () => {
      for (const s of live.current) URL.revokeObjectURL(s.url);
    },
    [],
  );

  const add = (files: File[]) =>
    attempt(async () => {
      const loaded: Shot[] = [];
      for (const file of files.filter(isImageFile).slice(0, 10)) {
        loaded.push({ id: nextId++, name: file.name, canvas: await loadImage(file), url: URL.createObjectURL(file), caption: '' });
      }
      if (!loaded.length) throw new Error('Choose PNG, JPEG or WebP screenshots.');
      setShots((list) => [...list, ...loaded].slice(0, 10));
    });

  const results = useMemo(() => {
    const list = target.layout === 'banner' ? [shots[0] ?? null] : shots.length ? shots : [null];
    return list.map((shot) => compose(target, design, { canvas: shot?.canvas ?? null, caption: shot?.caption ?? '' }, logo));
  }, [design, shots, logo, target, fontsReady]);

  const save = () =>
    attempt(async () => {
      if (target.layout !== 'banner' && !shots.length) throw new Error('Add at least one screenshot.');
      const ext = target.format === 'jpeg' ? 'jpg' : 'png';
      const encode = async (canvas: HTMLCanvasElement) => {
        if (target.format === 'png') return pngBytes(flatten(canvas, design.color1));
        // KaiStore banners must stay under 100 KB.
        for (const quality of [0.92, 0.85, 0.75, 0.65, 0.5]) {
          const bytes = await jpegBytes(canvas, quality);
          if (bytes.length < 100 * 1024) return bytes;
        }
        return jpegBytes(canvas, 0.4);
      };
      if (results.length === 1) {
        const outcome = await saveFile(`${target.id}.${ext}`, await encode(results[0] as HTMLCanvasElement), target.format === 'png' ? 'image/png' : 'image/jpeg');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
        return;
      }
      const files: Record<string, Uint8Array> = {};
      for (const [i, canvas] of results.entries()) files[`${target.id}-${String(i + 1).padStart(2, '0')}.${ext}`] = await encode(canvas);
      const outcome = await saveFile(`${target.id}-screenshots.zip`, zipSync(files, { level: 0 }), 'application/zip');
      if (outcome.saved) notify(`Saved ${results.length} pictures to ${outcome.location}`);
    });

  const move = (index: number, by: number) =>
    setShots((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      if (item) next.splice(Math.min(Math.max(index + by, 0), next.length), 0, item);
      return next;
    });

  return (
    <section class="tool sg-tool" data-testid="tool" data-state="done">
      <div class="sg-grid">
        <div class="sg-controls">
          <label class="control">
            <span class="control-label">Make</span>
            <select class="input" value={design.target} onChange={(e) => set({ target: e.currentTarget.value })} data-testid="sg-target">
              {TARGETS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <span class="control-help">{target.note}</span>
          </label>

          <MultiDrop
            onFiles={add}
            accept="image/*"
            title={shots.length ? 'Add more screenshots' : 'Drop screenshots here, or click to choose'}
            hint="Up to ten. Nothing leaves this computer."
            compact={shots.length > 0}
            testId="sg-drop"
            wants={isImageFile}
          />
          {shots.length > 0 && (
            <ol class="sg-list" aria-label="Screenshots">
              {shots.map((shot, i) => (
                <li key={shot.id} class="sg-item">
                  <img src={shot.url} alt="" />
                  <div class="sg-item-fields">
                    <span class="file-name">{shot.name}</span>
                    {target.layout === 'screenshot' && (
                      <input
                        class="input"
                        type="text"
                        placeholder="Caption"
                        aria-label={`Caption for screenshot ${i + 1}`}
                        value={shot.caption}
                        onInput={(e) => {
                          const caption = e.currentTarget.value;
                          setShots((list) => list.map((s) => (s.id === shot.id ? { ...s, caption } : s)));
                        }}
                        data-testid="sg-caption"
                      />
                    )}
                  </div>
                  <div class="sg-item-actions">
                    <button type="button" class="icon-button" aria-label={`Move screenshot ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <Icon name="up" size={14} />
                    </button>
                    <button type="button" class="icon-button" aria-label={`Move screenshot ${i + 1} down`} disabled={i === shots.length - 1} onClick={() => move(i, 1)}>
                      <Icon name="down" size={14} />
                    </button>
                    <button type="button" class="icon-button" aria-label={`Remove screenshot ${i + 1}`} onClick={() => setShots((list) => list.filter((s) => s.id !== shot.id))}>
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {target.layout === 'banner' && (
            <>
              <label class="control">
                <span class="control-label">Title</span>
                <input class="input" type="text" value={design.title} onInput={(e) => set({ title: e.currentTarget.value })} data-testid="sg-title" />
              </label>
              <label class="control">
                <span class="control-label">Tagline</span>
                <input class="input" type="text" value={design.tagline} onInput={(e) => set({ tagline: e.currentTarget.value })} />
              </label>
              <div class="button-row">
                <button type="button" class="button button-small" onClick={() => attempt(async () => setLogo(await pickLogo()))}>
                  <Icon name="image" size={14} /> {logo ? 'Change logo' : 'Add a logo or app icon'}
                </button>
                {logo && (
                  <button type="button" class="button button-small button-quiet" onClick={() => setLogo(null)}>
                    Remove logo
                  </button>
                )}
              </div>
            </>
          )}

          {target.layout !== 'raw' && (
            <>
              <div class="icon-row">
                <div class="control">
                  <span class="control-label">Background</span>
                  <Segmented label="Background" value={design.fill} choices={FILLS} onChange={(fill) => set({ fill })} />
                </div>
                <label class="control">
                  <span class="control-label">{design.fill === 'gradient' ? 'From' : 'Colour'}</span>
                  <input class="color-swatch" type="color" value={design.color1} onInput={(e) => set({ color1: e.currentTarget.value })} />
                </label>
                {design.fill === 'gradient' && (
                  <label class="control">
                    <span class="control-label">To</span>
                    <input class="color-swatch" type="color" value={design.color2} onInput={(e) => set({ color2: e.currentTarget.value })} />
                  </label>
                )}
                <label class="control">
                  <span class="control-label">Text</span>
                  <input class="color-swatch" type="color" value={design.textColor} onInput={(e) => set({ textColor: e.currentTarget.value })} />
                </label>
              </div>
              <div class="icon-row">
                <label class="control">
                  <span class="control-label">Typeface</span>
                  <select class="input" value={design.font} onChange={(e) => set({ font: e.currentTarget.value })}>
                    {FONTS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="control">
                  <span class="control-label">Text size {design.captionSize}%</span>
                  <input class="range" type="range" min={50} max={160} step={5} value={design.captionSize} onInput={(e) => set({ captionSize: Number(e.currentTarget.value) })} />
                </label>
                {target.layout === 'screenshot' && (
                  <div class="control">
                    <span class="control-label">Caption</span>
                    <Segmented label="Caption" value={design.position} choices={POSITIONS} onChange={(position) => set({ position })} />
                  </div>
                )}
              </div>
              <div class="icon-row">
                <label class="toggle">
                  <input type="checkbox" checked={design.frame} onChange={(e) => set({ frame: e.currentTarget.checked })} />
                  <span class="toggle-track" aria-hidden="true" />
                  Phone frame
                </label>
                {design.frame && (
                  <>
                    <label class="control">
                      <span class="control-label">Frame colour</span>
                      <input class="color-swatch" type="color" value={design.frameColor} onInput={(e) => set({ frameColor: e.currentTarget.value })} />
                    </label>
                    <label class="toggle">
                      <input type="checkbox" checked={design.cutout} onChange={(e) => set({ cutout: e.currentTarget.checked })} />
                      <span class="toggle-track" aria-hidden="true" />
                      Camera cut-out
                    </label>
                  </>
                )}
              </div>
            </>
          )}
          <div class="button-row">
            <button type="button" class="button button-primary" onClick={save} data-testid="sg-save">
              <Icon name="save" size={16} /> {results.length > 1 ? `Save ${results.length} pictures (ZIP)` : 'Save picture'}
            </button>
          </div>
        </div>
        <section class="sg-results" data-testid="sg-results" aria-label="Results">
          {results.map((canvas, i) => (
            <figure key={`${i}-${canvas.width}`} class="sg-result">
              <Thumb canvas={canvas} label={`Result ${i + 1}, ${canvas.width} × ${canvas.height} pixels`} />
              <figcaption>
                {canvas.width} × {canvas.height}
              </figcaption>
            </figure>
          ))}
        </section>
      </div>
    </section>
  );
}

async function pickLogo(): Promise<HTMLCanvasElement | null> {
  const file = await pickFile('image/*');
  return file ? loadImage(file) : null;
}

export default defineCustomTool(StoreGraphics);
