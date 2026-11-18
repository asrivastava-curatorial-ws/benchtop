# Changelog

## 3.1.0 (2026-11-18)

17 new tools, bringing the total to 299; every CyberChef operation in the Recipe tool; Hindi text recognition and transcription; a command line; and a round of refinements across the app.

- **PDF:** PDF Form Filler (fill form fields, or write text, ticks and dates anywhere on scanned forms, in English or Hindi, and lock the answers if you like) and PDF Signer (a drawn, typed or scanned signature, or a digital signature with a .p12 or .pfx certificate, or a self-signed one made in the app). Watermarks and page numbers take any text, including Hindi and the rupee sign, drawn with the bundled Benchtop Sans font (Noto Sans with Devanagari).
- **Images:** Image Annotator for screenshots and photos: arrows, boxes, text, numbered steps, highlights, and blur or pixelation for private details; paste a picture with Ctrl+V.
- **For developers and engineers:** Mermaid Diagram Editor, Graphviz (DOT) Viewer, SQL to ER Diagram, OpenAPI Viewer, HAR Viewer, Hex Viewer, SQLite Browser, 3D Model and G-code Viewer, Code Screenshot, Certificate Maker, WireGuard Config Generator, Serial Monitor, Time Zone Planner, and Resistor and Capacitor Codes.
- **Hindi:** Text Recognition reads Hindi (Devanagari) as well as English, or both on one page. Transcription and Subtitles works in Hindi and 97 more languages with the multilingual Whisper models, and can translate speech into English.
- **Recipe:** all of CyberChef's operations except its internal test helper, 505 in all (up from 421): PGP keys, encryption and signatures, YARA rules, Avro and Protobuf, Handlebars templates, scatter, series, heatmap and hex-density charts, Render PDF, Show on map, OCR in English and Hindi, and HTTP request and DNS over HTTPS (desktop app, with "Allow online checks" on), among others. 65 of them run CyberChef's own code, and CyberChef's own test vectors run against them.
- **Command line:** `benchtop convert`, `hash`, `models`, `remove-bg`, `upscale`, `blur-faces`, `transcribe`, `dns`, `tls`, `http`, `whois`, `ports`, `open` and `version` work from a terminal or a script without opening a window. See docs/CLI.md.
- **Tools work together:** drop a file anywhere on the window and Benchtop suggests the tools that open it, recognising files by their contents; Send to passes a result on to another tool; Transcription hands its subtitles to the Video Toolkit to burn them into the video.
- **AI:** Windows computers with a DirectX 12 graphics card (AMD, Intel or Nvidia) can run the image models on the GPU through DirectML. Background Remover, Image Upscaler and Face Blur process many pictures at once into a ZIP.
- **Calculators:** keep results in a history, copy a link that reopens a calculation (paste it into the command palette, or pass it to `benchtop open`), and save a calculation as a PDF report.
- **Video Toolkit:** Trim and Crop show the video's frames, and the crop area is drawn with the mouse.
- **Check for updates** in Settings asks GitHub for the newest release when you press it, and links to its page. Nothing is checked in the background or installed by itself. `benchtop version --check` does the same in a terminal.
- **Accessibility:** automated WCAG 2.1 A and AA checks (axe-core) now run on every screen and find no serious problems: secondary text, code comments and previews have more contrast, every scrolling area can be reached and scrolled with the keyboard, and button names include their visible labels.
- **Smaller:** the two web workers now share the app's code instead of carrying their own copies of it, which removes about 18 MB of duplicated files from the app.
- Fixed: the shadcn/ui theme preview drew the dark theme's Delete button without the 60% opacity shadcn/ui gives it, and now also reports the contrast of text on destructive buttons; the numbered items in the Flexbox and Grid previews had white text on light colours.

## 3.0.0 (2026-11-17)

40 new tools, bringing the total to 282, plus 421 Recipe operations and about 170 calculators inside them. AI tools that run on your own computer, with or without a GPU, are the first features that download anything, and only when you choose a model.

- **AI image and speech (new category):** Background Remover (cut-outs, masks, colour or blurred backgrounds; IS-Net, U²-Net or BiRefNet), Image Upscaler (Real-ESRGAN 2× to 4×, tiled for large pictures), Face Blur (YuNet detection with editable boxes; blur, pixelate or cover), Object Eraser (paint over an object; MI-GAN fills it), Text Recognition (Tesseract; pictures and scanned PDFs, searchable PDF output, works in the browser too) and Transcription and Subtitles (Whisper; SRT, WebVTT, text or JSON). Models and ONNX Runtime 1.22 download on first use with SHA-256 checks, or import from a folder; Settings → AI models lists sizes and licences. Jobs run in a separate worker process on the processor everywhere, and on NVIDIA GPUs (CUDA 12, Linux) or Apple's Core ML (macOS) when available.
- **Recipe (new category):** CyberChef rebuilt natively rather than bundled: 421 operations across encodings, encryption, public-key, arithmetic, networking, dates, extractors, compression, hashing, code tools, multimedia and forensics, with flow control (Fork, Subsection, Registers, Jump, Conditional Jump), Magic, breakpoints, saved recipes, and import of CyberChef JSON, chef-format recipes and CyberChef links. The main ciphers, key-derivation functions and hashes, and every CRC preset, are tested against published vectors. Operations also appear in the app's search.
- **PDF (new category):** Merge and Organise (page thumbnails, drag to reorder, rotate, delete), Split, Watermark and Page Numbers (live preview, upright on rotated pages), Properties, Pictures and PDF (both ways), and PDF Passwords and Compression (AES-256 with qpdf, lossless optimisation, Ghostscript compression).
- **Files, video and audio (new category):** File Converter for batches of video, audio, pictures, drawings, Office documents, Markdown and e-books, using FFmpeg, LibreOffice, Pandoc, ImageMagick, Inkscape or Calibre when installed, with install commands when they are not; Video Toolkit (16 tasks); Audio Toolkit (11 tasks); ZIP and Archives (ZIP with ZipCrypto passwords, TAR, .tar.gz, .gz; make ZIPs); CSV Merge and Split. Progress, Stop, and results next to the originals or in a chosen folder.
- **Calculator library (new category):** about 170 calculators in 14 categories, including Health and Sports: EMI, SIP, recurring deposits, GST, CAGR, BMI, BMR and TDEE, body fat, heart-rate zones, race prediction, one-rep max, cricket run rates and averages, physics and chemistry formulas, statistics, construction quantities, fuel economy, cooking conversions, weather indices and more. Any field can be left empty and is worked out from the others; every field has unit choices. Calculators also appear in the app's search.
- **Images:** Image Watermark, Meme and Caption Maker, Screenshot Beautifier, Passport and ID Photo (35 × 45 mm, 2 × 2 in and others, with print sheets), Image to SVG (Trace), GIF Maker and Duplicate Picture Finder.
- **Left out on purpose:** medicine-dose calculators, because a wrong dose can harm; 85 rarely used CyberChef operations; Omni's thousands of niche calculators. The list with reasons is in docs/TOOLS.md.
- Text recognition uses Tesseract rather than PP-OCR, so English works offline in the browser as well as the desktop app.

## 2.0.0 (2026-11-16)

112 new tools, bringing the total to 242, and the first features that can use the network: ten online checks that run only in the desktop app, only when you press Check, and can be turned off in Settings ("Allow online checks").

- **Online checks (new category):** Website Status (up or down, response time, redirects, security headers), SSL Checker (expiry, chain, hostname match, protocol), Domain WHOIS (RDAP first, WHOIS fallback, expiry and status codes explained), DNS Lookup (any record type, any resolver, DNS over HTTPS), DNS Propagation (40 resolvers on a world map), IP Lookup (your public IP, ASN, registry owner), Email Security (MX, SPF with lookup counting, DKIM, DMARC, MTA-STS), Port Checker, Link Checker and an HTTP client. Requests go through the Rust shell with the system certificate store and proxy; the web view still cannot reach any server.
- **JWT:** decoder and encoder now cover every JWS algorithm (HS, RS, PS, ES256/384/512, ES256K, EdDSA): verify with a secret, PEM, certificate or JWKS (optionally fetched from an OIDC issuer), generate keys, `kid` thumbprints, and warnings for algorithm confusion, weak secrets and risky headers.
- **Text compare:** side-by-side and inline views, collapsed unchanged lines, jump between changes, ignore whitespace, case or blank lines, compare as JSON, XML or sorted lines, swap sides, and open Word, Excel, PowerPoint, OpenDocument or PDF files directly.
- **Projection and AV (new category):** Projector Calculator (throw, lens shift, brightness, seating, side-view drawing), Screen Size Calculator, Projector Edge Blending.
- **From IT Tools:** UUID v1–v7 plus ULID, ObjectId, KSUID and Nano ID; BIP39; text ciphers; password strength (zxcvbn); bcrypt, Argon2, scrypt and PBKDF2; PDF signature checker; Roman numerals; NATO alphabet; string obfuscator; numeronyms; email normaliser; Basic auth; any-to-any data converter; list converter; safe-link unwrapper; meta tags; SVG placeholders; JSON tree; YAML formatter; percentages; ETA; benchmark statistics; IP address converter; MAC address lookup with the IEEE registry bundled; IBAN; phone numbers; device information; Wi-Fi, UPI and vCard QR codes; regex reference; math evaluator; ASCII art; keycode info; stopwatch; emoji picker; WYSIWYG HTML editor; 18 more hash algorithms.
- **From freecodeformat:** table converter (CSV, Markdown, HTML, SQL, LaTeX and more), document to text, JSON to classes in nine languages, CSS selector and XPath tester, XSLT, syntax highlighter, Sass and Less compiler, card number validator, gzip, text encoding repair, text extractor, cleaner and repeater, fancy text, BBCode, coordinates, chart maker, date calculator, time sheet, random generator, mock data, colour harmonies, unit converter (22 categories), HSV and CMYK in the colour converter, NAND, NOR and XNOR in the binary calculator, XML escaping, and cURL to Python, PHP, Go, Java, C#, Rust and PowerShell.
- **From CalcPanel (four new categories):** 41 engineering calculators. Electrical: kW/kVA/amps, power factor correction, cable size and voltage drop (IEC 60364 or NEC), breakers, transformers, motors, conduit fill, earthing, generators, load and energy cost with load factor, RTDs, PLC scaling, encoders, Ohm's law, EV chargers, data-centre power. Batteries, UPS and solar. Mechanical: pumps, pipe flow, valve Cv, hydraulic and pneumatic cylinders, compressors and receivers, air leaks, air pipes, dew point, speeds and feeds with machining time, tap drills, tool life, sheet-metal bending. HVAC: cooling load, air changes, duct sizing, fan laws, chillers, psychrometrics (ASHRAE 2017), superheat and subcooling with P–T charts for 14 refrigerants.
- Fixed: the math evaluator sample used a unit math.js does not know; invisible characters in three source files are now escapes.

## 1.1.0 (2026-11-13)

33 new tools, bringing the total to 130. All of them work offline like the rest of the app.

- **New categories:** Query and validate, Web and network, DevOps and config.
- **Formatters:** SQL (15 dialects, with minify that leaves strings alone) and GraphQL.
- **Query and validate:** Regex Tester, JSONPath and jq (jq 1.8 compiled to WebAssembly), JSON Schema Validator.
- **Converters:** TOML ↔ JSON, INI ↔ JSON, .env ↔ JSON, Markdown tables from CSV or spreadsheet cells.
- **Keys and passwords:** Password Generator, TOTP codes (2FA) with authenticator QR codes, Certificate Decoder (X.509 certificates, CSRs and key files), SSH Key Generator.
- **Web and network:** URL Parser, Subnet Calculator (IPv4 and IPv6), HTTP Status Codes, MIME Types, User-Agent Parser, Security Headers, Web Server Config (nginx, Apache, Caddy).
- **DevOps:** Chmod Calculator, docker run to Compose, .gitignore Generator, Semver Checker.
- **Text:** String Escape, Word Counter, Sort Lines, Slug Generator, Lorem Ipsum, Unicode Inspector.
- **Images:** Photo Metadata (view and remove EXIF, GPS and XMP without re-encoding), QR Code Reader, CSS Sprite Generator.
- Fixed: `scripts/check-source-chars.mjs --fix` wrote `%uXXXX` instead of `\uXXXX` escapes.

## 1.0.0

First release: 97 tools, including the Bootstrap Theme Builder.
