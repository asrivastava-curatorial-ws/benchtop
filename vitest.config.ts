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
    // Material Color Utilities 0.4.0 has a few imports without the .js
    // extension; Vite resolves them, Node's own loader does not.
    server: { deps: { inline: ['@material/material-color-utilities'] } },
  },
});
