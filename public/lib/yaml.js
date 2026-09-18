// A dependency-free YAML reader and writer covering the subset that shows up in
// configuration files: block maps and sequences, flow collections, quoted and
// plain scalars, literal and folded block scalars, comments, and documents.

const TRUE = new Set(["true", "yes", "on"]);
const FALSE = new Set(["false", "no", "off"]);
const NULLS = new Set(["", "~", "null"]);

export function parseYaml(source) {
  const documents = splitDocuments(String(source).replace(/\r\n?/g, "\n"));
  const values = documents.map((document) => new YamlReader(document).read());
  return values.length <= 1 ? values[0] ?? null : values;
}

function splitDocuments(source) {
  const documents = [];
  let current = [];
  for (const line of source.split("\n")) {
    if (/^---\s*$/.test(line)) { documents.push(current); current = []; continue; }
    if (/^\.\.\.\s*$/.test(line)) { documents.push(current); current = []; continue; }
    current.push(line);
  }
  documents.push(current);
  const kept = documents.filter((lines) => lines.some((line) => line.trim() && !line.trim().startsWith("#")));
  return kept.length ? kept.map((lines) => lines.join("\n")) : [""];
}

class YamlReader {
  constructor(source) {
    this.lines = source.split("\n").map((raw, number) => ({
      raw,
      number: number + 1,
      indent: raw.search(/\S/) === -1 ? -1 : raw.search(/\S/),
      text: raw.trim(),
    }));
    this.index = 0;
  }

  read() {
    this.skipIgnorable();
    if (this.index >= this.lines.length) return null;
    return this.parseNode(this.lines[this.index].indent);
  }

  skipIgnorable() {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (line.indent === -1 || line.text.startsWith("#")) this.index++;
      else break;
    }
  }

  peek() {
    this.skipIgnorable();
    return this.index < this.lines.length ? this.lines[this.index] : null;
  }

  parseNode(indent) {
    const line = this.peek();
    if (!line || line.indent < indent) return null;
    if (/^-(\s|$)/.test(line.text)) return this.parseSequence(line.indent);
    return this.parseMapping(line.indent);
  }

  parseSequence(indent) {
    const items = [];
    for (;;) {
      const line = this.peek();
      if (!line || line.indent !== indent || !/^-(\s|$)/.test(line.text)) break;
      const rest = line.text.slice(1).replace(/^\s/, "");
      const restIndent = rest ? line.raw.length - line.raw.trimStart().length + (line.text.length - rest.length) : indent + 2;
      this.index++;
      if (!rest) { items.push(this.parseNode(indent + 1)); continue; }
      if (isBlockScalarHeader(rest)) { items.push(this.readBlockScalar(rest, indent)); continue; }
      if (hasKey(rest) || /^-(\s|$)/.test(rest)) {
        this.index--;
        this.lines[this.index] = { ...line, indent: restIndent, text: rest, raw: " ".repeat(restIndent) + rest };
        items.push(this.parseNode(restIndent));
        continue;
      }
      items.push(parseScalar(stripComment(rest)));
    }
    return items;
  }

  parseMapping(indent) {
    const result = {};
    for (;;) {
      const line = this.peek();
      if (!line || line.indent !== indent) break;
      const entry = splitKey(line.text);
      if (!entry) {
        if (/^-(\s|$)/.test(line.text)) break;
        throw new Error(`Line ${line.number}: expected "key: value" but found "${line.text}"`);
      }
      this.index++;
      const rest = entry.rest;
      if (!rest) {
        const next = this.peek();
        result[entry.key] = next && next.indent > indent ? this.parseNode(next.indent) : null;
        continue;
      }
      if (isBlockScalarHeader(rest)) { result[entry.key] = this.readBlockScalar(rest, indent); continue; }
      result[entry.key] = parseScalar(stripComment(rest));
    }
    return result;
  }

  readBlockScalar(header, indent) {
    const style = header[0];
    const chomp = /[+-]/.exec(header)?.[0] ?? "";
    const explicit = /(\d+)/.exec(header.slice(1))?.[1];
    const collected = [];
    let blockIndent = explicit ? indent + Number(explicit) : null;
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (line.indent !== -1 && line.indent <= indent) break;
      if (line.indent === -1) { collected.push(""); this.index++; continue; }
      if (blockIndent === null) blockIndent = line.indent;
      collected.push(line.raw.slice(blockIndent));
      this.index++;
    }
    let trailingBlanks = 0;
    while (collected.length && collected.at(-1) === "") { collected.pop(); trailingBlanks++; }
    let text;
    if (style === ">") {
      text = collected.reduce((accumulator, current, position) => {
        if (position === 0) return current;
        const previous = collected[position - 1];
        if (current === "" || previous === "" || /^\s/.test(current)) return `${accumulator}\n${current}`;
        return `${accumulator} ${current}`;
      }, "");
    } else {
      text = collected.join("\n");
    }
    if (chomp === "-") return text;
    if (chomp === "+") return text + "\n".repeat(trailingBlanks + 1);
    return text.length ? `${text}\n` : "";
  }
}

function isBlockScalarHeader(text) {
  return /^[|>][+-]?\d*\s*(#.*)?$/.test(text);
}

function hasKey(text) {
  return splitKey(text) !== null;
}

function splitKey(text) {
  if (/^[|>]/.test(text)) return null;
  const quoted = /^(['"])((?:\\.|(?!\1).)*)\1\s*:(\s|$)/.exec(text);
  if (quoted) return { key: unquote(quoted[1] + quoted[2] + quoted[1]), rest: text.slice(quoted[0].length - (quoted[3] === "" ? 0 : 1)).trim() };
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "[" || character === "{") depth++;
    else if (character === "]" || character === "}") depth--;
    else if (character === "#" && index > 0 && /\s/.test(text[index - 1])) break;
    else if (character === ":" && depth === 0 && (index + 1 === text.length || /\s/.test(text[index + 1]))) {
      const key = text.slice(0, index).trim();
      if (!key) return null;
      return { key: unquote(key), rest: text.slice(index + 1).trim() };
    }
  }
  return null;
}

function stripComment(text) {
  let quote = null;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote) { if (character === "\\" && quote === '"') index++; else if (character === quote) quote = null; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === "#" && (index === 0 || /\s/.test(text[index - 1]))) return text.slice(0, index).trim();
  }
  return text.trim();
}

function unquote(value) {
  if (/^"(?:\\.|[^"])*"$/.test(value)) {
    return value.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, escape) => {
      if (escape[0] === "u") return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
      if (escape[0] === "x") return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
      return { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", 0: "\0", "\\": "\\", '"': '"', "/": "/" }[escape] ?? escape;
    });
  }
  if (/^'(?:''|[^'])*'$/.test(value)) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

function parseScalar(text) {
  const value = text.trim();
  if (value.startsWith("[")) return parseFlow(value).value;
  if (value.startsWith("{")) return parseFlow(value).value;
  if (/^["']/.test(value)) return unquote(value);
  if (NULLS.has(value.toLowerCase())) return null;
  if (TRUE.has(value.toLowerCase())) return true;
  if (FALSE.has(value.toLowerCase())) return false;
  if (/^[+-]?\d+$/.test(value)) { const number = Number(value); return Number.isSafeInteger(number) ? number : value; }
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(value)) return Number(value);
  if (/^0x[0-9a-fA-F]+$/.test(value)) return Number.parseInt(value, 16);
  if (/^0o[0-7]+$/.test(value)) return Number.parseInt(value.slice(2), 8);
  if (/^[+-]?\.(inf|Inf|INF)$/.test(value)) return value.startsWith("-") ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(value)) return NaN;
  return value;
}

function parseFlow(text) {
  let index = 0;
  const readValue = () => {
    skipSpace();
    const character = text[index];
    if (character === "[") {
      index++;
      const items = [];
      skipSpace();
      if (text[index] === "]") { index++; return items; }
      for (;;) {
        items.push(readValue());
        skipSpace();
        if (text[index] === ",") { index++; continue; }
        if (text[index] === "]") { index++; break; }
        throw new Error("Unterminated flow sequence");
      }
      return items;
    }
    if (character === "{") {
      index++;
      const map = {};
      skipSpace();
      if (text[index] === "}") { index++; return map; }
      for (;;) {
        skipSpace();
        const key = readToken([":"]);
        skipSpace();
        if (text[index] !== ":") throw new Error("Flow mapping entries need a colon");
        index++;
        map[unquote(key.trim())] = readValue();
        skipSpace();
        if (text[index] === ",") { index++; continue; }
        if (text[index] === "}") { index++; break; }
        throw new Error("Unterminated flow mapping");
      }
      return map;
    }
    return parseScalar(readToken([",", "]", "}"]));
  };
  const skipSpace = () => { while (index < text.length && /\s/.test(text[index])) index++; };
  const readToken = (stops) => {
    const start = index;
    let quote = null;
    while (index < text.length) {
      const character = text[index];
      if (quote) { if (character === "\\" && quote === '"') index++; else if (character === quote) quote = null; index++; continue; }
      if (character === '"' || character === "'") { quote = character; index++; continue; }
      if (stops.includes(character)) break;
      index++;
    }
    return text.slice(start, index).trim();
  };
  const value = readValue();
  return { value, length: index };
}

/* ------------------------------------------------------------- writing --- */

export function stringifyYaml(value, { indent = 2 } = {}) {
  const text = writeNode(value, 0, indent);
  return text.endsWith("\n") ? text : `${text}\n`;
}

function writeNode(value, level, indent) {
  const pad = " ".repeat(level * indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value.map((item) => {
      if (isCollection(item) && !isEmpty(item)) {
        const block = writeNode(item, level + 1, indent);
        return `${pad}- ${block.slice((level + 1) * indent)}`;
      }
      return `${pad}- ${writeScalar(item, level + 1, indent).trimStart()}`;
    }).join("\n");
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return `${pad}{}`;
    return keys.map((key) => {
      const item = value[key];
      const safeKey = needsKeyQuotes(key) ? JSON.stringify(key) : key;
      if (isCollection(item) && !isEmpty(item)) return `${pad}${safeKey}:\n${writeNode(item, level + 1, indent)}`;
      return `${pad}${safeKey}: ${writeScalar(item, level + 1, indent).trimStart()}`;
    }).join("\n");
  }
  return `${pad}${writeScalar(value, level, indent).trimStart()}`;
}

function writeScalar(value, level, indent) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : value > 0 ? ".inf" : Number.isNaN(value) ? ".nan" : "-.inf";
  if (Array.isArray(value)) return value.length ? writeNode(value, level, indent) : "[]";
  if (isPlainObject(value)) return Object.keys(value).length ? writeNode(value, level, indent) : "{}";
  const text = String(value);
  if (text.includes("\n")) {
    const pad = " ".repeat(level * indent);
    const trailing = /\n*$/.exec(text)[0].length;
    const chomp = trailing === 0 ? "-" : trailing === 1 ? "" : "+";
    const body = text.replace(/\n+$/, "").split("\n").map((line) => (line ? pad + line : "")).join("\n");
    const extra = trailing > 1 ? "\n".repeat(trailing - 1) : "";
    return `|${chomp}\n${body}${extra}`;
  }
  return needsScalarQuotes(text) ? JSON.stringify(text) : text;
}

function needsScalarQuotes(text) {
  if (text === "") return true;
  if (NULLS.has(text.toLowerCase()) || TRUE.has(text.toLowerCase()) || FALSE.has(text.toLowerCase())) return true;
  if (/^[+-]?(\d|\.\d)/.test(text) && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return true;
  if (/^[\s>|*&!%@`"'[\]{},#?-]/.test(text)) return true;
  if (/:\s|\s#/.test(text) || /[:#]$/.test(text)) return true;
  if (/[\t\r]/.test(text)) return true;
  return false;
}

function needsKeyQuotes(key) {
  return key === "" || /[:#{}[\],&*!|>'"%@`\s]/.test(key);
}

function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isCollection(value) { return Array.isArray(value) || isPlainObject(value); }
function isEmpty(value) { return Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0; }
