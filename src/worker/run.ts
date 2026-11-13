/** Executes a job.  Shared by the worker and by the main-thread fallback. */
import { ToolError } from '../lib/errors';
import { isTextToolId, textToolLoaders } from '../tools/text';
import type { TextResult } from '../tools/types';
import type { Job, SerializedError, TextJob } from './protocol';

export async function runTextJob(job: TextJob): Promise<TextResult> {
  if (!isTextToolId(job.tool)) throw new Error(`Unknown tool "${job.tool}".`);
  const { default: spec } = await textToolLoaders[job.tool]();
  const result = await spec.run(job.input, job.values as never, { input2: job.input2, file: job.file, nonce: job.nonce });
  return typeof result === 'string' ? { output: result } : result;
}

export async function executeJob(job: Job): Promise<unknown> {
  if (job.kind === 'text') return runTextJob(job);
  if (job.kind === 'sass') {
    const { compileTheme } = await import('../lib/bootstrap-compile');
    return compileTheme(job.theme, job.style);
  }
  const { encodeRgba } = await import('../lib/image-codecs');
  return encodeRgba(job);
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof ToolError) return { message: error.message, line: error.line, column: error.column, expected: true };
  const message = error instanceof Error ? error.message : String(error);
  return { message, expected: false };
}

export function deserializeError(error: SerializedError): Error {
  return error.expected ? new ToolError(error.message, { line: error.line, column: error.column }) : new Error(error.message);
}
