/**
 * Opens every tool in the production build and checks that it works, that
 * nothing is logged as an error and that no request leaves the app.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import { CALC_CATEGORIES } from '../../src/calc/types';
import { TOOLS } from '../../src/tools/registry';

const SAMPLE_PNG = readFileSync(new URL('./fixtures/sample.png', import.meta.url));
/** A 64 x 48 JPEG with camera details, GPS coordinates, XMP and a comment (made with Pillow). */
const EXIF_JPEG = readFileSync(new URL('./fixtures/exif.jpg', import.meta.url));
/** A QR code holding "WIFI:S:Benchtop Lab;T:WPA;P:correct horse;;". */
const QR_PNG = readFileSync(new URL('./fixtures/qr.png', import.meta.url));
/** Black text on white: "Benchtop reads this text offline." */
const OCR_PNG = readFileSync(new URL('./fixtures/ocr.png', import.meta.url));
const OCR_HINDI_PNG = readFileSync(new URL('./fixtures/ocr-hindi.png', import.meta.url));
const SANS_TTF = readFileSync(new URL('../../public/fonts/BenchtopSans-Regular.ttf', import.meta.url));
/** Four rows of gallery figures written by hyparquet-writer. */
const GALLERIES_PARQUET = readFileSync(new URL('./fixtures/galleries.parquet', import.meta.url));
/** Three rows in the Arrow IPC file format, written by apache-arrow. */
const CITIES_ARROW = readFileSync(new URL('./fixtures/cities.arrow', import.meta.url));

/** A PDF whose pages say "Page N". */
async function samplePdf(pages: number, rotate = 0): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Page ${i}`, { x: 60, y: 760, size: 28, font });
    if (rotate) page.setRotation(degrees(rotate));
  }
  doc.setTitle('Sample');
  return Buffer.from(await doc.save());
}

async function chooseFiles(page: Page, trigger: Locator, files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await trigger.click();
  await (await chooser).setFiles(files);
}

const pdfFile = async (name: string, pages: number, rotate = 0) => ({ name, mimeType: 'application/pdf', buffer: await samplePdf(pages, rotate) });

/** Tools that run programs or AI models on the computer explain in a browser that they need the desktop app. */
async function desktopGate(page: Page): Promise<void> {
  await expect(page.getByTestId('tool')).toContainText('desktop app');
}

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
  'text-cipher': { field: 'passphrase', value: 'correct horse battery staple', run: false },
};

/** Online checks whose target is an option rather than the input pane: [option key, value]. */
const ONLINE_TARGETS: Record<string, readonly [string, string]> = {
  'dns-lookup': ['name', 'example.org'],
  'dns-propagation': ['name', 'example.org'],
  'ip-lookup': ['target', 'example.org'],
  'email-security': ['domain', 'example.org'],
  'port-checker': ['host', 'example.org'],
  'link-checker': ['url', 'https://example.org/'],
  'http-client': ['url', 'https://example.org/'],
};

const CUSTOM_CHECKS: Record<string, (page: Page, tool: Locator) => Promise<void>> = {
  'file-pipeline': async (page) => {
    await page.locator('#fp-preset').selectOption('Format JSON files');
    await chooseFiles(page, page.getByTestId('fp-drop'), [
      { name: 'galleries.json', mimeType: 'application/json', buffer: Buffer.from('{"b":1,"a":[2]}') },
      { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{oops') },
    ]);
    await page.getByTestId('fp-run').click();
    const results = page.getByTestId('fp-results');
    await expect(results).toContainText('galleries.json');
    await expect(results.locator('td.tone-bad')).toContainText('Step 1 (JSON Formatter)');
    await expect.poll(() => editorText(page.getByTestId('fp-preview'))).toContain('"b": 1');
    // One good result is saved as itself rather than in a ZIP.
    const saved = await download(page, () => page.getByTestId('fp-save').click());
    expect(JSON.parse(saved.toString())).toEqual({ b: 1, a: [2] });
  },
  plugins: async (page) => {
    // The first visit opens the code view with the example plugin.
    await expect(page.getByTestId('plugin-code')).toBeVisible();
    await page.getByTestId('plugin-add').click();
    await expect(page.getByTestId('plugin-run')).toBeEnabled();
    await page.getByTestId('plugin-run').click();
    await expect.poll(() => editorText(page.getByTestId('plugin-output'))).toContain('VITM/2023/0007');
    await expect(page.getByTestId('plugin-info')).toHaveText('3 numbers');
  },
  keycode: async (page, tool) => {
    await page.keyboard.press('q');
    await expect(tool).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('keycode-stage')).toContainText('q');
    await expect(tool.locator('dd', { hasText: 'KeyQ' })).toHaveCount(1);
  },
  stopwatch: async (page) => {
    const time = page.getByTestId('stopwatch-time');
    const before = await time.textContent();
    await page.getByTestId('stopwatch-start').click();
    await expect.poll(() => time.textContent(), { timeout: 5_000 }).not.toBe(before);
  },
  'emoji-picker': async (page) => {
    await page.getByTestId('emoji-search').fill('rocket');
    await expect(page.getByTestId('emoji-grid').getByRole('button', { name: 'rocket', exact: true })).toBeVisible();
  },
  wysiwyg: async (page) => {
    await page.getByTestId('wysiwyg-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Gallery notes');
    await expect.poll(() => editorText(page.getByTestId('code-output'))).toContain('Gallery notes');
  },
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
  'background-remover': desktopGate,
  'clipboard-history': desktopGate,
  'image-upscaler': desktopGate,
  'face-blur': desktopGate,
  'object-eraser': desktopGate,
  transcribe: desktopGate,
  'ai-models': desktopGate,
  'text-to-speech': desktopGate,
  'video-dubbing': desktopGate,
  'file-converter': desktopGate,
  'video-tools': desktopGate,
  'audio-tools': desktopGate,
  'pdf-security': desktopGate,
  ocr: async (page) => {
    await chooseFiles(page, page.getByRole('button', { name: 'Add pictures or PDFs' }), [{ name: 'note.png', mimeType: 'image/png', buffer: OCR_PNG }]);
    await page.getByTestId('ocr-run').click();
    await expect.poll(() => editorText(page.getByTestId('ocr-output')), { timeout: 90_000 }).toContain('offline');
    // Hindi: the bundled tessdata_fast model reads Devanagari.
    await page.getByRole('button', { name: /Remove note\.png/ }).click();
    await page.getByRole('radio', { name: /Hindi/ }).click();
    await chooseFiles(page, page.getByRole('button', { name: 'Add pictures or PDFs' }), [{ name: 'hindi.png', mimeType: 'image/png', buffer: OCR_HINDI_PNG }]);
    await page.getByTestId('ocr-run').click();
    await expect.poll(() => editorText(page.getByTestId('ocr-output')), { timeout: 90_000 }).toContain('नमस्ते');
  },
  recipe: async (page) => {
    const search = page.getByTestId('recipe-search');
    await search.fill('From Base64');
    await page.locator('[data-op="from-base64"]').click();
    await search.fill('gunzip');
    await page.locator('[data-op="gunzip"]').click();
    await page.getByTestId('recipe-input').locator('.cm-content').click();
    await page.keyboard.insertText('H4sIAAAAAAAAA/NIzcnJVyjPL8pJAQBSntaLCwAAAA==');
    await expect.poll(() => editorText(page.getByTestId('recipe-output')), { timeout: 30_000 }).toBe('Hello world');
  },
  'pdf-organise': async (page) => {
    await chooseFiles(page, page.getByTestId('pdf-drop'), [await pdfFile('a.pdf', 3), await pdfFile('b.pdf', 2, 90)]);
    await expect(page.locator('.pdf-page')).toHaveCount(5);
    await page.getByLabel('Rotate page 1 right').click();
    await page.getByLabel('Delete page 5').click();
    const saved = await PDFDocument.load(await download(page, () => page.getByTestId('pdf-save').click()));
    expect(saved.getPageCount()).toBe(4);
    expect(saved.getPage(0).getRotation().angle).toBe(90);
    expect(saved.getPage(3).getRotation().angle).toBe(90);
  },
  'pdf-split': async (page) => {
    await chooseFiles(page, page.getByTestId('pdf-drop'), [await pdfFile('report.pdf', 6)]);
    await page.getByTestId('split-ranges').fill('1-2, 5-');
    await expect(page.getByTestId('split-plan').locator('li')).toHaveCount(2);
    const zip = unzipSync(new Uint8Array(await download(page, () => page.getByTestId('split-run').click())));
    expect(Object.keys(zip)).toEqual(['report part 1 (pages 1-2).pdf', 'report part 2 (pages 5-6).pdf']);
  },
  'pdf-stamp': async (page) => {
    await chooseFiles(page, page.getByTestId('pdf-drop'), [await pdfFile('turned.pdf', 2, 90)]);
    await expect(page.getByTestId('stamp-preview')).toBeVisible({ timeout: 30_000 });
    const saved = await PDFDocument.load(await download(page, () => page.getByTestId('stamp-run').click()));
    expect(saved.getPageCount()).toBe(2);
    // Text outside Latin-1 (rupee sign, Devanagari) is drawn with the bundled Unicode font.
    await page.getByTestId('stamp-watermark').fill('मूल्य ₹100');
    await expect(page.getByTestId('stamp-preview')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.recipe-error')).toHaveCount(0);
    const unicode = await PDFDocument.load(await download(page, () => page.getByTestId('stamp-run').click()));
    expect(unicode.getPageCount()).toBe(2);
  },
  'image-annotate': async (page) => {
    await chooseFiles(page, page.getByTestId('annotate-open'), [{ name: 'shot.png', mimeType: 'image/png', buffer: SAMPLE_PNG }]);
    const canvas = page.getByTestId('annotate-canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press('n');
    await canvas.click({ position: { x: 30, y: 30 } });
    await expect(page.getByTestId('tool')).toContainText('2 marks');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('tool')).toContainText('1 mark');
    const saved = await download(page, () => page.getByTestId('annotate-save').click());
    expect(saved.subarray(1, 4).toString()).toBe('PNG');
  },
  'mermaid-editor': async (page) => {
    await expect(page.getByTestId('diagram-preview').locator('svg')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('diagram-preview')).toContainText('Planetarium show');
  },
  'graphviz-viewer': async (page) => {
    await expect(page.getByTestId('diagram-preview').locator('svg')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('diagram-preview')).toContainText('package');
  },
  'sql-er-diagram': async (page) => {
    await expect(page.getByTestId('diagram-preview').locator('svg')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('diagram-preview')).toContainText('bookings');
  },
  'openapi-viewer': async (page) => {
    await expect(page.getByTestId('openapi-view')).toContainText('Book seats');
    await expect(page.getByTestId('openapi-view')).toContainText('OpenAPI 3.0.3');
  },
  'har-viewer': async (page) => {
    const har = {
      log: {
        creator: { name: 'test', version: '1' },
        entries: [0, 1].map((i) => ({
          startedDateTime: `2026-01-01T00:00:0${i}.000Z`,
          time: 50,
          request: { method: 'GET', url: `https://example.org/${i}`, headers: [] },
          response: { status: 200, statusText: 'OK', headers: [{ name: 'server', value: 'demo' }], content: { mimeType: 'text/html', size: 10, text: 'hello' } },
        })),
      },
    };
    await chooseFiles(page, page.getByTestId('har-open'), [{ name: 'site.har', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(har)) }]);
    await expect(page.getByTestId('har-table').locator('tbody tr')).toHaveCount(2);
    await page.getByTestId('har-table').locator('tbody tr').first().click();
    await expect(page.getByTestId('har-detail')).toContainText('server');
  },
  'hex-viewer': async (page) => {
    await chooseFiles(page, page.getByTestId('hex-open'), [{ name: 'sample.png', mimeType: 'image/png', buffer: SAMPLE_PNG }]);
    await expect(page.getByTestId('hex-rows')).toContainText('89 50 4e 47'.split(' ')[0] as string);
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('IHDR');
    await page.getByTestId('hex-search').click();
    await expect(page.getByTestId('tool')).toContainText('1 found');
    await expect(page.getByTestId('hex-inspector')).toContainText('Offset 12');
  },
  'sqlite-browser': async (page) => {
    await chooseFiles(page, page.getByTestId('sqlite-csv'), [{ name: 'visits.csv', mimeType: 'text/csv', buffer: Buffer.from('city,count\nBengaluru,120\nMysuru,45\n') }]);
    await expect(page.getByTestId('sqlite-tables')).toContainText('visits');
    await page.getByTestId('sqlite-run').click();
    await expect(page.getByTestId('sqlite-results')).toContainText('Mysuru');
  },
  'model-viewer': async (page) => {
    const stl = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';
    await chooseFiles(page, page.getByTestId('model-open'), [{ name: 'part.stl', mimeType: 'model/stl', buffer: Buffer.from(stl) }]);
    await expect(page.getByTestId('model-info')).toContainText('1 triangles', { timeout: 30_000 });
  },
  'code-screenshot': async (page) => {
    const png = await download(page, () => page.getByTestId('shot-save').click());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  },
  'component-codes': async (page) => {
    await expect(page.getByTestId('band-result')).toHaveText('4.7 kΩ ±5%');
    await page.getByRole('radio', { name: 'SMD resistors' }).click();
    await page.getByTestId('smd-input').fill('4R7');
    await expect(page.getByTestId('smd-result')).toContainText('4.7 Ω');
    await page.getByRole('radio', { name: 'Capacitors' }).click();
    await page.getByTestId('cap-input').fill('2A104J');
    await expect(page.getByTestId('cap-result')).toHaveText('100 nF, ±5%, 100 V');
  },
  'serial-monitor': async (page) => {
    await expect(page.getByTestId('tool')).toContainText(/Connect|desktop app/);
  },
  'serial-plotter': async (page) => {
    const tool = page.getByTestId('tool');
    await expect(tool).toContainText(/Connect|desktop app/);
    if ((await page.getByTestId('serial-plot').count()) === 0) return;
    await expect(tool).toContainText('Serial.println(value);');
    await page.getByTestId('plot-demo').click();
    await expect(page.getByTestId('plot-legend')).toContainText('sine');
    await expect(page.getByTestId('plot-legend')).toContainText('cosine');
    await page.getByTestId('plot-pause').click();
    await expect(page.getByTestId('plot-pause')).toHaveText('Resume');
  },
  'wireguard-config': async (page) => {
    await expect(page.getByTestId('wg-config')).toHaveCount(4);
    await expect(page.getByTestId('wg-config').first()).toContainText('ListenPort = 51820');
    await expect(page.getByTestId('wg-config').nth(1)).toContainText('Endpoint = vpn.example.org:51820');
  },
  'certificate-maker': async (page) => {
    await page.getByTestId('cert-make').click();
    await expect(page.getByTestId('cert-output')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByTestId('cert-output').first()).toContainText('BEGIN CERTIFICATE');
  },
  'unit-converter': async (page) => {
    const ask = page.getByTestId('uc-ask');
    await ask.fill('5 bigha (UP) in acres');
    await expect(page.getByTestId('uc-ask-answer')).toContainText('= 3.0991736 acre');
    await ask.press('Enter');
    await expect(page.getByTestId('uc-to-unit')).toHaveValue('acre');
    await expect(page.getByTestId('uc-result')).toHaveText('5 bigha (UP) = 3.0991736 acre');
    await expect(page.getByTestId('uc-table')).toContainText('guntha');
    // Typing on the right converts backwards.
    await page.getByTestId('uc-to-value').fill('1');
    await expect(page.getByTestId('uc-from-value')).toHaveValue('1.6133333');
    // Indian digit grouping in the table: 100 bigha (UP) is 27 lakh square feet.
    await page.getByTestId('uc-from-value').fill('100');
    await page.getByRole('radio', { name: '12,34,567' }).click();
    await expect(page.getByTestId('uc-table').locator('tr', { hasText: 'square foot' })).toContainText('27,00,000');
    // Counting words, temperatures and search.
    await ask.fill('2 lakh sq ft to acres');
    await expect(page.getByTestId('uc-ask-answer')).toContainText('4.5913682 acre');
    await ask.fill('-40 C in F');
    await expect(page.getByTestId('uc-ask-answer')).toContainText('= -40 °F');
    await page.getByTestId('uc-search').fill('tola');
    await page.getByTestId('uc-list').getByRole('button').first().click();
    await expect(page.locator('#uc-title')).toHaveText('Mass and weight');
    await expect(page.getByTestId('uc-from-unit')).toHaveValue('tola');
  },
  'steam-tables': async (page) => {
    // 10 bar and 250 °C: superheated, h = 2943.22 kJ/kg (IAPWS-IF97).
    await expect(page.getByTestId('st-summary')).toHaveText('Superheated steam');
    await expect(page.getByTestId('st-table').locator('tr', { hasText: 'Specific enthalpy' })).toContainText('2943.22');
    // Saturation at 10 bar gauge: 184.12 °C.
    await page.getByTestId('st-known').selectOption('satP');
    await page.getByTestId('st-p-unit').selectOption('barg');
    await expect(page.getByTestId('st-table').locator('tr', { hasText: 'Temperature' })).toContainText('184.123');
    await expect(page.getByTestId('st-table').locator('tr', { hasText: 'Specific enthalpy' })).toContainText('2780.71');
    await page.getByTestId('st-p').fill('900');
    await expect(page.getByTestId('st-error')).toContainText('22.064 MPa');
    await page.getByRole('radio', { name: 'Saturation table' }).click();
    await expect(page.getByTestId('st-grid').locator('tbody tr')).toHaveCount(38);
    await page.getByRole('radio', { name: 'Table at one pressure' }).click();
    await expect(page.getByTestId('st-grid').locator('tbody tr')).toHaveCount(19);
    await expect(page.getByTestId('st-grid')).toContainText('Compressed (subcooled) liquid');
    await expect(page.getByTestId('st-grid')).toContainText('Superheated steam');
  },
  'beam-calculator': async (page) => {
    // 6 m simply supported, 10 kN/m everywhere and 20 kN at 2 m: reactions 43.33 and 36.67 kN.
    const results = page.getByTestId('bm-results');
    await expect(results.locator('tr').first()).toContainText('43.33 kN up');
    await expect(results.locator('tr').nth(1)).toContainText('36.67 kN up');
    await expect(page.getByTestId('bm-diagrams').locator('svg')).toHaveCount(4);
    // A cantilever with a 20 kN end load: PL³/3EI with I typed in.
    await page.getByTestId('bm-preset').selectOption('cantilever');
    await page.getByTestId('bm-section').selectOption('manual');
    await page.getByTestId('bm-I').fill('5000');
    await page.getByRole('button', { name: 'Remove load 1' }).click();
    await page.getByLabel('Load 1 position').fill('6');
    // δ = 20e3·6³/(3·200e9·5000e-8) = 0.144 m.
    await expect(results).toContainText('144 mm down at 6 m');
    await expect(results).toContainText('120 kN·m anticlockwise');
    await page.getByTestId('bm-length').fill('0');
    await expect(page.getByTestId('bm-error')).toBeVisible();
  },
  'section-properties': async (page) => {
    const table = page.getByTestId('sp-table');
    await expect(table.locator('tr', { hasText: 'Second moment about x' })).toContainText('5,065.8');
    await expect(table.locator('tr', { hasText: 'Mass per metre' })).toContainText('36.718');
    await page.getByTestId('sp-shape').selectOption('angle');
    await expect(table.locator('tr', { hasText: 'Major axis from x' })).toContainText('45');
    await page.getByTestId('sp-t').fill('80');
    await expect(page.getByTestId('sp-error')).toBeVisible();
  },
  'wire-gauge': async (page) => {
    // AWG 12 copper: 2.053 mm, 3.309 mm², 5.211 Ω/km at 20 °C; closest metric size 4 mm².
    const found = page.getByTestId('wg-found');
    await expect(found).toContainText('5.211 Ω/km');
    await expect(found).toContainText('4 mm²');
    await expect(page.getByTestId('wg-chart').locator('tr.is-to')).toContainText('12');
    await page.getByTestId('wg-known').selectOption('metric');
    await page.getByTestId('wg-value').fill('2.5');
    await expect(found).toContainText('AWG 13');
    await page.getByTestId('wg-value').fill('3');
    await expect(page.getByTestId('wg-error')).toBeVisible();
  },
  'time-zones': async (page) => {
    await expect(page.getByTestId('tz-table')).toContainText('Asia/Kolkata');
    await expect(page.getByTestId('tz-table').locator('tr')).toHaveCount(4);
  },
  'pdf-forms': async (page) => {
    await chooseFiles(page, page.getByTestId('form-open'), [await pdfFile('application.pdf', 1)]);
    const sheet = page.getByTestId('pdf-page-view').locator('svg');
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('Text for the next click').fill('नाम: आशा ₹500');
    await sheet.click({ position: { x: 120, y: 200 } });
    await expect(page.getByTestId('placed-list').locator('li')).toHaveCount(1);
    const saved = await download(page, () => page.getByTestId('form-save').click());
    const doc = await PDFDocument.load(saved);
    expect(doc.getPageCount()).toBe(1);
    // The Hindi text brings in Benchtop Sans (about 330 kB), so the file grows.
    expect(saved.length).toBeGreaterThan(200_000);
  },
  'pdf-sign': async (page) => {
    await chooseFiles(page, page.getByTestId('sign-open'), [await pdfFile('contract.pdf', 2)]);
    await expect(page.getByTestId('pdf-page-view')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('radio', { name: 'Type' }).click();
    await page.getByLabel('Your name').fill('Asha Rao');
    await page.getByText('Also sign digitally with a certificate').click();
    await page.getByRole('button', { name: 'Make a certificate' }).click();
    await page.getByLabel('Name to show as the signer').fill('Asha Rao');
    await page.getByLabel('Password for the file').fill('secret');
    const p12 = await download(page, () => page.getByTestId('cert-create').click());
    expect(p12.length).toBeGreaterThan(1000);
    await expect(page.getByTestId('cert-summary')).toContainText('Asha Rao');
    const signed = Buffer.from(await download(page, () => page.getByTestId('sign-save').click())).toString('latin1');
    expect(signed).toContain('/adbe.pkcs7.detached');
    expect(signed).toMatch(/\/ByteRange \[ 0 \d+ \d+ \d+ +\]/);
  },
  'pdf-properties': async (page) => {
    await chooseFiles(page, page.getByTestId('pdf-drop'), [await pdfFile('slides.pdf', 2)]);
    await expect(page.getByTestId('pdf-facts')).toContainText('A4');
    await page.getByTestId('pdf-title').fill('Quarterly slides');
    const saved = await PDFDocument.load(await download(page, () => page.getByTestId('pdf-write').click()));
    expect(saved.getTitle()).toBe('Quarterly slides');
  },
  'pdf-pictures': async (page) => {
    await chooseFiles(page, page.getByTestId('pictures-drop'), [{ name: 'sample.png', mimeType: 'image/png', buffer: SAMPLE_PNG }]);
    const saved = await PDFDocument.load(await download(page, () => page.getByTestId('pictures-run').click()));
    expect(saved.getPageCount()).toBe(1);
  },
  'image-vectorise': async (page) => {
    await chooseImage(page, page.getByTestId('dropzone'));
    await expect(page.getByTestId('vec-result')).toBeVisible({ timeout: 30_000 });
    const svg = (await download(page, () => page.getByTestId('vec-save').click())).toString('utf8');
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 640 400"/);
  },
  'gif-maker': async (page) => {
    await chooseFiles(page, page.getByTestId('gif-drop'), [
      { name: 'one.png', mimeType: 'image/png', buffer: SAMPLE_PNG },
      { name: 'two.png', mimeType: 'image/png', buffer: QR_PNG },
    ]);
    await page.getByTestId('gif-build').click();
    await expect(page.getByTestId('gif-result')).toBeVisible({ timeout: 30_000 });
    const gif = await download(page, () => page.getByRole('button', { name: 'Save GIF' }).click());
    expect(gif.subarray(0, 6).toString('latin1')).toBe('GIF89a');
  },
  'duplicate-images': async (page) => {
    await chooseFiles(page, page.getByTestId('dup-drop'), [
      { name: 'a.png', mimeType: 'image/png', buffer: SAMPLE_PNG },
      { name: 'copy of a.png', mimeType: 'image/png', buffer: SAMPLE_PNG },
      { name: 'qr.png', mimeType: 'image/png', buffer: QR_PNG },
    ]);
    await expect(page.getByTestId('dup-group')).toHaveCount(1);
    await expect(page.getByTestId('dup-group')).toContainText('Identical files');
  },
  'archive-tool': async (page) => {
    await page.getByRole('radio', { name: 'Make a ZIP' }).click();
    await chooseFiles(page, page.getByTestId('zip-add'), [
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Gallery notes\n') },
      { name: 'sample.png', mimeType: 'image/png', buffer: SAMPLE_PNG },
    ]);
    const zip = await download(page, () => page.getByTestId('zip-make').click());
    expect(Object.keys(unzipSync(new Uint8Array(zip)))).toEqual(['notes.txt', 'sample.png']);
    await page.getByRole('radio', { name: 'Open an archive' }).click();
    await chooseFiles(page, page.getByTestId('zip-drop'), [{ name: 'archive.zip', mimeType: 'application/zip', buffer: zip }]);
    await expect(page.getByTestId('zip-list').locator('li')).toHaveCount(2);
    await page.getByRole('button', { name: 'notes.txt' }).click();
    await expect(page.locator('.zip-preview-text')).toContainText('Gallery notes');
  },
  'csv-tools': async (page) => {
    await chooseFiles(page, page.getByTestId('csv-drop'), [
      { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('id,name\n1,Asha\n') },
      { name: 'b.csv', mimeType: 'text/csv', buffer: Buffer.from('name,id,city\nRavi,2,Mysuru\n') },
    ]);
    const csv = (await download(page, () => page.getByTestId('csv-save').click())).toString('utf8');
    expect(csv).toBe('id,name,city\r\n1,Asha,\r\n2,Ravi,Mysuru\r\n');
  },
  'app-icons': async (page, tool) => {
    await expect(tool).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('icon-previews').locator('canvas')).toHaveCount(13);
    await page.getByTestId('icon-text').fill('Ga');
    const zip = unzipSync(new Uint8Array(await download(page, () => page.getByTestId('icon-save').click())));
    const width = (name: string) => {
      const file = zip[name];
      expect(file, name).toBeDefined();
      expect([...(file as Uint8Array).subarray(0, 4)]).toEqual(PNG);
      return Buffer.from(file as Uint8Array).readUInt32BE(16);
    };
    expect(width('android/res/mipmap-xxxhdpi/ic_launcher.png')).toBe(192);
    expect(width('android/res/mipmap-xxxhdpi/ic_launcher_foreground.png')).toBe(432);
    expect(width('android/res/mipmap-mdpi/ic_launcher_monochrome.png')).toBe(108);
    expect(width('ios/AppIcon.appiconset/AppIcon-1024.png')).toBe(1024);
    expect(width('kaios/icons/icon-56.png')).toBe(56);
    expect(width('kaios/icons/icon-112.png')).toBe(112);
    expect(width('web/icon-maskable-512.png')).toBe(512);
    const xml = Buffer.from(zip['android/res/mipmap-anydpi-v26/ic_launcher.xml'] as Uint8Array).toString('utf8');
    expect(xml).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"');
    const contents = JSON.parse(Buffer.from(zip['ios/AppIcon.appiconset/Contents.json'] as Uint8Array).toString('utf8'));
    expect(contents.images).toHaveLength(3);
  },
  'store-graphics': async (page) => {
    await chooseFiles(page, page.getByTestId('sg-drop'), [{ name: 'screen.png', mimeType: 'image/png', buffer: SAMPLE_PNG }]);
    await page.getByTestId('sg-caption').fill('Plan your museum visit');
    await expect(page.getByTestId('sg-results').locator('canvas')).toHaveCount(1);
    const png = await download(page, () => page.getByTestId('sg-save').click());
    expect([...png.subarray(0, 4)]).toEqual(PNG);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1320, 2868]);
    await page.getByTestId('sg-target').selectOption('kai-banner');
    await page.getByTestId('sg-title').fill('Benchtop');
    const jpeg = await download(page, () => page.getByTestId('sg-save').click());
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(jpeg.length).toBeLessThan(100 * 1024);
  },
  'nine-patch': async (page, tool) => {
    await chooseImage(page, page.getByTestId('dropzone'));
    await expect(tool).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('np-samples').locator('canvas')).toHaveCount(3);
    await page.getByTestId('np-sx-from-0').fill('100');
    const png = await download(page, () => page.getByTestId('np-save').click());
    expect([...png.subarray(0, 4)]).toEqual(PNG);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([642, 402]);
    const zip = unzipSync(new Uint8Array(await download(page, () => page.getByTestId('np-save-all').click())));
    expect(Object.keys(zip).sort()).toEqual(['drawable-hdpi/sample.9.png', 'drawable-mdpi/sample.9.png', 'drawable-xhdpi/sample.9.png']);
    expect(Buffer.from(zip['drawable-mdpi/sample.9.png'] as Uint8Array).readUInt32BE(16)).toBe(322);
  },
  'pdf-impose': async (page) => {
    await chooseFiles(page, page.getByTestId('pdf-drop'), [await pdfFile('guide.pdf', 6)]);
    await expect(page.getByTestId('impose-summary')).toContainText('6 pages on 2 sheets, 4 sides to print; 2 blanks added');
    const booklet = await PDFDocument.load(await download(page, () => page.getByTestId('impose-save').click()));
    expect(booklet.getPageCount()).toBe(4);
    const [w, h] = [booklet.getPage(0).getWidth(), booklet.getPage(0).getHeight()];
    expect(Math.round(w)).toBe(Math.round(595.28 * 2));
    expect(Math.round(h)).toBe(842);
    await page.getByRole('radio', { name: 'Mini zine' }).click();
    await expect(page.getByTestId('impose-summary')).toContainText('6 pages on 1 sheet');
    await page.getByRole('radio', { name: 'Pages per sheet' }).click();
    await page.getByTestId('impose-cols').fill('2');
    await expect(page.getByTestId('impose-summary')).toContainText('6 pages on 2 sheets');
  },
  'pdf-preflight': async (page, tool) => {
    await chooseFiles(page, page.getByTestId('pdf-drop'), [await pdfFile('poster.pdf', 2)]);
    await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    const checks = page.getByTestId('pf-checks');
    await expect(checks).toContainText('Every page is 210 × 297 mm (A4)');
    await expect(checks).toContainText('not embedded: Helvetica');
    await expect(checks).toContainText('No trim box');
    await expect(checks).toContainText('No pictures are placed');
  },
  'pdf-crop': async (page) => {
    await chooseFiles(page, page.getByTestId('pdf-drop'), [await pdfFile('scan.pdf', 2)]);
    await expect(page.getByTestId('crop-box')).toBeVisible({ timeout: 30_000 });
    for (const side of ['top', 'right', 'bottom', 'left']) await page.getByTestId(`crop-${side}`).fill('10');
    const cropped = await PDFDocument.load(await download(page, () => page.getByTestId('crop-save').click()));
    const box = cropped.getPage(0).getCropBox();
    expect(Math.round(box.width)).toBe(Math.round(595.28 - (20 * 72) / 25.4));
    expect(Math.round(box.x)).toBe(Math.round((10 * 72) / 25.4));
  },
  'font-explorer': async (page, tool) => {
    await chooseFiles(page, page.getByTestId('font-drop'), [{ name: 'BenchtopSans-Regular.ttf', mimeType: 'font/ttf', buffer: SANS_TTF }]);
    await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    await expect(page.getByTestId('font-info')).toContainText('PostScript name');
    await expect(page.getByTestId('font-glyphs').locator('button').first()).toBeVisible();
    await page.getByTestId('font-sample').fill('नमस्ते');
    await expect(page.getByTestId('font-preview')).toHaveText('नमस्ते');
  },
  'glyph-browser': async (page) => {
    await page.getByTestId('glyph-find').fill('U+0905');
    await page.getByTestId('glyph-find').press('Enter');
    await expect(page.getByTestId('glyph-block')).toHaveValue('Devanagari');
    await expect(page.getByTestId('glyph-detail')).toContainText('&#x905;');
    await expect(page.getByTestId('glyph-detail')).toContainText('E0 A4 85');
  },
  'large-type': async (page) => {
    await page.getByTestId('lt-input').fill('Gate 3');
    await expect(page.getByTestId('lt-stage')).toContainText('Gate 3');
    await expect.poll(async () => Number(await page.locator('.lt-text-out').getAttribute('data-size'))).toBeGreaterThan(60);
  },
  'image-stitch': async (page) => {
    await chooseFiles(page, page.getByTestId('stitch-drop'), [
      { name: 'one.png', mimeType: 'image/png', buffer: SAMPLE_PNG },
      { name: 'two.png', mimeType: 'image/png', buffer: QR_PNG },
    ]);
    await expect(page.getByTestId('stitch-result').locator('canvas')).toBeVisible();
    await expect(page.getByTestId('export-size')).toContainText(/\d/, { timeout: 30_000 });
    const png = await download(page, () => page.getByTestId('export-save').click());
    expect([...png.subarray(0, 4)]).toEqual(PNG);
    // Matched heights: the sample is 640 × 400, so the result is 400 high.
    expect(png.readUInt32BE(20)).toBe(400);
  },
  'perspective-fix': async (page) => {
    await chooseImage(page, page.getByTestId('dropzone'));
    await expect(page.getByTestId('px-result')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('px-corner-0').focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.getByTestId('export-size')).toContainText(/\d/, { timeout: 30_000 });
    const png = await download(page, () => page.getByTestId('export-save').click());
    expect([...png.subarray(0, 4)]).toEqual(PNG);
  },
  'paste-image': async (page) => {
    await chooseImage(page, page.getByTestId('dropzone'));
    await expect(page.getByTestId('paste-facts')).toContainText('640 × 400 px');
    await expect(page.getByTestId('paste-preview')).toBeVisible();
  },
  'media-info': desktopGate,
  'screen-recorder': async (page) => {
    await expect(page.getByTestId('rec-start')).toBeVisible();
    await expect(page.getByTestId('rec-support')).not.toBeEmpty();
  },
  'data-playground': async (page, tool) => {
    await page.getByTestId('dp-sample').click();
    await expect(page.getByTestId('dp-results')).toContainText('Space Gallery', { timeout: 60_000 });
    await expect(page.getByTestId('dp-results')).toContainText('1716');
    await chooseFiles(page, page.getByTestId('dp-open'), [{ name: 'galleries-2.parquet', mimeType: 'application/octet-stream', buffer: GALLERIES_PARQUET }]);
    await expect(page.getByTestId('dp-tables')).toContainText('galleries_2');
    await expect(page.getByTestId('dp-results')).toContainText('Kids Science', { timeout: 30_000 });
    await chooseFiles(page, page.getByTestId('dp-open'), [{ name: 'cities.arrow', mimeType: 'application/octet-stream', buffer: CITIES_ARROW }]);
    await expect(page.getByTestId('dp-results')).toContainText('Hubballi', { timeout: 30_000 });
    const parquet = await download(page, () => page.getByTestId('dp-parquet').click());
    expect(parquet.subarray(0, 4).toString()).toBe('PAR1');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'markdown-editor': async (page, tool) => {
    await page.getByTestId('md-sample').click();
    const preview = page.getByTestId('md-preview');
    await expect(preview.locator('h1')).toHaveText('Engine Hall visitor guide');
    await expect(preview.locator('img.md-math').first()).toBeVisible({ timeout: 30_000 });
    await expect(preview.locator('table')).toContainText('Diesel');
    await expect(page.getByTestId('md-status')).toContainText('words');
    const html = await download(page, () => page.getByTestId('md-html').click());
    expect(html.toString()).toContain('<!DOCTYPE html>');
    expect(html.toString()).toContain('data:image/svg+xml;base64,');
    const docx = await download(page, () => page.getByTestId('md-docx').click());
    expect(docx.subarray(0, 2).toString()).toBe('PK');
    const epub = await download(page, () => page.getByTestId('md-epub').click());
    expect(epub.subarray(30, 58).toString()).toBe('mimetypeapplication/epub+zip');
    await page
      .getByTestId('md-picture')
      .setInputFiles([{ name: 'dot.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }]);
    await expect(page.getByTestId('md-editor').locator('.cm-data-chip')).toContainText('picture png');
    await expect(preview.locator('img[alt="dot"]')).toBeVisible();
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'equation-editor': async (page, tool) => {
    await expect(page.getByTestId('eq-preview').locator('img')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('eq-formulas').selectOption({ label: 'Photosynthesis' });
    await expect(page.getByTestId('eq-preview').locator('img')).toBeVisible();
    await page.getByRole('tab', { name: 'Greek' }).click();
    await page.getByRole('button', { name: 'λ, lambda', exact: true }).click();
    expect(await editorText(page.getByTestId('eq-tex'))).toContain('\\lambda');
    const svg = await download(page, () => page.getByTestId('eq-save-svg').click());
    expect(svg.toString()).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    await page.getByTestId('eq-tex').locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('\\frac{a}{');
    await expect(page.getByTestId('eq-error')).toContainText('Missing close brace');
    await expect(tool).toHaveAttribute('data-state', 'idle');
  },
  'mail-merge': async (page, tool) => {
    await expect(page.getByTestId('mm-preview').locator('img')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('mm-record')).toContainText('Row 1 of 5');
    await expect(page.getByTestId('mm-pages')).toContainText('5 cards on 5 pages');
    const pdf = await PDFDocument.load(await download(page, () => page.getByTestId('mm-save').click()));
    expect(pdf.getPageCount()).toBe(5);
    const zip = await download(page, () => page.getByTestId('mm-zip').click());
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    await page.getByTestId('mm-preset').selectOption('l7160');
    await expect(page.getByTestId('mm-pages')).toContainText('5 cards on 1 page');
    await page.getByRole('button', { name: /^Text: \{\{Name\}\}/ }).click();
    await expect(page.getByTestId('mm-props')).toBeVisible();
    await page.getByTestId('mm-text').fill('{{Name|upper}} {{Missing}}');
    await expect(page.getByTestId('mm-missing')).toContainText('Missing');
    await page
      .getByTestId('mm-paste-use')
      .waitFor({ state: 'detached' })
      .catch(() => {});
    await page.getByRole('button', { name: 'Paste rows' }).click();
    await page.getByTestId('mm-paste').fill('Name\tAddress\tCity\tPIN\nAsha\t1 Kasturba Road\tBengaluru\t560001');
    await page.getByTestId('mm-paste-use').click();
    await expect(page.getByTestId('mm-record')).toContainText('Row 1 of 1');
    const labels = await PDFDocument.load(await download(page, () => page.getByTestId('mm-save').click()));
    expect(Math.round(labels.getPage(0).getHeight())).toBe(842);
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'web-to-pdf': async (page) => {
    await page.getByTestId('wp-urls').fill('https://example.org/');
    await expect(page.getByTestId('wp-save')).toBeDisabled();
    await desktopGate(page);
  },
  notes: async (page, tool) => {
    await expect(page.getByTestId('nt-saved')).toHaveText('Saved', { timeout: 15_000 });
    await page.getByTestId('nt-title').fill('Engine Hall survey');
    await page.getByTestId('nt-text').first().click();
    await page.keyboard.type('Labels to replace in the steam gallery.');
    // Pasting a picture and a video straight from the clipboard keeps copies in the note.
    const paste = (name: string, type: string, b64: string) =>
      page.evaluate(
        ([n, t, data]) => {
          const bytes = Uint8Array.from(atob(data as string), (c) => c.charCodeAt(0));
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], n as string, { type: t as string }));
          document.querySelector('[data-testid="nt-text"]')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
        },
        [name, type, b64],
      );
    await paste('label.png', 'image/png', SAMPLE_PNG.toString('base64'));
    await expect(page.getByTestId('nt-file-image').locator('img')).toBeVisible({ timeout: 15_000 });
    await paste('walkthrough.mp4', 'video/mp4', Buffer.from('not really a video').toString('base64'));
    await expect(page.getByTestId('nt-file-video').locator('video')).toBeAttached();
    await page.getByTestId('nt-files').setInputFiles([await pdfFile('floor-plan.pdf', 2)]);
    await expect(page.getByTestId('nt-file-pdf').locator('img')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('nt-file-pdf')).toContainText('Page 1 of 2');
    await page.getByTestId('nt-add-checklist').click();
    await page.getByTestId('nt-check-text').first().fill('Order acrylic sheet');
    await expect(page.getByTestId('nt-saved')).toHaveText('Saved', { timeout: 15_000 });
    const bnote = await download(page, () => page.getByTestId('nt-export').selectOption('bnote'));
    const entries = unzipSync(new Uint8Array(bnote));
    const manifest = JSON.parse(strFromU8(entries['note.json'] as Uint8Array));
    expect(manifest.note.title).toBe('Engine Hall survey');
    expect(Object.keys(entries).filter((k) => k.startsWith('files/'))).toHaveLength(3);
    // Kept between sessions, files included.
    await page.reload();
    await expect(page.getByTestId('nt-title')).toHaveValue('Engine Hall survey', { timeout: 15_000 });
    await expect(page.getByTestId('nt-file-image').locator('img')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('nt-import').setInputFiles([{ name: 'survey.bnote', mimeType: 'application/vnd.benchtop.note+zip', buffer: bnote }]);
    await expect(page.getByTestId('nt-items').locator('li')).toHaveCount(2);
    await page.getByTestId('nt-search').fill('acrylic');
    await expect(page.getByTestId('nt-items').locator('li')).toHaveCount(2);
    await page.getByTestId('nt-search').fill('no such words');
    await expect(page.getByTestId('nt-items')).toContainText('No note contains');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'website-copier': async (page) => {
    await page.getByTestId('wc-url').fill('https://example.org/');
    await expect(page.getByTestId('wc-start')).toBeDisabled();
    await desktopGate(page);
  },
  'bulk-rename': async (page) => desktopGate(page),
  'duplicate-finder': async (page) => desktopGate(page),
  'disk-usage': async (page) => desktopGate(page),
  'folder-compare': async (page) => desktopGate(page),
  'log-viewer': async (page, tool) => {
    await page.getByTestId('lv-sample').click();
    await expect(page.getByTestId('lv-info')).toContainText('13 lines');
    await expect(page.getByTestId('lv-lines')).toContainText('Ticketing service starting');
    await page.getByTestId('lv-level-info').click();
    await page.getByTestId('lv-level-debug').click();
    await page.getByTestId('lv-level-other').click();
    await expect(page.getByTestId('lv-info')).toContainText('4 shown');
    await page.getByTestId('lv-filter').fill('kiosk');
    await expect(page.getByTestId('lv-info')).toContainText('1 shown');
    await page.getByTestId('lv-lines').getByText('Kiosk 3 lost connection').click();
    await expect(page.getByTestId('lv-detail')).toContainText('"kiosk": 3');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'patch-viewer': async (page) => {
    await expect(page.getByTestId('pv-stats')).toContainText('2 files');
    await expect(page.getByTestId('pv-files')).toContainText('kiosk/queue.py');
    await expect(page.getByTestId('pv-diff').getByTestId('diff')).toContainText('seats left');
    await page.getByTestId('pv-files').getByText('kiosk/README.md').click();
    await expect(page.getByTestId('pv-diff')).toContainText('every 30 seconds');
  },
  'mock-server': async (page) => {
    await expect(page.getByTestId('mock-routes')).toContainText('/api/shows/:id');
    await expect(page.getByTestId('mock-start')).toBeDisabled();
    await desktopGate(page);
  },
  'websocket-client': async (page) => {
    await expect(page.getByTestId('ws-connect')).toBeDisabled();
    await desktopGate(page);
  },
  'grpc-client': async (page) => {
    await expect(page.getByTestId('grpc-reflect')).toBeDisabled();
    await desktopGate(page);
  },
  'periodic-table': async (page) => {
    await expect(page.getByTestId('pt-detail')).toContainText('Carbon');
    await page.getByTestId('pt-find').fill('gold');
    await page.getByTestId('pt-find').press('Enter');
    await expect(page.getByTestId('pt-detail')).toContainText('[Xe]6s1 4f14 5d10');
    await expect(page.getByTestId('pt-detail')).toContainText('197Au');
    await page.getByTestId('pt-colour').selectOption('state');
    await page.getByTestId('pt-kelvin').fill('300');
    await expect(page.getByTestId('pt-grid').getByRole('button', { name: 'Hg', exact: false }).first()).toHaveClass(/pt-liquid/);
    await page.getByTestId('pt-colour').selectOption('electronegativity');
    await expect(page.getByTestId('pt-legend')).toContainText('Electronegativity');
  },
  'molar-mass': async (page) => {
    await expect(page.getByTestId('mmc-result')).toContainText('249.6');
    await page.getByTestId('mmc-formula').fill('C6H12O6');
    await expect(page.getByTestId('mmc-result')).toContainText('180.15');
    await expect(page.getByTestId('mmc-table')).toContainText('53.28 %');
  },
  'sun-moon': async (page) => {
    await page.getByTestId('sky-date').fill('2026-06-21');
    await expect(page.getByTestId('sky-sun')).toContainText('Sunrise');
    await expect(page.getByTestId('sky-sun')).toContainText(/05:5\d/);
    await expect(page.getByTestId('sky-twilight')).toContainText('Astronomical');
    await expect(page.getByTestId('sky-moon')).toContainText('% lit');
    await page.getByTestId('sky-place').selectOption('Tromsø');
    await page.getByTestId('sky-date').fill('2026-12-21');
    await expect(page.getByTestId('sky-sun')).toContainText('Sun down all day');
  },
  'star-chart': async (page) => {
    await expect(page.getByTestId('tool')).toHaveAttribute('data-state', 'done');
    await page.getByTestId('sky-when').fill('2026-11-23T21:00');
    await expect(page.getByTestId('sky-bodies')).toBeVisible();
    await expect(page.getByTestId('tool')).toContainText('stars to magnitude');
    const box = await page.getByTestId('sky-canvas').boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(300);
  },
  'molecule-viewer': async (page) => {
    await expect(page.getByTestId('mol-facts')).toContainText('C8H10N4O2', { timeout: 30_000 });
    await expect(page.getByTestId('mol-facts')).toContainText('194.19');
    await expect(page.getByTestId('mol-2d')).toBeVisible();
    await expect(page.getByTestId('mol-view').locator('canvas')).toHaveCount(1);
    await page.getByTestId('mol-smiles').fill('CCO');
    await page.getByTestId('mol-build').click();
    await expect(page.getByTestId('mol-facts')).toContainText('C2H6O');
    await chooseFiles(page, page.getByTestId('tool').getByRole('button', { name: 'Open a file' }), [
      { name: 'water.xyz', mimeType: 'text/plain', buffer: Buffer.from('3\nwater\nO 0 0 0\nH 0.757 0.586 0\nH -0.757 0.586 0\n') },
    ]);
    await expect(page.getByTestId('mol-facts')).toContainText('H2O');
    await expect(page.getByTestId('mol-facts')).toContainText('3, 2');
  },
  'map-viewer': async (page) => {
    await page.getByTestId('geo-sample').click();
    await expect(page.getByTestId('geo-facts')).toContainText('Points, lines, areas');
    await expect(page.getByTestId('geo-facts')).toContainText('3, 1, 1');
    await page.getByTestId('geo-list').getByRole('button', { name: 'Sample loop (made up)' }).click();
    await expect(page.getByTestId('geo-picked')).toContainText('Climb');
    await expect(page.getByTestId('geo-profile')).toBeVisible();
    const gpx = await download(page, () => page.getByTestId('geo-save-gpx').click());
    expect(gpx.toString()).toContain('<trkpt');
    const kmlText =
      '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Museum</name><Point><coordinates>77.5964,12.9752,0</coordinates></Point></Placemark></Document></kml>';
    await chooseFiles(page, page.getByTestId('geo-open'), [{ name: 'place.kml', mimeType: 'application/vnd.google-earth.kml+xml', buffer: Buffer.from(kmlText) }]);
    await expect(page.getByTestId('geo-list')).toContainText('Museum');
    await expect(page.getByTestId('geo-map').locator('circle')).toHaveCount(1);
  },
  'sheet-music': async (page) => {
    const score = page.getByTestId('sm-score');
    await expect(score.locator('svg').first()).toBeVisible();
    await expect(score).toContainText('Ode to Joy');
    await page.getByTestId('sm-template').selectOption('Blank page');
    await expect(score).toContainText('Untitled');
    // Quarter notes at L:1/8 are written with a 2.
    await page.getByTestId('sm-abc').locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.getByTestId('sm-keys').getByRole('button', { name: 'C4', exact: true }).click();
    await page.getByTestId('sm-keys').getByRole('button', { name: 'E4', exact: true }).click();
    await expect(page.getByTestId('sm-abc')).toContainText('C2 E2');
    await expect(score.locator('.abcjs-note')).toHaveCount(2);
    await page.getByTestId('sm-up').click();
    await expect(page.getByTestId('sm-abc')).toContainText('K:');
    const midi = await download(page, () => page.getByTestId('sm-save-midi').click());
    expect(midi.subarray(0, 4).toString('latin1')).toBe('MThd');
    const abc = await download(page, () => page.getByTestId('sm-save-abc').click());
    expect(abc.toString()).toContain('T:Untitled');
    const wav = await download(page, () => page.getByTestId('sm-save-wav').click());
    expect(wav.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(wav.length).toBeGreaterThan(44_100);
    await page.getByTestId('sm-play').click();
    await expect(page.getByTestId('sm-stop')).toBeVisible();
    await page.getByTestId('sm-stop').click();
  },
  'circuit-simulator': async (page) => {
    const canvas = page.getByTestId('cs-canvas');
    const status = page.getByTestId('cs-status');
    await expect(canvas.locator('[data-part=led]')).toHaveCount(1);
    await page.getByTestId('cs-run').click();
    await expect(status).toContainText('Running');
    await canvas.locator('[data-part=led]').click();
    await expect(page.getByTestId('cs-readings')).toContainText('mA');
    // An Arduino Uno sketch talks over the serial monitor.
    await page.getByTestId('cs-examples').selectOption('uno-serial');
    await page.getByTestId('cs-run').click();
    const log = page.getByTestId('cs-serial-log');
    await expect(log).toContainText('Type 1 or 0', { timeout: 15_000 });
    await page.getByTestId('cs-serial-input').fill('1');
    await page.getByTestId('cs-serial-input').press('Enter');
    await expect(log).toContainText('LED on', { timeout: 15_000 });
    await page.getByTestId('cs-reset').click();
    // Placing a part, and undo.
    const resistors = await canvas.locator('[data-part=resistor]').count();
    await page.getByTestId('cs-add-resistor').click();
    await canvas.click({ position: { x: 30, y: 30 } });
    await expect(canvas.locator('[data-part=resistor]')).toHaveCount(resistors + 1);
    await canvas.press('Control+z');
    await expect(canvas.locator('[data-part=resistor]')).toHaveCount(resistors);
    // The ESP32 runs in the desktop app's emulator.
    await page.getByTestId('cs-examples').selectOption('esp32-demo');
    await expect(status).toContainText('desktop app');
    await page.getByTestId('cs-examples').selectOption('led');
    await expect(status).toContainText('Editing');
  },
  'filter-designer': async (page) => {
    await expect(page.getByTestId('flt-title')).toHaveText('4th-order Butterworth low-pass, 1 kHz');
    await expect(page.getByTestId('flt-facts')).toContainText('−3 dB at');
    await expect(page.getByTestId('flt-facts')).toContainText('1 kHz');
    await expect(page.getByTestId('flt-stages')).toContainText('Stage 2: Sallen-Key');
    await expect(page.getByTestId('flt-plot').locator('polyline')).toHaveCount(1);
    await page.getByRole('radio', { name: 'Digital IIR' }).click();
    await expect(page.getByTestId('flt-coeffs')).toContainText('b0');
    await expect(page.getByTestId('tool').locator('.cm-content')).toContainText('filter_sample');
    await page.getByRole('radio', { name: 'Band-pass' }).click();
    await page.getByTestId('flt-f1').fill('300');
    await page.getByTestId('flt-f2').fill('3.4k');
    await expect(page.getByTestId('flt-title')).toContainText('band-pass, 300 Hz to 3.4 kHz');
    await page.getByTestId('flt-fs').fill('5k');
    await expect(page.getByTestId('tool')).toContainText('more than twice the highest frequency');
  },
  'smith-chart': async (page) => {
    await expect(page.getByTestId('smith-facts')).toContainText('2.872');
    await expect(page.getByTestId('smith-facts')).toContainText('0.4834');
    await expect(page.getByTestId('smith-matches')).toContainText('From the load');
    await expect(page.getByTestId('smith-line')).toContainText('After 0.1 λ');
    await page.getByTestId('smith-r').fill('50');
    await page.getByTestId('smith-x').fill('0');
    await expect(page.getByTestId('smith-matches')).toContainText('already matches');
  },
  'lan-scanner': async (page) => {
    await expect(page.getByTestId('lan-scan')).toBeDisabled();
    await expect(page.getByTestId('lan-table')).toContainText('Devices appear here');
    await desktopGate(page);
  },
  'wake-on-lan': async (page) => {
    await desktopGate(page);
    await page.getByTestId('wol-mac').fill('3c-52-82-1a-2b');
    await expect(page.getByTestId('tool')).toContainText('12 hex digits');
    await expect(page.getByTestId('wol-save')).toBeDisabled();
    await page.getByTestId('wol-name').fill('Gallery 2 kiosk');
    await page.getByTestId('wol-mac').fill('3c-52-82-1a-2b-3c');
    await page.getByTestId('wol-save').click();
    await expect(page.getByTestId('wol-list')).toContainText('Gallery 2 kiosk');
    await expect(page.getByTestId('wol-list')).toContainText('3C:52:82:1A:2B:3C');
    // Waking needs the desktop app.
    await expect(page.getByTestId('wol-wake')).toBeDisabled();
  },
  'lan-speed-test': async (page) => {
    await desktopGate(page);
    await expect(page.getByTestId('speed-serve')).toBeDisabled();
    await page.getByRole('radio', { name: 'Test the link to another computer' }).click();
    await page.getByTestId('speed-address').fill('192.168.1.20');
    await expect(page.getByTestId('speed-test')).toBeDisabled();
  },
  'lan-file-share': async (page) => {
    await desktopGate(page);
    await expect(page.getByTestId('share-folder')).toBeDisabled();
    await expect(page.getByTestId('share-start')).toBeDisabled();
  },
  'parquet-avro-viewer': async (page) => {
    await chooseFiles(page, page.getByTestId('cv-open'), [{ name: 'galleries.parquet', mimeType: 'application/octet-stream', buffer: GALLERIES_PARQUET }]);
    await expect(page.getByTestId('cv-facts')).toContainText('Rows');
    await expect(page.getByTestId('cv-schema')).toContainText('visitors');
    await expect(page.getByTestId('cv-rows')).toContainText('Kids Science');
  },
  'scientific-calculator': async (page) => {
    await page.getByTestId('sci-input').fill('2^10 + sin(30)');
    await page.getByTestId('sci-input').press('Enter');
    await expect(page.getByTestId('sci-result')).toHaveText('= 1024.5');
    await page.getByTestId('sci-angle').click();
    await page.getByTestId('sci-input').fill('cos(pi)');
    await expect(page.getByTestId('sci-result')).toHaveText('= -1');
  },
  'graphing-calculator': async (page) => {
    await page.getByTestId('gr-fn-0').fill('x^2 - 4');
    await expect(page.getByTestId('gr-roots')).toContainText('x = -2');
    await expect(page.getByTestId('gr-roots')).toContainText('x = 2');
  },
  'palette-library': async (page) => {
    await page.getByTestId('pl-search').fill('viridis');
    await page.getByTestId('pl-viridis').click();
    await expect(page.getByTestId('pl-detail')).toContainText('#fde725');
  },
  scratchpad: async (page) => {
    await page.getByTestId('sp-new').click();
    await page.getByTestId('sp-text').fill('Call the lighting vendor on Monday');
    await expect(page.getByTestId('sp-count')).toContainText('6 words');
  },
  'tailwind-cheatsheet': async (page) => {
    await page.getByTestId('tw-search').fill('rounded-lg');
    await expect(page.getByTestId('tw-table')).toContainText('border-radius: 0.5rem;');
  },
  'material-theme': async (page) => {
    await expect(page.getByTestId('mt-preview').locator('.mt-phone')).toHaveCount(2);
    await page.getByTestId('mt-seed').fill('#6750A4');
    await expect(page.getByRole('button', { name: 'Copy Primary #65558F' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy Primary container #E9DDFF' })).toBeVisible();
    await page.getByText('Custom colours (0)').click();
    await page.getByTestId('mt-add-custom').click();
    const zip = unzipSync(new Uint8Array(await download(page, () => page.getByRole('button', { name: 'All files (ZIP)' }).click())));
    const colors = Buffer.from(zip['android/app/src/main/res/values/colors.xml'] as Uint8Array).toString('utf8');
    expect(colors).toContain('<color name="md_theme_light_primary">#65558F</color>');
    expect(colors).toContain('<color name="md_theme_dark_surface">#141218</color>');
    expect(colors).toContain('md_custom_light_success');
    expect(Object.keys(zip)).toContain('flutter/lib/theme/color_schemes.dart');
  },
  ...Object.fromEntries(
    CALC_CATEGORIES.map((category) => [
      `calc-${category.id}`,
      async (page: Page) => {
        // The first calculator opens with its example worked out.
        await expect(page.getByTestId('calc-card')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.calc-field.is-computed').first()).toBeVisible();
        await expect(page.getByTestId('calc-status')).not.toContainText('more value');
      },
    ]),
  ),
};

for (const entry of TOOLS) {
  test(`${entry.kind} tool: ${entry.name}`, async ({ page }) => {
    const problems = watch(page);
    const tool = await openTool(page, entry.id);

    if (entry.kind === 'text' && entry.category === 'online') {
      // In a browser the online checks must explain that they need the desktop app, without touching the network.
      const sample = tool.getByRole('button', { name: 'Sample', exact: true });
      if ((await sample.count()) > 0) await sample.first().click();
      const target = ONLINE_TARGETS[entry.id];
      if (target) await page.locator(`#${entry.id}-${target[0]}`).fill(target[1]);
      await page.getByTestId('run').click();
      await expect(tool).toHaveAttribute('data-state', 'error', { timeout: 30_000 });
      await expect(tool).toContainText('desktop app');
    } else if (entry.kind === 'text') {
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

const SANDBOX_PROBE = `benchtop.register({
  name: 'Sandbox probe',
  run(input) {
    const reach = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'indexedDB', 'caches', 'importScripts', 'BroadcastChannel', 'Worker'].filter((name) => typeof self[name] !== 'undefined');
    const storage = typeof navigator.storage !== 'undefined';
    return input.toUpperCase() + (reach.length || storage ? ' REACHABLE ' + reach.join(',') + (storage ? ' storage' : '') : ' SEALED');
  },
});
`;

test('plugins run sealed off from the network and storage, and work as pipeline steps', async ({ page }) => {
  const problems = watch(page);
  await openTool(page, 'plugins');
  await chooseFiles(page, page.getByRole('button', { name: 'Add from file…' }), [{ name: 'probe.js', mimeType: 'text/javascript', buffer: Buffer.from(SANDBOX_PROBE) }]);
  await expect(page.getByTestId('plugin-select').locator('option:checked')).toHaveText('Sandbox probe');
  await page.getByTestId('plugin-input').locator('.cm-content').click();
  await page.keyboard.type('abc');
  await page.getByTestId('plugin-run').click();
  await expect.poll(() => editorText(page.getByTestId('plugin-output'))).toBe('ABC SEALED');

  await openTool(page, 'file-pipeline');
  await page.getByTestId('fp-tool').first().selectOption({ label: 'Sandbox probe' });
  await chooseFiles(page, page.getByTestId('fp-drop'), [{ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
  await page.getByTestId('fp-run').click();
  await expect.poll(() => editorText(page.getByTestId('fp-preview'))).toBe('HELLO SEALED');
  expect(problems).toEqual([]);
});

test('the OCR tool takes a screenshot pasted from the clipboard', async ({ page }) => {
  const problems = watch(page);
  await openTool(page, 'ocr');
  await page.evaluate(
    async (bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    [...SAMPLE_PNG],
  );
  await expect(page.getByTestId('ocr-files')).toContainText(/screenshot-\d{6}\.png/);
  expect(problems).toEqual([]);
});

test('the config generator groups its files and shows only the fields a file uses', async ({ page }) => {
  const problems = watch(page);
  const tool = await openTool(page, 'config-generator');
  const select = page.locator('#config-generator-template');
  await expect(select.locator('optgroup[label="Kubernetes"] option')).not.toHaveCount(0);
  await expect(select.locator('optgroup')).toHaveCount(9);
  await select.selectOption('k8s-hpa');
  await expect(tool).toHaveAttribute('data-state', /^(idle|done)$/);
  await expect(page.locator('#config-generator-replicas')).toBeVisible();
  await expect(page.locator('#config-generator-node')).toHaveCount(0);
  await page.locator('#config-generator-replicas').fill('3');
  await expect.poll(() => editorText(page.getByTestId('output-editor'))).toContain('maxReplicas: 15');
  await select.selectOption('conn-postgres');
  await page.locator('#config-generator-dbuser').fill('curator');
  await expect.poll(() => editorText(page.getByTestId('output-editor'))).toContain('postgresql://curator:');
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
