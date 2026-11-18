/** Unit handling around the solver: what the user types, in the units they chose, to formula units and back. */
import { type Calculator, type ChoiceVar, isChoice, type NumberVar } from './types';
import { convert, findUnit, type Unit, unitsOf } from './units';

export const formulaUnit = (v: NumberVar): Unit => findUnit(v.dim, v.unit);
export const defaultUnit = (v: NumberVar): Unit => findUnit(v.dim, v.show ?? v.unit);

/** The unit the user picked, if it belongs to the variable's dimension. */
export function shownUnit(v: NumberVar, chosen: string | undefined): Unit {
  return (chosen !== undefined ? unitsOf(v.dim).find((u) => u.id === chosen) : undefined) ?? defaultUnit(v);
}

export const toFormula = (v: NumberVar, value: number, unit: Unit): number => convert(value, unit, formulaUnit(v));
export const fromFormula = (v: NumberVar, value: number, unit: Unit): number => convert(value, formulaUnit(v), unit);

export function choiceValue(v: ChoiceVar, index: number | undefined): number {
  const i = index !== undefined && index >= 0 && index < v.choices.length ? index : (v.example ?? 0);
  return v.choices[i]?.value ?? v.choices[0].value;
}

/** The example inputs of a calculator, in formula units. */
export function exampleInputs(calc: Calculator): { given: Record<string, number>; choices: Record<string, number> } {
  const given: Record<string, number> = {};
  const choices: Record<string, number> = {};
  for (const v of calc.vars) {
    if (isChoice(v)) choices[v.key] = choiceValue(v, v.example);
    else if (v.example !== undefined) given[v.key] = toFormula(v, v.example, defaultUnit(v));
  }
  return { given, choices };
}

/** Which band a value falls in (bands hold upper limits in formula units). */
export function bandOf(v: NumberVar, value: number): string | null {
  if (!v.bands || !Number.isFinite(value)) return null;
  for (const [limit, label] of v.bands) if (value < limit) return label;
  return v.bands[v.bands.length - 1]?.[1] ?? null;
}

/** Rounds for display: up to `digits` significant figures, without trailing noise. */
export function roundForDisplay(value: number, digits = 6): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.max(0, Math.min(12, digits - 1 - magnitude));
  return Number(value.toFixed(decimals));
}

export function formatNumber(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return value.toExponential(4).replace(/\.?0+e/, 'e');
  const rounded = roundForDisplay(value, abs >= 1 ? Math.max(6, Math.floor(Math.log10(abs)) + 3) : 6);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 10 }).format(rounded);
}
