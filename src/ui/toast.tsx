/** Brief confirmations ("Copied", "Saved to ...") and errors from actions. */
import { useEffect, useState } from 'preact/hooks';
import { errorMessage } from '../lib/errors';

interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: 'info' | 'error';
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export function notify(text: string, tone: Toast['tone'] = 'info'): void {
  const toast = { id: nextId++, text, tone };
  toasts = [...toasts.slice(-2), toast];
  emit();
  setTimeout(
    () => {
      toasts = toasts.filter((item) => item.id !== toast.id);
      emit();
    },
    tone === 'error' ? 6000 : 2600,
  );
}

/** Runs an action and reports a failure as a toast instead of an unhandled rejection. */
export async function attempt(action: () => Promise<void> | void): Promise<void> {
  try {
    await action();
  } catch (error) {
    notify(errorMessage(error), 'error');
  }
}

export function Toasts() {
  const [items, setItems] = useState(toasts);
  useEffect(() => {
    const listener = () => setItems(toasts);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} class={`toast toast-${toast.tone}`}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}
