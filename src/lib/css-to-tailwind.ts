/**
 * Translates CSS rules into Tailwind CSS (v4) utility classes.
 *
 * The converter favours fidelity over cleverness: a declaration becomes a
 * named utility only when that utility produces exactly the same CSS.
 * Everything else is emitted as an arbitrary value (`w-[13px]`) or an
 * arbitrary property (`[mask-type:luminance]`), both of which Tailwind
 * compiles back to the original declaration - so the result is always valid.
 */
import { generate, parse } from 'css-tree';
import palette from 'tailwindcss/colors';
import { alphaOf, colorDistance, hexOf, isColor, trimNumber } from './color';
import { ToolError } from './errors';

export interface TailwindOptions {
  /** Use the nearest palette colour when it is perceptually very close (this maps v3 hex values to v4 names). */
  readonly snapColors: boolean;
}

export interface TailwindGroup {
  readonly selector: string;
  readonly classes: string[];
}

export interface TailwindResult {
  readonly groups: TailwindGroup[];
  readonly skipped: string[];
  /** Parts of the input the CSS parser could not understand (they are left out). */
  readonly problems: string[];
  readonly declarations: number;
  readonly arbitrary: number;
}

/* ---------------------------------------------------------------- helpers -- */

/** Splits on a separator that is outside brackets and quotes. */
export function splitTop(value: string, separator = ' '): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const ch of value) {
    if (quote !== '') {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === separator && depth === 0) {
      if (current !== '' || separator !== ' ') parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current !== '' || (separator !== ' ' && parts.length > 0)) parts.push(current);
  return parts.map((part) => part.trim());
}

/** Encodes a CSS value for use inside `[...]`: spaces become `_`, real underscores are escaped. */
function bracket(value: string): string {
  return `[${value.trim().replace(/_/g, '\\_').replace(/\s+/g, '_')}]`;
}

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem)?$/;

interface Token {
  readonly negative: boolean;
  readonly text: string;
  readonly arbitrary: boolean;
}

const FRACTIONS: [number, string][] = [
  [50, '1/2'],
  [100 / 3, '1/3'],
  [200 / 3, '2/3'],
  [25, '1/4'],
  [75, '3/4'],
  [20, '1/5'],
  [40, '2/5'],
  [60, '3/5'],
  [80, '4/5'],
  [100 / 6, '1/6'],
  [500 / 6, '5/6'],
  [100 / 12, '1/12'],
  [500 / 12, '5/12'],
  [700 / 12, '7/12'],
  [1100 / 12, '11/12'],
];

/** A value on Tailwind's spacing scale (multiples of 0.25rem), or an arbitrary value. */
function spacing(value: string, extra: Record<string, string> = {}): Token {
  const known = extra[value];
  if (known !== undefined) return { negative: false, text: known, arbitrary: false };
  const match = LENGTH.exec(value);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (amount === 0) return { negative: false, text: '0', arbitrary: false };
    if (unit === 'px' && Math.abs(amount) === 1) return { negative: amount < 0, text: 'px', arbitrary: false };
    if (unit !== undefined) {
      const steps = unit === 'px' ? Math.abs(amount) / 4 : Math.abs(amount) * 4;
      if (Number.isInteger(steps * 4) && steps <= 400) return { negative: amount < 0, text: trimNumber(steps, 2), arbitrary: false };
    }
  }
  return { negative: false, text: bracket(value), arbitrary: true };
}

function fraction(value: string): string | undefined {
  const match = /^(\d+\.?\d*)%$/.exec(value);
  if (!match) return undefined;
  const percent = Number(match[1]);
  if (percent === 100) return 'full';
  return FRACTIONS.find(([target]) => Math.abs(target - percent) < 0.01)?.[1];
}

const cls = (prefix: string, token: Token): string => `${token.negative ? '-' : ''}${prefix}-${token.text}`;

/* ----------------------------------------------------------------- colours -- */

const PALETTE = new Map<string, string>();
for (const [family, shades] of Object.entries(palette)) {
  if (typeof shades !== 'object' || shades === null) continue;
  for (const [shade, value] of Object.entries(shades)) {
    if (typeof value === 'string' && isColor(value)) PALETTE.set(hexOf(value), `${family}-${shade}`);
  }
}

function colorName(value: string, options: TailwindOptions): { name: string; arbitrary: boolean } {
  const lower = value.toLowerCase();
  if (lower === 'transparent') return { name: 'transparent', arbitrary: false };
  if (lower === 'currentcolor') return { name: 'current', arbitrary: false };
  if (lower === 'inherit') return { name: 'inherit', arbitrary: false };
  if (!isColor(value)) return { name: bracket(value), arbitrary: true };
  const hex = hexOf(value);
  const alpha = alphaOf(value);
  let name = hex === '#000000' ? 'black' : hex === '#ffffff' ? 'white' : PALETTE.get(hex);
  if (name === undefined && options.snapColors) {
    let best = Number.POSITIVE_INFINITY;
    for (const [candidate, candidateName] of PALETTE) {
      const distance = colorDistance(hex, candidate);
      if (distance < best) {
        best = distance;
        name = candidateName;
      }
    }
    // 0.04 in OKLab is small enough to stay on the same shade, and large enough to map the
    // Tailwind v3 hex palette onto the slightly more vivid v4 colours of the same name.
    if (best > 0.04) name = undefined;
  }
  const percent = alpha * 100;
  if (name !== undefined && (alpha >= 1 || Math.abs(percent - Math.round(percent)) < 1e-6)) {
    return { name: alpha >= 1 ? name : `${name}/${Math.round(percent)}`, arbitrary: false };
  }
  return { name: bracket(value), arbitrary: true };
}

/* ------------------------------------------------------------ declarations -- */

interface Context {
  readonly options: TailwindOptions;
  /** Other properties declared in the same rule. */
  readonly siblings: Set<string>;
}

type Mapper = (value: string, context: Context) => string[] | null;

const keyword =
  (map: Record<string, string>): Mapper =>
  (value) => {
    const found = map[value];
    return found === undefined ? null : [found];
  };

const prefixed =
  (prefix: string, allowed: readonly string[]): Mapper =>
  (value) =>
    allowed.includes(value) ? [`${prefix}-${value}`] : null;

const space =
  (prefix: string, extra: Record<string, string> = {}): Mapper =>
  (value) => [cls(prefix, spacing(value, extra))];

const SIZE_KEYWORDS: Record<string, string> = { auto: 'auto', 'min-content': 'min', 'max-content': 'max', 'fit-content': 'fit' };

const size =
  (prefix: string, axis: 'w' | 'h'): Mapper =>
  (value) => {
    const viewport = axis === 'w' ? { '100vw': 'screen', '100dvw': 'dvw', '100svw': 'svw', '100lvw': 'lvw' } : { '100vh': 'screen', '100dvh': 'dvh', '100svh': 'svh', '100lvh': 'lvh' };
    const named = ({ ...SIZE_KEYWORDS, ...viewport, none: prefix.startsWith('max') ? 'none' : undefined } as Record<string, string | undefined>)[value];
    if (named !== undefined) return [`${prefix}-${named}`];
    const part = fraction(value);
    if (part !== undefined) return [`${prefix}-${part}`];
    return [cls(prefix, spacing(value))];
  };

/** Expands a 1-4 value box shorthand into top/right/bottom/left. */
function boxSides(value: string): [string, string, string, string] | null {
  const parts = splitTop(value);
  if (parts.length < 1 || parts.length > 4) return null;
  const [a, b = a, c = a, d = b] = parts as [string, string?, string?, string?];
  return [a, b, c, d];
}

const box =
  (prefix: string, extra: Record<string, string> = {}): Mapper =>
  (value) => {
    const sides = boxSides(value);
    if (!sides) return null;
    const [top, right, bottom, left] = sides.map((side) => spacing(side, extra)) as [Token, Token, Token, Token];
    const same = (x: Token, y: Token) => x.text === y.text && x.negative === y.negative;
    if (same(top, right) && same(top, bottom) && same(top, left)) return [cls(prefix, top)];
    if (same(top, bottom) && same(left, right)) return [cls(`${prefix}y`, top), cls(`${prefix}x`, left)];
    return [cls(`${prefix}t`, top), cls(`${prefix}r`, right), cls(`${prefix}b`, bottom), cls(`${prefix}l`, left)];
  };

const color =
  (prefix: string, hint = false): Mapper =>
  (value, context) => {
    const { name, arbitrary } = colorName(value, context.options);
    // `text-[var(--x)]` would be read as a font size, so arbitrary non-colour values need a type hint.
    if (arbitrary && hint && !isColor(value)) return [`${prefix}-[color:${name.slice(1)}`];
    return [`${prefix}-${name}`];
  };

const RADIUS: Record<string, string> = {
  '0': 'none',
  '0px': 'none',
  '2px': 'xs',
  '.125rem': 'xs',
  '0.125rem': 'xs',
  '4px': 'sm',
  '.25rem': 'sm',
  '0.25rem': 'sm',
  '6px': 'md',
  '.375rem': 'md',
  '0.375rem': 'md',
  '8px': 'lg',
  '.5rem': 'lg',
  '0.5rem': 'lg',
  '12px': 'xl',
  '.75rem': 'xl',
  '0.75rem': 'xl',
  '16px': '2xl',
  '1rem': '2xl',
  '24px': '3xl',
  '1.5rem': '3xl',
  '32px': '4xl',
  '2rem': '4xl',
  '9999px': 'full',
};

const radius =
  (prefix: string): Mapper =>
  (value) => {
    if (splitTop(value).length !== 1 || value.includes('/')) return [`${prefix}-${bracket(value)}`];
    return [`${prefix}-${RADIUS[value] ?? bracket(value)}`];
  };

const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'hidden', 'none'];
const BORDER_WIDTHS: Record<string, string> = { '0': '-0', '0px': '-0', '1px': '', '2px': '-2', '4px': '-4', '8px': '-8' };

function borderWidth(prefix: string, value: string): string {
  const known = BORDER_WIDTHS[value];
  return known !== undefined ? `${prefix}${known}` : `${prefix}-${bracket(value)}`;
}

const border =
  (side: string): Mapper =>
  (value, context) => {
    const prefix = side === '' ? 'border' : `border-${side}`;
    if (value === 'none') return side === '' ? ['border-none'] : [`${prefix}-0`];
    if (value === '0' || value === '0px') return [`${prefix}-0`];
    const out: string[] = [];
    let width: string | undefined;
    for (const part of splitTop(value)) {
      if (BORDER_STYLES.includes(part)) {
        if (part !== 'solid') out.push(`border-${part}`);
      } else if (/^(-?[\d.]+(px|rem|em)|thin|medium|thick)$/.test(part)) {
        if (/^(thin|medium|thick)$/.test(part)) return null;
        width = part;
      } else {
        out.push(`${prefix}-${colorName(part, context.options).name}`);
      }
    }
    // The shorthand resets the width to "medium" when it is omitted, which no utility expresses.
    if (width === undefined) return null;
    return [borderWidth(prefix, width), ...out];
  };

const FONT_SIZES: Record<string, string> = {
  '12px': 'xs',
  '.75rem': 'xs',
  '0.75rem': 'xs',
  '14px': 'sm',
  '.875rem': 'sm',
  '0.875rem': 'sm',
  '16px': 'base',
  '1rem': 'base',
  '18px': 'lg',
  '1.125rem': 'lg',
  '20px': 'xl',
  '1.25rem': 'xl',
  '24px': '2xl',
  '1.5rem': '2xl',
  '30px': '3xl',
  '1.875rem': '3xl',
  '36px': '4xl',
  '2.25rem': '4xl',
  '48px': '5xl',
  '3rem': '5xl',
  '60px': '6xl',
  '3.75rem': '6xl',
  '72px': '7xl',
  '4.5rem': '7xl',
  '96px': '8xl',
  '6rem': '8xl',
  '128px': '9xl',
  '8rem': '9xl',
};

const FONT_WEIGHTS: Record<string, string> = {
  '100': 'thin',
  '200': 'extralight',
  '300': 'light',
  '400': 'normal',
  normal: 'normal',
  '500': 'medium',
  '600': 'semibold',
  '700': 'bold',
  bold: 'bold',
  '800': 'extrabold',
  '900': 'black',
};

const LEADING: Record<string, string> = { '1': 'none', '1.25': 'tight', '1.375': 'snug', '1.5': 'normal', '1.625': 'relaxed', '2': 'loose' };
const TRACKING: Record<string, string> = {
  '-.05em': 'tighter',
  '-0.05em': 'tighter',
  '-.025em': 'tight',
  '-0.025em': 'tight',
  '0': 'normal',
  '0em': 'normal',
  '.025em': 'wide',
  '0.025em': 'wide',
  '.05em': 'wider',
  '0.05em': 'wider',
  '.1em': 'widest',
  '0.1em': 'widest',
};

const CURSORS = [
  'auto',
  'default',
  'pointer',
  'wait',
  'text',
  'move',
  'help',
  'not-allowed',
  'none',
  'context-menu',
  'progress',
  'cell',
  'crosshair',
  'vertical-text',
  'alias',
  'copy',
  'no-drop',
  'grab',
  'grabbing',
  'all-scroll',
  'col-resize',
  'row-resize',
  'n-resize',
  'e-resize',
  's-resize',
  'w-resize',
  'ne-resize',
  'nw-resize',
  'se-resize',
  'sw-resize',
  'ew-resize',
  'ns-resize',
  'nesw-resize',
  'nwse-resize',
  'zoom-in',
  'zoom-out',
];

const integer =
  (prefix: string, allowNegative = false): Mapper =>
  (value) => {
    if (/^\d+$/.test(value)) return [`${prefix}-${value}`];
    if (allowNegative && /^-\d+$/.test(value)) return [`-${prefix}-${value.slice(1)}`];
    return [`${prefix}-${bracket(value)}`];
  };

const milliseconds =
  (prefix: string): Mapper =>
  (value) => {
    const match = /^(\d*\.?\d+)(ms|s)$/.exec(value);
    if (!match) return null;
    const ms = Number(match[1]) * (match[2] === 's' ? 1000 : 1);
    return Number.isInteger(ms) ? [`${prefix}-${ms}`] : [`${prefix}-${bracket(value)}`];
  };

const transform: Mapper = (value) => {
  if (value === 'none') return ['transform-none'];
  const calls = splitTop(value);
  // Tailwind's rotate/scale/translate utilities use the individual transform properties, whose
  // order is fixed; they only match the `transform` shorthand when a single function is used.
  if (calls.length !== 1) return null;
  const match = /^([a-zA-Z]+)\((.*)\)$/.exec(calls[0] as string);
  if (!match) return null;
  const args = splitTop(match[2] as string, ',');
  const name = match[1] as string;
  const angle = (prefix: string, raw: string): string[] | null => {
    const degrees = /^(-?\d*\.?\d+)deg$/.exec(raw);
    if (!degrees) return null;
    const amount = Number(degrees[1]);
    return Number.isInteger(amount) ? [`${amount < 0 ? '-' : ''}${prefix}-${Math.abs(amount)}`] : [`${prefix}-${bracket(raw)}`];
  };
  const scale = (prefix: string, raw: string): string | null => {
    if (!/^-?\d*\.?\d+$/.test(raw)) return null;
    const percent = Number(raw) * 100;
    return Number.isInteger(percent) ? `${percent < 0 ? '-' : ''}${prefix}-${Math.abs(percent)}` : `${prefix}-${bracket(raw)}`;
  };
  const translate = (prefix: string, raw: string): string => {
    const negative = raw.startsWith('-');
    const part = fraction(negative ? raw.slice(1) : raw);
    return part !== undefined ? `${negative ? '-' : ''}${prefix}-${part}` : cls(prefix, spacing(raw));
  };
  switch (name) {
    case 'rotate':
      return args.length === 1 ? angle('rotate', args[0] as string) : null;
    case 'skewX':
      return args.length === 1 ? angle('skew-x', args[0] as string) : null;
    case 'skewY':
      return args.length === 1 ? angle('skew-y', args[0] as string) : null;
    case 'scale': {
      if (args.length === 1) {
        const one = scale('scale', args[0] as string);
        return one ? [one] : null;
      }
      const x = scale('scale-x', args[0] as string);
      const y = scale('scale-y', args[1] as string);
      return x && y && args.length === 2 ? [x, y] : null;
    }
    case 'scaleX':
    case 'scaleY': {
      const one = scale(name === 'scaleX' ? 'scale-x' : 'scale-y', args[0] as string);
      return one && args.length === 1 ? [one] : null;
    }
    case 'translateX':
      return args.length === 1 ? [translate('translate-x', args[0] as string)] : null;
    case 'translateY':
      return args.length === 1 ? [translate('translate-y', args[0] as string)] : null;
    case 'translate':
      return args.length === 2 ? [translate('translate-x', args[0] as string), translate('translate-y', args[1] as string)] : args.length === 1 ? [translate('translate-x', args[0] as string)] : null;
    default:
      return null;
  }
};

const FLEX_ALIGN: Record<string, string> = { 'flex-start': 'start', 'flex-end': 'end', start: 'start', end: 'end', center: 'center', baseline: 'baseline', stretch: 'stretch' };
const DISTRIBUTE: Record<string, string> = { ...FLEX_ALIGN, 'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly', normal: 'normal' };
const withPrefix = (prefix: string, map: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(map).map(([key, value]) => [key, `${prefix}-${value}`]));

const gridTemplate =
  (prefix: string): Mapper =>
  (value) => {
    const repeat = /^repeat\((\d+),\s*minmax\(0,\s*1fr\)\)$/.exec(value);
    if (repeat) return [`${prefix}-${repeat[1]}`];
    if (value === 'none' || value === 'subgrid') return [`${prefix}-${value}`];
    return [`${prefix}-${bracket(value)}`];
  };

const gridLine =
  (prefix: string): Mapper =>
  (value) => {
    const span = /^span (\d+)\s*\/\s*span \1$/.exec(value);
    if (span) return [`${prefix}-span-${span[1]}`];
    if (/^1\s*\/\s*-1$/.test(value)) return [`${prefix}-span-full`];
    if (value === 'auto') return [`${prefix}-auto`];
    return [`${prefix}-${bracket(value)}`];
  };

const MAPPERS: Record<string, Mapper> = {
  display: keyword({
    block: 'block',
    'inline-block': 'inline-block',
    inline: 'inline',
    flex: 'flex',
    'inline-flex': 'inline-flex',
    grid: 'grid',
    'inline-grid': 'inline-grid',
    table: 'table',
    'table-cell': 'table-cell',
    'table-row': 'table-row',
    contents: 'contents',
    none: 'hidden',
    'flow-root': 'flow-root',
    'list-item': 'list-item',
    'inline-table': 'inline-table',
  }),
  position: keyword({ static: 'static', fixed: 'fixed', absolute: 'absolute', relative: 'relative', sticky: 'sticky' }),
  top: space('top', { auto: 'auto', '100%': 'full', '50%': '1/2' }),
  right: space('right', { auto: 'auto', '100%': 'full', '50%': '1/2' }),
  bottom: space('bottom', { auto: 'auto', '100%': 'full', '50%': '1/2' }),
  left: space('left', { auto: 'auto', '100%': 'full', '50%': '1/2' }),
  inset: (value) => (splitTop(value).length === 1 ? [cls('inset', spacing(value, { auto: 'auto', '100%': 'full' }))] : null),
  'inset-inline': (value) => (splitTop(value).length === 1 ? [cls('inset-x', spacing(value, { auto: 'auto' }))] : null),
  'inset-block': (value) => (splitTop(value).length === 1 ? [cls('inset-y', spacing(value, { auto: 'auto' }))] : null),
  'z-index': (value) => (value === 'auto' ? ['z-auto'] : integer('z', true)(value, undefined as never)),
  float: keyword({ left: 'float-left', right: 'float-right', none: 'float-none', 'inline-start': 'float-start', 'inline-end': 'float-end' }),
  clear: keyword({ left: 'clear-left', right: 'clear-right', both: 'clear-both', none: 'clear-none' }),
  overflow: prefixed('overflow', ['auto', 'hidden', 'clip', 'visible', 'scroll']),
  'overflow-x': prefixed('overflow-x', ['auto', 'hidden', 'clip', 'visible', 'scroll']),
  'overflow-y': prefixed('overflow-y', ['auto', 'hidden', 'clip', 'visible', 'scroll']),
  visibility: keyword({ visible: 'visible', hidden: 'invisible', collapse: 'collapse' }),
  'box-sizing': keyword({ 'border-box': 'box-border', 'content-box': 'box-content' }),
  isolation: keyword({ isolate: 'isolate', auto: 'isolation-auto' }),
  width: size('w', 'w'),
  height: size('h', 'h'),
  'min-width': size('min-w', 'w'),
  'max-width': size('max-w', 'w'),
  'min-height': size('min-h', 'h'),
  'max-height': size('max-h', 'h'),
  margin: box('m', { auto: 'auto' }),
  'margin-top': space('mt', { auto: 'auto' }),
  'margin-right': space('mr', { auto: 'auto' }),
  'margin-bottom': space('mb', { auto: 'auto' }),
  'margin-left': space('ml', { auto: 'auto' }),
  'margin-inline': (value) => (splitTop(value).length === 1 ? [cls('mx', spacing(value, { auto: 'auto' }))] : null),
  'margin-block': (value) => (splitTop(value).length === 1 ? [cls('my', spacing(value, { auto: 'auto' }))] : null),
  'margin-inline-start': space('ms', { auto: 'auto' }),
  'margin-inline-end': space('me', { auto: 'auto' }),
  padding: box('p'),
  'padding-top': space('pt'),
  'padding-right': space('pr'),
  'padding-bottom': space('pb'),
  'padding-left': space('pl'),
  'padding-inline': (value) => (splitTop(value).length === 1 ? [cls('px', spacing(value))] : null),
  'padding-block': (value) => (splitTop(value).length === 1 ? [cls('py', spacing(value))] : null),
  'padding-inline-start': space('ps'),
  'padding-inline-end': space('pe'),
  gap: (value) => {
    const parts = splitTop(value);
    if (parts.length === 1) return [cls('gap', spacing(value))];
    return parts.length === 2 ? [cls('gap-y', spacing(parts[0] as string)), cls('gap-x', spacing(parts[1] as string))] : null;
  },
  'row-gap': space('gap-y'),
  'column-gap': space('gap-x'),
  'flex-direction': keyword({ row: 'flex-row', 'row-reverse': 'flex-row-reverse', column: 'flex-col', 'column-reverse': 'flex-col-reverse' }),
  'flex-wrap': keyword({ wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' }),
  flex: (value) => {
    const compact = value.replace(/\s+/g, ' ');
    const named: Record<string, string> = { '1 1 0%': 'flex-1', '1 1 auto': 'flex-auto', '0 1 auto': 'flex-initial', none: 'flex-none', auto: 'flex-auto', initial: 'flex-initial' };
    if (named[compact]) return [named[compact]];
    return /^\d+$/.test(compact) ? [`flex-${compact}`] : [`flex-${bracket(value)}`];
  },
  'flex-grow': (value) => (value === '1' ? ['grow'] : /^\d+$/.test(value) ? [`grow-${value}`] : [`grow-${bracket(value)}`]),
  'flex-shrink': (value) => (value === '1' ? ['shrink'] : /^\d+$/.test(value) ? [`shrink-${value}`] : [`shrink-${bracket(value)}`]),
  'flex-basis': (value) => {
    const part = fraction(value);
    return [part !== undefined ? `basis-${part}` : cls('basis', spacing(value, { auto: 'auto' }))];
  },
  order: integer('order', true),
  'justify-content': keyword(withPrefix('justify', DISTRIBUTE)),
  'align-items': keyword(withPrefix('items', FLEX_ALIGN)),
  'align-self': keyword(withPrefix('self', { ...FLEX_ALIGN, auto: 'auto' })),
  'align-content': keyword(withPrefix('content', DISTRIBUTE)),
  'justify-items': keyword(withPrefix('justify-items', { start: 'start', end: 'end', center: 'center', stretch: 'stretch', normal: 'normal' })),
  'justify-self': keyword(withPrefix('justify-self', { auto: 'auto', start: 'start', end: 'end', center: 'center', stretch: 'stretch' })),
  'place-content': keyword(
    withPrefix('place-content', {
      center: 'center',
      start: 'start',
      end: 'end',
      'space-between': 'between',
      'space-around': 'around',
      'space-evenly': 'evenly',
      stretch: 'stretch',
      baseline: 'baseline',
    }),
  ),
  'place-items': keyword(withPrefix('place-items', { start: 'start', end: 'end', center: 'center', stretch: 'stretch', baseline: 'baseline' })),
  'place-self': keyword(withPrefix('place-self', { auto: 'auto', start: 'start', end: 'end', center: 'center', stretch: 'stretch' })),
  'grid-template-columns': gridTemplate('grid-cols'),
  'grid-template-rows': gridTemplate('grid-rows'),
  'grid-column': gridLine('col'),
  'grid-row': gridLine('row'),
  'grid-column-start': (value) => (/^-?\d+$/.test(value) || value === 'auto' ? [`${value.startsWith('-') ? '-' : ''}col-start-${value.replace('-', '')}`] : null),
  'grid-column-end': (value) => (/^-?\d+$/.test(value) || value === 'auto' ? [`${value.startsWith('-') ? '-' : ''}col-end-${value.replace('-', '')}`] : null),
  'grid-row-start': (value) => (/^-?\d+$/.test(value) || value === 'auto' ? [`${value.startsWith('-') ? '-' : ''}row-start-${value.replace('-', '')}`] : null),
  'grid-row-end': (value) => (/^-?\d+$/.test(value) || value === 'auto' ? [`${value.startsWith('-') ? '-' : ''}row-end-${value.replace('-', '')}`] : null),
  'grid-auto-flow': keyword({ row: 'grid-flow-row', column: 'grid-flow-col', dense: 'grid-flow-dense', 'row dense': 'grid-flow-row-dense', 'column dense': 'grid-flow-col-dense' }),
  color: color('text', true),
  'background-color': color('bg'),
  'border-color': (value, context) => (splitTop(value).length === 1 ? color('border', true)(value, context) : null),
  'outline-color': color('outline', true),
  'accent-color': (value, context) => (value === 'auto' ? ['accent-auto'] : color('accent')(value, context)),
  'caret-color': color('caret'),
  fill: (value, context) => (value === 'none' ? ['fill-none'] : color('fill')(value, context)),
  stroke: (value, context) => (value === 'none' ? ['stroke-none'] : color('stroke', true)(value, context)),
  'text-decoration-color': color('decoration', true),
  background: (value, context) => (isColor(value) || value === 'transparent' ? color('bg')(value, context) : value === 'none' ? ['bg-none'] : null),
  'background-image': (value) => (value === 'none' ? ['bg-none'] : /^(url|linear-gradient|radial-gradient|conic-gradient|repeating-)/.test(value) ? [`bg-${bracket(value)}`] : null),
  'background-size': keyword({ auto: 'bg-auto', cover: 'bg-cover', contain: 'bg-contain' }),
  'background-repeat': keyword({ repeat: 'bg-repeat', 'no-repeat': 'bg-no-repeat', 'repeat-x': 'bg-repeat-x', 'repeat-y': 'bg-repeat-y', round: 'bg-repeat-round', space: 'bg-repeat-space' }),
  'background-position': keyword({ center: 'bg-center', top: 'bg-top', bottom: 'bg-bottom', left: 'bg-left', right: 'bg-right' }),
  'background-attachment': prefixed('bg', ['fixed', 'local', 'scroll']),
  'background-clip': keyword({ 'border-box': 'bg-clip-border', 'padding-box': 'bg-clip-padding', 'content-box': 'bg-clip-content', text: 'bg-clip-text' }),
  border: border(''),
  'border-top': border('t'),
  'border-right': border('r'),
  'border-bottom': border('b'),
  'border-left': border('l'),
  'border-width': (value) => (splitTop(value).length === 1 ? [borderWidth('border', value)] : null),
  'border-top-width': (value) => [borderWidth('border-t', value)],
  'border-right-width': (value) => [borderWidth('border-r', value)],
  'border-bottom-width': (value) => [borderWidth('border-b', value)],
  'border-left-width': (value) => [borderWidth('border-l', value)],
  'border-style': prefixed('border', BORDER_STYLES),
  'border-radius': radius('rounded'),
  'border-top-left-radius': radius('rounded-tl'),
  'border-top-right-radius': radius('rounded-tr'),
  'border-bottom-right-radius': radius('rounded-br'),
  'border-bottom-left-radius': radius('rounded-bl'),
  'border-collapse': keyword({ collapse: 'border-collapse', separate: 'border-separate' }),
  'table-layout': keyword({ auto: 'table-auto', fixed: 'table-fixed' }),
  outline: (value) => (value === 'none' ? ['outline-none'] : null),
  'outline-style': prefixed('outline', ['solid', 'dashed', 'dotted', 'double', 'none']),
  'outline-offset': (value) => (/^-?\d+px$/.test(value) ? [`${value.startsWith('-') ? '-' : ''}outline-offset-${value.replace(/^-|px$/g, '')}`] : [`outline-offset-${bracket(value)}`]),
  opacity: (value) => {
    const amount = value.endsWith('%') ? Number(value.slice(0, -1)) : Number(value) * 100;
    if (!Number.isFinite(amount)) return null;
    return [Math.abs(amount - Math.round(amount)) < 1e-9 ? `opacity-${Math.round(amount)}` : `opacity-${bracket(value)}`];
  },
  'box-shadow': (value) => (value === 'none' ? ['shadow-none'] : [`shadow-${bracket(value)}`]),
  'font-size': (value, context) => {
    // text-sm & co. also set a line-height, so they are only equivalent when the rule sets its own.
    const named = FONT_SIZES[value];
    if (named !== undefined && context.siblings.has('line-height')) return [`text-${named}`];
    return [/^(-?[\d.]+)(px|rem|em|%|vw|vh|pt)$/.test(value) ? `text-${bracket(value)}` : `text-[length:${bracket(value).slice(1)}`];
  },
  'font-weight': (value) => (FONT_WEIGHTS[value] ? [`font-${FONT_WEIGHTS[value]}`] : /^\d+$/.test(value) ? [`font-${bracket(value)}`] : null),
  'font-style': keyword({ italic: 'italic', normal: 'not-italic' }),
  'line-height': (value) => {
    if (LEADING[value]) return [`leading-${LEADING[value]}`];
    const token = spacing(value);
    return [LENGTH.test(value) && /px|rem/.test(value) ? cls('leading', token) : `leading-${bracket(value)}`];
  },
  'letter-spacing': (value) => [`tracking-${TRACKING[value] ?? bracket(value)}`],
  'text-align': prefixed('text', ['left', 'center', 'right', 'justify', 'start', 'end']),
  'text-decoration': keyword({ underline: 'underline', overline: 'overline', 'line-through': 'line-through', none: 'no-underline' }),
  'text-decoration-line': keyword({ underline: 'underline', overline: 'overline', 'line-through': 'line-through', none: 'no-underline' }),
  'text-decoration-style': prefixed('decoration', ['solid', 'double', 'dotted', 'dashed', 'wavy']),
  'text-transform': keyword({ uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' }),
  'text-overflow': keyword({ ellipsis: 'text-ellipsis', clip: 'text-clip' }),
  'text-wrap': prefixed('text', ['wrap', 'nowrap', 'balance', 'pretty']),
  'white-space': prefixed('whitespace', ['normal', 'nowrap', 'pre', 'pre-line', 'pre-wrap', 'break-spaces']),
  'word-break': keyword({ 'break-all': 'break-all', 'keep-all': 'break-keep', normal: 'break-normal' }),
  'overflow-wrap': keyword({ 'break-word': 'break-words' }),
  'vertical-align': prefixed('align', ['baseline', 'top', 'middle', 'bottom', 'text-top', 'text-bottom', 'sub', 'super']),
  'list-style-type': prefixed('list', ['none', 'disc', 'decimal']),
  'list-style-position': prefixed('list', ['inside', 'outside']),
  cursor: prefixed('cursor', CURSORS),
  'pointer-events': prefixed('pointer-events', ['none', 'auto']),
  'user-select': prefixed('select', ['none', 'text', 'all', 'auto']),
  resize: keyword({ none: 'resize-none', both: 'resize', vertical: 'resize-y', horizontal: 'resize-x' }),
  appearance: prefixed('appearance', ['none', 'auto']),
  'object-fit': prefixed('object', ['contain', 'cover', 'fill', 'none', 'scale-down']),
  'object-position': keyword({ center: 'object-center', top: 'object-top', bottom: 'object-bottom', left: 'object-left', right: 'object-right' }),
  'aspect-ratio': (value) => {
    const compact = value.replace(/\s+/g, '');
    return [compact === '1/1' || compact === '1' ? 'aspect-square' : compact === '16/9' ? 'aspect-video' : compact === 'auto' ? 'aspect-auto' : `aspect-[${compact}]`];
  },
  'mix-blend-mode': (value) => (/^[a-z-]+$/.test(value) ? [`mix-blend-${value}`] : null),
  'transition-duration': milliseconds('duration'),
  'transition-delay': milliseconds('delay'),
  'transition-timing-function': keyword({ linear: 'ease-linear', 'ease-in': 'ease-in', 'ease-out': 'ease-out', 'ease-in-out': 'ease-in-out' }),
  transition: (value) => (value === 'none' ? ['transition-none'] : null),
  transform,
  'transform-origin': keyword({
    center: 'origin-center',
    top: 'origin-top',
    'top right': 'origin-top-right',
    right: 'origin-right',
    'bottom right': 'origin-bottom-right',
    bottom: 'origin-bottom',
    'bottom left': 'origin-bottom-left',
    left: 'origin-left',
    'top left': 'origin-top-left',
  }),
  filter: (value) => {
    const blur = /^blur\(([^)]+)\)$/.exec(value);
    return blur ? [`blur-${bracket(blur[1] as string)}`] : value === 'none' ? ['filter-none'] : null;
  },
  'backdrop-filter': (value) => {
    const blur = /^blur\(([^)]+)\)$/.exec(value);
    return blur ? [`backdrop-blur-${bracket(blur[1] as string)}`] : value === 'none' ? ['backdrop-filter-none'] : null;
  },
  'scroll-behavior': keyword({ smooth: 'scroll-smooth', auto: 'scroll-auto' }),
  'will-change': keyword({ auto: 'will-change-auto', scroll: 'will-change-scroll', contents: 'will-change-contents', transform: 'will-change-transform' }),
  columns: (value) => (/^\d+$/.test(value) ? [`columns-${value}`] : null),
  'stroke-width': (value) => (/^\d+$/.test(value) ? [`stroke-${value}`] : [`stroke-${bracket(value)}`]),
  content: (value) => (value === 'none' ? ['content-none'] : [`content-${bracket(value)}`]),
};

function convertDeclaration(property: string, value: string, important: boolean, context: Context): { classes: string[]; arbitrary: boolean } {
  const mapped = property.startsWith('--') ? null : (MAPPERS[property]?.(value, context) ?? null);
  const classes = mapped ?? [`[${property}:${bracket(value).slice(1)}`];
  return {
    classes: important ? classes.map((item) => `${item}!`) : classes,
    arbitrary: mapped === null || classes.some((item) => item.includes('[')),
  };
}

/* --------------------------------------------------------------- selectors -- */

const PSEUDO_VARIANTS: Record<string, string> = {
  ':hover': 'hover',
  ':focus': 'focus',
  ':focus-visible': 'focus-visible',
  ':focus-within': 'focus-within',
  ':active': 'active',
  ':visited': 'visited',
  ':disabled': 'disabled',
  ':enabled': 'enabled',
  ':checked': 'checked',
  ':required': 'required',
  ':invalid': 'invalid',
  ':valid': 'valid',
  ':read-only': 'read-only',
  ':empty': 'empty',
  ':target': 'target',
  ':first-child': 'first',
  ':last-child': 'last',
  ':only-child': 'only',
  ':first-of-type': 'first-of-type',
  ':last-of-type': 'last-of-type',
  ':nth-child(odd)': 'odd',
  ':nth-child(2n+1)': 'odd',
  ':nth-child(even)': 'even',
  ':nth-child(2n)': 'even',
  ':placeholder-shown': 'placeholder-shown',
  ':indeterminate': 'indeterminate',
  ':default': 'default',
  ':optional': 'optional',
  '::before': 'before',
  ':before': 'before',
  '::after': 'after',
  ':after': 'after',
  '::placeholder': 'placeholder',
  '::selection': 'selection',
  '::marker': 'marker',
  '::first-letter': 'first-letter',
  '::first-line': 'first-line',
  '::backdrop': 'backdrop',
  '::file-selector-button': 'file',
};

export function analyzeSelector(selector: string): { host: string; variants: string[] } {
  const trimmed = selector.trim();
  const hostMatch = /^(?:[.#][\w-]+|[a-zA-Z][\w-]*|\*|:root|:host)/.exec(trimmed);
  if (!hostMatch) return { host: trimmed, variants: [] };
  const host = hostMatch[0];
  const rest = trimmed.slice(host.length);
  if (rest === '') return { host, variants: [] };
  const pseudos = rest.match(/::?[a-zA-Z-]+(?:\([^)]*\))?/g);
  if (pseudos && pseudos.join('') === rest) {
    return { host, variants: pseudos.map((pseudo) => PSEUDO_VARIANTS[pseudo.replace(/\s+/g, '')] ?? `[&${pseudo}]`) };
  }
  const compact = rest
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/_/g, '\\_')
    .replace(/\s+/g, '_');
  return { host, variants: [`[&${compact}]`] };
}

const BREAKPOINTS: Record<string, string> = {
  '640px': 'sm',
  '40rem': 'sm',
  '768px': 'md',
  '48rem': 'md',
  '1024px': 'lg',
  '64rem': 'lg',
  '1280px': 'xl',
  '80rem': 'xl',
  '1536px': '2xl',
  '96rem': '2xl',
};

const MEDIA_FEATURES: Record<string, string> = {
  '(prefers-color-scheme:dark)': 'dark',
  '(prefers-reduced-motion:reduce)': 'motion-reduce',
  '(prefers-reduced-motion:no-preference)': 'motion-safe',
  '(orientation:portrait)': 'portrait',
  '(orientation:landscape)': 'landscape',
  '(prefers-contrast:more)': 'contrast-more',
  '(prefers-contrast:less)': 'contrast-less',
  '(forced-colors:active)': 'forced-colors',
  print: 'print',
};

export function mediaVariants(prelude: string): string[] {
  const query = prelude
    .trim()
    .replace(/\s*:\s*/g, ':')
    .replace(/\s*(>=|<=)\s*/g, '$1');
  const fallback = [
    `[@media${query
      .replace(/^(?![(])/, '_')
      .replace(/_/g, '\\_')
      .replace(/\s+/g, '_')}]`,
  ];
  if (query.includes(',') || /\bnot\b/.test(query)) return fallback;
  const conditions = query.split(/\s+and\s+/).filter((condition) => !/^(only\s+)?(screen|all)$/.test(condition));
  const variants: string[] = [];
  for (const condition of conditions) {
    const feature = MEDIA_FEATURES[condition];
    const min = /^\((?:min-width:|width>=)([^)]+)\)$/.exec(condition);
    const max = /^\((?:max-width:|width<=)([^)]+)\)$/.exec(condition);
    if (feature) variants.push(feature);
    else if (min) variants.push(BREAKPOINTS[min[1] as string] ?? `min-[${min[1]}]`);
    else if (max) variants.push(`max-[${max[1]}]`);
    else return fallback;
  }
  return variants;
}

/* ------------------------------------------------------------------ driver -- */

// biome-ignore lint/suspicious/noExplicitAny: css-tree nodes are a wide union; only a few shapes are read here
type Node = any;

export function cssToTailwind(css: string, options: TailwindOptions): TailwindResult {
  const parseErrors: { message: string; line?: number; column?: number }[] = [];
  const ast: Node = parse(css, {
    positions: true,
    onParseError: (error: { message: string; line?: number; column?: number }) => parseErrors.push(error),
  });

  const groups = new Map<string, string[]>();
  const skipped: string[] = [];
  let declarations = 0;
  let arbitrary = 0;

  const add = (host: string, classes: string[]) => {
    const list = groups.get(host) ?? [];
    for (const item of classes) if (!list.includes(item)) list.push(item);
    groups.set(host, list);
  };

  const processRule = (rule: Node, outer: string[], parents: string[]) => {
    const own: string[] = rule.prelude.children.toArray().map((selector: Node) => generate(selector));
    // CSS nesting: "&" refers to the parent selector, otherwise the rule is a descendant.
    const selectors = parents.length === 0 ? own : parents.flatMap((parent) => own.map((child) => (child.includes('&') ? child.replace(/&/g, parent) : `${parent} ${child}`)));
    const items: Node[] = rule.block.children.toArray();
    const siblings = new Set<string>(items.filter((item) => item.type === 'Declaration').map((item) => item.property as string));
    for (const item of items) {
      if (item.type === 'Declaration') {
        declarations++;
        const value = generate(item.value).trim();
        const converted = convertDeclaration(item.property, value, Boolean(item.important), { options, siblings });
        if (converted.arbitrary) arbitrary++;
        for (const selector of selectors) {
          const { host, variants } = analyzeSelector(selector);
          const prefix = [...outer, ...variants].map((variant) => `${variant}:`).join('');
          add(
            host,
            converted.classes.map((name) => prefix + name),
          );
        }
      } else if (item.type === 'Rule') {
        processRule(item, outer, selectors);
      } else if (item.type === 'Atrule') {
        processAtrule(item, outer, selectors);
      }
    }
  };

  const processAtrule = (atrule: Node, outer: string[], parents: string[]) => {
    const prelude = atrule.prelude ? generate(atrule.prelude) : '';
    let variants: string[];
    if (atrule.name === 'media') variants = mediaVariants(prelude);
    else if (atrule.name === 'supports') variants = [`supports-[${prelude.replace(/^\(|\)$/g, '').replace(/\s+/g, '_')}]`];
    else if (atrule.name === 'layer' || atrule.name === 'scope') variants = [];
    else {
      const label = `@${atrule.name}${prelude ? ` ${prelude}` : ''}`;
      if (!skipped.includes(label)) skipped.push(label);
      return;
    }
    if (!atrule.block) return;
    for (const child of atrule.block.children.toArray() as Node[]) {
      if (child.type === 'Rule') processRule(child, [...outer, ...variants], parents);
      else if (child.type === 'Atrule') processAtrule(child, [...outer, ...variants], parents);
      else if (child.type === 'Declaration' && parents.length > 0) {
        // A nested at-rule that holds declarations directly applies them to the parent selector.
        declarations++;
        const converted = convertDeclaration(child.property, generate(child.value).trim(), Boolean(child.important), { options, siblings: new Set() });
        if (converted.arbitrary) arbitrary++;
        for (const selector of parents) {
          const { host, variants: own } = analyzeSelector(selector);
          const prefix = [...outer, ...variants, ...own].map((variant) => `${variant}:`).join('');
          add(
            host,
            converted.classes.map((name) => prefix + name),
          );
        }
      }
    }
  };

  for (const node of ast.children.toArray() as Node[]) {
    if (node.type === 'Rule') processRule(node, [], []);
    else if (node.type === 'Atrule') processAtrule(node, [], []);
  }

  if (declarations === 0) {
    const first = parseErrors[0];
    if (first) throw new ToolError(`${first.message}${first.line ? ` (line ${first.line}, column ${first.column})` : ''}.`, { line: first.line, column: first.column });
    throw new ToolError('No CSS rules with declarations were found. Paste complete rules such as ".card { padding: 1rem; }".');
  }
  return {
    groups: [...groups].map(([selector, classes]) => ({ selector, classes })),
    skipped,
    problems: parseErrors.slice(0, 4).map((error) => `${error.message}${error.line ? ` (line ${error.line}, column ${error.column})` : ''}`),
    declarations,
    arbitrary,
  };
}
