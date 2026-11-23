/**
 * Accessibility checks with axe-core (WCAG 2.1 A and AA): the home page,
 * settings and every tool in the light theme, and a sample of screens in the
 * dark theme.  Serious and critical problems fail the test.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { TOOLS } from '../../src/tools/registry';

const PAGES = [
  '/#/',
  '/#/settings',
  '/#/tool/json-formatter',
  '/#/tool/image-resize',
  '/#/tool/recipe',
  '/#/tool/calc-finance',
  '/#/tool/unit-converter',
  '/#/tool/pdf-organise',
  '/#/tool/hash',
  '/#/tool/gradient',
  '/#/tool/video-tools',
  '/#/tool/serial-monitor',
  '/#/tool/mermaid-editor',
  '/#/tool/slide-deck',
  '/#/tool/animation-studio',
  '/#/tool/resume-builder',
];

async function check(page: Page, theme: 'light' | 'dark', path: string) {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  // Preview frames hold the user's own HTML in a script-less sandbox, which axe
  // cannot enter; the frames themselves must still be named.
  await expect(page.locator('iframe:not([title]), iframe[title=""]')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = serious.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n${v.nodes
        .slice(0, 5)
        .map((n) => `   ${n.target.join(' ')}: ${n.failureSummary?.split('\n').slice(1, 2).join(' ')}`)
        .join('\n')}`,
  );
  expect(report, report.join('\n')).toEqual([]);
}

for (const path of PAGES) {
  test(`dark: ${path} has no serious accessibility problems`, async ({ page }) => check(page, 'dark', path));
}

for (const path of ['/#/', '/#/settings', ...TOOLS.map((tool) => `/#/tool/${tool.id}`)]) {
  test(`light: ${path} has no serious accessibility problems`, async ({ page }) => check(page, 'light', path));
}

test('the drop dialog and the command palette have no serious accessibility problems', async ({ page }) => {
  await page.goto('/#/');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeVisible();
  const palette = await new AxeBuilder({ page }).include('.palette').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(palette.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette-input')).toBeHidden();
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['{"a":1}'], 'data.json', { type: 'application/json' }));
    return dt;
  });
  await page.dispatchEvent('body', 'drop', { dataTransfer });
  await expect(page.getByTestId('drop-dialog')).toBeVisible();
  const dialog = await new AxeBuilder({ page }).include('[data-testid="drop-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(dialog.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});
