/**
 * Main-thread side of the background worker.
 *
 * - One job runs at a time; a newer job on the same channel replaces queued ones.
 * - If the running job is on the same channel and has been going for a while,
 *   the worker is restarted so the newer input is processed immediately.  This
 *   is also what makes long-running work cancellable.
 * - If the worker cannot start at all, everything silently runs on the main
 *   thread instead, so the app keeps working in restricted environments.
 */
import type { CompileResult } from '../lib/bootstrap-compile';
import type { ThemeSource } from '../lib/bootstrap-theme';
import type { EncodeRequest } from '../lib/image-codecs';
import type { TextResult, TextToolSpec } from '../tools/types';
import type { Job, TextJob, WorkerReply, WorkerRequest } from './protocol';
import { deserializeError, executeJob } from './run';

/** A newer request replaced this one; its result is no longer wanted. */
export class Superseded extends Error {
  constructor() {
    super('Superseded by a newer request');
    this.name = 'Superseded';
  }
}

class WorkerUnavailable extends Error {}

interface Pending {
  readonly id: number;
  readonly channel: string;
  readonly job: Job;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  startedAt: number;
}

/** How long a running job is given before a newer one on its channel pre-empts it. */
const PREEMPT_AFTER_MS = 750;

let worker: Worker | null = null;
let everReady = false;
let unavailable = typeof Worker === 'undefined';
let nextId = 1;
let active: Pending | null = null;
const queue: Pending[] = [];

function shutDown(reason: Error): void {
  worker?.terminate();
  worker = null;
  const failed = active;
  active = null;
  failed?.reject(reason);
}

function spawn(): Worker | null {
  try {
    const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'benchtop-worker' });
    created.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if ('ready' in reply) {
        everReady = true;
        return;
      }
      if (!active || reply.id !== active.id) return;
      const done = active;
      active = null;
      if (reply.ok) done.resolve(reply.result);
      else done.reject(deserializeError(reply.error));
      pump();
    };
    created.onerror = (event) => {
      event.preventDefault?.();
      // A worker that never reported ready cannot load in this environment; stop trying.
      if (!everReady) unavailable = true;
      shutDown(new WorkerUnavailable());
      if (unavailable) for (const pending of queue.splice(0)) pending.reject(new WorkerUnavailable());
      else pump();
    };
    return created;
  } catch {
    unavailable = true;
    return null;
  }
}

function pump(): void {
  if (active || queue.length === 0) return;
  worker ??= spawn();
  if (!worker) {
    for (const pending of queue.splice(0)) pending.reject(new WorkerUnavailable());
    return;
  }
  active = queue.shift() ?? null;
  if (!active) return;
  active.startedAt = performance.now();
  const request: WorkerRequest = { id: active.id, job: active.job };
  worker.postMessage(request);
}

function submit<T>(job: Job, channel: string): Promise<T> {
  if (unavailable) return Promise.reject(new WorkerUnavailable());
  for (let index = queue.length - 1; index >= 0; index--) {
    const pending = queue[index];
    if (pending && pending.channel === channel) {
      queue.splice(index, 1);
      pending.reject(new Superseded());
    }
  }
  if (active && active.channel === channel && performance.now() - active.startedAt > PREEMPT_AFTER_MS) {
    shutDown(new Superseded());
  }
  return new Promise<T>((resolve, reject) => {
    queue.push({ id: nextId++, channel, job, resolve: resolve as (value: unknown) => void, reject, startedAt: 0 });
    pump();
  });
}

export type TextPayload = Omit<TextJob, 'kind' | 'tool'>;

export async function runTextTool(
  id: string,
  // biome-ignore lint/suspicious/noExplicitAny: accepts every tool spec
  spec: TextToolSpec<any>,
  payload: TextPayload,
): Promise<TextResult> {
  const direct = async (): Promise<TextResult> => {
    const result = await spec.run(payload.input, payload.values, { input2: payload.input2, file: payload.file, nonce: payload.nonce });
    return typeof result === 'string' ? { output: result } : result;
  };
  if (spec.mainThread) return direct();
  try {
    return await submit<TextResult>({ kind: 'text', tool: id, ...payload }, 'text');
  } catch (error) {
    if (error instanceof WorkerUnavailable) return direct();
    throw error;
  }
}

export async function encodeImage(request: EncodeRequest): Promise<Uint8Array> {
  try {
    return await submit<Uint8Array>({ kind: 'encode', ...request }, 'encode');
  } catch (error) {
    if (error instanceof WorkerUnavailable) return (await executeJob({ kind: 'encode', ...request })) as Uint8Array;
    throw error;
  }
}

/** Compiles a Bootstrap theme with Dart Sass, off the main thread when possible. */
export async function compileBootstrap(theme: ThemeSource, style: 'expanded' | 'compressed' = 'expanded'): Promise<CompileResult> {
  try {
    return await submit<CompileResult>({ kind: 'sass', theme, style }, `sass-${style}`);
  } catch (error) {
    if (error instanceof WorkerUnavailable) return (await executeJob({ kind: 'sass', theme, style })) as CompileResult;
    throw error;
  }
}
