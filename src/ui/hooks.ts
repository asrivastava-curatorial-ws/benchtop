import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { forgetToolOptions, getSettings, saveToolOptions } from '../app/store';
import { defaultsOf, sanitizeValues, stripSecrets } from '../tools/options';
import type { OptionDef, Values } from '../tools/types';

/**
 * Option values for a tool: restored from the previous session, validated
 * against the tool's current definitions, and saved (without secrets) as the
 * user changes them.
 */
export function useToolValues(toolId: string, defs: readonly OptionDef[]): [Values, (patch: Values) => void, () => void] {
  const [values, setValues] = useState<Values>(() => {
    const settings = getSettings();
    return sanitizeValues(defs, settings.rememberOptions ? settings.toolOptions[toolId] : undefined);
  });
  const latest = useRef(values);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const persist = useCallback(() => {
    clearTimeout(timer.current);
    // Debounced so that dragging a slider does not write to storage on every frame.
    timer.current = setTimeout(() => saveToolOptions(toolId, stripSecrets(defs, latest.current)), 400);
  }, [toolId, defs]);

  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        saveToolOptions(toolId, stripSecrets(defs, latest.current));
      }
    },
    [toolId, defs],
  );

  const patch = useCallback(
    (change: Values) => {
      latest.current = { ...latest.current, ...change };
      setValues(latest.current);
      persist();
    },
    [persist],
  );

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    latest.current = defaultsOf(defs);
    setValues(latest.current);
    forgetToolOptions(toolId);
  }, [toolId, defs]);

  return [values, patch, reset];
}

/** An object URL for a blob that is revoked when the content changes or the component unmounts. */
export function useObjectUrl(content: string | Uint8Array | Blob | null, mime: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (content === null) {
      setUrl(null);
      return;
    }
    const blob = content instanceof Blob ? content : new Blob([content as BlobPart], { type: mime });
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [content, mime]);
  return url;
}

/** True once `active` has stayed true for `delay` ms; avoids flashing a spinner for quick work. */
export function useDelayedFlag(active: boolean, delay = 220): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  return shown;
}
