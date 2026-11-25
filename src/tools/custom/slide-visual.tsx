/**
 * The Slide Deck tool's visual editor: slides designed by placing text,
 * pictures and shapes with the mouse.  It edits the same Markdown the text
 * editor shows: a designed slide is one block of HTML in it (see
 * lib/slide-visual), so both editors, the preview and the exports stay in step.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  elementStyle,
  fromMarkdown,
  type Guide,
  type Handle,
  insertSlide,
  LAYOUTS,
  type Layout,
  layoutSlide,
  moveSlide,
  newId,
  positionOf,
  readElement,
  readVisual,
  removeSlide,
  replaceSlide,
  resizeBox,
  type Size,
  type SlideElement,
  slideTitle,
  snapMove,
  splitDeck,
  type VisualSlide,
  visualSource,
} from '../../lib/slide-visual';
import type { DeckTheme } from '../../lib/slides';
import { pickFiles } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { clamp, nudge } from './_shared';

/** Roughly what each reveal.js theme looks like, for the editing canvas (the preview beside it shows the real thing). */
const THEME_LOOK: Record<DeckTheme, readonly [string, string]> = {
  black: ['#191919', '#ffffff'],
  white: ['#ffffff', '#222222'],
  league: ['#2b2b2b', '#eeeeee'],
  beige: ['#f7f3de', '#333333'],
  night: ['#111111', '#eeeeee'],
  serif: ['#f0f1eb', '#000000'],
  simple: ['#ffffff', '#000000'],
  solarized: ['#fdf6e3', '#657b83'],
  moon: ['#002b36', '#93a1a1'],
  dracula: ['#282a36', '#f8f8f2'],
  sky: ['#f7fbfc', '#333333'],
  blood: ['#222222', '#eeeeee'],
  'black-contrast': ['#000000', '#ffffff'],
  'white-contrast': ['#ffffff', '#000000'],
};

const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const KIND_NAMES = { text: 'Text', image: 'Picture', shape: 'Shape' } as const;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function pictureSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 });
    img.onerror = () => resolve({ width: 400, height: 300 });
    img.src = url;
  });
}

interface Props {
  readonly markdown: string;
  readonly size: Size;
  readonly theme: DeckTheme;
  readonly onChange: (markdown: string) => void;
  /** Asks the preview to show a slide. */
  readonly onShow: (h: number, v: number) => void;
}

export function VisualSlides({ markdown, size, theme, onChange, onShow }: Props) {
  const parts = useMemo(() => splitDeck(markdown), [markdown]);
  const [at, setAt] = useState(0);
  const index = clamp(at, 0, parts.slides.length - 1);
  const source = parts.slides[index] ?? '';
  const stored = useMemo(() => readVisual(source), [source]);
  const [picked, setPicked] = useState<string | null>(null);
  /** The slide while something is being dragged: written to the deck when the mouse is let go. */
  const [dragged, setDragged] = useState<VisualSlide | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [scale, setScale] = useState(0.5);
  const history = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const box = useRef<HTMLDivElement>(null);
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;
  const slide = dragged ?? stored;
  const chosen = slide?.elements.find((e) => e.id === picked);
  const [look, ink] = THEME_LOOK[theme];

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setScale(Math.max(0.05, element.clientWidth / size.width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // The canvas is there only while a designed slide is shown.
  }, [size.width, stored === null]);

  // The preview shows the slide being edited.
  useEffect(() => {
    const where = positionOf(parts, index);
    onShow(where.h, where.v);
  }, [index, parts.slides.length, onShow, parts]);

  /** Changes the deck, remembering how it was for Undo. */
  const commit = (next: string) => {
    if (next === markdownRef.current) return;
    history.current.past.push(markdownRef.current);
    if (history.current.past.length > 100) history.current.past.shift();
    history.current.future = [];
    markdownRef.current = next;
    onChange(next);
  };
  const undo = (way: 'past' | 'future') => {
    const from = history.current[way];
    const next = from.pop();
    if (next === undefined) return;
    history.current[way === 'past' ? 'future' : 'past'].push(markdownRef.current);
    markdownRef.current = next;
    onChange(next);
  };
  const write = (next: VisualSlide) => commit(replaceSlide(markdownRef.current, index, visualSource(next, size)));
  const change = (id: string, patch: Partial<SlideElement>) => {
    if (!stored) return;
    write({ ...stored, elements: stored.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as SlideElement) : e)) });
  };

  const add = (raw: Record<string, unknown>) => {
    if (!stored) return;
    const element = readElement({ id: newId(), ...raw });
    if (!element) return;
    write({ ...stored, elements: [...stored.elements, element] });
    setPicked(element.id);
  };

  const addPictures = (files: File[], place?: { x: number; y: number }) =>
    attempt(async () => {
      if (!stored) return;
      const made: SlideElement[] = [];
      for (const file of files) {
        if (!/^image\//.test(file.type) && !/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(file.name)) continue;
        if (file.size > 8 * 1024 * 1024) {
          notify(`${file.name} is larger than 8 MB; make it smaller first (Image Resizer) so the deck stays quick to edit.`, 'error');
          continue;
        }
        const src = await readAsDataUrl(file);
        const natural = await pictureSize(src);
        const fit = Math.min(1, (size.width * 0.5) / natural.width, (size.height * 0.6) / natural.height);
        const w = Math.round(natural.width * fit);
        const h = Math.round(natural.height * fit);
        const shift = made.length * 24;
        const element = readElement({
          kind: 'image',
          id: newId(),
          src,
          alt: file.name.replace(/\.[^.]+$/, ''),
          x: clamp(Math.round((place?.x ?? size.width / 2) - w / 2) + shift, 0, Math.max(0, size.width - w)),
          y: clamp(Math.round((place?.y ?? size.height / 2) - h / 2) + shift, 0, Math.max(0, size.height - h)),
          w,
          h,
        });
        if (element?.src) made.push(element);
        else notify(`${file.name} is not a picture that can be embedded.`, 'error');
      }
      if (!made.length) return;
      write({ ...stored, elements: [...stored.elements, ...made] });
      setPicked(made[made.length - 1]?.id ?? null);
    });

  /* ------------------------------------------------- dragging -- */

  const track = (event: PointerEvent, move: (dx: number, dy: number, e: PointerEvent) => VisualSlide | null) => {
    if (event.button !== 0 || !stored) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    const origin = { x: event.clientX, y: event.clientY };
    let latest: VisualSlide | null = null;
    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - origin.x) / scale;
      const dy = (e.clientY - origin.y) / scale;
      if (!latest && Math.abs(dx) + Math.abs(dy) < 3 / scale) return;
      latest = move(dx, dy, e);
      setDragged(latest);
    };
    const finish = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', finish);
      target.removeEventListener('pointercancel', finish);
      setGuides([]);
      setDragged(null);
      if (latest) write(latest);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
  };

  const startMove = (event: PointerEvent, element: SlideElement) => {
    setPicked(element.id);
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    const base = stored;
    if (!base) return;
    const others = base.elements.filter((e) => e.id !== element.id);
    track(event, (dx, dy, e) => {
      const free = { x: element.x + dx, y: element.y + dy, w: element.w, h: element.h };
      // Alt lets go of the snapping, for places just beside a line.
      const snapped = e.altKey ? { x: free.x, y: free.y, guides: [] } : snapMove(free, others, size, 6 / scale);
      setGuides(snapped.guides);
      return { ...base, elements: base.elements.map((o) => (o.id === element.id ? { ...o, x: Math.round(snapped.x), y: Math.round(snapped.y) } : o)) };
    });
  };

  const startResize = (event: PointerEvent, element: SlideElement, handle: Handle) => {
    event.stopPropagation();
    const base = stored;
    if (!base) return;
    track(event, (dx, dy, e) => {
      const next = resizeBox(element, handle, dx, dy, e.shiftKey || (element.kind === 'image' && !e.altKey));
      return { ...base, elements: base.elements.map((o) => (o.id === element.id ? { ...o, x: Math.round(next.x), y: Math.round(next.y), w: Math.round(next.w), h: Math.round(next.h) } : o)) };
    });
  };

  const order = (id: string, front: boolean) => {
    if (!stored) return;
    const element = stored.elements.find((e) => e.id === id);
    if (!element) return;
    const rest = stored.elements.filter((e) => e.id !== id);
    write({ ...stored, elements: front ? [...rest, element] : [element, ...rest] });
  };
  const remove = (id: string) => {
    if (!stored) return;
    write({ ...stored, elements: stored.elements.filter((e) => e.id !== id) });
    setPicked(null);
  };
  const duplicate = (element: SlideElement) => {
    if (!stored) return;
    const copy = { ...element, id: newId(), x: element.x + 24, y: element.y + 24 };
    write({ ...stored, elements: [...stored.elements, copy] });
    setPicked(copy.id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const typing = (e.target as HTMLElement).closest('input, textarea, select');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      undo(e.shiftKey ? 'future' : 'past');
      return;
    }
    if (typing || !chosen) return;
    const step = nudge(e);
    if (step) {
      e.preventDefault();
      change(chosen.id, { x: chosen.x + step.dx, y: chosen.y + step.dy });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(chosen.id);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicate(chosen);
    } else if (e.key === 'Escape') setPicked(null);
  };

  const goto = (next: number) => {
    setAt(clamp(next, 0, parts.slides.length - 1));
    setPicked(null);
  };

  const numberField = (label: string, value: number, apply: (n: number) => void, testId: string, min = -20000, max = 20000, step = 1) => (
    <label class="vs-field">
      <span class="control-label">{label}</span>
      <input
        type="number"
        class="input input-number"
        min={min}
        max={max}
        step={step}
        value={Math.round(value * 100) / 100}
        data-testid={testId}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          if (Number.isFinite(n)) apply(clamp(n, min, max));
        }}
      />
    </label>
  );
  const colourField = (label: string, value: string, fallback: string, apply: (colour: string) => void, testId: string, clearLabel: string) => (
    <span class="vs-field">
      <span class="control-label">{label}</span>
      <span class="vs-colour">
        <input type="color" value={value || fallback} aria-label={label} onInput={(e) => apply(e.currentTarget.value)} data-testid={testId} />
        {value && (
          <button type="button" class="button button-small button-quiet" onClick={() => apply('')}>
            {clearLabel}
          </button>
        )}
      </span>
    </span>
  );

  return (
    <div class="vs" onKeyDown={onKeyDown}>
      <div class="vs-list">
        <ol data-testid="vs-slides">
          {parts.slides.map((text, i) => {
            const place = positionOf(parts, i);
            return (
              <li key={`${i}:${text.length}`} class={`${i === index ? 'is-current' : ''}${place.v > 0 ? ' is-below' : ''}`}>
                <button type="button" class="vs-slide" aria-current={i === index ? 'true' : undefined} onClick={() => goto(i)} data-testid="vs-slide">
                  <span class="vs-slide-number">{i + 1}</span>
                  <span class="vs-slide-title">{slideTitle(text)}</span>
                  <span class="tone-muted">{readVisual(text) ? 'designed' : 'written'}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div class="vs-list-actions">
          <select
            class="select select-small"
            value=""
            aria-label="Add a slide after this one"
            data-testid="vs-add-slide"
            onChange={(e) => {
              const layout = e.currentTarget.value as Layout;
              e.currentTarget.value = '';
              if (!LAYOUTS.some(([name]) => name === layout)) return;
              commit(insertSlide(markdownRef.current, index, visualSource(layoutSlide(layout, size), size)));
              goto(index + 1);
            }}
          >
            <option value="">Add a slide…</option>
            {LAYOUTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span class="vs-list-buttons">
            <button
              type="button"
              class="button button-small button-quiet"
              title="Move this slide earlier"
              aria-label="Move this slide earlier"
              disabled={index === 0}
              onClick={() => {
                commit(moveSlide(markdownRef.current, index, -1));
                goto(index - 1);
              }}
            >
              <Icon name="up" size={13} />
            </button>
            <button
              type="button"
              class="button button-small button-quiet"
              title="Move this slide later"
              aria-label="Move this slide later"
              disabled={index >= parts.slides.length - 1}
              onClick={() => {
                commit(moveSlide(markdownRef.current, index, 1));
                goto(index + 1);
              }}
            >
              <Icon name="down" size={13} />
            </button>
            <button
              type="button"
              class="button button-small button-quiet"
              title="Duplicate this slide"
              aria-label="Duplicate this slide"
              onClick={() => {
                commit(insertSlide(markdownRef.current, index, source.replace(/^\n+|\n+$/g, '')));
                goto(index + 1);
              }}
              data-testid="vs-copy-slide"
            >
              <Icon name="copy" size={13} />
            </button>
            <button
              type="button"
              class="button button-small button-quiet"
              title="Delete this slide"
              aria-label="Delete this slide"
              disabled={parts.slides.length <= 1}
              onClick={() => {
                commit(removeSlide(markdownRef.current, index));
                goto(Math.max(0, index - 1));
              }}
              data-testid="vs-delete-slide"
            >
              <Icon name="trash" size={13} />
            </button>
          </span>
        </div>
      </div>

      <div class="vs-work">
        {slide ? (
          <>
            <div class="vs-tools" role="toolbar" aria-label="Add to the slide">
              <span class="control-label">Add</span>
              <button
                type="button"
                class="button button-small"
                onClick={() => add({ kind: 'text', text: 'Text', size: Math.round(size.height * 0.06), x: size.width * 0.25, y: size.height * 0.42, w: size.width * 0.5, h: size.height * 0.16 })}
                data-testid="vs-add-text"
              >
                Text
              </button>
              <button type="button" class="button button-small" onClick={() => attempt(async () => addPictures(await pickFiles('image/*')))} data-testid="vs-add-picture">
                <Icon name="image" size={14} /> Picture
              </button>
              <button
                type="button"
                class="button button-small"
                onClick={() => add({ kind: 'shape', shape: 'rect', x: size.width * 0.35, y: size.height * 0.35, w: size.width * 0.3, h: size.height * 0.3, fill: '#1f6feb', radius: 12 })}
                data-testid="vs-add-rect"
              >
                Rectangle
              </button>
              <button
                type="button"
                class="button button-small"
                onClick={() => add({ kind: 'shape', shape: 'ellipse', x: size.width * 0.4, y: size.height * 0.3, w: size.height * 0.4, h: size.height * 0.4, fill: '#f0883e' })}
                data-testid="vs-add-ellipse"
              >
                Ellipse
              </button>
              <button
                type="button"
                class="button button-small"
                onClick={() => add({ kind: 'shape', shape: 'line', x: size.width * 0.2, y: size.height * 0.5 - 10, w: size.width * 0.6, h: 20 })}
                data-testid="vs-add-line"
              >
                Line
              </button>
              {colourField('Slide background', slide.background, look, (background) => stored && write({ ...stored, background }), 'vs-background', 'Theme’s own')}
              <span class="vs-undo">
                <button type="button" class="button button-small button-quiet" onClick={() => undo('past')} disabled={!history.current.past.length} title="Undo (Ctrl+Z)" data-testid="vs-undo">
                  Undo
                </button>
                <button type="button" class="button button-small button-quiet" onClick={() => undo('future')} disabled={!history.current.future.length} title="Redo (Ctrl+Shift+Z)">
                  Redo
                </button>
              </span>
            </div>
            <div class="vs-canvas-box" ref={box} style={{ height: `${size.height * scale}px` }}>
              <div
                class="vs-canvas"
                data-testid="vs-canvas"
                style={{ width: `${size.width}px`, height: `${size.height}px`, transform: `scale(${scale})`, background: slide.background || look, color: ink }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) setPicked(null);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const files = [...(e.dataTransfer?.files ?? [])];
                  if (!files.length) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  addPictures(files, { x: ((e.clientX - rect.left) / rect.width) * size.width, y: ((e.clientY - rect.top) / rect.height) * size.height });
                }}
              >
                {slide.elements.map((e) => {
                  const label =
                    e.kind === 'text'
                      ? `Text: ${(e.text ?? '').slice(0, 60)}`
                      : e.kind === 'image'
                        ? `Picture${e.alt ? `: ${e.alt}` : ''}`
                        : e.shape === 'ellipse'
                          ? 'Ellipse'
                          : e.shape === 'line'
                            ? 'Line'
                            : 'Rectangle';
                  const common = {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': label,
                    'aria-pressed': e.id === picked,
                    class: `vs-el${e.id === picked ? ' is-picked' : ''}`,
                    style: elementStyle(e),
                    onPointerDown: (event: PointerEvent) => startMove(event, e),
                    onFocus: () => setPicked(e.id),
                    'data-testid': 'vs-el',
                    'data-kind': e.kind,
                  } as const;
                  return e.kind === 'image' ? (
                    <img key={e.id} {...common} src={e.src} alt={e.alt ?? ''} draggable={false} />
                  ) : (
                    <div key={e.id} {...common}>
                      {e.kind === 'text' ? e.text : null}
                    </div>
                  );
                })}
                {chosen && (
                  <div
                    class="vs-frame"
                    style={{
                      left: `${chosen.x}px`,
                      top: `${chosen.y}px`,
                      width: `${chosen.w}px`,
                      height: `${chosen.h}px`,
                      transform: chosen.rotate ? `rotate(${chosen.rotate}deg)` : undefined,
                      borderWidth: `${2 / scale}px`,
                    }}
                  >
                    {HANDLES.map((handle) => (
                      <span
                        key={handle}
                        class={`vs-handle vs-${handle}`}
                        style={{ width: `${12 / scale}px`, height: `${12 / scale}px`, margin: `${-6 / scale}px` }}
                        onPointerDown={(event) => startResize(event, chosen, handle)}
                        data-testid={`vs-handle-${handle}`}
                      />
                    ))}
                  </div>
                )}
                {guides.map((guide) => (
                  <span
                    key={`${guide.axis}${guide.at}`}
                    class="vs-guide"
                    style={guide.axis === 'x' ? { left: `${guide.at}px`, top: 0, bottom: 0, width: `${1 / scale}px` } : { top: `${guide.at}px`, left: 0, right: 0, height: `${1 / scale}px` }}
                  />
                ))}
              </div>
            </div>

            {chosen ? (
              <div class="vs-props" data-testid="vs-props">
                <div class="vs-props-head">
                  <span class="pane-title">{chosen.kind === 'shape' ? (chosen.shape === 'ellipse' ? 'Ellipse' : chosen.shape === 'line' ? 'Line' : 'Rectangle') : KIND_NAMES[chosen.kind]}</span>
                  <span class="vs-props-actions">
                    <button type="button" class="button button-small button-quiet" onClick={() => order(chosen.id, true)} data-testid="vs-front">
                      Bring to front
                    </button>
                    <button type="button" class="button button-small button-quiet" onClick={() => order(chosen.id, false)} data-testid="vs-back">
                      Send to back
                    </button>
                    <button type="button" class="button button-small button-quiet" onClick={() => duplicate(chosen)} title="Duplicate (Ctrl+D)" data-testid="vs-duplicate">
                      <Icon name="copy" size={13} /> Duplicate
                    </button>
                    <button type="button" class="button button-small button-quiet" onClick={() => remove(chosen.id)} title="Delete (Del)" data-testid="vs-delete">
                      <Icon name="trash" size={13} /> Delete
                    </button>
                  </span>
                </div>
                {chosen.kind === 'text' && (
                  <label class="vs-field vs-wide">
                    <span class="control-label">Text</span>
                    <textarea class="input" rows={3} value={chosen.text ?? ''} onInput={(e) => change(chosen.id, { text: e.currentTarget.value.slice(0, 5000) })} data-testid="vs-text" />
                  </label>
                )}
                <div class="vs-grid">
                  {chosen.kind === 'text' && (
                    <>
                      {numberField('Text size', chosen.size ?? 40, (n) => change(chosen.id, { size: n }), 'vs-size', 6, 600)}
                      <label class="vs-field">
                        <span class="control-label">Font</span>
                        <select class="select select-small" value={chosen.font ?? 'theme'} onChange={(e) => change(chosen.id, { font: e.currentTarget.value as SlideElement['font'] })}>
                          <option value="theme">The theme’s</option>
                          <option value="sans">Sans-serif</option>
                          <option value="serif">Serif</option>
                          <option value="mono">Monospace</option>
                        </select>
                      </label>
                      <label class="vs-field">
                        <span class="control-label">Line up</span>
                        <select
                          class="select select-small"
                          value={chosen.align ?? 'center'}
                          onChange={(e) => change(chosen.id, { align: e.currentTarget.value as SlideElement['align'] })}
                          data-testid="vs-align"
                        >
                          <option value="left">Left</option>
                          <option value="center">Centre</option>
                          <option value="right">Right</option>
                        </select>
                      </label>
                      <label class="vs-field">
                        <span class="control-label">In the box</span>
                        <select class="select select-small" value={chosen.valign ?? 'middle'} onChange={(e) => change(chosen.id, { valign: e.currentTarget.value as SlideElement['valign'] })}>
                          <option value="top">Top</option>
                          <option value="middle">Middle</option>
                          <option value="bottom">Bottom</option>
                        </select>
                      </label>
                      <label class="check">
                        <input type="checkbox" checked={chosen.bold === true} onChange={(e) => change(chosen.id, { bold: e.currentTarget.checked })} data-testid="vs-bold" /> Bold
                      </label>
                      <label class="check">
                        <input type="checkbox" checked={chosen.italic === true} onChange={(e) => change(chosen.id, { italic: e.currentTarget.checked })} /> Italic
                      </label>
                      {colourField('Text colour', chosen.color ?? '', ink, (color) => change(chosen.id, { color }), 'vs-color', 'Theme’s own')}
                      {colourField('Box colour', chosen.fill ?? '', look, (fill) => change(chosen.id, { fill }), 'vs-fill', 'None')}
                    </>
                  )}
                  {chosen.kind === 'shape' && chosen.shape !== 'line' && colourField('Fill', chosen.fill ?? '', '#1f6feb', (fill) => change(chosen.id, { fill }), 'vs-fill', 'None')}
                  {chosen.kind === 'shape' && (
                    <>
                      {colourField(
                        chosen.shape === 'line' ? 'Colour' : 'Outline',
                        chosen.stroke ?? '',
                        '#8b949e',
                        (stroke) => change(chosen.id, { stroke, strokeWidth: stroke && !(chosen.strokeWidth ?? 0) ? 4 : chosen.strokeWidth }),
                        'vs-stroke',
                        'None',
                      )}
                      {numberField(chosen.shape === 'line' ? 'Thickness' : 'Outline width', chosen.strokeWidth ?? 0, (n) => change(chosen.id, { strokeWidth: n }), 'vs-stroke-width', 0, 200)}
                    </>
                  )}
                  {chosen.kind === 'image' && (
                    <>
                      <label class="vs-field">
                        <span class="control-label">In its box</span>
                        <select class="select select-small" value={chosen.fit ?? 'contain'} onChange={(e) => change(chosen.id, { fit: e.currentTarget.value as SlideElement['fit'] })}>
                          <option value="contain">Whole picture</option>
                          <option value="cover">Fill the box (cropped)</option>
                        </select>
                      </label>
                      <label class="vs-field vs-wide">
                        <span class="control-label">Described as (for people who cannot see it)</span>
                        <input class="input" value={chosen.alt ?? ''} onChange={(e) => change(chosen.id, { alt: e.currentTarget.value.slice(0, 300) })} />
                      </label>
                    </>
                  )}
                  {!(chosen.kind === 'shape' && chosen.shape !== 'rect') && numberField('Round corners', chosen.radius ?? 0, (n) => change(chosen.id, { radius: n }), 'vs-radius', 0, 2000)}
                  {numberField('Left', chosen.x, (n) => change(chosen.id, { x: n }), 'vs-x')}
                  {numberField('Top', chosen.y, (n) => change(chosen.id, { y: n }), 'vs-y')}
                  {numberField('Width', chosen.w, (n) => change(chosen.id, { w: n }), 'vs-w', 1)}
                  {numberField('Height', chosen.h, (n) => change(chosen.id, { h: n }), 'vs-h', 1)}
                  {numberField('Turn (°)', chosen.rotate, (n) => change(chosen.id, { rotate: n }), 'vs-rotate', -360, 360)}
                  {numberField('Opacity', chosen.opacity, (n) => change(chosen.id, { opacity: n }), 'vs-opacity', 0, 1, 0.05)}
                </div>
              </div>
            ) : (
              <p class="control-help vs-hint">
                Click something on the slide to change it; drag to move it (lines appear when it lines up; hold Alt to place it freely), and drag a corner to resize it (Shift keeps its shape). Drop
                pictures straight onto the slide. Arrow keys nudge, Ctrl+D duplicates, Del removes.
              </p>
            )}
            <label class="vs-field vs-wide">
              <span class="control-label">Speaker notes (shown only to you)</span>
              <textarea class="input" rows={2} value={slide.notes} onChange={(e) => stored && write({ ...stored, notes: e.currentTarget.value.slice(0, 5000) })} data-testid="vs-notes" />
            </label>
          </>
        ) : (
          <div class="vs-written" data-testid="vs-written">
            <p>
              <strong>This slide is written in Markdown.</strong> It shows in the preview as it is; edit it under “Markdown”, or make it a designed slide to place its parts by hand.
            </p>
            <pre>{source.trim().slice(0, 600) || '(empty)'}</pre>
            <button type="button" class="button button-small" data-testid="vs-convert" onClick={() => commit(replaceSlide(markdownRef.current, index, visualSource(fromMarkdown(source, size), size)))}>
              Make it a designed slide
            </button>
            <p class="control-help">
              Its heading, text and embedded pictures become boxes of plain text and pictures. Code blocks, tables, maths and step-by-step reveals stay only in Markdown slides.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
