/** Shows everything the browser reports about a key press: key, code, legacy keyCode, location and modifiers. */
import { useEffect, useState } from 'preact/hooks';
import { CodeOutput } from '../../ui/CodeOutput';
import { defineCustomTool } from '../types';

interface Press {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly location: number;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly repeat: boolean;
  readonly composing: boolean;
}

const LOCATIONS = ['Standard', 'Left', 'Right', 'Numeric keypad'];

const shown = (key: string): string => (key === ' ' ? 'Space' : key);

function Keycode() {
  const [press, setPress] = useState<Press | null>(null);
  const [history, setHistory] = useState<readonly Press[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Leave the app's own shortcuts and typing in its inputs alone.
      const target = event.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select, [contenteditable="true"], .cm-editor') !== null && !target.closest('[data-keycode-area]')) return;
      if (event.key !== 'Tab') event.preventDefault();
      const next: Press = {
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        location: event.location,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
        repeat: event.repeat,
        composing: event.isComposing,
      };
      setPress(next);
      setHistory((previous) => [next, ...previous].slice(0, 12));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const modifiers = press ? [press.ctrl && 'Ctrl', press.shift && 'Shift', press.alt && 'Alt', press.meta && 'Meta'].filter(Boolean).join(' + ') : '';
  const combo = press ? [modifiers, shown(press.key)].filter(Boolean).join(' + ') : '';
  return (
    <section class="tool tool-keycode" data-testid="tool" data-state={press ? 'done' : 'idle'} data-keycode-area>
      <div class="keycode-stage pane" data-testid="keycode-stage" aria-live="polite">
        {press ? (
          <>
            <div class="keycode-key">{shown(press.key)}</div>
            <div class="keycode-combo">{combo}</div>
          </>
        ) : (
          <div class="keycode-hint">Press any key</div>
        )}
      </div>
      {press && (
        <dl class="fields keycode-fields">
          {(
            [
              ['event.key', JSON.stringify(press.key)],
              ['event.code', press.code],
              ['event.keyCode (legacy)', String(press.keyCode)],
              ['event.location', `${press.location} (${LOCATIONS[press.location] ?? 'unknown'})`],
              ['Modifiers', modifiers || 'none'],
              ['Repeating', press.repeat ? 'yes (key held down)' : 'no'],
              ['Composing (IME)', press.composing ? 'yes' : 'no'],
            ] as const
          ).map(([label, value]) => (
            <div class="field" key={label}>
              <dt>{label}</dt>
              <dd class="mono">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {press && (
        <CodeOutput
          baseName="keyboard-handler"
          outputs={[
            {
              label: 'Handler',
              language: 'javascript',
              code: `window.addEventListener('keydown', (event) => {\n  if (${[press.ctrl && 'event.ctrlKey', press.shift && 'event.shiftKey', press.alt && 'event.altKey', press.meta && 'event.metaKey', `event.code === ${JSON.stringify(press.code)}`].filter(Boolean).join(' && ')}) {\n    event.preventDefault();\n    // ${combo}\n  }\n});\n`,
            },
          ]}
        />
      )}
      {history.length > 1 && (
        <p class="keycode-history">
          Recent:{' '}
          {history.slice(1).map((item, index) => (
            <kbd key={index}>{shown(item.key)}</kbd>
          ))}
        </p>
      )}
    </section>
  );
}

export default defineCustomTool(Keycode);
