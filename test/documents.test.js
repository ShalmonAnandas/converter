import test from "node:test";
import assert from "node:assert/strict";
import { createZip, readZip, inspectArchive, csvRowsToXlsx, xlsxToRows, xlsxToCsv, markdownToDocx, docxToMarkdown, markdownToPdf, columnName, columnIndex } from "../public/lib/office.js";
import { encodeQr, qrToSvg, qrToText, formatBits, versionBits, wifiPayload, vcardPayload } from "../public/lib/qrcode.js";

/* ------------------------------------------------------------------ zip -- */

test("ZIP writer creates independently readable archive entries", async () => {
  const body = "hello world ".repeat(200);
  const archive = await createZip({ "folder/example.txt": body, "empty.txt": "", "small.txt": "hi" });
  assert.equal(new DataView(archive.buffer).getUint32(0, true), 0x04034b50);
  assert.ok(archive.length < body.length, "the archive should be smaller than the raw body");
  const files = await readZip(archive.buffer);
  assert.equal(new TextDecoder().decode(files.get("folder/example.txt")), body);
  assert.equal(files.get("empty.txt").length, 0);
  assert.equal(new TextDecoder().decode(files.get("small.txt")), "hi");
});

test("ZIP reader rejects files that are not archives", async () => {
  await assert.rejects(() => readZip(new Uint8Array(64).buffer), /not a readable ZIP or Office archive/);
  await assert.rejects(() => readZip(new Uint8Array(4).buffer), /too small/);
});

test("archive inspection recognises Office packages", async () => {
  const docx = await markdownToDocx("# Title");
  const report = await inspectArchive(docx.buffer);
  assert.match(report, /Archive type\s+Word document \(DOCX\)/);
  assert.match(report, /word\/document\.xml/);
  assert.match(report, /deflate/);
});

/* ----------------------------------------------------------------- xlsx -- */

test("spreadsheet column names round trip", () => {
  for (const [index, name] of [[0, "A"], [25, "Z"], [26, "AA"], [51, "AZ"], [701, "ZZ"], [702, "AAA"]]) {
    assert.equal(columnName(index), name);
    assert.equal(columnIndex(name), index);
  }
});

test("CSV rows generate an XLSX package that reads back unchanged", async () => {
  const rows = [["name", "role", "score"], ["Ada", "Engineer", "97"], ["Lin", "QA", "88.5"], ["Zoë", "Design, Lead", "=2+2"]];
  const archive = await csvRowsToXlsx(rows);
  const files = await readZip(archive.buffer);
  for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"]) {
    assert.ok(files.has(part), `missing ${part}`);
  }
  const sheet = new TextDecoder().decode(files.get("xl/worksheets/sheet1.xml"));
  assert.doesNotMatch(sheet, /<f>/, "no formulas should be emitted");
  assert.match(sheet, /<v>97<\/v>/, "numeric cells should be typed");
  const { rows: parsed, sheetNames } = await xlsxToRows(archive.buffer);
  assert.deepEqual(parsed, rows);
  assert.deepEqual(sheetNames, ["Sheet1"]);
  assert.match(await xlsxToCsv(archive.buffer), /Zoë,"Design, Lead",=2\+2/);
});

test("reading a file that is not a workbook fails clearly", async () => {
  const archive = await createZip({ "a.txt": "hello" });
  await assert.rejects(() => xlsxToRows(archive.buffer), /not an XLSX workbook/);
});

/* ----------------------------------------------------------------- docx -- */

test("Markdown generates a Word package with styles, numbering, and tables", async () => {
  const archive = await markdownToDocx("# Title\n\nBody with **bold**.\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |", { title: "Report" });
  const files = await readZip(archive.buffer);
  for (const part of ["word/document.xml", "word/styles.xml", "word/numbering.xml", "docProps/core.xml"]) {
    assert.ok(files.has(part), `missing ${part}`);
  }
  const document = new TextDecoder().decode(files.get("word/document.xml"));
  assert.match(document, /Heading1/);
  assert.match(document, /<w:b\/>/);
  assert.match(document, /<w:tbl>/);
  assert.match(new TextDecoder().decode(files.get("word/styles.xml")), /w:styleId="Heading1"/);
});

test("DOCX reads back into the Markdown it came from", async () => {
  const source = "# Report\n\nIntro with **bold** and *italic*.\n\n- One\n- Two\n\n| Name | Role |\n| --- | --- |\n| Ada | Dev |";
  const archive = await markdownToDocx(source);
  const markdown = await docxToMarkdown(archive.buffer);
  assert.match(markdown, /^# Report$/m);
  assert.match(markdown, /\*\*bold\*\*/);
  assert.match(markdown, /^- One\n- Two$/m);
  assert.match(markdown, /^\| Name \| Role \|$/m);
  const plain = await createZip({ "a.txt": "x" });
  await assert.rejects(() => docxToMarkdown(plain.buffer), /does not contain word\/document\.xml/);
});

/* ------------------------------------------------------------------ pdf -- */

test("PDF output is structurally valid and paginates", () => {
  const blocks = [];
  for (let index = 0; index < 40; index++) {
    blocks.push(`## Section ${index}`, `Paragraph ${index} with an em dash — and a bullet • inside.`, "- item one\n- item two");
  }
  const bytes = markdownToPdf(blocks.join("\n\n"), { title: "Long document" });
  const pdf = new TextDecoder("latin1").decode(bytes);

  assert.ok(pdf.startsWith("%PDF-1.4"), "PDF header");
  assert.ok(pdf.trimEnd().endsWith("%%EOF"), "PDF trailer");
  assert.doesNotMatch(pdf, /NaN/, "no NaN coordinates");
  assert.ok(pdf.match(/\/Type \/Page[^s]/g).length >= 5, "should span several pages");

  const startxref = Number(/startxref\s+(\d+)/.exec(pdf)[1]);
  assert.equal(pdf.slice(startxref, startxref + 4), "xref");
  const table = pdf.slice(startxref).split("trailer")[0].split("\n");
  const count = Number(table[1].split(" ")[1]);
  for (let index = 1; index < count; index++) {
    const offset = Number(table[2 + index].split(" ")[0]);
    assert.ok(pdf.startsWith(`${index} 0 obj`, offset), `object ${index} offset is wrong`);
  }
  for (const match of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const declared = Number(match[1]);
    const actual = pdf.indexOf("\nendstream", match.index) - (match.index + match[0].length);
    assert.equal(declared, actual, "declared stream length must match the bytes written");
  }
  assert.match(pdf, /\\225/, "the bullet should be a WinAnsi escape, not a question mark");
});

/* ------------------------------------------------------------------- qr -- */

test("QR format and version bit strings match the published tables", () => {
  assert.equal(formatBits("L", 0).toString(2).padStart(15, "0"), "111011111000100");
  assert.equal(formatBits("M", 0).toString(2).padStart(15, "0"), "101010000010010");
  assert.equal(formatBits("Q", 0).toString(2).padStart(15, "0"), "011010101011111");
  assert.equal(formatBits("H", 0).toString(2).padStart(15, "0"), "001011010001001");
  assert.equal(versionBits(7), 0x07c94);
  assert.equal(versionBits(10), 0x0a4d3);
  assert.equal(versionBits(40), 0x28c69);
});

test("QR matrices carry correct function patterns", () => {
  const code = encodeQr("HELLO WORLD", { level: "Q" });
  assert.equal(code.version, 1);
  assert.equal(code.size, 21);
  assert.equal(code.mode, "alphanumeric");
  for (const [top, left] of [[0, 0], [0, code.size - 7], [code.size - 7, 0]]) {
    assert.equal(code.modules[top][left], 1, "finder ring");
    assert.equal(code.modules[top + 1][left + 1], 0, "finder gap");
    assert.equal(code.modules[top + 3][left + 3], 1, "finder core");
  }
  assert.equal(code.modules[code.size - 8][8], 1, "dark module");
  for (let index = 8; index < code.size - 8; index++) {
    assert.equal(code.modules[6][index], index % 2 === 0 ? 1 : 0, "timing row");
  }
});

test("QR selects a mode and version that fits the payload", () => {
  assert.equal(encodeQr("1234567890").mode, "numeric");
  assert.equal(encodeQr("HELLO 123").mode, "alphanumeric");
  assert.equal(encodeQr("hello").mode, "byte");
  assert.ok(encodeQr("a".repeat(400), { level: "L" }).version >= 7, "long payloads need version info blocks");
  assert.throws(() => encodeQr("z".repeat(3000), { level: "H" }), /too much data/);
  assert.throws(() => encodeQr(""), /Enter something to encode/);
});

test("QR renders to SVG and to text art", () => {
  const svg = qrToSvg("https://example.com", { level: "M", scale: 4 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /<path fill="#000000" d="M/);
  const { art, code } = qrToText("hi");
  assert.equal(art.split("\n").length, Math.ceil((code.size + 4) / 2));
});

test("QR payload helpers escape the reserved characters", () => {
  assert.equal(wifiPayload({ ssid: "Home;Wi-Fi", password: "p@ss:word", security: "WPA" }), "WIFI:T:WPA;S:Home\\;Wi-Fi;P:p@ss\\:word;;");
  assert.equal(wifiPayload({ ssid: "Open", security: "nopass" }), "WIFI:T:nopass;S:Open;;");
  assert.match(vcardPayload({ name: "Ada Lovelace", email: "ada@example.com" }), /^BEGIN:VCARD\nVERSION:3\.0\nN:Lovelace;Ada;;;\nFN:Ada Lovelace/);
  assert.throws(() => wifiPayload({}), /Enter the network name/);
});
