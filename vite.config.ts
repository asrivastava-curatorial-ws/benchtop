import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { collectCrates, collectLicenses, renderNotice } from './scripts/licenses.mjs';
import { frameHtml } from './scripts/svgjs-frame.mjs';
import { codeFrameHtml } from './src/lib/code-frames';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * The content security policy shipped with the app.  Nothing may be loaded
 * from the network: scripts, styles, fonts and images come from the app itself
 * or from data/blob URLs it creates.  Only applied to production builds, since
 * the dev server needs inline scripts and a WebSocket for hot reloading.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  // ipc: and http://ipc.localhost are how the desktop shell talks to its Rust side.
  "connect-src 'self' ipc: http://ipc.localhost data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: data:",
  "child-src 'self' blob:",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

/**
 * Writes the SVG.js editor's drawing frame (public/svgjs/frame.html): a page with the
 * SVG.js library inside it.  It is shown in a sandboxed frame and carries a policy of
 * its own, because it runs the code typed into the editor.
 */
function svgjsFrame(): Plugin {
  const write = () => {
    const require = createRequire(import.meta.url);
    const library = readFileSync(join(dirname(require.resolve('@svgdotjs/svg.js')), 'svg.min.js'), 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
    const target = fileURLToPath(new URL('public/svgjs/frame.html', import.meta.url));
    const html = frameHtml(library);
    if (existsSync(target) && readFileSync(target, 'utf8') === html) return;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, html);
  };
  return { name: 'benchtop:svgjs-frame', buildStart: write, configureServer: write };
}

/**
 * Writes the D3.js and anime.js editors' frames (public/d3/frame.html and
 * public/anime/frame.html), the same way: the library inside a page with a
 * policy of its own.
 */
function codeFrames(): Plugin {
  const write = () => {
    const libraries: [string, string][] = [
      ['d3', fileURLToPath(new URL('node_modules/d3/dist/d3.min.js', import.meta.url))],
      ['anime', fileURLToPath(new URL('node_modules/animejs/dist/bundles/anime.umd.min.js', import.meta.url))],
    ];
    for (const [kind, file] of libraries) {
      const library = readFileSync(file, 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
      const target = fileURLToPath(new URL(`public/${kind}/frame.html`, import.meta.url));
      const html = codeFrameHtml(kind as 'd3' | 'anime', library);
      if (existsSync(target) && readFileSync(target, 'utf8') === html) continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, html);
    }
  };
  return { name: 'benchtop:code-frames', buildStart: write, configureServer: write };
}

function contentSecurityPolicy(): Plugin {
  return {
    name: 'benchtop:csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' }],
    },
  };
}

/**
 * Copies the Tesseract.js worker and its WebAssembly cores from node_modules
 * into public/tesseract, so OCR works offline from the app's own origin, and
 * OpenChemLib's torsion tables (for 3D molecules) into public/openchemlib.  The
 * English language data (tessdata_fast, Apache-2.0) is kept in the repository.
 */
function ocrAssets(): Plugin {
  const copy = () => {
    const require = createRequire(import.meta.url);
    const worker = join(dirname(require.resolve('tesseract.js/package.json')), 'dist', 'worker.min.js');
    const core = dirname(createRequire(worker).resolve('tesseract.js-core/package.json'));
    const files: [string, string][] = [
      [worker, 'public/tesseract/worker.min.js'],
      ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'].map((name) => [join(core, name), `public/tesseract/core/${name}`] as [string, string]),
      // The package exports only its entry point, so the resources are found beside it.
      [join(dirname(require.resolve('openchemlib')), 'resources.json'), 'public/openchemlib/resources.json'],
    ];
    for (const [from, to] of files) {
      const target = fileURLToPath(new URL(to, import.meta.url));
      if (existsSync(target) && statSync(target).size === statSync(from).size) continue;
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(from, target);
    }
  };
  // The config hook runs before Vite indexes the public folder, in dev and build alike.
  return { name: 'benchtop:ocr-assets', config: () => void copy() };
}

/**
 * Copies the Code Runner's language runtimes from node_modules into
 * public/coderun, so they load offline from the app's own origin: Pyodide
 * (CPython compiled to WebAssembly, MPL-2.0), wasmoon (Lua 5.4, MIT) and
 * sql.js (SQLite, MIT).  Workers load them with importScripts.
 */
function codeRuntimes(): Plugin {
  const copy = () => {
    const require = createRequire(import.meta.url);
    const pyodide = dirname(require.resolve('pyodide/package.json'));
    const wasmoon = dirname(require.resolve('wasmoon/package.json'));
    // sql.js exports only its entry point, which sits beside the files wanted.
    const sqljs = dirname(require.resolve('sql.js'));
    const files: [string, string][] = [
      ...['pyodide.js', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'].map((name) => [join(pyodide, name), `public/coderun/pyodide/${name}`] as [string, string]),
      [join(wasmoon, 'dist', 'index.js'), 'public/coderun/lua/wasmoon.js'],
      [join(wasmoon, 'dist', 'glue.wasm'), 'public/coderun/lua/glue.wasm'],
      [join(sqljs, 'sql-wasm.js'), 'public/coderun/sqljs/sql-wasm.js'],
      [join(sqljs, 'sql-wasm.wasm'), 'public/coderun/sqljs/sql-wasm.wasm'],
    ];
    for (const [from, to] of files) {
      const target = fileURLToPath(new URL(to, import.meta.url));
      if (existsSync(target) && statSync(target).size === statSync(from).size && statSync(target).mtimeMs >= statSync(from).mtimeMs) continue;
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(from, target);
    }
  };
  return { name: 'benchtop:code-runtimes', config: () => void copy() };
}

/**
 * The web workers are entries of the main build rather than separate worker
 * builds, so the libraries they share with the window (Sass, Prettier, the
 * barcode writer, CyberChef's operations...) are stored once, not three times.
 * Their files keep fixed names because the window starts them by name.
 */
const WORKERS: Record<string, string> = {
  'text-worker': 'src/worker/worker.ts',
  'recipe-worker': 'src/recipe/worker.ts',
};

/**
 * Vite's helper for lazy imports reports a failed import on `window`, which a
 * worker does not have; `self` is the window in a page and the worker's own
 * scope in a worker.  The build stops if the helper no longer matches, and if
 * any chunk a worker can reach would preload stylesheets (which needs a document).
 */
function workerSafeChunks(): Plugin {
  return {
    name: 'benchtop:worker-safe-chunks',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const helper = chunks.filter((chunk) => chunk.moduleIds.some((id) => id.includes('vite/preload-helper')));
      for (const chunk of helper) {
        const patched = chunk.code.replace('window.dispatchEvent(', 'self.dispatchEvent(');
        if (patched === chunk.code) this.error(`The lazy-import helper in ${chunk.fileName} changed; check it can run in a worker.`);
        chunk.code = patched;
      }
      const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const reached = new Set<string>();
      const visit = (fileName: string) => {
        const chunk = byName.get(fileName);
        if (!chunk || reached.has(fileName)) return;
        reached.add(fileName);
        if (chunk.code.includes('__vite__mapDeps')) this.error(`${fileName} is loaded by a worker but preloads stylesheets, which needs a document.`);
        for (const next of [...chunk.imports, ...chunk.dynamicImports]) visit(next);
      };
      for (const chunk of chunks) if (chunk.isEntry && chunk.name in WORKERS) visit(chunk.fileName);
      for (const page of chunks.filter((chunk) => chunk.isEntry && !(chunk.name in WORKERS))) {
        if (reached.has(page.fileName)) this.error(`A worker would load the ${page.name} page entry and start it inside the worker.`);
      }
    },
  };
}

function licenceNotices(): Plugin {
  return {
    name: 'benchtop:licences',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-LICENSES.txt', source: renderNotice(collectLicenses(), collectCrates()) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), ocrAssets(), codeRuntimes(), svgjsFrame(), codeFrames(), contentSecurityPolicy(), workerSafeChunks(), licenceNotices()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  worker: {
    format: 'es',
  },
  // HarfBuzz finds its WebAssembly beside its own module; pre-bundling would move it.
  // crypto-api (used by CyberChef's hash code) imports its files without
  // extensions, which the pre-bundler refuses in .mjs files; Vite serves it as is.
  optimizeDeps: {
    exclude: ['harfbuzzjs', 'crypto-api'],
  },
  build: {
    target: 'es2022',
    // The Sass compiler used by the Bootstrap theme builder is large; it loads only with that tool.
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
    // Chunks load from the app itself, so preloading what a lazy chunk imports
    // gains little, and the preloader needs a document, which workers lack.
    modulePreload: false,
    rolldownOptions: {
      // deck.html is the Slide Deck tool's preview, a page of its own shown in a frame;
      // join.html is the page people open to take part in a Live Quiz.
      input: { index: 'index.html', deck: 'deck.html', join: 'join.html', ...WORKERS },
      output: {
        entryFileNames: (chunk) => (chunk.name in WORKERS ? 'assets/[name].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  // Keep the Tauri CLI's terminal output readable.
  clearScreen: false,
});
