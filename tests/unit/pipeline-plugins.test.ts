import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { outputName, parsePipeline, runChain, StepError, serializePipeline, uniqueNames } from '../../src/lib/pipeline';
import { cleanOptions, EXAMPLE_PLUGIN, harness, toScript } from '../../src/lib/plugins';
import { sanitizeValues } from '../../src/tools/options';
import { isTextToolId, textToolLoaders } from '../../src/tools/text';
import type { TextResult } from '../../src/tools/types';

/** Runs a real text tool on the calling thread, as the worker would. */
const realTool = async (step: { tool: string; values: Record<string, unknown> }, input: string): Promise<TextResult> => {
  if (!isTextToolId(step.tool)) throw new Error(`no tool ${step.tool}`);
  const spec = (await textToolLoaders[step.tool]()).default;
  const result = await spec.run(input, sanitizeValues(spec.options, step.values) as never, { input2: '', file: null, nonce: 0 });
  return typeof result === 'string' ? { output: result } : result;
};

describe('file pipelines', () => {
  it('passes each output to the next step, with real tools', async () => {
    const result = await runChain(
      '{"b":1,"a":[1,2]}',
      [
        { tool: 'json-formatter', values: { mode: 'format', sortKeys: true } },
        { tool: 'json-formatter', values: { mode: 'minify' } },
      ],
      realTool,
    );
    expect(result.output).toBe('{"a":[1,2],"b":1}');
    expect(result.log).toHaveLength(2);
    const md = await runChain('# Hi\n\nSome *text*.', [{ tool: 'markdown-to-html', values: { document: false } }], realTool);
    expect(md.output).toContain('<h1');
    expect(outputName('notes.md', { naming: 'last', extension: '' }, md)).toBe('notes.html');
  });

  it('reports which step failed', async () => {
    const run = async (step: { tool: string }, input: string): Promise<TextResult> => {
      if (step.tool === 'boom') throw new Error('bad input');
      if (step.tool === 'summary') return { fields: [] };
      return { output: input.toUpperCase() };
    };
    await expect(
      runChain(
        'x',
        [
          { tool: 'up', values: {} },
          { tool: 'boom', values: {} },
        ],
        run,
      ),
    ).rejects.toMatchObject({ step: 1, message: 'bad input' });
    const error = await runChain('x', [{ tool: 'summary', values: {} }], run).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StepError);
    expect((error as StepError).message).toContain('no text to pass on');
  });

  it('names results and keeps the names unique', () => {
    expect(outputName('a.json', { naming: 'keep', extension: '' }, {})).toBe('a.json');
    expect(outputName('a.css', { naming: 'custom', extension: '.min.css' }, {})).toBe('a.min.css');
    expect(outputName('a.txt', { naming: 'last', extension: '' }, { language: 'json' })).toBe('a.json');
    expect(outputName('a.txt', { naming: 'last', extension: '' }, { filename: 'Root.cs', language: 'text' })).toBe('a.cs');
    expect(outputName('README', { naming: 'last', extension: '' }, {})).toBe('README');
    expect(uniqueNames(['a.md', 'A.md', 'a.md', 'b'])).toEqual(['a.md', 'A (2).md', 'a (3).md', 'b']);
  });

  it('saves and opens pipeline files', () => {
    const pipeline = { steps: [{ tool: 'sort-lines', values: { unique: true } }], naming: 'custom' as const, extension: 'txt' };
    expect(parsePipeline(serializePipeline(pipeline))).toEqual(pipeline);
    expect(() => parsePipeline('{"steps": []}')).toThrow('not a Benchtop pipeline');
    expect(() => parsePipeline('nope')).toThrow('not JSON');
    expect(parsePipeline('{"benchtop":"pipeline","steps":[{"tool":"x","values":[1]},{"nope":1}],"naming":"odd"}')).toEqual({ steps: [{ tool: 'x', values: {} }], naming: 'last', extension: '' });
  });
});

/** Runs the plugin harness in a fresh V8 context standing in for a worker. */
function workerLike(source: string) {
  const posted: unknown[] = [];
  // A vm context hides the sandbox's prototype chain, so the network APIs are own
  // properties here; the end-to-end test checks a real worker's prototypes.
  const self: Record<string, unknown> = {
    postMessage: (message: unknown) => posted.push(message),
    navigator: {},
    fetch: () => 'network',
    XMLHttpRequest: class {},
  };
  self.self = self;
  runInNewContext(harness(source), self);
  const send = async (data: unknown) => {
    await (self.onmessage as (event: { data: unknown }) => Promise<void>)({ data });
    return posted.at(-1) as Record<string, unknown>;
  };
  return { self, send };
}

describe('plugins', () => {
  it('turns module syntax into a worker script and refuses imports', () => {
    expect(toScript('export default { name: "x" }')).toBe('globalThis.__benchtopPlugin = { name: "x" }');
    expect(toScript('export function helper() {}\nexport const a = 1;')).toBe('function helper() {}\nconst a = 1;');
    expect(() => toScript("import x from './x.js';")).toThrow('cannot import');
  });

  it('keeps only usable options', () => {
    const options = cleanOptions([
      { key: 'n', label: 'N', type: 'number', default: 3, min: 1 },
      { key: 'mode', type: 'select', choices: ['a', { value: 'b', label: 'Bee' }], default: 'zzz' },
      { key: 'bad key', type: 'toggle' },
      { key: 'x', type: 'list' },
      { key: 'n', type: 'toggle' },
      'nonsense',
    ]);
    expect(options).toEqual([
      { type: 'number', key: 'n', label: 'N', default: 3, min: 1 },
      {
        type: 'select',
        key: 'mode',
        label: 'mode',
        choices: [
          { value: 'a', label: 'a' },
          { value: 'b', label: 'Bee' },
        ],
        default: 'a',
      },
    ]);
  });

  it('describes and runs the example plugin, with the network taken away', async () => {
    const { self, send } = workerLike(EXAMPLE_PLUGIN);
    expect('fetch' in self).toBe(false);
    expect('XMLHttpRequest' in self).toBe(false);
    const described = await send({ kind: 'describe' });
    expect(described).toMatchObject({ ok: true, info: { name: 'Accession numbers' } });
    const info = described.info as { options: unknown[]; sample: string };
    expect(cleanOptions(info.options).map((o) => o.key)).toEqual(['digits', 'sort']);
    const ran = await send({ kind: 'run', input: info.sample, values: { digits: 4, sort: true } });
    expect(ran).toEqual({ ok: true, result: { output: 'VITM/2023/0007\nVITM/2024/0003\nVITM/2024/0012', info: '3 numbers', language: undefined } });
  });

  it('reports plugins that register nothing or throw', async () => {
    expect(await workerLike('const x = 1;').send({ kind: 'describe' })).toMatchObject({ ok: false, error: expect.stringContaining('registers no tool') });
    const thrower = workerLike('export default { name: "T", async run() { throw new Error("no way"); } }');
    expect(await thrower.send({ kind: 'run', input: 'a', values: {} })).toEqual({ ok: false, error: 'no way' });
  });
});
