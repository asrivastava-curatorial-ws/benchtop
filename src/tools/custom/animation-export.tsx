/**
 * Animation Studio's video export: the frames are drawn on a canvas here, then
 * joined into an MP4 or WebM by FFmpeg (desktop app), recorded by the browser,
 * or saved as a GIF or as numbered pictures.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type AnimProject, sequenceOf } from '../../lib/animation';
import { canvasPng, dataUrlBytes, eachFrame, frameCount, frameSize, framesZip, gifBytes, gifFps, recorderType, recordVideo } from '../../lib/animation-render';
import { formatBytes } from '../../lib/bytes';
import { isDesktop, saveFile } from '../../platform';
import { findPrograms, revealResult } from '../../platform/convert';
import { addFrame, addSound, beginFrames, cancelFrames, encodeFrames, endFrames, onFramesProgress } from '../../platform/frames';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';

type Format = 'mp4' | 'webm' | 'record' | 'gif' | 'png';

const RATES = [10, 12, 15, 20, 24, 25, 30, 50, 60];
const SIZES: readonly (readonly [number, string])[] = [
  [2, 'Double'],
  [1, 'Full size'],
  [0.5, 'Half'],
  [0.25, 'Quarter'],
];
/** Frames kept in memory at once (GIF and pictures are built here, not on disk). */
const MAX_IN_MEMORY = 3000;

interface Props {
  readonly project: AnimProject;
  readonly name: string;
  readonly loop: boolean;
  /** The decoded soundtrack, for recording in the browser. */
  readonly sound: AudioBuffer | null;
}

export function ExportPanel({ project, name, loop, sound }: Props) {
  const recorder = useMemo(() => recorderType(), []);
  const [ffmpeg, setFfmpeg] = useState<boolean | null>(isDesktop ? null : false);
  const [format, setFormat] = useState<Format>(recorder ? 'record' : 'gif');
  const [scale, setScale] = useState(1);
  const [fps, setFps] = useState(() => {
    const own = sequenceOf(project).subUnitsPerUnit;
    return RATES.includes(own) ? own : 30;
  });
  const [progress, setProgress] = useState<{ label: string; fraction: number } | null>(null);
  const [result, setResult] = useState<{ text: string; token?: string } | null>(null);
  const job = useRef<{ signal: { cancelled: boolean }; id: string | null } | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    let alive = true;
    findPrograms()
      .then((found) => {
        if (!alive) return;
        const has = !!found.programs.ffmpeg;
        setFfmpeg(has);
        if (has) setFormat('mp4');
      })
      .catch(() => {
        if (alive) setFfmpeg(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Leaving the page stops an export that is under way.
  useEffect(
    () => () => {
      const running = job.current;
      if (!running) return;
      running.signal.cancelled = true;
      if (running.id) void cancelFrames(running.id).catch(() => undefined);
    },
    [],
  );

  const length = sequenceOf(project).length;
  const rate = format === 'gif' ? gifFps(fps) : fps;
  const size = frameSize(project, scale);
  const count = frameCount(project, rate);
  const hasSound = !!project.audio;
  const tooMany = (format === 'gif' || format === 'png') && count > MAX_IN_MEMORY;

  const choices: { value: Format; label: string; available: boolean }[] = [
    { value: 'mp4', label: 'MP4 video (H.264)', available: ffmpeg === true },
    { value: 'webm', label: 'WebM video (VP9)', available: ffmpeg === true },
    { value: 'record', label: `Recorded here (${recorder?.ext === 'mp4' ? 'MP4' : 'WebM'}, in real time)`, available: !!recorder },
    { value: 'gif', label: 'Animated GIF', available: true },
    { value: 'png', label: 'PNG pictures, one per frame (ZIP)', available: true },
  ];

  const stop = () => {
    const running = job.current;
    if (!running) return;
    running.signal.cancelled = true;
    if (running.id) void cancelFrames(running.id).catch(() => undefined);
  };

  const run = () =>
    attempt(async () => {
      if (job.current) return;
      const signal = { cancelled: false };
      job.current = { signal, id: null };
      setResult(null);
      setProgress({ label: 'Drawing frames', fraction: 0 });
      const drawn = (done: number, of: number) => setProgress({ label: 'Drawing frames', fraction: of > 0 ? done / of : 0 });
      try {
        if (format === 'gif') {
          const bytes = await gifBytes(project, { fps, scale }, loop, drawn, signal);
          const outcome = await saveFile(`${name}.gif`, bytes, 'image/gif');
          if (outcome.saved) setResult({ text: `Saved ${name}.gif (${formatBytes(bytes.length)}) to ${outcome.location}` });
        } else if (format === 'png') {
          const blob = await framesZip(project, { fps, scale }, drawn, signal);
          const outcome = await saveFile(`${name}-frames.zip`, blob, 'application/zip');
          if (outcome.saved) setResult({ text: `Saved ${count} pictures in ${name}-frames.zip (${formatBytes(blob.size)}) to ${outcome.location}` });
        } else if (format === 'record') {
          const recorded = await recordVideo(project, { fps, scale }, sound, (done, of) => setProgress({ label: 'Recording as it plays', fraction: of > 0 ? done / of : 0 }), signal);
          const file = `${name}.${recorded.ext}`;
          const outcome = await saveFile(file, recorded.blob, recorded.blob.type);
          if (outcome.saved) setResult({ text: `Saved ${file} (${formatBytes(recorded.blob.size)}) to ${outcome.location}` });
        } else {
          const id = await beginFrames();
          job.current = { signal, id };
          try {
            await eachFrame(
              project,
              { fps, scale },
              async (canvas, index, total) => {
                await addFrame(id, index, await canvasPng(canvas));
                drawn(index + 1, total);
              },
              signal,
            );
            if (project.audio) {
              const audio = dataUrlBytes(project.audio.src);
              await addSound(id, audio.bytes, audio.type);
            }
            setProgress({ label: 'Joining the frames with FFmpeg', fraction: 0 });
            const unlisten = await onFramesProgress(id, (fraction) => setProgress({ label: 'Joining the frames with FFmpeg', fraction }));
            try {
              const video = await encodeFrames(id, { fps, format, name });
              if (!video.cancelled && video.path) {
                setResult({ text: `Saved ${video.name} (${formatBytes(video.size ?? 0)}) to ${video.path}`, token: video.token });
                notify(`Saved to ${video.path}`);
              }
            } finally {
              unlisten();
            }
          } finally {
            await endFrames(id).catch(() => undefined);
          }
        }
      } finally {
        job.current = null;
        setProgress(null);
      }
    });

  return (
    <div class="anim-export" data-testid="anim-export">
      <div class="anim-export-row">
        <label class="anim-field-inline">
          <span class="control-label">Format</span>
          <select class="select select-small" value={format} disabled={!!progress} onChange={(e) => setFormat(e.currentTarget.value as Format)} data-testid="anim-export-format">
            {choices.map((choice) => (
              <option key={choice.value} value={choice.value} disabled={!choice.available}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label class="anim-field-inline">
          <span class="control-label">Size</span>
          <select class="select select-small" value={String(scale)} disabled={!!progress} onChange={(e) => setScale(Number(e.currentTarget.value))} data-testid="anim-export-size">
            {SIZES.map(([value, label]) => {
              const made = frameSize(project, value);
              return (
                <option key={value} value={value}>
                  {label} ({made.width} × {made.height})
                </option>
              );
            })}
          </select>
        </label>
        <label class="anim-field-inline">
          <span class="control-label">Frames per second</span>
          <select class="select select-small" value={String(fps)} disabled={!!progress} onChange={(e) => setFps(Number(e.currentTarget.value))} data-testid="anim-export-fps">
            {RATES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {progress ? (
          <button type="button" class="button button-small" onClick={stop} data-testid="anim-export-stop">
            <Icon name="close" size={13} /> Stop
          </button>
        ) : (
          <button type="button" class="button button-small button-primary" onClick={run} disabled={tooMany} data-testid="anim-export-run">
            <Icon name="save" size={14} /> Export
          </button>
        )}
      </div>
      <p class="control-help" data-testid="anim-export-note">
        {count} frames of {size.width} × {size.height} over {Number(length.toFixed(2))} s
        {format === 'gif' && Math.abs(rate - fps) > 0.01 ? ` (a GIF can play ${Number(rate.toFixed(2))} frames a second here, not ${fps})` : ''}.{' '}
        {format === 'mp4' || format === 'webm'
          ? `FFmpeg on this computer joins the frames${hasSound ? ' and the sound' : ''}.`
          : format === 'record'
            ? `The animation plays once and the browser records it${hasSound ? ' with its sound' : ''}: it takes as long as the animation, and this window must stay in front.`
            : format === 'gif'
              ? `A GIF has 256 colours a frame and no sound${hasSound ? ' (the soundtrack is left out)' : ''}.`
              : `Numbered PNG pictures for a video editor${hasSound ? '; the soundtrack is left out' : ''}.`}
        {tooMany ? ` That is more than ${MAX_IN_MEMORY} frames: use fewer frames per second${ffmpeg ? ', or MP4' : ''}.` : ''}
      </p>
      {isDesktop && ffmpeg === false && <p class="control-help">MP4 and WebM need FFmpeg, which was not found on this computer. Install it, then open this tool again.</p>}
      {!isDesktop && <p class="control-help">MP4 with sound is made by the desktop app, which uses FFmpeg on your computer.</p>}
      {progress && (
        <div class="anim-export-progress" data-testid="anim-export-progress">
          <progress max={1} value={progress.fraction} aria-label={progress.label} />
          <span>
            {progress.label}: {Math.round(progress.fraction * 100)}%
          </span>
        </div>
      )}
      {result && (
        <p class="anim-export-result" role="status" data-testid="anim-export-result">
          <Icon name="check" size={14} /> {result.text}
          {result.token && (
            <button type="button" class="button button-small button-quiet" onClick={() => attempt(() => revealResult(result.token as string))}>
              <Icon name="open" size={13} /> Show in folder
            </button>
          )}
        </p>
      )}
    </div>
  );
}
