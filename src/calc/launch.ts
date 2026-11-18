/** Opens a calculator from search or the command palette, and searches the calculator index. */
import { navigate, toolHref } from '../app/router';
import { CALCULATOR_NAMES } from './names';

export const CALC_OPEN_EVENT = 'benchtop:calculator-open';

let pending: string | null = null;

export const calcToolId = (category: string): string => `calc-${category}`;

export function openCalculator(id: string): void {
  const entry = CALCULATOR_NAMES.find(([key]) => key === id);
  if (!entry) return;
  pending = id;
  window.dispatchEvent(new CustomEvent(CALC_OPEN_EVENT));
  navigate(toolHref(calcToolId(entry[2])));
}

/** The calculator waiting to be shown, cleared once taken. */
export function takePendingCalculator(): string | null {
  const id = pending;
  pending = null;
  return id;
}

export interface CalculatorHit {
  readonly id: string;
  readonly name: string;
  readonly category: string;
}

export function searchCalculators(query: string, limit = 8): CalculatorHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const scored: [number, CalculatorHit][] = [];
  for (const [id, name, category, keywords] of CALCULATOR_NAMES) {
    const lower = name.toLowerCase();
    const words = keywords.toLowerCase().split('|');
    const rank =
      lower === needle
        ? 100
        : lower.startsWith(needle)
          ? 80
          : words.includes(needle)
            ? 75
            : lower.split(/[^a-z0-9₂]+/).some((w) => w.startsWith(needle))
              ? 60
              : words.some((w) => w.startsWith(needle))
                ? 50
                : lower.includes(needle) || words.some((w) => w.includes(needle))
                  ? 30
                  : 0;
    if (rank > 0) scored.push([rank, { id, name, category }]);
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, hit]) => hit);
}
