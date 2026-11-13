import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build (`pnpm build`), served by
 * `vite preview`, so they exercise the real bundle with its content security
 * policy.  They use the installed Google Chrome; set PW_BUNDLED=1 to use
 * Playwright's own Chromium instead (`pnpm exec playwright install chromium`).
 */
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    channel: process.env.PW_BUNDLED ? undefined : 'chrome',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    trace: process.env.PW_TRACE ? 'retain-on-failure' : 'off',
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
