# Converter

A local-first developer workbench for formatting, validating, encoding, and converting data. The current release includes functional JSON, XML, CSV/spreadsheet, Markdown document, Base64, URL, timestamp, JWT inspection, and SHA-2 hashing tools, plus a searchable registry, keyboard command palette, themes, downloadable outputs, and privacy-visible processing indicators.

The spreadsheet workbench currently handles CSV/TSV delimiter conversion and inspection; XLSX workbook support remains a separate milestone. The document workbench produces safe semantic HTML and print previews; DOCX/PDF archive generation remains a separate milestone.

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
