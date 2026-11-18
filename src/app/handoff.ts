/**
 * Handing files from one place to a tool: files dropped on the window and sent
 * to a suggested tool, or one tool's result sent on to another ("Send to").
 *
 * The sender stores the files and opens the tool; the tool takes them with
 * useIncomingFiles once it is on screen.
 */
import { useEffect, useRef } from 'preact/hooks';
import type { PickedFile } from '../platform/ai';
import { navigate, toolHref, useRoute } from './router';

export interface Handoff {
  /** Files to open in the tool. */
  readonly files?: readonly File[];
  /** Files already on disk (from a desktop "Open" dialog), for tools that work on paths. */
  readonly picked?: readonly PickedFile[];
  /** A second file some tasks use with every input (subtitles to burn in). */
  readonly extra?: File;
  /** The task to select in a toolkit (such as video-burn-subtitles). */
  readonly task?: string;
}

const EVENT = 'benchtop:handoff';
let pending: (Handoff & { readonly toolId: string }) | null = null;

export function sendToTool(toolId: string, handoff: Handoff): void {
  pending = { ...handoff, toolId };
  navigate(toolHref(toolId));
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Calls `receive` with what was sent to the tool on screen: now if it is waiting, and whenever more is sent. */
export function useHandoff(receive: (handoff: Handoff) => void): void {
  const route = useRoute();
  const toolId = route.page === 'tool' ? route.id : null;
  const handler = useRef(receive);
  handler.current = receive;
  useEffect(() => {
    const take = () => {
      if (!pending || pending.toolId !== toolId) return;
      const handoff = pending;
      pending = null;
      handler.current(handoff);
    };
    take();
    window.addEventListener(EVENT, take);
    return () => window.removeEventListener(EVENT, take);
  }, [toolId]);
}

/** The common case: files only, optionally filtered. */
export function useIncomingFiles(receive: (files: File[]) => void, accept: (file: File) => boolean = () => true): void {
  useHandoff((handoff) => {
    const files = (handoff.files ?? []).filter(accept);
    if (files.length) receive(files);
  });
}

/** The extension of a file name, lower case, without the dot. */
export const extensionOf = (name: string): string => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
