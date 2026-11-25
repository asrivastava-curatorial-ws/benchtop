/**
 * Print Production Studio, colour: a picture converted to the four inks of a
 * press with an ICC profile, shown as it will print (a soft proof), with the
 * colours the press cannot reach, the ink on each plate and the total ink.
 * Saves CMYK TIFF and PDF files with the profile inside.
 */
import wasmUrl from 'lcms-wasm/dist/lcms.wasm?url';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import {
  type ColourEngine,
  colourEngine,
  coverageMap,
  type GamutCheck,
  gamutCheck,
  INTENT_NAMES,
  type InkStats,
  type Intent,
  inkStats,
  inPieces,
  markOutside,
  onWhite,
  type ProfileInfo,
  type Proofer,
  plateOf,
  shareOver,
  toRgba,
} from '../../lib/colour-proof';
import { cmykPdf } from '../../lib/print-pdf';
import { writeTiff } from '../../lib/tiff';
import { pickFile, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import type { Values } from '../types';
import { clamp, Segmented } from './_shared';

export type ColourView = 'proof' | 'original' | 'outside' | 'coverage' | 'cyan' | 'magenta' | 'yellow' | 'black';

export interface ColourSettings {
  readonly intent: Intent;
  readonly blackPoint: boolean;
  readonly paper: boolean;
  readonly tolerance: number;
  readonly inkLimit: number;
  readonly dpi: number;
  readonly compress: boolean;
}

const num = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback);
export const readColour = (v: Values | undefined): ColourSettings => ({
  intent: v?.intent === 'perceptual' || v?.intent === 'saturation' || v?.intent === 'absolute' ? v.intent : 'relative',
  blackPoint: v?.blackPoint !== false,
  paper: v?.paper === true,
  tolerance: num(v?.tolerance, 3, 2, 20),
  inkLimit: num(v?.inkLimit, 300, 150, 400),
  dpi: num(v?.dpi, 300, 30, 2400),
  compress: v?.compress !== false,
});

/** The built-in press profile, made from the FOGRA39L data (scripts/make-cmyk-profile.mjs). */
const BUILT_IN = './icc/Benchtop-Coated-FOGRA39L.icc';
/** Pictures larger than this are refused: their inks would not fit in memory beside them. */
const MAX_PIXELS = 60_000_000;
/** The picture on screen is worked out at about this size, so that every change shows at once. */
const PREVIEW_PIXELS = 900_000;

interface Picture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** The whole picture, as a canvas gives it. */
  readonly rgba: Uint8ClampedArray;
  /** The picture at the size it is shown and measured at, as RGB on white. */
  readonly preview: { readonly width: number; readonly height: number; readonly rgb: Uint8Array };
}

interface Loaded {
  readonly bytes: Uint8Array;
  readonly info: ProfileInfo;
  readonly file: string;
}

interface Result {
  readonly cmyk: Uint8Array;
  readonly proof: Uint8Array;
  /** How far the print is from the screen colour with the conversion chosen. */
  readonly shift: GamutCheck;
  /** How far the nearest colour the press can print is: over the tolerance, the colour is out of its reach. */
  readonly reach: GamutCheck;
  /** The share of the picture out of the press's reach. */
  readonly outside: number;
  readonly stats: InkStats;
}

let shared: Promise<ColourEngine> | null = null;
const engineOnce = () => {
  shared ??= colourEngine(wasmUrl).catch((error) => {
    shared = null;
    throw error;
  });
  return shared;
};

function pictureFrom(source: CanvasImageSource, width: number, height: number, name: string): Picture {
  if (width * height > MAX_PIXELS) throw new Error(`This picture has ${Math.round((width * height) / 1e6)} megapixels; pictures of up to ${MAX_PIXELS / 1e6} megapixels can be converted here.`);
  const full = document.createElement('canvas');
  full.width = width;
  full.height = height;
  const ctx = full.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This picture could not be read.');
  ctx.drawImage(source, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const scale = Math.min(1, Math.sqrt(PREVIEW_PIXELS / (width * height)));
  const pw = Math.max(1, Math.round(width * scale));
  const ph = Math.max(1, Math.round(height * scale));
  const small = document.createElement('canvas');
  small.width = pw;
  small.height = ph;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  if (!sctx) throw new Error('This picture could not be read.');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(full, 0, 0, pw, ph);
  return { name, width, height, rgba, preview: { width: pw, height: ph, rgb: onWhite(sctx.getImageData(0, 0, pw, ph).data) } };
}

/** A picture to try the tool on: strong screen colours, soft ones, skin, and a ramp of greys. */
function samplePicture(): Picture {
  const w = 1200;
  const h = 800;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The sample could not be drawn.');
  // A sky running to a warm horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#0a3d91');
  sky.addColorStop(0.55, '#4f9be0');
  sky.addColorStop(1, '#f7c98a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.62);
  const sun = ctx.createRadialGradient(w * 0.72, h * 0.5, 10, w * 0.72, h * 0.5, 240);
  sun.addColorStop(0, 'rgba(255, 244, 200, 1)');
  sun.addColorStop(0.25, 'rgba(255, 190, 80, 0.8)');
  sun.addColorStop(1, 'rgba(255, 150, 60, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h * 0.62);
  // Fields in greens that no press prints as a screen shows them.
  const field = ctx.createLinearGradient(0, h * 0.62, 0, h);
  field.addColorStop(0, '#1fa83a');
  field.addColorStop(1, '#0b4d1c');
  ctx.fillStyle = field;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  // The screen's own strongest colours, and softer ones that print as they are.
  const strong = ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'];
  strong.forEach((colour, i) => {
    ctx.fillStyle = colour;
    ctx.fillRect(40 + i * 82, h - 250, 70, 70);
  });
  const soft = ['#c94f4f', '#d99a5b', '#d8c96a', '#6fa86a', '#6aa3a8', '#5f77b0', '#a56aa8'];
  soft.forEach((colour, i) => {
    ctx.fillStyle = colour;
    ctx.fillRect(40 + i * 82, h - 168, 70, 70);
  });
  // Skin tones.
  ['#f3d2b8', '#e0ac96', '#c68863', '#8d5a3c', '#5b3a26'].forEach((colour, i) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(700 + i * 92, h - 170, 40, 0, Math.PI * 2);
    ctx.fill();
  });
  // Greys from black to white.
  const greys = ctx.createLinearGradient(40, 0, w - 40, 0);
  greys.addColorStop(0, '#000000');
  greys.addColorStop(1, '#ffffff');
  ctx.fillStyle = greys;
  ctx.fillRect(40, h - 80, w - 80, 46);
  return pictureFrom(canvas, w, h, 'sample.png');
}

const VIEWS: readonly { readonly value: ColourView; readonly label: string }[] = [
  { value: 'proof', label: 'As it prints' },
  { value: 'original', label: 'On screen' },
  { value: 'outside', label: 'Out of reach' },
  { value: 'coverage', label: 'Total ink' },
  { value: 'cyan', label: 'Cyan plate' },
  { value: 'magenta', label: 'Magenta plate' },
  { value: 'yellow', label: 'Yellow plate' },
  { value: 'black', label: 'Black plate' },
];
const PLATES: Partial<Record<ColourView, 0 | 1 | 2 | 3>> = { cyan: 0, magenta: 1, yellow: 2, black: 3 };

const percent = (share: number) => (share === 0 ? '0 %' : share < 0.001 ? 'under 0.1 %' : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)} %`);
const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'picture';

export function ColourTab({ settings, set }: { settings: ColourSettings; set: (patch: Partial<ColourSettings>) => void }) {
  const [picture, setPicture] = useState<Picture | null>(null);
  const [profile, setProfile] = useState<Loaded | null>(null);
  const [builtIn, setBuiltIn] = useState<Loaded | null>(null);
  const [proofer, setProofer] = useState<Proofer | null>(null);
  const [problem, setProblem] = useState('');
  const [view, setView] = useState<ColourView>('proof');
  const [under, setUnder] = useState<string>('');
  const [busy, setBusy] = useState<{ what: string; done: number } | null>(null);
  const [saved, setSaved] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);

  // The press profile that ships with the app is fetched once, when the tab opens.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [engine, response] = await Promise.all([engineOnce(), fetch(BUILT_IN)]);
        if (!response.ok) throw new Error('The built-in press profile is missing from this copy of the app.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        const loaded = { bytes, info: engine.describe(bytes), file: 'Benchtop-Coated-FOGRA39L.icc' };
        if (!live) return;
        setBuiltIn(loaded);
        setProfile((old) => old ?? loaded);
      } catch (error) {
        if (live) setProblem(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // A proofer for the profile and the way of converting that are chosen; the old one is let go.
  useEffect(() => {
    if (!profile) return;
    let live = true;
    let made: Proofer | null = null;
    void (async () => {
      try {
        const engine = await engineOnce();
        made = engine.proofer(profile.bytes, settings.intent, settings.blackPoint);
        if (live) {
          setProofer(made);
          setProblem('');
        } else made.close();
      } catch (error) {
        if (live) {
          setProofer(null);
          setProblem(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      live = false;
      made?.close();
      setProofer(null);
    };
  }, [profile, settings.intent, settings.blackPoint]);

  // The slow part, done once for a picture and a way of converting it: the inks, and how far each colour moves.
  const base = useMemo(() => {
    if (!picture || !proofer) return null;
    const { rgb } = picture.preview;
    const cmyk = proofer.separate(rgb);
    const screen = proofer.labOfScreen(rgb);
    return { cmyk, shift: gamutCheck(screen, proofer.labOfPrint(cmyk)), reach: gamutCheck(screen, proofer.labOfPrint(proofer.nearest(rgb))) };
  }, [picture, proofer]);
  // What follows from it is quick, and is redone alone when its own setting changes.
  const proof = useMemo(() => (base && proofer ? proofer.show(base.cmyk, settings.paper) : null), [base, proofer, settings.paper]);
  const outside = useMemo(() => (base ? shareOver(base.reach.distance, settings.tolerance) : 0), [base, settings.tolerance]);
  const stats = useMemo(() => (base ? inkStats(base.cmyk, settings.inkLimit) : null), [base, settings.inkLimit]);
  const result = useMemo<Result | null>(() => (base && proof && stats ? { cmyk: base.cmyk, proof, shift: base.shift, reach: base.reach, outside, stats } : null), [base, proof, outside, stats]);

  useEffect(() => {
    const target = canvas.current;
    if (!target || !picture) return;
    const { width, height, rgb } = picture.preview;
    target.width = width;
    target.height = height;
    const ctx = target.getContext('2d');
    if (!ctx) return;
    let pixels: Uint8ClampedArray;
    if (view === 'original' || !result) pixels = toRgba(rgb);
    else if (view === 'proof') pixels = toRgba(result.proof);
    else if (view === 'outside') pixels = markOutside(result.proof, result.reach.distance, settings.tolerance);
    else if (view === 'coverage') pixels = coverageMap(result.cmyk, settings.inkLimit);
    else pixels = plateOf(result.cmyk, PLATES[view] ?? 3);
    ctx.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  }, [picture, result, view, settings.tolerance, settings.inkLimit]);

  const open = () =>
    attempt(async () => {
      const file = await pickFile('image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp');
      if (!file) return;
      const bitmap = await createImageBitmap(file).catch(() => {
        throw new Error('This picture could not be read. PNG, JPEG, WebP, AVIF, GIF and BMP pictures are read here.');
      });
      try {
        setPicture(pictureFrom(bitmap, bitmap.width, bitmap.height, file.name));
        setSaved('');
      } finally {
        bitmap.close();
      }
    });

  const loadProfile = () =>
    attempt(async () => {
      const file = await pickFile('.icc,.icm,application/vnd.iccprofile');
      if (!file) return;
      if (file.size > 40 * 1024 * 1024) throw new Error('This file is too large to be a colour profile.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const engine = await engineOnce();
      const info = engine.describe(bytes);
      // Tried at once, so that a profile that will not do is refused here and the old one stays.
      engine.proofer(bytes, settings.intent, settings.blackPoint).close();
      setProfile({ bytes, info, file: file.name });
    });

  /** The whole picture as inks, a strip at a time. */
  const separateAll = async (what: string): Promise<Uint8Array> => {
    if (!picture || !proofer) throw new Error('Open a picture first.');
    setBusy({ what, done: 0 });
    const rgb = onWhite(picture.rgba);
    return inPieces(
      rgb,
      3,
      4,
      (piece) => proofer.separate(piece),
      (done) => setBusy({ what, done }),
    );
  };

  const save = (kind: 'tiff' | 'pdf' | 'proof') =>
    attempt(async () => {
      if (!picture || !proofer || !profile) return;
      try {
        let bytes: Uint8Array;
        let name: string;
        let mime: string;
        if (kind === 'proof') {
          setBusy({ what: 'Making the proof', done: 0 });
          const cmyk = await separateAll('Making the proof');
          const shown = await inPieces(
            cmyk,
            4,
            3,
            (piece) => proofer.show(piece, settings.paper),
            (done) => setBusy({ what: 'Making the proof', done }),
          );
          const out = document.createElement('canvas');
          out.width = picture.width;
          out.height = picture.height;
          out.getContext('2d')?.putImageData(new ImageData(toRgba(shown) as Uint8ClampedArray<ArrayBuffer>, picture.width, picture.height), 0, 0);
          const blob = await new Promise<Blob | null>((done) => out.toBlob(done, 'image/png'));
          if (!blob) throw new Error('The proof could not be made.');
          bytes = new Uint8Array(await blob.arrayBuffer());
          name = `${stem(picture.name)}-proof.png`;
          mime = 'image/png';
        } else {
          const cmyk = await separateAll(kind === 'tiff' ? 'Converting for the TIFF' : 'Converting for the PDF');
          if (kind === 'tiff') {
            bytes = writeTiff({
              width: picture.width,
              height: picture.height,
              channels: 4,
              data: cmyk,
              dpi: settings.dpi,
              profile: profile.bytes,
              compress: settings.compress,
              software: 'Benchtop Print Production Studio',
            });
            name = `${stem(picture.name)}-cmyk.tif`;
            mime = 'image/tiff';
          } else {
            bytes = await cmykPdf({ width: picture.width, height: picture.height, cmyk, dpi: settings.dpi, profile: profile.bytes, profileName: profile.info.name, title: stem(picture.name) });
            name = `${stem(picture.name)}-cmyk.pdf`;
            mime = 'application/pdf';
          }
        }
        const outcome = await saveFile(name, bytes, mime);
        if (outcome.saved) {
          setSaved(`${name}, ${formatBytes(bytes.length)}`);
          notify(`Saved to ${outcome.location}`);
        }
      } finally {
        setBusy(null);
      }
    });

  const readUnder = (event: PointerEvent) => {
    const target = canvas.current;
    if (!target || !picture || !result) return;
    const box = target.getBoundingClientRect();
    const x = Math.floor(((event.clientX - box.left) / box.width) * picture.preview.width);
    const y = Math.floor(((event.clientY - box.top) / box.height) * picture.preview.height);
    if (x < 0 || y < 0 || x >= picture.preview.width || y >= picture.preview.height) return;
    const p = y * picture.preview.width + x;
    const rgb = picture.preview.rgb;
    const ink = [0, 1, 2, 3].map((d) => Math.round((result.cmyk[p * 4 + d] as number) / 2.55));
    setUnder(
      `Screen R ${rgb[p * 3]} G ${rgb[p * 3 + 1]} B ${rgb[p * 3 + 2]} → C ${ink[0]} M ${ink[1]} Y ${ink[2]} K ${ink[3]} (${ink.reduce((sum, v) => sum + v, 0)} % ink), ${(result.shift.distance[p] as number).toFixed(1)} ΔE from the screen colour${(result.reach.distance[p] as number) > settings.tolerance ? ', out of the press’s reach' : ''}`,
    );
  };

  const widthMm = picture ? (picture.width / settings.dpi) * 25.4 : 0;
  const heightMm = picture ? (picture.height / settings.dpi) * 25.4 : 0;
  const viewLabel = VIEWS.find((v) => v.value === view)?.label ?? '';

  return (
    <div class="pp-colour" data-testid="pp-colour">
      <div class="button-row pp-bar">
        <button type="button" class="button button-small button-primary" onClick={open} data-testid="pp-open">
          <Icon name="open" size={15} /> Open a picture
        </button>
        <button type="button" class="button button-small button-quiet" onClick={() => attempt(() => setPicture(samplePicture()))} data-testid="pp-sample">
          <Icon name="sample" size={15} /> Sample
        </button>
        {picture && (
          <span class="tone-muted" data-testid="pp-info">
            {picture.name} · {picture.width} × {picture.height} px · {widthMm.toFixed(0)} × {heightMm.toFixed(0)} mm at {settings.dpi} dpi
          </span>
        )}
      </div>
      {problem && (
        <p class="recipe-error" data-testid="pp-problem">
          {problem}
        </p>
      )}

      <div class="pp-main">
        <div class="pp-stage">
          {picture ? (
            <>
              <canvas
                ref={canvas}
                class="pp-canvas"
                role="img"
                aria-label={`The picture: ${viewLabel.toLowerCase()}`}
                onPointerMove={readUnder}
                onPointerLeave={() => setUnder('')}
                data-testid="pp-canvas"
              />
              <div class="pp-under">
                <label class="control pp-view">
                  <span class="control-label">Show</span>
                  <select class="select" value={view} onChange={(e) => setView(e.currentTarget.value as ColourView)} data-testid="pp-view">
                    {VIEWS.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Segmented
                  value={view === 'original' ? 'original' : view === 'proof' ? 'proof' : 'other'}
                  label="Compare"
                  onChange={(next) => {
                    if (next !== 'other') setView(next);
                  }}
                  choices={[
                    { value: 'original', label: 'On screen' },
                    { value: 'proof', label: 'As it prints' },
                  ]}
                />
                {view === 'coverage' && (
                  <span class="pp-legend" data-testid="pp-legend">
                    <span class="pp-ramp" aria-hidden="true" />
                    <span>none to {settings.inkLimit} %</span>
                    <span class="pp-swatch pp-over" aria-hidden="true" />
                    <span>over {settings.inkLimit} %</span>
                  </span>
                )}
                {view === 'outside' && (
                  <span class="pp-legend" data-testid="pp-legend">
                    <span class="pp-swatch pp-out" aria-hidden="true" />
                    <span>the nearest colour the press prints is more than {settings.tolerance} ΔE away</span>
                  </span>
                )}
              </div>
              <p class="control-help pp-readout" data-testid="pp-readout">
                {under || 'Point at the picture to read the inks under the pointer.'}
              </p>
            </>
          ) : (
            <p class="pp-empty">Open a picture, or try the sample, to see it as a press will print it. Pictures are read as sRGB, the colour of screens and of almost every camera file.</p>
          )}
        </div>

        <div class="pp-side">
          <div class="pp-panel">
            <span class="pane-title">Press profile</span>
            {profile ? (
              <p class="pp-profile" data-testid="pp-profile">
                <strong>{profile.info.name}</strong>
                <span class="tone-muted">
                  {profile.info.space}, ICC version {profile.info.version}, {formatBytes(profile.info.size)}
                </span>
              </p>
            ) : (
              <p class="tone-muted">Loading the built-in profile…</p>
            )}
            <div class="button-row">
              <button type="button" class="button button-small" onClick={loadProfile} data-testid="pp-load-profile">
                <Icon name="open" size={13} /> Load a profile (.icc)
              </button>
              {builtIn && profile && profile !== builtIn && (
                <button type="button" class="button button-small button-quiet" onClick={() => setProfile(builtIn)} data-testid="pp-built-in">
                  Use the built-in one
                </button>
              )}
            </div>
            <p class="control-help">
              The built-in profile is made from the FOGRA39L data for offset printing on coated paper, with at most 300 % ink: a sound choice for general work. For a job with a contract proof, load
              the profile your printer names.
            </p>
          </div>

          <div class="pp-panel">
            <span class="pane-title">Conversion</span>
            <label class="control">
              <span class="control-label">What to do with colours the press cannot print</span>
              <select class="select" value={settings.intent} onChange={(e) => set({ intent: e.currentTarget.value as Intent })} data-testid="pp-intent">
                {(Object.keys(INTENT_NAMES) as Intent[]).map((intent) => (
                  <option key={intent} value={intent}>
                    {INTENT_NAMES[intent]}
                  </option>
                ))}
              </select>
            </label>
            <p class="control-help">
              {settings.intent === 'relative'
                ? 'Colours the press can print stay as they are; the rest move to the nearest it can. The usual choice for logos and flat colour, and good for photographs with black point compensation.'
                : settings.intent === 'perceptual'
                  ? 'All colours shift a little so that those out of reach keep their distance from their neighbours. The usual choice for photographs.'
                  : settings.intent === 'saturation'
                    ? 'Keeps colours vivid at the cost of accuracy: for charts and diagrams.'
                    : 'Like relative colorimetric, and also prints the tint of the original’s white: for proofing one paper on another.'}
            </p>
            <label class={`check${settings.intent === 'relative' ? '' : ' is-off'}`}>
              <input type="checkbox" checked={settings.blackPoint} disabled={settings.intent !== 'relative'} onChange={(e) => set({ blackPoint: e.currentTarget.checked })} data-testid="pp-bpc" />
              Black point compensation (keeps detail in the shadows)
            </label>
            <label class="check">
              <input type="checkbox" checked={settings.paper} onChange={(e) => set({ paper: e.currentTarget.checked })} data-testid="pp-paper" />
              Show the paper’s own colour in the proof
            </label>
          </div>

          <div class="pp-panel" data-testid="pp-stats">
            <span class="pane-title">What the conversion does</span>
            {result ? (
              <dl class="pp-facts">
                <div>
                  <dt>Out of the press’s reach</dt>
                  <dd data-testid="pp-outside">{percent(result.outside)} of the picture</dd>
                </div>
                <div>
                  <dt>Change from the screen, mean and largest</dt>
                  <dd>
                    {result.shift.mean.toFixed(1)} and {result.shift.worst.toFixed(0)} ΔE
                  </dd>
                </div>
                <div>
                  <dt>Most ink at one spot</dt>
                  <dd data-testid="pp-most">{Math.round(result.stats.most)} %</dd>
                </div>
                <div>
                  <dt>Over {settings.inkLimit} %</dt>
                  <dd data-testid="pp-over">{percent(result.stats.over)} of the picture</dd>
                </div>
                <div>
                  <dt>Mean coverage (C, M, Y, K)</dt>
                  <dd data-testid="pp-mean">{result.stats.mean.map((v) => `${Math.round(v)} %`).join(', ')}</dd>
                </div>
              </dl>
            ) : (
              <p class="tone-muted">{picture ? 'Working…' : 'Nothing yet.'}</p>
            )}
            <div class="control-row">
              <label class="control">
                <span class="control-label">Counts as out of reach from (ΔE)</span>
                <input
                  class="input input-number"
                  type="number"
                  min={2}
                  max={20}
                  step={0.5}
                  value={settings.tolerance}
                  onChange={(e) => set({ tolerance: clamp(Number(e.currentTarget.value) || 3, 2, 20) })}
                  data-testid="pp-tolerance"
                />
              </label>
              <label class="control">
                <span class="control-label">Ink limit to check against (%)</span>
                <input
                  class="input input-number"
                  type="number"
                  min={150}
                  max={400}
                  step={10}
                  value={settings.inkLimit}
                  onChange={(e) => set({ inkLimit: clamp(Number(e.currentTarget.value) || 300, 150, 400) })}
                  data-testid="pp-limit"
                />
              </label>
            </div>
          </div>

          <div class="pp-panel">
            <span class="pane-title">Save for the press</span>
            <div class="control-row">
              <label class="control">
                <span class="control-label">Resolution (dots per inch)</span>
                <input
                  class="input input-number"
                  type="number"
                  min={30}
                  max={2400}
                  step={1}
                  value={settings.dpi}
                  onChange={(e) => set({ dpi: clamp(Math.round(Number(e.currentTarget.value)) || 300, 30, 2400) })}
                  data-testid="pp-dpi"
                />
              </label>
              <label class="check">
                <input type="checkbox" checked={settings.compress} onChange={(e) => set({ compress: e.currentTarget.checked })} data-testid="pp-compress" />
                Pack the TIFF (ZIP)
              </label>
            </div>
            <div class="button-row">
              <button type="button" class="button button-small button-primary" disabled={!result || !!busy} onClick={() => save('tiff')} data-testid="pp-save-tiff">
                <Icon name="save" size={14} /> CMYK TIFF
              </button>
              <button type="button" class="button button-small" disabled={!result || !!busy} onClick={() => save('pdf')} data-testid="pp-save-pdf">
                <Icon name="save" size={14} /> CMYK PDF
              </button>
              <button type="button" class="button button-small" disabled={!result || !!busy} onClick={() => save('proof')} data-testid="pp-save-proof">
                <Icon name="save" size={14} /> Proof (PNG)
              </button>
            </div>
            {busy && (
              <p class="control-help" role="status" data-testid="pp-progress">
                {busy.what}: {Math.round(busy.done * 100)} %
              </p>
            )}
            {saved && !busy && (
              <p class="control-help" data-testid="pp-saved">
                Saved {saved}.
              </p>
            )}
            <p class="control-help">Both files hold the ink numbers shown here and carry the profile, so that the print shop’s software knows which press they were made for.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
