// A self-contained XML reader/writer. Using our own parser instead of DOMParser
// keeps the tools testable outside a browser and removes every external-entity
// path: only the five predefined entities and numeric character references are
// resolved, and an internal DTD subset is rejected outright.

const PREDEFINED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const NAME = "[A-Za-z_:][\\w.:-]*";

export function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function decodeEntities(value, lenient = false) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[A-Za-z][\w.-]*);/g, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
        if (lenient) return match;
        throw new Error(`"${match}" is not a valid character reference`);
      }
      return String.fromCodePoint(code);
    }
    if (entity in PREDEFINED) return PREDEFINED[entity];
    if (lenient) return match;
    throw new Error(`Unknown entity "${match}". Custom entity declarations are not resolved.`);
  });
}

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const OPTIONAL_END = new Set(["p", "li", "dt", "dd", "td", "th", "tr", "thead", "tbody", "tfoot", "option", "optgroup", "colgroup", "rt", "rp"]);
const RAW_TEXT = new Set(["script", "style"]);

/**
 * @param {string} source
 * @param {{html?: boolean}} [options] `html: true` accepts the forgiving rules
 *   real markup uses: bare and unquoted attributes, implied end tags, void
 *   elements without a slash, raw-text script/style bodies, and several roots.
 */
export function parseXml(source, options = {}) {
  const { html = false } = options;
  const text = String(source).replace(/\r\n?/g, "\n");
  const nodes = [];
  const stack = [{ children: nodes }];
  let index = 0;
  let declaration = null;

  const fail = (message, at = index) => {
    const before = text.slice(0, at);
    throw new Error(`${message} (line ${before.split("\n").length}, column ${at - before.lastIndexOf("\n")})`);
  };

  while (index < text.length) {
    const next = text.indexOf("<", index);
    if (next === -1) { pushText(text.slice(index)); break; }
    if (next > index) pushText(text.slice(index, next));
    index = next;

    if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index);
      if (end === -1) fail("Unterminated comment");
      stack.at(-1).children.push({ type: "comment", value: text.slice(index + 4, end) });
      index = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", index)) {
      const end = text.indexOf("]]>", index);
      if (end === -1) fail("Unterminated CDATA section");
      stack.at(-1).children.push({ type: "cdata", value: text.slice(index + 9, end) });
      index = end + 3;
      continue;
    }
    if (text.startsWith("<?", index)) {
      const end = text.indexOf("?>", index);
      if (end === -1) fail("Unterminated processing instruction");
      const body = text.slice(index + 2, end);
      if (/^xml\s/i.test(body) || body.toLowerCase() === "xml") declaration = body.trim();
      else stack.at(-1).children.push({ type: "instruction", value: body });
      index = end + 2;
      continue;
    }
    if (/^<!DOCTYPE/i.test(text.slice(index))) {
      const subset = text.indexOf("[", index);
      const end = text.indexOf(">", index);
      if (end === -1) fail("Unterminated DOCTYPE declaration");
      if (!html) {
        if (subset !== -1 && subset < end) fail("Inline DTD subsets are rejected because they can declare external entities");
        if (/SYSTEM|PUBLIC/i.test(text.slice(index, end))) fail("External DTD references are rejected to prevent entity resolution");
      }
      index = end + 1;
      continue;
    }
    if (text.startsWith("</", index)) {
      const end = text.indexOf(">", index);
      if (end === -1) fail("Unterminated closing tag");
      const name = text.slice(index + 2, end).trim();
      index = end + 1;
      if (html) {
        const match = stack.findLastIndex((node) => node.name?.toLowerCase() === name.toLowerCase());
        if (match > 0) stack.length = match;
        continue;
      }
      const open = stack.at(-1);
      if (stack.length === 1) fail(`Closing tag </${name}> has no matching opening tag`, index);
      if (open.name !== name) fail(`Closing tag </${name}> does not match <${open.name}>`, index);
      stack.pop();
      continue;
    }

    const tag = readTag(text, index, fail, html);
    const element = { type: "element", name: tag.name, attributes: tag.attributes, children: [] };
    const lower = tag.name.toLowerCase();
    if (html) {
      // <p><p> and <li><li> imply an end tag for the open sibling.
      const open = stack.at(-1).name?.toLowerCase();
      if (open && OPTIONAL_END.has(open) && impliesClose(open, lower)) stack.pop();
    }
    stack.at(-1).children.push(element);
    index = tag.end;
    if (html && RAW_TEXT.has(lower) && !tag.selfClosing) {
      const close = text.toLowerCase().indexOf(`</${lower}`, index);
      const stop = close === -1 ? text.length : close;
      if (stop > index) element.children.push({ type: "text", value: text.slice(index, stop) });
      index = close === -1 ? text.length : text.indexOf(">", close) + 1;
      continue;
    }
    if (tag.selfClosing) continue;
    if (html && VOID_ELEMENTS.has(lower)) continue;
    stack.push(element);
  }

  if (stack.length > 1 && !html) fail(`<${stack.at(-1).name}> is never closed`, text.length);
  const roots = nodes.filter((node) => node.type === "element");
  if (roots.length === 0) throw new Error("The document does not contain an element");
  if (roots.length > 1 && !html) throw new Error("An XML document may only have one root element");
  return { declaration, children: nodes, root: roots[0] };

  function pushText(value) {
    if (!value) return;
    stack.at(-1).children.push({ type: "text", value: decodeEntities(value, html) });
  }
}

const HTML_NAME = "[A-Za-z_:@#.$][^\\s=/>\"']*";

function readTag(text, start, fail, html = false) {
  const namePattern = html ? "[A-Za-z][\\w.:-]*" : NAME;
  const nameMatch = new RegExp(`^<(${namePattern})`).exec(text.slice(start));
  if (!nameMatch) fail("Expected an element name", start);
  let index = start + nameMatch[0].length;
  const attributes = [];
  const seen = new Set();
  const attributePattern = html
    ? new RegExp(`^(${HTML_NAME})(?:\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+)))?`)
    : new RegExp(`^(${NAME})\\s*=\\s*("([^"]*)"|'([^']*)')`);
  for (;;) {
    while (index < text.length && /\s/.test(text[index])) index++;
    if (index >= text.length) { fail(`<${nameMatch[1]}> is never closed`, index); return null; }
    if (text[index] === ">") return { name: nameMatch[1], attributes, selfClosing: false, end: index + 1 };
    if (text.startsWith("/>", index)) return { name: nameMatch[1], attributes, selfClosing: true, end: index + 2 };
    const attribute = attributePattern.exec(text.slice(index));
    if (!attribute) fail(`Malformed attribute in <${nameMatch[1]}>`, index);
    if (seen.has(attribute[1]) && !html) fail(`Attribute "${attribute[1]}" is repeated on <${nameMatch[1]}>`, index);
    seen.add(attribute[1]);
    const raw = attribute[3] ?? attribute[4] ?? attribute[5];
    attributes.push({ name: attribute[1], value: raw === undefined ? "" : decodeEntities(raw, html) });
    index += attribute[0].length;
  }
}

function impliesClose(open, incoming) {
  if (open === "p") return !["a", "b", "em", "strong", "span", "code", "i", "small", "img", "br", "sub", "sup", "abbr", "mark", "del", "ins", "u", "s", "q", "kbd", "samp", "var", "time", "wbr", "bdi", "bdo", "cite", "data", "dfn", "ruby", "rt", "rp"].includes(incoming);
  if (open === "li") return incoming === "li";
  if (open === "tr") return incoming === "tr";
  if (open === "td" || open === "th") return ["td", "th", "tr"].includes(incoming);
  if (open === "dt" || open === "dd") return ["dt", "dd"].includes(incoming);
  if (open === "option") return ["option", "optgroup"].includes(incoming);
  return false;
}

/* ----------------------------------------------------------- formatting -- */

export function formatXml(input, indent = "  ") {
  const document = parseXml(input);
  const lines = [];
  const header = document.declaration ? `<?${document.declaration}?>` : '<?xml version="1.0" encoding="UTF-8"?>';
  lines.push(header);
  for (const node of document.children) write(node, 0);
  return lines.join("\n");

  function write(node, depth) {
    const pad = indent.repeat(depth);
    if (node.type === "text") {
      const value = node.value.trim();
      if (value) lines.push(pad + escapeXml(value));
      return;
    }
    if (node.type === "comment") { lines.push(`${pad}<!--${node.value}-->`); return; }
    if (node.type === "cdata") { lines.push(`${pad}<![CDATA[${node.value}]]>`); return; }
    if (node.type === "instruction") { lines.push(`${pad}<?${node.value}?>`); return; }
    const attributes = node.attributes.map((attribute) => ` ${attribute.name}="${escapeXml(attribute.value)}"`).join("");
    const meaningful = node.children.filter((child) => child.type !== "text" || child.value.trim());
    if (meaningful.length === 0) { lines.push(`${pad}<${node.name}${attributes}/>`); return; }
    if (meaningful.length === 1 && meaningful[0].type === "text") {
      lines.push(`${pad}<${node.name}${attributes}>${escapeXml(meaningful[0].value.trim())}</${node.name}>`);
      return;
    }
    lines.push(`${pad}<${node.name}${attributes}>`);
    for (const child of meaningful) write(child, depth + 1);
    lines.push(`${pad}</${node.name}>`);
  }
}

export function minifyXml(input) {
  const document = parseXml(input);
  const header = document.declaration ? `<?${document.declaration}?>` : "";
  return header + document.children.map(write).join("");

  function write(node) {
    if (node.type === "text") return escapeXml(node.value.trim());
    if (node.type === "comment") return "";
    if (node.type === "cdata") return `<![CDATA[${node.value}]]>`;
    if (node.type === "instruction") return `<?${node.value}?>`;
    const attributes = node.attributes.map((attribute) => ` ${attribute.name}="${escapeXml(attribute.value)}"`).join("");
    const inner = node.children.map(write).join("");
    return inner ? `<${node.name}${attributes}>${inner}</${node.name}>` : `<${node.name}${attributes}/>`;
  }
}

export function validateXml(input) {
  const document = parseXml(input);
  let elements = 0;
  let attributes = 0;
  let depth = 0;
  const walk = (node, level) => {
    if (node.type !== "element") return;
    elements++;
    attributes += node.attributes.length;
    depth = Math.max(depth, level);
    node.children.forEach((child) => walk(child, level + 1));
  };
  walk(document.root, 1);
  return `Well-formed XML\nRoot element: <${document.root.name}>\n${elements} elements · ${attributes} attributes · max depth ${depth}`;
}

/* ------------------------------------------------------ JSON conversion -- */

export function xmlToValue(input, { attributePrefix = "@", textKey = "#text" } = {}) {
  const document = parseXml(input);
  return { [document.root.name]: convertElement(document.root, attributePrefix, textKey) };
}

function convertElement(element, attributePrefix, textKey) {
  const result = {};
  for (const attribute of element.attributes) result[`${attributePrefix}${attribute.name}`] = attribute.value;
  const text = element.children.filter((child) => child.type === "text" || child.type === "cdata").map((child) => child.value).join("").trim();
  const children = element.children.filter((child) => child.type === "element");
  if (children.length === 0) {
    if (Object.keys(result).length === 0) return text === "" ? null : coerce(text);
    if (text !== "") result[textKey] = coerce(text);
    return result;
  }
  for (const child of children) {
    const value = convertElement(child, attributePrefix, textKey);
    if (child.name in result) {
      if (!Array.isArray(result[child.name])) result[child.name] = [result[child.name]];
      result[child.name].push(value);
    } else result[child.name] = value;
  }
  if (text !== "") result[textKey] = coerce(text);
  return result;
}

function coerce(text) {
  if (/^[+-]?\d+$/.test(text) && Number.isSafeInteger(Number(text))) return Number(text);
  if (/^[+-]?(\d+\.\d+|\d+)([eE][+-]?\d+)?$/.test(text)) return Number(text);
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

export function xmlToJson(input, indent = 2, options = {}) {
  return JSON.stringify(xmlToValue(input, options), null, indent === "tab" ? "\t" : Number(indent) || 2);
}

export function valueToXml(value, { rootName = "root", indent = "  ", attributePrefix = "@", textKey = "#text" } = {}) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const entries = isPlainObject(value) ? Object.entries(value) : null;
  if (entries && entries.length === 1 && isElementName(entries[0][0]) && !entries[0][0].startsWith(attributePrefix)) {
    write(entries[0][0], entries[0][1], 0);
  } else {
    write(rootName, value, 0);
  }
  return lines.join("\n");

  function write(name, node, depth) {
    const pad = indent.repeat(depth);
    const tag = sanitizeName(name);
    if (Array.isArray(node)) { node.forEach((item) => write(name, item, depth)); return; }
    if (node === null || node === undefined) { lines.push(`${pad}<${tag}/>`); return; }
    if (!isPlainObject(node)) { lines.push(`${pad}<${tag}>${escapeXml(node)}</${tag}>`); return; }
    const attributes = Object.entries(node).filter(([key]) => key.startsWith(attributePrefix) && key !== textKey);
    const children = Object.entries(node).filter(([key]) => !key.startsWith(attributePrefix) && key !== textKey);
    const text = node[textKey];
    const attributeText = attributes.map(([key, item]) => ` ${sanitizeName(key.slice(attributePrefix.length))}="${escapeXml(item ?? "")}"`).join("");
    if (children.length === 0 && (text === undefined || text === null)) { lines.push(`${pad}<${tag}${attributeText}/>`); return; }
    if (children.length === 0) { lines.push(`${pad}<${tag}${attributeText}>${escapeXml(text)}</${tag}>`); return; }
    lines.push(`${pad}<${tag}${attributeText}>`);
    if (text !== undefined && text !== null) lines.push(`${indent.repeat(depth + 1)}${escapeXml(text)}`);
    for (const [key, item] of children) write(key, item, depth + 1);
    lines.push(`${pad}</${tag}>`);
  }
}

export function jsonToXml(input, options = {}) {
  return valueToXml(JSON.parse(input), options);
}

function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isElementName(name) { return new RegExp(`^${NAME}$`).test(name); }

function sanitizeName(name) {
  const cleaned = String(name).replace(/[^\w.:-]/g, "_");
  return /^[A-Za-z_:]/.test(cleaned) ? cleaned : `_${cleaned}`;
}
