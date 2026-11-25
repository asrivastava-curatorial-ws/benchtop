/**
 * The library of saved workflows, shared by every project: a workflow saved
 * here can be opened again, or run as one step of another workflow.
 */
import { readWorkflow, type Workflow } from './workflow';

const KEY = 'benchtop.workflows.v1';
export const MAX_LIBRARY = 200;

export function loadLibrary(): Workflow[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.map(readWorkflow).filter((w): w is Workflow => w !== null) : [];
  } catch {
    return [];
  }
}

export function saveLibrary(workflows: readonly Workflow[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(workflows.slice(0, MAX_LIBRARY)));
  } catch {
    throw new Error('The workflow could not be saved: this browser’s storage is full or switched off.');
  }
}

/** Adds workflows, replacing any with the same id. */
export function mergeIntoLibrary(library: readonly Workflow[], incoming: readonly Workflow[]): Workflow[] {
  const ids = new Set(incoming.map((w) => w.id));
  return [...library.filter((w) => !ids.has(w.id)), ...incoming];
}
