// A TOML v1.0 reader and writer: tables, array-of-tables, dotted keys, every
// string form, typed numbers, dates, arrays, and inline tables.

export function parseToml(source) {
  return new TomlReader(String(source).replace(/\r\n?/g, "\n")).read();
}

const BARE_KEY = /^[A-Za-z0-9_-]+/;
const SEPARATOR = "\u241f";

class TomlReader {
  constructor(source) {
    this.source = source;
    this.index = 0;
    this.line = 1;
    this.root = {};
    this.defined = new WeakMap();
    this.tables = new Set();
  }

  read() {
    let current = this.root;
    let currentPath = [];
    for (;;) {
      this.skipTrivia();
      if (this.index >= this.source.length) break;
      if (this.source[this.index] === "[") {
        const isArray = this.source[this.index + 1] === "[";
        this.index += isArray ? 2 : 1;
        const path = this.readKeyPath();
        this.skipInlineSpace();
        const closing = isArray ? "]]" : "]";
        if (this.source.slice(this.index, this.index + closing.length) !== closing) this.fail(`Expected "${closing}" to close the table header`);
        this.index += closing.length;
        current = isArray ? this.openArrayTable(path) : this.openTable(path);
        currentPath = path;
        this.endOfLine();
        continue;
      }
      const path = this.readKeyPath();
      this.skipInlineSpace();
      if (this.source[this.index] !== "=") this.fail('Expected "=" after a key');
      this.index++;
      this.skipInlineSpace();
      const value = this.readValue();
      this.assign(current, currentPath, path, value);
      this.endOfLine();
    }
    return this.root;
  }

  fail(message) { throw new Error(`Line ${this.line}: ${message}`); }

  skipInlineSpace() {
    while (this.index < this.source.length && (this.source[this.index] === " " || this.source[this.index] === "\t")) this.index++;
  }

  skipTrivia() {
    for (;;) {
      this.skipInlineSpace();
      const character = this.source[this.index];
      if (character === "\n") { this.index++; this.line++; continue; }
      if (character === "#") { while (this.index < this.source.length && this.source[this.index] !== "\n") this.index++; continue; }
      return;
    }
  }

  endOfLine() {
    this.skipInlineSpace();
    if (this.source[this.index] === "#") while (this.index < this.source.length && this.source[this.index] !== "\n") this.index++;
    if (this.index >= this.source.length) return;
    if (this.source[this.index] !== "\n") this.fail(`Unexpected "${this.source[this.index]}" after a value`);
    this.index++;
    this.line++;
  }

  readKeyPath() {
    const path = [];
    for (;;) {
      this.skipInlineSpace();
      const character = this.source[this.index];
      if (character === '"' || character === "'") path.push(this.readString());
      else {
        const match = BARE_KEY.exec(this.source.slice(this.index));
        if (!match) this.fail("Expected a key");
        path.push(match[0]);
        this.index += match[0].length;
      }
      this.skipInlineSpace();
      if (this.source[this.index] === ".") { this.index++; continue; }
      return path;
    }
  }

  openTable(path) {
    let node = this.root;
    const key = path.join(SEPARATOR);
    for (let depth = 0; depth < path.length; depth++) {
      const segment = path[depth];
      if (Array.isArray(node[segment])) node = node[segment].at(-1);
      else if (node[segment] === undefined) node = (node[segment] = {});
      else if (typeof node[segment] === "object") node = node[segment];
      else this.fail(`"${path.slice(0, depth + 1).join(".")}" is already a value`);
    }
    if (this.tables.has(key)) this.fail(`Table "${path.join(".")}" is defined twice`);
    this.tables.add(key);
    return node;
  }

  openArrayTable(path) {
    let node = this.root;
    for (let depth = 0; depth < path.length - 1; depth++) {
      const segment = path[depth];
      if (Array.isArray(node[segment])) node = node[segment].at(-1);
      else node = (node[segment] ??= {});
    }
    const last = path.at(-1);
    if (node[last] === undefined) node[last] = [];
    if (!Array.isArray(node[last])) this.fail(`"${path.join(".")}" is not an array of tables`);
    const entry = {};
    node[last].push(entry);
    return entry;
  }

  assign(table, tablePath, path, value) {
    let node = table;
    for (let depth = 0; depth < path.length - 1; depth++) {
      const segment = path[depth];
      if (node[segment] === undefined) node[segment] = {};
      else if (typeof node[segment] !== "object" || Array.isArray(node[segment])) this.fail(`"${segment}" is already a value`);
      node = node[segment];
    }
    const last = path.at(-1);
    if (!this.defined.has(table)) this.defined.set(table, new Set());
    const seen = this.defined.get(table);
    const full = path.join(SEPARATOR);
    if (seen.has(full)) this.fail(`Key "${[...tablePath, ...path].join(".")}" is defined twice`);
    seen.add(full);
    node[last] = value;
  }

  readString() {
    const quote = this.source[this.index];
    if (this.source.slice(this.index, this.index + 3) === quote.repeat(3)) return this.readMultilineString(quote);
    this.index++;
    let result = "";
    for (;;) {
      if (this.index >= this.source.length) this.fail("Unterminated string");
      const character = this.source[this.index];
      if (character === "\n") this.fail("Unterminated string");
      if (character === quote) { this.index++; return result; }
      if (quote === '"' && character === "\\") { result += this.readEscape(); continue; }
      result += character;
      this.index++;
    }
  }

  readMultilineString(quote) {
    this.index += 3;
    if (this.source[this.index] === "\n") { this.index++; this.line++; }
    let result = "";
    for (;;) {
      if (this.index >= this.source.length) this.fail("Unterminated multi-line string");
      if (this.source.slice(this.index, this.index + 3) === quote.repeat(3)) {
        this.index += 3;
        while (this.source[this.index] === quote) { result += quote; this.index++; }
        return result;
      }
      const character = this.source[this.index];
      if (quote === '"' && character === "\\") {
        const fold = /^\\[ \t]*\n\s*/.exec(this.source.slice(this.index));
        if (fold) {
          this.line += (fold[0].match(/\n/g) || []).length;
          this.index += fold[0].length;
          continue;
        }
        result += this.readEscape();
        continue;
      }
      if (character === "\n") this.line++;
      result += character;
      this.index++;
    }
  }

  readEscape() {
    this.index++;
    const character = this.source[this.index++];
    const simple = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "'": "'", e: "\u001b" };
    if (character in simple) return simple[character];
    if (character === "u" || character === "U") {
      const length = character === "u" ? 4 : 8;
      const hex = this.source.slice(this.index, this.index + length);
      if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) this.fail("Invalid unicode escape");
      this.index += length;
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    this.fail(`Unknown escape sequence for "${character}"`);
    return "";
  }

  readValue() {
    const character = this.source[this.index];
    if (character === '"' || character === "'") return this.readString();
    if (character === "[") return this.readArray();
    if (character === "{") return this.readInlineTable();
    const match = /^[^,\]}\s#]+(?:[ ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?/.exec(this.source.slice(this.index));
    if (!match) this.fail("Expected a value");
    const raw = match[0];
    this.index += raw.length;
    return coerceToml(raw, (message) => this.fail(message));
  }

  readArray() {
    this.index++;
    const items = [];
    for (;;) {
      this.skipTrivia();
      if (this.index >= this.source.length) this.fail("Unterminated array");
      if (this.source[this.index] === "]") { this.index++; return items; }
      items.push(this.readValue());
      this.skipTrivia();
      if (this.source[this.index] === ",") { this.index++; continue; }
      this.skipTrivia();
      if (this.source[this.index] === "]") { this.index++; return items; }
      this.fail('Expected "," or "]" in an array');
    }
  }

  readInlineTable() {
    this.index++;
    const table = {};
    this.skipInlineSpace();
    if (this.source[this.index] === "}") { this.index++; return table; }
    for (;;) {
      this.skipInlineSpace();
      const path = this.readKeyPath();
      this.skipInlineSpace();
      if (this.source[this.index] !== "=") this.fail('Expected "=" inside an inline table');
      this.index++;
      this.skipInlineSpace();
      const value = this.readValue();
      let node = table;
      for (const segment of path.slice(0, -1)) node = (node[segment] ??= {});
      node[path.at(-1)] = value;
      this.skipInlineSpace();
      if (this.source[this.index] === ",") { this.index++; continue; }
      if (this.source[this.index] === "}") { this.index++; return table; }
      this.fail('Expected "," or "}" inside an inline table');
    }
  }
}

function coerceToml(raw, fail) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^[+-]?inf$/.test(raw)) return raw.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/.test(raw)) return NaN;
  if (/^0x[0-9a-fA-F][0-9a-fA-F_]*$/.test(raw)) return Number.parseInt(raw.slice(2).replaceAll("_", ""), 16);
  if (/^0o[0-7][0-7_]*$/.test(raw)) return Number.parseInt(raw.slice(2).replaceAll("_", ""), 8);
  if (/^0b[01][01_]*$/.test(raw)) return Number.parseInt(raw.slice(2).replaceAll("_", ""), 2);
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(raw)) return raw;
  if (/^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) return raw;
  const numeric = raw.replaceAll("_", "");
  if (/^[+-]?\d+$/.test(numeric)) {
    const value = Number(numeric);
    if (!Number.isSafeInteger(value)) fail(`Integer ${raw} is outside the safe range`);
    return value;
  }
  if (/^[+-]?(\d+\.\d+|\d+)([eE][+-]?\d+)?$/.test(numeric)) return Number(numeric);
  fail(`"${raw}" is not a valid TOML value`);
  return null;
}

/* ------------------------------------------------------------- writing --- */

export function stringifyToml(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("A TOML document needs an object at the root");
  const lines = [];
  writeTable(value, [], lines, true);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function writeTable(table, path, lines, isRoot) {
  const scalars = [];
  const subTables = [];
  const arrayTables = [];
  for (const [key, item] of Object.entries(table)) {
    if (item === undefined) continue;
    if (isTable(item)) subTables.push([key, item]);
    else if (Array.isArray(item) && item.length > 0 && item.every(isTable)) arrayTables.push([key, item]);
    else scalars.push([key, item]);
  }
  if (!isRoot) lines.push(`[${path.map(formatKey).join(".")}]`);
  for (const [key, item] of scalars) lines.push(`${formatKey(key)} = ${formatValue(item)}`);
  for (const [key, item] of subTables) { lines.push(""); writeTable(item, [...path, key], lines, false); }
  for (const [key, items] of arrayTables) {
    for (const entry of items) {
      lines.push("");
      const nested = [];
      writeTable(entry, [...path, key], nested, false);
      nested[0] = `[[${[...path, key].map(formatKey).join(".")}]]`;
      lines.push(...nested);
    }
  }
}

function isTable(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function formatKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function formatValue(value) {
  if (value === null) return '""';
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (value === Infinity) return "inf";
    if (value === -Infinity) return "-inf";
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  if (isTable(value)) return `{ ${Object.entries(value).map(([key, item]) => `${formatKey(key)} = ${formatValue(item)}`).join(", ")} }`;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(text)) return text;
  return JSON.stringify(text);
}
