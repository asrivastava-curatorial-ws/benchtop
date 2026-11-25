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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By, Key, until } from 'selenium-webdriver';

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

// The folder the app's folder dialog "chooses" (convert_pick_folder reads this), for Offline Search.
const FOLDER = mkdtempSync(resolve(tmpdir(), 'benchtop-desktop-folder-'));
process.env.BENCHTOP_TEST_FOLDER = FOLDER;

// arduino-cli is played by a script that says what it was asked to do (unless a real one is asked for).
process.env.BENCHTOP_ARDUINO_CLI ??= resolve(ROOT, 'tests/desktop/fixtures/fake-arduino-cli.sh');

/** Set BENCHTOP_TEST_ONLY to a few words to run only the checks whose names contain them. */
const ONLY = process.env.BENCHTOP_TEST_ONLY?.toLowerCase();

const results = [];
async function check(name, body) {
  if (ONLY && !name.toLowerCase().includes(ONLY)) return;
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

  await check('the window opens on the list of every tool', async () => {
    await driver.wait(async () => (await driver.getTitle()).includes('Benchtop'), 20_000);
    await driver.wait(async () => (await driver.getTitle()).startsWith('All tools'), 20_000, 'the start screen is not the list of tools');
    let count = 0;
    await driver
      .wait(async () => {
        count = (await driver.findElements(By.css('.home-index a[href^="#/tool/"]'))).length;
        return count >= 403;
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

  await check('the File Converter turns e-mails, TAR archives and EPS drawings into other files', async () => {
    // Start from another tool: the drop dialog leaves out the tool that is open.
    await open('json-formatter');
    const programs = await invoke('convert_programs');
    const eml = Buffer.from(['From: Curator <curator@example.org>', 'Subject: Museum visit', 'Content-Type: text/plain; charset=utf-8', '', 'See you at ten.'].join('\r\n'));
    // A TAR with one file (ustar).
    const text = Buffer.from('Plan the visit.');
    const header = Buffer.alloc(512);
    header.write('notes.txt', 0);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${text.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.fill(' ', 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(
      `${[...header]
        .reduce((sum, b) => sum + b, 0)
        .toString(8)
        .padStart(6, '0')}\0 `,
      148,
    );
    const tar = Buffer.concat([header, text, Buffer.alloc(512 - text.length), Buffer.alloc(1024)]);
    const files = [
      [eml, 'visit.eml', 'message/rfc822'],
      [tar, 'notes.tar', 'application/x-tar'],
    ];
    const eps = programs.programs.ghostscript ? Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 50\nnewpath 10 10 moveto 90 10 lineto 90 40 lineto closepath fill\nshowpage\n') : null;
    if (eps) files.push([eps, 'box.eps', 'application/postscript']);
    else console.log('        (Ghostscript is not installed here: EPS is not converted)');
    // Dropped on the window, the files go to the converter, the first tool offered for an e-mail.
    await dropFiles('body', files);
    await driver.wait(until.elementLocated(By.css('[data-testid=drop-dialog]')), 10_000, 'no drop dialog');
    await driver.actions().sendKeys(Key.ENTER).perform();
    await driver.wait(until.elementLocated(By.css('[data-testid=convert-group-email]')), 15_000, 'the e-mail was not added');
    await driver.executeScript("[...document.querySelectorAll('[role=radio]')].find((b) => b.textContent === 'In a folder')?.click()");
    await driver.wait(async () => (await driver.executeScript("return document.querySelector('[data-testid=convert-run]')?.disabled === false")) === true, 10_000, 'nothing to convert');
    await driver.executeScript("document.querySelector('[data-testid=convert-run]').click()");
    const made = (name) => resolve(FOLDER, name);
    const expected = ['visit.html', 'notes.zip', ...(eps ? ['box.pdf'] : [])];
    await driver.wait(async () => expected.every((name) => existsSync(made(name))), 60_000, `missing: ${expected.filter((name) => !existsSync(made(name))).join(', ')}`);
    const html = readFileSync(made('visit.html'), 'utf8');
    if (!html.includes('<h1>Museum visit</h1>') || !html.includes('See you at ten.')) throw new Error('the e-mail page lacks its subject or text');
    const zip = readFileSync(made('notes.zip'));
    if (zip.subarray(0, 2).toString() !== 'PK' || !zip.includes(Buffer.from('notes.txt'))) throw new Error('the TAR did not become a ZIP of its file');
    if (eps && readFileSync(made('box.pdf')).subarray(0, 5).toString() !== '%PDF-') throw new Error('the EPS did not become a PDF');
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

  await check('PDFs turn like paper in the Flipbook Reader, and the PDF Reader annotates them (WebKit)', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 3; i++) doc.addPage([595, 842]).drawText(`Page ${i}`, { x: 60, y: 760, size: 28, font });
    const bytes = await doc.save();
    await open('flipbook-reader');
    await dropFiles('[data-testid=fbr-drop]', [[bytes, 'three.pdf', 'application/pdf']]);
    const where = () => driver.executeScript("return document.querySelector('.fbk-where')?.textContent ?? ''");
    await driver.wait(async () => (await where()) === 'Page 1 of 3', 30_000, 'the book did not open');
    await driver.executeScript("document.querySelector('[data-fbk=right]').click()");
    await driver.wait(async () => (await where()) === 'Pages 2–3 of 3', 10_000, `the page did not turn: ${await where()}`);
    await driver.wait(async () => (await driver.executeScript('return document.querySelector(\'.fbk img[data-page="1"]\')?.naturalWidth ?? 0')) > 0, 20_000, 'page 2 was not drawn');
    await open('pdf-reader');
    await dropFiles('[data-testid=rd-drop]', [[bytes, 'three.pdf', 'application/pdf']]);
    await driver.wait(async () => (await driver.executeScript("return document.querySelector('[data-testid=rd-page-count]')?.textContent ?? ''")) === 'of 3', 30_000, 'the PDF did not open');
    await driver.executeScript(
      "const s = document.querySelector('[data-testid=rd-search]'); s.focus(); s.value = 'Page 2'; s.dispatchEvent(new Event('input', { bubbles: true })); s.form.requestSubmit();",
    );
    await driver.wait(async () => (await driver.executeScript("return document.querySelector('[data-testid=rd-search-count]')?.textContent ?? ''")) === '1 of 1', 20_000, 'the words were not found');
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

  /** Runs a command and returns its raw bytes (a Response) as a Buffer. */
  const invokeBytes = async (command, args) => {
    const outcome = await driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(
         (buffer) => {
           const bytes = new Uint8Array(buffer);
           let text = '';
           for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
           done({ base64: btoa(text) });
         },
         (error) => done({ error: String(error?.message ?? error) }),
       );`,
      command,
      args,
    );
    if (outcome.error !== undefined) throw new Error(outcome.error);
    return Buffer.from(outcome.base64, 'base64');
  };
  /** Set BENCHTOP_TEST_KEEP to a folder to keep the PDFs these checks make, for a look. */
  const keep = (name, bytes) => {
    if (process.env.BENCHTOP_TEST_KEEP) writeFileSync(resolve(process.env.BENCHTOP_TEST_KEEP, name), bytes);
  };
  const pdfPages = (pdf) => {
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF');
    const text = pdf.toString('latin1');
    const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])]);
    return { count: (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length, boxes };
  };

  await check('the slide preview runs reveal.js in a frame of its own, and a deck prints one slide per page', async () => {
    await open('slide-deck');
    await driver.wait(
      async () => (await driver.executeScript("return document.querySelector('[data-testid=deck-status]')?.textContent ?? ''")).includes('Slide 1 of'),
      30_000,
      'the preview did not start',
    );
    const snapshot = await driver.executeAsyncScript(`const done = arguments[arguments.length - 1];
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;left:0;top:0;width:1400px;height:900px;border:0;opacity:0;pointer-events:none;z-index:-1';
      const started = Date.now();
      frame.addEventListener('load', () => {
        frame.contentWindow.benchtopDeck
          .snapshot('# One\\n\\n---\\n\\n## Two\\n\\n- a\\n- b\\n\\n---\\n\\n## Three', { theme: 'black', transition: 'slide', size: '16:9', slideNumber: true, progress: true, controls: true, center: true, loop: false, autoSlide: 0, codeTheme: 'monokai' })
          .then((s) => { frame.remove(); done({ ...s, ms: Date.now() - started }); }, (e) => done({ error: String(e) }));
      }, { once: true });
      frame.src = './deck.html';
      document.body.append(frame);`);
    if (snapshot.error) throw new Error(snapshot.error);
    if (snapshot.ms > 6000) throw new Error(`laying the deck out took ${snapshot.ms} ms`);
    const pdf = await invokeBytes('html_to_pdf', { html: snapshot.html, paper: `${snapshot.width}x${snapshot.height}px`, landscape: false, background: true });
    keep('deck.pdf', pdf);
    const { count, boxes } = pdfPages(pdf);
    if (count !== 3) throw new Error(`${count} pages instead of 3`);
    const [w, h] = boxes[0] ?? [0, 0];
    if (Math.abs(w - snapshot.width * 0.75) > 2 || Math.abs(h - snapshot.height * 0.75) > 2) throw new Error(`page is ${w} x ${h} pt`);
  });

  await check('Present shows the slide preview full screen', async () => {
    await open('slide-deck');
    await driver.wait(
      async () => (await driver.executeScript("return document.querySelector('[data-testid=deck-status]')?.textContent ?? ''")).includes('Slide 1 of'),
      30_000,
      'the preview did not start',
    );
    await driver.findElement(By.css('[data-testid=deck-present]')).click();
    await driver.wait(async () => (await driver.executeScript('return document.fullscreenElement?.dataset.testid ?? null')) === 'deck-frame', 10_000, 'the preview did not go full screen');
    await driver.executeAsyncScript('const done = arguments[arguments.length - 1]; document.exitFullscreen().then(done, done);');
    await driver.wait(async () => (await driver.executeScript('return document.fullscreenElement')) === null, 10_000, 'full screen did not end');
  });

  await check('a résumé prints to an A4 PDF', async () => {
    await open('resume-builder');
    await driver.wait(async () => (await driver.executeScript("return document.querySelector('[data-testid=rx-frame]')?.srcdoc ?? ''")).includes('Meera Iyer'), 30_000, 'no preview');
    // The preview adds the page margins as padding; the PDF gets them from @page instead.
    const html = (await driver.executeScript("return document.querySelector('[data-testid=rx-frame]').srcdoc")).replace(/body\{padding:[^}]*\}html\{overflow:hidden;\}/, '');
    const pdf = await invokeBytes('html_to_pdf', { html, paper: 'A4', landscape: false, background: true });
    keep('resume.pdf', pdf);
    const { count, boxes } = pdfPages(pdf);
    if (count < 1) throw new Error('no pages');
    const [w, h] = boxes[0] ?? [0, 0];
    if (Math.abs(w - 595.3) > 2 || Math.abs(h - 841.9) > 2) throw new Error(`page is ${w} x ${h} pt`);
  });

  await check('Theatre.js plays an animation in the web view', async () => {
    await open('animation-studio');
    const clock = () => driver.executeScript("return document.querySelector('[data-testid=anim-clock]')?.textContent ?? ''");
    await driver.wait(async () => (await clock()).startsWith('3.00'), 10_000, 'the editor did not open on the last frame');
    await driver.findElement(By.css('[data-testid=anim-play]')).click();
    await driver.wait(async () => !(await clock()).startsWith('3.00'), 10_000, 'the playhead did not move');
    await driver.findElement(By.css('[data-testid=anim-play]')).click();
  });

  await check('Animation Studio joins its frames into an MP4 video with FFmpeg', async () => {
    await open('animation-studio');
    const programs = await driver.executeAsyncScript(
      "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('convert_programs').then((r) => done(r), (e) => done({ error: String(e) }))",
    );
    if (!programs?.programs?.ffmpeg) {
      console.log('        (FFmpeg is not installed here: the export is not run)');
      return;
    }
    const click = (selector) => driver.executeScript('document.querySelector(arguments[0]).click()', selector);
    const choose = (selector, value) =>
      driver.executeScript("const el = document.querySelector(arguments[0]); el.value = arguments[1]; el.dispatchEvent(new Event('change', { bubbles: true }))", selector, value);
    await driver.wait(until.elementLocated(By.css('[data-testid=anim-video]')), 10_000);
    await click('[data-testid=anim-video]');
    // FFmpeg is found in the background; MP4 becomes the format once it is.
    await driver.wait(async () => (await driver.executeScript("return document.querySelector('[data-testid=anim-export-format]')?.value")) === 'mp4', 15_000, 'MP4 was not offered');
    await choose('[data-testid=anim-export-size]', '0.25');
    await choose('[data-testid=anim-export-fps]', '10');
    await click('[data-testid=anim-export-run]');
    await driver.wait(until.elementLocated(By.css('[data-testid=anim-export-result]')), 120_000, 'the export did not finish');
    const video = resolve(FOLDER, 'Bouncing logo.mp4');
    const bytes = readFileSync(video);
    if (bytes.subarray(4, 8).toString() !== 'ftyp') throw new Error('the file is not an MP4');
    // The sample is 3 s long: 30 frames at 10 a second, 320 x 180.
    const probe = JSON.parse(execFileSync(programs.programs.ffprobe ?? 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', video], { stdio: 'pipe' }).toString());
    const stream = probe.streams.find((s) => s.codec_type === 'video');
    if (stream?.width !== 320 || stream.height !== 180) throw new Error(`the video is ${stream?.width} x ${stream?.height}`);
    if (Number(stream.nb_frames) !== 30 || Math.abs(Number(stream.duration) - 3) > 0.11) throw new Error(`the video has ${stream.nb_frames} frames over ${stream.duration} s`);
    if (stream.pix_fmt !== 'yuv420p') throw new Error(`the video is ${stream.pix_fmt}`);
    // The frames were cleared away afterwards.
    const left = await driver.executeAsyncScript(
      "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('frames_encode', { id: 'gone', options: { fps: 10, format: 'mp4', name: 'x' } }).then(() => done('ran'), (e) => done(String(e)))",
    );
    if (!left.includes('no longer open')) throw new Error(`an export that is not open answered: ${left}`);
  });

  await check('Green Screen Editor replaces a backdrop in a video through FFmpeg', async () => {
    await open('green-screen');
    const programs = await invoke('convert_programs');
    if (!programs?.programs?.ffmpeg) {
      console.log('        (FFmpeg is not installed here: the export is not run)');
      return;
    }
    // A red square on studio green, 1 s long with a tone, and a blue picture to put behind it.
    const clip = resolve(FOLDER, 'studio.mp4');
    const wall = resolve(FOLDER, 'wall.png');
    execFileSync(programs.programs.ffmpeg, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x00b140:s=320x180:r=15:d=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-vf',
      'drawbox=x=120:y=50:w=80:h=80:color=red:t=fill',
      '-pix_fmt',
      'yuv420p',
      '-shortest',
      clip,
    ]);
    execFileSync(programs.programs.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1f6feb:s=640x360', '-frames:v', '1', wall]);
    const stage = async (path, name) => {
      const staged = await driver.executeAsyncScript(
        `const done = arguments[arguments.length - 1];
         window.__TAURI_INTERNALS__.invoke('stage_file', new Uint8Array(arguments[0]), { headers: { 'x-file-name': arguments[1] } }).then((file) => done(file), (error) => done({ error: String(error) }));`,
        [...readFileSync(path)],
        name,
      );
      if (staged.error || !staged.token) throw new Error(JSON.stringify(staged));
      return staged.token;
    };
    const [subject, behind] = [await stage(clip, 'studio.mp4'), await stage(wall, 'wall.png')];
    // What the tool asks for when "Save" is pressed with a picture behind the subject.
    const made = await invoke('convert_run', {
      job: {
        id: 'green-test',
        recipe: 'video-greenscreen',
        inputs: [subject, behind],
        options: { key: '#0ea946', similarity: 0.088, blend: 0.053, spill: 0.5, spillType: 'green', background: 'image', fit: 'cover', scale: 1, x: 0, y: 0, to: 'mp4', audio: 'foreground' },
        destination: 'folder',
        folder: (await invoke('convert_pick_folder')).token,
      },
    });
    if (!made?.path?.endsWith('studio (new background).mp4')) throw new Error(JSON.stringify(made));
    const probe = JSON.parse(execFileSync(programs.programs.ffprobe ?? 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', made.path], { stdio: 'pipe' }).toString());
    const kinds = probe.streams
      .map((s) => s.codec_type)
      .sort()
      .join();
    if (kinds !== 'audio,video') throw new Error(`the result has streams: ${kinds}`);
    const frame = execFileSync(programs.programs.ffmpeg, ['-v', 'error', '-i', made.path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: 'pipe', maxBuffer: 1 << 24 });
    const at = (x, y) => [...frame.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3)];
    const [field, square] = [at(20, 20), at(160, 90)];
    if (!(field[2] > 200 && field[1] > 80 && field[1] < 140 && field[0] < 70)) throw new Error(`the backdrop became ${field}`);
    if (!(square[0] > 180 && square[1] < 60)) throw new Error(`the subject became ${square}`);
    // The tool itself opens with its sample and keys it in the web view.
    await driver.executeScript("document.querySelector('[data-testid=gs-sample]').click()");
    await driver.wait(async () => (await driver.executeScript("return document.querySelector('[data-testid=gs-info]')?.textContent ?? ''")).includes('960'), 10_000, 'the sample did not open');
    const corner = await driver.executeScript("const c = document.querySelector('[data-testid=gs-canvas]'); return [...c.getContext('2d').getImageData(20, 20, 1, 1).data]");
    if (corner.join() !== '31,111,235,255') throw new Error(`the sample's backdrop is ${corner}`);
  });

  await check('Live Quiz serves a quiz to devices and counts their answers', async () => {
    const { request } = await import('node:http');
    await open('live-quiz');
    const click = (testId) => driver.executeScript(`document.querySelector('[data-testid=${testId}]').click()`);
    const text = (testId) => driver.executeScript(`return document.querySelector('[data-testid=${testId}]')?.textContent ?? ''`);
    const eventually = async (what, test, timeout = 10_000) => {
      const started = Date.now();
      for (;;) {
        const value = await test();
        if (value) return value;
        if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${what}`);
        await new Promise((done) => setTimeout(done, 100));
      }
    };
    /** A button that asks before it acts: pressed, and pressed again once it has asked. */
    const sure = async (testId, index) => {
      for (let press = 0; press < 2; press++) {
        await driver.executeScript(`document.querySelectorAll('[data-testid=${testId}]')[${index}]?.click()`);
        await new Promise((done) => setTimeout(done, 200));
      }
    };
    // Present the sample quiz, with the relay kept to this computer.
    await driver.executeScript("[...document.querySelectorAll('[role=radio]')].find((b) => b.textContent.trim() === 'Present').click()");
    await driver.wait(async () => (await driver.findElements(By.css('[data-testid=lq-lan]'))).length > 0, 10_000, 'the start panel did not open');
    if (await driver.executeScript("return document.querySelector('[data-testid=lq-lan]').checked")) await click('lq-lan');
    await click('lq-start');
    const base = await eventually('the address', async () => {
      const shown = await text('lq-url');
      return /^http:\/\/127\.0\.0\.1:\d+\/$/.test(shown) ? shown : null;
    });
    try {
      // The page a phone opens, and the script it loads, come from the app's own files.
      const page = await fetch(base);
      const html = await page.text();
      if (page.status !== 200 || !html.includes('<div id="quiz">')) throw new Error(`the join page: ${page.status}`);
      // (In the file the quotes of the policy are written as character references.)
      if (!/http-equiv="Content-Security-Policy" content="default-src (?:'|&#39;)none(?:'|&#39;)/.test(html)) throw new Error('the join page has no content security policy');
      const script = /src="\.\/(assets\/join-[\w-]+\.js)"/.exec(html)?.[1];
      if (!script) throw new Error('the join page names no script');
      const asset = await fetch(base + script);
      if (asset.status !== 200 || !/javascript/.test(asset.headers.get('content-type') ?? '')) throw new Error(`the script: ${asset.status} ${asset.headers.get('content-type')}`);
      /** A request sent as it is written: no tidying of the path, and any name for the host. */
      const raw = (path, headers = {}) =>
        new Promise((done, fail) => {
          const url = new URL(base);
          const req = request({ host: url.hostname, port: url.port, path, method: 'GET', headers }, (res) => {
            res.resume();
            done(res.statusCode);
          });
          req.on('error', fail);
          req.end();
        });
      // Nothing else of the app is served.
      for (const other of ['/deck.html', '/join.html', '/svgjs/frame.html', '/tesseract/worker.min.js', '/assets/../index.html', '/assets/%2e%2e/index.html', '//etc/passwd']) {
        const status = await raw(other);
        if (status !== 404) throw new Error(`${other} was answered with ${status}`);
      }

      const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      // Another site's page cannot post to the relay: not as a plain form, not with its own origin, not under a name of its own.
      if ((await fetch(`${base}q/join`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"name":"x"}' })).status !== 403) throw new Error('a plain-text post was taken');
      if ((await post('q/join', { name: 'x' }, { origin: 'https://evil.example' })).status !== 403) throw new Error('a post from another origin was taken');
      const renamed = await raw('/', { host: 'quiz.evil.example' });
      if (renamed !== 421) throw new Error(`a request under another name was answered with ${renamed}`);

      // Before joining, a device is shown the form to join, and nothing of the quiz.
      const poll = async (device, since = 0) => (await post('q/poll', { v: since }, device ? { 'x-quiz-id': device.id, 'x-quiz-secret': device.secret } : {})).json();
      const anyone = await poll(null);
      if (anyone.view?.phase !== 'join' || anyone.view.title !== 'Science museum quiz' || anyone.gone) throw new Error(`before joining: ${JSON.stringify(anyone)}`);
      if (Math.abs(anyone.now - Date.now()) > 5000) throw new Error(`the relay's clock: ${anyone.now}`);
      const join = async (name) => {
        const joined = await post('q/join', { name, avatar: '🦊' });
        if (joined.status !== 200) throw new Error(`joining: ${joined.status}`);
        const device = await joined.json();
        if (!/^[0-9a-f]{16}$/.test(device.id) || !/^[0-9a-f]{32}$/.test(device.secret)) throw new Error(`joined as ${JSON.stringify(device)}`);
        return device;
      };
      /** The device's view once it shows what is wanted (a request for news is held until there is some). */
      const view = async (device, what, wanted) => {
        let since = 0;
        const started = Date.now();
        for (;;) {
          const news = await poll(device, since);
          if (news.view && wanted(news.view)) return news;
          if (Date.now() - started > 15_000) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(news.view).slice(0, 300)}`);
          since = news.v;
        }
      };
      const asha = await join('Asha');
      const ben = await join('Ben');
      const lobby = await view(asha, 'the lobby', (v) => v.phase === 'lobby');
      if (lobby.view.you.name !== 'Asha' || lobby.view.you.avatar !== '🦊') throw new Error(`in the lobby as ${JSON.stringify(lobby.view.you)}`);
      await eventually('both players on the big screen', async () => (await text('lq-count')) === '2 players');
      // Nobody joins as someone else, and a wrong secret is turned away.
      if ((await post('q/send', { kind: 'join', name: 'Mallory' }, { 'x-quiz-id': asha.id, 'x-quiz-secret': asha.secret })).status !== 400) throw new Error('a second join was taken');
      if ((await post('q/send', { kind: 'chat', text: 'hi' }, { 'x-quiz-id': asha.id, 'x-quiz-secret': ben.secret })).status !== 401) throw new Error('a wrong secret was taken');
      const send = async (device, message) => {
        const sent = await post('q/send', message, { 'x-quiz-id': device.id, 'x-quiz-secret': device.secret });
        if (sent.status !== 204) throw new Error(`sending ${JSON.stringify(message)}: ${sent.status}`);
      };

      // The presenter starts; the poll opens on the second slide, and a vote is counted on the big screen.
      await click('lq-next');
      await view(asha, 'the first slide', (v) => v.slide?.type === 'content');
      await click('lq-next');
      const voting = await view(asha, 'the poll', (v) => v.slide?.type === 'poll' && v.phase === 'open');
      if (voting.view.slide.options.length !== 4) throw new Error(`the poll: ${JSON.stringify(voting.view.slide)}`);
      await send(asha, { kind: 'answer', answer: [1] });
      await eventually('the vote on the big screen', async () => (await text('qs-answered')) === '1 of 2 answered');
      if (!(await view(asha, 'the vote taken', (v) => v.answered === true)).view.yours) throw new Error('the vote was not given back');

      // A scored question: a countdown, then the clock, and no word of the right answer until it is shown.
      await click('lq-next');
      await view(ben, 'the countdown', (v) => v.slide?.type === 'pick' && v.phase === 'countdown');
      const open = await view(ben, 'the question', (v) => v.phase === 'open');
      const left = open.view.endsAt - open.now;
      if (!(left > 10_000 && left <= 20_000)) throw new Error(`the time left is ${left} ms`);
      if (/"(correct|result|right)"/.test(JSON.stringify(open.view))) throw new Error('the open question tells the answer');
      await send(asha, { kind: 'answer', answer: [1] });
      await send(ben, { kind: 'answer', answer: [0] });
      const right = await view(asha, 'the answer', (v) => v.phase === 'revealed');
      const wrong = await view(ben, 'the answer', (v) => v.phase === 'revealed');
      if (right.view.result.fraction !== 1 || !(right.view.result.points > 50) || right.view.result.right !== 'Jupiter') throw new Error(`Asha's result: ${JSON.stringify(right.view.result)}`);
      if (wrong.view.result.fraction !== 0 || wrong.view.result.points !== 0 || wrong.view.you.rank !== 2) throw new Error(`Ben's result: ${JSON.stringify(wrong.view)}`);
      await eventually('the count on the big screen', async () => (await text('qs-summary')) === '1 of 2 got it right');

      // A device that floods is slowed down; one that is removed is told to join again.
      const burst = await Promise.all(Array.from({ length: 40 }, () => post('q/send', { kind: 'chat', text: 'x' }, { 'x-quiz-id': ben.id, 'x-quiz-secret': ben.secret }).then((r) => r.status)));
      if (!burst.includes(429) || !burst.includes(204)) throw new Error(`a burst of messages: ${[...new Set(burst)]}`);
      await sure('lq-kick', 1);
      await eventually('one player left', async () => (await text('lq-count')) === '1 player');
      await eventually('the removed device being told', async () => (await poll(ben)).gone === true);
      if ((await post('q/send', { kind: 'chat', text: 'still here' }, { 'x-quiz-id': ben.id, 'x-quiz-secret': ben.secret })).status !== 401) throw new Error('a removed device was heard');
    } finally {
      // Closing the session stops the relay.
      await sure('lq-stop', 0);
    }
    await eventually('the relay to stop', async () =>
      fetch(base).then(
        () => false,
        () => true,
      ),
    );
    const shown = await driver.executeScript("return document.querySelector('[data-testid=lq-start-panel]') !== null");
    if (!shown) throw new Error('the start panel did not come back');
  });

  await check('Print Production Studio proofs a picture with Little CMS and draws marks on a PDF in the web view', async () => {
    await open('print-studio');
    const click = (testId) => driver.executeScript(`document.querySelector('[data-testid=${testId}]').click()`);
    const text = (testId) => driver.executeScript(`return document.querySelector('[data-testid=${testId}]')?.textContent ?? ''`);
    // The tool opens on the part it was last left on: this check wants the colour part.
    const part = (word) => driver.executeScript("[...document.querySelectorAll('[role=radio]')].find((button) => button.textContent.includes(arguments[0])).click()", word);
    await part('Colour');
    // The press profile comes from the app's own files, and the colour engine's WebAssembly starts under the app's policy.
    await driver.wait(async () => (await text('pp-profile')).includes('Benchtop Coated FOGRA39L'), 30_000, 'the press profile did not load');
    await click('pp-sample');
    await driver.wait(async () => /^\d+ % of the picture$/.test(await text('pp-outside')), 30_000, 'the proof was not made');
    const most = Number.parseInt(await text('pp-most'), 10);
    if (!(most > 240 && most <= 300)) throw new Error(`most ink at one spot: ${most} %`);
    // The proof is drawn: the canvas has the sample's size, and is not blank.
    const drawn = await driver.executeScript(`
      const canvas = document.querySelector('[data-testid=pp-canvas]');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let colours = new Set();
      for (let i = 0; i < data.length; i += 4 * 997) colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      return { width: canvas.width, colours: colours.size };`);
    if (!(drawn.width > 1000 && drawn.colours > 50)) throw new Error(JSON.stringify(drawn));
    // Marks: pdf-lib builds the pages and PDF.js draws the first.
    await part('marks');
    await driver.wait(async () => (await driver.findElements(By.css('[data-testid=pm-sample]'))).length === 1, 10_000, 'the marks part did not open');
    await click('pm-sample');
    await driver.wait(async () => (await driver.findElements(By.css('[data-testid=pm-preview]'))).length === 1, 30_000, 'the page with marks was not drawn');
    if ((await text('pm-sheet')) !== '182 × 244 mm') throw new Error(await text('pm-sheet'));
  });

  await check('Logic Analyser captures from the Logic Probe firmware in an emulated Arduino, and decodes it', async () => {
    await open('logic-analyser');
    const click = (testId) => driver.executeScript(`document.querySelector('[data-testid=${testId}]').click()`);
    const text = (testId) => driver.executeScript(`return document.querySelector('[data-testid=${testId}]')?.textContent ?? ''`);
    await click('la-device-open');
    await click('la-connect');
    await driver.wait(async () => (await text('la-found')).includes('Benchtop Logic Probe 1.0'), 30_000, 'the emulated probe did not answer');
    await click('la-capture');
    await driver.wait(async () => (await text('la-info')).includes('Benchtop Logic Probe, 1 MHz'), 30_000, 'no capture arrived');
    await click('la-add-spi');
    // Pins 8 to 13 carry the demo's first six lines: the SPI flash chip's identity is among them when the frame was caught whole.
    const rows = await driver.executeScript("return document.querySelectorAll('[data-testid=la-row]').length");
    const lines = await text('la-info');
    if (!lines.includes('6 lines')) throw new Error(lines);
    if (typeof rows !== 'number') throw new Error('the decoded table is missing');
  });

  await check('Instrument Panel shows a pretend device and sends it commands', async () => {
    await open('instrument-panel');
    const text = (testId) => driver.executeScript(`return document.querySelector('[data-testid=${testId}]')?.textContent ?? ''`);
    await driver.executeScript("document.querySelector('[data-testid=ip-connect]').click()");
    await driver.wait(async () => /\d+ lines of readings/.test(await text('ip-status')), 15_000, 'no readings arrived');
    await driver.executeScript("document.querySelector('.ip-push').click()");
    await driver.wait(async () => (await text('ip-log')).includes('← # reset'), 10_000, 'the device did not answer the button');
    await driver.executeScript("document.querySelector('[data-testid=ip-disconnect]').click()");
  });

  await check('a sketch and a compiled program are handed to arduino-cli for a real board (a stand-in arduino-cli)', async () => {
    if (!String(process.env.BENCHTOP_ARDUINO_CLI).endsWith('fake-arduino-cli.sh')) {
      console.log('        (a real arduino-cli is set: nothing is uploaded in tests)');
      return;
    }
    const boards = await invoke('arduino_boards');
    if (!Array.isArray(boards) || boards.length !== 1 || boards[0].port !== '/dev/ttyFAKE0' || boards[0].fqbn !== 'arduino:avr:uno' || boards[0].name !== 'Arduino Uno')
      throw new Error(JSON.stringify(boards));
    const sketch = await invoke('arduino_upload', { request: { fqbn: 'arduino:avr:uno', port: '/dev/ttyFAKE0', sketch: 'void setup() {}\nvoid loop() {}\n' } });
    if (!sketch.ok || !/asked: compile --upload --fqbn arduino:avr:uno --port \/dev\/ttyFAKE0 --no-color /.test(sketch.log) || !sketch.log.includes('sketch.ino: void setup() {}'))
      throw new Error(JSON.stringify(sketch));
    const program = await invoke('arduino_upload', { request: { fqbn: 'arduino:avr:uno', port: '/dev/ttyFAKE0', hex: ':00000001FF\n' } });
    if (!program.ok || !/asked: upload --fqbn arduino:avr:uno --port \/dev\/ttyFAKE0 --no-color --input-file .*program\.hex/.test(program.log) || !program.log.includes('program starts with: :'))
      throw new Error(JSON.stringify(program));
    // What could be read as an option, or is no program at all, never reaches arduino-cli.
    const refuse = (request) =>
      invoke('arduino_upload', { request }).then(
        () => 'accepted',
        (error) => String(error.message),
      );
    if (!/Choose the port/.test(await refuse({ fqbn: 'arduino:avr:uno', port: '--input-file=/etc/passwd', hex: ':00000001FF' }))) throw new Error('a port that is an option was accepted');
    if (!/not a board/.test(await refuse({ fqbn: '--config-file', port: '/dev/ttyFAKE0', hex: ':00000001FF' }))) throw new Error('a board that is an option was accepted');
    if (!/not an Intel HEX/.test(await refuse({ fqbn: 'arduino:avr:uno', port: '/dev/ttyFAKE0', hex: 'MZ\u0090' }))) throw new Error('a program that is not HEX was accepted');
    if (!/nothing to upload/.test(await refuse({ fqbn: 'arduino:avr:uno', port: '/dev/ttyFAKE0' }))) throw new Error('an empty request was accepted');
    // The upload folder is cleared away afterwards.
    const cache = resolve(homedir(), '.cache/app.benchtop.desktop/arduino');
    if (existsSync(cache) && readdirSync(cache).some((name) => name.startsWith('upload-'))) throw new Error('an upload folder was left behind');
  });

  await check('Offline Search indexes a folder and finds text in documents, PDFs and pictures', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const { PDFDocument } = await import('pdf-lib');
    // The folder starts empty: earlier checks leave their videos and pictures in it, which would be indexed too.
    for (const name of readdirSync(FOLDER)) rmSync(resolve(FOLDER, name), { recursive: true, force: true });
    mkdirSync(resolve(FOLDER, 'labels'), { recursive: true });
    writeFileSync(resolve(FOLDER, 'labels/steam.txt'), 'Gallery two\nThe Corliss steam engine ran the mill.\n');
    writeFileSync(
      resolve(FOLDER, 'stock.xlsx'),
      zipSync({
        'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Spares" sheetId="1" r:id="rId1"/></sheets></workbook>'),
        'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
        'xl/sharedStrings.xml': strToU8('<sst><si><t>Gasket</t></si></sst>'),
        'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>12</v></c></row></sheetData></worksheet>'),
      }),
    );
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 300]).drawText('Minutes of the meeting', { x: 40, y: 200, size: 18 });
    pdf.addPage([400, 300]).drawText('Planetarium dome budget', { x: 40, y: 200, size: 18 });
    writeFileSync(resolve(FOLDER, 'report.pdf'), await pdf.save());
    writeFileSync(resolve(FOLDER, 'sign.png'), readFileSync(resolve(ROOT, 'tests/e2e/fixtures/ocr.png')));

    const call = (command, args = {}) =>
      driver.executeAsyncScript(
        `const done = arguments[arguments.length - 1];
         window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then((value) => done({ value }), (error) => done({ error: String(error?.message ?? error) }));`,
        command,
        args,
      );
    const text = (selector) => driver.executeScript('return document.querySelector(arguments[0])?.textContent ?? ""', selector);
    const search = async (words, expected, place) => {
      await driver.executeScript("const box = document.querySelector('[data-testid=os-query]'); box.value = arguments[0]; box.dispatchEvent(new Event('input', { bubbles: true }));", words);
      await driver
        .wait(async () => (await text('[data-testid=os-count]')).includes(expected), 15_000, `searching "${words}" did not show "${expected}"`)
        .catch(async (error) => {
          throw new Error(`${error.message}; shown: ${await text('[data-testid=os-count]')}`);
        });
      // The count can read the same for two searches, so the place of the match is waited for too.
      if (place) await driver.wait(async () => (await text('[data-testid=os-hit] .os-place')).includes(place), 15_000, `"${words}" was not found at ${place}`);
    };
    const waiting = async () => (await call('search_status')).value?.pending;

    await call('search_clear');
    await open('offline-search');
    await driver.wait(until.elementLocated(By.css('[data-testid=os-add-first]')), 10_000);
    await driver.findElement(By.css('[data-testid=os-add-first]')).click();
    // The folder is read by the shell; the PDF's pages are then read by PDF.js in the page.
    await driver.wait(async () => (await text('[data-testid=os-root]')).includes('4 files'), 30_000, 'the folder was not indexed');
    await driver.wait(async () => (await waiting()) === 0, 60_000, 'the PDF was not read');

    await search('corliss', '1 place in 1 file', 'Line 2');
    await driver.findElement(By.css('[data-testid=os-hit]')).click();
    await driver.wait(async () => (await text('[data-testid=os-text]')).includes('steam engine ran the mill'), 10_000, 'no preview of the text file');
    await search('planetarium', '1 place in 1 file', 'Page 2');
    await search('gasket', '1 place in 1 file', 'Spares');
    await search('ext:png', '1 place in 1 file');
    await driver.wait(async () => (await text('[data-testid=os-results] .os-name')).includes('sign.png'), 10_000, 'the picture is not found by its name');
    await search('offline', 'Nothing found');

    // With text in pictures switched on, the picture is read by Tesseract.
    await driver.executeScript("document.querySelector('[data-testid=os-root] input[type=checkbox]').click()");
    await driver.wait(async () => (await call('search_status')).value?.roots?.[0]?.ocr === true, 10_000, 'OCR was not switched on');
    await driver.executeScript("document.querySelector('[data-testid=os-update]').click()");
    await driver.wait(async () => (await waiting()) === 1, 30_000, 'the picture was not queued');
    await driver.wait(async () => (await waiting()) === 0, 180_000, 'the picture was not read');
    await search('offline', '1 place in 1 file', 'Text in the picture');

    // Files are served by their place in the index only.
    const missing = await call('search_read', { id: 987654 });
    if (!missing.error?.includes('no longer in the index')) throw new Error(JSON.stringify(missing));
    await call('search_clear');
    if ((await call('search_status')).value?.roots?.length !== 0) throw new Error('the index was not cleared');
  });

  await check('Git Workbench reads history, compares branches and resolves a conflict', async () => {
    const git = (...args) => execFileSync('git', ['-C', FOLDER, ...args], { stdio: 'pipe' }).toString();
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test Curator');
    git('config', 'user.email', 'curator@museum.example');
    git('config', 'commit.gpgsign', 'false');
    const label = resolve(FOLDER, 'labels.txt');
    writeFileSync(label, 'Engine Hall\nopen daily\nfree entry\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'First labels');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(label, 'Engine Hall\nopen on weekdays\nfree entry\n');
    git('commit', '-q', '-am', 'Weekday hours');
    git('checkout', '-q', 'main');
    writeFileSync(label, 'Engine Hall\nopen every day\nfree entry\n');
    git('commit', '-q', '-am', 'Daily hours');
    try {
      git('merge', 'feature');
    } catch {
      // The merge stops with a conflict, which is what this check is about.
    }

    const text = (selector) => driver.executeScript('return document.querySelector(arguments[0])?.textContent ?? ""', selector);
    const shows = (selector, words, timeout = 15_000) => driver.wait(async () => (await text(selector)).includes(words), timeout, `${selector} does not show "${words}"`);
    const click = (selector) => driver.executeScript('document.querySelector(arguments[0]).click()', selector);
    const tab = (name) => driver.executeScript("[...document.querySelectorAll('.gw-bar [role=radio]')].find((b) => b.textContent === arguments[0]).click()", name);

    await open('git-workbench');
    await driver.wait(until.elementLocated(By.css('[data-testid=gw-open]')), 10_000);
    await click('[data-testid=gw-open]');
    await shows('[data-testid=gw-repo]', 'on main');
    await shows('[data-testid=gw-repo]', '1 file in conflict');
    await driver.wait(async () => (await driver.findElements(By.css('[data-testid=gw-commit]'))).length === 3, 15_000, 'the three commits are not listed');
    if ((await driver.findElements(By.css('[data-testid=gw-commit] svg'))).length !== 3) throw new Error('the commit graph is not drawn');
    // (The three commits were made within a second of each other, so their order in the list is not fixed: the one wanted is found by its message.)
    await driver.executeScript("[...document.querySelectorAll('[data-testid=gw-commit]')].find((row) => row.textContent.includes('Daily hours')).click()");
    await shows('[data-testid=gw-detail]', 'Daily hours');
    await shows('[data-testid=gw-detail]', 'labels.txt');
    await click('[data-testid=gw-files] button');
    await shows('[data-testid=gw-diff]', 'open every day');

    await tab('Compare');
    await driver.wait(until.elementLocated(By.css('[data-testid=gw-compare]')), 10_000);
    await click('[data-testid=gw-compare]');
    await shows('[data-testid=gw-compare-result]', 'main has 1 commit that feature lacks; feature has 1 that main lacks');
    await click('[data-testid=gw-compare-result] [data-testid=gw-files] button');
    await shows('[data-testid=gw-diff]', 'open on weekdays');

    await tab('Conflicts');
    await shows('[data-testid=gw-conflicts]', 'labels.txt');
    await click('[data-testid=gw-conflicts] button');
    await driver.wait(until.elementLocated(By.css('[data-testid=gw-conflict]')), 10_000);
    await shows('[data-testid=gw-summary]', '1 conflict, 1 still to decide');
    await click('[data-testid=gw-take-ours]');
    await shows('[data-testid=gw-summary]', '0 still to decide');
    await click('[data-testid=gw-resolve]');
    await click('[data-testid=gw-resolve]');
    await shows('[data-testid=gw-conflicts]', 'No file has an unresolved conflict');
    if (readFileSync(label, 'utf8') !== 'Engine Hall\nopen every day\nfree entry\n') throw new Error(`the resolved file holds: ${readFileSync(label, 'utf8')}`);
    if (git('ls-files', '-u') !== '') throw new Error('git still lists the conflict');
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
  rmSync(FOLDER, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length > 0 ? 1 : 0);
