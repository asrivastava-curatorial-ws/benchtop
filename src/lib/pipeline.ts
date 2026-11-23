/**
 * File pipelines: the same chain of text tools run over many files.  Each
 * step's output is the next step's input; a step that fails stops that file
 * only.  The pipeline itself (steps, options, naming) saves as a small JSON
 * file so it can be reused.
 */
import type { Lang, TextResult, Values } from '../tools/types';

export interface PipelineStep {
  /** A text tool id, or "plugin:<id>" for a plugin. */
  readonly tool: string;
  readonly values: Values;
}

export type NameRule = 'keep' | 'last' | 'custom';

export interface Pipeline {
  readonly steps: readonly PipelineStep[];
  readonly naming: NameRule;
  /** Extension for the "custom" rule, without the dot. */
  readonly extension: string;
}

export interface ChainResult {
  readonly output: string;
  readonly language?: Lang;
  readonly filename?: string;
  /** One line per step: its info line, or "done". */
  readonly log: readonly string[];
}

export const EXTENSION_OF: Record<Lang, string> = {
  text: 'txt',
  json: 'json',
  javascript: 'js',
  typescript: 'ts',
  jsx: 'jsx',
  html: 'html',
  css: 'css',
  xml: 'xml',
  markdown: 'md',
  yaml: 'yaml',
  sql: 'sql',
  cpp: 'cpp',
  python: 'py',
};

export class StepError extends Error {
  constructor(
    readonly step: number,
    message: string,
  ) {
    super(message);
    this.name = 'StepError';
  }
}

/** Runs one input through every step in turn. */
export async function runChain(input: string, steps: readonly PipelineStep[], run: (step: PipelineStep, input: string) => Promise<TextResult>): Promise<ChainResult> {
  let text = input;
  let language: Lang | undefined;
  let filename: string | undefined;
  const log: string[] = [];
  for (const [index, step] of steps.entries()) {
    let result: TextResult;
    try {
      result = await run(step, text);
    } catch (error) {
      throw new StepError(index, error instanceof Error ? error.message : String(error));
    }
    if (typeof result.output !== 'string') throw new StepError(index, 'This step gives no text to pass on (it only shows a summary or a picture).');
    text = result.output;
    language = result.language ?? language;
    filename = result.filename ?? filename;
    log.push(result.info ?? 'done');
  }
  return { output: text, ...(language ? { language } : {}), ...(filename ? { filename } : {}), log };
}

const extensionOf = (name: string) => /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1];

/** The result's file name under the pipeline's naming rule. */
export function outputName(input: string, pipeline: Pick<Pipeline, 'naming' | 'extension'>, result: Pick<ChainResult, 'language' | 'filename'>): string {
  const base = input.replace(/\.[A-Za-z0-9]{1,10}$/, '') || 'file';
  if (pipeline.naming === 'keep') return input;
  if (pipeline.naming === 'custom') {
    const ext = pipeline.extension
      .trim()
      .replace(/^\.+/, '')
      .replace(/[^\w.-]/g, '');
    return ext ? `${base}.${ext}` : base;
  }
  const ext = (result.filename && extensionOf(result.filename)) ?? (result.language ? EXTENSION_OF[result.language] : undefined) ?? extensionOf(input);
  return ext ? `${base}.${ext}` : base;
}

/** Makes names unique: "a.md", "a (2).md", … */
export function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function serializePipeline(pipeline: Pipeline): string {
  return `${JSON.stringify({ benchtop: 'pipeline', version: 1, ...pipeline }, null, 2)}\n`;
}

export function parsePipeline(text: string): Pipeline {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a pipeline file (it is not JSON).');
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.benchtop !== 'pipeline' || !Array.isArray(o.steps)) throw new Error('This JSON file is not a Benchtop pipeline.');
  const steps = o.steps
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof (s as Record<string, unknown>).tool === 'string')
    .map((s) => ({ tool: String(s.tool), values: s.values && typeof s.values === 'object' && !Array.isArray(s.values) ? (s.values as Values) : {} }));
  const naming: NameRule = o.naming === 'keep' || o.naming === 'custom' ? o.naming : 'last';
  return { steps, naming, extension: typeof o.extension === 'string' ? o.extension : '' };
}
