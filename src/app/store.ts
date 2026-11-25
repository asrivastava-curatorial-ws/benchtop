/**
 * Persistent settings.
 *
 * Only preferences are stored: theme, favourites, recently used tools and the
 * option values of each tool.  Text typed into a tool and option values marked
 * as secret (passwords, keys) are never written to disk.
 */
import { useEffect, useState } from 'preact/hooks';
import type { Values } from '../tools/types';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Settings {
  readonly theme: ThemeChoice;
  /** Editor font size in pixels. */
  readonly editorFontSize: number;
  readonly wrapLines: boolean;
  /** Remember each tool's option values between sessions. */
  readonly rememberOptions: boolean;
  readonly favorites: readonly string[];
  readonly recents: readonly string[];
  /** Ids of collapsed sidebar categories. */
  readonly collapsed: readonly string[];
  readonly sidebarHidden: boolean;
  /** Let the tools in the "Online checks" category contact the hosts the user enters (desktop app only). */
  readonly allowNetwork: boolean;
  /** Desktop app: an icon in the system tray; closing the window then keeps Benchtop running. */
  readonly trayIcon: boolean;
  /** Desktop app: global shortcut for the quick launcher, such as "Ctrl+Alt+Space"; empty for none. */
  readonly quickKey: string;
  /** Desktop app: keep a clipboard history in memory while Benchtop runs. */
  readonly clipboardHistory: boolean;
  /**
   * What Benchtop opens on: the list of all tools, or the notes.  Stored under a new name in 5.1, so that
   * the notes start screen that 5.0 saved for everyone does not outlive its default.
   */
  readonly startScreen: 'tools' | 'notes';
  readonly toolOptions: Readonly<Record<string, Values>>;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  editorFontSize: 13,
  wrapLines: false,
  rememberOptions: true,
  favorites: [],
  recents: [],
  collapsed: [],
  sidebarHidden: false,
  allowNetwork: true,
  trayIcon: false,
  quickKey: '',
  clipboardHistory: false,
  startScreen: 'tools',
  toolOptions: {},
};

const STORAGE_KEY = 'benchtop.settings.v1';
const MAX_RECENTS = 8;

const strings = (value: unknown, fallback: readonly string[]): readonly string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 500) : fallback);

/** Builds valid settings from untrusted data (old versions, hand-edited or imported files). */
export function sanitizeSettings(raw: unknown): Settings {
  const source = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const toolOptions: Record<string, Values> = {};
  if (source.toolOptions !== null && typeof source.toolOptions === 'object') {
    for (const [id, values] of Object.entries(source.toolOptions as Record<string, unknown>)) {
      if (values !== null && typeof values === 'object' && !Array.isArray(values)) toolOptions[id] = values as Values;
    }
  }
  const size = typeof source.editorFontSize === 'number' && Number.isFinite(source.editorFontSize) ? source.editorFontSize : DEFAULT_SETTINGS.editorFontSize;
  return {
    theme: source.theme === 'light' || source.theme === 'dark' || source.theme === 'system' ? source.theme : DEFAULT_SETTINGS.theme,
    editorFontSize: Math.min(24, Math.max(10, Math.round(size))),
    wrapLines: typeof source.wrapLines === 'boolean' ? source.wrapLines : DEFAULT_SETTINGS.wrapLines,
    rememberOptions: typeof source.rememberOptions === 'boolean' ? source.rememberOptions : DEFAULT_SETTINGS.rememberOptions,
    favorites: strings(source.favorites, []),
    recents: strings(source.recents, []).slice(0, MAX_RECENTS),
    collapsed: strings(source.collapsed, []),
    sidebarHidden: typeof source.sidebarHidden === 'boolean' ? source.sidebarHidden : false,
    allowNetwork: typeof source.allowNetwork === 'boolean' ? source.allowNetwork : DEFAULT_SETTINGS.allowNetwork,
    trayIcon: source.trayIcon === true,
    quickKey: typeof source.quickKey === 'string' ? source.quickKey.slice(0, 60) : '',
    clipboardHistory: source.clipboardHistory === true,
    startScreen: source.startScreen === 'notes' ? 'notes' : 'tools',
    toolOptions,
  };
}

function load(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? DEFAULT_SETTINGS : sanitizeSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: Settings = typeof localStorage === 'undefined' ? DEFAULT_SETTINGS : load();
const listeners = new Set<() => void>();

/**
 * While a project is open, tool options are the project's own: tools read and
 * save them exactly as before, and the options kept outside any project are
 * set aside untouched until the project is closed.
 */
export interface OptionScope {
  toolOptions: Readonly<Record<string, Values>>;
  onChange(toolOptions: Readonly<Record<string, Values>>): void;
}
let scope: OptionScope | null = null;
let outside: Readonly<Record<string, Values>> = {};

export function setOptionScope(next: OptionScope | null): void {
  const kept = scope ? outside : current.toolOptions;
  scope = next;
  outside = kept;
  current = { ...current, toolOptions: next ? next.toolOptions : kept };
  for (const listener of listeners) listener();
}

function commit(next: Settings): void {
  current = next;
  if (scope && next.toolOptions !== scope.toolOptions) {
    scope.toolOptions = next.toolOptions;
    scope.onChange(next.toolOptions);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scope ? { ...next, toolOptions: outside } : next));
  } catch {
    // Storage may be full or disabled; the app still works for this session.
  }
  for (const listener of listeners) listener();
}

export const getSettings = (): Settings => current;

export function updateSettings(patch: Partial<Settings>): void {
  commit({ ...current, ...patch });
}

export function toggleFavorite(id: string): void {
  const favorites = current.favorites.includes(id) ? current.favorites.filter((item) => item !== id) : [...current.favorites, id];
  commit({ ...current, favorites });
}

export function noteRecent(id: string): void {
  if (current.recents[0] === id) return;
  commit({ ...current, recents: [id, ...current.recents.filter((item) => item !== id)].slice(0, MAX_RECENTS) });
}

export function toggleCollapsed(id: string): void {
  const collapsed = current.collapsed.includes(id) ? current.collapsed.filter((item) => item !== id) : [...current.collapsed, id];
  commit({ ...current, collapsed });
}

export function saveToolOptions(id: string, values: Values): void {
  if (!current.rememberOptions) return;
  commit({ ...current, toolOptions: { ...current.toolOptions, [id]: values } });
}

export function forgetToolOptions(id?: string): void {
  if (id === undefined) {
    commit({ ...current, toolOptions: {} });
    return;
  }
  const { [id]: _removed, ...rest } = current.toolOptions;
  commit({ ...current, toolOptions: rest });
}

/** Replaces the settings; an open project keeps its own tool options. */
function replaceAll(next: Settings): void {
  if (!scope) {
    commit(next);
    return;
  }
  outside = next.toolOptions;
  commit({ ...next, toolOptions: current.toolOptions });
}

export function resetSettings(): void {
  replaceAll(DEFAULT_SETTINGS);
}

export function exportSettings(): string {
  return `${JSON.stringify({ app: 'benchtop', version: 1, settings: scope ? { ...current, toolOptions: outside } : current }, null, 2)}\n`;
}

export function importSettings(text: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const wrapper = parsed as { app?: unknown; settings?: unknown } | null;
  if (wrapper === null || typeof wrapper !== 'object' || wrapper.app !== 'benchtop' || wrapper.settings === undefined) {
    throw new Error('That file is not a Benchtop settings export.');
  }
  replaceAll(sanitizeSettings(wrapper.settings));
}

/** Subscribes a component to the settings (or to one derived value). */
export function useSettings<T = Settings>(select?: (settings: Settings) => T): T {
  const pick = (): T => (select ? select(current) : (current as unknown as T));
  const [value, setValue] = useState<T>(pick);
  useEffect(() => {
    const listener = () => setValue(pick());
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}

/* ------------------------------------------------------------------ theme -- */

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Keeps <html data-theme> and the editor font size in step with the settings and the OS. */
export function startThemeSync(): void {
  const apply = () => {
    document.documentElement.dataset.theme = resolveTheme(current.theme);
    document.documentElement.style.setProperty('--editor-font-size', `${current.editorFontSize}px`);
  };
  apply();
  listeners.add(apply);
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}
