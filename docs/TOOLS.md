# Tools

<!-- Generated from src/tools/registry.ts by tests/unit/docs.test.ts. Do not edit by hand. -->

Benchtop has 97 tools. Every one of them works without a network connection.

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

## Convert

| Tool | What it does | Replaces |
| --- | --- | --- |
| CSV to JSON | Turn CSV or TSV into JSON, handling quotes and multi-line cells. | CSV to JSON Converter |
| JSON to CSV | Flatten JSON into a CSV table. | JSON to CSV Converter |
| JSON to TypeScript | Infer TypeScript interfaces from a JSON sample. | JSON to TypeScript Converter |
| YAML ↔ JSON | Convert YAML to JSON and JSON to YAML. | YAML to JSON Converter |
| Markdown to HTML | Render Markdown to HTML with a live preview. | Markdown to HTML Converter |
| HTML to Markdown | Convert HTML to Markdown, including tables and strikethrough. | HTML to Markdown Converter |
| cURL to fetch | Convert a curl command into JavaScript fetch() code. | cURL to Fetch Converter |
| SVG to React | Turn SVG markup into a React component (JSX or TSX). | SVG to React Component Converter |
| CSS to Tailwind | Translate CSS rules into Tailwind v4 utility classes. | CSS to Tailwind Converter |
| Number to Words | Spell out numbers, ordinals and money, in international or Indian numbering. | Number to Words Converter |
| Unix Timestamp | Convert epoch timestamps to dates in any time zone, and back. | Unix Timestamp Converter |
| Number Base Converter | Convert numbers between binary, octal, decimal, hex and any base up to 36. | Base Converter, Hex to Decimal Converter |
| Binary Calculator | Arithmetic and bitwise operations on binary, decimal or hex numbers. | Binary Calculator |
| PX ↔ REM | Convert between pixels and rem, with a reference table. | PX to REM Converter |
| Android Pixel Calculator | Convert between dp, px, sp, in, mm and pt for any screen density. | Android Pixel Calculator |

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
| JWT Decoder | Read a JSON Web Token: header, claims, expiry and HMAC signature check. | JWT Decoder |
| JWT Encoder | Sign JSON Web Tokens with HS256, HS384 or HS512. | JWT Encoder |
| Image to Base64 | Embed an image as a data URI for CSS, HTML or Markdown. | Image Base64 |

## Hash and encrypt

| Tool | What it does | Replaces |
| --- | --- | --- |
| Hash and HMAC | MD5, SHA-1, SHA-2, SHA-3 and CRC-32 of text or files, with HMAC and checksum comparison. | SHA-1 Hash Generator, SHA-512 Hash Generator, MD5 hash generator |
| AES Encryption | Encrypt and decrypt with a password (AES-256-GCM, or OpenSSL-compatible CBC). | AES encryption and decryption |
| Htpasswd Generator | Create and check password entries for Apache and nginx basic auth. | Htpasswd Generator |

## Generate

| Tool | What it does | Replaces |
| --- | --- | --- |
| UUID Generator | Generate v1, v4, v6 and v7 UUIDs in bulk and decode existing ones. | UUID & GUID Generator |
| Random Words | Pick random words by length and case, for test data or passphrases. | Random Word Generator |
| Barcode Generator | Create Code 128, EAN, UPC, Code 39, ITF-14, QR and Data Matrix codes as SVG or PNG. | Barcode Generator |
| Cron Expression | Explain a cron expression and preview its next run times. | Cron Expression Generator |
| robots.txt Generator | Write crawler rules, including a block list for AI crawlers. | robots.txt Generator |
| llms.txt Generator | Build or validate an llms.txt file from links or a pasted sitemap. | llms.txt Generator |
| Email Link Builder | Build mailto links with subject and body, optionally hidden from scrapers. | Code for Email |

## Text

| Tool | What it does | Replaces |
| --- | --- | --- |
| Diff Checker | Compare two texts by line, word or character and export a patch. | Diff Checker |
| Case Converter | Switch between camelCase, snake_case, kebab-case, Title Case and more. | Case Converter |
| Duplicate Line Remover | Remove repeated lines, with control over case and which copy to keep. | Duplicate Line Remover |
| Remove Line Breaks | Join lines into paragraphs or a single line. | Remove Line Breaks |
| Text Reverser | Reverse characters, word order or line order. | Text Reverser |

## CSS generators

| Tool | What it does | Replaces |
| --- | --- | --- |
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

## Reference and extras

| Tool | What it does | Replaces |
| --- | --- | --- |
| HTML Playground | Try HTML and CSS, with Bootstrap 5 available offline and a resizable preview. | Bootstrap Code Editor |
| Command Cheat Sheet | Equivalent terminal commands for Linux, Windows cmd and PowerShell. | Basic Commands - Ubuntu/Windows |
| Android Button Maker | Design a button and get the shape-drawable XML. | Android Button Maker |
| Payment Fee Calculator | Work out card processing fees, or what to charge to receive a set amount. | Stripe Fee Calculator |
| CAC Calculator | Customer acquisition cost, payback period and LTV:CAC. | Customer Acquisition Cost (CAC) Calculator |

## Coverage of the original web tools

117 web tools map onto Benchtop tools:

| Web tool | Benchtop tool |
| --- | --- |
| AES encryption and decryption | AES Encryption |
| Android Button Maker | Android Button Maker |
| Android Pixel Calculator | Android Pixel Calculator |
| Animation | Animation |
| ASCII to Text Converter | ASCII ↔ Text |
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
| Basic Commands - Ubuntu/Windows | Command Cheat Sheet |
| Binary Calculator | Binary Calculator |
| Binary Translator | Binary ↔ Text |
| Blob Generator | Blob Generator |
| Bootstrap Build (Bootstrap 5 theme editor) | Bootstrap Theme Builder |
| Bootstrap Code Editor | HTML Playground |
| Border | Border |
| Border Radius | Border Radius |
| Box Shadow | Box Shadow |
| Case Converter | Case Converter |
| Code for Email | Email Link Builder |
| Color Blindness Simulator | Colour Blindness Simulator |
| Color Contrast Checker | Contrast Checker |
| Color Shades Generator | Colour Shades |
| Color Swapper | Colour Replacer |
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
| CSS Text Shadow Generator | Text Shadow |
| CSS to Tailwind Converter | CSS to Tailwind |
| CSV to JSON Converter | CSV to JSON |
| Cubic Bezier Generator | Cubic Bezier |
| cURL to Fetch Converter | cURL to fetch |
| Customer Acquisition Cost (CAC) Calculator | CAC Calculator |
| Diff Checker | Diff Checker |
| Duplicate Line Remover | Duplicate Line Remover |
| Favicon Generator | Favicon and ICO |
| Flexbox layout Generator | Flexbox |
| Glassmorphism Generator | Glassmorphism |
| Gradient Generator | Gradient Generator |
| Gradient Image | Gradient Generator |
| Grid layout Generator | Grid |
| Hex Decoder | Hex ↔ Text |
| Hex to Decimal Converter | Number Base Converter |
| HTML Encoder / Decoder | HTML Entities |
| HTML Formatter | HTML Formatter |
| HTML to Markdown Converter | HTML to Markdown |
| Htpasswd Generator | Htpasswd Generator |
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
| JavaScript encode and decode | JavaScript Minifier |
| JavaScript Formatter | JavaScript Formatter |
| JSON Formatter | JSON Formatter |
| JSON to CSV Converter | JSON to CSV |
| JSON to TypeScript Converter | JSON to TypeScript |
| JWT Decoder | JWT Decoder |
| JWT Encoder | JWT Encoder |
| llms.txt Generator | llms.txt Generator |
| Markdown to HTML Converter | Markdown to HTML |
| Matrix Transform | Transform |
| MD5 hash generator | Hash and HMAC |
| Mesh Gradient Generator | Mesh Gradient |
| Minify JS | JavaScript Minifier |
| Morse Code Translator | Morse Code |
| Number to Words Converter | Number to Words |
| OKLCH Converter | Colour Converter |
| PNG Color Replacer | Colour Replacer |
| PNG to ICO Converter | Favicon and ICO |
| PNG to WebP Converter | Image Converter |
| PX to REM Converter | PX ↔ REM |
| Random Word Generator | Random Words |
| Remove Line Breaks | Remove Line Breaks |
| robots.txt Generator | robots.txt Generator |
| ROT13 Encoder/Decoder | ROT13 and Caesar |
| SHA-1 Hash Generator | Hash and HMAC |
| SHA-512 Hash Generator | Hash and HMAC |
| Shadcn Theme Generator | shadcn/ui Theme |
| Stripe Fee Calculator | Payment Fee Calculator |
| Sunburst Generator | Sunburst Generator |
| SVG Background Remover | SVG Background Remover |
| SVG Minifier | SVG Minifier |
| SVG to PNG Converter | SVG to PNG |
| SVG to React Component Converter | SVG to React |
| SVG Viewer | SVG Viewer |
| Tailwind Colors | Tailwind Colours |
| Text Reverser | Text Reverser |
| Text Shadow | Text Shadow |
| Transition | Transition |
| Unix Timestamp Converter | Unix Timestamp |
| UTF-8 Decoder | UTF-8 Bytes |
| UUID & GUID Generator | UUID Generator |
| Wave Generator | Wave Generator |
| XML Formatter | XML Formatter |
| YAML to JSON Converter | YAML ↔ JSON |

### Not included

- **AI Dashboard Generator**: Depends on a hosted AI model to write its insights; there is no faithful offline equivalent.

### Differences from the web versions

- **llms.txt Generator** cannot fetch a sitemap; paste the sitemap XML instead.
- **HTML Playground** previews HTML and CSS, but scripts do not run in the preview (Bootstrap styles work; its interactive components need your real page).
- **CSS to Tailwind** converts declarations to utility classes but does not render the result to compare it visually.
- **Bootstrap Theme Builder** compiles Bootstrap 5.3.9 itself with Dart Sass; it ships five original starting themes rather than third-party theme galleries.
