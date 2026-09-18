// Markdown, HTML, CSS, and SQL formatting plus the escaping helpers that sit
// alongside them.

import { parseXml, escapeXml } from "./xml.js";

/* ------------------------------------------------------------- entities -- */

const NAMED_ENTITIES = {
  "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "apos", " ": "nbsp", "¡": "iexcl", "¢": "cent", "£": "pound", "¤": "curren", "¥": "yen", "¦": "brvbar", "§": "sect", "¨": "uml", "©": "copy", "ª": "ordf", "«": "laquo", "¬": "not", "®": "reg", "¯": "macr", "°": "deg", "±": "plusmn", "²": "sup2", "³": "sup3", "´": "acute", "µ": "micro", "¶": "para", "·": "middot", "¸": "cedil", "¹": "sup1", "º": "ordm", "»": "raquo", "¼": "frac14", "½": "frac12", "¾": "frac34", "¿": "iquest", "×": "times", "÷": "divide", "€": "euro", "—": "mdash", "–": "ndash", "…": "hellip", "‘": "lsquo", "’": "rsquo", "“": "ldquo", "”": "rdquo", "•": "bull", "†": "dagger", "‡": "Dagger", "‰": "permil", "′": "prime", "″": "Prime", "‹": "lsaquo", "›": "rsaquo", "™": "trade", "←": "larr", "↑": "uarr", "→": "rarr", "↓": "darr", "↔": "harr", "⇐": "lArr", "⇒": "rArr", "∀": "forall", "∂": "part", "∃": "exist", "∅": "empty", "∇": "nabla", "∈": "isin", "∉": "notin", "∏": "prod", "∑": "sum", "−": "minus", "√": "radic", "∝": "prop", "∞": "infin", "∠": "ang", "∧": "and", "∨": "or", "∩": "cap", "∪": "cup", "∫": "int", "≈": "asymp", "≠": "ne", "≡": "equiv", "≤": "le", "≥": "ge", "⊂": "sub", "⊃": "sup", "⊆": "sube", "⊇": "supe", "⊕": "oplus", "⊗": "otimes", "⊥": "perp", "⋅": "sdot", "♠": "spades", "♣": "clubs", "♥": "hearts", "♦": "diams", "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "θ": "theta", "λ": "lambda", "μ": "mu", "π": "pi", "σ": "sigma", "τ": "tau", "φ": "phi", "ω": "omega", "Δ": "Delta", "Θ": "Theta", "Λ": "Lambda", "Π": "Pi", "Σ": "Sigma", "Φ": "Phi", "Ω": "Omega",
};
const ENTITY_LOOKUP = Object.fromEntries(Object.entries(NAMED_ENTITIES).map(([character, name]) => [name, character]));

export function escapeHtml(value, { mode = "minimal" } = {}) {
  if (mode === "all named") {
    return [...String(value)].map((character) => (NAMED_ENTITIES[character] ? `&${NAMED_ENTITIES[character]};` : character)).join("");
  }
  if (mode === "non-ascii") {
    return [...String(value)].map((character) => {
      if (NAMED_ENTITIES[character] && "&<>\"'".includes(character)) return `&${NAMED_ENTITIES[character]};`;
      const code = character.codePointAt(0);
      return code > 127 ? `&#${code};` : character;
    }).join("");
  }
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function unescapeHtml(value) {
  return String(value).replace(/&(#x?[0-9a-fA-F]+|[A-Za-z][\w.-]*);/g, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITY_LOOKUP[entity] ?? match;
  });
}

export function escapeForLanguage(value, language) {
  const text = String(value);
  const escapers = {
    "javascript string": () => JSON.stringify(text),
    "json string": () => JSON.stringify(text),
    "html attribute": () => escapeHtml(text),
    "sql literal": () => `'${text.replaceAll("'", "''")}'`,
    "shell single quote": () => `'${text.replaceAll("'", "'\\''")}'`,
    "regular expression": () => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"),
    "csv field": () => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text),
    "url component": () => encodeURIComponent(text),
    "c string": () => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`,
    "xml text": () => escapeXml(text),
  };
  const escaper = escapers[language];
  if (!escaper) throw new Error(`Unknown target "${language}"`);
  return escaper();
}

export function unescapeFromLanguage(value, language) {
  const text = String(value).trim();
  const unescapers = {
    "javascript string": () => JSON.parse(/^["']/.test(text) ? text.replace(/^'|'$/g, '"') : `"${text}"`),
    "json string": () => JSON.parse(/^"/.test(text) ? text : `"${text}"`),
    "html attribute": () => unescapeHtml(text),
    "sql literal": () => text.replace(/^'|'$/g, "").replaceAll("''", "'"),
    "url component": () => decodeURIComponent(text),
    "xml text": () => unescapeHtml(text),
  };
  const unescaper = unescapers[language];
  if (!unescaper) throw new Error(`"${language}" cannot be reversed`);
  return unescaper();
}

/* ------------------------------------------------------------- markdown -- */

export function markdownToHtml(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  const listStack = [];
  let codeLines = null;
  let codeLanguage = "";
  let inTable = false;

  const inline = (value) => escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, alt, source, title) => `<img src="${source}" alt="${alt}"${title ? ` title="${title}"` : ""}>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, label, href, title) => `<a href="${safeHref(href)}"${title ? ` title="${title}"` : ""}>${label}</a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "<em>$1</em>")
    .replace(/(?<![\w_])__([^_]+)__(?![\w_])/g, "<strong>$1</strong>")
    .replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');

  const closeLists = (toDepth = 0) => {
    while (listStack.length > toDepth) {
      const closing = listStack.pop();
      output.push(`</${closing.tag}>`);
      if (closing.nested) output.push("</li>");
    }
  };
  const closeTable = () => { if (inTable) { output.push("</tbody>", "</table>"); inTable = false; } };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^(\s*)(```|~~~)\s*(\S*)/.exec(line);
    if (fence) {
      if (codeLines) { output.push(renderCode(codeLines, codeLanguage)); codeLines = null; }
      else { closeLists(); closeTable(); codeLanguage = fence[3]; codeLines = []; }
      continue;
    }
    if (codeLines) { codeLines.push(line); continue; }

    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (heading) { closeLists(); closeTable(); output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }

    const setext = /^(=+|-+)\s*$/.exec(line);
    if (setext && output.length && lines[index - 1]?.trim() && !listStack.length && output.at(-1)?.startsWith("<p>")) {
      const level = setext[1][0] === "=" ? 1 : 2;
      output[output.length - 1] = output.at(-1).replace(/^<p>(.*)<\/p>$/, `<h${level}>$1</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { closeLists(); closeTable(); output.push("<hr>"); continue; }

    const tableRow = /^\s*\|(.+)\|\s*$/.exec(line);
    const divider = lines[index + 1] && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[index + 1]);
    if (tableRow && !inTable && divider) {
      closeLists();
      const headers = splitTableRow(tableRow[1]);
      const alignments = splitTableRow(lines[index + 1].replace(/^\s*\|/, "").replace(/\|\s*$/, "")).map(alignmentOf);
      output.push("<table>", "<thead>", `<tr>${headers.map((cell, column) => `<th${alignments[column] ? ` style="text-align:${alignments[column]}"` : ""}>${inline(cell)}</th>`).join("")}</tr>`, "</thead>", "<tbody>");
      inTable = true;
      index++;
      continue;
    }
    if (tableRow && inTable) {
      output.push(`<tr>${splitTableRow(tableRow[1]).map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`);
      continue;
    }
    closeTable();

    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const depth = Math.floor(item[1].replace(/\t/g, "    ").length / 2) + 1;
      const tag = /\d/.test(item[2]) ? "ol" : "ul";
      closeLists(depth);
      if (listStack.length === depth && listStack.at(-1).tag !== tag) closeLists(depth - 1);
      while (listStack.length < depth) {
        const nested = listStack.length > 0 && output.at(-1)?.endsWith("</li>");
        if (nested) output[output.length - 1] = output.at(-1).slice(0, -"</li>".length);
        output.push(`<${tag}>`);
        listStack.push({ tag, nested });
      }
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item[3]);
      if (task) output.push(`<li><input type="checkbox" disabled${task[1] === " " ? "" : " checked"}> ${inline(task[2])}</li>`);
      else output.push(`<li>${inline(item[3])}</li>`);
      continue;
    }
    closeLists();

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      const continuation = output.at(-1) === "</blockquote>" && quote[1].trim();
      if (continuation) output[output.length - 2] = output.at(-2).replace(/<\/p>$/, ` ${inline(quote[1])}</p>`);
      else if (output.at(-1) === "</blockquote>") output.splice(-1, 1, `<p>${inline(quote[1])}</p>`, "</blockquote>");
      else output.push("<blockquote>", `<p>${inline(quote[1])}</p>`, "</blockquote>");
      continue;
    }

    if (line.trim()) output.push(`<p>${inline(line.trim())}</p>`);
  }
  closeLists();
  closeTable();
  if (codeLines) output.push(renderCode(codeLines, codeLanguage));
  return output.join("\n");
}

function renderCode(lines, language) {
  const body = lines.map((line) => escapeHtml(line)).join("\n");
  return `<pre><code${language ? ` class="language-${language}"` : ""}>${body}</code></pre>`;
}

function splitTableRow(row) {
  return row.split("|").map((cell) => cell.trim());
}

function alignmentOf(marker) {
  if (/^:.*:$/.test(marker)) return "center";
  if (/^:/.test(marker)) return "left";
  if (/:$/.test(marker)) return "right";
  return "";
}

function safeHref(href) {
  return /^\s*(javascript|data|vbscript):/i.test(href) ? "#" : href;
}

export function htmlToMarkdown(html) {
  const document = parseFragment(html);
  const lines = [];
  walk(document.root, { depth: 0 });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  function walk(node, context) {
    for (const child of node.children) {
      if (child.type === "text") {
        const value = child.value.replace(/\s+/g, " ");
        if (value.trim()) push(value.trim(), context);
        continue;
      }
      if (child.type === "cdata") { push(child.value, context); continue; }
      if (child.type !== "element") continue;
      renderElement(child, context);
    }
  }

  function renderElement(element, context) {
    const name = element.name.toLowerCase();
    if (["script", "style", "head", "meta", "link", "noscript"].includes(name)) return;
    const heading = /^h([1-6])$/.exec(name);
    if (heading) { lines.push("", `${"#".repeat(Number(heading[1]))} ${textOf(element)}`, ""); return; }
    if (name === "p") { lines.push("", inlineOf(element), ""); return; }
    if (name === "br") { lines.push(""); return; }
    if (name === "hr") { lines.push("", "---", ""); return; }
    if (name === "pre") { lines.push("", "```", textOf(element), "```", ""); return; }
    if (name === "blockquote") { lines.push("", ...inlineOf(element).split("\n").map((line) => `> ${line}`), ""); return; }
    if (name === "ul" || name === "ol") {
      if (context.depth === 0) lines.push("");
      let counter = 1;
      for (const item of element.children.filter((child) => child.type === "element" && child.name.toLowerCase() === "li")) {
        const marker = name === "ol" ? `${counter++}.` : "-";
        const indent = "  ".repeat(context.depth);
        const nested = item.children.filter((child) => child.type === "element" && ["ul", "ol"].includes(child.name.toLowerCase()));
        lines.push(`${indent}${marker} ${inlineOf(item, { skip: ["ul", "ol"] })}`);
        for (const list of nested) renderElement(list, { depth: context.depth + 1 });
      }
      if (context.depth === 0) lines.push("");
      return;
    }
    if (name === "table") { renderTable(element); return; }
    if (name === "img") {
      const source = attribute(element, "src");
      lines.push(`![${attribute(element, "alt")}](${source})`);
      return;
    }
    if (["div", "section", "article", "main", "body", "html", "header", "footer", "nav", "aside", "figure", "figcaption", "tbody", "thead", "tr"].includes(name)) { walk(element, context); return; }
    push(inlineOf(element), context);
  }

  function renderTable(table) {
    const rows = [];
    collectRows(table, rows);
    if (!rows.length) return;
    lines.push("");
    lines.push(`| ${rows[0].join(" | ")} |`);
    lines.push(`| ${rows[0].map(() => "---").join(" | ")} |`);
    for (const row of rows.slice(1)) lines.push(`| ${row.join(" | ")} |`);
    lines.push("");
  }

  function collectRows(node, rows) {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      const name = child.name.toLowerCase();
      if (name === "tr") rows.push(child.children.filter((cell) => cell.type === "element" && ["td", "th"].includes(cell.name.toLowerCase())).map((cell) => inlineOf(cell)));
      else collectRows(child, rows);
    }
  }

  function inlineOf(element, { skip = [] } = {}) {
    return element.children.map((child) => {
      if (child.type === "text") return child.value.replace(/\s+/g, " ");
      if (child.type === "cdata") return child.value;
      if (child.type !== "element") return "";
      const name = child.name.toLowerCase();
      if (skip.includes(name)) return "";
      const inner = inlineOf(child, { skip });
      if (name === "strong" || name === "b") return `**${inner.trim()}**`;
      if (name === "em" || name === "i") return `*${inner.trim()}*`;
      if (name === "code") return `\`${inner}\``;
      if (name === "del" || name === "s") return `~~${inner.trim()}~~`;
      if (name === "a") return `[${inner.trim()}](${attribute(child, "href")})`;
      if (name === "img") return `![${attribute(child, "alt")}](${attribute(child, "src")})`;
      if (name === "br") return "\n";
      if (name === "input" && attribute(child, "type").toLowerCase() === "checkbox") {
        return child.attributes.some((item) => item.name.toLowerCase() === "checked") ? "[x]" : "[ ]";
      }
      return inner;
    }).join("").replace(/[ \t]+/g, " ").trim();
  }

  function textOf(element) {
    return element.children.map((child) => (child.type === "text" || child.type === "cdata" ? child.value : child.type === "element" ? textOf(child) : "")).join("").trim();
  }

  function attribute(element, name) {
    return element.attributes.find((item) => item.name.toLowerCase() === name)?.value ?? "";
  }

  function push(value, context) {
    if (!value) return;
    lines.push(`${"  ".repeat(context.depth)}${value}`);
  }
}

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** Parses a fragment under one synthetic root so several top-level nodes are fine. */
function parseFragment(html) {
  return parseXml(`<converter-root>${String(html)}</converter-root>`, { html: true });
}

/* ----------------------------------------------------------------- html -- */

const INLINE_ELEMENTS = new Set(["a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr"]);

export function formatHtml(input, indent = "  ") {
  const document = parseFragment(input);
  const lines = [];
  for (const child of document.root.children) write(child, 0);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");

  function write(node, depth) {
    const pad = indent.repeat(depth);
    if (node.type === "text") {
      const value = node.value.trim();
      if (value) lines.push(pad + value);
      return;
    }
    if (node.type === "comment") { lines.push(`${pad}<!--${node.value}-->`); return; }
    if (node.type === "cdata") { lines.push(`${pad}<![CDATA[${node.value}]]>`); return; }
    if (node.type === "instruction") { lines.push(`${pad}<?${node.value}?>`); return; }
    const attributes = node.attributes.map((attribute) => ` ${attribute.name}="${escapeHtml(attribute.value)}"`).join("");
    const name = node.name.toLowerCase();
    if (VOID_ELEMENTS.has(name)) { lines.push(`${pad}<${node.name}${attributes}>`); return; }
    const meaningful = node.children.filter((child) => child.type !== "text" || child.value.trim());
    if (!meaningful.length) { lines.push(`${pad}<${node.name}${attributes}></${node.name}>`); return; }
    const isInlineOnly = meaningful.every((child) => child.type === "text" || (child.type === "element" && INLINE_ELEMENTS.has(child.name.toLowerCase())));
    if (isInlineOnly) {
      const inner = meaningful.map((child) => renderInline(child)).join("").replace(/^\s+|\s+$/g, "");
      if ((pad + inner).length < 110) { lines.push(`${pad}<${node.name}${attributes}>${inner}</${node.name}>`); return; }
    }
    lines.push(`${pad}<${node.name}${attributes}>`);
    for (const child of meaningful) write(child, depth + 1);
    lines.push(`${pad}</${node.name}>`);
  }

  function renderInline(node) {
    if (node.type === "text") return node.value.replace(/\s+/g, " ");
    if (node.type === "comment") return `<!--${node.value}-->`;
    if (node.type !== "element") return "";
    const attributes = node.attributes.map((attribute) => ` ${attribute.name}="${escapeHtml(attribute.value)}"`).join("");
    if (VOID_ELEMENTS.has(node.name.toLowerCase())) return `<${node.name}${attributes}>`;
    return `<${node.name}${attributes}>${node.children.map(renderInline).join("")}</${node.name}>`;
  }
}

export function minifyHtml(input) {
  const document = parseFragment(input);
  return document.root.children.map(write).join("");

  function write(node) {
    if (node.type === "text") return node.value.replace(/\s+/g, " ");
    if (node.type === "comment") return "";
    if (node.type === "cdata") return `<![CDATA[${node.value}]]>`;
    if (node.type !== "element") return "";
    const attributes = node.attributes.map((attribute) => ` ${attribute.name}="${escapeHtml(attribute.value)}"`).join("");
    if (VOID_ELEMENTS.has(node.name.toLowerCase())) return `<${node.name}${attributes}>`;
    return `<${node.name}${attributes}>${node.children.map(write).join("")}</${node.name}>`;
  }
}

export function stripTags(input) {
  const document = parseFragment(input);
  const parts = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (child.type === "text" || child.type === "cdata") parts.push(child.value);
      else if (child.type === "element") {
        const name = child.name.toLowerCase();
        if (["script", "style"].includes(name)) continue;
        walk(child);
        if (["p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"].includes(name)) parts.push("\n");
      }
    }
  };
  walk(document.root);
  return parts.join("").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/* ------------------------------------------------------------------ css -- */

export function formatCss(input, indent = "  ") {
  const source = String(input);
  const lines = [];
  let depth = 0;
  let buffer = "";
  let index = 0;

  const flushDeclaration = (terminator) => {
    const value = collapse(buffer, depth > 0);
    buffer = "";
    if (value) lines.push(`${indent.repeat(depth)}${value}${terminator}`);
  };

  while (index < source.length) {
    if (source.startsWith("/*", index)) {
      const close = source.indexOf("*/", index + 2);
      const comment = source.slice(index, close === -1 ? source.length : close + 2);
      index = close === -1 ? source.length : close + 2;
      if (buffer.trim()) flushDeclaration("");
      lines.push(`${indent.repeat(depth)}${comment.replace(/\s+/g, " ")}`);
      continue;
    }
    const character = source[index];
    if (character === "{") {
      const selector = collapse(buffer, false);
      buffer = "";
      if (lines.length && depth === 0) lines.push("");
      lines.push(`${indent.repeat(depth)}${selector} {`);
      depth++;
      index++;
      continue;
    }
    if (character === "}") {
      if (buffer.trim()) flushDeclaration(";");
      depth = Math.max(0, depth - 1);
      lines.push(`${indent.repeat(depth)}}`);
      index++;
      continue;
    }
    if (character === ";") {
      flushDeclaration(";");
      index++;
      continue;
    }
    buffer += character;
    index++;
  }
  if (buffer.trim()) flushDeclaration("");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  function collapse(value, isDeclaration) {
    const text = value.replace(/\s+/g, " ").trim();
    if (!isDeclaration) return text.replace(/\s*,\s*/g, ",\n").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s*:\s*(?=[\w-]+\s*[({])/g, ":");
    const colon = text.indexOf(":");
    if (colon === -1) return text;
    return `${text.slice(0, colon).trim()}: ${text.slice(colon + 1).trim().replace(/\s*,\s*/g, ", ")}`;
  }
}

export function minifyCss(input) {
  return String(input)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>~+])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

/* ------------------------------------------------------------------ sql -- */

const SQL_CLAUSES = ["WITH", "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "WINDOW", "LIMIT", "OFFSET", "FETCH", "UNION ALL", "UNION", "INTERSECT", "EXCEPT", "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "CREATE TABLE", "CREATE INDEX", "CREATE VIEW", "ALTER TABLE", "DROP TABLE", "TRUNCATE TABLE", "RETURNING", "ON CONFLICT", "INNER JOIN", "LEFT OUTER JOIN", "RIGHT OUTER JOIN", "FULL OUTER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "CROSS JOIN", "NATURAL JOIN", "JOIN"];
const SQL_WORDS = ["AND", "OR", "NOT", "ON", "AS", "IN", "IS", "NULL", "LIKE", "ILIKE", "BETWEEN", "CASE", "WHEN", "THEN", "ELSE", "END", "DISTINCT", "ALL", "ASC", "DESC", "EXISTS", "USING", "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "CAST", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "DEFAULT", "UNIQUE", "CHECK", "CONSTRAINT", "INT", "INTEGER", "BIGINT", "TEXT", "VARCHAR", "BOOLEAN", "TIMESTAMP", "DATE", "NUMERIC", "SERIAL", "TRUE", "FALSE", "NULLS", "FIRST", "LAST", "OVER", "PARTITION", "BY"];

const SQL_TOKEN = /'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\/|[\w$]+|\S/g;

export function formatSql(input, { uppercase = true, indent = "  " } = {}) {
  const source = String(input).trim();
  if (!source) throw new Error("Enter a SQL statement");
  const matches = [...source.matchAll(SQL_TOKEN)];
  const tokens = matches.map((match) => match[0]);
  // Whether the author separated this token from the previous one, which is the
  // only reliable way to tell "count(x)" from "insert into people (id)".
  const spacedBefore = matches.map((match) => match.index > 0 && /\s/.test(source[match.index - 1]));
  const lines = [];
  let current = "";
  let currentIndent = 0;
  let depth = 0;

  const isWord = (token) => /^[\w$]+$/.test(token);
  const flush = () => {
    if (current.trim()) lines.push(indent.repeat(currentIndent) + current.trim());
    current = "";
  };
  const startLine = (level) => { flush(); currentIndent = level; };
  const append = (token) => {
    if (current && !current.endsWith("(") && !current.endsWith(".")) current += " ";
    current += token;
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const upper = token.toUpperCase();

    if (token.startsWith("--") || token.startsWith("/*")) {
      startLine(currentIndent);
      lines.push(indent.repeat(currentIndent) + token);
      continue;
    }

    if (isWord(token) && depth === 0) {
      const clause = SQL_CLAUSES.find((keyword) => keyword.split(" ").every((part, offset) => tokens[index + offset]?.toUpperCase() === part));
      if (clause) {
        startLine(0);
        index += clause.split(" ").length - 1;
        current = uppercase ? clause : clause.toLowerCase();
        continue;
      }
      if (upper === "AND" || upper === "OR") {
        startLine(1);
        current = uppercase ? upper : token.toLowerCase();
        continue;
      }
    }

    if (token === "(") {
      // A function call hugs its parenthesis; "insert into people (id)" keeps
      // the space the author wrote.
      if (current && spacedBefore[index]) current += " ";
      current += "(";
      depth++;
      continue;
    }
    if (token === ")") { depth = Math.max(0, depth - 1); current += ")"; continue; }
    if (token === ",") {
      current += ",";
      if (depth === 0) startLine(1);
      continue;
    }
    if (token === ";") { current += ";"; startLine(0); lines.push(""); continue; }
    if (token === ".") { current += "."; continue; }
    if (isWord(token) && uppercase && SQL_WORDS.includes(upper)) { append(upper); continue; }
    append(token);
  }
  flush();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ------------------------------------------------------------------ svg -- */

export function optimizeSvg(input) {
  const document = parseXml(input);
  if (document.root.name.toLowerCase() !== "svg") throw new Error("The input is not an SVG document");
  const drop = new Set(["version", "xmlns:sketch", "xmlns:xlink-unused", "data-name", "xml:space"]);
  const write = (node) => {
    if (node.type === "text") return node.value.trim();
    if (node.type === "comment" || node.type === "instruction") return "";
    if (node.type === "cdata") return `<![CDATA[${node.value}]]>`;
    if (node.type !== "element") return "";
    if (["metadata", "title", "desc", "sodipodi:namedview"].includes(node.name.toLowerCase())) return "";
    const attributes = node.attributes
      .filter((attribute) => !drop.has(attribute.name) && !attribute.name.startsWith("sodipodi:") && !attribute.name.startsWith("inkscape:"))
      .map((attribute) => ` ${attribute.name}="${escapeXml(shortenNumbers(attribute.value))}"`)
      .join("");
    const inner = node.children.map(write).join("");
    return inner ? `<${node.name}${attributes}>${inner}</${node.name}>` : `<${node.name}${attributes}/>`;
  };
  return write(document.root);
}

function shortenNumbers(value) {
  return value.replace(/-?\d*\.\d+/g, (number) => String(Number(Number(number).toFixed(3))));
}

export function svgToDataUri(input, { encoding = "url" } = {}) {
  const svg = optimizeSvg(input);
  if (encoding === "base64") {
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(svg)));
    return `data:image/svg+xml;base64,${base64}`;
  }
  const encoded = svg
    .replace(/"/g, "'")
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/\{/g, "%7B")
    .replace(/\}/g, "%7D")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/\s+/g, " ");
  return `data:image/svg+xml,${encoded}`;
}

export function svgPlaceholder({ width = 600, height = 400, text = "", background = "#e2e8f0", foreground = "#475569" } = {}) {
  const label = text || `${width}×${height}`;
  const fontSize = Math.max(12, Math.round(Math.min(width, height) / 8));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(label)}">`,
    `  <rect width="${width}" height="${height}" fill="${escapeXml(background)}"/>`,
    `  <text x="50%" y="50%" fill="${escapeXml(foreground)}" font-family="system-ui, sans-serif" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central">${escapeXml(label)}</text>`,
    "</svg>",
  ].join("\n");
}

/* ------------------------------------------------------------ meta tags -- */

export function metaTags({ title = "", description = "", url = "", image = "", siteName = "", type = "website", twitterCard = "summary_large_image", themeColor = "", locale = "en_US", author = "" } = {}) {
  if (!title) throw new Error("A page title is required");
  const attribute = (value) => escapeHtml(value);
  const tags = [
    "<!-- Primary -->",
    `<title>${attribute(title)}</title>`,
    description && `<meta name="description" content="${attribute(description)}">`,
    author && `<meta name="author" content="${attribute(author)}">`,
    url && `<link rel="canonical" href="${attribute(url)}">`,
    themeColor && `<meta name="theme-color" content="${attribute(themeColor)}">`,
    "",
    "<!-- Open Graph -->",
    `<meta property="og:type" content="${attribute(type)}">`,
    `<meta property="og:title" content="${attribute(title)}">`,
    description && `<meta property="og:description" content="${attribute(description)}">`,
    url && `<meta property="og:url" content="${attribute(url)}">`,
    image && `<meta property="og:image" content="${attribute(image)}">`,
    siteName && `<meta property="og:site_name" content="${attribute(siteName)}">`,
    `<meta property="og:locale" content="${attribute(locale)}">`,
    "",
    "<!-- Twitter -->",
    `<meta name="twitter:card" content="${attribute(twitterCard)}">`,
    `<meta name="twitter:title" content="${attribute(title)}">`,
    description && `<meta name="twitter:description" content="${attribute(description)}">`,
    image && `<meta name="twitter:image" content="${attribute(image)}">`,
  ];
  return tags.filter((tag) => tag !== false && tag !== undefined && tag !== "" || tag === "").filter((tag, index, all) => !(tag === "" && all[index - 1] === "")).join("\n");
}
