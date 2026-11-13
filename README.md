# Benchtop

A desktop toolbox of 130 developer utilities that works entirely offline: formatters, converters, query and validation tools, encoders, hashes and keys, network and DevOps helpers, generators, CSS and colour tools, image tools and a Bootstrap theme builder, in one free and open-source app for Linux, Windows and macOS.

Nothing you paste, open or generate leaves your computer. The app contains no network code, ships every library and font it uses, and enforces a content security policy that stops the web view from contacting any server.

The full list, with the web tools each one replaces, is in [docs/TOOLS.md](docs/TOOLS.md).

## Highlights

- **Format and minify:** JSON (lossless numbers, duplicate-key warnings), HTML, CSS/SCSS/Less, JavaScript/TypeScript (Prettier), Terser minification, XML, SVGO, SQL (15 dialects), GraphQL.
- **Convert:** CSV ↔ JSON, JSON → TypeScript, YAML ↔ JSON, TOML ↔ JSON, INI ↔ JSON, .env ↔ JSON, Markdown ↔ HTML, CSV → Markdown tables, cURL → fetch, SVG → React, CSS → Tailwind, number bases, Unix time, px ↔ rem, number to words (international and Indian numbering).
- **Query and validate:** a regex tester with highlighted matches and replacement preview, JSONPath and real jq 1.8 (WebAssembly), JSON Schema validation (drafts 4, 7, 2019-09 and 2020-12).
- **Encode, hash, keys and passwords:** Base64/32/58/62, hex, URL, HTML entities, string escaping for eleven languages, JWT decode and sign, MD5 to SHA-3 and HMAC, AES (OpenSSL-compatible), htpasswd (bcrypt, apr1), passwords and passphrases, TOTP two-factor codes with authenticator QR codes, X.509 certificate and CSR decoding, SSH key generation (Ed25519, ECDSA, RSA).
- **Web and network:** URL parser and builder, IPv4/IPv6 subnet calculator, HTTP status codes, MIME types, User-Agent parser, security headers (CSP, HSTS and more) and nginx, Apache or Caddy configuration.
- **DevOps:** chmod calculator, `docker run` → Compose, .gitignore templates, semver ranges and sorting.
- **Generate and text:** UUID v1/v4/v7, barcodes and QR codes, cron explanations, robots.txt, llms.txt, mailto links, lorem ipsum, word counts, slugs, line sorting, a Unicode inspector that reveals invisible and look-alike characters, diffs and case conversion.
- **CSS and colour:** gradients, mesh gradients, shadows, borders, clip-path, flexbox and grid, transforms, transitions and keyframes, cubic Bézier, media queries, blobs, waves, patterns, glassmorphism, OKLCH conversion, colour scales, contrast checks, the Tailwind palette, shadcn/ui themes.
- **Bootstrap Theme Builder:** edit any of Bootstrap 5.3's 1,008 Sass variables with a live preview compiled by Dart Sass inside the app, then export `_variables.scss`, a ready entry file, `bootstrap.css` or `bootstrap.min.css`.
- **Images:** convert and compress (PNG, JPEG, WebP, AVIF), resize, crop, rotate, filters, colour replacement, fades, colour-blindness simulation, colour picking and palettes, favicons and multi-size `.ico` files, SVG to PNG, CSS sprite sheets, a QR code reader, and a photo metadata viewer that removes EXIF, GPS and XMP data without re-encoding.

## Install from source

You need Node.js 20.19 or later, pnpm, and Rust 1.80 or later. Tauri lists the system packages for each platform at <https://v2.tauri.app/start/prerequisites/>.

On Ubuntu 24.04 (and Kubuntu, Debian 12 and similar):

```sh
sudo apt update
sudo apt install -y build-essential curl wget file libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
corepack enable
```

On Windows, install the Microsoft C++ Build Tools and Rust (<https://rustup.rs>); WebView2 is already part of Windows 10 and 11. On macOS, run `xcode-select --install` and install Rust.

Then, from the project folder:

```sh
pnpm install
pnpm desktop:build
```

The installers appear in `src-tauri/target/release/bundle/` (`.deb`, `.rpm` and `.AppImage` on Linux, `.msi` and `.exe` on Windows, `.dmg` and `.app` on macOS). To install the Debian package:

```sh
sudo apt install ./src-tauri/target/release/bundle/deb/Benchtop_1.1.0_amd64.deb
```

To work on the app with hot reloading:

```sh
pnpm desktop:dev
```

### Without the desktop shell

The same build runs in any current browser, and still makes no network requests:

```sh
pnpm build
pnpm preview          # then open http://127.0.0.1:4173
```

`dist/` is a static site, so you can also copy it to any web server or open it from an intranet.

## Testing

```sh
pnpm typecheck        # TypeScript, app and tests
pnpm lint             # Biome, plus a check for invisible Unicode in source files
pnpm test             # unit tests (Vitest)
pnpm build
pnpm test:e2e         # every tool in the production build, in Chrome (Playwright)
```

`pnpm test:e2e` uses the installed Google Chrome. To use Playwright's own Chromium instead:

```sh
pnpm exec playwright install chromium
PW_BUNDLED=1 pnpm test:e2e
```

Rust checks and the desktop test, which drives the real app through WebDriver (Linux):

```sh
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cd ..
cargo install tauri-driver --locked
sudo apt install -y webkit2gtk-driver xvfb
pnpm tauri build --no-bundle
xvfb-run -a pnpm test:desktop
```

Some unit tests compare results with reference tools when they are installed: `openssl` for AES, apr1, certificates and keys, Apache's `htpasswd` (package `apache2-utils`) for bcrypt, `ssh-keygen` for SSH keys, and Python's Pillow for `.ico` files and photo metadata. They are skipped when the tool is missing.

## Privacy and security

- **No network access.** The page's content security policy is `default-src 'none'` with only the app itself, `data:` and `blob:` allowed. The desktop window also refuses to navigate anywhere outside the app.
- **Previews are inert.** HTML previews are sanitised with DOMPurify, links are disabled, remote images are removed, and rendered documents (Bootstrap, media queries, the playground) sit in sandboxed frames where scripts cannot run.
- **What is stored.** Settings, favourites and each tool's options are kept in the app's local storage so they survive a restart. Text you type or paste, and options marked secret (passwords, keys), are never stored. Turn off "Remember tool options" in Settings to stop storing options too, and use "Export settings" to move them to another computer.
- **Saving files** goes through the system "Save as" dialog; the web view never gets general file-system access.

## Project layout

```
src/
  app/          shell: sidebar, home, command palette (Ctrl+K), settings, routing
  ui/           shared views: text tools, visual generators, image tools, editors, export
  tools/
    text/       text-in, text-out tools (run in a Web Worker)
    css/        visual CSS generators
    image/      bitmap tools
    custom/     tools with their own screens
    registry.ts the list of tools, their categories and search terms
  lib/          pure logic shared by tools (fully unit-tested)
  worker/       the background worker and its client
  platform/     clipboard and file saving (desktop or browser)
src-tauri/      the Rust desktop shell
tests/          unit, end-to-end and desktop tests
docs/           tool list and architecture notes
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit and how to add a tool.

## Licence

MIT, see [LICENSE](LICENSE). Benchtop bundles open-source libraries and fonts under their own permissive licences (MIT, BSD, ISC, Apache 2.0, OFL 1.1 and others); the build writes their notices to `THIRD-PARTY-LICENSES.txt`, which you can also read in the app under Settings. Run `pnpm licenses` to print them.

Benchtop is an independent project. It is not affiliated with the websites whose tool lists inspired it, and it contains none of their code, text or artwork.
