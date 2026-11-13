/** Messages exchanged between the UI thread and the background worker. */
import type { ThemeSource } from '../lib/bootstrap-theme';
import type { EncodeRequest } from '../lib/image-codecs';
import type { BinaryFile, Values } from '../tools/types';

export interface TextJob {
  readonly kind: 'text';
  readonly tool: string;
  readonly input: string;
  readonly input2: string;
  readonly file: BinaryFile | null;
  readonly values: Values;
  readonly nonce: number;
}

export interface EncodeJob extends EncodeRequest {
  readonly kind: 'encode';
}

export interface SassJob {
  readonly kind: 'sass';
  readonly theme: ThemeSource;
  readonly style: 'expanded' | 'compressed';
}

export type Job = TextJob | EncodeJob | SassJob;

export interface WorkerRequest {
  readonly id: number;
  readonly job: Job;
}

export interface SerializedError {
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  /** A ToolError: the message is written for the user and can be shown as-is. */
  readonly expected: boolean;
}

export type WorkerReply =
  | { readonly ready: true }
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: SerializedError };
