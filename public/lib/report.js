// A small description of a label/value result.
//
// Tools that answer a question ("what is this subnet?", "what colour is this?")
// all produced the same aligned monospace block, which the interface could only
// show as text in a box. Returning the rows alongside that text lets the
// interface lay them out as a real table while keeping a plain-text form for
// copying and downloading.

/**
 * @typedef {{ type: "row", label: string, value: string, tone?: string }
 *   | { type: "heading", label: string }
 *   | { type: "blank" }} ReportRow
 */

/** @param {(string | [string, unknown] | { heading: string })[]} entries */
export function report(entries) {
  const rows = entries.filter((entry) => entry !== null && entry !== undefined).map(toRow);
  return { text: renderText(rows), rows };
}

function toRow(entry) {
  if (typeof entry === "string") return entry.trim() === "" ? { type: "blank" } : { type: "heading", label: entry };
  if (Array.isArray(entry)) {
    const [label, value, tone] = entry;
    if (String(label).trim() === "" && String(value ?? "").trim() === "") return { type: "blank" };
    return { type: "row", label: String(label), value: String(value ?? ""), ...(tone ? { tone } : {}) };
  }
  if (entry.heading !== undefined) return { type: "heading", label: String(entry.heading) };
  return { type: "row", label: String(entry.label ?? ""), value: String(entry.value ?? ""), ...(entry.tone ? { tone: entry.tone } : {}) };
}

function renderText(rows) {
  const width = Math.max(0, ...rows.filter((row) => row.type === "row").map((row) => row.label.length));
  return rows.map((row) => {
    if (row.type === "blank") return "";
    if (row.type === "heading") return row.label;
    const value = row.value.includes("\n")
      ? row.value.split("\n").map((line, index) => (index === 0 ? line : `${" ".repeat(width + 2)}${line}`)).join("\n")
      : row.value;
    return `${row.label.padEnd(width)}  ${value}`;
  }).join("\n");
}

/** Turns a list of values into a report of numbered rows. */
export function listReport(values, { label = (index) => String(index + 1) } = {}) {
  return report(values.map((value, index) => [label(index), value]));
}
