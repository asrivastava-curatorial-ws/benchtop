/**
 * Thin wrapper around Prettier's standalone build.  Parsers are loaded on
 * demand so that only the languages actually used are read from disk.
 */
import { ToolError } from './errors';

export type PrettierParser = 'babel' | 'typescript' | 'css' | 'scss' | 'less';

export interface PrettierOptions {
  readonly tabWidth?: number;
  readonly useTabs?: boolean;
  readonly printWidth?: number;
  readonly semi?: boolean;
  readonly singleQuote?: boolean;
  readonly trailingComma?: 'all' | 'es5' | 'none';
}

async function pluginsFor(parser: PrettierParser): Promise<unknown[]> {
  switch (parser) {
    case 'babel':
      return Promise.all([import('prettier/plugins/babel'), import('prettier/plugins/estree')]);
    case 'typescript':
      return Promise.all([import('prettier/plugins/typescript'), import('prettier/plugins/estree')]);
    default:
      return Promise.all([import('prettier/plugins/postcss')]);
  }
}

export async function formatWithPrettier(code: string, parser: PrettierParser, options: PrettierOptions = {}): Promise<string> {
  const [prettier, plugins] = await Promise.all([import('prettier/standalone'), pluginsFor(parser)]);
  try {
    return await prettier.format(code, { parser, plugins: plugins as never[], ...options });
  } catch (error) {
    const loc = (error as { loc?: { start?: { line?: number; column?: number } } }).loc?.start;
    // Prettier appends a code frame after the first line; the editor already shows the code.
    const message = (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? 'Syntax error';
    throw new ToolError(message, { line: loc?.line, column: loc?.column });
  }
}

/** Indentation options shared by the formatters: "2", "4" or "tab". */
export function prettierIndent(indent: string): Pick<PrettierOptions, 'tabWidth' | 'useTabs'> {
  return indent === 'tab' ? { useTabs: true, tabWidth: 4 } : { useTabs: false, tabWidth: Number.parseInt(indent, 10) || 2 };
}

/** Size of the text after gzip, when the platform can compute it. */
export async function gzipSize(text: string): Promise<number | undefined> {
  if (typeof CompressionStream === 'undefined') return undefined;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return (await new Response(stream).arrayBuffer()).byteLength;
  } catch {
    return undefined;
  }
}
