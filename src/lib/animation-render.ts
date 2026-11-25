/**
 * Draws an animation's frames on a canvas, for video, GIF and picture export.
 * The same scene the editor shows with page elements: shapes, text, pictures,
 * groups, motion paths and clips.
 */
import { Zip, ZipPassThrough } from 'fflate';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { type AnimObject, type AnimProject, childrenOf, clipTime, onPath, rgbaCss, sequenceOf, valuesAt } from './animation';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Assets = ReadonlyMap<string, CanvasImageSource & { readonly width: number; readonly height: number }>;

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function rounded(ctx: Context, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Text broken into lines that fit `width`, the way the page wraps it. */
export function wrapText(text: string, width: number, measure: (line: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(?<=\s)/)) {
      if (line && width > 0 && measure((line + word).trimEnd()) > width) {
        lines.push(line.trimEnd());
        line = word;
      } else line += word;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function drawObject(ctx: Context, project: AnimProject, object: AnimObject, t: number, assets: Assets, depth: number): void {
  const v = onPath(object, valuesAt(project, object.key, t));
  const opacity = Math.min(Math.max(v.opacity as number, 0), 1);
  if (opacity <= 0) return;
  const w = Math.max(0, v.width as number);
  const h = Math.max(0, v.height as number);
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.translate(v.x as number, v.y as number);
  ctx.rotate(((v.rotation as number) * Math.PI) / 180);
  ctx.scale(v.scale as number, v.scale as number);
  switch (object.kind) {
    case 'box':
      rounded(ctx, -w / 2, -h / 2, w, h, v.radius as number);
      ctx.fillStyle = rgbaCss(v.fill);
      ctx.fill();
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = rgbaCss(v.fill);
      ctx.fill();
      break;
    case 'text': {
      const size = Math.max(1, v.fontSize as number);
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.fillStyle = rgbaCss(v.fill);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = wrapText(object.text ?? '', w, (line) => ctx.measureText(line).width);
      const step = size * 1.15;
      lines.forEach((line, index) => {
        ctx.fillText(line, 0, (index - (lines.length - 1) / 2) * step);
      });
      break;
    }
    case 'picture': {
      const image = object.picture ? assets.get(object.picture) : undefined;
      if (image && w > 0 && h > 0) {
        rounded(ctx, -w / 2, -h / 2, w, h, v.radius as number);
        ctx.clip();
        // Fill the box and keep the picture's shape, as "cover" does on the page.
        const scale = Math.max(w / image.width, h / image.height);
        ctx.drawImage(image, (-image.width * scale) / 2, (-image.height * scale) / 2, image.width * scale, image.height * scale);
      }
      break;
    }
    case 'group':
      for (const child of childrenOf(project, object.key)) drawObject(ctx, project, child, t, assets, depth);
      break;
    default: {
      const clip = object.clip ? project.clips?.[object.clip] : undefined;
      if (clip && depth < 2 && w > 0 && h > 0) {
        ctx.beginPath();
        ctx.rect(-w / 2, -h / 2, w, h);
        ctx.clip();
        const scale = Math.min(w / clip.stage.width, h / clip.stage.height);
        ctx.scale(scale, scale);
        ctx.translate(-clip.stage.width / 2, -clip.stage.height / 2);
        const local = clipTime(object, t, sequenceOf(clip).length);
        for (const child of childrenOf(clip, undefined)) drawObject(ctx, clip, child, local, assets, depth + 1);
      }
    }
  }
  ctx.restore();
}

/** Draws the whole stage at time `t`; the canvas may be any size (the stage is scaled to it). */
export function renderFrame(ctx: Context, project: AnimProject, t: number, assets: Assets, width: number, height: number): void {
  ctx.save();
  ctx.setTransform(width / project.stage.width, 0, 0, height / project.stage.height, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = project.stage.background;
  ctx.fillRect(0, 0, project.stage.width, project.stage.height);
  for (const object of childrenOf(project, undefined)) drawObject(ctx, project, object, t, assets, 0);
  ctx.restore();
}

/** Every picture the project draws, clips included. */
export function picturesOf(project: AnimProject): string[] {
  const urls = new Set<string>();
  for (const one of [project, ...Object.values(project.clips ?? {})]) for (const object of one.objects) if (object.picture) urls.add(object.picture);
  return [...urls];
}

/** A picture, once it has loaded (SVG pictures included, which `decode()` refuses in some browsers). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A picture could not be read.'));
    image.src = url;
  });
}

export async function loadAssets(project: AnimProject): Promise<Assets> {
  const assets = new Map<string, CanvasImageSource & { width: number; height: number }>();
  await Promise.all(
    picturesOf(project).map(async (url) => {
      try {
        const image = await loadImage(url);
        // A picture without a size of its own (some SVGs) cannot be placed.
        if (image.width > 0 && image.height > 0) assets.set(url, image);
      } catch {
        /* A picture that cannot be read is left out of the frames. */
      }
    }),
  );
  return assets;
}

export interface FrameOptions {
  readonly fps: number;
  /** Size of the frames as a share of the stage (1 = full size). */
  readonly scale: number;
}

/** Frame sizes are even numbers: video encoders need that. */
export function frameSize(project: AnimProject, scale: number): { width: number; height: number } {
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(project.stage.width), height: even(project.stage.height) };
}

export const frameCount = (project: AnimProject, fps: number): number => Math.max(1, Math.round(sequenceOf(project).length * fps));

/** Draws every frame in turn on one canvas and hands it to `each`. */
export async function eachFrame(
  project: AnimProject,
  options: FrameOptions,
  each: (canvas: HTMLCanvasElement, index: number, count: number) => Promise<void> | void,
  signal: { cancelled: boolean },
): Promise<void> {
  const assets = await loadAssets(project);
  const { width, height } = frameSize(project, options.scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create a drawing surface.');
  const count = frameCount(project, options.fps);
  for (let index = 0; index < count; index++) {
    if (signal.cancelled) throw new Error('Stopped.');
    renderFrame(ctx, project, index / options.fps, assets, width, height);
    await each(canvas, index, count);
    // Let the page breathe, so progress shows and Stop works.
    if (index % 4 === 3) await new Promise((done) => setTimeout(done, 0));
  }
}

/** GIF times its frames in hundredths of a second: the nearest rate a GIF can really play (50 a second at most). */
export const gifFps = (fps: number): number => 100 / Math.max(2, Math.round(100 / fps));

/** The animation as an animated GIF. */
export async function gifBytes(project: AnimProject, options: FrameOptions, loop: boolean, onProgress: (done: number, of: number) => void, signal: { cancelled: boolean }): Promise<Uint8Array> {
  const gif = GIFEncoder();
  const fps = gifFps(options.fps);
  const delay = Math.round(1000 / fps);
  await eachFrame(
    project,
    { ...options, fps },
    (canvas, index, count) => {
      const data = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height).data;
      const palette = quantize(data, 256, { format: 'rgb444' });
      gif.writeFrame(applyPalette(data, palette, 'rgb444'), canvas.width, canvas.height, { palette, delay, repeat: index === 0 ? (loop ? 0 : -1) : undefined });
      onProgress(index + 1, count);
    },
    signal,
  );
  gif.finish();
  return gif.bytes();
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (blob) resolve(new Uint8Array(await blob.arrayBuffer()));
      else reject(new Error('A frame could not be made into a picture.'));
    }, 'image/png');
  });
}

/** The frames as numbered PNG pictures in a ZIP archive. */
export async function framesZip(project: AnimProject, options: FrameOptions, onProgress: (done: number, of: number) => void, signal: { cancelled: boolean }): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let failed: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failed = error;
    else chunks.push(chunk);
  });
  await eachFrame(
    project,
    options,
    async (canvas, index, count) => {
      // PNG is compressed already: the archive only stores it.
      const entry = new ZipPassThrough(`frame-${String(index + 1).padStart(5, '0')}.png`);
      zip.add(entry);
      entry.push(await canvasPng(canvas), true);
      onProgress(index + 1, count);
    },
    signal,
  );
  zip.end();
  if (failed) throw failed;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

/* -------------------------------------------------------------- sound -- */

/** The bytes and media type inside a data URL. */
export function dataUrlBytes(url: string): { bytes: Uint8Array; type: string } {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) throw new Error('Not a data URL.');
  const head = url.slice(5, comma);
  const type = head.split(';')[0] || 'application/octet-stream';
  const body = url.slice(comma + 1);
  if (!/;base64$/i.test(head)) return { bytes: new TextEncoder().encode(decodeURIComponent(body)), type };
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, type };
}

/** A soundtrack decoded to samples.  Needs no click first, unlike a context that plays. */
export async function decodeSound(src: string): Promise<AudioBuffer> {
  const { bytes } = dataUrlBytes(src);
  const Offline = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const context = new Offline(2, 1, 44100);
  return context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/** The loudest sample in each of `buckets` equal stretches of the first `seconds` of a sound, 0 to 1 (0 past its end). */
export function peaksOf(sound: { readonly sampleRate: number; readonly length: number; getChannelData(channel: number): Float32Array }, seconds: number, buckets: number): number[] {
  const data = sound.getChannelData(0);
  const per = (seconds * sound.sampleRate) / buckets;
  const peaks: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket++) {
    const from = Math.floor(bucket * per);
    const to = Math.min(sound.length, Math.floor((bucket + 1) * per));
    // Long sounds are sampled, not read whole: a waveform needs the outline only.
    const step = Math.max(1, Math.floor((to - from) / 64));
    let peak = 0;
    for (let i = from; i < to; i += step) peak = Math.max(peak, Math.abs(data[i] as number));
    peaks.push(Math.min(1, peak));
  }
  return peaks;
}

/**
 * The sound as long as the animation at least, with silence after it: a looping
 * animation then starts its sound again with the picture, not when the sound runs out.
 */
export function paddedSound(sound: AudioBuffer, seconds: number, context: BaseAudioContext): AudioBuffer {
  const wanted = Math.ceil(seconds * sound.sampleRate);
  if (sound.length >= wanted) return sound;
  const padded = context.createBuffer(sound.numberOfChannels, wanted, sound.sampleRate);
  for (let channel = 0; channel < sound.numberOfChannels; channel++) padded.getChannelData(channel).set(sound.getChannelData(channel));
  return padded;
}

/* ---------------------------------------------------------- recording -- */

/** The video format this browser can record, if it can record at all. */
export function recorderType(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) return null;
  const choices: [string, string][] = [
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
    ['video/mp4', 'mp4'],
  ];
  for (const [mime, ext] of choices) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

/**
 * Records the animation as it plays, in real time, with the browser's own recorder
 * (and the soundtrack, when there is one).
 */
export async function recordVideo(
  project: AnimProject,
  options: FrameOptions,
  sound: AudioBuffer | null,
  onProgress: (done: number, of: number) => void,
  signal: { cancelled: boolean },
): Promise<{ blob: Blob; ext: string }> {
  const type = recorderType();
  if (!type) throw new Error('This browser cannot record video.');
  const assets = await loadAssets(project);
  const { width, height } = frameSize(project, options.scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing surface.');
  const length = sequenceOf(project).length;
  renderFrame(ctx, project, 0, assets, width, height);
  const stream = canvas.captureStream(options.fps);
  let audio: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  if (sound) {
    audio = new AudioContext();
    const destination = audio.createMediaStreamDestination();
    source = audio.createBufferSource();
    source.buffer = sound;
    source.connect(destination);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
  }
  const recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: Math.round(Math.min(24_000_000, Math.max(2_000_000, width * height * options.fps * 0.15))) });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  try {
    recorder.start(250);
    const began = performance.now();
    source?.start(0, 0, length);
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        const t = (performance.now() - began) / 1000;
        if (signal.cancelled) {
          reject(new Error('Stopped.'));
          return;
        }
        renderFrame(ctx, project, Math.min(t, length), assets, width, height);
        onProgress(Math.min(t, length), length);
        if (t >= length) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // A moment more, so the last frame is in the recording.
    await new Promise((done) => setTimeout(done, 150));
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    for (const track of stream.getTracks()) track.stop();
    await audio?.close();
  }
  return { blob: new Blob(chunks, { type: type.mime.split(';')[0] }), ext: type.ext };
}
