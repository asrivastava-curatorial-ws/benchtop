/**
 * Accessibility checks with axe-core (WCAG 2.1 A and AA): the home page,
 * settings and every tool in the light theme, and a sample of screens in the
 * dark theme.  Serious and critical problems fail the test.
 */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { TOOLS } from '../../src/tools/registry';

const PAGES = [
  '/#/',
  '/#/tools',
  '/#/settings',
  '/#/tool/file-pipeline',
  '/#/tool/projects',
  '/#/tool/offline-search',
  '/#/tool/pdf-studio',
  '/#/tool/vector-editor',
  '/#/tool/model-toolbox',
  '/#/tool/git-workbench',
  '/#/tool/data-logger',
  '/#/tool/svgjs-editor',
  '/#/tool/green-screen',
  '/#/tool/live-quiz',
  '/#/tool/print-studio',
  '/#/tool/logic-analyser',
  '/#/tool/instrument-panel',
  '/join.html',
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
  '/#/tool/asset-finder',
  '/#/tool/asset-credits',
  '/#/tool/translator',
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

for (const path of ['/#/', '/#/tools', '/#/settings', ...TOOLS.map((tool) => `/#/tool/${tool.id}`)]) {
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

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: a live quiz has no serious accessibility problems on the big screen or on a participant's screen`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/#/tool/live-quiz');
    await page.getByRole('radio', { name: 'Present' }).click();
    await page.getByTestId('lq-start').click();
    await page.getByTestId('lq-try').check();
    const pane = page.getByTestId('lq-try-pane');
    const serious = async (what: string) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const found = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v) =>
            `${what}: ${v.id}: ${v.nodes
              .slice(0, 4)
              .map((n) => `${n.target.join(' ')} (${n.failureSummary?.split('\n').slice(1, 2).join(' ')})`)
              .join('; ')}`,
        );
      expect(found, found.join('\n')).toEqual([]);
    };
    // The lobby, with the form to join.
    await expect(pane.getByTestId('qz-name')).toBeVisible();
    await serious('lobby');
    await pane.getByTestId('qz-name').fill('Asha');
    await pane.getByTestId('qz-join').click();
    await expect(pane.getByTestId('qz-lobby')).toBeVisible();
    const next = page.getByTestId('lq-next');
    // Content, then a poll with a vote in.
    await next.click();
    await next.click();
    await pane.getByTestId('qz-option').first().click();
    await serious('poll, choosing');
    await pane.getByTestId('qz-send').click();
    await expect(page.getByTestId('qs-answered')).toHaveText('1 of 1 answered');
    await serious('poll, counted');
    // A scored question: open, then with the answer shown.
    await next.click();
    await expect(page.getByTestId('qs-countdown')).toBeVisible();
    await serious('countdown');
    await expect(pane.getByTestId('qz-option').first()).toBeVisible({ timeout: 10_000 });
    await serious('question, open');
    await pane.getByTestId('qz-option').nth(1).click();
    await pane.getByTestId('qz-send').click();
    await expect(page.getByTestId('qs-summary')).toBeVisible();
    await serious('question, answered');
    // The results.
    await page.getByRole('radio', { name: 'Results' }).click();
    await expect(page.getByTestId('lq-table')).toBeVisible();
    await serious('results');
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the print studio has no serious accessibility problems in any of its parts`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/#/tool/print-studio');
    const serious = async (what: string) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const found = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v) =>
            `${what}: ${v.id}: ${v.nodes
              .slice(0, 4)
              .map((n) => `${n.target.join(' ')} (${n.failureSummary?.split('\n').slice(1, 2).join(' ')})`)
              .join('; ')}`,
        );
      expect(found, found.join('\n')).toEqual([]);
    };
    // Colour, with the sample picture, its figures and the legend of a view.
    await page.getByTestId('pp-sample').click();
    await expect(page.getByTestId('pp-outside')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('pp-view').selectOption('coverage');
    await expect(page.getByTestId('pp-legend')).toBeVisible();
    await serious('colour');
    // Marks, with the preview and a warning.
    await page.getByRole('radio', { name: 'Printer’s marks' }).click();
    await page.getByTestId('pm-sample').click();
    await page.getByTestId('pm-bleed').fill('5');
    await expect(page.getByTestId('pm-short')).toBeVisible();
    await expect(page.getByTestId('pm-preview')).toBeVisible({ timeout: 30_000 });
    await serious('marks');
    // Nesting, with sheets drawn and the list of pieces.
    await page.getByRole('radio', { name: 'Nesting' }).click();
    await serious('nesting, empty');
    await page.getByTestId('pn-sample').click();
    await expect(page.getByTestId('pn-summary')).toBeVisible();
    await serious('nesting');
    // The sheet planner, with its table and picture.
    await page.getByRole('radio', { name: 'Sheet planner' }).click();
    await expect(page.getByTestId('ps-summary')).toBeVisible();
    await serious('sheet planner');
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the logic analyser has no serious accessibility problems with a capture, its decoders and the device panel`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/#/tool/logic-analyser');
    await page.getByTestId('la-demo').click();
    await expect(page.getByTestId('la-row')).toHaveCount(4);
    await page.getByTestId('la-device-open').click();
    await page.getByTestId('la-connect').click();
    await expect(page.getByTestId('la-found')).toBeVisible({ timeout: 30_000 });
    await page.locator('.la-help summary').click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const found = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map(
        (v) =>
          `${v.id}: ${v.nodes
            .slice(0, 4)
            .map((n) => `${n.target.join(' ')} (${n.failureSummary?.split('\n').slice(1, 2).join(' ')})`)
            .join('; ')}`,
      );
    expect(found, found.join('\n')).toEqual([]);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the instrument panel has no serious accessibility problems while it runs and while it is edited`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/#/tool/instrument-panel');
    await page.getByTestId('ip-connect').click();
    await expect(page.getByTestId('ip-status')).toContainText('lines of readings');
    await page.getByRole('slider').fill('200');
    await page.getByRole('switch', { name: 'Lamp' }).check();
    const serious = async (what: string) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const found = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v) =>
            `${what}: ${v.id}: ${v.nodes
              .slice(0, 4)
              .map((n) => `${n.target.join(' ')} (${n.failureSummary?.split('\n').slice(1, 2).join(' ')})`)
              .join('; ')}`,
        );
      expect(found, found.join('\n')).toEqual([]);
    };
    await serious('running');
    await page.getByTestId('ip-edit').click();
    await page.locator('.ip-help summary').click();
    await serious('editing');
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: an open PDF in the PDF Reader and in the Flipbook Reader has no serious accessibility problems`, async ({ page }) => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 4; i++) doc.addPage([595, 842]).drawText(`Page ${i}`, { x: 60, y: 760, size: 28, font });
    const buffer = Buffer.from(await doc.save());
    const serious = async (what: string, scope: string) => {
      const results = await new AxeBuilder({ page }).include(scope).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const found = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v) =>
            `${what}: ${v.id}: ${v.nodes
              .slice(0, 4)
              .map((n) => `${n.target.join(' ')} (${n.failureSummary?.split('\n').slice(1, 2).join(' ')})`)
              .join('; ')}`,
        );
      expect(found, found.join('\n')).toEqual([]);
    };
    await page.emulateMedia({ colorScheme: theme });
    for (const [tool, drop, ready, scope] of [
      ['pdf-reader', 'rd-drop', '[data-testid=rd-page-1] canvas', '.rd'],
      ['flipbook-reader', 'fbr-drop', '.fbk[data-page]', '.fbk'],
    ] as const) {
      await page.goto(`/#/tool/${tool}`);
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId(drop).click();
      await (await chooser).setFiles({ name: 'book.pdf', mimeType: 'application/pdf', buffer });
      await page.locator(ready).first().waitFor();
      await page.waitForTimeout(600);
      await serious(tool, scope);
    }
    // The flipbook's panels and zoom.
    await page.locator('[data-fbk=panel]').click();
    await serious('flipbook contents', '.fbk');
    await page.locator('[data-fbk=tab-pages]').click();
    await serious('flipbook pages', '.fbk');
    await page.locator('[data-fbk=panel-close]').click();
    await page.locator('[data-fbk=zoom]').click();
    await serious('flipbook zoom', '.fbk');
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: Text Translator has no serious accessibility problems while typing in a script and converting one`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/#/tool/translator');
    const scan = async (where: string) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const found = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v) =>
            `${where}: ${v.id}: ${v.nodes
              .slice(0, 4)
              .map((n) => `${n.target.join(' ')} (${n.failureSummary?.split('\n').slice(1, 2).join(' ')})`)
              .join('; ')}`,
        );
      expect(found, found.join('\n')).toEqual([]);
    };
    await page.getByTestId('tr-mode-type').click();
    await page.getByTestId('tr-type-language').selectOption('ar');
    await page.getByTestId('tr-type-input').fill('mar7aba, madrasa 12');
    await page.getByTestId('tr-type-keyboard').click();
    await expect(page.getByTestId('tr-spellings')).toBeVisible();
    await expect(page.getByTestId('tr-keyboard')).toBeVisible();
    await scan('typing');
    await page.getByTestId('tr-mode-convert').click();
    await page.getByTestId('tr-convert-input').fill('नमस्ते भारत');
    await expect(page.getByTestId('tr-convert-output')).not.toHaveValue('');
    await scan('converting');
  });

  test(`${theme}: Asset Finder has no serious accessibility problems with results, an asset's details, downloads and the connector editor`, async ({ page }) => {
    const answer = JSON.parse(readFileSync(new URL('../fixtures/assets/openverse_images.json', import.meta.url), 'utf8'));
    await page.addInitScript((openverse) => {
      const encode = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      const reply = (url: string, status: number, type: string, body: string) => ({
        url,
        status,
        reason: '',
        version: 'HTTP/1.1',
        headers: [['content-type', type]],
        body,
        bodySize: 0,
        truncated: false,
        remoteAddr: null,
        headersMs: 1,
        elapsedMs: 1,
        peerCertificate: null,
      });
      const no = async () => {
        throw new Error('not in this test');
      };
      (globalThis as { __benchtopNetTransport?: unknown }).__benchtopNetTransport = {
        http: async (request: { url: string }) => {
          const url = new URL(request.url);
          if (url.pathname.endsWith('/thumb/') || /\.(jpe?g|png)$/.test(url.pathname)) return reply(request.url, 200, 'image/png', png);
          if (url.host === 'api.openverse.org') return reply(request.url, 200, 'application/json', encode(JSON.stringify(openverse)));
          return reply(request.url, 404, 'text/plain', encode('not in this test'));
        },
        tls: no,
        dns: no,
        whois: no,
        probe: no,
      };
    }, answer);
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/#/tool/asset-finder');
    await page.getByTestId('af-query').fill('moon');
    await page.getByTestId('af-licence').selectOption('by-sa');
    await page.getByTestId('af-search').click();
    await page
      .getByTestId('af-results')
      .getByRole('button', { name: /Moon over the city/ })
      .click();
    await expect(page.getByTestId('af-files')).toContainText('Original');
    const scan = async (where: string) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const found = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v) =>
            `${where}: ${v.id}: ${v.nodes
              .slice(0, 4)
              .map((n) => `${n.target.join(' ')} (${n.failureSummary?.split('\n').slice(1, 2).join(' ')})`)
              .join('; ')}`,
        );
      expect(found, found.join('\n')).toEqual([]);
    };
    await scan('results');
    await page.getByTestId('af-files').getByRole('button', { name: 'Download' }).first().click();
    await page.getByTestId('af-tab-downloads').click();
    await expect(page.getByTestId('af-downloads')).toContainText('Saved');
    await scan('downloads');
    await page.getByTestId('af-tab-sources').click();
    await expect(page.getByTestId('af-connector')).toContainText('Openverse');
    await scan('sources');
    await page.getByTestId('af-tab-library').click();
    await scan('library');
  });
}
