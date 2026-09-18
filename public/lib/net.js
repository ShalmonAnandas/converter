// Addressing and URL utilities: IPv4 subnetting, address notation, IPv6 ULA
// generation, URL parsing, and user-agent interpretation.

import { randomBytes, bytesToHex } from "./bytes.js";
import { digestBytes } from "./crypto.js";
import { report } from "./report.js";

/* ---------------------------------------------------------------- ipv4 --- */

export function ipv4ToNumber(address) {
  const parts = address.trim().split(".");
  if (parts.length !== 4) throw new Error(`"${address}" is not a dotted-quad IPv4 address`);
  return parts.reduce((total, part) => {
    if (!/^\d{1,3}$/.test(part)) throw new Error(`"${part}" is not an IPv4 octet`);
    const octet = Number(part);
    if (octet > 255) throw new Error(`Octet ${octet} is larger than 255`);
    return total * 256 + octet;
  }, 0);
}

export function numberToIpv4(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 4294967295) throw new Error("An IPv4 address is a 32-bit value between 0 and 4294967295");
  return [24, 16, 8, 0].map((shift) => (number >>> shift) & 255).join(".");
}

export function parseCidr(input) {
  const [address, prefixText] = input.trim().split("/");
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error("The prefix length must be between 0 and 32");
  return { value: ipv4ToNumber(address), prefix };
}

const CLASSES = [
  [0x00000000, 0x7fffffff, "A"],
  [0x80000000, 0xbfffffff, "B"],
  [0xc0000000, 0xdfffffff, "C"],
  [0xe0000000, 0xefffffff, "D (multicast)"],
  [0xf0000000, 0xffffffff, "E (reserved)"],
];

const SPECIAL_RANGES = [
  ["0.0.0.0/8", "This network"],
  ["10.0.0.0/8", "Private (RFC 1918)"],
  ["100.64.0.0/10", "Carrier-grade NAT (RFC 6598)"],
  ["127.0.0.0/8", "Loopback"],
  ["169.254.0.0/16", "Link local"],
  ["172.16.0.0/12", "Private (RFC 1918)"],
  ["192.0.2.0/24", "Documentation TEST-NET-1"],
  ["192.168.0.0/16", "Private (RFC 1918)"],
  ["198.18.0.0/15", "Benchmarking"],
  ["198.51.100.0/24", "Documentation TEST-NET-2"],
  ["203.0.113.0/24", "Documentation TEST-NET-3"],
  ["224.0.0.0/4", "Multicast"],
  ["240.0.0.0/4", "Reserved"],
  ["255.255.255.255/32", "Broadcast"],
];

function describeScope(value) {
  for (const [cidr, label] of SPECIAL_RANGES) {
    const { value: base, prefix } = parseCidr(cidr);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((value & mask) >>> 0 === (base & mask) >>> 0) return label;
  }
  return "Public";
}

export function subnetReport(input) {
  const { value, prefix } = parseCidr(input);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (value & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  const usable = prefix >= 31 ? (prefix === 32 ? 1 : 2) : total - 2;
  const firstHost = prefix >= 31 ? network : network + 1;
  const lastHost = prefix >= 31 ? broadcast : broadcast - 1;
  const addressClass = CLASSES.find(([low, high]) => value >>> 0 >= low >>> 0 && value >>> 0 <= high >>> 0)?.[2] ?? "—";
  const rows = [
    ["Address", `${numberToIpv4(value)}/${prefix}`],
    ["Netmask", `${numberToIpv4(mask)} = ${prefix}`],
    ["Wildcard", numberToIpv4(~mask >>> 0)],
    ["Network", `${numberToIpv4(network)}/${prefix}`],
    ["Broadcast", numberToIpv4(broadcast)],
    ["First host", numberToIpv4(firstHost)],
    ["Last host", numberToIpv4(lastHost)],
    ["Total addresses", total.toLocaleString("en-US")],
    ["Usable hosts", usable.toLocaleString("en-US")],
    ["Class", addressClass],
    ["Scope", describeScope(value)],
    ["Binary", [24, 16, 8, 0].map((shift) => ((value >>> shift) & 255).toString(2).padStart(8, "0")).join(".")],
    ["Integer", String(value >>> 0)],
    ["Hex", `0x${(value >>> 0).toString(16).padStart(8, "0").toUpperCase()}`],
    ["ARPA", `${[0, 8, 16, 24].map((shift) => (value >>> shift) & 255).join(".")}.in-addr.arpa`],
  ];
  return report(rows);
}

export function convertIpv4(input) {
  const trimmed = input.trim();
  let value;
  if (/^[01]{8}(\.[01]{8}){3}$/.test(trimmed) || /^[01]{32}$/.test(trimmed)) value = Number.parseInt(trimmed.replaceAll(".", ""), 2);
  else if (/^0x[0-9a-f]{1,8}$/i.test(trimmed)) value = Number.parseInt(trimmed, 16);
  else if (/^(0x[0-9a-f]{1,2}\.){3}0x[0-9a-f]{1,2}$/i.test(trimmed)) value = trimmed.split(".").reduce((total, part) => total * 256 + Number.parseInt(part, 16), 0);
  else if (/^\d{1,10}$/.test(trimmed) && Number(trimmed) <= 4294967295) value = Number(trimmed);
  else value = ipv4ToNumber(trimmed);
  if (value > 4294967295 || value < 0) throw new Error("The value does not fit in 32 bits");
  const octets = [24, 16, 8, 0].map((shift) => (value >>> shift) & 255);
  const rows = [
    ["Dotted decimal", octets.join(".")],
    ["Decimal", String(value >>> 0)],
    ["Hexadecimal", `0x${(value >>> 0).toString(16).padStart(8, "0").toUpperCase()}`],
    ["Octal", `0${(value >>> 0).toString(8)}`],
    ["Binary", octets.map((octet) => octet.toString(2).padStart(8, "0")).join(".")],
    ["Dotted hex", octets.map((octet) => `0x${octet.toString(16).padStart(2, "0")}`).join(".")],
    ["IPv6 mapped", `::ffff:${octets.slice(0, 2).map((octet) => octet.toString(16).padStart(2, "0")).join("")}:${octets.slice(2).map((octet) => octet.toString(16).padStart(2, "0")).join("")}`],
    ["IPv6 compat", `::${octets.join(".")}`],
    ["ARPA", `${[...octets].reverse().join(".")}.in-addr.arpa`],
    ["Scope", describeScope(value)],
  ];
  return report(rows);
}

export function expandRange(input, { limit = 4096 } = {}) {
  const trimmed = input.trim();
  let start;
  let end;
  if (trimmed.includes("/")) {
    const { value, prefix } = parseCidr(trimmed);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    start = (value & mask) >>> 0;
    end = (start | (~mask >>> 0)) >>> 0;
  } else if (trimmed.includes("-")) {
    const [from, to] = trimmed.split("-").map((part) => part.trim());
    start = ipv4ToNumber(from);
    end = /^\d{1,3}$/.test(to) ? (start & 0xffffff00) + Number(to) : ipv4ToNumber(to);
  } else {
    start = ipv4ToNumber(trimmed);
    end = start;
  }
  if (end < start) throw new Error("The end of the range is lower than the start");
  const count = end - start + 1;
  if (count > limit) throw new Error(`That range holds ${count.toLocaleString("en-US")} addresses — narrow it to ${limit.toLocaleString("en-US")} or fewer`);
  const addresses = Array.from({ length: count }, (_, offset) => numberToIpv4(start + offset));
  return `${count.toLocaleString("en-US")} addresses from ${numberToIpv4(start)} to ${numberToIpv4(end)}\n\n${addresses.join("\n")}`;
}

export function summarizeRange(input) {
  const [from, to] = input.split("-").map((part) => part.trim());
  if (!to) throw new Error('Enter a range as "start - end"');
  let start = ipv4ToNumber(from);
  const end = ipv4ToNumber(to);
  if (end < start) throw new Error("The end of the range is lower than the start");
  const blocks = [];
  while (start <= end) {
    let size = 32;
    while (size > 0) {
      const mask = (0xffffffff << (32 - (size - 1))) >>> 0;
      if (((start & mask) >>> 0) !== start || start + 2 ** (32 - (size - 1)) - 1 > end) break;
      size--;
    }
    blocks.push(`${numberToIpv4(start)}/${size}`);
    start += 2 ** (32 - size);
    if (blocks.length > 512) throw new Error("That range needs more than 512 CIDR blocks");
  }
  return `${blocks.length} CIDR block${blocks.length === 1 ? "" : "s"} cover this range\n\n${blocks.join("\n")}`;
}

/* ---------------------------------------------------------------- ipv6 --- */

export async function generateUla(macAddress = "") {
  const seed = macAddress.replace(/[^0-9a-f]/gi, "") || bytesToHex(randomBytes(8));
  const timestamp = BigInt(Date.now()) * 1000000n;
  const material = new TextEncoder().encode(`${timestamp}-${seed}`);
  const digest = await digestBytes(material, "SHA-1");
  const globalId = bytesToHex(digest.subarray(digest.length - 5));
  const prefix = `fd${globalId.slice(0, 2)}:${globalId.slice(2, 6)}:${globalId.slice(6, 10)}`;
  return report([
    ["Global ID", globalId],
    ["/48 prefix", `${prefix}::/48`],
    ["First /64", `${prefix}:0000::/64`],
    "",
    "Sample /64 subnets",
    ...Array.from({ length: 5 }, (_, index) => [`Subnet ${index}`, `${prefix}:${index.toString(16).padStart(4, "0")}::/64`]),
    "",
    ["Note", "Unique local addresses (RFC 4193) are private to your organisation and are not routed on the public internet."],
  ]);
}

export function expandIpv6(input) {
  const address = input.trim().split("%")[0];
  if (!/^[0-9a-f:.]+$/i.test(address)) throw new Error("That is not an IPv6 address");
  const parts = address.split("::");
  if (parts.length > 2) throw new Error('An IPv6 address may only contain one "::"');
  const toGroups = (text) => (text ? text.split(":").filter((part) => part !== "") : []);
  const head = toGroups(parts[0]);
  const tail = parts.length === 2 ? toGroups(parts[1]) : [];
  const last = tail.at(-1) ?? head.at(-1);
  const embedded = [];
  if (last && last.includes(".")) {
    const value = ipv4ToNumber(last);
    embedded.push(((value >>> 16) & 0xffff).toString(16), (value & 0xffff).toString(16));
    if (tail.length) tail.splice(-1, 1, ...embedded);
    else head.splice(-1, 1, ...embedded);
  }
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 && head.length !== 8) throw new Error("A full IPv6 address needs eight groups");
  if (missing < 0) throw new Error("That address has more than eight groups");
  const groups = [...head, ...Array.from({ length: parts.length === 2 ? missing : 0 }, () => "0"), ...tail];
  const normalized = groups.map((group) => {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) throw new Error(`"${group}" is not a valid IPv6 group`);
    return group.toLowerCase().padStart(4, "0");
  });
  const compressed = compressIpv6(normalized);
  const rows = [
    ["Expanded", normalized.join(":")],
    ["Compressed", compressed],
    ["Groups", normalized.map((group) => `0x${group}`).join(" ")],
    ["ARPA", `${normalized.join("").split("").reverse().join(".")}.ip6.arpa`],
  ];
  return report(rows);
}

function compressIpv6(groups) {
  const trimmed = groups.map((group) => group.replace(/^0+(?=.)/, ""));
  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  for (let index = 0; index <= trimmed.length; index++) {
    if (index < trimmed.length && trimmed[index] === "0") {
      if (start === -1) start = index;
    } else if (start !== -1) {
      if (index - start > bestLength) { bestLength = index - start; bestStart = start; }
      start = -1;
    }
  }
  if (bestLength < 2) return trimmed.join(":");
  return `${trimmed.slice(0, bestStart).join(":")}::${trimmed.slice(bestStart + bestLength).join(":")}`;
}

/* ----------------------------------------------------------------- url --- */

export function parseUrl(input) {
  const trimmed = input.trim();
  let url;
  try { url = new URL(trimmed); }
  catch { throw new Error(`"${trimmed}" is not an absolute URL — include the scheme, for example https://`); }
  const rows = [
    ["Href", url.href],
    ["Protocol", url.protocol],
    ["Username", url.username || "—"],
    ["Password", url.password ? "(present)" : "—"],
    ["Host", url.host],
    ["Hostname", url.hostname],
    ["Port", url.port || `(default${url.protocol === "https:" ? " 443" : url.protocol === "http:" ? " 80" : ""})`],
    ["Origin", url.origin],
    ["Path", url.pathname],
    ["Search", url.search || "—"],
    ["Hash", url.hash || "—"],
  ];
  const parameters = [...url.searchParams.entries()];
  if (parameters.length) {
    rows.push("", `Query parameters (${parameters.length})`, ...parameters.map(([key, value]) => [key, value]));
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length) {
    rows.push("", `Path segments (${segments.length})`, ...segments.map((segment, index) => [String(index), decodeURIComponent(segment)]));
  }
  return report(rows);
}

export function buildQuery(input) {
  const value = JSON.parse(input);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Provide a JSON object of query parameters");
  const parameters = new URLSearchParams();
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) item.forEach((entry) => parameters.append(key, String(entry)));
    else if (item !== null && item !== undefined) parameters.append(key, typeof item === "object" ? JSON.stringify(item) : String(item));
  }
  return parameters.toString();
}

/* ---------------------------------------------------------- user agent --- */

const BROWSERS = [
  [/Edg(?:e|A|iOS)?\/([\d.]+)/, "Edge"],
  [/OPR\/([\d.]+)/, "Opera"],
  [/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
  [/Firefox\/([\d.]+)/, "Firefox"],
  [/CriOS\/([\d.]+)/, "Chrome (iOS)"],
  [/Chrome\/([\d.]+)/, "Chrome"],
  [/Version\/([\d.]+).*Safari/, "Safari"],
  [/MSIE ([\d.]+)/, "Internet Explorer"],
  [/Trident.*rv:([\d.]+)/, "Internet Explorer"],
  [/curl\/([\d.]+)/, "curl"],
  [/Wget\/([\d.]+)/, "Wget"],
  [/PostmanRuntime\/([\d.]+)/, "Postman"],
  [/node-fetch\/([\d.]+)/, "node-fetch"],
];

const SYSTEMS = [
  [/Windows NT 10\.0/, "Windows 10 or 11"],
  [/Windows NT 6\.3/, "Windows 8.1"],
  [/Windows NT 6\.1/, "Windows 7"],
  [/Android ([\d.]+)/, "Android $1"],
  [/iPhone OS ([\d_]+)/, "iOS $1"],
  [/CPU OS ([\d_]+)/, "iPadOS $1"],
  [/Mac OS X ([\d_.]+)/, "macOS $1"],
  [/Mac OS X/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Ubuntu/, "Ubuntu"],
  [/Linux/, "Linux"],
];

export function parseUserAgent(input) {
  const agent = input.trim();
  if (!agent) throw new Error("Paste a User-Agent string");
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent));
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent));
  const engine = /AppleWebKit/.test(agent) ? (/Chrome|Edg|OPR/.test(agent) ? "Blink" : "WebKit") : /Gecko\/|rv:/.test(agent) ? "Gecko" : /Trident/.test(agent) ? "Trident" : "—";
  const isBot = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headless/i.test(agent);
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/.test(agent);
  const rows = [
    ["Browser", browser ? `${browser[1]} ${browser[0].exec(agent)?.[1] ?? ""}`.trim() : "Unrecognised"],
    ["Engine", engine],
    ["Operating system", system ? system[1].replace("$1", (system[0].exec(agent)?.[1] ?? "").replaceAll("_", ".")) : "Unrecognised"],
    ["Device type", isBot ? "Bot or crawler" : isMobile ? (/iPad|Tablet/.test(agent) ? "Tablet" : "Phone") : "Desktop"],
    ["Touch hints", isMobile ? "Likely" : "Unlikely"],
    ["Raw length", `${agent.length} characters`],
  ];
  return report([
    ...rows,
    "",
    ["Note", "User-Agent strings are self-reported and easily spoofed — prefer feature detection."],
  ]);
}
