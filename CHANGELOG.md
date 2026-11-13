# Changelog

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
