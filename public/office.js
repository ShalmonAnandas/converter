const encoder = new TextEncoder();

function xmlEscape(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

const crcTable = Array.from({ length: 256 }, (_, number) => {
  let crc = number;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view, offset, value) { view.setUint16(offset, value, true); }
function write32(view, offset, value) { view.setUint32(offset, value, true); }

export function createZip(files) {
  const entries = Object.entries(files).map(([name, content]) => ({ name: encoder.encode(name), data: typeof content === "string" ? encoder.encode(content) : content }));
  const localSize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.data.length, 0);
  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  let offset = 0;
  const records = [];
  for (const entry of entries) {
    const checksum = crc32(entry.data), start = offset;
    write32(view, offset, 0x04034b50); write16(view, offset + 4, 20); write16(view, offset + 6, 0x0800); write16(view, offset + 8, 0);
    write32(view, offset + 14, checksum); write32(view, offset + 18, entry.data.length); write32(view, offset + 22, entry.data.length); write16(view, offset + 26, entry.name.length);
    offset += 30; output.set(entry.name, offset); offset += entry.name.length; output.set(entry.data, offset); offset += entry.data.length;
    records.push({ ...entry, checksum, start });
  }
  const centralOffset = offset;
  for (const entry of records) {
    write32(view, offset, 0x02014b50); write16(view, offset + 4, 20); write16(view, offset + 6, 20); write16(view, offset + 8, 0x0800);
    write32(view, offset + 16, entry.checksum); write32(view, offset + 20, entry.data.length); write32(view, offset + 24, entry.data.length); write16(view, offset + 28, entry.name.length); write32(view, offset + 42, entry.start);
    offset += 46; output.set(entry.name, offset); offset += entry.name.length;
  }
  write32(view, offset, 0x06054b50); write16(view, offset + 8, records.length); write16(view, offset + 10, records.length); write32(view, offset + 12, centralSize); write32(view, offset + 16, centralOffset);
  return output;
}

export async function readZip(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = new Map();
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65_557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("The file is not a readable ZIP/Office archive");
  const entryCount = view.getUint16(end + 10, true);
  if (entryCount > 2000) throw new Error("Archive contains too many entries");
  let offset = view.getUint32(end + 16, true), expanded = 0;
  for (let count = 0; count < entryCount; count++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("ZIP central directory is invalid");
    const method = view.getUint16(offset + 10, true), compressedSize = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    expanded += size; if (expanded > 100 * 1024 * 1024) throw new Error("Expanded archive exceeds the 100 MB safety limit");
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true), localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("Archive contains an unsafe path");
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("ZIP entry points to an invalid local record");
    const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength, compressed = bytes.slice(start, start + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8 && typeof DecompressionStream !== "undefined") data = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else throw new Error(`Unsupported ZIP compression method ${method}`);
    files.set(name, data); offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!files.size) throw new Error("The file is not a readable ZIP/Office archive");
  return files;
}

function columnName(index) { let name = ""; for (index++; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + ((index - 1) % 26)) + name; return name; }

export function csvRowsToXlsx(rows, sheetName = "Sheet1") {
  const sheet = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`).join("")}</row>`).join("");
  return createZip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
  });
}

export async function xlsxToCsv(buffer) {
  const files = await readZip(buffer), decode = name => new TextDecoder().decode(files.get(name) || new Uint8Array());
  const sharedDocument = decode("xl/sharedStrings.xml");
  const shared = sharedDocument ? Array.from(new DOMParser().parseFromString(sharedDocument, "application/xml").querySelectorAll("si"), node => Array.from(node.querySelectorAll("t"), text => text.textContent).join("")) : [];
  const workbook = new DOMParser().parseFromString(decode("xl/workbook.xml"), "application/xml");
  const firstSheet = Array.from(workbook.getElementsByTagNameNS("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "sheet"))[0];
  const relationshipId = firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || firstSheet?.getAttribute("r:id");
  const relationships = new DOMParser().parseFromString(decode("xl/_rels/workbook.xml.rels"), "application/xml");
  const relationship = Array.from(relationships.getElementsByTagName("Relationship")).find(node => node.getAttribute("Id") === relationshipId);
  const target = relationship?.getAttribute("Target")?.replace(/^\//, "") || "worksheets/sheet1.xml";
  const sheetPath = target.startsWith("xl/") ? target : `xl/${target.replace(/^\.\//, "")}`;
  const xml = decode(sheetPath); if (!xml) throw new Error("The workbook does not contain a supported first worksheet");
  const document = new DOMParser().parseFromString(xml, "application/xml"), rows = [];
  for (const rowNode of document.querySelectorAll("row")) {
    const row = [];
    for (const cell of rowNode.querySelectorAll("c")) {
      const reference = cell.getAttribute("r") || "A1", letters = reference.match(/[A-Z]+/)?.[0] || "A";
      let column = 0; for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64; column--;
      const type = cell.getAttribute("t"), raw = type === "inlineStr" ? cell.querySelector("is t")?.textContent || "" : cell.querySelector("v")?.textContent || "";
      row[column] = type === "s" ? shared[Number(raw)] || "" : raw;
    }
    rows.push(row);
  }
  return rows.map(row => row.map(value => { const text = value ?? ""; return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }).join(",")).join("\n");
}

export function markdownToDocx(markdown) {
  const paragraphs = markdown.replace(/\r\n/g, "\n").split("\n").map(line => {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line), list = /^[-*+]\s+(.+)$/.exec(line), text = heading?.[2] ?? list?.[1] ?? line;
    const style = heading ? `<w:pStyle w:val="Heading${heading[1].length}"/>` : list ? '<w:pStyle w:val="ListParagraph"/>' : "";
    return `<w:p><w:pPr>${style}</w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  }).join("");
  return createZip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
    "word/_rels/document.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "word/styles.xml": `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${Array.from({ length: 6 }, (_, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${360 - index * 30}" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${36 - index * 3}"/></w:rPr></w:style>`).join("")}<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style></w:styles>`,
  });
}

export async function docxToMarkdown(buffer) {
  const files = await readZip(buffer), source = files.get("word/document.xml");
  if (!source) throw new Error("The DOCX archive does not contain word/document.xml");
  const document = new DOMParser().parseFromString(new TextDecoder().decode(source), "application/xml"), output = [];
  for (const paragraph of document.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "p")) {
    const style = paragraph.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "pStyle")[0]?.getAttribute("w:val") || "";
    const text = Array.from(paragraph.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "t"), node => node.textContent).join("");
    const level = /^Heading([1-6])$/.exec(style)?.[1]; output.push(level ? `${"#".repeat(Number(level))} ${text}` : text);
  }
  return output.join("\n\n");
}
