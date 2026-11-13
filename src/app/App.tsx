import { useEffect, useState } from 'preact/hooks';
import { APP_NAME } from '../brand';
import { findTool } from '../tools/registry';
import { Icon } from '../ui/icons';
import { Toasts } from '../ui/toast';
import { CommandPalette } from './CommandPalette';
import { Home } from './Home';
import { useRoute } from './router';
import { SettingsView } from './SettingsView';
import { Sidebar } from './Sidebar';
import { getSettings, updateSettings, useSettings } from './store';
import { ToolHost } from './ToolHost';

export function App() {
  const route = useRoute();
  const sidebarHidden = useSettings((settings) => settings.sidebarHidden);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
      } else if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        updateSettings({ sidebarHidden: !getSettings().sidebarHidden });
      }
    };
    // A file dropped outside a drop target must never make the window navigate to it.
    const blockNavigation = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    addEventListener('keydown', onKey);
    addEventListener('dragover', blockNavigation);
    addEventListener('drop', blockNavigation);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('dragover', blockNavigation);
      removeEventListener('drop', blockNavigation);
    };
  }, []);

  const tool = route.page === 'tool' ? findTool(route.id) : undefined;
  useEffect(() => {
    document.title = tool ? `${tool.name} – ${APP_NAME}` : route.page === 'settings' ? `Settings – ${APP_NAME}` : APP_NAME;
  }, [tool, route.page]);

  return (
    <div class={`app${sidebarHidden ? ' sidebar-hidden' : ''}`}>
      <a class="skip-link" href="#main">
        Skip to the tool
      </a>
      {!sidebarHidden && <Sidebar route={route} onOpenPalette={() => setPalette(true)} />}
      <main id="main" class="main" tabIndex={-1}>
        {sidebarHidden && (
          <div class="main-bar">
            <button type="button" class="button button-small" onClick={() => updateSettings({ sidebarHidden: false })}>
              <Icon name="menu" size={14} />
              Show tools
            </button>
            <button type="button" class="button button-small" onClick={() => setPalette(true)}>
              <Icon name="search" size={14} />
              Find a tool
            </button>
          </div>
        )}
        {route.page === 'home' && <Home onOpenPalette={() => setPalette(true)} />}
        {route.page === 'settings' && <SettingsView />}
        {route.page === 'tool' &&
          (tool ? (
            <ToolHost entry={tool} />
          ) : (
            <div class="tool-failure">
              <h2>There is no tool called "{route.id}"</h2>
              <p>It may have been renamed. Use the search to find what you need.</p>
              <a class="button button-primary" href="#/">
                See all tools
              </a>
            </div>
          ))}
      </main>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      <Toasts />
    </div>
  );
}
