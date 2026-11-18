/** Main-thread side of the recipe worker: one bake at a time, newer requests replace older ones, Stop restarts the worker. */
import type { Dish } from './core';
import type { BakeOutcome, Step } from './engine';
import type { HostReply, HostRequest } from './host';
import type { BakeReply, BakeRequest } from './worker';

/** The worker's source while developing; in the app, the entry the build emits beside this chunk (see vite.config.ts). */
const WORKER_SCRIPT = import.meta.env.DEV ? './worker.ts' : './recipe-worker.js';

export class Stopped extends Error {
  constructor() {
    super('Stopped');
    this.name = 'Stopped';
  }
}

let worker: Worker | null = null;
let failed = typeof Worker === 'undefined';
let nextId = 1;
let pending: { id: number; resolve: (outcome: BakeOutcome) => void; reject: (error: Error) => void } | null = null;

function spawn(): Worker | null {
  if (failed) return null;
  try {
    const created = new Worker(new URL(WORKER_SCRIPT, import.meta.url), { type: 'module', name: 'benchtop-recipe' });
    created.onmessage = (event: MessageEvent<BakeReply | HostRequest | { ready: true }>) => {
      const reply = event.data;
      if ('ready' in reply) return;
      if ('host' in reply) {
        const { id, method, payload } = reply.host;
        import('./host-main')
          .then(({ handleHostCall }) => handleHostCall(method, payload))
          .then(
            (value): HostReply => ({ hostReply: { id, ok: true, value } }),
            (error: unknown): HostReply => ({ hostReply: { id, ok: false, error: error instanceof Error ? error.message : String(error) } }),
          )
          .then((answer) => {
            // A Stop may have replaced the worker meanwhile; the old one is gone and needs no answer.
            if (worker === created) created.postMessage(answer);
          });
        return;
      }
      if (pending && reply.id === pending.id) {
        const done = pending;
        pending = null;
        done.resolve(reply.outcome);
      }
    };
    created.onerror = (event) => {
      event.preventDefault?.();
      failed = true;
      worker = null;
      pending?.reject(new Error('The recipe worker could not start.'));
      pending = null;
    };
    return created;
  } catch {
    failed = true;
    return null;
  }
}

async function inline(input: Dish, steps: readonly Step[]): Promise<BakeOutcome> {
  const [{ bake }, { catalog }] = await Promise.all([import('./engine'), import('./catalog')]);
  return bake(input, steps, catalog);
}

export function bakeRecipe(input: Dish, steps: readonly Step[]): Promise<BakeOutcome> {
  if (pending) stop();
  worker ??= spawn();
  if (!worker) return inline(input, steps);
  const id = nextId++;
  const request: BakeRequest = { id, input, steps };
  return new Promise<BakeOutcome>((resolve, reject) => {
    pending = { id, resolve, reject };
    try {
      (worker as Worker).postMessage(request);
    } catch (error) {
      pending = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Abandons the running bake by restarting the worker. */
export function stop(): void {
  if (!pending) return;
  worker?.terminate();
  worker = null;
  const cancelled = pending;
  pending = null;
  cancelled.reject(new Stopped());
}

export const isBaking = (): boolean => pending !== null;
