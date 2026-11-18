/**
 * Files dropped on the window open a list of tools that can read them, and
 * "Send to" hands a result to another tool.
 */
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

/** Drops files on the page, by default outside any tool's own drop area. */
async function drop(page: Page, files: { name: string; type: string; base64: string }[], target = 'body') {
  const dataTransfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
    return dt;
  }, files);
  await page.dispatchEvent(target, 'dragenter', { dataTransfer });
  await page.dispatchEvent(target, 'drop', { dataTransfer });
}

const b64 = (text: string) => Buffer.from(text).toString('base64');

test('a JSON file dropped on the home page opens in the JSON formatter', async ({ page }) => {
  await page.goto('/');
  await drop(page, [{ name: 'data.json', type: 'application/json', base64: b64('{"b":1,"a":[true,null]}') }]);
  const dialog = page.getByTestId('drop-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Open data.json in');
  await expect(dialog.locator('[data-tool="json-formatter"]')).toBeVisible();
  await expect(dialog.locator('[data-tool="hex-viewer"]')).toBeVisible();
  await dialog.locator('[data-tool="json-formatter"]').click();
  await expect(page).toHaveURL(/#\/tool\/json-formatter$/);
  await expect(page.getByTestId('input-editor')).toContainText('"b":1');
  await expect(page.getByTestId('output-editor')).toContainText('"a": [');
});

test('a picture dropped on the window opens in an image tool, and its result can be sent on', async ({ page }) => {
  await page.goto('/#/settings');
  const png = readFileSync(new URL('./fixtures/sample.png', import.meta.url)).toString('base64');
  await drop(page, [{ name: 'sample.png', type: 'image/png', base64: png }]);
  const dialog = page.getByTestId('drop-dialog');
  await expect(dialog.locator('[data-tool="image-resize"]')).toBeVisible();
  await dialog.locator('[data-tool="image-resize"]').click();
  await expect(page).toHaveURL(/#\/tool\/image-resize$/);
  await expect(page.getByTestId('image-source')).toContainText('sample.png');
  // The result goes on to another image tool.
  await page.getByTestId('export-bar').getByTestId('send-to').click();
  const next = page.getByTestId('drop-dialog');
  await expect(next.locator('[data-tool="image-resize"]')).toHaveCount(0);
  await next.locator('[data-tool="image-crop"]').click();
  await expect(page).toHaveURL(/#\/tool\/image-crop$/);
  await expect(page.getByTestId('image-source')).toContainText('sample');
});

test('the Recipe output can be sent to another tool', async ({ page }) => {
  await page.goto('/#/tool/recipe');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByPlaceholder(/Paste a CyberChef recipe/).fill('[{"op":"To Upper case","args":["All"]}]');
  await page.getByRole('button', { name: 'Load recipe' }).click();
  await page.getByTestId('recipe-input').locator('.cm-content').click();
  await page.keyboard.insertText('send me on');
  await expect(page.getByTestId('recipe-output')).toContainText('SEND ME ON');
  await page.locator('.recipe-output').getByTestId('send-to').click();
  const dialog = page.getByTestId('drop-dialog');
  await expect(dialog.locator('[data-tool="recipe"]')).toHaveCount(0);
  await dialog.locator('[data-tool="word-counter"]').click();
  await expect(page).toHaveURL(/#\/tool\/word-counter$/);
  await expect(page.getByTestId('input-editor')).toContainText('SEND ME ON');
});

test('a tool’s own drop area keeps the files dropped on it', async ({ page }) => {
  await page.goto('/#/tool/image-rotate');
  const png = readFileSync(new URL('./fixtures/sample.png', import.meta.url)).toString('base64');
  await drop(page, [{ name: 'sample.png', type: 'image/png', base64: png }], '[data-testid="dropzone"]');
  await expect(page.getByTestId('image-source')).toContainText('sample.png');
  await expect(page.getByTestId('drop-dialog')).toHaveCount(0);
});

test('a calculation can be kept, saved as a PDF and shared as a link that restores it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/tool/calc-finance');
  const card = page.getByTestId('calc-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  const firstInput = card.locator('.calc-field input').first();
  await firstInput.fill('123456');
  await page.getByTestId('calc-keep').click();
  await expect(page.getByTestId('calc-history')).toContainText('123,456');
  const download = page.waitForEvent('download');
  await page.getByTestId('calc-pdf').click();
  const pdf = await (await download).path();
  expect(pdf).toBeTruthy();
  await page.getByTestId('calc-link').click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/^#\/tool\/calc-finance\?calc=[a-z0-9-]+&s=[A-Za-z0-9_-]+$/);
  // Somewhere else, with other values, the link brings these back.
  await firstInput.fill('7');
  await page.goto('/#/');
  await page.goto(`/${link}`);
  await expect(card.locator('.calc-field input').first()).toHaveValue('123456');
  await expect(page).toHaveURL(/#\/tool\/calc-finance$/);
  // Pasted into the search, it opens too.
  await page.goto('/#/');
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill(link);
  await expect(page.getByTestId('palette-link')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/tool\/calc-finance/);
});
