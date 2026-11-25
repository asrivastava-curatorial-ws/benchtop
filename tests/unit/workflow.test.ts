import { describe, expect, it } from 'vitest';
import { parsePipeline } from '../../src/lib/pipeline';
import {
  analyse,
  Cancelled,
  chain,
  connect,
  emptyWorkflow,
  fillPattern,
  fromPipeline,
  type Item,
  joinItems,
  makeItem,
  matches,
  parseAmount,
  parseWorkflowFile,
  portKey,
  type RunHooks,
  readRule,
  readWorkflow,
  removeNode,
  runWorkflow,
  safePath,
  serializeWorkflow,
  splitItem,
  tidy,
  type WfEdge,
  type WfNode,
  type Workflow,
} from '../../src/lib/workflow';
import type { Values } from '../../src/tools/types';

/** Small stand-in tools, so the tests check the engine and not the real tools. */
const TOOLS: Record<string, (input: string, values: Values) => string> = {
  upper: (s) => s.toUpperCase(),
  append: (s, v) => s + String(v.text ?? '!'),
  halve: (s) => s.slice(0, Math.ceil(s.length / 2)),
  trim: (s) => s.trim(),
  json: (s) => `${JSON.stringify(JSON.parse(s), null, 2)}\n`,
  boom: () => {
    throw new Error('nope');
  },
};
const hooks = (extra: Partial<RunHooks> = {}): RunHooks => ({
  runTool: async (tool, values, input) => {
    const run = TOOLS[tool];
    if (!run) throw new Error(`no tool ${tool}`);
    return { output: run(input, values), ...(tool === 'json' ? { language: 'json' as const } : {}) };
  },
  ...extra,
});

const node = (id: string, kind: WfNode['kind'], config: Values = {}, label?: string): WfNode => ({ id, kind, x: 0, y: 0, config, ...(label ? { label } : {}) });
const edge = (from: string, to: string, out = 'out', into = 'in'): WfEdge => ({ from, out, to, in: into });
const wf = (nodes: WfNode[], edges: WfEdge[], id = 'w', name = 'Test'): Workflow => ({ id, name, nodes, edges });
const files = (...pairs: [string, string][]): Item[] => pairs.map(([name, data]) => makeItem(name, data));
const named = (report: Awaited<ReturnType<typeof runWorkflow>>) => Object.fromEntries(report.results.map((r) => [r.name, r.item.data]));

describe('workflow engine', () => {
  it('runs a batch through a chain and names results by their type', async () => {
    const w = chain('c', [
      { tool: 'trim', values: {} },
      { tool: 'json', values: {} },
    ]);
    const report = await runWorkflow(w, files(['a.txt', ' {"x":1} '], ['b.txt', '[1]']), hooks());
    expect(named(report)).toEqual({ 'a.json': '{\n  "x": 1\n}\n', 'b.json': '[\n  1\n]\n' });
    expect(report.failures).toEqual([]);
  });

  it('reports a failed item, carries on with the others, and can route failures', async () => {
    const plain = chain('c', [{ tool: 'json', values: {} }], { naming: 'keep' });
    const report = await runWorkflow(plain, files(['good.json', '{"a":1}'], ['bad.json', '{oops']), hooks());
    expect(Object.keys(named(report))).toEqual(['good.json']);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({ item: 'bad.json', step: 'Tool' });

    const routed = wf(
      [node('i', 'input'), node('t', 'tool', { tool: 'json' }), node('ok', 'output', { naming: 'keep' }), node('bad', 'output', { naming: 'keep', folder: 'rejected' })],
      [edge('i', 't'), edge('t', 'ok'), edge('t', 'bad', 'failed')],
    );
    const second = await runWorkflow(routed, files(['good.json', '{"a":1}'], ['bad.json', '{oops']), hooks());
    expect(Object.keys(named(second)).sort()).toEqual(['good.json', 'rejected/bad.json']);
    expect(named(second)['rejected/bad.json']).toBe('{oops');
  });

  it('sends items down the yes and no branches of an If step', async () => {
    const w = wf(
      [
        node('i', 'input'),
        node('f', 'filter', { field: 'extension', op: 'equals', value: '.JSON' }),
        node('t', 'tool', { tool: 'json' }),
        node('u', 'tool', { tool: 'upper' }),
        node('o', 'output', { naming: 'keep' }),
      ],
      [edge('i', 'f'), edge('f', 't', 'yes'), edge('f', 'u', 'no'), edge('t', 'o'), edge('u', 'o')],
    );
    const report = await runWorkflow(w, files(['a.json', '[1]'], ['b.md', 'hi']), hooks());
    expect(named(report)).toEqual({ 'a.json': '[\n  1\n]\n', 'b.md': 'HI' });
    expect(report.outputs.get(portKey('f', 'yes'))?.map((x) => x.name)).toEqual(['a.json']);
    expect(report.outputs.get(portKey('f', 'no'))?.map((x) => x.name)).toEqual(['b.md']);
  });

  it('splits files into parts, works on each, and joins them back per file', async () => {
    const w = wf(
      [
        node('i', 'input'),
        node('s', 'split', { mode: 'lines', every: 1 }),
        node('t', 'tool', { tool: 'upper' }),
        node('j', 'join', { group: 'origin', separator: ' | ' }),
        node('o', 'output', { naming: 'keep' }),
      ],
      [edge('i', 's'), edge('s', 't'), edge('t', 'j'), edge('j', 'o')],
    );
    const report = await runWorkflow(w, files(['a.txt', 'one\ntwo\n'], ['b.txt', 'x']), hooks());
    expect(named(report)).toEqual({ 'a.txt': 'ONE | TWO', 'b.txt': 'X' });
    expect(report.outputs.get(portKey('s', 'out'))?.map((x) => x.name)).toEqual(['a-1.txt', 'a-2.txt', 'b-1.txt']);
  });

  it('repeats a loop body a number of times', async () => {
    const w = wf(
      [node('i', 'input'), node('l', 'loop', { mode: 'times', times: 3 }), node('t', 'tool', { tool: 'append', values: { text: '+' } }), node('o', 'output', { naming: 'keep' })],
      [edge('i', 'l'), edge('l', 't', 'loop'), edge('t', 'l', 'out', 'back'), edge('l', 'o', 'done')],
    );
    const report = await runWorkflow(w, files(['a', 'x'], ['b', 'y']), hooks());
    expect(named(report)).toEqual({ a: 'x+++', b: 'y+++' });
    expect(report.rounds.get('l')).toBe(3);
    expect(analyse(w).bodies.get('l')).toEqual(new Set(['t']));
  });

  it('loops each item until a rule holds, and stops at the limit', async () => {
    const until = (max: number) =>
      wf(
        [node('i', 'input'), node('l', 'loop', { mode: 'until', field: 'size', op: 'lt', value: '3', max }), node('t', 'tool', { tool: 'halve' }), node('o', 'output', { naming: 'keep' })],
        [edge('i', 'l'), edge('l', 't', 'loop'), edge('t', 'l', 'out', 'back'), edge('l', 'o', 'done')],
      );
    const report = await runWorkflow(until(25), files(['long', 'abcdefghijklmnop'], ['short', 'abcd']), hooks());
    expect(named(report)).toEqual({ long: 'ab', short: 'ab' });
    expect(report.rounds.get('l')).toBe(3);
    expect(report.notes).toEqual([]);
    const capped = await runWorkflow(until(1), files(['long', 'abcdefghijklmnop']), hooks());
    expect(named(capped)).toEqual({ long: 'abcdefgh' });
    expect(capped.notes[0]).toContain('stopped after 1 rounds');
  });

  it('loops until nothing changes', async () => {
    const w = wf(
      [node('i', 'input'), node('l', 'loop', { mode: 'unchanged', max: 50 }), node('t', 'tool', { tool: 'halve' }), node('o', 'output', { naming: 'keep' })],
      [edge('i', 'l'), edge('l', 't', 'loop'), edge('t', 'l', 'out', 'back'), edge('l', 'o', 'done')],
    );
    const report = await runWorkflow(w, files(['a', 'abcdefgh']), hooks());
    expect(named(report)).toEqual({ a: 'a' });
    expect(report.rounds.get('l')).toBe(4);
  });

  it('lets items leave a loop early through a branch, and nests loops', async () => {
    // Each round halves the text; items shorter than 3 leave through the If, the rest go round again.
    const early = wf(
      [
        node('i', 'input'),
        node('l', 'loop', { mode: 'times', times: 10 }),
        node('t', 'tool', { tool: 'halve' }),
        node('f', 'filter', { field: 'size', op: 'lt', value: '3' }),
        node('left', 'tool', { tool: 'upper' }),
        node('o', 'output', { naming: 'keep' }),
      ],
      [edge('i', 'l'), edge('l', 't', 'loop'), edge('t', 'f'), edge('f', 'left', 'yes'), edge('f', 'l', 'no', 'back'), edge('left', 'o'), edge('l', 'o', 'done')],
    );
    const structure = analyse(early);
    expect(structure.problems).toEqual([]);
    expect(structure.bodies.get('l')).toEqual(new Set(['t', 'f']));
    const report = await runWorkflow(early, files(['a', 'abcdefgh'], ['b', 'abc']), hooks());
    expect(named(report)).toEqual({ a: 'AB', b: 'AB' });

    const nested = wf(
      [
        node('i', 'input'),
        node('outer', 'loop', { mode: 'times', times: 2 }),
        node('inner', 'loop', { mode: 'times', times: 3 }),
        node('t', 'tool', { tool: 'append', values: { text: 'a' } }),
        node('u', 'tool', { tool: 'append', values: { text: 'B' } }),
        node('o', 'output', { naming: 'keep' }),
      ],
      [
        edge('i', 'outer'),
        edge('outer', 'inner', 'loop'),
        edge('inner', 't', 'loop'),
        edge('t', 'inner', 'out', 'back'),
        edge('inner', 'u', 'done'),
        edge('u', 'outer', 'out', 'back'),
        edge('outer', 'o', 'done'),
      ],
    );
    const s2 = analyse(nested);
    expect(s2.problems).toEqual([]);
    expect(s2.parent.get('t')).toBe('inner');
    expect(s2.parent.get('inner')).toBe('outer');
    expect(named(await runWorkflow(nested, files(['x', '']), hooks()))).toEqual({ x: 'aaaBaaaB' });
  });

  it('runs a saved workflow as a step and refuses to run one inside itself', async () => {
    const shout = {
      ...chain(
        'Shout',
        [
          { tool: 'upper', values: {} },
          { tool: 'append', values: { text: '!' } },
        ],
        { naming: 'keep' },
      ),
      id: 'shout',
    };
    const library = (id: string) => (id === 'shout' ? shout : id === 'self' ? self : undefined);
    const main = wf([node('i', 'input'), node('s', 'workflow', { workflow: 'shout' }), node('o', 'output', { naming: 'pattern', pattern: '{base}.out' })], [edge('i', 's'), edge('s', 'o')]);
    const report = await runWorkflow(main, files(['a.txt', 'hi']), hooks({ library }));
    expect(named(report)).toEqual({ 'a.out': 'HI!' });
    const self: Workflow = wf([node('i', 'input'), node('s', 'workflow', { workflow: 'outer' }), node('o', 'output')], [edge('i', 's'), edge('s', 'o')], 'self');
    const outer = wf([node('i', 'input'), node('s', 'workflow', { workflow: 'self' }), node('o', 'output')], [edge('i', 's'), edge('s', 'o')], 'outer');
    await expect(runWorkflow(outer, files(['a', 'b']), hooks({ library: (id) => (id === 'self' ? self : id === 'outer' ? outer : undefined) }))).rejects.toThrow(/inside itself/);
    expect(analyse(wf([node('i', 'input'), node('s', 'workflow', { workflow: 'w' }), node('o', 'output')], [edge('i', 's'), edge('s', 'o')])).problems[0]).toContain('inside itself');
  });

  it('renames, keeps names unique and stays inside the results folder', async () => {
    const w = wf(
      [node('i', 'input'), node('r', 'rename', { pattern: '{origin}/{index}-{base}.{ext}', find: 'draft', replace: 'final' }), node('o', 'output', { naming: 'keep', folder: '../out' })],
      [edge('i', 'r'), edge('r', 'o')],
    );
    const report = await runWorkflow(w, files(['draft one.md', 'a'], ['../../etc/passwd', 'b']), hooks());
    expect(report.results.map((r) => r.name)).toEqual(['out/final one/1-final one.md', 'out/passwd/2-passwd']);
    const same = chain('c', [], { naming: 'keep' });
    expect((await runWorkflow(same, files(['a.txt', '1'], ['A.txt', '2']), hooks())).results.map((r) => r.name)).toEqual(['a.txt', 'A (2).txt']);
    expect(safePath('..\\..\\x:y?.txt')).toBe('xy.txt');
    expect(safePath('')).toBe('file');
  });

  it('stops when asked', async () => {
    const signal = { cancelled: false };
    const w = chain('c', [{ tool: 'upper', values: {} }]);
    const run = runWorkflow(
      w,
      files(['a', '1'], ['b', '2'], ['c', '3']),
      hooks({
        signal,
        onProgress: ({ done }) => {
          if (done === 2) signal.cancelled = true;
        },
      }),
    );
    await expect(run).rejects.toBeInstanceOf(Cancelled);
  });

  it('says what stops a workflow from running', () => {
    expect(analyse(wf([], [])).problems).toEqual(['Add an Input files step: it is where the files start.', 'Add an Output step: it is where the results come out.']);
    const circle = wf(
      [node('i', 'input'), node('a', 'tool', { tool: 'upper' }), node('b', 'tool', { tool: 'upper' }), node('o', 'output')],
      [edge('i', 'a'), edge('a', 'b'), edge('b', 'a'), edge('b', 'o')],
    );
    expect(analyse(circle).problems.join(' ')).toContain('round in a circle');
    const open = wf([node('i', 'input'), node('l', 'loop', {}, 'Polish'), node('o', 'output')], [edge('i', 'l'), edge('l', 'o', 'done')]);
    expect(analyse(open).problems[0]).toContain('Polish: connect “each round”');
    const loose = wf([node('i', 'input'), node('t', 'tool', { tool: 'upper' }, 'Shout'), node('o', 'output')], [edge('i', 'o')]);
    expect(analyse(loose).problems).toEqual(['Shout has nothing connected to its input.']);
    const twice = wf(
      [node('i', 'input'), node('l1', 'loop'), node('l2', 'loop'), node('t', 'tool', { tool: 'upper' }, 'Shared'), node('o', 'output')],
      [
        edge('i', 'l1'),
        edge('i', 'l2'),
        edge('l1', 't', 'loop'),
        edge('l2', 't', 'loop'),
        edge('t', 'l1', 'out', 'back'),
        edge('t', 'l2', 'out', 'back'),
        edge('l1', 'o', 'done'),
        edge('l2', 'o', 'done'),
      ],
    );
    expect(analyse(twice).problems.join(' ')).toContain('Shared sits inside two separate loops');
  });
});

describe('workflow pieces', () => {
  const item = (name: string, data: string) => makeItem(name, data);

  it('matches rules', () => {
    const r = (config: Values) => readRule(config);
    expect(matches(item('Report.PDF', ''), r({ field: 'extension', op: 'equals', value: 'pdf' }))).toBe(true);
    expect(matches(item('Report.PDF', ''), r({ field: 'extension', op: 'equals', value: 'pdf', caseSensitive: true }))).toBe(false);
    expect(matches(item('a', 'hello world'), r({ field: 'text', op: 'matches', value: '^hello\\s' }))).toBe(true);
    expect(matches(item('a', 'hello'), r({ field: 'text', op: 'contains', value: 'xyz', negate: true }))).toBe(true);
    expect(matches(item('a', 'é'), r({ field: 'size', op: 'equals', value: '2' }))).toBe(true);
    expect(matches(item('a', '1\n2\n3'), r({ field: 'lines', op: 'gt', value: '2' }))).toBe(true);
    expect(matches(item('a', '  \n'), r({ field: 'text', op: 'empty' }))).toBe(true);
    expect(() => matches(item('a', 'x'), r({ field: 'text', op: 'matches', value: '(' }))).toThrow(/not a valid regular expression/);
    expect(() => matches(item('a', 'x'), r({ field: 'size', op: 'gt', value: 'big' }))).toThrow(/not a number/);
    expect(() => matches(makeItem('pic.png', new Uint8Array([0xff, 0xfe, 0x00])), r({ field: 'text', op: 'contains', value: 'x' }))).toThrow(/is not text/);
    expect(matches(makeItem('pic.png', new Uint8Array(2048)), r({ field: 'size', op: 'gt', value: '1k' }))).toBe(true);
    expect(parseAmount('1.5 MB')).toBe(1.5 * 1024 * 1024);
    expect(parseAmount('x')).toBeNaN();
  });

  it('splits and joins', () => {
    expect(splitItem(item('rows.csv', 'h1,h2\n1,2\n3,4\n5,6\n'), { mode: 'csv', every: 2 }).map((p) => p.data)).toEqual(['h1,h2\n1,2\n3,4\n', 'h1,h2\n5,6\n']);
    expect(splitItem(item('list.json', '[{"a":1},2]'), { mode: 'json' }).map((p) => [p.name, p.data])).toEqual([
      ['list-1.json', '{\n  "a": 1\n}\n'],
      ['list-2.json', '2\n'],
    ]);
    expect(splitItem(item('a.txt', 'p1\n\n\np2 line\nmore'), { mode: 'blank' }).map((p) => p.data)).toEqual(['p1', 'p2 line\nmore']);
    expect(splitItem(item('a.txt', 'a;b;c'), { mode: 'separator', separator: ';' })).toHaveLength(3);
    expect(splitItem(item('a.txt', 'a1b22c'), { mode: 'regex', separator: '\\d+' }).map((p) => p.data)).toEqual(['a', 'b', 'c']);
    expect(() => splitItem(item('a.json', '{}'), { mode: 'json' })).toThrow(/not a JSON list/);
    const parts = [...splitItem(item('a.txt', '1\n2'), {}), ...splitItem(item('b.txt', '3'), {})];
    expect(joinItems(parts, { group: 'origin', separator: '+' }).map((j) => [j.name, j.data])).toEqual([
      ['a.txt', '1+2'],
      ['b.txt', '3'],
    ]);
    expect(joinItems(parts, { group: 'all', mode: 'json' }).map((j) => [j.name, j.data])).toEqual([['joined.json', '[\n  1,\n  2,\n  3\n]\n']]);
    expect(joinItems(parts, { group: 'all', separator: '\\t', name: 'all-{origin}.tsv' })[0]).toMatchObject({ name: 'all-a.tsv', data: '1\t2\t3' });
  });

  it('fills name patterns', () => {
    expect(fillPattern('{index}_{base}.{ext} from {origin} ({name})', { ...item('x.tar.gz', ''), origin: 'src.zip' }, 4, 120)).toBe('005_x.tar.gz from src (x.tar.gz)');
    expect(fillPattern('{base}.{type}', { ...item('a.txt', ''), language: 'json' }, 0, 1)).toBe('a.json');
  });

  it('edits and lays out graphs', () => {
    let w = emptyWorkflow();
    const [input, output] = w.nodes as [WfNode, WfNode];
    expect(connect(w, { from: input.id, out: 'out', to: output.id, in: 'in' })).toBe(w);
    expect(connect(w, { from: input.id, out: 'nope', to: output.id, in: 'in' })).toBe(w);
    expect(connect(w, { from: output.id, out: 'out', to: output.id, in: 'in' })).toBe(w);
    w = removeNode(w, output.id);
    expect(w.edges).toEqual([]);
    const tidied = tidy(
      chain('c', [
        { tool: 'a', values: {} },
        { tool: 'b', values: {} },
      ]),
    );
    expect(tidied.nodes.map((n) => n.x)).toEqual([40, 300, 560, 820]);
    expect(new Set(tidied.nodes.map((n) => n.y))).toEqual(new Set([40]));
  });

  it('saves and opens workflow files, old pipelines included', () => {
    const sub = { ...chain('Sub', [{ tool: 'upper', values: {} }]), id: 'sub' };
    const main = wf([node('i', 'input'), node('s', 'workflow', { workflow: 'sub' }), node('o', 'output')], [edge('i', 's'), edge('s', 'o')], 'main', 'Main');
    const text = serializeWorkflow(main, (id) => (id === 'sub' ? sub : undefined));
    const opened = parseWorkflowFile(text, parsePipeline);
    expect(opened.workflow).toEqual(main);
    expect(opened.library).toEqual([sub]);
    const old = parseWorkflowFile('{"benchtop":"pipeline","version":1,"steps":[{"tool":"css-formatter","values":{"mode":"minify"}}],"naming":"custom","extension":".min.css"}', parsePipeline);
    expect(old.workflow.nodes.map((n) => n.kind)).toEqual(['input', 'tool', 'output']);
    expect(old.workflow.nodes[2]?.config).toMatchObject({ naming: 'pattern', pattern: '{base}.min.css' });
    expect(fromPipeline({ steps: [], naming: 'keep', extension: '' }).nodes[1]?.config.naming).toBe('keep');
    expect(() => parseWorkflowFile('{"benchtop":"other"}', parsePipeline)).toThrow(/not a Benchtop workflow/);
    expect(() => parseWorkflowFile('nope', parsePipeline)).toThrow(/not JSON/);
    // Malformed parts are dropped rather than trusted.
    const cleaned = readWorkflow({
      id: 'x',
      name: ' N ',
      nodes: [
        { id: 'a', kind: 'input', x: -5, y: 'q' },
        { id: 'a', kind: 'output' },
        { id: 'b', kind: 'evil' },
        { id: 'c', kind: 'output' },
      ],
      edges: [
        { from: 'a', out: 'out', to: 'c', in: 'in' },
        { from: 'a', out: 'out', to: 'c', in: 'in' },
        { from: 'a', out: 'x', to: 'c', in: 'in' },
        { from: 'zz', out: 'out', to: 'c', in: 'in' },
      ],
    });
    expect(cleaned).toEqual({
      id: 'x',
      name: 'N',
      nodes: [
        { id: 'a', kind: 'input', x: 0, y: 40, config: {} },
        { id: 'c', kind: 'output', x: 40, y: 40, config: {} },
      ],
      edges: [{ from: 'a', out: 'out', to: 'c', in: 'in' }],
    });
  });
});
