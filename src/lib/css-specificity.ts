/**
 * Selector specificity as defined in Selectors Level 4: IDs, then classes,
 * attributes and pseudo-classes, then types and pseudo-elements.  :is(),
 * :not() and :has() take their most specific argument, :where() counts
 * nothing, and :nth-child(… of S) adds its selector list.
 */
export type Specificity = readonly [number, number, number];

const LEGACY_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
const TAKES_MAX = new Set(['is', 'not', 'has', 'matches', '-webkit-any', '-moz-any']);

export const compareSpecificity = (x: Specificity, y: Specificity): number => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

/** Splits a selector list on commas outside brackets and strings. */
export function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i] as string;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '\\') i++;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

export function maxSpecificity(list: string): Specificity {
  let best: Specificity = [0, 0, 0];
  for (const selector of splitSelectors(list)) {
    const value = specificity(selector).value;
    if (compareSpecificity(value, best) > 0) best = value;
  }
  return best;
}

export interface SpecificityResult {
  readonly value: Specificity;
  /** The selector uses & (nesting), whose weight comes from the parent rule. */
  readonly nested: boolean;
}

export function specificity(selector: string): SpecificityResult {
  let a = 0;
  let b = 0;
  let c = 0;
  let nested = false;
  let i = 0;
  const s = selector;
  const n = s.length;
  const add = ([x, y, z]: Specificity) => {
    a += x;
    b += y;
    c += z;
  };
  const isIdent = (ch: string | undefined) => ch !== undefined && (/[\w-]/.test(ch) || ch.charCodeAt(0) > 127);
  const ident = (): string => {
    let out = '';
    while (i < n) {
      const ch = s[i] as string;
      if (ch === '\\') {
        out += s.slice(i, i + 2);
        i += 2;
      } else if (isIdent(ch)) {
        out += ch;
        i++;
      } else break;
    }
    return out;
  };
  /** Reads a bracketed argument starting at "(" and returns what is inside. */
  const group = (): string => {
    let depth = 0;
    let quote = '';
    const start = i;
    for (; i < n; i++) {
      const ch = s[i] as string;
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) {
        i++;
        return s.slice(start + 1, i - 1);
      }
    }
    return s.slice(start + 1);
  };

  while (i < n) {
    const ch = s[i] as string;
    if (ch === '#') {
      i++;
      ident();
      a++;
    } else if (ch === '.') {
      i++;
      ident();
      b++;
    } else if (ch === '[') {
      let quote = '';
      for (; i < n; i++) {
        const k = s[i] as string;
        if (quote) {
          if (k === '\\') i++;
          else if (k === quote) quote = '';
        } else if (k === '"' || k === "'") quote = k;
        else if (k === ']') {
          i++;
          break;
        }
      }
      b++;
    } else if (ch === ':') {
      const element = s[i + 1] === ':';
      i += element ? 2 : 1;
      const name = ident().toLowerCase();
      const args = s[i] === '(' ? group() : null;
      if (element || LEGACY_ELEMENTS.has(name)) {
        c++;
        if (name === 'slotted' && args) add(maxSpecificity(args));
      } else if (name === 'where') {
        // counts nothing
      } else if (TAKES_MAX.has(name)) {
        if (args) add(maxSpecificity(args));
      } else if ((name === 'nth-child' || name === 'nth-last-child') && args) {
        b++;
        const of = /\sof\s([\s\S]+)$/i.exec(args);
        if (of) add(maxSpecificity(of[1] as string));
      } else if ((name === 'host' || name === 'host-context') && args) {
        b++;
        add(maxSpecificity(args));
      } else b++;
    } else if (ch === '*') {
      i++;
      if (s[i] === '|') i++;
    } else if (ch === '&') {
      nested = true;
      i++;
    } else if (isIdent(ch) || ch === '\\') {
      ident();
      // "svg|circle": the namespace prefix does not count, the type after it does.
      if (s[i] === '|' && s[i + 1] !== '|') i++;
      else c++;
    } else i++;
  }
  return { value: [a, b, c], nested };
}
