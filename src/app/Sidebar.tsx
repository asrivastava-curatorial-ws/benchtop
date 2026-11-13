import { useMemo, useState } from 'preact/hooks';
import { APP_NAME } from '../brand';
import { CATEGORIES, findTool, searchTools, TOOLS } from '../tools/registry';
import type { ToolEntry } from '../tools/types';
import { Icon } from '../ui/icons';
import { navigate, type Route, toolHref } from './router';
import { type ThemeChoice, toggleCollapsed, updateSettings, useSettings } from './store';

const THEMES: { value: ThemeChoice; label: string; icon: 'monitor' | 'sun' | 'moon' }[] = [
  { value: 'system', label: 'Match the system', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

function ToolLink({ tool, active }: { tool: ToolEntry; active: boolean }) {
  return (
    <li>
      <a href={toolHref(tool.id)} class={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} title={tool.description}>
        {tool.name}
      </a>
    </li>
  );
}

export function Sidebar({ route, onOpenPalette }: { route: Route; onOpenPalette: () => void }) {
  const settings = useSettings();
  const [query, setQuery] = useState('');
  const activeId = route.page === 'tool' ? route.id : '';
  const results = useMemo(() => (query.trim() === '' ? null : searchTools(query)), [query]);
  const favorites = settings.favorites.map(findTool).filter((tool): tool is ToolEntry => tool !== undefined);

  return (
    <nav class="sidebar" aria-label="Tools">
      <div class="sidebar-top">
        <a class="brand" href="#/" aria-label={`${APP_NAME} home`}>
          <span class="brand-mark" aria-hidden="true" />
          <span class="brand-name">{APP_NAME}</span>
        </a>
        <div class="search">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder="Find a tool"
            aria-label="Find a tool"
            value={query}
            spellcheck={false}
            autocomplete="off"
            data-testid="sidebar-search"
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results?.[0]) {
                navigate(toolHref(results[0].id));
                setQuery('');
              } else if (event.key === 'Escape') {
                setQuery('');
              }
            }}
          />
          <button type="button" class="kbd" onClick={onOpenPalette} title="Open the command palette" aria-label="Open the command palette">
            Ctrl K
          </button>
        </div>
      </div>

      <div class="sidebar-scroll">
        {results ? (
          <section>
            <h2 class="sidebar-heading">
              <span>{results.length === 0 ? 'No tools match' : 'Results'}</span>
              <span class="count">{results.length}</span>
            </h2>
            <ul class="tool-list">
              {results.map((tool) => (
                <ToolLink key={tool.id} tool={tool} active={tool.id === activeId} />
              ))}
            </ul>
          </section>
        ) : (
          <>
            {favorites.length > 0 && (
              <section>
                <h2 class="sidebar-heading">
                  <span>Favourites</span>
                  <span class="count">{favorites.length}</span>
                </h2>
                <ul class="tool-list">
                  {favorites.map((tool) => (
                    <ToolLink key={tool.id} tool={tool} active={tool.id === activeId} />
                  ))}
                </ul>
              </section>
            )}
            {CATEGORIES.map((category) => {
              const tools = TOOLS.filter((tool) => tool.category === category.id);
              const collapsed = settings.collapsed.includes(category.id);
              return (
                <section key={category.id}>
                  <h2 class="sidebar-heading">
                    <button type="button" aria-expanded={!collapsed} onClick={() => toggleCollapsed(category.id)}>
                      <span class={`twist${collapsed ? '' : ' is-open'}`}>
                        <Icon name="chevron" size={12} />
                      </span>
                      <span>{category.name}</span>
                      <span class="count">{tools.length}</span>
                    </button>
                  </h2>
                  {!collapsed && (
                    <ul class="tool-list">
                      {tools.map((tool) => (
                        <ToolLink key={tool.id} tool={tool} active={tool.id === activeId} />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </>
        )}
      </div>

      <div class="sidebar-bottom">
        <a href="#/settings" class={`sidebar-link${route.page === 'settings' ? ' is-active' : ''}`}>
          <Icon name="settings" size={15} />
          Settings
        </a>
        <div class="theme-switch" role="radiogroup" aria-label="Theme">
          {THEMES.map((theme) => (
            <button
              key={theme.value}
              type="button"
              role="radio"
              aria-checked={settings.theme === theme.value}
              aria-label={theme.label}
              title={theme.label}
              class={settings.theme === theme.value ? 'is-active' : ''}
              onClick={() => updateSettings({ theme: theme.value })}
            >
              <Icon name={theme.icon} size={14} />
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
