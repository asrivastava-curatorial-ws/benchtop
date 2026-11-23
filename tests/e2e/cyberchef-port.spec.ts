/**
 * The CyberChef operations that run from CyberChef's own code (src/recipe/vendor),
 * checked in the built app with CyberChef's own test vectors
 * (tests/e2e/fixtures/cyberchef-port-cases.json, taken from CyberChef's tests).
 */
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

interface Case {
  readonly name: string;
  readonly input: string;
  readonly expected?: string;
  /** A regular expression the output must match, when CyberChef's test gives one instead. */
  readonly match?: { source: string; flags: string };
  readonly recipe: readonly { op: string; args: unknown[] }[];
}

const cases: Case[] = JSON.parse(readFileSync(new URL('./fixtures/cyberchef-port-cases.json', import.meta.url), 'utf8'));
const byOp = new Map<string, Case[]>();
for (const c of cases) {
  const op = c.recipe[0]?.op ?? '';
  byOp.set(op, [...(byOp.get(op) ?? []), c].slice(0, 4));
}

const NBSP = new RegExp(String.fromCharCode(0xa0), 'g');

/** Operations that search a large space; with four tests sharing the processor one bake can take a minute or more. */
const SLOW = new Set(['Bombe', 'Multiple Bombe']);
const waitFor = (c: Case) => (SLOW.has(c.recipe[0]?.op ?? '') ? 180_000 : 60_000);

/** What the recipe produced: its output, or the error it stopped with. */
/**
 * Reads an element that may disappear between counting and reading it (the output editor makes way
 * for a picture or an error when a bake finishes); a locator would otherwise wait for it forever.
 */
const briefly = { timeout: 1000 } as const;

async function result(page: Page): Promise<string> {
  const error = page.getByTestId('recipe-error');
  if (await error.count()) {
    const message = await error
      .first()
      .textContent(briefly)
      .catch(() => null);
    if (message !== null) return `ERROR: ${message.trim()}`;
  }
  // The editor's own text, as rendered lines show control characters as symbols.
  const content = page.getByTestId('recipe-output').locator('.cm-content');
  const text = !(await content.count())
    ? null
    : await content
        .first()
        .evaluate(
          (el) => {
            // CodeMirror links its DOM to its view (EditorView.findFromDOM): cmTile in current versions, cmView before.
            type Doc = { state: { doc: { toString(): string } } };
            const node = el as unknown as { cmTile?: { root?: { view?: Doc } }; cmView?: { rootView?: { view?: Doc } } };
            return (node.cmTile?.root?.view ?? node.cmView?.rootView?.view)?.state.doc.toString() ?? null;
          },
          undefined,
          briefly,
        )
        .catch(() => null);
  if (text !== null) return text;
  // Outputs shown as a picture (charts, maps) keep their text in a caption.
  const caption = page.getByTestId('recipe-output-text');
  if (await caption.count())
    return (
      (await caption
        .first()
        .textContent(briefly)
        .catch(() => null)) ?? ''
    );
  return (await page.getByTestId('recipe-output').locator('.cm-line').allTextContents()).join('\n').replace(NBSP, ' ');
}

async function run(page: Page, c: Case) {
  // A fresh page per case: nothing carries over from the previous recipe.
  await page.goto('about:blank');
  await page.goto('/#/tool/recipe');
  await expect(page.getByTestId('recipe-search')).toBeVisible();
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByPlaceholder(/Paste a CyberChef recipe/).fill(JSON.stringify(c.recipe));
  await page.getByRole('button', { name: 'Load recipe' }).click();
  // The recipe must load completely; a problem shows as an error or a toast.
  await expect(page.getByTestId('recipe-step'), `${c.name}: ${await page.locator('.toast').allInnerTexts()}`).toHaveCount(c.recipe.length);
  // Replace the input through the editor itself (typing depends on focus, which a closing dialog can
  // take), and again if the tool restores the previous case's saved input just afterwards.
  const input = page.getByTestId('recipe-input').locator('.cm-content');
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = await input.evaluate((el, text) => {
      type View = { state: { doc: { length: number; toString(): string } }; dispatch(spec: unknown): void };
      const view = (el as unknown as { cmTile?: { root?: { view?: View } } }).cmTile?.root?.view;
      view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      return view?.state.doc.toString();
    }, c.input);
    await page.waitForTimeout(300);
    const later = await input.evaluate((el) => (el as unknown as { cmTile?: { root?: { view?: { state: { doc: { toString(): string } } } } } }).cmTile?.root?.view?.state.doc.toString());
    if (now === c.input && later === c.input) break;
  }
  if (c.expected === undefined) {
    // CyberChef's regular expressions may describe the presented HTML (Bombe's table) rather than the data.
    const pattern = new RegExp((c.match as { source: string }).source, (c.match as { flags: string }).flags);
    const preview = page.getByTestId('preview-html');
    const both = async () =>
      `${await result(page)}\n${
        (await preview.count())
          ? await preview
              .first()
              .innerHTML(briefly)
              .catch(() => '')
          : ''
      }`;
    await expect.poll(both, { message: c.name, timeout: waitFor(c) }).toMatch(pattern);
    return;
  }
  // The editor shows CRLF as a plain line break; copy and save keep the bytes.
  const want = c.expected.replace(/\r\n?/g, '\n');
  // CyberChef's tests give the error message as the expected output when a step should fail.
  await expect
    .poll(
      async () => {
        const got = await result(page);
        return got.startsWith('ERROR: ') && want.trim() && got.includes(want.trim()) ? want : got;
      },
      { message: c.name, timeout: waitFor(c) },
    )
    .toBe(want);
}

test.describe('CyberChef operations from CyberChef’s code', () => {
  for (const [op, list] of byOp) {
    test(op, async ({ page }) => {
      // Bombe and a few others take many seconds when four tests share the processor.
      test.setTimeout((SLOW.has(op) ? 190_000 : 70_000) * list.length);
      for (const c of list) await run(page, c);
    });
  }
});
