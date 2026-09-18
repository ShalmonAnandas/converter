// JSON formatting, diffing, querying, and code generation.

export function indentOf(value) {
  if (value === "tab") return "\t";
  const width = Number(value);
  return Number.isInteger(width) && width >= 0 && width <= 10 ? width : 2;
}

export function jsonTransform(input, action = "format", indent = "2") {
  const parsed = JSON.parse(input);
  switch (action) {
    case "minify": return JSON.stringify(parsed);
    case "sort": return JSON.stringify(sortObject(parsed), null, indentOf(indent));
    case "validate": return `Valid JSON\nRoot type: ${describeType(parsed)}\n${summarize(parsed)}`;
    default: return JSON.stringify(parsed, null, indentOf(indent));
  }
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  return value;
}

export function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function summarize(value) {
  let objects = 0; let arrays = 0; let scalars = 0; let depth = 0;
  const walk = (node, level) => {
    depth = Math.max(depth, level);
    if (Array.isArray(node)) { arrays++; node.forEach((item) => walk(item, level + 1)); }
    else if (node && typeof node === "object") { objects++; Object.values(node).forEach((item) => walk(item, level + 1)); }
    else scalars++;
  };
  walk(value, 1);
  return `${objects} objects · ${arrays} arrays · ${scalars} scalar values · max depth ${depth}`;
}

export function jsonError(error, input) {
  const position = /position (\d+)/i.exec(error.message);
  const explicit = /line (\d+) column (\d+)/i.exec(error.message);
  if (explicit) return error.message;
  if (!position) return error.message;
  const offset = Number(position[1]);
  const before = input.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - before.lastIndexOf("\n");
  return `${error.message} · line ${line}, column ${column}`;
}

/* --------------------------------------------------------------- ndjson -- */

export function toNdjson(input) {
  const parsed = JSON.parse(input);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

export function fromNdjson(input, indent = "2") {
  const rows = input.split("\n").map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Line ${index + 1} is not valid JSON: ${error.message}`); }
  });
  return JSON.stringify(rows, null, indentOf(indent));
}

/* ----------------------------------------------------------------- diff -- */

export function jsonDiff(left, right) {
  const a = JSON.parse(left);
  const b = JSON.parse(right);
  const changes = [];
  compare(a, b, "$", changes);
  if (changes.length === 0) return "The two documents are structurally identical.";
  const counts = changes.reduce((totals, change) => ({ ...totals, [change.kind]: (totals[change.kind] || 0) + 1 }), {});
  const header = `${changes.length} difference${changes.length === 1 ? "" : "s"} · ${Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(" · ")}`;
  const body = changes.map((change) => {
    if (change.kind === "added") return `+ ${change.path} = ${format(change.right)}`;
    if (change.kind === "removed") return `- ${change.path} = ${format(change.left)}`;
    return `~ ${change.path}\n    - ${format(change.left)}\n    + ${format(change.right)}`;
  }).join("\n");
  return `${header}\n\n${body}`;
}

function format(value) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function compare(left, right, path, changes) {
  if (Object.is(left, right)) return;
  const leftType = describeType(left);
  const rightType = describeType(right);
  if (leftType !== rightType || leftType !== "object" && leftType !== "array") {
    if (JSON.stringify(left) !== JSON.stringify(right)) changes.push({ kind: "changed", path, left, right });
    return;
  }
  if (leftType === "array") {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index++) {
      if (index >= left.length) changes.push({ kind: "added", path: `${path}[${index}]`, right: right[index] });
      else if (index >= right.length) changes.push({ kind: "removed", path: `${path}[${index}]`, left: left[index] });
      else compare(left[index], right[index], `${path}[${index}]`, changes);
    }
    return;
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of [...keys].sort()) {
    const child = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
    if (!(key in left)) changes.push({ kind: "added", path: child, right: right[key] });
    else if (!(key in right)) changes.push({ kind: "removed", path: child, left: left[key] });
    else compare(left[key], right[key], child, changes);
  }
}

/* ------------------------------------------------------------ json path -- */

/** Supports $.a.b, $['a'], $[0], $[*], $..name, and $[start:end] slices. */
export function jsonQuery(input, path, indent = "2") {
  const document = JSON.parse(input);
  const results = evaluatePath(document, path);
  if (results.length === 0) return "No matches.";
  if (results.length === 1) return JSON.stringify(results[0], null, indentOf(indent));
  return JSON.stringify(results, null, indentOf(indent));
}

export function evaluatePath(document, path) {
  const expression = path.trim();
  if (!expression || expression === "$") return [document];
  const tokens = tokenizePath(expression);
  let current = [document];
  for (const token of tokens) {
    const next = [];
    for (const node of current) {
      if (token.type === "descend") { collectDescendants(node, token.name, next); continue; }
      if (token.type === "wildcard") {
        if (Array.isArray(node)) next.push(...node);
        else if (node && typeof node === "object") next.push(...Object.values(node));
        continue;
      }
      if (token.type === "slice") {
        if (!Array.isArray(node)) continue;
        next.push(...node.slice(token.start, token.end));
        continue;
      }
      if (node == null) continue;
      if (Array.isArray(node) && /^-?\d+$/.test(token.name)) {
        const index = Number(token.name) < 0 ? node.length + Number(token.name) : Number(token.name);
        if (index in node) next.push(node[index]);
        continue;
      }
      if (typeof node === "object" && token.name in node) next.push(node[token.name]);
    }
    current = next;
  }
  return current;
}

function tokenizePath(expression) {
  const tokens = [];
  let index = expression.startsWith("$") ? 1 : 0;
  while (index < expression.length) {
    const character = expression[index];
    if (character === ".") {
      if (expression[index + 1] === ".") {
        const match = /^\.\.([A-Za-z_$*][\w$]*)/.exec(expression.slice(index));
        if (!match) throw new Error("Recursive descent must be followed by a property name");
        tokens.push(match[1] === "*" ? { type: "descend", name: null } : { type: "descend", name: match[1] });
        index += match[0].length;
        continue;
      }
      const match = /^\.([A-Za-z_$][\w$]*|\*)/.exec(expression.slice(index));
      if (!match) throw new Error(`Unexpected character at position ${index} in the path`);
      tokens.push(match[1] === "*" ? { type: "wildcard" } : { type: "name", name: match[1] });
      index += match[0].length;
      continue;
    }
    if (character === "[") {
      const close = expression.indexOf("]", index);
      if (close === -1) throw new Error("Unclosed [ in the path");
      const inner = expression.slice(index + 1, close).trim();
      if (inner === "*") tokens.push({ type: "wildcard" });
      else if (/^-?\d*:-?\d*$/.test(inner)) {
        const [start, end] = inner.split(":");
        tokens.push({ type: "slice", start: start === "" ? undefined : Number(start), end: end === "" ? undefined : Number(end) });
      } else if (/^'.*'$/.test(inner) || /^".*"$/.test(inner)) tokens.push({ type: "name", name: inner.slice(1, -1) });
      else if (/^-?\d+$/.test(inner)) tokens.push({ type: "name", name: inner });
      else throw new Error(`Unsupported bracket expression "${inner}"`);
      index = close + 1;
      continue;
    }
    const match = /^([A-Za-z_$][\w$]*)/.exec(expression.slice(index));
    if (!match) throw new Error(`Unexpected character "${character}" at position ${index} in the path`);
    tokens.push({ type: "name", name: match[1] });
    index += match[0].length;
  }
  return tokens;
}

function collectDescendants(node, name, output) {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((item) => collectDescendants(item, name, output)); return; }
  for (const [key, value] of Object.entries(node)) {
    if (name === null || key === name) output.push(value);
    collectDescendants(value, name, output);
  }
}

/* ------------------------------------------------------ code generation -- */

const RESERVED = new Set(["type", "interface", "class", "enum", "default", "func", "function", "package", "import", "return", "struct", "var", "const", "range", "map", "chan", "go", "if", "else", "for", "switch", "case", "break"]);

export function toPascalCase(value) {
  const parts = String(value).replace(/[^\w]+/g, " ").replace(/([a-z\d])([A-Z])/g, "$1 $2").trim().split(/[\s_]+/).filter(Boolean);
  const name = parts.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
  return /^[A-Za-z_]/.test(name) ? name || "Value" : `Field${name}`;
}

function singularize(name) {
  if (/ies$/.test(name)) return `${name.slice(0, -3)}y`;
  if (/(s|List|Array)$/.test(name) && !/ss$/.test(name)) return name.replace(/(s|List|Array)$/, "");
  return `${name}Item`;
}

/**
 * Collapses a set of sample values into one shape description so that an array
 * of near-identical objects produces a single type with optional members
 * instead of one type per element.
 */
export function inferShape(values) {
  const shape = { kinds: new Set(), samples: values.length, properties: new Map(), objects: 0, items: null, arrays: 0, emptyArrays: 0, stringSample: undefined };
  const elements = [];
  for (const value of values) {
    if (value === null) { shape.kinds.add("null"); continue; }
    if (Array.isArray(value)) {
      shape.kinds.add("array");
      shape.arrays++;
      if (value.length === 0) shape.emptyArrays++;
      elements.push(...value);
      continue;
    }
    if (typeof value === "object") {
      shape.kinds.add("object");
      shape.objects++;
      for (const [key, item] of Object.entries(value)) {
        if (!shape.properties.has(key)) shape.properties.set(key, []);
        shape.properties.get(key).push(item);
      }
      continue;
    }
    if (typeof value === "number") shape.kinds.add(Number.isInteger(value) ? "integer" : "number");
    else if (typeof value === "boolean") shape.kinds.add("boolean");
    else { shape.kinds.add("string"); if (shape.stringSample === undefined) shape.stringSample = value; }
  }
  if (shape.kinds.has("array")) shape.items = elements.length ? inferShape(elements) : null;
  return shape;
}

function presence(shape, key) {
  return shape.properties.get(key).length === shape.objects;
}

export function jsonToTypeScript(input, rootName = "Root") {
  const parsed = JSON.parse(input);
  const root = toPascalCase(rootName);
  const interfaces = new Map();
  const rootType = typeScriptFor(inferShape([parsed]), root, interfaces);
  const blocks = [...interfaces.values()];
  if (!interfaces.has(root)) blocks.push(`export type ${root} = ${rootType};`);
  return blocks.join("\n\n");
}

function typeScriptFor(shape, name, interfaces) {
  const parts = [];
  for (const kind of shape.kinds) {
    if (kind === "object") parts.push(declareInterface(shape, name, interfaces));
    else if (kind === "array") {
      const item = shape.items ? typeScriptFor(shape.items, singularize(name), interfaces) : "unknown";
      parts.push(/[ |&]/.test(item) ? `(${item})[]` : `${item}[]`);
    } else if (kind === "integer" || kind === "number") parts.push("number");
    else parts.push(kind);
  }
  const unique = [...new Set(parts)];
  return unique.length ? unique.join(" | ") : "unknown";
}

function declareInterface(shape, name, interfaces) {
  const members = [...shape.properties.keys()].map((key) => {
    const child = inferShape(shape.properties.get(key));
    const type = typeScriptFor(child, toPascalCase(key), interfaces);
    const safeKey = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    return `  ${safeKey}${presence(shape, key) ? "" : "?"}: ${type};`;
  });
  const body = members.length ? `{\n${members.join("\n")}\n}` : "Record<string, never>";
  let unique = name;
  let suffix = 2;
  while (interfaces.has(unique) && interfaces.get(unique) !== `export interface ${unique} ${body}`) unique = `${name}${suffix++}`;
  interfaces.set(unique, `export interface ${unique} ${body.replace(/^\{/, "{")}`);
  return unique;
}

export function jsonToGo(input, rootName = "Root") {
  const parsed = JSON.parse(input);
  const structs = new Map();
  const rootType = goFor(inferShape([parsed]), toPascalCase(rootName), structs);
  const blocks = [...structs.values()];
  if (!structs.size) blocks.push(`type ${toPascalCase(rootName)} ${rootType}`);
  return `package main\n\n${blocks.join("\n\n")}`;
}

function goFor(shape, name, structs) {
  if (shape.kinds.size !== 1) return "interface{}";
  const [kind] = shape.kinds;
  if (kind === "object") return declareStruct(shape, name, structs);
  if (kind === "array") return `[]${shape.items ? goFor(shape.items, singularize(name), structs) : "interface{}"}`;
  if (kind === "integer") return "int64";
  if (kind === "number") return "float64";
  if (kind === "boolean") return "bool";
  if (kind === "null") return "interface{}";
  return "string";
}

function declareStruct(shape, name, structs) {
  const rows = [...shape.properties.keys()].map((key) => {
    const child = inferShape(shape.properties.get(key));
    let type = goFor(child, toPascalCase(key), structs);
    if (!presence(shape, key) && !type.startsWith("[]") && type !== "interface{}") type = `*${type}`;
    const tag = presence(shape, key) ? `\`json:"${key}"\`` : `\`json:"${key},omitempty"\``;
    return [goFieldName(key), type, tag];
  });
  const nameWidth = Math.max(0, ...rows.map((row) => row[0].length));
  const typeWidth = Math.max(0, ...rows.map((row) => row[1].length));
  const body = rows.length
    ? `{\n${rows.map(([field, type, tag]) => `\t${field.padEnd(nameWidth)} ${type.padEnd(typeWidth)} ${tag}`).join("\n")}\n}`
    : "struct{}";
  let unique = name;
  let suffix = 2;
  while (structs.has(unique) && structs.get(unique) !== `type ${unique} struct ${body}`) unique = `${name}${suffix++}`;
  structs.set(unique, `type ${unique} struct ${body}`);
  return unique;
}

function goFieldName(key) {
  const name = toPascalCase(key);
  return RESERVED.has(name.toLowerCase()) ? `${name}Field` : name;
}

export function jsonToSchema(input, title = "Root") {
  const parsed = JSON.parse(input);
  return JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", title, ...schemaFor(inferShape([parsed])) }, null, 2);
}

function schemaFor(shape) {
  const branches = [...shape.kinds].map((kind) => {
    if (kind === "object") {
      const properties = Object.fromEntries([...shape.properties.keys()].map((key) => [key, schemaFor(inferShape(shape.properties.get(key)))]));
      const required = [...shape.properties.keys()].filter((key) => presence(shape, key));
      return required.length ? { type: "object", properties, required } : { type: "object", properties };
    }
    if (kind === "array") return { type: "array", items: shape.items ? schemaFor(shape.items) : {} };
    if (kind === "string") return stringSchema(shape);
    return { type: kind };
  });
  if (branches.length === 1) return branches[0];
  if (branches.every((branch) => Object.keys(branch).length === 1 && branch.type)) return { type: branches.map((branch) => branch.type) };
  return { anyOf: branches };
}

const STRING_FORMATS = [
  [/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/, "date-time"],
  [/^\d{4}-\d{2}-\d{2}$/, "date"],
  [/^\d{2}:\d{2}(:\d{2})?$/, "time"],
  [/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "email"],
  [/^https?:\/\/\S+$/i, "uri"],
  [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "uuid"],
  [/^(\d{1,3}\.){3}\d{1,3}$/, "ipv4"],
];

function stringSchema(shape) {
  const value = shape.stringSample;
  const format = value === undefined ? undefined : STRING_FORMATS.find(([pattern]) => pattern.test(value))?.[1];
  return format ? { type: "string", format } : { type: "string" };
}

export function jsonToSql(input, tableName = "records", dialect = "postgresql") {
  const parsed = JSON.parse(input);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (!rows.length) throw new Error("Provide at least one object to generate SQL");
  if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("SQL generation needs an object or an array of objects");
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const quote = (name) => (dialect === "mysql" ? `\`${name.replaceAll("`", "``")}\`` : `"${name.replaceAll('"', '""')}"`);
  const types = columns.map((column) => sqlType(rows.map((row) => row[column]), dialect));
  const create = `CREATE TABLE ${quote(tableName)} (\n${columns.map((column, index) => `  ${quote(column)} ${types[index]}`).join(",\n")}\n);`;
  const inserts = rows.map((row) => `INSERT INTO ${quote(tableName)} (${columns.map(quote).join(", ")})\nVALUES (${columns.map((column) => sqlLiteral(row[column])).join(", ")});`);
  return `${create}\n\n${inserts.join("\n\n")}`;
}

function sqlType(values, dialect) {
  const defined = values.filter((value) => value !== undefined && value !== null);
  const nullable = defined.length < values.length ? "" : " NOT NULL";
  if (!defined.length) return "TEXT";
  if (defined.every((value) => typeof value === "boolean")) return `${dialect === "mysql" ? "TINYINT(1)" : "BOOLEAN"}${nullable}`;
  if (defined.every((value) => typeof value === "number" && Number.isInteger(value))) return `BIGINT${nullable}`;
  if (defined.every((value) => typeof value === "number")) return `DOUBLE PRECISION${nullable}`;
  return `TEXT${nullable}`;
}

function sqlLiteral(value) {
  if (value === undefined || value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replaceAll("'", "''")}'`;
}
