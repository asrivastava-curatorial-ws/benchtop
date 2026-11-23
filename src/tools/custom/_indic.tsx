/**
 * "IndicTrans2 on this computer" for the Video Dubbing tool: one click sets up a
 * private Python with PyTorch and the IndicTrans2 models in Benchtop's folder
 * (indic.rs), and the translation server then runs in the background, offline.
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

export function IndicPanel({ script, onReady }: { script: string; onReady: (address: string) => void }) {
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

  const refresh = () =>
    void indicStatus().then((s) => {
      setStatus(s);
      if (s.ready && s.port && switchWhenReady.current) {
        switchWhenReady.current = false;
        onReady(indicAddress(s.port));
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
          switchWhenReady.current = true;
          void startIndic().then(refresh, (error) => setProblem(String(error)));
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

  const begin = (modelsOnly: boolean) =>
    void attempt(async () => {
      setProblem(null);
      setProgress({ step: modelsOnly ? 'models' : 'uv', label: modelsOnly ? 'Downloading the models' : 'Starting', done: 0, total: 0, finished: [], log: [] });
      await setUpIndic({ token: token.trim() || undefined, gpu, ...(modelsOnly ? { modelsOnly: true } : {}) });
      setToken('');
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
      <h4 class="indic-title">IndicTrans2 on this computer</h4>
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
            One click sets up AI4Bharat's IndicTrans2, the best translator for India's 22 scheduled languages. Benchtop downloads a private copy of Python, PyTorch and the two models (about 2.5 GB,
            into its own folder, nothing installed system-wide) and afterwards translates offline.
          </p>
          {tokenField}
          {status.gpuChoice && (
            <label class="toggle" for="indic-gpu">
              <input id="indic-gpu" type="checkbox" role="switch" aria-checked={gpu} checked={gpu} onChange={(e) => setGpu(e.currentTarget.checked)} />
              <span class="toggle-track" aria-hidden="true" />
              <span class="toggle-text">Use an NVIDIA graphics card (faster; about 2.5 GB more)</span>
            </label>
          )}
          <div class="button-row">
            <button type="button" class="button button-primary button-small" onClick={() => begin(false)} data-testid="indic-setup">
              Set up IndicTrans2
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
            English → Indian languages{installed.models.includes('en-indic') ? ' ✓' : ': not downloaded'}; Indian languages → English{reverse ? ' ✓' : ': needs a token'}.
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
            {status.ready && status.port && (
              <button type="button" class="button button-small button-quiet" onClick={() => onReady(indicAddress(status.port as number))}>
                Use it for this video
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
              <button type="button" class="button button-small" disabled={!token.trim()} onClick={() => begin(true)} data-testid="indic-models">
                Download the model
              </button>
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
                Remove IndicTrans2{size ? ` (${formatBytes(size)})` : ''}
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
