/** Loads a tool's code on demand and shows it with the view that matches its kind. */
import type { ComponentChildren } from 'preact';
import { useEffect, useErrorBoundary, useState } from 'preact/hooks';
import { errorMessage } from '../lib/errors';
import type { AnyToolSpec, ToolEntry } from '../tools/types';
import { Icon } from '../ui/icons';
import { noteRecent, toggleFavorite, useSettings } from './store';

type Views = {
  TextToolView: typeof import('../ui/TextToolView').TextToolView;
  VisualToolView: typeof import('../ui/VisualToolView').VisualToolView;
  ImageToolView: typeof import('../ui/ImageToolView').ImageToolView;
};

async function loadView(kind: AnyToolSpec['kind']): Promise<Partial<Views>> {
  if (kind === 'text') return import('../ui/TextToolView');
  if (kind === 'visual') return import('../ui/VisualToolView');
  if (kind === 'image') return import('../ui/ImageToolView');
  return {};
}

function Boundary({ children, onRetry }: { children: ComponentChildren; onRetry: () => void }) {
  const [error, reset] = useErrorBoundary();
  if (error) {
    return (
      <div class="tool-failure" role="alert">
        <Icon name="alert" size={22} />
        <h2>This tool stopped working</h2>
        <p>{errorMessage(error)}</p>
        <button
          type="button"
          class="button button-primary"
          onClick={() => {
            reset();
            onRetry();
          }}
        >
          Reload the tool
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

export function ToolHost({ entry }: { entry: ToolEntry }) {
  const favorite = useSettings((settings) => settings.favorites.includes(entry.id));
  const [loaded, setLoaded] = useState<{ id: string; spec: AnyToolSpec; views: Partial<Views> } | { id: string; error: string } | null>(null);
  const [attemptNumber, setAttemptNumber] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    noteRecent(entry.id);
    Promise.all([entry.load(), loadView(entry.kind)]).then(
      ([module, views]) => {
        if (!cancelled) setLoaded({ id: entry.id, spec: module.default, views });
      },
      (error: unknown) => {
        if (!cancelled) setLoaded({ id: entry.id, error: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entry, attemptNumber]);

  const ready = loaded !== null && loaded.id === entry.id ? loaded : null;
  let body: ComponentChildren;
  if (ready === null) {
    body = (
      <p class="tool-loading" aria-live="polite">
        <span class="spinner" aria-hidden="true" /> Loading…
      </p>
    );
  } else if ('error' in ready) {
    body = (
      <div class="tool-failure" role="alert">
        <Icon name="alert" size={22} />
        <h2>This tool could not be loaded</h2>
        <p>{ready.error}</p>
        <button type="button" class="button button-primary" onClick={() => setAttemptNumber(attemptNumber + 1)}>
          Try again
        </button>
      </div>
    );
  } else {
    const { spec, views } = ready;
    if (spec.kind === 'text' && views.TextToolView) body = <views.TextToolView entry={entry} spec={spec} />;
    else if (spec.kind === 'visual' && views.VisualToolView) body = <views.VisualToolView entry={entry} spec={spec} />;
    else if (spec.kind === 'image' && views.ImageToolView) body = <views.ImageToolView entry={entry} spec={spec} />;
    else if (spec.kind === 'custom') body = <spec.component toolId={entry.id} />;
  }

  return (
    <div class="tool-page" key={entry.id}>
      <header class="tool-header">
        <div class="tool-heading">
          <h1>{entry.name}</h1>
          <p>{entry.description}</p>
        </div>
        <button
          type="button"
          class={`icon-button favorite${favorite ? ' is-on' : ''}`}
          aria-pressed={favorite}
          aria-label={favorite ? 'Remove from favourites' : 'Add to favourites'}
          title={favorite ? 'Remove from favourites' : 'Add to favourites'}
          onClick={() => toggleFavorite(entry.id)}
        >
          <Icon name="star" size={18} filled={favorite} />
        </button>
      </header>
      <Boundary key={`${entry.id}-${attemptNumber}`} onRetry={() => setAttemptNumber(attemptNumber + 1)}>
        {body}
      </Boundary>
    </div>
  );
}
