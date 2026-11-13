import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // Vitest replaces stylesheets with empty strings unless told otherwise; the
    // Bootstrap theme builder imports Bootstrap's Sass sources as raw text.
    css: { include: [/node_modules\/bootstrap\/scss\//] },
  },
});
