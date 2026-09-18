// Hashing, HMAC, symmetric and asymmetric key material, JWT inspection, and
// one-time passwords. Everything runs through Web Crypto except MD5, which the
// platform does not expose and which is implemented here for legacy checksums.

import { bytesToHex, bytesToBase64, base64ToBytes, textToBytes, bytesToText, crc32, randomBytes, randomIndex, hexToBytes } from "./bytes.js";

const WEB_CRYPTO_HASHES = { "SHA-1": "SHA-1", "SHA-256": "SHA-256", "SHA-384": "SHA-384", "SHA-512": "SHA-512" };

export const HASH_ALGORITHMS = ["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512", "CRC-32"];

export async function digestBytes(bytes, algorithm = "SHA-256") {
  if (algorithm === "MD5") return md5(bytes);
  if (algorithm === "CRC-32") {
    const value = crc32(bytes);
    const output = new Uint8Array(4);
    new DataView(output.buffer).setUint32(0, value, false);
    return output;
  }
  const name = WEB_CRYPTO_HASHES[algorithm];
  if (!name) throw new Error(`Unsupported hash algorithm "${algorithm}"`);
  return new Uint8Array(await crypto.subtle.digest(name, bytes));
}

export async function generateHash(input, algorithm = "SHA-256", encoding = "hex") {
  const digest = await digestBytes(typeof input === "string" ? textToBytes(input) : input, algorithm);
  return encodeDigest(digest, encoding);
}

export async function hashAll(input) {
  const bytes = typeof input === "string" ? textToBytes(input) : input;
  const rows = [];
  for (const algorithm of HASH_ALGORITHMS) rows.push([algorithm, bytesToHex(await digestBytes(bytes, algorithm))]);
  const width = Math.max(...rows.map(([name]) => name.length));
  return rows.map(([name, value]) => `${name.padEnd(width)}  ${value}`).join("\n");
}

function encodeDigest(digest, encoding) {
  if (encoding === "base64") return bytesToBase64(digest);
  if (encoding === "base64url") return bytesToBase64(digest, { urlSafe: true, padding: false });
  if (encoding === "binary") return Array.from(digest, (byte) => byte.toString(2).padStart(8, "0")).join(" ");
  return bytesToHex(digest);
}

/* ----------------------------------------------------------------- md5 --- */

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32));

export function md5(bytes) {
  const length = bytes.length;
  const paddedLength = (((length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, (length << 3) >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(length / 0x20000000), true);

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const block = new Uint32Array(16);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let word = 0; word < 16; word++) block[word] = view.getUint32(offset + word * 4, true);
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let index = 0; index < 64; index++) {
      let f;
      let g;
      if (index < 16) { f = (b & c) | (~b & d); g = index; }
      else if (index < 32) { f = (d & b) | (~d & c); g = (5 * index + 1) % 16; }
      else if (index < 48) { f = b ^ c ^ d; g = (3 * index + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * index) % 16; }
      f = (f + a + MD5_K[index] + block[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << MD5_S[index]) | (f >>> (32 - MD5_S[index])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  [a0, b0, c0, d0].forEach((value, index) => digestView.setUint32(index * 4, value, true));
  return digest;
}

/* ---------------------------------------------------------------- hmac --- */

export async function generateHmac(message, secret, algorithm = "SHA-256", encoding = "hex") {
  if (!secret) throw new Error("Enter a secret key");
  const key = await crypto.subtle.importKey("raw", textToBytes(secret), { name: "HMAC", hash: algorithm }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, textToBytes(message)));
  return encodeDigest(signature, encoding);
}

/* ------------------------------------------------------------- pbkdf2 --- */

export async function deriveKey(password, salt, { iterations = 210000, hash = "SHA-256", length = 32 } = {}) {
  const material = await crypto.subtle.importKey("raw", textToBytes(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash }, material, length * 8);
  return new Uint8Array(bits);
}

export async function pbkdf2Report(password, saltText, iterations, hash, length) {
  if (!password) throw new Error("Enter a password");
  const salt = saltText ? textToBytes(saltText) : randomBytes(16);
  const key = await deriveKey(password, salt, { iterations, hash, length });
  return [
    `Algorithm     PBKDF2-${hash}`,
    `Iterations    ${iterations.toLocaleString("en-US")}`,
    `Salt (hex)    ${bytesToHex(salt)}`,
    `Key length    ${length} bytes`,
    "",
    `Key (hex)     ${bytesToHex(key)}`,
    `Key (base64)  ${bytesToBase64(key)}`,
  ].join("\n");
}

/* ---------------------------------------------------------------- aes ---- */

const AES_MAGIC = "CNVRT1";

export async function encryptText(plaintext, password, { iterations = 210000 } = {}) {
  if (!password) throw new Error("Enter a passphrase");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const raw = await deriveKey(password, salt, { iterations, hash: "SHA-256", length: 32 });
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, textToBytes(plaintext)));
  const header = textToBytes(AES_MAGIC);
  const payload = new Uint8Array(header.length + 4 + salt.length + iv.length + ciphertext.length);
  payload.set(header, 0);
  new DataView(payload.buffer).setUint32(header.length, iterations, false);
  payload.set(salt, header.length + 4);
  payload.set(iv, header.length + 4 + salt.length);
  payload.set(ciphertext, header.length + 4 + salt.length + iv.length);
  return bytesToBase64(payload);
}

export async function decryptText(encoded, password) {
  if (!password) throw new Error("Enter the passphrase used to encrypt this value");
  const payload = base64ToBytes(encoded.trim());
  const header = textToBytes(AES_MAGIC);
  if (payload.length < header.length + 4 + 16 + 12 + 16) throw new Error("The payload is too short to be a Converter ciphertext");
  if (bytesToText(payload.subarray(0, header.length), { fatal: false }) !== AES_MAGIC) throw new Error("This value was not produced by the AES tool");
  const iterations = new DataView(payload.buffer, payload.byteOffset).getUint32(header.length, false);
  const salt = payload.subarray(header.length + 4, header.length + 20);
  const iv = payload.subarray(header.length + 20, header.length + 32);
  const ciphertext = payload.subarray(header.length + 32);
  const raw = await deriveKey(password, salt, { iterations, hash: "SHA-256", length: 32 });
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return bytesToText(new Uint8Array(plaintext));
  } catch {
    throw new Error("Decryption failed — the passphrase is wrong or the payload was modified");
  }
}

/* ---------------------------------------------------------------- keys --- */

function toPem(bytes, label) {
  const base64 = bytesToBase64(bytes);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

export async function generateKeyPair(kind = "RSA-2048") {
  const algorithms = {
    "RSA-2048": { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    "RSA-4096": { name: "RSASSA-PKCS1-v1_5", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    "EC P-256": { name: "ECDSA", namedCurve: "P-256" },
    "EC P-384": { name: "ECDSA", namedCurve: "P-384" },
  };
  const algorithm = algorithms[kind];
  if (!algorithm) throw new Error(`Unsupported key type "${kind}"`);
  const pair = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const thumbprint = bytesToHex(await digestBytes(publicKey, "SHA-256"), { separator: ":" });
  return `# ${kind} key pair — generated in this browser and never transmitted\n# SHA-256 fingerprint of the public key\n# ${thumbprint}\n\n${toPem(privateKey, "PRIVATE KEY")}\n\n${toPem(publicKey, "PUBLIC KEY")}`;
}

/* ----------------------------------------------------------------- jwt --- */

export function decodeJwt(input) {
  const parts = input.trim().split(".");
  if (parts.length !== 3) throw new Error("A JWT must contain header, payload, and signature segments");
  const decodeSegment = (part, name) => {
    try { return JSON.parse(bytesToText(base64ToBytes(part))); }
    catch { throw new Error(`The ${name} segment is not valid Base64URL-encoded JSON`); }
  };
  const header = decodeSegment(parts[0], "header");
  const payload = decodeSegment(parts[1], "payload");
  return { header, payload, signature: parts[2], signingInput: `${parts[0]}.${parts[1]}` };
}

const CLAIM_NAMES = { iss: "Issuer", sub: "Subject", aud: "Audience", exp: "Expires at", nbf: "Not before", iat: "Issued at", jti: "JWT ID" };

export function inspectJwt(input) {
  const { header, payload, signature } = decodeJwt(input);
  const now = Date.now();
  const timestamps = {};
  const notes = [];
  for (const claim of ["iat", "nbf", "exp"]) {
    if (typeof payload[claim] !== "number") continue;
    const date = new Date(payload[claim] * 1000);
    timestamps[claim] = date.toISOString();
    if (claim === "exp") notes.push(date.getTime() < now ? `Expired ${describeGap(now - date.getTime())} ago` : `Expires in ${describeGap(date.getTime() - now)}`);
    if (claim === "nbf" && date.getTime() > now) notes.push(`Not valid for another ${describeGap(date.getTime() - now)}`);
  }
  const claims = Object.keys(payload).filter((claim) => claim in CLAIM_NAMES).map((claim) => `${CLAIM_NAMES[claim]}: ${JSON.stringify(payload[claim])}`);
  return {
    warning: "Decoded only — the signature has not been verified. Use the verify action with the shared secret.",
    algorithm: header.alg ?? "(none declared)",
    header,
    payload,
    timestamps,
    registeredClaims: claims,
    status: notes.length ? notes : ["No expiry or not-before constraints"],
    signature: signature || "(empty)",
  };
}

function describeGap(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);
  const units = [["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]];
  for (const [name, size] of units) {
    if (seconds >= size) { const value = Math.floor(seconds / size); return `${value} ${name}${value === 1 ? "" : "s"}`; }
  }
  return "less than a second";
}

export async function verifyJwt(input, secret) {
  if (!secret) throw new Error("Enter the shared secret to verify an HMAC-signed token");
  const { header, payload, signature, signingInput } = decodeJwt(input);
  const hashes = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" };
  const hash = hashes[header.alg];
  if (!hash) throw new Error(`Only HS256, HS384, and HS512 can be verified with a shared secret — this token declares "${header.alg}"`);
  const key = await crypto.subtle.importKey("raw", textToBytes(secret), { name: "HMAC", hash }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, base64ToBytes(signature), textToBytes(signingInput));
  const expiry = typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
  const lines = [
    valid ? `Signature VALID for ${header.alg}` : `Signature INVALID for ${header.alg}`,
    expiry ? (expiry.getTime() < Date.now() ? `Token EXPIRED at ${expiry.toISOString()}` : `Token expires at ${expiry.toISOString()}`) : "Token has no exp claim",
    "",
    JSON.stringify({ header, payload }, null, 2),
  ];
  return lines.join("\n");
}

export async function signJwt(payloadJson, secret, algorithm = "HS256") {
  if (!secret) throw new Error("Enter a shared secret to sign with");
  const hashes = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" };
  const hash = hashes[algorithm];
  if (!hash) throw new Error(`Unsupported signing algorithm "${algorithm}"`);
  let payload;
  try { payload = JSON.parse(payloadJson); }
  catch (error) { throw new Error(`The payload is not valid JSON: ${error.message}`); }
  const header = { alg: algorithm, typ: "JWT" };
  const encode = (value) => bytesToBase64(textToBytes(JSON.stringify(value)), { urlSafe: true, padding: false });
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const key = await crypto.subtle.importKey("raw", textToBytes(secret), { name: "HMAC", hash }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, textToBytes(signingInput)));
  return `${signingInput}.${bytesToBase64(signature, { urlSafe: true, padding: false })}`;
}

/* ---------------------------------------------------------------- totp --- */

export async function generateTotp(secretBase32, { digits = 6, period = 30, algorithm = "SHA-1", at = Date.now() } = {}) {
  const { base32ToBytes } = await import("./bytes.js");
  const secret = base32ToBytes(secretBase32);
  if (!secret.length) throw new Error("Enter a Base32 shared secret");
  const counter = Math.floor(at / 1000 / period);
  const code = await hotp(secret, counter, digits, algorithm);
  const remaining = period - Math.floor((at / 1000) % period);
  const previous = await hotp(secret, counter - 1, digits, algorithm);
  const next = await hotp(secret, counter + 1, digits, algorithm);
  return { code, remaining, previous, next, counter };
}

export async function hotp(secret, counter, digits = 6, algorithm = "SHA-1") {
  const buffer = new Uint8Array(8);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, Math.floor(counter / 2 ** 32), false);
  view.setUint32(4, counter >>> 0, false);
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: algorithm }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = ((signature[offset] & 0x7f) << 24) | (signature[offset + 1] << 16) | (signature[offset + 2] << 8) | signature[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function randomTotpSecret(length = 20) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return Array.from(randomBytes(length), (byte) => alphabet[byte % 32]).join("");
}

/* ------------------------------------------------------------ passwords -- */

const CHARSETS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.<>?/",
};
const AMBIGUOUS = new Set([..."Il1O0`'\"|"]);

export function generatePassword({ length = 20, sets = ["lowercase", "uppercase", "digits", "symbols"], excludeAmbiguous = true, count = 1 } = {}) {
  const active = sets.filter((name) => name in CHARSETS);
  if (!active.length) throw new Error("Select at least one character set");
  if (length < 4) throw new Error("Passwords must be at least 4 characters long");
  const pools = active.map((name) => [...CHARSETS[name]].filter((character) => !excludeAmbiguous || !AMBIGUOUS.has(character)));
  const alphabet = pools.flat();
  return Array.from({ length: Math.max(1, Math.min(100, count)) }, () => {
    const characters = pools.map((pool) => pool[randomIndex(pool.length)]);
    while (characters.length < length) characters.push(alphabet[randomIndex(alphabet.length)]);
    for (let index = characters.length - 1; index > 0; index--) {
      const swap = randomIndex(index + 1);
      [characters[index], characters[swap]] = [characters[swap], characters[index]];
    }
    return characters.join("");
  }).join("\n");
}

const COMMON_PASSWORDS = new Set(["password", "123456", "123456789", "qwerty", "12345678", "111111", "1234567890", "1234567", "password1", "abc123", "qwerty123", "iloveyou", "admin", "welcome", "monkey", "letmein", "dragon", "sunshine", "princess", "football", "charlie", "aa123456", "donald", "password123", "qwertyuiop", "starwars", "changeme", "secret", "master", "login"]);

export function analyzePassword(password) {
  if (!password) throw new Error("Enter a password to analyse");
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/\d/.test(password)) pool += 10;
  if (/[^\w]/.test(password)) pool += 32;
  if (/[Ā-￿]/.test(password)) pool += 100;
  const entropy = password.length * Math.log2(Math.max(pool, 2));
  const penalties = [];
  if (COMMON_PASSWORDS.has(password.toLowerCase())) penalties.push("Appears in every common-password list");
  if (/^(.)\1+$/.test(password)) penalties.push("Every character is the same");
  if (/(.)\1{2,}/.test(password)) penalties.push("Contains a character repeated three or more times");
  if (/(?:abc|bcd|cde|123|234|345|456|567|678|789|qwe|wer|ert|asd|sdf)/i.test(password)) penalties.push("Contains a keyboard or alphabet run");
  if (password.length < 12) penalties.push("Shorter than the 12-character minimum most guidance recommends");
  const effective = Math.max(0, entropy - penalties.length * 12);
  const verdicts = [[28, "Very weak"], [40, "Weak"], [60, "Reasonable"], [80, "Strong"], [Infinity, "Very strong"]];
  const verdict = verdicts.find(([threshold]) => effective < threshold)[1];
  const guessesPerSecond = 1e11;
  const seconds = 2 ** (effective - 1) / guessesPerSecond;
  return [
    `Verdict        ${verdict}`,
    `Length         ${password.length} characters`,
    `Alphabet       ${pool} possible characters`,
    `Raw entropy    ${entropy.toFixed(1)} bits`,
    `Adjusted       ${effective.toFixed(1)} bits`,
    `Offline crack  ${describeDuration(seconds)} at 10^11 guesses/second`,
    "",
    penalties.length ? `Issues\n${penalties.map((issue) => `  · ${issue}`).join("\n")}` : "Issues\n  · None detected",
  ].join("\n");
}

function describeDuration(seconds) {
  if (!Number.isFinite(seconds)) return "longer than the age of the universe";
  const units = [["second", "seconds", 1], ["minute", "minutes", 60], ["hour", "hours", 3600], ["day", "days", 86400], ["year", "years", 31557600], ["century", "centuries", 3155760000]];
  if (seconds < 1) return "instantly";
  let best = units[0];
  for (const unit of units) if (seconds >= unit[2]) best = unit;
  const value = seconds / best[2];
  if (value > 1e12) return `${value.toExponential(2)} ${best[1]}`;
  const label = value === 1 ? best[0] : best[1];
  return `${value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString("en-US")} ${label}`;
}

export function generateToken({ length = 32, alphabet = "alphanumeric" } = {}) {
  const alphabets = {
    alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
    hex: "0123456789abcdef",
    "url safe": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
    numeric: "0123456789",
    base58: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
  };
  const pool = alphabets[alphabet];
  if (!pool) throw new Error(`Unknown alphabet "${alphabet}"`);
  const size = Math.max(1, Math.min(4096, Math.floor(length)));
  return Array.from({ length: size }, () => pool[randomIndex(pool.length)]).join("");
}

export function basicAuthHeader(username, password) {
  if (!username) throw new Error("Enter a username");
  const credentials = bytesToBase64(textToBytes(`${username}:${password}`));
  return [
    `Authorization: Basic ${credentials}`,
    "",
    `curl -H 'Authorization: Basic ${credentials}' https://example.com`,
    `curl -u '${username}:${password}' https://example.com`,
    "",
    "Basic authentication only base64-encodes credentials — always send it over HTTPS.",
  ].join("\n");
}

export { bytesToHex, hexToBytes };
