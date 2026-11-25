import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { APP_NAME } from '../brand';
import { onDeskRequests, setQuickKey, setTray, watchClipboard } from '../platform/desk';
import { findTool, TOOLS } from '../tools/registry';
import type { ToolEntry } from '../tools/types';
import { Icon } from '../ui/icons';
import { Toasts } from '../ui/toast';
import { CommandPalette } from './CommandPalette';
import { DropDialog } from './DropDialog';
import { Home } from './Home';
import { startProjects, useActiveProject } from './projects';
import { navigate, toolHref, useRoute } from './router';
import { SettingsView } from './SettingsView';
import { Sidebar } from './Sidebar';
import { getSettings, updateSettings, useSettings } from './store';
import { ToolHost } from './ToolHost';

startProjects();

/** The start screen: the notes, with the way to every other tool along the top. */
function StartPage({ notes, onOpenPalette }: { notes: ToolEntry; onOpenPalette: () => void }) {
  const settings = useSettings();
  const shortcuts = [...settings.favorites, ...settings.recents]
    .filter((id, i, all) => id !== notes.id && all.indexOf(id) === i)
    .map(findTool)
    .filter((tool): tool is ToolEntry => tool !== undefined)
    .slice(0, 6);
  return (
    <div class="start">
      <nav class="start-bar" aria-label="Other tools">
        <a class="button button-small" href="#/tools" data-testid="start-all-tools">
          <Icon name="menu" size={14} />
          All {TOOLS.length} tools
        </a>
        <button type="button" class="button button-small" onClick={onOpenPalette}>
          <Icon name="search" size={14} />
          Find a tool <kbd>Ctrl K</kbd>
        </button>
        {shortcuts.map((tool) => (
          <a key={tool.id} class="start-chip" href={toolHref(tool.id)} title={tool.description}>
            {tool.name}
          </a>
        ))}
      </nav>
      <ToolHost entry={notes} />
    </div>
  );
}

export function App() {
  const route = useRoute();
  const sidebarHidden = useSettings((settings) => settings.sidebarHidden);
  const startPage = useSettings((settings) => settings.startScreen);
  const project = useActiveProject();
  const notes = findTool('notes');
  const startsOnNotes = startPage === 'notes' && notes !== undefined;
  const [palette, setPalette] = useState(false);
  const [dropped, setDropped] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);

  // Desktop extras the user turned on (tray icon, quick-launch shortcut, clipboard history) and their requests.
  useEffect(() => {
    const settings = getSettings();
    const failed = (what: string) => (error: unknown) => console.warn(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    if (settings.trayIcon) setTray(true).catch(failed('Tray icon'));
    if (settings.quickKey) setQuickKey(settings.quickKey).catch(failed('Quick launcher shortcut'));
    if (settings.clipboardHistory) watchClipboard(true).catch(failed('Clipboard history'));
    const stop = onDeskRequests(
      () => setPalette(true),
      (id) => navigate(`#/tool/${id}`),
    );
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  // Registered during the first render (not after paint) so a shortcut pressed as the window opens is not lost.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // An editor that used the key (Ctrl+B for bold, Ctrl+K for a link) keeps it.
      if (event.defaultPrevented) return;
      const modifier = event.ctrlKey || event.metaKey;
      const target = event.target instanceof Element ? event.target : null;
      const richText = target?.closest('[contenteditable=""], [contenteditable="true"], .cm-editor') !== null && target !== null;
      if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
      } else if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'b' && !richText) {
        event.preventDefault();
        updateSettings({ sidebarHidden: !getSettings().sidebarHidden });
      }
    };
    // A file dropped outside a drop target must never make the window navigate to it;
    // instead the app offers the tools that can open it.
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(event)) return;
      // A tool's own drop area has already taken the files.
      const handled = event.defaultPrevented;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!handled && files.length) setDropped(files);
    };
    addEventListener('keydown', onKey);
    addEventListener('dragover', onDragOver);
    addEventListener('dragenter', onDragEnter);
    addEventListener('dragleave', onDragLeave);
    addEventListener('drop', onDrop);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('dragover', onDragOver);
      removeEventListener('dragenter', onDragEnter);
      removeEventListener('dragleave', onDragLeave);
      removeEventListener('drop', onDrop);
    };
  }, []);

  const tool = route.page === 'tool' ? findTool(route.id) : undefined;
  useEffect(() => {
    const page = tool ? tool.name : route.page === 'settings' ? 'Settings' : route.page === 'tools' || !startsOnNotes ? 'All tools' : 'Notes';
    document.title = `${page} – ${APP_NAME}${project ? ` (${project.name})` : ''}`;
  }, [tool, route.page, startsOnNotes, project?.name]);

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
        {route.page === 'home' && startsOnNotes && <StartPage key={project?.id ?? 'none'} notes={notes} onOpenPalette={() => setPalette(true)} />}
        {(route.page === 'tools' || (route.page === 'home' && !startsOnNotes)) && <Home onOpenPalette={() => setPalette(true)} />}
        {route.page === 'settings' && <SettingsView />}
        {route.page === 'tool' &&
          (tool ? (
            // Tools read their saved options when they open, so a change of project starts them afresh.
            <ToolHost key={project?.id ?? 'none'} entry={tool} />
          ) : (
            <div class="tool-failure">
              <h2>There is no tool called "{route.id}"</h2>
              <p>It may have been renamed. Use the search to find what you need.</p>
              <a class="button button-primary" href="#/tools">
                See all tools
              </a>
            </div>
          ))}
      </main>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {dropped && <DropDialog files={dropped} onClose={() => setDropped(null)} />}
      {dragging && !dropped && (
        <div class="drop-hint" aria-hidden="true">
          Drop on a tool’s drop area, or anywhere else to see which tools can open the file
        </div>
      )}
      <Toasts />
    </div>
  );
}
