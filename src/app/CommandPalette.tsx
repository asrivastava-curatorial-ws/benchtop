/** Keyboard-driven tool switcher (Ctrl/Cmd + K). */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type CalculatorHit, openCalculator, searchCalculators } from '../calc/launch';
import { CALC_CATEGORIES } from '../calc/types';
import { type OperationHit, openRecipeOperation, searchOperations } from '../recipe/launch';
import { CATEGORIES, findTool, searchTools } from '../tools/registry';
import type { ToolEntry } from '../tools/types';
import { Icon } from '../ui/icons';
import { navigate, toolHref } from './router';
import { getSettings } from './store';

const CATEGORY_NAMES = new Map(CATEGORIES.map((category) => [category.id, category.name]));
const CALC_NAMES = new Map<string, string>(CALC_CATEGORIES.map((category) => [category.id, category.name]));

const hitKey = (hit: { readonly id: string } & ({ readonly operation: true } | { readonly calculator: true } | object)) =>
  'operation' in hit ? `op-${hit.id}` : 'calculator' in hit ? `calc-${hit.id}` : hit.id;

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  type Hit = ToolEntry | (OperationHit & { readonly operation: true }) | (CalculatorHit & { readonly calculator: true });
  const results = useMemo<Hit[]>(() => {
    if (query.trim() !== '') {
      const tools: Hit[] = searchTools(query).slice(0, 50);
      return [...tools, ...searchCalculators(query, 8).map((calc) => ({ ...calc, calculator: true as const })), ...searchOperations(query, 8).map((op) => ({ ...op, operation: true as const }))];
    }
    // With no query, offer what the user is most likely to want: favourites, then recent tools.
    const settings = getSettings();
    const quick = [...settings.favorites, ...settings.recents].map(findTool).filter((tool): tool is ToolEntry => tool !== undefined);
    const seen = new Set(quick.map((tool) => tool.id));
    return [...new Map(quick.map((tool) => [tool.id, tool])).values(), ...searchTools('').filter((tool) => !seen.has(tool.id))].slice(0, 50);
  }, [query]);

  // Focus before the next keystroke arrives, so typing straight after Ctrl+K loses nothing.
  useLayoutEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, results]);

  // A link copied from a tool (a calculator with its values) opens that tool.
  const link = /#\/tool\/[a-z0-9-]+(?:\?[A-Za-z0-9\-_=&.~%+]*)?/.exec(query)?.[0] ?? null;

  const open = (hit: Hit | undefined) => {
    if (!hit) return;
    if ('operation' in hit) openRecipeOperation(hit.id);
    else if ('calculator' in hit) openCalculator(hit.id);
    else navigate(toolHref(hit.id));
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
            aria-activedescendant={results[index] ? `palette-${hitKey(results[index])}` : undefined}
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
                if (link) {
                  navigate(link);
                  onClose();
                } else open(results[index]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul ref={list} id="palette-results" class="palette-results" role="listbox" aria-label="Tools">
          {link && (
            <li class="palette-empty" data-testid="palette-link">
              Press Enter to open this link in its tool.
            </li>
          )}
          {!link && results.length === 0 && <li class="palette-empty">No tool matches "{query}". Try a format name such as "json", "base64" or "png".</li>}
          {results.map((hit, position) => (
            <li
              key={hitKey(hit)}
              id={`palette-${hitKey(hit)}`}
              role="option"
              tabIndex={-1}
              aria-selected={position === index}
              class={position === index ? 'is-active' : ''}
              onMouseMove={() => setIndex(position)}
              onClick={() => open(hit)}
            >
              <span class="palette-name">{hit.name}</span>
              <span class="palette-description">
                {'operation' in hit ? `Recipe operation in ${hit.category}` : 'calculator' in hit ? `Calculator in ${CALC_NAMES.get(hit.category) ?? hit.category}` : hit.description}
              </span>
              <span class="palette-category">{'operation' in hit ? 'Recipe' : 'calculator' in hit ? 'Calculator' : CATEGORY_NAMES.get(hit.category)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
