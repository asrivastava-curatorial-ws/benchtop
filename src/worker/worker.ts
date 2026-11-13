/**
 * Background worker: runs text tools and image encoders off the UI thread so
 * that a large input or a slow formatter can never freeze the window.
 */
import type { WorkerReply, WorkerRequest } from './protocol';
import { executeJob, serializeError } from './run';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, job } = event.data;
  executeJob(job).then(
    (result) => {
      const transfer = job.kind === 'encode' && result instanceof Uint8Array ? [result.buffer as ArrayBuffer] : [];
      scope.postMessage({ id, ok: true, result }, transfer);
    },
    (error: unknown) => scope.postMessage({ id, ok: false, error: serializeError(error) }),
  );
};

scope.postMessage({ ready: true });
