// A complete QR Code encoder (ISO/IEC 18004): numeric, alphanumeric, and byte
// modes, versions 1–40, all four error-correction levels, automatic version
// selection, and penalty-scored mask selection.

export const EC_LEVELS = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// Error-correction codewords per block, indexed [level][version].
const EC_CODEWORDS = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

// Number of error-correction blocks, indexed [level][version].
const EC_BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 5, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 57, 60, 63, 66, 70, 74, 77, 81, 85],
};

const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/* ------------------------------------------------------- galois field --- */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let value = 1;
  for (let index = 0; index < 255; index++) {
    GF_EXP[index] = value;
    GF_LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index++) GF_EXP[index] = GF_EXP[index - 255];
})();

function gfMultiply(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function generatorPolynomial(degree) {
  let polynomial = [1];
  for (let index = 0; index < degree; index++) {
    const next = new Array(polynomial.length + 1).fill(0);
    for (let position = 0; position < polynomial.length; position++) {
      next[position] ^= polynomial[position];
      next[position + 1] ^= gfMultiply(polynomial[position], GF_EXP[index]);
    }
    polynomial = next;
  }
  return polynomial;
}

function reedSolomon(data, degree) {
  const generator = generatorPolynomial(degree);
  const remainder = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    for (let index = 0; index < degree; index++) remainder[index] ^= gfMultiply(generator[index + 1], factor);
  }
  return remainder;
}

/* ------------------------------------------------------------ capacity --- */

function rawDataModules(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignmentCount = Math.floor(version / 7) + 2;
    modules -= (25 * alignmentCount - 10) * alignmentCount - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

function dataCodewords(version, level) {
  return Math.floor(rawDataModules(version) / 8) - EC_CODEWORDS[level][version] * EC_BLOCKS[level][version];
}

function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let position = version * 4 + 10; positions.length < count; position -= step) positions.splice(1, 0, position);
  return positions;
}

/* ---------------------------------------------------------------- bits --- */

class BitBuffer {
  constructor() { this.bits = []; }
  put(value, length) {
    for (let index = length - 1; index >= 0; index--) this.bits.push((value >>> index) & 1);
  }
  get length() { return this.bits.length; }
  toBytes() {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, index) => { if (bit) bytes[index >> 3] |= 0x80 >> (index & 7); });
    return bytes;
  }
}

function chooseMode(text) {
  if (/^\d*$/.test(text)) return "numeric";
  if ([...text].every((character) => ALPHANUMERIC.includes(character))) return "alphanumeric";
  return "byte";
}

function characterCountBits(mode, version) {
  const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] }[mode][group];
}

function encodeSegment(buffer, text, mode, version, bytes) {
  const indicators = { numeric: 1, alphanumeric: 2, byte: 4 };
  buffer.put(indicators[mode], 4);
  if (mode === "byte") {
    buffer.put(bytes.length, characterCountBits(mode, version));
    for (const byte of bytes) buffer.put(byte, 8);
    return;
  }
  buffer.put(text.length, characterCountBits(mode, version));
  if (mode === "numeric") {
    for (let index = 0; index < text.length; index += 3) {
      const chunk = text.slice(index, index + 3);
      buffer.put(Number(chunk), chunk.length * 3 + 1);
    }
    return;
  }
  for (let index = 0; index < text.length; index += 2) {
    if (index + 1 < text.length) buffer.put(ALPHANUMERIC.indexOf(text[index]) * 45 + ALPHANUMERIC.indexOf(text[index + 1]), 11);
    else buffer.put(ALPHANUMERIC.indexOf(text[index]), 6);
  }
}

/* -------------------------------------------------------------- encode --- */

export function encodeQr(text, { level = "M", minVersion = 1 } = {}) {
  if (!text) throw new Error("Enter something to encode");
  if (!(level in EC_CODEWORDS)) throw new Error(`Unknown error-correction level "${level}"`);
  const bytes = new TextEncoder().encode(text);
  const mode = chooseMode(text);

  let version = Math.max(1, Math.min(40, minVersion));
  for (; version <= 40; version++) {
    const probe = new BitBuffer();
    encodeSegment(probe, text, mode, version, bytes);
    if (probe.length <= dataCodewords(version, level) * 8) break;
  }
  if (version > 40) throw new Error(`That is too much data for a QR code at level ${level} — ${bytes.length} bytes exceeds the format maximum`);

  const capacity = dataCodewords(version, level) * 8;
  const buffer = new BitBuffer();
  encodeSegment(buffer, text, mode, version, bytes);
  buffer.put(0, Math.min(4, capacity - buffer.length));
  while (buffer.length % 8 !== 0) buffer.put(0, 1);
  const data = new Uint8Array(dataCodewords(version, level));
  data.set(buffer.toBytes());
  for (let index = buffer.toBytes().length, pad = 0; index < data.length; index++, pad++) data[index] = pad % 2 === 0 ? 0xec : 0x11;

  const codewords = interleave(data, version, level);
  const size = version * 4 + 17;
  const { modules, reserved } = buildFunctionPatterns(version, size);
  placeCodewords(modules, reserved, codewords, size);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = modules.map((row) => [...row]);
    applyMask(candidate, reserved, mask, size);
    drawFormat(candidate, level, mask, size);
    const penalty = scoreMask(candidate, size);
    if (!best || penalty < best.penalty) best = { penalty, mask, modules: candidate };
  }
  if (version >= 7) drawVersion(best.modules, version, size);

  return { modules: best.modules, size, version, level, mask: best.mask, mode, bytes: bytes.length };
}

function interleave(data, version, level) {
  const blockCount = EC_BLOCKS[level][version];
  const ecLength = EC_CODEWORDS[level][version];
  const shortLength = Math.floor(data.length / blockCount);
  const longCount = data.length % blockCount;
  const blocks = [];
  let offset = 0;
  for (let index = 0; index < blockCount; index++) {
    const length = shortLength + (index >= blockCount - longCount ? 1 : 0);
    const block = data.subarray(offset, offset + length);
    offset += length;
    blocks.push({ data: block, ec: reedSolomon(block, ecLength) });
  }
  const output = [];
  const maxData = shortLength + (longCount ? 1 : 0);
  for (let index = 0; index < maxData; index++) {
    for (const block of blocks) if (index < block.data.length) output.push(block.data[index]);
  }
  for (let index = 0; index < ecLength; index++) {
    for (const block of blocks) output.push(block.ec[index]);
  }
  return Uint8Array.from(output);
}

function buildFunctionPatterns(version, size) {
  const modules = Array.from({ length: size }, () => new Array(size).fill(0));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (row, column, value) => { modules[row][column] = value; reserved[row][column] = true; };

  const finder = (top, left) => {
    for (let row = -1; row <= 7; row++) {
      for (let column = -1; column <= 7; column++) {
        const y = top + row;
        const x = left + column;
        if (y < 0 || y >= size || x < 0 || x >= size) continue;
        const inRing = (row >= 0 && row <= 6 && (column === 0 || column === 6)) || (column >= 0 && column <= 6 && (row === 0 || row === 6));
        const inCore = row >= 2 && row <= 4 && column >= 2 && column <= 4;
        set(y, x, inRing || inCore ? 1 : 0);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (let index = 8; index < size - 8; index++) {
    const value = index % 2 === 0 ? 1 : 0;
    set(6, index, value);
    set(index, 6, value);
  }

  const positions = alignmentPositions(version);
  for (const row of positions) {
    for (const column of positions) {
      if ((row === 6 && column === 6) || (row === 6 && column === size - 7) || (row === size - 7 && column === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ring = Math.max(Math.abs(dy), Math.abs(dx));
          set(row + dy, column + dx, ring === 1 ? 0 : 1);
        }
      }
    }
  }

  // Format information areas plus the always-dark module.
  for (let index = 0; index < 9; index++) {
    if (!reserved[8][index]) set(8, index, 0);
    if (!reserved[index][8]) set(index, 8, 0);
  }
  for (let index = 0; index < 8; index++) {
    if (!reserved[8][size - 1 - index]) set(8, size - 1 - index, 0);
    if (!reserved[size - 1 - index][8]) set(size - 1 - index, 8, 0);
  }
  set(size - 8, 8, 1);

  if (version >= 7) {
    for (let index = 0; index < 18; index++) {
      const row = Math.floor(index / 3);
      const column = index % 3;
      set(size - 11 + column, row, 0);
      set(row, size - 11 + column, 0);
    }
  }
  return { modules, reserved };
}

function placeCodewords(modules, reserved, codewords, size) {
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset++) {
        const column = right - offset;
        if (reserved[row][column]) continue;
        const byte = codewords[bitIndex >> 3];
        modules[row][column] = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (row, column) => (row + column) % 2 === 0,
  (row) => row % 2 === 0,
  (row, column) => column % 3 === 0,
  (row, column) => (row + column) % 3 === 0,
  (row, column) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
  (row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
  (row, column) => (((row * column) % 2) + ((row * column) % 3)) % 2 === 0,
  (row, column) => (((row + column) % 2) + ((row * column) % 3)) % 2 === 0,
];

function applyMask(modules, reserved, mask, size) {
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (reserved[row][column]) continue;
      if (MASKS[mask](row, column)) modules[row][column] ^= 1;
    }
  }
}

export function formatBits(level, mask) {
  const data = (FORMAT_BITS[level] << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index++) remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537);
  return (((data << 10) | remainder) ^ 0x5412) & 0x7fff;
}

export function versionBits(version) {
  let remainder = version;
  for (let index = 0; index < 12; index++) remainder = (remainder << 1) ^ ((remainder >> 11) * 0x1f25);
  return ((version << 12) | remainder) & 0x3ffff;
}

/** Writes both copies of the 15-bit format string in the layout of ISO 18004 §8.9. */
function drawFormat(modules, level, mask, size) {
  const bits = formatBits(level, mask);
  for (let index = 0; index < 15; index++) {
    const bit = (bits >> index) & 1;
    if (index < 6) modules[index][8] = bit;
    else if (index < 8) modules[index + 1][8] = bit;
    else modules[size - 15 + index][8] = bit;

    if (index < 8) modules[8][size - index - 1] = bit;
    else if (index === 8) modules[8][7] = bit;
    else modules[8][14 - index] = bit;
  }
  modules[size - 8][8] = 1;
}

function drawVersion(modules, version, size) {
  const bits = versionBits(version);
  for (let index = 0; index < 18; index++) {
    const bit = (bits >> index) & 1;
    const row = Math.floor(index / 3);
    const column = index % 3;
    modules[size - 11 + column][row] = bit;
    modules[row][size - 11 + column] = bit;
  }
}

function scoreMask(modules, size) {
  let penalty = 0;

  const runPenalty = (line) => {
    let total = 0;
    let runLength = 1;
    for (let index = 1; index < line.length; index++) {
      if (line[index] === line[index - 1]) runLength++;
      else { if (runLength >= 5) total += 3 + (runLength - 5); runLength = 1; }
    }
    if (runLength >= 5) total += 3 + (runLength - 5);
    return total;
  };
  for (let row = 0; row < size; row++) penalty += runPenalty(modules[row]);
  for (let column = 0; column < size; column++) penalty += runPenalty(modules.map((row) => row[column]));

  for (let row = 0; row < size - 1; row++) {
    for (let column = 0; column < size - 1; column++) {
      const value = modules[row][column];
      if (value === modules[row][column + 1] && value === modules[row + 1][column] && value === modules[row + 1][column + 1]) penalty += 3;
    }
  }

  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const matches = (line, start) => pattern.every((bit, offset) => line[start + offset] === bit);
  const quiet = (line, start, end) => {
    for (let index = start; index < end; index++) if (line[index] !== 0) return false;
    return true;
  };
  const finderPenalty = (line) => {
    let total = 0;
    for (let index = 0; index + 7 <= line.length; index++) {
      if (!matches(line, index)) continue;
      if (index >= 4 && quiet(line, index - 4, index)) total += 40;
      if (index + 11 <= line.length && quiet(line, index + 7, index + 11)) total += 40;
    }
    return total;
  };
  for (let row = 0; row < size; row++) penalty += finderPenalty(modules[row]);
  for (let column = 0; column < size; column++) penalty += finderPenalty(modules.map((row) => row[column]));

  const dark = modules.flat().reduce((sum, value) => sum + value, 0);
  const percentage = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(percentage - 50) / 5) * 10;
  return penalty;
}

/* -------------------------------------------------------------- output --- */

export function qrToSvg(text, { level = "M", scale = 8, margin = 4, dark = "#000000", light = "#ffffff", title = "" } = {}) {
  const code = encodeQr(text, { level });
  const dimension = (code.size + margin * 2) * scale;
  const path = [];
  for (let row = 0; row < code.size; row++) {
    for (let column = 0; column < code.size; column++) {
      if (code.modules[row][column]) path.push(`M${column + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 ${code.size + margin * 2} ${code.size + margin * 2}" shape-rendering="crispEdges" role="img" aria-label="${escapeAttribute(title || text.slice(0, 80))}">`,
    `  <rect width="${code.size + margin * 2}" height="${code.size + margin * 2}" fill="${escapeAttribute(light)}"/>`,
    `  <path fill="${escapeAttribute(dark)}" d="${path.join("")}"/>`,
    "</svg>",
  ].join("\n");
}

export function qrToText(text, options = {}) {
  const code = encodeQr(text, options);
  const margin = 2;
  const lines = [];
  const get = (row, column) => (row < 0 || column < 0 || row >= code.size || column >= code.size ? 0 : code.modules[row][column]);
  for (let row = -margin; row < code.size + margin; row += 2) {
    let line = "";
    for (let column = -margin; column < code.size + margin; column++) {
      const top = get(row, column);
      const bottom = get(row + 1, column);
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(line);
  }
  return { art: lines.join("\n"), code };
}

function escapeAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function wifiPayload({ ssid, password = "", security = "WPA", hidden = false }) {
  if (!ssid) throw new Error("Enter the network name");
  const escape = (value) => String(value).replace(/([\\;,:"])/g, "\\$1");
  const parts = [`T:${security === "nopass" ? "nopass" : security}`, `S:${escape(ssid)}`];
  if (security !== "nopass") parts.push(`P:${escape(password)}`);
  if (hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}

export function vcardPayload({ name = "", organization = "", title = "", phone = "", email = "", url = "", address = "" }) {
  if (!name) throw new Error("Enter a full name");
  const parts = name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts.at(-1) : "";
  const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : name;
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${last};${first};;;`,
    `FN:${name}`,
    organization && `ORG:${organization}`,
    title && `TITLE:${title}`,
    phone && `TEL;TYPE=CELL:${phone}`,
    email && `EMAIL:${email}`,
    url && `URL:${url}`,
    address && `ADR;TYPE=WORK:;;${address.replace(/\n/g, ";")}`,
    "END:VCARD",
  ].filter(Boolean).join("\n");
}
