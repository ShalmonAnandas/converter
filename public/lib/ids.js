// Identifier generation and inspection: UUID v1/v3/v4/v5/v7, ULID, and Nano ID.

import { randomBytes, randomIndex, bytesToHex } from "./bytes.js";
import { digestBytes } from "./crypto.js";
import { report } from "./report.js";

export const UUID_NAMESPACES = {
  DNS: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  URL: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
  OID: "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
  X500: "6ba7b814-9dad-11d1-80b4-00c04fd430c8",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatUuid(bytes) {
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidToBytes(value) {
  const hex = value.replace(/[\s{}-]|^urn:uuid:/gi, "");
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`"${value}" is not a UUID`);
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

function stamp(bytes, version, variant = 0x80) {
  bytes[6] = (bytes[6] & 0x0f) | (version << 4);
  bytes[8] = (bytes[8] & 0x3f) | variant;
  return bytes;
}

export function uuidV4() {
  return formatUuid(stamp(randomBytes(16), 4));
}

let v1Clock = randomIndex(0x3fff);
let v1Node = null;

export function uuidV1(at = Date.now()) {
  if (!v1Node) {
    v1Node = randomBytes(6);
    v1Node[0] |= 0x01;
  }
  const intervals = BigInt(at) * 10000n + 122192928000000000n;
  const bytes = new Uint8Array(16);
  const timeLow = Number(intervals & 0xffffffffn);
  const timeMid = Number((intervals >> 32n) & 0xffffn);
  const timeHigh = Number((intervals >> 48n) & 0x0fffn);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, timeLow, false);
  view.setUint16(4, timeMid, false);
  view.setUint16(6, timeHigh | 0x1000, false);
  v1Clock = (v1Clock + 1) & 0x3fff;
  view.setUint16(8, v1Clock | 0x8000, false);
  bytes.set(v1Node, 10);
  return formatUuid(bytes);
}

export function uuidV7(at = Date.now()) {
  const bytes = randomBytes(16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, Math.floor(at / 0x10000), false);
  view.setUint16(4, at % 0x10000, false);
  return formatUuid(stamp(bytes, 7));
}

export async function uuidV3(namespace, name) {
  return nameBasedUuid(namespace, name, "MD5", 3);
}

export async function uuidV5(namespace, name) {
  return nameBasedUuid(namespace, name, "SHA-1", 5);
}

async function nameBasedUuid(namespace, name, algorithm, version) {
  const resolved = UUID_NAMESPACES[namespace?.toUpperCase?.()] ?? namespace;
  if (!resolved || !UUID_PATTERN.test(resolved)) throw new Error("Choose a namespace (DNS, URL, OID, X500) or supply a namespace UUID");
  if (!name) throw new Error("Enter a name to hash into the namespace");
  const namespaceBytes = uuidToBytes(resolved);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(namespaceBytes.length + nameBytes.length);
  input.set(namespaceBytes);
  input.set(nameBytes, namespaceBytes.length);
  const digest = await digestBytes(input, algorithm);
  return formatUuid(stamp(digest.slice(0, 16), version));
}

export function nilUuid() { return "00000000-0000-0000-0000-000000000000"; }
export function maxUuid() { return "ffffffff-ffff-ffff-ffff-ffffffffffff"; }

export function inspectUuid(value) {
  const trimmed = value.trim();
  if (trimmed === nilUuid()) return report([["Canonical", trimmed], ["Version", "Nil UUID — the all-zero special value"]]);
  if (trimmed.toLowerCase() === maxUuid()) return report([["Canonical", trimmed], ["Version", "Max UUID — the all-ones special value"]]);
  const bytes = uuidToBytes(trimmed);
  const version = bytes[6] >> 4;
  const variantBits = bytes[8] >> 5;
  const variant = variantBits < 4 ? "NCS (reserved, legacy)" : variantBits < 6 ? "RFC 9562 / RFC 4122" : variantBits === 6 ? "Microsoft (reserved)" : "Reserved for future use";
  const rows = [
    ["Canonical", formatUuid(bytes)],
    ["Version", `${version}${describeVersion(version)}`],
    ["Variant", variant],
    ["Hex", bytesToHex(bytes)],
    ["URN", `urn:uuid:${formatUuid(bytes)}`],
  ];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (version === 1) {
    const timeLow = BigInt(view.getUint32(0, false));
    const timeMid = BigInt(view.getUint16(4, false));
    const timeHigh = BigInt(view.getUint16(6, false) & 0x0fff);
    const intervals = (timeHigh << 48n) | (timeMid << 32n) | timeLow;
    const milliseconds = Number((intervals - 122192928000000000n) / 10000n);
    rows.push(["Timestamp", new Date(milliseconds).toISOString()]);
    rows.push(["Clock sequence", String(view.getUint16(8, false) & 0x3fff)]);
    rows.push(["Node", bytesToHex(bytes.subarray(10), { separator: ":" })]);
  }
  if (version === 7) {
    const milliseconds = view.getUint32(0, false) * 0x10000 + view.getUint16(4, false);
    rows.push(["Timestamp", new Date(milliseconds).toISOString()]);
  }
  return report(rows);
}

function describeVersion(version) {
  const names = { 1: " — time and node based", 3: " — MD5 name based", 4: " — random", 5: " — SHA-1 name based", 6: " — reordered time based", 7: " — Unix epoch time ordered", 8: " — custom" };
  return names[version] ?? " — unknown";
}

export function validateUuid(value) {
  return UUID_PATTERN.test(value.trim());
}

/* ---------------------------------------------------------------- ulid --- */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(at = Date.now()) {
  let time = "";
  let remaining = at;
  for (let index = 0; index < 10; index++) {
    time = CROCKFORD[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }
  const random = Array.from(randomBytes(16), (byte) => CROCKFORD[byte % 32]).join("");
  return time + random;
}

export function inspectUlid(value) {
  const trimmed = value.trim().toUpperCase();
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(trimmed)) throw new Error("A ULID is 26 Crockford Base32 characters");
  let milliseconds = 0;
  for (const character of trimmed.slice(0, 10)) milliseconds = milliseconds * 32 + CROCKFORD.indexOf(character);
  if (milliseconds > 281474976710655) throw new Error("The ULID timestamp is out of range");
  return report([
    ["ULID", trimmed, "accent"],
    ["Timestamp", `${new Date(milliseconds).toISOString()} (${milliseconds} ms)`],
    ["Randomness", trimmed.slice(10)],
  ]);
}

/* -------------------------------------------------------------- nano id -- */

export function nanoId({ size = 21, alphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict" } = {}) {
  const length = Math.max(1, Math.min(255, Math.floor(size)));
  return Array.from({ length }, () => alphabet[randomIndex(alphabet.length)]).join("");
}

export function macAddress({ separator = ":", uppercase = true, prefix = "" } = {}) {
  const bytes = randomBytes(6);
  bytes[0] = (bytes[0] & 0xfe) | 0x02;
  let parts = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  if (prefix) {
    const given = prefix.replace(/[^0-9a-f]/gi, "").match(/../g) ?? [];
    if (given.length > 6) throw new Error("A MAC prefix can hold at most six bytes");
    parts = [...given.map((pair) => pair.toLowerCase()), ...parts.slice(given.length)];
  }
  const address = parts.join(separator);
  return uppercase ? address.toUpperCase() : address;
}

export function inspectMac(value) {
  const hex = value.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (hex.length !== 12) throw new Error("A MAC address has six bytes (twelve hexadecimal digits)");
  const bytes = hex.match(/../g).map((pair) => Number.parseInt(pair, 16));
  const first = bytes[0];
  return report([
    "Notations",
    ["Colon", bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(":"), "accent"],
    ["Hyphen", bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("-").toUpperCase()],
    ["Cisco", hex.match(/..../g).join(".")],
    ["Bare", hex],
    "",
    "Properties",
    ["OUI", hex.slice(0, 6).match(/../g).join(":").toUpperCase()],
    ["Scope", first & 0x02 ? "Locally administered" : "Universally administered (vendor assigned)"],
    ["Cast", first & 0x01 ? "Multicast" : "Unicast"],
    ["EUI-64", [...bytes.slice(0, 3).map((byte, index) => (index === 0 ? byte ^ 0x02 : byte)), 0xff, 0xfe, ...bytes.slice(3)].map((byte) => byte.toString(16).padStart(2, "0")).join(":")],
  ]);
}
