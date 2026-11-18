/** Opens the Recipe tool with an operation added, from search or the command palette. */
import { navigate, toolHref } from '../app/router';
import { OPERATION_NAMES } from './names';

export const RECIPE_TOOL_ID = 'recipe';
export const RECIPE_ADD_EVENT = 'benchtop:recipe-add';

let pending: string | null = null;

export function openRecipeOperation(id: string): void {
  pending = id;
  window.dispatchEvent(new CustomEvent(RECIPE_ADD_EVENT));
  navigate(toolHref(RECIPE_TOOL_ID));
}

/** The operation waiting to be added, cleared once taken. */
export function takePendingOperation(): string | null {
  const id = pending;
  pending = null;
  return id;
}

export interface OperationHit {
  readonly id: string;
  readonly name: string;
  readonly category: string;
}

export function searchOperations(query: string, limit = 8): OperationHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const scored: [number, OperationHit][] = [];
  for (const [id, name, category] of OPERATION_NAMES) {
    const lower = name.toLowerCase();
    const rank = lower === needle ? 100 : lower.startsWith(needle) ? 80 : lower.split(/[^a-z0-9]+/).some((w) => w.startsWith(needle)) ? 60 : lower.includes(needle) ? 40 : 0;
    if (rank > 0) scored.push([rank, { id, name, category }]);
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, hit]) => hit);
}
