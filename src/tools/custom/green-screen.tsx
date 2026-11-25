/**
 * Green Screen Editor: removes a backdrop colour from a picture or a video
 * and puts a colour, a picture or a video of your own behind the subject.
 * Pictures are made here, at full size.  Videos are made by FFmpeg in the
 * desktop app (the preview uses the same arithmetic), or recorded as they
 * play where FFmpeg is not at hand.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { type Frame, ffmpegKey, fitRect, guessKey, hexOf, type KeySettings, keyFrame, matteFrame, type Rgb, rgbOf, type SourceColour, sourceColour, subjectRect } from '../../lib/chroma';
import { isDesktop, pickFiles, readLocalFile, saveFile } from '../../platform';
import type { PickedFile } from '../../platform/ai';
import { mediaReport, onConvertProgress, revealResult, runConversion, stopConversion, videoFrame } from '../../platform/convert';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { chooseFiles, has, usePrograms } from './_convert';
import { clamp, Segmented, usePersistentState } from './_shared';

type BackKind = 'none' | 'colour' | 'image' | 'video';
type Fit = 'cover' | 'contain' | 'stretch';
type View = 'result' | 'matte' | 'original';

interface Settings {
  readonly key: string;
  readonly similarity: number;
  readonly blend: number;
  readonly spill: number;
  readonly back: BackKind;
  readonly colour: string;
  readonly fit: Fit;
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

const num = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback);
const read = (v: Values | undefined): Settings => ({
  key: typeof v?.key === 'string' && rgbOf(v.key) ? v.key : '#00b140',
  // Whites and greys lie about 0.2 from a studio green: the two together stay well under that.
  similarity: num(v?.similarity, 0.1, 0.01, 0.6),
  blend: num(v?.blend, 0.06, 0, 0.4),
  spill: num(v?.spill, 0.5, 0, 1),
  back: v?.back === 'none' || v?.back === 'image' || v?.back === 'video' ? v.back : 'colour',
  colour: typeof v?.colour === 'string' && rgbOf(v.colour) ? v.colour : '#1f6feb',
  fit: v?.fit === 'contain' || v?.fit === 'stretch' ? v.fit : 'cover',
  scale: num(v?.scale, 1, 0.1, 2),
  x: num(v?.x, 0, -1, 1),
  y: num(v?.y, 0, -1, 1),
});
const write = (s: Settings): Values => ({ ...s });

/** A picture or a video, as the page shows it and, in the desktop app, as FFmpeg is given it. */
interface Media {
  readonly kind: 'image' | 'video';
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  /** A picture, or the frame of a desktop video that was fetched last. */
  readonly still?: HTMLImageElement | HTMLCanvasElement;
  /** A video the page plays itself (browser, or no FFmpeg). */
  readonly video?: HTMLVideoElement;
  /** The file as FFmpeg knows it (desktop). */
  readonly token?: string;
  readonly colour: SourceColour;
  readonly url?: string;
}

const PICTURES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
const VIDEOS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mts', 'mxf', 'wmv'];
const extension = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const PREVIEW = 960;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This picture could not be opened here; convert it to PNG or JPEG first.'));
    image.src = url;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error('This video could not be played here; the desktop app with FFmpeg reads more kinds of video.'));
    video.src = url;
  });
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const wanted = clamp(time, 0, Math.max(0, (video.duration || 0) - 0.05));
    if (Math.abs(video.currentTime - wanted) < 0.01 && video.readyState >= 2) {
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = wanted;
    setTimeout(done, 3000);
  });
}

async function fromFile(file: File): Promise<Media> {
  const url = URL.createObjectURL(file);
  const colour: SourceColour = { matrix: 'bt601', full: true };
  if (file.type.startsWith('video/') || VIDEOS.includes(extension(file.name))) {
    const video = await loadVideo(url);
    return { kind: 'video', name: file.name, width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : 0, video, colour, url };
  }
  const still = await loadImage(url);
  return { kind: 'image', name: file.name, width: still.naturalWidth, height: still.naturalHeight, duration: 0, still, colour, url };
}

/** A file chosen in the desktop app: pictures are read whole, videos are left to FFmpeg, which hands over frames. */
async function fromPicked(file: PickedFile): Promise<Media> {
  if (PICTURES.includes(extension(file.name))) {
    const separator = file.folder.includes('\\') ? '\\' : '/';
    const { bytes } = await readLocalFile(`${file.folder}${file.folder.endsWith(separator) ? '' : separator}${file.name}`);
    const media = await fromFile(new File([bytes as BlobPart], file.name));
    return { ...media, token: file.token };
  }
  const report = await mediaReport(file.token);
  const streams = Array.isArray(report.streams) ? (report.streams as Record<string, unknown>[]) : [];
  const stream = streams.find((s) => s.codec_type === 'video');
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!stream || !(width > 0 && height > 0)) throw new Error(`${file.name} has no picture.`);
  const duration = Number((report.format as Record<string, unknown> | undefined)?.duration) || Number(stream.duration) || 0;
  const still = await loadImage(await videoFrame(file.token, 0, PREVIEW));
  return { kind: 'video', name: file.name, width, height, duration, still, token: file.token, colour: sourceColour(stream) };
}

/** A made-up studio shot to try the tool on: a figure in front of an unevenly lit green cloth. */
function sampleShot(): Media {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const cloth = ctx.createRadialGradient(480, 220, 60, 480, 270, 620);
  cloth.addColorStop(0, '#12c556');
  cloth.addColorStop(1, '#008a33');
  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, 960, 540);
  ctx.fillStyle = '#e0ac8c';
  ctx.beginPath();
  ctx.arc(480, 190, 78, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a2a22';
  ctx.beginPath();
  ctx.arc(480, 160, 80, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.moveTo(300, 540);
  ctx.quadraticCurveTo(310, 300, 480, 290);
  ctx.quadraticCurveTo(650, 300, 660, 540);
  ctx.fill();
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(455, 300, 50, 120);
  return { kind: 'image', name: 'studio sample', width: 960, height: 540, duration: 0, still: canvas, colour: { matrix: 'bt601', full: true } };
}

function GreenScreen({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState(toolId, read, write);
  const { programs } = usePrograms();
  const ffmpeg = isDesktop && has(programs, 'ffmpeg');
  const [subject, setSubject] = useState<Media | null>(null);
  const [behind, setBehind] = useState<Media | null>(null);
  const [view, setView] = useState<View>('result');
  const [picking, setPicking] = useState(false);
  const [time, setTime] = useState(0);
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [format, setFormat] = useState('');
  const [sound, setSound] = useState<'foreground' | 'background' | 'none'>('foreground');
  const [busy, setBusy] = useState<{ label: string; fraction: number | null; id?: string } | null>(null);
  const [result, setResult] = useState<{ text: string; token?: string } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const original = useRef<Frame | null>(null);
  const stopRecording = useRef<(() => void) | null>(null);

  const key = useMemo<KeySettings>(
    () => ({ key: rgbOf(settings.key) ?? [0, 177, 64], similarity: settings.similarity, blend: settings.blend, spill: settings.spill }),
    [settings.key, settings.similarity, settings.blend, settings.spill],
  );
  const set = (change: Partial<Settings>) => setSettings((s) => ({ ...s, ...change }));

  // What can be saved depends on what is being keyed and on where.
  const formats = useMemo<{ value: string; label: string }[]>(() => {
    if (!subject) return [];
    if (subject.kind === 'image')
      return [
        { value: 'png', label: 'PNG picture' },
        { value: 'jpg', label: 'JPEG picture' },
        { value: 'webp', label: 'WebP picture' },
      ];
    if (ffmpeg && subject.token) {
      return settings.back === 'none'
        ? [
            { value: 'webm-alpha', label: 'WebM video, see-through' },
            { value: 'mov-alpha', label: 'MOV video (ProRes 4444), see-through' },
          ]
        : [
            { value: 'mp4', label: 'MP4 video (H.264)' },
            { value: 'webm', label: 'WebM video (VP9)' },
          ];
    }
    return [{ value: 'record', label: 'WebM video, recorded as it plays' }];
  }, [subject, ffmpeg, settings.back]);
  const chosenFormat = formats.some((f) => f.value === format) ? format : (formats[0]?.value ?? '');

  /** Draws the scene on a canvas of any size: the background, then the subject with its backdrop removed. */
  const paint = (target: HTMLCanvasElement, front: CanvasImageSource, back: CanvasImageSource | null, backSize: { width: number; height: number } | null, mode: View) => {
    const { width, height } = target;
    const ctx = target.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not create a drawing surface.');
    const work = document.createElement('canvas');
    work.width = width;
    work.height = height;
    const pen = work.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    pen.drawImage(front, 0, 0, width, height);
    const image = pen.getImageData(0, 0, width, height);
    if (target === canvas.current) original.current = { data: new Uint8ClampedArray(image.data), width, height };
    ctx.clearRect(0, 0, width, height);
    if (mode === 'original') {
      ctx.putImageData(image, 0, 0);
      return;
    }
    const matrix = subject?.colour.matrix ?? 'bt601';
    if (mode === 'matte') {
      ctx.putImageData(new ImageData(matteFrame(image, key, matrix) as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
      return;
    }
    pen.putImageData(new ImageData(keyFrame(image, key, matrix) as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    if (settings.back === 'colour') {
      ctx.fillStyle = settings.colour;
      ctx.fillRect(0, 0, width, height);
    } else if (settings.back !== 'none' && back && backSize) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      const place = fitRect(backSize.width, backSize.height, width, height, settings.fit);
      ctx.drawImage(back, place.x, place.y, place.width, place.height);
    }
    // Without a background the whole frame is the subject: nothing to move it against.
    const place = settings.back === 'none' ? { x: 0, y: 0, width, height } : subjectRect(width, height, settings.scale, settings.x, settings.y);
    ctx.drawImage(work, place.x, place.y, place.width, place.height);
  };

  const frontOf = (media: Media) => media.video ?? media.still ?? null;
  const backOf = () => (behind && (settings.back === 'image' || settings.back === 'video') ? frontOf(behind) : null);

  // The preview: redrawn when anything it shows changes.
  useEffect(() => {
    const target = canvas.current;
    const front = subject ? frontOf(subject) : null;
    if (!target || !subject || !front) return;
    const fit = Math.min(1, PREVIEW / Math.max(subject.width, subject.height));
    target.width = Math.max(2, Math.round(subject.width * fit));
    target.height = Math.max(2, Math.round(subject.height * fit));
    try {
      paint(target, front, backOf(), behind ? { width: behind.width, height: behind.height } : null, picking ? 'original' : view);
    } catch {
      /* A frame that is not ready yet is drawn on the next tick. */
    }
  }, [subject, behind, settings, view, picking, tick, key]);

  // A video's frame at the chosen time: the page seeks its own video; FFmpeg is asked for a frame otherwise.
  useEffect(() => {
    if (subject?.kind !== 'video' || playing) return;
    let alive = true;
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            if (subject.video) await seek(subject.video, time);
            else if (subject.token) {
              const still = await loadImage(await videoFrame(subject.token, time, PREVIEW));
              if (alive) setSubject((s) => (s && s.token === subject.token ? { ...s, still } : s));
            }
            if (behind?.kind === 'video') {
              const at = behind.duration > 0 ? time % behind.duration : 0;
              if (behind.video) await seek(behind.video, at);
              else if (behind.token) {
                const still = await loadImage(await videoFrame(behind.token, at, PREVIEW));
                if (alive) setBehind((b) => (b && b.token === behind.token ? { ...b, still } : b));
              }
            }
            if (alive) setTick((n) => n + 1);
          } catch {
            /* A moment with no frame leaves the last one showing. */
          }
        })();
      },
      subject.video ? 0 : 160,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [time, subject?.token, subject?.video, behind?.token, behind?.video, playing]);

  // Playing in the page: every frame is keyed as it comes.
  useEffect(() => {
    const video = subject?.video;
    if (!playing || !video) return;
    let frame = 0;
    const loop = () => {
      setTick((n) => n + 1);
      setTime(video.currentTime);
      if (video.ended || video.paused) setPlaying(false);
      else frame = requestAnimationFrame(loop);
    };
    void video.play().then(() => {
      void behind?.video?.play().catch(() => undefined);
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      video.pause();
      behind?.video?.pause();
    };
  }, [playing, subject?.video, behind?.video]);

  // Object URLs are let go when their file is replaced or the tool closes.
  useEffect(() => () => void (subject?.url && URL.revokeObjectURL(subject.url)), [subject?.url]);
  useEffect(() => () => void (behind?.url && URL.revokeObjectURL(behind.url)), [behind?.url]);

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | null = null;
    void onConvertProgress((p) => setBusy((b) => (b?.id === p.id ? { ...b, fraction: p.fraction } : b))).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const take = (media: Media, role: 'subject' | 'behind') => {
    setPlaying(false);
    setResult(null);
    if (role === 'behind') {
      if (media.video) media.video.loop = true;
      setBehind(media);
      set({ back: media.kind });
    } else {
      setSubject(media);
      setTime(0);
      setView('result');
      // The backdrop colour is read off the edges of the first frame.
      const front = frontOf(media);
      if (front) {
        const probe = document.createElement('canvas');
        probe.width = 160;
        probe.height = Math.max(2, Math.round((160 * media.height) / media.width));
        const pen = probe.getContext('2d', { willReadFrequently: true });
        if (pen) {
          pen.drawImage(front, 0, 0, probe.width, probe.height);
          set({ key: hexOf(guessKey(pen.getImageData(0, 0, probe.width, probe.height))) });
        }
      }
    }
    setTick((n) => n + 1);
  };

  const choose = (role: 'subject' | 'behind', only?: 'image' | 'video') =>
    attempt(async () => {
      const kinds = only === 'image' ? PICTURES : only === 'video' ? VIDEOS : [...PICTURES, ...VIDEOS];
      if (ffmpeg) {
        const [file] = await chooseFiles(false, only === 'image' ? 'Pictures' : only === 'video' ? 'Videos' : 'Pictures and videos', kinds);
        if (file) take(await fromPicked(file), role);
      } else {
        const [file] = await pickFiles(only === 'image' ? 'image/*' : only === 'video' ? 'video/*' : 'image/*,video/*');
        if (file) take(await fromFile(file), role);
      }
    });

  const pick = (event: PointerEvent) => {
    const frame = original.current;
    const target = canvas.current;
    if (!picking || !frame || !target) return;
    const rect = target.getBoundingClientRect();
    const cx = Math.round(((event.clientX - rect.left) / rect.width) * frame.width);
    const cy = Math.round(((event.clientY - rect.top) / rect.height) * frame.height);
    // The mean of a small patch, so that noise in one pixel does not decide the colour.
    const sum = [0, 0, 0];
    let count = 0;
    for (let y = Math.max(0, cy - 3); y <= Math.min(frame.height - 1, cy + 3); y++) {
      for (let x = Math.max(0, cx - 3); x <= Math.min(frame.width - 1, cx + 3); x++) {
        const p = (y * frame.width + x) * 4;
        sum[0] = (sum[0] as number) + (frame.data[p] as number);
        sum[1] = (sum[1] as number) + (frame.data[p + 1] as number);
        sum[2] = (sum[2] as number) + (frame.data[p + 2] as number);
        count += 1;
      }
    }
    if (count) set({ key: hexOf(sum.map((v) => v / count) as unknown as Rgb) });
    setPicking(false);
  };

  /** The background at full size for a picture: its own pixels, or the frame of a video at the chosen time. */
  const backAtFullSize = async (): Promise<{ source: CanvasImageSource; width: number; height: number } | null> => {
    if (!behind || (settings.back !== 'image' && settings.back !== 'video')) return null;
    if (behind.video) return { source: behind.video, width: behind.width, height: behind.height };
    if (behind.kind === 'video' && behind.token) {
      const frame = await loadImage(await videoFrame(behind.token, behind.duration > 0 ? time % behind.duration : 0, 1920));
      return { source: frame, width: frame.naturalWidth, height: frame.naturalHeight };
    }
    return behind.still ? { source: behind.still, width: behind.width, height: behind.height } : null;
  };

  const savePicture = async (media: Media, type: string) => {
    const front = frontOf(media);
    if (!front) return;
    setBusy({ label: 'Making the picture', fraction: null });
    await new Promise((done) => setTimeout(done, 30));
    const out = document.createElement('canvas');
    out.width = media.width;
    out.height = media.height;
    const back = await backAtFullSize();
    if (type !== 'png' && settings.back === 'none') {
      // JPEG has no transparency: what would be see-through is white.
      const flat = document.createElement('canvas');
      flat.width = out.width;
      flat.height = out.height;
      paint(out, front, null, null, 'result');
      const pen = flat.getContext('2d') as CanvasRenderingContext2D;
      pen.fillStyle = '#ffffff';
      pen.fillRect(0, 0, flat.width, flat.height);
      pen.drawImage(out, 0, 0);
      out.getContext('2d')?.drawImage(flat, 0, 0);
    } else paint(out, front, back?.source ?? null, back, 'result');
    const mime = type === 'jpg' ? 'image/jpeg' : type === 'webp' ? 'image/webp' : 'image/png';
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, mime, 0.92));
    if (!blob) throw new Error('The picture could not be made.');
    const name = `${media.name.replace(/\.[^.]+$/, '')} (${settings.back === 'none' ? 'keyed' : 'new background'}).${type}`;
    const outcome = await saveFile(name, blob, mime);
    if (outcome.saved) setResult({ text: `Saved ${name} (${out.width} × ${out.height}, ${formatBytes(blob.size)}) to ${outcome.location}` });
  };

  const saveWithFfmpeg = async (media: Media, to: string) => {
    if (!media.token) return;
    const inputs = [media.token];
    if (settings.back === 'image' || settings.back === 'video') {
      if (!behind?.token) throw new Error('Choose the background first.');
      inputs.push(behind.token);
    }
    const id = `green-${Date.now()}`;
    setBusy({ label: 'FFmpeg is making the video', fraction: 0, id });
    const stated = ffmpegKey(key, media.colour);
    const options = { ...stated, background: settings.back, colour: settings.colour, fit: settings.fit, scale: settings.scale, x: settings.x, y: settings.y, to, audio: sound };
    const made = await runConversion({ id, recipe: 'video-greenscreen', inputs, options, destination: 'ask' });
    if (made) {
      setResult({ text: `Saved ${made.name} (${formatBytes(made.size)}) to ${made.path}`, token: made.token });
      notify(`Saved to ${made.path}`);
    }
  };

  /** Without FFmpeg: the video plays once, keyed frame by frame, and the browser records the result with its sound. */
  const record = async (media: Media) => {
    const video = media.video;
    if (!video || typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video; use the desktop app with FFmpeg.');
    const fit = Math.min(1, 1920 / Math.max(media.width, media.height));
    const out = document.createElement('canvas');
    out.width = Math.max(2, Math.round((media.width * fit) / 2) * 2);
    out.height = Math.max(2, Math.round((media.height * fit) / 2) * 2);
    const stream = out.captureStream(30);
    const tap = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    for (const track of tap?.getAudioTracks() ?? []) stream.addTrack(track);
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    setPlaying(false);
    await seek(video, 0);
    if (behind?.video) await seek(behind.video, 0);
    video.muted = false;
    setBusy({ label: 'Recording as it plays', fraction: 0 });
    let cancelled = false;
    stopRecording.current = () => {
      cancelled = true;
      video.pause();
    };
    try {
      recorder.start(250);
      await video.play();
      void behind?.video?.play().catch(() => undefined);
      await new Promise<void>((resolve) => {
        const step = () => {
          try {
            paint(out, video, backOf(), behind ? { width: behind.width, height: behind.height } : null, 'result');
          } catch {
            /* A frame that cannot be read is skipped. */
          }
          setBusy((b) => (b ? { ...b, fraction: media.duration > 0 ? video.currentTime / media.duration : null } : b));
          if (video.ended || video.paused || cancelled) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      await new Promise((done) => setTimeout(done, 150));
    } finally {
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      video.pause();
      behind?.video?.pause();
      video.muted = true;
      for (const track of stream.getTracks()) track.stop();
      stopRecording.current = null;
    }
    if (cancelled) return;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const name = `${media.name.replace(/\.[^.]+$/, '')} (new background).webm`;
    const outcome = await saveFile(name, blob, 'video/webm');
    if (outcome.saved) setResult({ text: `Saved ${name} (${out.width} × ${out.height}, ${formatBytes(blob.size)}) to ${outcome.location}` });
  };

  const save = () =>
    attempt(async () => {
      if (!subject || busy) return;
      setResult(null);
      try {
        if (subject.kind === 'image') await savePicture(subject, chosenFormat);
        else if (chosenFormat === 'record') await record(subject);
        else await saveWithFfmpeg(subject, chosenFormat);
      } finally {
        setBusy(null);
      }
    });

  const stop = () => {
    if (busy?.id) void stopConversion(busy.id);
    stopRecording.current?.();
  };

  const slider = (label: string, field: 'similarity' | 'blend' | 'spill' | 'scale' | 'x' | 'y', min: number, max: number, step: number, show: (value: number) => string, testId: string) => (
    <label class="gs-slider">
      <span class="control-label">
        {label} <span class="tone-muted">{show(settings[field])}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={settings[field]} onInput={(e) => set({ [field]: Number(e.currentTarget.value) })} data-testid={testId} />
    </label>
  );
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <section class="tool gs-tool" data-testid="tool" data-state={subject ? 'done' : 'idle'}>
      <div class="button-row gs-bar">
        <button type="button" class="button button-small button-primary" onClick={() => choose('subject')} data-testid="gs-open">
          <Icon name="open" size={15} /> Open a picture or video
        </button>
        <button type="button" class="button button-small button-quiet" onClick={() => take(sampleShot(), 'subject')} data-testid="gs-sample">
          <Icon name="sample" size={15} /> Sample
        </button>
        {subject && (
          <span class="tone-muted" data-testid="gs-info">
            {subject.name} · {subject.width} × {subject.height}
            {subject.kind === 'video' ? ` · ${subject.duration.toFixed(1)} s` : ''}
          </span>
        )}
      </div>

      <div class="gs-main">
        <div class="gs-stage">
          {subject ? (
            <canvas
              ref={canvas}
              class={`gs-canvas${picking ? ' is-picking' : ''}`}
              role="img"
              aria-label={picking ? 'The picture as it was: click the backdrop colour' : view === 'matte' ? 'Matte: white stays, black goes' : 'Preview'}
              onPointerDown={pick}
              data-testid="gs-canvas"
            />
          ) : (
            <p class="gs-empty">Open a picture or a video filmed against a green or blue backdrop, or try the sample.</p>
          )}
          {subject && (
            <div class="gs-under">
              <Segmented
                value={view}
                label="Show"
                onChange={setView}
                choices={[
                  { value: 'result', label: 'Result' },
                  { value: 'matte', label: 'Matte' },
                  { value: 'original', label: 'Original' },
                ]}
              />
              {subject.kind === 'video' && (
                <>
                  {subject.video && (
                    <button type="button" class="button button-small" onClick={() => setPlaying((on) => !on)} aria-label={playing ? 'Pause' : 'Play'} data-testid="gs-play">
                      <Icon name={playing ? 'pause' : 'play'} size={14} /> {playing ? 'Pause' : 'Play'}
                    </button>
                  )}
                  <label class="gs-time">
                    <span class="control-label">At {time.toFixed(1)} s</span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0.1, subject.duration)}
                      step={0.1}
                      value={time}
                      onInput={(e) => {
                        setPlaying(false);
                        setTime(Number(e.currentTarget.value));
                      }}
                      data-testid="gs-time"
                    />
                  </label>
                </>
              )}
            </div>
          )}
          {subject?.kind === 'video' && !subject.video && <p class="control-help">The preview is one frame at a time, fetched by FFmpeg: move the slider to check other moments.</p>}
        </div>

        <div class="gs-side">
          <div class="gs-panel">
            <span class="pane-title">Backdrop to remove</span>
            <div class="gs-row">
              <label class="gs-field">
                <span class="control-label">Colour</span>
                <input type="color" value={settings.key} onInput={(e) => set({ key: e.currentTarget.value })} data-testid="gs-key" />
              </label>
              <button type="button" class="button button-small" aria-pressed={picking} disabled={!subject} onClick={() => setPicking((on) => !on)} data-testid="gs-pick">
                {picking ? 'Click the backdrop…' : 'Pick from the picture'}
              </button>
              <button type="button" class="button button-small button-quiet" onClick={() => set({ key: '#00b140' })}>
                Green
              </button>
              <button type="button" class="button button-small button-quiet" onClick={() => set({ key: '#0047bb' })}>
                Blue
              </button>
            </div>
            {slider('Tolerance', 'similarity', 0.01, 0.6, 0.005, (v) => v.toFixed(3), 'gs-similarity')}
            {slider('Soft edge', 'blend', 0, 0.4, 0.005, (v) => v.toFixed(3), 'gs-blend')}
            {slider('Remove the colour’s tint', 'spill', 0, 1, 0.05, percent, 'gs-spill')}
            <p class="control-help">
              Raise the tolerance until the backdrop is gone in the matte (all black), and no further: the subject must stay white. Whites and greys are the first to turn see-through when it is pushed
              too far.
            </p>
          </div>

          <div class="gs-panel">
            <span class="pane-title">Behind the subject</span>
            <Segmented
              value={settings.back}
              label="Background"
              onChange={(back) => {
                set({ back });
                if ((back === 'image' || back === 'video') && behind?.kind !== back) choose('behind', back);
              }}
              choices={[
                { value: 'colour', label: 'Colour' },
                { value: 'image', label: 'Picture' },
                { value: 'video', label: 'Video' },
                { value: 'none', label: 'Nothing' },
              ]}
            />
            {settings.back === 'colour' && (
              <label class="gs-field">
                <span class="control-label">Colour</span>
                <input type="color" value={settings.colour} onInput={(e) => set({ colour: e.currentTarget.value })} data-testid="gs-colour" />
              </label>
            )}
            {(settings.back === 'image' || settings.back === 'video') && (
              <div class="gs-row">
                <button type="button" class="button button-small" onClick={() => choose('behind', settings.back === 'image' ? 'image' : 'video')} data-testid="gs-back">
                  <Icon name="open" size={14} /> {behind?.kind === settings.back ? 'Change' : 'Choose'} the {settings.back === 'image' ? 'picture' : 'video'}
                </button>
                {behind?.kind === settings.back && <span class="tone-muted">{behind.name}</span>}
                <label class="gs-field">
                  <span class="control-label">Fit</span>
                  <select class="select select-small" value={settings.fit} onChange={(e) => set({ fit: e.currentTarget.value as Fit })} data-testid="gs-fit">
                    <option value="cover">Fill the frame</option>
                    <option value="contain">Fit inside it</option>
                    <option value="stretch">Stretch</option>
                  </select>
                </label>
              </div>
            )}
            {settings.back === 'none' ? (
              <p class="control-help">The backdrop becomes see-through: save as PNG, or as video that keeps transparency.</p>
            ) : (
              <>
                {slider('Subject size', 'scale', 0.1, 2, 0.01, percent, 'gs-scale')}
                {slider('Move sideways', 'x', -1, 1, 0.01, percent, 'gs-x')}
                {slider('Move up or down', 'y', -1, 1, 0.01, percent, 'gs-y')}
              </>
            )}
          </div>

          <div class="gs-panel">
            <span class="pane-title">Save</span>
            <div class="gs-row">
              <label class="gs-field">
                <span class="control-label">As</span>
                <select class="select select-small" value={chosenFormat} disabled={!subject || !!busy} onChange={(e) => setFormat(e.currentTarget.value)} data-testid="gs-format">
                  {formats.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              {subject?.kind === 'video' && chosenFormat !== 'record' && (
                <label class="gs-field">
                  <span class="control-label">Sound</span>
                  <select class="select select-small" value={sound} onChange={(e) => setSound(e.currentTarget.value as typeof sound)}>
                    <option value="foreground">From the subject’s video</option>
                    {settings.back === 'video' && <option value="background">From the background video</option>}
                    <option value="none">None</option>
                  </select>
                </label>
              )}
              {busy ? (
                <button type="button" class="button button-small" onClick={stop} disabled={!busy.id && !stopRecording.current} data-testid="gs-stop">
                  <Icon name="close" size={13} /> Stop
                </button>
              ) : (
                <button type="button" class="button button-small button-primary" onClick={save} disabled={!subject} data-testid="gs-save">
                  <Icon name="save" size={14} /> Save
                </button>
              )}
            </div>
            {busy && (
              <div class="gs-progress" data-testid="gs-progress">
                <progress max={1} value={busy.fraction ?? undefined} aria-label={busy.label} />
                <span>
                  {busy.label}
                  {busy.fraction !== null ? `: ${Math.round(busy.fraction * 100)}%` : '…'}
                </span>
              </div>
            )}
            {result && (
              <p class="gs-result" role="status" data-testid="gs-result">
                <Icon name="check" size={14} /> {result.text}
                {result.token && (
                  <button type="button" class="button button-small button-quiet" onClick={() => attempt(() => revealResult(result.token as string))}>
                    <Icon name="open" size={13} /> Show in folder
                  </button>
                )}
              </p>
            )}
            <p class="control-help">
              {subject?.kind === 'video'
                ? ffmpeg
                  ? 'FFmpeg on this computer makes the video at its full size and length, with the same keying as the preview.'
                  : isDesktop
                    ? 'FFmpeg was not found, so the video is recorded as it plays (up to 1920 pixels wide, in real time). Install FFmpeg for full-quality MP4.'
                    : 'In a browser the video is recorded as it plays (up to 1920 pixels wide, in real time); the desktop app makes full-quality MP4 with FFmpeg.'
                : 'Pictures are made here at their full size; nothing leaves this computer.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(GreenScreen);
