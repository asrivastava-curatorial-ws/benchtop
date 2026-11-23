/**
 * Large Type: show a few words as big as the window allows, for reading a
 * Wi-Fi password across a room, a sign at a desk, or a message on a screen.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../ui/icons';
import { defineCustomTool, type Values } from '../types';
import { type SegmentChoice, Segmented, usePersistentState } from './_shared';

interface Prefs {
  readonly text: string;
  readonly theme: 'dark' | 'light' | 'yellow';
  readonly font: 'sans' | 'serif' | 'mono';
  readonly align: 'center' | 'left';
}

const THEMES: Record<Prefs['theme'], { bg: string; fg: string }> = {
  dark: { bg: '#0d1117', fg: '#f0f6fc' },
  light: { bg: '#ffffff', fg: '#111111' },
  yellow: { bg: '#000000', fg: '#ffd60a' },
};
const FAMILIES: Record<Prefs['font'], string> = {
  sans: '"Barlow", "Benchtop Sans", system-ui, sans-serif',
  serif: 'Georgia, "Noto Serif", serif',
  mono: '"JetBrains Mono Variable", ui-monospace, monospace',
};

const read = (s: Values | undefined): Prefs => ({
  text: typeof s?.text === 'string' ? s.text : 'Wi-Fi: VITM-Guest\nPassword: science2026',
  theme: s?.theme === 'light' || s?.theme === 'yellow' ? s.theme : 'dark',
  font: s?.font === 'serif' || s?.font === 'mono' ? s.font : 'sans',
  align: s?.align === 'left' ? 'left' : 'center',
});

const THEME_CHOICES: readonly SegmentChoice<Prefs['theme']>[] = [
  { value: 'dark', label: 'Light on dark' },
  { value: 'light', label: 'Dark on light' },
  { value: 'yellow', label: 'Yellow on black' },
];
const FONT_CHOICES: readonly SegmentChoice<Prefs['font']>[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monospace' },
];
const ALIGN_CHOICES: readonly SegmentChoice<Prefs['align']>[] = [
  { value: 'center', label: 'Centre' },
  { value: 'left', label: 'Left' },
];

/** The largest font size at which the text fits the box, by bisection. */
function fitText(box: HTMLElement, text: HTMLElement): number {
  let lo = 8;
  let hi = 1200;
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    text.style.fontSize = `${mid}px`;
    if (text.scrollWidth <= box.clientWidth * 0.94 && text.scrollHeight <= box.clientHeight * 0.9) lo = mid;
    else hi = mid;
  }
  text.style.fontSize = `${lo}px`;
  return lo;
}

function LargeType({ toolId }: { toolId: string }) {
  const [prefs, setPrefs] = usePersistentState(toolId, read, (p: Prefs): Values => ({ ...p }));
  const box = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const [full, setFull] = useState(false);
  const set = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  const refit = () => {
    if (box.current && textRef.current) setSize(fitText(box.current, textRef.current));
  };
  useLayoutEffect(refit, [prefs.text, prefs.font, full]);
  useEffect(() => {
    const observer = new ResizeObserver(() => refit());
    if (box.current) observer.observe(box.current);
    const onFull = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', onFull);
    void document.fonts?.ready.then(refit);
    return () => {
      observer.disconnect();
      document.removeEventListener('fullscreenchange', onFull);
    };
  }, []);

  const theme = THEMES[prefs.theme];
  const goFull = () => {
    const el = box.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <section class="tool lt-tool" data-testid="tool" data-state="done">
      <div class="lt-controls">
        <label class="control lt-text">
          <span class="control-label">Text</span>
          <textarea class="input" rows={3} value={prefs.text} onInput={(e) => set({ text: e.currentTarget.value })} data-testid="lt-input" />
        </label>
        <div class="icon-row">
          <div class="control">
            <span class="control-label">Colours</span>
            <Segmented label="Colours" value={prefs.theme} choices={THEME_CHOICES} onChange={(theme) => set({ theme })} />
          </div>
          <div class="control">
            <span class="control-label">Typeface</span>
            <Segmented label="Typeface" value={prefs.font} choices={FONT_CHOICES} onChange={(font) => set({ font })} />
          </div>
          <div class="control">
            <span class="control-label">Alignment</span>
            <Segmented label="Alignment" value={prefs.align} choices={ALIGN_CHOICES} onChange={(align) => set({ align })} />
          </div>
          <button type="button" class="button button-primary" onClick={goFull} data-testid="lt-full">
            <Icon name="monitor" size={16} /> Full screen
          </button>
        </div>
      </div>
      <div
        ref={box}
        class={`lt-stage${full ? ' is-full' : ''}`}
        style={{ background: theme.bg, color: theme.fg }}
        onDblClick={goFull}
        role="region"
        aria-label="Large text"
        title="Double-click for full screen; Esc to leave"
        data-testid="lt-stage"
      >
        <div ref={textRef} class="lt-text-out" style={{ fontFamily: FAMILIES[prefs.font], textAlign: prefs.align }} data-size={Math.round(size)}>
          {prefs.text || ' '}
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(LargeType);
