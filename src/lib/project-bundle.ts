/**
 * Projects keep the files of one job together with the settings of the tools
 * used on them and the state of its workflow.  A project travels as one
 * bundle file (a ZIP with a manifest): the input files, the outputs kept from
 * each tool, the intermediate outputs of workflow runs, every tool's options
 * and the workflows the project runs.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Values } from '../tools/types';
import { readWorkflow, safePath, type Workflow } from './workflow';

export type FileRole = 'input' | 'output' | 'intermediate';
export const ROLES: readonly FileRole[] = ['input', 'output', 'intermediate'];
export const ROLE_LABELS: Record<FileRole, string> = { input: 'Input files', output: 'Outputs', intermediate: 'Intermediate outputs' };

export interface ProjectFile {
  readonly id: string;
  /** May carry folders, as in "Split (out)/part-1.txt". */
  readonly name: string;
  readonly role: FileRole;
  readonly size: number;
  readonly mime?: string;
  /** The tool the file was opened in or saved from. */
  readonly tool?: string;
  readonly added: number;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly created: number;
  readonly modified: number;
  readonly notes: string;
  readonly files: readonly ProjectFile[];
  /** Tool id → that tool's options, as each tool stores them. */
  readonly toolOptions: Readonly<Record<string, Values>>;
  /** Keep a copy of files opened in tools while the project is open. */
  readonly collectInputs: boolean;
  /** Keep a copy of everything saved from tools while the project is open. */
  readonly collectOutputs: boolean;
}

export const MANIFEST = 'benchtop-project.json';
export const BUNDLE_EXTENSION = 'bproject';
/** The most a bundle may unpack to. */
export const MAX_BUNDLE = 1024 * 1024 * 1024;
export const MAX_FILES = 20_000;

let counter = 0;
export function newId(): string {
  counter += 1;
  const random =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto ? [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36)).join('') : Math.floor(Math.random() * 1e9).toString(36);
  return `${Date.now().toString(36)}${counter.toString(36)}${random}`.slice(0, 20);
}

export function newProject(name: string, now = Date.now()): Project {
  return { id: newId(), name: cleanName(name), created: now, modified: now, notes: '', files: [], toolOptions: {}, collectInputs: true, collectOutputs: true };
}

export const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled project';

/** A name no other file of the same role has: "a.txt", "a (2).txt", … */
export function freeName(files: readonly ProjectFile[], role: FileRole, wanted: string): string {
  const name = safePath(wanted);
  const taken = new Set(files.filter((f) => f.role === role).map((f) => f.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const slash = name.lastIndexOf('/');
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > slash + 1 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function readOptions(raw: unknown): Record<string, Values> {
  const out: Record<string, Values> = {};
  if (!isRecord(raw)) return out;
  for (const [id, values] of Object.entries(raw)) if (/^[a-z0-9-]{1,80}$/.test(id) && isRecord(values)) out[id] = values as Values;
  return out;
}

/** A project from storage or a bundle's manifest; anything malformed is dropped. */
export function readProject(raw: unknown): Project | null {
  if (!isRecord(raw)) return null;
  const time = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
  const now = Date.now();
  const files: ProjectFile[] = [];
  const seen = new Set<string>();
  for (const f of Array.isArray(raw.files) ? raw.files.slice(0, MAX_FILES) : []) {
    if (!isRecord(f) || typeof f.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(f.id) || seen.has(f.id) || typeof f.name !== 'string') continue;
    seen.add(f.id);
    const role = ROLES.includes(f.role as FileRole) ? (f.role as FileRole) : 'input';
    files.push({
      id: f.id,
      name: freeName(files, role, f.name),
      role,
      size: typeof f.size === 'number' && f.size >= 0 ? f.size : 0,
      ...(typeof f.mime === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(f.mime) ? { mime: f.mime } : {}),
      ...(typeof f.tool === 'string' && /^[a-z0-9-]{1,80}$/.test(f.tool) ? { tool: f.tool } : {}),
      added: time(f.added, now),
    });
  }
  return {
    id: typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : newId(),
    name: cleanName(typeof raw.name === 'string' ? raw.name : ''),
    created: time(raw.created, now),
    modified: time(raw.modified, now),
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 20_000) : '',
    files,
    toolOptions: readOptions(raw.toolOptions),
    collectInputs: raw.collectInputs !== false,
    collectOutputs: raw.collectOutputs !== false,
  };
}

const pathOf = (file: ProjectFile) => `files/${file.role}/${file.name}`;

/** One bundle file holding the project, its files and the workflows it runs. */
export function writeBundle(project: Project, data: ReadonlyMap<string, Uint8Array>, library: readonly Workflow[] = []): Uint8Array {
  const files = project.files.filter((f) => data.has(f.id));
  const manifest = {
    benchtop: 'project',
    version: 1,
    project: { ...project, files: files.map((f) => ({ ...f, path: pathOf(f) })) },
    library,
  };
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = { [MANIFEST]: strToU8(`${JSON.stringify(manifest, null, 2)}\n`) };
  for (const file of files) {
    const bytes = data.get(file.id) as Uint8Array;
    // Pictures, archives and media are compressed already.
    const packed = /\.(png|jpe?g|webp|avif|gif|zip|gz|7z|mp[34]|m4a|webm|mkv|pdf|docx|xlsx|pptx|epub)$/i.test(file.name);
    entries[pathOf(file)] = [bytes, { level: packed ? 0 : 6 }];
  }
  return zipSync(entries);
}

export interface OpenedBundle {
  /** The project under a new id, so opening a bundle twice makes two projects. */
  readonly project: Project;
  readonly data: Map<string, Uint8Array>;
  readonly library: Workflow[];
}

export function readBundle(bytes: Uint8Array): OpenedBundle {
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        if (total > MAX_BUNDLE) throw new Error('too-large');
        return file.name === MANIFEST || file.name.startsWith('files/');
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'too-large') throw new Error('This bundle unpacks to more than 1 GB, which is more than a project may hold.');
    throw new Error('This file is not a project bundle (it is not a ZIP archive).');
  }
  const manifestBytes = entries[MANIFEST];
  if (!manifestBytes) throw new Error(`This ZIP is not a Benchtop project: it has no ${MANIFEST}.`);
  let manifest: unknown;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new Error('The project’s manifest is damaged (it is not JSON).');
  }
  if (!isRecord(manifest) || manifest.benchtop !== 'project' || !isRecord(manifest.project)) throw new Error('This ZIP is not a Benchtop project.');
  if (typeof manifest.version === 'number' && manifest.version > 1) throw new Error('This project was saved by a newer version of Benchtop. Update Benchtop to open it.');
  const rawFiles = Array.isArray(manifest.project.files) ? manifest.project.files : [];
  const paths = new Map<string, string>();
  for (const f of rawFiles) if (isRecord(f) && typeof f.id === 'string' && typeof f.path === 'string') paths.set(f.id, f.path);
  const read = readProject(manifest.project);
  if (!read) throw new Error('This ZIP is not a Benchtop project.');
  const data = new Map<string, Uint8Array>();
  const files: ProjectFile[] = [];
  for (const file of read.files) {
    const found = entries[paths.get(file.id) ?? ''];
    // A file the manifest lists but the archive lacks is left out.
    if (!found) continue;
    const id = newId();
    data.set(id, found);
    files.push({ ...file, id, size: found.length });
  }
  const library = (Array.isArray(manifest.library) ? manifest.library.slice(0, 200) : []).map(readWorkflow).filter((w): w is Workflow => w !== null);
  return { project: { ...read, id: newId(), files }, data, library };
}

/** Total size of a project's files, in bytes. */
export const projectSize = (project: Project) => project.files.reduce((sum, f) => sum + f.size, 0);
