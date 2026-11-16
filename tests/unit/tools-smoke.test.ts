import { describe, expect, it } from 'vitest';
import { ToolError } from '../../src/lib/errors';
import { textToolLoaders } from '../../src/tools/text/index';
import { run } from './helpers';

/** These parse with the browser's DOM; the end-to-end smoke test covers them. */
const NEEDS_DOM = new Set(['device-info', 'selector-tester', 'xslt']);

describe('every text tool', () => {
  it('runs its sample with default options, or explains what it needs', async () => {
    const crashes: string[] = [];
    for (const [id, load] of Object.entries(textToolLoaders)) {
      if (NEEDS_DOM.has(id)) continue;
      // biome-ignore lint/suspicious/noExplicitAny: accepts every tool spec
      const spec = (await (load as () => Promise<{ default: any }>)()).default;
      const sample = spec.input ? (spec.input.sample ?? '') : '';
      const sample2 = spec.input2 ? (spec.input2.sample ?? '') : '';
      try {
        await run(spec, sample, {}, { input2: sample2 });
      } catch (error) {
        if (!(error instanceof ToolError)) crashes.push(`${id}: ${(error as Error).message}`);
      }
    }
    expect(crashes).toEqual([]);
  }, 120_000);
});
