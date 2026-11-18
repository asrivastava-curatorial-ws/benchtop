/**
 * Files dropped on the window outside a tool's own drop area: lists the tools
 * that can open them, and hands the files to the one chosen.  Also used by
 * "Send to" on a tool's result.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { formatBytes } from '../lib/bytes';
import { Icon } from '../ui/icons';
import { sendToTool } from './handoff';
import { type Suggestion, suggestTools } from './suggest';

export function DropDialog({ files, from, onClose }: { files: readonly File[]; from?: string; onClose: () => void }) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let live = true;
    void suggestTools(files, from).then((found) => live && setSuggestions(found));
    return () => {
      live = false;
    };
  }, [files, from]);

  useLayoutEffect(() => {
    list.current?.focus();
  }, [suggestions]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const open = (suggestion: Suggestion | undefined) => {
    if (!suggestion) return;
    sendToTool(suggestion.tool.id, { files });
    onClose();
  };
  const first = files[0];
  const title = files.length === 1 && first ? first.name : `${files.length} files`;
  const size = files.reduce((total, f) => total + f.size, 0);

  return (
    <div class="palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div class="palette drop-dialog" role="dialog" aria-modal="true" aria-labelledby="drop-dialog-title" data-testid="drop-dialog">
        <div class="drop-dialog-head">
          <Icon name="file" size={18} />
          <div>
            <h2 id="drop-dialog-title">Open {title} in…</h2>
            <p>
              {formatBytes(size)}
              {files.length > 1 ? `, starting with ${first?.name}` : ''}. Nothing leaves this computer.
            </p>
          </div>
          <button type="button" class="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <ul
          ref={list}
          class="palette-results"
          role="listbox"
          aria-label="Tools that can open it"
          tabIndex={0}
          aria-activedescendant={suggestions?.[index] ? `drop-${suggestions[index].tool.id}` : undefined}
          onKeyDown={(event) => {
            if (!suggestions) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((i) => Math.min(suggestions.length - 1, i + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              open(suggestions[index]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        >
          {suggestions === null && <li class="palette-empty">Looking at the file…</li>}
          {suggestions?.map((s, position) => (
            <li
              key={s.tool.id}
              id={`drop-${s.tool.id}`}
              role="option"
              tabIndex={-1}
              aria-selected={position === index}
              class={position === index ? 'is-active' : ''}
              onMouseMove={() => setIndex(position)}
              onClick={() => open(s)}
              data-tool={s.tool.id}
            >
              <span class="palette-name">{s.tool.name}</span>
              <span class="palette-description">{s.does}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
