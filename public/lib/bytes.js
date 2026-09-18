// Byte-level primitives shared by every encoding, hashing, and file tool.

const encoder = new TextEncoder();

export function textToBytes(value) {
  return encoder.encode(value);
}

export function bytesToText(bytes, { fatal = true } = {}) {
  return new TextDecoder("utf-8", { fatal }).decode(bytes);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index++) { value /= 1024; unit = units[index]; }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

/* ---------------------------------------------------------------- hex --- */

export function bytesToHex(bytes, { separator = "", upper = false } = {}) {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  const joined = hex.join(separator);
  return upper ? joined.toUpperCase() : joined;
}

export function hexToBytes(input) {
  const cleaned = input.replace(/0x/gi, "").replace(/[\s:,_-]/g, "");
  if (!cleaned) throw new Error("Enter a hexadecimal value");
  if (!/^[0-9a-f]*$/i.test(cleaned)) throw new Error("The value contains characters outside the hexadecimal alphabet");
  if (cleaned.length % 2 !== 0) throw new Error("A hexadecimal byte string needs an even number of digits");
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(cleaned.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/* ------------------------------------------------------------- base64 --- */

export function bytesToBase64(bytes, { urlSafe = false, padding = true } = {}) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  let result = btoa(binary);
  if (urlSafe) result = result.replaceAll("+", "-").replaceAll("/", "_");
  return padding ? result : result.replace(/=+$/, "");
}

export function base64ToBytes(input, { lenient = true } = {}) {
  const validation = validateBase64(input, { allowWhitespace: lenient, allowMixedVariant: false });
  if (!validation.valid) throw new Error(validation.reason);
  const binary = atob(normalizeBase64(input, false));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeBase64(input, urlSafe = false, padding = true) {
  return bytesToBase64(textToBytes(input), { urlSafe, padding });
}

export function decodeBase64(input, lenient = true) {
  return bytesToText(base64ToBytes(input, { lenient }));
}

export function validateBase64(input, options = {}) {
  const { allowWhitespace = false, allowMixedVariant = false } = options;
  if (typeof input !== "string" || input.length === 0) return { valid: false, reason: "Enter a Base64 value" };
  if (!allowWhitespace && /\s/.test(input)) return { valid: false, reason: "Whitespace is not allowed in strict mode" };
  const value = allowWhitespace ? input.replace(/\s/g, "") : input;
  if (/=[^=]/.test(value) || /=.{3,}$/.test(value)) return { valid: false, reason: "Padding is only allowed at the end and is limited to two characters" };
  if (!/^[A-Za-z0-9+/_=-]*$/.test(value)) return { valid: false, reason: "The value contains characters outside the Base64 alphabet" };
  if (!allowMixedVariant && (/[+/]/.test(value) && /[-_]/.test(value))) return { valid: false, reason: "Standard and URL-safe alphabets are mixed" };
  const unpadded = value.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) return { valid: false, reason: "A Base64 value cannot have a remainder of one character" };
  const expectedPadding = (4 - (unpadded.length % 4)) % 4;
  const actualPadding = value.length - unpadded.length;
  if (actualPadding > 0 && actualPadding !== expectedPadding) return { valid: false, reason: "Padding does not match the encoded length" };
  return { valid: true, reason: "Valid Base64", variant: /[-_]/.test(value) ? "base64url" : "standard" };
}

export function normalizeBase64(input, urlSafe = false) {
  const validation = validateBase64(input, { allowWhitespace: true, allowMixedVariant: true });
  const unrecoverable = new Set([
    "Enter a Base64 value",
    "The value contains characters outside the Base64 alphabet",
    "A Base64 value cannot have a remainder of one character",
  ]);
  if (!validation.valid && unrecoverable.has(validation.reason)) throw new Error(validation.reason);
  let value = input.replace(/\s/g, "").replace(/=+$/, "");
  value = urlSafe ? value.replaceAll("+", "-").replaceAll("/", "_") : value.replaceAll("-", "+").replaceAll("_", "/");
  return value + "=".repeat((4 - (value.length % 4)) % 4);
}

/* ------------------------------------------------------------- base32 --- */

const BASE32_ALPHABETS = {
  rfc4648: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
  hex: "0123456789ABCDEFGHIJKLMNOPQRSTUV",
  crockford: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
};

export function bytesToBase32(bytes, { variant = "rfc4648", padding = true } = {}) {
  const alphabet = BASE32_ALPHABETS[variant];
  if (!alphabet) throw new Error(`Unknown Base32 variant "${variant}"`);
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  if (padding && variant !== "crockford") while (output.length % 8 !== 0) output += "=";
  return output;
}

export function base32ToBytes(input, { variant = "rfc4648" } = {}) {
  const alphabet = BASE32_ALPHABETS[variant];
  if (!alphabet) throw new Error(`Unknown Base32 variant "${variant}"`);
  const cleaned = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!cleaned) throw new Error("Enter a Base32 value");
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const character of cleaned) {
    const index = alphabet.indexOf(variant === "crockford" ? { O: "0", I: "1", L: "1" }[character] ?? character : character);
    if (index === -1) throw new Error(`"${character}" is not part of the Base32 alphabet`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Uint8Array.from(bytes);
}

/* ------------------------------------------------------------- base58 --- */

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function bytesToBase58(bytes) {
  if (bytes.length === 0) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index++) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let output = "";
  for (let index = 0; index < bytes.length && bytes[index] === 0; index++) output += BASE58_ALPHABET[0];
  for (let index = digits.length - 1; index >= 0; index--) output += BASE58_ALPHABET[digits[index]];
  return output;
}

export function base58ToBytes(input) {
  const cleaned = input.trim();
  if (!cleaned) throw new Error("Enter a Base58 value");
  const bytes = [0];
  for (const character of cleaned) {
    const index = BASE58_ALPHABET.indexOf(character);
    if (index === -1) throw new Error(`"${character}" is not part of the Base58 alphabet`);
    let carry = index;
    for (let position = 0; position < bytes.length; position++) {
      carry += bytes[position] * 58;
      bytes[position] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  const leading = [];
  for (let index = 0; index < cleaned.length && cleaned[index] === BASE58_ALPHABET[0]; index++) leading.push(0);
  return Uint8Array.from(leading.concat(bytes.reverse()));
}

/* -------------------------------------------------------------- crc32 --- */

const CRC_TABLE = Array.from({ length: 256 }, (_, number) => {
  let crc = number;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* --------------------------------------------------------- random ------- */

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Uniform random index in [0, range) without modulo bias. */
export function randomIndex(range) {
  if (range <= 0) throw new Error("Range must be positive");
  const limit = Math.floor(0x100000000 / range) * range;
  const buffer = new Uint32Array(1);
  let value;
  do { crypto.getRandomValues(buffer); value = buffer[0]; } while (value >= limit);
  return value % range;
}

export function hexdump(bytes, { width = 16 } = {}) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += width) {
    const slice = bytes.subarray(offset, offset + width);
    const hex = Array.from(slice, (byte) => byte.toString(16).padStart(2, "0")).join(" ").padEnd(width * 3 - 1, " ");
    const ascii = Array.from(slice, (byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".")).join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`);
  }
  return lines.join("\n") || "00000000";
}
