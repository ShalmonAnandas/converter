function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function parseCsv(input, delimiter = ",") {
  if (delimiter.length !== 1) throw new Error("Delimiter must be one character");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === "") quoted = true;
    else if (character === delimiter) { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field || row.length || input.endsWith(delimiter)) { row.push(field); rows.push(row); }
  return rows;
}

export function detectDelimiter(input) {
  const candidates = [",", "\t", ";", "|"];
  const firstLines = input.split(/\r?\n/, 5).filter(Boolean);
  return candidates.map(delimiter => ({ delimiter, score: firstLines.reduce((sum, line) => sum + parseCsv(line, delimiter)[0].length - 1, 0) }))
    .sort((a, b) => b.score - a.score)[0].delimiter;
}

export function convertCsv(input, from = "auto", to = "\t") {
  const delimiter = from === "auto" ? detectDelimiter(input) : from;
  const rows = parseCsv(input, delimiter);
  const protect = value => /^[=+\-@]/.test(value) ? `'${value}` : value;
  const quote = value => {
    const safe = protect(value);
    return safe.includes(to) || /["\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return { output: rows.map(row => row.map(quote).join(to)).join("\n"), rows: rows.length, columns: Math.max(0, ...rows.map(row => row.length)), detected: delimiter };
}

export function inspectJwt(input) {
  const parts = input.trim().split(".");
  if (parts.length !== 3) throw new Error("A JWT must contain header, payload, and signature segments");
  const decode = part => {
    const normalized = part.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - part.length % 4) % 4);
    const bytes = Uint8Array.from(atob(normalized), character => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const header = decode(parts[0]), payload = decode(parts[1]);
  const timestamps = {};
  for (const claim of ["iat", "nbf", "exp"]) if (typeof payload[claim] === "number") timestamps[claim] = new Date(payload[claim] * 1000).toISOString();
  return { warning: "Decoded only — the signature has not been verified.", header, payload, timestamps, signature: parts[2] || "(empty)" };
}

export async function generateHash(input, algorithm = "SHA-256") {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inCode = false, list = null, output = [];
  const inline = value => escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  const closeList = () => { if (list) { output.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    if (line.startsWith("```")) { closeList(); output.push(inCode ? "</code></pre>" : "<pre><code>"); inCode = !inCode; continue; }
    if (inCode) { output.push(`${escapeHtml(line)}\n`); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { closeList(); const level = heading[1].length; output.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    const item = /^(\s*)([-*+] |\d+\. )(.+)$/.exec(line);
    if (item) { const wanted = /\d/.test(item[2]) ? "ol" : "ul"; if (list !== wanted) { closeList(); list = wanted; output.push(`<${list}>`); } output.push(`<li>${inline(item[3])}</li>`); continue; }
    closeList();
    if (/^>\s?/.test(line)) output.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
    else if (/^---+$/.test(line)) output.push("<hr>");
    else if (line.trim()) output.push(`<p>${inline(line)}</p>`);
  }
  closeList(); if (inCode) output.push("</code></pre>");
  return output.join("\n");
}

export function formatXml(input, indent = "  ") {
  if (typeof DOMParser === "undefined") throw new Error("XML formatting requires a browser DOM parser");
  if (/<!DOCTYPE/i.test(input)) throw new Error("DOCTYPE declarations are disabled to prevent external entity resolution");
  const document = new DOMParser().parseFromString(input, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error(parserError.textContent.trim().replace(/\s+/g, " "));
  const serialized = new XMLSerializer().serializeToString(document);
  const tokens = serialized.replace(/>\s*</g, "><").split(/(?=<)|(?<=>)/).filter(Boolean);
  let depth = 0;
  return tokens.map(token => {
    if (/^<\//.test(token)) depth = Math.max(0, depth - 1);
    const line = `${indent.repeat(depth)}${token}`;
    if (/^<[^!?/][^>]*>$/.test(token) && !/\/$/.test(token.slice(0, -1)) && !/<\/[^>]+>$/.test(token)) depth++;
    return line;
  }).join("\n").replace(/\n\s*\n/g, "\n");
}

export function minifyXml(input) {
  if (typeof DOMParser === "undefined") throw new Error("XML minification requires a browser DOM parser");
  if (/<!DOCTYPE/i.test(input)) throw new Error("DOCTYPE declarations are disabled to prevent external entity resolution");
  const document = new DOMParser().parseFromString(input, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error(parserError.textContent.trim().replace(/\s+/g, " "));
  return new XMLSerializer().serializeToString(document).replace(/>\s+</g, "><");
}
