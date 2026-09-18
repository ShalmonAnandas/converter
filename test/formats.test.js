import test from "node:test";
import assert from "node:assert/strict";
import { jsonTransform, jsonError, jsonDiff, jsonQuery, jsonToTypeScript, jsonToGo, jsonToSchema, jsonToSql, toNdjson, fromNdjson } from "../public/lib/json.js";
import { parseYaml, stringifyYaml } from "../public/lib/yaml.js";
import { parseToml, stringifyToml } from "../public/lib/toml.js";
import { parseXml, formatXml, minifyXml, xmlToJson, jsonToXml } from "../public/lib/xml.js";
import { parseCsv, detectDelimiter, convertCsv, csvToJson, jsonToCsv, csvToMarkdown } from "../public/lib/csv.js";

/* ---------------------------------------------------------------- json -- */

test("formats and recursively sorts JSON without reordering arrays", () => {
  assert.equal(
    jsonTransform('{"z":1,"a":{"b":2,"a":1},"list":[2,1]}', "sort", "2"),
    '{\n  "a": {\n    "a": 1,\n    "b": 2\n  },\n  "list": [\n    2,\n    1\n  ],\n  "z": 1\n}',
  );
});

test("reports JSON line and column", () => {
  const input = '{\n  "a": 1,\n}';
  let error;
  try { JSON.parse(input); } catch (caught) { error = caught; }
  const message = jsonError(error, input);
  assert.ok(/line 3, column 1/.test(message) || /line 3 column 1/.test(message), message);
});

test("diff reports added, removed, and changed paths", () => {
  const report = jsonDiff('{"a":1,"b":[1,2]}', '{"a":2,"b":[1,2,3],"c":true}');
  assert.match(report, /3 differences/);
  assert.match(report, /~ \$\.a/);
  assert.match(report, /\+ \$\.b\[2\] = 3/);
  assert.match(report, /\+ \$\.c = true/);
  assert.equal(jsonDiff('{"a":1}', '{"a":1}'), "The two documents are structurally identical.");
});

test("JSONPath handles wildcards, descent, indices, and slices", () => {
  const document = '{"users":[{"id":1,"name":"Ada"},{"id":2,"name":"Lin"}],"meta":{"id":9}}';
  assert.equal(jsonQuery(document, "$.users[*].name", "0"), '["Ada","Lin"]');
  assert.equal(jsonQuery(document, "$..id", "0"), "[1,2,9]");
  assert.equal(jsonQuery(document, "$.users[0].name", "0"), '"Ada"');
  assert.equal(jsonQuery(document, "$.users[-1].id", "0"), "2");
  assert.equal(jsonQuery(document, "$.users[0:1]", "0"), '{"id":1,"name":"Ada"}');
  assert.equal(jsonQuery(document, "$.missing", "0"), "No matches.");
});

test("TypeScript generation merges array member shapes into optional members", () => {
  const output = jsonToTypeScript('{"users":[{"id":1,"name":"Ada"},{"id":2,"nickname":"L"}]}', "Payload");
  assert.match(output, /export interface User \{/);
  assert.match(output, /name\?: string;/);
  assert.match(output, /nickname\?: string;/);
  assert.match(output, /users: User\[\];/);
  assert.doesNotMatch(output, /User2/);
});

test("Go generation aligns fields and marks optional members as pointers", () => {
  const output = jsonToGo('{"users":[{"id":1,"name":"Ada"},{"id":2}]}', "Payload");
  assert.match(output, /^package main/);
  assert.match(output, /Name\s+\*string\s+`json:"name,omitempty"`/);
  assert.match(output, /Id\s+int64\s+`json:"id"`/);
});

test("JSON Schema infers types, formats, and required members", () => {
  const schema = JSON.parse(jsonToSchema('{"email":"a@b.co","count":3,"ratio":0.5,"when":"2026-09-18T00:00:00Z"}'));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.properties.email.format, "email");
  assert.equal(schema.properties.when.format, "date-time");
  assert.equal(schema.properties.count.type, "integer");
  assert.equal(schema.properties.ratio.type, "number");
  assert.deepEqual(schema.required, ["email", "count", "ratio", "when"]);
});

test("SQL generation quotes identifiers and escapes literals per dialect", () => {
  const postgres = jsonToSql('[{"id":1,"name":"O\'Hara"}]', "people");
  assert.match(postgres, /CREATE TABLE "people"/);
  assert.match(postgres, /'O''Hara'/);
  const mysql = jsonToSql('[{"id":1,"name":"x"}]', "people", "mysql");
  assert.match(mysql, /CREATE TABLE `people`/);
  assert.throws(() => jsonToSql('[1,2]'), /array of objects/);
});

test("NDJSON round trips through an array", () => {
  assert.equal(toNdjson('[{"a":1},{"a":2}]'), '{"a":1}\n{"a":2}');
  assert.equal(fromNdjson('{"a":1}\n{"a":2}', "0"), '[{"a":1},{"a":2}]');
  assert.throws(() => fromNdjson("{oops}"), /Line 1 is not valid JSON/);
});

/* ---------------------------------------------------------------- yaml -- */

test("YAML reads block maps, sequences, flow collections, and block scalars", () => {
  const value = parseYaml([
    "# a comment",
    "name: converter",
    "port: 3000",
    "ratio: 0.5",
    "enabled: true",
    "empty: ~",
    "tags: [a, b, 'c d']",
    "matrix: {os: linux, node: 22}",
    "authors:",
    "  - name: Ada",
    "    roles:",
    "      - dev",
    "  - name: Lin",
    "description: |",
    "  line one",
    "  line two",
    "folded: >",
    "  a b",
    "  c",
  ].join("\n"));
  assert.equal(value.name, "converter");
  assert.equal(value.port, 3000);
  assert.equal(value.ratio, 0.5);
  assert.equal(value.enabled, true);
  assert.equal(value.empty, null);
  assert.deepEqual(value.tags, ["a", "b", "c d"]);
  assert.deepEqual(value.matrix, { os: "linux", node: 22 });
  assert.deepEqual(value.authors[0], { name: "Ada", roles: ["dev"] });
  assert.equal(value.description, "line one\nline two\n");
  assert.equal(value.folded, "a b c\n");
});

test("YAML writing round trips every value shape", () => {
  const cases = [
    { name: "converter", list: [{ a: 1, b: [1, 2] }, "plain"], text: "one\ntwo\n", keep: "a\n\n", strip: "x\ny" },
    [1, 2, [3, 4], { a: null }],
    { empty: {}, emptyList: [], negative: -1.5e10, bool: false, yes: "yes", colon: "a: b", hash: "a # b", dash: "-x" },
    { "key with space": 1, "a:b": 2, "": 3 },
  ];
  for (const value of cases) {
    assert.deepEqual(parseYaml(stringifyYaml(value)), value, JSON.stringify(value));
  }
});

/* ---------------------------------------------------------------- toml -- */

test("TOML reads tables, arrays of tables, dotted keys, and typed values", () => {
  const value = parseToml([
    'title = "Converter"',
    "enabled = true",
    "port = 3_000",
    "hex = 0xFF",
    "when = 2026-09-18T10:00:00Z",
    'multi = [\n  "a",\n  "b",\n]',
    "inline = { x = 1, y = 2 }",
    "dotted.a.b = 1",
    "",
    "[server]",
    'host = "localhost"',
    "",
    "[[products]]",
    'name = "Hammer"',
    "",
    "[[products]]",
    'name = "Nail"',
  ].join("\n"));
  assert.equal(value.port, 3000);
  assert.equal(value.hex, 255);
  assert.equal(value.when, "2026-09-18T10:00:00Z");
  assert.deepEqual(value.multi, ["a", "b"]);
  assert.deepEqual(value.inline, { x: 1, y: 2 });
  assert.deepEqual(value.dotted, { a: { b: 1 } });
  assert.equal(value.server.host, "localhost");
  assert.deepEqual(value.products.map((entry) => entry.name), ["Hammer", "Nail"]);
});

test("TOML writing round trips and rejects malformed input", () => {
  const value = { title: "Converter", count: 3, ok: true, list: [1, 2], nested: { a: { b: "c" } }, rows: [{ id: 1 }, { id: 2 }] };
  assert.deepEqual(parseToml(stringifyToml(value)), value);
  assert.throws(() => parseToml("x = [1,"), /Unterminated array/);
  assert.throws(() => parseToml("a = 1\na = 2"), /defined twice/);
  assert.throws(() => stringifyToml([1, 2]), /object at the root/);
});

/* ----------------------------------------------------------------- xml -- */

test("XML formatting and minification preserve content", () => {
  const source = '<catalog count="2"><item id="1"><name>Local &amp; fast</name></item></catalog>';
  const formatted = formatXml(source);
  assert.match(formatted, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(formatted, /^ {2}<item id="1">$/m);
  assert.match(minifyXml(formatted), /<name>Local &amp; fast<\/name>/);
});

test("XML parsing refuses external entities and malformed documents", () => {
  assert.throws(() => parseXml('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a>&xxe;</a>'), /Inline DTD subsets are rejected/);
  assert.throws(() => parseXml('<!DOCTYPE foo SYSTEM "http://evil/x.dtd"><a/>'), /External DTD references are rejected/);
  assert.throws(() => parseXml("<a>&unknown;</a>"), /Unknown entity/);
  assert.throws(() => parseXml("<a><b></a>"), /does not match/);
  assert.throws(() => parseXml("<a></a><b></b>"), /only have one root element/);
  assert.throws(() => parseXml("<a"), /never closed/);
});

test("XML converts to JSON and back", () => {
  const source = '<catalog count="2"><item id="1"><name>Tools</name><price>9.5</price></item><item id="2"><name>Fast</name><price>12</price></item></catalog>';
  const value = JSON.parse(xmlToJson(source));
  assert.equal(value.catalog["@count"], "2");
  assert.equal(value.catalog.item.length, 2);
  assert.equal(value.catalog.item[0].price, 9.5);
  assert.match(jsonToXml(JSON.stringify(value)), /<item id="1">/);
});

test("HTML mode accepts real-world markup", () => {
  const document = parseXml('<div class=box><p>One<p>Two<br><input disabled checked><script>a<b</script></div>', { html: true });
  assert.equal(document.root.name, "div");
  assert.equal(document.root.children.filter((node) => node.type === "element" && node.name === "p").length, 2);
});

/* ----------------------------------------------------------------- csv -- */

test("CSV parser preserves quoted delimiters and line breaks", () => {
  assert.deepEqual(parseCsv('name,note\nAda,"one,two"\nLin,"line 1\nline 2"'), [["name", "note"], ["Ada", "one,two"], ["Lin", "line 1\nline 2"]]);
  assert.deepEqual(parseCsv("a,,c\n1,2,"), [["a", "", "c"], ["1", "2", ""]]);
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
  assert.throws(() => parseCsv('a,"b'), /ends inside a quoted field/);
});

test("spreadsheet conversion protects formula-like values", () => {
  const result = convertCsv("name,value\nunsafe,=2+2", "auto", "\t");
  assert.equal(result.output, "name\tvalue\nunsafe\t'=2+2");
  assert.deepEqual([result.rows, result.columns], [2, 2]);
});

test("CSV converts to JSON, back, and to a Markdown table", () => {
  const records = JSON.parse(csvToJson("id,name,active\n1,Ada,true\n2,Lin,false"));
  assert.deepEqual(records[0], { id: 1, name: "Ada", active: true });
  assert.equal(jsonToCsv(JSON.stringify(records)), "id,name,active\n1,Ada,true\n2,Lin,false");
  assert.match(csvToMarkdown("id,name\n1,Ada"), /^\| id {2}\| name \|$/m);
});
