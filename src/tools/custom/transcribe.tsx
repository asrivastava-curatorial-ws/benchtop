/** Transcribes speech (English, Hindi and 97 more languages) in audio or video files with Whisper, on this computer, as text or subtitles; can translate into English. */

import { useMemo, useState } from 'preact/hooks';
import { extensionOf, sendToTool, useHandoff } from '../../app/handoff';
import { copyText, pickFile, saveFile } from '../../platform';
import { type AiStatus, formatSize, type ModelItem, type PickedFile, pickPaths, runJob } from '../../platform/ai';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { chosenModel, itemsOf, JobStatus, ModelGate, ModelPicker, ModelRow, useJob, useModels } from './_ai';
import { Segmented, usePersistentState } from './_shared';

interface Segment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface Transcript {
  readonly duration: number;
  readonly segments: readonly Segment[];
  readonly seconds: number;
  readonly device?: string;
  /** The language heard, when it was detected. */
  readonly spoken?: string;
}

type Format = 'txt' | 'srt' | 'vtt' | 'json';

const MEDIA = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'webm', 'mp4', 'mkv', 'mov', 'avi', 'wma', 'aiff', 'aif', 'amr', '3gp'];

function stamp(seconds: number, separator: ',' | '.'): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
}

export function render(segments: readonly Segment[], format: Format): string {
  switch (format) {
    case 'srt':
      return segments.map((s, i) => `${i + 1}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${s.text.trim()}\n`).join('\n');
    case 'vtt':
      return `WEBVTT\n\n${segments.map((s) => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${s.text.trim()}\n`).join('\n')}`;
    case 'json':
      return JSON.stringify(segments, null, 2);
    default:
      return segments
        .map((s) => s.text.trim())
        .join(' ')
        .replace(/\s+([.,!?])/g, '$1');
  }
}

/** Languages of India first, then the rest of Whisper's 99 languages by name. */
export const INDIAN_LANGUAGES: readonly (readonly [string, string])[] = [
  ['hi', 'Hindi'],
  ['en', 'English'],
  ['bn', 'Bengali'],
  ['mr', 'Marathi'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['kn', 'Kannada'],
  ['ml', 'Malayalam'],
  ['gu', 'Gujarati'],
  ['pa', 'Punjabi'],
  ['ur', 'Urdu'],
  ['ne', 'Nepali'],
  ['as', 'Assamese'],
  ['sa', 'Sanskrit'],
  ['sd', 'Sindhi'],
];

export const OTHER_LANGUAGES: readonly (readonly [string, string])[] =
  'af Afrikaans|sq Albanian|am Amharic|ar Arabic|hy Armenian|az Azerbaijani|ba Bashkir|eu Basque|be Belarusian|bs Bosnian|br Breton|bg Bulgarian|my Burmese|ca Catalan|zh Chinese|hr Croatian|cs Czech|da Danish|nl Dutch|et Estonian|fo Faroese|fi Finnish|fr French|gl Galician|ka Georgian|de German|el Greek|ht Haitian Creole|ha Hausa|haw Hawaiian|he Hebrew|hu Hungarian|is Icelandic|id Indonesian|it Italian|ja Japanese|jw Javanese|kk Kazakh|km Khmer|ko Korean|lo Lao|la Latin|lv Latvian|ln Lingala|lt Lithuanian|lb Luxembourgish|mk Macedonian|mg Malagasy|ms Malay|mt Maltese|mi Maori|mn Mongolian|no Norwegian|nn Nynorsk|oc Occitan|ps Pashto|fa Persian|pl Polish|pt Portuguese|ro Romanian|ru Russian|sr Serbian|sn Shona|si Sinhala|sk Slovak|sl Slovenian|so Somali|es Spanish|su Sundanese|sw Swahili|sv Swedish|tl Tagalog|tg Tajik|tt Tatar|th Thai|bo Tibetan|tr Turkish|tk Turkmen|uk Ukrainian|uz Uzbek|vi Vietnamese|cy Welsh|yi Yiddish|yo Yoruba'
    .split('|')
    .map((pair) => {
      const space = pair.indexOf(' ');
      return [pair.slice(0, space), pair.slice(space + 1)] as const;
    });

const CODES = new Set(['auto', ...INDIAN_LANGUAGES.map(([code]) => code), ...OTHER_LANGUAGES.map(([code]) => code)]);

export const languageName = (code: string): string => [...INDIAN_LANGUAGES, ...OTHER_LANGUAGES].find(([c]) => c === code)?.[1] ?? code;

interface Settings {
  readonly model: string;
  readonly format: Format;
  readonly language: string;
  readonly translate: boolean;
}

const read = (s: Values | undefined): Settings => ({
  model: typeof s?.model === 'string' ? s.model : '',
  format: (['txt', 'srt', 'vtt', 'json'] as const).find((f) => f === s?.format) ?? 'srt',
  language: typeof s?.language === 'string' && CODES.has(s.language) ? s.language : 'en',
  translate: s?.translate === true,
});

/** Multilingual models, the most accurate first (turbo, small, base). */
const MULTI_ORDER = ['whisper-turbo', 'whisper-small', 'whisper-base'];

/** The model for these settings: the user's choice if it fits, else the best installed one that does. */
function pickModel(status: AiStatus | null, settings: Settings): { model: string; multi: boolean } {
  const items = itemsOf(status, 'speech');
  const multi = settings.language !== 'en' || settings.translate;
  if (!multi) return { model: chosenModel(status, 'speech', settings.model), multi };
  const fits = (item: ModelItem) => item.multilingual && !(settings.translate && item.id === 'whisper-turbo');
  const usable = items.filter(fits);
  if (usable.some((item) => item.id === settings.model)) return { model: settings.model, multi };
  const ranked = [...usable].sort((a, b) => MULTI_ORDER.indexOf(a.id) - MULTI_ORDER.indexOf(b.id));
  return { model: (ranked.find((item) => item.installed) ?? ranked[0])?.id ?? '', multi };
}

function Transcribe({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({ ...s }));
  const [source, setSource] = useState<{ picked?: PickedFile; file?: File } | null>(null);
  const [result, setResult] = useState<Transcript | null>(null);
  const { status, progress: downloads } = useModels();
  const [job, run, stop] = useJob();
  const speech = itemsOf(status, 'speech');
  const { model, multi } = pickModel(status, settings);
  const modelItem = speech.find((item) => item.id === model);
  const output = useMemo(() => (result ? render(result.segments, settings.format) : ''), [result, settings.format]);
  const name = source?.picked?.name ?? source?.file?.name ?? '';
  // A recording dropped on the window or sent from another tool.
  useHandoff((handoff) => {
    const picked = handoff.picked?.[0];
    const file = handoff.files?.find((f) => MEDIA.includes(extensionOf(f.name)));
    if (picked) setSource({ picked });
    else if (file) setSource({ file });
    else return;
    setResult(null);
  });
  const isVideo = /\.(mp4|mkv|mov|avi|webm|3gp)$/i.test(name);
  /** Sends the video and these subtitles to the video toolkit's "Burn in subtitles". */
  const burnIn = () => {
    if (!source || !result) return;
    const base = name.replace(/\.[^.]+$/, '') || 'subtitles';
    const subtitles = new File([render(result.segments, 'srt')], `${base}.srt`, { type: 'application/x-subrip' });
    sendToTool('video-tools', { picked: source.picked ? [source.picked] : undefined, files: source.file ? [source.file] : undefined, extra: subtitles, task: 'video-burn-subtitles' });
  };

  const go = () =>
    void run(async () => {
      if (!source) return;
      const started = performance.now();
      const options = { language: settings.language, task: settings.translate ? 'translate' : 'transcribe' };
      const out = source.picked
        ? await runJob<{ duration: number; segments: Segment[]; spoken?: string }>({ op: 'transcribe', model, file: source.picked.token, name, options })
        : await runJob<{ duration: number; segments: Segment[]; spoken?: string }>({ op: 'transcribe', model, name, options }, new Uint8Array(await (source.file as File).arrayBuffer()));
      setResult({
        duration: out.header.duration,
        segments: out.header.segments,
        seconds: (performance.now() - started) / 1000,
        device: out.header.device,
        spoken: settings.language === 'auto' ? out.header.spoken : undefined,
      });
    });

  return (
    <ModelGate kinds={['speech']} what="Transcription">
      <div data-testid="tool" class="tool ai-tool">
        <div class="ai-controls">
          <div class="control">
            <label class="control-label" for="speech-language">
              Spoken language
            </label>
            <select id="speech-language" class="input" value={settings.language} onChange={(e) => setSettings((s) => ({ ...s, language: e.currentTarget.value }))}>
              <option value="auto">Detect automatically</option>
              <optgroup label="Languages of India">
                {INDIAN_LANGUAGES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Other languages">
                {OTHER_LANGUAGES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <label class="toggle" for="speech-translate">
            <input id="speech-translate" type="checkbox" checked={settings.translate} onChange={(e) => setSettings((s) => ({ ...s, translate: e.currentTarget.checked }))} />
            Translate into English
          </label>
          <ModelPicker
            kind="speech"
            label="Accuracy"
            value={model}
            only={multi ? (item) => item.multilingual && !(settings.translate && item.id === 'whisper-turbo') : undefined}
            onChange={(id) => setSettings((s) => ({ ...s, model: id }))}
          />
          {multi && modelItem && !modelItem.installed && (
            <div class="ai-inline-download">
              <p class="tone-muted">
                {settings.translate ? 'Translation' : `${languageName(settings.language === 'auto' ? 'hi' : settings.language)} and other languages`} need a multilingual model. Large-v3 turbo is the
                most accurate for Hindi; base is the smallest.
              </p>
              <ul class="ai-model-list">
                <ModelRow item={modelItem} p={downloads[modelItem.id]} />
              </ul>
            </div>
          )}
          <div class="button-row">
            <button
              type="button"
              class="button"
              onClick={() =>
                attempt(async () => {
                  const [picked] = await pickPaths(false, [{ name: 'Audio and video', extensions: MEDIA }]);
                  if (picked) {
                    setSource({ picked });
                    setResult(null);
                  }
                })
              }
            >
              Choose a recording
            </button>
            <button
              type="button"
              class="button button-quiet"
              onClick={() =>
                attempt(async () => {
                  const file = await pickFile(MEDIA.map((e) => `.${e}`).join(','));
                  if (file) {
                    setSource({ file });
                    setResult(null);
                  }
                })
              }
            >
              Open as upload
            </button>
          </div>
          {source && (
            <p class="ai-file">
              <Icon name="file" size={15} /> {name} ({formatSize(source.picked?.size ?? source.file?.size ?? 0)})
            </p>
          )}
          <button type="button" class="button button-primary" disabled={!source || job.running || !modelItem?.installed} onClick={go} data-testid="ai-run">
            Transcribe
          </button>
          <JobStatus
            job={job}
            onStop={stop}
            idle={
              result
                ? `${result.segments.length} segments from ${Math.round(result.duration)} s of audio in ${Math.round(result.seconds)} s${result.spoken ? `, heard ${languageName(result.spoken)}` : ''}${result.device ? `, ${result.device}` : ''}`
                : 'Video files are read with FFmpeg when it is installed; WAV, MP3, FLAC, OGG and M4A always work. Choosing the language beats detecting it.'
            }
          />
        </div>
        <div class="ai-work">
          <div class="pane ai-text">
            <div class="pane-header">
              <Segmented
                label="Format"
                value={settings.format}
                onChange={(format) => setSettings((s) => ({ ...s, format }))}
                choices={[
                  { value: 'srt', label: 'SRT' },
                  { value: 'vtt', label: 'WebVTT' },
                  { value: 'txt', label: 'Text' },
                  { value: 'json', label: 'JSON' },
                ]}
              />
              <div class="pane-actions">
                <button
                  type="button"
                  class="icon-button"
                  aria-label="Copy"
                  title="Copy"
                  disabled={!output}
                  onClick={() =>
                    attempt(async () => {
                      await copyText(output);
                      notify('Copied.');
                    })
                  }
                >
                  <Icon name="copy" size={16} />
                </button>
                <button
                  type="button"
                  class="button button-small"
                  disabled={!output}
                  onClick={() =>
                    attempt(async () => {
                      const base = name.replace(/\.[^.]+$/, '') || 'transcript';
                      const saved = await saveFile(`${base}.${settings.format}`, output, 'text/plain');
                      if (saved.saved) notify(`Saved to ${saved.location}`);
                    })
                  }
                >
                  Save
                </button>
                {isVideo && result && (
                  <button type="button" class="button button-small" onClick={burnIn} data-testid="burn-subtitles" title="Open the video toolkit with this video and these subtitles">
                    Burn into the video
                  </button>
                )}
              </div>
            </div>
            <div class="pane-body">
              <CodeEditor value={output} readOnly wrap label="Transcript" testId="transcript-output" />
            </div>
          </div>
        </div>
      </div>
    </ModelGate>
  );
}

export default defineCustomTool(Transcribe);
