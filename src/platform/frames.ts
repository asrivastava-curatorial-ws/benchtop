/**
 * Video export in the desktop shell (frames.rs): the page sends its frames as
 * PNG pictures, and FFmpeg, already installed on this computer, joins them
 * into a video with the soundtrack.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface EncodedVideo {
  readonly cancelled?: boolean;
  readonly path?: string;
  readonly name?: string;
  readonly size?: number;
  /** Token for revealResult(). */
  readonly token?: string;
}

export const beginFrames = (): Promise<string> => invoke<string>('frames_begin');

export const addFrame = (id: string, index: number, png: Uint8Array): Promise<void> => invoke('frames_add', png, { headers: { 'x-frames-id': id, 'x-frame-index': String(index) } });

export const addSound = (id: string, bytes: Uint8Array, type: string): Promise<void> => invoke('frames_audio', bytes, { headers: { 'x-frames-id': id, 'x-audio-type': type } });

export const encodeFrames = (id: string, options: { fps: number; format: 'mp4' | 'webm'; name: string }): Promise<EncodedVideo> => invoke<EncodedVideo>('frames_encode', { id, options });

export const cancelFrames = (id: string): Promise<void> => invoke('frames_cancel', { id });

export const endFrames = (id: string): Promise<void> => invoke('frames_end', { id });

export const onFramesProgress = (id: string, handler: (fraction: number) => void): Promise<UnlistenFn> =>
  listen<{ id: string; fraction: number }>('frames-progress', (event) => {
    if (event.payload.id === id) handler(event.payload.fraction);
  });
