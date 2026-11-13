/** Keyboard-driven tool switcher (Ctrl/Cmd + K). */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CATEGORIES, findTool, searchTools } from '../tools/registry';
import type { ToolEntry } from '../tools/types';
import { Icon } from '../ui/icons';
import { navigate, toolHref } from './router';
import { getSettings } from './store';

const CATEGORY_NAMES = new Map(CATEGORIES.map((category) => [category.id, category.name]));

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo<ToolEntry[]>(() => {
    if (query.trim() !== '') return searchTools(query).slice(0, 50);
    // With no query, offer what the user is most likely to want: favourites, then recent tools.
    const settings = getSettings();
    const quick = [...settings.favorites, ...settings.recents].map(findTool).filter((tool): tool is ToolEntry => tool !== undefined);
    const seen = new Set(quick.map((tool) => tool.id));
    return [...new Map(quick.map((tool) => [tool.id, tool])).values(), ...searchTools('').filter((tool) => !seen.has(tool.id))].slice(0, 50);
  }, [query]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, results]);

  const open = (tool: ToolEntry | undefined) => {
    if (!tool) return;
    navigate(toolHref(tool.id));
    onClose();
  };

  return (
    <div class="palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div class="palette" role="dialog" aria-modal="true" aria-label="Find a tool">
        <div class="palette-input">
          <Icon name="search" size={17} />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[index] ? `palette-${results[index].id}` : undefined}
            aria-autocomplete="list"
            placeholder="Type a tool name, format or task"
            value={query}
            spellcheck={false}
            autocomplete="off"
            data-testid="palette-input"
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((value) => Math.min(results.length - 1, value + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((value) => Math.max(0, value - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                open(results[index]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul ref={list} id="palette-results" class="palette-results" role="listbox" aria-label="Tools">
          {results.length === 0 && <li class="palette-empty">No tool matches "{query}". Try a format name such as "json", "base64" or "png".</li>}
          {results.map((tool, position) => (
            <li
              key={tool.id}
              id={`palette-${tool.id}`}
              role="option"
              tabIndex={-1}
              aria-selected={position === index}
              class={position === index ? 'is-active' : ''}
              onMouseMove={() => setIndex(position)}
              onClick={() => open(tool)}
            >
              <span class="palette-name">{tool.name}</span>
              <span class="palette-description">{tool.description}</span>
              <span class="palette-category">{CATEGORY_NAMES.get(tool.category)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
