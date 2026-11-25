/**
 * Project workspaces: the open project, and where projects are kept (this
 * browser profile's IndexedDB, like the notes).  While a project is open,
 * tools read and save their options in it, files opened in tools are copied
 * into it as inputs, and files saved from tools are copied into it as
 * outputs.  A project leaves the app as one bundle file and comes back the
 * same way.
 */
import { useEffect, useState } from 'preact/hooks';
import { utf8Encode } from '../lib/bytes';
import { type FileRole, freeName, newId, newProject, type OpenedBundle, type Project, type ProjectFile, readBundle, readProject, writeBundle } from '../lib/project-bundle';
import { dependencies, readWorkflow } from '../lib/workflow';
import { loadLibrary, mergeIntoLibrary, saveLibrary } from '../lib/workflow-store';
import { setFileHooks } from '../platform';
import type { Values } from '../tools/types';
import { parseRoute } from './router';
import { setOptionScope } from './store';

const DB = 'benchtop-projects';
const ACTIVE_KEY = 'benchtop.project.active';
/** Files larger than this are not copied into a project automatically. */
export const AUTO_COPY_LIMIT = 64 * 1024 * 1024;

let opening: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Projects need this browser’s storage, which is switched off or full.'));
  });
  return opening;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Storage failed.'));
  });
}

async function store(name: 'projects' | 'files', mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await database()).transaction(name, mode).objectStore(name);
}

const fileKey = (project: string, file: string) => `${project}/${file}`;

export async function listProjects(): Promise<Project[]> {
  const raw = await done((await store('projects', 'readonly')).getAll());
  return raw
    .map(readProject)
    .filter((p): p is Project => p !== null)
    .sort((a, b) => b.modified - a.modified);
}

async function putProject(project: Project): Promise<void> {
  await done((await store('projects', 'readwrite')).put(project));
}

export async function getFileBytes(project: string, file: string): Promise<Uint8Array | null> {
  const found = (await done((await store('files', 'readonly')).get(fileKey(project, file)))) as Blob | ArrayBuffer | undefined;
  if (!found) return null;
  return new Uint8Array(found instanceof Blob ? await found.arrayBuffer() : found);
}

/* --------------------------------------------------- the open project -- */

let active: Project | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Writes the open project soon; many small changes become one write. */
function saveSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (active) void putProject(active).catch(() => undefined);
  }, 400);
}

function setActive(project: Project | null): void {
  clearTimeout(saveTimer);
  active = project;
  try {
    if (project) localStorage.setItem(ACTIVE_KEY, project.id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Without storage the project stays open for this session only.
  }
  setOptionScope(
    project
      ? {
          toolOptions: project.toolOptions,
          onChange: (toolOptions) => {
            if (!active) return;
            active = { ...active, toolOptions: toolOptions as Record<string, Values>, modified: Date.now() };
            saveSoon();
            changed();
          },
        }
      : null,
  );
  changed();
}

export const activeProject = (): Project | null => active;

/** The open project, for components; `null` when none is open. */
export function useActiveProject(): Project | null {
  const [project, setProject] = useState(active);
  useEffect(() => {
    const listener = () => setProject(active);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return project;
}

export async function openProject(id: string | null): Promise<void> {
  if (active) await putProject(active);
  if (id === null) {
    setActive(null);
    return;
  }
  const found = readProject(await done((await store('projects', 'readonly')).get(id)));
  if (!found) throw new Error('That project is no longer here.');
  setActive(found);
}

export async function createProject(name: string): Promise<Project> {
  const project = newProject(name);
  await putProject(project);
  return project;
}

/** Changes a project's name, notes or switches; works on the open project and on closed ones. */
export async function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'notes' | 'collectInputs' | 'collectOutputs'>>): Promise<Project> {
  const current = active?.id === id ? active : readProject(await done((await store('projects', 'readonly')).get(id)));
  if (!current) throw new Error('That project is no longer here.');
  const next: Project = { ...current, ...patch, modified: Date.now() };
  await putProject(next);
  if (active?.id === id) {
    active = next;
    changed();
  }
  return next;
}

export async function deleteProject(id: string): Promise<void> {
  if (active?.id === id) setActive(null);
  const project = readProject(await done((await store('projects', 'readonly')).get(id)));
  const files = await store('files', 'readwrite');
  for (const file of project?.files ?? []) files.delete(fileKey(id, file.id));
  await done((await store('projects', 'readwrite')).delete(id));
}

export interface NewFile {
  readonly name: string;
  readonly data: string | Uint8Array | Blob;
  readonly role: FileRole;
  readonly tool?: string;
  readonly mime?: string;
}

/**
 * Adds files to a project.  A file with the same name, role and size as one
 * already there replaces it (the same file opened or saved again); otherwise
 * a clashing name gets a number.
 */
export async function addFiles(projectId: string, incoming: readonly NewFile[]): Promise<{ project: Project; added: number }> {
  const current = active?.id === projectId ? active : readProject(await done((await store('projects', 'readonly')).get(projectId)));
  if (!current) throw new Error('That project is no longer here.');
  let files = [...current.files];
  const now = Date.now();
  const blobs: [string, Blob][] = [];
  for (const file of incoming) {
    const blob = file.data instanceof Blob ? file.data : new Blob([(typeof file.data === 'string' ? utf8Encode(file.data) : file.data) as BlobPart]);
    const same = files.find((f) => f.role === file.role && f.name === file.name && f.size === blob.size);
    const meta: ProjectFile = {
      id: same?.id ?? newId(),
      name: same?.name ?? freeName(files, file.role, file.name),
      role: file.role,
      size: blob.size,
      ...(file.mime ? { mime: file.mime } : {}),
      ...(file.tool ? { tool: file.tool } : {}),
      added: now,
    };
    files = same ? files.map((f) => (f.id === same.id ? meta : f)) : [...files, meta];
    blobs.push([meta.id, blob]);
  }
  const target = await store('files', 'readwrite');
  for (const [id, blob] of blobs) target.put(blob, fileKey(projectId, id));
  await new Promise<void>((resolve, reject) => {
    target.transaction.oncomplete = () => resolve();
    target.transaction.onerror = () => reject(new Error('The files could not be stored: storage is full.'));
    target.transaction.onabort = () => reject(new Error('The files could not be stored: storage is full.'));
  });
  const latest = active?.id === projectId ? active : current;
  const next: Project = { ...latest, files, modified: now };
  await putProject(next);
  if (active?.id === projectId) {
    active = next;
    changed();
  }
  return { project: next, added: blobs.length };
}

/** Adds files to the open project; resolves with how many were kept. */
export async function addProjectFiles(incoming: readonly NewFile[]): Promise<number> {
  if (!active) return 0;
  return (await addFiles(active.id, incoming)).added;
}

export async function removeFiles(projectId: string, ids: readonly string[]): Promise<Project> {
  const current = active?.id === projectId ? active : readProject(await done((await store('projects', 'readonly')).get(projectId)));
  if (!current) throw new Error('That project is no longer here.');
  const gone = new Set(ids);
  const files = await store('files', 'readwrite');
  for (const id of gone) files.delete(fileKey(projectId, id));
  const next: Project = { ...current, files: current.files.filter((f) => !gone.has(f.id)), modified: Date.now() };
  await putProject(next);
  if (active?.id === projectId) {
    active = next;
    changed();
  }
  return next;
}

/* ---------------------------------------------------------------- bundles -- */

export async function exportBundle(projectId: string): Promise<{ name: string; bytes: Uint8Array }> {
  if (active?.id === projectId) await putProject(active);
  const project = readProject(await done((await store('projects', 'readonly')).get(projectId)));
  if (!project) throw new Error('That project is no longer here.');
  const data = new Map<string, Uint8Array>();
  for (const file of project.files) {
    const bytes = await getFileBytes(projectId, file.id);
    if (bytes) data.set(file.id, bytes);
  }
  // The workflows the project's own workflow runs travel with it.
  const library = loadLibrary();
  const working = readWorkflow((project.toolOptions['file-pipeline'] as Values | undefined)?.workflow);
  const needed = working ? dependencies(working, (id) => library.find((w) => w.id === id)) : [];
  const name = `${project.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'project'}.bproject`;
  return { name, bytes: writeBundle(project, data, needed) };
}

export async function importBundle(bytes: Uint8Array): Promise<Project> {
  const opened: OpenedBundle = readBundle(bytes);
  const files = await store('files', 'readwrite');
  for (const [id, data] of opened.data) files.put(new Blob([data as BlobPart]), fileKey(opened.project.id, id));
  await new Promise<void>((resolve, reject) => {
    files.transaction.oncomplete = () => resolve();
    files.transaction.onerror = () => reject(new Error('The project could not be stored: storage is full.'));
    files.transaction.onabort = () => reject(new Error('The project could not be stored: storage is full.'));
  });
  await putProject(opened.project);
  if (opened.library.length) saveLibrary(mergeIntoLibrary(loadLibrary(), opened.library));
  return opened.project;
}

/* ------------------------------------------------------------------ start -- */

const currentTool = () => {
  const route = parseRoute(location.hash);
  return route.page === 'tool' ? route.id : route.page === 'home' ? 'notes' : undefined;
};

/** Restores the project that was open, and starts copying opened and saved files into it. */
export function startProjects(): void {
  setFileHooks({
    saved: ({ name, bytes, mime }) => {
      if (!active?.collectOutputs || bytes.length > AUTO_COPY_LIMIT) return;
      const tool = currentTool();
      void addProjectFiles([{ name, data: bytes, role: 'output', mime, ...(tool ? { tool } : {}) }]).catch(() => undefined);
    },
    picked: (files) => {
      if (!active?.collectInputs) return;
      const tool = currentTool();
      const small = files.filter((f) => f.size <= AUTO_COPY_LIMIT);
      if (small.length)
        void addProjectFiles(small.map((f) => ({ name: f.name, data: f, role: 'input' as const, ...(f.type ? { mime: f.type } : {}), ...(tool ? { tool } : {}) }))).catch(() => undefined);
    },
  });
  let id: string | null = null;
  try {
    id = localStorage.getItem(ACTIVE_KEY);
  } catch {
    id = null;
  }
  if (id && typeof indexedDB !== 'undefined') void openProject(id).catch(() => setActive(null));
}
