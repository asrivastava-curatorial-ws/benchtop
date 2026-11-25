/**
 * Types for the parts of @theatre/core this app uses.  The package's own
 * declarations extend Object.keys and Object.entries for every file in the
 * program, which changes how unrelated code type-checks, so tsconfig points
 * the module name here instead.
 */
export interface ISheetObject {
  readonly value: Record<string, unknown>;
  onValuesChange(callback: (values: Record<string, unknown>) => void): () => void;
}

export interface ISequence {
  position: number;
  readonly pointer: { readonly position: unknown; readonly length: unknown; readonly playing: unknown };
  play(conf?: { iterationCount?: number; range?: [number, number]; rate?: number; direction?: 'normal' | 'reverse' | 'alternate' | 'alternateReverse' }): Promise<boolean>;
  pause(): void;
  /** Plays this sound with the sequence from then on (a URL, or samples with the context to play them in). */
  attachAudio(args: {
    source: string | AudioBuffer;
    audioContext?: AudioContext;
    destinationNode?: AudioNode;
  }): Promise<{ decodedBuffer: AudioBuffer; audioContext: AudioContext; destinationNode: AudioNode; gainNode: GainNode }>;
}

export interface ISheet {
  readonly sequence: ISequence;
  object(key: string, config: Record<string, unknown>): ISheetObject;
}

export interface IProject {
  readonly ready: Promise<void>;
  sheet(id: string, instanceId?: string): ISheet;
}

export function getProject(id: string, config?: { state?: unknown }): IProject;
export function onChange<T>(pointer: unknown, callback: (value: T) => void): () => void;
export function val<T>(pointer: unknown): T;
export const types: {
  number(value: number, options?: { range?: [number, number] }): unknown;
  rgba(value: { r: number; g: number; b: number; a: number }): unknown;
};
