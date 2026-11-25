/**
 * Where notes live between sessions: IndexedDB in the app's own storage.
 * Notes (JSON) and their files (Blobs) are kept apart, so typing saves only
 * the small note and a file is written once, however often it is used.
 */
import { type Attachment, type Note, readNote, referencedFiles } from './notes-format';

const DB = 'benchtop-notes';
const VERSION = 1;

interface StoredFile {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly blob: Blob;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This window cannot store notes (no IndexedDB).'));
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error ?? new Error('The notes storage could not be opened.'));
    };
  });
  return opening;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(friendly(request.error));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(friendly(tx.error));
    tx.onabort = () => reject(friendly(tx.error));
  });
}

function friendly(error: DOMException | null): Error {
  if (error?.name === 'QuotaExceededError') return new Error('There is no more room to store notes. Delete large files from notes, or export notes and remove them.');
  return new Error(error?.message || 'The notes storage failed.');
}

export async function listNotes(): Promise<Note[]> {
  const db = await open();
  const all = await done(db.transaction('notes').objectStore('notes').getAll());
  return all.map((n) => readNote(n)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.modified.localeCompare(a.modified));
}

export async function saveNote(note: Note): Promise<void> {
  const db = await open();
  const tx = db.transaction('notes', 'readwrite');
  tx.objectStore('notes').put(note);
  await finished(tx);
}

/** Deletes a note, then any file no other note uses. */
export async function deleteNote(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction('notes', 'readwrite');
  tx.objectStore('notes').delete(id);
  await finished(tx);
  await collectFiles();
}

/** Removes files that no note refers to any more. */
export async function collectFiles(): Promise<number> {
  const db = await open();
  const notes = await done(db.transaction('notes').objectStore('notes').getAll());
  const used = new Set<string>();
  for (const n of notes) for (const id of referencedFiles(readNote(n).blocks)) used.add(id);
  const keys = (await done(db.transaction('files').objectStore('files').getAllKeys())) as string[];
  const unused = keys.filter((k) => !used.has(k));
  if (unused.length) {
    const tx = db.transaction('files', 'readwrite');
    for (const k of unused) tx.objectStore('files').delete(k);
    await finished(tx);
  }
  return unused.length;
}

export async function putFile(attachment: Attachment, blob: Blob): Promise<void> {
  const db = await open();
  const existing = await done(db.transaction('files').objectStore('files').getKey(attachment.id));
  if (existing !== undefined) return;
  const tx = db.transaction('files', 'readwrite');
  tx.objectStore('files').put({ ...attachment, blob } satisfies StoredFile);
  await finished(tx);
}

export async function getFile(id: string): Promise<Blob | null> {
  const db = await open();
  const stored = (await done(db.transaction('files').objectStore('files').get(id))) as StoredFile | undefined;
  return stored?.blob ?? null;
}

/** Bytes of every file a note uses, for exporting it. */
export async function noteFiles(note: Note): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const a of note.attachments) {
    const blob = await getFile(a.id);
    if (blob) out.set(a.id, new Uint8Array(await blob.arrayBuffer()));
  }
  return out;
}

/** How much the notes take up, as far as the browser engine reports it. */
export async function storageUse(): Promise<{ used: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return usage !== undefined && quota !== undefined ? { used: usage, quota } : null;
}

let wanted: string | null = null;

/** Asks the Notes tool to open on one note the next time it starts (Offline Search uses this). */
export function wantNote(id: string): void {
  wanted = id;
}

export function takeWantedNote(): string | null {
  const id = wanted;
  wanted = null;
  return id;
}
