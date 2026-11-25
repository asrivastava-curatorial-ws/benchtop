import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { jsWorker, LANGUAGES, luaWorker, pythonWorker, splitSql, sqliteWorker, stripTypes, textTable } from '../../src/lib/coderun';

type Message = { type: string; stream?: string; text?: string; exitCode?: number; line?: number };

/** Runs a JavaScript worker script in a fresh context that stands in for a worker, until it says it is done. */
function runWorker(script: string, timeout = 3000): Promise<{ out: string; err: string; exitCode: number | undefined; messages: Message[] }> {
  return new Promise((resolve, reject) => {
    const messages: Message[] = [];
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const sandbox: Record<string, unknown> = {
      postMessage: (m: Message) => {
        messages.push(m);
        if (m.type === 'done') {
          clearTimeout(timer);
          resolve({
            out: messages
              .filter((x) => x.type === 'out' && x.stream === 'stdout')
              .map((x) => x.text)
              .join(''),
            err: messages
              .filter((x) => (x.type === 'out' && x.stream === 'stderr') || x.type === 'error')
              .map((x) => x.text)
              .join(''),
            exitCode: m.exitCode,
            messages,
          });
        }
      },
      addEventListener: (name: string, fn: (e: unknown) => void) => {
        listeners[name] = [...(listeners[name] ?? []), fn];
      },
      console: { log() {}, info() {}, debug() {}, trace() {}, warn() {}, error() {}, table() {}, dir() {} },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      queueMicrotask,
      TextEncoder,
      performance,
      fetch: () => Promise.resolve('network'),
      indexedDB: { open() {} },
      navigator: { storage: {} },
    };
    sandbox.self = sandbox;
    const context = vm.createContext(sandbox);
    const timer = setTimeout(() => reject(new Error(`no 'done' within ${timeout} ms: ${JSON.stringify(messages)}`)), timeout);
    try {
      vm.runInContext(script, context, { filename: 'blob:http://app/worker' });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

describe('the built-in JavaScript runner', () => {
  it('prints like Node', async () => {
    const r = await runWorker(
      jsWorker("console.log('Hello', 42, [1, 2, 3], { a: 'x', b: [true, null] }, new Map([['k', 1]]));\nconsole.log('%s is %d years', 'Ada', 36.5);\nconsole.error('oops');", '').script,
    );
    expect(r.out).toBe("Hello 42 [ 1, 2, 3 ] { a: 'x', b: [ true, null ] } Map(1) { 'k' => 1 }\nAda is 36.5 years\n");
    expect(r.err).toBe('oops\n');
    expect(r.exitCode).toBe(0);
  });

  it('reads standard input with readline, fs and prompt', async () => {
    const readline =
      "const rl = require('readline').createInterface({ input: process.stdin });\nconst seen = [];\nrl.on('line', (l) => seen.push(l.toUpperCase()));\nrl.on('close', () => console.log(seen.join('|')));";
    expect((await runWorker(jsWorker(readline, 'a\nb\nc\n').script)).out).toBe('A|B|C\n');
    expect((await runWorker(jsWorker("console.log(require('fs').readFileSync(0, 'utf8').trim().split('\\n').length)", 'x\ny\n').script)).out).toBe('2\n');
    expect((await runWorker(jsWorker('const a = prompt(); const b = prompt(); console.log(Number(a) + Number(b), prompt());', '2\n3\n').script)).out).toBe('5 null\n');
    const iterate = "const rl = require('readline').createInterface({ input: process.stdin });\nlet n = 0;\nfor await (const line of rl) n += Number(line);\nconsole.log(n);";
    expect((await runWorker(jsWorker(iterate, '4\n5\n').script)).out).toBe('9\n');
  });

  it('waits for timers and promises, and exits with process.exit', async () => {
    const r = await runWorker(jsWorker("setTimeout(() => console.log('later'), 20);\nawait new Promise((res) => setTimeout(res, 5));\nconsole.log('first');", '').script);
    expect(r.out).toBe('first\nlater\n');
    const exit = await runWorker(jsWorker("console.log('before');\nprocess.exit(3);\nconsole.log('never');", '').script);
    expect([exit.out, exit.exitCode]).toEqual(['before\n', 3]);
  });

  it('reports errors with the line in the code', async () => {
    const r = await runWorker(jsWorker('const a = 1;\nconst b = 2;\nnull.boom;', '').script);
    expect(r.exitCode).toBe(1);
    expect(r.messages.find((m) => m.type === 'error')?.line).toBe(3);
    expect(r.err).toMatch(/TypeError/);
  });

  it('has no network or storage', async () => {
    const r = await runWorker(jsWorker('console.log(typeof fetch, typeof indexedDB, typeof importScripts, typeof navigator.storage);', '').script);
    expect(r.out).toBe('undefined undefined undefined undefined\n');
  });

  it('turns TypeScript into JavaScript and explains imports', async () => {
    const js = await stripTypes('interface P { x: number }\nconst p: P = { x: 2 };\nfunction twice<T>(v: T): [T, T] { return [v, v]; }\nconsole.log(twice<number>(p.x));\n');
    expect((await runWorker(jsWorker(js, '').script)).out).toBe('[ 2, 2 ]\n');
    await expect(stripTypes('const x: = 1')).rejects.toThrow('could not be read');
    expect(() => jsWorker("import fs from 'fs';", '')).toThrow('require()');
  });
});

describe('SQL output and the other runtimes', () => {
  it('draws result tables and splits scripts', () => {
    expect(
      textTable(
        ['id', 'name'],
        [
          ['1', 'Ada'],
          ['22', null],
        ],
      ),
    ).toBe('┌────┬──────┐\n│ id │ name │\n├────┼──────┤\n│  1 │ Ada  │\n│ 22 │ NULL │\n└────┴──────┘\n(2 rows)\n');
    expect(splitSql("SELECT 'a;b'; -- c;\nSELECT 2 /* ; */;\n\n")).toEqual(["SELECT 'a;b'", '-- c;\nSELECT 2 /* ; */']);
  });

  it('builds the Python, Lua and SQLite workers against the runtime folder', () => {
    expect(pythonWorker('http://app/coderun/')).toContain('importScripts("http://app/coderun/pyodide/pyodide.js")');
    expect(luaWorker('http://app/coderun/', 'print(1)', '')).toContain('glue.wasm');
    expect(sqliteWorker('http://app/coderun/', 'SELECT 1')).toContain('sql-wasm.js');
  });

  it('has examples for every language, and install hints for the toolchains', () => {
    for (const l of LANGUAGES) {
      expect(l.examples.length, l.id).toBeGreaterThan(0);
      if (l.desktop) expect(l.install, l.id).toBeDefined();
    }
  });
});
