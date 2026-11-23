import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const python = ['python3', 'python'].find((name) => spawnSync(name, ['--version']).status === 0);

describe('Python scripts shipped with Benchtop', () => {
  it.skipIf(!python)('the IndicTrans2 server passes its own tests (no PyTorch needed)', () => {
    const run = spawnSync(python as string, ['-I', '-W', 'ignore::ResourceWarning', '-m', 'unittest', 'discover', '-s', 'tests/python'], { encoding: 'utf8', timeout: 120_000 });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toMatch(/Ran \d+ tests/);
  });
});
