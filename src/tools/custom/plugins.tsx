/**
 * Plugins: add your own text tools as single JavaScript files.  Each runs in
 * a sandboxed worker (no network, no storage) and can also be a step in the
 * File Pipeline.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { describePlugin, EXAMPLE_PLUGIN, loadPlugins, MAX_PLUGIN_SOURCE, type PluginInfo, type PluginRecord, runPlugin, savePlugins } from '../../lib/plugins';
import { pickFile, readTextFile, saveFile } from '../../platform';
import { CodeEditor } from '../../ui/CodeEditor';
import { ControlsForm } from '../../ui/Controls';
import { attempt, notify } from '../../ui/toast';
import { sanitizeValues } from '../options';
import { defineCustomTool, type Values } from '../types';
import { Segmented } from './_shared';

const newId = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const fileName = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'plugin'
  }.js`;

function Plugins() {
  const [plugins, setPlugins] = useState<PluginRecord[]>(loadPlugins);
  const [selected, setSelected] = useState(() => plugins[0]?.id ?? '');
  const [tab, setTab] = useState<'use' | 'code'>(plugins.length ? 'use' : 'code');
  const [draft, setDraft] = useState(() => plugins[0]?.source ?? EXAMPLE_PLUGIN);
  const [info, setInfo] = useState<PluginInfo | null>(null);
  const [problem, setProblem] = useState('');
  const [values, setValues] = useState<Values>({});
  const [input, setInput] = useState('');
  const [result, setResult] = useState<{ output: string; info?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const plugin = plugins.find((p) => p.id === selected);

  useEffect(() => {
    let live = true;
    setInfo(null);
    setProblem('');
    setResult(null);
    if (!plugin) return;
    setDraft(plugin.source);
    describePlugin(plugin.source).then(
      (found) => {
        if (!live) return;
        setInfo(found);
        setValues(sanitizeValues(found.options, {}));
        setInput(found.sample);
      },
      (error: unknown) => live && setProblem(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
    };
  }, [plugin?.id, plugin?.source]);

  const store = (next: PluginRecord[]) => {
    savePlugins(next);
    setPlugins(next);
  };

  /** Checks the code by asking the plugin to describe itself, then keeps it. */
  const keep = (source: string, asNew: boolean) =>
    void attempt(async () => {
      if (source.length > MAX_PLUGIN_SOURCE) throw new Error('The plugin is larger than 2 MB.');
      const found = await describePlugin(source);
      const record: PluginRecord = { id: asNew || !plugin ? newId() : plugin.id, name: found.name, description: found.description, source, added: asNew || !plugin ? Date.now() : plugin.added };
      store(asNew || !plugin ? [...plugins, record] : plugins.map((p) => (p.id === record.id ? record : p)));
      setSelected(record.id);
      setTab('use');
      notify(`${found.name} is ready.`);
    });

  const run = () =>
    void attempt(async () => {
      if (!plugin || !info) return;
      setBusy(true);
      try {
        setResult(await runPlugin(plugin.source, input, sanitizeValues(info.options, values)));
      } finally {
        setBusy(false);
      }
    });

  const shown = useMemo(() => (info ? sanitizeValues(info.options, values) : values), [info, values]);

  return (
    <div data-testid="tool" class="tool plugins-tool">
      <div class="plugins-bar">
        <label class="control-label" for="plugin-select">
          Plugin
        </label>
        <select id="plugin-select" class="input" value={selected} onChange={(e) => setSelected(e.currentTarget.value)} disabled={!plugins.length} data-testid="plugin-select">
          {plugins.length === 0 && <option value="">No plugins yet</option>}
          {plugins.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div class="button-row">
          <button
            type="button"
            class="button"
            onClick={() => {
              setSelected('');
              setDraft(EXAMPLE_PLUGIN);
              setTab('code');
            }}
            data-testid="plugin-new"
          >
            New plugin
          </button>
          <button
            type="button"
            class="button"
            onClick={() =>
              attempt(async () => {
                const file = await pickFile('.js,.mjs,text/javascript');
                if (file) keep(await readTextFile(file), true);
              })
            }
          >
            Add from file…
          </button>
          <button
            type="button"
            class="button button-quiet"
            disabled={!plugin}
            onClick={() => plugin && attempt(async () => void (await saveFile(fileName(plugin.name), plugin.source, 'text/javascript')))}
          >
            Save as .js
          </button>
          <button
            type="button"
            class="button button-quiet"
            disabled={!plugin}
            onClick={() => {
              if (!plugin) return;
              const next = plugins.filter((p) => p.id !== plugin.id);
              store(next);
              setSelected(next[0]?.id ?? '');
              notify(`Removed ${plugin.name}.`);
            }}
            data-testid="plugin-remove"
          >
            Remove
          </button>
        </div>
        <Segmented
          label="View"
          value={tab}
          onChange={setTab}
          choices={[
            { value: 'use', label: 'Use' },
            { value: 'code', label: 'Code' },
          ]}
        />
      </div>

      {tab === 'code' ? (
        <div class="plugins-code">
          <div class="pane plugins-editor">
            <div class="pane-header">
              <h2 class="pane-title">{plugin ? plugin.name : 'New plugin'}</h2>
            </div>
            <div class="pane-body">
              <CodeEditor value={draft} onChange={setDraft} language="javascript" label="Plugin code" testId="plugin-code" />
            </div>
          </div>
          <div class="button-row">
            {plugin && (
              <button type="button" class="button button-primary" onClick={() => keep(draft, false)} data-testid="plugin-save">
                Save changes
              </button>
            )}
            <button type="button" class={plugin ? 'button' : 'button button-primary'} onClick={() => keep(draft, true)} data-testid="plugin-add">
              {plugin ? 'Save as a new plugin' : 'Add plugin'}
            </button>
          </div>
          <details class="plugins-help">
            <summary>How to write a plugin</summary>
            <p>
              A plugin is one JavaScript file that calls <code>benchtop.register()</code> (or uses <code>export default</code>) with a <code>name</code> and a <code>run(input, options)</code> function
              that returns text, or <code>{'{ output, info }'}</code>. <code>run</code> may be <code>async</code>.
            </p>
            <p>
              Optional: <code>description</code>, <code>sample</code> (example input), <code>language</code> of the output (json, html, css, markdown…) and <code>options</code>, a list of controls:{' '}
              <code>toggle</code>, <code>number</code>, <code>range</code>, <code>text</code>, <code>select</code> or <code>segmented</code> (with <code>choices</code>), <code>color</code> and{' '}
              <code>heading</code>, each with a <code>key</code>, <code>label</code> and <code>default</code>.
            </p>
            <p>
              For WebAssembly, put the module in the file as Base64 and call <code>WebAssembly.instantiate()</code> inside <code>run</code>. Plugins run in a worker of their own, without network
              access or access to Benchtop’s storage, and are stopped after 30 seconds. Only add code you have read or trust.
            </p>
          </details>
        </div>
      ) : plugin ? (
        <div class="plugins-use">
          <p class="tone-muted">{info?.description || plugin.description}</p>
          {problem && <p class="tone-bad">{problem}</p>}
          {info && info.options.length > 0 && <ControlsForm defs={info.options} values={shown} onChange={(patch) => setValues({ ...shown, ...patch })} layout="bar" idPrefix="plugin-option" />}
          <div class="plugins-panes">
            <div class="pane">
              <div class="pane-header">
                <h2 class="pane-title">Input</h2>
              </div>
              <div class="pane-body">
                <CodeEditor value={input} onChange={setInput} label="Input" testId="plugin-input" />
              </div>
            </div>
            <div class="pane">
              <div class="pane-header">
                <h2 class="pane-title">Output</h2>
              </div>
              <div class="pane-body">
                <CodeEditor value={result?.output ?? ''} readOnly language={info?.language ?? 'text'} label="Output" testId="plugin-output" />
              </div>
            </div>
          </div>
          <div class="button-row">
            <button type="button" class="button button-primary" onClick={run} disabled={!info || busy} data-testid="plugin-run">
              {busy ? 'Running…' : 'Run'}
            </button>
            {info?.sample && (
              <button type="button" class="button button-quiet" onClick={() => setInput(info.sample)}>
                Sample
              </button>
            )}
            {result?.info && (
              <span class="tone-muted" data-testid="plugin-info">
                {result.info}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p class="tone-muted plugins-empty">Add a plugin to use it here and in the File Pipeline: write one under Code, or open a .js file.</p>
      )}
    </div>
  );
}

export default defineCustomTool(Plugins);
