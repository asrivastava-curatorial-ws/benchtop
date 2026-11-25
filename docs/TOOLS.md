# Tools

<!-- Generated from src/tools/registry.ts by tests/unit/docs.test.ts. Do not edit by hand. -->

Benchtop has 429 tools. All of them work without a network connection except the 11 in Online checks and Web Page to PDF, which contact only the hosts you enter, when you ask, and only in the desktop app; PDF Toolbox’s timestamp likewise sends a fingerprint of the PDF (never the file) to the timestamp server you choose. Video Dubbing translates through the AI server address you give it, usually one on this computer. The AI tools download their models and voices once, when you first choose one (or import them from a folder), and then work offline too.

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
| HTML to JSX | Turn HTML into JSX for React or Preact: class and for renamed, inline styles as objects, SVG attributes in camelCase, void tags closed, comments wrapped, form fields given default values, optionally as a component. | HTML to JSX, transform.tools HTML to JSX |
| CSS to Tailwind | Translate CSS rules into Tailwind v4 utility classes. | CSS to Tailwind Converter |
| Number to Words | Spell out numbers, ordinals and money, in international or Indian numbering. | Number to Words Converter |
| Unix Timestamp | Convert epoch timestamps to dates in any time zone, and back. | Unix Timestamp Converter |
| Number Base Converter | Convert numbers between binary, octal, decimal, hex and any base up to 36. | Base Converter, Hex to Decimal Converter |
| Binary Calculator | Arithmetic and bitwise operations on binary, decimal or hex numbers. | Binary Calculator |
| PX ↔ REM | Convert between pixels and rem, with a reference table. | PX to REM Converter |
| TOML ↔ JSON | Convert TOML (Cargo.toml, pyproject.toml) to JSON and back, keeping dates and big integers. |  |
| INI ↔ JSON | Convert INI and .cfg files to JSON and back, with sections and optional typed values. |  |
| .env ↔ JSON | Convert dotenv files to JSON and back, handling quotes, escapes, export and multi-line values. |  |
| Markdown Table | Turn CSV, TSV or cells pasted from a spreadsheet into an aligned Markdown table. |  |
| Data Format Converter | Convert between JSON, YAML, TOML, XML, INI, .env, query strings and CSV in any direction, with format detection. | XML to JSON, JSON to XML, YAML to TOML, TOML to YAML, JSON to query string |
| Roman Numerals | Convert numbers to Roman numerals and back, with strict validation. | Roman numeral converter |
| Table Converter | Turn CSV, TSV, spreadsheet pastes, Excel files, Markdown, HTML tables, JSON or SQL INSERTs into any of those, or ASCII and LaTeX tables. | Table converter, Excel to CSV, CSV to SQL, CSV to HTML |
| Document to Text | Extract the text of PDF, Word, Excel, PowerPoint and OpenDocument files. | PDF to text, Word to text |
| JSON to Code | Generate typed classes, schemas and tables from a JSON sample: C#, Java, Go, Python dataclasses or Pydantic, Rust, Kotlin, Swift, Dart, PHP, Zod, Mongoose, GraphQL, Protocol Buffers, and MySQL, PostgreSQL or SQLite tables with the rows inserted. | JSON to C#, JSON to Java, JSON to Go, JSON to Python, JSON to Zod Schema, JSON to Mongoose, JSON to MySQL, JSON to GraphQL, JSON to Protobuf |
| XSLT Transformer | Apply an XSLT 1.0 stylesheet to XML and see the result. | XSLT transform |
| BBCode ↔ HTML | Convert forum BBCode to HTML and back, with a preview. | BBCode to HTML, HTML to BBCode |

## Query and validate

| Tool | What it does | Replaces |
| --- | --- | --- |
| Regex Tester | Test JavaScript regular expressions with highlighted matches, capture groups and replacement preview. |  |
| JSONPath and jq | Query JSON with JSONPath expressions or real jq 1.8 filters and see the result instantly. |  |
| JSON Schema Validator | Validate JSON against a JSON Schema (drafts 4, 7, 2019-09 and 2020-12) and list every error with its location. |  |
| Data Playground (SQL) | Query CSV, JSON, Parquet, Excel, Avro, Arrow and SQLite files together with SQL (DuckDB), chart the results and export CSV, JSON or Parquet. | DuckDB shell, CSV SQL tools |
| Parquet and Avro Viewer | Open a Parquet or Avro file to see its schema, row groups, compression, metadata and rows; save the rows as CSV or JSON. | Parquet viewers, Avro viewers |
| JSON Diff | Compare two JSON documents by structure: added, removed and changed values with their paths, as a list or an RFC 6902 JSON Patch. | JSON diff checkers |
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
| Hash and HMAC | MD5, SHA-1, SHA-2, SHA-3, Keccak, BLAKE2/3, RIPEMD-160, xxHash, CRC and more for text or files, with HMAC, checksum comparison and the Subresource Integrity value for script and link tags. | SHA-1 Hash Generator, SHA-384 Hash Generator, SHA-512 Hash Generator, MD5 hash generator, Hash text, NTLM hash, BLAKE3 hash, Keccak-256, Subresource Integrity Generator |
| Hash Identifier | Guess what made a hash: MD5, SHA, NTLM and other digests by length, and bcrypt, Argon2, scrypt, crypt(3), Django, WordPress and LDAP password hashes by their prefix. | Hash Identifier, hashID |
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
| Pitman Shorthand | Write English in Pitman’s shorthand (New Era theory): strokes, vowel signs and positions worked out from the pronunciation, with a stroke chart. Save as SVG. |  |
| Braille Translator | English (UEB uncontracted) and Hindi or Marathi (Bharati Braille) to braille characters or Braille ASCII for embossers, with a to-scale dot drawing for signs. | Braille translators (grade 1) |
| IPA and Shavian | Write English in the International Phonetic Alphabet, in Shavian letters or in ARPAbet, from the CMU Pronouncing Dictionary. | toPhonetics, Shavian transliterators |
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
| Clipboard History | The text you copied while Benchtop runs, newest first: search it, copy a piece again or send it to a tool. Kept in memory only, and off until you turn it on. Desktop app. | Ditto, CopyQ, Windows clipboard history |

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
| Mock API Server and Webhook Catcher | Run a local mock API (routes with templated JSON answers, delays and status codes, or made from an OpenAPI file), or catch and inspect the webhooks a service sends. Desktop app. | json-server, Mockoon, webhook.site, RequestBin |
| WebSocket and SSE Client | Connect to WebSocket servers (ws:// and wss://, with headers and subprotocols) or server-sent event streams; send messages and watch every one that arrives. Desktop app. | Postman WebSocket, websocat, piesocket tester |
| gRPC Client | Call gRPC services from .proto files or server reflection: requests as JSON, unary and streaming calls, metadata, TLS. Desktop app. | grpcurl, BloomRPC, Postman gRPC |
| LAN Scanner | Find the devices on your network with their names, makers, open ports and a guess at what each one is; then check the ports of one, open its web page or wake it. Desktop app. | Angry IP Scanner, Advanced IP Scanner, Fing, MAC address lookup |
| Wake-on-LAN | Switch on computers over the network with a magic packet, from a saved list of names and MAC addresses. Desktop app. | WakeOnLAN apps, wakeonlan command |
| LAN Speed Test | Measure the speed and latency of Wi-Fi or cable between this computer and a phone (in its browser, from a QR code) or another computer. Nothing goes over the internet. Desktop app. | iperf3, LAN Speed Test, OpenSpeedTest |
| LAN File Sharing | Share a folder with phones and computers on the same network through their browser, with a QR code, optional uploads and a password. Desktop app. | python -m http.server, Send Anywhere (local), Snapdrop, miniserve |
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
| Website Copier | Copy a website into a folder to browse offline, like HTTrack: pages, pictures, styles and scripts, with links rewritten, within the limits you set. | HTTrack, wget --mirror, SiteSucker |

## DevOps and config

| Tool | What it does | Replaces |
| --- | --- | --- |
| Chmod Calculator | Convert Unix permissions between checkboxes, octal (755) and rwx, with ready chmod commands. |  |
| Config File Generator | Ready-to-edit files filled in from your project details: GitHub Actions, GitLab CI, Jenkins, CircleCI, Azure and Bitbucket pipelines; Dockerfiles and Compose; Kubernetes, Helm and Istio; Prometheus, Grafana, Traefik, systemd and Ansible; AWS, Google Cloud and Azure; Schema.org, sitemaps, service workers and CORS; package.json, tsconfig, linters and bundlers; database connection strings. | GitHub Actions Generator, GitLab CI Pipeline Generator, Jenkins Pipeline Generator, CircleCI Config Generator, Azure Pipeline Generator, Dockerfile Generator, Kubernetes YAML generators, Helm Chart Generator, Kustomize Configuration Generator, Istio config generators, Prometheus Config Generator, Grafana Dashboard Generator, Traefik Config Generator, Ansible Playbook Generator, AWS IAM Policy Generator, S3 Bucket Policy Generator, CloudFormation Template Generator, ECS Task Definition Generator, Lambda Config Generator, Cloud Run Config Generator, Cloud Build Config Generator, Azure Bicep Generator, Terraform AWS Module Generator, Sitemap XML Generator, Hreflang Generator, Schema.org Generator, FAQ Schema Generator, Breadcrumb Schema Generator, Service Worker Generator, CORS Policy Generator, .htaccess Generator, Package.json Generator, ESLint Config Generator, Babel Config Generator, Webpack Config Generator, Vite Config Generator, Rollup Config Generator, Jest Config Generator, PostCSS Config Generator, Changelog Generator, Connection String Builder |
| docker run to Compose | Convert docker run commands into a compose.yaml file, with named volumes and networks. |  |
| Kubernetes, Compose, Terraform and Dockerfile Checker | Review Kubernetes manifests, Docker Compose files, Terraform and Dockerfiles for risky or fragile settings: root and privileged containers, unpinned images, missing limits and probes, secrets in plain text, resources open to the internet, bloated image layers. | kube-score, kube-linter, tfsec, checkov, hadolint, Dockerfile Validator |
| Log Viewer | Open log files of any size (they are read in pieces), filter lines by text or regular expression, show only errors or warnings, and expand JSON lines. | glogg / klogg, lnav, LogExpert |
| Patch Viewer | Read git diff output, .patch and .diff files and format-patch mails file by file, side by side, with the commit message and line counts. | diff2html, GitHub diff view |
| Git Workbench | Browse a repository: commits with their graph and diffs, two branches compared, and merge conflicts resolved side by side. Merges three versions of any text. | gitk, Meld, KDiff3, git mergetool, Sourcetree (browsing) |
| .gitignore Generator | Build a .gitignore from templates for languages, frameworks, editors and operating systems. |  |
| Semver Checker | Sort version numbers and test them against npm-style ranges such as ^1.2 or &gt;=2 &lt;3. |  |

## CSS generators

| Tool | What it does | Replaces |
| --- | --- | --- |
| CSS Specificity Calculator | See which selector wins: IDs, classes and types counted the way browsers do, including :is(), :not(), :has(), :where() and :nth-child(… of …). | CSS Specificity Calculator |
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
| Animation Studio (Theatre.js) | Animate shapes, text, pictures and SVG layers on a keyframe timeline with easing: motion paths, groups, clips with timelines of their own, and a soundtrack in step. Playback runs on Theatre.js. Save video (MP4, WebM, GIF), a web page that plays offline, or Theatre.js state for your own code. | Theatre.js Studio, Rive (simple scenes), After Effects (simple motion), Keyshape |
| anime.js Editor | Write anime.js code and watch the animation beside it: staggers, timelines, keyframes, springs, SVG line drawing, motion paths and split text, run in a sealed frame. Save a web page that runs on its own, or SVG and PNG when the animation draws in SVG. | anime.js documentation playground, CodePen (anime.js sketches) |
| SVG.js Editor | Write SVG.js code and watch the drawing beside it: shapes, gradients, animation and clicks, run in a sealed frame. Save SVG, PNG, or a web page that runs on its own. | SVG.js playground (JSFiddle, CodePen) |
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
| Colour Names | Name any colour from the 148 CSS names and the 949 names of the xkcd colour survey, or find colours by name. | Name That Color, Color name finders |
| Palette Library | Free-to-use palettes with their sources and licences: colour-blind safe sets, ColorBrewer, viridis, editor themes and design systems; copy as CSS, Sass, JSON or GIMP. | Coolors palettes (curated), ColorBrewer |

## Images and SVG

| Tool | What it does | Replaces |
| --- | --- | --- |
| Image Converter | Convert and compress between PNG, JPEG, WebP and AVIF. | AVIF Converter, PNG to WebP Converter, Image Compress |
| Image Resize | Resize by pixels or percentage, keeping the aspect ratio if you want. | Image Resize |
| Paint | Draw and edit pictures as in the classic Windows Paint: pencil, brush, eraser, airbrush, fill, colour picker, text, lines and shapes, select, move, copy, paste and crop; resize, rotate, flip and invert; zoom with a pixel grid; save PNG, JPEG, WebP or BMP. | Microsoft Paint, JS Paint, Paintbrush |
| Image Annotator | Mark up screenshots and photos: arrows, boxes, text, numbered steps, highlights, and blur or pixelation for private details. Paste with Ctrl+V. | Snagit and Greenshot editors, online screenshot annotators |
| Image Crop | Crop freely or to a fixed aspect ratio. | Image Crop |
| Image Rotate | Rotate by any angle and flip horizontally or vertically. | Image Rotate |
| Image Filter | Adjust brightness, contrast, saturation, blur and more, or go greyscale. | Image Filter, Image Grayscale |
| Colour Replacer | Replace or swap colours in an image, with tolerance and soft edges. | Color Swapper, PNG Color Replacer |
| Image Fade | Fade an image to transparent evenly, along a line or from a point. | Image Fade Effect Generator |
| Image Colour Picker | Pick colours from an image, or from anywhere on the screen where the browser offers an eyedropper (Chrome, Edge), and extract an image’s palette. | Image Color Picker/Palette |
| Favicon and ICO | Make multi-size .ico files, PNG icons and the HTML tags for them. | Favicon Generator, PNG to ICO Converter, ICO Transparency Creator |
| Vector Editor | Draw and edit SVG: shapes and pen paths, node and handle editing, union, difference and intersection of shapes, alignment, snapping and layers; saves SVG and DXF. | Inkscape (basics), Boxy SVG, Method Draw, SVG-Edit |
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
| Image Stitcher | Join pictures side by side, one above another or in a grid, matched in height or width, with gaps, a border and any background. | Image combiner sites, PhotoJoiner |
| Image Splitter | Cut a picture into equal tiles: a seamless panorama carousel, a 3 × 3 profile grid or any rows and columns, saved together as a ZIP. | Pine Tools image splitter, Instagram grid makers |
| Social Media Sizer | Fit a picture to the exact size for Instagram, WhatsApp, Facebook, X, LinkedIn or YouTube, by cropping around what matters or on a blurred or coloured matte. | Social image resizers, No-crop apps |
| Perspective Fix | Straighten a page, poster, label or whiteboard photographed at an angle by dragging its four corners, with an option to brighten the paper. | Document scanner apps (manual corners) |
| Dither and Halftone | Turn photos into dithered pixel art (Floyd–Steinberg, Atkinson, Bayer) in retro palettes, or into newspaper and comic halftone dots in one ink or CMYK. | ditherit, Halftone generators |
| Paste Image | Paste a screenshot or copied picture and save it as PNG, JPEG, WebP or AVIF, or copy it as a data URL. | Paste-to-file sites |

## Mobile app design

| Tool | What it does | Replaces |
| --- | --- | --- |
| App Icon Maker | Every launcher icon from one picture or a few letters: Android adaptive, round, themed and notification icons, iOS light, dark and tinted, KaiOS and the web, in one ZIP. | Android Asset Studio launcher icons, appicon.co, IconKitchen |
| Store Graphics Maker | Captioned screenshots and banners in the sizes the App Store, Google Play and KaiStore ask for, with an optional phone frame. | AppLaunchpad, Previewed, App Mockup |
| Material Theme Builder | Material 3 light and dark colour schemes from one colour or a picture, with contrast levels and custom colours, for Android XML, Jetpack Compose, Flutter and CSS. | Material Theme Builder |
| SVG, VectorDrawable and Compose | Turn SVG into an Android vector drawable or Jetpack Compose ImageVector code, or a vector drawable back into SVG, with gradients, groups and clip paths. | svg2vector, Android Studio Vector Asset import, SVG to Compose |
| Nine-patch Maker | Mark what stretches in a button or bubble picture and save an Android .9.png for each density, edit an existing one, or get CSS border-image settings. | draw9patch, Android Asset Studio nine-patch generator |
| Screen Size and Density | Pixel density, physical size, dp, points and CSS pixels, smallest width and Material window classes for iPhones, iPads, Pixels, KaiOS phones or any screen. | Screen size calculators, ios-resolution.com, screensiz.es |
| Android Pixel Calculator | Convert between dp, px, sp, in, mm and pt for any screen density. | Android Pixel Calculator |
| KaiOS Manifest Maker | Write manifest.webapp for KaiOS 2.5 and manifest.webmanifest for KaiOS 3, with languages and permissions, checked against the KaiStore limits. | KaiOS Manifest Convertor |
| Android Button Maker | Design a button and get the shape-drawable XML. | Android Button Maker |

## Print and typography

| Tool | What it does | Replaces |
| --- | --- | --- |
| Booklet and Zine Imposer | Lay out a PDF for printing as a folded booklet (with sections and creep), an eight-page mini zine from one sheet, several pages per sheet, or repeated cards. | Booklet printing dialogs, Bookbinder, Create Booklet |
| PDF Print Preflight | Check a PDF before it goes to the press: page sizes, bleed, unembedded fonts, picture resolution, RGB and spot colours, transparency and PDF/X. | Acrobat Preflight (basic checks), online print-ready PDF checkers |
| Print Production Studio | Get a job ready for the press: see a picture as it will print with an ICC profile (soft proof), convert it to CMYK, add crop marks, bleed and registration marks to a PDF, nest pieces on sheets or a roll, and find the paper and layout that print a job for least. | Photoshop soft proofing and Convert to Profile, Acrobat Add Printer Marks, gang-run and nesting calculators, paper cutting calculators |
| Paper Sizes | A, B and C sizes, SRA press sheets, Letter and Legal, photo prints, cards, and Indian sizes such as Foolscap, Crown and Demy, in mm, inches, points or pixels, with sheet weight and copies per sheet. | papersizes.org |
| Font File Explorer | Open a TTF, OTF, WOFF or WOFF2 file to see its licence and embedding rights, metrics, variable axes, OpenType features, languages and every character, and get its @font-face rule. | Wakamai Fondue, FontDrop |
| Glyph Browser | Browse Unicode blocks, from Latin and Devanagari to Brahmi and hieroglyphs, in any font; copy characters and their HTML, CSS, JavaScript and Python codes. | Character Map, unicode-table.com |
| Type Scale | A harmonious set of font sizes from a body size and a ratio, fixed or growing with the screen (clamp), as CSS variables, Tailwind or Sass. | typescale.com, Utopia fluid type calculator |
| Large Type | Show a few words as large as the screen allows, for a Wi-Fi password, a desk sign or a message across the room; full screen in one click. | macOS Large Type, bigtext tools |

## AI image and speech

| Tool | What it does | Replaces |
| --- | --- | --- |
| Background Remover | Cut out the subject of a photo, or put it on a colour or a blurred background. AI model on this computer. | SnapOtter Background Remover |
| Image Upscaler | Enlarge pictures 2×, 3× or 4× with Real-ESRGAN, recovering detail instead of blurring. | SnapOtter Upscaler |
| Face Blur | Find faces and blur, pixelate or cover them; remove boxes or draw your own before saving. | SnapOtter Face Blur |
| Object Eraser | Paint over people, wires or text in a photo and fill the gap from the surroundings. | SnapOtter Object Eraser |
| Text Recognition (OCR) | Read English and Hindi text from pictures and scanned PDFs, and make scans searchable. Works offline, also in a browser. | SnapOtter OCR, Optical Character Recognition |
| Transcription and Subtitles | Turn speech in English, Hindi and 97 other languages into text, SRT or WebVTT subtitles with Whisper, on this computer; can translate into English. | SnapOtter Transcription |
| Text to Speech | Read text aloud with Piper voices in English, Hindi, Malayalam and Nepali, on this computer, and save it as WAV. | Piper, online text-to-speech sites |
| Video Dubbing | Turn a video into another language: transcribe its speech, translate the lines with IndicTrans2 (set up on this computer in one click), another local AI server or by hand, voice them with Piper at the right times, and save subtitles, the voice-over or the video with its new soundtrack. | Media Localiser, online video translators |
| AI Models | Download, import or remove the AI engine and models the AI tools use, and see their licences and sizes. |  |

## PDF

| Tool | What it does | Replaces |
| --- | --- | --- |
| Merge and Organise PDF | Merge PDFs, and reorder, rotate or delete pages by dragging page pictures. Runs in the app; nothing is uploaded. | SnapOtter PDF merge, SnapOtter PDF organise |
| PDF Reader | Read PDFs with thumbnails, contents and search; highlight, underline and strike out text; add notes, text boxes, pen strokes, shapes and arrows, and save them as real PDF annotations or flatten them. | Stirling PDF viewer and annotations, Acrobat Reader comments, Okular and Xournal++ annotation |
| PDF Compare | Compare two versions of a PDF: the words removed and added, marked on the pages and listed, and a picture of what changed on every page; save either version with the changes highlighted. | Stirling PDF compare, diff-pdf, Acrobat compare files |
| PDF Toolbox | Edit bookmarks, attached files and form fields; lay another PDF over or under the pages; place pictures and QR codes; change colours; insert or remove blank pages; put every page on one long page; change the paper size; turn sideways pages upright; remove comments, links and signatures; sanitise scripts and metadata; flatten; unlock fields; repair; see everything in a file, its JavaScript and an accessibility check; take out pictures and scanned photos; name a file from its title; and timestamp it with an RFC 3161 server. | Stirling PDF (bookmarks, attachments, overlay, colours, blank pages, sanitise, flatten, unlock forms, repair, get info, show JavaScript, extract images, single large page, page size, auto rotate, auto rename, split scanned photos, stamps, form fields, accessibility, timestamp) |
| Split PDF | Split a PDF into page ranges or single pages, keep chosen pages, or remove some. | SnapOtter PDF split |
| PDF Watermark and Page Numbers | Add a watermark, page numbers ("Page 3 of 12") or a header or footer line, with a live preview. | SnapOtter PDF watermark, SnapOtter PDF page numbers |
| PDF Properties | See page sizes, version and form fields, and edit or remove the title, author, keywords and dates. | SnapOtter PDF metadata |
| Pictures and PDF | Turn pictures into a PDF (A4, Letter or each picture’s size), or save PDF pages as PNG, JPEG or WebP. | SnapOtter Images to PDF, SnapOtter PDF to images |
| PDF Studio | Redact words, patterns and areas and check that nothing is left; correct what OCR read; make PDF/A for archives; do it for many PDFs at once. | Acrobat Pro redaction, PDF Redact Tools, OCRmyPDF, gImageReader |
| PDF Passwords and Compression | Add or remove PDF passwords (AES-256), optimise losslessly, shrink pictures, repair damaged PDFs, turn them grey with text kept as text, or take every picture out. Uses qpdf and Ghostscript. | SnapOtter PDF protect, SnapOtter PDF unlock, SnapOtter PDF compress, Stirling PDF (repair, remove images, greyscale) |
| PDF Form Filler | Fill in PDF forms, or write text, ticks and dates anywhere on scanned and printed-style forms, in English or Hindi; can lock the answers. | Adobe Fill & Sign (filling), Smallpdf and iLovePDF form filling |
| PDF Signer | Sign PDFs with a drawn, typed or scanned signature, and digitally with a .p12 or .pfx certificate (or a self-signed one made here). | Adobe Fill & Sign (signing), DocuSign-style self signing, Smallpdf eSign |
| PDF Crop | Crop the margins of PDF pages, all or some, by millimetres or by finding the white space, optionally changing the paper size too. | Smallpdf and iLovePDF crop |

## Documents and notes

| Tool | What it does | Replaces |
| --- | --- | --- |
| Flipbook Editor | Make page-turn flipbooks from PDFs, pictures and blank pages, with hotspots for links, pages, video, sound and notes, contents, hard covers and a kiosk mode; export one HTML file that works offline. | FlipHTML5, Heyzine, Issuu flipbooks, StPageFlip |
| Flipbook Reader | Read PDFs and flipbooks as books whose pages turn like paper, with contents, page pictures, search, zoom, full screen and the keyboard. | FlipHTML5 reader, Heyzine viewer |
| Sheet Music Writer | Write music in ABC notation or with a piano keyboard, see it engraved as you type, play it, transpose it, and save it as ABC, SVG, MIDI, WAV or PDF. | abcjs editor, Noteflight (basic), MuseScore (simple scores) |
| Notes | Notes with text, checklists, Markdown and maths, code, links, sketches and mind maps, and any files: paste or drop pictures, videos, audio, PDFs and 3D models. Sketches have boxes, bubbles, clouds, sticky notes, arrows that stick to shapes and a pen, hand-drawn or clean. Copies are kept in the note, so it stays whole when the originals go. Share as .bnote files. | Evernote, OneNote, Notion (pages), Google Keep, Excalidraw (sketches in notes), XMind (simple mind maps) |
| Markdown Editor | Write Markdown with a live preview, maths ($…$), tables, task lists and embedded pictures; save as a web page, PDF, Word document or EPUB e-book. | Typora, StackEdit, Dillinger, Pandoc (Markdown export) |
| Equation Editor (LaTeX) | Type LaTeX or pick symbols to build equations, chemistry included; save them as SVG or PNG, or copy MathML for Word and web pages. | CodeCogs Equation Editor, Mathcha, LaTeX to image converters |
| Slide Deck (reveal.js) | Write a presentation in Markdown, or design slides by hand (drag text, pictures and shapes into place), beside a live reveal.js preview with speaker notes, code and maths; present full screen, or save one HTML file that presents offline, a PDF or Markdown. | reveal.js, Slides.com, reveal-md, Marp, Google Slides (simple decks) |
| Live Quiz | Run a quiz or a poll with a room full of people: they join on their phones over your own Wi-Fi and answer while the big screen shows the results. Scored questions, polls, word clouds, ratings, Q&A, brainstorms, a spinner wheel, teams and a leaderboard; nothing goes through the internet. | AhaSlides, Kahoot!, Mentimeter, Slido, Quizizz (live games) |
| Resume Builder | Fill in your experience, education and skills, pick a template and save a PDF. Opens and saves Reactive Resume files, and JSON Resume too. | Reactive Resume, Canva resumes, Novorésumé, JSON Resume themes |
| Certificates, Badges and Labels | Mail merge from a spreadsheet: certificates, ID cards, name badges and address labels with photos, logos, QR codes and barcodes, saved as one print-ready PDF. | Certifier, Canva bulk create, Avery Design & Print, Word mail merge |
| Web Page to PDF | Paste web addresses and save the pages as PDFs, made by the browser installed on this computer (Chrome, Edge, Chromium or Brave). Desktop app; uses the network. | PDFCrowd, web2pdfconvert, Print Friendly & PDF |

## Files and folders

| Tool | What it does | Replaces |
| --- | --- | --- |
| Bulk Rename | Rename many files at once with a name pattern, numbers, dates, find and replace (regular expressions too), letter case and extensions; preview first, undo after. | Bulk Rename Utility, Advanced Renamer, PowerRename |
| Duplicate File Finder | Find files with identical contents (any type: photos, videos, documents) across folders, see the space they waste, and move extra copies to the trash. | dupeGuru, fdupes, Czkawka |
| Disk Usage | See what fills a folder or drive: a map of folder sizes to click through, the largest files and the space used by each file type. | WinDirStat, Baobab (Disk Usage Analyzer), ncdu |
| Folder Compare | Compare two folders file by file (by contents, with checksums), list what differs or is missing, and copy files across. | Meld (folders), WinMerge (folders), FreeFileSync (compare) |
| Workflow Builder | Wire tools into a graph and run many files through it: If branches, loops, split and join, previews of every step, and workflows saved to reuse or to run inside other workflows. | n8n (file workflows), Node-RED (file flows), Apple Shortcuts and Automator (text files), Batch file processing |
| Offline Search | Find words inside your files: Word, Excel and PowerPoint documents, PDFs, code, text in pictures and scans, and your notes. The index stays on this computer. | Recoll, DocFetcher, Windows Search, Spotlight, Everything |
| Projects | Keep a job together: its input files, what each tool made of them, every tool’s settings and its workflow, saved as one bundle file you can move or hand on. | Project folders, Session save and restore |

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
| 3D Model Toolbox | Measure a 3D model, repair it for printing (holes, flipped faces, doubled triangles), simplify it, check it against your printer, and convert between STL, 3MF, OBJ, PLY and GLB. | MeshLab (basics), Netfabb Basic, Meshmixer (repair), online STL repair and conversion sites |
| Code Screenshot | Turn code into a clean picture with syntax colours, a window frame and a background, for slides and posts. | Carbon, ray.so |
| D3.js Editor | Write D3.js code and see the chart beside it, with your own CSV, TSV and JSON files read by d3.csv and the rest instead of the network: bar, line and donut charts, force-directed networks, trees and transitions, run in a sealed frame. Save SVG, PNG, or a web page with the data inside it. | Observable notebooks (D3 sketches), bl.ocks.org, CodePen (D3 sketches) |

## Files, video and audio

| Tool | What it does | Replaces |
| --- | --- | --- |
| File Converter | Convert video, audio, pictures (HEIC too), drawings, Office, Visio, Publisher and Apple iWork documents, PDFs to Word, PostScript and XPS, e-mails, Markdown, e-books and archives in batches, with the programs installed on this computer. | ConvertX, FreeConvert (documents, e-mails, PostScript, XPS, HEIC, tracing, archives) |
| Video Toolkit | Compress, trim, resize, crop, rotate, speed up, join, mute, make GIFs, save frames, add logos and subtitles. Uses FFmpeg. | SnapOtter Video tools |
| Green Screen Editor | Remove a green or blue backdrop from a picture or video and put your own picture, video or colour behind the subject: tolerance, soft edge and tint removal with a live matte. Saves PNG, and MP4 or WebM through FFmpeg. | Chroma key in OBS, Shotcut and DaVinci Resolve (simple shots), unscreen-style background replacement for studio shots |
| Audio Toolkit | Convert, trim, join, even out loudness, fade, remove silence and noise, change speed, and draw waveforms. Uses FFmpeg. | SnapOtter Audio tools |
| Ringtone Composer | Compose monophonic ringtones on a keypad like the composer of the phones of the late 1990s, or type RTTTL or composer notation; hear them as square-wave beeps, transpose them, and save WAV, MIDI or RTTTL. | Nokia Composer (phones), RTTTL editors and players |
| ZIP and Archives | Open ZIP (also with a password), TAR, .gz and .bz2 files, preview and save what is inside, or make a ZIP. | SnapOtter ZIP tools |
| CSV Merge and Split | Merge CSV files by column name, with an optional source column and duplicate removal, or split one by rows or by a column. | SnapOtter CSV tools |
| Media Info | Everything about a video or audio file: container, length, bit rates, every stream’s codec, resolution, frame rate, colour and HDR, audio channels, subtitles, chapters and tags. Uses FFprobe. | MediaInfo |
| Screen and Voice Recorder | Record the screen, a window or a browser tab with your voice, or just the microphone, and save the recording; nothing is uploaded. | Online screen recorders, Voice recorder sites |
| Subtitle Studio | Fix and convert subtitles: SRT, WebVTT, SBV and ASS; shift or re-time for another frame rate, wrap lines, end overlaps, and flag subtitles too fast to read. | Subtitle Edit (basic fixes), Online subtitle converters |

## Recipe (CyberChef)

| Tool | What it does | Replaces |
| --- | --- | --- |
| Recipe | Chain CyberChef’s 505 operations to decode, decrypt, decompress, hash, chart and analyse data, with Magic to work out the steps. Loads CyberChef recipes. | CyberChef |

## Math, units and time

| Tool | What it does | Replaces |
| --- | --- | --- |
| Math Evaluator | Calculate with variables, units, matrices and functions, line by line (math.js). | Math evaluator |
| Calcpad Worksheet | Write engineering calculations as plain text and read them as a typeset report: every formula with its values put in and its result, with units, input boxes, conditions, loops, solvers, plots and maps. Save the report as HTML or PDF. | Calcpad, Mathcad worksheets (basic), SMath Studio (basic) |
| Calculus Solver | Derivatives, integrals (indefinite, definite and improper), limits, Taylor series, extrema, tangent lines, differential equations and Riemann sums, each with worked steps, a graph and a check of the answer. | Symbolab calculus, Wolfram Alpha calculus (basic), Derivative calculator, Integral calculator, Limit calculator |
| Scientific Calculator | A full scientific keypad with degrees or radians, memory, powers, roots, logarithms, factorials and a history you can reuse; type or click. | Calculator apps, Online scientific calculators |
| Graphing Calculator | Plot up to six functions of x, pan and zoom, trace values under the pointer and see where each crosses zero; save the graph as PNG. | Desmos (basic plotting), GeoGebra graphing (basic) |
| Matrix Calculator | Define matrices and evaluate expressions: inverse, determinant, products, solving Ax = b, eigenvalues, reduced row echelon form, rank, null space and singular values. | Matrix calculators |
| Statistics | Descriptive statistics, correlation, linear regression, t-tests and one-way ANOVA on CSV columns, with p-values and charts. | Statistics calculators |
| Algebra Solver | Solve polynomial equations of any degree (complex roots included), simplify, expand, differentiate and evaluate expressions, with LaTeX. | Symbolab (basic), Mathway (basic) |
| Percentage Calculator | Percent of, percentage change, increase, decrease and GST in one place. | Percentage calculator |
| ETA Calculator | When will a job finish? Time left and finish time from progress so far. | ETA calculator |
| Benchmark Statistics | Mean, median, spread and relative speed for benchmark runs, as a Markdown table. | Benchmark builder |
| Stopwatch and Timer | Stopwatch with laps, countdown timer and Pomodoro cycles, with a sound when time is up. | Chronometer |
| Unit Converter | Over 1,250 units in 119 quantities, from length and pressure to viscosity, radiation dose, lab results, Indian land units, yarn counts, paper weights and gold purity. Type “5 bigha (UP) in acres” or pick units; see the value in every unit at once. | Unit converter, Temperature converter, Engineering ToolBox unit converters, convertunits.com |
| Date Calculator | Days, weeks, months and working days between dates, or a date plus or minus days, workdays, months or years. | Date calculator, Days between dates |
| Time Sheet Calculator | Total hours worked from start and end times with breaks, overtime and pay. | Time sheet calculator |
| Coordinates Converter | Convert latitude and longitude between decimal, DMS, UTM, geohash and Plus Codes, and measure distance and bearing. | Coordinates converter |
| Time Zone Planner | See one time in many places and find meeting hours that fall in everyone’s working day, with daylight saving handled. | timeanddate.com meeting planner, World Time Buddy |

## Science and maps

| Tool | What it does | Replaces |
| --- | --- | --- |
| Periodic Table | All 118 elements with their properties, electron shells and stable isotopes; colour the table by category, by state of matter at any temperature, or by a property such as electronegativity or density. | Ptable, RSC Periodic Table, PubChem Periodic Table |
| Molar Mass Calculator | Molar mass and percentage composition of a chemical formula, with brackets and hydrates (Ca(OH)2, K4[Fe(CN)6], CuSO4·5H2O); grams to moles. | Omni Molar Mass Calculator, WebQC molar mass |
| Chemistry Solver | Balance equations (redox in acidic or basic solution, half-reactions), stoichiometry with the limiting reagent, empirical formulas, oxidation states, pH, equilibrium ICE tables, kinetics, titration curves, galvanic cells, gas laws and solutions, each with worked steps. | WebQC equation balancer, ChemicalAid, Chemistry problem solvers (basic) |
| Kundli and Panchang | A Vedic birth chart in North or South Indian style with sidereal (Lahiri) positions, nakshatras and padas, divisional charts, Vimshottari dashas and Ashtakoota matching, and the panchang of any day and place; in English or Hindi. | Kundli software (AstroSage, Jagannatha Hora basics), Drik Panchang (daily panchang) |
| Sunrise, Sun and Moon | Sunrise, sunset, solar noon, day length, twilight, golden hour, moonrise, moon phase, equinoxes and solstices for any place and date, with sun path diagrams and a whole year as CSV. | timeanddate.com sun calculator, SunCalc, Omni Sunrise Calculator |
| Star Chart | The night sky over any place at any time: 5,000 stars, constellations, the planets, the Moon and Messier objects, with a clock to run the sky forward and a red night view. | Stellarium (basic sky view), online planispheres, Sky charts |
| Molecule Viewer | Type a SMILES string or open a PDB, XYZ, Molfile, SDF or MOL2 file to see the molecule drawn in 2D and turning in 3D, with its formula, mass and drug-likeness numbers; click atoms to measure bonds and angles. | Jmol, MolView, PubChem 3D viewer |
| Map Viewer (GeoJSON, KML, GPX) | See GeoJSON, TopoJSON, KML, KMZ, GPX, TCX and CSV point files on an offline map, with lengths, areas, track distance, climb, time and height profiles; save as GeoJSON, KML, GPX or CSV. | geojson.io, GPX viewers, KML to GPX converters, mapshaper (viewing) |
| Data Logger | Record what a sensor or instrument sends over a serial or USB port, every reading with its time; watch it live, calibrate channels, add notes, and save as CSV, SQLite or Parquet. | CoolTerm capture, PLX-DAQ, SerialPlot logging, Tera Term log |

## Simulation labs

| Tool | What it does | Replaces |
| --- | --- | --- |
| Mechanics Lab | Animated mechanics experiments: projectiles with air drag on Earth, the Moon, Mars or Jupiter; the pendulum at any swing (exact period); a driven spring–mass–damper with its resonance curve; collisions on an air track from elastic to sticking; planetary orbits with Kepler’s equal areas; a block on a slope with friction and its forces; levers and pulleys; and adding forces nose to tail. Each with read-outs and plots. | PhET (projectile motion, pendulum lab, masses and springs, collision lab, gravity and orbits, forces and motion), mechsimulator.com (physics) |
| Waves, Heat and Fields Lab | Hear and see beats between two tones, standing waves on a string or in open and closed pipes, and the Doppler effect up to a sonic boom; watch a gas of particles push on its walls, with temperature, the speed distribution against Maxwell–Boltzmann and Boyle’s law; place charges to draw field lines and equipotentials; turn a generator with slip rings or a commutator; and float or sink blocks, or follow Bernoulli through a Venturi. | PhET (wave interference, sound waves, gas properties, charges and fields, Faraday’s law, buoyancy, fluid pressure and flow) |
| Optics Bench | Ray diagrams for converging and diverging lenses, concave and convex mirrors and a pair of lenses, with the image’s place, size and nature; refraction and reflection at a boundary with Fresnel’s equations, the critical angle and Brewster’s angle; a prism splitting white light with its least deviation; single and double slits and diffraction gratings; and polarisers following Malus’s law. | PhET (geometric optics, bending light, wave interference), Optics bench simulators |
| Geometry Lab | Drag points to explore a triangle’s centroid, circumcentre, incentre and orthocentre with Euler’s line and the nine-point circle; regular and freehand polygons with their angle sums and areas; the circle theorems; translations, rotations, reflections, enlargements and shears with their matrices; conic sections from a focus and directrix; and the unit circle with exact values of sin, cos and tan. | GeoGebra (geometry basics), PhET (trig tour) |
| Genetics Lab | Punnett squares for one, two or three genes, with incomplete dominance, codominance, ABO blood groups and X-linked inheritance, and their genotype and phenotype ratios; populations evolving by selection, mutation and genetic drift, with a Hardy–Weinberg test; DNA transcribed and translated into protein, with substitutions, insertions and deletions named as silent, missense, nonsense or frameshift; and chi-square tests of breeding results. | Punnett square calculators, PhET (natural selection, gene expression) |
| Biology Lab | Population growth (exponential, logistic and harvested, with the maximum sustainable yield); predator and prey cycles (Lotka–Volterra) with their phase loops; epidemics as SIR or SEIR models with vaccination and herd immunity; enzyme kinetics with competitive, non-competitive and uncompetitive inhibitors and Lineweaver–Burk fits to your data; a Hodgkin–Huxley neuron firing action potentials; and diffusion and osmosis across a membrane. | Ecology and epidemiology simulators, Enzyme kinetics calculators, PhET (neuron, diffusion) |
| Mechanism Simulator | Draw a planar linkage from ground pivots, pin joints, bars, cranks and sliders, or start from a classic (four-bar, slider-crank, quick return, Scotch yoke, Hoekens, Peaucellier–Lipkin, Watt, Jansen’s Strandbeest leg), and run it. Trace coupler curves; plot the position, velocity and acceleration of any joint; see the degrees of freedom, Grashof type and transmission angle of a four-bar, the stroke and quick-return time ratio, and where a linkage locks. Save designs, the motion as CSV and the drawing as SVG. | mechsim.app (linkages), mechsimulator.com (mechanisms), Linkage (David Rector) |

## Electronics and circuits

| Tool | What it does | Replaces |
| --- | --- | --- |
| Circuit Simulator | Draw circuits and run them: resistors to op-amps, the 555, transformers, controlled sources, logic, sensors, displays, relays and motors, with meters and an oscilloscope; DC operating point, DC sweep, transient and AC analysis with Bode plots, parameter steps and spectra; Arduino Uno, Nano and Mega, ATtiny85, Raspberry Pi Pico and ESP32 boards run real firmware (the ESP32 in the desktop app); SPICE export. | Falstad Circuit Simulator, Logisim (basic logic), Tinkercad Circuits, Wokwi (Uno, Mega, ATtiny85, Pico and ESP32), SimulIDE, PICSimLab (ESP32), CircuitLab (DC, transient and AC analysis) |
| PLC Ladder Logic Simulator | Write ladder rungs as conditions and actions and watch them run as a ladder diagram whose wires light up: switches and push buttons for inputs, lamps for outputs, set and reset coils, on-delay, off-delay and pulse timers, counters and edge contacts, with examples (seal-in starter, interlocks, traffic lights, counting, blinker, tank filling) and structured text out. | PLC simulators (basic ladder logic), mechsimulator.com (PLC ladder) |
| Karnaugh Map Solver | Minimise a logic function of 2 to 6 variables: click the map, or type minterms with don’t cares or an expression. Gives the smallest sum of products and product of sums with the groups drawn on the map, the prime implicants, a truth table, and C or Verilog. | Karnaugh map solvers, Logic Friday (minimisation) |
| Logic Analyser | See digital signals as waveforms and read what they say: I²C, SPI and serial decoders, cursors, frequency and duty. Open VCD files, sigrok sessions and tables, or capture from a SUMP logic analyser on a serial port; a sketch makes an Arduino Uno into one. | PulseView (viewing and decoding I²C, SPI, UART), Saleae Logic (viewing exports), GTKWave (digital signals), OLS client (SUMP) |
| Instrument Panel | Build a panel of dials, bars, read-outs, lamps and trends for the values a board prints on its serial port, with buttons, switches and sliders that send it commands. Panels are saved as files; a pretend device lets you try one without a board. | Serial Studio (dashboards), Blynk-style panels over serial, LabVIEW front panels (simple cases), Processing sketches for sensor read-outs |
| Filter Designer | Design Butterworth, Chebyshev and Bessel low-pass, high-pass, band-pass and band-stop filters as op-amp stages with part values and schematics, LC ladders, or digital IIR and FIR filters with C and Python code; gain, phase and step plots. | Analog Devices Filter Wizard, TI Filter Design Tool, Okawa filter calculators, scipy.signal.butter |
| Serial Plotter | Plot the numbers an Arduino, ESP32 or other board prints on a serial port, live, in the Arduino Serial Plotter format with named values; pause, zoom the window and save as CSV. | Arduino Serial Plotter, SerialPlot, BetterSerialPlotter |
| Smith Chart | Plot a load on a Smith chart with its reflection, VSWR, return loss and mismatch loss; see it move along a line; and get every two-element L matching network with part values. | Smith V4, online Smith chart tools, L-network calculators |

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
| Timecode Calculator | Add and subtract SMPTE timecodes and convert between timecode, frames and real time at 23.976 to 60 fps, drop-frame included. | Timecode calculators |

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
| Pneumatic and Hydraulic Circuits | Build pneumatic and hydraulic circuits with ISO 1219 symbols — supplies, exhausts and tanks, 3/2, 5/2, 4/2 and 4/3 valves with push-button, lever, solenoid, pilot and roller operation, single- and double-acting cylinders, flow controls, check, shuttle and two-pressure valves, gauges — and run them: lines fill, valves switch and cylinders move. Examples include memory valves, two-hand safety and automatic reciprocation. | FluidSIM (basic circuits), mechsimulator.com (pneumatic and hydraulic circuits) |
| Cams, Geneva Drive and Gear Trains | Design a cam from a motion program (uniform velocity, simple harmonic, parabolic, cycloidal, polynomial) for a knife-edge, roller or flat-faced follower: lift, velocity, acceleration and jerk, pressure angle, undercut check, and the profile as DXF, SVG or CSV. Animate a Geneva drive with its speed and acceleration, and work out compound and planetary gear trains with a moving picture. | Cam design software (basic), mechsimulator.com (cams, Geneva, gear trains) |
| Engine and Power Cycles | Otto, Diesel, dual, Brayton (with real compressor and turbine and a regenerator), Carnot, Stirling and Rankine steam cycles: every state, the heat and work of each process, efficiency against Carnot, mean effective pressure and power, on P–v and T–s diagrams that animate. | Thermodynamic cycle simulators, mechsimulator.com (engine cycles) |
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
| Plugins | Add your own text tools as single JavaScript files (WebAssembly inside works too). They run sandboxed, without network or storage access, and can be steps in the File Pipeline. | Custom scripts |
| Code Runner | Write a program, give it input and run it, like an online compiler but offline. Python, JavaScript, TypeScript, Lua and SQL (SQLite, DuckDB) run in the app; the desktop app also runs C, C++, Java, C#, Go, Rust, Kotlin, PHP, Ruby, Bash, R, Perl, Swift and Dart with your installed compilers. | OneCompiler, Programiz online compilers, JDoodle (offline) |
| HTML Playground | Try HTML and CSS, with Bootstrap 5 available offline and a resizable preview. | Bootstrap Code Editor |
| Scratchpad | Quick notes kept on this computer: several notes, search, word count, date stamps, copy and save as Markdown. | Online notepads |
| Tailwind Cheat Sheet | Search Tailwind CSS v4 utilities by class or by CSS: layout, flex and grid, spacing, sizing, type, borders, effects, motion and variants. | Tailwind cheat sheet sites |
| Command Cheat Sheet | Equivalent terminal commands for Linux, Windows cmd and PowerShell. | Basic Commands - Ubuntu/Windows |
| Payment Fee Calculator | Work out card processing fees, or what to charge to receive a set amount. | Stripe Fee Calculator |
| CAC Calculator | Customer acquisition cost, payback period and LTV:CAC. | Customer Acquisition Cost (CAC) Calculator |

## Coverage of the original web tools

722 web tools map onto Benchtop tools:

| Web tool | Benchtop tool |
| --- | --- |
| .htaccess Generator | Config File Generator |
| 3-Phase Power Calculator | Power Converter (kW, kVA, Amps, hp) |
| abcjs editor | Sheet Music Writer |
| Acrobat Add Printer Marks | Print Production Studio |
| Acrobat compare files | PDF Compare |
| Acrobat Preflight (basic checks) | PDF Print Preflight |
| Acrobat Pro redaction | PDF Studio |
| Acrobat Reader comments | PDF Reader |
| Add line numbers | Text Cleaner |
| Adobe Fill & Sign (filling) | PDF Form Filler |
| Adobe Fill & Sign (signing) | PDF Signer |
| Advanced IP Scanner | LAN Scanner |
| Advanced Renamer | Bulk Rename |
| AES encryption and decryption | AES Encryption |
| After Effects (simple motion) | Animation Studio (Theatre.js) |
| AhaSlides | Live Quiz |
| Analog Devices Filter Wizard | Filter Designer |
| Android Asset Studio launcher icons | App Icon Maker |
| Android Asset Studio nine-patch generator | Nine-patch Maker |
| Android Button Maker | Android Button Maker |
| Android Pixel Calculator | Android Pixel Calculator |
| Android Studio Vector Asset import | SVG, VectorDrawable and Compose |
| Angry IP Scanner | LAN Scanner |
| Animation | Animation |
| anime.js documentation playground | anime.js Editor |
| Ansible Playbook Generator | Config File Generator |
| App Mockup | Store Graphics Maker |
| appicon.co | App Icon Maker |
| AppLaunchpad | Store Graphics Maker |
| Apple Shortcuts and Automator (text files) | Workflow Builder |
| Arduino Serial Monitor | Serial Monitor |
| Arduino Serial Plotter | Serial Plotter |
| Argon2 hash | Password Hashing |
| ASCII art text generator | ASCII Art Text |
| ASCII to Text Converter | ASCII ↔ Text |
| ASN lookup | IP Lookup |
| Avery Design & Print | Certificates, Badges and Labels |
| AVIF Converter | Image Converter |
| Avro viewers | Parquet and Avro Viewer |
| AWS IAM Policy Generator | Config File Generator |
| Azure Bicep Generator | Config File Generator |
| Azure Pipeline Generator | Config File Generator |
| Babel Config Generator | Config File Generator |
| Background | Background |
| Background Generator | Background Patterns |
| Baobab (Disk Usage Analyzer) | Disk Usage |
| Barcode Generator | Barcode Generator |
| Base 32 Decoder | Base32 |
| Base 62 Encoder | Base62 |
| Base Converter | Number Base Converter |
| Base58 Decoder / Encoder | Base58 |
| Base64 Decode & Encode | Base64 |
| Base64 encode and decode | Base64 |
| Basic auth generator | Basic Auth Header |
| Basic Commands - Ubuntu/Windows | Command Cheat Sheet |
| Batch file processing | Workflow Builder |
| BBCode to HTML | BBCode ↔ HTML |
| Bcrypt | Password Hashing |
| Benchmark builder | Benchmark Statistics |
| BetterSerialPlotter | Serial Plotter |
| bigtext tools | Large Type |
| BIMI checker | Email DNS Check |
| Binary Calculator | Binary Calculator |
| Binary Translator | Binary ↔ Text |
| BIP39 passphrase generator | BIP39 Mnemonic |
| bl.ocks.org | D3.js Editor |
| BLAKE3 hash | Hash and HMAC |
| Blob Generator | Blob Generator |
| BloomRPC | gRPC Client |
| Blynk-style panels over serial | Instrument Panel |
| Bookbinder | Booklet and Zine Imposer |
| Booklet printing dialogs | Booklet and Zine Imposer |
| Bootstrap Build (Bootstrap 5 theme editor) | Bootstrap Theme Builder |
| Bootstrap Code Editor | HTML Playground |
| Border | Border |
| Border Radius | Border Radius |
| Box Shadow | Box Shadow |
| Boxy SVG | Vector Editor |
| Braille translators (grade 1) | Braille Translator |
| Breadcrumb Schema Generator | Config File Generator |
| Broken link checker | Broken Link Checker |
| Bulk Rename Utility | Bulk Rename |
| Cable Size Calculator | Cable Size and Voltage Drop |
| Calcpad | Calcpad Worksheet |
| Calculator apps | Scientific Calculator |
| Cam design software (basic) | Cams, Geneva Drive and Gear Trains |
| Canva bulk create | Certificates, Badges and Labels |
| Canva resumes | Resume Builder |
| Carbon | Code Screenshot |
| Case Converter | Case Converter |
| Certifier | Certificates, Badges and Labels |
| Changelog Generator | Config File Generator |
| Character Map | Glyph Browser |
| Chart maker | Chart Maker |
| checkov | Kubernetes, Compose, Terraform and Dockerfile Checker |
| ChemicalAid | Chemistry Solver |
| Chemistry problem solvers (basic) | Chemistry Solver |
| Chroma key in OBS, Shotcut and DaVinci Resolve (simple shots) | Green Screen Editor |
| Chronometer | Stopwatch and Timer |
| CircleCI Config Generator | Config File Generator |
| Circuit Breaker Size Calculator | Circuit Breaker Size |
| CircuitLab (DC, transient and AC analysis) | Circuit Simulator |
| ClearCalcs beam | Beam Calculator |
| Cloud Build Config Generator | Config File Generator |
| Cloud Run Config Generator | Config File Generator |
| CloudFormation Template Generator | Config File Generator |
| CNAME lookup | DNS Lookup |
| Code for Email | Email Link Builder |
| CodeCogs Equation Editor | Equation Editor (LaTeX) |
| CodePen (anime.js sketches) | anime.js Editor |
| CodePen (D3 sketches) | D3.js Editor |
| Color Blindness Simulator | Colour Blindness Simulator |
| Color Contrast Checker | Contrast Checker |
| Color name finders | Colour Names |
| Color scheme generator | Colour Harmonies |
| Color Shades Generator | Colour Shades |
| Color Swapper | Colour Replacer |
| ColorBrewer | Palette Library |
| Connection String Builder | Config File Generator |
| convertunits.com | Unit Converter |
| ConvertX | File Converter |
| Coolors palettes (curated) | Palette Library |
| CoolTerm capture | Data Logger |
| Coordinates converter | Coordinates Converter |
| CopyQ | Clipboard History |
| CORS Policy Generator | Config File Generator |
| Create Booklet | Booklet and Zine Imposer |
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
| CSS Specificity Calculator | CSS Specificity Calculator |
| CSS Text Shadow Generator | Text Shadow |
| CSS to Tailwind Converter | CSS to Tailwind |
| CSV SQL tools | Data Playground (SQL) |
| CSV to HTML | Table Converter |
| CSV to JSON Converter | CSV to JSON |
| CSV to SQL | Table Converter |
| Cubic Bezier Generator | Cubic Bezier |
| cURL to Code Converter | cURL to Code |
| cURL to Fetch Converter | cURL to Code |
| Custom scripts | Plugins |
| Customer Acquisition Cost (CAC) Calculator | CAC Calculator |
| CyberChef | Recipe |
| Czkawka | Duplicate File Finder |
| Date calculator | Date Calculator |
| Days between dates | Date Calculator |
| DB Browser for SQLite (browsing) | SQLite Browser |
| dbdiagram.io (from SQL) | SQL to ER Diagram |
| Derivative calculator | Calculus Solver |
| Desmos (basic plotting) | Graphing Calculator |
| Device information | Device Information |
| Diff Checker | Diff Checker |
| diff-pdf | PDF Compare |
| diff2html | Patch Viewer |
| Digi-Key and Mouser code calculators | Resistor and Capacitor Codes |
| Dillinger | Markdown Editor |
| ditherit | Dither and Halftone |
| Ditto | Clipboard History |
| DKIM checker | Email DNS Check |
| DMARC checker | Email DNS Check |
| DNS lookup | DNS Lookup |
| DNS propagation checker | DNS Propagation |
| DNSSEC check | DNS Lookup |
| DocFetcher | Offline Search |
| Dockerfile Generator | Config File Generator |
| Dockerfile Validator | Kubernetes, Compose, Terraform and Dockerfile Checker |
| Document scanner apps (manual corners) | Perspective Fix |
| DocuSign-style self signing | PDF Signer |
| Domain age checker | Domain WHOIS and Expiry |
| Domain expiry checker | Domain WHOIS and Expiry |
| Domain to IP | IP Lookup |
| draw9patch | Nine-patch Maker |
| drawSQL | SQL to ER Diagram |
| Drik Panchang (daily panchang) | Kundli and Panchang |
| DuckDB shell | Data Playground (SQL) |
| dupeGuru | Duplicate File Finder |
| Duplicate Line Remover | Duplicate Line Remover |
| Ecology and epidemiology simulators | Biology Lab |
| ECS Task Definition Generator | Config File Generator |
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
| Enzyme kinetics calculators | Biology Lab |
| ESLint Config Generator | Config File Generator |
| ETA calculator | ETA Calculator |
| Evernote | Notes |
| Everything | Offline Search |
| Excalidraw (sketches in notes) | Notes |
| Excel to CSV | Table Converter |
| Factory Load Calculator | Load and Energy Cost |
| Falstad Circuit Simulator | Circuit Simulator |
| FAQ Schema Generator | Config File Generator |
| Favicon Generator | Favicon and ICO |
| fdupes | Duplicate File Finder |
| Fing | LAN Scanner |
| Flexbox layout Generator | Flexbox |
| FlipHTML5 | Flipbook Editor |
| FlipHTML5 reader | Flipbook Reader |
| FluidSIM (basic circuits) | Pneumatic and Hydraulic Circuits |
| FontDrop | Font File Explorer |
| FreeConvert (documents, e-mails, PostScript, XPS, HEIC, tracing, archives) | File Converter |
| FreeFileSync (compare) | Folder Compare |
| gang-run and nesting calculators | Print Production Studio |
| GeoGebra (geometry basics) | Geometry Lab |
| GeoGebra graphing (basic) | Graphing Calculator |
| geojson.io | Map Viewer (GeoJSON, KML, GPX) |
| gImageReader | PDF Studio |
| git mergetool | Git Workbench |
| GitHub Actions Generator | Config File Generator |
| GitHub diff view | Patch Viewer |
| gitk | Git Workbench |
| GitLab CI Pipeline Generator | Config File Generator |
| Glassmorphism Generator | Glassmorphism |
| glogg / klogg | Log Viewer |
| Google HAR Analyzer | HAR Viewer |
| Google Keep | Notes |
| Google Slides (simple decks) | Slide Deck (reveal.js) |
| GPX viewers | Map Viewer (GeoJSON, KML, GPX) |
| Gradient Generator | Gradient Generator |
| Gradient Image | Gradient Generator |
| Grafana Dashboard Generator | Config File Generator |
| GraphvizOnline | Graphviz (DOT) Viewer |
| Grid layout Generator | Grid |
| grpcurl | gRPC Client |
| GTKWave (digital signals) | Logic Analyser |
| Gzip compress / decompress | Gzip Compress |
| hadolint | Kubernetes, Compose, Terraform and Dockerfile Checker |
| Halftone generators | Dither and Halftone |
| Hash Identifier | Hash Identifier |
| Hash text | Hash and HMAC |
| hashID | Hash Identifier |
| Helm Chart Generator | Config File Generator |
| Hex Decoder | Hex ↔ Text |
| Hex to Decimal Converter | Number Base Converter |
| HexEd.it (viewing) | Hex Viewer |
| Heyzine | Flipbook Editor |
| Heyzine viewer | Flipbook Reader |
| Hreflang Generator | Config File Generator |
| HTML Encoder / Decoder | HTML Entities |
| HTML Formatter | HTML Formatter |
| HTML to BBCode | BBCode ↔ HTML |
| HTML to JSX | HTML to JSX |
| HTML to Markdown Converter | HTML to Markdown |
| HTML WYSIWYG editor | HTML Editor (WYSIWYG) |
| Htpasswd Generator | Htpasswd Generator |
| HTTP headers checker | Website Status |
| HTTP status checker | Website Status |
| HTTrack | Website Copier |
| IBAN validator and parser | IBAN Validator |
| ICO Transparency Creator | Favicon and ICO |
| IconKitchen | App Icon Maker |
| Image Base64 | Image to Base64 |
| Image Color Picker/Palette | Image Colour Picker |
| Image combiner sites | Image Stitcher |
| Image Compress | Image Converter |
| Image Crop | Image Crop |
| Image Fade Effect Generator | Image Fade |
| Image Filter | Image Filter |
| Image Filter (CSS) | Filter |
| Image Grayscale | Image Filter |
| Image Resize | Image Resize |
| Image Rotate | Image Rotate |
| Inkscape (basics) | Vector Editor |
| Instagram grid makers | Image Splitter |
| Integral calculator | Calculus Solver |
| ios-resolution.com | Screen Size and Density |
| IP WHOIS | IP Lookup |
| iperf3 | LAN Speed Test |
| IPv4 address converter | IP Address Converter |
| IPv4 range expander | IP Address Converter |
| IPv6 ULA generator | IP Address Converter |
| Issuu flipbooks | Flipbook Editor |
| Istio config generators | Config File Generator |
| JavaScript encode and decode | JavaScript Minifier |
| JavaScript Formatter | JavaScript Formatter |
| JDoodle (offline) | Code Runner |
| Jenkins Pipeline Generator | Config File Generator |
| Jest Config Generator | Config File Generator |
| Jmol | Molecule Viewer |
| JS Paint | Paint |
| JSON diff | Diff Checker |
| JSON diff checkers | JSON Diff |
| JSON Formatter | JSON Formatter |
| JSON Resume themes | Resume Builder |
| JSON to C# | JSON to Code |
| JSON to CSV Converter | JSON to CSV |
| JSON to Go | JSON to Code |
| JSON to GraphQL | JSON to Code |
| JSON to Java | JSON to Code |
| JSON to Mongoose | JSON to Code |
| JSON to MySQL | JSON to Code |
| JSON to Protobuf | JSON to Code |
| JSON to Python | JSON to Code |
| JSON to query string | Data Format Converter |
| JSON to TypeScript Converter | JSON to TypeScript |
| JSON to XML | Data Format Converter |
| JSON to Zod Schema | JSON to Code |
| JSON viewer | JSON Viewer |
| json-server | Mock API Server and Webhook Catcher |
| JWT Decoder | JWT Decoder |
| JWT Encoder | JWT Encoder |
| jwt.io debugger | JWT Decoder |
| jwt.io encoder | JWT Encoder |
| Kahoot! | Live Quiz |
| KaiOS Manifest Convertor | KaiOS Manifest Maker |
| Karnaugh map solvers | Karnaugh Map Solver |
| KDiff3 | Git Workbench |
| Keccak-256 | Hash and HMAC |
| Keycode info | Keycode Info |
| Keyshape | Animation Studio (Theatre.js) |
| KML to GPX converters | Map Viewer (GeoJSON, KML, GPX) |
| kube-linter | Kubernetes, Compose, Terraform and Dockerfile Checker |
| kube-score | Kubernetes, Compose, Terraform and Dockerfile Checker |
| Kubernetes YAML generators | Config File Generator |
| Kundli software (AstroSage, Jagannatha Hora basics) | Kundli and Panchang |
| Kustomize Configuration Generator | Config File Generator |
| kVA to Amps Calculator | Power Converter (kW, kVA, Amps, hp) |
| kW to kVA Calculator | Power Converter (kW, kVA, Amps, hp) |
| L-network calculators | Smith Chart |
| LabVIEW front panels (simple cases) | Instrument Panel |
| Lambda Config Generator | Config File Generator |
| LAN Speed Test | LAN Speed Test |
| LaTeX to image converters | Equation Editor (LaTeX) |
| LESS to CSS | SCSS and Less to CSS |
| Limit calculator | Calculus Solver |
| Linkage (David Rector) | Mechanism Simulator |
| List converter | List Converter |
| List randomizer | Random Generator |
| llms.txt Generator | llms.txt Generator |
| lnav | Log Viewer |
| Load Factor Calculator | Load and Energy Cost |
| LogExpert | Log Viewer |
| Logic Friday (minimisation) | Karnaugh Map Solver |
| Logisim (basic logic) | Circuit Simulator |
| MAC address generator | MAC Address Lookup |
| MAC address lookup | LAN Scanner |
| MAC address lookup | MAC Address Lookup |
| macOS Large Type | Large Type |
| mapshaper (viewing) | Map Viewer (GeoJSON, KML, GPX) |
| Markdown to HTML Converter | Markdown to HTML |
| Marp | Slide Deck (reveal.js) |
| Material Theme Builder | Material Theme Builder |
| Math evaluator | Math Evaluator |
| Mathcad worksheets (basic) | Calcpad Worksheet |
| Mathcha | Equation Editor (LaTeX) |
| Mathway (basic) | Algebra Solver |
| Matrix calculators | Matrix Calculator |
| Matrix Transform | Transform |
| MD5 hash generator | Hash and HMAC |
| mechsim.app (linkages) | Mechanism Simulator |
| mechsimulator.com (cams, Geneva, gear trains) | Cams, Geneva Drive and Gear Trains |
| mechsimulator.com (engine cycles) | Engine and Power Cycles |
| mechsimulator.com (mechanisms) | Mechanism Simulator |
| mechsimulator.com (physics) | Mechanics Lab |
| mechsimulator.com (PLC ladder) | PLC Ladder Logic Simulator |
| mechsimulator.com (pneumatic and hydraulic circuits) | Pneumatic and Hydraulic Circuits |
| Media Localiser | Video Dubbing |
| MediaInfo | Media Info |
| Meld | Git Workbench |
| Meld (folders) | Folder Compare |
| Mentimeter | Live Quiz |
| Mermaid Live Editor | Mermaid Diagram Editor |
| Mesh Gradient Generator | Mesh Gradient |
| MeshLab (basics) | 3D Model Toolbox |
| Meshmixer (repair) | 3D Model Toolbox |
| Method Draw | Vector Editor |
| Microsoft Paint | Paint |
| Minify JS | JavaScript Minifier |
| miniserve | LAN File Sharing |
| Mock data generator | Mock Data Generator |
| Mockoon | Mock API Server and Webhook Catcher |
| MolView | Molecule Viewer |
| MongoDB ObjectId generator | UUID and ID Generator |
| Morse Code Translator | Morse Code |
| Motor FLA Calculator | Motor Current and Torque |
| MTA-STS checker | Email DNS Check |
| MuseScore (simple scores) | Sheet Music Writer |
| MX lookup | DNS Lookup |
| MX lookup | Email DNS Check |
| n8n (file workflows) | Workflow Builder |
| Name That Color | Colour Names |
| Nano ID generator | UUID and ID Generator |
| NC Viewer | 3D Model and G-code Viewer |
| ncdu | Disk Usage |
| Netfabb Basic | 3D Model Toolbox |
| No-crop apps | Social Media Sizer |
| Node-RED (file flows) | Workflow Builder |
| Nokia Composer (phones) | Ringtone Composer |
| Noteflight (basic) | Sheet Music Writer |
| Notion (pages) | Notes |
| Novorésumé | Resume Builder |
| NS lookup | DNS Lookup |
| NTLM hash | Hash and HMAC |
| Number to Words Converter | Number to Words |
| Numeronym generator | Numeronym Generator |
| Observable notebooks (D3 sketches) | D3.js Editor |
| OCRmyPDF | PDF Studio |
| Okawa filter calculators | Filter Designer |
| OKLCH Converter | Colour Converter |
| Okular and Xournal++ annotation | PDF Reader |
| OLS client (SUMP) | Logic Analyser |
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
| Omni Molar Mass Calculator | Molar Mass Calculator |
| Omni Sunrise Calculator | Sunrise, Sun and Moon |
| OneCompiler | Code Runner |
| OneNote | Notes |
| online CSR and certificate generators | Certificate Maker |
| online CSV SQL tools | SQLite Browser |
| Online notepads | Scratchpad |
| online planispheres | Star Chart |
| online print-ready PDF checkers | PDF Print Preflight |
| Online REST client | HTTP Request |
| Online scientific calculators | Scientific Calculator |
| Online screen recorders | Screen and Voice Recorder |
| online screenshot annotators | Image Annotator |
| online Smith chart tools | Smith Chart |
| online STL repair and conversion sites | 3D Model Toolbox |
| Online subtitle converters | Subtitle Studio |
| online text-to-speech sites | Text to Speech |
| online video translators | Video Dubbing |
| online Web Serial terminals | Serial Monitor |
| Open graph meta generator | Meta Tag Generator |
| Open port checker | Port Checker |
| OpenSpeedTest | LAN Speed Test |
| Optical Character Recognition | Text Recognition (OCR) |
| Optics bench simulators | Optics Bench |
| Outlook Safelink decoder | Link Unwrapper |
| Package.json Generator | Config File Generator |
| Paintbrush | Paint |
| Pandoc (Markdown export) | Markdown Editor |
| paper cutting calculators | Print Production Studio |
| papersizes.org | Paper Sizes |
| Parquet viewers | Parquet and Avro Viewer |
| Password strength analyser | Password Strength |
| Paste-to-file sites | Paste Image |
| PDF compare | Diff Checker |
| PDF Redact Tools | PDF Studio |
| PDF signature checker | PDF Signature Checker |
| PDF to text | Document to Text |
| PDFCrowd | Web Page to PDF |
| Percentage calculator | Percentage Calculator |
| PhET (geometric optics, bending light, wave interference) | Optics Bench |
| PhET (natural selection, gene expression) | Genetics Lab |
| PhET (neuron, diffusion) | Biology Lab |
| PhET (projectile motion, pendulum lab, masses and springs, collision lab, gravity and orbits, forces and motion) | Mechanics Lab |
| PhET (trig tour) | Geometry Lab |
| PhET (wave interference, sound waves, gas properties, charges and fields, Faraday’s law, buoyancy, fluid pressure and flow) | Waves, Heat and Fields Lab |
| Phone parser and formatter | Phone Number Parser |
| PhotoJoiner | Image Stitcher |
| Photoshop soft proofing and Convert to Profile | Print Production Studio |
| PICSimLab (ESP32) | Circuit Simulator |
| piesocket tester | WebSocket and SSE Client |
| Pine Tools image splitter | Image Splitter |
| Piper | Text to Speech |
| PLC simulators (basic ladder logic) | PLC Ladder Logic Simulator |
| PLX-DAQ | Data Logger |
| PNG Color Replacer | Colour Replacer |
| PNG to ICO Converter | Favicon and ICO |
| PNG to WebP Converter | Image Converter |
| PostCSS Config Generator | Config File Generator |
| Postman gRPC | gRPC Client |
| Postman WebSocket | WebSocket and SSE Client |
| PowerRename | Bulk Rename |
| Previewed | Store Graphics Maker |
| Print Friendly & PDF | Web Page to PDF |
| Processing sketches for sensor read-outs | Instrument Panel |
| Programiz online compilers | Code Runner |
| Project folders | Projects |
| ProjectorCentral projection calculator | Projector Calculator |
| ProjectorCentral screen size calculator | Screen Size Calculator |
| Prometheus Config Generator | Config File Generator |
| Ptable | Periodic Table |
| PubChem 3D viewer | Molecule Viewer |
| PubChem Periodic Table | Periodic Table |
| PulseView (viewing and decoding I²C, SPI, UART) | Logic Analyser |
| Punnett square calculators | Genetics Lab |
| PX to REM Converter | PX ↔ REM |
| python -m http.server | LAN File Sharing |
| QR code generator | QR Code Generator |
| Quizizz (live games) | Live Quiz |
| Random number generator | Random Generator |
| Random port generator | Random Generator |
| Random Word Generator | Random Words |
| ray.so | Code Screenshot |
| RDAP lookup | Domain WHOIS and Expiry |
| Reactive Resume | Resume Builder |
| Recoll | Offline Search |
| Redirect checker | Website Status |
| Redirect link decoder | Link Unwrapper |
| Redocly preview | OpenAPI Viewer |
| Regex cheatsheet | Regex Cheat Sheet and Code |
| Regex code generator | Regex Cheat Sheet and Code |
| Remove extra spaces | Text Cleaner |
| Remove Line Breaks | Remove Line Breaks |
| RequestBin | Mock API Server and Webhook Catcher |
| reveal-md | Slide Deck (reveal.js) |
| reveal.js | Slide Deck (reveal.js) |
| Reverse DNS | DNS Lookup |
| Rive (simple scenes) | Animation Studio (Theatre.js) |
| robots.txt Generator | robots.txt Generator |
| Rollup Config Generator | Config File Generator |
| Roman numeral converter | Roman Numerals |
| ROT13 Encoder/Decoder | ROT13 and Caesar |
| RSC Periodic Table | Periodic Table |
| RTTTL editors and players | Ringtone Composer |
| S3 Bucket Policy Generator | Config File Generator |
| Saleae Logic (viewing exports) | Logic Analyser |
| Saturated steam table | Steam Tables |
| Schema.org Generator | Config File Generator |
| scipy.signal.butter | Filter Designer |
| Screen size calculators | Screen Size and Density |
| screensiz.es | Screen Size and Density |
| SCSS to CSS | SCSS and Less to CSS |
| Section property calculators | Section Properties |
| Send Anywhere (local) | LAN File Sharing |
| Serial Studio (dashboards) | Instrument Panel |
| SerialPlot | Serial Plotter |
| SerialPlot logging | Data Logger |
| Service Worker Generator | Config File Generator |
| Session save and restore | Projects |
| SHA-1 Hash Generator | Hash and HMAC |
| SHA-384 Hash Generator | Hash and HMAC |
| SHA-512 Hash Generator | Hash and HMAC |
| Shadcn Theme Generator | shadcn/ui Theme |
| Shavian transliterators | IPA and Shavian |
| SimulIDE | Circuit Simulator |
| Sitemap XML Generator | Config File Generator |
| SiteSucker | Website Copier |
| Sky charts | Star Chart |
| SkyCiv beam calculator | Beam Calculator |
| Slides.com | Slide Deck (reveal.js) |
| Slido | Live Quiz |
| Smallpdf and iLovePDF crop | PDF Crop |
| Smallpdf and iLovePDF form filling | PDF Form Filler |
| Smallpdf eSign | PDF Signer |
| SMath Studio (basic) | Calcpad Worksheet |
| Smith V4 | Smith Chart |
| Snagit and Greenshot editors | Image Annotator |
| Snapdrop | LAN File Sharing |
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
| Social image resizers | Social Media Sizer |
| Sourcetree (browsing) | Git Workbench |
| SPF checker | Email DNS Check |
| Spirax Sarco steam tables | Steam Tables |
| Spotlight | Offline Search |
| SSL checker | SSL Certificate Checker |
| SSL expiry checker | SSL Certificate Checker |
| StackEdit | Markdown Editor |
| Statistics calculators | Statistics |
| Stellarium (basic sky view) | Star Chart |
| Stirling PDF (bookmarks, attachments, overlay, colours, blank pages, sanitise, flatten, unlock forms, repair, get info, show JavaScript, extract images, single large page, page size, auto rotate, auto rename, split scanned photos, stamps, form fields, accessibility, timestamp) | PDF Toolbox |
| Stirling PDF (repair, remove images, greyscale) | PDF Passwords and Compression |
| Stirling PDF compare | PDF Compare |
| Stirling PDF viewer and annotations | PDF Reader |
| StPageFlip | Flipbook Editor |
| String obfuscator | String Obfuscator |
| Strip HTML tags | Text Cleaner |
| Stripe Fee Calculator | Payment Fee Calculator |
| Subresource Integrity Generator | Hash and HMAC |
| Subtitle Edit (basic fixes) | Subtitle Studio |
| Sunburst Generator | Sunburst Generator |
| SunCalc | Sunrise, Sun and Moon |
| SVG Background Remover | SVG Background Remover |
| SVG Minifier | SVG Minifier |
| SVG placeholder generator | Placeholder Image |
| SVG to Compose | SVG, VectorDrawable and Compose |
| SVG to PNG Converter | SVG to PNG |
| SVG to React Component Converter | SVG to React |
| SVG Viewer | SVG Viewer |
| SVG-Edit | Vector Editor |
| SVG.js playground (JSFiddle, CodePen) | SVG.js Editor |
| svg2vector | SVG, VectorDrawable and Compose |
| Swagger Editor (viewing) | OpenAPI Viewer |
| Symbolab (basic) | Algebra Solver |
| Symbolab calculus | Calculus Solver |
| Syntax highlighter | Syntax Highlighter |
| Table converter | Table Converter |
| Tailwind cheat sheet sites | Tailwind Cheat Sheet |
| Tailwind Colors | Tailwind Colours |
| Temperature converter | Unit Converter |
| Tera Term log | Data Logger |
| Terraform AWS Module Generator | Config File Generator |
| Text Compare | Diff Checker |
| Text repeater | Text Repeater |
| Text Reverser | Text Reverser |
| Text Shadow | Text Shadow |
| Text to NATO alphabet | NATO Phonetic Alphabet |
| tfsec | Kubernetes, Compose, Terraform and Dockerfile Checker |
| Theatre.js Studio | Animation Studio (Theatre.js) |
| Thermodynamic cycle simulators | Engine and Power Cycles |
| TI Filter Design Tool | Filter Designer |
| Time sheet calculator | Time Sheet Calculator |
| timeanddate.com meeting planner | Time Zone Planner |
| timeanddate.com sun calculator | Sunrise, Sun and Moon |
| Timecode calculators | Timecode Calculator |
| Tinkercad Circuits | Circuit Simulator |
| TLS checker | SSL Certificate Checker |
| TOML to YAML | Data Format Converter |
| toPhonetics | IPA and Shavian |
| Traefik Config Generator | Config File Generator |
| transform.tools HTML to JSX | HTML to JSX |
| Transformer Calculator | Transformer Size |
| Transformer Size Calculator | Transformer Size |
| Transition | Transition |
| TXT lookup | DNS Lookup |
| typescale.com | Type Scale |
| Typora | Markdown Editor |
| ULID generator | UUID and ID Generator |
| Unicode text styles | Fancy Text Styles |
| unicode-table.com | Glyph Browser |
| Unit converter | Unit Converter |
| Unix Timestamp Converter | Unix Timestamp |
| unscreen-style background replacement for studio shots | Green Screen Editor |
| UPS Capacity Calculator | UPS Sizing and Runtime |
| UPS Runtime Calculator | UPS Sizing and Runtime |
| URL extractor | Extract from Text |
| UTF-8 Decoder | UTF-8 Bytes |
| Utopia fluid type calculator | Type Scale |
| UUID & GUID Generator | UUID and ID Generator |
| viewstl.com | 3D Model and G-code Viewer |
| Vite Config Generator | Config File Generator |
| Voice recorder sites | Screen and Voice Recorder |
| Wakamai Fondue | Font File Explorer |
| WakeOnLAN apps | Wake-on-LAN |
| wakeonlan command | Wake-on-LAN |
| Wave Generator | Wave Generator |
| web2pdfconvert | Web Page to PDF |
| webhook.site | Mock API Server and Webhook Catcher |
| Webpack Config Generator | Config File Generator |
| WebQC equation balancer | Chemistry Solver |
| WebQC molar mass | Molar Mass Calculator |
| Website down checker | Website Status |
| websocat | WebSocket and SSE Client |
| wget --mirror | Website Copier |
| What is my IP | IP Lookup |
| WHOIS lookup | Domain WHOIS and Expiry |
| WiFi QR code generator | QR Code Generator |
| WinDirStat | Disk Usage |
| Windows clipboard history | Clipboard History |
| Windows Search | Offline Search |
| WinMerge (folders) | Folder Compare |
| Wire gauge converters | Wire Gauge Chart |
| WireGuard config generators | WireGuard Config Generator |
| Wokwi (Uno, Mega, ATtiny85, Pico and ESP32) | Circuit Simulator |
| Wolfram Alpha calculus (basic) | Calculus Solver |
| Word compare | Diff Checker |
| Word mail merge | Certificates, Badges and Labels |
| Word to text | Document to Text |
| World Time Buddy | Time Zone Planner |
| XMind (simple mind maps) | Notes |
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
