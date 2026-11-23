/**
 * Clipboard History: the text copied while Benchtop runs, newest first, kept
 * in memory by the desktop shell (desk.rs) and never written to disk.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { updateSettings, useSettings } from '../../app/store';
import { copyText, isDesktop } from '../../platform';
import { type ClipEntry, clearClipboardHistory, clipboardHistory, forgetClip, onClipboard, watchClipboard } from '../../platform/desk';
import { SendTo } from '../../ui/SendTo';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';

const ago = (at: number) => {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function ClipboardHistory() {
  const on = useSettings((s) => s.clipboardHistory);
  const [entries, setEntries] = useState<ClipEntry[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isDesktop) return;
    const refresh = () => void clipboardHistory().then(setEntries, () => undefined);
    refresh();
    const stop = onClipboard(refresh);
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entries.filter((e) => e.text.toLowerCase().includes(q)) : entries;
  }, [entries, query]);

  if (!isDesktop) {
    return (
      <div data-testid="tool" class="tool clip-tool">
        <p class="recipe-error">The clipboard history is kept by the desktop app while it runs, so this tool needs the desktop app.</p>
      </div>
    );
  }

  const toggle = (next: boolean) =>
    void attempt(async () => {
      await watchClipboard(next);
      updateSettings({ clipboardHistory: next });
    });

  return (
    <div data-testid="tool" class="tool clip-tool">
      <div class="clip-bar">
        <label class="toggle" for="clip-on">
          <input id="clip-on" type="checkbox" role="switch" aria-checked={on} checked={on} onChange={(e) => toggle(e.currentTarget.checked)} data-testid="clip-on" />
          <span class="toggle-track" aria-hidden="true" />
          <span class="toggle-text">Keep a history of copied text</span>
        </label>
        <input class="input" type="search" placeholder="Search the history" aria-label="Search the history" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <button
          type="button"
          class="button button-quiet"
          disabled={!entries.length}
          onClick={() =>
            attempt(async () => {
              await clearClipboardHistory();
              setEntries([]);
            })
          }
        >
          Clear all
        </button>
      </div>
      <p class="tone-muted">
        {on
          ? 'Text you copy in any program appears here, up to 200 pieces. It stays in memory only and is gone when Benchtop quits. With the tray icon on (Settings), it keeps collecting while the window is closed.'
          : 'Turn the history on to keep the text you copy while Benchtop runs. Nothing is collected until you do.'}
      </p>
      {shown.length > 0 ? (
        <ul class="clip-list" data-testid="clip-list">
          {shown.map((entry) => (
            <li key={`${entry.at}-${entry.text.length}`} class="clip-entry">
              <pre class="clip-text">{entry.text.length > 2000 ? `${entry.text.slice(0, 2000)}…` : entry.text}</pre>
              <div class="clip-actions">
                <button
                  type="button"
                  class="button button-small"
                  onClick={() =>
                    attempt(async () => {
                      await copyText(entry.text);
                      notify('Copied.');
                    })
                  }
                >
                  Copy
                </button>
                <SendTo make={() => new File([entry.text], 'clipboard.txt', { type: 'text/plain' })} from="clipboard-history" />
                <button
                  type="button"
                  class="button button-small button-quiet"
                  onClick={() =>
                    attempt(async () => {
                      await forgetClip(entry);
                      setEntries((list) => list.filter((e) => e !== entry));
                    })
                  }
                >
                  Remove
                </button>
              </div>
              <span class="clip-meta">
                {ago(entry.at)} · {entry.text.length.toLocaleString('en-IN')} characters
              </span>
            </li>
          ))}
        </ul>
      ) : (
        entries.length > 0 && <p class="tone-muted">Nothing matches “{query}”.</p>
      )}
    </div>
  );
}

export default defineCustomTool(ClipboardHistory);
