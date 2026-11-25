import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { freeName, MANIFEST, newProject, type Project, projectSize, readBundle, readProject, writeBundle } from '../../src/lib/project-bundle';
import { chain } from '../../src/lib/workflow';

const sample = (): { project: Project; data: Map<string, Uint8Array> } => {
  const base = newProject('  Engine   Hall  ', 1_700_000_000_000);
  const project: Project = {
    ...base,
    notes: 'Labels for the new gallery',
    files: [
      { id: 'a1', name: 'labels.csv', role: 'input', size: 5, mime: 'text/csv', tool: 'csv-to-json', added: 1 },
      { id: 'b2', name: 'labels.json', role: 'output', size: 4, tool: 'csv-to-json', added: 2 },
      { id: 'c3', name: 'Split (out)/labels-1.csv', role: 'intermediate', size: 3, tool: 'file-pipeline', added: 3 },
    ],
    toolOptions: { 'csv-to-json': { delimiter: ';' }, 'file-pipeline': { workflow: { id: 'w', name: 'W', nodes: [], edges: [] } } },
    collectOutputs: false,
  };
  return {
    project,
    data: new Map([
      ['a1', strToU8('a;b\n1')],
      ['b2', strToU8('[{}]')],
      ['c3', strToU8('a;b')],
    ]),
  };
};

describe('project bundles', () => {
  it('cleans names', () => {
    expect(sample().project.name).toBe('Engine Hall');
    expect(newProject('   ').name).toBe('Untitled project');
  });

  it('round-trips a project with its files, settings and workflows', () => {
    const { project, data } = sample();
    const sub = { ...chain('Sub', [{ tool: 'sort-lines', values: {} }]), id: 'sub' };
    const bytes = writeBundle(project, data, [sub]);
    const zip = unzipSync(bytes);
    expect(Object.keys(zip).sort()).toEqual([MANIFEST, 'files/input/labels.csv', 'files/intermediate/Split (out)/labels-1.csv', 'files/output/labels.json'].sort());
    expect(JSON.parse(strFromU8(zip[MANIFEST] as Uint8Array))).toMatchObject({ benchtop: 'project', version: 1 });
    const opened = readBundle(bytes);
    // A new id, so the same bundle can be opened twice.
    expect(opened.project.id).not.toBe(project.id);
    expect(opened.project).toMatchObject({ name: 'Engine Hall', notes: 'Labels for the new gallery', collectInputs: true, collectOutputs: false, toolOptions: project.toolOptions });
    expect(opened.project.files.map((f) => [f.name, f.role, f.size, f.tool])).toEqual([
      ['labels.csv', 'input', 5, 'csv-to-json'],
      ['labels.json', 'output', 4, 'csv-to-json'],
      ['Split (out)/labels-1.csv', 'intermediate', 3, 'file-pipeline'],
    ]);
    expect(opened.project.files.map((f) => strFromU8(opened.data.get(f.id) as Uint8Array))).toEqual(['a;b\n1', '[{}]', 'a;b']);
    expect(opened.library).toEqual([sub]);
    expect(projectSize(opened.project)).toBe(12);
  });

  it('leaves out files whose contents are missing, on the way out and on the way in', () => {
    const { project, data } = sample();
    data.delete('b2');
    const opened = readBundle(writeBundle(project, data));
    expect(opened.project.files.map((f) => f.name)).toEqual(['labels.csv', 'Split (out)/labels-1.csv']);
    const manifest = { benchtop: 'project', version: 1, project: { name: 'P', files: [{ id: 'x', name: 'gone.txt', role: 'input', path: 'files/input/gone.txt' }] } };
    expect(readBundle(zipSync({ [MANIFEST]: strToU8(JSON.stringify(manifest)) })).project.files).toEqual([]);
  });

  it('does not trust what a bundle says', () => {
    const manifest = {
      benchtop: 'project',
      version: 1,
      project: {
        id: '../../evil',
        name: 'x'.repeat(500),
        notes: 7,
        files: [
          { id: 'ok', name: '../../../etc/passwd', role: 'root', size: -5, mime: 'text/html<script>', tool: '../x', path: 'files/input/p' },
          { id: 'ok', name: 'duplicate id', role: 'input', path: 'files/input/p' },
          { id: 'bad id!', name: 'x', role: 'input', path: 'files/input/p' },
          { id: 'outside', name: 'secret', role: 'input', path: '../outside.txt' },
        ],
        toolOptions: { 'json-formatter': { mode: 'format' }, '../bad': {}, 'not-an-object': 5, __proto__: { polluted: true } },
      },
      library: [{ nodes: 'no' }, 5],
    };
    const opened = readBundle(zipSync({ [MANIFEST]: strToU8(JSON.stringify(manifest)), 'files/input/p': strToU8('data'), '../outside.txt': strToU8('nope'), 'extra/ignored.txt': strToU8('x') }));
    expect(opened.project.name).toHaveLength(80);
    expect(opened.project.notes).toBe('');
    expect(opened.project.files).toHaveLength(1);
    expect(opened.project.files[0]).toMatchObject({ name: 'etc/passwd', role: 'input', size: 4 });
    expect(opened.project.files[0]?.mime).toBeUndefined();
    expect(opened.project.files[0]?.tool).toBeUndefined();
    expect(Object.keys(opened.project.toolOptions)).toEqual(['json-formatter']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(opened.library).toEqual([]);
  });

  it('explains files that are not bundles', () => {
    expect(() => readBundle(strToU8('hello'))).toThrow(/not a project bundle/);
    expect(() => readBundle(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/no benchtop-project.json/);
    expect(() => readBundle(zipSync({ [MANIFEST]: strToU8('{oops') }))).toThrow(/manifest is damaged/);
    expect(() => readBundle(zipSync({ [MANIFEST]: strToU8('{"benchtop":"workflow"}') }))).toThrow(/not a Benchtop project/);
    expect(() => readBundle(zipSync({ [MANIFEST]: strToU8('{"benchtop":"project","version":9,"project":{}}') }))).toThrow(/newer version/);
  });

  it('gives clashing names a number, per role', () => {
    const files = [
      { id: '1', name: 'a.txt', role: 'input' as const, size: 0, added: 0 },
      { id: '2', name: 'A (2).TXT', role: 'input' as const, size: 0, added: 0 },
    ];
    expect(freeName(files, 'input', 'a.txt')).toBe('a (3).txt');
    expect(freeName(files, 'output', 'a.txt')).toBe('a.txt');
    expect(freeName(files, 'input', 'dir.v2/readme')).toBe('dir.v2/readme');
    expect(readProject(null)).toBeNull();
    expect(readProject({})?.files).toEqual([]);
  });
});
