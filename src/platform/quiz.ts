/**
 * The presenter's end of the Live Quiz relay in the desktop shell (quiz.rs):
 * a small server that phones on the local network open to take part.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { HostHub } from '../lib/quiz-hub';

export interface LanHub extends HostHub {
  /** Addresses that open the quiz: this computer first, then the local network. */
  readonly urls: string[];
}

export async function lanHost(lan: boolean): Promise<LanHub> {
  const started = await invoke<{ port: number; urls: string[] }>('quiz_start', { lan });
  const hub: LanHub = {
    urls: started.urls,
    onMessage: null,
    publish(views, anyone) {
      const text = Object.fromEntries(Object.entries(views).map(([id, view]) => [id, JSON.stringify(view)]));
      void invoke('quiz_publish', { views: text, anyone: JSON.stringify(anyone) }).catch(() => undefined);
    },
    file: (key, data) => void invoke('quiz_file', { key, data }).catch(() => undefined),
    drop: (id) => void invoke('quiz_drop', { id }).catch(() => undefined),
    close() {
      void unlisten.then((stop) => stop());
      void invoke('quiz_stop').catch(() => undefined);
    },
  };
  const unlisten = listen<{ from: string; message: unknown }>('quiz-message', (event) => hub.onMessage?.(event.payload.from, event.payload.message));
  await unlisten;
  return hub;
}
