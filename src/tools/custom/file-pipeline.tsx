/**
 * Workflow Builder: wire tools into a graph and run a batch of files through
 * it.  Steps are boxes on a canvas; connections carry the files from one
 * step to the next.  If steps branch, Loop steps repeat, Split and Join take
 * files apart and put them back together, and a saved workflow can be a step
 * of another.  Every step keeps what came out of it, so any stage can be
 * looked at after a run.  (This replaces the File Pipeline of Benchtop 4,
 * whose saved pipelines still open.)
 */
import { strToU8, zipSync } from 'fflate';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useActiveProject } from '../../app/projects';
import { formatBytes } from '../../lib/bytes';
import { parsePipeline } from '../../lib/pipeline';
import { describePlugin, loadPlugins, type PluginInfo, type PluginRecord, runPlugin } from '../../lib/plugins';
import {
  analyse,
  Cancelled,
  chain,
  connect,
  DEFAULT_CONFIG,
  emptyWorkflow,
  fromPipeline,
  type Item,
  KIND_LABELS,
  makeItem,
  type NodeKind,
  newNodeId,
  PORT_LABELS,
  PORTS,
  parseWorkflowFile,
  portKey,
  type RunReport,
  readWorkflow,
  removeNode,
  runWorkflow,
  serializeWorkflow,
  sizeOf,
  tidy,
  type WfEdge,
  type WfNode,
  type Workflow,
} from '../../lib/workflow';
import { loadLibrary, mergeIntoLibrary, saveLibrary } from '../../lib/workflow-store';
import { MAX_BINARY_FILE, pickFile, pickFiles, readTextFile, saveFile } from '../../platform';
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

/** Generators make text from nothing and online checks need the network, so neither fits a workflow. */
const STEP_TOOLS = TOOLS.filter((t) => t.kind === 'text' && t.category !== 'generate' && t.category !== 'online' && t.id !== 'diff' && t.id !== 'config-generator');
const STEP_GROUPS = CATEGORIES.map((c) => ({ name: c.name, tools: STEP_TOOLS.filter((t) => t.category === c.id) })).filter((g) => g.tools.length > 0);
const toolName = (id: string, plugins: readonly PluginRecord[]) =>
  id.startsWith('plugin:') ? (plugins.find((p) => `plugin:${p.id}` === id)?.name ?? 'Missing plugin') : (STEP_TOOLS.find((t) => t.id === id)?.name ?? id);

/* -------------------------------------------------------------- presets -- */

const node = (kind: NodeKind, x: number, y: number, config: Values = {}, label?: string): WfNode => ({
  id: newNodeId(),
  kind,
  x,
  y,
  config: { ...DEFAULT_CONFIG[kind], ...config },
  ...(label ? { label } : {}),
});
const wire = (from: WfNode, to: WfNode, out = 'out', into = 'in'): WfEdge => ({ from: from.id, out, to: to.id, in: into });

function sortByType(): Workflow {
  const input = node('input', 40, 140);
  const isJson = node('filter', 300, 60, { field: 'extension', op: 'equals', value: 'json' }, 'JSON?');
  const isMarkdown = node('filter', 300, 250, { field: 'extension', op: 'equals', value: 'md' }, 'Markdown?');
  const format = node('tool', 560, 40, { tool: 'json-formatter', values: { mode: 'format' } });
  const toHtml = node('tool', 560, 210, { tool: 'markdown-to-html', values: { document: true } });
  const output = node('output', 840, 60, { naming: 'type' });
  const rest = node('output', 840, 330, { naming: 'keep', folder: 'unchanged' }, 'Everything else');
  return {
    id: newNodeId(),
    name: 'Sort files by type',
    nodes: [input, isJson, isMarkdown, format, toHtml, output, rest],
    edges: [
      wire(input, isJson),
      wire(isJson, format, 'yes'),
      wire(isJson, isMarkdown, 'no'),
      wire(isMarkdown, toHtml, 'yes'),
      wire(isMarkdown, rest, 'no'),
      wire(format, output),
      wire(toHtml, output),
    ],
  };
}

function decodeLayers(): Workflow {
  const input = node('input', 40, 100);
  const loop = node('loop', 300, 100, { mode: 'until', field: 'text', op: 'matches', value: '^[A-Za-z0-9+/=\\s]+$', negate: true, max: 10 }, 'Until it is no longer Base64');
  const decode = node('tool', 300, 300, { tool: 'base64', values: { mode: 'decode' } });
  const output = node('output', 580, 100, { naming: 'pattern', pattern: '{base}.decoded.txt' });
  return {
    id: newNodeId(),
    name: 'Decode Base64 wrapped several times',
    nodes: [input, loop, decode, output],
    edges: [wire(input, loop), wire(loop, decode, 'loop'), wire(decode, loop, 'out', 'back'), wire(loop, output, 'done')],
  };
}

function perLine(): Workflow {
  const input = node('input', 40, 100);
  const split = node('split', 300, 100, { mode: 'lines', every: 1 });
  const each = node('tool', 560, 100, { tool: 'case-converter', values: {} });
  const join = node('join', 820, 100, { group: 'origin', separator: '\\n' });
  const output = node('output', 1080, 100, { naming: 'keep' });
  return {
    id: newNodeId(),
    name: 'Work on every line, then put the file back together',
    nodes: [input, split, each, join, output],
    edges: [wire(input, split), wire(split, each), wire(each, join), wire(join, output)],
  };
}

const PRESETS: readonly { name: string; build: () => Workflow }[] = [
  { name: 'Format JSON files', build: () => chain('Format JSON files', [{ tool: 'json-formatter', values: { mode: 'format' } }], { naming: 'keep' }) },
  { name: 'Minify CSS files', build: () => chain('Minify CSS files', [{ tool: 'css-formatter', values: { mode: 'minify' } }], { naming: 'pattern', pattern: '{base}.min.css' }) },
  { name: 'Minify JavaScript files', build: () => chain('Minify JavaScript files', [{ tool: 'js-minifier', values: {} }], { naming: 'pattern', pattern: '{base}.min.js' }) },
  { name: 'Markdown to HTML pages', build: () => chain('Markdown to HTML pages', [{ tool: 'markdown-to-html', values: { document: true } }], { naming: 'type' }) },
  {
    name: 'Clean word lists: sort and remove duplicates',
    build: () => chain('Clean word lists', [{ tool: 'sort-lines', values: { unique: true, trim: true, removeEmpty: true } }], { naming: 'keep' }),
  },
  { name: 'Branch: sort files by type', build: sortByType },
  { name: 'Loop: decode Base64 wrapped several times', build: decodeLayers },
  { name: 'Split and join: work on every line', build: perLine },
];

/* ----------------------------------------------------- step settings -- */

const RULE_DEFS: readonly OptionDef[] = [
  {
    key: 'field',
    label: 'Look at',
    type: 'select',
    default: 'extension',
    choices: [
      { value: 'name', label: 'The file name' },
      { value: 'extension', label: 'The extension' },
      { value: 'size', label: 'The size (bytes; 10k and 2M work)' },
      { value: 'text', label: 'The text inside' },
      { value: 'lines', label: 'The number of lines' },
    ],
  },
  {
    key: 'op',
    label: 'Test',
    type: 'select',
    default: 'equals',
    choices: [
      { value: 'equals', label: 'is exactly' },
      { value: 'contains', label: 'contains' },
      { value: 'starts', label: 'starts with' },
      { value: 'ends', label: 'ends with' },
      { value: 'matches', label: 'matches the pattern (regular expression)' },
      { value: 'gt', label: 'is more than' },
      { value: 'lt', label: 'is less than' },
      { value: 'empty', label: 'is empty' },
    ],
  },
  { key: 'value', label: 'Value', type: 'text', default: '', mono: true, showIf: (v) => v.op !== 'empty' },
  { key: 'caseSensitive', label: 'Capitals must match', type: 'toggle', default: false, showIf: (v) => v.field !== 'size' && v.field !== 'lines' },
  { key: 'negate', label: 'The opposite (not)', type: 'toggle', default: false },
];

const loopRule = RULE_DEFS.map((def) => ({ ...def, showIf: (v: Values) => v.mode === 'until' && (def.showIf?.(v) ?? true) })) as readonly OptionDef[];

const NODE_DEFS: Record<Exclude<NodeKind, 'tool' | 'workflow' | 'input'>, readonly OptionDef[]> = {
  filter: RULE_DEFS,
  split: [
    {
      key: 'mode',
      label: 'Split',
      type: 'select',
      default: 'lines',
      choices: [
        { value: 'lines', label: 'By lines' },
        { value: 'blank', label: 'At blank lines (paragraphs)' },
        { value: 'separator', label: 'At a piece of text' },
        { value: 'regex', label: 'At a pattern (regular expression)' },
        { value: 'json', label: 'A JSON list into its items' },
        { value: 'csv', label: 'CSV rows, keeping the header' },
      ],
    },
    { key: 'every', label: 'Lines or rows in each piece', type: 'number', default: 1, min: 1, max: 1_000_000, showIf: (v) => v.mode === 'lines' || v.mode === 'csv' },
    { key: 'separator', label: 'Split at', type: 'text', default: '', mono: true, help: 'Use \\n for a new line and \\t for a tab.', showIf: (v) => v.mode === 'separator' || v.mode === 'regex' },
  ],
  join: [
    {
      key: 'group',
      label: 'Join',
      type: 'select',
      default: 'origin',
      choices: [
        { value: 'origin', label: 'The pieces of each file back into that file' },
        { value: 'all', label: 'Everything into one file' },
      ],
    },
    {
      key: 'mode',
      label: 'As',
      type: 'select',
      default: 'text',
      choices: [
        { value: 'text', label: 'Text, one piece after another' },
        { value: 'json', label: 'A JSON list' },
      ],
    },
    { key: 'separator', label: 'Between the pieces', type: 'text', default: '\\n', mono: true, help: 'Use \\n for a new line and \\t for a tab.', showIf: (v) => v.mode !== 'json' },
    { key: 'name', label: 'File name (optional)', type: 'text', default: '', placeholder: '{origin}-joined.txt' },
  ],
  loop: [
    {
      key: 'mode',
      label: 'Repeat',
      type: 'select',
      default: 'times',
      choices: [
        { value: 'times', label: 'A number of times' },
        { value: 'until', label: 'Each item until a test holds' },
        { value: 'unchanged', label: 'Each item until it stops changing' },
      ],
    },
    { key: 'times', label: 'Times', type: 'number', default: 3, min: 1, max: 1000, showIf: (v) => v.mode !== 'until' && v.mode !== 'unchanged' },
    ...loopRule,
    { key: 'max', label: 'Give up after this many rounds', type: 'number', default: 25, min: 1, max: 1000, showIf: (v) => v.mode === 'until' || v.mode === 'unchanged' },
  ],
  rename: [
    {
      key: 'pattern',
      label: 'New name',
      type: 'text',
      default: '{base}-{index}.{ext}',
      mono: true,
      wide: true,
      help: '{name} is the whole name, {base} the name without its extension, {ext} the extension, {index} a running number, {origin} the input file’s name, {type} the extension that suits the content. A / makes a folder.',
    },
    { key: 'find', label: 'Then replace (pattern)', type: 'text', default: '', mono: true },
    { key: 'replace', label: 'With', type: 'text', default: '', mono: true, showIf: (v) => Boolean(v.find) },
  ],
  output: [
    {
      key: 'naming',
      label: 'Name the results',
      type: 'select',
      default: 'type',
      choices: [
        { value: 'type', label: 'Same name, extension that suits the result' },
        { value: 'keep', label: 'Keep each name as it is' },
        { value: 'pattern', label: 'By a pattern' },
      ],
    },
    {
      key: 'pattern',
      label: 'Pattern',
      type: 'text',
      default: '{name}',
      mono: true,
      help: '{name}, {base}, {ext}, {index}, {origin} and {type} are filled in.',
      showIf: (v) => v.naming === 'pattern',
    },
    { key: 'folder', label: 'Folder inside the results (optional)', type: 'text', default: '' },
  ],
};

/** A line under the step's title saying what it is set to do. */
function summary(n: WfNode, plugins: readonly PluginRecord[], library: readonly Workflow[]): string {
  const c = n.config;
  const rule = () => {
    const field = { name: 'name', extension: 'extension', size: 'size', text: 'text', lines: 'lines' }[String(c.field)] ?? 'name';
    const op = { equals: '=', contains: 'contains', starts: 'starts with', ends: 'ends with', matches: 'matches', gt: '>', lt: '<', empty: 'is empty' }[String(c.op)] ?? 'contains';
    return `${c.negate ? 'not: ' : ''}${field} ${op}${c.op === 'empty' ? '' : ` ${String(c.value ?? '')}`}`;
  };
  switch (n.kind) {
    case 'input':
      return 'The files you add below';
    case 'tool':
      return toolName(String(c.tool ?? ''), plugins);
    case 'filter':
      return rule();
    case 'split':
      return (
        {
          lines: `every ${Number(c.every) > 1 ? `${c.every} lines` : 'line'}`,
          blank: 'at blank lines',
          separator: `at “${String(c.separator ?? '')}”`,
          regex: `at /${String(c.separator ?? '')}/`,
          json: 'JSON list items',
          csv: `every ${Number(c.every) > 1 ? `${c.every} rows` : 'row'}`,
        }[String(c.mode)] ?? 'by lines'
      );
    case 'join':
      return c.group === 'all' ? 'everything into one file' : 'pieces back into each file';
    case 'loop':
      return c.mode === 'until' ? `until ${rule()}` : c.mode === 'unchanged' ? 'until nothing changes' : `${Number(c.times) || 1} times`;
    case 'rename':
      return String(c.pattern ?? '{name}');
    case 'workflow':
      return library.find((w) => w.id === c.workflow)?.name ?? 'Choose a workflow';
    default:
      return c.naming === 'keep' ? 'names kept' : c.naming === 'pattern' ? String(c.pattern ?? '') : 'extension by type';
  }
}

/* --------------------------------------------------------------- canvas -- */

const NODE_W = 208;
const HEAD = 30;
const ROW = 24;
const rowsOf = (kind: NodeKind) => Math.max(PORTS[kind].ins.length, PORTS[kind].outs.length, 1);
const nodeH = (kind: NodeKind) => HEAD + 26 + rowsOf(kind) * ROW + 6;
const portY = (index: number) => HEAD + 26 + index * ROW + ROW / 2;
const GRID = 10;
const snap = (v: number) => Math.max(0, Math.round(v / GRID) * GRID);

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const reach = Math.max(50, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`;
}

interface BuilderState {
  readonly workflow: Workflow;
}

const readState = (stored: Values | undefined): BuilderState => {
  const saved = readWorkflow(stored?.workflow);
  if (saved) return { workflow: saved };
  if (stored?.pipeline) {
    try {
      return { workflow: fromPipeline(parsePipeline(JSON.stringify(stored.pipeline)), 'My pipeline') };
    } catch {
      // An unreadable old pipeline starts afresh.
    }
  }
  return { workflow: (PRESETS[0] as (typeof PRESETS)[number]).build() };
};

/** Settings of a tool step: which tool, and that tool's own options. */
function ToolSettings({ step, plugins, onChange }: { step: WfNode; plugins: readonly PluginRecord[]; onChange: (config: Values) => void }) {
  const tool = String(step.config.tool ?? '');
  const [defs, setDefs] = useState<readonly OptionDef[] | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let live = true;
    setDefs(null);
    setProblem('');
    const load = async (): Promise<readonly OptionDef[]> => {
      if (tool.startsWith('plugin:')) {
        const plugin = plugins.find((p) => `plugin:${p.id}` === tool);
        if (!plugin) throw new Error('This plugin is not installed. Add it in the Plugins tool.');
        return (await describePlugin(plugin.source)).options;
      }
      if (!isTextToolId(tool)) throw new Error('This tool does not exist in this version of Benchtop.');
      const spec = (await textToolLoaders[tool]()).default as TextToolSpec<readonly OptionDef[]>;
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
  }, [tool, plugins]);
  const raw = step.config.values && typeof step.config.values === 'object' ? (step.config.values as Values) : {};
  const values = useMemo(() => (defs ? sanitizeValues(defs, raw) : raw), [defs, raw]);
  return (
    <>
      <label class="wf-field">
        <span class="control-label">Tool</span>
        <select class="input" value={tool} onChange={(e) => onChange({ tool: e.currentTarget.value, values: {} })} data-testid="wf-tool">
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
          {!STEP_TOOLS.some((t) => t.id === tool) && !plugins.some((p) => `plugin:${p.id}` === tool) && <option value={tool}>{toolName(tool, plugins)}</option>}
        </select>
      </label>
      {problem && <p class="tone-bad">{problem}</p>}
      {defs && defs.length > 0 && <ControlsForm defs={defs} values={values} onChange={(next) => onChange({ tool, values: next })} layout="panel" idPrefix={`wf-${step.id}`} />}
      {defs && defs.length === 0 && <p class="tone-muted">This tool has no settings.</p>}
    </>
  );
}

const isText = (item: Item) => typeof item.data === 'string';
const display = (item: Item) =>
  typeof item.data === 'string' ? (item.data.length > 400_000 ? `${item.data.slice(0, 400_000)}\n… (the rest is not shown)` : item.data) : `Binary data, ${formatBytes(item.data.length)}`;

async function toItem(file: File): Promise<Item> {
  if (file.size > MAX_BINARY_FILE) throw new Error(`“${file.name}” is too large (the limit is 256 MB).`);
  try {
    return makeItem(file.name, await readTextFile(file));
  } catch {
    return makeItem(file.name, new Uint8Array(await file.arrayBuffer()));
  }
}

function WorkflowBuilder({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readState, (s): Values => ({ workflow: s.workflow as unknown as Values }));
  const wf = state.workflow;
  const [plugins] = useState(loadPlugins);
  const [library, setLibrary] = useState(loadLibrary);
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<RunReport | null>(null);
  const [partial, setPartial] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [edgeAt, setEdgeAt] = useState<number | null>(null);
  const [pending, setPending] = useState<{ from: string; out: string } | null>(null);
  const [link, setLink] = useState<{ from: string; out: string; x: number; y: number } | null>(null);
  const [shown, setShown] = useState<{ name: string; item: Item } | null>(null);
  const [live, setLive] = useState(true);
  const [zoom, setZoom] = useState(1);
  const surface = useRef<HTMLDivElement>(null);
  const history = useRef<{ past: Workflow[]; future: Workflow[] }>({ past: [], future: [] });
  const signal = useRef({ cancelled: false });
  const running = useRef(false);
  const covered = useRef<{ wf: Workflow; files: readonly File[] } | null>(null);
  const wfRef = useRef(wf);
  wfRef.current = wf;
  const project = useActiveProject();

  const change = (next: Workflow | ((w: Workflow) => Workflow), step = true) => {
    const before = wfRef.current;
    const after = typeof next === 'function' ? next(before) : next;
    if (after === before) return;
    if (step) {
      history.current.past.push(before);
      if (history.current.past.length > 100) history.current.past.shift();
      history.current.future = [];
    }
    wfRef.current = after;
    setState({ workflow: after });
  };
  const undo = () => {
    const previous = history.current.past.pop();
    if (!previous) return;
    history.current.future.push(wfRef.current);
    wfRef.current = previous;
    setState({ workflow: previous });
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(wfRef.current);
    wfRef.current = next;
    setState({ workflow: next });
  };
  const open = (next: Workflow) => {
    change(next);
    setSelected(null);
    setEdgeAt(null);
    setReport(null);
    setShown(null);
  };

  const structure = useMemo(() => analyse(wf, (id) => library.find((w) => w.id === id)), [wf, library]);
  const byId = useMemo(() => new Map(wf.nodes.map((n) => [n.id, n])), [wf]);
  const current = selected ? byId.get(selected) : undefined;
  const titleOf = (n: WfNode) => n.label?.trim() || KIND_LABELS[n.kind];

  /* ----------------------------------------------------------- running -- */

  const runTool = useMemo(() => {
    const specs = new Map<string, TextToolSpec<readonly OptionDef[]>>();
    const infos = new Map<string, PluginInfo>();
    return async (tool: string, values: Values, input: string): Promise<TextResult> => {
      if (tool.startsWith('plugin:')) {
        const plugin = plugins.find((p) => `plugin:${p.id}` === tool);
        if (!plugin) throw new Error('The plugin is not installed.');
        let info = infos.get(plugin.id);
        if (!info) {
          info = await describePlugin(plugin.source);
          infos.set(plugin.id, info);
        }
        return runPlugin(plugin.source, input, sanitizeValues(info.options, values));
      }
      if (!isTextToolId(tool)) throw new Error(`Unknown tool “${tool}”.`);
      let spec = specs.get(tool);
      if (!spec) {
        spec = (await textToolLoaders[tool]()).default as TextToolSpec<readonly OptionDef[]>;
        specs.set(tool, spec);
      }
      return runTextTool(tool, spec, { input, input2: '', file: null, values: sanitizeValues(spec.options, values), nonce: 0 });
    };
  }, [plugins]);

  const runOn = async (list: readonly File[], quiet: boolean) => {
    // A newer run replaces the one in hand: its result is the only one shown.
    signal.current.cancelled = true;
    signal.current = { cancelled: false };
    const mine = signal.current;
    if (!quiet) {
      running.current = true;
      covered.current = { wf: wfRef.current, files: list };
      setProgress('Reading the files…');
    }
    try {
      const items: Item[] = [];
      for (const file of list) items.push(await toItem(file));
      const result = await runWorkflow(wfRef.current, items, {
        runTool,
        library: (id) => library.find((w) => w.id === id),
        signal: mine,
        onProgress: quiet ? undefined : ({ label, done }) => setProgress(`${label} (${done.toLocaleString()} done)`),
      });
      if (mine.cancelled) return;
      setReport(result);
      setPartial(list.length < files.length);
      setShown((was) => {
        const first = result.results[0];
        const same = was && result.results.find((r) => r.name === was.name);
        return same ? { name: same.name, item: same.item } : first ? { name: first.name, item: first.item } : null;
      });
    } catch (error) {
      if (error instanceof Cancelled) {
        if (!quiet) notify('Stopped.');
        return;
      }
      if (!quiet) throw error;
      setReport(null);
    } finally {
      if (!quiet) {
        running.current = false;
        setProgress(null);
      }
    }
  };

  const run = () => void attempt(() => runOn(files, false));

  // With "Preview" on, every change is tried on the first file after a short pause.
  useEffect(() => {
    if (!live || files.length === 0 || progress !== null || structure.problems.length > 0) return;
    const timer = setTimeout(() => {
      // A full run of exactly this workflow on these files already shows more than a preview would.
      const full = covered.current?.wf === wfRef.current && covered.current.files === files;
      if (!running.current && !full) void runOn(files.slice(0, 1), true);
    }, 600);
    return () => clearTimeout(timer);
  }, [wf, live, files, structure.problems.length]);

  useEffect(
    () => () => {
      signal.current.cancelled = true;
    },
    [],
  );

  const add = (list: File[]) => {
    const known = new Set(files.map((f) => `${f.name}:${f.size}`));
    setFiles([...files, ...list.filter((f) => !known.has(`${f.name}:${f.size}`))]);
  };

  const results = report?.results ?? [];
  const saveAll = () =>
    void attempt(async () => {
      if (!results.length) return;
      const bytes = (item: Item) => (typeof item.data === 'string' ? strToU8(item.data) : item.data);
      if (results.length === 1) {
        const only = results[0] as (typeof results)[number];
        await saveFile(only.name.split('/').pop() ?? only.name, bytes(only.item), 'application/octet-stream');
        return;
      }
      const zip = zipSync(Object.fromEntries(results.map((r) => [r.name, bytes(r.item)])), { level: 6 });
      const saved = await saveFile(`${wf.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'workflow'}-results.zip`, zip, 'application/zip');
      if (saved.saved) notify(`${results.length} files saved in one ZIP`);
    });

  const keepInProject = () =>
    void attempt(async () => {
      if (!project || !report) return;
      const { addProjectFiles } = await import('../../app/projects');
      const out = report.results.map((r) => ({ name: r.name, data: r.item.data, role: 'output' as const, tool: toolId }));
      // What came out of each step along the way, so the project shows how the results were reached.
      const between: { name: string; data: string | Uint8Array; role: 'intermediate'; tool: string }[] = [];
      for (const n of wf.nodes) {
        if (n.kind === 'input' || n.kind === 'output') continue;
        for (const port of PORTS[n.kind].outs) {
          for (const item of (report.outputs.get(portKey(n.id, port)) ?? []).slice(0, 50))
            between.push({ name: `${titleOf(n)} (${PORT_LABELS[port] ?? port})/${item.name}`, data: item.data, role: 'intermediate', tool: toolId });
        }
      }
      const added = await addProjectFiles([...out, ...between.slice(0, 500)]);
      notify(`${added} files kept in the project “${project.name}”`);
    });

  /* ------------------------------------------------------------ editing -- */

  const addNode = (kind: NodeKind) => {
    const anchor = current ?? wf.nodes[wf.nodes.length - 1];
    const taken = (x: number, y: number) => wf.nodes.some((n) => Math.abs(n.x - x) < 60 && Math.abs(n.y - y) < 60);
    const x = anchor ? anchor.x + 260 : 40;
    let y = anchor ? anchor.y : 80;
    while (taken(x, y)) y += 150;
    const config = kind === 'workflow' ? { workflow: library.find((w) => w.id !== wf.id)?.id ?? '' } : { ...DEFAULT_CONFIG[kind] };
    const created: WfNode = { id: newNodeId(), kind, x, y, config };
    change((w) => {
      let next: Workflow = { ...w, nodes: [...w.nodes, created] };
      // A new step continues from the selected one when that is possible.
      if (current && kind !== 'input' && PORTS[current.kind].outs.length > 0 && !w.edges.some((e) => e.from === current.id && e.out === PORTS[current.kind].outs[0])) {
        next = connect(next, { from: current.id, out: PORTS[current.kind].outs[0] as string, to: created.id, in: 'in' });
      }
      return next;
    });
    setSelected(created.id);
    setEdgeAt(null);
  };

  const setConfig = (id: string, config: Values) => change((w) => ({ ...w, nodes: w.nodes.map((n) => (n.id === id ? { ...n, config } : n)) }));

  const point = (event: PointerEvent | MouseEvent) => {
    const rect = surface.current?.getBoundingClientRect();
    return rect ? { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom } : { x: 0, y: 0 };
  };

  const dragNode = (event: PointerEvent, n: WfNode) => {
    if (event.button !== 0) return;
    setSelected(n.id);
    setEdgeAt(null);
    const start = point(event);
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    let first = true;
    const move = (e: PointerEvent) => {
      const now = point(e);
      const x = snap(n.x + now.x - start.x);
      const y = snap(n.y + now.y - start.y);
      const at = wfRef.current.nodes.find((m) => m.id === n.id);
      if (!at || (at.x === x && at.y === y)) return;
      change((w) => ({ ...w, nodes: w.nodes.map((m) => (m.id === n.id ? { ...m, x, y } : m)) }), first);
      first = false;
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  const moveByKey = (event: KeyboardEvent, n: WfNode) => {
    const step = event.shiftKey ? 50 : GRID;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (delta) {
      event.preventDefault();
      change((w) => ({ ...w, nodes: w.nodes.map((m) => (m.id === n.id ? { ...m, x: snap(m.x + (delta[0] as number)), y: snap(m.y + (delta[1] as number)) } : m)) }));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      change((w) => removeNode(w, n.id));
      setSelected(null);
    }
  };

  const inputAt = (event: PointerEvent): { to: string; in: string } | null => {
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-port-in]');
    return hit ? { to: hit.dataset.node as string, in: hit.dataset.portIn as string } : null;
  };

  const startLink = (event: PointerEvent, n: WfNode, out: string) => {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    const origin = { x: event.clientX, y: event.clientY };
    let moved = false;
    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 5) return;
      moved = true;
      setLink({ from: n.id, out, ...point(e) });
    };
    const end = (e: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      target.releasePointerCapture?.(e.pointerId);
      setLink(null);
      if (!moved) return;
      const at = inputAt(e);
      if (at) change((w) => connect(w, { from: n.id, out, ...at }));
    };
    target.setPointerCapture?.(event.pointerId);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const typing = target.closest('input, textarea, [contenteditable="true"], .cm-editor');
    if (event.key === 'Escape') {
      setPending(null);
      return;
    }
    if (typing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && edgeAt !== null && !target.closest('select')) {
      event.preventDefault();
      change((w) => ({ ...w, edges: w.edges.filter((_, i) => i !== edgeAt) }));
      setEdgeAt(null);
    }
  };

  const width = Math.max(1200, ...wf.nodes.map((n) => n.x + NODE_W + 200));
  const height = Math.max(520, ...wf.nodes.map((n) => n.y + nodeH(n.kind) + 160));
  const anchorOf = (id: string, port: string, side: 'in' | 'out') => {
    const n = byId.get(id);
    if (!n) return null;
    const index = (side === 'in' ? PORTS[n.kind].ins : PORTS[n.kind].outs).indexOf(port);
    return index < 0 ? null : { x: n.x + (side === 'out' ? NODE_W : 0), y: n.y + portY(index) };
  };
  const count = (id: string, port: string) => report?.outputs.get(portKey(id, port))?.length;

  /* --------------------------------------------------------------- files -- */

  const saveWorkflowFile = () =>
    void attempt(
      async () =>
        void (await saveFile(
          `${wf.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'workflow'}.benchtop.json`,
          serializeWorkflow(wf, (id) => library.find((w) => w.id === id)),
          'application/json',
        )),
    );
  const openWorkflowFile = () =>
    void attempt(async () => {
      const file = await pickFile('.json,application/json');
      if (!file) return;
      const opened = parseWorkflowFile(await readTextFile(file), parsePipeline);
      if (opened.library.length) {
        const merged = mergeIntoLibrary(library, opened.library);
        saveLibrary(merged);
        setLibrary(merged);
      }
      open(opened.workflow);
      notify(`Opened ${file.name}`);
    });
  const saveToLibrary = () =>
    void attempt(async () => {
      const merged = mergeIntoLibrary(library, [wf]);
      saveLibrary(merged);
      setLibrary(merged);
      notify(`“${wf.name}” is in the library; other workflows can run it as a step`);
    });
  const removeFromLibrary = (id: string) =>
    void attempt(async () => {
      const rest = library.filter((w) => w.id !== id);
      saveLibrary(rest);
      setLibrary(rest);
    });

  const inLibrary = library.some((w) => w.id === wf.id);
  const outgoing = current ? wf.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.from === current.id) : [];
  const targets = current
    ? wf.nodes
        .flatMap((n) => (n.id === current.id && current.kind !== 'loop' ? [] : PORTS[n.kind].ins.map((port) => ({ node: n, port }))))
        .filter((t) => !(t.node.id === current.id && t.port !== 'back'))
    : [];
  const inspected = current ? (current.kind === 'output' ? [{ port: 'in', label: 'results' }] : PORTS[current.kind].outs.map((port) => ({ port, label: PORT_LABELS[port] ?? port }))) : [];

  return (
    <div data-testid="tool" class="tool wf-tool" data-state={report ? 'done' : 'idle'} onKeyDown={onKeyDown}>
      <div class="button-row wf-bar">
        <label class="wf-name">
          <span class="visually-hidden">Workflow name</span>
          <input class="input" value={wf.name} onChange={(e) => change((w) => ({ ...w, name: e.currentTarget.value.trim().slice(0, 80) || 'Untitled workflow' }))} data-testid="wf-name" />
        </label>
        <button type="button" class="button button-small" onClick={openWorkflowFile}>
          <Icon name="open" size={14} /> Open
        </button>
        <button type="button" class="button button-small" onClick={saveWorkflowFile} data-testid="wf-save-file">
          <Icon name="save" size={14} /> Save file
        </button>
        <button type="button" class="button button-small" onClick={saveToLibrary} data-testid="wf-save-library">
          {inLibrary ? 'Update in library' : 'Save to library'}
        </button>
        <label class="wf-pick">
          <span class="visually-hidden">Open a saved workflow or an example</span>
          <select
            class="input"
            value=""
            onChange={(e) => {
              const value = e.currentTarget.value;
              e.currentTarget.value = '';
              if (value === 'new') open(emptyWorkflow());
              else if (value.startsWith('preset:')) open((PRESETS[Number(value.slice(7))] as (typeof PRESETS)[number]).build());
              else {
                const saved = library.find((w) => w.id === value);
                if (saved) open(saved);
              }
            }}
            data-testid="wf-pick"
          >
            <option value="">Open…</option>
            <option value="new">A new, empty workflow</option>
            {library.length > 0 && (
              <optgroup label="Your library">
                {library.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Examples">
              {PRESETS.map((p, i) => (
                <option key={p.name} value={`preset:${i}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {inLibrary && (
          <button type="button" class="button button-small button-quiet" onClick={() => removeFromLibrary(wf.id)}>
            Remove from library
          </button>
        )}
        <span class="wf-bar-end">
          <button type="button" class="button button-small button-quiet" onClick={undo} disabled={!history.current.past.length} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" class="button button-small button-quiet" onClick={redo} disabled={!history.current.future.length} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          <button type="button" class="button button-small button-quiet" onClick={() => change(tidy)} title="Lay the steps out in columns">
            Tidy
          </button>
          <label class="wf-zoom">
            <span class="visually-hidden">Zoom</span>
            <select class="input" value={String(zoom)} onChange={(e) => setZoom(Number(e.currentTarget.value))}>
              {[0.6, 0.8, 1, 1.2].map((z) => (
                <option key={z} value={z}>
                  {Math.round(z * 100)}%
                </option>
              ))}
            </select>
          </label>
        </span>
      </div>

      <div class="wf-add" role="toolbar" aria-label="Add a step">
        <span class="control-label">Add</span>
        {(['tool', 'filter', 'loop', 'split', 'join', 'rename', 'workflow', 'output', 'input'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            class="button button-small"
            onClick={() => addNode(kind)}
            data-testid={`wf-add-${kind}`}
            disabled={kind === 'workflow' && !library.some((w) => w.id !== wf.id)}
            title={kind === 'workflow' ? 'Runs a workflow from your library as one step' : undefined}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
        {pending && <span class="wf-pending">Now choose the input to connect to, or press Esc.</span>}
      </div>

      <div class="wf-main">
        <div class="wf-canvas" data-testid="wf-canvas">
          <div
            class="wf-surface"
            ref={surface}
            style={{ width: `${width}px`, height: `${height}px`, transform: `scale(${zoom})` }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                setSelected(null);
                setEdgeAt(null);
              }
            }}
          >
            <svg class="wf-edges" width={width} height={height} aria-hidden="true">
              <title>Connections</title>
              {wf.edges.map((e, i) => {
                const a = anchorOf(e.from, e.out, 'out');
                const b = anchorOf(e.to, e.in, 'in');
                if (!a || !b) return null;
                const d = edgePath(a.x, a.y, b.x, b.y);
                return (
                  <g
                    key={`${e.from}:${e.out}:${e.to}:${e.in}`}
                    class={`wf-edge${edgeAt === i ? ' is-selected' : ''}${e.in === 'back' ? ' is-back' : ''}`}
                    onClick={() => {
                      setEdgeAt(i);
                      setSelected(null);
                    }}
                  >
                    <path class="wf-edge-hit" d={d} />
                    <path class="wf-edge-line" d={d} />
                  </g>
                );
              })}
              {link &&
                (() => {
                  const a = anchorOf(link.from, link.out, 'out');
                  return a ? <path class="wf-edge-line wf-edge-new" d={edgePath(a.x, a.y, link.x, link.y)} /> : null;
                })()}
            </svg>
            {wf.nodes.map((n) => (
              <div
                key={n.id}
                role="group"
                aria-label={`${titleOf(n)}: ${summary(n, plugins, library)}`}
                class={`wf-node wf-kind-${n.kind}${selected === n.id ? ' is-selected' : ''}${structure.parent.has(n.id) ? ' is-looped' : ''}`}
                style={{ left: `${n.x}px`, top: `${n.y}px`, width: `${NODE_W}px`, height: `${nodeH(n.kind)}px` }}
                data-testid={`wf-node-${n.kind}`}
              >
                <button type="button" class="wf-node-head" aria-pressed={selected === n.id} onPointerDown={(e) => dragNode(e, n)} onKeyDown={(e) => moveByKey(e, n)} onFocus={() => setSelected(n.id)}>
                  {titleOf(n)}
                </button>
                <span class="wf-node-summary">{summary(n, plugins, library)}</span>
                {PORTS[n.kind].ins.map((port, i) => (
                  <button
                    key={port}
                    type="button"
                    class={`wf-port wf-port-in${pending ? ' is-target' : ''}`}
                    style={{ top: `${portY(i) - 9}px` }}
                    data-port-in={port}
                    data-node={n.id}
                    aria-label={`${titleOf(n)}, input “${PORT_LABELS[port] ?? port}”${pending ? ': connect here' : ''}`}
                    onClick={() => {
                      if (!pending) return;
                      change((w) => connect(w, { ...pending, to: n.id, in: port }));
                      setPending(null);
                    }}
                  >
                    <i aria-hidden="true" />
                    <span>{PORT_LABELS[port] ?? port}</span>
                  </button>
                ))}
                {PORTS[n.kind].outs.map((port, i) => (
                  <button
                    key={port}
                    type="button"
                    class={`wf-port wf-port-out${pending?.from === n.id && pending.out === port ? ' is-pending' : ''}`}
                    style={{ top: `${portY(i) - 9}px` }}
                    aria-label={`${titleOf(n)}, output “${PORT_LABELS[port] ?? port}”: connect to another step`}
                    onPointerDown={(e) => startLink(e, n, port)}
                    onClick={() => setPending(pending?.from === n.id && pending.out === port ? null : { from: n.id, out: port })}
                    data-testid={`wf-out-${n.kind}-${port}`}
                  >
                    <span>
                      {PORT_LABELS[port] ?? port}
                      {count(n.id, port) !== undefined && <b> {count(n.id, port)}</b>}
                    </span>
                    <i aria-hidden="true" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <aside class="wf-side" aria-label="Step settings">
          {current ? (
            <div class="wf-panel" data-testid="wf-inspector">
              <div class="wf-panel-head">
                <strong>{KIND_LABELS[current.kind]}</strong>
                <button
                  type="button"
                  class="button button-small button-quiet"
                  onClick={() => {
                    change((w) => removeNode(w, current.id));
                    setSelected(null);
                  }}
                  data-testid="wf-remove"
                >
                  <Icon name="trash" size={13} /> Remove
                </button>
              </div>
              <label class="wf-field">
                <span class="control-label">Your name for this step (optional)</span>
                <input
                  class="input"
                  value={current.label ?? ''}
                  placeholder={KIND_LABELS[current.kind]}
                  onChange={(e) => change((w) => ({ ...w, nodes: w.nodes.map((n) => (n.id === current.id ? { ...n, label: e.currentTarget.value.slice(0, 80) } : n)) }))}
                />
              </label>
              {current.kind === 'tool' && <ToolSettings step={current} plugins={plugins} onChange={(config) => setConfig(current.id, config)} />}
              {current.kind === 'input' && <p class="tone-muted">The files you add below start here. Each connection carries the whole batch.</p>}
              {current.kind === 'workflow' && (
                <label class="wf-field">
                  <span class="control-label">Workflow from your library</span>
                  <select class="input" value={String(current.config.workflow ?? '')} onChange={(e) => setConfig(current.id, { workflow: e.currentTarget.value })}>
                    <option value="">Choose…</option>
                    {library
                      .filter((w) => w.id !== wf.id)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {current.kind !== 'tool' && current.kind !== 'input' && current.kind !== 'workflow' && (
                <ControlsForm
                  defs={NODE_DEFS[current.kind]}
                  values={sanitizeValues(NODE_DEFS[current.kind], current.config)}
                  onChange={(next) => setConfig(current.id, next)}
                  layout="panel"
                  idPrefix={`wf-${current.id}`}
                />
              )}
              {current.kind === 'loop' && <p class="tone-muted">Connect “each round” to the first step to repeat, and the last of those steps to “back”. Items leave through “done”.</p>}
              {current.kind === 'tool' && <p class="tone-muted">Items the tool cannot handle are listed after the run; connect “failed” to send them somewhere instead.</p>}

              {PORTS[current.kind].outs.length > 0 && (
                <div class="wf-links">
                  <span class="control-label">Connections</span>
                  <ul>
                    {outgoing.map(({ e, i }) => {
                      const to = byId.get(e.to);
                      return (
                        <li key={`${e.out}:${e.to}:${e.in}`}>
                          <span>
                            {PORT_LABELS[e.out] ?? e.out} → {to ? titleOf(to) : '?'}
                            {e.in !== 'in' ? ` (${PORT_LABELS[e.in] ?? e.in})` : ''}
                          </span>
                          <button
                            type="button"
                            class="icon-button"
                            aria-label={`Remove the connection from ${PORT_LABELS[e.out] ?? e.out} to ${to ? titleOf(to) : 'a step'}`}
                            onClick={() => change((w) => ({ ...w, edges: w.edges.filter((_, at) => at !== i) }))}
                          >
                            <Icon name="close" size={13} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {PORTS[current.kind].outs.map((port) => (
                    <label key={port} class="wf-field">
                      <span class="control-label">Connect “{PORT_LABELS[port] ?? port}” to</span>
                      <select
                        class="input"
                        value=""
                        onChange={(e) => {
                          const [to, into] = e.currentTarget.value.split('\u0000');
                          e.currentTarget.value = '';
                          if (to && into) change((w) => connect(w, { from: current.id, out: port, to, in: into }));
                        }}
                        data-testid={`wf-connect-${port}`}
                      >
                        <option value="">Choose a step…</option>
                        {targets.map((t) => (
                          <option key={`${t.node.id}:${t.port}`} value={`${t.node.id}\u0000${t.port}`}>
                            {titleOf(t.node)}
                            {t.port !== 'in' ? ` (${PORT_LABELS[t.port] ?? t.port})` : ''} — {summary(t.node, plugins, library)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}

              {report && (
                <div class="wf-came" data-testid="wf-came">
                  <span class="control-label">What came out{partial ? ' (first file only)' : ''}</span>
                  {inspected.map(({ port, label }) => {
                    const items = report.outputs.get(portKey(current.id, port)) ?? [];
                    return (
                      <div key={port}>
                        <strong>
                          {label}: {items.length.toLocaleString()}
                        </strong>
                        <ul>
                          {items.slice(0, 12).map((item) => (
                            <li key={item.id}>
                              <button type="button" class="link-button" onClick={() => setShown({ name: item.name, item })}>
                                {item.name}
                              </button>{' '}
                              <span class="tone-muted">{formatBytes(sizeOf(item))}</span>
                            </li>
                          ))}
                          {items.length > 12 && <li class="tone-muted">and {(items.length - 12).toLocaleString()} more</li>}
                        </ul>
                      </div>
                    );
                  })}
                  {report.rounds.has(current.id) && <p class="tone-muted">Rounds: {report.rounds.get(current.id)}</p>}
                </div>
              )}
            </div>
          ) : edgeAt !== null && wf.edges[edgeAt] ? (
            <div class="wf-panel">
              <strong>Connection</strong>
              <p>
                {(() => {
                  const e = wf.edges[edgeAt] as WfEdge;
                  const from = byId.get(e.from);
                  const to = byId.get(e.to);
                  return `${from ? titleOf(from) : '?'} (${PORT_LABELS[e.out] ?? e.out}) → ${to ? titleOf(to) : '?'} (${PORT_LABELS[e.in] ?? e.in})`;
                })()}
              </p>
              <button
                type="button"
                class="button button-small"
                onClick={() => {
                  change((w) => ({ ...w, edges: w.edges.filter((_, i) => i !== edgeAt) }));
                  setEdgeAt(null);
                }}
              >
                <Icon name="trash" size={13} /> Remove this connection
              </button>
            </div>
          ) : (
            <div class="wf-panel wf-help">
              <strong>How it works</strong>
              <p>Files start at Input, go along the connections from step to step, and come out at Output. Select a step to change it.</p>
              <p>To connect, drag from a dot on a step’s right edge to a dot on another step’s left edge; or click the first dot, then the second.</p>
              <p>
                <b>If</b> sends each file one of two ways. <b>Loop</b> repeats the steps wired from “each round” back to “back”. <b>Split</b> and <b>Join</b> work on the pieces of a file.{' '}
                <b>Run workflow</b> uses a workflow from your library as one step.
              </p>
            </div>
          )}
          {structure.problems.length > 0 && (
            <ul class="wf-problems" data-testid="wf-problems">
              {structure.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <div class="wf-run">
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
          disabled={progress !== null}
          data-testid="fp-drop"
        >
          <Icon name="file" size={20} />
          <span class="dropzone-title">{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} chosen; add more` : 'Choose or drop the files to work on'}</span>
        </button>
        <div class="button-row">
          <button type="button" class="button button-primary" disabled={!files.length || progress !== null || structure.problems.length > 0} onClick={run} data-testid="fp-run">
            {progress ?? `Run on ${files.length || 'the'} file${files.length === 1 ? '' : 's'}`}
          </button>
          {progress !== null && (
            <button
              type="button"
              class="button"
              onClick={() => {
                signal.current.cancelled = true;
              }}
            >
              Stop
            </button>
          )}
          <button type="button" class="button" disabled={!results.length || partial} onClick={saveAll} data-testid="fp-save" title={partial ? 'Run on all the files first' : undefined}>
            {results.length > 1 ? `Save ${results.length} results (ZIP)` : 'Save result'}
          </button>
          {project && (
            <button type="button" class="button" disabled={!results.length || partial} onClick={keepInProject} data-testid="wf-keep">
              Keep in project
            </button>
          )}
          <button
            type="button"
            class="button button-quiet"
            disabled={!files.length || progress !== null}
            onClick={() => {
              setFiles([]);
              setReport(null);
              setShown(null);
            }}
          >
            Clear files
          </button>
          <label class="check">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.currentTarget.checked)} /> Preview with the first file as I edit
          </label>
        </div>
        {report ? (
          <>
            {partial && <p class="tone-muted">This is a preview with the first file. Run to work on all {files.length}.</p>}
            <table class="fp-results" data-testid="fp-results">
              <thead>
                <tr>
                  <th scope="col">Result</th>
                  <th scope="col">From</th>
                  <th scope="col">Size</th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, 500).map((row) => (
                  <tr key={row.name} class={shown?.name === row.name ? 'is-selected' : ''}>
                    <td>
                      <button type="button" class="link-button" onClick={() => setShown({ name: row.name, item: row.item })}>
                        {row.name}
                      </button>
                    </td>
                    <td>{row.item.origin}</td>
                    <td>{formatBytes(sizeOf(row.item))}</td>
                  </tr>
                ))}
                {report.failures.map((f) => (
                  <tr key={`${f.node}:${f.item}:${f.message}`}>
                    <td>{f.item}</td>
                    <td class="tone-bad" colSpan={2}>
                      {f.step}: {f.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {results.length > 500 && <p class="tone-muted">Showing the first 500 of {results.length.toLocaleString()} results; all are saved.</p>}
            {report.notes.map((note) => (
              <p key={note} class="tone-muted">
                {note}
              </p>
            ))}
            {results.length === 0 && report.failures.length === 0 && <p class="tone-muted">Nothing reached an Output step.</p>}
          </>
        ) : (
          files.length > 0 && (
            <ul class="fp-files">
              {files.slice(0, 200).map((f) => (
                <li key={`${f.name}:${f.size}`}>
                  {f.name} <span class="tone-muted">{formatBytes(f.size)}</span>
                </li>
              ))}
            </ul>
          )
        )}
        {shown && (
          <div class="pane fp-preview">
            <div class="pane-header">
              <h2 class="pane-title">{shown.name}</h2>
            </div>
            <div class="pane-body">
              <CodeEditor
                value={display(shown.item)}
                readOnly
                label={`Preview: ${shown.name}`}
                testId="fp-preview"
                {...(isText(shown.item) && shown.item.language ? { language: shown.item.language } : {})}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default defineCustomTool(WorkflowBuilder);
