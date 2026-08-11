# Converter

A local-first developer workbench for formatting, validating, encoding, and converting data. The current release includes functional JSON, XML, CSV/spreadsheet, Markdown document, Base64, URL, timestamp, JWT inspection, and SHA-2 hashing tools, plus a searchable registry, keyboard command palette, themes, downloadable outputs, and privacy-visible processing indicators.

The spreadsheet workbench creates standards-based XLSX workbooks from CSV and extracts the first worksheet from XLSX as CSV. The document workbench generates styled Word-compatible DOCX files from Markdown and extracts headings and paragraphs from DOCX as Markdown. Office archives are processed locally with entry-count, expanded-size, and path-traversal safety limits.

## Run locally

```bash
pnpm dev
```

Open <http://localhost:3000>. No environment variables or cloud services are required.

## Commands

```bash
pnpm dev        # local static server
pnpm test       # unit tests for deterministic utilities
pnpm typecheck  # JavaScript syntax checks
pnpm build      # validates the deployable static artifact
```

## Deploy to Vercel

Import the repository into Vercel and deploy. `vercel.json` serves the static application and applies baseline security headers. All currently implemented transforms execute in the browser; input is never uploaded.

## Privacy model

- Core tools run locally in the browser.
- Source content is not logged, persisted, or transmitted.
- Cloud and AI adapters are intentionally not required by this foundation release.
- Optional integrations will always be labelled before any data crosses the application boundary.
