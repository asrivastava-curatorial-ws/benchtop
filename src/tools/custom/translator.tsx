/**
 * Text Translator: translates typed text, OCR results, documents and subtitles
 * with translation models on this computer: IndicTrans2 (English and the 22
 * scheduled languages of India), M2M-100, NLLB-200, MADLAD-400 or any Hugging
 * Face translation model you add (Arabic, Chinese, Japanese, Russian and
 * hundreds more), all set up in a click; or an OpenAI-compatible chat server
 * such as Ollama.  Layout, lists and subtitle timing are kept; nothing leaves
 * the computer unless you point it at a server elsewhere.
 *
 * It also types and transliterates, offline and instantly (also in a browser):
 * Roman letters into the scripts of 35 languages, five more on on-screen keyboards,
 * and any Indian script into another or into IAST, ISO 15919 or ITRANS, with the
 * rules of the author's Universal Transliterator (lib/transliterate.ts).
 */
import { useMemo, useRef, useState } from 'preact/hooks';
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
import {
  type ConvertTarget,
  convertIndic,
  detectIndicScript,
  hasNativeDigits,
  INDIC_SCRIPTS,
  isRomanization,
  keyboardFor,
  ROMANIZATIONS,
  TYPING_LANGUAGES,
  transliterateParts,
  typingLanguage,
} from '../../lib/transliterate';
import { copyText, isDesktop, pickFile, readTextFile, saveFile } from '../../platform';
import { isLoopback, netFor, networkStatus } from '../../platform/net';
import { Icon } from '../../ui/icons';
import { SendTo } from '../../ui/SendTo';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { IndicPanel } from './_indic';
import { usePersistentState } from './_shared';

type Mode = 'translate' | 'type' | 'convert';

const MODES: readonly (readonly [Mode, string])[] = [
  ['translate', 'Translate'],
  ['type', 'Type in a script'],
  ['convert', 'Convert script'],
];

const CONVERT_TARGETS: readonly { readonly id: ConvertTarget; readonly name: string }[] = [...INDIC_SCRIPTS.map((script) => ({ id: script, name: script })), ...ROMANIZATIONS];

/** How many chosen spellings are remembered (the oldest go first). */
const MAX_CHOICES = 300;

interface Prefs {
  readonly from: string;
  readonly to: string;
  readonly server: string;
  readonly model: string;
  readonly context: string;
  readonly mode: Mode;
  /** The language typed in. */
  readonly typeLang: string;
  readonly digits: boolean;
  readonly keyboard: boolean;
  /** What Convert script writes. */
  readonly target: ConvertTarget;
  /** Spellings chosen for words with more than one: "language:word" → spelling. */
  readonly choices: Readonly<Record<string, string>>;
}

const OLLAMA = 'http://localhost:11434/v1/chat/completions';

function readChoices(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, choice] of Object.entries(value as Record<string, unknown>).slice(-MAX_CHOICES)) {
    if (/^[a-z]{2,3}:./.test(key) && key.length <= 100 && typeof choice === 'string' && choice.length <= 100) out[key] = choice;
  }
  return out;
}

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
    mode: MODES.some(([mode]) => mode === stored?.mode) ? (stored?.mode as Mode) : 'translate',
    typeLang: TYPING_LANGUAGES.some((l) => l.id === stored?.typeLang) ? (stored?.typeLang as string) : 'hi',
    digits: stored?.digits === true,
    keyboard: stored?.keyboard === true,
    target: CONVERT_TARGETS.some((t) => t.id === stored?.target) ? (stored?.target as ConvertTarget) : 'iast',
    choices: readChoices(stored?.choices),
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

/** The translation language for a typing language, if the translator knows it. */
const translatable = (id: string): string | null => (TRANSLATION_LANGUAGES.some((l) => l.code === id) ? id : null);

function Translator({ toolId }: { toolId: string }) {
  const [prefs, setPrefs] = usePersistentState(toolId, readPrefs, writePrefs);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState('');
  const [typed, setTyped] = useState('');
  const [source, setSource] = useState('');
  const stop = useRef(false);
  const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) => setPrefs({ ...prefs, [key]: value });

  const detected = prefs.from === 'auto' && input.trim() ? detectLanguage(input) : null;
  const subtitles = subtitleFormat(input);
  const local = isLoopback(prefs.server);
  const status = networkStatus();
  const gate =
    !isDesktop && !status.ok
      ? 'Translating needs the Benchtop desktop app, which talks to the translation server on this computer. In a browser you can still type, transliterate and edit text here.'
      : '';
  const indic = prefs.model === 'indictrans2';
  // A model Benchtop's own translation server runs (rather than a chat model).
  const ownModel = indic || prefs.model.startsWith('hf:') || MODEL_CATALOGUE.some((m) => m.key === prefs.model);

  const load = async (file: File) => {
    setInput(await readTextFile(file));
    setFileName(file.name);
    setOutput('');
    setSummary('');
    if (prefs.mode !== 'translate') set('mode', 'translate');
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

  const state = prefs.mode === 'translate' ? (busy ? 'busy' : output ? 'done' : 'idle') : (prefs.mode === 'type' ? typed : source) ? 'done' : 'idle';

  return (
    <section class="tool tr" data-testid="tool" data-state={state}>
      {/* A plain wrapper: the clipped segmented control alone could be squeezed to nothing by the grid. */}
      <div class="tr-modes">
        <div class="segmented" role="radiogroup" aria-label="What to do with the text">
          {MODES.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={prefs.mode === mode}
              class={prefs.mode === mode ? 'is-active' : ''}
              disabled={busy && mode !== 'translate'}
              onClick={() => set('mode', mode)}
              data-testid={`tr-mode-${mode}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {prefs.mode === 'type' && (
        <TypingMode
          prefs={prefs}
          setPrefs={setPrefs}
          text={typed}
          setText={setTyped}
          toolId={toolId}
          onTranslate={(text, language) => {
            setInput(text);
            setOutput('');
            setFileName('');
            setSummary('');
            setPrefs({ ...prefs, mode: 'translate', from: translatable(language) ?? 'auto' });
          }}
        />
      )}

      {prefs.mode === 'convert' && <ConvertMode prefs={prefs} setPrefs={setPrefs} text={source} setText={setSource} toolId={toolId} />}

      {prefs.mode === 'translate' && (
        <>
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
                  {detectIndicScript(output) && (
                    <button
                      type="button"
                      class="button button-small button-quiet"
                      title="Write the translation in another script or in Roman letters"
                      onClick={() => {
                        setSource(output);
                        set('mode', 'convert');
                      }}
                      data-testid="tr-to-convert"
                    >
                      Convert script
                    </button>
                  )}
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
                Translation models on this computer (below) work offline: IndicTrans2 for English and India’s 22 scheduled languages; M2M-100, NLLB-200 or MADLAD-400 for Arabic, Chinese, Japanese,
                Russian and hundreds of other languages; or any Hugging Face translation model you add. A chat model also works: Ollama (ollama serve, then ollama pull gemma3:12b), LM Studio or a
                llama.cpp server. Servers on this computer always work; for one elsewhere on your network, turn on online checks in Settings.
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
        </>
      )}
    </section>
  );
}

type SetPrefs = (next: Prefs | ((previous: Prefs) => Prefs)) => void;

/** Copy, save and send for a result pane. */
function ResultActions({ text, name, what, toolId, testId }: { text: string; name: string; what: string; toolId: string; testId: string }) {
  return (
    <>
      <button
        type="button"
        class="icon-button"
        aria-label={`Copy the ${what}`}
        title="Copy"
        disabled={!text}
        onClick={() =>
          void attempt(async () => {
            await copyText(text);
            notify('Copied.');
          })
        }
        data-testid={`${testId}-copy`}
      >
        <Icon name="copy" size={16} />
      </button>
      <button
        type="button"
        class="button button-small"
        disabled={!text}
        onClick={() =>
          void attempt(async () => {
            const saved = await saveFile(name, text, 'text/plain');
            if (saved.saved) notify(`Saved to ${saved.location}`);
          })
        }
        data-testid={`${testId}-save`}
      >
        Save
      </button>
      <SendTo disabled={!text} from={toolId} make={() => new File([text], name, { type: 'text/plain' })} />
    </>
  );
}

const GROUPS = [...new Set(TYPING_LANGUAGES.map((l) => l.group))];

/** Roman letters in, the language's script out, as you type (Universal Transliterator's rules). */
function TypingMode({
  prefs,
  setPrefs,
  text,
  setText,
  toolId,
  onTranslate,
}: {
  prefs: Prefs;
  setPrefs: SetPrefs;
  text: string;
  setText: (text: string) => void;
  toolId: string;
  onTranslate: (text: string, language: string) => void;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const language = typingLanguage(prefs.typeLang);
  const digits = hasNativeDigits(language.id);
  const prefix = `${language.id}:`;
  const choices = useMemo(() => {
    const own: Record<string, string> = {};
    for (const [key, value] of Object.entries(prefs.choices)) if (key.startsWith(prefix)) own[key.slice(prefix.length)] = value;
    return own;
  }, [prefs.choices, prefix]);
  const parts = useMemo(() => transliterateParts(text, language.id, { nativeDigits: prefs.digits && digits, choices }), [text, language.id, prefs.digits, digits, choices]);
  const output = parts.map((part) => part.output).join('');
  // Words with more than one spelling, each once (the latest last, at most 12).
  const ambiguous = useMemo(() => {
    const seen = new Map<string, (typeof parts)[number]>();
    for (const part of parts) {
      if (part.options.length > 1) {
        seen.delete(part.source);
        seen.set(part.source, part);
      }
    }
    return [...seen.values()].slice(-12);
  }, [parts]);
  const keys = keyboardFor(language.id);
  const dir = language.rtl ? 'rtl' : 'ltr';

  const choose = (word: string, spelling: string) =>
    setPrefs((previous) => {
      const next = { ...previous.choices };
      delete next[prefix + word];
      next[prefix + word] = spelling;
      const entries = Object.entries(next);
      return { ...previous, choices: Object.fromEntries(entries.slice(-MAX_CHOICES)) };
    });

  const insert = (key: string) => {
    const element = editor.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + key + text.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + key.length, start + key.length);
    });
  };

  return (
    <>
      <div class="tr-bar">
        <label class="af-field">
          <span class="control-label">Language</span>
          <select class="input" value={language.id} onChange={(e) => setPrefs({ ...prefs, typeLang: e.currentTarget.value })} data-testid="tr-type-language">
            {GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {TYPING_LANGUAGES.filter((l) => l.group === group).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.native}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {digits && (
          <label class="check tr-check">
            <input type="checkbox" checked={prefs.digits} onChange={(e) => setPrefs({ ...prefs, digits: e.currentTarget.checked })} data-testid="tr-type-digits" />
            <span>Native digits</span>
          </label>
        )}
        <button type="button" class="button button-small" aria-pressed={prefs.keyboard} onClick={() => setPrefs({ ...prefs, keyboard: !prefs.keyboard })} data-testid="tr-type-keyboard">
          On-screen keyboard
        </button>
        {language.example && (
          <button type="button" class="button button-small button-quiet" onClick={() => setText(language.example)} data-testid="tr-type-example">
            Try “{language.example}”
          </button>
        )}
      </div>
      <p class="control-help tr-note" data-testid="tr-type-note">
        {language.engine === 'exact' ? 'Exact spelling' : language.engine === 'rules' ? 'Phonetic rules' : 'Keyboard'}:{' '}
        {/* Each "Roman → letter" pair is kept left to right, so right-to-left letters do not reorder the line. */}
        {language.note.split(' · ').map((item, index) => (
          <span key={item}>
            {index > 0 && ' · '}
            <span dir="ltr">{item}</span>
          </span>
        ))}
      </p>

      <div class="tr-panes">
        <div class="pane">
          <div class="pane-header">
            <h2 class="pane-title">{language.engine === 'keyboard' ? 'Text' : 'Roman letters'}</h2>
            <span class="pane-meta">{text ? `${text.length.toLocaleString()} characters` : ''}</span>
            <div class="pane-actions">
              <button type="button" class="button button-small button-quiet" disabled={!text} onClick={() => setText('')}>
                Clear
              </button>
            </div>
          </div>
          <textarea
            ref={editor}
            class="input tr-text"
            value={text}
            dir={language.engine === 'keyboard' ? dir : 'ltr'}
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            placeholder={language.engine === 'keyboard' ? KEYBOARD_PLACEHOLDER : `Type ${language.name} in Roman letters, for example: ${language.example}`}
            onInput={(e) => setText(e.currentTarget.value)}
            aria-label={`${language.name} in Roman letters`}
            data-testid="tr-type-input"
          />
        </div>
        <div class="pane">
          <div class="pane-header">
            <h2 class="pane-title">
              {language.name} <span lang={language.id}>{language.native}</span>
            </h2>
            <span class="pane-meta">{output ? 'Updates as you type' : ''}</span>
            <div class="pane-actions">
              {translatable(language.id) && (
                <button type="button" class="button button-small button-quiet" disabled={!output.trim()} onClick={() => onTranslate(output, language.id)} data-testid="tr-type-translate">
                  Translate this
                </button>
              )}
              <ResultActions text={output} name={`${language.id}.txt`} what="text" toolId={toolId} testId="tr-type" />
            </div>
          </div>
          <textarea class="input tr-text tr-script" lang={language.id} dir={dir} value={output} readOnly aria-label={`${language.name} text`} data-testid="tr-type-output" />
        </div>
      </div>

      {ambiguous.length > 0 && (
        <div class="tr-spellings" data-testid="tr-spellings">
          <span class="control-label">Other spellings</span>
          {ambiguous.map((part) => (
            <div key={part.source} class="tr-spelling-row">
              <span class="tr-spelling-word">{part.source}</span>
              {part.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  class="button button-small"
                  aria-pressed={option === part.output}
                  lang={language.id}
                  dir={dir}
                  onClick={() => choose(part.source, option)}
                  data-testid="tr-spelling"
                >
                  {option}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {prefs.keyboard && (
        <div class="tr-keyboard" dir={keys.layout?.rtl ? 'rtl' : 'ltr'} lang={language.id} role="group" aria-label={`${keys.layout?.name ?? language.name} keyboard`} data-testid="tr-keyboard">
          {[...(keys.layout?.rows ?? []), ...(keys.marks.length ? [keys.marks] : [])].map((row, index) => (
            <div key={index} class="tr-key-row">
              {row.map((key) => (
                <button key={key} type="button" class="tr-key" title={key} aria-label={key} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(key)} data-testid="tr-key">
                  {MARK_ONLY.test(key) ? `◌${key}` : key}
                </button>
              ))}
            </div>
          ))}
          <div class="tr-key-row">
            <button type="button" class="tr-key tr-key-wide" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(' ')}>
              Space
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const KEYBOARD_PLACEHOLDER = 'Type with the on-screen keyboard (turn it on above) or your system’s keyboard layout.';
/** A key that is only a vowel sign or mark, shown on a dotted circle. */
const MARK_ONLY = /^\p{M}+$/u;

/** Text in any Indian script into another, or into Roman letters. */
function ConvertMode({ prefs, setPrefs, text, setText, toolId }: { prefs: Prefs; setPrefs: SetPrefs; text: string; setText: (text: string) => void; toolId: string }) {
  const script = text.trim() ? detectIndicScript(text) : null;
  const output = useMemo(() => convertIndic(text, prefs.target), [text, prefs.target]);
  const target = CONVERT_TARGETS.find((t) => t.id === prefs.target);
  return (
    <>
      <div class="tr-bar">
        <span class="af-field">
          <span class="control-label">From</span>
          <span class="tr-detected" data-testid="tr-convert-detected">
            {script ? `${script} (found in the text)` : 'Any Indian script: each letter is read in its own'}
          </span>
        </span>
        <button
          type="button"
          class="button button-quiet tr-swap"
          title="Convert the result back"
          aria-label="Convert the result back"
          disabled={!script || isRomanization(prefs.target)}
          onClick={() => {
            if (!script || isRomanization(prefs.target)) return;
            setText(output);
            setPrefs({ ...prefs, target: script });
          }}
          data-testid="tr-convert-swap"
        >
          <Icon name="swap" size={16} />
        </button>
        <label class="af-field">
          <span class="control-label">To</span>
          <select class="input" value={prefs.target} onChange={(e) => setPrefs({ ...prefs, target: e.currentTarget.value as ConvertTarget })} data-testid="tr-convert-to">
            <optgroup label="Scripts">
              {INDIC_SCRIPTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </optgroup>
            <optgroup label="Roman letters">
              {ROMANIZATIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
      <p class="control-help tr-note">
        Devanagari, Bengali, Assamese, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam and Sinhala, in each script’s own spelling (Gurmukhi addak, Malayalam chillu letters, Odia ୱ, Tamil’s
        nearest letters for aspirates). Simple Roman is an English-style spelling for labels and names.
      </p>
      <div class="tr-panes">
        <div class="pane">
          <div class="pane-header">
            <h2 class="pane-title">Text</h2>
            <span class="pane-meta">{text ? `${text.length.toLocaleString()} characters` : ''}</span>
            <div class="pane-actions">
              <button type="button" class="button button-small button-quiet" disabled={!text} onClick={() => setText('')}>
                Clear
              </button>
            </div>
          </div>
          <textarea
            class="input tr-text tr-script"
            value={text}
            placeholder="Paste text in any Indian script, for example: नमस्ते भारत or ನಮಸ್ಕಾರ"
            onInput={(e) => setText(e.currentTarget.value)}
            aria-label="Text to convert"
            data-testid="tr-convert-input"
          />
        </div>
        <div class="pane">
          <div class="pane-header">
            <h2 class="pane-title">{target?.name ?? 'Result'}</h2>
            <div class="pane-actions">
              <ResultActions text={output} name={`converted.${prefs.target.toLowerCase()}.txt`} what="result" toolId={toolId} testId="tr-convert" />
            </div>
          </div>
          <textarea class="input tr-text tr-script" value={output} readOnly aria-label={`${target?.name ?? 'Converted'} text`} data-testid="tr-convert-output" />
        </div>
      </div>
    </>
  );
}

export default defineCustomTool(Translator);
