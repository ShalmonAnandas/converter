import test from "node:test";
import assert from "node:assert/strict";
import { createZip, readZip, csvRowsToXlsx, markdownToDocx } from "../public/office.js";

test("ZIP writer creates independently readable archive entries", async () => {
  const archive = createZip({ "folder/example.txt": "hello", "empty.txt": "" });
  assert.equal(new DataView(archive.buffer).getUint32(0, true), 0x04034b50);
  const files = await readZip(archive.buffer);
  assert.equal(new TextDecoder().decode(files.get("folder/example.txt")), "hello");
  assert.equal(files.get("empty.txt").length, 0);
});

test("CSV rows generate required XLSX package parts with literal cells", async () => {
  const archive = csvRowsToXlsx([["name", "value"], ["unsafe", "=2+2"]]);
  const files = await readZip(archive.buffer);
  assert.ok(files.has("xl/workbook.xml"));
  assert.ok(files.has("xl/worksheets/sheet1.xml"));
  const sheet = new TextDecoder().decode(files.get("xl/worksheets/sheet1.xml"));
  assert.match(sheet, /t="inlineStr"/);
  assert.doesNotMatch(sheet, /<f>/);
});

test("Markdown generates a Word package with real heading styles and A4 margins", async () => {
  const archive = markdownToDocx("# Title\n\nBody");
  const files = await readZip(archive.buffer);
  assert.ok(files.has("word/document.xml"));
  assert.ok(files.has("word/styles.xml"));
  assert.match(new TextDecoder().decode(files.get("word/document.xml")), /Heading1/);
  assert.match(new TextDecoder().decode(files.get("word/styles.xml")), /w:styleId="Heading1"/);
});
