// Text transformation, analysis, and comparison utilities.

import { randomIndex } from "./bytes.js";
import { report } from "./report.js";

/* ------------------------------------------------------------- casing --- */

export function splitWords(value) {
  return String(value)
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "if", "in", "nor", "of", "on", "or", "per", "the", "to", "via", "vs"]);

export const CASE_STYLES = {
  camel: (words) => words.map((word, index) => (index === 0 ? word.toLowerCase() : capitalize(word))).join(""),
  pascal: (words) => words.map(capitalize).join(""),
  snake: (words) => words.map((word) => word.toLowerCase()).join("_"),
  "screaming snake": (words) => words.map((word) => word.toUpperCase()).join("_"),
  kebab: (words) => words.map((word) => word.toLowerCase()).join("-"),
  "train": (words) => words.map(capitalize).join("-"),
  dot: (words) => words.map((word) => word.toLowerCase()).join("."),
  path: (words) => words.map((word) => word.toLowerCase()).join("/"),
  constant: (words) => words.map((word) => word.toUpperCase()).join("_"),
  sentence: (words) => capitalize(words.map((word) => word.toLowerCase()).join(" ")),
  title: (words) => words.map((word, index) => (index > 0 && SMALL_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : capitalize(word))).join(" "),
  lower: (words) => words.map((word) => word.toLowerCase()).join(" "),
  upper: (words) => words.map((word) => word.toUpperCase()).join(" "),
};

function capitalize(word) {
  return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word;
}

export function convertCase(input, style) {
  const transform = CASE_STYLES[style];
  if (!transform) throw new Error(`Unknown case style "${style}"`);
  return input.split("\n").map((line) => {
    const words = splitWords(line);
    return words.length ? transform(words) : "";
  }).join("\n");
}

export function allCases(input) {
  const words = splitWords(input);
  if (!words.length) throw new Error("Enter some text to convert");
  return report(Object.entries(CASE_STYLES).map(([style, transform]) => [style, transform(words)]));
}

export function slugify(input, { separator = "-", lowercase = true, maxLength = 0 } = {}) {
  let slug = String(input)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, separator)
    .replace(new RegExp(`\\${separator}{2,}`, "g"), separator)
    .replace(new RegExp(`^\\${separator}|\\${separator}$`, "g"), "");
  if (lowercase) slug = slug.toLowerCase();
  if (maxLength > 0 && slug.length > maxLength) slug = slug.slice(0, maxLength).replace(new RegExp(`\\${separator}[^\\${separator}]*$`), "");
  return slug;
}

/* ----------------------------------------------------------- statistics -- */

export function textStatistics(input) {
  const characters = [...input].length;
  const withoutSpaces = [...input.replace(/\s/g, "")].length;
  const words = input.trim() ? input.trim().split(/\s+/).length : 0;
  const lines = input === "" ? 0 : input.split("\n").length;
  const paragraphs = input.trim() ? input.trim().split(/\n\s*\n/).length : 0;
  const sentences = (input.match(/[^.!?\n]+[.!?]+(\s|$)/g) || []).length || (input.trim() ? 1 : 0);
  const bytes = new TextEncoder().encode(input).length;
  const readingMinutes = words / 225;
  const speakingMinutes = words / 130;
  const uniqueWords = new Set(input.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []).size;
  const longest = (input.match(/\S+/g) || []).reduce((best, word) => (word.length > best.length ? word : best), "");
  const frequencies = new Map();
  for (const word of input.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []) frequencies.set(word, (frequencies.get(word) || 0) + 1);
  const top = [...frequencies.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  const rows = [
    ["Characters", characters],
    ["Characters (no spaces)", withoutSpaces],
    ["Words", words],
    ["Unique words", uniqueWords],
    ["Sentences", sentences],
    ["Lines", lines],
    ["Paragraphs", paragraphs],
    ["UTF-8 bytes", bytes],
    ["Longest word", longest ? `${longest} (${longest.length})` : "—"],
    ["Reading time", formatMinutes(readingMinutes)],
    ["Speaking time", formatMinutes(speakingMinutes)],
  ];
  if (!top.length) return report(rows);
  return report([...rows, "", "Most frequent words", ...top.map(([word, count]) => [word, String(count)])]);
}

function formatMinutes(minutes) {
  if (minutes === 0) return "0 sec";
  const seconds = Math.round(minutes * 60);
  if (seconds < 60) return `${seconds} sec`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
}

/* ----------------------------------------------------------------- diff -- */

/** Longest-common-subsequence diff reported as a unified-style listing. */
export function diffText(left, right, { mode = "lines", ignoreCase = false, ignoreWhitespace = false } = {}) {
  const split = (value) => (mode === "words" ? value.split(/(\s+)/).filter((part) => part !== "") : value.split("\n"));
  const a = split(left);
  const b = split(right);
  const normalize = (value) => {
    let text = value;
    if (ignoreCase) text = text.toLowerCase();
    if (ignoreWhitespace) text = text.trim().replace(/\s+/g, " ");
    return text;
  };
  const operations = lcsDiff(a.map(normalize), b.map(normalize));
  let added = 0;
  let removed = 0;
  let leftLine = 0;
  let rightLine = 0;
  const output = [];
  for (const operation of operations) {
    if (operation.type === "equal") {
      leftLine += operation.count;
      rightLine += operation.count;
      for (let offset = 0; offset < operation.count; offset++) output.push(`  ${a[operation.aStart + offset]}`);
      continue;
    }
    if (operation.type === "remove") {
      for (let offset = 0; offset < operation.count; offset++) { removed++; output.push(`- ${a[operation.aStart + offset]}`); }
      leftLine += operation.count;
      continue;
    }
    for (let offset = 0; offset < operation.count; offset++) { added++; output.push(`+ ${b[operation.bStart + offset]}`); }
    rightLine += operation.count;
  }
  if (added === 0 && removed === 0) return "The two inputs are identical.";
  const header = `${added} added · ${removed} removed · ${a.length} → ${b.length} ${mode === "words" ? "tokens" : "lines"}`;
  return `${header}\n\n${output.join("\n")}`;
}

function lcsDiff(a, b) {
  const rows = a.length;
  const columns = b.length;
  const table = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      table[row][column] = a[row] === b[column] ? table[row + 1][column + 1] + 1 : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }
  const operations = [];
  const push = (type, aStart, bStart) => {
    const last = operations.at(-1);
    if (last && last.type === type) last.count++;
    else operations.push({ type, count: 1, aStart, bStart });
  };
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (a[row] === b[column]) { push("equal", row, column); row++; column++; }
    else if (table[row + 1][column] >= table[row][column + 1]) { push("remove", row, column); row++; }
    else { push("add", row, column); column++; }
  }
  while (row < rows) { push("remove", row, column); row++; }
  while (column < columns) { push("add", row, column); column++; }
  return operations;
}

export function similarityRatio(left, right) {
  if (left === right) return 1;
  if (!left.length || !right.length) return 0;
  const a = [...left];
  const b = [...right];
  const operations = lcsDiff(a, b);
  const common = operations.filter((operation) => operation.type === "equal").reduce((sum, operation) => sum + operation.count, 0);
  return (2 * common) / (a.length + b.length);
}

/* ------------------------------------------------------------ line ops --- */

export const LINE_OPERATIONS = {
  "sort ascending": (lines) => [...lines].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  "sort descending": (lines) => [...lines].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
  "remove duplicates": (lines) => [...new Set(lines)],
  "keep duplicates": (lines) => lines.filter((line, index) => lines.indexOf(line) !== index && lines.indexOf(line) < index),
  "remove empty lines": (lines) => lines.filter((line) => line.trim() !== ""),
  "trim whitespace": (lines) => lines.map((line) => line.trim()),
  reverse: (lines) => [...lines].reverse(),
  shuffle: (lines) => {
    const copy = [...lines];
    for (let index = copy.length - 1; index > 0; index--) {
      const swap = randomIndex(index + 1);
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  },
  "number lines": (lines) => {
    const width = String(lines.length).length;
    return lines.map((line, index) => `${String(index + 1).padStart(width)}  ${line}`);
  },
  "count occurrences": (lines) => {
    const counts = new Map();
    for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([line, count]) => `${String(count).padStart(6)}  ${line}`);
  },
};

export function transformLines(input, operation) {
  const transform = LINE_OPERATIONS[operation];
  if (!transform) throw new Error(`Unknown line operation "${operation}"`);
  return transform(input.split("\n")).join("\n");
}

export function joinLines(input, separator = ", ") {
  return input.split("\n").filter((line) => line.trim() !== "").map((line) => line.trim()).join(unescapeSeparator(separator));
}

export function splitOn(input, separator = ",") {
  return input.split(unescapeSeparator(separator)).map((part) => part.trim()).join("\n");
}

function unescapeSeparator(value) {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

export function wrapText(input, width = 80) {
  if (width < 10) throw new Error("Wrap width must be at least 10 characters");
  return input.split("\n").map((paragraph) => {
    if (paragraph.length <= width) return paragraph;
    const words = paragraph.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      if (line === "") line = word;
      else if (`${line} ${word}`.length <= width) line += ` ${word}`;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines.join("\n");
  }).join("\n");
}

/* -------------------------------------------------------------- search --- */

export function findReplace(input, pattern, replacement, { regex = false, flags = "g" } = {}) {
  if (!pattern) throw new Error("Enter something to search for");
  const expression = regex ? new RegExp(pattern, flags) : new RegExp(escapeRegex(pattern), flags);
  let count = 0;
  const output = input.replace(expression, (...args) => {
    count++;
    if (!regex) return replacement;
    return replacement.replace(/\$(\d+|&)/g, (_, group) => (group === "&" ? args[0] : args[Number(group)] ?? ""));
  });
  return { output, count };
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function testRegex(pattern, flags, subject) {
  if (!pattern) throw new Error("Enter a regular expression");
  let expression;
  try { expression = new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`); }
  catch (error) { throw new Error(`Invalid regular expression: ${error.message}`); }
  const matches = [...subject.matchAll(expression)];
  if (!matches.length) return "No matches.";
  const lines = matches.map((match, index) => {
    const before = subject.slice(0, match.index);
    const line = before.split("\n").length;
    const column = match.index - before.lastIndexOf("\n");
    const groups = match.slice(1).map((group, position) => `      $${position + 1} = ${group === undefined ? "(no match)" : JSON.stringify(group)}`);
    const named = match.groups ? Object.entries(match.groups).map(([name, value]) => `      ?<${name}> = ${value === undefined ? "(no match)" : JSON.stringify(value)}`) : [];
    return [`Match ${index + 1} at line ${line}, column ${column} (offset ${match.index})`, `      ${JSON.stringify(match[0])}`, ...groups, ...named].join("\n");
  });
  return `${matches.length} match${matches.length === 1 ? "" : "es"}\n\n${lines.join("\n\n")}`;
}

/* ------------------------------------------------------------ generators - */

const LOREM_WORDS = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(" ");

export function loremIpsum({ units = "paragraphs", count = 3, startWithLorem = true } = {}) {
  const word = () => LOREM_WORDS[randomIndex(LOREM_WORDS.length)];
  const sentence = () => {
    const length = 8 + randomIndex(10);
    const words = Array.from({ length }, word);
    return `${words[0][0].toUpperCase()}${words[0].slice(1)} ${words.slice(1).join(" ")}.`;
  };
  const paragraph = () => Array.from({ length: 3 + randomIndex(4) }, sentence).join(" ");
  const amount = Math.max(1, Math.min(200, Math.floor(count)));
  let output;
  if (units === "words") output = Array.from({ length: amount }, word).join(" ");
  else if (units === "sentences") output = Array.from({ length: amount }, sentence).join(" ");
  else output = Array.from({ length: amount }, paragraph).join("\n\n");
  if (startWithLorem) {
    const opener = units === "words" ? "lorem ipsum dolor sit amet" : "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
    output = units === "words" ? `${opener} ${output.split(" ").slice(5).join(" ")}` : `${opener} ${output.replace(/^[^.]*\.\s*/, "")}`;
  }
  return output;
}

/* ------------------------------------------------------------- alphabets - */

const NATO = { a: "Alfa", b: "Bravo", c: "Charlie", d: "Delta", e: "Echo", f: "Foxtrot", g: "Golf", h: "Hotel", i: "India", j: "Juliett", k: "Kilo", l: "Lima", m: "Mike", n: "November", o: "Oscar", p: "Papa", q: "Quebec", r: "Romeo", s: "Sierra", t: "Tango", u: "Uniform", v: "Victor", w: "Whiskey", x: "X-ray", y: "Yankee", z: "Zulu", 0: "Zero", 1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", ".": "Stop", "-": "Dash", "/": "Slash", "?": "Question mark" };

export function toNatoAlphabet(input) {
  return input.split("\n").map((line) => [...line].map((character) => {
    if (character === " ") return "(space)";
    return NATO[character.toLowerCase()] ?? character;
  }).join(" ")).join("\n");
}

const MORSE = { a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--", n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..", 0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.", ".": ".-.-.-", ",": "--..--", "?": "..--..", "'": ".----.", "!": "-.-.--", "/": "-..-.", "(": "-.--.", ")": "-.--.-", "&": ".-...", ":": "---...", ";": "-.-.-.", "=": "-...-", "+": ".-.-.", "-": "-....-", _: "..--.-", '"': ".-..-.", $: "...-..-", "@": ".--.-." };
const MORSE_REVERSE = Object.fromEntries(Object.entries(MORSE).map(([character, code]) => [code, character]));

export function toMorse(input) {
  return input.trim().toLowerCase().split(/\s+/).map((word) => [...word].map((character) => {
    const code = MORSE[character];
    if (!code) throw new Error(`"${character}" has no Morse representation`);
    return code;
  }).join(" ")).join(" / ");
}

export function fromMorse(input) {
  return input.trim().split(/\s*\/\s*|\s{3,}/).map((word) => word.trim().split(/\s+/).filter(Boolean).map((code) => {
    const character = MORSE_REVERSE[code];
    if (!character) throw new Error(`"${code}" is not a Morse code sequence`);
    return character;
  }).join("")).join(" ");
}

/* --------------------------------------------------------------- ciphers - */

export function caesarCipher(input, shift = 13) {
  const offset = ((Math.trunc(shift) % 26) + 26) % 26;
  return input.replace(/[a-z]/gi, (character) => {
    const base = character <= "Z" ? 65 : 97;
    return String.fromCharCode(((character.charCodeAt(0) - base + offset) % 26) + base);
  });
}

export function atbashCipher(input) {
  return input.replace(/[a-z]/gi, (character) => {
    const base = character <= "Z" ? 65 : 97;
    return String.fromCharCode(base + 25 - (character.charCodeAt(0) - base));
  });
}

export function vigenereCipher(input, key, decrypt = false) {
  const cleanKey = key.replace(/[^a-z]/gi, "").toLowerCase();
  if (!cleanKey) throw new Error("The Vigenère key must contain at least one letter");
  let position = 0;
  return input.replace(/[a-z]/gi, (character) => {
    const base = character <= "Z" ? 65 : 97;
    const shift = cleanKey.charCodeAt(position % cleanKey.length) - 97;
    position++;
    const delta = decrypt ? 26 - shift : shift;
    return String.fromCharCode(((character.charCodeAt(0) - base + delta) % 26) + base);
  });
}

export function reverseText(input, mode = "characters") {
  if (mode === "lines") return input.split("\n").reverse().join("\n");
  if (mode === "words") return input.split("\n").map((line) => line.split(/(\s+)/).reverse().join("")).join("\n");
  return [...input].reverse().join("");
}

export function obfuscate(input, { keepStart = 3, keepEnd = 3, mask = "*" } = {}) {
  return input.split("\n").map((line) => {
    if (line.length <= keepStart + keepEnd) return mask.repeat(line.length);
    return line.slice(0, keepStart) + mask.repeat(line.length - keepStart - keepEnd) + line.slice(line.length - keepEnd);
  }).join("\n");
}

export function numeronym(input) {
  return input.split(/\s+/).filter(Boolean).map((word) => (word.length > 3 ? `${word[0]}${word.length - 2}${word.at(-1)}` : word)).join(" ");
}
