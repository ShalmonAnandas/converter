export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; value >= 1024 && i < units.length; i++) { value /= 1024; unit = units[i]; }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export function jsonTransform(input, action = "format", indent = "2") {
  const parsed = JSON.parse(input);
  if (action === "minify") return JSON.stringify(parsed);
  if (action === "sort") return JSON.stringify(sortObject(parsed), null, indent === "tab" ? "\t" : Number(indent));
  return JSON.stringify(parsed, null, indent === "tab" ? "\t" : Number(indent));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  return value;
}

export function jsonError(error, input) {
  const match = /position (\d+)/i.exec(error.message);
  if (!match) return error.message;
  const position = Number(match[1]);
  const before = input.slice(0, position);
  const line = before.split("\n").length;
  const column = position - before.lastIndexOf("\n");
  return `${error.message} · line ${line}, column ${column}`;
}

export function encodeBase64(input, urlSafe = false, padding = true) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  let result = btoa(binary);
  if (urlSafe) result = result.replaceAll("+", "-").replaceAll("/", "_");
  return padding ? result : result.replace(/=+$/, "");
}

export function normalizeBase64(input, urlSafe = false) {
  const validation = validateBase64(input, { allowWhitespace: true, allowMixedVariant: true });
  const unrecoverableReasons = new Set([
    "Enter a Base64 value",
    "The value contains characters outside the Base64 alphabet",
    "A Base64 value cannot have a remainder of one character",
  ]);
  if (!validation.valid && unrecoverableReasons.has(validation.reason)) {
    throw new Error(validation.reason);
  }

  let value = input.replace(/\s/g, "").replace(/=+$/, "");
  value = urlSafe
    ? value.replaceAll("+", "-").replaceAll("/", "_")
    : value.replaceAll("-", "+").replaceAll("_", "/");
  return value + "=".repeat((4 - (value.length % 4)) % 4);
}

export function validateBase64(input, options = {}) {
  const { allowWhitespace = false, allowMixedVariant = false } = options;
  if (typeof input !== "string" || input.length === 0) return { valid: false, reason: "Enter a Base64 value" };
  if (!allowWhitespace && /\s/.test(input)) return { valid: false, reason: "Whitespace is not allowed in strict mode" };
  const value = allowWhitespace ? input.replace(/\s/g, "") : input;
  if (/=[^=]/.test(value) || /=.{3,}$/.test(value)) return { valid: false, reason: "Padding is only allowed at the end and is limited to two characters" };
  if (!/^[A-Za-z0-9+/_=-]*$/.test(value)) return { valid: false, reason: "The value contains characters outside the Base64 alphabet" };
  if (!allowMixedVariant && (/[+\/]/.test(value) && /[-_]/.test(value))) return { valid: false, reason: "Standard and URL-safe alphabets are mixed" };
  const unpadded = value.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) return { valid: false, reason: "A Base64 value cannot have a remainder of one character" };
  const expectedPadding = (4 - (unpadded.length % 4)) % 4;
  const actualPadding = value.length - unpadded.length;
  if (actualPadding > 0 && actualPadding !== expectedPadding) return { valid: false, reason: "Padding does not match the encoded length" };
  return { valid: true, reason: "Valid Base64", variant: /[-_]/.test(value) ? "base64url" : "standard" };
}

export function decodeBase64(input, lenient = true) {
  const validation = validateBase64(input, { allowWhitespace: lenient, allowMixedVariant: false });
  if (!validation.valid) throw new Error(validation.reason);
  const normalized = normalizeBase64(input, false);
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function parseDataUri(input) {
  const match = /^data:([^,]*?),(.*)$/s.exec(input.trim());
  if (!match) throw new Error("Enter a valid data: URI");
  const metadata = match[1].split(";");
  const mediaType = metadata[0] || "text/plain";
  const isBase64 = metadata.at(-1)?.toLowerCase() === "base64";
  const parameters = metadata.slice(1, isBase64 ? -1 : undefined);
  const payload = isBase64 ? decodeBase64(match[2]) : decodeURIComponent(match[2]);
  return { mediaType, parameters, isBase64, payload };
}

export function convertTimestamp(input, unit = "seconds") {
  const numeric = Number(input.trim());
  if (!Number.isFinite(numeric)) throw new Error("Enter a valid Unix timestamp");
  const date = new Date(unit === "seconds" ? numeric * 1000 : numeric);
  if (Number.isNaN(date.getTime())) throw new Error("Timestamp is outside the supported range");
  return date.toISOString();
}
