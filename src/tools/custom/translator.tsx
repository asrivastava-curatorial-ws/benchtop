/**
 * Text Translator: translates typed text, OCR results, documents and subtitles
 * with translation models on this computer: IndicTrans2 (English and the 22
 * scheduled languages of India), M2M-100, NLLB-200, MADLAD-400 or any Hugging
 * Face translation model you add (Arabic, Chinese, Japanese, Russian and
 * hundreds more), all set up in a click; or an OpenAI-compatible chat server
 * such as Ollama.  Layout, lists and subtitle timing are kept; nothing leaves
 * the computer unless you point it at a server elsewhere.
 */
import { useRef, useState } from 'preact/hooks';
import indicTransServer from '../../../scripts/indictrans2-server.py?raw';
import { extensionOf, useIncomingFiles } from '../../app/handoff';
import { getSettings } from '../../app/store';
import { fromBase64 } from '../../lib/bytes';
import { parseChatReply } from '../../lib/dubbing';
import {
  detectLanguage,
  MODEL_CATALOGUE,
  modelKnows,
  modelName,
  plan,
  rebuild,
  subtitleFormat,
  subtitlePlan,
  TRANSLATION_LANGUAGES,
  translatePieces,
  translationLanguage,
  translationRequest,
} from '../../lib/translate';
import { copyText, isDesktop, pickFile, readTextFile, saveFile } from '../../platform';
import { isLoopback, netFor, networkStatus } from '../../platform/net';
import { Icon } from '../../ui/icons';
import { SendTo } from '../../ui/SendTo';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { IndicPanel } from './_indic';
import { usePersistentState } from './_shared';

interface Prefs {
  readonly from: string;
  readonly to: string;
  readonly server: string;
  readonly model: string;
  readonly context: string;
}

const OLLAMA = 'http://localhost:11434/v1/chat/completions';

const readPrefs = (stored: Values | undefined): Prefs => {
  // Until the translator has its own, it starts with the server Video Dubbing uses.
  const dub = getSettings().toolOptions['video-dubbing'];
  const known = (code: unknown) => typeof code === 'string' && TRANSLATION_LANGUAGES.some((l) => l.code === code);
  return {
    from: stored?.from === 'auto' || known(stored?.from) ? (stored?.from as string) : 'auto',
    to: known(stored?.to) ? (stored?.to as string) : 'hi',
    server: typeof stored?.server === 'string' ? stored.server : typeof dub?.server === 'string' ? dub.server : OLLAMA,
    model: typeof stored?.model === 'string' ? stored.model : typeof dub?.chatModel === 'string' ? dub.chatModel : 'gemma3:12b',
    context: typeof stored?.context === 'string' ? stored.context : '',
  };
};
const writePrefs = (p: Prefs): Values => ({ ...p });

/** The message in an error answer from Benchtop's translation server. */
function serverError(body: string): string {
  try {
    const reply = JSON.parse(new TextDecoder().decode(fromBase64(body))) as { error?: { message?: string } };
    return reply.error?.message || 'see its log';
  } catch {
    return 'see its log';
  }
}

const TEXT_FILES = ['txt', 'md', 'markdown', 'srt', 'vtt', 'csv', 'tsv', 'log', 'html', 'htm'];
const isText = (file: File) => file.type.startsWith('text/') || TEXT_FILES.includes(extensionOf(file.name));

function Translator({ toolId }: { toolId: string }) {
  const [prefs, setPrefs] = usePersistentState(toolId, readPrefs, writePrefs);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState('');
  const stop = useRef(false);
  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) => setPrefs({ ...prefs, [key]: value });

  const detected = prefs.from === 'auto' && input.trim() ? detectLanguage(input) : null;
  const subtitles = subtitleFormat(input);
  const local = isLoopback(prefs.server);
  const status = networkStatus();
  const gate =
    !isDesktop && !status.ok ? 'Translating needs the Benchtop desktop app, which talks to the translation server on this computer. In a browser you can still read and edit text here.' : '';
  const indic = prefs.model === 'indictrans2';
  // A model Benchtop's own translation server runs (rather than a chat model).
  const ownModel = indic || prefs.model.startsWith('hf:') || MODEL_CATALOGUE.some((m) => m.key === prefs.model);

  const load = async (file: File) => {
    setInput(await readTextFile(file));
    setFileName(file.name);
    setOutput('');
    setSummary('');
  };
  useIncomingFiles((files) => void attempt(() => load(files[0] as File)), isText);

  const translate = () =>
    attempt(async () => {
      const text = input;
      if (!text.trim()) return;
      const fromCode = prefs.from === 'auto' ? detectLanguage(text) : prefs.from;
      const from = fromCode ? translationLanguage(fromCode) : null;
      const to = translationLanguage(prefs.to);
      if (from?.code === to.code) throw new Error(`The text is already in ${to.name}: choose another language to translate into.`);
      const unknown = [to, from].find((l) => l && !modelKnows(prefs.model, l.code));
      if (unknown)
        throw new Error(
          `${modelName(prefs.model)} does not translate ${unknown.name}. ${indic ? 'Download M2M-100 or NLLB-200 under “Translation models on this computer” for other languages, or use a chat model.' : 'Choose another model below.'}`,
        );
      if (!local && !status.ok) throw new Error(status.reason);
      const subs = subtitlePlan(text);
      const layout = subs ? null : plan(text);
      const pieces = subs ? subs.pieces : (layout?.pieces ?? []);
      if (!pieces.length) throw new Error('There are no words to translate.');
      const started = performance.now();
      stop.current = false;
      setBusy(true);
      setSummary('');
      setProgress({ done: 0, total: pieces.length });
      const write = (done: readonly string[]) => (subs ? subs.write(done) : layout ? rebuild(layout, done) : '');
      const ask = async (batch: string[]): Promise<string[] | null> => {
        const response = await netFor(prefs.server).http({
          url: prefs.server,
          method: 'POST',
          headers: [['content-type', 'application/json']],
          body: JSON.stringify(translationRequest(prefs.model, batch, from, to, prefs.context)),
          timeoutMs: 300_000,
          maxBody: 4_000_000,
        });
        if (response.status >= 400)
          throw new Error(
            `The translation server answered ${response.status} ${response.reason}${ownModel ? `: ${serverError(response.body)}` : `. Check its address and that the model “${prefs.model}” is there (for Ollama: ollama pull ${prefs.model})`}.`,
          );
        return parseChatReply(new TextDecoder().decode(fromBase64(response.body)), batch.length);
      };
      try {
        const done = await translatePieces(
          pieces,
          ask,
          (count, partial) => {
            setProgress({ done: count, total: pieces.length });
            setOutput(write(partial));
          },
          () => stop.current,
          indic ? 16 : 8,
        );
        setOutput(write(done));
        const seconds = (performance.now() - started) / 1000;
        setSummary(
          `${from ? from.name : 'Detected language'} → ${to.name}: ${pieces.length} ${subs ? 'subtitles' : pieces.length === 1 ? 'piece' : 'pieces'} in ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s.`,
        );
      } finally {
        setBusy(false);
        setProgress(null);
      }
    });

  const outName = () => {
    const stem = (fileName || 'translation.txt').replace(/\.[^.]+$/, '');
    const ext = subtitles ?? (extensionOf(fileName) || 'txt');
    return `${stem}.${prefs.to}.${ext}`;
  };

  return (
    <section class="tool tr" data-testid="tool" data-state={busy ? 'busy' : output ? 'done' : 'idle'}>
      {gate && (
        <p class="notice" data-testid="tr-gate">
          {gate}
        </p>
      )}
      <div class="tr-bar">
        <label class="af-field">
          <span class="control-label">From</span>
          <select class="input" value={prefs.from} onChange={(e) => set('from', e.currentTarget.value)} data-testid="tr-from">
            <option value="auto">{detected ? `Detect (${translationLanguage(detected).name})` : 'Detect from the script'}</option>
            {TRANSLATION_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          class="button button-quiet tr-swap"
          title="Swap the languages and texts"
          aria-label="Swap the languages and texts"
          disabled={busy}
          onClick={() => {
            const from = prefs.from === 'auto' ? (detected ?? 'en') : prefs.from;
            setPrefs({ ...prefs, from: prefs.to, to: from });
            if (output) {
              setInput(output);
              setOutput(input);
            }
          }}
          data-testid="tr-swap"
        >
          <Icon name="swap" size={16} />
        </button>
        <label class="af-field">
          <span class="control-label">To</span>
          <select class="input" value={prefs.to} onChange={(e) => set('to', e.currentTarget.value)} data-testid="tr-to">
            {TRANSLATION_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {busy ? (
          <button
            type="button"
            class="button"
            onClick={() => {
              stop.current = true;
            }}
          >
            Stop
          </button>
        ) : (
          <button type="button" class="button button-primary" disabled={!input.trim() || !!gate} onClick={() => void translate()} data-testid="tr-translate">
            Translate
          </button>
        )}
        <span class="tr-status" role="status" data-testid="tr-status">
          {progress ? `Translating… ${progress.done} of ${progress.total}` : summary}
        </span>
      </div>

      <div class="tr-panes">
        <div class="pane">
          <div class="pane-header">
            <h2 class="pane-title">Original</h2>
            <span class="pane-meta">
              {[fileName, subtitles ? `${subtitles.toUpperCase()} subtitles: times are kept` : '', input ? `${input.length.toLocaleString()} characters` : ''].filter(Boolean).join(' · ')}
            </span>
            <div class="pane-actions">
              <button
                type="button"
                class="button button-small"
                onClick={() =>
                  void attempt(async () => {
                    const file = await pickFile('.txt,.md,.srt,.vtt,.csv,.tsv,.html,.htm,text/*');
                    if (file) await load(file);
                  })
                }
              >
                <Icon name="file" size={14} /> Open…
              </button>
              <button
                type="button"
                class="button button-small button-quiet"
                disabled={!input}
                onClick={() => {
                  setInput('');
                  setOutput('');
                  setFileName('');
                  setSummary('');
                }}
              >
                Clear
              </button>
            </div>
          </div>
          <textarea
            class="input tr-text"
            dir="auto"
            value={input}
            placeholder="Type or paste text, open a file or subtitles, or send text here from Text Recognition (OCR) or Transcription."
            onInput={(e) => setInput(e.currentTarget.value)}
            aria-label="Text to translate"
            data-testid="tr-input"
          />
        </div>
        <div class="pane">
          <div class="pane-header">
            <h2 class="pane-title">Translation</h2>
            <span class="pane-meta">{output ? 'You can correct it here' : ''}</span>
            <div class="pane-actions">
              <button
                type="button"
                class="icon-button"
                aria-label="Copy the translation"
                title="Copy"
                disabled={!output}
                onClick={() =>
                  void attempt(async () => {
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
                  void attempt(async () => {
                    const saved = await saveFile(outName(), output, subtitles === 'vtt' ? 'text/vtt' : 'text/plain');
                    if (saved.saved) notify(`Saved to ${saved.location}`);
                  })
                }
                data-testid="tr-save"
              >
                Save
              </button>
              <SendTo disabled={!output} from={toolId} make={() => new File([output], outName(), { type: 'text/plain' })} />
            </div>
          </div>
          <textarea class="input tr-text" dir="auto" value={output} onInput={(e) => setOutput(e.currentTarget.value)} aria-label="Translation" data-testid="tr-output" />
        </div>
      </div>

      <details class="tr-server" open={!indic && prefs.server === OLLAMA}>
        <summary>
          Translation model: {modelName(prefs.model)} at {prefs.server}
        </summary>
        <div class="tr-server-body">
          <label class="af-field">
            <span class="control-label">Server (OpenAI-compatible chat address)</span>
            <input class="input" value={prefs.server} onInput={(e) => set('server', e.currentTarget.value)} spellcheck={false} data-testid="tr-server" />
          </label>
          <label class="af-field">
            <span class="control-label">Model</span>
            <input class="input" value={prefs.model} onInput={(e) => set('model', e.currentTarget.value)} spellcheck={false} data-testid="tr-model" />
          </label>
          <label class="af-field tr-context">
            <span class="control-label">What the text is about (optional; helps chat models with names and terms)</span>
            <input class="input" value={prefs.context} onInput={(e) => set('context', e.currentTarget.value)} />
          </label>
          <p class="control-help">
            Translation models on this computer (below) work offline: IndicTrans2 for English and India’s 22 scheduled languages; M2M-100, NLLB-200 or MADLAD-400 for Arabic, Chinese, Japanese, Russian
            and hundreds of other languages; or any Hugging Face translation model you add. A chat model also works: Ollama (ollama serve, then ollama pull gemma3:12b), LM Studio or a llama.cpp
            server. Servers on this computer always work; for one elsewhere on your network, turn on online checks in Settings.
          </p>
          <IndicPanel
            script={indicTransServer}
            useLabel="Use IndicTrans2"
            catalogue={MODEL_CATALOGUE}
            onReady={(address) => {
              setPrefs({ ...prefs, server: address, model: 'indictrans2' });
              notify('The translator now uses IndicTrans2 on this computer.');
            }}
            onModel={(address, model) => {
              setPrefs({ ...prefs, server: address, model });
              notify(`The translator now uses ${modelName(model)} on this computer.`);
            }}
          />
        </div>
      </details>
    </section>
  );
}

export default defineCustomTool(Translator);
