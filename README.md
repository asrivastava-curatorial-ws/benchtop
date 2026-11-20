# Benchtop

A desktop toolbox of 307 developer, engineering and everyday utilities in one free and open-source app for Linux, Windows and macOS: formatters, converters, query and validation tools, encoders, hashes, keys and JWTs, text comparison, network and DevOps helpers, diagram editors and file viewers, generators, CSS, colour and image tools, a Bootstrap theme builder, AI image and speech tools that run on your own computer (English and Hindi), a Recipe tool with all of CyberChef's 505 operations, PDF tools including form filling and signing, a file converter for video, audio, documents and e-books, a unit converter for every trade and science, steam tables, a beam calculator and a library of about 220 calculators, alongside calculators for projection, electrical power, mechanical design and HVAC. The same program also works from the command line.

Nothing you paste, open or generate leaves your computer. Every tool works offline, with three exceptions that happen only when you ask: the online checks (ten tools such as website status, SSL, DNS, WHOIS and ports, plus the Recipe's HTTP request and DNS over HTTPS operations) contact the hosts you type when you run them; AI models are downloaded once, when you first choose one, from fixed addresses and checked against fixed SHA-256 fingerprints; and Check for updates in Settings asks GitHub for the newest version number. The web view itself cannot reach any server: its content security policy allows only the app and the desktop shell.

The full list, with the web tools each one replaces, is in [docs/TOOLS.md](docs/TOOLS.md).

## Highlights

- **Format and minify:** JSON (lossless numbers, duplicate-key warnings), HTML, CSS/SCSS/Less, JavaScript/TypeScript (Prettier), Terser minification, XML, SVGO, SQL (15 dialects), GraphQL.
- **Convert:** CSV ↔ JSON, JSON → TypeScript and classes for nine languages, any-to-any between JSON, YAML, TOML, XML, INI, .env and CSV, Markdown ↔ HTML, tables between CSV, Markdown, HTML, SQL and LaTeX, cURL → fetch, Python, PHP, Go, Java, C#, Rust or PowerShell, SVG → React, CSS → Tailwind, Sass and Less → CSS, Word, Excel, PowerPoint, OpenDocument and PDF → text, number bases, Unix time, px ↔ rem, number to words (international and Indian numbering).
- **Query and validate:** a regex tester with highlighted matches and replacement preview, JSONPath and real jq 1.8 (WebAssembly), JSON Schema validation (drafts 4, 7, 2019-09 and 2020-12).
- **Encode, hash, keys and passwords:** Base64/32/58/62, hex, URL, HTML entities, string escaping for twelve languages, JWTs with every JWS algorithm (decode, verify with a secret, PEM or JWKS, sign, generate keys), 40 hash and checksum algorithms with HMAC, AES (OpenSSL-compatible) and other text ciphers, bcrypt, Argon2, scrypt and PBKDF2, htpasswd, password strength, BIP39 phrases, TOTP two-factor codes, X.509 certificate decoding, PDF signature checks, SSH key generation (Ed25519, ECDSA, RSA).
- **Web and network:** URL parser and builder, IPv4/IPv6 subnet and address converters, MAC address vendor lookup (bundled IEEE registry), email header analysis, HTTP status codes, MIME types, User-Agent parser, security headers (CSP, HSTS and more) and nginx, Apache or Caddy configuration.
- **Online checks (desktop app):** whether a website is up, SSL certificate expiry and chain, domain WHOIS and RDAP with expiry dates, DNS lookups and worldwide propagation across 40 resolvers, IP and ASN details, SPF, DKIM and DMARC, open ports, broken links, and an HTTP client.
- **DevOps:** chmod calculator, `docker run` → Compose, .gitignore templates, semver ranges and sorting.
- **Generate and text:** UUID v1–v7, ULID, ObjectId, KSUID and Nano ID, barcodes and QR codes (Wi-Fi, UPI, vCard and more), mock data, cron explanations, robots.txt, llms.txt, meta tags, mailto links, lorem ipsum, ASCII art, word counts, slugs, line sorting, a Unicode inspector, case conversion, and a text compare with side-by-side and inline views and ignore-whitespace, ignore-case and compare-as-JSON options.
- **Math, units and time:** a unit converter with 1,261 units in 119 quantities, from everyday measures to viscosity, radiation dose, lab results, Indian land units by state, lakh and crore, tola and karats, yarn counts and paper weights (type “5 bigha (UP) in acres” and see the value in every unit at once); an expression evaluator with units and matrices (math.js), percentages, date and time-sheet calculators, coordinates (DMS, UTM, geohash, Plus Codes), charts, and a stopwatch with countdown and Pomodoro modes.
- **CSS and colour:** gradients, mesh gradients, shadows, borders, clip-path, flexbox and grid, transforms, transitions and keyframes, cubic Bézier, media queries, blobs, waves, patterns, glassmorphism, OKLCH conversion, colour scales, contrast checks, the Tailwind palette, shadcn/ui themes.
- **Bootstrap Theme Builder:** edit any of Bootstrap 5.3's 1,008 Sass variables with a live preview compiled by Dart Sass inside the app, then export `_variables.scss`, a ready entry file, `bootstrap.css` or `bootstrap.min.css`.
- **Images:** convert and compress (PNG, JPEG, WebP, AVIF), resize, crop, rotate, filters, colour replacement, fades, colour-blindness simulation, colour picking and palettes, favicons and multi-size `.ico` files, SVG to PNG, CSS sprite sheets, a QR code reader, a photo metadata viewer that removes EXIF, GPS and XMP data without re-encoding, an annotator for screenshots and photos (arrows, boxes, text, numbered steps, highlights, blur), text watermarks, memes and captions, a screenshot beautifier, passport and ID photos with print sheets, tracing pictures into SVG, animated GIFs, and a duplicate-picture finder.
- **AI image and speech (runs on this computer):** background removal (IS-Net, U²-Net or BiRefNet), upscaling (Real-ESRGAN), face blurring (YuNet), an object eraser (MI-GAN), text recognition in English and Hindi for pictures and scanned PDFs with searchable-PDF output (Tesseract, also in the browser), and transcription to text or subtitles in 99 languages including Hindi, with translation into English (Whisper). Background removal, upscaling and face blurring also take many pictures at once. Models download on first use, or import from a folder for offline computers; they run on the processor everywhere, and on the GPU with NVIDIA CUDA (Linux), DirectML on any DirectX 12 graphics card (Windows) or Apple's Core ML (macOS).
- **Recipe (CyberChef rebuilt):** all 505 of CyberChef's operations (only its internal test helper is left out) to chain: encodings, ciphers (AES, DES, Blowfish, RC4, Enigma and more), PGP, hashes and CRCs, compression, file carving and forensics, YARA rules, Protobuf and Avro, networking, dates, charts and maps, regular expressions and code tools, with Magic to work out the steps, breakpoints, flow control, saved recipes, and import of CyberChef recipes and links. CyberChef's own test vectors are run against them.
- **PDF:** merge and reorder pages with thumbnails, rotate and delete, split by ranges, watermarks and page numbers in any language with a live preview, form filling (form fields, or text, ticks and dates anywhere on a scanned form, in English or Hindi), signing (a drawn, typed or scanned signature, or a digital signature with a .p12/.pfx certificate), properties, pictures to PDF and PDF to pictures, all in the app; passwords (AES-256), lossless optimisation and compression with qpdf and Ghostscript.
- **Files, video and audio:** a batch file converter in the spirit of ConvertX using the programs installed on your computer (FFmpeg, LibreOffice, Pandoc, ImageMagick, Inkscape, Calibre), a video toolkit (compress, trim, resize, crop, rotate, speed, join, mute, GIFs, frames, logos, burned-in or switchable subtitles), an audio toolkit (convert, trim, join, loudness, fades, silence and noise removal, waveforms, spectrograms), ZIP, TAR and .gz archives (including ZIP passwords), and CSV merging and splitting.
- **Diagrams and file viewers:** Mermaid and Graphviz editors, SQL to ER diagrams, OpenAPI and HAR viewers, a hex viewer, a SQLite browser, a 3D model and G-code viewer, and code screenshots.
- **Engineering and devices:** a serial monitor for Arduino, ESP32 and GPS boards, resistor and capacitor codes, a time zone planner, self-signed certificates and CAs, and WireGuard configurations with QR codes.
- **Calculator library:** about 220 calculators in 18 categories (finance, health, sports, physics, chemistry, maths, statistics, construction, conversion, everyday life, food, biology, ecology and weather, electronics, engineering, heat and combustion, sound and acoustics, other). Leave any value empty and it is worked out from the others, so the same calculator gives the EMI from a loan or the rate from an EMI. Units can be changed on every field. Keep results in a history, copy a link that reopens a calculation, or save it as a PDF report.
- **Tools work together:** drop a file anywhere on the window and Benchtop suggests the tools that open it; Send to passes a result on to the next tool.
- **Projection and AV:** projector throw distance, lens shift, brightness in foot-lamberts and nits, screen sizes, and edge-blended multi-projector layouts.
- **Steam, beams and sections:** steam tables from IAPWS-IF97 (any state, saturation tables and tables along a pressure, with viscosity and conductivity; gauge pressures in bar, kgf/cm² or psi), a beam calculator for any supports and loads with shear, moment and deflection diagrams, section properties of steel and other shapes with a scale drawing, and an AWG, SWG and metric wire gauge chart.
- **Engineering calculators:** kW, kVA and amps, power factor correction, cable size and voltage drop (IEC or NEC), breakers, transformers, motors, conduit fill, earthing, generators, UPS, batteries, solar, EV chargers, data-centre power; pumps, pipe pressure drop, valve Cv, hydraulic and pneumatic cylinders, compressed air, bearings, speeds and feeds, tap drills, tool life and sheet-metal bending; cooling load, air changes, duct sizing, fan laws, chillers, psychrometrics, and refrigerant superheat and subcooling with P–T charts for 14 refrigerants. They are screening estimates that cite the standard they follow.

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
sudo apt install ./src-tauri/target/release/bundle/deb/Benchtop_3.1.0_amd64.deb
```

The file converter, video and audio toolkits and PDF passwords use programs you install separately, and show the install command for each one when it is missing. On Ubuntu:

```sh
sudo apt install -y ffmpeg libreoffice pandoc imagemagick inkscape calibre qpdf ghostscript
```

To work on the app with hot reloading:

```sh
pnpm desktop:dev
```

### Without the desktop shell

The same build runs in any current browser, where it makes no network requests at all (the online checks, the AI models, the converters and the PDF password tools need the desktop shell; text recognition works in the browser too):

```sh
pnpm build
pnpm preview          # then open http://127.0.0.1:4173
```

`dist/` is a static site, so you can also copy it to any web server or open it from an intranet.

## Command line

The installed program also runs from a terminal, without opening a window:

```sh
benchtop convert video-compress talk.mp4 -s crf=28 height=720
benchtop transcribe lecture.mp4 --language hi --format srt
benchtop remove-bg *.jpg -o cut-outs/
benchtop dns example.org MX
benchtop open json-formatter
```

[docs/CLI.md](docs/CLI.md) lists every command.

## Testing

```sh
pnpm typecheck        # TypeScript, app and tests
pnpm lint             # Biome, plus a check for invisible Unicode in source files
pnpm test             # unit tests (Vitest)
pnpm build
pnpm test:e2e         # every tool in the production build, in Chrome (Playwright), with
                      # accessibility checks (axe-core) and CyberChef's test vectors
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

- **No network access from the web view.** The page's content security policy is `default-src 'none'` with only the app itself, `data:`, `blob:` and the desktop shell's IPC allowed. The desktop window also refuses to navigate anywhere outside the app.
- **Online checks are explicit.** The ten tools in Online checks ask the Rust shell to make the request (HTTPS with the system's certificate store and proxy settings, DNS, WHOIS, TCP), only to the hosts you enter and only when you press Check. Turn off "Allow online checks" in Settings to disable them completely.
- **Updates are checked only when you ask.** Check for updates in Settings (or `benchtop version --check`) asks GitHub for the list of releases and compares version numbers; nothing is downloaded or installed, and nothing is checked in the background.
- **AI models are downloaded only when you choose one**, from the publisher's release (GitHub or Hugging Face) or this project's mirror on GitHub, and each file is checked against a fixed SHA-256 fingerprint before use. You can also import models from a folder. Models and the ONNX Runtime live in the app's data folder; Settings → AI models shows their sizes and licences and removes them. AI jobs run in a separate worker process, so a crash or a stopped job never takes the window with it.
- **Converters run your own programs.** The file converter and the toolkits start FFmpeg, LibreOffice and the others with argument lists built from fixed recipes; options are checked and no shell is involved. Files are chosen in the system dialog, and results are written next to the originals, in a folder you choose, or where the Save dialog says. PDF passwords are passed to qpdf in a private temporary file, never on the command line.
- **Previews are inert.** HTML previews are sanitised with DOMPurify, links are disabled, remote images are removed, and rendered documents (Bootstrap, media queries, the playground) sit in sandboxed frames where scripts cannot run.
- **What is stored.** Settings, favourites and each tool's options are kept in the app's local storage so they survive a restart. Text you type or paste, and options marked secret (passwords, keys), are never stored. Turn off "Remember tool options" in Settings to stop storing options too, and use "Export settings" to move them to another computer.
- **Saving files** goes through the system "Save as" dialog; the web view never gets general file-system access. A file dropped on the window for a tool that runs an installed program is copied into a folder in your own cache that other accounts cannot read, and copies older than a day are deleted.

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
  recipe/       the Recipe engine, its 505 operations and Magic (vendor/: CyberChef's own code)
  calc/         the calculator library, units and the equation solver
  lib/          pure logic shared by tools (fully unit-tested)
  worker/       the background worker and its client
  platform/     clipboard, file saving, AI jobs and converters (desktop or browser)
src-tauri/      the Rust desktop shell: AI worker (ONNX Runtime), converters, online checks, command line
tests/          unit, end-to-end and desktop tests
docs/           tool list, command line and architecture notes
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit and how to add a tool.

## Licence

MIT, see [LICENSE](LICENSE). Benchtop bundles open-source libraries and fonts under their own licences, almost all permissive (MIT, BSD, ISC, Apache 2.0, OFL 1.1 and others); the build writes their notices to `THIRD-PARTY-LICENSES.txt`, which you can also read in the app under Settings. Run `pnpm licenses` to print them. Two are weak copyleft and are used unmodified: OpenPGP.js (LGPL 3.0 or later, in its own file, so a rebuilt app can use a changed copy) and ELK, the diagram layout engine (EPL 2.0).

Bundled data: the IEEE MA-L, MA-M and MA-S registries (via `oui-data`) for MAC vendors; refrigerant saturation curves generated from CoolProp's fluid files (MIT) by `scripts/refrigerant_table.py`; the Natural Earth 1:110m land outline (public domain) for the DNS propagation map and the Recipe's maps; Tesseract's `tessdata_fast` English and Hindi models (Apache 2.0) for text recognition; Benchtop Sans, built from Noto Sans and Noto Sans Devanagari (OFL 1.1) by `scripts/fonts/build-benchtop-sans.py`, for text drawn into PDFs.

Downloaded on first use, not bundled: ONNX Runtime 1.22 (MIT; the CUDA build on Linux, the DirectML build on Windows); IS-Net and U²-Net (Apache 2.0), BiRefNet (MIT), Real-ESRGAN (BSD-3-Clause), YuNet (MIT), MI-GAN (MIT), Whisper (MIT, as converted by sherpa-onnx, Apache 2.0) and Silero VAD (MIT). Their licences are listed in Settings → AI models. `scripts/mirror-models.sh` copies them to this project's `models-v1` release, which the app falls back to when a publisher's download is unavailable.

The Recipe tool reimplements most of CyberChef's operations in TypeScript, and runs 65 of them from CyberChef's own code (`src/recipe/vendor`, copied by `scripts/vendor-cyberchef.py`); operation names, arguments and behaviour follow CyberChef (Crown Copyright, Apache 2.0), whose notice is included in `THIRD-PARTY-LICENSES.txt`. YARA (BSD-3-Clause) is compiled into the bundled libyara-wasm.

Benchtop is an independent project. It is not affiliated with the websites whose tool lists inspired it (including CyberChef, SnapOtter, ConvertX and Omni Calculator), and apart from CyberChef, as noted above, it contains none of their code, text or artwork.
