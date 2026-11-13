/** Small building blocks shared by the bespoke tools. */
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { getSettings, saveToolOptions } from '../../app/store';
import type { Values } from '../types';

/**
 * State that survives restarts (when "Remember options" is on), stored with
 * the tool's other settings.  `read` validates whatever was stored before.
 */
export function usePersistentState<T>(toolId: string, read: (stored: Values | undefined) => T, write: (value: T) => Values): [T, (next: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const settings = getSettings();
    return read(settings.rememberOptions ? settings.toolOptions[toolId] : undefined);
  });
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        saveToolOptions(toolId, write(latest.current));
      }
    },
    [toolId],
  );

  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      latest.current = typeof next === 'function' ? (next as (previous: T) => T)(latest.current) : next;
      setValue(latest.current);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        saveToolOptions(toolId, write(latest.current));
      }, 400);
    },
    [toolId],
  );
  return [value, update];
}

export interface SegmentChoice<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function Segmented<T extends string>({
  value,
  choices,
  onChange,
  label,
  small = true,
}: {
  value: T;
  choices: readonly SegmentChoice<T>[];
  onChange: (value: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div class={`segmented${small ? ' segmented-small' : ''}`} role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <button key={choice.value} type="button" role="radio" aria-checked={choice.value === value} class={choice.value === value ? 'is-active' : ''} onClick={() => onChange(choice.value)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export type FrameWidth = 'full' | '992' | '768' | '390';

export const FRAME_WIDTHS: readonly SegmentChoice<FrameWidth>[] = [
  { value: 'full', label: 'Full' },
  { value: '992', label: '992' },
  { value: '768', label: '768' },
  { value: '390', label: '390' },
];

/**
 * A sandboxed preview document.  `sandbox` without `allow-scripts` means
 * nothing inside can run code, submit forms or navigate the app, and the
 * app's content security policy still applies, so nothing can load from the
 * network either.
 */
export function PreviewFrame({
  html,
  width = 'full',
  title,
  testId = 'preview-frame',
  resizable = false,
  onResize,
}: {
  html: string;
  width?: FrameWidth | number;
  title: string;
  testId?: string;
  resizable?: boolean;
  onResize?: (width: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onResize || !box.current) return;
    const element = box.current;
    const observer = new ResizeObserver(() => onResize(Math.round(element.getBoundingClientRect().width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [onResize]);
  const style = width === 'full' ? undefined : { width: `${typeof width === 'number' ? width : Number(width)}px` };
  return (
    <div class="frame-stage">
      <div ref={box} class={`frame-box${resizable ? ' is-resizable' : ''}`} style={style}>
        <iframe class="frame" title={title} sandbox="" srcdoc={html} data-testid={testId} referrerpolicy="no-referrer" />
      </div>
    </div>
  );
}

export function Section({ title, children, actions }: { title: string; children: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <section class="pane custom-section">
      <div class="pane-header">
        <span class="pane-title">{title}</span>
        {actions && <div class="pane-actions">{actions}</div>}
      </div>
      <div class="custom-section-body">{children}</div>
    </section>
  );
}

/**
 * Tracks a pointer drag over `surface`, reporting positions as fractions of
 * its size (0-1, not clamped).  Pointer capture keeps the drag alive when the
 * pointer leaves the element.
 */
export function startDrag(event: PointerEvent, surface: HTMLElement, onMove: (x: number, y: number, event: PointerEvent) => void, onEnd?: () => void): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture?.(event.pointerId);
  const report = (e: PointerEvent) => {
    const rect = surface.getBoundingClientRect();
    onMove((e.clientX - rect.left) / (rect.width || 1), (e.clientY - rect.top) / (rect.height || 1), e);
  };
  const finish = () => {
    target.removeEventListener('pointermove', report);
    target.removeEventListener('pointerup', finish);
    target.removeEventListener('pointercancel', finish);
    onEnd?.();
  };
  target.addEventListener('pointermove', report);
  target.addEventListener('pointerup', finish);
  target.addEventListener('pointercancel', finish);
}

/** Arrow-key nudging for draggable handles: 1 unit, or 10 with Shift. */
export function nudge(event: KeyboardEvent): { dx: number; dy: number } | null {
  const step = event.shiftKey ? 10 : 1;
  switch (event.key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
