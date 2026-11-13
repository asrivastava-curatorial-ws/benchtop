# Architecture

Benchtop is a web app (Preact, TypeScript, Vite) inside a thin native shell (Tauri 2). All tool logic is TypeScript that runs in the system web view; the Rust side only opens the window, reads and writes the clipboard, shows the "Save as" dialog and keeps the window on the app's own pages.

## Tools are data

Most tools are a declarative spec: a list of options plus one pure function. Generic views turn the spec into a complete screen, so every tool behaves the same way (sample input, open and save, copy, swap, persisted options, error reporting) and the pure function is what the tests exercise.

| Kind             | Defined with                              | View                    | Runs                                                      |
| ---------------- | ----------------------------------------- | ----------------------- | --------------------------------------------------------- |
| Text             | `defineTextTool({ input, options, run })` | `ui/TextToolView.tsx`   | In a Web Worker, with a main-thread fallback              |
| Visual generator | `defineVisualTool({ controls, render })`  | `ui/VisualToolView.tsx` | On the main thread; `render` returns preview JSX and code |
| Image            | `defineImageTool({ controls, process })`  | `ui/ImageToolView.tsx`  | On a reduced copy for the preview, full size when saving  |
| Custom           | `defineCustomTool(Component)`             | the component itself    | Anything                                                  |

Option types are `select`, `segmented`, `toggle`, `number`, `range`, `text`, `color`, `list` (repeatable groups, such as gradient stops) and `heading`. The values a tool receives are typed from its option list, so a typo in an option key is a compile error.

Every tool is loaded on demand: `tools/registry.ts` lists each one with a lazy `import()`, so heavy libraries (Prettier, Terser, SVGO, Dart Sass, the image codecs) only load when their tool opens.

## The worker

`worker/client.ts` keeps one module worker. Jobs on the same channel replace queued ones, and a job that has run for more than 750 ms is cancelled by restarting the worker when newer input arrives, so typing never waits for stale work. If a worker cannot start, jobs run on the main thread instead. The worker also encodes WebP and AVIF (WebAssembly builds of libwebp and libavif) and compiles Bootstrap with Dart Sass.

## Safety boundaries

- The production page carries a content security policy (injected by `vite.config.ts`) that allows no network origin at all.
- HTML previews go through DOMPurify with links and remote sources removed (`ui/sanitize.ts`). SVG previews are shown as images, where scripts never run. Full documents (theme previews, the playground, media-query tests) are `srcdoc` frames with an empty `sandbox` attribute.
- The Rust shell allows navigation only to the bundled app (`is_allowed` in `src-tauri/src/lib.rs`) and receives saved files as raw bytes, with the file name reduced to its last path component.
- Settings are validated when they are read, so a damaged or hand-edited settings file cannot break the app.

## Adding a tool

1. Write the logic as pure functions in `src/lib/` if it is more than a few lines, with tests in `tests/unit/`.
2. Create the tool:
   - text: `src/tools/text/<id>.ts`, then add its loader to `src/tools/text/index.ts`;
   - visual: `src/tools/css/<id>.tsx`;
   - image: `src/tools/image/<id>.ts`;
   - custom: `src/tools/custom/<id>.tsx`.
3. Register it in `src/tools/registry.ts` with a name, category, description, search keywords and the web tools it replaces.
4. Run `UPDATE_DOCS=1 pnpm test docs` to refresh `docs/TOOLS.md`.
5. For a custom tool, add a check to `CUSTOM_CHECKS` in `tests/e2e/smoke.spec.ts`; the other kinds are covered automatically.

A minimal text tool:

```ts
import { defineTextTool, type Values } from '../types';

export default defineTextTool({
  input: { label: 'Text', sample: 'Hello' },
  output: { label: 'Result' },
  options: [
    { key: 'times', label: 'Repeat', type: 'number', min: 1, max: 10, default: 2 },
    { key: 'separator', label: 'Separator', type: 'text', default: ' ', showIf: (v: Values) => Number(v.times) > 1 },
  ],
  run: (input, o) => Array.from({ length: o.times }, () => input).join(o.separator),
});
```

Annotate `showIf` callbacks with `(v: Values)`; without it TypeScript cannot infer the option types.

## Tests

- `tests/unit`: Vitest, in Node. Covers every library function and every text tool, cross-checked against published test vectors and, where installed, against `openssl`, Apache `htpasswd` and Pillow. Visual generators are rendered with their defaults, presets and random values.
- `tests/e2e`: Playwright against the production build. Opens every tool, uses its sample or a fixture image, and fails on any console error or any request that leaves the app.
- `tests/desktop`: WebDriver against the real desktop binary (Linux), covering the worker, Sass, the WebAssembly codecs, the clipboard plugin, the save command and the navigation guard inside WebKitGTK.
- `src-tauri`: `cargo test` covers the navigation allow-list and file-name handling.
