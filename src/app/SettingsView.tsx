import { useEffect, useState } from 'preact/hooks';
import { APP_NAME } from '../brand';
import { isDesktop, openReleasePage, pickFile, readTextFile, saveFile } from '../platform';
import { networkStatus } from '../platform/net';
import { NOT_INCLUDED, TOOLS } from '../tools/registry';
import { attempt, notify } from '../ui/toast';
import { exportSettings, forgetToolOptions, importSettings, resetSettings, type ThemeChoice, updateSettings, useSettings } from './store';
import { checkForUpdates, RELEASES_PAGE, type UpdateCheck } from './updates';

declare const __APP_VERSION__: string;

/** The AI models panel, loaded only when Settings is opened in the desktop app. */
function Suspended() {
  const [Panel, setPanel] = useState<(() => preact.JSX.Element) | null>(null);
  useEffect(() => {
    void import('../tools/custom/_ai').then((module) => setPanel(() => module.AiModelsPanel));
  }, []);
  return Panel ? <Panel /> : <p class="tone-muted">Loading…</p>;
}

function Licenses() {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || text !== null) return;
    // A file that ships inside the app; this is not a network request.
    fetch('./THIRD-PARTY-LICENSES.txt')
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error('missing'))))
      .then(setText, () => setText('The licence notices are generated when the app is built (pnpm build).'));
  }, [open, text]);
  return (
    <details class="licenses" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Open-source licences of the bundled libraries and fonts</summary>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable from the keyboard */}
      <pre tabIndex={0}>{text ?? 'Loading…'}</pre>
    </details>
  );
}

/** Check for updates: one request to GitHub when pressed; nothing runs in the background. */
function Updates() {
  const [state, setState] = useState<{ busy: boolean; result: UpdateCheck | null; error: string | null }>({ busy: false, result: null, error: null });
  const ready = networkStatus();
  const check = () => {
    setState({ busy: true, result: null, error: null });
    checkForUpdates(__APP_VERSION__).then(
      (result) => setState({ busy: false, result, error: null }),
      (error: unknown) => setState({ busy: false, result: null, error: error instanceof Error ? error.message : String(error) }),
    );
  };
  const { result } = state;
  return (
    <div class="about updates" data-testid="updates">
      <div class="button-row">
        <button type="button" class="button" onClick={check} disabled={state.busy || !ready.ok} data-testid="check-updates">
          {state.busy ? 'Checking…' : 'Check for updates'}
        </button>
        {isDesktop && (
          <button type="button" class="button button-quiet" onClick={() => void attempt(() => openReleasePage(result?.latest?.tag))}>
            Open the releases page
          </button>
        )}
      </div>
      <p role="status" class={state.error ? 'tone-bad' : undefined} data-testid="update-status">
        {!ready.ok && `${ready.reason.replace('Online checks need', 'Checking for updates needs').replace('to use this tool', 'to check')}`}
        {ready.ok && !state.busy && !result && !state.error && 'Asks GitHub for the newest release when you press the button. Updates are never downloaded or installed by themselves.'}
        {state.error}
        {result?.newer &&
          result.latest &&
          `Benchtop ${result.latest.version} is available${result.latest.published ? ` (released ${result.latest.published})` : ''}. Download it from the releases page.`}
        {result && !result.newer && (result.latest ? `You have the newest version, ${result.current}.` : 'No releases are published yet.')}
      </p>
      {!isDesktop && <p class="tone-muted">Releases: {RELEASES_PAGE}</p>}
    </div>
  );
}

/** Web features left out on purpose, with the reason for each. */
function LeftOut() {
  return (
    <details class="licenses">
      <summary>What is left out on purpose, and why ({NOT_INCLUDED.length})</summary>
      <ul class="left-out">
        {NOT_INCLUDED.map((item) => (
          <li key={item.name}>
            <strong>{item.name}:</strong> {item.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SettingsView() {
  const settings = useSettings();
  const remembered = Object.keys(settings.toolOptions).length;

  return (
    <div class="settings">
      <header class="tool-header">
        <div class="tool-heading">
          <h1>Settings</h1>
          <p>Preferences are stored on this computer only.</p>
        </div>
      </header>

      <section class="settings-group">
        <h2>Appearance</h2>
        <div class="settings-row">
          <label for="setting-theme">Theme</label>
          <select id="setting-theme" class="input" value={settings.theme} onChange={(event) => updateSettings({ theme: event.currentTarget.value as ThemeChoice })}>
            <option value="system">Match the system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div class="settings-row">
          <label for="setting-font">Editor text size</label>
          <div class="range">
            <input
              id="setting-font"
              type="range"
              min={10}
              max={24}
              step={1}
              value={settings.editorFontSize}
              onInput={(event) => updateSettings({ editorFontSize: Number(event.currentTarget.value) })}
            />
            <span class="unit">{settings.editorFontSize} px</span>
          </div>
        </div>
        <div class="settings-row">
          <label for="setting-wrap">Wrap long lines in editors</label>
          <label class="toggle" for="setting-wrap">
            <input
              id="setting-wrap"
              type="checkbox"
              role="switch"
              aria-checked={settings.wrapLines}
              checked={settings.wrapLines}
              onChange={(event) => updateSettings({ wrapLines: event.currentTarget.checked })}
            />
            <span class="toggle-track" aria-hidden="true" />
          </label>
        </div>
      </section>

      <section class="settings-group">
        <h2>Network</h2>
        <div class="settings-row">
          <label for="setting-network">
            Allow online checks
            <small>
              {isDesktop
                ? 'Only the tools in the Online checks category use the network, and only for the hosts you enter, when you press Check. Every other tool works offline.'
                : 'Online checks need the desktop app. In a browser every tool works offline.'}
            </small>
          </label>
          <label class="toggle" for="setting-network">
            <input
              id="setting-network"
              type="checkbox"
              role="switch"
              aria-checked={settings.allowNetwork}
              checked={settings.allowNetwork}
              onChange={(event) => updateSettings({ allowNetwork: event.currentTarget.checked })}
            />
            <span class="toggle-track" aria-hidden="true" />
          </label>
        </div>
      </section>

      {isDesktop && (
        <section class="settings-group" id="ai-models">
          <h2>AI models</h2>
          <Suspended />
        </section>
      )}

      <section class="settings-group">
        <h2>Memory</h2>
        <div class="settings-row">
          <label for="setting-remember">
            Remember each tool's options
            <small>Text you type into tools, and passwords or keys, are never stored.</small>
          </label>
          <label class="toggle" for="setting-remember">
            <input
              id="setting-remember"
              type="checkbox"
              role="switch"
              aria-checked={settings.rememberOptions}
              checked={settings.rememberOptions}
              onChange={(event) => updateSettings({ rememberOptions: event.currentTarget.checked })}
            />
            <span class="toggle-track" aria-hidden="true" />
          </label>
        </div>
        <div class="settings-row">
          <span>
            Saved options
            <small>{remembered === 0 ? 'No tool has saved options.' : `${remembered} tool${remembered === 1 ? ' has' : 's have'} saved options.`}</small>
          </span>
          <button
            type="button"
            class="button"
            disabled={remembered === 0}
            onClick={() => {
              forgetToolOptions();
              notify('Saved options cleared');
            }}
          >
            Clear saved options
          </button>
        </div>
        <div class="settings-row">
          <span>
            Back up or move your settings
            <small>Includes theme, favourites and saved tool options.</small>
          </span>
          <div class="button-row">
            <button
              type="button"
              class="button"
              onClick={() =>
                attempt(async () => {
                  const saved = await saveFile('benchtop-settings.json', exportSettings(), 'application/json');
                  if (saved.saved) notify(`Saved to ${saved.location}`);
                })
              }
            >
              Export settings
            </button>
            <button
              type="button"
              class="button"
              onClick={() =>
                attempt(async () => {
                  const file = await pickFile('.json,application/json');
                  if (!file) return;
                  importSettings(await readTextFile(file));
                  notify('Settings imported');
                })
              }
            >
              Import settings
            </button>
          </div>
        </div>
        <div class="settings-row">
          <span>
            Start over
            <small>Restores every setting, favourite and saved option to its default.</small>
          </span>
          <button
            type="button"
            class="button button-danger"
            onClick={() => {
              resetSettings();
              notify('All settings reset');
            }}
          >
            Reset all settings
          </button>
        </div>
      </section>

      <section class="settings-group">
        <h2>Keyboard</h2>
        <dl class="shortcuts">
          <div>
            <dt>
              <kbd>Ctrl</kbd> <kbd>K</kbd>
            </dt>
            <dd>Find a tool</dd>
          </div>
          <div>
            <dt>
              <kbd>Ctrl</kbd> <kbd>B</kbd>
            </dt>
            <dd>Show or hide the sidebar</dd>
          </div>
          <div>
            <dt>
              <kbd>Ctrl</kbd> <kbd>Enter</kbd>
            </dt>
            <dd>Run the current tool again</dd>
          </div>
          <div>
            <dt>
              <kbd>Ctrl</kbd> <kbd>F</kbd>
            </dt>
            <dd>Search inside the focused editor</dd>
          </div>
          <div>
            <dt>
              <kbd>Esc</kbd> then <kbd>Tab</kbd>
            </dt>
            <dd>Leave an editor with the keyboard (Tab alone indents)</dd>
          </div>
        </dl>
      </section>

      <section class="settings-group">
        <h2>About</h2>
        <p class="about">
          {APP_NAME} {__APP_VERSION__}, {isDesktop ? 'desktop app' : 'running in a browser'}. {TOOLS.length} tools. Free and open-source software under the MIT licence.
        </p>
        <p class="about">
          It makes no network connections of its own: no telemetry, no automatic update check and no remote content. The network is used only when you ask for it: the online checks, downloading an AI
          model, and checking for updates below.
        </p>
        <Updates />
        <LeftOut />
        <Licenses />
      </section>
    </div>
  );
}
