import test from "node:test";
import assert from "node:assert/strict";
import { convertCsv, detectDelimiter, generateHash, inspectJwt, markdownToHtml, parseCsv } from "../public/tools.js";

test("CSV parser preserves quoted delimiters and line breaks", () => {
  assert.deepEqual(parseCsv('name,note\nAda,"one,two"\nLin,"line 1\nline 2"'), [["name", "note"], ["Ada", "one,two"], ["Lin", "line 1\nline 2"]]);
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
});

test("spreadsheet conversion protects formula-like values", () => {
  const result = convertCsv("name,value\nunsafe,=2+2", "auto", "\t");
  assert.equal(result.output, "name\tvalue\nunsafe\t'=2+2");
  assert.deepEqual([result.rows, result.columns], [2, 2]);
});

test("JWT inspection decodes claims and explicitly disclaims verification", () => {
  const token = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIiwiZXhwIjoxfQ.";
  const result = inspectJwt(token);
  assert.equal(result.header.alg, "none");
  assert.equal(result.timestamps.exp, "1970-01-01T00:00:01.000Z");
  assert.match(result.warning, /not been verified/);
});

test("hash generator returns known SHA-256 output", async () => {
  assert.equal(await generateHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("Markdown conversion supports structure and escapes active HTML", () => {
  const output = markdownToHtml("# Title\n\n**safe** <script>alert(1)</script>\n\n- one");
  assert.match(output, /<h1>Title<\/h1>/);
  assert.match(output, /<strong>safe<\/strong>/);
  assert.doesNotMatch(output, /<script>/);
  assert.match(output, /<ul>/);
});
