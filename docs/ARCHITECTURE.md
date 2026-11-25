# Architecture

Benchtop is a web app (Preact, TypeScript, Vite) inside a native shell (Tauri 2). Almost all tool logic is TypeScript that runs in the system web view. The Rust side opens the window, reads and writes the clipboard, shows the file dialogs, keeps the window on the app's own pages, and does the few things a web page cannot: the online checks, running AI models (in a separate worker process), running installed converters, talking to serial ports, and the command line (`src-tauri/src/cli.rs`, the same program started with a command; see [CLI.md](CLI.md)).

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

## The workers

There are two module workers, both built as extra entries of the main Vite build (`vite.config.ts`), so the libraries they share with the window are stored once. `worker/` runs the text tools and `recipe/worker.ts` bakes recipes; in development each is loaded from its source file. A Vite plugin in the same file stops the build if a chunk a worker loads would need a document.

`worker/client.ts` keeps one module worker for the text tools. Jobs on the same channel replace queued ones, and a job that has run for more than 750 ms is cancelled by restarting the worker when newer input arrives, so typing never waits for stale work. If a worker cannot start, jobs run on the main thread instead. The worker also encodes WebP and AVIF (WebAssembly builds of libwebp and libavif), runs jq (a WebAssembly build of jq 1.8, loaded from the app's own files) and compiles Bootstrap with Dart Sass.

## The AI worker

The AI tools run in a second copy of the program started as `benchtop --ai-worker` (`src-tauri/src/ai/worker.rs`), so a crash in a model or the runtime cannot take the window down, and Stop simply ends the process. The shell and the worker talk over stdin and stdout with framed messages: a 4-byte header length, a JSON header, then binary attachments (pictures, masks, audio) with 8-byte lengths. ONNX Runtime 1.22 is loaded at run time (`ort` with `load-dynamic`) from the copy downloaded on first use, so one build runs on every computer, with or without a GPU. `ai/catalog.rs` lists every downloadable file with its size, SHA-256 and where to get it (the publisher, with this project's GitHub mirror as the fallback); `ai/store.rs` downloads, verifies and unpacks them into the app's data folder. Pictures are prepared and finished in Rust with the `image` crate (`ai/image_ops.rs`); audio is decoded with Symphonia and resampled with Rubato for Whisper (`ai/speech.rs`).

## Converters

`src-tauri/src/convert.rs` runs programs that are already installed (FFmpeg, LibreOffice, Pandoc, ImageMagick, Inkscape, Calibre, qpdf, Ghostscript). The page names a recipe (such as `video-trim`) and options; Rust validates every option, builds the argument list, runs the program without a shell, reports FFmpeg progress as events, and writes the result through a temporary file next to its destination. Files reach Rust only as tokens from the native Open dialog (`files.rs`), never as paths typed by the page.

## The Recipe engine

`src/recipe/` holds all 505 of CyberChef's operations: `catalog.ts` lists them (each with its arguments and an `apply` function), `engine.ts` bakes a recipe including flow control, `magic.ts` searches for decodings that produce readable text or known file types, and `format.ts` reads and writes CyberChef's recipe formats. Most operations are reimplemented in `ops/`; 65 run CyberChef's own code from `vendor/` (copied and patched by `scripts/vendor-cyberchef.py`, including a YARA build whose generated `new Function` calls are replaced with closures so it runs under the content security policy), loaded on first use through `ops/cyberchef-loaders.ts`. Baking runs in its own worker (`worker.ts`), which Stop terminates. The few operations that need the shell or the window (HTTP request, DNS over HTTPS, OCR) ask the page through a small message bridge (`host.ts`, answered by `host-main.ts`). `names.ts` is a small generated index used by the app's search. CyberChef's own test vectors are extracted statically by `scripts/cyberchef-tests.mjs` and run in the unit tests and, for the vendored operations, in the browser.

## Tools working together

`app/handoff.ts` passes files from one tool to another: `sendToTool` stores them and opens the tool, and the receiving tool takes them with `useHandoff` or `useIncomingFiles`. `app/suggest.ts` recognises a file by its first bytes, MIME type and extension and lists the tools that open it; `app/DropDialog.tsx` shows that list when a file is dropped anywhere on the window, and `ui/SendTo.tsx` shows it for a tool's result. Tools that hand a file to an installed program need a path, so a dropped file is first copied into a private folder in the user's cache (`stage_file` in `src-tauri/src/files.rs`).

## The calculator library

`src/calc/` holds about 300 calculators as data: variables with dimensions and units (`units.ts`) and equations written as text (`library/*.ts`). `solver.ts` parses the equations with math.js and solves each one that has a single unknown, numerically (secant steps, then a bracketing search from 10⁻⁴⁰ to 10⁴⁰), repeating until nothing changes, so any field can be the result. When typed values contradict each other, the oldest gives way. `engine.ts` converts between the units on screen and the units in the formulas. `report.ts` encodes a calculation into a link (`#/tool/<id>?calc=…&s=…`, validated when read) and draws the PDF report.

## Engineering references

Pure functions under `src/lib`, with the bespoke tools that use them:

- `lib/units/`: the unit catalogue (`catalog-common.ts`, `catalog-science.ts`, `catalog-trade.ts`). Every quantity has a base unit and each unit reaches it linearly, with an offset (temperatures), as a reciprocal (fuel economy, yarn counts) or through a function pair (decibels, slopes, hydrometer scales). `index.ts` converts, searches and reads questions such as “2 lakh sq ft to acres”; the Unit Converter (`tools/custom/unit-converter.tsx`) is its interface.
- `lib/steam/if97.ts`: IAPWS-IF97 regions 1 to 5 with the published coefficients. Region 3 is solved for density along an isotherm (the polynomial in δ is precomputed per temperature, so a root scan and bisection cost little), and enthalpy and entropy inputs are inverted by bisection on temperature on the correct side of the saturation line. Viscosity, thermal conductivity (with the industrial critical enhancement) and surface tension follow the IAPWS releases. `tests/unit/steam.test.ts` checks every verification table.
- `lib/beam/`: `sections.ts` builds shapes from rectangles and circles (parallel-axis theorem, plastic neutral axis by bisection, thin-wall torsion constants); `beam.ts` assembles Euler–Bernoulli beam elements with nodes at every support and load boundary into a banded system, so nodal deflections are exact, and takes shear and moment from statics with the computed reactions.
- `lib/wire-gauge.ts`: AWG from its defining formula, the BS 3737 SWG table and IEC 60228 sizes.

## Design, print and writing references

More pure functions under `src/lib`, added in 3.3:

- `lib/material-theme.ts`: Material 3 schemes from Google's material-color-utilities (`DynamicScheme` for each of the nine variants and both spec versions), with overridden key palettes rebuilt as a new `DynamicScheme`, custom colour groups, and writers for Android XML, Compose, Flutter, CSS and JSON.
- `lib/vector-drawable.ts`: an Android VectorDrawable reader (groups with pivots, clip paths, gradients and tints) that writes SVG or Compose `ImageVector.Builder` code; SVG to VectorDrawable goes through svg2vectordrawable. `lib/nine-patch.ts` reads and writes the one-pixel guide border of `.9.png` files and scales the guides between densities.
- `lib/imposition.ts`: booklet, zine, n-up and repeat layouts as lists of sides with slots, then drawn with pdf-lib's embedded pages; pages without a content stream are treated as blank. `lib/preflight.ts` walks the PDF objects for boxes, fonts, colour spaces and output intents, and walks PDF.js operator lists with the current transform to measure each picture's effective resolution. `lib/pdf-crop.ts` turns on-screen margins into crop and media boxes for rotated pages.
- `lib/pitman.ts`: Pitman sounds from CMU dictionary phonemes (`lib/cmudict.ts`, with a spelling-based guess for unknown words), stroke forms as straight lines and quarter circles, Ray/Ar and Lay/El choices, circle S, the -ing dot, vowel signs by place, and the outline's position from its first vowel. `lib/braille.ts` (UEB grade 1, Bharati Braille, Braille ASCII, signage SVG) and `lib/phonetics.ts` (IPA with maximal-onset stress marks, Shavian) sit beside it.
- `lib/poly-roots.ts`: Durand–Kerner for every root at once, then clusters of approximations are tested as repeated roots (Newton's method on the (k−1)th derivative) so double and triple roots come out exact. `lib/timecode.ts` counts SMPTE drop-frame timecode; `lib/subtitles.ts` reads SRT, WebVTT, SBV and ASS and writes the first three.

## Safety boundaries

- The production page carries a content security policy (injected by `vite.config.ts`) that allows no network origin at all. It also forbids `eval` and `new Function`, so libraries are chosen to work without them (for example @cfworker/json-schema rather than Ajv, and jsonpath-plus in its safe evaluation mode).
- Secrets are generated with `crypto.getRandomValues` and never stored: passwords, SSH keys and TOTP secrets live only in memory while the app is open.
- HTML previews go through DOMPurify with links and remote sources removed (`ui/sanitize.ts`). SVG previews are shown as images, where scripts never run. Full documents (theme previews, the playground, media-query tests) are `srcdoc` frames with an empty `sandbox` attribute.
- The Rust shell allows navigation only to the bundled app (`is_allowed` in `src-tauri/src/lib.rs`) and receives saved files as raw bytes, with the file name reduced to its last path component. Links that open the app on a page (`benchtop open`) must pass `safe_route`, and the only web page the app can open in the system browser is this project's releases page (`links.rs`).
- Model downloads are checked against SHA-256 fingerprints compiled into the program before they are unpacked or loaded; archives are unpacked only to the file names listed for them.
- Converter options are validated and turned into argument lists in Rust; the page cannot add arguments of its own, and passwords for qpdf travel in a private temporary file rather than the command line.
- Settings are validated when they are read, so a damaged or hand-edited settings file cannot break the app.

## Adding a tool

1. Write the logic as pure functions in `src/lib/` if it is more than a few lines, with tests in `tests/unit/`.
2. Create the tool:
   - text: `src/tools/text/<id>.ts`, then add its loader to `src/tools/text/index.ts`;
   - visual: `src/tools/css/<id>.tsx`;
   - image: `src/tools/image/<id>.ts`;
   - custom: `src/tools/custom/<id>.tsx`.
3. Register it in `src/tools/registry.ts` with a name, category, description, search keywords and, when it has one, the web tool it replaces.
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
- `tests/e2e`: Playwright against the production build. `smoke.spec.ts` opens every tool, uses its sample or a fixture image, and fails on any console error or any request that leaves the app; `a11y.spec.ts` runs axe-core's WCAG 2.1 A and AA rules on every screen and fails on serious or critical problems; `cyberchef-port.spec.ts` runs CyberChef's test vectors through the vendored operations; `handoff.spec.ts` covers dropping files and Send to.
- `tests/desktop`: WebDriver against the real desktop binary (Linux), covering the worker, Sass, the WebAssembly codecs, the clipboard plugin, the save command and the navigation guard inside WebKitGTK.
- `src-tauri`: `cargo test` covers the navigation allow-list, file-name handling, the converters' argument lists, the command line, and (with `BENCHTOP_AI_TEST_DIR` and `BENCHTOP_CONVERT_TEST` set) real model runs and FFmpeg jobs.
