/**
 * Bootstrap theme model: the catalogue of Sass variables Bootstrap exposes,
 * the user's overrides, and the files generated from them.  Pure functions
 * only; compiling happens in `bootstrap-compile.ts`.
 */
import { ToolError } from './errors';

export const BOOTSTRAP_VERSION = '5.3.9';

export type VariableKind = 'color' | 'boolean' | 'length' | 'number' | 'font' | 'map' | 'other';

export interface ThemeVariable {
  /** Name without the leading `$`. */
  readonly name: string;
  /** Default value as written in Bootstrap's source (may reference other variables). */
  readonly value: string;
  readonly group: string;
  readonly kind: VariableKind;
  /** True for variables that only apply to the dark colour mode. */
  readonly dark: boolean;
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNCTION = /^(?:rgba?|hsla?|tint-color|shade-color|shift-color|mix|lighten|darken|rgba)\(/i;
const COLOR_VARIABLE = /^\$(?:white|black|gray-\d+|blue|indigo|purple|pink|red|orange|yellow|green|teal|cyan|primary|secondary|success|info|warning|danger|light|dark)$/;

export function kindOf(name: string, value: string): VariableKind {
  const v = value.trim();
  if (v === 'true' || v === 'false') return 'boolean';
  if (v.startsWith('(')) return 'map';
  if (HEX.test(v) || COLOR_VARIABLE.test(v) || (COLOR_FUNCTION.test(v) && !/shadow/.test(name))) return 'color';
  if (/(?:^|-)(?:color|bg|background|border-color)(?:-|$)/.test(name) && !/shadow|width|opacity|alpha/.test(name) && !/^\$?(?:null|inherit)$/.test(v)) return 'color';
  if (/font-family/.test(name)) return 'font';
  if (/^-?[\d.]+(?:rem|em|px|%|vw|vh|ch|s|ms|deg)$/.test(v)) return 'length';
  if (/^-?[\d.]+$/.test(v)) return 'number';
  return 'other';
}

function isHeading(line: string, previous: string | undefined, next: string | undefined): string | null {
  const match = /^\/\/\s+([A-Z][A-Za-z +/&-]*)$/.exec(line);
  if (!match) return null;
  const title = (match[1] as string).trim();
  if (title.split(/\s+/).length > 4) return null;
  const quiet = (text: string | undefined) => text === undefined || text.trim() === '' || text.trim() === '//';
  return quiet(previous) && quiet(next) ? title : null;
}

/**
 * Lists every `$variable: value !default;` declaration in a Bootstrap
 * variables file, with the section heading it sits under.
 */
export function parseVariables(source: string, options: { dark?: boolean; prefix?: string } = {}): ThemeVariable[] {
  const lines = source.split(/\r?\n/);
  const variables: ThemeVariable[] = [];
  let group = options.prefix ?? 'General';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const heading = isHeading(line, lines[i - 1], lines[i + 1]);
    if (heading) {
      group = options.prefix ? `${options.prefix}: ${heading.toLowerCase()}` : heading;
      continue;
    }
    const start = /^\$([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (!start) continue;
    // Collect the value, which may span several lines (maps, font stacks).
    let text = start[2] as string;
    let depth = 0;
    let j = i;
    const balanced = () => {
      depth = 0;
      let quote: string | null = null;
      for (const ch of text) {
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth--;
      }
      return depth <= 0;
    };
    while (!(balanced() && /;\s*(?:\/\/.*)?$/.test(text)) && j + 1 < lines.length) {
      j++;
      text += `\n${lines[j] as string}`;
    }
    i = j;
    const value = text
      .replace(/\s*\/\/[^\n"']*$/gm, '')
      .replace(/\s*;\s*$/, '')
      .replace(/\s*!default\s*$/, '')
      .trim();
    if (!/!default/.test(text)) continue;
    const name = start[1] as string;
    variables.push({ name, value, group, kind: kindOf(name, value), dark: options.dark === true });
  }
  return variables;
}

/* --------------------------------------------------------------- overrides -- */

export type Overrides = Readonly<Record<string, string>>;

/** Normalises a value typed by the user so it can be written as one declaration. */
export function cleanValue(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s*!default\s*;?\s*$/, '')
    .replace(/;+\s*$/, '')
    .trim();
}

const NAME = /^[A-Za-z_][\w-]*$/;

export function validateOverride(name: string, value: string): string | null {
  if (!NAME.test(name)) return `"${name}" is not a valid Sass variable name.`;
  const cleaned = cleanValue(value);
  if (cleaned === '') return 'Enter a value, or reset the variable to its default.';
  let depth = 0;
  let quote: string | null = null;
  for (const ch of cleaned) {
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if ((ch === ';' || ch === '{' || ch === '}') && depth === 0) return 'A value cannot contain ";", "{" or "}".';
    if (depth < 0) return 'This value has an unmatched ")".';
  }
  if (quote) return 'This value has an unclosed quote.';
  if (depth !== 0) return 'This value has an unclosed "(".';
  return null;
}

/** Orders overrides the way Bootstrap declares them, so that later variables can refer to earlier ones. */
export function orderedOverrides(overrides: Overrides, catalogue: readonly ThemeVariable[]): [string, string][] {
  const position = new Map(catalogue.map((variable, index) => [variable.name, index]));
  return Object.entries(overrides)
    .filter(([name, value]) => NAME.test(name) && cleanValue(value) !== '')
    .sort(([a], [b]) => (position.get(a) ?? -1) - (position.get(b) ?? -1) || a.localeCompare(b))
    .map(([name, value]) => [name, cleanValue(value)]);
}

export interface ThemeSource {
  readonly name: string;
  readonly overrides: Overrides;
  /** Extra Sass appended after Bootstrap, where its functions and mixins are available. */
  readonly extraScss: string;
}

/** The entry point compiled by the app: overrides, then Bootstrap, then the extra Sass. */
export function buildEntry(theme: ThemeSource, catalogue: readonly ThemeVariable[], importPath = 'bootstrap'): { scss: string; lineToVariable: Map<number, string> } {
  const lines: string[] = [];
  const lineToVariable = new Map<number, string>();
  for (const [name, value] of orderedOverrides(theme.overrides, catalogue)) {
    lines.push(`$${name}: ${value};`);
    lineToVariable.set(lines.length, name);
  }
  lines.push(`@import "${importPath}";`);
  if (theme.extraScss.trim() !== '') lines.push('', theme.extraScss.trim());
  return { scss: `${lines.join('\n')}\n`, lineToVariable };
}

function header(theme: ThemeSource, purpose: string): string {
  const title = theme.name.trim() || 'Custom theme';
  return `// ${title}: ${purpose}\n// Bootstrap ${BOOTSTRAP_VERSION}, made with Benchtop.\n`;
}

/** A `_variables.scss` file to import before Bootstrap in an existing Sass build. */
export function variablesFile(theme: ThemeSource, catalogue: readonly ThemeVariable[]): string {
  const entries = orderedOverrides(theme.overrides, catalogue);
  const body = entries.length > 0 ? entries.map(([name, value]) => `$${name}: ${value};`).join('\n') : '// No variables changed from the Bootstrap defaults.';
  return `${header(theme, 'variable overrides')}// Import this file before Bootstrap:\n//   @import "variables";\n//   @import "bootstrap/scss/bootstrap";\n\n${body}\n`;
}

/** A complete Sass entry file for projects that install Bootstrap from npm. */
export function entryFile(theme: ThemeSource, catalogue: readonly ThemeVariable[]): string {
  const { scss } = buildEntry(theme, catalogue, 'bootstrap/scss/bootstrap');
  return `${header(theme, 'Sass entry file')}// Compile with: npx sass --load-path=node_modules custom.scss bootstrap.css\n\n${scss}`;
}

/** Reads `$name: value;` declarations from pasted Sass, such as an exported variables file. */
export function parseOverrides(source: string): { overrides: Record<string, string>; skipped: number } {
  const overrides: Record<string, string> = {};
  let skipped = 0;
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = /^\s*\$([\w-]+)\s*:\s*([\s\S]*?);[ \t]*(?:\/\/[^\n]*)?$/gm;
  for (const match of text.matchAll(pattern)) {
    const name = match[1] as string;
    const value = cleanValue((match[2] as string).replace(/\s*\/\/[^\n]*/g, ''));
    if (validateOverride(name, value) === null) overrides[name] = value;
    else skipped++;
  }
  return { overrides, skipped };
}

/* ------------------------------------------------------------- theme files -- */

export interface ThemeFile extends ThemeSource {
  readonly format: 'benchtop-bootstrap-theme';
  readonly version: 1;
  readonly bootstrap: string;
}

export function serializeTheme(theme: ThemeSource, catalogue: readonly ThemeVariable[]): string {
  const file: ThemeFile = {
    format: 'benchtop-bootstrap-theme',
    version: 1,
    bootstrap: BOOTSTRAP_VERSION,
    name: theme.name,
    overrides: Object.fromEntries(orderedOverrides(theme.overrides, catalogue)),
    extraScss: theme.extraScss,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseTheme(text: string): ThemeSource {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ToolError('This file is not a Benchtop Bootstrap theme (it is not valid JSON).');
  }
  if (typeof data !== 'object' || data === null || (data as { format?: unknown }).format !== 'benchtop-bootstrap-theme') {
    throw new ToolError('This file is not a Benchtop Bootstrap theme.');
  }
  const record = data as Record<string, unknown>;
  const overrides: Record<string, string> = {};
  if (typeof record.overrides === 'object' && record.overrides !== null) {
    for (const [name, value] of Object.entries(record.overrides as Record<string, unknown>)) {
      if (typeof value === 'string' && validateOverride(name, value) === null) overrides[name] = cleanValue(value);
    }
  }
  return {
    name: typeof record.name === 'string' ? record.name.slice(0, 120) : 'Imported theme',
    overrides,
    extraScss: typeof record.extraScss === 'string' ? record.extraScss : '',
  };
}

/* ----------------------------------------------------------------- presets -- */

export interface ThemePreset {
  readonly name: string;
  readonly description: string;
  readonly overrides: Overrides;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  { name: 'Bootstrap default', description: 'No changes.', overrides: {} },
  {
    name: 'Workshop',
    description: 'Green and brass, square corners, no gradients.',
    overrides: {
      primary: '#17694e',
      secondary: '#6b6f73',
      warning: '#c8962e',
      'enable-rounded': 'false',
      'font-family-sans-serif': '"Segoe UI", Ubuntu, Cantarell, "Noto Sans", sans-serif',
      'headings-font-weight': '600',
      'link-decoration': 'none',
    },
  },
  {
    name: 'Soft',
    description: 'Large radii, pill buttons and gentle shadows.',
    overrides: {
      primary: '#5b5bd6',
      'border-radius': '.75rem',
      'border-radius-sm': '.5rem',
      'border-radius-lg': '1rem',
      'btn-border-radius': '50rem',
      'btn-border-radius-sm': '50rem',
      'btn-border-radius-lg': '50rem',
      'enable-shadows': 'true',
      'card-border-width': '0',
    },
  },
  {
    name: 'Compact',
    description: 'Smaller type and tighter spacing for dense tools.',
    overrides: {
      'font-size-base': '.875rem',
      spacer: '.75rem',
      'input-btn-padding-y': '.25rem',
      'input-btn-padding-x': '.5rem',
      'table-cell-padding-y': '.3rem',
      'table-cell-padding-x': '.4rem',
      'card-spacer-y': '.75rem',
      'card-spacer-x': '.75rem',
    },
  },
  {
    name: 'High contrast',
    description: 'Darker theme colours that pass WCAG AA on white.',
    overrides: {
      primary: '#0a4fb5',
      success: '#146c43',
      info: '#055160',
      warning: '#7a5800',
      danger: '#a52834',
      'body-color': '#000',
      'link-decoration': 'underline',
      'min-contrast-ratio': '7',
      'focus-ring-width': '.3rem',
    },
  },
];

/** Variables shown first, under "Common", because almost every theme touches them. */
export const COMMON_VARIABLES: readonly string[] = [
  'primary',
  'secondary',
  'success',
  'info',
  'warning',
  'danger',
  'light',
  'dark',
  'body-bg',
  'body-color',
  'link-color',
  'font-family-sans-serif',
  'font-size-base',
  'line-height-base',
  'headings-font-weight',
  'border-radius',
  'border-width',
  'spacer',
  'enable-rounded',
  'enable-shadows',
  'enable-gradients',
  'enable-transitions',
  'enable-dark-mode',
];
