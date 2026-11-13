/**
 * Helpers for working with declarative option definitions: default values,
 * validation of persisted/untrusted values, and stripping of secrets.
 */
import type { Choice, OptionDef, SelectOption, Values } from './types';

export function choicesOf(def: SelectOption): Choice[] {
  const raw = typeof def.choices === 'function' ? def.choices() : def.choices;
  return raw.map((choice) => (typeof choice === 'string' ? { value: choice, label: choice } : choice));
}

export function defaultsOf(defs: readonly OptionDef[]): Values {
  const out: Values = {};
  for (const def of defs) {
    if (def.type === 'heading') continue;
    out[def.key] = def.type === 'list' ? def.default.map((item) => sanitizeValues(def.item, item)) : def.default;
  }
  return out;
}

function clampNumber(value: number, min: number | undefined, max: number | undefined): number {
  let out = value;
  if (min !== undefined && out < min) out = min;
  if (max !== undefined && out > max) out = max;
  return out;
}

/**
 * Returns a complete, valid values object: every key from `defs` is present
 * and has the right type.  Unknown keys and invalid values in `raw` are
 * replaced by defaults, so stale persisted state can never break a tool.
 */
export function sanitizeValues(defs: readonly OptionDef[], raw: unknown): Values {
  const source = raw !== null && typeof raw === 'object' ? (raw as Values) : {};
  const out: Values = {};
  for (const def of defs) {
    if (def.type === 'heading') continue;
    const value = source[def.key];
    switch (def.type) {
      case 'toggle':
        out[def.key] = typeof value === 'boolean' ? value : def.default;
        break;
      case 'number':
      case 'range':
        out[def.key] = typeof value === 'number' && Number.isFinite(value) ? clampNumber(value, def.min, def.max) : def.default;
        break;
      case 'select':
      case 'segmented': {
        const valid = typeof value === 'string' && choicesOf(def).some((choice) => choice.value === value);
        out[def.key] = valid ? value : def.default;
        break;
      }
      case 'text':
      case 'color':
        out[def.key] = typeof value === 'string' ? value : def.default;
        break;
      case 'list': {
        if (Array.isArray(value)) {
          let items = value.map((item) => sanitizeValues(def.item, item));
          if (def.max !== undefined) items = items.slice(0, def.max);
          const min = def.min ?? 0;
          out[def.key] = items.length >= min ? items : def.default.map((item) => sanitizeValues(def.item, item));
        } else {
          out[def.key] = def.default.map((item) => sanitizeValues(def.item, item));
        }
        break;
      }
    }
  }
  return out;
}

/** Removes secret option values (passwords, keys) before values are persisted. */
export function stripSecrets(defs: readonly OptionDef[], values: Values): Values {
  const out: Values = {};
  for (const def of defs) {
    if (def.type === 'heading') continue;
    const value = values[def.key];
    if (def.type === 'text' && def.secret) continue;
    if (def.type === 'list' && Array.isArray(value)) {
      out[def.key] = value.map((item) => stripSecrets(def.item, item as Values));
    } else {
      out[def.key] = value;
    }
  }
  return out;
}

/** A new list item filled with the defaults of the item definition. */
export function newListItem(defs: readonly OptionDef[]): Values {
  return defaultsOf(defs);
}
