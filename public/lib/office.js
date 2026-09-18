// ZIP container handling plus the Office and PDF documents built on top of it.
// Everything here runs locally: archives are assembled and taken apart in
// memory, with entry-count, expanded-size, and path-traversal limits applied to
// anything read from disk.

import { crc32, formatBytes } from "./bytes.js";
import { parseXml, escapeXml } from "./xml.js";
import { parseCsv, detectDelimiter, serializeRows } from "./csv.js";

const encoder = new TextEncoder();

const MAX_ENTRIES = 4000;
const MAX_EXPANDED = 150 * 1024 * 1024;

/* ------------------------------------------------------------------ zip -- */

function write16(view, offset, value) { view.setUint16(offset, value, true); }
function write32(view, offset, value) { view.setUint32(offset, value, true); }

async function deflate(bytes) {
  if (typeof CompressionStream === "undefined" || bytes.length < 128) return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return compressed.length < bytes.length ? compressed : null;
  } catch {
    return null;
  }
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** Builds a ZIP archive, deflating entries when the platform can and it helps. */
export async function createZip(files, { compress = true } = {}) {
  const { time, day } = dosDateTime();
  const entries = [];
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const compressed = compress ? await deflate(data) : null;
    entries.push({
      name: encoder.encode(name),
      data,
      payload: compressed ?? data,
      method: compressed ? 8 : 0,
      checksum: crc32(data),
    });
  }
  const localSize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.payload.length, 0);
  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  let offset = 0;

  for (const entry of entries) {
    entry.start = offset;
    write32(view, offset, 0x04034b50);
    write16(view, offset + 4, 20);
    write16(view, offset + 6, 0x0800);
    write16(view, offset + 8, entry.method);
    write16(view, offset + 10, time);
    write16(view, offset + 12, day);
    write32(view, offset + 14, entry.checksum);
    write32(view, offset + 18, entry.payload.length);
    write32(view, offset + 22, entry.data.length);
    write16(view, offset + 26, entry.name.length);
    offset += 30;
    output.set(entry.name, offset);
    offset += entry.name.length;
    output.set(entry.payload, offset);
    offset += entry.payload.length;
  }

  const centralOffset = offset;
  for (const entry of entries) {
    write32(view, offset, 0x02014b50);
    write16(view, offset + 4, 20);
    write16(view, offset + 6, 20);
    write16(view, offset + 8, 0x0800);
    write16(view, offset + 10, entry.method);
    write16(view, offset + 12, time);
    write16(view, offset + 14, day);
    write32(view, offset + 16, entry.checksum);
    write32(view, offset + 20, entry.payload.length);
    write32(view, offset + 24, entry.data.length);
    write16(view, offset + 28, entry.name.length);
    write32(view, offset + 42, entry.start);
    offset += 46;
    output.set(entry.name, offset);
    offset += entry.name.length;
  }

  write32(view, offset, 0x06054b50);
  write16(view, offset + 8, entries.length);
  write16(view, offset + 10, entries.length);
  write32(view, offset + 12, centralSize);
  write32(view, offset + 16, centralOffset);
  return output;
}

function findEndOfCentralDirectory(view, length) {
  const lowest = Math.max(0, length - 65557);
  for (let offset = length - 22; offset >= lowest; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

export async function readZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 22) throw new Error("The file is too small to be a ZIP or Office archive");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(view, bytes.length);
  if (end === -1) throw new Error("The file is not a readable ZIP or Office archive");

  const entryCount = view.getUint16(end + 10, true);
  if (entryCount > MAX_ENTRIES) throw new Error(`The archive declares ${entryCount} entries, above the ${MAX_ENTRIES} safety limit`);
  let offset = view.getUint32(end + 16, true);
  let expanded = 0;
  const files = new Map();
  const listing = [];

  for (let count = 0; count < entryCount; count++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error("The ZIP central directory is invalid");
    const method = view.getUint16(offset + 10, true);
    const modifiedTime = view.getUint16(offset + 12, true);
    const modifiedDay = view.getUint16(offset + 14, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    expanded += size;
    if (expanded > MAX_EXPANDED) throw new Error(`The expanded archive exceeds the ${formatBytes(MAX_EXPANDED)} safety limit`);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) throw new Error(`The archive contains an unsafe path: ${name}`);
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`Entry "${name}" points at an invalid local record`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const stored = bytes.subarray(start, start + compressedSize);

    let data;
    if (name.endsWith("/")) data = new Uint8Array();
    else if (method === 0) data = stored;
    else if (method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot inflate deflate-compressed archives");
      data = await inflate(stored);
    } else throw new Error(`Entry "${name}" uses unsupported compression method ${method}`);

    files.set(name, data);
    listing.push({ name, size, compressedSize, method, crc: view.getUint32(offset + 16, true), modified: dosToDate(modifiedDay, modifiedTime) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!files.size) throw new Error("The archive does not contain any entries");
  files.listing = listing;
  return files;
}

function dosToDate(day, time) {
  const year = ((day >> 9) & 0x7f) + 1980;
  const month = ((day >> 5) & 0x0f) - 1;
  const date = day & 0x1f;
  const hours = (time >> 11) & 0x1f;
  const minutes = (time >> 5) & 0x3f;
  const seconds = (time & 0x1f) * 2;
  const value = new Date(Date.UTC(year, Math.max(0, month), Math.max(1, date), hours, minutes, seconds));
  return Number.isNaN(value.getTime()) ? null : value;
}

export async function inspectArchive(buffer) {
  const files = await readZip(buffer);
  const listing = files.listing ?? [];
  const totalSize = listing.reduce((sum, entry) => sum + entry.size, 0);
  const totalCompressed = listing.reduce((sum, entry) => sum + entry.compressedSize, 0);
  const kind = files.has("word/document.xml") ? "Word document (DOCX)"
    : files.has("xl/workbook.xml") ? "Excel workbook (XLSX)"
      : files.has("ppt/presentation.xml") ? "PowerPoint deck (PPTX)"
        : files.has("META-INF/MANIFEST.MF") ? "Java archive (JAR)"
          : files.has("mimetype") ? "OpenDocument or EPUB package"
            : "ZIP archive";
  const nameWidth = Math.min(60, Math.max(4, ...listing.map((entry) => entry.name.length)));
  const rows = listing.map((entry) => [
    entry.name.length > nameWidth ? `…${entry.name.slice(-(nameWidth - 1))}` : entry.name.padEnd(nameWidth),
    formatBytes(entry.size).padStart(10),
    formatBytes(entry.compressedSize).padStart(10),
    (entry.method === 8 ? "deflate" : "stored").padEnd(7),
    entry.crc.toString(16).padStart(8, "0"),
    entry.modified ? entry.modified.toISOString().slice(0, 16).replace("T", " ") : "—",
  ].join("  "));
  return [
    `Archive type     ${kind}`,
    `Entries          ${listing.length}`,
    `Uncompressed     ${formatBytes(totalSize)}`,
    `Compressed       ${formatBytes(totalCompressed)}`,
    `Ratio            ${totalSize ? `${((1 - totalCompressed / totalSize) * 100).toFixed(1)}% saved` : "—"}`,
    "",
    `${"Name".padEnd(nameWidth)}  ${"Size".padStart(10)}  ${"Stored".padStart(10)}  ${"Method".padEnd(7)}  CRC32     Modified`,
    `${"-".repeat(nameWidth)}  ${"-".repeat(10)}  ${"-".repeat(10)}  ${"-".repeat(7)}  --------  ----------------`,
    ...rows,
  ].join("\n");
}

/* ----------------------------------------------------------------- xlsx -- */

export function columnName(index) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

export function columnIndex(name) {
  let value = 0;
  for (const letter of name.toUpperCase()) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value - 1;
}

const NUMERIC = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export async function csvRowsToXlsx(rows, { sheetName = "Sheet1", headerRow = true } = {}) {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const columnWidths = Array.from({ length: width }, (_, column) => Math.min(60, Math.max(10, ...rows.map((row) => String(row[column] ?? "").length + 2))));
  const sheet = rows.map((row, rowIndex) => {
    const cells = row.map((value, column) => {
      const reference = `${columnName(column)}${rowIndex + 1}`;
      const text = String(value ?? "");
      const style = headerRow && rowIndex === 0 ? ' s="1"' : "";
      if (text !== "" && NUMERIC.test(text) && Math.abs(Number(text)) < 1e15) return `<c r="${reference}"${style}><v>${Number(text)}</v></c>`;
      if (text === "") return `<c r="${reference}"${style}/>`;
      return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const columns = columnWidths.map((size, index) => `<col min="${index + 1}" max="${index + 1}" width="${size}" customWidth="1"/>`).join("");
  const dimension = `A1:${columnName(width - 1)}${Math.max(1, rows.length)}`;

  return createZip({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFF5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"${headerRow && rows.length > 1 ? '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>' : "/>"}</sheetViews><cols>${columns}</cols><sheetData>${sheet}</sheetData></worksheet>`,
  });
}

export async function xlsxToRows(buffer, { sheet = 1 } = {}) {
  const files = await readZip(buffer);
  const decode = (name) => (files.has(name) ? new TextDecoder().decode(files.get(name)) : "");
  if (!files.has("xl/workbook.xml")) throw new Error("That file is not an XLSX workbook");

  const sharedSource = decode("xl/sharedStrings.xml");
  const shared = sharedSource
    ? collect(parseXml(sharedSource).root, "si").map((node) => collect(node, "t").map(textOf).join(""))
    : [];

  const workbook = parseXml(decode("xl/workbook.xml"));
  const sheets = collect(workbook.root, "sheet");
  if (!sheets.length) throw new Error("The workbook does not declare any worksheets");
  const index = Math.min(Math.max(1, sheet), sheets.length) - 1;
  const relationshipId = attributeOf(sheets[index], "r:id") ?? attributeOf(sheets[index], "id");
  const relationships = decode("xl/_rels/workbook.xml.rels");
  const target = relationships
    ? collect(parseXml(relationships).root, "Relationship").find((node) => attributeOf(node, "Id") === relationshipId)
    : null;
  const rawPath = attributeOf(target, "Target")?.replace(/^\//, "") ?? `worksheets/sheet${index + 1}.xml`;
  const path = rawPath.startsWith("xl/") ? rawPath : `xl/${rawPath.replace(/^\.\//, "")}`;
  const xml = decode(path);
  if (!xml) throw new Error(`The workbook does not contain "${path}"`);

  const rows = [];
  for (const rowNode of collect(parseXml(xml).root, "row")) {
    const row = [];
    for (const cell of collect(rowNode, "c")) {
      const reference = attributeOf(cell, "r") ?? "";
      const column = reference ? columnIndex(reference.match(/[A-Z]+/i)?.[0] ?? "A") : row.length;
      const type = attributeOf(cell, "t");
      let value;
      if (type === "inlineStr") value = collect(cell, "t").map(textOf).join("");
      else if (type === "s") value = shared[Number(collect(cell, "v").map(textOf).join(""))] ?? "";
      else if (type === "str") value = collect(cell, "v").map(textOf).join("");
      else if (type === "b") value = collect(cell, "v").map(textOf).join("") === "1" ? "TRUE" : "FALSE";
      else value = collect(cell, "v").map(textOf).join("");
      for (let fill = row.length; fill < column; fill++) row.push("");
      row[column] = value;
    }
    rows.push(row);
  }
  return { rows, sheetNames: sheets.map((node) => attributeOf(node, "name") ?? "Sheet"), active: index };
}

export async function xlsxToCsv(buffer, { sheet = 1, delimiter = "," } = {}) {
  const { rows } = await xlsxToRows(buffer, { sheet });
  return serializeRows(rows.map((row) => Array.from(row, (value) => value ?? "")), delimiter, { protect: false });
}

function collect(node, name) {
  const results = [];
  const walk = (current) => {
    for (const child of current.children ?? []) {
      if (child.type !== "element") continue;
      if (localName(child.name) === name) results.push(child);
      else walk(child);
    }
  };
  if (node && localName(node.name) === name) return [node, ...(() => { walk(node); return []; })()];
  walk(node);
  return results;
}

function localName(name) { return String(name).split(":").at(-1); }
function attributeOf(node, name) { return node?.attributes?.find((attribute) => attribute.name === name || localName(attribute.name) === localName(name))?.value; }
function textOf(node) {
  return (node.children ?? []).map((child) => (child.type === "text" || child.type === "cdata" ? child.value : child.type === "element" ? textOf(child) : "")).join("");
}

/* ----------------------------------------------------------------- docx -- */

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function runsFromMarkdown(text) {
  const tokens = [];
  const pattern = /(\*\*\*|\*\*|__|\*|_|`|~~)(.+?)\1/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) tokens.push({ text: text.slice(last, match.index), marks: {} });
    const marker = match[1];
    const marks = {
      bold: marker === "**" || marker === "__" || marker === "***",
      italic: marker === "*" || marker === "_" || marker === "***",
      code: marker === "`",
      strike: marker === "~~",
    };
    tokens.push({ text: match[2], marks });
    last = pattern.lastIndex;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), marks: {} });
  return tokens.length ? tokens : [{ text, marks: {} }];
}

function wordRun({ text, marks }) {
  const properties = [
    marks.bold ? "<w:b/>" : "",
    marks.italic ? "<w:i/>" : "",
    marks.strike ? "<w:strike/>" : "",
    marks.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : "",
  ].join("");
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

export async function markdownToDocx(markdown, { title = "" } = {}) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const body = [];
  let inCode = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; continue; }
    if (inCode) {
      body.push(`<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${wordRun({ text: line, marks: { code: true } })}</w:p>`);
      continue;
    }
    if (!line.trim()) { body.push("<w:p/>"); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>');
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${heading[1].length}"/></w:pPr>${runsFromMarkdown(heading[2]).map(wordRun).join("")}</w:p>`);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      body.push(`<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>${runsFromMarkdown(quote[1]).map(wordRun).join("")}</w:p>`);
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const level = Math.min(2, Math.floor(item[1].replace(/\t/g, "    ").length / 2));
      const numbered = /\d/.test(item[2]);
      body.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numbered ? 2 : 1}"/></w:numPr></w:pPr>${runsFromMarkdown(item[3]).map(wordRun).join("")}</w:p>`);
      continue;
    }
    const tableRow = /^\s*\|(.+)\|\s*$/.exec(line);
    if (tableRow && lines[index + 1] && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[index + 1])) {
      const rows = [];
      let cursor = index;
      while (cursor < lines.length && /^\s*\|(.+)\|\s*$/.test(lines[cursor])) {
        if (cursor !== index + 1) rows.push(/^\s*\|(.+)\|\s*$/.exec(lines[cursor])[1].split("|").map((cell) => cell.trim()));
        cursor++;
      }
      body.push(wordTable(rows));
      index = cursor - 1;
      continue;
    }
    body.push(`<w:p>${runsFromMarkdown(line).map(wordRun).join("")}</w:p>`);
  }

  return createZip({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORD_NS}"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
    "word/_rels/document.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
    "word/numbering.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${WORD_NS}"><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${[0, 1, 2].map((level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${["•", "◦", "▪"][level]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join("")}</w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${[0, 1, 2].map((level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${["decimal", "lowerLetter", "lowerRoman"][level]}"/><w:lvlText w:val="%${level + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join("")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>`,
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${Array.from({ length: 6 }, (_, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="${index}"/><w:spacing w:before="${360 - index * 30}" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${36 - index * 3}"/></w:rPr></w:style>`).join("")}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:spacing w:after="60"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="AAAAAA"/></w:pBdr></w:pPr><w:rPr><w:i/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="HTML Preformatted"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:fill="F3F3F7"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style></w:styles>`,
  });
}

function wordTable(rows) {
  if (!rows.length) return "<w:p/>";
  const width = Math.max(...rows.map((row) => row.length));
  const grid = Array.from({ length: width }, () => `<w:gridCol w:w="${Math.floor(9638 / width)}"/>`).join("");
  const body = rows.map((row, rowIndex) => {
    const cells = Array.from({ length: width }, (_, column) => {
      const runs = runsFromMarkdown(row[column] ?? "").map((token) => wordRun({ ...token, marks: { ...token.marks, bold: token.marks.bold || rowIndex === 0 } }));
      const shading = rowIndex === 0 ? '<w:shd w:val="clear" w:fill="EFEFF5"/>' : "";
      return `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9638 / width)}" w:type="dxa"/>${shading}</w:tcPr><w:p>${runs.join("")}</w:p></w:tc>`;
    }).join("");
    return `<w:tr>${cells}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideH w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideV w:val="single" w:sz="4" w:color="CCCCCC"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

export async function docxToMarkdown(buffer) {
  const files = await readZip(buffer);
  const source = files.get("word/document.xml");
  if (!source) throw new Error("The DOCX archive does not contain word/document.xml");
  const document = parseXml(new TextDecoder().decode(source));
  const output = [];

  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (child.type !== "element") continue;
      const name = localName(child.name);
      if (name === "p") { output.push(paragraphToMarkdown(child)); continue; }
      if (name === "tbl") { output.push(tableToMarkdown(child)); continue; }
      walk(child);
    }
  };
  walk(document.root);
  const blocks = [];
  for (const entry of output) {
    const previous = blocks.at(-1);
    const isList = /^\s*([-*+]|\d+\.)\s/.test(entry);
    const isTable = entry.startsWith("|");
    if (previous !== undefined && entry && ((isList && /^\s*([-*+]|\d+\.)\s/.test(previous)) || (isTable && previous.startsWith("|")))) {
      blocks[blocks.length - 1] = `${previous}\n${entry}`;
      continue;
    }
    blocks.push(entry);
  }
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function paragraphToMarkdown(paragraph) {
  const style = collect(paragraph, "pStyle")[0];
  const styleName = style ? attributeOf(style, "val") ?? "" : "";
  const numbering = collect(paragraph, "numPr")[0];
  const level = numbering ? Number(attributeOf(collect(numbering, "ilvl")[0] ?? {}, "val") ?? 0) : 0;
  const numberId = numbering ? attributeOf(collect(numbering, "numId")[0] ?? {}, "val") : null;
  const text = collect(paragraph, "r").map(runToMarkdown).join("").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const heading = /^Heading([1-6])$/.exec(styleName);
  if (heading) return `${"#".repeat(Number(heading[1]))} ${text}`;
  if (styleName === "Quote") return `> ${text}`;
  if (styleName === "Code") return `    ${text}`;
  if (numbering) return `${"  ".repeat(level)}${numberId === "2" ? "1." : "-"} ${text}`;
  return text;
}

function runToMarkdown(run) {
  const text = collect(run, "t").map(textOf).join("");
  if (!text) return collect(run, "br").length ? "\n" : "";
  const properties = collect(run, "rPr")[0];
  if (!properties) return text;
  const has = (name) => collect(properties, name).length > 0;
  const fonts = collect(properties, "rFonts")[0];
  const monospaced = /consolas|courier|menlo|monaco|mono/i.test(attributeOf(fonts ?? {}, "ascii") ?? "");
  let output = text;
  if (monospaced) output = `\`${output}\``;
  if (has("strike")) output = `~~${output}~~`;
  if (has("b")) output = `**${output}**`;
  if (has("i")) output = `*${output}*`;
  return output;
}

function tableToMarkdown(table) {
  const rows = collect(table, "tr").map((row) => collect(row, "tc").map((cell) => collect(cell, "p").map(paragraphToMarkdown).join(" ").replaceAll("|", "\\|").trim()));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalize = (row) => Array.from({ length: width }, (_, index) => row[index] ?? "");
  const header = normalize(rows[0]).map((cell) => cell.replace(/^\*\*(.*)\*\*$/, "$1"));
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${normalize(row).join(" | ")} |`),
  ].join("\n");
}

/* ------------------------------------------------------------------ pdf -- */

const HELVETICA_WIDTHS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVETICA_BOLD_WIDTHS = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

const PDF_FONTS = {
  regular: { resource: "F1", base: "Helvetica", widths: HELVETICA_WIDTHS },
  bold: { resource: "F2", base: "Helvetica-Bold", widths: HELVETICA_BOLD_WIDTHS },
  mono: { resource: "F3", base: "Courier", widths: null },
};

function glyphWidth(font, code, size) {
  if (!font.widths) return (600 / 1000) * size;
  const index = code - 32;
  const width = index >= 0 && index < font.widths.length ? font.widths[index] : 556;
  return (width / 1000) * size;
}

function measure(font, text, size) {
  let total = 0;
  for (const character of text) total += glyphWidth(font, character.codePointAt(0), size);
  return total;
}

function wrapForPdf(font, text, size, maxWidth) {
  if (!text) return [""];
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(font, candidate, size) <= maxWidth) { line = candidate; continue; }
    if (line) lines.push(line);
    if (measure(font, word, size) <= maxWidth) { line = word; continue; }
    let chunk = "";
    for (const character of word) {
      if (measure(font, chunk + character, size) > maxWidth) { lines.push(chunk); chunk = character; }
      else chunk += character;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// WinAnsi code points for the punctuation Markdown actually produces.
const WIN_ANSI = {
  "\u20ac": 0x80, "\u201a": 0x82, "\u0192": 0x83, "\u201e": 0x84, "\u2026": 0x85, "\u2020": 0x86,
  "\u2021": 0x87, "\u02c6": 0x88, "\u2030": 0x89, "\u0160": 0x8a, "\u2039": 0x8b, "\u0152": 0x8c,
  "\u017d": 0x8e, "\u2018": 0x91, "\u2019": 0x92, "\u201c": 0x93, "\u201d": 0x94, "\u2022": 0x95,
  "\u2013": 0x96, "\u2014": 0x97, "\u02dc": 0x98, "\u2122": 0x99, "\u0161": 0x9a, "\u203a": 0x9b,
  "\u0153": 0x9c, "\u017e": 0x9e, "\u0178": 0x9f,
};

/** Escapes text for a PDF literal string, keeping the stream pure ASCII so the
 *  declared /Length always matches the bytes written. */
function pdfString(text) {
  let output = "";
  for (const character of text) {
    const code = character.codePointAt(0);
    if (character === "(" || character === ")" || character === "\\") { output += `\\${character}`; continue; }
    if (code < 32) { output += " "; continue; }
    if (code < 127) { output += character; continue; }
    const byte = WIN_ANSI[character] ?? (code <= 255 ? code : null);
    output += byte === null ? "?" : `\\${byte.toString(8).padStart(3, "0")}`;
  }
  return output;
}

const PAGE_SIZES = { A4: [595.28, 841.89], Letter: [612, 792], Legal: [612, 1008], A5: [419.53, 595.28] };

/** Renders Markdown-ish text into a real, standards-compliant PDF. */
export function markdownToPdf(markdown, { pageSize = "A4", margin = 56, fontSize = 11, title = "" } = {}) {
  const [pageWidth, pageHeight] = PAGE_SIZES[pageSize] ?? PAGE_SIZES.A4;
  const contentWidth = pageWidth - margin * 2;
  const pages = [];
  let operations = [];
  let cursor = pageHeight - margin;

  const newPage = () => { pages.push(operations); operations = []; cursor = pageHeight - margin; };
  const ensure = (needed) => { if (cursor - needed < margin) newPage(); };
  const draw = (text, { font = PDF_FONTS.regular, size = fontSize, indent = 0, leading = 1.45, gapBefore = 0, gapAfter = 4 } = {}) => {
    cursor -= gapBefore;
    const lines = wrapForPdf(font, text, size, contentWidth - indent);
    for (const line of lines) {
      ensure(size * leading);
      cursor -= size * leading;
      operations.push(`BT /${font.resource} ${size} Tf ${(margin + indent).toFixed(2)} ${cursor.toFixed(2)} Td (${pdfString(line)}) Tj ET`);
    }
    cursor -= gapAfter;
  };
  const rule = () => {
    ensure(12);
    cursor -= 8;
    operations.push(`0.75 w 0.8 0.8 0.84 RG ${margin} ${cursor.toFixed(2)} m ${(pageWidth - margin).toFixed(2)} ${cursor.toFixed(2)} l S`);
    cursor -= 8;
  };

  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  let inCode = false;
  let orderedCounter = 0;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; cursor -= 4; continue; }
    if (inCode) { draw(line || " ", { font: PDF_FONTS.mono, size: fontSize - 1, indent: 14, leading: 1.25, gapAfter: 0 }); continue; }
    if (!line.trim()) { cursor -= fontSize * 0.6; orderedCounter = 0; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { rule(); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      draw(stripInline(heading[2]), { font: PDF_FONTS.bold, size: fontSize + Math.max(0, 9 - level * 1.6), gapBefore: level === 1 ? 10 : 8, gapAfter: 5 });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { draw(stripInline(quote[1]), { indent: 18, gapAfter: 3 }); continue; }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const depth = Math.floor(item[1].replace(/\t/g, "    ").length / 2);
      const numbered = /\d/.test(item[2]);
      const marker = numbered ? `${++orderedCounter}.` : "•";
      draw(`${marker} ${stripInline(item[3])}`, { indent: 14 + depth * 16, gapAfter: 2 });
      continue;
    }
    const table = /^\s*\|(.+)\|\s*$/.exec(line);
    if (table) {
      if (/^[\s:|-]+$/.test(table[1])) continue;
      draw(table[1].split("|").map((cell) => cell.trim()).join("   "), { font: PDF_FONTS.mono, size: fontSize - 1, gapAfter: 1 });
      continue;
    }
    draw(stripInline(line.trim()));
  }
  pages.push(operations);

  return assemblePdf(pages.filter((page) => page.length), pageWidth, pageHeight, title);
}

function stripInline(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, "$1 ($2)")
    .replace(/(\*\*\*|\*\*|__|\*|_|`|~~)(.+?)\1/g, "$2");
}

function assemblePdf(pages, pageWidth, pageHeight, title) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };

  const fontIds = Object.values(PDF_FONTS).map((font) => ({
    font,
    id: add(`<< /Type /Font /Subtype /Type1 /BaseFont /${font.base} /Encoding /WinAnsiEncoding >>`),
  }));
  const resources = `<< /Font << ${fontIds.map(({ font, id }) => `/${font.resource} ${id} 0 R`).join(" ")} >> >>`;

  const pagesId = objects.length + 1 + pages.length * 2;
  const pageIds = [];
  for (const operations of pages) {
    const stream = operations.join("\n");
    const contentId = add(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources ${resources} /Contents ${contentId} 0 R >>`));
  }
  const pagesObject = add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const infoId = add(`<< /Title (${pdfString(title || "Converter document")}) /Producer (Converter) /CreationDate (D:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z) >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesObject} 0 R >>`);

  let pdf = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Uint8Array.from(pdf, (character) => character.charCodeAt(0) & 0xff);
}

function byteLength(text) {
  return text.length;
}

/* ------------------------------------------------------------ csv bridge - */

export async function csvToXlsxBytes(csv, options = {}) {
  const delimiter = detectDelimiter(csv);
  const rows = parseCsv(csv, delimiter);
  if (!rows.length) throw new Error("There are no rows to convert");
  return { bytes: await csvRowsToXlsx(rows, options), rows: rows.length, columns: Math.max(0, ...rows.map((row) => row.length)), delimiter };
}
