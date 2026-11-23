/**
 * Speech tools with Piper voices, on this computer:
 *   Text to Speech: type text, hear it, save it as WAV.
 *   Video Dubbing: transcribe a video (Whisper), translate its lines (a local
 *   AI server such as Ollama, or by hand), voice them (Piper) at their times,
 *   and save subtitles, the voice-over, or the video with the new soundtrack.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import indicTransServer from '../../../scripts/indictrans2-server.py?raw';
import { assemble, chatRequest, decodeWav, encodeWav, fitRate, LANGUAGES, type Line, languageOf, parseChatReply, parseSubtitles, slots, toSrt, toVtt, voiceSpeaks } from '../../lib/dubbing';
import { pickFile, readTextFile, saveFile } from '../../platform';
import { formatSize, type PickedFile, pickPaths, runJob, stageFile } from '../../platform/ai';
import { type ConvertResult, onConvertProgress, revealResult, runConversion, stopConversion } from '../../platform/convert';
import { netFor } from '../../platform/net';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { chosenModel, itemsOf, JobStatus, ModelGate, ModelPicker, ModelRow, useJob, useModels } from './_ai';
import { ProgramGate } from './_convert';
import { IndicPanel } from './_indic';
import { Segmented, usePersistentState } from './_shared';
import { INDIAN_LANGUAGES } from './transcribe';

const useAudioUrl = (bytes: Uint8Array | null) => {
  const url = useMemo(() => (bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' })) : null), [bytes]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
};

/* ------------------------------------------------------------ text to speech -- */

interface SpeakState {
  readonly text: string;
  readonly voice: string;
  readonly rate: number;
}

const readSpeak = (v: Values | undefined): SpeakState => ({
  text: typeof v?.text === 'string' ? v.text : 'Welcome to the museum. This gallery tells the story of electricity, from the first batteries to the power stations that light our cities.',
  voice: typeof v?.voice === 'string' ? v.voice : '',
  rate: typeof v?.rate === 'number' ? v.rate : 1,
});

function TextToSpeech({ toolId }: { toolId: string }) {
  const [s, setS] = usePersistentState(toolId, readSpeak, (x) => ({ ...x }));
  const { status, progress } = useModels();
  const [job, run, stop] = useJob();
  const [audio, setAudio] = useState<{ bytes: Uint8Array; seconds: number } | null>(null);
  const url = useAudioUrl(audio?.bytes ?? null);
  const voice = chosenModel(status, 'voice', s.voice);
  const item = itemsOf(status, 'voice').find((v) => v.id === voice);

  const speak = () =>
    void run(async () => {
      const out = await runJob<{ seconds: number }>({ op: 'speak', model: voice, options: { text: s.text, rate: s.rate } });
      setAudio({ bytes: out.bytes, seconds: out.header.seconds });
    });

  return (
    <div data-testid="tool" class="tool ai-tool" data-state={audio ? 'done' : 'idle'}>
      <div class="ai-controls">
        <ModelPicker kind="voice" label="Voice" value={voice} onChange={(id) => setS((x) => ({ ...x, voice: id }))} />
        {item && !item.installed && (
          <ul class="ai-model-list">
            <ModelRow item={item} p={progress[item.id]} />
          </ul>
        )}
        <label class="control">
          <span class="control-label">Speed: {s.rate.toFixed(2)}×</span>
          <input type="range" min={0.6} max={1.6} step={0.05} value={s.rate} onInput={(e) => setS((x) => ({ ...x, rate: Number(e.currentTarget.value) }))} />
        </label>
        {item && <p class="control-help">Voice licence: {item.licence}.</p>}
      </div>
      <label class="control">
        <span class="control-label">Text</span>
        <textarea class="input tts-text" rows={8} value={s.text} onInput={(e) => setS((x) => ({ ...x, text: e.currentTarget.value }))} data-testid="tts-text" />
      </label>
      <div class="button-row">
        <button type="button" class="button button-primary" onClick={speak} disabled={job.running || !s.text.trim() || !item?.installed} data-testid="tts-speak">
          <Icon name="play" size={14} /> Speak
        </button>
        {audio && (
          <button type="button" class="button" onClick={() => attempt(async () => void (await saveFile('speech.wav', audio.bytes, 'audio/wav')))}>
            <Icon name="save" size={14} /> Save WAV
          </button>
        )}
      </div>
      <JobStatus job={job} onStop={stop} idle={audio ? `${audio.seconds.toFixed(1)} s of speech` : 'Piper voices speak English, Hindi, Malayalam and Nepali. Punctuation sets the pauses.'} />
      {url && (
        // biome-ignore lint/a11y/useMediaCaption: the text being spoken is on screen above; it is the transcript
        <audio controls src={url} class="tts-audio" data-testid="tts-audio" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- video dubbing -- */

interface DubState {
  readonly spoken: string;
  readonly target: string;
  readonly engine: 'server' | 'manual';
  readonly server: string;
  readonly chatModel: string;
  readonly context: string;
  readonly voice: string;
  readonly speechModel: string;
  readonly background: number;
  readonly keepOriginal: boolean;
}

const readDub = (v: Values | undefined): DubState => ({
  spoken: typeof v?.spoken === 'string' ? v.spoken : 'en',
  target: typeof v?.target === 'string' ? v.target : 'hi',
  engine: v?.engine === 'manual' ? 'manual' : 'server',
  server: typeof v?.server === 'string' ? v.server : 'http://localhost:11434/v1/chat/completions',
  chatModel: typeof v?.chatModel === 'string' ? v.chatModel : 'gemma3:12b',
  context: typeof v?.context === 'string' ? v.context : '',
  voice: typeof v?.voice === 'string' ? v.voice : '',
  speechModel: typeof v?.speechModel === 'string' ? v.speechModel : '',
  background: typeof v?.background === 'number' ? v.background : 20,
  keepOriginal: v?.keepOriginal !== false,
});

const MEDIA = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mp3', 'wav', 'm4a', 'flac', 'ogg'];

const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function VideoDubbing({ toolId }: { toolId: string }) {
  const [s, setS] = usePersistentState(toolId, readDub, (x) => ({ ...x }));
  const { status, progress } = useModels();
  const [job, run, stop] = useJob();
  const [video, setVideo] = useState<PickedFile | null>(null);
  const [duration, setDuration] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [voiceOver, setVoiceOver] = useState<Uint8Array | null>(null);
  const [rendering, setRendering] = useState<{ id: string; fraction: number } | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const voiceUrl = useAudioUrl(voiceOver);
  const set = <K extends keyof DubState>(key: K, value: DubState[K]) => setS((x) => ({ ...x, [key]: value }));

  const target = languageOf(s.target);
  const spokenName = s.spoken === 'auto' ? 'the spoken language' : (INDIAN_LANGUAGES.find(([c]) => c === s.spoken)?.[1] ?? languageOf(s.spoken).name);
  const multi = s.spoken !== 'en';
  const speechModel = chosenModel(status, 'speech', s.speechModel, multi ? (i) => i.multilingual : undefined);
  const speechItem = itemsOf(status, 'speech').find((i) => i.id === speechModel);
  const voices = itemsOf(status, 'voice').filter((v) => voiceSpeaks(v.id, s.target));
  const voice = voices.some((v) => v.id === s.voice) ? s.voice : ((voices.find((v) => v.installed) ?? voices[0])?.id ?? '');
  const voiceItem = voices.find((v) => v.id === voice);

  useEffect(() => {
    let off: (() => void) | undefined;
    void onConvertProgress((p) => setRendering((r) => (r && r.id === p.id ? { ...r, fraction: p.fraction } : r))).then((u) => {
      off = u;
    });
    return () => off?.();
  }, []);

  const chooseVideo = () =>
    attempt(async () => {
      const [picked] = await pickPaths(false, [{ name: 'Video and audio', extensions: MEDIA }]);
      if (!picked) return;
      setVideo(picked);
      setLines([]);
      setVoiceOver(null);
      setResult(null);
    });

  const transcribe = () =>
    void run(async () => {
      if (!video) return;
      const out = await runJob<{ duration: number; segments: { start: number; end: number; text: string }[] }>({
        op: 'transcribe',
        model: speechModel,
        file: video.token,
        name: video.name,
        options: { language: s.spoken, task: 'transcribe' },
      });
      setDuration(out.header.duration);
      setLines(out.header.segments.filter((x) => x.text.trim()).map((x) => ({ start: x.start, end: x.end, text: x.text.trim(), translation: '' })));
      setVoiceOver(null);
    });

  const openSubtitles = () =>
    attempt(async () => {
      const file = await pickFile('.srt,.vtt');
      if (!file) return;
      const parsed = parseSubtitles(await readTextFile(file));
      if (!parsed.length) throw new Error(`${file.name} has no timed lines.`);
      setLines(parsed);
      setDuration((d) => Math.max(d, parsed.at(-1)?.end ?? 0));
      setVoiceOver(null);
      notify(`Read ${parsed.length} lines from ${file.name}.`);
    });

  const translate = () =>
    void run(async () => {
      if (s.engine === 'manual') {
        setLines((ls) => ls.map((l) => (l.translation ? l : { ...l, translation: l.text })));
        return;
      }
      const from = spokenName;
      const out = [...lines];
      const batch = 20;
      for (let i = 0; i < out.length; i += batch) {
        const chunk = out.slice(i, i + batch);
        const ask = async (texts: string[]): Promise<string[] | null> => {
          const response = await netFor(s.server).http({
            url: s.server,
            method: 'POST',
            headers: [['content-type', 'application/json']],
            body: JSON.stringify(
              chatRequest(s.chatModel, texts, from, target.name, s.context, { from: s.spoken === 'auto' ? 'eng_Latn' : languageOf(s.spoken).flores || 'eng_Latn', to: target.flores }),
            ),
            timeoutMs: 300_000,
            maxBody: 4_000_000,
          });
          if (response.status >= 400)
            throw new Error(
              `The AI server answered ${response.status} ${response.reason}. Check its address and that the model "${s.chatModel}" is installed (for Ollama: ollama pull ${s.chatModel}).`,
            );
          const bytes = Uint8Array.from(atob(response.body), (c) => c.charCodeAt(0));
          return parseChatReply(new TextDecoder().decode(bytes), texts.length);
        };
        let translated = await ask(chunk.map((l) => l.text));
        // A model that did not keep the list's shape: one line at a time.
        if (!translated) translated = await Promise.all(chunk.map(async (l) => (await ask([l.text]))?.[0] ?? ''));
        translated.forEach((t, k) => {
          const line = out[i + k];
          if (line) out[i + k] = { ...line, translation: t.trim() };
        });
        setLines([...out]);
      }
      setVoiceOver(null);
    });

  const makeVoiceOver = () =>
    void run(async () => {
      const room = slots(lines, duration);
      const clips: { start: number; samples: Float32Array }[] = [];
      let rate = 22_050;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] as Line;
        if (!line.translation.trim()) continue;
        let out = await runJob<{ seconds: number; sampleRate: number }>({ op: 'speak', model: voice, options: { text: line.translation, rate: 1, pause: 0.15 } });
        const speed = fitRate(out.header.seconds, room[i] ?? 1);
        if (speed > 1.02) out = await runJob({ op: 'speak', model: voice, options: { text: line.translation, rate: speed, pause: 0.1 } });
        const wav = decodeWav(out.bytes);
        rate = wav.rate;
        clips.push({ start: line.start, samples: wav.samples });
      }
      if (!clips.length) throw new Error('Translate the lines first: there is nothing to voice.');
      setVoiceOver(encodeWav(assemble(clips, rate, duration), rate));
    });

  const render = () =>
    attempt(async () => {
      if (!video || !voiceOver) return;
      const id = `dub-${Date.now()}`;
      setRendering({ id, fraction: 0 });
      setResult(null);
      try {
        const voiceToken = await stageFile(new File([voiceOver as BlobPart], 'voice-over.wav', { type: 'audio/wav' }));
        const subtitles = toSrt(lines, 'translation');
        const inputs = [video.token, voiceToken.token];
        if (subtitles.trim()) inputs.push((await stageFile(new File([subtitles], 'subtitles.srt', { type: 'application/x-subrip' }))).token);
        const done = await runConversion({
          id,
          recipe: 'video-dub',
          inputs,
          options: { background: s.background, keepOriginal: s.keepOriginal, language: target.iso3, label: `${target.name} voice-over` },
          destination: 'ask',
        });
        if (done) {
          setResult(done);
          notify(`Saved ${done.name}.`);
        }
      } finally {
        setRendering(null);
      }
    });

  const save = (name: string, text: string, mime: string) => attempt(async () => void (await saveFile(name, text, mime)));
  const base = (video?.name ?? 'video').replace(/\.[^.]+$/, '');
  const translatedCount = lines.filter((l) => l.translation.trim()).length;

  return (
    <div data-testid="tool" class="tool ai-tool dub-tool" data-state={result ? 'done' : 'idle'}>
      <ol class="dub-steps">
        <li class="dub-step">
          <h3 class="dub-title">Video and its speech</h3>
          <div class="button-row">
            <button type="button" class="button" onClick={chooseVideo} data-testid="dub-choose">
              <Icon name="open" size={14} /> Choose a video
            </button>
            {video && (
              <span class="ai-file">
                <Icon name="file" size={15} /> {video.name} ({formatSize(video.size)})
              </span>
            )}
          </div>
          <div class="button-row">
            <label class="control control-inline">
              <span class="control-label">Spoken language</span>
              <select class="select" value={s.spoken} onChange={(e) => set('spoken', e.currentTarget.value)}>
                <option value="auto">Detect</option>
                {INDIAN_LANGUAGES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <ModelPicker kind="speech" label="Recognition model" value={speechModel} only={multi ? (i) => i.multilingual : undefined} onChange={(id) => set('speechModel', id)} />
          </div>
          {speechItem && !speechItem.installed && (
            <ul class="ai-model-list">
              <ModelRow item={speechItem} p={progress[speechItem.id]} />
            </ul>
          )}
          <div class="button-row">
            <button type="button" class="button button-primary" onClick={transcribe} disabled={!video || job.running || !speechItem?.installed} data-testid="dub-transcribe">
              Transcribe
            </button>
            <button type="button" class="button button-quiet" onClick={openSubtitles}>
              Or open subtitles (SRT, VTT)
            </button>
          </div>
        </li>

        <li class="dub-step">
          <h3 class="dub-title">Translate into</h3>
          <div class="button-row">
            <select class="select" value={s.target} onChange={(e) => set('target', e.currentTarget.value)} aria-label="Target language" data-testid="dub-target">
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
            <Segmented
              label="Translator"
              value={s.engine}
              onChange={(engine) => set('engine', engine)}
              choices={[
                { value: 'server', label: 'Local AI server' },
                { value: 'manual', label: 'By hand' },
              ]}
            />
          </div>
          {s.engine === 'server' ? (
            <div class="dub-server">
              <label class="control">
                <span class="control-label">Server (OpenAI-compatible chat address)</span>
                <input class="input" value={s.server} onInput={(e) => set('server', e.currentTarget.value)} spellcheck={false} />
              </label>
              <label class="control">
                <span class="control-label">Model</span>
                <input class="input" value={s.chatModel} onInput={(e) => set('chatModel', e.currentTarget.value)} spellcheck={false} />
              </label>
              <label class="control">
                <span class="control-label">What the video is about (optional, helps with names)</span>
                <input class="input" value={s.context} onInput={(e) => set('context', e.currentTarget.value)} />
              </label>
              <p class="control-help">
                Works with IndicTrans2 (below), Ollama (ollama serve, then ollama pull gemma3:12b), LM Studio or a llama.cpp server. Servers on this computer always work; for one elsewhere on your
                network, turn on online checks in Settings.
              </p>
              <IndicPanel
                script={indicTransServer}
                onReady={(address) => {
                  set('server', address);
                  set('chatModel', 'indictrans2');
                }}
              />
            </div>
          ) : (
            <p class="control-help">Each translation box starts with the original line; type over it.</p>
          )}
          <button type="button" class="button" onClick={translate} disabled={!lines.length || job.running} data-testid="dub-translate">
            {s.engine === 'manual' ? 'Copy the lines to translate' : `Translate ${lines.length} lines`}
          </button>
        </li>

        <li class="dub-step">
          <h3 class="dub-title">Voice</h3>
          {voices.length ? (
            <>
              <label class="control control-inline">
                <span class="control-label">{target.name} voice</span>
                <select class="select" value={voice} onChange={(e) => set('voice', e.currentTarget.value)}>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.installed ? '' : ` (download ${formatSize(v.download.size)})`}
                    </option>
                  ))}
                </select>
              </label>
              {voiceItem && !voiceItem.installed && (
                <ul class="ai-model-list">
                  <ModelRow item={voiceItem} p={progress[voiceItem.id]} />
                </ul>
              )}
              {voiceItem && <p class="control-help">Licence: {voiceItem.licence}. Lines too long for their time are spoken faster, up to 1.6×.</p>}
              <button type="button" class="button button-primary" onClick={makeVoiceOver} disabled={!translatedCount || job.running || !voiceItem?.installed} data-testid="dub-voice">
                Make the voice-over
              </button>
            </>
          ) : (
            <p class="control-help" data-testid="dub-no-voice">
              No Piper voice speaks {target.name} yet; the voices speak English, Hindi, Malayalam and Nepali. You can still save {target.name} subtitles, or record a voice-over and add it with the
              File Converter.
            </p>
          )}
          {voiceUrl && (
            // biome-ignore lint/a11y/useMediaCaption: the translated lines it speaks are listed above and saved as subtitles
            <audio controls src={voiceUrl} class="tts-audio" />
          )}
        </li>

        <li class="dub-step">
          <h3 class="dub-title">Save</h3>
          <div class="button-row">
            <button type="button" class="button" disabled={!translatedCount} onClick={() => save(`${base}.${target.code}.srt`, toSrt(lines, 'translation'), 'application/x-subrip')}>
              {target.name} subtitles (SRT)
            </button>
            <button type="button" class="button" disabled={!translatedCount} onClick={() => save(`${base}.${target.code}.vtt`, toVtt(lines, 'translation'), 'text/vtt')}>
              WebVTT
            </button>
            <button type="button" class="button" disabled={!lines.length} onClick={() => save(`${base}.original.srt`, toSrt(lines, 'text'), 'application/x-subrip')}>
              Original subtitles
            </button>
            <button type="button" class="button" disabled={!voiceOver} onClick={() => attempt(async () => void (voiceOver && (await saveFile(`${base}.${target.code}.wav`, voiceOver, 'audio/wav'))))}>
              Voice-over (WAV)
            </button>
          </div>
          <div class="button-row">
            <label class="control control-inline">
              <span class="control-label">Original sound under the voice: {s.background}%</span>
              <input type="range" min={0} max={100} step={5} value={s.background} onInput={(e) => set('background', Number(e.currentTarget.value))} />
            </label>
            <label class="check">
              <input type="checkbox" checked={s.keepOriginal} onChange={(e) => set('keepOriginal', e.currentTarget.checked)} />
              <span>Keep the original soundtrack as a second track</span>
            </label>
          </div>
          <div class="button-row">
            <button type="button" class="button button-primary" disabled={!video || !voiceOver || rendering !== null} onClick={render} data-testid="dub-render">
              Make the dubbed video
            </button>
            {rendering && (
              <>
                <progress max={1} value={rendering.fraction} />
                <button type="button" class="button button-small" onClick={() => void stopConversion(rendering.id)}>
                  Stop
                </button>
              </>
            )}
            {result && (
              <button type="button" class="button button-small" onClick={() => void revealResult(result.token)}>
                Show {result.name}
              </button>
            )}
          </div>
          <p class="control-help">The video picture is copied unchanged; the new soundtrack (AAC) and the {target.name} subtitles are added as tracks.</p>
        </li>
      </ol>

      <JobStatus job={job} onStop={stop} idle={lines.length ? `${lines.length} lines, ${translatedCount} translated` : 'Choose a video, then transcribe it or open its subtitles.'} />

      {lines.length > 0 && (
        <div class="dub-lines" data-testid="dub-lines">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Original</th>
                <th scope="col">{target.name}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={`${line.start}-${i}`}>
                  <td class="mono dub-time">
                    {clock(line.start)}
                    <br />
                    {clock(line.end)}
                  </td>
                  <td>
                    <textarea
                      class="input dub-cell"
                      rows={2}
                      value={line.text}
                      onInput={(e) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, text: e.currentTarget.value } : l)))}
                      aria-label={`Line ${i + 1}`}
                    />
                  </td>
                  <td>
                    <textarea
                      class="input dub-cell"
                      rows={2}
                      value={line.translation}
                      lang={target.code}
                      onInput={(e) => {
                        const value = e.currentTarget.value;
                        setLines((ls) => ls.map((l, k) => (k === i ? { ...l, translation: value } : l)));
                        setVoiceOver(null);
                      }}
                      aria-label={`Translation of line ${i + 1}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SpeechTools({ toolId }: { toolId: string }) {
  if (toolId === 'video-dubbing')
    return (
      <ProgramGate needs={['ffmpeg', 'espeak']} what="Video dubbing">
        <ModelGate kinds={['speech']} what="Video dubbing">
          <VideoDubbing toolId={toolId} />
        </ModelGate>
      </ProgramGate>
    );
  return (
    <ProgramGate needs={['espeak']} what="Text to speech">
      <ModelGate kinds={['voice']} what="Text to speech">
        <TextToSpeech toolId={toolId} />
      </ModelGate>
    </ProgramGate>
  );
}

export default defineCustomTool(SpeechTools);
