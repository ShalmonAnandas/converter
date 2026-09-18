// RFC 4180 style delimited-text parsing plus the conversions built on top of it.

export function parseCsv(input, delimiter = ",") {
  if (delimiter.length !== 1) throw new Error("The delimiter must be exactly one character");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"' && field === "" && !wasQuoted) { quoted = true; wasQuoted = true; continue; }
    if (character === delimiter) { row.push(field); field = ""; wasQuoted = false; continue; }
    if (character === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; wasQuoted = false; continue; }
    field += character;
  }
  if (quoted) throw new Error("The input ends inside a quoted field");
  if (field !== "" || row.length > 0 || wasQuoted) { row.push(field); rows.push(row); }
  return rows;
}

export function detectDelimiter(input) {
  const candidates = [",", "\t", ";", "|"];
  const lines = input.split(/\r?\n/).filter(Boolean).slice(0, 5);
  if (!lines.length) return ",";
  const scored = candidates.map((delimiter) => {
    const widths = lines.map((line) => {
      try { return parseCsv(line, delimiter)[0]?.length ?? 0; }
      catch { return 0; }
    });
    const first = widths[0];
    const consistent = widths.every((width) => width === first);
    return { delimiter, score: (first - 1) * (consistent ? 2 : 1) };
  });
  return scored.sort((a, b) => b.score - a.score)[0].delimiter;
}

/** Prefixes values a spreadsheet would evaluate as a formula. */
export function neutralizeFormula(value) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function serializeRows(rows, delimiter = ",", { protect = true, eol = "\n" } = {}) {
  const quote = (value) => {
    const safe = protect ? neutralizeFormula(String(value ?? "")) : String(value ?? "");
    return safe.includes(delimiter) || /["\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return rows.map((row) => Array.from(row, quote).join(delimiter)).join(eol);
}

export function convertCsv(input, from = "auto", to = "\t") {
  const delimiter = from === "auto" ? detectDelimiter(input) : from;
  const rows = parseCsv(input, delimiter);
  return {
    output: serializeRows(rows, to),
    rows: rows.length,
    columns: Math.max(0, ...rows.map((row) => row.length)),
    detected: delimiter,
  };
}

export function csvToJson(input, { delimiter = "auto", header = true, typed = true, indent = 2 } = {}) {
  const actual = delimiter === "auto" ? detectDelimiter(input) : delimiter;
  const rows = parseCsv(input, actual);
  if (!rows.length) throw new Error("There are no rows to convert");
  const cast = (value) => {
    if (!typed) return value;
    if (value === "") return null;
    if (/^[+-]?\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
    if (/^[+-]?(\d+\.\d+|\d+)([eE][+-]?\d+)?$/.test(value)) return Number(value);
    if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
    return value;
  };
  if (!header) return JSON.stringify(rows.map((row) => row.map(cast)), null, indent);
  const [headings, ...body] = rows;
  const names = headings.map((name, index) => (name.trim() || `column${index + 1}`));
  const records = body.map((row) => Object.fromEntries(names.map((name, index) => [name, cast(row[index] ?? "")])));
  return JSON.stringify(records, null, indent);
}

export function jsonToCsv(input, { delimiter = ",", header = true } = {}) {
  const parsed = JSON.parse(input);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  if (!records.length) throw new Error("There is nothing to convert");
  if (records.every((record) => Array.isArray(record))) return serializeRows(records, delimiter);
  if (records.some((record) => record === null || typeof record !== "object")) throw new Error("CSV output needs an array of objects or an array of arrays");
  const columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const rows = records.map((record) => columns.map((column) => {
    const value = record[column];
    if (value === null || value === undefined) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }));
  return serializeRows(header ? [columns, ...rows] : rows, delimiter);
}

export function csvToMarkdown(input, { delimiter = "auto", header = true } = {}) {
  const actual = delimiter === "auto" ? detectDelimiter(input) : delimiter;
  const rows = parseCsv(input, actual);
  if (!rows.length) throw new Error("There are no rows to convert");
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => Array.from({ length: width }, (_, index) => (row[index] ?? "").replaceAll("|", "\\|")));
  const widths = Array.from({ length: width }, (_, column) => Math.max(3, ...padded.map((row) => row[column].length)));
  const line = (row) => `| ${row.map((cell, column) => cell.padEnd(widths[column])).join(" | ")} |`;
  const divider = `| ${widths.map((size) => "-".repeat(size)).join(" | ")} |`;
  if (!header) return [line(Array.from({ length: width }, (_, index) => `column${index + 1}`)), divider, ...padded.map(line)].join("\n");
  return [line(padded[0]), divider, ...padded.slice(1).map(line)].join("\n");
}

export function csvToSql(input, { table = "records", delimiter = "auto", dialect = "postgresql" } = {}) {
  const actual = delimiter === "auto" ? detectDelimiter(input) : delimiter;
  const rows = parseCsv(input, actual);
  if (rows.length < 2) throw new Error("Provide a header row and at least one data row");
  const [headings, ...body] = rows;
  const quote = (name) => (dialect === "mysql" ? `\`${name.replaceAll("`", "``")}\`` : `"${name.replaceAll('"', '""')}"`);
  const columns = headings.map((name, index) => name.trim() || `column${index + 1}`);
  const literal = (value) => {
    if (value === "" || value === undefined) return "NULL";
    if (/^[+-]?\d+(\.\d+)?$/.test(value)) return value;
    return `'${value.replaceAll("'", "''")}'`;
  };
  const create = `CREATE TABLE ${quote(table)} (\n${columns.map((column, index) => {
    const values = body.map((row) => row[index] ?? "").filter(Boolean);
    const type = values.length && values.every((value) => /^[+-]?\d+$/.test(value)) ? "BIGINT"
      : values.length && values.every((value) => /^[+-]?\d*\.?\d+$/.test(value)) ? "DOUBLE PRECISION"
        : "TEXT";
    return `  ${quote(column)} ${type}`;
  }).join(",\n")}\n);`;
  const inserts = body.map((row) => `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")})\nVALUES (${columns.map((_, index) => literal(row[index])).join(", ")});`);
  return `${create}\n\n${inserts.join("\n\n")}`;
}
