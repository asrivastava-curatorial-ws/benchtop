# Tools

<!-- Generated from src/tools/registry.ts by tests/unit/docs.test.ts. Do not edit by hand. -->

Benchtop has 307 tools. All of them work without a network connection except the 10 in Online checks, which contact only the hosts you enter, when you press Check, and only in the desktop app. The AI tools download their models once, when you first choose one (or import them from a folder), and then work offline too.

## Format and minify

| Tool | What it does | Replaces |
| --- | --- | --- |
| JSON Formatter | Pretty-print, minify, sort and validate JSON without losing number precision. | JSON Formatter |
| HTML Formatter | Indent HTML or minify it while leaving scripts, styles and &lt;pre&gt; intact. | HTML Formatter |
| CSS Formatter | Format CSS, SCSS and Less, or minify CSS. | CSS Beautifier, CSS minify and beautify |
| JavaScript Formatter | Format JavaScript, JSX and TypeScript with Prettier. | JavaScript Formatter |
| JavaScript Minifier | Shrink JavaScript with Terser and compare sizes. | Minify JS, JavaScript encode and decode |
| XML Formatter | Format, minify and check XML, keeping comments and CDATA. | XML Formatter |
| SVG Minifier | Optimise SVG files with SVGO. | SVG Minifier |
| SQL Formatter | Format SQL for PostgreSQL, MySQL, SQLite, SQL Server, Oracle, BigQuery and nine more dialects, or minify it. |  |
| GraphQL Formatter | Format GraphQL queries, mutations and schemas with Prettier, or minify them. |  |
| YAML Formatter | Re-indent YAML, sort keys, choose quoting and list style, and catch syntax errors with their line. | YAML prettify |
| Syntax Highlighter | Turn code into coloured HTML with inline styles for blogs, slides and emails; 16 languages. | Syntax highlighter |

## Convert

| Tool | What it does | Replaces |
| --- | --- | --- |
| CSV to JSON | Turn CSV or TSV into JSON, handling quotes and multi-line cells. | CSV to JSON Converter |
| JSON to CSV | Flatten JSON into a CSV table. | JSON to CSV Converter |
| JSON to TypeScript | Infer TypeScript interfaces from a JSON sample. | JSON to TypeScript Converter |
| YAML ↔ JSON | Convert YAML to JSON and JSON to YAML. | YAML to JSON Converter |
| Markdown to HTML | Render Markdown to HTML with a live preview. | Markdown to HTML Converter |
| HTML to Markdown | Convert HTML to Markdown, including tables and strikethrough. | HTML to Markdown Converter |
| cURL to Code | Convert a curl command into JavaScript fetch(), Python requests, PHP, Go, Java, C#, Rust or PowerShell code. | cURL to Fetch Converter, cURL to Code Converter |
| SVG to React | Turn SVG markup into a React component (JSX or TSX). | SVG to React Component Converter |
| CSS to Tailwind | Translate CSS rules into Tailwind v4 utility classes. | CSS to Tailwind Converter |
| Number to Words | Spell out numbers, ordinals and money, in international or Indian numbering. | Number to Words Converter |
| Unix Timestamp | Convert epoch timestamps to dates in any time zone, and back. | Unix Timestamp Converter |
| Number Base Converter | Convert numbers between binary, octal, decimal, hex and any base up to 36. | Base Converter, Hex to Decimal Converter |
| Binary Calculator | Arithmetic and bitwise operations on binary, decimal or hex numbers. | Binary Calculator |
| PX ↔ REM | Convert between pixels and rem, with a reference table. | PX to REM Converter |
| Android Pixel Calculator | Convert between dp, px, sp, in, mm and pt for any screen density. | Android Pixel Calculator |
| TOML ↔ JSON | Convert TOML (Cargo.toml, pyproject.toml) to JSON and back, keeping dates and big integers. |  |
| INI ↔ JSON | Convert INI and .cfg files to JSON and back, with sections and optional typed values. |  |
| .env ↔ JSON | Convert dotenv files to JSON and back, handling quotes, escapes, export and multi-line values. |  |
| Markdown Table | Turn CSV, TSV or cells pasted from a spreadsheet into an aligned Markdown table. |  |
| Data Format Converter | Convert between JSON, YAML, TOML, XML, INI, .env, query strings and CSV in any direction, with format detection. | XML to JSON, JSON to XML, YAML to TOML, TOML to YAML, JSON to query string |
| Roman Numerals | Convert numbers to Roman numerals and back, with strict validation. | Roman numeral converter |
| Table Converter | Turn CSV, TSV, spreadsheet pastes, Excel files, Markdown, HTML tables, JSON or SQL INSERTs into any of those, or ASCII and LaTeX tables. | Table converter, Excel to CSV, CSV to SQL, CSV to HTML |
| Document to Text | Extract the text of PDF, Word, Excel, PowerPoint and OpenDocument files. | PDF to text, Word to text |
| JSON to Code | Generate typed classes from a JSON sample for C#, Java, Go, Python, Rust, Kotlin, Swift, Dart or PHP. | JSON to C#, JSON to Java, JSON to Go, JSON to Python |
| XSLT Transformer | Apply an XSLT 1.0 stylesheet to XML and see the result. | XSLT transform |
| BBCode ↔ HTML | Convert forum BBCode to HTML and back, with a preview. | BBCode to HTML, HTML to BBCode |

## Query and validate

| Tool | What it does | Replaces |
| --- | --- | --- |
| Regex Tester | Test JavaScript regular expressions with highlighted matches, capture groups and replacement preview. |  |
| JSONPath and jq | Query JSON with JSONPath expressions or real jq 1.8 filters and see the result instantly. |  |
| JSON Schema Validator | Validate JSON against a JSON Schema (drafts 4, 7, 2019-09 and 2020-12) and list every error with its location. |  |
| JSON Viewer | Explore JSON as a collapsible tree and see the path of any value. | JSON viewer |
| Regex Cheat Sheet and Code | Regular expression syntax at a glance, and ready-to-use code for a pattern in JavaScript, Python, Go, Java, C#, PHP, Rust or grep. | Regex cheatsheet, Regex code generator |
| IBAN Validator | Check IBAN check digits and lengths by country, and format them for print. | IBAN validator and parser |
| Phone Number Parser | Validate and format phone numbers for any country: type, E.164, national and international forms. | Phone parser and formatter |
| XPath and CSS Selector Tester | Run XPath expressions or CSS selectors against HTML or XML and see what they match. | XPath tester, CSS selector tester |
| Card Number Validator | Check payment card numbers with the Luhn algorithm and identify the network, with gateway test numbers. | Credit card validator |

## Encode and decode

| Tool | What it does | Replaces |
| --- | --- | --- |
| Base64 | Encode and decode Base64 and Base64URL, including files and data URIs. | Base64 Decode & Encode, Base64 encode and decode |
| Base32 | Encode and decode RFC 4648 Base32. | Base 32 Decoder |
| Base58 | Encode and decode Base58 text or hex (Bitcoin, Flickr, Ripple alphabets). | Base58 Decoder / Encoder |
| Base62 | Encode and decode URL-safe Base62. | Base 62 Encoder |
| Hex ↔ Text | Turn text into hex bytes and decode hex in any common notation. | Hex Decoder |
| URL Encode | Percent-encode and decode URLs, values and form data. |  |
| HTML Entities | Escape text for HTML and decode named or numeric entities. | HTML Encoder / Decoder |
| ASCII ↔ Text | Convert text to decimal, octal, hex or binary character codes and back. | ASCII to Text Converter |
| Binary ↔ Text | Translate text to binary and back, with a per-byte breakdown. | Binary Translator |
| UTF-8 Bytes | See the UTF-8 bytes of text, or decode percent, hex or decimal bytes. | UTF-8 Decoder |
| Morse Code | Translate text to International Morse Code and back. | Morse Code Translator |
| ROT13 and Caesar | Apply ROT13, ROT5, ROT18, ROT47 or a custom Caesar shift. | ROT13 Encoder/Decoder |
| JWT Decoder | Read a JSON Web Token and check its signature: HS, RS, PS, ES and EdDSA, with a PEM key, certificate, JWK, JWK set or the issuer’s published keys. | JWT Decoder, jwt.io debugger |
| JWT Encoder | Sign JSON Web Tokens with any common algorithm (HS, RS, PS, ES, EdDSA) using your key, or generate a test key pair as PEM and JWK. | JWT Encoder, jwt.io encoder |
| Image to Base64 | Embed an image as a data URI for CSS, HTML or Markdown. | Image Base64 |
| String Escape | Escape and unescape text for JSON, JavaScript, Java, C#, C, Python, shell, PowerShell, SQL, regex and CSV. |  |
| NATO Phonetic Alphabet | Spell text as Alfa, Bravo, Charlie and read it back. | Text to NATO alphabet |
| Basic Auth Header | Make or decode an HTTP Basic Authorization header, with curl and fetch examples. | Basic auth generator |
| Gzip Compress | Compress or decompress text and files with gzip, zlib or raw deflate, as Base64, hex or a download. | Gzip compress / decompress |
| Text Encoding Converter | Repair garbled text (mojibake), read bytes in any encoding, or write text as Windows-1252, ISO-8859, KOI8 and others. | Encoding converter |

## Hash, keys and passwords

| Tool | What it does | Replaces |
| --- | --- | --- |
| Hash and HMAC | MD5, SHA-1, SHA-2, SHA-3, Keccak, BLAKE2/3, RIPEMD-160, xxHash, CRC and more for text or files, with HMAC and checksum comparison. | SHA-1 Hash Generator, SHA-512 Hash Generator, MD5 hash generator, Hash text, NTLM hash, BLAKE3 hash, Keccak-256 |
| AES Encryption | Encrypt and decrypt with a password (AES-256-GCM, or OpenSSL-compatible CBC). | AES encryption and decryption |
| Htpasswd Generator | Create and check password entries for Apache and nginx basic auth. | Htpasswd Generator |
| Password Generator | Generate strong passwords or word passphrases from the system random source, with their entropy. |  |
| TOTP Codes (2FA) | Show and check two-factor codes for a secret, and set up authenticator apps with a QR code. |  |
| Certificate Decoder | Read X.509 certificates, signing requests and key files: names, validity, SANs, extensions and fingerprints. |  |
| SSH Key Generator | Generate Ed25519, ECDSA and RSA key pairs in OpenSSH and PEM formats, with fingerprints. |  |
| Certificate Maker | Make self-signed TLS certificates and CAs with alternative names, signing requests (CSR), and convert between PEM, DER and PFX. | online CSR and certificate generators |
| Password Strength | Estimate how long a password would survive online and offline attacks, and why (zxcvbn). | Password strength analyser |
| Password Hashing | Hash and verify passwords with Argon2id, bcrypt, scrypt or PBKDF2. | Bcrypt, Argon2 hash |
| Text Encryption (CryptoJS) | Encrypt and decrypt text with a passphrase using AES, Triple DES, Rabbit or RC4, compatible with CryptoJS and OpenSSL. | Encrypt / decrypt text |
| BIP39 Mnemonic | Generate and check BIP39 recovery phrases in ten languages, with entropy and seed. | BIP39 passphrase generator |
| PDF Signature Checker | Check the digital signatures in a PDF: unchanged since signing, signature valid, signer and certificate chain. | PDF signature checker |

## Generate

| Tool | What it does | Replaces |
| --- | --- | --- |
| UUID and ID Generator | Generate UUIDs (v1, v3, v4, v5, v6, v7), ULIDs, MongoDB ObjectIds, KSUIDs and Nano IDs in bulk, and decode the time inside them. | UUID & GUID Generator, ULID generator, MongoDB ObjectId generator, Nano ID generator |
| Random Words | Pick random words by length and case, for test data or passphrases. | Random Word Generator |
| Barcode Generator | Create Code 128, EAN, UPC, Code 39, ITF-14, QR and Data Matrix codes as SVG or PNG. | Barcode Generator |
| Cron Expression | Explain a cron expression and preview its next run times. | Cron Expression Generator |
| robots.txt Generator | Write crawler rules, including a block list for AI crawlers. | robots.txt Generator |
| llms.txt Generator | Build or validate an llms.txt file from links or a pasted sitemap. | llms.txt Generator |
| Email Link Builder | Build mailto links with subject and body, optionally hidden from scrapers. | Code for Email |
| Lorem Ipsum | Generate placeholder paragraphs, sentences or words, as plain text or HTML. |  |
| QR Code Generator | QR codes for links, Wi-Fi networks, UPI payments, contacts, email, SMS, calls and map locations, with error-correction levels. | QR code generator, WiFi QR code generator |
| Placeholder Image | SVG placeholder images of any size and colour, as a file or data URI. | SVG placeholder generator |
| Meta Tag Generator | Title, description, Open Graph and X/Twitter card tags for sharing previews. | Open graph meta generator |
| Random Generator | Secure random numbers, primes, strings, list picks and shuffles, groups, IPs, ports, dates, colours, dice and coins. | Random number generator, List randomizer, Random port generator |
| Mock Data Generator | Fictional people, addresses, companies, dates and amounts as JSON, CSV or SQL for testing. | Mock data generator |
| Chart Maker | Bar, line, area, pie, doughnut and scatter charts from CSV, as SVG or PNG. | Chart maker |

## Text

| Tool | What it does | Replaces |
| --- | --- | --- |
| Diff Checker | Compare two texts, JSON, XML, Word, Excel or PDF files side by side by line, word or character; jump between changes, collapse the rest and export a patch. | Diff Checker, Text Compare, JSON diff, XML diff, PDF compare, Word compare |
| Case Converter | Switch between camelCase, snake_case, kebab-case, Title Case and more. | Case Converter |
| Duplicate Line Remover | Remove repeated lines, with control over case and which copy to keep. | Duplicate Line Remover |
| Remove Line Breaks | Join lines into paragraphs or a single line. | Remove Line Breaks |
| Text Reverser | Reverse characters, word order or line order. | Text Reverser |
| Word Counter | Count words, characters, sentences and paragraphs, with reading time and the most frequent words. |  |
| Sort Lines | Sort lines alphabetically, naturally, by number or length, shuffle them and remove duplicates. |  |
| Slug Generator | Turn titles into URL slugs, with or without accents and non-Latin scripts. |  |
| Unicode Inspector | Reveal invisible, look-alike and direction-changing characters, and clean them out of text. |  |
| List Converter | Trim, dedupe, sort, shuffle, quote, prefix and join lists, or turn them into SQL IN clauses. | List converter |
| ASCII Art Text | Big FIGlet lettering in twenty fonts, optionally wrapped as a code comment. | ASCII art text generator |
| String Obfuscator | Mask the middle of secrets, tokens or IDs so they can be shared safely. | String obfuscator |
| Numeronym Generator | Shorten words like internationalization to i18n. | Numeronym generator |
| Email Normalizer | Reduce addresses to the mailbox they deliver to: lower case, +tags and Gmail dots removed, duplicates dropped. | Email normalizer |
| Emoji Picker | Search every emoji and copy it as a character, code points, HTML entity or escape. | Emoji picker |
| Extract from Text | Pull email addresses, links, phone numbers, IPs, hashtags, dates, amounts and more out of any text. | Email extractor, URL extractor |
| Text Cleaner | Trim, collapse spaces, drop empty lines, strip HTML, straighten quotes, remove accents or emoji, number lines and filter lines. | Remove extra spaces, Strip HTML tags, Add line numbers |
| Text Repeater | Repeat text any number of times, with separators and numbering. | Text repeater |
| Fancy Text Styles | Bold, italic, script, double-struck, circled, full-width, small caps and upside-down Unicode text. | Unicode text styles |

## Web and network

| Tool | What it does | Replaces |
| --- | --- | --- |
| Email Header Analyzer | Paste message headers to see the route a message took, the delay at each hop and its SPF, DKIM and DMARC results. | Email header analyzer |
| URL Parser | Split a URL into its parts and query parameters, or build one from JSON. |  |
| Subnet Calculator | Work out IPv4 and IPv6 network ranges, masks, host counts and smaller subnets from CIDR notation. |  |
| HTTP Status Codes | Look up what every HTTP status code means and which specification defines it. |  |
| MIME Types | Find the media type for a file extension, or the extensions for a media type. |  |
| User-Agent Parser | Identify the browser, engine, operating system and device type in a User-Agent string. |  |
| Security Headers | Build a Content-Security-Policy, HSTS and other security headers for nginx, Apache, Caddy, Express or Netlify. |  |
| Web Server Config | Generate nginx, Apache or Caddy configuration for a static site, a single-page app or a reverse proxy. |  |
| WireGuard Config Generator | Make a WireGuard server and client configurations with fresh keys, preshared keys, NAT rules and QR codes for phones. | WireGuard config generators |
| Link Unwrapper | Recover the real address behind Outlook Safe Links, Proofpoint, Google, Facebook and other redirects, and strip tracking parameters. | Outlook Safelink decoder, Redirect link decoder |
| IP Address Converter | IPv4 and IPv6 in decimal, hex, binary and mapped forms; IP ranges to CIDR blocks; random IPv6 ULA prefixes. | IPv4 address converter, IPv4 range expander, IPv6 ULA generator |
| MAC Address Lookup | Find the manufacturer of a MAC address from the bundled IEEE registry, and generate random or prefixed addresses. | MAC address lookup, MAC address generator |

## Online checks

| Tool | What it does | Replaces |
| --- | --- | --- |
| Website Status | Is a site up or down? Status, redirects, response time, IP, certificate expiry, title and security headers for one or many addresses. | Website down checker, HTTP status checker, Redirect checker, HTTP headers checker |
| SSL Certificate Checker | Expiry date, trust, covered names, chain, protocol, cipher and TLS 1.2/1.3 support for any host and port, singly or in bulk. | SSL checker, SSL expiry checker, TLS checker |
| Domain WHOIS and Expiry | Registrar, registration and expiry dates, status codes, name servers and DNSSEC from RDAP or WHOIS, for one domain or a list. | WHOIS lookup, Domain expiry checker, Domain age checker, RDAP lookup |
| DNS Lookup | Query A, AAAA, MX, TXT, NS, SOA, CAA, PTR, DS, DNSKEY and more from any resolver, over UDP, TCP or HTTPS, with dig-style output. | DNS lookup, MX lookup, NS lookup, Reverse DNS, CNAME lookup, TXT lookup, DNSSEC check |
| DNS Propagation | Ask 40 public resolvers around the world for a record and see on a map which already return the new value. | DNS propagation checker |
| IP Lookup | Your public IP, or any address: reverse DNS, network owner, ASN, allocated block and abuse contact from RDAP. | What is my IP, IP WHOIS, ASN lookup, Domain to IP |
| Email DNS Check | MX, SPF with the 10-lookup limit, DMARC, DKIM keys, MTA-STS, TLS-RPT and BIMI for a domain, with plain-language findings. | SPF checker, DMARC checker, DKIM checker, MX lookup, MTA-STS checker, BIMI checker |
| Port Checker | See which TCP ports on a host accept connections from this computer, using presets or your own list and ranges. | Open port checker |
| Broken Link Checker | Fetch a page and test every link, image, script and stylesheet on it; broken and redirected ones first. | Broken link checker |
| HTTP Request | Send GET, POST, PUT or DELETE requests with headers and a body, and inspect the status, timing, headers and response. | Online REST client |

## DevOps and config

| Tool | What it does | Replaces |
| --- | --- | --- |
| Chmod Calculator | Convert Unix permissions between checkboxes, octal (755) and rwx, with ready chmod commands. |  |
| docker run to Compose | Convert docker run commands into a compose.yaml file, with named volumes and networks. |  |
| .gitignore Generator | Build a .gitignore from templates for languages, frameworks, editors and operating systems. |  |
| Semver Checker | Sort version numbers and test them against npm-style ranges such as ^1.2 or &gt;=2 &lt;3. |  |

## CSS generators

| Tool | What it does | Replaces |
| --- | --- | --- |
| SCSS and Less to CSS | Compile SCSS, indented Sass or Less to plain or minified CSS. | SCSS to CSS, LESS to CSS |
| Gradient Generator | Linear, radial and conic gradients as CSS, SVG, Canvas, SwiftUI, Android XML or PNG. | CSS Gradient Generator, CSS Gradient, Gradient Generator, Gradient Image |
| Mesh Gradient | Soft multi-point gradients as CSS, SVG or PNG. | Mesh Gradient Generator |
| Box Shadow | Layer drop shadows and copy the CSS or Tailwind class. | CSS Box Shadow Generator, Box Shadow |
| Text Shadow | Stack text shadows for glows, outlines and 3D lettering. | CSS Text Shadow Generator, Text Shadow |
| Border Radius | Round corners individually or shape organic blobs. | CSS Border Radius Generator, Border Radius |
| Border | Set border width, style and colour per side. | Border |
| Background | Compose background colour, image, repeat, position and size. | Background |
| Background Patterns | Grids, dots, stripes, checks and starfields built from CSS gradients. | Background Generator |
| Glassmorphism | Frosted-glass panels with blur, tint and border. | Glassmorphism Generator |
| Clip-Path | Draw polygon, circle, ellipse and inset clip-paths by dragging points. | CSS Clip-Path Generator |
| Flexbox | Try flex container and item settings with a live layout. | CSS Flexbox Generator, Flexbox layout Generator |
| Grid | Define tracks, gaps and named areas for CSS Grid. | CSS Grid Generator, Grid layout Generator |
| Transform | Translate, rotate, scale and skew, with the equivalent matrix(). | Matrix Transform |
| Transition | Tune transition timing and try it on hover. | Transition |
| Animation | Pick or write keyframes and set the animation timing. | Animation, CSS Animation Kit |
| Filter | Combine blur, brightness, contrast, hue and other CSS filters. | Image Filter (CSS) |
| Cubic Bezier | Shape an easing curve and export it for CSS and animation libraries. | Cubic Bezier Generator |
| Media Query | Build @media queries and test them in a resizable frame. | CSS Media Query |
| Bootstrap Theme Builder | Edit any of Bootstrap 5.3's Sass variables with a live preview, then export Sass or compiled CSS. | Bootstrap Build (Bootstrap 5 theme editor) |
| Blob Generator | Random organic shapes as SVG, optionally animated. | Blob Generator |
| Wave Generator | Layered SVG waves for section dividers. | Wave Generator |
| Sunburst Generator | Radiating ray patterns as CSS or SVG. | Sunburst Generator |

## Colour

| Tool | What it does | Replaces |
| --- | --- | --- |
| Colour Harmonies | Complementary, triadic, analogous, tetradic and monochrome palettes from one colour, as CSS variables. | Color scheme generator |
| Colour Converter | Convert between HEX, RGB, HSL, OKLCH and more, with gamut checks. | OKLCH Converter |
| Colour Shades | Build a perceptually even 50-950 scale from one colour. | Color Shades Generator |
| Contrast Checker | Check WCAG contrast and get the nearest passing colour. | Color Contrast Checker |
| Tailwind Colours | Browse the Tailwind v4 palette, copy any shade, or match a hex value. | Tailwind Colors |
| shadcn/ui Theme | Generate accessible light and dark theme variables from one colour. | Shadcn Theme Generator |
| Colour Blindness Simulator | See an image as people with common colour vision deficiencies do. | Color Blindness Simulator |

## Images and SVG

| Tool | What it does | Replaces |
| --- | --- | --- |
| Image Converter | Convert and compress between PNG, JPEG, WebP and AVIF. | AVIF Converter, PNG to WebP Converter, Image Compress |
| Image Resize | Resize by pixels or percentage, keeping the aspect ratio if you want. | Image Resize |
| Image Annotator | Mark up screenshots and photos: arrows, boxes, text, numbered steps, highlights, and blur or pixelation for private details. Paste with Ctrl+V. | Snagit and Greenshot editors, online screenshot annotators |
| Image Crop | Crop freely or to a fixed aspect ratio. | Image Crop |
| Image Rotate | Rotate by any angle and flip horizontally or vertically. | Image Rotate |
| Image Filter | Adjust brightness, contrast, saturation, blur and more, or go greyscale. | Image Filter, Image Grayscale |
| Colour Replacer | Replace or swap colours in an image, with tolerance and soft edges. | Color Swapper, PNG Color Replacer |
| Image Fade | Fade an image to transparent evenly, along a line or from a point. | Image Fade Effect Generator |
| Image Colour Picker | Pick colours from an image and extract its palette. | Image Color Picker/Palette |
| Favicon and ICO | Make multi-size .ico files, PNG icons and the HTML tags for them. | Favicon Generator, PNG to ICO Converter, ICO Transparency Creator |
| SVG to PNG | Rasterise SVG at any scale, with or without a background. | SVG to PNG Converter |
| SVG Viewer | Preview SVG safely and see its size, viewBox and tidy source. | SVG Viewer |
| SVG Background Remover | Remove the backdrop of an SVG without rasterising it. | SVG Background Remover |
| Photo Metadata (EXIF) | See the camera, date and GPS location hidden in photos, and save a copy without them. |  |
| QR Code Reader | Read QR codes from screenshots and photos, and see what Wi-Fi, contact or link details they hold. |  |
| CSS Sprite Generator | Combine icons into one sprite sheet and get the CSS class for each, at 1× or 2×. |  |
| Image Watermark | Add a text watermark in a corner, the centre or repeated across the picture, with opacity and angle. | SnapOtter Watermark |
| Meme and Caption Maker | Put top and bottom text on a picture, outlined on the picture or in caption bars. | SnapOtter Meme generator |
| Screenshot Beautifier | Set a screenshot in an app or browser window on a gradient, with rounded corners and a shadow, for slides and posts. | SnapOtter Screenshot beautifier |
| Passport and ID Photo | Crop a portrait to 35 × 45 mm, 2 × 2 in and other sizes with head guides, and make a print sheet of copies. | SnapOtter Passport photo |
| Image to SVG (Trace) | Trace logos, icons and drawings into scalable SVG shapes, with presets for logos, artwork and line art. | SnapOtter Vectorize |
| GIF Maker | Make an animated GIF from pictures, with frame timing, size, colours and back-and-forth play. | SnapOtter GIF maker |
| Duplicate Picture Finder | Find identical and look-alike pictures among hundreds of files with a perceptual hash, and save a report. | SnapOtter Duplicate finder |

## AI image and speech

| Tool | What it does | Replaces |
| --- | --- | --- |
| Background Remover | Cut out the subject of a photo, or put it on a colour or a blurred background. AI model on this computer. | SnapOtter Background Remover |
| Image Upscaler | Enlarge pictures 2×, 3× or 4× with Real-ESRGAN, recovering detail instead of blurring. | SnapOtter Upscaler |
| Face Blur | Find faces and blur, pixelate or cover them; remove boxes or draw your own before saving. | SnapOtter Face Blur |
| Object Eraser | Paint over people, wires or text in a photo and fill the gap from the surroundings. | SnapOtter Object Eraser |
| Text Recognition (OCR) | Read English and Hindi text from pictures and scanned PDFs, and make scans searchable. Works offline, also in a browser. | SnapOtter OCR, Optical Character Recognition |
| Transcription and Subtitles | Turn speech in English, Hindi and 97 other languages into text, SRT or WebVTT subtitles with Whisper, on this computer; can translate into English. | SnapOtter Transcription |
| AI Models | Download, import or remove the AI engine and models the AI tools use, and see their licences and sizes. |  |

## PDF

| Tool | What it does | Replaces |
| --- | --- | --- |
| Merge and Organise PDF | Merge PDFs, and reorder, rotate or delete pages by dragging page pictures. Runs in the app; nothing is uploaded. | SnapOtter PDF merge, SnapOtter PDF organise |
| Split PDF | Split a PDF into page ranges or single pages, keep chosen pages, or remove some. | SnapOtter PDF split |
| PDF Watermark and Page Numbers | Add a watermark, page numbers ("Page 3 of 12") or a header or footer line, with a live preview. | SnapOtter PDF watermark, SnapOtter PDF page numbers |
| PDF Properties | See page sizes, version and form fields, and edit or remove the title, author, keywords and dates. | SnapOtter PDF metadata |
| Pictures and PDF | Turn pictures into a PDF (A4, Letter or each picture’s size), or save PDF pages as PNG, JPEG or WebP. | SnapOtter Images to PDF, SnapOtter PDF to images |
| PDF Passwords and Compression | Add or remove PDF passwords (AES-256), optimise losslessly, or shrink pictures. Uses qpdf and Ghostscript. | SnapOtter PDF protect, SnapOtter PDF unlock, SnapOtter PDF compress |
| PDF Form Filler | Fill in PDF forms, or write text, ticks and dates anywhere on scanned and printed-style forms, in English or Hindi; can lock the answers. | Adobe Fill & Sign (filling), Smallpdf and iLovePDF form filling |
| PDF Signer | Sign PDFs with a drawn, typed or scanned signature, and digitally with a .p12 or .pfx certificate (or a self-signed one made here). | Adobe Fill & Sign (signing), DocuSign-style self signing, Smallpdf eSign |

## Diagrams and viewers

| Tool | What it does | Replaces |
| --- | --- | --- |
| Mermaid Diagram Editor | Write flowcharts, sequence, class, state, Gantt, ER, mind map and timeline diagrams as text and see them drawn; save SVG or PNG. | Mermaid Live Editor |
| Graphviz (DOT) Viewer | Draw Graphviz DOT graphs with the real Graphviz layout engine, live as you type; save SVG or PNG. | GraphvizOnline, Edotor |
| SQL to ER Diagram | Paste CREATE TABLE statements and get an entity-relationship diagram with keys and relationships, or the Mermaid code for it. | dbdiagram.io (from SQL), drawSQL |
| OpenAPI Viewer | Read OpenAPI 3 and Swagger 2 documents as a browsable API reference with parameters, bodies, responses and schemas; export Markdown. | Swagger Editor (viewing), Redocly preview |
| HAR Viewer | Open HTTP Archive files from browser developer tools: requests, timings waterfall, headers and bodies, with filters. | Google HAR Analyzer |
| Hex Viewer | Look inside any file byte by byte: offsets, hex and text, search for text or bytes, and read values as integers, floats and dates. | HexEd.it (viewing) |
| SQLite Browser | Open SQLite databases or load CSV files as tables, run any SQL, and export results as CSV or JSON. | DB Browser for SQLite (browsing), online CSV SQL tools |
| 3D Model and G-code Viewer | Turn and zoom STL, OBJ, PLY, glTF and GLB models, and preview 3D-printer and CNC G-code toolpaths coloured by height. | viewstl.com, NC Viewer |
| Code Screenshot | Turn code into a clean picture with syntax colours, a window frame and a background, for slides and posts. | Carbon, ray.so |

## Files, video and audio

| Tool | What it does | Replaces |
| --- | --- | --- |
| File Converter | Convert video, audio, pictures, drawings, Office documents, Markdown and e-books in batches with the programs installed on this computer. | ConvertX |
| Video Toolkit | Compress, trim, resize, crop, rotate, speed up, join, mute, make GIFs, save frames, add logos and subtitles. Uses FFmpeg. | SnapOtter Video tools |
| Audio Toolkit | Convert, trim, join, even out loudness, fade, remove silence and noise, change speed, and draw waveforms. Uses FFmpeg. | SnapOtter Audio tools |
| ZIP and Archives | Open ZIP (also with a password), TAR and .gz files, preview and save what is inside, or make a ZIP. | SnapOtter ZIP tools |
| CSV Merge and Split | Merge CSV files by column name, with an optional source column and duplicate removal, or split one by rows or by a column. | SnapOtter CSV tools |

## Recipe (CyberChef)

| Tool | What it does | Replaces |
| --- | --- | --- |
| Recipe | Chain CyberChef’s 505 operations to decode, decrypt, decompress, hash, chart and analyse data, with Magic to work out the steps. Loads CyberChef recipes. | CyberChef |

## Math, units and time

| Tool | What it does | Replaces |
| --- | --- | --- |
| Math Evaluator | Calculate with variables, units, matrices and functions, line by line (math.js). | Math evaluator |
| Percentage Calculator | Percent of, percentage change, increase, decrease and GST in one place. | Percentage calculator |
| ETA Calculator | When will a job finish? Time left and finish time from progress so far. | ETA calculator |
| Benchmark Statistics | Mean, median, spread and relative speed for benchmark runs, as a Markdown table. | Benchmark builder |
| Stopwatch and Timer | Stopwatch with laps, countdown timer and Pomodoro cycles, with a sound when time is up. | Chronometer |
| Unit Converter | Over 1,250 units in 119 quantities, from length and pressure to viscosity, radiation dose, lab results, Indian land units, yarn counts, paper weights and gold purity. Type “5 bigha (UP) in acres” or pick units; see the value in every unit at once. | Unit converter, Temperature converter, Engineering ToolBox unit converters, convertunits.com |
| Date Calculator | Days, weeks, months and working days between dates, or a date plus or minus days, workdays, months or years. | Date calculator, Days between dates |
| Time Sheet Calculator | Total hours worked from start and end times with breaks, overtime and pay. | Time sheet calculator |
| Coordinates Converter | Convert latitude and longitude between decimal, DMS, UTM, geohash and Plus Codes, and measure distance and bearing. | Coordinates converter |
| Time Zone Planner | See one time in many places and find meeting hours that fall in everyone’s working day, with daylight saving handled. | timeanddate.com meeting planner, World Time Buddy |

## Calculator library

| Tool | What it does | Replaces |
| --- | --- | --- |
| Finance Calculators | Loan EMI, SIP, compound interest, recurring deposits, CAGR, ROI, GST, margins, break-even, inflation and more. | Omni Calculator Finance |
| Health Calculators | BMI, BMR and daily calories, body fat, ideal weight, heart-rate zones, water and protein intake. | Omni Calculator Health |
| Sports Calculators | Running pace and race prediction, one-rep max, VO₂ max, cycling, swimming, hiking and cricket run rates. | Omni Calculator Sports |
| Physics Calculators | Motion, forces, energy, momentum, pressure, Ohm’s law, projectiles, waves, gravity and heat. | Omni Calculator Physics |
| Chemistry Calculators | Molarity, dilution, gas laws, pH and buffers, yield, half-life, ppm and reaction rates. | Omni Calculator Chemistry |
| Math Calculators | Triangles, circles and solids, quadratic equations, proportions, logarithms, slopes and polygons. | Omni Calculator Math |
| Statistics Calculators | Z-scores, confidence intervals, sample size, margin of error, combinations and probabilities. | Omni Calculator Statistics |
| Construction Calculators | Concrete, bricks, tiles, paint, flooring cost, roof pitch, gravel, timber, tanks and stairs. | Omni Calculator Construction |
| Conversion Calculators | Fuel economy, pace and speed, temperature, cups to grams, screen size and shoe sizes. | Omni Calculator Conversion |
| Everyday Life Calculators | Appliance electricity cost, trip fuel cost, unit prices, marks and CGPA, gas cylinders and battery life. | Omni Calculator Everyday Life |
| Food Calculators | Recipe scaling, calories from macros, pizza value, coffee and rice ratios, baking pans and brines. | Omni Calculator Food |
| Biology Calculators | Growth and generation time, Hardy–Weinberg, DNA concentration, Beer–Lambert, centrifuge g-force and more. | Omni Calculator Biology |
| Ecology and Weather Calculators | Car and electricity CO₂, rainwater harvesting, solar output, dew point, heat index and wind chill. | Omni Calculator Ecology and Weather |
| Electronics Calculators | Ohm’s law, voltage dividers, LED resistors, RC and LC circuits, reactance, 555 timers, op-amp gain and battery life. | Omni Calculator Electronics |
| Engineering Calculators | Stress and strain, torque and power, gears and pulleys, springs, beam formulas, hydraulic cylinders, pipe flow, thermal expansion and bolt torque. | Omni Calculator Engineering |
| Heat and Combustion Calculators | Insulated pipe heat loss and insulation thickness, pipe expansion loops, heat exchanger LMTD, combustion air, flue gas loss, fuel use, hot air balloon lift and buoyancy. | Engineering ToolBox heat loss and combustion calculators |
| Sound and Acoustics Calculators | Add decibels, sound level at a distance, sound power to pressure, reverberation time (Sabine, Eyring), wavelength, A and C weighting, noise dose and the mass law. | Engineering ToolBox acoustics calculators |
| Other Calculators | Download time, video size, print size, aspect ratio, typing and reading speed, storage and inverter backup. | Omni Calculator Other |

## Projection and AV

| Tool | What it does | Replaces |
| --- | --- | --- |
| Projector Calculator | Throw distance, image size, lens shift and mounting height, screen brightness in foot-lamberts and nits, and seating distance, with a side-view drawing. | ProjectorCentral projection calculator |
| Screen Size Calculator | Width, height and diagonal for any aspect ratio, and equivalent sizes in other shapes at the same height, width or area. | ProjectorCentral screen size calculator |
| Projector Edge Blending | Plan a grid of overlapping projectors: total resolution, canvas size, overlap in pixels, spacing, throw and brightness. |  |

## Electrical and power

| Tool | What it does | Replaces |
| --- | --- | --- |
| Wire Gauge Chart | AWG, SWG and metric (IEC 60228) wire sizes side by side: diameter, area in mm² and kcmil, resistance at any temperature and mass for copper, aluminium and steel; find the closest size in each system. | Engineering ToolBox AWG and SWG tables, Wire gauge converters |
| Power Converter (kW, kVA, Amps, hp) | Convert between kW, kVA, kVAR, line current and motor horsepower for single-phase, three-phase and DC supplies. | kVA to Amps Calculator, kW to kVA Calculator, 3-Phase Power Calculator |
| Power Factor Correction | Capacitor kVAR to raise the power factor, the next standard bank size, capacitance per phase and the current and losses saved. |  |
| Cable Size and Voltage Drop | Cable size for current and voltage drop to IEC 60364 (mm²) or NEC (AWG), with temperature and grouping factors. | Cable Size Calculator |
| Circuit Breaker Size | Breaker rating and trip curve for general, continuous, motor, EV and transformer loads, checked against the cable rating. | Circuit Breaker Size Calculator |
| Transformer Size | Transformer kVA for a load, primary and secondary current, turns ratio and secondary fault level, with IEC and US standard ratings. | Transformer Size Calculator, Transformer Calculator |
| Motor Current and Torque | Full-load current, input power, torque, slip and starting current of an induction motor, with NEC table values. | Motor FLA Calculator |
| Conduit Fill | Percentage fill of a conduit and the smallest size that fits, using NEC Chapter 9 areas or any cable diameters in mm. |  |
| Earthing Conductor Size | Protective earth conductor size by the IEC 60364-5-54 adiabatic equation or table, or the NEC 250.122 grounding conductor. |  |
| Generator Sizing | Diesel generator kVA for a load list with motor starting, altitude and temperature derating, and fuel use per hour. |  |
| Load and Energy Cost | Connected load, maximum demand, load factor, monthly units, bill and CO₂ from a list of appliances. | Factory Load Calculator, Load Factor Calculator |
| RTD (Pt100) Calculator | Convert Pt100, Pt500 and Pt1000 resistance and temperature (IEC 60751), with tolerance classes and lead-wire error. |  |
| PLC Analog Scaling | Scale 4–20 mA, 0–10 V or raw counts to engineering units and back, with square-root extraction for DP flow. |  |
| Encoder Calculator | Encoder pulse frequency, resolution and counts per mm for wheels and lead screws, with x1, x2 and x4 decoding. |  |
| Ohm's Law Calculator | Enter any two of voltage, current, resistance and power to get the other two. |  |
| EV Charging Calculator | Charging time and cost for a vehicle battery, and the supply needed for a group of AC or DC chargers. |  |
| Data Centre Power | IT load, UPS modules with redundancy, cooling and facility power from rack density and PUE, with yearly energy cost. |  |
| Resistor and Capacitor Codes | Resistor colour bands both ways, SMD resistor codes (including EIA-96), capacitor markings and the nearest E-series values. | Digi-Key and Mouser code calculators |
| Serial Monitor | Talk to Arduino, ESP32, GPS and other devices on a serial (COM) port as text or hex, with timestamps, DTR and RTS. | Arduino Serial Monitor, online Web Serial terminals |

## Batteries, UPS and solar

| Tool | What it does | Replaces |
| --- | --- | --- |
| UPS Sizing and Runtime | UPS kVA for a load, battery backup time for a battery bank, or the battery capacity for the backup you need. | UPS Runtime Calculator, UPS Capacity Calculator |
| Battery Calculator | Bank voltage and energy, runtime for a load (Peukert for lead-acid), and charging time for lead-acid and lithium batteries. |  |
| Solar System Sizing | Panel count, array kW, string length within the inverter voltage and battery bank for grid-tied, hybrid and off-grid systems. |  |

## Mechanical and fluids

| Tool | What it does | Replaces |
| --- | --- | --- |
| Steam Tables | Water and steam properties from IAPWS-IF97: any state from pressure with temperature, enthalpy, entropy or dryness fraction; saturation tables; tables along one pressure. Density, enthalpy, entropy, heat capacity, speed of sound, viscosity, conductivity. | Engineering ToolBox steam tables, Spirax Sarco steam tables, Saturated steam table |
| Beam Calculator | Reactions, shear force, bending moment, deflection and bending stress for simply supported, cantilever, fixed, propped and continuous beams under point, uniform and varying loads and moments, with diagrams. | Engineering ToolBox beam calculator, SkyCiv beam calculator, ClearCalcs beam |
| Section Properties | Area, centroid, second moments, elastic and plastic moduli, radii of gyration, principal axes, torsion constant and mass per metre for I-beams, channels, angles, tees, boxes, tubes, bars and rectangles. | Engineering ToolBox area moment of inertia, Section property calculators |
| Pump Sizing | Total dynamic head, motor power, running cost and NPSH available for a water pumping system. |  |
| Pipe Flow and Pressure Drop | Velocity, Reynolds number, friction factor and pressure drop in a pipe by Darcy–Weisbach. |  |
| Valve Cv and Kv | Size a control valve: Kv and Cv from flow and pressure drop, or flow from a valve rating, for liquids and gases. |  |
| Hydraulic Cylinder | Push and pull force, speeds, oil per stroke and pump power of a hydraulic cylinder. |  |
| Bearing Life (L10) | ISO 281 basic and modified rating life of a rolling bearing from its load rating, loads and speed. |  |
| Pneumatic Cylinder | Cylinder force, the ISO 15552 bore for a load, and free-air consumption per cycle and per minute. |  |
| Air Compressor and Receiver | Compressor capacity and power for a list of air users, yearly energy cost and air receiver volume. |  |
| Compressed Air Leak Cost | Air lost through leaks of a given hole size, the compressor power wasted, and yearly cost and CO₂. |  |
| Compressed Air Pipe Size | Smallest pipe for an airflow and allowed pressure drop, with the drop and velocity in standard pipe sizes. |  |
| Dew Point Calculator | Dew point from temperature and humidity, and pressure dew point to atmospheric dew point, with ISO 8573-1 water classes. |  |
| Speeds, Feeds and Machining Time | Spindle speed, feed rate, metal removal rate, cutting power and machining time for milling, drilling and turning. |  |
| Tap Drill Size | Tap drill for metric, UNC, UNF and pipe threads, the percentage of thread, and sizes for cutting and forming taps. |  |
| Tool Life (Taylor) | Tool life against cutting speed by Taylor's equation, from one or two tests, with minimum-cost and maximum-output speeds. |  |
| Sheet Metal Bending | Bend allowance, bend deduction, K-factor, flat blank length, press-brake force and V-die width. |  |

## HVAC and building

| Tool | What it does | Replaces |
| --- | --- | --- |
| Cooling Load (AC Tonnage) | Screening cooling load of a room from area, exposure, people, lights, equipment and outdoor air, with the AC size in tons. |  |
| Air Changes per Hour | Airflow from air changes per hour or the reverse, typical rates by space, and the time to clear airborne particles. |  |
| Duct Sizing | Round and rectangular duct sizes by friction rate or velocity, with pressure drop and standard sizes. |  |
| Fan and Pump Affinity Laws | New flow, pressure and power when speed, impeller diameter or air density changes, with energy saved by slowing down. |  |
| Chiller Capacity and Flow | Chiller tonnage from chilled-water flow and temperatures or the reverse, kW per TR, COP and condenser water flow. |  |
| Psychrometric Calculator | Moist-air properties from dry bulb and one more value: humidity, wet bulb, dew point, enthalpy, and the mix of two air streams. |  |
| Superheat, Subcooling and P–T Chart | Superheat and subcooling from gauge readings, and pressure–temperature charts for R-32, R-410A, R-22, R-290 and other refrigerants. |  |
| AC Efficiency Savings (ISEER, SEER) | Yearly energy, cost and CO₂ of two air conditioners by ISEER, SEER or EER, with the payback of the efficient one. |  |

## Reference and extras

| Tool | What it does | Replaces |
| --- | --- | --- |
| Device Information | Screen, pixel ratio, window size, languages, time zone, CPU and display preferences of this computer. | Device information |
| Keycode Info | Press a key to see its key, code, keyCode, location and modifiers, with a ready event handler. | Keycode info |
| HTML Editor (WYSIWYG) | Write formatted text and copy it as clean HTML or Markdown. | HTML WYSIWYG editor |
| HTML Playground | Try HTML and CSS, with Bootstrap 5 available offline and a resizable preview. | Bootstrap Code Editor |
| Command Cheat Sheet | Equivalent terminal commands for Linux, Windows cmd and PowerShell. | Basic Commands - Ubuntu/Windows |
| Android Button Maker | Design a button and get the shape-drawable XML. | Android Button Maker |
| Payment Fee Calculator | Work out card processing fees, or what to charge to receive a set amount. | Stripe Fee Calculator |
| CAC Calculator | Customer acquisition cost, payback period and LTV:CAC. | Customer Acquisition Cost (CAC) Calculator |

## Coverage of the original web tools

354 web tools map onto Benchtop tools:

| Web tool | Benchtop tool |
| --- | --- |
| 3-Phase Power Calculator | Power Converter (kW, kVA, Amps, hp) |
| Add line numbers | Text Cleaner |
| Adobe Fill & Sign (filling) | PDF Form Filler |
| Adobe Fill & Sign (signing) | PDF Signer |
| AES encryption and decryption | AES Encryption |
| Android Button Maker | Android Button Maker |
| Android Pixel Calculator | Android Pixel Calculator |
| Animation | Animation |
| Arduino Serial Monitor | Serial Monitor |
| Argon2 hash | Password Hashing |
| ASCII art text generator | ASCII Art Text |
| ASCII to Text Converter | ASCII ↔ Text |
| ASN lookup | IP Lookup |
| AVIF Converter | Image Converter |
| Background | Background |
| Background Generator | Background Patterns |
| Barcode Generator | Barcode Generator |
| Base 32 Decoder | Base32 |
| Base 62 Encoder | Base62 |
| Base Converter | Number Base Converter |
| Base58 Decoder / Encoder | Base58 |
| Base64 Decode & Encode | Base64 |
| Base64 encode and decode | Base64 |
| Basic auth generator | Basic Auth Header |
| Basic Commands - Ubuntu/Windows | Command Cheat Sheet |
| BBCode to HTML | BBCode ↔ HTML |
| Bcrypt | Password Hashing |
| Benchmark builder | Benchmark Statistics |
| BIMI checker | Email DNS Check |
| Binary Calculator | Binary Calculator |
| Binary Translator | Binary ↔ Text |
| BIP39 passphrase generator | BIP39 Mnemonic |
| BLAKE3 hash | Hash and HMAC |
| Blob Generator | Blob Generator |
| Bootstrap Build (Bootstrap 5 theme editor) | Bootstrap Theme Builder |
| Bootstrap Code Editor | HTML Playground |
| Border | Border |
| Border Radius | Border Radius |
| Box Shadow | Box Shadow |
| Broken link checker | Broken Link Checker |
| Cable Size Calculator | Cable Size and Voltage Drop |
| Carbon | Code Screenshot |
| Case Converter | Case Converter |
| Chart maker | Chart Maker |
| Chronometer | Stopwatch and Timer |
| Circuit Breaker Size Calculator | Circuit Breaker Size |
| ClearCalcs beam | Beam Calculator |
| CNAME lookup | DNS Lookup |
| Code for Email | Email Link Builder |
| Color Blindness Simulator | Colour Blindness Simulator |
| Color Contrast Checker | Contrast Checker |
| Color scheme generator | Colour Harmonies |
| Color Shades Generator | Colour Shades |
| Color Swapper | Colour Replacer |
| convertunits.com | Unit Converter |
| ConvertX | File Converter |
| Coordinates converter | Coordinates Converter |
| Credit card validator | Card Number Validator |
| Cron Expression Generator | Cron Expression |
| CSS Animation Kit | Animation |
| CSS Beautifier | CSS Formatter |
| CSS Border Radius Generator | Border Radius |
| CSS Box Shadow Generator | Box Shadow |
| CSS Clip-Path Generator | Clip-Path |
| CSS Flexbox Generator | Flexbox |
| CSS Gradient | Gradient Generator |
| CSS Gradient Generator | Gradient Generator |
| CSS Grid Generator | Grid |
| CSS Media Query | Media Query |
| CSS minify and beautify | CSS Formatter |
| CSS selector tester | XPath and CSS Selector Tester |
| CSS Text Shadow Generator | Text Shadow |
| CSS to Tailwind Converter | CSS to Tailwind |
| CSV to HTML | Table Converter |
| CSV to JSON Converter | CSV to JSON |
| CSV to SQL | Table Converter |
| Cubic Bezier Generator | Cubic Bezier |
| cURL to Code Converter | cURL to Code |
| cURL to Fetch Converter | cURL to Code |
| Customer Acquisition Cost (CAC) Calculator | CAC Calculator |
| CyberChef | Recipe |
| Date calculator | Date Calculator |
| Days between dates | Date Calculator |
| DB Browser for SQLite (browsing) | SQLite Browser |
| dbdiagram.io (from SQL) | SQL to ER Diagram |
| Device information | Device Information |
| Diff Checker | Diff Checker |
| Digi-Key and Mouser code calculators | Resistor and Capacitor Codes |
| DKIM checker | Email DNS Check |
| DMARC checker | Email DNS Check |
| DNS lookup | DNS Lookup |
| DNS propagation checker | DNS Propagation |
| DNSSEC check | DNS Lookup |
| DocuSign-style self signing | PDF Signer |
| Domain age checker | Domain WHOIS and Expiry |
| Domain expiry checker | Domain WHOIS and Expiry |
| Domain to IP | IP Lookup |
| drawSQL | SQL to ER Diagram |
| Duplicate Line Remover | Duplicate Line Remover |
| Edotor | Graphviz (DOT) Viewer |
| Email extractor | Extract from Text |
| Email header analyzer | Email Header Analyzer |
| Email normalizer | Email Normalizer |
| Emoji picker | Emoji Picker |
| Encoding converter | Text Encoding Converter |
| Encrypt / decrypt text | Text Encryption (CryptoJS) |
| Engineering ToolBox acoustics calculators | Sound and Acoustics Calculators |
| Engineering ToolBox area moment of inertia | Section Properties |
| Engineering ToolBox AWG and SWG tables | Wire Gauge Chart |
| Engineering ToolBox beam calculator | Beam Calculator |
| Engineering ToolBox heat loss and combustion calculators | Heat and Combustion Calculators |
| Engineering ToolBox steam tables | Steam Tables |
| Engineering ToolBox unit converters | Unit Converter |
| ETA calculator | ETA Calculator |
| Excel to CSV | Table Converter |
| Factory Load Calculator | Load and Energy Cost |
| Favicon Generator | Favicon and ICO |
| Flexbox layout Generator | Flexbox |
| Glassmorphism Generator | Glassmorphism |
| Google HAR Analyzer | HAR Viewer |
| Gradient Generator | Gradient Generator |
| Gradient Image | Gradient Generator |
| GraphvizOnline | Graphviz (DOT) Viewer |
| Grid layout Generator | Grid |
| Gzip compress / decompress | Gzip Compress |
| Hash text | Hash and HMAC |
| Hex Decoder | Hex ↔ Text |
| Hex to Decimal Converter | Number Base Converter |
| HexEd.it (viewing) | Hex Viewer |
| HTML Encoder / Decoder | HTML Entities |
| HTML Formatter | HTML Formatter |
| HTML to BBCode | BBCode ↔ HTML |
| HTML to Markdown Converter | HTML to Markdown |
| HTML WYSIWYG editor | HTML Editor (WYSIWYG) |
| Htpasswd Generator | Htpasswd Generator |
| HTTP headers checker | Website Status |
| HTTP status checker | Website Status |
| IBAN validator and parser | IBAN Validator |
| ICO Transparency Creator | Favicon and ICO |
| Image Base64 | Image to Base64 |
| Image Color Picker/Palette | Image Colour Picker |
| Image Compress | Image Converter |
| Image Crop | Image Crop |
| Image Fade Effect Generator | Image Fade |
| Image Filter | Image Filter |
| Image Filter (CSS) | Filter |
| Image Grayscale | Image Filter |
| Image Resize | Image Resize |
| Image Rotate | Image Rotate |
| IP WHOIS | IP Lookup |
| IPv4 address converter | IP Address Converter |
| IPv4 range expander | IP Address Converter |
| IPv6 ULA generator | IP Address Converter |
| JavaScript encode and decode | JavaScript Minifier |
| JavaScript Formatter | JavaScript Formatter |
| JSON diff | Diff Checker |
| JSON Formatter | JSON Formatter |
| JSON to C# | JSON to Code |
| JSON to CSV Converter | JSON to CSV |
| JSON to Go | JSON to Code |
| JSON to Java | JSON to Code |
| JSON to Python | JSON to Code |
| JSON to query string | Data Format Converter |
| JSON to TypeScript Converter | JSON to TypeScript |
| JSON to XML | Data Format Converter |
| JSON viewer | JSON Viewer |
| JWT Decoder | JWT Decoder |
| JWT Encoder | JWT Encoder |
| jwt.io debugger | JWT Decoder |
| jwt.io encoder | JWT Encoder |
| Keccak-256 | Hash and HMAC |
| Keycode info | Keycode Info |
| kVA to Amps Calculator | Power Converter (kW, kVA, Amps, hp) |
| kW to kVA Calculator | Power Converter (kW, kVA, Amps, hp) |
| LESS to CSS | SCSS and Less to CSS |
| List converter | List Converter |
| List randomizer | Random Generator |
| llms.txt Generator | llms.txt Generator |
| Load Factor Calculator | Load and Energy Cost |
| MAC address generator | MAC Address Lookup |
| MAC address lookup | MAC Address Lookup |
| Markdown to HTML Converter | Markdown to HTML |
| Math evaluator | Math Evaluator |
| Matrix Transform | Transform |
| MD5 hash generator | Hash and HMAC |
| Mermaid Live Editor | Mermaid Diagram Editor |
| Mesh Gradient Generator | Mesh Gradient |
| Minify JS | JavaScript Minifier |
| Mock data generator | Mock Data Generator |
| MongoDB ObjectId generator | UUID and ID Generator |
| Morse Code Translator | Morse Code |
| Motor FLA Calculator | Motor Current and Torque |
| MTA-STS checker | Email DNS Check |
| MX lookup | DNS Lookup |
| MX lookup | Email DNS Check |
| Nano ID generator | UUID and ID Generator |
| NC Viewer | 3D Model and G-code Viewer |
| NS lookup | DNS Lookup |
| NTLM hash | Hash and HMAC |
| Number to Words Converter | Number to Words |
| Numeronym generator | Numeronym Generator |
| OKLCH Converter | Colour Converter |
| Omni Calculator Biology | Biology Calculators |
| Omni Calculator Chemistry | Chemistry Calculators |
| Omni Calculator Construction | Construction Calculators |
| Omni Calculator Conversion | Conversion Calculators |
| Omni Calculator Ecology and Weather | Ecology and Weather Calculators |
| Omni Calculator Electronics | Electronics Calculators |
| Omni Calculator Engineering | Engineering Calculators |
| Omni Calculator Everyday Life | Everyday Life Calculators |
| Omni Calculator Finance | Finance Calculators |
| Omni Calculator Food | Food Calculators |
| Omni Calculator Health | Health Calculators |
| Omni Calculator Math | Math Calculators |
| Omni Calculator Other | Other Calculators |
| Omni Calculator Physics | Physics Calculators |
| Omni Calculator Sports | Sports Calculators |
| Omni Calculator Statistics | Statistics Calculators |
| online CSR and certificate generators | Certificate Maker |
| online CSV SQL tools | SQLite Browser |
| Online REST client | HTTP Request |
| online screenshot annotators | Image Annotator |
| online Web Serial terminals | Serial Monitor |
| Open graph meta generator | Meta Tag Generator |
| Open port checker | Port Checker |
| Optical Character Recognition | Text Recognition (OCR) |
| Outlook Safelink decoder | Link Unwrapper |
| Password strength analyser | Password Strength |
| PDF compare | Diff Checker |
| PDF signature checker | PDF Signature Checker |
| PDF to text | Document to Text |
| Percentage calculator | Percentage Calculator |
| Phone parser and formatter | Phone Number Parser |
| PNG Color Replacer | Colour Replacer |
| PNG to ICO Converter | Favicon and ICO |
| PNG to WebP Converter | Image Converter |
| ProjectorCentral projection calculator | Projector Calculator |
| ProjectorCentral screen size calculator | Screen Size Calculator |
| PX to REM Converter | PX ↔ REM |
| QR code generator | QR Code Generator |
| Random number generator | Random Generator |
| Random port generator | Random Generator |
| Random Word Generator | Random Words |
| ray.so | Code Screenshot |
| RDAP lookup | Domain WHOIS and Expiry |
| Redirect checker | Website Status |
| Redirect link decoder | Link Unwrapper |
| Redocly preview | OpenAPI Viewer |
| Regex cheatsheet | Regex Cheat Sheet and Code |
| Regex code generator | Regex Cheat Sheet and Code |
| Remove extra spaces | Text Cleaner |
| Remove Line Breaks | Remove Line Breaks |
| Reverse DNS | DNS Lookup |
| robots.txt Generator | robots.txt Generator |
| Roman numeral converter | Roman Numerals |
| ROT13 Encoder/Decoder | ROT13 and Caesar |
| Saturated steam table | Steam Tables |
| SCSS to CSS | SCSS and Less to CSS |
| Section property calculators | Section Properties |
| SHA-1 Hash Generator | Hash and HMAC |
| SHA-512 Hash Generator | Hash and HMAC |
| Shadcn Theme Generator | shadcn/ui Theme |
| SkyCiv beam calculator | Beam Calculator |
| Smallpdf and iLovePDF form filling | PDF Form Filler |
| Smallpdf eSign | PDF Signer |
| Snagit and Greenshot editors | Image Annotator |
| SnapOtter Audio tools | Audio Toolkit |
| SnapOtter Background Remover | Background Remover |
| SnapOtter CSV tools | CSV Merge and Split |
| SnapOtter Duplicate finder | Duplicate Picture Finder |
| SnapOtter Face Blur | Face Blur |
| SnapOtter GIF maker | GIF Maker |
| SnapOtter Images to PDF | Pictures and PDF |
| SnapOtter Meme generator | Meme and Caption Maker |
| SnapOtter Object Eraser | Object Eraser |
| SnapOtter OCR | Text Recognition (OCR) |
| SnapOtter Passport photo | Passport and ID Photo |
| SnapOtter PDF compress | PDF Passwords and Compression |
| SnapOtter PDF merge | Merge and Organise PDF |
| SnapOtter PDF metadata | PDF Properties |
| SnapOtter PDF organise | Merge and Organise PDF |
| SnapOtter PDF page numbers | PDF Watermark and Page Numbers |
| SnapOtter PDF protect | PDF Passwords and Compression |
| SnapOtter PDF split | Split PDF |
| SnapOtter PDF to images | Pictures and PDF |
| SnapOtter PDF unlock | PDF Passwords and Compression |
| SnapOtter PDF watermark | PDF Watermark and Page Numbers |
| SnapOtter Screenshot beautifier | Screenshot Beautifier |
| SnapOtter Transcription | Transcription and Subtitles |
| SnapOtter Upscaler | Image Upscaler |
| SnapOtter Vectorize | Image to SVG (Trace) |
| SnapOtter Video tools | Video Toolkit |
| SnapOtter Watermark | Image Watermark |
| SnapOtter ZIP tools | ZIP and Archives |
| SPF checker | Email DNS Check |
| Spirax Sarco steam tables | Steam Tables |
| SSL checker | SSL Certificate Checker |
| SSL expiry checker | SSL Certificate Checker |
| String obfuscator | String Obfuscator |
| Strip HTML tags | Text Cleaner |
| Stripe Fee Calculator | Payment Fee Calculator |
| Sunburst Generator | Sunburst Generator |
| SVG Background Remover | SVG Background Remover |
| SVG Minifier | SVG Minifier |
| SVG placeholder generator | Placeholder Image |
| SVG to PNG Converter | SVG to PNG |
| SVG to React Component Converter | SVG to React |
| SVG Viewer | SVG Viewer |
| Swagger Editor (viewing) | OpenAPI Viewer |
| Syntax highlighter | Syntax Highlighter |
| Table converter | Table Converter |
| Tailwind Colors | Tailwind Colours |
| Temperature converter | Unit Converter |
| Text Compare | Diff Checker |
| Text repeater | Text Repeater |
| Text Reverser | Text Reverser |
| Text Shadow | Text Shadow |
| Text to NATO alphabet | NATO Phonetic Alphabet |
| Time sheet calculator | Time Sheet Calculator |
| timeanddate.com meeting planner | Time Zone Planner |
| TLS checker | SSL Certificate Checker |
| TOML to YAML | Data Format Converter |
| Transformer Calculator | Transformer Size |
| Transformer Size Calculator | Transformer Size |
| Transition | Transition |
| TXT lookup | DNS Lookup |
| ULID generator | UUID and ID Generator |
| Unicode text styles | Fancy Text Styles |
| Unit converter | Unit Converter |
| Unix Timestamp Converter | Unix Timestamp |
| UPS Capacity Calculator | UPS Sizing and Runtime |
| UPS Runtime Calculator | UPS Sizing and Runtime |
| URL extractor | Extract from Text |
| UTF-8 Decoder | UTF-8 Bytes |
| UUID & GUID Generator | UUID and ID Generator |
| viewstl.com | 3D Model and G-code Viewer |
| Wave Generator | Wave Generator |
| Website down checker | Website Status |
| What is my IP | IP Lookup |
| WHOIS lookup | Domain WHOIS and Expiry |
| WiFi QR code generator | QR Code Generator |
| Wire gauge converters | Wire Gauge Chart |
| WireGuard config generators | WireGuard Config Generator |
| Word compare | Diff Checker |
| Word to text | Document to Text |
| World Time Buddy | Time Zone Planner |
| XML diff | Diff Checker |
| XML Formatter | XML Formatter |
| XML to JSON | Data Format Converter |
| XPath tester | XPath and CSS Selector Tester |
| XSLT transform | XSLT Transformer |
| YAML prettify | YAML Formatter |
| YAML to JSON Converter | YAML ↔ JSON |
| YAML to TOML | Data Format Converter |

### Not included

- **AI Dashboard Generator**: Depends on a hosted AI model to write its insights; there is no faithful offline equivalent.
- **Projector model database (ProjectorCentral)**: A catalogue of thousands of projectors needs constant updating from a web service; enter the throw ratio from the projector’s data sheet instead.
- **Ping and traceroute (DNS Checker)**: They need raw network sockets or administrator rights; Port Checker tests TCP reachability without either.
- **IP geolocation and reverse IP lookup (DNS Checker)**: Both need large commercial databases that change daily; IP Lookup shows the owner and network from the registries instead.
- **Website speed test and blocklist checks (DNS Checker)**: They depend on measurement servers or blocklist operators that restrict automated queries.
- **Camera and microphone recorders (IT Tools)**: Benchtop asks for no camera or microphone access; your system’s own recorder does this better.
- **Code formatters for C, Go and Python (freecodeformat)**: Each would add a compiler-sized WebAssembly download; use the language’s own formatter (clang-format, gofmt, ruff format).
- **Games and astrology calculators (CalcPanel)**: Outside the scope of a developer and engineering toolbox. Health and sports calculators are in the calculator library.
- **Medicine dose calculators (Omni Calculator: drug dosage, IV drip rate, insulin, paediatric doses)**: A wrong dose can cause serious harm, and safe dosing depends on the product label and a clinician’s judgement, so these are deliberately left out.
- **Omni Calculator: most of its 3,700 calculators**: The library covers about 220 of the most used ones in 18 categories, each solvable for any value; niche ones can be built in the Math Evaluator.
- **Omni Calculator: currency and live-price calculators**: They need exchange rates and prices from the internet; Benchtop’s calculators work offline.
- **Pantone colour lookup**: Pantone colour data is proprietary; Colour Converter covers RGB, HSL, HSV, CMYK and Lab.
- **CyberChef: Automated Validation Test Op**: An internal helper of CyberChef’s own test suite; every other CyberChef operation is in the Recipe tool.

### Differences from the web versions

- **llms.txt Generator** cannot fetch a sitemap; paste the sitemap XML instead.
- **HTML Playground** previews HTML and CSS, but scripts do not run in the preview (Bootstrap styles work; its interactive components need your real page).
- **CSS to Tailwind** converts declarations to utility classes but does not render the result to compare it visually.
- **Bootstrap Theme Builder** compiles Bootstrap 5.3.9 itself with Dart Sass; it ships five original starting themes rather than third-party theme galleries.
