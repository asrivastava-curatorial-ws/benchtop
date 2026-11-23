/**
 * Media Info (everything FFprobe reports about a video or audio file) and
 * Screen and Voice Recorder (records the screen, a window, a tab or the
 * microphone with the browser engine's own recorder).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { copyText, isDesktop, saveFile } from '../../platform';
import { type PickedFile, pickPaths, stageFile } from '../../platform/ai';
import { mediaReport } from '../../platform/convert';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { ProgramGate } from './_convert';
import { type SegmentChoice, Segmented, usePersistentState } from './_shared';

/* ------------------------------------------------------------- media info -- */

type Json = Record<string, unknown>;
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));

const duration = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds - h * 3600 - m * 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${s.toFixed(3).padStart(6, '0')}`;
};
const bytes = (n: number | null) => (n === null ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`);
const bitrate = (n: number | null) => (n === null || !n ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(2)} Mb/s` : `${Math.round(n / 1e3)} kb/s`);
const fraction = (v: unknown) => {
  const [a, b] = str(v).split('/').map(Number);
  return a && b ? a / b : null;
};

interface Section {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
}

/** Turns ffprobe's JSON into readable sections. */
export function describe(report: Json): Section[] {
  const format = (report.format ?? {}) as Json;
  const tags = (format.tags ?? {}) as Json;
  const sections: Section[] = [];
  const general: [string, string][] = [
    ['Container', `${str(format.format_long_name)}${format.format_name ? ` (${str(format.format_name)})` : ''}`],
    ['Duration', duration(num(format.duration))],
    ['Size', bytes(num(format.size))],
    ['Overall bit rate', bitrate(num(format.bit_rate))],
  ];
  for (const key of ['title', 'artist', 'album', 'date', 'creation_time', 'encoder', 'comment', 'copyright', 'location', 'com.apple.quicktime.make', 'com.apple.quicktime.model'])
    if (tags[key])
      general.push([
        key
          .replace(/^com\.apple\.quicktime\./, '')
          .replace(/_/g, ' ')
          .replace(/^./, (c) => c.toUpperCase()),
        str(tags[key]),
      ]);
  sections.push({ title: 'General', rows: general.filter(([, v]) => v) });

  const streams = (report.streams ?? []) as Json[];
  for (const s of streams) {
    const type = str(s.codec_type);
    const t = (s.tags ?? {}) as Json;
    const disp = (s.disposition ?? {}) as Record<string, number>;
    const rows: [string, string][] = [['Codec', `${str(s.codec_long_name) || str(s.codec_name)}${s.profile ? `, ${str(s.profile)}` : ''}`]];
    if (type === 'video') {
      const fps = fraction(s.avg_frame_rate) ?? fraction(s.r_frame_rate);
      const transfer = str(s.color_transfer);
      const hdr = transfer === 'smpte2084' ? 'HDR10 / PQ' : transfer === 'arib-std-b67' ? 'HLG' : '';
      const side = (s.side_data_list ?? []) as Json[];
      const rotation = side.find((d) => d.rotation !== undefined)?.rotation ?? t.rotate;
      rows.push(
        ['Picture', `${str(s.width)} × ${str(s.height)}${s.display_aspect_ratio && s.display_aspect_ratio !== '0:1' ? ` (shown ${str(s.display_aspect_ratio)})` : ''}`],
        ['Frame rate', fps ? `${fps.toFixed(3).replace(/\.?0+$/, '')} fps${str(s.r_frame_rate) !== str(s.avg_frame_rate) ? ' (variable)' : ''}` : ''],
        ['Pixels', [str(s.pix_fmt), s.bits_per_raw_sample ? `${str(s.bits_per_raw_sample)}-bit` : ''].filter(Boolean).join(', ')],
        ['Colour', [str(s.color_space), str(s.color_primaries), transfer, str(s.color_range) === 'pc' ? 'full range' : str(s.color_range) === 'tv' ? 'limited range' : ''].filter(Boolean).join(', ')],
        ['HDR', hdr],
        ['Scan', str(s.field_order) && str(s.field_order) !== 'progressive' ? `interlaced (${str(s.field_order)})` : str(s.field_order) ? 'progressive' : ''],
        ['Rotation', rotation !== undefined ? `${str(rotation)}°` : ''],
      );
    } else if (type === 'audio') {
      rows.push(
        ['Channels', `${str(s.channels)}${s.channel_layout ? ` (${str(s.channel_layout)})` : ''}`],
        ['Sample rate', s.sample_rate ? `${(Number(s.sample_rate) / 1000).toString()} kHz` : ''],
        ['Sample format', [str(s.sample_fmt), s.bits_per_raw_sample && s.bits_per_raw_sample !== '0' ? `${str(s.bits_per_raw_sample)}-bit` : ''].filter(Boolean).join(', ')],
      );
    } else if (type === 'attachment') {
      rows.push(['File', str(t.filename)], ['Type', str(t.mimetype)]);
    }
    rows.push(
      ['Bit rate', bitrate(num(s.bit_rate))],
      ['Duration', duration(num(s.duration))],
      ['Frames', str(s.nb_frames)],
      ['Language', str(t.language) === 'und' ? '' : str(t.language)],
      ['Title', str(t.title)],
      [
        'Flags',
        Object.entries(disp)
          .filter(([k, v]) => v && ['default', 'forced', 'hearing_impaired', 'visual_impaired', 'commentary', 'attached_pic'].includes(k))
          .map(([k]) => k.replace('_', ' '))
          .join(', '),
      ],
    );
    const kind = type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : type === 'subtitle' ? 'Subtitles' : type === 'attachment' ? 'Attachment' : 'Data';
    sections.push({ title: `${kind} stream ${str(s.index)}`, rows: rows.filter(([, v]) => v) });
  }
  const chapters = (report.chapters ?? []) as Json[];
  if (chapters.length)
    sections.push({
      title: `Chapters (${chapters.length})`,
      rows: chapters.map((c, i) => [duration(num(c.start_time)), str(((c.tags ?? {}) as Json).title) || `Chapter ${i + 1}`] as const),
    });
  return sections;
}

const asText = (name: string, sections: readonly Section[]) => [name, '', ...sections.flatMap((s) => [s.title, ...s.rows.map(([k, v]) => `  ${k.padEnd(18)} ${v}`), ''])].join('\n');

function MediaInfoView() {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [report, setReport] = useState<Json | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (picked: PickedFile) =>
    attempt(async () => {
      setBusy(true);
      try {
        setFile(picked);
        setReport(await mediaReport(picked.token));
      } finally {
        setBusy(false);
      }
    });
  useIncomingFiles(
    (files) => {
      const first = files[0];
      if (first) void attempt(async () => open(await stageFile(first)));
    },
    (f) => /^(video|audio)\//.test(f.type) || /\.(mkv|mp4|mov|avi|webm|m4a|mp3|wav|flac|ogg|opus|mts|m2ts|ts|wmv|aac)$/i.test(f.name),
  );
  const sections = report ? describe(report) : [];

  return (
    <section class="tool mi-tool" data-testid="tool" data-state={report ? 'done' : 'idle'}>
      <div class="button-row">
        <button
          type="button"
          class="button button-primary"
          disabled={busy}
          onClick={() =>
            attempt(async () => {
              const [picked] = await pickPaths(false, [
                { name: 'Video and audio', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4a', 'mp3', 'wav', 'flac', 'ogg', 'opus', 'mts', 'm2ts', 'ts', 'wmv', 'aac', 'm4v', '3gp'] },
              ]);
              if (picked) await open(picked);
            })
          }
        >
          <Icon name="open" size={16} /> {busy ? 'Reading…' : 'Choose a video or audio file'}
        </button>
        {report && file && (
          <>
            <button
              type="button"
              class="button"
              onClick={() =>
                attempt(async () => {
                  await copyText(asText(file.name, sections));
                  notify('Copied');
                })
              }
            >
              <Icon name="copy" size={16} /> Copy as text
            </button>
            <button
              type="button"
              class="button"
              onClick={() =>
                attempt(async () => {
                  const saved = await saveFile(`${file.name}.json`, `${JSON.stringify(report, null, 2)}\n`, 'application/json');
                  if (saved.saved) notify(`Saved to ${saved.location}`);
                })
              }
            >
              <Icon name="save" size={16} /> Save FFprobe JSON
            </button>
          </>
        )}
      </div>
      {file && <h2 class="mi-name">{file.name}</h2>}
      <div class="mi-sections">
        {sections.map((s) => (
          <table class="ref-table mi-table" key={s.title}>
            <caption>{s.title}</caption>
            <tbody>
              {s.rows.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {!report && <p class="np-empty">Choose or drop a file to see its container, length, every video, audio and subtitle stream, colour and HDR details, chapters and tags.</p>}
    </section>
  );
}

function MediaInfo() {
  return (
    <ProgramGate needs={['ffmpeg']} what="Media Info">
      <MediaInfoView />
    </ProgramGate>
  );
}

/* --------------------------------------------------------------- recorder -- */

type Source = 'screen' | 'screen-mic' | 'mic';
const SOURCES: readonly SegmentChoice<Source>[] = [
  { value: 'screen-mic', label: 'Screen and microphone' },
  { value: 'screen', label: 'Screen only' },
  { value: 'mic', label: 'Microphone only' },
];

const pickType = (audioOnly: boolean): string => {
  const candidates = audioOnly
    ? ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm'];
  return candidates.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
};

function Recorder({ toolId }: { toolId: string }) {
  const [prefs, setPrefs] = usePersistentState(
    toolId,
    (s: Values | undefined) => ({ source: (['screen', 'screen-mic', 'mic'] as const).includes(s?.source as Source) ? (s?.source as Source) : 'screen-mic', systemAudio: s?.systemAudio !== false }),
    (p: { source: Source; systemAudio: boolean }): Values => ({ ...p }),
  );
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<{ url: string; blob: Blob; type: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const stopMeter = useRef<() => void>(() => undefined);
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const canScreen = !!media?.getDisplayMedia;
  const canMic = !!media?.getUserMedia;
  const canRecord = typeof MediaRecorder !== 'undefined';

  useEffect(() => {
    if (state !== 'recording') return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [state]);
  useEffect(
    () => () => {
      for (const s of streams.current) for (const t of s.getTracks()) t.stop();
      stopMeter.current();
    },
    [],
  );

  const start = () =>
    attempt(async () => {
      if (!canRecord) throw new Error('This window cannot record media. Use the web version of Benchtop in Chrome, Edge or Firefox, or a recorder such as OBS Studio.');
      const wantsScreen = prefs.source !== 'mic';
      const wantsMic = prefs.source !== 'screen';
      if (wantsScreen && !canScreen)
        throw new Error(
          isDesktop
            ? 'Screen capture is not available in the desktop window on this system. Open Benchtop’s web version in Chrome, Edge or Firefox to record the screen, or use OBS Studio.'
            : 'This browser cannot capture the screen.',
        );
      if (wantsMic && !canMic) throw new Error('This window cannot use the microphone.');
      const got: MediaStream[] = [];
      try {
        if (wantsScreen) got.push(await (media as MediaDevices).getDisplayMedia({ video: { frameRate: 30 }, audio: prefs.systemAudio }));
        if (wantsMic) got.push(await (media as MediaDevices).getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
      } catch (error) {
        for (const s of got) for (const t of s.getTracks()) t.stop();
        throw new Error(
          error instanceof DOMException && error.name === 'NotAllowedError' ? 'Permission was refused, so nothing is being recorded.' : error instanceof Error ? error.message : String(error),
        );
      }
      streams.current = got;
      // Mix every audio track into one, so screen sound and voice end up together.
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      for (const s of got) if (s.getAudioTracks().length) context.createMediaStreamSource(s).connect(destination);
      const mixed = destination.stream.getAudioTracks();
      if (mixed[0]) context.createMediaStreamSource(destination.stream).connect(analyser);
      const tracks = [...got.flatMap((s) => s.getVideoTracks()), ...(mixed.length ? mixed : [])];
      const type = pickType(!wantsScreen);
      const rec = new MediaRecorder(new MediaStream(tracks), type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || type || 'video/webm' });
        setResult({ url: URL.createObjectURL(blob), blob, type: blob.type });
        setState('done');
        for (const s of got) for (const t of s.getTracks()) t.stop();
        stopMeter.current();
        void context.close();
      };
      // Stopping the share from the browser's own bar ends the recording too.
      for (const t of got.flatMap((s) => s.getVideoTracks())) t.addEventListener('ended', () => rec.state === 'recording' && rec.stop());
      const data = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      const meter = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevel(peak);
        raf = requestAnimationFrame(meter);
      };
      if (mixed.length) meter();
      stopMeter.current = () => cancelAnimationFrame(raf);
      if (result) URL.revokeObjectURL(result.url);
      setResult(null);
      setSeconds(0);
      rec.start(1000);
      recorder.current = rec;
      setState('recording');
    });

  const stop = () => recorder.current?.state === 'recording' && recorder.current.stop();
  const ext = result?.type.includes('mp4') ? (result.type.startsWith('audio') ? 'm4a' : 'mp4') : result?.type.includes('ogg') ? 'ogg' : 'webm';
  const audioOnly = result?.type.startsWith('audio');
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <section class="tool rec-tool" data-testid="tool" data-state={state === 'done' ? 'done' : 'idle'}>
      <div class="rec-controls">
        <div class="control">
          <span class="control-label">Record</span>
          <Segmented label="Record" value={prefs.source} choices={SOURCES} onChange={(source) => setPrefs((p) => ({ ...p, source }))} />
        </div>
        {prefs.source !== 'mic' && (
          <label class="toggle">
            <input type="checkbox" checked={prefs.systemAudio} onChange={(e) => setPrefs((p) => ({ ...p, systemAudio: e.currentTarget.checked }))} />
            <span class="toggle-track" aria-hidden="true" />
            Include the sound of a shared tab or the screen, where the system allows it
          </label>
        )}
        <div class="button-row">
          {state === 'recording' ? (
            <button type="button" class="button button-primary rec-stop" onClick={stop} data-testid="rec-stop">
              <span class="rec-dot" aria-hidden="true" /> Stop ({clock})
            </button>
          ) : (
            <button type="button" class="button button-primary" onClick={start} data-testid="rec-start">
              <span class="rec-dot" aria-hidden="true" /> Start recording
            </button>
          )}
        </div>
        {state === 'recording' && (
          <div class="rec-meter" role="meter" aria-label="Sound level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
            <span style={{ width: `${Math.min(100, level * 140)}%` }} />
          </div>
        )}
        <p class="control-help" data-testid="rec-support">
          {canRecord && (canScreen || prefs.source === 'mic') && canMic
            ? 'The system asks which screen, window or tab to share and for the microphone. Recordings stay on this computer.'
            : isDesktop
              ? 'This desktop window may not offer screen capture on every system; the microphone usually works. For screen recordings, Benchtop’s web version in Chrome, Edge or Firefox, or OBS Studio, are alternatives.'
              : 'This browser does not offer all recording features.'}
        </p>
      </div>
      {result && (
        <div class="rec-result" data-testid="rec-result">
          {audioOnly ? (
            // biome-ignore lint/a11y/useMediaCaption: a recording the user just made has no captions
            <audio src={result.url} controls />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: a recording the user just made has no captions
            <video src={result.url} controls />
          )}
          <div class="button-row">
            <button
              type="button"
              class="button button-primary"
              onClick={() =>
                attempt(async () => {
                  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
                  const saved = await saveFile(`recording-${stamp}.${ext}`, result.blob, result.type);
                  if (saved.saved) notify(`Saved to ${saved.location}`);
                })
              }
            >
              <Icon name="save" size={16} /> Save recording ({ext.toUpperCase()}, {Math.round(result.blob.size / 1024)} KB)
            </button>
          </div>
          <p class="control-help">To turn the recording into MP4, trim it or make it smaller, open it in Video Tools.</p>
        </div>
      )}
    </section>
  );
}

function AvTools({ toolId }: { toolId: string }) {
  return toolId === 'screen-recorder' ? <Recorder toolId={toolId} /> : <MediaInfo />;
}

export default defineCustomTool(AvTools);
