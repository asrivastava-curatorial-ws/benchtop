/** Options and helpers shared by the engineering calculators. */
import type { Field, Values } from '../types';

export const PHASE = {
  key: 'phase',
  label: 'Supply',
  type: 'segmented',
  choices: [
    { value: '3', label: 'Three-phase' },
    { value: '1', label: 'Single-phase' },
    { value: 'dc', label: 'DC' },
  ],
  default: '3',
} as const;

export const VOLTAGE = { key: 'volts', label: 'Voltage (line to line for three-phase)', type: 'number', default: 415, min: 1, max: 1000000, step: 1, unit: 'V' } as const;

export const PF = { key: 'pf', label: 'Power factor', type: 'number', default: 0.85, min: 0.1, max: 1, step: 0.01, showIf: (v: Values) => v.phase !== 'dc' } as const;

export const STANDARD = {
  key: 'standard',
  label: 'Standard',
  type: 'segmented',
  choices: [
    { value: 'iec', label: 'IEC (mm²)' },
    { value: 'nec', label: 'NEC (AWG)' },
  ],
  default: 'iec',
} as const;

/** One ton of refrigeration in watts. */
export const TR = 3516.85;

export const ESTIMATE = 'Screening estimate: check against the code and the manufacturer’s data before ordering or installing.';

export const heading = (label: string): Field => ({ label, value: '' });

/** "1.23 kW" with sensible digits. */
export const num = (value: number, digits = 2): string => (Number.isFinite(value) ? Number(value.toFixed(digits)).toLocaleString('en-IN', { maximumFractionDigits: digits }) : '—');

/** "2 min 05 s", "1 h 05 min" or "45 s". */
export function duration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const seconds = Math.round(minutes * 60);
  if (seconds < 60) return `${seconds} s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours > 0 ? `${hours} h ${mins.toString().padStart(2, '0')} min` : `${mins} min ${secs.toString().padStart(2, '0')} s`;
}
