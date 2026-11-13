/**
 * Bootstrap theme builder: edit any of Bootstrap's Sass variables, see the
 * result compiled with Bootstrap's own sources, and export Sass or CSS.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { themeCatalogue } from '../../lib/bootstrap-catalogue';
import {
  BOOTSTRAP_VERSION,
  COMMON_VARIABLES,
  cleanValue,
  entryFile,
  parseOverrides,
  parseTheme,
  serializeTheme,
  THEME_PRESETS,
  type ThemeSource,
  type ThemeVariable,
  validateOverride,
  variablesFile,
} from '../../lib/bootstrap-theme';
import { hexOf, isColor } from '../../lib/color';
import { errorMessage } from '../../lib/errors';
import { pickFile, readTextFile } from '../../platform';
import { CodeEditor } from '../../ui/CodeEditor';
import { CodeOutput } from '../../ui/CodeOutput';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { compileBootstrap, Superseded } from '../../worker/client';
import { defineCustomTool, type Values } from '../types';
import { FRAME_WIDTHS, type FrameWidth, PreviewFrame, Segmented, usePersistentState } from './_shared';
import { type KitPage, previewDocument } from './bootstrap-kit';

interface Theme extends ThemeSource {
  readonly overrides: Readonly<Record<string, string>>;
}

const EMPTY: Theme = { name: 'My theme', overrides: {}, extraScss: '' };

function readTheme(stored: Values | undefined): Theme {
  if (!stored) return EMPTY;
  try {
    return parseTheme(JSON.stringify({ format: 'benchtop-bootstrap-theme', ...stored }));
  } catch {
    return EMPTY;
  }
}

const writeTheme = (theme: Theme): Values => ({ name: theme.name, overrides: theme.overrides, extraScss: theme.extraScss });

const RESULT_LIMIT = 150;

interface Group {
  readonly title: string;
  readonly variables: readonly ThemeVariable[];
}

function buildGroups(catalogue: readonly ThemeVariable[]): Group[] {
  const byName = new Map(catalogue.map((variable) => [variable.name, variable]));
  const groups: Group[] = [{ title: 'Common', variables: COMMON_VARIABLES.map((name) => byName.get(name)).filter((v): v is ThemeVariable => v !== undefined) }];
  const index = new Map<string, ThemeVariable[]>();
  for (const variable of catalogue) {
    let list = index.get(variable.group);
    if (!list) {
      list = [];
      index.set(variable.group, list);
      groups.push({ title: variable.group, variables: list });
    }
    list.push(variable);
  }
  return groups;
}

/** Follows `$name` references through overrides and defaults to a literal colour, if there is one. */
function resolveColor(name: string, overrides: Readonly<Record<string, string>>, byName: ReadonlyMap<string, ThemeVariable>): string | null {
  let value = overrides[name] ?? byName.get(name)?.value;
  for (let hops = 0; hops < 12 && value !== undefined; hops++) {
    const reference = /^\$([\w-]+)$/.exec(value.trim());
    if (!reference) break;
    const target = reference[1] as string;
    value = overrides[target] ?? byName.get(target)?.value;
  }
  return value !== undefined && isColor(value) ? hexOf(value) : null;
}

interface RowProps {
  readonly variable: ThemeVariable;
  readonly override: string | undefined;
  readonly swatch: string | null;
  readonly failing: boolean;
  readonly showGroup: boolean;
  readonly onSet: (name: string, value: string | undefined) => void;
}

function VariableRow({ variable, override, swatch, failing, showGroup, onSet }: RowProps) {
  const [draft, setDraft] = useState(override ?? '');
  useEffect(() => {
    if (cleanValue(draft) !== (override ?? '')) setDraft(override ?? '');
  }, [override]);
  const problem = draft.trim() === '' ? null : validateOverride(variable.name, draft);
  const id = `bs-var-${variable.name}`;

  const commit = (text: string) => {
    setDraft(text);
    const value = cleanValue(text);
    if (value === '' || value === variable.value) onSet(variable.name, undefined);
    else if (validateOverride(variable.name, value) === null) onSet(variable.name, value);
  };

  const changed = override !== undefined;
  let editor: ComponentChildren;
  if (variable.kind === 'boolean') {
    const on = (override ?? variable.value) === 'true';
    editor = (
      <label class="toggle" for={id}>
        <input id={id} type="checkbox" role="switch" aria-checked={on} checked={on} onChange={(event) => commit(event.currentTarget.checked ? 'true' : 'false')} />
        <span class="toggle-track" aria-hidden="true" />
        <span>{on ? 'true' : 'false'}</span>
      </label>
    );
  } else if (variable.kind === 'map') {
    editor = (
      <textarea
        id={id}
        class={`input input-mono${problem ? ' is-invalid' : ''}`}
        rows={3}
        spellcheck={false}
        value={draft}
        placeholder={variable.value}
        onInput={(event) => commit(event.currentTarget.value)}
      />
    );
  } else {
    editor = (
      <div class="var-input">
        {variable.kind === 'color' && (
          <input
            type="color"
            class="var-swatch"
            aria-label={`Pick a colour for $${variable.name}`}
            value={swatch ?? '#000000'}
            data-unknown={swatch === null ? 'true' : undefined}
            onInput={(event) => commit(event.currentTarget.value)}
          />
        )}
        <input
          id={id}
          class={`input input-mono${problem ? ' is-invalid' : ''}`}
          type="text"
          spellcheck={false}
          autocomplete="off"
          value={draft}
          placeholder={variable.value}
          title={`Default: ${variable.value}`}
          onInput={(event) => commit(event.currentTarget.value)}
        />
      </div>
    );
  }

  return (
    <div class={`var-row${changed ? ' is-changed' : ''}${failing ? ' is-failing' : ''}`} data-variable={variable.name}>
      <div class="var-head">
        <label class="var-name" for={id} title={variable.group}>
          ${variable.name}
        </label>
        {showGroup && <span class="var-group">{variable.group}</span>}
        {changed && (
          <button type="button" class="icon-button var-reset" title="Reset to the Bootstrap default" aria-label={`Reset $${variable.name}`} onClick={() => onSet(variable.name, undefined)}>
            <Icon name="refresh" size={13} />
          </button>
        )}
      </div>
      {editor}
      {problem && <p class="control-help tone-bad">{problem}</p>}
    </div>
  );
}

function BootstrapTheme({ toolId }: { toolId: string }) {
  const catalogue = useMemo(() => themeCatalogue(), []);
  const byName = useMemo(() => new Map(catalogue.map((variable) => [variable.name, variable])), [catalogue]);
  const groups = useMemo(() => buildGroups(catalogue), [catalogue]);
  const [theme, setTheme] = usePersistentState<Theme>(toolId, readTheme, writeTheme);
  const [query, setQuery] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(['Common']));
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [page, setPage] = useState<KitPage>('components');
  const [width, setWidth] = useState<FrameWidth>('full');
  const [compiled, setCompiled] = useState<{ css: string; warnings: readonly string[]; milliseconds: number } | null>(null);
  const [failure, setFailure] = useState<{ message: string; variable?: string } | null>(null);
  const [compiling, setCompiling] = useState(true);

  const changedCount = Object.keys(theme.overrides).length;

  useEffect(() => {
    let cancelled = false;
    setCompiling(true);
    const timer = setTimeout(
      () => {
        compileBootstrap(theme).then(
          (result) => {
            if (cancelled) return;
            setCompiled(result);
            setFailure(null);
            setCompiling(false);
          },
          (error: unknown) => {
            if (cancelled || error instanceof Superseded) return;
            const message = errorMessage(error);
            setFailure({ message, variable: /^\$([\w-]+):/.exec(message)?.[1] });
            setCompiling(false);
          },
        );
      },
      compiled ? 450 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [theme.overrides, theme.extraScss]);

  const setVariable = (name: string, value: string | undefined) =>
    setTheme((previous) => {
      const overrides = { ...previous.overrides };
      if (value === undefined) delete overrides[name];
      else overrides[name] = value;
      return { ...previous, overrides };
    });

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^\$/, '');
    if (needle !== '') {
      const matches = catalogue.filter((variable) => (variable.name.includes(needle) || variable.value.toLowerCase().includes(needle)) && (!changedOnly || variable.name in theme.overrides));
      matches.sort((a, b) => Number(!a.name.startsWith(needle)) - Number(!b.name.startsWith(needle)));
      return { search: true, total: matches.length, groups: [{ title: 'Results', variables: matches.slice(0, RESULT_LIMIT) }] };
    }
    const filtered = changedOnly
      ? groups
          .slice(1)
          .map((group) => ({ ...group, variables: group.variables.filter((variable) => variable.name in theme.overrides) }))
          .filter((group) => group.variables.length > 0)
      : groups;
    return { search: false, total: catalogue.length, groups: filtered };
  }, [query, changedOnly, catalogue, groups, theme.overrides]);

  const toggleGroup = (title: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const openFile = () =>
    attempt(async () => {
      const file = await pickFile('.json,.scss,.sass,.txt');
      if (!file) return;
      const text = await readTextFile(file);
      if (text.trimStart().startsWith('{')) {
        const loaded = parseTheme(text);
        setTheme(loaded);
        notify(`Opened "${loaded.name}" with ${Object.keys(loaded.overrides).length} changed variables`);
      } else {
        const { overrides, skipped } = parseOverrides(text);
        const known = Object.keys(overrides).filter((name) => byName.has(name)).length;
        setTheme((previous) => ({ ...previous, overrides }));
        notify(`Read ${Object.keys(overrides).length} variables (${known} are Bootstrap variables)${skipped ? `, skipped ${skipped} that could not be used` : ''}`);
      }
    });

  const html = useMemo(() => (compiled ? previewDocument(compiled.css, mode, page) : null), [compiled, mode, page]);
  const slug =
    theme.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'theme';
  const state = failure ? 'error' : compiling || !compiled ? 'busy' : 'done';

  const outputs = [
    { label: '_variables.scss', language: 'css' as const, code: variablesFile(theme, catalogue), filename: '_variables.scss' },
    { label: 'custom.scss', language: 'css' as const, code: entryFile(theme, catalogue), filename: 'custom.scss' },
    ...(compiled ? [{ label: 'bootstrap.css', language: 'css' as const, code: compiled.css, filename: 'bootstrap.css' }] : []),
  ];

  return (
    <section class="tool tool-bootstrap layout-form" data-testid="tool" data-state={state}>
      <aside class="tool-side bs-side">
        <div class="tool-options">
          <div class="control">
            <label class="control-label" for="bs-name">
              Theme name
            </label>
            <input id="bs-name" class="input" value={theme.name} maxLength={120} onInput={(event) => setTheme((previous) => ({ ...previous, name: event.currentTarget.value }))} />
          </div>
          <div class="presets" role="group" aria-label="Starting points">
            {THEME_PRESETS.map((preset) => (
              <button key={preset.name} type="button" class="chip" title={preset.description} onClick={() => setTheme((previous) => ({ ...previous, overrides: { ...preset.overrides } }))}>
                {preset.name}
              </button>
            ))}
          </div>
          <div class="button-row">
            <button type="button" class="button button-small" onClick={openFile} data-testid="bs-open">
              <Icon name="open" size={14} />
              Open theme or Sass
            </button>
            <button
              type="button"
              class="button button-small button-quiet"
              onClick={() => setTheme((previous) => ({ ...previous, overrides: {}, extraScss: '' }))}
              disabled={changedCount === 0 && theme.extraScss === ''}
            >
              Reset all
            </button>
          </div>
          <div class="bs-search">
            <Icon name="search" size={14} />
            <input
              class="input"
              type="search"
              placeholder={`Search ${catalogue.length} variables`}
              aria-label="Search variables"
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
              data-testid="bs-search"
            />
          </div>
          <label class="toggle" for="bs-changed">
            <input id="bs-changed" type="checkbox" role="switch" aria-checked={changedOnly} checked={changedOnly} onChange={(event) => setChangedOnly(event.currentTarget.checked)} />
            <span class="toggle-track" aria-hidden="true" />
            <span>Only changed ({changedCount})</span>
          </label>
        </div>
        <div class="var-groups" data-testid="bs-variables">
          {visibleGroups.groups.map((group) => {
            const expanded = visibleGroups.search || changedOnly || open.has(group.title);
            const groupChanged = group.variables.filter((variable) => variable.name in theme.overrides).length;
            return (
              <div key={group.title} class={`var-group-box${expanded ? ' is-open' : ''}`}>
                {!visibleGroups.search && (
                  <button type="button" class="var-group-title" aria-expanded={expanded} onClick={() => toggleGroup(group.title)}>
                    <Icon name="chevron" size={12} />
                    <span>{group.title}</span>
                    <span class="var-count">{groupChanged > 0 ? `${groupChanged} of ${group.variables.length}` : group.variables.length}</span>
                  </button>
                )}
                {expanded &&
                  group.variables.map((variable) => (
                    <VariableRow
                      key={variable.name}
                      variable={variable}
                      override={theme.overrides[variable.name]}
                      swatch={variable.kind === 'color' ? resolveColor(variable.name, theme.overrides, byName) : null}
                      failing={failure?.variable === variable.name}
                      showGroup={visibleGroups.search}
                      onSet={setVariable}
                    />
                  ))}
              </div>
            );
          })}
          {visibleGroups.search && visibleGroups.total === 0 && <p class="control-help">No variable matches “{query}”.</p>}
          {visibleGroups.search && visibleGroups.total > RESULT_LIMIT && (
            <p class="control-help">
              Showing the first {RESULT_LIMIT} of {visibleGroups.total} matches. Refine the search to see more.
            </p>
          )}
        </div>
      </aside>
      <div class="tool-main">
        <div class="stage-bar">
          <Segmented
            label="Preview page"
            value={page}
            onChange={setPage}
            choices={[
              { value: 'components', label: 'Components' },
              { value: 'example', label: 'Example page' },
            ]}
          />
          <Segmented
            label="Colour mode"
            value={mode}
            onChange={setMode}
            choices={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
          <Segmented label="Preview width" value={width} onChange={setWidth} choices={FRAME_WIDTHS} />
          <span class="bs-status" data-testid="status" aria-live="polite">
            {compiling ? (
              <>
                <span class="spinner" aria-hidden="true" /> Compiling
              </>
            ) : compiled && !failure ? (
              `Bootstrap ${BOOTSTRAP_VERSION}, compiled in ${(compiled.milliseconds / 1000).toFixed(1)} s`
            ) : null}
          </span>
        </div>
        {failure && (
          <p class="status status-error" role="alert">
            <Icon name="alert" size={15} />
            <span>
              {failure.message}
              {compiled ? ' The preview shows the last theme that compiled.' : ''}
            </span>
            {failure.variable && (
              <button type="button" class="button button-small" onClick={() => setQuery(failure.variable ?? '')}>
                Show ${failure.variable}
              </button>
            )}
          </p>
        )}
        {compiled && compiled.warnings.length > 0 && !failure && (
          <p class="status status-warn">
            <Icon name="alert" size={15} />
            <span>{compiled.warnings.join(' ')}</span>
          </p>
        )}
        {html ? (
          <PreviewFrame html={html} width={width} title="Bootstrap theme preview" />
        ) : (
          <div class="frame-stage frame-placeholder">
            <p class="tool-loading">
              <span class="spinner" aria-hidden="true" /> Compiling Bootstrap
            </p>
          </div>
        )}
        <details class="pane bs-extra" open={theme.extraScss.trim() !== ''}>
          <summary class="pane-header">
            <span class="pane-title">Extra Sass, compiled after Bootstrap</span>
            <span class="pane-meta">Bootstrap's functions, mixins and variables are available here.</span>
          </summary>
          <div class="pane-body">
            <CodeEditor
              value={theme.extraScss}
              onChange={(value) => setTheme((previous) => ({ ...previous, extraScss: value }))}
              language="css"
              placeholder={'.btn-brand {\n  @include button-variant($primary, $primary);\n}'}
              label="Extra Sass"
              testId="bs-extra"
            />
          </div>
        </details>
        <CodeOutput
          outputs={outputs}
          baseName={slug}
          downloads={[
            { label: 'bootstrap.min.css', filename: 'bootstrap.min.css', make: async () => (await compileBootstrap(theme, 'compressed')).css },
            { label: 'Theme file', filename: `${slug}.bootstrap-theme.json`, make: () => serializeTheme(theme, catalogue) },
          ]}
        />
      </div>
    </section>
  );
}

export default defineCustomTool(BootstrapTheme);
