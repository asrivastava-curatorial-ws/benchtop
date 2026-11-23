/** Optional CodeMirror extensions used by the document tools. */
import type { Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, MatchDecorator, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { formatBytes } from '../lib/bytes';

class DataUrlChip extends WidgetType {
  constructor(
    readonly mime: string,
    readonly bytes: number,
  ) {
    super();
  }
  override eq(other: DataUrlChip): boolean {
    return other.mime === this.mime && other.bytes === this.bytes;
  }
  toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'cm-data-chip';
    chip.textContent = `${this.mime.startsWith('image/') ? 'picture' : 'file'} ${this.mime.split('/')[1] ?? ''} · ${formatBytes(this.bytes)}`;
    chip.title = 'Embedded data (shown shortened). The full data stays in the document.';
    return chip;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const matcher = new MatchDecorator({
  regexp: /data:([\w.+-]+\/[\w.+-]+)(?:;[\w=-]+)*;base64,[A-Za-z0-9+/=]{48,}/g,
  decoration: (match) => Decoration.replace({ widget: new DataUrlChip(match[1] as string, Math.floor(((match[0].length - match[0].indexOf(',') - 1) * 3) / 4)) }),
});

/** Long data: URLs (embedded pictures) shown as a short chip instead of thousands of characters. */
export const dataUrlChips: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = matcher.updateDeco(update, this.decorations);
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
    },
  ),
  EditorView.theme({
    '.cm-data-chip': {
      display: 'inline-block',
      padding: '0 6px',
      margin: '0 1px',
      borderRadius: '4px',
      border: '1px solid var(--line-strong)',
      background: 'var(--panel-2)',
      color: 'var(--muted)',
      fontFamily: 'var(--font-ui)',
      fontSize: '11px',
      lineHeight: '1.5',
    },
  }),
];

/** Wraps the selection in `before` and `after` (or inserts `placeholder` between them) and selects the inside. */
export function wrapSelection(view: EditorView, before: string, after: string, placeholder = ''): void {
  const { from, to } = view.state.selection.main;
  const inner = view.state.sliceDoc(from, to) || placeholder;
  view.dispatch({
    changes: { from, to, insert: before + inner + after },
    selection: { anchor: from + before.length, head: from + before.length + inner.length },
    scrollIntoView: true,
  });
  view.focus();
}

/** Adds `prefix` to the start of every selected line (toggles it off when all lines have it). */
export function prefixLines(view: EditorView, prefix: string | ((index: number) => string)): void {
  const { state } = view;
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  const lines = Array.from({ length: last - first + 1 }, (_, i) => state.doc.line(first + i));
  const prefixes = lines.map((_, i) => (typeof prefix === 'string' ? prefix : prefix(i)));
  const all = lines.every((line, i) => line.text.startsWith(prefixes[i] as string));
  view.dispatch({
    changes: lines.map((line, i) => (all ? { from: line.from, to: line.from + (prefixes[i] as string).length, insert: '' } : { from: line.from, insert: prefixes[i] as string })),
    scrollIntoView: true,
  });
  view.focus();
}

/** Inserts text at the cursor (replacing the selection) and puts the cursor after it, or at `cursorOffset`. */
export function insertText(view: EditorView, text: string, cursorOffset?: number): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + (cursorOffset ?? text.length) }, scrollIntoView: true });
  view.focus();
}

/** Moves the cursor to a 1-based line and scrolls it to the top. */
export function goToLine(view: EditorView, line: number): void {
  const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
  view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 8 }) });
  view.focus();
}
