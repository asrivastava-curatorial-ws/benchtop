/**
 * File Pipeline: run a chain of text tools (and plugins) over many files at
 * once, then save every result in one ZIP.  The chain saves as a small JSON
 * file to reuse later.
 */
import { strToU8, zipSync } from 'fflate';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { type NameRule, outputName, type Pipeline, type PipelineStep, parsePipeline, runChain, StepError, serializePipeline, uniqueNames } from '../../lib/pipeline';
import { describePlugin, loadPlugins, type PluginInfo, type PluginRecord, runPlugin } from '../../lib/plugins';
import { pickFile, pickFiles, readTextFile, saveFile } from '../../platform';
import { CodeEditor } from '../../ui/CodeEditor';
import { ControlsForm } from '../../ui/Controls';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { runTextTool } from '../../worker/client';
import { sanitizeValues } from '../options';
import { CATEGORIES, TOOLS } from '../registry';
import { isTextToolId, textToolLoaders } from '../text';
import { defineCustomTool, type OptionDef, type TextResult, type TextToolSpec, type Values } from '../types';
import { usePersistentState } from './_shared';

/** Generators make text from nothing and online checks need the network, so neither fits a pipeline. */
const STEP_TOOLS = TOOLS.filter((t) => t.kind === 'text' && t.category !== 'generate' && t.category !== 'online' && t.id !== 'diff' && t.id !== 'config-generator');
const STEP_GROUPS = CATEGORIES.map((c) => ({ name: c.name, tools: STEP_TOOLS.filter((t) => t.category === c.id) })).filter((g) => g.tools.length > 0);
const toolName = (id: string, plugins: readonly PluginRecord[]) =>
  id.startsWith('plugin:') ? (plugins.find((p) => `plugin:${p.id}` === id)?.name ?? 'Missing plugin') : (STEP_TOOLS.find((t) => t.id === id)?.name ?? id);

const PRESETS: readonly { name: string; pipeline: Pipeline }[] = [
  { name: 'Format JSON files', pipeline: { steps: [{ tool: 'json-formatter', values: { mode: 'format' } }], naming: 'keep', extension: '' } },
  { name: 'Minify CSS files', pipeline: { steps: [{ tool: 'css-formatter', values: { mode: 'minify' } }], naming: 'custom', extension: 'min.css' } },
  { name: 'Minify JavaScript files', pipeline: { steps: [{ tool: 'js-minifier', values: {} }], naming: 'custom', extension: 'min.js' } },
  { name: 'Markdown to HTML pages', pipeline: { steps: [{ tool: 'markdown-to-html', values: { document: true } }], naming: 'last', extension: '' } },
  {
    name: 'Clean word lists: sort and remove duplicates',
    pipeline: { steps: [{ tool: 'sort-lines', values: { unique: true, trim: true, removeEmpty: true } }], naming: 'keep', extension: '' },
  },
];

interface Row {
  readonly name: string;
  readonly size: number;
  readonly status: 'ok' | 'error';
  readonly output?: string;
  readonly outName?: string;
  readonly message?: string;
}

const readPipeline = (stored: Values | undefined): Pipeline => {
  try {
    return stored?.pipeline ? parsePipeline(JSON.stringify(stored.pipeline)) : (PRESETS[0] as (typeof PRESETS)[number]).pipeline;
  } catch {
    return (PRESETS[0] as (typeof PRESETS)[number]).pipeline;
  }
};

/** One step: which tool, and that tool's own options. */
function StepEditor({
  index,
  step,
  count,
  plugins,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  step: PipelineStep;
  count: number;
  plugins: readonly PluginRecord[];
  onChange: (step: PipelineStep) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const [defs, setDefs] = useState<readonly OptionDef[] | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let live = true;
    setDefs(null);
    setProblem('');
    const load = async (): Promise<readonly OptionDef[]> => {
      if (step.tool.startsWith('plugin:')) {
        const plugin = plugins.find((p) => `plugin:${p.id}` === step.tool);
        if (!plugin) throw new Error('This plugin is not installed. Add it in the Plugins tool.');
        return (await describePlugin(plugin.source)).options;
      }
      if (!isTextToolId(step.tool)) throw new Error('This tool does not exist in this version of Benchtop.');
      const spec = (await textToolLoaders[step.tool]()).default as TextToolSpec<readonly OptionDef[]>;
      if (spec.input === false) throw new Error('This tool makes text without any input, so it cannot work on files.');
      return spec.options;
    };
    load().then(
      (found) => live && setDefs(found),
      (error: unknown) => live && setProblem(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
    };
  }, [step.tool, plugins]);
  const values = useMemo(() => (defs ? sanitizeValues(defs, step.values) : step.values), [defs, step.values]);

  return (
    <li class="fp-step" data-testid="fp-step">
      <div class="fp-step-head">
        <span class="fp-step-number" aria-hidden="true">
          {index + 1}
        </span>
        <label class="visually-hidden" for={`fp-tool-${index}`}>
          Tool for step {index + 1}
        </label>
        <select id={`fp-tool-${index}`} class="input" value={step.tool} onChange={(e) => onChange({ tool: e.currentTarget.value, values: {} })} data-testid="fp-tool">
          {STEP_GROUPS.map((group) => (
            <optgroup key={group.name} label={group.name}>
              {group.tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ))}
          {plugins.length > 0 && (
            <optgroup label="Your plugins">
              {plugins.map((p) => (
                <option key={p.id} value={`plugin:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {!STEP_TOOLS.some((t) => t.id === step.tool) && !plugins.some((p) => `plugin:${p.id}` === step.tool) && <option value={step.tool}>{toolName(step.tool, plugins)}</option>}
        </select>
        <button type="button" class="icon-button" title="Move up" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>
          <Icon name="up" size={16} />
        </button>
        <button type="button" class="icon-button" title="Move down" aria-label={`Move step ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
          <Icon name="down" size={16} />
        </button>
        <button type="button" class="icon-button" title="Remove" aria-label={`Remove step ${index + 1}`} onClick={onRemove}>
          <Icon name="trash" size={16} />
        </button>
      </div>
      {problem && <p class="tone-bad fp-problem">{problem}</p>}
      {defs && defs.length > 0 && (
        <ControlsForm defs={defs} values={values} onChange={(patch) => onChange({ tool: step.tool, values: { ...values, ...patch } })} layout="panel" idPrefix={`fp-${index}`} />
      )}
    </li>
  );
}

function FilePipeline({ toolId }: { toolId: string }) {
  const [pipeline, setPipeline] = usePersistentState<Pipeline>(toolId, readPipeline, (value) => ({ pipeline: JSON.parse(serializePipeline(value)) as Values }));
  const [plugins] = useState(loadPlugins);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState(0);

  const update = (patch: Partial<Pipeline>) => setPipeline((p) => ({ ...p, ...patch }));
  const setStep = (index: number, step: PipelineStep) => update({ steps: pipeline.steps.map((s, i) => (i === index ? step : s)) });
  const move = (index: number, by: number) => {
    const steps = [...pipeline.steps];
    const [step] = steps.splice(index, 1);
    if (step) steps.splice(index + by, 0, step);
    update({ steps });
  };
  const add = (list: File[]) => {
    const known = new Set(files.map((f) => `${f.name}:${f.size}`));
    setFiles([...files, ...list.filter((f) => !known.has(`${f.name}:${f.size}`))]);
    setRows([]);
  };

  /** Plugin descriptions are cached for the run so each file does not ask again. */
  const runStep = async (step: PipelineStep, input: string, specs: Map<string, TextToolSpec<readonly OptionDef[]>>, infos: Map<string, PluginInfo>): Promise<TextResult> => {
    if (step.tool.startsWith('plugin:')) {
      const plugin = plugins.find((p) => `plugin:${p.id}` === step.tool);
      if (!plugin) throw new Error('The plugin is not installed.');
      let info = infos.get(plugin.id);
      if (!info) {
        info = await describePlugin(plugin.source);
        infos.set(plugin.id, info);
      }
      return runPlugin(plugin.source, input, sanitizeValues(info.options, step.values));
    }
    if (!isTextToolId(step.tool)) throw new Error(`Unknown tool "${step.tool}".`);
    let spec = specs.get(step.tool);
    if (!spec) {
      spec = (await textToolLoaders[step.tool]()).default as TextToolSpec<readonly OptionDef[]>;
      specs.set(step.tool, spec);
    }
    return runTextTool(step.tool, spec, { input, input2: '', file: null, values: sanitizeValues(spec.options, step.values), nonce: 0 });
  };

  const run = () =>
    void attempt(async () => {
      if (pipeline.steps.length === 0) throw new Error('Add at least one step.');
      const specs = new Map<string, TextToolSpec<readonly OptionDef[]>>();
      const infos = new Map<string, PluginInfo>();
      const done: Row[] = [];
      setRows([]);
      setProgress({ done: 0, total: files.length });
      for (const [i, file] of files.entries()) {
        try {
          const text = await readTextFile(file);
          const result = await runChain(text, pipeline.steps, (step, input) => runStep(step, input, specs, infos));
          done.push({ name: file.name, size: file.size, status: 'ok', output: result.output, outName: outputName(file.name, pipeline, result) });
        } catch (error) {
          const message =
            error instanceof StepError
              ? `Step ${error.step + 1} (${toolName(pipeline.steps[error.step]?.tool ?? '', plugins)}): ${error.message}`
              : error instanceof Error
                ? error.message
                : String(error);
          done.push({ name: file.name, size: file.size, status: 'error', message });
        }
        setProgress({ done: i + 1, total: files.length });
      }
      const names = uniqueNames(done.map((r) => r.outName ?? r.name));
      setRows(done.map((r, i) => (r.status === 'ok' ? { ...r, outName: names[i] } : r)));
      setSelected(
        Math.max(
          0,
          done.findIndex((r) => r.status === 'ok'),
        ),
      );
      setProgress(null);
      const failed = done.filter((r) => r.status === 'error').length;
      notify(failed ? `${done.length - failed} of ${done.length} files done; ${failed} failed.` : `All ${done.length} files done.`, failed ? 'error' : 'info');
    });

  const ok = rows.filter((r) => r.status === 'ok');
  const saveAll = () =>
    void attempt(async () => {
      if (ok.length === 1) {
        const only = ok[0] as Row;
        await saveFile(only.outName ?? only.name, only.output ?? '', 'text/plain');
        return;
      }
      const zip = zipSync(Object.fromEntries(ok.map((r) => [r.outName ?? r.name, strToU8(r.output ?? '')])), { level: 6 });
      const saved = await saveFile('pipeline-results.zip', zip, 'application/zip');
      if (saved.saved) notify(`Saved ${ok.length} files to ${saved.location}`);
    });
  const savePipeline = () => void attempt(async () => void (await saveFile('pipeline.benchtop.json', serializePipeline(pipeline), 'application/json')));
  const openPipeline = () =>
    void attempt(async () => {
      const file = await pickFile('.json,application/json');
      if (file) {
        update(parsePipeline(await readTextFile(file)));
        setRows([]);
      }
    });
  const current = rows[selected];

  return (
    <div data-testid="tool" class="tool ai-tool fp-tool">
      <div class="ai-controls">
        <div class="control">
          <label class="control-label" for="fp-preset">
            Start from
          </label>
          <select
            id="fp-preset"
            class="input"
            value=""
            onChange={(e) => {
              const preset = PRESETS.find((p) => p.name === e.currentTarget.value);
              if (preset) update(preset.pipeline);
              setRows([]);
            }}
          >
            <option value="">Choose a ready-made pipeline…</option>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <ol class="fp-steps" aria-label="Steps">
          {pipeline.steps.map((step, i) => (
            <StepEditor
              key={i}
              index={i}
              step={step}
              count={pipeline.steps.length}
              plugins={plugins}
              onChange={(s) => setStep(i, s)}
              onMove={(by) => move(i, by)}
              onRemove={() => update({ steps: pipeline.steps.filter((_, j) => j !== i) })}
            />
          ))}
        </ol>
        <div class="button-row">
          <button type="button" class="button" onClick={() => update({ steps: [...pipeline.steps, { tool: 'sort-lines', values: {} }] })} data-testid="fp-add">
            <Icon name="plus" size={16} /> Add step
          </button>
          <button type="button" class="button button-quiet" onClick={openPipeline}>
            Open…
          </button>
          <button type="button" class="button button-quiet" onClick={savePipeline}>
            Save pipeline
          </button>
        </div>
        <div class="control">
          <span class="control-label" id="fp-naming-label">
            Result file names
          </span>
          <div class="segmented" role="radiogroup" aria-labelledby="fp-naming-label">
            {(
              [
                ['keep', 'Keep'],
                ['last', 'From the last tool'],
                ['custom', 'Extension'],
              ] as [NameRule, string][]
            ).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={pipeline.naming === value} class={pipeline.naming === value ? 'is-active' : ''} onClick={() => update({ naming: value })}>
                {label}
              </button>
            ))}
          </div>
          {pipeline.naming === 'custom' && (
            <input
              class="input mono fp-extension"
              aria-label="Extension"
              value={pipeline.extension}
              placeholder="txt"
              onInput={(e) => update({ extension: e.currentTarget.value })}
              data-testid="fp-extension"
            />
          )}
        </div>
        <p class="tone-muted pdf-note">Each file goes through the steps in order, on this computer. Plugins you add in the Plugins tool can be steps too.</p>
      </div>
      <div class="ai-work">
        <button
          type="button"
          class="dropzone dropzone-compact"
          onClick={() => attempt(async () => add(await pickFiles()))}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            const list = Array.from(e.dataTransfer?.files ?? []);
            if (list.length) {
              e.preventDefault();
              add(list);
            }
          }}
          disabled={Boolean(progress)}
          data-testid="fp-drop"
        >
          <Icon name="file" size={20} />
          <span class="dropzone-title">{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} chosen; add more` : 'Choose or drop text files'}</span>
        </button>
        <div class="button-row">
          <button type="button" class="button button-primary" disabled={!files.length || Boolean(progress) || pipeline.steps.length === 0} onClick={run} data-testid="fp-run">
            {progress ? `Working: ${progress.done} of ${progress.total}` : `Run on ${files.length || 'the'} file${files.length === 1 ? '' : 's'}`}
          </button>
          <button type="button" class="button" disabled={!ok.length} onClick={saveAll} data-testid="fp-save">
            {ok.length > 1 ? `Save ${ok.length} results (ZIP)` : 'Save result'}
          </button>
          <button
            type="button"
            class="button button-quiet"
            disabled={!files.length || Boolean(progress)}
            onClick={() => {
              setFiles([]);
              setRows([]);
            }}
          >
            Clear files
          </button>
        </div>
        {rows.length > 0 ? (
          <>
            <table class="fp-results" data-testid="fp-results">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Result</th>
                  <th scope="col">Size</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.name} class={i === selected ? 'is-selected' : ''}>
                    <td>
                      <button type="button" class="link-button" onClick={() => setSelected(i)}>
                        {row.name}
                      </button>
                    </td>
                    <td class={row.status === 'ok' ? 'tone-ok' : 'tone-bad'}>{row.status === 'ok' ? row.outName : row.message}</td>
                    <td>{row.status === 'ok' ? `${formatBytes(row.size)} → ${formatBytes(new TextEncoder().encode(row.output ?? '').length)}` : formatBytes(row.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {current?.status === 'ok' && (
              <div class="pane fp-preview">
                <div class="pane-header">
                  <h2 class="pane-title">{current.outName}</h2>
                </div>
                <div class="pane-body">
                  <CodeEditor value={current.output ?? ''} readOnly label={`Result: ${current.outName}`} testId="fp-preview" />
                </div>
              </div>
            )}
          </>
        ) : (
          files.length > 0 && (
            <ul class="fp-files">
              {files.map((f) => (
                <li key={`${f.name}:${f.size}`}>
                  {f.name} <span class="tone-muted">{formatBytes(f.size)}</span>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}

export default defineCustomTool(FilePipeline);
