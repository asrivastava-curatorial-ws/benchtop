/**
 * "IndicTrans2 on this computer" for Video Dubbing and the Text Translator: one
 * click sets up a private Python with PyTorch and the IndicTrans2 models in
 * Benchtop's folder (indic.rs), and the translation server then runs in the
 * background, offline.  Given a catalogue, it also downloads models for other
 * languages (M2M-100, NLLB-200, MADLAD-400 or any Hugging Face model) that the
 * same server runs.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { isDesktop, openLink, saveFile } from '../../platform';
import {
  cancelIndicSetup,
  type IndicSetupEvent,
  type IndicStatus,
  indicAddress,
  indicSize,
  indicStatus,
  onIndicServer,
  onIndicSetup,
  removeIndic,
  setUpIndic,
  startIndic,
  stopIndic,
} from '../../platform/indic';
import { attempt, notify } from '../../ui/toast';

const STEPS: readonly [string, string][] = [
  ['uv', 'Get the installer (uv)'],
  ['python', 'Get Python'],
  ['torch', 'Install PyTorch'],
  ['libraries', 'Install Transformers and the text tools'],
  ['models', 'Download the IndicTrans2 models'],
  ['finish', 'Tidy up'],
];

const MODEL_PAGE = 'https://huggingface.co/ai4bharat/indictrans2-indic-en-dist-200M';
const TOKENS_PAGE = 'https://huggingface.co/settings/tokens';

interface Progress {
  readonly step: string;
  readonly label: string;
  readonly done: number;
  readonly total: number;
  readonly finished: readonly string[];
  readonly log: readonly string[];
}

/** A translation model the panel offers to download (the server knows these names). */
export interface ExtraModel {
  readonly key: string;
  readonly name: string;
  readonly languages: string;
  readonly size: string;
  readonly licence: string;
  readonly note?: string;
}

const HF_REPO = /^[A-Za-z0-9][\w.-]{0,95}\/[A-Za-z0-9][\w.-]{0,95}$/;
const isIndic = (key: string) => key === 'en-indic' || key === 'indic-en';

export function IndicPanel({
  script,
  onReady,
  useLabel = 'Use it for this video',
  catalogue,
  onModel,
}: {
  script: string;
  onReady: (address: string) => void;
  useLabel?: string;
  /** Models for other languages to offer (the Text Translator). */
  catalogue?: readonly ExtraModel[];
  onModel?: (address: string, model: string) => void;
}) {
  const [status, setStatus] = useState<IndicStatus | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [token, setToken] = useState('');
  const [gpu, setGpu] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Set when the user starts the server (or a setup finishes): once it is ready, the dubbing
  // tool switches to it.  A server that was already running leaves the tool's choice alone.
  const switchWhenReady = useRef(false);
  // A model for other languages to switch to once the server is ready.
  const useWhenReady = useRef<string | null>(null);
  // The models the setup under way is fetching.
  const pending = useRef<readonly string[]>([]);
  const [first, setFirst] = useState('indictrans2');
  const [custom, setCustom] = useState('');

  const refresh = () =>
    void indicStatus().then((s) => {
      setStatus(s);
      if (s.ready && s.port && switchWhenReady.current) {
        switchWhenReady.current = false;
        onReady(indicAddress(s.port));
      }
      if (s.ready && s.port && useWhenReady.current) {
        const model = useWhenReady.current;
        useWhenReady.current = null;
        onModel?.(indicAddress(s.port), model);
      }
    });

  useEffect(() => {
    refresh();
    const stopSetup = onIndicSetup((event: IndicSetupEvent) => {
      if (event.kind === 'step' && event.step) {
        setProgress((p) => ({
          step: event.step as string,
          label: event.message ?? '',
          done: 0,
          total: 0,
          finished: p ? [...p.finished, p.step].filter((s, i, all) => all.indexOf(s) === i && s !== event.step) : [],
          log: [],
        }));
      } else if (event.kind === 'progress') {
        setProgress((p) => (p ? { ...p, done: event.done, total: event.total } : p));
      } else if (event.kind === 'log' && event.message) {
        const line = event.message;
        setProgress((p) => (p ? { ...p, log: [...p.log.slice(-3), line] } : p));
      } else if (event.kind === 'done' || event.kind === 'error' || event.kind === 'cancelled') {
        setProgress(null);
        if (event.kind === 'error') setProblem(event.message);
        else if (event.message) notify(event.message, 'info');
        refresh();
        if (event.kind === 'done') {
          const asked = pending.current;
          pending.current = [];
          if (asked.length && !asked.some(isIndic)) useWhenReady.current = asked[0] ?? null;
          else switchWhenReady.current = true;
          void startIndic().then(refresh, (error) => setProblem(String(error)));
        } else {
          pending.current = [];
        }
      }
    });
    const stopServer = onIndicServer((event) => {
      if (!event.ready && event.message) setProblem(event.message);
      refresh();
    });
    return () => {
      void stopSetup.then((u) => u());
      void stopServer.then((u) => u());
    };
  }, []);

  useEffect(() => {
    if (status?.installed && !status.busy) void indicSize().then(setSize);
  }, [status?.installed?.models.length, status?.busy]);

  const saveScript = (
    <button type="button" class="link-button" onClick={() => attempt(async () => void (await saveFile('indictrans2-server.py', script, 'text/x-python')))}>
      save the server script
    </button>
  );

  if (!isDesktop || (status && !status.supported)) {
    return (
      <div class="indic-panel" data-testid="indic-panel">
        <h4 class="indic-title">IndicTrans2 on this computer</h4>
        <p class="control-help">
          {isDesktop ? 'Benchtop cannot set IndicTrans2 up by itself on this kind of computer.' : 'The desktop app can set up IndicTrans2 with one click.'} You can also run it yourself: {saveScript}{' '}
          and follow its first lines.
        </p>
      </div>
    );
  }
  if (!status) return <div class="indic-panel" data-testid="indic-panel" />;

  const begin = (modelsOnly: boolean, models: readonly string[] = []) =>
    void attempt(async () => {
      setProblem(null);
      pending.current = models;
      setProgress({ step: modelsOnly ? 'models' : 'uv', label: modelsOnly ? 'Downloading the models' : 'Starting', done: 0, total: 0, finished: [], log: [] });
      await setUpIndic({ token: token.trim() || undefined, gpu, ...(modelsOnly ? { modelsOnly: true } : {}), ...(models.length ? { models: [...models] } : {}) });
      setToken('');
      refresh();
    });

  const use = (model: string) =>
    void attempt(async () => {
      if (status.ready && status.port) {
        onModel?.(indicAddress(status.port), model);
        return;
      }
      setProblem(null);
      useWhenReady.current = model;
      if (!status.running) await startIndic();
      refresh();
    });

  const tokenField = (
    <label class="control">
      <span class="control-label">Hugging Face access token (for translating from Indian languages)</span>
      <input class="input mono" type="password" autocomplete="off" value={token} onInput={(e) => setToken(e.currentTarget.value)} placeholder="hf_…" data-testid="indic-token" />
      <span class="control-help">
        The Indian-to-English model asks you to accept its terms first: sign in to Hugging Face, open{' '}
        <button type="button" class="link-button" onClick={() => attempt(() => openLink(MODEL_PAGE))}>
          the model's page
        </button>{' '}
        and accept, then make a read token on{' '}
        <button type="button" class="link-button" onClick={() => attempt(() => openLink(TOKENS_PAGE))}>
          your tokens page
        </button>
        . The token is used for this download only and is not saved.
      </span>
    </label>
  );

  const busy = status.busy || progress !== null;
  const installed = status.installed;
  const reverse = installed?.models.includes('indic-en') ?? false;

  return (
    <div class="indic-panel" data-testid="indic-panel">
      <h4 class="indic-title">{catalogue ? 'Translation models on this computer' : 'IndicTrans2 on this computer'}</h4>
      {busy ? (
        <>
          <ol class="indic-steps">
            {STEPS.filter(([id]) => id !== 'uv' || progress?.step === 'uv' || progress?.finished.includes('uv')).map(([id, label]) => {
              const state = progress?.step === id ? 'now' : progress?.finished.includes(id) ? 'done' : 'todo';
              return (
                <li key={id} class={`indic-step is-${state}`}>
                  {state === 'done' ? '✓ ' : state === 'now' ? '… ' : ''}
                  {state === 'now' && progress?.label ? progress.label : label}
                  {state === 'now' && progress && progress.done > 0 && (
                    <span class="tone-muted">
                      {' '}
                      {formatBytes(progress.done)}
                      {progress.total > 0 ? ` of ${formatBytes(progress.total)}` : ' so far'}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {progress && progress.log.length > 0 && <pre class="indic-log">{progress.log.join('\n')}</pre>}
          <div class="button-row">
            <button type="button" class="button button-small" onClick={() => attempt(cancelIndicSetup)} data-testid="indic-cancel">
              Stop
            </button>
            <span class="control-help">This takes a while the first time; you can keep working in other tools.</span>
          </div>
        </>
      ) : !installed ? (
        <>
          <p class="control-help">
            {catalogue
              ? 'One click downloads a private copy of Python and PyTorch into Benchtop’s own folder (nothing is installed system-wide) and the model you choose; afterwards translation works offline. More models can be added later.'
              : 'One click sets up AI4Bharat’s IndicTrans2, the best translator for India’s 22 scheduled languages. Benchtop downloads a private copy of Python, PyTorch and the two models (about 2.5 GB, into its own folder, nothing installed system-wide) and afterwards translates offline.'}
          </p>
          {catalogue && (
            <label class="control">
              <span class="control-label">Start with</span>
              <select class="select" value={first} onChange={(e) => setFirst(e.currentTarget.value)} data-testid="indic-first">
                <option value="indictrans2">IndicTrans2: English and India’s 22 scheduled languages (about 2 GB)</option>
                {catalogue.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.name}: {m.languages} ({m.size}, {m.licence})
                  </option>
                ))}
              </select>
            </label>
          )}
          {(!catalogue || first === 'indictrans2') && tokenField}
          {status.gpuChoice && (
            <label class="toggle" for="indic-gpu">
              <input id="indic-gpu" type="checkbox" role="switch" aria-checked={gpu} checked={gpu} onChange={(e) => setGpu(e.currentTarget.checked)} />
              <span class="toggle-track" aria-hidden="true" />
              <span class="toggle-text">Use an NVIDIA graphics card (faster; about 2.5 GB more)</span>
            </label>
          )}
          <div class="button-row">
            <button type="button" class="button button-primary button-small" onClick={() => begin(false, catalogue && first !== 'indictrans2' ? [first] : [])} data-testid="indic-setup">
              {catalogue ? 'Set up translation on this computer' : 'Set up IndicTrans2'}
            </button>
            <span class="control-help">Or {saveScript} to run it yourself.</span>
          </div>
        </>
      ) : (
        <>
          <p class="control-help" data-testid="indic-state">
            {status.ready
              ? 'Running on this computer; translations go to it.'
              : status.running
                ? 'Starting: loading the models, which can take a minute…'
                : 'Set up. Start it to translate; it stops when Benchtop closes.'}{' '}
            IndicTrans2: English → Indian languages{installed.models.includes('en-indic') ? ' ✓' : ': not downloaded'}; Indian languages → English{reverse ? ' ✓' : ': needs a token'}.
          </p>
          {status.outdated && <p class="control-help">This setup is from an older Benchtop. Set it up again to update it.</p>}
          <div class="button-row">
            {status.running ? (
              <button
                type="button"
                class="button button-small"
                onClick={() =>
                  attempt(async () => {
                    await stopIndic();
                    refresh();
                  })
                }
                data-testid="indic-stop"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                class="button button-primary button-small"
                onClick={() =>
                  attempt(async () => {
                    setProblem(null);
                    switchWhenReady.current = true;
                    await startIndic();
                    refresh();
                  })
                }
                data-testid="indic-start"
              >
                Start
              </button>
            )}
            {status.ready && status.port && installed.models.some(isIndic) && (
              <button type="button" class="button button-small button-quiet" onClick={() => onReady(indicAddress(status.port as number))} data-testid="indic-use">
                {useLabel}
              </button>
            )}
            {!installed.models.includes('en-indic') && (
              <button type="button" class="button button-small" onClick={() => begin(true, ['en-indic'])} data-testid="indic-en-indic">
                Download IndicTrans2 (English → Indian languages, about 1 GB)
              </button>
            )}
            {status.outdated && (
              <button type="button" class="button button-small" onClick={() => begin(false)}>
                Set up again
              </button>
            )}
          </div>
          {!reverse && (
            <details class="indic-more">
              <summary>Add Indian → English translation</summary>
              {tokenField}
              <button type="button" class="button button-small" disabled={!token.trim()} onClick={() => begin(true, ['indic-en'])} data-testid="indic-models">
                Download the model
              </button>
            </details>
          )}
          {catalogue && (
            <details class="indic-more" open data-testid="indic-catalogue">
              <summary>Models for other languages</summary>
              <ul class="indic-models">
                {[
                  ...catalogue,
                  ...installed.models
                    .filter((m) => m.startsWith('hf:'))
                    .map((key) => ({ key, name: key.slice(3), languages: 'added by you', size: 'downloaded', licence: 'see its Hugging Face page' })),
                ].map((m) => {
                  const have = installed.models.includes(m.key);
                  return (
                    <li key={m.key} class="indic-model">
                      <span>
                        <strong>{m.name}</strong>: {m.languages}. {m.size}; licence {m.licence}.{'note' in m && m.note ? <span class="control-help"> {m.note}</span> : null}
                      </span>
                      {have ? (
                        <button type="button" class="button button-small" onClick={() => use(m.key)} data-testid={`indic-use-${m.key}`}>
                          Use
                        </button>
                      ) : (
                        <button type="button" class="button button-small" onClick={() => begin(true, [m.key])} data-testid={`indic-get-${m.key}`}>
                          Download
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div class="indic-add">
                {reverse && tokenField}
                <label class="control">
                  <span class="control-label">Add a translation model from Hugging Face (owner/name)</span>
                  <input class="input mono" value={custom} placeholder="Helsinki-NLP/opus-mt-en-ar" spellcheck={false} onInput={(e) => setCustom(e.currentTarget.value)} data-testid="indic-custom" />
                </label>
                <button type="button" class="button button-small" disabled={!HF_REPO.test(custom.trim())} onClick={() => begin(true, [`hf:${custom.trim()}`])} data-testid="indic-custom-get">
                  Download
                </button>
                <p class="control-help">
                  Marian (Opus-MT: one language pair each, small and fast), M2M-100, NLLB, mBART-50 and MADLAD models work. Code that comes with a model is never run. A gated model needs the Hugging
                  Face token above, and only for its download.
                </p>
              </div>
            </details>
          )}
          <div class="button-row">
            {confirmRemove ? (
              <>
                <span class="control-help">Remove Python, PyTorch and the models{size ? ` (${formatBytes(size)})` : ''}?</span>
                <button
                  type="button"
                  class="button button-small"
                  onClick={() =>
                    attempt(async () => {
                      await removeIndic();
                      setConfirmRemove(false);
                      refresh();
                      notify('IndicTrans2 was removed.');
                    })
                  }
                  data-testid="indic-remove-yes"
                >
                  Remove
                </button>
                <button type="button" class="button button-small button-quiet" onClick={() => setConfirmRemove(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button type="button" class="link-button" onClick={() => setConfirmRemove(true)} data-testid="indic-remove">
                {catalogue ? 'Remove the translation models' : 'Remove IndicTrans2'}
                {size ? ` (${formatBytes(size)})` : ''}
              </button>
            )}
          </div>
        </>
      )}
      {problem && (
        <p class="tone-bad indic-problem" data-testid="indic-problem">
          {problem}
        </p>
      )}
    </div>
  );
}
