/**
 * Compiles Bootstrap from its own Sass sources, bundled with the app, using
 * Dart Sass compiled to JavaScript.  Runs in a worker in the app and directly
 * in the unit tests.
 */
import * as sass from 'sass';
import { themeCatalogue } from './bootstrap-catalogue';
import { buildEntry, type ThemeSource } from './bootstrap-theme';
import { ToolError } from './errors';

const RAW = import.meta.glob('../../node_modules/bootstrap/scss/**/*.scss', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const ROOT = 'bootstrap:/';
const SOURCES = new Map<string, string>();
for (const [path, text] of Object.entries(RAW)) {
  const relative = path.slice(path.indexOf('/scss/') + '/scss/'.length);
  SOURCES.set(`${ROOT}${relative}`, text);
}

export function bootstrapSource(file: string): string {
  const text = SOURCES.get(`${ROOT}${file}`);
  if (text === undefined) throw new Error(`Bootstrap source "${file}" is missing from the bundle.`);
  return text;
}

/** Resolves an import the way Sass looks up partials: `x`, `_x.scss`, `x.scss`, `x/_index.scss`. */
function resolve(url: string, from: string | null): string | null {
  let target: URL;
  try {
    target = url === 'bootstrap' || url === 'bootstrap/scss/bootstrap' ? new URL(`${ROOT}bootstrap`) : new URL(url, from ?? ROOT);
  } catch {
    return null;
  }
  if (target.protocol !== 'bootstrap:') return null;
  const href = target.href.replace(/\.scss$/, '');
  const slash = href.lastIndexOf('/');
  const dir = href.slice(0, slash + 1);
  const base = href.slice(slash + 1);
  for (const candidate of [`${dir}_${base}.scss`, `${dir}${base}.scss`, `${href}/_index.scss`, `${href}/index.scss`]) {
    if (SOURCES.has(candidate)) return candidate;
  }
  return null;
}

const importer: sass.Importer<'sync'> = {
  canonicalize(url, context) {
    const found = resolve(url, context.containingUrl?.href ?? null);
    return found ? new URL(found) : null;
  },
  load(canonicalUrl) {
    const contents = SOURCES.get(canonicalUrl.href);
    return contents === undefined ? null : { contents, syntax: 'scss' };
  },
};

export interface CompileResult {
  readonly css: string;
  readonly warnings: readonly string[];
  readonly milliseconds: number;
}

/** A Sass error explained for the user.  The message starts with `$name:` when an override caused it. */
export class ThemeCompileError extends ToolError {
  readonly variable: string | undefined;
  constructor(message: string, line?: number, variable?: string) {
    super(message, { line });
    this.name = 'ThemeCompileError';
    this.variable = variable;
  }
}

/** Bootstrap 5.3 still uses `@import` and global functions; these notices are about Bootstrap, not the theme. */
const SILENCED: sass.DeprecationOrId[] = ['import', 'global-builtin', 'color-functions', 'abs-percent', 'slash-div', 'if-function'];

export function compileTheme(theme: ThemeSource, style: 'expanded' | 'compressed' = 'expanded'): CompileResult {
  const started = performance.now();
  const { scss, lineToVariable } = buildEntry(theme, themeCatalogue());
  const warnings: string[] = [];
  try {
    const result = sass.compileString(scss, {
      importers: [importer],
      style,
      charset: false,
      quietDeps: true,
      silenceDeprecations: SILENCED.filter((id) => {
        const known = (sass.deprecations as unknown as Record<string, sass.Deprecation | undefined>)[id as string];
        return known !== undefined && !known.obsoleteIn;
      }),
      logger: {
        warn(message, options) {
          // Only report problems in the user's own Sass, not in Bootstrap's sources.
          const url = options.span?.url?.href;
          if (url === undefined || !url.startsWith(ROOT)) warnings.push(message.split('\n')[0] ?? message);
        },
        debug() {},
      },
    });
    return { css: result.css, warnings, milliseconds: Math.round(performance.now() - started) };
  } catch (error) {
    if (error instanceof sass.Exception) {
      const span = error.span;
      const inEntry = span.url === undefined || span.url === null || !span.url.href.startsWith(ROOT);
      const line = inEntry ? span.start.line + 1 : undefined;
      const variable = line !== undefined ? lineToVariable.get(line) : undefined;
      const reason = error.sassMessage;
      if (variable) throw new ThemeCompileError(`$${variable}: ${reason}`, line, variable);
      if (inEntry) throw new ThemeCompileError(`Extra Sass, line ${span.start.line + 1 - lineToVariable.size - 2}: ${reason}`, line);
      const where = span.url ? span.url.href.slice(ROOT.length) : 'Bootstrap';
      throw new ThemeCompileError(`${reason} (in Bootstrap's ${where}, usually caused by an override with the wrong type of value)`);
    }
    throw error;
  }
}
