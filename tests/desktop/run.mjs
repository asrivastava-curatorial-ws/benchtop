#!/usr/bin/env node
/**
 * Drives the real desktop app (Tauri + the system web view) through WebDriver.
 *
 * Linux only, because that is where Tauri's WebDriver support lives:
 *   cargo install tauri-driver --locked
 *   sudo apt install webkit2gtk-driver xvfb      # provides WebKitWebDriver
 *   pnpm tauri build --no-bundle                 # or --bundles deb
 *   xvfb-run -a pnpm test:desktop
 *
 * The binary defaults to src-tauri/target/release/benchtop; set BENCHTOP_BINARY to override.
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By, until } from 'selenium-webdriver';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BINARY = process.env.BENCHTOP_BINARY ?? resolve(ROOT, 'src-tauri/target/release/benchtop');
const DRIVER = process.env.TAURI_DRIVER ?? 'tauri-driver';

if (!existsSync(BINARY)) {
  console.error(`No desktop build at ${BINARY}. Run "pnpm tauri build --no-bundle" first.`);
  process.exit(2);
}

function waitForPort(port, timeout = 20_000) {
  const started = Date.now();
  return new Promise((done, fail) => {
    const attempt = () => {
      const socket = createConnection(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.end();
        done();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeout) fail(new Error(`tauri-driver did not open port ${port}`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

const results = [];
async function check(name, body) {
  const started = Date.now();
  try {
    await body();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ok    ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0]}`);
  }
}

const driverProcess = spawn(DRIVER, [], { stdio: ['ignore', 'inherit', 'inherit'] });
let driver;
try {
  await waitForPort(4444);
  driver = await new Builder()
    .usingServer('http://127.0.0.1:4444/')
    .withCapabilities({ browserName: 'wry', 'tauri:options': { application: BINARY } })
    .build();

  const state = () => driver.executeScript("return document.querySelector('[data-testid=tool]')?.dataset.state ?? null");
  const waitForState = async (wanted, timeout = 30_000) => {
    await driver.wait(async () => wanted.includes(await state()), timeout, `tool state did not become ${wanted.join(' or ')}`);
  };
  const open = async (id) => {
    await driver.executeScript(`location.hash = '#/tool/${id}'`);
    await driver.wait(until.elementLocated(By.css('[data-testid=tool]')), 20_000);
  };

  console.log(`Desktop smoke test: ${BINARY}`);

  await check('the window opens on the home page with every tool listed', async () => {
    await driver.wait(async () => (await driver.getTitle()).includes('Benchtop'), 20_000);
    const links = await driver.findElements(By.css('a[href^="#/tool/"]'));
    if (links.length < 90) throw new Error(`only ${links.length} tool links`);
  });

  await check('the content security policy is in place and blocks the network', async () => {
    const policy = await driver.executeScript("return document.querySelector('meta[http-equiv=Content-Security-Policy]')?.content ?? ''");
    if (!policy.includes("default-src 'none'")) throw new Error('policy missing');
    const outcome = await driver.executeAsyncScript("const done = arguments[0]; fetch('https://example.org/').then(() => done('loaded'), () => done('blocked'));");
    if (outcome !== 'blocked') throw new Error(`request was ${outcome}`);
  });

  await check('a text tool runs (JSON formatter)', async () => {
    await open('json-formatter');
    await driver.findElement(By.xpath("//button[normalize-space()='Sample']")).click();
    await waitForState(['done']);
  });

  await check('the Bootstrap theme builder compiles Sass in the web view', async () => {
    await open('bootstrap-theme');
    await waitForState(['done'], 120_000);
    const source = await driver.executeScript("return document.querySelector('iframe')?.getAttribute('srcdoc') ?? ''");
    if (!source.includes('--bs-primary: #0d6efd;')) throw new Error('compiled CSS missing from the preview');
  });

  await check('WebAssembly codecs encode AVIF and WebP', async () => {
    await open('image-converter');
    await driver.executeAsyncScript(`
      const done = arguments[0];
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 200;
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, 320, 200);
      gradient.addColorStop(0, '#17694e'); gradient.addColorStop(1, '#d9a63a');
      context.fillStyle = gradient; context.fillRect(0, 0, 320, 200);
      canvas.toBlob((blob) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], 'sample.png', { type: 'image/png' }));
        document.querySelector('[data-testid=dropzone]').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
        done();
      }, 'image/png');`);
    await waitForState(['done']);
    for (const format of ['avif', 'webp']) {
      await driver.executeScript(`const s = document.querySelector('#export-format'); s.value = '${format}'; s.dispatchEvent(new Event('change', { bubbles: true }));`);
      await driver.wait(async () => /\d/.test(await driver.executeScript("return document.querySelector('[data-testid=export-size]')?.textContent ?? ''")), 120_000, `${format} size never appeared`);
      const text = await driver.executeScript("return document.querySelector('[data-testid=export-size]').textContent");
      if (/cannot|failed|error/i.test(text)) throw new Error(`${format}: ${text}`);
    }
  });

  await check('the clipboard round-trips through the native plugin', async () => {
    const value = `benchtop-${Date.now()}`;
    const read = await driver.executeAsyncScript(
      `const done = arguments[0];
       const { invoke } = window.__TAURI_INTERNALS__;
       invoke('plugin:clipboard-manager|write_text', { text: '${value}' })
         .then(() => invoke('plugin:clipboard-manager|read_text'))
         .then(done, (error) => done('error: ' + error));`,
    );
    if (read !== value) throw new Error(`read back ${JSON.stringify(read)}`);
  });

  await check('save_file is registered and refuses anything but raw bytes', async () => {
    const outcome = await driver.executeAsyncScript(
      `const done = arguments[0];
       window.__TAURI_INTERNALS__.invoke('save_file', { name: 'x.txt' }).then(() => done('accepted'), (error) => done(String(error)));`,
    );
    if (!/raw bytes/.test(outcome)) throw new Error(outcome);
  });

  await check('the window refuses to navigate away from the app', async () => {
    await driver.executeScript("location.href = 'https://example.org/'");
    await driver.sleep(1500);
    const url = await driver.getCurrentUrl();
    if (!/^(tauri:\/\/localhost|http:\/\/tauri\.localhost)/.test(url)) throw new Error(`navigated to ${url}`);
  });
  if (process.env.BENCHTOP_SCREENSHOT) {
    await driver.executeScript("location.hash = '#/tool/bootstrap-theme'");
    await waitForState(['done'], 120_000);
    await driver.sleep(500);
    writeFileSync(process.env.BENCHTOP_SCREENSHOT, await driver.takeScreenshot(), 'base64');
    console.log(`Screenshot saved to ${process.env.BENCHTOP_SCREENSHOT}`);
  }
} catch (error) {
  console.error(error);
  results.push({ name: 'session', ok: false, error });
} finally {
  await driver?.quit().catch(() => {});
  driverProcess.kill();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length > 0 ? 1 : 0);
