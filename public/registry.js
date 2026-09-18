// The tool catalogue. Every entry is data: metadata, the option controls it
// needs, and one `run` function. The interface is generated from this file, so
// adding a tool never means touching the UI.

import { formatBytes, textToBytes, bytesToText, encodeBase64, decodeBase64, normalizeBase64, validateBase64, bytesToBase64, base64ToBytes, bytesToHex, hexToBytes, bytesToBase32, base32ToBytes, bytesToBase58, base58ToBytes, hexdump } from "./lib/bytes.js";
import { jsonTransform, jsonError, jsonDiff, jsonQuery, jsonToTypeScript, jsonToGo, jsonToSchema, jsonToSql, toNdjson, fromNdjson, indentOf } from "./lib/json.js";
import { parseYaml, stringifyYaml } from "./lib/yaml.js";
import { parseToml, stringifyToml } from "./lib/toml.js";
import { formatXml, minifyXml, validateXml, xmlToJson, jsonToXml } from "./lib/xml.js";
import { parseCsv, detectDelimiter, serializeRows, csvToJson, jsonToCsv, csvToMarkdown, csvToSql } from "./lib/csv.js";
import * as text from "./lib/text.js";
import * as crypt from "./lib/crypto.js";
import * as ids from "./lib/ids.js";
import * as color from "./lib/color.js";
import * as net from "./lib/net.js";
import * as maths from "./lib/mathx.js";
import * as when from "./lib/datetime.js";
import * as markup from "./lib/markup.js";
import * as office from "./lib/office.js";
import * as qr from "./lib/qrcode.js";
import * as reference from "./lib/reference.js";
import * as images from "./lib/image.js";

const INDENT_FIELD = { id: "indent", type: "select", label: "Indent", value: "2", options: ["2", "4", "tab"], labels: { 2: "2 spaces", 4: "4 spaces", tab: "Tab" } };

function requireFile(file, extension) {
  if (!file) throw new Error(`Open a ${extension} file first — use the Open file button above.`);
  if (extension && !new RegExp(`\\.(${extension})$`, "i").test(file.name)) throw new Error(`That is a ${file.name.split(".").pop()} file — this action needs a ${extension} file.`);
  return file;
}

function blobFor(content, type) {
  return new Blob([content], { type });
}


/** A block of sample text on the chosen background, at the sizes WCAG cares about. */
function contrastPreview(foreground, background) {
  const safe = (value) => String(value).replace(/[^#\w(),.%\s-]/g, "");
  return `<div style="background:${safe(background)};color:${safe(foreground)};padding:32px;border-radius:14px;">
    <p style="font-size:28px;font-weight:700;margin:0 0 14px;">Large text, 28px bold</p>
    <p style="font-size:19px;margin:0 0 14px;">Large text, 19px regular</p>
    <p style="font-size:16px;margin:0 0 14px;">Body text at 16px — the size most interfaces use for reading.</p>
    <p style="font-size:13px;margin:0;">Small print at 13px, the hardest case to get right.</p>
  </div>`;
}

function swatchPreview(hex) {
  const safe = String(hex).replace(/[^#\w]/g, "");
  return `<div style="display:grid;place-items:center;gap:18px;">
    <div style="width:220px;height:220px;border-radius:24px;background:${safe};box-shadow:0 18px 50px #0003;"></div>
    <code style="font-size:18px;letter-spacing:0.04em;">${safe}</code>
  </div>`;
}

/* ================================================================ JSON === */

const jsonTools = [
  {
    id: "json", name: "JSON Formatter", icon: "{ }", blurb: "Pretty-print, minify, sort, and validate JSON with line-accurate errors.",
    keywords: ["pretty", "beautify", "prettify", "lint", "validate", "minify"],
    actions: ["format", "minify", "sort keys", "validate", "escape", "unescape"],
    fields: [{ ...INDENT_FIELD, when: ["format", "sort keys", "unescape"] }],
    input: { sample: '{"project":"converter","private":true,"tags":["local","fast"],"limits":{"upload":0,"tools":92}}', placeholder: "Paste JSON here…" },
    output: { filename: "formatted.json" },
    live: true,
    run: ({ input, action, options }) => {
      if (action === "escape") return JSON.stringify(input);
      if (action === "unescape") {
        const value = JSON.parse(/^\s*"/.test(input) ? input : JSON.stringify(input));
        return typeof value === "string" ? value : JSON.stringify(value, null, indentOf(options.indent));
      }
      return jsonTransform(input, action === "sort keys" ? "sort" : action, options.indent);
    },
    describeError: (error, input) => jsonError(error, input),
  },
  {
    id: "json-query", name: "JSON Query", icon: "$.", blurb: "Pull values out of a document with JSONPath: wildcards, slices, and recursive descent.",
    keywords: ["jsonpath", "search", "filter", "extract", "select"],
    fields: [{ id: "path", type: "text", label: "Path", value: "$..name", placeholder: "$.users[*].name" }, INDENT_FIELD],
    input: { sample: '{"users":[{"id":1,"name":"Ada","roles":["dev"]},{"id":2,"name":"Lin","roles":["qa","dev"]}],"total":2}' },
    output: { filename: "query-result.json" },
    live: true,
    run: ({ input, options }) => jsonQuery(input, options.path, options.indent),
  },
  {
    id: "json-diff", name: "JSON Diff", icon: "±", blurb: "Compare two documents structurally and list every added, removed, and changed path.",
    keywords: ["compare", "difference", "changes", "delta"],
    input: { label: "Original", sample: '{"name":"converter","version":"0.9.0","tools":9,"tags":["local"]}' },
    secondary: { label: "Changed", sample: '{"name":"converter","version":"1.0.0","tools":92,"tags":["local","fast"],"license":"MIT"}' },
    output: { filename: "json-diff.txt", diff: true },
    live: true,
    run: ({ input, secondary }) => jsonDiff(input, secondary),
  },
  {
    id: "json-typescript", name: "JSON to TypeScript", icon: "TS", blurb: "Generate interfaces, merging the shapes of array members into optional members.",
    keywords: ["interface", "types", "typescript", "codegen", "d.ts"],
    fields: [{ id: "root", type: "text", label: "Root name", value: "Root", placeholder: "Root" }],
    input: { sample: '{"id":1,"name":"Ada","active":true,"scores":[9.5,8],"team":{"id":7,"name":"Core"}}' },
    output: { filename: "types.ts" },
    live: true,
    run: ({ input, options }) => jsonToTypeScript(input, options.root || "Root"),
  },
  {
    id: "json-go", name: "JSON to Go", icon: "Go", blurb: "Generate gofmt-aligned structs with json tags and pointers for optional fields.",
    keywords: ["golang", "struct", "codegen", "tags"],
    fields: [{ id: "root", type: "text", label: "Root name", value: "Root" }],
    input: { sample: '{"id":1,"name":"Ada","active":true,"scores":[9.5,8],"team":{"id":7,"name":"Core"}}' },
    output: { filename: "types.go" },
    live: true,
    run: ({ input, options }) => jsonToGo(input, options.root || "Root"),
  },
  {
    id: "json-schema", name: "JSON to Schema", icon: "◇", blurb: "Infer a draft 2020-12 schema, including string formats and required members.",
    keywords: ["jsonschema", "validation", "draft", "contract"],
    fields: [{ id: "root", type: "text", label: "Title", value: "Root" }],
    input: { sample: '{"id":1,"email":"ada@example.com","created":"2026-09-18T10:00:00Z","tags":["a","b"]}' },
    output: { filename: "schema.json" },
    live: true,
    run: ({ input, options }) => jsonToSchema(input, options.root || "Root"),
  },
  {
    id: "json-sql", name: "JSON to SQL", icon: "DB", blurb: "Turn records into a CREATE TABLE and matching INSERT statements.",
    keywords: ["insert", "create table", "postgres", "mysql", "seed"],
    fields: [
      { id: "table", type: "text", label: "Table", value: "records" },
      { id: "dialect", type: "select", label: "Dialect", value: "postgresql", options: ["postgresql", "mysql"] },
    ],
    input: { sample: '[{"id":1,"name":"Ada","active":true},{"id":2,"name":"Lin","active":false}]' },
    output: { filename: "insert.sql" },
    live: true,
    run: ({ input, options }) => jsonToSql(input, options.table || "records", options.dialect),
  },
  {
    id: "ndjson", name: "JSON and NDJSON", icon: "⋮", blurb: "Flatten an array into newline-delimited records, or gather records back into an array.",
    keywords: ["jsonlines", "jsonl", "ldjson", "stream", "bigquery"],
    actions: ["to ndjson", "to json array"],
    fields: [{ ...INDENT_FIELD, when: ["to json array"] }],
    input: {
      sample: '[{"id":1,"event":"open"},{"id":2,"event":"close"}]',
      samples: { "to json array": '{"id":1,"event":"open"}\n{"id":2,"event":"close"}' },
    },
    output: { filename: "records.ndjson" },
    live: true,
    run: ({ input, action, options }) => (action === "to ndjson" ? toNdjson(input) : fromNdjson(input, options.indent)),
  },
];

/* ========================================================== converters === */

const converterTools = [
  {
    id: "json-yaml", name: "JSON and YAML", icon: "Y", blurb: "Convert either way, keeping comments out and block scalars intact.",
    keywords: ["yml", "config", "kubernetes", "compose"],
    actions: ["json to yaml", "yaml to json"],
    fields: [{ ...INDENT_FIELD, when: ["yaml to json"] }],
    input: {
      sample: '{"name":"converter","services":{"web":{"image":"node:22","ports":[3000]}},"notes":"Runs locally"}',
      samples: { "yaml to json": "name: converter\nservices:\n  web:\n    image: node:22\n    ports:\n      - 3000\nnotes: Runs locally" },
    },
    output: { filename: "converted.yaml" },
    live: true,
    run: ({ input, action, options }) => (action === "json to yaml"
      ? stringifyYaml(JSON.parse(input))
      : JSON.stringify(parseYaml(input), null, indentOf(options.indent))),
  },
  {
    id: "json-toml", name: "JSON and TOML", icon: "T", blurb: "Round-trip tables, arrays of tables, dotted keys, and typed values.",
    keywords: ["cargo", "pyproject", "config", "ini"],
    actions: ["json to toml", "toml to json"],
    fields: [{ ...INDENT_FIELD, when: ["toml to json"] }],
    input: {
      sample: '{"package":{"name":"converter","version":"0.2.0"},"dependencies":{"serde":{"version":"1.0","features":["derive"]}}}',
      samples: { "toml to json": '[package]\nname = "converter"\nversion = "0.2.0"\n\n[dependencies.serde]\nversion = "1.0"\nfeatures = ["derive"]' },
    },
    output: { filename: "converted.toml" },
    live: true,
    run: ({ input, action, options }) => (action === "json to toml"
      ? stringifyToml(JSON.parse(input))
      : JSON.stringify(parseToml(input), null, indentOf(options.indent))),
  },
  {
    id: "json-xml", name: "JSON and XML", icon: "</>", blurb: "Map attributes to @-prefixed members and back, with entities safely resolved.",
    keywords: ["soap", "rss", "feed", "attributes"],
    actions: ["json to xml", "xml to json"],
    fields: [{ ...INDENT_FIELD, when: ["xml to json"] }],
    input: {
      sample: '{"catalog":{"@count":"2","item":[{"@id":"1","name":"Local tools"},{"@id":"2","name":"Fast"}]}}',
      samples: { "xml to json": '<catalog count="2"><item id="1"><name>Local tools</name></item><item id="2"><name>Fast</name></item></catalog>' },
    },
    output: { filename: "converted.xml" },
    live: true,
    run: ({ input, action, options }) => (action === "json to xml" ? jsonToXml(input) : xmlToJson(input, options.indent)),
  },
  {
    id: "json-csv", name: "JSON and CSV", icon: "▦", blurb: "Flatten records into delimited text, or read a sheet back into typed JSON.",
    keywords: ["tsv", "spreadsheet", "records", "table"],
    actions: ["json to csv", "csv to json"],
    fields: [
      { id: "delimiter", type: "select", label: "Delimiter", value: "auto", options: ["auto", ",", ";", "\t", "|"], labels: { auto: "Detect", ",": "Comma", ";": "Semicolon", "\t": "Tab", "|": "Pipe" } },
      { id: "header", type: "toggle", label: "First row is a header", value: true },
      { id: "typed", type: "toggle", label: "Infer numbers and booleans", value: true, when: ["csv to json"] },
    ],
    input: {
      sample: '[{"id":1,"name":"Ada","active":true},{"id":2,"name":"Lin","active":false}]',
      samples: { "csv to json": "id,name,active\n1,Ada,true\n2,Lin,false" },
    },
    output: { filename: "converted.csv" },
    live: true,
    run: ({ input, action, options }) => {
      if (action === "json to csv") return jsonToCsv(input, { delimiter: options.delimiter === "auto" ? "," : options.delimiter, header: options.header });
      return csvToJson(input, { delimiter: options.delimiter, header: options.header, typed: options.typed });
    },
  },
  {
    id: "yaml-toml", name: "YAML and TOML", icon: "⇄", blurb: "Move configuration between the two formats without a JSON detour.",
    keywords: ["config", "convert", "settings"],
    actions: ["yaml to toml", "toml to yaml"],
    input: {
      sample: "name: converter\nversion: 0.2.0\nfeatures:\n  - local\n  - fast\nlimits:\n  upload: 0",
      samples: { "toml to yaml": 'name = "converter"\nversion = "0.2.0"\nfeatures = ["local", "fast"]\n\n[limits]\nupload = 0' },
    },
    output: { filename: "converted.toml" },
    live: true,
    run: ({ input, action }) => (action === "yaml to toml" ? stringifyToml(parseYaml(input)) : stringifyYaml(parseToml(input))),
  },
  {
    id: "csv-convert", name: "CSV Converter", icon: "⊞", blurb: "Re-delimit a sheet or turn it into a Markdown table, JSON, or SQL inserts.",
    keywords: ["tsv", "markdown table", "delimiter", "insert"],
    actions: ["change delimiter", "to markdown table", "to json", "to sql"],
    fields: [
      { id: "from", type: "select", label: "Input delimiter", value: "auto", options: ["auto", ",", ";", "\t", "|"], labels: { auto: "Detect", ",": "Comma", ";": "Semicolon", "\t": "Tab", "|": "Pipe" } },
      { id: "to", type: "select", label: "Output delimiter", value: "\t", options: [",", ";", "\t", "|"], labels: { ",": "Comma", ";": "Semicolon", "\t": "Tab", "|": "Pipe" }, when: ["change delimiter"] },
      { id: "table", type: "text", label: "Table name", value: "records", when: ["to sql"] },
    ],
    input: { sample: "id,name,role\n1,Ada,Engineer\n2,Lin,QA\n3,Zoë,\"Design, Lead\"" },
    output: { filename: "converted.txt" },
    live: true,
    run: ({ input, action, options }) => {
      if (action === "to markdown table") return csvToMarkdown(input, { delimiter: options.from });
      if (action === "to json") return csvToJson(input, { delimiter: options.from });
      if (action === "to sql") return csvToSql(input, { table: options.table || "records", delimiter: options.from });
      const delimiter = options.from === "auto" ? detectDelimiter(input) : options.from;
      return serializeRows(parseCsv(input, delimiter), options.to);
    },
  },
  {
    id: "xml", name: "XML Toolkit", icon: "≺≻", blurb: "Format, minify, and validate XML. DOCTYPE and external entities are refused.",
    keywords: ["pretty", "beautify", "soap", "xsd", "validate"],
    actions: ["format", "minify", "validate"],
    fields: [{ id: "indent", type: "select", label: "Indent", value: "2", options: ["2", "4", "tab"], labels: { 2: "2 spaces", 4: "4 spaces", tab: "Tab" }, when: ["format"] }],
    input: { sample: '<catalog count="2"><item id="1"><name>Local tools</name><price>9.50</price></item><item id="2"><name>Fast</name></item></catalog>' },
    output: { filename: "formatted.xml" },
    live: true,
    run: ({ input, action, options }) => {
      if (action === "minify") return minifyXml(input);
      if (action === "validate") return validateXml(input);
      return formatXml(input, options.indent === "tab" ? "\t" : " ".repeat(Number(options.indent)));
    },
  },
  {
    id: "markdown-html", name: "Markdown and HTML", icon: "M↓", blurb: "Render Markdown to HTML — tables, task lists, fenced code — or convert HTML back.",
    keywords: ["commonmark", "readme", "render", "gfm"],
    actions: ["markdown to html", "html to markdown"],
    input: {
      sample: "# Release notes\n\nConverter keeps **everything** local.\n\n- [x] Offline\n- [ ] Cloud\n\n| Tool | Count |\n| --- | ---: |\n| Local | 92 |\n\n> No uploads, ever.",
      samples: { "html to markdown": "<h1>Release notes</h1>\n<p>Converter keeps <strong>everything</strong> local.</p>\n<ul><li>Offline</li><li>No accounts</li></ul>\n<blockquote><p>No uploads, ever.</p></blockquote>" },
    },
    output: { filename: "converted.html", preview: true },
    live: true,
    run: ({ input, action }) => (action === "markdown to html" ? markup.markdownToHtml(input) : markup.htmlToMarkdown(input)),
  },
  {
    id: "html-text", name: "HTML to Text", icon: "¶", blurb: "Strip tags and scripts, leaving readable plain text with block breaks intact.",
    keywords: ["strip tags", "plain", "sanitise", "extract"],
    input: { sample: "<article><h1>Title</h1><p>Some <b>bold</b> copy with a <a href='#'>link</a>.</p><script>track()</script></article>" },
    output: { filename: "text.txt" },
    live: true,
    run: ({ input }) => markup.stripTags(input),
  },
  {
    id: "list", name: "List Converter", icon: "≡", blurb: "Turn lines into a delimited list or split a delimited list back into lines.",
    keywords: ["join", "split", "comma", "array", "in clause"],
    actions: ["lines to list", "list to lines", "lines to json array", "lines to sql in"],
    fields: [{ id: "separator", type: "text", label: "Separator", value: ", ", placeholder: ", or \\n or \\t" }],
    input: {
      sample: "alpha\nbeta\ngamma\ndelta",
      samples: { "list to lines": "alpha, beta, gamma, delta" },
    },
    output: { filename: "list.txt" },
    live: true,
    run: ({ input, action, options }) => {
      if (action === "list to lines") return text.splitOn(input, options.separator || ",");
      const lines = input.split("\n").map((line) => line.trim()).filter(Boolean);
      if (action === "lines to json array") return JSON.stringify(lines, null, 2);
      if (action === "lines to sql in") return `IN (${lines.map((line) => `'${line.replaceAll("'", "''")}'`).join(", ")})`;
      return text.joinLines(input, options.separator || ", ");
    },
  },
];

/* ================================================================ text === */

const textTools = [
  {
    id: "case", layout: "stack", name: "Case Converter", icon: "Aa", blurb: "Rewrite identifiers in every convention at once, or pick a single style.",
    keywords: ["camelcase", "snake_case", "kebab", "pascal", "title", "constant"],
    actions: ["all styles", ...Object.keys(text.CASE_STYLES)],
    input: { sample: "convert anything keep everything private" },
    output: { filename: "cases.txt" },
    live: true,
    run: ({ input, action }) => (action === "all styles" ? text.allCases(input) : text.convertCase(input, action)),
  },
  {
    id: "slugify", layout: "stack", name: "Slugify", icon: "/", blurb: "Build URL-safe slugs: accents folded, punctuation dropped, separators collapsed.",
    keywords: ["url", "permalink", "seo", "kebab", "handle"],
    fields: [
      { id: "separator", type: "select", label: "Separator", value: "-", options: ["-", "_", "."], labels: { "-": "Hyphen", _: "Underscore", ".": "Dot" } },
      { id: "lowercase", type: "toggle", label: "Lowercase", value: true },
      { id: "maxLength", type: "number", label: "Max length", value: 0, min: 0, max: 200, help: "0 means no limit" },
    ],
    input: { sample: "Héllo Wörld! — Converter 2026 edition" },
    output: { filename: "slug.txt" },
    live: true,
    run: ({ input, options }) => input.split("\n").map((line) => text.slugify(line, options)).join("\n"),
  },
  {
    id: "text-diff", name: "Text Diff", icon: "⇋", blurb: "Line or word level comparison with a unified listing and change counts.",
    keywords: ["compare", "changes", "merge", "patch"],
    fields: [
      { id: "mode", type: "select", label: "Granularity", value: "lines", options: ["lines", "words"] },
      { id: "ignoreCase", type: "toggle", label: "Ignore case", value: false },
      { id: "ignoreWhitespace", type: "toggle", label: "Ignore whitespace", value: false },
    ],
    input: { label: "Original", sample: "The quick brown fox\njumps over\nthe lazy dog" },
    secondary: { label: "Changed", sample: "The quick brown fox\nleaps over\nthe lazy dog\nand runs away" },
    output: { filename: "diff.txt", diff: true },
    live: true,
    run: ({ input, secondary, options }) => {
      const ratio = text.similarityRatio(input, secondary);
      return `Similarity ${(ratio * 100).toFixed(1)}%\n\n${text.diffText(input, secondary, options)}`;
    },
  },
  {
    id: "text-stats", layout: "stack", name: "Text Statistics", icon: "Σ", blurb: "Counts, reading time, and word frequency for any block of prose.",
    keywords: ["word count", "characters", "reading time", "frequency"],
    input: { sample: "The quick brown fox jumps over the lazy dog. The dog sleeps on." },
    output: { filename: "statistics.txt" },
    live: true,
    run: ({ input }) => text.textStatistics(input),
  },
  {
    id: "lines", name: "Line Tools", icon: "⇅", blurb: "Sort, deduplicate, shuffle, number, trim, and count lines.",
    keywords: ["sort", "unique", "dedupe", "shuffle", "number"],
    actions: Object.keys(text.LINE_OPERATIONS),
    input: { sample: "banana\napple\ncherry\napple\n\ndate" },
    output: { filename: "lines.txt" },
    live: true,
    run: ({ input, action }) => text.transformLines(input, action),
  },
  {
    id: "find-replace", name: "Find and Replace", icon: "⌕", blurb: "Plain or regular-expression replacement with capture groups and a match count.",
    keywords: ["search", "substitute", "sed", "regex", "rename"],
    fields: [
      { id: "search", type: "text", label: "Find", value: "fox", placeholder: "text or pattern" },
      { id: "replacement", type: "text", label: "Replace with", value: "cat", placeholder: "$1 for capture groups" },
      { id: "regex", type: "toggle", label: "Regular expression", value: false },
      { id: "flags", type: "text", label: "Flags", value: "g", placeholder: "g i m s" },
    ],
    input: { sample: "The quick brown fox jumps over the lazy fox." },
    output: { filename: "replaced.txt" },
    live: true,
    run: ({ input, options }) => {
      const result = text.findReplace(input, options.search, options.replacement, { regex: options.regex, flags: options.flags || "g" });
      return { text: result.output, note: `${result.count} replacement${result.count === 1 ? "" : "s"}` };
    },
  },
  {
    id: "regex", name: "Regex Tester", icon: ".*", blurb: "Run a pattern over a subject and see every match, position, and capture group.",
    keywords: ["regular expression", "match", "capture", "pattern", "test"],
    fields: [
      { id: "pattern", type: "text", label: "Pattern", value: "(\\w+)@(\\w+\\.\\w+)", placeholder: "\\d{4}-\\d{2}-\\d{2}" },
      { id: "flags", type: "text", label: "Flags", value: "g", placeholder: "g i m s u y" },
    ],
    input: { sample: "Contact ada@example.com or lin@converter.dev for access." },
    output: { filename: "matches.txt" },
    live: true,
    run: ({ input, options }) => text.testRegex(options.pattern, options.flags, input),
  },
  {
    id: "lorem", name: "Lorem Ipsum", icon: "¶", blurb: "Placeholder copy by word, sentence, or paragraph.",
    keywords: ["placeholder", "dummy text", "filler", "mock"],
    fields: [
      { id: "units", type: "select", label: "Generate", value: "paragraphs", options: ["paragraphs", "sentences", "words"] },
      { id: "count", type: "number", label: "How many", value: 3, min: 1, max: 200 },
      { id: "startWithLorem", type: "toggle", label: "Start with “Lorem ipsum”", value: true },
    ],
    input: { hidden: true },
    output: { filename: "lorem.txt" },
    run: ({ options }) => text.loremIpsum(options),
  },
  {
    id: "wrap", name: "Wrap and Unwrap", icon: "↵", blurb: "Hard-wrap prose to a column width, or join wrapped lines back together.",
    keywords: ["line length", "reflow", "80 columns", "format"],
    actions: ["wrap", "unwrap"],
    fields: [{ id: "width", type: "number", label: "Width", value: 80, min: 10, max: 400, when: ["wrap"] }],
    input: { sample: "Converter is a local-first workbench for the formats developers touch every day, and nothing you paste ever leaves the browser tab you are looking at." },
    output: { filename: "wrapped.txt" },
    live: true,
    run: ({ input, action, options }) => (action === "wrap" ? text.wrapText(input, options.width) : input.split(/\n{2,}/).map((block) => block.replace(/\n/g, " ")).join("\n\n")),
  },
  {
    id: "reverse", name: "Reverse Text", icon: "↔", blurb: "Flip characters, words, or line order.",
    keywords: ["mirror", "backwards", "flip"],
    actions: ["characters", "words", "lines"],
    input: { sample: "Converter keeps everything private" },
    output: { filename: "reversed.txt" },
    live: true,
    run: ({ input, action }) => text.reverseText(input, action),
  },
  {
    id: "obfuscate", name: "Mask Secrets", icon: "•••", blurb: "Hide the middle of tokens and keys so they are safe to paste into a ticket.",
    keywords: ["redact", "mask", "hide", "anonymise", "secret"],
    fields: [
      { id: "keepStart", type: "number", label: "Keep at start", value: 4, min: 0, max: 40 },
      { id: "keepEnd", type: "number", label: "Keep at end", value: 4, min: 0, max: 40 },
      { id: "mask", type: "text", label: "Mask character", value: "*" },
    ],
    input: { sample: "sk-live-9f3b2a71c4d85e60\nAKIAIOSFODNN7EXAMPLE" },
    output: { filename: "masked.txt" },
    live: true,
    run: ({ input, options }) => text.obfuscate(input, options),
  },
  {
    id: "nato", layout: "stack", name: "NATO and Morse", icon: "▁▄", blurb: "Spell text out phonetically, or encode and decode Morse code.",
    keywords: ["phonetic", "alfa", "bravo", "radio", "spelling"],
    actions: ["nato alphabet", "to morse", "from morse", "numeronym"],
    input: {
      sample: "SOS help",
      samples: { "from morse": "... --- ... / .... . .-.. .--." },
    },
    output: { filename: "spelled.txt" },
    live: true,
    run: ({ input, action }) => {
      if (action === "to morse") return text.toMorse(input);
      if (action === "from morse") return text.fromMorse(input);
      if (action === "numeronym") return text.numeronym(input);
      return text.toNatoAlphabet(input);
    },
  },
];

/* ============================================================ encoding === */

const encodingTools = [
  {
    id: "base64", name: "Base64 Studio", icon: "64", blurb: "Encode, decode, normalise, and validate Base64 and Base64URL with real diagnostics.",
    keywords: ["base64url", "btoa", "atob", "encode", "decode", "padding"],
    actions: ["encode", "decode", "validate", "normalise", "parse data uri"],
    fields: [
      { id: "variant", type: "select", label: "Alphabet", value: "standard", options: ["standard", "url"], labels: { standard: "Standard (+/)", url: "URL safe (-_)" }, when: ["encode", "normalise"] },
      { id: "padding", type: "toggle", label: "Include padding", value: true, when: ["encode"] },
    ],
    input: {
      sample: "Private by default. Fast by design.",
      samples: {
        decode: "UHJpdmF0ZSBieSBkZWZhdWx0LiBGYXN0IGJ5IGRlc2lnbi4=",
        validate: "UHJpdmF0ZSBieSBkZWZhdWx0LiBGYXN0IGJ5IGRlc2lnbi4=",
        "normalise": "UHJpdmF0ZSBieSBkZWZhdWx0LiBGYXN0IGJ5IGRlc2lnbi4",
        "parse data uri": "data:text/plain;charset=utf-8;base64,SGVsbG8sIENvbnZlcnRlcg==",
      },
    },
    output: { filename: "base64.txt" },
    live: true,
    run: ({ input, action, options }) => {
      const urlSafe = options.variant === "url";
      if (action === "encode") return encodeBase64(input, urlSafe, options.padding);
      if (action === "decode") return decodeBase64(input);
      if (action === "normalise") return normalizeBase64(input, urlSafe);
      if (action === "validate") {
        const result = validateBase64(input.trim());
        return `${result.valid ? "Valid" : "Invalid"}\nReason      ${result.reason}${result.variant ? `\nAlphabet    ${result.variant}` : ""}\nLength      ${input.trim().length} characters\nDecodes to  ${result.valid ? `${Math.floor((input.trim().replace(/=+$/, "").length * 3) / 4)} bytes` : "—"}`;
      }
      const parsed = parseDataUriSafely(input);
      return `Media type  ${parsed.mediaType}\nParameters  ${parsed.parameters.join("; ") || "—"}\nEncoding    ${parsed.isBase64 ? "base64" : "percent"}\nSize        ${formatBytes(textToBytes(parsed.payload).length)}\n\n${parsed.payload}`;
    },
  },
  {
    id: "base64-file", name: "File to Base64", icon: "⇪", blurb: "Encode any local file, or decode Base64 back into a downloadable file.",
    keywords: ["binary", "attachment", "upload", "embed", "data uri"],
    actions: ["file to base64", "file to data uri", "base64 to file"],
    fields: [
      { id: "wrap", type: "toggle", label: "Wrap at 76 columns", value: false, when: ["file to base64"] },
      { id: "filename", type: "text", label: "Output file name", value: "decoded.bin", when: ["base64 to file"] },
    ],
    input: { accept: "*/*", sample: "", placeholder: "Open a file above, or paste Base64 to decode…" },
    output: { filename: "encoded.txt" },
    run: async ({ input, action, file, options }) => {
      if (action === "base64 to file") {
        const bytes = base64ToBytes(input.trim());
        return {
          text: `Decoded ${formatBytes(bytes.length)}\n\n${hexdump(bytes.subarray(0, 256))}${bytes.length > 256 ? "\n…" : ""}`,
          download: { blob: blobFor(bytes, "application/octet-stream"), name: "decoded.bin" },
        };
      }
      requireFile(file);
      const bytes = new Uint8Array(file.buffer);
      const base64 = bytesToBase64(bytes);
      if (action === "file to data uri") {
        const uri = `data:${file.type || "application/octet-stream"};base64,${base64}`;
        return { text: uri, note: `${formatBytes(uri.length)} encoded from ${formatBytes(bytes.length)}` };
      }
      const wrapped = options.wrap ? base64.replace(/.{76}/g, "$&\n") : base64;
      return { text: wrapped, note: `${formatBytes(bytes.length)} → ${formatBytes(base64.length)}` };
    },
  },
  {
    id: "base32", name: "Base32", icon: "32", blurb: "RFC 4648, extended hex, and Crockford alphabets.",
    keywords: ["rfc4648", "crockford", "totp", "otp", "encode"],
    actions: ["encode", "decode"],
    fields: [
      { id: "variant", type: "select", label: "Alphabet", value: "rfc4648", options: ["rfc4648", "hex", "crockford"], labels: { rfc4648: "RFC 4648", hex: "Extended hex", crockford: "Crockford" } },
      { id: "padding", type: "toggle", label: "Include padding", value: true, when: ["encode"] },
    ],
    input: { sample: "Converter", samples: { decode: "INZWK5DJMVWGYZI=" } },
    output: { filename: "base32.txt" },
    live: true,
    run: ({ input, action, options }) => (action === "encode"
      ? bytesToBase32(textToBytes(input), options)
      : bytesToText(base32ToBytes(input, options))),
  },
  {
    id: "base58", name: "Base58", icon: "58", blurb: "The Bitcoin alphabet — no look-alike characters, useful for short identifiers.",
    keywords: ["bitcoin", "btc", "ipfs", "identifier"],
    actions: ["encode", "decode"],
    input: { sample: "Hello World!", samples: { decode: "2NEpo7TZRRrLZSi2U" } },
    output: { filename: "base58.txt" },
    live: true,
    run: ({ input, action }) => (action === "encode" ? bytesToBase58(textToBytes(input)) : bytesToText(base58ToBytes(input.trim()))),
  },
  {
    id: "hex", name: "Hex and Binary", icon: "0x", blurb: "Move text between hexadecimal, binary, decimal bytes, and a classic hex dump.",
    keywords: ["hexadecimal", "bytes", "dump", "binary", "ascii"],
    actions: ["text to hex", "hex to text", "text to binary", "binary to text", "hex dump"],
    fields: [
      { id: "separator", type: "select", label: "Separator", value: " ", options: ["", " ", ":", "-"], labels: { "": "None", " ": "Space", ":": "Colon", "-": "Hyphen" }, when: ["text to hex"] },
      { id: "upper", type: "toggle", label: "Uppercase", value: false, when: ["text to hex"] },
    ],
    input: {
      sample: "Converter",
      samples: { "hex to text": "43 6f 6e 76 65 72 74 65 72", "binary to text": "01000011 01101111 01101110 01110110 01100101 01110010 01110100 01100101 01110010" },
    },
    output: { filename: "hex.txt" },
    live: true,
    run: ({ input, action, options }) => {
      if (action === "hex to text") return bytesToText(hexToBytes(input));
      if (action === "text to binary") return [...textToBytes(input)].map((byte) => byte.toString(2).padStart(8, "0")).join(" ");
      if (action === "binary to text") {
        const bits = input.replace(/[^01]/g, "");
        if (!bits || bits.length % 8 !== 0) throw new Error("Binary input must be a whole number of 8-bit bytes");
        return bytesToText(Uint8Array.from(bits.match(/.{8}/g), (byte) => Number.parseInt(byte, 2)));
      }
      if (action === "hex dump") return hexdump(textToBytes(input));
      return bytesToHex(textToBytes(input), options);
    },
  },
  {
    id: "url", name: "URL Encoder", icon: "%", blurb: "Percent-encode a component or a whole URI, and decode either back.",
    keywords: ["percent", "escape", "querystring", "uri", "encodeuricomponent"],
    actions: ["encode component", "decode component", "encode uri", "decode uri"],
    input: { sample: "https://example.com/search?q=local tools&sort=new#résultats" },
    output: { filename: "url.txt" },
    live: true,
    run: ({ input, action }) => {
      const value = input.trim();
      if (action === "decode component") return decodeURIComponent(value);
      if (action === "decode uri") return decodeURI(value);
      if (action === "encode uri") return encodeURI(value);
      return encodeURIComponent(value);
    },
  },
  {
    id: "html-entities", name: "HTML Entities", icon: "&", blurb: "Escape markup for safe output, or resolve entities back into characters.",
    keywords: ["escape", "unescape", "amp", "nbsp", "xss"],
    actions: ["escape", "unescape"],
    fields: [{ id: "mode", type: "select", label: "Escape", value: "minimal", options: ["minimal", "non-ascii", "all named"], labels: { minimal: "Markup characters only", "non-ascii": "Markup plus non-ASCII", "all named": "Every named entity" }, when: ["escape"] }],
    input: {
      sample: '<a href="x">Ada & Lin — “quoted”</a>',
      samples: { unescape: "&lt;a href=&quot;x&quot;&gt;Ada &amp; Lin &mdash; &#8220;quoted&#8221;&lt;/a&gt;" },
    },
    output: { filename: "entities.txt" },
    live: true,
    run: ({ input, action, options }) => (action === "escape" ? markup.escapeHtml(input, options) : markup.unescapeHtml(input)),
  },
  {
    id: "escape", name: "String Escaper", icon: "\\n", blurb: "Escape a value for JavaScript, JSON, SQL, a shell, a regex, CSV, C, or XML.",
    keywords: ["quote", "literal", "injection", "sanitise", "shell"],
    actions: ["escape", "unescape"],
    fields: [{ id: "language", type: "select", label: "Target", value: "javascript string", options: ["javascript string", "json string", "html attribute", "sql literal", "shell single quote", "regular expression", "csv field", "url component", "c string", "xml text"] }],
    input: {
      sample: "it's a \"test\"\nwith a newline",
      samples: { unescape: '"it\'s a \\"test\\"\\nwith a newline"' },
    },
    output: { filename: "escaped.txt" },
    live: true,
    run: ({ input, action, options }) => (action === "escape" ? markup.escapeForLanguage(input, options.language) : markup.unescapeFromLanguage(input, options.language)),
  },
  {
    id: "data-uri", name: "Data URI", icon: "◧", blurb: "Build a data: URI from text, or take one apart and report its payload.",
    keywords: ["inline", "base64", "css", "embed", "img src"],
    actions: ["build", "parse"],
    fields: [
      { id: "mediaType", type: "text", label: "Media type", value: "text/plain", when: ["build"] },
      { id: "base64", type: "toggle", label: "Base64 encode", value: true, when: ["build"] },
    ],
    input: {
      sample: "Converter keeps everything local.",
      samples: { parse: "data:text/plain;charset=utf-8;base64,Q29udmVydGVyIGtlZXBzIGV2ZXJ5dGhpbmcgbG9jYWwu" },
    },
    output: { filename: "data-uri.txt" },
    live: true,
    run: ({ input, action, options }) => {
      if (action === "parse") {
        const parsed = parseDataUriSafely(input);
        return `Media type  ${parsed.mediaType}\nParameters  ${parsed.parameters.join("; ") || "—"}\nEncoding    ${parsed.isBase64 ? "base64" : "percent"}\nPayload     ${formatBytes(textToBytes(parsed.payload).length)}\n\n${parsed.payload}`;
      }
      const payload = options.base64 ? encodeBase64(input) : encodeURIComponent(input);
      return `data:${options.mediaType || "text/plain"}${options.base64 ? ";base64" : ""},${payload}`;
    },
  },
  {
    id: "punycode", name: "Punycode and IDN", icon: "ᴜ", blurb: "Convert internationalised domain names to their ASCII form and back.",
    keywords: ["idn", "domain", "unicode", "xn--", "homograph"],
    actions: ["to ascii", "to unicode"],
    input: { sample: "münchen.example", samples: { "to unicode": "xn--mnchen-3ya.example" } },
    output: { filename: "domain.txt" },
    live: true,
    run: ({ input, action }) => {
      const value = input.trim();
      if (!value) throw new Error("Enter a domain name");
      if (action === "to ascii") {
        const url = new URL(`https://${value.replace(/^https?:\/\//, "")}`);
        const ascii = url.hostname;
        const mixed = /[^\x00-\x7f]/.test(value) && /^[\x00-\x7f]*$/.test(ascii);
        return `${ascii}${mixed ? `\n\nThis name contains non-ASCII characters; browsers show the Unicode form but resolve the ASCII one.` : ""}`;
      }
      return value.split(".").map((label) => (label.startsWith("xn--") ? decodePunycode(label.slice(4)) : label)).join(".");
    },
  },
  {
    id: "cipher", name: "Classic Ciphers", icon: "ROT", blurb: "ROT13, Caesar with any shift, Atbash, and Vigenère — for puzzles, not secrets.",
    keywords: ["rot13", "caesar", "atbash", "vigenere", "ctf"],
    actions: ["rot13", "caesar", "atbash", "vigenère encrypt", "vigenère decrypt"],
    fields: [
      { id: "shift", type: "number", label: "Shift", value: 3, min: -25, max: 25, when: ["caesar"] },
      { id: "key", type: "text", label: "Key", value: "lemon", when: ["vigenère encrypt", "vigenère decrypt"] },
    ],
    input: { sample: "Attack at dawn" },
    output: { filename: "cipher.txt" },
    live: true,
    run: ({ input, action, options }) => {
      if (action === "rot13") return text.caesarCipher(input, 13);
      if (action === "caesar") return text.caesarCipher(input, options.shift);
      if (action === "atbash") return text.atbashCipher(input);
      return text.vigenereCipher(input, options.key, action.endsWith("decrypt"));
    },
  },
];

function parseDataUriSafely(input) {
  const match = /^data:([^,]*?),([\s\S]*)$/.exec(input.trim());
  if (!match) throw new Error("Enter a valid data: URI, for example data:text/plain;base64,SGk=");
  const metadata = match[1].split(";");
  const mediaType = metadata[0] || "text/plain";
  const isBase64 = metadata.at(-1)?.toLowerCase() === "base64";
  const parameters = metadata.slice(1, isBase64 ? -1 : undefined);
  const payload = isBase64 ? decodeBase64(match[2]) : decodeURIComponent(match[2]);
  return { mediaType, parameters, isBase64, payload };
}

function decodePunycode(input) {
  const base = 36;
  const tmin = 1;
  const tmax = 26;
  const skew = 38;
  const damp = 700;
  const initialBias = 72;
  const initialN = 128;
  const output = [];
  let index = input.lastIndexOf("-");
  if (index > 0) {
    for (const character of input.slice(0, index)) output.push(character.codePointAt(0));
  } else index = -1;
  let i = 0;
  let n = initialN;
  let bias = initialBias;
  let position = index + 1;
  while (position < input.length) {
    const previous = i;
    for (let weight = 1, k = base; ; k += base) {
      if (position >= input.length) throw new Error("That is not a valid Punycode label");
      const code = input.charCodeAt(position++);
      const digit = code - 48 < 10 ? code - 22 : code - 65 < 26 ? code - 65 : code - 97 < 26 ? code - 97 : base;
      if (digit >= base) throw new Error("That is not a valid Punycode label");
      i += digit * weight;
      const t = k <= bias ? tmin : k >= bias + tmax ? tmax : k - bias;
      if (digit < t) break;
      weight *= base - t;
    }
    const delta = Math.floor((i - previous) / (previous === 0 ? damp : 2)) + Math.floor((i - previous) / (output.length + 1));
    let total = previous === 0 ? Math.floor((i - previous) / damp) : Math.floor((i - previous) / 2);
    total += Math.floor(total / (output.length + 1));
    bias = 0;
    for (; total > ((base - tmin) * tmax) / 2; bias += base) total = Math.floor(total / (base - tmin));
    bias += Math.floor(((base - tmin + 1) * total) / (total + skew));
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i, 0, n);
    i++;
    void delta;
  }
  return String.fromCodePoint(...output);
}

/* ============================================================== crypto === */

const cryptoTools = [
  {
    id: "hash", layout: "stack", name: "Hash Text", icon: "#", blurb: "MD5, SHA-1, SHA-256, SHA-384, SHA-512, and CRC-32 side by side or one at a time.",
    keywords: ["md5", "sha256", "sha512", "checksum", "digest", "crc"],
    actions: ["all algorithms", ...crypt.HASH_ALGORITHMS],
    fields: [{ id: "encoding", type: "select", label: "Output", value: "hex", options: ["hex", "base64", "base64url", "binary"], when: crypt.HASH_ALGORITHMS }],
    input: { sample: "Converter keeps everything local." },
    output: { filename: "hash.txt" },
    live: true,
    run: async ({ input, action, options }) => (action === "all algorithms" ? crypt.hashAll(input) : crypt.generateHash(input, action, options.encoding)),
  },
  {
    id: "file-hash", layout: "stack", name: "Hash a File", icon: "⌗", blurb: "Verify a download by checksum without uploading it anywhere.",
    keywords: ["checksum", "sha256sum", "verify", "integrity", "md5sum"],
    fields: [{ id: "expected", type: "text", label: "Expected checksum", value: "", placeholder: "paste a checksum to compare" }],
    input: { accept: "*/*", hidden: true },
    output: { filename: "checksums.txt" },
    run: async ({ file, options }) => {
      requireFile(file);
      const bytes = new Uint8Array(file.buffer);
      const rows = [];
      for (const algorithm of crypt.HASH_ALGORITHMS) rows.push([algorithm, await crypt.generateHash(bytes, algorithm)]);
      const width = Math.max(...rows.map(([name]) => name.length));
      const listing = rows.map(([name, value]) => `${name.padEnd(width)}  ${value}`).join("\n");
      const expected = options.expected.trim().toLowerCase();
      const verdict = expected
        ? (rows.some(([, value]) => value === expected) ? "\n\nMATCH — the file matches the checksum you provided." : "\n\nNO MATCH — none of the digests equal the checksum you provided.")
        : "";
      return `File   ${file.name}\nSize   ${formatBytes(bytes.length)}\n\n${listing}${verdict}`;
    },
  },
  {
    id: "hmac", name: "HMAC", icon: "⚿", blurb: "Keyed message authentication codes through Web Crypto.",
    keywords: ["signature", "sign", "webhook", "secret", "verify"],
    fields: [
      { id: "secret", type: "text", label: "Secret key", value: "shared-secret", placeholder: "your shared secret" },
      { id: "algorithm", type: "select", label: "Hash", value: "SHA-256", options: ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] },
      { id: "encoding", type: "select", label: "Output", value: "hex", options: ["hex", "base64", "base64url"] },
    ],
    input: { sample: "The quick brown fox jumps over the lazy dog" },
    output: { filename: "hmac.txt" },
    live: true,
    run: ({ input, options }) => crypt.generateHmac(input, options.secret, options.algorithm, options.encoding),
  },
  {
    id: "jwt", layout: "stack", name: "JWT", icon: "•|•", blurb: "Inspect claims, verify an HMAC signature, or sign a new token locally.",
    keywords: ["token", "bearer", "claims", "hs256", "decode", "verify"],
    actions: ["inspect", "verify", "sign"],
    fields: [
      { id: "secret", type: "text", label: "Shared secret", value: "", placeholder: "required to verify or sign", when: ["verify", "sign"] },
      { id: "algorithm", type: "select", label: "Algorithm", value: "HS256", options: ["HS256", "HS384", "HS512"], when: ["sign"] },
    ],
    input: {
      sample: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSIsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjoxOTAwMDAwMDAwfQ.MjyhcvYb7qLSFFOtTz3xDqR1nJkqO1QMfUQyT9KlJi8",
      samples: { sign: '{"sub":"1234567890","name":"Ada","iat":1516239022}' },
    },
    output: { filename: "jwt.txt" },
    run: async ({ input, action, options }) => {
      if (action === "verify") return crypt.verifyJwt(input, options.secret);
      if (action === "sign") return crypt.signJwt(input, options.secret, options.algorithm);
      const report = crypt.inspectJwt(input);
      return [
        `Algorithm   ${report.algorithm}`,
        `Status      ${report.status.join(" · ")}`,
        "",
        "Header",
        JSON.stringify(report.header, null, 2),
        "",
        "Payload",
        JSON.stringify(report.payload, null, 2),
        report.registeredClaims.length ? `\nRegistered claims\n${report.registeredClaims.map((claim) => `  ${claim}`).join("\n")}` : "",
        "",
        report.warning,
      ].join("\n");
    },
  },
  {
    id: "aes", name: "AES Encryption", icon: "🔒", blurb: "AES-256-GCM with PBKDF2 key derivation — authenticated, salted, and local.",
    keywords: ["encrypt", "decrypt", "gcm", "password", "cipher", "secret"],
    actions: ["encrypt", "decrypt"],
    fields: [
      { id: "passphrase", type: "text", label: "Passphrase", value: "", placeholder: "the passphrase to derive a key from" },
      { id: "iterations", type: "number", label: "PBKDF2 iterations", value: 210000, min: 10000, max: 2000000, step: 10000, when: ["encrypt"] },
    ],
    input: { sample: "Meet me at the usual place." },
    output: { filename: "ciphertext.txt" },
    run: ({ input, action, options }) => (action === "encrypt"
      ? crypt.encryptText(input, options.passphrase, { iterations: options.iterations })
      : crypt.decryptText(input, options.passphrase)),
  },
  {
    id: "pbkdf2", layout: "stack", name: "Key Derivation", icon: "⚙", blurb: "Derive a key from a password with PBKDF2 and inspect every parameter.",
    keywords: ["pbkdf2", "kdf", "salt", "iterations", "password hashing"],
    fields: [
      { id: "salt", type: "text", label: "Salt", value: "", placeholder: "leave empty for a random 16-byte salt" },
      { id: "iterations", type: "number", label: "Iterations", value: 210000, min: 1000, max: 2000000, step: 10000 },
      { id: "hash", type: "select", label: "Hash", value: "SHA-256", options: ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] },
      { id: "length", type: "number", label: "Key bytes", value: 32, min: 8, max: 64 },
    ],
    input: { sample: "correct horse battery staple", label: "Password" },
    output: { filename: "derived-key.txt" },
    run: ({ input, options }) => crypt.pbkdf2Report(input, options.salt, options.iterations, options.hash, options.length),
  },
  {
    id: "keypair", name: "Key Pair Generator", icon: "🔑", blurb: "Generate RSA or elliptic-curve keys in PEM form, entirely in this tab.",
    keywords: ["rsa", "ecdsa", "pem", "public key", "private key", "ssh"],
    fields: [{ id: "kind", type: "select", label: "Key type", value: "RSA-2048", options: ["RSA-2048", "RSA-4096", "EC P-256", "EC P-384"] }],
    input: { hidden: true },
    output: { filename: "keypair.pem" },
    run: ({ options }) => crypt.generateKeyPair(options.kind),
  },
  {
    id: "totp", layout: "stack", name: "TOTP Codes", icon: "⏱", blurb: "Generate the current time-based one-time password from a Base32 secret.",
    keywords: ["2fa", "otp", "authenticator", "mfa", "rfc6238"],
    actions: ["generate code", "new secret"],
    fields: [
      { id: "digits", type: "number", label: "Digits", value: 6, min: 6, max: 8, when: ["generate code"] },
      { id: "period", type: "number", label: "Period (seconds)", value: 30, min: 10, max: 120, when: ["generate code"] },
      { id: "algorithm", type: "select", label: "Hash", value: "SHA-1", options: ["SHA-1", "SHA-256", "SHA-512"], when: ["generate code"] },
      { id: "label", type: "text", label: "Account label", value: "you@example.com", when: ["new secret"] },
    ],
    input: { sample: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", label: "Base32 secret" },
    output: { filename: "totp.txt" },
    run: async ({ input, action, options }) => {
      if (action === "new secret") {
        const secret = crypt.randomTotpSecret();
        const uri = `otpauth://totp/${encodeURIComponent(options.label || "account")}?secret=${secret}&issuer=Converter&algorithm=SHA1&digits=6&period=30`;
        return `Secret      ${secret}\n\notpauth URI\n${uri}\n\nAdd this to an authenticator app, then switch to "generate code" to check it.`;
      }
      const result = await crypt.generateTotp(input.trim(), options);
      return [
        `Code        ${result.code}`,
        `Valid for   ${result.remaining} second${result.remaining === 1 ? "" : "s"}`,
        `Counter     ${result.counter}`,
        "",
        `Previous    ${result.previous}`,
        `Next        ${result.next}`,
      ].join("\n");
    },
  },
  {
    id: "password", cards: true, name: "Password Generator", icon: "✦", blurb: "Cryptographically random passwords with the character sets you choose.",
    keywords: ["random", "passphrase", "secure", "generate", "credentials"],
    fields: [
      { id: "length", type: "number", label: "Length", value: 20, min: 4, max: 256 },
      { id: "count", type: "number", label: "How many", value: 5, min: 1, max: 100 },
      { id: "lowercase", type: "toggle", label: "Lowercase a–z", value: true },
      { id: "uppercase", type: "toggle", label: "Uppercase A–Z", value: true },
      { id: "digits", type: "toggle", label: "Digits 0–9", value: true },
      { id: "symbols", type: "toggle", label: "Symbols", value: true },
      { id: "excludeAmbiguous", type: "toggle", label: "Avoid look-alike characters", value: true },
    ],
    input: { hidden: true },
    output: { filename: "passwords.txt" },
    run: ({ options }) => {
      const sets = ["lowercase", "uppercase", "digits", "symbols"].filter((name) => options[name]);
      return crypt.generatePassword({ length: options.length, count: options.count, sets, excludeAmbiguous: options.excludeAmbiguous });
    },
  },
  {
    id: "password-strength", layout: "stack", name: "Password Strength", icon: "◑", blurb: "Entropy, alphabet size, and an offline cracking estimate with concrete issues.",
    keywords: ["entropy", "audit", "weak", "bits", "crack"],
    input: { sample: "correct-horse-battery-staple", label: "Password" },
    output: { filename: "strength.txt" },
    live: true,
    run: ({ input }) => crypt.analyzePassword(input.split("\n")[0]),
  },
  {
    id: "token", cards: true, name: "Token Generator", icon: "⧉", blurb: "Random API keys and identifiers in the alphabet you need.",
    keywords: ["api key", "secret", "random", "nonce", "session"],
    fields: [
      { id: "length", type: "number", label: "Length", value: 32, min: 1, max: 512 },
      { id: "alphabet", type: "select", label: "Alphabet", value: "alphanumeric", options: ["alphanumeric", "hex", "url safe", "numeric", "base58"] },
      { id: "count", type: "number", label: "How many", value: 5, min: 1, max: 100 },
      { id: "prefix", type: "text", label: "Prefix", value: "", placeholder: "sk_live_" },
    ],
    input: { hidden: true },
    output: { filename: "tokens.txt" },
    run: ({ options }) => Array.from({ length: options.count }, () => options.prefix + crypt.generateToken(options)).join("\n"),
  },
  {
    id: "basic-auth", layout: "stack", name: "Basic Auth Header", icon: "⊡", blurb: "Build the Authorization header and matching curl commands.",
    keywords: ["authorization", "credentials", "curl", "http", "header"],
    fields: [
      { id: "username", type: "text", label: "Username", value: "ada" },
      { id: "password", type: "text", label: "Password", value: "hunter2" },
    ],
    input: { hidden: true },
    output: { filename: "authorization.txt" },
    live: true,
    run: ({ options }) => crypt.basicAuthHeader(options.username, options.password),
  },
];

/* ========================================================== generators === */

const generatorTools = [
  {
    id: "uuid", cards: true, layout: "stack", name: "UUID Generator", icon: "id", blurb: "Versions 1, 3, 4, 5, and 7, plus an inspector that decodes any UUID.",
    keywords: ["guid", "v4", "v7", "identifier", "unique", "namespace"],
    actions: ["v4 random", "v7 time ordered", "v1 time based", "v5 name based", "v3 name based", "inspect"],
    fields: [
      { id: "count", type: "number", label: "How many", value: 5, min: 1, max: 200, when: ["v4 random", "v7 time ordered", "v1 time based"] },
      { id: "uppercase", type: "toggle", label: "Uppercase", value: false, when: ["v4 random", "v7 time ordered", "v1 time based"] },
      { id: "namespace", type: "select", label: "Namespace", value: "DNS", options: ["DNS", "URL", "OID", "X500"], when: ["v5 name based", "v3 name based"] },
      { id: "name", type: "text", label: "Name", value: "example.com", when: ["v5 name based", "v3 name based"] },
    ],
    input: { sample: "01931d5e-7c2a-7f3b-9c4d-5e6f70819a2b", label: "UUID to inspect", hiddenWhen: ["v4 random", "v7 time ordered", "v1 time based", "v5 name based", "v3 name based"] },
    output: { filename: "uuids.txt" },
    run: async ({ input, action, options }) => {
      if (action === "inspect") return ids.inspectUuid(input.trim().split("\n")[0]);
      if (action === "v5 name based") return ids.uuidV5(options.namespace, options.name);
      if (action === "v3 name based") return ids.uuidV3(options.namespace, options.name);
      const make = action === "v7 time ordered" ? ids.uuidV7 : action === "v1 time based" ? ids.uuidV1 : ids.uuidV4;
      const list = Array.from({ length: options.count }, () => make());
      return options.uppercase ? list.join("\n").toUpperCase() : list.join("\n");
    },
  },
  {
    id: "ulid", cards: true, layout: "stack", name: "ULID and Nano ID", icon: "01", blurb: "Sortable ULIDs and compact Nano IDs, with a ULID timestamp decoder.",
    keywords: ["sortable", "nanoid", "short id", "lexicographic", "identifier"],
    actions: ["ulid", "nano id", "inspect ulid"],
    fields: [
      { id: "count", type: "number", label: "How many", value: 5, min: 1, max: 200, when: ["ulid", "nano id"] },
      { id: "size", type: "number", label: "Nano ID length", value: 21, min: 4, max: 128, when: ["nano id"] },
    ],
    input: { sample: "01J9ZQ8XG0000000000000000A", label: "ULID to inspect", hiddenWhen: ["ulid", "nano id"] },
    output: { filename: "identifiers.txt" },
    run: ({ input, action, options }) => {
      if (action === "inspect ulid") return ids.inspectUlid(input.trim().split("\n")[0]);
      if (action === "nano id") return Array.from({ length: options.count }, () => ids.nanoId({ size: options.size })).join("\n");
      return Array.from({ length: options.count }, () => ids.ulid()).join("\n");
    },
  },
  {
    id: "qr", layout: "canvas", name: "QR Code", icon: "▩", blurb: "Full ISO 18004 encoder — URLs, Wi-Fi joins, and contact cards, as SVG you can download.",
    keywords: ["barcode", "wifi", "vcard", "scan", "svg", "2d"],
    actions: ["text or url", "wi-fi network", "contact card"],
    fields: [
      { id: "level", type: "select", label: "Error correction", value: "M", options: ["L", "M", "Q", "H"], labels: { L: "L — 7%", M: "M — 15%", Q: "Q — 25%", H: "H — 30%" } },
      { id: "scale", type: "number", label: "Module size (px)", value: 8, min: 2, max: 32, when: ["text or url", "wi-fi network", "contact card"] },
      { id: "dark", type: "color", label: "Foreground", value: "#101014" },
      { id: "light", type: "color", label: "Background", value: "#ffffff" },
      { id: "ssid", type: "text", label: "Network name", value: "Home Wi-Fi", when: ["wi-fi network"] },
      { id: "wifiPassword", type: "text", label: "Password", value: "", when: ["wi-fi network"] },
      { id: "security", type: "select", label: "Security", value: "WPA", options: ["WPA", "WEP", "nopass"], labels: { WPA: "WPA/WPA2/WPA3", WEP: "WEP", nopass: "Open" }, when: ["wi-fi network"] },
      { id: "hidden", type: "toggle", label: "Hidden network", value: false, when: ["wi-fi network"] },
      { id: "fullName", type: "text", label: "Full name", value: "Ada Lovelace", when: ["contact card"] },
      { id: "organization", type: "text", label: "Organisation", value: "", when: ["contact card"] },
      { id: "phone", type: "text", label: "Phone", value: "", when: ["contact card"] },
      { id: "email", type: "text", label: "Email", value: "", when: ["contact card"] },
    ],
    input: { sample: "https://github.com/ShalmonAnandas/converter", hiddenWhen: ["wi-fi network", "contact card"] },
    output: { filename: "qr-code.svg", preview: true },
    live: true,
    run: ({ input, action, options }) => {
      let payload = input.trim();
      if (action === "wi-fi network") payload = qr.wifiPayload({ ssid: options.ssid, password: options.wifiPassword, security: options.security, hidden: options.hidden });
      if (action === "contact card") payload = qr.vcardPayload({ name: options.fullName, organization: options.organization, phone: options.phone, email: options.email });
      const svg = qr.qrToSvg(payload, { level: options.level, scale: options.scale, dark: options.dark, light: options.light });
      const code = qr.encodeQr(payload, { level: options.level });
      return {
        text: svg,
        html: svg,
        note: `Version ${code.version} · ${code.size}×${code.size} modules · ${code.mode} mode · mask ${code.mask} · level ${code.level}`,
        download: { blob: blobFor(svg, "image/svg+xml"), name: "qr-code.svg" },
      };
    },
  },
  {
    id: "mac", cards: true, layout: "stack", name: "MAC Address", icon: "⑉", blurb: "Generate locally administered addresses, or decode the parts of an existing one.",
    keywords: ["ethernet", "oui", "hardware", "eui-64", "network"],
    actions: ["generate", "inspect"],
    fields: [
      { id: "count", type: "number", label: "How many", value: 5, min: 1, max: 100, when: ["generate"] },
      { id: "separator", type: "select", label: "Separator", value: ":", options: [":", "-", ""], labels: { ":": "Colon", "-": "Hyphen", "": "None" }, when: ["generate"] },
      { id: "uppercase", type: "toggle", label: "Uppercase", value: true, when: ["generate"] },
      { id: "prefix", type: "text", label: "Fixed prefix", value: "", placeholder: "00:1A:2B", when: ["generate"] },
    ],
    input: { sample: "00:1A:2B:3C:4D:5E", hiddenWhen: ["generate"] },
    output: { filename: "mac-addresses.txt" },
    run: ({ input, action, options }) => (action === "inspect"
      ? ids.inspectMac(input.trim().split("\n")[0])
      : Array.from({ length: options.count }, () => ids.macAddress(options)).join("\n")),
  },
  {
    id: "svg-placeholder", layout: "canvas", name: "Placeholder Image", icon: "▭", blurb: "A dependency-free SVG placeholder sized exactly how you need it.",
    keywords: ["mockup", "dummy", "image", "wireframe", "prototype"],
    fields: [
      { id: "width", type: "number", label: "Width", value: 800, min: 16, max: 4000 },
      { id: "height", type: "number", label: "Height", value: 450, min: 16, max: 4000 },
      { id: "label", type: "text", label: "Label", value: "", placeholder: "defaults to the dimensions" },
      { id: "background", type: "color", label: "Background", value: "#e2e8f0" },
      { id: "foreground", type: "color", label: "Text", value: "#475569" },
    ],
    input: { hidden: true },
    output: { filename: "placeholder.svg", preview: true },
    live: true,
    run: ({ options }) => {
      const svg = markup.svgPlaceholder({ width: options.width, height: options.height, text: options.label, background: options.background, foreground: options.foreground });
      return { text: svg, html: svg, download: { blob: blobFor(svg, "image/svg+xml"), name: "placeholder.svg" } };
    },
  },
];

/* =============================================================== web ==== */

const webTools = [
  {
    id: "color", layout: "canvas", name: "Colour Converter", icon: "◐", blurb: "Every notation at once — HEX, RGB, HSL, HSV, CMYK, OKLCH, CIELAB — with contrast.",
    keywords: ["hex", "rgb", "hsl", "oklch", "cmyk", "picker", "css"],
    fields: [{ id: "picker", type: "color", label: "Pick", value: "#3b82f6", binds: "input" }],
    input: { sample: "#3b82f6", label: "Colour" },
    output: { filename: "colour.txt" },
    live: true,
    run: ({ input }) => {
      const value = input.trim().split("\n")[0];
      const hex = color.toHex(color.parseColor(value), { short: false });
      return { ...color.describeColor(value), swatches: [hex], html: swatchPreview(hex) };
    },
  },
  {
    id: "contrast", layout: "canvas", name: "Contrast Checker", icon: "◨", blurb: "WCAG 2.2 contrast ratio for a foreground and background pair.",
    keywords: ["wcag", "accessibility", "a11y", "ratio", "aa", "aaa"],
    fields: [
      { id: "foreground", type: "color", label: "Foreground", value: "#767676" },
      { id: "background", type: "color", label: "Background", value: "#ffffff" },
    ],
    input: { hidden: true },
    output: { filename: "contrast.txt" },
    live: true,
    run: ({ options }) => ({
      ...color.checkContrast(options.foreground, options.background),
      swatches: [options.foreground, options.background],
      html: contrastPreview(options.foreground, options.background),
    }),
  },
  {
    id: "palette", layout: "canvas", name: "Colour Palette", icon: "◔", blurb: "Build shades, tints, and harmonies from a single base colour.",
    keywords: ["scheme", "harmony", "tints", "shades", "complementary", "design tokens"],
    actions: ["shades", "tints", "monochromatic", "analogous", "complementary", "split complementary", "triadic", "tetradic"],
    fields: [{ id: "picker", type: "color", label: "Base colour", value: "#3b82f6", binds: "input" }],
    input: { sample: "#3b82f6", label: "Base colour" },
    output: { filename: "palette.txt" },
    live: true,
    run: ({ input, action }) => {
      const palette = color.buildPalette(input.trim().split("\n")[0], action);
      return { ...palette, swatches: color.swatchesFor(palette.text) };
    },
  },
  {
    id: "css", name: "CSS Formatter", icon: "{;}", blurb: "Readable formatting or aggressive minification for stylesheets.",
    keywords: ["beautify", "minify", "stylesheet", "prettify", "compress"],
    actions: ["format", "minify"],
    fields: [{ id: "indent", type: "select", label: "Indent", value: "2", options: ["2", "4", "tab"], labels: { 2: "2 spaces", 4: "4 spaces", tab: "Tab" }, when: ["format"] }],
    input: { sample: ":root{--brand:#3b82f6;--radius:12px}.card,.panel{background:var(--panel);border-radius:var(--radius);padding:24px}@media (max-width:720px){.card{padding:16px}}" },
    output: { filename: "styles.css" },
    live: true,
    run: ({ input, action, options }) => (action === "minify" ? markup.minifyCss(input) : markup.formatCss(input, options.indent === "tab" ? "\t" : " ".repeat(Number(options.indent)))),
  },
  {
    id: "html", name: "HTML Formatter", icon: "<>", blurb: "Indent markup sensibly or strip it down, keeping inline elements on one line.",
    keywords: ["beautify", "minify", "prettify", "indent", "markup"],
    actions: ["format", "minify"],
    fields: [{ id: "indent", type: "select", label: "Indent", value: "2", options: ["2", "4", "tab"], labels: { 2: "2 spaces", 4: "4 spaces", tab: "Tab" }, when: ["format"] }],
    input: { sample: '<section class="cards"><h2>Tools</h2><p>Everything runs <b>locally</b>.</p><ul><li>JSON</li><li>YAML</li></ul><img src="x.png" alt=""></section>' },
    output: { filename: "index.html", preview: true },
    live: true,
    run: ({ input, action, options }) => (action === "minify" ? markup.minifyHtml(input) : markup.formatHtml(input, options.indent === "tab" ? "\t" : " ".repeat(Number(options.indent)))),
  },
  {
    id: "sql", name: "SQL Formatter", icon: "⌸", blurb: "Break statements onto clause lines and normalise keyword casing.",
    keywords: ["beautify", "query", "postgres", "mysql", "prettify"],
    fields: [{ id: "uppercase", type: "toggle", label: "Uppercase keywords", value: true }],
    input: { sample: "select u.id, u.name, count(o.id) as orders from users u left join orders o on o.user_id = u.id where u.active = true and u.created > '2026-01-01' group by u.id, u.name order by orders desc limit 10;" },
    output: { filename: "query.sql" },
    live: true,
    run: ({ input, options }) => markup.formatSql(input, { uppercase: options.uppercase }),
  },
  {
    id: "svg", name: "SVG Tools", icon: "✦", blurb: "Strip editor cruft, round coordinates, and produce a CSS-ready data URI.",
    keywords: ["optimise", "minify", "icon", "data uri", "inline", "svgo"],
    actions: ["optimise", "to data uri", "to base64 uri"],
    input: { sample: '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="24" height="24" viewBox="0 0 24 24"><title>Check</title><!-- drawn in an editor --><path d="M20.000000 6.0000001L9 17.00000 4.0000 12" stroke="currentColor" stroke-width="2" fill="none"/></svg>' },
    output: { filename: "icon.svg", preview: true },
    live: true,
    run: ({ input, action }) => {
      if (action === "to data uri") return markup.svgToDataUri(input, { encoding: "url" });
      if (action === "to base64 uri") return markup.svgToDataUri(input, { encoding: "base64" });
      const optimised = markup.optimizeSvg(input);
      return {
        text: optimised,
        html: optimised,
        note: `${formatBytes(textToBytes(input).length)} → ${formatBytes(textToBytes(optimised).length)}`,
        download: { blob: blobFor(optimised, "image/svg+xml"), name: "icon.svg" },
      };
    },
  },
  {
    id: "meta", layout: "stack", name: "Meta Tags", icon: "⌂", blurb: "Primary, Open Graph, and Twitter card tags for a page, correctly escaped.",
    keywords: ["seo", "open graph", "twitter card", "social", "head"],
    fields: [
      { id: "title", type: "text", label: "Title", value: "Converter — developer tools in one workspace" },
      { id: "description", type: "text", label: "Description", value: "A local-first workbench for the formats developers use every day." },
      { id: "url", type: "text", label: "Canonical URL", value: "https://example.com" },
      { id: "image", type: "text", label: "Preview image", value: "https://example.com/og.png" },
      { id: "siteName", type: "text", label: "Site name", value: "Converter" },
      { id: "author", type: "text", label: "Author", value: "" },
      { id: "themeColor", type: "color", label: "Theme colour", value: "#3b82f6" },
      { id: "type", type: "select", label: "OG type", value: "website", options: ["website", "article", "profile", "video.other"] },
      { id: "twitterCard", type: "select", label: "Twitter card", value: "summary_large_image", options: ["summary_large_image", "summary", "player"] },
    ],
    input: { hidden: true },
    output: { filename: "meta.html" },
    live: true,
    run: ({ options }) => markup.metaTags(options),
  },
  {
    id: "image", layout: "canvas", name: "Image Converter", icon: "▣", blurb: "Convert between PNG, JPEG, and WebP, resize, and re-compress — all on the canvas.",
    keywords: ["png", "jpeg", "webp", "resize", "compress", "optimise"],
    actions: ["convert", "inspect"],
    fields: [
      { id: "format", type: "select", label: "Output format", value: "webp", options: ["png", "jpeg", "webp"], when: ["convert"] },
      { id: "quality", type: "number", label: "Quality", value: 85, min: 1, max: 100, when: ["convert"] },
      { id: "maxWidth", type: "number", label: "Max width (px)", value: 0, min: 0, max: 10000, help: "0 keeps the original width", when: ["convert"] },
      { id: "scale", type: "number", label: "Scale %", value: 100, min: 1, max: 400, when: ["convert"] },
    ],
    input: { accept: "image/*", hidden: true },
    output: { filename: "image" },
    run: async ({ action, file, options }) => {
      requireFile(file);
      if (action === "inspect") return images.describeImage(file.blob);
      const result = await images.convertImage(file.blob, options);
      return {
        text: result.report,
        download: { blob: result.blob, name: `${(file.name || "image").replace(/\.[^.]+$/, "")}.${options.format}` },
        previewUrl: URL.createObjectURL(result.blob),
      };
    },
  },
];

/* =========================================================== network ==== */

const networkTools = [
  {
    id: "subnet", layout: "stack", name: "Subnet Calculator", icon: "⊟", blurb: "Network, broadcast, host range, wildcard, class, and scope for any CIDR block.",
    keywords: ["cidr", "netmask", "ipv4", "vlsm", "broadcast", "hosts"],
    input: { sample: "192.168.1.130/26", label: "CIDR block" },
    output: { filename: "subnet.txt" },
    live: true,
    run: ({ input }) => net.subnetReport(input.trim().split("\n")[0]),
  },
  {
    id: "ip-convert", layout: "stack", name: "IP Address Converter", icon: "◎", blurb: "Dotted quad, decimal, hex, octal, binary, IPv6-mapped, and reverse DNS.",
    keywords: ["ipv4", "decimal", "hex", "binary", "arpa", "integer"],
    input: { sample: "192.168.1.1", label: "IPv4 address or integer" },
    output: { filename: "address.txt" },
    live: true,
    run: ({ input }) => net.convertIpv4(input.trim().split("\n")[0]),
  },
  {
    id: "ip-range", layout: "stack", name: "IP Range Tools", icon: "⋯", blurb: "Expand a CIDR block into addresses, or cover an arbitrary range with CIDR blocks.",
    keywords: ["cidr", "expand", "summarise", "firewall", "acl"],
    actions: ["expand to addresses", "summarise as cidr"],
    input: { sample: "192.168.1.0/29" },
    output: { filename: "addresses.txt" },
    live: true,
    run: ({ input, action }) => (action === "summarise as cidr"
      ? net.summarizeRange(input.trim().split("\n")[0])
      : net.expandRange(input.trim().split("\n")[0])),
  },
  {
    id: "ipv6", layout: "stack", name: "IPv6 Tools", icon: "⁶", blurb: "Expand and compress addresses, or generate a unique local /48 prefix.",
    keywords: ["ula", "rfc4193", "compress", "expand", "prefix"],
    actions: ["expand address", "generate unique local prefix"],
    fields: [{ id: "seed", type: "text", label: "MAC address seed", value: "", placeholder: "optional — random when empty", when: ["generate unique local prefix"] }],
    input: { sample: "2001:db8::1", hiddenWhen: ["generate unique local prefix"] },
    output: { filename: "ipv6.txt" },
    run: ({ input, action, options }) => (action === "generate unique local prefix"
      ? net.generateUla(options.seed)
      : net.expandIpv6(input.trim().split("\n")[0])),
  },
  {
    id: "url-parse", layout: "stack", name: "URL Parser", icon: "⚯", blurb: "Break a URL into every component, with query parameters and path segments listed.",
    keywords: ["query string", "parameters", "components", "origin", "host"],
    actions: ["parse url", "build query string"],
    input: {
      sample: "https://user@example.com:8443/docs/getting%20started?tab=cli&theme=dark&tab=api#install",
      samples: { "build query string": '{"tab":["cli","api"],"theme":"dark","page":2}' },
    },
    output: { filename: "url.txt" },
    live: true,
    run: ({ input, action }) => (action === "build query string" ? net.buildQuery(input) : net.parseUrl(input.trim().split("\n")[0])),
  },
  {
    id: "user-agent", layout: "stack", name: "User Agent Parser", icon: "◍", blurb: "Identify the browser, engine, platform, and device class behind a UA string.",
    keywords: ["browser", "device", "platform", "detect", "bot"],
    input: { sample: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" },
    output: { filename: "user-agent.txt" },
    live: true,
    run: ({ input }) => net.parseUserAgent(input),
  },
];

/* ========================================================== numbers ===== */

const numberTools = [
  {
    id: "base-convert", layout: "stack", name: "Number Base Converter", icon: "2₁₆", blurb: "Any base from 2 to 36, with arbitrary precision behind the scenes.",
    keywords: ["binary", "hex", "octal", "radix", "decimal", "bigint"],
    fields: [
      { id: "from", type: "number", label: "Input base", value: 10, min: 2, max: 36 },
      { id: "to", type: "number", label: "Output base", value: 16, min: 2, max: 36 },
      { id: "all", type: "toggle", label: "Show every common base", value: true },
    ],
    input: { sample: "255" },
    output: { filename: "bases.txt" },
    live: true,
    run: ({ input, options }) => {
      const value = input.trim().split("\n")[0];
      return options.all ? maths.baseReport(value, options.from) : maths.convertBase(value, options.from, options.to);
    },
  },
  {
    id: "roman", layout: "stack", name: "Roman Numerals", icon: "Ⅳ", blurb: "Convert in either direction, rejecting non-canonical forms.",
    keywords: ["numerals", "latin", "mmxxvi", "convert"],
    input: { sample: "1994" },
    output: { filename: "roman.txt" },
    live: true,
    run: ({ input }) => input.split("\n").filter((line) => line.trim()).map((line) => maths.convertRoman(line)).join("\n"),
  },
  {
    id: "math", name: "Expression Evaluator", icon: "∑", blurb: "A safe calculator — no eval — with functions, constants, and line-by-line results.",
    keywords: ["calculator", "compute", "formula", "arithmetic", "trig"],
    input: { sample: "2 + 3 * 4\nsqrt(16) + abs(-2)\nsin(rad(90))\nhypot(3, 4)\n5!\nlog2(1024)\n(1 + 5^0.5) / 2" },
    output: { filename: "results.txt" },
    live: true,
    run: ({ input }) => maths.evaluateLines(input),
  },
  {
    id: "units", layout: "stack", name: "Unit Converter", icon: "⚖", blurb: "Length, mass, data, time, speed, area, volume, pressure, energy, angle, temperature.",
    keywords: ["metric", "imperial", "celsius", "bytes", "kilometres", "measure"],
    fields: [
      { id: "category", type: "select", label: "Category", value: "data size", options: [...Object.keys(maths.UNITS), "temperature"], reloads: true },
      { id: "from", type: "select", label: "From", value: "gibibyte", options: [], dependsOn: "category" },
    ],
    input: { sample: "1", label: "Amount" },
    output: { filename: "units.txt" },
    live: true,
    run: ({ input, options }) => maths.unitReport(input.trim().split("\n")[0], options.category, options.from),
  },
  {
    id: "percentage", layout: "stack", name: "Percentage Calculator", icon: "٪", blurb: "Every common percentage question answered from two numbers.",
    keywords: ["percent", "increase", "decrease", "change", "discount", "tax"],
    fields: [
      { id: "a", type: "number", label: "First number", value: 25, step: "any" },
      { id: "b", type: "number", label: "Second number", value: 200, step: "any" },
    ],
    input: { hidden: true },
    output: { filename: "percentages.txt" },
    live: true,
    run: ({ options }) => maths.percentageReport(options.a, options.b),
  },
  {
    id: "chmod", layout: "stack", name: "chmod Calculator", icon: "755", blurb: "Translate between octal modes and rwx notation, including the special bits.",
    keywords: ["permissions", "unix", "octal", "rwx", "setuid", "sticky"],
    input: { sample: "755", label: "Mode" },
    output: { filename: "chmod.txt" },
    live: true,
    run: ({ input }) => maths.chmodReport(input.trim().split("\n")[0]),
  },
];

/* ============================================================== time ==== */

const timeTools = [
  {
    id: "datetime", layout: "stack", name: "Date and Time", icon: "◷", blurb: "Unix, ISO, RFC 2822, Excel, FILETIME, ISO week, and any time zone at once.",
    keywords: ["timestamp", "unix", "epoch", "iso 8601", "timezone", "convert"],
    fields: [
      { id: "unit", type: "select", label: "Numeric input is", value: "auto", options: ["auto", "seconds", "milliseconds", "microseconds", "nanoseconds"] },
      { id: "timeZone", type: "select", label: "Show also in", value: "UTC", options: ["UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"] },
    ],
    input: { sample: String(Math.floor(Date.now() / 1000)), label: "Timestamp or date" },
    output: { filename: "datetime.txt" },
    live: true,
    run: ({ input, options }) => when.describeMoment(input.trim().split("\n")[0], options.unit, options.timeZone),
  },
  {
    id: "date-diff", layout: "stack", name: "Date Difference", icon: "↦", blurb: "Calendar and absolute distance between two moments, business days included.",
    keywords: ["between", "duration", "days", "age", "countdown"],
    fields: [
      { id: "from", type: "text", label: "From", value: "2026-01-01" },
      { id: "to", type: "text", label: "To", value: "2026-12-25" },
    ],
    input: { hidden: true },
    output: { filename: "difference.txt" },
    live: true,
    run: ({ options }) => when.dateDifference(options.from, options.to),
  },
  {
    id: "duration", layout: "stack", name: "Duration Converter", icon: "⧗", blurb: "Read 90s, 1h30m, 01:30:00, or PT1H30M and restate it in every unit.",
    keywords: ["seconds", "minutes", "iso 8601", "humanise", "timespan"],
    fields: [{ id: "unit", type: "select", label: "Bare numbers are", value: "seconds", options: Object.keys({ nanoseconds: 0, microseconds: 0, milliseconds: 0, seconds: 0, minutes: 0, hours: 0, days: 0, weeks: 0 }) }],
    input: { sample: "1h30m", label: "Duration" },
    output: { filename: "duration.txt" },
    live: true,
    run: ({ input, options }) => when.convertDuration(input.trim().split("\n")[0], options.unit),
  },
  {
    id: "cron", layout: "stack", name: "Cron Expressions", icon: "*/5", blurb: "Explain a schedule in words and list the next runs, aliases included.",
    keywords: ["crontab", "schedule", "job", "next run", "explain"],
    fields: [{ id: "runs", type: "number", label: "Runs to list", value: 8, min: 1, max: 50 }],
    input: { sample: "0 9 * * 1-5", label: "Cron expression" },
    output: { filename: "cron.txt" },
    live: true,
    run: ({ input, options }) => when.describeCron(input.trim().split("\n")[0], { runs: options.runs }),
  },
];

/* ============================================================= files ==== */

const fileTools = [
  {
    id: "spreadsheet", name: "CSV and XLSX", icon: "▤", blurb: "Build a real, styled XLSX workbook from CSV, or extract a worksheet back to CSV.",
    keywords: ["excel", "workbook", "sheet", "office", "xlsx"],
    actions: ["csv to xlsx", "xlsx to csv"],
    fields: [
      { id: "sheetName", type: "text", label: "Sheet name", value: "Sheet1", when: ["csv to xlsx"] },
      { id: "headerRow", type: "toggle", label: "Style and freeze the first row", value: true, when: ["csv to xlsx"] },
      { id: "sheet", type: "number", label: "Worksheet number", value: 1, min: 1, max: 50, when: ["xlsx to csv"] },
    ],
    input: { accept: ".csv,.xlsx,text/csv", sample: "id,name,role,score\n1,Ada,Engineer,97\n2,Lin,QA,88.5\n3,Zoë,Design,91" },
    output: { filename: "workbook.xlsx" },
    run: async ({ input, action, file, options }) => {
      if (action === "xlsx to csv") {
        requireFile(file, "xlsx");
        const { rows, sheetNames, active } = await office.xlsxToRows(file.buffer, { sheet: options.sheet });
        const csv = serializeRows(rows.map((row) => Array.from(row, (value) => value ?? "")), ",", { protect: false });
        return {
          text: csv,
          note: `${sheetNames[active]} · ${rows.length} rows · worksheets: ${sheetNames.join(", ")}`,
          download: { blob: blobFor(csv, "text/csv;charset=utf-8"), name: file.name.replace(/\.xlsx$/i, ".csv") },
        };
      }
      const source = file && /\.csv$/i.test(file.name) ? bytesToText(new Uint8Array(file.buffer), { fatal: false }) : input;
      const delimiter = detectDelimiter(source);
      const rows = parseCsv(source, delimiter);
      if (!rows.length) throw new Error("There are no rows to convert");
      const bytes = await office.csvRowsToXlsx(rows, { sheetName: options.sheetName, headerRow: options.headerRow });
      return {
        text: `Workbook ready\n\nRows        ${rows.length}\nColumns     ${Math.max(0, ...rows.map((row) => row.length))}\nDelimiter   ${delimiter === "\t" ? "tab" : delimiter}\nSize        ${formatBytes(bytes.length)}\n\nUse Download to save the .xlsx file.`,
        download: { blob: blobFor(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), name: `${options.sheetName || "workbook"}.xlsx` },
      };
    },
  },
  {
    id: "document", name: "Markdown and DOCX", icon: "▥", blurb: "Produce a styled Word document with headings, lists, and tables — or read one back.",
    keywords: ["word", "docx", "office", "report", "document"],
    actions: ["markdown to docx", "docx to markdown"],
    fields: [{ id: "title", type: "text", label: "Document title", value: "Converter document", when: ["markdown to docx"] }],
    input: { accept: ".md,.markdown,.docx,text/markdown", sample: "# Release notes\n\nConverter keeps **everything** local.\n\n## Highlights\n\n- No uploads\n- 92 tools\n- Works offline\n\n| Area | Tools |\n| --- | --- |\n| Data | 18 |\n| Text | 13 |\n\n> Nothing you paste leaves this tab." },
    output: { filename: "document.docx" },
    run: async ({ input, action, file, options }) => {
      if (action === "docx to markdown") {
        requireFile(file, "docx");
        const markdown = await office.docxToMarkdown(file.buffer);
        return { text: markdown, download: { blob: blobFor(markdown, "text/markdown;charset=utf-8"), name: file.name.replace(/\.docx$/i, ".md") } };
      }
      const source = file && /\.(md|markdown|txt)$/i.test(file.name) ? bytesToText(new Uint8Array(file.buffer), { fatal: false }) : input;
      const bytes = await office.markdownToDocx(source, { title: options.title });
      return {
        text: `Word document ready\n\nTitle   ${options.title}\nSize    ${formatBytes(bytes.length)}\nStyles  headings 1–6, lists, quotes, code, tables\n\nUse Download to save the .docx file.`,
        download: { blob: blobFor(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), name: `${(options.title || "document").replace(/[^\w -]/g, "")}.docx` },
      };
    },
  },
  {
    id: "pdf", name: "Markdown to PDF", icon: "▧", blurb: "Typeset Markdown into a paginated PDF with real fonts and no server round trip.",
    keywords: ["print", "export", "report", "document", "a4"],
    fields: [
      { id: "pageSize", type: "select", label: "Page size", value: "A4", options: ["A4", "Letter", "Legal", "A5"] },
      { id: "fontSize", type: "number", label: "Body size (pt)", value: 11, min: 7, max: 18 },
      { id: "margin", type: "number", label: "Margin (pt)", value: 56, min: 18, max: 140 },
      { id: "title", type: "text", label: "Document title", value: "Converter document" },
    ],
    input: { accept: ".md,.markdown,.txt", sample: "# Quarterly report\n\nConverter processes everything in the browser.\n\n## Numbers\n\n- 92 tools\n- 0 bytes uploaded\n- 1 tab\n\n> Privacy is the default, not a setting.\n\n---\n\nGenerated locally." },
    output: { filename: "document.pdf" },
    run: ({ input, file, options }) => {
      const source = file ? bytesToText(new Uint8Array(file.buffer), { fatal: false }) : input;
      const bytes = office.markdownToPdf(source, options);
      return {
        text: `PDF ready\n\nPage size  ${options.pageSize}\nBody size  ${options.fontSize} pt\nMargin     ${options.margin} pt\nSize       ${formatBytes(bytes.length)}\n\nUse Download to save the .pdf file.`,
        download: { blob: blobFor(bytes, "application/pdf"), name: `${(options.title || "document").replace(/[^\w -]/g, "")}.pdf` },
      };
    },
  },
  {
    id: "archive", layout: "stack", name: "Archive Inspector", icon: "⛁", blurb: "List the contents of any ZIP, DOCX, XLSX, PPTX, JAR, or EPUB without extracting it.",
    keywords: ["zip", "unzip", "contents", "docx", "jar", "epub"],
    actions: ["list entries", "extract a file"],
    fields: [{ id: "entry", type: "text", label: "Entry path", value: "", placeholder: "word/document.xml", when: ["extract a file"] }],
    input: { accept: ".zip,.docx,.xlsx,.pptx,.jar,.epub,.odt,.ods", hidden: true },
    output: { filename: "archive.txt" },
    run: async ({ action, file, options }) => {
      requireFile(file);
      if (action === "list entries") return office.inspectArchive(file.buffer);
      const files = await office.readZip(file.buffer);
      if (!options.entry) throw new Error("Enter the path of an entry — run “list entries” first to see them.");
      const data = files.get(options.entry);
      if (!data) throw new Error(`The archive has no entry called "${options.entry}".`);
      const decoded = bytesToText(data, { fatal: false });
      const printable = /^[\s\S]{0,4000}$/.test(decoded) && !/\u0000/.test(decoded.slice(0, 1000));
      return {
        text: printable ? decoded : hexdump(data.subarray(0, 4096)),
        note: `${options.entry} · ${formatBytes(data.length)}`,
        download: { blob: blobFor(data, "application/octet-stream"), name: options.entry.split("/").pop() },
      };
    },
  },
  {
    id: "hexdump", layout: "stack", name: "File Hex Dump", icon: "⦿", blurb: "Offsets, hex bytes, and ASCII for any file — handy for spotting magic numbers.",
    keywords: ["binary", "bytes", "magic number", "inspect", "xxd"],
    fields: [{ id: "limit", type: "number", label: "Bytes to show", value: 2048, min: 16, max: 65536, step: 16 }],
    input: { accept: "*/*", hidden: true },
    output: { filename: "hexdump.txt" },
    run: ({ file, options }) => {
      requireFile(file);
      const bytes = new Uint8Array(file.buffer);
      const slice = bytes.subarray(0, options.limit);
      const signature = detectSignature(bytes);
      return `File       ${file.name}\nSize       ${formatBytes(bytes.length)}\nType       ${file.type || "unknown"}\nSignature  ${signature}\n\n${hexdump(slice)}${bytes.length > slice.length ? `\n… ${formatBytes(bytes.length - slice.length)} more` : ""}`;
    },
  },
];

const SIGNATURES = [
  [[0x50, 0x4b, 0x03, 0x04], "ZIP container (also DOCX, XLSX, PPTX, JAR, EPUB)"],
  [[0x25, 0x50, 0x44, 0x46], "PDF document"],
  [[0x89, 0x50, 0x4e, 0x47], "PNG image"],
  [[0xff, 0xd8, 0xff], "JPEG image"],
  [[0x47, 0x49, 0x46, 0x38], "GIF image"],
  [[0x1f, 0x8b], "gzip archive"],
  [[0x42, 0x5a, 0x68], "bzip2 archive"],
  [[0xfd, 0x37, 0x7a, 0x58, 0x5a], "xz archive"],
  [[0x37, 0x7a, 0xbc, 0xaf], "7-Zip archive"],
  [[0x52, 0x61, 0x72, 0x21], "RAR archive"],
  [[0x7f, 0x45, 0x4c, 0x46], "ELF executable"],
  [[0x4d, 0x5a], "Windows executable"],
  [[0xca, 0xfe, 0xba, 0xbe], "Java class file"],
  [[0x00, 0x61, 0x73, 0x6d], "WebAssembly module"],
  [[0x49, 0x44, 0x33], "MP3 audio with ID3"],
  [[0x4f, 0x67, 0x67, 0x53], "Ogg container"],
  [[0x66, 0x4c, 0x61, 0x43], "FLAC audio"],
];

function detectSignature(bytes) {
  for (const [magic, name] of SIGNATURES) {
    if (magic.every((byte, index) => bytes[index] === byte)) return name;
  }
  if (bytes[0] === 0x52 && bytes[8] === 0x57) return "RIFF container (WAV, AVI, WebP)";
  const head = bytesToText(bytes.subarray(0, 64), { fatal: false });
  if (/^\s*[{[]/.test(head)) return "probably JSON";
  if (/^\s*</.test(head)) return "probably XML or HTML";
  return "no known signature";
}

/* ========================================================= reference ==== */

const referenceTools = [
  {
    id: "mime", layout: "stack", name: "MIME Types", icon: "◇", blurb: "Look up a media type by extension, or an extension by media type.",
    keywords: ["content type", "media type", "extension", "header"],
    input: { sample: "webp", label: "Extension or media type" },
    output: { filename: "mime.txt" },
    live: true,
    run: ({ input }) => reference.lookupMime(input.trim().split("\n")[0]),
  },
  {
    id: "http-status", layout: "stack", name: "HTTP Status Codes", icon: "418", blurb: "Search every status code by number, name, or description.",
    keywords: ["404", "500", "response", "rest", "api"],
    input: { sample: "429", label: "Code or keyword" },
    output: { filename: "status.txt" },
    live: true,
    run: ({ input }) => reference.lookupStatus(input.trim().split("\n")[0]),
  },
  {
    id: "keycode", layout: "stack", name: "Key Codes", icon: "⌨", blurb: "Map between keyCode, event.key, and event.code — press a key to identify it.",
    keywords: ["keyboard", "keydown", "event", "javascript", "shortcut"],
    input: { sample: "", label: "Key name or code", placeholder: "Press a key in this box, or type a code" },
    output: { filename: "keycodes.txt" },
    live: true,
    captureKeys: true,
    run: ({ input }) => reference.lookupKeyCode(input.trim().split("\n")[0]),
  },
  {
    id: "ports", layout: "stack", name: "Well-Known Ports", icon: "⑃", blurb: "Which service runs where, from FTP to MongoDB.",
    keywords: ["tcp", "service", "network", "firewall", "default"],
    input: { sample: "", label: "Port or service", placeholder: "5432, redis, https…" },
    output: { filename: "ports.txt" },
    live: true,
    run: ({ input }) => reference.lookupPort(input.trim().split("\n")[0]),
  },
];

/* ============================================================ assembly == */

const CATEGORIES = [
  { name: "JSON & Data", tools: jsonTools },
  { name: "Converters", tools: converterTools },
  { name: "Text", tools: textTools },
  { name: "Encoding", tools: encodingTools },
  { name: "Crypto & Security", tools: cryptoTools },
  { name: "Generators", tools: generatorTools },
  { name: "Web & Design", tools: webTools },
  { name: "Network", tools: networkTools },
  { name: "Numbers & Units", tools: numberTools },
  { name: "Date & Time", tools: timeTools },
  { name: "Files & Documents", tools: fileTools },
  { name: "Reference", tools: referenceTools },
];

export const TOOLS = CATEGORIES.flatMap((category) => category.tools.map((tool) => ({
  ...tool,
  category: category.name,
  actions: tool.actions?.map((action) => (typeof action === "string" ? action : action.id)) ?? [],
  fields: tool.fields ?? [],
  input: tool.input ?? {},
  output: tool.output ?? {},
  // Two inputs always mean a comparison; everything else keeps its declared
  // geometry, or the default side-by-side split.
  layout: tool.secondary ? "compare" : tool.layout ?? "split",
  cards: Boolean(tool.cards),
})));

export const TOOL_CATEGORIES = CATEGORIES.map((category) => category.name);

export const TOOLS_BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

/** Options for a select whose choices depend on another field. */
export function dependentOptions(tool, field, options) {
  if (tool.id === "units" && field.id === "from") {
    return options.category === "temperature" ? ["celsius", "fahrenheit", "kelvin", "rankine"] : Object.keys(maths.UNITS[options.category] ?? {});
  }
  return field.options ?? [];
}

export function searchTools(query) {
  const term = query.trim().toLowerCase();
  if (!term) return TOOLS;
  const words = term.split(/\s+/);
  return TOOLS
    .map((tool) => {
      const haystack = `${tool.name} ${tool.category} ${tool.blurb} ${(tool.keywords ?? []).join(" ")} ${tool.actions.join(" ")}`.toLowerCase();
      const score = words.reduce((total, word) => {
        if (tool.name.toLowerCase().startsWith(word)) return total + 6;
        if (tool.name.toLowerCase().includes(word)) return total + 4;
        if ((tool.keywords ?? []).some((keyword) => keyword.includes(word))) return total + 3;
        if (haystack.includes(word)) return total + 1;
        return total - 10;
      }, 0);
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.tool);
}
