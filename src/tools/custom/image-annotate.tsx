/**
 * Image Annotator: arrows, boxes, ellipses, lines, freehand pen, text, numbered
 * steps, highlights, and blur or pixelation for private details, on a screenshot
 * or photo.  Every mark stays editable (select, move, recolour, delete) with
 * undo and redo until the picture is saved.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { pickFile, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { context2d, createCanvas, encodeCanvas, loadImage, replaceExtension } from '../../ui/canvas';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

export type Kind = 'arrow' | 'rect' | 'ellipse' | 'line' | 'pen' | 'text' | 'step' | 'highlight' | 'blur' | 'pixelate';
type Mode = Kind | 'select';

export interface Mark {
  readonly kind: Kind;
  /** Corner or start point and end point, in image pixels. */
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly colour: string;
  readonly width: number;
  readonly text?: string;
  readonly points?: readonly (readonly [number, number])[];
  readonly number?: number;
}

const TOOLS: readonly { mode: Mode; label: string; key: string }[] = [
  { mode: 'select', label: 'Select and move', key: 'v' },
  { mode: 'arrow', label: 'Arrow', key: 'a' },
  { mode: 'rect', label: 'Box', key: 'r' },
  { mode: 'ellipse', label: 'Ellipse', key: 'e' },
  { mode: 'line', label: 'Line', key: 'l' },
  { mode: 'pen', label: 'Pen', key: 'p' },
  { mode: 'text', label: 'Text', key: 't' },
  { mode: 'step', label: 'Numbered step', key: 'n' },
  { mode: 'highlight', label: 'Highlight', key: 'h' },
  { mode: 'blur', label: 'Blur', key: 'b' },
  { mode: 'pixelate', label: 'Pixelate', key: 'x' },
];

const SWATCHES = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#0090ff', '#8e4ec6', '#111111', '#ffffff'];

interface Settings {
  readonly mode: Mode;
  readonly colour: string;
  readonly width: number;
  readonly text: string;
  readonly format: 'png' | 'jpeg';
}

const read = (s: Values | undefined): Settings => ({
  mode: TOOLS.find((t) => t.mode === s?.mode)?.mode ?? 'arrow',
  colour: typeof s?.colour === 'string' ? s.colour : '#e5484d',
  width: typeof s?.width === 'number' ? s.width : 4,
  text: typeof s?.text === 'string' ? s.text : 'Note',
  format: s?.format === 'jpeg' ? 'jpeg' : 'png',
});

const box = (m: Mark) => ({ x: Math.min(m.x1, m.x2), y: Math.min(m.y1, m.y2), w: Math.abs(m.x2 - m.x1), h: Math.abs(m.y2 - m.y1) });

/** Font size for text and step marks, from the stroke width. */
const textSize = (m: Mark) => Math.max(12, m.width * 5);

/** Draws one mark; blur and pixelate read from `source` (the untouched picture). */
export function drawMark(ctx: CanvasRenderingContext2D, m: Mark, source: CanvasImageSource): void {
  ctx.save();
  ctx.strokeStyle = m.colour;
  ctx.fillStyle = m.colour;
  ctx.lineWidth = m.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const b = box(m);
  switch (m.kind) {
    case 'rect':
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      break;
    case 'highlight':
      ctx.globalAlpha = 0.35;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'line':
    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2, m.y2);
      ctx.stroke();
      if (m.kind === 'arrow') {
        const angle = Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
        const head = Math.max(10, m.width * 4);
        ctx.beginPath();
        ctx.moveTo(m.x2, m.y2);
        ctx.lineTo(m.x2 - head * Math.cos(angle - 0.45), m.y2 - head * Math.sin(angle - 0.45));
        ctx.lineTo(m.x2 - head * Math.cos(angle + 0.45), m.y2 - head * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'pen': {
      const points = m.points ?? [];
      ctx.beginPath();
      for (const [i, [x, y]] of points.entries()) {
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case 'text': {
      const size = textSize(m);
      ctx.font = `600 ${size}px system-ui, "Segoe UI", "Noto Sans", "Noto Sans Devanagari", sans-serif`;
      ctx.textBaseline = 'top';
      // A halo keeps text readable on busy pictures.
      ctx.lineWidth = Math.max(2, size / 6);
      ctx.strokeStyle = m.colour === '#ffffff' ? '#000000' : '#ffffff';
      (m.text ?? '').split('\n').forEach((line, i) => {
        ctx.strokeText(line, m.x1, m.y1 + i * size * 1.2);
        ctx.fillText(line, m.x1, m.y1 + i * size * 1.2);
      });
      break;
    }
    case 'step': {
      const r = textSize(m) * 0.75;
      ctx.beginPath();
      ctx.arc(m.x1, m.y1, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = m.colour === '#ffffff' || m.colour === '#ffc53d' ? '#111111' : '#ffffff';
      ctx.font = `700 ${r * 1.1}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(m.number ?? 1), m.x1, m.y1 + r * 0.05);
      break;
    }
    case 'blur':
    case 'pixelate': {
      if (b.w < 2 || b.h < 2) break;
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.clip();
      if (m.kind === 'blur') {
        ctx.filter = `blur(${Math.max(4, m.width * 2.5)}px)`;
        ctx.drawImage(source, 0, 0);
      } else {
        const cell = Math.max(6, m.width * 3);
        const small = createCanvas(Math.max(1, Math.ceil(b.w / cell)), Math.max(1, Math.ceil(b.h / cell)));
        context2d(small).drawImage(source, b.x, b.y, b.w, b.h, 0, 0, small.width, small.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, 0, 0, small.width, small.height, b.x, b.y, small.width * cell, small.height * cell);
      }
      break;
    }
  }
  ctx.restore();
}

/** The topmost mark under (x, y), within `slack` pixels. */
export function hit(marks: readonly Mark[], x: number, y: number, slack: number): number {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i] as Mark;
    const b = box(m);
    if (m.kind === 'step') {
      if (Math.hypot(x - m.x1, y - m.y1) <= textSize(m) * 0.75 + slack) return i;
    } else if (m.kind === 'text') {
      const size = textSize(m);
      const lines = (m.text ?? '').split('\n');
      const w = Math.max(...lines.map((l) => l.length)) * size * 0.6;
      if (x >= m.x1 - slack && x <= m.x1 + w + slack && y >= m.y1 - slack && y <= m.y1 + lines.length * size * 1.2 + slack) return i;
    } else if (m.kind === 'line' || m.kind === 'arrow') {
      const dx = m.x2 - m.x1;
      const dy = m.y2 - m.y1;
      const t = Math.max(0, Math.min(1, ((x - m.x1) * dx + (y - m.y1) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(x - (m.x1 + t * dx), y - (m.y1 + t * dy)) <= slack + m.width) return i;
    } else if (m.kind === 'pen') {
      if ((m.points ?? []).some(([px, py]) => Math.hypot(x - px, y - py) <= slack + m.width)) return i;
    } else if (x >= b.x - slack && x <= b.x + b.w + slack && y >= b.y - slack && y <= b.y + b.h + slack) return i;
  }
  return -1;
}

const moved = (m: Mark, dx: number, dy: number): Mark => ({
  ...m,
  x1: m.x1 + dx,
  y1: m.y1 + dy,
  x2: m.x2 + dx,
  y2: m.y2 + dy,
  points: m.points?.map(([x, y]) => [x + dx, y + dy] as const),
});

interface Picture {
  readonly name: string;
  readonly canvas: HTMLCanvasElement;
}

function Annotate({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({ ...s }));
  const [picture, setPicture] = useState<Picture | null>(null);
  const [history, setHistory] = useState<{ stack: (readonly Mark[])[]; at: number }>({ stack: [[]], at: 0 });
  const [draft, setDraft] = useState<Mark | null>(null);
  const [selected, setSelected] = useState(-1);
  const view = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ start: [number, number]; last: [number, number]; index: number } | null>(null);
  const marks = history.stack[history.at] ?? [];

  const commit = (next: readonly Mark[]) => setHistory((h) => ({ stack: [...h.stack.slice(0, h.at + 1), next], at: h.at + 1 }));
  const undo = () => setHistory((h) => ({ ...h, at: Math.max(0, h.at - 1) }));
  const redo = () => setHistory((h) => ({ ...h, at: Math.min(h.stack.length - 1, h.at + 1) }));

  const open = (file: File | Blob | null | undefined, name = 'picture.png') => {
    if (!file) return;
    attempt(async () => {
      const canvas = await loadImage(file);
      setPicture({ name: file instanceof File ? file.name : name, canvas });
      setHistory({ stack: [[]], at: 0 });
      setSelected(-1);
    });
  };
  useIncomingFiles(
    (files) => open(files[0]),
    (f) => f.type.startsWith('image/'),
  );

  // Paste a screenshot straight in.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      if (item) open(item.getAsFile(), 'pasted.png');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const render = (target: HTMLCanvasElement, withDraft: boolean, highlight: number) => {
    if (!picture) return;
    const ctx = context2d(target);
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(picture.canvas, 0, 0);
    for (const m of withDraft && draft ? [...marks, draft] : marks) drawMark(ctx, m, picture.canvas);
    if (highlight >= 0 && marks[highlight]) {
      const m = marks[highlight] as Mark;
      const b = m.kind === 'pen' ? penBox(m) : m.kind === 'text' || m.kind === 'step' ? { x: m.x1 - 8, y: m.y1 - 8, w: textSize(m) * 2, h: textSize(m) * 1.6 } : box(m);
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#0090ff';
      ctx.lineWidth = Math.max(1, picture.canvas.width / 800);
      ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
      ctx.restore();
    }
  };

  useEffect(() => {
    if (view.current && picture) render(view.current, true, selected);
  });

  const toImage = (e: PointerEvent): [number, number] => {
    const c = view.current as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };
  const slack = picture ? Math.max(6, picture.canvas.width / 150) : 6;
  const nextStep = useMemo(() => marks.filter((m) => m.kind === 'step').reduce((n, m) => Math.max(n, m.number ?? 0), 0) + 1, [marks]);

  const onDown = (e: PointerEvent) => {
    if (!picture || e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const [x, y] = toImage(e);
    const { mode, colour, width } = settings;
    if (mode === 'select') {
      const index = hit(marks, x, y, slack);
      setSelected(index);
      drag.current = index >= 0 ? { start: [x, y], last: [x, y], index } : null;
      return;
    }
    if (mode === 'text' || mode === 'step') {
      const mark: Mark =
        mode === 'text' ? { kind: 'text', x1: x, y1: y, x2: x, y2: y, colour, width, text: settings.text || 'Note' } : { kind: 'step', x1: x, y1: y, x2: x, y2: y, colour, width, number: nextStep };
      commit([...marks, mark]);
      setSelected(marks.length);
      return;
    }
    drag.current = { start: [x, y], last: [x, y], index: -1 };
    setDraft({ kind: mode, x1: x, y1: y, x2: x, y2: y, colour, width, points: mode === 'pen' ? [[x, y]] : undefined });
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = toImage(e);
    if (settings.mode === 'select' && d.index >= 0) {
      const [lx, ly] = d.last;
      d.last = [x, y];
      setHistory((h) => {
        // Moving edits the current entry in place; the move becomes one undo step on release.
        const current = h.stack[h.at] ?? [];
        const next = current.map((m, i) => (i === d.index ? moved(m, x - lx, y - ly) : m));
        return { stack: [...h.stack.slice(0, h.at), next], at: h.at };
      });
      return;
    }
    setDraft((m) => (m ? { ...m, x2: x, y2: y, points: m.kind === 'pen' ? [...(m.points ?? []), [x, y] as const] : m.points } : m));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (settings.mode === 'select') {
      if (d && d.index >= 0 && (d.last[0] !== d.start[0] || d.last[1] !== d.start[1])) {
        // Record the position before the move so undo returns there.
        setHistory((h) => {
          const after = h.stack[h.at] ?? [];
          const before = after.map((m, i) => (i === d.index ? moved(m, d.start[0] - d.last[0], d.start[1] - d.last[1]) : m));
          return { stack: [...h.stack.slice(0, h.at), before, after], at: h.at + 1 };
        });
      }
      return;
    }
    if (draft) {
      const b = box(draft);
      const big = draft.kind === 'pen' ? (draft.points?.length ?? 0) > 1 : b.w > 3 || b.h > 3;
      if (big) {
        commit([...marks, draft]);
        setSelected(marks.length);
      }
    }
    setDraft(null);
  };

  const remove = () => {
    if (selected < 0) return;
    commit(marks.filter((_, i) => i !== selected));
    setSelected(-1);
  };
  const restyle = (patch: Partial<Mark>) => {
    if (selected >= 0 && marks[selected]) commit(marks.map((m, i) => (i === selected ? { ...m, ...patch } : m)));
  };

  // Keyboard: tool letters, Delete, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) {
        e.preventDefault();
        remove();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
        if (tool) setSettings((s) => ({ ...s, mode: tool.mode }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const exportImage = () =>
    attempt(async () => {
      if (!picture) return;
      const out = createCanvas(picture.canvas.width, picture.canvas.height);
      render(out, false, -1);
      const blob = await encodeCanvas(out, { format: settings.format, quality: 92, matte: '#ffffff' });
      const name = replaceExtension(picture.name.replace(/\.[^.]+$/, '') + ' (annotated).png', settings.format === 'jpeg' ? 'jpg' : 'png');
      const saved = await saveFile(name, blob, settings.format === 'jpeg' ? 'image/jpeg' : 'image/png');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });
  const copyImage = () =>
    attempt(async () => {
      if (!picture) return;
      const out = createCanvas(picture.canvas.width, picture.canvas.height);
      render(out, false, -1);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not make the picture.');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      notify('Copied the picture.');
    });

  const current = selected >= 0 ? marks[selected] : undefined;
  return (
    <div data-testid="tool" class="tool annotate-tool">
      <div class="annotate-bar" role="toolbar" aria-label="Annotation tools">
        <Segmented
          label="Tool"
          value={settings.mode}
          onChange={(mode) => setSettings((s) => ({ ...s, mode }))}
          choices={TOOLS.map((t) => ({ value: t.mode, label: `${t.label} (${t.key.toUpperCase()})` }))}
        />
        <div class="annotate-swatches" role="radiogroup" aria-label="Colour">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={settings.colour === c}
              aria-label={`Colour ${c}`}
              class={settings.colour === c ? 'is-active' : ''}
              style={{ background: c }}
              onClick={() => {
                setSettings((s) => ({ ...s, colour: c }));
                restyle({ colour: c });
              }}
            />
          ))}
          <input
            type="color"
            aria-label="Other colour"
            value={settings.colour}
            onInput={(e) => setSettings((s) => ({ ...s, colour: e.currentTarget.value }))}
            onChange={(e) => restyle({ colour: e.currentTarget.value })}
          />
        </div>
        <label class="annotate-width" for="annotate-width">
          Thickness
          <input
            id="annotate-width"
            type="range"
            min={1}
            max={20}
            value={settings.width}
            onInput={(e) => setSettings((s) => ({ ...s, width: Number(e.currentTarget.value) }))}
            onChange={(e) => restyle({ width: Number(e.currentTarget.value) })}
          />
        </label>
        <input
          class="input annotate-text"
          aria-label="Text for text marks"
          value={current?.kind === 'text' ? current.text : settings.text}
          onInput={(e) => {
            const text = e.currentTarget.value;
            setSettings((s) => ({ ...s, text }));
          }}
          onChange={(e) => current?.kind === 'text' && restyle({ text: e.currentTarget.value })}
        />
        <div class="button-row">
          <button type="button" class="icon-button" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" disabled={history.at === 0} onClick={undo}>
            <Icon name="rotate-left" size={16} />
          </button>
          <button type="button" class="icon-button" aria-label="Redo (Ctrl+Y)" title="Redo (Ctrl+Y)" disabled={history.at >= history.stack.length - 1} onClick={redo}>
            <Icon name="rotate-right" size={16} />
          </button>
          <button type="button" class="icon-button" aria-label="Delete the selected mark" title="Delete (Del)" disabled={selected < 0} onClick={remove}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
      <div class="annotate-stage" {...scrollRegion('Picture')}>
        {picture ? (
          <canvas
            ref={view}
            width={picture.canvas.width}
            height={picture.canvas.height}
            class={`annotate-canvas mode-${settings.mode}`}
            aria-label={`Picture with ${marks.length} marks. Drag to draw with the chosen tool.`}
            data-testid="annotate-canvas"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        ) : (
          <div
            class="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              open(e.dataTransfer?.files[0]);
            }}
          >
            <button type="button" class="button button-primary" data-testid="annotate-open" onClick={() => attempt(async () => open(await pickFile('image/*')))}>
              Open a picture
            </button>
            <span class="dropzone-hint">or drop one here, or paste a screenshot (Ctrl+V)</span>
          </div>
        )}
      </div>
      {picture && (
        <div class="button-row annotate-actions">
          <Segmented
            label="Format"
            value={settings.format}
            onChange={(format) => setSettings((s) => ({ ...s, format }))}
            choices={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG' },
            ]}
          />
          <button type="button" class="button button-primary" onClick={exportImage} data-testid="annotate-save">
            Save
          </button>
          <button type="button" class="button" onClick={copyImage}>
            Copy
          </button>
          <button type="button" class="button button-quiet" onClick={() => attempt(async () => open(await pickFile('image/*')))}>
            Open another
          </button>
          <span class="tone-muted">
            {picture.canvas.width} × {picture.canvas.height} px, {marks.length} mark{marks.length === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </div>
  );
}

function penBox(m: Mark) {
  const xs = (m.points ?? []).map(([x]) => x);
  const ys = (m.points ?? []).map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export default defineCustomTool(Annotate);
