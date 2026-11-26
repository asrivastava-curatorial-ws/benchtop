/**
 * Opens every tool in the production build and checks that it works, that
 * nothing is logged as an error and that no request leaves the app.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { degrees, PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { CALC_CATEGORIES } from '../../src/calc/types';
import { readTiff } from '../../src/lib/tiff';
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

async function download(page: Page, click: () => Promise<unknown>): Promise<Buffer> {
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
  'file-pipeline': async (page, tool) => {
    const json = (name: string, text: string) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
    const pick = (label: string) => page.getByTestId('wf-pick').selectOption({ label });
    const results = page.getByTestId('fp-results');
    // A straight chain, as in the File Pipeline this grew from: one bad file does not stop the others.
    await pick('Format JSON files');
    await chooseFiles(page, page.getByTestId('fp-drop'), [json('galleries.json', '{"b":1,"a":[2]}'), json('broken.json', '{oops')]);
    await page.getByTestId('fp-run').click();
    await expect(results).toContainText('galleries.json');
    await expect(results.locator('td.tone-bad')).toContainText('Tool:');
    await expect.poll(() => editorText(page.getByTestId('fp-preview'))).toContain('"b": 1');
    // One good result is saved as itself rather than in a ZIP.
    const saved = await download(page, () => page.getByTestId('fp-save').click());
    expect(JSON.parse(saved.toString())).toEqual({ b: 1, a: [2] });

    // Branches: each file goes the way its type says, and every step shows what came out of it.
    await page.getByRole('button', { name: 'Clear files' }).click();
    await pick('Branch: sort files by type');
    await chooseFiles(page, page.getByTestId('fp-drop'), [
      json('a.json', '[1]'),
      { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Hi') },
      { name: 'other.txt', mimeType: 'text/plain', buffer: Buffer.from('plain') },
    ]);
    await page.getByTestId('fp-run').click();
    await expect(results).toContainText('unchanged/other.txt');
    await expect(results).toContainText('notes.html');
    const zip = unzipSync(new Uint8Array(await download(page, () => page.getByTestId('fp-save').click())));
    expect(Object.keys(zip).sort()).toEqual(['a.json', 'notes.html', 'unchanged/other.txt']);
    await page.getByTestId('wf-node-filter').first().locator('.wf-node-head').click();
    await expect(page.getByTestId('wf-came')).toContainText('yes: 1');
    await expect(page.getByTestId('wf-came')).toContainText('no: 2');

    // A loop: decode until the text is no longer Base64.
    await page.getByRole('button', { name: 'Clear files' }).click();
    await pick('Loop: decode Base64 wrapped several times');
    const wrapped = [1, 2, 3].reduce((text) => Buffer.from(text).toString('base64'), 'Hello, museum!');
    await chooseFiles(page, page.getByTestId('fp-drop'), [{ name: 'secret.txt', mimeType: 'text/plain', buffer: Buffer.from(wrapped) }]);
    await page.getByTestId('fp-run').click();
    await expect(results).toContainText('secret.decoded.txt');
    await expect.poll(() => editorText(page.getByTestId('fp-preview'))).toBe('Hello, museum!');

    // Building one by hand, without the mouse: add a step, connect it from the step's panel, remove the old connection.
    await pick('A new, empty workflow');
    await page.getByTestId('wf-add-tool').click();
    await expect(page.getByTestId('wf-problems')).toContainText('Tool has nothing connected to its input');
    await expect(page.getByTestId('fp-run')).toBeDisabled();
    await page.getByTestId('wf-tool').selectOption({ label: 'Case Converter' });
    const connectOut = async (title: string) => {
      const select = page.getByTestId('wf-connect-out');
      const index = await select.locator('option').evaluateAll((options, start) => options.findIndex((o) => (o.textContent ?? '').startsWith(start)), title);
      await select.selectOption({ index });
    };
    await connectOut('Output');
    await page.getByTestId('wf-node-input').locator('.wf-node-head').click();
    await connectOut('Tool');
    await page.getByRole('button', { name: /Remove the connection from out to Output/ }).click();
    await expect(page.getByTestId('wf-problems')).toHaveCount(0);
    await page.getByTestId('fp-run').click();
    await expect(results).toContainText('secret.txt');
    // Saved workflows open again, and run as a step of another workflow.
    await page.getByTestId('wf-name').fill('Shout');
    await page.getByTestId('wf-name').press('Tab');
    await page.getByTestId('wf-save-library').click();
    const file = JSON.parse((await download(page, () => page.getByTestId('wf-save-file').click())).toString());
    expect(file).toMatchObject({ benchtop: 'workflow', version: 2, workflow: { name: 'Shout' } });
    expect(file.workflow.nodes.map((n: { kind: string }) => n.kind).sort()).toEqual(['input', 'output', 'tool']);
    await pick('A new, empty workflow');
    await expect(page.getByTestId('wf-add-workflow')).toBeEnabled();
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'data-logger': async (page, tool) => {
    // The made-up sensor stands in for a port: ten readings a second.
    await page.getByTestId('dl-source').selectOption('demo');
    await page.getByTestId('dl-connect').click();
    const channels = page.getByTestId('dl-channels');
    await expect(channels).toContainText('temperature');
    await expect(channels).toContainText('pressure');
    await expect(page.getByTestId('dl-status')).toContainText('readings a second');
    await expect(page.getByLabel('Unit of temperature')).toHaveValue('°C');
    // Calibration: the temperature in Fahrenheit under another name.
    await page.getByLabel('Name for temperature').fill('Air temperature');
    await page.getByLabel('Name for temperature').press('Tab');
    await page.getByLabel('Unit of temperature').fill('°F');
    await page.getByLabel('Scale for temperature').fill('1.8');
    await page.getByLabel('Offset for temperature').fill('32');
    await page.getByLabel('Offset for temperature').press('Tab');
    await page.getByTestId('dl-record').click();
    await expect(tool).toHaveAttribute('data-state', 'recording');
    await page.getByTestId('dl-marker').fill('lamp on');
    await page.getByTestId('dl-mark').click();
    await expect.poll(async () => Number(/(\d+) rows recorded/.exec((await page.getByTestId('dl-status').textContent()) ?? '')?.[1] ?? 0), { timeout: 20_000 }).toBeGreaterThanOrEqual(12);
    await page.getByTestId('dl-record').click();
    await expect(tool).toHaveAttribute('data-state', 'done');

    const csv = (await download(page, () => page.getByTestId('dl-csv').click())).toString().trim().split('\r\n');
    expect(csv[0]).toBe('time,elapsed_s,Air temperature (°F),humidity (%),pressure (hPa),note');
    expect(csv.length).toBeGreaterThan(12);
    const row = (csv[1] as string).split(',');
    expect(row[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/);
    expect(Number(row[2])).toBeGreaterThan(68);
    expect(Number(row[2])).toBeLessThan(84);
    expect(Number(row[4])).toBeGreaterThan(1000);
    expect(csv.some((line) => line.endsWith(',lamp on'))).toBe(true);
    // Elapsed seconds grow from row to row.
    const elapsed = csv.slice(1).map((line) => Number(line.split(',')[1]));
    expect(elapsed.every((value, index) => index === 0 || value > (elapsed[index - 1] as number))).toBe(true);

    const sqlite = await download(page, () => page.getByTestId('dl-sqlite').click());
    expect(sqlite.subarray(0, 15).toString()).toBe('SQLite format 3');
    expect(sqlite.includes(Buffer.from('air_temperature'))).toBe(true);
    expect(sqlite.includes(Buffer.from('lamp on'))).toBe(true);
    const parquet = await download(page, () => page.getByTestId('dl-parquet').click());
    expect(parquet.subarray(0, 4).toString()).toBe('PAR1');
    expect(parquet.subarray(-4).toString()).toBe('PAR1');
    expect(parquet.includes(Buffer.from('elapsed_s'))).toBe(true);
    await page.getByTestId('dl-connect').click();
    await expect(page.getByTestId('dl-connect')).toHaveText('Connect');
  },
  'git-workbench': async (page) => {
    // Repositories need the desktop app (covered by the desktop tests); the three-way merge works anywhere.
    await page.getByRole('radio', { name: 'History' }).click();
    await expect(page.getByTestId('gw-gate')).toContainText('desktop app');
    await page.getByRole('radio', { name: 'Three-way merge' }).click();
    await page.getByTestId('gw-sample').click();
    const summary = page.getByTestId('gw-summary');
    await expect(summary).toContainText('2 conflicts, 2 still to decide');
    await expect(summary).toContainText('1 change from yours, 1 from theirs');
    const conflicts = page.getByTestId('gw-conflict');
    await expect(conflicts).toHaveCount(2);
    await page
      .getByRole('button', { name: 'The merged text' })
      .click()
      .catch(() => page.locator('.gw-result-box summary').click());
    const result = page.getByTestId('gw-result');
    await expect(result).toContainText('<<<<<<< yours');
    await expect(result).toContainText('Photography without flash is welcome.');
    await expect(result).toContainText('Guided tours start at the entrance.');
    // One conflict takes a side, the other is written by hand.
    await conflicts.nth(0).getByTestId('gw-take-ours').click();
    await conflicts.nth(1).getByTestId('gw-take-theirs').click();
    await conflicts.nth(1).getByTestId('gw-edit').fill('Do not touch the flywheel, please.\n');
    await expect(summary).toContainText('2 conflicts, 0 still to decide');
    const merged = (await download(page, () => page.getByTestId('gw-save').click())).toString();
    expect(merged).toBe(
      'Engine Hall\nOpen every day, 10 to 6.\nEntry is free.\n\nThe beam engine runs at noon.\nDo not touch the flywheel, please.\n\nPhotography without flash is welcome.\nThe shop is by the exit.\nGuided tours start at the entrance.\n',
    );
    // Texts that do not collide merge without questions.
    await page.getByTestId('gw-theirs').fill(await page.getByTestId('gw-base').inputValue());
    await expect(summary).toContainText('merge cleanly');
  },
  'model-toolbox': async (page, tool) => {
    // A 10 mm cube whose bottom is missing and one of whose triangles is there twice.
    const corners = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
      [0, 0, 10],
      [10, 0, 10],
      [10, 10, 10],
      [0, 10, 10],
    ];
    const faces = [
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
      [4, 5, 6],
    ];
    const stl = `solid cube\n${faces.map((face) => `facet normal 0 0 0\nouter loop\n${face.map((i) => `vertex ${(corners[i] as number[]).join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid cube\n`;
    await chooseFiles(page, page.getByTestId('mt-open'), [{ name: 'cube.stl', mimeType: 'model/stl', buffer: Buffer.from(stl) }]);
    const info = page.getByTestId('mt-info');
    await expect(info).toContainText('11 triangles, 10 × 10 × 10 mm', { timeout: 30_000 });
    await expect(page.getByTestId('mt-size')).toContainText('not closed: repair first');

    await page.getByRole('radio', { name: 'Repair' }).click();
    const analysis = page.getByTestId('mt-analysis');
    await expect(analysis).toContainText('Open edges4 in 1 hole');
    await expect(analysis).toContainText('Doubled triangles1');
    await page.getByTestId('mt-repair').click();
    await expect(page.getByTestId('mt-log')).toContainText('1 doubled triangles removed.');
    await expect(page.getByTestId('mt-log')).toContainText('1 hole closed.');
    await expect(analysis).toContainText('Closed surface (watertight)yes');
    await expect(info).toContainText('14 triangles');

    // Checked against a printer: one cubic centimetre of PLA, standing on its patched bottom.
    await page.getByRole('radio', { name: 'Print check' }).click();
    const print = page.getByTestId('mt-print');
    await expect(print).toContainText('Fits the printeryes: 10 × 10 × 10 mm');
    await expect(print).toContainText('Volume if printed solid1 cm³');
    await expect(print).toContainText('Mass if printed solid1.2 g');
    await expect(print).toContainText('Rests on the bed100 mm² flat on the bed');
    await page.getByTestId('mt-walls').click();
    await expect(print).toContainText('thinnest 10 mm');

    // Measured, scaled and saved in other formats.
    await page.getByRole('radio', { name: 'Measure' }).click();
    await expect(page.getByTestId('mt-size')).toContainText('Volume1,000 mm³');
    await page.getByLabel('Scale by').fill('2');
    await page.getByLabel('Scale by').press('Tab');
    await page.getByTestId('mt-scale').click();
    await expect(info).toContainText('20 × 20 × 20 mm');
    await page.getByTestId('mt-format').selectOption('3mf');
    const pack = unzipSync(new Uint8Array(await download(page, () => page.getByTestId('mt-save').click())));
    const model = strFromU8(pack['3D/3dmodel.model'] as Uint8Array);
    expect(model).toContain('<model unit="millimeter"');
    expect(model.match(/<triangle /g)).toHaveLength(14);
    expect(model).toContain('<vertex x="20" y="20" z="20"/>');
    await page.getByTestId('mt-format').selectOption('obj');
    expect((await download(page, () => page.getByTestId('mt-save').click())).toString().match(/^v /gm)).toHaveLength(9);
    await page.getByTestId('mt-undo').click();
    await expect(info).toContainText('10 × 10 × 10 mm');

    await page.getByRole('radio', { name: 'Simplify' }).click();
    await page.getByTestId('mt-simplify').click();
    await expect(page.getByTestId('mt-reduced')).toContainText('14 triangles became');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'vector-editor': async (page, tool) => {
    const canvas = page.getByTestId('ve-canvas');
    const area = await canvas.boundingBox();
    if (!area) throw new Error('no canvas');
    // The page is shown whole; its corner in screen pixels comes from the view box.
    const viewBox = ((await canvas.getAttribute('viewBox')) ?? '').split(' ').map(Number) as [number, number, number, number];
    const zoom = area.width / viewBox[2];
    const at = (x: number, y: number): [number, number] => [area.x + (x - viewBox[0]) * zoom, area.y + (y - viewBox[1]) * zoom];
    const drag = async (from: [number, number], to: [number, number]) => {
      await page.mouse.move(...at(...from));
      await page.mouse.down();
      await page.mouse.move(...at((from[0] + to[0]) / 2, (from[1] + to[1]) / 2), { steps: 3 });
      await page.mouse.move(...at(...to), { steps: 3 });
      await page.mouse.up();
    };
    const count = page.getByTestId('ve-count');
    const field = (id: string) => page.getByTestId(id);
    const value = async (id: string) => Number(await field(id).inputValue());

    // Two shapes drawn with the mouse.
    await page.getByRole('radio', { name: 'Rectangle' }).click();
    await drag([100, 100], [300, 250]);
    await expect(count).toHaveText('1 shape selected');
    expect([await value('ve-x'), await value('ve-y'), await value('ve-w'), await value('ve-h')]).toEqual([100, 100, 200, 150]);
    await page.getByRole('radio', { name: 'Ellipse' }).click();
    await drag([250, 200], [450, 400]);
    expect(await value('ve-w')).toBe(200);

    // Snapping: dragged near the rectangle, the ellipse's left edge meets the rectangle's right edge.
    await drag([350, 300], [403, 300]);
    expect(await value('ve-x')).toBe(300);
    await page.getByTestId('ve-undo').click();
    expect(await value('ve-x')).toBe(250);

    // Alignment and exact sizes from the keyboard.
    await page.getByTestId('ve-stage').focus();
    await page.keyboard.press('Control+a');
    await expect(count).toHaveText('2 shapes selected');
    await page.getByTestId('ve-align-top').click();
    await page.getByTestId('ve-shape').first().click();
    expect(await value('ve-y')).toBe(100);
    await page.getByTestId('ve-undo').click();
    await field('ve-x').fill('260');
    await field('ve-x').press('Tab');
    await page.getByTestId('ve-stage').focus();
    await page.keyboard.press('ArrowRight');
    expect(await value('ve-x')).toBe(261);
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await value('ve-x')).toBe(250);

    // Boolean operations: the union is one shape as wide as both; the difference has a curved bite.
    await page.keyboard.press('Control+a');
    await page.getByTestId('ve-bool-unite').click();
    await expect(count).toHaveText('1 shape selected');
    expect([await value('ve-x'), await value('ve-y'), await value('ve-w'), await value('ve-h')]).toEqual([100, 100, 350, 300]);
    await page.getByTestId('ve-undo').click();
    await page.keyboard.press('Control+a');
    await page.getByTestId('ve-bool-subtract').click();
    await expect(count).toHaveText('1 shape selected');
    expect([await value('ve-w'), await value('ve-h')]).toEqual([200, 150]);

    // Node editing: a node is moved by typing, made a corner, another one added and deleted.
    await page.getByRole('radio', { name: 'Nodes' }).click();
    const nodes = page.getByTestId('ve-node-pick');
    const before = await nodes.count();
    expect(before).toBeGreaterThan(4);
    await nodes.first().click();
    await field('ve-node-x').fill('80');
    await field('ve-node-x').press('Tab');
    await page.getByRole('radio', { name: 'Select' }).click();
    expect(await value('ve-x')).toBe(80);
    await page.getByRole('radio', { name: 'Nodes' }).click();
    await nodes.first().click();
    await page.getByTestId('ve-node-add').click();
    await expect(nodes).toHaveCount(before + 1);
    await nodes.nth(1).click();
    await page.getByTestId('ve-node-smooth').click();
    await page.getByTestId('ve-node-corner').click();
    await page.getByTestId('ve-node-delete').click();
    await expect(nodes).toHaveCount(before);

    // Layers, and what the files hold.
    await page.getByTestId('ve-add-layer').click();
    await page.getByRole('radio', { name: 'Line', exact: true }).click();
    await drag([50, 500], [700, 500]);
    await expect(page.getByTestId('ve-shape')).toHaveCount(2);
    const saved = (await download(page, () => page.getByTestId('ve-save').click())).toString();
    expect(saved).toContain('inkscape:label="Layer 2"');
    expect(saved.match(/<path /g)).toHaveLength(2);
    expect(saved).toMatch(/d="M50 500L700 500"/);
    expect(saved).toMatch(/ d="M[^"]*C[^"]*Z"/);
    const dxf = (await download(page, () => page.getByTestId('ve-dxf').click())).toString();
    expect(dxf).toContain('\n2\nLAYER_1\n');
    expect(dxf).toContain('\n2\nLAYER_2\n');
    expect(dxf.match(/\n0\nPOLYLINE\n/g)).toHaveLength(2);
    // 50 px from the left is 13.2292 mm; the page is 600 px high, so y = 500 px is 26.4583 mm from the bottom.
    expect(dxf).toContain('VERTEX\n8\nLAYER_2\n10\n13.2292\n20\n26.4583');

    // The drawing is there again after leaving the tool.
    await openTool(page, 'json-formatter');
    await openTool(page, 'vector-editor');
    await expect(page.getByTestId('ve-shape')).toHaveCount(2);
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'pdf-studio': async (page, tool) => {
    const secret = await PDFDocument.create();
    const font = await secret.embedFont(StandardFonts.Helvetica);
    const first = secret.addPage([595.28, 841.89]);
    first.drawText('Curator: A. Srivastava', { x: 60, y: 760, size: 18, font });
    first.drawText('Phone 98765 43210, public notice', { x: 60, y: 720, size: 18, font });
    secret.addPage([595.28, 841.89]).drawText('Nothing secret here', { x: 60, y: 760, size: 18, font });
    secret.setTitle('Report by Srivastava');
    const upload = { name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await secret.save()) };
    const fontsOf = (doc: PDFDocument, index: number) => {
      const fonts = doc.getPage(index).node.Resources()?.lookup(PDFName.of('Font'));
      return fonts instanceof PDFDict ? fonts.keys().length : 0;
    };

    // Redact: words and a pattern are found on every page, an area is drawn by hand, the result is checked.
    await chooseFiles(page, page.getByTestId('ps-drop'), [upload]);
    await page.getByTestId('ps-terms').fill('srivastava');
    await page.getByTestId('ps-pattern-phone').check();
    await page.getByTestId('ps-find').click();
    await expect(page.getByTestId('ps-marks')).toContainText('2 marks on 1 page');
    await expect(page.getByTestId('ps-mark')).toHaveCount(2);
    const sheet = await page.getByTestId('ps-page').boundingBox();
    if (!sheet) throw new Error('no page');
    await page.mouse.move(sheet.x + sheet.width * 0.1, sheet.y + sheet.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(sheet.x + sheet.width * 0.4, sheet.y + sheet.height * 0.6, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId('ps-marks')).toContainText('3 marks on 1 page');
    await page.getByTestId('ps-mark').last().focus();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('ps-marks')).toContainText('2 marks on 1 page');
    await page.getByTestId('ps-run').click();
    await expect(page.getByTestId('ps-checks')).toHaveAttribute('data-failed', '0', { timeout: 30_000 });
    await expect(page.getByTestId('ps-checks')).toContainText('No text is left under the marks');
    await expect(page.getByTestId('ps-checks')).toContainText('gone from the text of every page');
    const redacted = await PDFDocument.load(await download(page, () => page.getByTestId('ps-save').click()), { updateMetadata: false });
    expect(redacted.getPageCount()).toBe(2);
    expect(redacted.getTitle()).toBeUndefined();
    // The marked page is a picture now; the other page was copied with its text.
    expect(fontsOf(redacted, 0)).toBe(0);
    expect(fontsOf(redacted, 1)).toBe(1);

    // PDF/A: fonts that are not embedded make "pictures" the way; the saved file carries the PDF/A parts.
    await page.getByRole('radio', { name: 'PDF/A' }).click();
    await chooseFiles(page, page.getByTestId('ps-a-drop'), [upload]);
    await expect(page.getByTestId('ps-a-found')).toContainText('1 fonts are not embedded (Helvetica)');
    await expect(page.getByTestId('ps-a-pictures')).toBeChecked();
    await page.getByTestId('ps-a-run').click();
    await expect(page.getByTestId('ps-a-checks')).toHaveAttribute('data-failed', '0', { timeout: 30_000 });
    const archived = (await download(page, () => page.getByTestId('ps-a-save').click())).toString('latin1');
    expect(archived).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(archived).toContain('/GTS_PDFA1');
    expect(archived).toContain('Report by Srivastava');
    await page.getByRole('radio', { name: /Keep the pages as they are/ }).check();
    await page.getByTestId('ps-a-run').click();
    await expect(page.getByTestId('ps-a-checks')).toHaveAttribute('data-failed', '1');
    await expect(page.getByTestId('ps-a-checks')).toContainText('Not embedded: Helvetica');

    // Many files: redact, check and save the text, one ZIP for everything.
    await page.getByRole('radio', { name: 'Many files' }).click();
    await chooseFiles(page, page.getByTestId('ps-b-drop'), [upload, await pdfFile('pages.pdf', 2)]);
    await page.getByTestId('ps-b-redact').check();
    await page.getByTestId('ps-b-terms').fill('Srivastava\nPage 1');
    await page.getByTestId('ps-b-text').check();
    await page.getByTestId('ps-b-run').click();
    const rows = page.getByTestId('ps-b-rows');
    await expect(rows.locator('tbody tr')).toHaveCount(2, { timeout: 30_000 });
    await expect(rows).toContainText('1 redacted, checked; text saved');
    const zipped = unzipSync(new Uint8Array(await download(page, () => page.getByTestId('ps-b-save').click())));
    expect(Object.keys(zipped).sort()).toEqual(['pages.pdf', 'pages.txt', 'report.pdf', 'report.txt']);
    expect(strFromU8(zipped['pages.txt'] as Uint8Array)).toBe('\n\n\fPage 2');
    expect(strFromU8(zipped['report.txt'] as Uint8Array)).toContain('Nothing secret here');
    expect(strFromU8(zipped['report.txt'] as Uint8Array)).not.toContain('Srivastava');

    // OCR correction: doubtful words are listed, a corrected word ends up in the saved text.
    await page.getByRole('radio', { name: 'Correct OCR' }).click();
    await chooseFiles(page, page.getByTestId('ps-ocr-drop'), [{ name: 'note.png', mimeType: 'image/png', buffer: readFileSync(new URL('./fixtures/ocr.png', import.meta.url)) }]);
    await page.getByTestId('ps-ocr-run').click();
    await expect(page.getByTestId('ps-ocr-count')).toContainText('words on this page', { timeout: 60_000 });
    await page.locator('.ps-panel input[type=range]').fill('99');
    await page.getByTestId('ps-ocr-list').locator('button').first().click();
    await page.getByTestId('ps-ocr-word').fill('Corrected');
    await page.getByTestId('ps-ocr-word').press('Enter');
    expect((await download(page, () => page.getByTestId('ps-ocr-text').click())).toString()).toContain('Corrected');
    const searchable = await PDFDocument.load(await download(page, () => page.getByTestId('ps-ocr-pdf').click()));
    expect(searchable.getPageCount()).toBe(1);
    expect(fontsOf(searchable, 0)).toBe(1);
    await expect(tool).toHaveAttribute('data-state', 'idle');
  },
  'offline-search': async (page, tool) => {
    // Folders need the desktop app (covered by the desktop tests); notes are searched in the browser too.
    await expect(page.getByTestId('os-gate')).toContainText('desktop app');
    await openTool(page, 'notes');
    await expect(page.getByTestId('nt-saved')).toHaveText('Saved', { timeout: 15_000 });
    await page.getByTestId('nt-title').fill('Engine Hall survey');
    await page.getByTestId('nt-text').first().click();
    await page.keyboard.type('Labels to replace in the steam gallery.');
    await expect(page.getByTestId('nt-saved')).toHaveText('Saved', { timeout: 15_000 });
    await openTool(page, 'offline-search');
    await page.getByTestId('os-query').fill('steam gall');
    await expect(page.getByTestId('os-count')).toHaveText('1 note');
    const hit = page.getByTestId('os-note');
    await expect(hit).toContainText('Engine Hall survey');
    await expect(hit.locator('mark')).toHaveText(['steam', 'gall']);
    await expect(tool).toHaveAttribute('data-state', 'done');
    await page.getByTestId('os-query').fill('steam -labels');
    await expect(page.getByTestId('os-count')).toHaveText('Nothing found');
    await page.getByTestId('os-query').fill('"replace in" hall');
    await hit.click();
    await expect(page.getByTestId('os-preview')).toContainText('Engine Hall survey');
    await page.getByTestId('os-open-note').click();
    await expect(page.getByTestId('nt-title')).toHaveValue('Engine Hall survey');
  },
  projects: async (page, tool) => {
    await page.getByTestId('pj-name').fill('Engine Hall labels');
    await page.getByTestId('pj-create').click();
    await expect(page.getByTestId('sidebar-project')).toContainText('Engine Hall labels');
    await expect(page.getByTestId('pj-state')).toContainText('This project is open');
    // Files opened and saved in a tool are kept, and the tool's settings live in the project.
    await openTool(page, 'file-pipeline');
    await page.getByTestId('wf-pick').selectOption({ label: 'Minify CSS files' });
    await chooseFiles(page, page.getByTestId('fp-drop'), [{ name: 'site.css', mimeType: 'text/css', buffer: Buffer.from('a { color: red; }\n') }]);
    await page.getByTestId('fp-run').click();
    await expect(page.getByTestId('fp-results')).toContainText('site.min.css');
    await download(page, () => page.getByTestId('fp-save').click());
    await page.getByTestId('wf-keep').click();
    await openTool(page, 'projects');
    await expect(page.getByTestId('pj-input')).toContainText('site.css');
    await expect(page.getByTestId('pj-output')).toContainText('site.min.css');
    await expect(page.getByTestId('pj-intermediate')).toContainText('Tool (out)/site.css');
    await expect(page.getByTestId('pj-tools')).toContainText('Workflow Builder');
    const bundle = await download(page, () => page.getByTestId('pj-export').click());
    const entries = unzipSync(new Uint8Array(bundle));
    const manifest = JSON.parse(strFromU8(entries['benchtop-project.json'] as Uint8Array));
    expect(manifest.project.name).toBe('Engine Hall labels');
    expect(manifest.project.toolOptions['file-pipeline'].workflow.name).toBe('Minify CSS files');
    expect(strFromU8(entries['files/input/site.css'] as Uint8Array)).toBe('a { color: red; }\n');
    expect(strFromU8(entries['files/output/site.min.css'] as Uint8Array)).toBe('a{color:red}');
    // Closed, tools go back to the settings they have outside any project; opened again, they return.
    await page.getByTestId('pj-close').click();
    await expect(page.getByTestId('sidebar-project')).toHaveText('Projects');
    await openTool(page, 'file-pipeline');
    await expect(page.getByTestId('wf-name')).toHaveValue('Format JSON files');
    await openTool(page, 'projects');
    await page.getByTestId('pj-open').click();
    await openTool(page, 'file-pipeline');
    await expect(page.getByTestId('wf-name')).toHaveValue('Minify CSS files');
    // A bundle opens as a project of its own.
    await openTool(page, 'projects');
    await chooseFiles(page, page.getByTestId('pj-import'), [{ name: 'job.bproject', mimeType: 'application/zip', buffer: bundle }]);
    await expect(tool.locator('.pj-list li')).toHaveCount(2);
    await expect(page.getByTestId('pj-state')).toContainText('This project is closed');
    await expect(page.getByTestId('pj-input')).toContainText('site.css');
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
    // The tool starts listening a moment after it appears: the key is pressed until it has been heard.
    await expect(async () => {
      await page.keyboard.press('q');
      await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
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
    // "Translate" hands the text to the Text Translator, which recognises the script.
    await page.getByTestId('ocr-translate').click();
    await expect(page.getByTestId('tr-input')).toHaveValue(/नमस्ते/);
    await expect(page.getByTestId('tr-from').locator('option').first()).toHaveText('Detect (Hindi)');
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
  'flipbook-editor': async (page, tool) => {
    await chooseFiles(page, page.getByTestId('fbe-add-pdf'), [await pdfFile('guide.pdf', 4)]);
    await expect(tool).toHaveAttribute('data-pages', '4', { timeout: 30_000 });
    await page.getByTestId('fbe-add-blank').click();
    await expect(tool).toHaveAttribute('data-pages', '5');
    await page.getByTestId('fbe-delete-5').click();
    await expect(tool).toHaveAttribute('data-pages', '4');
    // A note on page 2.
    await page.getByTestId('fbe-page-2').click();
    await page.getByTestId('fbe-draw').click();
    const box = await page.getByTestId('fbe-canvas').boundingBox();
    if (!box) throw new Error('the page is not shown');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 4 });
    await page.mouse.up();
    await page.getByTestId('fbe-spot-label').fill('About this page');
    await page.getByTestId('fbe-note-title').fill('Gallery');
    await page.getByTestId('fbe-note-text').fill('Opens at ten.');
    await expect(page.getByTestId('fbe-spots').locator('li')).toHaveCount(1);
    await page.getByTestId('fbe-title').fill('Guide');
    // The preview turns the pages and opens the note.
    await page.getByTestId('fbe-preview-open').click();
    const preview = page.getByTestId('fbe-preview');
    await expect(preview.locator('.fbk-where')).toHaveText('Page 1 of 4');
    await preview.locator('[data-fbk=right]').click();
    await expect(preview.locator('.fbk-where')).toHaveText('Pages 2–3 of 4');
    await preview.getByRole('button', { name: 'About this page' }).click();
    await expect(preview.locator('.fbk-pop-box')).toContainText('Opens at ten.');
    await page.keyboard.press('Escape');
    await expect(preview.locator('.fbk-pop-box')).toHaveCount(0);
    await page.getByTestId('fbe-preview-close').click();
    // Exported, the book works on its own, without the network.
    const html = (await download(page, () => page.getByTestId('fbe-export').click())).toString();
    expect(html).toContain("default-src 'none'");
    const exported = await page.context().newPage();
    await exported.setContent(html);
    await expect(exported.locator('.fbk-where')).toHaveText('Page 1 of 4');
    await exported.keyboard.press('ArrowRight');
    await expect(exported.locator('.fbk-where')).toHaveText('Pages 2–3 of 4');
    await exported.close();
    // Saved, and opened again.
    const project = await download(page, () => page.getByTestId('fbe-save').click());
    await page.getByTestId('fbe-delete-1').click();
    await expect(tool).toHaveAttribute('data-pages', '3');
    await chooseFiles(page, page.getByTestId('fbe-open'), [{ name: 'guide.flipbook', mimeType: 'application/zip', buffer: project }]);
    await expect(tool).toHaveAttribute('data-pages', '4');
    await expect(page.getByTestId('fbe-title')).toHaveValue('Guide');
  },
  'flipbook-reader': async (page, tool) => {
    await chooseFiles(page, page.getByTestId('fbr-drop'), [await pdfFile('book.pdf', 5)]);
    await expect(tool).toHaveAttribute('data-state', 'ready');
    const book = page.getByTestId('fbr-book');
    await expect(book.locator('.fbk-where')).toHaveText('Page 1 of 5');
    await book.locator('[data-fbk=right]').click();
    await expect(book.locator('.fbk-where')).toHaveText('Pages 2–3 of 5');
    // Search finds the words on page 4 (once the PDF's text has been read).
    await book.locator('[data-fbk=panel]').click();
    await book.locator('[data-fbk=tab-search]').click();
    const words = book.getByRole('searchbox', { name: 'Words to find' });
    await words.fill('Page 4');
    await expect(async () => {
      await words.press('Enter');
      await expect(book.locator('.fbk-result')).toHaveCount(1, { timeout: 500 });
    }).toPass();
    await book.locator('.fbk-result').click();
    await expect(book.locator('.fbk-where')).toHaveText('Pages 4–5 of 5');
    await book.focus();
    await page.keyboard.press('Home');
    await expect(book.locator('.fbk-where')).toHaveText('Page 1 of 5');
  },
  'pdf-compare': async (page, tool) => {
    const revised = async () => {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (const text of ['Page 1', 'Page 2 revised', 'Page 3']) doc.addPage([595.28, 841.89]).drawText(text, { x: 60, y: 760, size: 28, font });
      return { name: 'revised.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
    };
    await chooseFiles(page, page.getByTestId('cmp-drop-a'), [await pdfFile('original.pdf', 3)]);
    await chooseFiles(page, page.getByTestId('cmp-drop-b'), [await revised()]);
    await expect(tool).toHaveAttribute('data-state', 'ready');
    await page.getByTestId('cmp-run').click();
    await expect(tool).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    await expect(page.getByTestId('cmp-summary')).toContainText('1 change');
    await expect(page.getByTestId('cmp-summary')).toContainText('0 words removed');
    await expect(page.getByTestId('cmp-summary')).toContainText('1 word added');
    await expect(page.getByTestId('cmp-summary')).toContainText('1 page of 3 look different');
    await expect(page.getByTestId('cmp-page-2')).toBeVisible();
    await expect(page.getByTestId('cmp-page-1')).toHaveCount(0);
    await page.getByTestId('cmp-only-changed').uncheck();
    await expect(page.getByTestId('cmp-page-1')).toContainText('same picture');
    await page.getByRole('radio', { name: 'Word changes' }).click();
    await expect(page.getByTestId('cmp-changes')).toContainText('Page 2');
    await expect(page.getByTestId('cmp-changes').locator('ins')).toHaveText('revised');
    await expect(page.getByTestId('cmp-save-a')).toBeDisabled();
    const marked = await PDFDocument.load(await download(page, () => page.getByTestId('cmp-save-b').click()));
    expect(marked.getPages().map((p) => p.node.Annots()?.size() ?? 0)).toEqual([0, 1, 0]);
    const report = (await download(page, () => page.getByTestId('cmp-save-report').click())).toString();
    expect(report).toContain('**revised**');
    await page.getByRole('radio', { name: 'Pages' }).click();
  },
  'pdf-reader': async (page, tool) => {
    await chooseFiles(page, page.getByTestId('rd-drop'), [await pdfFile('notes.pdf', 3)]);
    await expect(tool).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('rd-page-count')).toHaveText('of 3');
    // Find words, then highlight every match.
    await page.getByTestId('rd-search').fill('Page 2');
    await page.getByTestId('rd-search').press('Enter');
    await expect(page.getByTestId('rd-search-count')).toHaveText('1 of 1');
    await expect(page.getByTestId('rd-page-input')).toHaveValue('2');
    await expect(page.getByTestId('rd-hit-current')).toHaveCount(1);
    await page.getByTestId('rd-side-search').click();
    await page.getByTestId('rd-highlight-all').click();
    await expect(tool).toHaveAttribute('data-annotations', '1');
    // A note, a rectangle and a text box on page 1.
    await page.getByTestId('rd-page-input').fill('1');
    await page.getByTestId('rd-page-input').press('Enter');
    const overlay = page.getByTestId('rd-overlay-1');
    await page.getByTestId('rd-tool-note').click();
    await overlay.click({ position: { x: 300, y: 150 } });
    await page.getByTestId('rd-popover-text').fill('Check this page');
    await page.getByTestId('rd-tool-rect').click();
    const box = await overlay.boundingBox();
    if (!box) throw new Error('page 1 is not shown');
    await page.mouse.move(box.x + 100, box.y + 250);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 330, { steps: 4 });
    await page.mouse.up();
    await expect(tool).toHaveAttribute('data-annotations', '3');
    await page.getByTestId('rd-undo').click();
    await expect(tool).toHaveAttribute('data-annotations', '2');
    await page.getByTestId('rd-redo').click();
    await expect(tool).toHaveAttribute('data-annotations', '3');
    await page.getByTestId('rd-tool-text').click();
    await overlay.click({ position: { x: 100, y: 420 } });
    await page.getByTestId('rd-text-edit').fill('Typed words');
    await page.getByTestId('rd-text-edit').press('Escape');
    await expect(tool).toHaveAttribute('data-annotations', '4');
    await expect(page.getByTestId('rd-save')).toHaveAttribute('data-unsaved', 'true');
    // Saved as real annotations, each with an appearance.
    const saved = await PDFDocument.load(await download(page, () => page.getByTestId('rd-save').click()));
    const kinds = (index: number) =>
      (saved.getPage(index).node.Annots()?.asArray() ?? []).map((ref) => {
        const dict = saved.context.lookup(ref) as PDFDict;
        expect(dict.get(PDFName.of('AP'))).toBeDefined();
        return String(dict.get(PDFName.of('Subtype')));
      });
    expect(kinds(0).sort()).toEqual(['/FreeText', '/Square', '/Text']);
    expect(kinds(1)).toEqual(['/Highlight']);
    await expect(page.getByTestId('rd-save')).toHaveAttribute('data-unsaved', 'false');
    // Opened again, they can be changed; one is deleted and the rest flattened into the pages.
    await chooseFiles(page, page.getByRole('button', { name: 'Replace', exact: true }), [{ name: 'notes (annotated).pdf', mimeType: 'application/pdf', buffer: Buffer.from(await saved.save()) }]);
    await expect(tool).toHaveAttribute('data-annotations', '4');
    await page.getByTestId('rd-side-comments').click();
    await expect(page.getByTestId('rd-comments')).toContainText('Check this page');
    await page.getByTestId('rd-comment-rect').click();
    await page.getByTestId('rd-delete').click();
    await expect(tool).toHaveAttribute('data-annotations', '3');
    await page.getByTestId('rd-flatten').check();
    const flat = await PDFDocument.load(await download(page, () => page.getByTestId('rd-save').click()));
    expect(flat.getPages().map((p) => p.node.Annots()?.size() ?? 0)).toEqual([0, 0, 0]);
    expect(flat.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)?.keys()).toHaveLength(2);
    await page.getByTestId('rd-flatten').uncheck();
  },
  'pdf-toolbox': async (page, tool) => {
    await chooseFiles(page, page.getByTestId('tb-drop'), [await pdfFile('report.pdf', 4)]);
    // Bookmarks, one for each page.
    await page.getByRole('button', { name: 'One for each page' }).click();
    await expect(page.getByTestId('tb-bookmarks').locator('li')).toHaveCount(4);
    await page.getByTestId('tb-run').click();
    const marked = await PDFDocument.load(await download(page, () => page.getByTestId('tb-save').click()));
    expect(marked.catalog.get(PDFName.of('Outlines'))).toBeDefined();
    // A blank page after page 2, then found again and removed.
    await page.getByTestId('tb-op-blank-add').click();
    await page.getByTestId('tb-blank-after').fill('2');
    await page.getByTestId('tb-run').click();
    await expect(page.getByTestId('tb-result')).toContainText('1 blank page inserted');
    await page.getByRole('button', { name: 'Keep working on it' }).click();
    await expect(page.locator('.file-meta')).toContainText('5 pages');
    await page.getByTestId('tb-op-blank-remove').click();
    await page.getByTestId('tb-blank-find').click();
    await expect(page.getByTestId('tb-blank-found')).toContainText('Blank: page 3.');
    await page.getByTestId('tb-run').click();
    const trimmed = await PDFDocument.load(await download(page, () => page.getByTestId('tb-save').click()));
    expect(trimmed.getPageCount()).toBe(4);
    // A QR code on every page.
    await page.getByTestId('tb-op-stamp').click();
    await page.getByTestId('tb-qr-text').fill('https://example.org');
    await page.getByTestId('tb-run').click();
    await expect(page.getByTestId('tb-result')).toContainText('Placed on 5 pages');
    // The title on page 1 names the file; the report and the accessibility check read it.
    await page.getByTestId('tb-op-rename').click();
    await expect(page.getByTestId('tb-rename')).toHaveValue('Page 1');
    await page.getByTestId('tb-op-report').click();
    await expect(page.getByTestId('tb-report')).toContainText('"pageCount": 5');
    await page.getByTestId('tb-op-accessibility').click();
    await expect(page.getByTestId('tb-checks')).toContainText('Tagged');
    await expect(page.getByTestId('tb-checks').locator('li.is-fail')).not.toHaveCount(0);
    await page.getByTestId('tb-op-images').click();
    await page.getByTestId('tb-images-find').click();
    await expect(page.getByTestId('tb-images-found')).toContainText('None found');
    // Pages turned sideways are turned back.
    await chooseFiles(page, page.getByRole('button', { name: 'Replace', exact: true }), [await pdfFile('sideways.pdf', 2, 90)]);
    await expect(page.locator('.file-name')).toHaveText('sideways.pdf');
    await page.getByTestId('tb-op-auto-rotate').click();
    await page.getByTestId('tb-rotate-find').click();
    await expect(page.getByTestId('tb-rotate-found')).toContainText('2 pages to turn');
    await page.getByTestId('tb-run').click();
    const upright = await PDFDocument.load(await download(page, () => page.getByTestId('tb-save').click()));
    expect(upright.getPage(0).getRotation().angle).toBe(0);
    await expect(tool).toHaveAttribute('data-state', 'done');
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
  'slide-deck': async (page, tool) => {
    const frame = page.frameLocator('[data-testid="deck-frame"]');
    await expect(page.getByTestId('deck-status')).toContainText('Slide 1 of 7', { timeout: 30_000 });
    await expect(frame.locator('.slides section h1').first()).toHaveText(/Making things move/i);
    await expect(page.getByTestId('deck-notes')).toContainText('Welcome everyone');
    // The preview follows the cursor, and maths is drawn as inline SVG in the theme's colour.
    // The editor draws only the lines in view, so go to the end of the deck first.
    await page.getByTestId('deck-editor').locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.getByTestId('deck-editor').locator('.cm-line', { hasText: 'The energy of a photon' }).click();
    await expect(page.getByTestId('deck-status')).toContainText('Slide 5 of 7', { timeout: 30_000 });
    await expect(frame.locator('section.present svg').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('deck-theme').selectOption('white');
    const html = (await download(page, () => page.getByTestId('deck-html').click())).toString();
    expect(html).toContain('Reveal.initialize');
    expect(html).toContain('RevealHighlight');
    expect(html).toContain('"theme":"white"');
    expect(html).not.toContain('fonts.googleapis.com');
    const md = (await download(page, () => page.getByTestId('deck-md').click())).toString();
    expect(md).toContain('$$\\int_0^1');
    // A saved deck opens again for editing, maths still as TeX.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByTestId('deck-status')).toContainText('of 2', { timeout: 30_000 });
    await chooseFiles(page, page.getByTestId('deck-open'), [{ name: 'talk.html', mimeType: 'text/html', buffer: Buffer.from(html) }]);
    await expect(page.getByTestId('deck-status')).toContainText('of 7', { timeout: 30_000 });
    expect(await editorText(page.getByTestId('deck-editor'))).toContain('E = h\\nu');
    await expect(page.getByTestId('deck-theme')).toHaveValue('white');

    // The visual editor: slides designed by hand live in the same Markdown as the written ones.
    await page.getByRole('radio', { name: 'Visual' }).click();
    await expect(page.getByTestId('vs-slide')).toHaveCount(7);
    await expect(page.getByTestId('vs-written')).toContainText('written in Markdown');
    await page.getByTestId('vs-add-slide').selectOption('content');
    await expect(page.getByTestId('vs-slide')).toHaveCount(8);
    await expect(page.getByTestId('vs-el')).toHaveCount(2);
    await page.getByTestId('vs-el').first().click();
    await page.getByTestId('vs-text').fill('Designed by hand');
    await expect(page.getByTestId('vs-slide').nth(1)).toContainText('Designed by hand');
    // The preview shows the slide being edited, and the designed block covers the slide exactly.
    await expect(page.getByTestId('deck-status')).toContainText('Slide 2 of 8', { timeout: 30_000 });
    await expect(frame.locator('section.present .bt-el').first()).toHaveText('Designed by hand');
    // (The slide slides in first: the measurement waits for it to come to rest.)
    await expect
      .poll(
        () =>
          frame.locator('section.present .bt-visual').evaluate((block) => {
            const slide = (block.closest('.slides') as HTMLElement).getBoundingClientRect();
            const box = block.getBoundingClientRect();
            return Math.max(...[box.left - slide.left, box.top - slide.top, box.width - slide.width, box.height - slide.height].map((n) => Math.round(Math.abs(n))));
          }),
        { timeout: 15_000 },
      )
      .toBeLessThanOrEqual(1);
    // Dragging moves a box; dragging a corner resizes it.
    const title = page.getByTestId('vs-el').first();
    const left = Number(await page.getByTestId('vs-x').inputValue());
    const wide = Number(await page.getByTestId('vs-w').inputValue());
    const grab = await title.boundingBox();
    if (!grab) throw new Error('The title box is not shown.');
    await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
    await page.mouse.down();
    await page.mouse.move(grab.x + grab.width / 2 + 30, grab.y + grab.height / 2 + 70, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Number(await page.getByTestId('vs-y').inputValue())).toBeGreaterThan(100);
    expect(Number(await page.getByTestId('vs-x').inputValue())).toBeGreaterThan(left);
    const corner = await page.getByTestId('vs-handle-se').boundingBox();
    if (!corner) throw new Error('The resize handle is not shown.');
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(corner.x - 80, corner.y + 10, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Number(await page.getByTestId('vs-w').inputValue())).toBeLessThan(wide);
    // Shapes and pictures; a picture keeps its file's proportions.
    await page.getByTestId('vs-add-ellipse').click();
    await expect(page.getByTestId('vs-el')).toHaveCount(3);
    await chooseFiles(page, page.getByTestId('vs-add-picture'), [{ name: 'dot.png', mimeType: 'image/png', buffer: SAMPLE_PNG }]);
    await expect(page.locator('[data-testid="vs-el"][data-kind="image"]')).toHaveCount(1);
    await page.getByTestId('vs-background').fill('#102030');
    await expect(frame.locator('section.present[data-background-color="#102030"]')).toBeAttached();
    await page.getByTestId('vs-notes').fill('Point at the ellipse.');
    await page.getByTestId('vs-notes').blur();
    await expect(page.getByTestId('deck-notes')).toContainText('Point at the ellipse.');
    // Undo takes the notes back; the element count stays.
    await page.getByTestId('vs-undo').click();
    await expect(page.getByTestId('vs-notes')).toHaveValue('');
    await expect(page.getByTestId('vs-el')).toHaveCount(4);
    // A written slide becomes a designed one: its heading and text turn into boxes.
    await page.getByTestId('vs-slide').first().click();
    await page.getByTestId('vs-convert').click();
    await expect(page.getByTestId('vs-el').first()).toHaveText(/Making things move/);
    // Back in Markdown the designed slides are there as HTML, and a saved deck carries them.
    await page.getByRole('radio', { name: 'Markdown' }).click();
    expect(await editorText(page.getByTestId('deck-editor'))).toContain('<div class="bt-visual"');
    const designed = (await download(page, () => page.getByTestId('deck-html').click())).toString();
    expect(designed).toContain('Designed by hand');
    expect(designed).toContain('data-background-color=\\"#102030\\"');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'animation-studio': async (page, tool) => {
    await expect(page.getByTestId('anim-obj-Ball')).toBeVisible();
    await expect(page.getByTestId('anim-clock')).toContainText('3.00 s / 3.00 s');
    // Playback runs on Theatre.js and moves the playhead.
    await page.getByTestId('anim-play').click();
    await expect(page.getByTestId('anim-clock')).not.toContainText('3.00 s /', { timeout: 10_000 });
    await page.getByTestId('anim-play').click();
    await expect(page.getByTestId('anim-play')).toHaveAccessibleName('Play');
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByTestId('anim-add-box').click();
    await expect(page.getByTestId('anim-obj-Box')).toBeVisible();
    await page.getByRole('button', { name: 'Next keyframe' }).click();
    await expect(page.getByTestId('anim-clock')).toContainText('4.00 s / 4.00 s');
    await page.getByTestId('anim-key-x').click();
    await page.getByRole('button', { name: 'Back to the start' }).click();
    await page.getByTestId('anim-prop-x').fill('200');
    await page.getByTestId('anim-prop-x').press('Enter');
    await expect(page.getByTestId('anim-kf-Box-x')).toHaveCount(2);
    await page.getByTestId('anim-kf-Box-x').first().click();
    await page.getByTestId('anim-easing').selectOption('Back out');
    await expect(page.getByTestId('anim-easing')).toHaveValue('Back out');
    const state = JSON.parse((await download(page, () => page.getByTestId('anim-state').click())).toString());
    expect(state.definitionVersion).toBe('0.4.0');
    expect(Object.keys(state.sheetsById.Scene.sequence.tracksByObject)).toEqual(['Box']);
    const project = JSON.parse((await download(page, () => page.getByTestId('anim-project').click())).toString());
    expect(project.kind).toBe('benchtop-animation');
    const html = (await download(page, () => page.getByTestId('anim-html').click())).toString();
    expect(html).toContain("load('@theatre/core')");
    expect(html.match(/<\/script>/g)?.length).toBe(html.match(/<script/g)?.length);

    // A motion path: the box travels along a line, start to end, and X and Y give way to "Along the path".
    const middle = (testId: string) =>
      page.getByTestId(testId).evaluate((el) => {
        const box = el as HTMLElement;
        return [Math.round(box.offsetLeft + box.offsetWidth / 2), Math.round(box.offsetTop + box.offsetHeight / 2)];
      });
    await page.getByTestId('anim-path-line').click();
    await expect(page.getByTestId('anim-route').locator('path')).toHaveAttribute('d', 'M192 360L1088 360');
    await expect(page.getByTestId('anim-path-data')).toHaveValue('M192 360L1088 360');
    await expect(page.getByTestId('anim-kf-Box-progress')).toHaveCount(2);
    await expect(page.getByTestId('anim-prop-x')).toHaveCount(0);
    await expect(page.getByTestId('anim-prop-progress')).toHaveValue('0');
    expect(await middle('anim-obj-Box')).toEqual([192, 360]);
    await page.getByRole('button', { name: 'Next keyframe' }).click();
    await expect(page.getByTestId('anim-prop-progress')).toHaveValue('1');
    expect(await middle('anim-obj-Box')).toEqual([1088, 360]);
    // A path drawn by clicking on the stage.
    await page.getByTestId('anim-path-draw').click();
    const sheet = page.getByTestId('anim-draw');
    const size = await sheet.boundingBox();
    if (!size) throw new Error('The drawing sheet is not shown.');
    for (const [fx, fy] of [
      [0.25, 0.75],
      [0.5, 0.25],
      [0.75, 0.75],
    ] as const)
      await sheet.click({ position: { x: size.width * fx, y: size.height * fy } });
    await page.getByTestId('anim-path-draw').click();
    await expect(page.getByTestId('anim-path-data')).toHaveValue(/^M320 540C.+ 960 540$/);
    expect(await middle('anim-obj-Box')).toEqual([960, 540]);
    await page.getByTestId('anim-path-follow').check();

    // A group: its members move with it.
    await page.getByTestId('anim-add-ellipse').click();
    await page.getByTestId('anim-add-group').click();
    await page.getByTestId('anim-objects').getByRole('button', { name: 'Ellipse', exact: true }).click();
    await page.getByTestId('anim-parent').selectOption('Group');
    await expect(page.getByTestId('anim-obj-Group').getByTestId('anim-obj-Ellipse')).toBeVisible();
    const before = await page.getByTestId('anim-obj-Ellipse').boundingBox();
    await page.getByTestId('anim-objects').getByRole('button', { name: 'Group', exact: true }).click();
    await page.getByTestId('anim-prop-x').fill('840');
    await page.getByTestId('anim-prop-x').press('Enter');
    const after = await page.getByTestId('anim-obj-Ellipse').boundingBox();
    const stageBox = await page.getByTestId('anim-stage').boundingBox();
    if (!before || !after || !stageBox) throw new Error('The stage is not shown.');
    expect((after.x - before.x) / (stageBox.width / 1280)).toBeCloseTo(200, 0);
    expect(await middle('anim-obj-Ellipse')).toEqual([0, 0]);

    // A clip: an animation with a timeline of its own, edited in place and played inside the main one.
    await page.getByTestId('anim-add-clip').click();
    await expect(page.getByTestId('anim-obj-Clip')).toContainText('Empty clip');
    await page.getByTestId('anim-clip-edit').click();
    await expect(page.getByTestId('anim-inside')).toContainText('Editing the clip Clip');
    await expect(page.getByTestId('anim-add-clip')).toHaveCount(0);
    await page.getByTestId('anim-add-text').click();
    await expect(page.getByTestId('anim-obj-Text')).toHaveText('Your text');
    await page.getByTestId('anim-leave').click();
    await expect(page.getByTestId('anim-inside')).toHaveCount(0);
    await expect(page.getByTestId('anim-obj-Clip').locator('.anim-clip-inner .anim-text')).toHaveText('Your text');
    await page.getByTestId('anim-clip-start').fill('1');
    await page.getByTestId('anim-clip-start').press('Enter');
    await expect(page.getByTestId('anim-clipbar-Clip')).toHaveAttribute('style', /left: 25%/);

    // An SVG drawing arrives as a group with a picture for each visible layer.
    const drawing =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g id="Sky"><rect width="400" height="200" fill="#1f6feb"/></g><g id="Sun"><circle cx="320" cy="50" r="24" fill="#f0c050"/></g><g id="Gone" display="none"><rect width="9" height="9"/></g><script>window.hacked = 1</script></svg>';
    await chooseFiles(page, page.getByTestId('anim-add-layers'), [{ name: 'scene.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(drawing) }]);
    await expect(page.getByTestId('anim-obj-scene').getByTestId('anim-obj-Sun')).toBeVisible();
    await expect(page.getByTestId('anim-obj-Sky')).toBeVisible();
    await expect(page.getByTestId('anim-obj-Gone')).toHaveCount(0);
    // The sun's picture is cut to the sun: a 48-unit disc with a little room, where it was in the drawing.
    const sun = await page.getByTestId('anim-obj-Sun').evaluate((el) => {
      const box = el as HTMLElement;
      return [box.offsetLeft + box.offsetWidth / 2, box.offsetTop + box.offsetHeight / 2, box.offsetWidth, box.offsetHeight];
    });
    expect(Math.abs((sun[0] ?? 0) - 120)).toBeLessThan(2);
    expect(Math.abs((sun[1] ?? 0) + 50)).toBeLessThan(2);
    expect(sun[2]).toBeGreaterThan(47);
    expect(sun[2]).toBeLessThan(54);
    expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined();

    // A soundtrack: its waveform sits under the ruler, and the animation can take its length.
    const rate = 8000;
    const wav = Buffer.alloc(44 + rate * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + rate * 2, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(rate * 2, 40);
    for (let i = 0; i < rate; i++) wav.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / rate) * 20000), 44 + i * 2);
    await chooseFiles(page, page.getByTestId('anim-sound-add'), [{ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav }]);
    await expect(page.getByTestId('anim-sound').locator('canvas')).toHaveAttribute('data-ready', 'yes');
    await expect(page.getByTestId('anim-sound-name')).toContainText('tone.wav · 1.00 s');
    await page.getByTestId('anim-sound-fit').click();
    await expect(page.getByTestId('anim-clock')).toContainText('/ 1.00 s');
    const inked = await page
      .getByTestId('anim-sound')
      .locator('canvas')
      .evaluate((el) => {
        const canvas = el as HTMLCanvasElement;
        const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? new Uint8ClampedArray();
        let filled = 0;
        for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) filled += 1;
        return filled / (canvas.width * canvas.height);
      });
    expect(inked).toBeGreaterThan(0.3);
    // It plays with the sound attached, and stops.
    await page.getByRole('button', { name: 'Back to the start' }).click();
    await page.getByTestId('anim-play').click();
    await expect(page.getByTestId('anim-clock')).not.toContainText('0.00 s /', { timeout: 10_000 });
    await page.getByTestId('anim-play').click();
    await expect(page.getByTestId('anim-play')).toHaveAccessibleName('Play');

    // Video: frames drawn on a canvas become a GIF, numbered pictures, or a recording.
    await page.getByTestId('anim-video').click();
    await page.getByTestId('anim-export-size').selectOption('0.25');
    await page.getByTestId('anim-export-fps').selectOption('10');
    await page.getByTestId('anim-export-format').selectOption('gif');
    await expect(page.getByTestId('anim-export-note')).toContainText('10 frames of 320 × 180 over 1 s');
    const gif = await download(page, () => page.getByTestId('anim-export-run').click());
    expect(gif.subarray(0, 6).toString()).toBe('GIF89a');
    expect(gif.readUInt16LE(6)).toBe(320);
    await expect(page.getByTestId('anim-export-result')).toContainText('.gif');
    await page.getByTestId('anim-export-format').selectOption('png');
    const frames = unzipSync(new Uint8Array(await download(page, () => page.getByTestId('anim-export-run').click())));
    expect(Object.keys(frames)).toHaveLength(10);
    expect(Object.keys(frames)[9]).toBe('frame-00010.png');
    expect(
      Buffer.from(frames['frame-00001.png'] ?? [])
        .subarray(1, 4)
        .toString(),
    ).toBe('PNG');
    await page.getByTestId('anim-export-format').selectOption('record');
    const video = await download(page, () => page.getByTestId('anim-export-run').click());
    expect(video.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
    expect(video.length).toBeGreaterThan(2000);
    await expect(page.getByTestId('anim-export-result')).toContainText('.webm');

    // The project file keeps all of it, and opens again.
    const film = JSON.parse((await download(page, () => page.getByTestId('anim-project').click())).toString());
    expect(film.objects.find((o: { key: string }) => o.key === 'Box')).toMatchObject({ follow: true, path: expect.stringMatching(/^M320 540C/) });
    expect(film.objects.find((o: { key: string }) => o.key === 'Sun')).toMatchObject({ parent: 'scene', kind: 'picture' });
    expect(film.objects.find((o: { key: string }) => o.key === 'Clip')).toMatchObject({ kind: 'clip', clip: 'Clip', start: 1 });
    expect(film.clips.Clip.objects.map((o: { key: string }) => o.key)).toEqual(['Text']);
    expect(film.audio.name).toBe('tone.wav');
    const page2 = (await download(page, () => page.getByTestId('anim-html').click())).toString();
    expect(page2).toContain('attachAudio');
    expect(page2).not.toContain('window.hacked');
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByTestId('anim-obj-Box')).toHaveCount(0);
    await chooseFiles(page, page.getByTestId('anim-open'), [{ name: 'film.animation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(film)) }]);
    await expect(page.getByTestId('anim-obj-scene').getByTestId('anim-obj-Sun')).toBeVisible();
    await expect(page.getByTestId('anim-obj-Clip').locator('.anim-clip-inner .anim-text')).toHaveText('Your text');
    await expect(page.getByTestId('anim-sound').locator('canvas')).toHaveAttribute('data-ready', 'yes');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'green-screen': async (page, tool) => {
    await expect(tool).toHaveAttribute('data-state', 'idle');
    await page.getByTestId('gs-sample').click();
    await expect(page.getByTestId('gs-info')).toContainText('960 × 540');
    // The backdrop colour is read off the edges of the picture.
    await expect(page.getByTestId('gs-key')).not.toHaveValue('#00b140');
    const pixel = (x: number, y: number) =>
      page.getByTestId('gs-canvas').evaluate(
        (el, at) => {
          const canvas = el as HTMLCanvasElement;
          return [...(canvas.getContext('2d')?.getImageData(Math.round(at.x * canvas.width), Math.round(at.y * canvas.height), 1, 1).data ?? [])];
        },
        { x, y },
      );
    // The green cloth is replaced by the chosen colour; the shirt and the face stay.
    await page.getByTestId('gs-colour').fill('#112233');
    await expect.poll(() => pixel(0.05, 0.1)).toEqual([0x11, 0x22, 0x33, 255]);
    await expect.poll(() => pixel(0.95, 0.9)).toEqual([0x11, 0x22, 0x33, 255]);
    expect(await pixel(0.5, 0.9)).toEqual([192, 57, 43, 255]);
    expect(await pixel(0.5, 0.36)).toEqual([224, 172, 140, 255]);
    // The matte: white stays, black goes.
    await page.getByRole('radio', { name: 'Matte' }).click();
    await expect.poll(() => pixel(0.05, 0.1)).toEqual([0, 0, 0, 255]);
    expect(await pixel(0.5, 0.9)).toEqual([255, 255, 255, 255]);
    await page.getByRole('radio', { name: 'Result' }).click();
    // Picking a colour that is not the backdrop keeps the cloth; picking the cloth removes it again.
    await page.getByTestId('gs-key').fill('#c0392b');
    await expect
      .poll(async () => {
        const [r = 0, g = 0, b = 0] = await pixel(0.05, 0.1);
        return g > 60 && g > r + 30 && g > b + 30;
      })
      .toBe(true);
    await page.getByTestId('gs-pick').click();
    const box = await page.getByTestId('gs-canvas').boundingBox();
    if (!box) throw new Error('The preview is not shown.');
    await page.getByTestId('gs-canvas').click({ position: { x: box.width * 0.08, y: box.height * 0.12 } });
    await expect.poll(() => pixel(0.05, 0.1)).toEqual([0x11, 0x22, 0x33, 255]);
    // A smaller subject moved aside shows the background where it stood.
    await page.getByTestId('gs-scale').fill('0.5');
    await page.getByTestId('gs-x').fill('0.25');
    await expect.poll(() => pixel(0.5, 0.9)).toEqual([0x11, 0x22, 0x33, 255]);
    expect(await pixel(0.75, 0.7)).toEqual([192, 57, 43, 255]);
    await page.getByTestId('gs-scale').fill('1');
    await page.getByTestId('gs-x').fill('0');
    // A picture of one's own behind the subject.
    await chooseFiles(page, page.getByRole('radio', { name: 'Picture' }), [{ name: 'wall.png', mimeType: 'image/png', buffer: SAMPLE_PNG }]);
    await expect(page.getByTestId('gs-back')).toContainText('Change the picture');
    await expect.poll(async () => (await pixel(0.05, 0.1)).join()).not.toBe('17,34,51,255');
    expect(await pixel(0.5, 0.9)).toEqual([192, 57, 43, 255]);
    const withWall = await download(page, () => page.getByTestId('gs-save').click());
    expect(withWall.subarray(1, 4).toString()).toBe('PNG');
    expect(withWall.readUInt32BE(16)).toBe(960);
    expect(withWall.readUInt32BE(20)).toBe(540);
    await expect(page.getByTestId('gs-result')).toContainText('(new background).png');
    // Nothing behind: the cloth is see-through, in the preview and in the PNG; a JPEG gets white there.
    await page.getByRole('radio', { name: 'Nothing' }).click();
    await expect.poll(() => pixel(0.05, 0.1)).toEqual([0, 0, 0, 0]);
    const cut = await download(page, () => page.getByTestId('gs-save').click());
    // Colour type 6 is red, green, blue and alpha.
    expect(cut[25]).toBe(6);
    await page.getByTestId('gs-format').selectOption('jpg');
    const flat = await download(page, () => page.getByTestId('gs-save').click());
    expect(flat.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'live-quiz': async (page, tool) => {
    // The tool opens with a sample quiz in the builder.
    const slides = page.getByTestId('qb-slide');
    await expect(slides).toHaveCount(13);
    await expect(page.getByTestId('qb-kind')).toHaveText('1. Content');
    // Building: a new question is checked as it is written, and can be copied, moved and deleted.
    await page.getByTestId('qb-add').selectOption('pick');
    await expect(slides).toHaveCount(14);
    await expect(page.getByTestId('qb-kind')).toHaveText('2. Pick answer');
    await expect(page.getByTestId('qb-problems')).toHaveCount(0);
    await page.getByTestId('qb-question').fill('');
    await expect(page.getByTestId('qb-problems')).toContainText('Write the question');
    await page.getByTestId('qb-question').fill('Which metal is liquid at room temperature?');
    await page.getByTestId('qb-option').nth(0).fill('Mercury');
    await page.getByTestId('qb-correct').nth(0).uncheck();
    await expect(page.getByTestId('qb-problems')).toContainText('Mark the right answer');
    await expect(slides.nth(1)).toContainText('Not ready');
    await page.getByTestId('qb-correct').nth(0).check();
    await expect(page.getByTestId('qb-problems')).toHaveCount(0);
    // A time limit is kept within what a quiz question allows.
    await page.getByTestId('qb-seconds').fill('2');
    await page.getByTestId('qb-seconds').press('Tab');
    await expect(page.getByTestId('qb-seconds')).toHaveValue('5');
    await page.getByTestId('qb-duplicate').click();
    await expect(slides).toHaveCount(15);
    await expect(page.getByTestId('qb-kind')).toHaveText('3. Pick answer');
    await page.getByTestId('qb-up').click();
    await expect(page.getByTestId('qb-kind')).toHaveText('2. Pick answer');
    await page.getByTestId('qb-delete').click();
    await expect(slides).toHaveCount(14);
    await expect(slides.nth(1)).toContainText('Which metal is liquid');

    // A quiz file is opened: one slide of most kinds, with no countdown so that the check runs briskly.
    const deck = {
      kind: 'benchtop-quiz',
      version: 1,
      title: 'Gallery quiz',
      settings: { countdown: 0, sounds: false, avatars: true, chat: true },
      slides: [
        { type: 'poll', title: 'Which gallery first?', chart: 'donut', options: [{ text: 'Engines' }, { text: 'Space' }, { text: 'Dinosaurs' }] },
        { type: 'pick', title: 'Which planet has the shortest day?', seconds: 30, hints: ['It is a gas giant.'], options: [{ text: 'Earth' }, { text: 'Jupiter', correct: true }, { text: 'Mars' }] },
        { type: 'type', title: 'What gas do plants take in?', seconds: 30, accepted: ['carbon dioxide', 'CO2'] },
        { type: 'cloud', title: 'One word for the museum?', entries: 2 },
        { type: 'scale', title: 'How was it?', statements: ['I learned something'], low: 1, high: 5 },
        { type: 'qa', title: 'Questions for the guide' },
        { type: 'brainstorm', title: 'What should we build next?', entries: 1 },
        { type: 'poll', title: 'Should the museum open on Mondays?', hide: true, options: [{ text: 'Yes' }, { text: 'No' }] },
        { type: 'pin', title: 'Where did you spend the most time?', image: `data:image/png;base64,${SAMPLE_PNG.toString('base64')}` },
        { type: 'wheel', title: 'Who gets the souvenir?', useNames: true },
        { type: 'leaderboard', title: 'Leaderboard' },
      ],
    };
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('lq-open').click();
    await (await chooser).setFiles({ name: 'gallery.quiz.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(deck)) });
    await expect(slides).toHaveCount(11);
    await expect(page.getByTestId('lq-title')).toHaveValue('Gallery quiz');
    // The quiz is saved as a file that reads back the same.
    const savedDeck = JSON.parse((await download(page, () => page.getByTestId('lq-save').click())).toString());
    expect(savedDeck).toMatchObject({ kind: 'benchtop-quiz', title: 'Gallery quiz' });
    expect(savedDeck.slides.map((slide: { type: string }) => slide.type)).toEqual(deck.slides.map((slide) => slide.type));

    // Presenting: the lobby shows how to join.
    await page.getByRole('radio', { name: 'Present' }).click();
    await page.getByTestId('lq-start').click();
    await expect(tool).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('qs-lobby')).toContainText('Waiting for the first player');
    const code = (await page.getByTestId('lq-code').textContent()) ?? '';
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    await expect(page.getByTestId('qs-url')).toHaveText(`Code ${code}`);
    const address = (await page.getByTestId('lq-url').getAttribute('href')) ?? '';
    expect(address).toMatch(new RegExp(`/join\\.html#${code}$`));

    // One person joins from another tab, another from the pane beside the big screen.
    // (A window of its own, as a phone would be: a second tab would leave one of the two in the
    // background, where browsers slow a page down to one frame a second.)
    const opening = page.context().waitForEvent('page');
    await page.evaluate((url) => void window.open(url, 'phone', 'popup,width=420,height=820'), address);
    const phone = await opening;
    const phoneProblems = watch(phone);
    await phone.waitForLoadState();
    await phone.getByTestId('qz-name').fill('Asha');
    await phone.getByTestId('qz-join').click();
    await expect(phone.getByTestId('qz-lobby')).toContainText('You are in');
    await expect(page.getByTestId('lq-count')).toHaveText('1 player');
    await expect(page.getByTestId('qs-lobby')).toContainText('Asha');
    await page.getByTestId('lq-try').check();
    const pane = page.getByTestId('lq-try-pane');
    await pane.getByTestId('qz-name').fill('Ben');
    await pane.getByTestId('qz-join').click();
    await expect(pane.getByTestId('qz-lobby')).toContainText('2 players so far');
    await expect(page.getByTestId('lq-count')).toHaveText('2 players');
    // They can say hello while they wait.
    await phone.getByRole('textbox', { name: 'Message' }).fill('hello from the phone');
    await phone.getByRole('button', { name: 'Send' }).click();
    await expect(pane.getByRole('list', { name: 'Messages' })).toContainText('Asha hello from the phone');

    const next = page.getByTestId('lq-next');
    const step = async (label: string) => {
      await expect(next).toHaveText(label);
      await next.click();
    };
    // A poll: votes are counted on the big screen as they come in.
    await step('Start the quiz');
    await expect(page.getByTestId('qs-title')).toHaveText('Which gallery first?');
    await expect(phone.getByTestId('qz-title')).toHaveText('Which gallery first?');
    await phone.getByTestId('qz-option').nth(1).click();
    await phone.getByTestId('qz-send').click();
    await expect(phone.getByTestId('qz-waiting')).toContainText('Your answer is in');
    await expect(page.getByTestId('qs-answered')).toHaveText('1 of 2 answered');
    await pane.getByTestId('qz-option').nth(1).click();
    await pane.getByTestId('qz-send').click();
    await expect(page.getByTestId('qs-ring').locator('.qs-legend li').nth(1)).toHaveText(/Space\s*2\s*100%/);
    await expect(page.getByTestId('qs-ring').locator('svg')).toHaveAttribute('aria-label', 'Engines: 0 (0%); Space: 2 (100%); Dinosaurs: 0 (0%)');

    // A scored question: a hint on request, and the answer as soon as everyone has replied.
    await step('Next slide');
    await expect(page.getByTestId('qs-options').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('qs-clock')).toBeVisible();
    await expect(phone.getByTestId('qz-timer')).toBeVisible();
    await page.getByTestId('lq-hint').click();
    await expect(phone.getByText('Hint: It is a gas giant.')).toBeVisible();
    await expect(page.getByTestId('qs-hint')).toHaveText('Hint: It is a gas giant.');
    await phone.getByTestId('qz-option').nth(1).click();
    await phone.getByTestId('qz-send').click();
    // Nothing says who is right while the question is open.
    await expect(phone.getByTestId('qz-waiting')).toContainText('Waiting for the others');
    await pane.getByTestId('qz-option').nth(0).click();
    await pane.getByTestId('qz-send').click();
    await expect(page.getByTestId('qs')).toHaveAttribute('data-phase', 'revealed');
    await expect(page.getByTestId('qs-bar').nth(1)).toHaveClass(/is-right/);
    await expect(page.getByTestId('qs-bar').nth(1)).toContainText('Right answer');
    await expect(page.getByTestId('qs-summary')).toHaveText('1 of 2 got it right');
    await expect(phone.getByTestId('qz-result')).toHaveClass(/is-right/);
    await expect(phone.getByTestId('qz-result')).toContainText('The answer: Jupiter');
    await expect(pane.getByTestId('qz-result')).toContainText('Not this time');
    const earned = Number(((await phone.getByTestId('qz-score').textContent()) ?? '').replace(/\D/g, ''));
    expect(earned).toBeGreaterThan(50);
    expect(earned).toBeLessThanOrEqual(100);

    // A typed answer: capitals do not matter.
    await step('Next slide');
    await phone.getByTestId('qz-text').fill('co2');
    await phone.getByTestId('qz-send').click();
    await pane.getByTestId('qz-text').fill('oxygen');
    await pane.getByTestId('qz-send').click();
    await expect(page.getByTestId('qs-answer')).toHaveText('The answer: carbon dioxide');
    await expect(page.getByTestId('qs-bar').filter({ hasText: 'co2' })).toHaveClass(/is-right/);
    await expect(page.getByTestId('qs-bar').filter({ hasText: 'oxygen' })).toHaveClass(/is-other/);
    await expect(phone.getByTestId('qz-result')).toContainText('2 right in a row');

    // A word cloud: the word sent most often leads.
    await step('Next slide');
    await phone.getByTestId('qz-word').nth(0).fill('curious');
    await phone.getByTestId('qz-word').nth(1).fill('loud');
    await phone.getByTestId('qz-send').click();
    await pane.getByTestId('qz-word').nth(0).fill('Curious');
    await pane.getByTestId('qz-send').click();
    await expect(page.getByTestId('qs-word')).toHaveCount(2);
    await expect(page.getByTestId('qs-word').first()).toHaveText('curious');
    await expect(page.getByTestId('qs-word').first()).toHaveClass(/is-top/);

    // A rating.
    await step('Next slide');
    await phone.getByTestId('qz-rate').nth(4).click();
    await phone.getByTestId('qz-send').click();
    await pane.getByTestId('qz-rate').nth(3).click();
    await pane.getByTestId('qz-send').click();
    await expect(page.getByTestId('qs-scale')).toContainText('4.5');

    // Questions from the room, voted up and marked as answered.
    await step('Next slide');
    await phone.getByTestId('qz-ask').fill('When does the engine run?');
    await phone.getByRole('button', { name: 'Ask' }).click();
    await pane.getByRole('button', { name: 'Vote for: When does the engine run?' }).click();
    await expect(page.getByTestId('qs-notes')).toContainText('1 vote');
    await page.getByTestId('lq-answered').click();
    await expect(phone.getByTestId('qz-questions')).toContainText('(answered)');

    // A brainstorm: ideas, then votes, then the ideas in order.
    await step('Next slide');
    await phone.getByTestId('qz-idea').fill('A wind tunnel');
    await phone.getByRole('button', { name: 'Add' }).click();
    await pane.getByTestId('qz-idea').fill('More fossils');
    await pane.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByTestId('qs-notes').locator('li')).toHaveCount(2);
    await step('Start the vote');
    await pane.getByRole('button', { name: 'Vote for: A wind tunnel' }).click();
    await step('Show the votes');
    await expect(page.getByTestId('qs-notes').locator('li').first()).toHaveText(/A wind tunnel\s*1 vote/);
    await expect(phone.getByTestId('qz-ideas').locator('li').first()).toContainText('A wind tunnel');

    // A secret ballot: the results stay off the big screen until the answering is ended.
    await step('Next slide');
    await expect(page.getByTestId('qs-hidden')).toContainText('Answer on your phone');
    await phone.getByTestId('qz-option').nth(0).click();
    await phone.getByTestId('qz-send').click();
    await expect(page.getByTestId('qs-hidden')).toContainText('1 answer is in');
    await expect(page.getByTestId('qs-bars')).toHaveCount(0);
    await step('Show the results');
    await expect(page.getByTestId('qs-bar').first()).toContainText('1 · 100%');

    // A pin on a picture: by touch on the phone, by the arrow keys in the pane.
    await step('Next slide');
    const area = phone.getByTestId('qz-pin-area');
    const box = (await area.boundingBox()) ?? { width: 0, height: 0 };
    expect(box.width).toBeGreaterThan(200);
    await area.click({ position: { x: box.width * 0.25, y: box.height * 0.75 } });
    await phone.getByTestId('qz-send').click();
    await pane.getByTestId('qz-pin-area').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    await pane.getByTestId('qz-send').click();
    await expect(page.getByTestId('qs-pin')).toHaveCount(2);
    await expect(page.getByTestId('qs-pin').first()).toHaveAttribute('style', /left: 2[45](\.\d+)?%; top: 7[45](\.\d+)?%/);
    await expect(page.getByTestId('qs-pin').nth(1)).toHaveAttribute('style', /left: 52%; top: 48%/);

    // The wheel picks one of those who joined; phones are told once it has stopped.
    await step('Next slide');
    await expect(page.getByTestId('qs-winner')).toContainText('2 entries');
    await step('Spin the wheel');
    await expect(page.getByTestId('qs-winner')).toHaveText('Spinning…');
    await expect(phone.getByTestId('qz-winner')).toHaveText('Watch the big screen.');
    await expect(page.getByTestId('qs-winner')).toHaveText(/^(Asha|Ben)$/, { timeout: 10_000 });
    await expect(phone.getByTestId('qz-winner')).toHaveText(/The wheel stopped on (Asha|Ben)\./);

    // The leaderboard, and the end.
    await step('Next slide');
    await expect(page.getByTestId('qs-standing').first()).toContainText('Asha');
    await expect(phone.getByTestId('qz-board')).toContainText('Asha');
    await step('Finish the quiz');
    await expect(phone.getByTestId('qz-ended')).toContainText('1st place');
    await expect(pane.getByTestId('qz-ended')).toContainText('2nd place');
    await expect(page.getByTestId('qs-title')).toHaveText('Final results');

    // Results: the standings, points by hand, and what was answered, to keep.
    await page.getByRole('radio', { name: 'Results' }).click();
    await expect(page.getByTestId('lq-row')).toHaveCount(2);
    await expect(page.getByTestId('lq-row').first()).toContainText('Asha');
    const before = Number(await page.getByTestId('lq-score').nth(1).textContent());
    await page.getByTestId('lq-give').nth(1).click();
    await expect(page.getByTestId('lq-score').nth(1)).toHaveText(String(before + 10));
    await expect(pane).toBeHidden();
    await expect(page.getByTestId('lq-outcome')).toHaveCount(9);
    const csv = (await download(page, () => page.getByTestId('lq-csv').click())).toString();
    expect(csv.split('\r\n')[0]).toContain('Place,Name,Score,Right,Answered,Which gallery first?,Which planet has the shortest day?,Points,Seconds');
    expect(csv).toMatch(/1,Asha,\d+,2,2,Space,Jupiter,\d+,[\d.]+,co2/);
    const report = JSON.parse((await download(page, () => page.getByTestId('lq-json').click())).toString());
    expect(report).toMatchObject({ kind: 'benchtop-quiz-results', title: 'Gallery quiz', code, ended: true });
    expect(report.slides[5].questions).toEqual([{ text: 'When does the engine run?', by: 'Asha', votes: 1, answered: true }]);

    // Closing the session cuts the devices off; the results stay until the next session.
    await page.getByRole('radio', { name: 'Present (live)' }).click();
    await page.getByTestId('lq-stop').click();
    await page.getByTestId('lq-stop').click();
    await expect(page.getByTestId('lq-start-panel')).toBeVisible();
    await page.getByRole('radio', { name: 'Results' }).click();
    await expect(page.getByTestId('lq-row')).toHaveCount(2);
    expect(phoneProblems).toEqual([]);
    await phone.close();
  },
  'instrument-panel': async (page, tool) => {
    // The sample panel, not yet connected: its controls wait.
    await expect(tool).toHaveAttribute('data-state', 'idle');
    const widgets = page.getByTestId('ip-widget');
    await expect(widgets).toHaveCount(8);
    await expect(page.getByRole('slider')).toBeDisabled();
    await expect(page.getByRole('img', { name: 'Temperature: no value yet, on a dial from 0 to 50' })).toBeVisible();
    // The pretend device sends readings: the dial, the bar and the read-out show them.
    await page.getByTestId('ip-connect').click();
    await expect(tool).toHaveAttribute('data-state', 'running');
    await expect(page.getByRole('img', { name: /^Temperature: 3\d\.\d °C, at or over its limit, on a dial from 0 to 50$/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Humidity: \d+ %, on a bar from 0 to 100$/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Light: \d+$/ })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Fan running: off' })).toBeVisible();
    await expect(page.getByTestId('ip-status')).toContainText('lines of readings so far');
    // The slider and the switch send their commands, and the device's readings answer.
    await page.getByRole('slider').fill('255');
    await expect(page.getByTestId('ip-log')).toContainText('→ FAN 255');
    await expect(page.getByRole('img', { name: 'Fan running: on' })).toBeVisible();
    await page.getByRole('switch', { name: 'Lamp' }).check();
    await expect(page.getByTestId('ip-log')).toContainText('→ LED 1');
    await expect(page.getByRole('img', { name: /^Light: [89]\d\d$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Reset the box' }).click();
    await expect(page.getByTestId('ip-log')).toContainText('← # reset');
    await expect(page.getByRole('img', { name: 'Fan running: off' })).toBeVisible();
    // Editing: a new read-out takes a value the device sends and no widget shows yet.
    await page.getByTestId('ip-edit').click();
    await expect(page.getByTestId('ip-add')).toContainText('The device also sends: led');
    await page.getByTestId('ip-add-number').click();
    await expect(widgets).toHaveCount(9);
    await expect(widgets.nth(8).getByRole('img', { name: /^led: 0\.0$/ })).toBeVisible();
    const editor = widgets.nth(8);
    await editor.getByLabel('Title').fill('Lamp state');
    await editor.getByLabel('Decimals').fill('0');
    await editor.getByLabel('Decimals').blur();
    await expect(editor.getByRole('img', { name: 'Lamp state: 0' })).toBeVisible();
    // It can be moved and removed.
    await editor.getByRole('button', { name: 'Move Lamp state earlier' }).click();
    await expect(widgets.nth(7).getByRole('heading')).toHaveText('Lamp state');
    await widgets.nth(7).getByRole('button', { name: 'Remove' }).click();
    await expect(widgets).toHaveCount(8);
    // The panel is saved as a file and opens again; a file that is not a panel is refused.
    await page.getByTestId('ip-title').fill('My box');
    await page.getByTestId('ip-title').blur();
    const saved = JSON.parse((await download(page, () => page.getByTestId('ip-save').click())).toString('utf8'));
    expect(saved).toMatchObject({ kind: 'benchtop-panel', version: 1, title: 'My box' });
    expect(saved.widgets).toHaveLength(8);
    expect(saved.widgets[0]).toMatchObject({ kind: 'gauge', channel: 'temp', limit: 30 });
    saved.title = 'Opened again';
    saved.widgets = saved.widgets.slice(0, 3);
    await chooseFiles(page, page.getByTestId('ip-open'), [{ name: 'box.panel.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) }]);
    await expect(page.getByTestId('ip-title')).toHaveValue('Opened again');
    await expect(widgets).toHaveCount(3);
    await chooseFiles(page, page.getByTestId('ip-open'), [{ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"kind":"something"}') }]);
    await expect(page.locator('.toast').filter({ hasText: 'not a Benchtop instrument panel' }).first()).toBeVisible();
    // The sample comes back after a second click, and the example sketch is offered.
    await page.getByTestId('ip-sample').click();
    await page.getByTestId('ip-sample').click();
    await expect(widgets).toHaveCount(8);
    const sketch = (
      await download(page, async () => {
        await page.locator('.ip-help summary').click();
        await page.getByTestId('ip-sketch').click();
      })
    ).toString('utf8');
    expect(sketch).toContain('Serial.begin(115200)');
    await page.getByTestId('ip-disconnect').click();
    await expect(page.getByTestId('ip-status')).toHaveText('Not connected.');
  },
  'logic-analyser': async (page, tool) => {
    await expect(tool).toHaveAttribute('data-state', 'idle');
    await page.getByTestId('la-demo').click();
    await expect(page.getByTestId('la-info')).toContainText('8 lines');
    await expect(page.getByTestId('la-info')).toContainText('at 4 MHz');
    // The demo's three decoders read its traffic.
    const rows = page.getByTestId('la-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('Write to 0x3C');
    await expect(rows.nth(0)).toContainText('00 AF');
    await expect(rows.nth(1)).toContainText('Read from 0x48');
    await expect(rows.nth(2)).toContainText('9F 00 00 00');
    await expect(rows.nth(2)).toContainText('FF EF 40 18');
    await expect(rows.nth(3)).toContainText('Benchtop');
    // The PWM line is measured.
    await expect(page.getByTestId('la-line').nth(7)).toContainText('1 kHz');
    await expect(page.getByTestId('la-line').nth(7)).toContainText('25 %');
    // The waveforms are drawn: more than a background and a line colour.
    const colours = () =>
      page.getByTestId('la-canvas').evaluate((el) => {
        const canvas = el as HTMLCanvasElement;
        const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? new Uint8ClampedArray(0);
        const seen = new Set<number>();
        for (let i = 0; i < data.length; i += 4 * 53) seen.add(((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number));
        return seen.size;
      });
    expect(await colours()).toBeGreaterThan(4);
    // A row's time shows it in the waveforms, between the two cursors.
    await rows.nth(2).getByRole('button').click();
    await expect(page.getByTestId('la-cursors')).toContainText('A 1.08 ms');
    await expect(page.getByTestId('la-cursors')).toContainText('B − A');
    const showing = () => page.getByTestId('la-cursors').locator('.tone-muted').textContent();
    const zoomedIn = await showing();
    await page.getByTestId('la-fit').click();
    await expect.poll(showing).toBe('Showing 0 s to 2.905 ms');
    expect(zoomedIn).not.toBe('Showing 0 s to 2.905 ms');
    // The keyboard zooms and moves the view; a click sets cursor A.
    await page.getByTestId('la-canvas').focus();
    await page.keyboard.press('+');
    await expect.poll(showing).not.toBe('Showing 0 s to 2.905 ms');
    await page.keyboard.press('Home');
    await expect.poll(showing).toBe('Showing 0 s to 2.905 ms');
    const waves = await page.getByTestId('la-canvas').boundingBox();
    if (!waves) throw new Error('The waveforms are not shown.');
    await page.getByTestId('la-canvas').click({ position: { x: waves.width * 0.5, y: 40 } });
    await expect(page.getByTestId('la-cursors')).toContainText(/^A 1\.\d+ ms/);
    // The wrong speed reads no text from the serial line; the right one does again.
    await page.getByTestId('la-baud').fill('9600');
    await page.getByTestId('la-baud').blur();
    await expect(page.getByTestId('la-table')).not.toContainText('Benchtop');
    await page.getByTestId('la-baud').fill('115200');
    await page.getByTestId('la-baud').blur();
    await expect(page.getByTestId('la-table')).toContainText('Benchtop');
    // The decoded table and the capture are saved; the capture opens again and decodes the same.
    const tableCsv = (await download(page, () => page.getByTestId('la-save-table').click())).toString('utf8');
    expect(tableCsv).toContain('Time (s),Decoder,What,Out (hex),In (hex),Text,Note');
    expect(tableCsv).toContain('I²C,Write to 0x3C,00 AF');
    const vcd = await download(page, () => page.getByTestId('la-save-vcd').click());
    expect(vcd.toString('utf8')).toContain('$var wire 1 ! SCL $end');
    await chooseFiles(page, page.getByTestId('la-open'), [{ name: 'capture.vcd', mimeType: 'text/plain', buffer: vcd }]);
    await expect(page.getByTestId('la-info')).toContainText('capture.vcd');
    await expect(rows).toHaveCount(0);
    await page.getByTestId('la-add-i2c').click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('Read from 0x48');
    await page.getByTestId('la-decoder').getByRole('button', { name: 'Remove the I²C decoder' }).click();
    await expect(rows).toHaveCount(0);
    // A table of samples has no times: it asks for the rate they were taken at.
    await chooseFiles(page, page.getByTestId('la-open'), [{ name: 'samples.csv', mimeType: 'text/csv', buffer: Buffer.from('A,B\n0,0\n1,0\n1,1\n0,1\n0,0\n') }]);
    await expect(page.getByTestId('la-info')).toContainText('2 lines');
    await expect(page.getByTestId('la-info')).toContainText('5 µs at 1 MHz');
    await page.getByTestId('la-table-rate').fill('1000');
    await page.getByTestId('la-table-rate').blur();
    await expect(page.getByTestId('la-info')).toContainText('5 ms at 1 kHz');
    // What is not a capture is refused in words.
    await chooseFiles(page, page.getByTestId('la-open'), [{ name: 'notes.vcd', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
    await expect(page.locator('.toast').filter({ hasText: 'not a VCD file' }).first()).toBeVisible();
    // A capture from a device: the Logic Probe firmware in an emulated Arduino Uno, with the demo's signals on its pins.
    await page.getByTestId('la-device-open').click();
    await page.getByTestId('la-connect').click();
    await expect(page.getByTestId('la-found')).toContainText('Benchtop Logic Probe 1.0, 6 lines, 1,536 samples, up to 2 MHz', { timeout: 30_000 });
    // Start at an I²C start: the clock (pin 8) high and the data line (pin 9) low.
    await page.getByTestId('la-trigger-0').selectOption('high');
    await page.getByTestId('la-trigger-1').selectOption('low');
    await page.getByTestId('la-capture').click();
    await expect(page.getByTestId('la-info')).toContainText('Benchtop Logic Probe, 1 MHz · 6 lines', { timeout: 30_000 });
    await page.getByTestId('la-add-i2c').click();
    await expect(page.getByTestId('la-table')).toContainText('Read from 0x48');
    await page.getByTestId('la-disconnect').click();
    await expect(page.getByTestId('la-connect')).toBeVisible();
    const sketch = (
      await download(page, async () => {
        await page.locator('.la-help summary').click();
        await page.getByTestId('la-sketch').click();
      })
    ).toString('utf8');
    expect(sketch).toContain('Benchtop Logic Probe 1.0');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'print-studio': async (page, tool) => {
    // Colour: the sample picture as the press profile that ships with the app prints it.
    await expect(page.getByTestId('pp-profile')).toContainText('Benchtop Coated FOGRA39L', { timeout: 30_000 });
    await page.getByTestId('pp-sample').click();
    await expect(page.getByTestId('pp-info')).toContainText('1200 × 800 px');
    await expect(page.getByTestId('pp-outside')).toHaveText(/^\d+ % of the picture$/);
    const percent = async (id: string) => Number.parseInt((await page.getByTestId(id).textContent()) ?? '', 10);
    // The profile keeps to 300 % ink, and the sample's strong colours are beyond any press.
    expect(await percent('pp-most')).toBeGreaterThan(240);
    expect(await percent('pp-most')).toBeLessThanOrEqual(300);
    await expect(page.getByTestId('pp-over')).toHaveText('0 % of the picture');
    expect(await percent('pp-outside')).toBeGreaterThan(20);
    const pixel = (x: number, y: number) =>
      page.getByTestId('pp-canvas').evaluate(
        (el, at) => {
          const canvas = el as HTMLCanvasElement;
          return [...(canvas.getContext('2d')?.getImageData(Math.round(at.x * canvas.width), Math.round(at.y * canvas.height), 1, 1).data ?? [])];
        },
        { x, y },
      );
    // Three places in the sample: a square of the screen's pure green, and the light and dark ends of the grey ramp.
    const green = [0.2675, 0.731] as const;
    const light = [0.955, 0.929] as const;
    const dark = [0.04, 0.929] as const;
    const view = (name: string) => page.getByTestId('pp-view').selectOption(name);
    // As it prints, the green is duller; on screen it is as it was drawn.
    await expect.poll(async () => (await pixel(...green))[0]).toBeGreaterThan(40);
    expect((await pixel(...green))[1]).toBeLessThan(215);
    await view('original');
    await expect.poll(() => pixel(...green)).toEqual([0, 255, 0, 255]);
    // Out of reach: painted over, while a light grey that prints as it is stays.
    await view('outside');
    await expect
      .poll(async () => {
        const [r = 0, g = 0, b = 0] = await pixel(...green);
        return r > 170 && g < 90 && b > 120;
      })
      .toBe(true);
    expect((await pixel(...light))[1]).toBeGreaterThan(240);
    await expect(page.getByTestId('pp-legend')).toContainText('ΔE away');
    // Total ink: paper where there is none, darker with more.
    await view('coverage');
    await expect.poll(async () => (await pixel(...dark))[0]).toBeLessThan(80);
    expect((await pixel(...light))[0]).toBeGreaterThan(240);
    // The black plate: full where the picture is black, and empty in the pure green.
    await view('black');
    await expect.poll(async () => (await pixel(...dark))[0]).toBeLessThan(30);
    expect(await pixel(...green)).toEqual([255, 255, 255, 255]);
    // The inks under the pointer.
    const canvasBox = await page.getByTestId('pp-canvas').boundingBox();
    if (!canvasBox) throw new Error('The picture is not shown.');
    await page.getByTestId('pp-canvas').hover({ position: { x: canvasBox.width * green[0], y: canvasBox.height * green[1] } });
    await expect(page.getByTestId('pp-readout')).toContainText('Screen R 0 G 255 B 0');
    await expect(page.getByTestId('pp-readout')).toContainText('out of the press’s reach');
    // A stricter ink limit finds places over it.
    await page.getByTestId('pp-limit').fill('200');
    await page.getByTestId('pp-limit').blur();
    await expect(page.getByTestId('pp-over')).not.toHaveText('0 % of the picture');
    await page.getByTestId('pp-limit').fill('300');
    await page.getByTestId('pp-limit').blur();
    // The whole picture as a CMYK TIFF with the profile inside.
    const tiffBytes = await download(page, () => page.getByTestId('pp-save-tiff').click());
    const tiff = readTiff(new Uint8Array(tiffBytes));
    expect(tiff).toMatchObject({ width: 1200, height: 800, channels: 4, dpi: 300 });
    expect(tiff.profile?.length).toBe(706_560);
    expect(tiff.data.length).toBe(1200 * 800 * 4);
    const inkAt = (x: number, y: number) => [0, 1, 2, 3].map((d) => Math.round((tiff.data[(y * 1200 + x) * 4 + d] as number) / 2.55));
    // The pure green: cyan and yellow, no magenta and no black.
    const [c = 0, m = 0, yellow = 0, k = 0] = inkAt(321, 585);
    expect(c).toBeGreaterThan(60);
    expect(m).toBeLessThan(5);
    expect(yellow).toBeGreaterThan(95);
    expect(k).toBeLessThan(5);
    await expect(page.getByTestId('pp-saved')).toContainText('sample-cmyk.tif');
    // As a PDF: the inks as they are, at the size the resolution gives, and the profile as output intent.
    const cmykPdf = await PDFDocument.load(await download(page, () => page.getByTestId('pp-save-pdf').click()));
    expect(cmykPdf.getPage(0).getSize().width).toBeCloseTo((1200 / 300) * 72, 3);
    expect(cmykPdf.catalog.lookup(PDFName.of('OutputIntents'))).toBeDefined();
    // The proof as an ordinary picture.
    const proofPng = await download(page, () => page.getByTestId('pp-save-proof').click());
    expect(proofPng.subarray(1, 4).toString()).toBe('PNG');
    expect(proofPng.readUInt32BE(16)).toBe(1200);
    // Another way of converting: the figures follow.
    await page.getByTestId('pp-intent').selectOption('perceptual');
    await expect(page.getByTestId('pp-bpc')).toBeDisabled();
    await expect(page.getByTestId('pp-most')).toHaveText(/^\d+ %$/);
    // A profile that will not do is refused, and the one in use stays.
    await chooseFiles(page, page.getByTestId('pp-load-profile'), [{ name: 'not-a-profile.icc', mimeType: 'application/vnd.iccprofile', buffer: Buffer.alloc(400) }]);
    await expect(page.locator('.toast').filter({ hasText: 'not an ICC profile' }).first()).toBeVisible();
    await expect(page.getByTestId('pp-profile')).toContainText('Benchtop Coated FOGRA39L');

    // Marks: the sample leaflet says where its trim is.
    await page.getByRole('radio', { name: 'Printer’s marks' }).click();
    await page.getByTestId('pm-sample').click();
    await expect(page.getByTestId('pm-found')).toContainText('148 × 210 mm');
    await expect(page.getByTestId('pm-trim')).toHaveText('148 × 210 mm');
    // 3 mm of bleed and 14 mm for the marks on every side.
    await expect(page.getByTestId('pm-sheet')).toHaveText('182 × 244 mm');
    await expect(page.getByTestId('pm-preview')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('pm-next').click();
    await expect(page.getByTestId('pm-page')).toHaveText('Page 2 of 2');
    // More bleed than the pages have is said.
    await page.getByTestId('pm-bleed').fill('5');
    await expect(page.getByTestId('pm-short')).toContainText('3 mm of bleed, less than the 5 mm');
    await expect(page.getByTestId('pm-sheet')).toHaveText('186 × 248 mm');
    await page.getByTestId('pm-bleed').fill('3');
    await expect(page.getByTestId('pm-short')).toHaveCount(0);
    await expect(page.getByTestId('pm-sheet')).toHaveText('182 × 244 mm');
    const marked = await PDFDocument.load(await download(page, () => page.getByTestId('pm-save').click()));
    expect(marked.getPageCount()).toBe(2);
    const mmOf = (points: number) => Math.round((points / 72) * 25.4 * 10) / 10;
    expect(mmOf(marked.getPage(0).getSize().width)).toBe(182);
    const trimBox = marked.getPage(0).getTrimBox();
    expect([trimBox.x, trimBox.y, trimBox.width, trimBox.height].map(mmOf)).toEqual([17, 17, 148, 210]);

    // Nesting: the sample job on SRA3, then on larger paper and on a roll.
    await page.getByRole('radio', { name: 'Nesting' }).click();
    await page.getByTestId('pn-sample').click();
    await expect(page.getByTestId('pn-summary')).toContainText('50 pieces on 4 sheets');
    await expect(page.getByTestId('pn-placed')).toHaveText('50 of 50');
    await expect(page.getByTestId('pn-sheet')).toHaveCount(4);
    await page.getByTestId('pn-paper').selectOption('sra2');
    await expect(page.getByTestId('pn-summary')).toContainText('50 pieces on 2 sheets');
    await page.getByTestId('pn-paper').selectOption('roll');
    await expect(page.getByTestId('pn-summary')).toContainText('m of the roll');
    await expect(page.getByTestId('pn-sheet')).toHaveCount(1);
    await page.getByTestId('pn-paper').selectOption('sra3');
    await expect(page.getByTestId('pn-summary')).toContainText('50 pieces on 4 sheets');
    // A picture becomes a piece with its artwork, and a piece too large for the sheet is left out and named.
    await chooseFiles(page, page.getByTestId('pn-files'), [{ name: 'label.png', mimeType: 'image/png', buffer: SAMPLE_PNG }]);
    await expect(page.getByTestId('pn-piece')).toHaveCount(6);
    await expect(page.getByTestId('pn-piece').nth(5)).toContainText('picture');
    await page.getByTestId('pn-add').click();
    const last = page.getByTestId('pn-piece').nth(6);
    await last.getByRole('textbox').fill('Banner');
    await last.getByRole('spinbutton').first().fill('900');
    await last.getByRole('spinbutton').first().blur();
    await expect(page.getByTestId('pn-left')).toContainText('1 × Banner');
    await expect(page.getByTestId('pn-placed')).toHaveText('51 of 52');
    const nested = await PDFDocument.load(await download(page, () => page.getByTestId('pn-save').click()));
    expect(nested.getPageCount()).toBe(4);
    expect(mmOf(nested.getPage(0).getSize().width)).toBe(320);
    const cuts = (await download(page, () => page.getByTestId('pn-list').click())).toString('utf8');
    expect(cuts).toContain('Sheet,Piece,Copy,X (mm),Y (mm),Width (mm),Height (mm),Turned');
    expect(cuts.trim().split('\r\n')).toHaveLength(52);
    expect(cuts).toContain('Business card');

    // The sheet planner: A5 leaflets on a B2 press.
    await page.getByRole('radio', { name: 'Sheet planner' }).click();
    await expect(page.getByTestId('ps-summary')).toContainText('8 to a sheet of SRA2; buy 132 sheets');
    await expect(page.getByTestId('ps-up')).toHaveText('8');
    await expect(page.getByTestId('ps-buy')).toHaveText('132');
    await expect(page.getByTestId('ps-picture').locator('.pn-piece')).toHaveCount(8);
    // Twice the copies, twice the paper.
    await page.getByTestId('ps-quantity').fill('2000');
    await page.getByTestId('ps-quantity').blur();
    await expect(page.getByTestId('ps-buy')).toHaveText('263');
    // With a price on two papers the cheaper job comes first, and unpriced papers after them.
    const costs = page.getByTestId('ps-cost');
    await costs.nth(1).fill('10');
    await costs.nth(1).blur();
    await costs.nth(2).fill('15');
    await costs.nth(2).blur();
    await expect(page.getByTestId('ps-summary')).toContainText('SRA1 cut into 2; buy 132 sheets, 1,980 in paper');
    await expect(page.getByTestId('ps-cost-total')).toContainText('1,980');
    await expect(page.getByTestId('ps-plan').nth(1)).toContainText('2,630');
    // Another way is chosen from the list, and its picture and figures follow.
    await page.getByTestId('ps-plan').nth(1).getByRole('radio').check();
    await expect(page.getByTestId('ps-buy')).toHaveText('263');
    await expect(page.getByTestId('ps-cut')).toContainText('none');
    // A grain that must run along the piece's width forbids the layout that turned every piece.
    await page.getByTestId('ps-grain').selectOption('height');
    await expect(page.getByTestId('ps-turn')).toBeDisabled();
    await expect(page.getByTestId('ps-caption')).toContainText('grain');
    await page.getByTestId('ps-grain').selectOption('any');
    // A piece no paper can take is explained.
    await page.getByTestId('ps-width').fill('2000');
    await page.getByTestId('ps-width').blur();
    await expect(page.getByTestId('ps-empty')).toContainText('needs a sheet of at least');
    await page.getByTestId('ps-width').fill('148');
    await page.getByTestId('ps-width').blur();
    // Artwork of the wrong size is not placed; the sheet is saved with outlines.
    await chooseFiles(page, page.getByTestId('ps-art'), [await pdfFile('a4.pdf', 1)]);
    await expect(page.getByTestId('ps-art-note')).toContainText('is not placed');
    const pressSheet = await PDFDocument.load(await download(page, () => page.getByTestId('ps-save').click()));
    expect(pressSheet.getPageCount()).toBe(1);
    expect([mmOf(pressSheet.getPage(0).getSize().width), mmOf(pressSheet.getPage(0).getSize().height)].sort((a, b) => a - b)).toEqual([450, 640]);
    // What was set is kept when a part is left and come back to.
    await page.getByRole('radio', { name: 'Colour and proof' }).click();
    await expect(page.getByTestId('pp-info')).toContainText('sample.png');
    await expect(tool).toHaveAttribute('data-part', 'colour');
  },
  'chemistry-solver': async (page, tool) => {
    // The permanganate example balances as the tool opens, with the redox described.
    await expect(tool).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('cx-answer').locator('svg')).toBeVisible();
    await expect(page.getByTestId('cx-check')).toContainText('every element balances');
    await expect(page.getByTestId('ch-redox')).toContainText('Mn: +7 in KMnO₄ → +2 in MnCl₂, reduced');
    await expect(page.getByTestId('ch-redox')).toContainText('10 electrons');
    // Redox in acidic solution adds water and H⁺.
    await page.getByTestId('ch-equation').fill('MnO4^- + Fe^2+ -> Mn^2+ + Fe^3+');
    await page.getByRole('radio', { name: 'Acidic solution' }).click();
    await expect(page.getByTestId('cx-steps')).toContainText('H⁺ goes on the left');
    await expect(page.getByTestId('cx-table')).toContainText('Charge');
    // Stoichiometry: the limiting reagent and the yield.
    await page.getByRole('radio', { name: 'Stoichiometry' }).click();
    await page.getByTestId('ch-example').selectOption({ label: 'Ammonia from 28 g N₂ and 10 g H₂' });
    await expect(page.getByTestId('cx-table')).toContainText('N₂ (limiting)');
    await expect(page.getByTestId('cx-answer')).toBeVisible();
    await expect(page.getByTestId('cx-steps')).toContainText('Percent yield');
    // Oxidation states of a complex.
    await page.getByRole('radio', { name: 'Oxidation states' }).click();
    await page.getByTestId('ch-species').fill('K4[Fe(CN)6]');
    await expect(page.getByTestId('cx-table')).toContainText('Fe+2');
    // pH of a weak acid with its distribution graph.
    await page.getByRole('radio', { name: 'pH', exact: true }).click();
    await page.getByTestId('ch-example').selectOption({ label: '0.1 M acetic acid' });
    await expect(page.getByTestId('cx-table')).toContainText('2.88');
    await expect(page.getByTestId('cx-graph').locator('path')).toHaveCount(2);
    // A titration curve with its equivalence point.
    await page.getByRole('radio', { name: 'Titration' }).click();
    await page.getByTestId('ch-example').selectOption({ label: 'Acetic acid with NaOH' });
    await expect(page.getByTestId('cx-check')).toContainText('Phenolphthalein');
    await expect(page.getByTestId('cx-graph')).toContainText('equivalence');
    // Every example of every kind solves.
    for (const mode of ['Balance', 'Stoichiometry', 'Formula', 'Oxidation states', 'pH', 'Equilibrium', 'Kinetics', 'Titration', 'Cells', 'Gases', 'Solutions']) {
      await page.getByRole('radio', { name: mode, exact: true }).click();
      const labels = (await page.getByTestId('ch-example').locator('option').allTextContents()).filter((l) => !l.startsWith('Choose'));
      expect(labels.length, mode).toBeGreaterThan(1);
      for (const label of labels) {
        await page.getByTestId('ch-example').selectOption({ label });
        await expect(tool, `${mode}: ${label}`).toHaveAttribute('data-state', 'done');
        await expect(page.getByTestId('cx-error'), `${mode}: ${label}`).toHaveCount(0);
      }
    }
    // A cell responds to concentrations.
    await page.getByRole('radio', { name: 'Cells', exact: true }).click();
    await page.getByTestId('ch-example').selectOption({ label: 'Daniell cell (zinc and copper)' });
    await expect(page.getByTestId('cx-answer')).toBeVisible();
    await expect(page.getByTestId('cx-table')).toContainText('1.1037 V');
    await page.getByTestId('ch-cell-Cu').fill('0.01');
    await expect(page.getByTestId('cx-table')).toContainText('1.0445 V');
    // Mistakes are explained, not thrown.
    await page.getByRole('radio', { name: 'Balance', exact: true }).click();
    await page.getByTestId('ch-equation').fill('H2 + O2 -> H2O2 + NaCl');
    await expect(page.getByTestId('cx-error')).toContainText('only one side');
    // The solution saves as a page of its own.
    await page.getByTestId('ch-equation').fill('C3H8 + O2 -> CO2 + H2O');
    await expect(tool).toHaveAttribute('data-state', 'done');
    const html = (await download(page, () => page.getByTestId('cx-save-html').click())).toString('utf8');
    expect(html).toContain('<svg');
    expect(html).not.toContain('<script');
  },
  'code-runner': async (page, tool) => {
    const run = async () => {
      await page.getByTestId('cr-run').click();
      await expect(page.getByTestId('cr-status')).toContainText(/Exited|Stopped|could not/, { timeout: 60_000 });
    };
    // Python (Pyodide) runs the first example; its first run loads the runtime.
    await run();
    await expect(page.getByTestId('cr-output')).toHaveText('Hello, World!\n');
    await expect(page.getByTestId('cr-status')).toContainText('Exited with code 0');
    // Input comes from the stdin box.
    await page.getByTestId('cr-example').selectOption({ label: 'Read input' });
    await expect(page.getByTestId('cr-stdin')).toHaveValue('Ada\n3 4 5\n');
    await run();
    await expect(page.getByTestId('cr-output')).toHaveText('Hello, Ada!\nSum: 12 Largest: 5\n');
    // An error shows the traceback, and its line is marked in the editor.
    const editor = page.getByTestId('cr-editor').locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('x = 1\ny = x / 0\n');
    await run();
    await expect(page.getByTestId('cr-output')).toContainText('ZeroDivisionError');
    await expect(page.getByTestId('cr-output')).toContainText('line 2');
    await expect(page.getByTestId('cr-status')).toContainText('code 1');
    await expect(page.getByTestId('cr-editor').locator('.cm-error-line')).toHaveText('y = x / 0');
    // Ctrl+Enter runs too; the standard library is there.
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('import json, math, statistics\nprint(json.dumps({"pi": round(math.pi, 3), "mean": statistics.mean([1, 2, 3, 4])}))\n');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByTestId('cr-output')).toHaveText('{"pi": 3.142, "mean": 2.5}\n', { timeout: 30_000 });
    // JavaScript, TypeScript, Lua and both SQL engines.
    const cases: [string, string, string][] = [
      ['javascript', 'Read input (readline)', 'Hello, Ada!\nSum: 12 Largest: 5\n'],
      ['typescript', 'Interfaces and generics', '{ x: 0, y: 5 }\n'],
      ['lua', 'Read input', 'Hello, Ada! Sum: 12\n'],
      ['sqlite', 'Tables and a join', 'Meera'],
      ['duckdb', 'Lists and structs', '(2 rows)'],
    ];
    for (const [language, example, expected] of cases) {
      await page.getByTestId('cr-language').selectOption(language);
      await page.getByTestId('cr-example').selectOption({ label: example });
      await run();
      await expect(page.getByTestId('cr-status'), language).toContainText('Exited with code 0');
      await expect(page.getByTestId('cr-output'), language).toContainText(expected);
    }
    // A program that never ends is stopped at the time limit.
    await page.getByTestId('cr-language').selectOption('javascript');
    await page.getByTestId('cr-timeout').selectOption('5');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText("console.log('start');\nwhile (true) {}\n");
    await run();
    await expect(page.getByTestId('cr-status')).toContainText('Stopped after 5 s');
    await expect(page.getByTestId('cr-output')).toHaveText('start\n');
    // Stop ends a run early.
    await page.getByTestId('cr-timeout').selectOption('60');
    await page.getByTestId('cr-run').click();
    await expect(page.getByTestId('cr-stop')).toBeEnabled();
    await page.getByTestId('cr-stop').click();
    await expect(page.getByTestId('cr-status')).toHaveText('Stopped.');
    // Compiled languages need the desktop app.
    await page.getByTestId('cr-language').selectOption('c');
    await expect(page.getByTestId('cr-hint')).toContainText('needs the Benchtop desktop app');
    await expect(page.getByTestId('cr-run')).toBeDisabled();
    await expect(page.getByTestId('cr-editor').locator('.cm-content')).toContainText('printf');
    // The code is saved as a file of its own.
    const saved = (await download(page, () => page.getByTestId('cr-save').click())).toString('utf8');
    expect(saved).toContain('#include <stdio.h>');
    await expect(tool).toBeVisible();
  },
  'calculus-solver': async (page, tool) => {
    // The product-rule example is worked as the tool opens, typeset by MathJax and checked.
    await expect(tool).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('cx-answer').locator('svg')).toBeVisible();
    await expect(page.getByTestId('cx-check')).toContainText('Checked');
    await expect(page.getByTestId('cx-steps')).toContainText('Product rule');
    await expect(page.getByTestId('cx-graph').locator('path')).toHaveCount(2);
    // An improper integral with steps; a divergent one says so.
    await page.getByRole('radio', { name: 'Integral', exact: true }).click();
    await page.getByRole('radio', { name: 'Definite', exact: true }).click();
    await page.getByTestId('cx-expr').fill('e^(-x)');
    await page.getByTestId('cx-a').fill('0');
    await page.getByTestId('cx-b').fill('inf');
    await expect(page.getByTestId('cx-steps')).toContainText('improper integral');
    await expect(page.getByTestId('cx-answer')).toHaveAttribute('data-ok', 'yes');
    await page.getByTestId('cx-expr').fill('1/x^2');
    await page.getByTestId('cx-a').fill('-1');
    await page.getByTestId('cx-b').fill('1');
    await expect(page.getByTestId('cx-answer')).toHaveAttribute('data-ok', 'no');
    await expect(page.getByTestId('cx-steps')).toContainText('infinite inside the range');
    // A limit by L’Hôpital’s rule.
    await page.getByRole('radio', { name: 'Limit', exact: true }).click();
    await page.getByTestId('cx-example').selectOption({ label: '(1 − cos x)/x² at 0' });
    await expect(page.getByTestId('cx-steps')).toContainText('L’Hôpital');
    await expect(page.getByTestId('cx-check')).toContainText('Agrees with the values');
    // Extrema in a table; Riemann rectangles on the graph.
    await page.getByRole('radio', { name: 'Extrema' }).click();
    await page.getByTestId('cx-example').selectOption({ label: 'Cubic: x³ − 3x' });
    await expect(page.getByTestId('cx-table')).toContainText('Local maximum');
    await page.getByRole('radio', { name: 'Riemann sums' }).click();
    await page.getByTestId('cx-example').selectOption({ label: 'x² on [0, 1]' });
    await expect(page.getByTestId('cx-graph').locator('.cx-rect')).toHaveCount(8);
    await expect(page.getByTestId('cx-riemann')).toContainText('integral 0.33333333');
    // Differential equations, exact and numerical.
    await page.getByRole('radio', { name: 'Differential equation' }).click();
    await page.getByTestId('cx-example').selectOption({ label: 'Oscillator: y″ + y = 0' });
    await expect(page.getByTestId('cx-steps')).toContainText('characteristic equation');
    await page.getByTestId('cx-example').selectOption({ label: 'Logistic: y′ = y(1 − y)' });
    await expect(page.getByTestId('cx-table')).toBeVisible();
    // Every example of every kind solves without an error.
    for (const mode of ['Derivative', 'Integral', 'Limit', 'Taylor series', 'Extrema', 'Tangent', 'Differential equation', 'Riemann sums']) {
      await page.getByRole('radio', { name: mode, exact: true }).click();
      const labels = (await page.getByTestId('cx-example').locator('option').allTextContents()).filter((l) => !l.startsWith('Choose'));
      for (const label of labels) {
        await page.getByTestId('cx-example').selectOption({ label });
        await expect(tool, `${mode}: ${label}`).toHaveAttribute('data-state', 'done');
        await expect(page.getByTestId('cx-error'), `${mode}: ${label}`).toHaveCount(0);
      }
    }
    // A mistake in the formula is reported, not thrown.
    await page.getByRole('radio', { name: 'Derivative', exact: true }).click();
    await page.getByTestId('cx-expr').fill('x^^2');
    await expect(page.getByTestId('cx-error')).toContainText('could not be read');
    // The solution saves as a page of its own.
    await page.getByTestId('cx-expr').fill('x^3');
    await expect(tool).toHaveAttribute('data-state', 'done');
    const html = (await download(page, () => page.getByTestId('cx-save-html').click())).toString('utf8');
    expect(html).toContain('<svg');
    expect(html).toContain('Steps');
    expect(html).not.toContain('<script');
  },
  calcpad: async (page, tool) => {
    // The beam example is calculated as the tool opens, its formulas typeset by MathJax.
    await expect(page.getByTestId('cp-status')).toContainText('Calculated in');
    await expect(page.locator('.cp-paper .cp-eq svg').first()).toBeVisible();
    const values = page.locator('.cp-values-table');
    await expect(values).toContainText('R36 kN');
    await expect(values).toContainText('M_max54 kN m');
    // An input box in the report writes its value back into the worksheet.
    await page.getByTestId('cp-input').first().fill('8');
    await expect(values).toContainText('R48 kN');
    expect(await editorText(page.getByTestId('cp-editor'))).toContain('L = ?{8} m');
    // Every example calculates without problems.
    const ids = (
      await page
        .getByTestId('cp-example')
        .locator('option')
        .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))
    ).filter(Boolean);
    expect(ids.length).toBeGreaterThan(3);
    for (const id of ids) {
      await page.getByTestId('cp-example').selectOption(id);
      await expect(page.getByTestId('cp-status'), id).toContainText('Calculated in');
    }
    await page.getByTestId('cp-example').selectOption('methods');
    await expect(page.locator('.cp-figure svg')).toHaveCount(2);
    // A mistake is reported by line, and the line is highlighted in the worksheet.
    const editor = page.getByTestId('cp-editor').locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('"Check\na = 2 m\nb = a + c\nd = a*3');
    await expect(page.getByTestId('cp-status')).toContainText('1 problem');
    await expect(page.locator('.cp-error')).toContainText('c is not defined above this line');
    await expect(page.getByTestId('cp-editor').locator('.cm-error-line')).toHaveText('b = a + c');
    await expect(values).toContainText('d6 m');
    // The report saves as a page of its own, formulas and all.
    const html = (await download(page, () => page.getByTestId('cp-save-html').click())).toString('utf8');
    expect(html).toContain('<title>Check</title>');
    expect(html).toContain('<svg');
    expect(html).not.toContain('<script');
    const cpd = (await download(page, () => page.getByTestId('cp-save').click())).toString('utf8');
    expect(cpd).toBe('"Check\na = 2 m\nb = a + c\nd = a*3\n');
    // Report only: the worksheet hides, the boxes stay.
    await page.getByRole('radio', { name: 'Report only' }).click();
    await expect(page.getByTestId('cp-editor')).toHaveCount(0);
    await expect(tool).toHaveClass(/cp-report/);
  },
  'ringtone-composer': async (page, tool) => {
    const lcd = page.getByTestId('rt-lcd');
    const composer = page.getByTestId('rt-composer');
    const rtttl = page.getByTestId('rt-rtttl');
    await expect(lcd).toContainText('Ode to Joy');
    await expect(lcd).toContainText('30/30');
    // The keypad: 1 is C, 9 makes it longer, # sharp, * an octave up, 0 a rest (as long as the note before), 8 shorter.
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(lcd).toContainText('0/0');
    for (const key of ['1', '9', 'hash', 'star', '0', '8']) await page.getByTestId(`rt-key-${key}`).click();
    await expect(composer).toHaveValue('2#c2 4-');
    // Typing on the display works too; Backspace deletes the note before the cursor.
    await lcd.focus();
    await page.keyboard.type('53');
    await page.keyboard.press('Backspace');
    await expect(composer).toHaveValue('2#c2 4- 4g2');
    await expect(rtttl).toHaveValue('Ode to Joy:d=4,o=6,b=140:2c#,p,g');
    // RTTTL typed in is read at once; mistakes are explained.
    await rtttl.fill('Bad:d=4:c,x');
    await expect(page.locator('.rt-error')).toContainText('Note 2, "x"');
    await rtttl.fill('Scale:d=8,o=5,b=200:c,d,e,f,g,a,b,c6');
    await expect(lcd).toContainText('Scale');
    await expect(lcd).toContainText('8/8');
    await expect(page.getByTestId('rt-roll').locator('rect.rt-roll-note')).toHaveCount(8);
    // Examples, transposing, and the files.
    await page.getByTestId('rt-example').selectOption('fur-elise');
    await expect(rtttl).toHaveValue(/^Fur Elise:d=8,o=5,b=125:e6,d#6,e6/);
    await page.getByRole('button', { name: 'Semitone up' }).click();
    // Up a semitone, most notes are in octave 6, which becomes the default.
    await expect(rtttl).toHaveValue(/^Fur Elise:d=8,o=6,b=125:f,e,f,e,f,c,d#,c#,4a#5\./);
    const wav = await download(page, () => page.getByTestId('rt-save-wav').click());
    expect(wav.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(wav.length).toBeGreaterThan(100_000);
    const midi = await download(page, () => page.getByTestId('rt-save-midi').click());
    expect(midi.subarray(0, 4).toString('latin1')).toBe('MThd');
    const text = (await download(page, () => page.getByTestId('rt-save-rtttl').click())).toString('utf8');
    expect(text.startsWith('Fur Elise:d=8,o=6,b=125:f,e,f')).toBe(true);
    // Playing and stopping.
    await page.getByTestId('rt-play').click();
    await expect(tool).toHaveAttribute('data-state', 'playing');
    await page.getByTestId('rt-play').click();
    await expect(tool).toHaveAttribute('data-state', 'idle');
  },
  kundli: async (page, tool) => {
    const person = page.getByTestId('kd-person');
    await person.getByTestId('kd-person-date').fill('2026-01-14');
    await person.getByTestId('kd-person-time').fill('15:13:00');
    await person.getByTestId('kd-person-place').selectOption('Delhi');
    const positions = page.getByTestId('kd-positions');
    // Makara Sankranti 2026 (15:13 IST by Drik Panchang): the Sun at the very end of Dhanu, the Moon in Vrishchika in Anuradha.
    await expect(positions.getByRole('row', { name: /^Sun/ })).toContainText('Dhanu (Sagittarius)29°59′');
    await expect(positions.getByRole('row', { name: /^Moon/ })).toContainText('Anuradha');
    const panchangTable = page.getByTestId('kd-panchang');
    await expect(panchangTable).toContainText('Krishna Ekadashi');
    await expect(panchangTable).toContainText('Balava');
    await expect(panchangTable).toContainText('Vikram 2082, Shaka 1947');
    // Both chart styles and the divisional chart.
    await expect(page.locator('svg.kd-chart')).toHaveCount(2);
    await expect(page.locator('svg.kd-chart').first()).toHaveAttribute('aria-label', /North Indian/);
    await page.getByRole('radio', { name: 'South Indian' }).click();
    await expect(page.locator('svg.kd-chart').first()).toHaveAttribute('aria-label', /South Indian/);
    await page.getByTestId('kd-varga').selectOption('10');
    await expect(page.locator('svg.kd-chart').nth(1)).toHaveAttribute('aria-label', /Dasamsa/);
    await expect(page.getByTestId('kd-dashas').locator('tbody tr')).toHaveCount(9);
    // Hindi names.
    await page.getByRole('radio', { name: 'हिन्दी' }).click();
    await expect(positions).toContainText('सूर्य');
    await expect(positions).toContainText('अनुराधा');
    await page.getByRole('radio', { name: 'English' }).click();
    // The report saves as a page of its own.
    const html = (await download(page, () => page.getByTestId('kd-save-html').click())).toString('utf8');
    expect(html).toContain('<svg');
    expect(html).toContain('Krishna Ekadashi');
    // Matching: the same Moon for both scores 28 of 36, with Nadi dosha.
    await page.getByRole('radio', { name: 'Matching' }).click();
    for (const who of ['kd-bride', 'kd-groom']) {
      await page.getByTestId(`${who}-date`).fill('2026-01-14');
      await page.getByTestId(`${who}-time`).fill('15:13:00');
    }
    await expect(page.getByTestId('kd-total')).toHaveText('28 / 36');
    await expect(tool).toContainText('Nadi dosha');
    // The day's panchang.
    await page.getByRole('radio', { name: 'Panchang' }).click();
    await page.getByTestId('kd-day-date').fill('2026-11-24');
    await expect(page.getByTestId('kd-panchang')).toContainText('Shukla Purnima');
  },
  paint: async (page) => {
    const status = page.getByTestId('pa-status');
    const pixel = (x: number, y: number) =>
      page.getByTestId('pa-canvas').evaluate((c, [px, py]) => Array.from((c as HTMLCanvasElement).getContext('2d')?.getImageData(px as number, py as number, 1, 1).data ?? []), [x, y]);
    const surface = page.getByTestId('pa-surface');
    const box = async () => {
      const b = await surface.boundingBox();
      if (!b) throw new Error('no canvas');
      return b;
    };
    const drag = async (x0: number, y0: number, x1: number, y1: number) => {
      const b = await box();
      await page.mouse.move(b.x + x0 + 0.5, b.y + y0 + 0.5);
      await page.mouse.down();
      await page.mouse.move(b.x + x1 + 0.5, b.y + y1 + 0.5, { steps: 6 });
      await page.mouse.up();
    };
    // A new 200 × 100 picture.
    await page.getByTestId('pa-new').click();
    await page.getByTestId('pa-dialog-width').fill('200');
    await page.getByTestId('pa-dialog-height').fill('100');
    await page.getByTestId('pa-dialog-ok').click();
    await expect(status).toContainText('Picture 200 × 100');
    // Pencil in black.
    await page.getByTestId('pa-tool-pencil').click();
    await drag(10, 10, 50, 10);
    expect(await pixel(30, 10)).toEqual([0, 0, 0, 255]);
    expect(await pixel(30, 12)).toEqual([255, 255, 255, 255]);
    // Fill in red, then undo.
    await page.getByRole('button', { name: '#ff0000' }).click();
    await page.getByTestId('pa-tool-fill').click();
    const b = await box();
    await page.mouse.click(b.x + 100.5, b.y + 50.5);
    expect(await pixel(100, 50)).toEqual([255, 0, 0, 255]);
    expect(await pixel(30, 10)).toEqual([0, 0, 0, 255]);
    await page.getByTestId('pa-undo').click();
    expect(await pixel(100, 50)).toEqual([255, 255, 255, 255]);
    // A filled rectangle takes the secondary colour inside and the primary round it.
    await page.getByTestId('pa-tool-rect').click();
    await page.getByTestId('pa-style').selectOption('both');
    await page.getByRole('button', { name: '#00ff00' }).click({ button: 'right' });
    await drag(60, 30, 120, 80);
    expect(await pixel(90, 55)).toEqual([0, 255, 0, 255]);
    expect((await pixel(61, 55))[0]).toBeGreaterThan(200);
    // Text.
    await page.getByTestId('pa-tool-text').click();
    await page.mouse.click(b.x + 130.5, b.y + 20.5);
    await page.getByTestId('pa-text').fill('Hi');
    await page.getByTestId('pa-text-done').click();
    const inked = await page.getByTestId('pa-canvas').evaluate((c) => {
      const d = (c as HTMLCanvasElement).getContext('2d')?.getImageData(130, 20, 40, 34).data ?? new Uint8ClampedArray();
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 0) > 128 && (d[i + 1] ?? 0) < 100) n++;
      return n;
    });
    expect(inked).toBeGreaterThan(10);
    // Select, crop, rotate and invert.
    await page.getByTestId('pa-tool-select').click();
    await drag(0, 0, 49, 29);
    await expect(status).toContainText('Selection 50 × 30');
    await page.getByTestId('pa-crop').click();
    await expect(status).toContainText('Picture 50 × 30');
    await page.getByTestId('pa-rotate').click();
    await expect(status).toContainText('Picture 30 × 50');
    await page.getByTestId('pa-invert').click();
    // The pencil line was black at (30, 10); rotated right it is at (19, 30); inverted it is white.
    expect(await pixel(19, 30)).toEqual([255, 255, 255, 255]);
    expect(await pixel(25, 2)).toEqual([0, 0, 0, 255]);
    const bmp = await download(page, () => page.getByTestId('pa-save-bmp').click());
    expect(bmp.subarray(0, 2).toString('latin1')).toBe('BM');
    expect(bmp.length).toBe(54 + 92 * 50);
    const png = await download(page, () => page.getByTestId('pa-save-png').click());
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  },
  'd3-editor': async (page, tool) => {
    const frame = page.frameLocator('[data-testid="d3-frame"]');
    // The bar chart reads the first sample data file.
    await expect(page.getByTestId('d3-status')).toContainText('Drawn at 760 × 440');
    await expect(frame.locator('#drawing svg rect')).toHaveCount(6);
    await expect(page.getByTestId('d3-frame')).toHaveAttribute('sandbox', 'allow-scripts');
    // Every example runs without an error.
    const names = (await page.getByTestId('d3-example').locator('option').allTextContents()).slice(1);
    expect(names.length).toBeGreaterThan(4);
    for (const name of names) {
      await page.getByTestId('d3-example').selectOption(name);
      await expect(page.getByTestId('d3-status'), name).toContainText('Drawn at');
      await expect(frame.locator('#drawing svg > *').first(), name).toBeAttached();
      await expect(page.getByTestId('d3-console').locator('.sj-error'), name).toHaveCount(0);
    }
    // d3.csv reads a data file rather than the network.
    await page.getByTestId('d3-example').selectOption('Line chart with d3.csv');
    await expect(frame.locator('#drawing svg path').first()).toBeAttached();
    // A file of one's own.
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('d3-add-file').click();
    await (await chooser).setFiles({ name: 'mine.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') });
    await expect(page.getByTestId('d3-files')).toContainText('mine.csv');
    const editor = page.getByTestId('d3-editor').locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText("console.log(files['mine.csv'][0].b + 1);\nsvg.append('circle').attr('r', 20);");
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByTestId('d3-console')).toContainText('3');
    const svg = (await download(page, () => page.getByTestId('d3-save-svg').click())).toString('utf8');
    expect(svg).toContain('<circle');
    const html = (await download(page, () => page.getByTestId('d3-save-html').click())).toString('utf8');
    expect(html).toContain('mine.csv');
    expect(html).toContain('d3js.org');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'anime-editor': async (page, tool) => {
    const frame = page.frameLocator('[data-testid="anime-frame"]');
    await expect(page.getByTestId('anime-status')).toContainText('Drawn at 760 × 440');
    await expect(frame.locator('#drawing .dot')).toHaveCount(84);
    // Every example runs without an error, and things move.
    const names = (await page.getByTestId('anime-example').locator('option').allTextContents()).slice(1);
    expect(names.length).toBeGreaterThan(4);
    for (const name of names) {
      await page.getByTestId('anime-example').selectOption(name);
      await expect(page.getByTestId('anime-status'), name).toContainText('Drawn at');
      await page.waitForTimeout(300);
      await expect(page.getByTestId('anime-console').locator('.sj-error'), name).toHaveCount(0);
    }
    await page.getByTestId('anime-example').selectOption('Timeline');
    const box = frame.locator('#drawing .box0');
    const before = await box.evaluate((el) => getComputedStyle(el).transform);
    await expect.poll(() => box.evaluate((el) => getComputedStyle(el).transform), { timeout: 10_000 }).not.toBe(before);
    // An SVG animation saves as SVG; an HTML one says to save a page.
    await page.getByTestId('anime-example').selectOption('Drawing a line');
    await expect(page.getByTestId('anime-status')).toContainText('Drawn at');
    const svg = (await download(page, () => page.getByTestId('anime-save-svg').click())).toString('utf8');
    expect(svg).toContain('<path');
    const html = (await download(page, () => page.getByTestId('anime-save-html').click())).toString('utf8');
    expect(html).toContain('createDrawable');
    expect(html).toContain('Julian Garnier');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'svgjs-editor': async (page, tool) => {
    // The first example draws as the tool opens, in a frame sealed off from the app.
    const frame = page.frameLocator('[data-testid="sj-frame"]');
    await expect(page.getByTestId('sj-status')).toContainText('Drawn at 800 × 500');
    await expect(frame.locator('#drawing svg circle')).toHaveAttribute('fill', '#f0883e');
    await expect(page.getByTestId('sj-frame')).toHaveAttribute('sandbox', 'allow-scripts');
    // Every example runs without an error.
    const names = (await page.getByTestId('sj-example').locator('option').allTextContents()).slice(1);
    expect(names.length).toBeGreaterThan(4);
    for (const name of names) {
      await page.getByTestId('sj-example').selectOption(name);
      await expect(page.getByTestId('sj-status'), name).toContainText('Drawn at');
      await expect(frame.locator('#drawing svg > *').first(), name).toBeAttached();
    }
    // Animation runs in the frame: the ball's place changes with time.
    await page.getByTestId('sj-example').selectOption('Animation');
    await expect(page.getByTestId('sj-status')).toContainText('Drawn at');
    const ball = frame.locator('#drawing svg circle').first();
    const before = await ball.getAttribute('cx');
    await expect.poll(async () => ball.getAttribute('cx'), { timeout: 10_000 }).not.toBe(before);
    // Clicks reach the drawing, and console output comes back.
    await page.getByTestId('sj-example').selectOption('Click to turn');
    await expect(page.getByTestId('sj-status')).toContainText('Drawn at');
    await frame.locator('#drawing svg rect').nth(2).click();
    await expect(page.getByTestId('sj-console')).toContainText('Tile 2 turned');
    // Code of one's own: the size follows the fields, and errors name their line.
    const editor = page.getByTestId('sj-editor').locator('.cm-content');
    const type = async (code: string) => {
      await editor.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.insertText(code);
    };
    await page.getByTestId('sj-width').fill('320');
    await page.getByTestId('sj-width').press('Enter');
    await page.getByTestId('sj-height').fill('200');
    await page.getByTestId('sj-height').press('Enter');
    await type("draw.rect(width, height).fill('#123456');\nconsole.log('size', width, height);\nconsole.warn({ ok: true });");
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByTestId('sj-status')).toContainText('Drawn at 320 × 200');
    await expect(page.getByTestId('sj-console')).toContainText('size 320 200');
    await expect(page.getByTestId('sj-console').locator('.sj-warn')).toHaveText('{"ok":true}');
    const svg = (await download(page, () => page.getByTestId('sj-save-svg').click())).toString();
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain('width="320"');
    expect(svg).toContain('fill="#123456"');
    const png = await download(page, () => page.getByTestId('sj-save-png').click());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(640);
    expect(png.readUInt32BE(20)).toBe(400);
    const html = (await download(page, () => page.getByTestId('sj-save-html').click())).toString();
    expect(html).toContain('@svgdotjs/svg.js v3');
    expect(html).toContain("draw.rect(width, height).fill('#123456');");
    // The code cannot reach the app or its storage from its frame.
    await type(
      "let seen = [];\ntry { seen.push(String(parent.document.title)); } catch (e) { seen.push('no parent'); }\ntry { localStorage.setItem('a', 'b'); seen.push('stored'); } catch (e) { seen.push('no storage'); }\nconsole.log(seen.join(', '));",
    );
    await page.getByTestId('sj-run').click();
    await expect(page.getByTestId('sj-console')).toContainText('no parent, no storage');
    // Its page forbids every connection (trying one here would log the refusal as an error).
    await expect(frame.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', /default-src 'none';.*connect-src 'none'/);
    await type('draw.circle(50);\n\nnothing.here();');
    await page.getByTestId('sj-run').click();
    await expect(page.getByTestId('sj-status')).toContainText('stopped with an error');
    await expect(page.getByTestId('sj-console').locator('.sj-error')).toContainText('nothing is not defined (line 3)');
    await expect(tool).toHaveAttribute('data-state', 'idle');
  },
  'resume-builder': async (page, tool) => {
    const frame = page.frameLocator('[data-testid="rx-frame"]');
    await expect(frame.locator('h1')).toHaveText('Meera Iyer');
    await page.getByTestId('rx-name').fill('Asha Rao');
    await expect(frame.locator('h1')).toHaveText('Asha Rao');
    const experience = page.getByTestId('rx-section-experience');
    await experience.locator('summary').click();
    await page.getByTestId('rx-add-experience').click();
    await experience.locator('.rx-items > li').last().getByLabel('Company').fill('Open Museum Lab');
    await expect(frame.locator('.section-experience')).toContainText('Open Museum Lab');
    await page.getByRole('radio', { name: 'Design' }).click();
    await page.getByTestId('rx-template-banner').click();
    await expect(frame.locator('body')).toHaveClass(/t-banner/);
    await page.getByTestId('rx-paper').selectOption('letter');
    await expect(page.getByTestId('rx-pages')).toContainText('US Letter');
    const reactive = JSON.parse((await download(page, () => page.getByTestId('rx-reactive').click())).toString());
    expect(reactive.basics.name).toBe('Asha Rao');
    expect(reactive.benchtop.template).toBe('banner');
    expect(reactive.metadata.page.format).toBe('letter');
    const jsonResume = JSON.parse((await download(page, () => page.getByTestId('rx-jsonresume').click())).toString());
    expect(jsonResume.basics.name).toBe('Asha Rao');
    expect(jsonResume.work.map((w: { name: string }) => w.name)).toContain('Open Museum Lab');
    const html = (await download(page, () => page.getByTestId('rx-html').click())).toString();
    expect(html).toContain('size: letter');
    await chooseFiles(page, page.getByTestId('rx-open'), [
      {
        name: 'lin.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ basics: { name: 'Lin Example', label: 'Designer' }, work: [{ name: 'Studio', position: 'Lead', startDate: '2020-03' }] })),
      },
    ]);
    await expect(frame.locator('h1')).toHaveText('Lin Example');
    await expect(frame.locator('.section-experience')).toContainText('Mar 2020 – Present');
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
  'karnaugh-map': async (page, tool) => {
    await page.getByRole('radio', { name: '3 variables' }).click();
    await page.getByRole('radio', { name: 'Minterms' }).click();
    await page.getByTestId('km-ones').fill('0, 1, 2, 5, 6, 7');
    await page.getByTestId('km-dcs').fill('');
    await expect(page.getByTestId('km-summary')).toContainText('6 prime implicants, 0 essential');
    expect((await page.getByTestId('km-sop').textContent())?.split('+')).toHaveLength(3);
    await page.getByRole('radio', { name: 'Expression' }).click();
    await page.getByTestId('km-expr').fill("A'B + AC + BC");
    await expect(page.getByTestId('km-sop')).toHaveText('F = A′·B + A·C');
    await expect(page.getByTestId('km-pos')).toHaveText('F = (A + B)·(A′ + C)');
    await page.getByRole('radio', { name: 'Verilog' }).click();
    await expect(page.getByTestId('km-sop')).toHaveText('F = (~A & B) | (A & C)');
    await page.getByRole('radio', { name: 'Maths' }).click();
    // Clicking a cell carries on from the expression's map.
    await page.getByTestId('km-cell-0').click();
    await expect(page.getByTestId('km-sop')).toContainText('A′·C′');
    // A′C′ wraps round the edge of the map, so it is drawn in two parts.
    await expect(page.getByTestId('km-map-0').locator('.km-group')).toHaveCount(4);
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'engine-cycles': async (page, tool) => {
    // Otto at r = 9 with γ = 1.4: η = 1 − 9^−0.4.
    await expect(page.getByTestId('ec-results')).toContainText('58.48 %');
    await expect(page.getByTestId('ec-pv').locator('.lab-dot')).toHaveCount(5);
    await page.getByTestId('ec-r').fill('12');
    await page.getByTestId('ec-r').press('Enter');
    await expect(page.getByTestId('ec-results')).toContainText('62.99 %');
    await page.getByRole('radio', { name: 'Brayton' }).click();
    await expect(page.getByTestId('ec-results')).toContainText('Back work ratio');
    await page.getByRole('radio', { name: 'Rankine' }).click();
    await expect(page.getByTestId('ec-states')).toContainText('540');
    await expect(page.getByTestId('ec-ts')).toContainText('Saturated vapour');
    await expect(page.getByTestId('ec-results')).toContainText(/Thermal efficiency\s*3\d\.\d\d %/);
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'machine-elements': async (page, tool) => {
    await expect(page.getByTestId('me-cam-results')).toContainText('Largest pressure angle');
    await expect(page.getByTestId('me-cam-scene').locator('.me-cam')).toBeVisible();
    // A small base circle with a large lift…
    await page.getByTestId('me-base').fill('8');
    await page.getByTestId('me-base').press('Enter');
    await page.getByTestId('me-lift').fill('60');
    await page.getByTestId('me-lift').press('Enter');
    // …and a steep 30° rise undercuts the cam.
    await page.getByRole('spinbutton', { name: 'Segment 1 angle in degrees' }).fill('30');
    await page.getByRole('spinbutton', { name: 'Segment 1 angle in degrees' }).press('Enter');
    await page.getByRole('spinbutton', { name: 'Segment 2 angle in degrees' }).fill('150');
    await page.getByRole('spinbutton', { name: 'Segment 2 angle in degrees' }).press('Enter');
    await expect(page.getByTestId('me-undercut')).toBeVisible();
    const dxf = (await download(page, () => page.getByRole('button', { name: 'DXF', exact: true }).click())).toString('utf8');
    expect(dxf).toContain('POLYLINE');
    await page.getByRole('radio', { name: 'Geneva drive' }).click();
    await page.getByTestId('me-slots').fill('4');
    await page.getByTestId('me-slots').press('Enter');
    await expect(page.getByTestId('me-geneva-results')).toContainText('90.0°');
    await page.getByRole('radio', { name: 'Gear trains' }).click();
    await expect(page.getByTestId('me-planet-results')).toContainText('Carrier');
    // Ring held, sun driven: ratio 1 + Zr/Zs = 4.
    await expect(page.getByTestId('me-planet-results')).toContainText('4 : 1');
    await page.getByRole('radio', { name: 'Simple and compound' }).click();
    await page.getByTestId('me-train').fill('20-40, 15-45');
    await expect(page.getByTestId('me-train-results')).toContainText('6 : 1');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'plc-ladder': async (page, tool) => {
    const press = async (address: string) => {
      await page.getByTestId(`pl-in-${address}`).hover();
      await page.mouse.down();
      await page.waitForTimeout(120);
      await page.mouse.up();
      await page.waitForTimeout(120);
    };
    // The seal-in starter: Start latches the motor, Stop drops it.
    await expect(page.getByTestId('pl-out-Q0.0')).toHaveAttribute('data-on', 'off');
    await press('I0.0');
    await expect(page.getByTestId('pl-out-Q0.0')).toHaveAttribute('data-on', 'on');
    // Power flows along the rung (lines have no height, so count them rather than test visibility).
    await expect(page.getByTestId('pl-ladder').locator('.pl-wire.is-on')).not.toHaveCount(0);
    await press('I0.1');
    await expect(page.getByTestId('pl-out-Q0.0')).toHaveAttribute('data-on', 'off');
    // Counting bottles stops the conveyor at six.
    await page.getByTestId('pl-examples').selectOption('Bottle counter');
    await expect(page.getByTestId('pl-out-Q0.1')).toHaveAttribute('data-on', 'on');
    for (let i = 0; i < 6; i++) await press('I0.0');
    await expect(page.getByTestId('pl-counter-C0')).toContainText('done');
    await expect(page.getByTestId('pl-out-Q0.0')).toHaveAttribute('data-on', 'on');
    await expect(page.getByTestId('pl-out-Q0.1')).toHaveAttribute('data-on', 'off');
    const st = (await download(page, () => page.getByRole('button', { name: 'Structured text' }).click())).toString('utf8');
    expect(st).toContain('BoxFull := C0.Q;');
    await page.getByTestId('pl-code').fill('Ghost -> Q0.0');
    await expect(page.getByTestId('pl-errors')).toContainText('Ghost');
    await expect(tool).toHaveAttribute('data-state', 'idle');
  },
  'fluid-power': async (page, tool) => {
    // The memory circuit: S1 sends the cylinder out, and it stays out after the button is let go.
    const cylinders = page.getByTestId('fp-cylinders');
    await expect(cylinders).toContainText('0 % out');
    await page.getByTestId('fp-op-b1-left').dispatchEvent('pointerdown');
    await page.waitForTimeout(300);
    await page.getByTestId('fp-op-b1-left').dispatchEvent('pointerup');
    await expect(cylinders).toContainText('100 % out', { timeout: 10_000 });
    await expect(page.getByTestId('fp-scene').locator('.fp-wire[data-live="yes"]')).not.toHaveCount(0);
    await page.getByTestId('fp-op-b2-left').dispatchEvent('pointerdown');
    await page.waitForTimeout(300);
    await page.getByTestId('fp-op-b2-left').dispatchEvent('pointerup');
    await expect(cylinders).toContainText('0 % out', { timeout: 10_000 });
    // A hydraulic press holds wherever its tandem-centre valve stops it.
    await page.getByTestId('fp-examples').selectOption('Hydraulic press (4/3 tandem centre)');
    await page.getByTestId('fp-op-v1-left').dispatchEvent('pointerdown');
    await page.waitForTimeout(700);
    await page.getByTestId('fp-op-v1-left').dispatchEvent('pointerdown');
    const held = await cylinders.textContent();
    await page.waitForTimeout(500);
    expect(await cylinders.textContent()).toBe(held);
    // Building: add a gauge and join it to the pump.
    await page.getByTestId('fp-add-gauge').click();
    await expect(page.getByTestId('fp-props')).toContainText('Pressure gauge');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'biology-lab': async (page, tool) => {
    const set = async (id: string, value: string) => {
      await page.getByTestId(id).fill(value);
      await page.getByTestId(id).press('Enter');
    };
    // r = 0.5, K = 1000: the most it can yield for ever is rK/4 = 125.
    await expect(page.getByTestId('gr-results')).toContainText('125 a year');
    await set('gr-harvest', '0.25');
    await expect(page.getByTestId('gr-results')).toContainText('Settles at500');
    await page.getByTestId('lab-tab-predator').click();
    await expect(page.getByTestId('pp-results')).toContainText('20 prey, 10 predators');
    await page.getByTestId('lab-tab-epidemic').click();
    await expect(page.getByTestId('ep-results')).toContainText('60 %');
    await set('ep-vacc', '70');
    await expect(page.getByTestId('ep-results')).toContainText('no outbreak');
    await page.getByTestId('lab-tab-enzyme').click();
    await expect(page.getByTestId('en-results')).toContainText('Fit to your data');
    await expect(page.getByTestId('en-results')).toContainText('r² =');
    // Competitive: [I] = 5, Ki = 2 makes Km 3.5 times bigger.
    await expect(page.getByTestId('en-results')).toContainText('17.5 mM');
    await page.getByTestId('lab-tab-neuron').click();
    await expect(page.getByTestId('nr-results')).not.toContainText('Action potentials0');
    await set('nr-current', '0');
    await expect(page.getByTestId('nr-results')).toContainText('Action potentials0');
    await page.getByTestId('lab-tab-diffusion').click();
    await expect(page.getByTestId('df-results')).toContainText('90 each side');
    await expect(page.getByTestId('df-results')).toContainText('into the left side');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'genetics-lab': async (page, tool) => {
    const set = async (id: string, value: string) => {
      await page.getByTestId(id).fill(value);
      await page.getByTestId(id).press('Enter');
    };
    // AaBb × AaBb gives 9 : 3 : 3 : 1.
    await expect(page.getByTestId('pn-results')).toContainText('9 : 3 : 3 : 1');
    await expect(page.getByTestId('pn-grid').locator('td')).toHaveCount(16);
    await page.getByTestId('pn-add').click();
    await expect(page.getByTestId('pn-grid').locator('td')).toHaveCount(64);
    await expect(page.getByTestId('pn-results')).toContainText('27 : 9 : 9 : 9 : 3 : 3 : 3 : 1');
    await page.getByTestId('pn-preset').selectOption('Blood groups: A (Iᴬi) × B (Iᴮi)');
    await expect(page.getByTestId('pn-phenotypes')).toContainText('blood group AB');
    await page.getByTestId('pn-preset').selectOption('Colour blindness: carrier mother × unaffected father');
    await expect(page.getByTestId('pn-phenotypes')).toContainText('son, affected');
    await page.getByTestId('lab-tab-population').click();
    await expect(page.getByTestId('pop-results')).toContainText('AA 0.25, Aa 0.5, aa 0.25');
    // A recessive lethal in a big population: A is never lost.
    await set('pop-waa', '0');
    await set('pop-size', '5000');
    await expect(page.getByTestId('pop-results')).toContainText('lost in 0');
    await set('hw-aa', '50');
    await set('hw-ab', '0');
    await set('hw-bb', '50');
    await expect(page.getByTestId('hw-results')).toContainText('does not fit');
    await page.getByTestId('lab-tab-protein').click();
    await expect(page.getByTestId('dna-results')).toContainText('MAIVMGR');
    // Base 6 (the last C of GCC) becomes A: GCA is still alanine.
    await expect(page.getByTestId('dna-results')).toContainText('silent');
    await page.getByRole('radio', { name: 'Insert' }).click();
    await expect(page.getByTestId('dna-results')).toContainText('frameshift');
    await page.getByTestId('lab-tab-chisquare').click();
    await expect(page.getByTestId('chi-results')).toContainText('0.47');
    await expect(page.getByTestId('chi-results')).toContainText('fit the ratio');
    await set('chi-obs-3', '120');
    await expect(page.getByTestId('chi-results')).toContainText('p < 0.05');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'geometry-lab': async (page, tool) => {
    const set = async (id: string, value: string) => {
      await page.getByTestId(id).fill(value);
      await page.getByTestId(id).press('Enter');
    };
    await expect(page.getByTestId('ge-results')).toContainText('= 180°');
    await page.getByTestId('ge-right').click();
    await expect(page.getByTestId('ge-results')).toContainText('right-angled');
    // Dragging a corner changes the triangle.
    const before = await page.getByTestId('ge-results').textContent();
    const corner = page.getByTestId('ge-vertex-2');
    const box = await corner.boundingBox();
    if (!box) throw new Error('no corner');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 20, { steps: 4 });
    await page.mouse.up();
    expect(await page.getByTestId('ge-results').textContent()).not.toBe(before);
    await page.getByTestId('lab-tab-polygon').click();
    await set('pg-n', '8');
    await expect(page.getByTestId('pg-results')).toContainText('135°');
    await expect(page.getByTestId('pg-results')).toContainText('1080°');
    await page.getByTestId('lab-tab-circle').click();
    await page.getByTestId('ct-theorem').selectOption('semicircle');
    await expect(page.getByTestId('ct-results')).toContainText('90°');
    await page.getByTestId('lab-tab-transform').click();
    await expect(page.getByTestId('tf-results')).toContainText('areas ×1');
    await page.getByTestId('tf-move').selectOption('enlarge');
    await set('tf-k', '-2');
    await expect(page.getByTestId('tf-results')).toContainText('areas ×4');
    await page.getByTestId('lab-tab-conic').click();
    await expect(page.getByTestId('cn-results')).toContainText('ellipse');
    await expect(page.getByTestId('cn-results')).toContainText('PF ÷ PD = 0.7');
    await set('cn-e', '1.5');
    await expect(page.getByTestId('cn-results')).toContainText('hyperbola');
    await page.getByTestId('lab-tab-unit').click();
    await set('uc-angle', '150');
    await expect(page.getByTestId('uc-results')).toContainText('−√3/2');
    await expect(page.getByTestId('uc-results')).toContainText('5π/6');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'optics-lab': async (page, tool) => {
    const set = async (id: string, value: string) => {
      await page.getByTestId(id).fill(value);
      await page.getByTestId(id).press('Enter');
    };
    // f = 10 cm, object at 25 cm: a real, inverted image 16.67 cm beyond, two-thirds the size.
    await expect(page.getByTestId('op-results')).toContainText('16.67 cm beyond the lens');
    await expect(page.getByTestId('op-results')).toContainText('real, inverted, diminished');
    await set('op-u', '5');
    await expect(page.getByTestId('op-results')).toContainText('virtual, upright, magnified');
    await expect(page.getByTestId('op-scene').locator('.op-ray.is-virtual')).not.toHaveCount(0);
    await page.getByTestId('op-element').selectOption('mirror-convex');
    await expect(page.getByTestId('op-results')).toContainText('behind the mirror');
    await page.getByTestId('lab-tab-refraction').click();
    await expect(page.getByTestId('rf-results')).toContainText('25.38°');
    await set('rf-n1', '1.5');
    await set('rf-n2', '1');
    // Past the critical angle (41.8° from glass into air) nothing gets out.
    await expect(page.getByTestId('rf-results')).toContainText('41.81°');
    await set('rf-angle', '50');
    await expect(page.getByTestId('rf-results')).toContainText('total internal reflection');
    await expect(page.getByTestId('rf-refracted')).toHaveCount(0);
    await page.getByTestId('lab-tab-prism').click();
    await page.getByTestId('pr-min').click();
    await expect(page.getByTestId('pr-results')).toContainText('Spread from violet to red');
    await page.getByTestId('lab-tab-slits').click();
    // 532 nm through slits 100 µm apart onto a screen 1 m away: fringes 5.32 mm apart.
    await expect(page.getByTestId('sl-results')).toContainText('5.32 mm');
    await page.getByRole('radio', { name: 'Grating', exact: true }).click();
    await expect(page.getByTestId('sl-results')).toContainText('Orders');
    await page.getByTestId('lab-tab-polar').click();
    await set('po-angle', '90');
    await expect(page.getByTestId('po-results')).toContainText('After polariser 2 (90°)0 %');
    // A third polariser at 45° between crossed ones lets an eighth through.
    await page.getByTestId('po-middle').check();
    await expect(page.getByTestId('po-results')).toContainText('12.5 %');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'fields-lab': async (page, tool) => {
    const set = async (id: string, value: string) => {
      await page.getByTestId(id).fill(value);
      await page.getByTestId(id).press('Enter');
    };
    // 440 Hz against 444 Hz beats four times a second, and can be heard.
    await expect(page.getByTestId('wv-results')).toContainText('4 Hz');
    await page.getByTestId('wv-play').click();
    await expect(page.getByTestId('wv-play')).toHaveText('Stop');
    await page.getByTestId('wv-play').click();
    await expect(page.getByTestId('wv-play')).toHaveText('Play');
    await page.getByRole('radio', { name: 'Standing waves' }).click();
    await set('wv-n', '2');
    await expect(page.getByTestId('wv-results')).toContainText('Harmonic 2');
    await page.getByRole('radio', { name: 'Closed pipe' }).click();
    await expect(page.getByTestId('wv-results')).toContainText('odd harmonics only');
    await page.getByRole('radio', { name: 'Doppler' }).click();
    await set('wv-vs', '400');
    await expect(page.getByTestId('wv-results')).toContainText('Shock cone');
    // The gas presses on its walls about as hard as pV = NkT says.
    await page.getByTestId('lab-tab-gas').click();
    await expect(page.getByTestId('gs-results')).not.toContainText('measuring', { timeout: 10_000 });
    const ratio = Number(/Measured ÷ ideal([0-9.]+)/.exec((await page.getByTestId('gs-results').textContent()) ?? '')?.[1]);
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.6);
    await page.getByTestId('lab-tab-field').click();
    await expect(page.getByTestId('ef-scene').locator('.ef-line')).not.toHaveCount(0);
    await page.getByTestId('ef-preset').selectOption('Like charges');
    await expect(page.getByTestId('ef-results')).toContainText('total 4 nC');
    await page.getByTestId('ef-scene').hover({ position: { x: 100, y: 60 } });
    await expect(page.getByTestId('ef-results')).toContainText('V/m');
    // 200 turns of 50 cm² in 0.2 T at 600 rpm peak at NBAω = 12.57 V.
    await page.getByTestId('lab-tab-generator').click();
    await expect(page.getByTestId('gn-results')).toContainText('12.57 V');
    await page.getByRole('radio', { name: 'Split ring (DC)' }).click();
    await expect(page.getByTestId('gn-results')).toContainText('Average (DC)');
    await page.getByTestId('lab-tab-fluids').click();
    await expect(page.getByTestId('fl-results')).toContainText('floats, 50 % under');
    await page.getByTestId('fl-material').selectOption('steel');
    await expect(page.getByTestId('fl-results')).toContainText('sinks');
    await page.getByRole('radio', { name: 'Bernoulli (Venturi)' }).click();
    await expect(page.getByTestId('fl-results')).toContainText('Speed in the throat');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'mechanics-lab': async (page, tool) => {
    const set = async (id: string, value: string) => {
      await page.getByTestId(id).fill(value);
      await page.getByTestId(id).press('Enter');
    };
    // 25 m/s at 45° in a vacuum goes v²/g = 63.73 m.
    await expect(page.getByTestId('pl-results')).toContainText('63.73 m');
    await expect(page.getByTestId('pl-path')).toHaveCount(1);
    await page.getByTestId('pl-ball').selectOption('tennis');
    await expect(page.getByTestId('pl-results')).toContainText('Without air');
    await page.getByTestId('lab-tab-pendulum').click();
    await set('pd-amplitude', '90');
    // A 90° swing takes 18 % longer than the small-swing formula says.
    await expect(page.getByTestId('pd-results')).toContainText('18 % short');
    await page.getByTestId('lab-tab-spring').click();
    await set('sp-c', '20');
    await expect(page.getByTestId('sp-results')).toContainText('critically damped');
    await page.getByTestId('lab-tab-collision').click();
    // Equal carts in an elastic collision swap velocities.
    await expect(page.getByTestId('co-results')).toContainText('After: A−1 m/s');
    await set('co-e', '0');
    await expect(page.getByTestId('co-results')).toContainText('perfectly inelastic');
    await page.getByTestId('lab-tab-orbit').click();
    await set('or-speed', '1.5');
    await expect(page.getByTestId('or-results')).toContainText('escapes');
    await page.getByTestId('lab-tab-incline').click();
    await expect(page.getByTestId('in-results')).toContainText('slides down at');
    await set('in-mus', '0.7');
    await expect(page.getByTestId('in-results')).toContainText('stays put');
    await page.getByTestId('lab-tab-machines').click();
    await expect(page.getByTestId('mc-results')).toContainText('Class 1');
    await page.getByRole('radio', { name: 'Pulleys', exact: true }).click();
    await expect(page.getByTestId('mc-results')).toContainText('277.8 N');
    await page.getByTestId('lab-tab-forces').click();
    await expect(page.getByTestId('fo-results')).toContainText('Resultant');
    await page.getByRole('button', { name: 'Add the balancing force' }).click();
    await expect(page.getByTestId('fo-results')).toContainText('the forces balance');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  'mechanism-sim': async (page, tool) => {
    const readouts = page.getByTestId('ms-readouts');
    const scene = page.getByTestId('ms-scene');
    // The opening four-bar is a crank–rocker, running, with its coupler curve drawn.
    await expect(readouts).toContainText('crank–rocker');
    await expect(readouts).toContainText('Transmission angle');
    await expect(page.getByTestId('ms-trace-C')).toHaveCount(1);
    const first = await scene.getAttribute('data-frame');
    await expect.poll(() => scene.getAttribute('data-frame')).not.toBe(first);
    await expect(page.getByTestId('ms-plot-velocity')).toBeVisible();
    // An in-line slider-crank strokes twice the crank and returns as fast as it goes.
    await page.getByTestId('ms-template').selectOption('Slider-crank (engine)');
    await expect(readouts).toContainText('B stroke');
    await expect(readouts).toContainText('140 mm');
    await expect(readouts).toContainText('1.000 (180° : 180°)');
    // The shaper's quick return is slower forward than back.
    await page.getByTestId('ms-template').selectOption('Quick return (crank and slotted lever)');
    await expect(readouts).toContainText('Time ratio');
    const ratio = Number(/Time ratio[^0-9]*([0-9.]+)/.exec((await readouts.textContent()) ?? '')?.[1]);
    expect(ratio).toBeGreaterThan(1.3);
    // Draw a four-bar from scratch: two pivots, a crank, then a chain of two bars.
    await page.getByTestId('ms-template').selectOption('Empty drawing');
    const at = async (x: number, y: number) => {
      const [cx, cy] = await scene.evaluate(
        (svg, [px, py]) => {
          const q = new DOMPoint(px, py).matrixTransform((svg as SVGSVGElement).getScreenCTM() ?? undefined);
          return [q.x, q.y];
        },
        [x, y],
      );
      await page.mouse.click(cx ?? 0, cy ?? 0);
    };
    await at(200, 250);
    await at(400, 250);
    await page.getByTestId('ms-mode-crank').click();
    await at(200, 250);
    await at(260, 250);
    await page.getByTestId('ms-mode-link').click();
    await at(260, 250);
    await at(380, 120);
    await at(400, 250);
    await page.keyboard.press('Escape');
    await expect(readouts).toContainText('0 (moves with the input)');
    await expect(readouts).toContainText('crank–rocker');
    await page.getByTestId('ms-mode-trace').click();
    await at(380, 120);
    await expect(page.getByTestId('ms-trace-J2')).toHaveCount(1);
    // Select the rocker and lengthen it.
    await page.getByTestId('ms-mode-move').click();
    await at(390, 185);
    await expect(page.getByTestId('ms-selected')).toContainText('Bar J2–G2');
    await page.getByTestId('ms-length').fill('150');
    await page.getByTestId('ms-length').press('Enter');
    await expect(readouts).toContainText('crank–rocker');
    await page.getByTestId('ms-run').click();
    const csvText = (await download(page, () => page.getByRole('button', { name: 'Motion (CSV)' }).click())).toString('utf8');
    expect(csvText.split('\n')[0]).toContain('J2 x (mm)');
    expect(csvText.split('\n').length).toBeGreaterThan(300);
    const svgText = (await download(page, () => page.getByRole('button', { name: 'Drawing (SVG)' }).click())).toString('utf8');
    expect(svgText).toContain('<svg');
    await expect(tool).toHaveAttribute('data-state', 'done');
  },
  translator: async (page) => {
    // In a browser there is no translation server to talk to: the page says why, and editing still works.
    await expect(page.getByTestId('tr-gate')).toContainText('desktop app');
    await page.getByTestId('tr-input').fill('ನಮಸ್ಕಾರ, ವಸ್ತುಸಂಗ್ರಹಾಲಯಕ್ಕೆ ಸ್ವಾಗತ.');
    await expect(page.getByTestId('tr-from').locator('option').first()).toHaveText('Detect (Kannada)');
    await expect(page.getByTestId('tr-translate')).toBeDisabled();
    // Typing in a script needs no server, so it works in a browser too.
    await page.getByTestId('tr-mode-type').click();
    await expect(page.getByTestId('tr-gate')).toHaveCount(0);
    await page.getByTestId('tr-type-input').fill('namaste, meraa naam abhiShT hai | 2026');
    await expect(page.getByTestId('tr-type-output')).toHaveValue('नमस्ते, मेरा नाम अभिष्ट है । 2026');
    await page.getByTestId('tr-type-digits').check();
    await expect(page.getByTestId('tr-type-output')).toHaveValue('नमस्ते, मेरा नाम अभिष्ट है । २०२६');
    await expect(page.getByTestId('tool')).toHaveAttribute('data-state', 'done');
  },
  'asset-finder': async (page) => {
    // In a browser the libraries cannot be searched: the page says why, without touching the network.
    await expect(page.getByTestId('af-gate')).toContainText('desktop app');
    await expect(page.getByTestId('af-search')).toBeDisabled();
    // The connectors can still be read, changed and written anew.
    await page.getByTestId('af-tab-sources').click();
    const pane = page.getByTestId('af-sources-pane');
    await expect(pane).toContainText('Wikimedia Commons');
    await expect(pane).toContainText('FreeCAD parts library');
    await pane.getByRole('button', { name: 'Wikipedia', exact: true }).click();
    await expect(page.getByTestId('af-connector')).toContainText('may ask: *.wikipedia.org');
    expect(await editorText(page.getByTestId('af-code'))).toContain("id: 'wikipedia'");
    await page.getByTestId('af-new-connector').click();
    await expect(page.getByTestId('af-connector')).toContainText('My library');
    await expect(page.getByTestId('af-test-connector')).toBeDisabled();
  },
  'asset-credits': async (page) => {
    const record = {
      benchtopAsset: 1,
      source: { id: 'wellcome', name: 'Wellcome Collection' },
      id: 'abc',
      type: 'image',
      title: 'A pig’s heart',
      creator: 'Royal Veterinary College',
      page: 'https://wellcomecollection.org/works/abc',
      licence: { code: 'by-nc', name: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/', version: '4.0', note: '' },
      files: [{ name: 'a.jpg' }],
    };
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('ac-add').click();
    await (await chooser).setFiles({ name: 'asset.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(record)) });
    await expect(page.getByTestId('ac-table')).toContainText('A pig’s heart');
    await page.getByTestId('ac-use').selectOption('ticketed');
    await expect(page.getByTestId('ac-table')).toContainText('NonCommercial: not for a ticketed show');
    await page.getByTestId('ac-format').selectOption('md');
    await expect(page.getByTestId('ac-output')).toHaveValue(/\[A pig’s heart\]\(https:\/\/wellcomecollection\.org\/works\/abc\)/);
    await page.getByTestId('ac-probe').fill('https://creativecommons.org/licenses/by-nd/4.0/');
    await expect(page.getByTestId('ac-probe-result')).toContainText('CC BY-ND 4.0');
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
    // The simulated Uno's pins are recorded and handed to the Logic Analyser, which reads the serial text off pin 1.
    await page.getByTestId('cs-examples').selectOption('uno-dimmer');
    await canvas.locator('[data-part=arduino-uno]').click();
    // Not running yet: there is nothing to record.
    await page.getByTestId('cs-record').click();
    await expect(page.locator('.toast').filter({ hasText: 'Run the circuit first' }).first()).toBeVisible();
    await page.getByTestId('cs-run').click();
    await expect(page.getByTestId('cs-serial-log')).toContainText('A0 =', { timeout: 15_000 });
    await page.getByTestId('cs-record-for').selectOption('0.5');
    await page.getByTestId('cs-record').click();
    await expect(page).toHaveURL(/#\/tool\/logic-analyser$/, { timeout: 30_000 });
    await expect(page.getByTestId('la-info')).toContainText('arduino-uno-pins.vcd');
    await expect(page.getByTestId('la-info')).toContainText('14 lines');
    await page.getByTestId('la-add-uart').click();
    await expect(page.getByTestId('la-baud')).toHaveValue('9600');
    await expect(page.getByTestId('la-table')).toContainText('A0 =');
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

test('Text Translator keeps the layout and subtitle times, through a stand-in translation server', async ({ page }) => {
  const problems = watch(page);
  await page.addInitScript(() => {
    const encode = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    const no = async () => {
      throw new Error('not in this test');
    };
    (globalThis as { __benchtopNetTransport?: unknown }).__benchtopNetTransport = {
      http: async (request: { url: string; body?: string }) => {
        const asked = JSON.parse(request.body ?? '{}') as { benchtop?: { lines: string[]; to: string } };
        const content = JSON.stringify((asked.benchtop?.lines ?? []).map((line) => `[${asked.benchtop?.to}] ${line}`));
        const body = encode(JSON.stringify({ choices: [{ message: { content } }] }));
        return {
          url: request.url,
          status: 200,
          reason: 'OK',
          version: 'HTTP/1.1',
          headers: [['content-type', 'application/json']],
          body,
          bodySize: 0,
          truncated: false,
          remoteAddr: null,
          headersMs: 1,
          elapsedMs: 1,
          peerCertificate: null,
        };
      },
      tls: no,
      dns: no,
      whois: no,
      probe: no,
    };
  });
  await openTool(page, 'translator');
  await expect(page.getByTestId('tr-gate')).toHaveCount(0);
  await page.getByTestId('tr-to').selectOption('kn');
  await page.getByTestId('tr-input').fill('# Steam\n\n- It burns coal.\n- It turns a wheel.');
  await page.getByTestId('tr-translate').click();
  await expect(page.getByTestId('tr-output')).toHaveValue('# [kan_Knda] Steam\n\n- [kan_Knda] It burns coal.\n- [kan_Knda] It turns a wheel.');
  await expect(page.getByTestId('tr-status')).toContainText('English → Kannada: 3 pieces');
  // Subtitles keep their times.
  await page.getByTestId('tr-input').fill('1\n00:00:01,000 --> 00:00:02,000\nHello\n');
  await page.getByTestId('tr-translate').click();
  await expect(page.getByTestId('tr-output')).toHaveValue(/00:00:01,000 --> 00:00:02,000\n\[kan_Knda\] Hello/);
  const saved = await download(page, () => page.getByTestId('tr-save').click());
  expect(saved.toString('utf8')).toContain('[kan_Knda] Hello');
  expect(problems).toEqual([]);
});

test('Text Translator types in other scripts, offers other spellings and converts between scripts', async ({ page }) => {
  const problems = watch(page);
  await openTool(page, 'translator');
  await page.getByTestId('tr-mode-type').click();

  // Arabic: short vowels are not written, and the other spellings are a click away.
  await page.getByTestId('tr-type-language').selectOption('ar');
  await expect(page.getByTestId('tr-type-note')).toContainText('Arabizi');
  await page.getByTestId('tr-type-input').fill('mar7aba, madrasa');
  await expect(page.getByTestId('tr-type-output')).toHaveValue('مرحبا، مدرسا');
  await expect(page.getByTestId('tr-type-output')).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('tr-spellings').getByRole('button', { name: 'مدرسة' }).click();
  await expect(page.getByTestId('tr-type-output')).toHaveValue('مرحبا، مدرسة');
  await expect(page.getByTestId('tr-spellings').getByRole('button', { name: 'مدرسة' })).toHaveAttribute('aria-pressed', 'true');

  // Korean and Vietnamese have their own rules; {braces} keep a word as typed.
  await page.getByTestId('tr-type-language').selectOption('ko');
  await page.getByTestId('tr-type-input').fill('annyeonghaseyo, {Benchtop}');
  await expect(page.getByTestId('tr-type-output')).toHaveValue('안녕하세요, Benchtop');
  await page.getByTestId('tr-type-language').selectOption('vi');
  await page.getByTestId('tr-type-example').click();
  await expect(page.getByTestId('tr-type-output')).toHaveValue('xin chào, tiếng Việt');

  // The on-screen keyboard types into the Roman box at the caret.
  await page.getByTestId('tr-type-language').selectOption('hi');
  await page.getByTestId('tr-type-input').fill('namaste ');
  await page.getByTestId('tr-type-keyboard').click();
  await expect(page.getByTestId('tr-keyboard')).toBeVisible();
  await page.getByTestId('tr-keyboard').getByRole('button', { name: 'भ', exact: true }).click();
  await page.getByTestId('tr-keyboard').getByRole('button', { name: 'ा', exact: true }).click();
  await page.getByTestId('tr-type-input').press('End');
  await page.getByTestId('tr-type-input').pressSequentially('rat');
  await expect(page.getByTestId('tr-type-output')).toHaveValue('नमस्ते भारत');

  // What was typed can be translated…
  await page.getByTestId('tr-type-translate').click();
  await expect(page.getByTestId('tr-mode-translate')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('tr-input')).toHaveValue('नमस्ते भारत');
  await expect(page.getByTestId('tr-from')).toHaveValue('hi');

  // …or written in another script, or in Roman letters.
  await page.getByTestId('tr-mode-convert').click();
  await page.getByTestId('tr-convert-input').fill('नमस्ते भारत');
  await expect(page.getByTestId('tr-convert-detected')).toContainText('Devanagari');
  await page.getByTestId('tr-convert-to').selectOption('Kannada');
  await expect(page.getByTestId('tr-convert-output')).toHaveValue('ನಮಸ್ತೇ ಭಾರತ');
  await page.getByTestId('tr-convert-swap').click();
  await expect(page.getByTestId('tr-convert-input')).toHaveValue('ನಮಸ್ತೇ ಭಾರತ');
  await expect(page.getByTestId('tr-convert-output')).toHaveValue('नमस्ते भारत');
  await page.getByTestId('tr-convert-to').selectOption('iast');
  await expect(page.getByTestId('tr-convert-output')).toHaveValue('namaste bhārata');
  await page.getByTestId('tr-convert-to').selectOption('casual');
  await expect(page.getByTestId('tr-convert-output')).toHaveValue('namaste bharat');
  const saved = await download(page, () => page.getByTestId('tr-convert-save').click());
  expect(saved.toString('utf8')).toBe('namaste bharat');
  expect(problems).toEqual([]);
});

test('Asset Finder asks the libraries through its connectors, filters by licence and downloads', async ({ page }) => {
  const problems = watch(page);
  const openverse = JSON.parse(readFileSync(new URL('../fixtures/assets/openverse_images.json', import.meta.url), 'utf8'));
  await page.addInitScript((answer) => {
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
        if (url.host === 'api.openverse.org' && url.pathname.startsWith('/v1/images/')) return reply(request.url, 200, 'application/json', encode(JSON.stringify(answer)));
        return reply(request.url, 404, 'text/plain', encode('not in this test'));
      },
      tls: no,
      dns: no,
      whois: no,
      probe: no,
    };
  }, openverse);
  await openTool(page, 'asset-finder');
  await expect(page.getByTestId('af-gate')).toHaveCount(0);
  await page.getByTestId('af-query').fill('moon');
  // CC BY only: the share-alike picture is left out; with share-alike it comes in.
  await page.getByTestId('af-licence').selectOption('by');
  await page.getByTestId('af-search').click();
  const sources = page.getByTestId('af-sources');
  await expect(sources).toContainText('Openverse');
  await expect(sources).toContainText('left out by the filters');
  await expect(page.getByTestId('af-results')).toContainText('Lunar crater');
  await expect(page.getByTestId('af-results')).not.toContainText('Moon over the city');
  await page.getByTestId('af-licence').selectOption('by-sa');
  await page.getByTestId('af-search').click();
  await expect(page.getByTestId('af-results')).toContainText('Moon over the city');
  await page
    .getByTestId('af-results')
    .getByRole('button', { name: /Moon over the city/ })
    .click();
  const details = page.getByTestId('af-details');
  await expect(details).toContainText('CC BY-SA 2.0');
  await expect(details).toContainText('ShareAlike');
  await expect(details).toContainText('“Moon over the city” by jo ann');
  const files = page.getByTestId('af-files');
  await expect(files).toContainText('Original (JPG)');
  const bytes = await download(page, () => files.getByRole('button', { name: 'Download' }).first().click());
  expect([...bytes.subarray(0, 4)]).toEqual(PNG);
  await page.getByTestId('af-tab-downloads').click();
  await expect(page.getByTestId('af-downloads')).toContainText('Saved');
  expect(problems).toEqual([]);
});

test('notes hold sketches: mind maps from the keyboard, shapes, arrows that stick, the pen and pictures', async ({ page }) => {
  const problems = watch(page);
  await openTool(page, 'notes');
  await expect(page.getByTestId('nt-saved')).toHaveText('Saved', { timeout: 15_000 });
  await page.getByTestId('nt-title').fill('Gallery ideas');
  await page.getByTestId('nt-add-sketch').click();
  const canvas = page.getByTestId('sk-canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  // A mind map typed from the keyboard: Tab adds a branch, Enter a sibling.
  await page.getByTestId('sk-start-map').click();
  await expect(page.getByTestId('sk-edit')).toBeFocused();
  for (const step of ['Engine Hall', 'Tab', 'Steam', 'Tab', 'Boilers', 'Enter', 'Enter', 'Pumps', 'Enter', 'Escape']) {
    if (/^(Tab|Enter|Escape)$/.test(step)) await page.keyboard.press(step);
    else await page.keyboard.type(step);
  }
  const nodes = canvas.locator('[data-kind=node]');
  await expect(nodes).toHaveCount(4);
  await expect(canvas.locator('[data-kind=branch]')).toHaveCount(3);
  await expect(canvas).toContainText('Pumps');
  const boxes = await nodes.evaluateAll((els) => els.map((el) => (el as SVGGraphicsElement).getBBox()).map((b, i) => ({ i, x: b.x, y: b.y, w: b.width, h: b.height })));
  const placed = await nodes.evaluateAll((els) => els.map((el) => el.getAttribute('transform')));
  const at = boxes.map((b, i) => {
    const [, x = '0', y = '0'] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(placed[i] ?? '') ?? [];
    return { ...b, x: b.x + Number(x), y: b.y + Number(y) };
  });
  for (const a of at) for (const b of at) if (a.i < b.i) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
  await page.getByTestId('sk-tidy').click();
  await expect(nodes).toHaveCount(4);

  // A box with a label, and an arrow from it to the map that follows the box around.
  await canvas.scrollIntoViewIfNeeded();
  const frame = await canvas.boundingBox();
  if (!frame) throw new Error('no canvas');
  const drag = async (from: [number, number], to: [number, number]) => {
    await page.mouse.move(frame.x + from[0], frame.y + from[1]);
    await page.mouse.down();
    await page.mouse.move(frame.x + to[0], frame.y + to[1], { steps: 8 });
    await page.mouse.up();
  };
  await page.getByTestId('sk-tool-rect').click();
  await drag([frame.width - 230, 30], [frame.width - 80, 95]);
  await page.keyboard.type('Ticket desk');
  await page.keyboard.press('Enter');
  await expect(nodes).toHaveCount(5);
  await expect(canvas).toContainText('Ticket desk');
  await page.getByTestId('sk-tool-arrow').click();
  await drag([frame.width - 155, 62], [frame.width / 2, frame.height / 2]);
  const edge = canvas.locator('[data-kind=edge]');
  await expect(edge).toHaveCount(1);
  await expect(page.getByTestId('sk-heads')).toBeVisible();
  const before = await edge.locator('path').first().getAttribute('d');
  await drag([frame.width - 155, 62], [frame.width - 255, 62]);
  await expect.poll(() => edge.locator('path').first().getAttribute('d')).not.toBe(before);

  // The pen draws, the eraser rubs out, and undo brings it back.
  await page.getByTestId('sk-tool-pen').click();
  await drag([70, frame.height - 120], [190, frame.height - 90]);
  await expect(canvas.locator('[data-kind=stroke]')).toHaveCount(1);
  await page.getByTestId('sk-tool-eraser').click();
  await drag([60, frame.height - 105], [200, frame.height - 105]);
  await expect(canvas.locator('[data-kind=stroke]')).toHaveCount(0);
  await page.getByTestId('sk-undo').click();
  await expect(canvas.locator('[data-kind=stroke]')).toHaveCount(1);

  // Clean lines swap the handwriting for the app's own type.
  await page.getByTestId('sk-clean').click();
  await expect(canvas.locator('text').first()).toHaveAttribute('font-family', /Barlow/);
  await page.getByTestId('sk-hand').click();
  await expect(canvas.locator('text').first()).toHaveAttribute('font-family', /Kalam/);

  // Pictures carry their fonts; the PNG is a real picture.
  const svg = (await download(page, () => page.getByTestId('sk-svg').click())).toString('utf8');
  expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('Boilers');
  expect(svg).toContain('@font-face');
  const png = await download(page, () => page.getByTestId('sk-png').click());
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.length).toBeGreaterThan(5000);

  // Saved with the note, found by search, and drawn in the note's web page.
  await expect(page.getByTestId('nt-saved')).toHaveText('Saved', { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('sk-canvas')).toContainText('Pumps', { timeout: 15_000 });
  await expect(page.getByTestId('sk-canvas').locator('[data-kind=edge]')).toHaveCount(1);
  await page.getByTestId('nt-search').fill('boilers');
  await expect(page.getByTestId('nt-items').locator('li')).toHaveCount(1);
  const html = (await download(page, () => page.getByTestId('nt-export').selectOption('html'))).toString('utf8');
  expect(html).toContain('<figure class="note-sketch"><svg');
  expect(html).toContain('Ticket desk');
  expect(html).toMatch(/@font-face\{font-family:'Kalam'/);
  expect(problems).toEqual([]);
});

test('the circuit simulator runs displays and sensors on its boards', async ({ page }) => {
  const problems = watch(page);
  await openTool(page, 'circuit-simulator');
  const canvas = page.getByTestId('cs-canvas');
  // An OLED on the Uno's I²C bus shows the sketch's picture.
  await page.getByTestId('cs-examples').selectOption('uno-oled');
  await page.getByTestId('cs-run').click();
  await expect(page.getByTestId('cs-serial-log')).toContainText('OLED ready', { timeout: 20_000 });
  await expect(canvas.locator('[data-part=oled] image')).toHaveAttribute('href', /^data:image\/png/);
  await page.getByTestId('cs-reset').click();
  // A sensor's reading changes while the circuit runs.
  await page.getByTestId('cs-examples').selectOption('uno-dht22');
  await page.getByTestId('cs-run').click();
  const log = page.getByTestId('cs-serial-log');
  await expect(log).toContainText('Temperature: 24.0 C', { timeout: 20_000 });
  await canvas.locator('[data-part=dht22]').click();
  const box = page.getByRole('textbox', { name: 'Temperature in °C' });
  await box.fill('31.5');
  await box.press('Enter');
  await expect(log).toContainText('Temperature: 31.5 C', { timeout: 20_000 });
  await page.getByTestId('cs-reset').click();
  // The parts library has the new groups.
  for (const type of ['oled', 'lcd-i2c', 'tft', 'servo', 'keypad', 'bme280', 'arduino-mega', 'attiny85']) await expect(page.getByTestId(`cs-add-${type}`)).toBeVisible();
  expect(problems).toEqual([]);
});

test('the circuit simulator analyses circuits: frequency response, operating point and time', async ({ page }) => {
  const problems = watch(page);
  await openTool(page, 'circuit-simulator');
  // A Bode plot of the RC filter, with the capacitor stepped.
  await page.getByTestId('cs-examples').selectOption('an-rc-filter');
  await expect(page.getByTestId('cs-analysis')).toBeVisible();
  await page.getByTestId('cs-an-run').click();
  const measurements = page.getByTestId('cs-an-measurements');
  await expect(measurements).toContainText('1.591 kHz');
  await expect(measurements).toContainText('3.385 kHz');
  await expect(page.locator('.cs-an-plot polyline')).toHaveCount(6);
  // Dragging on the plot moves a cursor.
  const plot = page.locator('.cs-an-plot');
  const before = await page.getByTestId('cs-an-cursors').locator('thead th').nth(1).textContent();
  const box = await plot.boundingBox();
  await plot.click({ position: { x: (box?.width ?? 800) * 0.12, y: (box?.height ?? 400) * 0.3 } });
  await expect(page.getByTestId('cs-an-cursors').locator('thead th').nth(1)).not.toHaveText(before ?? '');
  // The amplifier's operating point, labelled on the drawing.
  await page.getByTestId('cs-examples').selectOption('an-amplifier');
  await page.getByRole('radiogroup', { name: 'Analysis' }).getByRole('radio', { name: 'Operating point' }).click();
  await page.getByTestId('cs-an-run').click();
  await expect(page.getByTestId('cs-an-op')).toContainText('collector');
  await expect(page.getByTestId('cs-op-labels').locator('text')).not.toHaveCount(0);
  await expect(page.getByTestId('cs-op-labels')).toContainText('Ic 1.36 mA');
  // A time-domain run of the power supply settles at 5 V.
  await page.getByTestId('cs-examples').selectOption('an-power-supply');
  await page.getByTestId('cs-an-run').click();
  await expect(page.getByTestId('cs-an-measurements')).toContainText('4.971 V', { timeout: 30_000 });
  expect(problems).toEqual([]);
});

test('the circuit simulator runs a Raspberry Pi Pico with an OLED', async ({ page }) => {
  const problems = watch(page);
  await openTool(page, 'circuit-simulator');
  await page.getByTestId('cs-examples').selectOption('pico-oled');
  await page.getByTestId('cs-run').click();
  await expect(page.getByTestId('cs-serial-log')).toContainText('OLED ready', { timeout: 20_000 });
  await expect(page.getByTestId('cs-canvas').locator('[data-part=oled] image')).toHaveAttribute('href', /^data:image\/png/);
  await expect(page.getByTestId('cs-add-pi-pico')).toBeVisible();
  expect(problems).toEqual([]);
});

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
  await page.getByTestId('wf-node-tool').first().locator('.wf-node-head').click();
  await page.getByTestId('wf-tool').selectOption({ label: 'Sandbox probe' });
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

test('HEIC photos open in the picture tools, decoded with libheif', async ({ page }) => {
  const problems = watch(page);
  await openTool(page, 'image-resize');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('dropzone').click();
  await (await chooser).setFiles({ name: 'photo.heic', mimeType: 'image/heic', buffer: readFileSync(new URL('../fixtures/tiny.heic', import.meta.url)) });
  await expect(page.getByTestId('image-source')).toContainText('64 × 48 px');
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

test('Benchtop opens on the list of every tool, and the notes are a click away', async ({ page }) => {
  const problems = watch(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${TOOLS.length} developer tools`);
  await expect(page).toHaveTitle(/^All tools/);
  for (const entry of TOOLS) {
    await expect(page.locator(`.home-index a[href="#/tool/${entry.id}"]`)).toBeAttached();
    if (entry.kind === 'custom') expect(CUSTOM_CHECKS[entry.id], `custom check for ${entry.id}`).toBeDefined();
  }
  await page.getByTestId('sidebar-notes').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notes');
  // The notes can be the start screen instead: a setting.
  await page.goto('./#/settings');
  await expect(page.locator('#setting-start')).toHaveValue('tools');
  await page.locator('#setting-start').selectOption('notes');
  await page.getByRole('link', { name: 'Benchtop home' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notes');
  await page.getByTestId('start-all-tools').click();
  await expect(page).toHaveURL(/#\/tools$/);
  await expect(page.locator('.home-index')).toBeVisible();
  await page.goto('./#/settings');
  await page.locator('#setting-start').selectOption('tools');
  await page.getByRole('link', { name: 'Benchtop home' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('developer tools');
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
