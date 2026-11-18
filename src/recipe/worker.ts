/** Runs recipes off the UI thread, so a slow or looping recipe can always be stopped. */
import { catalog } from './catalog';
import './ops/cyberchef-loaders';
import type { Dish } from './core';
import { type BakeOutcome, bake, type Step } from './engine';
import { type HostReply, type HostRequest, setHostCaller } from './host';

export interface BakeRequest {
  readonly id: number;
  readonly input: Dish;
  readonly steps: readonly Step[];
}

export interface BakeReply {
  readonly id: number;
  readonly outcome: BakeOutcome;
}

interface Scope {
  onmessage: ((event: MessageEvent<BakeRequest | HostReply>) => void) | null;
  postMessage(message: BakeReply | HostRequest | { ready: true }): void;
}

const scope = self as unknown as Scope;

// Operations that need the app (network, OCR) ask the main thread and wait for its answer.
let nextHostId = 1;
const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
setHostCaller(
  (method, payload) =>
    new Promise((resolve, reject) => {
      const id = nextHostId++;
      waiting.set(id, { resolve, reject });
      scope.postMessage({ host: { id, method, payload } });
    }),
);

scope.onmessage = (event) => {
  if ('hostReply' in event.data) {
    const { id, ok, value, error } = event.data.hostReply;
    const call = waiting.get(id);
    waiting.delete(id);
    if (ok) call?.resolve(value);
    else call?.reject(new Error(error ?? 'The request failed.'));
    return;
  }
  const { id, input, steps } = event.data;
  bake(input, steps, catalog).then(
    (outcome) => scope.postMessage({ id, outcome }),
    (error: unknown) => scope.postMessage({ id, outcome: { value: '', error: { step: -1, message: error instanceof Error ? error.message : String(error) }, ms: 0 } }),
  );
};

scope.postMessage({ ready: true });
