/** Short ways to declare calculator variables. */
import type { ChoiceVar, NumberVar } from '../types';
import type { Dimension } from '../units';

type Extra = Partial<Omit<NumberVar, 'key' | 'label' | 'dim' | 'unit'>>;

export const num = (key: string, label: string, dim: Dimension, unit: string, extra: Extra = {}): NumberVar => ({ key, label, dim, unit, ...extra });
export const money = (key: string, label: string, example?: number, extra: Extra = {}): NumberVar => num(key, label, 'money', 'money', { example, ...extra });
/** A rate or share: fractions in formulas, shown in per cent. */
export const pct = (key: string, label: string, example?: number, extra: Extra = {}): NumberVar => num(key, label, 'ratio', '×', { show: '%', example, ...extra });
export const count = (key: string, label: string, example?: number, extra: Extra = {}): NumberVar => num(key, label, 'count', '', { example, ...extra });
export const plain = (key: string, label: string, example?: number, extra: Extra = {}): NumberVar => num(key, label, 'none', '', { example, ...extra });
export const years = (key: string, label: string, example?: number, extra: Extra = {}): NumberVar => num(key, label, 'time', 'yr', { example, ...extra });
export const choice = (key: string, label: string, choices: readonly (readonly [string, number])[], example = 0, help?: string): ChoiceVar => ({
  key,
  label,
  choices: choices.map(([label, value]) => ({ label, value })),
  example,
  help,
});
