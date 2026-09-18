# Converter

A local-first workbench of **92 working developer tools** — data formats, text, encoding,
cryptography, colour, networking, dates, and Office documents — in one page.

Nothing you paste, drop, or open is uploaded. Every transform runs in your browser tab,
and the deployed site sends `connect-src 'none'`, so the privacy claim is enforced by the
platform rather than by a promise. There are no dependencies, no build step, no accounts,
and no telemetry.

## Run it

```bash
pnpm dev        # http://localhost:3000
```

```bash
pnpm test       # 93 unit tests across the whole library
pnpm typecheck  # syntax checks every module
pnpm check      # typecheck + test
pnpm build      # validates and copies the static artifact to dist/
```

Node 20 or newer. No install step is required — the project has no runtime dependencies.

## What is in the box

| Category | Tools |
| --- | --- |
| **JSON & Data** (8) | Formatter, JSONPath query, structural diff, JSON→TypeScript, JSON→Go, JSON→JSON Schema, JSON→SQL, NDJSON |
| **Converters** (10) | JSON⇄YAML, JSON⇄TOML, JSON⇄XML, JSON⇄CSV, YAML⇄TOML, CSV converter, XML toolkit, Markdown⇄HTML, HTML→text, list converter |
| **Text** (12) | Case converter, slugify, diff, statistics, line tools, find & replace, regex tester, lorem ipsum, wrap, reverse, secret masking, NATO & Morse |
| **Encoding** (11) | Base64, file⇄Base64, Base32, Base58, hex & binary, URL, HTML entities, string escaper, data URI, punycode, classic ciphers |
| **Crypto & Security** (12) | Hash text, hash a file, HMAC, JWT (inspect/verify/sign), AES-GCM, PBKDF2, key pairs, TOTP, password generator, strength analysis, tokens, basic auth |
| **Generators** (5) | UUID v1/v3/v4/v5/v7, ULID & Nano ID, QR codes, MAC addresses, placeholder images |
| **Web & Design** (9) | Colour converter, contrast checker, palettes, CSS, HTML, SQL, SVG tools, meta tags, image converter |
| **Network** (6) | Subnet calculator, IP notation, IP ranges, IPv6, URL parser, user-agent parser |
| **Numbers & Units** (6) | Base converter, Roman numerals, expression evaluator, unit converter, percentages, chmod |
| **Date & Time** (4) | Timestamps & time zones, date difference, durations, cron expressions |
| **Files & Documents** (5) | CSV⇄XLSX, Markdown⇄DOCX, Markdown→PDF, archive inspector, hex dump |
| **Reference** (4) | MIME types, HTTP status codes, key codes, well-known ports |

Every tool is deep-linkable (`/#/subnet`), reachable from the command palette
(<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd>), and runs live as you type where that makes
sense. <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> runs the current tool.

## Things worth knowing

Several pieces are real implementations rather than thin wrappers, because the browser
does not provide them and we refuse to pull in dependencies:

- **QR codes** — a complete ISO/IEC 18004 encoder: numeric, alphanumeric, and byte modes,
  versions 1–40, all four error-correction levels, Reed–Solomon over GF(256), and
  penalty-scored mask selection. Output is verified against the published BCH format and
  version bit tables, and the generated codes are confirmed scannable by an unrelated
  decoder.
- **XML** — a self-contained parser instead of `DOMParser`, which makes it testable outside
  a browser and removes every external-entity path. Inline DTD subsets, external DTD
  references, and unknown entities are all rejected. A forgiving HTML mode handles real
  markup (bare attributes, implied end tags, void elements, raw-text `script`/`style`).
- **PDF** — a standards-compliant writer with Helvetica/Courier metrics, real word wrap,
  pagination, WinAnsi escapes, and a correct cross-reference table.
- **XLSX and DOCX** — packages built by our own deflating ZIP writer, with typed cells,
  frozen and styled header rows, heading styles, numbering definitions, and tables. Both
  open cleanly in Excel and Word, and read back through the same tools.
- **YAML and TOML** — hand-written readers and writers that round-trip block scalars,
  flow collections, dotted keys, and arrays of tables.
- **Cryptography** — Web Crypto throughout, plus a local MD5 for legacy checksums. Hashes,
  HMAC, and TOTP are tested against the published RFC vectors.

Archives read from disk are bounded by entry count, expanded size, and path-traversal
checks. Spreadsheet output neutralises formula-like values. Rendered HTML previews are
stripped of scripts, event handlers, and `javascript:` URLs.

## Layout

```
public/
  index.html      the shell
  styles.css      the design system
  app.js          the interface — generic, driven entirely by the registry
  registry.js     every tool as data: metadata, controls, and one run function
  lib/            18 dependency-free modules doing the actual work
scripts/          dev server and build validation
test/             93 unit tests
```

Adding a tool means adding one entry to `registry.js`. The interface, sidebar, search,
command palette, deep link, and download handling all follow automatically.

## Deploying

Import the repository into Vercel and deploy. `vercel.json` serves the static files and
applies the security headers; `scripts/serve.js` applies the same headers locally so
development and production behave identically.

## Privacy

- Every transform runs in the browser. No request leaves the page.
- Files you open are read into memory and never written anywhere.
- Nothing is logged, persisted, or transmitted. Only your theme choice is stored, in
  `localStorage`.
