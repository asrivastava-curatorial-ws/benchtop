/**
 * The page people open to take part in a Live Quiz.  From the desktop app it
 * is served by the quiz relay to phones on the network; in the web version it
 * is join.html#CODE and finds the presenter in another tab of the same browser.
 */
import '@fontsource-variable/jetbrains-mono/wght.css';
import './guest.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { channelGuest, type GuestLink } from '../lib/quiz-hub';
import { GuestView } from './GuestView';
import { relayGuest } from './link';

type View = Record<string, unknown>;
interface Shown {
  readonly view: View | null;
  /** How far the presenter's clock is ahead of this device's, in milliseconds. */
  readonly ahead: number;
  readonly down: boolean;
}

/** This tab's name in a quiz between tabs: kept through a reload, new in every tab. */
function tabId(): string {
  const key = 'benchtop-quiz-tab';
  try {
    const kept = sessionStorage.getItem(key);
    if (kept && /^[a-z0-9]{8,40}$/.test(kept)) return kept;
  } catch {
    /* A private window may refuse storage: the tab is then new after a reload. */
  }
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
  try {
    sessionStorage.setItem(key, id);
  } catch {
    /* Kept for this page only. */
  }
  return id;
}

const code = decodeURIComponent(location.hash.slice(1))
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .slice(0, 12);
/** The web version's page is join.html; the relay serves the same page at the top of its address. */
const tabs = /\/join\.html$/.test(location.pathname);

let shown: Shown = { view: null, ahead: 0, down: false };
let listener: ((next: Shown) => void) | null = null;
const show = (change: Partial<Shown>) => {
  shown = { ...shown, ...change };
  listener?.(shown);
};

// The link is made before anything is drawn, so that no view is missed.
const link: GuestLink | null = tabs ? (code ? channelGuest(code, tabId()) : null) : relayGuest((down) => show({ down }));
if (link) link.onView = (view, now) => show({ view, ahead: now - Date.now() });

function CodeForm() {
  const [typed, setTyped] = useState('');
  return (
    <div class="qz">
      <form
        class="qz-join"
        onSubmit={(e) => {
          e.preventDefault();
          const next = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!next) return;
          location.hash = next;
          location.reload();
        }}
      >
        <h1>Join a quiz</h1>
        <label class="qz-field">
          <span>The code on the presenter's screen</span>
          <input class="qz-input" value={typed} maxLength={12} autocomplete="off" autocapitalize="characters" onInput={(e) => setTyped(e.currentTarget.value)} data-testid="qz-code" />
        </label>
        <button type="submit" class="qz-button qz-primary" disabled={!typed.trim()}>
          Continue
        </button>
        <p class="qz-hint">This page reaches a quiz that is being presented in another tab of this browser. Phones join through the Benchtop desktop app.</p>
      </form>
    </div>
  );
}

function Page() {
  const [state, setState] = useState(shown);
  useEffect(() => {
    listener = setState;
    setState(shown);
    return () => {
      listener = null;
    };
  }, []);
  useEffect(() => {
    const title = typeof state.view?.title === 'string' ? state.view.title : '';
    document.title = title ? `${title} · quiz` : 'Join the quiz';
  }, [state.view]);
  if (!link) return <CodeForm />;
  return (
    <>
      {state.down && (
        <p class="qz-trouble" role="status">
          The connection to the quiz was lost. Trying again…
        </p>
      )}
      <GuestView view={state.view} ahead={state.ahead} link={link} />
    </>
  );
}

const root = document.getElementById('quiz');
if (root) render(<Page />, root);
