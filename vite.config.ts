import { readFileSync } from 'node:fs';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { collectLicenses, renderNotice } from './scripts/licenses.mjs';

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

function licenceNotices(): Plugin {
  return {
    name: 'benchtop:licences',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-LICENSES.txt', source: renderNotice(collectLicenses()) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), contentSecurityPolicy(), licenceNotices()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    // The Sass compiler used by the Bootstrap theme builder is large; it loads only with that tool.
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
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
