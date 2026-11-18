/**
 * Recipe: Benchtop's own rebuild of CyberChef.  Operations are chained into a
 * recipe that runs in a worker as you type; CyberChef recipes (JSON, the
 * compact link format or a whole CyberChef URL) can be loaded and saved.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { formatBytes } from '../../lib/bytes';
import { errorMessage } from '../../lib/errors';
import { hexDump } from '../../lib/text';
import { copyText, pickFile, readBinaryFile, readClipboardText, saveFile } from '../../platform';
import { catalog, findOperation, OPERATIONS, operationsIn } from '../../recipe/catalog';
import { bakeRecipe, Stopped, stop } from '../../recipe/client';
import { type ArgDef, type Args, CATEGORY_ORDER, defaultArgs, type Operation, toBytes, toText } from '../../recipe/core';
import type { BakeOutcome, Step } from '../../recipe/engine';
import { detectFileType } from '../../recipe/filetypes';
import { parseRecipe, toChefFormat, toCyberChefJson } from '../../recipe/format';
import { RECIPE_ADD_EVENT, takePendingOperation } from '../../recipe/launch';
import type { MagicSuggestion } from '../../recipe/magic';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { PreviewView } from '../../ui/Preview';
import { SendTo } from '../../ui/SendTo';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

interface Saved {
  readonly steps: Step[];
  readonly autoBake: boolean;
  readonly favourites: string[];
  readonly open: string[];
  readonly library: { readonly name: string; readonly steps: Step[] }[];
}

const MAX_SHOWN = 1024 * 1024;

function readSaved(stored: Values | undefined): Saved {
  const steps = Array.isArray(stored?.steps) ? (stored.steps as Step[]).filter((s) => typeof s?.op === 'string' && catalog.get(s.op)) : [];
  return {
    steps: steps.map((s) => ({ ...s, args: { ...defaultArgs(catalog.get(s.op) as Operation), ...s.args } })),
    autoBake: stored?.autoBake !== false,
    favourites: Array.isArray(stored?.favourites) ? (stored.favourites as string[]).filter((id) => catalog.get(id)) : ['to-base64', 'from-base64', 'to-hex', 'from-hex', 'url-decode', 'magic'],
    open: Array.isArray(stored?.open) ? (stored.open as string[]) : ['Favourites'],
    library: Array.isArray(stored?.library) ? (stored.library as Saved['library']) : [],
  };
}

/* ------------------------------------------------------------ controls -- */

function ArgControl({ def, args, onChange, id }: { def: ArgDef; args: Args; onChange: (patch: Args) => void; id: string }) {
  const value = args[def.key];
  const set = (v: string | number | boolean) => onChange({ [def.key]: v });
  switch (def.type) {
    case 'boolean':
      return (
        <label class="toggle recipe-toggle" for={id}>
          <input id={id} type="checkbox" role="switch" aria-checked={value === true} checked={value === true} onChange={(e) => set(e.currentTarget.checked)} />
          <span class="toggle-track" aria-hidden="true" />
          <span class="toggle-text">{def.label}</span>
        </label>
      );
    case 'number':
      return (
        <input
          id={id}
          class="input input-mono"
          type="number"
          value={Number(value)}
          min={def.min}
          max={def.max}
          step={def.step ?? 1}
          onInput={(e) => e.currentTarget.value !== '' && set(Number(e.currentTarget.value))}
        />
      );
    case 'select':
      return (
        <select id={id} class="input" value={String(value)} onChange={(e) => set(e.currentTarget.value)}>
          {def.choices.map((c) => (
            <option key={c} value={c}>
              {c === '' ? '(none)' : c}
            </option>
          ))}
        </select>
      );
    case 'editable':
      return (
        <div class="recipe-pair">
          <input id={id} class="input input-mono" type="text" value={String(value)} spellcheck={false} autocomplete="off" onInput={(e) => set(e.currentTarget.value)} />
          <select
            class="input"
            aria-label={`${def.label} presets`}
            value={def.choices.find((c) => c.value === value)?.value ?? '__custom'}
            onChange={(e) => e.currentTarget.value !== '__custom' && set(e.currentTarget.value)}
          >
            {!def.choices.some((c) => c.value === value) && <option value="__custom">Custom</option>}
            {def.choices.map((c) => (
              <option key={c.label} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      );
    case 'keyed':
      return (
        <div class="recipe-pair">
          <input id={id} class="input input-mono" type="text" value={String(value)} spellcheck={false} autocomplete="off" onInput={(e) => set(e.currentTarget.value)} />
          <select
            class="input recipe-format"
            aria-label={`${def.label} format`}
            value={String(args[`${def.key}.format`] ?? def.format)}
            onChange={(e) => onChange({ [`${def.key}.format`]: e.currentTarget.value })}
          >
            {def.formats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      );
    case 'text':
      return (
        <textarea
          id={id}
          class="input input-mono"
          rows={Math.min(6, Math.max(2, String(value).split('\n').length))}
          value={String(value)}
          spellcheck={false}
          onInput={(e) => set(e.currentTarget.value)}
        />
      );
    default:
      return <input id={id} class="input input-mono" type="text" value={String(value)} spellcheck={false} autocomplete="off" onInput={(e) => set(e.currentTarget.value)} />;
  }
}

function StepCard({
  step,
  index,
  count,
  error,
  paused,
  onChange,
  onMove,
  onRemove,
}: {
  step: Step;
  index: number;
  count: number;
  error: string | null;
  paused: boolean;
  onChange: (step: Step) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const op = catalog.get(step.op);
  if (!op) return null;
  const state = error ? ' has-error' : paused ? ' is-paused' : step.disabled ? ' is-disabled' : '';
  return (
    <li class={`recipe-step${state}${op.flow ? ' is-flow' : ''}`} data-testid="recipe-step">
      <div class="recipe-step-head">
        <span class="recipe-step-name" title={op.description}>
          {op.name}
        </span>
        <div class="recipe-step-actions">
          <button
            type="button"
            class={`icon-button${step.disabled ? ' is-on' : ''}`}
            aria-pressed={step.disabled === true}
            title={step.disabled ? 'Turn this step on' : 'Turn this step off'}
            aria-label={step.disabled ? 'Turn on' : 'Turn off'}
            onClick={() => onChange({ ...step, disabled: !step.disabled || undefined })}
          >
            <Icon name="eye" size={14} />
          </button>
          <button
            type="button"
            class={`icon-button${step.breakpoint ? ' is-on' : ''}`}
            aria-pressed={step.breakpoint === true}
            title="Stop here (breakpoint)"
            aria-label="Breakpoint"
            onClick={() => onChange({ ...step, breakpoint: !step.breakpoint || undefined })}
          >
            <span class="recipe-pause" aria-hidden="true" />
          </button>
          <button type="button" class="icon-button" disabled={index === 0} aria-label="Move up" title="Move up" onClick={() => onMove(-1)}>
            <Icon name="up" size={14} />
          </button>
          <button type="button" class="icon-button" disabled={index === count - 1} aria-label="Move down" title="Move down" onClick={() => onMove(1)}>
            <Icon name="down" size={14} />
          </button>
          <button type="button" class="icon-button" aria-label={`Remove ${op.name}`} title="Remove" onClick={onRemove}>
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
      {op.args.length > 0 && (
        <div class="recipe-args">
          {op.args.map((def) => {
            if (def.showIf && !def.showIf(step.args)) return null;
            const id = `recipe-${index}-${def.key}`;
            return (
              <div key={def.key} class={`recipe-arg recipe-arg-${def.type}`}>
                {def.type !== 'boolean' && (
                  <label class="control-label" for={id}>
                    {def.label}
                  </label>
                )}
                <ArgControl def={def} args={step.args} id={id} onChange={(patch) => onChange({ ...step, args: { ...step.args, ...patch } })} />
              </div>
            );
          })}
        </div>
      )}
      {error && (
        <p class="recipe-step-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/* --------------------------------------------------------- operations -- */

function OperationList({ saved, onAdd, onFavourite, onToggle }: { saved: Saved; onAdd: (op: Operation) => void; onFavourite: (id: string) => void; onToggle: (category: string) => void }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle === ''
        ? null
        : OPERATIONS.filter((op) => op.name.toLowerCase().includes(needle) || op.keywords?.some((k) => k.includes(needle)) || op.description.toLowerCase().includes(needle)).sort(
            (a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)) || a.name.localeCompare(b.name),
          ),
    [needle],
  );
  const item = (op: Operation) => (
    <li key={op.id} class="recipe-op">
      <button type="button" class="recipe-op-add" title={op.description} onClick={() => onAdd(op)} data-op={op.id}>
        {op.name}
      </button>
      <button
        type="button"
        class={`icon-button recipe-op-star${saved.favourites.includes(op.id) ? ' is-on' : ''}`}
        aria-label={saved.favourites.includes(op.id) ? `Remove ${op.name} from favourites` : `Add ${op.name} to favourites`}
        onClick={() => onFavourite(op.id)}
      >
        <Icon name="star" size={12} filled={saved.favourites.includes(op.id)} />
      </button>
    </li>
  );
  const groups: [string, Operation[]][] = [
    ['Favourites', saved.favourites.map((id) => catalog.get(id)).filter((op): op is Operation => op !== undefined)],
    ...CATEGORY_ORDER.map((c) => [c, operationsIn(c)] as [string, Operation[]]),
  ];
  return (
    <section class="recipe-ops" aria-label="Operations">
      <div class="search recipe-search">
        <Icon name="search" size={15} />
        <input
          type="search"
          placeholder={`Search ${OPERATIONS.length} operations`}
          aria-label="Search operations"
          value={query}
          spellcheck={false}
          onInput={(e) => setQuery(e.currentTarget.value)}
          data-testid="recipe-search"
        />
      </div>
      <div class="recipe-ops-scroll">
        {matches ? (
          <ul class="recipe-op-list">{matches.length === 0 ? <li class="recipe-empty">No operation matches "{query}".</li> : matches.map(item)}</ul>
        ) : (
          groups.map(([name, ops]) => {
            const open = saved.open.includes(name);
            return (
              <div key={name} class="recipe-group">
                <button type="button" class="recipe-group-head" aria-expanded={open} onClick={() => onToggle(name)}>
                  <span class={`twist${open ? ' is-open' : ''}`}>
                    <Icon name="chevron" size={12} />
                  </span>
                  <span>{name}</span>
                  <span class="count">{ops.length}</span>
                </button>
                {open && <ul class="recipe-op-list">{ops.map(item)}</ul>}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- output -- */

function useObjectUrl(bytes: Uint8Array | null, mime: string): string | null {
  const url = useMemo(() => (bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) : null), [bytes, mime]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

function MediaPreview({ bytes, mime }: { bytes: Uint8Array; mime: string }) {
  const url = useObjectUrl(bytes, mime);
  if (!url) return null;
  // biome-ignore lint/a11y/useMediaCaption: this plays whatever media the user's data contains; there are no captions to offer
  return mime.startsWith('video/') ? <video class="recipe-media" src={url} controls /> : <audio class="recipe-media" src={url} controls />;
}

/** Render PDF: the pages drawn with PDF.js, a few at a time as they are scrolled to. */
function PdfPages({ bytes }: { bytes: Uint8Array }) {
  const [pages, setPages] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [failure, setFailure] = useState('');
  const [limit, setLimit] = useState(5);
  useEffect(() => {
    let cancelled = false;
    let close: (() => Promise<void>) | undefined;
    setPages([]);
    setFailure('');
    (async () => {
      const { openPdf, renderPage } = await import('../../lib/pdf-render');
      const opened = await openPdf(bytes);
      close = opened.close;
      if (cancelled) return;
      setTotal(opened.doc.numPages);
      const urls: string[] = [];
      for (let n = 1; n <= Math.min(limit, opened.doc.numPages) && !cancelled; n++) {
        const canvas = await renderPage(opened.doc, n, 1.5);
        urls.push(canvas.toDataURL('image/png'));
        if (!cancelled) setPages([...urls]);
      }
    })().catch((error: unknown) => !cancelled && setFailure(errorMessage(error)));
    return () => {
      cancelled = true;
      void close?.();
    };
  }, [bytes, limit]);
  if (failure) return <p class="recipe-note">{failure}</p>;
  return (
    <div class="recipe-pdf" data-testid="recipe-pdf" {...scrollRegion('PDF pages')}>
      {pages.map((url, i) => (
        <img key={url.length + i} src={url} alt={`Page ${i + 1}`} />
      ))}
      {total > limit && (
        <button type="button" class="button button-small" onClick={() => setLimit((l) => l + 5)}>
          Show more pages ({total - limit} left)
        </button>
      )}
    </div>
  );
}

function Suggestions({ list, onPick }: { list: readonly MagicSuggestion[]; onPick: (s: MagicSuggestion) => void }) {
  return (
    <ol class="recipe-magic" data-testid="recipe-magic">
      {list.map((s, i) => (
        <li key={i}>
          <button type="button" class="recipe-magic-pick" onClick={() => onPick(s)} disabled={s.recipe.length === 0}>
            <span class="recipe-magic-recipe">{s.recipe.length === 0 ? 'Input as it is' : s.recipe.map((step) => catalog.get(step.op)?.name ?? step.op).join(' → ')}</span>
            <span class="recipe-magic-facts">
              {[s.fileType, `English ${Math.round(s.english * 100)}%`, `printable ${Math.round(s.printable * 100)}%`, `entropy ${s.entropy.toFixed(2)}`, s.matchesCrib ? 'matches crib' : '']
                .filter(Boolean)
                .join(', ')}
            </span>
            <span class="recipe-magic-preview mono">{s.preview}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------------- tool -- */

function Recipe({ toolId }: { toolId: string }) {
  const [saved, setSaved] = usePersistentState<Saved>(toolId, readSaved, (s) => ({ ...s }));
  const [input, setInput] = useState('');
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [outcome, setOutcome] = useState<BakeOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [hexView, setHexView] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [bakeCount, setBakeCount] = useState(0);
  const [recipeName, setRecipeName] = useState('');
  const latest = useRef(0);
  const lastManual = useRef(0);
  const steps = saved.steps;

  const setSteps = (next: Step[] | ((previous: Step[]) => Step[])) => setSaved((s) => ({ ...s, steps: typeof next === 'function' ? next(s.steps) : next }));
  const add = (op: Operation) => setSteps((list) => [...list, { op: op.id, args: defaultArgs(op) }]);

  // Operations chosen from the app's search arrive here.
  useEffect(() => {
    const take = () => {
      const id = takePendingOperation();
      const op = id ? findOperation(id) : undefined;
      if (op) add(op);
    };
    take();
    addEventListener(RECIPE_ADD_EVENT, take);
    return () => removeEventListener(RECIPE_ADD_EVENT, take);
  }, []);

  const inputBytes = useMemo(() => (file ? file.bytes : null), [file]);

  useEffect(() => {
    // Without auto bake, only the Bake button (a new bakeCount) starts a run.
    if (!saved.autoBake && bakeCount === lastManual.current) return;
    lastManual.current = bakeCount;
    const id = ++latest.current;
    const timer = setTimeout(() => {
      setBusy(true);
      const slowTimer = setTimeout(() => latest.current === id && setSlow(true), 400);
      bakeRecipe(inputBytes ?? input, steps)
        .then(
          (result) => {
            if (latest.current !== id) return;
            setOutcome(result);
          },
          (error: unknown) => {
            if (latest.current !== id) return;
            setOutcome({
              value: '',
              error: { step: -1, message: error instanceof Stopped ? 'Stopped. Change the recipe or input, or press Bake, to run it again.' : String((error as Error).message ?? error) },
              ms: 0,
            });
          },
        )
        .finally(() => {
          clearTimeout(slowTimer);
          if (latest.current === id) {
            setBusy(false);
            setSlow(false);
          }
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [steps, input, inputBytes, saved.autoBake, bakeCount]);

  const value = outcome && !outcome.error ? outcome.value : null;
  const outBytes = useMemo(() => (value === null ? null : toBytes(value)), [value]);
  const outText = useMemo(() => {
    if (outBytes === null) return '';
    if (hexView) return hexDump(outBytes, MAX_SHOWN);
    return toText(outBytes.length > MAX_SHOWN ? outBytes.subarray(0, MAX_SHOWN) : outBytes);
  }, [outBytes, hexView]);
  const binary = useMemo(() => {
    if (!outBytes || outBytes.length === 0) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(outBytes.subarray(0, 65536));
    } catch {
      return true;
    }
    let control = 0;
    for (const b of outBytes.subarray(0, 4096)) if (b < 9 || (b > 13 && b < 32)) control++;
    return control > 4;
  }, [outBytes]);

  const loadFile = (picked: File) =>
    attempt(async () => {
      const read = await readBinaryFile(picked);
      setFile({ name: read.name, bytes: read.bytes });
    });
  useIncomingFiles((files) => void loadFile(files[0] as File));

  const saveOutput = () =>
    attempt(async () => {
      if (!outBytes) return;
      const type = detectFileType(outBytes);
      const ext = type?.ext ?? (binary ? 'bin' : 'txt');
      const result = await saveFile(`output.${ext}`, outBytes, type?.mime);
      if (result.saved) notify(`Saved to ${result.location}`);
    });

  const pickSuggestion = (s: MagicSuggestion) => {
    setSteps((list) => {
      const at = list.findIndex((step) => catalog.get(step.op)?.flow === 'magic');
      const replacement = s.recipe.map((step) => ({ op: step.op, args: { ...step.args } }));
      return at === -1 ? [...list, ...replacement] : [...list.slice(0, at), ...replacement, ...list.slice(at + 1)];
    });
  };

  const importRecipe = (text: string) => {
    try {
      const parsed = parseRecipe(text, findOperation);
      if (parsed.steps.length === 0) throw new Error(parsed.unknown.length ? `None of these operations exist here: ${parsed.unknown.join(', ')}.` : 'No operations were found.');
      setSteps(parsed.steps);
      if (parsed.input !== undefined) {
        setFile(null);
        setInput(parsed.input);
      }
      setImporting(null);
      const loaded = `Loaded ${parsed.steps.length} step${parsed.steps.length === 1 ? '' : 's'}.`;
      notify(parsed.unknown.length ? `${loaded} Not available here: ${parsed.unknown.join(', ')}.` : loaded);
    } catch (error) {
      notify(`Could not read that recipe: ${(error as Error).message}`, 'error');
    }
  };

  const errorStep = outcome?.error?.step ?? -1;
  const preview = outcome && !outcome.error ? outcome.preview : undefined;

  return (
    <div data-testid="tool" class="tool recipe">
      <OperationList
        saved={saved}
        onAdd={add}
        onFavourite={(id) => setSaved((s) => ({ ...s, favourites: s.favourites.includes(id) ? s.favourites.filter((f) => f !== id) : [...s.favourites, id] }))}
        onToggle={(name) => setSaved((s) => ({ ...s, open: s.open.includes(name) ? s.open.filter((o) => o !== name) : [...s.open, name] }))}
      />

      <section class="recipe-steps" aria-label="Recipe">
        <div class="pane-header">
          <h2 class="pane-title">Recipe</h2>
          <div class="pane-actions">
            <button type="button" class="button button-small" onClick={() => setImporting(importing === null ? '' : null)}>
              Load
            </button>
            <button
              type="button"
              class="button button-small"
              disabled={steps.length === 0}
              onClick={() =>
                attempt(async () => {
                  await copyText(toCyberChefJson(steps, catalog.get));
                  notify('Recipe copied as CyberChef JSON.');
                })
              }
            >
              Copy
            </button>
            <button type="button" class="button button-small button-quiet" disabled={steps.length === 0} onClick={() => setSteps([])}>
              Clear
            </button>
          </div>
        </div>
        {importing !== null && (
          <div class="recipe-import">
            <textarea
              class="input input-mono"
              rows={4}
              placeholder="Paste a CyberChef recipe (JSON or From_Base64(...) format) or a CyberChef link"
              value={importing}
              onInput={(e) => setImporting(e.currentTarget.value)}
            />
            <div class="button-row">
              <button type="button" class="button button-small button-primary" onClick={() => importRecipe(importing)}>
                Load recipe
              </button>
              <button type="button" class="button button-small" onClick={() => attempt(async () => setImporting(await readClipboardText()))}>
                Paste
              </button>
              <button type="button" class="button button-small button-quiet" onClick={() => setImporting(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {steps.length === 0 ? (
          <div class="recipe-empty-state">
            <p>Pick operations on the left to build a recipe. They run top to bottom as you type.</p>
            <button type="button" class="button button-small" onClick={() => add(findOperation('Magic') as Operation)}>
              Try Magic
            </button>
          </div>
        ) : (
          <ol class="recipe-step-list">
            {steps.map((step, i) => (
              <StepCard
                key={`${i}-${step.op}`}
                step={step}
                index={i}
                count={steps.length}
                error={errorStep === i ? (outcome?.error?.message ?? null) : null}
                paused={outcome?.paused === i}
                onChange={(next) => setSteps((list) => list.map((s, j) => (j === i ? next : s)))}
                onMove={(delta) =>
                  setSteps((list) => {
                    const copy = [...list];
                    const [moved] = copy.splice(i, 1);
                    if (moved) copy.splice(i + delta, 0, moved);
                    return copy;
                  })
                }
                onRemove={() => setSteps((list) => list.filter((_, j) => j !== i))}
              />
            ))}
          </ol>
        )}
        <div class="recipe-bake">
          <button type="button" class="button button-primary" onClick={() => (busy ? stop() : setBakeCount((n) => n + 1))} data-testid="recipe-bake">
            {busy && slow ? 'Stop' : 'Bake'}
          </button>
          <label class="toggle" for="recipe-auto">
            <input
              id="recipe-auto"
              type="checkbox"
              role="switch"
              aria-checked={saved.autoBake}
              checked={saved.autoBake}
              onChange={(e) => setSaved((s) => ({ ...s, autoBake: e.currentTarget.checked }))}
            />
            <span class="toggle-track" aria-hidden="true" />
            <span class="toggle-text">Auto bake</span>
          </label>
        </div>
        <details class="recipe-library">
          <summary>Saved recipes ({saved.library.length})</summary>
          <div class="recipe-save-row">
            <input class="input" type="text" placeholder="Name for this recipe" aria-label="Recipe name" value={recipeName} onInput={(e) => setRecipeName(e.currentTarget.value)} />
            <button
              type="button"
              class="button button-small"
              disabled={steps.length === 0 || recipeName.trim() === ''}
              onClick={() => {
                const name = recipeName.trim();
                setSaved((s) => ({ ...s, library: [...s.library.filter((r) => r.name !== name), { name, steps: s.steps }] }));
                setRecipeName('');
              }}
            >
              Save
            </button>
          </div>
          <div class="button-row">
            <button
              type="button"
              class="button button-small"
              disabled={steps.length === 0}
              onClick={() =>
                attempt(async () => {
                  await copyText(toChefFormat(steps, catalog.get));
                  notify('Recipe copied in the compact CyberChef format.');
                })
              }
            >
              Copy compact
            </button>
          </div>
          <ul class="recipe-library-list">
            {saved.library.map((r) => (
              <li key={r.name}>
                <button type="button" class="link-button" onClick={() => setSteps(r.steps)}>
                  {r.name}
                </button>
                <span class="tone-muted">{r.steps.length} steps</span>
                <button type="button" class="icon-button" aria-label={`Delete ${r.name}`} onClick={() => setSaved((s) => ({ ...s, library: s.library.filter((x) => x.name !== r.name) }))}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section class="recipe-io">
        <div
          class="pane recipe-input"
          onDragOver={(e) => e.dataTransfer?.types.includes('Files') && e.preventDefault()}
          onDrop={(e) => {
            const dropped = e.dataTransfer?.files[0];
            if (dropped) {
              e.preventDefault();
              void loadFile(dropped);
            }
          }}
        >
          <div class="pane-header">
            <h2 class="pane-title">Input</h2>
            <span class="pane-meta">{file ? `${file.name}, ${formatBytes(file.bytes.length)}` : `${input.length} chars`}</span>
            <div class="pane-actions">
              <button
                type="button"
                class="icon-button"
                title="Open a file"
                aria-label="Open a file"
                onClick={() =>
                  attempt(async () => {
                    const picked = await pickFile();
                    if (picked) await loadFile(picked);
                  })
                }
              >
                <Icon name="open" size={16} />
              </button>
              <button
                type="button"
                class="icon-button"
                title="Clear the input"
                aria-label="Clear the input"
                onClick={() => {
                  setFile(null);
                  setInput('');
                }}
              >
                <Icon name="clear" size={16} />
              </button>
            </div>
          </div>
          {file ? (
            <div class="recipe-file">
              <Icon name="file" size={18} />
              <span>
                {file.name} ({formatBytes(file.bytes.length)}) is the input, as raw bytes.
              </span>
              <button type="button" class="button button-small" onClick={() => setFile(null)}>
                Use text instead
              </button>
            </div>
          ) : (
            <div class="pane-body">
              <CodeEditor value={input} onChange={setInput} label="Recipe input" placeholder="Type or paste the data to work on, or drop a file here" wrap testId="recipe-input" />
            </div>
          )}
        </div>

        <div class="pane recipe-output">
          <div class="pane-header">
            <h2 class="pane-title">Output</h2>
            <span class="pane-meta" aria-live="polite">
              {busy
                ? 'Baking…'
                : outcome?.error
                  ? ''
                  : outcome
                    ? `${outBytes ? formatBytes(outBytes.length) : ''} in ${Math.max(1, Math.round(outcome.ms))} ms${outcome.paused !== undefined ? `, paused before step ${outcome.paused + 1}` : ''}`
                    : ''}
            </span>
            <div class="pane-actions">
              <button type="button" class={`button button-small${hexView ? ' is-active' : ''}`} aria-pressed={hexView} onClick={() => setHexView(!hexView)} disabled={!outBytes}>
                Hex
              </button>
              <button
                type="button"
                class="icon-button"
                title="Copy the output"
                aria-label="Copy the output"
                disabled={!outBytes}
                onClick={() =>
                  attempt(async () => {
                    await copyText(outText);
                    notify('Output copied.');
                  })
                }
              >
                <Icon name="copy" size={16} />
              </button>
              <button type="button" class="icon-button" title="Save the output" aria-label="Save the output" disabled={!outBytes} onClick={saveOutput}>
                <Icon name="save" size={16} />
              </button>
              <button
                type="button"
                class="icon-button"
                title="Use the output as the input"
                aria-label="Use the output as the input"
                disabled={!outBytes}
                onClick={() => {
                  if (!outBytes) return;
                  if (binary) {
                    setFile({ name: 'previous output', bytes: outBytes });
                  } else {
                    setFile(null);
                    setInput(toText(outBytes));
                  }
                }}
              >
                <Icon name="swap" size={16} />
              </button>
              <SendTo
                from="recipe"
                disabled={!outBytes}
                make={() => {
                  if (!outBytes) return null;
                  const type = detectFileType(outBytes);
                  return new File([outBytes as BlobPart], `output.${type?.ext ?? (binary ? 'bin' : 'txt')}`, { type: type?.mime ?? '' });
                }}
              />
            </div>
          </div>
          {outcome?.error && (
            <p class="recipe-error" role="alert" data-testid="recipe-error">
              {outcome.error.step >= 0 ? `${catalog.get(steps[outcome.error.step]?.op ?? '')?.name ?? 'A step'} (step ${outcome.error.step + 1}): ` : ''}
              {outcome.error.message}
            </p>
          )}
          {outcome?.suggestions && outcome.suggestions.length > 0 && <Suggestions list={outcome.suggestions} onPick={pickSuggestion} />}
          {preview?.kind === 'image' && <PreviewView preview={{ kind: 'image', bytes: preview.bytes, mime: preview.mime }} name="output" />}
          {preview?.kind === 'html' && <PreviewView preview={{ kind: 'html', html: preview.html }} name="output" />}
          {preview?.kind === 'media' && <MediaPreview bytes={preview.bytes} mime={preview.mime} />}
          {preview?.kind === 'svg' && !preview.svg.startsWith(outText.slice(0, 40)) && outText.length <= 200 && (
            <p class="recipe-note mono" data-testid="recipe-output-text">
              {outText}
            </p>
          )}
          {preview?.kind === 'svg' && <PreviewView preview={{ kind: 'svg', svg: preview.svg }} name="recipe-output" />}
          {preview?.kind === 'pdf' && <PdfPages bytes={preview.bytes} />}
          {preview?.kind === 'files' && (
            <ul class="recipe-files" data-testid="recipe-files">
              {preview.files.map((f) => (
                <li key={f.name}>
                  <Icon name="file" size={14} />
                  <span class="mono">{f.name}</span>
                  <span class="tone-muted">{formatBytes(f.bytes.length)}</span>
                  <button
                    type="button"
                    class="button button-small"
                    onClick={() =>
                      attempt(async () => {
                        const result = await saveFile(f.name.split('/').pop() || 'file', f.bytes);
                        if (result.saved) notify(`Saved to ${result.location}`);
                      })
                    }
                  >
                    Save
                  </button>
                  <button type="button" class="button button-small button-quiet" onClick={() => setFile({ name: f.name, bytes: f.bytes })}>
                    Use as input
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!outcome?.error && (!preview || preview.kind === 'html') && (
            <>
              {binary && !hexView && <p class="recipe-note">Binary output ({outBytes ? formatBytes(outBytes.length) : ''}), shown one character per byte. Use Hex or Save.</p>}
              {outBytes && outBytes.length > MAX_SHOWN && <p class="recipe-note">Showing the first {formatBytes(MAX_SHOWN)}. Save to get all of it.</p>}
              <div class="pane-body">
                <CodeEditor value={outText} readOnly label="Recipe output" wrap={!hexView} testId="recipe-output" />
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default defineCustomTool(Recipe);
