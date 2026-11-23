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
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
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
    // The title is in index.html, so wait for the app itself to draw the tool list.
    let count = 0;
    await driver
      .wait(async () => {
        count = (await driver.findElements(By.css('a[href^="#/tool/"]'))).length;
        return count >= 125;
      }, 20_000)
      .catch(() => {
        throw new Error(`only ${count} tool links`);
      });
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

  /** Drops a fixture file onto the open tool's drop zone, as a user dragging it from the file manager would. */
  const dropFixture = async (fixture, type) => {
    const base64 = readFileSync(resolve(ROOT, 'tests/e2e/fixtures', fixture)).toString('base64');
    await driver.executeScript(
      `const bytes = Uint8Array.from(atob(arguments[0]), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], arguments[1], { type: arguments[2] }));
      document.querySelector('[data-testid=dropzone]').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));`,
      base64,
      fixture,
      type,
    );
  };
  const outputText = () => driver.executeScript("return document.querySelector('[data-testid=output-editor] .cm-content')?.textContent ?? ''");

  await check('jq runs from WebAssembly in the worker', async () => {
    await open('json-query');
    await driver.findElement(By.xpath("//button[normalize-space()='Sample']")).click();
    await driver.findElement(By.xpath("//button[@role='radio' and normalize-space()='jq']")).click();
    await waitForState(['done'], 60_000);
    await driver.wait(async () => (await outputText()).includes('Engine Hall'), 30_000, 'jq produced no output');
  });

  await check('photo metadata is read and the GPS location is flagged', async () => {
    await open('image-metadata');
    await dropFixture('exif.jpg', 'image/jpeg');
    await waitForState(['done']);
    const warning = await driver.executeScript("return document.querySelector('[data-testid=metadata-gps]')?.textContent ?? ''");
    if (!warning.includes('28.613889')) throw new Error(`no GPS warning: ${warning}`);
    const removed = await driver.executeScript("return document.querySelector('[data-testid=metadata-clean]')?.textContent ?? ''");
    if (!removed.includes('EXIF')) throw new Error(`nothing listed for removal: ${removed}`);
  });

  await check('QR codes are read from an image', async () => {
    await open('qr-decoder');
    await dropFixture('qr.png', 'image/png');
    await waitForState(['done']);
    await driver.wait(async () => (await driver.executeScript("return document.querySelector('[data-testid=qr-kind]')?.textContent ?? ''")).includes('Benchtop Lab'), 20_000, 'QR code not decoded');
  });

  await check('SSH keys are generated with the system random source', async () => {
    await open('ssh-keygen');
    await waitForState(['done'], 60_000);
    const first = await outputText();
    if (!first.startsWith('ssh-ed25519 AAAA')) throw new Error(`unexpected output: ${first.slice(0, 60)}`);
    await driver.findElement(By.css('[data-testid=run]')).click();
    await driver.wait(async () => (await outputText()) !== first, 20_000, 'a second key was not different');
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

  await check('the clipboard history collects copied text, and the quick-launch shortcut registers', async () => {
    const value = `history-${Date.now()}`;
    const outcome = await driver.executeAsyncScript(
      `const done = arguments[0];
       const { invoke } = window.__TAURI_INTERNALS__;
       const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
       (async () => {
         await invoke('clip_watch', { enabled: true });
         await invoke('plugin:clipboard-manager|write_text', { text: '${value}' });
         let found = false;
         for (let i = 0; i < 20 && !found; i++) {
           await wait(250);
           found = (await invoke('clip_list')).some((entry) => entry.text === '${value}');
         }
         await invoke('clip_watch', { enabled: false });
         await invoke('clip_clear');
         const cleared = (await invoke('clip_list')).length === 0;
         await invoke('desk_shortcut', { accelerator: 'Ctrl+Alt+F9' });
         const info = await invoke('desk_info');
         await invoke('desk_shortcut', { accelerator: '' });
         const tray = await invoke('desk_tray', { enabled: info.tray_supported }).then(() => 'ok', (error) => String(error));
         if (info.tray_supported) await invoke('desk_tray', { enabled: false });
         return { found, cleared, shortcut: info.shortcut, traySupported: info.tray_supported, tray };
       })().then(done, (error) => done({ error: String(error) }));`,
    );
    if (outcome.error) throw new Error(outcome.error);
    if (!outcome.found) throw new Error('the copied text never reached the history');
    if (!outcome.cleared) throw new Error('the history was not cleared');
    if (outcome.shortcut !== 'Ctrl+Alt+F9') throw new Error(`shortcut ${JSON.stringify(outcome.shortcut)}`);
    if (outcome.tray !== 'ok') throw new Error(`tray: ${outcome.tray}`);
    console.log(`    (tray icon ${outcome.traySupported ? 'shown and removed' : 'not offered: no AppIndicator library here'})`);
  });

  await check('the IndicTrans2 server starts in the background and stops on request', async () => {
    // A stand-in setup: the system's Python in place of the private one. Without PyTorch the server
    // reports both models missing but still starts, which is the part under test here.
    const dataHome = process.env.XDG_DATA_HOME ?? resolve(homedir(), '.local/share');
    const folder = resolve(dataHome, 'app.benchtop.desktop', 'indictrans2');
    if (existsSync(folder)) {
      console.log('    (skipped: this computer has a real IndicTrans2 setup)');
      return;
    }
    const python = execFileSync('sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).trim();
    mkdirSync(resolve(folder, 'venv/bin'), { recursive: true });
    symlinkSync(python, resolve(folder, 'venv/bin/python'));
    writeFileSync(resolve(folder, 'server.py'), '');
    writeFileSync(resolve(folder, 'setup.json'), JSON.stringify({ version: 1, python: '3.12', torch: 'test', gpu: false, models: [] }));
    try {
      const outcome = await driver.executeAsyncScript(
        `const done = arguments[0];
         const { invoke } = window.__TAURI_INTERNALS__;
         const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
         (async () => {
           await invoke('indic_start');
           let status;
           for (let i = 0; i < 80; i++) {
             status = await invoke('indic_status');
             if (status.ready || !status.running) break;
             await wait(250);
           }
           const seen = { ready: status.ready, port: status.port, missing: status.missing, message: status.message };
           await invoke('indic_stop');
           return { ...seen, stopped: !(await invoke('indic_status')).running };
         })().then(done, (error) => done({ error: String(error) }));`,
      );
      if (outcome.error) throw new Error(outcome.error);
      if (!outcome.ready) throw new Error(`not ready: ${outcome.message}`);
      if (!(outcome.port > 0)) throw new Error(`port ${outcome.port}`);
      if (outcome.missing.join() !== 'en-indic,indic-en') throw new Error(`missing ${outcome.missing}`);
      if (!outcome.stopped) throw new Error('the server did not stop');
      if (readFileSync(resolve(folder, 'server.py'), 'utf8') !== readFileSync(resolve(ROOT, 'scripts/indictrans2-server.py'), 'utf8')) throw new Error('the server script was not refreshed');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  await check('save_file is registered and refuses anything but raw bytes', async () => {
    const outcome = await driver.executeAsyncScript(
      `const done = arguments[0];
       window.__TAURI_INTERNALS__.invoke('save_file', { name: 'x.txt' }).then(() => done('accepted'), (error) => done(String(error)));`,
    );
    if (!/raw bytes/.test(outcome)) throw new Error(outcome);
  });

  await check('online checks reach the desktop shell (port probe of the local WebDriver)', async () => {
    const outcome = await driver.executeAsyncScript(
      `const done = arguments[0];
       window.__TAURI_INTERNALS__.invoke('net_tcp_probe', { request: { host: '127.0.0.1', ports: [4444, 9], timeoutMs: 2000 } })
         .then((response) => done(JSON.stringify(response)), (error) => done('error: ' + JSON.stringify(error)));`,
    );
    const response = JSON.parse(outcome.startsWith('error') ? '{}' : outcome);
    const state = (port) => (response.results ?? []).find((result) => result.port === port)?.state;
    if (state(4444) !== 'open' || state(9) !== 'closed') throw new Error(`unexpected probe result: ${outcome}`);
  });

  /** Calls a desktop command from the page, returning its result or throwing its error. */
  const invoke = async (command, args = {}) => {
    const outcome = await driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then((value) => done({ value }), (error) => done({ error: String(error?.message ?? error) }));`,
      command,
      args,
    );
    if (outcome.error !== undefined) throw new Error(outcome.error);
    return outcome.value;
  };

  /** Drops fixture files on an element, as a user dragging them from the file manager would. */
  const dropFiles = async (selector, files) => {
    await driver.executeScript(
      `const transfer = new DataTransfer();
       for (const [base64, name, type] of arguments[1]) {
         const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
         transfer.items.add(new File([bytes], name, { type }));
       }
       document.querySelector(arguments[0]).dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));`,
      selector,
      files.map(([bytes, name, type]) => [Buffer.from(bytes).toString('base64'), name, type]),
    );
  };

  await check('the AI model catalogue is available', async () => {
    const status = await invoke('ai_status');
    const kinds = new Set(status.items.map((item) => item.kind));
    for (const kind of ['runtime', 'background', 'upscale', 'faces', 'eraser', 'speech']) if (!kinds.has(kind)) throw new Error(`no ${kind} models listed`);
  });

  if (process.env.BENCHTOP_TEST_DOWNLOADS) {
    await check('the AI engine and a model download, verify and install', async () => {
      for (const id of ['runtime', 'u2netp']) await invoke('ai_install', { id });
      const status = await invoke('ai_status');
      for (const id of ['runtime', 'u2netp']) if (!status.items.find((item) => item.id === id)?.installed) throw new Error(`${id} not installed`);
    });

    await check('a background-removal job runs in the AI worker process', async () => {
      const png = readFileSync(resolve(ROOT, 'tests/e2e/fixtures/sample.png'));
      const outcome = await driver.executeAsyncScript(
        `const done = arguments[arguments.length - 1];
         const input = Uint8Array.from(atob(arguments[0]), (c) => c.charCodeAt(0));
         const body = new Uint8Array(8 + input.length);
         new DataView(body.buffer).setBigUint64(0, BigInt(input.length), true);
         body.set(input, 8);
         const request = { op: 'background', model: 'u2netp', options: { mode: 'cutout', edges: 'soft' } };
         window.__TAURI_INTERNALS__.invoke('ai_run', body, { headers: { 'x-ai': encodeURIComponent(JSON.stringify(request)) } }).then(
           (raw) => {
             const bytes = new Uint8Array(raw);
             const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
             const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length)));
             done({ header, magic: Array.from(bytes.subarray(4 + length, 8 + length)) });
           },
           (error) => done({ error: String(error?.message ?? error) }),
         );`,
        png.toString('base64'),
      );
      if (outcome.error) throw new Error(outcome.error);
      if (outcome.header.width !== 640 || outcome.header.height !== 400) throw new Error(`unexpected size ${JSON.stringify(outcome.header)}`);
      if (outcome.magic.join(',') !== '137,80,78,71') throw new Error('the result is not a PNG');
      await open('background-remover');
      await driver.sleep(1500);
      if ((await driver.findElements(By.css('[data-testid=ai-gate]'))).length > 0) throw new Error('the tool still asks for downloads');
    });
  }

  await check('the converters find installed programs and refuse unknown files', async () => {
    const found = await invoke('convert_programs');
    if (typeof found.programs !== 'object' || !('ffmpeg' in found.programs)) throw new Error('no program list');
    // FFmpeg is on most Linux desktops and CI images; say so when it is not, without failing.
    if (!found.programs.ffmpeg) console.log('        (FFmpeg is not installed here)');
    try {
      await invoke('convert_run', { job: { id: 'test', recipe: 'media-convert', inputs: ['not-a-token'], destination: 'beside' } });
      throw new Error('an unknown file token was accepted');
    } catch (error) {
      if (!/Choose the file again/.test(String(error.message))) throw error;
    }
  });

  await check('the calculator library solves in the web view', async () => {
    await open('calc-finance');
    await driver.wait(async () => /8,?678\.23/.test(await driver.executeScript("return document.querySelector('[data-testid=calc-field-payment] input')?.value ?? ''")), 20_000, 'no EMI');
  });

  const runExample = async (id) => {
    await open('circuit-simulator');
    await driver.executeScript(`const s = document.querySelector('[data-testid=cs-examples]'); s.value = '${id}'; s.dispatchEvent(new Event('change', { bubbles: true }));`);
    await driver.sleep(300);
    await driver.executeScript("document.querySelector('[data-testid=cs-run]').click()");
  };
  const serialText = () => driver.executeScript("return document.querySelector('[data-testid=cs-serial-log]')?.textContent ?? ''");

  await check('the circuit simulator runs an Arduino Uno sketch (avr8js)', async () => {
    await runExample('uno-dimmer');
    await driver.wait(async () => /A0 = \d+/.test(await serialText()), 20_000, 'no serial output from the Uno');
    await driver.executeScript("document.querySelector('[data-testid=cs-reset]').click()");
  });

  await check('the ESP32 emulator runs the demo firmware', async () => {
    const info = await driver.executeAsyncScript("const done = arguments[0]; window.__TAURI_INTERNALS__.invoke('esp32_info').then(done, (e) => done({ available: false, detail: String(e) }));");
    if (!info.available) throw new Error(`ESP32 emulator unavailable: ${info.detail}`);
    await runExample('esp32-demo');
    await driver.wait(async () => /uptime 2 s/.test(await serialText()), 30_000, `no uptime from the ESP32: ${await serialText()}`);
    const text = await serialText();
    if (!text.includes('Benchtop ESP32 demo')) throw new Error(`no banner: ${text.slice(0, 200)}`);
    await driver.executeScript("document.querySelector('[data-testid=cs-reset]').click()");
  });

  await check('units convert with Indian digit grouping, and steam properties solve (IAPWS-IF97)', async () => {
    await open('unit-converter');
    const ask = await driver.findElement(By.css('[data-testid=uc-ask]'));
    await ask.clear();
    await ask.sendKeys('5 bigha (UP) in acres');
    await driver.wait(async () => /3\.0991736 acre/.test(await driver.findElement(By.css('[data-testid=uc-ask-answer]')).getText()), 10_000, 'no answer');
    const lakh = await driver.executeScript("return (100000).toLocaleString('en-IN')");
    if (lakh !== '1,00,000') throw new Error(`Indian grouping gave ${lakh}`);
    await open('steam-tables');
    await driver.wait(async () => /2943\.22/.test(await driver.findElement(By.css('[data-testid=st-table]')).getText()), 10_000, 'no steam properties');
  });

  await check("a recipe bakes in its own worker, including an operation from CyberChef's code", async () => {
    await open('recipe');
    await driver.findElement(By.xpath("//button[normalize-space()='Load']")).click();
    const box = await driver.wait(until.elementLocated(By.css('textarea[placeholder^="Paste a CyberChef recipe"]')), 10_000);
    await box.sendKeys(
      JSON.stringify([
        { op: 'To Base64', args: ['A-Za-z0-9+/='] },
        { op: 'MD6', args: [256, 64, ''] },
      ]),
    );
    await driver.findElement(By.xpath("//button[normalize-space()='Load recipe']")).click();
    await driver.wait(async () => (await driver.findElements(By.css('[data-testid=recipe-step]'))).length === 2, 10_000, 'the recipe did not load');
    await driver.executeScript(
      `const view = document.querySelector('[data-testid=recipe-input] .cm-content')?.cmTile?.root?.view;
       view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'abc' } });`,
    );
    const expected = 'e90c0314b7630e3d90e13023ced295c6cfc8e167e578bacfe7181cc0d52cd8d6';
    await driver.wait(
      async () => (await driver.executeScript("return document.querySelector('[data-testid=recipe-output] .cm-content')?.textContent ?? ''")).includes(expected),
      60_000,
      'no MD6 digest from the recipe worker',
    );
  });

  await check('a dropped file is staged in a folder only this user can read', async () => {
    const staged = await driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__.invoke('stage_file', new Uint8Array([104, 105]), { headers: { 'x-file-name': encodeURIComponent('desktop check.txt') } })
         .then((file) => done(file), (error) => done({ error: String(error) }));`,
    );
    if (staged.error || staged.name !== 'desktop check.txt' || staged.size !== 2) throw new Error(JSON.stringify(staged));
    const root = resolve(process.env.XDG_CACHE_HOME || resolve(homedir(), '.cache'), 'app.benchtop.desktop/dropped');
    const holder = readdirSync(root)
      .map((name) => resolve(root, name))
      .find((dir) => existsSync(resolve(dir, 'desktop check.txt')));
    if (!holder) throw new Error(`no staged copy under ${root}`);
    for (const dir of [root, holder]) {
      const mode = statSync(dir).mode & 0o777;
      if (mode !== 0o700) throw new Error(`${dir} has mode ${mode.toString(8)}`);
    }
  });

  await check('Media Info reads a staged file with FFprobe', async () => {
    // A tenth of a second of 8 kHz, 16-bit mono silence, written here so no sample file is needed.
    const samples = 800;
    const wav = new Uint8Array(44 + samples * 2);
    const view = new DataView(wav.buffer);
    const text = (at, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples * 2, true);
    const staged = await driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__.invoke('stage_file', new Uint8Array(arguments[0]), { headers: { 'x-file-name': 'tone.wav' } })
         .then((file) => done(file), (error) => done({ error: String(error) }));`,
      [...wav],
    );
    if (staged.error || !staged.token) throw new Error(JSON.stringify(staged));
    let report;
    try {
      report = await invoke('convert_media_info', { token: staged.token });
    } catch (error) {
      // FFprobe comes with FFmpeg; say so when it is missing, without failing.
      if (/FFprobe/.test(String(error.message)) && /install/i.test(String(error.message))) {
        console.log('        (FFprobe is not installed here)');
        return;
      }
      throw error;
    }
    const stream = report?.streams?.[0];
    if (stream?.codec_name !== 'pcm_s16le' || Number(stream.sample_rate) !== 8000 || Math.abs(Number(report.format?.duration) - 0.1) > 0.01) throw new Error(JSON.stringify(report).slice(0, 400));
    const refused = await invoke('convert_media_info', { token: 'not-a-token' }).then(
      () => 'accepted',
      (error) => String(error.message),
    );
    if (!/Choose the file again/.test(refused)) throw new Error(`an unknown token gave: ${refused}`);
  });

  await check('only release pages can be opened in the system browser', async () => {
    const refused = await invoke('open_release_page', { tag: '../../evil' }).then(
      () => 'opened',
      (error) => String(error.message),
    );
    if (!/not a release tag/.test(refused)) throw new Error(refused);
  });

  await check('PDF pages are read and drawn (pdf-lib and PDF.js in the web view)', async () => {
    await open('pdf-organise');
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 3; i++) doc.addPage([595, 842]).drawText(`Page ${i}`, { x: 60, y: 760, size: 28, font });
    await dropFiles('[data-testid=pdf-drop]', [[await doc.save(), 'three.pdf', 'application/pdf']]);
    await driver.wait(async () => (await driver.findElements(By.css('.pdf-page .pdf-thumb img'))).length === 3, 30_000, 'page pictures did not appear');
  });

  await check('text recognition runs in the web view (Tesseract WebAssembly)', async () => {
    await open('ocr');
    await dropFiles('.dropzone', [[readFileSync(resolve(ROOT, 'tests/e2e/fixtures/ocr.png')), 'note.png', 'image/png']]);
    await driver.findElement(By.css('[data-testid=ocr-run]')).click();
    await driver.wait(
      async () => (await driver.executeScript("return document.querySelector('[data-testid=ocr-output] .cm-content')?.textContent ?? ''")).includes('offline'),
      120_000,
      'no text recognised',
    );
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
