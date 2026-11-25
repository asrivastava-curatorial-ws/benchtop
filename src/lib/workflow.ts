/**
 * Workflows: a graph of steps that files flow through.  An Input node emits
 * the files of a batch; tool nodes change each one; If nodes send items down
 * a "yes" or a "no" branch; Split and Join take files apart and put them back
 * together; a Loop node repeats the steps wired between its "loop" and "back"
 * ports; a Workflow node runs another saved workflow; Output nodes name the
 * results.  Every connection carries a list of items, so a batch of a
 * thousand files runs through the same graph as one file.
 *
 * The engine is pure: tools run through a callback, so the same code serves
 * the editor, the tests and anything else that wants to run a workflow.
 */
import type { Lang, TextResult, Values } from '../tools/types';
import { EXTENSION_OF, type Pipeline, uniqueNames } from './pipeline';

/* ----------------------------------------------------------- the model -- */

export type NodeKind = 'input' | 'tool' | 'filter' | 'split' | 'join' | 'loop' | 'rename' | 'workflow' | 'output';

export interface WfNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly x: number;
  readonly y: number;
  readonly config: Values;
  /** The user's own name for the step. */
  readonly label?: string;
}

export interface WfEdge {
  readonly from: string;
  readonly out: string;
  readonly to: string;
  readonly in: string;
}

export interface Workflow {
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly WfNode[];
  readonly edges: readonly WfEdge[];
}

export const PORTS: Record<NodeKind, { readonly ins: readonly string[]; readonly outs: readonly string[] }> = {
  input: { ins: [], outs: ['out'] },
  tool: { ins: ['in'], outs: ['out', 'failed'] },
  filter: { ins: ['in'], outs: ['yes', 'no'] },
  split: { ins: ['in'], outs: ['out'] },
  join: { ins: ['in'], outs: ['out'] },
  loop: { ins: ['in', 'back'], outs: ['loop', 'done'] },
  rename: { ins: ['in'], outs: ['out'] },
  workflow: { ins: ['in'], outs: ['out'] },
  output: { ins: ['in'], outs: [] },
};

export const KIND_LABELS: Record<NodeKind, string> = {
  input: 'Input files',
  tool: 'Tool',
  filter: 'If',
  split: 'Split',
  join: 'Join',
  loop: 'Loop',
  rename: 'Rename',
  workflow: 'Run workflow',
  output: 'Output',
};

export const PORT_LABELS: Record<string, string> = { in: 'in', out: 'out', failed: 'failed', yes: 'yes', no: 'no', back: 'back', loop: 'each round', done: 'done' };

/** One file (or piece of one) travelling through the graph. */
export interface Item {
  readonly id: number;
  readonly name: string;
  readonly data: string | Uint8Array;
  readonly language?: Lang;
  /** A file name a tool suggested for its result. */
  readonly suggested?: string;
  /** The input file this came from. */
  readonly origin: string;
}

let nextItemId = 1;
export const makeItem = (name: string, data: string | Uint8Array, origin = name): Item => ({ id: nextItemId++, name, data, origin });

const decoder = new TextDecoder('utf-8', { fatal: true });

/** The item's text; binary data that is not UTF-8 text cannot be read by text steps. */
export function textOf(item: Item): string {
  if (typeof item.data === 'string') return item.data;
  try {
    return decoder.decode(item.data).replace(/^\uFEFF/, '');
  } catch {
    throw new Error(`“${item.name}” is not text, so this step cannot read it.`);
  }
}

export const sizeOf = (item: Item): number => (typeof item.data === 'string' ? new TextEncoder().encode(item.data).length : item.data.length);

const sameData = (a: string | Uint8Array, b: string | Uint8Array): boolean => {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
};

/* --------------------------------------------------------------- rules -- */

export interface Rule {
  readonly field: 'name' | 'extension' | 'size' | 'text' | 'lines';
  readonly op: 'contains' | 'equals' | 'starts' | 'ends' | 'matches' | 'gt' | 'lt' | 'empty';
  readonly value: string;
  readonly caseSensitive: boolean;
  readonly negate: boolean;
}

const FIELDS = ['name', 'extension', 'size', 'text', 'lines'] as const;
const OPS = ['contains', 'equals', 'starts', 'ends', 'matches', 'gt', 'lt', 'empty'] as const;

export function readRule(config: Values): Rule {
  return {
    field: (FIELDS as readonly string[]).includes(String(config.field)) ? (config.field as Rule['field']) : 'name',
    op: (OPS as readonly string[]).includes(String(config.op)) ? (config.op as Rule['op']) : 'contains',
    value: typeof config.value === 'string' ? config.value : '',
    caseSensitive: config.caseSensitive === true,
    negate: config.negate === true,
  };
}

const extensionOf = (name: string) => /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1] ?? '';
const baseOf = (name: string) => name.replace(/\.[A-Za-z0-9]{1,10}$/, '') || name;

/** "10", "1.5k", "2 MB" as a number (k, M and G are powers of 1024). */
export function parseAmount(text: string): number {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*([kmg])?i?b?\s*$/i.exec(text);
  if (!m) return Number.NaN;
  const scale = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[(m[2] ?? '').toLowerCase()] ?? 1;
  return Number(m[1]) * scale;
}

/** Text longer than this is not searched by a rule's regular expression (a slow pattern would freeze the window). */
const REGEX_LIMIT = 4_000_000;

export function matches(item: Item, rule: Rule): boolean {
  const numeric = rule.field === 'size' || rule.field === 'lines';
  let result: boolean;
  if (numeric) {
    const actual = rule.field === 'size' ? sizeOf(item) : textOf(item).split('\n').length;
    const wanted = parseAmount(rule.value);
    if (rule.op === 'empty') result = actual === 0 || (rule.field === 'lines' && textOf(item).trim() === '');
    else if (Number.isNaN(wanted)) throw new Error(`“${rule.value}” is not a number.`);
    else if (rule.op === 'gt') result = actual > wanted;
    else if (rule.op === 'lt') result = actual < wanted;
    else result = actual === wanted;
  } else {
    const raw = rule.field === 'name' ? item.name : rule.field === 'extension' ? extensionOf(item.name) : textOf(item);
    const fold = (s: string) => (rule.caseSensitive ? s : s.toLowerCase());
    const actual = fold(raw);
    const wanted = fold(rule.field === 'extension' ? rule.value.replace(/^\./, '') : rule.value);
    switch (rule.op) {
      case 'empty':
        result = raw.trim() === '';
        break;
      case 'equals':
        result = actual === wanted;
        break;
      case 'starts':
        result = actual.startsWith(wanted);
        break;
      case 'ends':
        result = actual.endsWith(wanted);
        break;
      case 'matches': {
        let pattern: RegExp;
        try {
          pattern = new RegExp(rule.value, rule.caseSensitive ? 'u' : 'iu');
        } catch (error) {
          throw new Error(`The pattern is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
        }
        result = pattern.test(raw.length > REGEX_LIMIT ? raw.slice(0, REGEX_LIMIT) : raw);
        break;
      }
      case 'gt':
      case 'lt':
        throw new Error('“More than” and “less than” compare sizes and line counts.');
      default:
        result = actual.includes(wanted);
    }
  }
  return rule.negate ? !result : result;
}

/* ---------------------------------------------------------- name rules -- */

/** A file name (it may carry folders) with nothing that could leave the folder it is saved in. */
export function safePath(name: string): string {
  const clean = (part: string) =>
    [...part]
      .filter((c) => c.charCodeAt(0) >= 32 && !'<>:"|?*'.includes(c))
      .join('')
      .replace(/[. ]+$/, '')
      .trim();
  const parts = name
    .replace(/\\/g, '/')
    .split('/')
    .map(clean)
    .filter((part) => part !== '' && part !== '.' && part !== '..');
  return parts.join('/').slice(0, 240) || 'file';
}

const leaf = (path: string) => path.replace(/\\/g, '/').split('/').pop() || path;

/** Fills {name}, {base}, {ext}, {index}, {origin} and {type} in a name pattern. */
export function fillPattern(pattern: string, item: Item, index: number, count: number): string {
  const width = String(Math.max(count, 1)).length;
  const typed = item.suggested ? extensionOf(item.suggested) : item.language ? EXTENSION_OF[item.language] : '';
  const values: Record<string, string> = {
    name: item.name,
    base: leaf(baseOf(item.name)),
    ext: extensionOf(item.name),
    index: String(index + 1).padStart(width, '0'),
    origin: leaf(baseOf(item.origin)),
    type: typed || extensionOf(item.name),
  };
  return pattern.replace(/\{(name|base|ext|index|origin|type)\}/g, (_, key: string) => values[key] ?? '');
}

/* ---------------------------------------------------- split and join -- */

const MAX_PARTS = 100_000;

const unescapeText = (text: string) => text.replace(/\\(n|t|r|\\)/g, (_, c: string) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\' })[c] ?? c);

export function splitItem(item: Item, config: Values): Item[] {
  const text = textOf(item);
  const mode = typeof config.mode === 'string' ? config.mode : 'lines';
  const every = Math.max(1, Math.round(Number(config.every) || 1));
  let parts: string[];
  let ext = extensionOf(item.name);
  if (mode === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`“${item.name}” is not JSON.`);
    }
    if (!Array.isArray(parsed)) throw new Error(`“${item.name}” is not a JSON list (it must start with [ ).`);
    parts = parsed.map((value) => `${JSON.stringify(value, null, 2)}\n`);
    ext = 'json';
  } else if (mode === 'csv') {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const [header, ...rows] = lines;
    parts = [];
    for (let i = 0; i < rows.length; i += every) parts.push(`${[header, ...rows.slice(i, i + every)].join('\n')}\n`);
  } else if (mode === 'blank') {
    parts = text
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n/)
      .filter((p) => p.trim() !== '');
  } else if (mode === 'separator') {
    const separator = unescapeText(typeof config.separator === 'string' ? config.separator : '');
    if (separator === '') throw new Error('Type the text to split at.');
    parts = text.split(separator);
  } else if (mode === 'regex') {
    let pattern: RegExp;
    try {
      pattern = new RegExp(typeof config.separator === 'string' && config.separator ? config.separator : '\\n', 'u');
    } catch (error) {
      throw new Error(`The pattern is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
    }
    parts = text.split(pattern).filter((p): p is string => typeof p === 'string');
  } else {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    parts = [];
    for (let i = 0; i < lines.length; i += every) parts.push(lines.slice(i, i + every).join('\n'));
  }
  if (parts.length > MAX_PARTS) throw new Error(`“${item.name}” would split into ${parts.length.toLocaleString()} pieces; the limit is ${MAX_PARTS.toLocaleString()}.`);
  const width = String(parts.length).length;
  const base = baseOf(item.name);
  return parts.map((part, i) => ({
    id: nextItemId++,
    name: `${base}-${String(i + 1).padStart(width, '0')}${ext ? `.${ext}` : ''}`,
    data: part,
    origin: item.origin,
    ...(item.language ? { language: item.language } : {}),
  }));
}

export function joinItems(items: readonly Item[], config: Values): Item[] {
  const everything = config.group === 'all';
  const asJson = config.mode === 'json';
  const separator = unescapeText(typeof config.separator === 'string' ? config.separator : '\\n');
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = everything ? '' : item.origin;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const out: Item[] = [];
  for (const [origin, group] of groups) {
    const texts = group.map(textOf);
    let data: string;
    if (asJson) {
      data = `${JSON.stringify(
        texts.map((t) => {
          try {
            return JSON.parse(t) as unknown;
          } catch {
            return t;
          }
        }),
        null,
        2,
      )}\n`;
    } else data = texts.join(separator);
    const wanted = typeof config.name === 'string' ? config.name.trim() : '';
    const fallback = everything ? (asJson ? 'joined.json' : 'joined.txt') : asJson ? `${baseOf(origin)}.json` : origin;
    const first = group[0] as Item;
    out.push({
      id: nextItemId++,
      name: safePath(wanted ? fillPattern(wanted, { ...first, name: origin || first.name }, out.length, groups.size) : fallback),
      data,
      origin: everything ? first.origin : origin,
      ...(asJson ? { language: 'json' as Lang } : {}),
    });
  }
  return out;
}

/* ------------------------------------------------------------ structure -- */

const key = (node: string, port: string) => `${node}\u0000${port}`;

export interface Structure {
  readonly problems: string[];
  /** Loop node id → the steps between its "loop" and "back" ports. */
  readonly bodies: Map<string, Set<string>>;
  /** Node id → the innermost loop whose body holds it. */
  readonly parent: Map<string, string>;
}

const labelOf = (node: WfNode) => node.label?.trim() || KIND_LABELS[node.kind];

/** Works out which steps each loop repeats, and reports what would stop the workflow from running. */
export function analyse(wf: Workflow, library?: (id: string) => Workflow | undefined): Structure {
  const problems: string[] = [];
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const edges = wf.edges.filter((e) => {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    return from && to && PORTS[from.kind].outs.includes(e.out) && PORTS[to.kind].ins.includes(e.in);
  });
  if (edges.length !== wf.edges.length) problems.push('A connection points at a step that no longer exists; remove it.');
  if (!wf.nodes.some((n) => n.kind === 'input')) problems.push('Add an Input files step: it is where the files start.');
  if (!wf.nodes.some((n) => n.kind === 'output')) problems.push('Add an Output step: it is where the results come out.');

  const isBack = (e: WfEdge) => e.in === 'back' && byId.get(e.to)?.kind === 'loop';
  const forward = edges.filter((e) => !isBack(e));
  const next = new Map<string, WfEdge[]>();
  const prev = new Map<string, WfEdge[]>();
  for (const e of forward) {
    next.set(e.from, [...(next.get(e.from) ?? []), e]);
    prev.set(e.to, [...(prev.get(e.to) ?? []), e]);
  }

  const bodies = new Map<string, Set<string>>();
  for (const loop of wf.nodes.filter((n) => n.kind === 'loop')) {
    const backSources = edges.filter((e) => e.to === loop.id && isBack(e)).map((e) => e.from);
    const starts = forward.filter((e) => e.from === loop.id && e.out === 'loop').map((e) => e.to);
    if (starts.length === 0 || backSources.length === 0) {
      problems.push(`${labelOf(loop)}: connect “each round” to the steps to repeat, and the last of them to “back”.`);
      bodies.set(loop.id, new Set());
      continue;
    }
    const reach = (seeds: string[], step: (id: string) => string[]) => {
      const seen = new Set<string>();
      const queue = [...seeds];
      while (queue.length) {
        const id = queue.pop() as string;
        if (id === loop.id || seen.has(id)) continue;
        seen.add(id);
        queue.push(...step(id));
      }
      return seen;
    };
    const down = reach(starts, (id) => (next.get(id) ?? []).map((e) => e.to));
    const up = reach(
      backSources.filter((id) => id !== loop.id),
      (id) => (prev.get(id) ?? []).filter((e) => !(e.from === loop.id)).map((e) => e.from),
    );
    bodies.set(loop.id, new Set([...down].filter((id) => up.has(id))));
  }

  // Loops nest or stand apart; a step cannot sit inside two unrelated loops.
  const parent = new Map<string, string>();
  for (const node of wf.nodes) {
    const holders = [...bodies].filter(([, body]) => body.has(node.id)).map(([loop]) => loop);
    if (holders.length === 0) continue;
    const innermost = holders.find((candidate) => holders.every((other) => other === candidate || bodies.get(other)?.has(candidate)));
    if (!innermost) {
      problems.push(`${labelOf(node)} sits inside two separate loops; give each loop its own steps.`);
      continue;
    }
    parent.set(node.id, innermost);
  }

  // No circles apart from a loop's own "back" connection.
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    for (const e of next.get(id) ?? []) if (visit(e.to)) return true;
    state.set(id, 2);
    return false;
  };
  if (wf.nodes.some((n) => visit(n.id))) problems.push('The connections go round in a circle. To repeat steps, use a Loop step and connect back to its “back” port.');

  for (const node of wf.nodes) {
    if (node.kind !== 'input' && !edges.some((e) => e.to === node.id && e.in === 'in')) problems.push(`${labelOf(node)} has nothing connected to its input.`);
    if (node.kind === 'workflow') {
      const id = typeof node.config.workflow === 'string' ? node.config.workflow : '';
      if (!id) problems.push(`${labelOf(node)}: choose the workflow to run.`);
      else if (id === wf.id) problems.push(`${labelOf(node)} would run this same workflow inside itself.`);
      else if (library && !library(id)) problems.push(`${labelOf(node)}: that workflow is not in the library any more.`);
    }
    if (node.kind === 'tool' && !(typeof node.config.tool === 'string' && node.config.tool)) problems.push(`${labelOf(node)}: choose a tool.`);
  }
  return { problems, bodies, parent };
}

/* --------------------------------------------------------------- engine -- */

export interface RunHooks {
  /** Runs a text tool (or "plugin:<id>") on one input. */
  runTool(tool: string, values: Values, input: string, item: Item): Promise<TextResult>;
  /** Looks a saved workflow up for Run workflow steps. */
  library?(id: string): Workflow | undefined;
  /** Set `cancelled` to stop after the item in hand. */
  readonly signal?: { cancelled: boolean };
  onProgress?(progress: { readonly node: string; readonly label: string; readonly done: number }): void;
}

export interface Failure {
  readonly node: string;
  readonly step: string;
  readonly item: string;
  readonly origin: string;
  readonly message: string;
}

export interface Result {
  readonly name: string;
  readonly item: Item;
  /** The Output step it came out of. */
  readonly node: string;
}

export interface RunReport {
  /** What came out of every port, keyed by portKey(node, port). */
  readonly outputs: Map<string, Item[]>;
  readonly results: Result[];
  readonly failures: Failure[];
  /** Loop node id → how many rounds it ran. */
  readonly rounds: Map<string, number>;
  readonly notes: string[];
}

export const portKey = key;

export class Cancelled extends Error {
  constructor() {
    super('Stopped.');
    this.name = 'Cancelled';
  }
}

const MAX_DEPTH = 8;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface RunState {
  readonly wf: Workflow;
  readonly hooks: RunHooks;
  readonly structure: Structure;
  readonly byId: Map<string, WfNode>;
  readonly edges: readonly WfEdge[];
  readonly outputs: Map<string, Item[]>;
  readonly failures: Failure[];
  readonly rounds: Map<string, number>;
  readonly notes: string[];
  readonly stack: readonly string[];
  readonly prefix: string;
  done: number;
}

/** Runs a batch of files through a workflow. */
export async function runWorkflow(wf: Workflow, inputs: readonly Item[], hooks: RunHooks, stack: readonly string[] = [], prefix = ''): Promise<RunReport> {
  const structure = analyse(wf, hooks.library);
  if (structure.problems.length) throw new Error(structure.problems[0]);
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const state: RunState = { wf, hooks, structure, byId, edges: wf.edges, outputs: new Map(), failures: [], rounds: new Map(), notes: [], stack: [...stack, wf.id], prefix, done: 0 };
  for (const node of wf.nodes) if (node.kind === 'input') state.outputs.set(key(node.id, 'out'), [...inputs]);
  await runScope(state, null);

  const results: Result[] = [];
  for (const node of wf.nodes) {
    if (node.kind !== 'output') continue;
    const items = gather(state, node.id, 'in');
    const naming = typeof node.config.naming === 'string' ? node.config.naming : 'type';
    const folder = typeof node.config.folder === 'string' ? node.config.folder.trim() : '';
    items.forEach((item, index) => {
      let name: string;
      if (naming === 'keep') name = item.name;
      else if (naming === 'pattern') name = fillPattern(typeof node.config.pattern === 'string' && node.config.pattern.trim() ? node.config.pattern : '{name}', item, index, items.length);
      else {
        const ext = (item.suggested ? extensionOf(item.suggested) : '') || (item.language ? EXTENSION_OF[item.language] : '') || extensionOf(item.name);
        name = ext ? `${baseOf(item.name)}.${ext}` : baseOf(item.name);
      }
      results.push({ name: safePath(folder ? `${folder}/${name}` : name), item, node: node.id });
    });
    state.outputs.set(key(node.id, 'in'), items);
  }
  const names = uniqueNames(results.map((r) => r.name));
  return { outputs: state.outputs, results: results.map((r, i) => ({ ...r, name: names[i] as string })), failures: state.failures, rounds: state.rounds, notes: state.notes };
}

/** Everything arriving at an input port, in the order the connections were made. */
function gather(state: RunState, node: string, port: string): Item[] {
  const items: Item[] = [];
  for (const e of state.edges) if (e.to === node && e.in === port) items.push(...(state.outputs.get(key(e.from, e.out)) ?? []));
  return items;
}

/** Runs the steps that belong directly to a scope: the top level (null) or one loop's body. */
async function runScope(state: RunState, scope: string | null): Promise<void> {
  const { structure, byId } = state;
  const members = state.wf.nodes.filter((n) => (structure.parent.get(n.id) ?? null) === scope && n.id !== scope);
  const memberIds = new Set(members.map((n) => n.id));
  /** The member that stands for a node: itself, or the loop (a member) whose body holds it. */
  const stand = (id: string): string | null => {
    let at: string | undefined = id;
    while (at !== undefined && !memberIds.has(at)) at = structure.parent.get(at);
    return at ?? null;
  };
  const waits = new Map<string, Set<string>>(members.map((n) => [n.id, new Set<string>()]));
  for (const e of state.edges) {
    if (e.in === 'back' && byId.get(e.to)?.kind === 'loop') continue;
    const a = stand(e.from);
    const b = stand(e.to);
    if (a && b && a !== b) waits.get(b)?.add(a);
  }
  const finished = new Set<string>();
  const order: WfNode[] = [];
  while (order.length < members.length) {
    const ready = members.find((n) => !finished.has(n.id) && [...(waits.get(n.id) ?? [])].every((w) => finished.has(w)));
    if (!ready) throw new Error('The connections go round in a circle.');
    finished.add(ready.id);
    order.push(ready);
  }
  for (const node of order) await runNode(state, node);
}

function fail(state: RunState, node: WfNode, item: Item, error: unknown): void {
  state.failures.push({ node: node.id, step: state.prefix + labelOf(node), item: item.name, origin: item.origin, message: errorText(error) });
}

function tick(state: RunState, node: WfNode): void {
  if (state.hooks.signal?.cancelled) throw new Cancelled();
  state.done += 1;
  state.hooks.onProgress?.({ node: node.id, label: state.prefix + labelOf(node), done: state.done });
}

async function runNode(state: RunState, node: WfNode): Promise<void> {
  const { outputs, hooks } = state;
  const set = (port: string, items: Item[]) => outputs.set(key(node.id, port), items);
  if (node.kind === 'input' || node.kind === 'output') return;
  const input = gather(state, node.id, 'in');

  if (node.kind === 'tool') {
    const out: Item[] = [];
    const failed: Item[] = [];
    const tool = String(node.config.tool ?? '');
    const values = node.config.values && typeof node.config.values === 'object' && !Array.isArray(node.config.values) ? (node.config.values as Values) : {};
    const routed = state.edges.some((e) => e.from === node.id && e.out === 'failed');
    for (const item of input) {
      tick(state, node);
      try {
        const result = await hooks.runTool(tool, values, textOf(item), item);
        if (typeof result.output !== 'string') throw new Error('This tool gives no text to pass on (it only shows a summary or a picture).');
        out.push({ ...item, data: result.output, ...(result.language ? { language: result.language } : {}), ...(result.filename ? { suggested: result.filename } : {}) });
      } catch (error) {
        if (error instanceof Cancelled) throw error;
        if (routed) failed.push(item);
        fail(state, node, item, error);
      }
    }
    set('out', out);
    set('failed', failed);
    return;
  }

  if (node.kind === 'filter') {
    const rule = readRule(node.config);
    const yes: Item[] = [];
    const no: Item[] = [];
    for (const item of input) {
      tick(state, node);
      try {
        (matches(item, rule) ? yes : no).push(item);
      } catch (error) {
        fail(state, node, item, error);
      }
    }
    set('yes', yes);
    set('no', no);
    return;
  }

  if (node.kind === 'split') {
    const out: Item[] = [];
    for (const item of input) {
      tick(state, node);
      try {
        out.push(...splitItem(item, node.config));
      } catch (error) {
        fail(state, node, item, error);
      }
    }
    set('out', out);
    return;
  }

  if (node.kind === 'join') {
    tick(state, node);
    try {
      set('out', joinItems(input, node.config));
    } catch (error) {
      for (const item of input) fail(state, node, item, error);
      set('out', []);
    }
    return;
  }

  if (node.kind === 'rename') {
    const pattern = typeof node.config.pattern === 'string' && node.config.pattern.trim() ? node.config.pattern : '{name}';
    const find = typeof node.config.find === 'string' ? node.config.find : '';
    const replace = typeof node.config.replace === 'string' ? node.config.replace : '';
    let finder: RegExp | null = null;
    if (find) {
      try {
        finder = new RegExp(find, 'gu');
      } catch (error) {
        for (const item of input) fail(state, node, item, new Error(`The pattern is not a valid regular expression: ${errorText(error)}`));
        set('out', []);
        return;
      }
    }
    set(
      'out',
      input.map((item, index) => {
        const named = fillPattern(pattern, item, index, input.length);
        return { ...item, name: safePath(finder ? named.replace(finder, replace) : named), suggested: undefined, language: undefined };
      }),
    );
    return;
  }

  if (node.kind === 'workflow') {
    const id = String(node.config.workflow ?? '');
    const sub = hooks.library?.(id);
    if (!sub) throw new Error(`${labelOf(node)}: that workflow is not in the library.`);
    if (state.stack.includes(sub.id)) throw new Error(`${labelOf(node)} would run “${sub.name}” inside itself.`);
    if (state.stack.length >= MAX_DEPTH) throw new Error('Workflows are nested too deeply (more than 8 levels).');
    tick(state, node);
    const report = await runWorkflow(sub, input, hooks, state.stack, `${state.prefix}${labelOf(node)} › `);
    state.failures.push(...report.failures);
    state.notes.push(...report.notes);
    set(
      'out',
      report.results.map((r) => ({ ...r.item, name: r.name })),
    );
    return;
  }

  // A loop: send the items round its body until each is finished.
  const body = [...(state.structure.bodies.get(node.id) ?? [])];
  const mode = node.config.mode === 'until' || node.config.mode === 'unchanged' ? node.config.mode : 'times';
  const times = Math.min(1000, Math.max(1, Math.round(Number(node.config.times) || 1)));
  const limit = mode === 'times' ? times : Math.min(1000, Math.max(1, Math.round(Number(node.config.max) || 25)));
  const rule = readRule(node.config);
  const collected = new Map<string, Item[]>();
  const done: Item[] = [];
  let current = input;
  let round = 0;
  while (current.length > 0 && round < limit) {
    round += 1;
    tick(state, node);
    set('loop', current);
    for (const id of body) for (const port of PORTS[(state.byId.get(id) as WfNode).kind].outs) outputs.delete(key(id, port));
    await runScope(state, node.id);
    for (const [id, ports] of [[node.id, ['loop']] as const, ...body.map((id) => [id, PORTS[(state.byId.get(id) as WfNode).kind].outs] as const)]) {
      for (const port of ports) {
        const k = key(id, port);
        collected.set(k, [...(collected.get(k) ?? []), ...(outputs.get(k) ?? [])]);
      }
    }
    const back = gather(state, node.id, 'back');
    if (mode === 'times') {
      current = back;
      continue;
    }
    const before = new Map(current.map((item) => [item.id, item]));
    const again: Item[] = [];
    for (const item of back) {
      let finished = false;
      try {
        if (mode === 'until') finished = matches(item, rule);
        else {
          const earlier = before.get(item.id);
          finished = earlier !== undefined && earlier.name === item.name && sameData(earlier.data, item.data);
        }
      } catch (error) {
        fail(state, node, item, error);
        continue;
      }
      (finished ? done : again).push(item);
    }
    current = again;
  }
  if (mode !== 'times' && current.length > 0)
    state.notes.push(`${state.prefix}${labelOf(node)} stopped after ${limit} rounds with ${current.length} ${current.length === 1 ? 'item' : 'items'} still changing.`);
  done.push(...current);
  // Steps after the loop see everything its body let out, from every round.
  for (const [k, items] of collected) outputs.set(k, items);
  set('done', done);
  state.rounds.set(node.id, round);
}

/* --------------------------------------------------------------- editing -- */

let nodeCounter = 0;
export function newNodeId(): string {
  nodeCounter += 1;
  return `n${Date.now().toString(36)}${nodeCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export const DEFAULT_CONFIG: Record<NodeKind, Values> = {
  input: {},
  tool: { tool: 'sort-lines', values: {} },
  filter: { field: 'extension', op: 'equals', value: 'json', caseSensitive: false, negate: false },
  split: { mode: 'lines', every: 1, separator: '' },
  join: { group: 'origin', mode: 'text', separator: '\\n', name: '' },
  loop: { mode: 'times', times: 3, max: 25, field: 'text', op: 'matches', value: '', caseSensitive: false, negate: false },
  rename: { pattern: '{base}-{index}.{ext}', find: '', replace: '' },
  workflow: { workflow: '' },
  output: { naming: 'type', pattern: '{name}', folder: '' },
};

export function emptyWorkflow(name = 'Untitled workflow'): Workflow {
  const input = newNodeId();
  const output = newNodeId();
  return {
    id: newNodeId(),
    name,
    nodes: [
      { id: input, kind: 'input', x: 40, y: 80, config: {} },
      { id: output, kind: 'output', x: 560, y: 80, config: { ...DEFAULT_CONFIG.output } },
    ],
    edges: [{ from: input, out: 'out', to: output, in: 'in' }],
  };
}

/** A straight chain: Input → tools → Output. */
export function chain(name: string, steps: readonly { tool: string; values: Values }[], output: Values = DEFAULT_CONFIG.output): Workflow {
  const ids = [newNodeId(), ...steps.map(() => newNodeId()), newNodeId()];
  const nodes: WfNode[] = [
    { id: ids[0] as string, kind: 'input', x: 40, y: 80, config: {} },
    ...steps.map((step, i): WfNode => ({ id: ids[i + 1] as string, kind: 'tool', x: 300 + i * 260, y: 80, config: { tool: step.tool, values: step.values } })),
    { id: ids[ids.length - 1] as string, kind: 'output', x: 300 + steps.length * 260, y: 80, config: { ...DEFAULT_CONFIG.output, ...output } },
  ];
  const edges = ids.slice(1).map((to, i): WfEdge => ({ from: ids[i] as string, out: 'out', to, in: 'in' }));
  return { id: newNodeId(), name, nodes, edges };
}

/** A pipeline from Benchtop 4 as a workflow. */
export function fromPipeline(pipeline: Pipeline, name = 'Pipeline'): Workflow {
  const ext = pipeline.extension
    .trim()
    .replace(/^\.+/, '')
    .replace(/[^\w.-]/g, '');
  const output: Values = pipeline.naming === 'keep' ? { naming: 'keep' } : pipeline.naming === 'custom' ? { naming: 'pattern', pattern: ext ? `{base}.${ext}` : '{base}' } : { naming: 'type' };
  return chain(name, pipeline.steps, output);
}

/** Adds a connection, replacing nothing: a port takes any number of connections. */
export function connect(wf: Workflow, edge: WfEdge): Workflow {
  const from = wf.nodes.find((n) => n.id === edge.from);
  const to = wf.nodes.find((n) => n.id === edge.to);
  if (!from || !to || !PORTS[from.kind].outs.includes(edge.out) || !PORTS[to.kind].ins.includes(edge.in)) return wf;
  if (wf.edges.some((e) => e.from === edge.from && e.out === edge.out && e.to === edge.to && e.in === edge.in)) return wf;
  if (edge.from === edge.to && !(from.kind === 'loop' && edge.out === 'loop' && edge.in === 'back')) return wf;
  return { ...wf, edges: [...wf.edges, edge] };
}

export function removeNode(wf: Workflow, id: string): Workflow {
  return { ...wf, nodes: wf.nodes.filter((n) => n.id !== id), edges: wf.edges.filter((e) => e.from !== id && e.to !== id) };
}

/** Lays the steps out in columns, left to right in the order the files flow. */
export function tidy(wf: Workflow): Workflow {
  const forward = wf.edges.filter((e) => !(e.in === 'back' && wf.nodes.find((n) => n.id === e.to)?.kind === 'loop'));
  const column = new Map<string, number>(wf.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < wf.nodes.length; pass++) {
    let moved = false;
    for (const e of forward) {
      const wanted = (column.get(e.from) ?? 0) + 1;
      if (wanted > (column.get(e.to) ?? 0) && wanted <= wf.nodes.length) {
        column.set(e.to, wanted);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const rows = new Map<number, number>();
  const ordered = [...wf.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = new Map<string, { x: number; y: number }>();
  for (const node of ordered) {
    const c = column.get(node.id) ?? 0;
    const r = rows.get(c) ?? 0;
    rows.set(c, r + 1);
    placed.set(node.id, { x: 40 + c * 260, y: 40 + r * 150 });
  }
  return { ...wf, nodes: wf.nodes.map((n) => ({ ...n, ...(placed.get(n.id) as { x: number; y: number }) })) };
}

/* ----------------------------------------------------------------- files -- */

const KINDS = Object.keys(PORTS) as NodeKind[];
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A workflow from storage or a file, with anything malformed dropped. */
export function readWorkflow(raw: unknown): Workflow | null {
  if (!isRecord(raw) || !Array.isArray(raw.nodes)) return null;
  const nodes: WfNode[] = [];
  const seen = new Set<string>();
  for (const n of raw.nodes.slice(0, 500)) {
    if (!isRecord(n) || typeof n.id !== 'string' || seen.has(n.id) || !KINDS.includes(n.kind as NodeKind)) continue;
    seen.add(n.id);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(20_000, Math.max(0, Math.round(v))) : 40);
    nodes.push({
      id: n.id,
      kind: n.kind as NodeKind,
      x: num(n.x),
      y: num(n.y),
      config: isRecord(n.config) ? (n.config as Values) : {},
      ...(typeof n.label === 'string' && n.label.trim() ? { label: n.label.slice(0, 80) } : {}),
    });
  }
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const edges: WfEdge[] = [];
  for (const e of Array.isArray(raw.edges) ? raw.edges.slice(0, 2000) : []) {
    if (!isRecord(e) || typeof e.from !== 'string' || typeof e.to !== 'string' || typeof e.out !== 'string' || typeof e.in !== 'string') continue;
    const from = kindOf.get(e.from);
    const to = kindOf.get(e.to);
    if (!from || !to || !PORTS[from].outs.includes(e.out) || !PORTS[to].ins.includes(e.in)) continue;
    if (edges.some((x) => x.from === e.from && x.out === e.out && x.to === e.to && x.in === e.in)) continue;
    edges.push({ from: e.from, out: e.out, to: e.to, in: e.in });
  }
  return { id: typeof raw.id === 'string' && raw.id ? raw.id : newNodeId(), name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'Untitled workflow', nodes, edges };
}

/** The saved workflows a workflow runs, directly or through others. */
export function dependencies(wf: Workflow, library: (id: string) => Workflow | undefined): Workflow[] {
  const found = new Map<string, Workflow>();
  const visit = (w: Workflow) => {
    for (const node of w.nodes) {
      if (node.kind !== 'workflow') continue;
      const sub = library(String(node.config.workflow ?? ''));
      if (sub && sub.id !== wf.id && !found.has(sub.id)) {
        found.set(sub.id, sub);
        visit(sub);
      }
    }
  };
  visit(wf);
  return [...found.values()];
}

/** A workflow file carries the workflows it runs, so it works on another computer. */
export function serializeWorkflow(wf: Workflow, library: (id: string) => Workflow | undefined = () => undefined): string {
  return `${JSON.stringify({ benchtop: 'workflow', version: 2, workflow: wf, library: dependencies(wf, library) }, null, 2)}\n`;
}

export function parseWorkflowFile(text: string, parsePipeline: (text: string) => Pipeline): { workflow: Workflow; library: Workflow[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a workflow file (it is not JSON).');
  }
  if (isRecord(raw) && raw.benchtop === 'pipeline') return { workflow: fromPipeline(parsePipeline(text), 'Imported pipeline'), library: [] };
  if (!isRecord(raw) || raw.benchtop !== 'workflow') throw new Error('This JSON file is not a Benchtop workflow.');
  const workflow = readWorkflow(raw.workflow);
  if (!workflow) throw new Error('This workflow file has no steps.');
  const library = (Array.isArray(raw.library) ? raw.library : []).map(readWorkflow).filter((w): w is Workflow => w !== null);
  return { workflow, library };
}
