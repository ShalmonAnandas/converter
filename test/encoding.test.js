import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBytes, textToBytes, bytesToText, encodeBase64, decodeBase64, normalizeBase64, validateBase64,
  bytesToBase32, base32ToBytes, bytesToBase58, base58ToBytes, bytesToHex, hexToBytes, crc32, hexdump,
} from "../public/lib/bytes.js";

test("formats byte quantities", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.50 KB");
  assert.equal(formatBytes(1024 ** 3 * 2), "2.00 GB");
  assert.equal(formatBytes(-1), "0 B");
});

test("round trips UTF-8 Base64", () => {
  const value = "Hello, 世界 👋";
  assert.equal(decodeBase64(encodeBase64(value)), value);
  assert.equal(encodeBase64("Hi", true, false), "SGk");
});

test("normalizes Base64URL and padding", () => {
  assert.equal(normalizeBase64("SGVsbG8_", false), "SGVsbG8/");
  assert.equal(normalizeBase64("SGVsbG8", false), "SGVsbG8=");
});

test("normalization rejects data it cannot repair safely", () => {
  assert.throws(() => normalizeBase64("!!!!"), /outside the Base64 alphabet/);
  assert.throws(() => normalizeBase64("a"), /remainder of one/);
});

test("validates alphabet, whitespace, padding, and impossible lengths", () => {
  assert.deepEqual(validateBase64("SGVsbG8="), { valid: true, reason: "Valid Base64", variant: "standard" });
  assert.equal(validateBase64("SG Vs").reason, "Whitespace is not allowed in strict mode");
  assert.equal(validateBase64("abcde").valid, false);
  assert.equal(validateBase64("abc=def").valid, false);
});

test("rejects mixed Base64 alphabets and invalid padding", () => {
  assert.equal(validateBase64("ab+_", {}).reason, "Standard and URL-safe alphabets are mixed");
  assert.throws(() => decodeBase64("SGVsbG8=="), /Padding/);
});

test("Base32 matches the RFC 4648 test vectors", () => {
  const vectors = { "": "", f: "MY======", fo: "MZXQ====", foo: "MZXW6===", foob: "MZXW6YQ=", fooba: "MZXW6YTB", foobar: "MZXW6YTBOI======" };
  for (const [plain, encoded] of Object.entries(vectors)) {
    assert.equal(bytesToBase32(textToBytes(plain)), encoded, `encoding "${plain}"`);
    if (encoded) assert.equal(bytesToText(base32ToBytes(encoded)), plain, `decoding "${encoded}"`);
  }
  assert.throws(() => base32ToBytes("MZXW6YT1"), /not part of the Base32 alphabet/);
});

test("Base58 preserves leading zero bytes", () => {
  assert.equal(bytesToBase58(hexToBytes("0000010203")), "11Ldp");
  assert.equal(bytesToHex(base58ToBytes("11Ldp")), "0000010203");
  assert.equal(bytesToText(base58ToBytes("2NEpo7TZRRrLZSi2U")), "Hello World!");
  assert.throws(() => base58ToBytes("0OIl"), /not part of the Base58 alphabet/);
});

test("hex conversion tolerates separators and rejects bad input", () => {
  assert.equal(bytesToHex(textToBytes("Hi"), { separator: ":" }), "48:69");
  assert.equal(bytesToText(hexToBytes("0x48 69")), "Hi");
  assert.throws(() => hexToBytes("48 6"), /even number of digits/);
  assert.throws(() => hexToBytes("zz"), /outside the hexadecimal alphabet/);
});

test("CRC-32 matches the standard check value", () => {
  assert.equal(crc32(textToBytes("123456789")).toString(16), "cbf43926");
});

test("hex dump lines up offsets, bytes, and ASCII", () => {
  const dump = hexdump(textToBytes("Converter"));
  assert.match(dump, /^00000000 {2}43 6f 6e 76 65 72 74 65 72/);
  assert.match(dump, /\|Converter\|$/);
});
