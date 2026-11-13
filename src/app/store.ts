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

function commit(next: Settings): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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

export function resetSettings(): void {
  commit(DEFAULT_SETTINGS);
}

export function exportSettings(): string {
  return `${JSON.stringify({ app: 'benchtop', version: 1, settings: current }, null, 2)}\n`;
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
  commit(sanitizeSettings(wrapper.settings));
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
