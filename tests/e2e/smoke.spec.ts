/**
 * Opens every tool in the production build and checks that it works, that
 * nothing is logged as an error and that no request leaves the app.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { TOOLS } from '../../src/tools/registry';

const SAMPLE_PNG = readFileSync(new URL('./fixtures/sample.png', import.meta.url));
/** A 64 x 48 JPEG with camera details, GPS coordinates, XMP and a comment (made with Pillow). */
const EXIF_JPEG = readFileSync(new URL('./fixtures/exif.jpg', import.meta.url));
/** A QR code holding "WIFI:S:Benchtop Lab;T:WPA;P:correct horse;;". */
const QR_PNG = readFileSync(new URL('./fixtures/qr.png', import.meta.url));

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) computed independently of the app. */
function referenceTotp(secretBase32: string, timeMs: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secretBase32) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Collects console errors, uncaught exceptions and any request that is not local. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  const base = String(test.info().project.use.baseURL);
  page.on('console', (message) => {
    // Playwright's trace recorder tries to inject its snapshot script into every frame; the
    // sandboxed previews refuse, which is exactly what they should do.
    if (message.type() === 'error' && !/^Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed/.test(message.text())) {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`exception: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on('request', (request) => {
    const url = request.url();
    if (!/^(data|blob|about):/.test(url) && !url.startsWith(base)) problems.push(`network: ${url}`);
  });
  return problems;
}

async function openTool(page: Page, id: string): Promise<Locator> {
  await page.goto(`./#/tool/${id}`);
  const tool = page.getByTestId('tool');
  await expect(tool).toBeVisible();
  return tool;
}

async function chooseImage(page: Page, trigger: Locator): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await trigger.click();
  await (await chooser).setFiles({ name: 'sample.png', mimeType: 'image/png', buffer: SAMPLE_PNG });
}

async function download(page: Page, click: () => Promise<void>): Promise<Buffer> {
  const pending = page.waitForEvent('download');
  await click();
  const file = await pending;
  const path = await file.path();
  return readFileSync(path);
}

const editorText = async (locator: Locator) => (await locator.locator('.cm-content').textContent()) ?? '';
const frameSource = async (page: Page) => (await page.locator('iframe').first().getAttribute('srcdoc')) ?? '';

const PNG = [0x89, 0x50, 0x4e, 0x47];

/** Tools that need a password or key before they can produce anything; some only run when asked. */
const NEEDS_SECRET: Record<string, { field: string; value: string; run: boolean }> = {
  aes: { field: 'password', value: 'correct horse battery staple', run: true },
  htpasswd: { field: 'password', value: 'hunter2', run: true },
  'jwt-encoder': { field: 'secret', value: 'a-long-enough-test-secret-for-hs256!', run: false },
};

const CUSTOM_CHECKS: Record<string, (page: Page, tool: Locator) => Promise<void>> = {
  'clip-path': async (page, tool) => {
    const output = page.getByTestId('output-editor');
    const before = await editorText(output);
    const handle = tool.locator('.handle').first();
    const box = await handle.boundingBox();
    if (!box) throw new Error('No handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 50, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => editorText(output)).not.toBe(before);
    expect(await editorText(output)).toMatch(/clip-path: polygon\(/);
  },
  'cubic-bezier': async (page, tool) => {
    await tool.getByRole('button', { name: 'ease-in', exact: true }).click();
    await expect.poll(() => editorText(page.getByTestId('output-editor'))).toContain('cubic-bezier(0.42, 0, 1, 1)');
  },
  'media-query': async (page) => {
    await expect.poll(() => frameSource(page)).toContain('@media screen and (min-width: 768px)');
  },
  'bootstrap-theme': async (page, tool) => {
    await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
    expect(await frameSource(page)).toContain('--bs-primary: #0d6efd;');
    await page.getByTestId('bs-search').fill('primary');
    await page.locator('#bs-var-primary').fill('#ff0000');
    await expect.poll(() => frameSource(page), { timeout: 60_000 }).toContain('--bs-primary: #ff0000;');
    await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
    const minified = (await download(page, () => tool.getByRole('button', { name: 'bootstrap.min.css' }).click())).toString('utf8');
    expect(minified).toContain('--bs-primary: #ff0000');
    expect(minified.length).toBeGreaterThan(150_000);
    // A broken value is reported against the variable that caused it.
    await page.locator('#bs-var-primary').fill('12px');
    await expect(tool).toHaveAttribute('data-state', 'error', { timeout: 60_000 });
    await page.locator('#bs-var-primary').fill('');
    await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  },
  'tailwind-colors': async (page) => {
    await expect(page.getByTestId('tw-nearest')).toContainText('blue-500');
  },
  'image-crop': async (page, tool) => {
    await chooseImage(page, page.getByTestId('dropzone'));
    await expect(page.getByTestId('crop-box')).toBeVisible();
    await expect(tool).toHaveAttribute('data-state', 'done');
    const bytes = await download(page, () => page.getByTestId('export-save').click());
    expect([...bytes.subarray(0, 4)]).toEqual(PNG);
  },
  'image-color-picker': async (page) => {
    await chooseImage(page, page.getByTestId('dropzone'));
    const frame = page.getByTestId('picker-frame');
    await expect(frame).toBeVisible();
    const box = await frame.boundingBox();
    if (!box) throw new Error('No frame');
    // The fixture has a white rectangle from (40, 40) to (200, 160) in a 640 x 400 image.
    await page.mouse.click(box.x + (120 / 640) * box.width, box.y + (100 / 400) * box.height);
    await expect(page.getByTestId('picked')).toContainText('#ffffff');
    await expect(page.getByTestId('palette').locator('button')).not.toHaveCount(0);
  },
  favicon: async (page, tool) => {
    await expect(tool).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('favicon-previews').locator('canvas')).toHaveCount(5);
    const bytes = await download(page, () => page.getByTestId('save-ico').click());
    expect([...bytes.subarray(0, 6)]).toEqual([0, 0, 1, 0, 3, 0]);
  },
  'svg-to-png': async (_page, tool) => {
    await expect(tool).toHaveAttribute('data-state', 'done');
    await expect(tool.locator('canvas')).toHaveCount(1);
  },
  'html-playground': async (page) => {
    await expect.poll(() => frameSource(page)).toContain('Field Notes');
  },
  commands: async (page, tool) => {
    await page.getByTestId('commands-search').fill('tcp port');
    await expect(tool.locator('tbody th[scope="row"]')).toHaveText(['Test a TCP port']);
  },
  totp: async (page, tool) => {
    const secret = 'JBSWY3DPEHPK3PXP';
    await page.getByTestId('totp-secret').fill(secret);
    await expect(tool).toHaveAttribute('data-state', 'done');
    const shown = ((await page.getByTestId('totp-code').textContent()) ?? '').replace(/\s/g, '');
    const now = Date.now();
    expect([-30_000, 0, 30_000].map((delta) => referenceTotp(secret, now + delta))).toContain(shown);
    await expect(tool.getByRole('img', { name: 'QR code with the otpauth link' })).toBeVisible();
    // A malformed secret is reported rather than producing codes.
    await page.getByTestId('totp-secret').fill('not base32!');
    await expect(tool).toHaveAttribute('data-state', 'error');
    await page.getByTestId('totp-secret').fill(secret);
  },
  chmod: async (page, tool) => {
    await expect(page.getByTestId('chmod-octal')).toHaveText('755');
    await tool.getByRole('checkbox', { name: 'Group write' }).check();
    await expect(page.getByTestId('chmod-octal')).toHaveText('775');
    await page.getByTestId('chmod-input').fill('rw-r-----');
    await expect(page.getByTestId('chmod-octal')).toHaveText('640');
    await expect(page.getByTestId('code-output')).toContainText('chmod 640 script.sh');
  },
  'http-status': async (page) => {
    await page.getByTestId('status-search').fill('418');
    await expect(page.getByTestId('status-row')).toHaveCount(1);
    await expect(page.getByTestId('status-row')).toContainText("I'm a teapot");
    await page.getByTestId('status-search').fill('rate limit');
    await expect(page.getByTestId('status-row').first()).toContainText('429');
  },
  'mime-types': async (page) => {
    await page.getByTestId('mime-search').fill('holiday.WEBP');
    await expect(page.getByTestId('mime-row').first()).toContainText('image/webp');
  },
  'image-metadata': async (page, tool) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('dropzone').click();
    await (await chooser).setFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: EXIF_JPEG });
    await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    await expect(page.getByTestId('metadata-gps')).toContainText('28.613889, 77.208333');
    await expect(page.getByTestId('metadata-groups')).toContainText('Canon EOS R6');
    await expect(page.getByTestId('metadata-clean')).toContainText('EXIF');
    const cleaned = await download(page, () => page.getByTestId('metadata-save').click());
    expect([...cleaned.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    const text = cleaned.toString('latin1');
    expect(text).not.toContain('Canon');
    expect(text).not.toContain('Test Person');
    expect(text).not.toContain('hello comment');
    expect(cleaned.length).toBeLessThan(EXIF_JPEG.length);
  },
  'qr-decoder': async (page, tool) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('dropzone').click();
    await (await chooser).setFiles({ name: 'qr.png', mimeType: 'image/png', buffer: QR_PNG });
    await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    await expect(page.getByTestId('qr-kind')).toContainText('Wi-Fi network');
    await expect(page.getByTestId('qr-kind')).toContainText('Benchtop Lab');
    await expect(page.getByTestId('code-output')).toContainText('WIFI:S:Benchtop Lab');
  },
  'css-sprite': async (page, tool) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('dropzone').click();
    await (await chooser).setFiles([
      { name: 'home.png', mimeType: 'image/png', buffer: SAMPLE_PNG },
      { name: 'search icon.png', mimeType: 'image/png', buffer: SAMPLE_PNG },
    ]);
    await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    await expect(page.getByTestId('sprite-list').locator('li')).toHaveCount(2);
    await expect.poll(() => editorText(page.getByTestId('code-output'))).toContain('.icon-search-icon {');
    expect(await editorText(page.getByTestId('code-output'))).toContain('background-position: 0 -402px;');
    const bytes = await download(page, () => page.getByTestId('export-save').click());
    expect([...bytes.subarray(0, 4)]).toEqual(PNG);
  },
};

for (const entry of TOOLS) {
  test(`${entry.kind} tool: ${entry.name}`, async ({ page }) => {
    const problems = watch(page);
    const tool = await openTool(page, entry.id);

    if (entry.kind === 'text') {
      const secret = NEEDS_SECRET[entry.id];
      const sample = tool.getByRole('button', { name: 'Sample', exact: true });
      if ((await sample.count()) > 0) {
        await sample.first().click();
        if (secret) {
          await page.locator(`#${entry.id}-${secret.field}`).fill(secret.value);
          if (secret.run) await page.getByTestId('run').click();
        }
        await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
      } else {
        await expect(tool).toHaveAttribute('data-state', /^(idle|done)$/, { timeout: 30_000 });
      }
    } else if (entry.kind === 'visual') {
      await expect(tool).toHaveAttribute('data-state', 'done');
      await expect(page.getByTestId('stage')).toBeVisible();
      const randomize = page.getByTestId('randomize');
      if ((await randomize.count()) > 0) {
        await randomize.click();
        await expect(tool).toHaveAttribute('data-state', 'done');
      }
      const png = page.getByTestId('code-output').getByRole('button', { name: /^PNG/ });
      if ((await png.count()) > 0) {
        const bytes = await download(page, () => png.first().click());
        expect([...bytes.subarray(0, 4)]).toEqual(PNG);
      }
    } else if (entry.kind === 'image') {
      await chooseImage(page, page.getByTestId('dropzone'));
      await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
      await expect(page.getByTestId('image-results').locator('canvas').first()).toBeVisible();
      await expect(page.getByTestId('export-size')).toContainText(/\d/, { timeout: 30_000 });
      if (entry.id === 'image-converter') {
        // WebP and AVIF are encoded by WebAssembly codecs in the worker.
        for (const [format, check] of [
          ['webp', (b: Buffer) => b.subarray(8, 12).toString('latin1') === 'WEBP'],
          ['avif', (b: Buffer) => b.subarray(4, 12).toString('latin1') === 'ftypavif'],
        ] as const) {
          await page.locator('#export-format').selectOption(format);
          await expect(page.getByTestId('export-size')).toContainText(/\d/, { timeout: 60_000 });
          const bytes = await download(page, () => page.getByTestId('export-save').click());
          expect(check(bytes), `${format} signature`).toBe(true);
        }
      }
    } else {
      await CUSTOM_CHECKS[entry.id]?.(page, tool);
      await expect(tool).not.toHaveAttribute('data-state', 'error');
    }

    expect(problems).toEqual([]);
  });
}

test('jq runs in the worker without network access', async ({ page }) => {
  const problems = watch(page);
  const tool = await openTool(page, 'json-query');
  await tool.getByRole('button', { name: 'Sample', exact: true }).click();
  await tool.getByRole('radio', { name: 'jq' }).click();
  await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
  await expect.poll(() => editorText(page.getByTestId('output-editor'))).toContain('"name": "Engine Hall"');
  await page.locator('#json-query-jq').fill('.galleries | map(.floor) | add');
  await expect.poll(() => editorText(page.getByTestId('output-editor'))).toBe('1');
  expect(problems).toEqual([]);
});

test('every tool is listed on the home page and none is missing a check', async ({ page }) => {
  const problems = watch(page);
  await page.goto('./');
  for (const entry of TOOLS) {
    await expect(page.locator(`a[href="#/tool/${entry.id}"]`).first()).toBeAttached();
    if (entry.kind === 'custom') expect(CUSTOM_CHECKS[entry.id], `custom check for ${entry.id}`).toBeDefined();
  }
  expect(problems).toEqual([]);
});

test('the command palette finds and opens tools', async ({ page }) => {
  const problems = watch(page);
  await page.goto('./');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await page.keyboard.type('json form');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/tool\/json-formatter$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('JSON Formatter');
  expect(problems).toEqual([]);
});

test('settings change the theme and show the licences of bundled software', async ({ page }) => {
  const problems = watch(page);
  await page.goto('./#/settings');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByText('Open-source licences of the bundled libraries and fonts').click();
  await expect(page.locator('details.licenses pre')).toContainText('Licence: MIT', { timeout: 15_000 });
  expect(problems).toEqual([]);
});

test('the shipped page carries a content security policy that forbids network access', async ({ page }) => {
  await page.goto('./');
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("connect-src 'self' ipc: http://ipc.localhost data: blob:");
  // A request to the internet is refused by the browser itself.
  const outcome = await page.evaluate(async () => {
    try {
      await fetch('https://example.org/');
      return 'loaded';
    } catch {
      return 'blocked';
    }
  });
  expect(outcome).toBe('blocked');
});

test.describe('exported images match what the CSS preview shows', () => {
  async function pixels(page: Page, png: Buffer, width: number, height: number): Promise<number[]> {
    return page.evaluate(
      async ({ b64, width, height }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${b64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(0, 0, width, height).data.filter((_, index) => index % 4 !== 3));
      },
      { b64: png.toString('base64'), width, height },
    );
  }

  for (const [id, presets] of [
    ['gradient', ['Sunset', 'Lagoon', 'Colour wheel']],
    ['mesh-gradient', ['Aurora', 'Peach']],
  ] as const) {
    test(`${id} PNG export`, async ({ page }) => {
      const problems = watch(page);
      await openTool(page, id);
      for (const [key, value] of [
        ['width', 400],
        ['height', 240],
      ] as const) {
        const input = page.locator(`[data-option="${key}"] input[type=number]`).first();
        await input.fill(String(value));
        await input.press('Tab');
      }
      for (const preset of presets) {
        await page.getByRole('button', { name: preset, exact: true }).click();
        const background = await page.locator('.pv-fill').evaluate((element) => {
          const style = getComputedStyle(element);
          return style.backgroundImage === 'none' ? style.backgroundColor : `${style.backgroundImage}, ${style.backgroundColor}`;
        });
        const exported = await download(page, () => page.getByTestId('code-output').getByRole('button', { name: /^PNG/ }).click());
        // Draw the same CSS at the same size and compare pixel by pixel.
        await page.evaluate((css) => {
          const probe = document.createElement('div');
          probe.id = 'reference';
          probe.style.cssText = `position: fixed; left: 0; top: 0; width: 400px; height: 240px; z-index: 99999; background: ${css}`;
          document.body.append(probe);
        }, background);
        const reference = await page.locator('#reference').screenshot();
        await page.evaluate(() => document.getElementById('reference')?.remove());
        const [a, b] = [await pixels(page, exported, 400, 240), await pixels(page, reference, 400, 240)];
        let total = 0;
        for (let index = 0; index < a.length; index++) total += Math.abs((a[index] as number) - (b[index] as number));
        expect(total / a.length, `${id} "${preset}" mean channel difference`).toBeLessThan(1.5);
      }
      expect(problems).toEqual([]);
    });
  }
});
