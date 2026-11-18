/**
 * Saving and loading recipes, compatible with CyberChef: its JSON format
 * ([{"op": "From Base64", "args": [...]}]), its compact "chef" format
 * (From_Base64('A-Za-z0-9+/=',true)Gunzip()) and whole CyberChef URLs.
 */
import { type ArgDef, type Args, defaultArgs, type Operation } from './core';
import type { Step } from './engine';

export interface ParsedRecipe {
  readonly steps: Step[];
  /** Input carried in a CyberChef URL, if any. */
  readonly input?: string;
  /** Names that did not match any operation. */
  readonly unknown: string[];
}

type CyberArg = string | number | boolean | { option: string; string: string } | null;

function toCyberArg(def: ArgDef, args: Args): CyberArg {
  const value = args[def.key] ?? def.default;
  if (def.type === 'keyed') return { option: String(args[`${def.key}.format`] ?? def.format), string: String(value) };
  return value;
}

function fromCyberArg(def: ArgDef, raw: unknown, args: Args): void {
  if (raw === null || raw === undefined) return;
  switch (def.type) {
    case 'boolean':
      if (typeof raw === 'boolean') args[def.key] = raw;
      return;
    case 'number':
      if (typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw)))) args[def.key] = Number(raw);
      return;
    case 'keyed':
      if (typeof raw === 'object') {
        const { option, string } = raw as { option?: unknown; string?: unknown };
        if (typeof string === 'string') args[def.key] = string;
        if (typeof option === 'string') {
          const match = def.formats.find((f) => f.toLowerCase() === option.toLowerCase() || f.toLowerCase().startsWith(option.toLowerCase()));
          if (match) args[`${def.key}.format`] = match;
        }
      } else if (typeof raw === 'string') args[def.key] = raw;
      return;
    case 'select':
      if (typeof raw === 'string' && def.choices.includes(raw)) args[def.key] = raw;
      return;
    default:
      if (typeof raw === 'string') args[def.key] = raw;
  }
}

export function toCyberChefJson(steps: readonly Step[], lookup: (id: string) => Operation | undefined): string {
  const list = steps.map((step) => {
    const op = lookup(step.op);
    const entry: Record<string, unknown> = { op: op?.name ?? step.op, args: op ? op.args.map((def) => toCyberArg(def, step.args)) : [] };
    if (step.disabled) entry.disabled = true;
    if (step.breakpoint) entry.breakpoint = true;
    return entry;
  });
  return JSON.stringify(list, null, 2);
}

/** The compact form CyberChef uses in links: From_Base64('A-Za-z0-9+/=',true)Gunzip(). */
export function toChefFormat(steps: readonly Step[], lookup: (id: string) => Operation | undefined): string {
  const literal = (value: CyberArg): string => {
    if (value === null) return 'null';
    if (typeof value === 'object') return `{'option':${literal(value.option)},'string':${literal(value.string)}}`;
    if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
    return String(value);
  };
  return steps
    .map((step) => {
      const op = lookup(step.op);
      if (!op) return '';
      const args = op.args.map((def) => literal(toCyberArg(def, step.args))).join(',');
      return `${op.name.replace(/ /g, '_')}(${args})${step.disabled ? '/disabled' : ''}${step.breakpoint ? '/breakpoint' : ''}`;
    })
    .join('');
}

function parseChef(text: string): { name: string; args: unknown[]; disabled: boolean; breakpoint: boolean }[] {
  const out: { name: string; args: unknown[]; disabled: boolean; breakpoint: boolean }[] = [];
  let at = 0;
  const skip = () => {
    while (at < text.length && /\s/.test(text[at] as string)) at++;
  };
  const value = (): unknown => {
    skip();
    const ch = text[at];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      at++;
      let s = '';
      while (at < text.length && text[at] !== quote) {
        if (text[at] === '\\') {
          const next = text[at + 1] ?? '';
          s += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
          at += 2;
        } else s += text[at++];
      }
      at++;
      return s;
    }
    if (ch === '{') {
      at++;
      const obj: Record<string, unknown> = {};
      skip();
      while (text[at] !== '}' && at < text.length) {
        const key = value();
        skip();
        at++;
        obj[String(key)] = value();
        skip();
        if (text[at] === ',') at++;
        skip();
      }
      at++;
      return obj;
    }
    if (ch === '[') {
      at++;
      const list: unknown[] = [];
      skip();
      while (text[at] !== ']' && at < text.length) {
        list.push(value());
        skip();
        if (text[at] === ',') at++;
        skip();
      }
      at++;
      return list;
    }
    const m = /^(true|false|null|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i.exec(text.slice(at));
    if (!m) throw new Error(`Unexpected "${ch}" in the recipe.`);
    at += m[0].length;
    const word = m[0].toLowerCase();
    return word === 'true' ? true : word === 'false' ? false : word === 'null' ? null : Number(m[0]);
  };
  while (at < text.length) {
    skip();
    const m = /^([A-Za-z0-9_/.\-+&]+?)\(/.exec(text.slice(at));
    if (!m) break;
    at += m[0].length;
    const args: unknown[] = [];
    skip();
    while (text[at] !== ')' && at < text.length) {
      args.push(value());
      skip();
      if (text[at] === ',') at++;
      skip();
    }
    at++;
    let disabled = false;
    let breakpoint = false;
    for (;;) {
      if (text.startsWith('/disabled', at)) {
        disabled = true;
        at += 9;
      } else if (text.startsWith('/breakpoint', at)) {
        breakpoint = true;
        at += 11;
      } else break;
    }
    out.push({ name: (m[1] as string).replace(/_/g, ' '), args, disabled, breakpoint });
  }
  return out;
}

export function parseRecipe(text: string, find: (name: string) => Operation | undefined): ParsedRecipe {
  let source = text.trim();
  let input: string | undefined;
  if (/^https?:\/\//i.test(source) || source.startsWith('#recipe=') || source.includes('recipe=')) {
    const hash = source.includes('#') ? source.slice(source.indexOf('#') + 1) : source.slice(source.indexOf('?') + 1);
    const params = new URLSearchParams(hash);
    source = params.get('recipe') ?? source;
    const encoded = params.get('input');
    if (encoded) {
      try {
        input = new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
      } catch {
        input = undefined;
      }
    }
  }
  let items: { name: string; args: unknown[]; disabled: boolean; breakpoint: boolean }[];
  if (source.startsWith('[') || source.startsWith('{')) {
    const parsed = JSON.parse(source) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    items = list.map((item) => {
      const entry = item as { op?: unknown; args?: unknown; disabled?: unknown; breakpoint?: unknown };
      return { name: String(entry.op ?? ''), args: Array.isArray(entry.args) ? entry.args : [], disabled: entry.disabled === true, breakpoint: entry.breakpoint === true };
    });
  } else items = parseChef(source);
  const unknown: string[] = [];
  const steps: Step[] = [];
  for (const item of items) {
    const op = find(item.name);
    if (!op) {
      unknown.push(item.name);
      continue;
    }
    const args = defaultArgs(op);
    for (const [i, def] of op.args.entries()) fromCyberArg(def, item.args[i], args);
    steps.push({ op: op.id, args, disabled: item.disabled || undefined, breakpoint: item.breakpoint || undefined });
  }
  return { steps, input, unknown };
}
