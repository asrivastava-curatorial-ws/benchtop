# Changelog

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
